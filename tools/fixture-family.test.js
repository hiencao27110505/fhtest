/* Keeps tools/ui-harness/fixture-family.js in sync with the hydrate contract in
   src/js-data/30-hydrate.js WITHOUT touching Supabase:
     1. fixture keys == the `snap.<key>` set the client destructures
     2. every column in each legacy fallback .select('...') exists on the
        fixture rows for that table (the RPC and the fallback return the same
        columns by design, so the selects are the column contract)
   Discovered by tools/run-tests.js (npm test). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeFixture, makePersonal, SNAPSHOT_KEYS } = require('./ui-harness/fixture-family');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '30-hydrate.js'), 'utf8');
const fx = makeFixture(new Date('2026-09-12T10:00:00'));

// 1. key set parity with the destructure block
const destructured = new Set();
for (const m of src.matchAll(/snap\.([a-z_]+)/g)) destructured.add(m[1]);
assert.deepStrictEqual([...destructured].sort(), [...SNAPSHOT_KEYS].sort(), 'SNAPSHOT_KEYS drifted from the snap.<key> reads in 30-hydrate.js');
assert.deepStrictEqual(Object.keys(fx).sort(), [...SNAPSHOT_KEYS].sort(), 'fixture keys drifted from SNAPSHOT_KEYS');

// 2. fallback select columns exist on fixture rows (tables that map 1:1 to a snapshot key)
const TABLE_KEY = {
  families: 'family', members: 'members', categories: 'categories', category_budgets: 'category_budgets',
  monthly_budgets: 'monthly_budgets', transactions: 'transactions', events: 'events', event_fundings: 'event_fundings',
  savings_entries: 'savings_entries', event_memories: 'event_memories', transaction_photos: 'transaction_photos',
  incomes: 'incomes', saving_goals: 'saving_goals', reactions: 'reactions', request_reviews: 'request_reviews'
};
let checked = 0;
for (const m of src.matchAll(/sb\.from\('([a-z_]+)'\)\.select\('([a-z_,]+)'\)/g)) {
  const key = TABLE_KEY[m[1]]; if (!key) continue;
  const cols = m[2].split(',');
  const rows = Array.isArray(fx[key]) ? fx[key] : [fx[key]];
  if (!rows.length) continue;                           // empty collections (photos, reviews) carry no rows to check
  for (const r of rows) for (const c of cols) assert.ok(c in r, `fixture.${key} row is missing column "${c}" (from the ${m[1]} fallback select)`);
  checked++;
}
assert.ok(checked >= 10, `expected to check >=10 tables, checked ${checked}`);

// 3. sanity: the shape renders something on every main surface
assert.strictEqual(fx.enc, null, 'fixture must stay non-encrypted (plaintext hydrate path)');
assert.ok(fx.transactions.length >= 30, 'fixture should carry ~30 transactions');
assert.ok(fx.members.some((m) => m.is_shared) && fx.members.filter((m) => !m.is_shared).length === 2);
assert.ok(fx.transactions.every((t) => fx.categories.some((c) => c.id === t.category_id)), 'every txn resolves a category');
assert.ok(fx.transactions.every((t) => fx.members.some((m) => m.id === t.member_id)), 'every txn resolves a member');
assert.ok(fx.category_budgets.every((b) => b.month === fx.monthly_budgets[1].month), 'category budgets are for the current month');

// 4. personal snapshot shape (mirrors the warm-boot snapshot the app seals)
const p = makePersonal(new Date('2026-09-12T10:00:00'));
for (const k of ['v', 'uid', 'txns', 'accounts', 'debts', 'memory', 'budget', 'catBudget']) assert.ok(k in p, `personal snapshot missing ${k}`);
for (const t of p.txns) for (const k of ['id', 'date', 'kind', 'amt', 'note', 'cat', 'emoji', '_unreadable']) assert.ok(k in t, `personal txn missing ${k}`);

console.log(`fixture-family: ok (${checked} table contracts, ${fx.transactions.length} txns, ${p.txns.length} personal txns)`);
process.exit(0);
