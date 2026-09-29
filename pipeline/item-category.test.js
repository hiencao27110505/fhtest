/**
 * Receipt enrichment Phase 2 — the item-category signature ladder
 * (receipt-enrichment-spec.md §20; item-category.mjs).
 *
 * Pinned here: the signature each source is learned under; the ladder's
 * order (keywords beat the table, the table beats the model); that a
 * keyword hit TEACHES the table; that a cached null is an answer and a stale
 * logic version is not; one batched call for everything unseen, nothing
 * cached when the model cannot be asked; the two proof-gate refusals; and
 * that the budget is the merchant classification's own.
 */
let failed = 0;
function t(name, ok, extra) {
  if (ok) console.log('  PASS  ' + name);
  else { failed++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

function fakeDb() {
  const rows = new Map();
  const puts = [];
  return {
    rows, puts,
    async itemSignaturesGet(keys) { const m = new Map(); for (const k of keys) if (rows.has(k)) m.set(k, rows.get(k)); return m; },
    async itemSignaturePut(key, node, source, logic_version) { puts.push({ key, node, source, logic_version }); rows.set(key, { key, node, source, logic_version }); },
  };
}
/* A Gemini stand-in answering by signature phrase. Records what it was sent. */
function fakeModel(answerBy) {
  const calls = [];
  const fetchImpl = async (u, init) => {
    if (!String(u).includes('generativelanguage.googleapis.com')) throw new Error('unexpected fetch ' + u);
    const body = JSON.parse(init.body);
    const list = body.contents[0].parts[0].text;
    calls.push(list);
    const items = list.split('\n').map((line, i) => {
      const phrase = line.replace(/^\d+\.\s*\[[^\]]*\]\s*/, '').trim();
      return { i: i + 1, node: answerBy(phrase) };
    });
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] } }] });
    return { ok: true, status: 200, text: async () => payload, json: async () => JSON.parse(payload) };
  };
  return { calls, fetchImpl };
}
const down = async () => ({ ok: false, status: 429, text: async () => 'rate limited', json: async () => ({}) });

(async () => {
  const M = await import('../supabase/functions/_shared/mailbox/item-category.mjs');
  const V = M.CATEGORY_LOGIC_VERSION;
  const cfg = { apiKey: 'k' };

  console.log('-- the signature an item is learned under --');
  t('an Apple item keeps the slot the reader gave it', M.itemSignatureFor({ name: 'The Long Walk', sig: 'apple|apple tv|movie rental' }, 'Apple') === 'apple|apple tv|movie rental');
  t('a marketplace item takes its head noun', M.itemSignatureFor({ name: 'Mũ Bơi / Nón Bơi Silicon Người Lớn' }, 'Shopee') === 'hn|mu boi');
  t('promo junk and quantities are skipped', M.itemSignatureFor({ name: '[Mã GIAM50] Nồi chiên không dầu Lock&Lock 5L' }, 'Tiki') === 'hn|noi chien');
  t('a provider whose items are not goods gets no head-noun signature', M.itemSignatureFor({ name: 'Car 6 chỗ' }, 'Grab') === null);
  t('nothing usable → null, never a guess', M.itemSignatureFor({ name: '12345' }, 'Shopee') === null);

  console.log('\n-- tier 1: the tree keywords, and they teach the table --');
  let db = fakeDb(), m = fakeModel(() => 'sportsgear');
  let rc = { items: [{ name: 'Mũ bơi Silicon Olane' }] };
  let st = await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('a keyword hit resolves the item', rc.items[0].node === 'sportsgear', rc.items[0].node);
  t('…with no model call', m.calls.length === 0);
  t('…and the signature is sealed on the item', rc.items[0].sig === 'hn|mu boi', rc.items[0].sig);
  t('…and it TEACHES the table (source keyword)', db.puts.length === 1 && db.puts[0].node === 'sportsgear' && db.puts[0].source === 'keyword', db.puts);

  console.log('\n-- tier 2: the learned table --');
  db = fakeDb(); m = fakeModel(() => 'appliance');
  db.rows.set('hn|vrelk zzyx', { key: 'hn|vrelk zzyx', node: 'appliance', logic_version: V });
  rc = { items: [{ name: 'Vrelk zzyx không dầu 5L' }] };
  st = await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('a current row answers without the model', rc.items[0].node === 'appliance' && m.calls.length === 0, [rc.items[0].node, m.calls.length]);
  db = fakeDb(); m = fakeModel(() => 'appliance');
  db.rows.set('hn|vrelk zzyx', { key: 'hn|vrelk zzyx', node: null, logic_version: V });
  rc = { items: [{ name: 'Vrelk zzyx không dầu 5L' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('a cached NULL is an answer: not asked again, item stays uncategorised', rc.items[0].node == null && m.calls.length === 0);
  db = fakeDb(); m = fakeModel(() => 'appliance');
  db.rows.set('hn|vrelk zzyx', { key: 'hn|vrelk zzyx', node: 'hobby', logic_version: V - 1 });
  rc = { items: [{ name: 'Vrelk zzyx không dầu 5L' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('an older logic version is a miss: re-asked and overwritten',
    m.calls.length === 1 && rc.items[0].node === 'appliance' && db.rows.get('hn|vrelk zzyx').logic_version === V, [m.calls.length, rc.items[0].node]);

  console.log('\n-- tier 3: the model, once, for everything unseen --');
  db = fakeDb(); m = fakeModel((p) => /vrelk zzyx/.test(p) ? 'appliance' : /plorf gna/.test(p) ? 'appliance' : /vendor youtube/.test(p) ? 'streaming' : null);
  rc = { items: [
    { name: 'Vrelk zzyx không dầu' }, { name: 'Vrelk zzyx Philips 4L' },   // same signature, twice
    { name: 'Plorf gna 500ml' },
    { name: 'YouTube Premium (Monthly)', sig: 'apple|vendor|youtube' },
    { name: 'Xyzzy quux' },                                              // unknowable
  ] };
  const budget = { left: 3 };
  st = await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: budget });
  t('ONE batched call for every unseen signature', m.calls.length === 1, m.calls.length);
  t('the call carries SIGNATURES and the provider, never a full title',
    /vrelk zzyx/.test(m.calls[0]) && /\[Shopee/.test(m.calls[0]) && !/Philips/.test(m.calls[0]) && !/500ml/.test(m.calls[0]), m.calls[0]);
  t('one signature, two items: both resolved from one answer', rc.items[0].node === 'appliance' && rc.items[1].node === 'appliance');
  t('an Apple slot rides the same call', rc.items[3].node === 'streaming');
  t('an unknowable is cached as NULL so it is never asked again', db.rows.get('hn|xyzzy quux') && db.rows.get('hn|xyzzy quux').node === null, db.rows.get('hn|xyzzy quux'));
  t('the budget is the merchant classification\'s own: one unit for the batch', budget.left === 2, budget.left);
  t('rows carry the logic version and source llm', db.puts.every((p) => p.logic_version === V) && db.puts.some((p) => p.source === 'llm'));

  db = fakeDb();
  rc = { items: [{ name: 'Vrelk zzyx không dầu' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: down, classifyBudget: { left: 5 } });
  t('model unreachable: nothing applied, NOTHING cached (retry-eligible)', rc.items[0].node == null && db.puts.length === 0);
  db = fakeDb(); m = fakeModel(() => 'appliance');
  rc = { items: [{ name: 'Vrelk zzyx không dầu' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 0 } });
  t('no budget: no call, nothing cached', m.calls.length === 0 && db.puts.length === 0);

  console.log('\n-- what keeps a learned answer honest --');
  db = fakeDb(); m = fakeModel(() => 'streaming');                        // a wrong root, were it ever asked
  rc = { items: [
    { name: 'Mũ bơi Speedo' },                                            // keywords: sportsgear
    { name: 'Qwrty', sig: 'hn|mu boi' },                                  // a twin the keywords cannot read
  ] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('a sibling the keywords read NAMES its twin directly — the model is never asked',
    rc.items[1].node === 'sportsgear' && m.calls.length === 0, [rc.items[1].node, m.calls.length]);
  t('…and the table learned it from the keywords, not the model',
    (db.rows.get('hn|mu boi') || {}).source === 'keyword', db.rows.get('hn|mu boi'));
  db = fakeDb(); m = fakeModel(() => 'sports');                           // "Sân bãi thể thao" — a place
  rc = { items: [{ name: 'Vrelk zzyx' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('a goods signature may never resolve to a venue: refused, not cached', rc.items[0].node == null && db.puts.length === 0, { node: rc.items[0].node, puts: db.puts });
  db = fakeDb(); m = fakeModel(() => 'gym');
  rc = { items: [{ name: 'Vrelk zzyx' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('…nor to a class or membership', rc.items[0].node == null && db.puts.length === 0);
  db = fakeDb(); m = fakeModel(() => 'streaming');
  rc = { items: [{ name: 'Some Show', sig: 'apple|apple tv|movie rental' }] };
  await M.categoriseItems(rc, { provider: 'Apple' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('the venue rule is for GOODS only: an Apple slot may resolve anywhere on the menu', rc.items[0].node === 'streaming');

  console.log('\n-- what it never does --');
  rc = { items: null };
  st = await M.categoriseItems(rc, { provider: 'Grab', serviceType: 'ride' }, { db: fakeDb(), llm: cfg, fetch: down, classifyBudget: { left: 5 } });
  t('a receipt with no items (Grab) is a no-op', st.resolved === 0 && st.asked === 0);
  db = fakeDb(); m = fakeModel(() => 'wage');                            // an INCOME code
  rc = { items: [{ name: 'Vrelk zzyx' }] };
  await M.categoriseItems(rc, { provider: 'Shopee' }, { db, llm: cfg, fetch: m.fetchImpl, classifyBudget: { left: 5 } });
  t('a code outside the expense menu is not a valid answer', rc.items[0].node == null);

  if (failed) { console.log('\n' + failed + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
