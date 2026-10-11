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
 *   6. Every surface the spec lists still calls the one renderer, so a
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
t('nothing in, nothing out', W.fhSrcFace(null, 28) === '' && W.fhSrcFaceOf('', 28) === '' && W.fhSrcFaceInst(null) === '');

console.log('\n-- the mark --');
t('26px and up shows the whole monogram', />VCB</.test(W.fhSrcFaceKey('vietcombank', 28)));
t('under 26px a long monogram is one letter', />V</.test(W.fhSrcFaceKey('vietcombank', 18)));
t('under 26px a two-letter monogram stays whole', />MB</.test(W.fhSrcFaceKey('mbbank', 18)));
t('the colour rides inline as --sfh', /--sfh:#[0-9A-F]{6}/.test(W.fhSrcFaceKey('vib', 28)));
t('a light colour asks for dark ink', /class="sf dk/.test(W.fhSrcFaceKey('shb', 28)));
t('the face is decoration beside a name (aria-hidden)', /aria-hidden="true"/.test(W.fhSrcFaceKey('vib', 28)));
t('fhSrcLabel escapes the name a person typed', W.fhSrcLabel({ kind: 'deposit', providerKey: 'vib' }, '<b>x</b>').indexOf('&lt;b&gt;x&lt;/b&gt;') > 0);
t('two accounts make a paired tile, one account a full one, none makes nothing',
  /r-ico sfp/.test(W.fhSrcPairTile({ providerKey: 'vib' }, { providerKey: 'momo' })) && /sf r-ico/.test(W.fhSrcPairTile({ providerKey: 'vib' }, null)) && W.fhSrcPairTile(null, null) === '');

console.log('\n-- every surface still calls the renderer --');
const SURFACES = [
  ['src/js-data/23-debts-ui.js', /fhSrcFace\(a, 28\)/, 'Tài sản tiles'],
  ['src/js-data/23-debts-ui.js', /fhSrcFace\(acct, 34, 'in'\)/, 'account screen title'],
  ['src/js-data/23-debts-ui.js', /wz-nrow/, 'setup wizard'],
  ['src/js-data/23-debts-ui.js', /fhSrcLabel\(a, _acctLbl\(a\)\)/, 'merge picker'],
  ['src/js-ui/50-sheets-expense-capture.js', /fhSrcLabel\(a, a\.name/, '"Trả bằng gì?" chips'],
  ['src/js-data/70-goals-income-onboard-ui.js', /fhSrcLabel/, '"Vào tài khoản nào?" chips'],
  ['src/js-data/76-quick-review.js', /fhSrcLabel\(a, a\.name\)/, 'quick review'],
  ['src/js-ui/59-ledger-move-ui.js', /fhSrcLabel\(a, a\.name/, 'ledger-move sheet'],
  ['src/js-ui/61-expense-detail.js', /function _pexdAcctVal/, 'personal detail rows'],
  ['src/js-ui/61-expense-detail.js', /fhSrcFaceInst\(t\.inst,18,'in'\)/, 'family detail "Nguồn tiền"'],
  ['src/js-ui/56-csv-import-ui.js', /fhSrcFaceOf\(provider,15,'in'\)/, 'queue card source'],
  ['src/js-ui/56-csv-import-ui.js', /fhSrcLabel\(cardA, cardName\)/, 'queue card "Trả cho thẻ"'],
  ['src/js-ui/60-transactions.js', /_pTxnFaces\[t\.id\]/, 'Giao dịch transfer rows'],
  ['src/js-ui/60-transactions.js', /fhSrcFaceInst\(t\.inst,14,'in'\)/, 'family row source'],
  ['src/js-ui/60-transactions.js', /fhSrcFaceId\(o\.k,18,'in'\)/, '"Nguồn tiền" filter'],
  ['src/js-ui/21-personal.js', /fhSrcPairTile\(ends\.fromA, ends\.toA\)/, 'Cá nhân tab transfer rows'],
  ['src/js-ui/21-personal.js', /var acctSub/, 'Cá nhân tab row source'],
  ['src/js-data/74-autotxn-ui.js', /fhSrcFaceOf\(r\.source_provider, 30\)/, '"Vừa tìm thấy" feed'],
  ['src/js-data/77-statement-capture.js', /fhSrcFaceOf\(card\.source_provider, 34/, 'statement cards'],
];
const cache = {};
for (const [file, re, name] of SURFACES) t(name, re.test(cache[file] || (cache[file] = read(file))), file);
t('the ctx shape heat-txn-ctx.test.js pins is untouched (faces ride beside it)', !/_faces:/.test(read('src/js-ui/60-transactions.js')));

console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
