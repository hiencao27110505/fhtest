  // ═══ bank-email: PDPL consent gate ═══════════════════════════════════════
  /* One consent, two doors. Both connect paths process the same sensitive data
     (bank transaction information, dữ liệu cá nhân nhạy cảm), so both gate on
     the same sheet and the same stored record: forwarding gates in
     fhMailboxStart before an alias is issued, auto-logging gates in
     fhAutoTxnGrant before Google's screen opens. Google's Allow button grants
     API access; THIS is the consent the law asks for.

     The record is the point (0071): consent must be provable, so agreeing
     inserts a (user, kind, version) row BEFORE the flow continues, and a
     failed insert blocks the flow rather than proceeding on a promise. The
     gate fails closed in the other direction too — if the record cannot be
     read, we re-ask, because showing the sheet twice is free and skipping it
     once is not.

     Copy is consent_v 3: docs/PDPL-COMPLIANCE.md §5, legally reviewed and
     benchmarked against MoMo's counsel-vetted wording. The text here and the
     doc must not drift — bump FH_CONSENT_V when either changes, and everyone
     re-consents to the new text on their next visit. */

  var FH_CONSENT_V = 3;
  var FH_CONSENT_KIND = 'bank_email';
  /* Layer 1: the app-wide data consent, asked once at first boot after
     sign-in. Sensitive-grade ON PURPOSE even though manual entries are
     arguably basic data: the classification of self-reported and IMPORTED
     spending (CSV bank statements are credit-institution records by any
     reading) is untested under NĐ 356, and explicit consent makes the
     question moot instead of load-bearing (PDPL-COMPLIANCE §5). */
  var FH_APPDATA_CONSENT_V = 1;
  var FH_APPDATA_KIND = 'app_data';
  // The controller line. Unincorporated today, so it names the operators;
  // swap for the legal entity if one is ever formed (and bump the version).
  var FH_DATA_OPERATORS_VI = 'Trang và Hiên';
  var FH_DATA_OPERATORS_EN = 'Trang and Hien';
  var FH_DATA_CONTACT = 'gichisreading@gmail.com';

  (function () {
    /* Session cache: {version, consented_at} or null. Cleared on family/user
       switch implicitly because it is keyed to nothing persistent — a reload
       re-reads the table, which RLS scopes to the signed-in user. */
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

    /* The gate. Returns true if current-version consent already exists (caller
       proceeds inline). Otherwise shows the sheet and returns false — the
       caller STOPS, and `then` re-enters the flow after a successful agree. */
    window.fhConsentEnsure = async function (then) {
      var rec = null;
      try { rec = await _cstFetch(); } catch (e) { /* unreadable → ask again */ }
      if (rec && rec.version >= FH_CONSENT_V) return true;
      window.fhConsentSheet({ then: then });
      return false;
    };

    /* ── layer 1: app-wide data consent, once per user ──────────────────────
       Called fire-and-forget from hydrate's off-critical-path block. Unlike
       the bank-email gate this never interrupts an action, so its failure
       posture differs: a transient fetch error at boot SKIPS this boot and
       asks on the next one, rather than nagging every flaky reload. "Để sau"
       does the same by simply not recording. The record, once written, ends
       the asking forever (until a version bump re-opens it). */
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
      } catch (e) { return; }
      if (!res || res.error) return;
      var rec = res.data && res.data[0];
      if (rec && rec.version >= FH_APPDATA_CONSENT_V) return;
      window.fhAppDataConsentSheet();
    };

    window.fhAppDataConsentSheet = function () {
      _fhSheet(
        '<div class="mbx-hero">' + _mbxGlyph('lock') + '</div>' +
        '<div class="sheet-h">' + _esc(L('Dữ liệu của nhà mình, nói rõ một lần', 'Your family’s data, said plainly once')) + '</div>' +
        '<div class="cst-body">' +
        _cstRow(L('Ai xử lý', 'Who processes it'), _esc(L(
          'Earthy được vận hành bởi ' + FH_DATA_OPERATORS_VI + ', với vai trò là bên kiểm soát và xử lý dữ liệu cá nhân. Liên hệ về dữ liệu: ' + FH_DATA_CONTACT + '.',
          'Earthy is operated by ' + FH_DATA_OPERATORS_EN + ', acting as the personal-data controller and processor. Data contact: ' + FH_DATA_CONTACT + '.'))) +
        _cstRow(L('Ứng dụng lưu gì', 'What the app stores'), _esc(L(
          'Email đăng nhập và tên của bạn. Tên và ảnh đại diện các thành viên gia đình, kể cả trẻ em do cha mẹ thêm vào. Các khoản thu chi bạn tự ghi hoặc nhập từ tệp, kể cả bảng sao kê ngân hàng, cùng ghi chú, hạng mục và ảnh đính kèm. Đây là dữ liệu tài chính của bạn, tụi mình đối xử với nó như dữ liệu cá nhân nhạy cảm.',
          'Your sign-in email and name. Family members’ names and avatars, including children added by parents. The spending you record or import from files, including bank statements, with notes, categories and photos. This is your financial data, and we treat it as sensitive personal data.'))) +
        _cstRow(L('Lưu ở đâu, ai thấy', 'Where it lives, who sees it'), _esc(L(
          'Dữ liệu lưu trên máy chủ đặt ngoài lãnh thổ Việt Nam. Với gia đình đã bật mã hoá, số tiền, ghi chú và ảnh được mã hoá ngay trên thiết bị, máy chủ chỉ giữ bản mã. Khoản chi vào sổ chung sẽ hiển thị cho các thành viên trong gia đình bạn. Không bán, không quảng cáo, không chia sẻ cho ai khác, trừ trường hợp cơ quan nhà nước có thẩm quyền yêu cầu theo đúng quy định pháp luật.',
          'Data is stored on servers located outside Vietnam. For families with encryption on, amounts, notes and photos are encrypted on your device and servers hold only ciphertext. Entries in the shared ledger are visible to your family members. Never sold, never ads, never shared with anyone else, except where a competent state authority lawfully requires it.'))) +
        _cstRow(L('Quyền của bạn', 'Your rights'),
          _esc(L('Truy cập, chỉnh sửa, yêu cầu xóa, rút lại sự đồng ý, hạn chế hoặc phản đối xử lý, và khiếu nại. Chi tiết trong ',
                 'Access, correct, request deletion, withdraw consent, restrict or object to processing, and complain. Details in the ')) +
          '<a href="./privacy.html" target="_blank" rel="noopener">' + _esc(L('Chính sách quyền riêng tư', 'Privacy Policy')) + '</a>.') +
        '</div>' +
        '<button class="cta" onclick="fhAppDataConsentAgree(this)">' + _esc(L('Tôi hiểu và đồng ý', 'I understand and agree')) + '</button>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>');
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

    function _cstRow(title, body) {
      return '<div class="cst-row"><div class="cst-rt">' + _esc(title) + '</div>' +
        '<div class="cst-rs">' + body + '</div></div>';
    }

    /* The sheet. opts.then re-enters the interrupted flow after a recorded
       agree; opts.readOnly renders the same text as a record of what was
       accepted (no agree CTA, shows version + date instead). */
    window.fhConsentSheet = async function (opts) {
      opts = opts || {};
      var ro = !!opts.readOnly;
      var accepted = null;
      if (ro) { try { accepted = await _cstFetch(); } catch (e) {} }

      var vi = [
        _cstRow(L('Ai xử lý dữ liệu', 'Who processes it'), _esc(L(
          'Earthy được vận hành bởi ' + FH_DATA_OPERATORS_VI + ', với vai trò là bên kiểm soát và xử lý dữ liệu cá nhân. Liên hệ về dữ liệu: ' + FH_DATA_CONTACT + '.',
          'Earthy is operated by ' + FH_DATA_OPERATORS_EN + ', acting as the personal-data controller and processor. Data contact: ' + FH_DATA_CONTACT + '.'))),
        _cstRow(L('Dữ liệu gì', 'What data'), _esc(L(
          'Khi bạn kết nối email ngân hàng, tụi mình xử lý nội dung email đó, và trích xuất thông tin giao dịch: số tiền, thời điểm, người nhận hay cửa hàng, lời nhắn chuyển khoản, số tài khoản đã che bớt, tên ngân hàng. Theo Luật Bảo vệ dữ liệu cá nhân, đây là dữ liệu cá nhân nhạy cảm. Tụi mình cần bạn biết điều đó, và đồng ý rõ ràng, trước khi bắt đầu.',
          'When you connect bank email, we process the content of those emails and extract the transaction information: amount, time, who was paid, the transfer note, the partially hidden account number, and the bank name. Under the Personal Data Protection Law, this is sensitive personal data. We want you to know that, and to agree clearly, before anything starts.'))),
        _cstRow(L('Xử lý thế nào', 'How it is handled'), _esc(L(
          'Email đi qua một hộp thư trung gian trên Gmail, được xoá sau 7 ngày và tự huỷ hẳn trong khoảng một tháng. Email không đọc được sẽ được giữ lâu hơn để tụi mình sửa lỗi, tối đa 90 ngày. Với ngân hàng lần đầu gặp, nội dung được che hết số tiền, tên, số tài khoản thật rồi mới nhờ Google Gemini đọc cấu trúc. Giá trị thật không bao giờ được gửi cho Gemini. Giao dịch được niêm phong ngay khi nhận, lưu trên máy chủ Supabase đặt ngoài lãnh thổ Việt Nam, và được thiết kế để chỉ thiết bị của nhà bạn mở được. Bản chờ duyệt giữ đến khi bạn duyệt hoặc ngắt kết nối. Giao dịch bạn duyệt sẽ vào sổ chi tiêu chung, hiển thị cho các thành viên trong gia đình bạn, đến khi gia đình xoá.',
          'Emails pass through a relay inbox on Gmail, are deleted after 7 days, and are gone for good within about a month. Emails we fail to read are kept longer so we can fix the error, at most 90 days. For a bank we have not seen before, every real amount, name and account number is masked before Google Gemini reads the structure. Real values are never sent to Gemini. Each transaction is sealed on arrival, stored on Supabase servers located outside Vietnam, and designed so only your family’s devices can open it. Pending items are kept until you review them or disconnect. Transactions you approve enter the shared family ledger, visible to your family members, until the family deletes them.'))),
        _cstRow(L('Dùng để làm gì', 'What it is for'), _esc(L(
          'Ghi sổ và quản lý chi tiêu trong ứng dụng, cho chính gia đình bạn. Không bán, không quảng cáo, không chia sẻ cho ai khác ngoài các dịch vụ nêu trên, trừ trường hợp cơ quan nhà nước có thẩm quyền yêu cầu theo đúng quy định pháp luật. Khi đó, với các giá trị đã niêm phong, thứ tụi mình có thể cung cấp chỉ là dữ liệu đã mã hoá.',
          'Recording and managing spending in the app, for your own family. Never sold, never used for ads, never shared beyond the services above, except where a competent state authority lawfully requires it. In that case, for sealed values, what we can produce is ciphertext.'))),
        _cstRow(L('Quyền của bạn', 'Your rights'),
          _esc(L(
            'Đổi ý lúc nào cũng được. Ngắt kết nối trong Cài đặt, và xoá quy tắc chuyển tiếp trong Gmail của bạn, là dừng hẳn. Giao dịch đang chờ duyệt được xoá ngay khi ngắt. Muốn xoá sạch dữ liệu, nhắn tụi mình theo địa chỉ trên. Bạn còn có quyền truy cập, chỉnh sửa, yêu cầu xóa dữ liệu, rút lại sự đồng ý, hạn chế hoặc phản đối xử lý, và phản ánh, khiếu nại. Chi tiết trong ',
            'Change your mind anytime. Disconnecting in Settings, plus deleting your forwarding rule in Gmail, stops everything. Pending transactions are deleted the moment you disconnect. To erase everything, contact us at the address above. You also have the rights to access, correct, request deletion, withdraw consent, restrict or object to processing, and lodge a complaint. Details in the ')) +
          '<a href="./privacy.html" target="_blank" rel="noopener">' + _esc(L('Chính sách quyền riêng tư', 'Privacy Policy')) + '</a>. ' +
          _esc(L('Không đồng ý thì tính năng này không bật, các phần khác của Earthy vẫn dùng bình thường.',
                 'If you decline, only this feature stays off. The rest of Earthy works normally.'))),
      ].join('');

      var footer;
      if (ro) {
        var when = accepted && accepted.consented_at ? new Date(accepted.consented_at) : null;
        footer =
          '<div class="cst-meta">' + _esc(accepted
            ? L('Bạn đã xác nhận đồng ý bản v' + accepted.version + (when ? ' ngày ' + fmtDayMon(when) : '') + '.',
                'You confirmed version v' + accepted.version + (when ? ' on ' + fmtDayMon(when) : '') + '.')
            : L('Chưa có xác nhận nào được ghi nhận.', 'No confirmation on record.')) + '</div>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>';
      } else {
        footer =
          '<button class="cta" id="cst-agree" onclick="fhConsentAgree(this)">' +
            _esc(L('Tôi hiểu và đồng ý', 'I understand and agree')) + '</button>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>';
      }

      _fhSheet(
        '<div class="mbx-hero">' + _mbxGlyph('lock') + '</div>' +
        '<div class="sheet-h">' + _esc(L('Trước khi kết nối, đọc phút này đã nhé', 'One minute before you connect')) + '</div>' +
        '<div class="cst-body">' + vi + '</div>' +
        footer);

      window._cstThen = ro ? null : (opts.then || null);
    };

    /* The affirmative act. The record lands FIRST; the flow resumes only on a
       confirmed insert. A duplicate row (same version, double-tap or a second
       device) reads as already-consented and proceeds. */
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

    /* ── withdrawal ──────────────────────────────────────────────────────────
       Arm-then-confirm (DESIGN: destructive is low-prominence, never one tap).
       The RPC deletes the connection AND the pending staged rows in one
       transaction, then the sheet shows the one step only the person can do:
       delete their own Gmail forwarding rule. */
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
