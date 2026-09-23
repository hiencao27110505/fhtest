#!/usr/bin/env node
/* Provider registry: one spelling per provider, and the domain outranks prose.
 * `node tools/provider-registry.test.js`
 *
 * THE DEFECT CLASS (account-identity-spec.md §1, measured on production
 * 2026-09-23): one wallet stood in Tài sản three times — as "momo", "ví momo"
 * and the operator's legal name — because the sealing path preferred the
 * reader's free-text label over the name the sender table had already
 * canonicalised, and because nothing pinned the sender table's labels to the
 * registry. Each pin below holds one wall of the fix:
 *
 *   1. Every KNOWN_DOMAINS label resolves to a registry key (spec P2). The
 *      domains stay in senders.mjs for now, so this test is the only thing
 *      keeping the two lists from drifting apart — a label added there without
 *      a registry entry would seal prose the registry cannot fold.
 *   2. The committed generated files are FRESH and regeneration is idempotent.
 *      build.js regenerates on every assembly; a stale committed providers.mjs
 *      would mean device and worker disagree about what a spelling means.
 *   3. The resolver's semantics: canonical labels, alias names, BINs, bank
 *      codes, the deny list, and the shape rules that fold prose the registry
 *      has never seen into a STABLE slug (an unknown provider still folds
 *      consistently with itself, and "Ví VIB" never loses its head to the
 *      vi- prefix strip).
 *   4. The precedence flip itself (spec P3): worker.mjs seals
 *      `sender.provider || …source_provider`, never the inversion that caused
 *      the defect. Pinned on the source text so a refactor cannot quietly put
 *      the reader's label back on top.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const ROOT = path.join(__dirname, '..');
const GENERATED = [
  path.join(ROOT, 'src', 'js-ui', '09-providers.js'),
  path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'providers.mjs'),
];
const WORKER = path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'worker.mjs');

(async () => {
  // ── the committed output is fresh, and regenerating changes nothing ───────
  console.log('\n-- generated files: committed output is what generate() writes --');

  const before = GENERATED.map(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  t('both generated files exist', before.every(x => x !== null),
    GENERATED.filter((f, i) => before[i] === null).join(', ') + ' missing — run node tools/gen-providers.js');

  require(path.join(__dirname, 'gen-providers.js')).generate();

  for (let i = 0; i < GENERATED.length; i++) {
    const after = fs.readFileSync(GENERATED[i], 'utf8');
    t(path.relative(ROOT, GENERATED[i]) + ' was already fresh', before[i] === after,
      'the committed file was STALE: generate() rewrote it (commit the regenerated file)');
  }

  // ── the registry itself, as the worker imports it ─────────────────────────
  const { FH_PROVIDERS: P } = await import(pathToFileURL(GENERATED[1]).href);
  const senders = await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'senders.mjs')).href);

  // ── P2: every domain's provider label is a registry entry ─────────────────
  console.log('\n-- every KNOWN_DOMAINS label resolves to a registry key (spec P2) --');

  let checked = 0;
  const orphans = [];
  for (const [group, table] of Object.entries(senders.KNOWN_DOMAINS)) {
    for (const [domain, label] of Object.entries(table)) {
      checked++;
      if (P.keyOf(label) === '') orphans.push(group + ' ' + domain + ' -> "' + label + '"');
    }
  }
  t('all ' + checked + ' domain labels resolve (0 orphans)', checked > 0 && orphans.length === 0,
    orphans.slice(0, 8).join('; '));

  // ── resolver semantics ────────────────────────────────────────────────────
  console.log('\n-- names, aliases and legal forms fold to one key --');

  t('"Ví MoMo" -> momo', P.keyOf('Ví MoMo') === 'momo', P.keyOf('Ví MoMo'));
  t('"M_Service" -> momo', P.keyOf('M_Service') === 'momo', P.keyOf('M_Service'));
  t('the legal long form -> vietcombank',
    P.keyOf('Ngân hàng TMCP Ngoại thương Việt Nam') === 'vietcombank',
    P.keyOf('Ngân hàng TMCP Ngoại thương Việt Nam'));
  t('"VCB" -> vietcombank', P.keyOf('VCB') === 'vietcombank', P.keyOf('VCB'));
  t('"hsbc vietnam" and "HSBC" agree on a key',
    P.keyOf('hsbc vietnam') !== '' && P.keyOf('hsbc vietnam') === P.keyOf('HSBC'),
    P.keyOf('hsbc vietnam') + ' vs ' + P.keyOf('HSBC'));

  console.log('\n-- the deny list names NO provider, from keyOf and slugOf alike --');
  for (const phrase of ['ngân hàng liên kết', 'ví', 'tài khoản']) {
    t('"' + phrase + '" resolves to nothing',
      P.keyOf(phrase) === '' && P.slugOf(phrase) === '',
      'keyOf=' + JSON.stringify(P.keyOf(phrase)) + ' slugOf=' + JSON.stringify(P.slugOf(phrase)));
  }

  console.log('\n-- "Ví VIB" keeps its head: the vi- strip only fires on a registry name --');
  t('keyOf("VIB") is vib', P.keyOf('VIB') === 'vib', P.keyOf('VIB'));
  t('slugOf("Ví VIB") is vib, not "b"', P.slugOf('Ví VIB') === 'vib', P.slugOf('Ví VIB'));

  console.log('\n-- BINs and wallet-statement bank codes --');
  t('keyFromBin("970436") -> vietcombank', P.keyFromBin('970436') === 'vietcombank', P.keyFromBin('970436'));
  t('keyFromCode("vcb") -> vietcombank', P.keyFromCode('vcb') === 'vietcombank', P.keyFromCode('vcb'));

  console.log('\n-- unknown prose: no key invented, but the slug is STABLE --');
  const long = P.slugOf('Ngân hàng TMCP Bản Việt');
  const short = P.slugOf('Bản Việt');
  t('keyOf("Ngân hàng TMCP Bản Việt") is "" (no invented key)',
    P.keyOf('Ngân hàng TMCP Bản Việt') === '', P.keyOf('Ngân hàng TMCP Bản Việt'));
  t('its two spellings fold to one non-empty slug', long !== '' && long === short,
    JSON.stringify(long) + ' vs ' + JSON.stringify(short));

  // ── P3: the worker seals domain-first, and stays flipped ──────────────────
  console.log('\n-- worker.mjs seals sender.provider first (spec P3, the 2026-09-23 flip) --');

  const workerSrc = fs.readFileSync(WORKER, 'utf8');
  t('the seal reads sender.provider || <reader label>',
    /sourceProvider:[^,\n]*sender\.provider\s*\|\|/.test(workerSrc),
    'the domain-first seal is gone from worker.mjs');
  t('the OLD inversion (reader label || sender.provider) is gone',
    !/source_provider\s*\|\|\s*sender\.provider/.test(workerSrc),
    'the reader\'s free-text label outranks the sender table again — the exact defect of §1');
  t('the sealed value goes through the registry', /FH_PROVIDERS/.test(workerSrc),
    'worker.mjs no longer consults FH_PROVIDERS');

  console.log('\n' + (fail ? '  ' + fail + ' FAILED, ' : '  ALL ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
