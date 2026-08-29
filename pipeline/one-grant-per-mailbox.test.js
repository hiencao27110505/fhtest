#!/usr/bin/env node
/* One mailbox has one reader, and a refusal that says something useful.
 * `node pipeline/one-grant-per-mailbox.test.js`
 *
 * mailbox_grants was unique on (user_id, provider) — one mailbox per account —
 * which permits the opposite pairing: one mailbox connected from two accounts.
 * It happened on live data. Both grants polled the same Gmail, and because the
 * staging guard is keyed on gmail_message_id neither double-staged anything:
 * whichever polled first CLAIMED each message. Three days of transactions
 * landed in a queue nobody was signed in to, and the person watching saw a feed
 * that stopped dead with no error anywhere.
 *
 * 0103 makes the second connection fail at insert. This pins the constraint's
 * shape and the sentence the failure turns into — "that already exists" would
 * be true and useless, because the thing that exists is on another account.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0103_one_grant_per_mailbox.sql'), 'utf8');
const ui  = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '60-settings-family-ui.js'), 'utf8');

console.log('\n-- the constraint --');
t('it is unique, not merely an index', /create unique index/i.test(mig));
t('case-insensitive — Gmail addresses are', /lower\(/i.test(mig));
t('and whitespace-insensitive', /btrim\(/i.test(mig));
t('scoped to the mailbox, NOT to (mailbox, provider) — two providers on one address race identically',
  !/provider/i.test(mig.split('create unique index')[1] || ''));

console.log('\n-- the sentence someone can act on --');
const idx = ui.indexOf('mailbox_grants_one_per_mailbox');
t('the constraint name is matched by the friendly mapper', idx > 0);
t('it is answered BEFORE the generic duplicate-key line',
  idx > 0 && idx < ui.indexOf('duplicate key|already exists'));
t('the message says the mailbox is on another account',
  /another account|tài khoản khác/.test(ui.slice(idx, idx + 500)));
t('and says what to do about it', /Disconnect it there|Ngắt kết nối ở tài khoản đó/.test(ui.slice(idx, idx + 500)));

console.log('\n-- the model of the rule --');
const norm = e => String(e || '').trim().toLowerCase();
const insert = (existing, email) => {
  if (existing.some(x => norm(x) === norm(email))) throw new Error('mailbox_grants_one_per_mailbox');
  existing.push(email); return existing;
};
let grants = ['trang.nguyen.wh@gmail.com'];
t('the same address is refused', (() => { try { insert(grants, 'trang.nguyen.wh@gmail.com'); return false; } catch { return true; } })());
t('different capitalisation is refused too', (() => { try { insert(grants, 'Trang.Nguyen.WH@Gmail.com'); return false; } catch { return true; } })());
t('surrounding whitespace is refused too', (() => { try { insert(grants, '  trang.nguyen.wh@gmail.com '); return false; } catch { return true; } })());
t('a genuinely different mailbox is allowed', (() => { insert(grants, 'someone.else@gmail.com'); return grants.length === 2; })());

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
