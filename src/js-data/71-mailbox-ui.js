  // ═══ bank-email: connect a mailbox ════════════════════════════════════════
  /* Gives a member their forwarding alias and walks them through pointing Gmail
     at it. Once connected, bank/receipt emails they forward are extracted and
     land in their review queue.

     Runs on the app's own layers (DESIGN §4): the flow is a multi-step explainer
     with a copyable address, so it uses #fh-sheet like the other Settings
     journeys rather than a bespoke overlay.

     Server side (all live): 0059 issues the alias, the Apps Script auto-clicks
     Gmail's confirmation email, and the pipeline routes on the +tag. Nothing
     here needs the user to handle a confirmation email — that is the whole
     point of the auto-confirm step, so the copy must not tell them to go
     looking for one.

     The address is assembled HERE from tag + inbox domain, deliberately: the
     shared Gmail inbox is temporary, and moving to an owned domain later should
     be a one-constant change, not a data migration. */

  const FH_TXN_INBOX = 'gichisreading@gmail.com';   // shared receiving inbox; swap for the owned domain when it exists

  /* Inline SVG line glyphs (DESIGN §2.6: UI icons are SVG, stroke 1.9–2.4, round
     caps — never emoji as a UI icon). currentColor inherits the tile's tint. */
  const _MBX_SVG = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/><circle cx="12" cy="15.4" r="1.15" fill="currentColor" stroke="none"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.4 12.3l2.5 2.5 4.7-5.1"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="17" height="12" rx="2.6"/><path d="M4.5 8.2l7.5 5 7.5-5"/></svg>',
  };

  function fhAliasAddress(tag) {
    if (!tag) return null;
    const [user, domain] = FH_TXN_INBOX.split('@');
    return user + '+' + tag + '@' + domain;
  }

  async function fhMailboxState() {
    try { return await _rpc('get_my_mailbox_alias', {}); }
    catch (e) { return null; }
  }

  /* Entry point (Settings → Connect bank email). Reads state first so a member
     who already connected sees status rather than being walked through setup
     again. */
  window.fhMailboxSheet = async function () {
    const st = await fhMailboxState();
    if (st && st.forwarding_alias) return fhMailboxStatus(st);
    return fhMailboxIntro();
  };

  function fhMailboxIntro() {
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(L('Tự động ghi chi tiêu từ email', 'Log spending from email')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Ngân hàng gửi email mỗi lần bạn giao dịch. Chuyển tiếp những email đó cho Earthy, tụi mình đọc giúp và bạn chỉ cần duyệt lại.',
        'Your bank emails you after each transaction. Forward those to Earthy and we read them for you — you just review.')) + '</div>' +
      '<div class="mbx-points">' +
        _mbxPoint('lock', L('Chỉ mình bạn đọc được', 'Only you can read it'),
                  L('Nội dung được mã hoá, kể cả tụi mình cũng không xem được.',
                    'Contents are encrypted — not even we can read them.')) +
        _mbxPoint('check', L('Bạn duyệt trước khi vào sổ', 'Nothing is added without you'),
                  L('Không giao dịch nào tự động vào sổ chi tiêu.',
                    'No transaction enters your ledger until you approve it.')) +
        _mbxPoint('mail', L('Chỉ email bạn chuyển tiếp', 'Only what you forward'),
                  L('Tụi mình không đọc hộp thư của bạn — chỉ những email bạn chủ động chuyển.',
                    'We never read your mailbox — only the emails you choose to forward.')) +
      '</div>' +
      '<button class="cta" onclick="fhMailboxStart()">' + _esc(L('Bắt đầu', 'Get started')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  }

  function _mbxPoint(icon, title, sub) {
    return '<div class="mbx-point"><div class="mbx-point-ic">' + (_MBX_SVG[icon] || '') + '</div><div>' +
      '<div class="mbx-point-t">' + _esc(title) + '</div>' +
      '<div class="mbx-point-s">' + _esc(sub) + '</div></div></div>';
  }

  /* Issues the alias (idempotent server-side) and shows the address to forward
     to. personal_email is passed so the pipeline can check that forwarded mail
     really came through this member's mailbox. */
  window.fhMailboxStart = async function () {
    const email = (window.FAM && window.FAM.user && window.FAM.user.email) || null;
    let res;
    try {
      res = await _rpc('get_or_create_mailbox_alias', { p_personal_email: email });
    } catch (e) {
      window.toast && window.toast(L('Chưa tạo được địa chỉ, thử lại nhé', 'Could not create your address — try again'));
      return;
    }
    fhMailboxSetup(res.forwarding_alias);
  };

  function fhMailboxSetup(tag) {
    const addr = fhAliasAddress(tag);
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(L('Địa chỉ của bạn', 'Your address')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Trong Gmail, chuyển tiếp email ngân hàng tới địa chỉ này. Địa chỉ này là của riêng bạn.',
        'In Gmail, forward your bank emails to this address. It belongs to you alone.')) + '</div>' +

      '<button class="mbx-addr" onclick="fhMailboxCopy(\'' + _escAttr(addr) + '\')">' +
        '<code>' + _esc(addr) + '</code>' +
        '<span class="mbx-copy" id="mbx-copy">' + _esc(L('Sao chép', 'Copy')) + '</span>' +
      '</button>' +

      '<div class="mbx-steps">' +
        _mbxStep(1, L('Mở Cài đặt Gmail → Chuyển tiếp', 'Open Gmail Settings → Forwarding'),
                    L('Dán địa chỉ trên vào ô "Thêm địa chỉ chuyển tiếp".',
                      'Paste the address into "Add a forwarding address".')) +
        _mbxStep(2, L('Tạo bộ lọc cho email ngân hàng', 'Create a filter for bank emails'),
                    L('Lọc theo địa chỉ ngân hàng, rồi chọn "Chuyển tiếp tới" địa chỉ trên.',
                      'Filter by your bank’s address, then choose "Forward it to" the address above.')) +
      '</div>' +

      '<div class="mbx-note">' + _esc(L(
        'Gmail sẽ gửi một email xác nhận — tụi mình tự xác nhận giúp bạn, không cần làm gì thêm.',
        'Gmail will send a confirmation email — we confirm it for you, nothing more to do.')) + '</div>' +

      '<a class="cta" href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener">' +
        _esc(L('Mở cài đặt Gmail', 'Open Gmail settings')) + '</a>' +
      '<button class="btn-skip" onclick="fhMailboxSheet()">' + _esc(L('Tôi đã thiết lập xong', 'I’ve set it up')) + '</button>'
    );
  }

  function _mbxStep(n, title, sub) {
    return '<div class="mbx-step"><div class="mbx-step-n">' + n + '</div><div>' +
      '<div class="mbx-step-t">' + _esc(title) + '</div>' +
      '<div class="mbx-step-s">' + _esc(sub) + '</div></div></div>';
  }

  window.fhMailboxCopy = async function (addr) {
    try { await navigator.clipboard.writeText(addr); } catch (e) { /* fall through to the label */ }
    const el = document.getElementById('mbx-copy');
    if (el) { el.textContent = L('Đã sao chép', 'Copied'); setTimeout(() => { el.textContent = L('Sao chép', 'Copy'); }, 1600); }
  };

  /* Already connected. `verified` is set by the Apps Script once it has clicked
     Gmail's confirmation, so an unverified state means either the user has not
     finished the Gmail side yet or the confirmation has not arrived — both are
     "keep waiting", not errors, and the copy says so rather than alarming. */
  function fhMailboxStatus(st) {
    const addr = fhAliasAddress(st.forwarding_alias);
    const ok = !!st.verified;
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(ok ? L('Đã kết nối', 'Connected') : L('Đang chờ Gmail', 'Waiting for Gmail')) + '</div>' +
      '<div class="sheet-sub">' + _esc(ok
        ? L('Email giao dịch bạn chuyển tiếp sẽ tự động xuất hiện trong mục duyệt.',
            'Transaction emails you forward will appear in your review queue.')
        : L('Tụi mình đang chờ email xác nhận từ Gmail. Việc này thường mất vài phút.',
            'We’re waiting for Gmail’s confirmation email. This usually takes a few minutes.')) + '</div>' +

      '<div class="mbx-status ' + (ok ? 'ok' : 'wait') + '">' +
        '<span class="mbx-status-dot"></span>' +
        '<code>' + _esc(addr) + '</code>' +
      '</div>' +

      (ok ? '' :
        '<div class="mbx-note">' + _esc(L(
          'Chưa thiết lập trong Gmail? Mở lại hướng dẫn bên dưới.',
          'Haven’t set it up in Gmail yet? Reopen the steps below.')) + '</div>') +

      '<button class="btn-line" onclick="fhMailboxSetup(\'' + _escAttr(st.forwarding_alias) + '\')">' +
        _esc(L('Xem lại hướng dẫn', 'Show the steps again')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
  }
