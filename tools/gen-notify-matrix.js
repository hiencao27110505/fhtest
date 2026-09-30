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

/* The page shell, lifted verbatim from the last hand-written revision
   (d7bdc07): doctype, head, the whole stylesheet and theme toggle, then the
   header prose. Embedded rather than read from the output file, so the
   generator does not depend on its own previous run. */
const HEAD = "<!doctype html>\n<html lang=\"vi\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Copy thông báo · bắt giao dịch từ email</title>\n<style>\n:root{\n  --bg:#f6f4f1; --surface:#ffffff; --surface-2:#faf9f6; --ink:#1b241f; --ink-2:#3b463f;\n  --muted:#67736c; --line:#e7e3dc; --brand:#2E9E6B; --brand-ink:#1F7E52; --brand-tint:#eaf6ef;\n  --shadow:0 1px 2px rgba(20,30,25,.04),0 6px 20px rgba(20,30,25,.05);\n  --mono:\"SF Mono\",ui-monospace,\"JetBrains Mono\",Menlo,monospace;\n  --sans:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Inter\",system-ui,\"Segoe UI\",sans-serif;\n  --disp:-apple-system,BlinkMacSystemFont,\"SF Pro Display\",\"Inter\",system-ui,sans-serif;\n}\n@media (prefers-color-scheme:dark){:root{\n  --bg:#0f130e; --surface:#161b14; --surface-2:#12160f; --ink:#e8ebe4; --ink-2:#c3cabf;\n  --muted:#8f998f; --line:#262c22; --brand:#5FD3A0; --brand-ink:#7fe0b3; --brand-tint:rgba(95,211,160,.11);\n  --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 26px rgba(0,0,0,.34);\n}}\n:root[data-theme=\"light\"]{ --bg:#f6f4f1; --surface:#ffffff; --surface-2:#faf9f6; --ink:#1b241f; --ink-2:#3b463f; --muted:#67736c; --line:#e7e3dc; --brand:#2E9E6B; --brand-ink:#1F7E52; --brand-tint:#eaf6ef; --shadow:0 1px 2px rgba(20,30,25,.04),0 6px 20px rgba(20,30,25,.05); }\n:root[data-theme=\"dark\"]{ --bg:#0f130e; --surface:#161b14; --surface-2:#12160f; --ink:#e8ebe4; --ink-2:#c3cabf; --muted:#8f998f; --line:#262c22; --brand:#5FD3A0; --brand-ink:#7fe0b3; --brand-tint:rgba(95,211,160,.11); --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 26px rgba(0,0,0,.34); }\n*{box-sizing:border-box}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;font-size:15px;-webkit-font-smoothing:antialiased}\n.wrap{max-width:1120px;margin:0 auto;padding:34px 22px 96px}\n.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--brand-ink);font-weight:600}\nh1{font-family:var(--disp);font-size:30px;font-weight:800;letter-spacing:-.6px;margin:.35rem 0 0;text-wrap:balance}\n.lede{color:var(--ink-2);max-width:66ch;margin:.6rem 0 0;font-size:15.5px}\n.note{margin-top:16px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow)}\n.note p{margin:.2rem 0;color:var(--ink-2);font-size:14px}\n.note b{color:var(--ink)}\n.legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}\n.chip{font-family:var(--mono);font-size:12px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:5px 11px;color:var(--ink-2)}\n.chip b{color:var(--ink);font-weight:600}\n.toggle{position:sticky;top:14px;float:right;margin-top:-2px;font-family:var(--mono);font-size:12px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:6px 13px;color:var(--ink-2);cursor:pointer}\n.toggle:hover{border-color:var(--brand);color:var(--brand-ink)}\n.card{margin-top:24px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:6px 4px 10px;box-shadow:var(--shadow);overflow:hidden}\nh2{font-family:var(--disp);font-size:18px;font-weight:750;letter-spacing:-.2px;margin:12px 16px 2px;display:flex;align-items:center;gap:9px}\nh2 .emo-h{font-size:20px}\nh2 .key{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.04em;color:var(--muted);background:var(--surface-2);border:1px solid var(--line);padding:2px 7px;border-radius:6px;margin-left:auto}\n.sub-lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 16px 4px}\n.kw{font-family:var(--mono);font-size:11px;color:var(--muted);margin:2px 16px 0;line-height:1.6}\n.scroll{overflow-x:auto}\ntable{border-collapse:collapse;width:100%;min-width:680px;font-size:14px}\nthead th{text-align:left;font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}\ntbody td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}\ntbody tr:last-child td{border-bottom:0}\n.tier{width:130px;background:var(--surface-2);border-right:1px solid var(--line);padding-top:11px}\n.tier-n{display:block;font-weight:700;font-size:13.5px;color:var(--ink)}\n.tier-r{display:block;font-family:var(--mono);font-size:11px;color:var(--brand-ink);margin-top:3px;font-variant-numeric:tabular-nums}\n.tier-tag{display:block;font-size:12px;color:var(--muted);margin-top:3px}\n.n{width:22px;font-family:var(--mono);font-size:12px;color:var(--muted);text-align:center;font-variant-numeric:tabular-nums}\n.emo{width:30px;font-size:19px;text-align:center;line-height:1.3}\n.b{color:var(--ink);width:34%}\n.b-en{color:var(--muted)}\ntbody tr:hover td{background:var(--brand-tint)}\ntbody tr:hover .tier{background:var(--brand-tint)}\n.subhead{font-family:var(--disp);font-size:22px;font-weight:800;letter-spacing:-.4px;margin:44px 0 2px}\n.sub-note{color:var(--muted);font-size:14px;margin:0 0 6px;max-width:72ch}\nfooter{margin-top:40px;color:var(--muted);font-size:12.5px;font-family:var(--mono);border-top:1px solid var(--line);padding-top:16px}\n@media (max-width:560px){.wrap{padding:22px 13px 70px}h1{font-size:24px}.tier{width:104px}}\n</style>\n</head>\n";
const CHROME = "<button class=\"toggle\" onclick=\"var r=document.documentElement,d=(r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'))==='dark';r.setAttribute('data-theme',d?'light':'dark')\">◐ Sáng / Tối</button>\n<header>\n  <div class=\"eyebrow\">FamilyHub · Earthy</div>\n  <h1>Copy thông báo — bắt giao dịch từ email</h1>\n  <p class=\"lede\">App phản ứng với đúng khoản vừa bắt được: vui, hơi phán xét, kèm một nhắc nhẹ tiêu khéo / sống khoẻ. Câu chọn theo <b>danh mục × bậc tiền × buổi trong ngày</b>, xoay vòng nhiều biến thể.</p>\n  <div class=\"note\">\n    <p><b>Mặt cười nằm ở tiêu đề</b>, phần nội dung chỉ có chữ và dấu “!”. Câu chỉ nói về khoản vừa rồi — không số tiền, không danh mục, không số khoản chờ. Tối đa <b>9 từ</b>.</p>\n    <p><b>Theo buổi trong ngày</b> (sáng/trưa/chiều/tối, lấy từ giờ giao dịch) áp dụng cho Ăn uống, Đi chợ và pool cà phê / trà sữa; giao dịch không rõ giờ dùng câu theo bậc tiền.</p>\n    <p><b>Pool từ khoá</b> chỉ kích hoạt khi tên nơi bán khớp; không khớp thì rơi về câu chung của danh mục.</p>\n  </div>\n  <div class=\"legend\">\n    <span class=\"chip\"><b>Bậc 1</b> ≤ 30k</span><span class=\"chip\"><b>2</b> 30k–500k</span><span class=\"chip\"><b>3</b> 500k–5tr</span><span class=\"chip\"><b>4</b> &gt; 5tr</span>\n    <span class=\"chip\">Sáng · Trưa · Chiều · Tối</span><span class=\"chip\">mặt cười ở tiêu đề</span><span class=\"chip\">≤ 9 từ · chỉ “!”</span>\n  </div>\n</header>";

const html = HEAD + '<body>\n<div class="wrap">\n' + CHROME + '\n\n' + out + FOOT + '\n</div>\n</body>\n</html>\n';
fs.writeFileSync(OUT, html);
let n = 0;
const walk = (v) => { if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') { if (typeof v.e === 'string' && typeof v.b === 'string') n++;
    else Object.keys(v).forEach((k) => walk(v[k])); } };
[d.matrix, d.daypart, d.poolLines, d.poolDaypart, d.itemLines, d.basketLines, d.receiptRead,
  d.digest, d.statement].forEach(walk);
console.log('notify-matrix: ' + n + ' lines rendered -> docs/notify-copy-matrix.html');
