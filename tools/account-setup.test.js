#!/usr/bin/env node
/* Account setup (0134, docs/specs/account-setup-spec.md): an account shows a
 * number only after the person has typed one.
 * `node tools/account-setup.test.js`
 *
 * A fresh mailbox-connected user's accounts materialize from a lookback window
 * of email, so every derived number was wrong on day one: a card's outstanding
 * ignored the balance carried in from before the window, and a pre-window
 * statement payment flipped it to "Đang dư" and inflated Được nợ. These are
 * source-shape guards over the rules the spec settled, in the same style as
 * personal-unreadable.test.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const data = R('src/js-data/19-personal.js');
const debts = R('src/js-data/23-debts-ui.js');
const review = R('src/js-data/72-txn-review.js');
const quick = R('src/js-data/76-quick-review.js');
const writes = R('src/js-data/40-txn-writes-outbox.js');
const wt = R('src/js-data/50-writethrough-realtime.js');
const push = R('src/js-data/55-push.js');
const mbx = R('src/js-data/71-mailbox-ui.js');
const hyd = R('src/js-data/30-hydrate.js');
const ob = R('src/js-ui/80-onboard-boot.js');
const detail = R('src/js-ui/61-expense-detail.js');
const sheet = R('src/js-ui/50-sheets-expense-capture.js');
const mig = R('supabase/migrations/0134_account_setup_skipped.sql');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

console.log('\n-- one balance rule for every kind --');
t('cards are no longer excluded from the anchored balance',
  /if \(!a \|\| a\.anchorK == null\) return null;/.test(data) && !/a\.kind === 'credit_card' \|\| a\.anchorK == null/.test(data));
t('a card is verified only once anchored, and reads outstanding = −balance',
  /const bal = a\.anchorK != null \? window\.fhPersonalBalance\(a\.id\) : null;[\s\S]{0,120}outstanding: verified \? -bal/.test(data));
t('the Tôi nợ / Được nợ totals skip unverified cards',
  /for \(const c of cards\) \{ if \(!c\.verified\) continue;/.test(data));
t('the debts derivation counts what still needs setup', /unverified: unverified/.test(data));
t('the wizard stores a card anchor NEGATIVE', /anchorK: isCard \? -amt : amt/.test(debts));

console.log('\n-- the anchor supersedes older bank numbers (cause 6) --');
t('setting an anchor drops the captured Số dư (both writers)', /ext_balance_enc: null, ext_balance_date: null,/.test(data) && /row\.ext_balance_enc = null; row\.ext_balance_date = null;/.test(data));
t('drift ignores a bank number older than the anchor day',
  /a\.extDate < _localDate\(new Date\(a\.anchorAt\)\)\) return null;/.test(data));
t('a pre-anchor Số dư is never stored over the anchor',
  /day < _localDate\(new Date\(a\.anchorAt\)\)\) return true;/.test(data));

console.log('\n-- the gate: no number until typed, tile is the way in --');
t('an un-anchored account renders the setup tile (cards too)',
  /if \(!c\.verified\) \{ tiles\.push\(setupTile\(c\.acct\)\); return; \}/.test(debts) && /if \(bal == null\) \{ tiles\.push\(setupTile\(a\)\); return; \}/.test(debts));
t('the tile CTA is the one line', /Chạm để thiết lập/.test(debts));
t('the hero hides until something contributes', /if \(contributes\) h \+= '<section class="dbt-tile wide dbt-hero">'/.test(debts));
t('the hero footnote names what is missing', /Chưa gồm ' \+ unv \+ ' tài khoản chưa thiết lập/.test(debts));
t('the reconcile path survives (kept until the wizard proves itself)',
  /fhCardReconcileSheet = function/.test(debts) && /'Điều chỉnh dư nợ'/.test(debts));

console.log('\n-- when the wizard fires --');
t('the full-queue promote hands touched accounts to the wizard',
  /fhAcctSetupAfterImport\(touchedIds\)/.test(review));
t('touched = rows landed on it, or the queue session materialized it',
  /_fhQueueNewAccts\.push\(idE\)/.test(review) && /specs\.forEach\(function \(s\) \{ if \(s && s\.accountId\) touchedAccts\[s\.accountId\] = 1; \}\)/.test(review));
t('the one-row quick sheet never opens the wizard', !/fhAcctSetupAfterImport|fhAcctSetupWizard/.test(quick));
t('"Để sau" is remembered on the account', /setup_skipped_at/.test(mig) && /setupSkipped/.test(data) && /fhPersonalAccountSetupNeeded/.test(data));
t('the wizard filter excludes skipped and anchored accounts, investments out',
  /a\.kind !== 'investment' && a\.anchorK == null && !a\.setupSkippedAt/.test(data));

console.log('\n-- the family-scope gap: the author\'s instrument reaches the master --');
t('family promote resolves the account and reserves a link_id',
  /tc\._pAcct = tId; tc\._link = crypto\.randomUUID\(\)/.test(review));
t('the quick sheet does the same for one row', /window\._fhImportAcct = idF; window\._fhImportLink = crypto\.randomUUID\(\)/.test(quick));
t('the family writer pre-sets link_id and writes the tagged master',
  /link_id: linkId \}/.test(writes) && /fhPersonalInsertMaster\(linkId, fid, row\.txn_date/.test(writes));
t('the master insert carries account_id', /account_id: accountId \|\| null \}\);\s*\/\/ 0134/.test(data));
t('the family sheet reads the "Trả bằng gì?" chip for a manual log', /_famAcctPick\(\)/.test(wt));
t('the family sheet shows the chips when the personal ledger is ready', /personal\|\|\(pReady&&!income\)/.test(sheet));
t('the family row gets the same display string as an email import', /fhAccountInstString = function/.test(wt));
t('the author can edit the tag from the family detail', /exdSheetAcctFam/.test(detail) && /fhPersonalMasterSetAccount/.test(detail) && /fhPersonalMasterSetAccount = async function/.test(data));
t('a master edit is scoped to mirror rows only', /\.not\('link_id', 'is', null\);\s*\n\s*if \(r\.error\) \{ console\.warn\('master account set failed'/.test(data));

console.log('\n-- the push offer moved to the first home visit --');
t('the post-import offer is gone', !/_mbxPushOfferOnce/.test(review) && !/async function _mbxPushOfferOnce/.test(mbx));
t('a first-visit offer exists and honours the old answer',
  /fhPushFirstVisitOffer = function/.test(push) && /fh-mbx-push-nudged:' \+ mid/.test(push));
t('it fires from hydrate and from finishOnboarding', /fhPushFirstVisitOffer\(\)/.test(hyd) && /fhPushFirstVisitOffer\(\)/.test(ob));
t('it yields to another sheet instead of stacking', /scrim\.classList\.contains\('on'\)\) return;/.test(push));
t('the key is set only when the sheet actually opens', /localStorage\.setItem\(key, '1'\);\s*\n\s*window\.fhPushSheet\(\);/.test(push));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
