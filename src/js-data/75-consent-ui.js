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

     The record is the point (0082): agreeing inserts a (user, kind, version)
     row BEFORE the flow continues, and a failed insert blocks rather than
     proceeds. Withdrawal is symmetric per L91 ("việc rút lại phải dễ dàng như
     khi đã đồng ý"): one in-app action, recorded in the same table.

     Copy is the final UX-written pass (2026-08-24): Q&A rows answering the
     reader's actual questions, formal "chúng tôi" register for legal surfaces,
     protection stated as conclusions. It must not drift from
     docs/PDPL-COMPLIANCE.md §5: bump the version constant when either
     changes, and everyone re-consents to the new text. */

  var FH_CONSENT_V = 4;
  var FH_CONSENT_KIND = 'bank_email';
  var FH_APPDATA_CONSENT_V = 1;
  var FH_APPDATA_KIND = 'app_data';
  // Unincorporated today, so the operators are named; swap for a legal entity
  // if one is formed (and bump both versions).
  var FH_DATA_OPERATORS_VI = 'Trang và Hiên';
  var FH_DATA_OPERATORS_EN = 'Trang and Hien';
  var FH_DATA_CONTACT = 'gichisreading@gmail.com';

  /* What changed at each version, keyed by the version it SHIPPED IN.
     Re-asking someone to agree again without saying what moved makes them
     re-read the whole sheet hunting for the difference, which is a dark
     pattern by omission -- and the one thing a person actually wants to know
     at that moment is the one thing the old flow never said.

     When a bump happens, add the entry HERE in the same commit as the version
     constant. The sheet reads it automatically: anyone whose stored consent is
     older sees every entry between their version and the current one, at the
     top, before the body they already know.

     Write each line as the CHANGE, not the state: "we now also send X" beats
     "we protect your data". */
  var FH_CONSENT_CHANGES = {
    bank_email: {
      4: ['Lần đầu gặp một mẫu email của ngân hàng, email đó được gửi nguyên văn cho AI của Google một lần, để học cách đọc mẫu. Những email sau cùng mẫu không được gửi đi nữa.',
          'The first time we meet a new email format from a bank, that email is sent to Google’s AI as written, once, so it can learn how to read the format. Later emails in the same format are not sent at all.'],
    },
    app_data: {},
  };

  /* Entries strictly newer than what they agreed to, oldest first. */
  function _cstChangesSince(kind, priorVersion, currentVersion) {
    var all = FH_CONSENT_CHANGES[kind] || {};
    var out = [];
    for (var v = (priorVersion || 0) + 1; v <= currentVersion; v++) {
      if (all[v]) out.push({ v: v, text: L(all[v][0], all[v][1]) });
    }
    return out;
  }

  /* Wraps the full current text for a RE-consent: present on the screen, but
     collapsed, so the delta above it is what the person actually reads.

     Why collapsed and not a link: the stored record says they agreed to THIS
     version, and if that is ever questioned we have to show this version was
     put in front of them. A screen carrying only the change plus a link to
     the PREVIOUS consent never presents the current one at all, and turns one
     clean proof into a two-part argument. Collapsed costs nothing and keeps
     the proof whole. Reading the older consent lives in Settings, where
     someone who wants it goes looking.

     <details> rather than a JS toggle: open/close, keyboard and screen-reader
     behaviour all come free and correct. */
  function _cstFullTextFold(inner, version) {
    return '<details class="cst-fold">' +
      '<summary class="cst-fold-s">' +
        _esc(L('Đọc toàn bộ nội dung bản v' + version, 'Read the full v' + version + ' text')) +
      '</summary>' +
      '<div class="cst-body">' + inner + '</div>' +
      '</details>';
  }

  /* The block that leads a re-consent. Absent entirely for a first-time
     consent -- there is nothing to have changed, and a "what's new" box on a
     screen someone has never seen is noise. */
  function _cstChangedBlock(kind, prior, current) {
    if (!prior || !prior.version || prior.version >= current) return '';
    var items = _cstChangesSince(kind, prior.version, current);
    if (!items.length) return '';
    var when = prior.consented_at ? new Date(prior.consented_at) : null;
    return '<div class="cst-changed">' +
      '<div class="cst-changed-h">' + _esc(L('Có gì thay đổi từ lần trước',
                                             'What changed since you agreed')) + '</div>' +
      '<ul class="cst-changed-l">' +
        items.map(function (i) { return '<li>' + _esc(i.text) + '</li>'; }).join('') +
      '</ul>' +
      '<div class="cst-changed-f">' + _esc(L(
        'Bạn đã đồng ý bản v' + prior.version + (when ? ' ngày ' + fmtDayMon(when) : '') + '. Phần còn lại giữ nguyên.',
        'You agreed to v' + prior.version + (when ? ' on ' + fmtDayMon(when) : '') + '. Everything else is unchanged.')) + '</div>' +
      '</div>';
  }

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
      /* Hand the record over rather than letting the sheet fetch it again:
         one round trip, and the sheet renders in this turn instead of a
         microtask later, so the CTA does not sit dead after the tap. */
      window.fhConsentSheet({ then: then, prior: rec, priorKnown: true });
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
          .select('version,consented_at')
          .eq('kind', FH_APPDATA_KIND)
          .order('version', { ascending: false })
          .limit(1);
      } catch (e) { return; }   // flaky boot: skip this boot, ask next one
      if (!res || res.error) return;
      var rec = res.data && res.data[0];
      if (rec && rec.version >= FH_APPDATA_CONSENT_V) return;
      window.fhAppDataConsentSheet({ prior: rec, priorKnown: true });
    };

    window.fhAppDataConsentSheet = async function (opts) {
      opts = opts || {};
      var ro = !!opts.readOnly;
      /* Fetched even when asking, not only when reviewing: a re-consent has to
         know which version they last agreed to before it can say what moved. */
      var accepted = opts.prior || null;
      if (!opts.priorKnown) {
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
          '<button class="btn-skip" onclick="fhPrivacySheet()">' + _esc(L('Quay lại', 'Back')) + '</button>';
      } else {
        footer = smallPrint +
          '<button class="cta" onclick="fhAppDataConsentAgree(this)">' + _esc(L('Tôi hiểu và đồng ý', 'I understand and agree')) + '</button>' +
          '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Để sau', 'Not now')) + '</button>';
      }

      var changed1 = ro ? '' : _cstChangedBlock(FH_APPDATA_KIND, accepted, FH_APPDATA_CONSENT_V);
      _fhSheet(
        _cstKicker() +
        '<div class="sheet-h">' + _esc(L('Chuyện tiền của nhà mình, chỉ nhà mình biết.', 'Your family’s money stays your family’s business.')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L('Earthy là cuốn sổ chi tiêu chung của nhà bạn.', 'Earthy is your family’s shared expense book.')) + '</div>' +
        (ro ? '' : changed1) +
        (changed1 ? _cstFullTextFold(rows, FH_APPDATA_CONSENT_V) : '<div class="cst-body">' + rows + '</div>') +
        footer);
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

    /* ── Settings → Quyền riêng tư ──────────────────────────────────────────
       The privacy home. Replaces the single nuclear button that shipped in
       0082 and cost a founder her mailbox connection to one mis-tap.

       Three principles, from the destructive-action research and DESIGN §3:
         * GRANULAR. Withdrawing bank-email consent and erasing everything are
           different rights and different rows. The law treats them separately
           and so does this screen.
         * FRICTION MATCHED TO BLAST RADIUS. Disconnect keeps arm-then-confirm
           (reversible, one flow to redo). Erasure gets a consequence sheet
           plus type-to-confirm, which DESIGN §7 names as the sanctioned
           alternative to arm-then-confirm for this tier.
         * UNDO OVER CONFIRMATION. Erasure schedules rather than executes. The
           72 hours the consent text already promised becomes a visible,
           cancellable window (0084), so a mis-tap costs nothing. */
    var _CST_CHEV = '<svg class="cst-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    var _CST_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18.5A2 2 0 0 0 3.5 21.5h17' +
      'a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/></svg>';

    function _cstGroup(rows, footer) {
      return '<div class="cst-group">' + rows + '</div>' +
        (footer ? '<div class="cst-foot">' + _esc(footer) + '</div>' : '');
    }
    /* A navigable row: the WHOLE row is the target, closed by a chevron. iOS
       never puts a small text button on the right of a row that navigates --
       that shape means "this row does one other thing", which is what the
       connection rows below use it for. */
    /* fn + arg, never a pre-built expression: escAttr turns ' into \' because
       it escapes VALUES inside an attribute, so running it over a whole call
       produced onclick="fhConsentReview(\'app_data\')" -- a syntax error the
       global handler surfaced as "Có lỗi xảy ra". Only the argument is
       escaped, and only as the string literal it actually is. */
    function _cstNavRow(glyph, title, value, fn, arg) {
      var call = (arg === undefined) ? fn + '()' : fn + "('" + _escAttr(arg) + "')";
      return '<button class="cst-lrow" onclick="' + call + '">' +
        '<span class="cst-ic">' + _mbxGlyph(glyph) + '</span>' +
        '<span class="cst-ltxt"><span class="cst-lt">' + _esc(title) + '</span></span>' +
        (value ? '<span class="cst-val">' + _esc(value) + '</span>' : '') +
        _CST_CHEV + '</button>';
    }
    /* A status row: a live-state dot, the account it applies to, and one
       trailing action that is not navigation. */
    function _cstConnRow(glyph, title, sub, action) {
      return '<div class="cst-lrow">' +
        '<span class="cst-ic">' + _mbxGlyph(glyph) + '</span>' +
        '<span class="cst-ltxt"><span class="cst-lt">' + _esc(title) + '</span>' +
          (sub ? '<span class="cst-ls">' + _esc(sub) + '</span>' : '') + '</span>' +
        (action || '') + '</div>';
    }
    function _cstLossRow(glyph, title, sub, calm) {
      return '<div class="cst-lossrow">' +
        '<span class="cst-ic' + (calm ? ' calm' : '') + '">' + _mbxGlyph(glyph) + '</span>' +
        '<div><div class="cst-losst">' + _esc(title) + '</div>' +
          '<div class="cst-losss">' + _esc(sub) + '</div></div></div>';
    }

    async function _cstPrivacyState() {
      var out = { consents: [], deletion: null, alias: null, oauth: null };
      try {
        var c = await sb.from('user_consents').select('kind,version,consented_at')
          .order('consented_at', { ascending: true });
        out.consents = (c.data || []).filter(function (r) { return r.kind.indexOf('withdraw') === -1; });
      } catch (e) {}
      try {
        var d = await sb.from('deletion_requests').select('scheduled_for')
          .is('cancelled_at', null).is('executed_at', null).limit(1);
        out.deletion = (d.data && d.data[0]) || null;
      } catch (e) {}   // table absent (0084 unapplied): behave as no request
      try {
        var st = window.fhMailboxState ? await window.fhMailboxState() : null;
        out.alias = (st && st.forwarding_alias) || null;
      } catch (e) {}
      /* The OAuth mailbox is a SECOND collection channel, behind the Cloud Run
         API rather than our database. A privacy screen that showed only the
         forwarding alias would tell someone their mailbox was disconnected
         while the watcher still read it. */
      try {
        out.oauth = window.fhAutoTxnConnection ? await window.fhAutoTxnConnection() : null;
      } catch (e) {}
      return out;
    }

    var _CST_LABELS = {
      app_data:   ['Dữ liệu ứng dụng', 'App data', 'lock'],
      bank_email: ['Email ngân hàng', 'Bank email', 'mail'],
    };

    window.fhPrivacySheet = async function () {
      var st = await _cstPrivacyState();
      var body = '';

      /* A live deletion request outranks everything else on this screen: it is
         the one thing with a clock on it, and cancelling must be the easiest
         action here, not buried under the rows it would erase. */
      if (st.deletion) {
        var when = new Date(st.deletion.scheduled_for);
        body +=
          '<div class="cst-pending">' +
            '<div class="cst-ph">' + _CST_WARN +
              '<span class="cst-pt">' + _esc(L('Đang chờ xoá dữ liệu', 'Deletion scheduled')) + '</span></div>' +
            '<div class="cst-ps">' + _esc(L(
              'Toàn bộ dữ liệu của bạn sẽ được xoá vào ' + fmtDayMon(when) + '. Trước lúc đó, bạn vẫn đổi ý được.',
              'All your data will be deleted on ' + fmtDayMon(when) + '. You can still change your mind before then.')) + '</div>' +
            '<button class="btn-line" onclick="fhCancelDeletion(this)">' +
              _esc(L('Huỷ yêu cầu xoá', 'Cancel the deletion')) + '</button>' +
          '</div>';
      }

      // What you agreed to, one row per purpose, each independently withdrawable.
      var crows = '';
      st.consents.forEach(function (c) {
        var lbl = _CST_LABELS[c.kind] || [c.kind, c.kind];
        var d = c.consented_at ? new Date(c.consented_at) : null;
        crows += _cstNavRow(lbl[2], L(lbl[0], lbl[1]), d ? fmtDayMon(d) : '',
          'fhConsentReview', c.kind);
      });
      if (crows) {
        body += '<div class="cst-sech">' + _esc(L('Điều bạn đã đồng ý', 'What you agreed to')) + '</div>' +
          _cstGroup(crows, L('Chạm để đọc lại đúng nội dung bạn đã đồng ý.',
                             'Tap to re-read exactly what you agreed to.'));
      }

      /* Both collection channels, each independently stoppable. Forwarding is
         ours to delete in SQL; the OAuth grant lives behind the API, so its row
         hands off to the module that owns it. */
      var conn = '';
      if (st.alias) {
        conn += _cstConnRow('fwd', L('Chuyển tiếp email', 'Email forwarding'), st.alias + '@…',
          '<button class="cst-stop" onclick="fhMailboxDisconnect(this)">' +
            _esc(L('Ngắt', 'Stop')) + '</button>');
      }
      if (st.oauth) {
        conn += _cstConnRow('auto', L('Đọc trực tiếp hộp thư', 'Direct mailbox read'),
          (st.oauth.email || L('Tài khoản Google', 'Google account')),
          '<button class="cst-stop" onclick="fhAutoTxnDisconnect(this)">' +
            _esc(L('Ngắt', 'Stop')) + '</button>');
      }
      if (conn) {
        body += '<div class="cst-sech">' + _esc(L('Kết nối email ngân hàng', 'Bank email connections')) + '</div>' +
          _cstGroup(conn, L('Ngắt sẽ dừng đọc email mới ngay. Các khoản đã vào sổ vẫn được giữ.',
                            'Stopping ends new reads at once. Anything already in your ledger stays.'));
      }

      // Erasure. Low prominence by DESIGN §3, and it opens a consequence sheet
      // rather than doing anything itself.
      if (!st.deletion) {
        body += '<div class="cst-group cst-dgroup">' +
            '<button class="cst-drow" onclick="fhDeleteAllSheet()">' +
              _esc(L('Xoá toàn bộ dữ liệu', 'Delete all my data')) + '</button>' +
          '</div>' +
          '<div class="cst-foot">' + _esc(L(
            'Xoá vĩnh viễn tài khoản và mọi dữ liệu của bạn. Bạn có 72 giờ để đổi ý trước khi việc xoá diễn ra.',
            'Permanently deletes your account and all your data. You have 72 hours to change your mind before it happens.')) + '</div>';
      }

      _fhSheet(
        '<div class="sheet-h">' + _esc(L('Quyền riêng tư', 'Privacy')) + '</div>' +
        '<div class="cst-body">' + body + '</div>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>');
    };

    /* Read the exact text a given consent was given against. */
    window.fhConsentReview = function (kind) {
      if (kind === FH_CONSENT_KIND) return window.fhConsentSheet({ readOnly: true });
      return window.fhAppDataConsentSheet({ readOnly: true });
    };

    window.fhCancelDeletion = async function (btn) {
      if (btn) { btn.disabled = true; btn.textContent = L('Đang huỷ…', 'Cancelling…'); }
      try {
        await _rpc('cancel_my_deletion', {});
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = L('Huỷ yêu cầu xoá', 'Cancel the deletion'); }
        window.toast && window.toast(L('Chưa huỷ được, thử lại nhé', 'Could not cancel, try again'));
        return;
      }
      window.toast && window.toast(L('Đã huỷ. Dữ liệu của bạn được giữ nguyên.', 'Cancelled. Your data stays.'));
      window.fhPrivacySheet();
    };

    /* The consequence sheet. Names the object, the counts, the ripple, and the
       irreversibility -- the four things destructive-confirm copy is supposed
       to carry and the two-tap arm carried none of. */
    window.fhDeleteAllSheet = async function () {
      var n = null;
      try {
        var fid = window.DB && window.DB.fid;
        if (fid) {
          var r = await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('family_id', fid);
          n = typeof r.count === 'number' ? r.count : null;
        }
      } catch (e) {}

      _fhSheet(
        '<div class="sheet-h">' + _esc(L('Xoá toàn bộ dữ liệu?', 'Delete all your data?')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L(
          'Đọc kỹ ba điều dưới đây trước khi xác nhận.',
          'Three things to be sure of before you confirm.')) + '</div>' +
        '<div class="cst-loss">' +
          _cstLossRow('lock', L('Tài khoản và sổ chi tiêu của bạn', 'Your account and your ledger'),
            L((n === null ? 'Các khoản thu chi' : n + ' khoản thu chi') + ', ghi chú, ảnh đính kèm và mọi mục bạn đã đồng ý. Không khôi phục được.',
              (n === null ? 'Your transactions' : n + ' transactions') + ', notes, photos and every consent you gave. Nothing can be recovered.')) +
          _cstLossRow('fwd', L('Những khoản bạn đã ghi vào sổ chung', 'What you added to the shared ledger'),
            L('Sẽ biến mất khỏi sổ của gia đình. Các thành viên khác giữ nguyên tài khoản của họ.',
              'Disappears from your family’s book. Other members keep their own accounts.')) +
          _cstLossRow('check', L('Bạn có 72 giờ để đổi ý', 'You have 72 hours to change your mind'),
            L('Việc đọc email dừng ngay hôm nay. Phần còn lại xoá sau 72 giờ, huỷ được bất cứ lúc nào trong mục Quyền riêng tư.',
              'Email reading stops today. The rest is deleted after 72 hours, cancellable any time in Privacy.'), true) +
        '</div>' +
        '<div class="field cst-type"><label>' + _esc(L('Gõ “xoá dữ liệu” để xác nhận', 'Type “delete my data” to confirm')) + '</label>' +
          '<input id="cst-type-in" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" ' +
            'oninput="fhDeleteAllTyped(this)" placeholder="' + _escAttr(L('xoá dữ liệu', 'delete my data')) + '"></div>' +
        '<div class="cst-group cst-dgroup">' +
          '<button class="cst-drow" id="cst-del-go" disabled onclick="fhDeleteAllConfirm(this)">' +
            _esc(L('Xoá toàn bộ dữ liệu', 'Delete all my data')) + '</button>' +
        '</div>' +
        '<button class="btn-skip" onclick="fhPrivacySheet()">' + _esc(L('Không, giữ lại', 'No, keep my data')) + '</button>');
    };

    /* The phrase is the friction. Matching is lenient about case and spacing
       and strict about the words: a confirmation nobody can pass is theatre,
       one you pass by leaning on the keyboard is not friction. */
    window.fhDeleteAllTyped = function (el) {
      var want = L('xoá dữ liệu', 'delete my data');
      var got = String(el.value || '').trim().toLowerCase().replace(/\s+/g, ' ');
      var alt = want.normalize('NFD').replace(/[̀-ͯ]/g, '');
      var gotAlt = got.normalize('NFD').replace(/[̀-ͯ]/g, '');
      var ok = got === want || gotAlt === alt;
      var btn = document.getElementById('cst-del-go');
      if (btn) btn.disabled = !ok;
    };

    window.fhDeleteAllConfirm = async function (btn) {
      if (!btn || btn.disabled) return;
      btn.disabled = true; btn.textContent = L('Đang ghi nhận…', 'Recording…');
      var res = await sb.from('user_consents').insert({ kind: 'app_data_withdraw', version: FH_APPDATA_CONSENT_V });
      var dup = res.error && /duplicate key|already exists/i.test(res.error.message || '');
      if (res.error && !dup) {
        btn.disabled = false; btn.textContent = L('Xoá toàn bộ dữ liệu', 'Delete all my data');
        window.toast && window.toast(L('Chưa ghi nhận được, thử lại nhé', 'Could not record it, try again'));
        return;
      }
      /* Stop the OAuth watcher too. request_my_deletion removes the forwarding
         connection in SQL, but the direct-read grant lives behind the API and
         only the client can end it. Best-effort and BEFORE the RPC, so a
         failure here still leaves the request unmade and retryable rather than
         scheduling an erasure while a mailbox keeps being read. */
      var oauthStopped = true;
      try {
        if (window.fhAutoTxnStop) oauthStopped = (await window.fhAutoTxnStop()) !== false;
      } catch (e) { oauthStopped = false; }
      var sched = null;
      try {
        var r = await _rpc('request_my_deletion', {});
        sched = r && r.scheduled_for ? new Date(r.scheduled_for) : null;
      } catch (e) {
        btn.disabled = false; btn.textContent = L('Xoá toàn bộ dữ liệu', 'Delete all my data');
        window.toast && window.toast(L('Chưa ghi nhận được, thử lại nhé', 'Could not record it, try again'));
        return;
      }
      _fhSheet(
        '<div class="sheet-h">' + _esc(L('Đã ghi nhận yêu cầu', 'Your request is recorded')) + '</div>' +
        '<div class="sheet-sub">' + _esc(L(
          'Dữ liệu của bạn sẽ được xoá' + (sched ? ' vào ' + fmtDayMon(sched) : ' sau 72 giờ') +
          '. Đổi ý lúc nào cũng được, vào Cài đặt, mục Quyền riêng tư.',
          'Your data will be deleted' + (sched ? ' on ' + fmtDayMon(sched) : ' in 72 hours') +
          '. Change your mind any time in Settings, under Privacy.')) + '</div>' +
        /* Say what actually happened. The OAuth stop can fail on its own (it is
           a separate API), and announcing "email has stopped" when it has not
           is the one lie this screen must never tell. */
        '<div class="sheet-sub">' + _esc(oauthStopped
          ? L('Việc đọc email ngân hàng đã dừng.', 'Bank email reading has stopped.')
          : L('Chưa dừng được việc đọc trực tiếp hộp thư. Vào Cài đặt, mục Quyền riêng tư để ngắt lại.',
              'We could not stop the direct mailbox read. Open Settings, Privacy, to stop it there.')) + '</div>' +
        '<button class="btn-line" onclick="fhPrivacySheet()">' + _esc(L('Xem lại', 'Review')) + '</button>' +
        '<button class="btn-skip" onclick="_closeOv()">' + _esc(L('Đóng', 'Close')) + '</button>');
    };

    /* ── layer 2: the bank-email consent ────────────────────────────────────── */
    window.fhConsentSheet = async function (opts) {
      opts = opts || {};
      var ro = !!opts.readOnly;
      // The re-consent needs the prior version to say what moved. The gate
      // usually hands it over; only fetch when it did not.
      var accepted = opts.prior || null;
      if (!opts.priorKnown) { try { accepted = await _cstFetch(); } catch (e) {} }

      var rows =
        _cstRow(L('Có ai đọc được email của tôi không?', 'Can anyone read my emails?'), _esc(L(
          'Lần đầu gặp một mẫu email của ngân hàng, tụi mình gửi email đó cho AI của Google một lần, để học cách đọc mẫu đó. Những email sau cùng mẫu được đọc ngay tại hệ thống, không gửi đi đâu nữa. Email trong hộp thư trung gian tự xoá sau 7 ngày; email không đọc được giữ tối đa 90 ngày rồi cũng xoá.',
          'The first time we meet a new email format from a bank, we send that one email to Google’s AI once, to learn how to read that format. Every later email in the same format is read on our own systems and goes nowhere. Emails in the relay inbox delete themselves after 7 days; ones we could not read are kept at most 90 days, then deleted too.'))) +
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

      var changed = ro ? '' : _cstChangedBlock(FH_CONSENT_KIND, accepted, FH_CONSENT_V);
      _fhSheet(
        _cstKicker(L('EMAIL NGÂN HÀNG', 'BANK EMAIL')) +
        '<div class="sheet-h">' + _esc(L('Ngân hàng gửi, Earthy niêm phong, nhà bạn mở.', 'Your bank sends it, Earthy seals it, your family opens it.')) + '</div>' +
        (ro ? '' : changed) +
        (changed ? _cstFullTextFold(rows, FH_CONSENT_V) : '<div class="cst-body">' + rows + '</div>') +
        footer);

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
        }, 10000);
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
