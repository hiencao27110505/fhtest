/* ── Cá nhân tab (personal ledger) ──
   Renders window.fhPersonalData() into #v-personal. Same visual language as
   the Finance tab (cf-card, rows, fh-lrow) — a lens over MY stream: mirrored
   family masters + private rows, per-space roll-up, quick private add. */
function renderPersonal(){
  var host = document.getElementById('pers-body'); if(!host) return;
  var P = window.fhPersonalData ? fhPersonalData() : null;
  if(!P){ host.innerHTML=''; return; }

  if(P.state==='provisioning' || P.state==='boot' || P.state==='loading'){
    host.innerHTML = '<div class="empty-note">Đang chuẩn bị sổ cá nhân của bạn…</div>'; return;
  }
  if(P.state==='error'){
    host.innerHTML = '<div class="empty-note">Chưa tải được sổ cá nhân. <a onclick="fhPersonalBoot()" style="color:var(--brand-ink);font-weight:700;cursor:pointer">Thử lại</a></div>'; return;
  }
  if(P.state==='locked'){
    host.innerHTML =
      '<div class="card" style="text-align:center">'+
      '<div style="font-size:34px">🔐</div>'+
      '<div style="font-family:var(--disp);font-size:19px;font-weight:700;letter-spacing:-.4px;margin-top:8px">Sổ cá nhân đang khóa</div>'+
      '<div style="font-size:13.5px;color:var(--muted);margin-top:6px;line-height:1.5">Nhập thẻ khóa <b>cá nhân</b> của bạn (khác thẻ của gia đình) để mở trên máy này.</div>'+
      '<div class="field" style="margin-top:14px"><input id="pers-card-in" placeholder="FH-XXXX-XXXX-…" autocomplete="off" autocapitalize="characters" style="text-align:center"></div>'+
      '<button class="cta" style="margin-top:12px" onclick="persUnlock()">Mở sổ cá nhân</button>'+
      '<div id="pers-unlock-err" style="font-size:12.5px;color:var(--danger);margin-top:8px"></div>'+
      '</div>';
    return;
  }

  /* ready */
  var mon = new Date().toISOString().slice(0,7);
  var txM = P.txns.filter(function(t){ return (t.date||'').slice(0,7)===mon && t.kind==='expense'; });
  var out = txM.reduce(function(s,t){ return s+(t.amt||0); },0);
  var inc = P.incomes.filter(function(i){ return (i.date||'').slice(0,7)===mon; }).reduce(function(s,i){ return s+(i.amt||0); },0);
  var left = inc-out;
  var fmt = function(v){ return (window.fmtMoney? fmtMoney(v) : (Math.round(v).toLocaleString('vi-VN')+' ₫')); };

  /* per-space roll-up from masters (personal key alone — no space keys needed) */
  var bySpace = {};
  txM.forEach(function(t){ var k=t.spaceId||'_p'; bySpace[k]=(bySpace[k]||0)+(t.amt||0); });
  var famName = function(fid){ var f=(P.fams||[]).find(function(x){return x.family_id===fid;}); return f? f.name : 'Nhóm'; };

  var h = '';
  h += '<section class="cf-card">'
     + '<div class="cf-lbl">Còn lại tháng này · cá nhân</div>'
     + '<div class="cf-big num'+(left<0?' neg':'')+'">'+fmt(left)+'</div>'
     + '<div class="cf-tiles">'
     +   '<button class="cf-tile" onclick="openSheet(\'sheet-pincome\')"><span class="cf-tl"><span class="cf-ar up">↑</span> Vào</span><span class="cf-tv num">'+fmt(inc)+'</span></button>'
     +   '<button class="cf-tile"><span class="cf-tl"><span class="cf-ar dn">↓</span> Ra</span><span class="cf-tv num">'+fmt(out)+'</span></button>'
     + '</div>'
     + (P.mirrorRan? '' : '<div class="cf-note flat">Đang đồng bộ các khoản bạn đã ghi cho gia đình…</div>')
     + '<div class="cf-cta"><button class="cc-row" onclick="openSheet(\'sheet-pexp\')"><span class="cc-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><span class="cc-t">Ghi khoản chi riêng tư</span><svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg></button></div>'
     + '</section>';

  /* groups */
  var spKeys = Object.keys(bySpace).filter(function(k){ return k!=='_p'; });
  h += '<div class="section-h"><span class="t">Các nhóm của tôi</span></div><div class="rows">';
  if(spKeys.length){
    spKeys.forEach(function(k){
      h += '<div class="row"><div class="r-ico" style="background:var(--brand-tint)">🏡</div><div class="r-body"><div class="r-t">'+famName(k)+'</div>'
         + '<div class="r-s">Bạn đã chi cho nhóm tháng này</div></div><div class="r-amt num">'+fmt(bySpace[k])+'</div></div>';
    });
  } else {
    h += '<div class="empty-note">Các khoản bạn ghi cho gia đình sẽ tự xuất hiện ở đây.</div>';
  }
  if(bySpace['_p']) {
    h += '<div class="row"><div class="r-ico" style="background:var(--fill-neutral)">🔒</div><div class="r-body"><div class="r-t">Riêng tư</div>'
       + '<div class="r-s">Chỉ mình bạn thấy</div></div><div class="r-amt num">'+fmt(bySpace['_p'])+'</div></div>';
  }
  h += '</div>';

  /* my stream */
  var catOf = function(id){ return (P.cats||[]).find(function(c){return c.id===id;}) || {}; };
  h += '<div class="section-h"><span class="t">Giao dịch của bạn</span></div><div class="rows">';
  if(P.txns.length){
    P.txns.slice(0,30).forEach(function(t){
      var c = catOf(t.catId);
      h += '<div class="row"><div class="r-ico" style="background:var(--fill-neutral)">'+(c.emoji||'🗂️')+'</div>'
         + '<div class="r-body"><div class="r-t">'+((t.note||c.name||'Khoản chi').replace(/</g,'&lt;'))+'</div>'
         + '<div class="r-s">'+t.date.slice(8,10)+'/'+t.date.slice(5,7)+(t.spaceId? ' · '+famName(t.spaceId) : ' · riêng tư')+'</div></div>'
         + '<div class="r-amt num">−'+fmt(t.amt||0)+'</div></div>';
    });
  } else {
    h += '<div class="empty-note">Chưa có giao dịch nào trong sổ cá nhân.</div>';
  }
  h += '</div>';
  host.innerHTML = h;
}

function persUnlock(){
  var el=document.getElementById('pers-card-in'), err=document.getElementById('pers-unlock-err');
  if(!el) return;
  fhPersonalUnlock(el.value).then(function(r){
    if(!r.ok && err) err.textContent = (r.error==='checksum'||r.error==='wrong_card') ? 'Thẻ không đúng — kiểm tra lại từng nhóm ký tự.' : 'Chưa mở được ('+r.error+').';
  });
}

/* personal card intro — the ONE secret to protect */
function fhPCardIntro(){
  var c = window.__fhPersonalCard; if(!c) return;
  var d = document.getElementById('pcard-display'); if(d) d.textContent = c.display;
  openSheet('sheet-pcard');
}
function persCardCopy(){
  var c = window.__fhPersonalCard; if(!c) return;
  (navigator.clipboard && navigator.clipboard.writeText(c.display)).then(function(){ window.toast && toast('Đã sao chép thẻ khóa'); });
}
function persCardSave(){
  var c = window.__fhPersonalCard; if(!c) return;
  var blob = new Blob(['FamilyHub — Thẻ khóa CÁ NHÂN của bạn\n\n'+c.display+'\n\nĐây là chìa khóa dữ liệu cá nhân. Cất kỹ — mất thẻ là mất dữ liệu, không ai khôi phục được (kể cả chúng tôi).'], {type:'text/plain'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'FamilyHub-The-khoa-ca-nhan.txt'; a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
}

/* quick-add handlers */
function persAddExpense(){
  var amt = parseFloat((document.getElementById('pexp-amt')||{}).value||'');
  var note = ((document.getElementById('pexp-note')||{}).value||'').trim();
  var cat = (document.getElementById('pexp-cat')||{}).value || null;
  if(!isFinite(amt) || amt<=0){ window.toast && toast('Nhập số tiền'); return; }
  fhPersonalAddExpense(amt, note, cat).then(function(ok){ if(ok){ closeModals(); renderPersonal(); window.toast && toast('Đã ghi vào sổ cá nhân'); } });
}
function persAddIncome(){
  var amt = parseFloat((document.getElementById('pinc-amt')||{}).value||'');
  var note = ((document.getElementById('pinc-note')||{}).value||'').trim();
  if(!isFinite(amt) || amt<=0){ window.toast && toast('Nhập số tiền'); return; }
  fhPersonalAddIncome(amt, note).then(function(ok){ if(ok){ closeModals(); renderPersonal(); window.toast && toast('Đã ghi thu nhập'); } });
}
function persFillCats(){
  var sel = document.getElementById('pexp-cat'); if(!sel) return;
  var P = window.fhPersonalData ? fhPersonalData() : null; if(!P) return;
  sel.innerHTML = '<option value="">Danh mục…</option>' + (P.cats||[]).map(function(c){ return '<option value="'+c.id+'">'+(c.emoji||'')+' '+(c.name||'')+'</option>'; }).join('');
}
