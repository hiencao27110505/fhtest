#!/usr/bin/env node
/* Personal-tab activation states (docs/specs/personal-activation-spec.md):
 * a first-time user gets one card, not a dashboard full of zeros.
 * `node tools/personal-activation.test.js`
 *
 * Source-shape guards over the rules the spec settled, in the style of
 * account-setup.test.js: the four states, what each one shows, what it must
 * not show, and the two exports the tab leans on.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const ui = R('src/js-ui/21-personal.js');
const data = R('src/js-data/19-personal.js');
const quick = R('src/js-data/76-quick-review.js');
const streaks = R('src/js-data/27-streaks.js');
const css = R('src/css/40-spending-tabs.css');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

console.log('\n-- four states, derived from data the app already holds --');
t('the state is read from the ledger, the badge count and the mailbox, nothing stored',
  /function persActivation\(P, SL\)\{/.test(ui) && /window\.fhStagedCount\|\|0/.test(ui) && /persMailProbe\(\)/.test(ui));
t('states 1 and 2 replace the dashboard: no 0 ₫ hero, no chart, no empty sections',
  /if\(act\.state<=2\)\{[\s\S]{0,300}_persCommit\(host, persActCard\(act, mon\) \+ persWillSeeHTML\(\), isCur, false\);\s*return;/.test(ui));
t('state 1 has one primary CTA (connect email) and manual entry as a text link',
  /act\.state===1[\s\S]{0,600}class="cta pact-cta" onclick="fhEmailTxnCta\(\{scope:\\'personal\\'\}\)"[\s\S]{0,200}Kết nối email ngân hàng/.test(ui)
  && /class="ob-textlink pact-link" onclick="openPersonalExpense\(\)">Hoặc ghi tay một khoản/.test(ui));
t('state 2 shows the newest staged row as the top of a deck, read-only, tap = the queue',
  /class="pq-card" onclick="fhEmailTxnCta\(\{scope:\\'personal\\'\}\)"/.test(ui) && /<i class="k2"><\/i><i class="k3"><\/i>/.test(ui)
  && !/pq-card[^\n]*onclick="[^"]*(fhPersonalAddExpense|fhQuickReview|Ghi vào sổ)/.test(ui));
t('state 2 degrades to a blank deck while the row is still opening (never a wrong number)', /class="pq-sk"/.test(ui));
t('state 2 covers a first read still running and a dead grant before it shows a queue',
  /pg\.phase==='reading'/.test(ui) && /fhReauthState\(\)/.test(ui));
t('the privacy footer is gone from the guidance cards', !/pact-[\s\S]{0,40}Gia đình không xem được/.test(ui));
t('state 1 earns the Gmail tap with one trust line under the CTA and promises no fixed window',
  /class="pact-trust"[\s\S]{0,200}Chỉ đọc email báo giao dịch từ ngân hàng/.test(ui) && /vài tháng giao dịch gần nhất/.test(ui) && !/90 ngày giao dịch/.test(ui)
  && /<div class="cf-lbl">Sổ cá nhân<\/div>/.test(ui));
t('the last mailbox answer is cached per user so a returning person never sees the start card flash',
  /function persMailSeed\(\)/.test(ui) && /localStorage\.setItem\(_persMailKey\(\)/.test(ui));
t('the quick-review pop yields to the deck in state 2', /persActState\(\)===2\) \|\| \(window\.fhStagedCount\|\|0\)>0\) return; window\.fhQuickReviewMaybe\(\)/.test(R('src/js-ui/10-nav-model.js')));
t('the header avatar falls back to the signed-in person\'s initials', /el\.className='av av-40 av-you'/.test(ui) && /\.av-you\{/.test(css));

console.log('\n-- state 3: the widget above the real dashboard --');
t('three steps: first row, accounts and cards, monthly budget; the second is named "Cài đặt tài khoản, thẻ"',
  /t:'Có khoản đầu tiên'/.test(ui) && /t:'Cài đặt tài khoản, thẻ'/.test(ui) && /t:'Lập ngân sách tháng'/.test(ui) && !/Chốt số dư tài khoản/.test(ui));
t('step 2 is done when every non-investment account is anchored or skipped',
  /a\.anchorK==null && !a\.setupSkippedAt/.test(ui) && /accts\.length>0 && need\.length===0/.test(ui));
t('the widget shows only the remaining steps and can be hidden; hidden or complete = state 4',
  /act\.open\.forEach/.test(ui) && /persSetupHide/.test(ui) && /\(!open\.length \|\| persSetupHidden\(P\)\) \? 4 : 3/.test(ui));
t('state 4 renders no setup widget at all', /var h = act\.state===3 \? persSetupWidgetHTML\(act\) \+ persQueueWidgetHTML\(act\) : '';/.test(ui) && !/act\.state===4[^\n]*persSetupWidgetHTML/.test(ui));
t('step 2 opens the account-setup wizard for the accounts that need it', /fhAcctSetupWizard\(st\.needIds, \{ intro: true \}\)/.test(ui));
t('streak and investment empty states are built from the month\'s own private rows',
  /function persStreakDriven\(P, mon\)/.test(ui) && /top\.n<3\) return base/.test(ui)
  && /function persInvestDriven\(P, mon\)/.test(ui) && /_PERS_INV_RE\.test\(_persFold\(t\.note\)\)/.test(ui));
t('the driven empties fall back to the sections\' own markup when there is nothing to name',
  /if\(cnt !== 0\) return base;/.test(ui) && /if\(!hits\.length\) return base;/.test(ui));

console.log('\n-- the queue deck as a standing widget --');
t('the deck is one builder shared by the state 2 card and the standalone widget',
  /function persQueueDeckHTML\(n\)\{/.test(ui) && (ui.match(/persQueueDeckHTML\(n\)/g) || []).length >= 3);
t('states 3 and 4 mount the widget right under the first widget whenever rows wait',
  /persSetupWidgetHTML\(act\) \+ persQueueWidgetHTML\(act\)/.test(ui) && /if\(act\.state===4\) h \+= persQueueWidgetHTML\(act\);/.test(ui) && /var n = act\.queue \|\| 0; if\(!n\) return '';/.test(ui));
t('the widget hides while a first read runs or the grant is dead', /fhBackfillHolds\(\)\) return '';/.test(ui) && /fhReauthState\(\)\) return '';/.test(ui));
t('the widget keeps the screen to one primary: its action is the tinted button', /pq-widget[\s\S]{0,400}class="dbt-empty-cta"/.test(ui) && !/pq-widget[\s\S]{0,400}class="cta /.test(ui));
t('quick review never auto-pops while the first read is running', /if \(!opts\.force\) \{[\s\S]{0,300}fhBackfillHolds\(\)\) return;/.test(quick));
t('quick review never auto-pops while the deck is on screen', /\(window\.fhStagedCount\|\|0\)>0\) return; window\.fhQuickReviewMaybe\(\)/.test(R('src/js-ui/10-nav-model.js')));

console.log('\n-- exports the tab leans on --');
t('quick review exports a cached, never-throwing peek at the newest personal row',
  /window\.fhStagedPeek = async function \(forCount\)/.test(quick) && /window\.fhStagedPeekCached = function/.test(quick)
  && /catch \(e\) \{ _peek = _peek \|\| \{ n: 0 \}; return _peek; \}/.test(quick));
t('the peek is keyed on the badge count so a promote refreshes it', /_peekFor === forCount/.test(quick));
t('streaks export how many definitions exist (null until loaded)', /window\.fhStreakDefsCount = function/.test(streaks));

console.log('\n-- the sync note no longer waits forever --');
t('no family = nothing to mirror: mirrorRan flips at once', /if \(!fid \|\| !myMem\) \{ if \(!P\.mirrorRan\) \{ P\.mirrorRan = true;/.test(data));
t('a family key that never warms up gives up after the retries and clears the note',
  /if \(_mirrorTries\+\+ < 5\) \{ _mirrorSoon\(4000\); return; \}\s*if \(!P\.mirrorRan\) \{ P\.mirrorRan = true;/.test(data));

console.log('\n-- kit --');
t('the activation styles use tokens only (no raw hex)', !/\.p(act|q|su)-[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(css));
t('the cards reuse the app kit: .cta, .ob-textlink, .cf-lbl, .personal-ico',
  /class="cta pact-cta"/.test(ui) && /class="ob-textlink pact-link/.test(ui) && /class="cf-lbl"/.test(ui) && /class="r-ico personal-ico"/.test(ui) && !/\.pact-lbl\{|\.pact-chip\{|\.pact-empty\{/.test(css));
t('one empty-state card for every section: streaks, debts, investment and the two driven cards all go through fhEmptyCard',
  /window\.fhEmptyCard = function\(o\)/.test(ui) && (ui.match(/fhEmptyCard\(\{/g) || []).length === 2
  && /fhEmptyCard\(\{ e: '🎯'/.test(streaks) && /fhEmptyCard\(\{ e: '🤝'/.test(R('src/js-data/23-debts-ui.js')) && /fhEmptyCard\(\{ e: '📈'/.test(R('src/js-data/26-investment-ui.js'))
  && /\.emp\{[^}]*text-align:center/.test(R('src/css/41-debts.css')) && /\.emp \.dbt-empty-cta button\.pri\{background:var\(--brand\)/.test(R('src/css/41-debts.css')));
t('every tappable activation element is a real button', /\.pq-card\{[^}]*cursor:pointer/.test(css) && /<button class="pq-card"/.test(ui) && /<button class="psu-step/.test(ui));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
