/* BUILT states for Spaces (Nhóm). docs/briefs/spaces.md, docs/specs/spaces-spec.md.
   Shot names are the target's (spaces-target.js), so storyboard.js can put each
   built frame beside its target.

   Nothing here is mocked markup: the stub's active container is turned into a
   friend space (four members, four shared expenses) and the app renders it.
   Shares are sealed with a throwaway key and opened by the real space module.

   Not shot here, and why: 19-capture-book and 24-outsider-book are the person's
   own book, whose reads the harness deliberately hangs (session.js), so the
   space pass never writes there. The plan those frames show is pinned by
   tools/spaces-core.test.js. */
const H = `
try{ if(window._closeOv) _closeOv(); closeModals(); closeSheet(); if(window.closePersonalTxDetail) closePersonalTxDetail(); }catch(e){}
try{ var _ts=document.getElementById('toast'); if(_ts) _ts.classList.remove('on'); }catch(e){}
window.__sp = async function(o){
  o = o || {};
  var F = __STUB.family, fid = DB.fid, S = fhSpacesData();
  var iso = function(n){ var d=new Date(Date.now()-n*864e5); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  var mid = function(n){ return '00000000-0000-4000-8000-a0000000000'+n; };
  if(!window.__sp0){
    window.__sp0 = 1;
    var base = F.members[0];
    var M = [ ['Minh', base.user_id, 1], ['Lan', '00000000-0000-4000-8000-000000000002', 2], ['Khoa', '00000000-0000-4000-8000-000000000004', 4], ['Vy', '00000000-0000-4000-8000-000000000005', 5] ];
    F.members = M.map(function(m, i){ return Object.assign({}, base, { id: i < 2 ? F.members[i].id : mid(m[2]), name: m[0], user_id: m[1], is_shared: false }); });
    var ids = F.members.map(function(m){ return m.id; });
    F.family.name = L('Hội bạn thân','Close friends');
    ['monthly_budgets','category_budgets','events','event_fundings','saving_goals','event_memories','incomes','reactions','savings_entries','request_reviews','transaction_photos'].forEach(function(k){ F[k] = []; });
    var cat = function(n){ return (F.categories.filter(function(c){ return c.name === n; })[0] || F.categories[0]).id; };
    var T = [
      { id:'00000000-0000-4000-8000-e00000000001', d:0, amt:500,  note:L('Lẩu cuối tuần','Weekend hotpot'), cat:'Ăn uống', payer:0, who:[0,1,2,3], time:'19:30' },
      { id:'00000000-0000-4000-8000-e00000000002', d:3, amt:1500, note:L('Thuê sân cầu lông tháng 11','Badminton court, November'), cat:'Khác', payer:0, who:[0,1,2,3] },
      { id:'00000000-0000-4000-8000-e00000000003', d:6, amt:600,  note:L('Vé xem phim','Movie tickets'), cat:'Khác', payer:1, who:[0,1,2] },
      { id:'00000000-0000-4000-8000-e00000000004', d:9, amt:660,  note:L('Quà sinh nhật Vy','Birthday gift for Vy'), cat:'Khác', payer:2, who:[0,1,2] }
    ];
    F.transactions = T.map(function(t){ return { id:t.id, category_id:cat(t.cat), member_id:ids[t.payer], note:t.note, note_enc:null, amount:t.amt, amount_enc:null,
      occurred_time:t.time||null, occurred_time_enc:null, txn_date:iso(t.d), status:'posted', created_by:ids[t.payer], created_at:new Date(Date.now()-t.d*864e5).toISOString(),
      source:null, instrument:null, node:null, node_enc:null, recurrence:null, recurrence_source:null }; });
    __STUB.space = { type:'friend', name:F.family.name, profile:{ preset:'friend', emoji:'🍜' } };
    __STUB.spaces = [{ family_id:'bbbbbbbb-0000-4000-8000-000000000001', name:L('Cầu lông thứ 5','Thursday badminton'), type:'friend', profile:{ preset:'friend', emoji:'🏸' }, members:6 }];
    __STUB.tables.txn_shares = []; __STUB.tables.settle_ups = [];
    S.keys[fid] = await FHCrypto.importDek(crypto.getRandomValues(new Uint8Array(32)));
    try{ localStorage.setItem('fh-scard:'+fid, FHCrypto.genCard().display); }catch(e){}
    await fhSpacesBoot({ force:true });
    for(var i=0;i<T.length;i++){
      var mem = T[i].who.map(function(k){ return ids[k]; });
      await fhSpaceSetShares(fid, T[i].id, ids[T[i].payer], 'equal', fhSplitPayload(fhSplitCompute({ amt:T[i].amt, members:mem }), T[i].amt));
    }
    window.__spBase = F.transactions.slice();
  }
  /* each shot starts from the same four expenses and no settle-ups */
  F.transactions = window.__spBase.slice();
  __STUB.tables.txn_shares = __STUB.tables.txn_shares.filter(function(r){ return window.__spBase.some(function(t){ return t.id === r.txn_id; }); });
  __STUB.tables.settle_ups = [];
  __STUB.space.closed = false; __STUB.space.profile = { preset:'friend', emoji:'🍜' };
  __STUB.invites = o.invites || [];
  await fhSpacesBoot({ force:true });
  await loadFamilyData();
  fhSpaceStale(fid); await fhSpaceHydrate(fid);
  if(o.settled){ var ps = fhSpacePairwise(fid); for(var j=0;j<ps.length;j++) await fhSpaceSettle(fid, { fromMember:ps[j].from.id, toMember:ps[j].to.id, amtK:ps[j].amt }); }
  fhSpaceShellApply(); renderAll(); renderTxns(); renderEvents();
  return true;
};
window.__nhom = function(){ go('personal'); if(window.persSpacesAfterRender) persSpacesAfterRender({ force:true }); setTimeout(function(){ var w=document.getElementById('pers-spaces-wrap'), sc=document.getElementById('scroll'); if(w&&sc) sc.scrollTop=Math.max(0, w.offsetTop-130); }, 700); };
window.__q = function(){
  var at=function(h){ return new Date(Date.now()-h*3600e3).toISOString(); };
  var mk=function(i,prov,tail,amt,dir,cp,memo,hint,h,rt){ return { id:'stg-'+i, member_id:null, owner_user_id:'00000000-0000-4000-8000-000000000001', staging_scope:'personal', gmail_message_id:'gm'+i, source_provider:prov,
    occurred_at:at(h), amount:amt, currency:'VND', direction:dir, counterparty:cp, reference_number:'FT'+(1000000+i), transaction_type:'bank_txn',
    raw_extracted:{ v:2, amount:amt, currency:'VND', direction:dir, counterparty:cp, memo:memo, memo_display:memo, account_masked:'xxxx'+tail, flow:dir, _transport:'direct', reader_type:rt||'merchant', transaction_type:'bank_txn', category_hint:hint, memo_time:null, source_provider:prov },
    duplicate_of_id:null, resolved_before:false, sealed:null, eph_pub:null, nonce:null, enc_v:null, created_at:at(h) }; };
  var rows=[ mk(0,'VIB','5140',1240000,'debit','QUAN NUONG BA MIEN','Quan nuong Ba Mien','Ăn uống',1),
             mk(1,'Techcombank','8890',59000,'debit','CA PHE GOC PHO','Ca phe Goc Pho','Ăn uống',4),
             mk(2,'VIB','5140',320000,'credit','TRAN THI LAN','Lan chuyen tien',null,7,'p2p'),
             mk(3,'MoMo','1217',85000,'debit','XE CONG NGHE','Xe cong nghe',null,9) ];
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
  var ttl=document.querySelector('#csv-import-modal .modal-title'); if(ttl) ttl.textContent=L('Duyệt giao dịch','Review transactions');
  openSheet('csv-import-modal');
};
window.__qscroll = function(el, off){
  var sc=document.getElementById('csv-result');
  while(sc && sc!==document.body){ var cs=getComputedStyle(sc); if(/(auto|scroll)/.test(cs.overflowY) && sc.scrollHeight>sc.clientHeight+10) break; sc=sc.parentNode; }
  if(!sc || sc===document.body || !el) return;
  sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-(off||0);
};
window.__card = function(re){ var i=csvReview.ready.findIndex(function(c){ return re.test(c.description||''); }); csvToggleExpand('ready', i<0?0:i); return i; };
window.__pickSpace = function(){ csvRowSheetOpen('scope'); var b=[].filter.call(document.querySelectorAll('#csv-rowsheet .choice'), function(x){ return /Hội bạn thân|Close friends/.test(x.innerText); })[0]; if(b) b.click(); };
window.__money = function(){ go('spending'); setTimeout(function(){ var sc=document.getElementById('scroll'), h=document.querySelector('#sp-split-box .dbt-sec'); if(sc&&h) sc.scrollTop+=h.getBoundingClientRect().top-110; }, 500); };
`;
const then = (body, ms) => `__sp().then(function(){ ${body} });`;

module.exports = {
  feature: 'spaces',
  langs: ['vi', 'en'],
  themes: ['sage'],
  shots: [
    { name: '01-whatsnew', settleMs: 900, setup: H + `openWhatsNew();` },
    { name: '02-nhom-section', settleMs: 2400, setup: H + then(`__nhom();`) },
    { name: '03-create', settleMs: 1800, setup: H + then(`fhSpaceCreateSheet(); setTimeout(function(){ var n=document.getElementById('sp-name'); if(n) n.value=L('Hội bạn thân','Close friends'); },150);`) },
    { name: '04-invite', settleMs: 2000, setup: H + then(`fhSpaceInviteSheet(DB.fid);`) },
    { name: '05-invited', settleMs: 2600, setup: H + `__sp({ invites:[{ family_id:'cccccccc-0000-4000-8000-000000000001', family_name:L('Phượt Đà Lạt','Da Lat trip'), family_type:'friend', invited_by:'Lan' }] }).then(function(){ __nhom(); });` },
    { name: '06-space-home', settleMs: 1900, setup: H + then(`go('home');`) },
    { name: '07-switcher', settleMs: 1900, setup: H + then(`go('home'); fhSpaceSwitcher();`) },
    { name: '08-expense-chia', settleMs: 2200, setup: H + then(`go('spending'); openExpense({ scope:'family' }); setTimeout(function(){ var b=document.querySelector('#ex-scope [data-v="family"]'); if(b) b.click(); document.getElementById('ex-note').value=L('Lẩu cuối tuần','Weekend hotpot'); document.getElementById('ex-amt').value=amtToInput(500); fhExSplitOnAmt(); var sf=document.getElementById('ex-splitfield'); if(sf) sf.scrollIntoView({block:'center'}); },400);`) },
    { name: '09-space-money', settleMs: 1900, setup: H + then(`go('spending');`) },
    { name: '10-settle', settleMs: 1900, setup: H + then(`go('spending'); fhSpaceSettleSheet(DB.fid);`) },
    { name: '11-profile', settleMs: 1900, setup: H + then(`fhSpaceProfileSheet();`) },
    { name: '12-outcome', settleMs: 2600, setup: H + `__sp({ settled:true }).then(function(){ go('spending'); toast(L('Đã ghi trả nợ. Nhóm đã cân bằng.','Settle-up recorded. The space is square.')); });` },

    /* a captured bank row, filed into the space from the review queue */
    { name: '13-capture-queue', settleMs: 2200, setup: H + then(`__q(); setTimeout(function(){ __qscroll(document.querySelector('#csv-result .bulk-check'), 118); },400);`) },
    { name: '13-capture-open', settleMs: 2400, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __qscroll(document.querySelector('#csv-result .csv-srows'), 330); },300); },300);`) },
    { name: '14-capture-where', settleMs: 2600, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ csvRowSheetOpen('scope'); setTimeout(function(){ __qscroll(document.querySelector('#csv-result .csv-srows'), 330); },200); },300); },300);`) },
    { name: '15-capture-card', settleMs: 2600, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ __qscroll(document.querySelector('#csv-result .csv-srows'), 150); },250); },300); },300);`) },
    { name: '16-capture-split', settleMs: 2800, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ csvRowSheetOpen('split'); },250); },300); },300);`) },
    { name: '17-capture-done', settleMs: 4200, setup: H + then(`__q(); setTimeout(function(){ var i=__card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ csvImportOne(csvReview.ready.findIndex(function(c){ return /nuong/i.test(c.description||''); })); },300); },300); },300);`) },
    { name: '18-capture-space', settleMs: 4600, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ csvImportOne(csvReview.ready.findIndex(function(c){ return /nuong/i.test(c.description||''); })).then(function(){ closeModals(); setTimeout(__money, 900); }); },300); },300); },300);`) },
    { name: '20-capture-settle', settleMs: 2600, setup: H + then(`__q(); setTimeout(function(){ var i=csvReview.ready.findIndex(function(c){ return !!c._spSettle; }); if(i>=0) csvToggleExpand('ready', i); setTimeout(function(){ __qscroll(document.querySelector('#csv-result .csv-srows'), 330); },300); },300);`) },

    /* more shares than members: the outside share stays in the payer's own book */
    { name: '21-outsider-split', settleMs: 3000, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ csvRowSheetOpen('split'); var vy=fhSpaceMembers(DB.fid).filter(function(m){ return m.name==='Vy'; })[0]; if(vy) fhSplitAct('tick', vy.id); fhSplitAct('parts','4'); },250); },300); },300);`) },
    { name: '22-outsider-card', settleMs: 3000, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ csvRowSheetOpen('split'); var vy=fhSpaceMembers(DB.fid).filter(function(m){ return m.name==='Vy'; })[0]; if(vy) fhSplitAct('tick', vy.id); fhSplitAct('parts','4'); csvRowSheetClose(); setTimeout(function(){ __qscroll(document.querySelector('#csv-result .csv-srows'), 150); },250); },250); },300); },300);`) },
    { name: '23-outsider-space', settleMs: 5000, setup: H + then(`__q(); setTimeout(function(){ __card(/nuong/i); setTimeout(function(){ __pickSpace(); setTimeout(function(){ csvRowSheetOpen('split'); var vy=fhSpaceMembers(DB.fid).filter(function(m){ return m.name==='Vy'; })[0]; if(vy) fhSplitAct('tick', vy.id); fhSplitAct('parts','4'); csvRowSheetClose(); csvImportOne(csvReview.ready.findIndex(function(c){ return /nuong/i.test(c.description||''); })).then(function(){ closeModals(); setTimeout(__money, 900); }); },250); },300); },300);`) }
  ]
};
