#!/usr/bin/env bash
# test-integration.sh — Full Docker integration test for theta-suite.
#
# Starts the sso-manager container in test mode (no secrets.js required),
# seeds an LDAP test user, runs the full jest suite inside the container,
# then tears everything down.
#
# Usage:
#   ./test-integration.sh            # run all tests
#   ./test-integration.sh --no-build # skip docker build (reuse existing image)
#   ./test-integration.sh --keep     # leave containers up after tests (for debugging)

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[test]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Options ───────────────────────────────────────────────────────────────────
NO_BUILD=0; KEEP=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --keep)     KEEP=1 ;;
    --help|-h)  echo "Usage: $0 [--no-build] [--keep]"; exit 0 ;;
    *) warn "Unknown option: $arg" ;;
  esac
done

# ── Test environment config (self-contained, no secrets.js needed) ────────────
export COMPOSE_PROJECT_NAME="theta-test"
TEST_CONTAINER="theta-test-sso-manager-1"

LDAP_BASE_DN="dc=test,dc=local"
LDAP_ADMIN_PASS="testadminpass"
TEST_UID="test"
TEST_PASSWORD="MyTestPassword!2"  # must match tests/setup.js TEST_CREDS

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  if [[ "$KEEP" == "1" ]]; then
    warn "Leaving containers up (--keep). Tear down with: docker compose -p theta-test down -v"
  else
    info "Tearing down test stack..."
    docker compose -p theta-test -f docker-compose.test.yml down -v --remove-orphans 2>/dev/null || true
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

# ── Write a minimal test compose override ────────────────────────────────────
info "Writing docker-compose.test.yml..."
cat > docker-compose.test.yml <<'COMPOSEEOF'
# Minimal test stack: sso-manager only (no proxy, no openbao, no jump-host).
# Uses env-mode config — no secrets.js or openbao token required.
services:
  sso-manager:
    build:
      context: ./sso-manager-node
      dockerfile: Dockerfile.openldap
      target: ""
    container_name: theta-test-sso-manager
    restart: "no"
    networks: [theta-test-net]
    environment:
      - NODE_ENV=test
      - NODE_PORT=3001
      - LDAP_BASE_DN=dc=test,dc=local
      - LDAP_ADMIN_PASS=testadminpass
      - ORG_NAME=Test Org
      - LDAP_DOMAIN=test.local
      # Inline JWT secret for tests (no secrets.js or bao needed)
      - app_oauth__jwtSecret=test-integration-jwt-secret-theta42
    ports:
      - "13001:3001"
      - "10389:389"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/health"]
      interval: 5s
      timeout: 5s
      retries: 24
      start_period: 30s
networks:
  theta-test-net:
    driver: bridge
COMPOSEEOF

# ── Build ─────────────────────────────────────────────────────────────────────
if [[ "$NO_BUILD" == "0" ]]; then
  info "Building sso-manager test image..."
  docker compose -p theta-test -f docker-compose.test.yml build sso-manager
  ok "Image built"
else
  warn "Skipping build (--no-build)"
fi

# ── Start ─────────────────────────────────────────────────────────────────────
info "Starting sso-manager container..."
docker compose -p theta-test -f docker-compose.test.yml up -d sso-manager

# ── Wait for healthy ──────────────────────────────────────────────────────────
info "Waiting for sso-manager to become healthy (up to 120s)..."
for i in $(seq 1 120); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' theta-test-sso-manager 2>/dev/null || echo "missing")
  if [[ "$STATUS" == "healthy" ]]; then
    ok "sso-manager is healthy"
    break
  fi
  if [[ $i -eq 120 ]]; then
    warn "Container never became healthy. Logs:"
    docker logs theta-test-sso-manager --tail 60
    fail "sso-manager failed to become healthy after 120s"
  fi
  sleep 1
done

# ── Wait for LDAP ─────────────────────────────────────────────────────────────
info "Waiting for LDAP on port 10389..."
for i in $(seq 1 30); do
  if ldapsearch -x -H ldap://localhost:10389 -b "" -s base "(objectClass=*)" >/dev/null 2>&1; then
    ok "LDAP is ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    fail "LDAP did not become reachable on localhost:10389 after 30s"
  fi
  sleep 1
done

# ── Seed test user ────────────────────────────────────────────────────────────
info "Seeding test LDAP user via seed-test-user.sh..."

docker cp sso-manager-node/test/seed-test-user.sh theta-test-sso-manager:/tmp/seed-test-user.sh
docker exec \
  -e LDAP_HOST=localhost \
  -e LDAP_PORT=389 \
  -e BIND_DN="cn=admin,${LDAP_BASE_DN}" \
  -e BIND_PW="${LDAP_ADMIN_PASS}" \
  -e BASE_DN="${LDAP_BASE_DN}" \
  theta-test-sso-manager \
  sh /tmp/seed-test-user.sh

ok "Test user seeded"

# ── Install dev deps (jest) inside the running container ──────────────────────
info "Installing test dependencies (jest) inside container..."
docker exec theta-test-sso-manager sh -c "
  cd /app &&
  if ! command -v jest >/dev/null 2>&1 && [ ! -f node_modules/.bin/jest ]; then
    npm install --save-dev jest@latest supertest@latest --silent 2>&1 | tail -3
  else
    echo 'jest already installed'
  fi
"
ok "Test deps ready"

# ── Copy test files into container ────────────────────────────────────────────
info "Copying tests into container..."
docker cp sso-manager-node/nodejs/tests/. theta-test-sso-manager:/app/tests/

ok "Tests copied"

# ── Run jest ──────────────────────────────────────────────────────────────────
info "Running full jest test suite inside container..."
echo ""

# These app_* vars are set by the entrypoint for the main process but NOT
# inherited by docker exec subprocesses. Pass them explicitly so the jest
# process loads app.js with the correct LDAP connection details.
docker exec \
  -e NODE_ENV=test \
  -e REDIS_URL="redis://127.0.0.1:6379" \
  -e app_oauth__jwtSecret="test-integration-jwt-secret-theta42" \
  -e app_ldap__url="ldap://localhost:389" \
  -e app_ldap__bindDN="cn=admin,${LDAP_BASE_DN}" \
  -e app_ldap__bindPassword="${LDAP_ADMIN_PASS}" \
  -e app_ldap__userBase="ou=people,${LDAP_BASE_DN}" \
  -e app_ldap__groupBase="ou=groups,${LDAP_BASE_DN}" \
  theta-test-sso-manager \
  sh -c "
    cd /app
    # Write test conf with full LDAP connection details so jest workers get
    # the correct config without needing to inherit docker exec env vars.
    # app_* env vars are only applied at conf-module require time, but jest
    # workers may not reliably inherit them across all parallelism models.
    cat > /app/conf/test.js << CONFEOF
'use strict';
module.exports = {
  redis: { prefix: 'sso_manager_test_' },
  oauth: { jwtSecret: 'test-integration-jwt-secret-theta42' },
  ldap: {
    url: 'ldap://localhost:389',
    bindDN: 'cn=admin,${LDAP_BASE_DN}',
    bindPassword: '${LDAP_ADMIN_PASS}',
    userBase: 'ou=people,${LDAP_BASE_DN}',
    groupBase: 'ou=groups,${LDAP_BASE_DN}'
  }
};
CONFEOF
    echo 'conf/test.js written'
    REDIS_URL='redis://127.0.0.1:6379' node_modules/.bin/jest --forceExit --passWithNoTests 2>&1
  "
JEST_EXIT=$?

echo ""
if [[ $JEST_EXIT -eq 0 ]]; then
  ok "All jest tests passed!"
else
  fail "Some jest tests failed (exit code $JEST_EXIT)"
fi

# ── Theta-agent Go tests (host-side, no docker needed) ───────────────────────
if command -v go >/dev/null 2>&1 && [[ -d theta-agent ]]; then
  info "Running theta-agent Go tests..."
  (cd theta-agent && go test ./... -count=1 2>&1)
  ok "Theta-agent Go tests passed"
else
  warn "Skipping theta-agent Go tests (go not found or theta-agent dir missing)"
fi

ok "All integration tests complete!"
