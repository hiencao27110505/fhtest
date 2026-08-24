  // ═══ PDPL consent: two layers, one table ═══════════════════════════════════
  /* Layer 1 (kind app_data): the app-wide data consent, asked once at first
     boot after sign-in. Sensitive-grade on purpose: manual entries are
     arguably basic data, but CSV-imported bank statements are item-h data by
     any reading, and explicit consent makes the classification question moot
     (PDPL-COMPLIANCE §5).

     Layer 2 (kind bank_email): the per-purpose consent for automated
     collection from a bank channel. Gates BOTH connect doors: forwarding in
     fhMailboxStart before an alias is issued, auto-logging in fhAutoTxnGrant
     before Google's screen. Google's Allow grants an API; this is the consent
     the law asks for.

     The record is the point (0071): agreeing inserts a (user, kind, version)
     row BEFORE the flow continues, and a failed insert blocks rather than
     proceeds. Withdrawal is symmetric per L91 ("việc rút lại phải dễ dàng như
     khi đã đồng ý"): one in-app action, recorded in the same table.

     Copy is the final UX-written pass (2026-08-24): Q&A rows answering the
     reader's actual questions, formal "chúng tôi" register for legal surfaces,
     protection stated as conclusions. It must not drift from
     docs/PDPL-COMPLIANCE.md §5: bump the version constant when either
     changes, and everyone re-consents to the new text. */

  var FH_CONSENT_V = 3;
  var FH_CONSENT_KIND = 'bank_email';
  var FH_APPDATA_CONSENT_V = 1;
  var FH_APPDATA_KIND = 'app_data';
  // Unincorporated today, so the operators are named; swap for a legal entity
  // if one is formed (and bump both versions).
  var FH_DATA_OPERATORS_VI = 'Trang và Hiên';
  var FH_DATA_OPERATORS_EN = 'Trang and Hien';
  var FH_DATA_CONTACT = 'gichisreading@gmail.com';

  (function () {
    var _cstKnown = null;

    async function _cstFetch() {
      if (_cstKnown && _cstKnown.version >= FH_CONSENT_V) return _cstKnown;
      var res = await sb.from('user_consents')
        .select('version,consented_at')
        .eq('kind', FH_CONSENT_KIND)
        .order('version', { ascending: false })
        .limit(1);
      if (res.error) throw res.error;
      _cstKnown = (res.data && res.data[0]) || null;
      return _cstKnown;
    }

    /* The layer-2 gate. True = consent exists, caller proceeds inline.
       False = the sheet is up and `then` re-enters the flow after a recorded
       agree. Unreadable record fails closed to ASKING. */
    window.fhConsentEnsure = async function (then) {
      var rec = null;
      try { rec = await _cstFetch(); } catch (e) { /* unreadable: ask again */ }
      if (rec && rec.version >= FH_CONSENT_V) return true;
      window.fhConsentSheet({ then: then });
      return false;
    };

    function _cstKicker(extra) {
      return '<div class="cst-kicker">' + _esc(L('ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN', 'PERSONAL DATA PROCESSING CONSENT')) +
        (extra ? ' · ' + _esc(extra) : '') + '</div>';
    }
    function _cstRow(q, body) {
      return '<div class="cst-row"><div class="cst-rt">' + _esc(q) + '</div>' +
        '<div class="cst-rs">' + body + '</div></div>';
    }
    function _cstPolicyLink() {
      return '<a href="/privacy.html" target="_blank" rel="noopener">' +
        _esc(L('Chính sách quyền riêng tư', 'Privacy Policy')) + '</a>';
    }

    /* ── layer 1: the app-wide consent ──────────────────────────────────────── */
    var _appDataAsked = false;
    window.fhAppDataConsentCheck = async function () {
      if (_appDataAsked) return;
      _appDataAsked = true;
      var res;
      try {
        res = await sb.from('user_consents')
          .select('version')
          .eq('kind', FH_APPDATA_KIND)
          .order('version', { ascending: false })
          .limit(1);
      } catch (e) { return; }   // flaky boot: skip this boot, ask next one
      if (!res || res.error) return;
      var rec = res.data && res.data[0];
      if (rec && rec.version >= FH_APPDATA_CONSENT_V) return;
      window.fhAppDataConsentSheet();
    };

    window.fhAppDataConsentSheet = async function (opts) {
      opts = opts || {};
      var ro = !!opts.readOnly;
      var accepted = null;
      if (ro) {
        try {
          var r = await sb.from('user_consents').select('version,consented_at')
            .eq('kind', FH_APPDATA_KIND).order('version', { ascending: false }).limit(1);
          accepted = (r.data && r.data[0]) || null;
        } catch (e) {}
      }

      var rows =
        _cstRow(L('Ai đọc được sổ chi tiêu?', 'Who can read the ledger?'), _esc(L(
          'Chỉ những người giữ chìa khoá của gia đình bạn. Số tiền, ghi chú và ảnh chỉ mở được trên điện thoại có chìa khoá của gia đình; người làm Earthy hay bất kỳ ai khác đều chỉ thấy bản đã khoá. Chúng tôi không bán dữ liệu, không quảng cáo, không chấm điểm tín dụng.',
          'Only the people holding your family key. Amounts, notes and photos can only be opened on a phone that holds the family key; the people who build Earthy, or anyone else, see only the locked copy. We never sell data, never run ads, never do credit scoring.'))) +
        _cstRow(L('Lỡ máy chủ bị tấn công thì sao?', 'What if the server is attacked?'), _esc(L(
          'Dữ liệu của bạn vẫn an toàn. Kẻ xấu chỉ lấy được bản đã khoá, và không mở được vì không có chìa khoá của gia đình bạn.',
          'Your data stays safe. An attacker only gets the locked copy, and cannot open it without your family key.'))) +
        _cstRow(L('Tôi rút lại đồng ý được không?', 'Can I withdraw my consent?'), _esc(L(
          'Được, bất cứ lúc nào, ngay trong Cài đặt (mục Quyền riêng tư) hoặc gửi email tới ' + FH_DATA_CONTACT + '. Yêu cầu rút lại đồng ý hoặc xoá toàn bộ dữ liệu được hoàn tất trong 72 giờ.',
          'Yes, anytime, right in Settings under Privacy, or by emailing ' + FH_DATA_CONTACT + '. Withdrawal and full-deletion requests are completed within 72 hours.')));

      var smallPrint = '<div class="cst-meta">' + _esc(L(
        'Theo pháp luật, dữ liệu tài chính là dữ liệu cá nhân nhạy cảm, vì vậy chúng tôi xin phép bạn rõ ràng tại đây. Earthy do ' + FH_DATA_OPERATORS_VI + ' vận hành và chịu trách nhiệm dữ liệu. Nơi lưu trữ, các dịch vụ tham gia và đầy đủ quyền của bạn: ',
        'Under the law, financial data is sensitive personal data, so we ask you clearly here. Earthy is operated by ' + FH_DATA_OPERATORS_EN + ', who are responsible for your data. Where it is stored, the services involved, and your full rights: ')) +
        _cstPolicyLink() + '.</div>';

      var footer;
      if (ro) {
        var when = accepted && accepted.consented_at ? new Date(accepted.consented_at) : null;
        footer = smallPrint +
          '<div class="cst-meta">' + _esc(accepted
            ? L('Bạn đã xác nhận đồng ý' + (when ? ' ngày ' + fmtDayMon(when) : '') + '.',
                'You confirmed your consent' + (when ? ' on ' + fmtDayMon(when) : '') + '.')
            : L('Chưa có xác nhận nào được ghi nhận.', 'No confirmation on record.')) + '</div>' +
          '<button class="btn-skip cst-disc" onclick="fhAppDataWithdraw(this)">' +
            _esc(L('Rút lại đồng ý và xoá dữ liệu', 'Withdraw consent and delete data')) + '</button>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>';
      } else {
        footer = smallPrint +
          '<button class="cta" onclick="fhAppDataConsentAgree(this)">' + _esc(L('Tôi hiểu và đồng ý', 'I understand and agree')) + '</button>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>';
      }

      _fhSheet(
        _cstKicker() +
        '<div class="sheet-h">' + _esc(L('Chuyện tiền của nhà mình, chỉ nhà mình biết.', 'Your family’s money stays your family’s business.')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L('Earthy là cuốn sổ chi tiêu chung của nhà bạn.', 'Earthy is your family’s shared expense book.')) + '</div>' +
        '<div class="cst-body">' + rows + '</div>' + footer);
    };

    window.fhAppDataConsentAgree = async function (btn) {
      if (btn) { btn.disabled = true; btn.textContent = L('Đang ghi nhận…', 'Recording…'); }
      var res = await sb.from('user_consents').insert({ kind: FH_APPDATA_KIND, version: FH_APPDATA_CONSENT_V });
      var dup = res.error && /duplicate key|already exists/i.test(res.error.message || '');
      if (res.error && !dup) {
        if (btn) { btn.disabled = false; btn.textContent = L('Tôi hiểu và đồng ý', 'I understand and agree'); }
        window.toast && window.toast(L('Chưa ghi nhận được, thử lại nhé', 'Could not record it, try again'));
        return;
      }
      _closeOv();
    };

    /* In-app withdrawal, symmetric with the one-tap consent (L91: withdrawing
       must be as easy as agreeing). The tap is RECORDED instantly in the same
       append-only table; fulfilment (full deletion) is operational within the
       72 hours the consent text states. Arm-then-confirm because it leads to
       deletion of everything. */
    window.fhAppDataWithdraw = async function (btn) {
      if (!btn) return;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = L('Chắc chắn? Bấm lần nữa để rút lại', 'Sure? Tap again to withdraw');
        setTimeout(function () {
          if (btn && btn.dataset) { delete btn.dataset.armed; btn.textContent = L('Rút lại đồng ý và xoá dữ liệu', 'Withdraw consent and delete data'); }
        }, 4000);
        return;
      }
      btn.disabled = true; btn.textContent = L('Đang ghi nhận…', 'Recording…');
      var res = await sb.from('user_consents').insert({ kind: 'app_data_withdraw', version: FH_APPDATA_CONSENT_V });
      var dup = res.error && /duplicate key|already exists/i.test(res.error.message || '');
      if (res.error && !dup) {
        btn.disabled = false; delete btn.dataset.armed;
        btn.textContent = L('Rút lại đồng ý và xoá dữ liệu', 'Withdraw consent and delete data');
        window.toast && window.toast(L('Chưa ghi nhận được, thử lại nhé', 'Could not record it, try again'));
        return;
      }
      _fhSheet(
        '<div class="sheet-h">' + _esc(L('Đã ghi nhận yêu cầu của bạn', 'Your request is recorded')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L(
          'Trong vòng 72 giờ, chúng tôi xoá toàn bộ dữ liệu của bạn và xác nhận qua email ' + FH_DATA_CONTACT + '. Trong lúc chờ, dữ liệu không được dùng thêm cho mục đích nào.',
          'Within 72 hours we delete all your data and confirm by email from ' + FH_DATA_CONTACT + '. Until then, your data is not used for anything further.')) + '</div>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>');
    };

    /* ── layer 2: the bank-email consent ────────────────────────────────────── */
    window.fhConsentSheet = async function (opts) {
      opts = opts || {};
      var ro = !!opts.readOnly;
      var accepted = null;
      if (ro) { try { accepted = await _cstFetch(); } catch (e) {} }

      var rows =
        _cstRow(L('Có ai đọc được email của tôi không?', 'Can anyone read my emails?'), _esc(L(
          'Email được hệ thống xử lý tự động rồi tự xoá sau 7 ngày; email bị lỗi giữ tối đa 90 ngày rồi cũng xoá. Khi gặp một ngân hàng lần đầu, AI chỉ đọc bản đã che hết số tiền, tên và số tài khoản; số thật không bao giờ được gửi đi.',
          'Emails are processed automatically and delete themselves after 7 days; ones we fail to read are kept at most 90 days, then deleted too. For a first-time bank, the AI only reads a copy with every amount, name and account number masked; real values are never sent.'))) +
        _cstRow(L('Ai mở được các giao dịch này?', 'Who can open these transactions?'), _esc(L(
          'Mỗi giao dịch được niêm phong ngay khi đến, như thư bỏ vào két đã khoá: máy chủ giữ két, còn chìa chỉ nằm trên điện thoại của gia đình bạn.',
          'Each transaction is sealed the moment it arrives, like a letter dropped into a locked safe: the server holds the safe, and the key lives only on your family’s phones.'))) +
        _cstRow(L('Giao dịch có tự vào sổ không?', 'Do transactions enter the ledger by themselves?'), _esc(L(
          'Không. Bạn duyệt từng khoản một. Muốn dừng, vào Cài đặt bấm Ngắt kết nối: dừng ngay và các khoản đang chờ được xoá hết.',
          'No. You review every one. To stop, tap Disconnect in Settings: it stops at once and pending items are deleted.')));

      var smallPrint = '<div class="cst-meta">' + _esc(L(
        'Giao dịch ngân hàng là dữ liệu cá nhân nhạy cảm theo pháp luật, nên chúng tôi có lời xin phép riêng này. Vận hành: ' + FH_DATA_OPERATORS_VI + ' · ' + FH_DATA_CONTACT + ' · Chi tiết: ',
        'Bank transactions are sensitive personal data under the law, which is why this feature asks separately. Operated by ' + FH_DATA_OPERATORS_EN + ' · ' + FH_DATA_CONTACT + ' · Details: ')) +
        _cstPolicyLink() + '. ' +
        _esc(L('Nếu không đồng ý, chỉ tính năng này không bật.', 'If you decline, only this feature stays off.')) + '</div>';

      var footer;
      if (ro) {
        var when = accepted && accepted.consented_at ? new Date(accepted.consented_at) : null;
        footer = smallPrint +
          '<div class="cst-meta">' + _esc(accepted
            ? L('Bạn đã xác nhận đồng ý' + (when ? ' ngày ' + fmtDayMon(when) : '') + '.',
                'You confirmed your consent' + (when ? ' on ' + fmtDayMon(when) : '') + '.')
            : L('Chưa có xác nhận nào được ghi nhận.', 'No confirmation on record.')) + '</div>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>';
      } else {
        footer = smallPrint +
          '<button class="cta" id="cst-agree" onclick="fhConsentAgree(this)">' +
            _esc(L('Tôi hiểu và đồng ý', 'I understand and agree')) + '</button>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>';
      }

      _fhSheet(
        _cstKicker(L('EMAIL NGÂN HÀNG', 'BANK EMAIL')) +
        '<div class="sheet-h">' + _esc(L('Ngân hàng gửi, Earthy niêm phong, nhà bạn mở.', 'Your bank sends it, Earthy seals it, your family opens it.')) + '</div>' +
        '<div class="cst-body">' + rows + '</div>' + footer);

      window._cstThen = ro ? null : (opts.then || null);
    };

    window.fhConsentAgree = async function (btn) {
      if (btn) { btn.disabled = true; btn.textContent = L('Đang ghi nhận…', 'Recording…'); }
      var res = await sb.from('user_consents').insert({ kind: FH_CONSENT_KIND, version: FH_CONSENT_V });
      var dup = res.error && /duplicate key|already exists/i.test(res.error.message || '');
      if (res.error && !dup) {
        if (btn) { btn.disabled = false; btn.textContent = L('Tôi hiểu và đồng ý', 'I understand and agree'); }
        window.toast && window.toast(L('Chưa ghi nhận được, thử lại nhé', 'Could not record it, try again'));
        return;
      }
      _cstKnown = { version: FH_CONSENT_V, consented_at: new Date().toISOString() };
      var then = window._cstThen; window._cstThen = null;
      _closeOv();
      if (typeof then === 'function') then();
    };

    /* ── withdrawal, layer 2: disconnect the mailbox ────────────────────────── */
    window.fhMailboxDisconnect = async function (btn) {
      if (!btn) return;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = L('Chắc chắn ngắt? Bấm lần nữa', 'Sure? Tap again to disconnect');
        setTimeout(function () {
          if (btn && btn.dataset) { delete btn.dataset.armed; btn.textContent = L('Ngắt kết nối', 'Disconnect'); }
        }, 4000);
        return;
      }
      btn.disabled = true; btn.textContent = L('Đang ngắt…', 'Disconnecting…');
      try {
        await _rpc('disconnect_my_mailbox', {});
      } catch (e) {
        btn.disabled = false; delete btn.dataset.armed;
        btn.textContent = L('Ngắt kết nối', 'Disconnect');
        window.toast && window.toast(L('Chưa ngắt được, thử lại nhé', 'Could not disconnect, try again'));
        return;
      }
      _fhSheet(
        '<div class="sheet-h">' + _esc(L('Đã ngắt kết nối', 'Disconnected')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L(
          'Địa chỉ nhận và các giao dịch đang chờ duyệt đã được xoá. Còn một bước chỉ bạn làm được:',
          'Your address and pending transactions are deleted. One step only you can do remains:')) + '</div>' +
        '<div class="mbx-steps">' +
          '<div class="mbx-step"><span class="mbx-step-n">1</span><div>' +
            '<div class="mbx-step-t">' + _esc(L('Mở Cài đặt Gmail, mục Chuyển tiếp', 'Open Gmail Settings, Forwarding')) + '</div>' +
            '<div class="mbx-step-s">' + _esc(L('Xoá quy tắc chuyển tiếp tới địa chỉ Earthy để ngân hàng không gửi thư sang nữa.',
              'Delete the forwarding rule to your Earthy address so bank mail stops arriving.')) + '</div>' +
          '</div></div>' +
        '</div>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>');
    };
  })();
