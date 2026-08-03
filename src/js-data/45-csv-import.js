function stripDiacritics(s) {
  return s.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function norm(s) {
  return stripDiacritics(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const CSV_HEADER_ALIASES = {
  occurred_at: ['date', 'ngay', 'ngay giao dich', 'transaction date', 'posted date', 'txn date'],
  amount: ['amount', 'so tien', 'value', 'so tien giao dich'],
  description: ['description', 'noi dung', 'dien giai', 'memo', 'note'],
  category: ['category', 'loai', 'danh muc'],
  counterparty: ['payee', 'doi tac', 'merchant', 'nguoi nhan', 'nguoi gui'],
  currency: ['currency', 'loai tien', 'don vi'],
  paid_by: ['ai tra', 'paid by'],
  split_with: ['chia voi', 'split with'],
};

const CSV_DATE_PATTERNS = [
  [/^\d{4}-\d{2}-\d{2}$/, 'iso'],
  [/^\d{1,2}\/\d{1,2}\/\d{4}$/, 'slash_4'],
  [/^\d{1,2}\/\d{1,2}\/\d{2}$/, 'slash_2'],
  [/^\d{1,2}-\d{1,2}-\d{4}$/, 'dash_4'],
  [/^\d{1,2}-\d{1,2}-\d{2}$/, 'dash_2'],
  [/^\d{1,2}\/\d{1,2}$/, 'slash_noyear'],
  [/^\d{1,2}-\d{1,2}$/, 'dash_noyear'],
  [/^[A-Za-z]{3}\s+\d{1,2}\s+\d{4}$/, 'month_name'],
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
  const core = negative ? v.slice(1) : v;
  if (negative) flags.push('negative_sign');

  const hasDot = core.includes('.');
  const hasComma = core.includes(',');
  let style;
  if (hasDot && hasComma) style = 'mixed_separators';
  else if (hasDot) {
    const parts = core.split('.');
    style = parts[parts.length - 1].length === 3 ? 'vn_grouped' : 'decimal_2dp';
  } else if (hasComma) {
    const parts = core.split(',');
    style = parts[parts.length - 1].length === 3 ? 'en_grouped' : 'comma_unclear';
  } else {
    style = 'plain';
  }

  const cleaned = style === 'decimal_2dp' ? core.replace(/,/g, '') : core.replace(/[.,]/g, '');
  const value = Number(cleaned);
  if (Number.isNaN(value)) return { status: 'unparseable', flags };
  return { status: 'ok', style, value, flags };
}

// Stage 1 (header alias) + Stage 2 (content sniff). Free, no network call.
// A column can be correctly identified (high mapping confidence) while its values still
// disagree on format (low format confidence) — that split, not the mapping itself, is
// what decides whether this file needs the Gemini fallback.
function resolveCsvHeuristically(headers, sampleRows) {
  const columnMap = {};
  headers.forEach((h, i) => {
    const hn = norm(h);
    const field = Object.keys(CSV_HEADER_ALIASES).find((f) => CSV_HEADER_ALIASES[f].includes(hn));
    if (field) columnMap[i] = { field, confidence: 'high', source: 'header_alias' };
  });

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

async function callCsvMappingFallback(headers, sampleRows) {
  const res = await fetch('/api/csv-column-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ headers, sampleRows: sampleRows.slice(0, 15) }),
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
  const llm = await callCsvMappingFallback(headers, sampleRows);
  return { ...heuristic, llm, resolvedBy: 'gemini' };
}

window.fhResolveCsvMapping = resolveCsvMapping;
