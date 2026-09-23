#!/usr/bin/env node
/* A family row logged from the quick sheet must name its money source.
 * `node tools/quick-review-instrument.test.js`
 *
 * transactions.instrument (0131) is the display-grade "VIB · tín dụng ••4512"
 * the household sees on a row. The full review writes it (csvPromote builds it
 * from the bank name and the instrument chip). The quick sheet's family write
 * has always handed `QR.inst` to the same write-through, and nothing ever set
 * QR.inst, so every family row approved one at a time landed with a null
 * instrument (email-reading-v2-spec §15, smaller defects).
 *
 * The string must be the SAME one the full review would write for the same row,
 * or one mail reads two ways depending on which screen approved it. So this
 * builds both with the real functions and compares them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const QUICK = read('src/js-data/76-quick-review.js');
const WT = read('src/js-data/50-writethrough-realtime.js');
const CSVUI = read('src/js-ui/56-csv-import-ui.js');
const REVIEW = read('src/js-ui/57-csv-import-review.js');
const SRC72 = read('src/js-data/72-txn-review.js');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}
function grabOrNull(src, header) { try { return grab(src, header); } catch (e) { return null; } }

const qrInstSrc = grabOrNull(QUICK, 'function _qrInst(');
ok(!!qrInstSrc, '_qrInst exists in 76-quick-review.js');
ok(/\binst:\s*_qrInst\(re\)/.test(QUICK), 'the sheet sets QR.inst when it opens');
ok(/window\._fhImportInst = \(QR && QR\.inst\) \|\| null/.test(QUICK), 'and the family write still hands QR.inst to the write-through');

if (qrInstSrc) {
  const ctx = { console, L: (vi) => vi, csvStagedMode: true };
  ctx.window = ctx;
  vm.createContext(ctx);
  // The provider canon (57), the instrument grammar (50-writethrough), the full
  // review's two halves (56) and the accessor they read (72), all real. 57 loads
  // whole: fhProviderName leans on csvCanonicalProvider and its noise list, and
  // slicing those out by hand would only test the slicing.
  vm.runInContext(grab(read('src/js-ui/50-sheets-expense-capture.js'), 'function deburr('), ctx);
  // the provider registry (generated) — the fold in 57 resolves through it
  vm.runInContext(read('src/js-ui/09-providers.js'), ctx);
  vm.runInContext(REVIEW, ctx);
  vm.runInContext(grab(WT, 'window.fhAccountInstString = function (a)') + ';', ctx);
  vm.runInContext(grab(CSVUI, 'function csvStagedProvider(') + '\n' + grab(CSVUI, 'function csvStagedAcctChip('), ctx);
  vm.runInContext(grab(SRC72, 'window.fhStagedAcct = function (c)') + ';', ctx);
  vm.runInContext(grab(QUICK, 'function _qrAcct(') + '\n' + qrInstSrc, ctx);

  /* One staged row, seen by both screens. The full review reads it by rowIndex
     out of _fhStagedRows; the quick sheet holds the opened payload with the
     clear source_provider column copied on (76's _qrOpen does that). */
  const both = (provider, extracted) => {
    ctx._fhStagedRows = [{ source_provider: provider, raw_extracted: extracted }];
    ctx.__re = Object.assign({}, extracted, { source_provider: provider });
    return {
      full: vm.runInContext('[csvStagedProvider({rowIndex:0}), csvStagedAcctChip({rowIndex:0})].filter(Boolean).join(" · ") || null', ctx),
      quick: vm.runInContext('_qrInst(__re)', ctx),
    };
  };

  console.log('\nthe same string the full review writes');
  let r = both('vib', { account_kind: 'credit_card', account_masked: '5123 45** **** 4512' });
  ok(r.quick === r.full && /••4512$/.test(r.quick || ''), 'a credit card: ' + r.full, r);
  r = both('vietcombank', { account_kind: 'deposit', account_masked: '****0001' });
  ok(r.quick === r.full && /TK ••0001$/.test(r.quick || ''), 'a deposit account: ' + r.full, r);
  r = both('momo', {});
  ok(r.quick === r.full && !!r.quick, 'a wallet known only by its provider: ' + r.full, r);
  r = both('vib', { account_kind: 'deposit', account_masked: '' });
  ok(r.quick === r.full, 'a classified instrument with no number: ' + r.full, r);

  console.log('\nnothing confident -> the bank alone, never an invented instrument');
  r = both('vib', {});
  ok(r.quick === r.full && !!r.quick && !/••/.test(r.quick), 'no classifier verdict: ' + r.full, r);
  r = both('', {});
  ok(r.quick === null && r.full === null, 'no provider, no verdict -> null on both screens', r);
}

console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
process.exit(failed ? 1 : 0);
