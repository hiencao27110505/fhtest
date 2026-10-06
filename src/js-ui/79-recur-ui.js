/* ═══ Định kỳ — the recurring-charges tile and sheet (recurring-charges-spec §3.3, RR7)
   Reads the series view FH_RECUR builds over the decrypted ledger. A bento
   tile beside Đầu tư: what is due in the next 30 days and "mỗi tháng ~X";
   its sheet lists every series. Family gets the same view over family rows.
   Nothing here writes; the picker that marks a row lives on the detail
   screen and the queue card. House rules: fmt() for money, tokens only, SVG. */
(function () {
  'use strict';
  const R = () => window.FH_RECUR;
  const _e = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const _money = (k) => (typeof fmt === 'function' ? fmt(k) : String(k));
  const _dayLbl = (iso) => iso ? (iso.slice(8, 10).replace(/^0/, '') + '/' + iso.slice(5, 7).replace(/^0/, '')) : '';
  const _due = (s) => {
    if (s.dueInDays == null) return '';
    if (s.dueInDays < 0) return L('quá ' + Math.abs(s.dueInDays) + ' ngày', Math.abs(s.dueInDays) + ' days late');
    if (s.dueInDays === 0) return L('hôm nay', 'today');
    if (s.dueInDays === 1) return L('ngày mai', 'tomorrow');
    return _dayLbl(s.next);
  };
  const _upSvg = '<svg class="rcr-up-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

  function _line(s) {
    const name = s.product ? (s.name + ' · ' + s.product) : s.name;
    return '<div class="rcr-row">'
      + '<span class="rcr-nm">' + _e(name) + (s.soft ? '<span class="rcr-soft">' + _e(L('có vẻ', 'maybe')) + '</span>' : '') + '</span>'
      + '<span class="rcr-when">' + _e(_due(s)) + '</span>'
      + '<span class="rcr-amt num">' + _e(_money(s.amount)) + (s.creep > 0 ? '<span class="rcr-up">' + _upSvg + _e(_money(s.creep)) + '</span>' : '') + '</span>'
      + '</div>';
  }

  /* The tile. Empty when the ledger shows nothing repeating yet (the section
     earns its place, it is not a promise). */
  function section(series, scope) {
    if (!R() || !series || !series.length) return '';
    const up = R().upcoming(series);
    const total = R().monthlyTotal(series);
    const shown = (up.length ? up : series).slice(0, 3);
    return '<div class="section-h" id="' + scope + '-recur-h"><span class="tl"><span class="t">' + _e(L('Định kỳ', 'Recurring')) + '</span></span>'
      + '<span class="acts"><a onclick="fhRecurSheet(\'' + scope + '\')">' + _e(L('Tất cả', 'All')) + '</a></span></div>'
      + '<div class="debt-bento"><section class="dbt-tile wide rcr-tile" onclick="fhRecurSheet(\'' + scope + '\')">'
      + '<div class="dbt-tk">' + _e(up.length ? L(up.length + ' khoản trong 30 ngày tới', up.length + ' due in the next 30 days') : L(series.length + ' khoản định kỳ', series.length + ' recurring')) + '</div>'
      + (total > 0 ? '<div class="dbt-tv">' + _e('~' + _money(total)) + '<span class="rcr-per"> / ' + _e(L('tháng', 'month')) + '</span></div>' : '')
      + '<div class="rcr-list">' + shown.map(_line).join('') + '</div>'
      + '</section></div>';
  }

  window.persRecurSection = function () {
    try { return section(window.fhRecurPersonalSeries ? fhRecurPersonalSeries() : [], 'pers'); } catch (e) { return ''; }
  };
  window.famRecurSection = function () {
    try { return section(window.fhRecurFamilySeries ? fhRecurFamilySeries() : [], 'fam'); } catch (e) { return ''; }
  };

  /* The sheet: the 30-day list on top, then every series by period. A row
     opens the latest transaction. Rendered into the shared choices sheet so
     it needs no markup of its own. */
  window.fhRecurSheet = function (scope) {
    const series = scope === 'fam' ? (window.fhRecurFamilySeries ? fhRecurFamilySeries() : []) : (window.fhRecurPersonalSeries ? fhRecurPersonalSeries() : []);
    if (typeof _pexdChoices !== 'function') return;
    if (!series.length) {
      _pexdChoices(L('Định kỳ', 'Recurring'), '', '<div class="rcr-empty">' + _e(L('Chưa có khoản định kỳ nào. Khi một khoản lặp lại, nó sẽ hiện ở đây.', 'Nothing recurring yet. When a charge repeats, it shows up here.')) + '</div>');
      return;
    }
    const up = R().upcoming(series);
    const total = R().monthlyTotal(series);
    const open = (s) => scope === 'fam'
      ? 'closeSheet();openExpenseDetail&&openExpenseDetail(\'' + _e(s.latest._t ? s.latest._t.id : s.latest.id) + '\')'
      : 'closeSheet();openPersonalTxDetail&&openPersonalTxDetail(\'' + _e(s.latest.id) + '\')';
    const btn = (s) => '<button type="button" class="choice rcr-choice" onclick="' + open(s) + '">' + _line(s) + '</button>';
    let h = '';
    if (up.length) h += '<div class="rcr-sec">' + _e(L('30 ngày tới', 'Next 30 days')) + '</div>' + up.map(btn).join('');
    for (const p of ['monthly', 'yearly', 'weekly']) {
      const g = series.filter((s) => s.period === p && up.indexOf(s) < 0);
      if (!g.length) continue;
      h += '<div class="rcr-sec">' + _e(R().labelVi(p).replace(/^./, (c) => c.toUpperCase())) + '</div>' + g.map(btn).join('');
    }
    _pexdChoices(L('Định kỳ', 'Recurring'), total > 0 ? _e(L('Mỗi tháng ~' + _money(total), 'About ' + _money(total) + ' a month')) : '', h);
  };
})();
