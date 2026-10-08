#!/usr/bin/env node
/* The two steps of the connect flow, as the person meets them.
 *
 * Step 1 carries the bank-email consent inside it (activation-journey-spec
 * Q28a). After the UT of 2026-09-26 it was rebuilt as one document: a ticked
 * summary, the consent rows in the flow's own row shape, and an agree pinned
 * to the sheet's foot. Step 2 lost its typed lookback field: a year is a
 * choice, and the picked one.
 *
 * What this guards, in the order it would hurt:
 *   - the agree is there on the FIRST paint, not grown in after a round trip;
 *   - a record that says "already agreed" removes the ask, and nothing else
 *     ever swaps Continue for an agree under someone's thumb;
 *   - every word of the consent is on the sheet, unfolded, with no scroll box
 *     of its own, and the version did not move;
 *   - the lookback is four taps, 365 lit, and only a listed value can reach
 *     the signed state.
 *
 * The real handlers are extracted from 74-autotxn-ui.js and 75-consent-ui.js
 * rather than copied.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const mbx = rd('js-data/71-mailbox-ui.js');
const src = rd('js-data/74-autotxn-ui.js');
const cst = rd('js-data/75-consent-ui.js');
const css = rd('css/74-mailbox.css');
const prelude = (() => {
  const svg = mbx.slice(mbx.indexOf('const _MBX_SVG'), mbx.indexOf('const _mbxGlyph'));
  const a = mbx.indexOf('  function _mbxAssure(');
  const b = mbx.indexOf('\n  }\n', a) + 4;
  return svg + "\nconst _mbxGlyph = (k) => _MBX_SVG[k] || '';\n" + mbx.slice(a, b);
})();

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const tick = () => new Promise((r) => setTimeout(r, 15));

/* `consent` is the user_consents row the server holds (null = none);
   `consentFails` makes that read error out. */
function make(o) {
  o = o || {};
  const sheets = [], calls = [], inserts = [], els = {};
  const el = (id) => (els[id] = els[id] || {
    id, innerHTML: '', textContent: '', disabled: false, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, querySelectorAll: () => [],
  });
  const sb = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } }, error: null }) },
    from: (table) => {
      const q = {
        select: () => q, eq: () => q, order: () => q,
        insert: async (row) => { inserts.push(row); return { error: null }; },
        limit: () => Promise.resolve(
          table === 'user_consents'
            ? (o.consentFails ? { data: null, error: { message: 'nope' } }
                              : { data: o.consent ? [o.consent] : [], error: null })
            : { data: [], error: null }),
      };
      return q;
    },
  };
  const nav = { to: null };
  const ctx = {
    _fhSheet: (h) => sheets.push(h), _fhModal: () => {}, _esc: String, _escAttr: String,
    SUPABASE_URL: 'https://proj.supabase.co', _rpc: async () => null,
    document: { getElementById: (id) => el(id), createElement: () => ({}), addEventListener() {}, querySelector: () => null },
    history: { replaceState() {} },
    location: { origin: 'https://app.test', pathname: '/', search: '', hash: '', href: 'https://app.test/', assign: (u) => { nav.to = u; } },
    URLSearchParams, Date, setTimeout, clearTimeout, console: { warn() {} },
    L: (vi) => vi, fmtDayMon: () => '20 thg 9',
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: async (url) => {
      calls.push(url);
      return { status: 200, ok: true, headers: { get: () => null },
               json: async () => ({ url: 'https://accounts.google.com/x' }), text: async () => '{}' };
    },
    sb,
    window: {
      FAM: { user: { email: 'me@gmail.com' } },
      DB: o.family ? { fid: 'f1', ownerMemberId: 'm1', _hydrated: true } : { _hydrated: true },
      fhUser: { id: 'u1' }, toast() {}, fhStagedCount: 0, sb, open: () => null,
    },
  };
  ctx.window.location = ctx.location;
  const api = new Function(...Object.keys(ctx), '"use strict";' + prelude + '\n' + src + '\n' + cst + '\nreturn window;')(...Object.values(ctx));
  return { api, sheets, calls, inserts, els, nav, last: () => sheets[sheets.length - 1] || '' };
}

const AGREE = 'Tôi hiểu và đồng ý, tiếp tục';
const SEVEN = ['Earthy lấy gì từ email?', 'Để làm gì?', 'Có ai đọc được email của tôi không?',
  'Còn file sao kê ngân hàng gửi kèm email?', 'Còn email hoá đơn từ các cửa hàng?',
  'Ai mở được các giao dịch này?', 'Giao dịch có tự vào sổ không?'];

(async () => {
  console.log('\n-- step 1: the ask is there on the first paint --');
  {
    const m = make({ consent: null });
    m.api.fhAutoTxnSheet();
    const h = m.last();                       // read BEFORE any await: this is the first frame
    t('the button is the agree from the first frame', h.indexOf('>' + AGREE + '<') >= 0);
    t('and it records the consent, it does not skip to the choices',
      /id="atx-step1-cta" onclick="fhAutoTxnAgreeGo\(this\)"/.test(h));
    t('all seven consent rows are on the sheet', SEVEN.every((q) => h.indexOf(q) >= 0),
      SEVEN.filter((q) => h.indexOf(q) < 0).join(' | '));
    t('unfolded: a first ask hides nothing behind a disclosure', h.indexOf('<details') < 0);
    t('in the sheet\'s own scroll, not a scroll box inside it', h.indexOf('cst-body') < 0);
    t('in the row shape the promises use', (h.match(/class="mbx-assure-row"/g) || []).length === 7);
    t('every row draws a glyph', (h.match(/<div class="mbx-ic"><svg/g) || []).length === 7);
    t('the three promises lead as a summary',
      ['Chỉ biên lai và giao dịch', 'Chỉ bạn mở được', 'Bạn duyệt rồi mới vào sổ'].every((s) => h.indexOf(s) >= 0) &&
      (h.match(/<li>/g) || []).length === 3);
    t('...titles only: their bodies are not repeated above the consent',
      h.indexOf('Những thư khác không bao giờ được tải về') < 0);
    t('the small print (operators, policy, decline) is still there',
      h.indexOf('/privacy.html') >= 0 && h.indexOf('Nếu không đồng ý, chỉ tính năng này không bật.') >= 0);
    t('the agree sits in the pinned foot', /<div class="atx-foot"><button class="cta" id="atx-step1-cta"/.test(h));
    t('the note about Google\'s screen is not on this step', h.indexOf('Màn hình của Google') < 0);
    await tick();
    t('the record agreeing with the paint changes nothing', !m.els['atx-s1-body'] || m.els['atx-s1-body'].innerHTML === '');
  }

  console.log('\n-- step 1: the foot is really pinned --');
  {
    const rule = (css.match(/\.atx-foot\{[^}]*\}/) || [''])[0];
    t('.atx-foot sticks to the bottom of the sheet', /position:sticky/.test(rule) && /bottom:0/.test(rule), rule);
    t('and paints over what scrolls under it', /background:var\(--white\)/.test(rule), rule);
  }

  console.log('\n-- step 1: a record that already agrees removes the ask --');
  {
    const m = make({ consent: { version: 7, consented_at: '2026-09-20T03:00:00Z' } });
    m.api.fhAutoTxnSheet();
    await tick();
    const body = m.els['atx-s1-body'], cta = m.els['atx-step1-cta'];
    t('the body is repainted without the consent', !!body && body.innerHTML.indexOf('Earthy lấy gì từ email?') < 0 &&
      body.innerHTML.indexOf('Những thư khác không bao giờ được tải về') >= 0, body && body.innerHTML.slice(0, 120));
    t('the button becomes a plain Continue', !!cta && cta.textContent === 'Tiếp tục' && cta.attrs.onclick === 'fhAutoTxnSetup()',
      cta && cta.textContent + ' / ' + cta.attrs.onclick);
    m.api.fhAutoTxnSheet();                   // e.g. "Quay lại" from step 2
    const h = m.last();
    t('and the next open paints that shape at once', h.indexOf('>Tiếp tục<') >= 0 && h.indexOf(AGREE) < 0 &&
      h.indexOf('Earthy lấy gì từ email?') < 0);
  }

  console.log('\n-- step 1: failing closed --');
  {
    const m = make({ consentFails: true });
    m.api.fhAutoTxnSheet();
    await tick();
    t('an unreadable record leaves the ask standing', m.last().indexOf(AGREE) >= 0 &&
      (!m.els['atx-step1-cta'] || m.els['atx-step1-cta'].textContent === ''));
  }
  {
    const m = make({ consent: { version: 5, consented_at: '2026-09-20T03:00:00Z' } });
    m.api.fhAutoTxnSheet();
    await tick();
    const body = m.els['atx-s1-body'];
    t('an older consent gets what changed, with the full text folded under it',
      !!body && body.innerHTML.indexOf('Có gì thay đổi từ lần trước') >= 0 && body.innerHTML.indexOf('<details') >= 0 &&
      SEVEN.every((q) => body.innerHTML.indexOf(q) >= 0));
    t('...and still no inner scroll box', !!body && body.innerHTML.indexOf('cst-body') < 0);
    t('...and the button is still the agree', m.els['atx-step1-cta'].textContent === AGREE);
  }

  console.log('\n-- step 1: agreeing --');
  {
    const m = make({ consent: null });
    m.api.fhAutoTxnSheet();
    const btn = { disabled: false, textContent: AGREE };
    await m.api.fhAutoTxnAgreeGo(btn);
    t('writes the consent row at the current version',
      m.inserts.length === 1 && m.inserts[0].kind === 'bank_email' && m.inserts[0].version === 7, JSON.stringify(m.inserts));
    t('then opens the choices', m.last().indexOf('Vài lựa chọn nhanh') >= 0);
  }

  console.log('\n-- the consent text did not move --');
  {
    t('FH_CONSENT_V is still 7', /var FH_CONSENT_V = 7;/.test(cst));
    t('the standalone sheet keeps its own rows', /function _cstBankRows\(\)/.test(cst) && /_cstRow\(i\[1\], _esc\(i\[2\]\)\)/.test(cst));
  }

  console.log('\n-- step 2: how far back --');
  {
    const m = make({ consent: { version: 7 }, family: true });
    m.api.fhAutoTxnSetup();
    const h = m.last();
    const chips = (h.match(/data-v="(\d+)"/g) || []).map((s) => Number(s.replace(/\D/g, '')));
    t('four choices: 30, 60, 90, 365', chips.join(',') === '30,60,90,365', chips.join(','));
    t('365 is the one lit', /class="atx-seg on" data-v="365"/.test(h) && (h.match(/atx-seg on" data-v="\d+" onclick="fhAutoTxnPickDays/g) || []).length === 1);
    t('nothing is typed: no input on the sheet', h.indexOf('<input') < 0);
    t('the typed-days handler is gone', typeof m.api.fhAutoTxnTypeDays === 'undefined' && src.indexOf('atx-days-custom') < 0);
    t('the note about Google\'s screen is here, unsoftened',
      h.indexOf('Google chỉ có đúng một quyền như vậy và nó bao trùm cả hộp thư, không có quyền nào hẹp hơn.') >= 0);
    t('...and above the button it warns about', h.indexOf('Màn hình của Google') < h.indexOf('id="atx-go"'));
    t('the button is NOT pinned here, so the note cannot be skipped unseen', h.indexOf('atx-foot') < 0);
  }
  {
    const m = make({ consent: { version: 7 } });
    await m.api.fhAutoTxnGrant();
    t('untouched, the grant asks for a year', m.calls.some((c) => /[?&]backfill_days=365(&|$)/.test(c)), m.calls.join(' | '));
  }
  {
    const m = make({ consent: { version: 7 } });
    m.api.fhAutoTxnPickDays(30);
    await m.api.fhAutoTxnGrant();
    t('a tapped choice is what is sent', m.calls.some((c) => /[?&]backfill_days=30(&|$)/.test(c)), m.calls.join(' | '));
  }
  {
    const m = make({ consent: { version: 7 } });
    m.api.fhAutoTxnPickDays(800);
    await m.api.fhAutoTxnGrant();
    t('a value the screen never offered cannot reach the signed state',
      m.calls.some((c) => /[?&]backfill_days=365(&|$)/.test(c)), m.calls.join(' | '));
  }
  {
    t('a grant row with no window still reads back as the server default, 90',
      /const ATX_DEFAULT_DAYS = 90;/.test(src) && /Number\(row\.backfill_days\) \|\| ATX_DEFAULT_DAYS/.test(src));
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})();
