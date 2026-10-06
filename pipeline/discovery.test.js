/* receipt-providers-spec.md §5, §18, §19 — discovery is a HEADER pass:
   excludes every sender the worker reads, fetches at most DISCOVERY_MAX
   metadata, never a body, stores nothing but sender + subject shape + counts,
   asks the model once per unseen shape from the budget's leftovers. */
'use strict';
const path = require('path');

let failed = 0;
function t(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  -> ' + JSON.stringify(detail)));
  if (!ok) failed++;
}

(async () => {
  const D = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'discovery.mjs'));
  const SN = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'senders.mjs'));
  const gmail = await import(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox', 'gmail.mjs'));

  console.log('\n-- the query --');
  const q = D.discoveryQuery(7, [{ domain_or_address: 'noreply@tiki.vn', kind: 'receipt' }, { domain_or_address: 'mbbank.com.vn', kind: 'bank' }], ['x@store.vn']);
  t('receipt-shaped subjects only', /^subject:\(/.test(q) && /receipt/.test(q) && /"hoá đơn"/.test(q), q.slice(0, 120));
  t('every registered receipt sender is negated', SN.RECEIPT_DOMAINS.every((d) => q.indexOf('-from:' + d) >= 0));
  t('banks and wallets are negated', q.indexOf('-from:vib.com.vn') >= 0 && q.indexOf('-from:mservice.com.vn') >= 0);
  t('fast-lane rows and known candidates are negated', q.indexOf('-from:noreply@tiki.vn') >= 0 && q.indexOf('-from:x@store.vn') >= 0);
  t('promo tokens and the window ride', / -from:marketing/.test(q) && / newer_than:7d$/.test(q));
  t('"trip" and bare "order" are not terms (travel newsletters, LinkedIn)', !D.DISCOVERY_TERMS.some((x) => /^"?(trip|order)"?$/.test(x)), D.DISCOVERY_TERMS);

  console.log('\n-- one pass over a fake mailbox --');
  // Patch the Gmail module's fetchers through the fetch impl: listMessageIds and
  // getMessageMetadata call _get(path), which uses fetchImpl. We answer them.
  const metas = {
    m1: { from: 'Tiki <noreply@tiki.vn>', subject: 'Xác nhận đơn hàng #1', internalDate: 1759700000000 },
    m2: { from: 'Google Play <googleplay-noreply@google.com>', subject: 'Your Google Play Order Receipt from Oct 6, 2026', internalDate: 1759700000000 },
    m3: { from: 'A Friend <friend@gmail.com>', subject: 'receipt for lunch', internalDate: 1759700000000 },
    m4: { from: 'Store X <orders@storex.vn>', subject: 'Your order confirmation #88', internalDate: 1759700000000 },
    m5: { from: 'Store X <orders@storex.vn>', subject: 'Your order confirmation #89', internalDate: 1759710000000 },
    m6: { from: 'Nguyen Van A <nguyen.van.a@company.vn>', subject: 'invoice please', internalDate: 1759700000000 },
  };
  let bodyFetches = 0;
  const fakeFetch = async (url) => {
    const u = String(url);
    if (/\/messages\?/.test(u)) return { ok: true, status: 200, json: async () => ({ messages: Object.keys(metas).map((id) => ({ id })) }), text: async () => '' };
    const m = u.match(/\/messages\/([^?]+)\?format=(\w+)/);
    if (m) {
      if (m[2] !== 'metadata') { bodyFetches++; return { ok: true, status: 200, json: async () => ({ payload: {} }), text: async () => '' }; }
      const x = metas[m[1]];
      return { ok: true, status: 200, json: async () => ({ id: m[1], internalDate: String(x.internalDate), labelIds: [], payload: { headers: [{ name: 'From', value: x.from }, { name: 'Subject', value: x.subject }] } }), text: async () => '' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'nope' };
  };
  const inserted = [], verdicts = [], bumps = [], tallies = [];
  const db = {
    candidateSenders: async () => ['noreply@tiki.vn'],
    candidatesGet: async () => new Map(),
    candidateInsert: async (row) => { inserted.push(row); },
    candidateBump: async (id, n) => { bumps.push([id, n]); },
    candidateVerdict: async (s, tpl, v, store) => { verdicts.push({ s, tpl, v, store }); },
    bumpReadTally: async (s) => { tallies.push(s); },
  };
  // llm: no apiKey → askVerdicts returns null → no verdicts, but the budget is still spent once.
  const budget = { left: 3 };
  const out = await D.runDiscovery({ id: 'g1' }, { db, fetch: fakeFetch, llm: {}, classifyBudget: budget }, { access: 'tok', days: 7, domains: [] });
  t('every listed id was metadata-fetched (6 ≤ cap 10)', out.meta === 6, out);
  t('NO body was ever fetched', bodyFetches === 0, bodyFetches);
  t('a registered receipt sender (Google Play) and a known candidate (Tiki) are skipped', out.skipped >= 2, out);
  t('a personal mailbox and a person-shaped address are skipped', !inserted.some((r) => /gmail\.com|nguyen\.van\.a/.test(r.sender)), inserted);
  t('the store\'s two mails fold into ONE shape, seen 2', inserted.length === 1 && inserted[0].sender === 'orders@storex.vn' && inserted[0].seen === 2, inserted);
  t('what is stored is sender + template + counts, never a subject verbatim, never a body',
    inserted.every((r) => !('body' in r) && !('subject' in r) && typeof r.subject_template === 'string'), inserted);
  t('one budget unit spent for the batch', budget.left === 2, budget.left);
  t('tallies name the stages', tallies.indexOf('discovery_listed') >= 0 && tallies.indexOf('discovery_meta') >= 0 && tallies.indexOf('discovery_asked') >= 0, tallies);

  console.log('\n-- budget-last: nothing is asked when the run has no model left --');
  const inserted2 = []; const tallies2 = [];
  const db2 = { ...db, candidateInsert: async (r) => { inserted2.push(r); }, bumpReadTally: async (s) => { tallies2.push(s); } };
  const b2 = { left: 0 };
  await D.runDiscovery({ id: 'g1' }, { db: db2, fetch: fakeFetch, llm: {}, classifyBudget: b2 }, { access: 'tok', days: 7, domains: [] });
  t('shapes are still recorded', inserted2.length === 1, inserted2);
  t('…but the model is not asked', tallies2.indexOf('discovery_asked') < 0 && b2.left === 0, tallies2);

  console.log('\n-- the cap --');
  const many = {}; for (let i = 0; i < 25; i++) many['x' + i] = { from: 'S' + i + ' <orders@s' + i + '.vn>', subject: 'invoice ' + i, internalDate: 1759700000000 };
  let metaFetches = 0;
  const bigFetch = async (url) => {
    const u = String(url);
    if (/\/messages\?/.test(u)) return { ok: true, status: 200, json: async () => ({ messages: Object.keys(many).map((id) => ({ id })) }), text: async () => '' };
    const m = u.match(/\/messages\/([^?]+)\?format=metadata/);
    if (m) { metaFetches++; const x = many[m[1]]; return { ok: true, status: 200, json: async () => ({ id: m[1], internalDate: String(x.internalDate), labelIds: [], payload: { headers: [{ name: 'From', value: x.from }, { name: 'Subject', value: x.subject }] } }), text: async () => '' }; }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const out3 = await D.runDiscovery({ id: 'g1' }, { db, fetch: bigFetch, llm: {}, classifyBudget: { left: 1 } }, { access: 'tok', days: 7, domains: [] });
  t('at most DISCOVERY_MAX metadata fetches per run', metaFetches === D.DISCOVERY_MAX && out3.meta === D.DISCOVERY_MAX, { metaFetches, max: D.DISCOVERY_MAX });

  t('gmail.getMessage is untouched by discovery (module still exports it, unused here)', typeof gmail.getMessage === 'function');

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
