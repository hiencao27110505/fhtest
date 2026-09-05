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
    return '<div class="atx-row" id="atx-acct">' +
      '<div class="atx-row-h">' +
        '<span class="atx-row-lbl">' + _esc(L('Đọc thư từ', 'Reading from')) + '</span>' +
        '<button class="atx-row-act" onclick="fhAutoTxnEmailSheet()">' + _esc(L('Đổi', 'Change')) + '</button>' +
      '</div>' +
      '<div class="atx-row-val">' + _esc(email ||
        L('Tài khoản bạn chọn ở màn hình Google', 'The account you pick on Google’s screen')) + '</div>' +
      '</div>';
  }

  /* WHICH LEDGER THIS MAILBOX FEEDS — the second question, and the one that
     decides which KEY protects every row before anyone reviews it.

     It is not the same question the account row asks. That one is a Google
     login_hint: WHICH MAILBOX. This one is WHOSE MONEY, and it has to be
     answered before we read anything, because a row cannot be re-sealed
     afterwards. Deciding at review would mean the plaintext had already touched
     a key the person did not choose.

     PERSONAL IS THE DEFAULT, and the asymmetry is why: a personal-sealed row
     can still be promoted outward to the family ledger at review — the app
     opens it with the personal key and re-encrypts under the family one. A
     family-sealed row cannot be pulled back, because the household has already
     been able to open it. Over-sealing is recoverable; under-sealing is not.

     Same chips as the expense modal (`ex-scope`) on purpose: this is the same
     question the app already asks when someone logs a spend by hand, and asking
     it in two visual languages would read as two different questions. */
  let _atxScope = 'personal';
  const _atxScopeIs = () => _atxScope;

  window.fhAutoTxnPickScope = function (v) {
    _atxScope = (v === 'family') ? 'family' : 'personal';
    const box = document.getElementById('atx-scope');
    if (box) Array.prototype.forEach.call(box.querySelectorAll('.atx-seg'), function (b) {
      b.classList.toggle('on', b.dataset.v === _atxScope);
    });
    const note = document.getElementById('atx-scope-note');
    if (note) note.textContent = _atxScopeNote();
  };

  function _atxScopeNote() {
    return _atxScope === 'family'
      ? L('Cả nhà thấy được các giao dịch này khi bạn duyệt.',
          'Everyone in the family sees these once you approve them.')
      : L('Chỉ mình bạn mở được. Lúc duyệt vẫn có thể chuyển sang sổ gia đình.',
          'Only you can open these. You can still move any of them to the family ledger when you review.');
  }

  /* HOW FAR BACK the first read reaches.
     
     This was a constant, and it moved from 90 to 15 and back in one afternoon
     because it is genuinely a judgement call that is not ours to make: someone
     who has been running a household on spreadsheets wants a year, someone
     trying the feature out wants a fortnight and is annoyed when 52 rows land
     at once. The person knows which they are; we do not.
     
     THE CEILING IS OURS, NOT GMAIL'S. Gmail's `newer_than:` has no documented
     limit. What stops us is that Gmail returns newest-first and a staged
     message still matches the query, so past our own list cap the oldest mail
     becomes unreachable rather than merely slow — plus every row lands in a
     queue somebody works through by hand.
     
     Three presets and a free field, because the presets cover almost everyone
     and the field costs one line to support. Typing is clamped rather than
     rejected: someone who types 800 gets a year, not an error. */
  const ATX_MAX_DAYS = 365;
  const ATX_DEFAULT_DAYS = 90;   // also the server default (0093); the status screens read it back
  let _atxDays = ATX_DEFAULT_DAYS;

  window.fhAutoTxnPickDays = function (v) {
    _atxDays = _atxClampDays(v);
    const box = document.getElementById('atx-days');
    if (box) Array.prototype.forEach.call(box.querySelectorAll('.atx-seg'), function (b) {
      b.classList.toggle('on', Number(b.dataset.v) === _atxDays);
    });
    const custom = document.getElementById('atx-days-custom');
    // Only mirror the value in when a preset was tapped, so typing is not fought.
    if (custom && document.activeElement !== custom) custom.value = '';
    const note = document.getElementById('atx-days-note');
    if (note) note.textContent = _atxDaysNote();
  };

  window.fhAutoTxnTypeDays = function (el) {
    const raw = String(el.value || '').replace(/[^0-9]/g, '');
    if (!raw) return;
    _atxDays = _atxClampDays(raw);
    if (Number(raw) > ATX_MAX_DAYS) el.value = String(ATX_MAX_DAYS);
    const box = document.getElementById('atx-days');
    if (box) Array.prototype.forEach.call(box.querySelectorAll('.atx-seg'), function (b) {
      b.classList.toggle('on', Number(b.dataset.v) === _atxDays);
    });
    const note = document.getElementById('atx-days-note');
    if (note) note.textContent = _atxDaysNote();
  };

  function _atxClampDays(v) {
    const n = Math.round(Number(v));
    if (!isFinite(n) || n < 1) return 90;
    return Math.min(ATX_MAX_DAYS, n);
  }

  function _atxDaysNote() {
    const d = _atxDays;
    if (d >= ATX_MAX_DAYS) {
      return L('Một năm là mức xa nhất tụi mình đọc được.',
               'A year is as far back as we can reach.');
    }
    return L('Đọc email ngân hàng trong ' + d + ' ngày gần đây. Sau lần đầu, chỉ đọc email mới.',
             'Reads bank email from the last ' + d + ' days. After the first time, only new mail.');
  }

  function _atxDaysRow() {
    const chip = (v, label) =>
      '<button class="atx-seg' + (_atxDays === v ? ' on' : '') + '" data-v="' + v + '" ' +
      'onclick="fhAutoTxnPickDays(' + v + ')">' + _esc(label) + '</button>';
    return '<div class="atx-row atx-row-last" id="atx-daysfield">' +
      '<div class="atx-row-h"><span class="atx-row-lbl">' +
        _esc(L('Đọc lại bao xa', 'How far back')) + '</span></div>' +
      '<div class="atx-segs" id="atx-days">' +
        chip(30, L('30 ngày', '30 days')) +
        chip(60, L('60 ngày', '60 days')) +
        chip(90, L('90 ngày', '90 days')) +
      '</div>' +
      '<input id="atx-days-custom" class="atx-days-in" inputmode="numeric" ' +
        'placeholder="' + _escAttr(L('hoặc nhập số ngày (tối đa 365)', 'or type a number of days (max 365)')) + '" ' +
        'oninput="fhAutoTxnTypeDays(this)"/>' +
      '<div class="atx-row-note" id="atx-days-note">' + _esc(_atxDaysNote()) + '</div>' +
      '</div>';
  }

  function _atxScopeRow() {
    /* Family needs a family. Someone with only a personal wallet is offered
       nothing to switch to rather than a chip that fails on Google's screen. */
    const hasFamily = !!(window.DB && window.DB.fid);
    if (!hasFamily) {
      _atxScope = 'personal';
      return '<div class="mbx-note">' + _mbxGlyph('lock') + '<span>' + _esc(L(
        'Giao dịch sẽ vào ví cá nhân của bạn, chỉ mình bạn mở được.',
        'Transactions go to your personal wallet, where only you can open them.')) + '</span></div>';
    }
    return '<div class="atx-row" id="atx-scopefield">' +
      '<div class="atx-row-h"><span class="atx-row-lbl">' +
        _esc(L('Ghi vào đâu', 'Where these go')) + '</span></div>' +
      '<div class="atx-segs" id="atx-scope">' +
        '<button class="atx-seg' + (_atxScope === 'personal' ? ' on' : '') + '" data-v="personal" ' +
          'onclick="fhAutoTxnPickScope(\'personal\')">🔒 ' + _esc(L('Cá nhân', 'Personal')) + '</button>' +
        '<button class="atx-seg' + (_atxScope === 'family' ? ' on' : '') + '" data-v="family" ' +
          'onclick="fhAutoTxnPickScope(\'family\')">🏡 ' + _esc(L('Gia đình', 'Family')) + '</button>' +
      '</div>' +
      '<div class="atx-row-note" id="atx-scope-note">' + _esc(_atxScopeNote()) + '</div>' +
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
    _atxSheetSeq++;                           // a late /connections answer must not replace this form
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
          'Mỗi người kết nối được một hộp thư — chọn địa chỉ khác sẽ thay cho hộp thư đang dùng. ',
          'One mailbox per person for now — a different address replaces the one you have. ')) +
        _esc(L(
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
        // Opened before the await, while the tap is still in scope. The
        // validation above stays first, so a rejected address never leaves a
        // stray blank tab behind.
        const win = _atxOpenBlank();
        try {
          _atxNavigate(win, await _atxConsentUrl(typed));
        } catch (e) {
          if (win && !win.closed) try { win.close(); } catch (e2) {}
          throw e;                             // the modal reports it and stays open
        }
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

  /* ── which transport? ────────────────────────────────────────────────────
     Two ways for bank mail to reach the ledger, and until now nothing asked.

     "Khoản thu chi từ email" routed on the FORWARDING state alone, so someone
     already connected by OAuth — no alias, a perfectly working mailbox — was
     sent to the forwarding setup screen and told to paste a filter into Gmail.
     The two transports have always been separate journeys; the entry point that
     is common to both was the one place that had to know they exist.

     ORDER IS THE RECOMMENDATION. Direct read is first because it is better for
     almost everyone who can use it: one tap instead of a filter rule pasted
     into Gmail, and it reads history rather than starting from now. Forwarding
     is second and stays because it is the only thing that works for a mailbox
     Google does not host, which direct read cannot serve at all.

     Neither is described as "recommended" in the copy. The difference that
     actually decides it is whether their bank writes to a Gmail address, and
     the person knows that and we do not — so the rows state what each one DOES
     and let them match it to their own situation. */
  window.fhEmailSetupChooser = function (preset) {
    const scope = (preset && preset.scope === 'personal') ? 'personal' : null;
    _fhSheet(
      '<div class="mbx-hero">' + _mbxGlyph('mail') + '</div>' +
      '<div class="sheet-h">' + _esc(L('Ghi giao dịch từ email', 'Log transactions from email')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Ngân hàng đã gửi email cho bạn mỗi lần có giao dịch. Chọn cách để tụi mình đọc được những email đó.',
        'Your bank already emails you about every transaction. Pick how we should get to those emails.')) + '</div>' +

      '<div class="cf-cta">' +
        '<button class="cc-row" onclick="fhEmailSetupPick(\'direct\'' + (scope ? ", '" + scope + "'" : '') + ')">' +
          '<span class="cc-ic">' + _mbxGlyph('auto') + '</span>' +
          '<span class="cc-t">' +
            _esc(L('Kết nối Gmail', 'Connect Gmail')) +
            '<span class="cc-sub">' + _esc(L(
              'Một lần cấp quyền. Đọc được cả giao dịch cũ.',
              'Grant access once. Picks up past transactions too.')) + '</span>' +
          '</span>' + _atxChev() +
        '</button>' +
        '<button class="cc-row" onclick="fhEmailSetupPick(\'forward\')">' +
          '<span class="cc-ic">' + _mbxGlyph('mail') + '</span>' +
          '<span class="cc-t">' +
            _esc(L('Chuyển tiếp email', 'Forward your email')) +
            '<span class="cc-sub">' + _esc(L(
              'Bạn tạo một quy tắc trong hộp thư. Dùng được với email ngoài Gmail.',
              'You add a rule in your mailbox. Works with non-Gmail addresses too.')) + '</span>' +
          '</span>' + _atxChev() +
        '</button>' +
      '</div>' +

      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  };

  function _atxChev() {
    return '<svg class="cc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  }

  /* Routes to the chosen journey. Each owns its own explanation from here on,
     which is why this hands off rather than trying to host both. */
  window.fhEmailSetupPick = function (which, scope) {
    if (which === 'forward') return window.fhMailboxSheet && window.fhMailboxSheet();
    return window.fhAutoTxnSheet && window.fhAutoTxnSheet(scope ? { scope: scope } : undefined);
  };

  /* The single entry point, and the only place that decides which of the two
     screens someone sees. Already connected → status, where the off-switch
     lives. Otherwise → the offer. Same shape as fhMailboxSheet.

     WHY IT RENDERS THE OFFER FIRST AND CORRECTS ITSELF. Reading /connections is
     a round trip to another host; awaiting it before painting would leave a
     tapped menu row doing nothing for as long as the network takes, which reads
     as a dead row. So the offer paints at once and the status replaces it if the
     answer comes back connected. The swap only happens while this sheet is
     still the one on screen — `_atxSheetSeq` — so an answer that arrives after
     someone has closed the sheet or moved to the address form cannot yank the
     screen out from under them. */
  let _atxSheetSeq = 0;
  window.fhAutoTxnSheet = function (preset) {
    /* Arriving from the Cá nhân tab means "these are mine", the same affordance
       openPersonalExpense gives the expense modal. Only ever narrows to
       personal — a family entry point must not silently widen the seal. */
    if (preset && preset.scope === 'personal') _atxScope = 'personal';
    const seq = ++_atxSheetSeq;
    _atxConnection().then(function (conn) {
      if (conn && seq === _atxSheetSeq) fhAutoTxnStatus(conn);
    });

    /* STEP 1 OF 2 — what this is and why it is safe.
    
       Split from the settings because one sheet was carrying both, and on a
       real phone it read as a wall: three assurances, a scope note Google's
       breadth obliges us to print, an account row, two chip groups, a free
       field and a CTA, all stacked. The person could not tell what they were
       being asked. Nothing here needs a decision, so nothing here has a
       control — this screen only has to earn the tap. */
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
        _mbxAssure('lock', L('Chỉ bạn mở được', 'Only you can open it'),
          L('Giao dịch được niêm phong ngay khi lưu, chỉ thiết bị của bạn mở được.',
            'Transactions are sealed the moment they are stored, and only your devices can open them.')) +
        _mbxAssure('check', L('Bạn duyệt rồi mới vào sổ', 'You approve before anything is logged'),
          L('Mỗi khoản đều nằm chờ bạn xem qua. Không có gì tự vào sổ chi tiêu.',
            'Every transaction waits for you to look it over. Nothing enters your ledger on its own.')) +
      '</div>' +

      '<div class="mbx-note">' + _mbxGlyph('mail') + '<span>' + _esc(L(
        'Màn hình của Google sẽ xin quyền đọc thư. Google chỉ có đúng một quyền như vậy và nó bao trùm cả hộp thư, không có quyền nào hẹp hơn. Tụi mình chỉ tải email ngân hàng, và bạn gỡ quyền trong tài khoản Google bất cứ lúc nào.',
        'Google’s screen asks for permission to read your mail. Google offers exactly one such permission and it covers the whole mailbox, there is no narrower one. We only ever fetch bank email, and you can revoke access in your Google account at any time.')) + '</span></div>' +

      '<button class="cta" onclick="fhAutoTxnSetup()">' +
        _esc(L('Tiếp tục', 'Continue')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  };

  /* STEP 2 OF 2 — the three decisions, as a grouped list.
  
     Every row is the same shape: a label, the current answer, and a way to
     change it. That sameness is the point — three questions that look like one
     kind of thing are read as one screen, where three differently-shaped
     controls stacked up read as a form to fill in.
     
     The answers are all pre-filled with a working default, so this screen is
     legible without being touched: someone who reads nothing and taps the
     button gets their own mailbox, sealed to themselves, ninety days back. */
  window.fhAutoTxnSetup = function () {
    _atxSheetSeq++;
    _fhSheet(
      '<div class="sheet-h">' + _esc(L('Vài lựa chọn nhanh', 'A few quick choices')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Đổi được sau, nên cứ để mặc định cũng ổn.',
        'All of these can change later, so the defaults are a fine answer.')) + '</div>' +

      '<div class="atx-group">' +
        _atxAcctRow() +
        _atxScopeRow() +
        _atxDaysRow() +
      '</div>' +

      '<button class="cta" id="atx-go" onclick="fhAutoTxnGrant()">' +
        _esc(L('Cho phép đọc email', 'Allow email access')) + '</button>' +
      '<button class="btn-skip" onclick="fhAutoTxnSheet()">' + _esc(L('Quay lại', 'Back')) + '</button>'
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

  /* Where the connect endpoints live.
     Our own Edge Function (supabase/functions/mailbox-connect), on the same
     Supabase project as everything else the app talks to. SUPABASE_URL comes
     from 10-client-auth.js, which shares this module scope.

     MOVED HERE 2026-08-25, from a Cloud Run API on a different host. That API
     links a Google account to an auth.users row and does not stage anything;
     ours writes mailbox_grants, which carries the MEMBER and FAMILY a row is
     sealed to, and is what the poller reads. The two can coexist, and a user
     connected on the old one is not connected on this one — reconnecting is
     what moves them across. One line to point back, if that is ever wanted. */
  const _ATX_API = SUPABASE_URL + '/functions/v1/mailbox-connect';

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

  /* ── is it already on? ─────────────────────────────────────────────────────
     GET /connections returns the caller's own rows. A plain fetch, so the Bearer
     header works — unlike the authorize route, which had to be read through a
     manual redirect because a navigation carries no header.

     "Cannot tell" collapses into "not connected" on purpose: no session, a 500,
     offline, all return null and the offer screen shows. Offering the feature to
     someone who already has it is a recoverable annoyance; announcing a
     confident "Connected" we never verified is a lie, and it is the version that
     hides a mailbox quietly failing to sync. */
  async function _atxConnection() {
    try {
      /* Read straight from the table rather than through an endpoint. Migration
         0087 pairs a select policy (own rows) with a COLUMN-level grant that
         omits refresh_token_enc, so this is exactly the status line and nothing
         else — the credential is not reachable from a browser even by asking
         for it. One less endpoint, one less CORS surface, and no round trip
         through a function to read four columns. */
      /* THE STATUS COLUMNS ONLY, and a retry that drops the optional ones.

         0087's column-level grant is what keeps refresh_token_enc unreachable
         from a browser, and it has a failure mode worth defending against: a
         column added by a LATER migration is not in the grant, and PostgREST
         rejects the WHOLE select rather than omitting it. The caller then sees
         an error instead of a row and concludes there is no connection —
         which is how someone with a healthy mailbox and two hundred staged
         transactions was sent to the setup screen (0101 granted the columns;
         this is the belt to that migration's braces).

         So: ask for everything, and if the select is refused, fall back to the
         columns 0087 itself granted. A connection reported without its scope
         is still a connection, and knowing one exists is what the entry point
         actually needs. */
      /* THREE TIERS, NOT TWO, and the order is the point. Each later migration
         granted its own columns, so asking for all of them at once fails
         wholesale on any deployment where the newest migration has not run yet.
         A single fallback to CORE would then also drop `default_scope`, and the
         status screen would name the wrong ledger — a worse lie than a missing
         stall flag. So each tier drops only what the tier above it added:
           1. CORE + backfilled_at          0087's own grant
           2. + default_scope, backfill_days 0102
           3. + stalled_runs, first_stalled_at 0121
         Client ships before the migration is applied, and degrades to "no
         stalled state" rather than "no connection". */
      const CORE = 'id,provider,email,needs_reauth,connected_at,last_synced_at,backfilled_at';
      const T2 = CORE + ',default_scope,backfill_days';
      const T3 = T2 + ',stalled_runs,first_stalled_at';
      const ask = (cols) => sb.from('mailbox_grants').select(cols).eq('provider', 'google').limit(1);
      let res = await ask(T3);
      if (res.error) res = await ask(T2);
      if (res.error) res = await ask(CORE);
      if (res.error) return null;
      const row = (res.data || [])[0] || null;
      if (!row) return null;
      /* needsReauth is camelCased to match the rest of this file. It is not
         cosmetic: a refresh token dies every 7 days while the OAuth app is in
         Testing publishing status, so a stale grant is the most common state
         this screen has to render after "healthy". */
      const conn = { id: row.id, provider: row.provider, email: row.email,
               needsReauth: !!row.needs_reauth, connectedAt: row.connected_at,
               lastSyncedAt: row.last_synced_at,
               backfilledAt: row.backfilled_at || null,
               backfillDays: Number(row.backfill_days) || ATX_DEFAULT_DAYS,
               stalledRuns: Number(row.stalled_runs) || 0,
               /* Older grants predate the column; they are family by history,
                  which is what the null means rather than "unknown". */
               scope: row.default_scope === 'personal' ? 'personal' : 'family' };
      conn.phase = _atxPhase(conn);
      _atxPhaseCache = conn.phase;            // the row renderer reads this synchronously
      return conn;
    } catch (e) { return null; }
  }

  /* ── the one derived fact three screens agree on ───────────────────────────
     'reading'  first pass unfinished — the queue is HELD (see fhEmailTxnCta)
     'slow'     unfinished, but stalled long enough that holding is now the
                bigger harm; the queue opens and the copy stops claiming to
                still be reading
     'done'     backfilled_at set: every bank email in the window has been read
     'reauth'   Google rejected the token; its own screen already exists

     WHY 'slow' EXISTS AT ALL. 0101 never sets backfilled_at on a stall, on
     purpose — marking one complete would abandon unread mail. So a hold keyed
     only on that flag locks someone out permanently the moment one message in
     their mailbox is unreadable. This threshold is the release valve.

     ⚠️ COUPLED CONSTANT: STALL_NOTIFY_AFTER in
     supabase/functions/_shared/mailbox/worker.mjs. The worker sends its "here
     is what we got" notice on the same crossing this opens the queue on, so the
     two must move together. There is no shared config to read it from. */
  const ATX_STALL_OPENS_AT = 12;

  function _atxPhase(conn) {
    if (!conn) return null;
    if (conn.needsReauth) return 'reauth';
    if (conn.backfilledAt) return 'done';
    if (conn.stalledRuns >= ATX_STALL_OPENS_AT) return 'slow';
    return 'reading';
  }

  /* Last known phase, so the CTA row can render synchronously on every paint
     without a round trip. Null until the first _atxConnection resolves, which
     is the honest answer then: "not known yet" must not read as "held", or a
     slow network would gate the queue for someone with no mailbox at all. */
  let _atxPhaseCache = null;
  window.fhBackfillPhase = () => _atxPhaseCache;
  /* The queue is reachable unless we positively know a first read is running. */
  window.fhBackfillHolds = () => _atxPhaseCache === 'reading';

  /* What the Widget A / Cá nhân row paints from. It renders on every hydrate
     and every badge change, so it cannot await anything — this is the last
     answer the async side computed, or null before there is one. Null renders
     as the ordinary row. */
  let _atxProgressCache = null;
  window.fhBackfillProgress = () => _atxProgressCache;

  /* ── how far back the read has actually got ────────────────────────────────
     Gmail lists newest-first and the worker eats the next unprocessed slice
     each run (worker.mjs), so a backfill marches BACKWARDS in time: every
     transaction it stages is older than the last. The oldest staged row is
     therefore the frontier, and "we have read back to <date>" is a true,
     monotonic statement rather than a guessed percentage.

     `occurred_at` is one of the few columns that stays CLEAR (dedup queries a
     range over it), so this costs one tiny select and no decryption.

     THE FLOOR, and why it is not optional. Promoting a row DELETES it
     (resolve_email_transactions), so if someone reviews the oldest cards the
     min jumps toward today and the bar would run backwards — the one behaviour
     that would read as broken. So the frontier is remembered per grant and may
     only ever move further back. Losing the cache (new device, cleared
     storage) re-derives from what is pending and UNDER-states progress, which
     is the safe direction: it never claims to have read further than it has. */

  /* ── the status screen, and turning it off ─────────────────────────────────
     WHAT DISCONNECT ACTUALLY DOES, and why the copy has to say two things. The
     API's own route comment is explicit: "The grant at the provider is not
     revoked. Deleting the row stops the pipeline reading the mailbox; revoking
     the app entirely is the user's own call, in their account settings at the
     provider."

     So one tap stops US reading, completely and at once — and that is the half
     that matters most, because it DESTROYS the token we hold rather than merely
     abandoning it. It does not remove FamilyHub from their Google account.

     Saying only the first half leaves someone believing they revoked us while
     Google still lists the app. Saying only the second sends them to Google
     while our copy of their token sits in a database. Both, in that order, is
     the only version that is true. */
  async function fhAutoTxnStatus(conn) {
    const seq = ++_atxSheetSeq;
    const email = (conn && (conn.email || conn.accountEmail || conn.account_email)) || '';

    /* Resolved before EITHER branch renders (71's rule: no control appearing a
       beat late). Costs a local permission check, no network. The reauth branch
       does not use it — that screen has one job and it is the reconnect. */
    const pushRow = await _atxPushRowSafe();
    if (seq !== _atxSheetSeq) return;        // another screen took over meanwhile

    /* A GRANT THAT NEEDS RE-CONSENT IS NOT A HEALTHY CONNECTION, and saying so
       is the difference between a feature that looks fine and one that works.
       Google invalidates a refresh token when the person revokes access,
       changes their password, or — while the app is in Testing publishing
       status — every 7 days. That last one makes this a WEEKLY screen, not an
       edge case.

       Left unsaid, someone sees "Đang tự động ghi" over a mailbox that has not
       synced since Tuesday, and the first thing they notice is a month of
       missing transactions. The fix is one tap and the same button as the first
       time, so the copy names the state plainly and offers it. */
    if (conn && conn.needsReauth) {
      return _fhSheet(
        '<div class="mbx-hero">' + _mbxGlyph('mail') + '</div>' +
        '<div class="sheet-h">' + _esc(L('Cần kết nối lại', 'Reconnect needed')) + '</div>' +
        '<div class="sheet-sub">' + _esc(email
          ? L('Google đã ngừng cho tụi mình đọc ' + email + ', nên tạm thời không có giao dịch mới nào được ghi. Kết nối lại một lần là xong.',
              'Google stopped letting us read ' + email + ', so no new transactions are being logged. One reconnect fixes it.')
          : L('Google đã ngừng cho tụi mình đọc email của bạn, nên tạm thời không có giao dịch mới nào được ghi. Kết nối lại một lần là xong.',
              'Google stopped letting us read your email, so no new transactions are being logged. One reconnect fixes it.')) + '</div>' +
        '<div class="mbx-note">' + _mbxGlyph('check') + '<span>' + _esc(L(
          'Những khoản đã tìm được trước đó vẫn nằm nguyên trong mục duyệt.',
          'Anything found before this is still waiting in Review transactions.')) + '</span></div>' +
        '<button class="cta" id="atx-go" onclick="fhAutoTxnGrant()">' +
          _esc(L('Kết nối lại', 'Reconnect')) + '</button>' +
        (window.fhTxnReviewSheet
          ? '<button class="btn-line" onclick="fhTxnReviewSheet()">' + _esc(L('Xem mục duyệt', 'Open Review transactions')) + '</button>'
          : '') +
        '<button class="ex-del" id="atx-off" onclick="fhAutoTxnDisconnect(this)">' +
          _esc(L('Ngừng đọc email', 'Stop reading my email')) + '</button>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
      );
    }

    _fhSheet(
      '<div class="mbx-hero">' + _mbxGlyph('done') + '</div>' +
      '<div class="sheet-h">' + _esc(L('Đang tự động ghi', 'Auto-logging is on')) + '</div>' +
      '<div class="sheet-sub">' + _esc(email
        ? L('Tụi mình đang đọc email giao dịch từ ' + email + '. Khoản nào tìm được vẫn nằm chờ bạn duyệt, không tự vào sổ.',
            'We’re reading transaction email from ' + email + '. Anything we find still waits for you to approve it, and never enters the ledger on its own.')
        : L('Tụi mình đang đọc email giao dịch của bạn. Khoản nào tìm được vẫn nằm chờ bạn duyệt, không tự vào sổ.',
            'We’re reading your transaction email. Anything we find still waits for you to approve it, and never enters the ledger on its own.')) + '</div>' +

      /* WHICH LEDGER, stated plainly, because it is the one thing about this
         connection a person cannot see anywhere else and cannot infer from the
         queue — a personal row and a family row look identical there. It is
         also the thing they would most want to be sure of before their bank
         mail starts arriving. */
      '<div class="mbx-note">' + _mbxGlyph(conn && conn.scope === 'family' ? 'mail' : 'lock') + '<span>' +
        _esc(conn && conn.scope === 'family'
          ? L('Giao dịch vào sổ gia đình. Cả nhà thấy được sau khi bạn duyệt.',
              'Transactions go to the family ledger, visible to everyone once you approve them.')
          : L('Giao dịch vào ví cá nhân, chỉ mình bạn mở được. Lúc duyệt vẫn có thể chuyển sang sổ gia đình.',
              'Transactions go to your personal wallet, where only you can open them. You can still move any of them to the family ledger when you review.')) +
        '</span></div>' +

      /* THE SAME PROGRESS BLOCK AS THE CONNECT SCREEN, because this is the
         screen someone reopens to ask "is it done yet?" — and until now it
         answered "Đang tự động ghi" whether the first pass finished an hour ago
         or is still running. Rendered from the cached phase and filled in by
         _atxStatusProgress once the counts come back; a slot that starts empty
         and fills is honest, a number that starts wrong is not. */
      '<div id="atx-pg"></div>' +
      '<div id="atx-feed"></div>' +

      /* ONE MAILBOX AT A TIME, said here because this is the screen someone is
         on when they think about adding another. `mailbox_grants` is unique on
         (user_id, provider), so connecting a second Google account REPLACES
         this one rather than joining it — a consequence nobody would guess from
         a button labelled "Đổi". Saying it plainly costs a line; discovering it
         costs a mailbox. */
      '<div class="mbx-note">' + _mbxGlyph('mail') + '<span>' + _esc(L(
        'Hiện mỗi người kết nối được một hộp thư. Kết nối hộp thư khác sẽ thay cho hộp thư này. Tụi mình đang làm phần nhiều hộp thư cùng lúc.',
        'For now you can connect one mailbox. Connecting a different one replaces this. Support for several at once is on the way.')) + '</span></div>' +

      pushRow +

      /* HELD WHILE THE FIRST READ RUNS. Same rule as the connect screen and the
         Widget A row: the queue is not just unhelpful mid-backfill, it is
         wrong, because the review screen's duplicate bucketing only sees the
         rows it fetched. The progress block above already says why, so this
         slot simply stays empty rather than offering a dead control. */
      ((window.fhTxnReviewSheet && conn && conn.phase !== 'reading')
        ? '<button class="btn-line" onclick="fhTxnReviewSheet()">' + _esc(L('Xem mục duyệt', 'Open Review transactions')) + '</button>'
        : '') +

      /* Destructive, so low-prominence and armed before it fires (DESIGN §3):
         a small quiet text button, never a big red one. */
      '<button class="ex-del" id="atx-off" onclick="fhAutoTxnDisconnect(this)">' +
        _esc(L('Ngừng đọc email', 'Stop reading my email')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
    // guarded so fhAutoTxnStatus stays extractable on its own (tools/autotxn-connected-live.test.js)
    if (typeof _atxStatusProgress === 'function') _atxStatusProgress(conn);
  }
  window.fhAutoTxnStatus = fhAutoTxnStatus;

  /* Fills #atx-pg on the status screen, and keeps it live while a first read is
     still running so someone who opens Settings mid-backfill watches the same
     numbers the connect screen shows. Fire-and-forget: a slow count must never
     hold the sheet, and a throw here must never cost the screen. */
  async function _atxStatusProgress(conn) {
    try {
      const st = await _atxProgressState(conn);
      _atxProgressPaint(document.getElementById('atx-pg'), st, false);
      const fd = document.getElementById('atx-feed');
      if (fd) fd.innerHTML = _atxFeedHTML(st.finds);
      if (st.phase === 'reading') _atxLiveWatch();
    } catch (e) {}
  }

  /* Arm-then-confirm (DESIGN §3): the first tap only relabels, and it disarms
     itself after ~3s so a button left armed cannot be fired by a stray touch
     minutes later. */
  let _atxOffArmed = false, _atxOffTimer = null;
  const _ATX_OFF_LABEL = () => L('Ngừng đọc email', 'Stop reading my email');

  /* Headless stop + status, for callers that carry their own confirmation.
     Erasure (75-consent-ui) has to stop OAuth collection as well as forwarding:
     the SQL side can delete mailbox_connections, but this connection lives
     behind the Cloud Run API, so only the client can end it. Without this the
     serverless watcher keeps reading a mailbox whose owner has withdrawn
     consent -- collection after withdrawal, which gets no grace period even
     though DELETION gets 72 hours. Same route as the UI disconnect below;
     404 counts as success because it means already gone. */
  async function _atxStopHeadless() {
    try {
      const token = await _atxAuthToken();
      const res = await fetch(_ATX_API + '/connections/google', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      return res.ok || res.status === 404;
    } catch (e) { return false; }
  }
  window.fhAutoTxnStop = _atxStopHeadless;
  window.fhAutoTxnConnection = _atxConnection;

  window.fhAutoTxnDisconnect = async function (btn) {
    if (!_atxOffArmed) {
      _atxOffArmed = true;
      if (btn) btn.textContent = L('Chạm lần nữa để ngừng', 'Tap again to stop');
      clearTimeout(_atxOffTimer);
      _atxOffTimer = setTimeout(function () {
        _atxOffArmed = false;
        const b = document.getElementById('atx-off');
        if (b) b.textContent = _ATX_OFF_LABEL();
      }, 3000);
      return;
    }
    clearTimeout(_atxOffTimer);
    _atxOffArmed = false;
    if (btn) { btn.disabled = true; btn.textContent = L('Đang ngừng…', 'Stopping…'); }
    let _stopped = null;
    try {
      /* disconnect_my_mailbox() (0082, extended by 0087) rather than a DELETE
         on one row. It is the WITHDRAWAL action, not just an unlink: it deletes
         the OAuth grant, the forwarding connection, and every still-pending
         staged row, in one transaction that re-checks ownership itself. Half of
         that is what the consent sheet promises, so doing less here would make
         the sheet untrue.

         Deleting nothing is success, not a 404: the state they asked for is the
         state that already holds. */
      _stopped = await _rpc('disconnect_my_mailbox', {});
    } catch (e) {
      window.toast && window.toast(window._fhFriendly ? window._fhFriendly(e)
        : L('Chưa ngừng được, thử lại nhé', 'Could not stop it — try again'));
      try { console.warn('[autotxn] disconnect failed:', e && (e.message || e)); } catch (e2) {}
      if (btn) { btn.disabled = false; btn.textContent = _ATX_OFF_LABEL(); }
      return;
    }
    fhAutoTxnStopped(_stopped);
  };

  function fhAutoTxnStopped(res) {
    _fhSheet(
      '<div class="sheet-h">' + _esc(L('Đã ngừng', 'Stopped')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Tụi mình đã xoá quyền đã lưu và sẽ không đọc thêm email nào của bạn. Những giao dịch đã vào sổ vẫn giữ nguyên, vì đó là sổ của gia đình bạn.',
        'We’ve deleted the saved access and will read no more of your email. Transactions already in your ledger stay, because that ledger is yours.')) + '</div>' +
      '<div class="mbx-note">' + _mbxGlyph('lock') + '<span>' + _esc(L(
        'FamilyHub vẫn còn trong danh sách ứng dụng của tài khoản Google. Muốn gỡ hẳn cả ở phía Google, bạn mở phần quyền truy cập bên dưới.',
        'FamilyHub is still listed among your Google account’s apps. To remove it on Google’s side as well, open the permissions page below.')) + '</span></div>' +
      '<a class="btn-line" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">' +
        _esc(L('Mở quyền truy cập Google', 'Open Google permissions')) + '</a>' +

      /* THE FORWARDING RULE IS THEIRS TO REMOVE, and until 2026-09-04 this
         sheet never said so. The note above covers the OAuth grant; the other
         transport has the person point Gmail at an alias we own, and that rule
         lives in their mailbox where nothing here can reach it. Deleting our
         row stops us READING — which is what the line above promises, and it is
         true — but the mail keeps arriving at a shared inbox, and someone who
         has just been told "we will read no more of your email" would not guess
         that. It is the same honesty 0087 already applies to the Google grant,
         owed to the other half of the users.

         Shown only when a forwarding alias was actually retired (0117 returns
         the count), so the OAuth-only case does not get told to go turn off
         something it never set up. */
      (res && res.aliases_retired > 0
        ? '<div class="mbx-note">' + _mbxGlyph('mail') + '<span>' + _esc(L(
            'Bạn đang chuyển tiếp thư sang hộp của tụi mình. Quy tắc chuyển tiếp nằm trong Gmail của bạn, tụi mình không tắt hộ được. Bạn vào Cài đặt Gmail, mục Chuyển tiếp, rồi bỏ địa chỉ đó đi nhé.',
            'You had Gmail forwarding mail to us. That rule lives in your Gmail and we can’t switch it off for you. Open Gmail settings, go to Forwarding, and remove the address.')) + '</span></div>' +
          '<a class="btn-line" href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener">' +
            _esc(L('Mở cài đặt chuyển tiếp', 'Open forwarding settings')) + '</a>'
        : '') +

      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
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
    /* The scope rides in the signed state, not just this query string: the
       callback is what calls grant_mailbox_access, and it must not take a
       destination from a URL the person could have been sent. */
    q.set('scope', _atxScopeIs());
    q.set('backfill_days', String(_atxDays));

    /* JSON, not a redirect we follow. The endpoint answers 302 to Google for a
       plain navigation, but this call carries a Bearer token so it has to be a
       fetch — and a cross-origin fetch can do neither useful thing with that
       302: following it makes the browser request accounts.google.com as a
       fetch, which Google refuses, and `redirect: "manual"` yields an
       OPAQUE-REDIRECT response whose headers the Fetch Standard filters out
       entirely, so `Location` reads back as null no matter what the server
       exposes. Asking for JSON sidesteps both: we get the URL as data and do
       the navigating ourselves, which is what the consent screen needs anyway. */
    const res = await fetch(
      _ATX_API + '/authorize?' + q.toString(),
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      }
    );

    if (res.status === 401) {
      throw Object.assign(new Error('unauthorised'), {
        fhMsg: L('Phiên đăng nhập đã hết hạn, đăng nhập lại nhé',
                 'Your session expired — please sign in again') });
    }
    if (!res.ok) {
      throw Object.assign(new Error('authorize failed: ' + res.status), {
        fhMsg: L('Chưa mở được Google, thử lại nhé',
                 'Could not open Google — try again') });
    }

    const body = await res.json().catch(() => null);
    const target = body && body.url;
    if (!target) {
      throw Object.assign(new Error('authorize: no url in response'), {
        fhMsg: L('Chưa mở được Google, thử lại nhé',
                 'Could not open Google — try again') });
    }
    return target;
  }

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
    // Opened before anything is awaited: this is the only moment the tap is
    // still a live user gesture, and a cross-origin navigation issued after an
    // await is cancelled without a word.
    const win = _atxOpenBlank();
    try {
      _atxNavigate(win, await _atxConsentUrl(_atxLoginEmail()));
      return;                                   // navigating: leave the button as it is
    } catch (e) {
      // A blank tab left open reads as a second failure on top of the reported one.
      if (win && !win.closed) try { win.close(); } catch (e2) {}
      window.toast && window.toast(window._fhFriendly ? window._fhFriendly(e)
        : ((e && e.fhMsg) || L('Chưa mở được Google, thử lại nhé', 'Could not open Google — try again')));
      try { console.warn('[autotxn] consent url failed:', e && (e.message || e)); } catch (e2) {}
    } finally {
      if (!_atxLeaving) reset();
    }
  };

  /* Handing off to Google, and why the window is opened BEFORE the URL exists.

     THE BUG THIS FIXES. The consent URL now comes from the API, so getting it
     costs a token read plus a network round trip. That await is the problem:
     `location.assign()` to a cross-origin URL is only honoured while a user
     gesture is still in scope, and an await spends it. The navigation is then
     CANCELLED — silently, with no throw and no event, so the tab simply sits
     there looking frozen. (This is the same hazard the old code called out for
     `window.open`; it did not bite then because the URL was assembled
     synchronously, with nothing awaited before the assign.)

     WHAT WE DO INSTEAD. Open a blank tab synchronously, inside the click, while
     the gesture is unquestionably live — a popup with no URL yet is allowed —
     then set its `location` once the API answers. The gesture is spent on
     `window.open`, not on the navigation, so the await no longer matters.

     `noopener` is set the hard way, via `opener = null` after opening: passing
     "noopener" to window.open makes it return null, and we need the handle to
     point it anywhere. Clearing `opener` gives the same protection — the
     consent page cannot reach back into this one.

     IF THE POPUP IS BLOCKED, `open` returns null and we fall back to a
     same-tab assign. That assign may itself be cancelled for the reason above,
     which is exactly what the watchdog below is for: if we are still on this
     page shortly after, the CTA becomes a real anchor. A link the person taps
     is a fresh gesture, which every platform honours. */
  let _atxLeaving = false;

  function _atxNavigate(win, url) {
    _atxLeaving = true;
    if (win && !win.closed) {
      try { win.location.replace(url); return; } catch (e) { /* fall through */ }
    }
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
      a.target = '_blank';
      a.textContent = L('Mở màn hình Google', 'Open the Google screen');
      btn.parentNode.replaceChild(a, btn);
    }, 1500);
  }

  /* Opened inside the click handler, before anything is awaited. Returns null
     when the popup blocker refuses, which the caller treats as "navigate this
     tab instead" rather than as a failure. */
  function _atxOpenBlank() {
    try {
      const w = window.open('', '_blank');
      if (w) w.opener = null;
      return w;
    } catch (e) { return null; }
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

  /* ── the live half of the success screen ───────────────────────────────────
     "Đã kết nối" used to be a static sheet: it said the first pass could take a
     while and then sat there, while the first rows landed sixty seconds later
     with nothing on screen moving. The person's read of that minute was "it
     didn't work" — measured on a real connect, and the reason this screen now
     watches the queue while it is open.

     WHY A POLL AND NOT fhRefreshStagedCount ON A TIMER: that helper answers by
     fetching every pending row's sealed payload — right after a promote, wrong
     on a four-second cadence. This asks for a HEAD-only count: one round trip,
     no ciphertext. 0058/0092's RLS scopes it to the caller's own rows, so it is
     safe for any signed-in user and [] is a real answer.

     WHEN IT STOPS, because a poll that cannot stop is a leak: a newer watcher
     (seq), the sheet closing or another sheet replacing this one, or the
     3-minute window passing — enough for the connect-time kick plus the
     once-a-minute backfill lane to have landed whatever a first run finds.
     On the way out it runs the real refresh once, so the badge the person
     lands on agrees with what this screen just told them. */
  const _atxFrontKey = (gid) => 'fh-atx-frontier:' + gid;

  async function _atxFrontier(gid) {
    let floor = null;
    try { floor = localStorage.getItem(_atxFrontKey(gid)) || null; } catch (e) {}
    try {
      const res = await sb.from('email_transactions')
        .select('occurred_at')
        .eq('review_status', 'pending')
        .order('occurred_at', { ascending: true })
        .limit(1);
      const oldest = !res.error && res.data && res.data[0] && res.data[0].occurred_at;
      if (oldest && (!floor || String(oldest) < String(floor))) {
        floor = oldest;
        try { localStorage.setItem(_atxFrontKey(gid), floor); } catch (e) {}
      }
    } catch (e) { /* keep the floor; a missed poll must not rewind the screen */ }
    return floor;
  }

  /* Days between the frontier and today, clamped into the window. Never
     negative, never past the window, so the bar cannot overrun its track. */
  function _atxDaysRead(frontIso, windowDays) {
    if (!frontIso) return 0;
    const t = Date.parse(frontIso);
    if (!t) return 0;
    const d = Math.round((Date.now() - t) / 86400000);
    return Math.max(0, Math.min(windowDays, d));
  }

  /* ── what just landed ──────────────────────────────────────────────────────
     Liveness, not content. The progress card answers "how much longer"; this
     answers "is it actually working", which a bar alone never quite does.

     COSTS NO DECRYPTION, and that is not luck. `source_provider` deliberately
     stays CLEAR because dedup compares bank names fuzzily and a hash matches
     only exactly; `occurred_at` stays clear because dedup queries a range; and
     `created_at` is workflow metadata. The AMOUNT is the one thing inside the
     sealed box, so it is the one thing this list does not show — which is fine,
     because "we just found a Highlands charge from 9 thg 8" already proves the
     pipeline is alive.

     ORDERED BY created_at, NOT occurred_at. During a backfill those disagree by
     design: the read marches backwards, so the most recently STAGED row is the
     OLDEST transaction. created_at is what "vừa tìm thấy" actually means, and
     it stays correct in steady state too, where new mail really is newest. */
  async function _atxRecentFinds() {
    try {
      const res = await sb.from('email_transactions')
        .select('id,source_provider,occurred_at')
        .eq('review_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(3);
      if (res.error) return [];
      return res.data || [];
    } catch (e) { return []; }
  }

  const _atxInitials = (name) => String(name || '?')
    .replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 2).toUpperCase() || '?';

  function _atxFeedHTML(rows) {
    if (!rows || !rows.length) return '';
    return '<div class="atx-fd"><div class="atx-fd-h"><span class="atx-fd-dot"></span>' +
      _esc(L('Vừa tìm thấy', 'Just found')) + '</div>' +
      rows.map(function (r) {
        /* fhProviderName folds "vib"/"MBBank" into the household spelling the
           rest of the app uses; falls through to the raw string when absent. */
        const name = (window.fhProviderName ? window.fhProviderName(r.source_provider || '') : '')
          || r.source_provider || L('Giao dịch', 'Transaction');
        const when = r.occurred_at ? fmtDayMon(new Date(r.occurred_at)) : '';
        return '<div class="atx-fd-row"><span class="atx-fd-ic">' + _esc(_atxInitials(name)) + '</span>' +
          '<span class="atx-fd-t">' + _esc(name) + '</span>' +
          '<span class="atx-fd-d">' + _esc(when) + '</span></div>';
      }).join('') +
      '<div class="atx-fd-f"><span class="atx-fd-dot"></span>' +
      _esc(L('Đang đọc ngược về trước…', 'Reading further back…')) + '</div></div>';
  }

  /* The progress block, shared by the connect screen and the status screen so
     the two can never tell different stories. Rendered from a plain state
     object, and repainted in place by the live watcher. */
  /* The count and the frontier date, as their own fragment: the in-place
     painter below rewrites just this line, so the numbers can change without
     the bar losing its transition. */
  function _atxProgressSub(st) {
    if (st.phase === 'done') {
      return _esc(st.found > 0
        ? L('<n> khoản đang chờ bạn duyệt.',
            st.found === 1 ? '<n> transaction waiting for you.' : '<n> transactions waiting for you.')
        : L('Không có khoản nào trong khoảng này.', 'Nothing to review in that stretch.'))
        .replace('&lt;n&gt;', '<b class="atx-pg-c">' + st.found + '</b>');
    }
    const day = st.front ? fmtDayMon(new Date(st.front)) : '';
    const cnt = '<b class="atx-pg-c">' + st.found + '</b>';
    if (st.phase === 'slow') {
      return st.front
        ? _esc(L('Tới ' + day + ' · ', 'To ' + day + ' · ')) + cnt +
          _esc(L(' khoản sẵn sàng để duyệt', ' ready to review'))
        : cnt + _esc(L(' khoản sẵn sàng để duyệt', ' ready to review'));
    }
    return st.front
      ? _esc(L('Đã đọc tới ' + day + ' · tìm được ', 'Back to ' + day + ' · ')) + cnt +
        _esc(L(' khoản', ' found'))
      : _esc(L('Đang dò hộp thư của bạn…', 'Looking through your mailbox…'));
  }

  function _atxProgressHTML(st) {
    const w = st.windowDays, d = st.daysRead;
    const pct = st.phase === 'done' ? 100 : (w > 0 ? Math.min(100, Math.round(d / w * 100)) : 0);
    const title = st.phase === 'done' ? L('Đã đọc xong ' + w + ' ngày qua', 'All ' + w + ' days read')
                : st.phase === 'slow' ? L('Đã đọc tới đây', 'Read this far')
                : L('Đang đọc ' + w + ' ngày qua', 'Reading your last ' + w + ' days');
    /* The bar STOPS and greys on a stall: a bar still creeping while the copy
       says the queue is ready is the contradiction this state exists to remove. */
    const fillCls = st.phase === 'done' ? ' done' : (st.phase === 'slow' ? ' halt' : '');
    return '<div class="atx-pg' + (st.phase === 'done' ? ' done' : '') + '" data-phase="' + st.phase + '">' +
      '<div class="atx-pg-top"><span class="atx-pg-t">' + _esc(title) + '</span>' +
      (st.phase === 'done' ? '' :
        '<span class="atx-pg-n">' + d + '/' + w + _esc(L(' ngày', ' days')) + '</span>') + '</div>' +
      '<div class="atx-pg-track"><i class="atx-pg-fill' + fillCls + '" style="width:' + pct + '%"></i></div>' +
      '<div class="atx-pg-sub">' + _atxProgressSub(st) + '</div></div>';
  }

  /* PATCHES IN PLACE, and that is the whole point. Replacing the card's
     innerHTML gives the new <i> no from-state, so `transition: width` never
     runs and the bar teleports — which is most of why the screen read as
     frozen even while the numbers were correct. Same reason the count is
     rewritten rather than re-created: an element that survives can be animated.

     A phase change restructures the card (the fraction disappears on 'done'),
     so that one case still rebuilds. */
  function _atxProgressPaint(host, st, bump) {
    if (!host) return;
    const card = host.querySelector ? host.querySelector('.atx-pg') : null;
    if (!card || card.getAttribute('data-phase') !== st.phase) {
      host.innerHTML = _atxProgressHTML(st);
      return;
    }
    const w = st.windowDays, d = st.daysRead;
    const pct = w > 0 ? Math.min(100, Math.round(d / w * 100)) : 0;
    const fill = card.querySelector('.atx-pg-fill');
    if (fill) fill.style.width = pct + '%';
    const n = card.querySelector('.atx-pg-n');
    if (n) n.textContent = d + '/' + w + L(' ngày', ' days');
    const sub = card.querySelector('.atx-pg-sub');
    if (sub) sub.innerHTML = _atxProgressSub(st);
    /* Re-trigger the count's pop. Removing the class and forcing a reflow is
       what lets the same animation replay on a second increment. */
    if (bump) {
      card.classList.remove('tick');
      void card.offsetWidth;
      card.classList.add('tick');
    }
  }

  const _atxConnFrontier = (conn) => (conn && conn.id) ? _atxFrontier(conn.id) : Promise.resolve(null);

  /* One read of everything the two screens need. */
  async function _atxProgressState(conn) {
    const windowDays = (conn && conn.backfillDays) || ATX_DEFAULT_DAYS;
    let found = 0, front = null, finds = [];
    try { found = await _atxPendingCount(); } catch (e) {}
    if (conn && conn.id) { try { front = await _atxFrontier(conn.id); } catch (e) {} }
    if (found > 0 && (!conn || conn.phase === 'reading')) finds = await _atxRecentFinds();
    _atxProgressCache = { phase: (conn && conn.phase) || 'reading', windowDays: windowDays,
             found: found, front: front, finds: finds,
             daysRead: _atxDaysRead(front, windowDays) };
    return _atxProgressCache;
  }

  let _atxLiveSeq = 0;

  async function _atxPendingCount() {
    const res = await sb.from('email_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'pending');
    if (res.error) throw res.error;
    return (typeof res.count === 'number') ? res.count : 0;
  }

  const _atxLiveLine = (n) => L(
    'Tìm được ' + n + ' khoản, đang chờ bạn duyệt.',
    n === 1 ? 'Found 1 transaction, waiting for your review.'
            : 'Found ' + n + ' transactions, waiting for your review.');

  function _atxLiveWatch() {
    const seq = ++_atxLiveSeq;
    const t0 = Date.now();
    let last = 0;
    /* Closing the sheet DEMOTES the watcher instead of killing it (2026-09-05
       v2): the person who connects and closes at five seconds is exactly the
       one whose rows land at ten, and stopping cold meant their badge stayed
       blank until the next refocus — the original complaint, back in a smaller
       coat. Badge mode keeps the same cheap head count, touches only the badge
       surfaces, never the sheet's DOM, and dies with the same 3-minute window.
       A demotion is one-way: a sheet that reopens starts its own watcher, and
       the seq bump retires this one. */
    let badgeOnly = false, lastPhase = 'reading', lastState = null;
    (async function tick() {
      if (seq !== _atxLiveSeq) return;
      /* THE LIVENESS PROBE MUST BE AN ELEMENT BOTH SHEETS HAVE. This keyed on
         `#atx-live` — which only fhAutoTxnDone renders — so opening the STATUS
         sheet mid-backfill demoted the watcher to badge-only on its first tick
         and the progress card never repainted. The count moved only on the
         screen behind the sheet, which is exactly how it was reported: "I only
         know there's an update when I dismiss the bottom sheet."
         `#atx-pg` is on both. */
      const el = document.getElementById('atx-live');       // connect sheet only; may be null
      const pg = document.getElementById('atx-pg');
      const sheet = document.getElementById('fh-sheet');
      if (!pg || !sheet || !sheet.classList.contains('on')) badgeOnly = true;
      if (!document.hidden) {
        try {
          /* The GRANT is asked every tick, the frontier only when the count
             moved. backfilled_at can flip on a run that stages nothing — the
             last chunk of a window often does — so waiting for a count change
             to notice completion would leave the screen reading forever. The
             frontier, by contrast, only moves when a row lands. */
          const conn = await _atxConnection();
          const n = await _atxPendingCount();
          if (seq !== _atxLiveSeq) return;
          const phase = (conn && conn.phase) || 'reading';
          const changed = (n !== last) || (phase !== lastPhase);
          if (changed) {
            const front = (n !== last || !lastState)
              ? await _atxConnFrontier(conn) : lastState.front;
            const finds = (phase === 'reading' && n > 0 && (n !== last || !lastState))
              ? await _atxRecentFinds()
              : (phase === 'reading' && lastState ? lastState.finds : []);
            if (seq !== _atxLiveSeq) return;
            const w = (conn && conn.backfillDays) || ATX_DEFAULT_DAYS;
            lastState = { phase: phase, windowDays: w, found: n, front: front, finds: finds,
                          daysRead: _atxDaysRead(front, w) };
            _atxProgressCache = lastState;         // the row paints from this
            last = n; lastPhase = phase;
            if (!badgeOnly) {
              _atxProgressPaint(document.getElementById('atx-pg'), lastState, true);
              /* Cleared on completion rather than frozen: "vừa tìm thấy" is a
                 liveness signal, and a stale one outliving the work it reported
                 is the kind of detail that quietly stops being believed. */
              const fd = document.getElementById('atx-feed');
              if (fd) fd.innerHTML = _atxFeedHTML(lastState.finds);
              /* The CTA is BORN here, never merely relabelled: it does not
                 exist while the phase is 'reading', so there is nothing to tap
                 by accident during the one stretch when tapping is wrong. */
              const cta = document.getElementById('atx-live-cta');
              if (cta) {
                const open = (phase === 'done' || phase === 'slow') && n > 0 && window.fhTxnReviewSheet;
                const want = open
                  ? '<button class="cta" onclick="fhTxnReviewSheet()">' + _esc(L('Xem ' + n + ' khoản',
                      n === 1 ? 'Review 1 transaction' : 'Review ' + n + ' transactions')) + '</button>'
                  : '';
                if (cta.innerHTML !== want) cta.innerHTML = want;
              }
            }
            /* The two badge surfaces read window.fhStagedCount; set it directly
               rather than through fhRefreshStagedCount for the reason above. */
            window.fhStagedCount = n;
            try { if (typeof window.renderCashflowEmailCta === 'function') window.renderCashflowEmailCta(); } catch (e) {}
            try { if (typeof window.renderPersonal === 'function') window.renderPersonal(); } catch (e) {}
          }
        } catch (e) { /* one missed tick; the next asks again */ }
      }
      const elapsed = Date.now() - t0;
      if (elapsed < 3 * 60 * 1000) {
        /* Eager while the first find is still owed and the kick is landing —
           rows arrive 0–8s in, and at a flat 4s the person could stare at
           "đang dò" for four extra beats. Once something is found (or the
           eager window passes) the number only moves as backfill chunks land,
           and 4s is plenty. */
        setTimeout(tick, (last <= 0 && elapsed < 20 * 1000) ? 1500 : 4000);
        return;
      }
      /* Window over. One REAL refresh either way, so the badge reconciles with
         everything this watcher's head count cannot see (retire filtering, a
         promote from another device). */
      try { window.fhRefreshStagedCount && window.fhRefreshStagedCount(); } catch (e) {}
      if (!badgeOnly && last <= 0 && el) {
        // Three quiet minutes is an answer too: say so instead of ellipsing forever.
        el.innerHTML = _mbxGlyph('mail') + '<span>' + _esc(L(
          'Chưa thấy khoản nào. Tụi mình vẫn tìm tiếp, bạn cứ đóng màn hình này.',
          'Nothing yet. We’re still looking, and it’s fine to close this screen.')) + '</span>';
      }
    })();
  }

  /* The push offer, resolved BEFORE the sheet renders — 71's rule, same reason:
     a control that appears a beat late reads as a glitch. _mbxPushRow lives in
     71-mailbox-ui.js (this module, earlier file); it answers '' for every state
     where there is nothing to offer, and so does this wrapper when the row
     builder is missing or throws — a missing offer must never cost the screen. */
  async function _atxPushRowSafe() {
    try {
      return (typeof _mbxPushRow === 'function') ? ((await _mbxPushRow()) || '') : '';
    } catch (e) { return ''; }
  }

  async function fhAutoTxnDone(state) {
    if (state === 'connected') {
      /* WHY THE OFFER IS ON THIS SCREEN AT ALL: push used to be offered only on
         the FORWARDING status sheet and after a first hand-review — so a person
         who connected by OAuth had no subscription, and the "something is
         waiting" push the worker sends for every later arrival landed nowhere.
         The nudge meant to save them from checking by hand was gated behind
         having already checked by hand. This is the moment the feature earns
         the right to ask. Offer only — the tap is theirs (iOS gesture rule). */
      const seq = ++_atxSheetSeq;
      const pushRow = await _atxPushRowSafe();
      if (seq !== _atxSheetSeq) return;      // another screen took over meanwhile
      _fhSheet(
        '<div class="mbx-hero">' + _mbxGlyph('done') + '</div>' +
        '<div class="sheet-h">' + _esc(L('Đã kết nối', 'Connected')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L(
          'Tụi mình bắt đầu tìm email giao dịch. Khoản nào tìm được sẽ nằm chờ bạn trong mục Duyệt giao dịch, không tự vào sổ.',
          'We’ve started looking for transaction email. Anything we find waits for you in Review transactions, and never enters the ledger on its own.')) + '</div>' +
        '<div id="atx-pg">' + _atxProgressHTML(
          { phase: 'reading', windowDays: ATX_DEFAULT_DAYS, found: 0, front: null, daysRead: 0 }) + '</div>' +
        '<div id="atx-feed"></div>' +
        /* NO primary CTA while the first read is running, and the slot stays
           EMPTY rather than disabled (DESIGN §4.4 — never a dead button). The
           queue is not merely unhelpful mid-backfill, it is wrong: the review
           screen's duplicate bucketing compares the rows it fetched, so a row
           whose twin has not been staged yet is never flagged and both halves
           of one purchase get imported. _atxLiveWatch fills this in the moment
           the phase leaves 'reading'. */
        '<div id="atx-live-cta"></div>' +
        '<div class="mbx-note" id="atx-live">' + _mbxGlyph('check') + '<span>' + _esc(L(
          'Cứ đóng lại dùng app bình thường nhé, tụi mình vẫn đọc tiếp và báo bạn khi xong.',
          'Feel free to close this and carry on. We keep reading, and we’ll tell you when it’s done.')) + '</span></div>' +
        pushRow +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
      );
      _atxLiveWatch();
      return;
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
  /* ── the phase has to be known on a cold open, not only after a connect ────
     Someone who closes the app mid-backfill and comes back two minutes later
     gets a fresh page: nothing has called _atxConnection, so the row would
     paint its ordinary badge and route straight into a queue that is still
     filling — the hold would hold only for the person who never left. So one
     grant read at boot, and if a first pass is still running, the same live
     watcher the connect screen uses (it demotes to badge-only on its own when
     no sheet is open).

     Deliberately after hydrate and wrapped: this owns its own timing and must
     never be able to cost anyone their boot. A user with no mailbox pays one
     tiny select that returns no rows. */
  (function _atxBootPhase() {
    const t0 = Date.now();
    (function wait() {
      if (window.DB && window.DB._hydrated && window.fhUser) {
        (async function () {
          try {
            const conn = await _atxConnection();
            if (!conn || conn.phase !== 'reading') return;
            await _atxProgressState(conn);
            try { if (typeof window.renderCashflowEmailCta === 'function') window.renderCashflowEmailCta(); } catch (e) {}
            try { if (typeof window.renderPersonal === 'function') window.renderPersonal(); } catch (e) {}
            _atxLiveWatch();
          } catch (e) {}
        })();
        return;
      }
      if (Date.now() - t0 > 20000) return;
      setTimeout(wait, 400);
    })();
  })();

  (function _atxBootReturn() {
    const state = _atxReturnState();          // read + eat immediately, before any await
    if (!state) return;
    const t0 = Date.now();
    (function _wait() {
      if (window.DB && window.DB._hydrated && window.fhUser) {
        // fhAutoTxnDone is async now (it resolves the push offer pre-render), so
        // the guard has to cover the rejection too, not just a synchronous throw.
        try { const p = fhAutoTxnDone(state); if (p && p.catch) p.catch(function () {}); } catch (e) {}
        return;
      }
      if (Date.now() - t0 > 20000) return;
      setTimeout(_wait, 400);
    })();
  })();
  