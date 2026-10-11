#!/usr/bin/env node
/* Money-source faces (docs/specs/source-face-spec.md).
 * `node tools/source-face.test.js`
 *
 * What is pinned, and why each one would hurt if it moved:
 *   1. The worker's providers.mjs carries NO face. A face is presentation; if
 *      it leaked into the worker copy, every colour edit would change a file
 *      a deployed Edge Function is built from.
 *   2. Every face in the registry is legible: the generator's ink choice
 *      clears 3:1 (white) or 4.5:1 (dark) on the provider's colour.
 *   3. The resolver's order: provider_key, then prose, then the account's own
 *      name, then the kind's emoji; and it never invents a colour.
 *   4. A short leading word is not trusted on its own ("TP HCM quỹ" is not
 *      TPBank), while a real bank word still finds its bank ("VCB lương").
 *   5. Names are escaped: an account is named by a person.
 *   6. The three shapes. v628 put a one-letter square inside a line of text:
 *      a 7px letter nobody could read, "V" for three banks, and a subline
 *      that wrapped on every row (the 2026-10-11 phone screenshot). So: the
 *      square only from 26px, the TAG under that with the whole monogram and
 *      type never under 9.5px, standing in place of the provider's name, and
 *      the BADGE on a list tile's corner.
 *   7. List rows: no mark and no bank name in a subline, no bank face at
 *      tile size, the subline on one line, and a mirror row's corner left to
 *      the family mark.
 *   8. Every surface the spec lists still calls the one renderer, so a
 *      refactor cannot quietly drop a surface back to plain text.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('src/js-ui/09-providers.js'), ctx);
ctx.FH_PROVIDERS = ctx.window.FH_PROVIDERS;
vm.runInContext(read('src/js-ui/09-source-face.js'), ctx);
const F = ctx.window.FH_SRC_FACE, W = ctx.window, R = ctx.window.FH_PROVIDERS;
const reg = JSON.parse(read('taxonomy/providers.json'));

console.log('\n-- the registry: faces go to the client only --');
t('providers.mjs (worker) has no face', !/"face"\s*:/.test(read('supabase/functions/_shared/mailbox/providers.mjs')));
t('09-providers.js (client) has faces', /"face":\{"mono"/.test(read('src/js-ui/09-providers.js')));
t('no receipt sender carries a face', reg.providers.every((p) => p.kind !== 'receipt' || !p.face));
t('every mono is 1 to 4 letters or digits', reg.providers.every((p) => !p.face || /^[A-Za-z0-9]{1,4}$/.test(p.face.mono)));
t('hex is stored without #, so the colour ratchet never counts the registry',
  reg.providers.every((p) => !p.face || p.face.hex == null || /^[0-9A-Fa-f]{6}$/.test(p.face.hex)));

console.log('\n-- legibility: the ink the generator chose --');
const lum = (hex) => { const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const bad = R.all().filter((p) => p.face && p.face.hex).filter((p) => (p.face.dk ? ratio(lum('1a1117'), lum(p.face.hex)) < 4.5 : ratio(1, lum(p.face.hex)) < 3)).map((p) => p.key);
t('white clears 3:1, or dark ink clears 4.5:1, on every colour', bad.length === 0, bad.join(', '));

console.log('\n-- the resolver --');
const of = (a) => F.ofAcct(a) || {};
t('provider_key wins', of({ kind: 'deposit', providerKey: 'vib', name: 'Thẻ chính' }).mono === 'VIB');
t('a renamed account keeps its bank', of({ kind: 'credit_card', providerKey: 'vietcombank', name: 'Lương' }).hex === reg.providers.find((p) => p.key === 'vietcombank').face.hex.toUpperCase());
t('prose resolves through the registry ("ví momo")', of({ kind: 'ewallet', provider: 'ví momo' }).mono === 'MoMo');
t('the long legal name resolves', (F.ofProse('Ngân hàng TMCP Ngoại thương Việt Nam') || {}).mono === 'VCB');
t('an account a person named by its bank finds it ("VCB lương")', of({ kind: 'deposit', name: 'VCB lương' }).mono === 'VCB');
t('a name that is the bank and a tail finds it ("VIB ••5140", no provider on the row)', of({ kind: 'deposit', name: 'VIB ••5140' }).hex === '0066B3');
t('"MB Bank chung" finds MB', of({ kind: 'deposit', name: 'MB Bank chung' }).mono === 'MB');
t('a short leading word is not trusted ("TP HCM quỹ" is not TPBank)', !of({ kind: 'deposit', name: 'TP HCM quỹ' }).hex);
t('an unknown provider gets a neutral monogram, never a colour', of({ kind: 'deposit', provider: 'standard chartered', tail: '1234' }).mono === 'SC' && !of({ kind: 'deposit', provider: 'standard chartered' }).hex);
t('a hand-named account gets its initials, diacritics kept', of({ kind: 'deposit', name: 'Quỹ đen' }).mono === 'QĐ');
t('a tail is not a name', of({ kind: 'deposit', name: 'Tài khoản ••4751' }).mono === 'TK');
t('cash wears its emoji', !!of({ kind: 'cash', name: 'Tiền mặt' }).em);
t('a registry provider with no face falls back to a monogram of its label', (F.ofKey('pvcombank') || {}).mono === 'PVC' && (F.ofKey('9pay') || {}).mono.length > 0);
t('a receipt sender has no face (sellers wear a brand)', F.ofKey('grab') === null);
t('an instrument string resolves by its bank', (F.ofInst('VIB · tín dụng ••4512') || {}).mono === 'VIB' && !!(F.ofInst('Tiền mặt') || {}).em);
t('nothing in, nothing out', W.fhSrcFace(null, 28) === '' && W.fhSrcFaceOf('', 28) === '' && W.fhSrcFaceInst(null) === '' && W.fhSrcInstLabel(null) === '');

console.log('\n-- the three shapes --');
const css = read('src/css/41-source-face.css');
t('26px and up is the square with the whole monogram', /class="sf" [^>]*data-n="3"[^>]*>VCB</.test(W.fhSrcFaceKey('vietcombank', 28)));
t('under 26px it is the tag, still the whole monogram', /class="sf tg in"[^>]*>VCB</.test(W.fhSrcFaceKey('vietcombank', 18, 'in')));
t('VIB, Vietcombank and VPBank no longer share a letter in a line of text',
  new Set(['vib', 'vietcombank', 'vpbank'].map((k) => W.fhSrcFaceKey(k, 18).replace(/<[^>]+>/g, ''))).size === 3);
t('a tag is never shorter than 16px, so its type never drops under 9.5px', /--sfs:16px/.test(W.fhSrcFaceKey('vib', 14)) && /\.sf\.tg\{[^}]*font-size:max\(9\.5px/.test(css));
t('the colour rides inline as --sfh', /--sfh:#[0-9A-F]{6}/.test(W.fhSrcFaceKey('vib', 28)));
t('a light colour asks for dark ink, on the square and on the badge', /class="sf dk/.test(W.fhSrcFaceKey('shb', 28)) && /class="r-src dk"/.test(W.fhSrcBadge({ providerKey: 'shb' })));
t('a face is decoration beside words (aria-hidden)', /aria-hidden="true"/.test(W.fhSrcFaceKey('vib', 28)) && /aria-hidden="true"/.test(W.fhSrcBadge({ providerKey: 'vib' })));
t('a monogram made from the name itself gives no tag (it would repeat the name)', W.fhSrcFace({ kind: 'deposit', name: 'Quỹ đen' }, 18) === '' && />QĐ</.test(W.fhSrcFace({ kind: 'deposit', name: 'Quỹ đen' }, 28)));
t('cash keeps its emoji square at any size', /class="sf em/.test(W.fhSrcFace({ kind: 'cash' }, 18)));

console.log('\n-- a tag stands in place of the provider\'s name --');
const txt = (h) => h.replace(/<[^>]+>/g, '|');
t('"Vietcombank ••2279" becomes tag + "••2279"', txt(W.fhSrcLabel({ providerKey: 'vietcombank' }, 'Vietcombank ••2279')) === '|VCB|••2279');
t('"VCB lương" becomes tag + "lương"', txt(W.fhSrcLabel({ providerKey: 'vietcombank' }, 'VCB lương')) === '|VCB|lương');
t('an account named exactly its provider is the tag alone', txt(W.fhSrcLabel({ providerKey: 'momo' }, 'MoMo')) === '|MoMo|');
t('a name that does not start with the provider is kept whole', txt(W.fhSrcLabel({ providerKey: 'vib' }, 'Thẻ chính')) === '|VIB|Thẻ chính');
t('a word that merely begins like the provider is not cut ("VIBrant")', txt(W.fhSrcLabel({ providerKey: 'vib' }, 'VIBrant quỹ')) === '|VIB|VIBrant quỹ');
t('a hand-named account is its name, no mark', W.fhSrcLabel({ kind: 'deposit', name: 'Quỹ đen' }, 'Quỹ đen') === 'Quỹ đen');
t('fhSrcLabel escapes what a person typed', W.fhSrcLabel({ kind: 'deposit', providerKey: 'vib' }, '<b>x</b>').indexOf('&lt;b&gt;x&lt;/b&gt;') > 0);
t('an instrument string keeps the words after the provider', txt(W.fhSrcInstLabel('VIB · tín dụng ••4512')) === '|VIB|tín dụng ••4512');
t('an unknown instrument string is printed as it is, escaped', W.fhSrcInstLabel('Quỹ <chung>') === 'Quỹ &lt;chung&gt;');
t('a provider named alone: its tag when the registry has its colour', /class="sf tg nm"[^>]*>VCB</.test(W.fhSrcName('Vietcombank', 'Vietcombank')));
t('a provider with no colour, or unknown, stays words', W.fhSrcName('lpbank', 'LPBank') === 'LPBank' && W.fhSrcName('standard chartered', 'Standard Chartered') === 'Standard Chartered');

console.log('\n-- list rows: the badge, the four digits, the transfer tile --');
t('the badge is one letter', />V<\/span>$/.test(W.fhSrcBadge({ providerKey: 'vietcombank' })));
t('a two-letter monogram stays whole on the badge', /data-n="2"[^>]*>MB</.test(W.fhSrcBadge({ providerKey: 'mbbank' })));
t('cash wears its emoji badge and says nothing in the subline', /r-src em/.test(W.fhSrcBadge({ kind: 'cash' })) && W.fhSrcRowSub({ kind: 'cash', name: 'Tiền mặt' }) === '');
t('no account, no badge', W.fhSrcBadge(null) === '' && W.fhSrcRowSub(null) === '');
t('the subline says the four digits', W.fhSrcRowSub({ providerKey: 'vib', name: 'VIB ••4751', tail: '4751' }) === '••4751');
t('an account with no number says its name', W.fhSrcRowSub({ kind: 'deposit', name: 'Quỹ đen' }) === 'Quỹ đen');
t('a transfer names both ends without their numbers', W.fhSrcXferTitle({ name: 'VIB ••5140' }, { name: 'Vietcombank ••2279' }) === 'VIB → Vietcombank');
t('two accounts at one bank keep their numbers', W.fhSrcXferTitle({ name: 'VIB ••5140' }, { name: 'VIB ••4751' }) === 'VIB ••5140 → VIB ••4751');
t('an unknown end gives no title (the caller keeps the note)', W.fhSrcXferTitle({ name: 'VIB ••5140' }, null) === '');
t('the transfer tile is neutral: no bank colour, no monogram', /r-ico personal-ico xf/.test(W.FH_SRC_XFER_TILE) && !/--sfh|class="sf/.test(W.FH_SRC_XFER_TILE));
t('the paired-face tile and the full-size bank tile are gone', typeof W.fhSrcPairTile === 'undefined' && !/sfp/.test(css));
const tab = read('src/js-ui/21-personal.js'), txs = read('src/js-ui/60-transactions.js');
const listFrom = tab.slice(tab.indexOf('var srcSub'), tab.indexOf("h += '<div class=\"empty-note\">'"));
t('Cá nhân tab: no face and no bank name inside a subline', !/fhSrcFace\(|acctName\(t\.accountId\)|fhSrcLabel\(/.test(listFrom));
t('Cá nhân tab: expense, income and transfer sublines stay on one line', (listFrom.match(/class="r-s r-s1"/g) || []).length === 3 && /\.r-s\.r-s1\{white-space:nowrap/.test(css));
t('Cá nhân tab: a mirror row keeps 🏡 on the corner and names no account', /t\.spaceId \? '<div class="r-ico-wrap">'\+_tile\+'<div class="r-scope">🏡<\/div><\/div>' : srcTile\(_tile, t\.accountId\)/.test(tab) && /\(t\.spaceId\?'':srcSub\(t\.accountId\)\)/.test(tab));
t('Cá nhân tab: a transfer no longer says "không tính thu chi" (the grey amount and the kind word do)',
  !/không tính thu chi/.test(listFrom.slice(listFrom.indexOf("t.kind==='transfer'"), listFrom.indexOf("t.kind==='investment'")).replace(/\/\*[\s\S]*?\*\//g, '')));
t('Giao dịch: the badge sits in the tile wrap, the digits in the one-line subline', /tile\+av\+\(\(sf&&sf\.b\)\|\|''\)/.test(txs) && /class="r-s r-s1">'\+subTxt/.test(txs) && /if\(sf&&sf\.s\) subTxt\+=' · '\+esc\(sf\.s\)/.test(txs));
t('Giao dịch: a family row names its source in words (its corner is the member\'s)', /if\(t\.inst\) subTxt\+=' · '\+esc\(t\.inst\);/.test(txs));
t('Giao dịch: a mirror row is not marked', /if\(!\(t\.spaceId\|\|t\.linkId\)\) mark\(t\.id, acctMap\.get\(t\.accountId\)\)/.test(txs));
t('the ctx shape heat-txn-ctx.test.js pins is untouched (marks ride beside it)', !/_faces:/.test(txs) && /_pTxnFaces=faceOf;/.test(txs));

console.log('\n-- every surface still calls the renderer --');
const SURFACES = [
  ['src/js-data/23-debts-ui.js', /fhSrcFace\(a, 28\)/, 'Tài sản tiles'],
  ['src/js-data/23-debts-ui.js', /fhSrcFace\(acct, 34, 'in'\)/, 'account screen title'],
  ['src/js-data/23-debts-ui.js', /wz-nrow/, 'setup wizard'],
  ['src/js-data/23-debts-ui.js', /fhSrcLabel\(a, _acctLbl\(a\)\)/, 'merge picker'],
  ['src/js-ui/50-sheets-expense-capture.js', /fhSrcLabel\(a, a\.name/, '"Trả bằng gì?" chips'],
  ['src/js-data/70-goals-income-onboard-ui.js', /fhSrcLabel/, '"Vào tài khoản nào?" chips'],
  ['src/js-data/76-quick-review.js', /fhSrcLabel\(a, a\.name\)/, 'quick review chips'],
  ['src/js-data/76-quick-review.js', /fhSrcName\(prov, name\)/, 'quick review source'],
  ['src/js-ui/59-ledger-move-ui.js', /fhSrcLabel\(a, a\.name/, 'ledger-move sheet'],
  ['src/js-ui/61-expense-detail.js', /function _pexdAcctVal/, 'personal detail rows'],
  ['src/js-ui/61-expense-detail.js', /fhSrcInstLabel\(t\.inst\)/, 'family detail "Nguồn tiền"'],
  ['src/js-ui/56-csv-import-ui.js', /fhSrcName\(provider, provider\)/, 'queue card source'],
  ['src/js-ui/56-csv-import-ui.js', /fhSrcLabel\(cardA, cardName\)/, 'queue card "Trả cho thẻ"'],
  ['src/js-ui/60-transactions.js', /FH_SRC_XFER_TILE/, 'Giao dịch transfer rows'],
  ['src/js-ui/60-transactions.js', /fhSrcLabel\(FH_SRC_FACE\.byId\(o\.k\), o\.lbl\)/, '"Nguồn tiền" filter'],
  ['src/js-ui/60-transactions.js', /fhSrcInstLabel\(o\.k\)/, 'family "Nguồn tiền" filter'],
  ['src/js-ui/21-personal.js', /srcTile\(FH_SRC_XFER_TILE, xAcct\)/, 'Cá nhân tab transfer rows'],
  ['src/js-ui/21-personal.js', /fhSrcName\(pk\.provider, prov\)/, 'Cá nhân tab queue peek'],
  ['src/js-data/74-autotxn-ui.js', /fhSrcFaceOf\(r\.source_provider, 30\)/, '"Vừa tìm thấy" feed'],
  ['src/js-data/77-statement-capture.js', /fhSrcFaceOf\(card\.source_provider, 34/, 'statement cards'],
];
const cache = {};
for (const [file, re, name] of SURFACES) t(name, re.test(cache[file] || (cache[file] = read(file))), file);

console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
