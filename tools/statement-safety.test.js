#!/usr/bin/env node
/* Statement safety (docs/specs/reconcile-spec.md Part 2, R1 to R6 and R9).
 * `node tools/statement-safety.test.js`
 *
 * The story this pins: a weekly loyalty-points statement was taken for a deposit
 * account's statement, filed under the card's internal account number, and its
 * purchases were staged as income, unseen, because a column reading had been
 * confirmed once for that header. The card's own PDF was read inverted. And a
 * bank that mails a statement twice put every row in the queue twice. Now:
 *   R1  a points column means no money table, and the card says so;
 *   R2  a card answers to its card number, whatever order the numbers come in;
 *   R3  one signed column takes its sign from the file's own totals;
 *   R4  a file whose kind of account is in doubt asks;
 *   R5  an unproved file asks unless THIS account, kind and sign were confirmed;
 *   R6  the question says what will happen;
 *   R9  rows already waiting from another file add nothing, and two real equal
 *       rows in one file stay two.
 *
 * Every value is invented. The pure reader is required directly; the capture
 * step is the shipped 77-statement-capture.js, whole, against a small stateful
 * fake server with REAL sealing (the harness of statement-auto.test.js).
 */
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const nodeCrypto = require('crypto');

(async () => {
  const SB = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'sealed-box.mjs'));
  const T = require(path.join(__dirname, '..', 'src', 'js-ui', '59-statement-table.js'));
  const FX = path.join(__dirname, 'fixtures', 'statements');
  const grid = (n) => JSON.parse(fs.readFileSync(path.join(FX, n + '.grid.json'), 'utf8'));
  let pass = 0, fail = 0;
  const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

  const POINTS = grid('credit-card-points'), SIGNED = grid('credit-card-signed'), CARD = grid('credit-card'), BANK = grid('bank-account'), WALLET = grid('ewallet');
  const isTotals = (r) => /^(Dư nợ|Phát sinh)/.test(r[0]);
  const SIGNED_BARE = SIGNED.filter((r) => !isTotals(r));        // the same card file with no debt or totals lines

  console.log('\n-- R1. a points column is not a money table --');
  const pts = T.fhStmtParse(POINTS, null, { provider: 'VIB' });
  t('the points layout gives no table, why not_money', pts.table === null && pts.why === 'not_money' && pts.rows.length === 0, { why: pts.why });
  t('...and a remembered column reading does not change that', T.fhStmtParse(POINTS, T.fhStmtFindTable(POINTS).roles).why === 'not_money');
  const withPts = CARD.slice(0, 4).concat([['Điểm thưởng tích lũy (Loyalty points)', '', '1,200']], CARD.slice(4));
  const wp = T.fhStmtParse(withPts);
  t('a money statement that mentions points in its preamble is still a money statement', wp.table && !wp.why && wp.proof.ok && wp.rows.length === 8, { why: wp.why, ok: wp.proof.ok });
  /* A real money statement that also prints the points each purchase earned. */
  const addPts = (g) => g.map((r) => r.some((c) => /^Ngày giao dịch/.test(c)) ? r.concat(['Số điểm (Loyalty points)'])
    : (r.slice(0, 2).some((c) => /^\d\d\/\d\d\/2026$/.test(c)) ? r.concat(['12.00']) : r));
  const cp = T.fhStmtParse(addPts(CARD));
  t('a card statement with debt totals AND a points column is a money statement, and proves', cp.table && !cp.why && cp.proof.ok && cp.rows.length === 8 &&
    cp.table.headers.length === 7 && !Object.values(cp.table.roles).includes(6), { why: cp.why, ok: cp.proof.ok, roles: cp.table && cp.table.roles });
  const sp = T.fhStmtParse(addPts(SIGNED));
  t('...and the PDF-style one signed column too, with its sign from the totals', sp.table && sp.proof.ok && sp.proof.sign === -1 && sp.rows.length === 9, { why: sp.why, proof: sp.proof && sp.proof.how });
  const bp = T.fhStmtParse(addPts(BANK));
  t('a points column and a running balance: a money statement', bp.table && /Số điểm/.test(bp.table.headers.join('|')) && bp.proof.ok && bp.proof.how === 'running', bp.table && bp.table.headers);
  t('header words that only look like points are not points', !T.fhStmtNotMoney(['Ngày giao dịch', 'Địa điểm giao dịch', 'Số tiền đảm bảo', 'Số tiền']));
  t('every points spelling is', ['Số điểm', 'Điểm thưởng', 'Loyalty points', 'Reward Point', 'Số dặm', 'Miles'].every((h) => T.fhStmtNotMoney(['Ngày', h])));

  console.log('\n-- R2. a card answers to its card number --');
  const sg = T.fhStmtParse(SIGNED, null, { provider: 'VIB' });
  const both = [{ tail: '6789', label: 'card', where: 'preamble' }, { tail: '3456', label: 'account', where: 'preamble' }];
  t('the two-number preamble: the card number is the account', sg.summary.accountTail === '6789', sg.summary.accountTail);
  t('...and both numbers are collected, labelled, once each', JSON.stringify(sg.summary.accountTails) === JSON.stringify(both), sg.summary.accountTails);
  const swapped = SIGNED.slice(); [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  const sw = T.fhStmtParse(swapped);
  t('card number last instead of first: the same answer', sw.summary.accountTail === '6789' && sw.summary.accountTails.length === 2 && sw.summary.accountTails[0].tail === '3456', sw.summary.accountTails);
  const ptsSum = T.fhStmtSummary(POINTS.slice(0, 8), 8);
  t('the points preamble (the file that went wrong) reads the card number too, not the card account', ptsSum.accountTail === '6789' && ptsSum.accountTails.length === 2, ptsSum.accountTails);
  const tableOnly = [['Sao kê'], ['Số tài khoản (Account number)', '000111222333444'],
    ['Ngày giao dịch', 'Diễn giải', 'Ghi nợ', 'Ghi có'], ['Số thẻ / Số tài khoản', '', '512345******6789'], ['02/08/2026', 'Mua Hàng', '185,000', '']];
  const to = T.fhStmtParse(tableOnly);
  t('a number seen only inside the table is collected and never becomes the account', to.summary.accountTail === '3444' &&
    to.summary.accountTails.some((x) => x.tail === '6789' && x.label === 'card' && x.where === 'table'), to.summary.accountTails);
  const twoAuto = [['Số TK trích nợ (Auto Debit Account)', '000111222333444'], ['Số tài khoản trích nợ (Auto debit account number)', '000999888777666'],
    ['Số thẻ chính (Primary Card Number)', '512345******6789']];
  const ta = T.fhStmtSummary(twoAuto);
  t('auto-debit: the first line wins, and a second one is never taken for the card', ta.autoDebitTail === '3444' && ta.accountTail === '6789' && ta.accountTails.length === 1, ta);

  console.log('\n-- R3. one signed column gets its sign from the totals --');
  t('the printed sign does not prove; the inverted one does, by the totals', sg.proof.ok && sg.proof.how === 'totals' && sg.proof.sign === -1, sg.proof);
  const buys = sg.rows.filter((r) => /Mua Hàng/.test(r.description));
  t('purchases come out as money out', buys.length === 6 && buys.every((r) => r.amt < 0), buys.map((r) => r.amt));
  t('the repayment and the refund come out as money in, with their flows', sg.rows.some((r) => r.amt === 2150000 && r.cls.flow === 'cardpay') && sg.rows.some((r) => r.amt === 64000 && r.cls.flow === 'refund'));
  const out = sg.rows.reduce((s, r) => s + (r.amt < 0 ? -r.amt : 0), 0);
  t('money out adds up to the file\'s total debit', out === sg.summary.totalDebit && out === 1519522, out);
  const facts = T.fhStmtAccountFacts(sg, 'credit_card');
  t('the card\'s closing debt is taken, as a debt', facts.ok && facts.balDong === -1455522, facts);
  /* No totals: the arithmetic cannot say, so the wording may (still asking). */
  const bare = T.fhStmtParse(SIGNED_BARE);
  t('no totals, and every worded row contradicts the printed sign: inverted, and still unproved', !bare.proof.ok && bare.proof.sign === -1 &&
    bare.rows.filter((r) => /Mua Hàng/.test(r.description)).every((r) => r.amt < 0) && bare.rows.some((r) => /Hoàn tiền/.test(r.description) && r.amt > 0),
    { ok: bare.proof.ok, sign: bare.proof.sign });
  const bareWith = (fn) => SIGNED_BARE.map((r) => /^\d\d\/\d\d\/2026$/.test(r[0]) ? fn(r.slice()) : r);
  /* two purchases printed negative: 7 of 9 worded rows contradict, under 90% */
  let k2 = 0;
  const mixed = T.fhStmtParse(bareWith((r) => { if (/Mua Hàng/.test(r[2]) && k2++ < 2) r[4] = '-' + r[4]; return r; }));
  t('mixed wording: the printed sign stands', !mixed.proof.ok && mixed.proof.sign === 1 && mixed.rows.find((r) => /Foody/.test(r.description)).amt < 0 && mixed.rows.find((r) => /SHOPEE/.test(r.description)).amt > 0);
  /* only two worded rows: every other description says nothing about direction */
  let k3 = 0;
  const thin = T.fhStmtParse(bareWith((r) => { if (k3++ >= 2) r[2] = 'GD ' + r[3]; else r[2] = 'Mua Hàng / X'; return r; }));
  t('fewer than 3 worded rows: the printed sign stands', !thin.proof.ok && thin.proof.sign === 1 && thin.rows.filter((r) => /Mua Hàng/.test(r.description)).every((r) => r.amt !== 0) &&
    T.fhStmtWordsSay(thin.rows, thin.summary) === 1, thin.rows.map((r) => [r.description, r.amt]));
  const quiet = T.fhStmtParse(bareWith((r) => { r[2] = 'GD ' + r[3]; return r; }));
  t('no wording at all: no file-wide sign is guessed', !quiet.proof.ok && quiet.proof.sign === 1);
  t('"thanh toan sao ke the" counts as money in only on a card', T.fhStmtWordsSay([1, 2, 3].map(() => ({ description: 'Thanh toan sao ke the', amt: -5 })), { prevDebt: 1 }) === -1 &&
    T.fhStmtWordsSay([1, 2, 3].map(() => ({ description: 'Thanh toan sao ke the', amt: -5 })), {}) === 1);

  console.log('\n-- R3 needs every row: a figure filed under the wrong column is named, never dropped --');
  const lost = SIGNED.map((r) => r[0] === '05/08/2026' ? ['05/08/2026', '05/08/2026', r[2], '6012-Member Financial -2,150,000.00', ''] : r);
  const lp = T.fhStmtParse(lost);
  t('the row is unreadable, naming the cell the figure landed in', lp.unreadable.length === 1 && lp.unreadable[0].why === 'misplaced' && lp.unreadable[0].role === 'mcc' &&
    lp.unreadable[0].cell === '6012-Member Financial -2,150,000.00' && lp.unreadable[0].date === '2026-08-05', lp.unreadable);
  t('...so the proof says so instead of failing on a missing row', !lp.proof.ok && lp.proof.how === 'unreadable' && lp.rows.length === 8);
  const zero = CARD.map((r) => r[0] === '02/08/2026' ? r.slice(0, 4).concat(['0.0', '0.0']) : r);
  const zp = T.fhStmtParse(zero);
  t('a genuine zero row (both columns "0.0") is skipped as before, not unreadable', zp.unreadable.length === 0 && zp.rows.length === 7);
  const dash = CARD.map((r) => r[0] === '02/08/2026' ? r.slice(0, 4).concat(['', '']) : r);
  t('an empty amount with no money-shaped figure elsewhere is skipped as before', T.fhStmtParse(dash).unreadable.length === 0);
  t('sub-header rows and the MCC code itself never count as a figure', T.fhStmtParse(CARD).unreadable.length === 0 && T.fhStmtParse(SIGNED).unreadable.length === 0);
  const bk = T.fhStmtParse(BANK), wl = T.fhStmtParse(WALLET, null, { provider: 'MoMo' });
  t('two columns and a running balance are untouched', bk.proof.ok && bk.proof.how === 'running' && bk.proof.sign === 1 && wl.proof.ok && wl.proof.how === 'running' && wl.proof.sign === 1);

  /* ── the capture step, unseen and on a tap ─────────────────────────────── */
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const kp = nacl.box.keyPair(), pub = Buffer.from(kp.publicKey).toString('base64');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8');
  const src18 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '18-staging-keys.js'), 'utf8');
  const fx = (name) => { const j = src18.indexOf('function ' + name); return src18.slice(j, src18.indexOf('\n    }', j) + 6); };
  const fhStagingOpenRow = new Function('nacl', 'STAGING_ENC_V', fx('_sb64ToBytes') + '\n' + fx('fhStagingOpenRow') + '\nreturn fhStagingOpenRow;')(nacl, 1);
  const CARD_SUBJ = 'SAO KE THE TIN DUNG VIB THANG 08 NAM 2026', ACCT_SUBJ = 'Sao kê tài khoản VIB';

  function server() {
    const sv = { files: [], rows: [], blobs: {}, content: {}, downloads: 0, staged: [] };
    let seq = 0;
    sv.add = (id, provider, o) => {
      o = o || {};
      const bytes = new Uint8Array(nodeCrypto.randomBytes(256));
      const sha = nodeCrypto.createHash('sha256').update(bytes).digest('hex');
      const m = SB.sealForFamily(Object.assign({ filename: id + '.xlsx', subject: o.subject || 'Sao kê', file_sha256: sha, period_month: '2026-08' }, o.tail ? { account_tail: o.tail } : {}),
        pub, OWNER, 'm-' + id, { nacl, rng: nodeCrypto.webcrypto }, 'personal');
      const f = { id, gmail_message_id: 'm-' + id, part_index: 0, source_provider: provider, received_at: '2026-09-' + String(28 - (seq++)).padStart(2, '0') + 'T16:38:00+00:00', file_ext: 'xlsx', byte_size: 256,
        object_path: OWNER + '/' + id + '.sealed', meta_sealed: m.sealed, meta_eph_pub: m.eph_pub, meta_nonce: m.nonce, enc_v: m.enc_v, status: 'pending', backfill: false };
      sv.files.push(f);
      sv.blobs[f.object_path] = SB.sealBytes(bytes, pub, { nacl, rng: nodeCrypto.webcrypto });
      sv.content[sha] = o.grid;
      return f;
    };
    sv.rpc = async (fn, args) => {
      if (fn !== 'stage_statement_rows') return null;
      sv.staged.push(args);
      const f = sv.files.find((x) => x.id === args.p_statement_id);
      if (f.status === 'opened') return 0;
      args.p_rows.forEach((r) => sv.rows.push(Object.assign({ statement_id: f.id }, r)));
      f.status = 'opened';
      return args.p_rows.length;
    };
    return sv;
  }
  const mkStore = () => ({ _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } });
  function boot(sv, ls) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', checked: false, focus() {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, has(c) { return this._s.has(c); } } });
    const document = { getElementById: (id) => { if (id === 'csv-result') return el(id); return el('csv-result').innerHTML.indexOf('id="' + id + '"') >= 0 ? el(id) : null; } };
    const answer = (data) => { const q = { select: () => q, in: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data, error: null }), then: (r) => r({ data, error: null }) }; return q; };
    const window = {
      fhUser: { id: OWNER }, nacl, fhStagingOpenRow, fhStmtParse: T.fhStmtParse,
      fhPersonalKeyReady: () => true, fhPersonalStagingPrivKey: async () => kp.secretKey,
      fhPersonalEncBytes: async (b) => b, fhPersonalDecBytes: async (b) => b,
      fhProviderName: (p) => p, renderCsvReview: () => { el('csv-result').innerHTML = window.fhStmtCardsHTML(); },
      fhTxnReviewSheet: () => {}, toast: () => {}, csvEntryScope: null, fhRefreshStagedCount: () => {},
      sb: {
        from: (tbl) => tbl === 'statement_files' ? answer(sv.files.filter((f) => f.status === 'pending'))
          : tbl === 'statement_rows' ? answer(sv.rows.map((r) => ({ id: r.id, statement_id: r.statement_id, row_index: r.row_index, txn_date: r.txn_date, payload_enc: r.payload_enc })))
          : answer([]),
        storage: { from: () => ({
          download: async (p) => { sv.downloads++; const b = sv.blobs[p]; return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null }; },
          remove: async () => ({}) }) },
        functions: { invoke: async () => ({ data: { concepts: {} } }) } },
    };
    const parseXlsx = async (ab) => sv.content[nodeCrypto.createHash('sha256').update(Buffer.from(ab)).digest('hex')];
    new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto', 'fhParseXlsxBuffer', 'csvFmt', SRC)(
      window, {}, (vi) => vi, (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), (s) => String(s), sv.rpc,
      ls, { setItem() {} }, document, nodeCrypto.webcrypto, parseXlsx, (n) => Math.round(n).toLocaleString('vi-VN') + 'đ');
    return { window, el, open: () => window.fhStmtLoad({ auto: true }) };
  }
  const sealed = (call) => call.p_rows.map((r) => JSON.parse(Buffer.from(r.payload_enc, 'base64').toString('utf8')));
  const mapOf = (ls) => JSON.parse(ls.getItem('fh-stmt-map:' + OWNER) || '{}');
  const autoOf = (ls) => JSON.parse(ls.getItem('fh-stmt-auto:' + OWNER) || '{}');
  /* Next month's statement: every day a month on, so no row of it is a row of the first. */
  const nextMonth = (g) => g.map((r) => r.map((c) => String(c).replace(/\b(\d\d)\/08\/2026/g, (m, d) => String(Math.min(+d, 30)).padStart(2, '0') + '/09/2026')));

  console.log('\n-- R1 in the capture step: no rows, no question, the card says so --');
  let sv = server(), ls = mkStore();
  sv.add('p1', 'VIB', { grid: POINTS, subject: 'Sao kê điểm thưởng thẻ tín dụng VIB' });
  let A = boot(sv, ls);
  let res = await A.open();
  t('unseen: nothing staged, the card stays', sv.staged.length === 0 && res.cards.length === 1);
  t('...and it is remembered on the device, like a format it cannot read', autoOf(ls).p1 === 'not_money', autoOf(ls));
  t('the card says in one line that it is a points statement', /Sao kê điểm thưởng, không có khoản tiền nào\./.test(A.window.fhStmtCardsHTML()));
  const d0 = sv.downloads; await A.open(); await boot(sv, ls).open();
  t('it is not read again on later opens or sessions', sv.downloads === d0);
  await A.window.fhStmtOpen('p1');
  let html = A.el('csv-result').innerHTML;
  t('a tap says the same, and never asks for a column reading', /sao kê điểm thưởng, không có khoản tiền nào để thêm/.test(html) && !/fhStmtMappingOk/.test(html) && sv.staged.length === 0);

  console.log('\n-- R3 in the capture step: the PDF card statement stages with purchases as money out --');
  sv = server(); ls = mkStore(); sv.add('s1', 'VIB', { grid: SIGNED, subject: CARD_SUBJ });
  A = boot(sv, ls); res = await A.open();
  const s1 = sv.staged.length === 1 ? sealed(sv.staged[0]) : [];
  t('proved by its totals, it stages itself', sv.staged.length === 1 && s1.length === 9, s1.length);
  t('...purchases as money out, under the card ••6789 as a card', s1.filter((p) => /Mua Hàng/.test(p.memo)).every((p) => p.amt < 0) && s1.every((p) => p.tail === '6789' && p.accountKind === 'credit_card'),
    s1.map((p) => [p.amt, p.tail, p.accountKind]));

  console.log('\n-- R5. a single column with no totals stays unproved and asks; R6 says what will happen --');
  sv = server(); ls = mkStore(); sv.add('b1', 'VIB', { grid: SIGNED_BARE, subject: CARD_SUBJ });
  A = boot(sv, ls); res = await A.open();
  t('unseen: nothing staged, the card stays', sv.staged.length === 0 && res.cards.length === 1);
  await A.window.fhStmtOpen('b1');
  html = A.el('csv-result').innerHTML;
  t('a tap asks', /fhStmtMappingOk/.test(html) && /không có số dư hay tổng/.test(html));
  t('R6: the account and its kind, above the columns', /<span>Tài khoản<\/span><b>VIB · thẻ ••6789<\/b>/.test(html) && /<span>Loại<\/span><b>Thẻ tín dụng<\/b>/.test(html) &&
    html.indexOf('VIB · thẻ ••6789') < html.indexOf('<span>Ngày</span>'), html.slice(0, 600));
  t('R6: how many rows, and the money each way, the right way round (the wording turned the file, R3)', /<span>Số khoản<\/span><b>9<\/b>/.test(html) && /<span>Tiền ra<\/span><b>1\.519\.522đ<\/b>/.test(html) && /<span>Tiền vào<\/span><b>2\.214\.000đ<\/b>/.test(html), html.match(/Tiền (ra|vào)<\/span><b>[^<]*/g));
  await A.window.fhStmtMappingOk();
  t('"Đúng rồi" stages it and keeps the answer as v2, with the account, kind and sign it was given for',
    sv.staged.length === 1 && JSON.stringify(Object.values(mapOf(ls)).map((e) => [e.v, e.tail, e.kind, e.sign])) === JSON.stringify([[2, '6789', 'credit_card', -1]]), mapOf(ls));
  sv.add('b2', 'VIB', { grid: nextMonth(SIGNED_BARE), subject: CARD_SUBJ });
  res = await boot(sv, ls).open();
  t('the next statement of that format, same account, kind and sign: stages itself', sv.staged.length === 2 && sv.staged[1].p_statement_id === 'b2' && sv.staged[1].p_rows.length === 9);

  console.log('\n-- R5. what a kept answer is worth --');
  const sigBare = T.fhStmtParse(SIGNED_BARE).sig, rolesBare = T.fhStmtFindTable(SIGNED_BARE).roles;
  const keep = (entry) => { const s = mkStore(); s.setItem('fh-stmt-map:' + OWNER, JSON.stringify({ ['vib|' + sigBare]: entry })); return s; };
  const v2 = (o) => Object.assign({ v: 2, roles: rolesBare, tail: '6789', kind: 'credit_card', sign: -1 }, o);   // this file reads inverted by its wording (R3)
  const trial = async (store, o) => { const s = server(); s.add('k1', 'VIB', Object.assign({ grid: SIGNED_BARE, subject: CARD_SUBJ }, o || {})); const B = boot(s, store); const r = await B.open(); return { s, r, B }; };
  const v1Store = keep(rolesBare);
  let tr = await trial(v1Store);
  t('a v1 mapping (roles only, saved before R5) asks', tr.s.staged.length === 0 && tr.r.cards.length === 1);
  await tr.B.window.fhStmtOpen('k1'); await tr.B.window.fhStmtMappingOk();
  t('...once: the answer upgrades it to v2', tr.s.staged.length === 1 && Object.values(mapOf(v1Store)).every((e) => e.v === 2 && e.tail === '6789'), mapOf(v1Store));
  tr = await trial(v1Store);
  t('...and the next file of that format no longer asks', tr.s.staged.length === 1);
  tr = await trial(keep(v2()));
  t('a v2 mapping with the same account, kind and sign does not ask', tr.s.staged.length === 1);
  tr = await trial(keep(v2({ tail: '1111' })));
  t('a v2 mapping for another account asks', tr.s.staged.length === 0 && tr.r.cards.length === 1);
  tr = await trial(keep(v2({ sign: 1 })));
  t('a v2 mapping confirmed with the other sign asks', tr.s.staged.length === 0);
  tr = await trial(keep(v2({ kind: 'deposit' })));
  t('a v2 mapping confirmed as another kind asks', tr.s.staged.length === 0);

  console.log('\n-- R4. a file whose kind is in doubt asks, even when it proves --');
  sv = server(); ls = mkStore(); sv.add('w1', 'VIB', { grid: BANK, subject: CARD_SUBJ });
  A = boot(sv, ls); res = await A.open();
  t('the mail says card, the file has no debt lines: asks', sv.staged.length === 0 && res.cards.length === 1);
  await A.window.fhStmtOpen('w1');
  html = A.el('csv-result').innerHTML;
  t('...saying what is in doubt, and showing its best guess', /chưa chắc đây là thẻ tín dụng hay tài khoản/.test(html) && /<span>Loại<\/span><b>Thẻ tín dụng<\/b>/.test(html), html.slice(0, 400));
  sv = server(); ls = mkStore(); sv.add('w2', 'VIB', { grid: CARD, subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  t('debt lines on a mail that says account: asks', sv.staged.length === 0 && res.cards.length === 1);
  sv = server(); ls = mkStore(); sv.add('w3', 'VIB', { grid: CARD, subject: CARD_SUBJ }); sv.add('w4', 'VIB', { grid: BANK, subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  t('evidence that agrees asks nothing: a card as a card, an account as an account', sv.staged.length === 2 && res.cards.length === 0);
  t('...under the card number and the account number', sealed(sv.staged.find((c) => c.p_statement_id === 'w3'))[0].tail === '6789' && sealed(sv.staged.find((c) => c.p_statement_id === 'w4'))[0].tail === '3444');

  console.log('\n-- R9. a row has one identity whatever file carried it --');
  sv = server(); ls = mkStore();
  sv.add('t1', 'VIB', { grid: SIGNED, subject: CARD_SUBJ }); sv.add('t2', 'VIB', { grid: SIGNED, subject: CARD_SUBJ });
  A = boot(sv, ls); res = await A.open();
  t('the same statement mailed twice: the second adds nothing', sv.staged.length === 2 && sv.staged[0].p_rows.length === 9 && sv.staged[1].p_rows.length === 0, sv.staged.map((c) => c.p_rows.length));
  t('...its line says so, and the queue holds each row once', /Không có khoản mới/.test(A.window.fhStmtCardsHTML()) && res.rows.length === 9);
  /* The spreadsheet twin of the PDF: the same statement in debit and credit
     columns, a credit printed negative, as the bank's .xlsx prints it. */
  const twinOf = (g) => {
    const a = g.find((r) => r[0] === 'Ngày giao dịch').findIndex((h) => /^Số tiền/.test(h));
    const at = (r, two) => r.slice(0, a).concat(two, r.slice(a + 1));
    return g.map((r) => {
      if (r[0] === 'Ngày giao dịch') return at(r, ['Ghi nợ/Debit (VND)', 'Ghi có/Credit (VND)']);
      if (!/^\d\d\/\d\d\/2026$/.test(r[0])) return r;
      return at(r, T.fhStmtNum(r[a]) > 0 ? [r[a], '0'] : ['0', r[a]]);
    });
  };
  const twin = twinOf(SIGNED);
  t('(setup) the twin proves on its own, two columns, as itself', T.fhStmtParse(twin).proof.ok && T.fhStmtParse(twin).proof.sign === 1 && T.fhStmtParse(twin).table.roles.debit !== undefined);
  sv = server(); ls = mkStore();
  sv.add('x1', 'VIB', { grid: SIGNED, subject: CARD_SUBJ }); sv.add('x2', 'VIB', { grid: twin, subject: CARD_SUBJ });
  res = await boot(sv, ls).open();
  t('a PDF beside its spreadsheet: the second adds nothing', sv.staged.length === 2 && sv.staged[1].p_rows.length === 0 && res.rows.length === 9, sv.staged.map((c) => c.p_rows.length));
  /* Overlapping periods: the bank statement's six oldest rows, then its nine
     newest; three rows are in both. (Newest-first file: rows 12..23 of the grid.) */
  const head = BANK.slice(0, 12), body = BANK.slice(12);
  sv = server(); ls = mkStore();
  sv.add('o1', 'VIB', { grid: head.concat(body.slice(6)), subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  sv.add('o2', 'VIB', { grid: head.concat(body.slice(0, 9)), subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  t('overlapping periods: only the rows the first file did not hold go in', sv.staged.length === 2 && sv.staged[0].p_rows.length === 6 && sv.staged[1].p_rows.length === 6 && res.rows.length === 12, sv.staged.map((c) => c.p_rows.length));
  /* Two real coffees of one amount on one day, one file. */
  const coffees = (n) => [['Số tài khoản (Account number)', '000111222333444'], ['Ngày giao dịch', 'Nội dung', 'Ghi nợ', 'Ghi có', 'Số dư']].concat(
    [['01/09/2026', 'Luong thang 8', '', '10,000,000', '10,000,000']],
    Array.from({ length: n }, (_, i) => ['02/09/2026', 'Mua ca phe', '30,000', '', String(10000000 - 30000 * (i + 1))]),
    [['03/09/2026', 'Tien dien', '500,000', '', String(10000000 - 30000 * n - 500000)]]);
  sv = server(); ls = mkStore();
  sv.add('e1', 'VIB', { grid: coffees(2), subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  t('two equal rows in one file are two rows', sv.staged.length === 1 && sealed(sv.staged[0]).filter((p) => /ca phe/.test(p.memo)).length === 2, sv.staged.length && sealed(sv.staged[0]).map((p) => p.memo));
  sv.add('e2', 'VIB', { grid: coffees(2), subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  t('the same file again adds neither of them', sv.staged[1].p_rows.length === 0);
  sv.add('e3', 'VIB', { grid: coffees(3), subject: ACCT_SUBJ });
  res = await boot(sv, ls).open();
  t('a file with three of them adds exactly one, the one no other file holds', sv.staged[2].p_rows.length === 1 && sealed(sv.staged[2]).filter((p) => /ca phe/.test(p.memo)).length === 1,
    sealed(sv.staged[2]).map((p) => p.memo));

  console.log('\n-- R9. one statement, two layouts, one key per row --');
  /* fhStmtCanonical is pure; any booted session hands it out. */
  const canon = boot(server(), mkStore()).window.fhStmtCanonical;
  const parsedKeys = (g) => { const q = T.fhStmtParse(g); return { q, keys: q.rows.map((r) => canon('VIB', q.summary.accountTail, r)) }; };
  const K1 = parsedKeys(SIGNED), K2 = parsedKeys(twin);
  t('two columns (Ghi nợ / Ghi có) and one signed column: the same key, row for row', K1.keys.length === 9 && JSON.stringify(K1.keys) === JSON.stringify(K2.keys), [K1.keys, K2.keys]);
  /* The same statement as PDF text items, through the REAL grid builder: the
     payment's description wraps onto a second line. Positions follow the real
     card PDF's page (see pdf-grid.test.js); every string is from the fixture. */
  global.window = global.window || {};
  eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '43-pdf-grid.js'), 'utf8'));
  const usable = (r) => r.date !== undefined && (r.amount !== undefined || r.debit !== undefined || r.credit !== undefined);
  const WRAP = '000000000123456 - TRAN THI MAI - Thanh toan sao ke the Master Card 08', WRAP1 = '000000000123456 - TRAN THI MAI -', WRAP2 = 'Thanh toan sao ke the Master Card 08';
  /* cols: [x of each column's left edge for text, or { right } for a right-aligned figure] in the grid's column order */
  const pdfOf = (g, heads, cols) => {
    const items = [], I = (y, x, str, w) => items.push({ str, x, y, w: w || String(str).length * 3.8, h: 8 });
    let y = 40, pastHead = false;
    g.forEach((r) => {
      y += 12;
      if (r[0] === 'Ngày giao dịch') { heads.forEach((h) => I(y, h[1], h[0], h[2])); pastHead = true; return; }
      if (!pastHead || !/^\d\d\/\d\d\/2026$/.test(r[0])) { I(y, 30, r[0]); const v = r.slice(1).filter(Boolean)[0]; if (v) I(y, 300, v); return; }
      cols.forEach((c, i) => {
        const s = r[c.src]; if (!s) return;
        if (c.right) I(y, c.right - s.length * 3.8, s);
        else if (s === WRAP) { I(y, c.x, WRAP1); I(y + 8, c.x, WRAP2); }
        else I(y, c.x, s);
      });
      y += 8;
    });
    return window.fhPdfItemsToGrid([{ height: 900, items }], { roles: T.fhStmtRoles, usable });
  };
  /* (a) the real card PDF's layout: the description in a MIDDLE column */
  const midGrid = pdfOf(SIGNED, [['Ngày giao dịch', 30, 57], ['Ngày hạch toán', 101, 60], ['Diễn giải', 172, 33], ['MCC', 362, 18], ['Số tiền (VND)', 519, 51]],
    [{ src: 0, x: 30 }, { src: 1, x: 101 }, { src: 2, x: 172 }, { src: 3, x: 362 }, { src: 4, right: 565 }]);
  const K3 = parsedKeys(midGrid);
  t('(setup) the PDF reading of it proves, inverted, every amount in its cell', K3.q.proof.ok && K3.q.proof.sign === -1 && K3.q.rows.length === 9 && K3.q.unreadable.length === 0, K3.q.proof);
  const pay = K3.q.rows.findIndex((r) => r.amt === 2150000);
  t('every row but the wrapped one has the spreadsheet\'s key', K3.keys.every((k, i) => i === pay || k === K1.keys[i]), K3.keys);
  /* KNOWN GAP, reported 2026-11-25 and not papered over: in a middle column
     the grid does not rejoin a description's second line (pdf-grid.test.js).
     The row keeps only its first line, so its key differs from the
     spreadsheet's by more than whitespace, R9 cannot match it, and the
     classifier loses the repayment words on the second line. */
  t('KNOWN GAP: the wrapped row keeps only its first line, so its key differs and it is no longer read as a repayment',
    K3.q.rows[pay].description === WRAP1 && K3.keys[pay] !== K1.keys[pay] && K3.q.rows[pay].cls.flow === '' && K1.q.rows[pay].cls.flow === 'cardpay', K3.q.rows[pay].description);
  /* (b) the Techcombank layout: the description is the LAST column, and its
     second line joins the first with a space: one cell, one key. */
  const reorder = (g) => g.map((r) => r[0] === 'Ngày giao dịch' || /^\d\d\/\d\d\/2026$/.test(r[0]) ? [r[0], r[1], r[3], r[4], r[2]] : r);
  const lastSheet = twinOf(reorder(SIGNED));
  const lastGrid = pdfOf(reorder(SIGNED), [['Ngày giao dịch', 30, 57], ['Ngày hạch toán', 101, 60], ['MCC', 172, 18], ['Số tiền (VND)', 230, 51], ['Diễn giải', 320, 33]],
    [{ src: 0, x: 30 }, { src: 1, x: 101 }, { src: 2, x: 172 }, { src: 3, right: 281 }, { src: 4, x: 320 }]);
  const K4 = parsedKeys(lastGrid), K5 = parsedKeys(lastSheet);
  t('description last: the wrapped description is one cell, joined by a space', K4.q.rows.some((r) => r.description === WRAP) && K4.q.proof.ok, K4.q.rows.map((r) => r.description));
  t('...and the PDF and the two-column spreadsheet give the same key, row for row', K4.keys.length === 9 && JSON.stringify(K4.keys) === JSON.stringify(K5.keys) && JSON.stringify(K4.keys) === JSON.stringify(K1.keys), [K4.keys, K5.keys]);

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
