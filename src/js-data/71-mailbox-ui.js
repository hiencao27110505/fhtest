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
     again.

     Two mechanisms now. Direct connect (OAuth) is offered first — it proves
     mailbox ownership by the grant, so there is no alias, no filter to set up,
     and it can read the last six months rather than starting from today.
     Forwarding stays, deliberately: the direct path is capped while the app is
     unverified, and "read everything or get nothing" is a bad place to put a
     privacy-first product. Some people will not grant a whole-mailbox scope,
     and they should still be able to use this. */
  window.fhMailboxSheet = async function () {
    const conn = await fhMailboxOauthState();
    if (conn) return fhMailboxOauthStatus(conn);
    const st = await fhMailboxState();
    if (st && st.forwarding_alias) return fhMailboxStatus(st);
    return fhMailboxIntro();
  };

  function fhMailboxIntro() {
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(L('Tự động ghi chi tiêu từ email', 'Log spending from email')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Ngân hàng gửi email mỗi lần bạn giao dịch. Tụi mình đọc giúp và bạn chỉ cần duyệt lại.',
        'Your bank emails you after each transaction. We read them for you — you just review.')) + '</div>' +
      '<div class="mbx-points">' +
        _mbxPoint('lock', L('Chỉ mình bạn đọc được', 'Only you can read it'),
                  L('Nội dung được mã hoá bằng khoá của gia đình, kể cả tụi mình cũng không xem được.',
                    'Contents are encrypted to your family’s key — not even we can read them.')) +
        _mbxPoint('check', L('Bạn duyệt trước khi vào sổ', 'Nothing is added without you'),
                  L('Không giao dịch nào tự động vào sổ chi tiêu.',
                    'No transaction enters your ledger until you approve it.')) +
      '</div>' +
      '<button class="cta" onclick="fhMailboxConnectGmail()">' + _esc(L('Kết nối Gmail', 'Connect Gmail')) + '</button>' +
      '<button class="btn-line" onclick="fhMailboxStart()">' + _esc(L('Hoặc chuyển tiếp email thủ công', 'Or forward emails instead')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>'
    );
  }

  // ── direct connect (OAuth) ─────────────────────────────────────────────────
  /* The consent screen Google shows says "read your email". That is literally
     what the grant covers — there is no narrower Gmail scope that still returns
     a message body, so the restriction to bank senders is ours, enforced in
     pipeline/lib/gmail.js, and NOT something the user can verify from Google's
     screen. The copy below says exactly that, because the alternative is
     implying a boundary that does not exist. Reviewed against
     pipeline/OAUTH-COMPLIANCE-FINDINGS.md §3.3 — do not soften it. */
  async function fhMailboxOauthState() {
    try {
      const rows = await _rpc('get_my_mailbox_connections', {});
      const list = Array.isArray(rows) ? rows : [];
      return list.filter((r) => r.connection_source === 'oauth' &&
        (r.oauth_status === 'active' || r.oauth_status === 'needs_reconnect'))[0] || null;
    } catch (e) { return null; }
  }

  window.fhMailboxConnectGmail = function () {
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(L('Kết nối Gmail', 'Connect Gmail')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Google chỉ có một quyền đọc thư duy nhất, và nó bao trùm toàn bộ hộp thư của bạn — không có quyền nào hẹp hơn.',
        'Google offers only one mail-reading permission, and it covers your whole mailbox — there is no narrower one.')) + '</div>' +
      '<div class="mbx-points">' +
        _mbxPoint('mail', L('Tụi mình chỉ tải email ngân hàng', 'We only fetch bank email'),
                  L('Chỉ email từ những ngân hàng trong danh sách mới được tải về. Phần còn lại không bao giờ rời hộp thư của bạn.',
                    'Only mail from the banks on our list is fetched. The rest never leaves your mailbox.')) +
        _mbxPoint('lock', L('Tải về là mã hoá ngay', 'Encrypted on arrival'),
                  L('Nội dung được mã hoá bằng khoá của gia đình ngay khi lấy về — FamilyHub không đọc được.',
                    'Contents are encrypted to your family’s key as they arrive — FamilyHub cannot read them.')) +
        _mbxPoint('check', L('Gỡ bất cứ lúc nào', 'Revoke any time'),
                  L('Bạn gỡ quyền trong tài khoản Google bất cứ lúc nào, không cần hỏi tụi mình.',
                    'You can revoke access in your Google account at any time, without asking us.')) +
      '</div>' +
      '<button class="cta" id="mbx-oauth-go" onclick="fhMailboxOauthGo()">' + _esc(L('Tiếp tục với Google', 'Continue with Google')) + '</button>' +
      '<button class="btn-skip" onclick="fhMailboxSheet()">' + _esc(L('Quay lại', 'Back')) + '</button>'
    );
  };

  window.fhMailboxOauthGo = async function () {
    const btn = document.getElementById('mbx-oauth-go');
    if (btn) { btn.disabled = true; btn.textContent = L('Đang mở…', 'Opening…'); }
    const mid = window.DB && window.DB.ownerMemberId;
    if (!mid) {
      window.toast && window.toast(L('Chưa xác định được thành viên, thử lại nhé', 'Could not identify your member — try again'));
      if (btn) { btn.disabled = false; btn.textContent = L('Tiếp tục với Google', 'Continue with Google'); }
      return;
    }
    let tok = '';
    try { tok = ((await sb.auth.getSession()).data.session || {}).access_token || ''; } catch (e) { /* handled below */ }
    try {
      const r = await fetch('/api/gmail-connect', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
        body: JSON.stringify({ memberId: mid, email: (window.FAM && window.FAM.user && window.FAM.user.email) || '' }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || 'no url');
      // Full navigation, not a popup: iOS Safari blocks popups opened after an
      // await, and the consent flow has to come back to a real page anyway.
      window.location.href = data.url;
    } catch (e) {
      window.toast && window.toast(L('Chưa mở được Google, thử lại nhé', 'Could not open Google — try again'));
      if (btn) { btn.disabled = false; btn.textContent = L('Tiếp tục với Google', 'Continue with Google'); }
    }
  };

  /* Connected, or asking to reconnect. Revocation is a NORMAL state — the user
     may have revoked from their Google account, or the grant may have aged out
     while the app is unverified. Either way this is a reconnect prompt, never
     an error screen. */
  function fhMailboxOauthStatus(c) {
    const stale = c.oauth_status === 'needs_reconnect';
    const last = c.last_sync_at ? new Date(c.last_sync_at) : null;
    const backfilling = c.backfill_status === 'pending' || c.backfill_status === 'running';
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(stale ? L('Cần kết nối lại', 'Reconnect needed') : L('Đã kết nối', 'Connected')) + '</div>' +
      '<div class="sheet-sub">' + _esc(stale
        ? L('Quyền truy cập đã bị gỡ hoặc hết hạn. Sổ chi tiêu của bạn vẫn nguyên vẹn — chỉ cần kết nối lại để tiếp tục.',
            'Access was revoked or expired. Your ledger is untouched — reconnect to resume.')
        : backfilling
          ? L('Đang đọc lại email cũ của bạn. Việc này có thể mất vài phút.',
              'We’re reading your older email now. This can take a few minutes.')
          : L('Email giao dịch mới sẽ tự động xuất hiện trong mục duyệt.',
              'New transaction emails will appear in your review queue.')) + '</div>' +

      '<div class="mbx-status ' + (stale ? 'wait' : 'ok') + '">' +
        '<span class="mbx-status-dot"></span>' +
        '<code>' + _esc(c.oauth_email || '') + '</code>' +
      '</div>' +

      (last && !stale ? '<div class="mbx-note">' + _esc(L('Lần đọc gần nhất: ', 'Last checked: ') + _mbxWhen(last)) + '</div>' : '') +

      (stale
        ? '<button class="cta" onclick="fhMailboxConnectGmail()">' + _esc(L('Kết nối lại', 'Reconnect')) + '</button>'
        : '<button class="btn-line" onclick="fhMailboxSyncNow()">' + _esc(L('Kiểm tra ngay', 'Check now')) + '</button>') +
      '<button class="btn-line" onclick="fhMailboxDisconnect(\'' + _escAttr(c.id) + '\')">' +
        _esc(L('Ngắt kết nối', 'Disconnect')) + '</button>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
  }

  function _mbxWhen(d) {
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 2) return L('vừa xong', 'just now');
    if (mins < 60) return L(mins + ' phút trước', mins + ' min ago');
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return L(hrs + ' giờ trước', hrs + 'h ago');
    return window.fmtDayMon ? window.fmtDayMon(d) : d.toLocaleDateString();
  }

  window.fhMailboxSyncNow = async function () {
    window.toast && window.toast(L('Đang kiểm tra…', 'Checking…'));
    let tok = '';
    try { tok = ((await sb.auth.getSession()).data.session || {}).access_token || ''; } catch (e) { /* handled below */ }
    try {
      const r = await fetch('/api/gmail-sync', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
        body: '{}',
      });
      if (!r.ok) throw new Error('sync failed');
      const data = await r.json();
      const staged = (data.synced || []).reduce((n, s) => n + (s.staged || 0), 0);
      window.toast && window.toast(staged
        ? L('Tìm thấy ' + staged + ' giao dịch mới', 'Found ' + staged + ' new transaction' + (staged === 1 ? '' : 's'))
        : L('Chưa có gì mới', 'Nothing new yet'));
      if (staged && window.fhTxnReviewSheet) window.fhTxnReviewSheet();
    } catch (e) {
      window.toast && window.toast(L('Chưa kiểm tra được, thử lại sau nhé', 'Could not check — try again later'));
    }
  };

  /* Clears our copy of the credential. It does NOT revoke the grant at Google —
     only Google can do that — so the copy says so instead of implying we did
     something we cannot. */
  window.fhMailboxDisconnect = async function (id) {
    try {
      await _rpc('disconnect_mailbox', { p_connection_id: id });
    } catch (e) {
      window.toast && window.toast(L('Chưa ngắt được, thử lại nhé', 'Could not disconnect — try again'));
      return;
    }
    _fhSheet(
      '<div class="grab"></div>' +
      '<div class="sheet-h">' + _esc(L('Đã ngắt kết nối', 'Disconnected')) + '</div>' +
      '<div class="sheet-sub">' + _esc(L(
        'Tụi mình đã xoá quyền truy cập đã lưu và sẽ không đọc thêm email nào. Để gỡ hẳn ở phía Google, bạn vào phần quyền truy cập trong tài khoản Google.',
        'We’ve deleted the saved access and will read no further email. To remove it on Google’s side too, visit the permissions page in your Google account.')) + '</div>' +
      '<a class="btn-line" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">' +
        _esc(L('Mở quyền truy cập Google', 'Open Google permissions')) + '</a>' +
      '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>'
    );
  };

  /* The OAuth callback comes back to the app as #mailbox-<status>. Read it once,
     clear it so a reload does not re-announce, and tell the user what happened.
     Statuses come from api/gmail-callback.js. */
  (function _mbxHandleReturn() {
    const m = String(location.hash || '').match(/^#mailbox-([a-z]+)$/);
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    const status = m[1];
    setTimeout(function () {
      if (status === 'connected') {
        window.toast && window.toast(L('Đã kết nối Gmail', 'Gmail connected'));
        if (window.fhMailboxSheet) window.fhMailboxSheet();
        if (window.fhMailboxSyncNow) window.fhMailboxSyncNow();
        return;
      }
      if (status === 'cancelled') return;                       // they chose not to; say nothing
      window.toast && window.toast(
        status === 'norefresh' ? L('Google không cấp quyền nền, thử lại nhé', 'Google withheld background access — try again')
        : status === 'scope'   ? L('Quyền được cấp không đúng, thử lại nhé', 'The granted permission was not the one requested')
        : status === 'expired' ? L('Phiên kết nối đã hết hạn, thử lại nhé', 'That connection attempt expired — try again')
        : L('Chưa kết nối được, thử lại nhé', 'Could not connect — try again'));
    }, 900);   // after hydrate, so the sheet has state to render
  })();

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
