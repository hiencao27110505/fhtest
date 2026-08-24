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
  /* Registered on the shared set rather than kept in a private lookup: _mbxAssure
     builds the rows for BOTH bank-email screens and resolves its glyph through
     _mbxGlyph, so a second lookup would have meant a second row builder. One
     glyph vocabulary, one row builder, one visual voice. */
  Object.assign(_MBX_SVG, _ATX_SVG);
  const _atxGlyph = (k) => _mbxGlyph(k);

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
  let _atxTyped = '';                       // survives the hop back to the offer sheet

  const _atxLoginEmail = () => (window.FAM && window.FAM.user && window.FAM.user.email) || '';

  /* Read straight off the field so the value survives a re-render and never
     needs mirroring into module state on every keystroke. */
  /* Reads the live field when it is mounted and remembers it, so the value
     survives the hop back to the offer sheet and the row can show it there. */
  const _atxTypedEmail = () => {
    const el = document.getElementById('atx-email');
    if (el) { _atxTyped = el.value.trim(); }
    return _atxTyped;
  };

  /* Always names the SIGN-IN address, because that is what this screen's CTA
     will use — fhAutoTxnGrant reads _atxLoginEmail and nothing else. Showing a
     previously typed address here would promise an account the button beside it
     ignores. Typing one is a different journey, and it carries its own CTA. */
  function _atxAcctRow() {
    const email = _atxLoginEmail();
    return '<div class="atx-acct" id="atx-acct">' +
      '<div class="atx-acct-ic">' + _mbxGlyph('mail') + '</div>' +
      '<div class="atx-acct-txt">' +
        '<div class="atx-acct-lbl">' + _esc(L('Đọc thư từ', 'Reading from')) + '</div>' +
        '<div class="atx-acct-val">' + _esc(email ||
          L('Tài khoản bạn chọn ở màn hình Google', 'The account you pick on Google’s screen')) + '</div>' +
      '</div>' +
      '<button class="atx-acct-sw" onclick="fhAutoTxnEmailSheet()">' + _esc(L('Đổi', 'Change')) + '</button>' +
      '</div>';
  }

  /* ── the address step ──────────────────────────────────────────────────────
     A FORM MODAL, not a bottom sheet, and that is the whole point.

     This started as an input spliced into the offer screen. It worked on a
     desktop viewport and broke on a real phone: the offer is long by necessity
     (three assurances plus the scope note Google's breadth obliges us to print),
     so the field landed near the bottom, and focusing it raised a keyboard over
     the CTA the person was aiming for.

     Shortening it to its own bottom sheet does NOT fix that, which is worth
     writing down because it looks like it should. `.sheet` is anchored to the
     bottom of the viewport, so a SHORT sheet occupies exactly the strip the
     keyboard claims — the shorter it gets, the more completely it is covered.

     `.modal` is anchored to the TOP (`top: max(env(safe-area-inset-top),12px)`)
     with a scrolling body, so the field and the Save action sit high on screen
     and a keyboard opens harmlessly beneath them. It is also simply the house
     pattern: index.html calls #fh-modal the surface for "multi-field forms",
     and this is a form. _fhModal brings the Cancel/Title/Save bar, the in-flight
     progress state, and error handling that keeps the form open, for free. */
  window.fhAutoTxnEmailSheet = function () {
    _fhModal({
      title: L('Đọc thư từ email nào?', 'Which email should we read?'),
      saveLabel: L('Tiếp tục', 'Continue'),
      body:
        '<div class="sheet-sub">' + _esc(L(
          'Điền email mà ngân hàng gửi thông báo tới. Tụi mình sẽ mở màn hình Google sẵn với email này, bạn chỉ cần đăng nhập và cho phép.',
          'Enter the address your bank writes to. We’ll open Google already set to it, so you just sign in and approve.')) + '</div>' +
        '<div class="field"><label>' + _esc(L('Email nhận thông báo ngân hàng', 'Email your bank writes to')) + '</label>' +
        '<input id="atx-email" type="email" inputmode="email" autocapitalize="none" spellcheck="false" ' +
          'autocomplete="email" oninput="fhModalDirty()" ' +
          'placeholder="' + _escAttr(L('vd. tenban@gmail.com', 'e.g. you@gmail.com')) + '" ' +
          'value="' + _escAttr(_atxTyped) + '"></div>' +
        '<div class="atx-acct-hint">' + _esc(L(
          'Để trống cũng được, Google sẽ hỏi bạn chọn tài khoản.',
          'Leaving it blank is fine, Google will ask you to pick.')) + '</div>' +
        '<button class="btn-skip" onclick="fhAutoTxnUseLogin()">' +
          _esc(L('Dùng email đăng nhập', 'Use my sign-in email')) + '</button>',
      /* Save runs the same handoff as the offer CTA. Throwing with an fhMsg
         keeps the form open and toasts that exact sentence (_friendly passes
         fhMsg straight through), which is what someone mid-typo needs — a
         modal that closed on failure would lose what they wrote. */
      save: async function () {
        const typed = _atxTypedEmail();
        if (typed && !/.+@.+\..+/.test(typed)) {
          throw Object.assign(new Error('bad email'), {
            fhMsg: L('Địa chỉ email chưa đúng, bạn xem lại nhé', 'That email doesn’t look right — give it another look') });
        }
        _atxNavigate(await _atxConsentUrl(typed));
      },
      after: function () {
        // Focus once the modal has settled: focusing mid-transition sets the
        // keyboard and the slide animation fighting each other on iOS.
        setTimeout(function () {
          const el = document.getElementById('atx-email');
          if (el) try { el.focus(); } catch (e) {}
        }, 300);
      },
    });
  };

  window.fhAutoTxnUseLogin = function () {
    _atxTyped = '';                          // drop the typed hint; the offer uses the sign-in address
    fhAutoTxnSheet();
  };

  /* The single entry point. Deliberately does NOT branch on connection state
     yet: main has no read side for oauth connections (get_my_mailbox_connections
     lands with the backend, on branch bank-email-oauth), so there is nothing
     truthful to render for "already connected". When that RPC arrives, the
     status branch goes HERE, ahead of the intro, the way fhMailboxSheet does it. */
  window.fhAutoTxnSheet = function () {
    _fhSheet(
      '<div class="mbx-hero">' + _atxGlyph('auto') + '</div>' +
      '<div class="sheet-h">' + _esc(L('Tự động ghi giao dịch', 'Automatic transaction logging')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Cho phép Earthy đọc email để tìm biên lai và thông báo giao dịch từ ngân hàng, rồi điền sẵn vào sổ chi tiêu cho bạn. Không phải gõ tay nữa.',
        'Let Earthy read your email to find receipts and bank transaction alerts, then fill your ledger in for you. No more typing them in by hand.')) + '</div>' +

      '<div class="mbx-assure">' +
        _mbxAssure('eyeoff', L('Chỉ biên lai và giao dịch', 'Only receipts and transactions'),
          L('Tụi mình chỉ tìm email từ ngân hàng và cửa hàng. Những thư khác không bao giờ được tải về.',
            'We only look for mail from banks and merchants. Everything else is never downloaded.')) +
        _mbxAssure('lock', L('Chỉ gia đình bạn mở được', 'Only your family can open it'),
          L('Giao dịch được niêm phong ngay khi lưu, chỉ thiết bị của gia đình bạn mở được.',
            'Transactions are sealed the moment they are stored, and only your family’s devices can open them.')) +
        _mbxAssure('check', L('Bạn duyệt rồi mới vào sổ', 'You approve before anything is logged'),
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

  /* ── the consent URL ───────────────────────────────────────────────────────
     THE BACKEND OWNS IT NOW. This used to assemble the Google URL here, on the
     grounds that a client_id, a scope and a redirect are all public. That was
     true, and it was still the wrong place — because the fourth component is
     `state`, and a browser cannot keep a signing key.

     The old comment said so itself: state was unsigned, so the callback "has to
     verify the claim rather than believe it", or a forged state attaches one
     person's mailbox to another person's member row. The API mints and SIGNS
     the state instead (features/connections/oauth-state.ts), which removes that
     class of bug rather than asking the callback to defend against it.

     WHY `redirect: "manual"` AND NOT A PLAIN NAVIGATION. The endpoint needs the
     caller's identity, which travels as a Bearer token in a header — and a
     header cannot ride on a `location.assign`. So we fetch it, and we must NOT
     let fetch follow the 302: following it would make the browser request
     accounts.google.com as a cross-origin fetch, which Google refuses, and the
     response would come back opaque with nothing readable in it. Reading
     `Location` and navigating ourselves keeps the hand-off a real top-level
     navigation, which is what the consent screen requires. The API sets
     `exposeHeaders: ["Location"]` so this header is visible to script at all. */

  /* Where the API lives. Pinned per-origin rather than derived: the API is a
     different host from the app, and its CORS allow-list names this app's
     origin exactly, so guessing wrong fails as a CORS error rather than a 404. */
  const _ATX_API = 'https://earthy-api-860668973723.asia-southeast1.run.app';

  /* The app's own access token, which is what the API authenticates.
     `getSession()` rather than a cached copy: it refreshes an expired token
     transparently, and an hour-old tab is the common case for a feature people
     reach for from Settings. */
  async function _atxAuthToken() {
    const { data, error } = await window.sb.auth.getSession();
    if (error) throw error;
    const token = data && data.session && data.session.access_token;
    if (!token) {
      throw Object.assign(new Error('no session'), {
        fhMsg: L('Bạn cần đăng nhập lại trước đã', 'Please sign in again first') });
    }
    return token;
  }

  async function _atxConsentUrl(email) {
    const token = await _atxAuthToken();
    const q = new URLSearchParams();
    /* Come back to the page they left, not to a default. The API confines this
       to a same-origin path, so it can only ever move them within the app. */
    q.set('returnTo', location.pathname + location.search);
    /* login_hint is a HINT, not a claim: it pre-selects an account inside
       Google's chooser. Whichever account actually consents is the mailbox we
       connect, and the callback learns that address from Google, never here. */
    if (email) q.set('login_hint', email);

    const res = await fetch(
      _ATX_API + '/connections/google/authorize?' + q.toString(),
      {
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: 'Bearer ' + token },
      }
    );

    /* An opaqueredirect response has status 0 and no readable headers. It means
       the browser followed the 302 despite `manual` (or a proxy rewrote it), so
       there is nothing to navigate to and guessing would send them somewhere
       wrong. */
    const target = res.headers.get('Location');
    if (target) return target;

    if (res.status === 401) {
      throw Object.assign(new Error('unauthorised'), {
        fhMsg: L('Phiên đăng nhập đã hết hạn, đăng nhập lại nhé',
                 'Your session expired — please sign in again') });
    }
    throw Object.assign(new Error('authorize failed: ' + res.status), {
      fhMsg: L('Chưa mở được Google, thử lại nhé',
               'Could not open Google — try again') });
  }

  /* Full navigation rather than a popup, deliberately: iOS Safari blocks a
     window.open issued after an await, and the consent flow has to land back on
     a real page regardless.

     The login_hint is a HINT, NOT A CLAIM. Whichever account actually consents
     on Google's screen is the mailbox we are connected to, and it may not be the
     one hinted here. The callback learns the real address from Google, and that
     is the one to store — never this. */
  /* The offer screen's CTA: read from the sign-in address, no form involved. */
  window.fhAutoTxnGrant = async function () {
    const btn = document.getElementById('atx-go');
    const label = L('Bắt đầu: cho phép đọc email', 'Start by granting email access');
    const reset = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };
    if (btn) { btn.disabled = true; btn.textContent = L('Đang mở Google…', 'Opening Google…'); }
    try {
      _atxNavigate(await _atxConsentUrl(_atxLoginEmail()));
      return;                                   // navigating: leave the button as it is
    } catch (e) {
      window.toast && window.toast(window._fhFriendly ? window._fhFriendly(e)
        : ((e && e.fhMsg) || L('Chưa mở được Google, thử lại nhé', 'Could not open Google — try again')));
      try { console.warn('[autotxn] consent url failed:', e && (e.message || e)); } catch (e2) {}
    } finally {
      if (!_atxLeaving) reset();
    }
  };

  /* Handing off to Google, and admitting it when the browser will not go.
     A cross-origin assignment can be refused outright in an installed PWA, and
     it fails SILENTLY — no throw, no event, the page simply stays. That is
     indistinguishable from a frozen button, so rather than trust it we watch: if
     we are still here shortly afterwards, we swap the CTA for a real anchor to
     the same URL. A link the person taps is a plain user gesture, which every
     platform honours, so the journey always has a way forward. */
  let _atxLeaving = false;
  function _atxNavigate(url) {
    _atxLeaving = true;
    try { window.location.assign(url); } catch (e) { /* handled by the watchdog */ }
    setTimeout(function () {
      _atxLeaving = false;
      const btn = document.getElementById('atx-go');
      if (!btn || !btn.parentNode) return;      // gone: the sheet closed, or we left
      const a = document.createElement('a');
      a.className = 'cta';
      a.id = 'atx-go';
      a.href = url;
      a.rel = 'noopener';
      a.textContent = L('Mở màn hình Google', 'Open the Google screen');
      btn.parentNode.replaceChild(a, btn);
    }, 1500);
  }

  /* ── coming back ───────────────────────────────────────────────────────────
     Google sends the person to the API callback, which finishes the exchange
     and redirects here. Without this the journey ends on a silent app boot that
     looks identical to a cold start, and nobody can tell whether it worked.

     THE RETURN CONTRACT, as the API actually implements it (routes.ts endUrl):
       success → OAUTH_SUCCESS_REDIRECT with NO extra param
       failure → OAUTH_FAILURE_REDIRECT with ?reason=<kind>
     Both land on a path the flow chose via `returnTo`, confined to this origin.

     So the signal is `fh_gmail=1` (set on the configured success URL) plus the
     presence or absence of `reason`. `reason` alone is enough to know it failed
     — a success never carries one — which is why an unknown reason still shows
     the failure screen rather than being ignored.

     `?fh_gmail=connected|denied|error` stays accepted. That was the contract
     this file proposed before the backend existed, and a person mid-flow when
     the API changed should not land on a blank screen.

     The params are eaten on arrival (67-card-ui.js does the same for key
     fragments): a reload should not replay a one-time outcome, and the value
     should not sit in the address bar or a share sheet. */

  /* Google's own word for "the person pressed Cancel", plus the API's kind for
     the same thing. Declining is a normal answer and gets a different screen
     from a genuine fault, so the two have to be told apart. */
  const _ATX_DENIED = ['denied', 'access_denied', 'declined'];

  function _atxReturnState() {
    try {
      const q = new URLSearchParams(location.search);
      const legacy = (q.get('fh_gmail') || q.get('gmail') || '').toLowerCase();
      const reason = (q.get('reason') || '').toLowerCase();
      /* `connected` is the legacy success word; `1` is what the success URL
         configured on the API carries. Either means the grant landed. */
      const ok = legacy === 'connected' || legacy === '1';
      if (!ok && !reason && !legacy) return null;

      let v;
      if (reason) v = _ATX_DENIED.indexOf(reason) >= 0 ? 'denied' : 'error';
      else if (ok) v = 'connected';
      else if (legacy === 'denied' || legacy === 'error') v = legacy;
      else return null;                          // an unrecognised value, ignored

      q.delete('fh_gmail'); q.delete('gmail'); q.delete('reason');
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
  