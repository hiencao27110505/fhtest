/* ── 0144: the category tree on screen ──────────────────────────────────────
   Two surfaces, one rule: the person's LABEL is what they manage and budget by,
   the tree NODE is what the app understood the money to be. Nothing here writes
   a label; nothing here is shown at all while fhTreeOn() is false (the C8
   rollback switch).

   • fhNodeLine(code)      — "Ăn uống › Đồ uống › Cà phê", for a detail row
   • fhNodePickOpen(...)   — the picker sheet: siblings first, then search
   • fhTreeSelector(scope) — "Danh mục của tôi" / "Loại chi tiêu" segmented control
   • fhTreeBreakdownHTML() — the L1 view of a month, group → category → leaf   */

function fhNodeLine(code, fallback) {
  if (!code || typeof FH_TAX === 'undefined' || !FH_TAX.get(code)) return fallback || '';
  return FH_TAX.pathVi(code).join(' › ');
}
/* The short form for a dense row: the leaf's own name, with its group behind it
   only when the leaf alone would be ambiguous out of context. */
function fhNodeShort(code) {
  var n = (code && typeof FH_TAX !== 'undefined') ? FH_TAX.get(code) : null;
  return n ? n.vi : '';
}

/* ── the picker ─────────────────────────────────────────────────────────────
   Opened from a detail row. `onPick` is the NAME of a global taking the chosen
   code, so the sheet stays declarative like every other sheet here. */
var _npKind = 'expense', _npCur = null, _npFn = '', _npQ = '';
function fhNodePickOpen(cur, kind, onPick) {
  _npCur = cur || null; _npKind = kind || fhNodeKind(cur) || 'expense'; _npFn = onPick || ''; _npQ = '';
  var q = document.getElementById('npick-q'); if (q) q.value = '';
  fhNodePickRender();
  if (typeof openSheet === 'function') openSheet('sheet-node-pick');
}
function fhNodePickSearch(el) { _npQ = (el && el.value) || ''; fhNodePickRender(); }
function fhNodePickRender() {
  var list = document.getElementById('npick-list'); if (!list || typeof FH_TAX === 'undefined') return;
  var head = document.getElementById('npick-h');
  if (head) head.textContent = L('Loại chi tiêu', 'What it was');
  var sub = document.getElementById('npick-sub');
  if (sub) sub.textContent = L('Thay đổi chờ tới khi bấm Lưu', 'Waits for Save');
  var codes, grouped = false;
  var q = FH_TAX.deburr(_npQ).trim();
  if (q) {
    codes = FH_TAX.nodes.filter(function (n) {
      if (n.kind !== _npKind || n.manual) return false;
      if (FH_TAX.deburr(n.vi).indexOf(q) >= 0 || FH_TAX.deburr(n.en).indexOf(q) >= 0) return true;
      return (n.kw || []).some(function (k) { return FH_TAX.deburr(k).indexOf(q) >= 0; });
    }).map(function (n) { return n.code; }).slice(0, 60);
    grouped = true;
  } else {
    codes = (typeof fhNodeCorrections === 'function') ? fhNodeCorrections(_npCur, _npKind) : FH_TAX.roots(_npKind);
  }
  if (!codes.length) { list.innerHTML = '<div class="npick-empty">' + L('Không tìm thấy', 'Nothing found') + '</div>'; return; }
  list.innerHTML = codes.map(function (c) {
    var n = FH_TAX.get(c); if (!n) return '';
    var path = FH_TAX.pathVi(c), tail = path.slice(0, -1).join(' › ');
    return '<button type="button" class="choice npick' + (c === _npCur ? ' on' : '') + '"'
      + ' onclick="fhNodePicked(&#39;' + escAttr(c) + '&#39;)">'
      + '<span class="npick-n">' + esc(n.vi) + '</span>'
      + ((grouped && tail) ? '<span class="npick-p">' + esc(tail) + '</span>' : '')
      + '</button>';
  }).join('');
}
function fhNodePicked(code) {
  if (typeof closeSheet === 'function') closeSheet();
  var fn = _npFn && window[_npFn];
  if (typeof fn === 'function') fn(code);
}
/* "I don't know" is a real answer: it clears the node without touching the label. */
function fhNodePickClear() { fhNodePicked(''); }

/* ── the layer selector ─────────────────────────────────────────────────────
   Remembered per device, per scope, because someone who thinks in the tree on
   their own ledger may still think in labels on the family's. */
function fhTreeLayer(scope) {
  try { return localStorage.getItem('fh-tree-layer:' + scope) === 'tree' ? 'tree' : 'label'; }
  catch (e) { return 'label'; }
}
function fhTreeLayerSet(scope, layer) {
  try { localStorage.setItem('fh-tree-layer:' + scope, layer); } catch (e) {}
  if (scope === 'personal') { if (window.renderPersonal) renderPersonal(); }
  else if (window.renderFinanceHero) renderFinanceHero();
}
function fhTreeSelector(scope) {
  if (typeof fhTreeOn === 'function' && !fhTreeOn()) return '';
  var cur = fhTreeLayer(scope);
  var b = function (v, label) {
    return '<button type="button" class="tl-seg' + (cur === v ? ' on' : '') + '"'
      + ' aria-pressed="' + (cur === v ? 'true' : 'false') + '"'
      + ' onclick="fhTreeLayerSet(&#39;' + scope + '&#39;,&#39;' + v + '&#39;)">' + label + '</button>';
  };
  return '<div class="tl-sel" role="group" aria-label="' + escAttr(L('Cách xem', 'View by')) + '">'
    + b('label', L('Danh mục của tôi', 'My categories'))
    + b('tree', L('Loại chi tiêu', 'What it was')) + '</div>';
}

/* ── the L1 breakdown ───────────────────────────────────────────────────────
   `rows` is [{node, amt}] for the month. Sums roll up the tree: a leaf's amount
   counts for its category and its group, so the top level always adds up to the
   same total the label view shows. Rows with no node land in one honest
   "Chưa phân loại" line rather than being spread over the groups. */
var _tbOpen = {};
function fhTreeToggle(code) { _tbOpen[code] = !_tbOpen[code]; var host = document.querySelector('[data-treehost]'); if (host) fhTreeBreakdownInto(host); }
function fhTreeBreakdownInto(host) {
  if (!host) return;
  var rows = [];
  try { rows = JSON.parse(host.getAttribute('data-treerows') || '[]'); } catch (e) {}
  host.innerHTML = fhTreeBreakdownHTML(rows);
}
function fhTreeBreakdownHTML(rows) {
  if (typeof FH_TAX === 'undefined') return '';
  var sum = {}, none = 0, total = 0;
  (rows || []).forEach(function (r) {
    var amt = Number(r.amt) || 0; if (amt <= 0) return;
    total += amt;
    if (!r.node || !FH_TAX.get(r.node)) { none += amt; return; }
    sum[r.node] = (sum[r.node] || 0) + amt;
    FH_TAX.ancestors(r.node).forEach(function (a) { sum[a] = (sum[a] || 0) + amt; });
  });
  if (!total) return '<div class="tb-empty">' + L('Chưa có khoản nào tháng này', 'Nothing logged this month') + '</div>';
  var out = '';
  var line = function (code, depth) {
    var n = FH_TAX.get(code), amt = sum[code] || 0;
    if (!amt) return '';
    var kids = FH_TAX.children(code).filter(function (c) { return sum[c]; });
    var own = amt - kids.reduce(function (s, c) { return s + (sum[c] || 0); }, 0);
    var open = !!_tbOpen[code];
    var pct = Math.round(100 * amt / total);
    var s = '<button type="button" class="tb-row d' + depth + (kids.length ? ' has' : '') + '"'
      + (kids.length ? ' onclick="fhTreeToggle(&#39;' + escAttr(code) + '&#39;)" aria-expanded="' + (open ? 'true' : 'false') + '"' : ' disabled')
      + '><span class="tb-chev">' + (kids.length ? (open ? '▾' : '▸') : '') + '</span>'
      + '<span class="tb-n">' + esc(n.vi) + '</span>'
      + '<span class="tb-bar"><i style="width:' + Math.max(2, pct) + '%"></i></span>'
      + '<span class="tb-a num">' + fmt(amt) + '</span></button>';
    if (kids.length && open) {
      kids.sort(function (a, b) { return sum[b] - sum[a]; });
      kids.forEach(function (c) { s += line(c, depth + 1); });
      /* What sits ON this node and not under any child: the honest "we know it
         was food, not which kind" amount. Never shown as a fake leaf. */
      if (own > 0) s += '<div class="tb-row d' + (depth + 1) + ' rest"><span class="tb-chev"></span>'
        + '<span class="tb-n">' + L('chưa rõ chi tiết', 'no detail yet') + '</span>'
        + '<span class="tb-bar"></span><span class="tb-a num">' + fmt(own) + '</span></div>';
    }
    return s;
  };
  var roots = FH_TAX.roots('expense').filter(function (c) { return sum[c]; });
  roots.sort(function (a, b) { return sum[b] - sum[a]; });
  roots.forEach(function (c) { out += line(c, 0); });
  if (none > 0) {
    out += '<div class="tb-row d0 rest"><span class="tb-chev"></span>'
      + '<span class="tb-n">' + L('Chưa phân loại', 'Not classified') + '</span>'
      + '<span class="tb-bar"></span><span class="tb-a num">' + fmt(none) + '</span></div>';
  }
  return '<div class="tb-list">' + out + '</div>';
}
/* Build the [{node, amt}] rows for a month from an array of ledger rows. Shared
   by both tabs so one definition decides what "this month's spending" means. */
function fhTreeRowsFor(txnList, monthKey) {
  var out = [];
  (txnList || []).forEach(function (t) {
    if (!t || t.future || t._unreadable) return;
    if (monthKey && t.month && t.month !== monthKey) return;
    var amt = Number(t.amt) || 0; if (amt <= 0) return;
    out.push({ node: t.node || null, amt: amt });
  });
  return out;
}
/* ── the regroup sheet ("Gồm: …") ───────────────────────────────────────────
   A label owns parts of the tree. This is where a person moves one: tap a group
   or category and it belongs to THIS label instead of whichever had it. That is
   the whole model — a partition, so a node has exactly one owner and nothing
   can fall between two labels or be counted twice. */
var _clLabel = '', _clPick = {};
function fhClaimsOpen(btn) {
  var row = btn && btn.closest ? btn.closest('.cat-row') : null;
  var nameEl = row && row.querySelector('.cat-name');
  _clLabel = (nameEl && nameEl.value || '').trim();
  if (!_clLabel) return;
  _clPick = {};
  ((window.catClaims || {})[_clLabel] || []).forEach(function (c) { if (c !== '*') _clPick[c] = 1; });
  fhClaimsRender();
  if (typeof openSheet === 'function') openSheet('sheet-claims');
}
function fhClaimsRender() {
  var box = document.getElementById('claims-list'); if (!box || typeof FH_TAX === 'undefined') return;
  var h = document.getElementById('claims-h');
  if (h) h.textContent = L('Gồm những gì', 'What it includes');
  var sub = document.getElementById('claims-sub');
  if (sub) sub.textContent = _clLabel + ' · ' + L('chạm để chuyển sang nhóm này', 'tap to move it here');
  /* Depth ≤ 2 only: a label owns groups and categories, not individual leaves.
     Someone who wants "Cà phê" as its own budget line makes it its own label. */
  var nodes = FH_TAX.nodes.filter(function (n) { return n.kind === 'expense' && n.depth <= 2 && !n.manual; });
  var owner = {};
  var cc = window.catClaims || {};
  for (var lab in cc) (cc[lab] || []).forEach(function (c) { if (c !== '*') owner[c] = lab; });
  box.innerHTML = nodes.map(function (n) {
    var mine = !!_clPick[n.code];
    var held = owner[n.code];
    var by = (held && held !== _clLabel) ? held : '';
    return '<button type="button" class="claim-row' + (mine ? ' on' : '') + '"'
      + ' onclick="fhClaimsToggle(&#39;' + escAttr(n.code) + '&#39;)">'
      + '<span class="claim-n' + (n.depth === 2 ? ' sub' : '') + '">' + esc(n.vi) + '</span>'
      + (by ? '<span class="claim-by">' + esc(by) + '</span>' : '')
      + '<span class="claim-tick">' + (mine ? '✓' : '') + '</span></button>';
  }).join('');
}
function fhClaimsToggle(code) {
  if (_clPick[code]) delete _clPick[code]; else _clPick[code] = 1;
  fhClaimsRender();
}
/* Saving a regroup asks before it touches history, because moving a claim moves
   money between budget lines. Only rows the MACHINE filed are offered: a row
   whose label a person chose is theirs, and a regroup is not consent to change
   it. Closed months are never touched — their totals are settled. */
function fhClaimsSave() {
  if (!_clLabel) { if (typeof closeSheet === 'function') closeSheet(); return; }
  var codes = Object.keys(_clPick);
  var moved = [];
  var cur = ((window.catClaims || {})[_clLabel] || []).filter(function (c) { return c !== '*'; });
  codes.forEach(function (c) { if (cur.indexOf(c) < 0) moved.push(c); });
  if (typeof window.fhSaveCatClaims === 'function') window.fhSaveCatClaims(_clLabel, codes);
  var affected = (window.txns || []).filter(function (t) {
    if (!t.node || t.future || t.cat === _clLabel) return false;
    if (t.month !== curMonthKey()) return false;                 // this month only: closed months stay settled
    if (t._catPicked) return false;                              // a human chose this label; not ours to move
    var chain = [t.node].concat(FH_TAX.ancestors(t.node));
    return moved.some(function (c) { return chain.indexOf(c) >= 0; });
  });
  if (typeof closeSheet === 'function') closeSheet();
  if (!affected.length) { if (typeof fillBudgetSheet === 'function') fillBudgetSheet(); return; }
  fhClaimsApply(affected);
}
function fhClaimsApply(rows) {
  var em = (window.catStyle && catStyle[_clLabel] || ['🧾'])[0];
  var catId = (window.DB && DB.catByName) ? DB.catByName[_clLabel] : null;
  rows.forEach(function (t) {
    var m = window.months && months[t.month];
    if (m && !t.future) {                                   // the month's per-category totals follow the row
      m.catSpent[t.cat] = (m.catSpent[t.cat] || 0) - t.amt;
      m.catSpent[_clLabel] = (m.catSpent[_clLabel] || 0) + t.amt;
    }
    t.cat = _clLabel; t.ico = em;
    if (t._dbId && catId && window.fhTxnBulkPatch) fhTxnBulkPatch(t._dbId, { category_id: catId });
  });
  if (typeof renderAll === 'function') renderAll();
  if (typeof renderTxns === 'function') renderTxns();
  if (typeof fillBudgetSheet === 'function') fillBudgetSheet();
  if (typeof toast === 'function') toast(L('Đã chuyển ' + rows.length + ' khoản', 'Moved ' + rows.length + ' entries'));
}
