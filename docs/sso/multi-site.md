---
layout: default
title: Multi-Site (Master/Spoke Join)
---

# Multi-Site (Master/Spoke Join)

If you run more than one physical site, Theta Directory can run one site as
the **master** (single write authority for the shared catalog) and any
number of **spokes** — read-only replicas that stay in sync automatically and
run local authentication with zero WAN dependency.

This is a higher-level mechanism than [raw LDAP N-way
replication](replication.html) — and it now drives that lower-level
replication for you automatically. See [How this relates to LDAP
replication](#how-this-relates-to-ldap-replication) below.

## Why and when to use this

- **Zero-touch spoke setup.** One join key, one URL, and a spoke adopts the
  whole directory (users, groups, resource catalog) in one step — no manual
  `syncrepl` configuration.
- **Single write authority, no split-brain.** Only the master accepts
  directory writes. A spoke that loses WAN connectivity keeps working for
  local reads/auth and unconditionally stays read-only — it never silently
  promotes itself. Changing which site is master always requires an explicit,
  authenticated action by a `god_admin`.
- **Stays in sync, not just a one-time copy.** Once joined, a spoke keeps
  receiving live updates whenever the master's catalog changes — you don't
  re-run the join to pick up new hosts/apps/users.

## How it works

1. **On the master**, an admin mints a **site join key** (Directory → the
   Master Site modal → **Site Join Keys** → Mint key). It's shown once,
   stored hashed, and revocable.
2. **On the spoke** (must be a fresh install — no users beyond the bootstrap
   admin, no enrolled agents), either:
   - Paste the master's URL and the join key into the Master Site modal's
     **Join an Existing Site** form, or
   - Set `CFG_MASTER_DIRECTORY_URL` / `CFG_MASTER_DIRECTORY_JOIN_KEY` before
     the first `./setup.sh` run -- either in `setup.env` (which has every
     option), or in a dedicated `spoke.env` (`cp spoke.env.example spoke.env`)
     if you'd rather keep join-a-cluster config separate from the rest of the
     stack's setup. Both are read; `spoke.env`'s values win on a conflict.
     No public IP on this site at all? `spoke.env.example` also covers the
     no-inbound relay vars (`CFG_SPOKE_NO_INBOUND`/`CFG_SPOKE_PUBLIC_HOST`).

     Want this spoke reachable at its own public domain rather than sharing
     the master's? `CFG_DOMAIN` (the LDAP identity namespace) must stay
     identical across every site in a cluster — MMR replicas can't diverge
     on base DN — but `CFG_PUBLIC_DOMAIN` overrides just this site's own web
     hostnames (`sso.*`/`proxy.*`) independently of it. Only meaningful for
     an inbound spoke serving its own traffic directly.
3. The spoke pulls the master's full export (LDAP tree, resource catalog,
   agent-signing key) and adopts it, then registers its own reachable URL
   with the master so it can receive live updates going forward.
4. From then on, every change to the master's catalog pushes to every
   registered spoke automatically. A spoke's own directory-write requests are
   rejected with a `403` pointing at the master — writes always go there.

### Promoting a spoke to master

If the master site goes down for good (or you're relocating write
authority), a `god_admin` can promote any spoke from its own Master Site
modal. Promotion is one coordinated action: it demotes the previous master as
part of the same request (best-effort — an unreachable old master never
blocks the promotion, since that's exactly the scenario this exists for), and
every other spoke gets pointed at the new master automatically.

## What replicates

| Data | How |
|---|---|
| LDAP (users, groups) | Full export on join; live push on every master change |
| Resource catalog (hosts, apps, sites) | Same |
| Agent-signing key | Same — every site can validly sign a command for any agent enrolled at *any* site |

The agent-signing key being identical everywhere is a deliberate tradeoff for
small, trusted deployments (a handful of sites, not hundreds) — it means
compromising the least-secured spoke has the same agent-command blast radius
as compromising the master. If that tradeoff doesn't fit your deployment,
don't rely on this mechanism as-is.

Secrets *beyond* the agent-signing key (LDAP admin password, JWT secret, and
so on) are **not** currently synced — each site still generates its own.

## Requirements and current limits

- Both sites need a network path to each other's HTTP(S) API — the master to
  pull an export from, the spoke to push replication updates back to. A site
  with **no inbound path at all** (e.g. behind CGNAT) can still join: set
  `CFG_SPOKE_NO_INBOUND=true` + `CFG_SPOKE_PUBLIC_HOST` (`spoke.env.example`)
  once its jump-host is meshed to the master's over WireGuard (mesh peering
  itself is a manual, one-time step on both jump-hosts — see [Theta Gateway
  → Mesh](../jump-host/mesh.html)) — the master then relays traffic to it
  and auto-creates the matching route on its own `theta-proxy`. A spoke with
  **zero inbound and zero outbound** path still can't join at all (the join
  itself needs to reach the master's API directly).
- Joining only ever happens on a **fresh install**. There's no way to merge
  an already-populated directory into a master's — re-provision the host
  first.
- Promoting a spoke to master doesn't instantly finish reconciling OpenLDAP
  replication (see below) — re-run `setup.sh` on the newly-promoted node
  promptly afterward.

## How this relates to LDAP replication

[N-way LDAP replication](replication.html) is the *lower-level* mechanism
underneath this: `slapd`'s own `syncrepl`, wired via `LDAP_SERVER_ID` +
`LDAP_REPLICATION_HOSTS`. Originally this was hand-configured by the
operator, separately from the join flow above, for deployments that wanted
every site independently writable with no concept of a master.

**When you join via this page's flow, that lower-level config is now handled
for you.** The master auto-assigns each spoke a unique `LDAP_SERVER_ID` at
join time and derives every site's LDAP URL from its already-known HTTPS
endpoint — `theta-suite`'s `bootstrap/site-ldap-register.js` applies it,
re-checked on every `setup.sh` run since the peer list grows as spokes join.
You don't hand-set `LDAP_SERVER_ID`/`LDAP_REPLICATION_HOSTS` for a cluster
built this way. See [Geo-Location Scaling](replication.html#automatic-config-via-multi-site-join)
for the mechanics, and its documented limitation: the *master's* own
replication list only updates on ITS next `setup.sh` run, not live the
instant a new spoke joins.

Still want fully independent, always-writable sites with no master/spoke
concept at all? `CFG_LDAP_MMR_MANUAL=true` opts out of the automatic path so
you can hand-set `LDAP_SERVER_ID`/`LDAP_REPLICATION_HOSTS` directly, same as
before this integration existed.

## See also

- Full architecture and current implementation status:
  [`MULTI_SITE_SPEC.md`](https://github.com/theta42/theta-suite/blob/master/docs/MULTI_SITE_SPEC.md)
  in the `theta-suite` repo.
- Endpoint-level detail: [`docs/site-join.md`](https://github.com/theta42/theta-directory/blob/master/docs/site-join.md)
  in the `theta-directory` repo.
- Site-to-site networking (WireGuard mesh between gateways, independent of
  directory sync): [Theta Gateway → Mesh](../jump-host/mesh.html).
