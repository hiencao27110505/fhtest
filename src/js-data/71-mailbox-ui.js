  // ═══ bank-email: connect a mailbox ════════════════════════════════════════
  /* Settings → "Connect bank email". Gives a member their own forwarding alias
     and walks them through pointing Gmail at it; once connected, bank/receipt
     emails they forward are extracted and land in their review queue.

     Runs on the app's own bottom sheet (DESIGN §4) — the same layer every other
     Settings sub-journey uses (Money encryption, Devices, Install), so it reads
     as one of the family rather than a bolted-on wizard. Three sheets, one job
     each: the offer → the address → the status. Each _fhSheet call replaces the
     body, so the journey is a sequence of full sheets, not nested panels.

     Server side (all live): 0059 issues the alias, an Apps Script auto-clicks
     Gmail's confirmation email, and the pipeline routes on the +tag. The user
     never handles a confirmation email — that is the whole point of auto-confirm,
     so the copy must never send them looking for one.

     The address is assembled HERE from tag + inbox domain, deliberately: the
     shared Gmail inbox is temporary, and moving to an owned domain later should
     be a one-constant change, not a data migration. */

  const FH_TXN_INBOX = 'gichisreading@gmail.com';   // shared receiving inbox; swap for the owned domain when it exists

  /* Inline SVG line glyphs — DESIGN §2.6 (UI icons are SVG, stroke 1.9–2.4,
     round caps; never emoji as a functional icon). currentColor inherits the
     chip's tint so one glyph set works on every surface. */
  const _MBX_SVG = {
    mail:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="5.5" width="17.6" height="13" rx="2.8"/><path d="M4.4 7.8 12 13l7.6-5.2"/></svg>',
    lock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/><circle cx="12" cy="15.4" r="1.15" fill="currentColor" stroke="none"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.7-5.1"/></svg>',
    fwd:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5 19 12l-6 5.5"/><path d="M19 12H8.5a4.5 4.5 0 0 0-4.5 4.5V18"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
    done:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4 4 10-10.5"/></svg>',
    bell:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15.4V11a6 6 0 1 0-12 0v4.4L4.6 17.9h14.8z"/><path d="M10 20.4a2.2 2.2 0 0 0 4 0"/></svg>',
  };
  const _mbxGlyph = (k) => _MBX_SVG[k] || '';

  function fhAliasAddress(tag) {
    if (!tag) return null;
    const [user, domain] = FH_TXN_INBOX.split('@');
    return user + '+' + tag + '@' + domain;
  }

  async function fhMailboxState() {
    try { return await _rpc('get_my_mailbox_alias', {}); }
    catch (e) { return null; }
  }
  window.fhMailboxState = fhMailboxState;

  /* Entry point. Reads state first so a member who already connected lands on
     status, not back at the top of setup. */
  window.fhMailboxSheet = async function () {
    const st = await fhMailboxState();
    if (st && st.forwarding_alias) {
      /* Retro consent (0082): the four grandfathered connections predate the
         consent sheet. Ask once here, on the screen they do revisit; "Để sau"
         closes and re-asks next visit rather than cutting a working
         connection — a deliberate soft retry, recorded in PDPL-COMPLIANCE. */
      if (window.fhConsentEnsure) {
        const ok = await window.fhConsentEnsure(() => fhMailboxStatus(st));
        if (!ok) return;
      }
      return fhMailboxStatus(st);
    }
    return fhMailboxIntro();
  };

  // ── Sheet 1 · the offer ────────────────────────────────────────────────────
  function fhMailboxIntro() {
    _fhSheet(
      '<div class="mbx-hero">' + _mbxGlyph('mail') + '</div>' +
      '<div class="sheet-h">' + _esc(L('Tự động ghi chi tiêu từ email', 'Log spending from email')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Ngân hàng gửi email sau mỗi giao dịch. Chuyển tiếp những email đó cho Earthy — tụi mình đọc giúp, bạn chỉ việc duyệt.',
        'Your bank emails you after each transaction. Forward those to Earthy — we read them for you, and you just review.')) + '</div>' +

      '<div class="mbx-assure">' +
        /* Worded to the honest ceiling in SEALED-STAGING-DESIGN §1, not past
           it. "Not even we can read them" claimed more than web-delivered E2EE
           can deliver (operator key swaps are DETECTED, not prevented, and the
           forwarded email transits a shared inbox before it is sealed and the
           inbox copy is deleted). What is true: stored transactions are sealed
           to keys only the family's devices hold. Say that. */
        _mbxAssure('lock', L('Chỉ gia đình bạn mở được', 'Only your family can open it'),
          L('Giao dịch được niêm phong khi lưu trữ, chỉ thiết bị của gia đình bạn mở được. Email đã xử lý sẽ được xoá khỏi hộp thư trung gian.',
            'Transactions are sealed in storage, and only your family\'s devices can open them. Processed emails are deleted from the relay inbox.')) +
        _mbxAssure('check', L('Bạn duyệt trước khi vào sổ', 'Nothing is added without you'),
          L('Không khoản nào tự động vào sổ chi tiêu của gia đình.',
            'No transaction enters your family ledger until you approve it.')) +
        _mbxAssure('fwd', L('Chỉ những email bạn chuyển', 'Only what you forward'),
          L('Tụi mình không đụng vào hộp thư của bạn.',
            'We never touch your mailbox — only the emails you send us.')) +
      '</div>' +

      '<button class="cta" onclick="fhMailboxWhichEmail()">' + _esc(L('Bắt đầu', 'Get started')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  }

  // ── Sheet 1b · which email forwards ────────────────────────────────────────
  /* The forwarder-identity fix (AGENT_SYNC 2026-08-16). personal_email is what
     checkSenderAuthenticity compares against the ADDRESS THAT FORWARDED the
     mail — but it used to be filled with the login email silently, and the two
     differ whenever someone's bank alerts go to a different mailbox (the live
     case: login gichisreading@, forwarding from trang.nguyen.wh@). The moment
     SENDER_AUTH_ENFORCE turns on, that mismatch silently blocks every message.
     So: one prefilled, editable field. Most people tap straight through with
     the default; the ones who forward from elsewhere fix it here, once.
     Also reachable from the status sheet to correct an existing connection —
     the RPC refreshes personal_email on an already-issued alias (0059). */
  window.fhMailboxWhichEmail = function (mode) {
    const login = (window.FAM && window.FAM.user && window.FAM.user.email) || '';
    const update = mode === 'update';
    _fhSheet(
      '<div class="sheet-h">' + _esc(L('Email nào nhận thông báo ngân hàng?', 'Which email gets your bank alerts?')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Bạn sẽ chuyển tiếp từ email mà ngân hàng đang gửi thông báo tới. Nếu không phải email đăng nhập, sửa lại giúp tụi mình nhé.',
        'You will be forwarding from the email your bank sends alerts to. If that is not your login email, change it here.')) + '</div>' +
      '<div class="field"><label>' + _esc(L('Email nhận thông báo', 'Email that gets the alerts')) + '</label>' +
      '<input id="fh-mbx-email" type="email" inputmode="email" autocapitalize="none" spellcheck="false" value="' + _escAttr(login) + '"></div>' +
      '<button class="cta" onclick="fhMailboxStart(this' + (update ? ',null,\'update\'' : '') + ')">' +
        _esc(update ? L('Lưu địa chỉ', 'Save address') : L('Tiếp tục', 'Continue')) + '</button>' +
      '<button class="btn-skip" onclick="' + (update ? 'fhMailboxSheet()' : '_closeOv()') + '">' +
        _esc(update ? L('Quay lại', 'Back') : L('Để sau', 'Not now')) + '</button>'
    );
  };

  function _mbxAssure(icon, title, sub) {
    return '<div class="mbx-assure-row">' +
      '<div class="mbx-ic">' + _mbxGlyph(icon) + '</div>' +
      '<div class="mbx-txt"><div class="mbx-rt">' + _esc(title) + '</div>' +
      '<div class="mbx-rs">' + _esc(sub) + '</div></div></div>';
  }

  /* Issues the alias (idempotent server-side) and moves to the address sheet.
     personal_email lets the pipeline confirm forwarded mail really came through
     this member's mailbox. Shows progress on the tapped CTA — the RPC is a real
     round trip and must not look frozen (DESIGN §4.2). */
  window.fhMailboxStart = async function (btn, emailOverride, mode) {
    /* PDPL consent gates BEFORE anything is issued or provisioned (0071,
       docs/PDPL-COMPLIANCE.md). If the sheet has to be shown, this call ends
       here and the agree action re-enters the flow with the same intent. The
       field value is captured now because the sheet replaces this markup. */
    if (window.fhConsentEnsure) {
      const _f = document.getElementById('fh-mbx-email');
      const _kept = (_f && _f.value.trim()) || emailOverride;
      const consented = await window.fhConsentEnsure(() => window.fhMailboxStart(null, _kept, mode));
      if (!consented) return;
    }
    // The field is the source of truth when the which-email sheet is up;
    // emailOverride and the login address are fallbacks for older call sites.
    const field = document.getElementById('fh-mbx-email');
    const email = (field && field.value.trim()) || emailOverride ||
                  (window.FAM && window.FAM.user && window.FAM.user.email) || null;
    // Enough validation to catch a paste gone wrong; the real proof of the
    // address is a forwarded email actually arriving, never a regex.
    if (!email || !/.+@.+\..+/.test(email)) {
      window.toast && window.toast(L('Địa chỉ email chưa đúng, bạn xem lại nhé',
                                     'That email does not look right, check it again'));
      return;
    }
    const btnLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = L('Đang lưu…', 'Saving…'); }

    /* A family without a staging keypair cannot use this flow — decided
       2026-08-16: the pipeline HOLDS mail for keyless families rather than ever
       writing it readable, so connecting before keys exist would only queue
       mail into limbo. Provisioning needs the unlocked DEK (the one moment the
       private key can be wrapped), so a locked device stops here with the
       honest reason instead of handing out an address that cannot work yet. */
    if (window.fhStagingEnsureKeypair) {
      try {
        if (!window.fhKeyReady || !window.fhKeyReady()) {
          if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
          window.toast && window.toast(L('Hãy mở khoá ứng dụng trước, rồi thử lại nhé',
                                         'Unlock the app first, then try again'));
          return;
        }
        await window.fhStagingEnsureKeypair();
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        window.toast && window.toast(L('Chưa chuẩn bị được khoá bảo mật, thử lại nhé',
                                       'Could not prepare your security keys, try again'));
        return;
      }
    }

    let res;
    try {
      res = await _rpc('get_or_create_mailbox_alias', { p_personal_email: email });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
      window.toast && window.toast(L('Chưa tạo được địa chỉ, thử lại nhé', 'Could not create your address — try again'));
      return;
    }
    if (mode === 'update') {
      window.toast && window.toast(L('Đã cập nhật địa chỉ chuyển tiếp', 'Forwarding address updated'));
      window.fhMailboxSheet();
      return;
    }
    fhMailboxSetup(res.forwarding_alias);
  };

  // ── Sheet 2 · the address ──────────────────────────────────────────────────
  function fhMailboxSetup(tag) {
    const addr = fhAliasAddress(tag);
    _fhSheet(
      '<div class="sheet-h">' + _esc(L('Địa chỉ riêng của bạn', 'Your private address')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Trong Gmail, chuyển tiếp email ngân hàng tới địa chỉ này. Nó là của riêng bạn.',
        'In Gmail, forward your bank emails to this address. It belongs to you alone.')) + '</div>' +

      '<button class="mbx-addr" onclick="fhMailboxCopy(this,\'' + _escAttr(addr) + '\')">' +
        '<code class="mbx-addr-val">' + _esc(addr) + '</code>' +
        '<span class="mbx-addr-copy" id="mbx-copy">' +
          '<span class="mbx-addr-ic">' + _mbxGlyph('copy') + '</span>' +
          '<span class="mbx-addr-lbl">' + _esc(L('Sao chép', 'Copy')) + '</span>' +
        '</span>' +
      '</button>' +

      '<div class="mbx-steps">' +
        _mbxStep(1, L('Mở Cài đặt Gmail → Chuyển tiếp', 'Open Gmail Settings → Forwarding'),
          L('Dán địa chỉ trên vào ô "Thêm địa chỉ chuyển tiếp".',
            'Paste the address into "Add a forwarding address".')) +
        _mbxStep(2, L('Tạo bộ lọc cho email ngân hàng', 'Create a filter for bank emails'),
          L('Lọc theo địa chỉ ngân hàng, rồi chọn "Chuyển tiếp tới" địa chỉ trên.',
            'Filter by your bank’s address, then "Forward it to" the address above.')) +
      '</div>' +

      '<div class="mbx-note">' + _mbxGlyph('check') + '<span>' + _esc(L(
        'Gmail sẽ gửi một email xác nhận — tụi mình tự xác nhận giúp, bạn không cần làm gì thêm.',
        'Gmail sends a confirmation email — we confirm it for you, nothing more to do.')) + '</span></div>' +

      '<a class="cta" href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener">' +
        _esc(L('Mở cài đặt Gmail', 'Open Gmail settings')) + '</a>' +
      '<button class="btn-skip" onclick="fhMailboxSheet()">' + _esc(L('Tôi đã thiết lập xong', 'I’ve set it up')) + '</button>'
    );
  }

  function _mbxStep(n, title, sub) {
    return '<div class="mbx-step"><div class="mbx-step-n">' + n + '</div>' +
      '<div class="mbx-txt"><div class="mbx-step-t">' + _esc(title) + '</div>' +
      '<div class="mbx-step-s">' + _esc(sub) + '</div></div></div>';
  }

  /* This file is js-data (ES module scope), so a bare function is NOT a global —
     and the status sheet reaches this one from an inline onclick. Without the
     bridge "Show the steps again" threw ReferenceError and did nothing, for every
     member who had already connected. See CLAUDE.md §3. */
  window.fhMailboxSetup = fhMailboxSetup;

  window.fhMailboxCopy = async function (btn, addr) {
    try { await navigator.clipboard.writeText(addr); } catch (e) { /* fall through to the label swap */ }
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
    const el = document.getElementById('mbx-copy');
    if (btn) btn.classList.add('is-copied');
    if (el) {
      el.innerHTML = '<span class="mbx-addr-ic">' + _mbxGlyph('done') + '</span>' +
        '<span class="mbx-addr-lbl">' + _esc(L('Đã sao chép', 'Copied')) + '</span>';
      setTimeout(() => {
        if (btn) btn.classList.remove('is-copied');
        const e2 = document.getElementById('mbx-copy');
        if (e2) e2.innerHTML = '<span class="mbx-addr-ic">' + _mbxGlyph('copy') + '</span>' +
          '<span class="mbx-addr-lbl">' + _esc(L('Sao chép', 'Copy')) + '</span>';
      }, 1700);
    }
  };

  /* ── telling them it arrived ────────────────────────────────────────────────
     A connected mailbox that cannot tell you anything is half a feature: mail
     lands, the queue fills, and nothing says so. Push is only ever offered at
     Settings → Notifications, so a member who connected here and never went
     there hears nothing at all — silently, which is the worst version. These two
     offer it at the moments this feature earns the right to ask.

     Both only ever OFFER. Neither subscribes anything on the member's behalf:
     fhPushEnable must stay behind a real tap, because iOS drops the user-gesture
     context and a permission prompt nobody asked for is the fastest way to a
     permanent 'denied'. */

  // Inline row for the status sheet. 'denied' and 'unsupported' are left alone —
  // there is nothing to offer, and saying so here would just be noise on a screen
  // about something else. 'ios-install' IS offered: fhPushSheet explains the
  // Home-Screen step, which is the real answer for that member.
  async function _mbxPushRow() {
    try {
      if (!window.fhPushState || !window.fhPushSheet) return '';
      const ps = await window.fhPushState();
      if (ps !== 'off' && ps !== 'ios-install') return '';
      return '<div class="mbx-note">' + _mbxGlyph('bell') + '<span>' + _esc(L(
        'Bật thông báo để biết ngay khi có giao dịch mới chờ bạn duyệt.',
        'Turn on notifications and you’ll know as soon as a transaction is waiting for you.')) + '</span></div>' +
        '<button class="btn-line" onclick="fhPushSheet()">' +
          _esc(L('Bật thông báo 🔔', 'Turn on notifications 🔔')) + '</button>';
    } catch (e) { return ''; }
  }

  /* One-time offer after a member has actually reviewed something (72-txn-review
     calls this once the promote lands). Mirrors fhInstallNudge: an earned moment,
     not a boot popup. That timing is the whole point for the members who
     connected before notifications existed — they never see a setup screen again,
     but they do reach the end of a review, and reaching it by hand is the proof
     that nothing told them the queue had filled.

     Keyed per member, not per device: two seats sharing a phone are two separate
     push subscriptions, so each deserves the question once. Flag is set BEFORE
     the sheet opens, so a throw mid-render cannot turn this into a loop. */
  async function _mbxPushOfferOnce() {
    try {
      if (!window.fhPushState || !window.fhPushSheet) return;
      const mid = window.DB && window.DB.ownerMemberId;
      if (!mid) return;
      const key = 'fh-mbx-push-nudged:' + mid;
      if (localStorage.getItem(key) === '1') return;
      // Only the actionable state. 'ios-install' is deliberately excluded here,
      // unlike the row above: interrupting someone who just finished a task with
      // a multi-step install errand is a worse trade than staying quiet.
      if ((await window.fhPushState()) !== 'off') return;
      localStorage.setItem(key, '1');
      setTimeout(function () { try { window.fhPushSheet(); } catch (e) {} }, 1200);
    } catch (e) {}
  }

  // ── Sheet 3 · the status ───────────────────────────────────────────────────
  /* `verified` is set by the Apps Script once it has clicked Gmail's confirmation.
     Unverified = "keep waiting" (user hasn't finished the Gmail side, or the
     confirmation hasn't arrived) — both are normal, neither is an error, and the
     copy must stay calm rather than alarm. */
  async function fhMailboxStatus(st) {
    const addr = fhAliasAddress(st.forwarding_alias);
    const ok = !!st.verified;
    // Resolved before the sheet renders rather than patched in after: the row
    // changes what this screen is offering, and a control that appears a beat
    // late reads as a glitch on a screen the member is already reading.
    const pushRow = await _mbxPushRow();
    _fhSheet(
      '<div class="sheet-h">' + _esc(ok ? L('Đã kết nối', 'Connected') : L('Đang chờ Gmail', 'Waiting for Gmail')) + '</div>' +
      '<div class="sheet-sub">' + _esc(ok
        ? L('Email giao dịch bạn chuyển tiếp sẽ tự động xuất hiện trong mục Duyệt giao dịch.',
            'Transaction emails you forward will appear in Review transactions, ready for you.')
        : L('Tụi mình đang chờ Gmail xác nhận. Việc này thường mất vài phút.',
            'We’re waiting on Gmail’s confirmation. This usually takes a few minutes.')) + '</div>' +

      '<div class="mbx-conn ' + (ok ? 'ok' : 'wait') + '">' +
        '<span class="mbx-conn-dot"></span>' +
        '<code>' + _esc(addr) + '</code>' +
      '</div>' +

      /* Which address the pipeline expects the forwarding to come FROM. Shown
         so a wrong one is visible instead of silently on file — it is what the
         forwarder check compares against once enforcement turns on, and the
         live connections were seeded with login emails that are not always the
         forwarding mailbox. Tapping it opens the same which-email sheet. */
      (st.personal_email
        ? '<div class="mbx-note"><span>' + _esc(L('Chuyển tiếp từ: ', 'Forwards from: ')) + _esc(st.personal_email) +
          ' · <a href="#" onclick="fhMailboxWhichEmail(\'update\');return false" style="cursor:pointer">' +
          _esc(L('Đổi', 'Change')) + '</a></span></div>'
        : '') +

      (ok ? '' :
        '<div class="mbx-note"><span>' + _esc(L(
          'Chưa thiết lập trong Gmail? Mở lại hướng dẫn bên dưới.',
          'Haven’t set it up in Gmail yet? Reopen the steps below.')) + '</span></div>') +

      pushRow +

      '<button class="btn-line" onclick="fhMailboxSetup(\'' + _escAttr(st.forwarding_alias) + '\')">' +
        _esc(L('Xem lại hướng dẫn', 'Show the steps again')) + '</button>' +
      /* Consent chrome (0082): re-read what was agreed, and the withdrawal the
         consent text promises. Disconnect is destructive → low-prominence +
         arm-then-confirm in fhMailboxDisconnect, never a primary button. */
      '<button class="btn-line" onclick="fhConsentSheet({readOnly:true})">' +
        _esc(L('Xem lại điều bạn đã đồng ý', 'See what you agreed to')) + '</button>' +
      '<button class="btn-skip cst-disc" onclick="fhMailboxDisconnect(this)">' +
        _esc(L('Ngắt kết nối', 'Disconnect')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
  }
