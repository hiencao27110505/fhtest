#!/usr/bin/env node
/* The WALLETS group, split four ways, without moving anything else.
 * `node pipeline/sender-kinds.test.js`
 *
 * senders.mjs kept e-wallets, payment gateways, securities houses and consumer
 * lenders in one group, so a trade confirmation and a loan instalment were read
 * with one prompt and staged as a plain expense
 * (docs/specs/email-reading-v2-spec.md §2, §7). They are four groups now, and
 * `match()` says which as `senderKind`.
 *
 * Two things must NOT have moved, and each is a silent failure if it does:
 *   • the Gmail query. A domain that falls out of it is never FETCHED: its mail
 *     cannot show up as skipped, unreadable or anything else.
 *   • the sealed transaction_type. The device's dedup engine reads it to tell a
 *     bank from a non-bank, and its job is to STOP a dedup: a broker that
 *     started reading as a bank would let a genuine duplicate through.
 *
 * DOMAINS_BEFORE is a recording of inboxQuery's domain set taken before the
 * split (commit acbf6a4: 157 domains). Do not regenerate it from the code.
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const S = await import(ROOT + 'senders.mjs');
const ST = await import(ROOT + 'stage.mjs');
const C = await import(ROOT + 'contract.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const DOMAINS_BEFORE = ["9pay.com.vn", "9pay.vn", "abbank.com.vn", "abbank.vn", "acb.com.vn", "agribank.com.vn", "agribank.vn", "airpay.vn", "alepay.vn", "appotapay.com", "appotapay.com.vn", "appotapay.vn", "baca-bank.com.vn", "baca-bank.vn", "baokim.com.vn", "baokim.vn", "baovietbank.com.vn", "baovietbank.vn", "bidv.com.vn", "bidv.vn", "bvbank.net.vn", "cake.com.vn", "cake.vn", "ctg.com.vn", "ctg.vn", "dnse.com.vn", "dnse.vn", "eib.com.vn", "eib.vn", "eximbank.com.vn", "eximbank.vn", "fecredit.com.vn", "fecredit.vn", "finhay.com.vn", "finhay.vn", "finviet.com.vn", "finviet.vn", "fundiin.vn", "gpay.com.vn", "gpay.vn", "gpbank.com.vn", "hdbank.com.vn", "hdsaison.com.vn", "hlbank.com.vn", "homecredit.com.vn", "homecredit.vn", "hsbc.com.vn", "hsbc.vn", "hsc.com.vn", "hsc.vn", "infina.com.vn", "infina.vn", "kienlongbank.com", "kienlongbank.com.vn", "kienlongbank.vn", "klb.com.vn", "klb.vn", "kredivo.com.vn", "kredivo.vn", "lienvietpostbank.com.vn", "lienvietpostbank.vn", "liobank.com.vn", "liobank.vn", "lpbank.com.vn", "lpbank.vn", "mbb.vn", "mbbank.com.vn", "mbbank.vn", "mbs.com.vn", "mbs.vn", "miraeasset.com.vn", "moca.vn", "momo.com.vn", "momo.vn", "msb.com.vn", "msb.vn", "mservice.com.vn", "mservice.vn", "namabank.com.vn", "napas.com.vn", "ncb-bank.com.vn", "ncb-bank.vn", "ncb.com.vn", "ncb.vn", "nganluong.vn", "ocb.com.vn", "oceanbank.vn", "onepay.com.vn", "onepay.vn", "payoo.com.vn", "payoo.vn", "pgbank.com.vn", "pgbank.vn", "publicbank.com.vn", "pvcombank.com.vn", "pvcombank.vn", "sacombank.com", "sacombank.com.vn", "saigonbank.com.vn", "scb.com.vn", "scb.vn", "seabank.com.vn", "seabank.vn", "shb.com.vn", "shb.vn", "shinhan.com.vn", "shopeepay.vn", "smartpay.com.vn", "smartpay.vn", "ssi.com.vn", "ssi.vn", "stb.com.vn", "stb.vn", "tcb.vn", "tcbs.com.vn", "techcombank.com.vn", "techcombank.vn", "timo.vn", "tnex.com.vn", "tnex.vn", "tpb.com.vn", "tpb.vn", "tpbank.com.vn", "tpbank.vn", "ubank.com.vn", "ubank.vn", "vcb.com.vn", "vcbs.com.vn", "vcbs.vn", "vib.com.vn", "vietabank.com.vn", "vietbank.com.vn", "vietbank.vn", "vietcapitalbank.com.vn", "vietcombank.com.vn", "vietinbank.vn", "viettelmoney.com.vn", "viettelmoney.vn", "viettelpay.com.vn", "viettelpay.vn", "vikkibank.vn", "vndirect.com.vn", "vndirect.vn", "vnpay.com.vn", "vnpay.vn", "vnptmoney.com.vn", "vnptmoney.vn", "vnptpay.vn", "vpbank.com.vn", "vps.com.vn", "vps.vn", "woori.com.vn", "woori.vn", "wooribank.com.vn", "wooribank.vn", "zalopay.com.vn", "zalopay.vn"];

console.log('\n-- the Gmail query names exactly the domains it named before --');
const queryDomains = (q) => [...q.matchAll(/from:([a-z0-9.-]+)/g)].map((m) => m[1]).filter((d) => d.includes('.')).sort();
const now = queryDomains(S.inboxQuery(7));
t('157 domains, as recorded', DOMAINS_BEFORE.length === 157 && now.length === 157, now.length);
t('the SAME 157', JSON.stringify(now) === JSON.stringify(DOMAINS_BEFORE),
  { gone: DOMAINS_BEFORE.filter((d) => !now.includes(d)), added: now.filter((d) => !DOMAINS_BEFORE.includes(d)) });
t('receipt domains are still left out of the query', S.RECEIPT_DOMAINS.every((d) => !now.includes(d)));
t('the promo exclusions and the window are still there', / -from:marketing -from:promotion newer_than:7d$/.test(S.inboxQuery(7)));

console.log('\n-- match(): the finer class beside the coarse one --');
const BROKERS = ['ssi.com.vn', 'vps.com.vn', 'tcbs.com.vn', 'vndirect.com.vn', 'dnse.com.vn', 'hsc.com.vn', 'mbs.com.vn', 'miraeasset.com.vn', 'vcbs.com.vn', 'finhay.com.vn', 'infina.vn'];
const LENDERS = ['fecredit.com.vn', 'homecredit.vn', 'hdsaison.com.vn', 'kredivo.vn', 'fundiin.vn'];
const GATEWAYS = ['9pay.vn', 'alepay.vn', 'appotapay.com', 'baokim.vn', 'gpay.vn', 'napas.com.vn', 'nganluong.vn', 'onepay.vn', 'payoo.vn', 'vnpay.vn', 'finviet.com.vn', 'smartpay.vn'];
const EWALLETS = ['momo.vn', 'mservice.com.vn', 'zalopay.vn', 'shopeepay.vn', 'airpay.vn', 'viettelmoney.vn', 'vnptmoney.vn', 'moca.vn'];
for (const [want, list] of [['broker', BROKERS], ['lender', LENDERS], ['gateway', GATEWAYS], ['wallet', EWALLETS]]) {
  for (const d of list) {
    const m = S.match('"ZQ" <no-reply@mail.' + d + '>');
    t(d + ' → ' + want, !!m && m.senderKind === want, m);
    t(d + ' is still coarse-kind "wallet" to every existing caller', !!m && m.kind === 'wallet', m && m.kind);
  }
}
t('eleven brokers, five lenders, twelve gateways, as the spec counts them',
  new Set(Object.values(S.KNOWN_DOMAINS.BROKERS)).size === 11 && new Set(Object.values(S.KNOWN_DOMAINS.LENDERS)).size === 5 && new Set(Object.values(S.KNOWN_DOMAINS.GATEWAYS)).size === 12,
  [new Set(Object.values(S.KNOWN_DOMAINS.BROKERS)).size, new Set(Object.values(S.KNOWN_DOMAINS.LENDERS)).size, new Set(Object.values(S.KNOWN_DOMAINS.GATEWAYS)).size]);
t('a bank is a bank on both grains', JSON.stringify(S.match('x@info.vietcombank.com.vn')) === JSON.stringify({ provider: 'Vietcombank', kind: 'bank', senderKind: 'bank' }));
t('a receipt sender is a receipt on both grains', S.match('no-reply@grab.com').kind === 'receipt' && S.match('no-reply@grab.com').senderKind === 'receipt');
t('an extra domain from the database is a bank on both grains', JSON.stringify(S.match('a@zq.test', [{ domain_or_address: 'zq.test', provider_name: 'ZQ' }])) === JSON.stringify({ provider: 'ZQ', kind: 'bank', senderKind: 'bank' }));
t('a lookalike still does not match', S.match('a@ssi.com.vn.evil.test') === null);
t('every senderKind match() can return is in the contract', ['bank', 'wallet', 'gateway', 'broker', 'lender', 'receipt'].every((k) => C.SENDER_KINDS.includes(k)));

console.log('\n-- the sealed transaction_type does not know the split happened --');
for (const k of ['wallet', 'gateway', 'broker', 'lender']) {
  t(k + ' → ecommerce_receipt, exactly what "wallet" has always mapped to', ST.transactionTypeFor(k) === ST.transactionTypeFor('wallet') && ST.transactionTypeFor(k) === 'ecommerce_receipt');
}
t('only a bank is bank_txn', ST.transactionTypeFor('bank') === 'bank_txn');

console.log('\n-- KNOWN_DOMAINS keeps what its importers expect --');
t('BANKS, WALLETS, RECEIPTS are still there', ['BANKS', 'WALLETS', 'RECEIPTS'].every((k) => S.KNOWN_DOMAINS[k] && typeof S.KNOWN_DOMAINS[k] === 'object'));
t('WALLETS is still EVERY non-bank, non-receipt domain (66), brokers and lenders included', Object.keys(S.KNOWN_DOMAINS.WALLETS).length === 66
  && 'ssi.com.vn' in S.KNOWN_DOMAINS.WALLETS && 'fecredit.com.vn' in S.KNOWN_DOMAINS.WALLETS && 'momo.vn' in S.KNOWN_DOMAINS.WALLETS, Object.keys(S.KNOWN_DOMAINS.WALLETS).length);
t('the four finer groups partition it', Object.keys(S.KNOWN_DOMAINS.EWALLETS).length + Object.keys(S.KNOWN_DOMAINS.GATEWAYS).length
  + Object.keys(S.KNOWN_DOMAINS.BROKERS).length + Object.keys(S.KNOWN_DOMAINS.LENDERS).length === 66);
t('RECEIPT_DOMAINS is still exported (tools/pull-mail-corpus.mjs reads it)', Array.isArray(S.RECEIPT_DOMAINS) && S.RECEIPT_DOMAINS.includes('grab.com'));
t('canonProviderName still folds a broker\'s and a lender\'s name', S.canonProviderName('ssi') === 'SSI' && S.canonProviderName('FE CREDIT') === 'FE Credit', [S.canonProviderName('ssi'), S.canonProviderName('FE CREDIT')]);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
