# theta-agent: Local-Discovery Spec (mDNS "prefer local directory")

**Audience**: implementer on Windows/Mac (this was authored on Linux; Windows/Mac-specific network and hosts-file behavior needs to be built and tested there, not assumed here).
**Repo**: `theta-agent` (Go). Signing/config mechanism referenced below: `websocket.go`, `config.go`.
**Parent doc**: [`MULTI_SITE_SPEC.md`](./MULTI_SITE_SPEC.md) §5.3 — read that section for the "why," this doc is the "what," precisely enough to implement without re-deriving the reasoning.

## Problem

A no-inbound spoke site's public hostname (e.g. `sso-staten-island.theta42.com`) resolves, from the internet, to the master's IP, which relays over WireGuard to the spoke. A device physically on that spoke's LAN resolving the same hostname takes the same path — out to the master, back over the tunnel — even though the real service is a few feet away. This is wasted latency, not a correctness bug, but it's the kind of thing users notice.

## What to Build

### 1. Announcer (gateway/proxy side — may already be scoped elsewhere, confirm before duplicating)
The spoke's `theta-gateway` or `theta-proxy` periodically advertises itself via mDNS on the local segment:
- Service type: `_theta-suite._tcp.local`
- TXT records: `site=<slug>`, `hosts=<comma-separated list of public hostnames this site fronts>`
- Advertised address: the service's own local LAN IP

### 2. Listener + Override (this doc's actual scope — theta-agent)
- New config field in `agent.yml`, e.g. `prefer_local_discovered_directory: bool` (default `false` — opt-in, not automatic, since it changes name resolution behavior on the host).
- When `true`, the agent runs an mDNS browser for `_theta-suite._tcp.local` in the background.
- On receiving an announcement whose `hosts` TXT list includes a hostname the agent cares about (at minimum: the hostname the agent itself is currently configured to connect to for its WS connection), the agent installs a **local override** redirecting that hostname to the discovered local IP.
- No announcement seen (agent off-site, or flag disabled) → no override installed, normal DNS resolution applies. Nothing else about the agent's behavior changes in this case.
- If a previously-discovered site's announcement stops being seen (TTL expiry / agent moved networks), the override must be **removed**, not left stale. Don't let a laptop that left the office keep resolving the old office hostname to a now-unreachable LAN IP.

### 3. Override Mechanism — Platform-Specific, Needs Real Investigation

This is the part that most needs Windows/Mac-native work; do not assume the Linux/Unix approach ports directly:

- **Windows**: hosts file lives at `%SystemRoot%\System32\drivers\etc\hosts`; writing to it requires elevation, and Windows caches DNS results independently (`ipconfig /flushdns` needed after an edit, or the change won't take effect immediately — verify whether theta-agent already runs elevated on Windows, since if it doesn't, this whole approach may need a different mechanism, e.g. a local proxy/resolver instead of hosts-file edits).
- **macOS**: hosts file at `/etc/hosts`, also requires root; macOS's mDNSResponder/DNS caching behavior differs from Windows and Linux (`dscacheutil -flushcache; killall -HUP mDNSResponder` territory) — confirm whether an installed hosts entry is actually honored promptly, or whether the built-in mDNSResponder needs to be told directly instead of fighting it with a hosts-file edit (macOS already *has* native mDNS support baked into resolution — it may be simpler/more idiomatic there to register via the OS's own Bonjour APIs rather than hand-roll hosts-file mutation).
- **Linux**: `/etc/hosts`, requires root, comparatively straightforward, `systemd-resolved` caching considerations may apply depending on distro.

Given the platform divergence, seriously consider whether a **local stub resolver** (theta-agent listens on `127.0.0.1:<port>`, answers matching hostnames from its own discovery cache, forwards everything else upstream — with the OS's DNS pointed at it only for the duration this feature is active) is actually simpler and more uniform across all three platforms than hosts-file mutation, despite the extra moving part. Recommend evaluating both before committing to an implementation; this doc intentionally doesn't prescribe one, since that call needs platform testing this environment can't do.

## Hard Security Rule (non-negotiable, applies regardless of mechanism chosen)

mDNS is **unauthenticated** on a local network — anyone on the same LAN segment can broadcast a spoofed announcement. This feature may only ever change **where** the agent connects (which IP a hostname resolves to). It must **never** change **whether** the agent trusts what answers there. Concretely:
- TLS certificate validation and hostname verification against the redirected IP must remain fully enforced — no exceptions, no "local network so it's fine" carve-out.
- A spoofed rogue announcement pointing a hostname at an attacker's local IP should produce a TLS handshake failure (cert won't match), not a silent connection. If your chosen mechanism has *any* code path where local-discovery bypasses or weakens cert checking, that's a bug, not an optimization — fix it before shipping.

## Out of Scope for This Piece

- The announcer side's exact library/implementation on the gateway/proxy (Linux — can be built where this spec was authored, not blocked on Windows/Mac).
- Anything about the master-relay mechanism itself (§5.2 of the parent spec) — this doc is purely the "skip the relay when local" optimization layered on top of it.

## Definition of Done

- Flag exists, defaults off.
- Enabling it on a machine physically on a spoke's LAN measurably routes traffic to the local spoke instead of through the master relay (verify via a network capture or the proxy's own access logs on each side, not just "it feels faster").
- Leaving that LAN (or disabling the flag) reliably reverts to normal resolution — no stale overrides.
- A test with a spoofed/rogue mDNS announcement (a second, non-legitimate advertiser) results in a TLS failure, not a successful connection to the impostor.
- Behavior verified on both Windows and macOS, not just Linux.
