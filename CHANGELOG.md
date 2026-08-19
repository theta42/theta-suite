# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
correspond to git tags (`vX.Y.Z`). Entries here cover theta-suite's own
orchestration code; see each submodule's own `CHANGELOG.md`
([proxy](https://github.com/theta42/proxy/blob/master/CHANGELOG.md),
[theta-directory](https://github.com/theta42/theta-directory/blob/master/CHANGELOG.md),
[jump-host](https://github.com/theta42/jump-host/blob/master/CHANGELOG.md),
[theta-agent](https://github.com/theta42/theta-agent/blob/master/CHANGELOG.md))
for what changed inside the apps it composes.

## [v3.21.4] - 2026-08-19

  sso-manager-node  v2.24.2 -> v2.24.3

- **A fresh bootstrapped spoke can join a master again.** theta-directory
  v2.24.2's fresh-install guard rejected any directory holding OAuth clients
  or plugin instances, but the bootstrap seeds the stack's own `theta-proxy` /
  `theta-jump` OAuth clients and a `docker-local` discovery plugin on every
  install. A brand new spoke therefore always failed to join ("This directory
  already has users, agents, OAuth clients..."). v2.24.3 ignores those
  well-known bootstrap seeds and only refuses when operator-created clients or
  plugins are present. No orchestration changes in this repo.

## [v3.21.3] - 2026-08-19

  jump-host         v3.3.4  -> v3.3.5

- **jump-host install no longer aborts when `JUMP_HOST` is unset.** v3.3.4's
  `gateway.env` default `${JUMP_HOST}:${JUMP_WG_PORT:-51820}` referenced
  `JUMP_HOST` under `set -u`, so a first `setup.sh` on a host without that
  variable exported died with `JUMP_HOST: unbound variable` instead of
  finishing the install. v3.3.5 defaults to an empty endpoint (the site
  reaches out through the hub) when `JUMP_HOST` is unset. No orchestration
  changes in this repo.

## [v3.21.2] - 2026-08-19

  sso-manager-node  v2.24.1 -> v2.24.2
  jump-host         v3.3.3  -> v3.3.4
  theta-agent       v2.8.1  -> v2.8.2

- **OpenLDAP replication is converged live, so `setup.sh` no longer restarts
  `sso-manager` on topology changes.** theta-directory v2.24.2 applies
  ServerID, syncrepl peers, and mirrormode via `cn=config` at runtime. The
  `site-ldap-register.js` step still persists the static `ldap-replication.env`
  seed for the next cold start, but a new spoke joining, a promotion, or a
  re-registration no longer needs a container restart. `setup.sh` and
  `master.env.example` comments updated to reflect this.
- **URL validation in `bootstrap/site-join.js`.** Invalid `masterUrl` or
  `selfUrl` values now fail immediately instead of producing a confusing
  fetch error or a half-join. The "already a spoke" idempotent soft-success
  path now accepts both HTTP 400 and 409 from the directory.
- **`site-promote` instruction updated.** The response no longer tells the
  operator to re-run `setup.sh` for replication to take effect; it clarifies
  that live convergence handles it and a re-run only re-seeds the static file.
- **jump-host install script defaults `THETA_MESH_ENDPOINT`.**
  `install.sh` writes `THETA_MESH_ENDPOINT=${JUMP_HOST}:${JUMP_WG_PORT:-51820}`
  into the gateway env file instead of leaving it blank, so a site with a
  public hostname is dialable by peers without a manual edit.
- **theta-agent local-discovery improvements.** v2.8.2 adds a `local_discovery`
  toggle in `agent.yml` and only writes the managed `/etc/hosts` block when
  the discovered LAN IP actually differs from normal DNS resolution.

## [v3.21.1] - 2026-08-19

  sso-manager-node  v2.24.0 -> v2.24.1
  jump-host         v3.3.2  -> v3.3.3

Fixes three defects found on a live two-site deployment.

- **Both sites came up as master, and nothing said so.** Two stacked bugs:
  theta-directory v2.24.0 created `config/site.json` at boot on a node that had
  never joined anything (fixed in v2.24.1), and `setup.sh` treated the mere
  *existence* of that file as "this node is already a spoke" and skipped the
  join step. `site.json` is the node's general multi-site config — the app
  writes it for reasons unrelated to joining — so the guard now reads the ROLE
  out of it (`isMaster: false`) instead. Either half alone would still have
  broken this.
- **A spoke bring-up that does not actually join is now fatal.** After the join
  was skipped, `setup.sh` carried on and stood the node up as a fully
  independent master. It now verifies the join actually took before continuing,
  and refuses to bring a node up standalone when `spoke.env` is present but
  there is no join credential and no existing join. Silently becoming a second
  master is the one outcome this flow must never produce.
- **`JUMP_HOST` was derived by string surgery on `SSO_HOST`.**
  `jump.${SSO_HOST#sso.}` strips a *literal* `sso.` prefix, so an operator who
  sets `CFG_SSO_HOST=sso-master.suite.example.com` got
  `jump.sso-master.suite.example.com` — a name that does not resolve, with a
  dead `theta-proxy` Host record pointing at it. Now derived from
  `${CFG_PUBLIC_DOMAIN:-…}` the same way `SSO_HOST` and `PROXY_HOST` already
  are, falling back to dropping the first label of `SSO_HOST` on re-runs (where
  `CFG_PUBLIC_DOMAIN` is out of scope), which is correct for `sso.x.y` and
  `sso-master.x.y` alike.
- **jump-host's "WireGuard" nav item 404'd** since the mesh-v2 rewrite deleted
  that page in favour of `/mesh`. Fixed in jump-host v3.3.3, with a test that
  every nav href has a route and a view.

### Note for anyone who ran v3.21.0

A spoke that came up as a master this way also enrolled its own theta-agent
(step 7c), and the join guard refuses any directory that already has agents —
so re-running `setup.sh` will not rescue it even with this fix. Rebuild the
spoke, or remove its agent enrolment first, then re-run.

### Upgrading

An existing install whose jump host was registered under the old derived name
keeps a dead `theta-proxy` Host record for it; remove that record by hand if
you want it gone. Nothing removes proxy routes automatically.

## [v3.21.0] - 2026-08-18

  sso-manager-node  v2.23.3 -> v2.24.0

- **Multi-Site Correctness Pass.** The hub-and-spoke work shipped in v3.20.0 had a
  single root defect that disabled most of it, plus several independent ones found
  alongside it. See
  [theta-directory's changelog](https://github.com/theta42/theta-directory/blob/master/CHANGELOG.md)
  for the per-endpoint detail; the operator-visible summary:
  - **Live replication to spokes was dead.** The write proxy's path exemptions were
    written against `/api/...` but matched against the mount-relative path Express
    actually supplies, so nothing matched and the master's own resync ping was
    forwarded straight back to the master. Every spoke sat on its join-time
    snapshot.
  - **The WireGuard roster was being corrupted.** Each spoke gateway's
    `PUT /api/mesh/self` was forwarded to the master, where it overwrote the
    *master's* roster row with that spoke's key and endpoint.
  - **SSSD/agent auth could not work at a spoke.** `POST /api/v1/ldap/bind`,
    `/search` and `/api/v1/agent/secrets` were forwarded with the caller's token
    replaced by the cluster join key.
  - **A spoke's own directory tree emptied out.** Every resync deleted every local
    edge the master's export did not contain, and overwrote the spoke's own
    `sso-manager`/site records with the master's — including clearing its own
    `isCurrentSite`.
  - **A spoke could break itself on restart.** The export carried
    `secret/sso-manager/conf`, the master's own LDAP bind password and `jwtSecret`,
    which the spoke merged over its local config at next boot.
  - **A site join key could act as any user** on the master when paired with
    `X-Forwarded-User`; only per-spoke push tokens are accepted now.
- **`setup.sh`: one canonical spoke self-URL.** The join step used `http://` under
  `CFG_CREATE_ALL_HTTP=1` (the `spoke.env.example` default since v3.18.1) while the
  relay and LDAP-replication steps hardcoded `https://`. Since the master keys its
  spoke registry on that exact string, one site produced two registry rows, two LDAP
  ServerIDs and two push tokens, and `GET /api/site/ldap-peers` answered "this
  endpoint is not a registered spoke". `SPOKE_SELF_URL` is now derived once and
  reused; an address already recorded in `config/site.json` always wins.
- **`bootstrap/site-relay-register.js` goes through the local directory.** It used to
  POST the master's `/api/site/spokes` behind the app's back, which discarded the
  push token the master handed back, never updated `config/site.json`, and forked the
  registry whenever its endpoint string differed from the join's. It now calls this
  node's own `POST /api/site/reregister`.

- **The multi-site e2e now gates every PR.** `docker-compose.multisite-e2e.yml` (three real
  containers: master + two spokes, driving the actual operator HTTP flow) had never been
  in CI — `pr-tests.yml` ran jest only, which is how a defect this broad survived five
  releases. It now runs as its own job and blocks the merge gate. Two of its own
  assertions were stale in the same direction and were corrected.

### Upgrading an existing cluster

Re-run `./setup.sh` on the master first, then on each spoke. Two things worth
checking afterwards, because this release stops the damage but cannot infer what the
old code overwrote:

1. **Duplicate spoke rows.** Directory → Multi-Site → Registered Spokes. If a site
   appears twice (typically one `http://` and one `https://` row), remove the stale
   one; its LDAP ServerID is freed and the syncrepl entry is dropped automatically.
2. **Clobbered stack-service records.** On a spoke, check that `sso-manager` /
   `proxy` / `openldap` / `openresty` / `jump-host` still carry *that site's* address
   and that its own site resource still has "Current site" ticked. Where the old code
   replaced them with the master's values, correct them once in the Directory UI —
   from this release on they are marked locally-owned and replication leaves them
   alone.

## [v3.20.5] - 2026-08-17

- **Spoke Re-Run & Update Idempotency**:
  - `setup.sh` now detects existing `$CONFIG_DIR/site.json` and skips `site-join.js` on update re-runs.
  - `bootstrap/site-join.js` checks `/config/site.json` before attempting join and gracefully handles 409 responses if users/agents are already present from previous synchronization, preventing update crashes.

## [v3.20.4] - 2026-08-17

  sso-manager-node  v2.23.2 -> v2.23.3

- **Spoke Onboarding Synchronization & UI Flow**:
  - `spoke_write_proxy` middleware now synchronously syncs local `UserVerification` records and flushes `User.clearCache()` upon receiving successful response from Master on `/api/user/accept-tos`, `/api/user/password`, and `/api/user/:uid`.
  - Fixed `/onboarding` container visibility and added fresh `app.auth.loadUser(true)` state reloads upon completion of onboarding steps, preventing redirect loops between `/` and `/onboarding`.

## [v3.20.3] - 2026-08-17

- **Installer & Spoke Update Fix**:
  - Resolved `SITE_SLUG: unbound variable` crash during re-runs of `setup.sh` on spoke nodes by restoring `CFG_SITE_NAME` and `SITE_SLUG` from `./config/sso-secrets.js` when `ensure_config` returns early, and adding safe fallback handling.

## [v3.20.2] - 2026-08-17

  sso-manager-node  v2.23.1 -> v2.23.2

- **OpenLDAP Container Startup Fix**:
  - Removed duplicate `SERVER_ID_PLACEHOLDER` in `docker-entrypoint.sh` template that remained unreplaced when `LDAP_SERVER_ID` was set, resolving `slaptest` conversion failure during container boot.
  - Expose `/var/lib/ldap/slapd.log` directly to container stderr on startup failure so any OpenLDAP initialization issues are immediately visible in `docker logs`.

## [v3.20.1] - 2026-08-17

  sso-manager-node  v2.23.0 -> v2.23.1

- **Spoke Write Proxy Caller Resolution & Onboarding Fixes**:
  - `spoke_write_proxy` middleware now resolves the local session (`auth-token`) or Bearer PAT before proxying mutating API calls upstream to the Master, properly setting `X-Forwarded-User` and eliminating 401 Unauthorized errors during spoke onboarding (`POST /api/user/accept-tos`, `PUT /api/user/:uid`, `PUT /api/user/password`).
  - Added support for verifying spoke proxy requests via `SiteSpoke.pushToken` in addition to `SiteJoinKey`.
  - Added cluster-wide synchronization for `UserVerification` records so TOS acceptance and onboarding statuses sync across all nodes.

## [v3.20.0] - 2026-08-17

  sso-manager-node  v2.22.2 -> v2.23.0

- **Multi-Site Architecture: Pragmatic Hub & Spoke with Transparent Write-Forwarding**:
  - **Transparent Write-Forwarding**: Spoke nodes now transparently reverse-proxy mutating API write operations (`POST`, `PUT`, `PATCH`, `DELETE` on `/api/*`) upstream to the Master directory with full user context (`X-Forwarded-User`), client IP, and spoke site metadata. Reads serve locally at edge cache speed.
  - **Offline Resilience**: If the Master is unreachable during a write operation, the spoke cleanly returns HTTP 503 indicating read-only offline mode, while local reads, SSSD auth, and DNS continue uninterrupted.
  - **OpenBao Shared Secrets Sync**: `POST /api/site/export` dumps shared integration credentials (`secret/integrations/*`), plugin configs, and resource secrets from OpenBao; spokes deep-merge them into their local OpenBao vault via `@simpleworkjs/bao-conf` for complete disaster recovery parity.
  - **Enrolled Agent Fleet Replication**: Enrolled `Agent` records replicate from Master to Spokes, providing cluster-wide fleet visibility across all nodes.
  - **Spoke Identity & Master Directory Auto-Provisioning**: Spoke joins preserve their own unique `siteSlug`, and the master auto-provisions a `Resource` of `kind: 'site'` on spoke registration, ensuring the multi-site tree appears everywhere.
  - **OpenLDAP Multi-Master Replication (MMR) & TLS Handshake**: Always loads `syncprov` overlay for runtime dynamic replication; configured `tls_reqcert=never` on syncrepl connections to accept cluster self-signed TLS certificates.
  - **Installer & Configuration Updates**: `setup.sh` strictly enforces `CFG_SITE_NAME` on spokes; fixed HTTP vs HTTPS scheme propagation in `site-join.js`; removed legacy MMR comments from `spoke.env.example`.

## [v3.19.0] - 2026-08-14

  sso-manager-node  v2.22.1 -> v2.22.2
  jump-host         v3.3.1  -> v3.3.2
  proxy             v2.4.1  -> v2.4.2

- **Notification Upgrades & @simpleworkjs/frontend 0.4.2**:
  - Adopted `@simpleworkjs/frontend` 0.4.2 across all web interfaces (`sso-manager-node`, `proxy`, `jump-host`).
  - **In-App Live Toasts (`toast: true`)**: Real-time foreground toast notifications trigger when events arrive while actively working in a tab, ending silent badge-only updates.
  - **Rich Semantic Category Icons**: Renders distinct FontAwesome category icons and badges for Identity, Infrastructure, Security, Access Requests, and Mesh networks.
  - **Interactive Notification Dropdown**: Header controls for one-click "Mark all read" and "Clear list" history management.
- **Installer & Environment Enhancements (`setup.sh`)**:
  - Replaced hardcoded `sudo` calls with `$SUDO` for safe execution across custom sudo wrappers and root environments.
  - Added elapsed setup execution timer displayed in the final summary.
  - Optimized `jump-host/install.sh` to preserve existing `node_modules` during application tree updates, speeding re-runs to <1s.
  - Removed deprecated `migrate-ldap.sh`.
  - Hardened parameter passing in `bootstrap/seed-demo-users.sh`.

## [v3.18.1] - 2026-08-13

- `spoke.env.example`'s `CFG_CREATE_ALL_HTTP` now defaults to `1`
  (uncommented) instead of being an opt-in comment — a spoke typically sits
  behind the master's/an external ingress's TLS termination already, so
  serving its own proxy over plain HTTP internally is the common case for
  this file, not the exception `master.env.example` treats it as.

## [v3.18.0] - 2026-08-13

- **`setup.sh` runs two independent slow steps in parallel instead of
  serializing them.**
  - The three submodule updates (`sso-manager-node`, `proxy`, `jump-host`)
    each fetch tags and check out the latest release concurrently — three
    independent `.git` directories with no shared state, previously three
    sequential network round-trips.
  - `sso-manager` and `proxy`'s Docker images now build together
    (`docker compose build sso-manager proxy`, which compose already
    parallelizes) before either container starts, instead of building
    proxy's image only after sso-manager had already been built, started,
    health-checked, and bootstrapped. Proxy's real compose-level
    `depends_on: sso-manager: condition: service_healthy` (its own boot
    process reaches sso-manager) is untouched — only the *build* step,
    which needs neither container running, moved earlier. Caught and fixed
    a bug this surfaced along the way: `PROXY_GIT_COMMIT` (a build arg) used
    to be resolved right before proxy's old build step, which would have
    been too late once that build moved earlier — now resolved alongside
    `SSO_GIT_COMMIT`, before the combined build call.

## [v3.17.2] - 2026-08-13

- **theta-agent [v2.8.1](https://github.com/theta42/theta-agent/releases/tag/v2.8.1)** —
  fix: Windows release binaries are now actually Authenticode-signed.
  `release.yml`'s signing step had silently never run on any release —
  wrong runner OS (needs Windows, was `ubuntu-latest`), a renamed action
  (`azure/artifact-signing-action@v2`, was `trusted-signing-action`), and
  an `if:` guard checking a job `env` var that was never populated from the
  secret. Fixed and verified against the real published `v2.8.1` release
  asset (`theta-agent-windows-amd64.exe` carries a 15,640-byte embedded
  Authenticode signature, `CN="THETA 42, INC."`), not just an isolated test.

## [v3.17.1] - 2026-08-13

- **theta-directory [v2.22.1](https://github.com/theta42/theta-directory/releases/tag/v2.22.1)** —
  fix: the `ilo` plugin (v2.22.0, previous release) reported `kind: 'host'`
  with the iLO's own out-of-band management address, so the generic
  discovery reconciler could merge it into the actual server's own host
  resource (discovered separately via theta-agent/Proxmox) and have one
  side's real address silently overwritten by the other's. `ilo` now
  reports `kind: 'bmc'` (structurally un-mergeable with a `host` resource)
  and links to the server explicitly via a new optional `hostSlug` config
  field, same pattern as the `docker` plugin's `hostSlug`.

## [v3.17.0] - 2026-08-13

- **theta-directory [v2.22.0](https://github.com/theta42/theta-directory/releases/tag/v2.22.0)** —
  feat: HP iLO discovery + power control. A new `ilo` discovery plugin
  (Redfish-based) pulls a physical server's model, serial, firmware,
  health, power state, and both the iLO management NIC's and the host OS's
  own NICs' MAC/IP from one iLO endpoint per server. Unlike most existing
  subtype drivers (still fixed sample-data stubs), the new `ilo` driver is
  fully real: live power/health polling and real power-control actions
  (power on / graceful reboot / force restart / graceful shutdown / force
  off) via Redfish's `ComputerSystem.Reset`, with one-click buttons in the
  resource modal.

## [v3.16.0] - 2026-08-13

- **theta-directory [v2.21.1](https://github.com/theta42/theta-directory/releases/tag/v2.21.1)**,
  **proxy [v2.4.1](https://github.com/theta42/proxy/releases/tag/v2.4.1)**,
  **jump-host [v3.3.1](https://github.com/theta42/jump-host/releases/tag/v3.3.1)** —
  fix: clicking "Run Import" on the LDIF import page threw an uncaught
  exception instead of showing the confirmation dialog.
  `app.messages.confirm(message, null, type)` — the form used by any page
  with no inline `.actionMessage` element, `ldif_import.ejs` among them —
  called `.closest()` on the null target inside
  [`@simpleworkjs/frontend`](https://github.com/simpleworkjs/frontend)'s
  `renderActionHtml`. `confirm()` also had no toast fallback at all for
  that case (unlike `action()`) — it just warned to the console and left
  its promise pending forever, which would have made the button look
  broken even after the crash itself was fixed. Bumped to
  `@simpleworkjs/frontend` v0.4.1 across all three apps that vendor it.

## [v3.15.0] - 2026-08-13

- **theta-agent [v2.8.0](https://github.com/theta42/theta-agent/releases/tag/v2.8.0)** —
  `theta-agent discover` lists theta-suite sites announced on the local
  network (site slug, directory URL, version) — read-only, never acted on by
  the agent itself. `install.sh` now auto-fills `--url` from it when
  `--join-key` is given without one, but only when exactly one site is
  found on the LAN; ambiguity or nothing found still requires the operator
  to be explicit. Deliberately scoped to a fresh, unenrolled agent only —
  see `docs/AGENT_LOCAL_DISCOVERY_SPEC.md` for why "roaming" (an
  already-enrolled agent auto-switching directories) is a separate, harder
  problem left unbuilt.

## [v3.14.0] - 2026-08-13

- **jump-host [v3.3.0](https://github.com/theta42/jump-host/releases/tag/v3.3.0)**
  and **theta-agent [v2.7.0](https://github.com/theta42/theta-agent/releases/tag/v2.7.0)** —
  fix: mDNS local-discovery could announce/route to a Docker bridge IP
  (e.g. `172.18.0.1`) instead of the real LAN address, reproduced live: a
  theta-agent found its directory "announced locally at 172.18.0.1" and
  failed to pin a route to it. `bonjour-service` (the announcer, running
  inside `theta-gateway` on the host) builds address records from *every*
  local interface with no filtering, so on a host that also runs Docker the
  response could resolve to a bridge gateway address instead of the real
  LAN IP. jump-host now patches the published service's records to drop
  virtual/bridge interfaces, and adds explicit `directoryHost`/
  `directoryAddr`/`version` TXT fields computed from the same filtered
  interface list; theta-agent prefers `directoryAddr` over the raw mDNS
  response address when present.
- **theta-directory [v2.21.0](https://github.com/theta42/theta-directory/releases/tag/v2.21.0)** —
  `POST /api/site/ping` now reports `baseDn`, the master-side half of the
  `spoke.env` self-sufficiency change below.

## [v3.13.0] - 2026-08-13

- **Split `setup.env` into mutually exclusive `master.env` / `spoke.env`.**
  `setup.sh` now requires exactly one of the two to exist — dies with a
  clear message on both or neither, auto-migrating a pre-existing
  `setup.env` to `master.env` transparently. `spoke.env` is now fully
  self-sufficient: no `CFG_DOMAIN` — it's fetched automatically from the
  master (`POST /api/site/ping`, theta-directory v2.21.0 above) using the
  join key alone, before any local bootstrap happens. A spoke previously had
  to separately create `setup.env` just to hand-type `CFG_DOMAIN` — a value
  that must byte-for-byte match the master's LDAP base DN, so a mismatch
  didn't surface until after a full local bootstrap (containers built,
  secrets generated), deep inside the LDAP import. A bad/unreachable join
  key now fails in the first second instead of at the end.

## [v3.12.1] - 2026-08-13

- **theta-agent [v2.6.1](https://github.com/theta42/theta-agent/releases/tag/v2.6.1)** —
  fix: a host's reported IP could be a Docker/Podman bridge address instead
  of its real LAN IP. `net.InterfaceAddrs()` mixed every interface together
  with no filtering, so `docker0`/`br-*`/`veth*`/`podman0`/etc. bridge
  addresses could land at `ip_addresses[0]` — which the Directory takes as
  the host's address. Interfaces matching known container/VM bridge prefixes
  are now skipped when collecting IPs.

## [v3.12.0] - 2026-08-13

- **theta-directory [v2.20.0](https://github.com/theta42/theta-directory/releases/tag/v2.20.0)** —
  service subtype registration, per-service metrics, live service UI. Directory-side
  counterpart to theta-agent v2.6.0 ([v3.11.0](#v3110---2026-08-13)).

  - **Register and monitor services of many types.** The Directory now
    reconciles the services an agent registers (`register <type> <name>` for
    systemd, docker, podman, process, systemd-timer, cron, lxc, kvm/libvirt)
    into `service` child resources under the host, keyed by a generic
    `serviceName` + `subType`. Legacy `systemdService`/`dockerContainer`
    resources are backfilled so they keep reconciling in place.
  - **Per-service live metrics.** The theta-agent driver surfaces each
    service's active state, CPU%, memory, restart count and uptime, plus
    schedule fields (`next_run`, `last_run`, `triggered_count`) for
    timers/cron and VM `status` for lxc/kvm.
  - **Live service status in the UI.** A service resource's edit modal now
    shows a live "Status & metrics" card (active badge, CPU/mem/restarts/uptime,
    schedule or VM state) that re-renders on every `agent.telemetry` WebSocket
    frame, so the panel updates in near-real-time while open.
  - `register_service`/`unregister_service` agent WebSocket frames are handled
    and acknowledged with a response.

## [v3.11.0] - 2026-08-13

- **theta-agent [v2.6.0](https://github.com/theta42/theta-agent/releases/tag/v2.6.0)** —
  register and monitor services of many types.

  ### Added
  - **Register and monitor services of many types.** `theta-agent register
    <type> <name>` / `theta-agent unregister <type> <name>` now supports
    `systemd`, `docker`, `podman`, `process`, `systemd-timer`, `cron`, `lxc`,
    and `kvm`/`libvirt`. The agent persists each registration in `agent.yml`
    (with its subtype), reports per-service status and resource usage in the
    30s telemetry stream, and pushes a signed
    `register_service`/`unregister_service` frame over the agent WebSocket so
    the directory creates or removes the child service resource under the
    host immediately.
  - **Per-service rich metrics.** The telemetry `services` array now carries
    CPU%, memory, restart count and uptime for each registered service, plus
    schedule-aware fields (`next_run`, `last_run`, `triggered_count`) for
    `systemd-timer` and `cron`, and VM `status` for `lxc`/`kvm`/`libvirt`.
  - **Cron schedule parser.** A real five-field cron parser (`*`, lists,
    ranges, steps, named tokens `JAN`/`SUN`, and the day-of-month/day-of-week
    OR rule) computes next/last fire times instead of only reporting
    "configured".
  - **`process` subtype reads `/proc` directly** — no external tool — so any
    process not under an init system can be tracked.
  - **Shell tab-completion** for every service type (bash + zsh), installed by
    `install.sh` or `theta-agent install-completions`; `completions/` scripts
    are shipped as release artifacts.

  ### Changed
  - `agent.yml` `services:` entries may be written as objects
    (`- name: nginx` / `subtype: systemd`); the plain scalar form still loads
    (treated as `systemd`) for backwards compatibility.

## [v3.10.0] - 2026-08-13

- **proxy [v2.4.0](https://github.com/theta42/proxy/releases/tag/v2.4.0)** —
  fix: wildcard renewal was hardcoded to "within 30 days of expiry", a third of
  a 90-day certificate. Let's Encrypt now issues 6-day certificates and the
  CA/B Forum has voted maximum validity down toward ~47 days; against a 47-day
  cert that rule renewed at two weeks old, and against a 6-day cert it was true
  on *every* daily check, reissuing forever into the duplicate-certificate rate
  limit. Renewal is now a fraction of the certificate's own lifetime, read from
  its `notBefore`/`notAfter`. Also fixes two unawaited calls in the same path
  that made a failed renewal an unhandled rejection and let one host's failure
  end the renewal loop for every other host.

## [v3.9.1] - 2026-08-13

- **proxy [v2.3.2](https://github.com/theta42/proxy/releases/tag/v2.3.2)** —
  fix: the error log filled with an OCSP stapling error on every TLS handshake.
  Let's Encrypt has wound OCSP down, so the certificates it issues carry no OCSP
  responder URI and auto-ssl's lookup cannot succeed for any of them — ever.
  auto-ssl logs that at `ngx.ERR` by default, once per handshake per host, and
  says "continuing anyway" because the handshake is genuinely fine. The flood is
  the damage: a real error is buried under thousands of copies of a benign one,
  which is exactly what happened while debugging an unrelated routing fault.
  Logged at `ngx.WARN` now.

## [v3.9.0] - 2026-08-12

Submodule roll-up: the notification bell broke the nav bar in all three apps.

- **proxy [v2.3.1](https://github.com/theta42/proxy/releases/tag/v2.3.1)** —
  fix: the container holding username / bell / Log Out is `.form-inline`, a
  Bootstrap 4 class Bootstrap 5 removed. It laid out as a row only because every
  child happened to be an inline element; the bell has to be a
  `<div class="dropdown">` (Bootstrap requires it), so it forced a line break
  and pushed Log Out onto a third row. Replaced with `d-flex align-items-center`,
  which is how Bootstrap 5 makes a row and does not depend on what the children
  are.
- **theta-directory [v2.19.1](https://github.com/theta42/theta-directory/releases/tag/v2.19.1)** —
  fix: same nav-bar break, same cause; all three shells carry identical markup.
- **jump-host [v3.2.1](https://github.com/theta42/jump-host/releases/tag/v3.2.1)** —
  fix: same nav-bar break, same cause.

## [v3.8.1] - 2026-08-12

- fix: **the jump host's web UI 502'd on every clean install.** setup.sh
  registered the gateway with the proxy as `host.docker.internal`, a name that
  `extra_hosts: host-gateway` puts in the container's `/etc/hosts` and nowhere
  else. Docker's embedded DNS does not serve `extra_hosts` entries, nginx does
  not read `/etc/hosts`, and the proxy's `proxy_pass` uses variables — so nginx
  resolves the target per request through `resolver 127.0.0.11` and NXDOMAINs.
  The failure is unusually misleading: `getent`, `curl` and `ping` inside the
  proxy container all find the name, and `curl
  http://host.docker.internal:3002/health` returns 200, because every one of
  those reads `/etc/hosts`. Only the process that matters cannot see it.
  Regressed in v3.1.0, when the gateway left the compose stack: until then the
  target was `jump-host`, a real container name the embedded DNS answered.
  setup.sh now resolves the gateway to an address once and registers that, and
  a re-run updates a record pointing elsewhere — so an install left broken by an
  older setup.sh heals itself rather than being skipped as "already exists".

## [v3.8.0] - 2026-08-12

  jump-host  v3.1.6 -> v3.2.0
  proxy  v2.2.0 -> v2.3.0
  sso-manager-node  v2.18.0 -> v2.19.0
  theta-agent  v2.5.0 -> v2.5.1

**Notifications across the suite**, and the last of the live-update rollout.

Every model event you are allowed to see is a notification. That is the whole
design: a notification system's hard problem is "who should see this", and the
socket read gate already answers it — live, per row, every time an event goes
out. So there is no recipient resolution and no fan-out table. A notification is
an event that reached you, and history is those same events replayed through the
same gate. Clicking one opens the record that changed.

History stores the **shape** only — model, action, pk, actor, owner, timestamp —
never the payload, so it does not become a second copy of your data retaining a
deleted record's contents after it is gone. Unread is one watermark per user
rather than a read flag per item, so opening the bell on one device clears the
badge on all of them. A later compliance/audit trail extends this rather than
replaces it: what it adds is before/after values and immutability, not a
different shape.

Collapsing is not cosmetic. Creating one directory resource emits eleven events
— the resource, its groups, its edges — and a discovery sweep emits hundreds.
The feed says "11 resource groups added"; history keeps every row.

- **jump-host** pushed nothing over its socket before; it was attached only so
  the shared front-end kept working. Everything there arrives *with* its read
  gate rather than after one. Its event stream is the SSH audit trail — who
  connected to which host, announced on the attempt and again when the session
  ends and its success and byte counts are known.
- **theta-agent v2.5.1** brings the suite's pin back onto the mainline. The
  agent repo's history was rewritten to prune its size, and the previous pin
  (v2.5.0) survived only via its tag, off the rewritten `master`.
- The notification client now ships in `@simpleworkjs/frontend` 0.4.0 rather
  than a copy in each app; each app supplies only which page a given kind of
  notification opens. `@simpleworkjs/backend` 0.3.0 carries the server half, so
  a framework-native app gets the feed with no code of its own.

## [v3.7.0] - 2026-08-12

  proxy  v2.1.1 -> v2.2.0
  sso-manager-node  v2.17.0 -> v2.18.0

Four more views stop lying about the current state.

- feat: **the proxy's Profile page updates itself.** Your own record and your
  own API tokens both sat static until a reload, because `User` and `ApiToken`
  never published — only `Host` was ever exported wrapped. This is the page
  where staleness misleads most: it is the one showing you your own access, so
  an admin changing your groups left you reading the old answer indefinitely.
- feat: **a model can narrow which of its writes announce themselves.**
  `ApiToken` announces create and remove only: its best-effort `last_used_on`
  write happens on every authenticated API call, and announcing that would put
  an event on the socket per request. Previously the choice was all-or-nothing,
  which is why it published nothing at all.
- feat: **the Directory's Catalog and Discovered Inventory views update
  themselves.** Both read models that already published and were already gated;
  neither subscribed. The case that matters: an admin approves your access
  request while the tile you are looking at still tells you that you cannot get
  in.
- fix: `User` and `ApiToken` hit the same export trap as `LocalGroup` and
  `Permission` before them — registering a wrapped model only makes the wrapper
  reachable through the model registry, and the routes import those files
  directly. Three models deep now; worth a lint rule.
- security: both new gates are row-level rather than model-level. `User` is
  admin-or-self; `ApiToken` is owner-scoped with **no admin bypass**, matching a
  REST route that has none either — a personal access token is nobody else's
  business. Verified against the serialized socket frame: a PAT create carries
  no `secret_hash`, a user create carries no password field.

## [v3.6.1] - 2026-08-12

  proxy  v2.1.0 -> v2.1.1
  jump-host  v3.1.5 -> v3.1.6

- fix: **filtered rows carrying a Bootstrap display utility were never actually
  hidden** in the proxy. jQuery's `.hide()` writes a plain inline
  `display: none`, which loses to `.d-flex` / `.d-block` / `.d-grid` because
  those are `!important` in Bootstrap's stylesheet. The Permissions list and the
  Dynamic A records list are both built from `list-group-item d-flex` rows, so
  their search reported the right count while every row stayed on screen. Also
  fixes the filter count going stale after a row arrived live ("6 of 4 shown").
  Both come from `@simpleworkjs/frontend` 0.3.1, now on all three apps.

## [v3.6.0] - 2026-08-12

  sso-manager-node  v2.16.1 -> v2.17.0

- feat: **the Network and Overview tabs update themselves.** Network's three
  models already published and already carried socket read gates — the view
  simply never subscribed. Overview's notification history follows
  `Notification`, and its stats card follows `User` and `Resource` rather than
  inventing a "stats" record to publish: the aggregate is derived, and the
  things it derives from already announce themselves. Each list and panel
  reloads only its own fetch, debounced.
- feat: Redis-backed models can announce their own writes. `Notification` and
  `ApiToken` have no custom mutators, so `withEvents()` wraps create/update/
  remove on the class — deliberately not a Proxy over the class, which is the
  approach that published the *class* name as the primary key for every model
  keyed on `name`.
- fix: `ApiToken` payloads carry no `secret_hash` — asserted against the
  serialized payload rather than the object, since a key is "in" an object even
  when its value is undefined.
- note: the Overview metrics panel is **not** live. It reads failed-login and
  service-usage counters incremented outside any model write, so no model event
  corresponds to them; that panel needs its own emit where the counters change.
- chore: `@simpleworkjs/frontend` 0.3.1 across all three apps — filtered rows
  carrying a Bootstrap `d-flex`/`d-block`/`d-grid` class are actually hidden
  now, and the filter count no longer goes stale.

## [v3.5.1] - 2026-08-12

  sso-manager-node  v2.16.0 -> v2.16.1

- security: **the theta-agent pushes went to every authenticated socket.**
  `agent.telemetry` (CPU/RAM/disk per host), `agent.discovery` (host inventory:
  open ports, services) and `agent.response` — **the output of commands run on a
  host** — were sent with a bare `app.io.emit`, with no read check of any kind.
  The agent channel can run arbitrary bash, and its results were reaching every
  logged-in user regardless of whether they may see the host. This is the same
  defect fixed for model events in v3.3.0, on a channel that was missed because
  it does not carry model events — and the Directory page consumes two of these
  on a dedicated socket precisely to bypass the gated one, so the leak had a live
  consumer. All three now apply the same per-socket check as model events,
  against the same admin groups the agent REST routes already require, and
  channels are fail-closed: one with no gate is not delivered at all.

## [v3.5.0] - 2026-08-12

  sso-manager-node  v2.15.0 -> v2.16.0

**Storage backend no longer decides whether a page can update itself.**

- feat: model events are standardized. The ORM announced changes for models it
  managed; everything else was silent, so LDAP groups and users, Redis-backed
  notifications and PATs could not update a view no matter what the view did.
  They now publish the identical contract — `model:<Name>:<action>` carrying
  `{model, action, pk, data}` — so a subscriber cannot tell which backend a
  model uses. `data` goes through `toJSON()` (stripping `isPrivate` fields) and a
  delete never carries a body, enforced in the emitter rather than trusted to
  each call site. ORM and bespoke models share one filtered bus, so "does this
  model have a read gate?" is answered in exactly one place.
- feat: LDAP groups and users announce create/update/delete, and the users and
  profile views consume them — a user added, or a group membership changed, by
  another admin now shows up without a refresh. That includes someone's own
  profile, where a stale page is most misleading, since it is showing them their
  own access.
- security: read gates for every model whose data the UI renders. Several are
  row-level rather than merely model-level: a user receives their own User
  record, notifications, PATs and mesh clients and nobody else's, while a
  directory admin receives all of them except PATs — which have no admin path
  because the REST route has none either.
- security: User payloads strip `userPassword` explicitly. It IS present on a
  record read with `attributes: ['*','+']` as the admin bind, and stayed off the
  wire only because `user_parse()` sets it to `undefined` inside an `if` branch —
  an incidental protection in an unrelated function, not somewhere to hang a
  credential. Verified against the encoded socket frame, not just the object.

## [v3.4.0] - 2026-08-12

  sso-manager-node  v2.14.0 -> v2.15.0

**The Directory updates itself now too.** v3.3.0 secured this app's socket
bridge and left it carrying nothing; this wires it up. Two more reasons nothing
auto-updated, both in sso-manager-node:

- fix: **the socket never connected at all.** `authIO` called
  `Auth.checkToken(tok)` with a bare string where `{token}` is expected, then
  called `token.getUser()` — but `checkToken` returns the User itself and has no
  such method. Every handshake failed with `token.getUser is not a function`, so
  no client in this app has ever had a working socket.
- fix: **nothing published.** `@simpleworkjs/orm` has a `pubsub` hook that emits
  `model:<Name>:<action>` on save/delete, and it was never wired. It is now,
  through a filter that forwards only models carrying a socket read gate — the
  ORM publishes for everything it loads, and that includes `AuthToken`,
  `OtpToken` and `PasswordResetToken`, written on every login and password
  reset.
- feat: the Directory and Discovery Plugins views update themselves. A resource
  added, renamed or removed by another admin, or by a discovery plugin run, now
  appears without a refresh. The Directory table is derived (hierarchy from the
  edge list, agent status from another service, indentation recomputed on
  render), so a change re-derives the view rather than patching one row — which
  would leave a new child at the wrong depth with no caret on its parent. The
  operator's search/sort/secrets filter survives the reload.
- security: `READERS` is the single source of truth for what goes live: a model
  listed there both publishes and is authorized there, so the two cannot drift.
  `Resource`, `ResourceGroup` and `PluginInstance` are gated to the same admin
  groups that guard their REST routes, resolved transitively from LDAP and
  cached briefly per socket. Verified with two sockets side by side: a directory
  admin receives the events, an ordinary user receives nothing.

jump-host is unchanged and stays at v3.1.5: it has one `jq-repeat` list (a
user's own API tokens), no pubsub controller, and attaches socket.io only to
serve the client library — there is nothing there worth a publisher and gate.

## [v3.3.0] - 2026-08-12

  jump-host  v3.1.4 -> v3.1.5
  proxy  v2.0.1 -> v2.1.0
  sso-manager-node  v2.13.0 -> v2.14.0

**Every list in the proxy updates itself now, and every list can be filtered.**
Nothing in the suite auto-updated except one table, and the reasons turned out
to be two bugs rather than a missing feature. Fixing them also closed a data
leak on the socket bridge shared by all three apps.

### proxy v2.1.0

- feat: **every list is live and filterable.** Hosts, Permissions, Groups, DNS
  providers and Dynamic A records use `app.filter.live()` from
  `@simpleworkjs/frontend`: a change made by another admin, or by a background
  job, patches the one affected row in place — so scroll position, checkbox
  selection and open dropdowns survive it. Each list gains a search box and a
  "shown" count; Hosts also gains a wildcard/single facet, and its search now
  covers IP, port and DNS provider rather than the hostname alone.
- fix: **only the Proxy List ever updated itself, because only `Host`
  published events.** Every model registers a `ModelPs` proxy, but only
  `host.js` *exported* it — the others exported the raw class, and the routes
  import those files directly. `LocalGroup` and `Permission` published nothing
  at all, so those pages were subscribed to events that were never sent.
- fix: **`ModelPs` published the class name as the primary key.** `getIndex()`
  read `model[Model._key]` with `model` being the class on a static call, and
  every class has a built-in `.name` — so for any model keyed on `name`, the pk
  of every event was the literal string `"LocalGroup"`. Creates appended a row
  matching nothing; updates would have duplicated the record. `Host` behaved
  only because its key is `host` and `Host.host` is undefined.
- fix: the DNS and Permissions lists declared `jq-repeat-index` where
  `jq-index-key` was meant. The former is an attribute jq-repeat *writes* onto
  rendered rows and never reads as configuration, so those scopes had no key
  and every `remove`/`update` lookup returned -1 — swallowed on the DNS page by
  empty `catch{}` blocks, which made it look wired up while doing nothing.
- security: **model events were broadcast to every authenticated socket.**
  `app.io.emit` sent every event, with its full record, to every connected
  client with no per-model or per-row read check — a viewer scoped to one
  domain received live payloads for every other domain in the install. Events
  are now gated per socket by `utils/socket_pubsub.js`, mirroring the REST read
  guards, with resolved rights cached briefly and busted when a grant or group
  membership changes. Models with no gate are not broadcast at all, so a new
  model must opt in deliberately rather than start leaking the moment it is
  wrapped in `ModelPs`.
- security: **clients could inject topics.** `socket.on('P2PSub')` republished
  anything a client emitted to every other client. No app code has ever called
  `app.publish()`, so nothing legitimate used it; events now flow
  server -> client only.
- fix: a delete event carries a `null` body, and the client tagged it
  unconditionally — throwing and killing the socket handler.

### sso-manager-node v2.14.0

- security: **the socket bridge rebroadcast whatever a client published.**
  `socket.on('P2PSub')` took any topic and payload an authenticated client
  emitted and fanned it out to every other connected client. Nothing
  legitimate used it. Events now flow server -> client only.
- security: the outbound side was an unconditional `app.io.emit` of every event
  to every authenticated socket. Nothing here publishes model events yet, so it
  carried no traffic — but it would have started leaking the moment anything
  did. Replaced by `utils/socket_pubsub.js`, a per-socket read gate whose
  `READERS` table is **empty by design**: nothing is broadcast until a model
  opts in together with the check that decides who may see its events.
- fix: a `null` delete body killed the client socket handler.
- feat: the shared UI shell loads `app.sync.js` and `app.filter.js`, so views
  here can adopt live updates and filtering.
- chore: `authIO` records the session's groups on the socket, which is what a
  read gate resolves rights from.

### jump-host v3.1.5

- feat: the shared UI shell loads `app.sync.js` and `app.filter.js`.
- chore: removed the client-side publish forwarding from `app-base.js`. This
  app attaches socket.io only to serve the client library, so there was no
  bridge to secure here — but the code was dead weight, and its twin in the
  other two apps was the injection path described above.
- fix: a `null` delete body killed the client socket handler.

### Framework

Requires `@simpleworkjs/frontend` >= 0.3.0 (`app.sync.bind()` and
`app.filter`); 0.3.1 adds three fixes found by driving 0.3.0 in a browser —
rows carrying a Bootstrap `d-flex`/`d-block`/`d-grid` class were never actually
hidden (jQuery's `.hide()` writes a non-important inline style, which loses to
those `!important` utilities), a stale filter count, and pk precedence. The
apps depend on `^0.3.0`, which 0.3.1 satisfies, so a routine `npm install`
picks it up.

## [v3.2.0] - 2026-08-12

  jump-host  v3.1.3 -> v3.1.4
  sso-manager-node  v2.12.0 -> v2.13.0
  theta-agent  v2.4.0 -> v2.5.0

- fix: **the host gateway's LDAP and OIDC config pointed at Docker service
  names that no longer resolve.** The gateway runs on the host now, but
  `bootstrap.js` wrote `ldaps://sso-manager:636` /
  `http://sso-manager:3001` (and OIDC token/userinfo endpoints) into
  `jump-secrets.js` — every SSH login and the web SSO login rejected because
  `getUser()`/`checkPassword()` never reached slapd. It now writes loopback
  URLs (`ldaps://127.0.0.1:636`, `http://127.0.0.1:3001`), matching how
  `install.sh` reaches the stack. **Existing installs must regenerate
  `jump-secrets.js`** (`jumpFileComplete()` keeps the old file).
- fix: **no-inbound relay registration dialed a removed compose service.**
  `site-relay-register.js` used `http://jump-host:3002`, which doesn't exist
  since the gateway left the compose stack — `CFG_SPOKE_NO_INBOUND` could
  never register a relay. It now uses `JUMP_INTERNAL_URL` (or
  `http://host.docker.internal:3002`).
- fix: **the Multi-Site modal's gateway-mesh count 404'd.** It called the
  deleted `GET /api/mesh/gateways`; the count is now computed locally from the
  `MeshSite` roster (sso-manager-node v2.13.0). Also dropped the stale
  `integrations/theta-jump` OpenBao token instructions from `setup.env.example`.
- fix: **mesh API authz tightened** (sso-manager-node v2.13.0): `PUT /api/mesh/self`
  and `GET /api/mesh/peers` + `/site-clients` are admin-gated, and `/roster`
  scrubs WireGuard keys/endpoints for non-admins — a low-privilege user can no
  longer clobber a site's network identity or enumerate the whole mesh.
- fix: **the gateway's Redis config is actually loaded now** (jump-host v3.1.4)
  — a systemd drop-in points `redis-server` at the loopback config, so the
  WireGuard identity/sessions persist to `/var/lib/theta-gateway/redis`.
- fix: **gateway reconcile is serialized and exit rules are diffed**
  (jump-host v3.1.4) — no more overlapping-pass races stacking duplicate
  `ip rule`s, no 60-second exit-routing blip, and operator rules in the
  priority range are left alone.
- fix: **re-running the theta-agent installer with a new join key no longer
  drops it** (theta-agent v2.5.0), and the **Linux tray companion ships for
  the first time** (release workflow now builds `theta-agent-tray-linux-*`).
- docs: rewrote the container-era mesh sections in `MULTI_SITE_SPEC.md`,
  `architecture.md`, `README.md`, and jump-host's `DEPLOYMENT.md` /
  `docs/installation.md` for the roster-driven host-installed gateway.

---

## [v3.1.3] - 2026-08-12

  jump-host  v3.1.2 -> v3.1.3

- fix: **the host gateway's `VAULT_TOKEN` was always empty.** `setup.sh`
  minted `JUMP_VAULT_TOKEN` into `./.env` via `ensure_token` but never
  exported it, so the gateway env got `VAULT_TOKEN=` and never read
  `secret/jump-host/conf` from OpenBao, booting from the file-loaded fallback
  instead. It now reads the token back out of `./.env` and writes it into
  `/etc/theta-gateway/gateway.env`.
- fix: **the mDNS local-discovery announcer was inert in any stock
  deployment.** `THETA_LOCAL_DISCOVERY_HOSTS` and `SITE_SLUG` were never set,
  so the gateway's `mdns_announce` logged "nothing to announce, skipping".
  `setup.sh` now sets both in the gateway env — defaulting to this site's SSO,
  proxy and jump hostnames, with `CFG_LOCAL_DISCOVERY_HOSTS` to override or
  set empty to disable — so LAN-local theta-agents can skip the relay.
- fix: **upgrading a live gateway no longer fails its port check.**
  (jump-host v3.1.3) `install.sh`'s `ss -lntp` conflict check could not tell
  the gateway's own SSH front door from an unrelated process; it now only
  fails when somebody other than the active `theta-gateway` service owns the
  port.

---

## [v3.1.2] - 2026-08-12

  jump-host  v3.1.1 -> v3.1.2

- fix: **exit routing rules read back in the form they were added.** The kernel
  drops the prefix on a host rule — one added as `from 10.2.128.1/32` prints as
  `from 10.2.128.1` — so comparing installed rules against intended ones showed
  a mismatch that was not real.
- test: **the three-site end-to-end suite now checks that exits are APPLIED,
  not planned.** Its exit assertions read the planner's output, which is why
  they passed while the exit configuration was never reached at all. They now
  read the live WireGuard device and the kernel's own routing rules, and wait
  for the exit tunnel to complete a handshake under its separate key — the
  thing that was genuinely broken when both interfaces shared one identity.

---

## [v3.1.1] - 2026-08-12

  jump-host  v3.1.0 -> v3.1.1

- fix: **a fresh host no longer needs Node installed beforehand.** Moving the
  gateway out of its container moved its runtime requirement onto the host, and
  v3.1.0 discovered that partway through — after the stack was already up.
  `jump-host/install.sh` now installs Node 22 from NodeSource on apt hosts
  (Debian and Ubuntu ship 18, below the engines floor);
  `THETA_SKIP_NODE_INSTALL=1` opts out.
- fix: **`setup.sh` checks for Node up front**, next to its docker and git
  checks, so a missing prerequisite is visible in the first ten seconds rather
  than ten minutes in.
- fix: **`sso_secrets_get` stopped hiding a missing runtime.** Both helpers
  shell out to `node` and swallowed failures, so on a host without it they
  returned empty — and an empty result is indistinguishable from "that key is
  unset". A re-run silently lost config values instead of failing. They now say
  what happened.

---

## [v3.1.0] - 2026-08-12

**The gateway now runs on the host, not in this compose stack.**

It is a router, and NETMAP of the physical LAN, MASQUERADE out the real uplink,
`net.*` sysctls in the host namespace, and being the next hop for your LAN's
`10.0.0.0/8` route are all impossible from inside a Docker network namespace.

  jump-host  v3.0.0 -> v3.1.0

### Upgrading

`setup.sh` handles it: it installs `theta-gateway` on this host, copies the
secrets file to `/etc/theta-gateway/`, fills in the OpenBao token and the
WireGuard endpoint, and restarts the service. The old `jump-host` container is
no longer defined — remove it with `docker rm -f jump-host` after upgrading.

Its data moves from docker volumes to `/var/lib/theta-gateway`. A gateway that
was already meshed keeps working: its WireGuard identity lives in Redis, and
the installer preserves the data directory precisely because every peer in the
cluster holds its public half.

### Wiring

The gateway reaches the directory and OpenBao over loopback
(`127.0.0.1:3001`, `127.0.0.1:8080`). Containers reach the gateway at
`host.docker.internal:3002`, so `sso-manager` and `proxy` gained
`extra_hosts: host.docker.internal:host-gateway` and the proxy's Host record
for the gateway UI points there.

`setup.sh` needs root for this part; it uses `sudo` when not already root.

### theta-gateway v3.1.0 (submodule `jump-host`)

The gateway installs on the **host** now, not in a container.

- feat: **`install.sh` + a systemd unit.** Installs dependencies, lays the app
  down in `/opt/theta-gateway`, writes `/etc/theta-gateway/gateway.env`, binds
  Redis to loopback, and enables the `theta-gateway` service. Idempotent, so
  re-running upgrades in place; `--uninstall` deliberately keeps
  `/var/lib/theta-gateway`, since that holds this gateway's WireGuard identity
  and every peer in the cluster has its public half.
  - Refuses to start if the SSH port collides with the host's own `sshd`,
    rather than "succeeding" and leaving the operator locked out.
  - Runs as root: creating WireGuard interfaces, writing the routing table,
    setting `net.*` sysctls in the init namespace and installing NAT/NETMAP
    rules all need `CAP_NET_ADMIN` there, and sysctl writes are effectively
    root-only. A capability-scoped user buys ambiguity, not safety.
- fix: **the router threw instead of degrading, and it cost the exits.** The
  container image shipped without `iptables` or `procps`, and `/proc/sys` is
  read-only in a default container — so every NAT, forwarding and NETMAP call
  failed. `applyForwarding` was the one unguarded call in `applyPlan`, so it
  threw mid-reconcile: the NETMAP loop never ran, `applyPlan` never returned,
  and `applyExits` was never reached. Exits were planned and silently never
  applied. `net_router` now detects missing tooling once, says what that costs,
  and configures everything it still can; sysctls fall back to writing
  `/proc/sys` directly when the binary is absent.
- The mesh, device tunnels and site-to-site routing always worked in a
  container. What did not was everything touching the host network — which is
  most of what a router does.

---

## [v3.0.0] - 2026-08-12

The site network: every site that joins the directory gets a private network
every other site can reach, a VPN for laptops and phones, and per-device
internet exits.

**Breaking.** Addressing changed and the gateway's own join flow is gone, so
every existing site must be torn down and rebuilt. There is no migration path
and none is intended.

### The shape of it

A site joins the directory and that is what puts it on the network. `siteId`
IS the site's `ldapServerId` — already allocated once cluster-wide by the
master at join — so the mesh has no allocator of its own and cannot disagree
with LDAP about who is who. That number drives `172.24.0.<id>` for the
gateway and `10.<id>.0.0/16` for everything at the site. It also caps a
cluster at 254 sites, below LDAP's own 4094 ceiling, so addressing is now the
binding constraint.

Configuration lives in the directory; gateways apply it. Each gateway
publishes only its own keys and endpoint, and the publish endpoint takes no
site parameter — the row is chosen by which node you authenticated to — so a
gateway structurally cannot rewrite another site's network.

### Deployment change

The gateway is a **router**, and every awkward part of running one inside a
Docker network namespace is the router trying to escape it. It is meant to run
on the host (or a VM/LXC). The host installer is not built yet, so it still
ships in `docker-compose.yml` with `NET_ADMIN` — where it meshes, serves
device VPNs and routes between sites, but **cannot** NETMAP the physical LAN
or let LAN machines reach the mesh. See
[Where the gateway runs](docs/jump-host/deployment.md).

`docker-compose.yml` now publishes UDP 51820 and sets `THETA_MESH_ENDPOINT`.
Without the port nothing can dial a site; without the endpoint the gateway
publishes an empty one and every peer builds an entry it can never connect to,
which looks exactly like a broken tunnel.

Strongly recommended on each site's LAN router: `10.0.0.0/8` → the gateway's
LAN address, and the site's own `10.<siteId>.0.0/16` on-link so local traffic
does not hairpin.

### theta-directory v2.12.0 (submodule `sso-manager-node`)

The directory is now where the WireGuard cluster is configured. Sites, devices,
LAN mapping and internet exits all live here; each site's gateway reads the
roster and configures itself. Requires theta-gateway v3.0.0.

- feat: **the site network.** A site that joins the directory is on the network
  — no separate mesh to set up. `siteId` IS the site's `ldapServerId`, already
  allocated once cluster-wide by the master at join time (under a lock, after
  two spokes were once handed the same one), so the mesh needs no allocator of
  its own. That one number drives LDAP replication, the gateway's
  `172.24.0.<id>` address, and the site's `10.<id>.0.0/16`.
- feat: **`/network` page**, visible to any signed-in user because enrolling
  your own devices is not an admin task. Sites tab shows each site's addresses
  and whether its gateway has actually published a key — joined-but-not-started
  is a real state that used to look identical to healthy. Devices tab enrols
  hardware and picks an exit. Exit Access tab is admin-only.
- feat: **devices with optional key custody.** Supply a public key and the
  private half never reaches the server; omit it and one is generated, rendered
  into a config once, and forgotten — never stored, never logged, not
  recoverable. Addresses come from the site's own pool, lowest-free so a
  removed device returns its address rather than a counter marching upward.
- feat: **per-device internet exits.** Two independent things: a site marked
  `exitOpen` is saying it is *willing* to carry traffic; a grant says a user may
  use it. Revoking a grant immediately drops affected devices back to local
  breakout rather than leaving them routed somewhere they may no longer go.
  Exit choice is a routing rule on the gateway, so switching exits produces a
  byte-identical device config and needs no reconnect.
- feat: **DNS is pushed as the mapped address, not the physical one.** A device
  handed `192.168.1.1` only resolves while sitting on that LAN; over the tunnel
  what is routed is the shadow range. The site form shows the translation as
  you type and warns when an address is outside both mapped LANs, where it
  cannot be mapped and devices would get no resolver at all.
- feat: **MTU clamped to 1380** in device configs. Mesh-then-exit is WireGuard
  inside WireGuard, and a device sized for one hop blackholes large packets on
  the second — the classic "SSH works, HTTPS hangs".
- feat: devices running theta-agent are configured over the agent's existing
  websocket instead of a human copying a file. The push deliberately carries no
  private key: the agent holds its own.
- feat: the hub — the site carrying `10.0.0.0/8` as a catch-all — is chosen in
  the UI rather than implied by which site holds the master directory, since
  the natural hub is a cheap always-up VPS.
- change!: `utils/mesh_route.js` stops being a workaround. It existed because
  WireGuard lived inside the gateway container's namespace, so the only path to
  a peer was a userspace relay on a port derived from the site index. A peer
  site's directory is now simply `10.<siteId>.0.2:3001`, and the derived-port
  contract the two repos had to keep in sync is gone. An address in the retired
  scheme deliberately resolves to nothing rather than silently naming a
  different site. The public-endpoint fallback stays, so a deployment whose
  containers have no route into the mesh still replicates over the internet.
- fix: **the roster now reaches every site.** It is written at each site (a
  gateway publishes to its own directory) but replication only flows
  master -> spoke, so two halves were missing: a spoke's public key never left
  the spoke, and a spoke never learned any other site existed. Either alone
  means the mesh works only at whichever site happens to be the master. Spokes
  now forward their gateway details over `POST /api/site/spokes` — the channel
  they already have, with the credential they already hold — and the master
  carries the whole roster in its export. Roster edits push a resync
  immediately instead of waiting for an unrelated catalog change. A site's own
  row is never overwritten by an incoming export, since the local copy is
  always at least as fresh.
- fix: **exit interfaces need their own key.** A gateway's exit interface and
  its mesh interface presented the same public key to the same remote, which
  keeps one endpoint and one session per peer key — so the remote's endpoint
  flapped between the two and they invalidated each other's session. Verified
  against wireguard-go: with one key on two interfaces the remote settled on
  whichever handshook last while both kept re-handshaking; with separate keys
  it holds two stable peers. Gateways now publish a second `gatewayExitPublicKey`
  and `GET /api/mesh/peers` tells an exit site which gateways to accept under
  it, allowed only the device addresses actually using that exit.
- docs: [The Site Network](docs/network.md).

### theta-gateway v3.0.0 (submodule `jump-host`)

**Breaking.** The gateway no longer holds any network configuration of its own.
Sites, devices, LAN mapping and exits are configured in **theta-directory**; the
gateway publishes its public key and endpoint and applies whatever the roster
says. Addressing changed with it, so every site must be rebuilt.

- feat!: **the gateway is a roster-driven router.** Joining the directory *is*
  joining the mesh — the mint-token/register/join dance, the per-gateway
  registry and its independently-allocated index are gone, along with the
  second allocator that could disagree with the first. A site's id is its
  `ldapServerId`, allocated once, cluster-wide, when it joined.
- feat!: **new addressing.** `172.24.0.<siteId>/32` for a gateway's identity,
  `10.<siteId>.0.0/16` for everything at that site, `10.<s>.128.0/17` for
  devices, `10.<s>.168.0/24` and `10.<s>.172.0/24` for LAN mapping. One octet
  per site caps a cluster at 254 — below LDAP's own 4094 ServerID ceiling, so
  the addressing is now the binding constraint.
- feat: **full router.** `ip_forward`, MASQUERADE on the auto-detected uplink,
  stateful FORWARD rules, NETMAP of each site's physical LAN into a shadow /24,
  and `rp_filter=0` — without which policy-routed exit traffic silently
  blackholes while every other diagnostic looks healthy. Every iptables rule is
  added behind a `-C` check, since reconcile runs at boot, on every roster
  change, and on a timer.
- feat: **per-device internet exits**, one WireGuard interface each.
  `AllowedIPs` is a single trie per interface, so only one peer can own
  `0.0.0.0/0` and the last to claim it silently takes it from the others; and
  WireGuard routes on destination, ignoring the kernel nexthop, so
  `default via <peer>` cannot select among exits. Devices are steered with
  `ip rule from <device>/32`, so changing an exit rewrites one rule and never
  touches the device — no reconnect, no reissued config.
- fix: **registering a second peer used to delete the first.** `setPrivateKey`
  applied the key with `wg setconf`, which replaces the whole device config and
  removes every peer not in it. Verified against wireguard-go in the gateway
  image: setconf takes 1 peer to 0, `wg set private-key` leaves 2 at 2.
- fix: **the mesh never came back after a restart.** The registry was durable
  and the interface was not, and nothing rebuilt one from the other. Now
  reconciled at boot and on a timer.
- fix: **`'(self)'` was trusted for identity.** That slug arrived in a remote
  gateway's own registration body, so a peer could claim to be us. Identity now
  comes from the public key, which never crosses the wire.
- feat: directory config is cached in Redis and reconcile falls back to it, so
  the gateway keeps routing through a directory outage.
- feat: the mesh UI is now diagnostics — what the roster asked for, what is on
  the wire, and where they disagree, with named callouts for the states that
  otherwise look identical to healthy (no site id, stale config, interface
  down, no uplink, no NETMAP support, an unbuildable exit).
- removed: `services/mesh_forwarder.js`. It bridged traffic in userspace on a
  port derived from the site index because WireGuard was trapped inside a
  container namespace. With real routing a peer site's directory is just
  `10.<n>.0.2:3001`.
- removed: the roaming-client feature (`routes/wireguard.js`, `wg_peer`,
  `wg_site`, `wg_conf`). It handed out configs and QR codes that could never
  connect — no interface ever received a peer entry for them, and the endpoint
  advertised pointed at the mesh interface, which held the same key but no
  matching peer, so every config downloaded failed its handshake silently.
  Devices are directory-managed now, with keys the server never stores. Its
  `10.100.0.0/16` pool went too; that range collided exactly with a site
  landing on id 100.
- fix: **exit interfaces get their own keypair.** A remote gateway keeps one
  endpoint and one session per peer KEY, so an exit interface presenting the
  same key as the mesh interface made the remote's single peer entry flap
  between the two while they invalidated each other's session — intermittent
  breakage rather than a clean failure. Verified against wireguard-go in the
  gateway image: one key on two interfaces left the remote pointed at whichever
  handshook last, with both still re-handshaking; separate keys give two stable
  peers. The gateway now publishes a second exit key, and an exit site builds a
  peer entry for anyone exiting through it — allowed only the specific device
  addresses using that exit, since an exit is permission to send internet
  traffic, not a route into a network.
- test: three-gateway end-to-end over real WireGuard
  (`docker-compose.mesh-e2e.yml`). Three and not two deliberately — the
  peer-wipe and index bugs above are both structurally invisible with one peer
  per gateway.

---

## [v2.12.0] - 2026-08-11

Rolls up **theta-directory v2.11.0** — migrating an existing LDAP directory
into the suite no longer means recreating every account by hand.

### theta-directory v2.11.0
- **Import users and groups from an existing LDAP directory.** New admin-only
  wizard at **Users → Import LDIF** (`/users/import`) takes a `slapcat` /
  `ldapsearch` export and migrates accounts *through the app's own model
  layer*, so every imported account arrives with a `UserVerification` row, a
  personal group, cache invalidation and service-account membership — exactly
  as if it had been created in the UI. Two guarantees drive the design:
  `uidNumber`/`gidNumber` are preserved verbatim (they are what every file on
  every host is owned by; reallocating them turns a migration into a
  filesystem-wide chown), and `userPassword` is carried across as the stored
  hash, never re-hashed, so people keep the password they already have.
  - `utils/ldif.js` — a standalone RFC 2849 parser (line folding, base64,
    attribute options, CRLF). Refuses `attr:< url` values rather than hand
    whoever uploads a dump a file-disclosure primitive, and rejects change
    records instead of misreading them as content.
  - `utils/ldif_import.js` — schema-agnostic profiling, planning and applying.
    The source layout is *detected and then editable*, so a FreeIPA or AD
    export is a mapping change rather than a code change. Membership resolves
    per entry, because real directories mix `groupOfNames`/`member` with
    `posixGroup`/`memberUid`.
  - Nothing is written until every account and group has been reviewed. Blocked
    rows (no `uidNumber`, a duplicate inside the file, a collision with an
    account already present) are skipped regardless of what the client sends.
  - **Groups are never created by an import.** A group name from another
    directory carries no meaning here, where access is a projection of the
    resource graph — each source group either has its members merged into a
    group that already exists, or is dropped. Add your hosts and apps *before*
    importing so there is something to map onto.
  - Carried across where present: password hash, uid/gid numbers, name, email,
    phone, shell, home directory, description, location, date of birth, every
    SSH key, sudo rules, and the account's disabled state. Anything else is
    listed on the row as *not migrated* rather than dropped quietly.
  - Onboarding is a per-run choice (treat ToS as accepted / email as verified).
    Legacy MD5 passwords always force a change at first login regardless, and
    no welcome email is sent to anyone.
  - Staging lives in Redis under a one-hour expiry, destroyed on apply or
    abandon; the parsed dump is never written to disk and password hashes are
    never included in an API response.
- **`User.add(data, options)`** takes `preserveIds`/`preserveHash`/
  `suppressWelcome` as a second argument, deliberately not as fields on `data`:
  every route calls `User.add(req.body)`, so a `uidNumber` honoured whenever
  present would let anyone who can create a user claim uid 0, and a
  `userPassword` that skipped hashing whenever it looked hashed would let them
  plant a known hash. Normal user creation is unchanged.
- **An account may share its primary group with another account.** Under
  `preserveIds` a group already holding the gid is referenced rather than
  duplicated — legal POSIX, and present in real directories.
- **`sudoHost`/`sudoCommand`/`sudoUser` are honoured when supplied**, so a
  migrated account keeps the rule it had instead of being silently granted this
  directory's `ALL`/`ALL` default.
- New documentation: [Importing an existing
  directory](https://theta42.github.io/theta-directory/ldif-import.html), also
  served in-app at `/docs/ldif-import`.

### this repo
- Submodule gitlink for `sso-manager-node` moved to theta-directory v2.11.0.

## [v2.11.0] - 2026-08-11

Rolls up **theta-directory v2.10.0** and **theta-agent v2.4.0**. The Windows
agent install path is now self-hosted and one-click.

### theta-directory v2.10.0
- **`GET /install-agent/authorize`** — the theta-agent installer's "Log in to
  the Directory and get a join key..." button opens this page; a logged-in site
  admin gets a join key minted and is redirected to the installer's loopback
  callback (loopback-validated).
- The Directory's Windows install command now downloads the installer from its
  own `/resources/theta-agent/` instead of GitHub.

### theta-agent v2.4.0
- Wizard's connection page button is now **"Log in to the Directory and get a
  join key..."** — it starts a loopback listener, opens `/install-agent/authorize`,
  and auto-fills Server URL + Join Key from the redirect back.
- **Local discovery is always on** — `prefer_local_directory` removed from the
  config and the wizard.

### this repo
- **`setup.sh`** stages the matching Windows theta-agent installer (the suite's
  pinned submodule version, SHA256-verified) plus `install.sh` into
  `config/resources/theta-agent/`, and **`docker-compose.yml`** bind-mounts
  `./config/resources` over the sso-manager container's `/app/public/resources`
  so the Directory serves them.

## [v2.10.0] - 2026-08-11

Rolls up **theta-directory v2.9.0** and **jump-host (Theta Gateway) v2.2.0**.

Four things `docs/MULTI_SITE_SPEC.md` described as shipped had never worked
end to end. Each failed only into a note string or a swallowed exception no
test asserted on, so every existing test stayed green: the join's LDAP tree
import, catalog updates/deletions reaching a spoke, promotion with more than
two sites, and the mesh carrying any service traffic. All four are fixed and
covered by real multi-container tests.

The `setup.sh`-re-run-on-every-site ritual for LDAP replication is gone from
the product, not just from the docs.

### theta-directory v2.9.0

Fixed:
- **The multi-site join's LDAP import had never worked.** Three stacked
  defects — a missing `argv[0]` (`spawn -c ENOENT`), operational attributes
  `slapcat` emits that `ldapadd` rejects, and `ldapadd -c` exiting non-zero
  on the benign "Already exists" every spoke produces. A spoke adopted the
  catalog and signing key but not one user or group.
- **Catalog updates and deletions never reached a spoke.** `importDirectory()`
  called `Resource.update`/`ResourceEdge.delete` as statics, which
  `@simpleworkjs/orm` has never had. The test stubs implemented them as
  statics, which is why the suite stayed green. The import is also converging
  now rather than destructive.
- **Promotion orphaned every site beyond the second.** The promoted node was
  a spoke, so its own registry was empty and the fan-out reached nobody.
  `/demote` now hands over its registry (including push tokens) and each
  sibling is re-pointed via the new `POST /api/site/master-changed`.
- **The mesh carried no service traffic.** Consumers dialled an address that
  exists only inside the peer gateway's network namespace.
- **Concurrent spoke registrations were assigned the same LDAP ServerID**,
  which does not error — it quietly breaks MMR. Now serialized, and enforced
  by a database unique index: `@simpleworkjs/orm` drops `unique` for integer
  fields and calls `sequelize.sync()` with no options, so a declared
  constraint never reached the database on any deployed site. Existing
  duplicates are repaired at boot before the index is added.
- **A base-DN mismatch between sites now fails the join up front** instead of
  half-succeeding.
- **LDAP tunnel relay sockets were unbounded** (no idle timeout, connect
  deadline, or per-agent ceiling), and cleanup tore down a reconnecting
  agent's new sockets along with the old ones.
- **The Multi-Site modal's confirmations did nothing** — `app.messages.confirm()`
  needs a `.actionMessage` element and its promise never settles without one.

Added:
- **LDAP replication config is applied live** — `slapd` runs from the
  `cn=config` dynamic backend, so `olcServerID`/`olcSyncrepl` are modifiable
  while it serves. Config converges on spoke registration/removal, join,
  resync, master-changed, promotion, boot, and a periodic sweep. No restart,
  no operator step, on any node. Drift detection is retained as a fault
  indicator.
- Registered Spokes is actionable: list, remove, and "Sync now" (awaited, so
  reachability is reported honestly).
- `POST /api/site/reregister` — recovery when a spoke and its master disagree
  about the push token.
- Three-site e2e covering promotion handoff, live replication config, LDAP
  tree replication, and catalog convergence.

### jump-host (Theta Gateway) v2.2.0

- **Mesh service forwarding** (`services/mesh_forwarder.js`) — the data plane
  the mesh control plane assumed but never had. WireGuard runs inside the
  gateway's network namespace, so the `172.24.<idx>.1` mesh IP a gateway
  reports is unreachable from the sibling containers told to use it, and
  nothing listened on `:3001` there in any case. Now bridged in userspace both
  ways: ingress `172.24.<own>.1:3001 -> sso-manager:3001`, egress
  `0.0.0.0:<30000+peer> -> 172.24.<peer>.1:3001`. Ports are derived from the
  peer's mesh index, so nothing is stored or discovered. Forwarders reconcile
  on every mesh change.
- Tested with two real gateways over real WireGuard: an HTTP request crosses
  the tunnel and reaches the far site's service in both directions, and a
  removed peer's forwarder stops serving.

### Docs
- **`docs/MULTI_SITE_SPEC.md` status table corrected.** Several things this spec described as shipped had never worked end to end — the join's LDAP import, catalog updates/deletions reaching a spoke, promotion with more than two sites, and the mesh carrying any service traffic. Each failed only into a note string or a swallowed exception no test asserted on. All are fixed and covered by real multi-container tests; the spec now says so, and says plainly that "verified" in its earlier revisions meant "returned 200", not "the effect was observed".
- **The `setup.sh`-re-run ritual is gone from the docs because it is gone from the product.** `docs/sso/replication.md` and `docs/sso/multi-site.md` previously told operators to re-run `setup.sh` on every site after any site joined; replication config is now applied live against `cn=config`. The Multi-Site modal's drift badge is documented as a fault indicator rather than a chore.
- `docs/jump-host/mesh.md` documents what actually crosses the tunnel (the gateway's ingress/egress forwarders and the derived per-peer port).
- `docs/sso/replication.md` states that LDAP ServerID uniqueness is enforced by a database constraint rather than by allocation code alone, and that a master upgrading from an affected build repairs existing duplicates at startup.

## [v2.9.0] - 2026-08-11

Rolls up **theta-agent v2.3.0** — the Windows agent finally gets its missing
pieces: directory logon, real telemetry, a proper icon, and a redesigned
installer.

### theta-agent v2.3.0
- **Windows directory logon** (`configure-login`, `ConfigureLDAP`): LDAP-backed
  sign-in via the bundled OpenCredential credential provider is now real and
  *directory-driven* — the agent advertises `capabilities.configure_ldap`, the
  Directory pushes its own LDAP settings, and the agent seeds OpenCredential's
  registry config to authenticate against its local LDAP tunnel
  (`127.0.0.1:389`). Members of the directory admin group get local
  Administrator; LocalMachine stays enabled as a no-lockout fallback.
- **Windows discovery/telemetry**: disks now report logical drives (`C:`, NTFS,
  real usage) instead of the Unix `/ /` fallback, and logged-in users are
  enumerated via the WTS API (was always empty).
- **New tray badge set + icon**: rounded-square gradient badges with a crisp
  white theta, multi-size ICO, and the same icon on the Start menu, setup.exe,
  and uninstaller.
- **Installer wizard redesign**: asks whether to allow Directory sign-in on this
  computer and whether to use local (mDNS/layer-2) discovery; clean options
  page; fixed a bug where the installer wrote an invalid-YAML `desktop_helper`
  path that would crash-loop the service.
- **Release matrix**: macOS builds disabled for now (the agent still compiles
  for darwin; will be re-enabled when a macOS build host is available).

## [v2.8.0] - 2026-08-11

Rolls up **sso-manager-node v2.8.0**. Fixes found while auditing the v2.7.0
multi-site work for gaps, plus the published docs staleness that same audit
turned up.

### sso-manager-node v2.8.0
- Promotion no longer orphans the demoted old master's LDAP replication --
  `/demote` now registers itself with the new master immediately instead of
  being left with no way to ever get a real `ldapServerId` again.
- The Directory's site slug and the multi-site replication identity are
  unified -- previously unrelated values that happened to share a name.
- LDAP replication status (real vs. advertised ServerID, a `stale` flag) and
  per-spoke detail (not just an aggregate count) on the Multi-Site modal.

### theta-suite docs
- Fixed multiple stale/contradictory claims on the published site: the
  no-inbound relay described as "designed but not automated" (shipped
  earlier this session), `docs/sso/replication.md` never mentioning the new
  LDAP MMR auto-config at all, and the homepage feature list only
  describing the old manual N-way replication.

## [v2.7.0] - 2026-08-11

Rolls up **sso-manager-node v2.7.0**. Closes the last "operator hand-sets
this" item on the multi-site TODO: OpenLDAP N-way multi-master replication
now configures itself.

### theta-suite orchestration
- **`bootstrap/site-ldap-register.js`**: runs on every `setup.sh` invocation
  (master and spoke), fetches this node's auto-assigned `LDAP_SERVER_ID` +
  current peer list from sso-manager-node's new endpoints, and restarts
  `sso-manager` only when the computed config actually changed.
- `CFG_LDAP_MMR_MANUAL=true` skips the automatic step for a topology outside
  this cluster the script can't derive on its own -- otherwise it always
  runs (every fresh install starts as a master) and would overwrite
  hand-set values.
- `setup.env.example`'s old `#LDAP_SERVER_ID=1`/`#LDAP_REPLICATION_HOSTS=`
  manual-config prompt is gone for the common case.

### sso-manager-node v2.7.0
- `SiteSpoke.ldapServerId` auto-assigned at registration (same pattern as
  jump-host's mesh index); each site's LDAP URL derived from its
  already-known HTTP(S) endpoint. New `GET /api/site/ldap-peers`
  (spoke-facing) and `GET /directory-admin/ldap-replication-config`
  (master-local). Verified against real running containers.

## [v2.6.0] - 2026-08-11

Rolls up **sso-manager-node v2.6.0** and **jump-host v2.1.1** (already
current). Fixes several real bugs found on a live deployment: theta-agent
never got its `server_url` written, `theta-agent update` 404'd because
setup.sh installed a stale committed binary, the Directory's site slug and
gateway count were both wrong, and duplicate group rows accumulated on
repeated resource promotion.

### theta-suite orchestration
- **`server_url` now gets written into `/etc/theta42/agent.yml`.** setup.sh's
  theta-agent install step `sed`'d in `join_key` but never touched
  `server_url`, so it kept `agent.yml.example`'s literal placeholder forever.
  Self-heals an already-installed `agent.yml` too (never touches
  `join_key`/`auth_token`).
- **`theta-agent update` no longer 404s.** setup.sh now downloads the current
  release binary from GitHub instead of trusting one committed in the
  theta-agent submodule checkout, which predated an upstream fix and could
  never self-update out of the bug. Matches theta-agent's own `install.sh`.
  The stale committed binaries were removed from the theta-agent repo.
- **`SITE_SLUG` auto-derived from `CFG_SITE_NAME`.** Nothing ever set it
  before, so a fresh master always showed the app's own literal
  "site-default" fallback.
- **`PROXY_INTERNAL_URL`/`JUMP_INTERNAL_URL` wired into `docker-compose.yml`.**
  Both the no-inbound relay automation and the new real gateway-mesh count
  existed in sso-manager-node's code but were completely unreachable in
  every real deployment -- neither env var was ever actually set.
- **`spoke.env.example`** -- a dedicated file for the join-a-cluster vars,
  split out of `setup.env` for clarity (which still has every option).
  Layered on top of `setup.env` when present. Also adds `CFG_PUBLIC_DOMAIN`
  (documented in the spec but never wired into setup.sh before).

### sso-manager-node v2.6.0
- Fixed duplicate access/admin groups accumulating on repeated resource
  promotion (three independent copies of the same missing-existence-check
  bug).
- `GET /api/directory-admin/resources` no longer runs a full LDAP group
  self-heal fan-out on every list -- moved to write-time, with an explicit
  `POST /resources/heal-groups` for backfill.
- Recovers an nmap scan that completed successfully despite a benign stderr
  warning nmap itself prints (`node-nmap` treated it as a fatal failure).
- The Multi-Site modal's gateway count now queries jump-host's real mesh
  registry instead of an unrelated WireGuard subsystem.

## [v2.5.0] - 2026-08-10

Rolls up **sso-manager-node v2.5.0** and **jump-host v2.1.1** — closes the
last gap in no-inbound relay automation (the mechanism existed at the API
level but nothing in the real operator bring-up flow could reach it) and
fixes two real bugs found live-testing it.

### theta-suite orchestration
- **`bootstrap/site-relay-register.js`** + `CFG_SPOKE_NO_INBOUND`/
  `CFG_SPOKE_PUBLIC_HOST` (`setup.env.example`): a no-inbound spoke's
  `setup.sh` run now discovers its own jump-host's WireGuard mesh IP and
  registers it with the master on every invocation (idempotent no-op until
  the two jump-hosts are actually meshed — that peering stays a deliberate
  manual step, same as minting/pasting a site join key).
- `docs/MULTI_SITE_SPEC.md` and the published `docs/jump-host/mesh.md` page
  updated — both still described this as "designed but not automated" after
  the API-level work had already shipped in sso-manager-node/jump-host.

### sso-manager-node v2.5.0
- **No-inbound relay automation reachable from the real join flow.**
  `POST /api/site/join` now forwards `noInbound`/`meshIp`/`publicHost`
  through to `POST /api/site/spokes`, which drives `utils/proxy_client.js`
  to auto-create/update the relay route on the master's `theta-proxy` (a new
  self-service `prx_...` API token client — reuses `theta-proxy`'s existing
  token system, not a new credential type). Verified against a real running
  `theta-proxy` container.
- **Replication traffic prefers the mesh.** `utils/site_replicate.js`'s
  fire-and-forget resync push tries a registered spoke's `meshIp` first,
  falling back to its public endpoint on failure.

### jump-host v2.1.1
- **`GET /api/mesh/self`** — this gateway's own mesh IP, for local scripts
  (gated by any self-service API token, not a full admin session).
- **Fixed: `/api/mesh/register` was unreachable via HTTP.** A route-mounting
  order bug meant every `/api/mesh/*` request hit an admin-session gate
  before `routes/mesh.js` ever ran, so a real gateway-to-gateway mesh join
  always 401'd. Found live-testing `/self` with two real containers.
- **Fixed: the initiating side of a mesh join never recorded its own
  identity** — `GET /api/mesh/self` and the mesh UI's own-entry handling
  silently saw nothing on whichever gateway called `/join` (only the
  receiving side of `/register` persisted a self-entry). Verified with two
  real meshed containers: both sides now report their own correct mesh IP.
- **Mesh peer removal now cleans up its kernel routes** (`wg_iface.removePeer()`)
  — verified live: routes present after `setPeer`, gone after `removePeer`.

## [v2.4.0] - 2026-08-10

Rolls up **theta-agent v2.2.0** — mDNS local-discovery is now Windows-capable,
closing the last gap in the original multi-site design on the agent side.

### theta-agent v2.2.0
- **Windows local-discovery**: the hosts override now runs on Windows
  (`%SystemRoot%\System32\drivers\etc\hosts`, CRLF-aware, `ipconfig /flushdns`
  after every change). Reachable because the agent runs as a SYSTEM service, so
  the elevation question in the spec resolved in our favor. The Windows CI leg
  now runs the real Windows write path instead of skipping.
- **Local route pinning** (`local_route*.go`): the hosts override only fixes
  *name resolution*; the packet path is the routing table's job. If the WireGuard
  mesh tunnel is up with `AllowedIPs` covering the LAN subnet (or a full-tunnel
  `0.0.0.0/0`), the tunnel route would swallow the direct connection to the
  discovered LAN IP. Discovery now pins a `/32` host route via the owning local
  interface (`route.exe add ... metric 1` on Windows, `ip route replace` on
  Linux) and drops it on revert — closing a real gap in the shipped Linux path.
- **Prompt reconnect**: an apply/revert signals the WebSocket loop, which
  reconnects immediately instead of waiting out its 5s backoff.
- **Installer version fix**: the setup.exe previously hardcoded `2.1.0` in its
  file name and version resources no matter the tag; it now derives the version
  from the git tag.

### docs
- `docs/MULTI_SITE_SPEC.md` status table updated: Windows local-discovery marked
  shipped; macOS remains the one unbuilt piece (hosts override compiles on
  darwin but needs `dscacheutil -flushcache` + real hardware testing, being done
  on a macOS VM).

## [v2.3.0] - 2026-08-10

Rolls up **theta-directory v2.4.0**, **jump-host v2.1.0**, **theta-agent v2.1.2**. Live catalog replication and a real gateway-to-gateway WireGuard mesh land in the same pass — multi-site directory sync stops being a one-time snapshot, and site-to-site networking becomes real infrastructure instead of a documented-but-unbuilt design. See `docs/MULTI_SITE_SPEC.md` for the full architecture and an explicit TODO list of what's still open (Windows/macOS mDNS, routing directory traffic over the mesh, `theta-proxy` no-inbound relay automation).

### theta-directory v2.4.0

#### Added
- **Live catalog replication.** A spoke now stays in sync after joining instead of only getting a one-time snapshot: it registers its own endpoint with the master at join time (`POST /api/site/spokes`, Bearer the site join key), and every successful master catalog write fires a fire-and-forget push (`utils/site_replicate.js`) at every registered spoke, concurrently — one unreachable spoke never blocks or delays delivery to another. The spoke's `POST /api/site/resync` handler re-runs the same tested export-pull-and-import path used at join time rather than applying a partial diff.
- **Identical-directory agent-signing key.** `POST /api/site/export` now best-effort includes the master's agent-signing key; a spoke adopts it via `agent_keys.adopt()` on both join and every resync, so any site's `sso-manager-node` can validly sign a command for any agent enrolled at any other site (a deliberate blast-radius tradeoff for this deployment's small, trusted scale — see `docs/MULTI_SITE_SPEC.md` §2).
- **Coordinated master promotion.** `POST /api/directory-admin/site-promote` now demotes the previous master as part of the same action (mints it a fresh join key, calls its new `POST /api/site/demote`) instead of leaving a manual two-step gap where two nodes could both believe they're master. Best-effort: an unreachable old master never blocks the local promotion — the response's `handoff` field reports what happened.
- **Master Site modal UI**: new "Live Replication" (spoke) / "Registered Spokes" (master) status rows; the join form gained a "this site's own reachable URL" field wired to `selfUrl`, which the join API already supported but the UI never sent; the promote button's success toast now reports the actual handoff result.

#### Fixed
- **`site-promote`'s god_admin check was dead on arrival** — it read `req.user.groups`, a field nothing in the codebase ever populates, so the check silently evaluated to an empty array on every request. Promotion returned 403 for every user, including a real god_admin, since it shipped in v2.0.0. Only surfaced by live two-container testing, not by inspection.
- **The read-only write-gate blocked `site-promote` on a spoke** before its handler could run — the one mutating request a spoke must be able to make to itself.
- **`GET /api/site/config` was returning live credentials** (`masterJoinKey`, `replicationPushToken`) directly to the browser on every admin session. Replaced with boolean derivatives.

### jump-host v2.1.0

#### Added
- **Gateway-to-gateway WireGuard mesh** (`routes/mesh.js`) — real site-to-site tunnels between theta-gateway instances, distinct from the existing roaming-client/exit-node WireGuard feature. Join-token bootstrap, mesh-index addressing (172.24.\<idx\>.0/16 + 10.\<idx\>.0.0/16).
- **In-kernel WireGuard with a userspace fallback** (`utils/wg_iface.js`) — prefers `ip link add type wireguard`, falls back to `wireguard-go` when the kernel module isn't available.
- **mDNS local-discovery announcer** (`services/mdns_announce.js`) — advertises which public hostnames this site fronts so a `theta-agent` on the same LAN segment can skip the relay/WAN path.
- **Mesh UI** (`/mesh`) — gateway identity, join-token minting, remote-join form, meshed-gateways table.

Verified with real two-container tests: an actual encrypted WireGuard tunnel passing ICMP traffic end to end (0% loss), and the mDNS announce/discover/apply/revert cycle over real multicast. Two real bugs found and fixed: `wg set ... allowed-ips` doesn't add a kernel route (a real handshake completed with zero routing until `setPeer()` was fixed to add it); mDNS's default IPv6 query aborting the entire lookup after a valid IPv4 response had already arrived.

### theta-agent v2.1.2

#### Added
- **Linux mDNS local-discovery** (`local_discovery.go`, `hosts_override.go`) — opt-in via `prefer_local_directory`; skips the relay/WAN path when a local `theta-gateway`/`theta-proxy` announces it fronts this agent's `server_url` host. Never touches TLS/certificate validation — only changes where the agent connects, never whether it trusts what answers.

#### Fixed (found via live two-container testing over real multicast)
- `mdns.Lookup()`'s default IPv6 query aborted the whole lookup — discarding an already-valid IPv4 response — when IPv6 wasn't available. Fixed by disabling IPv6 querying explicitly.
- Hosts-file writes used write-tmp-then-rename; `/etc/hosts` is frequently a bind mount (every container runtime does this) and `rename()` onto one fails with `EBUSY`. Switched to truncate-and-rewrite in place.

Windows/macOS local-discovery remain unbuilt — see `docs/AGENT_LOCAL_DISCOVERY_SPEC.md`.

Also backfills v2.1.0/v2.1.1 changelog entries (Windows agent, WireGuard client, installer, CI) in theta-agent's own CHANGELOG.md, which were tagged and released earlier but never documented there.

## [v2.2.0] - 2026-08-10

Multi-site join is now end-to-end: theta-directory can adopt an existing
master's directory as a read-only spoke (v2.3.0), and setup.sh wires it into a
first-run bring-up.

### theta-directory v2.3.0
- **Master Site modal**: "Join an Existing Site" form (fresh installs only),
  Site Join Keys manager (mint/revoke/list), live WAN Sync Health via
  `POST /api/site/ping`.
- **Spoke read-only**: directory writes (resources/edges/groups/secrets/grants/
  driver actions/discovery merges) return 403 pointing at the master.
- **Fresh-install guard**: `/api/site/join` refuses unless no users beyond the
  bootstrap admin and no enrolled agents; `site-status` exposes `canJoin`.
- (Server endpoints, join keys, persisted role shipped in theta-directory v2.2.0.)

### theta-suite (this repo)
- **First-run site join**: `setup.sh` step 5b runs `bootstrap/site-join.js`
  (logs in as the admin, calls `/api/site/join`) when `setup.env` sets
  `CFG_MASTER_DIRECTORY_URL` + `CFG_MASTER_DIRECTORY_JOIN_KEY`. Honored only on
  first run (once `./config/` exists it is ignored), so a populated directory
  can never be merged. Idempotent — an already-joined node reports "already a
  spoke".
- `setup.env.example` documents the two vars; the lint job (branch-protected
  name "Syntax check bootstrap.js") now also `node --check`s `site-join.js`.

## [v2.1.1] - 2026-08-10

Fresh-install fixes for the v2.1.0 Windows rollout.

### theta-agent v2.1.1
- **Silent installs wrote an empty `server_url`.** `CurPageChanged` fires even when the wizard is walked programmatically in silent mode, so it read the (empty) edit boxes and clobbered the `/SERVER_URL` `/JOIN_KEY` command-line params. Now guarded with `WizardSilent()` — silent installs keep the params (this was also why the service exited at first connect and the Directory showed the agent as a placeholder version).
- **Tray post-install launch had `skipifsilent`** — a silent install (the common path from the Directory's Windows command) never started the tray. Removed.
- **`theta-agent update` 404'd** — it downloaded from the SSO `/resources` path, which no longer serves binaries (they are GitHub release artifacts). Pointed at `releases/latest/download/`.

### theta-directory v2.1.1
- **"Master Site" button error** (`app.modal.show is not a function`) — the multi-site status modal used the legacy `app.modal.show()` signature; now `app.modal.open({ title, bodyHtml, size })`.
- **Agents with no discovery showed a fake `v2.0.0`** — hardcoded fallbacks now report `unknown`.

## [v2.1.0] - 2026-08-10

Rolls up **theta-agent v2.1.0** and **theta-directory v2.1.0**: the theta-agent
Windows client is now a first-class citizen (Windows service, WireGuard mesh,
IAM, tray, fully-offline installer) and the Directory can hand a Windows host
the same one-command install it has always handed Linux.

### theta-agent v2.1.0
- **Windows agent** (`feat/windows-agent`): platform ops (shutdown.exe / sc.exe /
  PowerShell / Get-WinEvent), Windows service wrapper (`install-service` starts it
  immediately), session helper (lock/display/logout/staged self-update), signed
  `wireguard_apply`/`wireguard_remove` + auto-VPN, IAM via local groups + OpenSSH
  keys, tray icon fix (PNG→ICO), and the fully-offline Inno installer with a
  wizard page (Theta Directory URL + join key + "open install-agent page").
- **Release pipeline**: `.github/workflows/release.yml` builds every binary on
  GitHub Actions and attaches them to the GitHub release as artifacts (with
  optional Azure Trusted Signing); nothing binary is committed to the repo.
  `install.sh` and the Directory modal download from `releases/latest/download/`.

### theta-directory v2.1.0
- **Windows install commands in the Install Agent modal.** PowerShell one-liners
  for the join-key / pre-register / custom-config flows (download the offline
  `setup.exe`, pass `/SERVER_URL`, `/JOIN_KEY`, `/AUTH_TOKEN`, `/PUBLIC_KEY` or
  `/B64_CONFIG`).
- **Dropped the committed binaries** from `nodejs/public/resources/theta-agent/`
  (they are GitHub release artifacts now); the small `install.sh` bootstrap
  script remains.

## [v2.0.2] - 2026-08-09

Rolls up **theta-directory v2.0.2**, **proxy v2.0.1**, **jump-host v2.0.1**. Unifies the GitHub Pages docs site: the SSO/Proxy/Jump Host pages, their nav labels, and each component's own README now consistently say Theta Directory / Theta Proxy / Theta Gateway, drop marketing sections ("Why this over the alternatives", "Get it", "Related projects") that don't apply to a suite component, remove every standalone/bare-metal install path, and link to `theta42.github.io/theta-suite/...` instead of the old per-repo Pages sites.

### theta-directory v2.0.2
- **README rebranding & standalone-install cleanup.** Removed the "Why this over the alternatives" section and stale links to the old per-repo GitHub Pages site (`theta42.github.io/sso-manager-node/`); documentation and secrets links now point at the unified `theta42.github.io/theta-suite/` site. Made explicit that Theta Directory is deployed as part of Theta Suite and isn't installed or run on its own. Added the agent capability/install screenshots to the gallery.
- **Docs site (`docs/sso/`)**: full rewrite of the landing page — dropped "Why this over the alternatives" / "Get it" / "Related projects", refreshed all screenshots, added the two agent screenshots, and swept "SSO Manager" → "Theta Directory" across every sub-page (configuration, OAuth, LDAP, directory, agents, replication, vault, concepts-*).

### proxy v2.0.1
- Finishes the pending v2.0.0 Docker-only rewrite (README's Quick start already trimmed to one Docker Compose path via Theta Suite).
- Removed "Why this over the alternatives"; trimmed Requirements to actual Docker-host requirements (was still listing bare-metal items: root access, directly-installed OpenResty/Redis).
- Fixed stale links to the old per-repo GitHub Pages site; synced `package-lock.json`'s version (missed by the earlier 2.0.0 bump commit).
- Docs site (`docs/proxy/`): renamed to Theta Proxy, dropped the same three sections, refreshed screenshots, relative links within the unified site. Deleted a stale `docs/proxy/README.md` meta-doc left over from when this repo had its own separate Pages site (wrong live URL, referenced a deleted `installation.md`).

### jump-host v2.0.1
- Rebranded docs to Theta Gateway (matches the repo's own README/package.json naming).
- Removed the "Standalone Docker" and "Bare metal" install paths, which contradicted the Deployment section's own "exclusively via Docker Compose within Theta Suite" claim.
- Fixed stale links to the old per-repo GitHub Pages sites.
- Docs site (`docs/jump-host/`): same section removal, added a WireGuard mesh-routing feature bullet, refreshed screenshots, fixed three more stale absolute links in `architecture.md`. Deleted the same kind of stale `docs/jump-host/README.md` meta-doc.

## [v2.0.4] - 2026-08-10

Rolls up **theta-directory v2.0.4**.

### Changed
- **`Dockerfile.openldap` no longer compiles OpenLDAP from source.** Extracted the from-source compile (nestgroup overlay, ~5 min, dependent on `git.openldap.org` being reachable — it 502'd twice tonight, blocking two PRs) into its own image, `ghcr.io/theta42/openldap-nestgroup:<pinned commit>`, published by a new workflow whenever the pin changes. `Dockerfile.openldap`'s `ldapbuild` stage now just pulls it. Cut CI's "Build LDAP test image" step from ~5-6 minutes to ~1.5 minutes total per matrix run; every local build of this Dockerfile gets the same speedup.

## [v2.0.3] - 2026-08-09

Rolls up **theta-directory v2.0.3**.

### Fixed
- **Directory tab showed unpromoted discoveries.** `GET /api/directory-admin/resources` unconditionally admitted every `kind: 'host'` resource, and every discovery plugin (UniFi, Proxmox, nmap) creates its finds as `kind: 'host'` — so unchecking "Auto-promote to Directory" on a plugin never actually kept undiscovered/unpromoted devices out of the Directory tab, only out of the LDAP-group auto-provisioning. Now only `site` resources are unconditionally shown; anything else that discovery ever touched requires `metadata.managed === true` (set by promotion, an agent, or merging into an already-managed resource).
- **`GET /api/directory-admin/site-status` 500'd.** Queried `Resource.list({ where: { subType: 'wireguard' } })`, but `subType` only ever lives in `metadata.subType` — never a top-level DB column, so SQLite raised `no such column: Resource.subType`. Filters in JS over `metadata.subType` now.
- **Discovered Inventory had no way to review ignored devices.** Added a "Show ignored" toggle (off by default).

### Chore
- **Untracked `nodejs/config/inventory.sqlite`** in theta-directory — the app's default runtime DB, not a fixture; had been committed by mistake across 13 prior releases.

## [v2.0.2] - 2026-08-09

Rolls up **theta-directory v2.0.2**, **proxy v2.0.1**, **jump-host v2.0.1**. Unifies the GitHub Pages docs site: the SSO/Proxy/Jump Host pages, their nav labels, and each component's own README now consistently say Theta Directory / Theta Proxy / Theta Gateway, drop marketing sections ("Why this over the alternatives", "Get it", "Related projects") that don't apply to a suite component, remove every standalone/bare-metal install path, and link to `theta42.github.io/theta-suite/...` instead of the old per-repo Pages sites.

### theta-directory v2.0.2
- **README rebranding & standalone-install cleanup.** Removed the "Why this over the alternatives" section and stale links to the old per-repo GitHub Pages site (`theta42.github.io/sso-manager-node/`); documentation and secrets links now point at the unified `theta42.github.io/theta-suite/` site. Made explicit that Theta Directory is deployed as part of Theta Suite and isn't installed or run on its own. Added the agent capability/install screenshots to the gallery.
- **Docs site (`docs/sso/`)**: full rewrite of the landing page — dropped "Why this over the alternatives" / "Get it" / "Related projects", refreshed all screenshots, added the two agent screenshots, and swept "SSO Manager" → "Theta Directory" across every sub-page (configuration, OAuth, LDAP, directory, agents, replication, vault, concepts-*).

### proxy v2.0.1
- Finishes the pending v2.0.0 Docker-only rewrite (README's Quick start already trimmed to one Docker Compose path via Theta Suite).
- Removed "Why this over the alternatives"; trimmed Requirements to actual Docker-host requirements (was still listing bare-metal items: root access, directly-installed OpenResty/Redis).
- Fixed stale links to the old per-repo GitHub Pages site; synced `package-lock.json`'s version (missed by the earlier 2.0.0 bump commit).
- Docs site (`docs/proxy/`): renamed to Theta Proxy, dropped the same three sections, refreshed screenshots, relative links within the unified site. Deleted a stale `docs/proxy/README.md` meta-doc left over from when this repo had its own separate Pages site (wrong live URL, referenced a deleted `installation.md`).

### jump-host v2.0.1
- Rebranded docs to Theta Gateway (matches the repo's own README/package.json naming).
- Removed the "Standalone Docker" and "Bare metal" install paths, which contradicted the Deployment section's own "exclusively via Docker Compose within Theta Suite" claim.
- Fixed stale links to the old per-repo GitHub Pages sites.
- Docs site (`docs/jump-host/`): same section removal, added a WireGuard mesh-routing feature bullet, refreshed screenshots, fixed three more stale absolute links in `architecture.md`. Deleted the same kind of stale `docs/jump-host/README.md` meta-doc.

## [v2.0.1] - 2026-08-09

Rolls up **sso-manager-node v2.0.1** and **theta-agent v2.0.1**.

### Added
- **Non-Root Secrets Group Access**: Set up `theta-secrets` and `theta` system groups in `setup.sh` and set permission flags to `0750` on `/etc/theta42` and `0640` on `agent.yml` to allow non-root users in the group to request secrets.
- **Autostart Tray Icon Companion**: Configured `/etc/xdg/autostart/theta-agent-tray.desktop` in `setup.sh` to automatically launch the desktop tray icon companion.
- **OpenBao / OpenBoa Resource Exclusion**: Skipped internal secret/renewer services from populating the directory resources catalogue.
- **Full Docker Integration Tests**: Rewrote the integration test runner (`test-integration.sh`) to support full env-mode LDAP seeding (`seed-test-user.sh`) and pass test environment configs/parameters reliably inside Docker containers.

## [v2.0.0] - 2026-08-09

Rolls up **sso-manager-node v2.0.0**, **theta-agent v2.0.0**, **jump-host v2.0.0**.

### Added
- **Theta Gateway (\`jump-host\` v2.0.0)**: WireGuard mesh exit node management, QR code profiles, \`.conf\` file downloads, and automatic X25519 keypair bootstrap.
- **Theta Agent (v2.0.0)**: System tray status companion badge, systemd logind desktop session detection, and real-time CPU / disk / process telemetry stream.
- **SSO Directory (\`sso-manager-node\` v2.0.0)**: Live telemetry dashboard cards, desktop session power controls (lock, display off, logout, sleep), and site reconciler.

## [v1.48.0] - 2026-08-08

Rolls up **sso-manager-node v1.33.0**, **theta-agent v1.8.0**, **proxy v1.35.1**, **jump-host v1.19.1**.

### Added
- **Directory Key Badges & Secret Search/Filter.** Added key badges `🔑 Secret` to resources with stored OpenBao secrets, secret key search filtering, and a `With Secrets` tree toggle.
- **Discovered Inventory Merge & Ignore Actions.** Supported merging discovered network devices into existing Directory resources and ignoring unmanaged entries.
- **Kind-Specific Resource Creation Modals.** Added dedicated `+ Add Site`, Host, and Service creation workflows.
- **Optional Child Secret Key Name on Inheritance.** Made key name optional when inheriting parent secrets — defaulting to the original parent secret key name if left blank.
- **Agent Tab Versioning, Logged Users & Desktop Operations.** Added Agent Version badge (`v1.8.0`), physical partitions table, active logged-in sessions list (`who` / `host.Users()`), and desktop session/power controls (Lock, Display Off, Log Out, Sleep Host).

## [v1.47.0] - 2026-08-08

Rolls up **sso-manager-node v1.32.0**, **theta-agent v1.7.0**, **proxy v1.35.1**, **jump-host v1.19.1**.

### Added
- **Subtype Management & Metrics Drivers Architecture.** Implemented a 4-tier resolution engine (`services/driver_registry.js`) binding resource `subType` metadata (`systemd`, `docker`, `proxmox`, `wireguard`, `postgresql`, `redis`, `unifi`, `k8s`) to operational telemetry, log streaming, and remote lifecycle control.
- **Explicit Secret Inheritance Mode.** Enforced strict upward ancestor lineage (`Resource -> Host -> Cluster -> Site`) for secret inheritance with explicit pointer resolution (`INHERIT:<parentSlug>:<parentKey>`).
- **Cross-Platform Theta Agent Binaries.** Compiled native zero-dependency Go binaries for **Linux (amd64, arm64, armv7)**, **Windows (amd64, arm64)**, and **macOS (Intel, Apple Silicon M1/M2/M3/M4)**.
- **Consolidated External App Tokens.** Relocated external OpenBao App Token minting into the **Configuration** page (`/conf` -> External App Tokens tab) and deprecated standalone `/vault` navigation item.
- **Multi-Secret Support.** Supported multiple secret keys per resource in OpenBao `secret/data/resources/<slug>/conf` with per-key merging and deletion.
- **Automated Integration Testing.** Fixed `test-integration.sh` to use modern `docker compose` syntax and added driver test coverage.

### Fixed
- **Ancestry Lineage Querying.** Fixed `Resource.findAllAncestors(id)` memory filtering over `ResourceEdge.list()` to resolve deep ancestor lineage across all graph depths.
- **Dockerfile Driver Staging.** Added `COPY nodejs/drivers ./drivers` to `Dockerfile.openldap` and `Dockerfile.test-runner` for clean container execution.

## [v1.46.0] - 2026-08-07

Rolls up **theta-agent v1.6.0**, **sso-manager-node v1.31.0**, **jump-host v1.19.1**.

### Added
- **On-demand CLI Secret Fetching.** `theta-agent get-secret <key>` and `theta-agent get-secrets [--env|--json]` for dynamic secret resolution without plaintext files on disk.
- **Resource Secrets Engine & Zero-View Security.** OpenBao KV-v2 encrypted secrets for directory resources with strict regex validation (`^[A-Za-z0-9_]+$`), password generator, and multi-level hierarchy secret inheritance.
- **OpenBao `sso-broker` Policy.** Granted `secret/data/resources/*` and `secret/metadata/resources/*` permissions to `sso-broker`.
- **Zero-Trust LDAP WebSocket Tunnel.** Auto-starts local `/run/theta/ldap.sock` and `127.0.0.1:3890` loopback listeners on managed nodes.
- **Agent Self-Update & Service Control.** Added `theta-agent update` and `theta-agent reinitialize` CLI commands with automated service restarts (`sssd`, `sshd`).

## [v1.45.0] - 2026-08-06

Rolls up **sso-manager-node v1.30.2**, **proxy v1.35.1**, **jump-host v1.19.1**.

### bootstrap.js — Directory topology fix

**`host_theta-proxy` / `host_theta-jump` were synthetic `kind: 'host'` resources that never should have existed.** "Host" means a real, independently-existing machine — something with its own OS and sshd. A Docker container backing one of this stack's own services is never that: it has no sshd, no independent network identity. Proxy and jump-host are two of this stack's five containers, running on the one real stack host — not machines of their own.

A 2026-08-05 change gave them their own `host` resources to fix their services being parented to the stack host, solving that parenting problem with the wrong tool — the correct one, `kind: 'container'`, already existed one layer below `service` (same as `sso-manager` and `openbao` already used correctly). Beyond being conceptually wrong, this had a real functional consequence: jump-host resolves its "hosts you can reach" list from exactly `kind: host` resources, so it could offer `theta-proxy`/`theta-jump` as SSH targets — machines that don't exist and can't be reached.

Fixed: `bootstrap.js` no longer creates the synthetic hosts. Proxy's and jump-host's services parent directly onto the stack host, like every other component. On an install seeded between 2026-08-05 and this release, the fix self-heals on the next `./setup.sh` run — existing children are re-parented onto the real host and the now-empty synthetic host resources are removed automatically; a fresh install never creates them.

### Docs

- `README.md`'s architecture diagram and "Repo layout" section described a stale 2-service (sso-manager + proxy) architecture from before jump-host and OpenBao existed — updated to match the (already-accurate) `docs/architecture.md`, and listed only 2 of 5 git submodules — added the rest.
- `docs/fixtures.md` (new) — the canonical demo-fixtures reference: exact users/groups/hosts for a consistent homelab/small-business demo dataset, so future screenshot passes only need to re-capture pages whose UI actually changed.
- `docs/screenshots.md` (new) — the screenshot-capture workflow, including two gotchas hit while building it: a stale-browser-cache issue with `app.modal.js`, and never touching a login form that autofills a real saved credential.
- `bootstrap/seed-demo-users.sh` (new) — idempotent script seeding the fixtures.md user/group list via direct LDAP writes matching the app's own schema.

## [v1.44.0] - 2026-08-06

Rolls up **sso-manager-node v1.30.1**.

### sso-manager-node v1.30.1

**Test Email and Test SMS could never have worked, and all SMS delivery was broken.**

- Test Email threw `Email.send is not a function`: `models/email.js` exports `{Mail}`, and the handler required the module and called `.send` on it directly.
- Test SMS threw `Unexpected token '<', "<!DOCTYPE "...`: it POSTed to `https://api.voip.ms/v1.0/sms/send`, an endpoint that does not exist. VoIP.ms's REST API is a GET against `voip.ms/api/v1/rest.php` with `api_username`/`api_password` and `method=sendSMS`, so the fabricated URL returned an HTML page and `response.json()` threw.
- **Every SMS was broken, not just the test.** `models/sms.js` called `PluginInstance.find({…})`, but the ORM has no `find` — the query method is `list({where})`. It threw on every send, before it could even fall back to the direct VoIP.ms path, so OTP-by-SMS and notifications were dead too.
- Both test endpoints now send through the same senders every real message uses. A test that reimplements delivery proves nothing about whether real delivery works — which is how two independently broken paths went unnoticed. Failures report as `400` with the underlying reason instead of an opaque `500`.
- New guard suite fails the build on any call to a non-existent ORM static, on requiring `models/email` without destructuring `{Mail}`, and on any reference to the bogus `api.voip.ms` host.

**Install Agent offers the join-key flow.** v1.43.0 shipped join keys in the API and documented the modal as the place to get one, but the modal itself still only did the pre-register flow. It now leads with "Join key" — mint one, copy a single install command, and the host enrolls itself.

### Release note

Tagged with GitHub Actions in a major outage. CI could not run (every job failed at *Set up job* with `Failed to resolve action download info: Service Unavailable`, before reaching any test). Verified locally instead, on the exact merged commit: the full Docker suite — same LDAP + Redis service containers CI uses — passed **299/299**, plus proxy 176/176, jump-host 43/43 and theta-agent green. The Node 18/20/22 matrix was not exercised.

## [v1.43.0] - 2026-08-06

Rolls up **sso-manager-node v1.30.0**, **theta-agent v1.5.1**, **proxy v1.35.0**. Fixes what a fresh `setup.sh` install actually produced under v1.42.0.

> **No manual step to re-enroll agents.** v1.42.0 required an admin to pre-register every host. `setup.sh` now mints a **join key** and the agent enrolls itself, so installing the agent is once again all it takes to add a host.

### Fixed — theta-suite orchestration

- **The stack's own theta-agent could never connect.** `setup.sh` generated a random token locally and wrote it into `agent.yml`. The SSO only accepts credentials it issued, so that token was rejected on every attempt and the agent looped on `close 4001: Unauthorized` forever. It now writes a join key the SSO minted; the agent exchanges it for its own token and the SSO's public key on first connect and rewrites its own config.
- **`agent.yml` was left holding literal placeholders.** The `REPLACE_WITH_ISSUED_AGENT_TOKEN` / `REPLACE_WITH_SSO_PUBLIC_KEY` strings were shipped as-is when the seds no longer matched the renamed fields, so the file on a fresh install contained no credential at all. The file is also `chmod 600` now that it holds one.
- **A fresh install presented its own five containers as unmanaged discoveries** (`theta-proxy`, `theta-jump`, `sso-manager`, `bao-renewer`, `openbao`). The compose project name is now passed to the Docker discovery plugin, which recognises them as ours and links each to the service it implements.
- **`openbao` and `bao-renewer` had no directory entries**, so their containers had nothing to attach to and appeared as parentless roots. Both are seeded as services now — they are part of what the stack deploys and belong in the directory like every other component.

### Added

- The bootstrap mints a theta-agent join key and hands it to `setup.sh` (`AGENT_JOIN_KEY`), reusing the `setup`-labelled key across runs.

---

### sso-manager-node v1.30.0

**Join keys.** `POST /api/agent/join-keys` mints one credential an operator hands out; a host presenting it is enrolled automatically and immediately issued its **own** per-agent token plus the public key to pin. The join key is a bootstrap credential, never the host's identity — one key stays convenient without becoming a fleet-wide skeleton key, every host remains individually revocable, and revoking a key stops new hosts joining without touching enrolled ones.

**Collapsing the Directory tree did nothing.** `applyTreeCollapse` found the caret with `.tree-caret i` and returned early when absent — Font Awesome's SVG-with-JS mode rewrites `<i>` to `<svg>`, so that selector matched nothing and the early return skipped setting `hideBelowDepth`, meaning no row was ever hidden. State now lives on the caret button, rotated by CSS.

**Discovery Plugins.** The delete button called `deleteDiscoveryPlugin()`, which was never defined. The pane also had no `.actionMessage`, and confirmations render into one — without it the promise never settles, so an awaited confirmation hangs forever and the gated action silently never happens. Instances can now be edited (secrets shown blank rather than prefilled with the mask).

**Discovery.** Docker container slugs came from the container id, which changes on recreate, so every deploy minted a new resource and orphaned the old one; they now derive from compose project + service.

**Docs.** `/docs/discovery` 404'd; new `docs/discovery.md`. The `agents` slug pointed at `plugins.md`, leaving `docs/agents.md` unreachable in-app.

### theta-agent v1.5.1

- `join_key` config field, presented while `auth_token` is empty. The agent persists the issued token + public key into its own `agent.yml` — line-based, so comments, capabilities and formatting survive — and blanks the join key.
- Sends `?hostname=` so a self-enrolling host is named after itself; refuses to connect with no credential rather than presenting an empty one.
- `install.sh --join-key`.
- **v1.5.1 rebuilds the prebuilt `theta-agent-linux-amd64`.** `setup.sh` installs that committed binary rather than building from source, and the v1.5.0 one predated join-key support — it would have received a `join_key` it did not understand. Same trap as the v1.3.0 heartbeat fix.

### proxy v1.35.0

- Permission entries can be **edited**; previously only Delete existed, so changing a role meant delete-and-re-add. Because a permission's id is derived from (subjectType, subject, scope, domain), changing any of those replaces the record — the endpoint creates the new grant and removes the superseded one in that order, so an edit can never leave the old grant conferring access.

## [v1.42.0] - 2026-08-05

Rolls up **sso-manager-node v1.29.0**, **theta-agent v1.4.0**, **proxy v1.34.0** and **jump-host v1.19.0**.

> **Breaking — re-enroll your theta-agents.** The SSO now rejects agent tokens it
> did not issue. Any agent installed before this release carries a token
> generated in the browser that the server never recorded, and will be refused
> with close code `4001` until re-enrolled from **Directory → Install Agent**.
>
> **Re-run `./setup.sh`.** The `sso-broker` OpenBao policy needs the new
> `secret/agent/*` grant, or the SSO cannot persist its agent signing key and
> will refuse every high-risk agent command.

### Fixed — theta-suite orchestration

- **Per-host SSO returned `400 redirect_uri is not registered for this client`.** The bootstrap registered only the proxy's own management callback (`https://<proxy-host>/api/auth/oidc/callback`), but per-host SSO calls back to `https://<protected-host>/__proxy_auth/callback` — a different URL for every host the proxy fronts, all against that one OAuth client. It now also registers `https://**.<domain>/__proxy_auth/callback` and the bare apex, and `ensureRedirectUris()` backfills them onto an existing client so upgraded stacks are fixed too, not just fresh installs. (The SSO's wildcard matcher already supported this; nothing was ever registered to use it.)
- **Seeded services were parented to the wrong host.** `theta-proxy` and `theta-jump` were created as host resources and then left childless, while the Proxy, OpenResty Edge and SSH Jump Host services hung off the stack host instead. They now parent to the host that runs them. `reparent()` corrects existing installs on the next run, and only when the current parent is exactly the one the old code set — a layout an operator arranged deliberately is left alone.
- The directory-edge fetch added for re-parenting is tolerated separately from the resource list, so losing it can't skip seeding the resources themselves.

### Added — theta-suite orchestration

- **The proxy gets a read-only SSO API token.** Minted by the bootstrap and written into `proxy-secrets.js` (before the OpenBao snapshot, so the running proxy actually receives it), backing the per-host SSO group autocomplete. Idempotent: only mints when `sso.apiToken` is still empty.
- `setup.sh` writes an `sso: { url, apiToken }` block into the generated `proxy-secrets.js`.
- The `sso-broker` OpenBao policy grants `secret/agent/*` for the persistent theta-agent signing key.
- `docs/secrets.md` documents the signing key, why it must be stable, and what happens when the grant is missing.

---

### sso-manager-node v1.29.0

**Security — the theta-agent channel authenticated nothing.** `/api/agent/ws` accepted any token string; there was no agent registry, because tokens were generated in the *browser* and never recorded server-side. Anyone who could reach the SSO could register as a node, publish discovery/telemetry into the admin view, and receive commands — including a signed `arbitrary_bash` — addressed to a token they guessed.

- Agents are now rows in a new `Agent` table, authenticated by SHA-256 token hash *before* the connection is registered or the welcome payload is sent. Unknown/revoked → close `4001`, audited.
- `POST /api/agent/enroll` mints the token server-side and returns it once; only its hash is stored. Rotate/revoke/delete drop the live socket immediately (`4004`/`4003`).
- Commands are addressed by agent **id**, never by token.
- The Ed25519 signing key was generated in the `AgentManager` constructor, so it changed on every restart and the `public_key` pinned in an agent's `agent.yml` stopped matching. It now lives in OpenBao at `secret/agent/signing-key`; if it can't be loaded the SSO refuses high-risk commands rather than signing with a key no agent has seen.
- Enroll/update/rotate/revoke/delete, every command, and every rejected connection are audited with the acting user.

**Directory & agents.** Agents bind to a host resource instead of being matched by hostname; a bound agent's discovery is written onto that resource (`discovery_sources: ["theta-agent"]`) — previously the one source running *on* the host contributed nothing. Enrollments survive restarts, so "installed but offline" (red) is now distinguishable from "no agent" (grey). The Install Agent modal enrolls first and emits `--public-key`, which was never written into `agent.yml` before.

**Directory tree.** Collapsible, with per-browser persisted state; an active search overrides collapse so matches inside folded subtrees aren't hidden.

**Discovery — found by running against a live 3-node Proxmox cluster.**

- MACs and IPs were collected into two flat lists and zipped by index, attributing addresses to the wrong NIC on multi-NIC guests. NICs are now keyed by MAC.
- A Proxmox endpoint resource now parents its nodes (one endpoint = one subtree), carrying no IP — giving it the address it's reached at made the reconciler merge it with the node answering there, producing a resource that was **its own parent**. Self-edges and cycle-closing edges are refused.
- Hosts were named after their MAC address, because `bestName` preferred the longer string. Names are ranked hostname > IP > MAC.
- `isIp` never matched anything (`\\.` in a regex literal matches a backslash, not a dot).
- Guests carry `sourceId`/`node`/`vmid`/`macAddress`; container and overlay interfaces (`docker0`, `veth*`) are filtered out; stopped VMs still report a MAC; DHCP LXCs get an address; nodes report their own IP/MAC; offline nodes are recorded rather than skipped.
- Cross-kind merges prevented; the inventory is read once per run instead of once per incoming resource.

**Other.** The Profile page's API Tokens card is no longer wider than every other card (it sat outside the page container). `Dockerfile.test-runner` never copied `nodejs/plugins`, so every plugin test suite had been failing in CI as "Cannot find module" — suites 27 → 29, 296 tests passing.

### theta-agent v1.4.0 (protocol v1.2.0)

- **Fail-closed verification.** `verifySignature` returned `true` when no `public_key` was configured — and the installer never wrote one, so a default install executed `reboot`, `configure_ldap`, `arbitrary_bash` and `update_binary` **unverified**.
- **Canonicalization disagreed with the server.** Go's `encoding/json` escapes `<`, `>` and `&`; `JSON.stringify` does not. Any payload containing them failed verification — for `arbitrary_bash` that is most real scripts (`>` redirection, `&&`). Now uses `SetEscapeHTML(false)`.
- Handles the SSO's enrollment close codes and backs off 5 minutes instead of retrying a dead credential every 5 seconds forever.
- The connect log no longer prints the URL, which carried `?token=`.
- `install.sh --public-key`, and a loud warning when none is configured.

### proxy v1.34.0

- The per-host SSO **Allowed groups** field autocompletes from the SSO directory's groups. It previously suggested only local groups — the one set of values that can never match, since the allow-list is checked against the SSO's `groups` claim. New `conf.sso` block; degrades silently when unset.
- Authenticates with `Authorization: Bearer`, not the `auth-token` header.

### jump-host v1.19.0

- **Only catalog hosts are jump targets.** The filter treated a missing `managed` flag as permission, so unpromoted discovery results — Proxmox guests, UniFi clients — appeared in the TUI picker and were accepted by the username grammar. It now mirrors the SSO Directory's own rule.

## [v1.41.0] - 2026-08-05

### Fixed
- **The Local Docker daemon discovery plugin no longer errors** — the sso-manager container had no access to the host docker socket, so the seeded `docker-local` plugin (socketPath `/var/run/docker.sock`) failed with `ENOENT` and showed "Last run: error". `docker-compose.yml` now mounts `/var/run/docker.sock` into the container. Recreate the container (`docker compose up -d sso-manager`) and hit "Run now" on the plugin.
- **theta-agent ships the rebuilt binary with the heartbeat fix** (v1.3.1, gitlink `51750d0`) — the prebuilt `theta-agent-linux-amd64` predated the v1.3.0 `heartbeat_ack` fix, so the installed agent still logged "Unknown command type: heartbeat_ack". Now rebuilt + tested.

## [v1.40.0] - 2026-08-05

### Fixed
- **No more spurious "Invalid Credentials, login failed" during LDAP enrollment** (ldap-client v1.25.0, gitlink `68fcdb5`) — `index.sh` self-registered the host in the Directory when `sso_token` was *declared but empty* (it checked `[[ -v ]]`), POSTing an empty Bearer token and getting a misleading `LDAPLoginFailed`. It now only registers with a real token; the stack host (already seeded by the bootstrap) skips registration.
- **The `cn=ldapclient` service account now shows in the SSO Users UI** — it was created as a bare `organizationalRole` (invisible to the `posixAccount` user filter) and never joined `app_sso_service_account`, so it never appeared as a service account. The bootstrap now creates it as a `posixAccount` (uid 10001, above the regular-user reserved floor) and adds it to `app_sso_service_account`; for an existing account it best-effort adds the `posixAccount` shape (auxiliary, so it can't conflict with the structural `organizationalRole`) + the group membership.

## [v1.39.0] - 2026-08-05

### Fixed
- **Plain LDAP (389) now reachable from the host** — `docker-compose.yml` published only LDAPS (636); plain LDAP (389) was deliberately not mapped, so the stack host's own enrollment (`setup.sh` → ldap-client, which configures sssd against `ldap://localhost:389` and `ldaps://localhost:636`) could not reach the directory over loopback. Both 389 and 636 are now published to the host (bind 0.0.0.0; `LDAP_BIND`/`LDAPS_BIND=127.0.0.1` to lock to the host only).

## [v1.38.0] - 2026-08-04

### Fixed
- **LDAP enrollment no longer reaches for the public domain** — `setup.sh` generated `ldap.vars` with `ldap_host` defaulting to the public SSO host (`sso.<domain>`), which the NAT/firewall blocks on the LDAP ports (389/636). It now defaults to `localhost` (the LDAP server is co-located on the stack host; `ldap_tls_reqcert=never` makes this safe), overridable with `CFG_LDAPS_HOST` for an internal hostname/IP.
- **SSH access groups match the SSO group model** (ldap-client v1.24.0) — the generated `sssd.conf` access filter and `ldap-ssh-key.sh` referenced the legacy names (`<location>_access`, `app_super_admin`); they now use `site_<location>_hosts_access` (all-hosts aggregate), `site_<location>_host_<hostname>_access`, and `god_admin`. GROUPS.md §8's example updated to match.

## [v1.37.0] - 2026-08-04

### Changed
- **Group naming corrected to match docs/GROUPS.md** — per-resource groups are `{site}_{kind}_{name}_{level}` (kind always present; a host `host_theta-env` → `site_local_host_theta-env_access`, a service → `site_local_app_sso-manager_access`). The spec's §3 text was updated to state this explicitly.
- **Roll up sso v1.27.0** — group names match the docs, a site carries only god + site-wide groups, duplicate group links removed, `/api/agent/*` no longer 404s, shared-secrets POST/GET fixed, Vault Apps tab lists minted tokens, discovery promote + plugin run logs fixed. See the [sso changelog](https://github.com/theta42/sso-manager-node/blob/master/CHANGELOG.md).

## [v1.36.1] - 2026-08-04

### Fixed
- **`setup.sh` no longer aborts with `CFG_BASE_DN: unbound variable`** — the ldap-client `ldap.vars` generation read the CFG_* first-run vars, which `ensure_config` only derives once (it returns early on a re-run once `sso-secrets.js` exists). It now reads the real values from the operator-owned `./config/sso-secrets.js` when the CFG_* vars are unset, so LDAP enrollment works on re-runs too. The generated `ldap_access_groups` now references `god_admin` (the legacy `app_super_admin` is gone).
- **Roll up sso v1.26.1** — drops the legacy `app_super_admin`: `SUPER_ADMIN_GROUP` is now `god_admin` (nested into every resource's `_admin` group), and `docker-entrypoint.sh` no longer seeds/nests `app_super_admin`. See the [sso changelog](https://github.com/theta42/sso-manager-node/blob/master/CHANGELOG.md).

## [v1.36.0] - 2026-08-04

### Added
- **`god_admin` seeded + site groups auto-provisioned** (sso v1.26.0) — `god_admin` exists from first boot; every site gets `{site}_super_admin`, `{site}_hosts_*`/`{site}_apps_*` aggregates and `{site}_everyone`; per-resource groups (`{site}_{slug}_{level}`) nest into the site aggregates (the inheritance lattice now exists in LDAP, not just the resolver). See the sso changelog for the full group-model completeness + server-side naming enforcement + Directory god_admin management.
- **Docker discovery plugin configured out of the box** — the bootstrap seeds a `docker-local` plugin instance pointed at `/var/run/docker.sock`, so a fresh stack discovers its own containers into the Directory immediately (idempotent; an operator-created instance is left alone).

### Fixed
- **ldap-client enrollment no longer fails** — `setup.sh` was calling `ldap-client/index.sh`, which refuses to run without a gitignored `ldap.vars` that nothing ever created (the "ldap.vars file not found!" + "enrollment failed" you saw). It now generates `ldap-client/ldap.vars` from the stack's own config (LDAPS host, base DN, `cn=ldapclient` bind + service password, SSO URL, site name) before enrolling; an operator-provided `ldap.vars` is always kept.
- **theta-agent no longer logs `Unknown command type: heartbeat_ack`** every minute — the server's ack of the agent's own heartbeat is now silently ignored instead of falling through to the unknown-command handler (which also answered with a spurious error).

### Changed
- **Roll up sso v1.26.0 + theta-agent v1.3.0** — gitlinks point at the version-tagged commits for both submodules (sso-manager-node → 8a9de94, theta-agent → 52379c2). Full changelogs: [sso](https://github.com/theta42/sso-manager-node/blob/master/CHANGELOG.md), [theta-agent](https://github.com/theta42/theta-agent/blob/master/CHANGELOG.md).

## [v1.35.18] - 2026-08-04

### Changed
- **Sync proxy + jump-host gitlinks to their version-tagged commits** — proxy v1.33.0 and jump-host v1.18.0 bumped their package.json to match their tags; this release picks up those corrected gitlinks so a fresh deploy reports the matching versions.

## [v1.35.17] - 2026-08-04

### Added
- **Group & Permission Model spec** — canonical documentation of the hierarchical group schema (`god_admin`, `{site}_super_admin`, per-site/per-resource host+app `admin`/`access`/`<capability>` groups, meta `everyone`/`{site}_everyone`), the inheritance resolver, Directory-only group management, multi-site isolation, host-side SSSD GID mapping (groups are `groupOfNames`, no `gidNumber`), downstream-app consumption, and migration from the legacy `app_*` groups. See [GROUPS.md](GROUPS.html).
- **sso v1.25.0** — the resolver + schema implemented in the SSO (see its changelog); the standalone Groups page removed.

## [v1.35.16] - 2026-08-04

### Added
- **theta-proxy + theta-jump as first-class managed host resources** — the bootstrap now seeds them as managed `host`-kind resources in the Directory (in addition to the existing stack host and its service entries), so a fresh install shows them as hosts.

## [v1.35.15] - 2026-08-04

### Fixed
- **theta-agent re-install failed with "Text file busy"** — setup.sh copied the prebuilt binary over a running agent service, which cp refuses. It now stops the service before copying.

## [v1.35.14] - 2026-08-04

### Fixed
- **The recurring `/vault` 403 "permission denied" is actually dead this time — it was never a policy problem.** sso's `/api/vault` proxy declared its request hook with http-proxy-middleware **v3** syntax (`on: { proxyReq }`) while the app installs HPM **v2**, which silently ignores the unknown key — so `X-Vault-Token` was never injected and every vault call reached OpenBao unauthenticated. All the policy work of v1.35.10/v1.31.1 was correct and is unchanged; the requests just never carried a token. Ships as **sso v1.23.0** (see its changelog for the companion `fixRequestBody` header-ordering fix and the initORM schema heal that unbreaks the plugin scheduler on upgraded databases).

### Added
- **OpenBao token lifecycle — nothing expires by surprise anymore.**
  - New **`theta-svc` token role** (periodic 768h): `SSO/PROXY/JUMP_VAULT_TOKEN` are now minted through it instead of as plain orphan tokens with a hard ~32-day death date. `ensure_token` renews periodic tokens on every `setup.sh` re-run and detects, revokes, and re-mints valid-but-non-periodic tokens from older installs (detection is the token's `role` — OpenBao token lookup does not expose a `period` field).
  - New **`bao-renewer` sidecar** (docker-compose): renews the three service tokens every 12h while the stack runs, logging each result. Recreated on every `setup.sh` run so it always holds the current tokens.
  - New **`sso-app` token role** (periodic 768h): external-app tokens minted from the vault UI go through it instead of the broker's 24h role, and sso now stores each app token's *accessor* and auto-renews it (boot + every 6h) — a downstream app's credential stays valid as long as sso runs, with no renewal code in the downstream app.
  - `sso-broker` policy gained `update` on `auth/token/create/sso-app` and `auth/token/renew-accessor`/`revoke-accessor`/`lookup-accessor`.
  - `docs/secrets.md` rewritten around the new lifecycle (roles table, renewal layers, disaster recovery).

## [v1.35.13] - 2026-08-04

### Added
- **sso v1.22.0** — new **Agents** page (live list of connected theta-agent hosts with CPU/RAM/disk/ZFS/GPU telemetry + online status) and a security fix gating the `/api/agent` REST routes. Bumped the sso-manager-node gitlink to v1.22.0.

## [v1.35.12] - 2026-08-04

### Fixed
- **theta-agent crash-looped (`cannot unmarshal !!bool 'true' into []string`)** — setup.sh's "full control" edit wrote `service_control: true`, but that field is a `[]string` allowlist, so the agent failed to decode the config and restart-loop. Removed the invalid edit; `service_control` now stays as its allowlist (default `[]` = deny all) and the operator can list specific services.

## [v1.35.11] - 2026-08-04

### Fixed
- **`setup.sh` aborted with `UNSEAL_KEY: unbound variable` on re-runs** — when OpenBao was already unsealed, the unseal block was skipped and `UNSEAL_KEY` was never set, so the later `if [[ -n "$UNSEAL_KEY" ]]` crashed under `set -u`. Guarded with `${UNSEAL_KEY:-}`.

## [v1.35.10] - 2026-08-04

### Added
- **`--reset-openbao`** — full clean OpenBao reset for clearing stale policies/tokens (re-inits the store, flushes the Redis vault-token cache). Use when the vault UI shows a recurring `403 permission denied` on the secrets list.
- **sso v1.21.0** — shared secrets: users publish secrets to `secret/shared/<owner>/<slug>` and grant read access to other users and apps; plus a durable fix for the recurring vault 403 (broker now always reconciles policy content before serving a cached token). Bumped the sso-manager-node submodule gitlink to v1.21.0.

### Fixed
- **theta-agent was never installed** — `setup.sh` tried to `go build` from an incomplete source-file list (omitting `executor.go`/`telemetry.go`), which failed silently and skipped install. It now installs the prebuilt `theta-agent-linux-amd64` binary from the submodule and writes config to `/etc/theta42/agent.yml` (the path the agent actually reads).

## [v1.35.9] - 2026-08-03

### Fixed
- **sso & proxy version strings now match their release tags** — The v1.20.2 / v1.32.0 release tags were created but their `nodejs/package.json` version fields were left behind (1.20.1 / 1.14.3), so the deployed apps' update-check banner falsely reported a newer version. Bumped submodules to the corrected commits so `buildVersion` matches the deployed tag.

## [v1.35.2] - 2026-08-03

### Fixed
- **Unbound `CFG_CREATE_ALL_HTTP` variable in `setup.sh`** — Fixed unbound variable error during host registration in `setup.sh` when `ensure_secrets_files()` is skipped on pre-configured installations.

## [v1.35.1] - 2026-08-03

### Fixed
- **Directory & Configuration UI enhancements** — Live Cytoscape graph update on parent/child edge modifications, improved discovery reconciler host matching, updated configuration sidebar layout, relocated discovery and messaging plugins to Directory and Configuration pages.
- **Managed Host Target Filter** — Filter SSH connection targets in Jump Host to managed hosts only.

## [v1.35.0] - 2026-08-02

### Added
- **Non-interactive theta-agent configuration** — Added three `setup.env` variables
  to control theta-agent installation and configuration without interactive prompts:
  - `CFG_THETA_AGENT_ENABLE` (default: 1) — Enable theta-agent installation
  - `CFG_THETA_AGENT_LDAP_AUTH` (default: 1) — Configure LDAP authentication via ldap-client
  - `CFG_THETA_AGENT_FULL_CONTROL` (default: 1) — Enable all agent capabilities

### Changed
- **`setup.sh`**: Made theta-agent setup fully non-interactive, driven by `setup.env`
  variables. Defaults preserve existing behavior (all features enabled).

## [v1.34.0] - 2026-08-02

### Added
- **theta-agent**: Added the agent submodule and C2 WebSocket endpoint integrations to the suite.
- **PKI Certificates**: Integrated PKI certificate generation and management capabilities.

### Changed
- **Submodules bumped**:
  - `sso-manager-node` updated to `v1.19.2` (Includes Discovery graph merge fix).
  - `proxy` updated to `v1.14.1` (Removed invalid documentation copy from Dockerfile).
  - `jump-host` updated to `v1.16.1`.
- **`setup.sh`**: Added robust `|| true` fallback to Redis `LASTSAVE` and `CONFIG GET` commands to gracefully bypass snapshoting if the target container is in a crash-loop.
- **Docs**: Removed all standalone deployment documentation to officially deprecate standalone mode.
- **CI/CD**: Removed redundant submodule unit test jobs from the main orchestration pipeline.

## [v1.33.0] - 2026-08-02

### Changed
- **Submodules bumped** for OpenBao secret integration.

## [v1.32.0] - 2026-08-01

### Added
- **CI/CD**: Added robust GitHub Actions CI/CD workflows for the suite.
- **Docs**: Updated plugin ecosystem documentation.

## [v1.31.1] - 2026-08-01

Pairs the sso v1.17.2 post-deploy fixes with the theta-suite half of the
`/vault` secrets-list 403 fix (the `sso-admin` OpenBao policy grant that lives
in `setup.sh`), and rolls the `sso-manager-node` submodule gitlink to v1.17.2.
`proxy` (v1.13.1), `jump-host` (v1.14.1), and `ldap-client` (v1.23.0) are
unchanged.

### Changed (theta-suite)
- **`setup.sh` — `sso-admin` policy**: added a `list` grant on the bare KV mount
  root `secret/metadata` so an admin can list the top-level dirs in the `/vault`
  UI. `secret/metadata/*` already covered nested paths, but not the mount root
  itself — so the secrets list 403'd. (The matching per-user/per-app directory
  grants ship in sso v1.17.2's `vault_broker.js`.)
- **`setup.sh` — `ensure_policy`**: now always (re)writes the policy instead of
  skipping when it exists. `bao policy write` is an idempotent overwrite, so a
  re-run applies policy edits (like the new grant above) instead of stranding
  the old HCL with "already exists — keeping."

### Changed (submodule gitlinks)
- **sso-manager-node**: `v1.17.1` → `v1.17.2` — the post-deploy fixes (auto-slug
  plugins, schedule dropdown, `/profile` rendering, plugin-edit persistence,
  nmap in the image, the sso-side `/vault` policy grants) plus the SMS (VoIP.ms)
  and Terms-of-Service configuration on `/conf`. Full changelog below.

### Deploy
Operators upgrading from v1.31.0:
1. `git pull` and `git submodule update --init --recursive`.
2. Re-run `./setup.sh` — **required**: applies the new `sso-admin`
   `secret/metadata` list grant and the `ensure_policy` always-write refresh
   (idempotent). Per-user vault policies self-heal on the next `/vault` visit
   (sso v1.17.2 re-writes them).
3. `docker compose build && docker compose up -d` — the rebuild installs `nmap`
   in the sso image (fixes the nmap plugin "not found" error).

### Bundled submodule release notes

#### sso-manager-node v1.17.2 — post-deploy fixes + SMS/TOS on /conf

Post-deploy fixes from testing the v1.31.0 stack, plus the SMS (VoIP.ms) and
Terms-of-Service configuration the `/conf` page was missing.

##### Fixed
- **Plugin slug is now auto-generated** from the instance name — the New Plugin
  modal no longer asks for a Slug (it derives a stable, unique handle from the
  name, appending `-2`, `-3`, … on collision). The generated slug still shows in
  the table and the Edit (read-only) modal. `POST /api/plugins` `slug` is now
  optional; an explicit slug is still accepted and validated.
- **Plugin schedule is a dropdown**, not a raw cron box: Hourly / Daily /
  Weekly, plus **Custom** which reveals the raw 5-field cron input. Stored value
  is still a cron string, so the server is unchanged.
- **`/vault` secrets list no longer 403s.** The per-user, per-app, and admin
  OpenBao policies granted `list` only on `secret/metadata/.../*` (nested
  paths), never on the directory path itself — so listing a directory's
  *contents* (which checks `list` on the directory, e.g.
  `secret/metadata/users/<uid>` or the mount root `secret/metadata`) was denied.
  `vault_broker.js`'s `userPolicyHcl`/`appPolicyHcl` now also grant `list` on the
  bare directory path, and `ensurePolicy` now always re-writes the policy
  (idempotent) so already-created `user-<uid>` policies pick up the new grant on
  the next vault-page visit. The matching `sso-admin` mount-root grant ships in
  theta-suite v1.31.1 (`setup.sh`), where `ensure_policy` is likewise made
  always-write so re-running `./setup.sh` applies policy edits.
- **`/profile` no longer shows literal `{{…}}` tags.** Three template fragments
  sat outside the `jq-repeat="user"` scope, so they rendered raw: the card
  header `Profile: {{user.uid}}`, the `Members of {{user.uid}}'s Group` tab
  label, and the Admin Actions block's `{{#isActive}}`/`{{#isInactive}}`
  buttons. The header/label are now populated by JS (the `Members` label
  already had a setter pointing at a missing id); the Admin Actions block is
  moved inside the scope so `{{uid}}`/`{{#isActive}}`/`{{#isInactive}}` render
  and the correct Activate/Deactivate button shows.
- **Editing a plugin now persists.** The Edit modal had been prefilled with the
  masked secret values and rendered them as fields, but `PUT /:id` only saves
  non-secret config — so an edited secret was silently dropped. The Edit modal
  now shows **non-secret fields only** (secrets have their own Edit-Secrets
  modal), removing the confusion.
- **nmap plugin: "NMAP not found at command location: nmap"** — the `nmap`
  binary was not installed in the app image. `Dockerfile.openldap` now `apk
  add`s `nmap` in the runtime stage, and `plugins/discovery/nmap.js` translates
  the opaque node-nmap spawn-missing error into an actionable `lastError`.

##### Added
- **SMS (VoIP.ms) configuration on `/conf`.** The existing VoIP.ms SMS sender
  (`models/sms.js`, used for 2FA OTP delivery) was configurable only via env /
  config files. It now has an SMS card on `/conf` (API username, DID, API
  password), saved to OpenBao at `secret/sso-manager/conf` under `voipms`, with
  the API password masked (`********`) and leave-blank-to-keep — mirroring the
  SMTP card exactly. `models/sms.js` reads `conf.voipms.*` at call time, so a
  saved change takes effect live without a restart.
- **Terms of Service editor moved to `/conf`** from the admin Overview
  dashboard, where it never belonged. The same `app.tos.get`/`update` flow,
  the "require all users to re-accept" checkbox, and the `app_sso_admin` gate
  (matching `routes/tos.js`'s PUT gate) are preserved. The Overview page keeps
  stats, notifications, and metrics.

## [v1.31.0] - 2026-08-01

Roll-up release: bumps the composed submodules to their latest tags so a fresh
`git clone` + `./setup.sh` deploys the SSO Manager plugin system, the `/conf`
SMTP/OAuth secret masking, and the ldap-client changelog. `proxy` (v1.13.1) and
`jump-host` (v1.14.1) were already at latest and are unchanged.

### Changed (submodule gitlinks)
- **sso-manager-node**: `v1.16.1` → `v1.17.1` (the plugin system shipped in
  v1.17.0, plus the v1.17.1 `/conf` secret-masking hardening).
- **ldap-client**: `v1.1.1` → `v1.23.0` — a CHANGELOG-only release (the new
  `CHANGELOG.md` documenting v1.1.0/v1.0.0; **no code change** — the "UI polish"
  tag message is misleading, the v1.1.1…v1.23.0 diff is `CHANGELOG.md` only).

### Deploy
Operators upgrading from a prior release:
1. `git pull` and `git submodule update --init --recursive` (or a fresh clone).
2. Re-run `./setup.sh` — this is **required** if you haven't yet applied the
   v1.30.1 `sso-broker` OpenBao policy grant for `secret/plugins/*` (idempotent;
   it grants the existing `SSO_VAULT_TOKEN` access live, so plugin-secrets
   storage works).
3. `docker compose build && docker compose up -d`. Existing
   `conf.discovery.plugins` setups auto-migrate into `PluginInstance` rows +
   OpenBao secrets on first boot of sso v1.17.x.

### Bundled submodule release notes

#### sso-manager-node v1.17.0 — real plugin system (loadable instances + OpenBao secrets)

## [1.17.0] - 2026-08-01

A real **plugin system**: the half-built discovery plugins (statically
configured in `sso-secrets.js`, only toggleable for cron/enabled) become
**configurable, loadable/unloadable plugin instances** you manage from a
dedicated **Plugins** page and the `/api/plugins` API, with multiple runtime
copies of each type and per-instance secrets stored in OpenBao.

### Added
- **Plugin instances** — a new `PluginInstance` ORM model
  (`nodejs/models/plugin_instance.js`, Sequelize) is the registry of
  configured, scheduled plugin copies. Each has a `pluginType`, a unique
  `slug` (the discovery source name), a cron schedule, an `enabled` flag
  (load/unload), non-secret `config` (JSON), and last-run bookkeeping. Multiple
  instances of the same type are supported.
- **Plugin registry** (`nodejs/services/plugin_registry.js`) — generalizes the
  one-shot discovery-plugin scan in `scheduler.js`. Plugin types are modules
  under `nodejs/plugins/<category>/<type>.js` exporting a manifest
  (`type`, `category`, `name`, `description`, `configSchema`, `validate`,
  `run`/`discover`). Exposes `getTypes`, `getModule`, `splitConfig` (secret vs
  non-secret), `mask`, and required-field helpers for the UI/API.
- **Per-instance secrets in OpenBao** (`nodejs/utils/plugin_secrets.js`) —
  `configSchema` fields flagged `secret:true` (e.g. a Proxmox `tokenSecret`,
  UniFi `password`) are stored at `secret/plugins/<instance-id>/conf`, never in
  the DB. The UI only ever sees masked (`********`) values. Plugins run
  in-process (BullMQ workers), so they need no OpenBao token of their own — the
  SSO reads/writes via the `sso-broker` token. **Requires theta-suite ≥ v1.30.1**
  for the `sso-broker` policy grant on `secret/plugins/*`; the API fails-soft
  with a clear error if absent.
- **`/api/plugins` API** (`nodejs/routes/api_plugins.js`, replaces the old
  `routes/plugins.js`) — `GET /types`, list/get/create/update/update-secrets/
  test/load/unload/run/delete/runs. Admin-only
  (`app_sso_admin` / `app_sso_directory_admin` / `app_super_admin`).
- **Plugins page** (`/plugins`, `views/plugins.ejs`) + nav entry — instance
  table with New/Edit/Edit-Secrets/Test/Run-now/Load/Unload/Delete, config forms
  rendered from each type's `configSchema`.
- **`validate`** ("Test" button) on the built-in Proxmox/UniFi/Nmap plugins.

### Changed
- `services/scheduler.js` now schedules from the `PluginInstance` table instead
  of static `conf.discovery.plugins` + a Redis override hash. Each instance owns
  a stable BullMQ JobScheduler id (`plugin:<instanceId>`) so load/unload
  upsert/remove one schedule without disturbing the rest. Discovery plugins
  reconcile results under the instance's `slug`.
- The three discovery plugins (`plugins/discovery/{proxmox,unifi,nmap}.js`)
  gained manifests (`configSchema`, `validate`, `run` alias). `nmap`'s
  `targetRange` is non-secret; Proxmox `tokenSecret` and UniFi `password` are
  secret.
- The `/plugins` page route renders the page instead of redirecting to
  `/directory`; the **Agents & Scheduler** tab was removed from `/directory`
  (plugins are now managed on the Plugins page). The `/docs/agents` link is
  aliased to `/docs/plugins`.
- `docs/plugins.md`, `docs/vault.md`, `docs/_config.yml` (nav), and `API.md`
  (Plugin Endpoints section) document the new system.

### Legacy migration
On first boot of v1.17.0, if the `PluginInstance` table is empty **and**
`conf.discovery.plugins` has entries, one instance per configured type is seeded
automatically (secret fields copied into OpenBao). After that the static
config is ignored — manage plugins from the UI/API. Idempotent (guarded by the
empty-table check).

### Prerequisite
**theta-suite ≥ v1.30.1** — re-run `./setup.sh` after upgrading so the
`sso-broker` OpenBao policy is granted `secret/plugins/*`. Without it, storing
plugin secrets fails with a clear error.


#### sso-manager-node v1.17.1 — mask SMTP/OAuth secrets + leave-blank-to-keep on /conf

## [1.17.1] - 2026-08-01

Hardens the **runtime SMTP/OAuth secret handling** on the `/conf` admin page to
match the plugin-secrets discipline: the SMTP password and OAuth JWT secret are
no longer returned in cleartext by `GET /api/conf` or round-tripped through the
form. They remain saved in OpenBao at `secret/sso-manager/conf` at runtime
(unchanged) — only how they're surfaced to the admin changes.

### Changed
- **`GET /api/conf`** now masks `smtp.pass` and `oauth.jwtSecret` to `********`
  (was: returned in cleartext). Non-secret fields (host, port, user, from,
  secure, issuer, token lifetimes) are returned as before.
- **`POST /api/conf`** now treats a blank or `********` secret-field submission
  as "keep the current stored value" — so an admin editing the From address or
  token lifetimes no longer has to re-enter (or leak) the SMTP password / JWT
  secret. Only a genuinely new, non-blank value overwrites. The preserved values
  are re-applied to live `conf` immediately, as before.
- **`/conf` page** (`views/conf.ejs`): the Password and JWT Secret fields carry
  a "leave unchanged to keep the current value stored in OpenBao" hint; the page
  copy notes secret fields are masked. No JSON-textarea editing is involved —
  SMTP is and remains configured through structured form fields.

### Notes
- SMTP (and OAuth) config was **already** saved to OpenBao at runtime before
  this release (via `POST /api/conf` → `baoConf.set('sso-manager/conf')`, and
  overlaid back at boot by `bao-conf.init`). This release closes the
  cleartext-exposure gap; it does not move the storage path.
- No theta-suite policy change required — `secret/sso-manager/conf` was already
  granted to the `sso-broker` policy.


#### ldap-client v1.23.0 — CHANGELOG-only (no code change)

Adds a `CHANGELOG.md` documenting v1.1.0 (`app_super_admin` / `app_jump_admin`
group support in SSSD access filters; the sso/jump-host TLS-validation
divergence) and v1.0.0 (initial SSSD LDAP auth release). No source changes vs
v1.1.1; the v1.23.0 tag commit only adds this file.

## [v1.30.1] - 2026-08-01

Prerequisite release for the SSO Manager plugin system (shipped in
sso-manager-node v1.17.0). Grants the `sso-broker` OpenBao policy access to the
new per-instance plugin secrets namespace so the SSO can store plugin secrets in
OpenBao instead of `sso-secrets.js`.

### Changed (theta-suite orchestration)
- **`setup.sh`**: added `secret/data/plugins/*` (CRUD+list) and
  `secret/metadata/plugins/*` (list/read/delete) to the `sso-broker` policy
  HCL. `ensure_policy sso-broker` is idempotent, so re-running `./setup.sh`
  immediately grants the existing `SSO_VAULT_TOKEN` access to `secret/plugins/*`
  (policies are evaluated live; the token keeps its id). The SSO side fails-soft
  with a clear error if this grant is absent.
- **Docs**: `docs/secrets.md` (new "Plugin secrets" section + `sso-broker`
  policy row) and `docs/architecture.md` (sso-manager access row) now list
  `secret/plugins/*`.

> The plugin system itself (configurable plugin instances, load/unload, UI/API,
> multi-copy, secrets in OpenBao) is in sso-manager-node v1.17.0; theta-suite
> will bump its submodule gitlink to that release next.

## [v1.30.0] - 2026-08-01

The project is renamed **theta-env → theta-suite** — it has grown from a
docker-compose wiring two projects into an integrated suite of four
applications around a shared OpenBao secrets store, and the name should reflect
that. The GitHub repository is renamed `theta42/theta-env` →
`theta42/theta-suite` (old URLs redirect), and the docs site moves to
`https://theta42.github.io/theta-suite/`.

### Changed (theta-suite orchestration)
- **Renamed theta-env → theta-suite** across the superproject: `docs/_config.yml`
  (`title` + `baseurl: /theta-suite` + repo URLs), `README.md`, `setup.sh`
  (incl. the `THETA_SUITE_REEXECED` self-update sentinel), `docker-compose.yml`,
  `bootstrap/bootstrap.js`, `.github/workflows/lint.yml`, `config.example/*`,
  `docs/robots.txt`, all docs pages, and this changelog.
- **Compose project name note:** docker compose derives the project name from
  the clone directory, so named volumes follow it (`<project>_openbao-data`).
  A fresh `git clone` of `theta-suite` uses the `theta-suite` project name; an
  existing deployment that keeps its `theta-env` directory keeps its
  `theta-env_*` volumes — no data migration is required, just don't mix the two.
- **Docs site baseurl** is now `/theta-suite`, matching the renamed repo's
  GitHub Pages URL.

### Docs
- **`architecture.md` rewritten.** Replaced the outdated "The two containers"
  / "The three repos" framing with the actual topology — four always-on
  services (`openbao`, `sso-manager`, `proxy`, `jump-host`) plus the
  `ldap-client` host-enrollment tool — a real diagram, a full **Secrets
  (OpenBao)** section (central store, scoped per-app policies/tokens, the
  `@simpleworkjs/bao-conf` boot overlay, per-user KV, external-app minting),
  and an OpenBao-aware "how config reaches the apps". Removed the
  LDAP-"legacy apps" wording (direct LDAP binds are first-class: Linux hosts
  PAM/SSSD, sudo, SSH keys).
- **`index.md`** — integrated-suite framing; added **Central secrets (OpenBao)**
  and **ldap-client** to "What you get" and "Related projects".
- **`standalone.md` + `README.md`** — standalone is now framed as an advanced
  opt-in; the integrated `./setup.sh` stack is the supported path.

### Submodule bump
- **sso-manager-node → v1.16.1** — fixes the **401 on `/conf` and `/vault`** for
  a logged-in admin. Both view routes 401'd because this app's auth-token is a
  header set by client JS (localStorage), not a cookie, so `req.user` is
  undefined on a browser navigation; the routes now render the shell and gate
  client-side (`app.auth.forceLogin`), with `/api/conf` + `/api/vault` still
  enforcing auth + OpenBao scope server-side. See the
  [sso v1.16.1 release](https://github.com/theta42/sso-manager-node/releases/tag/v1.16.1).

## [v1.29.0] - 2026-08-01

Two fixes for a fresh `./setup.sh` install, plus the SSH jump host promoted
from an opt-in component to a core part of the stack.

### Fixed (theta-suite orchestration)
- **`setup.sh`** — fresh installs aborted silently right after `Minting
  per-app OpenBao tokens`. The `env_get` helper's `grep | cut` pipeline returns
  non-zero under `set -euo pipefail` when `.env` exists (it's created earlier
  by the root-`VAULT_TOKEN` `env_upsert`) but a given app-token key is absent —
  the normal first-run state. The unguarded `existing="$(env_get ...)"` then
  tripped `set -e` and killed the script before any token was minted. `env_get`
  now always returns 0 (`|| true`), so "key absent" resolves to empty and the
  run continues through token minting, the SSO/proxy bring-up, and the jump
  host. Reproduced + verified the fix under the exact fresh-install condition.
- **`setup.sh`** — `JUMP_VAULT_TOKEN` is now always minted (jump host is core;
  the mint was already unconditional, this just documents it).

### Changed (theta-suite orchestration)
- **jump host is no longer optional** — it is built + started on every run,
  with no `CFG_JUMP_HOST_ENABLED` flag.
  - `docker-compose.yml`: removed `profiles: ["jump-host"]` from the
    `jump-host` service so `docker compose up` includes it unconditionally.
    The test-only `ldap-test-host` downstream fixture keeps an opt-in profile,
    renamed `jump-host` → `ldap-test` (`docker compose --profile ldap-test up`).
  - `setup.sh`: `SUBMODULES` always includes `jump-host`; the build/start +
    host-register + summary lines for the jump host are no longer wrapped in a
    `JUMP_ENABLED` guard; the `COMPOSE_PROFILES` export is gone.
  - `bootstrap/bootstrap.js`: jump-host provisioning (mint API token + write
    `jump-secrets.js` + mirror into OpenBao) and its directory service record
    now run unconditionally — no `CFG_JUMP_HOST_ENABLED` gate.
  - `setup.env.example` / `docs/index.md` / `docs/quickstart.md`: dropped the
    "optional / enable with `CFG_JUMP_HOST_ENABLED=true`" wording; the
    `CFG_JUMP_HOST` hostname override + `JUMP_SSH_PORT` remain.

## [v1.28.0] - 2026-08-01

OpenBao becomes the central secrets store for the whole stack. Every app now
loads its secrets from OpenBao at boot via the new
[`@simpleworkjs/bao-conf`](https://simpleworkjs.github.io/bao-conf/) package;
end users get personal per-user secret storage through the SSO UI; external
apps get scoped `secret/apps/<app>/*` access. `setup.sh` mints the policies
and scoped tokens, `bootstrap.js` writes generated creds into OpenBao, and a
new `docs/secrets.md` documents the architecture.

### Changed (theta-suite orchestration)
- **`setup.sh`** — after the KV-v2 enable, a new idempotent block writes four
  OpenBao policies (`sso-broker`, `sso-admin`, `proxy`, `jump-host`) via
  heredocs, a `sso-broker` token role (`allowed_policies_glob` `user-*`/`app-*`,
  24h period), and mints scoped `SSO_VAULT_TOKEN` / `PROXY_VAULT_TOKEN` /
  `JUMP_VAULT_TOKEN` (orphan, renewable, reused from `setup.env` if still
  valid). `seed_app_conf` seeds `secret/{sso-manager,proxy,jump-host}/conf`
  from the operator-edit `/config/*-secrets.js` files on first run. The
  bootstrap exec now passes the root `VAULT_ADDR`/`VAULT_TOKEN` for seeding.
  The root token stays in `setup.env` for maintenance only — it is never passed
  to a service container. `bash -n` + `shellcheck` clean.
- **`docker-compose.yml`** — `sso-manager`/`proxy`/`jump-host` get
  `VAULT_ADDR=http://openbao:8200` and `VAULT_TOKEN=${SSO|PROXY|JUMP}_VAULT_TOKEN:-`;
  `proxy`/`jump-host` gain `depends_on: openbao: service_started`. compose
  config valid.
- **`bootstrap/bootstrap.js`** — `baoPut()` writes the generated OAuth client
  creds to `secret/proxy/conf` and `secret/jump-host/conf` (POST replaces; the
  full file object), so OpenBao — not the on-disk `/config/*-secrets.js` — is
  authoritative after first boot. Fail-soft. `node --check` clean.
- **`docs/secrets.md`** (new) — the full secrets architecture: load path,
  policy/token table, the `sso-broker` role, seeding, end-user personal
  secrets, external-app convention (curl + Node `bao-conf` examples), operator
  rotation, backups. Linked from the README and the docs nav (`_config.yml`).
- **README** — Configuration section rewritten (OpenBao authoritative, link to
  `docs/secrets.md`); Secrets-backup section adds the `openbao-data` volume.

### Submodule bumps
- `sso-manager-node` → **v1.16.0** (was v1.15.2-era).
- `proxy` → **v1.13.1** (was v1.12.1; passes through v1.13.0).
- `jump-host` → **v1.14.1** (was v1.11.0-era; passes through v1.14.0).
- `ldap-client` unchanged (v1.1.1).

#### sso-manager-node — [v1.16.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.16.0)

OpenBao becomes the central secrets store for the theta42 stack, and the SSO
Manager becomes its broker. This is the SSO's half of the move: it loads its
own secrets from OpenBao, mints scoped tokens for users and external apps,
and exposes a fixed, role-scoped personal-secrets UI.

##### Changed
- **Secrets now load from OpenBao at boot** via
  [@simpleworkjs/bao-conf](https://simpleworkjs.github.io/bao-conf/), which
  deep-merges `secret/sso-manager/conf` over the file-loaded config
  (replacing the old `utils/conf_manager.js`, which did a shallow-per-key
  merge). `bin/www` runs `bao-conf.init()` after `models.initORM()` and
  before `listen`. Fail-soft: if OpenBao is unreachable, boot continues from
  `CONF_SECRETS`. The SSO authenticates with a scoped `VAULT_TOKEN` (policy
  `sso-broker`), never the root token. The admin **Configuration** UI
  (`/api/conf`) now writes through `bao-conf.set('sso-manager', …)`.
- **`/api/vault` proxy reworked** — the old endpoint was an ungated
  pass-through that never injected an `X-Vault-Token` (so the UI was both
  ungated *and* broken). It is now `middleware.auth` → `scopeGuard` → a
  token-injecting proxy. `scopeGuard` resolves a per-user (`user-<uid>`) or
  per-admin (`sso-admin`) token via the new `utils/vault_broker.js`
  (Redis-cached, minted through the `sso-broker` token role) and enforces a
  path prefix as a second layer on top of the OpenBao policy. The client
  `auth-token` is stripped; only the server-minted token reaches OpenBao.
- **Vault UI reworked and renamed** (`views/vaultwarden.ejs` →
  `views/vault.ejs`; the `/vault` route is now `middleware.auth`-gated).
  Non-admin users see only their `secret/users/<uid>/` namespace; admins get
  free-form path entry across `secret/` plus an **Apps** tab to mint scoped
  tokens for external apps (`secret/apps/<name>/*`, shown once with copy +
  `curl` convention).
- Bumped package version to track the release tag.

##### Removed
- `nodejs/utils/conf_manager.js` (replaced by `@simpleworkjs/bao-conf`).
- `nodejs/views/vaultwarden.ejs` (renamed `vault.ejs`).

##### Security
- **Committed-secrets remediation.** `config/sso-secrets.js` (LDAP bind
  password, SMTP, `oauth.jwtSecret`) and `nodejs/test_plugins.js` (a
  hardcoded Proxmox root API token and a UniFi password) were tracked on
  master. They are now untracked + gitignored (`config/*-secrets.js`), and
  `test_plugins.js` is deleted; `config/proxy-secrets.js.example` added as a
  placeholder template. **The secrets remain in git history — rotation at
  the providers is the real remediation and is the operator's to perform.**
  OpenBao is now the authoritative store; the local files are seed artifacts
  only.

> Note: sso releases v1.12.0–v1.15.2 were tagged from merge PRs without
> corresponding `CHANGELOG.md` entries or GitHub releases; v1.16.0 resumes
> the changelog.

#### proxy — [v1.13.1](https://github.com/theta42/proxy/releases/tag/v1.13.1) (via [v1.13.0](https://github.com/theta42/proxy/releases/tag/v1.13.0))

##### v1.13.1 — Fixed
- **Bumped `@simpleworkjs/bao-conf` to 1.0.1** so standalone/no-OpenBao boots
  don't crash. bao-conf 1.0.0's `init()` threw when `VAULT_TOKEN` was unset,
  which — combined with `bin/www`'s `.catch(() => process.exit(1))` — made the
  proxy exit at boot in any deployment without an OpenBao sidecar (standalone
  Docker, bare metal). 1.0.1 makes `init()` fail-soft on a missing token (warn
  + continue from `CONF_SECRETS`), matching the documented contract. The
  theta-suite stack is unaffected (it always sets a scoped `VAULT_TOKEN`).

##### v1.13.0 — Changed
- **Secrets now load from OpenBao at boot** via
  [@simpleworkjs/bao-conf](https://simpleworkjs.github.io/bao-conf/), which
  deep-merges `secret/proxy/conf` over the file-loaded config. The proxy
  authenticates to OpenBao with a scoped `VAULT_TOKEN` (policy `proxy` —
  read-only on its own path), never the root token. Because the OIDC
  `clientSecret` is captured at require time inside `createOidcClient` (during
  `require('../models')`, which `require('../app')` triggers transitively),
  `bin/www` now defers `require('../app')` until after `bao-conf.init()`
  resolves. Fail-soft: if OpenBao is unreachable, boot continues from
  `CONF_SECRETS`. The `config/proxy-secrets.js` file is now an operator-edit
  seed artifact (gitignored); OpenBao is authoritative.
- Bumped package version to track the release tag.

#### jump-host — [v1.14.1](https://github.com/theta42/jump-host/releases/tag/v1.14.1) (via [v1.14.0](https://github.com/theta42/jump-host/releases/tag/v1.14.0))

##### v1.14.1 — Fixed
- **Bumped `@simpleworkjs/bao-conf` to 1.0.1** so standalone/no-OpenBao boots
  don't crash. bao-conf 1.0.0's `init()` threw when `VAULT_TOKEN` was unset,
  which — combined with `bin/www`'s `.catch(() => process.exit(1))` — made the
  jump host exit at boot in any deployment without an OpenBao sidecar
  (standalone Docker, bare metal). 1.0.1 makes `init()` fail-soft on a missing
  token (warn + continue from `CONF_SECRETS`), matching the documented
  contract. The theta-suite stack is unaffected (it always sets a scoped
  `VAULT_TOKEN`).

##### v1.14.0 — Changed
- **Secrets now load from OpenBao at boot** via
  [@simpleworkjs/bao-conf](https://simpleworkjs.github.io/bao-conf/), which
  deep-merges `secret/jump-host/conf` over the file-loaded config. The jump
  host authenticates to OpenBao with a scoped `VAULT_TOKEN` (policy
  `jump-host` — read-only on its own path), never the root token. Because the
  OIDC `clientSecret` is captured at require time inside `createOidcClient`
  (during `require('../models')`), `bin/www` now runs `bao-conf.init()`
  **before** `require('../models')`. Fail-soft: if OpenBao is unreachable,
  boot continues from `CONF_SECRETS`. The `config/jump-secrets.js` file is now
  an operator-edit seed artifact (gitignored); OpenBao is authoritative.
- Bumped package version to track the release tag.

## [v1.27.2] - 2026-08-01

- Updated `proxy` to v1.12.1 (Dependabot security/maintenance bumps).

#### proxy — [v1.12.1](https://github.com/theta42/proxy/releases/tag/v1.12.1)

##### Changed
- Bumped `body-parser` 2.2.2 → 2.3.0 (Dependabot #175).
- Bumped `ejs` and `brace-expansion` (Dependabot #179, security maintenance).

## [v1.27.1] - 2026-08-01

- Added automated integration tests for the environment (`test-integration.sh`).
- Updated `sso-manager-node` to v1.15.2 (Directory UI tab styling fixes and Vault documentation).

## [v1.27.0] - 2026-08-01

- Updated `sso-manager-node` to v1.15.0 (UI/UX improvements and structured conf page).

## [v1.26.0] - 2026-08-01

- Made OpenBao production-ready by using a persistent file backend, enabling `IPC_LOCK`, and dynamically generating a robust config file.
- Automated OpenBao initialization, unsealing, and secrets seeding via `setup.sh`.

## [v1.25.0] - 2026-08-01

- Added OpenBao (Vault) container for secrets management and native UI proxying.
- Updated `sso-manager-node` to v1.14.0 (Discovery and Vault integration).
- Updated `proxy` to v1.12.0.

## [Unreleased]

## [1.23.0] - 2026-07-31

### Submodules bumped
- jump-host `v1.12.0` -> [`v1.13.0`](https://github.com/theta42/jump-host/releases/tag/v1.13.0)
- proxy `v1.10.0` -> [`v1.11.0`](https://github.com/theta42/proxy/releases/tag/v1.11.0)
- sso-manager-node `v1.12.0` -> [`v1.13.0`](https://github.com/theta42/sso-manager-node/releases/tag/v1.13.0)

#### jump-host — [v1.13.0](https://github.com/theta42/jump-host/releases/tag/v1.13.0)

##### Changed
- **Title changed to "SSO Manager"** — the jump-host web UI now presents itself as "SSO Manager" in the navbar and page title, matching its role as the unified access portal for both services and hosts.

#### sso-manager-node — [v1.13.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.13.0)

##### Changed
- **Directory page cleaned up** — removed the parent badge and slug display from the directory table; resource names now align with the badges above for a cleaner, more compact layout.
- **Users list SSH key column fixed** — users with multiple SSH keys no longer show multiple checkmarks; the column now shows a single checkmark indicating "has key" regardless of key count.

#### proxy — [v1.11.0](https://github.com/theta42/proxy/releases/tag/v1.11.0)

##### Changed
- **Permissions, Users, and Groups pages converted to table layouts** — card grids replaced with striped tables for better scanability and alignment. Users page adds per-field validation error display alongside the summary message.
- **Groups page auto-refreshes** — adding or removing a group now triggers an explicit reload, ensuring the list stays in sync without manual refresh.

## [1.22.0] - 2026-07-31

### Submodules bumped
- jump-host `v1.11.0` -> [`v1.12.0`](https://github.com/theta42/jump-host/releases/tag/v1.12.0)
- proxy `v1.9.0` -> [`v1.10.0`](https://github.com/theta42/proxy/releases/tag/v1.10.0)
- sso-manager-node `v1.11.0` -> [`v1.12.0`](https://github.com/theta42/sso-manager-node/releases/tag/v1.12.0)

#### jump-host — [v1.12.0](https://github.com/theta42/jump-host/releases/tag/v1.12.0)

##### Added
- **TUI host picker with colors**: ANSI-colored terminal UI with box-drawing header, cyan/magenta/green title treatment, per-row coloring (cyan hostnames, blue IPs), environment badges (red PROD / dim DEV), green inverse selection highlight with "◄ SELECTED ►" indicator, yellow filter text, and a footer separator with quick-select hint.

#### sso-manager-node — [v1.12.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.12.0)

##### Changed
- **Catalog page (`/`) redesigned**: Removed the portal banner; "My Access" section now has tabs separating Services and Hosts; icons support both Font Awesome classes and image URLs (http/https).
- **Profile page redesigned as a single card with tabs**: Password reset is now a modal button; "My groups", "My Services", "Security & Usage Stats", and "Members of X's group" are now tabs on the main profile card instead of separate cards; metrics display fixed to properly load and show service usage data.

#### proxy — [v1.10.0](https://github.com/theta42/proxy/releases/tag/v1.10.0)

##### Changed
- **Permissions page**: Converted from card grid to table/list layout with columns: Subject, Scope, Domain, Role, Actions.
- **Users page**: Converted from card grid to table/list layout; form validation now shows both a summary message AND per-field error messages with visual highlighting.
- **Groups page**: Added automatic refresh after adding/deleting groups to ensure new entries appear immediately.

## [1.21.0] - 2026-07-31

### Submodules bumped
- ldap-client `v1.1.0` -> [`v1.1.1`](https://github.com/theta42/ldap-client/releases/tag/v1.1.1)
- sso-manager-node `v1.10.0` -> [`v1.11.0`](https://github.com/theta42/sso-manager-node/releases/tag/v1.11.0)

> **Operational note — the SSO image now builds slapd from source.** OpenLDAP's
> `nestgroup` overlay (nested groups) exists only on master; no 2.6.x release
> ships it. `Dockerfile.openldap` therefore compiles OpenLDAP from a **pinned**
> commit, which makes the SSO image slower to build and pulls `pw-sha2` from
> contrib. Two consequences worth knowing:
>
> - Master ships **LMDB 1.0.0**, whose on-disk format is mutually unreadable
>   with the 0.9.x in 2.6.x (`MDB_INVALID: File is not an LMDB file`). Moving an
>   existing `/var/lib/ldap` onto this image is a `slapcat` -> `slapadd` reload,
>   not a restart.
> - There is a `TODO` to drop the whole from-source stage once `nestgroup` ships
>   in a release. The entrypoint already probes for `nestgroup.so` and the app
>   keys off `app_ldap__nestedGroupsServerSide`, so that swap needs no other
>   changes.

#### sso-manager-node — [v1.11.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.11.0)

##### Added
- **End-user catalog at `/`** — the first ungated nav item; previously every nav entry was admin-only and a normal user had no signposted destination. Search/filter, per-kind icons, and a *how to reach it* block per card: the URL for a service, the SSH invocation for a host (using the jump-host `uid_-_slug@host` grammar when `directory.jumpHost` is set).
- **Self-service access requests** — `/api/access-requests` (create, list own, list decidable, approve, deny, withdraw) with approve/deny queues on the catalog. Approving performs the LDAP group add, so LDAP stays the access-control truth. Requests target a resource's `_access` group, never `_admin`. Replaces the "coming soon" stub.
- **Admin access visibility** — an Access column on the directory table (member/group counts, flagging links whose LDAP group was deleted) and a "what can this user reach" lookup, the reverse question that previously had no UI at all.
- **Nested LDAP groups.** `groupOfNames.member` already accepts a group DN, so nesting needs no schema — what it needs is resolution, which no released OpenLDAP performs. Server-side via the pinned-master `nestgroup` overlay; client-side the app computes the closure itself (cycle-detected, depth-capped) against any other server. `PUT`/`DELETE /api/group/:group/nested/:child`, `GET /api/group/:group/effective`, and a **Nested** tab on each group card.
- **`app_super_admin` is now seeded** (it never was) and nested into `app_sso_admin` / `app_sso_invite` / `app_sso_oauth_admin`, so the privilege is real LDAP membership visible to SSSD and sudo rather than a special case in app code. Resource creation nests `app_super_admin` -> `<slug>_admin` and `<slug>_admin` -> `<slug>_access`.
- Resource metadata `icon` and `tagline`, collected on the admin form with a live icon preview.

##### Fixed
- **`GET /api/discovery/me` returned only `isPublic` resources for every human caller** — it read `req.user.groups`, which does not exist (`req.user` carries `memberOf`), so the empty list failed open. "My Services" was blank for everyone, and `isDirectoryAdmin()` was false even for real directory admins.
- **The portal's "Discover More Services" was dead for every non-admin** — it called the admin-gated endpoint and swallowed the 403 into an empty array.
- **Services reported no address** — `/me` had reimplemented `getMyAccess` without its parent-walking resolution, so a service reached at its host's IP resolved to nothing.
- `GET /api/user/me` derived `isAdmin` from `memberOf`, which is only transitive with `nestgroup`; against a stock server an admin holding their group via nesting lost the entire admin UI while still passing every server-side check.
- `utils/permission.js`'s `byGroup` saw only direct membership.
- Adding an existing group member, and removing a group's last member, both returned bare 500s; now 409s that explain themselves.
- `DELETE /api/directory-admin/resources/:id` deleted the resource before its edges and group links, orphaning rows on a mid-way failure.
- `/api/directory-admin/audit-logs` shelled out to `tail` via `execSync`; replaced with a bounded async read.
- Broken `api.html` link in the published docs.

##### Changed
- `@simpleworkjs/directory-schema` -> `^1.1.0`, declaring ten metadata keys the admin form always wrote but the schema never listed. Undeclared keys are dropped for non-admin callers — which blanked the portal's `OS:` field, hid every service's port, and left machine tokens unable to read the port mapping the firewall consumer exists to render.

#### ldap-client — [v1.1.1](https://github.com/theta42/ldap-client/releases/tag/v1.1.1)

##### Fixed
- Sets `ldap_group_nesting_level = 5` so SSSD walks nested groups itself when pointed at a server without `nestgroup`. Against the SSO's bundled slapd the existing `memberof=` access filter is already transitive, so SSH login inherits nesting for free. The explicit `app_super_admin` clause is kept, to keep super-admin login working against a directory predating the new nesting.


## [1.20.0] - 2026-07-30

### Added
- **`setup.sh` persists `SSO_GIT_COMMIT`/`PROXY_GIT_COMMIT`/`JUMP_GIT_COMMIT` into `./.env`** (new `env_upsert` helper), which `docker compose` auto-loads on every future invocation in this directory. Previously these were only `export`ed for the current shell, so an ad-hoc `docker compose up --build <service>` run later (outside a full `setup.sh` run) would build with an empty `GIT_COMMIT` arg — and since each submodule's checked-out `.git` is a pointer file, not a real repo, the in-container git fallback can't resolve it either, so the image silently baked "unknown" as its commit hash. `.gitignore`'s `.env` comment updated to describe this (it was previously labeled "legacy, no longer used").

### Submodules bumped
- jump-host `v1.10.2` -> [`v1.11.0`](https://github.com/theta42/jump-host/releases/tag/v1.11.0)
- ldap-client `v1.0.0` -> [`v1.1.0`](https://github.com/theta42/ldap-client/releases/tag/v1.1.0)
- proxy `v1.8.0` -> [`v1.9.0`](https://github.com/theta42/proxy/releases/tag/v1.9.0)
- sso-manager-node `v1.9.0` -> [`v1.10.0`](https://github.com/theta42/sso-manager-node/releases/tag/v1.10.0)

#### sso-manager-node — [v1.10.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.10.0)

##### Added
- `app_super_admin` cross-app group: members are full admins here regardless of `app_sso_admin` membership. The same group is now also recognized by proxy and jump-host, and by `ldap-client`'s SSSD access filter (SSH login on every host).

##### Changed
- Renamed the Executive page to Overview (route, view, `/api/metrics/overview`, nav label, docs). `/executive` kept as a 301 redirect.

#### proxy — [v1.9.0](https://github.com/theta42/proxy/releases/tag/v1.9.0)

##### Added
- `app_super_admin` cross-app group recognized as a global admin (`conf.auth.adminGroups`).

##### Changed
- Users and Permissions pages: the always-visible sidebar "Add" forms are now an "Add User"/"Add Permission" button that opens an `app.modal` dialog, matching the hosts.ejs convention.
- Let's Encrypt ACME account key now defaults to the already-persisted `/data` volume instead of a CWD-relative path (`./le_key.cert` -> `/app/le_key.cert` in the container), which was lost on every image rebuild.

#### jump-host — [v1.11.0](https://github.com/theta42/jump-host/releases/tag/v1.11.0)

##### Added
- `app_super_admin` (cross-app) and `app_jump_admin` groups: super admins are full admins here same as `app_sso_admin`; jump admins get audit page/data access without other admin rights. The Audit page/API is now actually admin-gated server-side (previously the page shell rendered for any logged-in user, only its data was gated).
- Host list adds Last connection/Last failed connection columns and highlights rows green (a session is live right now) or yellow (the most recent attempt failed), backed by new per-host last-success/last-fail timestamps.

##### Changed
- Dashboard's stat boxes and Top hosts/Top users cards moved to the Audit page. "All hosts" renamed to "My hosts".

#### ldap-client — [v1.1.0](https://github.com/theta42/ldap-client/releases/tag/v1.1.0)

##### Added
- `app_super_admin` cross-app group now grants SSH login access to every host (`ldap_access_filter` + `ldap_access_groups`), matching the same group's admin rights in sso-manager-node, proxy, and jump-host. Sudo is not yet extended to super admins (`ldap_sudo_search_filter` remains non-functional on this SSSD version — pre-existing, documented gap).

## [1.19.0] - 2026-07-30

### Added
- **New `ldap-client` submodule + `ldap-test-host` service** (`jump-host` compose profile): a real SSSD + AuthorizedKeysCommand LDAP-joined downstream host for testing jump-host's actual key-injection -> upstream-connect flow end-to-end against this stack's own local LDAP, instead of a container with a manually-dropped public key in `authorized_keys`. Verified live (SSH CLI and WinSCP) through jump-host's `uid_-_target` grammar.

#### ldap-client — [v1.0.0](https://github.com/theta42/ldap-client/releases/tag/v1.0.0) (first tagged release)

##### Added
- Docker test fixture (`Dockerfile` + `entrypoint.sh`): Ubuntu 22.04 + sssd + sshd, no systemd required.

##### Fixed
Building that fixture surfaced three real bugs that would break login on any deployment, not just the test fixture:
- `sssd.conf.mo` used `ldap_bind_dn`/`ldap_bind_pw`, which aren't real SSSD options — corrected to `ldap_default_bind_dn` / `ldap_default_authtok(_type)`.
- `sssd.conf.mo` had no explicit `services =` list, so SSSD started only its backend, never the nss/pam responders — `getent passwd <ldap-user>` silently failed even with the domain reachable.
- `ldap-ssh-key.sh`'s `memberof` filter was missing the `cn=` prefix on the group name, so the AuthorizedKeysCommand script always returned zero keys for a correctly-provisioned user — no error, just silently nothing.

#### sso-manager-node — [v1.9.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.9.0)

##### Added
- Directory modal's Associated LDAP Groups tab now supports full membership management: view, add, and remove members/owners of each associated group directly from the tab.
- `app.util.revealItem()` (shared `app-base.js`): scrolls a just-added/-edited element into view and flashes its background.

##### Changed
- Groups page's search/sort bar is now sticky while scrolling.
- Directory table: Kind/Name/Env/Host merged into a single "Resource" column.

#### proxy — [v1.8.0](https://github.com/theta42/proxy/releases/tag/v1.8.0)

##### Added
- Users backed by SSO/OIDC login are now marked "External (SSO)" and read-only (password-change hidden client-side, `PUT /password/:username` rejects with 403 server-side). Redis user-backend only.

##### Changed
- All pages now wrap their content in a standard-width container, matching sso-manager-node instead of rendering full-bleed.
- Users and Permissions pages converted from bare `<table>`s to the card-grid convention already used on the Groups page.

#### jump-host — [v1.10.2](https://github.com/theta42/jump-host/releases/tag/v1.10.2)

##### Changed
- Dashboard, Sessions, and Audit pages now match sso-manager-node/proxy's page width.
- Audit's nav entry is now admin-gated (`groups: ['admin']`).

### Bumped
- sso-manager-node -> [v1.9.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.9.0)
- proxy -> [v1.8.0](https://github.com/theta42/proxy/releases/tag/v1.8.0)
- jump-host -> [v1.10.2](https://github.com/theta42/jump-host/releases/tag/v1.10.2)
- ldap-client -> [v1.0.0](https://github.com/theta42/ldap-client/releases/tag/v1.0.0) (new submodule)

## [1.18.0] - 2026-07-28

### Changed
Cross-app API-token self-service UI unification: all 3 apps now share the
same card-grid list, "+ New Token" modal-based create flow, `app.modal`-based
secret reveal, and Edit modal (with real created-by/on audit metadata).

#### sso-manager-node — [v1.8.2](https://github.com/theta42/sso-manager-node/releases/tag/v1.8.2), [v1.8.3](https://github.com/theta42/sso-manager-node/releases/tag/v1.8.3)

**v1.8.2**

##### Fixed
- **Creating a new OAuth integration didn't reliably show the "save this client secret now" reveal modal** — `saveResource()` called `app.modal.close()` immediately before conditionally showing the secret via `app.modal.open()`. `app.modal` is a singleton, and `close()` immediately followed by `open()` collides with Bootstrap's hide-transition guard. An intervening `await loadResources()` made this race unlikely to lose in practice, but not guaranteed to — found while fixing the same, guaranteed-to-lose bug in jump-host and proxy's API-token create flows.

**v1.8.3**

##### Changed
- **`profile.ejs`'s self-service API-token UI unified onto `app.modal`**, matching the pattern already shipped this round in `directory.ejs`, proxy, and jump-host: the static `#secretModal`/`#editModal` elements are retired in favor of the shared `app.modal` singleton, the always-visible inline create-form card becomes a "+ New Token" button + modal, and badge classes switch from `bg-*` to `text-bg-*`.
- Checkmark-flash copy feedback (silently broken by FontAwesome's `<i>`→`<svg>` replacement) replaced with toast-based `copyFieldValue`, matching proxy and jump-host.

#### proxy — [v1.7.0](https://github.com/theta42/proxy/releases/tag/v1.7.0)

##### Added
- **API tokens: "+ New Token" modal button (replacing the always-visible inline create-form card) and a new Edit modal** — continues the cross-app API-token UI unification started in jump-host. The Edit modal's footer shows real created-by/on data; the `PUT /api-token/:id` route already fully supported editing, so no backend change was needed.

##### Fixed
- **Creating an API token didn't show the "save this secret now" reveal modal** — the create flow called `app.modal.close()` immediately before `app.modal.open()` (to show the secret) in the same tick; since `app.modal` is a singleton, that collided with Bootstrap's hide-transition guard and the reveal modal silently never appeared.

#### jump-host — [v1.10.0](https://github.com/theta42/jump-host/releases/tag/v1.10.0), [v1.10.1](https://github.com/theta42/jump-host/releases/tag/v1.10.1)

**v1.10.0**

##### Added
- **API-token UI unified with sso-manager-node/proxy**: card grid replacing the bare table, a new Edit modal (footer shows real created-by/on data), and a Description field on both the create and edit flows — the model and API already fully supported all of this, it just wasn't exposed anywhere in the dashboard.

##### Changed
- `@simpleworkjs/frontend` bumped to `^0.2.6` (this app was still on `^0.2.5`).

**v1.10.1**

##### Fixed
- **The API-token reveal modal silently didn't show after creating a token** — `submitApiToken()` called `app.modal.close()` immediately before `showToken()`'s `app.modal.open()` in the same tick, colliding with Bootstrap's hide-transition guard on the singleton modal. Same root cause as the OAuth-secret-reveal race fixed in sso-manager-node (v1.8.2) and the create-token race fixed in proxy (v1.7.0).

### Bumped
- sso-manager-node -> [v1.8.3](https://github.com/theta42/sso-manager-node/releases/tag/v1.8.3)
- proxy -> [v1.7.0](https://github.com/theta42/proxy/releases/tag/v1.7.0)
- jump-host -> [v1.10.1](https://github.com/theta42/jump-host/releases/tag/v1.10.1)

## [1.17.0] - 2026-07-28

### Added
- **proxy's host modal now has a footer (created/updated-by/on metadata) and a linkable `/hosts/{host}` URL**, migrated onto the same shared `app.modal` component as sso-manager-node's resource modal — continuing the entity-modal standardization across the stack.

### Fixed
- **proxy: the Let's-Encrypt challenge-type/wildcard-matching visibility logic could stop reacting to the hostname field after the first Add/Edit host**, and **the SSO allow-list autocomplete could go empty starting on the second Add/Edit** — both were DOM-rebuild timing bugs in the same class as the resource-modal fixes already shipped.
- **sso-manager-node: the resource modal's "Associated LDAP Groups" autocomplete went empty after the first Add/Edit** — same DOM-rebuild timing bug, now fixed.

### Bumped
- sso-manager-node -> [v1.8.1](https://github.com/theta42/sso-manager-node/releases/tag/v1.8.1)
- proxy -> [v1.6.0](https://github.com/theta42/proxy/releases/tag/v1.6.0)

## [1.16.0] - 2026-07-28

### Added
- **"Quick Jump" copy-to-clipboard section on the jump-host dashboard** — one-click-copy SSH commands (interactive-picker mode, plus a per-host `uid_-_target` grammar-mode command) instead of having to remember/reconstruct the format by hand.

### Fixed
- **jump-host audit records for a failed downstream connection only ever said `upstream-unreachable`**, with no way to tell a network-layer failure from an auth failure — the real error (ECONNREFUSED, ETIMEDOUT, an ssh2 auth-failure message, etc.) is now captured and shown as a tooltip on the audit table's fail badge.

### Bumped
- jump-host -> [v1.9.0](https://github.com/theta42/jump-host/releases/tag/v1.9.0)

## [1.15.0] - 2026-07-28

### Fixed
- **sso-manager's Directory data (every site/host/service/oauth-client resource and their relationships/LDAP-group associations) had no persistent volume** — `@simpleworkjs/orm` fell back to `./config/inventory.sqlite` (relative to the app's `/app` cwd) whenever `conf.orm` wasn't set, which sits in the container's ephemeral writable layer, not any mounted volume. Every container recreate (`docker compose up --build`, `down`/`up`, an image rebuild) silently wiped the entire Directory Management page. `setup.sh`'s generated `sso-secrets.js` (and the example template) now set `orm: { dialect: 'sqlite', storage: '/data/inventory.sqlite' }`, co-locating it with the already-persisted `sso-data` volume (where Redis lives). **Existing deployments**: this repo doesn't rewrite an operator's existing `config/sso-secrets.js` (re-running `setup.sh` leaves it untouched by design) — add the `orm` block above manually, and copy the container's current `/app/config/inventory.sqlite` to `/data/inventory.sqlite` *before* recreating the container, or the existing Directory data will be lost on the next recreate instead of migrated.

### Bumped
- sso-manager-node -> [v1.8.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.8.0)

## [1.14.0] - 2026-07-28

### Fixed
- **jump-host's Redis had zero persistence** (`--save '' --appendonly no`, no data-dir volume) — every container rebuild/recreation (including a `setup.sh` re-run) silently wiped all sessions, in-flight OAuth logins, and any admin-created API token. This is the root cause of the reported "re-running setup.sh breaks OAuth with jump" — the jump-host container gets recreated, and any token or in-flight login vanished with it, while proxy was unaffected because its Redis was already persisted. Now jump-host's Redis persists (AOF + periodic RDB) to `/data`, mounted as a new named volume, `jump-redis-data`. Verified live: minted a PAT, force-recreated the container, confirmed the same PAT still authenticated afterward.

### Changed
- `docker-compose.yml`: added the `jump-redis-data` volume, mounted at `/data` on the `jump-host` service.

### Bumped
- jump-host -> [v1.8.1](https://github.com/theta42/jump-host/releases/tag/v1.8.1)

## [1.13.0] - 2026-07-28

### Fixed
Found via feedback on a fresh install:
- **jump-host's OAuth client had no parent in the Directory.** `seedDirectory()` only ever linked the proxy's OAuth client; jump-host's own (minted by `provisionJumpHost`) was created but never passed through, so it never got a `ResourceEdge`. Existing deployments self-heal on the next `setup.sh` run.
- **TUI-mode SSH connections (bare `ssh user@host`) could drop** with "PTY allocation request failed" / "shell request failed" — a session-listener race in jump-host, same class of bug `runGrammar` already had a fix for.
- **Every form submit briefly showed literal HTML** instead of a loading spinner, across all three apps.
- **`POST /api/user/` and `PUT /api/user/password` had no success message** — a green notification with nothing in it right after adding a user.
- **The login page gave no explanation for why the user landed there** when redirected mid-OAuth-flow.

### Changed
- **Directory: tree view is now the only view; clicking a resource's name opens its detail modal.**

### Bumped
- sso-manager-node -> [v1.7.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.7.0)
- proxy -> [v1.5.3](https://github.com/theta42/proxy/releases/tag/v1.5.3)
- jump-host -> [v1.8.0](https://github.com/theta42/jump-host/releases/tag/v1.8.0)

No `setup.sh` or compose change. Also confirmed (no fix needed): the Let's Encrypt ACME account key persists correctly across container rebuilds — `lua-resty-auto-ssl`'s Redis storage adapter writes through the bundled Redis, which is started with `--appendonly yes` into `/data`, mapped to the persisted `proxy-data` volume. Only an explicit `docker-compose down -v` / volume removal would lose it (which is also what's required, and expected, on a domain change).

## [1.12.0] - 2026-07-28

### Bumped
- sso-manager-node -> [v1.6.3](https://github.com/theta42/sso-manager-node/releases/tag/v1.6.3) — fixes the root cause of a real "lost user" report: `routes/group.js` never invalidated the User cache on membership changes, so an account added to the `app_sso_service_account` marker group (which hides accounts from the Users page's People tab) could look like it had vanished for up to 5 minutes — and, separately, could be added to that group with no warning at all. Both fixed; see the linked release for detail.

No `setup.sh` or compose change.

## [1.11.0] - 2026-07-28

### Added
- **`test/check_jump_ldap_tls.js`**, wired into the `Lint` workflow: a static consistency check on the jump-secrets.js template `bootstrap.js` generates, so the `ldap://` + `tlsOptions` mistake that broke every SSH login in 1.10.0 fails CI before it ever reaches a real deployment again.
- **A static "no native `alert()`/`confirm()`/`prompt()`" check** is now part of all three apps' own test suites (they block all further browser events on the page — see 1.9.0/1.10.0's release notes).

### Bumped
- sso-manager-node -> [v1.6.2](https://github.com/theta42/sso-manager-node/releases/tag/v1.6.2) — fixes `DELETE /api/oauth/client/:id` (`client.remove is not a function`, a genuine 500 masked by tests that never checked the response status), plus the regression test above.
- proxy -> [v1.5.2](https://github.com/theta42/proxy/releases/tag/v1.5.2) — the regression test above.
- jump-host -> [v1.7.1](https://github.com/theta42/jump-host/releases/tag/v1.7.1) — the regression test above.

No `setup.sh` or compose change.

## [1.10.0] - 2026-07-27

### Fixed
- **`bootstrap/bootstrap.js`'s jump-secrets.js template now points jump-host at `ldaps://sso-manager:636`**, not `ldap://sso-manager:389`. The plain-port URL combined with jump-host's `tlsOptions` made `ldapts` attempt implicit TLS against a port serving plaintext LDAP — slapd dropped every connection before any LDAP message parsed, so SSH password login failed for every account, with any password, indistinguishable from a wrong credential. Root-caused by standing up a local jump-host, editing its config, and calling `getUser`/`checkPassword` directly inside the container. **Existing deployments must edit `./config/jump-secrets.js` themselves** (this template only affects fresh bootstraps) — see theta42/theta-suite#99. Companion defensive fix: [simpleworkjs/ldap v1.0.2](https://github.com/simpleworkjs/ldap/releases/tag/v1.0.2) now rejects this `ldap://` + `tlsOptions` combination outright.

### Bumped
- jump-host -> [v1.7.0](https://github.com/theta42/jump-host/releases/tag/v1.7.0) — adds self-service API tokens (create/list/rotate/revoke from its dashboard); jump-host previously had none.

No `setup.sh` or compose change.

## [1.9.0] - 2026-07-27

### Bumped
- sso-manager-node -> [v1.6.1](https://github.com/theta42/sso-manager-node/releases/tag/v1.6.1)
- proxy -> [v1.5.1](https://github.com/theta42/proxy/releases/tag/v1.5.1)

Both apps had every native `alert()`/`confirm()` call removed, replaced by
`@simpleworkjs/frontend`'s `app.messages.action`/`confirm`/`toast` (the
same modules adopted in [1.8.0](#180---2026-07-27)). This was found live,
mid browser-verification of that release: clicking sso-manager-node
directory.ejs's "Rotate Client Secret" triggered a native `confirm()`,
which blocks all further browser events on the page — a real hazard for
anyone driving the app with browser automation, not just a cosmetic
inconsistency. sso-manager-node also dropped `app.user.remove`/
`app.oauthClient.remove` from `public/js/app.js` (dead code with a native
`confirm()` guard and zero callers).

No `setup.sh`, compose, or config change.

## [1.8.0] - 2026-07-27

### Bumped
- sso-manager-node -> [v1.6.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.6.0)
- proxy -> [v1.5.0](https://github.com/theta42/proxy/releases/tag/v1.5.0)
- jump-host -> [v1.6.0](https://github.com/theta42/jump-host/releases/tag/v1.6.0)

All three apps adopt the newly published `@simpleworkjs/frontend` package's
`app.messages`, `app.modal`, and `app.validate` modules, replacing the
vendored `app.util.actionMessage`/`actionConfirm`/`alert` in
`public/lib/js/app-base.js` (byte-identical across all three apps) and the
vendored `public/lib/js/val.js` (byte-identical in sso-manager-node and
jump-host, and the same engine plus proxy-only DNS/hostname rules in proxy).
Message content is now HTML-escaped — the ad hoc `app.util.alert()` this
replaces had none — and `app.messages.action` falls back to a page-wide
toast when there's no inline `.actionMessage` target on the page. proxy's
`host`/`target`/`hostname` wildcard-DNS validation rules (mirroring
`utils/hostname_validate.js`) move to its own `public/js/app.js`, registered
via `$.validateSettings`, since they're proxy-specific and don't belong in
the shared package's generic rule set (`eq`/`user`/`password`/`ip`).
jump-host doesn't currently use any `[validate]` attributes, so its `val.js`
swap is dedup/future-proofing rather than a behavior change.

`app.api`/`app.auth`/`app.pubsub`/`app.socket` in each app's `app-base.js`
are untouched: they're app-specific (a dual-mode callback/promise API with
`auth-token` header injection) and not something the frontend package's
generic `app.js` provides, so it isn't loaded.

No `setup.sh`, compose, or config change.

## [1.7.0] - 2026-07-27

### Bumped
- sso-manager-node -> [v1.5.1](https://github.com/theta42/sso-manager-node/releases/tag/v1.5.1)
- jump-host -> [v1.5.0](https://github.com/theta42/jump-host/releases/tag/v1.5.0)

Two production bugs fixed: `PUT /api/user/:uid` 500'd with an LDAP
`ObjectClassViolationError` when setting `sshPublicKey` on any account
predating the `ldapPublicKey` objectClass (notably the bootstrap admin) —
and the exact same bug, in the shared `@simpleworkjs/ldap` package's
`addSshKey`, was silently aborting SSH connections at jump-host's
key-injection step for the same class of accounts. Both are fixed by
ensuring the objectClass is present before writing the attribute. Also
fixed: the Directory's "add resource" modal left the parent-Service
dropdown blank when adding an OAuth Integration.

Jump-host's web dashboard also gained a "Hosts you can reach" list
(admins see "All hosts") — previously it only showed usage metrics with
no way to see your actual access from the browser.

No `setup.sh`, compose, or config change.

## [1.6.0] - 2026-07-26

### Bumped
- jump-host -> [v1.4.0](https://github.com/theta42/jump-host/releases/tag/v1.4.0)

Jump-host gains **standalone mode**: it can now run with no LDAP directory and
no SSO Manager at all, storing users and hosts itself via
`@simpleworkjs/orm` (Sequelize; SQLite by default, any Sequelize-supported
dialect). This is an app-internal capability, opt-in via
`standalone.enabled` in jump-host's own config — the bundled theta-suite stack
is unaffected and continues to wire jump-host to the shared LDAP directory
and SSO Manager as before. Two bugs were also fixed in jump-host's SSH
server: an ephemeral listen port (`0`) was silently overridden back to the
default, and session listeners could miss a client's immediate `exec`/`shell`
request.

No `setup.sh`, compose, or config change on the theta-suite side.

## [1.5.0] - 2026-07-26

### Bumped
- sso-manager-node -> [v1.5.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.5.0)
- proxy -> [v1.4.0](https://github.com/theta42/proxy/releases/tag/v1.4.0)
- jump-host -> [v1.3.0](https://github.com/theta42/jump-host/releases/tag/v1.3.0)

This release finishes the UI half of the unification that 1.4.0 deferred: the
three apps now share one front-end shell. `views/top.ejs`, `views/bottom.ejs`
and `public/lib/js/app-base.js` are byte-identical across sso-manager-node,
proxy and jump-host, and everything per-app moved into each repo's new
`nodejs/utils/ui.js` (nav items and the groups that may see them, footer links,
favicon, profile/logout targets, update-banner on/off). Nav gating is one model
everywhere — the shell reveals `.group-required-<cn>` from `GET /api/user/me`,
normalising sso's LDAP DNs and the OIDC clients' group CNs to the same shape,
with the clients' `isAdmin` flag exposed as a synthetic `admin` group. jQuery is
4.0.0 and EJS 3.1.10 in all three.

Five client-side bugs were fixed along the way, including two that broke real
flows: `app.api.delete` ignored the callback that `formAJAX` passes (so
DELETE-method forms — the proxy's host and DNS delete buttons — never refreshed),
and the login page threw on every logged-out visit while revealing its card.

No `setup.sh`, compose or config change: this is app-internal UI work. Verified
by driving a full stack of all three apps in a browser — every page renders
console-clean, nav gating is correct per role, and the OIDC login round trip
completes on both OIDC clients.

sso-manager-node 1.5.0:

### Changed
- **Unified the front-end UI shell across the three theta42 apps.** `views/top.ejs`, `views/bottom.ejs` and `public/lib/js/app-base.js` are now byte-identical in sso-manager-node, proxy and jump-host, so the apps look and behave the same and a shell change lands in one edit per repo instead of three divergent ones. Everything that differs between the apps moved into a new `nodejs/utils/ui.js`, exposed to every render as `ui` via `app.locals`: nav items and the groups that may see them, footer repo/license/docs/Terms links, favicon, the profile and post-logout targets, and whether the update banner exists at all.
- **One nav-gating model everywhere.** `app-base.js` reveals `.group-required-<cn>` elements for each group the current user is in, read from `GET /api/user/me`. sso-manager-node reports LDAP DNs in `memberOf` and the OIDC clients report CNs in `groups`; both normalise to CNs client-side, and the clients' effective-rights `isAdmin` flag is exposed as a synthetic `admin` group — so one gating model covers a group-based provider and boolean-admin clients without either app learning the other's response shape.
- **`GET /api/user/me` is fetched once per page load and cached** (`app.auth.loadUser`). The nav, per-view `forceLogin` and every group-gated element read that one promise instead of issuing their own request.
- `app.auth.isLoggedIn` is dual-mode: it returns a Promise **and** invokes an optional node-style callback, so the async and callback call styles both work against one shared `top.ejs`.
- `app.auth.forceLogin` no longer uses `$.holdReady` (removed in jQuery 4). An unauthenticated user is redirected to `/login?redirect=<path>`; group requirements are still enforced, and `logOut` now only clears the session, leaving the destination to the caller (`ui.logoutRedirect`).
- Dependency alignment across all three apps: `jquery` `^4.0.0` and `ejs` `^3.1.10`.

### Fixed
- **`app.api.delete` dropped its callback when called by `formAJAX`.** `formAJAX` always passes the serialized form as the second argument, so a DELETE-method form's callback landed in the data slot and never ran. `delete` now accepts both `(url, callback)` and `(url, data, callback)`.
- **`app.api.post`/`put` referenced an undefined `callback2`** and threw when handed a non-function callback. Both are now dual-mode Promise/callback.
- **The login page's "reveal the card once we know you're logged out" branch threw** (`Cannot read properties of null`) whenever the logged-in check answered before the parser reached that element — which it always did without a stored token. It now runs on DOM ready.
- **`logInRedirect` on the legacy `/login/<path>` form kept only the path.** The OIDC provider routes an unauthenticated authorization request through `/login/oauth/authorize?client_id=…&state=…`; dropping the query there loses the entire authorization request. The suffix form now preserves its query string.

### Fixed (sso-manager-node)
- `public/lib/js/val.js` shadowed `message` with `let` inside `validateField`, so a custom rule's return value never reached `validateMessage` and the caller always saw the generic length message. Resolved by adopting the shared validator, which also brings the `target`/`hostname` rules and the real password policy (>= 8 chars, and either 12+ or 3 of 4 character classes) to this app.
- `public/js/app.js` used `$.isFunction`, removed in jQuery 4.

### Added (sso-manager-node)
- `GET /api/user/me` now also reports `isAdmin` (membership in `app_sso_admin`), the single effective-rights flag the shared UI shell gates the update banner on. Group-level gating still reads `memberOf`.

### Verified
- Browser-verified against a full theta-suite stack (sso-manager + proxy + jump-host): every top-level page renders with a clean console; nav gating is correct for admin and non-admin; `forceLogin`'s onboarding and group gates fire; `val.js` blocks a weak password and accepts a strong one through a real form submit; the DELETE-method forms work; and the OIDC login round trip (authorize with PKCE -> login -> consent -> callback -> token fragment) completes on both OIDC clients.

proxy 1.4.0:

### Changed
- **Unified the front-end UI shell across the three theta42 apps.** `views/top.ejs`, `views/bottom.ejs` and `public/lib/js/app-base.js` are now byte-identical in sso-manager-node, proxy and jump-host, so the apps look and behave the same and a shell change lands in one edit per repo instead of three divergent ones. Everything that differs between the apps moved into a new `nodejs/utils/ui.js`, exposed to every render as `ui` via `app.locals`: nav items and the groups that may see them, footer repo/license/docs/Terms links, favicon, the profile and post-logout targets, and whether the update banner exists at all.
- **One nav-gating model everywhere.** `app-base.js` reveals `.group-required-<cn>` elements for each group the current user is in, read from `GET /api/user/me`. sso-manager-node reports LDAP DNs in `memberOf` and the OIDC clients report CNs in `groups`; both normalise to CNs client-side, and the clients' effective-rights `isAdmin` flag is exposed as a synthetic `admin` group — so one gating model covers a group-based provider and boolean-admin clients without either app learning the other's response shape.
- **`GET /api/user/me` is fetched once per page load and cached** (`app.auth.loadUser`). The nav, per-view `forceLogin` and every group-gated element read that one promise instead of issuing their own request.
- `app.auth.isLoggedIn` is dual-mode: it returns a Promise **and** invokes an optional node-style callback, so the async and callback call styles both work against one shared `top.ejs`.
- `app.auth.forceLogin` no longer uses `$.holdReady` (removed in jQuery 4). An unauthenticated user is redirected to `/login?redirect=<path>`; group requirements are still enforced, and `logOut` now only clears the session, leaving the destination to the caller (`ui.logoutRedirect`).
- Dependency alignment across all three apps: `jquery` `^4.0.0` and `ejs` `^3.1.10`.

### Fixed
- **`app.api.delete` dropped its callback when called by `formAJAX`.** `formAJAX` always passes the serialized form as the second argument, so a DELETE-method form's callback landed in the data slot and never ran. `delete` now accepts both `(url, callback)` and `(url, data, callback)`.
- **`app.api.post`/`put` referenced an undefined `callback2`** and threw when handed a non-function callback. Both are now dual-mode Promise/callback.
- **The login page's "reveal the card once we know you're logged out" branch threw** (`Cannot read properties of null`) whenever the logged-in check answered before the parser reached that element — which it always did without a stored token. It now runs on DOM ready.
- **`logInRedirect` on the legacy `/login/<path>` form kept only the path.** The OIDC provider routes an unauthenticated authorization request through `/login/oauth/authorize?client_id=…&state=…`; dropping the query there loses the entire authorization request. The suffix form now preserves its query string.

### Added
- `.group-required { display: none }` in `public/css/styles.css`, the base rule the shared gating model reveals against.
- Admin-only nav items lost their inline `display: none` in favour of that class, and the brand link points at `/` instead of `#`.

### Verified
- Browser-verified against a full theta-suite stack (sso-manager + proxy + jump-host): every top-level page renders with a clean console; nav gating is correct for admin and non-admin; `forceLogin`'s onboarding and group gates fire; `val.js` blocks a weak password and accepts a strong one through a real form submit; the DELETE-method forms work; and the OIDC login round trip (authorize with PKCE -> login -> consent -> callback -> token fragment) completes on both OIDC clients.

jump-host 1.3.0:

### Changed
- **Unified the front-end UI shell across the three theta42 apps.** `views/top.ejs`, `views/bottom.ejs` and `public/lib/js/app-base.js` are now byte-identical in sso-manager-node, proxy and jump-host, so the apps look and behave the same and a shell change lands in one edit per repo instead of three divergent ones. Everything that differs between the apps moved into a new `nodejs/utils/ui.js`, exposed to every render as `ui` via `app.locals`: nav items and the groups that may see them, footer repo/license/docs/Terms links, favicon, the profile and post-logout targets, and whether the update banner exists at all.
- **One nav-gating model everywhere.** `app-base.js` reveals `.group-required-<cn>` elements for each group the current user is in, read from `GET /api/user/me`. sso-manager-node reports LDAP DNs in `memberOf` and the OIDC clients report CNs in `groups`; both normalise to CNs client-side, and the clients' effective-rights `isAdmin` flag is exposed as a synthetic `admin` group — so one gating model covers a group-based provider and boolean-admin clients without either app learning the other's response shape.
- **`GET /api/user/me` is fetched once per page load and cached** (`app.auth.loadUser`). The nav, per-view `forceLogin` and every group-gated element read that one promise instead of issuing their own request.
- `app.auth.isLoggedIn` is dual-mode: it returns a Promise **and** invokes an optional node-style callback, so the async and callback call styles both work against one shared `top.ejs`.
- `app.auth.forceLogin` no longer uses `$.holdReady` (removed in jQuery 4). An unauthenticated user is redirected to `/login?redirect=<path>`; group requirements are still enforced, and `logOut` now only clears the session, leaving the destination to the caller (`ui.logoutRedirect`).
- Dependency alignment across all three apps: `jquery` `^4.0.0` and `ejs` `^3.1.10`.

### Fixed
- **`app.api.delete` dropped its callback when called by `formAJAX`.** `formAJAX` always passes the serialized form as the second argument, so a DELETE-method form's callback landed in the data slot and never ran. `delete` now accepts both `(url, callback)` and `(url, data, callback)`.
- **`app.api.post`/`put` referenced an undefined `callback2`** and threw when handed a non-function callback. Both are now dual-mode Promise/callback.
- **The login page's "reveal the card once we know you're logged out" branch threw** (`Cannot read properties of null`) whenever the logged-in check answered before the parser reached that element — which it always did without a stored token. It now runs on DOM ready.
- **`logInRedirect` on the legacy `/login/<path>` form kept only the path.** The OIDC provider routes an unauthenticated authorization request through `/login/oauth/authorize?client_id=…&state=…`; dropping the query there loses the entire authorization request. The suffix form now preserves its query string.

### Added
- `.group-required { display: none }` in `public/css/styles.css`, the base rule the shared gating model reveals against.
- `#spa-shell` dropped its inline `margin-top`; `styles.css` already sets it and the shared shell adjusts it when a banner is shown.

### Verified
- Browser-verified against a full theta-suite stack (sso-manager + proxy + jump-host): every top-level page renders with a clean console; nav gating is correct for admin and non-admin; `forceLogin`'s onboarding and group gates fire; `val.js` blocks a weak password and accepts a strong one through a real form submit; the DELETE-method forms work; and the OIDC login round trip (authorize with PKCE -> login -> consent -> callback -> token fragment) completes on both OIDC clients.

## [1.4.0] - 2026-07-25

### Bumped
- sso-manager-node -> [v1.4.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.4.0)
- proxy -> [v1.3.0](https://github.com/theta42/proxy/releases/tag/v1.3.0)
- jump-host -> [v1.2.0](https://github.com/theta42/jump-host/releases/tag/v1.2.0)

This release unifies the three theta42 apps onto shared `@simpleworkjs/*` packages
(`oidc-client`, `directory-schema`, `ldap`, `app-stack` — published under the
simpleworkjs org at 1.0.0), replacing each app's byte-identical forks of the same
code so they share one codebase and API schema. It also fixes a security
regression in the SSO directory discovery API (OAuth `client_secret_hash` leaked
to every authenticated caller) and the envelope drift that broke jump-host
bridging. The shared UI chrome (`top.ejs`/`bottom.ejs`, `app-base.js`, `val.js`)
is intentionally **not** unified in this release — that work is deferred to a
browser-verified session; see `UI_UNIFICATION_HANDOFF.md`. No `setup.sh` change:
the new `@simpleworkjs/*` deps resolve from npm inside each app's image build
(`npm ci` stays clean; no `file:`/`link:`).

sso-manager-node 1.4.0:

### Security
- **The directory discovery API leaked OAuth `client_secret_hash` (and any secret-ish metadata key) to every authenticated caller.** `Resource` doesn't override `toJSON`, so the ORM serialized `metadata` wholesale — including the `client_secret_hash` stored on `kind:'oauth'` resources — across `GET /api/discovery/resources`, `/graph`, `/me`, `/resources/:slug`, and the directory-admin `GET /api/directory-admin/resources`. Every discovery read endpoint and the admin list now route through `projectResource`/`projectResources` from `@simpleworkjs/directory-schema`, which unconditionally strips secret keys (anything matching `/secret|password|privatekey/i`, including `client_secret_hash`) and, for non-directory-admins, reduces metadata to a public allowlist. Admins never receive `client_secret_hash` either.

### Fixed
- **Directory discovery envelope drift.** `routes/discovery.js` (the `autoRouter(Resource)` mounted live at `app.js:87`) returned **bare arrays**, not the `{ results: [...] }` envelope the directory contract specifies — so jump-host's `data.results || []` collapsed every per-group query to `[]` and no user could bridge. Discovery is now served by explicit `/resources`, `/resources/:slug`, `/graph`, `/me` handlers that all return the `{ results }` envelope. The dead `routes/api_discovery.js` (mounted at `app.js:112`, *after* the 404 catcher) and its mount were removed.
- `GET /api/discovery/resources?group=<cn>` now returns 200 with `{ results: [...] }` instead of 404.

### Added
- `@simpleworkjs/directory-schema` — the directory contract: the `kind` enum, `Resource`/`ResourceEdge`/`ResourceGroup` field defs, the `{ results }` envelope, the security projection (`projectResource`/`projectResources`/`isDirectoryAdmin`), and the discovery client. `models/resource.js` imports the field defs; the discovery + directory-admin routes use the projection.
- `@simpleworkjs/ldap` — `models/user_ldap.js` and `models/group_ldap.js` now take `escapeFilter`/`escapeDN` and `makeClient`/`withClient` from the shared package (via local wrappers that pass `conf`); sso keeps its rich `User.get`/`Group.get`/`User.login`/`User.addSSHkey` (posix/write-side stays app-local). sso's `makeClient` passes no `tlsOptions`, so cert validation is unchanged.
- `@simpleworkjs/app-stack` — unified `build_info` (`{buildVersion, buildHash, buildYear}`) and the `static-modules` mounting helper. `utils/build_info.js` and the static-modules loop in `routes/index.js` use the shared helpers.
- New `tests/discovery.test.js` (jest + supertest, runs under the docker harness): locks in the `{ results }` envelope on `/resources`, `/graph`, `/me`, `/resources/:slug`, the `?group=` 200-regression, and the no-`client_secret_hash`/no-secret-key guarantee for every caller.

### Changed
- Dependency alignment: `ldapts` `^8.1.2` → `^8.1.8`. The new `@simpleworkjs/*` deps resolve from the npm registry (`^1.0.0`); no `file:`/`link:` entries in the lockfile, so `npm ci` is clean in docker builds.
- `build_info` export shape changed from `{commit, version}` to `{buildVersion, buildHash, buildYear}` (the shared shape used by all three apps).

proxy 1.3.0:

### Added
- `@simpleworkjs/oidc-client` — the OIDC client (session models, auth router, OIDC utils, safe-redirect, local-admin bootstrap). Deleted the local `utils/oidc.js`, `utils/safe_redirect.js`, `models/oidc_state.js`, `models/token.js`, `models/auth.js`, `routes/auth.js`; `models/index.js` wires the factory. The per-host SSO in `routes/host_auth.js` is unchanged but consumes the shared OIDC utils.
- `@simpleworkjs/ldap` — the ldapts client + RFC 4515/4514 escaping.
- `@simpleworkjs/app-stack` — unified `build_info` (`{buildVersion, buildHash, buildYear}`) and the `static-modules` mounting helper. `utils/build_info.js` and the static-modules loop in `routes/render.js` now use the shared helpers.

### Security
- **LDAP filter injection in `User.get`.** The user lookup built its search filter by interpolating `data.username` raw into `(&(objectClass=inetOrgPerson)(uid=<username>))`. A username containing `*`, `(`, `)`, `\`, or NUL could widen or alter the filter (e.g. `*` → match-all). The filter value is now passed through `escapeFilter` from `@simpleworkjs/ldap` (RFC 4515 escaping).

### Changed
- Dependency alignment: `model-redis` `^1.5` → `^1.6.0`, `ldapts` `^8.1.2` → `^8.1.8`. The four new `@simpleworkjs/*` deps resolve from the npm registry (`^1.0.0`); no `file:`/`link:` entries in the lockfile, so `npm ci` is clean in docker builds.
- `build_info` export shape changed from `{commit, version}` to `{buildVersion, buildHash, buildYear}` (the shared shape used by all three apps). The `/health` endpoint and footer now report `buildVersion`/`buildHash`.

jump-host 1.2.0:

### Added
- `@simpleworkjs/oidc-client` — the OIDC client (session models, auth router, OIDC utils, safe-redirect, local-admin bootstrap). Deleted the local `utils/oidc.js`, `utils/safe_redirect.js`, `models/oidc_state.js`, `models/token.js`, `models/auth.js`, `routes/auth.js`; `models/index.js` wires the factory and the local-admin bootstrap.
- `@simpleworkjs/directory-schema` — the sso↔jump-host directory contract. `utils/access.js` now fetches reachable hosts through the shared `createDirectoryClient` (`getResourcesByGroup`).
- `@simpleworkjs/ldap` — `models/user_ldap.js` is now a thin wrapper over `createLdapClient`, preserving this app's loose TLS default (`rejectUnauthorized: false`) and the exact export shape.
- `@simpleworkjs/app-stack` — unified `build_info` (`{buildVersion, buildHash, buildYear}`) and the `static-modules` mounting helper. `build_info` moved from `models/` to `utils/`; `routes/render.js` uses `mountStaticModules`.

### Fixed
- **Directory envelope drift was silently treated as "no reachable hosts".** `utils/access.js` previously read `data.results || []`, so if the SSO directory ever returned a bare array (envelope drift) every per-group query collapsed to `[]` and no user could bridge. The shared client now validates the `{ results }` envelope on every call and treats an envelope violation as a failed group fetch rather than silently returning `[]`.

### Changed
- Dependency alignment: `ldapts` `^8.1.2` → `^8.1.8`, `redis` `^4.7` → `^6.1.0` (the direct `redis` dep is unused — only `model-redis` is used, which already brings `redis` ^6.1.0). The new `@simpleworkjs/*` deps resolve from the npm registry (`^1.0.0`); no `file:`/`link:` entries in the lockfile, so `npm ci` is clean in docker builds.
- `build_info` export shape changed from `{commit, version}` to `{buildVersion, buildHash, buildYear}` (the shared shape used by all three apps). The `/health` endpoint and footer now report `buildVersion`/`buildHash`.
- `app-base.js` `forceLogin`/`logInRedirect` switched to the `?redirect=` query-param convention (matching the server-side `/login?redirect=` route).

## [1.3.7] - 2026-07-23

### Added
- The bootstrap now provisions the jump host's **web-UI SSO login** when the jump host is enabled: it mints a dedicated `theta-jump` OAuth client and writes a full `oidc` block (endpoints, client id/secret, callback) plus a generated local anti-lockout admin password into `./config/jump-secrets.js`. Matches how the proxy's OIDC client is provisioned. An existing pre-OIDC `jump-secrets.js` (API token but no OIDC client) is regenerated so upgraders get SSO login. Requires jump-host ≥ v1.1.0.

## [1.3.6] - 2026-07-23

### Bumped
- sso-manager-node -> [v1.3.2](https://github.com/theta42/sso-manager-node/releases/tag/v1.3.2)

sso-manager-node 1.3.2:

### Fixed
- **OAuth client management API returned `client_id: undefined` on every GET**, which broke this stack's bootstrap: it lists the OAuth clients and rotates by the returned `client_id`, so it called `/api/oauth/client/undefined/rotate` and got a 500 — aborting `setup.sh` with `bootstrap failed` whenever `proxy-secrets.js` had no usable secret (e.g. a fresh/rotated deployment). The ORM's `toJSON()` was stripping the mapped `client_id`/`scopes`/… fields; `OAuthClient.get()` now emits them explicitly (and omits `client_secret_hash`). Unknown client ids now 404 instead of 500.

## [1.3.5] - 2026-07-23

### Added
- **Optional SSH jump host** (theta42/jump-host) as a third, opt-in submodule. Enable with `CFG_JUMP_HOST_ENABLED=true` in `setup.env`: setup.sh clones/tag-tracks the submodule and builds it behind the `jump-host` compose profile, the bootstrap mints a directory API token and writes `./config/jump-secrets.js` (LDAP admin bind so it can inject users' `sshPublicKey`), the jump host is registered as a proxy Host (its web UI) and seeded as a directory service. Users then `ssh uid_-_host@jump.<domain>` (WinSCP-friendly) or `ssh uid@jump.<domain>` for a TUI host picker; the web UI on :3002 shows audit + metrics. Off by default — existing installs are unaffected.

## [1.3.4] - 2026-07-23

### Bumped
- sso-manager-node -> [v1.3.1](https://github.com/theta42/sso-manager-node/releases/tag/v1.3.1)

sso-manager-node 1.3.1:

### Added
- The Directory documentation (`docs/directory.md`) is now surfaced: registered in-app at `/docs/directory` ("Directory & Inventory"), help-linked from the Directory page header, and linked from the docs-site index. Extended with the shared slug conventions (`site_<name>`, `host_<hostname>` — as used by ldap-client and the theta-suite seed), the automatic-registration story (theta-suite stack seeding, ldap-client Linux host enrollment), and the API surface (admin at `/api/directory-admin`, read-only graph at `/api/discovery`).

### Changed
- Direct LDAP binds are described as first-class, not "legacy", across README, DEPLOYMENT.md, docs, and the Dockerfile: Linux hosts are a primary consumer of the directory (PAM/SSSD login, LDAP-backed `sudo` via `sudoRole`, SSH public keys via openssh-lpk) — exactly what the custom schemas exist for.

### theta-suite own changes

### Added
- `CFG_SITE_NAME` in `setup.env` (right below `CFG_DOMAIN`, default `local`): names the SSO directory site the stack registers itself under — slug `site_<name>`, matching the `parentSlug` convention ldap-client-joined Linux hosts use, so they land under the same site.
- The directory seed now collects real host facts on the machine (hostname, IP, MAC of the default-route interface, OS pretty-name, kernel — same collection as `ldap-client/index.sh`) and registers the stack host as `host_<hostname>` with that metadata, plus fills in each service's internal port and git repo (`sso-manager` 3001, `proxy` 3000, `openldap` 389/636, `openresty` 443). Existing resources from the earlier seed layout (`stack-host`, domain-slug site) are adopted in place — seed metadata only fills fields the operator hasn't set, never overwrites.
- The bootstrap now seeds the SSO directory with the stack's own resources: a site (from the configured domain), a "Stack host", and the SSO Manager + Proxy services (with their public URLs in metadata), linking the proxy's auto-registered OAuth client under its service. Also seeds the two non-obvious services the stack runs: the OpenLDAP directory (advertising the `ldaps://` endpoint Linux hosts and LDAP-native apps bind to, honoring `ldap.ldapsHost`) and the OpenResty edge (the 80/443 data plane every hostname flows through, with a wildcard `https://*.<domain>` address). The Directory page is populated out of the box instead of starting empty. Idempotent — resources whose slug already exists are operator-owned and never touched, and a seed failure only warns (never fails a bring-up, e.g. against an older sso-manager image without `/api/directory`).

## [1.3.3] - 2026-07-23

### Bumped
- sso-manager-node -> [v1.3.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.3.0) (from v1.1.18; includes the intermediate v1.2.1 release)

sso-manager-node 1.3.0:

### Added
- **OAuth client management API** at `/api/oauth/client` (group `app_sso_oauth_admin`): list, create, update, delete, and rotate-secret for OAuth clients, backed by the Resource model. Accepts form-style string inputs (newline-separated `redirect_uris`/`allowed_groups`, space-separated `scopes`).
- **Dockerized test suite**: `docker-compose -f docker-compose.test.yml up --build` spins up OpenLDAP + Redis + a test-runner that seeds the test user and runs the full jest suite (174 tests) against them. `tests/globalSetup.js` honors `REDIS_URL`.

### Fixed
- Completed the model-redis → `@simpleworkjs/orm` port that shipped half-finished in 1.2.1:
  - `OtpToken.issue`/`verify` called nonexistent `find()`/`listDetail()` — every OTP login 500'd.
  - Impersonation create/revoke called nonexistent `ImpersonationToken.listDetail()` — both endpoints 500'd.
  - `OAuthClient` read `is_valid` from the Resource model, which has no such column — every client evaluated as disabled and **all `/oauth/authorize` requests were rejected with 400**. Client validity now lives in `metadata` (absent = valid).
  - `OAuthClient.add` didn't set the required-unique `Resource.slug`; clients now get a slug derived from the client name.
  - `GET /api/token/:name/:token` returned `{results: null}` with 200 for unknown tokens (orm `get()` returns null instead of throwing); now 404s.
- `User.login` returns a clean 401 instead of crashing when neither `uid` nor `username` is supplied.
- Depend on published `@simpleworkjs/orm` ^0.2.8 and `model-redis` ^1.6.0 instead of a local `file:` link that broke `npm ci` in docker builds.

### Changed
- Removed the Mobile Phone field from the user create/edit form.

sso-manager-node 1.2.1:

### Added
- **Actionable Metrics**: New real-time metrics tracking for failed logins, top IPs, and service usage per user.
- **LDAP Monitor**: Background service to parse OpenLDAP binds over port 389 and track metrics for legacy apps.
- **UI Updates**: Executive dashboard now displays actionable metrics cards instead of raw logs. User profiles show individual service usage stats to admins.
- **Directory Management**: Integrated site/host/service abstractions into directory UI and allowed associating OAuth apps directly to services.

## [1.3.2] - 2026-07-21

### Bumped
- proxy -> [v1.2.2](https://github.com/theta42/proxy/releases/tag/v1.2.2)

proxy:

### Fixed
- Multi-target load balancing (added in 1.2.0) crashed every request to a load-balanced host: `ops/nginx_conf/targetinfo.lua` required a nonexistent `resty.balancer.round_robin` module. The `lua-resty-balancer` rock actually installed provides `resty.roundrobin` instead, with a different constructor API. Fixed `targetinfo.lua` to use the real module — verified end-to-end that requests now round-robin across targets with no Lua errors.

## [1.3.1] - 2026-07-21

### Bumped
- proxy -> [v1.2.1](https://github.com/theta42/proxy/releases/tag/v1.2.1)
- sso-manager-node -> [v1.1.18](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.18)

proxy:

### Fixed
- The bootstrap anti-lockout admin account was always created as `proxyadmin2` regardless of `conf.auth.adminUsers`, while `migrations/permission_bootstrap.js` grants the global-admin permission to `conf.auth.adminUsers[0]`. If an operator customized `adminUsers` away from the default, the bootstrapped account and the permissioned account were two different (non-matching) usernames, so the anti-lockout account ended up with no admin access. `models/user_redis.js` now derives the bootstrap username from `conf.auth.adminUsers[0]` (falling back to `proxyadmin2`), matching `permission_bootstrap.js`.
- Corrected a `secrets.js.example` comment that claimed the bootstrap admin's password "defaults to the username itself" — it actually generates a random password printed to the container log on first boot.

### Changed
- Refreshed all README screenshots (hosts, per-host SSO auth, per-host basic auth) against the current UI, and added a new load-balancing screenshot for the multi-target feature.

sso-manager-node:

### Added
- N-Way Multi-Master LDAP replication: `LDAP_SERVER_ID` + `LDAP_REPLICATION_HOSTS` configure `syncrepl` peers in the bundled OpenLDAP, and a new `/sites` page (nav: **Sites**) shows each configured peer's LDAP URL and live reachability.
- A `location` property on users, editable from the profile and user-edit forms.

### Fixed
- `/sites` (added above) 500'd on every load: `views/sites.ejs` included nonexistent partials `header`/`footer` instead of this app's actual `top`/`bottom`. Fixed to match every other view.

### Changed
- Refreshed all README screenshots (dashboard, users, groups, OAuth apps) against the current UI, and added a new Sites & Replication screenshot.

### theta-suite own changes
- Refreshed `docs/images/sso-dashboard.png` and `docs/images/proxy-hosts.png` to match the submodules' updated screenshots.

## [1.1.20] - 2026-07-20

### Bumped
- proxy -> [v1.1.17](https://github.com/theta42/proxy/releases/tag/v1.1.17)

proxy:

### Fixed
- An existing single-label subdomain host (e.g. `sso.nl.wgnode.com`) could not be attached to a wildcard cert added later (e.g. `*.nl.wgnode.com`): `Host.lookUpWildcardParent()` only checked the wildcard-as-child position (the wildcard's own base domain) and missed the far more common wildcard-as-sibling case, so the edit form's "Parent Wildcard" option stayed permanently greyed out. It now checks both positions, and a regression test covers the sibling case.

## [1.1.19] - 2026-07-18

### Bumped
- sso-manager-node -> [v1.1.17](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.17)

sso-manager-node:

### Added
- `conf.ldap.ldapsHost` and `conf.ldap.ldapsPort` config options for advertising a separate, internal-only LDAPS hostname on the `/integrations` page. Falls back to the public OAuth issuer host when unset.
- Contextual help panel on `/integrations` → LDAP explaining why LDAPS needs a hostname, why port 636 should not be forwarded publicly, and the recommended internal-DNS / Docker-internal alternatives.
- Tests for the `/integrations` route's LDAPS URL derivation and `ldapsHost` override.

### Changed
- `nodejs/package.json` / `package-lock.json` version bumped to `1.1.17`.
- `routes/index.js` now derives the displayed LDAPS URL from `conf.ldap.ldapsHost`/`ldapsPort` with fallback to the OAuth issuer host.
- `docs/configuration.md`, `docs/ldap.md`, `DEPLOYMENT.md`, and `secrets.js.example` document the new `ldapsHost`/`ldapsPort` options and recommended network layouts.

### theta-suite own changes
- `setup.env.example` adds optional `CFG_LDAPS_HOST` for the internal LDAPS hostname.
- `setup.sh` passes `CFG_LDAPS_HOST` into the generated `./config/sso-secrets.js` as `ldap.ldapsHost`.
- `config.example/sso-secrets.js.example` documents `ldap.ldapsHost` / `ldap.ldapsPort`.
- `.env.example` adds `LDAPS_HOST` for legacy `.env` migrations.
- `docker-compose.yml` comments warn against forwarding 636 to the public internet.
- `README.md` explains the `CFG_LDAPS_HOST` recommendation in the port-forwarding section.

## [1.1.18] - 2026-07-18

### Bumped
- proxy -> [v1.1.16](https://github.com/theta42/proxy/releases/tag/v1.1.16)
- sso-manager-node -> [v1.1.16](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.16)

proxy:

### Changed
- Public-release packaging: removed `"private": true` from `nodejs/package.json`, corrected the repository URL to `https://github.com/theta42/proxy.git`, and fixed the MIT `LICENSE` copyright line.
- Genericized committed config defaults in `conf/base.js` and `conf/development.js` (`example.com` / `localhost` instead of theta42 infrastructure).
- The bootstrap `proxyadmin2` account now gets a random, one-time password when `auth.localAdminPass` is unset, instead of the well-known default.

### Security
- Sanitized rendered docs HTML with `xss` in `routes/docs.js`.
- The Unix socket JSON-RPC socket is now created with mode `660` instead of world-writable `777`.

### Fixed
- The global error handler no longer leaks `err.keys`, stack traces, or internal details in JSON responses.
- `DEPLOYMENT.md` and `docs/docker.md` now correctly describe the `CONF_SECRETS` env-var mechanism.

sso-manager-node:

### Security
- Hardened LDAP filter and DN construction against injection in `models/group_ldap.js` and `models/user_ldap.js`.
- Replaced `Math.random()`-based token/UUID/OTP generation with `crypto.randomUUID()` / `crypto.randomInt()` in `models/token.js`, `models/oauth_code.js`, and `models/oauth_client.js`.
- Refused startup when `oauth.jwtSecret` is missing or placeholder.
- Sanitized rendered docs/Terms-of-Service HTML with `xss` to block malicious markdown output.
- Removed full-object `console.log` of new-user data and reduced login error logging to `name`/`message` only.

### Changed
- Public-release packaging: removed `"private": true` from `nodejs/package.json` and bumped version to `1.1.16`.

### Fixed
- `models/email.js`: fixed from-address template rendering bug.

### theta-suite own changes
- `CHANGELOG.md` now embeds the full app-level release notes for each submodule bump, not just links.
- `.env.example` no longer ships realistic-looking default passwords; values are clearly placeholders.
- `config.example/*.js.example` comments now describe the actual `CONF_SECRETS` env-var loading mechanism.
- `setup.sh` summary no longer prints generated passwords to stdout; it points to `./config/*.js`.
- `bootstrap/bootstrap.js` fails hard instead of falling back to weak default passwords when config is missing.

## [1.1.17] - 2026-07-18

### Bumped
- proxy -> [v1.1.15](https://github.com/theta42/proxy/releases/tag/v1.1.15)
- sso-manager-node -> [v1.1.15](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.15)

Both apps' bare-metal `install.sh` now installs to `/opt/theta42/<app>` and seeds `/etc/<app>/secrets.js` on first run, matching a `wget -O - .../install.sh | sudo bash` one-line install for both (previously proxy-only); re-running it prints the version it's updating from/to. sso-manager-node's installer was rewritten from a flag-driven, copy-based script into the same idempotent git-clone pattern proxy already used, and now bootstraps OpenLDAP itself on first run instead of requiring the repo to already be checked out locally. None of this affects the Docker/unified-stack deployment this repo orchestrates — bare-metal-only.

## [1.1.16] - 2026-07-18

### Bumped
- proxy -> [v1.1.14](https://github.com/theta42/proxy/releases/tag/v1.1.14)
- sso-manager-node -> [v1.1.14](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.14)

Both: bumped `@simpleworkjs/conf` to 1.2.0 and `jq-repeat` to 2.2.0.

### Changed
- `./config/sso-secrets.js` and `./config/proxy-secrets.js` are now loaded via each app's `CONF_SECRETS` env var (set by the entrypoint) instead of being symlinked into `/app/conf/secrets.js` — neither container needs write access to its own `conf/` directory anymore. No change to the config file format or bind mounts; existing `./config/` directories keep working as-is.

## [1.1.15] - 2026-07-17

### Bumped
- proxy -> [v1.1.13](https://github.com/theta42/proxy/releases/tag/v1.1.13)
- sso-manager-node -> [v1.1.13](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.13)

proxy:

### Fixed
- The host edit form's "Parent Wildcard" option stayed greyed out even when a valid wildcard actually existed for that host, so an already-created host could never be switched onto one from the edit modal (only brand-new hosts, via the field's `keyup` handler, ever saw it become available). The underlying `/host/lookup/:item` check also had the same self-match issue as the recently-fixed backend bug: it resolved an already-existing host to its own record instead of a sibling wildcard. Added a dedicated `/host/wildcard-parent/:item` endpoint that checks both directions, and the edit form now actually runs the check when it opens.
- Fixed an nginx startup warning: `the "listen ... http2" directive is deprecated, use the "http2" directive instead`. Migrated to the standalone `http2 on;` directive (nginx 1.25.1+).

### Added
- Four new plain-language docs aimed at less technical readers, replacing the system-design-level Architecture/Installation docs as the target of most card help links: **Hosts & HTTPS**, **DNS Providers**, **Users, Groups & Permissions**, and **API Tokens**. Each links onward to the deeper technical reference for readers who want it; the technical docs link back the other way too. The personal-access-token card (previously missed entirely) now has a help link.

### Fixed
- The in-app docs viewer rendered every `docs/*.md` page with a garbled heading and a stray horizontal rule at the top — Jekyll front matter (meant only for the GitHub Pages build) was never stripped before being handed to the markdown renderer. Also fixed: cross-doc links never resolved in-app, since this viewer serves docs at `/docs/<slug>` with no `.html` suffix — they're now rewritten to the correct in-app URL (by registered slug, falling back to the doc's real filename), the same way image paths already were.

sso-manager-node:

### Added
- Three new plain-language docs aimed at less technical readers, replacing the schema-level LDAP/OAuth/API docs as the target of most card help links: **Accounts, Groups & Managers**, **Connecting Apps (SSO)**, and **API Tokens**. Each links onward to the deeper technical reference for readers who want it; the technical docs link back the other way too. The personal-access-token card (previously missed) now links to its own doc.

### Fixed
- The in-app docs viewer rendered every `docs/*.md` page with a garbled heading and a stray horizontal rule at the top — Jekyll front matter (meant only for the GitHub Pages build) was never stripped before being handed to the markdown renderer. Also fixed: cross-doc links (`ldap.html`, `index.html`, etc.) never resolved in-app, since this viewer serves docs at `/docs/<slug>` with no `.html` suffix — they're now rewritten to the correct in-app URL, the same way image paths already were.
- The new concept docs' cross-links (`concepts-accounts.html` etc.) are the correct, working URL on the Jekyll/GitHub Pages build (where the page's URL is its filename stem) but didn't resolve in the in-app docs viewer, which serves docs at a separate short slug (`/docs/accounts`). The in-app renderer now also resolves a doc's real filename as a fallback, so one link written in a doc works on both targets.

## [1.1.14] - 2026-07-17

### Bumped
- proxy -> [v1.1.11](https://github.com/theta42/proxy/releases/tag/v1.1.11)
- sso-manager-node -> [v1.1.11](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.11)

Both: moved the help (❓) link out of the global header and onto each relevant card individually, so it deep-links straight to the doc that actually covers that card instead of one generic per-page guess.

## [1.1.13] - 2026-07-17

### Bumped
- proxy -> [v1.1.10](https://github.com/theta42/proxy/releases/tag/v1.1.10)
- sso-manager-node -> [v1.1.10](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.10)

Both: added a help icon (❓) in the top-right header that deep-links to the doc most relevant to the current page, and made the in-app docs viewer (`/docs`) searchable (a simple line-substring search over the local doc set, no new dependency, still works with no internet access).

## [1.1.12] - 2026-07-17

### Bumped
- proxy -> [v1.1.9](https://github.com/theta42/proxy/releases/tag/v1.1.9)

proxy:

### Added
- The host list now shows who created each host, and when.
- Plain (non-wildcard) hosts can now be renamed after creation — the hostname field is no longer permanently locked. Wildcard hosts, wildcard children, and auto-created subdomain cache entries stay locked, since other records reference them by name.
- More inline help text on the host create/edit form (Target SSL, wildcard matching behavior).

### Fixed
- The host create/edit modal's tabs could overflow awkwardly on narrow (mobile) screens — they now scroll horizontally instead.
- Fixed a bug in the vendored `model-redis` library's record-rename path: renaming a record's primary key while another `always`-type field (e.g. `updated_on`) is defined earlier in the schema left a stray, incomplete hash behind under the old key, making that name permanently unavailable for reuse. Worked around in `Host.prototype.update()`.

## [1.1.11] - 2026-07-17

### Bumped
- proxy -> [v1.1.8](https://github.com/theta42/proxy/releases/tag/v1.1.8)

proxy:

### Fixed
- **Couldn't attach an existing host to a parent wildcard.** The host edit form's "Parent Wildcard" option submitted correctly, but `Host.prototype.update()` had no `challengeType` handling at all (only `Host.create()` did) — selecting it and saving silently did nothing. Added the same wildcard-parent lookup to `update()`.
- **Couldn't register a wildcard's own base domain as a host.** A wildcard cert's `altNames` already cover both the base domain and `*.base domain`, but the lookup tree stores the wildcard one level below its base domain, and a lookup for the bare base domain landed on that empty parent node and found nothing — even though the already-issued cert covers it. `buildLookUpObj()` now also stamps the parent node so this resolves correctly, without re-issuing or duplicating the cert.

## [1.1.10] - 2026-07-17

### Bumped
- sso-manager-node -> [v1.1.9](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.9)

sso-manager-node:

### Added
- Every account's personal Unix group (its primary GID holder) can now have supplementary members managed from the account's profile page ("Members of `<uid>`'s group", admin-only) — e.g. to share write access to files owned by that group. Uses the standard `memberUid` attribute (RFC 2307 `posixGroup`).

## [1.1.9] - 2026-07-17

### Bumped
- sso-manager-node -> [v1.1.8](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.8)

sso-manager-node:

### Added
- Group membership is now editable directly from a user's profile page ("My groups" -- add via a group-name picker, remove with a button per row), instead of only from each group's own card on the Groups page. Admin-only, using the existing per-group member add/remove endpoints.

### Fixed
- The Edit Profile form's Mobile Phone field had a stray `validate=":9"` making it effectively required (submission was blocked with "Please fix the form errors" if left blank) -- it was always meant to be optional, matching the "Add user" form. Removed.
- A service account's profile always showed `Name: Service Account` -- every service account has the same literal filler given/last name (a schema-satisfying placeholder, not meant to be shown), making them indistinguishable by name. The Name line is now hidden for service accounts.
- The Users page's Service Accounts tab, and a freshly-created service account's own profile, could appear empty/not-a-service-account for up to 5 minutes right after creation. Creating a user caches it via `User.get()` *before* the route handler marks it as a service account (group membership), so the cached copy had `isServiceAccount` stuck wrong until the cache TTL expired. Now cleared and re-fetched immediately after marking.
- A user belonging to exactly one LDAP group had their `memberOf` attribute returned as a bare string instead of a one-element array (ldapts's normal behavior for single-valued attributes) -- client-side permission checks (`for(let group of user.memberOf)`) would then iterate the DN character-by-character instead of once, causing pages gated on that group (e.g. Groups) to incorrectly show "You do not have permission to be here." Normalized `memberOf` to always be an array, same fix already applied to `manager`.

## [1.1.8] - 2026-07-17

### Bumped
- sso-manager-node -> [v1.1.7](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.7)

sso-manager-node:

### Changed
- **Service accounts unified to one kind.** Removed the LDAP bind-only service account type (the Integrations → LDAP "Service Accounts" card, and its `/api/service-account` routes) -- every service account is now a real Unix/POSIX account with a UID, created from the new **Users → Service Accounts** tab. Email and password are both optional for service accounts; a blank password means no `userPassword` is set at all (the account simply can't bind).
- **Added a `manager` field to every account.** Multi-valued (a list of usernames), defaults to whoever created the account (the admin who added it, or whoever sent the invite), and reassignable from the account's Edit form. Anyone listed as a manager can edit that account -- same fields an admin can (mobile, description, SSH key, date of birth, home directory, login shell, manager list) -- without needing `app_sso_admin`.
- `homeDirectory` and `loginShell` are now editable from the Edit Profile form (previously view-only).

## [1.1.7] - 2026-07-16

### Bumped
- proxy -> [v1.1.7](https://github.com/theta42/proxy/releases/tag/v1.1.7)
- sso-manager-node -> [v1.1.6](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.6)

Both: redesigned the GitHub Pages docs site to match each app's own look (dark navbar/footer, Bootstrap 5, Font Awesome) instead of the generic `jekyll-theme-cayman` theme, added a real cross-page nav, SEO (`jekyll-seo-tag` + `jekyll-sitemap`), and mobile-responsive layout. theta-suite's own docs site got the same treatment in this release too (see below).

### Changed
- theta-suite's own docs site redesigned the same way -- dark navbar/footer using the shared theta42 logo (this repo has no app UI of its own), cross-page nav, SEO, mobile-responsive. `docs/index.md`'s "More docs" section removed (redundant with the new nav).
- Added `docs/_site` to `.gitignore` (missing entirely before).

## [1.1.6] - 2026-07-16

### Bumped
- proxy -> [v1.1.6](https://github.com/theta42/proxy/releases/tag/v1.1.6)

proxy: Hosts admin UI's Authentication tab radios (Off / Basic / SSO) had no shared `name`, so clicking one didn't uncheck the others. Added `name="auth_mode"` to restore standard exclusive radio-group behavior.

## [1.1.5] - 2026-07-16

### Bumped
- proxy -> [v1.1.5](https://github.com/theta42/proxy/releases/tag/v1.1.5)
- sso-manager-node -> [v1.1.5](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.5)

Both: bumped `jq-repeat` 2.0.1 -> 2.1.0. proxy fixed real breakage from the removed `__setPut`/`__setTake` API (insert/remove row hooks in the admin UI); sso-manager-node fixed a stale-data flash in the edit-profile flow caused by `update()`'s new throttling.

## [1.1.4] - 2026-07-16

### Added
- White-label support in both proxy and sso-manager-node -- `<title>`, navbar brand, and logo are now conf-driven (`conf.name`/`conf.logo`) instead of hardcoded. Closes [proxy#45](https://github.com/theta42/proxy/issues/45) and [sso-manager-node#6](https://github.com/theta42/sso-manager-node/issues/6).

### Fixed
- sso-manager-node: the bundled default LDAP ppolicy had `pwdLockout: FALSE`, silently making "deactivate user" not actually block login. Fixed, with a drift-correction path for already-deployed instances.

### Bumped
- proxy -> [v1.1.4](https://github.com/theta42/proxy/releases/tag/v1.1.4)
- sso-manager-node -> [v1.1.4](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.4)

## [1.1.3] - 2026-07-16

### Added
- `CHANGELOG.md` (this file). Closes [#43](https://github.com/theta42/theta-suite/issues/43).

### Bumped
- proxy -> [v1.1.3](https://github.com/theta42/proxy/releases/tag/v1.1.3)
- sso-manager-node -> [v1.1.3](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.3)

## [1.1.2] - 2026-07-16

### Changed
- `docs/index.md` (the published site's home page) never linked to `architecture.md`, `quickstart.md`, or `standalone.md` — added a "More docs" section so they're reachable from the site instead of only by direct URL.

### Bumped
- proxy -> [v1.1.2](https://github.com/theta42/proxy/releases/tag/v1.1.2)
- sso-manager-node -> [v1.1.2](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.2)

## [1.1.1] - 2026-07-16

### Changed
- `setup.sh` now pins `proxy` and `sso-manager-node` to their latest release tag (`vX.Y.Z`) instead of the tip of `master`. A rebuild now always lands on a tagged, versioned release of each app rather than whatever was most recently merged upstream.

### Bumped
- proxy -> [v1.1.1](https://github.com/theta42/proxy/releases/tag/v1.1.1)
- sso-manager-node -> [v1.1.1](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.1)

## [1.1.0] - 2026-07-16

First tagged release. Establishes the `vX.Y.Z` tag convention going forward.

### Added
- `setup.sh` now reports which submodules actually moved to a newer commit during an update, instead of updating silently.

### Bumped
- proxy -> [v1.1.0](https://github.com/theta42/proxy/releases/tag/v1.1.0)
- sso-manager-node -> [v1.1.0](https://github.com/theta42/sso-manager-node/releases/tag/v1.1.0)

[Unreleased]: https://github.com/theta42/theta-suite/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/theta42/theta-suite/compare/v1.3.7...v1.4.0
[1.1.17]: https://github.com/theta42/theta-suite/compare/v1.1.16...v1.1.17
[1.1.16]: https://github.com/theta42/theta-suite/compare/v1.1.15...v1.1.16
[1.1.15]: https://github.com/theta42/theta-suite/compare/v1.1.14...v1.1.15
[1.1.14]: https://github.com/theta42/theta-suite/compare/v1.1.13...v1.1.14
[1.1.13]: https://github.com/theta42/theta-suite/compare/v1.1.12...v1.1.13
[1.1.12]: https://github.com/theta42/theta-suite/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/theta42/theta-suite/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/theta42/theta-suite/compare/v1.1.9...v1.1.10
[1.1.9]: https://github.com/theta42/theta-suite/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/theta42/theta-suite/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/theta42/theta-suite/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/theta42/theta-suite/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/theta42/theta-suite/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/theta42/theta-suite/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/theta42/theta-suite/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/theta42/theta-suite/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/theta42/theta-suite/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/theta42/theta-suite/releases/tag/v1.1.0

## [1.34.4] - 2026-08-02
### Changed
- Updated `sso-manager-node` submodule to `v1.19.6` to pull in a fix for the Vault API 403 error on the Secrets List.

## [1.34.5] - 2026-08-02
### Added
- Automatically build and install `theta-agent` on the host system as a systemd service during `setup.sh`.
- Added `CFG_CREATE_ALL_HTTP` option to `setup.env` to create all default proxy host entries with `forcessl=false`.
