#!/usr/bin/env node
/*
 * theta-suite site-join — runs inside the sso-manager container to adopt a
 * master site's directory as a read-only spoke. Invoked by setup.sh when
 * setup.env sets CFG_MASTER_DIRECTORY_URL + CFG_MASTER_DIRECTORY_JOIN_KEY:
 *
 *   docker compose exec sso-manager node /bootstrap/site-join.js \
 *       https://sso.master.example.com stj_9f2e... https://sso.this-site.example.com
 *
 * The third argument (selfUrl, optional) is this site's own public SSO host
 * (setup.sh passes https://$CFG_SSO_HOST) -- without it the join still
 * succeeds, it just registers for one-time adoption only: the master has no
 * way to reach this spoke to push live replication resync pings at it (see
 * theta-directory's docs/site-join.md and utils/site_replicate.js).
 *
 * Self-contained (Node built-ins + global fetch), same rule as bootstrap.js —
 * it does NOT require the SSO's internal models. It logs in as the bootstrap
 * admin (reading /config/sso-secrets.js) and calls the SSO's own
 * /api/site/join, which imports the master's resource catalog + LDAP tree and
 * persists the spoke role in /config/site.json.
 *
 * Output (stdout, KEY=VALUE for setup.sh): JOINED, SITE_SLUG, RESOURCES, LDAP.
 * Progress logs go to stderr.
 */
'use strict';

const fs  = require('fs');
const sso = require('/config/sso-secrets.js');

const ADMIN_UID       = (sso.bootstrap && sso.bootstrap.adminUid) || 'admin';
const ADMIN_USER_PASS = (sso.bootstrap && sso.bootstrap.adminPass) || '';
const SSO_INTERNAL    = 'http://localhost:3001';

const masterUrl  = process.argv[2];
const joinKey    = process.argv[3];
const selfUrl    = process.argv[4] || '';
const siteSlug   = process.argv[5] || '';
const noInbound  = process.argv[6] === 'true';
const publicHost = process.argv[7] || '';

function log(msg) { console.error('[site-join] ' + msg); }

async function main() {
  if (!masterUrl || !joinKey) {
    throw new Error('usage: node /bootstrap/site-join.js <masterUrl> <joinKey> [selfUrl] [siteSlug] [noInbound] [publicHost]');
  }

  // 0. If /config/site.json already exists and records this node as a spoke, no-op.
  try {
    if (fs.existsSync('/config/site.json')) {
      const existing = JSON.parse(fs.readFileSync('/config/site.json', 'utf8'));
      if (existing && existing.isMaster === false) {
        log('Already a spoke (/config/site.json exists) — nothing to do.');
        console.log(`JOINED=already SITE_SLUG=${existing.siteSlug || siteSlug || ''}`);
        return;
      }
    }
  } catch (_) {}

  // 1. Login as the bootstrap admin (validates the password end-to-end).
  const loginRes = await fetch(`${SSO_INTERNAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: ADMIN_UID, password: ADMIN_USER_PASS }),
  });
  if (!loginRes.ok) {
    throw new Error(`admin login failed (${loginRes.status}): ${await loginRes.text().catch(() => '')}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  if (!token) throw new Error('admin login returned no token');
  log(`Logged in as ${ADMIN_UID}`);

  // 2. Join the master.
  const payload = {
    masterUrl,
    joinKey,
    ...(selfUrl ? { selfUrl } : {}),
    ...(siteSlug ? { siteSlug } : {}),
    ...(noInbound ? { noInbound: true, publicHost } : {})
  };

  const res = await fetch(`${SSO_INTERNAL}/api/site/join`, {
    method: 'POST',
    headers: { 'auth-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    // A node that already joined is a no-op, not a failure (idempotent setup).
    if (res.status === 400 && data && /already a spoke/i.test(data.message || '')) {
      log('Already a spoke — nothing to do.');
      console.log('JOINED=already');
      return;
    }
    // A directory that already contains users/agents (e.g. from previous join or sync).
    if (res.status === 409 && data && /already has users/i.test(data.message || '')) {
      log('Directory already has users/agents — keeping existing spoke configuration.');
      try {
        const file = '/config/site.json';
        if (!fs.existsSync(file)) {
          fs.writeFileSync(file, JSON.stringify({
            isMaster: false,
            masterUrl,
            siteSlug: siteSlug || 'site-spoke',
            masterJoinKey: joinKey,
            ...(selfUrl ? { selfUrl } : {})
          }, null, 2) + '\n');
        }
      } catch (_) {}
      console.log('JOINED=already');
      return;
    }
    throw new Error(`join failed (${res.status}): ${(data && data.message) || text}`);
  }

  log(`Joined master site ${masterUrl} as ${data.siteSlug || '?'}`);
  log(`Live replication: ${(data.replication && data.replication.note) || 'unknown'}`);
  console.log([
    `JOINED=yes`,
    `SITE_SLUG=${data.siteSlug || ''}`,
    `RESOURCES=${(data.resources && data.resources.created) || 0}`,
    `LDAP=${(data.ldap && data.ldap.note) || ''}`,
    `LIVE_REPLICATION=${(data.replication && data.replication.live) ? 'yes' : 'no'}`
  ].join(' '));
}

main().catch((e) => {
  console.error('[site-join] FAILED: ' + e.message);
  process.exit(1);
});
