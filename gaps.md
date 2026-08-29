# Gaps — audit findings & fix tracking

Source: full-repo security/correctness audit, 2026-08-28. All CRITICAL/HIGH evidence
re-verified against source at audit time. Status is updated as fixes land.

Status legend: `open` → `in-progress` → `fixed` (with file refs) → `design-gap` (needs
product decision, documented, not silently patched).

## CRITICAL

| ID | Component | Finding | Fix | Status |
|----|-----------|---------|-----|--------|
| C1 | root setup.sh | OpenBao root token + unseal key in `./.env` at 0644 (`env_upsert` never chmods) | `env_upsert` creates/normalizes file at mode 600 | fixed |
| C2 | sso-manager-node | `/api/webhook` mounted with no auth → anonymous CRUD, plaintext secrets in GET, SSRF via `hook.url` | `middleware.auth` + `app_sso_admin` gate at mount; `secret` → `isPrivate`; URL scheme validation http(s) only | fixed |
| C3 | proxy | `GET /api/cert/:host` returns wildcard **private key** to viewer role; `Host.remove()` deletes cert under wrong key (`this.domain` vs `this.host`) → key never purged | gate `requireAdmin`; strip `privkey_pem`/`csr_pem` from response; `deleteCert(this.host)` | fixed |
| C4 | ldap-client | directory bind password baked into world-readable `/usr/local/bin/ldap-ssh-key` (755) and passed in **argv** (`-w`); plaintext `ldap://` | password moved to `/etc/ldap-ssh-key.pass` (0640 root:nogroup, script reads via `ldapsearch -y`); `ldaps://` with configurable `ldap_tls_reqcert` | fixed |

## HIGH — identity & access

| ID | Component | Finding | Fix | Status |
|----|-----------|---------|-----|--------|
| H1 | sso | Join key + `?hostname=` rotates **any** agent's token (takeover: `api_agent.js:544-586`) | rotation requires `?prev_token=` matching the agent's current credential (contract G-2); otherwise reject 4001 on name collision; agent persists + sends `prev_auth_token` (`ClearEnrollment` preserves it) | fixed |
| H2 | sso | `/api/v1/ldap/search` runs arbitrary `base_dn`/`scope`/`filter` under the **admin** bind | pin base to user/group/admin bases, scope ∈ {base,sub}, force-drop `userPassword`/`sshPrivateKey`-class attrs from any request's `attributes` | fixed |
| H3 | sso | slapd seed ACL `access to * by * read` = anonymous whole-directory read | `by * none`, explicit read for the service account (`cn=ldapclient`), keep `by anonymous auth` on userPassword (SSSD binds as the user) | fixed |
| H4 | sso | Logout dead branch (`/api/auth` mounted without `middleware.auth` → `req.user` never set); `AuthToken` has no TTL; deactivation doesn't kill live sessions | logout invalidates the presented `auth-token` directly; `AuthToken._ttl` 30d; per-request check rejects deactivated/locked users | fixed |
| H5 | sso | Invite redemption condition inverted (`!is_valid && mailToken !== …`) → consumed invites re-redeemable, possession proof skippable | `||` + require `is_valid` **and** mail_token match + `claimed_by==='__NONE__'` | fixed |
| H6 | theta-agent | Tray IPC: root daemon socket `chmod 0666`, zero peer checks → any local user: `reinit` (wipes enrollment), `vpn_connect/disconnect`, `set_exit`, `register_service` | SO_PEERCRED gate: mutating commands require peer euid 0 (root CLI); status reads unrestricted; socket stays 0666 for cross-user status | fixed |
| H7 | theta-agent + sso | `desktop_control`/`lock_session`/`logout_user`/`display_off`/`sleep_host` run **unsigned** (agent has no check, server driver doesn't sign) despite PROTOCOL.md; signatures cover payload only (no `type`, no nonce → replay + type-portable) | agent verifies signature on all 5 types; driver signs them (`isHighRisk`); canonical bytes now `{"payload":…,"type":…}` (contract G-1); `service_restart` verified too | fixed |
| H8 | jump-host | exit downgrade: rule removal keyed on `from` only → stale lower-priority ip-rule keeps steering a device to a site it left | diff on `(from, table)` pairs; delete stale table-mismatched rules even when `from` still wanted | fixed |
| H9 | theta-agent | `register_service` name → newline-injected into root `agent.yml` top-level keys (capability escalation / config corruption); `WriteFile 0600` never chmods existing files; `ReplaceAllString` `$`-expansion corrupts values with `$` | validate service names (`^[A-Za-z0-9._@+-]{1,128}$`) on WS + CLI persist path; explicit `os.Chmod(0600)` after every write; literal replacement via `ReplaceAllStringFunc` | fixed |
| H10 | root + jump-host + bootstrap | `JUMP_SSH_PORT` honored by nothing: bootstrap hardcodes `ssh.listenPort: 2222`; app never reads env → non-default port = broken SSH door + wrong banner | `writeJumpSecrets` uses `Number(process.env.JUMP_SSH_PORT || 2222)`; setup.sh passes it into the bootstrap exec (contract G-3); install.sh also emits `app_ssh__listenPort` into gateway.env | fixed |
| H11 | ldap-client | access filter / registration built from **raw** site name + hostname; directory creates **slugified** names → any non-slug name = silent total lockout (and stderr discarded by setup.sh) | index.sh computes `ldap_location_slug`/`current_host_slug` with the suite slug rule (contract G-5); templates + register payload use them; setup.sh no longer swallows enrollment output | fixed |
| H12 | ldap-client + sso | `ldap_tls_reqcert=never` unconditional; plaintext `ldap://` in key script; **sudo landmine**: directory stamps `sudoHost ALL/sudoCommand ALL` on every user while SSSD sudo responder is disabled (the one-line fix = universal root) | reqcert configurable (`ldap_tls_reqcert`, default `never` only for loopback in generated vars, `demand` otherwise); key script → ldaps; ALL/ALL sudoRole stamping removed from `user_ldap.js`; sudo_provider/`sssd-sudo.socket` wiring removed from template+index.sh until a scoped mechanism exists | fixed (scoped sudo = design-gap D5) |
| H13 | sso | auto-pushed SSSD config: hardcoded `sso.laptop-dev.vm42.us`/`dc=laptop-dev` fallbacks; cleartext `ldap://ssoHost:389` + LAN-IP:389 URIs ordered before ldaps | no stack config → refuse push (error, not dev defaults); URI list = `ldapi` + loopback + `ldaps://ssoHost:636` only; cleartext network URIs dropped | fixed |
| H14 | sso | push-token + `X-Forwarded-User` = act as any uid on spoke (no master verification); `api_agent.js` defaults asserted identity to `'admin'` | HMAC header `x-forwarded-mac = hex(hmac_sha256(pushToken, uid + "\n" + ts + "\n" + path))`, ±5 min window, required on both master←spoke and spoke←master branches (`spoke_write_proxy.js` signs, `middleware/auth.js` verifies); `'admin'` default removed; reject `X-Forwarded-User` without a valid MAC | fixed |
| H15 | sso | slapd.conf here-doc delimiter has leading space (` SLAPDEOF`) in `docker-entrypoint.sh` → bash swallows remainder of entrypoint into slapd.conf | removed leading whitespace before `SLAPDEOF` delimiter | fixed |
| H16 | sso | Anonymous base DN health searches (`docker-entrypoint.sh:423` & `ldap_seed.js:waitForSlapd`) fail under H3 hardened ACLs (`access to * by * none`) → container reboot crash (ldap_add 68) & spoke join replica seeding rollback (502) | authenticate internal base searches with admin bind credentials (`-D` and `-w`) | fixed |
| H17 | jump-host | `Dockerfile` omitted `COPY nodejs/controller ./controller` → container boot fails with `MODULE_NOT_FOUND` in `bin/www` | added `COPY nodejs/controller ./controller` to Dockerfile | fixed |

## MEDIUM

| ID | Component | Finding | Fix | Status |
|----|-----------|---------|-----|--------|
| M1 | root | `secret/sso-manager/conf` seeded once, never refreshed, while bao-conf merges vault **over** `./config/sso-secrets.js` → documented "edit config/ + re-run" workflow silently ignored for the SSO (proxy/jump force-refresh) | force-refresh `sso-manager/conf` from the file each run like proxy/jump (file = operator truth; vault copies of per-user/app secrets untouched) | fixed |
| M2 | root | Vault API on `0.0.0.0:8200` tls_disable, published `8080:8200` host-wide; only consumer is `127.0.0.1:8080` | compose maps `127.0.0.1:8080:8200`; hcl listener stays in-container | fixed |
| M3 | root | `SSO_BIND`/`MGMT_BIND`/`LDAP_BIND`/`LDAPS_BIND` overrides never persisted → next plain `./setup.sh` re-exposes 0.0.0.0 | resolved overrides `env_upsert`'d into `./.env`; documented in master.env.example | fixed |
| M4 | root | agent join keys: "idempotent" comment false — every run mints a new unlimited, non-expiring enrollment key; old ones never revoked | comment corrected; keys now minted with `expires_in_days` + `max_uses` (sso model support added), previous `setup` label keys revoked before minting | fixed |
| M5 | root | crown jewels in argv + stdout: `docker exec -e VAULT_TOKEN=…` (argv visible), unseal key argv, `-w <ldaproot>` argv (bootstrap), `die` dumps `BOOTSTRAP_OUT` incl. CLIENT_SECRET, passwords echoed | env via `--env-file` temp (0600) instead of `-e` for VAULT_TOKEN; `docker exec -i` + `--args-file`-style stdin for ldapadd/`bao unseal` where supported (`bao operator unseal -` reads stdin? verified: no → argv kept but note; ldapadd `-y` passfile); failure dump suppressed unless `SETUP_DEBUG=1` | fixed (partial: see gaps-m5 note; unseal key argv is unavoidable without auto-unseal = D3) |
| M6 | root | spoke parity logic inverts its own stated rule (master advances submodules each run, spokes pinned) | master honors the same pin: if `THETA_SUITE_VERSION` exists in `.env`, master advances to that tag's gitlinks instead of newest; newest-tag behavior only when env var absent | fixed |
| M7 | root | `/api/site/ping` returns master's LDAP **root password** to any join-key holder; absent field on older master → silent divergent random root pw | ping response kept (compat) but README/secrets.md + spoke.env.example now state join key = root credential; missing `ldapAdminPass` → loud warn + operator confirmation required (`--allow-divergent-ldap-root` or interactive) | fixed (policy note in docs) |
| M8 | proxy | open redirect `/\evil.com` in `safeRd` (repo copy misses the backslash case the vendored `safe_redirect.js` handles) | reuse package `safeInternalPath` (rejects `/`-then-`/` or `\`) | fixed |
| M9 | proxy | lookup socket chmod 660 root:root vs Dockerfile/entrypoint docs promise 777 for nobody workers → wildcard cache-miss lookups dead (406) | chmod `0666` on the socket (matches docs, cosocket peer is local-only) | fixed |
| M10 | proxy | un-awaited `Host.addCache` rethrow → unhandled rejection kills mgmt app | await + catch/warn at call site | fixed |
| M11 | proxy | shared ldapts client races: concurrent bind/search/unbind on one connection; login leaves connection bound as the user | per-request client for `login` (bind-test path); module client guarded by promise-chain mutex with `finally` unbind-to-service | fixed |
| M12 | proxy | admin AuthToken (login sessions) never expires; logout client-side only | `isPrivate`/`_ttl` 30d on the proxy token model + logout flips `is_valid` server-side (proxy's own `routes/api.js` logout path) | fixed |
| M13 | theta-agent | unbounded read loop (no SetReadLimit/deadlines/PingHandler); `http.Get` no timeout in `downloadBinary` + no size cap, runs **in** the read loop (stall = daemon freeze); unclosed resp body; `log.Fatalf` on bad ServerURL kills daemon | 1 MiB read limit; pong handler + 90s read deadline w/ 60s ping ticker; dedicated `http.Client{Timeout: 60s}` + `io.CopyN(cap)` + defer Close; URL errors logged, retry loop continues | fixed |
| M14 | theta-agent | `4002` (superseded) missing from slow-backoff close list → two copies reconnect-war at 5 s | added to `IsCloseError` list (30 s backoff) | fixed |
| M15 | theta-agent | CLI register relay dials `TraySocket=/tmp/…` while daemon binds `/run/theta/…` and breaks → relay always fails, 4002 race returns | daemon listens on **all** bindable paths in `TraySocketPaths` (no break); CLI dials the path the daemon actually serves by trying each in order | fixed |
| M16 | theta-agent | `host.Info()` error ignored → nil-deref panic in `CollectDiscoveryData`; `url.Parse` error ignored → nil deref in `serviceWSURL`; unbounded PID-keyed caches | error-checked with zero-value fallback; parse error returned; caches evicted at size bound | fixed |
| M17 | jump-host | `removePeer` parses comma-separated `allowed-ips` with `/\s+/` → trailing commas → route deletes silently fail → blackhole routes after site removal | split on `/\s*,\s*/` (trim), test added | fixed |
| M18 | jump-host | `POST /api/mesh/reconcile` calls raw `reconcileMesh()` bypassing the inFlight serializer | export + call `runReconcile()` (the guarded wrapper) | fixed |
| M19 | jump-host | NETMAPs never reconciled down (no caller of `removeNetmap`); applied state not tracked | planReconcile diffs applied-netmaps (Redis-tracked) vs wanted; stale ones removed via `removeNetmap` | fixed |
| M20 | jump-host | unauthenticated local Redis holds WG private keys/sessions | `requirepass` generated by install.sh into gateway.env + `redis-server --requirepass` (host) / entrypoint (container); app reads pass from conf/env | fixed |
| M21 | jump-host | gateway's own injected key excluded from inbound auth by **comment text**; cross-site replication → gateway A's key authenticates on gateway B | compare parsed key blob against local identity pubkey, comment irrelevant | fixed |
| M22 | jump-host | compose deploy: hostKeyPath default `/opt/theta-suite/…` ≠ mounted `/var/lib/jump-host` → claim "persist across rebuilds" false | conf default reads `hostKeyPath` under a path both layouts share; compose passes `app_ssh__hostKeyPath=/var/lib/jump-host/keys` | fixed |
| M23 | proxy | response cache shared across authenticated users on gated hosts (`proxy_cache_key` has no auth component) | gated hosts forced `proxy_cache off` (hostfeatures.lua forces skip_cache=1 whenever auth enabled) | fixed |
| M24 | proxy | login path outside forcessl + `callbackUri` from `req.protocol` (http) vs https-only registered wildcards; cookie `secure` off on http | `__proxy_auth` location now 301→https first; `callbackUri` forced https behind TLS-terminating proxy | fixed |
| M25 | proxy | bootstrap registers per-host SSO redirect wildcards from `ldapDomain`, breaks on spokes where `CFG_PUBLIC_DOMAIN` diverges | `proxyRedirectUris` uses public domain when present (`stack.publicDomain`), falls back to ldapDomain; setup.sh writes `publicDomain` into `stack` | fixed |
| M26 | sso | user enumeration: 404 vs 200 on otp/*, resetpassword neutralization commented out | uniform "if exists" responses (404 path neutralized), commented guard reinstated | fixed |
| M27 | sso | `GET /api/user/:uid` readable by any authenticated user (IDOR) | self-or-`app_sso_admin` gate added (matches sibling routes) | fixed |
| M28 | sso | OTP: plaintext compare (timing), no attempt counter; `client_secret` missing → bcrypt throws → 500 with internals echoed | `timingSafeEqual` compare; missing-secret → 400, `parseClientAuth` splits Basic at first colon only | fixed |
| M29 | sso | unescaped DN components in rollback/delete paths (`cn=${data.uid}`) while create escapes | `escapeDNValue` applied at :237/:244 equivalents | fixed |
| M30 | theta-agent | cron probe `/etc/cron.d/ + name` path traversal (root daemon reads arbitrary files from remote-supplied names) | service-name validation (H9 charset) applied before any probe path construction | fixed |
| M31 | theta-agent | zpool_scrub: server driver sends a command no agent implements (dead feature both directions) | agent implements `zpool_scrub` (signed + new `storage` capability default false); driver already matches | fixed |
| M32 | ldap-client | half-enroll: nsswitch rewritten before SSSD ever validated, no backup; `mo` silently renders missing vars; unchecked curl register; 644 window on rendered conf | nsswitch backup + sssd config pre-check (`sssd -c … -i -t`? use `sssctl config-edit --validate` fallback: start sssd **before** nsswitch cutover with rollback on failure); `mo --fail-not-set`; `curl -f` + response check; `umask 077` around render; sshd block guarded on `AuthorizedKeysCommandUser` too | fixed |
| M33 | ldap-client | registration JSON built by raw interpolation (`os_name` etc.) | payload built via `node`/`printf %q`-safe JSON (jq if present, python3 fallback) | fixed |
| M34 | proxy | `basicauth_users` visible to viewers (unsalted SHA-1 hashes); non-constant-time Lua compare | `isPrivate` on field; Lua `ffi.CCRYPTO_memcmp`-style constant-time via `ngx.decode_base64` + length-checked byte loop | fixed |
| M35 | sso/root | join key presented as low-stakes but doubles as master root-password retrieval (see M7) | README/secrets.md wording + ping gated to https-only, warn in setup output | fixed |
| M36 | jump-host | Missing `EXIT_KEYPAIR_KEY` and missing module exports (`planReconcile`, `localIdentity`, etc.) in `mesh_state.js` → `TypeError: planReconcile is not a function` during mesh reconciliation | restored keypair key and exported all reconciliation functions | fixed |
| M37 | sso | Operator precedence in `utils/metrics.js` (`process.env.REDIS_URL || (conf.redis && typeof conf.redis === 'string') ? conf.redis : ...`) evaluates to object when REDIS_URL present → `url.startsWith is not a function` | refactored conditional URL resolution to guarantee string or undefined | fixed |
| M38 | proxy | `routes/cert.js` `GET /api/cert/:host` throws TypeError on `delete cert.privkey_pem` when `getCert()` returns null for non-existent cert | added `if (!cert) return res.status(404).json({})` | fixed |
| M39 | proxy | `routes/host_auth.js` per-host SSO cookie `secure` flag only checked `req.protocol === 'https'`, dropping `Secure` attribute behind TLS-terminating proxies | added `req.headers['x-forwarded-proto'] === 'https'` check | fixed |
| M40 | sso | `package.json` `"test"` script contained hardcoded list of 62 files, omitting 19 test suites | updated test script to `NODE_ENV=test jest --forceExit` covering all 81 test files | fixed |

## LOW (cheap wins done inline)

| ID | Component | Finding | Fix | Status |
|----|-----------|---------|-----|--------|
| L1 | root | `.env.example` documents removed flow; its `CHANGE-ME` placeholders migrate verbatim into generated LDAP root pw | example marked LEGACY/migration-only; migration refuses literal `CHANGE-ME` values (regenerates) | fixed |
| L2 | root | health loops: 120 iterations, die at 60 ("60s" message mismatch); `die "\n"` literal; ERR trap leaks past `backup_before_rebuild`; orphan `jump-*` volumes; `release.sh`+`pr_url.txt` debris | messages corrected, trap cleared in `finally`, literal newline via printf, volumes removed (bootstrap still owns jump-* dir paths, harmless), release.sh/pr_url.txt deleted (untracked one-offs) | fixed |
| L3 | proxy | dead `host-pass-though` control; `X-Target-Host` leaks internal IP; wrong `X-Forwarded-Proto` value; forcessl redirect drops query string | dead branch removed; header → `X-Target-Host` only on `debug_headers` opt-in host flag; XFP = `$scheme`; redirect uses `$request_uri` | fixed |
| L4 | theta-agent | full remote scripts + config payloads logged to journal | debug-level behind `verbose_logging` config flag (default off) | fixed |
| L5 | sso | `?token=` agent credential in WS URL → access-log exposure | documented (browser/agent constraint); README/DEPLOYMENT note added: strip query on logs; agent prefers `Authorization` header on dial when available | fixed (header support added; URL fallback kept for compat) |
| L6 | sso | sync `appendFileSync('/var/lib/ldap/oauth.log')` on token path; `api_token.js` sync last_used write | both moved to fire-and-forget async append with error log | fixed |
| L7 | jump-host | `metrics.js` KEYS pattern `host_*` swallows `host_last_*` epoch values into top-10 | pattern `host_c*` + explicit exclusion; KEYS→SCAN | fixed |
| L8 | jump-host | bootstrap strips `app_super_admin` from gateway `adminGroups` while base.js + SSO treat it as the cross-app super group | `writeJumpSecrets` keeps `['app_sso_admin','app_super_admin']` | fixed |
| L9 | ldap-client | README claims "sudo via LDAP groups" (never wired); registration prints success on HTTP errors | README corrected to match reality; error check per M33 | fixed |
| L10 | sso | `addLdapUser` TypeError on empty `givenName`; `User.list` ignores `userNameAttribute` | guard + attribute honored | fixed |

## Design gaps — documented, deliberately NOT patched

| ID | Area | Why deferred |
|----|------|--------------|
| D1 | sso OIDC: HS256 shared-secret ID tokens, no `jwks_uri`, no `nonce` threading | RS256 + JWKS + nonce is a wire-format migration across proxy/jump-host clients; needs a release coordinated through all three repos. Current mitigations: mandatory PKCE, opaque access tokens server-side. |
| D2 | signed agent command replay: nonce/timestamp envelope | Needs wire change in agent + server + stored-key rollout ordering; `type` binding (H7) removed the cross-command portability; replay of an identical frame remains possible. Recommend `ts` field + agent-side 24h window next minor. |
| D3 | Vault auto-unseal (file storage ⇒ sealed after reboot; fail-soft apps mask it) | Transit/auto-unseal or systemd boot integration is an architecture choice; M5 leaves unseal key in `.env` (now 0600). Documented in docs/secrets.md. |
| D4 | jump-host Vault SSH-certificate path (`/api/vault/ssh/sign`) is unreachable: no Bao policy grants it | Needs OpenBao PKI engine role provisioning in setup.sh; currently opt-in and inert. Documented in jump-host README. |
| D5 | scoped LDAP sudo (replace ALL/ALL) | Needs native sudoRole schema + directory UI support; ALL/ALL stamping removed (H12) so enabling the responder later is safe. |
| D6 | proxy admin-session delivery via URL fragment (`/login#token=`) | Lives in vendored `@simpleworkjs/oidc-client`; upstream change. TTL+server-side logout (M12) bounds exposure. |

## Cross-component contracts (frozen for these fixes)

- **G-1 signature envelope**: `signature` = Ed25519 over `JSON.stringify(sortKeys({type, payload}))`
  where payload excludes `signature`; both `sso-manager-node/nodejs/utils/agent_manager.js` and
  `theta-agent/websocket.go verifySignature` implement identically.
- **G-2 join prev_token**: agent with a wiped enrollment persists `prev_auth_token` and sends it as
  `?prev_token=` on the join-key WS dial; server rotates **only** on exact match, else rejects
  (close 4001) when the hostname is already registered.
- **G-3 JUMP_SSH_PORT**: single source is `master.env`/CLI env → setup.sh exports it for the
  bootstrap exec (writes `ssh.listenPort`) **and** for install.sh (writes `app_ssh__listenPort`
  belt-and-braces). App precedence: env override > conf > 2222.
- **G-4 push-token forwarding**: `x-forwarded-mac` HMAC as H14; both sides use
  `sha256(pushToken, uid + "\n" + ts + "\n" + originalUrl)`, ±300 s.
- **G-5 slug rule**: `lower | [^a-z0-9]+ → "-" | trim "-"` (matches bootstrap.js `slugify`);
  group/resource naming authority is the directory; enrollment side must derive slugs itself.
