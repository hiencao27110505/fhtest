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

/** Wallets, payment services, securities houses and consumer finance.
 *
 * Everything here is `ecommerce_receipt`, never `bank_txn`, and that is not
 * cosmetic: the client's bank-vs-bank dedup rule reads the kind, and its job is
 * to STOP a dedup. Calling a wallet a bank feeds that rule a claim we cannot
 * support and lets a genuine duplicate through. Securities and BNPL sit here for
 * the same reason — they do confirm by mail, but a trade confirmation is not a
 * bank debit. */
const WALLETS = {
  '9pay.com.vn': '9Pay',
  '9pay.vn': '9Pay',
  'airpay.vn': 'ShopeePay',
  'alepay.vn': 'Alepay',
  'appotapay.com': 'AppotaPay',
  'appotapay.com.vn': 'AppotaPay',
  'appotapay.vn': 'AppotaPay',
  'baokim.com.vn': 'Baokim',
  'baokim.vn': 'Baokim',
  'dnse.com.vn': 'DNSE',
  'dnse.vn': 'DNSE',
  'fecredit.com.vn': 'FE Credit',
  'fecredit.vn': 'FE Credit',
  'finhay.com.vn': 'Finhay',
  'finhay.vn': 'Finhay',
  'finviet.com.vn': 'FinViet',
  'finviet.vn': 'FinViet',
  'fundiin.vn': 'Fundiin',
  'gpay.com.vn': 'GPay',
  'gpay.vn': 'GPay',
  'hdsaison.com.vn': 'HD SAISON',
  'homecredit.com.vn': 'Home Credit',
  'homecredit.vn': 'Home Credit',
  'hsc.com.vn': 'HSC',
  'hsc.vn': 'HSC',
  'infina.com.vn': 'Infina',
  'infina.vn': 'Infina',
  'kredivo.com.vn': 'Kredivo',
  'kredivo.vn': 'Kredivo',
  'mbs.com.vn': 'MBS',
  'mbs.vn': 'MBS',
  'miraeasset.com.vn': 'Mirae Asset',
  'moca.vn': 'Moca',
  'momo.com.vn': 'MoMo',
  'momo.vn': 'MoMo',
  'mservice.com.vn': 'MoMo',
  'mservice.vn': 'MoMo',
  'napas.com.vn': 'NAPAS',
  'nganluong.vn': 'NganLuong',
  'onepay.com.vn': 'OnePay',
  'onepay.vn': 'OnePay',
  'payoo.com.vn': 'Payoo',
  'payoo.vn': 'Payoo',
  'shopeepay.vn': 'ShopeePay',
  'smartpay.com.vn': 'SmartPay',
  'smartpay.vn': 'SmartPay',
  'ssi.com.vn': 'SSI',
  'ssi.vn': 'SSI',
  'tcbs.com.vn': 'TCBS',
  'vcbs.com.vn': 'VCBS',
  'vcbs.vn': 'VCBS',
  'viettelmoney.com.vn': 'ViettelPay',
  'viettelmoney.vn': 'ViettelPay',
  'viettelpay.com.vn': 'ViettelPay',
  'viettelpay.vn': 'ViettelPay',
  'vndirect.com.vn': 'VNDIRECT',
  'vndirect.vn': 'VNDIRECT',
  'vnpay.com.vn': 'VNPAY',
  'vnpay.vn': 'VNPAY',
  'vnptmoney.com.vn': 'VNPT Money',
  'vnptmoney.vn': 'VNPT Money',
  'vnptpay.vn': 'VNPT Money',
  'vps.com.vn': 'VPS',
  'vps.vn': 'VPS',
  'zalopay.com.vn': 'ZaloPay',
  'zalopay.vn': 'ZaloPay',
};

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
 * @return {{provider: string, kind: 'bank'|'wallet'}|null}
 */
export function match(fromHeader, extra) {
  const address = addressOf(fromHeader);
  const domain = domainOf(address);
  if (!domain) return null;

  for (const [d, provider] of Object.entries(BANKS)) {
    if (domainMatches(domain, d)) return { provider, kind: 'bank' };
  }
  for (const [d, provider] of Object.entries(WALLETS)) {
    if (domainMatches(domain, d)) return { provider, kind: 'wallet' };
  }
  for (const row of extra || []) {
    const d = String(row.domain_or_address || '').toLowerCase();
    if (!d) continue;
    // A row may name a full address rather than a domain, which is why the
    // address is compared too.
    if (address === d || domainMatches(domain, d)) {
      return { provider: row.provider_name || d, kind: 'bank' };
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

export function inboxQuery(days, extra) {
  const domains = [
    ...Object.keys(BANKS),
    ...Object.keys(WALLETS),
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
  return from + notPromo + ' newer_than:' + Math.max(1, Math.floor(days)) + 'd';
}

export const KNOWN_DOMAINS = { BANKS, WALLETS };
