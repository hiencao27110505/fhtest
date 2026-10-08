/* recurring-charges-spec.md RR22 — the brand registry and the face of a charge.
   The generator's rules are tested by running it on mutated copies; the
   matcher by the strings a Vietnamese ledger really carries. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy', 'brands.json'), 'utf8'));
let failed = 0;
function t(name, ok, detail) { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail))); if (!ok) failed++; }

function generateWith(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-brands-'));
  fs.mkdirSync(path.join(dir, 'tools')); fs.mkdirSync(path.join(dir, 'taxonomy', 'brand-glyphs'), { recursive: true }); fs.mkdirSync(path.join(dir, 'src', 'js-ui'), { recursive: true });
  const reg = JSON.parse(JSON.stringify(REG)); mutate(reg);
  fs.writeFileSync(path.join(dir, 'taxonomy', 'brands.json'), JSON.stringify(reg));
  for (const f of fs.readdirSync(path.join(ROOT, 'taxonomy', 'brand-glyphs'))) fs.copyFileSync(path.join(ROOT, 'taxonomy', 'brand-glyphs', f), path.join(dir, 'taxonomy', 'brand-glyphs', f));
  fs.copyFileSync(path.join(ROOT, 'tools', 'gen-brands.js'), path.join(dir, 'tools', 'gen-brands.js'));
  try { execFileSync(process.execPath, [path.join(dir, 'tools', 'gen-brands.js')], { stdio: 'pipe' }); return { ok: true }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
}
const find = (reg, k) => reg.brands.find((b) => b.key === k);

console.log('\n-- the registry --');
t('generates clean', generateWith(() => {}).ok);
t('every glyph file is CC0 Simple Icons and holds one path', REG.brands.every((b) => /<path d="/.test(fs.readFileSync(path.join(ROOT, 'taxonomy', 'brand-glyphs', b.glyph + '.svg'), 'utf8'))));
t('the licence note exists and names the removal rule', /CC0/.test(fs.readFileSync(path.join(ROOT, 'taxonomy', 'brand-glyphs', 'LICENSE.md'), 'utf8')) && /removed/.test(fs.readFileSync(path.join(ROOT, 'taxonomy', 'brand-glyphs', 'LICENSE.md'), 'utf8')));
t('brands whose owners police their marks are absent (Adobe, Microsoft, LinkedIn, Disney+)', !REG.brands.some((b) => /adobe|microsoft|linkedin|disney/.test(b.key)));
let r = generateWith((reg) => { find(reg, 'spotify').match.push('Spotify'); });
t('a match word that is not folded lower-case is refused', !r.ok && /folded/.test(r.err), r.err && r.err.slice(0, 100));
r = generateWith((reg) => { find(reg, 'spotify').match.push('netflix'); });
t('a word claimed by two brands is refused', !r.ok && /claimed by/.test(r.err), r.err && r.err.slice(0, 100));
r = generateWith((reg) => { find(reg, 'spotify').glyph = 'nope'; });
t('a missing glyph file is refused', !r.ok && /glyph file missing/.test(r.err), r.err && r.err.slice(0, 100));
r = generateWith((reg) => { find(reg, 'spotify').hex = 'green'; });
t('a bad colour is refused', !r.ok && /bad hex/.test(r.err), r.err && r.err.slice(0, 100));
r = generateWith((reg) => { reg.rails.push('ZaloPay'); });
t('a rail that is not folded lower-case is refused', !r.ok && /rail must be folded/.test(r.err), r.err && r.err.slice(0, 100));
r = generateWith((reg) => { reg.rails.push('netflix'); });
t('a rail that is also a brand word is refused', !r.ok && /is also a match word/.test(r.err), r.err && r.err.slice(0, 100));

console.log('\n-- the matcher, on real ledger strings --');
/* the row rule reads the tree, so the real taxonomy is loaded beside it */
const w = {}; const ctx = { window: w };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'js-ui', '11-taxonomy.js'), 'utf8') + '\n;this.FH_TAX = (typeof FH_TAX !== "undefined") ? FH_TAX : window.FH_TAX;', ctx);
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', 'js-ui', '08-brands.js'), 'utf8'), ctx);
const B = w.FH_BRANDS;
const m = (...texts) => { const x = B.match(texts); return x ? x.label : null; };
t('a receipt signature wins before the payee: Google One, not Apple', m('sub|google|google one', 'APPLE.COM/BILL') === 'Google One');
t('"ANTHROPIC* CLAUDE SUB" is Claude (the longer word beats Anthropic)', m(null, 'ANTHROPIC* CLAUDE SUB [111.11 USD]') === 'Claude');
t('"APPLE.COM/BILL" alone is Apple', m(null, 'APPLE.COM/BILL') === 'Apple');
t('"GOOGLE *YouTube" is YouTube Premium, not Google', m(null, 'GOOGLE *YouTube') === 'YouTube Premium');
t('a bare "Google" is Google', m(null, 'Google') === 'Google');
t('"NETFLIX.COM" is Netflix', m(null, 'NETFLIX.COM') === 'Netflix');
t('Vietnamese diacritics fold ("Thuê bao Spotify")', m(null, 'Thuê bao Spotify Premium') === 'Spotify');
t('a landlord\'s bank string matches nothing', m(null, '6209991888 - NGUYEN VINH', 'Em gui tien nha') === null);
t('a coffee shop matches nothing', m(null, 'REVI PHU MY HUNG TOWER') === null);
t('ChatGPT wears the OpenAI glyph (parent brand), Google One the Google glyph', B.match(['chatgpt']).path === B.get('chatgpt').path && B.get('googleone').path === B.get('google').path);
t('svg() draws the glyph in currentColor at the asked size', /width="22"/.test(B.svg(B.get('netflix'), 22)) && /fill="currentColor"/.test(B.svg(B.get('netflix'), 22)));
t('every registered brand resolves', B.all().every((b) => B.get(b.key) && B.get(b.key).path));

console.log('\n-- strict enough for every row of a ledger (RR23) --');
t('a rail is how the money moved, not who was paid: "ZALOPAY_Chickita" is not Zalo', m(null, '99ZP24281M07 - ZALOPAY_Chickita - Crescent') === null);
t('the merchant behind a rail still matches: "GOOGLE PAY *NETFLIX"', m(null, 'GOOGLE PAY *NETFLIX.COM') === 'Netflix');
t('"SHOPEEPAY" alone is a wallet top-up, not a Shopee order', m(null, 'SHOPEEPAY TOPUP') === null);
t('a receipt signature is never read as a rail', m('sub|google|google one') === 'Google One');
t('a word counts only where a token starts: "nhbo", "duber", "bikea" match nothing', m(null, 'NHBO TRADING') === null && m(null, 'duber co') === null && m(null, 'bikea shop') === null);
t('...and still matches inside a longer token it starts: "GRABFOOD"', m(null, 'GRABFOOD HCM') === 'Grab');
t('"GOOGLE*CLOUD 2RNVCV" is Google Cloud, not Google', m(null, 'GOOGLE*CLOUD 2RNVCV') === 'Google Cloud');
t('Foody wears its parent\'s mark as ShopeeFood', m(null, 'FOODY CORPORATION') === 'ShopeeFood' && B.get('shopeefood').path === B.get('shopee').path);
t('the answer for a text is remembered (same object key, asked twice)', B.match(['NETFLIX.COM']).key === B.match(['NETFLIX.COM']).key);
const fr = (o) => { const x = B.forRow(o); return x ? x.label : null; };
t('a row with no node wears its seller', fr({ payee: 'SHOPEE VN', note: null }) === 'Shopee');
t('a row filed under an expense leaf wears its seller', fr({ node: 'streaming', note: 'Netflix tháng 10' }) === 'Netflix');
t('a row filed under a person wears none, whatever the memo says', fr({ node: 'split', payee: 'NGUYEN THU TRANG', note: 'chia tien netflix' }) === null && fr({ node: 'p2p', note: 'netflix' }) === null);
t('a row that is not spending wears none', fr({ node: 'wage', note: 'google payroll' }) === null);
t('forRow asks signature, payee, memo, provider in that order', fr({ sig: 'sub|google|google one', payee: 'APPLE.COM/BILL' }) === 'Google One' && fr({ payee: 'x', note: 'y', provider: 'Grab' }) === 'Grab');

console.log('\n-- where the mark is drawn (RR23) --');
const S60 = fs.readFileSync(path.join(ROOT, 'src', 'js-ui', '60-transactions.js'), 'utf8');
const S21 = fs.readFileSync(path.join(ROOT, 'src', 'js-ui', '21-personal.js'), 'utf8');
const S56 = fs.readFileSync(path.join(ROOT, 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');
t('ledger row: photo, then brand, then the category emoji', /var tile=ph\?'<div class="r-ico ph"[\s\S]{0,140}:bd\?'<div class="r-ico brand"[\s\S]{0,220}:'<div class="r-ico" style="background:'\+s\[1\]/.test(S60));
t('ledger row: a family row is matched on its note only (who is the member)', /payee:personal\?t\._cp:null, note:t\.note/.test(S60));
t('ledger row: only spending, never a future row or a non-expense kind', /\(!personal \|\| t\._kg==='chi'\) && !t\.future/.test(S60));
t('personal tab row: the same order, payee first', /FH_BRANDS\.forRow\(\{ node:t\.node, payee:t\.who, note:t\.note \}\)/.test(S21) && /: _bd \? '<div class="r-ico brand"/.test(S21));
t('queue card: the mark replaces the emoji inside the category pill', /csvCatChipText\(r,'expense',_bm\)/.test(S56) && /return \(lead \|\| \(\(rt&&rt\.emoji\)/.test(S56) && /return \(lead \|\| \(st\[0\]\+' '\)\)/.test(S56));
t('queue card: only a plain expense wears one', /var _plain = !\(r\._loan\|\|r\._invest\|\|r\._transfer\|\|r\._xfer\|\|r\._repay\|\|r\._income\)/.test(S56));
t('queue card: an uncategorised card still shows who was paid', /'<span class="scv-cat unset">'\+_bm\+L\('Chọn danh mục'/.test(S56));
t('every mark names its brand for a screen reader', /role="img" aria-label="'\+escAttr\(bd\.label\)/.test(S60) && /aria-label="'\+escAttr\(_bd\.label\)/.test(S21) && /aria-label="'\+escAttr\(_bd\.label\)/.test(S56));

console.log('\n-- the face, as the recurring UI picks it --');
const S79 = fs.readFileSync(path.join(ROOT, 'src', 'js-ui', '79-recur-ui.js'), 'utf8');
t('the UI asks the registry in the order signature, product, payee, memo', /FH_BRANDS\.match\(\[s\.product \? \('sub\|' \+ String\(s\.product\)\.toLowerCase\(\)\) : null, s\.product, s\.payee, s\.note\]\)/.test(S79));
t('then the node emoji, inherited up the tree, then the category emoji, then the monogram', /FH_TAX\.get\(s\.node\)/.test(S79) && /n\.parent \? FH_TAX\.get\(n\.parent\)/.test(S79) && /return s\.emoji \|\| null/.test(S79) && /rcr-face mono/.test(S79));
t('a matched brand names a series that has no receipt product', /const b = _brand\(s\); return \(b && b\.label\) \|\| s\.name/.test(S79));
t('a paid charge keeps its face, desaturated', /\.rcr-ln\.paid \.rcr-face\{filter:saturate\(0\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'css', '76-recur.css'), 'utf8')));

if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall passed');
