  // ═══ bank-email: automatic transaction logging (direct read) ══════════════
  /* Settings → "Tự động ghi giao dịch", the first row in the sheet and the only
     one wearing a "New" badge. One entry point, one screen, one CTA: this is the
     offer, and the next thing the member sees is Google's own consent screen.

     WHY IT IS SEPARATE FROM fhMailboxSheet (71-mailbox-ui.js): that journey is
     the FORWARDING transport — issue an alias, paste it into Gmail's filters,
     wait for confirmation. This one is direct read: the member grants access
     once and we fetch from their mailbox ourselves. Same feature, same beta
     list (73-mailbox-gate.js gates all three rows on one can_use_mailbox call),
     different transport and a completely different thing to explain. Folding
     them into one sheet would mean a screen that has to ask "which way?" before
     it can say anything useful.

     ON THE COPY, AND WHY IT DOES NOT PROMISE MORE THAN IT CAN: the reassurance
     rows below are all things we control and can hold to. The note underneath
     them is not: Google publishes exactly one mail-reading scope
     (gmail.readonly) and it covers the entire mailbox. "Only bank email is
     read" is OUR promise about what we fetch and store, enforced in our
     pipeline, and it is not a boundary the member can see on Google's screen.
     Saying so plainly costs one sentence. Implying a narrower grant than Google
     actually shows them costs their trust the moment the consent screen loads,
     which is about four seconds later. Reviewed against
     pipeline/OAUTH-COMPLIANCE-FINDINGS.md §3.3 — do not soften it.

     THE ENCRYPTION LINE IS WORDED TO THE CEILING IN SEALED-STAGING-DESIGN §1,
     not past it. "No developer can read them" is the overclaim that section
     names: an operator who swaps a key is DETECTED, not prevented (§6), and the
     whole thing rests on the client JS we serve, which web-delivered E2EE
     structurally cannot escape. What is true, and what this says: rows are
     sealed in storage and only the family's own devices can open them. The
     forwarding intro was corrected to the same ceiling on 2026-08-16 — keep the
     two screens saying the same true thing. */

  /* Two glyphs this screen needs that the forwarding journey doesn't; everything
     else falls through to the shared mailbox set, so the whole feature keeps one
     stroke weight and one visual voice (DESIGN §2.6). */
  const _ATX_SVG = {
    auto:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 11.2V7.4a2.6 2.6 0 0 0-2.6-2.6H5.8a2.6 2.6 0 0 0-2.6 2.6v9a2.6 2.6 0 0 0 2.6 2.6h6.4"/><path d="m4.3 7.6 7.7 5.2 7.7-5.2"/><path d="m18.4 13.4-2.1 3.9h3.4l-2.1 3.9"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.6a8.6 8.6 0 0 1 2.1-.26c4.6 0 8 4.2 9.2 6.06a1.2 1.2 0 0 1 0 1.2 17 17 0 0 1-2.5 3.1"/><path d="M15.5 16.9a8.7 8.7 0 0 1-3.5.75c-4.6 0-8-4.2-9.2-6.06a1.2 1.2 0 0 1 0-1.2A17.4 17.4 0 0 1 6 6.6"/><path d="M10.3 10.3a2.4 2.4 0 0 0 3.4 3.4"/><path d="m4.6 4.6 14.8 14.8"/></svg>',
  };
  const _atxGlyph = (k) => _ATX_SVG[k] || _mbxGlyph(k);

  /* WHICH ACCOUNT WE READ FROM — the one question this flow has to ask, and the
     reason it is a row on the offer screen rather than a step of its own.

     Two states:
       login  → read from the address they signed in with. The default, because
                it is right for almost everyone and costs them zero taps.
       other  → a field for the address their bank actually writes to.

     WHAT THE FIELD IS, AND WHAT IT IS NOT. It is a `login_hint`, not a grant.
     It tells Google which account to open on, which is a real favour to anyone
     holding three Gmail addresses — without it they land on whichever account
     Google felt like and can quietly authorise the wrong mailbox. What it
     cannot do is give us access: only the account that signs in and consents on
     Google's screen does that. So this is a hint that saves taps and prevents a
     wrong-mailbox mistake, and the helper line under it says exactly that
     rather than implying we have taken the answer here.

     Blank is legitimate and means "no hint" — Google shows its account picker.
     That is also what someone who does not know the address should do, so the
     field never blocks on being empty.

     Consequence worth knowing: this path is Google accounts only. Typing a
     non-Google address will simply fail on Google's screen, which is why the
     validation below stays a shape check and never promises the address works.
     Someone whose bank writes somewhere else needs forwarding, and routing them
     there is a product decision, not a UI one. */
  let _atxUseLogin = true;

  const _atxLoginEmail = () => (window.FAM && window.FAM.user && window.FAM.user.email) || '';

  /* Read straight off the field so the value survives a re-render and never
     needs mirroring into module state on every keystroke. */
  const _atxTypedEmail = () => {
    const el = document.getElementById('atx-email');
    return el ? el.value.trim() : '';
  };

  function _atxAcctRow() {
    const email = _atxLoginEmail();
    // No login email at all (shouldn't happen — sign-in is Google) — don't offer
    // a switch away from something we cannot name; Google will ask.
    if (!email) _atxUseLogin = false;
    if (_atxUseLogin && email) {
      return '<div class="atx-acct" id="atx-acct">' +
        '<div class="atx-acct-ic">' + _mbxGlyph('mail') + '</div>' +
        '<div class="atx-acct-txt">' +
          '<div class="atx-acct-lbl">' + _esc(L('Đọc thư từ', 'Reading from')) + '</div>' +
          '<div class="atx-acct-val">' + _esc(email) + '</div>' +
        '</div>' +
        '<button class="atx-acct-sw" onclick="fhAutoTxnSwitchAcct()">' + _esc(L('Đổi', 'Change')) + '</button>' +
        '</div>';
    }
    return '<div class="atx-acct is-edit" id="atx-acct">' +
      '<div class="atx-acct-lbl">' + _esc(L('Email nhận thông báo ngân hàng', 'Email your bank writes to')) + '</div>' +
      '<input id="atx-email" class="atx-acct-in" type="email" inputmode="email" autocapitalize="none" ' +
        'spellcheck="false" autocomplete="email" placeholder="' + _escAttr(L('vd. tenban@gmail.com', 'e.g. you@gmail.com')) + '">' +
      '<div class="atx-acct-hint">' + _esc(L(
        'Tụi mình sẽ mở màn hình Google với email này. Bạn đăng nhập và cho phép ở đó. Để trống cũng được, Google sẽ hỏi bạn chọn tài khoản.',
        'We’ll open Google on this address. You sign in and approve there. Leaving it blank is fine too, Google will ask you to pick.')) + '</div>' +
      (_atxLoginEmail()
        ? '<button class="atx-acct-sw" onclick="fhAutoTxnSwitchAcct()">' +
            _esc(L('Dùng email đăng nhập', 'Use my sign-in email')) + '</button>'
        : '') +
      '</div>';
  }

  /* Re-renders the row in place rather than the whole sheet: the person is
     mid-decision and the screen must not jump under them. Focuses the field on
     the way in, so "Đổi" lands them on a keyboard rather than a second tap. */
  window.fhAutoTxnSwitchAcct = function () {
    _atxUseLogin = !_atxUseLogin;
    const row = document.getElementById('atx-acct');
    if (!row) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = _atxAcctRow();
    const next = wrap.firstChild;
    row.replaceWith(next);
    if (!_atxUseLogin) {
      const el = document.getElementById('atx-email');
      if (el) try { el.focus(); } catch (e) {}
    }
  };

  /* The single entry point. Deliberately does NOT branch on connection state
     yet: main has no read side for oauth connections (get_my_mailbox_connections
     lands with the backend, on branch bank-email-oauth), so there is nothing
     truthful to render for "already connected". When that RPC arrives, the
     status branch goes HERE, ahead of the intro, the way fhMailboxSheet does it. */
  window.fhAutoTxnSheet = function () {
    _atxUseLogin = true;                       // fresh decision each time it opens
    _fhSheet(
      '<div class="mbx-hero">' + _atxGlyph('auto') + '</div>' +
      '<div class="sheet-h">' + _esc(L('Tự động ghi giao dịch', 'Automatic transaction logging')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Cho phép Earthy đọc email để tìm biên lai và thông báo giao dịch từ ngân hàng, rồi điền sẵn vào sổ chi tiêu cho bạn. Không phải gõ tay nữa.',
        'Let Earthy read your email to find receipts and bank transaction alerts, then fill your ledger in for you. No more typing them in by hand.')) + '</div>' +

      '<div class="mbx-assure">' +
        _atxAssure('eyeoff', L('Chỉ biên lai và giao dịch', 'Only receipts and transactions'),
          L('Tụi mình chỉ tìm email từ ngân hàng và cửa hàng. Những thư khác không bao giờ được tải về.',
            'We only look for mail from banks and merchants. Everything else is never downloaded.')) +
        _atxAssure('lock', L('Chỉ gia đình bạn mở được', 'Only your family can open it'),
          L('Giao dịch được niêm phong ngay khi lưu, chỉ thiết bị của gia đình bạn mở được.',
            'Transactions are sealed the moment they are stored, and only your family’s devices can open them.')) +
        _atxAssure('check', L('Bạn duyệt rồi mới vào sổ', 'You approve before anything is logged'),
          L('Mỗi khoản đều nằm chờ bạn xem qua. Không có gì tự vào sổ chi tiêu của gia đình.',
            'Every transaction waits for you to look it over. Nothing enters your family ledger on its own.')) +
      '</div>' +

      '<div class="mbx-note">' + _mbxGlyph('mail') + '<span>' + _esc(L(
        'Màn hình của Google sẽ xin quyền đọc thư. Google chỉ có đúng một quyền như vậy và nó bao trùm cả hộp thư, không có quyền nào hẹp hơn. Tụi mình chỉ tải email ngân hàng, và bạn gỡ quyền trong tài khoản Google bất cứ lúc nào.',
        'Google’s screen asks for permission to read your mail. Google offers exactly one such permission and it covers the whole mailbox, there is no narrower one. We only ever fetch bank email, and you can revoke access in your Google account at any time.')) + '</span></div>' +

      _atxAcctRow() +

      '<button class="cta" id="atx-go" onclick="fhAutoTxnGrant()">' +
        _esc(L('Bắt đầu: cho phép đọc email', 'Start by granting email access')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  };

  function _atxAssure(icon, title, sub) {
    return '<div class="mbx-assure-row">' +
      '<div class="mbx-ic">' + _atxGlyph(icon) + '</div>' +
      '<div class="mbx-txt"><div class="mbx-rt">' + _esc(title) + '</div>' +
      '<div class="mbx-rs">' + _esc(sub) + '</div></div></div>';
  }

  /* ── the handoff ───────────────────────────────────────────────────────────
     This is the seam with the backend. We get the person to Google's consent
     screen; from the callback on, it is the BE dev's.

     /api/gmail-connect grants nothing by itself: it checks the caller owns the
     member row and returns a consent URL whose state is signed, so the callback
     can trust who started the flow. The member id is required — without it the
     callback has no ledger to attach the mailbox to, and guessing would attach
     it to the wrong person.

     WHAT WE SEND, and why it is shaped for their existing handler:
       memberId       — required, checked against the caller's user_id there.
       email          — the login_hint. The login address when they kept it, the
                        address they typed when they switched, or EMPTY when they
                        switched and left it blank. Empty means "no hint": their
                        handler already does `login_hint: body.email || ''`, and
                        Google with no hint shows its account picker. So all three
                        cases work against the endpoint as already written, with no
                        change needed on their side.
                        IT IS A HINT, NOT A CLAIM. The mailbox we end up connected
                        to is whichever account consents on Google's screen, which
                        may not be the one typed here. The callback learns the real
                        address from Google, and that is the one to store — never
                        this field.
       chooseAccount  — optional, additive. If they add `select_account` to the
                        prompt when this is true, the picker appears even for
                        someone with a single signed-in account. Ignoring it costs
                        nothing, which is why it is a second field and not a
                        different meaning for the first.

     Full navigation rather than a popup, deliberately: iOS Safari blocks a
     window.open issued after an await, and the consent flow has to land back on
     a real page regardless.

     404 is a live, expected state right now — the endpoint ships with the OAuth
     backend (branch bank-email-oauth) — so it gets an honest line rather than
     "try again", which would send people tapping at something that cannot work
     yet. */
  window.fhAutoTxnGrant = async function () {
    const btn = document.getElementById('atx-go');
    const label = L('Bắt đầu: cho phép đọc email', 'Start by granting email access');
    const reset = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };

    const mid = window.DB && window.DB.ownerMemberId;
    if (!mid) {
      window.toast && window.toast(L('Chưa xác định được thành viên, thử lại nhé', 'Could not identify your member — try again'));
      return;
    }

    /* A shape check on the typed hint, and nothing more. Blank is allowed on
       purpose (it means "let Google ask"), so this only fires on something that
       cannot be an address at all — a half-finished paste, a stray name. It
       never claims the address is reachable or is a Google account; only
       Google's screen can answer that. */
    const typed = _atxUseLogin ? '' : _atxTypedEmail();
    if (typed && !/.+@.+\..+/.test(typed)) {
      window.toast && window.toast(L('Địa chỉ email chưa đúng, bạn xem lại nhé', 'That email doesn’t look right — give it another look'));
      const el = document.getElementById('atx-email');
      if (el) try { el.focus(); } catch (e) {}
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = L('Đang mở Google…', 'Opening Google…'); }

    let tok = '';
    try { tok = ((await sb.auth.getSession()).data.session || {}).access_token || ''; } catch (e) { /* surfaces as the 401 below */ }

    try {
      const r = await fetch('/api/gmail-connect', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
        body: JSON.stringify({
          memberId: mid,
          email: _atxUseLogin ? _atxLoginEmail() : typed,
          chooseAccount: !_atxUseLogin && !typed,
        }),
      });
      if (r.status === 404) {
        window.toast && window.toast(L('Tính năng này đang được bật, ghé lại sau nhé', 'We’re still switching this on. Check back soon.'));
        reset();
        return;
      }
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || 'no url');
      window.location.href = data.url;
    } catch (e) {
      window.toast && window.toast(L('Chưa mở được Google, thử lại nhé', 'Could not open Google — try again'));
      reset();
    }
  };

  /* ── coming back ───────────────────────────────────────────────────────────
     Google sends the person to the BE callback, which finishes the exchange and
     redirects here. Without this the journey ends on a silent app boot that
     looks identical to a cold start, and nobody can tell whether it worked.

     THE RETURN CONTRACT, proposed here so the BE dev has something concrete to
     redirect to (documented in AGENT_SYNC): land on the app origin with
       ?fh_gmail=connected            — grant stored, sync will start
       ?fh_gmail=denied               — the person declined on Google's screen
       ?fh_gmail=error                — anything else went wrong
     `?gmail=` is accepted as an alias. An unrecognised value is ignored rather
     than guessed at, so a different choice on their side degrades to today's
     silence instead of a wrong screen.

     The param is eaten on arrival (67-card-ui.js does the same for key
     fragments): a reload should not replay a one-time outcome, and the value
     should not sit in the address bar or a share sheet. */
  function _atxReturnState() {
    try {
      const q = new URLSearchParams(location.search);
      const v = (q.get('fh_gmail') || q.get('gmail') || '').toLowerCase();
      if (v !== 'connected' && v !== 'denied' && v !== 'error') return null;
      q.delete('fh_gmail'); q.delete('gmail');
      const qs = q.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
      return v;
    } catch (e) { return null; }
  }

  function fhAutoTxnDone(state) {
    if (state === 'connected') {
      return _fhSheet(
        '<div class="mbx-hero">' + _mbxGlyph('done') + '</div>' +
        '<div class="sheet-h">' + _esc(L('Đã kết nối', 'Connected')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L(
          'Tụi mình bắt đầu tìm email giao dịch. Khoản nào tìm được sẽ nằm chờ bạn trong mục Duyệt giao dịch, không tự vào sổ.',
          'We’ve started looking for transaction email. Anything we find waits for you in Review transactions, and never enters the ledger on its own.')) + '</div>' +
        '<div class="mbx-note">' + _mbxGlyph('check') + '<span>' + _esc(L(
          'Lần đầu có thể mất một lúc. Bạn cứ dùng app bình thường, có gì tụi mình báo.',
          'The first pass can take a while. Carry on as normal, we’ll let you know.')) + '</span></div>' +
        (window.fhTxnReviewSheet
          ? '<button class="cta" onclick="fhTxnReviewSheet()">' + _esc(L('Xem mục duyệt', 'Open Review transactions')) + '</button>'
          : '') +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
      );
    }
    // Declining is a normal answer, not an error — no alarm colour, no blame,
    // and the way back is one tap rather than a hunt through Settings.
    const denied = state === 'denied';
    _fhSheet(
      '<div class="sheet-h">' + _esc(denied ? L('Chưa cấp quyền', 'Not granted')
                                            : L('Chưa kết nối được', 'Couldn’t connect')) + '</div>' +
      '<div class="sheet-sub">' + _esc(denied
        ? L('Không sao cả. Bạn vẫn nhập tay như thường, và có thể bật lại bất cứ lúc nào.',
            'That’s fine. You can keep adding transactions by hand, and turn this on whenever you like.')
        : L('Có gì đó trục trặc giữa chừng. Thử lại giúp tụi mình nhé.',
            'Something went wrong partway through. Give it another go.')) + '</div>' +
      '<button class="cta" onclick="fhAutoTxnSheet()">' + _esc(L('Thử lại', 'Try again')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  }
  window.fhAutoTxnDone = fhAutoTxnDone;

  /* Waits for hydrate the way 73-mailbox-gate.js does, and for the same reason:
     this file owns its own timing and touches no other module's boot path, so
     getting it wrong cannot break onboarding. The sheet needs a hydrated app
     behind it — opening it over a loading screen would be worse than waiting. */
  (function _atxBootReturn() {
    const state = _atxReturnState();          // read + eat immediately, before any await
    if (!state) return;
    const t0 = Date.now();
    (function _wait() {
      if (window.DB && window.DB._hydrated && window.fhUser) {
        try { fhAutoTxnDone(state); } catch (e) {}
        return;
      }
      if (Date.now() - t0 > 20000) return;
      setTimeout(_wait, 400);
    })();
  })();
  