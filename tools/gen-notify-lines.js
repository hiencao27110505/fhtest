#!/usr/bin/env node
/* gen-notify-lines — ONE source, two targets.

   taxonomy/notify-lines.json is the voice of the push notification
   (notification-activation-spec.md §6): the concept list, the VND tiers, the
   merchant-keyword pools, the concept × tier × 4-variant MATRIX in both
   languages, the daypart overrides, the pool lines and their daypart
   overrides, plus the backfill digest and the statement line.

   Generated, never hand-edited:
     supabase/functions/_shared/mailbox/notify-lines.mjs   ESM for the worker + push-send
     src/js-ui/14-notify-lines.js                          classic script → window.FH_NOTIFY

   WHY: surface 2 of the spec shows the person the line they would actually have
   received, built on the device, before they grant permission. That promise is
   only honest while the browser and the edge function pick the SAME line, so
   neither the tables nor the selection logic may exist twice. `notify-copy.mjs`
   keeps its public surface (copyMeta, reviewBody, digestBody, statementBody)
   and imports the tables and the shared logic from the generated .mjs.

   Both targets embed the SAME selection template (`logic()` below) verbatim,
   written as plain ES5 so the one text runs as a classic script in global scope
   and inside the ESM wrapper. The only thing the wrappers differ on is where
   the category tree comes from: `taxonomy.mjs` on the worker, `window.FH_TAX`
   on the device (11-taxonomy.js sorts before 14-notify-lines.js).

   Run by build.js before every assembly (so the client can never drift from the
   JSON) and standalone via `npm run notify-lines`. Output is deterministic and
   ends without a trailing newline, like every other src/ slice (CLAUDE.md §1).

   Rules enforced here, because copy that breaks them reaches a lock screen:
   every concept present in BOTH languages with the same key set; every tier
   cell exactly 4 variants; every daypart set complete; every pool named in the
   lines exists in POOLS and vice versa (a pool with no lines is a silent
   fall-through); every body ends in "!"; no body carries a digit; no body
   exceeds 9 words; every title is exactly one emoji. The digest is the one
   line allowed to be longer, because it carries a count — it takes the count
   as the literal placeholder `{n}`, so it still holds no digit here. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'taxonomy', 'notify-lines.json');
const LANGS = ['vi', 'en'];
const MAX_WORDS = 9;

/* One grapheme, and that grapheme pictographic: the titles include ZWJ
   sequences ("😵‍💫", "😮‍💨") that are several code points but one character. */
const SEG = new Intl.Segmenter('en', { granularity: 'grapheme' });
const PICTO = /\p{Extended_Pictographic}/u;
function oneEmoji(s) {
  if (typeof s !== 'string' || !s) return false;
  return [...SEG.segment(s)].length === 1 && PICTO.test(s);
}
/* The same word count the notification tests use: whitespace-separated tokens
   that contain at least one letter. */
function words(s) {
  return String(s).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
}

function checkLine(line, where, opts) {
  const o = opts || {};
  if (!line || typeof line !== 'object') throw new Error('notify-lines: ' + where + ' is not a line');
  if (Object.keys(line).join(',') !== 'e,b') throw new Error('notify-lines: ' + where + ' must be exactly { e, b }');
  if (!oneEmoji(line.e)) throw new Error('notify-lines: ' + where + ' title is not exactly one emoji: ' + JSON.stringify(line.e));
  if (typeof line.b !== 'string' || !line.b) throw new Error('notify-lines: ' + where + ' has no body');
  if (line.b.slice(-1) !== '!') throw new Error('notify-lines: ' + where + ' body does not end in "!": ' + line.b);
  if (PICTO.test(line.b)) throw new Error('notify-lines: ' + where + ' body carries an emoji: ' + line.b);
  if (/\d/.test(line.b)) throw new Error('notify-lines: ' + where + ' body carries a digit: ' + line.b);
  if (!o.long && words(line.b) > MAX_WORDS) {
    throw new Error('notify-lines: ' + where + ' body is ' + words(line.b) + ' words, over ' + MAX_WORDS + ': ' + line.b);
  }
}

function sameKeys(a, b, where) {
  const ka = Object.keys(a).slice().sort().join(',');
  const kb = Object.keys(b).slice().sort().join(',');
  if (ka !== kb) throw new Error('notify-lines: ' + where + ' differs between vi and en: [' + ka + '] vs [' + kb + ']');
}

function load() {
  const d = JSON.parse(fs.readFileSync(SRC, 'utf8'));

  if (!Number.isInteger(d.version)) throw new Error('notify-lines: version must be an integer');
  if (!Array.isArray(d.concepts) || d.concepts.length < 1) throw new Error('notify-lines: concepts missing');
  if (!Array.isArray(d.tiers) || d.tiers.length !== 3 || d.tiers.some((n) => typeof n !== 'number')) {
    throw new Error('notify-lines: tiers must be three numbers');
  }
  for (let i = 1; i < d.tiers.length; i++) {
    if (!(d.tiers[i] > d.tiers[i - 1])) throw new Error('notify-lines: tiers must ascend');
  }
  if (!Array.isArray(d.dayparts) || d.dayparts.length !== 4) throw new Error('notify-lines: four dayparts expected');

  /* POOLS: keywords are matched against DEBURRED text, so a keyword that is not
     already deburred could never fire; and a keyword claimed by two pools is
     dead in the second one, because keywordPool returns the first hit. */
  const seen = new Map();
  for (const pool of Object.keys(d.pools)) {
    if (!/^[a-z][a-z0-9]*$/.test(pool)) throw new Error('notify-lines: bad pool name ' + pool);
    if (!Array.isArray(d.pools[pool]) || !d.pools[pool].length) throw new Error('notify-lines: pool ' + pool + ' has no keywords');
    for (const kw of d.pools[pool]) {
      if (!/^[a-z0-9]+( [a-z0-9]+)*$/.test(kw)) throw new Error('notify-lines: pool ' + pool + ' keyword is not deburred: ' + kw);
      if (seen.has(kw)) throw new Error('notify-lines: keyword "' + kw + '" claimed by ' + seen.get(kw) + ' and ' + pool);
      seen.set(kw, pool);
    }
  }

  for (const lang of LANGS) {
    for (const table of ['matrix', 'daypart', 'poolLines', 'poolDaypart']) {
      if (!d[table] || !d[table][lang]) throw new Error('notify-lines: ' + table + ' has no ' + lang);
    }
  }
  sameKeys(d.matrix.vi, d.matrix.en, 'matrix');
  sameKeys(d.daypart.vi, d.daypart.en, 'daypart');
  sameKeys(d.poolLines.vi, d.poolLines.en, 'poolLines');
  sameKeys(d.poolDaypart.vi, d.poolDaypart.en, 'poolDaypart');

  /* Every concept the enum can produce must have a row in BOTH languages:
     the 8 tree concepts plus the two the flow decides, income and unknown. */
  for (const c of d.concepts.concat(['income', 'unknown'])) {
    for (const lang of LANGS) {
      const rows = d.matrix[lang][c];
      if (!Array.isArray(rows) || rows.length !== 4) {
        throw new Error('notify-lines: matrix.' + lang + '.' + c + ' must have 4 tiers');
      }
      rows.forEach((cell, i) => {
        if (!Array.isArray(cell) || cell.length !== 4) {
          throw new Error('notify-lines: matrix.' + lang + '.' + c + ' tier ' + (i + 1) + ' must have exactly 4 variants');
        }
        cell.forEach((line, j) => checkLine(line, 'matrix.' + lang + '.' + c + '[t' + (i + 1) + '][' + j + ']'));
      });
    }
  }

  /* Daypart overrides sit on top of a concept that must exist, and must cover
     all four parts — a hole falls back to the tier line without anyone noticing. */
  for (const lang of LANGS) {
    for (const c of Object.keys(d.daypart[lang])) {
      if (!d.matrix[lang][c]) throw new Error('notify-lines: daypart.' + lang + '.' + c + ' has no matrix row');
      for (const part of d.dayparts) {
        const arr = d.daypart[lang][c][part];
        if (!Array.isArray(arr) || !arr.length) throw new Error('notify-lines: daypart.' + lang + '.' + c + ' missing ' + part);
        arr.forEach((line, j) => checkLine(line, 'daypart.' + lang + '.' + c + '.' + part + '[' + j + ']'));
      }
    }
  }

  /* Pools and their lines must name each other exactly: a pool with keywords
     but no lines is matched and then silently dropped by reviewBody, and lines
     for a pool no keyword can produce are copy nobody will ever read. */
  const poolNames = Object.keys(d.pools).slice().sort().join(',');
  for (const lang of LANGS) {
    const lineNames = Object.keys(d.poolLines[lang]).slice().sort().join(',');
    if (lineNames !== poolNames) {
      throw new Error('notify-lines: poolLines.' + lang + ' [' + lineNames + '] does not match pools [' + poolNames + ']');
    }
    for (const p of Object.keys(d.poolLines[lang])) {
      const arr = d.poolLines[lang][p];
      if (!Array.isArray(arr) || !arr.length) throw new Error('notify-lines: poolLines.' + lang + '.' + p + ' is empty');
      arr.forEach((line, j) => checkLine(line, 'poolLines.' + lang + '.' + p + '[' + j + ']'));
    }
    for (const p of Object.keys(d.poolDaypart[lang])) {
      if (!d.pools[p]) throw new Error('notify-lines: poolDaypart.' + lang + '.' + p + ' names no pool');
      for (const part of d.dayparts) {
        const arr = d.poolDaypart[lang][p][part];
        if (!Array.isArray(arr) || !arr.length) throw new Error('notify-lines: poolDaypart.' + lang + '.' + p + ' missing ' + part);
        arr.forEach((line, j) => checkLine(line, 'poolDaypart.' + lang + '.' + p + '.' + part + '[' + j + ']'));
      }
    }
  }

  /* The digest is the one line allowed a number, and it holds it as the literal
     placeholder {n} — so it still passes the no-digit rule, and only the word
     cap is lifted. The statement line carries nothing at all. */
  for (const lang of LANGS) {
    if (!d.digest || !d.digest[lang]) throw new Error('notify-lines: digest has no ' + lang);
    checkLine(d.digest[lang], 'digest.' + lang, { long: true });
    if (d.digest[lang].b.split('{n}').length !== 2) {
      throw new Error('notify-lines: digest.' + lang + ' must carry {n} exactly once: ' + d.digest[lang].b);
    }
    if (!d.statement || !d.statement[lang]) throw new Error('notify-lines: statement has no ' + lang);
    checkLine(d.statement[lang], 'statement.' + lang);
    if (d.statement[lang].b.indexOf('{') >= 0) throw new Error('notify-lines: statement.' + lang + ' must carry no placeholder');
  }

  return d;
}

/* The shared selection body, written once as plain ES5 so the same text runs as
   a classic script (device, global scope) and inside the ESM wrapper (worker).
   Reads DATA (the tables) and TAX ({ conceptOf, poolOf }, supplied by each
   wrapper). Behaviour is byte-for-byte the behaviour notify-copy.mjs had when
   the tables lived inside it — this is a move, not a rewrite. */
function logic() {
  return `
  var CONCEPTS = DATA.concepts, TIERS = DATA.tiers;
  var POOLS = DATA.pools, MATRIX = DATA.matrix, DAYPART = DATA.daypart;
  var POOL_LINES = DATA.poolLines, POOL_DAYPART = DATA.poolDaypart;
  var POOL_KEYS = [], _pk;
  for (_pk in POOLS) { if (Object.prototype.hasOwnProperty.call(POOLS, _pk)) POOL_KEYS.push(_pk); }

  /* VND tiers. Tier 1 (≤30k) matches the client's photo-nudge floor. A non-VND
     amount has no honest tier — it reads as tier 2 rather than guessing. */
  function tierOf(amount, currency) {
    if (currency && currency !== 'VND') return 2;
    var a = Number(amount) || 0;
    if (a <= TIERS[0]) return 1;
    if (a <= TIERS[1]) return 2;
    if (a <= TIERS[2]) return 3;
    return 4;
  }

  /* Daypart from occurred_at, in VN wall-clock (+07:00). Four buckets, no khuya —
     tối absorbs the night. Null when there is no real time: a date-only row is
     stored at UTC-midnight, so H:M:S all zero → no daypart (falls back to tier). */
  function dayPartOf(occurredAt) {
    var t = Date.parse(occurredAt || '');
    if (!t) return null;
    var d = new Date(t);
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return null;
    var h = (d.getUTCHours() + 7) % 24;
    if (h >= 5 && h < 11) return 'sang';
    if (h >= 11 && h < 14) return 'trua';
    if (h >= 14 && h < 18) return 'chieu';
    return 'toi';
  }

  function deburr(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').toLowerCase()
      .replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ').trim();
  }

  /* Merchant/memo → pool key. Deburred, padded word match. Expenses only. */
  function keywordPool(extraction) {
    var hay = ' ' + deburr((extraction.counterparty || '') + ' ' + (extraction.memo || '')) + ' ', i, j;
    for (i = 0; i < POOL_KEYS.length; i++) {
      var kws = POOLS[POOL_KEYS[i]];
      for (j = 0; j < kws.length; j++) {
        if (hay.indexOf(' ' + kws[j] + ' ') >= 0) return POOL_KEYS[i];
      }
    }
    return undefined;
  }

  /* A pool name is only a pool if there are lines for it: a stale or unknown
     hint (or a tree attribute this copy has no voice for) can never name one. */
  function validPool(p) {
    return p && POOLS[p] ? p : undefined;
  }

  /* The whole plaintext → the tiny enum that leaves this process.
     c: concept | 'income' | 'unknown' · t: 1..4 · d: daypart | absent · p: pool.

     THE TREE NODE (0144, \`extraction.node\`) is read only to fill what the
     extractor left empty: a node's concept (conceptOf) stands in for a missing
     category, and its pool attribute (poolOf) for a missing pool. The payload
     shape does not change — still {c,t,d,p}, still no amount, no merchant, no
     category NAME, and no node code either: a code like 'coffee' is exactly the
     kind of specific claim this payload exists not to carry. */
  function metaOf(extraction) {
    if (!extraction) return { c: 'unknown', t: 2 };
    var flow = extraction.flow
      || (extraction.direction === 'credit' ? 'income' : 'expense');
    var t = tierOf(extraction.amount, extraction.currency);
    var d = dayPartOf(extraction.occurred_at);
    if (flow === 'income') { var mi = { c: 'income', t: t }; if (d) mi.d = d; return mi; }
    if (flow === 'transfer') { var mt = { c: 'unknown', t: t }; if (d) mt.d = d; return mt; }
    var node = typeof extraction.node === 'string' ? extraction.node : null;
    var c = CONCEPTS.indexOf(extraction.category) >= 0 ? extraction.category : 'unknown';
    if (c === 'unknown' && node) {
      var nc = TAX.conceptOf(node);            // null for an income or unknown code
      if (CONCEPTS.indexOf(nc) >= 0) c = nc;
    }
    var meta = { c: c, t: t };
    if (d) meta.d = d;
    /* The fast keyword gate first (free, deterministic); then, only if it found
       nothing, the finer pool the merchant classifier recognised and cached
       (classify.mjs → extraction.pool) — this is how a café whose NAME carries no
       coffee keyword still earns the coffee voice; then the node's own pool
       attribute. Validated against POOLS so a stale or unknown hint can never
       name a pool that has no lines. */
    var p = keywordPool(extraction) || validPool(extraction.pool) || (node ? validPool(TAX.poolOf(node)) : undefined);
    if (p) meta.p = p;
    return meta;
  }

  function _pick(arr, r) {
    var v = arr[Math.floor(r * arr.length) % arr.length];
    return { title: v.e, body: v.b };
  }

  /* meta {c,t,d,p} → { title: emoji, body: text! } about THIS transaction. Pool
     wins (with a daypart variant if the pool has one), then a concept daypart
     override, then the tier line. A missing cell degrades to unknown/t2. */
  function bodyOf(meta, lang, rnd) {
    var lg = lang === 'en' ? 'en' : 'vi';
    var r = typeof rnd === 'number' ? rnd : Math.random();
    var m = meta && typeof meta === 'object' ? meta : {};
    if (m.p) {
      var pd = m.d && POOL_DAYPART[lg][m.p] && POOL_DAYPART[lg][m.p][m.d];
      var pool = pd || POOL_LINES[lg][m.p];
      if (pool) return _pick(pool, r);
    }
    var dc = m.d && DAYPART[lg][m.c] && DAYPART[lg][m.c][m.d];
    if (dc) return _pick(dc, r);
    var rows = MATRIX[lg][m.c] || MATRIX[lg].unknown;
    var t = Math.min(4, Math.max(1, Number(m.t) || 2));
    var cell = rows[t - 1] || rows[1];
    return _pick(cell, r);
  }

  /* The one-time backfill digest — the single line allowed a number (a batch
     size is not private). Same {title, body} shape; face in the title. */
  function digestOf(count, lang) {
    var n = Math.max(1, Number(count) || 1);
    var L = DATA.digest[lang === 'en' ? 'en' : 'vi'];
    return { title: L.e, body: L.b.split('{n}').join(String(n)) };
  }

  /* A statement arrived. Its own line because it asks for something different: a
     transaction push asks for one tap, this asks for a few minutes and perhaps a
     password, and a generic "something is waiting" followed by a password prompt
     reads as a bait-and-switch (statement-capture-spec.md, decision S26). Carries
     NOTHING: no bank (where someone banks is itself private), no count, no period. */
  function statementOf(lang) {
    var L = DATA.statement[lang === 'en' ? 'en' : 'vi'];
    return { title: L.e, body: L.b };
  }
`;
}

const STAMP = '/* GENERATED by tools/gen-notify-lines.js from taxonomy/notify-lines.json — do not edit.';

function workerMjs(d, json) {
  return STAMP + '\n' +
    '   The notification line tables + the shared selection logic, for the mailbox\n' +
    '   worker and push-send. notify-copy.mjs wraps these. Version ' + d.version + '. */\n' +
    "import { conceptOf, poolOf } from './taxonomy.mjs';\n" +
    'const DATA = ' + json + ';\n' +
    'const TAX = { conceptOf: conceptOf, poolOf: poolOf };' +
    logic() + '\n' +
    'export const NOTIFY_VERSION = DATA.version;\n' +
    'export const DAYPARTS = DATA.dayparts;\n' +
    'export const DIGEST = DATA.digest;\nexport const STATEMENT = DATA.statement;\n' +
    /* The tables are the template's own vars — re-declaring them here would be a
       second copy, and a second copy is the bug this generator exists to kill. */
    'export { CONCEPTS, TIERS, POOLS, MATRIX, DAYPART, POOL_LINES, POOL_DAYPART };\n' +
    'export { metaOf, bodyOf, digestOf, statementOf, tierOf, dayPartOf, keywordPool, validPool, deburr };';
}

function clientJs(d, json) {
  return STAMP + '\n' +
    '   window.FH_NOTIFY: meta(extraction) and body(meta, lang, rnd) — the device twin\n' +
    '   of notify-copy.mjs, so the preview in the permission sheet is the line the\n' +
    '   server would have sent (notification-activation-spec.md §6). Version ' + d.version + '. */\n' +
    'var FH_NOTIFY = (function () {\n' +
    '  var DATA = ' + json + ';\n' +
    '  /* The tree is read lazily: 11-taxonomy.js sorts before this file, but a\n' +
    '     caller that runs before either is parsed still gets an honest null. */\n' +
    '  var TAX = {\n' +
    '    conceptOf: function (code) { return window.FH_TAX ? window.FH_TAX.conceptOf(code) : null; },\n' +
    '    poolOf: function (code) { return window.FH_TAX ? window.FH_TAX.poolOf(code) : null; }\n' +
    '  };' +
    logic() + '\n' +
    '  return { version: DATA.version, lines: DATA, meta: metaOf, body: bodyOf,\n' +
    '    digest: digestOf, statement: statementOf, tierOf: tierOf, dayPartOf: dayPartOf,\n' +
    '    keywordPool: keywordPool, deburr: deburr };\n' +
    '})();\nwindow.FH_NOTIFY = FH_NOTIFY;';
}

function writeIfChanged(rel, content) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return true;
}

function generate() {
  const d = load();
  const json = JSON.stringify({
    version: d.version, concepts: d.concepts, tiers: d.tiers, dayparts: d.dayparts,
    pools: d.pools, matrix: d.matrix, daypart: d.daypart,
    poolLines: d.poolLines, poolDaypart: d.poolDaypart,
    digest: d.digest, statement: d.statement,
  });
  const changed = [
    writeIfChanged('supabase/functions/_shared/mailbox/notify-lines.mjs', workerMjs(d, json)),
    writeIfChanged('src/js-ui/14-notify-lines.js', clientJs(d, json)),
  ].filter(Boolean).length;
  let lines = 0;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.e === 'string' && typeof v.b === 'string') lines++;
      else Object.keys(v).forEach((k) => walk(v[k]));
    }
  };
  [d.matrix, d.daypart, d.poolLines, d.poolDaypart, d.digest, d.statement].forEach(walk);
  return { lines, changed };
}

module.exports = { generate, load };
if (require.main === module) {
  const r = generate();
  console.log('notify-lines: ' + r.lines + ' lines, ' + r.changed + ' target(s) rewritten');
}
