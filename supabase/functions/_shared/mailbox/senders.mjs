/**
 * Which senders are worth reading, and what kind of thing they are.
 *
 * Two jobs, and they are separate on purpose:
 *
 *   1. **The Gmail query.** Direct read means we could fetch anything in the
 *      mailbox, and the one thing standing between "we read bank mail" and "we
 *      read everything" is that the query names senders. `gmail.readonly` grants
 *      the whole mailbox and Google publishes no narrower scope, so this list is
 *      a self-imposed restraint rather than a boundary the user can check
 *      (OAUTH-DIRECT-READ §3.3). That is exactly why it lives in one reviewable
 *      file instead of being assembled at three call sites.
 *
 *   2. **The transaction kind.** A bank notice is a `bank_txn`; a wallet or
 *      merchant receipt is an `ecommerce_receipt`. Nothing in the mail says
 *      which, and the client's bank-vs-bank dedup rule reads it, so the sender
 *      is the only evidence there is. Anything unrecognised is a receipt, never
 *      a bank claim: guessing `bank_txn` would feed that rule a claim we cannot
 *      support, and its job is to STOP a dedup, so a wrong claim there lets a
 *      genuine duplicate through.
 *
 * MATCHING IS ON THE DOMAIN, AND SUBDOMAINS COUNT. `info.vietcombank.com.vn`
 * matches `vietcombank.com.vn`; `vietcombank.com.vn.evil.com` does not. The
 * check is a suffix match on a dot boundary rather than `indexOf`, which is the
 * difference between the two.
 *
 * A MATCH HERE IS NOT AUTHENTICATION. The From header is unsigned text. This
 * says "worth reading", and DKIM (see gmail.mjs) says "really from that domain".
 * Under forwarding a phishing mail had to be forwarded to us first; here it is
 * read straight out of the inbox it landed in, so the two checks have to stay
 * distinct in the reader's head as well as in the code.
 */

/** Vietnamese banks. Domain → the provider name a staged row carries.
 *
 * PORTED FROM THE FORWARDING PIPELINE'S LIST (157 domains) rather than curated
 * separately. Two lists meant two coverage levels, and the shortfall was
 * invisible in exactly the way that matters: a domain missing here is never put
 * in the Gmail query, so its mail is never FETCHED — it cannot show up as
 * skipped, unreadable, or anything else. A real mailbox looked like it had no
 * bank history before 11 Aug when it simply had mail we never asked for.
 *
 * THE DOMAIN IS THE ONE THAT SENDS MAIL, not the one on the website. That list
 * was compiled against live MX records and the traps are real: vietinbank.com.vn
 * has no MX (it is vietinbank.vn), tpbank.com.vn is tpb.com.vn, bacabank.com.vn
 * is baca-bank.vn, ncb.com.vn is ncb-bank.vn, dongabank became vikkibank.vn.
 * "Vietnamese banks are @name.com.vn" is a good first guess and a bad rule.
 *
 * Subdomains match automatically, so `no-reply@mail.acb.com.vn` needs no entry.
 */
const BANKS = {
  'abbank.com.vn': 'ABBANK',
  'abbank.vn': 'ABBANK',
  'acb.com.vn': 'ACB',
  'agribank.com.vn': 'Agribank',
  'agribank.vn': 'Agribank',
  'baca-bank.com.vn': 'BacABank',
  'baca-bank.vn': 'BacABank',
  'baovietbank.com.vn': 'BaoViet Bank',
  'baovietbank.vn': 'BaoViet Bank',
  'bidv.com.vn': 'BIDV',
  'bidv.vn': 'BIDV',
  'bvbank.net.vn': 'BVBank',
  'cake.com.vn': 'Cake',
  'cake.vn': 'Cake',
  'ctg.com.vn': 'VietinBank',
  'ctg.vn': 'VietinBank',
  'eib.com.vn': 'Eximbank',
  'eib.vn': 'Eximbank',
  'eximbank.com.vn': 'Eximbank',
  'eximbank.vn': 'Eximbank',
  'gpbank.com.vn': 'GPBANK',
  'hdbank.com.vn': 'HDBank',
  'hlbank.com.vn': 'HONGLEONG',
  'hsbc.com.vn': 'HSBC',
  'hsbc.vn': 'HSBC',
  'kienlongbank.com': 'KienlongBank',
  'kienlongbank.com.vn': 'KienlongBank',
  'kienlongbank.vn': 'KienlongBank',
  'klb.com.vn': 'KienlongBank',
  'klb.vn': 'KienlongBank',
  'lienvietpostbank.com.vn': 'LPBank',
  'lienvietpostbank.vn': 'LPBank',
  'liobank.com.vn': 'Liobank',
  'liobank.vn': 'Liobank',
  'lpbank.com.vn': 'LPBank',
  'lpbank.vn': 'LPBank',
  'mbb.vn': 'MB Bank',
  'mbbank.com.vn': 'MB Bank',
  'mbbank.vn': 'MB Bank',
  'msb.com.vn': 'MSB',
  'msb.vn': 'MSB',
  'namabank.com.vn': 'Nam A Bank',
  'ncb-bank.com.vn': 'NCB',
  'ncb-bank.vn': 'NCB',
  'ncb.com.vn': 'NCB',
  'ncb.vn': 'NCB',
  'ocb.com.vn': 'OCB',
  'oceanbank.vn': 'OCEANBANK',
  'pgbank.com.vn': 'PGBank',
  'pgbank.vn': 'PGBank',
  'publicbank.com.vn': 'PUBLICBANK',
  'pvcombank.com.vn': 'PVcomBank',
  'pvcombank.vn': 'PVcomBank',
  'sacombank.com': 'Sacombank',
  'sacombank.com.vn': 'Sacombank',
  'saigonbank.com.vn': 'SaigonBank',
  'scb.com.vn': 'SCB',
  'scb.vn': 'SCB',
  'seabank.com.vn': 'SeABank',
  'seabank.vn': 'SeABank',
  'shb.com.vn': 'SHB',
  'shb.vn': 'SHB',
  'shinhan.com.vn': 'SHINHAN',
  'stb.com.vn': 'Sacombank',
  'stb.vn': 'Sacombank',
  'tcb.vn': 'Techcombank',
  'techcombank.com.vn': 'Techcombank',
  'techcombank.vn': 'Techcombank',
  'timo.vn': 'Timo',
  'tnex.com.vn': 'TNEX',
  'tnex.vn': 'TNEX',
  'tpb.com.vn': 'TPBank',
  'tpb.vn': 'TPBank',
  'tpbank.com.vn': 'TPBank',
  'tpbank.vn': 'TPBank',
  'ubank.com.vn': 'UBank',
  'ubank.vn': 'UBank',
  'vcb.com.vn': 'Vietcombank',
  'vib.com.vn': 'VIB',
  'vietabank.com.vn': 'VietABank',
  'vietbank.com.vn': 'VietBank',
  'vietbank.vn': 'VietBank',
  'vietcapitalbank.com.vn': 'BVBank',
  'vietcombank.com.vn': 'Vietcombank',
  'vietinbank.vn': 'VietinBank',
  'vikkibank.vn': 'VIKKI',
  'vpbank.com.vn': 'VPBank',
  'woori.com.vn': 'Woori',
  'woori.vn': 'Woori',
  'wooribank.com.vn': 'Woori',
  'wooribank.vn': 'Woori',
};

/** Everything that is not a bank and not a merchant receipt, in FOUR classes
 *  (email-reading-v2 §7, 2026-09-22).
 *
 * Until now this was one group, `WALLETS`, and every sender in it was read with
 * one prompt and staged as a plain `ecommerce_receipt` expense. That was wrong
 * for two of the four: a securities house confirms a TRADE (a quantity, a
 * symbol, a side), and a consumer-finance or pay-later company confirms a
 * DISBURSEMENT or an INSTALMENT (a contract, a due date, principal and
 * interest). The reader now knows the class before it reads, so it can ask the
 * model the right questions (llm.mjs, one prompt block per class) and seal
 * `sender_kind` for the device.
 *
 * WHAT DID NOT CHANGE, AND MUST NOT. Everything here is still
 * `ecommerce_receipt`, never `bank_txn` (stage.mjs transactionTypeFor): the
 * client's bank-vs-bank dedup rule reads that, and its job is to STOP a dedup.
 * Calling a wallet, a broker or a lender a bank feeds that rule a claim we
 * cannot support and lets a genuine duplicate through. And the Gmail query is
 * the union of all four, the same 66 domains it always was
 * (pipeline/sender-kinds.test.js pins the set). */

/** E-wallets: the customer holds a balance there. */
const WALLETS = {
  'airpay.vn': 'ShopeePay',
  'moca.vn': 'Moca',
  'momo.com.vn': 'MoMo',
  'momo.vn': 'MoMo',
  'mservice.com.vn': 'MoMo',
  'mservice.vn': 'MoMo',
  'shopeepay.vn': 'ShopeePay',
  'viettelmoney.com.vn': 'ViettelPay',
  'viettelmoney.vn': 'ViettelPay',
  'viettelpay.com.vn': 'ViettelPay',
  'viettelpay.vn': 'ViettelPay',
  'vnptmoney.com.vn': 'VNPT Money',
  'vnptmoney.vn': 'VNPT Money',
  'vnptpay.vn': 'VNPT Money',
  'zalopay.com.vn': 'ZaloPay',
  'zalopay.vn': 'ZaloPay',
};

/** Payment gateways and switches: they move a payment and hold nothing. */
const GATEWAYS = {
  '9pay.com.vn': '9Pay',
  '9pay.vn': '9Pay',
  'alepay.vn': 'Alepay',
  'appotapay.com': 'AppotaPay',
  'appotapay.com.vn': 'AppotaPay',
  'appotapay.vn': 'AppotaPay',
  'baokim.com.vn': 'Baokim',
  'baokim.vn': 'Baokim',
  'finviet.com.vn': 'FinViet',
  'finviet.vn': 'FinViet',
  'gpay.com.vn': 'GPay',
  'gpay.vn': 'GPay',
  'napas.com.vn': 'NAPAS',
  'nganluong.vn': 'NganLuong',
  'onepay.com.vn': 'OnePay',
  'onepay.vn': 'OnePay',
  'payoo.com.vn': 'Payoo',
  'payoo.vn': 'Payoo',
  'smartpay.com.vn': 'SmartPay',
  'smartpay.vn': 'SmartPay',
  'vnpay.com.vn': 'VNPAY',
  'vnpay.vn': 'VNPAY',
};

/** Securities houses and investing apps: trade confirmations, cash in and out
 *  of a securities account, dividends. */
const BROKERS = {
  'dnse.com.vn': 'DNSE',
  'dnse.vn': 'DNSE',
  'finhay.com.vn': 'Finhay',
  'finhay.vn': 'Finhay',
  'hsc.com.vn': 'HSC',
  'hsc.vn': 'HSC',
  'infina.com.vn': 'Infina',
  'infina.vn': 'Infina',
  'mbs.com.vn': 'MBS',
  'mbs.vn': 'MBS',
  'miraeasset.com.vn': 'Mirae Asset',
  'ssi.com.vn': 'SSI',
  'ssi.vn': 'SSI',
  'tcbs.com.vn': 'TCBS',
  'vcbs.com.vn': 'VCBS',
  'vcbs.vn': 'VCBS',
  'vndirect.com.vn': 'VNDIRECT',
  'vndirect.vn': 'VNDIRECT',
  'vps.com.vn': 'VPS',
  'vps.vn': 'VPS',
};

/** Consumer finance and pay-later: disbursements, instalments, due notices. */
const LENDERS = {
  'fecredit.com.vn': 'FE Credit',
  'fecredit.vn': 'FE Credit',
  'fundiin.vn': 'Fundiin',
  'hdsaison.com.vn': 'HD SAISON',
  'homecredit.com.vn': 'Home Credit',
  'homecredit.vn': 'Home Credit',
  'kredivo.com.vn': 'Kredivo',
  'kredivo.vn': 'Kredivo',
};

/** The four classes above in match order, with the `senderKind` each carries. */
const NON_BANK_GROUPS = [
  [WALLETS, 'wallet'], [GATEWAYS, 'gateway'], [BROKERS, 'broker'], [LENDERS, 'lender'],
];

/** Merchant RECEIPT senders — the third kind, `'receipt'`.
 *
 * A Grab or Shopee mail is not a bank notice and not a wallet debit: it is the
 * merchant's own account of a purchase that a bank or wallet mail ALSO reports
 * (the card was charged; the ví was debited). Staging it as a transaction would
 * double-count, so a row from one of these senders carries
 * `raw_extracted.txn_source = 'receipt'` (stage.mjs) and the client JOINS it to
 * the bank/wallet row — memo, items, the tree node — instead of importing it.
 *
 * NOT IN THE GMAIL QUERY YET. Every domain here is also a marketing firehose
 * (the same `shopee.vn` sends "Flash sale 9.9" from a sibling address), and the
 * query has no subject/label term that separates receipts from campaigns
 * reliably across all seven — Grab titles receipts "Your Grab E-Receipt", Shopee
 * "Đơn hàng ... đã được xác nhận", Apple "Your receipt from Apple.", and each has
 * changed wording before. Fetching them unfiltered would spend the per-run
 * staging cap and model budget on campaigns (see PROMO_TOKENS). So they live in
 * `RECEIPT_DOMAINS`, exported and deliberately left out of `inboxQuery`; the
 * receipt-join feature adds them to the query WITH a per-sender subject filter
 * when it lands. `match` already recognises them, so a forwarded receipt (transport
 * A) and the dry-run tooling stage with the right kind today.
 *
 * Kept small on purpose, and only the domain that actually SENDS the receipt
 * (checked against each domain's SPF on 2026-09-20):
 *   grab.com       no-reply@grab.com — ride + GrabFood e-receipts
 *   shopeefood.vn  order confirmations (own IPs + SendGrid/Mailgun in SPF)
 *   shopee.vn      order/delivery confirmations (noreply@ / info.shopee.vn)
 *   foody.vn       Foody/ShopeeFood legacy receipt sender (shares ShopeeFood's IPs)
 *   apple.com      no_reply@email.apple.com — App Store / iCloud receipts
 *                  (a subdomain, so the dot-boundary rule matches it)
 *   tiki.vn        order confirmations
 *   lazada.vn      order confirmations (own IPs + Alibaba mail in SPF) */
const RECEIPTS = {
  'grab.com': 'Grab',
  'shopeefood.vn': 'ShopeeFood',
  'shopee.vn': 'Shopee',
  'foody.vn': 'Foody',
  'apple.com': 'Apple',
  'tiki.vn': 'Tiki',
  'lazada.vn': 'Lazada',
};

/** The receipt sender domains, for the receipt-join feature to put in the
 *  query once it has a subject filter per sender. Not read by inboxQuery. */
export const RECEIPT_DOMAINS = Object.keys(RECEIPTS);

/** The address inside a From header, lower-cased. `"MB" <no-reply@mb.vn>`. */
export function addressOf(fromHeader) {
  const s = String(fromHeader || '');
  const angled = s.match(/<([^>]+)>/);
  return (angled ? angled[1] : s).trim().toLowerCase();
}

/** The domain part of an address. */
export function domainOf(address) {
  const at = String(address || '').lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase();
}

/**
 * THE SENDER GATE (2026-09-22, email-reading-v2 §7 R18).
 *
 * The Gmail query is `from:<bank domain>`, and a bank's domain is also where
 * its EMPLOYEES have their mailboxes. On 2026-09-16 one backfill read the
 * private correspondence of about 26 bank staff (relationship managers, loan
 * officers): all 50 mails went to the model, and their hand-written subjects,
 * names and phone numbers included, were cached in plaintext in a table every
 * family shares. `match` cannot tell the two apart, because the domain is
 * genuinely the bank's.
 *
 * The local part can. A bank's systems send from a ROLE (`info`, `no-reply`,
 * `mbebanking`, `myvib.info`); a person sends from `firstname.lastname`. So a
 * person-shaped address is: not a free-mail domain, two to five dot-separated
 * runs of letters (the first may end in digits: `an2.nguyen`), and NO role
 * word among them.
 *
 * What the gate does with the answer lives in extract.mjs: the free local
 * tiers still read such a mail (a real notice from an odd address is not
 * lost), but it is never sent to the model and never cached.
 *
 * EVERY role address this repo has seen is pinned in
 * pipeline/sender-gate.test.js. A bank that ever sends notices from a
 * person-shaped address would be read by the free tiers only; the symptom is
 * a `personal_sender` count in read_tally, which is why it has its own stage.
 */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.vn', 'ymail.com',
  'outlook.com', 'outlook.com.vn', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'zoho.com', 'mail.com', 'gmx.com', 'yandex.com',
]);

/** Words that make a local part a ROLE, matched as a WHOLE token between dots,
 *  dashes or underscores (never as a substring: "bankole" is a surname). Brand
 *  tokens are here because banks compose them (`hsbc.vietnam@`, `myvib.info@`). */
const ROLE_WORDS = new Set([
  'info', 'support', 'service', 'services', 'noreply', 'reply', 'card',
  'cardcenter', 'center', 'alert', 'alerts', 'ebanking', 'notification',
  'news', 'marketing', 'loyalty', 'cskh', 'statement', 'estatement', 'bank',
  'admin', 'system', 'myvib', 'vietnam', 'mbebanking', 'vcbdigibank', 'tpbank',
  'hsbc',
]);

const PERSON_LOCAL_RE = /^[a-z]+\d*(\.[a-z]+){1,4}$/;

/** A personal mailbox provider: someone hand-forwarding one receipt from their
 *  own Gmail. Takes an address or a whole From header. */
export function isFreeMail(address) {
  return FREE_MAIL.has(domainOf(addressOf(address)));
}

/** Does this address belong to a person rather than to a system? */
export function isPersonShaped(address) {
  const a = addressOf(address);
  const at = a.lastIndexOf('@');
  if (at <= 0) return false;
  if (isFreeMail(a)) return false;
  const local = a.slice(0, at);
  if (!PERSON_LOCAL_RE.test(local)) return false;
  for (const token of local.split(/[._-]/)) {
    if (ROLE_WORDS.has(token.replace(/\d+$/, ''))) return false;
  }
  return true;
}

/**
 * True when `domain` is `parent` or a subdomain of it.
 *
 * The dot boundary is the whole check. Without it `momo.vn.evil.com` contains
 * `momo.vn` and a lookalike domain reads as the real provider.
 */
export function domainMatches(domain, parent) {
  if (!domain || !parent) return false;
  return domain === parent || domain.endsWith('.' + parent);
}

/**
 * What this sender is, or null when we do not read it.
 *
 * @param {string} fromHeader  the raw From header
 * @param {Array<{domain_or_address: string, provider_name: string}>} [extra]
 *        rows from known_provider_domains, unioned in as banks when present.
 *        The table is empty today and this worker does not depend on it; it is
 *        read so that seeding it later widens both transports at once.
 * @return {{provider: string, kind: 'bank'|'wallet'|'receipt', senderKind: string}|null}
 *
 * TWO KINDS, AND THE COARSE ONE IS LOAD-BEARING. `kind` is the three-value
 * answer every caller has always switched on (stage.mjs derives the sealed
 * `transaction_type` from it; ingest.mjs compares it to 'bank'), and a gateway,
 * a broker and a lender all still answer 'wallet' there, exactly as they did
 * inside the old WALLETS group. `senderKind` is the finer class (contract.mjs
 * SENDER_KINDS) that picks the prompt block and is sealed as `sender_kind` on a
 * v2 row. Widening `kind` itself would have changed what existing rows' dedup
 * sees; adding a key changes nothing for anyone who does not read it.
 */
export function match(fromHeader, extra) {
  const address = addressOf(fromHeader);
  const domain = domainOf(address);
  if (!domain) return null;

  for (const [d, provider] of Object.entries(BANKS)) {
    if (domainMatches(domain, d)) return { provider, kind: 'bank', senderKind: 'bank' };
  }
  for (const [group, senderKind] of NON_BANK_GROUPS) {
    for (const [d, provider] of Object.entries(group)) {
      if (domainMatches(domain, d)) return { provider, kind: 'wallet', senderKind };
    }
  }
  for (const [d, provider] of Object.entries(RECEIPTS)) {
    if (domainMatches(domain, d)) return { provider, kind: 'receipt', senderKind: 'receipt' };
  }
  for (const row of extra || []) {
    const d = String(row.domain_or_address || '').toLowerCase();
    if (!d) continue;
    // A row may name a full address rather than a domain, which is why the
    // address is compared too.
    if (address === d || domainMatches(domain, d)) {
      return { provider: row.provider_name || d, kind: 'bank', senderKind: 'bank' };
    }
  }
  return null;
}

/**
 * The Gmail search query for one poll.
 *
 * `from:` terms only. This is the restraint described at the top of the file,
 * and it is the reason the query is built in one place: a caller assembling its
 * own would be one edit away from fetching the whole mailbox.
 *
 * `newer_than` bounds an ordinary poll. The first poll of a mailbox passes a
 * wider window on purpose (backfill), which is the one product difference direct
 * read buys over forwarding.
 */
/** Address tokens that mean "this is a campaign, not a receipt".
 *
 *  Excluded at the QUERY, which is the only place that saves anything real. A
 *  promotional mail that reaches us costs a `messages.get`, a slot in the
 *  per-run staging cap, and — until a sender-wide sentinel exists for it — a
 *  model call. The slot is the expensive one: during a backfill, marketing mail
 *  literally crowds out the transactions the run was for.
 *
 *  THESE TWO ONLY, AND ON EVIDENCE RATHER THAN ON HOW THEY READ. Across every
 *  sender this pipeline has ever classified, `marketing` and `promotion`
 *  addresses produced 58 junk subjects and NOT ONE transaction. The tempting
 *  neighbours are exactly the trap: `info.vietcombank.com.vn` reads just as
 *  promotional and is Vietcombank's real transactional address with six
 *  transactions behind it, and `card.` and `myvib.` are likewise live. A
 *  prefix list assembled by intuition would have silently dropped a bank.
 *
 *  FAILING THIS WAY IS SILENT, so the bar for adding a token is a sender that
 *  has produced many junk subjects and zero transactions — a mail we never
 *  fetch cannot appear as skipped, unreadable, or anything else. If a bank ever
 *  does send receipts from such an address, the symptom is transactions that
 *  never arrive, with nothing anywhere pointing here. */
export const PROMO_TOKENS = ['marketing', 'promotion'];

/** How many learned sender skips may ride in one query (2026-09-15).
 *
 *  A skip in the QUERY is the only free skip: the mail is never listed, so it
 *  never costs a 20-unit fetch to be told what the cache already knows. The cap
 *  exists because the query is a URL: one noisy mailbox must not be able to
 *  grow it without bound. */
export const SKIP_MAX = 25;

export function inboxQuery(days, extra, opts) {
  // RECEIPT_DOMAINS are deliberately absent — see the note above RECEIPTS.
  const domains = [
    ...Object.keys(BANKS),
    ...NON_BANK_GROUPS.flatMap(([group]) => Object.keys(group)),
    ...(extra || []).map(r => String(r.domain_or_address || '').toLowerCase()).filter(Boolean),
  ];
  const uniq = [...new Set(domains)];
  const from = '(' + uniq.map(d => 'from:' + d).join(' OR ') + ')';
  // Deliberately NOT scoped to the inbox label: a bank mail auto-filtered into a
  // folder is still a transaction, and a user who files their mail would
  // otherwise see nothing appear with no way to tell why.
  /* `-from:marketing` matches the whole From header, so one term covers every
     domain in the list at once — `card@marketing.vib.com.vn` and
     `marketing@promotion.vib.com.vn` alike. Enumerating the subdomain of each
     of the 157 domains instead would multiply the query by three for the same
     effect. */
  const notPromo = PROMO_TOKENS.map(t => ' -from:' + t).join('');
  /* Senders we have LEARNED never send transactions (2026-09-15). Only
     whole-sender verdicts for senders with no parse shape of their own reach
     this — `db.skipSenders` enforces that — so excluding them here cannot hide
     a real transaction. Addresses only: anything with whitespace would break
     the query rather than narrow it. */
  const skips = [...new Set(((opts && opts.skip) || [])
    .map(a => String(a || '').trim().toLowerCase())
    .filter(a => a && a.indexOf(' ') < 0 && a.indexOf('"') < 0))].slice(0, SKIP_MAX);
  const notSkipped = skips.map(a => ' -from:' + a).join('');
  return from + notPromo + notSkipped + ' newer_than:' + Math.max(1, Math.floor(days)) + 'd';
}

/* `WALLETS` here is still EVERY non-bank, non-receipt domain, as it was before
   the split: tools/pull-mail-corpus.mjs and tools/scoreboard/run.mjs walk these
   groups to know which domains the registry covers, and a caller reading
   KNOWN_DOMAINS.WALLETS must not silently lose the brokers and lenders. The
   finer groups ride beside it. */
export const KNOWN_DOMAINS = {
  BANKS,
  WALLETS: Object.assign({}, ...NON_BANK_GROUPS.map(([group]) => group)),
  RECEIPTS,
  GATEWAYS, BROKERS, LENDERS,
  EWALLETS: WALLETS,
};

/* One display name per provider, whoever wrote it down.

   source_provider has three authors — the model's free text per mail, template
   statics frozen at derivation ("MB" one day, "MBank" another; both were live),
   and this registry's fallback ("MB Bank") — and nothing ever unified them, so
   the same bank surfaced as three sources. The registry's own names are the
   canon; everything else folds into them by a noise-stripped key, with an alias
   row for the stumps the stripping leaves ("mbank" → "m"). Unknown names pass
   through untouched: folding a bank we do not know into one we do would merge
   real sources, which is worse than the cosmetic split this cures. */
function _provKey(name) {
  let s = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const noise of ['ebanking', 'digibank', 'banking', 'bank']) s = s.split(noise).join('');
  return s;
}
const _PROV_CANON = (() => {
  const map = {};
  for (const name of new Set([...Object.values(BANKS), ...NON_BANK_GROUPS.flatMap(([group]) => Object.values(group))])) {
    map[_provKey(name)] = name;
  }
  Object.assign(map, {
    m: 'MB Bank', vcb: 'Vietcombank', tcb: 'Techcombank', vtb: 'VietinBank',
  });
  return map;
})();
export function canonProviderName(name) {
  if (!name) return name;
  return _PROV_CANON[_provKey(name)] || String(name).trim();
}
