function stripDiacritics(s) {
  return s.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function norm(s) {
  return stripDiacritics(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const CSV_HEADER_ALIASES = {
  occurred_at: ['date', 'ngay', 'ngay giao dich', 'transaction date', 'posted date', 'txn date', 'ngay gd',
                'timestamp', 'time', 'thoi gian'],
  // A real bank statement has no single "amount": it has a debit column and a
  // credit column, and a running balance that must NEVER be mistaken for
  // either ("so du luy ke" is deliberately absent from every list here).
  amount: ['amount', 'so tien', 'value', 'so tien giao dich', 'phat sinh no', 'ghi no', 'debit', 'withdrawal', 'money out', 'tien ra',
           // Agribank abbreviates; VPBank writes the full phrase. The full
           // phrases MUST be listed: containment takes the longest alias, and
           // without them "so tien ghi co" would win as "so tien" -> amount,
           // quietly importing card payments as spending.
           'ps no', 'so tien ghi no', 'so tien no', 'rut ra'],
  credit: ['phat sinh co', 'ghi co', 'credit', 'deposit', 'money in', 'tien vao',
           'ps co', 'so tien ghi co', 'so tien co', 'gui vao'],
  description: ['description', 'noi dung', 'dien giai', 'memo', 'note', 'noi dung giao dich',
                'mo ta', 'mo ta giao dich', 'chi tiet giao dich', 'transactions in detail', 'details',
                'don hang', 'order', 'san pham'],   // BNPL exports name the purchase, not a "description" 
  category: ['category', 'loai', 'danh muc', 'nhom', 'group'],
  // A credit-card statement names every merchant's line of business in MCC
  // codes -- a gift for categorisation nothing else in the file provides.
  mcc: ['mcc', 'mcc code', 'mcc mcc'],
  counterparty: ['payee', 'doi tac', 'merchant', 'nguoi nhan', 'nguoi gui', 'don vi thu huong', 'don vi chuyen',
                 'don vi thu huong/ don vi chuyen', 'don vi thu huong / don vi chuyen', 'ben nhan', 'nguoi huong'],
  currency: ['currency', 'loai tien', 'don vi'],
  paid_by: ['ai tra', 'paid by'],
  split_with: ['chia voi', 'split with'],
};

const CSV_DATE_PATTERNS = [
  // Everyone records dates differently, and a bank export often carries a
  // time too. Order matters: unambiguous shapes first, so a file that mixes
  // conventions still resolves from the rows that CAN'T be misread.
  [/^\d{4}-\d{1,2}-\d{1,2}([ T].*)?$/, 'iso'],              // 2026-08-01, or with a time
  [/^\d{4}\/\d{1,2}\/\d{1,2}([ T].*)?$/, 'iso_slash'],     // 2026/08/01
  [/^\d{8}$/, 'compact'],                                    // 20260801
  [/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}([ T].*)?$/, 'dmy_4'], // 01/08/2026 · 01.08.2026 · 01-08-2026
  [/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2}([ T].*)?$/, 'dmy_2'], // 01/08/26
  [/^\d{1,2}[\/.-]\d{1,2}$/, 'dm_noyear'],                  // 1/8 — year assumed
  [/^\d{1,2}[ -][A-Za-z]{3,}[ -]\d{4}$/, 'd_mon_y'],         // 01 Aug 2026 · 01-Aug-2026
  [/^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}$/, 'mon_d_y'],        // Aug 1 2026 · August 1, 2026
  [/^\d{1,2}\s*(thg|thang)\s*\d{1,2},?\s*\d{4}$/i, 'vi_thg'], // 01 thg 8, 2026
];

function classifyDate(raw) {
  const v = (raw || '').trim();
  if (!v) return { status: 'missing' };
  for (const [pat, format] of CSV_DATE_PATTERNS) {
    if (pat.test(v)) return { status: 'matched', format };
  }
  return { status: 'unrecognized' };
}

function classifyAmount(raw) {
  let v = (raw || '').trim();
  if (!v) return { status: 'missing' };
  const flags = [];
  if (v.includes('đ') || /vnd/i.test(v)) {
    flags.push('embedded_currency_symbol');
    v = v.replace(/đ/gi, '').replace(/vnd/gi, '').trim();
  }
  const negative = v.startsWith('-');
  let core = negative ? v.slice(1) : v;
  if (negative) flags.push('negative_sign');

  /* VN shorthand: "45k" = 45.000, "1tr2" = 1.200.000, "2 ty" = 2.000.000.000.
     A number carrying NO marker is taken literally -- 45000 means 45000, never
     45 million. (The bulk-logging composer additionally promotes a bare VND
     number under 1000, because the ledger stores VND in units of 1.000d and a
     hand-typed "45" can't otherwise be represented; a file's amounts are real
     figures, so no such promotion happens here.) */
  let mult = 1, fracTail = '';
  const sm = stripDiacritics(core).match(/^([\d.,\s]*\d)\s*(ty|ti|tr|trieu|k|nghin|ngan)\s*(\d*)$/i);
  if (sm) {
    const unit = sm[2].toLowerCase();
    mult = (unit === 'ty' || unit === 'ti') ? 1e9 : (unit === 'tr' || unit === 'trieu') ? 1e6 : 1e3;
    fracTail = sm[3] || '';
    core = sm[1].trim();
    flags.push('shorthand_suffix');
  }

  /* Both separators present means one is grouping and one is decimals, and
     the LAST one is the decimal mark: "1.234.567,00" (VN banks, EU locales)
     against "1,234,567.89". Stripping both -- what this did before -- read a
     574.195,00đ purchase as 57 million: a 100x error on every row of a VIB
     statement. A lone comma with one or two digits after it is a decimal
     comma for the same reason. */
  const hasDot = core.includes('.');
  const hasComma = core.includes(',');
  let style;
  if (hasDot && hasComma) {
    style = (core.lastIndexOf(',') > core.lastIndexOf('.')) ? 'eu_decimal' : 'decimal_2dp';
  } else if (hasDot) {
    const parts = core.split('.');
    style = parts[parts.length - 1].length === 3 ? 'vn_grouped' : 'decimal_2dp';
  } else if (hasComma) {
    const parts = core.split(',');
    style = (parts.length === 2 && parts[1].length <= 2) ? 'eu_decimal'
          : parts[parts.length - 1].length === 3 ? 'en_grouped' : 'comma_unclear';
  } else {
    style = 'plain';
  }

  const cleaned = style === 'decimal_2dp' ? core.replace(/,/g, '')
                : style === 'eu_decimal'  ? core.replace(/\./g, '').replace(',', '.')
                : core.replace(/[.,]/g, '');
  let value = Number(cleaned);
  if (Number.isNaN(value)) return { status: 'unparseable', flags };
  value = Math.round(value);   // the ledger holds whole dong; ,00 tails are formatting
  // "1tr2" is one-and-two-tenths million, not 1 million then a stray 2.
  if (mult > 1) value = Math.round((fracTail ? Number(String(cleaned)) : value) * mult);
  /* A statement writes "0,00" in the debit column of every credit row and
     vice versa. That zero is the ABSENCE of a figure, not a free purchase --
     letting it through as ok turns half the rows of any two-column statement
     into phantom transactions. */
  if (value === 0) return { status: 'zero', flags };
  return { status: 'ok', style, value, flags };
}

// Stage 1 (header alias) + Stage 2 (content sniff). Free, no network call.
/* Find the row the table actually starts on.

   A bank statement doesn't begin with its column names. It begins with the
   bank's name, the account number, the holder, the reporting period -- and
   only then the header row. Taking row 1 on faith makes "NGÂN HÀNG TMCP QUÂN
   ĐỘI" the header, so every column fails to map and every transaction lands
   as a row with nothing in it. That is the single biggest reason a real
   statement imports as a screen full of "Thiếu ngày".

   So score the first handful of rows by how many cells are recognisable
   column names, and start there instead. A preamble line scores zero -- it is
   prose, not headers -- and a genuine header row scores at least two, which
   is what keeps this from firing on a file that simply has no preamble. */
function fhFindHeaderRow(headers, rows) {
  const score = (cells) => {
    if (!cells) return 0;
    let hits = 0;
    cells.forEach((c) => { if (matchHeaderField(norm(c))) hits++; });
    return hits;
  };

  const best = { at: -1, hits: score(headers) };
  // A VIB credit-card statement puts ~26 rows of card metadata above its
  // table; 40 covers what banks actually do without scanning the whole file.
  const look = Math.min(rows.length, 40);
  for (let i = 0; i < look; i++) {
    const hits = score(rows[i]);
    if (hits > best.hits) { best.at = i; best.hits = hits; }
  }
  // Row 0 already won, or nothing looked like a header at all.
  if (best.at < 0 || best.hits < 2) return { headers, rows, skipped: 0 };
  return { headers: rows[best.at].map((c) => String(c == null ? '' : c)),
           rows: rows.slice(best.at + 1),
           skipped: best.at + 1 };
}

// A column can be correctly identified (high mapping confidence) while its values still
// disagree on format (low format confidence) — that split, not the mapping itself, is
// what decides whether this file needs the Gemini fallback.
/* Exact alias first; then the alias as a bounded phrase inside the cell.
   A VIB statement writes every header bilingually in one cell -- "Ngày giao
   dịch\nTransaction date", "Ghi nợ/Debit (VND)" -- so exact matching sees
   nothing and the whole statement fails to map. The containment pass wants
   the longest alias it can find (so "ngay giao dich" beats "ngay") and only
   at word boundaries (so "date" never fires inside "update"). */
function matchHeaderField(hn) {
  if (!hn) return undefined;
  const exact = Object.keys(CSV_HEADER_ALIASES).find((f) => CSV_HEADER_ALIASES[f].includes(hn));
  if (exact) return exact;
  let best, bestLen = 0;
  Object.keys(CSV_HEADER_ALIASES).forEach((f) => {
    CSV_HEADER_ALIASES[f].forEach((alias) => {
      if (alias.length <= bestLen || alias.length < 4) return;
      const at = hn.indexOf(alias);
      if (at < 0) return;
      const before = at === 0 ? '' : hn[at - 1];
      const after = hn[at + alias.length] || '';
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) return;
      best = f; bestLen = alias.length;
    });
  });
  return best;
}

function resolveCsvHeuristically(headers, sampleRows) {
  const columnMap = {};
  headers.forEach((h, i) => {
    const field = matchHeaderField(norm(h));
    if (field) columnMap[i] = { field, confidence: 'high', source: 'header_alias' };
  });

  /* Sacombank heads its columns with just "Nợ" and "Có". Those normalise to
     'no' and 'co' -- two letters that also mean a row-number column ("No.")
     in English, so they are far too dangerous as ordinary aliases. But the
     PAIR is unambiguous: a lone "no" column is anyone's guess, a "no" AND a
     "co" side by side is a bank's debit and credit. Only the pair maps. */
  const bareNo = headers.findIndex((h) => norm(h) === 'no');
  const bareCo = headers.findIndex((h) => norm(h) === 'co');
  if (bareNo >= 0 && bareCo >= 0) {
    if (!columnMap[bareNo]) columnMap[bareNo] = { field: 'amount', confidence: 'high', source: 'header_alias' };
    if (!columnMap[bareCo]) columnMap[bareCo] = { field: 'credit', confidence: 'high', source: 'header_alias' };
  }

  const fieldCol = (field) => {
    const entry = Object.entries(columnMap).find(([, m]) => m.field === field);
    return entry ? Number(entry[0]) : undefined;
  };
  const dateCol = fieldCol('occurred_at');
  const amountCol = fieldCol('amount');
  const hasDescription = fieldCol('description') !== undefined;

  const dateFormatsSeen = new Set();
  const amountStylesSeen = new Set();
  let hasMissingRequired = false;

  for (const row of sampleRows) {
    if (dateCol !== undefined) {
      const d = classifyDate(row[dateCol]);
      if (d.status === 'matched') dateFormatsSeen.add(d.format);
      if (d.status === 'missing') hasMissingRequired = true;
    }
    if (amountCol !== undefined) {
      const a = classifyAmount(row[amountCol]);
      if (a.status === 'ok') amountStylesSeen.add(a.style);
      if (a.status === 'missing') hasMissingRequired = true;
    }
  }

  const requiredFieldsMapped = dateCol !== undefined && amountCol !== undefined && hasDescription;
  // A single day<=12 row can't disambiguate dd/mm vs mm/dd on its own, but a genuinely
  // mixed set of formats across the sample (ISO here, "Jul 9 2026" there) means there is
  // no single convention to infer per-column — that's a file-shape question, not a per-row one.
  const dateAmbiguous = dateCol !== undefined && dateFormatsSeen.size > 1;
  const amountAmbiguous = amountCol !== undefined && amountStylesSeen.size > 1;

  const needsLLM = !requiredFieldsMapped || dateAmbiguous || amountAmbiguous;
  const reason = !requiredFieldsMapped
    ? 'required_field_unmapped'
    : dateAmbiguous
    ? 'date_format_ambiguous'
    : amountAmbiguous
    ? 'amount_format_ambiguous'
    : null;

  return {
    columnMap,
    dateFormatsSeen: [...dateFormatsSeen],
    amountStylesSeen: [...amountStylesSeen],
    hasMissingRequired,
    needsLLM,
    reason,
  };
}

// Masking happens right here, at the actual network boundary, rather than
// relying on every caller to remember to mask before invoking this — the
// data leaves the device at this line, so this is where the guard has to
// live. See CSV-IMPORT-ENCRYPTION.md / 43-redact-for-sharing.js.
async function callCsvMappingFallback(headers, sampleRows) {
  const capped = sampleRows.slice(0, 15);
  const outbound = (typeof fhShouldMaskForSharing === 'function' && fhShouldMaskForSharing())
    ? fhMaskSampleRowsForSharing(capped)
    : capped;
  // Attach the caller's Supabase access token so the serverless proxy can verify a
  // real signed-in user before spending a Gemini call (the endpoint is otherwise
  // open to the internet and could be farmed against our key).
  let _tok = '';
  try { _tok = ((await sb.auth.getSession()).data.session || {}).access_token || ''; } catch (e) {}
  const res = await fetch('/api/csv-column-mapping', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, _tok ? { Authorization: 'Bearer ' + _tok } : {}),
    body: JSON.stringify({ headers, sampleRows: outbound }),
  });
  if (!res.ok) {
    throw new Error(`csv-column-mapping failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Entry point. Runs the free heuristics first; only calls Gemini on a genuine miss.
// Blank/missing required values never reach the LLM — there's no signal for it to reason
// about, so `hasMissingRequired` rows always fall through to human review regardless.
async function resolveCsvMapping(headers, sampleRows) {
  const heuristic = resolveCsvHeuristically(headers, sampleRows);
  if (!heuristic.needsLLM) {
    return { ...heuristic, resolvedBy: 'heuristics' };
  }
  /* The model is a CONFIDENCE booster, never a gate. If the call fails --
     rate limited, offline, signed out, provider down -- fall back to what the
     heuristics already worked out rather than refusing the whole file. Rows
     the heuristics can't place then surface in the review for a human, which
     is the same safety net every other uncertain row uses. */
  try {
    const llm = await callCsvMappingFallback(headers, sampleRows);
    return { ...heuristic, llm, resolvedBy: 'gemini' };
  } catch (e) {
    console.warn('CSV column-mapping fallback unavailable; using heuristics', e);
    return { ...heuristic, resolvedBy: 'heuristics', llmFailed: true };
  }
}

window.fhResolveCsvMapping = resolveCsvMapping;
window.fhFindHeaderRow = fhFindHeaderRow;
// classifyDate/classifyAmount are also called from 57-csv-import-review.js
// (js-ui, global scope) to parse actual row values, not just classify a
// column's format -- js-data is module scope, so these need the same
// window bridge as resolveCsvMapping above.
window.classifyDate = classifyDate;
window.classifyAmount = classifyAmount;
