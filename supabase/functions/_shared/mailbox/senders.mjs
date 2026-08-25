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

/** Vietnamese banks. Domain → the provider name a staged row carries. */
const BANKS = {
  'vietcombank.com.vn': 'Vietcombank',
  'vietinbank.vn': 'VietinBank',
  'bidv.com.vn': 'BIDV',
  'agribank.com.vn': 'Agribank',
  'techcombank.com.vn': 'Techcombank',
  'mbbank.com.vn': 'MB Bank',
  'vpbank.com.vn': 'VPBank',
  'acb.com.vn': 'ACB',
  'sacombank.com.vn': 'Sacombank',
  'sacombank.com': 'Sacombank',
  'hdbank.com.vn': 'HDBank',
  'vib.com.vn': 'VIB',
  'tpb.com.vn': 'TPBank',
  'shb.com.vn': 'SHB',
  'seabank.com.vn': 'SeABank',
  'ocb.com.vn': 'OCB',
  'msb.com.vn': 'MSB',
  'lpbank.com.vn': 'LPBank',
  'eximbank.com.vn': 'Eximbank',
  'eib.com.vn': 'Eximbank',
  'namabank.com.vn': 'Nam A Bank',
  'abbank.vn': 'ABBANK',
  'baca-bank.vn': 'BacABank',
  'pvcombank.com.vn': 'PVcomBank',
  'scb.com.vn': 'SCB',
  'vietbank.com.vn': 'VietBank',
  'kienlongbank.com': 'KienlongBank',
  'saigonbank.com.vn': 'SaigonBank',
  'baovietbank.vn': 'BaoViet Bank',
  'vietabank.com.vn': 'VietABank',
  'cake.vn': 'Cake',
  'timo.vn': 'Timo',
};

/** Wallets and payment processors. The other half of a cross-source pair. */
const WALLETS = {
  'momo.vn': 'MoMo',
  'zalopay.vn': 'ZaloPay',
  'vnpay.vn': 'VNPAY',
  'shopeepay.vn': 'ShopeePay',
  'viettelpay.vn': 'ViettelPay',
  'payoo.vn': 'Payoo',
  'napas.com.vn': 'NAPAS',
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
  return from + ' newer_than:' + Math.max(1, Math.floor(days)) + 'd';
}

export const KNOWN_DOMAINS = { BANKS, WALLETS };
