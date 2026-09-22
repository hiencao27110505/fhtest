/**
 * The label-table reader: deterministic extraction for the mail shape that
 * Vietnamese banks actually send.
 *
 * Every transaction notice we have ever seen from a VN bank — MB's tap and
 * transfer notices, Vietcombank's card alerts and biên lai, and their peers —
 * renders as a two-column label/value table. The labels come from a small,
 * stable, bilingual vocabulary ("Số tiền / Amount", "Điểm giao dịch",
 * "Ngày, giờ giao dịch / Trans. Date, Time"); only the values change per mail.
 *
 * Until now that structure was rediscovered the expensive way: the first mails
 * from each (sender, subject) shape went to the model, and a per-shape regex
 * template was derived from its answers. This module reads the structure
 * DIRECTLY: parse the table, look the labels up, normalise the values. No
 * learning phase, no model call, and a bank we have never seen works on its
 * first mail.
 *
 * Where it sits (extract.mjs): after the stored template (which is still the
 * cheapest path), before the model. It returns null unless the mail yields the
 * fields a ledger row cannot exist without — amount, a date-time, and someone
 * on the other side — so anything ambiguous still gets the model's judgement.
 * The confidence gate is the safety argument: marketing mail does not carry
 * an amount row AND a transaction-timestamp row in table form, and a mail that
 * does is a transaction notice by construction.
 *
 * Deliberately NOT handled here: memo boilerplate ("X chuyen tien"), merchant
 * aggregator prefixes, category. Those belong to the tidy layer and the
 * client, which already own them for the other two tiers.
 */

import { htmlRows } from './htmltable.mjs';

/** One label vocabulary, Vietnamese-first with the English twins the bilingual
 *  banks append. Matched against a diacritic-stripped, lowercased label cell,
 *  by CONTAINS — VCB writes "Số tiền Transaction Amount" as one cell. Order
 *  matters where vocabularies overlap: the first hit wins, so the more specific
 *  entry sits above the generic one ("số tiền phí" must never read as amount).
 *  Three match modes per entry: `any` (contains), `whole` (contains, at word
 *  boundaries) and `exact` (the whole label is the key); see _lookup. */
const LABELS = [
  /* A PRINTED FEE, captured AND absorbed (email-reading-v2 §4, 2026-09-22).
     These keys used to sit in the absorber below, so a fee could never be read
     as the amount, and that guarantee stands: this row sits above `amount` for
     the same reason. What changed is that the value is no longer thrown away.
     VIB prints "Phí (bao gồm VAT)" on every transfer (283 of the 955-mail test
     set) and "Phí giao dịch (bao gồm VAT)" on every card repayment; the ledger
     holds a fee as its own small expense row (full-ledger-spec §3.4). A fee of
     zero parses as null, which is the honest reading of "0 ₫". */
  { field: 'fee',          any: ['so tien phi', 'charge amount'],
                           whole: ['phi (bao gom vat)', 'phi giao dich', 'phi dich vu', 'transaction fee'] },
  /* The absorber row. Sits ABOVE amount so that any "số tiền …" variant that
     is NOT the transaction amount — fees, promo/cashback figures, reward
     points, and the FX rate on an international card notice — is swallowed
     here instead of contains-matching into `amount`. Found by a test fixture:
     "Số tiền khuyến mãi" read as the amount; "Tỷ giá quy đổi" would have
     turned an exchange RATE into a transaction amount the same way. */
  { field: 'charge',       any: ['loai phi', 'ty gia', 'charge code',
                                 'khuyen mai', 'so tien hoan', 'cashback', 'diem thuong', 'tich diem'] },
  /* What a CARD still has to spend. Above `balance` and `amount` alike: it is
     a figure, and neither of those. */
  { field: 'limit',        whole: ['han muc kha dung', 'han muc con lai', 'available limit', 'available credit'] },
  /* The converted/billed VND figure an international card notice prints beside
     its foreign transaction amount ("Số tiền quy đổi: 2.923.000 VND"). Above
     `amount` because every key here contains "số tiền" and would be swallowed
     by amount's contains-match. When the mail is foreign-denominated this is
     the number that actually left the account — the bank's own settled
     conversion — so readLabelTable prefers it over the foreign figure. */
  { field: 'converted',    any: ['so tien quy doi', 'so tien ghi no', 'so tien thanh toan',
                                 'billed amount', 'billing amount', 'converted amount'], whole: ['gia tri quy doi'] },
  /* 'gia tri' is VIB's credit-card notice ("Giá trị: 45,000 VND"), the largest
     format in the test set that no local tier could read: 341 mails. */
  { field: 'amount',       any: ['so tien giao dich', 'so tien', 'transaction amount', 'amount'],
                           whole: ['gia tri giao dich', 'gia tri', 'transaction value'] },
  /* An explicit currency row ("Loại tiền: USD"). Some banks denominate the
     amount cell bare and state the currency here instead — without this row
     a USD notice whose amount cell prints no token reads as VND. */
  { field: 'currency_row', any: ['loai tien te', 'loai tien', 'don vi tien te'] },
  /* 'ngay giao dich' is VIB's date label, and its plainness is why it was
     missed: every other entry here carries a "giờ" or a comma, so VIB's form
     matched nothing and its mail could never satisfy the amount+instant+
     counterpart gate below — it went to the model every single time, 801
     recorded misses from one sender. Contains-matching keeps this additive:
     "ngay, gio giao dich" does not contain "ngay giao dich".
     'thoi gian' is EXACT, never contains: MoMo's cinema receipt prints "Thời
     gian chiếu" (the SHOWTIME) and a statement mail prints "Thời gian sao kê",
     and either would have become the transaction's moment. */
  { field: 'occurred_at',  any: ['ngay, gio giao dich', 'ngay gio giao dich', 'ngay giao dich', 'trans. date', 'date, time', 'thoi gian giao dich'],
                           whole: ['vao luc'], exact: ['thoi gian'] },
  /* 'nha cung cap' is the biller on a QR bill payment; 'tai' ALONE is the
     no-colon merchant line of VIB's card notice ("Tại SHOP NAME"), which _rows
     only ever emits from inside an inline block. Exact, so "Tại ngân hàng"
     (the beneficiary's bank, below) is untouched. */
  { field: 'merchant',     any: ['diem giao dich', 'su dung tai', 'merchant'], whole: ['nha cung cap'], exact: ['tai'] },
  /* WHERE the other side banks. These two keys sat under `beneficiary` until
     2026-09-22, which put a bank's name where a person's belongs. Above
     `beneficiary` because "Tên ngân hàng hưởng" would otherwise never get here.
     A mail whose ONLY counterpart is this row (VIB's card repayment: the issuer
     is who was paid) still reads: readLabelTable falls back to it. */
  { field: 'cp_bank',      any: ['ngan hang huong', 'ten ngan hang'],
                           whole: ['ngan hang thu huong', 'tai ngan hang', 'beneficiary bank'] },
  /* The other side's ACCOUNT, where the bank gives it a row of its own (VCB's
     "Tài khoản người hưởng"). Above `account`: "so tai khoan nguoi huong"
     contains 'so tai khoan' and would be read as the person's OWN account. */
  { field: 'cp_account',   whole: ['so tai khoan nguoi huong', 'tai khoan nguoi huong', 'tai khoan thu huong',
                                   'tai khoan huong', 'tai khoan nhan', 'credit account', 'beneficiary account'] },
  /* 'den tai khoan' is a JUDGEMENT, not a synonym. On a VIB transfer notice the
     destination-account row is where the counterparty's NAME is printed, so it
     answers "who", which is what this field means. It sits here rather than in
     `account` below deliberately — first field wins, and reading it as an
     account would drop the counterparty from the row entirely. If a bank ever
     prints a bare number there, counterparty becomes a number: visible in
     review and correctable, never silent. The cell is "ACCOUNT - NAME" on all
     269 VIB transfers in the test set, so the account half is ALSO read out of
     it, as counterparty_account_tail (_accountInsideWho). */
  { field: 'beneficiary',  any: ['ten nguoi huong', 'nguoi thu huong', 'den tai khoan', 'beneficiary name'] },
  { field: 'remitter',     any: ['ten nguoi chuyen', "remitter's name", 'remitter'] },
  /* 'dien giai' is VIB's memo label: 364 sightings in the test set, none read. */
  { field: 'memo',         any: ['noi dung chuyen tien', 'noi dung', 'details of payment'], whole: ['dien giai'] },
  /* What was bought, on a bill payment ("Hàng hóa/dịch vụ"). It becomes the
     memo only when the mail has no memo row of its own. */
  { field: 'item',         whole: ['hang hoa/dich vu', 'hang hoa dich vu', 'hang hoa / dich vu'] },
  /* The customer's OWN name as the mail prints it. Own-name detection needs it
     (signals.mjs: `self` is letter-for-letter equality with the counterparty),
     and until now it was guessed out of the debit-account cell. Above `card`,
     whose bare 'the' is start-anchored and would not take "Chủ thẻ" anyway. */
  { field: 'holder',       whole: ['ten chu the', 'chu the', 'chu tai khoan', 'cardholder', 'account holder'] },
  { field: 'account',      any: ['tai khoan trich no', 'tai khoan ghi no', 'tai khoan nguon', 'so tai khoan', 'tu tai khoan', 'debit account', 'tk cham'] },
  { field: 'reference',    any: ['so lenh giao dich', 'so tham chieu', 'so giao dich', 'order number', 'ma giao dich', 'reference number', 'transaction number'],
                           whole: ['so hoa don'] },
  { field: 'status',       any: ['tinh trang', 'trang thai', 'status'] },
  { field: 'balance',      any: ['so du', 'balance'] },
  /* 'giao dich' ALONE is VIB's card-notice kind row ("Giao dịch: Thanh toán
     dịch vụ - hàng hóa"). Exact: as a contains-key it would be every label in
     this file. */
  { field: 'txn_kind',     any: ['loai giao dich', 'transaction type'], exact: ['giao dich'] },
  /* The credit card a payment/repayment mail names — emitted as `card_masked`
     (card-repayment-routing-spec.md), so the review screen can pre-select which
     card a "Trả nợ thẻ" pays off. Repayment phrasings first; the bare 'the'
     stays start-anchored (see _lookup) so it can't eat a merchant name. This
     row sits LAST, so a value already claimed by account/beneficiary/amount is
     never re-read as a card. */
  { field: 'card',         any: ['so the tin dung', 'the tin dung so', 'the duoc thanh toan',
                                 'the thanh toan', 'so the', 'the card', 'the'] },
];

function _strip(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The two text forms one mail can arrive in:
 *
 *  PRODUCTION (mailtext.mjs): every HTML table cell becomes its own LINE, so a
 *  field is a label line followed by its value line — that is the layout the
 *  stored templates anchor on ("Số tiền\\s*\\n\\s*…"), and the one this reader
 *  must speak first.
 *
 *  PIPE TABLES: Gmail's own text/plain rendering (and some forwarding paths)
 *  keeps rows as `| Label | Value |`. Supporting both means the tier reads the
 *  mail wherever it was flattened — and a fixture captured from either source
 *  exercises the same reader.
 *
 *  Rows with more cells than two (VCB's merged fee row) are exactly the ones
 *  whose meaning is NOT one label + one value, so they are skipped, not
 *  guessed at. In line form, a label line whose next line is itself a label is
 *  a field the bank left empty. */
function _rows(body, learned) {
  const out = [];
  let inlineRun = false;   // the previous row was an inline one: see the "Tại" rule
  const lines = String(body || '').split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2) out.push({ label: cells[0], value: cells[1] });
      else if (cells.length === 1 && _lookup(cells[0], learned) && lines[i + 1]) {
        // piped label with its value on the following line
        const next = lines[i + 1].split('|').map((c) => c.trim()).filter(Boolean);
        if (next.length === 1 && !_lookup(next[0], learned)) { out.push({ label: cells[0], value: next[0] }); i++; }
      }
      continue;
    }
    /* INLINE FORM: "Label: value" on ONE line (2026-09-22). VIB's credit-card
       notice is not a table at all: five `<div>Số thẻ:<b>…</b></div>` lines,
       341 mails in the 955-mail test set, and until now every one of them went
       to the model, because each line looked like a label whose "value" (the
       next line) was another label. A line counts only when the part BEFORE THE
       FIRST COLON resolves through the vocabulary, so prose with a colon in it
       ("Hotline: 1800…", "Lưu ý: …") is not a row. Checked before the line
       form, which would otherwise claim the same line as a bare label. */
    const inl = _inline(line, learned);
    if (inl) { out.push(inl); inlineRun = true; continue; }
    /* ...and that notice's merchant line, which has no colon: "Tại SHOP NAME",
       directly under the inline block. Only there: "tại" opens ordinary
       sentences everywhere else in a mail. */
    if (inlineRun) {
      const at = line.match(/^(T[ạa]i)\s+(\S.*)$/i);
      if (at && line.length <= MAX_LABEL_LEN && !_isProse(line) && !_lookup(line, learned)) {
        out.push({ label: at[1], value: at[2].trim(), form: 'inline' });
        continue;
      }
      inlineRun = false;
    }
    // line form: a known label, value on the next non-empty line
    if (_lookup(line, learned)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      /* BILINGUAL LABELS ARRIVE AS TWO LINES. VCB writes one cell as
         "Sử dụng tại<br>At" — Vietnamese label, English twin — and every block
         tag becomes a newline (mailtext.mjs), so the twin lands where the value
         should be. Taking it blind made every VCB card row's merchant read
         "At" instead of AEON MALL: a real name replaced by a preposition.

         _lookup cannot catch it, because it matches by CONTAINS and "at" is
         not a substring of any Vietnamese label. So the twins are named
         explicitly and skipped, exactly — never by a heuristic like "short and
         alphabetic", which would eat "AEON" and "Circle K" too. */
      while (j < lines.length && _isEnglishTwin(lines[j])) {
        j++;
        while (j < lines.length && !lines[j]) j++;
      }
      const val = (lines[j] || '').replace(/^\|/, '').replace(/\|$/, '').trim();
      /* A "value" that still contains a pipe is a TABLE ROW, not a value — a
         label that swallows one consumes somebody else's data. Leave it for
         the pipe-form branch on its own turn. */
      /* ...and a "value" that is the mail's SIGN-OFF is an empty field. VIB
         prints "Diễn giải" with nothing under it on every card repayment, and
         the next line is "Cảm ơn Quý khách đã sử dụng dịch vụ…": once the
         vocabulary knew that label, the courtesy line became the memo. */
      if (val && !val.includes('|') && !_lookup(val, learned) && !_isSignOff(val)) { out.push({ label: line, value: val }); i = j; }
    }
  }
  return out;
}

/* "Label: value" on one line, or null. The label half must be short and must
   resolve; the value half must exist and must not be a bare English twin
   ("Số tiền: Amount" is a bilingual LABEL whose value is on the next line). */
const MAX_INLINE_LABEL_LEN = 40;
function _inline(line, learned) {
  const at = line.indexOf(':');
  if (at <= 0 || at > MAX_INLINE_LABEL_LEN) return null;
  const label = line.slice(0, at).trim();
  const value = line.slice(at + 1).trim();
  if (!label || !value || _isEnglishTwin(value)) return null;
  if (!_lookup(label, learned)) return null;
  return { label, value, form: 'inline' };
}

/* How a bank mail's body ends, where a field's value would be. Matched at the
   START of the line, on the stripped form, so a memo that merely contains
   "cam on" ("cam on anh nhieu") is untouched. */
const _SIGN_OFF_RE = /^(?:cam on quy khach|xin cam on quy khach|xin cam on|tran trong|thank you for|hotline\b|quy khach vui long|day la email tu dong|day la thu tu dong|do not reply|this is an auto)/;
function _isSignOff(line) { return _SIGN_OFF_RE.test(_strip(line)); }

function _isProse(labelCell) {
  const padded = ' ' + _strip(labelCell) + ' ';
  for (const m of PROSE_MARKERS) if (padded.includes(m)) return true;
  return false;
}

/* The English halves of the bilingual labels VN banks print. Matched EXACTLY
   on the stripped form — a contains-match on 'at' or 'card' would swallow real
   merchant names. Additive: a twin missing from this list only reproduces the
   old behaviour for that one field, never a wrong value elsewhere. */
const ENGLISH_TWINS = new Set([
  'at', 'amount', 'transaction amount', 'card', 'merchant', 'balance', 'status',
  'trans. date, time', 'date, time', 'trans date time', 'transaction date',
  'debit account', 'credit account', 'account', 'account number',
  'status of transaction', 'beneficiary name', 'beneficiary bank name', 'transaction number',
  "remitter's name", 'remitters name', 'remitter', 'order number',
  'reference number', 'details of payment', 'content', 'transaction type',
  'charge code', 'charge amount', 'net income', 'vat', 'payment receipt',
  'currency', 'exchange rate', 'billed amount', 'billing amount', 'converted amount',
]);
function _isEnglishTwin(line) {
  return ENGLISH_TWINS.has(_strip(line));
}

/* A label CELL, not prose that happens to contain a label phrase.
 *
 * `includes()` alone matched the footer. Vietcombank signs off with "...liên hệ
 * với các điểm giao dịch của Vietcombank (trong giờ hành chính)", which contains
 * "điểm giao dịch" and was therefore read as a merchant row — putting
 * "Vietcombank (trong giờ hành chính)" into people's ledgers as the shop they
 * visited. Reported from a real queue.
 *
 * Two properties separate a label cell from a sentence, and both are needed:
 * a label is SHORT, and its phrase sits at or near the START. The footer fails
 * both (200+ characters, phrase 150 in); every real label passes both, including
 * the long bilingual ones like "Ngày, giờ giao dịch Trans. Date, Time". */
const MAX_LABEL_LEN = 80;   // the longest real bilingual label seen is 42
const MAX_KEY_START = 24;   // "MB TK chạm" puts its key at 3; prose puts it far in

/* Words that belong to sentences and never to a table label.

   A bank's footer is prose, and prose uses the same nouns the labels do. VCB
   closes with "liên hệ với các điểm giao dịch của Vietcombank (trong giờ hành
   chính)" — which contains "điểm giao dịch", so a contains-match reads it as
   the merchant label and takes the following line as the shop. That is where
   "Vietcombank (trong giờ hành chính)." came from on Trang's cards.

   MAX_LABEL_LEN alone does not catch it: mailtext breaks that sentence across
   lines, and the fragment carrying the noun ("các điểm giao dịch của") is
   short enough to pass a length cap while still being prose. So the two guards
   are complementary — length rejects the run-on clause, these markers reject
   the wrapped one. Both are needed; neither is sufficient. */
const PROSE_MARKERS = [' cua ', ' voi ', ' hoac ', ' cac ', ' den cac ', ' theo ',
  'lien he', 'quy khach', 'vui long', 'xin cam on', 'cam on', 'thank you', 'please '];

function _lookup(labelCell, learned) {
  const flat = _strip(labelCell);
  if (!flat || flat.length > MAX_LABEL_LEN) return null;
  const padded = ' ' + flat + ' ';
  for (const m of PROSE_MARKERS) if (padded.includes(m)) return null;
  for (const entry of LABELS) {
    /* EXACT keys first: a one-word label ("Tại", "Giao dịch", "Thời gian") that
       as a contains-key would be half the vocabulary. The colon an inline or
       line-form label may end with is not part of the word. */
    if (entry.exact && entry.exact.indexOf(flat.replace(/\s*:$/, '')) >= 0) return entry.field;
    /* WHOLE-WORD keys (2026-09-22): every key added since contains-matching
       was the only mode. "Ghi chú thêm" contains 'chu the', and as a contains-
       key that made a note field the cardholder's name. The older keys stay
       contains-matched, as they were measured; nothing new joins them. */
    for (const key of entry.whole || []) {
      const at = flat.indexOf(key);
      if (at < 0 || at > MAX_KEY_START) continue;
      const before = at === 0 ? ' ' : flat[at - 1];
      const after = at + key.length >= flat.length ? ' ' : flat[at + key.length];
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return entry.field;
    }
    for (const key of entry.any || []) {
      const at = flat.indexOf(key);
      /* The bare card key 'the' (thẻ, stripped) must match only at the START.
         As a contains-key it fired inside prose — "Thanh toán THE tin dung VIB
         thành công" — turning a mail's TITLE into a line-form label that then
         swallowed the next table row as its "value". Found by the learned-labels
         suite: the eaten row was the one it expected a vote from. 'so the'
         (Số thẻ) carries the real mid-string use as its own key. */
      if (key === 'the' && at !== 0) continue;
      if (at >= 0 && at <= MAX_KEY_START) return entry.field;
    }
  }
  /* LEARNED mappings (0111), consulted strictly AFTER the hand-authored
     vocabulary declined — hardcoded always wins, so learning can only EXTEND
     the reader, never override it. EXACT match on the stripped form, never
     contains: a learned entry earned trust for one string, not for every
     string containing it. An absent/empty map is byte-for-byte the old
     behaviour, which is the kill-switch contract `delete from learned_labels`
     relies on — pinned in pipeline/learned-labels.test.js. */
  if (learned && learned.size) {
    const f = learned.get(flat);
    if (f) return f;
  }
  return null;
}

/** The row field the hand-written vocabulary gives a label, or null. What a
 *  stored format is built from (formats.mjs): the vocabulary always maps first,
 *  and a label the model cites may only add what this does not know. */
export function vocabularyField(label, learned) {
  return _lookup(label, learned);
}

/* The English halves of the bilingual labels, as they appear ALONE on a line.
 *
 * Vietcombank's HTML puts "Sử dụng tại" and "At" in separate cells, so the
 * flattened text reads label / English-twin / value — and the reader took the
 * twin as the value, filing every card purchase with the merchant "At".
 *
 * Matched EXACTLY, never as a substring: a merchant genuinely called "AEON" is
 * four letters with no digits and would be indistinguishable from a twin under
 * any looser rule. Exact matching is what keeps a real short merchant name. */
const LABEL_TWINS = new Set([
  'at', 'card', 'amount', 'transaction amount', 'merchant', 'balance',
  'date, time', 'trans. date, time', 'status', 'status of transaction',
  'debit account', 'credit account', 'order number', 'reference number',
  'beneficiary name', "remitter's name", 'remitter', 'details of payment',
  'charge code', 'charge amount', 'transaction type',
  'currency', 'exchange rate', 'billed amount', 'billing amount', 'converted amount',
]);

/* The currencies a VN bank's international card notice actually prints.
 * ISO codes matched as WORDS (a substring match would find 'AUD' inside a
 * merchant name); the four symbols cover the banks that print "$111.00" with
 * no code at all. 'đ' and 'dong' are VND. FIRST occurrence wins, which is
 * also what makes a dual cell like "111 USD (2.923.000 VND)" read as the
 * foreign figure and "2.923.000 VND (111 USD)" read as the VND one — the
 * number the regex grabs is the first number, so the nearest token names it. */
const _CUR_WORD_RE = /\b(USD|EUR|GBP|AUD|SGD|JPY|CNY|KRW|THB|HKD|CHF|CAD|NZD|TWD|MYR|INR|VND)\b|(dong)/i;
const _CUR_SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };

/** The currency a cell's text names, as an ISO code, or null when it names
 *  none. Word beats symbol beats 'đ' — "US$" resolves via '$' either way. */
export function cellCurrency(raw) {
  const s = String(raw || '');
  const w = s.match(_CUR_WORD_RE);
  if (w) return w[2] ? 'VND' : w[1].toUpperCase();
  const sym = s.match(/[$€£¥]/);
  if (sym) return _CUR_SYMBOLS[sym[0]];
  if (/đ/.test(s)) return 'VND';
  return null;
}

/** A foreign-denominated number in the notations VN banks print them:
 *  "1,234.56" (US), "111.00", "1.234,56" (EU), "111". Decimals are KEPT —
 *  $12.99 is not $12 — which is the opposite of the VND rule below, where a
 *  decimal tail is print noise on a currency that has no cents. */
function _parseForeignNumber(digits) {
  if (/^\d+$/.test(digits)) return parseInt(digits, 10);
  if (/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(digits)) return parseFloat(digits.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(digits)) return parseFloat(digits.replace(/\./g, '').replace(',', '.'));
  if (/^\d+\.\d{1,2}$/.test(digits)) return parseFloat(digits);
  return null;
}

/** "-37,000 VND" | "(VND) 2,000.00" | "+15,000 VND" → { value, negative, sign, currency }.
 *  VN bank notation: comma groups thousands; a trailing .00 (or ,00) is decimals.
 *  `currency` is the ISO code the cell itself names, or null when it names
 *  none — the CALLER defaults, so a bare number stays distinguishable from an
 *  explicit "VND". A cell naming a foreign currency parses with decimals kept
 *  ($12.99 stays 12.99); stripping the "USD" token and reading the digits as
 *  VND is exactly how a $111 subscription once staged as 111đ.
 *  `sign` is THREE-valued on purpose (2026-09-22): '-' and '+' are what the
 *  bank printed, null is "it printed neither". `negative` alone folded the last
 *  two together, so an incoming "+5,000,000" and a bare "5,000,000" both read as
 *  "not negative" and the caller guessed debit for both. `negative` stays for
 *  the callers that only ever asked that one question. U+2212 is the minus some
 *  HTML mail prints instead of the ASCII hyphen.
 *  Returns null when the cell does not parse as one clean number. */
export function parseAmountCell(raw) {
  const currency = cellCurrency(raw);
  const s = String(raw || '').replace(/VND|đ|dong/gi, '').trim();
  const m = s.match(/([-+\u2212])?\s*([\d.,]+)/);
  if (!m) return null;
  const sign = m[1] ? (m[1] === '+' ? '+' : '-') : null;
  if (currency && currency !== 'VND') {
    const fv = _parseForeignNumber(m[2].replace(/[.,]+$/, ''));
    if (fv == null || !Number.isFinite(fv) || fv <= 0) return null;
    return { value: fv, negative: sign === '-', sign, currency };
  }
  let digits = m[2];
  // strip ONE decimal tail if present, then everything else is grouping
  digits = digits.replace(/[.,]\d{2}$/, '');
  digits = digits.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, negative: sign === '-', sign, currency };
}

/** The three date shapes these banks write, all Vietnam local time:
 *    2026-08-25 18:52:04          (MB card)
 *    26-08-2026 20:04:26          (MB transfer, VCB card — day first)
 *    11:11 Chủ Nhật 23/08/2026    (VCB biên lai — time, weekday, day first)
 *  → ISO string with the +07:00 the mails omit because they never leave VN. */
export function parseWhenCell(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${_hms(m[4])}+07:00`;
  m = s.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${_hms(m[4])}+07:00`;
  m = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s+.*?(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m) return `${m[4]}-${m[3]}-${m[2]}T${_hms(m[1])}+07:00`;
  return null;
}
function _hms(t) { return t.length === 5 ? t + ':00' : t.padStart(8, '0'); }

/** Keep the last four digits, drop the rest. Applied here AND in the tidy layer
 *  (so the older template path is covered too): the sealed box protects these
 *  bytes from everyone else, but a field named `masked` should not be the one
 *  place in the system holding a full account number. */
export function maskAccount(raw) {
  if (raw == null) return raw;
  const s = String(raw);
  const digits = s.replace(/\D/g, '');
  if (digits.length <= 4) return s.trim();
  return '…' + digits.slice(-4);
}

/** Names as banks print them: unaccented uppercase, sometimes trailed by an
 *  account or phone. Same person ⇔ same letters once the tail is dropped. */
function _personKey(raw) {
  return _strip(String(raw || '').replace(/[-–].*$/, '')).replace(/[^a-z ]/g, '').trim();
}

/** Does this counterparty read as a PERSON rather than a shop?
 *
 *  The same reduction _personKey makes (drop the account or phone tail, keep
 *  the letters), then three tests a Vietnamese name passes and a merchant
 *  mostly does not: two to five words, every one a syllable-sized run of
 *  letters, the first of them a family name, and no business word anywhere.
 *  "NGUYEN VAN A - 0000 1234" is a person; "AEON NGUYEN VAN LINH" is not (it
 *  opens with the brand), nor is "LE VAN SY COFFEE".
 *
 *  Used by classify.mjs to decide whether a counterparty may be shown to the
 *  model at all, so it errs toward PERSON: a shop mistaken for a person loses a
 *  category hint; a person mistaken for a shop has their name sent out. */
const _FAMILY_NAMES = new Set(['nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'phan', 'vu', 'vo',
  'dang', 'bui', 'do', 'ho', 'ngo', 'duong', 'ly', 'dinh', 'truong', 'doan', 'lam', 'mai', 'trinh',
  'dao', 'cao', 'luong', 'luu', 'ta', 'ha', 'chu', 'to', 'thai', 'quach', 'la', 'kieu', 'ton', 'tong',
  'van', 'phung', 'vuong', 'nghiem', 'thach', 'diep', 'lai', 'khuong', 'trieu', 'chau', 'tang', 'kim']);
const _BUSINESS_WORDS_RE = /\b(?:cong ty|cty|tnhh|co phan|cp|jsc|ltd|llc|inc|company|corp|cua hang|shop|store|mart|market|sieu thi|coffee|cafe|ca phe|tra sua|quan|nha hang|restaurant|bakery|spa|salon|hotel|khach san|pharmacy|nha thuoc|benh vien|phong kham|truong|school|bank|ngan hang|pay|wallet|vi dien tu)\b/;
export function looksLikePerson(raw) {
  if (_BUSINESS_WORDS_RE.test(_strip(String(raw || '').replace(/[-–].*$/, '')))) return false;
  const key = _personKey(raw);
  if (!key) return false;
  const words = key.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (!words.every((w) => w.length <= 7)) return false;
  return _FAMILY_NAMES.has(words[0]);
}

/** Letters only, the account or phone tail dropped: the form two printings of
 *  one name agree on ("NGUYEN VAN A - 0000 1234" and "Nguyễn Văn A").
 *
 *  It sits here, beside the two matchers it feeds, rather than in signals.mjs
 *  where it was written: _personKey above only ever knew "NAME - ACCOUNT", and
 *  a VIB beneficiary cell is printed the other way round ("1000002279 - NGUYEN
 *  VAN TEST"), so the reader below needs this reduction before it can ask
 *  looksLikePerson anything. */
export function nameKey(raw) {
  const parts = String(raw == null ? '' : raw).split(/\s+[-–|]\s+/);
  // "ACCOUNT - NAME" and "NAME - ACCOUNT" are both printed; the name is the
  // part with the fewest digits.
  let best = parts[0] || '';
  for (const p of parts) if ((p.match(/\d/g) || []).length < (best.match(/\d/g) || []).length) best = p;
  return _strip(best).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── who was paid: the marks only a payment SYSTEM leaves (E12, E13) ─────────
   Kept consistent with fhSellerSignal in src/js-ui/13-partition.js, which the
   device keeps running on v1 rows. Measured there on two real mailboxes: 143 of
   273 yearly transfers in one and 56 of 158 in the other carry one of these
   marks, and not one of them also carries a person-to-person note. None of it
   reads a payee's NAME for meaning. An unknown prefix is NOT a mark: a missing
   rule makes the answer shallower, never wrong. [\dX] because some transports
   mask digits.

   MOVED here from signals.mjs (2026-09-22) so readRows can ask it too. That
   module imports looksLikePerson from this one, so importing sellerMark the
   other way would be a cycle; both matchers answer the same question — who is
   on the other side — so they now live together, at the leaf, and signals.mjs
   re-exports this one unchanged. */
const _VA_RX = [/^99MM[\dX]/, /^99ZP[\dX]/, /^ZLP[\dX]{6}/, /^ZION-/i, /^9627952[\dX]/, /^9990018[\dX]/, /^9990009[\dX]/,
  /^MS0[\dX][PT][\dX]{6}/, /^VQRQ[A-Z0-9]{4}/i, /^(PHATLOC|LOCPHAT)[\dX]{3}/, /^(V3)?KOV[\dX]{3}/, /^MWGVN/,
  /^AGBVMSP/, /^(PMC|PSP)[\dX]{10}/, /^MD18[\dX]{10}/, /^[\dX]{6,}QR[A-Z]{3}[\dX]{2}$/, /^MB?999[\dX]{6}/,
  /^962NPS/, /^HE1TINGEE/, /^[A-Z0-9]{8,}VCB$/];
const _PSP_NAME_RX = /(^|[\s|\-])(momo_|zalopay_|payoo[ _\-*])/;
const _BIZ_RX = /\b(cong ty|cty|ct tnhh|ct cp|tnhh|co phan|hkd|ho kinh doanh|dntn|doanh nghiep tu nhan|company|limited|corporation|jsc|co ltd|ltd|cua hang|nha thuoc|tiem)\b/;
const _TILL_MEMO_RX = [/^tt hd\b/, /^\d{5} [a-z0-9]{5}$/, /^qr[a-z0-9]{6}tt\b/, /^qr\d+tt\b/, /^kovqr[a-z0-9]+$/, /^(vqrloamb|mbts)[a-z0-9]+$/,
  /^[a-z0-9]{15} \d{9}$/, /\bthanh toan qrcode tai\b/, /^thanh toan cho .+\([^)]+\)$/];

/** 'bizpay' when the account name is a legal entity, 'purchase' for any other
 *  seller mark, null otherwise. The same three answers fhSellerSignal gives.
 *  (`_strip` is this file's `_deburr`, plus the whitespace collapse the
 *  till-memo pass below was applying by hand anyway.) */
export function sellerMark(reading) {
  const r = reading || {};
  const segs = [];
  for (const v of [r.counterparty, r.counterparty_account_tail, r.memo]) {
    for (const x of String(v == null ? '' : v).split('|')) { const t = x.trim(); if (t) segs.push(t); }
  }
  if (!segs.length) return null;
  const flat = _strip(segs.join(' | '));
  if (/\bngan hang\b/.test(flat)) return null;               // an issuer's name: a repayment, not a shop
  let mark = _PSP_NAME_RX.test(flat);
  for (let i = 0; i < segs.length && !mark; i++) {
    for (const tok of segs[i].split(/\s+-\s+|\s+/)) {
      const tk = tok.replace(/[.,;:]+$/, '');
      if (tk.length < 8 || !/[\dX]/.test(tk)) { if (!/^ZION-/i.test(tk)) continue; }
      if (_VA_RX.some((rx) => rx.test(tk))) { mark = true; break; }
    }
  }
  for (let i = 0; i < segs.length && !mark; i++) {
    const m = _strip(segs[i]);
    if (_TILL_MEMO_RX.some((rx) => rx.test(m))) mark = true;
  }
  if (_BIZ_RX.test(flat.replace(/[^a-z0-9]+/g, ' '))) return 'bizpay';
  return mark ? 'purchase' : null;
}

/** Does the mail's own status row say the transaction FAILED? Row-targeted on
 *  purpose: a success mail's footer can contain the words "không thành công"
 *  inside safety advice, so only the status field's value gets to answer. The
 *  stored templates cannot ask this question — several staticised status as
 *  success at derivation — so extract.mjs asks it here for every tier. A
 *  declined attempt staged as spending is money the ledger loses twice. */
export function statusReadsFailed(body) {
  for (const row of _rows(body)) {
    if (_lookup(row.label) !== 'status') continue;
    return /khong thanh cong|that bai|tu choi|bi huy|failed|declined|unsuccessful|reversed/.test(_strip(row.value));
  }
  return false;
}

/** Label cells the dictionary did NOT resolve — the one piece of "training
 *  data" this pipeline is allowed to collect. Labels are the bank's own
 *  boilerplate ("Số tiền khuyến mãi", "Mã đơn hàng"); the VALUES never leave.
 *  Pipe rows give labels directly; in line form a label is guessed by shape —
 *  short, no digit runs, sitting right above a line that has digits. */
/* Boilerplate that is never a field label, matched on the stripped form as a
   prefix. "Kính gửi CAO THÁI DUY HIỂN" is the one that mattered: a salutation
   carrying the account holder's own name passed every shape test there was. */
const _MISS_DENY = ['kinh gui', 'theo doi', 'website', 'email', 'dia chi',
                    'hotline', 'tong dai', 'tran trong', 'ngan hang quoc te',
                    /* 2026-09-22: the other salutations, which carry a name just
                       as "Kính gửi" does, and the sign-offs and disclaimer
                       fragments that were sitting in extract_miss_labels as
                       "labels" (email-reading-v2 §11). */
                    'xin chao', 'dear', 'than gui', 'ban than men', 'yours',
                    'unsubscribe', 'huy dang ky', 'best regards', 'regards', 'sincerely',
                    'thank you', 'thanks', 'cam on', 'xin cam on',
                    'thu nay', 'day la thu', 'day la email', 'vui long khong',
                    'khong tra loi', 'luu y', 'mien tru', 'ban quyen', 'bao mat',
                    'de biet them', 'moi thac mac', 'neu quy khach', 'neu ban',
                    'this email', 'this e-mail', 'this message', 'this is an auto',
                    'do not reply', 'please do not', 'please note', 'disclaimer',
                    'confidential', 'copyright', 'all rights reserved', 'if you',
                    'for more information', 'privacy', 'terms'];

/* The first word of a field label, stripped. Only consulted by the Title-Case
   rule below, so it only matters for banks that print "Ngày Giao Dịch" rather
   than "Ngày giao dịch". Kept to words that are NOT plausible Vietnamese name
   syllables: "Tài", "Tú", "Chi", "Ngân", "Phương" all start real labels and
   real people, and a lost sighting costs nothing while a name in a plaintext
   table is the incident this function exists to prevent. */
const _LABEL_HEADS = new Set(['so', 'ngay', 'ten', 'loai', 'noi', 'dia', 'hinh', 'thoi',
  'kenh', 'don', 'ghi', 'ma', 'amount', 'date', 'time', 'transaction', 'order',
  'reference', 'payment', 'total', 'fee', 'account', 'card', 'status', 'description',
  'details', 'type', 'balance', 'currency', 'method', 'channel', 'service',
  'customer', 'bill', 'invoice', 'merchant']);

/* Is this candidate actually a VALUE wearing a label's shape?
 *
 * WHY THIS EXISTS. Until 2026-09-03 this file recorded 1,627 rows of which 500
 * distinct entries were amount-shaped and 318 were names or merchants — a named
 * individual and their spending, in a plaintext table, under a comment claiming
 * "no values, no amounts, nothing personal". The old test asked whether a line
 * LOOKED like a label; in line form a formatted amount does, because `500,000`
 * never presents four consecutive digits to /\d{4,}/.
 *
 * Four rules, each aimed at a family of the real leaked entries:
 *   digits/currency  — every amount, date, reference and account number
 *   extracted values — memos and counterparties, subtracted using the answer we
 *                      are already holding rather than guessed at
 *   caps runs        — proper nouns: "CAO THÁI DUY HIỂN", "MPOS*WAYNESCOFFEE",
 *                      "TLJ CRESCENT MALL". One short run survives on purpose,
 *                      so "Phí (bao gồm VAT)" is still learnable.
 *   deny prefixes    — salutations and footers, which are neither.
 *
 * Five more, 2026-09-22, each aimed at a family found in the 101 live rows:
 *   no letter        — mask characters and rules ("●●●●", "-----")
 *   entities         — "Nguy&#7877;n": text mailtext had not decoded, so none of
 *                      the rules above could see what it was
 *   trailing , - –   — a line that goes on: half an address, half a sentence
 *   lowercase start  — the OTHER half: a wrapped continuation line
 *   Title-Case runs  — three or more Title-Case words is a person, a place or a
 *                      film ("Nguyễn Văn An", "Thành Phố Hồ Chí Minh") unless
 *                      the first is a label's head word ("Ngày Giao Dịch")
 *
 * KNOWN GAP, deliberately left: a fused "Tại Shopee" survives when the merchant
 * was not the extracted counterparty. It is a merchant rather than a person,
 * it is the coverage signal we are here for, and the DB CHECK in 0115 is the
 * backstop for the categories that actually matter. */
function _isValueShaped(raw, values) {
  const t = String(raw || '').trim();
  if (!t || t.length < 3) return true;              // no field label is one glyph
  if (!/\p{L}/u.test(t)) return true;               // masks and rules: not one letter in it
  if (/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/i.test(t)) return true;   // undecoded entity
  if (/[,\-\u2013]$/.test(t)) return true;           // a line that goes on is not a label
  const firstLetter = (t.match(/\p{L}/u) || [''])[0];
  if (firstLetter && firstLetter !== firstLetter.toUpperCase()) return true;   // a wrapped continuation
  if (/[0-9]/.test(t)) return true;
  if (/(₫|\bVND\b|\bđ\b|\$)/i.test(t)) return true;
  // a host, a URL or an address is a footer value, never a label
  if (/@|:\/\/|\.[a-z]{2,}/i.test(t)) return true;

  const stripped = _strip(t);
  for (const d of _MISS_DENY) if (stripped.startsWith(d)) return true;
  for (const v of values) {
    if (!v) continue;
    if (stripped === v || stripped.includes(v)) return true;
  }

  const caps = t.split(/\s+/).filter((w) => {
    const letters = w.replace(/[^\p{L}]/gu, '');
    return letters.length >= 2 && letters === letters.toUpperCase();
  });
  if (caps.length >= 2) return true;
  if (caps.some((w) => w.replace(/[^\p{L}]/gu, '').length >= 6)) return true;

  // A run of three or more Title-Case words: a proper noun, unless it opens
  // with a label's head word.
  const words = t.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  let run = 0, longest = 0;
  for (const w of words) {
    run = /^\p{Lu}\p{Ll}+$/u.test(w) ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  if (longest >= 3 && !_LABEL_HEADS.has(_strip(words[0] || ''))) return true;

  return false;
}

/* `reading` is the model's own answer for this mail. It is optional only so a
   caller with nothing to subtract still gets the shape rules; production always
   passes it, because subtracting real values is the half that catches a memo. */
export function unknownLabels(body, reading) {
  const values = [];
  for (const v of Object.values(reading || {})) {
    if (v == null || typeof v === 'boolean') continue;
    const sv = _strip(String(v));
    if (sv.length >= 3) values.push(sv);
  }
  const out = new Set();
  const lines = String(body || '').split('\n').map((l) => l.trim());

  /* Widened 2026-08-30. The old line-form rule required the NEXT line to contain
     a digit, which is true of an amount or a date and false of a merchant, a
     beneficiary or a payment note — so a whole bank could go through the model
     hundreds of times and record nothing. VIB did exactly that: 180 model calls,
     two rows captured, both MoMo. A dictionary gap that cannot be seen cannot be
     closed.
  
     The replacement asks what a LABEL looks like rather than what its value
     looks like: short, few words, no long digit run, not a sentence, and
     followed by something that is not itself a label. */
  const looksLikeLabel = (t) =>
    !!t && t.length <= 64 && t.split(/\s+/).length <= 8 &&
    !/\d{4,}/.test(t) && !/[.!?:;]$/.test(t) && !_lookup(t);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2 && looksLikeLabel(cells[0])) out.add(cells[0]);
      continue;
    }
    /* THE LINE AFTER A LABEL IS ITS VALUE, AND A VALUE IS NEVER A CANDIDATE
       (2026-09-22). The loop used to step to the next line whatever it had just
       decided, so after a label it tested that label's VALUE as the next
       candidate, and the value passed, because the line after IT was another
       label. That is how a person's full name, a merchant, a city and a film
       title came to be harvested as "labels" (email-reading-v2 §11). Both
       branches now step OVER the value line, the way _rows reads the table. */
    if (_lookup(line)) {
      let k = i + 1;
      while (k < lines.length && !lines[k]) k++;
      while (k < lines.length && _isEnglishTwin(lines[k])) {
        k++;
        while (k < lines.length && !lines[k]) k++;
      }
      // ...unless what follows is itself a label: a field the bank left empty.
      if (lines[k] && !lines[k].includes('|') && !_lookup(lines[k])) i = k;
      continue;
    }
    if (!looksLikeLabel(line)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const next = lines[j];
    // A label is followed by a VALUE, not by another label and not by nothing.
    if (next && !next.includes('|') && !_lookup(next)) { out.add(line); i = j; }
  }
  return [...out].filter((l) => !_isValueShaped(l, values)).slice(0, 24);
}

/**
 * The vocabulary learns — CONSERVATIVELY, and every limit here is a scar.
 *
 * When the model reads a mail this dictionary could not, the caller holds both
 * the body and the answer. A (label, value) row whose value EQUALS a field of
 * that answer is one vote that the label means that field: "Diễn giải" beside
 * the memo the model reported teaches `dien giai → memo`. Same inversion
 * deriveExtractionTemplate performs per-shape, one level of generality up.
 *
 * What a vote is NOT: truth. The reader applies a mapping only at n>=3 from
 * one sender domain (db.loadLearnedLabels) — one equal value is a coincidence,
 * three is a layout. And these fields may NEVER be learned, in this order of
 * why: amount and occurred_at have absorbers and format rules a heuristic
 * would subvert into a wrong number in a ledger; account is a masking surface;
 * status gates staging. merchant/beneficiary are learned only under the
 * transaction type that disambiguates them, because `who` feeds the
 * self-transfer check and a swapped mapping would misfile transfers.
 *
 * Returns [{label, field}] — label is the STRIPPED form, the reader's own
 * matching key, and never a value from the mail.
 */
export function deriveLabelMappings(body, reading) {
  if (!reading || reading.is_transaction !== true) return [];
  const votes = new Map();           // label_norm -> field | null(=ambiguous, drop)
  const consider = (label, field) => {
    if (votes.has(label) && votes.get(label) !== field) votes.set(label, null);
    else votes.set(label, field);
  };
  const eq = (v, target) => {
    const a = String(v == null ? '' : v).trim();
    const b = String(target == null ? '' : target).trim();
    return a.length >= 3 && a === b;
  };
  for (const row of _rows(body)) {
    const lab = _strip(row.label);
    if (!lab || lab.length < 3 || lab.length > 64) continue;
    if (/\d{4,}/.test(lab)) continue;                 // a "label" with a number in it is a value
    if (_lookup(row.label)) continue;                  // already known — nothing to learn
    if (eq(row.value, reading.memo)) consider(lab, 'memo');
    if (eq(row.value, reading.reference_number)) consider(lab, 'reference');
    if (eq(row.value, reading.counterparty)) {
      if (reading.transaction_type === 'p2p_transfer') consider(lab, 'beneficiary');
      else if (reading.transaction_type === 'ecommerce_receipt') consider(lab, 'merchant');
      // any other type: the value matched but nothing disambiguates who the
      // counterparty IS — no vote at all beats a coin-flip vote
    }
  }
  const out = [];
  for (const [label, field] of votes) if (field) out.push({ label, field });
  return out;
}

/* DIRECTION RESTS ON EVIDENCE, OR IT IS NULL (2026-09-22).
 *
 * This used to read `negative ? 'debit' : (refund ? 'credit' : 'debit')`: every
 * mail that printed no minus sign and no refund wording was a debit BY DEFAULT.
 * So an incoming-transfer notice (a remitter row, a memo, an unsigned or "+"
 * amount) was read as money leaving, and because the template learner runs on
 * this tier's output the wrong direction then froze into the shape's statics
 * and was served to every later mail for free. Money coming in could not be
 * read here at all.
 *
 * Two grades of evidence, and the grade decides who wins:
 *
 *   STATED    what the mail says outright: a printed sign on the amount, or
 *             debit/credit wording in the txn-kind row, the subject, the status
 *             or the amount row's OWN label ("Số tiền ghi nợ", "Số tiền nhận").
 *   IMPLIED   what the layout suggests: a merchant row is a card purchase, a
 *             beneficiary row is an outgoing receipt, a "Tài khoản trích nợ"
 *             style label names the account that paid; a remitter row with NO
 *             beneficiary row is somebody sending money in.
 *
 * Stated outranks implied, because a refund legitimately names the merchant it
 * came back from and an incoming notice legitimately names its beneficiary (the
 * reader). Inside one grade a disagreement is a null, never a vote: "-50,000"
 * under a "Hoàn tiền" subject is a mail this tier does not understand. Wording
 * that names BOTH directions ("Thông báo ghi nợ/ghi có") is a generic title and
 * counts as no wording at all.
 *
 * Null is an answer. extract.mjs accepts this tier only with a direction, so a
 * null hands the mail to the next tier instead of inventing an expense. */
const _CREDIT_WORDS_RE = /\b(?:ghi co|nhan tien|tien vao|so tien nhan|hoan tien|refund(?:ed)?|credited|received)\b/;
const _DEBIT_WORDS_RE = /\b(?:ghi no|trich no|tien ra|so tien chuyen|debited)\b/;
const _DEBIT_ACCOUNT_LABEL_RE = /tai khoan trich no|tai khoan ghi no|tai khoan nguon|debit account/;

function _directionFrom(got, gotLabel, kindFlat, amtRaw, conv) {
  // The sign lives on the TRANSACTION amount row even when the converted VND
  // figure is the one being taken: banks print "-111 USD" and an unsigned
  // conversion beside it. The converted row's sign answers only when the
  // transaction row printed none.
  const sign = (amtRaw && amtRaw.sign) || (conv && conv.sign) || null;

  const wording = [kindFlat, _strip(got.status || ''),
    amtRaw ? _strip(gotLabel.amount || '') : '',
    conv ? _strip(gotLabel.converted || '') : ''].join(' | ');
  const saysCredit = _CREDIT_WORDS_RE.test(wording);
  const saysDebit = _DEBIT_WORDS_RE.test(wording);
  const worded = saysCredit === saysDebit ? null : (saysCredit ? 'credit' : 'debit');

  const signed = sign === '+' ? 'credit' : (sign === '-' ? 'debit' : null);
  if (signed && worded) return signed === worded ? signed : null;
  if (signed || worded) return signed || worded;

  // The beneficiary's BANK or ACCOUNT row is as much an outgoing receipt as the
  // beneficiary's name: they are the same side of the same form, and the bank
  // row implied a debit all along, from inside the beneficiary vocabulary.
  const impliesDebit = !!(got.merchant || got.beneficiary || got.cp_bank || got.cp_account
    || (got.account && _DEBIT_ACCOUNT_LABEL_RE.test(_strip(gotLabel.account || ''))));
  const impliesCredit = !!(got.remitter && !got.beneficiary);
  if (impliesDebit === impliesCredit) return null;
  return impliesDebit ? 'debit' : 'credit';
}

/* ── the mail's rows, from its markup when it has any ─────────────────────── */

/** `<tr>` cells → label/value pairs. Pairing is a question about LABELS, which
 *  is why it lives here and not in htmltable.mjs:
 *    two cells            label | value, the shape nearly every bank uses
 *    four cells           two pairs side by side, and only when BOTH label
 *                         cells resolve (VCB's "Loại phí | … | Số tiền phí | …")
 *  A label is the FIRST LINE of its cell and a value the first line of its own,
 *  which is exactly what the line walk reads off the flattened body ("Sử dụng
 *  tại" with its English twin "At" on the next line; a fee cell that stacks
 *  three figures). That equality is deliberate: where both readers succeed they
 *  must agree, and the scoreboard measures that they do.
 *  A pair with an EMPTY value is kept: the field is empty, the format is not
 *  different, and labelSignature (formats.mjs) reads labels only. */
function _pairCells(htmlRowList, lookup) {
  const out = [];
  const first = (cell) => String(cell || '').split('\n')[0].trim();
  const labelOf = (cell) => {
    const head = first(cell);
    if (!head || head.length > MAX_LABEL_LEN) return null;
    if (lookup(head)) return head;
    // "Thẻ\nCard" resolves as the joined "Thẻ Card" where the head alone would
    // not; an unknown label stays its first line.
    const joined = String(cell || '').split('\n').join(' ').trim();
    if (joined.length <= MAX_LABEL_LEN && lookup(joined)) return head;
    return _isProse(head) ? null : head.replace(/\s*:$/, '');
  };
  for (const r of htmlRowList || []) {
    const c = r.cells || [];
    const pairs = c.length === 2 ? [[c[0], c[1]]]
      : (c.length === 4 && lookup(first(c[0])) && lookup(first(c[2]))) ? [[c[0], c[1]], [c[2], c[3]]]
      : [];
    for (const [l, v] of pairs) {
      const label = labelOf(l);
      if (!label) continue;
      const value = first(v);
      out.push({ label, value: _isEnglishTwin(value) ? '' : value, form: 'cell' });
    }
  }
  return out;
}

/**
 * The rows of one mail, and which reader produced them.
 *
 * STRUCTURAL when the markup yields at least three label/value pairs and
 * resolves at least as many of them as the line walk does; LINE otherwise (a
 * text-only mail, a notice laid out in `<div>`s like VIB's card alert, markup
 * past the size cap). One rule, used by the reader below AND by the format tier
 * in extract.mjs, so a format is learned and looked up over the same rows.
 *
 * `learned` is the extra label map: the n>=3 learned vocabulary (0111), or a
 * stored format's own labels when the line walk has to find rows the
 * hand-written vocabulary does not know.
 */
export function tableRows(message, learned) {
  const lookup = (l) => _lookup(l, learned);
  const resolved = (rows) => rows.filter((r) => r.value && lookup(r.label)).length;
  const line = _rows(message && message.body, learned);
  let cell = [];
  if (message && message.html) {
    try { cell = _pairCells(htmlRows(message.html), lookup); } catch { cell = []; }
  }
  /* Three resolved pairs are a table the vocabulary can read. NOT "at least as
     many as the line walk": the line walk over-counts, because a mail's own
     TITLE can contain a label phrase ("Chuyển tiền nhanh đến tài khoản … thành
     công" contains "đến tài khoản") and then reads as a row. With fewer than
     three, the markup still wins when the line walk found no more than it did:
     that is a format whose labels nobody knows yet, and its rows are exactly
     what the model's cited labels will be looked up in. */
  const nCell = resolved(cell);
  if (cell.length >= 3 && (nCell >= 3 || nCell >= resolved(line))) return { rows: cell, via: 'structural' };
  return { rows: line, via: 'line' };
}

/* "0123456789 - NGUYEN VAN A" or "NGUYEN VAN A - 0123456789": the account half
   of a beneficiary cell that carries both. A virtual account has letters in it
   ("99MM…"), so the test is "a token with four or more digits and no space",
   never "all digits". Null when the cell is only a name. */
function _accountInsideWho(cell) {
  const parts = String(cell || '').split(/\s+[-–]\s+/);
  if (parts.length < 2) return null;
  for (const part of [parts[0], parts[parts.length - 1]]) {
    const t = part.trim();
    if (t && !/\s/.test(t) && (t.match(/\d/g) || []).length >= 4) return t;
  }
  return null;
}

/** second | minute | day, from the PRINTED form (email-reading-v2 §4). It
 *  replaces two guesses the device makes today: "UTC midnight means day only",
 *  and a minute recovered from a note suffix. Null when nothing was printed. */
export function whenPrecision(raw) {
  const s = String(raw || '');
  if (!/\d/.test(s)) return null;
  if (/\d{1,2}:\d{2}:\d{2}/.test(s)) return 'second';
  if (/\d{1,2}:\d{2}/.test(s)) return 'minute';
  return 'day';
}

/** The name in the mail's greeting ("Kính gửi NGUYEN VAN A"), when it IS a name
 *  and not "Quý khách hàng". A body scan, so callers record it as `heuristic`;
 *  a printed "Chủ thẻ" row always wins over it. */
export function greetingName(body) {
  const m = String(body || '').match(/^\s*(?:K[ií]nh\s+g[uử]i|Kinh\s+gui|Xin\s+ch[aà]o|Dear)[:,]?\s+([^\n,:]{4,60})[,:]?\s*$/im);
  if (!m) return null;
  const honorific = /^(?:anh|ch[iị]|[oô]ng|b[aà]|mr\.?|ms\.?|mrs\.?)\s+/i;
  /* "Kính gửi Quý khách NGUYEN VAN A," is how VIB (and MB, with a colon)
     address a person: "Quý khách" is boilerplate, the name after it is
     printed. Until 2026-09-22 the whole line was refused for containing
     "Quý khách", so holder_name stayed null on every VIB transfer, and an
     own-account transfer ("Đến tài khoản: … - NGUYEN VAN A", the same letters)
     could only be found through the memo, as a guess the device will not
     materialize an account from. A greeting that is ONLY the honorific
     ("Kính gửi Quý khách hàng,") still names nobody. */
  const name = m[1].replace(honorific, '')
    .replace(/^(?:qu[yý]\s+kh[aá]ch(?:\s+h[aà]ng)?|kh[aá]ch\s+h[aà]ng|valued\s+customer|customer)\s*/i, '')
    .replace(honorific, '').trim();
  if (!name || /qu[yý]\s+kh[aá]ch|kh[aá]ch\s+h[aà]ng|customer|valued/i.test(name)) return null;
  return looksLikePerson(name) ? name : null;
}

export function readLabelTable(subject, body, learned, html) {
  /* THE MARKUP FIRST, when the mail has any (email-reading-v2 §8.1 step 4). The
     structural rows are tried on their own and kept only if they pass the same
     gate; otherwise the line walk reads the mail exactly as it always did. A
     caller with no HTML (the forwarding transport, every older test) passes
     three arguments and gets the old reader. */
  if (html) {
    const t = tableRows({ body, html }, learned);
    if (t.via === 'structural') {
      const viaCells = readRows(subject, t.rows, (l) => _lookup(l, learned));
      if (viaCells) { viaCells.rows_via = 'structural'; return viaCells; }
    }
  }
  const viaLines = readRows(subject, _rows(body, learned), (l) => _lookup(l, learned));
  if (viaLines) viaLines.rows_via = 'line';
  return viaLines;
}

/**
 * Rows → a reading, or null when the confidence gate is not met.
 *
 * `lookup` is what turns a label into a field. The vocabulary above is the
 * default; a stored FORMAT passes its own label map instead (formats.mjs), so a
 * known format and an unknown one are read by the same code and can only differ
 * in what a label means, never in how a value is parsed or a direction decided.
 */
export function readRows(subject, rows, lookup) {
  if (!rows || rows.length < 3) return null;

  const got = {};
  const gotLabel = {};   // the label each value was read under: direction evidence lives in labels too
  const subjectFlat = _strip(subject);
  for (const row of rows) {
    if (!row.value) continue;                       // a field the bank left empty
    /* THE MAIL'S OWN TITLE IS NOT A ROW. VIB repeats the subject as the first
       line of the body, "Chuyển tiền nhanh đến tài khoản ngân hàng nội địa
       thành công" contains the label phrase "đến tài khoản", and the line under
       it is the salutation: so the line walk read "Kính gửi <the customer>" as
       the beneficiary on all 269 VIB transfers of the test set, first hit
       winning over the real row further down. (memo.mjs tidyMerchant has been
       blanking that salutation since; this is where it came from.) */
    if (subjectFlat && _strip(row.label) === subjectFlat) continue;
    const field = lookup(row.label);
    if (field && !(field in got)) { got[field] = row.value; gotLabel[field] = row.label; }   // first hit wins; later dupes are footer noise
  }

  /* The amount, in the mail's own currency. Three rows can carry money here:
     the transaction amount, the converted/billed VND figure an international
     card notice prints beside it, and an explicit currency row. The rules:

       - a VND (or unmarked) transaction amount is the amount, as ever;
       - a FOREIGN transaction amount with a converted-VND row beside it takes
         the CONVERTED figure — that is the bank's own settled conversion, the
         money that actually left the account — and the foreign original rides
         along as fx_amount/fx_currency so the reviewer still sees "$111";
       - a foreign amount with NO converted row stays foreign, honestly: the
         reviewer types the VND figure at review. Defaulting it to VND is how
         a $111 subscription staged as 111đ;
       - a converted row with no transaction-amount row IS the amount (some
         banks label their only figure "Số tiền ghi nợ"). */
  let amtRaw = parseAmountCell(got.amount);
  const conv = got.converted ? parseAmountCell(got.converted) : null;
  const convVnd = (conv && (conv.currency == null || conv.currency === 'VND')) ? conv : null;
  const curRow = got.currency_row ? cellCurrency(got.currency_row) : null;
  // A bare amount cell named foreign only by the currency ROW parsed under the
  // VND rule (decimal tail = print noise) and would lose its cents — re-read
  // it under the currency the row names.
  if (amtRaw && !amtRaw.currency && curRow && curRow !== 'VND') {
    amtRaw = parseAmountCell(String(got.amount) + ' ' + curRow) || amtRaw;
  }
  const txnCur = amtRaw ? (amtRaw.currency || curRow || 'VND') : null;

  let amt = amtRaw, currency = txnCur, fxAmount = null, fxCurrency = null;
  let amountField = 'amount';
  if (amtRaw && txnCur !== 'VND' && convVnd) {
    amt = convVnd; currency = 'VND'; amountField = 'converted';
    fxAmount = amtRaw.value; fxCurrency = txnCur;
  } else if (!amtRaw && convVnd) {
    amt = convVnd; currency = 'VND'; amountField = 'converted';
  }

  const when = got.occurred_at ? parseWhenCell(got.occurred_at) : null;

  const kindFlat = _strip((got.txn_kind || '') + ' ' + (subject || ''));
  const isTransfer = !!(got.beneficiary || got.remitter)
    || /chuyen tien|chuyen khoan|bien lai/.test(kindFlat);

  const direction = _directionFrom(got, gotLabel, kindFlat, amtRaw, conv);

  /* Who is on the OTHER side depends on which way the money went. On money
     coming in, the beneficiary row is the reader themself and the remitter is
     the counterpart; taking the beneficiary first (the only order there was
     while every row was a debit) would file a person's own name as who paid
     them. A refund still names its merchant, so merchant stays first.
     LAST, the beneficiary's BANK, when the mail names nobody else: VIB's card
     repayment is paid to the issuer and says so in "Ngân hàng hưởng", with an
     empty memo. That row was the counterparty while it sat in the beneficiary
     vocabulary, the device recognises a repayment by it (E7: "the issuer as
     counterparty"), and 81 mails of the test set read only because of it. */
  const whoRow = got.merchant ? 'merchant'
    : (direction === 'credit' && got.remitter) ? 'remitter'
    : got.beneficiary ? 'beneficiary'
    : got.cp_bank ? 'cp_bank' : null;
  const who = whoRow ? got[whoRow] : null;

  /* What was bought stands in for a memo the mail does not have. */
  const memo = got.memo || got.item || null;
  const memoField = got.memo ? 'memo' : (got.item ? 'item' : null);

  // The confidence gate. Money, a moment, and a counterpart (or at least a
  // memo): anything less is not a ledger row, and the model gets to judge it.
  if (!amt || !when || !(who || memo)) return null;

  // Self-transfer: the sender and the beneficiary are the same letters. That
  // is the person moving money between their own pockets, and filing it as an
  // expense would quietly shrink a ledger by money that never left. The sender
  // side comes from the holder row where the mail prints one, the remitter row
  // where the bank prints that (VCB), or from the holder name inside the
  // debit-account cell where it does neither (MB writes "NGUYEN THU TRANG -
  // 3510…" as the account value and has no remitter row).
  const senderName = _personKey(got.holder) || _personKey(got.remitter) || _personKey(got.account);
  const self = !!(senderName && got.beneficiary && senderName === _personKey(got.beneficiary));

  const fee = got.fee ? parseAmountCell(got.fee) : null;
  const limit = got.limit ? parseAmountCell(got.limit) : null;
  /* On a CARD PURCHASE the card is the person's own instrument, not a card
     being paid down: the mail names a merchant and no account row ("Số thẻ" is
     the only instrument VIB's card notice prints). card_masked stays filled
     too, role-neutral as ever; signals.mjs is what keeps a card number from
     being read as a repayment (category-tree E7). */
  const account = got.account || (got.merchant && got.card ? got.card : null);
  const accountField = got.account ? 'account' : (account ? 'card' : null);
  const cpAccount = got.cp_account || (whoRow === 'beneficiary' ? _accountInsideWho(got.beneficiary) : null);

  /* WHO IS ON THE OTHER SIDE, not merely WHICH ROWS THE MAIL PRINTED
     (2026-09-22). `transaction_type` below used to read p2p_transfer on the
     SHAPE alone — a beneficiary or remitter row exists, or the kind row or the
     subject says chuyển tiền / chuyển khoản / biên lai. But a QR payment to a
     SELLER is printed in exactly that shape: VIB's "Chuyển tiền nhanh đến tài
     khoản ngân hàng nội địa thành công", beneficiary "VQRQ0001… - <a name>",
     which is a virtual-account mark and not a friend.
     Harmless while the verdict was discarded before sealing. It is sealed now,
     as raw_extracted.reader_type, and the device asks it FIRST when it decides
     whether to leave the description blank (a p2p counterparty answers "who",
     not "what for"): on one real mailbox 19 of 104 rows read p2p, 7 of them
     were merchants, and 5 imported with an empty description although the mail
     had printed a perfectly good merchant string.
     So the transfer shape is necessary and no longer sufficient. A seller mark
     or a legal-entity name (E12, E13) outranks a person-shaped name, which is
     the incident above: `ecommerce_receipt` is what that verdict means
     downstream — a purchase nobody's bank initiated. A counterparty that is
     neither is NULL, the answer this reader gives everywhere else when the mail
     does not say: better than teaching the device, the vote learner and the
     next stored template a coin flip. */
  const cpIsSeller = whoRow === 'merchant'
    || !!sellerMark({ counterparty: who, counterparty_account_tail: cpAccount, memo });
  const cpIsPerson = !cpIsSeller && !!who && (looksLikePerson(who) || looksLikePerson(nameKey(who)));
  const transactionType = whoRow === 'cp_bank' ? 'bank_txn'
    : !isTransfer ? 'ecommerce_receipt'
    : cpIsPerson ? 'p2p_transfer'
    : cpIsSeller ? 'ecommerce_receipt'
    : null;

  const out = {
    is_transaction: true,
    /* A mail whose ONLY counterpart is the beneficiary's bank is a payment to
       that bank (a card bill), which is the one case the reader can call
       bank_txn. It used to read p2p_transfer, because the bank row sat in the
       beneficiary vocabulary and any beneficiary meant a transfer. The rest of
       the verdict, and why it is not the shape alone, is above. */
    transaction_type: transactionType,
    source_provider: null,                       // worker falls back to the sender registry
    occurred_at: when,
    time_precision: whenPrecision(got.occurred_at),
    amount: amt.value,
    /* The currency the amount is REALLY in. 'VND' was hardcoded here until
       2026-09-03, which — with parseAmountCell then discarding the USD token —
       is the whole USD-as-VND defect (foreign-currency-emails-spec.md §2.1). */
    currency,
    /* The foreign original, when the converted VND figure was preferred over
       it. Provenance for the reviewer ("2.923.000 ₫ ≈ $111") and for the
       ledger row's note; null on every domestic mail. */
    fx_amount: fxAmount,
    fx_currency: fxCurrency,
    fee_amount: fee ? fee.value : null,
    available_limit: limit ? limit.value : null,
    direction,
    counterparty: who,
    /* WHICH ROW the counterparty was read off. A beneficiary or remitter row
       names a person's account; a merchant row names a shop. classify.mjs
       reads this so a name off a beneficiary row is never shown to the model,
       whatever transaction_type above ends up saying. Not a template field:
       a template-read mail carries the shape's frozen transaction_type, which
       is 'p2p_transfer' for every shape this was true of. */
    counterparty_row: whoRow,
    /* The two sides (email-reading-v2 §4), raw as printed; `_tidy` masks the
       account to its last four. The KIND of counterparty is not decided here:
       signals.mjs decides it for every tier from these same fields. */
    holder_name: got.holder || null,
    counterparty_bank: got.cp_bank || null,
    counterparty_account_tail: cpAccount,
    memo,
    /* The transaction-kind row as printed ("Thanh toán dịch vụ - hàng hóa").
       Read by signals.mjs for the signal and the channel; never sealed. */
    txn_kind: got.txn_kind || null,
    reference_number: got.reference || null,
    status: got.status || null,
    /* AS THE MAIL PRINTED IT, not masked here (2026-09-02). Masking moved to
       the one place every tier's output already passes through — `_tidy` in
       extract.mjs — because masking BEFORE the template learner ran was
       silently killing graduation: the learner requires each value verbatim in
       the body, `…9979` never is, and a shape that cannot graduate pays a
       model call per mail forever. Three of the five real shapes we hold were
       blocked by exactly this. The last-four-only invariant is unchanged and
       still pinned in tests — what changed is WHERE it is enforced, not
       whether. Nothing reads this tier's output except extract.mjs, which
       tidies, and the learner, which needs the raw. */
    account_masked: account,
    /* The credit card the mail named, if any (card-repayment-routing-spec.md).
       Raw as printed here; `_tidy` masks it to last-4 like account_masked, and
       the learner needs the verbatim value to anchor it. Role-neutral: the
       client uses it as the repaid card only on rows it classifies as a card
       payment. Null on every mail that named no card. */
    card_masked: got.card || null,
    category: null,                              // the client's learning owns this
    flow: self ? 'transfer' : null,              // anything else is stage.mjs's judgement
    balance: got.balance ? (parseAmountCell(got.balance) || {}).value ?? null : null,
  };

  /* PROVENANCE (contract.mjs SRC): everything above was read off a labelled row
     of THIS mail, so it is `printed`, the direction included (a printed sign,
     printed wording, or which rows the mail printed at all). Two things are
     not: the own-accounts verdict and the transfer/receipt type are rules run
     over those rows. Only fields that carry a value are listed. */
  const src = {};
  for (const k of ['occurred_at', 'time_precision', 'amount', 'currency', 'fx_amount', 'fx_currency',
    'fee_amount', 'available_limit', 'direction', 'counterparty', 'holder_name', 'counterparty_bank',
    'counterparty_account_tail', 'memo', 'reference_number', 'status', 'account_masked', 'card_masked', 'balance']) {
    if (out[k] != null) src[k] = 'printed';
  }
  if (out.flow) src.flow = 'heuristic';
  // ...and the type is a rule too — listed only when it reached a verdict, like
  // every other field here: a source under a null value reads as a withdrawn
  // answer (signals.mjs crossCheckSignal), which is not what a null means here.
  if (out.transaction_type) src.transaction_type = 'heuristic';
  out.src = src;

  /* Which PRINTED LABEL each field was read under (labels only, never values):
     what formats.mjs turns into a stored label map. Keyed by the row field. */
  const labels = {};
  for (const f of Object.keys(gotLabel)) labels[f] = gotLabel[f];
  out.labels = labels;
  out.read_fields = { amount: amountField, memo: memoField, account: accountField, who: whoRow };
  return out;
}
