---
layout: default
title: Where the Gateway Runs
---

# Where the Gateway Runs

Every other component of Theta Suite is a container in one `docker-compose.yml`.
The gateway is the exception: it is meant to run **on the host** — bare metal, a
VM, or an LXC system container.

This page explains why, because "one of these is not like the others" is the
kind of decision that gets quietly undone later.

## The short version

The gateway is a **router**. Routers need to be where the network interfaces
are. Every awkward thing about running one inside a Docker network namespace is
the router trying to escape that namespace.

## What breaks in a container

A containerised gateway can still mesh with other sites, serve device VPNs, and
route traffic between sites. Those all live inside WireGuard and work fine in a
namespace.

What does **not** work is everything that touches the physical network:

- **NETMAP has nothing to map.** The shadow ranges exist to make each site's
  `192.168.1.0/24` globally distinct. In a container there is no
  `192.168.1.0/24` — only a Docker bridge — so there is nothing on the other
  side of the mapping.
- **`MASQUERADE -o eth0` hits the wrong network.** Inside a container, `eth0` is
  a veth on the Docker bridge, not the site uplink.
- **Machines on your LAN cannot reach the mesh.** The recommended static route
  (`10.0.0.0/8` → the gateway) needs the gateway to *be* a host on your LAN. A
  container is not.
- **Port forwarding** (planned) is DNAT on the host. Doing it into a namespace
  is a second layer of translation for no benefit.

## Why not the usual container escapes

Three standard workarounds were considered and rejected:

**`network_mode: host`** breaks five things at once. Docker DNS disappears, so
the gateway can no longer resolve `openbao` and the directory can no longer
resolve `jump-host`. `ports:` is silently ignored, so `JUMP_SSH_PORT` and
`JUMP_WEB_PORT` stop remapping anything. And the gateway's bundled Redis — which
holds sessions, OAuth state and API tokens — binds `0.0.0.0:6379` on the machine
instead of staying in its namespace. That last one is a security regression, not
an inconvenience.

**macvlan** actually works and keeps Docker DNS (attach the container to both
the bridge and the macvlan network). But it needs a real Ethernet NIC in
promiscuous mode: not most WiFi adapters, and not most VPS providers. It also
brings the standard gotcha that the Docker host cannot reach its own macvlan
containers without a shim interface — awkward when that host is where you SSH
from.

**Passing a physical NIC into the container** works too (`ip link set eth1 netns
<pid>`), but Compose cannot express it, so it becomes a post-start script. The
namespace changes every time the container is recreated, so the next
`docker compose up -d` after an image update silently leaves the gateway without
its interface — a failure that appears exactly when you are least likely to be
looking.

Each of those is a different set of caveats and a different failure mode to
document. One host install has none of them.

## LXC, VM, or bare metal

From the gateway's point of view these are the same thing: its own init, its own
routing table, namespaced sysctls (`ip_forward` and `rp_filter` are per-netns),
working `iptables`/NETMAP, and real interfaces. One native install runs on all
three.

**LXC is the nice middle ground** if you want the gateway isolated from the
directory host. LXD attaches a physical or macvlan NIC *declaratively*:

```
lxc config device add gateway lan nic nictype=physical parent=enp3s0
```

which persists across restarts — the thing the Docker equivalent cannot do.
In-kernel WireGuard works inside LXC (WireGuard is namespace-aware; the host
loads the module, the container creates interfaces), so you get the kernel
datapath rather than the `wireguard-go` fallback.

## Installing it

`theta-suite`'s `setup.sh` does this for you. To do it by hand, or to upgrade:

```
sudo ./jump-host/install.sh
```

It installs `redis-server`, `iproute2`, `iptables`, `wireguard-tools` and
`procps` if missing, lays the app down in `/opt/theta-gateway`, writes
`/etc/theta-gateway/gateway.env`, binds Redis to loopback, and enables the
`theta-gateway` systemd service. Re-running upgrades in place; config and data
are left alone.

| Path | What |
|---|---|
| `/opt/theta-gateway` | the application (replaced wholesale on upgrade) |
| `/etc/theta-gateway/gateway.env` | settings — written once, never overwritten |
| `/etc/theta-gateway/jump-secrets.js` | LDAP bind, API token, OIDC (from `setup.sh`) |
| `/var/lib/theta-gateway` | SSH host keys and Redis data |

```
systemctl status theta-gateway
journalctl -u theta-gateway -f
sudo ./jump-host/install.sh --uninstall
```

`--uninstall` deliberately **keeps** `/var/lib/theta-gateway`, because that is
where this gateway's WireGuard identity lives and every peer in the cluster
holds its public half. Deleting it silently breaks every tunnel to this site.

It runs as **root**. It creates WireGuard interfaces, writes the routing table,
sets `net.*` sysctls in the host namespace and installs NAT and NETMAP rules —
all of which need `CAP_NET_ADMIN` in the init namespace, where sysctl writes
are effectively root-only. A capability-scoped user would buy ambiguity rather
than safety.

### Two things to get right

**The SSH port.** The gateway's front door defaults to 2222 so it does not
collide with the host's own `sshd` on 22. The installer refuses to proceed if
the port is already in use, rather than "succeeding" and leaving you unable to
reach the box.

**Reaching the rest of the stack.** The directory and OpenBao run as containers
on the same host and publish their ports, so the gateway talks to them over
loopback — `127.0.0.1:3001` and `127.0.0.1:8080` — rather than by service name.
In the other direction, containers reach the gateway at
`host.docker.internal:3002`, which is why `sso-manager` and `proxy` carry an
`extra_hosts: host.docker.internal:host-gateway` entry.

## What running it in a container actually cost

Worth recording, because the failure was quiet. The gateway image shipped
without `iptables` or `procps`, and `/proc/sys` is read-only in a default
container. So a containerised gateway could hold tunnels and route between
sites, but **every NAT, forwarding and NETMAP call failed** — and because the
forwarding call was not guarded, it threw mid-reconcile and the exit
configuration after it never ran at all. Exits were planned and silently never
applied.

Both are fixed (the router degrades and reports a limitation instead of
throwing), but the shape of the bug is the argument: a router in a namespace
fails in ways that look like a healthy mesh.
