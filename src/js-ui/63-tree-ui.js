/* ── 0144: the category tree on screen ──────────────────────────────────────
   Two surfaces, one rule: the person's LABEL is what they manage and budget by,
   the tree NODE is what the app understood the money to be. Nothing here writes
   a label; nothing here is shown at all while fhTreeOn() is false (the C8
   rollback switch).

   • fhNodeLine(code)      — "Ăn uống › Đồ uống › Cà phê", for a detail row
   • fhNodePickOpen(...)   — the picker sheet: siblings first, then search
   • fhTreeSelector(scope) - "Danh mục của tôi" / "Tiêu vào gì" segmented control
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
  if (head) head.textContent = L('Tiêu vào gì', 'What it was');
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
  _tbOpen = {};                                    // a fresh view opens closed
  /* renderFinanceHero owns the legend on BOTH surfaces (the Tài chính card and
     the Giao dịch screen), so it is the one that always has to run. The tab
     renderer only matters when the tab itself is what is on screen. */
  if (window.renderFinanceHero) renderFinanceHero();
  if (scope === 'personal' && window.renderPersonal) {
    var tab = document.getElementById('v-personal');
    if (tab && tab.classList.contains('on')) renderPersonal();
  }
  if (window.renderTxns) { try { renderTxns(); } catch (e) {} }   // the list's right-hand label follows the layer
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
    + b('tree', L('Tiêu vào gì', 'What I bought')) + '</div>';
}

/* ── the L1 breakdown ───────────────────────────────────────────────────────
   `rows` is [{node, amt}] for the month. Sums roll up the tree: a leaf's amount
   counts for its category and its group, so the top level always adds up to the
   same total the label view shows. Rows with no node land in one honest
   "Chưa rõ" line rather than being spread over the groups. */
var _tbOpen = {}, _tbRows = [];
function fhTreeToggle(code) {
  _tbOpen[code] = !_tbOpen[code];
  var host = document.querySelector('[data-treehost]');
  if (host) host.innerHTML = fhTreeBreakdownHTML(_tbRows);
}
/* Tapping a category does the two things a person means by it at once: narrow
   everything on screen to that part of the tree, and open it so the next level
   down is right there. Tapping it again undoes both. */
function fhTreeTap(code) {
  var off = (window.fhNodeSel === code);
  _tbOpen[code] = !off;
  if (typeof setTxnNode === 'function') setTxnNode(off ? null : code);
  else { window.fhNodeSel = off ? null : code; }
  fhTreeRepaint();
}
/* Repaint the breakdown in place from the rows it was last built with. The
   chart and the list are repainted by their own renderers. */
function fhTreeRepaint() {
  var host = document.querySelector('[data-treehost]');
  if (host) host.innerHTML = fhTreeBreakdownHTML(_tbRows);
}
function fhTreeClearSel() {
  if (typeof setTxnNode === 'function') setTxnNode(null);
  else window.fhNodeSel = null;
  fhTreeRepaint();
}
/* The rows this group holds that no leaf under it claimed. Selecting them is
   what turns "2,1tr chưa rõ chi tiết" into a list you can select-all and teach
   in one go. */
function fhTreeTapExact(code) {
  var key = '=' + code, off = (window.fhNodeSel === key);
  if (typeof setTxnNode === 'function') setTxnNode(off ? null : key);
  else window.fhNodeSel = off ? null : key;
  fhTreeRepaint();
}
window.fhTreeTap = fhTreeTap; window.fhTreeClearSel = fhTreeClearSel;
window.fhTreeTapExact = fhTreeTapExact;
function fhTreeBreakdownHTML(rows) {
  if (typeof FH_TAX === 'undefined') return '';
  _tbRows = rows || [];               // what the visible list was built from, for the next expand
  var sum = {}, cnt = {}, none = 0, total = 0, xTotal = 0, xAny = false;
  (rows || []).forEach(function (r) {
    var amt = Number(r.amt) || 0; if (amt <= 0) return;
    if (!r.node || !FH_TAX.get(r.node)) { total += amt; none += amt; return; }
    /* A row whose node is a transfer is money that MOVED, not money spent: your
       own account, a card paid off, a wallet topped up. The ledger still holds
       it as an expense because that is how it arrived, so it is shown — but
       below the spending, under its own heading, and out of the total the
       percentages are drawn against. Otherwise a 7tr move between two of your
       own accounts reads as the month's biggest purchase. */
    if (FH_TAX.kindOf(r.node) !== 'expense') { xTotal += amt; xAny = true; }
    else total += amt;
    cnt[r.node] = (cnt[r.node] || 0) + 1;            // rows sitting on THIS node exactly
    sum[r.node] = (sum[r.node] || 0) + amt;
    FH_TAX.ancestors(r.node).forEach(function (a) { sum[a] = (sum[a] || 0) + amt; });
  });
  if (!total && !xTotal) return '<div class="tb-empty">' + L('Chưa có khoản nào tháng này', 'Nothing logged this month') + '</div>';
  /* One row builder, and it is the LEGEND row the rest of the app already uses
     (.fh-lrow): same height, type, bar and chevron. Depth is a left inset, not
     a different component. */
  var row = function (opts) {
    var base = opts.xfer ? (xTotal || 1) : (total || 1);
    var pct = Math.min(100, Math.max(1, 100 * opts.amt / base));
    var chev = (opts.kids || opts.go)
      ? '<svg class="fh-chev' + (opts.open ? ' open' : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
      : '<span class="fh-chev"></span>';
    var tappable = opts.kids || opts.go || opts.code;
    var sel = opts.code && (opts.own ? window.fhNodeSel === '=' + opts.code : window.fhNodeSel === opts.code);
    return '<' + (tappable ? 'button type="button"' : 'div') + ' class="fh-lrow tb-l' + opts.depth + (opts.rest ? ' tb-rest' : '') + (sel ? ' tb-sel' : '') + '"'
      + (opts.go ? ' onclick="' + opts.go + '"'
                 : (opts.code ? ' onclick="fhTreeTap(&#39;' + escAttr(opts.code) + '&#39;)" aria-pressed="' + (sel ? 'true' : 'false') + '"' : ''))
      + '><span class="fh-ico">' + (opts.ico || '') + '</span>'
      + '<span class="fh-body"><span class="fh-l1"><span class="fh-lname">' + esc(opts.name) + '</span>'
      + '<span class="fh-lamt num"><b>' + fmtK(opts.amt) + '</b></span></span>'
      + '<span class="fh-bar"><i style="width:' + pct.toFixed(0) + '%"></i></span></span>'
      + chev + '</' + (tappable ? 'button' : 'div') + '>';
  };
  var out = '';
  var line = function (code, depth, xfer) {
    var n = FH_TAX.get(code), amt = sum[code] || 0;
    if (!amt) return '';
    var kids = FH_TAX.children(code).filter(function (c) { return sum[c]; });
    var own = amt - kids.reduce(function (s, c) { return s + (sum[c] || 0); }, 0);
    var open = !!_tbOpen[code];
    var s = row({ code: code, name: n.vi, amt: amt, depth: depth, kids: kids.length, open: open, xfer: xfer, ico: depth ? '' : (n.emoji || '') });
    if (kids.length && open) {
      kids.sort(function (a, b) { return sum[b] - sum[a]; });
      kids.forEach(function (c) { s += line(c, depth + 1, xfer); });
      /* What sits ON this node and under none of its children. These rows are
         NOT unknown — the tree knows they are Nhà ở, it just has no evidence for
         WHICH kind of Nhà ở. So they are named at the level that IS known, this
         node's own name, and they look like any other real row. Greying them and
         calling them "chưa rõ" described the gap in our knowledge rather than
         the money, and read as a category nobody could act on.
         The count is what stops it looking like a duplicate of its parent: it
         says "N transactions filed here", not "a sub-category with the same
         name". Still opens those rows for anyone who wants to go deeper. */
      if (own > 0) {
        var oc = cnt[code] || 0;
        s += row({
          name: n.vi + (oc ? ' · ' + oc + ' ' + L('khoản', oc === 1 ? 'item' : 'items') : ''),
          amt: own, depth: depth + 1, xfer: xfer, code: code, own: true,
          go: 'fhTreeTapExact(&#39;' + escAttr(code) + '&#39;)'
        });
      }
    }
    return s;
  };
  /* "Chưa rõ" is a line like any other and sorts by size with the rest: pinning
     the largest number to the bottom of the list reads as a footnote when it is
     actually the biggest thing on the screen. */
  var tops = FH_TAX.roots('expense').filter(function (c) { return sum[c]; })
    .map(function (c) { return { code: c, amt: sum[c] }; });
  if (none > 0) tops.push({ code: null, amt: none });
  tops.sort(function (a, b) { return b.amt - a.amt; });
  tops.forEach(function (x) {
    out += x.code ? line(x.code, 0)
      : row({ name: L('Chưa rõ', 'Not sure yet'), amt: x.amt, depth: 0, rest: true, ico: '🗂️', go: 'fhTreeOpenUnknown()' });
  });
  /* While a selection is on, say so above the list and give it one way off.
     The old version narrowed silently, which read as data going missing. */
  /* The not-spending section, and only when there is something in it. */
  if (xAny) {
    var xtops = [];
    ['transfer', 'repayment', 'investment'].forEach(function (k) {
      FH_TAX.roots(k).forEach(function (c) { if (sum[c]) xtops.push({ code: c, amt: sum[c] }); });
    });
    xtops.sort(function (a, b) { return b.amt - a.amt; });
    out += '<div class="tb-sect">' + esc(L('Không tính là chi tiêu', 'Not spending'))
      + '<b class="num">' + fmtK(xTotal) + '</b></div>'
      + '<p class="tb-secthint">' + esc(L('Tiền chuyển giữa các tài khoản của bạn, hoặc trả nợ thẻ. Vẫn nằm trong sổ vì ngân hàng báo về như một khoản chi.',
          'Money moved between your own accounts, or a card paid off. Still in the book because the bank reported it as spending.')) + '</p>';
    xtops.forEach(function (x) { out += line(x.code, 0, true); });
  }
  var head = '';
  if (window.fhNodeSel) {
    head = '<div class="tb-selbar"><span>' + esc(L('Đang xem', 'Showing') + ': ' + fhNodeSelLabel()) + '</span>'
      + '<button type="button" onclick="fhTreeClearSel()">' + L('Xem tất cả', 'Show all') + '</button></div>';
  }
  return head + '<div class="tb-list">' + out + '</div>';
}
/* Tapping "Chưa rõ" opens the transaction list narrowed to those rows. They are
   the ones worth a minute: a bare bank reference the tree cannot read is often
   not spending at all (money moved to a broker, a savings book), and the kind
   row on each one is where that gets corrected. */
function fhTreeOpenUnknown(){
  window.fhNodeSel = '_none';
  if (typeof openTxns === 'function') openTxns(_txnPersonal && _txnPersonal() ? 'personal' : undefined);
  else if (typeof renderTxnScreen === 'function') renderTxnScreen();
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
