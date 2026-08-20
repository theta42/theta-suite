#!/usr/bin/env node
/*
 * theta-suite site-ldap-register — runs inside the sso-manager container on
 * every setup.sh run (both master and spoke) to keep OpenLDAP N-way
 * multi-master replication config (docs/replication.md) in sync without an
 * operator hand-maintaining LDAP_SERVER_ID/LDAP_REPLICATION_HOSTS.
 *
 * The master assigns each spoke a unique LDAP_SERVER_ID at join time (same
 * mechanism as jump-host's WireGuard mesh index) and derives every site's
 * LDAP URL from its mesh address (ldap://10.<siteId>.0.2:389) -- replication
 * rides the WireGuard tunnel, never the public internet. See sso-manager-node's
 * GET /api/site/ldap-peers (spoke-facing) and
 * GET /directory-admin/ldap-replication-config (master-local).
 *
 * This script fetches whichever of those two applies to this node's role,
 * and writes the result to /config/ldap-replication.env (KEY=VALUE, the
 * same shape setup.env/spoke.env use) if it changed since last run. setup.sh
 * sources that file before starting sso-manager on every invocation, and
 * restarts the container when this script reports a change -- OpenLDAP's
 * static slapd.conf is only read at process start, so a config change needs
 * a restart to take effect; there's no live push, which is why this has to
 * be re-run periodically (every setup.sh invocation) rather than working
 * once at join time and never again, especially on the MASTER, whose peer
 * list changes every time a new spoke joins.
 *
 *   docker compose exec sso-manager node /bootstrap/site-ldap-register.js <selfUrl>
 *
 * Self-contained (Node built-ins + global fetch), same rule as
 * bootstrap.js/site-join.js -- does NOT require the SSO's internal models.
 *
 * Output (stdout, KEY=VALUE for setup.sh): LDAP_CONFIG_CHANGED=<yes|no>,
 * LDAP_SERVER_ID=<n>, LDAP_REPLICATION_HOSTS=<space-separated, may be empty>.
 * Progress logs go to stderr.
 */
'use strict';

const fs = require('fs');

const SITE_CONFIG = '/config/site.json';
const LDAP_CONFIG_FILE = '/config/ldap-replication.env';
const SSO_INTERNAL = 'http://localhost:3001';

const selfUrl = process.argv[2];

function log(msg) { console.error('[site-ldap-register] ' + msg); }

function readPersisted() {
  if (!fs.existsSync(LDAP_CONFIG_FILE)) return { LDAP_SERVER_ID: '', LDAP_REPLICATION_HOSTS: '' };
  const out = { LDAP_SERVER_ID: '', LDAP_REPLICATION_HOSTS: '' };
  for (const line of fs.readFileSync(LDAP_CONFIG_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[1] in out) out[m[1]] = m[2];
  }
  return out;
}

async function fetchMasterConfig() {
  const sso = require('/config/sso-secrets.js');
  const adminUid = (sso.bootstrap && sso.bootstrap.adminUid) || 'admin';
  const adminPass = (sso.bootstrap && sso.bootstrap.adminPass) || '';

  const loginRes = await fetch(`${SSO_INTERNAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: adminUid, password: adminPass }),
  });
  if (!loginRes.ok) throw new Error(`local admin login failed (${loginRes.status}): ${await loginRes.text().catch(() => '')}`);
  const { token } = await loginRes.json();
  if (!token) throw new Error('local admin login returned no token');

  const cfgRes = await fetch(`${SSO_INTERNAL}/api/directory-admin/ldap-replication-config`, {
    headers: { 'auth-token': token },
  });
  if (!cfgRes.ok) throw new Error(`ldap-replication-config failed (${cfgRes.status}): ${await cfgRes.text().catch(() => '')}`);
  return cfgRes.json();
}

async function fetchSpokeConfig(site, selfUrl) {
  const url = `${site.masterUrl.replace(/\/+$/, '')}/api/site/ldap-peers?endpoint=${encodeURIComponent(selfUrl)}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + site.masterJoinKey } });
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 404) {
      log('This site is not registered as a spoke on the master yet (join with selfUrl, or re-run site-relay-register.js). Skipping.');
      return null;
    }
    throw new Error(`ldap-peers failed (${res.status}): ${(data && data.message) || text}`);
  }
  return data;
}

async function main() {
  if (!fs.existsSync(SITE_CONFIG)) {
    log('No /config/site.json yet. Skipping.');
    console.log('LDAP_CONFIG_CHANGED=no');
    return;
  }
  const site = JSON.parse(fs.readFileSync(SITE_CONFIG, 'utf8'));

  let result;
  if (site.isMaster) {
    result = await fetchMasterConfig();
  } else {
    if (!site.masterUrl || !site.masterJoinKey) {
      log('Spoke role but missing masterUrl/masterJoinKey. Skipping.');
      console.log('LDAP_CONFIG_CHANGED=no');
      return;
    }
    if (!selfUrl) throw new Error('usage: node /bootstrap/site-ldap-register.js <selfUrl> (required for a spoke)');
    result = await fetchSpokeConfig(site, selfUrl);
    if (!result) {
      console.log('LDAP_CONFIG_CHANGED=no');
      return;
    }
  }

  const serverId = String(result.ldapServerId || '');
  const hosts = (result.peers || []).map((p) => p.ldapHost).filter(Boolean).join(' ');

  const before = readPersisted();
  const changed = before.LDAP_SERVER_ID !== serverId || before.LDAP_REPLICATION_HOSTS !== hosts;

  if (changed) {
    fs.writeFileSync(LDAP_CONFIG_FILE, `LDAP_SERVER_ID=${serverId}\nLDAP_REPLICATION_HOSTS=${hosts}\n`);
    log(`Replication config changed -- ServerID ${serverId}, ${(result.peers || []).length} peer(s). Wrote ${LDAP_CONFIG_FILE}.`);
  } else {
    log(`Replication config unchanged -- ServerID ${serverId}, ${(result.peers || []).length} peer(s).`);
  }

  console.log(`LDAP_CONFIG_CHANGED=${changed ? 'yes' : 'no'}`);
  console.log(`LDAP_SERVER_ID=${serverId}`);
  console.log(`LDAP_REPLICATION_HOSTS=${hosts}`);
}

main().catch((e) => {
  console.error('[site-ldap-register] FAILED: ' + e.message);
  process.exit(1);
});
