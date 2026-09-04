#!/usr/bin/env node
/* A 429 has to say WHICH wall, or the caller retries into it.
 * `node pipeline/llm-429.test.js`
 *
 * On 2026-09-02 a per-day exhaustion arrived as the same opaque LlmUnavailable
 * a per-minute one does. The worker's only move for either is "hold, retry next
 * run", so it re-read the same window 66 times against a pool that could not
 * answer until 14:00 VN — with a live 136,670đ transaction sitting unstaged
 * inside it the whole time. Nothing threw, nothing was recorded, and the app
 * simply looked like it had stopped noticing bank mail.
 *
 * What this pins:
 *
 * 1. The two scopes are told apart from the body Google actually sends.
 * 2. RetryInfo is honoured when present, defaulted when not.
 * 3. EVERY ambiguity resolves to 'minute'. This is the asymmetry that matters
 *    and the one most likely to be "tidied" later by someone who reads the
 *    fallback as sloppiness: a misread per-minute wall treated as per-day
 *    pauses the whole fleet's capture for hours, while a misread per-day wall
 *    treated as per-minute costs one wasted request before we learn. So an
 *    unrecognised quota id, a body with no details, and an unparseable body are
 *    all deliberately 'minute', and a test that ever "fixes" that has broken
 *    the thing it was protecting.
 * 4. A body naming BOTH dimensions is 'day' — we are past the larger wall, and
 *    honouring the smaller one would retry straight into it.
 */
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

(async () => {
const llm = await import(
  'file://' + path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'llm.mjs'));

const quota = (id) => ({
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: id }],
});
const retry = (s) => ({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: s });
const body = (...details) => JSON.stringify({
  error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details },
});

// ── 1. the two walls, as Google names them ────────────────────────────────
{
  const r = llm.rateLimitFrom(body(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier')));
  t('per-day quota id reads as day', r.scope === 'day', r.scope);
  t('a day wall carries no retryAfterMs (caller uses the Pacific reset)',
    r.retryAfterMs === null, String(r.retryAfterMs));
  t('it is still an LlmUnavailable, so existing hold paths keep working',
    r instanceof llm.LlmUnavailable && r instanceof llm.LlmRateLimited);
}
{
  const r = llm.rateLimitFrom(body(quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier')));
  t('per-minute quota id reads as minute', r.scope === 'minute', r.scope);
  t('and defaults its wait when the body gives none',
    r.retryAfterMs === llm.DEFAULT_RETRY_AFTER_MS, String(r.retryAfterMs));
}

// ── 2. RetryInfo is honoured ──────────────────────────────────────────────
{
  const r = llm.rateLimitFrom(body(quota('...PerMinute...'), retry('34s')));
  t('RetryInfo seconds become ms', r.retryAfterMs === 34000, String(r.retryAfterMs));
}
{
  const r = llm.rateLimitFrom(body(quota('...PerMinute...'), retry('7.5s')));
  t('fractional RetryInfo survives', r.retryAfterMs === 7500, String(r.retryAfterMs));
}

// ── 3. every ambiguity is 'minute' (see the header) ───────────────────────
for (const [name, raw] of [
  ['an unrecognised quota id', body(quota('SomeQuotaNobodyDocumented'))],
  ['a 429 with no details at all', body()],
  ['a 429 whose body is not JSON', '<html>429 Too Many Requests</html>'],
  ['a 429 with an empty body', ''],
  ['details of an unexpected shape', JSON.stringify({ error: { details: 'not-an-array' } })],
]) {
  const r = llm.rateLimitFrom(raw);
  t(name + ' falls back to minute, never day', r.scope === 'minute', r.scope);
}

// ── 4. both dimensions named → the larger wall wins ───────────────────────
{
  const r = llm.rateLimitFrom(body(quota('...PerMinute...'), quota('...PerDay...')));
  t('a body naming minute AND day reads as day', r.scope === 'day', r.scope);
}

// ── 5. extract() routes 429 here, and nothing else ────────────────────────
{
  const cfg = { apiKey: 'k', model: 'm' };
  const res = (status, text) => async () => ({ ok: status === 200, status, text: async () => text });

  let err = null;
  try { await llm.extract('s', 'sub', 'b', cfg, res(429, body(quota('...PerDay...')))); }
  catch (e) { err = e; }
  t('a 429 from extract() is an LlmRateLimited', err instanceof llm.LlmRateLimited, String(err));
  t('and carries the scope through', err && err.scope === 'day', err && err.scope);

  err = null;
  try { await llm.extract('s', 'sub', 'b', cfg, res(503, 'upstream boom')); }
  catch (e) { err = e; }
  t('a 503 stays a plain LlmUnavailable, NOT rate-limited',
    err instanceof llm.LlmUnavailable && !(err instanceof llm.LlmRateLimited), String(err));
}

// ── 6. the Pacific reset, which is where a day wall waits until ───────────
{
  // 2026-09-02T06:00:00Z = 23:00 Sep 1 Pacific (PDT, UTC-7) → 1h to reset.
  const at = Date.UTC(2026, 8, 2, 6, 0, 0);
  const ms = llm.nextPacificReset(at).getTime() - at;
  t('an hour before Pacific midnight, the reset is an hour away',
    Math.abs(ms - 3600000) < 60000, String(ms));

  // Same instant is 13:00 VN, and the reset is 14:00 VN — the number the
  // banner promises the user.
  const vnHour = new Date(llm.nextPacificReset(at).getTime() + 7 * 3600000).getUTCHours();
  t('which lands at 14:00 Vietnam time', vnHour === 14, String(vnHour));

  // In January the offset is PST (UTC-8), so a fixed -7 would be an hour out.
  const jan = Date.UTC(2027, 0, 15, 6, 0, 0);   // 22:00 Jan 14 Pacific
  const janMs = llm.nextPacificReset(jan).getTime() - jan;
  t('and it follows daylight saving rather than a hard-coded offset',
    Math.abs(janMs - 2 * 3600000) < 60000, String(janMs));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
