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

  /* Entry point. Reads state first so a member who already connected lands on
     status, not back at the top of setup. */
  window.fhMailboxSheet = async function () {
    const st = await fhMailboxState();
    if (st && st.forwarding_alias) return fhMailboxStatus(st);
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
        _mbxAssure('lock', L('Chỉ mình bạn đọc được', 'Only you can read it'),
          L('Nội dung được mã hoá — kể cả tụi mình cũng không xem được.',
            'Contents are encrypted — not even we can read them.')) +
        _mbxAssure('check', L('Bạn duyệt trước khi vào sổ', 'Nothing is added without you'),
          L('Không khoản nào tự động vào sổ chi tiêu của gia đình.',
            'No transaction enters your family ledger until you approve it.')) +
        _mbxAssure('fwd', L('Chỉ những email bạn chuyển', 'Only what you forward'),
          L('Tụi mình không đụng vào hộp thư của bạn.',
            'We never touch your mailbox — only the emails you send us.')) +
      '</div>' +

      '<button class="cta" onclick="fhMailboxStart(this)">' + _esc(L('Bắt đầu', 'Get started')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  }

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
  window.fhMailboxStart = async function (btn) {
    const email = (window.FAM && window.FAM.user && window.FAM.user.email) || null;
    if (btn) { btn.disabled = true; btn.textContent = L('Đang tạo địa chỉ…', 'Creating your address…'); }
    let res;
    try {
      res = await _rpc('get_or_create_mailbox_alias', { p_personal_email: email });
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = L('Bắt đầu', 'Get started'); }
      window.toast && window.toast(L('Chưa tạo được địa chỉ, thử lại nhé', 'Could not create your address — try again'));
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

  // ── Sheet 3 · the status ───────────────────────────────────────────────────
  /* `verified` is set by the Apps Script once it has clicked Gmail's confirmation.
     Unverified = "keep waiting" (user hasn't finished the Gmail side, or the
     confirmation hasn't arrived) — both are normal, neither is an error, and the
     copy must stay calm rather than alarm. */
  function fhMailboxStatus(st) {
    const addr = fhAliasAddress(st.forwarding_alias);
    const ok = !!st.verified;
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

      (ok ? '' :
        '<div class="mbx-note"><span>' + _esc(L(
          'Chưa thiết lập trong Gmail? Mở lại hướng dẫn bên dưới.',
          'Haven’t set it up in Gmail yet? Reopen the steps below.')) + '</span></div>') +

      '<button class="btn-line" onclick="fhMailboxSetup(\'' + _escAttr(st.forwarding_alias) + '\')">' +
        _esc(L('Xem lại hướng dẫn', 'Show the steps again')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
  }
