/* ---- Category tree: the two layers (category-tree-spec.md) -------------------
   L1 = the system tree (FH_TAX, generated). L2 = the person's/family's own labels,
   each a PARTITION of L1: a label CLAIMS node codes (a claim covers the whole
   subtree), the most specific claim wins, and the catch-all label claims '*'.
   A row stores its L1 node (`node`) and, as today, its label (the family
   category / the personal label); the node gives the label its default at
   write time and the person can override the label per row.

   Everything here is pure and global (js-ui): no DOM, no network, no key. Data
   comes in as arguments or from the globals hydrate maintains:
     window.catClaims   {categoryName: [codes]}     family partition (30-hydrate.js)
     window.P.labels    [{id,name,emoji,claims:[codes]}] personal partition (19-personal.js)
   Kill switch (C8): localStorage 'fh-tree' === 'off' hides every tree surface. */
function fhTreeOn(){ try{ return localStorage.getItem('fh-tree')!=='off'; }catch(e){ return true; } }
function fhNodeOk(code){ return !!(code && typeof FH_TAX!=='undefined' && FH_TAX.get(code)); }
function fhNodeVi(code){ var n=fhNodeOk(code)?FH_TAX.get(code):null; return n?n.vi:''; }
function fhNodePath(code){ return fhNodeOk(code)?FH_TAX.pathVi(code):[]; }
function fhNodeKind(code){ return fhNodeOk(code)?FH_TAX.kindOf(code):null; }
function fhNodeGroup(code){ return fhNodeOk(code)?FH_TAX.root(code):null; }
/* Which label owns a node. `labels` = [{key, claims:[codes]}]; the label whose claim
   is the closest ancestor (or the node itself) wins; '*' is the catch-all; null
   when nothing claims it and there is no catch-all. */
function fhLabelForNode(node, labels){
  if(!labels||!labels.length) return null;
  var chain=fhNodeOk(node)?[node].concat(FH_TAX.ancestors(node)):[];   // self, parent, …, root
  var best=null, bestDepth=-1, star=null;
  for(var i=0;i<labels.length;i++){
    var L=labels[i], cl=L.claims||[];
    for(var j=0;j<cl.length;j++){
      if(cl[j]==='*'){ if(!star) star=L; continue; }
      var d=chain.indexOf(cl[j]);                    // 0 = exact node, 1 = parent, …
      if(d>=0){ var depth=chain.length-d; if(depth>bestDepth){ bestDepth=depth; best=L; } }
    }
  }
  return best||star;
}
/* Family side: category NAME for a node, from window.catClaims. Falls back to the
   catch-all category (CAT_FALLBACK) so a node never lands outside the budget. */
function fhFamilyLabelFor(node){
  var cc=window.catClaims||{}, arr=[], k;
  for(k in cc) arr.push({key:k, claims:cc[k]});
  var hit=fhLabelForNode(node, arr);
  if(hit) return hit.key;
  return (typeof CAT_FALLBACK==='string')?CAT_FALLBACK:'Others';
}
/* Personal side: the label OBJECT for a node from P.labels, or null (no labels yet). */
function fhPersonalLabelFor(node){
  var P=window.fhPersonalData?fhPersonalData():null, ls=(P&&P.labels)||[];
  return fhLabelForNode(node, ls.map(function(l){ return {key:l.id, claims:l.claims||[], label:l}; })) ;
}
/* Default claims for an existing/new label from its name + emoji: the tree's own
   labels and keywords resolve the name to a GROUP or CATEGORY code (never a leaf —
   a label named "Ăn uống" should own the whole group). Returns [] when nothing
   matches; the catch-all name returns ['*']. Used by the migration backfill of
   today's categories and by "add a category" in the budget sheet. */
function fhDefaultClaimsFor(name, emoji, kind){
  kind=kind||'expense';
  /* The catch-all owns the root. Recognised by NAME here as well as through
     20-budget's helper: this file must answer correctly even when it is the only
     thing loaded (the tests do exactly that), and "the catch-all claims
     everything else" is a property of the partition, not of the budget sheet. */
  var _fb=(typeof CAT_FALLBACK==='string')?CAT_FALLBACK:'Others';
  if(String(name||'').trim().toLowerCase()===_fb.toLowerCase()) return ['*'];
  if(typeof isFallbackCat==='function' && isFallbackCat(name)) return ['*'];
  var d=FH_TAX.deburr(name||'').replace(/[^a-z0-9]+/g,' ').trim(), nodes=FH_TAX.nodes, i, best=null;
  // 1. exact label match (vi or en), shallowest wins
  for(i=0;i<nodes.length;i++){ var n=nodes[i]; if(n.kind!==kind||n.depth>2) continue;
    if(FH_TAX.deburr(n.vi)===d||FH_TAX.deburr(n.en)===d){ if(!best||n.depth<best.depth) best=n; } }
  if(best) return [best.code];
  // 2. keyword hit, lifted to depth ≤ 2
  var code=d?FH_TAX.keywordNode(d, kind):null;
  if(code){ var n2=FH_TAX.get(code); while(n2&&n2.depth>2) n2=FH_TAX.get(n2.parent); if(n2) return [n2.code]; }
  // 3. emoji match against the tree's default emojis for groups
  var EM={'🏠':'home','🏡':'home','💡':'home','🧾':'home','🛒':'groceries','🥬':'groceries','🍽️':'eatout','🍜':'eatout','🍔':'eatout','☕':'drinks','🍲':'eatout','🚗':'transport','🚕':'transport','🛵':'transport','⛽':'transport','🛍️':'shopping','👕':'clothing','👗':'clothing','🎉':'leisure','🎮':'leisure','🎬':'leisure','💊':'health','🏥':'health','💄':'beauty','📚':'education','🎓':'education','🎁':'giving','🐶':'pets','🐱':'pets','💼':'work','✈️':'travel','🏋️':'fitness','🧾':'fees','🏦':'fees'};
  if(emoji&&EM[emoji]&&FH_TAX.get(EM[emoji])) return [EM[emoji]];
  return [];
}
/* The coarse node a LABEL implies (T6, "the label the person tapped"): its single
   claimed group/category when it has exactly one non-star claim; null when the label
   spans several groups (Con cái) or is the catch-all. */
function fhNodeFromClaims(claims){
  var real=(claims||[]).filter(function(c){ return c!=='*' && fhNodeOk(c); });
  if(!real.length) return null;                       // the catch-all, or a label that claims nothing
  if(real.length===1) return real[0];
  /* Several claims still say something when they share an ancestor: a label
     claiming eatout + drinks means "food", which is a true if coarse answer.
     Claims across different groups (a "Con cái" spanning food and school) share
     nothing, and null is then the honest reply. */
  var chain=[real[0]].concat(FH_TAX.ancestors(real[0]));
  for(var i=1;i<real.length;i++){
    var other=[real[i]].concat(FH_TAX.ancestors(real[i]));
    chain=chain.filter(function(c){ return other.indexOf(c)>=0; });
    if(!chain.length) return null;
  }
  return chain[0]||null;                              // deepest shared ancestor
}
/* Client-side node guess for one row. Tiers, in order (T3 registry is server-side):
   T4 personal lesson (window.fhLessonNode, from 24-lessons.js) → T2 keywords on
   note + counterparty + memo → T6 the label's implied group → (unless whatOnly)
   who was paid: fhWhoNode = seller mark → p2p → null.
   input: {kind, note, counterparty, memo, amount, labelClaims} */
function fhNodeGuess(input){
  input=input||{}; var kind=input.kind||'expense';
  if(kind==='repayment') return null;                        // inherits the loan's node
  try{ if(window.fhLessonNode){ var l=fhLessonNode(input); if(fhNodeOk(l)&&FH_TAX.kindOf(l)===kind) return l; } }catch(e){}
  var text=[input.note, input.counterparty, input.memo].filter(Boolean).join(' | ');
  var k=text?FH_TAX.keywordNode(text, kind):null;
  if(k) return k;
  var c=fhNodeFromClaims(input.labelClaims);
  if(c && FH_TAX.kindOf(c)===kind) return c;
  /* Everything above says WHAT was bought. What follows only says WHO was paid,
     which is vaguer than any of it. A caller that still has WHAT-evidence of its
     own to try (the server's concept hint, the person's label) passes whatOnly
     and asks fhWhoNode LAST. Shipping the who-tier inside this function, ahead of
     those, turned 29 Grab rows hinted "Đi lại" into "Thanh toán cho người bán"
     and a supermarket into "Công ty & cửa hàng" (2026-09-21). */
  if(input.whatOnly) return null;
  return fhWhoNode(input);
}
/* The last resort: nothing says what was bought, so say who was paid. A seller
   mark is asked before the p2p shape, because a shop with a person's name and a
   friend look the same to fhLooksPersonToPerson. */
function fhWhoNode(input){
  input=input||{}; if((input.kind||'expense')!=='expense') return null;
  var s=fhSellerSignal(input); if(s) return s;
  return fhLooksPersonToPerson(input)?'p2p':null;
}
/* The legacy eight concepts, lifted to the tree GROUP that carries each. A
   concept is exactly a group's worth of confidence, so it lands on the group and
   never pretends to a leaf. One table for every lane that reads a server hint. */
var _CONCEPT_GROUP={ Housing:'home', Groceries:'groceries', Clothing:'clothing', Shopping:'shopping',
  Transport:'transport', Dining:'food', Fun:'leisure', Others:null };
function fhConceptGroup(concept){ var g=_CONCEPT_GROUP[concept]; return fhNodeOk(g)?g:null; }
/* ── Who was paid: a seller, by the marks only a payment system leaves ─────────
   Measured on two real mailboxes (research/category-patterns.html): 143 of 273
   yearly transfers in one and 56 of 158 in the other carry at least one of these
   marks, and not one of them also carries a person-to-person note ("cam on anh",
   "li xi"). None of it reads the payee's NAME for meaning, so none of it is
   about one user's shops.
     · the beneficiary account is a VIRTUAL account (a collection service issued
       it; a personal account is all digits),
     · the account name is a legal entity (the bank set it from the licence),
     · the memo was written by a till, not typed by a hand.
   Returns 'bizpay' when the name is a legal entity, 'purchase' for any other
   mark, null otherwise. An unknown prefix is NOT a mark: a missing rule makes the
   answer shallower, never wrong. [\dX] because some transports mask digits. */
var _VA_RX=[/^99MM[\dX]/,/^99ZP[\dX]/,/^ZLP[\dX]{6}/,/^9627952[\dX]/,/^9990018[\dX]/,/^9990009[\dX]/,
  /^MS0[\dX][PT][\dX]{6}/,/^VQRQ[A-Z0-9]{4}/i,/^(PHATLOC|LOCPHAT)[\dX]{3}/,/^(V3)?KOV[\dX]{3}/,/^MWGVN/,
  /^AGBVMSP/,/^(PMC|PSP)[\dX]{10}/,/^MD18[\dX]{10}/,/^[\dX]{6,}QR[A-Z]{3}[\dX]{2}$/,/^MB?999[\dX]{6}/,
  /^962NPS/,/^HE1TINGEE/,/^[A-Z0-9]{8,}VCB$/];
var _PSP_NAME_RX=/(^|[\s|\-])(momo_|zalopay_|payoo[ _\-*])/;
var _BIZ_RX=/\b(cong ty|cty|ct tnhh|ct cp|tnhh|co phan|hkd|ho kinh doanh|dntn|doanh nghiep tu nhan|company|limited|corporation|jsc|co ltd|cua hang|nha thuoc|tiem)\b/;
var _TILL_MEMO_RX=[/^tt hd\b/,/^\d{5} [a-z0-9]{5}$/,/^qr[a-z0-9]{6}tt\b/,/^kovqr[a-z0-9]+$/,/^(vqrloamb|mbts)[a-z0-9]+$/,
  /^[a-z0-9]{15} \d{9}$/,/\bthanh toan qrcode tai\b/,/^thanh toan cho .+\([^)]+\)$/];
function fhSellerSignal(input){
  input=input||{};
  var segs=[], i, j;
  [input.note,input.counterparty,input.memo].forEach(function(v){
    String(v||'').split('|').forEach(function(x){ x=x.trim(); if(x) segs.push(x); }); });
  if(!segs.length) return null;
  var flat=FH_TAX.deburr(segs.join(' | '));
  if(/\bngan hang\b/.test(flat)) return null;               // an issuer's name: a repayment, not a shop
  var mark=false;
  if(_PSP_NAME_RX.test(flat)) mark=true;
  for(i=0;i<segs.length && !mark;i++){
    var toks=segs[i].split(/\s+-\s+|\s+/);
    for(j=0;j<toks.length && !mark;j++){
      var tk=toks[j].replace(/[.,;:]+$/,'');
      if(tk.length<8 || !/[\dX]/.test(tk)) continue;
      for(var k=0;k<_VA_RX.length;k++) if(_VA_RX[k].test(tk)){ mark=true; break; }
    }
  }
  for(i=0;i<segs.length && !mark;i++){
    var m=FH_TAX.deburr(segs[i]).replace(/\s+/g,' ').trim();
    for(j=0;j<_TILL_MEMO_RX.length;j++) if(_TILL_MEMO_RX[j].test(m)){ mark=true; break; }
  }
  var words=flat.replace(/[^a-z0-9]+/g,' ');
  if(_BIZ_RX.test(words)) return 'bizpay';
  /* No brand rules here. Grab was one for a day ("rides AND food, so at least a
     purchase") and it was wrong in practice: the server already hints Grab as
     Transport, which says more than "paid to a seller" does, and this answered
     first. A brand belongs in the keywords or nowhere. */
  return mark?'purchase':null;
}
/* Transfer-to-a-human phrasing, kept deliberately narrow: the bank's own verb
   ("chuyển tiền/chuyển khoản đến"), a QR payment marker, or a counterparty that
   is a bare account-number-and-name pair. A merchant name never matches, and a
   keyword hit has already answered before this runs. */
var _P2P_RE=/\b(chuyen tien|chuyen khoan|chuyen qua|ck den|ck cho|thanh toan qr|qrcode|chuyen tien nhanh)\b/;
function fhLooksPersonToPerson(input){
  var text=FH_TAX.deburr([input.note,input.counterparty,input.memo].filter(Boolean).join(' '))
    .replace(/[^a-z0-9]+/g,' ').trim();
  if(!text) return false;
  if(_P2P_RE.test(' '+text+' ')) return true;
  /* The payee field on its own, in either bank's order: VIB "ACCOUNT - NAME", MB
     "NAME - ACCOUNT". Joined behind a typed memo ("Cam on anh | 1361… - LE KHA
     NIN") the account no longer opens the string, and those rows got nothing. */
  var cp=FH_TAX.deburr(String(input.counterparty||'')).replace(/[^a-z0-9]+/g,' ').trim();
  if(cp && (/^[a-z]*\d[a-z0-9]{5,}\s+[a-z]+\s+[a-z]+/.test(cp) || /^[a-z]+(\s+[a-z]+)+\s+[a-z]*\d[a-z0-9]{5,}$/.test(cp))) return true;
  /* "13610000120606 - LE KHA NIN | Cam on a Lam hehe": an account number and a
     person's name, which is how every VN bank writes a p2p counterparty — and
     then whatever the sender typed. Anchoring the whole string meant any memo at
     all defeated it, and a memo is exactly what these rows carry. */
  if (/^\d{6,}\s+[a-z]+\s+[a-z]+/.test(text)) return true;
  /* "VQRQ0001oqplk - VO DINH PHUC": a QR reference rather than an account
     number, then the same person's name. The reference always carries digits,
     which is what separates it from a merchant ("AEON NGUYEN VAN LINH"). */
  return /^[a-z]*\d[a-z0-9]*\s+[a-z]+\s+[a-z]+(\s|$)/.test(text);
}
/* The tree row a person has tapped: null = everything, a code = that node and
   everything under it, '_none' = the rows the tree could not place. Chart,
   breakdown and transaction list all read this one variable, so the three can
   never disagree about what is on screen. */
window.fhNodeSel = null;
function fhNodeSelMatch(node){
  var sel = window.fhNodeSel; if (!sel) return true;
  if (sel === '_none') return !node || !FH_TAX.get(node);
  /* '=code' is the node ITSELF with none of its children: the rows the tree
     placed in a group but could not place under any leaf in it. That set is the
     whole point of the "chưa rõ chi tiết" line, and it is not expressible as a
     subtree match. */
  if (sel.charAt(0) === '=') return node === sel.slice(1);
  if (!node) return false;
  return node === sel || FH_TAX.ancestors(node).indexOf(sel) >= 0;
}
/* The code a selection is about, exact or not. */
function fhNodeSelCode(){
  var sel = window.fhNodeSel;
  if (!sel || sel === '_none') return null;
  return sel.charAt(0) === '=' ? sel.slice(1) : sel;
}
/* What to call the current selection in a chip or a header. */
function fhNodeSelLabel(){
  var sel = window.fhNodeSel; if (!sel) return '';
  if (sel === '_none') return L('Chưa rõ', 'Not sure yet');
  /* Named at the level that IS known, same as the row it came from. */
  if (sel.charAt(0) === '=') { var e = FH_TAX.get(sel.slice(1)); return e ? e.vi : ''; }
  var n = FH_TAX.get(sel); return n ? n.vi : '';
}
/* DOES THIS ROW COUNT AS SPENDING? The ledger holds a row as kind='expense'
   because that is how the bank reported it, but the tree may know better: money
   moved to your own account, a card paid off, a wallet topped up. Those keep a
   transfer node, and every total that claims to be "spending" has to ask this
   one question, or the header and the breakdown drift apart — which is exactly
   what they did. Unknown or unset node = spending, so nothing new is hidden. */
function fhCountsAsSpending(node){
  if (!node || typeof FH_TAX === 'undefined') return true;
  /* The tree's kill switch has to restore the old numbers too, or turning it
     off leaves totals that nothing on screen explains any more. */
  if (!fhTreeOn()) return true;
  var n = FH_TAX.get(node);
  return !n || n.kind === 'expense';
}
/* ...and of the rows that are NOT spending, which ones actually took cash out
   of the spendable pool? Paying a card down does: that money is gone. Moving
   money between your own accounts, topping up a wallet, taking cash out of an
   ATM, putting money in savings — all still yours, so "Còn lại" must not move.
   Mirrors the loan and investment dents that already exist here. */
function fhXferCashOut(node){
  return node === 'cardpay';
}
/* Same name on both sides of the bank's verb: "CAO THÁI DUY HIỂN chuyen tien
   den CAO THAI DUY HIEN - 1046382279". Money between your own two accounts. */
function fhLooksSelfTransfer(text){
  var m=FH_TAX.deburr(String(text||'').toLowerCase());
  var mm=m.match(/(.+?)\s+chuyen\s+(?:tien|khoan)\s+(?:den|toi|cho|sang)\s+(.+)/);
  if(!mm) return false;
  var norm=function(s){ return s.replace(/\s*[-–:|].*$/,'').replace(/\d+/g,' ').replace(/[^a-z ]+/g,' ').replace(/\s+/g,' ').trim(); };
  var a=norm(mm[1]), b=norm(mm[2]);
  return a.length>=6 && a===b;
}
/* A row whose words say "this was not spending" and which transfer node it is.
   Only the shapes real mail actually produces, so nothing here guesses. */
function fhTransferShape(text, amount){
  var t=' '+FH_TAX.deburr(String(text||'').toLowerCase()).replace(/[^a-z0-9]+/g,' ').trim()+' ';
  if(fhLooksSelfTransfer(text)) return 'bankbank';
  if(/ (thanh toan the tin dung|tra no the|thanh toan sao ke the|tt the tin dung) /.test(t)) return 'cardpay';
  /* The bank's own payment-confirmation mail names the BANK as the counterparty
     and carries no memo at all, which is how ten of them read as spending. */
  if(/ (ngan hang tmcp|ngan hang thuong mai) /.test(t)) return 'cardpay';
  if(/ (nap tien vao vi|nap vi|nap tien vao vi dien tu) /.test(t)) return 'wallet';
  if(/ (rut tien mat|rut tien tai atm) /.test(t)) return 'cashout';
  if(/ (gui tiet kiem|mo so tiet kiem|tat toan so) /.test(t)) return 'savings';
  /* A P2P exchange desk dictates the memo: the order number and nothing else.
     Twenty digits exactly is an order id no person types and no till prints (a
     till's are shorter or mixed with letters). The second shape is one desk's
     "<sender> chuyen tien <6 digits>", kept only with an amount no person rounds
     to, because the same words with a round figure could be anyone. Every real
     row was confirmed by its owner: funding an investment, not spending. */
  var segs=String(text||'').split('|'), i;
  for(i=0;i<segs.length;i++){
    var m=FH_TAX.deburr(segs[i]).replace(/\s+/g,' ').trim();
    if(/^\d{20}$/.test(m)) return 'investfund';
    if(/^[a-z ]{6,40} chuyen tien \d{6}$/.test(m) && amount>=1e6 && amount%1000!==0) return 'investfund';
  }
  return null;
}
/* ── Is a LOGGED row's node worth copying onto a new row with the same words? ──
   The review reads the ledger as evidence: "a row called this already carries a
   node". That is only evidence when the node says WHAT was bought. A who-node
   (người bán, công ty, p2p) says nothing about the goods, and a node the row's
   own label contradicts is a machine's old guess, not a person's answer — the
   v565 sweep wrote "Thanh toán cho người bán" onto every logged Grab row, and
   for a day every new Grab card inherited it from step 2 while steps 5 and 6
   knew better (2026-09-22). `claims` is the row's label's claim list, or null. */
var _WHO_NODES={p2p:1,purchase:1,bizpay:1,seller:1};
function fhIsWhoNode(code){ return !!_WHO_NODES[code]; }
function fhNodeIsEvidence(node, claims){
  if(!fhNodeOk(node) || _WHO_NODES[node]) return false;
  var lab=fhNodeFromClaims(claims||[]);
  if(!lab) return true;                                   // a label that implies nothing cannot contradict
  if(node===lab) return true;
  return FH_TAX.ancestors(node).indexOf(lab)>=0;          // deeper inside the label's group is still agreement
}
/* A logged row a who-node DISPLACED: its label claims a real category and the node
   ignores it. These are repaired first, before the idle sweep's ordinary walk. */
function fhNodeDisplaced(node, claims){
  if(!fhNodeOk(node) || !_WHO_NODES[node]) return false;
  var lab=fhNodeFromClaims(claims||[]);
  return !!(lab && !_WHO_NODES[lab]);
}
/* ── A node decided elsewhere, checked against the tree as it stands NOW ───────
   The mailbox worker seals a node on every row from ITS copy of the keywords, and
   that copy only changes when the worker is redeployed. A keyword retired here
   (because it filed real rows wrongly) would keep arriving sealed, ahead of every
   tier that knows better. So: a sealed node is dropped when the text carries a
   retired keyword for exactly that node AND today's keywords no longer agree. A
   model's answer, a registry hit, or a keyword still in the tree all pass.
   `sweep` marks the entries safe to re-file in rows ALREADY in the ledger: "tien
   nha" is not, because some of those rows really are rent and their owner said so.
   A sealed 'p2p' also yields to a seller mark: the worker has no such rule yet. */
var _RETIRED_KW=[[/\btien nha\b/,['rent','rentpay'],false],[/\bdzine\b/,['software'],true],[/\bclaude\b/,['software'],true],
  [/\bpizza\b/,['fastfood'],true],[/\bdien may xanh\b/,['appliance'],true],[/\bphi quan ly\b/,['mgmt'],true]];
function fhPipeNodeOk(node, input, sweepOnly){
  if(!fhNodeOk(node)) return null;
  input=input||{};
  var text=[input.note,input.counterparty,input.memo].filter(Boolean).join(' | ');
  var flat=' '+FH_TAX.deburr(text).replace(/[^a-z0-9]+/g,' ').trim()+' ', i;
  for(i=0;i<_RETIRED_KW.length;i++){
    var e=_RETIRED_KW[i];
    if(e[1].indexOf(node)<0 || !e[0].test(flat) || (sweepOnly && !e[2])) continue;
    var now=FH_TAX.keywordNode(text, FH_TAX.kindOf(node));
    if(now!==node && FH_TAX.ancestors(now||'').indexOf(node)<0) return null;
  }
  if(node==='p2p' && !sweepOnly && fhSellerSignal(input)) return null;
  return node;
}
/* ── Codes a payment SYSTEM assigned, read before any word is ─────────────────
   A card statement carries the merchant's MCC (ISO 18245) on every line and a
   MoMo statement names the receiving SERVICE ("m4b_vtti…_airtime"). Neither
   depends on how a shop spells itself, neither costs a model call, and both were
   being dropped: MCC only reached the eight legacy concepts, the service id
   reached nothing. Each code stops at the deepest level it can vouch for — 5812
   is restaurants AND delivery, so it answers "eating out" and no leaf.
   input: {mcc, svc, desc, out}  (out = money left the account) */
var _MCC_NODE={'5812':'eatout','5811':'eatout','5814':'fastfood','5813':'alcohol','5411':'groceries','5499':'groceries',
  '5462':'dessert','5541':'fuel','5542':'fuel','4121':'ridehail','7523':'parking','4111':'public','4511':'flight',
  '7011':'hotel','5912':'pharmacy','8011':'clinic','8062':'clinic','8021':'dental','5651':'clothes','5691':'clothes',
  '5661':'shoes','5944':'jewelry','5732':'tech','5734':'software','5045':'computer','4814':'mobile','4899':'tv',
  '4900':'utilities','7832':'cinema','5815':'entertainment','5816':'games','5817':'games','5818':'entertainment',
  '5942':'books','5941':'hobby','7997':'gym','7230':'hair','7298':'spa','5977':'cosmetics','8211':'tuition',
  '8220':'tuition','8299':'courses','5995':'pets','0742':'vet','6300':'insurance','9311':'tax','6012':'cardpay',
  '5399':'shopping','5311':'shopping','5310':'shopping'};
var _SVC_NODE=[[/^(m4b_vtti.*(topupdata|airtime)|vms2\.airtime)/,'mobile'],[/^ecomcgvcinema/,'cinema'],[/^mp_\d+_/,'split']];
var _SVC_NODE_IN=[[/^accounting_mm$/,'wage'],[/^kgs_/,'cashback'],[/^[a-z]{2,6}\d*\.[\d.]*bank$/,'wallet']];
function fhStructNode(input){
  input=input||{}; if(typeof FH_TAX==='undefined') return null;
  var out=input.out!==false, desc=String(input.desc||''), d=FH_TAX.deburr(desc).replace(/\s+/g,' ').trim(), i, k=null;
  if(out){
    /* A fee line inherits the MCC of the purchase it rode in on ("Phí Giao Dịch
       Ngoại Tệ | 5734-Computer Software"), so the words must answer first. */
    k=FH_TAX.keywordNode(desc,'expense');
    if(k && (k==='fees' || FH_TAX.ancestors(k).indexOf('fees')>=0)) return k;
  }
  var svc=String(input.svc||'').trim().toLowerCase();
  if(svc){
    var tbl=out?_SVC_NODE:_SVC_NODE_IN;
    for(i=0;i<tbl.length;i++) if(tbl[i][0].test(svc)) return tbl[i][1];
  }
  if(!out){
    if(/^nhan thiep tu /.test(d)) return 'giftmoney';
    if(/^nhan luong tu /.test(d)) return 'wage';
    if(/^hoan tien giao dich/.test(d)) return 'purchaserefund';
    return null;
  }
  var mcc=(String(input.mcc||'').match(/\d{4}/)||[''])[0], byCode=null;
  if(mcc){
    var n=+mcc;
    byCode=_MCC_NODE[mcc] || ((n>=3000 && n<=3299)?'flight':(n>=3500 && n<=3999)?'hotel':null);
  }
  /* The code sets the BRANCH; a keyword may go deeper inside it, never sideways.
     5812 says "eating out" and the name "Foody" says which kind: delivery. A
     keyword that points somewhere else loses to the code. */
  if(byCode && k && FH_TAX.ancestors(k).indexOf(byCode)>=0) return k;
  return byCode;
}
/* Depth reached by a row, for the coverage metric: 3 leaf · 2 category · 1 group · 0 none. */
function fhNodeDepth(code){ var n=fhNodeOk(code)?FH_TAX.get(code):null; if(!n) return 0; return FH_TAX.isLeaf(code)?3:n.depth; }