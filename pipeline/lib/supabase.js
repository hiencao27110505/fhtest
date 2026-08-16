// Minimal PostgREST helpers for the api/ handlers.
//
// Mirrors the shape of supabaseGet/Post/Patch in bank-email-pipeline.gs so the
// two pipelines read the same way, minus the Apps Script transport.
//
// SERVICE ROLE. Everything here bypasses RLS. It is only ever used from
// serverless handlers that have already authenticated the caller, or from the
// cron-authenticated sync worker. Never import this into anything that ships to
// a browser.

'use strict';

function cfg(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  return { url: String(url).replace(/\/+$/, ''), key };
}

function headers(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  }, extra || {});
}

async function handle(res) {
  const text = await res.text();
  if (!res.ok) throw new Error('SUPABASE_HTTP_' + res.status + ': ' + text.slice(0, 300));
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { throw new Error('SUPABASE_BAD_JSON: ' + text.slice(0, 300)); }
}

// filters: { col: 'eq.value' } — PostgREST operator syntax, same as the .gs.
async function get(env, table, filters, extra) {
  const { url, key } = cfg(env);
  const params = [];
  for (const k in filters || {}) params.push(k + '=' + encodeURIComponent(filters[k]));
  for (const k in extra || {}) params.push(k + '=' + encodeURIComponent(extra[k]));
  const r = await fetch(`${url}/rest/v1/${table}?${params.join('&')}`, { headers: headers(key) });
  const out = await handle(r);
  return Array.isArray(out) ? out : [];
}

async function post(env, table, row, onConflict) {
  const { url, key } = cfg(env);
  const r = await fetch(`${url}/rest/v1/${table}` + (onConflict ? '?on_conflict=' + onConflict : ''), {
    method: 'POST',
    headers: headers(key, {
      Prefer: onConflict ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
    }),
    body: JSON.stringify(row),
  });
  const out = await handle(r);
  return Array.isArray(out) ? out[0] : out;
}

async function patch(env, table, filters, updates) {
  const { url, key } = cfg(env);
  const params = [];
  for (const k in filters || {}) params.push(k + '=' + encodeURIComponent(filters[k]));
  const r = await fetch(`${url}/rest/v1/${table}?${params.join('&')}`, {
    method: 'PATCH',
    headers: headers(key, { Prefer: 'return=representation' }),
    body: JSON.stringify(updates),
  });
  const out = await handle(r);
  return Array.isArray(out) ? out[0] : out;
}

// Verifies a Supabase access token → user id, or null. Same approach as
// api/csv-column-mapping.js, which is the established pattern for gating a
// serverless handler on a real signed-in user.
async function verifyUser(env, token) {
  if (!token) return null;
  const url = env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY not configured');
  try {
    const r = await fetch(`${String(url).replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch (e) { return null; }
}

module.exports = { get, post, patch, verifyUser };
