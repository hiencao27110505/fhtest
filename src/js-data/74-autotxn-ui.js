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
     WE own getting the person to Google. The backend takes over at the callback.

     That split is why this is built here rather than fetched: nothing about the
     consent URL needs a server. It is a client_id, a scope, a redirect and a
     state, and every one of them is either public or ours to decide. Asking a
     server to assemble a public URL only added a round trip that could 404,
     which is exactly what it was doing.

     NO PKCE, deliberately. PKCE protects a PUBLIC client that must exchange the
     code itself. Ours is confidential: the backend holds the client secret and
     does the exchange, which is the stronger protection, and an intercepted code
     is useless without that secret. Adding a challenge here would also strand
     the verifier in this browser, where the exchanging server cannot read it —
     ceremony rather than security.

     STATE IS UNTRUSTED INPUT, and the backend must treat it as such. It says
     which member started the flow, because the callback has no session of its
     own to ask. It is NOT signed — a browser cannot keep a signing key — so the
     callback has to verify the claim rather than believe it: confirm the member
     belongs to the account the granted email resolves to before attaching a
     mailbox to anyone's ledger. Believing it as-is would let a forged state
     attach one person's mailbox to another person's member row. */
  const _ATX_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const _ATX_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

  /* THE SAME Google client as sign-in, deliberately: `FHTest Web`
     (860668973723-…) in the `fhtest` project, which is GOOGLE_CLIENT_ID in
     10-client-auth.js. It is referenced through that constant rather than
     re-typed, so the two can never drift apart.

     This was briefly pointed at 340747728156-… because that is what
     GOOGLE_OAUTH_CLIENT_ID happened to be in a local env file. That client lives
     in a DIFFERENT GCP project, which the fhtest project cannot register a
     redirect URI for — so the consent screen would have kept refusing with no
     way to fix it from the project we actually own.

     WHAT MUST HOLD: the client that ISSUES the code has to be the client that
     EXCHANGES it. The backend's GOOGLE_OAUTH_CLIENT_ID / _SECRET therefore have
     to be this same client's. Mismatch it and Google refuses with
     `invalid_grant` at the token exchange — after the person has read the
     consent screen and pressed Allow, so it surfaces as a backend failure at the
     last possible moment rather than a misconfiguration at the first.

     Sharing the client with sign-in is fine: scopes are per REQUEST, not per
     client, so signing in still asks for nothing but the basics. What is shared
     is the project's consent screen and its verification status, which a
     separate client in the same project would have shared anyway. */
  /* PINNED, not built from location.origin, and that is the point.

     Google compares redirect_uri LITERALLY against a registered list. Vercel
     gives every deployment its own preview hostname, so an origin-derived
     redirect changes per deploy and each one would have to be registered or the
     person gets `redirect_uri_mismatch` before the consent screen even renders.
     Pinning means the one string we registered is the one we always send, from
     whatever URL the app happens to be open at. Opening a preview build simply
     returns you to production, which is where the callback lives anyway.

     THIS EXACT STRING has to appear in three places, and all three must agree:
       1. Google Cloud Console → Credentials → the OAuth client whose id is
          _ATX_CLIENT_ID above → Authorised redirect URIs
       2. the backend's GOOGLE_OAUTH_REDIRECT_URI env var in Vercel
       3. here
     No trailing slash, https, exact case. Changing the domain means changing
     all three together. (A localhost dev loop would need its own registered URI
     and a temporary edit here; there is no automatic fallback on purpose,
     because a silent one is how a mismatch gets shipped.) */
  const _ATX_REDIRECT = 'https://fhtest-opal.vercel.app/api/gmail-callback';

  function _atxB64Url(obj) {
    // btoa is latin1-only; percent-encode first so a non-ASCII value cannot throw.
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function _atxConsentUrl(email) {
    const mid = window.DB && window.DB.ownerMemberId;
    if (!mid) {
      throw Object.assign(new Error('no member'), {
        fhMsg: L('Chưa xác định được thành viên, thử lại nhé', 'Could not identify your member — try again') });
    }
    let uid = '';
    try { uid = (window.fhUser && window.fhUser.id) || ''; } catch (e) {}

    const p = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: _ATX_REDIRECT,
      response_type: 'code',
      scope: _ATX_SCOPE,
      /* offline: the backend needs a REFRESH token, and Google only issues one
         alongside a fresh grant.

         prompt CARRIES TWO VALUES, and both are load-bearing:

         `consent` — without it a returning user hands back an access token that
           expires within the hour and no refresh token, so background sync
           silently stops working the same afternoon while the grant still looks
           fine in their Google account.

         `select_account` — because LOGIN_HINT IS ONLY A HINT. When Safari
           already has a Google session, Google honours that session and ignores
           the hint, so the person lands on whichever account they last signed
           into and can grant us the WRONG MAILBOX without noticing: the consent
           screen names an account nobody read, and the connection then quietly
           reads a mailbox with no bank mail in it. Forcing the chooser costs one
           tap and makes the account an explicit choice. The hint still does its
           job inside the chooser, pre-selecting the one we expect. */
      access_type: 'offline',
      prompt: 'select_account consent',
      include_granted_scopes: 'false',
      state: _atxB64Url({ uid: uid, mid: mid, v: 1 }),
    });
    /* login_hint only when we have an address to hint. Sending an empty one is
       not the same as sending none: it can leave Google on whatever account is
       already active instead of offering the picker. */
    if (email) p.set('login_hint', email);
    return _ATX_AUTH_URL + '?' + p.toString();
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
    /* PDPL consent gates BEFORE Google's screen (0071, PDPL-COMPLIANCE §5):
       Google's Allow grants API access, this sheet is the consent the law
       asks for. Same record as the forwarding path — one yes covers both. */
    if (window.fhConsentEnsure) {
      const consented = await window.fhConsentEnsure(() => window.fhAutoTxnGrant());
      if (!consented) return;
    }
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
  