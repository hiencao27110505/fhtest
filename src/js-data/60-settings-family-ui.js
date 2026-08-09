  // ═══ feature UIs: manage family/members, saved-for-events, income ═══════════
  /* Settings UI runs on the app's own layers (DESIGN §4), not a bespoke overlay:
     quick menus + destructive confirms → #fh-sheet, multi-field forms → #fh-modal.
     Both live inside .phone, so they stay in the device frame on desktop, inherit
     drag-to-dismiss from initSheetDrag, and sit *below* the toast (z-80) so errors
     raised from inside them are actually visible. */
  // Shared with js-ui: the canonical escapers live in 12-format-helpers.js and are
  // mirrored onto window by the classic script that runs before this module. Delegate
  // (arrow, resolved at call-time) so there is exactly one escaping implementation.
  const _esc = (s) => window.esc(s);
  const _escAttr = (s) => window.escAttr(s);
  const _pal = () => window.OB_COLORS || ['#6f3fc0', '#0e8478', '#f0701a', '#e03d86', '#1e74d0', '#B8730B', '#7A5AE0', '#1a9d5f'];

  function _fhSheet(inner) {
    const body = document.getElementById('fh-sheet-body'); if (!body) return;
    body.innerHTML = inner;
    document.getElementById('scrim').classList.add('on');
    document.getElementById('fh-sheet').classList.add('on');
  }
  window._closeOv = () => {
    const s = document.getElementById('fh-sheet');
    if (s) { s.classList.remove('on'); s.style.transform = ''; s.style.transition = ''; }
    const m = document.getElementById('fh-modal');
    if (m) { m.classList.remove('on'); m.style.transform = ''; m.style.transition = ''; }
    if (!document.querySelector('.sheet.on, .modal.on')) document.getElementById('scrim').classList.remove('on');
    _fhModalCtx = null;
  };

  /* Form modal: Cancel · Title · Save. Save stays enabled (DESIGN §4.4) — it is never
     greyed to signal a missing field. Callers pass:
       required() → [{el, ok}] rules for fhCheck; on Save it flags+shakes the missing
                    fields and toasts `reqMsg` instead of the button doing nothing.
       dirty()    → true when there's a real change worth writing; if it returns false
                    (and required passes), Save just closes with no pointless RPC. */
  let _fhModalCtx = null;
  function _fhModal(opts) {
    _fhModalCtx = opts;                                  // {title, body, required(), reqMsg, dirty(), save(), saveLabel}
    document.getElementById('fh-modal-title').textContent = opts.title;
    document.getElementById('fh-modal-body').innerHTML = opts.body;
    const save = document.getElementById('fh-modal-save');
    save.textContent = opts.saveLabel || L('Lưu','Save');
    save.disabled = false;
    document.getElementById('scrim').classList.add('on');
    const m = document.getElementById('fh-modal');
    m.classList.add('on'); m.style.transform = ''; m.style.transition = '';
    m.querySelector('.modal-body').scrollTop = 0;
    if (opts.after) opts.after();
    window.fhModalDirty();
  }
  // Called by the form's inputs via oninput — clear any red flag as the user fixes fields.
  window.fhModalDirty = function () {
    if (typeof window.fhClearInvalid === 'function') window.fhClearInvalid('fh-modal-body');
  };
  window.fhModalClose = () => window._closeOv();
  window.fhModalSave = async function () {
    if (!_fhModalCtx || !_fhModalCtx.save) return;
    const save = document.getElementById('fh-modal-save'), ctx = _fhModalCtx;
    // Required-field gate: flag + shake the missing fields, never a dead button (DESIGN §4.4).
    if (ctx.required && typeof window.fhCheck === 'function' && !window.fhCheck(ctx.required(), ctx.reqMsg)) return;
    // Nothing actually changed → dismiss without a redundant write.
    if (ctx.dirty && !ctx.dirty()) { window._closeOv(); return; }
    save.disabled = true; save.textContent = L('Đang lưu…','Saving…');   // async writes show progress (HIG)
    let then;
    try { then = await ctx.save(); }
    catch (e) {
      save.textContent = ctx.saveLabel || L('Lưu','Save'); save.disabled = false;
      // enc_required through a modal form (income, savings): keep the form open
      // as usual AND run recovery so the app updates/unlocks for the retry
      if (/enc_required/i.test(String((e && e.message) || '')) && window._fhEncRecover) window._fhEncRecover();
      window.toast && window.toast(_friendly(e));         // recoverable: modal stays open
      return;
    }
    save.textContent = ctx.saveLabel || L('Lưu','Save');
    window._closeOv();
    // A save may ask to reopen the screen (e.g. Income, to show the new row).
    // Run it *after* the close so it isn't torn down by its own dismissal.
    if (typeof then === 'function') setTimeout(then, 0);
  };

  /* Never show raw PostgREST/Postgres text to a user (DESIGN §6). */
  function _friendly(e) {
    if (e && e.fhMsg) return e.fhMsg;                       // deliberately localized app errors pass through
    const raw = String((e && (e.message || e.error_description)) || e || '');
    // 0033 DB trigger: a plaintext money write reached an encrypted family
    // (stale build or missing key) — tell the user what actually unblocks them.
    if (/enc_required/i.test(raw)) return L('Gia đình đã bật mã hóa. Đóng mở lại app cho bản mới nhất rồi nhập mã 6 số nhé','Encryption is on. Reopen the app for the latest version, then enter the 6-digit code');
    if (/row-level security|permission denied|not authorized/i.test(raw)) return L('Bạn không có quyền cho thao tác này','You don’t have permission for that');
    if (/duplicate key|already exists/i.test(raw)) return L('Mục này đã tồn tại','That already exists');
    // iOS Safari reports an offline fetch as "Load failed" (not "Failed to fetch"),
    // so match that too, and treat navigator offline as a connection issue outright.
    if (navigator.onLine === false || /network|fetch|timeout|failed to fetch|load failed|networkerror|connection/i.test(raw)) return L('Không có kết nối, thử lại','No connection, try again');
    return L('Có lỗi xảy ra, thử lại','Something went wrong, try again');
  }
  window._fhFriendly = _friendly;

  /* Buttons use the design system's own classes — no inline hex, so themes apply. */
  const _btn = (label, onclick, cls, style) =>
    '<button class="' + (cls || '') + '" onclick="' + onclick + '"' + (style ? ' style="' + style + '"' : '') + '>' + label + '</button>';
  const _S = {
    cta: 'fh-s-cta',            // primary, brand gradient pill
    line: 'fh-s-line',          // secondary, brand outline pill
    ghost: 'fh-s-ghost',        // tertiary text
    del: 'ex-del fh-s-del'      // destructive: low-prominence text, arm-then-confirm
  };
  // UI icons are inline SVG, never emoji (DESIGN §2.6).
  const _svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const _ICO = {
    trash: _svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')
  };

  // ---- Delete an event: soft delete (archived_at) + full funding reversal ----
  // Confirmation names the exact consequences rather than asking a generic "are you sure".
  window.fhDeleteEvent = function (key) {
    const k = key || window.curEvent; const ev = window.events[k]; if (!ev) return;
    window._fhDelEvKey = k;
    const f = (n) => (window.fmt ? window.fmt(n) : n);
    const lines = [];
    if (ev.fromSavings > 0) lines.push('<b>' + f(ev.fromSavings) + '</b> '+L('sẽ trả lại quỹ tiết kiệm.','goes back to your savings.'));
    if (ev.fromBudget > 0) lines.push('<b>' + f(ev.fromBudget) + '</b> '+L('sẽ trừ khỏi chi tiêu.','comes off your spending.'));
    const nm = (ev.memories || []).length;
    if (nm) lines.push(nm + (isVi()?(' ảnh sẽ bị xoá khỏi Kỷ niệm.'):(' photo' + (nm > 1 ? 's' : '') + ' will be removed from Memories.')));
    if (!lines.length) lines.push(L('Chưa có gì được góp cho mục tiêu này.','Nothing has been put toward this goal yet.'));
    // Cancel is the prominent action; delete is low-prominence text + arm-then-confirm (DESIGN §3).
    _fhSheet(
      '<div class="fh-s-h">'+L('Xoá “','Delete “') + _esc(ev.name) + '”?</div>'
      + '<div class="fh-s-sub">' + lines.join('<br>') + '</div>'
      + _btn(L('Giữ sự kiện','Keep event'), '_closeOv()', _S.cta)
      + _btn(L('Xoá sự kiện','Delete event'), 'fhConfirmDeleteEvent(this)', _S.del)
    );
  };
  window.fhConfirmDeleteEvent = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {        // first tap arms, second confirms
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để xoá','Tap again to delete');
      clearTimeout(window._fhDelArmT);
      window._fhDelArmT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Xoá sự kiện','Delete event');
      }, 3000);
      return;
    }
    clearTimeout(window._fhDelArmT);
    const ev = window.events[window._fhDelEvKey];
    if (!ev) { window._closeOv(); return; }
    if (btn) { btn.textContent = L('Đang xoá…','Deleting…'); btn.disabled = true; }
    try { if (ev._dbId) await _rpc('archive_event', { p_event_id: ev._dbId }); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = L('Xoá sự kiện','Delete event'); }
      window.toast && window.toast(_friendly(e)); return;
    }
    window._closeOv();
    if (typeof window.closeEvent === 'function') window.closeEvent();
    await window.loadFamilyData();
    window.toast && window.toast(L('Đã xoá sự kiện','Event deleted'));
  };

  // ---- Manage family & members ----
  window.fhManageFamily = async function () {
    const fid = window.DB.fid, uid = window.fhUser && window.fhUser.id;
    if (!fid) { window.toast && window.toast(L('Hãy mở một gia đình trước','Open a family first')); return; }
    const [famR, memR] = await Promise.all([
      sb.from('families').select('owner_id,name').eq('id', fid).maybeSingle(),
      sb.from('members').select('id,name,name_enc,color,is_shared,user_id').eq('family_id', fid).is('archived_at', null).order('created_at')
    ]);
    const fam = famR.data, mems = memR.data || [];
    for (const m of mems) { m.name = (await fhRead(m, 'name')) || (m.is_shared ? 'Shared' : L('Thành viên', 'Member')); }
    const owner = fam && fam.owner_id === uid;
    window._fhMembers = mems;
    const rows = mems.map((m) => {
      const isSelf = m.user_id === uid;
      const tag = m.is_shared ? L('chung','shared') : (m.user_id ? (isSelf ? L('bạn','you') : L('thành viên','member')) : L('chỗ trống','seat'));
      return '<div class="fh-s-row">'
        + '<div class="av av-32" style="background:' + _esc(m.color || '#8f8a99') + '">' + _esc(inits(m.name)) + '</div>'
        + '<div class="fh-s-grow"><div class="fh-s-name">' + _esc(m.name) + '</div><div class="fh-s-meta">' + tag + '</div></div>'
        + ((owner || isSelf) && !m.is_shared ? _btn(L('Sửa','Edit'), "fhEditMember('" + m.id + "')", 'fh-s-edit') : '')
        + (owner && !isSelf && !m.is_shared
            ? _btn(_ICO.trash, "fhArchiveMember('" + m.id + "',this)", 'fh-s-act danger')
            : '')
        + '</div>';
    }).join('');
    let html = '<div class="fh-s-h">' + _esc(fam ? fam.name : L('Gia đình','Family')) + '</div>'
      + '<div class="fh-s-lab" style="margin-top:14px">'+L('Thành viên','Members')+'</div>' + rows;
    if (owner) html += _btn(L('Thêm thành viên','Add member'), 'fhAddMember()', _S.line);
    html += _btn(L('Xong','Done'), '_closeOv()', _S.cta);
    html += _btn(L('Rời gia đình này','Leave this family'), 'fhLeaveFamily(this)', _S.del);
    if (owner) html += _btn(L('Xoá gia đình','Delete family'), 'fhDeleteFamily(this)', _S.del);
    _fhSheet(html);
  };

  /* Settings → My profile: edit your own name + color (avatar picker added in a
     later phase). Onboarding no longer asks for these — the name is seeded from
     the Google account — so this is where a member changes how the family sees
     them. Opens the shared member editor pointed at the current user's own row. */
  window.fhMyProfile = async function () {
    const fid = window.DB && window.DB.fid, uid = window.fhUser && window.fhUser.id;
    if (!fid || !uid) { window.toast && window.toast(L('Hãy mở một gia đình trước', 'Open a family first')); return; }
    const { data: me } = await sb.from('members')
      .select('id,name,name_enc,color,is_shared,user_id')
      .eq('family_id', fid).eq('user_id', uid).eq('is_shared', false).maybeSingle();
    if (!me) { window.toast && window.toast(L('Không tìm thấy hồ sơ của bạn', 'Couldn’t find your profile')); return; }
    me.name = (await fhRead(me, 'name')) || L('Thành viên', 'Member');
    window._fhMembers = [me];
    window.fhEditMember(me.id, L('Hồ sơ của tôi', 'My profile'));
  };

  /* Editing a member is a form → modal with Cancel · Title · Save (DESIGN §4). */
  window.fhEditMember = function (id, title) {
    const m = (window._fhMembers || []).find((x) => x.id === id) || { name: '', color: '' };
    window._fhMColor = m.color || _pal()[0];
    window._fhMName0 = m.name || '';
    const swatches = _pal().map((c) =>
      '<button class="fh-s-sw' + (c === window._fhMColor ? ' on' : '') + '" data-c="' + c + '" aria-label="' + L('Màu','Colour') + ' ' + c + '"'
      + ' onclick="fhPickMColor(this)"><i style="background:' + c + '"></i></button>').join('');
    _fhModal({
      title: title || L('Sửa thành viên','Edit member'),
      saveLabel: L('Lưu','Save'),
      body: '<div class="field"><label>' + L('Tên','Name') + '</label>'
        + '<input id="fh-mname" value="' + _esc(m.name) + '" placeholder="' + L('Tên','Name') + '" oninput="fhModalDirty()"></div>'
        + '<div class="field"><label>' + L('Màu','Colour') + '</label><div class="fh-s-swatches" id="fh-mcol">' + swatches + '</div></div>',
      required: () => [{ el: 'fh-mname', ok: !!(document.getElementById('fh-mname').value || '').trim() }],
      reqMsg: L('Hãy nhập tên thành viên','Add a member name'),
      dirty: () => {
        const v = (document.getElementById('fh-mname').value || '').trim();
        return v !== window._fhMName0 || window._fhMColor !== (m.color || _pal()[0]);
      },
      save: async () => {
        const name = (document.getElementById('fh-mname').value || '').trim();
        const nf = await fhField('name', name);             // enc family → ciphertext travels, plaintext stays home
        await _rpc('update_member', { p_member_id: id, p_name: nf.name, p_color: window._fhMColor || null, p_name_enc: nf.name_enc || null });
        await window.loadFamilyData();
        window.toast && window.toast(L('Đã cập nhật thành viên','Member updated'));
      }
    });
  };
  window.fhPickMColor = function (btn) {
    window._fhMColor = btn.dataset.c;
    btn.parentNode.querySelectorAll('.fh-s-sw').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    window.fhModalDirty();
  };

  // Removing a member is destructive → arm-then-confirm inline on the row's own button.
  window.fhArchiveMember = async function (id, btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Xoá?','Remove?');
      clearTimeout(window._fhMemArmT);
      window._fhMemArmT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.innerHTML = _ICO.trash;
      }, 3000);
      return;
    }
    clearTimeout(window._fhMemArmT);
    try { await _rpc('archive_member', { p_member_id: id }); }
    catch (e) { window.toast && window.toast(_friendly(e)); return; }
    await window.loadFamilyData(); window.fhManageFamily();
    window.toast && window.toast(L('Đã xoá thành viên','Member removed'));
  };

  /* Adding a member is a create form → modal, not a browser prompt(). */
  window.fhAddMember = function () {
    window._fhNewColor = _pal()[Math.floor(Math.random() * _pal().length)];
    const swatches = _pal().map((c) =>
      '<button class="fh-s-sw' + (c === window._fhNewColor ? ' on' : '') + '" data-c="' + c + '" aria-label="' + L('Màu','Colour') + ' ' + c + '"'
      + ' onclick="fhPickNewColor(this)"><i style="background:' + c + '"></i></button>').join('');
    _fhModal({
      title: L('Thêm thành viên','Add member'),
      saveLabel: L('Thêm','Add'),
      body: '<div class="field"><label>' + L('Tên','Name') + '</label>'
        + '<input id="fh-newname" placeholder="' + L('vd. Mai','e.g. Emma') + '" oninput="fhModalDirty()"></div>'
        + '<div class="field"><label>' + L('Màu','Colour') + '</label><div class="fh-s-swatches">' + swatches + '</div></div>',
      required: () => [{ el: 'fh-newname', ok: !!(document.getElementById('fh-newname').value || '').trim() }],
      reqMsg: L('Hãy nhập tên thành viên','Add a member name'),
      after: () => { const i = document.getElementById('fh-newname'); if (i) i.focus(); },
      save: async () => {
        const name = (document.getElementById('fh-newname').value || '').trim();
        const nf = await fhField('name', name);
        await _rpc('add_member', { p_name: nf.name, p_color: window._fhNewColor, p_name_enc: nf.name_enc || null });
        await window.loadFamilyData();
        window.toast && window.toast(L('Đã thêm thành viên','Member added'));
        window.fhManageFamily();
      }
    });
  };
  window.fhPickNewColor = function (btn) {
    window._fhNewColor = btn.dataset.c;
    btn.parentNode.querySelectorAll('.fh-s-sw').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  };

  window.fhLeaveFamily = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để rời','Tap again to leave');
      clearTimeout(window._fhLeaveT);
      window._fhLeaveT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Rời gia đình này','Leave this family');
      }, 3000);
      return;
    }
    clearTimeout(window._fhLeaveT);
    if (btn) { btn.textContent = L('Đang rời…','Leaving…'); btn.disabled = true; }
    try { await _rpc('leave_family'); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = L('Rời gia đình này','Leave this family'); }
      window.toast && window.toast(_friendly(e)); return;
    }
    try { fhKeyDrop(window.DB.fid); } catch (e) {}          // no lingering family key on a device that left
    window._closeOv(); location.reload();
  };
  window.fhDeleteFamily = async function (btn) {
    if (btn && !btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = L('Chạm lần nữa để xoá với mọi người','Tap again to delete for everyone');
      clearTimeout(window._fhDelFamT);
      window._fhDelFamT = setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('armed'); btn.textContent = L('Xoá gia đình','Delete family');
      }, 3000);
      return;
    }
    clearTimeout(window._fhDelFamT);
    if (btn) { btn.textContent = L('Đang xoá…','Deleting…'); btn.disabled = true; }
    try { await _rpc('archive_family', { p_family_id: window.DB.fid }); }
    catch (e) {
      if (btn) { btn.disabled = false; btn.classList.remove('armed'); btn.textContent = L('Xoá gia đình','Delete family'); }
      window.toast && window.toast(_friendly(e)); return;
    }
    try { fhKeyDrop(window.DB.fid); } catch (e) {}
    window._closeOv(); location.reload();
  };

  // ---- Language (per-member display preference) ----
  /* Language is per-member: it writes profiles.language (self-update is allowed by RLS)
     and localStorage 'fh-lang', which the hydrate now prefers over the family default.
     A full re-hydrate repaints every screen — including month labels baked at hydrate —
     so the switch reads consistently everywhere, not just on static [data-t] labels. */
  window.fhLanguageSheet = function () {
    const cur = (window.LANG === 'vi') ? 'vi' : 'en';
    const opt = (v, label) =>
      '<button class="choice' + (v === cur ? ' on' : '') + '" onclick="fhPickLanguage(\'' + v + '\')">' + label + '</button>';
    _fhSheet(
      '<div class="fh-s-h">' + L('Ngôn ngữ','Language') + '</div>'
      + '<div class="fh-s-sub">' + L('Chọn ngôn ngữ hiển thị cho riêng bạn — người khác trong nhà không đổi theo.','Choose your own display language — it won’t change it for anyone else in the family.') + '</div>'
      + '<div class="choices" style="margin-top:6px">' + opt('vi', '🇻🇳 Tiếng Việt') + opt('en', '🇬🇧 English') + '</div>'
      + _btn(L('Xong','Done'), '_closeOv()', _S.cta)
    );
  };
  window.fhPickLanguage = async function (lang) {
    if (lang !== 'vi' && lang !== 'en') return;
    window._closeOv();
    if (lang === window.LANG) return;
    window.LANG = lang;
    try { localStorage.setItem('fh-lang', lang); } catch (e) {}
    // instant repaint: static [data-t] labels + every dynamic section (they read L()/t())
    try { window.applyLang && window.applyLang(); } catch (e) {}
    try { window.applyCurrency && window.applyCurrency(); } catch (e) {}
    try { window.renderAll && window.renderAll(); } catch (e) {}
    window.toast && window.toast(L('Đã chuyển sang Tiếng Việt','Switched to English'));
    // persist per-member so it follows the user across devices — best-effort
    try { const uid = window.fhUser && window.fhUser.id; if (uid) await sb.from('profiles').update({ language: lang }).eq('id', uid); } catch (e) {}
    // re-hydrate so month labels (baked in at hydrate) and every surface land in the new language
    try { if (window.loadFamilyData) await window.loadFamilyData(); } catch (e) {}
  };
