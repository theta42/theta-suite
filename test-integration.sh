#!/usr/bin/env bash
# test-integration.sh — Docker-backed integration test runner for theta-suite.
#
# A working OpenLDAP is required for directory tests, so this runner always
# uses Docker to launch OpenLDAP + Redis in an isolated test harness, seeds the
# test directory with required fixtures/users, runs the full test suites, and
# tears everything down on completion.
#
# Usage:
#   ./test-integration.sh            # Run core SSO Docker test-runner + submodules
#   ./test-integration.sh --all      # Run core tests + all E2E Docker suites (tunnel, multi-site, mesh)
#   ./test-integration.sh --sso      # Run only SSO Manager Docker test suite
#   ./test-integration.sh --e2e      # Run only Docker E2E suites (tunnel, multisite, mesh)
#   ./test-integration.sh --no-build # Skip docker build (reuse existing images)

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[test]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Options ───────────────────────────────────────────────────────────────────
RUN_ALL=0; RUN_SSO=1; RUN_E2E=0; RUN_UNIT=1; NO_BUILD=0
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    case "$arg" in
      --all)      RUN_ALL=1; RUN_SSO=1; RUN_E2E=1; RUN_UNIT=1 ;;
      --sso)      RUN_ALL=0; RUN_SSO=1; RUN_E2E=0; RUN_UNIT=0 ;;
      --e2e)      RUN_ALL=0; RUN_SSO=0; RUN_E2E=1; RUN_UNIT=0 ;;
      --no-build) NO_BUILD=1 ;;
      --help|-h)
        echo "Usage: $0 [--all] [--sso] [--e2e] [--no-build]"
        exit 0
        ;;
      *) warn "Unknown option: $arg" ;;
    esac
  done
fi

BUILD_FLAG="--build"
if [[ "$NO_BUILD" == "1" ]]; then
  BUILD_FLAG=""
fi

# ── Check Docker ─────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is required to run tests with a working LDAP environment."
fi

# ── 1. SSO Manager Docker Test Harness (OpenLDAP + Redis + Jest) ─────────────
if [[ "$RUN_SSO" == "1" ]]; then
  info "${BOLD}Running SSO Manager test suite with Docker OpenLDAP + Redis...${NC}"
  (
    cd sso-manager-node
    docker compose -f docker-compose.test.yml down -v >/dev/null 2>&1 || true
    docker compose -f docker-compose.test.yml up $BUILD_FLAG --abort-on-container-exit --exit-code-from test-runner
    docker compose -f docker-compose.test.yml down -v >/dev/null 2>&1 || true
  )
  ok "SSO Manager Docker test suite passed!"
  echo ""
fi

# ── 2. Docker End-to-End Test Suites (Tunnel, Multi-site, WireGuard Mesh) ─────
if [[ "$RUN_E2E" == "1" ]]; then
  info "${BOLD}Running LDAP WebSocket Tunnel E2E test in Docker...${NC}"
  (
    cd sso-manager-node
    docker compose -f docker-compose.e2e.yml down -v >/dev/null 2>&1 || true
    docker compose -f docker-compose.e2e.yml up $BUILD_FLAG --abort-on-container-exit
    docker compose -f docker-compose.e2e.yml down -v >/dev/null 2>&1 || true
  )
  ok "LDAP Tunnel Docker E2E test passed!"
  echo ""

  info "${BOLD}Running Multi-Site Join & Replication 3-Node E2E test in Docker...${NC}"
  (
    cd sso-manager-node
    docker compose -f docker-compose.multisite-e2e.yml down -v >/dev/null 2>&1 || true
    docker compose -f docker-compose.multisite-e2e.yml up $BUILD_FLAG --abort-on-container-exit
    docker compose -f docker-compose.multisite-e2e.yml down -v >/dev/null 2>&1 || true
  )
  ok "Multi-Site Join & Replication Docker E2E test passed!"
  echo ""

  info "${BOLD}Running Jump-Host 3-Site WireGuard Mesh E2E test in Docker...${NC}"
  (
    cd jump-host
    export E2E_PASS=$(openssl rand -hex 12) E2E_JWT=$(openssl rand -hex 24) E2E_TOKEN=$(openssl rand -hex 16)
    docker compose -f docker-compose.mesh-e2e.yml down -v >/dev/null 2>&1 || true
    docker compose -f docker-compose.mesh-e2e.yml up $BUILD_FLAG --abort-on-container-exit --exit-code-from checker
    docker compose -f docker-compose.mesh-e2e.yml down -v >/dev/null 2>&1 || true
  )
  ok "Jump-Host 3-Site WireGuard Mesh Docker E2E test passed!"
  echo ""
fi

# ── 3. Component Unit & Submodule Tests ────────────────────────────────────────
if [[ "$RUN_UNIT" == "1" ]]; then
  if [[ -d proxy/nodejs ]]; then
    info "${BOLD}Running Theta Proxy unit tests...${NC}"
    (cd proxy/nodejs && npm test)
    ok "Theta Proxy unit tests passed!"
    echo ""
  fi

  if [[ -d jump-host/nodejs ]]; then
    info "${BOLD}Running Jump Host unit tests...${NC}"
    (cd jump-host/nodejs && npm test)
    ok "Jump Host unit tests passed!"
    echo ""
  fi

  if [[ -d ldap-client ]]; then
    info "${BOLD}Running LDAP Client slugification tests...${NC}"
    (cd ldap-client && bash test_slug.sh)
    ok "LDAP Client tests passed!"
    echo ""
  fi

  if command -v go >/dev/null 2>&1 && [[ -d theta-agent ]]; then
    info "${BOLD}Running Theta Agent Go tests...${NC}"
    (cd theta-agent && go test -count=1 ./...)
    ok "Theta Agent Go tests passed!"
    echo ""
  fi
fi

ok "${BOLD}All tests completed successfully using Docker OpenLDAP environment!${NC}"
