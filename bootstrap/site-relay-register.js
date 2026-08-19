#!/usr/bin/env node
/*
 * theta-suite site-relay-register — runs inside the sso-manager container
 * (same pattern as site-join.js) to finish no-inbound relay automation for a
 * spoke with no public IP (MULTI_SITE_SPEC.md §5.2).
 *
 * site-join.js's initial join can't supply a mesh IP: this site's jump-host
 * isn't meshed to the master's yet at that point (mesh peering is a manual,
 * out-of-band action on both jump-hosts -- mint a join token on the master's
 * jump-host, paste it into this site's jump-host "Join a mesh" UI action --
 * the same reason the site join key itself is minted/pasted by hand rather
 * than automated). This script is the follow-up: run it (setup.sh does, on
 * every run, when CFG_SPOKE_NO_INBOUND is set) once meshing is done, and it
 * discovers this jump-host's mesh IP and registers it so theta-proxy on the
 * master can auto-create the relay route (see sso-manager-node's
 * utils/proxy_client.js). Safe to run before meshing completes -- reports
 * "not meshed yet" and exits 0 so a re-run later just picks it up.
 *
 *   docker compose exec sso-manager node /bootstrap/site-relay-register.js \
 *       https://sso.this-site.example.com sso-branch2.master-domain.example.com
 *
 * It goes through this node's OWN POST /api/site/reregister rather than
 * POSTing the master's /api/site/spokes directly, which is what it used to do.
 * Talking to the master behind the app's back had three consequences, all of
 * which bit in practice:
 *
 *   * the push token the master hands back was read and thrown away, so a
 *     re-registration that MINTED a new one left this node unable to accept the
 *     master's resync pushes at all;
 *   * /config/site.json was never updated, and the running app caches it, so
 *     nothing here was visible to the process actually doing the replicating;
 *   * the endpoint string had to match the one the join used byte for byte, or
 *     the master's upsert-by-endpoint created a SECOND registry row for this
 *     one site -- with a second LDAP ServerID, which quietly breaks MMR.
 *
 * Self-contained (Node built-ins + global fetch), same rule as bootstrap.js
 * and site-join.js -- it does NOT require the SSO's internal models. It reads
 * this node's own spoke role from /config/site.json (written by site-join.js)
 * and logs into the LOCAL jump-host as its bootstrap-minted local admin
 * (/config/jump-secrets.js) to call jump-host's own GET /api/mesh/self.
 *
 * Output (stdout, KEY=VALUE for setup.sh): RELAY=<registered|not-meshed|not-a-spoke|skipped>.
 * Progress logs go to stderr.
 */
'use strict';

const fs = require('fs');

const SITE_CONFIG = '/config/site.json';
const JUMP_SECRETS = '/config/jump-secrets.js';
const SSO_SECRETS = '/config/sso-secrets.js';
const SSO_INTERNAL = 'http://localhost:3001';
// The gateway runs on the host now, not as a compose service, so `jump-host`
// does not resolve from inside the container. setup.sh wires JUMP_INTERNAL_URL
// to http://host.docker.internal:3002 (see docker-compose.yml's extra_hosts);
// fall back to a sensible host-gateway default if that env var is missing.
const JUMP_INTERNAL = process.env.JUMP_INTERNAL_URL || 'http://host.docker.internal:3002';

const selfUrl = process.argv[2];
const publicHost = process.argv[3];

function log(msg) { console.error('[site-relay-register] ' + msg); }

async function main() {
  if (!selfUrl || !publicHost) {
    throw new Error('usage: node /bootstrap/site-relay-register.js <selfUrl> <publicHost>');
  }

  if (!fs.existsSync(SITE_CONFIG)) {
    log('No /config/site.json yet — this node has not joined a master. Nothing to do.');
    console.log('RELAY=not-a-spoke');
    return;
  }
  const site = JSON.parse(fs.readFileSync(SITE_CONFIG, 'utf8'));
  if (site.isMaster || !site.masterUrl || !site.masterJoinKey) {
    log('Not a joined spoke (missing masterUrl/masterJoinKey, or this is a master). Nothing to do.');
    console.log('RELAY=not-a-spoke');
    return;
  }

  if (!fs.existsSync(JUMP_SECRETS)) {
    log('No /config/jump-secrets.js — jump-host has not been provisioned yet. Skipping.');
    console.log('RELAY=skipped');
    return;
  }
  const jumpSecrets = require(JUMP_SECRETS);
  // Use the directory API token the bootstrap minted for the gateway, rather
  // than the local admin password. The local admin account may be unset or
  // differ from jump-secrets.js, while /api/mesh/self only requires a valid
  // API token (jmp_ PAT or directory sso_ token).
  const jumpToken = (jumpSecrets.sso && jumpSecrets.sso.apiToken)
    || (jumpSecrets.auth && jumpSecrets.auth.apiToken)
    || '';
  if (!jumpToken) {
    log('jump-secrets.js has no API token (sso.apiToken or auth.apiToken). Skipping.');
    console.log('RELAY=skipped');
    return;
  }

  const selfRes = await fetch(`${JUMP_INTERNAL}/api/mesh/self`, {
    headers: { Authorization: 'Bearer ' + jumpToken }
  });
  if (!selfRes.ok) {
    throw new Error(`jump-host mesh self-lookup failed (${selfRes.status}): ${await selfRes.text().catch(() => '')}`);
  }
  const selfData = await selfRes.json();
  if (!selfData.meshIp) {
    log('jump-host is not meshed yet (no mesh IP assigned). Mesh-join it first (jump-host UI), then re-run setup.sh.');
    console.log('RELAY=not-meshed');
    return;
  }
  log(`Discovered mesh IP ${selfData.meshIp}. Re-registering with ${site.masterUrl} via the local directory...`);

  // Log in locally as the bootstrap admin, same as site-join.js.
  const sso = require(SSO_SECRETS);
  const adminUid = (sso.bootstrap && sso.bootstrap.adminUid) || 'admin';
  const adminPass = (sso.bootstrap && sso.bootstrap.adminPass) || '';
  const ssoLogin = await fetch(`${SSO_INTERNAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: adminUid, password: adminPass }),
  });
  if (!ssoLogin.ok) {
    throw new Error(`local admin login failed (${ssoLogin.status}): ${await ssoLogin.text().catch(() => '')}`);
  }
  const { token } = await ssoLogin.json();
  if (!token) throw new Error('local admin login returned no token');

  // Prefer the endpoint this node already registered under, so a scheme or
  // hostname difference between setup.sh invocations can never fork one site
  // into two registry rows. The argument is the fallback for a node that
  // joined before selfUrl was persisted.
  const endpoint = site.selfUrl || selfUrl;
  if (site.selfUrl && site.selfUrl !== selfUrl) {
    log(`Using the endpoint already on file (${site.selfUrl}) rather than ${selfUrl}, so the master keeps one row for this site.`);
  }

  const regRes = await fetch(`${SSO_INTERNAL}/api/site/reregister`, {
    method: 'POST',
    headers: { 'auth-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ selfUrl: endpoint, noInbound: true, meshIp: selfData.meshIp, publicHost }),
  });
  const text = await regRes.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!regRes.ok) {
    throw new Error(`relay registration failed (${regRes.status}): ${(data && data.message) || text}`);
  }

  log(`Relay: ${(data && data.relay && data.relay.note) || 'registered'}`);
  log(`Live replication: ${(data && data.live) ? 'yes' : 'no'}`);
  console.log('RELAY=registered');
}

main().catch((e) => {
  console.error('[site-relay-register] FAILED: ' + e.message);
  process.exit(1);
});
