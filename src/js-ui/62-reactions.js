/* ---------- collaborative reactions ----------
   A family member holds a transaction row, throws ONE emotional reaction, and it
   surfaces three ways: an inline chip on the ledger row (A), a shared "Phòng khách"
   feed (B), and an arrival moment on the payer's phone (C). Five reactions, chosen
   to be emotional not neutral — shock / side-eye / laughing / love / annoyed — each
   with a small pool of contextual one-liners so the log never reads like a bot.
   Data + write-through live in js-data (reactions table, fhReact, get_family_snapshot). */
var RX = [
  { k:'shock',   e:'😱', vi:'Sốc',      en:'Shocked' },
  { k:'suspect', e:'🤨', vi:'Nghi ngờ', en:'Suspicious' },
  { k:'laugh',   e:'😂', vi:'Cười',     en:'Laughing' },
  { k:'love',    e:'🥰', vi:'Thương',   en:'Love it' },
  { k:'mad',     e:'😤', vi:'Tức',      en:'Not having it' }
];
/* one-liners per reaction — [vi, en], with {n} = reactor first name, {cat} = category.
   The pick is deterministic per (txn, member, emoji) so the sentence never reshuffles. */
var RX_MSG = {
  '😱': [ ['{n} đang xỉu ngang vụ này','{n} is losing it over this'],
          ['{n} há hốc mồm với vụ {cat}','{n}’s jaw dropped at this {cat}'],
          ['{n} chưa hết bàng hoàng','{n} is still in shock'] ],
  '🤨': [ ['{n} đang nghi ngờ vụ này','{n} is questioning this'],
          ['{n} đang soi khoản {cat} này','{n} is side-eyeing this {cat}'],
          ['{n} thấy sai sai chỗ này','{n} smells something off'] ],
  '😂': [ ['{n} cười không nhặt được mồm','{n} can’t stop laughing'],
          ['{n} thấy vụ {cat} này hài dễ sợ','{n} finds this {cat} hilarious'],
          ['{n} cười xỉu với vụ này','{n} is dying at this'] ],
  '🥰': [ ['{n} duyệt khoản này liền','{n} approves this instantly'],
          ['{n} thấy tiêu vậy là đáng','{n} says worth every đồng'],
          ['{n} thương vụ {cat} này ghê','{n} adores this {cat}'] ],
  '😤': [ ['{n} đang tức cái vụ này','{n} is not having this'],
          ['{n} không chịu khoản {cat} này đâu','{n} won’t let this {cat} slide'],
          ['{n} bực ra mặt','{n} is visibly annoyed'] ]
};
function rxCfg(e){ for(var i=0;i<RX.length;i++){ if(RX[i].e===e) return RX[i]; } return RX[1]; }
function rxHash(s){ var h=0; s=String(s||''); for(var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return Math.abs(h); }
function rxFirstName(mid){
  var m=window.DB && window.DB.memberById && window.DB.memberById[mid], nm=m?m.name:'';
  if(mid && window.DB && mid===window.DB.ownerMemberId){ var me=(typeof _meName==='function')?_meName():''; if(me) nm=me; }
  return (typeof firstName==='function')?firstName(nm||''):(nm||L('Ai đó','Someone'));
}
function rxMessage(rec, tx){
  var pool=RX_MSG[rec.emoji]||RX_MSG['🤨'];
  var nm=rxFirstName(rec.memberId);
  var cat=(tx && tx.cat)?String(tx.cat):L('khoản này','this');
  var pair=pool[rxHash((rec.txId||'')+'|'+(rec.memberId||'')+'|'+rec.emoji)%pool.length];
  return L(pair[0],pair[1]).replace(/\{n\}/g, esc(nm)).replace(/\{cat\}/g, esc(cat.toLowerCase()));
}
function _rxFace(mid){
  var m=window.DB && window.DB.memberById && window.DB.memberById[mid];
  var col=(m&&m.color)||'#8f8a99', ini=(m && typeof inits==='function')?inits(m.name):'👤';
  return '<span class="rx-av av" style="background:'+col+'">'+esc(ini)+'</span>';
}
function rxTxByDbId(id){ var a=window.txns||[]; for(var i=0;i<a.length;i++){ if(a[i]._dbId===id) return a[i]; } return null; }
function _rxMineOn(txDbId){
  var mid=window.DB&&window.DB.ownerMemberId, arr=((window.DB&&window.DB.reactionsByTx)||{})[txDbId]||[];
  for(var i=0;i<arr.length;i++){ if(arr[i].memberId===mid) return arr[i].emoji; } return null;
}

/* ---- A · the inline chip appended into a transaction row's body ---- */
function rxChip(t){
  var rs=t && t.reactions; if(!rs || !rs.length) return '';
  var lead=rs[0]; for(var i=1;i<rs.length;i++){ if(rs[i].at>lead.at) lead=rs[i]; }
  var seen={}, emos='';
  rs.forEach(function(r){ if(!seen[r.emoji]){ seen[r.emoji]=1; emos+='<span class="rx-e">'+r.emoji+'</span>'; } });
  var extra=rs.length>1 ? ' <span class="rx-n">+'+(rs.length-1)+'</span>' : '';
  return '<div class="rx-chip"><span class="rx-es">'+emos+'</span><span class="rx-msg">'+rxMessage(lead,t)+extra+'</span></div>';
}
window.rxChip=rxChip;

/* ---- the picker: a small popover that springs from the pressed row ---- */
function openRxPicker(txDbId, cx, cy){
  closeRxPicker();
  var phone=document.getElementById('phone'); if(!phone) return;
  window._rxPickTx=txDbId;
  var pr=phone.getBoundingClientRect();
  var mine=_rxMineOn(txDbId);
  var pop=document.createElement('div'); pop.className='rx-pop'; pop.id='rx-pop';
  pop.innerHTML=RX.map(function(r,i){
    return '<button class="rx-opt'+(mine===r.e?' on':'')+'" style="--i:'+i+'" onclick="throwReaction(\''+txDbId+'\',\''+r.e+'\')" aria-label="'+escAttr(L(r.vi,r.en))+'">'+r.e+'</button>';
  }).join('');
  phone.appendChild(pop);
  var w=pop.offsetWidth, h=pop.offsetHeight;
  var left=(cx-pr.left)-w/2, top=(cy-pr.top)-h-14;
  left=Math.max(10, Math.min(pr.width-w-10, left));
  if(top<8) top=(cy-pr.top)+22;                     // no room above the finger → drop below it
  pop.style.left=left+'px'; pop.style.top=top+'px';
  window._rxLastXY={ x:cx, y:cy };                  // remember where the reaction was thrown, so it bursts from there
  requestAnimationFrame(function(){ pop.classList.add('on'); });
  setTimeout(function(){
    window._rxOutside=function(ev){ if(!ev.target.closest || !ev.target.closest('#rx-pop')) closeRxPicker(); };
    document.addEventListener('touchstart', window._rxOutside, true);
    document.addEventListener('mousedown', window._rxOutside, true);
  }, 30);
}
function closeRxPicker(){
  var p=document.getElementById('rx-pop'); if(p && p.parentNode) p.parentNode.removeChild(p);
  if(window._rxOutside){ document.removeEventListener('touchstart', window._rxOutside, true); document.removeEventListener('mousedown', window._rxOutside, true); window._rxOutside=null; }
}
window.closeRxPicker=closeRxPicker;

/* a localized burst of the chosen emoji, fanning up from the point it was thrown —
   the reactor's own "bumping out" feedback (distinct from the recipient's full-screen
   arrival float). Falls back to centre when no coordinates are known (e.g. react-back). */
function rxBurst(emoji, x, y){
  var phone=document.getElementById('phone'); if(!phone) return;
  var pr=phone.getBoundingClientRect();
  var cx=(x!=null?x-pr.left:pr.width/2), cy=(y!=null?y-pr.top:pr.height*0.42);
  for(var i=0;i<7;i++){ (function(i){
    var s=document.createElement('span'); s.className='rx-burst'; s.textContent=emoji;
    s.style.left=cx+'px'; s.style.top=cy+'px';
    phone.appendChild(s);
    var ang=(-90+(i-3)*24)*Math.PI/180, dist=48+(i%3)*22;
    var dx=Math.cos(ang)*dist, dy=Math.sin(ang)*dist-26;
    requestAnimationFrame(function(){
      s.style.transition='transform .85s cubic-bezier(.2,.7,.3,1), opacity .85s ease';
      s.style.transform='translate('+dx.toFixed(0)+'px,'+dy.toFixed(0)+'px) scale(1.1)'; s.style.opacity='0';
    });
    setTimeout(function(){ if(s.parentNode) s.remove(); }, 900);
  })(i); }
}
window.rxBurst=rxBurst;

/* ---- throw (or clear) a reaction: optimistic, then persist ---- */
function _rxLocalSet(txDbId, emoji){
  var mid=window.DB && window.DB.ownerMemberId; if(!mid) return;
  var map=window.DB.reactionsByTx=window.DB.reactionsByTx||{};
  var arr=(map[txDbId]||[]).filter(function(r){ return r.memberId!==mid; });   // drop my previous, if any
  if(emoji) arr.push({ id:'local', txId:txDbId, memberId:mid, emoji:emoji, at:new Date().toISOString() });
  if(arr.length) map[txDbId]=arr; else delete map[txDbId];
  var tx=rxTxByDbId(txDbId); if(tx) tx.reactions=map[txDbId]||null;
  var flat=[]; for(var k in map){ (map[k]||[]).forEach(function(r){ flat.push(r); }); }
  flat.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });
  window.reactions=flat;
}
function throwReaction(txDbId, emoji){
  closeRxPicker();
  var remove=(_rxMineOn(txDbId)===emoji);              // tapping your current reaction again clears it
  _rxLocalSet(txDbId, remove?null:emoji);
  if(!remove){ var xy=window._rxLastXY; rxBurst(emoji, xy?xy.x:null, xy?xy.y:null); }   // your own reaction bumps out where you threw it
  window._rxLastXY=null;
  if(typeof window.fhReact==='function') window.fhReact(txDbId, remove?null:emoji);
  if(typeof renderTxns==='function') renderTxns();
  if(typeof renderRxWall==='function') renderRxWall();
  var homeOn=document.getElementById('v-home'); if(homeOn && homeOn.classList.contains('on') && typeof renderHome==='function') renderHome();
  var txnOv=document.getElementById('txn-overlay'); if(txnOv && txnOv.classList.contains('on') && typeof renderTxnScreen==='function') renderTxnScreen();
  if(!remove){ var r=rxCfg(emoji); if(typeof toast==='function') toast(L('Đã thả '+r.e+' cho khoản này','Reacted '+r.e)); }
}
window.throwReaction=throwReaction;

/* ---- long-press to open the picker (no long-press exists elsewhere in the app,
        so this is bound once here via event delegation over both pointer models) ---- */
(function(){
  var LP=460, MOVE=12, timer=null, sx=0, sy=0, rxid=null;
  function clear(){ if(timer){ clearTimeout(timer); timer=null; } rxid=null; }
  function start(e, pt){
    var row=e.target.closest && e.target.closest('.row[data-rxid]'); if(!row) return;
    rxid=row.getAttribute('data-rxid'); sx=pt.clientX; sy=pt.clientY;
    clearTimeout(timer);
    timer=setTimeout(function(){
      window._rxSuppressClick=true; setTimeout(function(){ window._rxSuppressClick=false; }, 700);
      if(navigator.vibrate){ try{ navigator.vibrate(12); }catch(_){} }
      openRxPicker(rxid, sx, sy); clear();
    }, LP);
  }
  function move(pt){ if(!timer) return; if(Math.abs(pt.clientX-sx)>MOVE || Math.abs(pt.clientY-sy)>MOVE) clear(); }
  document.addEventListener('touchstart', function(e){ if(e.touches.length>1){ clear(); return; } start(e, e.touches[0]); }, {passive:true});
  document.addEventListener('touchmove', function(e){ move(e.touches[0]); }, {passive:true});
  document.addEventListener('touchend', clear, {passive:true});
  document.addEventListener('touchcancel', clear, {passive:true});
  document.addEventListener('mousedown', function(e){ if(e.button===0) start(e, e); });
  document.addEventListener('mousemove', function(e){ move(e); });
  document.addEventListener('mouseup', clear);
  // a long-press must NOT also open the expense editor (the row's own onclick).
  // Never suppress a tap inside the picker itself — the emoji buttons must always fire.
  document.addEventListener('click', function(e){
    if(!window._rxSuppressClick) return;
    if(e.target.closest && e.target.closest('#rx-pop')) return;
    window._rxSuppressClick=false; e.stopImmediatePropagation(); e.preventDefault();
  }, true);
  // no iOS callout / desktop context menu on a held row
  document.addEventListener('contextmenu', function(e){ if(e.target.closest && e.target.closest('.row[data-rxid]')) e.preventDefault(); });
})();

/* ---- B · the "Phòng khách" wall — one card per transaction that has reactions ---- */
function rxAgo(iso){
  try{ var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);
    if(s<60) return L('vừa xong','just now');
    if(s<3600) return Math.floor(s/60)+L(' phút','m');
    if(s<86400) return Math.floor(s/3600)+L(' giờ','h');
    return Math.floor(s/86400)+L(' ngày','d');
  }catch(e){ return ''; }
}
function _rxWallItems(){
  var map=(window.DB&&window.DB.reactionsByTx)||{}, items=[];
  for(var txid in map){
    var rs=map[txid]; if(!rs||!rs.length) continue;
    var tx=rxTxByDbId(txid); if(!tx) continue;                 // tx must be in the loaded ledger
    var lead=rs[0]; for(var i=1;i<rs.length;i++){ if(rs[i].at>lead.at) lead=rs[i]; }
    items.push({ tx:tx, rs:rs, lead:lead, at:lead.at });
  }
  items.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });
  return items;
}
function rxCard(it, compact){
  var tx=it.tx, rs=it.rs, lead=it.lead;
  var faces='', sm={}, nExtra=0;
  rs.forEach(function(r){ if(!sm[r.memberId]){ sm[r.memberId]=1; if(Object.keys(sm).length<=3) faces+=_rxFace(r.memberId); else nExtra++; } });
  if(nExtra>0) faces+='<span class="rx-more">+'+nExtra+'</span>';
  var note=esc(tx.note||L('Khoản chi','Expense')), amt=(typeof fmt==='function')?fmt(tx.amt):tx.amt, when=rxAgo(lead.at);
  var mine=_rxMineOn(tx._dbId);
  var chev='<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
  var back=compact?'':'<div class="rx-back">'+RX.map(function(r){ return '<button class="rx-bk'+(mine===r.e?' on':'')+'" onclick="throwReaction(\''+tx._dbId+'\',\''+r.e+'\')" aria-label="'+escAttr(L(r.vi,r.en))+'">'+r.e+'</button>'; }).join('')+'</div>';
  return '<div class="rx-card'+(compact?' compact':'')+'">'
    +'<button class="rx-card-main" onclick="rxJumpTo(\''+tx._dbId+'\')">'
      +'<span class="rx-ico">'+lead.emoji+'</span>'
      +'<span class="rx-card-b"><span class="rx-card-msg">'+rxMessage(lead,tx)+'</span>'
        +'<span class="rx-card-sub">'+faces+'<span class="rx-tx">'+note+' · '+amt+'</span>'+(when?'<span class="rx-when">'+when+'</span>':'')+'</span></span>'
      +chev
    +'</button>'+back+'</div>';
}
function renderRxWall(){
  var sec=document.getElementById('rx-wall-sec'), box=document.getElementById('rx-wall'); if(!box) return;
  var items=_rxWallItems();
  if(!items.length){ if(sec) sec.style.display='none'; box.innerHTML=''; return; }
  if(sec) sec.style.display='';
  var cnt=document.getElementById('rx-wall-count'); if(cnt) cnt.textContent=String(items.length);
  box.innerHTML=items.slice(0,12).map(function(it){ return rxCard(it,false); }).join('');
}
window.renderRxWall=renderRxWall;
function rxHomeStripHTML(){
  var items=_rxWallItems(); if(!items.length) return '';
  var head=(typeof _sectionH==='function')?_sectionH(L('Phòng khách','The living room'),'go(&#39;spending&#39;)'):'';
  return head+'<div class="rx-home">'+items.slice(0,3).map(function(it){ return rxCard(it,true); }).join('')+'</div>';
}
window.rxHomeStripHTML=rxHomeStripHTML;
function rxJumpTo(txDbId){ closeRxArrive(); var tx=rxTxByDbId(txDbId); if(tx && typeof openEditExpense==='function') openEditExpense(tx.id); }
window.rxJumpTo=rxJumpTo;

/* ---- C · the arrival moment — a reaction on MY transaction, landed ---- */
function _rxSeen(){ try{ return localStorage.getItem('fh-rx-seen')||''; }catch(e){ return ''; } }
function _rxSetSeen(v){ try{ if(v) localStorage.setItem('fh-rx-seen', v); }catch(e){} }
function _rxBusy(){
  // The arrival is a non-blocking confetti + toast now, so it can coexist with sheets
  // and the ledger. Only hold it back from stacking on a full-screen celebration or
  // the onboarding flow — it replays on the next hydrate once those clear.
  if(document.querySelector('.celebrate.on')) return true;
  var ob=document.getElementById('onboarding'); if(ob && ob.offsetParent!==null) return true;   // onboarding (z-90) is up
  return false;
}
function rxCheckArrivals(){
  var mid=window.DB && window.DB.ownerMemberId; if(!mid) return;
  if(window.editingTx!=null || document.hidden || _rxBusy()) return;     // never interrupt an edit / sheet / a backgrounded app
  var mineTx={}; (window.txns||[]).forEach(function(t){ if(t._dbId && t._memberId===mid) mineTx[t._dbId]=t; });
  var all=(window.reactions||[]).filter(function(r){ return mineTx[r.txId] && r.memberId!==mid; });   // others' reactions, on my spends
  if(!all.length) return;
  var maxAt=all.reduce(function(m,r){ return r.at>m?r.at:m; }, '');
  var seen=_rxSeen();
  if(!seen){ _rxSetSeen(maxAt); return; }                               // first run: seed the watermark, don't replay history
  var fresh=all.filter(function(r){ return r.at>seen; });
  if(!fresh.length) return;
  _rxSetSeen(maxAt);
  fresh.sort(function(a,b){ return a.at<b.at?1:a.at>b.at?-1:0; });
  rxArriveShow(fresh, mineTx);
}
window.rxCheckArrivals=rxCheckArrivals;
/* The arrival is deliberately NON-blocking: emoji confetti over the whole frame
   (plays wherever you happen to land), plus a tappable toast that deep-links to the
   transaction. No modal — it never interrupts what you're doing. */
function rxArriveShow(fresh, mineTx){
  if(document.hidden) return;
  var lead=fresh[0], tx=mineTx[lead.txId], more=fresh.length-1, txId=tx?tx._dbId:'';
  if(typeof floatEmojis==='function') floatEmojis(lead.emoji);          // confetti, once, where you are
  var old=document.getElementById('rx-toast'); if(old && old.parentNode) old.parentNode.removeChild(old);
  var el=document.createElement('button'); el.className='rx-toast'; el.id='rx-toast';
  el.setAttribute('aria-label', L('Xem khoản này','See this transaction'));
  el.onclick=function(){ closeRxArrive(); rxJumpTo(txId); };
  var second=more>0 ? L('và '+more+' phản ứng khác','and '+more+' more') : L('Chạm để xem','Tap to open');
  el.innerHTML='<span class="rx-toast-e">'+lead.emoji+'</span>'
    +'<span class="rx-toast-b"><span class="rx-toast-msg">'+rxMessage(lead,tx)+'</span><span class="rx-toast-cta">'+second+'</span></span>'
    +'<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 18l6-6-6-6"/></svg>';
  (document.getElementById('phone')||document.body).appendChild(el);
  requestAnimationFrame(function(){ el.classList.add('on'); });
  clearTimeout(window._rxToastT); window._rxToastT=setTimeout(closeRxArrive, 5600);
}
function closeRxArrive(){
  clearTimeout(window._rxToastT);
  var o=document.getElementById('rx-toast'); if(o){ o.classList.remove('on'); setTimeout(function(){ if(o.parentNode) o.parentNode.removeChild(o); }, 280); }
}
window.closeRxArrive=closeRxArrive;

/* run after every hydrate: refresh the wall + play any just-arrived moment */
function rxAfterHydrate(){ try{ renderRxWall(); }catch(e){} try{ rxCheckArrivals(); }catch(e){} }
window.rxAfterHydrate=rxAfterHydrate;