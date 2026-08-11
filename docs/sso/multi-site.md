---
layout: default
title: Multi-Site (Master/Spoke Join)
---

# Multi-Site (Master/Spoke Join)

If you run more than one physical site, Theta Directory can run one site as
the **master** (single write authority for the shared catalog) and any
number of **spokes** — read-only replicas that stay in sync automatically and
run local authentication with zero WAN dependency.

This is a different, higher-level mechanism than [raw LDAP N-way
replication](replication.html) — see [How this relates to LDAP
replication](#how-this-relates-to-ldap-replication) below if you're deciding
between the two.

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
  with no inbound path at all (e.g. behind CGNAT) can't join yet on its own;
  a relay mechanism for that case is designed but not automated (see the
  [architecture spec](https://github.com/theta42/theta-suite/blob/master/docs/MULTI_SITE_SPEC.md)
  for the current status).
- Joining only ever happens on a **fresh install**. There's no way to merge
  an already-populated directory into a master's — re-provision the host
  first.

## How this relates to LDAP replication

[N-way LDAP replication](replication.html) is a *lower-level*, different
mechanism: every site runs a fully independent, fully writable `slapd`, wired
together with raw `syncrepl` environment variables, and there's no concept of
a master or a managed join. It predates this feature and is still there for
deployments that specifically want every site independently writable.

Multi-site join (this page) is the opposite design: one write authority, a
managed onboarding flow, and automatic ongoing sync — closer to what most
"add a second office" or "add a home-lab spoke" setups actually want. **Don't
combine the two** — pick one per deployment.

## See also

- Full architecture and current implementation status:
  [`MULTI_SITE_SPEC.md`](https://github.com/theta42/theta-suite/blob/master/docs/MULTI_SITE_SPEC.md)
  in the `theta-suite` repo.
- Endpoint-level detail: [`docs/site-join.md`](https://github.com/theta42/theta-directory/blob/master/docs/site-join.md)
  in the `theta-directory` repo.
- Site-to-site networking (WireGuard mesh between gateways, independent of
  directory sync): [Theta Gateway → Mesh](../jump-host/mesh.html).
