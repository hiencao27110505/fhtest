/* ═══ Định kỳ — the tile and the sheet (recurring-charges-spec §3.3, §18.7)
   Reads the ONE series view 29-recur.js builds (fhRecurState).

   THE TILE sits beside Đầu tư and speaks the same bento language (.dbt-tile):
   one head line, one big figure ("mỗi tháng"), then up to three single-line
   rows — name · date · amount — and at most two quiet footer lines: a price
   that rose, and what only LOOKS recurring. Glanceable, nothing to tap but
   the tile.
   THE SHEET is the list: title + subtitle rows with a right-aligned figure
   and a chevron (DESIGN §3 "List row"), grouped under eyebrow labels. A guess
   carries its question and two small pills, Không · Đúng rồi. No prompt ever
   opens by itself.
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
  /* When it is due. A charge expected a few days ago and not seen yet is
     "dự kiến 5/10": a fact about the pattern, not a verdict on the person. */
  const _when = (s) => {
    if (s.dueInDays == null) return '';
    if (s.dueInDays < 0) return L('dự kiến ' + _dm(s.next), 'expected ' + _dm(s.next));
    if (s.dueInDays === 0) return L('hôm nay', 'today');
    if (s.dueInDays === 1) return L('ngày mai', 'tomorrow');
    return _dm(s.next);
  };
  const _chev = '<svg class="rcr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
  const _state = (scope) => (window.fhRecurState ? window.fhRecurState(scope) : { ready: false, series: [] });
  /* What a person calls the charge: the receipt's own name when there is one
     ("YouTube Premium"), else who it was paid to. */
  const _name = (s) => s.product || s.name || L('Khoản định kỳ', 'Recurring charge');

  /* ── the tile ── */
  function _tileRow(s) {
    return '<div class="rcr-row' + (s.soft ? ' soft' : '') + '"><span class="rcr-nm">' + _e(_name(s)) + '</span>'
      + '<span class="rcr-when">' + _e(_when(s)) + '</span>'
      + '<span class="rcr-amt num">' + _e(_money(s.amount)) + '</span></div>';
  }
  /* Empty until the ledger shows something that comes back: the section earns
     its place, it is not a promise. */
  function inner(scope) {
    const st = _state(scope);
    if (!R() || !st.ready) return '';
    const all = R().live(st.series);
    const sure = all.filter((s) => !s.soft), maybe = all.filter((s) => s.soft);
    if (!sure.length && !maybe.length) return '';
    const up = R().upcoming(all), total = R().monthlyTotal(all);
    const shown = (up.length ? up : (sure.length ? sure : maybe)).slice(0, 3);
    const head = sure.length
      ? (up.length ? L(up.length + ' khoản trong 30 ngày tới', up.length + ' due in the next 30 days') : L(sure.length + ' khoản định kỳ', sure.length + ' recurring'))
      : L(maybe.length + ' khoản có vẻ định kỳ', maybe.length + ' possibly recurring');
    const rose = sure.find((s) => s.creep > 0);
    const foot = (rose ? '<div class="rcr-foot rose">' + _e(L(_name(rose) + ' tăng ' + _money(rose.creep), _name(rose) + ' is up ' + _money(rose.creep))) + '</div>' : '')
      + ((maybe.length && sure.length) ? '<div class="rcr-foot">' + _e(L('Có vẻ định kỳ: ', 'Possibly recurring: ') + maybe.slice(0, 2).map(_name).join(', ') + (maybe.length > 2 ? L(' và ' + (maybe.length - 2) + ' khoản nữa', ' and ' + (maybe.length - 2) + ' more') : '')) + '</div>' : '');
    return '<div class="section-h" id="' + scope + '-recur-h"><span class="tl"><span class="t">' + _e(L('Định kỳ', 'Recurring')) + '</span></span>'
      + '<span class="acts"><a onclick="fhRecurSheet(\'' + scope + '\')">' + _e(L('Tất cả', 'All')) + '</a></span></div>'
      + '<div class="debt-bento"><section class="dbt-tile wide rcr-tile" onclick="fhRecurSheet(\'' + scope + '\')">'
      + '<div class="dbt-tk">' + _e(head) + '</div>'
      + (total > 0 ? '<div class="dbt-tv num">' + _e('~' + _money(total)) + '<span class="rcr-per">' + _e(L(' / tháng', ' / month')) + '</span></div>' : '')
      + (shown.length ? '<div class="rcr-list">' + shown.map(_tileRow).join('') + '</div>' : '')
      + (foot ? '<div class="rcr-feet">' + foot + '</div>' : '')
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
  function _item(scope, s) {
    const on = _openAttr(scope, s);
    const sub = _e(_when(s)) + (s.creep > 0 ? '<span class="rcr-up">' + _e(L(' · tăng ' + _money(s.creep), ' · up ' + _money(s.creep))) + '</span>' : '');
    const body = '<span class="rcr-t"><b>' + _e(_name(s)) + '</b><small>' + sub + '</small></span>'
      + '<span class="rcr-amt num">' + _e(_money(s.amount)) + '</span>' + (on ? _chev : '');
    return on ? '<button type="button" class="rcr-item" onclick="' + on + '">' + body + '</button>' : '<div class="rcr-item">' + body + '</div>';
  }
  function _guess(scope, s) {
    return '<div class="rcr-guess">' + _item(scope, s)
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
    const up = R() ? R().upcoming(all) : [];
    if (up.length) h += sec(L('30 ngày tới', 'Next 30 days'), up.map((s) => _item(scope, s)).join(''));
    for (const p of ['monthly', 'yearly', 'weekly']) {
      const g = sure.filter((s) => s.period === p && up.indexOf(s) < 0);
      if (g.length) h += sec(_cap(R().labelVi(p)), g.map((s) => _item(scope, s)).join(''));
    }
    if (maybe.length) h += sec(L('Có vẻ định kỳ', 'Possibly recurring'), maybe.map((s) => _guess(scope, s)).join(''));
    h += '</div>';
    if (typeof setTxt === 'function') { setTxt('exdacct-h', L('Định kỳ', 'Recurring')); setTxt('exdacct-sub', total > 0 ? L('Mỗi tháng ~' + _money(total), 'About ' + _money(total) + ' a month') : ''); }
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
