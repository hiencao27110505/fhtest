// Vercel serverless function — the sync worker.
//
// POST /api/gmail-sync
//   Authorization: Bearer <CRON_SECRET>        → sweep all due connections
//   Authorization: Bearer <supabase token>     → sync only the caller's own
//
// Polling, not Pub/Sub push. `users.watch` + Pub/Sub is faster (~5s vs the poll
// interval) but adds a re-registration every 7 days that fails silently if
// missed, and the bank's own send delay dominates end-to-end latency anyway.
// Start simple; the History API resume point (last_history_id) is already on
// the table for when this is worth revisiting.
//
// Everything real lives in pipeline/lib/ingest.js. This file only supplies
// dependencies and handles auth, so the decision tree is testable without HTTP.

'use strict';

const gmailLib = require('../pipeline/lib/gmail.js');
const db = require('../pipeline/lib/supabase.js');
const ingest = require('../pipeline/lib/ingest.js');
const tokenCrypto = require('../pipeline/lib/token-crypto.js');
const sealedBox = require('../pipeline/lib/sealed-box.js');
const { makeGeminiAdapter } = require('../pipeline/lib/llm.js');

const SYNC_INTERVAL_MINUTES = 15;
const MAX_CONNECTIONS_PER_RUN = 20;

// Sealed staging. The pipeline writes rows it cannot read back: each is sealed
// to the family's staging public key, whose private half is DEK-wrapped and
// only exists on an unlocked family device.
//
// KEY PINNING, honestly: the Apps Script side keeps its trust-on-first-use pin
// in Script Properties — a different trust domain from Supabase, so a
// database-only attacker who swaps staging_pub cannot also move the pin.
// Serverless has no equivalent local store. `STAGING_PUB_PINS` in the Vercel
// env is the same idea and the same trust split ("<familyId>:<fingerprint>",
// comma-separated), and is practical while the beta is capped at 100 users.
// With it unset, TOFU is a no-op here and the device-side self-check
// (fhStagingVerifyServerKey, shipped v325) is the detector — which it is in
// either case, being the only one that catches an operator holding both stores.
function makeStaging(env) {
  const pins = {};
  for (const part of String(env.STAGING_PUB_PINS || '').split(',')) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf(':');
    if (i > 0) pins[s.slice(0, i)] = s.slice(i + 1);
  }
  return {
    async getFamilyKey(memberId) {
      const members = await db.get(env, 'members', { id: 'eq.' + memberId }, { select: 'family_id' });
      const familyId = members.length && members[0].family_id;
      if (!familyId) return null;
      const keys = await db.get(env, 'family_keys', { family_id: 'eq.' + familyId }, { select: 'staging_pub' });
      const stagingPub = keys.length && keys[0].staging_pub;
      if (!stagingPub) return null;         // family has not opened the app yet → hold
      return { familyId, stagingPub, pin: pins[familyId] || null };
    },
    assertPinned: (key) => sealedBox.assertFamilyPubPinned(key.stagingPub, key.pin),
    seal: (payload, pub, familyId, messageId) => sealedBox.sealForFamily(payload, pub, familyId, messageId),
  };
}

// Wraps the shared REST helpers so ingest.js can stay env-free.
function boundDb(env) {
  return {
    get: (table, filters, extra) => db.get(env, table, filters, extra),
    post: (table, row, onConflict) => db.post(env, table, row, onConflict),
    patch: (table, filters, updates) => db.patch(env, table, filters, updates),
  };
}

async function syncOne(env, connection, providerDomains) {
  const bound = boundDb(env);

  // Open the token. A failure here is NOT retryable and must not be swallowed:
  // it means the key rotated out from under us, or the row was tampered with.
  let refreshToken;
  try {
    refreshToken = tokenCrypto.openToken(
      connection.oauth_refresh_enc,
      { connectionId: connection.id, memberId: connection.member_id, purpose: 'gmail_refresh' },
      env,
    );
  } catch (e) {
    await bound.patch('mailbox_connections', { id: 'eq.' + connection.id }, {
      oauth_status: 'needs_reconnect',
      oauth_last_error: 'stored credential could not be opened',
    });
    return { id: connection.id, ok: false, reason: 'token_unreadable' };
  }

  let accessToken;
  try {
    ({ accessToken } = await gmailLib.refreshAccessToken(refreshToken, env));
  } catch (e) {
    // invalid_grant is the expected, normal end of a connection's life: the
    // user revoked in their Google account, or the app is still in Testing
    // publishing status and the 7-day clock ran out
    // (pipeline/OAUTH-COMPLIANCE-FINDINGS.md §2). Either way the answer is
    // "ask them to reconnect", never a retry loop and never an error screen.
    const revoked = e.code === 'invalid_grant';
    await bound.patch('mailbox_connections', { id: 'eq.' + connection.id }, {
      oauth_status: revoked ? 'needs_reconnect' : 'active',
      oauth_last_error: revoked ? 'access was revoked or expired — reconnect to resume' : 'temporary refresh failure',
    });
    return { id: connection.id, ok: false, reason: revoked ? 'needs_reconnect' : 'refresh_failed' };
  }

  const backfill = connection.backfill_status === 'pending';
  const deps = {
    db: bound,
    providerDomains,
    // Advisory until the recorded verdicts justify enforcement — same rollout
    // discipline the forwarding side used for SENDER_AUTH_ENFORCE. A check that
    // can reject real transactions earns its enforcement on observed data.
    enforceDkim: env.SENDER_AUTH_ENFORCE === 'true',
    // SEALED-STAGING-DESIGN.md §7 requires raw_body to go at promotion or
    // rejection. Until sealed staging is switched on, this env flag is the lever
    // that stops plaintext bodies being stored at all — at the cost of losing
    // the reprocessing/debugging trail.
    storeRawBody: env.STAGING_STORE_RAW_BODY !== 'false',
    // Sealing on by default. Set STAGING_SEAL=false only to reproduce the old
    // plaintext behaviour while debugging — it stores readable bank data.
    staging: env.STAGING_SEAL === 'false' ? null : makeStaging(env),
    llm: makeGeminiAdapter(env),
    gmail: {
      listMessages: (q, o) => gmailLib.listMessages(accessToken, q, o),
      getMessage: (id) => gmailLib.getMessage(accessToken, id),
    },
  };

  const result = await ingest.syncConnection(deps, connection, { backfill });

  await bound.patch('mailbox_connections', { id: 'eq.' + connection.id }, Object.assign({
    last_sync_at: new Date().toISOString(),
    oauth_status: 'active',
    oauth_last_error: null,
  }, backfill ? { backfill_status: 'done' } : {}));

  return Object.assign({ id: connection.id, ok: true, backfill }, result);
}

module.exports = async (req, res) => {
  // Vercel Cron invokes with GET (and supplies Authorization: Bearer
  // $CRON_SECRET itself). User-triggered "sync now" from the app is a POST.
  // Both land here; the auth check below is what separates them.
  if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).json({ error: 'POST or GET' }); return; }
  const env = process.env;

  try {
    const authz = String(req.headers['authorization'] || req.headers['Authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!authz) { res.status(401).json({ error: 'auth required' }); return; }

    const isCron = !!env.CRON_SECRET && authz === env.CRON_SECRET;
    // A GET is only ever the scheduler. Accepting a user token on GET would
    // make this triggerable by a link or an <img> tag from another origin.
    if (req.method === 'GET' && !isCron) { res.status(401).json({ error: 'cron auth required' }); return; }
    let uid = null;
    if (!isCron) {
      uid = await db.verifyUser(env, authz);
      if (!uid) { res.status(401).json({ error: 'sign-in required' }); return; }
    }

    // Sender allow-list. Shared by both pipelines, seeded by migration 0050.
    const providerDomains = await db.get(env, 'known_provider_domains', { active: 'eq.true' }, { select: 'domain_or_address,provider_name' });

    // Which connections to sync. A user-triggered call only ever touches their
    // own rows; the member join is what enforces that.
    let connections;
    if (isCron) {
      const due = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60000).toISOString();
      connections = await db.get(env, 'mailbox_connections', {
        connection_source: 'eq.oauth',
        oauth_status: 'eq.active',
      }, { select: '*', order: 'last_sync_at.asc.nullsfirst', limit: String(MAX_CONNECTIONS_PER_RUN) });
      connections = connections.filter((c) => !c.last_sync_at || c.last_sync_at <= due || c.backfill_status === 'pending');
    } else {
      const members = await db.get(env, 'members', { user_id: 'eq.' + uid }, { select: 'id' });
      const ids = members.map((m) => m.id);
      if (!ids.length) { res.status(200).json({ ok: true, synced: [] }); return; }
      connections = await db.get(env, 'mailbox_connections', {
        connection_source: 'eq.oauth',
        oauth_status: 'eq.active',
        member_id: 'in.(' + ids.join(',') + ')',
      }, { select: '*' });
    }

    const synced = [];
    for (const c of connections) {
      if (!c.oauth_refresh_enc) { synced.push({ id: c.id, ok: false, reason: 'no_credential' }); continue; }
      try {
        synced.push(await syncOne(env, c, providerDomains));
      } catch (e) {
        // One bad mailbox must not stop the sweep.
        synced.push({ id: c.id, ok: false, reason: String(e && e.message || e).slice(0, 200) });
      }
    }

    res.status(200).json({ ok: true, providers: providerDomains.length, synced });
  } catch (e) {
    res.status(500).json({ error: 'sync_failed', detail: String(e && e.message || e).slice(0, 300) });
  }
};
