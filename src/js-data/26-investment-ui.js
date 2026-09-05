  /* ═══ Đầu tư — UI + data (docs/specs/investment-spec.md) ═══════════════════
     The asset side of the personal ledger. One primitive: a POSITION — a
     personal_accounts row with kind='investment' — whose VND balance is
     DERIVED (net-invested = Σ buys − Σ sells), the card-outstanding pattern
     one shelf over. A buy/sell is ONE kind='investment' row: it debits or
     credits the cash account it touched and accrues to the position via
     position_account_id. No pair, no counterparty — the OTC seller is a memo.

     Sign convention, inside the ciphertext, from MY point of view:
       buy:  amount −X (money left the funding account) · quantity +q
       sell: amount +X (money landed)                   · quantity −q
     so position net-invested = Σ(−amount) and holding = Σ quantity.
     Negative net-invested is "đã rút hơn vốn" (house money), not an error.

     Prices are CLIENT-SIDE ONLY (spec I4): a public API for crypto, fetched
     on this device and cached in localStorage; a manual price is stored
     encrypted on the position row (the ext_balance_enc pattern) so it syncs
     between the owner's devices. Whichever is fresher wins. No server
     component ever sees a price.

     Lives in js-data (module scope) like 23-debts-ui so it can use _fhModal;
     renderPersonal reaches it via window.persInvest* exports. Amounts are
     base units (thousands); parseAmtBase / fmt are classic-script globals. */
  (function () {
    const _e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _P = () => window.fhPersonalData && fhPersonalData();
    const _enc = (v) => window.FHCrypto.encVal(_P().key, v);
    const _sbi = () => window.sb;
    const _todayIso = function () {
      const n = new Date();
      return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    };
    const _dmy = (iso) => { if (!iso) return ''; const p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1]; };
    const _fmtQty = function (q) {
      if (q == null || !isFinite(q)) return '';
      const s = String(Math.round(Math.abs(q) * 1e8) / 1e8);
      return (q < 0 ? '−' : '') + s;
    };
    /* asset classes — drive the unit hint, the price route, and grouping */
    const CLS = { crypto: 'Crypto', gold: 'Vàng', stock: 'Chứng khoán', fund: 'Chứng chỉ quỹ', other: 'Khác' };
    const _ago = function (iso) {
      if (!iso) return null;
      const ms = Date.now() - new Date(iso).getTime();
      if (ms < 90 * 60000) return 'vừa cập nhật';
      if (ms < 26 * 3600000) return Math.round(ms / 3600000) + ' giờ trước';
      return Math.round(ms / 86400000) + ' ngày trước';
    };

    /* ── price cache — device-local, per uid, fetched prices only ──────────── */
    const _PK = () => 'fh-invprice:' + (((_P() || {}).uid) || '');
    const _cacheAll = function () { try { return JSON.parse(localStorage.getItem(_PK()) || '{}'); } catch (e) { return {}; } };
    const _cacheGet = (sym) => sym ? (_cacheAll()[String(sym).toLowerCase()] || null) : null;
    const _cacheSet = function (sym, priceK) {
      if (!sym) return;
      const all = _cacheAll();
      all[String(sym).toLowerCase()] = { k: priceK, at: new Date().toISOString() };
      try { localStorage.setItem(_PK(), JSON.stringify(all)); } catch (e) {}
    };
    /* CoinGecko ids for the common symbols; anything else tries the lowercase
       symbol as an id and quietly gives up. Manual price is always available. */
    const CG = { btc: 'bitcoin', eth: 'ethereum', usdt: 'tether', usdc: 'usd-coin', bnb: 'binancecoin',
      sol: 'solana', xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', trx: 'tron', ton: 'the-open-network',
      ltc: 'litecoin', dot: 'polkadot', avax: 'avalanche-2', link: 'chainlink', near: 'near', vndc: 'vndc' };
    let _fetchedAt = 0, _fetching = false;
    /* Fetch is fail-quiet and throttled: a flaky API can never block the bento
       (spec I11) — the worst case is a staleness label. */
    window.fhInvPriceRefresh = async function (force) {
      const P = _P(); if (!P || !P.key) return false;
      if (_fetching) return false;
      if (!force && Date.now() - _fetchedAt < 2 * 60000) return false;
      const syms = (P.accounts || []).filter((a) => a.kind === 'investment' && (a.assetClass || 'other') === 'crypto' && a.assetSymbol)
        .map((a) => String(a.assetSymbol).toLowerCase());
      if (!syms.length) return false;
      const ids = {}; syms.forEach((s) => { ids[CG[s] || s] = s; });
      _fetching = true;
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(Object.keys(ids).join(',')) + '&vs_currencies=vnd');
        if (!r.ok) throw new Error('price http ' + r.status);
        const j = await r.json();
        let got = 0;
        for (const id in j) if (j[id] && j[id].vnd > 0 && ids[id]) { _cacheSet(ids[id], j[id].vnd / 1000); got++; }
        _fetchedAt = Date.now();
        if (got) { _redraw(); _reopen(); }
        return got > 0;
      } catch (e) { console.warn('inv price fetch failed', e); return false; }
      finally { _fetching = false; }
    };

    /* ── the derivation — spec §5.1's ladder, computed not stored ──────────── */
    window.fhInvPositions = function () {
      const P = _P(); if (!P || !P.key) return null;
      const accts = (P.accounts || []).filter((a) => a.kind === 'investment');
      const rows = (P.debts || []).filter((d) => d.kind === 'investment' && d.positionId);
      const by = {};
      for (const a of accts) by[a.id] = { acct: a, netK: 0, qty: 0, qtyPartial: false, unreadable: 0, rows: [] };
      for (const r of rows) {
        const b = by[r.positionId]; if (!b) continue;   // archived position's rows stay out of view
        b.rows.push(r);
        if (r._unreadable || r.amt == null) { b.unreadable++; continue; }
        b.netK += -r.amt;                               // buy −X → +X invested
        if (r.qty != null) b.qty += r.qty; else b.qtyPartial = true;
      }
      const out = [];
      for (const id in by) {
        const b = by[id], a = b.acct;
        /* freshest of (manual on the row, fetched in the device cache) wins —
           "manual is authoritative until refreshed deliberately" (I4) */
        const c = _cacheGet(a.assetSymbol);
        let priceK = null, priceAt = null, priceSrc = null;
        if (a.manualPriceK != null) { priceK = a.manualPriceK; priceAt = a.manualPriceAt; priceSrc = 'manual'; }
        if (c && (!priceAt || new Date(c.at) > new Date(priceAt))) { priceK = c.k; priceAt = c.at; priceSrc = 'api'; }
        const holding = (b.qty > 0 && !b.qtyPartial) ? b.qty : (b.qty > 0 ? b.qty : null);
        const valueK = (holding != null && priceK != null) ? holding * priceK : null;
        /* the ladder: value → cost basis → house money; displayK is the rung */
        const displayK = valueK != null ? valueK : b.netK;
        const plK = (valueK != null) ? valueK - b.netK : null;
        out.push({ id: id, name: a.name || 'Vị thế', symbol: a.assetSymbol, unit: a.assetUnit,
          klass: a.assetClass || 'other', netK: b.netK, qty: b.qty, qtyPartial: b.qtyPartial,
          holding: holding, priceK: priceK, priceAt: priceAt, priceSrc: priceSrc,
          valueK: valueK, displayK: displayK, plK: plK,
          pctPl: (valueK != null && b.netK > 0) ? (valueK - b.netK) / b.netK * 100 : null,
          unreadable: b.unreadable, rows: b.rows });
      }
      out.sort((x, y) => (y.displayK || 0) - (x.displayK || 0));
      const priced = out.filter((p) => p.valueK != null);
      return { positions: out,
        totalK: out.reduce((s, p) => s + (p.displayK > 0 ? p.displayK : 0), 0),
        mixed: priced.length > 0 && priced.length < out.filter((p) => p.netK > 0).length,
        plK: priced.length ? priced.reduce((s, p) => s + p.plK, 0) : null,
        plBaseK: priced.reduce((s, p) => s + (p.netK > 0 ? p.netK : 0), 0) };
    };
    /* Month flows for the cash-flow card: visible-but-not-expense (I6/I8). */
    window.fhInvMonthFlows = function (monKey) {
      const P = _P(); if (!P || !P.key) return { out: 0, inn: 0 };
      let out = 0, inn = 0;
      for (const t of (P.txns || [])) {
        if (t.kind !== 'investment' || t._unreadable || t.amt == null) continue;
        if (monKey && String(t.date).slice(0, 7) !== monKey) continue;
        if (t.amt < 0) out += -t.amt; else inn += t.amt;
      }
      return { out: out, inn: inn };
    };

    /* ── writers — self-contained; every path funnels through re-hydrate ───── */
    window.fhInvPositionCreate = async function (name, symbol, unit, klass) {
      const P = _P(); if (!P || !P.key || !name) return null;
      const row = { owner_user_id: P.uid, kind: 'investment', human_verified: true,
        name_enc: await _enc(name),
        asset_symbol_enc: symbol ? await _enc(symbol) : null,
        asset_unit_enc: unit ? await _enc(unit) : null,
        asset_class_enc: await _enc(klass || 'other') };
      const r = await _sbi().from('personal_accounts').insert(row).select('id').single();
      if (r.error) { console.warn('position create failed', r.error); return null; }
      await window.fhPersonalHydrate();
      return r.data.id;
    };
    window.fhInvPositionUpdate = async function (id, fields) {
      const P = _P(); if (!P || !P.key || !id) return false;
      const row = {};
      if (fields.name) row.name_enc = await _enc(fields.name);
      if (fields.hasOwnProperty('symbol')) row.asset_symbol_enc = fields.symbol ? await _enc(fields.symbol) : null;
      if (fields.hasOwnProperty('unit')) row.asset_unit_enc = fields.unit ? await _enc(fields.unit) : null;
      if (fields.klass) row.asset_class_enc = await _enc(fields.klass);
      if (fields.archive) row.archived_at = new Date().toISOString();
      const r = await _sbi().from('personal_accounts').update(row).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'investment');
      if (r.error) { console.warn('position update failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhInvManualPriceSet = async function (id, priceK) {
      const P = _P(); if (!P || !P.key || !id || !(priceK > 0)) return false;
      const r = await _sbi().from('personal_accounts').update({
        manual_price_enc: await _enc(Number(priceK)), manual_price_at: new Date().toISOString(),
      }).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'investment');
      if (r.error) { console.warn('manual price failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* One leg, one real event. dir 'buy'|'sell'; amtK > 0; qty optional (>0). */
    window.fhInvAdd = async function (o) {
      const P = _P(); if (!P || !P.key || !(o && o.amtK > 0) || !o.positionId) return false;
      const sign = o.dir === 'sell' ? 1 : -1;
      const row = { owner_user_id: P.uid, txn_date: o.dateIso || _todayIso(),
        kind: 'investment', space_id: null, link_id: null,
        amount_enc: await _enc(sign * Number(o.amtK)),
        quantity_enc: (o.qty > 0) ? await _enc(-sign * Number(o.qty)) : null,
        note_enc: o.note ? await _enc(o.note) : null,
        account_id: o.accountId || null,
        position_account_id: o.positionId,
        source: o.source || null };
      const r = await _sbi().from('personal_transactions').insert(row);
      if (r.error) { console.warn('investment row failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    /* Edit keeps the row's direction — the sheet takes positives and re-signs. */
    window.fhInvRowUpdate = async function (id, fields) {
      const P = _P(); if (!P || !P.key || !id) return false;
      const cur = (P.debts || []).find((d) => d.id === id); if (!cur) return false;
      const sell = cur.amt != null ? cur.amt > 0 : false;
      const row = {};
      if (fields.amtK > 0) row.amount_enc = await _enc((sell ? 1 : -1) * Number(fields.amtK));
      if (fields.hasOwnProperty('qty')) row.quantity_enc = (fields.qty > 0) ? await _enc((sell ? -1 : 1) * Number(fields.qty)) : null;
      if (fields.hasOwnProperty('note')) row.note_enc = fields.note ? await _enc(fields.note) : null;
      if (fields.dateIso) row.txn_date = fields.dateIso;
      const r = await _sbi().from('personal_transactions').update(row).eq('id', id).eq('owner_user_id', P.uid).eq('kind', 'investment').is('link_id', null);
      if (r.error) { console.warn('investment row update failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };

    /* ── counterparty → position memory (spec I9) — pre-select, never commit ─ */
    /* Same normalization shape as csvPatternKey (57-csv-import-review): deburr,
       lowercase, letters-only. Digits are stripped on purpose — the same OTC
       seller arrives with a different transfer ref every time. */
    const _memKey = function (raw) {
      if (!raw) return null;
      const d = window.deburr ? deburr(String(raw).toLowerCase()) : String(raw).toLowerCase();
      const k = d.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      return k || null;
    };
    window.fhInvMemoryMatch = function (raw) {
      const P = _P(); if (!P || !P.key) return null;
      const k = _memKey(raw); if (!k) return null;
      const hit = (P.memory || []).find((m) => m.key === k);
      if (!hit) return null;
      const pos = (P.accounts || []).find((a) => a.id === hit.positionId && a.kind === 'investment');
      return pos ? hit.positionId : null;
    };
    window.fhInvMemorySave = async function (raw, positionId) {
      const P = _P(); if (!P || !P.key || !positionId) return false;
      const k = _memKey(raw); if (!k) return false;
      const hit = (P.memory || []).find((m) => m.key === k);
      try {
        if (hit) {
          if (hit.positionId === positionId) return true;
          await _sbi().from('personal_review_memory').update({ position_account_id: positionId }).eq('id', hit.id).eq('owner_user_id', P.uid);
          hit.positionId = positionId;
        } else {
          const r = await _sbi().from('personal_review_memory').insert({ owner_user_id: P.uid, key_enc: await _enc(k), position_account_id: positionId }).select('id').single();
          if (!r.error) (P.memory = P.memory || []).push({ id: r.data.id, key: k, positionId: positionId });
        }
      } catch (e) { console.warn('inv memory save failed', e); }
      return true;
    };

    /* ── the bento (zoom out) ──────────────────────────────────────────────── */
    const _delta = function (p) {
      if (p.netK < -0.5 && p.valueK == null) return '<span class="inv-up">đã rút hơn vốn ' + fmt(-p.netK) + '</span>';
      if (p.plK == null) return '<span class="inv-cost">· giá vốn</span>';
      const up = p.plK >= 0, pct = p.pctPl != null ? Math.abs(p.pctPl).toFixed(1).replace(/\.0$/, '') + '%' : fmt(Math.abs(p.plK));
      return '<span class="' + (up ? 'inv-up' : 'inv-down') + '">' + (up ? '▲ +' : '▼ −') + pct + '</span>';
    };
    window.persInvestSection = function () {
      const P = _P(); if (!P || !P.key) return '';
      const v = fhInvPositions(); if (!v) return '';
      const fl = fhInvMonthFlows((new Date()).getFullYear() + '-' + String((new Date()).getMonth() + 1).padStart(2, '0'));
      let h = '<div id="pers-invest-wrap">';
      h += '<div class="section-h" id="pers-invest-h"><span class="t">Đầu tư</span>'
        + '<span class="acts"><a onclick="fhInvPriceRefresh(true);toast&&toast(\'Đang cập nhật giá…\')">Cập nhật giá</a>'
        + '<a onclick="fhInvNewPositionSheet()">＋ Vị thế</a></span></div>';
      if (!v.positions.length) {
        h += '<section class="dbt-empty"><div class="dbt-empty-t">Theo dõi crypto, vàng, chứng khoán — tiền mua không tính là chi tiêu.</div>'
          + '<button class="dbt-empty-cta" onclick="fhInvNewPositionSheet()">＋ Vị thế đầu tư</button></section></div>';
        return h;
      }
      const tiles = [];
      /* hero: best-effort total + lãi/lỗ over priced positions only (I12) */
      const pl = v.plK != null ? ('<span class="' + (v.plK >= 0 ? 'inv-up' : 'inv-down') + '">' + (v.plK >= 0 ? '▲ +' : '▼ −') + fmt(Math.abs(v.plK))
        + (v.plBaseK > 0 ? ' (' + (v.plK >= 0 ? '+' : '−') + Math.abs(v.plK / v.plBaseK * 100).toFixed(1).replace(/\.0$/, '') + '%)' : '') + '</span>') : '';
      tiles.push('<section class="dbt-tile wide inv-hero">'
        + '<div class="dbt-tk">Giá trị hiện tại' + (v.mixed ? ' <span class="inv-stale">· một phần theo giá vốn</span>' : '') + '</div>'
        + '<div class="dbt-tv inv-total">' + fmt(v.totalK) + '</div>'
        + (pl ? '<div class="dbt-ts">' + pl + '</div>' : '')
        + ((fl.out > 0.5 || fl.inn > 0.5) ? '<div class="dbt-ts inv-flow">' + (fl.out > 0.5 ? 'Đầu tư tháng này ' + fmt(fl.out) : '')
          + (fl.out > 0.5 && fl.inn > 0.5 ? ' · ' : '') + (fl.inn > 0.5 ? 'Rút ' + fmt(fl.inn) : '') + '</div>' : '')
        + '</section>');
      for (const p of v.positions) {
        const hold = p.qty > 0 ? ('<span class="inv-qty">' + (p.qtyPartial ? '≈' : '') + _fmtQty(p.qty) + (p.unit ? ' ' + _e(p.unit) : '') + '</span>') : '';
        const stale = (p.valueK != null && p.priceAt) ? ('<span class="inv-stale">giá ' + _ago(p.priceAt) + '</span>') : '';
        tiles.push('<section class="dbt-tile" onclick="openInvPosition(\'' + p.id + '\')">'
          + '<div class="dbt-tk">' + _e(p.name) + '</div>'
          + '<div class="dbt-tv">' + fmt(p.displayK) + '</div>'
          + '<div class="dbt-ts">' + hold + (hold ? ' · ' : '') + _delta(p) + (stale ? ' · ' + stale : '') + '</div>'
          + '</section>');
      }
      if (tiles.length % 2 === 1) tiles[tiles.length - 1] = tiles[tiles.length - 1].replace('class="dbt-tile', 'class="dbt-tile wide');
      h += '<div class="debt-bento">' + tiles.join('') + '</div></div>';
      return h;
    };
    window.persInvestAfterRender = function () { fhInvPriceRefresh(false); };
    function _redraw() {
      const el = document.getElementById('pers-invest-wrap');
      if (el) { const h = persInvestSection(); if (h) el.outerHTML = h; }
    }

    /* ── the zoom-in overlay — DOM built lazily so index.html stays untouched ─ */
    let _openPosId = null;
    function _ensureOv() {
      if (document.getElementById('invest-overlay')) return;
      const d = document.createElement('div');
      d.className = 'overlay'; d.id = 'invest-overlay';
      d.innerHTML = '<div class="safe"></div><div class="cd-nav">'
        + '<button class="cd-back" onclick="closeInvest()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg><span>Tài Chính</span></button></div>'
        + '<h1 class="txn-title" id="inv-title">Đầu tư</h1>'
        + '<div class="cd-scroll" id="inv-scroll"><div id="inv-body"></div><div class="spacer"></div></div>';
      document.body.appendChild(d);
    }
    window.closeInvest = function () {
      _openPosId = null;
      const d = document.getElementById('invest-overlay'); if (d) d.classList.remove('on');
    };
    function _reopen() { if (_openPosId && document.getElementById('invest-overlay') && document.getElementById('invest-overlay').classList.contains('on')) openInvPosition(_openPosId); }

    window.openInvPosition = function (posId) {
      const P = _P(); const v = fhInvPositions(); if (!v) return;
      const p = v.positions.find((x) => x.id === posId); if (!p) return;
      _ensureOv(); _openPosId = posId;
      const acctName = (id) => { const a = (P.accounts || []).find((x) => x.id === id); return a ? (a.name || '') : ''; };
      let b = '<div class="dbt-hero2"><div class="dbt-hk">' + (p.valueK != null ? 'Giá trị hiện tại' : (p.netK < -0.5 ? 'Đã rút hơn vốn' : 'Đã đầu tư (giá vốn)')) + '</div>'
        + '<div class="dbt-hv">' + fmt(Math.abs(p.displayK)) + '</div>'
        + '<div class="dbt-hs">' + (p.qty > 0 ? (p.qtyPartial ? '≈' : '') + _fmtQty(p.qty) + (p.unit ? ' ' + _e(p.unit) : '') + ' · ' : '') + _delta(p) + '</div>'
        + (p.valueK != null ? '<div class="dbt-hs">Vốn ròng ' + fmt(p.netK) + (p.qty > 0 && p.netK > 0 ? ' · vốn TB ' + fmt(p.netK / p.qty) + '/' + _e(p.unit || 'đv') : '') + '</div>' : '')
        + '<div class="dbt-hs">' + (p.priceK != null
          ? 'Giá ' + fmt(p.priceK) + '/' + _e(p.unit || 'đv') + ' · ' + (_ago(p.priceAt) || '') + (p.priceSrc === 'manual' ? ' · tự nhập' : '')
          : 'Chưa có giá — hiển thị theo giá vốn')
        + ' · <a class="dbt-relink" onclick="fhInvPriceSheet(\'' + p.id + '\')">cập nhật giá</a></div>'
        + (p.unreadable ? '<div class="dbt-hs">Có ' + p.unreadable + ' khoản chưa đọc được — chưa tính vào vốn.</div>' : '')
        + '</div>';
      b += '<div class="dbt-acts">'
        + '<button class="dbt-btn primary" onclick="fhInvTradeSheet(\'' + p.id + '\',\'buy\')">Mua thêm</button>'
        + '<button class="dbt-btn tinted" onclick="fhInvTradeSheet(\'' + p.id + '\',\'sell\')">Bán bớt</button></div>';
      b += '<div class="dbt-acts2"><a onclick="fhInvEditSheet(\'' + p.id + '\')">Sửa vị thế</a></div>';
      if (p.rows.length) {
        b += '<div class="dbt-sec">Lịch sử</div><div class="dbt-card">';
        const rows = p.rows.slice().sort((a, c) => (c.date + (c.ts || '')).localeCompare(a.date + (a.ts || '')));
        for (const r of rows) {
          const sell = r.amt != null && r.amt > 0;
          b += '<div class="dbt-li tap" onclick="fhInvRowSheet(\'' + r.id + '\')">'
            + '<div class="dbt-lib"><div class="dbt-lin">' + (sell ? 'Bán' : 'Mua') + (r.qty != null ? ' · ' + _fmtQty(Math.abs(r.qty)) + (p.unit ? ' ' + _e(p.unit) : '') : '') + '</div>'
            + '<div class="dbt-lis">' + _dmy(r.date) + (r.accountId ? ' · ' + _e(acctName(r.accountId)) : '') + (r.note ? ' · ' + _e(r.note) : '') + '</div></div>'
            + '<div class="dbt-liv ' + (sell ? 'owed' : '') + '">' + (r.amt == null ? '—' : (sell ? '+' : '−') + fmt(Math.abs(r.amt))) + '</div></div>';
        }
        b += '</div>';
      }
      document.getElementById('inv-title').textContent = p.name;
      document.getElementById('inv-body').innerHTML = b;
      document.getElementById('invest-overlay').classList.add('on');
      const sc = document.getElementById('inv-scroll'); if (sc) sc.scrollTop = 0;
    };

    /* ── sheets — all via _fhModal, no bespoke DOM ──────────────────────────── */
    const _amtIn2 = (id, label, ph) => '<div class="field"><label>' + label + '</label><input class="num" id="' + id + '" inputmode="numeric" placeholder="' + (ph || '0 ₫') + '" oninput="fhModalDirty()"></div>';
    const _amtOf2 = (id) => { const el = document.getElementById(id); return el ? (window.parseAmtBase ? parseAmtBase(el.value) : 0) : 0; };
    const _qtyIn = (id, unit) => '<div class="field"><label>Số lượng <span class="opt">· tuỳ chọn' + (unit ? ' · ' + _e(unit) : '') + '</span></label><input id="' + id + '" inputmode="decimal" placeholder="vd. 0.0025" oninput="fhModalDirty()"></div>';
    const _qtyOf = (id) => { const el = document.getElementById(id); if (!el) return null; const n = Number(String(el.value).replace(',', '.').trim()); return (isFinite(n) && n > 0) ? n : null; };
    const _valOf = (id) => ((document.getElementById(id) || {}).value || '').trim();

    window.fhInvNewPositionSheet = function (onDone) {
      const P = _P(); if (!P || !P.key) { window.toast && toast('Mở khoá sổ cá nhân trước'); return; }
      const kchip = (k, on) => '<button class="choice' + (on ? ' on' : '') + '" data-v="' + k + '" onclick="pick(\'inv-klass\',this)">' + CLS[k] + '</button>';
      _fhModal({
        title: 'Vị thế đầu tư mới', saveLabel: 'Tạo', reqMsg: 'Đặt tên cho vị thế nhé',
        body: '<div class="field"><label>Tên</label><input id="inv-pname" placeholder="vd. Bitcoin, Vàng nhẫn, CP FPT" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Loại</label><div class="choices" id="inv-klass">' + Object.keys(CLS).map((k) => kchip(k, k === 'crypto')).join('') + '</div></div>'
          + '<div class="field"><label>Mã <span class="opt">· tuỳ chọn — crypto tự cập nhật giá theo mã</span></label><input id="inv-psym" placeholder="vd. BTC" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Đơn vị <span class="opt">· tuỳ chọn</span></label><input id="inv-punit" placeholder="vd. BTC, chỉ, CP, CCQ" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">Tiền mua vào không tính là chi tiêu — nó hiện thành dòng "Đầu tư tháng này" riêng.</div>',
        required: function () { return [{ el: document.getElementById('inv-pname'), ok: !!_valOf('inv-pname') }]; },
        save: async function () {
          const id = await fhInvPositionCreate(_valOf('inv-pname'), _valOf('inv-psym') || null, _valOf('inv-punit') || null, (typeof chosen === 'function' && chosen('inv-klass')) || 'other');
          if (!id) throw new Error('save_failed');
          window.toast && toast('Đã tạo vị thế');
          return function () {
            if (typeof onDone === 'function') onDone(id);
            else { if (window.renderPersonal) renderPersonal(); openInvPosition(id); }
          };
        },
      });
    };
    window.fhInvTradeSheet = function (posId, dir) {
      const P = _P(); const v = fhInvPositions(); const p = v && v.positions.find((x) => x.id === posId); if (!p) return;
      const sell = dir === 'sell';
      const accts = (P.accounts || []).filter((a) => a.kind !== 'credit_card' && a.kind !== 'investment');
      const chip = (a, on) => '<button class="choice' + (on ? ' on' : '') + '" data-v="' + a.id + '" onclick="pick(\'inv-acct\',this)">' + _e(a.name || 'Tài khoản') + '</button>';
      _fhModal({
        title: (sell ? 'Bán bớt — ' : 'Mua thêm — ') + _e(p.name), saveLabel: 'Ghi lại', reqMsg: 'Nhập số tiền nhé',
        body: _amtIn2('inv-amt', sell ? 'Tiền nhận về' : 'Tiền mua')
          + _qtyIn('inv-qty', p.unit)
          + '<div class="field"><label>' + (sell ? 'Tiền về đâu?' : 'Trả từ đâu?') + ' <span class="opt">· tuỳ chọn</span></label><div class="choices" id="inv-acct">'
          + '<button class="choice on" data-v="" onclick="pick(\'inv-acct\',this)">Không gắn</button>' + accts.map((a) => chip(a, false)).join('') + '</div></div>'
          + '<div class="field"><label>Ngày</label><input type="date" id="inv-date" value="' + _todayIso() + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Ghi chú <span class="opt">· tuỳ chọn</span></label><input id="inv-note" placeholder="' + (sell ? 'vd. chốt lời một phần' : 'vd. mua OTC qua anh X') + '" oninput="fhModalDirty()"></div>'
          + '<div class="dbt-note">' + (sell ? 'Không tính là thu nhập — hiện thành dòng "Rút đầu tư" riêng.' : 'Không tính là chi tiêu — hiện thành dòng "Đầu tư tháng này" riêng.') + '</div>',
        required: function () { return [{ el: document.getElementById('inv-amt'), ok: _amtOf2('inv-amt') > 0 }]; },
        save: async function () {
          const ok = await fhInvAdd({ dir: dir, amtK: _amtOf2('inv-amt'), positionId: posId,
            accountId: (typeof chosen === 'function' && chosen('inv-acct')) || null,
            qty: _qtyOf('inv-qty'), note: _valOf('inv-note') || null,
            dateIso: _valOf('inv-date') || undefined, source: 'manual' });
          if (!ok) throw new Error('save_failed');
          window.toast && toast(sell ? 'Đã ghi bán — không tính thu nhập' : 'Đã ghi mua — không tính chi tiêu');
          return function () { if (window.renderPersonal) renderPersonal(); openInvPosition(posId); };
        },
      });
    };
    window.fhInvPriceSheet = function (posId) {
      const v = fhInvPositions(); const p = v && v.positions.find((x) => x.id === posId); if (!p) return;
      _fhModal({
        title: 'Giá hiện tại — ' + _e(p.name), saveLabel: 'Lưu giá', reqMsg: 'Nhập giá mỗi ' + (p.unit || 'đơn vị'),
        body: _amtIn2('inv-price', 'Giá mỗi ' + _e(p.unit || 'đơn vị'), p.priceK != null ? fmt(p.priceK) : '0 ₫')
          + '<div class="dbt-note">' + (p.priceK != null ? 'Đang dùng: ' + fmt(p.priceK) + ' · ' + (_ago(p.priceAt) || '') + (p.priceSrc === 'manual' ? ' · tự nhập' : ' · tự động') + '. ' : '')
          + 'Giá chỉ để tính lãi/lỗ trên máy bạn — không gửi đi đâu.</div>',
        required: function () { return [{ el: document.getElementById('inv-price'), ok: _amtOf2('inv-price') > 0 }]; },
        save: async function () {
          const ok = await fhInvManualPriceSet(posId, _amtOf2('inv-price'));
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã lưu giá');
          return function () { _redraw(); openInvPosition(posId); };
        },
      });
    };
    window.fhInvEditSheet = function (posId) {
      const v = fhInvPositions(); const p = v && v.positions.find((x) => x.id === posId); if (!p) return;
      const kchip = (k) => '<button class="choice' + (k === p.klass ? ' on' : '') + '" data-v="' + k + '" onclick="pick(\'inv-klass\',this)">' + CLS[k] + '</button>';
      _fhModal({
        title: 'Sửa vị thế', saveLabel: 'Lưu', reqMsg: 'Tên không được trống',
        body: '<div class="field"><label>Tên</label><input id="inv-pname" value="' + _e(p.name) + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Loại</label><div class="choices" id="inv-klass">' + Object.keys(CLS).map(kchip).join('') + '</div></div>'
          + '<div class="field"><label>Mã <span class="opt">· tuỳ chọn</span></label><input id="inv-psym" value="' + _e(p.symbol || '') + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Đơn vị <span class="opt">· tuỳ chọn</span></label><input id="inv-punit" value="' + _e(p.unit || '') + '" oninput="fhModalDirty()"></div>'
          + '<button class="dbt-btn danger" id="inv-arch" onclick="fhInvArchTap(\'' + p.id + '\',this)">Lưu trữ vị thế</button>'
          + '<div class="dbt-note">Lưu trữ ẩn vị thế khỏi bento; các khoản mua/bán đã ghi vẫn nằm trong sổ.</div>',
        required: function () { return [{ el: document.getElementById('inv-pname'), ok: !!_valOf('inv-pname') }]; },
        save: async function () {
          const ok = await fhInvPositionUpdate(posId, { name: _valOf('inv-pname'), symbol: _valOf('inv-psym') || null,
            unit: _valOf('inv-punit') || null, klass: (typeof chosen === 'function' && chosen('inv-klass')) || p.klass });
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã lưu');
          return function () { if (window.renderPersonal) renderPersonal(); openInvPosition(posId); };
        },
      });
    };
    /* archive is arm-then-confirm, like the transfer-pair delete */
    window.fhInvArchTap = async function (posId, btn) {
      if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Bấm lần nữa để lưu trữ'; return; }
      const ok = await fhInvPositionUpdate(posId, { archive: true });
      if (!ok) { window.toast && toast('Chưa lưu trữ được, thử lại'); return; }
      window.toast && toast('Đã lưu trữ vị thế');
      if (window.fhModalClose) fhModalClose();
      closeInvest(); if (window.renderPersonal) renderPersonal();
    };
    window.fhInvRowSheet = function (rowId) {
      const P = _P(); const r = (P.debts || []).find((d) => d.id === rowId); if (!r) return;
      const v = fhInvPositions(); const p = v && v.positions.find((x) => x.id === r.positionId);
      const sell = r.amt != null && r.amt > 0;
      _fhModal({
        title: (sell ? 'Khoản bán' : 'Khoản mua') + (p ? ' — ' + _e(p.name) : ''), saveLabel: 'Lưu', reqMsg: 'Số tiền phải lớn hơn 0',
        body: _amtIn2('inv-amt', sell ? 'Tiền nhận về' : 'Tiền mua', r.amt == null ? '0 ₫' : fmt(Math.abs(r.amt)))
          + _qtyIn('inv-qty', p && p.unit)
          + '<div class="field"><label>Ngày</label><input type="date" id="inv-date" value="' + _e(r.date) + '" oninput="fhModalDirty()"></div>'
          + '<div class="field"><label>Ghi chú <span class="opt">· tuỳ chọn</span></label><input id="inv-note" value="' + _e(r.note || '') + '" oninput="fhModalDirty()"></div>'
          + '<button class="dbt-btn danger" id="inv-del" onclick="fhInvRowDelTap(\'' + r.id + '\',this)">Xoá khoản này</button>',
        after: function () { const q = document.getElementById('inv-qty'); if (q && r.qty != null) q.value = _fmtQty(Math.abs(r.qty)); const a = document.getElementById('inv-amt'); if (a && r.amt != null) a.value = (window.amtToInput ? amtToInput(Math.abs(r.amt)) : String(Math.abs(r.amt))); },
        required: function () { return [{ el: document.getElementById('inv-amt'), ok: _amtOf2('inv-amt') > 0 }]; },
        save: async function () {
          const ok = await fhInvRowUpdate(rowId, { amtK: _amtOf2('inv-amt'), qty: _qtyOf('inv-qty'),
            note: _valOf('inv-note') || null, dateIso: _valOf('inv-date') || undefined });
          if (!ok) throw new Error('save_failed');
          window.toast && toast('Đã lưu');
          return function () { if (window.renderPersonal) renderPersonal(); if (r.positionId) openInvPosition(r.positionId); };
        },
      });
    };
    /* ── Committed-row flip (spec §8): "đây là khoản đầu tư" ─────────────────
       The retroactive correction for the original itch — an OTC transfer that
       landed as an expense. Opened from the personal expense editor (55), the
       fhExpenseToLoanSheet pattern one shelf over. In-place flip: same id,
       date, account, note, photos; category drops; amount re-signs to buy. */
    window.fhExpenseToInvestSheet = function (id) {
      const P = _P(); if (!P || !P.key) return;
      const t = (P.txns || []).find((x) => x.id === id);
      if (!t || t.kind !== 'expense' || t.spaceId || t.linkId) return;
      const poss = (P.accounts || []).filter((a) => a.kind === 'investment');
      const chip = (a) => '<button class="choice" data-v="' + a.id + '" onclick="pick(\'inv-cvpos\',this)">' + _e(a.name || 'Vị thế') + '</button>';
      _fhModal({
        title: 'Chuyển thành khoản đầu tư', saveLabel: 'Chuyển', reqMsg: 'Chọn hoặc tạo vị thế nhé',
        body: '<div class="dbt-note">Khoản <b class="num">' + fmt(Math.abs(t.amt || 0)) + '</b>' + (t.note ? ' · ' + _e(t.note) : '')
          + ' sẽ rời khỏi chi tiêu tháng và cộng vào vốn của vị thế — không tính là chi tiêu nữa.</div>'
          + (poss.length ? '<div class="field"><label>Vị thế</label><div class="choices" id="inv-cvpos">' + poss.map(chip).join('') + '</div></div>' : '')
          + '<div class="field"><label>' + (poss.length ? 'Hoặc tạo vị thế mới' : 'Vị thế mới') + '</label><input id="inv-cvnew" placeholder="vd. Bitcoin" oninput="fhModalDirty()"></div>'
          + _qtyIn('inv-cvqty', null),
        required: function () {
          const picked = (typeof chosen === 'function' && chosen('inv-cvpos')) || null;
          return [{ el: document.getElementById('inv-cvnew'), ok: !!(picked || _valOf('inv-cvnew')) }];
        },
        save: async function () {
          let posId = (typeof chosen === 'function' && chosen('inv-cvpos')) || null;
          if (!posId) {
            posId = await fhInvPositionCreate(_valOf('inv-cvnew'), null, null, 'other');
            if (!posId) throw new Error('save_failed');
          }
          const ok = await window.fhPersonalConvertToInvestment(id, posId, _qtyOf('inv-cvqty'));
          if (!ok) throw new Error('save_failed');
          /* the seller in the note becomes the remembered mapping too (I9) */
          if (t.note) { try { fhInvMemorySave(t.note, posId); } catch (e) {} }
          window.toast && toast('Đã chuyển thành đầu tư — xem ở bento Đầu tư');
          return function () {
            if (window.renderPersonal) renderPersonal();
            if (typeof refreshPersonalTxnOverlay === 'function') refreshPersonalTxnOverlay();
          };
        },
      });
    };
    window.fhInvRowDelTap = async function (rowId, btn) {
      if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Bấm lần nữa để xoá'; return; }
      const P = _P(); const r = (P.debts || []).find((d) => d.id === rowId);
      const ok = await window.fhPersonalDeleteExpense(rowId);   // any private row: photos swept, link_id-null guarded
      if (!ok) { window.toast && toast('Chưa xoá được, thử lại'); return; }
      window.toast && toast('Đã xoá');
      if (window.fhModalClose) fhModalClose();
      if (window.renderPersonal) renderPersonal();
      if (r && r.positionId) openInvPosition(r.positionId); else closeInvest();
    };
  })();
