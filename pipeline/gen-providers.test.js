/* receipt-providers-spec.md §9, §18 — the registry's receipt block rules, and
   the generated views senders.mjs builds from it. A registry that breaks these
   reads the wrong mail for everyone, so they are tests, not comments. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GEN = path.join(ROOT, 'tools', 'gen-providers.js');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy', 'providers.json'), 'utf8'));

let failed = 0;
function t(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail)));
  if (!ok) failed++;
}

/* Run the generator against a MODIFIED copy of the registry, in a scratch
   tree, and report whether it threw. The generator reads taxonomy/providers.json
   relative to its own location, so the scratch tree mirrors the layout. */
function generateWith(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-gen-'));
  fs.mkdirSync(path.join(dir, 'tools')); fs.mkdirSync(path.join(dir, 'taxonomy'));
  fs.mkdirSync(path.join(dir, 'src', 'js-ui'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'supabase', 'functions', '_shared', 'mailbox'), { recursive: true });
  const reg = JSON.parse(JSON.stringify(REG)); mutate(reg);
  fs.writeFileSync(path.join(dir, 'taxonomy', 'providers.json'), JSON.stringify(reg));
  fs.copyFileSync(GEN, path.join(dir, 'tools', 'gen-providers.js'));
  try { execFileSync(process.execPath, [path.join(dir, 'tools', 'gen-providers.js')], { stdio: 'pipe' }); return { ok: true }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
}
const find = (reg, key) => reg.providers.find((p) => p.key === key);

(async () => {
  console.log('\n-- the registry as committed --');
  t('generates clean', generateWith(() => {}).ok);
  const gp = find(REG, 'googleplay');
  t('Google Play is registered at ADDRESS level, not google.com',
    gp && gp.receipt && gp.receipt.senders.every((s) => s.indexOf('@') > 0), gp && gp.receipt && gp.receipt.senders);
  t('…with the one observed subject phrase (survey 2026-10-06)',
    gp && gp.receipt.subjects.length === 1 && /Google Play Order Receipt/.test(gp.receipt.subjects[0]), gp && gp.receipt.subjects);
  t('…under the registry consent (since 7)', gp && gp.receipt.since === 7, gp && gp.receipt.since);
  t('…as a subscription_invoice with a label dictionary', gp && gp.receipt.family === 'subscription_invoice' && gp.receipt.labels && gp.receipt.labels.total, gp && gp.receipt);
  const seven = ['apple', 'shopee', 'shopeefood', 'foody', 'grab', 'tiki', 'lazada'];
  t('the seven v6 senders carry no `since` (default 6)', seven.every((k) => find(REG, k).receipt && find(REG, k).receipt.since == null), seven.map((k) => find(REG, k).receipt && find(REG, k).receipt.since));

  console.log('\n-- the rules the generator enforces --');
  let r = generateWith((reg) => { find(reg, 'googleplay').receipt.senders = ['gmail.com']; });
  t('a bare personal-mail domain is refused', !r.ok && /refused/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { find(reg, 'googleplay').receipt.senders = ['google.com']; });
  t('a bare platform domain (google.com) is refused: register the address', !r.ok && /refused/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { find(reg, 'tiki').receipt.subjects = []; });
  t('empty subjects are refused (the cost gate is not optional)', !r.ok && /subjects empty/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { find(reg, 'grab').receipt.family = 'ride'; });
  t('a family outside the closed set is refused', !r.ok && /bad family/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { delete find(reg, 'apple').receipt.labels; });
  t('a non-model_only family without labels is refused', !r.ok && /needs labels/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { find(reg, 'tiki').receipt.senders = ['shopee.vn']; });
  t('one sender claimed by two providers is refused', !r.ok && /claimed by/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { find(reg, 'vib').receipt = { senders: ['vib.com.vn'], subjects: ['x'], family: 'model_only' }; });
  t('a receipt block on a non-receipt provider is refused', !r.ok && /receipt block but kind/.test(r.err), r.err && r.err.slice(0, 120));
  r = generateWith((reg) => { find(reg, 'googleplay').receipt.since = 5; });
  t('`since` below 6 is refused', !r.ok && /bad since/.test(r.err), r.err && r.err.slice(0, 120));

  console.log('\n-- the generated views senders.mjs reads --');
  const SN = await import(path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'senders.mjs'));
  t('RECEIPT_DOMAINS is exactly the registry senders', SN.RECEIPT_DOMAINS.slice().sort().join(',') ===
    REG.providers.filter((p) => p.kind === 'receipt' && p.receipt).flatMap((p) => p.receipt.senders).sort().join(','), SN.RECEIPT_DOMAINS);
  t('every sender has subjects, a family and a since', SN.RECEIPT_DOMAINS.every((d) => (SN.RECEIPT_SUBJECTS[d] || []).length && SN.RECEIPT_FAMILY[d] && SN.RECEIPT_SINCE[d] >= 6));
  t('the seven keep their v6 subjects verbatim (byte-identical query for a v6 grant)',
    SN.RECEIPT_SUBJECTS['shopee.vn'].join('|') === '"đơn hàng"|"thanh toán"' && SN.RECEIPT_SUBJECTS['grab.com'].join('|') === '"E-Receipt"|"E-receipt"'
    && SN.RECEIPT_SUBJECTS['apple.com'].length === 4 && SN.RECEIPT_SUBJECTS['tiki.vn'].join('|') === '"đơn hàng"', SN.RECEIPT_SUBJECTS);
  const e = SN.receiptEntryFor('Apple <no_reply@email.apple.com>');
  t('receiptEntryFor resolves a subdomain address to its domain entry', e && e.sender === 'apple.com' && e.key === 'apple' && e.family === 'subscription_invoice', e);
  t('…and an address entry only by exact address', SN.receiptEntryFor('x <googleplay-noreply@google.com>') && !SN.receiptEntryFor('x <payments-noreply@google.com>'));

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
