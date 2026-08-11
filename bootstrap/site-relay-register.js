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
 * discovers this jump-host's mesh IP and registers it with the master so
 * theta-proxy there can auto-create the relay route (see sso-manager-node's
 * utils/proxy_client.js). Safe to run before meshing completes -- reports
 * "not meshed yet" and exits 0 so a re-run later just picks it up.
 *
 *   docker compose exec sso-manager node /bootstrap/site-relay-register.js \
 *       https://sso.this-site.example.com sso-branch2.master-domain.example.com
 *
 * Self-contained (Node built-ins + global fetch), same rule as bootstrap.js
 * and site-join.js -- it does NOT require the SSO's internal models. It
 * reads this node's own spoke role from /config/site.json (written by
 * site-join.js) and logs into the LOCAL jump-host as its bootstrap-minted
 * local admin (/config/jump-secrets.js) to call jump-host's own
 * GET /api/mesh/self.
 *
 * Output (stdout, KEY=VALUE for setup.sh): RELAY=<registered|not-meshed|not-a-spoke|skipped>.
 * Progress logs go to stderr.
 */
'use strict';

const fs = require('fs');

const SITE_CONFIG = '/config/site.json';
const JUMP_SECRETS = '/config/jump-secrets.js';
const JUMP_INTERNAL = 'http://jump-host:3002';

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
  const jumpAdminUser = (jumpSecrets.auth && jumpSecrets.auth.adminUsers && jumpSecrets.auth.adminUsers[0]) || 'jumpadmin';
  const jumpAdminPass = (jumpSecrets.auth && jumpSecrets.auth.localAdminPass) || '';
  if (!jumpAdminPass) {
    log('jump-secrets.js has no local admin password. Skipping.');
    console.log('RELAY=skipped');
    return;
  }

  const loginRes = await fetch(`${JUMP_INTERNAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: jumpAdminUser, password: jumpAdminPass }),
  });
  if (!loginRes.ok) {
    throw new Error(`jump-host admin login failed (${loginRes.status}): ${await loginRes.text().catch(() => '')}`);
  }
  const { token: jumpToken } = await loginRes.json();
  if (!jumpToken) throw new Error('jump-host login returned no token');

  const selfRes = await fetch(`${JUMP_INTERNAL}/api/mesh/self`, { headers: { 'auth-token': jumpToken } });
  if (!selfRes.ok) {
    throw new Error(`jump-host mesh self-lookup failed (${selfRes.status}): ${await selfRes.text().catch(() => '')}`);
  }
  const selfData = await selfRes.json();
  if (!selfData.meshIp) {
    log('jump-host is not meshed yet (no mesh IP assigned). Mesh-join it first (jump-host UI), then re-run setup.sh.');
    console.log('RELAY=not-meshed');
    return;
  }
  log(`Discovered mesh IP ${selfData.meshIp}. Registering with ${site.masterUrl}...`);

  const regRes = await fetch(`${site.masterUrl.replace(/\/+$/, '')}/api/site/spokes`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + site.masterJoinKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: selfUrl,
      siteSlug: site.siteSlug || '',
      noInbound: true,
      meshIp: selfData.meshIp,
      publicHost,
    }),
  });
  const text = await regRes.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!regRes.ok) {
    throw new Error(`relay registration failed (${regRes.status}): ${(data && data.message) || text}`);
  }

  log(`Relay: ${(data.relay && data.relay.note) || 'registered'}`);
  console.log('RELAY=registered');
}

main().catch((e) => {
  console.error('[site-relay-register] FAILED: ' + e.message);
  process.exit(1);
});
