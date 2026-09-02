/**
 * Reading one mailbox, over the grant the person gave us.
 *
 * Everything here is HTTP against Google. It takes `fetch` as an argument so a
 * test drives the whole worker without a network, and so the one place that
 * talks to a third party is obvious in a call stack.
 *
 * WHY POLLING AND NOT PUSH. A Gmail `watch()` registration is per-mailbox and a
 * second call silently replaces the first one's topic, so a push-based pipeline
 * cannot coexist with another one on the same mailbox: the loser stops
 * receiving notifications with no error anywhere. Polling conflicts with
 * nothing, needs no Pub/Sub topic, no IAM grant on it, and no renewal job that
 * lapses after seven days taking the notifications with it.
 *
 * The cost is latency, and it is the right cost to pay: a transaction that
 * appears in the review queue four minutes after the bank sent the mail is
 * indistinguishable, to a person, from one that appears in four seconds.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The scope this worker needs, and the only one it should ever be granted. */
export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * The refresh token no longer works, and no retry will change that.
 *
 * Google invalidates one when the user revokes access, changes their password,
 * or every 7 days while the OAuth app is in Testing publishing status. None of
 * those are transient, so this is a STATE the app surfaces as "reconnect", not
 * an error to retry into.
 */
export class TokenRejected extends Error {
  constructor(detail) {
    super('token_rejected' + (detail ? ': ' + detail : ''));
    this.name = 'TokenRejected';
  }
}

/** Google answered, but not in a way this poll can continue from. */
export class GmailError extends Error {
  constructor(status, detail) {
    super('gmail_http_' + status + (detail ? ': ' + detail : ''));
    this.name = 'GmailError';
    this.status = status;
    // 5xx and 429 are worth another poll in five minutes; 4xx are not.
    this.transient = status === 429 || status >= 500;
  }
}

/**
 * Mints an access token from a refresh token.
 *
 * A 400 or 401 here is `invalid_grant` in almost every case, which is the
 * permanent state above. Anything else is treated as transient, because the
 * alternative — marking a mailbox as needing re-consent because Google had a
 * bad minute — costs the user a re-authorisation they did not need.
 */
export async function accessToken(refreshToken, cfg, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const body = await res.text();
  if (res.status === 400 || res.status === 401) throw new TokenRejected(_reason(body));
  if (!res.ok) throw new GmailError(res.status, body.slice(0, 200));

  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new GmailError(502, 'token response not JSON'); }
  if (!parsed.access_token) throw new GmailError(502, 'token response carried no access_token');
  return parsed.access_token;
}

function _reason(body) {
  try { return JSON.parse(body).error || ''; } catch { return ''; }
}

async function _get(path, token, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 401) throw new TokenRejected('gmail rejected the access token');
  if (!res.ok) throw new GmailError(res.status, (await res.text()).slice(0, 200));
  return res.json();
}

/**
 * Message ids matching `query`, newest first, bounded.
 *
 * `limit` is a real bound, not a page size: a first connect on a busy mailbox
 * can match hundreds of mails and one poll should not try to stage all of them.
 * What is left over is not lost — the cursor does not advance past unread work,
 * so the next poll picks up where this one stopped.
 */
export async function listMessageIds(query, limit, token, fetchImpl) {
  const ids = [];
  let pageToken = '';
  while (ids.length < limit) {
    const page = Math.min(100, limit - ids.length);
    const qs = new URLSearchParams({ q: query, maxResults: String(page) });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await _get('/messages?' + qs.toString(), token, fetchImpl);
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return ids;
}

/**
 * One message: the headers that matter, and the body as text.
 *
 * A 404 returns null rather than throwing. The message was deleted between the
 * list and the get, which is ordinary in a live mailbox and is not a reason to
 * fail the poll and replay the whole window.
 */
export async function getMessage(id, token, fetchImpl, mailtext) {
  let data;
  try {
    data = await _get('/messages/' + encodeURIComponent(id) + '?format=full', token, fetchImpl);
  } catch (e) {
    if (e instanceof GmailError && e.status === 404) return null;
    throw e;
  }

  const payload = data.payload || {};
  const headers = {};
  for (const h of payload.headers || []) {
    // Lower-cased, and first-wins: a forged second From: header must not be the
    // one that gets read.
    const name = String(h.name || '').toLowerCase();
    if (!(name in headers)) headers[name] = h.value;
  }

  return {
    id,
    threadId: data.threadId,
    from: headers.from || '',
    subject: headers.subject || '',
    date: headers.date || '',
    internalDate: data.internalDate ? Number(data.internalDate) : null,
    headers,
    body: mailtext.toText(mailtext.decodeBase64Url(_bodyData(payload))),
    dkim: dkimVerdict(headers, headers.from || ''),
  };
}

/**
 * The HEADERS of one message, and deliberately not its body.
 *
 * Everything selection needs to decide — sender, subject, DKIM verdict — lives
 * in the headers, and so does the key of every cached verdict: the junk cache
 * and the fingerprint cache are both (sender, subject). Yet the only fetch this
 * module offered was ?format=full, so the pipeline paid for the body FIRST and
 * looked up "we never needed this" second. Measured in one backfill: 22% of
 * ~951k reads were bodies fetched for mail the junk cache then discarded, and
 * 77% were bodies fetched for mail the model budget then deferred.
 *
 * Same shape as getMessage so callers can treat the two interchangeably, with
 * body: null as the honest difference. Same 404-returns-null semantics: a
 * message deleted between list and get is ordinary, not an error.
 */
export async function getMessageMetadata(id, token, fetchImpl) {
  let data;
  try {
    data = await _get('/messages/' + encodeURIComponent(id) + '?format=metadata', token, fetchImpl);
  } catch (e) {
    if (e instanceof GmailError && e.status === 404) return null;
    throw e;
  }
  const payload = data.payload || {};
  const headers = {};
  for (const h of payload.headers || []) {
    // Lower-cased, first-wins — the same forged-second-header rule as getMessage.
    const name = String(h.name || '').toLowerCase();
    if (!(name in headers)) headers[name] = h.value;
  }
  return {
    id,
    threadId: data.threadId,
    from: headers.from || '',
    subject: headers.subject || '',
    date: headers.date || '',
    internalDate: data.internalDate ? Number(data.internalDate) : null,
    headers,
    body: null,
    dkim: dkimVerdict(headers, headers.from || ''),
  };
}

/**
 * The best body part in the MIME tree: text/plain if there is one, else HTML.
 *
 * Preferring plain is not only about size. Where a mail has a plain part the
 * bank wrote the field layout itself, with a line per field, which is exactly
 * what the template anchors want; the HTML part is the same content wrapped in
 * a table that has to be flattened back into those lines.
 */
function _bodyData(payload) {
  const found = { plain: '', html: '' };
  _walk(payload, found);
  return found.plain || found.html;
}

function _walk(part, found) {
  if (!part || (found.plain && found.html)) return;
  const mime = part.mimeType || '';
  const data = (part.body && part.body.data) || '';
  if (data) {
    if (mime === 'text/plain' && !found.plain) found.plain = data;
    else if (mime === 'text/html' && !found.html) found.html = data;
  }
  for (const child of part.parts || []) _walk(child, found);
}

/**
 * Whether the domain that signed this mail is the domain it claims to be from.
 *
 * Gmail verifies DKIM before we ever see the message and records the result in
 * `Authentication-Results`, so this reads a verdict rather than doing crypto.
 * That header is added by the receiving server; a copy in the message body
 * cannot forge it, and taking only the FIRST header value is what keeps an
 * attacker-supplied second one out.
 *
 * WHAT THIS DOES NOT PROVE, and it matters more here than under forwarding:
 * DKIM proves a domain signed its own mail, not that the domain is really your
 * bank. A lookalike domain signs perfectly for itself. `senders.match` is what
 * decides the domain is one we believe in; this decides the mail really came
 * from it. Both, or neither is worth much.
 *
 * Under forwarding a phishing mail had to be forwarded to us by the user. Here
 * it only has to arrive in their inbox, which is a much lower bar for the
 * attacker, so this verdict is recorded on every row.
 */
export function dkimVerdict(headers, fromHeader) {
  const raw = headers['authentication-results'] || '';
  const m = String(raw).match(/dkim=(\w+)/i);
  const result = m ? m[1].toLowerCase() : 'none';

  const signed = String(raw).match(/header\.(?:i|d)=@?([\w.-]+)/i);
  const signingDomain = signed ? signed[1].toLowerCase() : '';
  const fromDomain = _domain(fromHeader);

  // Alignment is a suffix match on a dot boundary, the same rule senders.mjs
  // uses: mail signed by `mbbank.com.vn` for `notify.mbbank.com.vn` is aligned,
  // and `mbbank.com.vn.evil.com` is not.
  const aligned = !!signingDomain && !!fromDomain &&
    (fromDomain === signingDomain ||
     fromDomain.endsWith('.' + signingDomain) ||
     signingDomain.endsWith('.' + fromDomain));

  return { result, signingDomain, fromDomain, aligned, pass: result === 'pass' && aligned };
}

function _domain(fromHeader) {
  const s = String(fromHeader || '');
  const angled = s.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : s).trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  return at < 0 ? '' : addr.slice(at + 1);
}

/**
 * Asks Gmail to publish `{emailAddress, historyId}` to a Pub/Sub topic whenever
 * this mailbox changes.
 *
 * A DOORBELL, NOT A DELIVERY. The notification carries no mail content and
 * `watch()` cannot filter by sender — only by label — so identifying a bank
 * email still means fetching it. Nothing downstream changes; the worker runs
 * the same windowed read it runs on a poll. What changes is when.
 *
 * ONE WATCH PER MAILBOX, AND THE LAST CALL WINS. Calling watch() again does not
 * create a second registration: it replaces the topic and resets the clock. So
 * renewing is the same call as registering, and two systems watching one mailbox
 * for DIFFERENT topics is a fight the later caller always wins — silently, since
 * the loser is simply never published to again. Ours names its own topic, which
 * is why it can coexist with anything else pointed at that mailbox only if that
 * other thing names the same one.
 *
 * Deliberately NOT filtered to INBOX. A bank mail auto-filtered into a folder by
 * the user's own rules is still a transaction, and a label filter would drop the
 * notification for exactly the households most organised about their mail. The
 * cost is notifications for mail we do not care about, and the handler answers
 * those with one cheap search that finds nothing.
 *
 * @return {{historyId: string, expiration: number}} expiration is epoch ms
 */
export async function watch(topicName, token, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(API + '/watch', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicName }),
  });
  if (res.status === 401) throw new TokenRejected('gmail rejected the access token');
  if (!res.ok) throw new GmailError(res.status, (await res.text()).slice(0, 300));
  const data = await res.json();
  return {
    historyId: data.historyId ? String(data.historyId) : null,
    // Gmail returns epoch MILLISECONDS as a string. Reading it as seconds puts
    // the expiry in 1970 and every renewal sweep then treats every mailbox as
    // due, forever.
    expiration: data.expiration ? Number(data.expiration) : null,
  };
}

/**
 * Stops Gmail publishing for this mailbox.
 *
 * Best effort by design: a mailbox we can no longer read is one we cannot call
 * this for either, and a watch nobody renews lapses within 7 days on its own.
 * Failing a disconnect because the doorbell could not be unwired would be the
 * wrong trade — the row is gone, so a notification that still arrives finds no
 * grant and is dropped.
 */
export async function stopWatch(token, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  try {
    await doFetch(API + '/stop', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pulls `{emailAddress, historyId}` out of a Pub/Sub push envelope.
 *
 * Returns null for anything unparseable, and the caller ACKs that rather than
 * retrying: a malformed message will be malformed on every redelivery, and
 * refusing it just keeps Pub/Sub sending it back until the topic's retention
 * expires.
 */
export function decodePushEnvelope(body) {
  const raw = body && body.message && body.message.data;
  if (!raw) return null;
  try {
    const b64 = String(raw).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    if (!parsed || !parsed.emailAddress) return null;
    return {
      emailAddress: String(parsed.emailAddress).toLowerCase(),
      historyId: parsed.historyId ? String(parsed.historyId) : null,
    };
  } catch {
    return null;
  }
}

/**
 * The form of a Gmail address that two spellings of it agree on.
 *
 * Gmail ignores dots and everything after a `+` in the local part, so
 * `a.b+bank@gmail.com` and `ab@gmail.com` are one mailbox. Google returns the
 * canonical address in both the profile call and the push notification, so
 * these should already match — but the forwarding pipeline was bitten by
 * exactly this when resolving a mailbox owner, and a mismatch here means a
 * notification arrives for a mailbox we hold a grant for and is dropped as
 * unknown. One cheap fallback beats rediscovering that.
 *
 * Only applied to Google's own domains: dots are significant elsewhere.
 */
export function foldAddress(address) {
  const s = String(address || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 0) return s;
  const domain = s.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return s;
  const local = s.slice(0, at).split('+')[0].replace(/\./g, '');
  return local + '@gmail.com';
}
