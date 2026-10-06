/* ═══ Định kỳ — the tile and the sheet (recurring-charges-spec §3.3, §18.7)
   Reads the ONE series view 29-recur.js builds (fhRecurState). A bento tile
   beside Đầu tư: what is due in the next 30 days and "mỗi tháng ~X", confirmed
   series only. Guesses ("có vẻ") are named in one quiet line on the tile and
   answered in the sheet with Đúng rồi / Không: no prompt, no badge.
   The view arrives a moment after the tab paints (the history slice is read
   in the background), so the tile lives in a wrapper that fhRecurPainted
   refills in place. House rules: fmt() for money, tokens only, SVG. */
(function () {
  'use strict';
  const R = () => window.FH_RECUR;
  const _e = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const _money = (k) => (typeof fmt === 'function' ? fmt(k) : String(k));
  const _dayLbl = (iso) => iso ? (iso.slice(8, 10).replace(/^0/, '') + '/' + iso.slice(5, 7).replace(/^0/, '')) : '';
  const _cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
  const _due = (s) => {
    if (s.dueInDays == null) return '';
    if (s.dueInDays < 0) return L('quá ' + Math.abs(s.dueInDays) + ' ngày', Math.abs(s.dueInDays) + ' days late');
    if (s.dueInDays === 0) return L('hôm nay', 'today');
    if (s.dueInDays === 1) return L('ngày mai', 'tomorrow');
    return _dayLbl(s.next);
  };
  const _upSvg = '<svg class="rcr-up-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
  const _state = (scope) => (window.fhRecurState ? window.fhRecurState(scope) : { ready: false, series: [] });
  const _name = (s) => (s.product ? (s.name + ' · ' + s.product) : s.name) || L('Khoản định kỳ', 'Recurring charge');

  function _line(s) {
    return '<span class="rcr-row">'
      + '<span class="rcr-nm">' + _e(_name(s)) + '</span>'
      + '<span class="rcr-when">' + _e(_due(s)) + '</span>'
      + '<span class="rcr-amt num">' + _e(_money(s.amount)) + (s.creep > 0 ? '<span class="rcr-up">' + _upSvg + _e(_money(s.creep)) + '</span>' : '') + '</span>'
      + '</span>';
  }

  /* The tile's inside. Empty until the ledger shows something that comes back:
     the section earns its place, it is not a promise. */
  function inner(scope) {
    const st = _state(scope);
    if (!R() || !st.ready) return '';
    const all = R().live(st.series);
    const sure = all.filter((s) => !s.soft), maybe = all.filter((s) => s.soft);
    if (!sure.length && !maybe.length) return '';
    const up = R().upcoming(all), total = R().monthlyTotal(all);
    const shown = (up.length ? up : sure).slice(0, 3);
    const head = sure.length
      ? (up.length ? L(up.length + ' khoản trong 30 ngày tới', up.length + ' due in the next 30 days') : L(sure.length + ' khoản định kỳ', sure.length + ' recurring'))
      : L('Có vẻ có ' + maybe.length + ' khoản định kỳ', maybe.length + ' possible recurring');
    const hint = maybe.length
      ? '<div class="rcr-hint">' + _e(L('Có vẻ định kỳ: ', 'Possibly recurring: ') + maybe.slice(0, 3).map(_name).join(', ') + (maybe.length > 3 ? '…' : '')) + '</div>' : '';
    return '<div class="section-h" id="' + scope + '-recur-h"><span class="tl"><span class="t">' + _e(L('Định kỳ', 'Recurring')) + '</span></span>'
      + '<span class="acts"><a onclick="fhRecurSheet(\'' + scope + '\')">' + _e(L('Tất cả', 'All')) + '</a></span></div>'
      + '<div class="debt-bento"><section class="dbt-tile wide rcr-tile" onclick="fhRecurSheet(\'' + scope + '\')">'
      + '<div class="dbt-tk">' + _e(head) + '</div>'
      + (total > 0 ? '<div class="dbt-tv">' + _e('~' + _money(total)) + '<span class="rcr-per"> / ' + _e(L('tháng', 'month')) + '</span></div>' : '')
      + (shown.length ? '<div class="rcr-list">' + shown.map(_line).join('') + '</div>' : '')
      + hint
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

  /* A row opens its latest transaction, when that row is one the detail
     screen can reach (the personal detail reads the tab's rows and the
     history screen's, not the recurrence slice). */
  function _openAttr(scope, s) {
    if (scope === 'fam') { const t = s.latest._t; return t ? 'closeSheet();openExpenseDetail&&openExpenseDetail(\'' + _e(t.id) + '\')' : ''; }
    const P = (typeof window.fhPersonalData === 'function') ? fhPersonalData() : null;
    const has = P && ((P.txns || []).some((x) => x.id === s.latest.id) || (P.txnsOld || []).some((x) => x.id === s.latest.id));
    return has ? 'closeSheet();openPersonalTxDetail&&openPersonalTxDetail(\'' + _e(s.latest.id) + '\')' : '';
  }
  function _row(scope, s) {
    const on = _openAttr(scope, s);
    return on ? '<button type="button" class="choice rcr-choice" onclick="' + on + '">' + _line(s) + '</button>'
              : '<div class="choice rcr-choice ro">' + _line(s) + '</div>';
  }
  function _soft(scope, s) {
    return '<div class="rcr-maybe">' + _row(scope, s)
      + '<div class="rcr-ask"><span class="rcr-q">' + _e(L('Lặp lại ' + R().labelVi(s.period) + '?', 'Repeats ' + R().labelEn(s.period) + '?')) + '</span>'
      + '<button type="button" class="rcr-yes" onclick="fhRecurAnswer(\'' + scope + '\',\'' + _e(s.id) + '\',true)">' + _e(L('Đúng rồi', 'Yes')) + '</button>'
      + '<button type="button" class="rcr-no" onclick="fhRecurAnswer(\'' + scope + '\',\'' + _e(s.id) + '\',false)">' + _e(L('Không', 'No')) + '</button>'
      + '</div></div>';
  }
  function _fill(scope) {
    const st = _state(scope);
    const all = R() ? R().live(st.series) : [];
    const sure = all.filter((s) => !s.soft), maybe = all.filter((s) => s.soft);
    const total = R() ? R().monthlyTotal(all) : 0;
    let h = '<div class="rcr-sheet">';
    if (!all.length) {
      h += '<div class="rcr-empty">' + _e(st.ready
        ? L('Chưa có khoản định kỳ nào. Khi một khoản lặp lại, nó sẽ hiện ở đây.', 'Nothing recurring yet. When a charge repeats, it shows up here.')
        : L('Đang xem lại lịch sử chi tiêu…', 'Reading your spending history…')) + '</div>';
    }
    const up = R() ? R().upcoming(all) : [];
    if (up.length) h += '<div class="rcr-sec">' + _e(L('30 ngày tới', 'Next 30 days')) + '</div>' + up.map((s) => _row(scope, s)).join('');
    for (const p of ['monthly', 'yearly', 'weekly']) {
      const g = sure.filter((s) => s.period === p && up.indexOf(s) < 0);
      if (g.length) h += '<div class="rcr-sec">' + _e(_cap(R().labelVi(p))) + '</div>' + g.map((s) => _row(scope, s)).join('');
    }
    if (maybe.length) h += '<div class="rcr-sec">' + _e(L('Có vẻ định kỳ', 'Possibly recurring')) + '</div>' + maybe.map((s) => _soft(scope, s)).join('');
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
    } catch (e) { if (window.toast) toast(L('Chưa lưu được, thử lại nhé', 'Could not save, try again')); return; }
    s.latest.recur = period; s.latest.recurSrc = 'person';
    try {
      if (yes && window.fhLessonLearnRecur) fhLessonLearnRecur(s.groupKey, s.period, 'person', s.amount);
      else if (!yes && window.fhLessonForgetRecur) fhLessonForgetRecur(s.groupKey);
    } catch (e) { /* the row's own mark already holds the answer */ }
    if (window.toast) toast(yes ? L('Đã ghi nhận: ' + R().labelVi(s.period), 'Noted: ' + R().labelEn(s.period)) : L('Đã bỏ khỏi Định kỳ', 'Removed from Recurring'));
    if (window.fhRecurReanalyse) fhRecurReanalyse(k);
  };
})();
