  // ---- Saved for events (the savings pool) ----
  // Create a pure saving goal (money only) — writes saving_goals, NOT events.
  window.fhCreateGoal = async function (g) {
    try {
      const fid = window.DB.fid;
      const gr = await sb.from('saving_goals').insert({ family_id: fid, name: g.name, emoji: g.emoji, target_amount: g.target, target_date: g.date || null, created_by: (window.DB && window.DB.ownerMemberId) || null }).select('id').single();
      if (gr.error) throw gr.error;
      if (g.init > 0) {
        await _w(sb.from('event_fundings').insert({ family_id: fid, goal_id: gr.data.id, member_id: window.DB.ownerMemberId || null, amount: g.init, source: 'savings', month: null }), 'fund goal');
      }
      await loadFamilyData();
    } catch (e) { if (typeof console !== 'undefined') console.error(e); if (window.toast) window.toast('Không lưu được mục tiêu, thử lại'); }
  };
  // Add money to a goal from the savings pool.
  window.fhFundGoal = async function (goalId, amount) {
    try {
      const fid = window.DB.fid;
      await _w(sb.from('event_fundings').insert({ family_id: fid, goal_id: goalId, member_id: window.DB.ownerMemberId || null, amount: amount, source: 'savings', month: null }), 'fund goal');
      await loadFamilyData();
    } catch (e) { if (typeof console !== 'undefined') console.error(e); if (window.toast) window.toast('Không bỏ ống được, thử lại'); }
  };
  window.fhSavings = function () {
    if (!window.DB.fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    const cur = window.savings || 0;
    const shown = window.amtToInput ? window.amtToInput(cur) : String(cur);
    _fhModal({
      title: L('Để dành cho sự kiện','Saved for events'),
      body: '<div class="fh-s-sub">Money you’ve set aside to fund goals, separate from income.</div>'
        + '<div class="field"><label>Set the total to</label>'
        + '<input id="fh-sav" class="num big" inputmode="numeric" value="' + _esc(shown) + '" oninput="fhModalDirty()"></div>'
        + '<div class="field-hint">' + _esc(window.curSym ? window.curSym() : '') + ' · this replaces the pool total, it doesn’t add to it.</div>',
      valid: () => {
        const v = (document.getElementById('fh-sav').value || '').trim();
        return v !== '' && v !== shown;
      },
      save: async () => {
        const base = window.parseAmtBase ? window.parseAmtBase(document.getElementById('fh-sav').value) : 0;
        await _rpc('set_savings', { p_amount: base || 0 });
        await window.loadFamilyData();
        window.toast && window.toast(L('Đã cập nhật quỹ tiết kiệm','Savings updated'));
      }
    });
  };

  // ---- Income (separate ledger) ----
  window.fhIncome = async function () {
    const fid = window.DB.fid; if (!fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    let inc = [];
    try {
      const { data, error } = await sb.from('incomes').select('id,amount,note,income_date').eq('family_id', fid).order('income_date', { ascending: false }).limit(20);
      if (error) throw error;
      inc = data || [];
    } catch (e) { window.toast && window.toast(_friendly(e)); return; }
    const mk = (window.DB.month || '').slice(0, 7);
    const monthTotal = inc.filter((r) => String(r.income_date).slice(0, 7) === mk).reduce((s, r) => s + Number(r.amount), 0);
    const f = (n) => (window.fmt ? window.fmt(n) : n);
    const list = inc.map((r) =>
      '<div class="fh-s-row">'
      + '<div class="fh-s-grow"><div class="fh-s-name">' + _esc(r.note || 'Income') + '</div><div class="fh-s-meta">' + _esc(r.income_date) + '</div></div>'
      + '<span class="num" style="color:var(--good);font-weight:700;flex:none">+' + f(Number(r.amount)) + '</span>'
      + _btn(_ICO.trash, "fhDelIncome('" + r.id + "',this)", 'fh-s-act danger')
      + '</div>').join('');
    _fhModal({
      title: 'Income',
      saveLabel: L('Thêm','Add'),
      body: '<div class="fh-s-sub">Money coming in, tracked on its own, never auto-saved.</div>'
        + '<div class="fh-s-stat"><div class="k">This month</div><div class="v">' + f(monthTotal) + '</div></div>'
        + '<div class="field"><label>Amount</label>'
        + '<input id="fh-inc-amt" inputmode="numeric" placeholder="' + _esc(window.amtPlaceholder ? window.amtPlaceholder() : '') + '" oninput="fhModalDirty()"></div>'
        + '<div class="field"><label>Note <span class="opt">optional</span></label>'
        + '<input id="fh-inc-note" placeholder="e.g. Salary" oninput="fhModalDirty()"></div>'
        + '<div class="fh-s-lab" style="margin-top:26px">Recent</div>'
        + (list || '<div class="fh-s-empty">No income logged yet. Add your first above.</div>'),
      valid: () => {
        const b = window.parseAmtBase ? window.parseAmtBase(document.getElementById('fh-inc-amt').value) : 0;
        return b > 0;
      },
      save: async () => {
        const base = window.parseAmtBase(document.getElementById('fh-inc-amt').value);
        const note = (document.getElementById('fh-inc-note').value || '').trim() || 'Income';
        const now = new Date(window.TODAY ? window.TODAY.getTime() : Date.now());
        const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const { error } = await sb.from('incomes').insert({ family_id: window.DB.fid, member_id: window.DB.ownerMemberId || null, amount: base, note: note, income_date: iso });
        if (error) throw error;
        window.toast && window.toast(L('Đã thêm thu nhập','Income added'));
        return window.fhIncome;                            // reopen with the new row in place
      }
    });
  };
  // Deleting income is destructive and permanent → arm-then-confirm on the row itself.
  window.fhDelIncome = async function (id, btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = 'Delete?';
      clearTimeout(window._fhIncArmT);
      window._fhIncArmT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.innerHTML = _ICO.trash;
      }, 3000);
      return;
    }
    clearTimeout(window._fhIncArmT);
    try {
      const { error } = await sb.from('incomes').delete().eq('id', id);
      if (error) throw error;
    } catch (e) { window.toast && window.toast(_friendly(e)); return; }
    window.toast && window.toast(L('Đã xoá thu nhập','Income deleted'));
    window.fhIncome();
  };

  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    try {                                          // restore locale if we came back via the redirect fallback
      const loc = JSON.parse(sessionStorage.getItem('fh-ob-locale') || 'null');
      if (loc && window.applyLang) { window.LANG = loc.lang; window.CUR = loc.cur; window.applyLang(); }
    } catch (e) {}
    if (session) await afterLogin(session);        // already signed in → resume
    else { fhResumeFail(); fhWarmAbandon(); await mountGoogleButton(); }   // no session → sign-in screen
  })();

  // ── Create-family: wire the onboarding "Enter FamilyHub" step to the real RPC + inserts ──
  async function createFamilyInDB() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const uid = session.user.id;
    // always create a fresh family (multi-family: "create" means a new one)
    const { data: familyId, error } = await sb.rpc('create_family', {
      p_name: (window.FAM && window.FAM.familyName) || 'My family',
      p_currency: window.CUR || 'VND',
      p_language: window.LANG || 'vi'
    });
    if (error) throw error;
    const created = true;
    const F = window.FAM || { user: {} };
    // owner member: adopt the name + colour chosen in onboarding
    await _w(sb.from('members').update({ name: F.user.name, color: F.user.color })
      .eq('family_id', familyId).eq('user_id', uid), 'write members');
    // profile: display name, theme, language
    await _w(sb.from('profiles').update({
      display_name: F.user.name, theme: (window.curTheme || 'sage'), language: window.LANG || 'vi'
    }).eq('id', uid), 'write profiles');
    if (created) {
      // extra (non-me) members entered during onboarding
      const extras = (F.members || []).filter((m) => !m.me && (m.name || '').trim());
      if (extras.length) {
        await _w(sb.from('members').insert(extras.map((m) => ({
          family_id: familyId, name: m.name.trim(), color: m.color || null
        }))), 'write members');
      }
      // budget: current-month cap + per-category budgets (mapped by sort_order → catOrder)
      const now = new Date(window.TODAY ? window.TODAY.getTime() : Date.now());
      const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      if (F.budget) await _w(sb.from('monthly_budgets')
        .upsert({ family_id: familyId, month, budget_total: F.budget }, { onConflict: 'family_id,month' }), 'write monthly_budgets');
      const { data: cats } = await sb.from('categories').select('id, sort_order').eq('family_id', familyId);
      const order = window.catOrder || [];
      const rows = [];
      (cats || []).forEach((c) => {
        const key = order[c.sort_order - 1];
        const amt = (key && F.catBudget) ? (F.catBudget[key] || 0) : 0;
        if (amt > 0) rows.push({ family_id: familyId, month, category_id: c.id, amount: amt });
      });
      if (rows.length) await _w(sb.from('category_budgets')
        .upsert(rows, { onConflict: 'family_id,month,category_id' }), 'write category_budgets');
    }
  }

  // ── Join: finalize the joiner's member + profile (redeem already happened at obJoin) ──
  async function joinFinalizeDB() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const uid = session.user.id;
    const F = window.FAM || { user: {} };
    if (F.joinFamilyId && F.user) {
      await _w(sb.from('members').update({ name: F.user.name, color: F.user.color })
        .eq('family_id', F.joinFamilyId).eq('user_id', uid), 'write members');
    }
    await _w(sb.from('profiles').update({
      display_name: F.user.name, theme: (window.curTheme || 'sage'), language: window.LANG || 'vi'
    }).eq('id', uid), 'write profiles');
  }

  const _origFinish = window.finishOnboarding;
  window.finishOnboarding = async function () {
    const btn = document.querySelector('#onboarding .ob-screen[data-ob="done"] .cta');
    const label = btn ? btn.textContent : '';
    const busy = (on) => { if (btn) { btn.disabled = on; btn.style.opacity = on ? '.7' : ''; btn.textContent = on ? 'Setting up…' : label; } };
    try {
      if (window.FAM && window.FAM.mode === 'create') { busy(true); await createFamilyInDB(); }
      else if (window.FAM && window.FAM.mode === 'join') { busy(true); await joinFinalizeDB(); }
    } catch (e) {
      busy(false);
      // Stay on the step so the user can retry — their answers are still in the form.
      window.toast && window.toast(_friendly(e));
      return;
    }
    busy(false);
    if (typeof _origFinish === 'function') _origFinish();
    if (window.loadFamilyData) { try { await window.loadFamilyData(); } catch (e) {} }
  };

  // ── Owner: generate a shareable invite code (Settings → Invite a member) ──
  /* Sharing a code is a quick action → bottom sheet, on the app's own layer.
     The code is stable: opening this screen shows the family's existing code
     rather than minting another. Rotating is deliberate, via "Generate a new
     code" — which invalidates whatever was shared before, so it confirms. */
  window.fhInvite = async function () {
    let code;
    try { code = await _rpc('create_invite'); }
    catch (e) { window.toast && window.toast(_friendly(e)); return; }
    _fhShowInvite(code);
  };
  function _fhShowInvite(code) {
    window._fhInviteCode = code;
    _fhSheet(
      '<div class="fh-s-h">Invite code</div>'
      + '<div class="fh-s-sub">Share this with your family member. They open FamilyHub, choose “Join a family”, and enter it. It works for 14 days.</div>'
      + '<div class="fh-code-show">' + _esc(code) + '</div>'
      + _btn('Copy code', 'fhCopyInvite(this)', _S.cta)
      + _btn('Done', '_closeOv()', _S.ghost)
      + _btn('Generate a new code', 'fhRegenInvite(this)', _S.del)
    );
  }
  window.fhCopyInvite = async function (btn) {
    try { await navigator.clipboard.writeText(window._fhInviteCode || ''); btn.textContent = 'Copied ✓'; }
    catch (e) { window.toast && window.toast('Couldn’t copy, write it down instead'); }
  };
  window.fhRegenInvite = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {          // rotating kills the shared code
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa, mã cũ sẽ ngừng hoạt động','Tap again, the old code stops working');
      clearTimeout(window._fhRegenT);
      window._fhRegenT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = 'Generate a new code';
      }, 3000);
      return;
    }
    clearTimeout(window._fhRegenT);
    btn.textContent = 'Generating…'; btn.disabled = true;
    let code;
    try { code = await _rpc('regenerate_invite'); }
    catch (e) {
      btn.disabled = false; btn.classList.remove('armed'); btn.textContent = 'Generate a new code';
      window.toast && window.toast(_friendly(e)); return;
    }
    _fhShowInvite(code);
    window.toast && window.toast('New code, the old one no longer works');
  };

  // ── Joiner: code input + redeem ──
  window.obCodeInput = function (el) {
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (typeof window.renderCodeBoxes === 'function') window.renderCodeBoxes(el.value);
    const cta = document.getElementById('ob-join-cta'); if (cta) cta.disabled = el.value.length < 6;
    const pv = document.getElementById('ob-join-preview'); if (pv) pv.style.display = 'none';
  };
  window.obJoin = async function () {
    const el = document.getElementById('ob-code');
    const code = (el ? el.value : '').trim();
    if (code.length < 6) return;
    const cta = document.getElementById('ob-join-cta');
    const label = cta ? cta.textContent : '';
    if (cta) { cta.disabled = true; cta.textContent = 'Joining…'; }
    try {
      const { data, error } = await sb.rpc('redeem_invite', { p_code: code });
      if (error) throw error;
      if (window.FAM) { window.FAM.mode = 'join'; window.FAM.joinFamilyId = data.family_id; window.FAM.familyName = data.family_name || ''; }
    } catch (e) {
      // Wrong/expired codes are the common case — say so plainly, keep them on the step.
      const raw = String((e && e.message) || '');
      window.toast && window.toast(
        /invalid|not found|expired|no rows/i.test(raw) ? 'That code isn’t valid. Check it and try again' : _friendly(e)
      );
      if (cta) { cta.disabled = false; cta.textContent = label; }
      return;
    }
    if (cta) { cta.disabled = false; cta.textContent = label; }
    const back = document.getElementById('ob-profile-back'); if (back) back.setAttribute('onclick', "obGo('join')");
    if (typeof window.obPrefillProfile === 'function') window.obPrefillProfile();
    window.obGo('profile');
  };

  sb.auth.onAuthStateChange(() => {});
  // test helper: run fhSignOut() in the console to switch Google accounts
  window.fhSignOut = async () => { fhResumeFail(); fhWarmAbandon(); await sb.auth.signOut(); location.reload(); };