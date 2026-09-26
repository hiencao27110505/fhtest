/* Fixture family for the UI harness: a small, realistic, NON-encrypted family
   in the exact shape get_family_snapshot() returns (the 17 keys destructured
   in src/js-data/30-hydrate.js). Column names follow the legacy fallback
   selects in the same file — that is the contract, and
   tools/fixture-family.test.js asserts it stays in sync.

   Money is in base units (VND: units of 1,000đ, curMult()===1000), so 150
   renders as 150.000đ. Dates float with the real clock because the app reads
   the device clock; pass `now` for a deterministic run in tests.

   No real family data anywhere in here. Names and amounts are invented. */

const UID = '00000000-0000-4000-8000-000000000001';   // the stub session user (stub-supabase.js)
const FID = '00000000-0000-4000-8000-0000000000fa';

const SNAPSHOT_KEYS = [
  'family', 'members', 'categories', 'category_budgets', 'monthly_budgets', 'transactions',
  'events', 'event_fundings', 'savings_entries', 'event_memories', 'transaction_photos',
  'incomes', 'saving_goals', 'reactions', 'request_reviews', 'enc', 'key_wraps'
];

const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const monthISO = (d) => iso(new Date(d.getFullYear(), d.getMonth(), 1));
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const uuid = (tag, n) => `00000000-0000-4000-8000-${tag}${String(n).padStart(12 - tag.length, '0')}`;

function makeFixture(now) {
  now = now || new Date();
  const thisMonth = monthISO(now);
  const lastMonth = monthISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const ts = (d) => new Date(d).toISOString();

  const members = [
    { id: uuid('a', 1), name: 'Minh', name_enc: null, color: '#5b8def', is_shared: false, user_id: UID, created_at: ts(addDays(now, -120)), key_unlocked_at: null, avatar_url: null },
    { id: uuid('a', 2), name: 'Lan', name_enc: null, color: '#e07a5f', is_shared: false, user_id: '00000000-0000-4000-8000-000000000002', created_at: ts(addDays(now, -119)), key_unlocked_at: null, avatar_url: null },
    { id: uuid('a', 3), name: 'Shared', name_enc: null, color: '#8f8a99', is_shared: true, user_id: null, created_at: ts(addDays(now, -120)), key_unlocked_at: null, avatar_url: null }
  ];
  const [MINH, LAN, SHARED] = members.map((m) => m.id);

  const catDefs = [
    ['Ăn uống', '🍜', '#f4a261'], ['Đi lại', '🛵', '#5b8def'], ['Nhà cửa', '🏠', '#2a9d8f'],
    ['Con cái', '🧸', '#e76f51'], ['Sức khoẻ', '💊', '#9b5de5'], ['Khác', '🧾', '#8f8a99']
  ];
  const categories = catDefs.map((c, i) => ({ id: uuid('c', i + 1), name: c[0], name_enc: null, emoji: c[1], color: c[2], sort_order: i, archived_at: null, claims: null, claims_enc: null }));   // 0144: the category's tree claims; null = derive a default in memory
  const CAT = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  const monthly_budgets = [
    { month: lastMonth, budget_total: 24000, budget_total_enc: null, closed: true },
    { month: thisMonth, budget_total: 25000, budget_total_enc: null, closed: false }
  ];
  const category_budgets = [
    ['Ăn uống', 9000], ['Đi lại', 3000], ['Nhà cửa', 6000], ['Con cái', 4000], ['Sức khoẻ', 1500]
  ].map((b) => ({ category_id: CAT[b[0]], amount: b[1], amount_enc: null, month: thisMonth }));

  // ~30 transactions over the last 45 days: [daysAgo, cat, member, amount, note, time]
  const txDefs = [
    [0, 'Ăn uống', MINH, 85, 'Bún bò sáng', '07:30'],
    [0, 'Đi lại', LAN, 30, 'Xăng xe', null],
    [1, 'Ăn uống', LAN, 420, 'Đi chợ cuối tuần', '09:10'],
    [1, 'Con cái', MINH, 250, 'Sữa cho bé', null],
    [2, 'Nhà cửa', SHARED, 1800, 'Tiền điện tháng này', null],
    [3, 'Ăn uống', MINH, 160, 'Cà phê với đồng nghiệp', '15:00'],
    [4, 'Sức khoẻ', LAN, 320, 'Khám răng', '10:00'],
    [5, 'Ăn uống', LAN, 210, 'Cơm trưa văn phòng', null],
    [6, 'Đi lại', MINH, 45, 'Grab về nhà', '22:15'],
    [7, 'Khác', SHARED, 500, 'Quà sinh nhật bà', null],
    [8, 'Ăn uống', MINH, 640, 'Ăn tối cả nhà', '19:30'],
    [9, 'Con cái', LAN, 1200, 'Học phí tháng', null],
    [10, 'Nhà cửa', SHARED, 350, 'Nước sinh hoạt', null],
    [12, 'Ăn uống', LAN, 95, 'Bánh mì', '07:00'],
    [13, 'Đi lại', LAN, 60, 'Gửi xe', null],
    [14, 'Ăn uống', MINH, 380, 'Đi chợ', '08:30'],
    [16, 'Sức khoẻ', MINH, 140, 'Thuốc cảm', null],
    [18, 'Ăn uống', SHARED, 720, 'Tiệc bạn bè', '18:00'],
    [20, 'Con cái', MINH, 90, 'Sách tô màu', null],
    [22, 'Ăn uống', LAN, 130, 'Trà sữa', '16:20'],
    [25, 'Nhà cửa', SHARED, 2200, 'Sửa máy lạnh', null],
    [27, 'Đi lại', MINH, 30, 'Xăng xe', null],
    [29, 'Ăn uống', LAN, 450, 'Đi chợ', '09:00'],
    [31, 'Khác', LAN, 260, 'Áo mới', null],
    [33, 'Ăn uống', MINH, 110, 'Phở tối', '20:00'],
    [35, 'Sức khoẻ', LAN, 800, 'Khám tổng quát', '09:30'],
    [38, 'Con cái', SHARED, 300, 'Đồ chơi', null],
    [40, 'Ăn uống', MINH, 520, 'Đi chợ', null],
    [42, 'Đi lại', LAN, 900, 'Bảo dưỡng xe', null],
    [44, 'Nhà cửa', SHARED, 1750, 'Tiền điện tháng trước', null]
  ];
  const transactions = txDefs.map((t, i) => {
    const d = addDays(now, -t[0]);
    return { id: uuid('e', i + 1), category_id: CAT[t[1]], member_id: t[2], note: t[4], note_enc: null, amount: t[3], amount_enc: null,
      occurred_time: t[5], occurred_time_enc: null, txn_date: iso(d), status: 'posted', created_by: t[2] === SHARED ? MINH : t[2], created_at: ts(d) , source: null, instrument: null, node: null, node_enc: null };   // created_by = member id (UI resolves it via DB.memberById)
  });
  // one planned (future) expense so the "sắp tới" surfaces have something to show
  transactions.push({ id: uuid('e', 99), category_id: CAT['Nhà cửa'], member_id: SHARED, note: 'Tiền nhà tháng sau', note_enc: null, amount: 6000, amount_enc: null,
    occurred_time: null, occurred_time_enc: null, txn_date: iso(addDays(now, 12)), status: 'planned', created_by: LAN, created_at: ts(now) , source: null, instrument: null, node: null, node_enc: null });

  const events = [
    { id: uuid('b', 1), name: 'Về quê Tết', name_enc: null, emoji: '🧧', cover: 'blue', target_amount: 15000, target_amount_enc: null,
      target_date: iso(nextMonth), achieved: false, sort_order: 0, source_txn_id: null, created_by: MINH }
  ];
  const event_fundings = [
    { id: uuid('f', 1), event_id: events[0].id, goal_id: null, amount: 3000, amount_enc: null, source: 'budget', month: lastMonth, member_id: MINH },
    { id: uuid('f', 2), event_id: events[0].id, goal_id: null, amount: 2500, amount_enc: null, source: 'savings', month: thisMonth, member_id: LAN }
  ];
  const saving_goals = [
    { id: uuid('d', 1), name: 'Quỹ dự phòng', name_enc: null, emoji: '🛟', target_amount: 50000, target_amount_enc: null, target_date: null,
      note: '3 tháng chi tiêu', note_enc: null, occasion_id: null, achieved: false, sort_order: 0, created_by: MINH }
  ];
  event_fundings.push({ id: uuid('f', 3), event_id: null, goal_id: saving_goals[0].id, amount: 12000, amount_enc: null, source: 'savings', month: lastMonth, member_id: MINH });

  const savings_entries = [
    { kind: 'deposit', amount: 10000, amount_enc: null, entry_date: iso(addDays(now, -40)) },
    { kind: 'deposit', amount: 8000, amount_enc: null, entry_date: iso(addDays(now, -10)) },
    { kind: 'withdrawal', amount: 1500, amount_enc: null, entry_date: iso(addDays(now, -4)) }
  ];
  const incomes = [
    { amount: 32000, amount_enc: null, income_date: iso(addDays(now, -35)) },
    { amount: 32000, amount_enc: null, income_date: iso(new Date(now.getFullYear(), now.getMonth(), 5)) }
  ];
  const event_memories = [
    { id: uuid('9', 1), event_id: events[0].id, emoji: '🚂', caption: 'Đặt vé tàu xong', caption_enc: null, photo_url: null, sort_order: 0 }
  ];
  const reactions = [
    { id: uuid('8', 1), transaction_id: transactions[7].id, member_id: MINH, emoji: '❤️', created_at: ts(addDays(now, -5)) },
    { id: uuid('8', 2), transaction_id: transactions[2].id, member_id: LAN, emoji: '👏', created_at: ts(addDays(now, -1)) }
  ];

  return {
    // save_goal_pct is read by a separate families select in hydrate; the stub serves this same row
    family: { name: 'Nhà Minh', currency: 'VND', default_language: 'vi', house: {}, save_goal_pct: 20 },
    members, categories, category_budgets, monthly_budgets, transactions,
    events, event_fundings, savings_entries, event_memories,
    transaction_photos: [], incomes, saving_goals, reactions, request_reviews: [],
    enc: null, key_wraps: []
  };
}

/* Personal (Cá nhân) ledger in the decrypted in-memory shape the app keeps in
   fhPersonalData() and seals into its warm-boot snapshot (see the `warm`
   scenario in tools/boot-harness/harness.js). The runner encrypts this under a
   throwaway DEK and seeds it into IndexedDB, so the real render path runs. */
function makePersonal(now) {
  now = now || new Date();
  const ts = (d) => new Date(d).toISOString();
  const defs = [
    [0, 'expense', 65, 'Cà phê', 'Ăn uống', '☕', '08:00'],
    [1, 'expense', 180, 'Sách', 'Học tập', '📚', null],
    [2, 'expense', 240, 'Gym tháng này', 'Sức khoẻ', '🏋️', null],
    [3, 'expense', 95, 'Bún chả', 'Ăn uống', '🍜', '12:10'],
    [4, 'expense', 1500, 'Tiền góp nhà', 'Gia đình', '🏠', null],
    [5, 'income', 32000, 'Lương', 'Thu nhập', '💼', null],
    [6, 'expense', 120, 'Grab', 'Đi lại', '🛵', '18:40'],
    [8, 'expense', 350, 'Quà bạn', 'Khác', '🎁', null],
    [9, 'expense', 60, 'Trà sữa', 'Ăn uống', '🧋', '15:30'],
    [11, 'expense', 900, 'Khoá học online', 'Học tập', '💻', null],
    [13, 'expense', 200, 'Thuốc', 'Sức khoẻ', '💊', null],
    [15, 'expense', 140, 'Ăn trưa', 'Ăn uống', '🍱', '12:00'],
    [18, 'expense', 75, 'Cà phê', 'Ăn uống', '☕', '08:15'],
    [21, 'expense', 400, 'Điện thoại', 'Khác', '📱', null],
    [24, 'expense', 1500, 'Tiền góp nhà', 'Gia đình', '🏠', null],
    [27, 'expense', 110, 'Phở', 'Ăn uống', '🍜', '19:00'],
    [33, 'income', 32000, 'Lương', 'Thu nhập', '💼', null],
    [36, 'expense', 260, 'Gym', 'Sức khoẻ', '🏋️', null],
    [40, 'expense', 88, 'Bánh mì', 'Ăn uống', '🥖', '07:20'],
    [43, 'expense', 520, 'Giày chạy', 'Sức khoẻ', '👟', null]
  ];
  const txns = defs.map((t, i) => {
    const d = addDays(now, -t[0]);
    return { id: 'fix-p-' + i, date: iso(d), kind: t[1], spaceId: null, linkId: null, version: 1, updatedAt: null, ts: ts(d),
      accountId: null, transferGroupId: null, positionId: null, qty: null, amt: t[2], _unreadable: false, note: t[3], cat: t[4], emoji: t[5], time: t[6] };
  });
  return {
    v: 1, uid: UID, unreadable: 0, debtsComplete: true,
    budget: 9000, catBudget: { 'Ăn uống': 3000, 'Sức khoẻ': 1500, 'Học tập': 1500 },
    txns, accounts: [], debts: [], memory: []
  };
}

module.exports = { makeFixture, makePersonal, SNAPSHOT_KEYS, UID, FID };
