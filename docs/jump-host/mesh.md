---
layout: default
title: The Site Network
---

# The Site Network

Every site in a Theta cluster gets a private network that every other site can
reach, plus a VPN for laptops and phones and a way to send a chosen device's
internet traffic out of a chosen site.

There is no separate mesh to set up. **A site joins the directory, and that is
what puts it on the network** — the directory allocates its site id, hands
every gateway the roster, and each gateway configures itself from it.

## Addressing

One number identifies a site everywhere. It is the site's LDAP ServerID,
allocated once by the directory master when the site joins, and it never
changes while the site exists.

| What | Address |
|---|---|
| The gateway's mesh identity | `172.24.0.<siteId>` |
| Everything at that site | `10.<siteId>.0.0/16` |
| The gateway, as that site's router | `10.<siteId>.0.1` |
| That site's directory | `10.<siteId>.0.2` |
| Devices (laptops, phones) | `10.<siteId>.128.0/17` |
| The site's first LAN, mapped | `10.<siteId>.168.0/24` |
| The site's second LAN, mapped | `10.<siteId>.172.0/24` |

So site 4's directory is `10.4.0.2` from anywhere in the cluster. Nothing is
port-forwarded and no ports are derived; the address is the address.

Because a site owns one octet, **a cluster tops out at 254 sites** — well below
LDAP's own limit of 4094 server IDs. The addressing is the binding constraint.

## Why your LAN appears twice

Almost every home and office LAN is `192.168.1.0/24`. If three sites each
announced that range, no one could tell them apart.

So each site's LAN is mapped 1:1 into a slot of its own `/16`. With site 2's
LAN set to `192.168.1.0/24`, the machine at `192.168.1.53` is reachable from
the whole cluster as `10.2.168.53` — same last octet, unambiguous prefix. The
mapping is per-site and configurable, so a site on `192.168.50.0/24` still gets
a working shadow.

Set the LAN ranges on the **Network → Sites** page in the directory.

## DNS

Set the site's DNS server to an address on one of its LANs — your router, your
Pi-hole, whatever already resolves your internal names.

Devices are handed the **mapped** address, not the one you typed. Entering
`192.168.1.1` at site 2 means devices are told to use `10.2.168.1`, which
resolves from anywhere. Handing out `192.168.1.1` directly would only work
while the device was sitting on that physical LAN — over the tunnel, that
address is not what is routed.

The site form shows the translation as you type, and warns if the address you
entered is not inside either mapped LAN, in which case it cannot be mapped and
devices would end up with no resolver at all.

## The hub

One site is the **hub**. It carries `10.0.0.0/8` as a catch-all, so two sites
that are not directly peered still reach each other through it. Set it on
**Network → Sites**.

Pick a site that is always up and publicly reachable — usually a cheap VPS
rather than whichever machine happens to run the master directory. If the hub
is down, directly-peered sites keep working and everything else loses
reachability.

WireGuard does longest-prefix matching, so a direct peer's `10.<n>.0.0/16`
automatically wins over the hub's `/8`. Nothing has to be subtracted or kept in
sync.

## Devices

Any signed-in user can enrol their own devices under **Network → My Devices**.

**Keys are your choice.** Paste a public key generated on the device and its
private half never touches the server. Leave the field blank and one is
generated, rendered into a config once, and forgotten — it is not stored, not
recoverable, and not logged. If you lose it, delete the device and enrol it
again.

Devices running **theta-agent** enrol themselves. The agent generates a
WireGuard keypair on first connect, keeps the private half on the machine
(`/etc/theta42/wg_private.key`, root-only; `%ProgramData%\Theta42\wg\private.key`
on Windows) and sends only the public half up. So an installed agent appears
here on its own, with no file copying and no QR code — and because the key is
stable and enrolment is idempotent by agent, reconnecting converges on the one
device row rather than adding another.

An admin sees every device at the site under **Network → Devices**, with its
owner and an `agent` badge on the self-enrolled ones. A non-admin sees their
own.

Everything else — phones, a router, anything without an agent — gets a config to
paste or scan, exactly as above.

Each device is given an address from its site's pool and can reach every site
in the cluster.

### MTU

Device configs pin `MTU = 1380`. Traffic that crosses the mesh and then leaves
through an exit is WireGuard inside WireGuard, and a device sized for a single
hop blackholes large packets on the second — the classic failure where SSH
works fine and HTTPS hangs forever. It is not tuned per path deliberately: a
slightly small MTU costs a little throughput, a slightly large one costs an
afternoon.

## Internet exits

A device can send its internet traffic out of another site — useful for
reaching something that only accepts connections from a known address, or for
appearing to be somewhere else.

Every site marked **offers an exit** (Network → Sites) is usable by everyone.
That flag is on by default, so a site that joins the mesh joins the exit pool —
clear it to take a site out again, for a metered link say.

*Extra exit access* (Network → Exit Access, admin only) is for the other case:
handing one user a site that is **not** in the shared pool. It is no longer a
prerequisite for the sites that are.

> This used to require both — the site willing *and* an explicit per-user grant.
> Both defaulted closed, which meant a fresh deployment had no usable exit
> anywhere and nothing said why.

The user then picks an exit per device, from the Directory (Network → Devices)
or from the agent's tray menu on the machine itself.

**What a change costs.** Switching between two exits is handled entirely at the
gateway — no reconnect, no new config, no QR code. But turning an exit *on or
off* changes what the device tunnels: everything (`0.0.0.0/0`) versus just the
mesh (`10.0.0.0/8` + `172.24.0.0/16`). Devices running theta-agent are sent the
new config automatically; a device set up by hand needs its config re-exported.

### Why each exit is a separate tunnel

WireGuard keeps `AllowedIPs` as one trie per interface, so a prefix belongs to
exactly one peer — and the last peer to claim `0.0.0.0/0` silently takes it
from the others. Two exits on one interface gives you *one* exit.

Nor can you route around it. WireGuard matches on the packet's **destination**
and ignores the kernel nexthop, so this does nothing useful:

```
ip route add default via <peer> dev wg0 table exit_nl   # the `via` is decorative
```

The packet reaches `wg0`, WireGuard looks up the destination, finds whichever
peer owns `0.0.0.0/0`, and sends it there.

So each exit gets its own interface with a single peer holding the default
route, and policy routing picks the interface per device.

That interface uses a **second keypair**, not the gateway's mesh key. A remote
gateway keeps one endpoint and one session per peer *key*, so if both
interfaces presented the same key the remote would see a single peer whose
endpoint flapped between them, with the two continuously invalidating each
other's session. Each gateway therefore publishes two public keys, and an exit
site builds a separate peer entry for anyone exiting through it — allowed only
the specific device addresses actually using the exit, since an exit is
permission to send internet traffic, not a route into someone's network.

## Where the gateway runs

On the host, as the `theta-gateway` systemd service — not in the compose stack
like everything else, because it is a router and the LAN-facing half of that
cannot work from inside a Docker network namespace.
[Where the gateway runs](deployment.html) covers the install and the reasoning.

## What the gateway needs

- **In-kernel WireGuard** if available; it falls back to `wireguard-go`.
- **`NET_ADMIN`** or equivalent, to create interfaces and set routes.
- **UDP 51820** reachable for any site other sites should be able to dial. A
  site with no inbound access still works — it dials out and is reached back
  through the hub.
- A **default route**, so it can NAT. Without one, exits and full-tunnel
  devices cannot work, and the gateway's status page says so.
- **`NETMAP`** in the kernel's iptables, for LAN mapping. The status page
  reports if it is missing.

The gateway sets `net.ipv4.ip_forward=1` and `rp_filter=0` itself.
`rp_filter` matters more than it looks: strict reverse-path filtering drops
packets whose source would not route back out the interface they arrived on,
which is the *normal* state once a device's traffic goes out an exit. Left at
`1`, exit routing silently blackholes while every other diagnostic looks fine.

## Recommended: routes on your LAN router

To let ordinary machines on your LAN — ones with no VPN client — reach the rest
of the cluster, add two static routes on your router:

| Destination | Next hop | Why |
|---|---|---|
| `10.0.0.0/8` | the gateway's LAN address | Sends all cluster traffic to the gateway |
| `10.<siteId>.0.0/16` | on-link / default interface | Keeps this site's own range local instead of hairpinning through the gateway |

This is strongly recommended. Without it, only devices with a VPN client can
use the network; with it, every machine on your LAN can reach every site.

## How quickly changes take effect

Each gateway re-reads the directory and re-applies about once a minute, so a
new site, a new device, or a changed exit becomes live on the **next pass** —
worst case around 60 seconds, not instantly. The *Re-apply now* button on the
gateway's status page forces it immediately.

This is also why a freshly-started site can briefly show fewer peers than the
roster lists: it has planned them and not yet applied them.

## Checking it

The gateway's **Site Network** page shows what the directory asked for, what is
actually on the wire, and where the two disagree — including the states that
otherwise look identical to working:

- no site id (the site never joined a directory)
- the directory is unreachable and the gateway is running on cached config
- the interface is down while peers are configured
- no default route, so nothing can be NATed
- a device pointed at an exit that cannot be built, and why

Tunnel health comes from the last handshake, not from whether a peer is
configured — a peer can be perfectly configured and completely dead.

## Key rotation

Not implemented. A gateway's keypair is generated once and kept; every peer in
the cluster holds the public half, so rotating one is a cluster-wide event.
Today, rebuilding a site's gateway means every other site picks up the new key
from the roster on its next pass, but tunnels to it are down until they do.
