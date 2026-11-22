/* Spaces ("Nhóm"), docs/specs/spaces-spec.md: journeys through the REAL app
   against the stub. `node tools/ui-harness/flows.js tools/ui-harness/flows/spaces.flow.js`

   The stub's active container is turned into a friend space by setting
   __STUB.space and re-reading the roster; its Key Card is a throwaway AES key
   put straight into the spaces module, so shares are really sealed and really
   opened. The fixture family has two members (Minh = me, Lan). */
const FRIEND = `
  (async function(){
    __STUB.space = { type:'friend', name:'Hội bạn thân', profile:{ preset:'friend', emoji:'🍜' } };
    var S = fhSpacesData();
    if(!S.keys[DB.fid]) S.keys[DB.fid] = await FHCrypto.importDek(crypto.getRandomValues(new Uint8Array(32)));
    await fhSpacesBoot({ force:true });
    await fhSpaceHydrate(DB.fid);
    fhSpaceShellApply(); renderAll(); renderTxns(); renderEvents();
    return true;
  })()`;
const QUEUE = `
  (function(){
    var at=function(h){ return new Date(Date.now()-h*3600e3).toISOString(); };
    var mk=function(i,prov,tail,amt,dir,cp,memo,hint,h,rt){ return { id:'stg-'+i, member_id:null, owner_user_id:'00000000-0000-4000-8000-000000000001', staging_scope:'personal', gmail_message_id:'gm'+i, source_provider:prov,
      occurred_at:at(h), amount:amt, currency:'VND', direction:dir, counterparty:cp, reference_number:'FT'+(1000000+i), transaction_type:'bank_txn',
      raw_extracted:{ v:2, amount:amt, currency:'VND', direction:dir, counterparty:cp, memo:memo, memo_display:memo, account_masked:'xxxx'+tail, flow:dir, _transport:'direct', reader_type:rt||'merchant', transaction_type:'bank_txn', category_hint:hint, memo_time:null, source_provider:prov },
      duplicate_of_id:null, resolved_before:false, sealed:null, eph_pub:null, nonce:null, enc_v:null, created_at:at(h) }; };
    var rows=[ mk(0,'VIB','5140',1240000,'debit','QUAN NUONG BA MIEN','Quan nuong Ba Mien','Ăn uống',1),
               mk(1,'Techcombank','8890',59000,'debit','CA PHE GOC PHO','Ca phe Goc Pho','Ăn uống',4),
               (function(cp,amt){ return mk(2,'VIB','5140',amt,'credit',cp,'Lan chuyen tien',null,7,'p2p'); })('TRAN THI LAN',320000) ];
    window.csvExpand=null; window.csvRowSheet=null;
    window.csvEntryScope = window.fhNormScope ? fhNormScope({ kind:'personal' }) : { kind:'personal' };
    window._fhStagedRows = rows; window._fhQueueNewAccts = []; window.csvStagedMode = true;
    try{ csvLearnLoad(); }catch(e){}
    var COLS=['occurred_at','description','amount','counterparty','category'], columnMap={};
    COLS.forEach(function(f,i){ columnMap[i]={ field:f, confidence:1 }; });
    var cells=rows.map(function(r){ var x=r.raw_extracted; return [r.occurred_at, x.memo_display||'', String(r.direction==='credit'?r.amount:-r.amount), r.counterparty||'', x.category_hint||'']; });
    csvBuildReview([{ name:'staged', rows:cells, parsed:{ headers:COLS, rows:cells }, result:{ columnMap:columnMap } }], {});
    renderCsvReview();
    var pick=document.getElementById('csv-pick'); if(pick) pick.style.display='none';
    openSheet('csv-import-modal');
    return true;
  })()`;
const state = () => {
  const S = fhSpacesData(), fid = DB.fid, d = S.data[fid];
  const bal = fhSpaceBalances(fid) || [];
  return { net: fhSpaceMyNet(fid), bal: bal.map((b) => [b.member.name, b.net]), shares: d ? Object.keys(d.shares).length : -1,
    pairs: (fhSpacePairwise(fid) || []).map((p) => [p.from.name, p.to.name, p.amt]) };
};

module.exports = {
  feature: 'spaces',
  flows: [
    {
      name: 'a-family-sees-nothing-new-on-its-tabs',
      lang: 'vi',
      run: async (t) => {
        t.step('an existing family: profile {} → every switch it has today');
        const p = await t.eval(() => fhSpaceProfile());
        t.expect(p.preset === 'family' && p.house && p.budget && p.goals && p.ask && p.moments && p.react && p.source && !p.split, 'family preset, Chia tiền off: ' + JSON.stringify(p));
        const cls = await t.eval(() => document.documentElement.className);
        t.expect(!/sp-no-(?!split\b)|sp-friend|sp-split|sp-closed/.test(cls), 'only "no Chia tiền" is set on <html>, nothing a family would notice: ' + cls);
        t.expect((await t.eval(() => document.querySelector('#t-home span').textContent)) === 'Nhà', 'first tab is still Nhà');
        t.expect((await t.eval(() => document.querySelector('#t-spending span').textContent)) === 'Gia đình', 'second tab is still Gia đình');
        t.expect((await t.eval(() => document.getElementById('sp-chip-spending').innerHTML)) === '', 'no space chip with a single space');
        await t.eval(`go('spending')`); await t.wait(300);
        t.expect((await t.eval(() => document.getElementById('sp-split-box').innerHTML)) === '', 'no balances block in a family without Chia tiền');
        t.expect(await t.eval(() => getComputedStyle(document.querySelector('#v-spending > .cf-card')).display !== 'none'), 'the cash-flow card is still there');

        t.step('the expense sheet has no split block');
        await t.eval(`openExpense({ scope: 'family' })`); await t.wait(400);
        t.expect((await t.eval(() => document.getElementById('ex-splitfield').innerHTML)) === '', 'no Chung/Chia on a family expense');
        t.expect(await t.eval(() => getComputedStyle(document.getElementById('ex-whofield')).display !== 'none'), 'Ai chi is still asked');
        t.expect(await t.eval(() => !!document.querySelector('#ex-who .choice[data-v="Both"]') && getComputedStyle(document.querySelector('#ex-who .choice[data-v="Both"]')).display !== 'none'), 'the Chung seat is still offered');
        await t.eval(`closeModals()`);

        t.step('Tài chính lists the family as one of the spaces');
        await t.eval(`go('personal')`); await t.wait(900);
        const sec = await t.eval(() => (document.getElementById('pers-spaces-wrap') || {}).innerText || '');
        t.expect(/Nhóm/.test(sec) && /Tạo nhóm/.test(sec) && /đang mở/.test(sec), 'Nhóm section with the family marked open: ' + sec.replace(/\n/g, ' | '));
        await t.shot('01-family-personal');
      },
    },
    {
      name: 'b-friend-space-shell',
      lang: 'vi',
      run: async (t) => {
        t.step('the open container becomes a friend space');
        await t.eval(FRIEND); await t.wait(400);
        const p = await t.eval(() => fhSpaceProfile());
        t.expect(p.preset === 'friend' && p.split && p.moments && p.react && !p.house && !p.budget && !p.goals && !p.ask && !p.source && p.mode === 'chia', 'friend preset: ' + JSON.stringify(p));
        t.expect((await t.eval(() => document.querySelector('#t-home span').textContent)) === 'Nhóm', 'first tab reads Nhóm');
        t.expect((await t.eval(() => document.querySelector('#t-spending span').textContent)) === 'Chi tiêu', 'second tab reads Chi tiêu');
        t.expect(await t.eval(() => getComputedStyle(document.getElementById('t-events')).display !== 'none'), 'Khoảnh khắc stays (moments on)');

        t.step('home has no house');
        await t.eval(`go('home')`); await t.wait(400);
        t.expect(await t.eval(() => getComputedStyle(document.getElementById('home-sky')).display === 'none'), 'the sky is hidden');
        const home = await t.eval(() => document.getElementById('home-body').innerText);
        t.expect(/Hội bạn thân/.test(home) && /Ghi khoản chung/.test(home) && /Ghi trả nợ/.test(home), 'space home: name and the two actions');
        await t.eval(() => { document.querySelector('#home-body .sp-invite').click(); }); await t.wait(400);
        t.expect(/Mời vào nhóm/.test(await t.eval(() => document.getElementById('fh-modal-title').innerText)) && await t.eval(() => document.getElementById('fh-modal').classList.contains('on')), 'the Mời button on the space home reopens the invite sheet');
        await t.eval(`_closeOv()`);
        await t.shot('01-home');

        t.step('money tab opens on balances, not the family cash-flow card');
        await t.eval(`go('spending')`); await t.wait(400);
        t.expect(await t.eval(() => getComputedStyle(document.querySelector('#v-spending > .cf-card')).display === 'none'), 'cash-flow card hidden');
        const box = await t.eval(() => document.getElementById('sp-split-box').innerText);
        t.expect(/Cả nhóm đã chi tháng này/i.test(box) && /Số dư nhóm/i.test(box), 'balances block: ' + box.replace(/\n/g, ' | ').slice(0, 160));
        t.expect(/Hội bạn thân/.test(await t.eval(() => document.getElementById('sp-chip-spending').innerText)), 'the chip names the space');
        t.expect(await t.eval(() => getComputedStyle(document.getElementById('goal-card')).display === 'none'), 'no goals card');
        await t.shot('02-money');

        t.step('moments off hides the tab and redirects');
        await t.eval(`(async function(){ __STUB.space.profile.moments = false; await fhSpacesBoot({ force:true }); fhSpaceShellApply(); })()`); await t.wait(200);
        t.expect(await t.eval(() => getComputedStyle(document.getElementById('t-events')).display === 'none'), 'Khoảnh khắc tab hidden');
        await t.eval(`go('events')`); await t.wait(200);
        t.expect(await t.eval(() => document.getElementById('v-home').classList.contains('on')), 'go(events) lands on the first tab');

        t.step('the switcher lists every space');
        await t.eval(`(async function(){ __STUB.spaces = [{ family_id:'bbbbbbbb-0000-4000-8000-000000000001', name:'Cầu lông thứ 5', type:'friend', profile:{ preset:'friend', emoji:'🏸' }, members:6 }]; await fhSpacesBoot({ force:true }); fhSpaceSwitcher(); })()`); await t.wait(400);
        const sw = await t.eval(() => document.getElementById('fh-sheet-body').innerText);
        t.expect(/Hội bạn thân/.test(sw) && /Cầu lông thứ 5/.test(sw) && /Tạo nhóm/.test(sw), 'switcher: ' + sw.replace(/\n/g, ' | '));
        await t.shot('03-switcher');
        await t.eval(`_closeOv()`);
      },
    },
    {
      name: 'c-chia-expense-equal',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        t.step('the sheet offers Chung or Chia, Chia pre-selected, me as payer');
        await t.eval(`go('spending'); openExpense({ scope: 'family' })`); await t.wait(500);
        await t.eval(() => { const b = document.querySelector('#ex-scope [data-v="family"]'); if (b) b.click(); });
        const ui = await t.eval(() => ({ html: document.getElementById('ex-splitfield').innerText, mode: FH_SPLIT && FH_SPLIT.mode, payer: FH_SPLIT && fhSpaceMemberName(FH_SPLIT.payer),
          who: getComputedStyle(document.getElementById('ex-whofield')).display, scope: document.querySelector('#ex-scope [data-v="family"]').textContent }));
        t.expect(ui.mode === 'chia' && /Ai trả\?/i.test(ui.html) && /Ai trong nhóm\?/i.test(ui.html) && /Chia mấy phần\?/i.test(ui.html), 'split block: ' + ui.html.replace(/\n/g, ' | ').slice(0, 200));
        t.expect(ui.payer === 'Minh', 'the recorder is the default payer: ' + ui.payer);
        t.expect(ui.who === 'none', 'the old Ai chi field steps aside for a Chia expense');
        t.expect(/Hội bạn thân/.test(ui.scope), 'the destination chip names the space: ' + ui.scope);

        t.step('fill and save');
        await t.type('#ex-note', 'Quán nướng');
        await t.eval(() => { const c = document.querySelector('#ex-cat [data-v="Ăn uống"]'); if (c) c.click(); });
        await t.type('#ex-amt', '1240000'); await t.wait(250);
        t.expect(/620\.000/.test(await t.eval(() => document.getElementById('spx-hint').innerText)), 'the hint shows each share (2 members → 620.000)');
        await t.shot('01-sheet');
        await t.click('#ex-save'); await t.wait(1600);
        t.expect(!(await t.eval(() => document.getElementById('expense-modal').classList.contains('on'))), 'modal closed after save');

        t.step('the space got one expense row and one sealed share row');
        const w = await t.writes();
        const ins = w.filter((x) => x.table === 'transactions' && x.op === 'insert');
        t.expect(ins.length === 1 && Number(ins[0].payload.amount) === 1240, 'one transactions insert for 1240: ' + JSON.stringify(ins.map((x) => x.payload.amount)));
        t.expect(ins[0].payload.link_id == null && ins[0].payload.instrument == null, 'no pre-set link and no instrument on the space row');
        const sh = w.filter((x) => x.table === 'txn_shares');
        t.expect(sh.length === 1 && sh[0].op === 'upsert' && typeof sh[0].payload.shares_enc === 'string' && sh[0].payload.shares_enc.length > 20 && !/620|Minh/.test(sh[0].payload.shares_enc), 'one txn_shares upsert, ciphertext only');
        const st = await t.eval(state);
        t.expect(st.shares === 1 && st.net === 620, 'balances: I am owed 620: ' + JSON.stringify(st));
        t.expect(JSON.stringify(st.pairs) === JSON.stringify([['Lan', 'Minh', 620]]), 'Lan pays Minh 620');
        const row = await t.eval(() => { const r = [].find.call(document.querySelectorAll('#tx-rows .row, #v-spending .row'), (e) => /Quán nướng/.test(e.innerText)); return r ? r.innerText : ''; });
        t.expect(/Minh trả/.test(row) && /chia 2/.test(row) && /620/.test(row), 'the row says who paid and how it was cut: ' + row.replace(/\n/g, ' | '));
        await t.shot('02-saved');

        t.step('settle up squares the space');
        await t.eval(`fhSpaceSettleSheet(DB.fid)`); await t.wait(400);
        const pre = await t.eval(() => ({ from: chosen('dbt-sufrom'), to: chosen('dbt-suto'), amt: document.getElementById('dbt-amt').value }));
        t.expect(/620/.test(pre.amt), 'the sheet proposes the amount owed: ' + pre.amt);
        await t.shot('03-settle');
        await t.eval(`fhModalSave()`); await t.wait(900);
        const st2 = await t.eval(state);
        t.expect(st2.net === 0 && st2.pairs.length === 0, 'after the settle-up nobody owes anybody: ' + JSON.stringify(st2));
        t.expect(/cân bằng/.test(await t.eval(() => document.getElementById('sp-split-box').innerText)), 'the money tab says so');
        await t.shot('04-square');
      },
    },
    {
      name: 'd-chia-with-an-outside-share',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        await t.eval(`go('spending'); openExpense({ scope: 'family' })`); await t.wait(500);
        await t.eval(() => { const b = document.querySelector('#ex-scope [data-v="family"]'); if (b) b.click(); });
        await t.type('#ex-note', 'Lẩu ba người');
        await t.eval(() => { const c = document.querySelector('#ex-cat [data-v="Ăn uống"]'); if (c) c.click(); });
        await t.type('#ex-amt', '1200000'); await t.wait(200);
        t.step('three shares for two members: one is outside the space');
        await t.eval(`fhSplitAct('parts','3')`); await t.wait(150);
        const hint = await t.eval(() => document.getElementById('spx-hint').innerText);
        t.expect(/3 phần/.test(hint) && /400\.000/.test(hint) && /1 phần ngoài nhóm/.test(hint), 'hint: ' + hint);
        await t.shot('01-outside');
        await t.click('#ex-save'); await t.wait(1600);
        const w = await t.writes();
        const ins = w.filter((x) => x.table === 'transactions' && x.op === 'insert');
        t.expect(ins.length === 1 && Number(ins[0].payload.amount) === 800, 'the space records the members\' part, 800: ' + JSON.stringify(ins.map((x) => x.payload.amount)));
        const map = await t.eval(() => { const d = fhSpacesData().data[DB.fid]; const k = Object.keys(d.shares)[0]; return d.shares[k].map; });
        t.expect(map._out === 400 && map._parts === 3 && map._bill === 1200, 'the sealed split remembers the bill and the outside share: ' + JSON.stringify(map));
        const st = await t.eval(state);
        t.expect(st.net === 400, 'the space owes me only the other member\'s share, 400: ' + JSON.stringify(st));
        const row = await t.eval(() => { const r = [].find.call(document.querySelectorAll('#v-spending .row'), (e) => /Lẩu ba người/.test(e.innerText)); return r ? r.innerText : ''; });
        t.expect(/Hoá đơn 1\.200\.000/.test(row) && /ngoài nhóm/.test(row), 'the row carries the bill total: ' + row.replace(/\n/g, ' | '));
        await t.shot('02-saved');
      },
    },
    {
      name: 'e-chung-expense-moves-no-balance',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        await t.eval(`go('spending'); openExpense({ scope: 'family' })`); await t.wait(500);
        await t.eval(() => { const b = document.querySelector('#ex-scope [data-v="family"]'); if (b) b.click(); });
        await t.eval(`fhSplitAct('mode','chung')`); await t.wait(150);
        t.expect(await t.eval(() => getComputedStyle(document.getElementById('ex-whofield')).display !== 'none'), 'Chung asks who paid on the usual field');
        t.expect(await t.eval(() => getComputedStyle(document.querySelector('#ex-who .choice[data-v="Both"]')).display === 'none'), 'no "Chung" seat in a friend space');
        await t.type('#ex-note', 'Nước uống');
        await t.eval(() => { const c = document.querySelector('#ex-cat [data-v="Ăn uống"]'); if (c) c.click(); });
        await t.type('#ex-amt', '90000'); await t.wait(200);
        await t.click('#ex-save'); await t.wait(1400);
        const w = await t.writes();
        t.expect(w.filter((x) => x.table === 'transactions' && x.op === 'insert').length === 1, 'the expense is written');
        t.expect(w.filter((x) => x.table === 'txn_shares').length === 0, 'and no share row');
        t.expect((await t.eval(state)).net === 0, 'nobody owes anybody');
      },
    },
    {
      name: 'f-capture-into-the-space',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        t.step('a bank row waits in the review queue, private by default');
        await t.eval(QUEUE); await t.wait(700);
        const head = await t.eval(() => document.getElementById('csv-result').innerText);
        t.expect(/RIÊNG TƯ/i.test(head) && /1\.240\.000/.test(head), 'the row is in the queue, marked private');
        await t.eval(() => { const i = csvReview.ready.findIndex((c) => /nuong/i.test(c.description || '')); csvToggleExpand('ready', i); }); await t.wait(400);
        await t.shot('01-card-personal');

        t.step('Ghi vào đâu lists every space');
        await t.eval(`csvRowSheetOpen('scope')`); await t.wait(300);
        const chips = await t.eval(() => [].map.call(document.querySelectorAll('#csv-rowsheet .choice'), (b) => b.innerText.trim()));
        t.expect(chips.length === 2 && /Cá nhân/.test(chips[0]) && /Hội bạn thân/.test(chips[1]), 'chips: ' + JSON.stringify(chips));
        await t.shot('02-where');
        await t.eval(() => { const b = [].find.call(document.querySelectorAll('#csv-rowsheet .choice'), (x) => /Hội bạn thân/.test(x.innerText)); b.click(); }); await t.wait(400);

        t.step('the card reshapes: payer locked, the space default split pre-filled');
        const card = await t.eval(() => document.querySelector('#csv-result .csv-srows').innerText);
        t.expect(/Ai trả/i.test(card) && /Minh/.test(card) && /Tính thế nào/i.test(card) && /Chia đều · 2 người/.test(card) && /620\.000/.test(card), 'rows: ' + card.replace(/\n/g, ' | ').slice(0, 260));
        t.expect(!/Loại khoản/i.test(card), 'Loại khoản is gone for a space row');
        const cta = await t.eval(() => document.querySelector('#csv-result .csv-cta-go').innerText);
        t.expect(/Ghi vào Hội bạn thân/.test(cta), 'the button names the space: ' + cta);
        t.expect(/Cả nhóm thấy khoản này/.test(await t.eval(() => (document.querySelector('#csv-result .sp-capnote') || {}).innerText || '')), 'the line above the button says what the others see');
        await t.shot('03-card-space');

        t.step('the split sheet: three shares for two members');
        await t.eval(`csvRowSheetOpen('split')`); await t.wait(300);
        await t.eval(`fhSplitAct('parts','3')`); await t.wait(200);
        t.expect(/1 phần ngoài nhóm/.test(await t.eval(() => document.getElementById('spx-hint').innerText)), 'the hint names the outside share');
        await t.shot('04-split');
        await t.eval(`csvRowSheetClose()`); await t.wait(300);
        const card2 = await t.eval(() => document.querySelector('#csv-result .csv-srows').innerText);
        t.expect(/Chia 3 phần/.test(card2) && /2 trong nhóm · 1 ngoài nhóm/.test(card2), 'the card shows it: ' + card2.replace(/\n/g, ' | ').slice(0, 220));

        t.step('one tap files it');
        const before = (await t.writes()).length;
        await t.eval(() => { const i = csvReview.ready.findIndex((c) => /nuong/i.test(c.description || '')); return csvImportOne(i); }); await t.wait(2200);
        const w = (await t.writes()).slice(before);
        const ins = w.filter((x) => x.table === 'transactions' && x.op === 'insert');
        t.expect(ins.length === 1, 'one expense row written: ' + JSON.stringify(w.map((x) => x.table + ':' + x.op)));
        t.expect(ins[0] && Math.abs(Number(ins[0].payload.amount) - 826.667) < 0.01, 'for the members\' part of 1.240.000 (two of three shares): ' + (ins[0] && ins[0].payload.amount));
        t.expect(ins[0] && ins[0].payload.instrument == null, 'the bank is not written to the space row (Hiện nguồn tiền is off)');
        t.expect(w.filter((x) => x.table === 'txn_shares').length === 1, 'and one sealed share row');
        const st = await t.eval(state);
        t.expect(Math.abs(st.net - 413.333) < 0.01, 'the other member owes me one share: ' + JSON.stringify(st));
        t.expect(!(await t.eval(() => csvReview.ready.some((c) => /nuong/i.test(c.description || '')))), 'the row left the queue');
        await t.shot('05-filed');
      },
    },
    {
      name: 'g-capture-a-settle-up',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        t.step('Lan owes me 620 after a shared dinner');
        await t.eval(`(async function(){ var fid=DB.fid, my=fhSpaceMyMemberId(fid), other=fhSpaceMembers(fid).filter(function(m){return m.id!==my;})[0];
          var r=fhSplitCompute({amt:1240,members:[my,other.id]});
          await fhSpaceAddExpense(fid,{amtK:1240,note:'Quán nướng',payerMemberId:my,shares:fhSplitPayload(r,1240),rule:'equal'}); })()`); await t.wait(500);
        t.expect((await t.eval(state)).net === 620, 'set-up: the space owes me 620');
        t.step('her 620.000 transfer arrives: offered as a settle-up, nothing applied');
        await t.eval(QUEUE.replace("'TRAN THI LAN',320000", "'TRAN THI LAN',620000")); await t.wait(700);
        const idx = await t.eval(() => csvReview.ready.findIndex((c) => !!c._spSettle));
        t.expect(idx >= 0, 'the incoming transfer is recognised as a settle-up');
        t.expect((await t.eval(state)).net === 620, 'and nothing has moved yet');
        await t.eval((i) => csvToggleExpand('ready', i), idx); await t.wait(400);
        const card = await t.eval(() => document.querySelector('#csv-result .csv-srows').innerText);
        t.expect(/Hội bạn thân/.test(card) && /Lan trả nợ nhóm/.test(card) && /Khớp số Lan đang nợ bạn/.test(card), 'rows: ' + card.replace(/\n/g, ' | ').slice(0, 240));
        t.expect(/Ghi trả nợ/.test(await t.eval(() => document.querySelector('#csv-result .csv-cta-go').innerText)), 'the button says what it will do');
        await t.shot('01-offer');
        const before = (await t.writes()).length;
        await t.eval((i) => csvImportOne(i), idx); await t.wait(2000);
        const w = (await t.writes()).slice(before);
        t.expect(w.filter((x) => x.table === 'settle_ups' && x.op === 'insert').length === 1, 'one settle-up written: ' + JSON.stringify(w.map((x) => x.table + ':' + x.op)));
        t.expect(w.filter((x) => x.table === 'transactions').length === 0, 'and no expense or income row in the space');
        t.expect((await t.eval(state)).net === 0, 'the space is square');
      },
    },
    {
      name: 'h-create-a-space-and-change-its-profile',
      lang: 'vi',
      run: async (t) => {
        t.step('the create sheet: name, preset, switches');
        await t.eval(`go('personal'); fhSpaceCreateSheet()`); await t.wait(500);
        const body = await t.eval(() => document.getElementById('fh-modal-body').innerText);
        t.expect(/Tên nhóm/i.test(body) && /Gia đình/.test(body) && /Bạn bè/.test(body) && /Khác/.test(body) && /Chia tiền/.test(body) && /Ngôi nhà/.test(body), 'sheet has the presets and the switches');
        const on = await t.eval(() => [].filter.call(document.querySelectorAll('#sp-switches .rl-row'), (b) => b.getAttribute('aria-checked') === 'true').map((b) => b.getAttribute('data-k')));
        t.expect(JSON.stringify(on) === JSON.stringify(['split', 'moments', 'react']), 'Bạn bè preset: split, moments, react on: ' + JSON.stringify(on));
        await t.eval(`fhModalSave()`); await t.wait(300);
        t.expect(await t.eval(() => document.getElementById('fh-modal').classList.contains('on')), 'no name → the sheet stays (and flags the field)');
        await t.type('#sp-name', 'Hội bạn thân');
        await t.eval(() => { const b = document.querySelector('#sp-switches .rl-row[data-k="goals"]'); b.click(); });
        await t.shot('01-create');

        t.step('create → the Key Card → the invite sheet');
        const before = (await t.eval(() => (window.__stubLog || []).length));
        await t.eval(`fhModalSave()`); await t.wait(5000);
        const calls = await t.eval((n) => (window.__stubLog || []).slice(n).filter((e) => e.phase === 'start' && /^rpc:/.test(e.route)).map((e) => e.route), before);
        t.expect(calls.indexOf('rpc:create_space') >= 0 && calls.indexOf('rpc:init_space_card') > calls.indexOf('rpc:create_space'), 'create_space then init_space_card: ' + JSON.stringify(calls));
        const made = await t.eval(() => { const S = fhSpacesData(), sp = S.all.find((x) => x.name === 'Hội bạn thân'); return sp ? { type: sp.type, profile: sp.profile, key: !!S.keys[sp.id], card: !!fhSpaceCardCached(sp.id), url: fhSpaceInviteUrl(sp.id) } : null; });
        t.expect(made && made.type === 'friend' && made.profile.preset === 'friend' && made.profile.goals === true && made.profile.split === true && made.profile.mode === 'chia', 'the space carries the chosen profile: ' + JSON.stringify(made && made.profile));
        t.expect(made && made.key && made.card, 'its key is on this device and the card is cached');
        t.expect(made && /#fh-s=[0-9a-f-]{36}&fh-k=/.test(made.url), 'the invite link carries the space id and the key in the fragment');
        t.expect(/Mã khóa của nhóm/.test(await t.eval(() => document.getElementById('fh-modal-title').innerText)), 'the Key Card is shown once');
        await t.shot('02-card');
        await t.eval(`fhModalSave()`); await t.wait(700);
        const inv = await t.eval(() => ({ title: document.getElementById('fh-modal-title').innerText, qr: !!document.querySelector('#sp-qr-wrap canvas'), body: document.getElementById('fh-modal-body').innerText }));
        t.expect(/Mời vào nhóm/.test(inv.title) && inv.qr && /Chia sẻ link mời/.test(inv.body) && /Email Google/i.test(inv.body) && inv.body.search(/Email Google/i) < inv.body.search(/Chia sẻ link mời/), 'invite sheet: email first, then the link and QR for someone without the app');
        await t.shot('03-invite');

        t.step('Done opens the new space');
        await t.eval(`fhModalSave()`); await t.wait(1500);
        const sw = await t.eval(() => (window.__stubLog || []).filter((e) => e.phase === 'start' && e.route === 'rpc:switch_family').length);
        t.expect(sw >= 1, 'switch_family was called');

        t.step('the owner turns a switch off on the profile screen');
        await t.eval(FRIEND); await t.wait(300);
        await t.eval(`fhSpaceProfileSheet()`); await t.wait(400);
        await t.eval(() => { const b = document.querySelector('#sp-switches .rl-row[data-k="react"]'); b.click(); });
        await t.shot('04-profile');
        await t.eval(`fhModalSave()`); await t.wait(900);
        const p = await t.eval(() => fhSpaceProfile());
        t.expect(p.react === false && p.split === true, 'reactions are off for the space: ' + JSON.stringify(p));
        t.expect(/sp-no-react/.test(await t.eval(() => document.documentElement.className)), 'and the shell follows');
      },
    },
    {
      name: 'i-capture-into-a-space-that-is-not-open',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        t.step('a second space this device holds the key to');
        const OTHER = 'bbbbbbbb-0000-4000-8000-000000000001';
        await t.eval(`(async function(){ __STUB.spaces = [{ family_id:'${OTHER}', name:'Cầu lông thứ 5', type:'friend', profile:{ preset:'friend', emoji:'🏸' }, members:2 }];
          var S=fhSpacesData(); S.keys['${OTHER}'] = await FHCrypto.importDek(crypto.getRandomValues(new Uint8Array(32)));
          await fhSpacesBoot({ force:true }); await fhSpaceHydrate('${OTHER}'); return true; })()`); await t.wait(300);
        await t.eval(QUEUE); await t.wait(700);
        await t.eval(() => { const i = csvReview.ready.findIndex((c) => /nuong/i.test(c.description || '')); csvToggleExpand('ready', i); }); await t.wait(300);
        await t.eval(`csvRowSheetOpen('scope')`); await t.wait(300);
        const chips = await t.eval(() => [].map.call(document.querySelectorAll('#csv-rowsheet .choice'), (b) => b.innerText.trim()));
        t.expect(chips.length === 3 && /Cầu lông thứ 5/.test(chips[2]), 'the other space is offered: ' + JSON.stringify(chips));
        await t.eval(() => { const b = [].find.call(document.querySelectorAll('#csv-rowsheet .choice'), (x) => /Cầu lông/.test(x.innerText)); b.click(); }); await t.wait(400);
        const cta = await t.eval(() => document.querySelector('#csv-result .csv-cta-go').innerText);
        t.expect(/Ghi vào Cầu lông thứ 5/.test(cta), 'the button names it: ' + cta);
        await t.shot('01-card');

        t.step('filed with that space\'s own key, never the open one\'s');
        const before = (await t.writes()).length;
        await t.eval(() => { const i = csvReview.ready.findIndex((c) => /nuong/i.test(c.description || '')); return csvImportOne(i); }); await t.wait(2200);
        const w = (await t.writes()).slice(before);
        const ins = w.filter((x) => x.table === 'transactions' && x.op === 'insert');
        t.expect(ins.length === 1 && ins[0].payload.family_id === OTHER, 'one expense row, in the other space: ' + JSON.stringify(ins.map((x) => x.payload.family_id)));
        t.expect(ins[0] && typeof ins[0].payload.amount_enc === 'string' && ins[0].payload.amount == null && ins[0].payload.note == null, 'amount and note are ciphertext only');
        t.expect(ins[0] && ins[0].payload.instrument == null, 'no bank on the space row');
        const sh = w.filter((x) => x.table === 'txn_shares');
        t.expect(sh.length === 1 && sh[0].payload.family_id === OTHER, 'its share row is in the other space too');
        t.expect(!(await t.eval(() => csvReview.ready.some((c) => /nuong/i.test(c.description || '')))), 'the row left the queue');
        t.expect((await t.eval(() => DB.fid)) !== OTHER, 'and the open space did not change');
      },
    },
    {
      name: 'j-a-closed-space-is-read-only',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        await t.eval(`(async function(){ await fhSpaceClose(DB.fid, true); fhSpaceShellApply(); renderAll(); go('spending'); })()`); await t.wait(500);
        t.expect(/sp-closed/.test(await t.eval(() => document.documentElement.className)), 'the shell knows the space is closed');
        t.expect(await t.eval(() => getComputedStyle(document.querySelector('.fab')).display === 'none'), 'no add button');
        t.expect(/Nhóm đã đóng/.test(await t.eval(() => document.getElementById('sp-split-box').innerText)), 'the money tab says it is closed');
        await t.eval(`openExpense({ scope:'family' })`); await t.wait(400);
        t.expect((await t.eval(() => document.getElementById('ex-splitfield').innerHTML)) === '', 'no split is offered into a closed space');
        await t.eval(`closeModals()`);
        const r = await t.eval(() => fhSpaceSettle(DB.fid, { fromMember: 'x', toMember: 'y', amtK: 1 }));
        t.expect(r && r.ok === false && r.error === 'closed', 'a settle-up is refused: ' + JSON.stringify(r));
        await t.shot('01-closed');
      },
    },
    {
      name: 'k-the-key-travels-sealed-to-the-invitee',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        t.step('the owner adds an email: the key is sealed to that account, nothing readable reaches the server');
        await t.eval(`(function(){ var kp = nacl.box.keyPair(); window.__lan = kp; var b=''; for(var i=0;i<32;i++) b+=String.fromCharCode(kp.publicKey[i]); __STUB.invPub = btoa(b);
          window.__card = FHCrypto.genCard().display; localStorage.setItem('fh-scard:'+DB.fid, window.__card); fhSpaceInviteSheet(DB.fid); })()`); await t.wait(500);
        const url = await t.eval(() => fhSpaceInviteUrl(DB.fid));
        t.expect(/#fh-s=[0-9a-f-]{36}&fh-k=[^&]+&fh-n=H/.test(url), 'the invite link carries id, key and the space name: ' + url.replace(/fh-k=[^&]+/, 'fh-k=…'));
        await t.eval(`(function(){ window.__inv = []; var o = sb.functions.invoke; sb.functions.invoke = function(n, a){ window.__inv.push({ n: n, body: a && a.body }); return o.apply(this, arguments); }; window.fhUser = window.fhUser || { id: 'x' }; })()`);
        await t.type('#sp-inv-email', 'Lan@gmail.com');
        await t.eval(`fhSpaceInvAdd()`); await t.wait(900);
        const wl = await t.eval(() => __STUB.wl[DB.fid]);
        t.expect(wl.length === 1 && wl[0].email === 'lan@gmail.com' && typeof wl[0].key_sealed === 'string', 'one pending invite with a sealed key');
        const inv1 = await t.eval(() => window.__inv.filter((x) => x.n === 'push-send' && x.body && x.body.kind === 'space_invite'));
        t.expect(inv1.length === 1 && inv1[0].body.email === 'lan@gmail.com' && inv1[0].body.family_id === (await t.eval(() => DB.fid)) && !('ck' in inv1[0].body), 'the invitee is notified: one space_invite push for that email and space: ' + JSON.stringify(inv1.map((x) => x.body)));
        const card = await t.eval(() => window.__card);
        t.expect(wl[0].key_sealed.indexOf(card) < 0 && !/gmail/.test(wl[0].key_sealed), 'the stored box shows neither the card nor the email');
        const pend = await t.eval(() => document.getElementById('sp-inv-pending').innerText);
        t.expect(/lan@gmail\.com/i.test(pend) && /Đã gửi kèm mã khóa/.test(pend) && /Mã xác nhận [0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2}/.test(pend), 'the list says so, with the check code: ' + pend.replace(/\n/g, ' | '));
        await t.shot('01-owner');

        t.step('only the invitee\'s private key opens it, and it yields the card');
        const opened = await t.eval(() => { const s = __STUB.wl[DB.fid][0].key_sealed; return { mine: fhSpaceSealOpen(nacl, s, __lan.secretKey, DB.fid), other: fhSpaceSealOpen(nacl, s, nacl.box.keyPair().secretKey, DB.fid), code: fhSpaceKeyCode(__STUB.invPub) }; });
        t.expect(opened.mine.ok && opened.mine.card === card && opened.mine.email === 'lan@gmail.com', 'Lan opens it: ' + JSON.stringify({ ok: opened.mine.ok, email: opened.mine.email }));
        t.expect(opened.other.ok === false, 'a stranger does not');
        t.expect(pend.indexOf(opened.code) >= 0, 'the code the owner saw is the code of Lan\'s key');

        t.step('an email with no account: no key, the list says to send the link');
        await t.eval(`__STUB.invPub = null`);
        await t.type('#sp-inv-email', 'khoa@gmail.com');
        await t.eval(`fhSpaceInvAdd()`); await t.wait(900);
        t.expect((await t.eval(() => window.__inv.filter((x) => x.body && x.body.kind === 'space_invite').map((x) => x.body.email))).join() === 'lan@gmail.com,khoa@gmail.com', 'a second invite seconds later is not swallowed by the cooldown');
        const pend2 = await t.eval(() => document.getElementById('sp-inv-pending').innerText);
        t.expect(/khoa@gmail\.com/i.test(pend2) && /Chưa có tài khoản Earthy/.test(pend2), 'said plainly: ' + pend2.replace(/\n/g, ' | ').slice(0, 200));
        t.step('…and once that person has an account, the owner\'s device seals to them without being asked');
        await t.eval(`(function(){ var b=''; var kp=nacl.box.keyPair(); for(var i=0;i<32;i++) b+=String.fromCharCode(kp.publicKey[i]); __STUB.invPub = btoa(b); })()`);
        const n = await t.eval(() => fhSpaceSealPending(DB.fid));
        t.expect(n === 1 && (await t.eval(() => __STUB.wl[DB.fid].every((i) => !!i.key_sealed))), 'the waiting invite got its key: ' + n);
      },
    },
    {
      name: 'l-an-invite-reaches-the-installed-app-by-paste',
      lang: 'vi',
      run: async (t) => {
        const OTHER = 'dddddddd-0000-4000-8000-000000000001';
        const link = 'https://fhtest-opal.vercel.app/#fh-s=' + OTHER + '&fh-n=' + encodeURIComponent('Phượt Đà Lạt');
        t.step('a link opened where nobody is signed in: the hand-off sheet');
        await t.eval((l) => { fhSpacePendingFromText(l); window.__fhPendingSpaceUrl = l; window.__fhPendingSpaceFresh = true; const r = localStorage.getItem('fh-resume'); localStorage.removeItem('fh-resume'); fhSpaceHandoffShow(); localStorage.setItem('fh-resume', r || '1'); }, link);
        await t.wait(300);
        const ho = await t.eval(() => (document.getElementById('sp-handoff') || {}).innerText || '');
        t.expect(/Phượt Đà Lạt/.test(ho) && /Sao chép lời mời/.test(ho) && /Dán link mời/.test(ho) && /tiếp tục trên trình duyệt này/i.test(ho), 'names the space and both ways forward');
        await t.shot('01-handoff');
        t.expect(JSON.parse(await t.eval(() => sessionStorage.getItem('fh-pending-space'))).fid === OTHER, 'the invite is kept for the sign-in round trip (sessionStorage)');
        await t.eval(() => { document.getElementById('sp-ho-here').click(); });
        t.expect(!(await t.eval(() => !!document.getElementById('sp-handoff'))), '"continue here" closes the sheet');
        await t.eval(() => { window.__fhPendingSpace = null; sessionStorage.removeItem('fh-pending-space'); });

        t.step('in the app: Dán link mời');
        await t.eval(`go('personal')`); await t.wait(900);
        t.expect(/Dán link mời/.test(await t.eval(() => document.getElementById('pers-spaces-wrap').innerText)), 'the Nhóm section offers it');
        await t.eval((id) => { __STUB.joinable = [{ family_id: id, name: 'Phượt Đà Lạt', type: 'friend', profile: { preset: 'friend' }, members: 3 }]; navigator.clipboard.readText = () => Promise.reject(new Error('denied')); fhSpacePasteInvite(); }, OTHER);
        await t.wait(500);
        t.expect(/Dán link mời/.test(await t.eval(() => document.getElementById('fh-modal-title').innerText)), 'clipboard refused → a field to paste into');
        await t.eval(`fhModalSave()`); await t.wait(300);
        t.expect(await t.eval(() => document.getElementById('fh-modal').classList.contains('on')), 'an empty field does not submit');
        await t.type('#sp-paste-in', 'Vào nhóm nhé ' + link);
        await t.shot('02-paste');
        const before = await t.eval(() => (window.__stubLog || []).length);
        await t.eval(`fhModalSave()`); await t.wait(2500);
        const calls = await t.eval((n) => (window.__stubLog || []).slice(n).filter((e) => e.phase === 'start' && /^rpc:/.test(e.route)).map((e) => e.route), before);
        t.expect(calls.indexOf('rpc:join_with_whitelist') >= 0, 'joined: ' + JSON.stringify(calls));
        t.expect(calls.indexOf('rpc:space_my_sealed_key') >= 0, 'asked for the key sealed to this account (the link carried none)');
        t.expect(calls.indexOf('rpc:switch_family') > calls.indexOf('rpc:join_with_whitelist'), 'and the space was opened');
        t.expect(await t.eval((id) => !!fhSpaceGet(id), OTHER), 'the space is in the roster');
        t.expect((await t.eval(() => sessionStorage.getItem('fh-pending-space'))) === null, 'the pending invite is consumed');

        t.step('clipboard allowed: one tap, no field');
        const OTHER2 = 'eeeeeeee-0000-4000-8000-000000000001';
        await t.eval((id) => { __STUB.joinable.push({ family_id: id, name: 'Cầu lông', type: 'friend', profile: { preset: 'friend' }, members: 2 }); navigator.clipboard.readText = () => Promise.resolve('https://x/#fh-s=' + id); _closeOv(); return fhSpacePasteInvite(); }, OTHER2);
        await t.wait(1500);
        t.expect(await t.eval((id) => !!fhSpaceGet(id), OTHER2), 'joined straight from the clipboard');
      },
    },
    {
      name: 'm-a-scanned-receipt-is-split-in-the-space',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        const SEED = `(function(){
          var c=document.createElement('canvas'); c.width=120; c.height=160; var x=c.getContext('2d'); x.fillStyle='#fbfaf6'; x.fillRect(0,0,120,160); x.fillStyle='#222'; x.fillText('TONG',10,80);
          var a=c.toDataURL('image/jpeg',0.8); x.fillText('2',10,100); var b=c.toDataURL('image/jpeg',0.8); var _t=isoDate(TODAY);
          __fhScanSeed({ scope:'family', items:[
            { src:a, state:'ok', amt:176.25, note:'Lẩu nướng', cat:'Ăn uống', date:_t, time:'19:10' },
            { src:b, state:'ok', amt:90, note:'Trà sữa', cat:'Ăn uống', date:_t, time:'20:05' } ] });
        })()`;
        t.step('the review names the space and shows how the batch is counted');
        await t.eval(SEED); await t.wait(500);
        t.expect(/Hội bạn thân/.test(await t.eval(() => document.getElementById('scan-dest').textContent)), 'the destination is the space, not "Sổ gia đình"');
        const row = await t.eval(() => document.getElementById('scan-split').innerText);
        t.expect(/Tính thế nào/i.test(row) && /Chia đều · 2 người/.test(row) && /Minh trả/.test(row) && /áp cho cả 2 hóa đơn/.test(row), 'the batch split, pre-filled with the space default: ' + row.replace(/\n/g, ' | '));
        await t.shot('01-review');

        t.step('the split sheet changes it for the whole batch');
        await t.eval(`fhScanSplitSheet()`); await t.wait(300);
        const sheet = await t.eval(() => document.getElementById('fh-sheet-body').innerText);
        t.expect(/Chia tiền/.test(sheet) && /Ai trả\?/i.test(sheet) && /Chia mấy phần\?/i.test(sheet) && !/Tự nhập từng phần/.test(sheet), 'payer, members, shares; no typed amounts for a batch');
        await t.shot('02-sheet');
        await t.eval(`fhScanSplitDone()`); await t.wait(200);
        t.expect(await t.eval(() => document.getElementById('scan-review').classList.contains('on')), 'back on the review');

        t.step('save: each receipt becomes a split expense');
        const before = (await t.writes()).length;
        await t.eval(() => fhScanSave(document.getElementById('scan-save'))); await t.wait(2600);
        const w = (await t.writes()).slice(before);
        const ins = w.filter((x) => x.table === 'transactions' && x.op === 'insert');
        t.expect(ins.length === 2 && ins.map((x) => Number(x.payload.amount)).sort((a, b) => a - b).join() === '90,176.25', 'two expense rows: ' + JSON.stringify(ins.map((x) => x.payload.amount)));
        t.expect(w.filter((x) => x.table === 'txn_shares').length === 2, 'and two sealed share rows');
        const st = await t.eval(state);
        t.expect(st.shares === 2 && Math.abs(st.net - 133.125) < 0.001, 'the other member owes half of both bills: ' + JSON.stringify(st));

        t.step('Chung for the batch writes no shares');
        await t.eval(SEED); await t.wait(400);
        await t.eval(`fhScanSplitSheet(); fhSplitAct('mode','chung'); fhScanSplitDone();`); await t.wait(300);
        t.expect(/Chung/.test(await t.eval(() => document.getElementById('scan-split').innerText)), 'the row says Chung');
        const b2 = (await t.writes()).length;
        await t.eval(() => fhScanSave(document.getElementById('scan-save'))); await t.wait(2200);
        const w2 = (await t.writes()).slice(b2);
        t.expect(w2.filter((x) => x.table === 'transactions' && x.op === 'insert').length === 2 && w2.filter((x) => x.table === 'txn_shares').length === 0, 'two rows, no shares');
        t.expect(Math.abs((await t.eval(state)).net - 133.125) < 0.001, 'and no balance moved');
      },
    },
    {
      name: 'n-a-saved-chung-expense-can-be-split-afterwards',
      lang: 'vi',
      run: async (t) => {
        await t.eval(FRIEND); await t.wait(300);
        t.step('a bill that went in unsplit (the scanned receipt of 22/11)');
        await t.eval(`go('spending'); openExpense({ scope: 'family' })`); await t.wait(500);
        await t.eval(() => { const b = document.querySelector('#ex-scope [data-v="family"]'); if (b) b.click(); });
        await t.eval(`fhSplitAct('mode','chung')`);
        await t.type('#ex-note', 'Hoá đơn quét');
        await t.eval(() => { const c = document.querySelector('#ex-cat [data-v="Ăn uống"]'); if (c) c.click(); });
        await t.type('#ex-amt', '176250'); await t.wait(200);
        await t.click('#ex-save'); await t.wait(2200);
        t.expect((await t.eval(state)).net === 0, 'nothing owed yet');
        const id = await t.eval(() => (window.txns.find((x) => x.note === 'Hoá đơn quét') || {}).id);
        t.expect(!!id && await t.eval((i) => !!txById(i)._dbId, id), 'the row is saved: ' + id);

        t.step('its detail screen says Chung, and the edit row opens the split');
        await t.eval((i) => openExpenseDetail(i), id); await t.wait(500);
        const view = await t.eval(() => (document.querySelector('.exd-view') || document.body).innerText);
        t.expect(/Tính thế nào/i.test(view) && /Chung/.test(view), 'view shows how it counts');
        await t.eval((i) => fhSpaceEditSplitSheet(i), id); await t.wait(400);
        const sheet = await t.eval(() => document.getElementById('fh-sheet-body').innerText);
        t.expect(/176\.250/.test(sheet) && /Chung/.test(sheet) && /Chia/.test(sheet), 'the sheet opens on this bill: ' + sheet.replace(/\n/g, ' | ').slice(0, 120));
        await t.eval(`fhSplitAct('mode','chia')`); await t.wait(200);
        await t.shot('01-split-sheet');
        const before = (await t.writes()).length;
        await t.eval((i) => fhSpaceEditSplitSave(i), id); await t.wait(1800);
        const w = (await t.writes()).slice(before);
        t.expect(w.filter((x) => x.table === 'txn_shares' && x.op === 'upsert').length === 1, 'the share row is written: ' + JSON.stringify(w.map((x) => x.table + ':' + x.op)));
        t.expect(w.filter((x) => x.table === 'transactions' && x.op === 'insert').length === 0, 'no second expense');
        const st = await t.eval(state);
        t.expect(Math.abs(st.net - 88.125) < 0.001, 'now the other member owes half: ' + JSON.stringify(st));
      },
    },
  ],
};
