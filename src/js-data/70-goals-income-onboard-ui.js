  // ---- Saved for events (the savings pool) ----
  // Create a pure saving goal (money only) — writes saving_goals, NOT events.
  window.fhCreateGoal = async function (g) {
    if (_fhWriteLocked()) return;
    try {
      const fid = window.DB.fid;
      const row = Object.assign(
        { family_id: fid, emoji: g.emoji, target_date: g.date || null, created_by: (window.DB && window.DB.ownerMemberId) || null },
        await fhField('name', g.name), await fhField('target_amount', g.target));
      const gr = await sb.from('saving_goals').insert(row).select('id').single();
      if (gr.error) throw gr.error;
      if (g.init > 0) {
        await _w(sb.from('event_fundings').insert(Object.assign({ family_id: fid, goal_id: gr.data.id, member_id: window.DB.ownerMemberId || null, source: 'savings', month: null }, await fhField('amount', g.init))), 'fund goal');
      }
      await loadFamilyData();
    } catch (e) {
      if (typeof console !== 'undefined') console.error(e);
      if (/enc_required/i.test(String((e && e.message) || '')) && window._fhEncRecover) { window._fhEncRecover(); if (window.toast) window.toast(_friendly(e)); }
      else if (window.toast) window.toast('Không lưu được mục tiêu, thử lại');
    }
  };
  // Add money to a goal from the savings pool.
  window.fhFundGoal = async function (goalId, amount) {
    if (_fhWriteLocked()) return;
    try {
      const fid = window.DB.fid;
      await _w(sb.from('event_fundings').insert(Object.assign({ family_id: fid, goal_id: goalId, member_id: window.DB.ownerMemberId || null, source: 'savings', month: null }, await fhField('amount', amount))), 'fund goal');
      await loadFamilyData();
    } catch (e) {
      if (typeof console !== 'undefined') console.error(e);
      if (/enc_required/i.test(String((e && e.message) || '')) && window._fhEncRecover) { window._fhEncRecover(); if (window.toast) window.toast(_friendly(e)); }
      else if (window.toast) window.toast('Không bỏ ống được, thử lại');
    }
  };
  window.fhSavings = function () {
    if (!window.DB.fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    if (_fhWriteLocked()) return;
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
        /* set_savings computes the pool delta in SQL — impossible once amounts
           are ciphertext. With encryption on, the client already knows the pool
           (window.savings, decrypted at hydrate), so it writes the adjusting
           entry itself; the plain RPC stays for unencrypted families. */
        if (fhEncState() !== 'off' && fhKeyReady()) {
          const delta = (base || 0) - (window.savings || 0);
          if (delta !== 0) {
            const now = new Date(window.TODAY ? window.TODAY.getTime() : Date.now());
            const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
            await _w(sb.from('savings_entries').insert(Object.assign(
              { family_id: window.DB.fid, member_id: window.DB.ownerMemberId || null, kind: delta > 0 ? 'deposit' : 'withdrawal', entry_date: iso },
              await fhField('amount', Math.abs(delta)), await fhField('note', 'Adjust savings'))), 'write savings_entries');
          }
        } else {
          await _rpc('set_savings', { p_amount: base || 0 });
        }
        await window.loadFamilyData();
        window.toast && window.toast(L('Đã cập nhật quỹ tiết kiệm','Savings updated'));
      }
    });
  };

  // ---- Income (separate ledger) ----
  window.fhIncome = async function () {
    const fid = window.DB.fid; if (!fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    if (_fhWriteLocked()) return;                            // the sheet both lists and ADDS income
    let inc = [];
    try {
      const { data, error } = await sb.from('incomes').select('id,amount,amount_enc,note,note_enc,income_date').eq('family_id', fid).order('income_date', { ascending: false }).limit(20);
      if (error) throw error;
      inc = data || [];
      for (const r of inc) {                                 // resolve ciphertext for display
        r.amount = Number(await fhRead(r, 'amount')) || 0;
        r.note = await fhRead(r, 'note');
      }
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
        const { error } = await sb.from('incomes').insert(Object.assign(
          { family_id: window.DB.fid, member_id: window.DB.ownerMemberId || null, income_date: iso },
          await fhField('amount', base), await fhField('note', note)));
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
    /* The RPC switched the ACTIVE family server-side. Mirror that locally now —
       a stale DB.enc from a previously-open family must never drive the new
       family's writes (fhField keys off DB.enc/DB.fid). */
    window.DB.fid = familyId;
    window.DB.enc = null;
    // owner member: adopt the name + colour chosen in onboarding
    await _w(sb.from('members').update({ name: F.user.name, color: F.user.color })
      .eq('family_id', familyId).eq('user_id', uid), 'write members');
    // profile: display name, theme, language
    await _w(sb.from('profiles').update({
      display_name: F.user.name, theme: (window.curTheme || 'sage'), language: window.LANG || 'vi'
    }).eq('id', uid), 'write profiles');
    /* Default-on encryption (0032): the onboarding passcode step is mandatory,
       and a brand-new family has no history to migrate — so it starts at
       enc_state 'enc' and is ciphertext-only from its very first write. The
       budget writes below therefore run AFTER the key exists. A failure here
       degrades gracefully: the family works unencrypted and Settings offers
       the passcode again. */
    if (F.passcode && window.FHCrypto) {
      try {
        const salt = FHCrypto.genSaltHex();
        const keys = await FHCrypto.deriveKeys(F.passcode, salt, FH_KDF_ITERS, FH_KDF_VERSION);
        const dekRaw = await FHCrypto.genDekRaw();
        const wrapped = await FHCrypto.wrapDek(dekRaw, keys.kWrap);
        await _rpc('set_family_passcode', { p_k_auth: keys.kAuthHex, p_kdf_salt: salt, p_kdf_iters: FH_KDF_ITERS, p_kdf_version: FH_KDF_VERSION, p_wrapped_dek: wrapped, p_enc_state: 'enc' });
        await fhKeyAdopt(familyId, dekRaw);
        window.DB.enc = { enc_state: 'enc', kdf_salt: salt, kdf_iters: FH_KDF_ITERS, kdf_version: FH_KDF_VERSION, wrapped_dek: wrapped };
      } catch (e) {
        console.warn('passcode setup failed', e);
        window.toast && window.toast(L('Chưa đặt được mã gia đình — đặt lại trong Cài đặt nhé', 'Couldn’t set the passcode — set it again from Settings'));
      } finally { F.passcode = null; }
    }
    if (created) {
      // extra (non-me) members entered during onboarding
      const extras = (F.members || []).filter((m) => !m.me && (m.name || '').trim());
      if (extras.length) {
        await _w(sb.from('members').insert(extras.map((m) => ({
          family_id: familyId, name: m.name.trim(), color: m.color || null
        }))), 'write members');
      }
      // budget: current-month cap + per-category budgets (mapped by sort_order → catOrder);
      // fhField makes these ciphertext-only when the family started encrypted
      const now = new Date(window.TODAY ? window.TODAY.getTime() : Date.now());
      const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      if (F.budget) {
        const mbf = await fhField('budget_total', F.budget);
        if (mbf.budget_total == null) mbf.budget_total = 0;   // plaintext cap column stays NOT NULL
        await _w(sb.from('monthly_budgets')
          .upsert(Object.assign({ family_id: familyId, month }, mbf), { onConflict: 'family_id,month' }), 'write monthly_budgets');
      }
      const { data: cats } = await sb.from('categories').select('id, sort_order').eq('family_id', familyId);
      const order = window.catOrder || [];
      const rows = [];
      for (const c of (cats || [])) {
        const key = order[c.sort_order - 1];
        const amt = (key && F.catBudget) ? (F.catBudget[key] || 0) : 0;
        if (amt > 0) rows.push(Object.assign({ family_id: familyId, month, category_id: c.id }, await fhField('amount', amt)));
      }
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

  /* Invite + join now live in 65-passcode-ui.js (whitelist + 6-digit passcode
     door, 0030). The old create_invite / redeem_invite code path was retired
     server-side in the same migration. */

  sb.auth.onAuthStateChange(() => {});
  // test helper: run fhSignOut() in the console to switch Google accounts
  window.fhSignOut = async () => {
    fhResumeFail(); fhWarmAbandon();
    try { fhKeyDrop(null); indexedDB.deleteDatabase('fh-keys'); } catch (e) {}   // cached family keys go with the session
    await sb.auth.signOut(); location.reload();
  };