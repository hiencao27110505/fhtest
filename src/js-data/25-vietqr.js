  /* ═══ VietQR — client-side, offline (0122) ═══════════════════════════════════
     docs/specs/lending-capture-spec.md §5. Builds the NAPAS IBFT-to-account
     EMVCo payload (bank BIN + account + amount + memo) entirely on-device —
     no external service, no CDN — and renders it through the existing QR
     encoder (16-qr.js, extended to v6 for this payload size). Every VN banking
     app scans this format.

     The BIN table is static NAPAS data (public routing codes, not secrets).
     Keyed by the canonical provider slugs the pipeline already writes into
     personal_accounts.provider, plus common aliases for hand-picked banks. */
  (function () {
    const BINS = [
      { bin: '970436', name: 'Vietcombank', m: ['vietcombank', 'vcb'] },
      { bin: '970407', name: 'Techcombank', m: ['techcombank', 'tcb'] },
      { bin: '970422', name: 'MB Bank', m: ['mbbank', 'mb bank', 'mb'] },
      { bin: '970416', name: 'ACB', m: ['acb'] },
      { bin: '970415', name: 'VietinBank', m: ['vietinbank', 'ctg'] },
      { bin: '970418', name: 'BIDV', m: ['bidv'] },
      { bin: '970405', name: 'Agribank', m: ['agribank'] },
      { bin: '970432', name: 'VPBank', m: ['vpbank', 'vpb'] },
      { bin: '970423', name: 'TPBank', m: ['tpbank', 'tpb'] },
      { bin: '970403', name: 'Sacombank', m: ['sacombank', 'stb'] },
      { bin: '970441', name: 'VIB', m: ['vib'] },
      { bin: '970443', name: 'SHB', m: ['shb'] },
      { bin: '970437', name: 'HDBank', m: ['hdbank', 'hdb'] },
      { bin: '970448', name: 'OCB', m: ['ocb'] },
      { bin: '970426', name: 'MSB', m: ['msb', 'maritime'] },
      { bin: '970440', name: 'SeABank', m: ['seabank'] },
      { bin: '970431', name: 'Eximbank', m: ['eximbank', 'eib'] },
      { bin: '970449', name: 'LPBank', m: ['lpbank', 'lienviet', 'lienvietpostbank'] },
      { bin: '970428', name: 'Nam Á Bank', m: ['namabank', 'nam a'] },
      { bin: '970409', name: 'Bắc Á Bank', m: ['bacabank', 'bac a'] },
      { bin: '970454', name: 'BVBank', m: ['bvbank', 'vietcapital', 'viet capital'] },
      { bin: '970425', name: 'ABBank', m: ['abbank'] },
      { bin: '970412', name: 'PVcomBank', m: ['pvcombank'] },
      { bin: '970452', name: 'KienlongBank', m: ['kienlongbank', 'kienlong'] },
      { bin: '970419', name: 'NCB', m: ['ncb'] },
      { bin: '970427', name: 'VietABank', m: ['vietabank', 'viet a'] },
      { bin: '970406', name: 'DongA Bank', m: ['donga', 'dong a'] },
      { bin: '963388', name: 'Timo', m: ['timo'] },
      { bin: '546034', name: 'CAKE', m: ['cake'] },
    ];
    window.fhVietQRBanks = function () { return BINS.map((b) => ({ bin: b.bin, name: b.name })); };
    /* provider slug / free-text name → BIN, or null when unknown (the sheet
       then asks the person to pick their bank once). */
    window.fhVietQRBinFor = function (provider) {
      const p = String(provider || '').toLowerCase().trim();
      if (!p) return null;
      for (const b of BINS) if (b.m.some((m) => p === m || p.indexOf(m) === 0 || m.indexOf(p) === 0)) return b.bin;
      return null;
    };

    /* CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — the EMVCo checksum. */
    function _crc16(str) {
      let crc = 0xFFFF;
      for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
      }
      return crc.toString(16).toUpperCase().padStart(4, '0');
    }
    const _tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;

    /* amountD = VND đồng (display units, integer). memo: A–Z 0–9 space only —
       normalized here so no bank app chokes on diacritics. */
    window.fhVietQRPayload = function (opts) {
      const bin = String(opts.bin || ''), acct = String(opts.account || '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(bin) || !/^[A-Za-z0-9]{4,19}$/.test(acct)) return null;
      const consumer = _tlv('00', bin) + _tlv('01', acct);
      const merchant = _tlv('00', 'A000000727') + _tlv('01', consumer) + _tlv('02', 'QRIBFTTA');
      let p = _tlv('00', '01') + _tlv('01', opts.amountD > 0 ? '12' : '11') + _tlv('38', merchant) + _tlv('53', '704');
      if (opts.amountD > 0) p += _tlv('54', String(Math.round(opts.amountD)));
      p += _tlv('58', 'VN');
      let memo = String(opts.memo || '');
      if (memo) {
        memo = (typeof deburr === 'function' ? deburr(memo) : memo).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25);
        if (memo) p += _tlv('62', _tlv('08', memo));
      }
      p += '6304';
      return p + _crc16(p);
    };
  })();
