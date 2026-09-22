#!/usr/bin/env node
/* mailbox-dryrun speaks v2 and stays dry (email-reading-v2 landing 3).
 * `node pipeline/dryrun-v2.test.js`
 *
 * dryrun-is-dry.test.js proves the proxy blocks every db.mjs METHOD. This
 * pins what landing 3 added around it, by reading index.ts (it is Deno-only)
 * and driving the proxy:
 *   1. `readerV` (default 1) selects which payload each row shows, through
 *      the real buildPayload + toReading, so the dry run shows exactly what
 *      the worker would seal for a mailbox on that version
 *   2. the reader is called the way the worker calls it: provider, sender
 *      kind, the (read-only) format store, the build
 *   3. the new outcomes are tallied: notice, multi, format_cap
 *   4. the handle is created with the build, so a would-write of a format
 *      would carry it
 */
import fs from 'node:fs';
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
const FN = new URL('../supabase/functions/', import.meta.url);
const src = fs.readFileSync(new URL('mailbox-dryrun/index.ts', FN), 'utf8');
const ST = await import(new URL('_shared/mailbox/stage.mjs', FN));
const W  = await import(new URL('_shared/mailbox/worker.mjs', FN));

console.log('\n-- index.ts --');
t('readerV is read from the body, default 1, only 2 is 2', /const readerV = Number\(body\.readerV\) === 2 \? 2 : 1;/.test(src));
t('each ok row carries the payload buildPayload would seal for that readerV', /raw: buildPayload\(\{ reading: toReading\(x, message\), senderKind: sender\.senderKind \|\| sender\.kind, readerV \}\)\.raw_extracted/.test(src));
t('a notice row shows what a notice would seal', /rowKind: "notice", readerV/.test(src));
t('the reader gets provider, senderKind, the format store and the build, as the worker passes them',
  /senderKind: sender\.senderKind \|\| sender\.kind, provider: sender\.provider,\s*formats: db\.formats, build: BUILD_ID/.test(src));
t('the tally has the v2 outcomes', /notice: 0, multi: 0, format_cap: 0/.test(src) && /read\.mailKind === "notice" \? "notice"/.test(src));
t('the reply says which reader version and build it ran', /readerV, build: BUILD_ID, wouldWrite: dry\.wouldWrite/.test(src));
t('createDb is still called once, inside dryDb, now with the build', (src.match(/createDb\(/g) || []).length === 1 && /dryDb\(createDb\(.*\{ readerBuild: BUILD_ID \}\)\);/.test(src));
t('the format store the reader sees is the PROXY\'s (db.formats), never the real handle\'s', !/real\.formats|dry\.real/.test(src) && /formats: db\.formats/.test(src));

console.log('\n-- the payload a dry run shows is the worker\'s --');
{
  const x = { amount: 50000, direction: 'debit', currency: 'VND', occurred_at: '2026-09-20T09:00:00+07:00', counterparty: 'Quan', signal: 'purchase', fee_amount: 1000, src: { amount: 'printed' } };
  const msg = { internalDate: Date.now(), dkim: { pass: true, result: 'pass' } };
  const v1 = ST.buildPayload({ reading: W.toReading(x, msg), senderKind: 'bank', readerV: 1 }).raw_extracted;
  const v2 = ST.buildPayload({ reading: W.toReading(x, msg), senderKind: 'bank', readerV: 2 }).raw_extracted;
  t('v1 shows no v2 keys', v1.v === undefined && v1.signal === undefined && v1.fee_amount === undefined, Object.keys(v1));
  t('v2 shows the signal, the fee, the version and the provenance map', v2.v === 2 && v2.signal === 'purchase' && v2.fee_amount === 1000 && v2.src && v2.src.amount === 'printed', v2);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
