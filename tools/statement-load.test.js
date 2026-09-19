#!/usr/bin/env node
/* Loading statement cards on the device, with REAL sealing.
 * `node tools/statement-load.test.js`
 *
 * The first real run (2026-09-19) showed six cards that would not open: "File này
 * không khớp với sao kê". The function that opens a card's sealed details had been
 * declared `async`, so the card held a Promise where its details should be -- no
 * period, no file name, and a hash that could never match. Every other statement
 * test passed, because none of them went through the load. This one does: a card
 * sealed by the server's own sealForFamily, opened by the app's own
 * fhStagingOpenRow, read through fhStmtLoad.
 */
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const nodeCrypto = require('crypto');

(async () => {
  const SB = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'sealed-box.mjs'));
  let pass = 0, fail = 0;
  const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

  const OWNER = '11111111-1111-4111-8111-111111111111';
  const kp = nacl.box.keyPair();
  const pub = Buffer.from(kp.publicKey).toString('base64');
  const sealMeta = (meta, msgId, owner) => SB.sealForFamily(meta, pub, owner || OWNER, msgId, { nacl, rng: nodeCrypto.webcrypto }, 'personal');
  const fileRow = (id, msgId, meta, over) => { const m = sealMeta(meta, msgId, over && over.sealedFor); return Object.assign({ id, gmail_message_id: msgId, part_index: 0, source_provider: 'MoMo', received_at: '2026-09-18T16:38:00+00:00',
    file_ext: 'xlsx', byte_size: 100, object_path: OWNER + '/' + id + '.sealed', meta_sealed: m.sealed, meta_eph_pub: m.eph_pub, meta_nonce: m.nonce, enc_v: m.enc_v, status: 'pending', backfill: false }, (over && over.row) || {}); };

  // the app's REAL opener, lifted out of 18-staging-keys.js by name
  const src18 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '18-staging-keys.js'), 'utf8');
  const fx = (name) => { const j = src18.indexOf('function ' + name); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src18.slice(j, src18.indexOf('\n    }', j) + 6); };
  const fhStagingOpenRow = new Function('nacl', 'STAGING_ENC_V', fx('_sb64ToBytes') + '\n' + fx('fhStagingOpenRow') + '\nreturn fhStagingOpenRow;')(nacl, 1);

  const files = [
    fileRow('f1', 'm1', { filename: '0900000001_2430.xlsx', period_from: '2026-06-20', period_to: '2026-09-18', account_tail: '0001', file_sha256: 'abc123' }),
    fileRow('f2', 'm2', { filename: 'vib_saoke_09_2026.xlsx', period_month: '2026-09', file_sha256: 'def456' }, { row: { source_provider: 'VIB' } }),
    fileRow('f3', 'm3', { filename: 'someone-elses.xlsx', file_sha256: 'zzz' }, { sealedFor: '22222222-2222-4222-8222-222222222222' }),
  ];
  const query = (rows) => { const q = { select: () => q, in: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: rows, error: null }) }; return q; };
  const window = {
    fhUser: { id: OWNER }, nacl, fhStagingOpenRow,
    fhPersonalKeyReady: () => true, fhPersonalStagingPrivKey: async () => kp.secretKey,
    fhProviderName: (p) => p,
    sb: { from: (tbl) => query(tbl === 'statement_files' ? files : []) },
  };
  new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8'))(
    window, {}, (vi) => vi, (s) => String(s), (s) => String(s), async () => null, { getItem() { return null; }, setItem() {}, removeItem() {} }, { setItem() {} }, {}, nodeCrypto.webcrypto);

  console.log('\n-- a card sealed by the server, loaded by the app --');
  const out = await window.fhStmtLoad();
  const momo = out.cards.find((c) => c.id === 'f1'), vib = out.cards.find((c) => c.id === 'f2'), other = out.cards.find((c) => c.id === 'f3');
  t('the sealed details are DETAILS, not a Promise', momo.meta && typeof momo.meta.then !== 'function' && momo.meta.filename === '0900000001_2430.xlsx', momo.meta && Object.keys(momo.meta));
  t('the file hash is readable, so the file-match check can pass', momo.meta.file_sha256 === 'abc123' && vib.meta.file_sha256 === 'def456');
  t('the owner and message are bound inside', momo.meta.owner_user_id === OWNER && momo.meta.gmail_message_id === 'm1');
  t('the card is openable', momo.keyLocked === false);
  const html = window.fhStmtCardsHTML();
  t('the title carries the statement PERIOD, not the day the mail arrived', /Sao kê MoMo ví · 20\/06 – 18\/09/.test(html), html.match(/Sao kê MoMo[^<]*/));
  t('a month-only statement says the month', /Sao kê VIB · tháng 09\/2026/.test(html), html.match(/Sao kê VIB[^<]*/));
  t('the file name stays off the card: the row says kind and tail instead', html.indexOf('0900000001_2430.xlsx') < 0 && /Ví ••0001/.test(html), html.match(/stm-sub">[^<]*/g));
  t('details sealed for ANOTHER person are refused: no details, no open button', other.meta === null && other.keyLocked === true);

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
