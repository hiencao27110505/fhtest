// RFC 4180-ish CSV parser: quoted fields, embedded commas/newlines inside quotes,
// "" as an escaped quote. Hand-rolled rather than a dependency — this repo has none,
// and a naive `line.split(',')` breaks on real exports (e.g. a VN bank amount written
// as "520,000" with the thousands comma inside quotes).
/* Which character actually separates the columns?

   Comma is only the default. Excel on a Vietnamese or European locale writes
   ';' (because ',' is its decimal mark), and its "Unicode Text" export is
   tab-separated. Counting candidate separators on the first line -- outside
   quotes -- and taking the winner handles all three without a setting anyone
   has to find. Comma wins ties, so a normal file can't be misread. */
function detectDelim(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && c === '\n') break;
    if (!inQuotes && counts[c] !== undefined) counts[c]++;
  }
  if (counts[';'] > counts[',']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

function parseCsv(text) {
  const delim = detectDelim(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Splits parsed rows into headers + data rows, dropping fully-blank lines
// (a blank line in the middle of a real export shouldn't become a phantom transaction).
function parseCsvFile(text) {
  const rows = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headers, ...dataRows] = rows;
  return { headers: headers || [], rows: dataRows };
}

window.fhParseCsvFile = parseCsvFile;
