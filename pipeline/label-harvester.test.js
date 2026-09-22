#!/usr/bin/env node
/* The label harvester collects LABELS. A label's value is never a candidate.
 * `node pipeline/label-harvester.test.js`
 *
 * `extract_miss_labels` is the one piece of "training data" this pipeline is
 * allowed to keep: the bank's own boilerplate, never a value. On 2026-09-21 it
 * held 101 rows and 58 of them were values: a person's full name, salutations,
 * disclaimer fragments, mask characters, merchants, a city, a film title
 * (docs/specs/email-reading-v2-spec.md §11).
 *
 * THE ROOT BUG was in the line-form loop. After accepting a line as a label it
 * moved to the NEXT line, which is that label's VALUE, and tested it as a
 * candidate; the value passed, because the line after it was another unknown
 * label. Known labels had the same hole: their value line was tested too.
 *
 * Pinned:
 *   • the value line after a known label, and after an accepted unknown label,
 *     is stepped over and never harvested
 *   • the tightened shape rules: no letter, an undecoded entity, a trailing
 *     , - –, a lowercase first letter, a 3+ Title-Case run with no label head
 *   • the wider deny list: salutations, sign-offs, disclaimers (VN and EN)
 *   • real labels still get through, Title-Cased ones included
 *   • mailtext decodes entities BEFORE anything matches, in text/plain too
 *
 * Every name, merchant and title below is SYNTHETIC.
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const { unknownLabels, readLabelTable } = await import(ROOT + 'labeltable.mjs');
const MT = await import(ROOT + 'mailtext.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

/* ── the loop bug ────────────────────────────────────────────────────────── */
/* Mixed-case values on purpose: nothing here has a digit, a caps run or a
   currency mark, so no SHAPE rule catches it. Only the loop fix does. */
const BODY = [
  'Người đại diện',       // unknown label ("Chủ tài khoản" stood here until it joined the vocabulary, 2026-09-22)
  'Nguyễn Văn',           // ...its value: a (synthetic) name, two Title-Case words
  'Rạp chiếu',            // unknown label
  'Rạp Sao Mai',          // ...its value: a venue
  'Tên phim',             // unknown label
  'Chuyện mùa hè',        // ...its value: a film title
  'Thành phố',            // unknown label
  'Đà Lạt',               // ...its value: a city
  'Điểm giao dịch',       // KNOWN label (merchant)
  'Quán Cây Bàng',        // ...its value: a merchant
  'Ghi chú thêm',         // unknown label
  'tiền vé xem phim',     // ...its value
].join('\n');

console.log('\n-- a label\'s value line is never a candidate --');
const got = unknownLabels(BODY);
const has = (x) => got.includes(x);
t('the unknown labels are harvested', has('Người đại diện') && has('Rạp chiếu') && has('Tên phim') && has('Thành phố') && has('Ghi chú thêm'), got);
t('NOT the person\'s name under "Người đại diện"', !has('Nguyễn Văn'), got);
t('NOT the venue', !has('Rạp Sao Mai'), got);
t('NOT the film title', !has('Chuyện mùa hè'), got);
t('NOT the city', !has('Đà Lạt'), got);
t('NOT the merchant under a KNOWN label', !has('Quán Cây Bàng'), got);
t('exactly the five labels, nothing else', got.length === 5, got);

{
  /* A known label followed by ANOTHER known label is a field the bank left
     empty. The second label keeps its own value; it is not swallowed as one. */
  const g = unknownLabels(['Nội dung', 'Điểm giao dịch', 'Quán Cây Bàng', 'Hạng thẻ', 'Bạch kim'].join('\n'));
  t('an empty known field does not throw the pairing off', g.includes('Hạng thẻ') && !g.includes('Quán Cây Bàng') && !g.includes('Bạch kim'), g);
}
{
  /* The bilingual twin sits between a known label and its value; the value is
     the line after the twin, and it is that line that must be stepped over. */
  const g = unknownLabels(['Sử dụng tại', 'At', 'Quán Cây Bàng', 'Hạng thẻ', 'Bạch kim'].join('\n'));
  t('a known label\'s value is stepped over past its English twin', !g.includes('Quán Cây Bàng') && g.includes('Hạng thẻ') && !g.includes('Bạch kim'), g);
}
{
  const g = unknownLabels('| Hạng thẻ | Bạch kim |\n| Rạp chiếu | Rạp Sao Mai |');
  t('pipe rows are unchanged: the label cell only', g.includes('Hạng thẻ') && g.includes('Rạp chiếu') && g.length === 2, g);
}

/* ── the shape rules ─────────────────────────────────────────────────────── */
console.log('\n-- what is value-shaped is refused even when the loop offers it --');
/* Pipe rows hand the label cell straight to the shape rules, which makes them
   the way to test one rule at a time. */
const refused = (cell) => !unknownLabels('| ' + cell + ' | x |').includes(cell);
t('no letter at all: mask characters', refused('●●●● ●●●●'));
t('no letter at all: a rule', refused('-----'));
t('an undecoded numeric entity', refused('Nguy&#7877;n V&#259;n'));
t('an undecoded named entity', refused('Ng&agrave;y h&ecirc;t han'));
t('a trailing comma: half an address', refused('Phường Bến Nghé,'));
t('a trailing dash', refused('Chi nhánh Sài Gòn -'));
t('a trailing en dash', refused('Chi nhánh Sài Gòn –'));
t('a lowercase first letter: a wrapped continuation line', refused('của ngân hàng chúng tôi'));
t('three Title-Case words: a person', refused('Nguyễn Văn An'));
t('four Title-Case words: a place', refused('Thành Phố Hồ Chí Minh'.replace('Thành Phố ', 'Quận Bình ')));
t('a Title-Case film title', refused('Chuyện Mùa Hè Năm Ấy'));
t('...inside a longer cell too', refused('Khách hàng Trần Thị Bình'));

console.log('\n-- the deny list: salutations, sign-offs, disclaimers --');
for (const cell of ['Xin chào Nguyễn Văn', 'Dear Customer', 'Thân gửi anh', 'Bạn thân mến', 'Yours faithfully',
  'Unsubscribe here', 'Best regards', 'Thank you', 'Thư này được gửi tự động', 'Vui lòng không trả lời thư này',
  'This email is confidential', 'Disclaimer', 'Confidential notice', 'Do not reply', 'All rights reserved',
  'Lưu ý quan trọng', 'Bản quyền thuộc về']) {
  t(JSON.stringify(cell), refused(cell));
}

console.log('\n-- and the real vocabulary still gets through --');
const kept = (cell) => unknownLabels('| ' + cell + ' | x |').includes(cell);
/* "Phí (bao gồm VAT)" and "Diễn giải" were the two examples here until
   2026-09-22, when the harvest did its job and both joined the vocabulary
   (labeltable.mjs LABELS: fee, memo). A label the reader knows is no longer a
   miss, so the same two shapes are pinned with labels it still does not know. */
t('"Thuế (bao gồm VAT)"', kept('Thuế (bao gồm VAT)'));
t('"Ghi chú"', kept('Ghi chú'));
t('a label that joined the vocabulary is no longer harvested', !kept('Diễn giải') && !kept('Phí (bao gồm VAT)'));
t('"Mã khách hàng"', kept('Mã khách hàng'));
t('"Hạng thẻ"', kept('Hạng thẻ'));
t('a Title-Cased label opens with a label head word: "Ngày Hết Hạn"', kept('Ngày Hết Hạn'));
t('"Mã Khách Hàng"', kept('Mã Khách Hàng'));
t('an English one: "Payment Method Used"', kept('Payment Method Used'));
t('two Title-Case words stay learnable: "Ghi Chú"', kept('Ghi Chú'));

/* ── mailtext: entities decoded before anything matches ──────────────────── */
console.log('\n-- mailtext decodes entities before matching --');
t('numeric, decimal and hex', MT.decodeEntities('S&#7889; ti&#x1EC1;n') === 'Số tiền', MT.decodeEntities('S&#7889; ti&#x1EC1;n'));
t('Latin-1 letter entities, the way an older generator writes Vietnamese', MT.decodeEntities('Ng&agrave;y giao d&#7883;ch') === 'Ngày giao dịch');
t('...case-sensitively', MT.decodeEntities('&Agrave; &agrave; &Ocirc; &ocirc;') === 'À à Ô ô');
t('quotes, dashes, spaces', MT.decodeEntities('&ldquo;a&rdquo;&nbsp;&ndash;&nbsp;b') === '"a" - b');
t('an unknown entity is left exactly as written', MT.decodeEntities('AT&T; &bogus; R&D') === 'AT&T; &bogus; R&D');
t('an entity named like an Object property is not a lookup hit', MT.decodeEntities('&constructor; &toString;') === '&constructor; &toString;');
t('a TEXT/PLAIN body is decoded too (it used to return early, untouched)',
  MT.toText('S&#7889; ti&#7873;n\n150,000 VND') === 'Số tiền\n150,000 VND', MT.toText('S&#7889; ti&#7873;n\n150,000 VND'));
{
  const html = '<table><tr><td>Ng&agrave;y, gi&#7901; giao d&#7883;ch</td><td>2026-09-20 08:15:00</td></tr>' +
    '<tr><td>&#272;i&#7875;m giao d&#7883;ch</td><td>ZQ MART 01</td></tr>' +
    '<tr><td>S&#7889; ti&#7873;n</td><td>-90,000 VND</td></tr></table>';
  const r = readLabelTable('Thong bao', MT.toText(html));
  t('so an entity-encoded table is READ by the free tier', !!r && r.amount === 90000 && r.counterparty === 'ZQ MART 01', r);
  const g = unknownLabels(MT.toText('<table><tr><td>H&#7841;ng th&#7867;</td><td>B&#7841;ch kim</td></tr><tr><td>S&#7889; ti&#7873;n</td><td>1 VND</td></tr></table>'));
  t('and the harvester sees words, not entities', g.includes('Hạng thẻ') && !g.some((l) => l.includes('&')), g);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
