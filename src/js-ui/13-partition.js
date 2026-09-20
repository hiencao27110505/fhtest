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
   note + counterparty + memo → T6 the label's implied group → null.
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
  if(kind==='expense' && fhLooksPersonToPerson(input)) return 'p2p';
  return null;
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
  if (!node) return false;
  return node === sel || FH_TAX.ancestors(node).indexOf(sel) >= 0;
}
/* What to call the current selection in a chip or a header. */
function fhNodeSelLabel(){
  var sel = window.fhNodeSel; if (!sel) return '';
  if (sel === '_none') return L('Chưa rõ', 'Not sure yet');
  var n = FH_TAX.get(sel); return n ? n.vi : '';
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
function fhTransferShape(text){
  var t=' '+FH_TAX.deburr(String(text||'').toLowerCase()).replace(/[^a-z0-9]+/g,' ').trim()+' ';
  if(fhLooksSelfTransfer(text)) return 'bankbank';
  if(/ (thanh toan the tin dung|tra no the|thanh toan sao ke the|tt the tin dung) /.test(t)) return 'cardpay';
  /* The bank's own payment-confirmation mail names the BANK as the counterparty
     and carries no memo at all, which is how ten of them read as spending. */
  if(/ (ngan hang tmcp|ngan hang thuong mai) /.test(t)) return 'cardpay';
  if(/ (nap tien vao vi|nap vi|nap tien vao vi dien tu) /.test(t)) return 'wallet';
  if(/ (rut tien mat|rut tien tai atm) /.test(t)) return 'cashout';
  if(/ (gui tiet kiem|mo so tiet kiem|tat toan so) /.test(t)) return 'savings';
  return null;
}
/* Siblings-first correction list for a picker: the node's siblings (and itself),
   then its parent's siblings, then every group of the kind. */
function fhNodeCorrections(code, kind){
  kind=kind||fhNodeKind(code)||'expense';
  var out=[], seen={}, push=function(c){ if(c&&!seen[c]){ seen[c]=1; out.push(c); } };
  if(fhNodeOk(code)){ var p=FH_TAX.get(code).parent; if(p){ FH_TAX.children(p).forEach(push); push(p); var gp=FH_TAX.get(p).parent; if(gp) FH_TAX.children(gp).forEach(push); } }
  FH_TAX.roots(kind).forEach(push);
  return out;
}
/* Depth reached by a row, for the coverage metric: 3 leaf · 2 category · 1 group · 0 none. */
function fhNodeDepth(code){ var n=fhNodeOk(code)?FH_TAX.get(code):null; if(!n) return 0; return FH_TAX.isLeaf(code)?3:n.depth; }