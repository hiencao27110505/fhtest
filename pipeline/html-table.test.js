#!/usr/bin/env node
/* The mail's HTML table, read AS A TABLE.
 * `node pipeline/html-table.test.js`
 *
 * mailtext.mjs flattens markup into lines and the label-table reader guesses the
 * rows back out of them, which is blind to any label it does not already know.
 * htmltable.mjs keeps `<tr>` as a row; labeltable.mjs pairs the cells and prefers
 * those rows when they pass the same confidence gate, falling back to the line
 * walk otherwise (docs/specs/email-reading-v2-spec.md §8.1 step 4).
 *
 * Measured on the owner's 955-mail test set (tools/scoreboard): where BOTH
 * readers succeed (463 mails) they disagree on nothing. The equality is by
 * construction, and this file pins the construction.
 *
 * Every fixture here is SYNTHETIC.
 *
 * Properties pinned:
 *   • gmail.getMessage returns the raw HTML part as `html`, additively
 *   • two-cell rows pair; nested layout tables contribute their INNER rows only
 *   • a bilingual label cell ("Sử dụng tại<br>At") reads as its first line
 *   • a four-cell row is two pairs only when both label cells resolve
 *   • entities decoded, inline tags stripped, script/style/comments dropped
 *   • malformed markup never throws; oversized input returns no rows
 *   • linear: a 1.2MB document is read in well under a second
 *   • structural and line readings of one mail agree field for field
 *   • an unknown label is a ROW structurally (what a learned format needs)
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const H = await import(ROOT + 'htmltable.mjs');
const L = await import(ROOT + 'labeltable.mjs');
const G = await import(ROOT + 'gmail.mjs');
const MT = await import(ROOT + 'mailtext.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const HTML = `<html><head><style>td{color:red}</style><title>x</title></head><body>
<!-- <tr><td>Số tiền</td><td>999</td></tr> -->
<table><tr><td>
  <table><tr><td><img src="logo.png"></td></tr></table>
  <table>
    <tr><td><b>Biên lai chuyển tiền</b></td></tr>
    <tr><td>
      <table>
        <tr><td><b>Ngày, giờ giao dịch</b><br><i>Trans. Date, Time</i></td><td>26-08-2026 20:04:26</td></tr>
        <tr><td><b>Tài khoản nguồn</b><br><i>Debit Account</i></td><td>0000000001</td></tr>
        <tr><td><b>Tên người hưởng</b><br><i>Beneficiary Name</i></td><td>TRAN THI B</td></tr>
        <tr><td><b>Tên ngân hàng hưởng</b><br><i>Beneficiary Bank Name</i></td><td>Ng&acirc;n h&agrave;ng ZQ</td></tr>
        <tr><td><b>Số tiền</b><br><i>Amount</i></td><td><span>2,000,000</span>&nbsp;VND</td></tr>
        <tr><td><b>Loại phí</b><br><i>Charge Code</i></td><td>Người chuyển trả<br><i>Exclude</i></td><td><b>Số tiền phí</b><br><i>Charge Amount<br>Net income<br>VAT</i></td><td>3,300<br>&nbsp;<br>3,000<br>300</td></tr>
        <tr><td><b>Mã khuyến nghị</b></td><td>ZQ-PROMO</td></tr>
        <tr><td><b>Nội dung chuyển tiền</b><br><i>Details of Payment</i></td><td>tien hoc thang 9</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr></table>
<script>var t = "<tr><td>Số tiền</td><td>1</td></tr>";</script>
</body></html>`;

console.log('\n-- htmlRows: structure, not vocabulary --');
const rows = H.htmlRows(HTML);
const two = rows.filter((r) => r.cells.length === 2);
t('the eight field rows come out', two.length === 7 && rows.some((r) => r.cells.length === 4), rows.map((r) => r.cells.length));
t('a layout cell that only WRAPS a table is not a row', !rows.some((r) => r.cells.some((c) => /Ngày, giờ[\s\S]*Số tiền/.test(c))));
t('a commented-out row is not a row', !rows.some((r) => r.cells.includes('999')));
t('a row inside <script> is not a row', !rows.some((r) => r.cells.includes('1')));
t('<br> inside a cell is a line break: label, then its English twin', two[0].cells[0] === 'Ngày, giờ giao dịch\nTrans. Date, Time', two[0].cells[0]);
t('entities decoded (Latin-1 letters and nbsp)', rows.some((r) => r.cells[1] === 'Ngân hàng ZQ') && rows.some((r) => r.cells[1] === '2,000,000 VND'), rows.map((r) => r.cells[1]));
t('inline tags are stripped, their text kept', rows.some((r) => r.cells[0].startsWith('Số tiền')));

console.log('\n-- it never throws, and it is bounded --');
for (const [name, bad] of [['unclosed cells', '<table><tr><td>Số tiền<td>1,000<tr><td>Ngày<td>x'],
  ['a torn tag', '<table><tr><td>a</td><td>b</td></tr><tr><td'], ['no table at all', '<p>hello</p>'],
  ['nothing', ''], ['null', null], ['not a string', 42], ['a stray </table>', '</table></tr></td><tr><td>a</td><td>b</td></tr>']]) {
  let threw = false, out = null;
  try { out = H.htmlRows(bad); } catch { threw = true; }
  t(name + ': no throw, an array', !threw && Array.isArray(out), out);
}
t('unclosed <td>/<tr> still yield the rows', H.htmlRows('<table><tr><td>Số tiền<td>1,000<tr><td>Ngày<td>x').length === 2);
t('past the size cap the answer is no rows, not a slow read', H.htmlRows('<table><tr><td>a</td><td>b</td></tr>' + 'x'.repeat(H.MAX_HTML_CHARS)).length === 0);
{
  const filler = '<div style="display:none">' + 'tracking-pixel '.repeat(40) + '</div>';
  const big = '<table>' + filler.repeat(1800) + '<tr><td>Số tiền</td><td>1,000 VND</td></tr></table>';
  const t0 = Date.now();
  const r = H.htmlRows(big);
  const ms = Date.now() - t0;
  t('a ' + Math.round(big.length / 1024) + 'KB document of nested noise is read in under a second (' + ms + 'ms)', ms < 1000 && r.length === 1, { ms, n: r.length });
  const deep = '<table><tr><td>'.repeat(500) + 'x' + '</td></tr></table>'.repeat(500);
  let threw = false; try { H.htmlRows(deep); } catch { threw = true; }
  t('500 levels of nesting do not throw', !threw);
}

console.log('\n-- labeltable: the markup first, the lines as the fallback --');
const body = MT.toText(HTML);
const viaCells = L.readLabelTable('Biên lai chuyển tiền', body, undefined, HTML);
const viaLines = L.readLabelTable('Biên lai chuyển tiền', body);
t('with HTML the reading is structural', viaCells && viaCells.rows_via === 'structural', viaCells && viaCells.rows_via);
t('without it, the same reader walks the lines, as it always did', viaLines && viaLines.rows_via === 'line', viaLines && viaLines.rows_via);
for (const k of ['amount', 'currency', 'direction', 'occurred_at', 'counterparty', 'memo', 'account_masked', 'fee_amount',
  'counterparty_bank', 'transaction_type', 'time_precision']) {
  t('both readers agree on ' + k, JSON.stringify(viaCells && viaCells[k]) === JSON.stringify(viaLines && viaLines[k]), [viaCells && viaCells[k], viaLines && viaLines[k]]);
}
t('the four-cell fee row paired: fee_amount is the FIRST figure of its cell', viaCells && viaCells.fee_amount === 3300, viaCells && viaCells.fee_amount);
t('the bilingual label reads as its Vietnamese line', viaCells && viaCells.labels.amount === 'Số tiền', viaCells && viaCells.labels);

console.log('\n-- an unknown label is a row structurally, and only structurally --');
const sRows = L.tableRows({ body, html: HTML });
const lRows = L.tableRows({ body });
t('tableRows picks the markup', sRows.via === 'structural' && lRows.via === 'line');
t('"Mã khuyến nghị" (unknown to the vocabulary) is a structural row', sRows.rows.some((r) => r.label === 'Mã khuyến nghị' && r.value === 'ZQ-PROMO'));
t('...and invisible to the line walk', !lRows.rows.some((r) => r.label === 'Mã khuyến nghị'));
t('a row with an EMPTY value is kept (the format is not different, the field is empty)',
  L.tableRows({ body: 'x', html: '<table><tr><td>Số tiền</td><td>1,000</td></tr><tr><td>Ngày giao dịch</td><td>11:00 01/09/2026</td></tr><tr><td>Diễn giải</td><td></td></tr></table>' })
    .rows.some((r) => r.label === 'Diễn giải' && r.value === ''));
t('a four-cell row whose label cells do NOT both resolve is not guessed at',
  !L.tableRows({ body: 'x', html: '<table><tr><td>Anh</td><td>1</td><td>Chị</td><td>2</td></tr><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr><tr><td>e</td><td>f</td></tr></table>' })
    .rows.some((r) => r.label === 'Anh'));
t('markup with fewer than three pairs leaves the mail to the line walk',
  L.tableRows({ body: 'Số tiền\n1,000', html: '<table><tr><td>Số tiền</td><td>1,000</td></tr></table>' }).via === 'line');
t('structural rows that fail the gate fall back to the lines',
  (function () {
    // The table holds three rows the vocabulary cannot make a reading of; the
    // transaction itself is inline text outside it.
    const html = '<table><tr><td>Ưu đãi</td><td>x</td></tr><tr><td>Hạng</td><td>y</td></tr><tr><td>Điểm</td><td>z</td></tr></table>'
      + '<div>Số thẻ: 0000***0000</div><div>Giá trị: 45,000 VND</div><div>Vào lúc: 18:52 25/08/2026</div><div>Tại ZQ COFFEE 01</div>';
    const r = L.readLabelTable('x', MT.toText(html), undefined, html);
    return r && r.rows_via === 'line' && r.amount === 45000;
  })());

console.log('\n-- gmail.getMessage: `html` is additive --');
{
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
  const both = { id: 'm1', threadId: 't', internalDate: '0', payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'a@zq.test' }, { name: 'Subject', value: 's' }],
    parts: [{ mimeType: 'text/plain', body: { data: b64('Số tiền\n1,000') } }, { mimeType: 'text/html', body: { data: b64('<table><tr><td>Số tiền</td><td>1,000</td></tr></table>') } }] } };
  const fake = (json) => async () => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
  const m = await G.getMessage('m1', 'tok', fake(both), MT);
  t('body is still text/plain when the mail has one', m.body === 'Số tiền\n1,000', m.body);
  t('html is the markup, decoded, not flattened', m.html === '<table><tr><td>Số tiền</td><td>1,000</td></tr></table>', m.html);
  const plainOnly = JSON.parse(JSON.stringify(both)); plainOnly.payload.parts.pop();
  t('a text-only mail has html null', (await G.getMessage('m1', 'tok', fake(plainOnly), MT)).html === null);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
