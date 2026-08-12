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
      // a new goal is a proposal — nudge the family's closed-app devices to review it
      if (window.fhNotify) window.fhNotify('request_new', { et: 'goal', eid: gr.data.id });
      if (g.init > 0) {
        await _w(sb.from('event_fundings').insert(Object.assign({ family_id: fid, goal_id: gr.data.id, member_id: window.DB.ownerMemberId || null, source: 'savings', month: null }, await fhField('amount', g.init))), 'fund goal');
      }
      await loadFamilyData();
    } catch (e) {
      if (typeof console !== 'undefined') console.error(e);
      if (/enc_required/i.test(String((e && e.message) || '')) && window._fhEncRecover) { window._fhEncRecover(); if (window.toast) window.toast(_friendly(e)); }
      else if (window.toast) window.toast(L('Không lưu được mục tiêu, thử lại','Couldn’t save the goal, try again'));
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
      else if (window.toast) window.toast(L('Không bỏ ống được, thử lại','Couldn’t add to savings, try again'));
    }
  };
  // Edit a goal's name / target / date. Reuses the existing update RLS policy
  // (0020); name + target_amount go through fhField so they stay encrypted for
  // encrypted families, exactly like fhCreateGoal. target_date stays plain.
  window.fhEditGoal = function (id) {
    if (!window.DB.fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    if (_fhWriteLocked()) return;
    const g = (window.goals || {})[id]; if (!g) return;
    const shownAmt = window.amtToInput ? window.amtToInput(g.target) : String(g.target);
    const shownDate = g.d && window.isoDate ? window.isoDate(g.d) : '';
    _fhModal({
      title: L('Sửa mục tiêu','Edit goal'),
      body: '<div class="field"><label>' + L('Tên mục tiêu','Goal name') + '</label>'
        + '<input id="fh-eg-name" value="' + _esc(g.name) + '" placeholder="' + _esc(L('vd. Chuyến đi Đà Nẵng','e.g. Trip to Da Nang')) + '" oninput="fhModalDirty()"></div>'
        + '<div class="field"><label>' + L('Số tiền mục tiêu','Target amount') + '</label>'
        + '<input id="fh-eg-amt" class="num" inputmode="numeric" value="' + _esc(shownAmt) + '" placeholder="' + _esc(window.amtPlaceholder ? window.amtPlaceholder() : '') + '" oninput="fhModalDirty()" onblur="snapAmtInput(this)"></div>'
        + '<div class="field"><label>' + L('Ngày (không bắt buộc)','Date (optional)') + '</label>'
        + '<input id="fh-eg-date" type="date" value="' + _esc(shownDate) + '" oninput="fhModalDirty()"></div>',
      required: () => [
        { el: 'fh-eg-name', ok: !!(document.getElementById('fh-eg-name').value || '').trim() },
        { el: 'fh-eg-amt', ok: (window.parseAmtBase ? window.parseAmtBase(document.getElementById('fh-eg-amt').value) : 0) > 0 }
      ],
      reqMsg: L('Hãy nhập tên và số tiền mục tiêu','Add a name and target amount'),
      dirty: () => {                                          // no changes → just dismiss, no redundant write
        const nm = (document.getElementById('fh-eg-name').value || '').trim();
        const amt = window.parseAmtBase ? window.parseAmtBase(document.getElementById('fh-eg-amt').value) : 0;
        const dt = document.getElementById('fh-eg-date').value || '';
        return nm !== g.name || amt !== g.target || dt !== shownDate;
      },
      save: async () => {
        const nm = (document.getElementById('fh-eg-name').value || '').trim();
        const amt = window.parseAmtBase(document.getElementById('fh-eg-amt').value);
        const dt = document.getElementById('fh-eg-date').value || null;
        const row = Object.assign({ target_date: dt }, await fhField('name', nm), await fhField('target_amount', amt));
        await _w(sb.from('saving_goals').update(row).eq('id', id).eq('family_id', window.DB.fid), 'edit goal');
        await loadFamilyData();
        if (window.renderGoalDetailIfOpen) window.renderGoalDetailIfOpen();
        window.toast && window.toast(L('Đã cập nhật mục tiêu','Goal updated'));
      }
    });
  };
  // Delete (archive) a goal: soft-delete + full funding reversal via archive_goal
  // (0037), mirroring fhDeleteEvent. Confirm names the exact consequence.
  window.fhDeleteGoal = function (id) {
    const g = (window.goals || {})[id]; if (!g) return;
    window._fhDelGoalId = id;
    const f = (n) => (window.fmt ? window.fmt(n) : n);
    const lines = [];
    if (g.saved > 0) lines.push('<b>' + f(g.saved) + '</b> ' + L('sẽ trả lại quỹ tiết kiệm.','goes back to your savings.'));
    else lines.push(L('Chưa có gì được góp cho mục tiêu này.','Nothing has been put toward this goal yet.'));
    _fhSheet(
      '<div class="fh-s-h">' + L('Xoá “','Delete “') + _esc(g.name) + '”?</div>'
      + '<div class="fh-s-sub">' + lines.join('<br>') + '</div>'
      + _btn(L('Giữ mục tiêu','Keep goal'), '_closeOv()', _S.cta)
      + _btn(L('Xoá mục tiêu','Delete goal'), 'fhConfirmDeleteGoal(this)', _S.del)
    );
  };
  window.fhConfirmDeleteGoal = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {          // first tap arms, second confirms
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để xoá','Tap again to delete');
      clearTimeout(window._fhDelGoalArmT);
      window._fhDelGoalArmT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Xoá mục tiêu','Delete goal');
      }, 3000);
      return;
    }
    clearTimeout(window._fhDelGoalArmT);
    const id = window._fhDelGoalId;
    const g = (window.goals || {})[id]; if (!g) { window._closeOv(); return; }
    if (btn) { btn.textContent = L('Đang xoá…','Deleting…'); btn.disabled = true; }
    try { if (g._dbId) await _rpc('archive_goal', { p_goal_id: g._dbId }); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = L('Xoá mục tiêu','Delete goal'); }
      window.toast && window.toast(_friendly(e)); return;
    }
    window._closeOv();
    if (window.closeGoalDetail) window.closeGoalDetail();
    await window.loadFamilyData();
    window.toast && window.toast(L('Đã xoá mục tiêu','Goal deleted'));
  };
  window.fhSavings = function () {
    if (!window.DB.fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    if (_fhWriteLocked()) return;
    const cur = window.savings || 0;
    const shown = window.amtToInput ? window.amtToInput(cur) : String(cur);
    _fhModal({
      title: L('Để dành cho sự kiện','Saved for events'),
      body: '<div class="fh-s-sub">' + L('Tiền bạn để riêng ra để góp cho các mục tiêu, tách khỏi thu nhập.','Money you’ve set aside to fund goals, separate from income.') + '</div>'
        + '<div class="field"><label>' + L('Đặt tổng quỹ thành','Set the total to') + '</label>'
        + '<input id="fh-sav" class="num big" inputmode="numeric" value="' + _esc(shown) + '" oninput="fhModalDirty()"></div>'
        + '<div class="field-hint">' + _esc(window.curSym ? window.curSym() : '') + ' · ' + L('số này thay cho tổng quỹ, không cộng thêm.','this replaces the pool total, it doesn’t add to it.') + '</div>',
      required: () => [{ el: 'fh-sav', ok: (document.getElementById('fh-sav').value || '').trim() !== '' }],
      reqMsg: L('Hãy nhập số tiền quỹ','Add an amount'),
      dirty: () => (document.getElementById('fh-sav').value || '').trim() !== shown,   // unchanged → just dismiss
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
              await fhField('amount', Math.abs(delta)), await fhField('note', L('Điều chỉnh quỹ tiết kiệm','Adjust savings')))), 'write savings_entries');
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
      + '<div class="fh-s-grow"><div class="fh-s-name">' + _esc(r.note || L('Thu nhập','Income')) + '</div><div class="fh-s-meta">' + _esc(r.income_date) + '</div></div>'
      + '<span class="num" style="color:var(--good);font-weight:700;flex:none">+' + f(Number(r.amount)) + '</span>'
      + _btn(_ICO.trash, "fhDelIncome('" + r.id + "',this)", 'fh-s-act danger')
      + '</div>').join('');
    _fhModal({
      title: L('Thu nhập','Income'),
      saveLabel: L('Thêm','Add'),
      body: '<div class="fh-s-sub">' + L('Tiền vào của cả nhà, ghi riêng, không tự động để dành.','Money coming in, tracked on its own, never auto-saved.') + '</div>'
        + '<div class="fh-s-stat"><div class="k">' + L('Tháng này','This month') + '</div><div class="v">' + f(monthTotal) + '</div></div>'
        + '<div class="field"><label>' + L('Số tiền','Amount') + '</label>'
        + '<input id="fh-inc-amt" inputmode="numeric" placeholder="' + _esc(window.amtPlaceholder ? window.amtPlaceholder() : '') + '" oninput="fhModalDirty()"></div>'
        + '<div class="field"><label>' + L('Ghi chú','Note') + ' <span class="opt">' + L('tuỳ chọn','optional') + '</span></label>'
        + '<input id="fh-inc-note" placeholder="' + _esc(L('vd. Lương','e.g. Salary')) + '" oninput="fhModalDirty()"></div>'
        + '<div class="fh-s-lab" style="margin-top:26px">' + L('Gần đây','Recent') + '</div>'
        + (list || '<div class="fh-s-empty">' + L('Chưa ghi khoản thu nào. Thêm khoản đầu tiên ở trên nhé.','No income logged yet. Add your first above.') + '</div>'),
      required: () => [{ el: 'fh-inc-amt', ok: (window.parseAmtBase ? window.parseAmtBase(document.getElementById('fh-inc-amt').value) : 0) > 0 }],
      reqMsg: L('Hãy nhập số tiền','Add an amount'),
      save: async () => {
        const base = window.parseAmtBase(document.getElementById('fh-inc-amt').value);
        const note = (document.getElementById('fh-inc-note').value || '').trim() || L('Thu nhập','Income');
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
      btn.classList.add('armed'); btn.textContent = L('Xoá?','Delete?');
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
      p_name: (window.FAM && window.FAM.familyName) || L('Gia đình của mình','My family'),
      p_currency: 'VND',                             // VND-only frontend — every new family is created in VND
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
    /* Key Card (0042/0043): a brand-new family is born on the CARD, not a
       passcode — no history to migrate, ciphertext-only from its first write.
       Generate a card, wrap a fresh DEK, create the enc row + card wrap in one
       RPC (init_family_card), adopt the key, cache the card on this device, and
       stash it for the intro screen the finish handler shows next. The budget
       writes below run AFTER the key exists, so they are ciphertext. A failure
       degrades gracefully: Settings can create the card later. */
    if (window.FHCrypto && FHCrypto.genCard) {
      try {
        const card = FHCrypto.genCard();
        const salt = FHCrypto.genSaltHex();
        const keys = await FHCrypto.deriveKeys(card.key, salt, FH_KDF_ITERS_CARD, FH_KDF_VERSION);
        const dekRaw = await FHCrypto.genDekRaw();
        const wrapped = await FHCrypto.wrapDek(dekRaw, keys.kWrap);
        await _rpc('init_family_card', { p_kdf_salt: salt, p_kdf_iters: FH_KDF_ITERS_CARD, p_kdf_version: FH_KDF_VERSION, p_wrapped_dek: wrapped });
        await fhKeyAdopt(familyId, dekRaw);
        if (window.fhCardCacheStore) window.fhCardCacheStore(familyId, card.display);
        window.DB.enc = { enc_state: 'enc', kdf_salt: null, kdf_iters: null, kdf_version: null, wrapped_dek: null };
        window.DB.keyWraps = [{ kind: 'card', kdf_salt: salt, kdf_iters: FH_KDF_ITERS_CARD, kdf_version: FH_KDF_VERSION, wrapped_dek: wrapped }];
        window.__fhNewCard = card;   // the intro screen (shown after onboarding) saves it
      } catch (e) {
        console.warn('card setup failed', e);
        window.toast && window.toast(L('Chưa tạo được mã khóa, bạn tạo lại trong Cài đặt nhé', 'Couldn’t create the family code. Make it again from Settings'));
      }
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
      /* members.name is encrypted for an encrypted family — writing plaintext there
         trips the 0033 enc-text guard (enc_required). color is never encrypted, so
         it always rides along. The name:
           • non-enc family  → plaintext, as before;
           • enc + key ready (passcode join) → fhField gives {name:null, name_enc};
           • enc + no key (card join, key comes later) → skip it. The RPC already
             seeded a name, and the joiner can set theirs in Settings → My profile
             once the card unlocks the family. */
      const enc = !!(F.joinEncState && F.joinEncState !== 'off');
      const row = { color: F.user.color };
      if (!enc) row.name = F.user.name;
      else if (window.fhKeyReady && window.fhKeyReady() && window.fhField) Object.assign(row, await window.fhField('name', F.user.name));
      await _w(sb.from('members').update(row).eq('family_id', F.joinFamilyId).eq('user_id', uid), 'write members');
    }
    await _w(sb.from('profiles').update({
      display_name: F.user.name, theme: (window.curTheme || 'sage'), language: window.LANG || 'vi'
    }).eq('id', uid), 'write profiles');
  }

  const _origFinish = window.finishOnboarding;
  window.finishOnboarding = async function () {
    // One primary CTA drives both paths now (Join in invite mode, Create in create
    // mode) — #ob-primary-cta. The done screen is gone (0050).
    const btn = document.getElementById('ob-primary-cta');
    const label = btn ? btn.textContent : '';
    const busy = (on) => { if (btn) { btn.disabled = on; btn.style.opacity = on ? '.7' : ''; btn.textContent = on ? L('Đang thiết lập…','Setting up…') : label; } };
    try {
      if (window.FAM && window.FAM.mode === 'create') { busy(true); await createFamilyInDB(); }
      else if (window.FAM && window.FAM.mode === 'join') { busy(true); await joinFinalizeDB(); }
    } catch (e) {
      busy(false);
      window.toast && window.toast(_friendly(e));
      /* Create: stay on the step so the user can retry — the name is still in the form.
         Join: the join itself already COMMITTED (join_with_* succeeded before this ran;
         only the cosmetic member/profile finalize failed). Staying would dead-end them —
         find_my_invite now returns nothing, and the screen would read "start your own",
         inviting a duplicate family. Enter the app; name/theme self-heal in Settings. */
      if (!(window.FAM && window.FAM.mode === 'join' && window.FAM.joinFamilyId)) return;
    }
    busy(false);
    if (typeof _origFinish === 'function') _origFinish();
    if (window.loadFamilyData) { try { await window.loadFamilyData(); } catch (e) {} }
    // proactively introduce + save the new family's Key Card (the USP moment)
    if (window.__fhNewCard && window.fhCardShow) {
      const _c = window.__fhNewCard; window.__fhNewCard = null;
      setTimeout(() => { try { window.fhCardShow(_c); } catch (e) {} }, 700);
    }
  };

  /* Invite + join now live in 65-passcode-ui.js (whitelist + 6-digit passcode
     door, 0030). The old create_invite / redeem_invite code path was retired
     server-side in the same migration. */

  sb.auth.onAuthStateChange(() => {});
  // test helper: run fhSignOut() in the console to switch Google accounts
  window.fhSignOut = async () => {
    fhResumeFail(); fhWarmAbandon();
    try { fhKeyDrop(null); indexedDB.deleteDatabase('fh-keys'); } catch (e) {}   // cached family keys go with the session
    try { if (window.fhSnapClear) await window.fhSnapClear(); else localStorage.removeItem('fh-snap'); localStorage.removeItem('fh-expense-drafts'); } catch (e) {}   // no family data left behind on a shared device (awaited so the IndexedDB copy is gone before the reload below)
    try { window.__fhPhotoCachePurge && window.__fhPhotoCachePurge(); } catch (e) {}
    await sb.auth.signOut(); location.reload();
  };