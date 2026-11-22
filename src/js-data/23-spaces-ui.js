  /* ═══ Spaces ("Nhóm") — UI (docs/specs/spaces-spec.md sections 3, 4, 8) ═════
     The Nhóm section on Tài chính (every space the person belongs to, families
     included), the switcher, and the sheets that create a space, edit its
     profile, invite into it, unlock it and settle up in it.

     Lives in js-data so it can use _fhModal / _fhSheet (60-settings) and the
     space keys (22-spaces). The shell that follows the open space is
     16-spaces-shell.js; the arithmetic is 15-spaces-core.js. */
  (function () {
    const _e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _S = () => window.fhSpacesData();
    const $ = (id) => document.getElementById(id);
    const _GO = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
    const _TICK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--brand)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const _kindLbl = (sp) => (sp.type === 'family') ? L('Gia đình', 'Family') : ((sp.profile && sp.profile.preset === 'other') ? L('Nhóm', 'Space') : L('Bạn bè', 'Friends'));
    const _subOf = (sp) => _kindLbl(sp) + (sp.members ? ' · ' + sp.members + L(' thành viên', sp.members === 1 ? ' member' : ' members') : '');
    const _amtIn = (id, ph) => '<div class="field"><label>' + L('Số tiền', 'Amount') + '</label><input class="num" id="' + id + '" inputmode="numeric" placeholder="' + (ph || '0 ₫') + '" oninput="fhModalDirty()"></div>';
    const _amtOf = (id) => window.parseAmtBase ? parseAmtBase(($(id) || {}).value || '') : 0;

    /* ── the Nhóm section on Tài chính ─────────────────────────────────────── */
    let _invites = [], _invitesAt = 0, _busy = false, _sealAt = 0;
    function _netOf(sp) {
      const S = _S();
      if (!S.list.some((x) => x.id === sp.id)) return { kind: 'none' };          // keeps no balances
      if (!S.keys[sp.id]) return { kind: 'locked' };
      if (!S.data[sp.id]) return { kind: 'loading' };
      return { kind: 'net', net: fhSpaceMyNet(sp.id) };
    }
    function _rowHTML(sp, activeId) {
      const n = _netOf(sp), open = sp.id === activeId;
      let right = '<div class="r-right">' + _GO + '</div>';
      if (n.kind === 'net' && Math.abs(n.net) > 0.0005) {
        right = '<div class="r-right">' + (n.net > 0 ? '<div class="r-amt num owed">+' + fmt(n.net) + '</div>' : '<div class="r-amt num owe">−' + fmt(-n.net) + '</div>')
          + '<div class="r-cat">' + (n.net > 0 ? L('nhóm nợ bạn', 'owed to you') : L('bạn nợ nhóm', 'you owe')) + '</div></div>';
      } else if (n.kind === 'net') {
        right = '<div class="r-right"><div class="r-cat">' + L('đã cân bằng', 'all square') + '</div></div>';
      } else if (n.kind === 'locked') {
        right = '<div class="r-right"><div class="r-cat">' + L('nhập mã khóa', 'enter the code') + '</div></div>';
      }
      return '<div class="row tap" onclick="fhSpaceRowTap(\'' + sp.id + '\')"><div class="r-ico-wrap"><div class="r-ico">' + _e(fhSpaceMark(sp)) + '</div></div>'
        + '<div class="r-body"><div class="r-t">' + _e(sp.name || L('Nhóm', 'Space')) + '</div>'
        + '<div class="r-s">' + _e(_subOf(sp)) + (open ? ' · ' + L('đang mở', 'open now') : '') + (sp.closed ? ' · ' + L('đã đóng', 'closed') : '') + '</div></div>' + right + '</div>';
    }
    window.persSpacesSection = function () {
      const S = _S(); if (!S) return '';
      const activeId = (window.DB && window.DB.fid) || ((S.all.find((x) => x.isActive) || {}).id) || null;
      let h = '<div id="pers-spaces-wrap"><div class="section-h"><span class="tl"><span class="t">' + L('Nhóm', 'Spaces') + '</span></span>'
        + '<span class="acts"><a onclick="fhSpacePasteInvite()">' + L('Dán link mời', 'Paste an invite') + '</a><a onclick="fhSpaceCreateSheet()">' + L('＋ Tạo nhóm', '＋ New space') + '</a></span></div>';
      _invites.forEach(function (inv) {
        h += '<section class="dbt-empty dbt-invite"><div class="dbt-empty-t"><b>' + _e(inv.invited_by || L('Một người bạn', 'A friend')) + '</b> ' + L('mời bạn vào nhóm', 'invited you to') + ' <b>' + _e(inv.family_name || L('Nhóm', 'a space')) + '</b>.</div>'
          + (inv.key_sealed ? '<div class="dbt-empty-s">' + L('Mã khóa của nhóm đã gửi kèm lời mời này. Bấm là vào.', 'The space key came with this invite. One tap and you are in.') + '</div>' : '')
          + '<div class="dbt-empty-cta"><button type="button" onclick="fhSpaceAcceptInvite(\'' + inv.family_id + '\')">' + L('Tham gia', 'Join') + '</button></div></section>';
      });
      if (!S.all.length) {
        if (!_invites.length) h += (window.fhEmptyCard
          ? fhEmptyCard({ e: '🤝', t: L('Chi chung với ai đó?', 'Sharing costs with someone?'), s: L('Tạo một nhóm cho gia đình, bạn bè hay một chuyến đi. Mỗi nhóm có sổ riêng và mã khóa riêng.', 'Make a space for family, friends or a trip. Each has its own book and its own key.'),
              btns: [{ t: L('Tạo nhóm', 'New space'), on: 'fhSpaceCreateSheet()' }] })
          : '<section class="dbt-empty"><div class="dbt-empty-cta"><button type="button" onclick="fhSpaceCreateSheet()">' + L('Tạo nhóm', 'New space') + '</button></div></section>');
        return h + '</div>';
      }
      h += '<div class="rows sp-rows">' + S.all.map((sp) => _rowHTML(sp, activeId)).join('') + '</div></div>';
      return h;
    };
    function _redraw() {
      const el = $('pers-spaces-wrap');
      if (el) { const html = window.persSpacesSection(); if (html && el.outerHTML !== html) el.outerHTML = html; }
    }
    window.fhSpacesRedraw = _redraw;
    /* Async part of the section: the roster, the invites waiting, and each
       space's balance. Called after every renderPersonal; self-throttled. */
    window.persSpacesAfterRender = function (opts) {
      const S = _S(); if (!S) return;
      _redraw();                 // the tab's own render may have reused an older copy of this section
      if (_busy) return;
      const force = !!(opts && opts.force);
      _busy = true;
      (async function () {
        try {
          const before = JSON.stringify(S.all) + '|' + _invites.length;
          await fhSpacesBoot(force ? { force: true } : undefined);
          if (force || Date.now() - _invitesAt >= 60000) try {
            const r = await window.sb.rpc('find_my_invites');
            _invitesAt = Date.now();
            _invites = (Array.isArray(r.data) ? r.data : []).filter((i) => i && (i.family_type === 'friend' || i.family_type === 'trip') && !S.all.some((sp) => sp.id === i.family_id));
          } catch (e) {}
          let changed = (before !== JSON.stringify(S.all) + '|' + _invites.length);
          for (const sp of S.list) {
            if (S.keys[sp.id] && (!S.data[sp.id] || Date.now() - S.data[sp.id].at > 60000)) { await fhSpaceHydrate(sp.id); changed = true; }
          }
          if (changed) { _redraw(); try { window.persDebtRedraw && window.persDebtRedraw(); } catch (e) {} }
          /* an invitee who had no account when I invited them has one now: seal
             the key to them. At most every ten minutes, owned spaces only. */
          if (force || Date.now() - _sealAt >= 600000) {
            _sealAt = Date.now();
            for (const sp of S.all) { if (sp.isOwner && sp.type !== 'family' && !sp.closed && window.fhSpaceCardCached(sp.id)) { try { await fhSpaceSealPending(sp.id); } catch (e) {} } }
          }
        } catch (e) { console.warn('spaces refresh failed', e); }
        finally { _busy = false; }
      })();
    };

    window.fhSpaceRowTap = function (fid) {
      const S = _S(), sp = fhSpaceGet(fid); if (!sp) return;
      /* a friend space is opened with its own Key Card; a family has its own
         door (passcode or card) that the lock wall already handles */
      if (sp.type !== 'family' && !S.keys[fid]) {
        /* the key may be waiting, sealed to this account (a second device, or an
           invite accepted before its key arrived): try that before asking */
        fhSpaceUnlockSealed(fid).then(function (r) { if (r && r.ok) fhSpaceOpen(fid); else window.fhSpaceUnlockSheet(fid); });
        return;
      }
      fhSpaceOpen(fid);
    };
    window.fhSpaceAcceptInvite = async function (fid) {
      const r = await fhSpaceJoin(fid);
      if (!r.ok) { window.toast && toast(L('Chưa tham gia được. Nhờ chủ nhóm mời lại nhé.', 'Could not join. Ask the owner to invite you again.')); return; }
      const inv = _invites.find((i) => i.family_id === fid);
      _invites = _invites.filter((i) => i.family_id !== fid); _invitesAt = 0;
      await fhSpacesBoot({ force: true });
      _redraw();
      if (!_S().keys[fid]) await fhSpaceUnlockSealed(fid, inv && inv.key_sealed);   // the key the owner's device sealed to this account
      if (_S().keys[fid]) { fhSpaceOpen(fid); return; }
      window.fhSpaceUnlockSheet(fid);
    };
    /* "Dán link mời": the way an invite reaches an installed app that a link
       cannot open (every iPhone). Reads the clipboard on this tap; if the
       browser will not hand it over, or it holds no invite, asks for a paste. */
    async function _pasteGo(text) {
      if (!window.fhSpacePendingFromText(text)) return false;
      window.toast && toast(L('Đang vào nhóm…', 'Joining…'));
      const ok = await window.fhSpacePendingJoin();
      if (!ok) _redraw();
      return true;
    }
    window.fhSpacePasteInvite = async function () {
      let text = '';
      try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
      if (text && await _pasteGo(text)) return;
      _fhModal({
        title: L('Dán link mời', 'Paste an invite'), saveLabel: L('Vào nhóm', 'Join'), reqMsg: L('Dán link mời vào ô này nhé', 'Paste the invite link here'),
        body: '<div class="field"><label>' + L('Link mời', 'Invite link') + '</label><textarea id="sp-paste-in" rows="3" autocapitalize="none" autocomplete="off" placeholder="https://…#fh-s=…" oninput="fhModalDirty()"></textarea></div>'
          + '<div class="dbt-note">' + L('Người mời gửi bạn một đường link hoặc mã QR. Mở nó, bấm "Sao chép lời mời", rồi dán vào đây.', 'Whoever invited you sent a link or a QR code. Open it, tap "Copy the invite", then paste it here.') + '</div>',
        required: function () { return [{ el: $('sp-paste-in'), ok: !!fhSpaceLinkParse(($('sp-paste-in') || {}).value || '') }]; },
        save: async function () { const v = ($('sp-paste-in') || {}).value || ''; return function () { _pasteGo(v); }; },
      });
    };
    /* older entry points (push taps, the Tài sản tile that used to hold spaces) */
    window.openDebtSpace = function (fid) { window.fhSpaceRowTap(fid); };

    /* ── unlock a space with its Key Card ──────────────────────────────────── */
    window.fhSpaceUnlockSheet = function (fid) {
      const sp = fhSpaceGet(fid);
      _fhModal({
        title: (sp && sp.name) || L('Nhóm', 'Space'), saveLabel: L('Mở nhóm', 'Open'), reqMsg: L('Nhập mã khóa của nhóm nhé', 'Enter the space code'),
        body: '<div class="field"><label>' + L('Mã khóa của nhóm', 'Space code') + '</label><input id="sp-unlock-in" placeholder="FH-XXXX-XXXX-…" autocomplete="off" autocapitalize="characters" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">' + L('Người mời bạn có mã này. Dán mã, hoặc dán cả đường link mời. Mã chỉ lưu trên máy bạn.', 'Whoever invited you has it. Paste the code, or the whole invite link. It stays on this device.') + '</div>',
        required: function () { return [{ el: $('sp-unlock-in'), ok: !!(($('sp-unlock-in') || {}).value || '').trim() }]; },
        save: async function () {
          const r = await fhSpaceUnlock(fid, (($('sp-unlock-in') || {}).value || '').trim());
          if (!r.ok) { const e = new Error(r.error || 'unlock_failed'); e.fhMsg = L('Mã chưa đúng, thử lại nhé', 'That code does not open this space'); throw e; }
          return function () { fhSpaceOpen(fid); };
        },
      });
    };

    /* ── the switcher: every space, one tap to open ────────────────────────── */
    window.fhSpaceSwitcher = function () {
      const S = _S(), activeId = window.DB && window.DB.fid;
      const item = function (sp) {
        const n = _netOf(sp);
        let sub = _subOf(sp);
        if (n.kind === 'net' && Math.abs(n.net) > 0.0005) sub = (n.net > 0 ? L('Nhóm nợ bạn ', 'Owes you ') : L('Bạn nợ nhóm ', 'You owe ')) + fmt(Math.abs(n.net));
        return '<button type="button" class="rl-row" onclick="_closeOv();fhSpaceRowTap(\'' + sp.id + '\')"><span class="r-ico">' + _e(fhSpaceMark(sp)) + '</span>'
          + '<span class="rl-t"><b>' + _e(sp.name || L('Nhóm', 'Space')) + '</b><small>' + _e(sub) + '</small></span>' + (sp.id === activeId ? _TICK : '') + '</button>';
      };
      _fhSheet('<div class="sheet-h">' + L('Nhóm của bạn', 'Your spaces') + '</div>'
        + (S.all.length ? '<div class="rl-list sp-sw" style="margin-top:14px">' + S.all.map(item).join('') + '</div>' : '<div class="dbt-note">' + L('Bạn chưa ở trong nhóm nào.', 'You are not in any space yet.') + '</div>')
        + '<button type="button" class="fh-s-line" style="margin-top:16px" onclick="_closeOv();fhSpaceCreateSheet()">' + L('＋ Tạo nhóm', '＋ New space') + '</button>'
        + ((activeId && fhSpaceGet(activeId) && fhSpaceGet(activeId).type !== 'family' && !fhSpaceGet(activeId).closed) ? '<button type="button" class="fh-s-ghost" onclick="_closeOv();fhSpaceInviteSheet()">' + L('Mời vào nhóm đang mở', 'Invite to the open space') + '</button>' : '')
        + (activeId && fhSpaceGet(activeId) ? '<button type="button" class="fh-s-ghost" onclick="_closeOv();fhSpaceProfileSheet()">' + L('Tuỳ chỉnh nhóm đang mở', 'Settings of the open space') + '</button>' : '')
        + '<button type="button" class="fh-s-ghost" onclick="_closeOv();fhFamilyJoinByCode()">' + L('Tham gia gia đình bằng mã', 'Join a family with a code') + '</button>');
    };

    /* ── profile: presets and switches (create + edit share this) ──────────── */
    const _SW = function () {
      return [
        ['split', L('Chia tiền', 'Splitting'), L('Ai trả, chia cho ai, ai nợ ai', 'Who paid, who shares, who owes')],
        ['moments', L('Kỷ niệm và ảnh', 'Moments and photos'), L('Ảnh trên khoản chi, dịp chung', 'Photos on expenses, shared occasions')],
        ['react', L('Cảm xúc', 'Reactions'), L('Thả cảm xúc lên khoản chi', 'React to an expense')],
        ['budget', L('Ngân sách chung', 'Shared budget'), L('Hạn mức tháng và số còn lại', 'A monthly limit and what is left')],
        ['goals', L('Mục tiêu tiết kiệm', 'Saving goals'), L('Cùng để dành cho một việc', 'Save together toward something')],
        ['ask', L('Đề xuất cần duyệt', 'Proposals'), L('Khoản lớn cần người khác đồng ý', 'Big spends need a second yes')],
        ['house', L('Ngôi nhà', 'The house'), L('Căn nhà và tâm trạng mỗi ngày', 'The house and daily moods')],
        ['source', L('Hiện nguồn tiền', 'Show money source'), L('Người khác thấy bạn trả bằng thẻ nào', 'Others see which card you paid with')],
      ];
    };
    function _switchesHTML(p, editable) {
      return '<div class="rl-list sp-sw" id="sp-switches">' + _SW().map(function (r) {
        const on = !!p[r[0]];
        return '<button type="button" class="rl-row" role="switch" data-k="' + r[0] + '" aria-checked="' + (on ? 'true' : 'false') + '"' + (editable ? ' onclick="fhSpSwToggle(this)"' : ' disabled') + '>'
          + '<span class="rl-t"><b>' + r[1] + '</b><small>' + r[2] + '</small></span>' + (on ? '<span class="cry-sw on"></span>' : '<span class="cry-sw"></span>') + '</button>';
      }).join('') + '</div>';
    }
    function _modeHTML(p) {
      return '<div class="field" id="sp-modefield"' + (p.split ? '' : ' style="display:none"') + '><label>' + L('Khoản mới mặc định', 'A new expense starts as') + '</label><div class="choices" id="sp-mode">'
        + '<button type="button" class="choice' + (p.mode === 'chung' ? ' on' : '') + '" data-v="chung" onclick="pick(\'sp-mode\',this);fhModalDirty()">' + L('Chung', 'Shared') + '</button>'
        + '<button type="button" class="choice' + (p.mode === 'chia' ? ' on' : '') + '" data-v="chia" onclick="pick(\'sp-mode\',this);fhModalDirty()">' + L('Chia', 'Split') + '</button></div>'
        + '<div class="field-hint">' + L('Chia: một người ứng trước, mỗi người nợ phần của mình. Chung: không ai nợ ai.', 'Split: one person fronts it and each owes their share. Shared: nobody owes anybody.') + '</div></div>';
    }
    window.fhSpSwToggle = function (btn) {
      const on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      const sw = btn.querySelector('.cry-sw'); if (sw) sw.classList.toggle('on', on);
      if (btn.getAttribute('data-k') === 'split') { const mf = $('sp-modefield'); if (mf) mf.style.display = on ? '' : 'none'; }
      window.fhModalDirty();
    };
    function _readProfile(base) {
      const p = Object.assign({}, base || {});
      document.querySelectorAll('#sp-switches .rl-row').forEach(function (b) { p[b.getAttribute('data-k')] = b.getAttribute('aria-checked') === 'true'; });
      const mode = (typeof chosen === 'function' && $('sp-mode')) ? chosen('sp-mode') : null;
      p.mode = p.split ? (mode === 'chung' ? 'chung' : 'chia') : 'chung';
      return p;
    }
    const _EMO = ['🤝', '🍜', '🏸', '✈️', '🏠', '🎉', '⚽', '☕'];
    function _emojiHTML(cur) {
      return '<div class="choices" id="sp-emoji">' + _EMO.map((e) => '<button type="button" class="choice' + (e === cur ? ' on' : '') + '" data-v="' + e + '" onclick="pick(\'sp-emoji\',this);fhModalDirty()">' + e + '</button>').join('') + '</div>';
    }

    /* ── create ────────────────────────────────────────────────────────────── */
    window.fhSpPreset = function (btn) {
      pick('sp-preset', btn);
      const v = btn.getAttribute('data-v'), p = fhSpaceProfileOf(v === 'family' ? 'family' : 'friend', { preset: v });
      const box = $('sp-switch-wrap'); if (box) box.innerHTML = _switchesHTML(p, v !== 'family') + _modeHTML(p);
      const note = $('sp-preset-note');
      if (note) note.textContent = v === 'family'
        ? L('Gia đình có ngôi nhà, ngân sách và cửa vào bằng mã riêng. Bấm tiếp để tạo gia đình.', 'A family has the house, a budget and its own door. Continue to set one up.')
        : L('Bật tắt lại lúc nào cũng được. Tắt một mục chỉ ẩn nó đi, không xoá gì.', 'Change these any time. Switching one off only hides it. Nothing is deleted.');
      const sv = $('fh-modal-save'); if (sv) sv.textContent = v === 'family' ? L('Tiếp tục', 'Continue') : L('Tạo nhóm', 'Create');
    };
    window.fhSpaceCreateSheet = function () {
      const p = fhSpaceProfileOf('friend', { preset: 'friend' });
      const ch = (v, label, on) => '<button type="button" class="choice' + (on ? ' on' : '') + '" data-v="' + v + '" onclick="fhSpPreset(this)">' + label + '</button>';
      _fhModal({
        title: L('Nhóm mới', 'New space'), saveLabel: L('Tạo nhóm', 'Create'), reqMsg: L('Đặt tên nhóm nhé', 'Give the space a name'),
        body: '<div class="field"><label>' + L('Tên nhóm', 'Name') + '</label><input id="sp-name" placeholder="' + L('vd. Hội bạn thân', 'e.g. Close friends') + '" maxlength="40" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>' + L('Nhóm này là', 'This space is') + '</label><div class="choices" id="sp-preset">'
          + ch('family', '🏡 ' + L('Gia đình', 'Family'), false) + ch('friend', '🤝 ' + L('Bạn bè', 'Friends'), true) + ch('other', '✨ ' + L('Khác', 'Other'), false) + '</div></div>'
          + '<div class="field"><label>' + L('Biểu tượng', 'Mark') + '</label>' + _emojiHTML('🤝') + '</div>'
          + '<div class="field"><label>' + L('Nhóm này dùng', 'This space uses') + '</label><div id="sp-switch-wrap">' + _switchesHTML(p, true) + _modeHTML(p) + '</div></div>'
          + '<div class="dbt-note" id="sp-preset-note">' + L('Bật tắt lại lúc nào cũng được. Tắt một mục chỉ ẩn nó đi, không xoá gì.', 'Change these any time. Switching one off only hides it. Nothing is deleted.') + '</div>',
        required: function () {
          if ((typeof chosen === 'function' && chosen('sp-preset')) === 'family') return [];
          return [{ el: $('sp-name'), ok: !!(($('sp-name') || {}).value || '').trim() }];
        },
        save: async function () {
          const preset = (typeof chosen === 'function' && chosen('sp-preset')) || 'friend';
          if (preset === 'family') return function () { if (typeof window.fhFamilyStart === 'function') window.fhFamilyStart(); };
          const name = (($('sp-name') || {}).value || '').trim();
          const profile = _readProfile({ preset: preset, emoji: (typeof chosen === 'function' && chosen('sp-emoji')) || '🤝' });
          const r = await fhSpaceCreate(name, 'friend', profile);
          if (!r.ok) throw new Error(r.error || 'create_failed');
          const fid = r.fid, disp = r.card.display;
          return function () {
            _fhModal({ title: L('Mã khóa của nhóm', 'The space code'), saveLabel: L('Đã lưu, tiếp tục', 'Saved, continue'),
              body: '<div class="dbt-cardshow num">' + _e(disp) + '</div>'
                + '<div class="dbt-note">' + L('Đây là chìa khóa của sổ nhóm. Không có mã thì không ai đọc được, kể cả chúng tôi. Mã đã lưu trên máy này, và nằm sẵn trong link mời ở bước sau.', 'This is the key to the space. Without it nobody can read the book, including us. It is saved on this device and is carried by the invite link in the next step.') + '</div>',
              save: async function () { return function () { window.fhSpaceInviteSheet(fid, { thenOpen: true }); }; } });
          };
        },
      });
    };

    /* ── invite: QR and link (they carry the key), and the email whitelist ─── */
    let _invCtx = null;
    const _sealCodes = {};     // email → the confirmation code of the key this device sealed to, this session
    async function _invPending(fid) {
      const box = $('sp-inv-pending'); if (!box) return;
      const list = (await fhSpaceInvites(fid)).filter((i) => i && i.status === 'pending');
      if (!$('sp-inv-pending')) return;
      /* an invite with no key yet: the person had no account when it was sent.
         Try again now; repaint if any of them took. */
      if (!_invPending._busy && list.some((i) => !i.sealed)) {
        _invPending._busy = 1;
        fhSpaceSealPending(fid, list).then(function (n) { _invPending._busy = 0; if (n && $('sp-inv-pending')) _invPending(fid); }, function () { _invPending._busy = 0; });
      }
      const st = (i) => i.sealed
        ? L('Đã gửi kèm mã khóa. Bạn ấy mở Earthy là thấy lời mời.', 'The key went with it. They will see the invite when they open Earthy.') + (_sealCodes[i.email] ? ' ' + L('Mã xác nhận ', 'Check code ') + _sealCodes[i.email] : '')
        : L('Chưa có tài khoản Earthy. Gửi link mời cho bạn ấy.', 'No Earthy account yet. Send them the invite link.');
      box.innerHTML = list.length
        ? '<div class="field"><label>' + L('Đang chờ tham gia', 'Waiting to join') + '</label><div class="rl-list sp-sw">' + list.map((i) =>
            '<div class="rl-row"><span class="rl-t"><b>' + _e(i.email) + '</b><small>' + _e(st(i)) + '</small></span><button type="button" class="sp-mini" onclick="fhSpaceInvCancel(this)" data-em="' + _e(i.email) + '">' + L('Huỷ mời', 'Cancel') + '</button></div>').join('') + '</div></div>'
        : '';
    }
    window.fhSpaceInvCancel = async function (btn) {
      if (!_invCtx) return;
      const sp = fhSpaceGet(_invCtx.fid); if (!sp || !sp.isOwner) { window.toast && toast(L('Chỉ chủ nhóm huỷ được lời mời', 'Only the owner can cancel an invite')); return; }
      const r = await fhSpaceInviteCancel(_invCtx.fid, btn.getAttribute('data-em'));
      if (!r.ok) { window.toast && toast(L('Chưa huỷ được, thử lại', 'Could not cancel, try again')); return; }
      _invPending(_invCtx.fid);
    };
    window.fhSpaceInvShare = async function () {
      if (!_invCtx || !_invCtx.url) return;
      const sp = fhSpaceGet(_invCtx.fid);
      try {
        if (navigator.share) { await navigator.share({ title: (sp && sp.name) || 'Earthy', text: L('Vào nhóm ', 'Join ') + ((sp && sp.name) || '') + L(' trên Earthy', ' on Earthy'), url: _invCtx.url }); return; }
      } catch (e) { return; }
      window.fhSpaceInvCopy();
    };
    window.fhSpaceInvCopy = function () {
      if (!_invCtx || !_invCtx.url) return;
      try { navigator.clipboard.writeText(_invCtx.url); window.toast && toast(L('Đã sao chép link mời', 'Invite link copied')); } catch (e) {}
    };
    window.fhSpaceInviteSheet = function (fid, opts) {
      opts = opts || {};
      fid = fid || (window.DB && window.DB.fid);
      const sp = fhSpaceGet(fid); if (!sp) return;
      const url = window.fhSpaceInviteUrl(fid);
      _invCtx = { fid: fid, url: url };
      const done = function () { if (opts.thenOpen) fhSpaceOpen(fid); };
      _fhModal({
        title: L('Mời vào nhóm', 'Invite to the space'), saveLabel: L('Xong', 'Done'),
        /* The email comes first: for someone who already has Earthy it is the
           whole invite (the key is sealed to their account). The link and the QR
           are for a person who has no account yet. */
        body: (sp.isOwner
            ? '<div class="field"><label>' + L('Email Google của người được mời', 'Invitee Google email') + '</label><input id="sp-inv-email" inputmode="email" autocapitalize="none" placeholder="ban@gmail.com" oninput="fhModalDirty()"></div>'
              + '<button type="button" class="fh-s-cta" onclick="fhSpaceInvAdd()">' + L('Mời', 'Invite') + '</button>'
              + '<div class="dbt-note" style="padding-left:0;padding-right:0">' + L('Ai đã có tài khoản Earthy sẽ thấy lời mời ngay trong app, kèm sẵn mã khóa: bấm Tham gia là vào. Chỉ email bạn thêm ở đây mới vào được nhóm.', 'Someone who already has an Earthy account sees the invite in the app, key included: one tap on Join. Only the emails you add here can join.') + '</div>'
            : '<div class="dbt-note">' + L('Chủ nhóm là người thêm email được mời.', 'The owner adds the emails that may join.') + '</div>')
          + '<div id="sp-inv-pending"></div>'
          + '<div class="field" style="margin-top:22px"><label>' + L('Người chưa có Earthy', 'For someone without Earthy') + '</label></div>'
          + (url
            ? '<div id="sp-qr-wrap"></div>'
              + '<div class="dbt-note" style="text-align:center;padding-top:0">' + L('Gửi link hoặc cho quét mã. Link mang theo mã khóa của nhóm, chỉ gửi cho người bạn mời. Trên iPhone, link mở bằng trình duyệt và hướng dẫn họ dán vào Earthy.', 'Send the link or let them scan the code. The link carries the space key, so send it only to people you invite. On an iPhone it opens in the browser and tells them how to paste it into Earthy.') + '</div>'
              + '<button type="button" class="fh-s-line" style="margin-top:0" onclick="fhSpaceInvShare()">' + L('Chia sẻ link mời', 'Share the invite link') + '</button>'
              + '<button type="button" class="fh-s-ghost" onclick="fhSpaceInvCopy()">' + L('Sao chép link', 'Copy link') + '</button>'
            : '<div class="dbt-note">' + L('Máy này chưa giữ mã khóa của nhóm nên chưa tạo được link.', 'This device does not hold the space code, so it cannot make a link.') + '</div>'),
        after: function () {
          if (url && window.fhQrCanvas) { try { const cv = window.fhQrCanvas(url, 6, 4); cv.className = 'sp-qr'; const w = $('sp-qr-wrap'); if (w) w.appendChild(cv); } catch (e) {} }
          _invPending(fid);
        },
        save: async function () { return done; },
      });
    };
    window.fhSpaceInvAdd = async function () {
      if (!_invCtx) return;
      const el = $('sp-inv-email'), v = ((el || {}).value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { if (typeof window.fhCheck === 'function') window.fhCheck([{ el: el, ok: false }], L('Điền email nhé', 'Enter an email')); return; }
      const r = await fhSpaceInvite(_invCtx.fid, v);
      if (!r.ok) { window.toast && toast(/already_member/.test(r.error || '') ? L('Người này đã ở trong nhóm rồi', 'They are already in the space') : L('Chưa mời được, thử lại', 'Could not invite, try again')); return; }
      if (el) el.value = '';
      /* seal the key to their account right away; no account yet → the link is the way */
      const sl = await fhSpaceSealFor(_invCtx.fid, v.toLowerCase());
      if (sl.ok) _sealCodes[v.toLowerCase()] = sl.code;
      window.toast && toast(sl.ok ? L('Đã mời, kèm sẵn mã khóa', 'Invited, key included')
                                  : L('Đã thêm. Gửi thêm link mời nhé.', 'Added. Send them the link too.'));
      _invPending(_invCtx.fid);
    };

    /* ── the space's own screen: name, members, switches, leaving ──────────── */
    let _armed = null;
    function _arm(key, msg) {
      if (_armed === key) { _armed = null; return true; }
      _armed = key; window.toast && toast(msg);
      setTimeout(function () { if (_armed === key) _armed = null; }, 4000);
      return false;
    }
    window.fhSpaceProfileSheet = function (fid) {
      fid = fid || (window.DB && window.DB.fid);
      const sp = fhSpaceGet(fid); if (!sp) { window.toast && toast(L('Chưa đọc được nhóm này, thử lại sau', 'This space is not loaded yet, try again')); return; }
      const S = _S(), p = fhSpaceProfileOf(sp.type, sp.profile), d = S.data[fid];
      const isFam = sp.type === 'family', owner = !!sp.isOwner;
      let mems = d ? d.members.filter((m) => !m.gone) : null;
      if (!mems && window.DB && window.DB.fid === fid && window.FAM && Array.isArray(window.FAM.members)) mems = window.FAM.members.map((m) => ({ id: null, name: m.name, userId: m.me ? S.uid : null }));
      const memRows = (mems || []).map(function (m, i) {
        const me = m.userId && m.userId === S.uid;
        return '<div class="rl-row">' + fhSpaceAvHTML(i, m.name) + '<span class="rl-t"><b>' + _e(m.name) + '</b><small>' + (me ? L('bạn', 'you') : L('Thành viên', 'Member')) + '</small></span>'
          + ((owner && !isFam && !me && m.id) ? '<button type="button" class="sp-mini" onclick="fhSpaceRemoveArm(\'' + fid + '\',\'' + m.id + '\')">' + L('Mời ra', 'Remove') + '</button>' : '') + '</div>';
      }).join('');
      const base = Object.assign({}, sp.profile || {});
      _fhModal({
        title: sp.name || L('Nhóm', 'Space'), saveLabel: owner ? L('Lưu', 'Save') : L('Xong', 'Done'), reqMsg: L('Đặt tên nhóm nhé', 'Give the space a name'),
        body: (owner
            ? '<div class="field"><label>' + L('Tên nhóm', 'Name') + '</label><input id="sp-name" maxlength="40" value="' + _e(sp.name || '') + '" oninput="fhModalDirty()"></div>'
              + (isFam ? '' : '<div class="field"><label>' + L('Biểu tượng', 'Mark') + '</label>' + _emojiHTML(fhSpaceMark(sp)) + '</div>')
            : '')
          + (memRows ? '<div class="field"><label>' + L('Thành viên', 'Members') + '</label><div class="rl-list sp-sw">' + memRows + '</div></div>' : '')
          + (isFam ? '' : '<button type="button" class="fh-s-line" style="margin-top:0" onclick="fhSpaceInviteSheet(\'' + fid + '\')">' + L('Mời thêm người', 'Invite someone') + '</button>')
          + '<div class="field" style="margin-top:22px"><label>' + L('Nhóm này dùng', 'This space uses') + '</label>' + _switchesHTML(p, owner) + (owner ? _modeHTML(p) : '') + '</div>'
          + '<div class="dbt-note">' + (owner ? L('Tắt một mục chỉ ẩn nó đi với mọi người trong nhóm, không xoá gì.', 'Switching one off hides it for everyone in the space. Nothing is deleted.') : L('Chỉ chủ nhóm đổi được các mục này.', 'Only the owner can change these.')) + '</div>'
          + (isFam ? '' : '<div class="dbt-acts2">'
              + (window.fhSpaceCardCached(fid) ? '<button type="button" onclick="fhSpaceCardShow(\'' + fid + '\')">' + L('Xem mã khóa nhóm', 'Show the space code') + '</button>' : '')
              + (owner ? '<button type="button" onclick="fhSpaceCloseArm(\'' + fid + '\')">' + (sp.closed ? L('Mở lại nhóm', 'Reopen the space') : L('Đóng nhóm', 'Close the space')) + '</button>'
                       : '<button type="button" class="danger" onclick="fhSpaceLeaveArm(\'' + fid + '\')">' + L('Rời nhóm', 'Leave the space') + '</button>')
              + '</div>'),
        required: function () { return owner ? [{ el: $('sp-name'), ok: !!(($('sp-name') || {}).value || '').trim() }] : []; },
        save: async function () {
          if (!owner) return;
          const name = (($('sp-name') || {}).value || '').trim();
          const prof = _readProfile(base);
          if (!isFam) { const em = (typeof chosen === 'function' && $('sp-emoji')) ? chosen('sp-emoji') : null; if (em) prof.emoji = em; }
          if (name === sp.name && JSON.stringify(prof) === JSON.stringify(sp.profile || {})) return;
          const r = await fhSpaceUpdate(fid, name, prof);
          if (!r.ok) { const e = new Error(r.error || 'update_failed'); e.fhMsg = L('Chưa lưu được. Ứng dụng đang được cập nhật, thử lại sau ít phút.', 'Could not save. The app is being updated, try again in a few minutes.'); throw e; }
          return function () {
            try { fhSpaceShellApply(); if (window.DB && window.DB.fid === fid) { if (window.FAM) window.FAM.familyName = name; if (typeof renderAll === 'function') renderAll(); if (typeof renderEvents === 'function') renderEvents(); if (typeof renderTxns === 'function') renderTxns(); } _redraw(); } catch (e) {}
          };
        },
      });
    };
    window.fhSpaceCardShow = function (fid) {
      const disp = window.fhSpaceCardCached(fid); if (!disp) return;
      _fhModal({ title: L('Mã khóa của nhóm', 'The space code'), saveLabel: L('Xong', 'Done'),
        body: '<div class="dbt-cardshow num">' + _e(disp) + '</div>'
          + '<div class="dbt-note">' + L('Ai có mã này và được mời thì đọc được sổ nhóm. Đừng đăng công khai.', 'Anyone invited who has this code can read the space. Do not post it publicly.') + '</div>',
        save: async function () {} });
    };
    window.fhSpaceLeaveArm = async function (fid) {
      if (!_arm('leave:' + fid, L('Bấm lần nữa để rời nhóm. Số dư của bạn vẫn nằm lại trong sổ nhóm.', 'Tap again to leave. Your balance stays on the space record.'))) return;
      const wasOpen = window.DB && window.DB.fid === fid;
      const r = await fhSpaceLeave(fid);
      if (!r.ok) { window.toast && toast(/owner_cannot_leave/.test(r.error || '') ? L('Chủ nhóm không rời được nhóm của mình', 'The owner cannot leave their own space') : L('Chưa rời được, thử lại', 'Could not leave, try again')); return; }
      window._closeOv(); window.toast && toast(L('Đã rời nhóm', 'You left the space'));
      if (wasOpen) _afterGone(); else _redraw();
    };
    window.fhSpaceCloseArm = async function (fid) {
      const sp = fhSpaceGet(fid); if (!sp) return;
      if (!sp.closed && !_arm('close:' + fid, L('Bấm lần nữa để đóng nhóm. Mọi người vẫn xem được, không ghi thêm được.', 'Tap again to close. Everyone can still read it, nobody can add to it.'))) return;
      const r = await fhSpaceClose(fid, !sp.closed);
      if (!r.ok) { window.toast && toast(L('Chưa làm được, thử lại', 'That did not work, try again')); return; }
      window._closeOv(); window.toast && toast(sp.closed ? L('Đã mở lại nhóm', 'The space is open again') : L('Đã đóng nhóm', 'The space is closed'));
      try { fhSpaceShellApply(); if (typeof renderAll === 'function') renderAll(); _redraw(); } catch (e) {}
    };
    window.fhSpaceRemoveArm = async function (fid, memberId) {
      if (!_arm('rm:' + memberId, L('Bấm lần nữa để mời người này ra. Số dư của họ vẫn nằm lại trong sổ.', 'Tap again to remove them. Their balance stays on the record.'))) return;
      const r = await fhSpaceRemoveMember(fid, memberId);
      if (!r.ok) { window.toast && toast(L('Chưa làm được, thử lại', 'That did not work, try again')); return; }
      window.toast && toast(L('Đã mời ra khỏi nhóm', 'Removed from the space'));
      if (window.DB && window.DB.fid === fid && window.loadFamilyData) await window.loadFamilyData();
      window.fhSpaceProfileSheet(fid);
    };
    /* The open space is gone for this person (left, removed, archived): go to
       whatever the server made active next, or to Tài chính alone. */
    async function _afterGone() {
      try {
        await fhSpacesBoot({ force: true });
        const next = _S().all.find((x) => x.isActive) || _S().all[0];
        if (next) { await fhSpaceOpen(next.id, { force: true, tab: 'personal' }); return; }
      } catch (e) {}
      if (typeof fhEnterPersonalOnly === 'function') fhEnterPersonalOnly();
    }
    window.fhSpaceAfterGone = _afterGone;

    /* ── settle-up ─────────────────────────────────────────────────────────── */
    window.fhSpaceSettleSheet = function (fid, preset) {
      fid = fid || (window.DB && window.DB.fid);
      const S = _S(), d = S.data[fid]; if (!d) { window.toast && toast(L('Đang tải số dư, thử lại sau giây lát', 'Balances are loading, try again in a moment')); return; }
      const sp = fhSpaceGet(fid); if (sp && sp.closed) { window.toast && toast(L('Nhóm đã đóng', 'This space is closed')); return; }
      const mems = d.members.filter((m) => !m.gone), my = fhSpaceMyMemberId(fid);
      const pairs = fhSpacePairwise(fid) || [];
      const mine = preset || pairs.find((p) => p.from.id === my) || pairs.find((p) => p.to.id === my) || pairs[0] || null;
      const fromId = mine ? mine.from.id : my, toId = mine ? mine.to.id : null;
      _fhModal({
        title: L('Ghi trả nợ', 'Record a settle-up'), saveLabel: L('Ghi lại', 'Record'), reqMsg: L('Chọn người và số tiền nhé', 'Pick the people and the amount'),
        body: '<div class="field"><label>' + L('Ai trả?', 'Who paid?') + '</label><div class="choices" id="dbt-sufrom">'
          + mems.map((m) => '<button type="button" class="choice' + (fromId === m.id ? ' on' : '') + '" data-v="' + m.id + '" onclick="pick(\'dbt-sufrom\',this)">' + _e(m.name) + '</button>').join('') + '</div></div>'
          + '<div class="field"><label>' + L('Trả cho ai?', 'Paid to?') + '</label><div class="choices" id="dbt-suto">'
          + mems.map((m) => '<button type="button" class="choice' + (toId === m.id ? ' on' : '') + '" data-v="' + m.id + '" onclick="pick(\'dbt-suto\',this)">' + _e(m.name) + '</button>').join('') + '</div></div>'
          + _amtIn('dbt-amt', mine ? fmt(mine.amt) : '0 ₫')
          + '<div class="dbt-note">' + L('Ai trong nhóm cũng ghi được. Người kia sẽ nhận được thông báo.', 'Anyone in the space can record this. The other person is notified.') + '</div>',
        after: function () { const a = $('dbt-amt'); if (a && mine && typeof amtToInput === 'function') a.value = amtToInput(mine.amt); },
        required: function () {
          const f = typeof chosen === 'function' ? chosen('dbt-sufrom') : null, t = typeof chosen === 'function' ? chosen('dbt-suto') : null;
          return [
            { el: $('dbt-suto'), ok: !!(f && t && f !== t) },
            { el: $('dbt-amt'), ok: _amtOf('dbt-amt') > 0 },
          ];
        },
        save: async function () {
          const r = await fhSpaceSettle(fid, { fromMember: chosen('dbt-sufrom'), toMember: chosen('dbt-suto'), amtK: _amtOf('dbt-amt') });
          if (!r.ok) throw new Error(r.error || 'save_failed');
          const sq = !(fhSpacePairwise(fid) || []).length;
          window.toast && toast(sq ? L('Đã ghi trả nợ. Nhóm đã cân bằng.', 'Settle-up recorded. The space is square.') : L('Đã ghi trả nợ', 'Settle-up recorded'));
          return _afterMoney;
        },
      });
    };
    function _afterMoney() {
      try { if (typeof fhSpaceSplitBoxRender === 'function') fhSpaceSplitBoxRender(); if (typeof renderHome === 'function') renderHome(); if (typeof renderTxns === 'function') renderTxns(); _redraw(); window.persDebtRedraw && window.persDebtRedraw(); } catch (e) {}
    }
    window.fhSpaceAfterMoney = _afterMoney;
    /* one settle-up: who, how much, and the way to take it back */
    window.fhSpaceSettleRowSheet = function (fid, id) {
      const S = _S(), d = S.data[fid]; if (!d) return;
      const s = d.settles.find((x) => x.id === id); if (!s) return;
      const f = d.members.find((m) => m.id === s.from), t = d.members.find((m) => m.id === s.to), my = fhSpaceMyMemberId(fid);
      const mine = (s.from === my || s.to === my || s.by === S.uid);
      const sp = fhSpaceGet(fid);
      _fhSheet('<div class="sheet-h">' + _e(f ? f.name : '?') + ' ' + L('trả', 'paid') + ' ' + _e(t ? t.name : '?') + '</div>'
        + '<div class="sheet-sub">' + (s._unreadable ? '—' : fmt(s.amt)) + ' · ' + _e(fmtDayMon(new Date(s.date + 'T00:00:00'))) + '</div>'
        + ((mine && !(sp && sp.closed))
          ? '<button type="button" class="fh-s-line" onclick="fhSpaceSettleDelArm(\'' + fid + '\',\'' + id + '\')">' + L('Xoá khoản trả nợ này', 'Delete this settle-up') + '</button>'
          : '<div class="dbt-note">' + L('Người trả, người nhận hoặc người ghi mới xoá được khoản này.', 'Only the payer, the receiver or whoever recorded it can delete this.') + '</div>'));
    };
    window.fhSpaceSettleDelArm = async function (fid, id) {
      if (!_arm('sdel:' + id, L('Bấm lần nữa để xoá. Số dư của hai người sẽ tính lại.', 'Tap again to delete. Both balances are recalculated.'))) return;
      const r = await fhSpaceSettleDelete(fid, id);
      window._closeOv();
      window.toast && toast(r.ok ? L('Đã xoá khoản trả nợ', 'Settle-up deleted') : L('Chưa xoá được, thử lại', 'Could not delete, try again'));
      _afterMoney();
    };

    /* ── change how a saved expense is counted (its detail screen) ─────────── */
    window.fhSpaceEditSplitSheet = function (txId) {
      const tx = (typeof txById === 'function') ? txById(isNaN(Number(txId)) ? txId : Number(txId)) || txById(txId) : null;
      const fid = window.DB && window.DB.fid; if (!tx || !tx._dbId || !fid) return;
      const d = _S().data[fid]; if (!d) { window.toast && toast(L('Đang tải số dư, thử lại sau giây lát', 'Balances are loading, try again in a moment')); return; }
      const s = d.shares[tx._dbId] && d.shares[tx._dbId].map ? d.shares[tx._dbId] : null;
      const bill = (s && s.map._bill) ? Number(s.map._bill) : Number(tx.amt);
      const ids = s ? fhSplitMembers(s.map) : null;
      let exact = null;
      if (s && s.rule === 'exact') { exact = {}; ids.forEach((k) => { exact[k] = Number(s.map[k]) || 0; }); }
      fhSplitStart({ fid: fid, amt: bill, mode: s ? 'chia' : 'chung', payer: s ? s.payer : (tx._memberId || fhSpaceMyMemberId(fid)),
        members: ids, parts: s ? (s.map._parts || ids.length) : null, exact: exact });
      FH_SPLIT._host = 'edit';
      _fhSheet('<div class="sheet-h">' + L('Tính thế nào?', 'How is it counted?') + '</div>'
        + '<div class="sheet-sub">' + fmt(bill) + (tx.note ? ' · ' + _e(tx.note) : '') + '</div>'
        + '<div id="spx">' + fhSplitHTML() + '</div>'
        + '<button type="button" class="fh-s-cta" style="margin-top:18px" onclick="fhSpaceEditSplitSave(\'' + String(txId).replace(/'/g, '') + '\')">' + L('Lưu cách chia', 'Save the split') + '</button>');
    };
    window.fhSpaceEditSplitSave = async function (txId) {
      const tx = (typeof txById === 'function') ? (txById(txId) || txById(Number(txId))) : null;
      const fid = window.DB && window.DB.fid; if (!tx || !tx._dbId || !fid || !FH_SPLIT) return;
      if (navigator.onLine === false) { window.toast && toast(L('Cần có mạng để đổi cách chia', 'Changing a split needs a connection')); return; }
      const d = _S().data[fid], had = !!(d && d.shares[tx._dbId] && d.shares[tx._dbId].map);
      const res = fhSplitResult();
      let newAmt = FH_SPLIT.amt, payer = res.payer;
      if (res.mode === 'chia') {
        if (!res.ok) { window.toast && toast(res.err === 'members' ? L('Chọn ít nhất một người trong nhóm', 'Pick at least one member') : L('Các phần đang nhiều hơn hoá đơn', 'The shares add up to more than the bill')); return; }
        newAmt = res.r.inside;
        await fhSpaceSetShares(fid, tx._dbId, payer, res.rule, res.payload);
        if (d) d.shares[tx._dbId] = { payer: payer, rule: res.rule, map: res.payload };      // so the amount write below finds nothing left to rescale
        if (res.outName) window.fhSpaceBookHint(tx._dbId, { acct: null, outName: res.outName });
      } else if (had) {
        await fhSpaceClearShares(fid, tx._dbId);
        if (d) delete d.shares[tx._dbId];
      }
      /* the amount the space row carries is the members' part; the payer of a
         Chia expense is the row's member. Written narrowly: nothing else moves. */
      const amtChanged = Math.abs(Number(tx.amt) - newAmt) > 0.0005, payerChanged = res.mode === 'chia' && payer && payer !== tx._memberId;
      if (amtChanged || payerChanged) {
        const patch = Object.assign({}, amtChanged ? await fhField('amount', newAmt) : {}, payerChanged ? { member_id: payer } : {});
        try { if (window.DB) window.DB._lastLocalWrite = Date.now(); } catch (e) {}
        const r = await window.sb.from('transactions').update(patch).eq('id', tx._dbId);
        if (r.error) { window.toast && toast(L('Chưa lưu được số tiền mới, thử lại', 'Could not save the new amount, try again')); }
        else { tx.amt = newAmt; if (payerChanged) { tx._memberId = payer; const nm = fhSpaceMemberName(payer); if (nm) tx.who = nm; } }
      }
      fhSplitEnd(); window._closeOv();
      window.fhSpaceStale(fid);
      await fhSpaceHydrate(fid);
      window.toast && toast(L('Đã lưu cách chia. Số dư đã tính lại.', 'Split saved. Balances are recalculated.'));
      try { if (typeof renderExpenseDetailIfOpen === 'function') renderExpenseDetailIfOpen(); _afterMoney(); if (window.loadFamilyData) window.loadFamilyData({ windowed: true }); } catch (e) {}
      try { window.fhNotify && window.fhNotify('space_expense', { familyId: fid, tx: tx._dbId }); } catch (e) {}
    };

    /* ── an invite link opened in a browser where nobody is signed in ──────── */
    /* On an iPhone a link (or a scanned QR) can only open a browser, never the
       installed app, and the two do not share storage. So the browser's job is
       to hand the invite over: copy it, open Earthy from the home screen, paste.
       Someone with no app yet simply continues here; the invite waits through
       the sign-in. */
    function _handoff() {
      const p = window.__fhPendingSpace; if (!p || !window.__fhPendingSpaceFresh) return;
      const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
      let resumed = false; try { resumed = !!localStorage.getItem('fh-resume'); } catch (e) {}
      if (standalone || resumed) return;                 // signed in here: afterLogin joins directly
      const inapp = fhInAppBrowser(navigator.userAgent);
      const ov = document.createElement('div'); ov.id = 'sp-handoff'; ov.className = 'sp-handoff';
      ov.innerHTML = '<div class="sp-ho-in">'
        + '<div class="sp-ho-mark">🤝</div>'
        + '<div class="sp-ho-t">' + (p.name ? L('Bạn được mời vào nhóm ', 'You are invited to ') + '<b>' + _e(p.name) + '</b>' : L('Bạn được mời vào một nhóm trên Earthy', 'You are invited to a space on Earthy')) + '</div>'
        + '<div class="sp-ho-s">' + L('Đã cài Earthy trên máy này? Sao chép lời mời, mở Earthy từ màn hình chính, vào Tài chính, mục Nhóm, bấm "Dán link mời".', 'Already have Earthy on this phone? Copy the invite, open Earthy from your home screen, go to Finance, Spaces, and tap "Paste an invite".') + '</div>'
        + '<button type="button" class="fh-s-cta" id="sp-ho-copy">' + L('Sao chép lời mời', 'Copy the invite') + '</button>'
        + '<button type="button" class="fh-s-line" id="sp-ho-here">' + L('Chưa cài, tiếp tục trên trình duyệt này', 'No app yet, continue in this browser') + '</button>'
        + (inapp ? '<div class="sp-ho-warn">' + L('Trình duyệt trong ứng dụng này thường không đăng nhập Google được. Bấm dấu ••• hoặc biểu tượng la bàn rồi chọn mở bằng Safari hay Chrome.', 'This in-app browser usually cannot complete Google sign-in. Use the ••• or compass button to open it in Safari or Chrome.') + '</div>' : '')
        + '<div class="sp-ho-foot">' + L('Lời mời mang theo mã khóa của nhóm. Chỉ dán vào Earthy, đừng gửi cho người khác.', 'The invite carries the space key. Paste it only into Earthy; do not pass it on.') + '</div>'
        + '</div>';
      (document.getElementById('phone') || document.body).appendChild(ov);
      $('sp-ho-copy').onclick = async function () {
        const url = window.__fhPendingSpaceUrl || '';
        let ok = false;
        try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {}
        if (!ok) { try { const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.className = 'sp-ho-ta'; ov.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e) {} }
        this.textContent = ok ? L('Đã sao chép. Giờ mở Earthy và dán.', 'Copied. Now open Earthy and paste.') : L('Chưa sao chép được. Giữ lâu vào thanh địa chỉ để chép.', 'Could not copy. Long-press the address bar to copy.');
      };
      $('sp-ho-here').onclick = function () { ov.remove(); };
    }
    window.fhSpaceHandoffShow = _handoff;
    try { _handoff(); } catch (e) {}
  })();