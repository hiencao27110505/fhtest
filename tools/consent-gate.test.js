#!/usr/bin/env node
/* PDPL consent gate: ask before processing, record before proceeding.
 * `node tools/consent-gate.test.js`
 *
 * The properties that matter legally, in testable form: the gate never lets a
 * connect flow continue without a current-version record; agreeing writes the
 * record BEFORE the flow resumes and a failed write blocks rather than
 * proceeds; the sheet names the data as sensitive in the statutory words; and
 * withdrawal is armed, never one tap. Wiring is asserted at the source level
 * because a gate nobody calls passes every unit test while gating nothing —
 * the markMailboxVerified lesson.
 */
// NOT 'use strict': the eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', f), 'utf8');
const consentSrc = SRC('75-consent-ui.js');
const mailboxSrc = SRC('71-mailbox-ui.js');
const autotxnSrc = SRC('74-autotxn-ui.js');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0082_user_consents_disconnect.sql'), 'utf8');
const privacySrc = fs.readFileSync(path.join(__dirname, '..', 'privacy.html'), 'utf8');
const shellSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

// ── stubs ───────────────────────────────────────────────────────────────────
global.window = { toast: () => {} };
let SHEETS = [];
function _fhSheet(html) { SHEETS.push(html); }
function _closeOv() {}
const _esc = (s) => String(s);
const _escAttr = (s) => String(s).replace(/"/g, '&quot;');
// the type-to-confirm button, looked up by id when the phrase is checked
let TYPE_BTN = { disabled: true };
global.document = { getElementById: (id) => (id === 'cst-del-go' ? TYPE_BTN : null) };
const L = (vi, en) => vi;
const _mbxGlyph = () => '';
const fmtDayMon = () => '20/08';
global.setTimeout = (fn) => 0;   // arm-reset timer is irrelevant here

let SELECT_RESULT = { data: [], error: null };
let INSERTS = [], INSERT_RESULT = { error: null };
let RPC_CALLS = [], RPC_FAIL = false;
let SELECT_BY_TABLE = {};   // per-table override; SELECT_RESULT is the fallback
const sb = {
  from(table) {
    const tableResult = () => (table in SELECT_BY_TABLE
      ? { data: SELECT_BY_TABLE[table], error: null }
      : SELECT_RESULT);
    return {
      select() { return this; }, eq() { return this; }, order() { return this; },
      is() { return this; },   // deletion_requests filters on .is('cancelled_at', null)
      limit() { return Promise.resolve(tableResult()); },
      insert(row) { INSERTS.push({ table, row }); return Promise.resolve(INSERT_RESULT); },
    };
  },
};
async function _rpc(name, args) { RPC_CALLS.push(name); if (RPC_FAIL) throw new Error('down'); return {}; }

eval(consentSrc);

function reset(sel, byTable) {
  SHEETS = []; INSERTS = []; RPC_CALLS = [];
  SELECT_RESULT = sel; SELECT_BY_TABLE = byTable || {}; INSERT_RESULT = { error: null }; RPC_FAIL = false;
  // bust the session cache between scenarios: re-eval is cheaper than exposing it
  eval(consentSrc);
}

// ── the gate ────────────────────────────────────────────────────────────────
console.log('\n-- the gate asks exactly when it should --');

(async () => {
  reset({ data: [], error: null });
  let ran = false;
  let ok = await window.fhConsentEnsure(() => { ran = true; });
  t('no record: gate refuses and shows the sheet', ok === false && SHEETS.length === 1 && !ran);

  reset({ data: [{ version: FH_CONSENT_V, consented_at: '2026-08-23T10:00:00Z' }], error: null });
  ok = await window.fhConsentEnsure(() => {});
  t('current-version record: gate passes with no sheet', ok === true && SHEETS.length === 0);

  reset({ data: [{ version: FH_CONSENT_V - 1, consented_at: '2026-08-01T10:00:00Z' }], error: null });
  ok = await window.fhConsentEnsure(() => {});
  t('an OLDER version re-asks: new text means new consent', ok === false && SHEETS.length === 1);

  reset({ data: null, error: { message: 'relation user_consents does not exist' } });
  ok = await window.fhConsentEnsure(() => {});
  t('unreadable record fails closed to ASKING, never to proceeding', ok === false && SHEETS.length === 1);

  // ── the statutory words are actually in the sheet ─────────────────────────
  console.log('\n-- the sheet says what the law requires --');
  const html = SHEETS[0];
  t('names the data as sensitive, verbatim', html.indexOf('dữ liệu cá nhân nhạy cảm') >= 0);
  t('names the document type (a consent, not a T&C)', html.indexOf('ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN') >= 0);
  t('links the privacy policy', html.indexOf('privacy.html') >= 0);
  t('affirmative CTA present', html.indexOf('fhConsentAgree') >= 0);
  t('no em-dash anywhere in the consent module (house rule)', consentSrc.indexOf('\u2014') === -1);
  // The statutory heavy artillery moved to the policy, one tap away, by design:
  t('policy: controller role in statutory words', privacySrc.indexOf('bên kiểm soát và xử lý dữ liệu cá nhân') >= 0);
  t('policy: offshore storage in statutory words', privacySrc.indexOf('ngoài lãnh thổ Việt Nam') >= 0);
  t('policy: state-authority carve-out with the locked-copy addendum',
    privacySrc.indexOf('quan nhà nước có thẩm quyền') >= 0 && privacySrc.indexOf('bản đã khoá') >= 0);
  t('policy: imported bank statements named', privacySrc.indexOf('sao kê ngân hàng') >= 0);
  t('policy: family visibility disclosed', privacySrc.indexOf('hiển thị cho cả nhà') >= 0);
  t('policy: the in-app rights path is named', privacySrc.indexOf('Quyền riêng') >= 0);

  // ── agree: record first, resume second ────────────────────────────────────
  console.log('\n-- agreeing records before resuming --');

  reset({ data: [], error: null });
  let resumed = false;
  await window.fhConsentEnsure(() => { resumed = true; });
  const btn = { disabled: false, textContent: '' };
  await window.fhConsentAgree(btn);
  t('the record is written', INSERTS.length === 1 && INSERTS[0].table === 'user_consents');
  t('with the current kind and version',
    INSERTS[0].row.kind === 'bank_email' && INSERTS[0].row.version === FH_CONSENT_V,
    JSON.stringify(INSERTS[0].row));
  t('and only then does the flow resume', resumed === true);

  reset({ data: [], error: null });
  resumed = false;
  await window.fhConsentEnsure(() => { resumed = true; });
  INSERT_RESULT = { error: { message: 'network down' } };
  await window.fhConsentAgree({ disabled: false, textContent: '' });
  t('a failed insert BLOCKS the flow: consent is proof, not vibes', resumed === false);

  reset({ data: [], error: null });
  resumed = false;
  await window.fhConsentEnsure(() => { resumed = true; });
  INSERT_RESULT = { error: { message: 'duplicate key value violates unique constraint' } };
  await window.fhConsentAgree({ disabled: false, textContent: '' });
  t('a duplicate row means already-consented: proceed', resumed === true);

  // ── read-only review ──────────────────────────────────────────────────────
  console.log('\n-- reviewing what was agreed --');
  reset({ data: [{ version: 3, consented_at: '2026-08-23T10:00:00Z' }], error: null });
  await window.fhConsentSheet({ readOnly: true });
  t('read-only sheet has no agree CTA', SHEETS[0].indexOf('fhConsentAgree') === -1);
  t('and states the accepted date', SHEETS[0].indexOf('đã xác nhận đồng ý') >= 0 && SHEETS[0].indexOf('20/08') >= 0, SHEETS[0].slice(-300));

  // ── withdrawal ────────────────────────────────────────────────────────────
  console.log('\n-- disconnect is armed, then real --');
  reset({ data: [], error: null });
  const dbtn = { dataset: {}, disabled: false, textContent: '' };
  await window.fhMailboxDisconnect(dbtn);
  t('first tap arms, calls nothing', RPC_CALLS.length === 0 && dbtn.dataset.armed === '1');
  await window.fhMailboxDisconnect(dbtn);
  t('second tap calls the RPC', RPC_CALLS[0] === 'disconnect_my_mailbox');
  t('and the after-sheet carries the Gmail-rule step (the half only they can do)',
    SHEETS[SHEETS.length - 1].indexOf('Gmail') >= 0);

  reset({ data: [], error: null });
  RPC_FAIL = true;
  const fbtn = { dataset: { armed: '1' }, disabled: false, textContent: '' };
  await window.fhMailboxDisconnect(fbtn);
  t('a failed disconnect re-enables instead of lying', fbtn.disabled === false);

  // ── the gate is actually wired (the markMailboxVerified lesson) ───────────
  console.log('\n-- source: every door calls the gate --');
  const start = mailboxSrc.slice(mailboxSrc.indexOf('window.fhMailboxStart'));
  t('forwarding: gate sits before the alias RPC',
    start.indexOf('fhConsentEnsure') >= 0 &&
    start.indexOf('fhConsentEnsure') < start.indexOf('get_or_create_mailbox_alias'));
  const grant = autotxnSrc.slice(autotxnSrc.indexOf('window.fhAutoTxnGrant'));
  t('auto-logging: gate sits before Google',
    grant.indexOf('fhConsentEnsure') >= 0 &&
    grant.indexOf('fhConsentEnsure') < grant.indexOf('_atxConsentUrl'));
  const entry = mailboxSrc.slice(mailboxSrc.indexOf('window.fhMailboxSheet'), mailboxSrc.indexOf('fhMailboxIntro()'));
  t('grandfathered users: retro gate on the status entry', /fhConsentEnsure/.test(entry));
  t('status sheet offers review of the accepted text', mailboxSrc.indexOf('fhConsentSheet({readOnly:true})') >= 0);
  t('status sheet offers disconnect', mailboxSrc.indexOf('fhMailboxDisconnect(this)') >= 0);

  // ── layer 1: app-wide data consent at boot ────────────────────────────────
  console.log('\n-- layer 1: the app-data consent --');

  reset({ data: [], error: null });
  await window.fhAppDataConsentCheck();
  t('no record at boot: the sheet appears', SHEETS.length === 1);
  const l1 = SHEETS[0];
  t('it treats financial data as sensitive in so many words', l1.indexOf('dữ liệu cá nhân nhạy cảm') >= 0);
  t('it answers the key-holder question', l1.indexOf('chìa khoá của gia đình') >= 0);
  t('it answers the breach question with a conclusion', l1.indexOf('vẫn an toàn') >= 0);
  t('it names the in-app withdrawal place', l1.indexOf('Quyền riêng tư') >= 0);
  t('links the policy', l1.indexOf('privacy.html') >= 0);

  await window.fhAppDataConsentCheck();
  t('asked once per session, not on every hydrate', SHEETS.length === 1);

  reset({ data: [], error: null });
  await window.fhAppDataConsentCheck();
  await window.fhAppDataConsentAgree({ disabled: false, textContent: '' });
  t('agreeing records kind app_data at the current version',
    INSERTS.length === 1 && INSERTS[0].row.kind === 'app_data' && INSERTS[0].row.version === FH_APPDATA_CONSENT_V,
    JSON.stringify(INSERTS));

  reset({ data: [{ version: FH_APPDATA_CONSENT_V }], error: null });
  await window.fhAppDataConsentCheck();
  t('an existing record keeps boot silent', SHEETS.length === 0);

  reset({ data: null, error: { message: 'boot flake' } });
  await window.fhAppDataConsentCheck();
  t('a flaky boot fetch skips THIS boot instead of nagging (asks next boot)', SHEETS.length === 0);

  // ── the redesigned withdrawal: granular, scheduled, cancellable ───────────
  console.log('\n-- Settings → Quyền riêng tư --');

  reset({ data: [{ kind: 'app_data', version: 1, consented_at: '2026-08-24T10:00:00Z' }], error: null },
        { deletion_requests: [] });
  await window.fhPrivacySheet();
  var priv = SHEETS[0];
  t('lists what you agreed to, per purpose', priv.indexOf('Điều bạn đã đồng ý') >= 0);
  t('erasure is present but low-prominence (ex-del, never a big red button)',
    priv.indexOf('ex-del') >= 0 && priv.indexOf('class="cta"') === -1);
  t('erasure opens a consequence sheet rather than acting', priv.indexOf('fhDeleteAllSheet()') >= 0);
  t('no one-tap withdrawal survives anywhere', consentSrc.indexOf('fhAppDataWithdraw') === -1);

  // the consequence sheet: the four things destructive copy must carry
  reset({ data: [], error: null });
  await window.fhDeleteAllSheet();
  var del = SHEETS[0];
  t('names what is lost', del.indexOf('Những gì sẽ mất') >= 0);
  t('names the RIPPLE onto the family', del.indexOf('Ảnh hưởng tới cả nhà') >= 0);
  t('names the cancellable window', del.indexOf('72 giờ') >= 0);
  t('requires typing the phrase', del.indexOf('cst-type-in') >= 0);
  t('and the commit starts disabled', /id="cst-del-go"[^>]*disabled/.test(del), del.slice(-400));

  // type-to-confirm: strict about the words, lenient about accents and case
  var btnEl = TYPE_BTN;
  window.fhDeleteAllTyped({ value: 'xoa du lieu' });
  t('an unaccented match enables it (typing Vietnamese is hard on some keyboards)', btnEl.disabled === false);
  window.fhDeleteAllTyped({ value: 'xoá' });
  t('a partial phrase does not', btnEl.disabled === true);
  window.fhDeleteAllTyped({ value: '  XOÁ DỮ LIỆU  ' });
  t('case and stray spaces are forgiven', btnEl.disabled === false);

  // committing schedules rather than deletes, and stops BOTH collection channels
  reset({ data: [], error: null });
  var stopped = false;
  window.fhAutoTxnStop = async function () { stopped = true; return true; };
  await window.fhDeleteAllConfirm({ disabled: false, textContent: '' });
  t('records the withdrawal', INSERTS.length === 1 && INSERTS[0].row.kind === 'app_data_withdraw');
  t('schedules rather than erasing', RPC_CALLS.indexOf('request_my_deletion') >= 0, JSON.stringify(RPC_CALLS));
  t('stops the OAuth channel too, not just the SQL one', stopped === true);
  t('and tells them where to change their mind', SHEETS[SHEETS.length - 1].indexOf('Quyền riêng tư') >= 0);

  // a live request outranks everything and leads with the way back
  reset({ data: [], error: null }, { deletion_requests: [{ scheduled_for: '2026-08-27T10:00:00Z' }] });
  await window.fhPrivacySheet();
  t('a pending deletion shows its date', SHEETS[0].indexOf('Đang chờ xoá') >= 0);
  t('and offers cancel as the loudest action', SHEETS[0].indexOf('fhCancelDeletion') >= 0);
  t('while hiding the entrance that would re-request it', SHEETS[0].indexOf('fhDeleteAllSheet') === -1);

  reset({ data: [{ scheduled_for: '2026-08-27T10:00:00Z' }], error: null });
  await window.fhCancelDeletion({ disabled: false, textContent: '' });
  t('cancelling calls the RPC', RPC_CALLS.indexOf('cancel_my_deletion') >= 0, JSON.stringify(RPC_CALLS));

  t('settings row opens the privacy home', shellSrc.indexOf('fhPrivacySheet()') >= 0);

  const hydrateSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '30-hydrate.js'), 'utf8');
  t('hydrate actually calls the layer-1 check (wiring, not vibes)',
    hydrateSrc.indexOf('fhAppDataConsentCheck') >= 0);

  // ── the migration holds up its half ───────────────────────────────────────
  const mig84 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '0084_deletion_requests.sql'), 'utf8');
  console.log('\n-- migration 0084: scheduled erasure --');
  t('a live request is unique per user', /unique index[\s\S]*?where cancelled_at is null and executed_at is null/.test(mig84));
  t('the client can read but not write it', /for select to authenticated/.test(mig84) && !/for (insert|update|delete) to authenticated/.test(mig84));
  t('requesting is idempotent, so a double tap cannot move the date',
    mig84.indexOf('if v_row.id is null then') >= 0);
  t('requesting stops collection but does NOT delete the ledger',
    mig84.indexOf('delete from mailbox_connections') >= 0 &&
    mig84.indexOf('delete from transactions') === -1);
  t('cancel retires the request rather than erasing history',
    /update deletion_requests set cancelled_at/.test(mig84));

  console.log('\n-- migration 0082 --');
  t('RLS enabled', /enable row level security/.test(migration));
  t('policies use the initplan form (0022 rule)',
    /\(select auth\.uid\(\)\)/.test(migration) &&
    !/[^(]auth\.uid\(\)\s*\)/.test(migration.replace(/\(select auth\.uid\(\)\)/g, '')));
  t('RPC is security definer with pinned search_path',
    /security definer set search_path = public/.test(migration));
  t('disconnect deletes pending rows AND the connection',
    migration.indexOf("review_status = 'pending'") >= 0 &&
    migration.indexOf('delete from mailbox_connections') >= 0);
  t('consent rows are append-only by design (no update/delete policy)',
    !/for (update|delete)/.test(migration));

  console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
  process.exit(fail ? 1 : 0);
})();
