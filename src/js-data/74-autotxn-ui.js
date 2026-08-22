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

  /* Hands off to Google. /api/gmail-connect grants nothing by itself: it checks
     the caller owns the member row and returns a signed consent URL. The member
     id is required — without it the callback has no ledger to attach the mailbox
     to, and guessing would attach it to the wrong person.

     Full navigation rather than a popup, deliberately: iOS Safari blocks a
     window.open that happens after an await, and the consent flow has to land
     back on a real page regardless.

     The endpoint is not on main yet (it belongs to the OAuth backend on branch
     bank-email-oauth), so 404 is a live, expected state during the beta and gets
     its own honest line instead of "try again", which would send people tapping
     at something that cannot work yet. */
  window.fhAutoTxnGrant = async function () {
    const btn = document.getElementById('atx-go');
    const label = L('Bắt đầu: cho phép đọc email', 'Start by granting email access');
    const reset = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };

    const mid = window.DB && window.DB.ownerMemberId;
    if (!mid) {
      window.toast && window.toast(L('Chưa xác định được thành viên, thử lại nhé', 'Could not identify your member — try again'));
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = L('Đang mở Google…', 'Opening Google…'); }

    let tok = '';
    try { tok = ((await sb.auth.getSession()).data.session || {}).access_token || ''; } catch (e) { /* handled by the 401 below */ }

    try {
      const r = await fetch('/api/gmail-connect', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
        body: JSON.stringify({ memberId: mid, email: (window.FAM && window.FAM.user && window.FAM.user.email) || '' }),
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
  