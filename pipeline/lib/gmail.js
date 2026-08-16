// Gmail read client for the direct-read (OAuth) path.
//
// ── The query restriction is the product promise, in code ───────────────────
//
// `gmail.readonly` grants the ENTIRE mailbox. There is no Google scope meaning
// "only these senders", so the restriction to bank mail is ours to impose and
// ours to prove. OAUTH-DIRECT-READ.md §3.3 asks for it to be enforced somewhere
// auditable and stated plainly; this file is that place.
//
// Everything that reaches Gmail goes through buildProviderQuery(), which can
// only produce a query pinned to specific sender domains, and
// assertRestrictedQuery(), which every fetch calls before spending the token.
// A code path that reads mail without a from: clause throws rather than runs.
// If you are reviewing this file, that pair is the thing to check.
//
// A pleasant second-order effect, worth keeping: because we only ever ask for
// mail from domains in `known_provider_domains`, phishing sent from a lookalike
// domain is never fetched at all. Under forwarding it arrived and had to be
// filtered; here it is outside the query. DKIM still runs (below) because a
// domain in our list can still have its mail spoofed to a mailbox we read.

'use strict';

// The only scope this path requests. Restricted tier — see
// pipeline/OAUTH-COMPLIANCE-FINDINGS.md before changing it. gmail.metadata
// cannot replace it (restricted AND body-less), and gmail.modify would be a
// strictly larger ask for no gain: we never write to the mailbox.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// How far back a routine sync looks. Generous versus the 1-minute poll so a
// few hours of downtime cannot silently drop mail.
const SYNC_LOOKBACK_DAYS = 3;
// First-connect backfill. The reason direct read exists at all (§2 of the
// brief): a forwarding filter only ever sees new mail, this sees history.
const BACKFILL_DAYS = 180;

// ---------------------------------------------------------------------------
// Query construction — the enforcement point
// ---------------------------------------------------------------------------

// domains: rows from known_provider_domains ({domain_or_address}) or plain
// strings. Returns a Gmail search query pinned to those senders.
//
// Parenthesised deliberately: inside Gmail parens a space means AND, so
// `(from:a OR from:b newer_than:7d)` would bind the date to from:b alone. That
// exact bug cost real debugging time on the forwarding side (pipeline/README.md).
function buildProviderQuery(domains, opts) {
  const o = opts || {};
  const days = o.days || SYNC_LOOKBACK_DAYS;
  const list = (domains || [])
    .map((d) => (typeof d === 'string' ? d : d && d.domain_or_address))
    .map((d) => String(d || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((d, i, a) => a.indexOf(d) === i);

  // No providers means no query — NOT an unrestricted read. Callers must treat
  // null as "nothing to do", never as "fetch everything".
  if (!list.length) return null;

  const froms = list.map((d) => 'from:' + d);
  let q = '((' + froms.join(' OR ') + ') newer_than:' + days + 'd)';
  if (o.after) q += ' after:' + o.after;      // yyyy/mm/dd, for resuming a backfill
  return q;
}

// Refuses to let a query reach Gmail unless it is sender-restricted. This is a
// guard against a future edit quietly widening the read, not against today's
// code — today's code is fine, and that is exactly when to install the guard.
function assertRestrictedQuery(q) {
  const s = String(q || '');
  if (!s || !/\bfrom:/.test(s)) {
    throw new Error('refusing to read the mailbox without a sender restriction — see pipeline/lib/gmail.js header');
  }
  return s;
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

function headerMap(payload) {
  const out = {};
  const hs = (payload && payload.headers) || [];
  for (const h of hs) if (h && h.name) out[String(h.name).toLowerCase()] = h.value;
  return out;
}

function extractEmailAddress(fromHeader) {
  const m = String(fromHeader || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(fromHeader || '')).trim();
}

function b64urlDecode(data) {
  if (!data) return '';
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Crude but sufficient HTML → text. Bank mail is table-heavy; the extraction
// templates anchor on label text and line structure, so block-level tags must
// become newlines rather than disappear, or every anchor derived from an HTML
// body breaks.
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|h[1-6]|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ': ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

// Walks the MIME tree and returns the best text for extraction. text/plain wins
// when present; otherwise the HTML part is flattened. Nested multiparts
// (multipart/alternative inside multipart/mixed) are common in bank mail.
function decodeBody(payload) {
  const plains = [], htmls = [];
  const walk = (part) => {
    if (!part) return;
    const mime = String(part.mimeType || '').toLowerCase();
    const data = part.body && part.body.data;
    if (data) {
      if (mime === 'text/plain') plains.push(b64urlDecode(data));
      else if (mime === 'text/html') htmls.push(b64urlDecode(data));
      else if (!mime.startsWith('multipart/') && !plains.length && !htmls.length) plains.push(b64urlDecode(data));
    }
    for (const p of part.parts || []) walk(p);
  };
  walk(payload);
  if (plains.length) return plains.join('\n').trim();
  if (htmls.length) return htmlToText(htmls.join('\n'));
  return '';
}

// ---------------------------------------------------------------------------
// Sender authenticity
//
// The forwarder half of the .gs check (X-Forwarded-For vs personal_email) dies
// with forwarding — under OAuth the mailbox is proven by the grant itself, so
// there is nothing to match. The DKIM half stays and matters MORE, because
// there is no longer a human choosing which mail to forward: anything sitting
// in the inbox claiming to be from a bank we track will be read by us.
//
// DKIM proves *a domain signed this*. It does NOT prove *this is really your
// bank* — a lookalike domain signs perfectly for itself. The query restriction
// above is what pins WHICH domains count.
// ---------------------------------------------------------------------------

function domainOf(address) {
  const m = String(address || '').match(/@([^@>\s]+)/);
  return m ? m[1].toLowerCase().replace(/\.$/, '') : null;
}

// true when signing domain == sender domain, or is a parent of it
// (mb.com.vn signing mail from mbebanking.mb.com.vn is legitimate).
function domainAligned(signingDomain, senderDomain) {
  if (!signingDomain || !senderDomain) return false;
  if (signingDomain === senderDomain) return true;
  return senderDomain.length > signingDomain.length &&
         senderDomain.slice(-(signingDomain.length + 1)) === '.' + signingDomain;
}

// Gmail has already verified the signature before the message landed; we read
// its verdict out of Authentication-Results rather than re-doing crypto.
function checkDkim(headers, sender) {
  const out = { dkim: 'unknown', reasons: [] };
  const authResults = (headers && (headers['authentication-results'] || headers['Authentication-Results'])) || '';
  if (!authResults) {
    out.dkim = 'absent';
    out.reasons.push('no Authentication-Results header');
    return out;
  }
  const m = String(authResults).match(/dkim=(\w+)/i);
  const verdict = m ? m[1].toLowerCase() : null;
  // Gmail reports the signing identity as header.i=@domain at least as often as
  // header.d=domain; accepting only the latter made every real message look
  // misaligned on the forwarding side.
  let signing = null;
  const dm = String(authResults).match(/header\.d=([^\s;]+)/i);
  if (dm) signing = dm[1].toLowerCase();
  else {
    const im = String(authResults).match(/header\.i=@?([^\s;]+)/i);
    if (im) {
      signing = im[1].toLowerCase();
      const at = signing.lastIndexOf('@');
      if (at !== -1) signing = signing.slice(at + 1);
    }
  }
  if (verdict !== 'pass') {
    out.dkim = 'fail';
    out.reasons.push('dkim=' + (verdict || 'missing'));
  } else if (!domainAligned(signing, domainOf(sender))) {
    out.dkim = 'misaligned';
    out.reasons.push('dkim=pass but header.d=' + signing + ' != sender ' + domainOf(sender));
  } else {
    out.dkim = 'pass';
  }
  return out;
}

// Is this sender actually one of the providers we track? The query should make
// this always true; it is re-checked because a Gmail query is a search, not a
// guarantee, and because thread-level matching can pull in a neighbour message.
function isKnownProvider(sender, domains) {
  const d = domainOf(sender);
  const addr = String(extractEmailAddress(sender)).toLowerCase();
  if (!d) return false;
  return (domains || []).some((row) => {
    const entry = String((typeof row === 'string' ? row : row && row.domain_or_address) || '').toLowerCase().trim();
    if (!entry) return false;
    if (entry.indexOf('@') !== -1) return addr === entry;
    return d === entry || domainAligned(entry, d);
  });
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function gmailFetch(url, accessToken) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (r.status === 401) { const e = new Error('gmail_unauthorized'); e.code = 401; throw e; }
  if (r.status === 403) { const e = new Error('gmail_forbidden: ' + (await r.text()).slice(0, 300)); e.code = 403; throw e; }
  if (r.status === 429) { const e = new Error('gmail_rate_limited'); e.code = 429; throw e; }
  if (!r.ok) throw new Error('gmail_http_' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}

// Returns [{id, threadId}]. Paginates, but bounded — a first-connect backfill
// over a busy mailbox must not run forever inside one serverless invocation.
async function listMessages(accessToken, query, opts) {
  const o = opts || {};
  const max = o.max || 100;
  const q = encodeURIComponent(assertRestrictedQuery(query));
  const out = [];
  let pageToken = '';
  do {
    const url = `${GMAIL_API}/messages?q=${q}&maxResults=${Math.min(100, max - out.length)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await gmailFetch(url, accessToken);
    for (const m of page.messages || []) out.push({ id: m.id, threadId: m.threadId });
    pageToken = page.nextPageToken || '';
  } while (pageToken && out.length < max);
  return out;
}

async function getMessage(accessToken, id) {
  const msg = await gmailFetch(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`, accessToken);
  const headers = headerMap(msg.payload);
  return {
    id: msg.id,
    threadId: msg.threadId,
    internalDate: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    sender: extractEmailAddress(headers.from || ''),
    fromHeader: headers.from || '',
    subject: headers.subject || '',
    headers,
    body: decodeBody(msg.payload),
  };
}

// Exchanges a refresh token for a short-lived access token. Kept here so the
// api/ handlers never hold Google client credentials in more than one place.
async function refreshAccessToken(refreshToken, env) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // invalid_grant is the one that matters operationally: the user revoked, or
    // the app is still in Testing publishing status and the 7-day clock ran out
    // (OAUTH-COMPLIANCE-FINDINGS.md §2). Both mean "ask for consent again",
    // not "retry" — the caller marks the connection needs_reconnect.
    const err = new Error('token_refresh_failed: ' + (data.error || r.status));
    err.code = data.error === 'invalid_grant' ? 'invalid_grant' : 'refresh_failed';
    throw err;
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

module.exports = {
  GMAIL_SCOPE,
  GMAIL_API,
  SYNC_LOOKBACK_DAYS,
  BACKFILL_DAYS,
  buildProviderQuery,
  assertRestrictedQuery,
  headerMap,
  extractEmailAddress,
  b64urlDecode,
  htmlToText,
  decodeBody,
  domainOf,
  domainAligned,
  checkDkim,
  isKnownProvider,
  listMessages,
  getMessage,
  refreshAccessToken,
};
