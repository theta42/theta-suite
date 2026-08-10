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

## Not yet connected to directory sync

This mesh is a networking layer on its own. [Theta Directory's multi-site
join](../sso/multi-site.html) (catalog + LDAP replication between a master
and its spokes) does not currently route its traffic over this mesh — the
two features work independently today. Routing directory sync over the mesh,
and using the mesh to reach a spoke site with no inbound access of its own,
are both designed but not yet automated — see the [architecture
spec](https://github.com/theta42/theta-suite/blob/master/docs/MULTI_SITE_SPEC.md)
for current status.
