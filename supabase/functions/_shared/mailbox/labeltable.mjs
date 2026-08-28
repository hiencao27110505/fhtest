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

/** One label vocabulary, Vietnamese-first with the English twins the bilingual
 *  banks append. Matched against a diacritic-stripped, lowercased label cell,
 *  by CONTAINS — VCB writes "Số tiền Transaction Amount" as one cell. Order
 *  matters where vocabularies overlap: the first hit wins, so the more specific
 *  entry sits above the generic one ("số tiền phí" must never read as amount). */
const LABELS = [
  /* The absorber row. Sits ABOVE amount so that any "số tiền …" variant that
     is NOT the transaction amount — fees, promo/cashback figures, reward
     points — is swallowed here instead of contains-matching into `amount`.
     Found by a test fixture: "Số tiền khuyến mãi" read as the amount. */
  { field: 'charge',       any: ['so tien phi', 'charge amount', 'loai phi',
                                 'khuyen mai', 'so tien hoan', 'cashback', 'diem thuong', 'tich diem'] },
  { field: 'amount',       any: ['so tien giao dich', 'so tien', 'transaction amount', 'amount'] },
  { field: 'occurred_at',  any: ['ngay, gio giao dich', 'ngay gio giao dich', 'trans. date', 'date, time', 'thoi gian giao dich'] },
  { field: 'merchant',     any: ['diem giao dich', 'su dung tai', 'merchant'] },
  { field: 'beneficiary',  any: ['ten nguoi huong', 'nguoi thu huong', 'beneficiary name'] },
  { field: 'remitter',     any: ['ten nguoi chuyen', "remitter's name", 'remitter'] },
  { field: 'memo',         any: ['noi dung chuyen tien', 'noi dung', 'details of payment'] },
  { field: 'account',      any: ['tai khoan trich no', 'tai khoan nguon', 'so tai khoan', 'debit account', 'tk cham'] },
  { field: 'reference',    any: ['so lenh giao dich', 'so tham chieu', 'order number', 'ma giao dich', 'reference number'] },
  { field: 'status',       any: ['tinh trang', 'trang thai', 'status'] },
  { field: 'balance',      any: ['so du', 'balance'] },
  { field: 'txn_kind',     any: ['loai giao dich', 'transaction type'] },
  { field: 'card',         any: ['the card', 'the'] },
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
function _rows(body) {
  const out = [];
  const lines = String(body || '').split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2) out.push({ label: cells[0], value: cells[1] });
      else if (cells.length === 1 && _lookup(cells[0]) && lines[i + 1]) {
        // piped label with its value on the following line
        const next = lines[i + 1].split('|').map((c) => c.trim()).filter(Boolean);
        if (next.length === 1 && !_lookup(next[0])) { out.push({ label: cells[0], value: next[0] }); i++; }
      }
      continue;
    }
    // line form: a known label, value on the next non-empty line
    if (_lookup(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      const val = (lines[j] || '').replace(/^\|/, '').replace(/\|$/, '').trim();
      if (val && !_lookup(val)) { out.push({ label: line, value: val }); i = j; }
    }
  }
  return out;
}

function _lookup(labelCell) {
  const flat = _strip(labelCell);
  if (!flat) return null;
  for (const entry of LABELS) {
    for (const key of entry.any) if (flat.includes(key)) return entry.field;
  }
  return null;
}

/** "-37,000 VND" | "(VND) 2,000.00" | "15,000 VND" → { value, negative }.
 *  VN bank notation: comma groups thousands; a trailing .00 (or ,00) is decimals.
 *  Returns null when the cell does not parse as one clean number. */
export function parseAmountCell(raw) {
  const s = String(raw || '').replace(/VND|đ|dong/gi, '').trim();
  const m = s.match(/(-)?\s*([\d.,]+)/);
  if (!m) return null;
  let digits = m[2];
  // strip ONE decimal tail if present, then everything else is grouping
  digits = digits.replace(/[.,]\d{2}$/, '');
  digits = digits.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = parseInt(digits, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, negative: !!m[1] };
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
export function unknownLabels(body) {
  const out = new Set();
  const lines = String(body || '').split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2 && !_lookup(cells[0]) && cells[0].length <= 60 && !/\d{4,}/.test(cells[0])) out.add(cells[0]);
      continue;
    }
    if (_lookup(line)) continue;
    if (line.length <= 48 && !/\d/.test(line) && /\d/.test(lines[i + 1] || '')) out.add(line);
  }
  return [...out].slice(0, 24);
}

export function readLabelTable(subject, body) {
  const rows = _rows(body);
  if (rows.length < 3) return null;

  const got = {};
  for (const row of rows) {
    const field = _lookup(row.label);
    if (field && !(field in got)) got[field] = row.value;   // first hit wins; later dupes are footer noise
  }

  const amt = parseAmountCell(got.amount);
  const when = got.occurred_at ? parseWhenCell(got.occurred_at) : null;
  const who = got.merchant || got.beneficiary || null;

  // The confidence gate. Money, a moment, and a counterpart (or at least a
  // memo): anything less is not a ledger row, and the model gets to judge it.
  if (!amt || !when || !(who || got.memo)) return null;

  const kindFlat = _strip((got.txn_kind || '') + ' ' + (subject || ''));
  const refund = /hoan tien|refund|ghi co/.test(kindFlat + ' ' + _strip(got.status || ''));
  const isTransfer = !!(got.beneficiary || got.remitter)
    || /chuyen tien|chuyen khoan|bien lai/.test(kindFlat);

  // Direction: the sign when the bank prints one; otherwise the document kind.
  // A card notice or an outgoing transfer is money leaving; a refund is not.
  const direction = amt.negative ? 'debit' : (refund ? 'credit' : 'debit');

  // Self-transfer: the sender and the beneficiary are the same letters. That
  // is the person moving money between their own pockets, and filing it as an
  // expense would quietly shrink a ledger by money that never left. The sender
  // side comes from the remitter row where the bank prints one (VCB), or from
  // the holder name inside the debit-account cell where it does not (MB writes
  // "NGUYEN THU TRANG - 3510…" as the account value and has no remitter row).
  const senderName = _personKey(got.remitter) || _personKey(got.account);
  const self = !!(senderName && got.beneficiary && senderName === _personKey(got.beneficiary));

  return {
    is_transaction: true,
    transaction_type: isTransfer ? 'p2p_transfer' : 'ecommerce_receipt',
    source_provider: null,                       // worker falls back to the sender registry
    occurred_at: when,
    amount: amt.value,
    currency: 'VND',
    direction,
    counterparty: who,
    memo: got.memo || null,
    reference_number: got.reference || null,
    status: got.status || null,
    account_masked: maskAccount(got.account),
    category: null,                              // the client's learning owns this
    flow: self ? 'transfer' : null,              // anything else is stage.mjs's judgement
    balance: got.balance ? (parseAmountCell(got.balance) || {}).value ?? null : null,
  };
}
