  /* ═══ Spaces → the person's own book (docs/specs/spaces-spec.md section 12) ══
     "Your book shows your share, in every space." For each space this device
     can read, the pass makes the personal ledger hold exactly the rows the plan
     says (15-spaces-core.js fhSpaceBookPlan): an expense for my share, a loan
     to (or from) the space for the rest, a repayment for each settle-up I am
     part of, and a loan for any share that belongs to people outside the space.

     Each member's own device writes that member's rows. Nobody writes into
     another person's book. The pass is idempotent (derived link ids) and
     conservative: an unreadable space, a locked ledger or a failed read means
     "do nothing", never "delete". */
  (function () {
    const _S = () => window.fhSpacesData();
    /* Hints that exist only on the device that saved the expense: which of MY
       accounts paid, and the name typed for an outside share. Kept in memory
       for the pass that runs right after the save, and in localStorage for a
       pass that runs later on this device. */
    const HINT_LS = 'fh-sp-hints';
    function _hints() { try { return JSON.parse(localStorage.getItem(HINT_LS) || '{}') || {}; } catch (e) { return {}; } }
    function _hintsSave(h) { try { const k = Object.keys(h); if (k.length > 200) k.slice(0, k.length - 200).forEach((x) => { delete h[x]; }); localStorage.setItem(HINT_LS, JSON.stringify(h)); } catch (e) {} }
    window.fhSpaceBookHint = function (txnId, o) {
      if (!txnId || !o) return;
      const h = _hints(), was = h[txnId] || {}; h[txnId] = { a: o.acct || was.a || null, n: o.outName || was.n || null }; _hintsSave(h);   // a later caller that knows only one half keeps the other
    };

    const _running = {}, _again = {}, _timers = {};
    window.fhSpaceBookSyncSoon = function (fid, ms) {
      if (_timers[fid]) clearTimeout(_timers[fid]);
      _timers[fid] = setTimeout(function () { _timers[fid] = null; window.fhSpaceBookSync(fid); }, ms == null ? 900 : ms);
    };
    window.fhSpaceBookSync = async function (fid) {
      const S = _S(), d = S && S.data[fid];
      if (!d || !window.fhPersonalSpaceReady || !window.fhPersonalSpaceReady()) return 0;
      if (d.unreadable) return 0;                         // rows this device cannot read: the plan would be short, and short plans delete
      if (!S.list.some((x) => x.id === fid)) return 0;    // the space keeps no balances
      const my = window.fhSpaceMyMemberId(fid); if (!my) return 0;
      if (_running[fid]) { _again[fid] = 1; return 0; }
      _running[fid] = 1;
      try {
        const have = await window.fhPersonalSpaceList(fid);
        if (!have) return 0;
        const plan = fhSpaceBookPlan(fid, my, d);
        const diff = fhSpaceBookDiff(plan, have, d.since);
        if (!diff.ins.length && !diff.upd.length && !diff.del.length) return 0;
        const cats = {}; (d.cats || []).forEach((c) => { cats[c.id] = c; });
        const hints = _hints();
        const n = await window.fhPersonalSpaceApply(fid, diff, {
          cats: cats,
          acctFor: (src) => (hints[src] && hints[src].a) || null,
          outName: (src) => (hints[src] && hints[src].n) || null,
        });
        if (n) { try { window.fhSpacesRedraw && window.fhSpacesRedraw(); window.persDebtRedraw && window.persDebtRedraw(); } catch (e) {} }
        return n;
      } catch (e) { console.warn('space book sync failed', e); return 0; }
      finally { _running[fid] = 0; if (_again[fid]) { _again[fid] = 0; window.fhSpaceBookSyncSoon(fid, 1500); } }
    };

    /* ── after a Chia expense was saved through the family write path ─────── */
    /* The transaction row is in (nt._dbId). Seal its share row, remember which
       of my accounts paid, re-read the space and let the book pass run. Until
       the share row lands the Chung mirror must not adopt the row, so its id is
       held in _exSplitInFlight for the mirror to see. */
    window._exSplitInFlight = window._exSplitInFlight || {};
    window.fhSpaceAfterSplitSave = async function (fid, nt) {
      const sp = nt && nt._split; if (!sp || !nt._dbId) return;
      window._exSplitInFlight[nt._dbId] = 1;
      try {
        window.fhSpaceBookHint(nt._dbId, { acct: sp.acct, outName: sp.outName });
        if (!_S().keys[fid]) await window.fhSpacesBoot({ force: true });
        const r = await window.fhSpaceSetShares(fid, nt._dbId, sp.payerId, sp.rule, sp.payload);
        if (!r.ok) { window.toast && toast(L('Đã ghi khoản chi, nhưng chưa lưu được cách chia. Mở lại khoản này để chia.', 'The expense is saved, but its split is not. Open it again to split it.')); return; }
        await window.fhSpaceHydrate(fid);
        try { if (typeof fhSpaceSplitBoxRender === 'function') fhSpaceSplitBoxRender(); if (typeof renderTxns === 'function') renderTxns(); if (typeof renderHome === 'function') renderHome(); } catch (e) {}
        try { window.fhNotify && window.fhNotify('space_expense', { familyId: fid, tx: nt._dbId }); } catch (e) {}
      } finally { setTimeout(function () { delete window._exSplitInFlight[nt._dbId]; }, 20000); }
    };

    /* ── review: a captured row into a space that is not the open one ──────── */
    /* The open space takes its rows through the family write path (outbox,
       photos, the session key). Any other space is written here with its own
       key. `c` is a review candidate; the split is the one its card showed
       (18-spaces-capture.js). */
    window.fhSpaceCaptureWrite = async function (c) {
      const fid = csvSpaceOf(c), S = _S();
      if (!S.keys[fid]) return { ok: false, error: 'locked' };
      if (!S.data[fid]) await window.fhSpaceHydrate(fid);
      const d = S.data[fid]; if (!d) return { ok: false, error: 'unread' };
      const res = csvSpaceSplitResult(c);
      if (res.mode === 'chia' && !res.ok) return { ok: false, error: 'split_' + res.err };
      const amtK = csvSpaceAmtK(c);
      const cat = (d.cats || []).find((x) => x.name === c.categoryName) || (d.cats || [])[0];
      let inst = null;
      try { inst = [csvStagedProvider(c), csvStagedAcctChip(c)].filter(Boolean).join(' · ') || null; } catch (e) {}
      return window.fhSpaceAddExpense(fid, {
        amtK: res.mode === 'chia' ? res.r.inside : amtK, note: c.description || null, catId: cat && cat.id,
        payerMemberId: window.fhSpaceMyMemberId(fid), dateIso: c.dateDisplay || undefined, time: (typeof csvRowTime === 'function' ? csvRowTime(c) : null) || null,
        source: window.fhStagedSource ? window.fhStagedSource(c) : null, inst: inst,
        shares: res.mode === 'chia' ? res.payload : null, rule: res.rule, outName: res.outName || null,
        acct: c._pAcct || null, link: c._link || null });
    };
    /* Money in that the person confirmed as a member settling up. */
    window.fhSpaceCaptureSettle = async function (c) {
      const st = c._spSettle; if (!st) return { ok: false, error: 'no_settle' };
      const fid = st.fid, S = _S();
      if (!S.keys[fid]) return { ok: false, error: 'locked' };
      if (!S.data[fid]) await window.fhSpaceHydrate(fid);
      const my = window.fhSpaceMyMemberId(fid); if (!my) return { ok: false, error: 'not_member' };
      const r = await window.fhSpaceSettle(fid, { fromMember: st.from, toMember: my, amtK: csvSpaceAmtK(c), dateIso: c.dateDisplay || undefined, acct: c._pAcct || null });
      try { window.fhSpaceAfterMoney && window.fhSpaceAfterMoney(); } catch (e) {}
      return r;
    };

    /* ── a space row tapped in the personal book ───────────────────────────── */
    const _e = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    window.fhSpaceBookRowTap = function (t) {
      const fid = String(t.src).slice(6), sp = window.fhSpaceGet(fid), S = _S();
      const name = sp ? sp.name : L('Nhóm', 'Space');
      const P = window.fhPersonalData(), dr = (P.debts || []).find((x) => x.id === t.id) || t;
      const who = dr.who || null, amt = Math.abs(Number(t.amt) || 0);
      const isOut = t.kind === 'loan' && who && !fhIsSpaceWho(who);
      let title, sub;
      if (t.kind === 'expense') { title = t.note || L('Khoản chung', 'Shared expense'); sub = L('Phần của bạn trong ', 'Your share in ') + name + ' · ' + fmt(amt) + '. ' + L('Tính vào chi tiêu của bạn.', 'Counts as your spending.'); }
      else if (isOut) { title = (t.note || L('Khoản chung', 'Shared expense')); sub = L('Phần ngoài nhóm bạn đã trả giúp · ', 'An outside share you covered · ') + fmt(amt) + '. ' + L('Không vào nhóm, không tính vào chi tiêu.', 'Not in the space, not your spending.'); }
      else if (t.kind === 'loan') { title = t.note || L('Khoản chung', 'Shared expense'); sub = (Number(t.amt) > 0 ? L('Bạn trả giúp nhóm ', 'You fronted the space ') : L('Bạn nợ nhóm ', 'You owe the space ')) + fmt(amt) + ' · ' + name + '. ' + L('Không tính vào chi tiêu.', 'Not spending.'); }
      else { title = L('Trả nợ trong nhóm', 'Settle-up'); sub = (Number(t.amt) > 0 ? L('Nhóm trả bạn ', 'The space paid you ') : L('Bạn trả nhóm ', 'You paid the space ')) + fmt(amt) + ' · ' + name + '.'; }
      let h = '<div class="sheet-h">' + _e(title) + '</div><div class="sheet-sub">' + _e(sub) + '</div>';
      if (isOut) {
        h += '<div class="field" style="margin-top:14px"><label>' + L('Ai nợ bạn phần này?', 'Who owes you this share?') + '</label><input id="sp-out-name" maxlength="40" value="' + _e(who === 'Ngoài nhóm' ? '' : who) + '" placeholder="' + L('Tên người đó', 'Their name') + '"></div>'
          + '<button type="button" class="fh-s-cta" onclick="fhSpaceOutRenameSave(\'' + t.id + '\')">' + L('Lưu tên', 'Save the name') + '</button>'
          + '<div class="dbt-note">' + L('Tên này chỉ nằm trong sổ của bạn. Khi họ trả, ghi "thu nợ" ở mục Tài sản như mọi khoản cho mượn.', 'The name stays in your own book. When they pay you back, record it under Tài sản like any other loan.') + '</div>';
      }
      if (sp) h += '<button type="button" class="fh-s-line" onclick="_closeOv();fhSpaceRowTap(\'' + fid + '\')">' + L('Mở ', 'Open ') + _e(name) + '</button>';
      else h += '<div class="dbt-note">' + L('Bạn không còn ở trong nhóm này.', 'You are no longer in this space.') + '</div>';
      h += '<div class="dbt-note">' + L('Dòng này do nhóm ghi vào sổ của bạn và tự cập nhật theo khoản chung.', 'This row is written into your book by the space and follows the shared expense.') + '</div>';
      _fhSheet(h);
    };
    window.fhSpaceOutRenameSave = async function (rowId) {
      const v = ((document.getElementById('sp-out-name') || {}).value || '').trim();
      if (!v) { window.toast && toast(L('Điền tên nhé', 'Enter a name')); return; }
      const ok = await window.fhPersonalSpaceOutRename(rowId, v);
      window._closeOv();
      window.toast && toast(ok ? L('Đã lưu tên', 'Name saved') : L('Chưa lưu được, thử lại', 'Could not save, try again'));
    };
  })();