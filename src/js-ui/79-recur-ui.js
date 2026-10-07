/* ═══ Định kỳ — the tile and the sheet (recurring-charges-spec.md §3.3, §18.7)
   Reads the ONE series view 29-recur.js builds (fhRecurState).

   THE TILE ("Vòng tháng", picked 2026-10-07 from mockups/recurring-options.html):
   the month as a progress. Left, what is still due this month and on how
   much; right, the daily-guide ring reused: paid part filled, due part the
   track. Under a hairline, one line per charge of the month: a grey dot for
   paid, a sage dot for due. When the month is done the view rolls to next
   month and the ring rests at zero.
   THE SHEET ("Thuê bao", same pick): the language of Cài đặt › Thuê bao on
   iPhone. A square monogram tile per service, "Gia hạn thứ bảy 18/10 · còn
   11 ngày", the amount with its cycle underneath. Groups: this month, the
   months after, yearly, then guesses with Không / Đúng rồi.
   The view arrives a moment after the tab paints (the history slice is read
   in the background), so the tile lives in a wrapper fhRecurPainted refills
   in place. House rules: fmt() for money, tokens only, SVG, no emoji. */
(function () {
  'use strict';
  const R = () => window.FH_RECUR;
  const _e = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const _money = (k) => (typeof fmt === 'function' ? fmt(k) : String(k));
  const _dm = (iso) => iso ? (iso.slice(8, 10).replace(/^0/, '') + '/' + iso.slice(5, 7).replace(/^0/, '')) : '';
  const _cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
  const _state = (scope) => (window.fhRecurState ? window.fhRecurState(scope) : { ready: false, series: [] });
  const _todayIso = () => { const d = window.TODAY ? new Date(window.TODAY.getTime()) : new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const _monthEn = (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || '';
  const _WD_VI = ['chủ nhật', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy'];
  const _WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const _wd = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ''; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); return L(_WD_VI[d], _WD_EN[d]); };
  /* What a person calls the charge: the receipt's own name when there is one
     ("YouTube Premium"), else who it was paid to. */
  const _name = (s) => s.product || s.name || L('Khoản định kỳ', 'Recurring charge');
  /* The monogram tile: first letter, one of the six identity slots picked by
     the series key so the same service keeps its colour across opens. */
  const _slot = (key) => { let h = 0; for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 6) + 1; };
  const _mono = (s) => '<span class="rcr-mono" style="background:var(--id-' + _slot(s.groupKey) + ')">' + _e(_cap(_name(s)).replace(/^\s+/, '').charAt(0) || '·') + '</span>';
  /* This month: "Gia hạn 18/10 · còn 11 ngày" (the countdown is the point,
     so the weekday gives way to it). Later months: "Gia hạn thứ sáu 6/11". */
  const _renew = (s, withCount) => {
    if (!s.next) return '';
    if (!withCount || s.dueInDays == null) return _e(L('Gia hạn ' + _wd(s.next) + ' ' + _dm(s.next), 'Renews ' + _wd(s.next) + ' ' + _dm(s.next)));
    const n = s.dueInDays;
    const count = n < 0 ? L('dự kiến, chưa thấy', 'expected, not seen yet') : n === 0 ? L('hôm nay', 'today') : n === 1 ? L('ngày mai', 'tomorrow') : L('còn ' + n + ' ngày', 'in ' + n + ' days');
    return _e(L('Gia hạn ' + _dm(s.next) + ' · ' + count, 'Renews ' + _dm(s.next) + ' · ' + count));
  };
  const _cycle = (p) => p === 'yearly' ? L('/năm', '/yr') : p === 'weekly' ? L('/tuần', '/wk') : L('/tháng', '/mo');
  const _chev = '<svg class="rcr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  /* ── the tile ── */
  function _ring(pct) {
    const r = 36, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
    return '<div class="rcr-ring"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--guide-ok-trk)" stroke-width="8"/>'
      + '<circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--brand)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>'
      + '<div class="rcr-ring-c"><b class="num">' + Math.round(pct * 100) + '%</b><small>' + _e(L('đã trả', 'paid')) + '</small></div></div>';
  }
  function _mline(label, date, amt, paid) {
    return '<div class="rcr-ln' + (paid ? ' paid' : '') + '"><span class="rcr-ln-t"><i class="rcr-dot"></i>' + _e(label) + ' · ' + _e(_dm(date)) + '</span><b class="num">' + _e(_money(amt)) + '</b></div>';
  }
  /* Empty until the ledger shows something that comes back: the section earns
     its place, it is not a promise. */
  function inner(scope) {
    const st = _state(scope);
    if (!R() || !st.ready) return '';
    const all = R().live(st.series);
    const sure = all.filter((s) => !s.soft), maybe = all.filter((s) => s.soft);
    if (!sure.length && !maybe.length) return '';
    const open = 'fhRecurSheet(\'' + scope + '\')';
    const head = '<div class="section-h" id="' + scope + '-recur-h"><span class="tl"><span class="t">' + _e(L('Định kỳ', 'Recurring')) + '</span></span>'
      + '<span class="acts"><a onclick="' + open + '">' + _e(L('Tất cả', 'All')) + '</a></span></div>';
    if (!sure.length) {
      return head + '<div class="debt-bento"><section class="dbt-tile wide rcr-tile" onclick="' + open + '">'
        + '<div class="dbt-tk">' + _e(L(maybe.length + ' khoản có vẻ định kỳ', maybe.length + ' possibly recurring')) + '</div>'
        + '<div class="rcr-lines">' + maybe.slice(0, 3).map((s) => _mline(_name(s), s.next, s.amount, true)).join('') + '</div>'
        + '</section></div>';
    }
    const mv = R().monthView(all, _todayIso());
    const pct = mv.total > 0 ? mv.paidTotal / mv.total : 0;
    const label = mv.isNext ? L('Tháng ' + mv.month, _monthEn(mv.month)) : L('Tháng ' + mv.month + ' còn', 'Left in ' + _monthEn(mv.month));
    const sub = mv.due.length
      ? L('trên ' + _money(mv.total) + ' định kỳ · ' + mv.due.length + ' khoản', 'of ' + _money(mv.total) + ' recurring · ' + mv.due.length + ' charges')
      : L('Tháng này xong rồi · ' + _money(mv.total) + ' định kỳ', 'All paid this month · ' + _money(mv.total) + ' recurring');
    const lines = mv.paid.map((p) => _mline(_name(p.series), p.date, p.amount, true)).concat(mv.due.map((s) => _mline(_name(s), s.next, s.amount, false))).slice(0, 5);
    const rose = sure.find((s) => s.creep > 0);
    const feet = (rose ? '<div class="rcr-foot rose">' + _e(L(_name(rose) + ' tăng ' + _money(rose.creep), _name(rose) + ' is up ' + _money(rose.creep))) + '</div>' : '')
      + (maybe.length ? '<div class="rcr-foot">' + _e(L('Có vẻ định kỳ: ', 'Possibly recurring: ') + maybe.slice(0, 2).map(_name).join(', ') + (maybe.length > 2 ? L(' và ' + (maybe.length - 2) + ' khoản nữa', ' and ' + (maybe.length - 2) + ' more') : '')) + '</div>' : '');
    return head + '<div class="debt-bento"><section class="dbt-tile wide rcr-tile" onclick="' + open + '">'
      + '<div class="rcr-top"><div class="rcr-top-l"><div class="dbt-tk">' + _e(label) + '</div>'
      + '<div class="dbt-tv num">' + _e(_money(mv.dueTotal)) + '</div>'
      + '<div class="dbt-ts rcr-sub">' + _e(sub) + '</div></div>' + _ring(pct) + '</div>'
      + (lines.length ? '<div class="rcr-lines">' + lines.join('') + '</div>' : '')
      + (feet ? '<div class="rcr-feet">' + feet + '</div>' : '')
      + '</section></div>';
  }
  const wrap = (scope) => '<div id="' + scope + '-recur-wrap">' + inner(scope) + '</div>';
  window.persRecurSection = function () { try { return wrap('pers'); } catch (e) { return ''; } };
  window.famRecurSection = function () { try { return wrap('fam'); } catch (e) { return ''; } };

  /* The view changed (the slice arrived, a pass wrote, the person answered):
     refill the tile where it stands, and the sheet if it is the one open. */
  let _sheetScope = null;
  window.fhRecurPainted = function (scope) {
    const el = document.getElementById(scope + '-recur-wrap');
    if (el) el.innerHTML = inner(scope);
    if (_sheetScope === scope) { const l = document.getElementById('exdacct-list'); if (l && l.querySelector('.rcr-sheet')) _fill(scope); }
  };

  /* ── the sheet ── */
  /* A row opens its latest transaction, when that row is one the detail
     screen can reach (the personal detail reads the tab's rows and the
     history screen's, not the recurrence slice). */
  function _openAttr(scope, s) {
    if (scope === 'fam') { const t = s.latest._t; return t ? 'closeSheet();openExpenseDetail&&openExpenseDetail(\'' + _e(t.id) + '\')' : ''; }
    const P = (typeof window.fhPersonalData === 'function') ? fhPersonalData() : null;
    const has = P && ((P.txns || []).some((x) => x.id === s.latest.id) || (P.txnsOld || []).some((x) => x.id === s.latest.id));
    return has ? 'closeSheet();openPersonalTxDetail&&openPersonalTxDetail(\'' + _e(s.latest.id) + '\')' : '';
  }
  function _item(scope, s, withCount) {
    const on = _openAttr(scope, s);
    /* A price that rose takes the cycle's place under the amount (the group
       label already says the cycle), so the renewal line keeps its countdown. */
    const under = s.creep > 0 ? '<small class="rcr-cyc rose">' + _e(L('tăng ' + _money(s.creep), 'up ' + _money(s.creep))) + '</small>' : '<small class="rcr-cyc">' + _e(_cycle(s.period)) + '</small>';
    const body = _mono(s) + '<span class="rcr-t"><b>' + _e(_name(s)) + '</b><small>' + _renew(s, withCount) + '</small></span>'
      + '<span class="rcr-r"><span class="rcr-amt num">' + _e(_money(s.amount)) + '</span>' + under + '</span>' + (on ? _chev : '');
    return on ? '<button type="button" class="rcr-item" onclick="' + on + '">' + body + '</button>' : '<div class="rcr-item">' + body + '</div>';
  }
  function _guess(scope, s) {
    const body = _mono(s) + '<span class="rcr-t"><b>' + _e(_name(s)) + '</b><small>' + _e(L('Có vẻ ' + R().labelVi(s.period) + (s.next ? ' · ' + _dm(s.next) : ''), 'Maybe ' + R().labelEn(s.period) + (s.next ? ' · ' + _dm(s.next) : ''))) + '</small></span>'
      + '<span class="rcr-r"><span class="rcr-amt num soft">' + _e(_money(s.amount)) + '</span></span>';
    return '<div class="rcr-guess"><div class="rcr-item">' + body + '</div>'
      + '<div class="rcr-ask"><span class="rcr-q">' + _e(L('Lặp lại ' + R().labelVi(s.period) + '?', 'Repeats ' + R().labelEn(s.period) + '?')) + '</span>'
      + '<button type="button" class="rcr-pill" onclick="fhRecurAnswer(\'' + scope + '\',\'' + _e(s.id) + '\',false)">' + _e(L('Không', 'No')) + '</button>'
      + '<button type="button" class="rcr-pill yes" onclick="fhRecurAnswer(\'' + scope + '\',\'' + _e(s.id) + '\',true)">' + _e(L('Đúng rồi', 'Yes')) + '</button>'
      + '</div></div>';
  }
  function _fill(scope) {
    const st = _state(scope);
    const all = R() ? R().live(st.series) : [];
    const sure = all.filter((s) => !s.soft), maybe = all.filter((s) => s.soft);
    const total = R() ? R().monthlyTotal(all) : 0;
    const sec = (label, rows) => '<div class="rcr-sec">' + _e(label) + '</div><div class="rcr-group">' + rows + '</div>';
    let h = '<div class="rcr-sheet">';
    if (!all.length) {
      h += '<div class="rcr-empty">' + _e(st.ready
        ? L('Chưa có khoản nào lặp lại. Khi có sẽ hiện ở đây.', 'Nothing repeats yet. When something does, it shows here.')
        : L('Đang xem lại lịch sử chi tiêu…', 'Reading your spending history…')) + '</div>';
    }
    const um = R() ? R().upcomingMonth(all, _todayIso()) : { items: [] };
    const first = um.items;
    if (first.length) h += sec(um.isNext ? L('Tháng ' + um.month, _monthEn(um.month)) : L('Còn lại tháng này', 'Left this month'), first.map((s) => _item(scope, s, true)).join(''));
    /* The months after, each its own group, for everything not yearly. */
    const rest = sure.filter((s) => first.indexOf(s) < 0 && s.period !== 'yearly' && s.next);
    const byMonth = new Map();
    for (const s of rest) { const k = s.next.slice(0, 7); const g = byMonth.get(k) || []; g.push(s); byMonth.set(k, g); }
    for (const k of [...byMonth.keys()].sort()) {
      const m = +k.slice(5, 7), y = +k.slice(0, 4), thisYear = y === new Date(_todayIso()).getFullYear();
      h += sec(L('Tháng ' + m + (thisYear ? '' : ', ' + y), _monthEn(m) + (thisYear ? '' : ' ' + y)), byMonth.get(k).map((s) => _item(scope, s, false)).join(''));
    }
    const yearly = sure.filter((s) => first.indexOf(s) < 0 && s.period === 'yearly');
    if (yearly.length) h += sec(L('Hàng năm', 'Yearly'), yearly.map((s) => _item(scope, s, false)).join(''));
    if (maybe.length) h += sec(L('Có vẻ định kỳ', 'Possibly recurring'), maybe.map((s) => _guess(scope, s)).join(''));
    h += '</div>';
    const subt = sure.length ? L(sure.length + ' dịch vụ · ~' + _money(total) + ' mỗi tháng', sure.length + ' services · about ' + _money(total) + ' a month') : '';
    if (typeof setTxt === 'function') { setTxt('exdacct-h', L('Định kỳ', 'Recurring')); setTxt('exdacct-sub', subt); }
    if (typeof setHTML === 'function') setHTML('exdacct-list', h);
  }
  window.fhRecurSheet = function (scope) {
    _sheetScope = scope === 'fam' ? 'fam' : 'pers';
    _fill(_sheetScope);
    if (typeof openSheet === 'function') openSheet('sheet-exd-acct');
    // a sheet opened before the first pass finished fills itself when it does
    if (!_state(_sheetScope).ready) { try { _sheetScope === 'fam' ? (window.fhRecurRunFamily && fhRecurRunFamily()) : (window.fhRecurRunPersonal && fhRecurRunPersonal()); } catch (e) {} }
  };

  /* Đúng rồi / Không on a guess (§18.7): a `person` mark on the series' latest
     row, and the lesson taught or forgotten under the series' own key, so the
     answer covers the series and every later charge. */
  window.fhRecurAnswer = async function (scope, id, yes) {
    const k = scope === 'fam' ? 'fam' : 'pers';
    const st = _state(k);
    const s = (st.series || []).find((x) => x.id === id); if (!s) return;
    const period = yes ? s.period : null;
    try {
      if (k === 'pers') {
        if (typeof window.fhPersonalPatchMany !== 'function') return;
        const ok = await fhPersonalPatchMany([{ id: id, fields: { recur: period, recurSrc: 'person' } }]);
        if (!ok || !ok.length) throw new Error('patch');
        if (window.fhPersonalRecurTouch) fhPersonalRecurTouch(id, period, 'person');
      } else {
        if (typeof window.fhTxnBulkPatch !== 'function') return;
        await fhTxnBulkPatch(id, { recurrence: period, recurrence_source: 'person' });
        if (s.latest._t) { s.latest._t.recur = period; s.latest._t.recurSrc = 'person'; }
      }
    } catch (e) { if (window.toast) toast(L('Chưa lưu được, thử lại', 'Couldn’t save, try again')); return; }
    s.latest.recur = period; s.latest.recurSrc = 'person';
    try {
      if (yes && window.fhLessonLearnRecur) fhLessonLearnRecur(s.groupKey, s.period, 'person', s.amount);
      else if (!yes && window.fhLessonForgetRecur) fhLessonForgetRecur(s.groupKey);
    } catch (e) { /* the row's own mark already holds the answer */ }
    if (window.toast) toast(yes ? L('Đã đánh dấu ' + R().labelVi(s.period), 'Marked ' + R().labelEn(s.period)) : L('Đã bỏ khỏi Định kỳ', 'Removed from Recurring'));
    if (window.fhRecurReanalyse) fhRecurReanalyse(k);
  };
})();
