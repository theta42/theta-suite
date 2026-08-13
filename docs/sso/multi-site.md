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
   - Set `CFG_MASTER_DIRECTORY_URL` / `CFG_MASTER_DIRECTORY_JOIN_KEY` in
     `spoke.env` (`cp spoke.env.example spoke.env`) before the first
     `./setup.sh` run. `spoke.env` is self-sufficient — do NOT also create
     `master.env`; `setup.sh` refuses to run with both present. There's no
     `CFG_DOMAIN` to set either: the LDAP identity namespace is fetched
     automatically from the master using the join key, so it can't drift from
     the master's by a typo. No public IP on this site at all?
     `spoke.env.example` also covers the no-inbound relay vars
     (`CFG_SPOKE_NO_INBOUND`/`CFG_SPOKE_PUBLIC_HOST`).

     Want this spoke reachable at its own public domain rather than sharing
     the master's? `CFG_PUBLIC_DOMAIN` (also in `spoke.env`) overrides just
     this site's own web hostnames (`sso.*`/`proxy.*`), independently of the
     shared LDAP domain. Only meaningful for an inbound spoke serving its own
     traffic directly.
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
part of the same request, inherits that master's spoke registry, and re-points
every other site in the cluster at the newly-promoted node — no per-spoke
operator action.

The one case that needs you: if the **old master is unreachable**, the
promotion still succeeds locally (that is exactly the scenario it exists for)
but there is nothing to inherit the registry from, so the other spokes stay
pointed at the master that is gone. The promotion result reports this as
orphaned siblings. Recover by re-registering each remaining spoke against the
new master (Multi-Site modal → **Re-register** on that spoke).

The promoted node's new LDAP ServerID (1) and its inherited peer list are
applied to its running `slapd` automatically, as part of the same promotion —
no `setup.sh` re-run, no restart.

## The Multi-Site modal

Everything below lives in Directory → the Multi-Site modal, and it is worth
knowing what each part is telling you.

**LDAP Replication (MMR)** shows this node's live `slapd` state, read out of
the running `cn=config` — not what the cluster merely intends:

- `ServerID <n>` / `<n> peers` — what this node's `slapd` is actually
  replicating with right now.
- **Peer list out of sync** / **ServerID out of sync** — the running config and
  the cluster's view disagree. Under normal operation you should never see
  this: replication config is applied automatically and live (see
  [LDAP replication](replication.html#automatic-config-via-multi-site-join)).
  If it does appear, the automatic path failed — typically a spoke that
  couldn't reach its master, or an `ldapmodify` slapd rejected — and the
  container log's `[ldap-reconcile]` lines say which. Re-running `./setup.sh`
  there is a way to force the issue, but the badge is a fault to investigate,
  not a routine chore.
- **Drift unknown** — the live config couldn't be read, or (on a spoke) the
  master couldn't be reached to ask what this site's config should be. Not
  the same as "in sync".

**Registered Spokes** (master only) lists every site receiving replication,
with actions per row:

- **Sync now** (row) / **Sync all now** (header) — pushes a resync
  immediately instead of waiting for the next catalog write, and *waits* for
  the result, so a failure tells you that site is unreachable right now.
- **Remove** — drops a site from the registry. Use it for a decommissioned
  site: it stops replication pushes and frees that site's LDAP ServerID.
  The removed site is not contacted (it may be gone), and keeps its own
  read-only copy. Its syncrepl entry is dropped from this node's running
  `slapd` as part of the removal — nothing else to do.

**Live Replication** (spoke only) with a **Re-register** button. "Snapshot
only" means this spoke is joined but not receiving live pushes — usually a
join made without a self URL, or a registry row that was removed and
recreated on the master, leaving the two ends disagreeing about the push
token. Re-register fixes all of those; re-joining cannot, since a node that
is already a spoke refuses to join again.

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
  — the master then relays traffic to it over the site network and
  auto-creates the matching route on its own `theta-proxy`. There is no
  separate mesh to set up first: joining the directory is what puts a site on
  the network (see [The Site Network](../jump-host/mesh.html)). A spoke with
  **zero inbound and zero outbound** path still can't join at all (the join
  itself needs to reach the master's API directly).
- Joining only ever happens on a **fresh install**. There's no way to merge
  an already-populated directory into a master's — re-provision the host
  first.
- Promoting a spoke to master reconciles OpenLDAP replication on the promoted
  node automatically (new ServerID + inherited peer list, applied live).

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
for the mechanics.

**It is applied live, on every site, with no `setup.sh` re-run.** Joining a
new site changes what every existing site's peer list should contain, so
each node converges its own running `slapd` (via the `cn=config` dynamic
backend) whenever the cluster changes — on registration, join, resync,
promotion, at boot, and on a periodic sweep. Nothing to remember, no restart,
and a site that was down while the cluster changed catches up by itself.

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
- Site-to-site networking, device VPN and internet exits — all keyed off the
  same site id this join flow allocates: [The Site
  Network](../jump-host/mesh.html).
