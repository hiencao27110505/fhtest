// Tests for pipeline/lib/gmail.js — query restriction, MIME decoding, DKIM.
//
// The query tests are the important ones. They are the executable form of the
// promise made to the user ("we only fetch mail from the banks you choose"),
// and the only thing standing between `gmail.readonly` and a whole-mailbox read.
//
// Run: node pipeline/gmail-parse.test.js

const g = require('./lib/gmail.js');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const DOMAINS = [
  { domain_or_address: 'mbbank.com.vn', provider_name: 'MB Bank' },
  { domain_or_address: 'vietcombank.com.vn', provider_name: 'Vietcombank' },
  { domain_or_address: 'receipts@anthropic.com', provider_name: 'Anthropic' },
];

console.log('\n-- the query is always sender-restricted --');
{
  const q = g.buildProviderQuery(DOMAINS);
  t('names every provider', /from:mbbank\.com\.vn/.test(q) && /from:vietcombank\.com\.vn/.test(q) && /from:receipts@anthropic\.com/.test(q), q);
  t('ORs the senders', / OR /.test(q));
  t('bounds the time window', /newer_than:\d+d/.test(q));
  t('parenthesises so newer_than binds to ALL senders, not the last one',
    /^\(\(from:.*\) newer_than:\d+d\)$/.test(q), q);
  console.log('        ^ the unparenthesised form silently bound the date to one sender');
  console.log('          on the forwarding side; same trap, pinned here.');

  t('no providers → null, NOT an unrestricted query', g.buildProviderQuery([]) === null);
  t('null input → null', g.buildProviderQuery(null) === null);
  t('blank entries are dropped, not turned into bare from:', g.buildProviderQuery([{ domain_or_address: '  ' }]) === null);
  t('duplicates collapse', (g.buildProviderQuery(['a.com', 'a.com', 'A.com']).match(/from:/g) || []).length === 1);
  t('backfill window is configurable', /newer_than:180d/.test(g.buildProviderQuery(DOMAINS, { days: 180 })));
  t('resume point can be pinned', / after:2026\/01\/01/.test(g.buildProviderQuery(DOMAINS, { after: '2026/01/01' })));
}

console.log('\n-- the guard refuses an unrestricted read --');
{
  t('empty query', throws(() => g.assertRestrictedQuery('')));
  t('null query', throws(() => g.assertRestrictedQuery(null)));
  t('a query with no from: clause', throws(() => g.assertRestrictedQuery('newer_than:7d')));
  t('"in:inbox" alone is refused', throws(() => g.assertRestrictedQuery('in:inbox')));
  t('a real provider query passes', g.assertRestrictedQuery(g.buildProviderQuery(DOMAINS)).length > 0);
  console.log('        ^ listMessages() calls this before spending the token, so a future');
  console.log('          edit that widens the read fails loudly instead of shipping.');
}

console.log('\n-- MIME decoding --');
{
  const plain = { mimeType: 'text/plain', body: { data: b64u('So tien: 250,000 VND') } };
  t('single text/plain part', g.decodeBody(plain) === 'So tien: 250,000 VND');

  const alt = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/html', body: { data: b64u('<p>ignored</p>') } },
      { mimeType: 'text/plain', body: { data: b64u('preferred') } },
    ],
  };
  t('prefers text/plain over text/html', g.decodeBody(alt) === 'preferred');

  const nested = {
    mimeType: 'multipart/mixed',
    parts: [{
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/plain', body: { data: b64u('deep plain') } }],
    }],
  };
  t('walks nested multiparts', g.decodeBody(nested) === 'deep plain');

  const htmlOnly = {
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/html', body: { data: b64u('<table><tr><td>So tien</td><td>250,000 VND</td></tr><tr><td>Ngay</td><td>12-08-2026</td></tr></table>') } }],
  };
  const text = g.decodeBody(htmlOnly);
  t('flattens HTML when that is all there is', /250,000 VND/.test(text), JSON.stringify(text));
  t('keeps rows on separate lines (extraction anchors depend on it)',
    text.split('\n').filter((l) => l.trim()).length >= 2, JSON.stringify(text));
  t('turns cell breaks into label separators', /So tien: 250,000 VND/.test(text), JSON.stringify(text));

  t('empty payload is empty string, not a throw', g.decodeBody(null) === '');
  t('decodes base64url (- and _) not just base64', g.b64urlDecode(b64u('a+b/c?d')) === 'a+b/c?d');
  t('strips script and style content', !/alert/.test(g.htmlToText('<style>x{}</style><script>alert(1)</script><p>ok</p>')));
}

console.log('\n-- headers --');
{
  const payload = { headers: [{ name: 'From', value: 'MB Bank <mbebanking@mbbank.com.vn>' }, { name: 'Subject', value: 'Bien dong so du' }] };
  const h = g.headerMap(payload);
  t('header names are lowercased', h.from === 'MB Bank <mbebanking@mbbank.com.vn>' && h.subject === 'Bien dong so du');
  t('address is extracted from a display-name header', g.extractEmailAddress(h.from) === 'mbebanking@mbbank.com.vn');
  t('bare address passes through', g.extractEmailAddress('x@y.com') === 'x@y.com');
}

console.log('\n-- DKIM (the forwarder half is gone; this half matters more) --');
{
  const ar = (v) => ({ 'authentication-results': v });
  t('genuine signed bank mail passes',
    g.checkDkim(ar('mx.google.com; dkim=pass header.i=@mbbank.com.vn header.d=mbbank.com.vn'), 'mbebanking@mbbank.com.vn').dkim === 'pass');
  t('header.i is accepted when header.d is absent',
    g.checkDkim(ar('dkim=pass header.i=@mbbank.com.vn'), 'mbebanking@mbbank.com.vn').dkim === 'pass');
  t('parent-domain signature accepted for a subdomain sender',
    g.checkDkim(ar('dkim=pass header.d=mb.com.vn'), 'noreply@mbebanking.mb.com.vn').dkim === 'pass');
  t('unsigned mail fails', g.checkDkim(ar('dkim=none'), 'mbebanking@mbbank.com.vn').dkim === 'fail');
  t('signed by the wrong domain is misaligned',
    g.checkDkim(ar('dkim=pass header.d=evil.com'), 'mbebanking@mbbank.com.vn').dkim === 'misaligned');
  t('missing header is recorded, not assumed good', g.checkDkim({}, 'x@y.com').dkim === 'absent');

  const look = g.checkDkim(ar('dkim=pass header.d=notmbbank.com.vn'), 'x@notmbbank.com.vn');
  t('a lookalike domain is DKIM-valid for ITSELF', look.dkim === 'pass');
  t('...but is not a known provider, so it is never queried',
    g.isKnownProvider('x@notmbbank.com.vn', DOMAINS) === false);
  console.log('        ^ this is the improvement over forwarding: the lookalike is outside');
  console.log('          the query, so it never arrives to be judged in the first place.');
}

console.log('\n-- known-provider re-check --');
{
  t('exact domain', g.isKnownProvider('mbebanking@mbbank.com.vn', DOMAINS) === true);
  t('subdomain of a listed domain', g.isKnownProvider('noreply@mail.mbbank.com.vn', DOMAINS) === true);
  t('full-address entry matches exactly', g.isKnownProvider('receipts@anthropic.com', DOMAINS) === true);
  t('full-address entry does not match the whole domain', g.isKnownProvider('sales@anthropic.com', DOMAINS) === false);
  t('unrelated sender', g.isKnownProvider('friend@gmail.com', DOMAINS) === false);
  t('suffix trickery is not a match', g.isKnownProvider('x@evilmbbank.com.vn', DOMAINS) === false);
  t('garbage sender', g.isKnownProvider('', DOMAINS) === false);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
