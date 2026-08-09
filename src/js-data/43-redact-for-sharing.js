/* ═══ Redact-before-sharing (CSV-IMPORT-ENCRYPTION.md) ═══════════════════════
   One shared utility for masking sample data before it leaves the device to
   a third-party model (Gemini today; the bank-email pipeline will need the
   identical fix once it activates for encrypted families — see the doc for
   why this isn't embedded directly in 45-csv-import.js).

   Gated on family INTENT (fhEncState() !== 'off'), not device unlock status
   (fhEncOn()) — masking a network-bound sample isn't a write, it doesn't
   touch the key, so it should follow "this family turned encryption on"
   regardless of whether this device happens to be unlocked this session. */
function fhShouldMaskForSharing() {
  return (typeof fhEncState === 'function' ? fhEncState() : 'off') !== 'off';
}

/* Amount-shaped cell: every non-digit character (separators, currency
   symbols, decimal point, sign) stays exactly where it is; digits are
   replaced independently at random. Keeps the digit-count/separator shape
   classifyAmount() needs to resolve a file's format — that ambiguity is the
   only reason Gemini gets called on an amount column at all — without ever
   sending a real figure. Randomized per call, not a single reused fake
   value, so masked rows can't be diffed against each other to infer which
   transaction was bigger. */
function fhMaskAmountText(raw) {
  return String(raw || '').replace(/[0-9]/g, () => String(Math.floor(Math.random() * 10)));
}

/* Free-text cell (description/note-shaped): no shape needed here — Gemini
   only needs to know "this is a free-text column," so one fixed generic
   phrase is enough and leaks nothing about the real content. */
function fhMaskDescriptionText() {
  return 'ghi chú mẫu';
}

// Amount-shaped: digits with typical amount punctuation, no letters — the
// same signal classifyAmount() keys off, applied before the column mapping
// is known (that's the point: masking has to work without it).
function fhLooksAmountShaped(raw) {
  const v = String(raw || '').trim();
  if (!v) return false;
  return /^-?[\d.,\s₫$]*\d[\d.,\s₫$]*(k|tr|ty|ti|trieu|nghin|ngan|triệu|nghìn|ngàn|tỷ|tỉ)?\s*\d*$/i.test(v);
}

// Free-text-shaped: long enough and has letters — distinguishes a
// description from a short token (a category name, a single person's name
// in paid_by/split_with) that isn't in the protected-column set and doesn't
// need this treatment.
function fhLooksFreeTextShaped(raw) {
  const v = String(raw || '').trim();
  return v.length >= 12 && /[a-zA-ZÀ-ỹ]/.test(v);
}

/* Dates are deliberately left untouched: txn_date has no _enc column
   anywhere in the schema, so the app's own encryption model doesn't treat
   dates as sensitive, and date_convention inference needs the real values
   to work at all. */
function fhMaskRowForSharing(row) {
  return row.map((cell) => {
    if (fhLooksAmountShaped(cell)) return fhMaskAmountText(cell);
    if (fhLooksFreeTextShaped(cell)) return fhMaskDescriptionText();
    return cell;
  });
}

function fhMaskSampleRowsForSharing(sampleRows) {
  return sampleRows.map(fhMaskRowForSharing);
}

window.fhShouldMaskForSharing = fhShouldMaskForSharing;
window.fhMaskSampleRowsForSharing = fhMaskSampleRowsForSharing;
