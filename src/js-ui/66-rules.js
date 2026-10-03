/* ═══ Quy tắc — rules for future rows (docs/specs/carry-rules-spec.md) ════════
   A rule is the carry extended to rows that have not arrived yet. It is made in
   the carry sheet with one switch, "Cả các khoản sau này", off by default; it
   PRE-FILLS matching waiting rows and never imports anything on its own (R1).

   rule = { id, k, dir, band, set, name, t }
     k     the carry's "similar" key (csvFixKey): 'p:'+payee, else 'w:'+wording|bank
     dir   'out' | 'in' — a rule only matches its own direction of money (R23)
     band  null for a merchant; the edited row's amount band for a person (R6)
     set   { scope, kind, cat, inccat, node, who } — any subset (R3); `kind` is
           the card's kind and its follow-up answer, as csvFixKindCopy reads it
     name  the payee as a person would say it, for the list and the sheet

   Precedence on a waiting row (R7, R17): the person's own pick on that card
   (c._hand) > a pin (values kept on that row after its rule changed) > the
   matching rule, banded before amount-free, newer before older > every machine
   tier. The pass runs AFTER the machine has filled the row, so it wins by being
   last, and remembers what it replaced (c._ruleSnap) so a deleted rule can put
   the machine's answer back.

   Storage is the encrypted lessons record (24-lessons.js); nothing here leaves
   the device unencrypted, and nothing writes to merchant_corrections (R16). */

var CSV_RULE_BANDS = { a:['dưới 50k','under 50k'], b:['50k–500k','50k–500k'], c:['500k–5tr','500k–5M'], d:['từ 5tr','5M and up'] };

/* ── matching ── */
function fhRuleIsP2P(counterparty, description){
  if(typeof fhLooksPersonToPerson !== 'function') return false;
  try{ return !!fhLooksPersonToPerson({ note:description||'', counterparty:counterparty||'', memo:description||'' }); }catch(e){ return false; }
}
function fhRuleBandOf(amountDong){
  return (typeof csvAmountBand === 'function') ? csvAmountBand(Math.abs(Number(amountDong)||0)) : 'a';
}
/* What a waiting queue card is matched on. Amount in đồng, as the card holds it. */
function csvRuleInput(c){
  if(!c || typeof csvFixKey !== 'function') return null;
  var k = csvFixKey(c); if(!k) return null;
  return { k:k, dir: c.isIncome ? 'in' : 'out', amount: Number(c.amount)||0 };
}
/* Per field, the best rule for this input: banded before amount-free, then the
   newer one. Two rules can each contribute a different field (R17). */
function fhRuleMatch(inp, rules){
  var out = {}; if(!inp || !inp.k) return out;
  var band = fhRuleBandOf(inp.amount);
  (rules||[]).forEach(function(r){
    if(!r || !r.set || r.k !== inp.k || r.dir !== inp.dir) return;
    if(r.band && r.band !== band) return;
    var score = r.band ? 1 : 0, t = r.t || 0;
    Object.keys(r.set).forEach(function(f){
      if(r.set[f] == null || r.set[f] === '') return;
      var cur = out[f];
      if(!cur || score > cur.score || (score === cur.score && t > cur.t)) out[f] = { v:r.set[f], id:r.id, score:score, t:t };
    });
  });
  return out;
}
function fhRulesList(){ return (typeof window.fhRulesAll === 'function') ? (window.fhRulesAll() || []) : []; }

/* ── writing a rule's value onto a queue card: exactly what the carry writes ── */
function csvRuleKindSnap(c){
  return { cur:csvRowKindCur(c), isTransfer:!!c.isTransfer, xfer:!!c._xfer, repay:!!c._repay, loan:!!c._loan, invest:!!c._invest,
           payCardId:(c._hand && c._hand.paycard) ? (c._payCardId||null) : null, xferOtherId:c._xferOtherId||null,
           repayWho:c._repayWho||null, loanWho:c._loanWho||null, investPosId:c._investPosId||null };
}
/* A stand-in card that csvFixKindCopy can copy the kind from. */
function csvRuleKindCard(k, r){
  return { isIncome:!!r.isIncome, isTransfer:!!k.isTransfer, _xfer:!!k.xfer, _repay:!!k.repay, _loan:!!k.loan, _invest:!!k.invest,
           _payCardId:k.payCardId||null, _xferOtherId:k.xferOtherId||null, _repayWho:k.repayWho||null, _loanWho:k.loanWho||null,
           _investPosId:k.investPosId||null, _hand: k.payCardId ? { paycard:1 } : {} };
}
/* Does this value make sense on this card as it stands? The carry's own limits
   (csvFixRowsFor): a category on a repayment is not a thing, a node must ride
   the row's kind, a personal-only kind needs the personal ledger unlocked. */
function csvRuleFits(c, f, v){
  if(f === 'scope') return v === 'family' || (v === 'personal' && (typeof csvScopeReady !== 'function' || csvScopeReady()));
  if(f === 'kind'){
    if(!v || !v.cur) return false;
    if(v.cur !== 'expense' && v.cur !== 'income' && typeof csvScopeReady === 'function' && !csvScopeReady()) return false;
    return (v.cur === 'income') === !!c.isIncome || (v.cur !== 'expense' && v.cur !== 'income');
  }
  if(f === 'who') return true;
  if(csvFixKindRow(c)) return false;
  if(f === 'cat') return !c.isIncome && !!v;
  if(f === 'inccat') return !!c.isIncome && !!v;
  if(f === 'node'){
    if(!v || !window.FH_TAX || !FH_TAX.get(v)) return false;
    var nk = FH_TAX.kindOf(v), rk = c.isIncome ? 'income' : 'expense';
    return nk === rk || (rk === 'expense' && nk === 'transfer');
  }
  return false;
}
function csvRuleWrite(c, f, v){
  if(f === 'node'){ c._node = v; c._nodeSource = 'rule'; }
  else if(f === 'cat'){ c.categoryName = v; c.catSource = 'rule'; }
  else if(f === 'inccat'){ c._incomeCat = v; }
  else if(f === 'who'){ c.who = v; }
  else if(f === 'kind'){ csvFixKindCopy(c, csvRuleKindCard(v, c)); }   // sets _kindPicked: the "máy đoán" tag goes, the row's own attention flags stay
  else if(f === 'scope'){ c._scope = v; if(v !== 'personal') csvScopeClearKinds(c); }
}
function csvRuleValOf(c, f){
  if(f === 'node') return c._node || null;
  if(f === 'cat') return c.categoryName || null;
  if(f === 'inccat') return c._incomeCat || null;
  if(f === 'who') return c.who || null;
  if(f === 'kind') return csvRuleKindSnap(c);
  if(f === 'scope') return csvRowScope(c);
  return null;
}
/* One card: pins first (they beat the rule for that one row), then the match. */
function csvRuleApplyOne(c, rules, pins){
  if(!c || c.isSummaryRow) return false;
  var m = fhRuleMatch(csvRuleInput(c), rules);
  var pin = c._stagedId && pins && pins[c._stagedId];
  if(pin && pin.set) Object.keys(pin.set).forEach(function(f){ m[f] = { v:pin.set[f], id:'_pin' }; });
  var any = false;
  CSV_FIX_ORDER.forEach(function(f){
    var hit = m[f]; if(!hit) return;
    if(c._hand && c._hand[f]) return;
    if(!csvRuleFits(c, f, hit.v)) return;
    var snaps = c._ruleSnap || (c._ruleSnap = {});
    if(!snaps[f]) snaps[f] = csvFixSnap(c, f);
    csvRuleWrite(c, f, hit.v);
    (c._rule || (c._rule = {}))[f] = hit.id;
    any = true;
  });
  return any;
}
/* Put back what the machine said, for the fields a rule (or pin) filled and the
   person has not touched since. Reverse order: scope and kind share a snapshot. */
function csvRuleUnwrite(c, which){
  if(!c || !c._rule) return;
  CSV_FIX_ORDER.slice().reverse().forEach(function(f){
    var id = c._rule[f]; if(!id || (which && which.indexOf(id) < 0)) return;
    if(c._hand && c._hand[f]) return;
    if(c._ruleSnap && c._ruleSnap[f]) csvFixRestore(c, c._ruleSnap[f]);
    delete c._rule[f];
    if(c._ruleSnap) delete c._ruleSnap[f];
  });
}
/* The queue's pass (72 calls it after every build, once each card carries its
   staged id). `readable` is the page of waiting rows: a pin whose row is no
   longer waiting is dropped, but only when the page holds the whole queue. */
function csvRulesApplyQueue(readable){
  if(!window.csvStagedMode || !window.csvReview) return 0;
  var rules = fhRulesList(), pins = (typeof window.fhRulePins === 'function') ? window.fhRulePins() : {};
  if(readable && typeof window.fhRulePinDrop === 'function' && Object.keys(pins).length
     && !(typeof window.fhStagedTotal === 'number' && window.fhStagedTotal > readable.length)){
    var live = {}; readable.forEach(function(r){ if(r && r.id) live[r.id] = 1; });
    var gone = Object.keys(pins).filter(function(id){ return !live[id]; });
    if(gone.length){ window.fhRulePinDrop(gone); gone.forEach(function(id){ delete pins[id]; }); }
  }
  if(!rules.length && !Object.keys(pins).length) return 0;
  var n = 0;
  csvFixCandidates().forEach(function(c){ if(csvRuleApplyOne(c, rules, pins)) n++; });
  return n;
}
window.csvRulesApplyQueue = csvRulesApplyQueue;

/* The rule behind a field on this card, when the card still shows it. */
function csvRuleMarkOf(c, f){
  var id = c && c._rule && c._rule[f];
  if(!id || id === '_pin') return null;
  if(c._hand && c._hand[f]) return null;
  return id;
}
function csvRuleMarked(c){
  return !!(c && c._rule && CSV_FIX_ORDER.some(function(f){ return !!csvRuleMarkOf(c, f); }));
}
/* The second line under a value a rule set. Tapping it opens the rule; the row
   itself still opens its picker. */
function csvRuleLineHTML(c, f){
  var id = csvRuleMarkOf(c, f); if(!id) return '';
  return '<span class="rl-by" role="link" onclick="event.stopPropagation();fhRuleOpen(\''+escAttr(id)+'\')">'+esc(L('Theo quy tắc','By rule'))+'</span>';
}

/* ── the queue's summary (R20) ── */
function csvRulesRows(){
  if(!window.csvStagedMode || !window.csvReview) return [];
  return csvStagedSelected().filter(function(c){ return csvRuleMarked(c) && !(typeof csvFxUnresolved === 'function' && csvFxUnresolved(c)); });
}
function csvRulesSumHTML(){
  var rows = csvRulesRows(); if(!rows.length) return '';
  var n = rows.length;
  return '<div class="rl-sum"><span>'+esc(L(n+' khoản theo quy tắc', n+' by your rules'))+'</span>'
    + '<button type="button" onclick="csvRulesImport()">'+esc(L('Nhập '+n+' khoản','Import '+n))+'</button></div>';
}
/* Import exactly those rows: the selection is borrowed for one call, as
   csvImportOne does, and put back whether the write lands or not. */
window.csvRulesImport = async function(){
  if(!window.csvReview || !window.csvStagedMode || !window.fhPromoteStaged) return;
  var open = (typeof csvExpandedCandidate === 'function') ? csvExpandedCandidate() : null;
  if(open && typeof csvReadEditor === 'function') csvReadEditor(open);
  var rows = csvRulesRows(); if(!rows.length) return;
  csvRowSheet = null; csvExpand = null;
  var stash = csvReview.ready.map(function(r){ return [r, !!r._skipImport]; });
  csvReview.ready.forEach(function(r){ r._skipImport = rows.indexOf(r) < 0; });
  try { await fhPromoteStaged(); }
  finally {
    stash.forEach(function(p){ if(rows.indexOf(p[0]) < 0) p[0]._skipImport = p[1]; });
    if(window.csvReview && document.getElementById('csv-result')) renderCsvReview();
  }
};

/* ── words ── */
function fhRuleBandLbl(b){ var x = CSV_RULE_BANDS[b]; return x ? L(x[0], x[1]) : ''; }
function fhRuleValLbl(f, v, dir){
  if(v == null || v === '') return '';
  if(f === 'node') return (window.FH_TAX && FH_TAX.get(v)) ? FH_TAX.get(v).vi : '';
  if(f === 'cat') return (typeof csvCatLabel === 'function') ? csvCatLabel(v) : String(v);
  if(f === 'inccat') return String(v);
  if(f === 'scope') return v === 'personal' ? L('Cá nhân','Personal') : L('Gia đình','Family');
  if(f === 'who') return v === 'Both' ? L('Chung','Both') : String(v);
  if(f === 'kind'){
    var lbl = (typeof csvKindLbl === 'function') ? csvKindLbl({ isIncome: dir === 'in' }, v.cur) : '';
    lbl = String(lbl).replace(/^[^\wÀ-ỹ]+\s*/, '');                   // the list reads words, not icons
    var sub = v.loanWho || v.repayWho || '';
    return sub ? (lbl+' · '+sub) : lbl;
  }
  return String(v);
}
/* "Chi 500k–5tr" / "Thu" — what the rule matches, without the name. */
function fhRuleMatchLbl(r){
  var d = r.dir === 'in' ? L('Thu','In') : L('Chi','Out');
  return r.band ? (d+' '+fhRuleBandLbl(r.band)) : d;
}
function fhRuleValsLbl(set, dir){
  return CSV_FIX_ORDER.map(function(f){ return set && set[f] != null ? fhRuleValLbl(f, set[f], dir) : ''; }).filter(Boolean).join(', ');
}
/* The switch's second line (R11): "Chi 500k–5tr cho TRAN MINH KHOA: Nhà ở, Tiền nhà". */
function fhRuleSentence(r){
  var who = r.name ? (' '+L('cho','to')+' '+r.name) : '';
  if(r.dir === 'in') who = r.name ? (' '+L('từ','from')+' '+r.name) : '';
  return fhRuleMatchLbl(r) + who + ': ' + fhRuleValsLbl(r.set, r.dir);
}
/* The list's second line: "Chi 500k–5tr · Nhà ở, Tiền nhà". */
function fhRuleSub(r){ return fhRuleMatchLbl(r) + ' · ' + fhRuleValsLbl(r.set, r.dir); }

/* ── making one from a carry ── */
function fhRuleNewId(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
/* The rule a carry would make or change: same key, same direction, same band. */
function fhRuleFind(k, dir, band){
  var hit = null;
  fhRulesList().forEach(function(r){ if(r.k === k && r.dir === dir && (r.band || null) === (band || null)) hit = r; });
  return hit;
}
/* From a queue card and its carried fields. */
function csvRuleDraft(c){
  var fx = c && c._fix, inp = csvRuleInput(c); if(!fx || !inp) return null;
  var set = {};
  CSV_FIX_ORDER.forEach(function(f){
    if(!fx.items[f]) return;
    var v = (f === 'kind') ? csvRuleKindSnap(c) : fx.items[f].v;
    if(v != null && v !== '') set[f] = v;
  });
  if(!Object.keys(set).length) return null;
  var p2p = fhRuleIsP2P(c.counterparty, c.description);
  var name = (typeof csvFixPayeeName === 'function' && csvFixPayeeName(c)) || String(c.description||'').trim().slice(0, 32);
  return { k:inp.k, dir:inp.dir, band: p2p ? fhRuleBandOf(inp.amount) : null, set:set, name:name };
}
/* Save a draft: a new rule, or the matching one with these fields replaced.
   Returns { id, prev } — prev is the rule as it was (null when new), for undo. */
function fhRuleCommit(d){
  if(!d || typeof window.fhRuleSave !== 'function') return null;
  var old = fhRuleFind(d.k, d.dir, d.band), prev = old ? JSON.parse(JSON.stringify(old)) : null;
  var r = old ? JSON.parse(JSON.stringify(old)) : { id:fhRuleNewId(), k:d.k, dir:d.dir, band:d.band||null, set:{}, name:d.name||'' };
  Object.keys(d.set).forEach(function(f){ r.set[f] = d.set[f]; });
  if(d.name && !r.name) r.name = d.name;
  window.fhRuleSave(r);
  return { id:r.id, prev:prev };
}
function fhRuleRevert(u){
  if(!u || !u.id) return;
  if(u.prev) window.fhRuleSave && window.fhRuleSave(u.prev);
  else window.fhRuleDelete && window.fhRuleDelete(u.id);
}
/* A rule can only be kept where the encrypted record can be written: the
   personal ledger unlocked. Elsewhere nothing offers one, rather than offering a
   switch that would quietly not survive the session. */
function fhRulesUsable(){ return typeof window.fhPersonalKeyReady === 'function' && !!window.fhPersonalKeyReady() && typeof window.fhRuleSave === 'function'; }
/* The carry sheet's rule block (fhCarryBodyHTML m.rule). */
function fhRuleBlock(d, on, tap){
  if(!d || !fhRulesUsable()) return null;
  var old = fhRuleFind(d.k, d.dir, d.band);
  var show = old ? Object.assign({}, old, { set:Object.assign({}, old.set, d.set) }) : d;
  return { title:L('Khoản sau này','Later rows'), label: old ? L('Đổi quy tắc','Change the rule') : L('Cả các khoản sau này','All later rows too'),
           sub: fhRuleSentence(show), on: !!on, tap: tap };
}

/* ── the queue card's carry (56 csvFixSheetHTML / csvFixSheetGo / csvFixUnapply) ── */
function csvFixRuleBlock(c){
  var fx = c && c._fix; if(!fx || !window.csvStagedMode) return null;     // the file import is not where rules apply (R28)
  if(fx.rule) return { title:L('Khoản sau này','Later rows'), done: fx.rule.prev ? L('Đã đổi quy tắc','Rule changed') : L('Đã tạo quy tắc','Rule added'),
                       link: fx.busy ? null : { label:L('Hoàn tác','Undo'), tap:'csvFixRuleUndo('+fx.id+')' } };
  return fhRuleBlock(csvRuleDraft(c), fx.ruleOn, 'csvFixRuleToggle('+fx.id+')');
}
function csvFixRuleToggle(id){ var c = csvFixes[id]; if(c && c._fix && !c._fix.busy){ c._fix.ruleOn = !c._fix.ruleOn; renderCsvReview(); } }
function csvFixRuleSave(c){
  var fx = c && c._fix; if(!fx || !fx.ruleOn) return null;
  var u = fhRuleCommit(csvRuleDraft(c));
  fx.ruleOn = false;
  if(u) fx.rule = u;
  return u;
}
function csvFixRuleUndo(id){
  var c = csvFixes[id]; if(!c || !c._fix || !c._fix.rule) return;
  fhRuleRevert(c._fix.rule); c._fix.rule = null;
  window.toast && toast(L('Đã hoàn tác','Undone'));
  renderCsvReview();
}
/* The door with nothing to carry to yet: a payee seen for the first time. */
function csvFixRuleDoor(c){
  var fx = c && c._fix; if(!fx || !window.csvStagedMode) return '';
  if(fx.rule) return '<button type="button" class="csv-cta-sec done" onclick="csvFixSheetOpen('+fx.id+')"><span>'+esc(fx.rule.prev ? L('Đã đổi quy tắc','Rule changed') : L('Đã tạo quy tắc','Rule added'))+'</span></button>';
  if(!csvRuleDraft(c) || !fhRulesUsable()) return '';
  return '<button type="button" class="csv-cta-sec" onclick="csvFixSheetOpen('+fx.id+')"><span>'+esc(L('Áp dụng cho khoản sau này','Apply to later rows'))+'</span></button>';
}
window.csvFixRuleToggle = csvFixRuleToggle; window.csvFixRuleUndo = csvFixRuleUndo;

/* ── from a ledger row (61): Danh mục and Tiêu vào gì of a private expense ── */
function fhRuleDraftLedger(t, fields, name){
  if(!t || typeof csvPatternKey !== 'function') return null;
  var k = csvPatternKey({ counterparty:t.who||'', description:t.note||'' }); if(!k || k.length < 6) return null;
  var set = {};
  if(fields.cat) set.cat = fields.cat;
  if(fields.node) set.node = fields.node;
  if(!Object.keys(set).length) return null;
  var amt = (Number(t.amt)||0) * ((typeof curMult === 'function') ? curMult() : 1000);
  return { k:'p:'+k, dir:'out', band: fhRuleIsP2P(t.who, t.note) ? fhRuleBandOf(amt) : null, set:set, name:name||'' };
}

/* ═══ The list and the rule's screen (#rule-modal) ═════════════════════════════
   Its own full-screen modal, above the review queue (z 66), so it opens the same
   way from Cài đặt, from the queue's Chỉnh sửa and from a card's "Theo quy tắc". */
var _rl = { view:'list', id:null, draft:null, open:null, as:null, forgetArmed:false, t:null };
function _rlEl(id){ return document.getElementById(id); }
function fhRulesOpen(){
  _rl = { view:'list', id:null, draft:null, open:null, as:null, forgetArmed:false, t:null };
  var go = function(){ _rlRender(); _rlShow(); };
  if(typeof window.fhRulesReady === 'function') window.fhRulesReady().then(go, go); else go();
}
function fhRuleOpen(id){
  var r = window.fhRuleGet ? window.fhRuleGet(id) : null;
  if(!r){ window.toast && toast(L('Quy tắc này không còn','This rule is gone')); return; }
  _rl = { view:'rule', id:id, draft:JSON.parse(JSON.stringify(r)), open:null, as:null, forgetArmed:false, t:null, solo:true };
  _rlRender(); _rlShow();
}
function _rlShow(){
  var m = _rlEl('rule-modal'); if(!m) return;
  var s = _rlEl('scrim'); if(s) s.classList.add('on');
  m.classList.add('on'); m.style.transform = ''; m.style.transition = '';
  var b = _rlEl('rl-body'); if(b) b.scrollTop = 0;
}
function fhRulesClose(){
  var m = _rlEl('rule-modal'); if(m){ m.classList.remove('on'); m.classList.remove('picking'); m.style.transform = ''; }
  _rl.as = null;
  if(!document.querySelector('.sheet.on, .modal.on')){ var s = _rlEl('scrim'); if(s) s.classList.remove('on'); }
  if(window.csvReview && document.getElementById('csv-result') && window.csvStagedMode) renderCsvReview();
}
function fhRulesBack(){
  if(_rl.view === 'rule' && !_rl.solo){ _rl.view = 'list'; _rl.id = null; _rl.draft = null; _rl.open = null; _rl.as = null; _rlRender(); return; }
  fhRulesClose();
}
function _rlNav(){
  var back = _rlEl('rl-back'), title = _rlEl('rl-title'), save = _rlEl('rl-save');
  var CH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>';
  if(_rl.view === 'list'){
    if(back) back.textContent = L('Xong','Done');
    if(title) title.textContent = L('Quy tắc','Rules');
    if(save){ save.style.visibility = 'hidden'; save.textContent = ''; }
  } else {
    if(back) back.innerHTML = _rl.solo ? esc(L('Đóng','Close')) : (CH+'<span>'+esc(L('Quy tắc','Rules'))+'</span>');
    if(title) title.textContent = '';
    if(save){ save.style.visibility = ''; save.disabled = false; save.textContent = L('Lưu','Save'); }
  }
}
function _rlRender(){
  _rlNav();
  var b = _rlEl('rl-body'); if(!b) return;
  b.innerHTML = (_rl.view === 'list') ? _rlListHTML() : _rlRuleHTML();
  var as = _rlEl('rl-as'); if(as) as.innerHTML = _rl.as ? _rlAsHTML(_rl.as) : '';
}
var _RL_CHEV = '<svg class="rl-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
function _rlListHTML(){
  var rules = fhRulesList().slice().sort(function(a, b){ return String(a.name||'').localeCompare(String(b.name||''), 'vi'); });
  var routes = (typeof csvTxrRoutes !== 'undefined') ? csvTxrRoutes : {};
  var banks = Object.keys(routes).filter(function(k){ return routes[k] === 'personal' || routes[k] === 'family'; }).sort();
  var h = '';
  if(!rules.length && !banks.length){
    h += '<div class="rl-empty"><b>'+esc(L('Chưa có quy tắc nào','No rules yet'))+'</b>'
      + '<span>'+esc(L('Khi áp dụng một thay đổi cho khoản giống, bật "Cả các khoản sau này" để các khoản sau tự điền như vậy.','When you apply a change to similar rows, turn on "All later rows too" and later rows arrive filled in the same way.'))+'</span></div>';
  }
  if(rules.length){
    h += '<div class="rl-sec">'+esc(L('Theo người nhận','By payee'))+'</div><div class="rl-list">';
    rules.forEach(function(r){
      h += '<button type="button" class="rl-row" onclick="fhRulesPick(\''+escAttr(r.id)+'\')"><span class="rl-t"><b>'+esc(r.name || L('Cùng nội dung','Same wording'))+'</b>'
        + '<small>'+esc(fhRuleSub(r))+'</small></span>'+_RL_CHEV+'</button>';
    });
    h += '</div>';
  }
  if(banks.length){
    h += '<div class="rl-sec">'+esc(L('Theo ngân hàng','By bank'))+'</div><div class="rl-list">';
    banks.forEach(function(p){
      var v = routes[p];
      var seg = function(x, lbl){ return '<button type="button" class="rl-seg'+(v === x ? ' on' : '')+'" onclick="fhRulesRoute(\''+escAttr(p)+'\',\''+x+'\')">'+esc(lbl)+'</button>'; };
      h += '<div class="rl-row"><span class="rl-t"><b>'+esc(p)+'</b></span><span class="rl-segs">'+seg('personal', L('Cá nhân','Personal'))+seg('family', L('Gia đình','Family'))+'</span></div>';
    });
    h += '</div><div class="rl-foot">'+esc(L('Mọi khoản từ ngân hàng này vào sổ đã chọn, trừ khi quy tắc theo người nhận nói khác.','Every row from this bank goes to the chosen ledger, unless a payee rule says otherwise.'))+'</div>';
  }
  var n = _rlLessonCount();
  if(n){
    h += '<div class="rl-lessons"><span>'+esc(L('App tự nhớ thêm '+n+' gợi ý từ những lần bạn sửa.','The app also remembers '+n+' suggestions from your edits.'))+'</span> '
      + '<button type="button" class="rl-forget'+(_rl.forgetArmed ? ' armed' : '')+'" onclick="fhRulesForget()">'+esc(_rl.forgetArmed ? L('Chạm lần nữa để quên hết','Tap again to forget all') : L('Quên hết','Forget all'))+'</button></div>';
  }
  return h;
}
function _rlLessonCount(){
  var n = (typeof window.fhLessonsCount === 'function') ? (window.fhLessonsCount() || 0) : 0;
  try{ if(typeof csvLearned !== 'undefined' && csvLearned) n += Object.keys(csvLearned).filter(function(k){ return k.indexOf('|') > 0; }).length; }catch(e){}
  return n;
}
function fhRulesForget(){
  if(!_rl.forgetArmed){
    _rl.forgetArmed = true; _rlRender();
    clearTimeout(_rl.t); _rl.t = setTimeout(function(){ _rl.forgetArmed = false; if(_rl.view === 'list') _rlRender(); }, 3000);
    return;
  }
  clearTimeout(_rl.t); _rl.forgetArmed = false;
  var n = _rlLessonCount();
  if(typeof window.fhLessonsForgetAll === 'function') window.fhLessonsForgetAll();
  if(typeof csvLearnForget === 'function') csvLearnForget();
  window.toast && toast(L('Đã quên '+n+' gợi ý','Forgot '+n+' suggestions'));
  _rlRender();
}
function fhRulesRoute(p, v){
  if(typeof csvEditRoute === 'function') csvEditRoute(p, v);
  else if(typeof csvTxrRoutes !== 'undefined'){ csvTxrRoutes[p] = v; if(typeof csvTxrRouteSave === 'function') csvTxrRouteSave(); }
  _rlRender();
}
function fhRulesPick(id){
  var r = window.fhRuleGet ? window.fhRuleGet(id) : null; if(!r) return;
  _rl.view = 'rule'; _rl.id = id; _rl.draft = JSON.parse(JSON.stringify(r)); _rl.open = null; _rl.as = null; _rl.solo = false;
  _rlRender();
  var b = _rlEl('rl-body'); if(b) b.scrollTop = 0;
}

/* ── one rule ── */
function _rlRuleFields(r){
  var out = ['scope'];
  if(r.set.kind) out.push('kind');
  out.push(r.dir === 'in' ? 'inccat' : 'cat');
  out.push('node');
  if(r.set.who || r.set.scope === 'family') out.push('who');    // who paid is a family-ledger question
  return out;
}
function _rlFieldLbl(f, r){
  if(f === 'scope') return L('Ghi vào đâu','Where to');
  if(f === 'kind') return L('Loại khoản','Kind');
  if(f === 'cat' || f === 'inccat') return L('Danh mục','Category');
  if(f === 'node') return r.dir === 'in' ? L('Tiền từ đâu','Where it came from') : L('Tiêu vào gì','What it was');
  if(f === 'who') return L('Ai trả','Who paid');
  return f;
}
function _rlRuleHTML(){
  var r = _rl.draft; if(!r) return '';
  var NC = L('Không đổi','No change');
  var h = '<div class="rl-head"><b>'+esc(r.name || L('Cùng nội dung','Same wording'))+'</b>'
    + '<small>'+esc((r.dir === 'in' ? L('Khoản thu','Money in') : L('Khoản chi','Money out')) + (r.band ? ' '+fhRuleBandLbl(r.band) : ''))+'</small></div>';
  h += '<div class="rl-card">';
  _rlRuleFields(r).forEach(function(f){
    var v = r.set[f], val = (v != null && v !== '') ? fhRuleValLbl(f, v, r.dir) : NC;
    if(f === 'cat' && v) val = ((window.catStyle && catStyle[v]) || ['🏷️'])[0]+' '+val;      // as the card shows it
    if(f === 'scope' && v) val = (v === 'personal' ? '🔒 ' : '🏡 ')+val;
    var tap = (f === 'node') ? 'fhRuleNodeOpen()' : 'fhRuleRow(\''+f+'\')';
    h += '<button type="button" class="rl-frow'+(_rl.open === f ? ' open' : '')+((v == null || v === '') ? ' soft' : '')+'" onclick="'+tap+'"><small>'+esc(_rlFieldLbl(f, r))+'</small>'
      + '<span class="rl-fv"><b>'+esc(val)+'</b>'+_RL_CHEV+'</span></button>';
    if(_rl.open === f) h += '<div class="rl-fold"><div class="choices">'+_rlChoices(f, r)+'</div></div>';
  });
  h += '</div>';
  /* What it matches: the direction is fixed (R23); a person's rule can widen to
     any amount, never narrow to a band it was not made on. */
  var b0 = r.band0 || r.band;
  h += '<div class="rl-card"><button type="button" class="rl-frow'+(_rl.open === 'band' ? ' open' : '')+'"'+(b0 ? ' onclick="fhRuleRow(\'band\')"' : '')+'><small>'+esc(L('Khớp khi','Matches'))+'</small>'
    + '<span class="rl-fv"><b>'+esc(fhRuleMatchLbl(r) + (r.band ? '' : ' · '+L('mọi số tiền','any amount')))+'</b>'+(b0 ? _RL_CHEV : '')+'</span></button>';
  if(_rl.open === 'band' && b0){
    h += '<div class="rl-fold"><div class="choices">'
      + '<button type="button" class="choice'+(r.band ? ' on' : '')+'" onclick="fhRuleBand(\''+b0+'\')">'+esc(fhRuleBandLbl(b0))+'</button>'
      + '<button type="button" class="choice'+(!r.band ? ' on' : '')+'" onclick="fhRuleBand(\'\')">'+esc(L('Mọi số tiền','Any amount'))+'</button></div></div>';
  }
  h += '</div>';
  h += '<button type="button" class="rl-del'+(_rl.delArmed ? ' armed' : '')+'" onclick="fhRuleDel()">'+esc(_rl.delArmed ? L('Chạm lần nữa để xoá','Tap again to delete') : L('Xoá quy tắc','Delete rule'))+'</button>';
  return h;
}
function _rlChoices(f, r){
  var cur = r.set[f], NC = L('Không đổi','No change');
  var chip = function(val, lbl, on){ return '<button type="button" class="choice'+(on ? ' on' : '')+'" onclick="fhRuleSet(\''+f+'\','+(val === null ? 'null' : '\''+escAttr(val)+'\'')+')">'+esc(lbl)+'</button>'; };
  var h = chip(null, NC, cur == null || cur === '');
  if(f === 'scope'){ h += chip('personal', L('🔒 Cá nhân','🔒 Personal'), cur === 'personal') + chip('family', L('🏡 Gia đình','🏡 Family'), cur === 'family'); }
  else if(f === 'kind'){ if(cur) h += '<button type="button" class="choice on">'+esc(fhRuleValLbl('kind', cur, r.dir))+'</button>'; }
  else if(f === 'cat'){
    var cats = ((window.catOrder || []).slice());
    if(cur && cats.indexOf(cur) < 0) cats.unshift(cur);
    cats.forEach(function(c){ h += chip(c, ((window.catStyle && catStyle[c]) || ['🏷️'])[0]+' '+c, cur === c); });
  }
  else if(f === 'inccat'){ (typeof FH_INCOME_CATS !== 'undefined' ? FH_INCOME_CATS : []).forEach(function(c){ h += chip(c, c, cur === c); }); }
  else if(f === 'who'){
    ((window.FAM && FAM.members) || []).forEach(function(m){ var n = m && (m.name || m); if(n) h += chip(n, n, cur === n); });
    h += chip('Both', L('Chung','Both'), cur === 'Both');
  }
  return h;
}
function fhRuleRow(f){ _rl.open = (_rl.open === f) ? null : f; _rlRender(); }
function fhRuleSet(f, v){
  var r = _rl.draft; if(!r) return;
  if(f === 'kind'){ if(v === null) delete r.set.kind; }
  else if(v === null) delete r.set[f]; else r.set[f] = v;
  _rl.open = null; _rlRender();
}
function fhRuleBand(b){
  var r = _rl.draft; if(!r) return;
  if(!r.band0) r.band0 = r.band;
  r.band = b || null; _rl.open = null; _rlRender();
}
function fhRuleNodeOpen(){
  var r = _rl.draft; if(!r || typeof fhNodePickOpen !== 'function') return;
  var m = _rlEl('rule-modal'); if(m) m.classList.add('picking');
  var sh = _rlEl('sheet-node-pick'); if(sh) sh.style.zIndex = '67';
  fhNodePickOpen(r.set.node || null, r.dir === 'in' ? 'income' : 'expense', 'fhRuleNodePicked');
}
function fhRuleNodePicked(code){
  var m = _rlEl('rule-modal'); if(m) m.classList.remove('picking');
  var sh = _rlEl('sheet-node-pick'); if(sh) sh.style.zIndex = '';
  var r = _rl.draft; if(!r) return;
  if(code) r.set.node = code; else delete r.set.node;
  var s = _rlEl('scrim'); if(s) s.classList.add('on');
  _rlRender();
}
window.fhRuleNodePicked = fhRuleNodePicked;

/* ── waiting rows a rule filled, in the queue as last built this session ── */
function csvRuleWaiting(id){
  if(!window.csvStagedMode || !window.csvReview || typeof csvFixCandidates !== 'function') return [];
  return csvFixCandidates().filter(function(c){ return CSV_FIX_ORDER.some(function(f){ return csvRuleMarkOf(c, f) === id; }); });
}
/* Keep what those rows show now: a pin per row, for the fields the rule set. */
function csvRulePinRows(rows, id){
  if(typeof window.fhRulePinSet !== 'function') return;
  rows.forEach(function(c){
    var set = {};
    CSV_FIX_ORDER.forEach(function(f){ if(csvRuleMarkOf(c, f) === id) set[f] = csvRuleValOf(c, f); });
    if(c._stagedId && Object.keys(set).length) window.fhRulePinSet([c._stagedId], set);
    Object.keys(set).forEach(function(f){ c._rule[f] = '_pin'; });
  });
}
/* Fill those rows again from what is left (or from the rule's new values). */
function csvRuleRefill(rows, id){
  var rules = fhRulesList(), pins = (typeof window.fhRulePins === 'function') ? window.fhRulePins() : {};
  rows.forEach(function(c){ csvRuleUnwrite(c, [id]); csvRuleApplyOne(c, rules, pins); });
}
function fhRuleDel(){
  var id = _rl.id; if(!id) return;
  var rows = csvRuleWaiting(id);
  if(rows.length){ _rl.as = { kind:'del', n:rows.length }; _rlRender(); return; }
  if(!_rl.delArmed){
    _rl.delArmed = true; _rlRender();
    clearTimeout(_rl.t); _rl.t = setTimeout(function(){ _rl.delArmed = false; if(_rl.view === 'rule') _rlRender(); }, 3000);
    return;
  }
  clearTimeout(_rl.t); _rl.delArmed = false;
  _rlDelete(id, 'refill');
}
function _rlDelete(id, how){
  var rows = csvRuleWaiting(id);
  if(how === 'keep') csvRulePinRows(rows, id);
  window.fhRuleDelete && window.fhRuleDelete(id);
  if(how !== 'keep') csvRuleRefill(rows, id);
  window.toast && toast(L('Đã xoá quy tắc','Rule deleted'));
  _rl.as = null;
  if(_rl.solo){ fhRulesClose(); return; }
  _rl.view = 'list'; _rl.id = null; _rl.draft = null; _rl.open = null;
  _rlRender();
}
function fhRuleSaveTap(){
  if(_rl.view !== 'rule' || !_rl.draft) return;
  var r = _rl.draft, cur = window.fhRuleGet ? window.fhRuleGet(r.id) : null;
  if(!cur){ fhRulesBack(); return; }
  if(!Object.keys(r.set).length){ fhRuleDel(); return; }          // a rule that sets nothing is a deleted rule
  var same = JSON.stringify(cur.set) === JSON.stringify(r.set) && (cur.band || null) === (r.band || null);
  if(same){ fhRulesBack(); return; }
  var rows = csvRuleWaiting(r.id);
  if(rows.length){ _rl.as = { kind:'edit', n:rows.length }; _rlRender(); return; }
  _rlSave('refill');
}
function _rlSave(how){
  var r = _rl.draft; if(!r) return;
  var rows = csvRuleWaiting(r.id);
  if(how === 'keep') csvRulePinRows(rows, r.id);
  var save = Object.assign({}, r); delete save.band0;
  window.fhRuleSave && window.fhRuleSave(save);
  if(how !== 'keep') csvRuleRefill(rows, r.id);
  window.toast && toast(L('Đã lưu quy tắc','Rule saved'));
  _rl.as = null;
  if(_rl.solo){ fhRulesClose(); return; }
  _rl.view = 'list'; _rl.id = null; _rl.draft = null; _rl.open = null;
  _rlRender();
}
/* The choice (R24, R27): an action sheet, only when rows are waiting. */
function _rlAsHTML(a){
  var n = a.n, msg = L(n+' khoản đang chờ đã theo quy tắc này.', n+' waiting rows were filled by this rule.');
  var b1, b2, t1, t2, title, cls = '';
  if(a.kind === 'del'){ title = L('Xoá quy tắc này?','Delete this rule?'); cls = ' dgr';
    b1 = L('Xoá và xếp lại '+n+' khoản','Delete and refill '+n+' rows'); t1 = 'fhRuleAs(\'refill\')';
    b2 = L('Xoá, giữ '+n+' khoản như cũ','Delete, keep '+n+' rows as they are'); t2 = 'fhRuleAs(\'keep\')';
  } else { title = L('Lưu thay đổi?','Save changes?');
    b1 = L('Đổi cả '+n+' khoản','Change all '+n+' rows'); t1 = 'fhRuleAs(\'refill\')';
    b2 = L('Chỉ từ khoản sau','Only later rows'); t2 = 'fhRuleAs(\'keep\')';
  }
  return '<div class="rl-as-scrim" onclick="fhRuleAs(\'\')"></div><div class="rl-as" role="dialog" aria-label="'+escAttr(title)+'">'
    + '<div class="rl-as-grp"><div class="rl-as-msg"><b>'+esc(title)+'</b><small>'+esc(msg)+'</small></div>'
    + '<button type="button" class="rl-as-btn'+cls+'" onclick="'+t1+'">'+esc(b1)+'</button>'
    + '<button type="button" class="rl-as-btn'+cls+'" onclick="'+t2+'">'+esc(b2)+'</button></div>'
    + '<button type="button" class="rl-as-cancel" onclick="fhRuleAs(\'\')">'+esc(L('Huỷ','Cancel'))+'</button></div>';
}
function fhRuleAs(how){
  var a = _rl.as; _rl.as = null;
  if(!a || !how){ _rlRender(); return; }
  if(a.kind === 'del') _rlDelete(_rl.id, how); else _rlSave(how);
}
window.fhRulesOpen = fhRulesOpen; window.fhRuleOpen = fhRuleOpen; window.fhRulesClose = fhRulesClose; window.fhRulesBack = fhRulesBack;
window.fhRulesPick = fhRulesPick; window.fhRulesRoute = fhRulesRoute; window.fhRulesForget = fhRulesForget;
window.fhRuleRow = fhRuleRow; window.fhRuleSet = fhRuleSet; window.fhRuleBand = fhRuleBand; window.fhRuleNodeOpen = fhRuleNodeOpen;
window.fhRuleDel = fhRuleDel; window.fhRuleSaveTap = fhRuleSaveTap; window.fhRuleAs = fhRuleAs;

/* ── quick review (76, R28): the same rules over its one row ──
   The key is built from the raw staged row the way csvFixKey builds it from a
   card: the payee when there is one, else the wording from the same bank.
   Returns { m:{field:{v,id}}, full:bool } — full when the rule sets a kind only
   the full queue can show (a loan, a transfer): that row goes there instead. */
function fhRuleKeyRaw(o){
  if(typeof csvPatternKey !== 'function') return '';
  var k = csvPatternKey({ counterparty:o.counterparty||'', description:o.description||'' });
  if(k && k.length >= 6) return 'p:'+k;
  var s = String(o.description||'').toLowerCase().replace(/\d+/g,' ').replace(/\s+/g,' ').trim();
  if(s.length < 6) return '';
  var p = o.provider ? ((typeof fhProviderName === 'function') ? fhProviderName(o.provider) : o.provider) : '';
  return 'w:'+s+'|'+(p||'');
}
window.fhRuleForQuick = function(o){
  var k = fhRuleKeyRaw(o||{}); if(!k) return null;
  var m = fhRuleMatch({ k:k, dir:o.dir, amount:o.amount }, fhRulesList());
  var pins = (typeof window.fhRulePins === 'function') ? window.fhRulePins() : {};
  var pin = o.stagedId && pins[o.stagedId];
  if(pin && pin.set) Object.keys(pin.set).forEach(function(f){ m[f] = { v:pin.set[f], id:'_pin' }; });
  if(!Object.keys(m).length) return null;
  var kv = m.kind && m.kind.v;
  return { m:m, full: !!(kv && kv.cur && kv.cur !== 'expense' && kv.cur !== 'income') };
};

/* Drag-down closes the rules and nothing under them (the review queue stays). */
(function(){ if(typeof document === 'undefined') return; var m = document.getElementById('rule-modal'); if(m && typeof initSheetDrag === 'function') initSheetDrag(m, fhRulesClose); })();
