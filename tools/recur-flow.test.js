/* recurring-charges-spec §18 — the pass, the tile and the queue card together,
   over the ledger from docs/incidents/2026-10-06-recurring-detection.md.

   The engine has its own test (recur-engine.test.js). This one runs the real
   29-recur.js, 79-recur-ui.js, 11-taxonomy.js and the queue card's functions
   sliced out of 56, wired the way the app wires them, and asks the questions
   the incident asked:
     - does the pass, given the slice, mark rent and the subscriptions and
       CLEAR the coffee shop's v1 mark?
     - does the pass, given an incomplete slice, write nothing?
     - does the tile show what a person would have said?
     - does October's rent, waiting in the queue, know it is the tenth? */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sliceFn = (src, name) => { const k = src.indexOf('function ' + name + '('); if (k < 0) throw new Error('no ' + name); return src.slice(k, src.indexOf('\n}', k) + 2); };
const S56 = rd('src/js-ui/56-csv-import-ui.js'), S61 = rd('src/js-ui/61-expense-detail.js');

let failed = 0, passed = 0;
function t(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail)));
  if (ok) passed++; else failed++;
}

function app() {
  const els = {};
  const ctx = { console, Date, JSON, Object, String, Promise, Math, Number, Array, Map, Set, isFinite,
    L: (v) => v, esc: (s) => String(s == null ? '' : s), fmt: (n) => String(Math.round(n)), curMult: () => 1000,
    toast() {}, setTimeout: (f) => { f(); return 1; },
    document: { getElementById: (id) => (els[id] || (els[id] = { innerHTML: '', querySelector: () => null })) },
    setTxt: (id, v) => { (els[id] || (els[id] = {})).text = v; }, setHTML: (id, v) => { (els[id] || (els[id] = {})).innerHTML = v; },
    openSheet() {}, closeSheet() {} };
  ctx.window = ctx; ctx.TODAY = new Date(2026, 9, 7);
  vm.createContext(ctx);
  vm.runInContext(rd('src/js-ui/11-taxonomy.js'), ctx);
  vm.runInContext(rd('src/js-data/29-recur.js'), ctx);
  vm.runInContext(rd('src/js-ui/79-recur-ui.js'), ctx);
  vm.runInContext('function csvRowScope(c){ return c.scope || "personal"; } function csvBaseAmt(n){ return Number(n||0)/curMult(); } var _fhStagedRows = [];', ctx);
  vm.runInContext(['csvRecurCand', 'csvRecurOf', 'csvRecurStore', 'csvRecurLbl', 'csvRecurRow'].map((n) => sliceFn(S56, n)).join('\n'), ctx);
  vm.runInContext(['_exdRow', '_exdRecurInfo', '_exdRecurRow'].map((n) => sliceFn(S61, n)).join('\n'), ctx);
  return { ctx, els, run: (code) => vm.runInContext(code, ctx) };
}

/* The ledger as the slice returns it: a year of rent whose wording drifts, a
   software subscription, a streaming one with a receipt read before the
   `period` key existed, and the coffee shop with v1's mark on its last visit. */
let n = 0;
const row = (date, amt, o) => Object.assign({ id: 'r' + (++n), date, kind: 'expense', amt, payee: null, note: '', node: null,
  recur: null, recurSrc: null, rcPeriod: null, recurSig: null, renewsOn: null }, o || {});
function ledger() {
  const rows = [];
  const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  months.forEach((m, i) => rows.push(row(m + (i % 2 ? '-05' : '-06'), 7500, { payee: 'NGUYEN VAN QUANG', note: i % 2 ? 'Em gui tien nha. Cam on anh Quang.' : 'Em gui tien nha. Cam on a Quang.', node: 'rentpay' })));
  ['2026-06-18', '2026-07-18', '2026-08-18', '2026-09-18'].forEach((d) => rows.push(row(d, 2970, { payee: 'ANTHROPIC* CLAUDE SUB', note: 'ANTHROPIC* CLAUDE SUB [111.11 USD]', node: 'software' })));
  rows.push(row('2026-09-16', 105, { payee: 'APPLE.COM/BILL', note: 'YouTube Premium (Monthly)', node: 'streaming', rcPeriod: 'monthly', recurSig: 'sub|youtube|youtube premium', rcLabel: 'YouTube Premium' }));
  ['2026-09-02', '2026-09-04', '2026-09-05', '2026-09-09', '2026-09-10', '2026-09-10', '2026-09-17'].forEach((d) =>
    rows.push(row(d, 60, { payee: 'REVI PHU MY HUNG TOWER', note: 'REVI PHU MY HUNG TOWER', node: 'coffee' })));
  rows[rows.length - 1].recur = 'weekly'; rows[rows.length - 1].recurSrc = 'pattern';   // what v1 wrote on 2026-09-17
  return rows;
}

(async () => {
  console.log('\n-- the pass over a complete slice --');
  {
    const a = app(), rows = ledger(), wrote = [];
    a.ctx.fhPersonalRecurRows = async () => ({ rows, complete: true });
    a.ctx.fhPersonalPatchMany = async (p) => { wrote.push(...p); return p.map((x) => x.id); };
    const count = await a.ctx.fhRecurRunPersonal();
    const cafeLast = rows[rows.length - 1], rentLast = rows[10], antLast = rows[14], yt = rows[15];
    const by = (id) => wrote.find((w) => w.id === id);
    t('four writes, one call', count === 4 && wrote.length === 4, wrote);
    t('the coffee shop\'s v1 mark is CLEARED', by(cafeLast.id) && by(cafeLast.id).fields.recur === null && by(cafeLast.id).fields.recurSrc === null, by(cafeLast.id));
    t('rent: latest row marked monthly / pattern', by(rentLast.id) && by(rentLast.id).fields.recur === 'monthly' && by(rentLast.id).fields.recurSrc === 'pattern', by(rentLast.id));
    t('Anthropic: latest row marked monthly / pattern', by(antLast.id) && by(antLast.id).fields.recurSrc === 'pattern', by(antLast.id));
    t('YouTube: marked from its receipt', by(yt.id) && by(yt.id).fields.recur === 'monthly' && by(yt.id).fields.recurSrc === 'receipt', by(yt.id));
    const st = a.ctx.fhRecurState('pers');
    t('the view: three series, none of them the coffee shop', st.series.length === 3 && !st.series.some((s) => /revi/i.test(s.name)), st.series.map((s) => s.name));
    t('a second run writes nothing (the marks are in step)', (await a.ctx.fhRecurRunPersonal()) === 0);

    console.log('\n-- the tile --');
    const html = a.ctx.persRecurSection();
    t('lives in a wrapper the pass can refill', html.indexOf('id="pers-recur-wrap"') >= 0);
    t('names the rent and the subscriptions', /NGUYEN VAN QUANG/.test(html) && /ANTHROPIC/.test(html), html.slice(0, 400));
    t('the tile is the month: "Tháng 10 còn" with what is still due (rent 6/10 expected, YouTube 16/10, Anthropic 18/10)', /dbt-tk">Tháng 10 còn</.test(html) && /dbt-tv num">10575</.test(html), (html.match(/dbt-tk">[^<]*/) || [])[0]);
    t('…and the ring: nothing paid yet this month, so 0%', /rcr-ring-c"><b class="num">0%</.test(html), (html.match(/rcr-ring-c">[^/]*/) || [])[0]);
    t('…over the month\'s recurring total', /trên 10575 định kỳ · 3 khoản/.test(html), (html.match(/rcr-sub">[^<]*/) || [])[0]);
    t('never names the coffee shop', !/REVI/.test(html));
    t('each charge of the month is a line, due ones with a sage dot', (html.match(/class="rcr-ln"/g) || []).length === 3 && !/class="rcr-ln paid"/.test(html), (html.match(/rcr-ln[^"]*"/g) || []));
    t('no "quá hạn" anywhere: an expected charge is a fact, not a verdict', !/quá|trễ/.test(html));
    t('YouTube shows under the receipt\'s own name, not the bank\'s payee string', /YouTube Premium/.test(html) && !/APPLE\.COM/.test(html), html.slice(0, 600));

    console.log('\n-- the detail row reads the same view --');
    a.ctx.dRent = { id: rows[3].id, node: 'rentpay', recur: null, recurSrc: null };          // a rent row from February, never marked itself
    a.ctx.dCafe = { id: cafeLast.id, node: 'coffee', recur: null, recurSrc: null };
    a.ctx.dNew = { id: 'not-in-any-series', node: 'internet', recur: null, recurSrc: null };
    a.ctx.dNo = { id: 'declined-here', node: 'internet', recur: null, recurSrc: 'person' };
    let d = a.run('_exdRecurRow(dRent, "pers")');
    t('an OLD rent row says Hàng tháng, though only the latest row is stored', /<b>Hàng tháng<\/b>/.test(d) && !/ soft/.test(d), d);
    t('…with the date on a second line, in the rule line\'s shape', /rl-has/.test(d) && /class="rl-col"/.test(d) && /class="rcr-by">Dự kiến 6\/10</.test(d), d);
    t('the coffee row says Không', />Không</.test(a.run('_exdRecurRow(dCafe, "pers")')), a.run('_exdRecurRow(dCafe, "pers")'));
    d = a.run('_exdRecurRow(dNew, "pers")');
    t('a first charge on a recurring leaf says "Có vẻ hàng tháng", soft, one line', /Có vẻ hàng tháng/.test(d) && / soft/.test(d) && !/rl-has/.test(d), d);
    t("…unless the person already said Không on that row", />Không</.test(a.run('_exdRecurRow(dNo, "pers")')));

    console.log('\n-- the queue card (the incident\'s fifth cause) --');
    const octRent = { counterparty: 'Nguyen Van Quang', description: 'Em chuyen tien nha. Cam on anh Quang.', amount: 7500000, _node: 'rentpay', dateDisplay: '2026-10-06', categoryName: 'Khác' };
    a.ctx.c1 = octRent;
    let r = a.run('csvRecurOf(c1)');
    t("October's rent, new wording, filed under Khác: continues the series", r.period === 'monthly' && r.src === 'series' && r.soft === false, r);
    t('…and is stored as pattern on import', JSON.stringify(a.run('csvRecurStore(c1)')) === '{"recur":"monthly","src":"pattern"}', a.run('csvRecurStore(c1)'));
    const rowHtml = a.run('csvRecurRow(function(f,l,v,m){ return f+"|"+v+"|"+m.by+"|"+m.soft; }, c1)');
    t('the card says "Hàng tháng", with "Theo các kỳ trước" as its second line, not soft', /\|Hàng tháng\|/.test(rowHtml) && /class="rcr-by">Theo các kỳ trước</.test(rowHtml) && /\|false$/.test(rowHtml), rowHtml);

    a.ctx.c2 = { counterparty: 'New Landlord Co', description: 'tien nha thang 10', amount: 9000000, _node: 'rentpay', dateDisplay: '2026-10-06' };
    r = a.run('csvRecurOf(c2)');
    t('a first rent to someone new: the leaf hint, soft', r.period === 'monthly' && r.src === 'prior' && r.soft === true, r);
    t('…shown as "Có vẻ hàng tháng", with no second line (the words already say it is a guess)', a.run('csvRecurRow(function(f,l,v,m){ return v+"|"+m.by+"|"+m.soft; }, c2)') === 'Có vẻ hàng tháng||true');
    t('…and NOT stored', JSON.stringify(a.run('csvRecurStore(c2)')) === '{"recur":null,"src":null}');

    a.ctx.c3 = { counterparty: 'REVI PHU MY HUNG TOWER', description: 'REVI PHU MY HUNG TOWER', amount: 60000, _node: 'coffee', dateDisplay: '2026-10-06' };
    t('the coffee shop in the queue: Không', a.run('csvRecurOf(c3)').period === null);

    a.ctx.c4 = { counterparty: 'Google', description: 'Google', amount: 50000, _node: null, dateDisplay: '2026-10-06', rowIndex: 0 };
    a.run('_fhStagedRows[0] = { _rcpt: { period: "month", items: [{ name: "100 GB (Google One)", variant: "Auto-renewing subscription", sig: "sub|google|google one" }] } }');
    r = a.run('csvRecurOf(c4)');
    t('a joined receipt decides before anything else', r.period === 'monthly' && r.src === 'receipt', r);
    t('…stored as receipt', a.run('csvRecurStore(c4)').src === 'receipt');

    a.ctx.c5 = Object.assign({}, octRent, { _recurSrc: 'person', _recur: null });
    t("the person's Không on the card beats the series", a.run('csvRecurOf(c5)').period === null && a.run('csvRecurStore(c5)').src === 'person');
    a.ctx.c6 = Object.assign({}, octRent, { isIncome: true });
    t('an income row stores nothing', a.run('csvRecurStore(c6)').recur === null);

    console.log('\n-- Đúng rồi / Không on a guess --');
    const b = app(), rows2 = [row('2026-07-10', 220, { payee: 'Netflix' }), row('2026-08-10', 220, { payee: 'Netflix' }), row('2026-09-10', 220, { payee: 'Netflix' })];
    const wrote2 = [], learned = [], forgot = [];
    b.ctx.fhPersonalRecurRows = async () => ({ rows: rows2, complete: true });
    b.ctx.fhPersonalPatchMany = async (p) => { wrote2.push(...p); return p.map((x) => x.id); };
    b.ctx.fhLessonLearnRecur = (k, p, s, amt) => learned.push([k, p, s, amt]);
    b.ctx.fhLessonForgetRecur = (k) => forgot.push(k);
    await b.ctx.fhRecurRunPersonal();
    const s0 = b.ctx.fhRecurState('pers').series[0];
    t('three monthly charges on no leaf: a guess, nothing written', s0 && s0.soft === true && wrote2.length === 0, s0);
    t('with nothing confirmed, the tile lists the guess in soft ink, no ring, no total', /1 khoản có vẻ định kỳ/.test(b.ctx.persRecurSection()) && /rcr-ln paid/.test(b.ctx.persRecurSection()) && !/rcr-ring/.test(b.ctx.persRecurSection()) && !/~\d/.test(b.ctx.persRecurSection()), b.ctx.persRecurSection().slice(0, 400));
    await b.ctx.fhRecurAnswer('pers', s0.id, true);
    t('Đúng rồi: a person mark on the latest row', wrote2.length === 1 && wrote2[0].fields.recur === 'monthly' && wrote2[0].fields.recurSrc === 'person', wrote2);
    t('…the lesson taught under the series key, with the amount', learned.length === 1 && learned[0][0] === 'p|netflix' && learned[0][3] === 220, learned);
    const s1 = b.ctx.fhRecurState('pers').series[0];
    t('…and the series is now fact', s1 && s1.soft === false && s1.source === 'person', s1 && [s1.soft, s1.source]);
    await b.ctx.fhRecurAnswer('pers', s1.id, false);
    t('Không: the series is gone and the lesson forgotten', b.ctx.fhRecurState('pers').series.length === 0 && forgot[0] === 'p|netflix', b.ctx.fhRecurState('pers').series);
  }

  console.log('\n-- the pass over an INCOMPLETE slice --');
  {
    const a = app(), rows = ledger().filter((r) => r.date >= '2026-09-01'), wrote = [];   // what v1 was handed
    a.ctx.fhPersonalRecurRows = async () => ({ rows, complete: false });
    a.ctx.fhPersonalPatchMany = async (p) => { wrote.push(...p); return p.map((x) => x.id); };
    const count = await a.ctx.fhRecurRunPersonal();
    t('shows what it found, writes NOTHING and clears nothing', count === 0 && wrote.length === 0, wrote);
    t('even so, the coffee shop is not a series', !a.ctx.fhRecurState('pers').series.some((s) => /revi/i.test(s.name)));
  }

  console.log('\n-- the family ledger: no payee, full history in window.txns --');
  {
    const a = app(), patched = [];
    const mk = (id, y, m, d, amt, note, node) => ({ id: 'db_' + id, _dbId: id, _d: new Date(y, m - 1, d), amt, note, node: node || null, cat: 'X' });
    a.ctx.txns = [mk('e1', 2026, 7, 12, 410, 'Tiền điện tháng 7', 'electric'), mk('e2', 2026, 8, 11, 690, 'Dien thang 8', 'electric'), mk('e3', 2026, 9, 12, 520, 'tien dien T9', 'electric'),
      mk('c1', 2026, 9, 2, 60, 'cafe', 'coffee'), mk('c2', 2026, 9, 9, 60, 'cafe', 'coffee')];
    a.ctx.DB = { _hydrated: true, _lastFullAt: Date.now() };
    a.ctx.fhTxnBulkPatch = async (id, p) => { patched.push([id, p]); };
    await a.ctx.fhRecurRunFamily();
    const fs2 = a.ctx.fhRecurState('fam').series;
    t('electricity with drifting notes and amounts: one series through its leaf', fs2.length === 1 && fs2[0].groupKey === 'k|electric' && fs2[0].inCadence === 3, fs2.map((s) => [s.groupKey, s.inCadence]));
    t('only the latest row is written (one realtime event, not three)', patched.length === 1 && patched[0][0] === 'e3' && patched[0][1].recurrence_source === 'pattern', patched);
    t('two coffees a week apart are nothing', !fs2.some((s) => /cafe/.test(s.name)));
  }

  console.log('\n-- v3 wiring (recurring-charges-spec §19) --');
  {
    const S19 = rd('src/js-data/19-personal.js'), S29 = rd('src/js-data/29-recur.js'), S79 = rd('src/js-ui/79-recur-ui.js');
    t('both personal row builders hand the engine what the receipt is (rcHas) and what it names (rcProd)', (S19.match(/rcHas: !!\(m && m\.has\), rcProd: m \? \(m\.prod \|\| null\) : null/g) || []).length === 2);
    t('family rows say they carry no receipt facts', /rcHas: false, rcProd: null, _t: t/.test(S29));
    t('the engine is told who is a biller by the registry', /biller: \(payee\) => !!\(window\.FH_BRANDS && typeof window\.FH_BRANDS\.isBiller === 'function' && window\.FH_BRANDS\.isBiller\(payee\)\)/.test(S29));
    t('the queue card passes its own receipt\'s verdict to the engine', /cand\.notRenewal = !!\(rm && rm\.has && !rm\.period\)/.test(S56));
    t('a tap on a series opens the row that proves it', /const a = s\.anchor \|\| s\.latest;/.test(S79) && /openPersonalTxDetail\(\\'' \+ _e\(a\.id\)/.test(S79));
    t('the price-rise note sits on the proof row', /\(s\.anchor\|\|s\.latest\)\.id===o\.id/.test(S61));
  }

  if (failed) { console.log('\n' + failed + ' FAILED, ' + passed + ' passed'); process.exit(1); }
  console.log('\nall ' + passed + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
