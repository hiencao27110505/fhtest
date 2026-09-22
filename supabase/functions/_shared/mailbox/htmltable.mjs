/**
 * Reading a bank mail's HTML table AS A TABLE.
 *
 * mailtext.mjs flattens markup into lines, and the label-table reader then
 * re-discovers the table from those lines: "a known label, value on the next
 * line". That works for the labels the vocabulary already knows and is blind to
 * every other row, because in flattened text an unknown label is just a line.
 * The markup never had that problem: `<tr><td>Diễn giải</td><td>…</td></tr>` IS
 * a label and its value, whatever the label says. This module keeps that
 * structure instead of throwing it away (email-reading-v2 §8.1 step 4), which is
 * what lets a format be keyed by its label set and lets a label the model cites
 * be found again as a row (formats.mjs).
 *
 * WHAT IT RETURNS: rows of CELLS, innermost tables included, in document order.
 * It has no vocabulary and makes no judgement about which cell is a label;
 * labeltable.mjs pairs the cells, because pairing is a question about labels.
 *
 * NOT A PARSER, AND DELIBERATELY SO. Bank HTML is machine-generated and messy
 * in machine ways: unclosed `<td>`, `<tr>` directly inside `<tr>`, tables nested
 * nine deep for layout, a real MoMo receipt that is 4.5MB of tracking markup.
 * So: ONE forward pass over the string with indexOf, no regex that can
 * backtrack across the document, a hard cap on input size, a cap on nesting,
 * and no throw on any input. Malformed markup yields fewer rows, and fewer rows
 * only means the line walk reads the mail instead.
 */

import { decodeEntities } from './mailtext.mjs';

/** Past this the mail is a marketing page or a receipt with inlined assets, and
 *  the line walk (which mailtext has already capped nothing on) is the reader.
 *  Every transaction notice in the 955-mail test set is under 70KB. */
export const MAX_HTML_CHARS = 1500000;
const MAX_DEPTH = 64;
const MAX_ROWS = 400;
const MAX_CELL_CHARS = 2000;

/* The same block list mailtext.mjs ends a line on, so a cell's text breaks into
   lines exactly where the flattened body does. That equality is what makes "the
   first line of the label cell" here and "the label line" there the same string
   (VCB prints "Sử dụng tại<br>At": label, then its English twin). */
const BLOCK = new Set(['br', 'p', 'div', 'tr', 'td', 'th', 'table', 'thead', 'tbody', 'li', 'ul', 'ol',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'section', 'article', 'header', 'footer']);
const DROP = new Set(['script', 'style', 'head', 'noscript']);

function _cellText(raw) {
  return decodeEntities(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} html
 * @return {Array<{cells: string[]}>} one entry per `<tr>` that closed with at
 *   least one text-bearing cell of its OWN. A cell that merely wraps a nested
 *   table is layout, not content: it contributes nothing, and the nested
 *   table's rows are returned in its place.
 */
export function htmlRows(html) {
  const out = [];
  try {
    const s = String(html || '');
    if (!s || s.length > MAX_HTML_CHARS || s.indexOf('<') < 0) return out;

    const stack = [];            // open <tr> contexts: { cells: [], open: null | {text, nested} }
    const top = () => stack[stack.length - 1];
    const closeCell = (row) => {
      if (!row || !row.open) return;
      if (!row.open.nested) row.cells.push(row.open.text.length > MAX_CELL_CHARS ? '' : _cellText(row.open.text));
      else row.cells.push(null);  // a layout cell: present, and not content
      row.open = null;
    };
    const closeRow = () => {
      const row = stack.pop();
      if (!row) return;
      closeCell(row);
      const own = row.cells.filter((c) => c !== null);
      if (own.some((c) => c) && !row.cells.some((c) => c === null) && out.length < MAX_ROWS) out.push({ cells: own });
    };
    const addText = (t) => { const row = top(); if (row && row.open && !row.open.nested) row.open.text += t; };

    let i = 0;
    const n = s.length;
    while (i < n) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { addText(s.slice(i)); break; }
      if (lt > i) addText(s.slice(i, lt));

      if (s.startsWith('<!--', lt)) {
        const end = s.indexOf('-->', lt + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      const gt = s.indexOf('>', lt + 1);
      if (gt < 0) break;                                   // a torn tag ends the document
      const closing = s.charCodeAt(lt + 1) === 47;         // '/'
      let j = lt + (closing ? 2 : 1), k = j;
      while (k < gt) {
        const c = s.charCodeAt(k);
        if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57)) k++; else break;
      }
      const tag = s.slice(j, k).toLowerCase();
      i = gt + 1;
      if (!tag) { continue; }

      if (!closing && DROP.has(tag)) {
        // Skip to the matching close. indexOf on the lower-cased needle twice
        // (as written, then upper) keeps this linear without lower-casing 4MB.
        const a = s.indexOf('</' + tag, i), b = s.indexOf('</' + tag.toUpperCase(), i);
        const at = a < 0 ? b : (b < 0 ? a : Math.min(a, b));
        if (at < 0) { i = n; continue; }
        const e = s.indexOf('>', at);
        i = e < 0 ? n : e + 1;
        continue;
      }

      if (tag === 'tr') {
        if (closing) { if (stack.length) closeRow(); }
        else {
          // A <tr> opened while the top row has NO open cell is a sibling whose
          // predecessor was never closed, not a child.
          if (stack.length && !top().open) closeRow();
          if (stack.length < MAX_DEPTH) stack.push({ cells: [], open: null });
        }
      } else if (tag === 'td' || tag === 'th') {
        const row = top();
        if (row) {
          closeCell(row);
          if (!closing) row.open = { text: '', nested: false };
        }
      } else if (tag === 'table') {
        const row = top();
        if (!closing && row && row.open) row.open.nested = true;
        // A closing </table> ends every row still open inside it. Rows opened
        // in THIS table sit above the row whose cell holds it; that row is the
        // nearest one whose open cell is marked nested.
        if (closing) {
          while (stack.length && !(top().open && top().open.nested)) closeRow();
        }
      } else if (BLOCK.has(tag)) {
        addText('\n');
      } else {
        addText(' ');                                      // an inline tag separates words, as in mailtext
      }
    }
    while (stack.length) closeRow();
  } catch { /* never throws: fewer rows, and the line walk reads the mail */ }
  return out;
}
