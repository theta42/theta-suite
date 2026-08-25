---
layout: default
title: Connecting
description: How to reach downstream hosts through the jump host — the username grammar, the interactive picker, SFTP/WinSCP, and what access you get.
---

# Connecting

You reach a downstream host two ways: name the target in your username, or log
in plain and pick it from a menu. Either way you authenticate **once**, to the
jump host, with your directory credentials.

## The username grammar

```
{uid}_-_{target}
```

- `{uid}` — your directory username.
- `_-_` — the separator (legal in an SSH username everywhere, including WinSCP).
- `{target}` — the host to reach: a directory **slug** (`host_web01` or just
  `web01`), the host's **display name**, its **IP**, or the hostname in its
  directory `address`.

```bash
ssh alice_-_web01@jump.example.com          # by slug (host_ prefix optional)
ssh alice_-_10.0.0.10@jump.example.com      # by IP (must be a host you can reach)
```

If the target matches a host your directory groups grant, you're bridged
straight to its `sshd` — same as if you'd SSH'd directly, but through the
audited jump host.

## SFTP / WinSCP / scp

Because the whole route is encoded in the username, file transfer tools that
only take one connection string work with no extra configuration:

```bash
sftp -P 2222 alice_-_web01@jump.example.com
scp -P 2222 file.txt alice_-_web01@jump.example.com:/tmp/
```

**WinSCP:** set Host name to `jump.example.com`, Port to `2222`, and User name
to `alice_-_web01`. SFTP is bridged as an opaque byte stream, so all operations
(browse, upload, download, rename) work normally.

## The interactive picker

Log in with just your username and you get a TUI list of every host you can
reach:

```bash
ssh alice@jump.example.com
```

- **↑ / ↓** move the selection
- **type** to filter the list incrementally
- **Enter** connect to the highlighted host
- **number keys** jump straight to that row
- **q** or **Ctrl-C** to quit

Pick a host and you're bridged into it. The picker only ever lists hosts your
directory access allows — it doubles as "what can I reach from here?"

## What you can reach

The set of hosts is computed per login: your LDAP group memberships intersected
with the SSO directory's hosts (via the `host_<name>_access` groups the
directory auto-creates for each machine). To get access to a new host, an admin
adds you to that host's access group in the SSO — nothing on the jump host
changes.

**A host running theta-agent is a jump target automatically.** Installing the
agent needs root on that machine *and* a join key from the directory, so the
machine is already under management; requiring a second, per-host grant before
it could be reached added nothing, and it was the reason a fleet of agent hosts
offered exactly one target. If your groups already grant access to hosts at
that site — `god_admin`, `{site}_super_admin`, or the `{site}_hosts_access` /
`{site}_hosts_admin` aggregate (see [GROUPS](../GROUPS.html)) — every agent host
at the site is in your picker, with no `<slug>_access` group to create first.

The rule is deliberately narrow:

- only **hosts**, and only subtypes that are a machine you log into. An
  iLO/BMC out-of-band controller is never offered, agent or not.
- only while the agent is **still enrolled**. Revoking or deleting an enrolment
  removes the host immediately.
- hosts **without** an agent are unchanged — they still need an explicit grant.

Services an agent registered (a systemd unit, a docker container) follow the
same host: whoever administers the machine administers its units, so they have
no access groups of their own.

Targets that don't resolve to a host you're allowed to reach are refused (and
audited). Raw IPs that aren't a known directory host are denied by default.


## Authentication

The jump host authenticates **you** against the directory:

- **Public key** — matched against your `sshPublicKey` entries in LDAP. Use your
  normal SSH key; the client picks it automatically.
- **Password** — your directory password (LDAP bind). Password auth is often
  restricted to local networks or disabled entirely on a public jump host
  (keys-only) — check with your operator.

You never manage a separate credential for the downstream host: the jump host
handles onward authentication for you (see
[Architecture](architecture.html#per-user-key-injection)).

## First connection to a host

The very first time you reach a given downstream host, the jump host provisions
its access key for you behind the scenes. If that first attempt races the
directory's key-cache refresh you may see a brief

```
jump-host: first-time key propagation, retrying…
```

and it reconnects automatically. Subsequent connections are immediate.
