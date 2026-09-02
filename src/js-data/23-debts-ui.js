  /* ═══ Nợ & cho vay — UI (docs/specs/borrowing-lending-spec.md §6) ═══════════
     The "zoom out": a bento section on the Tài Chính tab — a wide hero tile with
     dual concentric rings (Tôi nợ / Được nợ) + one tile per counterparty — and
     the "zoom in": a full-screen overlay with three flavors (account · person ·
     space). Chosen design: mockups/borrowing-lending-ring.html variant 01.

     Lives in js-data (module scope) so it can use _fhModal (60-settings) and the
     space DEK helpers (22-spaces); renderPersonal (js-ui) reaches it via the
     window.persDebt* exports. Amounts are base units (thousands); parseAmtBase /
     fmt / fmtK are classic-script globals. */
  (function () {
    const _e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _P = () => window.fhPersonalData && fhPersonalData();
    const _S = () => window.fhSpacesData && fhSpacesData();
    const AV_COLORS = ['#5E5CE6', '#E0567F', '#12B5A6', '#E8843C', '#9D4EFF', '#1FA971'];
    const _avColor = (i) => AV_COLORS[i % AV_COLORS.length];
    let _last = null;          // last computed personal debts (tile taps resolve through this)
    let _spinning = false;     // space hydrate in flight

    /* ── totals: personal (cards + 1:1) ⊕ space nets — two key domains, one view ── */
    function _totals() {
      const d = window.fhPersonalDebts ? fhPersonalDebts() : { cards: [], people: [], owe: 0, owed: 0 };
      _last = d;
      let owe = d.owe, owed = d.owed;
      const spaces = [];
      const S = _S();
      if (S && S.list) for (const sp of S.list) {
        const net = (S.data[sp.id]) ? fhSpaceMyNet(sp.id) : null;   // null = not loaded yet
        spaces.push({ sp: sp, net: net, ready: !!S.keys[sp.id], loaded: !!S.data[sp.id] });
        if (net != null) { if (net > 0) owed += net; else owe += -net; }
      }
      return { d: d, spaces: spaces, owe: owe, owed: owed };
    }

    /* ── the bento section ─────────────────────────────────────────────────── */
    window.persDebtSection = function () {
      const P = _P(); if (!P || !P.key) return '';
      const t = _totals();
      const balAccts = (P.accounts || []).filter((a) => a.kind !== 'credit_card');
      const hasAny = t.d.cards.length || t.d.people.length || t.spaces.length || _spaceInvites.length || balAccts.length;
      let h = '<div id="pers-debts-wrap">'
        + '<div class="section-h" id="pers-debts-h"><span class="t">Nợ &amp; cho vay</span>'
        + '<span class="acts"><a onclick="fhXferSheet()">Chuyển tiền</a>'
        + '<a onclick="fhDebtLoanSheet()">Ghi khoản vay</a></span></div>';
      /* pending space invites — above everything, they need a decision */
      _spaceInvites.forEach(function (inv) {
        h += '<section class="dbt-empty dbt-invite"><div class="dbt-empty-t"><b>' + _e(inv.invited_by || 'Bạn của bạn') + '</b> mời bạn vào nhóm chia tiền <b>' + _e(inv.family_name || 'Nhóm') + '</b>.</div>'
          + '<div class="dbt-empty-cta"><button onclick="fhSpaceAcceptInvite(\'' + inv.family_id + '\')">Tham gia nhóm</button></div></section>';
      });
      if (!hasAny) {
        h += '<section class="dbt-empty"><div class="dbt-empty-t">Thẻ tín dụng, cho vay, chia tiền nhóm — bức tranh nợ của bạn nằm ở đây.</div>'
          + '<div class="dbt-empty-cta">'
          + '<button onclick="fhDebtLoanSheet()">Ghi cho vay / mượn</button>'
          + '<button onclick="fhSpaceCreateSheet()">Tạo nhóm chia tiền</button>'
          + '</div></section></div>';
        return h;
      }
      /* hero — dual concentric rings; frac against max side so the fuller ring closes */
      const mx = Math.max(t.owe, t.owed, 1);
      const C1 = 326.7, C2 = 219.9;                       // r=52 / r=35
      const o1 = (C1 * (1 - t.owe / mx)).toFixed(1), o2 = (C2 * (1 - t.owed / mx)).toFixed(1);
      h += '<div class="debt-bento">'
        + '<section class="dbt-tile wide dbt-hero">'
        + '<svg width="100" height="100" viewBox="0 0 120 120" aria-hidden="true">'
        + '<circle cx="60" cy="60" r="52" fill="none" stroke="var(--danger-tint)" stroke-width="12"/>'
        + '<circle cx="60" cy="60" r="52" fill="none" stroke="var(--danger)" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + C1 + '" stroke-dashoffset="' + o1 + '" transform="rotate(-90 60 60)"/>'
        + '<circle cx="60" cy="60" r="35" fill="none" stroke="var(--good-tint)" stroke-width="12"/>'
        + '<circle cx="60" cy="60" r="35" fill="none" stroke="var(--good)" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + C2 + '" stroke-dashoffset="' + o2 + '" transform="rotate(-90 60 60)"/>'
        + '</svg>'
        + '<div class="dbt-legend">'
        + '<div class="dbt-lr"><span class="dbt-dot" style="background:var(--danger)"></span><span class="dbt-lk">Tôi nợ</span><span class="dbt-lv num">' + fmt(t.owe) + '</span></div>'
        + '<div class="dbt-ldiv"></div>'
        + '<div class="dbt-lr"><span class="dbt-dot" style="background:var(--good)"></span><span class="dbt-lk">Được nợ</span><span class="dbt-lv num">' + fmt(t.owed) + '</span></div>'
        + '</div></section>';
      /* Tiles collected first, so a lone one (or an odd trailing one) can span
         the full width instead of leaving half the row empty — the sparse /
         single-card case (spec Q5). */
      const tiles = [];
      t.d.cards.forEach(function (c) {
        const neg = c.outstanding > 0, due = _dueLabel(c.acct);
        let ht = '<button class="dbt-tile dbt-card-tile" onclick="openDebtAccount(\'' + c.acct.id + '\')">'
          + '<div class="dbt-tk">' + _e(c.acct.name || 'Thẻ') + '</div>'
          + '<div class="dbt-tv num ' + (neg ? 'owe' : 'owed') + '">' + (neg ? '−' : '+') + fmtK(Math.abs(c.outstanding)) + '</div>';
        if (c.acct.limitK > 0) {
          const pct = Math.min(100, Math.round(c.outstanding / c.acct.limitK * 100));
          ht += '<div class="dbt-ms"><span>Dùng ' + pct + '%</span><span>hạn ' + fmtK(c.acct.limitK) + '</span></div>'
            + '<div class="dbt-meter"><i style="width:' + pct + '%"></i></div>';
        } else {
          ht += '<div class="dbt-ts">thẻ tín dụng</div>';
        }
        if (due) ht += '<div class="dbt-tchip"><span class="dbt-due">' + due + '</span></div>';
        ht += '</button>';
        tiles.push(ht);
      });
      /* Non-card accounts (0109): a balance tile each — anchor-derived number,
         or the honest "chưa có mốc" when no anchor exists (a derived balance
         with no anchor would be confidently wrong). Drift wears a quiet chip. */
      balAccts.forEach(function (a) {
        const bal = window.fhPersonalBalance ? fhPersonalBalance(a.id) : null;
        const dr = window.fhPersonalDrift ? fhPersonalDrift(a.id) : null;
        const kindLbl = a.kind === 'ewallet' ? 'ví điện tử' : (a.kind === 'cash' ? 'tiền mặt' : 'tài khoản');
        let ht = '<button class="dbt-tile" onclick="openBalAccount(\'' + a.id + '\')">'
          + '<div class="dbt-tk">' + _e(a.name || 'Tài khoản') + '</div>';
        if (bal != null) {
          ht += '<div class="dbt-tv num' + (bal < 0 ? ' owe' : '') + '">' + (bal < 0 ? '−' : '') + fmtK(Math.abs(bal)) + '</div>'
            + '<div class="dbt-ts">' + kindLbl + '</div>';
        } else {
          ht += '<div class="dbt-tv num dim">—</div>'
            + '<div class="dbt-ts">chưa có mốc số dư · chạm để đặt</div>';
        }
        if (dr) ht += '<div class="dbt-tchip"><span class="dbt-due">lệch ' + (dr.drift > 0 ? '+' : '−') + fmtK(Math.abs(dr.drift)) + '</span></div>';
        tiles.push(ht + '</button>');
      });
      t.spaces.forEach(function (s) {
        const net = s.net, known = net != null;
        let ht = '<button class="dbt-tile" onclick="openDebtSpace(\'' + s.sp.id + '\')">'
          + '<div class="dbt-tk">' + _e(s.sp.name) + '</div>';
        if (known && Math.abs(net) > 0.5) {
          ht += '<div class="dbt-tv num ' + (net < 0 ? 'owe' : 'owed') + '">' + (net < 0 ? '−' : '+') + fmtK(Math.abs(net)) + '</div>'
            + '<div class="dbt-ts">' + (net < 0 ? 'bạn nợ nhóm' : 'nhóm nợ bạn') + '</div>';
        } else if (known) {
          ht += '<div class="dbt-tv num">0đ</div><div class="dbt-ts">đã cân bằng</div>';
        } else {
          ht += '<div class="dbt-tv num">…</div><div class="dbt-ts">' + (s.ready ? 'đang tải' : 'nhập thẻ nhóm để mở') + '</div>';
        }
        tiles.push(ht + '</button>');
      });
      t.d.people.forEach(function (p, i) {
        if (Math.abs(p.balance) < 0.5) return;
        const owedMe = p.balance > 0;
        tiles.push('<button class="dbt-tile" onclick="openDebtPerson(' + i + ')">'
          + '<div class="dbt-tk">' + _e(p.who) + '</div>'
          + '<div class="dbt-tv num ' + (owedMe ? 'owed' : 'owe') + '">' + (owedMe ? '+' : '−') + fmtK(Math.abs(p.balance)) + '</div>'
          + '<div class="dbt-ts">🔒 ' + (owedMe ? 'cho vay · riêng tư' : 'bạn mượn · riêng tư') + '</div>'
          + '</button>');
      });
      // an odd trailing tile spans the full row so the grid never looks half-empty
      if (tiles.length % 2 === 1) tiles[tiles.length - 1] = tiles[tiles.length - 1].replace('class="dbt-tile', 'class="dbt-tile wide');
      h += tiles.join('');
      h += '</div></div>';
      return h;
    };

    /* Space data arrives async — refresh ONLY this section in place. */
    let _spaceInvites = [];
    window.persDebtAfterRender = function () {
      const S = _S(); if (!S || _spinning) return;
      _spinning = true;
      (async function () {
        try {
          await fhSpacesBoot();
          let changed = false;
          /* Pending SPACE invites (filtered out of the onboarding door) land
             here: "bạn được mời vào nhóm X". */
          try {
            const r = await window.sb.rpc('find_my_invites');
            const invs = (Array.isArray(r.data) ? r.data : []).filter((i) =>
              (i.family_type === 'friend' || i.family_type === 'trip')
              && !(S.list || []).some((sp) => sp.id === i.family_id));
            if (invs.length !== _spaceInvites.length) changed = true;
            _spaceInvites = invs;
          } catch (e) {}
          for (const sp of (S.list || [])) {
            if (S.keys[sp.id] && (!S.data[sp.id] || Date.now() - S.data[sp.id].at > 60000)) {
              await fhSpaceHydrate(sp.id); changed = true;
            }
          }
          if (changed) _redraw();
        } catch (e) { console.warn('debt spaces refresh failed', e); }
        finally { _spinning = false; }
      })();
    };
    window.fhSpaceAcceptInvite = async function (fid) {
      const r = await fhSpaceJoin(fid);
      if (!r.ok) { window.toast && toast('Chưa tham gia được — nhờ chủ nhóm mời lại nhé'); return; }
      _spaceInvites = _spaceInvites.filter((i) => i.family_id !== fid);
      await fhSpacesBoot();
      _redraw();
      window.toast && toast('Đã vào nhóm — nhập thẻ nhóm để đọc sổ');
      openDebtSpace(fid);
    };
    function _redraw() {
      const el = document.getElementById('pers-debts-wrap');
      if (el && window.persDebtSection) {
        const html = persDebtSection();
        if (html) el.outerHTML = html;
      }
    }

    /* ── the overlay (zoom in) ─────────────────────────────────────────────── */
    function _ovOpen(title, bodyHtml) {
      const t = document.getElementById('dbt-title'); if (t) t.textContent = title;
      const b = document.getElementById('dbt-body'); if (b) { b.innerHTML = bodyHtml; }
      const ov = document.getElementById('debt-overlay'); if (ov) ov.classList.add('on');
      const sc = document.getElementById('dbt-scroll'); if (sc) sc.scrollTop = 0;
    }
    window.closeDebt = function () { const ov = document.getElementById('debt-overlay'); if (ov) ov.classList.remove('on'); };

    const _dmy = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
    /* "đến hạn DD/MM" — the next occurrence of the card's due day, clamped to
       the real length of that month so a due_day of 31 never rolls to the 1st. */
    const _dueLabel = (acct) => {
      if (!acct || !acct.dueDay) return '';
      const now = new Date(); let y = now.getFullYear(), mo = now.getMonth();
      if (now.getDate() > acct.dueDay) { mo++; if (mo > 11) { mo = 0; y++; } }
      const dim = new Date(y, mo + 1, 0).getDate();
      const day = Math.min(acct.dueDay, dim);
      return 'đến hạn ' + String(day).padStart(2, '0') + '/' + String(mo + 1).padStart(2, '0');
    };

    /* ① account (card) detail */
    window.openDebtAccount = function (acctId) {
      const P = _P(); if (!P) return;
      const acct = P.accounts.find((a) => a.id === acctId); if (!acct) return;
      const d = _last || fhPersonalDebts();
      const b = (d.byAcct && d.byAcct[acctId]) || { spend: 0, paid: 0, rows: [] };
      const out = b.spend - b.paid;
      const due = _dueLabel(acct);
      let h = '<div class="dbt-hero2"><div class="dbt-hk">' + (out >= 0 ? 'Đang nợ' : 'Đang dư') + '</div>'
        + '<div class="dbt-hv num ' + (out > 0 ? 'owe' : 'owed') + '">' + fmt(Math.abs(out)) + '</div>';
      const meta = [];
      if (acct.limitK > 0) meta.push('Hạn mức còn ' + fmt(Math.max(0, acct.limitK - out)) + ' / ' + fmt(acct.limitK));
      if (due) meta.push(due);
      if (meta.length) h += '<div class="dbt-hs">' + meta.join(' · ') + '</div>';
      if (acct.limitK > 0) {
        const pct = Math.min(100, Math.round(out / acct.limitK * 100));
        h += '<div class="dbt-meter big"><i style="width:' + Math.max(0, pct) + '%"></i></div>';
      }
      // reconcile: the derived balance is only as complete as what got captured
      h += '<button class="dbt-relink" onclick="fhCardReconcileSheet(\'' + acct.id + '\')">Số chưa khớp? Cập nhật dư nợ thực tế</button>';
      h += '</div>';
      h += '<div class="dbt-acts">'
        + '<button class="dbt-btn primary" onclick="fhCardPaySheet(\'' + acct.id + '\')">Ghi thanh toán thẻ</button>'
        + '<button class="dbt-btn tinted" onclick="fhAcctEditSheet(\'' + acct.id + '\')">Cài đặt thẻ</button>'
        + '</div>';
      /* One list, both sides of the card, filterable. No +/− signs — a payment
         reads as green with a "trả nợ" tag, a purchase is neutral ink, and a
         reconcile shows an "điều chỉnh" tag. Direction lives in colour + tag +
         filter, not in the number's sign (spec Q1). */
      const all = (b.rows || []).slice().sort((a, x) => (x.date || '').localeCompare(a.date || ''));
      h += '<div class="dbt-sec">Giao dịch</div>';
      h += '<div class="dbt-filters" id="dbt-filters">'
        + '<button class="dbt-fchip on" data-f="all" onclick="fhCardFilter(this,\'all\')">Tất cả</button>'
        + '<button class="dbt-fchip" data-f="spend" onclick="fhCardFilter(this,\'spend\')">Chi tiêu</button>'
        + '<button class="dbt-fchip" data-f="pay" onclick="fhCardFilter(this,\'pay\')">Trả nợ</button>'
        + '</div>';
      h += '<div class="dbt-card" id="dbt-txlist">';
      if (!all.length) h += '<div class="dbt-note">Chưa có giao dịch nào gắn với thẻ này. Chi tiêu từ email tự gắn khi bạn duyệt; trả nợ thì bấm “Ghi thanh toán thẻ”.</div>';
      all.slice(0, 120).forEach(function (r) {
        const pay = r.kind === 'transfer';
        const adj = pay && (r.note || '').indexOf('Điều chỉnh') === 0;
        h += '<div class="dbt-li" data-k="' + (pay ? 'pay' : 'spend') + '"><span class="dbt-lic">' + (adj ? '⚖️' : (pay ? '💳' : (r.emoji || '🗂️'))) + '</span>'
          + '<span class="dbt-lib"><span class="dbt-lin">' + _e(pay ? (r.note || 'Thanh toán thẻ') : (r.note || r.cat || 'Khoản chi'))
          + (pay ? '<i class="dbt-tag' + (adj ? ' adj' : '') + '">' + (adj ? 'điều chỉnh' : 'trả nợ') + '</i>' : '') + '</span>'
          + '<span class="dbt-lis">' + _dmy(r.date) + (!pay && r.cat ? ' · ' + _e(r.cat) : '') + '</span></span>'
          + '<span class="dbt-liv num' + (pay && !adj ? ' owed' : '') + '">' + fmt(Math.abs(r.amt || 0)) + '</span></div>';
      });
      h += '</div>';
      h += '<div class="dbt-foot">Trả sao kê là <b>chuyển khoản</b>, không phải chi tiêu — các khoản chi đã được tính lúc quẹt, nên không bị đếm hai lần.</div>';
      _ovOpen(acct.name || 'Thẻ', h);
    };
    /* filter the unified card list in place (no re-render) */
    window.fhCardFilter = function (btn, f) {
      const wrap = document.getElementById('dbt-filters');
      if (wrap) wrap.querySelectorAll('.dbt-fchip').forEach(function (b) { b.classList.toggle('on', b === btn); });
      const list = document.getElementById('dbt-txlist'); if (!list) return;
      list.querySelectorAll('.dbt-li').forEach(function (li) {
        li.style.display = (f === 'all' || li.getAttribute('data-k') === f) ? '' : 'none';
      });
    };

    /* ② person (1:1 IOU) detail */
    window.openDebtPerson = function (idx) {
      const d = _last || fhPersonalDebts();
      const p = d.people[idx]; if (!p) return;
      const owedMe = p.balance > 0;
      let h = '<div class="dbt-hero2"><div class="dbt-hk">' + (owedMe ? _e(p.who) + ' đang nợ bạn' : 'Bạn đang nợ ' + _e(p.who)) + '</div>'
        + '<div class="dbt-hv num ' + (owedMe ? 'owed' : 'owe') + '">' + fmt(Math.abs(p.balance)) + '</div>'
        + '<div class="dbt-hs"><span class="dbt-chip">🔒 riêng tư — chỉ mình bạn thấy</span></div></div>';
      h += '<div class="dbt-acts">'
        + '<button class="dbt-btn primary" onclick="fhDebtRepaySheet(' + idx + ')">Ghi đã trả</button>'
        + '<button class="dbt-btn tinted" onclick="fhDebtLoanSheet(\'' + _e(p.who).replace(/'/g, '\\\'') + '\')">Ghi thêm khoản</button>'
        + '</div>';
      const rows = (p.rows || []).slice().sort((a, x) => (x.date || '').localeCompare(a.date || ''));
      h += '<div class="dbt-sec">Lịch sử</div><div class="dbt-card">';
      rows.forEach(function (r) {
        const loan = r.kind === 'loan';
        const lent = (r.amt || 0) > 0;
        const label = loan ? (lent ? 'Bạn cho mượn' : 'Bạn mượn') : (lent ? _e(p.who) + ' trả bạn' : 'Bạn trả');
        h += '<div class="dbt-li"><span class="dbt-lic">' + (loan ? '💵' : '✅') + '</span>'
          + '<span class="dbt-lib"><span class="dbt-lin">' + label + (r.note ? ' · ' + _e(r.note) : '') + '</span>'
          + '<span class="dbt-lis">' + _dmy(r.date) + '</span></span>'
          + '<span class="dbt-liv num">' + fmt(Math.abs(r.amt || 0)) + '</span></div>';
      });
      h += '</div>';
      h += '<div class="dbt-foot">Khoản vay 1:1 nằm trong sổ cá nhân của bạn — người kia không cần dùng app.</div>';
      _ovOpen(p.who, h);
    };

    /* ③ space detail */
    window.openDebtSpace = function (fid) {
      const S = _S(); if (!S) return;
      const sp = (S.list || []).find((x) => x.id === fid); if (!sp) return;
      if (!S.keys[fid]) {
        _ovOpen(sp.name,
          '<div class="dbt-hero2"><div class="dbt-hk">Nhóm đang khoá</div>'
          + '<div class="dbt-hs" style="margin-top:8px">Nhập thẻ nhóm (người tạo nhóm gửi cho bạn) để mở sổ chia tiền.</div></div>'
          + '<div class="dbt-card" style="padding:14px 16px">'
          + '<input id="dbt-unlock-in" class="dbt-in" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off">'
          + '<button class="dbt-btn primary" style="width:100%;margin-top:10px" onclick="fhSpaceTryUnlock(\'' + fid + '\')">Mở nhóm</button></div>');
        return;
      }
      const d = S.data[fid];
      if (!d) { fhSpaceHydrate(fid).then(() => openDebtSpace(fid)); _ovOpen(sp.name, '<div class="dbt-note" style="padding:20px">Đang tải…</div>'); return; }
      const my = fhSpaceMyMemberId(fid);
      const net = fhSpaceMyNet(fid);
      const bal = fhSpaceBalances(fid) || [];
      const pairs = fhSpacePairwise(fid) || [];
      let h = '<div class="dbt-hero2"><div class="dbt-hk">' + (net >= 0 ? 'Bạn được nợ trong nhóm này' : 'Bạn đang nợ trong nhóm này') + '</div>'
        + '<div class="dbt-hv num ' + (net >= 0 ? 'owed' : 'owe') + '">' + fmt(Math.abs(net)) + '</div></div>';
      h += '<div class="dbt-acts">'
        + '<button class="dbt-btn primary" onclick="fhSpaceSplitSheet(\'' + fid + '\')">Chia khoản mới</button>'
        + '<button class="dbt-btn tinted" onclick="fhSpaceSettleSheet(\'' + fid + '\')">Ghi trả nợ</button>'
        + '</div>';
      h += '<div class="dbt-sec">Số dư nhóm</div><div class="dbt-card">';
      bal.forEach(function (b, i) {
        h += '<div class="dbt-mb"><span class="dbt-av" style="background:' + _avColor(i) + '">' + _e((b.member.name || '?').charAt(0).toUpperCase()) + '</span>'
          + '<span class="dbt-mbn">' + _e(b.member.name) + (b.member.id === my ? '<i class="dbt-you">bạn</i>' : '') + '</span>'
          + '<span class="dbt-mbv num ' + (b.net >= 0 ? 'owed' : 'owe') + '">' + (b.net >= 0 ? '+' : '−') + fmt(Math.abs(b.net)) + '</span></div>';
      });
      pairs.forEach(function (pr) {
        h += '<div class="dbt-pair">⇄ ' + _e(pr.from.name) + ' → ' + _e(pr.to.name) + '<span class="num">' + fmt(pr.amt) + '</span></div>';
      });
      h += '</div>';
      h += '<div class="dbt-sec">Chi tiêu chung</div><div class="dbt-card">';
      if (!d.txns.length) h += '<div class="dbt-note">Chưa có khoản nào. Bấm “Chia khoản mới” để bắt đầu.</div>';
      d.txns.slice(0, 40).forEach(function (t) {
        const s = d.shares[t.id];
        const payer = s && d.members.find((m) => m.id === s.payer);
        h += '<div class="dbt-li"><span class="dbt-lic">🧾</span>'
          + '<span class="dbt-lib"><span class="dbt-lin">' + _e(t.note || 'Khoản chi') + '</span>'
          + '<span class="dbt-lis">' + (payer ? _e(payer.name) + ' trả · ' : '') + _dmy(t.date) + '</span></span>'
          + '<span class="dbt-liv num">' + (t._unreadable ? '—' : fmt(t.amt)) + '</span></div>';
      });
      (d.settles || []).slice(0, 20).forEach(function (s) {
        const f = d.members.find((m) => m.id === s.from), tt = d.members.find((m) => m.id === s.to);
        h += '<div class="dbt-li"><span class="dbt-lic">✅</span>'
          + '<span class="dbt-lib"><span class="dbt-lin">' + _e(f ? f.name : '?') + ' trả ' + _e(tt ? tt.name : '?') + '</span>'
          + '<span class="dbt-lis">' + _dmy(s.date) + '</span></span>'
          + '<span class="dbt-liv num owed">' + (s._unreadable ? '—' : fmt(s.amt)) + '</span></div>';
      });
      h += '</div>';
      h += '<div class="dbt-acts2">'
        + '<button onclick="fhSpaceInviteSheet(\'' + fid + '\')">Mời bạn vào nhóm</button>'
        + (window.fhSpaceCardCached(fid) ? '<button onclick="fhSpaceCardShow(\'' + fid + '\')">Xem thẻ nhóm</button>' : '')
        + '<button class="danger" onclick="fhSpaceLeaveArm(\'' + fid + '\')">Rời nhóm</button>'
        + '</div>';
      _ovOpen(sp.name, h);
    };

    window.fhSpaceTryUnlock = async function (fid) {
      const v = (document.getElementById('dbt-unlock-in') || {}).value || '';
      const r = await fhSpaceUnlock(fid, v);
      if (!r.ok) { window.toast && toast('Thẻ chưa đúng, thử lại nhé'); return; }
      await fhSpaceHydrate(fid);
      openDebtSpace(fid); _redraw();
    };
    window.fhSpaceCardShow = function (fid) {
      const disp = window.fhSpaceCardCached(fid); if (!disp) return;
      _fhModal({ title: 'Thẻ nhóm', saveLabel: 'Xong',
        body: '<div class="dbt-cardshow num">' + _e(disp) + '</div>'
          + '<div class="dbt-note">Gửi thẻ này cho người được mời — họ cần nó để đọc được sổ nhóm. Đừng đăng công khai.</div>',
        save: async function () {} });
    };
    let _leaveArm = null;
    window.fhSpaceLeaveArm = async function (fid) {
      if (_leaveArm !== fid) { _leaveArm = fid; window.toast && toast('Bấm lần nữa để rời nhóm'); setTimeout(() => { if (_leaveArm === fid) _leaveArm = null; }, 4000); return; }
      _leaveArm = null;
      const r = await fhSpaceLeave(fid);
      if (r.ok) { closeDebt(); _redraw(); window.toast && toast('Đã rời nhóm'); }
      else window.toast && toast(r.error === 'owner_cannot_leave' ? 'Chủ nhóm không rời được nhóm của mình' : 'Chưa rời được, thử lại');
    };

    /* ── sheets (all via _fhModal) ─────────────────────────────────────────── */
    const _amtIn = (id, ph) => '<div class="field"><label>Số tiền</label><input class="num" id="' + id + '" inputmode="numeric" placeholder="' + (ph || '0 ₫') + '" oninput="fhModalDirty()"></div>';
    const _amtOf = (id) => window.parseAmtBase ? parseAmtBase((document.getElementById(id) || {}).value || '') : 0;

    window.fhDebtLoanSheet = function (presetWho) {
      _fhModal({
        title: 'Cho vay / mượn', saveLabel: 'Ghi lại', reqMsg: 'Điền tên và số tiền nhé',
        body: '<div class="field"><label>Chiều nào?</label><div class="choices" id="dbt-dir">'
          + '<button class="choice on" data-v="lend" onclick="pick(\'dbt-dir\',this)">💸 Tôi cho mượn</button>'
          + '<button class="choice" data-v="borrow" onclick="pick(\'dbt-dir\',this)">🤝 Tôi mượn</button></div></div>'
          + '<div class="field"><label>Ai?</label><input id="dbt-who" placeholder="vd. Thằng em" value="' + _e(presetWho || '') + '" oninput="fhModalDirty()"></div>'
          + _amtIn('dbt-amt')
          + '<div class="field"><label>Ghi chú <span class="opt">· tuỳ chọn</span></label><input id="dbt-note" placeholder="vd. mượn đóng học phí" oninput="fhModalDirty()"></div>',
        required: function () { return [
          { el: document.getElementById('dbt-who'), ok: !!((document.getElementById('dbt-who') || {}).value || '').trim() },
          { el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 },
        ]; },
        save: async function () {
          const who = ((document.getElementById('dbt-who') || {}).value || '').trim();
          const lend = (typeof chosen === 'function' ? chosen('dbt-dir') : 'lend') !== 'borrow';
          const amt = _amtOf('dbt-amt') * (lend ? 1 : -1);
          const note = ((document.getElementById('dbt-note') || {}).value || '').trim();
          const ok = await fhPersonalAddLoan(amt, who, note, undefined, null);
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã ghi vào sổ riêng');
          return function () { if (window.renderPersonal) renderPersonal(); };
        },
      });
    };

    window.fhDebtRepaySheet = function (idx) {
      const d = _last || fhPersonalDebts(); const p = d.people[idx]; if (!p) return;
      const owedMe = p.balance > 0;
      _fhModal({
        title: owedMe ? _e(p.who) + ' trả bạn' : 'Bạn trả ' + _e(p.who), saveLabel: 'Ghi lại', reqMsg: 'Điền số tiền nhé',
        body: _amtIn('dbt-amt', fmt(Math.abs(p.balance)))
          + '<div class="dbt-note">Còn ' + fmt(Math.abs(p.balance)) + (owedMe ? ' họ đang nợ bạn.' : ' bạn đang nợ.') + ' Trả nợ là chuyển khoản — không tính là chi tiêu hay thu nhập.</div>',
        required: function () { return [{ el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 }]; },
        save: async function () {
          const amt = _amtOf('dbt-amt') * (owedMe ? 1 : -1);
          const ok = await fhPersonalAddRepayment(amt, p.who, null, undefined, null);
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã ghi');
          return function () { const d2 = fhPersonalDebts(); const i2 = d2.people.findIndex((x) => x.who === p.who); if (i2 >= 0 && Math.abs(d2.people[i2].balance) > 0.5) openDebtPerson(i2); else closeDebt(); if (window.renderPersonal) renderPersonal(); };
        },
      });
    };

    window.fhCardPaySheet = function (acctId) {
      const P = _P(); const acct = P && P.accounts.find((a) => a.id === acctId); if (!acct) return;
      _fhModal({
        title: 'Thanh toán ' + _e(acct.name || 'thẻ'), saveLabel: 'Ghi lại', reqMsg: 'Điền số tiền nhé',
        body: _amtIn('dbt-amt')
          + '<div class="field"><label>Ngày</label><input type="date" id="dbt-date" value="' + new Date().toISOString().slice(0, 10) + '" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Khoản này trừ vào dư nợ thẻ — không tính là chi tiêu mới (đã tính lúc quẹt rồi).</div>'
          + '<div id="dbt-paycands"></div>',
        required: function () { return [{ el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 }]; },
        save: async function () {
          const ok = await fhPersonalAddTransfer(_amtOf('dbt-amt'), acctId, 'Thanh toán thẻ', (document.getElementById('dbt-date') || {}).value || undefined, null);
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã ghi thanh toán');
          return function () { openDebtAccount(acctId); if (window.renderPersonal) renderPersonal(); };
        },
        after: function () { _fillPayCands(acctId); },
      });
    };

    /* #3 — the card's own "assign an inbox payment to me" list. The bank mail
       that pays a card can't say WHICH card, so this is where the person says
       it: the same rows the review would call "Trả nợ thẻ", filtered here into
       this card's context. Tapping one records the transfer against THIS card
       and retires the staged row so it can't be imported twice. */
    let _payCands = [];
    const _baseAmt = (n) => window.csvBaseAmt ? csvBaseAmt(n) : Math.round(Number(n || 0) / (window.curMult ? curMult() : 1000));
    async function _fillPayCands(acctId) {
      const box = document.getElementById('dbt-paycands'); if (!box) return;
      if (!window.fhStagedCardPayments) return;
      box.innerHTML = '<div class="dbt-pc-h">Đang tìm khoản trả thẻ trong hộp thư…</div>';
      let cands = [];
      try { cands = await fhStagedCardPayments(); } catch (e) { cands = []; }
      if (!document.getElementById('dbt-paycands')) return;      // sheet closed while loading
      _payCands = cands;
      if (!cands.length) { box.innerHTML = ''; return; }
      let h = '<div class="dbt-pc-h">Từ hộp thư · đang chờ · chạm để gán vào thẻ này</div>';
      cands.forEach(function (c, i) {
        h += '<button type="button" class="dbt-pc" onclick="fhCardPayFromStaged(\'' + acctId + '\',' + i + ')">'
          + '<span class="dbt-pc-b"><span class="dbt-pc-n">' + _e(c.description) + '</span>'
          + '<span class="dbt-pc-s">' + _e(c.provider || 'Ngân hàng') + (c.tail ? ' ••' + c.tail : '') + ' · ' + _dmy((c.occurredAt || '').slice(0, 10)) + '</span></span>'
          + '<span class="dbt-pc-a num">' + fmt(_baseAmt(c.amount)) + '</span></button>';
      });
      box.innerHTML = h;
    }
    /* Tapping an inbox candidate no longer logs on the spot — it opens a confirm
       sheet (amount · date · which card, all editable) so a wrong amount or the
       wrong card is caught before it commits + retires the staged row (spec Q2). */
    window.fhCardPayFromStaged = function (acctId, i) {
      const c = _payCands[i]; if (!c) return;
      const P = _P(); const cards = ((P && P.accounts) || []).filter((a) => a.kind === 'credit_card');
      _fhModal({
        title: 'Xác nhận trả nợ thẻ', saveLabel: 'Ghi thanh toán', reqMsg: 'Kiểm tra số tiền nhé',
        body: '<div class="dbt-note">Từ hộp thư: ' + _e(c.description) + ' · ' + _e(c.provider || 'Ngân hàng') + (c.tail ? ' ••' + c.tail : '') + '</div>'
          + '<div class="field"><label>Số tiền</label><input class="num" id="dbt-amt" inputmode="numeric" value="' + Number(c.amount || 0).toLocaleString('vi-VN') + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Ngày</label><input type="date" id="dbt-date" value="' + ((c.occurredAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)) + '" oninput="fhModalDirty()"></div>'
          + (cards.length > 1 ? '<div class="field"><label>Trả cho thẻ nào</label><div class="choices" id="dbt-paycard">'
              + cards.map(function (a) { return '<button class="choice' + (a.id === acctId ? ' on' : '') + '" data-v="' + a.id + '" onclick="pick(\'dbt-paycard\',this)">' + _e(a.name || 'Thẻ') + '</button>'; }).join('') + '</div></div>' : '')
          + '<div class="dbt-note">Ghi xong sẽ trừ vào dư nợ thẻ và xoá khỏi hộp chờ.</div>',
        required: function () { return [{ el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 }]; },
        save: async function () {
          const target = (cards.length > 1 && typeof chosen === 'function' && chosen('dbt-paycard')) || acctId;
          const ok = await fhPersonalAddTransfer(_amtOf('dbt-amt'), target, c.description || 'Thanh toán thẻ', (document.getElementById('dbt-date') || {}).value || undefined, 'direct-email');
          if (!ok) throw new Error('save_failed');
          if (window.fhStagedRetireIds) { try { await fhStagedRetireIds([c.id]); } catch (e) {} }
          window.toast && toast('Đã gán vào thẻ & xoá khỏi hộp chờ');
          return function () { openDebtAccount(target); if (window.renderPersonal) renderPersonal(); };
        },
      });
    };

    window.fhAcctEditSheet = function (acctId) {
      const P = _P(); const acct = P && P.accounts.find((a) => a.id === acctId); if (!acct) return;
      const _dayIn = (id, val) => '<input type="number" min="1" max="31" id="' + id + '" inputmode="numeric" placeholder="—" value="' + (val || '') + '" oninput="fhModalDirty()">';
      /* The kind is EDITABLE — the classifier can mis-guess (a VN debit card
         prints a 16-digit PAN like a credit card), and the person is the one
         who knows what the instrument actually is. Card-only fields (hạn mức,
         ngày chốt/đến hạn) show only while "Thẻ tín dụng" is picked. */
      const KINDS = [['credit_card', '💳 Thẻ tín dụng'], ['deposit', '🏦 Tài khoản ngân hàng'], ['ewallet', '📱 Ví điện tử'], ['cash', '💵 Tiền mặt']];
      const kindChips = KINDS.map(([v, lbl]) =>
        '<button class="choice' + (acct.kind === v ? ' on' : '') + '" data-v="' + v + '" onclick="pick(\'dbt-akind\',this);fhAcctKindSync()">' + lbl + '</button>').join('');
      _fhModal({
        title: 'Cài đặt tài khoản', saveLabel: 'Lưu',
        body: '<div class="field"><label>Tên</label><input id="dbt-aname" value="' + _e(acct.name || '') + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Loại</label><div class="choices" id="dbt-akind">' + kindChips + '</div></div>'
          + '<div id="dbt-acardf"' + (acct.kind === 'credit_card' ? '' : ' hidden') + '>'
          + '<div class="field"><label>Hạn mức thẻ <span class="opt">· để trống nếu không nhớ</span></label><input class="num" id="dbt-alim" inputmode="numeric" value="' + (acct.limitK > 0 ? Math.round(acct.limitK * (window.curMult ? curMult() : 1000)).toLocaleString('vi-VN') : '') + '" oninput="fhModalDirty()"></div>'
          + '<div class="field-row"><div class="field"><label>Ngày chốt sao kê</label>' + _dayIn('dbt-astm', acct.statementDay) + '</div>'
          + '<div class="field"><label>Ngày đến hạn</label>' + _dayIn('dbt-adue', acct.dueDay) + '</div></div>'
          + '<div class="dbt-note">Ngày chốt và ngày đến hạn là ngày trong tháng (1–31), theo sao kê thẻ của bạn. Dùng để nhắc “đến hạn”.</div>'
          + '</div>',
        save: async function () {
          const name = ((document.getElementById('dbt-aname') || {}).value || '').trim();
          const kind = (typeof chosen === 'function' && chosen('dbt-akind')) || acct.kind;
          const isCard = kind === 'credit_card';
          const lim = isCard ? _amtOf('dbt-alim') : 0;
          const _day = (id) => { const v = parseInt((document.getElementById(id) || {}).value || '', 10); return (v >= 1 && v <= 31) ? v : null; };
          const ok = await fhPersonalAccountUpdate(acctId, { name: name || acct.name, kind: kind,
            limitK: lim > 0 ? lim : null,
            statementDay: isCard ? _day('dbt-astm') : null, dueDay: isCard ? _day('dbt-adue') : null,
            humanVerified: true });
          if (!ok) throw new Error('save_failed');
          // the detail overlay must match the (possibly new) kind
          return function () { if (isCard) openDebtAccount(acctId); else openBalAccount(acctId); if (window.renderPersonal) renderPersonal(); };
        },
      });
    };
    /* card-only fields follow the picked kind, live */
    window.fhAcctKindSync = function () {
      const k = typeof chosen === 'function' ? chosen('dbt-akind') : null;
      const f = document.getElementById('dbt-acardf');
      if (f) f.hidden = k !== 'credit_card';
    };

    /* Reconcile (spec Q3a): the derived balance is only as complete as the mail
       that got captured. The person types the real current debt from their bank
       app; we book the gap as a dated "Điều chỉnh dư nợ" transfer, so the number
       matches now AND future captured purchases add on top correctly. The
       derived-balance model stays honest — the gap is an explicit line, not a
       silent override. */
    window.fhCardReconcileSheet = function (acctId) {
      const P = _P(); const acct = P && P.accounts.find((a) => a.id === acctId); if (!acct) return;
      const d = _last || fhPersonalDebts();
      const b = (d.byAcct && d.byAcct[acctId]) || { spend: 0, paid: 0 };
      const cur = b.spend - b.paid;
      _fhModal({
        title: 'Cập nhật dư nợ thực tế', saveLabel: 'Cập nhật', reqMsg: 'Nhập dư nợ hiện tại nhé',
        body: '<div class="dbt-note">App đang tính dư nợ thẻ là <b>' + fmt(Math.max(0, cur)) + '</b> từ những khoản đã ghi. Nếu app đọc thiếu vài giao dịch, nhập dư nợ thật (xem trong app ngân hàng), app sẽ ghi một dòng điều chỉnh cho khớp.</div>'
          + '<div class="field"><label>Dư nợ thực tế</label><input class="num" id="dbt-amt" inputmode="numeric" placeholder="' + fmt(Math.max(0, cur)) + '" oninput="fhModalDirty()"></div>',
        required: function () { return [{ el: document.getElementById('dbt-amt'), ok: !!((document.getElementById('dbt-amt') || {}).value || '').trim() }]; },
        save: async function () {
          const actual = _amtOf('dbt-amt');
          const adj = cur - actual;   // >0 draws debt down (like a payment); <0 raises it (missed purchases)
          if (Math.abs(adj) < 0.5) { window.toast && toast('Đã khớp, không cần điều chỉnh'); return function () { openDebtAccount(acctId); }; }
          const ok = await fhPersonalAddTransfer(adj, acctId, 'Điều chỉnh dư nợ', undefined, null);
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã cập nhật dư nợ');
          return function () { openDebtAccount(acctId); if (window.renderPersonal) renderPersonal(); };
        },
      });
    };

    /* ═══ Full ledger (0109) — balances, anchors, drift, the transfer pair ═══ */

    /* ①b — a NON-card account: balance hero + drift + its history. */
    window.openBalAccount = function (acctId) {
      const P = _P(); if (!P) return;
      const acct = P.accounts.find((a) => a.id === acctId); if (!acct) return;
      const bal = window.fhPersonalBalance ? fhPersonalBalance(acctId) : null;
      const dr = window.fhPersonalDrift ? fhPersonalDrift(acctId) : null;
      const d = _last || fhPersonalDebts();
      const b = (d.byAcct && d.byAcct[acctId]) || { rows: [] };
      let h = '<div class="dbt-hero2"><div class="dbt-hk">Số dư</div>';
      if (bal != null) {
        h += '<div class="dbt-hv num' + (bal < 0 ? ' owe' : '') + '">' + (bal < 0 ? '−' : '') + fmt(Math.abs(bal)) + '</div>';
        if (acct.anchorAt) h += '<div class="dbt-hs">mốc đặt ' + _dmy(String(acct.anchorAt).slice(0, 10)) + ' — đã bao gồm mọi giao dịch trước lúc đặt</div>';
      } else {
        h += '<div class="dbt-hv num dim">—</div>'
          + '<div class="dbt-hs">Chưa có mốc số dư. Nhập số dư hiện tại (xem trong app ngân hàng) để bắt đầu theo dõi.</div>';
      }
      h += '<button class="dbt-relink" onclick="fhAnchorSheet(\'' + acctId + '\')">' + (bal != null ? 'Cập nhật số dư thực tế' : 'Đặt mốc số dư') + '</button>';
      h += '</div>';
      /* drift — a STATE, not an event (spec T9): the bank's own number vs the
         derived one, with exactly two ways out. */
      if (dr) {
        h += '<div class="dbt-drift">'
          + '<div class="dbt-drift-t">Ngân hàng báo ' + fmt(dr.extK) + (dr.extDate ? ' (' + _dmy(dr.extDate) + ')' : '') + ' — lệch ' + (dr.drift > 0 ? '+' : '−') + fmt(Math.abs(dr.drift)) + '</div>'
          + '<div class="dbt-drift-s">Có thể còn giao dịch chưa ghi, hoặc mốc cũ rồi.</div>'
          + '<div class="dbt-acts">'
          + '<button class="dbt-btn primary" onclick="fhDriftAnchor(\'' + acctId + '\')">Chốt theo ngân hàng</button>'
          + '<button class="dbt-btn tinted" onclick="fhDriftAdd(\'' + acctId + '\',' + (dr.drift < 0 ? 1 : 0) + ')">Thêm giao dịch thiếu</button>'
          + '</div></div>';
      }
      h += '<div class="dbt-acts">'
        + '<button class="dbt-btn primary" onclick="fhXferSheet(\'' + acctId + '\')">Chuyển giữa tài khoản</button>'
        + '<button class="dbt-btn tinted" onclick="fhAcctEditSheet(\'' + acctId + '\')">Cài đặt</button>'
        + '</div>';
      const all = (b.rows || []).slice().sort((a, x) => (x.date || '').localeCompare(a.date || ''));
      h += '<div class="dbt-sec">Giao dịch</div><div class="dbt-card">';
      if (!all.length) h += '<div class="dbt-note">Chưa có giao dịch nào gắn với tài khoản này. Chi tiêu và tiền vào từ email tự gắn khi bạn duyệt.</div>';
      all.slice(0, 120).forEach(function (r) {
        const xfer = r.kind === 'transfer', inc = r.kind === 'income';
        const signed = xfer ? (r.amt || 0) : (inc ? (r.amt || 0) : -(r.amt || 0));
        const isPair = xfer && r.transferGroupId;
        const tap = isPair ? ' onclick="fhXferPairSheet(\'' + r.transferGroupId + '\')"' : '';
        h += '<div class="dbt-li' + (isPair ? ' tap' : '') + '"' + tap + '><span class="dbt-lic">' + (xfer ? '🔁' : (inc ? '💰' : (r.emoji || '🗂️'))) + '</span>'
          + '<span class="dbt-lib"><span class="dbt-lin">' + _e(r.note || r.cat || (xfer ? 'Chuyển khoản' : (inc ? 'Thu nhập' : 'Khoản chi')))
          + (xfer ? '<i class="dbt-tag">chuyển khoản</i>' : '') + '</span>'
          + '<span class="dbt-lis">' + _dmy(r.date) + '</span></span>'
          + '<span class="dbt-liv num' + (signed > 0 ? ' owed' : '') + '">' + (signed > 0 ? '+' : '−') + fmt(Math.abs(signed)) + '</span></div>';
      });
      h += '</div>';
      h += '<div class="dbt-foot">Chuyển giữa tài khoản của mình là <b>chuyển khoản</b> — không tính là chi tiêu hay thu nhập, chỉ đổi chỗ tiền.</div>';
      _ovOpen(acct.name || 'Tài khoản', h);
    };

    /* The anchor sheet — "Số dư hiện tại", declared truth (spec §5.1). */
    window.fhAnchorSheet = function (acctId) {
      const P = _P(); const acct = P && P.accounts.find((a) => a.id === acctId); if (!acct) return;
      const dr = window.fhPersonalDrift ? fhPersonalDrift(acctId) : null;
      _fhModal({
        title: 'Số dư hiện tại — ' + _e(acct.name || 'tài khoản'), saveLabel: 'Đặt mốc', reqMsg: 'Nhập số dư nhé',
        body: '<div class="field"><label>Số dư hiện tại</label><input class="num" id="dbt-amt" inputmode="numeric" placeholder="' + (dr ? fmt(dr.extK) : '0 ₫') + '" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Nhập đúng số dư đang thấy trong app ngân hàng. Mốc này đã bao gồm mọi giao dịch trước lúc đặt — các khoản ghi sau đó cộng/trừ tiếp lên nó.</div>',
        required: function () { return [{ el: document.getElementById('dbt-amt'), ok: !!((document.getElementById('dbt-amt') || {}).value || '').trim() }]; },
        save: async function () {
          const ok = await fhPersonalAnchorSet(acctId, _amtOf('dbt-amt'));
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã đặt mốc số dư');
          return function () { openBalAccount(acctId); if (window.renderPersonal) renderPersonal(); };
        },
      });
    };
    /* Drift resolution ① — adopt the bank's number as the new anchor. */
    window.fhDriftAnchor = async function (acctId) {
      const P = _P(); const acct = P && P.accounts.find((a) => a.id === acctId);
      if (!acct || acct.extK == null) return;
      const ok = await fhPersonalAnchorSet(acctId, acct.extK);
      if (!ok) { window.toast && toast('Chưa cập nhật được, thử lại'); return; }
      window.toast && toast('Đã chốt theo số ngân hàng báo');
      openBalAccount(acctId); if (window.renderPersonal) renderPersonal();
    };
    /* Drift resolution ② — the gap is a real, unrecorded movement: open the
       right entry surface (bank lower than app = missing spending; higher =
       missing money in). */
    window.fhDriftAdd = function (acctId, missingSpend) {
      closeDebt();
      if (missingSpend) { if (window.openPersonalExpense) openPersonalExpense(); }
      else if (window.fhIncome) fhIncome('personal');
    };

    /* "Chuyển giữa tài khoản" — the manual transfer PAIR (spec §3.1). */
    window.fhXferSheet = function (presetFromId) {
      const P = _P(); if (!P || !P.key) { window.toast && toast('Mở khoá sổ cá nhân trước'); return; }
      const accts = (P.accounts || []).filter((a) => a.kind !== 'credit_card');
      const hasCash = accts.some((a) => a.kind === 'cash');
      /* every chip re-syncs the "new account" name fields — picking "+ Tài
         khoản mới" reveals the one for its side, picking anything else hides it */
      const chip = function (grp, a, on) {
        return '<button class="choice' + (on ? ' on' : '') + '" data-v="' + a.id + '" onclick="pick(\'' + grp + '\',this);fhXferNewSync()">' + _e(a.name || 'Tài khoản') + '</button>';
      };
      const extraChips = function (grp) {
        return (hasCash ? '' : '<button class="choice" data-v="_cash" onclick="pick(\'' + grp + '\',this);fhXferNewSync()">Tiền mặt</button>')
          /* a bank that sends no emails never auto-materializes — name it here */
          + '<button class="choice" data-v="_new" onclick="pick(\'' + grp + '\',this);fhXferNewSync()">＋ Tài khoản mới</button>';
      };
      const newField = function (side) {
        return '<div class="field" id="dbt-xnew-' + side + '-f" hidden><label>Tên tài khoản mới</label>'
          + '<input id="dbt-xnew-' + side + '" placeholder="vd. VCB tiết kiệm" oninput="fhModalDirty()"></div>';
      };
      // LOCAL YYYY-MM-DD — toISOString() is UTC and would default to yesterday
      // when opening after midnight in UTC+7 (same rule as 19-personal.js).
      const _n = new Date(), _today = _n.getFullYear() + '-' + String(_n.getMonth() + 1).padStart(2, '0') + '-' + String(_n.getDate()).padStart(2, '0');
      _fhModal({
        title: 'Chuyển giữa tài khoản', saveLabel: 'Ghi lại', reqMsg: 'Chọn hai tài khoản khác nhau và số tiền nhé',
        body: '<div class="field"><label>Từ đâu?</label><div class="choices" id="dbt-xfrom">'
          + accts.map((a) => chip('dbt-xfrom', a, a.id === presetFromId)).join('') + extraChips('dbt-xfrom') + '</div></div>'
          + newField('from')
          + '<div class="field"><label>Đến đâu?</label><div class="choices" id="dbt-xto">'
          + accts.map((a) => chip('dbt-xto', a, false)).join('') + extraChips('dbt-xto') + '</div></div>'
          + newField('to')
          + _amtIn('dbt-amt')
          + '<div class="field"><label>Ngày</label><input type="date" id="dbt-date" value="' + _today + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Ghi chú <span class="opt">· tuỳ chọn</span></label><input id="dbt-note" placeholder="vd. chuyển sang tài khoản tiết kiệm" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Ghi thành một cặp: tiền ra ở tài khoản này, tiền vào ở tài khoản kia — không tính là chi tiêu hay thu nhập.</div>',
        required: function () {
          const f = typeof chosen === 'function' ? chosen('dbt-xfrom') : null, t2 = typeof chosen === 'function' ? chosen('dbt-xto') : null;
          const nm = (side) => ((document.getElementById('dbt-xnew-' + side) || {}).value || '').trim();
          return [
            { el: document.getElementById('dbt-xto'), ok: !!(f && t2 && f !== t2) },
            { el: document.getElementById('dbt-xnew-from'), ok: f !== '_new' || !!nm('from') },
            { el: document.getElementById('dbt-xnew-to'), ok: t2 !== '_new' || !!nm('to') },
            { el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 },
          ];
        },
        save: async function () {
          let f = chosen('dbt-xfrom'), t2 = chosen('dbt-xto');
          const nm = (side) => ((document.getElementById('dbt-xnew-' + side) || {}).value || '').trim();
          if (f === '_cash') f = await fhPersonalCashAccount();
          if (t2 === '_cash') t2 = await fhPersonalCashAccount();
          if (f === '_new') f = await fhPersonalAccountCreate(nm('from'), 'deposit');
          if (t2 === '_new') t2 = await fhPersonalAccountCreate(nm('to'), 'deposit');
          if (!f || !t2 || f === t2) throw new Error('save_failed');
          const note = ((document.getElementById('dbt-note') || {}).value || '').trim();
          const ok = await fhPersonalAddTransferPair(_amtOf('dbt-amt'), f, t2, note || 'Chuyển giữa tài khoản', (document.getElementById('dbt-date') || {}).value || undefined, null);
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã ghi chuyển khoản — không tính thu chi');
          return function () { if (window.renderPersonal) renderPersonal(); };
        },
      });
    };
    /* show the "new account" name field only while its side has "+ Tài khoản
       mới" picked — called from every chip in both groups */
    window.fhXferNewSync = function () {
      const f = typeof chosen === 'function' ? chosen('dbt-xfrom') : null, t2 = typeof chosen === 'function' ? chosen('dbt-xto') : null;
      const ff = document.getElementById('dbt-xnew-from-f'), tf = document.getElementById('dbt-xnew-to-f');
      if (ff) ff.hidden = f !== '_new';
      if (tf) tf.hidden = t2 !== '_new';
    };

    /* A transfer pair, opened from either leg: edit amount/date/note (both legs
       stay in lockstep) or delete BOTH (spec T10 — a pair is atomic). */
    window.fhXferPairSheet = function (groupId) {
      const P = _P(); if (!P) return;
      const legs = (P.debts || []).filter((d) => d.transferGroupId === groupId);
      if (!legs.length) return;
      const out = legs.find((l) => (l.amt || 0) < 0), inn = legs.find((l) => (l.amt || 0) > 0);
      const nameOf = (l) => { const a = l && P.accounts.find((x) => x.id === l.accountId); return a ? (a.name || 'Tài khoản') : '?'; };
      const amt = Math.abs((legs[0].amt) || 0);
      _fhModal({
        title: 'Chuyển khoản — ' + _e(nameOf(out)) + ' → ' + _e(nameOf(inn)), saveLabel: 'Lưu',
        body: '<div class="field"><label>Số tiền</label><input class="num" id="dbt-amt" inputmode="numeric" value="' + Math.round(amt * (window.curMult ? curMult() : 1000)).toLocaleString('vi-VN') + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Ngày</label><input type="date" id="dbt-date" value="' + (legs[0].date || '') + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Ghi chú</label><input id="dbt-note" value="' + _e(legs[0].note || '') + '" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Sửa là sửa cả hai đầu — hai vế của một lần chuyển không bao giờ lệch nhau.</div>'
          + '<button class="dbt-btn danger" onclick="fhXferPairDelete(\'' + groupId + '\',this)">Xoá cặp chuyển khoản này</button>',
        required: function () { return [{ el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 }]; },
        save: async function () {
          const ok = await fhPersonalUpdateTransferPair(groupId, {
            amtK: _amtOf('dbt-amt'),
            note: ((document.getElementById('dbt-note') || {}).value || '').trim() || null,
            dateIso: (document.getElementById('dbt-date') || {}).value || null,
          });
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã cập nhật cả hai đầu');
          return function () { if (window.renderPersonal) renderPersonal(); closeDebt(); };
        },
      });
    };
    let _pairArm = null;
    window.fhXferPairDelete = async function (groupId, btn) {
      if (_pairArm !== groupId) {
        _pairArm = groupId;
        if (btn) btn.textContent = 'Bấm lần nữa để xoá cả hai đầu';
        setTimeout(() => { if (_pairArm === groupId) { _pairArm = null; if (btn && btn.isConnected) btn.textContent = 'Xoá cặp chuyển khoản này'; } }, 4000);
        return;
      }
      _pairArm = null;
      const ok = await fhPersonalDeleteTransferPair(groupId);
      if (!ok) { window.toast && toast('Chưa xoá được, thử lại'); return; }
      window.toast && toast('Đã xoá cả hai đầu');
      if (window.closeModals) closeModals();
      closeDebt(); if (window.renderPersonal) renderPersonal();
    };

    /* space create → card intro → invite */
    window.fhSpaceCreateSheet = function () {
      _fhModal({
        title: 'Nhóm chia tiền', saveLabel: 'Tạo nhóm', reqMsg: 'Đặt tên nhóm nhé',
        body: '<div class="field"><label>Tên nhóm</label><input id="dbt-spname" placeholder="vd. Đà Lạt 10/2026" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Nhóm có sổ chia tiền riêng, mã hoá bằng thẻ nhóm — ai có thẻ mới đọc được. Gia đình bạn không thấy nhóm này.</div>',
        required: function () { return [{ el: document.getElementById('dbt-spname'), ok: !!((document.getElementById('dbt-spname') || {}).value || '').trim() }]; },
        save: async function () {
          const name = ((document.getElementById('dbt-spname') || {}).value || '').trim();
          const r = await fhSpaceCreate(name, 'friend');
          if (!r.ok) throw new Error(r.error || 'create_failed');
          const fid = r.fid, disp = r.card.display;
          return function () {
            _fhModal({ title: 'Thẻ nhóm — giữ kỹ', saveLabel: 'Đã lưu thẻ, tiếp tục',
              body: '<div class="dbt-cardshow num">' + _e(disp) + '</div>'
                + '<div class="dbt-note">Đây là chìa khoá của sổ nhóm. Gửi cho từng người bạn mời (Zalo/tin nhắn) — không có thẻ thì không đọc được. Thẻ cũng được lưu trên máy này.</div>',
              save: async function () { return function () { fhSpaceInviteSheet(fid); }; } });
          };
        },
      });
    };

    window.fhSpaceInviteSheet = function (fid) {
      _fhModal({
        title: 'Mời vào nhóm', saveLabel: 'Mời', reqMsg: 'Điền email nhé',
        body: '<div class="field"><label>Email Google của bạn ấy</label><input id="dbt-inv" inputmode="email" placeholder="ban@gmail.com" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Bạn ấy đăng nhập FamilyHub bằng email này, vào Tài Chính → nhóm sẽ hiện lời mời. Nhớ gửi kèm thẻ nhóm.</div>',
        required: function () { return [{ el: document.getElementById('dbt-inv'), ok: /@.+\./.test(((document.getElementById('dbt-inv') || {}).value || '')) }]; },
        save: async function () {
          const r = await fhSpaceInvite(fid, ((document.getElementById('dbt-inv') || {}).value || '').trim());
          if (!r.ok) { const e = new Error(r.error || 'invite_failed'); if (/already_member/.test(r.error || '')) e.fhMsg = 'Bạn ấy đã ở trong nhóm rồi'; throw e; }
          window.toast && toast('Đã mời — nhớ gửi thẻ nhóm cho bạn ấy');
          return function () { openDebtSpace(fid); };
        },
      });
    };

    /* split expense */
    window.fhSpaceSplitSheet = function (fid) {
      const S = _S(); const d = S.data[fid]; if (!d) return;
      const cats = d.cats || [], mems = d.members || [];
      const my = fhSpaceMyMemberId(fid);
      let body = '<div class="field"><label>Chi cho gì?</label><input id="dbt-snote" placeholder="vd. Ăn tối BBQ" oninput="fhModalDirty()"></div>'
        + _amtIn('dbt-amt')
        + '<div class="field"><label>Nhóm chi</label><div class="choices" id="dbt-scat">'
        + cats.map((c, i) => '<button class="choice' + (i === 0 ? ' on' : '') + '" data-v="' + c.id + '" onclick="pick(\'dbt-scat\',this)">' + (c.emoji || '🏷️') + ' ' + _e(c.name) + '</button>').join('') + '</div></div>'
        + '<div class="field"><label>Ai trả?</label><div class="choices" id="dbt-spayer">'
        + mems.map((m) => '<button class="choice' + (m.id === my ? ' on' : '') + '" data-v="' + m.id + '" onclick="pick(\'dbt-spayer\',this)">' + _e(m.name) + '</button>').join('') + '</div></div>'
        + '<div class="field"><label>Chia sao?</label><div class="choices" id="dbt-srule">'
        + '<button class="choice on" data-v="equal" onclick="pick(\'dbt-srule\',this);fhSplitRule()">Chia đều</button>'
        + '<button class="choice" data-v="exact" onclick="pick(\'dbt-srule\',this);fhSplitRule()">Tự nhập</button></div></div>'
        + '<div id="dbt-sexact" style="display:none">'
        + mems.map((m) => '<div class="field-row dbt-exrow"><span class="dbt-exn">' + _e(m.name) + '</span><input class="num" id="dbt-ex-' + m.id + '" inputmode="numeric" placeholder="0 ₫" oninput="fhModalDirty()"></div>').join('')
        + '</div>';
      _fhModal({
        title: 'Chia khoản mới', saveLabel: 'Ghi &amp; chia'.replace('&amp;', '&'), reqMsg: 'Điền nội dung và số tiền nhé',
        body: body,
        required: function () { return [
          { el: document.getElementById('dbt-snote'), ok: !!((document.getElementById('dbt-snote') || {}).value || '').trim() },
          { el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 },
        ]; },
        save: async function () {
          const amt = _amtOf('dbt-amt');
          const rule = (typeof chosen === 'function' && chosen('dbt-srule')) || 'equal';
          const shares = {};
          if (rule === 'exact') {
            let sum = 0;
            mems.forEach((m) => { const v = _amtOf('dbt-ex-' + m.id); if (v > 0) { shares[m.id] = v; sum += v; } });
            if (Math.abs(sum - amt) > 1) { const e = new Error('shares_mismatch'); e.fhMsg = 'Các phần chia phải cộng đúng bằng tổng (' + fmt(amt) + ')'; throw e; }
          } else {
            const per = amt / mems.length;
            let acc = 0;
            mems.forEach((m, i) => { const v = (i === mems.length - 1) ? (amt - acc) : Math.round(per * 10) / 10; shares[m.id] = v; acc += v; });
          }
          const r = await fhSpaceAddExpense(fid, {
            amtK: amt, note: ((document.getElementById('dbt-snote') || {}).value || '').trim(),
            catId: (typeof chosen === 'function' && chosen('dbt-scat')) || (cats[0] && cats[0].id),
            payerMemberId: (typeof chosen === 'function' && chosen('dbt-spayer')) || my,
            rule: rule, shares: shares,
          });
          if (!r.ok) throw new Error(r.error || 'save_failed');
          window.toast && toast('Đã chia cho ' + mems.length + ' người');
          return function () { openDebtSpace(fid); _redraw(); };
        },
      });
    };
    window.fhSplitRule = function () {
      const ex = document.getElementById('dbt-sexact');
      if (ex) ex.style.display = (typeof chosen === 'function' && chosen('dbt-srule')) === 'exact' ? '' : 'none';
    };

    /* settle-up: directed member→member transfer (Q8b) */
    window.fhSpaceSettleSheet = function (fid) {
      const S = _S(); const d = S.data[fid]; if (!d) return;
      const mems = d.members || [], my = fhSpaceMyMemberId(fid);
      const pairs = fhSpacePairwise(fid) || [];
      const mine = pairs.find((p) => p.from.id === my) || pairs[0] || null;
      _fhModal({
        title: 'Ghi trả nợ', saveLabel: 'Ghi lại', reqMsg: 'Chọn người và số tiền nhé',
        body: '<div class="field"><label>Ai trả?</label><div class="choices" id="dbt-sufrom">'
          + mems.map((m) => '<button class="choice' + ((mine ? mine.from.id : my) === m.id ? ' on' : '') + '" data-v="' + m.id + '" onclick="pick(\'dbt-sufrom\',this)">' + _e(m.name) + '</button>').join('') + '</div></div>'
          + '<div class="field"><label>Trả cho ai?</label><div class="choices" id="dbt-suto">'
          + mems.map((m) => '<button class="choice' + (mine && mine.to.id === m.id ? ' on' : '') + '" data-v="' + m.id + '" onclick="pick(\'dbt-suto\',this)">' + _e(m.name) + '</button>').join('') + '</div></div>'
          + _amtIn('dbt-amt', mine ? fmt(mine.amt) : '0 ₫')
          + '<div class="dbt-note">Ai trong nhóm cũng ghi được — số dư của cả hai bên cập nhật ngay.</div>',
        required: function () {
          const f = typeof chosen === 'function' ? chosen('dbt-sufrom') : null, t = typeof chosen === 'function' ? chosen('dbt-suto') : null;
          return [
            { el: document.getElementById('dbt-suto'), ok: !!(f && t && f !== t) },
            { el: document.getElementById('dbt-amt'), ok: _amtOf('dbt-amt') > 0 },
          ];
        },
        save: async function () {
          const r = await fhSpaceSettle(fid, {
            fromMember: chosen('dbt-sufrom'), toMember: chosen('dbt-suto'), amtK: _amtOf('dbt-amt'),
          });
          if (!r.ok) throw new Error(r.error || 'save_failed');
          window.toast && toast('Đã ghi trả nợ');
          return function () { openDebtSpace(fid); _redraw(); };
        },
      });
    };
  })();
