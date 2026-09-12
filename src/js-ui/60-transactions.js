/* ---------- expense ---------- */
var catStyle={};
/* ---------- transactions (with spender avatar) ---------- */
// Seed transactions — per-category sums ARE the category totals (aggregates derived below).
var txns=[];
// Derive the current month's category + member totals from the transactions so everything reconciles.
(function(){
  var cs={}, ms={}, total=0;
  catOrder.forEach(function(c){ cs[c]=0; });
  txns.forEach(function(t){
    if(t.month!==curMonthKey() || t.future) return;
    cs[t.cat]=(cs[t.cat]||0)+t.amt; total+=t.amt;
    var w=(t.who||'').toLowerCase(), mk=(w==='both'||w==='shared')?'Shared':(w.charAt(0).toUpperCase()+w.slice(1));
    ms[mk]=(ms[mk]||0)+t.amt;
  });
  months[curMonthKey()].catSpent=cs; months[curMonthKey()].spent=total; months[curMonthKey()].memberSpent=ms;
})();
var txSeq=0;
txns.forEach(function(t){ t.id='t'+(txSeq++); });
function txById(id){ for(var i=0;i<txns.length;i++){ if(txns[i].id===id) return txns[i]; } return null; }
// Newest first everywhere. Sorts on the real date (_d, set at hydrate / on edit); a
// freshly-added local item has no _d yet, so it floats to the top until the next
// hydrate stamps its date. Replaces the old txDay() which sorted by day-of-month only
// (so "Jun 30" wrongly beat "Jul 5").
function txNewestFirst(a,b){ var ta=a._d?a._d.getTime():Infinity, tb=b._d?b._d.getTime():Infinity; return tb-ta; }
txns.sort(txNewestFirst);
var spMap={emma:['av-emma','EM'],james:['av-james','JR'],mia:['av-mia','MR'],leo:['av-leo','LR'],both:['av-shared','👥'],shared:['av-shared','👥']};
function spAv(who){ var a=spMap[(who||'').toLowerCase()]||['av-shared','👥']; return '<div class="r-sp av '+a[0]+'">'+a[1]+'</div>'; }

/* ── Expense-list scope ──────────────────────────────────────────────────────
   The full-screen list (#txn-overlay: search · sort · category hero · month
   groups) is shared between the family Finance tab and the personal tab. The
   render functions read their data through the accessors below instead of the
   family globals directly, so `window.__txnScope==='personal'` swaps the source
   without duplicating the screen. Family (the default) reads live globals exactly
   as before — nothing changes on that path. */
window.__txnScope='family';
var _pTxnCtx=null;                     // built on open from fhPersonalData()
function _txnPersonal(){ return window.__txnScope==='personal'; }
function _txList(){ return _txnPersonal() ? (_pTxnCtx?_pTxnCtx.rows:[]) : (window.txns||[]); }
function _txCatOrder(){ return _txnPersonal() ? (_pTxnCtx?_pTxnCtx.catOrder:[]) : (window.catOrder||[]); }
/* Normalise the personal ledger into the row shape txRow/renderTxnScreen expect.
   Unreadable rows are skipped here (their amount is null and would misstate every
   total); they stay visible with their lock note on the personal tab itself.
   Since the full ledger (0109) the spine carries every kind and this list shows
   them all — a full ledger hides nothing. Expense categories keep feeding the
   hero (catOrder/catSpent stay expense-only: the hero is CHI theo danh mục);
   the other kinds group under pseudo-categories (kindOrder) that only join the
   filter chips. A transfer PAIR renders once — "VIB → VCB" is one event.
   Every row carries its own edit door (t._open): expense → edit sheet / mirror
   detail, income → fhIncomeRowSheet, pair → fhXferPairSheet, loan/repayment →
   fhDebtRowSheet, investment → fhInvRowSheet. */
function _pBuildTxnCtx(){
  var P = window.fhPersonalData ? fhPersonalData() : null;
  var PAL=['#f2eef6','#eef4fb','#eefaf3','#fdf4e8','#f6eefb','#eef9fb'];
  var rows=[], style={}, order=[], spent={}, other=L('Khác','Others');
  var now=new Date(), ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  /* the 2-month tab window + the on-demand months 3–6 (fhPersonalFetchOlder) */
  var txs=((P&&P.txns)||[]).concat((P&&P.txnsOld)||[]);
  var acctName=function(id){ var a=id&&(P&&P.accounts||[]).find(function(x){ return x.id===id; }); return a?(a.name||L('Tài khoản','Account')):null; };
  var K_INC=L('Thu nhập','Income'), K_XFER=L('Chuyển khoản','Transfers'), K_DEBT=L('Cho vay & nợ','Loans & debts'), K_INV=L('Đầu tư','Investments');
  var kstyle={}; kstyle[K_INC]=['💰','#eefaf3','var(--good)']; kstyle[K_XFER]=['🔁','#eef4fb','var(--cat-other)']; kstyle[K_DEBT]=['💵','#fdf4e8','var(--cat-other)']; kstyle[K_INV]=['📈','#f6eefb','var(--cat-other)'];
  var kindOrder=[], kseen={}, seenXfer={};
  txs.forEach(function(t){
    if(t._unreadable) return;
    var _d=t.date?new Date(t.date+'T00:00:00'):null;
    if(t.kind==='expense'){
      var cat=t.cat||other;
      if(!style[cat]){ style[cat]=[t.emoji||'🗂️', PAL[order.length%PAL.length], 'var(--cat-other)']; order.push(cat); }
      // Only PRIVATE rows are editable here; mirror rows (spaceId/linkId set) are a
      // family expense shown in the personal book — write-inert, but tappable
      // since 0114 (fhMirrorRowTap → the family expense detail, M10).
      var eOpen=(t.spaceId||t.linkId)?(t.spaceId?"fhMirrorRowTap('"+t.id+"')":''):"openPersonalTxEdit('"+t.id+"')";
      /* _kg/_net/_src/_acct feed the Giao dịch screen's filters + net heads:
         expense = money out (0109 stores it positive), so its cash flow is −amt. */
      rows.push({ id:t.id, cat:cat, note:t.note||cat, amt:t.amt||0, _d:_d, ico:t.emoji||'🗂️', who:null, _style:style[cat], _open:eOpen, photos:t.photos||undefined, time:t.time||null,
        _kg:'chi', _net:-(t.amt||0), _src:t.src||null, _acct:t.accountId||null, _mirror:!!(t.spaceId||t.linkId) });
      if((t.date||'').slice(0,7)===ym) spent[cat]=(spent[cat]||0)+(t.amt||0);   // hero = this month only (parity with family M())
      return;
    }
    var kcat, note, sign='', cls='xfer', open='', ico=null;
    /* cash-flow of a non-expense row (23-debts-ui:1114 sign law):
       loan negates its amount (lent > 0 = money out); everything else is
       already signed. A folded transfer PAIR nets 0 by construction. */
    var kg='ck', netv=(t.amt||0);
    if(t.kind==='income'){ kg='thu'; }
    else if(t.kind==='loan'){ kg='vay'; netv=-(t.amt||0); }
    else if(t.kind==='repayment'){ kg='vay'; }
    else if(t.kind==='investment'){ kg='dautu'; }
    if(t.kind==='income'){
      kcat=K_INC; note=t.note||t.cat||K_INC; sign='+'; cls='pos'; ico=t.emoji||'💰';
      open="fhIncomeRowSheet('"+t.id+"')";
    } else if(t.kind==='transfer'){
      kcat=K_XFER;
      if(t.transferGroupId){
        if(seenXfer[t.transferGroupId]) return;             // second leg of a pair already listed
        seenXfer[t.transferGroupId]=1;
        netv=0;                                             // the pair's two legs cancel
        var from=null,to=null;
        txs.forEach(function(x){ if(x.kind==='transfer'&&x.transferGroupId===t.transferGroupId){ if((x.amt||0)<0) from=x.accountId; else to=x.accountId; } });
        var fn=acctName(from), tn=acctName(to);
        note=(fn&&tn)?(fn+' → '+tn):(t.note||K_XFER);
        open="fhXferPairSheet('"+t.transferGroupId+"')";
      } else {
        // legacy one-leg transfer = a card payment tagged to the card (0105) — no pair sheet
        var cn=acctName(t.accountId);
        note=t.note||(cn?L('Trả nợ thẻ ','Card payment ')+cn:L('Chuyển khoản','Transfer'));
      }
    } else if(t.kind==='loan'||t.kind==='repayment'){
      kcat=K_DEBT; ico=(t.kind==='loan')?'💵':'✅';
      var dR=(P&&P.debts||[]).filter(function(d){ return d.id===t.id; })[0];
      var who=(dR&&dR.who)?(' · '+dR.who):'';
      note=(t.note||(t.kind==='loan'?((t.amt||0)>0?L('Cho vay','Lent'):L('Đi mượn','Borrowed')):L('Trả nợ','Repayment')))+who;
      open="fhDebtRowSheet('"+t.id+"')";
    } else if(t.kind==='investment'){
      kcat=K_INV;
      var pos=(P&&P.accounts||[]).find(function(a){ return a.id===t.positionId; });
      note=((t.amt||0)>0?L('Bán','Sell'):L('Mua','Buy'))+(pos&&pos.name?' '+pos.name:L(' đầu tư',' investment'));
      open="fhInvRowSheet('"+t.id+"')";
    } else return;
    if(!kseen[kcat]){ kseen[kcat]=1; kindOrder.push(kcat); }
    rows.push({ id:t.id, cat:kcat, note:note, amt:Math.abs(t.amt||0), _d:_d, ico:ico||kstyle[kcat][0], who:null, _style:kstyle[kcat], _open:open, _sign:sign, _amtCls:cls, time:t.time||null,
      _kg:kg, _net:netv, _src:t.src||null, _acct:t.accountId||null });
  });
  order.sort(function(a,b){ return (spent[b]||0)-(spent[a]||0); });
  /* account names for the Nguồn tiền filter section (personal only) */
  var acctDefs=((P&&P.accounts)||[]).map(function(a){ return { k:a.id, lbl:a.name||L('Tài khoản','Account') }; });
  _pTxnCtx={ rows:rows, catOrder:order, catStyle:style, catSpent:spent, catBudget:(P&&P.catBudget)||{}, kindOrder:kindOrder, acctDefs:acctDefs };
}
function txRow(t){
  // personal rows carry their own style + no member/reactions/detail screen;
  // family rows keep the avatar, reaction chip and tap-through to the detail.
  var personal=_txnPersonal();
  var s=t._style||catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'];
  // Localize the display date/payer; the stored t.date/t.who strings stay as-is
  // (they are parsed by _txnIso / mapped by _memberIdForWho — display only here).
  var dstr=(t.date==='Just now')?L('Vừa xong','Just now'):((t._d?sameDay(t._d,TODAY):(t.date==='Today'))?L('Hôm nay','Today'):(t._d?(sameDay(t._d,new Date(TODAY.getTime()-86400000))?L('Hôm qua','Yesterday'):fmtDayMon(t._d)):t.date));
  // data-rxid (only persisted rows) arms the long-press reaction picker; rxChip appends any reactions inline.
  // In select mode the long-press stands down — the row's job is selection.
  var selMode=!!window.__txnSelMode;
  var rxid=(!personal && t._dbId && !selMode)?(' data-rxid="'+escAttr(t._dbId)+'"'):'';
  var chip=(!personal && typeof rxChip==='function')?rxChip(t):'';
  // C1 anatomy: a row with photos shows its first photo AS the tile (the enc
  // observer decrypts .enc backgrounds in place); category text moves under the
  // bold amount, so the subline holds only the date.
  var ph=(t.photos&&t.photos.length)?t.photos[0]:t.photo;
  var tile=ph?'<div class="r-ico ph" style="background-image:url('+escAttr(ph)+')"></div>'
            :'<div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+esc(t.ico)+'</div>';
  var av=personal?'':spAv(t.who);                                 // personal ledger has no members
  // Family rows open the detail screen; personal rows carry their own door
  // (t._open, set per kind in _pBuildTxnCtx): edit sheet for private expenses,
  // mirror detail (0114, M10), income sheet, pair sheet, debt/investment sheets.
  var open=personal?(t._open?(' onclick="'+t._open+'"'):'')
                    :(' onclick="openExpenseDetail(\''+t.id+'\')"');
  var tapCls=(personal? (t._open?' tap':'') : ' tap');
  // Select mode: a tap toggles selection (never opens); ineligible rows say why.
  // Selected wears the tick; once anything is selected, misses fade — never hide.
  var selTick='', selCls='';
  if(selMode){
    var elig=window.__txnSelElig?window.__txnSelElig(t):false;
    var selOn=elig && window.__txnSel && window.__txnSel[t.id];
    selTick='<span class="sel-tick'+(elig?'':' no-sel')+'"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg></i></span>';
    selCls=(selOn?' is-sel':(window.__txnSelAny?' is-dim':''))+(elig?'':' no-sel');
    open=elig?(' onclick="txnSelToggle(\''+escAttr(String(t.id))+'\')"')
             :(' onclick="txnSelBlocked(\''+(t.future?'future':(t._mirror?'mirror':((t._kg&&t._kg!=='chi')?'kind':'na')))+'\')"');
    tapCls=' tap';
  }
  // _sign/_amtCls (personal, non-expense kinds): income wears +green; transfer,
  // debt and investment rows show the magnitude in the muted transfer style.
  var amtHtml='<div class="r-amt num'+(t._amtCls?' '+t._amtCls:'')+'">'+(t._sign||'')+fmt(t.amt)+'</div>';
  /* Subline date-mode (variant A, txn-listing revamp): the Giao dịch screen
     grouped by DAY sets 'time' (the sticky head already names the day — the
     row keeps only its clock time); grouped by week/month it sets 'date'
     (date + time, plain, same voice). Tab lists leave the mode unset = today's
     full behaviour. */
  var _dm=window.__txnDateMode||null;
  var subTxt=_dm==='time' ? (t.time?esc(t.time):dstr)
           : dstr+(t.time?' · '+esc(t.time):'');
  if(t.inst) subTxt+=' · '+esc(t.inst);            // 0131 money source, quiet, same voice
  return '<div class="row'+tapCls+selCls+(chip?' has-rx':'')+'"'+rxid+open+'>'+selTick+'<div class="r-ico-wrap">'+tile+av+'</div>'
    +'<div class="r-body"><div class="r-t">'+esc(t.note)+'</div><div class="r-s">'+subTxt+'</div></div>'
    +'<div class="r-right">'+amtHtml+'<div class="r-cat">'+esc(t.cat)+'</div></div>'+chip+'</div>';
}
var txFilter=null; // {type:'cat'|'mem', val:'Fun'|'Emma'}
function txMatch(t){
  if(!txFilter)return true;
  if(txFilter.type==='cat')return t.cat===txFilter.val;
  var w=(t.who||'').toLowerCase(), v=txFilter.val.toLowerCase();
  if(v==='shared'||v==='both')return w==='shared'||w==='both';
  return w===v;
}
/* ---- future rows: in-card, same anatomy as history (U6.1 / F8 / G1+G7) ----
   One timeline: future rows sit above today's inside the same card. The tense
   mark is the brand-colored amount; the due date sits under it where history
   rows show their category. The subline says who proposed the plan and where
   the review stands — the status word alone wears the state color (amber
   waiting, green settled). */
// Binary status, said with a wink: "sếp" is the reviewing family member —
// the vợ/chồng-là-sếp joke everyone already makes.
function _futSub(creatorId, pending){
  var st = pending ? '<span class="st-wait">'+L('chờ sếp duyệt','awaiting the boss')+'</span>'
                   : '<span class="st-ok">'+L('sếp duyệt rồi','boss said yes')+'</span>';
  var nm = (creatorId && typeof _reqName==='function') ? _reqName(creatorId) : '';
  return nm ? (esc(nm)+' '+L('đề xuất','proposed')+' · '+st) : st;
}
function _futDue(d){ return (d && sameDay(d,TODAY)) ? L('Hôm nay','Today') : (d ? fmtDayMon(d) : curMoName()); }
// Unrealized "set aside" row — money reserved from this month's budget toward an event.
function resRow(k){   // an event funded from this month → an "Events" future item
  var e=events[k];
  var ph=(e.memories&&e.memories.length&&e.memories[0].src)?e.memories[0].src:null;
  var tile=ph?'<div class="r-ico ph" style="background-image:url('+escAttr(ph)+')"></div>'
            :'<div class="r-ico res-ico">'+esc(e.emoji)+'</div>';
  var cid=(typeof _entCreatorId==='function')?_entCreatorId('occasion',e):null;
  var pend=false;
  if(cid && typeof _entNorm==='function' && typeof _entPending==='function'){ try{ pend=_entPending(_entNorm('occasion',e,k)); }catch(_x){} }
  return '<div class="row tap" onclick="openEvent(&#39;'+escAttr(k)+'&#39;)"><div class="r-ico-wrap">'+tile+'</div>'
    +'<div class="r-body"><div class="r-t">'+esc(e.name)+'</div><div class="r-s">'+_futSub(cid,pend)+'</div></div>'
    +'<div class="r-right"><div class="r-amt num plan">'+fmt(e.setAside)+'</div><div class="r-cat due">'+_futDue(e.d)+'</div></div></div>';
}
function futRow(t){   // a standalone future expense logged in the expense sheet
  var s=catStyle[t.cat]||['🧾','#f2eef6','var(--cat-other)'];
  var ph=(t.photos&&t.photos.length)?t.photos[0]:null;
  var tile=ph?'<div class="r-ico ph" style="background-image:url('+escAttr(ph)+')"></div>'
            :'<div class="r-ico" style="background:'+s[1]+';color:'+s[2]+'">'+esc(t.ico||'📅')+'</div>';
  var pend=(typeof futurePending==='function')&&futurePending(t);
  var cid=(typeof _entCreatorId==='function')?_entCreatorId('expense',t):null;
  // Every future row lands on the read-first expense detail, same as a past row;
  // the detail decides the CTA (Review for someone else's proposal, Update/Delete for mine).
  return '<div class="row tap" onclick="openExpenseDetail(\''+t.id+'\')"><div class="r-ico-wrap">'+tile+'</div>'
    +'<div class="r-body"><div class="r-t">'+esc(t.note)+'</div><div class="r-s">'+_futSub(cid,pend)+'</div></div>'
    +'<div class="r-right"><div class="r-amt num plan">'+fmt(t.amt)+'</div><div class="r-cat due">'+_futDue(txPhotoDate(t)||t._d)+'</div></div></div>';
}
function renderTxns(){
  var tx=document.getElementById('tx-rows');
  var evRes=(selMonth===curMonthKey()) ? order.filter(function(k){return !achievedNow(events[k]) && (events[k].setAside||0)>0;}) : [];
  var futT=txns.filter(function(t){return t.future;});
  var anyFuture = evRes.length>0 || futT.length>0;
  setTxt('tx-head', anyFuture ? L('Hoạt động','Activity') : L('Giao dịch gần đây','Recent transactions'));
  if(tx){
    var realAll=txns.filter(function(t){return !t.future;});
    var f=txFilter, out;
    if(f && f.type==='cat' && f.val==='Events') out=evRes.map(resRow).join('');      // Events future items
    else if(f && f.type==='cat' && f.val==='Future expenses') out=futT.map(futRow).join(''); // standalone future items
    else if(f) out=realAll.filter(txMatch).map(txRow).join('');                      // realized, filtered
    else{
      // One timeline in one card: future rows first (farthest due date at the
      // top, nearest just above today), then today's + yesterday's history —
      // the full history is the Giao dịch drill-in (openTxns / "See all").
      var futRows=[];
      evRes.forEach(function(k){ futRows.push({d:events[k].d, h:resRow(k)}); });
      futT.forEach(function(t){ futRows.push({d:txPhotoDate(t)||t._d, h:futRow(t)}); });
      futRows.sort(function(a,b){ return (b.d?b.d.getTime():0)-(a.d?a.d.getTime():0); });
      // A fresh local row has no _d yet ("Just now"), so it counts as today.
      var yd=new Date(TODAY.getTime()-86400000);
      out=futRows.map(function(r){return r.h;}).join('')
        +realAll.filter(function(t){ return !t._d || sameDay(t._d,TODAY) || sameDay(t._d,yd); }).map(txRow).join('');
    }
    // Three empty shapes: a filter that matched nothing → a plain note; a ledger
    // with history but nothing today/yesterday → a quiet pointer to See all; a
    // brand-new family with no ledger at all → a first-run prompt inviting the
    // first expense (mirrors the "Tạo mục tiêu đầu tiên" goal empty-state).
    var emptyHTML=txFilter
      ? '<div class="empty-note">'+L('Không có giao dịch phù hợp.','No transactions match this filter.')+'</div>'
      : (realAll.length
        ? '<div class="empty-note">'+L('Chưa có khoản chi nào hôm nay hay hôm qua. Bấm Xem tất cả để coi lại lịch sử.','Nothing logged today or yesterday. Tap See all for the full history.')+'</div>'
        : '<div class="mem-empty" style="margin:0 16px"><div class="me-emoji">🧾</div><div class="me-t">'+L('Ghi khoản chi đầu tiên','Log your first expense')+'</div><p>'+L('Thêm một khoản chi để cả nhà cùng nắm được tiền đang đi đâu.','Add an expense so the family can see where the money goes.')+'</p><button class="empty-cta" style="margin-top:18px" onclick="openExpense()">＋ '+L('Thêm khoản chi','Add expense')+'</button></div>');
    setHTMLIf(tx, out||emptyHTML);
  }
  var af=document.getElementById('act-filter');
  if(af){
    af.innerHTML=txFilter?('<div class="filter-chip">'+esc(txFilter.val)+'<button onclick="clearFilter()" aria-label="'+L('Xoá','Clear')+'">&times;</button></div>'):'';
  }
  var htx=document.getElementById('home-tx'); if(htx)setHTMLIf(htx, txns.filter(function(t){return !t.future;}).slice(0,3).map(txRow).join(''));
  if(typeof renderRxWall==='function') renderRxWall();   // keep the Phòng khách feed in sync with the ledger
}
function drillTo(type,val){ txFilter={type:type,val:val}; go('spending'); renderTxns(); segTo('activity'); }
function clearFilter(){ txFilter=null; renderTxns(); }
/* ---------- full transactions screen (txn-listing revamp) ----------
   Header direction 04: every axis is a dropdown chip (Sắp xếp · Loại · Nguồn ·
   Danh mục) opening its own mini sheet. The list groups by Ngày/Tuần/Tháng
   with SIGNED-NET sticky heads over exactly the displayed rows (Q4/Q10/Q15);
   the stat card above reuses the cash-flow card's vocabulary with its own
   chart zoom (independent of the list grouping). Grouping/sort/zoom persist
   per scope; filters reset each open. */
var txnSort='date';                                 // 'date' | 'amount' — order INSIDE a group
var TXV={ grp:'day', cgrp:'day', pin:null, kinds:null, srcs:null, accts:null, cats:null, _jump:null, _stReset:false };
function _txScopeKey(){ return _txnPersonal()?'personal':'family'; }
function _txSavePrefs(){
  try{ localStorage.setItem('fh-txnview:'+_txScopeKey(), JSON.stringify({grp:TXV.grp,cgrp:TXV.cgrp,sort:txnSort})); }catch(_e){}
}
function _txInitFilters(){
  TXV.kinds={chi:1,thu:1,ck:1,vay:1,dautu:1};
  TXV.srcs={tay:1,email:1,csv:1,nha:1};
  TXV.accts={_none:1};
  if(_txnPersonal() && _pTxnCtx) (_pTxnCtx.acctDefs||[]).forEach(function(a){ TXV.accts[a.k]=1; });
  /* family money-source filter (0131): buckets are the instrument strings the
     ledger actually holds, plus "chưa gắn" for everything hand-entered */
  TXV.insts={_none:1};
  if(!_txnPersonal()) (_txList()||[]).forEach(function(t){ if(t.inst) TXV.insts[t.inst]=1; });
  TXV.cats={}; (_txCatOrder()||[]).forEach(function(c){ TXV.cats[c]=1; });
  TXV.pin=null; TXV._stReset=true;
}
function openTxns(scope){
  window.__txnScope=(scope==='personal')?'personal':'family';
  if(_txnPersonal()) _pBuildTxnCtx();                             // snapshot the personal ledger into row shape
  // Title + back-label track the scope (personal vs the family Finance tab).
  var titleEl=document.querySelector('#txn-overlay .txn-title'); if(titleEl) titleEl.textContent=_txnPersonal()?L('Giao dịch cá nhân','Your transactions'):L('Giao dịch','Transactions');
  var backEl=document.querySelector('#txn-overlay .cd-back span'); if(backEl) backEl.textContent=_txnPersonal()?L('Cá nhân','Personal'):L('Gia đình','Family');
  var saved={}; try{ saved=JSON.parse(localStorage.getItem('fh-txnview:'+_txScopeKey())||'{}'); }catch(_e){}
  TXV.grp=(saved.grp==='week'||saved.grp==='month')?saved.grp:'day';
  TXV.cgrp=(saved.cgrp==='week'||saved.cgrp==='month')?saved.cgrp:(saved.cgrp==='day'?'day':TXV.grp);
  txnSort=(saved.sort==='amount')?'amount':'date';
  _txInitFilters();
  TXV.selMode=false; TXV.sel={};
  var selBtn=document.getElementById('txn-select'); if(selBtn) selBtn.textContent=L('Chọn','Select');
  var q=document.getElementById('txn-q'); if(q)q.value='';
  var _cl=document.getElementById('txn-clear'); if(_cl)_cl.style.display='none';
  renderTxnScreen();
  if(typeof renderFinanceHero==='function') renderFinanceHero();   // month's category breakdown at the top
  document.getElementById('txn-overlay').classList.add('on');
  var sc=document.getElementById('txn-scroll'); if(sc)sc.scrollTop=0;
  _txKickOlder();                                 // personal scope: months 3–6, once per session
}
/* Personal scope: pull months 3–6 in the background; the list tail narrates
   (loading → the 6-month note; an error offers retry). Family scope holds the
   full history client-side already and never enters here. */
function _txKickOlder(){
  if(!_txnPersonal() || !window.fhPersonalFetchOlder) return;
  var st=(window.fhPersonalOlder||{}).state;
  if(st==='loading'||st==='done') return;
  window.fhPersonalFetchOlder().then(function(){
    if(!_txnPersonal()) return;                   // closed / flipped scope while fetching
    _pBuildTxnCtx();
    renderTxnScreen();
  });
  renderTxnScreen();                              // repaint so the tail shows "Đang mở thêm…"
}
function txnRetryOlder(){
  if(window.fhPersonalOlder) window.fhPersonalOlder.state='idle';
  _txKickOlder();
}
// Reset scope on close: txRow is shared with the family activity list, so it must
// never be left in personal mode once the overlay is gone.
function closeTxns(){
  document.getElementById('txn-overlay').classList.remove('on');
  TXV.selMode=false; TXV.sel={};
  var bar=document.getElementById('txn-bulkbar'); if(bar) bar.classList.remove('on');
  window.__txnScope='family'; _pTxnCtx=null;
}
/* Re-pull the personal ledger into the open overlay after an edit/delete made
   from a row here. No-op unless the overlay is on AND in personal scope.
   Filter maps re-key against the fresh ctx but KEEP the user's on/off choices
   for keys that survived — an edit must not silently un-filter the screen. */
function refreshPersonalTxnOverlay(){
  var o=document.getElementById('txn-overlay');
  if(!o || !o.classList.contains('on') || !_txnPersonal()) return;
  _pBuildTxnCtx();
  var oldCats=TXV.cats||{}, oldAccts=TXV.accts||{};
  TXV.cats={}; (_txCatOrder()||[]).forEach(function(c){ TXV.cats[c]=(oldCats[c]===0)?0:1; });
  TXV.accts={_none:(oldAccts._none===0)?0:1};
  (_pTxnCtx.acctDefs||[]).forEach(function(a){ TXV.accts[a.k]=(oldAccts[a.k]===0)?0:1; });
  renderTxnScreen(); if(typeof renderFinanceHero==='function') renderFinanceHero();
}
function onTxnQ(){ var v=(document.getElementById('txn-q').value||''); var c=document.getElementById('txn-clear'); if(c)c.style.display=v?'grid':'none'; renderTxnScreen(); }
function txnClear(){ var q=document.getElementById('txn-q'); if(q){ q.value=''; q.focus(); } var c=document.getElementById('txn-clear'); if(c)c.style.display='none'; renderTxnScreen(); }

/* ── grouping keys, labels, cash-flow ─────────────────────────────────────── */
/* Keys are built from LOCAL date parts — never toISOString (UTC shifts a
   pre-7am row to yesterday in UTC+7; the personal tab paid for this once). */
function _txPad(n){ return String(n).padStart(2,'0'); }
function _txDayKeyD(d){ return d.getFullYear()+'-'+_txPad(d.getMonth()+1)+'-'+_txPad(d.getDate()); }
function _txWeekKeyD(d){ var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return _txDayKeyD(x); }
function _txMonKeyD(d){ return d.getFullYear()+'-'+_txPad(d.getMonth()+1); }
function _txGKey(t,g){ var d=t._d||TODAY; return g==='week'?_txWeekKeyD(d):g==='month'?_txMonKeyD(d):_txDayKeyD(d); }
function _txDdMm(d){ return _txPad(d.getDate())+'/'+_txPad(d.getMonth()+1); }
function _txKeyDate(k){ return new Date(+k.slice(0,4), +k.slice(5,7)-1, +(k.slice(8,10)||1)); }
function _txWdShort(d){ var i=d.getDay(); return isVi()?(i===0?'CN':'Th '+(i+1)):['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]; }
function _txGLabel(k,g){
  if(g==='month'){
    var y=+k.slice(0,4), m=+k.slice(5,7);
    return (isVi()?('Tháng '+m):moAbbr(m-1))+(y!==TODAY.getFullYear()?' '+y:'');
  }
  var d=_txKeyDate(k);
  if(g==='week'){
    if(k===_txWeekKeyD(TODAY)) return L('Tuần này','This week');
    var prev=new Date(TODAY.getTime()-7*86400000);
    if(k===_txWeekKeyD(prev)) return L('Tuần trước','Last week');
    var e=new Date(d.getFullYear(),d.getMonth(),d.getDate()+6);
    return _txDdMm(d)+' – '+_txDdMm(e);
  }
  if(sameDay(d,TODAY)) return L('Hôm nay','Today');
  if(sameDay(d,new Date(TODAY.getTime()-86400000))) return L('Hôm qua','Yesterday');
  return _txWdShort(d)+', '+_txDdMm(d);
}
/* Signed cash flow of a row. Personal ctx rows carry _net (0109/0122/0123 sign
   laws applied at build); a family row is an expense = money out. A future row
   is a plan, not money that moved — it renders but never counts (Q10). */
function _txNet(t){ if(t.future) return 0; return (t._net!==undefined)?t._net:-(t.amt||0); }
function _txNetHTML(n){
  if(n>0) return '<span class="num pos">+'+fmt(n)+'</span>';
  if(n<0) return '<span class="num">−'+fmt(-n)+'</span>';
  return '<span class="num">'+fmt(0)+'</span>';
}
function _txSrcKey(t){
  if(t._mirror) return 'nha';                       // a family expense mirrored in — its own bucket
  var s=t._src||t.src||null;
  return s==='csv-import'?'csv':(s?'email':'tay');
}
function _txCatActive(){ var m=TXV.cats||{}; return (_txCatOrder()||[]).some(function(c){ return !m[c]; }); }
function _txFiltersActive(){
  var n=0, chk=function(g){ if(!g) return; Object.keys(g).forEach(function(k){ if(!g[k]) n++; }); };
  if(_txnPersonal()){ chk(TXV.kinds); chk(TXV.accts); } else chk(TXV.insts);
  chk(TXV.srcs); chk(TXV.cats);
  return n>0;
}

function renderTxnScreen(){
  var q=(document.getElementById('txn-q').value||'').trim().toLowerCase();
  var personal=_txnPersonal(), catNarrow=_txCatActive();
  var list=(_txList()||[]).filter(function(t){
    if(q){ var hay=((t.note||'')+' '+(t.cat||'')+' '+(t.who||'')).toLowerCase(); if(hay.indexOf(q)<0) return false; }
    var kg=t._kg||'chi';
    if(personal && TXV.kinds && !TXV.kinds[kg]) return false;
    if(TXV.srcs && !TXV.srcs[_txSrcKey(t)]) return false;
    if(personal && TXV.accts && !TXV.accts[t._acct||'_none']) return false;
    if(!personal && TXV.insts && !TXV.insts[t.inst||'_none']) return false;
    /* Danh mục narrowed ⇒ an expense view: other kinds step aside */
    if(catNarrow){ if(kg!=='chi') return false; if(!TXV.cats[t.cat]) return false; }
    return true;
  });
  var ts=document.getElementById('txn-sum'); if(ts) ts.style.display='none';
  TXV._list=list;
  var groups={}, order=[];
  list.forEach(function(t){ var k=_txGKey(t,TXV.grp); if(!groups[k]){ groups[k]=[]; order.push(k); } groups[k].push(t); });
  order.sort().reverse();
  var html='';
  window.__txnDateMode=(TXV.grp==='day')?'time':'date';
  window.__txnSelMode=!!TXV.selMode;
  window.__txnSel=TXV.sel||{};
  window.__txnSelAny=!!Object.keys(TXV.sel||{}).length;
  window.__txnSelElig=_txSelElig;
  order.forEach(function(k){
    var g=groups[k], net=0;
    g.forEach(function(t){ net+=_txNet(t); });
    g.sort(txnSort==='amount'
      ? function(a,b){ return Math.abs(b.amt||0)-Math.abs(a.amt||0); }
      : txNewestFirst);
    html+='<div class="txn-mhead" id="txnh-'+k+'"><span>'+_txGLabel(k,TXV.grp)+'</span>'+_txNetHTML(net)+'</div>'
      +'<div class="rows">'+g.map(txRow).join('')+'</div>';
  });
  window.__txnDateMode=null;
  window.__txnSelMode=false;                       // txRow is shared with the tab lists — never leak the mode
  if(!list.length) html='<div class="mem-empty" style="margin:22px 16px"><div class="me-emoji">🔍</div><div class="me-t">'+L('Không tìm thấy','No results')+'</div><p>'+L('Thử từ khoá khác hoặc nới bộ lọc.','Try another keyword or loosen the filters.')+'</p></div>';
  /* tail (personal): older-history state — loading spinner, the 6-month note,
     or a retry line. Family holds full history and shows nothing here. */
  if(personal){
    var ost=(window.fhPersonalOlder||{}).state;
    if(ost==='loading') html+='<div class="txn-tail"><span class="txn-tail-spin"></span>'+L('Đang mở thêm lịch sử…','Opening older history…')+'</div>';
    else if(ost==='done') html+='<div class="txn-tailnote">'+L('Sổ chi tiết giữ 6 tháng gần nhất.','Details cover the last 6 months.')+'</div>';
    else if(ost==='error') html+='<button type="button" class="txn-tailnote link" onclick="txnRetryOlder()">'+L('Chưa tải được lịch sử cũ · Thử lại','Older history didn’t load · Try again')+'</button>';
  }
  setHTML('txn-list', html);
  renderTxnStats(list);
  if(TXV.selMode) buildTxnCondChips(); else buildTxnToolChips();
  renderTxnBulkbar();
}
/* which rows a selection can hold (Q14): personal = every private row — a
   pair selects as ONE and deletes as a pair; only mirror rows refuse (machine-
   owned). Verbs are subset-honest: Danh mục touches only the chi in the
   selection, Nguồn tiền chi + thu, Xoá everything. Family = realized,
   persisted expenses (a future row is a proposal with its own review flow). */
function _txSelElig(t){
  if(_txnPersonal()) return !t._mirror;
  return !t.future && !!t._dbId;
}
/* the selection, resolved to raw personal rows (2-month window + old cache) */
function _txSelRaw(ids){
  var P=(typeof fhPersonalData==='function')?fhPersonalData():null;
  var all=P?((P.txns||[]).concat(P.txnsOld||[])):[];
  return ids.map(function(id){ return all.find(function(x){ return String(x.id)===id; }); }).filter(Boolean);
}
/* ── stat card: Vào · Ra · Ròng of the displayed rows + the .pst bar strip
   with its OWN zoom (TXV.cgrp) — list by day, chart by month is fine. Bars
   are money-out (the app's chart law: bars are spending; income lives in the
   tiles). Tapping a bar pins its value and jumps the list to that bucket's
   newest group head via a chart-bucket → list-group jump map. ── */
function _txStripLbl(k){
  if(TXV.cgrp==='month') return isVi()?('Th '+(+k.slice(5,7))):moAbbr(+k.slice(5,7)-1);
  return (+k.slice(8,10))+'/'+(+k.slice(5,7));
}
function _txStripOn(k){
  return TXV.cgrp==='day' ? k===_txDayKeyD(TODAY)
       : TXV.cgrp==='week' ? k===_txWeekKeyD(TODAY)
       : k===_txMonKeyD(TODAY);
}
function renderTxnStats(list){
  var box=document.getElementById('txn-stats'); if(!box) return;
  var sp0=box.querySelector('.pst'), keep=(TXV._stReset||!sp0)?null:sp0.scrollLeft;
  TXV._stReset=false;
  box.style.display='';
  var vao=0, ra=0, n=0;
  list.forEach(function(t){ if(t.future) return; n++; var v=_txNet(t); if(v>0) vao+=v; else ra+=-v; });
  var net=vao-ra;
  var outs={}, keys=[], jump={};
  list.forEach(function(t){
    if(t.future) return;
    var k=_txGKey(t,TXV.cgrp);
    if(outs[k]===undefined){ outs[k]=0; keys.push(k); }
    var v=_txNet(t); if(v<0) outs[k]+=-v;
    var d=t._d?t._d.getTime():0;
    if(!jump[k]||d>jump[k].d) jump[k]={ d:d, head:_txGKey(t,TXV.grp) };
  });
  keys.sort();
  var maxOut=0; keys.forEach(function(k){ if(outs[k]>maxOut) maxOut=outs[k]; });
  TXV._jump=jump;
  var cols=keys.map(function(k){
    var h=maxOut?Math.max(outs[k]?5:0, Math.round(outs[k]/maxOut*100)):0;
    var pin=(TXV.pin===k)?'<span class="pst-pin" style="top:-20px">'+L('Ra ','Out ')+fmtK(outs[k])+'</span>':'';
    return '<button type="button" class="pst-c" onclick="txnBarTap(&#39;'+k+'&#39;)" aria-label="'+escAttr(_txStripLbl(k))+'">'
      +'<span class="pst-bars">'+pin+'<i class="pst-b" style="height:'+h+'%"></i></span>'
      +'<span class="pst-l'+(_txStripOn(k)?' on':'')+(TXV.pin===k?' sel':'')+'">'+_txStripLbl(k)+'</span></button>';
  }).join('');
  function pz(g,lbl){ return '<button type="button" class="'+(TXV.cgrp===g?'on':'')+'" onclick="txnPz(&#39;'+g+'&#39;)">'+lbl+'</button>'; }
  var filtered=_txFiltersActive();
  box.innerHTML='<div class="st-head">'
    +'<span class="st-eyebrow'+(filtered?' live':'')+'">'+(filtered?L('Bộ lọc đang bật','Filters on'):L('Đang hiện','Showing'))+' · '+n+' '+L('khoản', n===1?'item':'items')+'</span>'
    +'<span class="pz">'+pz('day',L('Ngày','Day'))+pz('week',L('Tuần','Week'))+pz('month',L('Tháng','Month'))+'</span></div>'
    +'<div class="st-tiles">'
    +'<div class="st-tile"><div class="cf-tl">'+L('Vào','In')+'</div><div class="cf-tv pos num">+'+fmtK(vao)+'</div></div>'
    +'<div class="st-tile"><div class="cf-tl">'+L('Ra','Out')+'</div><div class="cf-tv num">'+fmtK(ra)+'</div></div>'
    +'<div class="st-tile"><div class="cf-tl">'+L('Ròng','Net')+'</div><div class="cf-tv num'+(net>0?' pos':'')+'">'+(net>0?'+':(net<0?'−':''))+fmtK(Math.abs(net))+'</div></div>'
    +'</div>'
    +'<div class="pst">'+cols+'</div>';
  var sp=box.querySelector('.pst'); if(sp) sp.scrollLeft=(keep!=null)?keep:sp.scrollWidth;
}
function txnPz(g){ if(TXV.cgrp===g) return; TXV.cgrp=g; TXV.pin=null; TXV._stReset=true; _txSavePrefs(); renderTxnScreen(); }
function txnBarTap(k){
  TXV.pin=(TXV.pin===k)?null:k;
  renderTxnScreen();
  if(!TXV.pin) return;
  var j=(TXV._jump||{})[k]; if(!j) return;
  var head=document.getElementById('txnh-'+j.head), sc=document.getElementById('txn-scroll');
  if(head && sc) sc.scrollTo({ top:Math.max(0, head.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop), behavior:'smooth' });
}

/* ── dropdown chips + their mini sheets (header direction 04) ─────────────── */
function _txKindDefs(){ return [
  {k:'chi',  lbl:L('Chi tiêu','Spending')},
  {k:'thu',  lbl:L('Thu nhập','Income')},
  {k:'ck',   lbl:L('Chuyển khoản & thẻ','Transfers & cards')},
  {k:'vay',  lbl:L('Vay nợ','Loans')},
  {k:'dautu',lbl:L('Đầu tư','Investments')} ]; }
function _txSrcDefs(){
  var d=[
    {k:'tay',  lbl:L('Ghi tay','By hand')},
    {k:'email',lbl:L('Từ email','From email')},
    {k:'csv',  lbl:L('Từ tệp','From a file')} ];
  if(_txnPersonal()) d.push({k:'nha', lbl:L('Từ sổ gia đình','From the family book')});
  return d;
}
function _txAcctDefs(){
  var out=((_pTxnCtx&&_pTxnCtx.acctDefs)||[]).slice();
  out.push({k:'_none',lbl:L('Tiền mặt / chưa gắn','Cash / untagged')});
  return out;
}
/* family money-source buckets (0131) — the distinct instrument strings held
   in the ledger; _none = hand-entered / pre-0131 rows */
function _txInstDefs(){
  var out=Object.keys(TXV.insts||{}).filter(function(k){ return k!=='_none'; })
    .sort().map(function(k){ return { k:k, lbl:k }; });
  out.push({k:'_none',lbl:L('Chưa gắn','Untagged')});
  return out;
}
/* Chip label: at its default the chip is a plain noun; off-default it tints
   and states the ON selection — one name, else a count. */
function _txChipLbl(base, map, defs){
  if(!map) return {t:base, live:false};
  var on=defs.filter(function(o){ return map[o.k]; });
  if(!on.length || on.length===defs.length) return {t:base, live:false};
  if(on.length===1) return {t:base+' · '+on[0].lbl, live:true};
  return {t:base+' · '+on.length, live:true};
}
function buildTxnToolChips(){
  var personal=_txnPersonal();
  function chip(lab,live,fn){
    return '<button type="button" class="txn-chip tool'+(live?' live':'')+'" onclick="'+fn+'"><span>'+lab+'</span>'
      +'<svg class="dch" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>';
  }
  var grpLab={day:L('Theo ngày','By day'),week:L('Theo tuần','By week'),month:L('Theo tháng','By month')}[TXV.grp];
  if(txnSort==='amount') grpLab+=' · '+L('tiền lớn','largest');
  var html=chip(grpLab,false,'txnSheetSort()');
  if(personal){
    var kl=_txChipLbl(L('Loại','Kinds'), TXV.kinds, _txKindDefs());
    html+=chip(kl.t, kl.live, 'txnSheetKind()');
  }
  var srcDefs=_txSrcDefs().slice(), srcMap={};
  srcDefs.forEach(function(o){ srcMap[o.k]=TXV.srcs?TXV.srcs[o.k]:1; });
  if(personal) _txAcctDefs().forEach(function(o){ srcDefs.push(o); srcMap[o.k]=TXV.accts?TXV.accts[o.k]:1; });
  else _txInstDefs().forEach(function(o){ srcDefs.push(o); srcMap[o.k]=TXV.insts?TXV.insts[o.k]:1; });
  var sl=_txChipLbl(L('Nguồn','Source'), srcMap, srcDefs);
  html+=chip(sl.t, sl.live, 'txnSheetSrc()');
  var catDefs=(_txCatOrder()||[]).map(function(c){ return {k:c,lbl:c}; });
  var cl=_txChipLbl(L('Danh mục','Categories'), TXV.cats, catDefs);
  html+=chip(cl.t, cl.live, 'txnSheetCat()');
  setHTML('txn-chips', html);
}
/* One toggle for every filter chip in a sheet; the last ON option refuses to
   turn off (a view of nothing answers nothing). */
function txnFiltTap(group,k){
  var g=TXV[group]; if(!g) return;
  g[k]=g[k]?0:1;
  if(!Object.keys(g).some(function(x){ return g[x]; })) g[k]=1;
  TXV.pin=null;
  renderTxnScreen();
  if(group==='kinds') txnSheetKind();
  else if(group==='cats') txnSheetCat();
  else txnSheetSrc();
}
function txnSheetSort(){
  var b=document.getElementById('txnsort-body'); if(!b) return;
  function seg(on,fn,lbl){ return '<button type="button" class="atx-seg'+(on?' on':'')+'" onclick="'+fn+'">'+lbl+'</button>'; }
  b.innerHTML='<span class="crs-lbl">'+L('Nhóm theo','Group by')+'</span><div class="atx-segs">'
    +seg(TXV.grp==='day',"txnSetGrp('day')",L('Ngày','Day'))
    +seg(TXV.grp==='week',"txnSetGrp('week')",L('Tuần','Week'))
    +seg(TXV.grp==='month',"txnSetGrp('month')",L('Tháng','Month'))+'</div>'
    +'<span class="crs-lbl" style="margin-top:16px">'+L('Xếp trong nhóm','Order inside a group')+'</span><div class="atx-segs">'
    +seg(txnSort==='date',"txnSetSort('date')",L('Mới nhất','Newest'))
    +seg(txnSort==='amount',"txnSetSort('amount')",L('Số tiền lớn','Largest first'))+'</div>';
  openSheet('sheet-txnsort');
}
function txnSetGrp(g){ TXV.grp=g; TXV.pin=null; _txSavePrefs(); renderTxnScreen(); txnSheetSort(); }
function txnSetSort(s){ txnSort=s; _txSavePrefs(); renderTxnScreen(); txnSheetSort(); }
function txnSheetKind(){
  var el=document.getElementById('txnkind-list'); if(!el) return;
  el.innerHTML=_txKindDefs().map(function(o){
    return '<button type="button" class="choice'+(TXV.kinds[o.k]?' on':'')+'" onclick="txnFiltTap(&#39;kinds&#39;,&#39;'+o.k+'&#39;)">'+o.lbl+'</button>';
  }).join('');
  openSheet('sheet-txnkind');
}
function txnSheetSrc(){
  var b=document.getElementById('txnsrc-body'); if(!b) return;
  var h='<span class="crs-lbl">'+L('Nguồn ghi','Recorded via')+'</span><div class="choices">'
    +_txSrcDefs().map(function(o){
      return '<button type="button" class="choice'+(TXV.srcs[o.k]?' on':'')+'" onclick="txnFiltTap(&#39;srcs&#39;,&#39;'+o.k+'&#39;)">'+o.lbl+'</button>';
    }).join('')+'</div>';
  if(_txnPersonal()){
    h+='<span class="crs-lbl" style="margin-top:16px">'+L('Nguồn tiền','Money source')+'</span><div class="choices">'
      +_txAcctDefs().map(function(o){
        return '<button type="button" class="choice'+(TXV.accts[o.k]?' on':'')+'" onclick="txnFiltTap(&#39;accts&#39;,&#39;'+escAttr(o.k)+'&#39;)">'+esc(o.lbl)+'</button>';
      }).join('')+'</div>';
  } else if(_txInstDefs().length>1){
    h+='<span class="crs-lbl" style="margin-top:16px">'+L('Nguồn tiền · từ email trở đi','Money source · from email onward')+'</span><div class="choices">'
      +_txInstDefs().map(function(o){
        return '<button type="button" class="choice'+(TXV.insts[o.k]?' on':'')+'" onclick="txnFiltTap(&#39;insts&#39;,&#39;'+escAttr(o.k)+'&#39;)">'+esc(o.lbl)+'</button>';
      }).join('')+'</div>';
  }
  b.innerHTML=h;
  openSheet('sheet-txnsrc');
}
/* Hero legend drill (20-budget.js fh-lrow): narrow Danh mục to that one
   category — the chip reads "Danh mục · X". Tapping the same category again
   widens back to all, so the hero row is its own way home. */
function setTxnCat(c){
  if(!TXV.cats) return;
  var all=_txCatOrder()||[];
  var only=all.length && all.every(function(x){ return x===c ? TXV.cats[x]===1 : TXV.cats[x]===0; });
  all.forEach(function(x){ TXV.cats[x]=(c==null||only||x===c)?1:0; });
  TXV.pin=null;
  renderTxnScreen();
}
function txnSheetCat(){
  var el=document.getElementById('txncat-list'); if(!el) return;
  var style=_txnPersonal()?((_pTxnCtx&&_pTxnCtx.catStyle)||{}):catStyle;
  el.innerHTML=(_txCatOrder()||[]).map(function(c){
    var em=(style[c]||['🏷️'])[0];
    return '<button type="button" class="choice'+(TXV.cats[c]?' on':'')+'" onclick="txnFiltTap(&#39;cats&#39;,&#39;'+escAttr(c)+'&#39;)">'+em+' '+esc(c)+'</button>';
  }).join('');
  openSheet('sheet-txncat');
}

/* ── select mode (Chọn) — select-by-attribute like the review queue ────────
   "Chọn" swaps the chips row to condition chips with counts; a condition tap
   selects its whole cluster, ticks correct one row at a time, misses fade.
   The bulk bar carries count + verbs; every write rides the same paths a
   single edit uses (fhTxnBulkPatch / fhPersonal* with quiet batching). ── */
function txnSelMode(){
  TXV.selMode=!TXV.selMode;
  if(!TXV.selMode){ TXV.sel={}; _txBulkDisarm(); }
  var b=document.getElementById('txn-select');
  if(b) b.textContent=TXV.selMode?L('Xong','Done'):L('Chọn','Select');
  renderTxnScreen();
}
function txnSelExit(){ if(TXV.selMode) txnSelMode(); }
function txnSelToggle(id){
  if(TXV.sel[id]) delete TXV.sel[id]; else TXV.sel[id]=1;
  _txBulkDisarm();
  renderTxnScreen();
}
function txnSelBlocked(why){
  var msg= why==='mirror' ? L('Bản sao từ sổ gia đình · sửa bên sổ gốc','A copy from the family book · edit it there')
        : why==='future' ? L('Khoản đề xuất có luồng duyệt riêng','Proposals have their own review flow')
        : why==='kind'   ? L('Loại này có sheet riêng, chưa sửa hàng loạt được','This kind edits in its own sheet, not in bulk')
        : L('Khoản này không chọn được','This item can’t be selected');
  if(typeof toast==='function') toast(msg);
}
function _txCondDefs(){
  var rows=(TXV._list||[]).filter(_txSelElig);
  function ids(f){ return rows.filter(f).map(function(t){ return String(t.id); }); }
  var defs=[{lbl:L('Đang hiện','All shown'), ids:ids(function(){ return true; })}];
  /* top categories by row count */
  var cnt={};
  rows.forEach(function(t){ cnt[t.cat]=(cnt[t.cat]||0)+1; });
  Object.keys(cnt).sort(function(a,b){ return cnt[b]-cnt[a]; }).slice(0,4).forEach(function(c){
    defs.push({lbl:c, ids:ids(function(t){ return t.cat===c; })});
  });
  /* source buckets present */
  _txSrcDefs().forEach(function(o){
    var m=ids(function(t){ return _txSrcKey(t)===o.k; });
    if(m.length) defs.push({lbl:o.lbl, ids:m});
  });
  /* family: who paid */
  if(!_txnPersonal() && window.FAM && FAM.members){
    FAM.members.forEach(function(m){
      var w=ids(function(t){ return memMatch(t.who, m.name); });
      if(w.length) defs.push({lbl:m.name+' '+L('trả','paid'), ids:w});
    });
  }
  return defs.filter(function(d){ return d.ids.length; });
}
function buildTxnCondChips(){
  var defs=_txCondDefs(); TXV._conds=defs;
  setHTML('txn-chips', defs.map(function(d,i){
    var allOn=d.ids.length && d.ids.every(function(id){ return TXV.sel[id]; });
    return '<button type="button" class="txn-chip'+(allOn?' on':'')+'" onclick="txnCondTap('+i+')">'+esc(d.lbl)+' <span class="n num">'+d.ids.length+'</span></button>';
  }).join(''));
}
function txnCondTap(i){
  var d=(TXV._conds||[])[i]; if(!d) return;
  var allOn=d.ids.every(function(id){ return TXV.sel[id]; });
  d.ids.forEach(function(id){ if(allOn) delete TXV.sel[id]; else TXV.sel[id]=1; });
  _txBulkDisarm();
  renderTxnScreen();
}
function renderTxnBulkbar(){
  var bar=document.getElementById('txn-bulkbar'); if(!bar) return;
  var n=Object.keys(TXV.sel||{}).length;
  bar.classList.toggle('on', !!TXV.selMode && n>0);
  var cnt=document.getElementById('txn-bb-n'); if(cnt) cnt.textContent=n+' '+L('khoản', n===1?'item':'items');
  var verbs=document.getElementById('txn-bb-verbs');
  if(verbs){
    if(_txnPersonal()){
      /* a verb with nothing it can touch self-disables (Q14) */
      var raw=_txSelRaw(Object.keys(TXV.sel||{}));
      var hasChi=raw.some(function(r){ return r.kind==='expense'; });
      var hasAcct=raw.some(function(r){ return r.kind==='expense'||r.kind==='income'; });
      verbs.innerHTML='<button type="button" class="bb-v'+(hasChi?'':' dis')+'" onclick="txnBulkSheet(&#39;cat&#39;)">'+L('Danh mục','Category')+'</button>'
        +'<button type="button" class="bb-v'+(hasAcct?'':' dis')+'" onclick="txnBulkSheet(&#39;acct&#39;)">'+L('Nguồn tiền','Money source')+'</button>';
    } else {
      verbs.innerHTML='<button type="button" class="bb-v" onclick="txnBulkSheet(&#39;cat&#39;)">'+L('Danh mục','Category')+'</button>'
        +'<button type="button" class="bb-v" onclick="txnBulkSheet(&#39;who&#39;)">'+L('Ai trả','Who paid')+'</button>';
    }
  }
}
var _txDelTimer=null;
function _txBulkDisarm(){
  clearTimeout(_txDelTimer);
  var b=document.getElementById('txn-bb-del');
  if(b && b.classList.contains('armed')){ b.classList.remove('armed'); b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></svg>'; }
}
function txnBulkSheet(kind){
  var h=document.getElementById('txnbulk-h'), s=document.getElementById('txnbulk-sub'), list=document.getElementById('txnbulk-list');
  if(!h||!s||!list) return;
  var n=Object.keys(TXV.sel||{}).length;
  /* Subset honesty (Q14): a verb that touches only part of the selection says
     so BEFORE anything fires — right here in the sheet's subtitle. */
  function subsetSub(applies, what){
    if(applies>=n) return L('Áp cho '+n+' khoản đã chọn.','Applies to the '+n+' selected.');
    return L('Áp cho '+applies+'/'+n+' '+what+' đã chọn · các khoản khác giữ nguyên.',
             'Applies to '+applies+'/'+n+' selected '+what+' · the rest stay as they are.');
  }
  var raw=_txnPersonal()?_txSelRaw(Object.keys(TXV.sel||{})):null;
  if(kind==='cat'){
    h.textContent=L('Danh mục','Category');
    var nChi=raw?raw.filter(function(r){ return r.kind==='expense'; }).length:n;
    if(!nChi) return;                                   // verb was disabled; belt-and-braces
    s.textContent=subsetSub(nChi, L('khoản chi','expenses'));
    var style=_txnPersonal()?((_pTxnCtx&&_pTxnCtx.catStyle)||{}):catStyle;
    list.innerHTML=(_txCatOrder()||[]).map(function(c){
      var em=(style[c]||['🏷️'])[0];
      return '<button type="button" class="choice" onclick="txnBulkCatPick(&#39;'+escAttr(c)+'&#39;)">'+em+' '+esc(c)+'</button>';
    }).join('');
  } else if(kind==='who'){
    h.textContent=L('Ai trả','Who paid');
    s.textContent=L('Áp cho '+n+' khoản đã chọn.','Applies to the '+n+' selected.');
    var mems=(window.FAM&&FAM.members)||[];
    list.innerHTML=mems.map(function(m){
      return '<button type="button" class="choice" onclick="txnBulkWhoPick(&#39;'+escAttr(m.name)+'&#39;)">'+esc(m.name)+'</button>';
    }).join('')+'<button type="button" class="choice" onclick="txnBulkWhoPick(&#39;Both&#39;)">'+L('Chung','Both')+'</button>';
  } else {
    h.textContent=L('Nguồn tiền','Money source');
    var nAcct=raw?raw.filter(function(r){ return r.kind==='expense'||r.kind==='income'; }).length:n;
    if(!nAcct) return;
    s.textContent=subsetSub(nAcct, L('khoản thu chi','money rows'));
    var defs=((_pTxnCtx&&_pTxnCtx.acctDefs)||[]).slice();
    list.innerHTML=defs.map(function(a){
      return '<button type="button" class="choice" onclick="txnBulkAcctPick(&#39;'+escAttr(a.k)+'&#39;)">'+esc(a.lbl)+'</button>';
    }).join('')+'<button type="button" class="choice" onclick="txnBulkAcctPick(&#39;&#39;)">'+L('Tiền mặt / bỏ gắn','Cash / untag')+'</button>';
  }
  openSheet('sheet-txnbulk');
}
/* Family applies are optimistic (local math + fire-through, the house posture);
   personal applies are online-only: the bar goes busy, writes run quiet, one
   hydrate at the end, success reported only after it lands (DESIGN §4.2). */
function txnBulkCatPick(name){
  closeSheet();
  var ids=Object.keys(TXV.sel||{}); if(!ids.length) return;
  if(_txnPersonal()){ _txBulkPersonal(ids, { cat:name }); return; }
  var em=(catStyle[name]||['🧾'])[0], done=0;
  ids.forEach(function(id){
    var t=txById(id); if(!t||t.cat===name){ if(t) done++; return; }
    var m=months[t.month];
    if(m && !t.future){
      m.catSpent[t.cat]=(m.catSpent[t.cat]||0)-t.amt;
      m.catSpent[name]=(m.catSpent[name]||0)+t.amt;
    }
    t.cat=name; t.ico=em;
    var catId=(window.DB&&DB.catByName)?DB.catByName[name]:null;
    if(t._dbId && catId && window.fhTxnBulkPatch) fhTxnBulkPatch(t._dbId, { category_id:catId });
    done++;
  });
  if(window.fhTxnBulkDone) fhTxnBulkDone();
  txnSelExit(); renderAll(); renderTxns();
  toast(L('Đã đổi danh mục cho '+done+' khoản','Category changed on '+done+' items'));
}
function txnBulkWhoPick(who){
  closeSheet();
  var ids=Object.keys(TXV.sel||{}); if(!ids.length) return;
  var whoStore=(who==='Both')?'Shared':who, done=0;
  ids.forEach(function(id){
    var t=txById(id); if(!t||t.who===whoStore){ if(t) done++; return; }
    var m=months[t.month];
    if(m && !t.future){
      var oldMk=(t.who==='Shared'||t.who==='both')?'Shared':t.who;
      var newMk=(whoStore==='Shared')?'Shared':whoStore;
      m.memberSpent[oldMk]=(m.memberSpent[oldMk]||0)-t.amt;
      m.memberSpent[newMk]=(m.memberSpent[newMk]||0)+t.amt;
    }
    t.who=whoStore;
    if(t._dbId && window.fhTxnBulkPatch && typeof _memberIdForWho==='function')
      fhTxnBulkPatch(t._dbId, { member_id:_memberIdForWho(whoStore) });
    done++;
  });
  if(window.fhTxnBulkDone) fhTxnBulkDone();
  txnSelExit(); renderAll(); renderTxns();
  toast(L('Đã đổi người trả cho '+done+' khoản','Payer changed on '+done+' items'));
}
function txnBulkAcctPick(acctId){
  closeSheet();
  var ids=Object.keys(TXV.sel||{}); if(!ids.length) return;
  _txBulkPersonal(ids, { accountId:acctId||null });
}
async function _txBulkPersonal(ids, change){
  var bar=document.getElementById('txn-bulkbar'); if(bar) bar.classList.add('busy');
  var P=(typeof fhPersonalData==='function')?fhPersonalData():null;
  var all=P?((P.txns||[]).concat(P.txnsOld||[])):[];   // selection may reach the on-demand months 3–6
  var ok=0, fail=0, skipped=0;
  for(var i=0;i<ids.length;i++){
    var raw=all.find(function(x){ return String(x.id)===ids[i]; });
    if(!raw){ fail++; continue; }
    /* subset honesty (Q14): Danh mục touches chi only; Nguồn tiền chi + thu.
       Everything else in the selection is left exactly as it was — the picker
       sheet already said so before the tap. */
    var isChi=(raw.kind==='expense'), isThu=(raw.kind==='income');
    if(change.cat && !isChi){ skipped++; continue; }
    if(change.hasOwnProperty('accountId') && !isChi && !isThu){ skipped++; continue; }
    var r;
    if(isThu){
      var inf={ amt:raw.amt, note:raw.note, dateIso:raw.date };
      if(change.hasOwnProperty('accountId')) inf.accountId=change.accountId;
      r=await window.fhPersonalUpdateIncome(ids[i], inf, true);
      if(r && change.hasOwnProperty('accountId')) raw.accountId=change.accountId;
    } else {
      var fields={ amt:raw.amt, note:raw.note, cat:raw.cat, emoji:raw.emoji, time:raw.time, dateIso:raw.date };
      if(change.cat){
        fields.cat=change.cat;
        fields.emoji=((_pTxnCtx&&_pTxnCtx.catStyle&&_pTxnCtx.catStyle[change.cat])||(window.catStyle&&catStyle[change.cat])||['🏷️'])[0];
      }
      if(change.hasOwnProperty('accountId')) fields.accountId=change.accountId;
      r=await window.fhPersonalUpdateExpense(ids[i], fields, true);
      if(r){
        /* the hydrate below only refreshes the 2-month window — a row living in
           the older cache is patched in place so the list can't show stale values */
        raw.cat=fields.cat; raw.emoji=fields.emoji;
        if(fields.hasOwnProperty('accountId')) raw.accountId=fields.accountId;
      }
    }
    if(r) ok++; else fail++;
  }
  try{ await window.fhPersonalHydrate(); }catch(_e){}
  if(bar) bar.classList.remove('busy');
  txnSelExit();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(_e){} }
  refreshPersonalTxnOverlay();
  var tail=skipped?L(' · '+skipped+' khoản khác giữ nguyên',' · '+skipped+' left as they were'):'';
  toast(fail
    ? L('Đã lưu '+ok+' khoản · '+fail+' khoản lỗi, thử lại nhé','Saved '+ok+' · '+fail+' failed, try again')
    : L('Đã lưu '+ok+' khoản','Saved '+ok+' items')+tail);
}
function txnBulkDel(){
  var b=document.getElementById('txn-bb-del');
  var ids=Object.keys(TXV.sel||{}); if(!ids.length||!b) return;
  if(!b.classList.contains('armed')){
    b.classList.add('armed'); b.textContent=L('Xoá '+ids.length+'?','Delete '+ids.length+'?');
    clearTimeout(_txDelTimer);
    _txDelTimer=setTimeout(_txBulkDisarm, 3000);
    return;
  }
  _txBulkDisarm();
  if(_txnPersonal()){ _txBulkPersonalDel(ids); return; }
  var done=0;
  ids.forEach(function(id){
    var t=txById(id); if(!t) return;
    var m=months[t.month];
    if(m && !t.future && t.month===curMonthKey()){
      var mk=(t.who==='Shared'||t.who==='both')?'Shared':t.who;
      m.spent-=t.amt; m.catSpent[t.cat]=(m.catSpent[t.cat]||0)-t.amt; m.memberSpent[mk]=(m.memberSpent[mk]||0)-t.amt;
    }
    var mirrorId=(t.linkedEvent && window.events && events[t.linkedEvent])?events[t.linkedEvent]._dbId:null;
    if(t.photos&&t.photos.length){ t.photos=[]; if(typeof syncExpenseEvent==='function') syncExpenseEvent(t); }
    var i=txns.indexOf(t); if(i>=0) txns.splice(i,1);
    if(t._dbId && window.fhTxnBulkDelete) fhTxnBulkDelete(t._dbId, mirrorId);
    done++;
  });
  if(window.fhTxnBulkDone) fhTxnBulkDone();
  txnSelExit(); renderAll(); renderTxns(); if(typeof renderEvents==='function') renderEvents();
  toast(L('Đã xoá '+done+' khoản','Deleted '+done+' items'));
}
async function _txBulkPersonalDel(ids){
  var bar=document.getElementById('txn-bulkbar'); if(bar) bar.classList.add('busy');
  var P=(typeof fhPersonalData==='function')?fhPersonalData():null;
  var all=P?((P.txns||[]).concat(P.txnsOld||[])):[];
  var ok=0, fail=0;
  function dropOld(id){
    if(P&&P.txnsOld){ var j=P.txnsOld.findIndex(function(x){ return String(x.id)===id; }); if(j>=0) P.txnsOld.splice(j,1); }
  }
  for(var i=0;i<ids.length;i++){
    /* a transfer PAIR was selected as one row — delete BOTH legs, count as one
       (Q14: "pairs select as one and delete as a pair") */
    var raw=all.find(function(x){ return String(x.id)===ids[i]; });
    var legIds=[ids[i]];
    if(raw && raw.kind==='transfer' && raw.transferGroupId){
      all.forEach(function(x){
        if(x.kind==='transfer' && x.transferGroupId===raw.transferGroupId && String(x.id)!==ids[i]) legIds.push(String(x.id));
      });
    }
    var allOk=true;
    for(var g=0; g<legIds.length; g++){
      var r=await window.fhPersonalDeleteExpense(legIds[g], true);
      if(r) dropOld(legIds[g]); else allOk=false;
    }
    if(allOk) ok++; else fail++;
  }
  try{ await window.fhPersonalHydrate(); }catch(_e){}
  if(bar) bar.classList.remove('busy');
  txnSelExit();
  if(typeof renderPersonal==='function'){ try{ renderPersonal(); }catch(_e){} }
  refreshPersonalTxnOverlay();
  toast(fail
    ? L('Đã xoá '+ok+' khoản · '+fail+' khoản lỗi','Deleted '+ok+' · '+fail+' failed')
    : L('Đã xoá '+ok+' khoản','Deleted '+ok+' items'));
}

function memMatch(who,member){ var w=(who||'').toLowerCase(), v=member.toLowerCase(); if(v==='shared'||v==='both')return w==='shared'||w==='both'; return w===v; }
// Push a focused, reusable detail screen. Optional `month` presets the month (contextual entry).
var curDetail=null;
function openCat(type,val,month){
  if(month && months[month] && month!==selMonth){ selMonth=month; renderAll(); renderTxns(); }
  curDetail={type:type,val:val};
  var m=M(), ico=document.getElementById('cd-ico');
  var moAb=m._iso?moAbbr(new Date(m._iso+'T00:00:00').getMonth()):m.short;
  setTxt('cd-monname', moAb);                              // month filter button
  ico.className='cd-fico';
  var rows='', lab='', num='', line='', lineCol='var(--muted)', listHead=L('Giao dịch','Transactions'), showBar=false, showFoot=false, fl='', fr='', count=0, unit=L('khoản','item');
  if(type==='mem'){
    var mt=membersMeta[val], v=(m.memberSpent[val]||0);
    var tot=Object.keys(m.memberSpent).reduce(function(a,k){return a+m.memberSpent[k];},0)||1;
    ico.style.cssText='border-radius:50%;background:'+mt.col; ico.textContent='';
    lab=L('Đã trả · ','Paid · ')+moAb; num=fmt(v); line=Math.round(v/tot*100)+L('% trong tổng chi của cả nhà','% of what the family paid');
    var mtx=txns.filter(function(t){return !t.future && t.month===selMonth && memMatch(t.who,val);}); count=mtx.length; rows=mtx.map(txRow).join('');
  } else if(val==='Events' || val==='Future expenses'){
    var isEv=(val==='Events');
    ico.style.cssText='background:var(--brand-tint);color:var(--brand-ink)'; ico.textContent=isEv?'🎯':'📅';
    lab=L('Để dành · ','Reserved · ')+moAb; num=fmt(isEv?eventsReserved():futureExpReserved()); lineCol='var(--brand-ink)';
    line=isEv?L('Dành cho các sự kiện sắp tới','Held for upcoming events'):L('Dành cho chi tiêu đã lên kế hoạch','Held for planned spending');
    var evks=isEv?order.filter(function(k){return !achievedNow(events[k])&&(events[k].setAside||0)>0;}):[], ftx=isEv?[]:txns.filter(function(t){return t.future;});
    count=isEv?evks.length:ftx.length; rows=isEv?evks.map(resRow).join(''):ftx.map(futRow).join('');
    listHead=isEv?L('Sự kiện sắp tới','Upcoming events'):L('Chi tiêu dự kiến','Planned expenses'); unit=isEv?L('sự kiện','event'):L('khoản','item');
  } else {
    var s=catStyle[val]||['🧾','#f2eef6','var(--cat-other)'], sp=m.catSpent[val]||0, bd=catBudget[val]||0, done=m.done, pace=done?1:m.dom/m.dim;
    ico.style.cssText='background:'+s[1]+';color:'+s[2]; ico.textContent=s[0];
    var overBud=sp>bd, overPace=!done&&bd&&(sp/bd)>(pace+0.14), under=bd&&(sp/bd)<pace-0.05;
    lab=L('Đã chi · ','Spent · ')+moAb; num=fmt(sp);
    line=overBud?L('Vượt ngân sách','Over budget'):(overPace?L('Đang tiêu nhanh hơn dự kiến','Running over pace'):(under?L('Thoải mái dưới mức','Comfortably under pace'):L('Đúng nhịp','On track')));
    lineCol=overBud?'var(--danger)':(overPace?'var(--amber)':(under?'var(--good)':'var(--muted)'));
    showBar=true; showFoot=true; fl='<b>'+fmt(sp)+'</b> '+L('trên','of')+' '+fmt(bd); fr=done?L('Đã chốt tháng','Month closed'):(m.dim-m.dom)+L(' ngày còn lại',' days left');
    var bar=document.getElementById('cd-bar'); bar.style.width=(bd?Math.min(100,sp/bd*100):0)+'%'; bar.style.background=overBud?'#F5694F':(overPace?'#FFB020':s[2]);
    document.getElementById('cd-mark').style.cssText=done?'display:none':('left:'+(pace*100)+'%');
    var ctx=txns.filter(function(t){return !t.future && t.month===selMonth && t.cat===val;}); count=ctx.length; rows=ctx.map(txRow).join('');
  }
  setTxt('cd-name',whoName(val)); setTxt('cd-lab',lab); setTxt('cd-num',num); setTxt('cd-listhead',listHead);
  setTxt('cd-count', count? (count+' '+unit+(isVi()?'':(count===1?'':'s'))) : '');
  setHTML('cd-line','<span style="color:'+lineCol+';font-weight:600">'+line+'</span>');
  document.getElementById('cd-barbox').style.display=showBar?'':'none';
  var ft=document.getElementById('cd-foot'); ft.style.display=showFoot?'':'none';
  if(showFoot){ setHTML('cd-foot-l',fl); setTxt('cd-foot-r',fr); }
  var empty = m.done ? L('Các tháng trước chỉ hiển thị tổng, không liệt kê từng giao dịch.','Earlier months show totals only. Individual transactions aren’t itemized.') : L('Chưa có giao dịch nào ở đây.','No transactions here yet.');
  document.getElementById('cd-rows').innerHTML=rows||'<div class="empty-note">'+empty+'</div>';
  var sc=document.querySelector('#cat-overlay .cd-scroll'); if(sc)sc.scrollTop=0;
  var realCat = type==='cat' && val!=='Events' && val!=='Future expenses' && !m.done;   // can log into a real, open-month category
  document.getElementById('cd-cta-bar').style.display = realCat ? '' : 'none';
  document.getElementById('cat-overlay').classList.add('on');
}
function logFromCat(){ if(curDetail && curDetail.type==='cat') openExpense({cat:curDetail.val, date:isoDate(TODAY)}); }
function openCatPicker(){ openSheet('sheet-catpick'); }
function buildCatPicker(){
  if(!curDetail)return; var t=curDetail.type, v=curDetail.val, html='';
  if(t==='mem'){
    setTxt('catpick-h',L('Ai đã trả','Who paid')); setTxt('catpick-sub',L('Xem chi tiêu của người khác.',"Jump to another person's spending."));
    Object.keys(M().memberSpent).forEach(function(k){ html+='<button class="choice'+(k===v?' on':'')+'" onclick="pickCatFilter(\'mem\',\''+k+'\')">'+whoName(k)+'</button>'; });
  } else {
    setTxt('catpick-h',L('Danh mục','Category')); setTxt('catpick-sub',L('Chuyển tới giao dịch của danh mục khác.',"Jump to another category's transactions."));
    catOrder.forEach(function(c){ html+='<button class="choice'+(c===v?' on':'')+'" onclick="pickCatFilter(\'cat\',\''+c+'\')">'+((catStyle[c]||[''])[0])+' '+c+'</button>'; });
    if(eventsReserved()>0) html+='<button class="choice'+(v==='Events'?' on':'')+'" onclick="pickCatFilter(\'cat\',\'Events\')">🎯 '+L('Sự kiện','Events')+'</button>';
    if(futureExpReserved()>0) html+='<button class="choice'+(v==='Future expenses'?' on':'')+'" onclick="pickCatFilter(\'cat\',\'Future expenses\')">📅 '+L('Sắp tới','Future')+'</button>';
  }
  setHTML('catpick-list',html);
}
function pickCatFilter(t,v){ closeSheet(); openCat(t,v); }
function closeCat(){ document.getElementById('cat-overlay').classList.remove('on'); }
function addExpense(){
  var amt=parseAmtBase(document.getElementById('ex-amt').value);
  if(!amt){ document.getElementById('ex-amt').focus(); return; }
  var note=document.getElementById('ex-note').value.trim()||L('Khoản chi','Expense');
  var cat=chosen('ex-cat')||'Fun'; lastCat=cat;
  var s=catStyle[cat]||['🧾','#f2eef6','var(--cat-other)'];
  var dObj=exDate(), dstr=(dObj.getTime()===TODAY.getTime())?'Today':(MONA[dObj.getMonth()]+' '+dObj.getDate());
  // Per-row time: in a bulk save, submitBulk loadRow(i)s each row into the fields
  // first, so #ex-time already holds this row's own time (or '' → day-only).
  var _time=(document.getElementById('ex-time')||{}).value||null;
  if(cat==='Event'){                                        // the "Event" category → a real event
    var eid='e'+order.length+Math.floor(amt);
    var past=dObj<TODAY;                                    // a past date = it already happened (realized), not upcoming
    var ev={name:note,emoji:'🎈',cov:'pink',date:(MONA[dObj.getMonth()]+' '+dObj.getDate()),d:dObj,target:amt,saved:amt,setAside:past?0:amt};
    if(past){ ev.achieved=true; months[curMonthKey()].spent+=amt; }   // spent already · goes straight to Memories
    if(exPhotos.length) ev.memories=exPhotos.map(function(s,i){ return i===0?{src:s,caption:note}:{src:s}; }); // photos become memories right away
    events[eid]=ev; order.unshift(eid); renderEvents(); renderTxns(); selMonth=curMonthKey(); renderAll();
    if(!BULK_SAVING){                                        // in a bulk loop, defer close/toast/nav to submitBulk()
      if(typeof clearDrafts==='function') clearDrafts();
      document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
      closeExpense();
      if(past){ toast(L(esc(note)+' đã lưu · thêm ảnh để ghi nhớ nhé 📸',esc(note)+' saved · add a photo to remember it 📸')); floatEmojis('📸'); goMoments('memories'); }
      else { toast(L(esc(note)+' đã thêm vào Sự kiện · còn '+fmt(Math.max(0,months[curMonthKey()].budget-months[curMonthKey()].spent-monthReserved()))+' an toàn để tiêu',esc(note)+' added to Events · '+fmt(Math.max(0,months[curMonthKey()].budget-months[curMonthKey()].spent-monthReserved()))+' safe to spend')); floatEmojis('🎈'); goMoments('plans'); }
    }
    return;
  }
  if(dObj>TODAY){                                           // future date → a *proposal* (reserves nothing until the family aligns)
    var fwho=chosen('ex-who')||'Emma', fwhoStore=(fwho==='Both')?'Shared':fwho;
    var fby=(typeof _futMeId==='function')?_futMeId():((typeof _meName==='function')?_meName():fwhoStore);   // creator id (live) / name (demo)
    txns.unshift({id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:dstr,_d:dObj,who:fwhoStore,amt:amt,time:_time,future:true,by:fby,reviews:[],month:curMonthKey(),photos:exPhotos.length?exPhotos.slice():undefined});
    renderTxns(); selMonth=curMonthKey(); renderAll();
    if(!BULK_SAVING){                                        // bulk loop → submitBulk() handles the tail
      if(typeof clearDrafts==='function') clearDrafts();
      document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
      closeExpense();
      toast(L('Đã gửi cho cả nhà duyệt · sẽ để dành khi có người đồng ý','Sent to the family · set aside once someone agrees'));
      if(typeof openRequests==='function') openRequests(); else { go('spending'); segTo('overview'); }
    }
    return;
  }
  var who=chosen('ex-who')||'Emma'; lastWho=who;
  var mkey=who==='Both'?'Shared':who, whoStore=who==='Both'?'both':who;
  var hadPhoto=exPhotos.length>0;
  txns.unshift({id:'t'+(txSeq++),ico:s[0],cat:cat,note:note,date:dstr,_d:dObj,_ts:new Date(),who:whoStore,amt:amt,time:_time,month:curMonthKey(),photos:exPhotos.length?exPhotos.slice():undefined});
  if(hadPhoto) syncExpenseEvent(txns[0]);                   // photos → a linked event for Events + Memories
  renderTxns();
  var jul=months[curMonthKey()];
  var wasUnder=(jul.catSpent[cat]||0)<=(catBudget[cat]||Infinity);
  jul.spent+=amt; jul.catSpent[cat]=(jul.catSpent[cat]||0)+amt; jul.memberSpent[mkey]=(jul.memberSpent[mkey]||0)+amt;
  selMonth=curMonthKey(); renderAll(); if(hadPhoto) renderEvents();   // photo → shows in Memories
  if(!BULK_SAVING){                                          // bulk loop → submitBulk() fires one summary toast + nav
    if(typeof clearDrafts==='function') clearDrafts();
    document.getElementById('ex-amt').value=''; document.getElementById('ex-note').value=''; exPhotos=[];
    var catOv=document.getElementById('cat-overlay').classList.contains('on');
    closeExpense();
    if(hadPhoto){ toast(L('Đã ghi '+fmt(amt)+' · lưu vào Kỷ niệm 📸','Logged '+fmt(amt)+' · saved to Memories 📸')); floatEmojis('📸'); }
    else if(catBudget[cat] && wasUnder && jul.catSpent[cat]>catBudget[cat]) toast(L('Lưu ý: '+esc(cat)+' đã vượt ngân sách','Heads up: '+esc(cat)+' is now over budget'));
    else toast(L('Đã ghi '+fmt(amt)+' · còn '+fmt(Math.max(0,months[curMonthKey()].budget-jul.spent))+' an toàn để tiêu','Logged '+fmt(amt)+' · '+fmt(Math.max(0,months[curMonthKey()].budget-jul.spent))+' safe to spend'));
    if(catOv && curDetail){ openCat(curDetail.type,curDetail.val); }   // logged from a category detail → refresh it
    else { go('spending'); segTo('overview'); }
  }
}
