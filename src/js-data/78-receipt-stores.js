/* ═══ Settings › Hoá đơn — which stores' receipts this mailbox reads
   (receipt-providers-spec.md §3.1, §10, RP5, RP11)

   Three lists in the mailbox status sheet, rendered from the same data the
   worker reads so the consent's "listed in Settings" is true by construction:
     Đang đọc   — registry receipt senders (FH_PROVIDERS.receiptSenders) plus
                  global fast-lane rows (known_provider_domains, kind receipt),
                  each with a per-mailbox switch (receipt_sender_mutes);
     Gợi ý      — discovery's candidates with a receipt/bill verdict and no
                  promotion yet, with a Thêm button (RPC receipt_sender_add);
     Đề xuất    — one line for a store discovery never saw.
   A member's add is GLOBAL (every consenting mailbox reads the store from the
   next run); mute is this mailbox only. There is no field to type an address
   into, by design. */
(function () {
  'use strict';
  const _sb = () => window.sb;
  const _e = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const _famLbl = { marketplace_order: ['hoá đơn đơn hàng', 'order receipts'], subscription_invoice: ['hoá đơn thuê bao', 'subscription receipts'],
                    service_receipt: ['hoá đơn chuyến đi, dịch vụ', 'ride and service receipts'], model_only: ['hoá đơn', 'receipts'] };
  const _sw = (on, click, label) => '<button type="button" class="rcs-sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + _e(label) + '" onclick="' + click + '"><span class="rcs-knob"></span></button>';

  async function load(conn) {
    const out = { reading: [], suggested: [], mutes: new Set(), consentOk: true };
    try {
      const reg = (window.FH_PROVIDERS && FH_PROVIDERS.receiptSenders) ? FH_PROVIDERS.receiptSenders() : [];
      const seen = new Set();
      for (const r of reg) { if (seen.has(r.key)) continue; seen.add(r.key); out.reading.push({ key: r.key, label: r.label, sender: r.sender, family: r.family, since: r.since, by: null }); }
      const sb = _sb(); if (!sb) return out;
      const [kpd, cand, mut] = await Promise.all([
        sb.from('known_provider_domains').select('domain_or_address,provider_name,family,added_by').eq('kind', 'receipt').eq('active', true),
        sb.from('receipt_candidates').select('id,sender,subject_template,store_name,verdict,seen,last_seen_at').in('verdict', ['receipt', 'bill']).is('promoted_at', null).order('seen', { ascending: false }).limit(30),
        conn && conn.id ? sb.from('receipt_sender_mutes').select('sender').eq('grant_id', conn.id) : Promise.resolve({ data: [] }),
      ]);
      for (const r of (kpd && kpd.data) || []) out.reading.push({ key: 'kpd:' + r.domain_or_address, label: r.provider_name || r.domain_or_address, sender: r.domain_or_address, family: r.family || 'model_only', since: 7, by: r.added_by ? 'member' : 'operator' });
      // One row per sender in Gợi ý: the templates fold into a count.
      const bySender = new Map();
      for (const c of (cand && cand.data) || []) {
        const k = c.sender; const g = bySender.get(k) || { id: c.id, sender: k, store: c.store_name || k.split('@')[1], verdict: c.verdict, seen: 0, last: null };
        g.seen += Number(c.seen || 0); if (c.last_seen_at && (!g.last || c.last_seen_at > g.last)) g.last = c.last_seen_at;
        if (!g.store && c.store_name) g.store = c.store_name;
        bySender.set(k, g);
      }
      out.suggested = [...bySender.values()].sort((a, b) => b.seen - a.seen);
      for (const m of (mut && mut.data) || []) out.mutes.add(String(m.sender || '').toLowerCase());
    } catch (e) { /* the section degrades to the registry list */ }
    return out;
  }

  function _dateShort(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : (d.getDate() + ' thg ' + (d.getMonth() + 1)); }

  function render(st, conn) {
    const muted = st.mutes;
    let h = '<div class="rcs-sec">' + _e(L('Hoá đơn', 'Receipts')) + '</div>';
    h += '<div class="rcs-note">' + _e(L('Tụi mình đọc hoá đơn từ các cửa hàng dưới đây, chỉ để gắn chi tiết món hàng vào giao dịch đã ghi.', 'We read receipts from the stores below, only to attach item details to transactions already captured.')) + '</div>';
    h += '<div class="rcs-lbl">' + _e(L('Đang đọc', 'Reading')) + '</div><div class="rl-list">';
    for (const r of st.reading) {
      const fam = _famLbl[r.family] || _famLbl.model_only;
      const sub = (r.by === 'member' ? L('Do thành viên thêm · ', 'Added by a member · ') : '') + L(fam[0], fam[1]);
      const on = !muted.has(String(r.sender).toLowerCase());
      h += '<div class="rl-row"><span class="rl-t"><b>' + _e(r.label) + '</b><small>' + _e(sub) + '</small></span>'
        + _sw(on, 'fhReceiptStoreToggle(\'' + _e(r.sender) + '\',' + (on ? 'false' : 'true') + ')', L((on ? 'Tắt ' : 'Bật ') + r.label + ' cho hộp thư này', (on ? 'Turn off ' : 'Turn on ') + r.label + ' for this mailbox')) + '</div>';
    }
    h += '</div>';
    if (st.suggested.length) {
      h += '<div class="rcs-lbl">' + _e(L('Gợi ý', 'Suggested')) + '</div><div class="rl-list">';
      for (const c of st.suggested) {
        const meta = [c.seen + ' email', c.last ? L('gần nhất ' + _dateShort(c.last), 'last ' + _dateShort(c.last)) : null, c.verdict === 'bill' ? L('hoá đơn dịch vụ', 'a bill') : L('hoá đơn mua hàng', 'a receipt')].filter(Boolean).join(' · ');
        h += '<div class="rl-row"><span class="rl-t"><b>' + _e(c.store) + '</b><small>' + _e(meta) + '</small></span>'
          + '<button type="button" class="rcs-add" onclick="fhReceiptStoreAddAsk(\'' + _e(c.id) + '\',\'' + _e(c.store).replace(/'/g, '') + '\')">' + _e(L('Thêm', 'Add')) + '</button></div>';
      }
      h += '</div>';
    }
    h += '<button type="button" class="rcs-propose" onclick="fhReceiptStorePropose()">' + _e(L('Thiếu cửa hàng nào? Gửi đề xuất', 'Missing a store? Suggest one')) + '</button>';
    return h;
  }

  let _conn = null, _state = null;
  window.fhReceiptStoresPaint = async function (conn) {
    _conn = conn || _conn;
    const el = document.getElementById('atx-rc'); if (!el) return;
    _state = await load(_conn);
    const el2 = document.getElementById('atx-rc'); if (!el2) return;
    el2.innerHTML = render(_state, _conn);
  };

  window.fhReceiptStoreToggle = async function (sender, on) {
    const sb = _sb(); if (!sb || !_conn || !_conn.id) return;
    try {
      if (on) await sb.from('receipt_sender_mutes').delete().eq('grant_id', _conn.id).eq('sender', sender);
      else await sb.from('receipt_sender_mutes').insert({ grant_id: _conn.id, sender: sender });
      if (window.toast) toast(on ? L('Sẽ đọc lại từ lần kế', 'Reading again from the next run') : L('Đã tắt cho hộp thư này', 'Off for this mailbox'));
    } catch (e) { if (window.toast) toast(L('Chưa lưu được, thử lại nhé', 'Could not save, try again')); }
    fhReceiptStoresPaint(_conn);
  };

  /* The one sheet before a global add: says plainly that other members'
     mailboxes read the store too. */
  window.fhReceiptStoreAddAsk = function (candidateId, store) {
    if (typeof _pexdChoices !== 'function') { fhReceiptStoreAdd(candidateId); return; }
    const body = '<div class="rcs-ask">' + _e(L('Tụi mình sẽ đọc email hoá đơn từ ' + store + ' trong hộp thư này và của các thành viên khác đã đồng ý, chỉ để gắn chi tiết món hàng vào giao dịch đã ghi. Không bao giờ tự tạo giao dịch. Địa chỉ và số điện thoại không được đọc.',
      'We will read receipt emails from ' + store + ' in this mailbox and in other consenting members\' mailboxes, only to attach item details to transactions already captured. Never to create a transaction. Addresses and phone numbers are not read.')) + '</div>'
      + '<button type="button" class="choice on" onclick="closeSheet();fhReceiptStoreAdd(\'' + _e(candidateId) + '\')">' + _e(L('Thêm ' + store, 'Add ' + store)) + '</button>'
      + '<button type="button" class="choice" onclick="closeSheet()">' + _e(L('Để sau', 'Later')) + '</button>';
    _pexdChoices(L('Đọc hoá đơn từ ' + store + '?', 'Read receipts from ' + store + '?'), '', body);
  };
  window.fhReceiptStoreAdd = async function (candidateId) {
    const sb = _sb(); if (!sb) return;
    try {
      const r = await sb.rpc('receipt_sender_add', { p_candidate: candidateId });
      if (r.error) throw r.error;
      if (window.toast) toast(L('Đã thêm. Đọc từ lần kế.', 'Added. Reading from the next run.'));
    } catch (e) { if (window.toast) toast(L('Chưa thêm được, thử lại nhé', 'Could not add, try again')); }
    fhReceiptStoresPaint(_conn);
  };
  window.fhReceiptStorePropose = function () {
    if (typeof window.fhFeedbackOpen === 'function') { fhFeedbackOpen(L('Đề xuất cửa hàng đọc hoá đơn: ', 'Suggest a receipt store: ')); return; }
    if (typeof _pexdChoices === 'function') _pexdChoices(L('Đề xuất cửa hàng', 'Suggest a store'), '', '<div class="rcs-ask">' + _e(L('Gửi tên cửa hàng cho tụi mình qua mục Góp ý trong Cài đặt. Khi app gặp email hoá đơn từ cửa hàng đó, nó sẽ hiện ở Gợi ý.', 'Send the store name through Feedback in Settings. Once the app meets a receipt email from it, it appears under Suggested.')) + '</div>');
  };
})();
