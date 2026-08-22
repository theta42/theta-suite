# Known Issues

## Operational Footguns

*   **Multi-Site E2E Not in CI:** The multi-site end-to-end testing (`test/multisite_join_e2e.js`) is omitted from GitHub Actions (`.github/workflows/ci.yml`). This has historically allowed broken replication patches to be released, as the tests must be run manually. The spec claims `pr-tests.yml` exists, but the file has drifted.
*   **Relay Silent-Failure Prerequisite:** On the master host, a manual `ip route add 10.0.0.0/8` must be configured towards the gateway interface. The setup script does not automatically check for or configure this, resulting in 502 errors for relayed hostnames when missing.
*   **Fire-and-Forget Replication:** [FIXED in v2.24.19] The system lacked catch-up guarantees (no acknowledgments, queuing, or retries). This has been resolved by adding a 5-minute periodic `adoptFromMaster` sync on Spokes to ensure any missed webhooks do not cause permanent data drift.
*   **Agent Location Parenting Resolution:** [FIXED in v3.21.23] The master site's resource tree formerly dropped agents into the master site if they were registered with a domain rather than an IP, as the location metadata was not passed to the DiscoveryReconciler.
*   **Spoke Onboarding Requirement Resets:** [FIXED in v3.21.23] A bug where Master overwrote Spoke onboarding states (TOS, Passwords) upon resync because Spoke proxies were not configured to forward these SQLite model writes back to the Master via `spoke_write_proxy.js`.
*   **VM Sizing & Swapping:** Spoke sites are expected to run on low-end DigitalOcean droplets (e.g. 512MB RAM). However, Docker builds and runtime memory pressure can cause out-of-memory kills (OOM). A swapfile is necessary in these environments (e.g. `fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`), and `setup.sh` instructions should reflect this.

## Security Tradeoffs

*   **Weak `AgentJoinKey` Security:** `AgentJoinKey` acts merely as a shared secret (`auth_token`) for the agent WebSocket. If an attacker acquires it, they can fully impersonate the agent and execute commands as root (via capabilities) across the cluster, completely bypassing OAuth/SSO.
*   **Global Agent Execution on Directory Disconnects:** If a Spoke site loses connection to the Master and its proxy's internal cache expires, it cannot authenticate SSO. However, an attacker with a known `auth_token` can still connect to the Spoke's websocket API and execute commands locally without restriction, as the WebSocket endpoint bypasses directory authentication.
*   **Unauthenticated Agent Discovery:** [FIXED in v2.24.20] The agent discovery/telemetry pipeline `/api/discovery/sync` endpoint previously allowed unauthenticated payload injection. An attacker could potentially craft malicious metadata payloads (e.g., location spoofing, fake capabilities) if they had network access to the API. This has now been restricted to admins and machine accounts.
