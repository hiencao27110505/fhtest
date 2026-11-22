/* ── Spaces ("Nhóm") — how the shell follows the open space ───────────────────
   The other three tabs show whichever space is open. What they show follows
   that space's profile (15-spaces-core.js): one layout, eight switches.

   Gating is presentation, never access: a member is trusted with everything in
   their space. So a switch that is off hides and skips; it protects nothing.

   Two mechanisms, on purpose:
     · classes on <html> (sp-no-<feature>, sp-friend, sp-split, sp-closed) for
       static markup, so a hidden tab or add-sheet row never flashes;
     · fhSpaceHas(feature) for renders and background work.
   An existing family reads as every switch on (Chia tiền off), so for a family
   none of the classes is set and nothing here changes what it sees. */

function fhSpaceHas(k){
  try{ if(typeof window.fhSpaceProfile === 'function') return !!window.fhSpaceProfile()[k]; }catch(e){}
  return !!FH_SPACE_PRESETS.family[k];
}
function fhSpaceIsFamily(){
  try{ if(typeof window.fhSpaceProfile === 'function') return window.fhSpaceProfile().preset === 'family'; }catch(e){}
  return true;
}
function fhSpaceActiveId(){ return (window.DB && DB.fid) || null; }
function fhSpaceClosed(){ var sp = window.fhSpaceActive && fhSpaceActive(); return !!(sp && sp.closed); }
/* The mark a space wears where a picture would go: its own, or its preset's. */
function fhSpaceMark(sp){
  var e = sp && sp.profile && sp.profile.emoji;
  if(e && String(e).length <= 8) return String(e);
  return (!sp || sp.type === 'family') ? '🏡' : ((sp.profile && sp.profile.preset === 'other') ? '✨' : '🤝');
}
function fhSpaceName(sp){
  if(!sp) return (window.FAM && FAM.familyName) || L('Nhóm','Space');
  return sp.name || L('Nhóm','Space');
}
/* The chip that names the open space and opens the list of the others. */
function fhSpaceChipHTML(){
  var sp = window.fhSpaceActive && fhSpaceActive(); if(!sp) return '';
  return '<button class="ch-pill sp-chip" type="button" onclick="fhSpaceSwitcher()">'+esc(fhSpaceMark(sp))+' '+esc(fhSpaceName(sp))
    +' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6"/></svg></button>';
}
function _spSwapKey(sel, key){
  var el = document.querySelector(sel); if(!el) return;
  if(el.getAttribute('data-t') === key) return;
  el.setAttribute('data-t', key);
  el.textContent = (typeof t === 'function') ? t(key) : key;
}
/* Paint the shell for the open space. Cheap and idempotent: called after the
   roster is read, after a switch, after every hydrate and after applyLang. */
function fhSpaceShellApply(){
  var root = document.documentElement, p, sp = null;
  try{ p = window.fhSpaceProfile ? window.fhSpaceProfile() : fhSpaceProfileOf('family', null); sp = window.fhSpaceActive ? fhSpaceActive() : null; }
  catch(e){ p = fhSpaceProfileOf('family', null); }
  FH_SPACE_FEATURES.forEach(function(k){ root.classList.toggle('sp-no-'+k, !p[k]); });
  var friend = p.preset !== 'family';
  root.classList.toggle('sp-friend', friend);
  root.classList.toggle('sp-split', !!p.split);
  root.classList.toggle('sp-closed', !!(sp && sp.closed));
  /* tabs: with the house off the first tab is the space itself (S37) */
  _spSwapKey('#t-home span', p.house ? 'tabHome' : 'tabSpace');
  _spSwapKey('#t-spending span', friend ? 'tabSpend' : 'tabMoney');
  _spSwapKey('#v-spending .ch-title', friend ? 'finHeadSp' : 'finHead');
  _spSwapKey('#v-spending .ch-sub', friend ? 'finSubSp' : 'finSub');
  _spSwapKey('#v-events .ch-sub', friend ? 'momentsSubSp' : 'momentsSub');
  /* the chip: shown as soon as there is a second space to go to */
  var many = !!(window.fhSpacesData && fhSpacesData().all.length > 1) || friend;
  ['sp-chip-spending','sp-chip-events'].forEach(function(id){
    var el = document.getElementById(id); if(!el) return;
    var h = many ? fhSpaceChipHTML() : '';
    if(el.innerHTML !== h) el.innerHTML = h;
  });
  /* the expense sheet's second destination is the open space, by name */
  var sc = document.querySelector('#ex-scope .choice[data-v="family"]');
  if(sc){ var lab = fhSpaceMark(sp) + ' ' + (sp ? fhSpaceName(sp) : L('Gia đình','Family')); if(sc.textContent !== lab) sc.textContent = lab; }
  /* standing on a tab this space does not have: go to its first tab */
  var ev = document.getElementById('v-events');
  if(!p.moments && ev && ev.classList.contains('on') && typeof go === 'function') go('home');
}
window.fhSpaceShellApply = fhSpaceShellApply;

/* ── a shared expense on a row ────────────────────────────────────────────── */
/* The share row of a transaction in the OPEN space, or null (a Chung row, a
   space without Chia tiền, or shares not read yet). */
function fhSpaceShareOf(dbId){
  if(!dbId || !fhSpaceHas('split') || !window.fhSpacesData) return null;
  var d = fhSpacesData().data[fhSpaceActiveId()];
  var s = d && d.shares && d.shares[dbId];
  return (s && s.map) ? s : null;
}
function fhSpaceMemberName(mid){
  var d = window.fhSpacesData && fhSpacesData().data[fhSpaceActiveId()];
  var m = d && d.members.find(function(x){ return x.id === mid; });
  return m ? m.name : '';
}
/* What a row says about a split: who paid (subline) and how it was cut (the
   right-hand label). Null for a Chung row. */
function fhSpaceRowInfo(tx){
  var s = fhSpaceShareOf(tx && tx._dbId); if(!s) return null;
  var my = window.fhSpaceMyMemberId ? fhSpaceMyMemberId(fhSpaceActiveId()) : null;
  var payer = fhSpaceMemberName(s.payer);
  return { sub: payer ? (payer + ' ' + L('trả','paid')) : '',
    right: fhSplitLine(s, my, fmtK),
    bill: s.map._bill ? (L('Hoá đơn ','Bill ') + fmt(s.map._bill) + ' · ' + (s.map._parts - fhSplitMembers(s.map).length) + L(' phần ngoài nhóm',' outside')) : '' };
}

/* ── the space's money: balances and who pays whom ────────────────────────── */
var _SP_AV = [1,2,3,4,5,6];
function fhSpaceAvHTML(i, name){ return '<span class="dbt-av" style="background:var(--id-'+_SP_AV[i % 6]+')">'+esc(String(name||'?').charAt(0).toUpperCase())+'</span>'; }
function fhSpaceBalancesHTML(fid, onlyMine){
  if(!window.fhSpaceBalances) return '';
  var bal = fhSpaceBalances(fid), pairs = fhSpacePairwise(fid); if(!bal) return '';
  var my = fhSpaceMyMemberId(fid), d = fhSpacesData().data[fid];
  var h = '';
  if(!onlyMine){
    h += '<div class="dbt-sec">'+L('Số dư nhóm','Balances')+'</div><div class="dbt-card">';
    bal.forEach(function(b, i){
      var z = Math.abs(b.net) < 0.0005;
      if(b.member.gone && z) return;                       // someone who left square is no longer listed
      h += '<div class="dbt-mb">'+fhSpaceAvHTML(i, b.member.name)+'<span class="dbt-mbn">'+esc(b.member.name)
        + (b.member.id === my ? '<i class="dbt-you">'+L('bạn','you')+'</i>' : '') + (b.member.gone ? '<i class="dbt-you">'+L('đã rời','left')+'</i>' : '') + '</span>'
        + (z ? '<span class="dbt-mbv num">'+fmt(0)+'</span>'
             : (b.net > 0 ? '<span class="dbt-mbv num owed">+'+fmt(b.net)+'</span>' : '<span class="dbt-mbv num owe">−'+fmt(-b.net)+'</span>'))
        + '</div>';
    });
    pairs.forEach(function(p){ h += '<div class="dbt-pair">'+esc(p.from.name)+' '+L('trả','pays')+' '+esc(p.to.name)+'<span class="num">'+fmt(p.amt)+'</span></div>'; });
    if(!pairs.length) h += '<div class="dbt-note">'+L('Không ai nợ ai. Nhóm đã cân bằng.','Nobody owes anybody. The space is square.')+'</div>';
    return h + '</div>';
  }
  var mine = pairs.filter(function(p){ return p.to.id === my || p.from.id === my; });
  if(!mine.length) return '';
  h += '<div class="dbt-sec">'+L('Ai trả ai','Who pays whom')+'</div><div class="dbt-card">';
  mine.forEach(function(p){
    var other = p.to.id === my ? p.from : p.to, i = d.members.findIndex(function(m){ return m.id === other.id; });
    h += '<div class="dbt-mb">'+fhSpaceAvHTML(i, other.name)+'<span class="dbt-mbn">'
      + (p.to.id === my ? esc(other.name)+' '+L('trả bạn','pays you') : L('Bạn trả ','You pay ')+esc(other.name)) + '</span>'
      + (p.to.id === my ? '<span class="dbt-mbv num owed">'+fmt(p.amt)+'</span>' : '<span class="dbt-mbv num owe">'+fmt(p.amt)+'</span>') + '</div>';
  });
  return h + '</div>';
}
/* This month in the open space: what the space spent, what I paid, my share. */
function fhSpaceMonthSums(fid){
  var d = fhSpacesData().data[fid], my = fhSpaceMyMemberId(fid), o = { total:0, paid:0, share:0 };
  if(!d) return o;
  var ym = null;                                          // the month the tab is showing, else this one
  try{ var mm = (typeof M === 'function') ? M() : null; if(mm && mm._iso) ym = String(mm._iso).slice(0,7); }catch(e){}
  if(!ym){ var n = new Date(); ym = n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0'); }
  d.txns.forEach(function(tx){
    if(tx._unreadable || String(tx.date).slice(0,7) !== ym) return;
    o.total += tx.amt;
    var s = d.shares[tx.id];
    if(s && s.map){ if(s.payer === my) o.paid += tx.amt; o.share += Number(s.map[my]) || 0; }
  });
  return { total: fhK3(o.total), paid: fhK3(o.paid), share: fhK3(o.share) };
}
function _spNetLine(net){
  var z = Math.abs(net) < 0.0005;
  return z ? L('Đã cân bằng. Không ai nợ ai.','All square. Nobody owes anybody.')
    : (net > 0 ? L('Nhóm đang nợ bạn ','The space owes you ')+fmt(net)+'.' : L('Bạn đang nợ nhóm ','You owe the space ')+fmt(-net)+'.');
}
/* The block at the top of the money tab when the open space keeps balances. */
function fhSpaceSplitBoxRender(){
  var box = document.getElementById('sp-split-box'); if(!box) return;
  var fid = fhSpaceActiveId();
  if(!fid || !fhSpaceHas('split') || !window.fhSpacesData){ if(box.innerHTML) box.innerHTML = ''; return; }
  var S = fhSpacesData(), d = S.data[fid], h = '';
  if(!S.keys[fid] || !d){
    /* shares are read on the light path; ask for them, paint when they land */
    if(S.keys[fid] && window.fhSpaceHydrate && !fhSpaceSplitBoxRender._ask){ fhSpaceSplitBoxRender._ask = 1; fhSpaceHydrate(fid).then(function(){ fhSpaceSplitBoxRender._ask = 0; fhSpaceSplitBoxRender(); if(typeof renderTxns === 'function') renderTxns(); if(typeof renderHome === 'function') renderHome(); }, function(){ fhSpaceSplitBoxRender._ask = 0; }); }
    setHTMLIf(box, '<div class="dbt-note sp-pad">'+L('Đang tính số dư…','Working out the balances…')+'</div>');
    return;
  }
  var net = fhSpaceMyNet(fid), z = Math.abs(net) < 0.0005, closed = fhSpaceClosed();
  if(!fhSpaceIsFamily()){
    var m = fhSpaceMonthSums(fid);
    h += '<div class="cf-card sp-cf"><div class="cf-lbl">'+L('Cả nhóm đã chi tháng này','The space spent this month')+'</div>'
      + '<div class="cf-big num">'+fmt(m.total)+'</div>'
      + '<div class="cf-tiles">'
      + '<div class="cf-tile"><span class="cf-tl">'+L('Bạn đã trả','You paid')+'</span><span class="cf-tv num">'+fmt(m.paid)+'</span></div>'
      + '<div class="cf-tile"><span class="cf-tl">'+L('Phần của bạn','Your share')+'</span><span class="cf-tv num">'+fmt(m.share)+'</span></div></div>'
      + '<div class="cf-note">'+_spNetLine(net)+'</div></div>';
  } else {
    h += '<div class="dbt-hero2"><div class="dbt-hk">'+(z ? L('Chia tiền trong nhà','Splits in this family') : (net > 0 ? L('Cả nhà đang nợ bạn','The family owes you') : L('Bạn đang nợ cả nhà','You owe the family')))+'</div>'
      + (z ? '<div class="dbt-hs">'+L('Đã cân bằng.','All square.')+'</div>' : (net > 0 ? '<div class="dbt-hv num owed">'+fmt(net)+'</div>' : '<div class="dbt-hv num owe">'+fmt(-net)+'</div>')) + '</div>';
  }
  if(closed) h += '<div class="dbt-note sp-pad">'+L('Nhóm đã đóng. Vẫn xem được, không ghi thêm được.','This space is closed. You can still read it, but not add to it.')+'</div>';
  else if(fhSpacePairwise(fid).length) h += '<div class="dbt-acts"><button class="dbt-btn primary" type="button" onclick="fhSpaceSettleSheet(\''+fid+'\')">'+L('Ghi trả nợ','Record a settle-up')+'</button></div>';
  h += fhSpaceBalancesHTML(fid, false);
  if(d.settles && d.settles.length){
    h += '<div class="dbt-sec">'+L('Đã trả nợ','Settle-ups')+'</div><div class="dbt-card">';
    d.settles.slice(0, 6).forEach(function(s){
      var f = d.members.find(function(x){ return x.id === s.from; }), to = d.members.find(function(x){ return x.id === s.to; });
      h += '<button type="button" class="dbt-li sp-li" onclick="fhSpaceSettleRowSheet(\''+fid+'\',\''+s.id+'\')"><span class="dbt-lic">✅</span>'
        + '<span class="dbt-lib"><span class="dbt-lin">'+esc(f ? f.name : '?')+' '+L('trả','paid')+' '+esc(to ? to.name : '?')+'</span>'
        + '<span class="dbt-lis">'+esc(fmtDayMon(new Date(s.date+'T00:00:00')))+'</span></span>'
        + '<span class="dbt-liv num">'+(s._unreadable ? '—' : fmt(s.amt))+'</span></button>';
    });
    h += '</div>';
  }
  setHTMLIf(box, h);
}

/* ── the first tab when the house is off ──────────────────────────────────── */
function fhSpaceHomeRender(box){
  var sp = window.fhSpaceActive ? fhSpaceActive() : null, fid = fhSpaceActiveId();
  var S = window.fhSpacesData ? fhSpacesData() : null, d = S && S.data[fid];
  var names = (window.FAM && FAM.members ? FAM.members.map(function(m){ return m.name; }) : []);
  var sub = names.length > 4 ? (names.length + L(' thành viên',' members')) : names.join(', ');
  var gear = '<button class="hh-ic sp-gear" type="button" onclick="openSheet(\'sheet-theme\')" aria-label="'+L('Cài đặt','Settings')+'">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg></button>';
  /* the chip names the space and opens the others; the name gets the full width */
  var h = '<div class="safe"></div><div class="child-hdr"><div class="sp-home-top">'+fhSpaceChipHTML()+gear+'</div>'
    + '<div class="ch-row"><div><div class="ch-title">'+esc(fhSpaceName(sp))+'</div>'
    + (sub ? '<div class="ch-sub">'+esc(sub)+'</div>' : '') + '</div></div></div>';
  var closed = fhSpaceClosed();
  if(fhSpaceHas('split')){
    if(d){
      var net = fhSpaceMyNet(fid), z = Math.abs(net) < 0.0005;
      h += '<div class="dbt-hero2"><div class="dbt-hk">'+(z ? L('Nhóm đã cân bằng','The space is square') : (net > 0 ? L('Nhóm đang nợ bạn','The space owes you') : L('Bạn đang nợ nhóm','You owe the space')))+'</div>'
        + (z ? '<div class="dbt-hs">'+L('Không ai nợ ai.','Nobody owes anybody.')+'</div>'
             : (net > 0 ? '<div class="dbt-hv num owed">'+fmt(net)+'</div>' : '<div class="dbt-hv num owe">'+fmt(-net)+'</div>')) + '</div>';
    } else if(S && !S.keys[fid]){
      h += '<div class="dbt-hero2"><div class="dbt-hk">'+L('Nhóm đang khoá','This space is locked')+'</div><div class="dbt-hs">'+L('Nhập mã khóa của nhóm để đọc sổ.','Enter the space code to read it.')+'</div></div>';
    }
  }
  if(closed) h += '<div class="dbt-note sp-pad">'+L('Nhóm đã đóng. Vẫn xem được, không ghi thêm được.','This space is closed. You can still read it, but not add to it.')+'</div>';
  else h += '<div class="dbt-acts"><button class="dbt-btn primary" type="button" onclick="go(\'spending\');openExpense()">'+L('Ghi khoản chung','Log a shared expense')+'</button>'
    + (fhSpaceHas('split') ? '<button class="dbt-btn tinted" type="button" onclick="fhSpaceSettleSheet(\''+fid+'\')">'+L('Ghi trả nợ','Record a settle-up')+'</button>' : '') + '</div>';
  if(fhSpaceHas('split') && d) h += fhSpaceBalancesHTML(fid, true);
  var rows = (window.txns || []).filter(function(tx){ return !tx.future && tx.amt != null; }).slice(0, 5);
  h += '<div class="section-h"><span class="t">'+L('Mới đây','Recently')+'</span>'
    + (rows.length ? '<span class="acts"><a onclick="go(\'spending\');segTo(\'activity\')">'+L('Xem tất cả','See all')+'</a></span>' : '') + '</div>';
  if(rows.length && typeof txRow === 'function') h += '<div class="rows">'+rows.map(txRow).join('')+'</div>';
  else h += '<div class="dbt-note sp-pad">'+L('Chưa có khoản nào. Ghi khoản đầu tiên của nhóm nhé.','Nothing yet. Log the first expense of the space.')+'</div>';
  if(typeof rxHomeStripHTML === 'function' && fhSpaceHas('react')) h += rxHomeStripHTML();
  setHTMLIf(box, h);
}

/* ── a shared expense on its detail screen ────────────────────────────────── */
function _spSplitValue(s){
  if(!s) return L('Chung','Shared');
  var n = fhSplitMembers(s.map).length, parts = s.map._parts || n;
  return (s.rule === 'exact' && !s.map._parts) ? L('Chia · tự nhập','Split · typed amounts') : (L('Chia ','Split ')+parts+L(' phần',' ways'));
}
/* May this person change how the expense is counted? The one who recorded it
   and the one who paid (S22). */
function fhSpaceCanEditSplit(tx){
  var my = window.fhSpaceMyMemberId ? fhSpaceMyMemberId(fhSpaceActiveId()) : null;
  if(!my || fhSpaceClosed()) return false;
  var s = fhSpaceShareOf(tx._dbId);
  return tx._createdBy === my || (s ? s.payer === my : tx._memberId === my);
}
function fhSpaceSplitRowsHTML(tx){
  if(!fhSpaceHas('split') || !tx || !tx._dbId || typeof _exdRow !== 'function') return '';
  var s = fhSpaceShareOf(tx._dbId), my = fhSpaceMyMemberId(fhSpaceActiveId());
  var h = _exdRow({ label:L('Tính thế nào','How it counts'), ro:true, val:'<b>'+esc(_spSplitValue(s))+'</b>',
    by: (s && s.map._bill) ? (L('Hoá đơn ','Bill ')+fmt(s.map._bill)+' · '+fmt(s.map._out)+L(' ngoài nhóm',' outside the space')) : (s ? '' : L('Không ai nợ ai','Nobody owes anybody')) });
  if(!s) return h;
  fhSplitMembers(s.map).forEach(function(mid){
    h += _exdRow({ label:esc(fhSpaceMemberName(mid) || '?')+(mid === my ? ' · '+L('bạn','you') : ''), ro:true, val:'<b class="num">'+fmt(Number(s.map[mid]) || 0)+'</b>' });
  });
  return h;
}
function fhSpaceSplitEditRowHTML(tx){
  if(!fhSpaceHas('split') || !tx || !tx._dbId || typeof _exdRow !== 'function') return '';
  var s = fhSpaceShareOf(tx._dbId), can = fhSpaceCanEditSplit(tx);
  return _exdRow({ label:L('Tính thế nào','How it counts'), ro:!can, val:'<b>'+esc(_spSplitValue(s))+'</b>', fn:"fhSpaceEditSplitSheet('"+escAttr(String(tx.id))+"')",
    by: can ? '' : L('Người ghi hoặc người trả mới đổi được','Only whoever recorded or paid can change this') });
}
/* A counterparty as it is shown: a position against a space wears the space's name. */
function fhWhoLabel(who){
  if(typeof fhIsSpaceWho === 'function' && fhIsSpaceWho(who)){
    var sp = window.fhSpaceGet ? fhSpaceGet(fhSpaceWhoFid(who)) : null;
    return sp ? fhSpaceName(sp) : L('Nhóm','Space');
  }
  return who;
}