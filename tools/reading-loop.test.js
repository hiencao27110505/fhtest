#!/usr/bin/env node
/* The reading loop stops burning the phone (docs/specs/reading-loop-cost-spec.md):
 * during a mailbox backfill the client used to issue ~45-60 requests a minute,
 * re-decrypt the same three feed rows on every tick, rebuild the whole Cá nhân
 * tab per tick, and keep its timer running while backgrounded.
 * `node tools/reading-loop.test.js`
 *
 * Source-shape guards in the style of personal-activation.test.js: each one
 * pins a decision from the spec's log (H2-H5) so a refactor that quietly
 * reintroduces the waste fails loudly instead of warming phones again.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const atx = R('src/js-data/74-autotxn-ui.js');
const ui = R('src/js-ui/21-personal.js');
const css = R('src/css/74-mailbox.css');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

console.log('\n-- H2: repeated work is remembered, not redone --');
t('opened rows are cached by id and a cached row is never re-unsealed',
  /_atxOpenCache = new Map\(\)/.test(atx) && /_atxOpenCache\.has\(r\.id\)/.test(atx) && /_atxOpenCache\.set\(r\.id/.test(atx));
t('the open cache is capped (a display cache, not storage)',
  /ATX_OPEN_CACHE_MAX/.test(atx) && /_atxOpenCache\.delete\(/.test(atx));
t('the private key is resolved once per batch through a pool, not once per row',
  /_atxPrivPool/.test(atx) && /pool \|\| _atxPrivPool\(\)/.test(atx)
  && !/const priv = personal\s*\n?\s*\? await window\.fhPersonalStagingPrivKey\(\)/.test(atx));
t('the recurring tick request is the delta drain, oldest-first with a strict cursor',
  /_atxDeltaRows/.test(atx) && /\.gt\('created_at', cursor\)/.test(atx)
  && /_atxDeltaRows[\s\S]{0,400}ascending: true/.test(atx));
t('a burst larger than one page drains across ticks instead of being skipped',
  /cursor = fresh\[fresh\.length - 1\]\.created_at/.test(atx));
t('the grant row is asked on quiet drains and a slow stride, never on every tick',
  /quietLast && tickN % 2 === 0/.test(atx) && /tickN % 8 === 0/.test(atx));
t('the frontier is maintained from rows already held, floored in localStorage',
  /_atxFloorFrontier/.test(atx) && /_atxFrontKey\(gid\)/.test(atx));

console.log('\n-- H3: arming extends the running watcher, never replaces it --');
t('a second arm call while the watcher runs only pushes the deadline',
  /_atxLiveUntil = Date\.now\(\) \+ ATX_LIVE_EXTEND_MS;\s*\n\s*if \(_atxLiveOn\) return;/.test(atx));
t('an absolute ceiling bounds one watcher\'s life',
  /ATX_LIVE_CEILING_MS/.test(atx) && /Math\.min\(_atxLiveUntil, t0 \+ ATX_LIVE_CEILING_MS\)/.test(atx));
t('surfaced is judged per tick, not latched one-way',
  !/badgeOnly = true/.test(atx));

console.log('\n-- H4: hidden means parked --');
t('the timer stops when the document hides; only visibilitychange resumes it',
  /if \(document\.hidden\) \{[\s\S]{0,200}_atxParked = function/.test(atx)
  && /addEventListener\('visibilitychange'/.test(atx));
t('the end-of-window reconcile can only run visible (it sits past the park gate)',
  /document\.hidden[\s\S]{0,4000}fhRefreshStagedCount && window\.fhRefreshStagedCount\(\)/.test(atx));

console.log('\n-- H5: patch the numbers, never rebuild the tab per tick --');
t('the tick body never calls renderPersonal while the phase holds steady',
  /phase === lastPhase && typeof window\.persProgressPatch === 'function'/.test(atx));
t('persProgressPatch exists and touches only the two live nodes',
  /window\.persProgressPatch = function/.test(ui)
  && /getElementById\('pact-live'\)/.test(ui) && /getElementById\('pact-bar'\)/.test(ui));
t('the reading card carries the patch targets',
  /<span id="pact-live">/.test(ui) && /<i id="pact-bar"/.test(ui));

console.log('\n-- the meter that makes the acceptance numbers checkable --');
t('requests, unseals and paints are counted and reported at window end',
  /window\.fhReadLoopStats/.test(atx) && /_atxStats\.req\+\+/.test(atx)
  && /_atxStats\.unseals\+\+/.test(atx) && /read-loop: /.test(atx));

console.log('\n-- the standing compositor layers are gone --');
t('.atx-fd-wrap no longer holds will-change for the whole session',
  !/atx-fd-wrap\{[^}]*will-change/.test(css));

console.log('');
if (fail) { console.error(fail + ' failing'); process.exit(1); }
console.log('reading-loop: ' + pass + ' checks pass');
