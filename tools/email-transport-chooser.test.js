#!/usr/bin/env node
/* Two transports, one entry point, and it must ask rather than assume.
 * `node tools/email-transport-chooser.test.js`
 *
 * THE BUG THIS PINS. "Khoản thu chi từ email" routed on the FORWARDING state
 * alone — `linked = !!(st && st.forwarding_alias)`. So someone already
 * connected by OAuth, with no alias and a mailbox that was working, was sent to
 * the forwarding setup screen and told to paste a filter into Gmail. The two
 * journeys have always been separate; the entry point common to both was the
 * one place that had to know they both exist.
 *
 * Asserted at the SOURCE level, the way consent-gate does: the routing is three
 * lines of glue between four globals, and the failure mode is a wire going to
 * the wrong place rather than a function computing the wrong value. A unit test
 * over a stubbed router would pass while the CTA opened the wrong sheet.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', f), 'utf8');
const review = SRC('72-txn-review.js');
const autotxn = SRC('74-autotxn-ui.js');
const shell = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', '40-spending-tabs.css'), 'utf8');

console.log('\n-- the entry point considers BOTH transports --');
const cta = review.slice(review.indexOf('window.fhEmailTxnCta'), review.indexOf('window.fhEmailTxnCta') + 2000);

t('it asks about the forwarding alias', /forwarding_alias/.test(cta));
t('AND about the OAuth grant — the half that was missing',
  /fhAutoTxnConnection/.test(cta));
t('either one routes to the review queue, not to setup',
  /if \(fwd \|\| oauth\)[\s\S]{0,80}fhTxnReviewSheet/.test(cta));
t('neither one opens the chooser', /fhEmailSetupChooser/.test(cta));
t('the two lookups run in parallel — one being slow must not add to the other',
  /Promise\.all\(/.test(cta));
t('a failed lookup defaults to NOT set up, so the queue is never hidden',
  /var fwd = false, oauth = false;/.test(cta));

console.log('\n-- the chooser offers exactly the two real journeys --');
const chooser = autotxn.slice(autotxn.indexOf('window.fhEmailSetupChooser'),
                              autotxn.indexOf('window.fhAutoTxnSheet'));
t('direct read is offered', /fhEmailSetupPick\('direct'/.test(chooser) || /fhEmailSetupPick\(\\'direct\\'/.test(chooser));
t('forwarding is offered', /fhEmailSetupPick\('forward'/.test(chooser) || /fhEmailSetupPick\(\\'forward\\'/.test(chooser));
t('direct read is listed FIRST — one tap beats a filter rule, and it reads history',
  chooser.indexOf('direct') < chooser.indexOf('forward'));
t('each row says what it DOES rather than which is "recommended"',
  /cc-sub/.test(chooser) && !/recommended|khuyên dùng/i.test(chooser));
t('there is a way out that commits to neither', /btn-skip/.test(chooser));

console.log('\n-- each choice reaches its own journey --');
const pick = autotxn.slice(autotxn.indexOf('window.fhEmailSetupPick'),
                           autotxn.indexOf('window.fhEmailSetupPick') + 400);
t('forward -> the forwarding sheet', /fhMailboxSheet/.test(pick));
t('direct  -> the direct-read sheet', /fhAutoTxnSheet/.test(pick));

console.log('\n-- the personal entry point stays personal --');
t('the Cá nhân CTA passes its scope',
  /fhEmailTxnCta\(\{scope:\\?'personal\\?'\}\)/.test(fs.readFileSync(
    path.join(__dirname, '..', 'src', 'js-ui', '21-personal.js'), 'utf8')));
t('the chooser carries that scope into the direct-read journey',
  /const scope = \(preset && preset\.scope === 'personal'\)/.test(chooser));
t('and the sheet only ever NARROWS to personal — a family entry must not widen the seal',
  /if \(preset && preset\.scope === 'personal'\) _atxScope = 'personal';/.test(autotxn));

console.log('\n-- the styling the chooser depends on exists --');
t('.cc-sub is defined', /\.cc-sub\{/.test(css));
t('and uses a semantic token, not a raw colour (DESIGN §7)',
  /\.cc-sub\{[^}]*color:var\(--/.test(css));

console.log('\n-- both Settings rows still reach their own journeys directly --');
t('the direct-read row is unchanged', /set-autotxn-row[^>]*fhAutoTxnSheet\(\)/.test(shell));
t('the forwarding row is unchanged', /set-mailbox-row[^>]*fhMailboxSheet\(\)/.test(shell));

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
