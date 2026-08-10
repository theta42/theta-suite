#!/usr/bin/env node
/*
 * theta-suite site-join — runs inside the sso-manager container to adopt a
 * master site's directory as a read-only spoke. Invoked by setup.sh when
 * setup.env sets CFG_MASTER_DIRECTORY_URL + CFG_MASTER_DIRECTORY_JOIN_KEY:
 *
 *   docker compose exec sso-manager node /bootstrap/site-join.js \
 *       https://sso.master.example.com stj_9f2e...
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

const sso = require('/config/sso-secrets.js');

const ADMIN_UID       = (sso.bootstrap && sso.bootstrap.adminUid) || 'admin';
const ADMIN_USER_PASS = (sso.bootstrap && sso.bootstrap.adminPass) || '';
const SSO_INTERNAL    = 'http://localhost:3001';

const masterUrl = process.argv[2];
const joinKey   = process.argv[3];

function log(msg) { console.error('[site-join] ' + msg); }

async function main() {
  if (!masterUrl || !joinKey) {
    throw new Error('usage: node /bootstrap/site-join.js <masterUrl> <joinKey>');
  }

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
  const res = await fetch(`${SSO_INTERNAL}/api/site/join`, {
    method: 'POST',
    headers: { 'auth-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ masterUrl, joinKey }),
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
    throw new Error(`join failed (${res.status}): ${(data && data.message) || text}`);
  }

  log(`Joined master site ${masterUrl} as ${data.siteSlug || '?'}`);
  console.log([
    `JOINED=yes`,
    `SITE_SLUG=${data.siteSlug || ''}`,
    `RESOURCES=${(data.resources && data.resources.created) || 0}`,
    `LDAP=${(data.ldap && data.ldap.note) || ''}`
  ].join(' '));
}

main().catch((e) => {
  console.error('[site-join] FAILED: ' + e.message);
  process.exit(1);
});
