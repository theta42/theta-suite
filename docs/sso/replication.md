---
layout: default
title: Geo-Location Scaling (Replication)
---

# Geo-Location Scaling (Replication)

Theta Directory bundles its own identity provider, but if you have multiple physical sites, you may want a local copy of the directory at each site to ensure low latency and high availability.

## Why and when to use this?
- **High Availability (HA)**: If your primary site goes completely offline, your other sites can still authenticate users locally without depending on a WAN link.
- **Low Latency**: Applications at a remote site can bind directly to their local LDAP server (`localhost` or LAN IP) instead of traversing the internet to query the primary site, making logins blazing fast.
- **Independent Failure Domains**: By replicating only the LDAP directory (the source of truth) and keeping session state (Redis) independent, you prevent complex "split-brain" scenarios in the web UI. A failure at Site A won't bring down Site B.

By default, the `sso-manager` Docker container runs a single, independent OpenLDAP instance. However, you can enable **N-Way Multi-Master Replication** via environment variables.

## How it works

In an N-Way Multi-Master setup, every site runs a fully active OpenLDAP server (`slapd`).
- **Reads and Writes anywhere**: A user can change their password or update their profile at Site A, Site B, or Site C.
- **Conflict Resolution**: OpenLDAP's `syncrepl` engine uses Context Sequence Numbers (CSN) to track changes. If Site A goes offline and a user changes their password at Site B, Site A will automatically pull the newest changes the moment it rejoins the cluster.
- **Independent Redis**: Session data, API Tokens, and OAuth Clients are stored in Redis. By design, Redis is NOT replicated in this geographic setup. This ensures that a failure at Site A never causes Site B's Redis to become read-only, which would break the web UI at Site B. OAuth clients must be configured per-site.

## Configuration

The container's entrypoint reads two environment variables to configure this
-- `LDAP_SERVER_ID` (a unique integer for this node) and
`LDAP_REPLICATION_HOSTS` (a space-separated list of every **other** node's
LDAP URL) -- and, when both are set, automatically loads the `syncprov`
module, enables `mirrormode`, and generates the necessary `syncrepl` blocks
in `/etc/openldap/slapd.conf`.

### Automatic config via Multi-Site join

**If you're using [Multi-Site join](multi-site.html) (`CFG_MASTER_DIRECTORY_URL`/`spoke.env`),
you don't set these by hand.** The master assigns each spoke a unique
`LDAP_SERVER_ID` at join time (the same way it assigns a WireGuard mesh
index) and derives `LDAP_REPLICATION_HOSTS` from every site's already-known
HTTPS endpoint (`ldaps://<same-host>:636`) -- `theta-suite`'s `bootstrap/
site-ldap-register.js` applies it and re-checks on every `setup.sh` run,
since the peer list grows as new spokes join, restarting `sso-manager` only
when the computed config actually changed.

**This is applied live — you do not re-run `setup.sh` anywhere.** Adding a
site changes what *every* existing site's peer list should contain, so any
design where replication config only lands via `setup.sh` means an operator
ritual on every node, and silently divergent replication until they perform
it. That is not how it works:

- `slapd` runs from the **`cn=config` dynamic backend** (converted from the
  generated `slapd.conf` seed at container start), which makes `olcServerID`
  and `olcSyncrepl` modifiable while it is serving.
- Theta Directory converges its own running config whenever the cluster
  changes — a spoke registering or being removed, a join, a resync, a
  promotion, and at boot, plus a periodic sweep as a backstop. It reads the
  live config, computes the delta, and applies only what differs, so
  re-applying the same state is a no-op.
- No restart, no downtime, no operator step. A site that was offline while
  the cluster changed converges on its own when it comes back.

ServerID uniqueness is enforced by a unique index on the master's registry,
not just by the allocation code. Two spokes registering at the same instant
used to be handed the same ID, which does not error anywhere -- it quietly
breaks replication, because `ServerID` is how `syncrepl` tells originators
apart. A master upgrading from a build that had this bug repairs any existing
duplicates at startup (the oldest registration keeps its ID; the others are
moved and re-read theirs on the next reconcile) and logs each reassignment.

The Multi-Site modal still shows this node's live `ServerID`/peer count, and
still badges **Peer list out of sync** if the running config and the cluster's view
ever disagree. That badge is now a *fault indicator*, not an instruction: it
means the automatic path failed somewhere (a spoke that could not reach its
master, an `ldapmodify` that was rejected) and is worth investigating rather
than papering over. Under normal operation it never appears.

### Manual configuration

Have a topology outside a `theta-suite`-managed cluster (fully independent,
always-writable sites, no master/spoke concept)? Set
`CFG_LDAP_MMR_MANUAL=true` to skip the automatic path entirely and set the
two variables directly -- without this, the automatic step runs on every
deployment (every fresh install starts as a master) and will overwrite them.

**Site 1**
```env
LDAP_SERVER_ID=1
LDAP_REPLICATION_HOSTS="ldaps://sso.site2.com:636 ldaps://sso.site3.com:636"
```

**Site 2**
```env
LDAP_SERVER_ID=2
LDAP_REPLICATION_HOSTS="ldaps://sso.site1.com:636 ldaps://sso.site3.com:636"
```

**Site 3**
```env
LDAP_SERVER_ID=3
LDAP_REPLICATION_HOSTS="ldaps://sso.site1.com:636 ldaps://sso.site2.com:636"
```

## User Locations

When creating or editing a user, you can specify their **Location (Site)**. This maps directly to the standard LDAP `l` (localityName) attribute, allowing you to track which physical site a user belongs to natively within the directory.
