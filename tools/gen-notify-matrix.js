#!/usr/bin/env node
/* gen-notify-matrix — the copy matrix doc, generated from the copy itself.

   docs/notify-copy-matrix.html used to be hand-maintained while claiming in its
   footer to be generated. It drifted the moment the lines moved into
   taxonomy/notify-lines.json (notification-activation-spec.md §6), and a doc that
   lies about its provenance is worse than no doc: someone reads a line here and
   ships copy the product does not have.

   Now it is really generated. The page shell (CSS, theme toggle, header prose) is
   embedded verbatim from the hand-written original; everything below it is built
   from the JSON, so a line can only appear here if it can appear on a phone.

   Run: npm run notify-matrix  (or node tools/gen-notify-matrix.js)
   Output is deterministic; the file ends with a newline like the other docs. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'notify-copy-matrix.html');
const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy', 'notify-lines.json'), 'utf8'));

/* Display only: the emoji and Vietnamese name each key is shown under. Kept
   HERE rather than in notify-lines.json so the runtime bundles stay free of
   documentation data — the generated .mjs and the client slice ship to a phone. */
const CONCEPT = {
  Dining: ['\u{1F35C}', 'Ăn uống'], Groceries: ['\u{1F96C}', 'Đi chợ'],
  Clothing: ['\u{1F457}', 'Quần áo'], Shopping: ['\u{1F6CD}\uFE0F', 'Mua sắm'],
  Transport: ['\u{1F6F5}', 'Di chuyển'], Housing: ['\u{1F3E0}', 'Nhà cửa'],
  Fun: ['\u{1F388}', 'Giải trí'], Others: ['\u{1F5C2}\uFE0F', 'Khác'],
  income: ['\u{1F4B0}', 'Thu nhập'], unknown: ['\u{1F4E5}', 'Chưa rõ · mặc định'],
};
const POOL = {
  coffee: ['\u2615', 'Cà phê'], milktea: ['\u{1F9CB}', 'Trà sữa'],
  ride: ['\u{1F695}', 'Đặt xe'], cinema: ['\u{1F3AC}', 'Rạp phim'],
};
const ITEM = {
  clothes: ['\u{1F455}', 'Quần áo & phụ kiện'], tech: ['\u{1F50C}', 'Điện tử & công nghệ'],
  kids: ['\u{1F9F8}', 'Đồ trẻ em'], hobby: ['\u{1F4DA}', 'Sách & sở thích'],
  fitness: ['\u{1F3C3}', 'Đồ thể thao'], beauty: ['\u{1F9F4}', 'Làm đẹp'],
  pets: ['\u{1F43E}', 'Thú cưng'], fresh: ['\u{1F966}', 'Đồ tươi, đi chợ'],
  medical: ['\u{1F48A}', 'Thuốc & y tế'], watch: ['\u{1F3AE}', 'Giải trí & xem'],
};
const BASKET = {
  solo: ['\u{1F3AF}', 'Một món gánh cả đơn'],
  many: ['\u{1F4E6}', 'Cả chục món một lượt'],
  voucher: ['\u{1F39F}\uFE0F', 'Voucher gánh phần lớn'],
};
const TIER = [
  ['Bậc 1', '\u2264 30.000đ', 'lặt vặt'],
  ['Bậc 2', '30.000đ \u2013 500.000đ', 'thường ngày'],
  ['Bậc 3', '500.000đ \u2013 5tr', 'đáng chú ý'],
  ['Bậc 4', '> 5tr', 'khoản lớn'],
];
const DAYPART = { sang: 'Sáng', trua: 'Trưa', chieu: 'Chiều', toi: 'Tối' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* One row per variant: index, the Vietnamese pair, then the English pair. The two
   languages sit side by side because that is how a reviewer catches a translation
   that lost the joke. */
function rows(vi, en, first) {
  let out = '';
  for (let i = 0; i < vi.length; i++) {
    const e = (en && en[i]) || { e: '', b: '' };
    out += '<tr>' + (i === 0 && first ? first : '')
      + '<td class="n">' + (i + 1) + '</td>'
      + '<td class="emo">' + esc(vi[i].e) + '</td><td class="b">' + esc(vi[i].b) + '</td>'
      + '<td class="emo">' + esc(e.e) + '</td><td class="b b-en">' + esc(e.b) + '</td></tr>';
  }
  return out;
}
const THEAD = '<thead><tr><th>Bậc tiền</th><th>#</th><th colspan="2">Tiếng Việt</th>'
  + '<th colspan="2">English</th></tr></thead>';
const THEAD2 = (lbl) => '<thead><tr><th>' + lbl + '</th><th>#</th><th colspan="2">Tiếng Việt</th>'
  + '<th colspan="2">English</th></tr></thead>';

function tierTable(c) {
  let body = '';
  for (let t = 0; t < 4; t++) {
    const cell = '<td rowspan="' + d.matrix.vi[c][t].length + '" class="tier">'
      + '<span class="tier-n">' + TIER[t][0] + '</span>'
      + '<span class="tier-r">' + esc(TIER[t][1]) + '</span>'
      + '<span class="tier-tag">' + TIER[t][2] + '</span></td>';
    body += rows(d.matrix.vi[c][t], d.matrix.en[c][t], cell);
  }
  return '<div class="scroll"><table>' + THEAD + '<tbody>' + body + '</tbody></table></div>';
}

function dayTable(table, key) {
  let body = '';
  for (const p of d.dayparts) {
    const vi = table.vi[key][p], en = table.en[key][p];
    const cell = '<td rowspan="' + vi.length + '" class="tier"><span class="tier-n">'
      + DAYPART[p] + '</span></td>';
    body += rows(vi, en, cell);
  }
  return '<div class="scroll"><table>' + THEAD2('Buổi') + '<tbody>' + body + '</tbody></table></div>';
}

function flatTable(vi, en, lbl, name) {
  const cell = '<td rowspan="' + vi.length + '" class="tier"><span class="tier-n">' + name + '</span></td>';
  return '<div class="scroll"><table>' + THEAD2(lbl) + '<tbody>' + rows(vi, en, cell)
    + '</tbody></table></div>';
}

function card(emo, title, key, inner) {
  return '<section class="card"><h2><span class="emo-h">' + emo + '</span>' + title
    + ' <span class="key">' + esc(key) + '</span></h2>' + inner + '</section>\n';
}

let out = '';

// ── the concept × tier matrix, with daypart overrides where they exist ───────
for (const c of Object.keys(CONCEPT)) {
  const [emo, vi] = CONCEPT[c];
  const hasDay = d.daypart.vi[c];
  let inner = '<div class="sub-lbl">Theo bậc tiền'
    + (hasDay ? ' · dùng khi không rõ giờ' : '') + '</div>' + tierTable(c);
  if (hasDay) {
    inner += '<div class="sub-lbl">Theo buổi trong ngày · ưu tiên khi biết giờ giao dịch</div>'
      + dayTable(d.daypart, c);
  }
  out += card(emo, vi, c, inner);
}

// ── merchant keyword pools ───────────────────────────────────────────────────
out += '<div class="subhead">Pool từ khoá nơi bán</div>'
  + '<p class="sub-note">Ưu tiên hơn ma trận trên, nhưng chỉ khi tên nơi bán khớp từ khoá. '
  + 'Cà phê và trà sữa còn đổi câu theo buổi trong ngày.</p>\n';
for (const p of Object.keys(d.poolLines.vi)) {
  const [emo, vi] = POOL[p] || ['\u{1F516}', p];
  let inner = '<div class="kw">' + esc(d.pools[p].join(' · ').toUpperCase()) + '</div>'
    + '<div class="sub-lbl">Câu chung</div>'
    + flatTable(d.poolLines.vi[p], d.poolLines.en[p], 'Pool', vi);
  if (d.poolDaypart.vi[p]) {
    inner += '<div class="sub-lbl">Theo buổi trong ngày</div>' + dayTable(d.poolDaypart, p);
  }
  out += card(emo, vi, 'pool · ' + p, inner);
}

// ── the basket, by what it is (item-aware-notification-spec.md §3) ───────────
out += '<div class="subhead">Giỏ hàng · theo loại</div>'
  + '<p class="sub-note">Khi hoá đơn của sàn về cùng lượt đọc với thư ngân hàng, câu được chọn theo '
  + 'thứ trong giỏ chứ không theo tên cửa hàng. Chỉ khi cả giỏ đồng ý về một loại; giỏ lẫn lộn thì '
  + 'rơi xuống hình dạng bên dưới. Pool đọc thẳng từ mã danh mục của cây, không đoán lại bằng từ khoá.</p>\n';
for (const ip of Object.keys(d.itemLines.vi)) {
  const [emo, vi] = ITEM[ip] || ['\u{1F6CD}\uFE0F', ip];
  const inner = '<div class="kw">' + esc(d.itemPools[ip].join(' · ').toUpperCase()) + '</div>'
    + flatTable(d.itemLines.vi[ip], d.itemLines.en[ip], 'Loại giỏ', vi);
  out += card(emo, vi, 'item · ' + ip, inner);
}

// ── the basket, by its shape ─────────────────────────────────────────────────
out += '<div class="subhead">Giỏ hàng · theo hình dạng</div>'
  + '<p class="sub-note">Dùng khi giỏ không đồng ý về loại nào. Đây là cấu trúc chứ không phải nội '
  + 'dung — số dòng, một dòng nuốt cả đơn, voucher gánh phần lớn — nên không câu nào gọi tên thứ đã mua.</p>\n';
for (const sh of Object.keys(d.basketLines.vi)) {
  const [emo, vi] = BASKET[sh];
  out += card(emo, vi, 'basket · ' + sh,
    flatTable(d.basketLines.vi[sh], d.basketLines.en[sh], 'Hình dạng', vi));
}

// ── the late receipt notice ──────────────────────────────────────────────────
out += '<div class="subhead">Hoá đơn về muộn</div>'
  + '<p class="sub-note">Hoá đơn về ở một lượt đọc khác với thư ngân hàng. Máy chủ không biết nó '
  + 'thuộc khoản nào — số tiền đã niêm phong — nên câu chỉ nói là vừa đọc được một hoá đơn, không '
  + 'nhận là của khoản nào. Thẻ riêng, không đè lên thông báo giao dịch.</p>\n';
out += card('\u{1F9FE}', 'Đã đọc được hoá đơn', 'receipt_read',
  flatTable(d.receiptRead.vi, d.receiptRead.en, 'Dòng', 'Về muộn'));

// ── digest + statement ───────────────────────────────────────────────────────
out += '<div class="subhead">Dòng riêng</div>'
  + '<p class="sub-note">Bản tin sau khi đọc xong hộp thư là dòng DUY NHẤT được nêu con số. '
  + 'Dòng sao kê không mang gì cả: không tên ngân hàng, không kỳ, không số lượng.</p>\n';
/* The digest is stored with a literal {n} placeholder. Showing the raw string
   reads as a bug to anyone skimming, so it is rendered with a sample count and
   the placeholder is named in the note above. */
const SAMPLE = 128;
const filled = (l) => ({ e: l.e, b: l.b.split('{n}').join(String(SAMPLE)) });
out += card('\u{1F4EC}', 'Đọc xong hộp thư', 'digest',
  flatTable([filled(d.digest.vi)], [filled(d.digest.en)], 'Dòng', 'Một lần'));
out += card('\u{1F4C4}', 'Sao kê chờ mở', 'statement',
  flatTable([d.statement.vi], [d.statement.en], 'Dòng', 'Một lần'));

const FOOT = '<footer>Sinh tự động từ taxonomy/notify-lines.json bằng tools/gen-notify-matrix.js '
  + '(phiên bản ' + d.version + ') · chạy lại bằng <code>npm run notify-matrix</code> · '
  + 'một dòng chỉ hiện ở đây nếu nó hiện được trên điện thoại.</footer>';

const HEAD = ' + JSON.stringify(head) + ';
const CHROME = ' + JSON.stringify(chrome) + ';

const html = HEAD + '<body>\n<div class="wrap">\n' + CHROME + '\n\n' + out + FOOT + '\n</div>\n</body>\n</html>\n';
fs.writeFileSync(OUT, html);
let n = 0;
const walk = (v) => { if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') { if (typeof v.e === 'string' && typeof v.b === 'string') n++;
    else Object.keys(v).forEach((k) => walk(v[k])); } };
[d.matrix, d.daypart, d.poolLines, d.poolDaypart, d.itemLines, d.basketLines, d.receiptRead,
  d.digest, d.statement].forEach(walk);
console.log('notify-matrix: ' + n + ' lines rendered -> docs/notify-copy-matrix.html');
