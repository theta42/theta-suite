---
layout: default
title: Gateway Mesh
---

# Gateway Mesh

Theta Gateway can mesh with other Theta Gateway instances over real
site-to-site WireGuard tunnels — separate from its [SSH jump
host](connecting.html) role, and separate from the roaming-client/exit-node
WireGuard feature (individual peer configs for laptops/phones). This is
gateway-to-gateway: two sites' networks reaching each other directly.

## Why and when to use this

- **Direct site-to-site networking**, not just SSH. Once two gateways are
  meshed, hosts behind each can reach each other over the tunnel using the
  mesh addressing scheme below — not limited to jumping through SSH.
- **No manual WireGuard config.** Meshing is a join-token exchange; both
  sides come out with a live, working peer entry for each other
  automatically.
- **Works without a kernel WireGuard module.** Prefers in-kernel WireGuard,
  falls back to the userspace `wireguard-go` implementation automatically —
  useful for older kernels, some container/cloud images, or hosts where the
  kernel module isn't available.

## How it works

1. On the gateway you want others to join, mint a join token: **Mesh** page
   → **Mint a Join Token**. It's single-use and expires in 15 minutes.
2. On the new gateway, use **Join a Remote Gateway's Mesh**: paste the other
   gateway's URL and the token.
3. Both sides now have a live WireGuard peer for each other. The **Meshed
   Gateways** table shows every peer, its assigned mesh subnet, and when it
   was last seen.

Each gateway is assigned a **mesh index** (an integer 1–254) the first time
it either mints a token or is registered by another gateway. That index
determines its subnet: `172.24.<index>.0/24` for the mesh tunnel itself, plus
`10.<index>.0.0/16` reserved for that site's own local network — 254 sites is
the hard ceiling this addressing scheme supports.

## Requirements

- Both gateways need a reachable endpoint (host:port) for the WireGuard
  handshake — typically the same public host the SSH/web ports are already
  on, with UDP 51820 reachable.
- `NET_ADMIN` capability (or equivalent) on the container/host running the
  gateway, to create the WireGuard interface.

## What crosses the tunnel

Two gateways meshing gives you a route between the gateways themselves. Site
*services* (each site's Theta Directory) are reached through forwarders the
gateway runs on both ends of the hop:

- **Inbound**: the gateway answers on its own mesh address
  (`172.24.<index>.1:3001`) and forwards to this site's directory.
- **Outbound**: the gateway listens locally on `30000 + <peer index>` and
  forwards over the tunnel to that peer's directory.

So a component at site A reaches site B's directory at
`<site A's gateway>:30000+<B's index>`. The port is derived from the mesh
index, never configured — Theta Directory computes it the same way when it
routes replication or creates a no-inbound relay route. Forwarders are
reconciled whenever the mesh changes, so a newly-joined peer becomes
reachable without restarting the gateway, and a removed one stops being
reachable immediately.

This matters because WireGuard runs inside the gateway container: the mesh
subnet exists only in that container's network namespace, so the other
containers at a site (directory, proxy) cannot route to a peer's mesh IP
directly. They talk to their own local gateway instead, which is what these
forwarders are for.

## Connected to directory sync

[Theta Directory's multi-site join](../sso/multi-site.html) (catalog + LDAP
replication between a master and its spokes) prefers this mesh once it's up:
a spoke that's registered a mesh IP gets its live resync pushes routed over
the tunnel instead of the open internet, falling back to its public endpoint
if the mesh path fails. A spoke with no public IP at all can also register as
no-inbound (`CFG_SPOKE_NO_INBOUND` in `theta-suite`'s `setup.env`) so the
master auto-creates a relay route through its own `theta-proxy` — the master
terminates TLS for that spoke's hostname and relays over this mesh. The mesh
peering itself (this page) stays a manual step on both sides; directory join
and relay registration pick up from there. See the [architecture
spec](https://github.com/theta42/theta-suite/blob/master/docs/MULTI_SITE_SPEC.md)
for the full detail.
