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

**Known limitation**: the *master's* own `LDAP_REPLICATION_HOSTS` only gets
recomputed when its `setup.sh` is re-run — there's no live push telling an
already-running master about a spoke that joined five minutes ago. Re-run
`setup.sh` on the master after bringing up a new spoke (or after promoting
one to master) to pick up the current peer list. A spoke's own config, by
contrast, is re-checked and applied on every `setup.sh` run there, which is
the common/recurring event.

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
