---
layout: default
title: Architecture
description: How Theta Suite 2.0 composes Theta Directory, Theta Gateway, Theta Proxy, and Theta Agent around a shared OpenBao secrets store — the zero-trust identity, mesh gateway, and telemetry architecture.
---

# Architecture

[← Back to Home](index.html)

Theta Suite 2.0 is a production-grade **composition repository**: it composes applications from git submodules and provides the automated first-run orchestration, secrets initialization, and container networking for a complete zero-trust infrastructure stack.

---

## Core Infrastructure Components

| Subproject / Image | Component Role |
|------|------|
| [`theta42/theta-directory`](https://github.com/theta42/theta-directory) | **Theta Directory** — OIDC provider + OpenLDAP directory + Resource Catalog + Web Admin Console. All-in-one container. |
| [`theta42/jump-host`](https://github.com/theta42/jump-host) | **Theta Gateway** — Directory-driven SSH access gateway and site router: WireGuard site-to-site mesh, per-user device VPN, per-device internet exits, and NETMAP shadow subnets. Holds no network config of its own; it applies the roster the directory publishes. |
| [`theta42/theta-agent`](https://github.com/theta42/theta-agent) | **Theta Agent** — Multi-platform host telemetry, hardware details, desktop session controls, and secret delivery agent. |
| [`theta42/proxy`](https://github.com/theta42/proxy) | **Theta Proxy** — OIDC-protected reverse proxy (OpenResty + Node management app + Redis). |
| [`theta42/ldap-client`](https://github.com/theta42/ldap-client) | **ldap-client** — Enrolls real Linux hosts into the directory for PAM/SSSD login, sudo rules, and SSH keys. |
| `quay.io/openbao/openbao` | **OpenBao** — Central secrets engine (Vault fork), KV-v2 versioned store at `secret/`. |
| `theta42/theta-suite` (this repo) | Composes all components on a single Docker network + automates `./setup.sh` first-run wiring. |

---

## Architecture Stack

```
          ┌──────────────────────────────────────────────────────────┐
          │ browser / OIDC apps │ SSH clients │ Linux hosts            │
          │                     │             │ (PAM/SSSD, sudo, keys)  │
          └────────┬────────────┴──────┬──────┴───────────┬───────────┘
            https (:443)          ssh (:2222)        ldaps (:636)
                  │                     │                  │
         ┌────────▼────────┐  ┌──────────▼────────┐         │
         │  theta-proxy     │  │  theta-gateway    │         │
         │  OpenResty       │  │  SSH Gateway      │         │
         │  :80/:443/:4443  │  │  site router      │         │
         │  mgmt app :3000  │  └────────┬──────────┘         │
         └────────┬─────────┘           │ OIDC + LDAP        │
                  │ http:3001 (internal)│ via theta-directory
                  ▼                     ▼                  ▼
        ┌───────────────────────────────────────────────────────┐
        │  theta-directory (Express + OpenLDAP + Redis)         │
        │  OIDC provider + LDAP directory + Resource Catalog    │
        │  web UI :3001 (internal)   ldaps :636 (published)     │
        └───────────────────────────────────────────────────────┘
                          ▲  loads secrets at boot (scoped token each)
              ┌───────────┴───────────────────┐
              │  openbao   (KV-v2 at secret/)  │  ← central secrets store
              │  :8200 (internal)             │     per-user + per-app KV
              │  :8080 (operator UI/API)     │
              └───────────────────────────────┘

   The site network — every site that joins the directory is allocated one
                 id (its LDAP ServerID), which becomes 172.24.0.<id> for its
                 gateway and 10.<id>.0.0/16 for everything at that site. The
                 gateway reads the roster from the directory and configures
                 WireGuard, routes, NAT and LAN mapping from it; it publishes
                 only its own public key and endpoint back. No gateway can
                 write another site's config.
                 See docs/jump-host/mesh.html.

   Note the gateway is the ONE component that does NOT run in the compose
                 stack: it is a router, and routing the physical LAN (NETMAP,
                 MASQUERADE out the real uplink, LAN machines reaching the
                 mesh) cannot be done from inside a Docker network namespace.
                 It installs on the host as the theta-gateway systemd service
                 (jump-host/install.sh, run for you by setup.sh). Containers
                 reach it at host.docker.internal:3002; it reaches them over
                 loopback. See docs/jump-host/deployment.html.

   ldap-client — enrolls real Linux hosts into the directory above
                 (PAM/SSSD login, sudo, SSH-key serving); also the
                 `ldap-test-host` fixture (opt-in: `--profile ldap-test`).
```

sso-manager and proxy each bundle their **own Redis** (a 127.0.0.1:6379
instance per container); the gateway uses the host's Redis service (bound to
loopback by `install.sh`, data at `/var/lib/theta-gateway/redis`). All share
the `openbao` secrets store.
Direct LDAP binds against `:636` are first-class — that's how Linux hosts do
PAM/SSSD login, sudo, and SSH-key serving, and how LDAP-native apps
authenticate — not a fallback path.

### What's exposed, what's not

| Port | Service | On host? | Purpose |
|------|---------|----------|---------|
| `443` | proxy | **yes** | public entry point — OIDC login + proxied apps + the SSO/proxy UIs |
| `80` | proxy | **yes** | HTTP-01 for Let's Encrypt (and redirect to 443) |
| `4443` | proxy | yes (optional) | alt HTTPS listener |
| `3000` | proxy | localhost/LAN | proxy mgmt UI/API (fronted by 443 normally) |
| `3001` | sso-manager | localhost/LAN | SSO web UI (fronted by the proxy normally) |
| `636` | sso-manager | **yes** | LDAPS for direct-LDAP clients (Linux hosts, LDAP-native apps) |
| `389` | sso-manager | **yes** | plain LDAP — needed by the stack's OWN host enrollment (setup.sh / ldap-client configure sssd against ldap://localhost); bind to 127.0.0.1 via `LDAP_BIND` if you don't want it on the LAN |
| `2222` | jump-host | **yes** | SSH front door |
| `3002` | jump-host | **yes** | jump-host web UI/API |
| `8080` | openbao | yes | OpenBao UI/API for the operator (apps use `openbao:8200` internally) |

---

## Secrets (OpenBao)

Every component loads its secrets from one OpenBao instance at boot, not
from scattered config files. OpenBao runs as the `openbao` container
(`http://openbao:8200` on theta-net, KV-v2 at `secret/`); each app gets a
**scoped token** (never the root token) whose OpenBao policy confines it to
the paths it needs:

| Service | env var | Policy | Access |
|---------|---------|--------|--------|
| sso-manager | `SSO_VAULT_TOKEN` | `sso-broker` | `secret/sso-manager/conf`, `secret/users/*`, `secret/apps/*`, `secret/plugins/*`; also mints per-user + per-app tokens |
| proxy | `PROXY_VAULT_TOKEN` | `proxy` | `secret/proxy/conf` (read) |
| jump-host | `JUMP_VAULT_TOKEN` | `jump-host` | `secret/jump-host/conf` (read) |

At boot each app calls `@simpleworkjs/bao-conf`'s `init()`, which deep-merges
its OpenBao path over the file-loaded `@simpleworkjs/conf` object — so OpenBao
is authoritative at runtime, with the `./config/*-secrets.js` file kept only as
an operator-edited seed and a fail-soft fallback (`init()` is fail-soft, so the
app still boots from the file if OpenBao is unreachable). The proxy and
jump-host consume `conf.oidc.clientSecret` at `require` time, so `init()`
runs *before* their models load (see each app's `bin/www`).

Beyond app config, OpenBao holds:

- **Per-user secret storage** — `secret/users/<uid>/*`, browsed and edited in
  the SSO UI's **My Secrets** page. Each user is confined to their own
  namespace by a `user-<uid>` policy; admins see all of `secret/`.
- **External-app tokens** — an admin mints a scoped `app-<name>` token
  (confined to `secret/apps/<name>/*`) from the SSO UI's **Apps** tab, so an
  external app can read its own secrets over the OpenBao HTTP API.

`setup.sh` creates the policies + a `sso-broker` token role and mints the
per-app tokens on first run; the root token stays in `master.env` for
seeding/maintenance only and is never passed to a service container. Full
details — the policy model, the `secret/apps/<app>/conf` convention, `curl`
+ Node examples, and the operator rotation procedure — are in
[Secrets](secrets.html).

---

## The first-run bootstrap

`./setup.sh` orchestrates first-run wiring; `bootstrap/bootstrap.js` does the
actual work, running **inside the sso-manager container** (bind-mounted
read-only from this repo). It's deliberately self-contained — only Node
built-ins (`child_process`, `crypto`, `fs`) + global `fetch`, and it reads its
inputs from the bind-mounted `./config/sso-secrets.js` + `./config/proxy-secrets.js`
(not from env).

OpenBao comes up first: `setup.sh` initializes and unseals it, writes the
policies and the `sso-broker` token role, mints the per-app scoped tokens into
`master.env`, and idempotently seeds `secret/sso-manager/conf`,
`secret/proxy/conf`, and `secret/jump-host/conf` from the corresponding
`./config/*-secrets.js` files. The app containers then start with their scoped
`VAULT_TOKEN`. The SSO/LDAP/OIDC wiring that follows:

1. **Build + start sso-manager**, wait for `/health`.
2. **LDAP service account** — `ldapadd` `cn=ldapclient,ou=people,<base>` (an
   `organizationalRole` with a `{SSHA512}` password). The proxy binds as this
   DN — not the admin DN.
3. **First admin user** — `ldapadd` `cn=<uid>,ou=people,<base>` (inetOrgPerson +
   posixAccount, `{SSHA512}` password) and add them as `member` of
   `app_sso_admin` + `app_sso_oauth_admin` (the SSO's permission check reads the
   group's `member` list).
4. **Log in** as that admin via `POST /api/auth/login {uid,password}` — this
   also validates the password end-to-end.
5. **Register the proxy as an OIDC client** via `POST /api/oauth/client` (gated
   by `app_sso_oauth_admin`, satisfied by step 3). The SSO **generates** the
   `client_id`/`client_secret` (UUIDs) — supplied creds are ignored — so the
   bootstrap writes the generated creds **back into `./config/proxy-secrets.js`
   and into OpenBao at `secret/proxy/conf`** (the sso-manager mounts `./config`
   read-write for this; the proxy mounts it read-only). If `proxy-secrets.js`
   already holds a `clientId`+`clientSecret` matching an existing client, they
   are kept; if the client exists but the file has no usable secret, the
   secret is rotated and written back.
 6. **Build + start the proxy**, wait for `/health`. Its entrypoint points
    `CONF_SECRETS` at `./config/proxy-secrets.js`, then `@simpleworkjs/bao-conf`
    overlays the OpenBao path over it (the OAuth clientSecret + LDAP bind creds
    come from OpenBao at runtime).
 7. **Install + start the gateway on the host** — `setup.sh` copies
    `./config/jump-secrets.js` to `/etc/theta-gateway/jump-secrets.js` and runs
    `jump-host/install.sh` (systemd `theta-gateway.service`, run as root because
    it is a router). The gateway reads `CONF_SECRETS=/etc/theta-gateway/jump-secrets.js`
    plus `VAULT_TOKEN` from `/etc/theta-gateway/gateway.env`, and reaches the
    stack over loopback (`http://127.0.0.1:3001`, `ldaps://127.0.0.1:636`).
 8. **Register `<SSO_HOST>` and `<PROXY_HOST>` as Host records in the proxy** —
    `setup.sh` runs a short script inside the proxy container that calls its
    Host model directly (`Host.create({host, ip, targetPort, ...})`), rather
    than the proxy's own HTTP API, since no authenticated session exists yet at
    this point in the run. The proxy routes every hostname purely off a Host
    record (`ops/nginx_conf/proxy.conf` has no default/self route), so without
    this step neither URL resolves to anything. `<SSO_HOST>` targets
    `sso-manager:3001` (the Docker service), `<PROXY_HOST>` targets
    `127.0.0.1:3000` (the proxy's own management app, same container). Both
    are created with `sso_enabled: false` — each app already gates its own
    login, and SSO-gating the SSO's own login page would be circular. Skips a
    host that already exists, so re-running `setup.sh` is a no-op here.

`setup.sh` then prints the first-admin login + the public URLs.

### How config reaches the apps

Config and secrets live in two layers: an operator-edited
`./config/*-secrets.js` file (gitignored, bind-mounted or copied to the host)
and the OpenBao overlay over it. Each entrypoint points the `CONF_SECRETS`
env var (`@simpleworkjs/conf` >= 1.2.0) at its file early, before the app
starts:

```
CONF_SECRETS=/config/sso-secrets.js      (sso-manager, ./config RW)
CONF_SECRETS=/config/proxy-secrets.js    (proxy, ./config RO)
CONF_SECRETS=/etc/theta-gateway/jump-secrets.js  (gateway, host install)
```

`@simpleworkjs/conf` loads `conf/base.js → <env>.js → secrets file → app_*
env`, where **env beats the secrets file**. Then `@simpleworkjs/bao-conf`
deep-merges the app's OpenBao path over the result at boot — OpenBao is the
authoritative runtime layer; the file is the seed and fail-soft fallback. So
compose passes **no `app_*` config env vars** (only `NODE_ENV`, `NODE_PORT`,
`VAULT_ADDR`, and a scoped `VAULT_TOKEN`) — that keeps the secrets file + OpenBao
authoritative. The SSO entrypoint reads the few values it needs at startup
(LDAP base DN, admin password, JWT secret, cert CN) from `sso-secrets.js` via
an in-container `node` call.

### Why not `require` the SSO's internal models?

A `docker compose exec` process reads `conf/base.js` defaults (the docker-exec
env doesn't carry the entrypoint's exported vars), so the SSO's models would
bind the wrong LDAP DN. Using the `openldap-clients` binaries with explicit
admin creds from `./config/sso-secrets.js` sidesteps that entirely, and going
through the HTTP API for the OAuth client validates the whole admin login path
end-to-end.

---

## Idempotency

Re-running `./setup.sh` converges to `./config/` + OpenBao:

- The LDAP service account + admin passwords are **reset to `./config/`**.
- Group membership is ensured (add is a no-op if already a member).
- The OAuth client is kept if `proxy-secrets.js` already holds its creds;
  created or rotated otherwise, and the new creds written back (to the file
  and to OpenBao).
- OpenBao policies, token role, per-app tokens, and `secret/<app>/conf` seeds
  are ensured (created if absent, left alone if present).

So `setup.sh` is safe to re-run after editing `./config/`, after a `docker
compose down`, or after restoring from backup.

---

## Backups and restore

`./setup.sh` auto-snapshots `./config/` + LDAP + all the Redis instances to
`./backups/<timestamp>/` before each rebuild (keeps the last `BACKUP_KEEP`,
default 5). State lives on named volumes (`ldap-data`, `ldap-certs`,
`sso-data`, `proxy-data`, `proxy-cache`, `proxy-logs`, `openbao-data`) and
survives recreation; `down -v` wipes them. Redis is persisted with AOF + RDB
on those volumes. The gateway no longer has containers: it runs on the host
as the `theta-gateway` systemd service, and its WireGuard identity/sessions
live in the host Redis at `/var/lib/theta-gateway/redis` (see
`docs/jump-host/deployment.md`) — back that up separately. SSH host keys live
at `/opt/theta-suite/.persist/jump-host/keys` and are backed up with the
theta-suite checkout. For the full
manual-backup + restore runbook (full / Redis-only / LDAP-only, with the
AOF-vs-RDB note), see the *Backups and restore* section of the
[README](https://github.com/theta42/theta-suite#backups-and-restore). OpenBao
holds the live secrets, so back up its volume too (`<project>_openbao-data`,
where `<project>` is your clone directory name — `theta-suite` for a fresh
clone). Quick LDAP backup:

```bash
docker compose exec sso-manager slapcat -f /etc/openldap/slapd.conf -b "<base>" > backup.ldif
```

---

## Plugin Ecosystem

The SSO Manager utilizes a dynamic plugin registry (`nodejs/services/plugin_registry.js`) that automatically loads any `.js` file placed in the `nodejs/plugins/<category>` folders.

### Discovery Plugins
Discovery plugins (e.g., `nmap.js`, `proxmox.js`, `docker.js`) run on a defined cron schedule to sync external assets into the centralized directory catalog.

### Messaging Plugins
Messaging plugins (e.g., `twilio.js`, `webhook.js`) provide on-demand delivery capabilities for alerts, 2FA tokens, and notifications. 
- **Universal REST Webhook:** Sends custom JSON payloads to platforms like Slack, Teams, or custom API endpoints securely.
  - *Discord Example:* To send alerts to a Discord channel, create a new plugin instance of type "Universal REST Webhook". Set the **Webhook URL** to your Discord webhook URL (e.g., `https://discord.com/api/webhooks/...`), the **HTTP Method** to `POST`, and the **Payload Template** to `{"content": "Alert for {{to}}: {{message}}"}`. Leave the Headers and API Secret blank.
- **Twilio SMS:** Sends standard SMS codes.
- **Fallback:** If no messaging plugins are enabled, the system falls back to the legacy `voipms` integration configured in the SSO secrets.

Secrets belonging to plugins are automatically pushed to OpenBao (`secret/plugins/<id>/conf`) and are never written to the local database, following the global secrets architecture.

[← Back to Home](index.html)