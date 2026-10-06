/* ═══ Settings › Hoá đơn — which stores' receipts this mailbox reads
   (receipt-providers-spec.md §3.1, §10, RP5, RP11)

   Two short lists in the mailbox status sheet, rendered from the same data
   the worker reads, so the consent's "listed in Settings" is true by
   construction:
     Đọc hoá đơn từ — registry receipt senders (FH_PROVIDERS.receiptSenders)
                      plus global fast-lane rows (known_provider_domains, kind
                      receipt). Each ROW is the switch (receipt_sender_mutes);
     Gợi ý thêm     — discovery's candidates with a receipt/bill verdict and no
                      promotion yet, each with a Thêm pill (receipt_sender_add).
   A member's add is GLOBAL (every consenting mailbox reads the store from the
   next run); a switch is this mailbox only. There is no field to type an
   address into, by design.

   Built from the sheet's own kit, nothing new to learn: the eyebrow label
   (.atx-seq-lbl), the list row (.rl-row / .rl-t), the iOS switch (.cry-sw),
   and for the one confirmation the sheet's primary and skip buttons. */
(function () {
  'use strict';
  const _sbc = () => window.sb;
  const _e = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const _toast = (m) => { if (window.toast) window.toast(m); };

  async function load(conn) {
    const out = { reading: [], suggested: [], mutes: new Set() };
    try {
      const reg = (window.FH_PROVIDERS && FH_PROVIDERS.receiptSenders) ? FH_PROVIDERS.receiptSenders() : [];
      const seen = new Set();
      for (const r of reg) { if (seen.has(r.key)) continue; seen.add(r.key); out.reading.push({ label: r.label, sender: r.sender, by: null }); }
      const sb = _sbc(); if (!sb) return out;
      const [kpd, cand, mut] = await Promise.all([
        sb.from('known_provider_domains').select('domain_or_address,provider_name,added_by').eq('kind', 'receipt').eq('active', true),
        sb.from('receipt_candidates').select('id,sender,store_name,seen,last_seen_at').in('verdict', ['receipt', 'bill']).is('promoted_at', null).order('seen', { ascending: false }).limit(30),
        conn && conn.id ? sb.from('receipt_sender_mutes').select('sender').eq('grant_id', conn.id) : Promise.resolve({ data: [] }),
      ]);
      for (const r of (kpd && kpd.data) || []) out.reading.push({ label: r.provider_name || r.domain_or_address, sender: r.domain_or_address, by: r.added_by ? 'member' : null });
      // One row per sender under Gợi ý: its subject shapes fold into one count.
      const bySender = new Map();
      for (const c of (cand && cand.data) || []) {
        const g = bySender.get(c.sender) || { id: c.id, sender: c.sender, store: c.store_name || String(c.sender).split('@')[1] || c.sender, seen: 0, last: null };
        g.seen += Number(c.seen || 0);
        if (c.last_seen_at && (!g.last || c.last_seen_at > g.last)) g.last = c.last_seen_at;
        bySender.set(c.sender, g);
      }
      out.suggested = [...bySender.values()].sort((a, b) => b.seen - a.seen).slice(0, 6);
      for (const m of (mut && mut.data) || []) out.mutes.add(String(m.sender || '').toLowerCase());
    } catch (e) { /* the section degrades to the registry list */ }
    return out;
  }

  const _day = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : (d.getDate() + ' thg ' + (d.getMonth() + 1)); };

  function render(st) {
    let h = '<div class="rcs">';
    h += '<div class="atx-seq-lbl">' + _e(L('Đọc hoá đơn từ', 'Reading receipts from')) + '</div><div class="rcs-list">';
    for (const r of st.reading) {
      const on = !st.mutes.has(String(r.sender).toLowerCase());
      h += '<button type="button" class="rl-row" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" onclick="fhReceiptStoreToggle(\'' + _e(r.sender) + '\',' + (on ? 'false' : 'true') + ')">'
        + '<span class="rl-t"><b>' + _e(r.label) + '</b>' + (r.by === 'member' ? '<small>' + _e(L('Do thành viên thêm', 'Added by a member')) + '</small>' : '') + '</span>'
        + '<span class="cry-sw' + (on ? ' on' : '') + '"></span></button>';
    }
    h += '</div><div class="rcs-foot">' + _e(L('Chỉ để gắn chi tiết món hàng vào giao dịch đã ghi. Tắt ở đây chỉ tắt cho hộp thư này.',
      'Only to attach item details to transactions already captured. Switching one off affects this mailbox only.')) + '</div>';
    if (st.suggested.length) {
      h += '<div class="atx-seq-lbl">' + _e(L('Gợi ý thêm', 'Suggested')) + '</div><div class="rcs-list">';
      for (const c of st.suggested) {
        const meta = c.seen + ' email' + (c.last ? L(' · gần nhất ' + _day(c.last), ' · last ' + _day(c.last)) : '');
        h += '<div class="rl-row"><span class="rl-t"><b>' + _e(c.store) + '</b><small>' + _e(meta) + '</small></span>'
          + '<button type="button" class="rcs-add" onclick="fhReceiptStoreAddAsk(\'' + _e(c.id) + '\',\'' + _e(c.store).replace(/'/g, '') + '\')">' + _e(L('Thêm', 'Add')) + '</button></div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  let _conn = null;
  window.fhReceiptStoresPaint = async function (conn) {
    _conn = conn || _conn;
    if (!document.getElementById('atx-rc')) return;
    const st = await load(_conn);
    const el = document.getElementById('atx-rc'); if (el) el.innerHTML = render(st);
  };

  window.fhReceiptStoreToggle = async function (sender, on) {
    const sb = _sbc(); if (!sb || !_conn || !_conn.id) return;
    try {
      const r = on ? await sb.from('receipt_sender_mutes').delete().eq('grant_id', _conn.id).eq('sender', sender)
                   : await sb.from('receipt_sender_mutes').insert({ grant_id: _conn.id, sender: sender });
      if (r && r.error) throw r.error;
      _toast(on ? L('Đã bật lại', 'Back on') : L('Đã tắt cho hộp thư này', 'Off for this mailbox'));
    } catch (e) { _toast(L('Chưa lưu được, thử lại', 'Couldn’t save, try again')); }
    fhReceiptStoresPaint(_conn);
  };

  /* The one question before a global add, asked in the sheet the list lives
     in, with the sheet's own primary and skip buttons. It says plainly that
     other members' mailboxes will read the store too. Để sau goes back. */
  window.fhReceiptStoreAddAsk = function (candidateId, store) {
    const back = 'fhReceiptStoreBack()';
    const html = '<div class="sheet-h">' + _e(L('Đọc hoá đơn từ ' + store + '?', 'Read receipts from ' + store + '?')) + '</div>'
      + '<div class="sheet-sub">' + _e(L(
        'Tụi mình sẽ đọc email hoá đơn từ ' + store + ' ở hộp thư này và của các thành viên khác đã đồng ý, chỉ để gắn chi tiết món hàng vào giao dịch đã ghi. Không tự tạo giao dịch, không đọc địa chỉ hay số điện thoại.',
        'We’ll read receipt emails from ' + store + ' in this mailbox and in other consenting members’ mailboxes, only to attach item details to transactions already captured. No transaction is created, and no address or phone number is read.')) + '</div>'
      + '<button class="cta" onclick="fhReceiptStoreAdd(\'' + _e(candidateId) + '\',\'' + _e(store).replace(/'/g, '') + '\')">' + _e(L('Thêm ' + store, 'Add ' + store)) + '</button>'
      + '<button class="btn-skip" onclick="' + back + '">' + _e(L('Để sau', 'Not now')) + '</button>';
    if (typeof _fhSheet === 'function') _fhSheet(html);
  };
  window.fhReceiptStoreBack = function () {
    if (_conn && typeof window.fhAutoTxnStatus === 'function') window.fhAutoTxnStatus(_conn);
    else if (typeof window._closeOv === 'function') window._closeOv();
  };
  window.fhReceiptStoreAdd = async function (candidateId, store) {
    const sb = _sbc(); if (!sb) return;
    try {
      const r = await sb.rpc('receipt_sender_add', { p_candidate: candidateId });
      if (r.error) throw r.error;
      _toast(L('Đã thêm ' + (store || 'cửa hàng'), 'Added ' + (store || 'the store')));
    } catch (e) { _toast(L('Chưa thêm được, thử lại', 'Couldn’t add, try again')); }
    window.fhReceiptStoreBack();
  };
})();
