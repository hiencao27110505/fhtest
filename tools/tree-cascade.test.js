#!/usr/bin/env node
/* The category tree: the taxonomy's own invariants, the keyword matcher, the
 * partition, and the pieces of the review cascade that can be exercised without
 * a DOM. `node tools/tree-cascade.test.js`
 *
 * What this pins is mostly SAFETY, because the failure mode is silent: a
 * keyword that also spells a Vietnamese name files strangers under the vet, and
 * nobody sees it until they read their own breakdown. (docs/specs/category-tree-spec.md)
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const tax = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy/taxonomy.json'), 'utf8'));
/* L() is the app's bilingual picker; the tests read the Vietnamese side. */
const ctx = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, L: (vi) => vi };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8')
  + ';globalThis.__P={fhLabelForNode,fhDefaultClaimsFor,fhNodeGuess,fhNodeCorrections,fhNodeDepth,fhNodeFromClaims,fhNodeGroup,fhTransferShape,fhLooksSelfTransfer,fhNodeSelMatch,fhNodeSelLabel,fhNodeSelCode};', ctx);
const T = ctx.FH_TAX, P = ctx.__P;

console.log('\n-- the tree is well formed --');
{
  const codes = new Set();
  let dupes = 0, orphans = 0, tooDeep = 0, badCode = 0;
  for (const n of tax.nodes) {
    if (codes.has(n.code)) dupes++;
    codes.add(n.code);
    if (!/^[a-z][a-z0-9]*$/.test(n.code)) badCode++;
    if (n.parent && !tax.nodes.some((m) => m.code === n.parent)) orphans++;
    if (n.depth > 3) tooDeep++;
  }
  t('every code is unique across ALL kinds', dupes === 0, dupes);
  t('codes are opaque and portable (no dots, no parent encoded)', badCode === 0, badCode);
  t('every parent exists', orphans === 0, orphans);
  t('nothing is deeper than 3', tooDeep === 0, tooDeep);
  t('one tree per kind', new Set(tax.nodes.map((n) => n.kind)).size === 6, [...new Set(tax.nodes.map((n) => n.kind))]);
  /* Exhaustive by construction: a parent is its own "other", so no node may be
     called Khác/Other — a row that fits no child rests on the parent instead. */
  const khac = tax.nodes.filter((n) => n.parent && /^(kh[aá]c|other|others)$/i.test(n.vi.trim()));
  t('no "Khác" leaves: a parent IS its own other', khac.length === 0, khac.map((n) => n.code));
  /* Only a person may file to the root. If a classifier could, "<1% unfiled"
     would measure nothing. */
  const manual = tax.nodes.filter((n) => n.manual);
  t('the unfiled roots are manual-only', manual.length >= 2 && manual.every((n) => !n.parent), manual.map((n) => n.code));
}

console.log('\n-- the legacy vocabularies still resolve --');
{
  const CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'];
  const bad = tax.nodes.filter((n) => n.kind === 'expense' && !n.manual && CONCEPTS.indexOf(T.conceptOf(n.code)) < 0);
  t('every expense node maps to one of the 8 legacy concepts', bad.length === 0, bad.slice(0, 5).map((n) => n.code));
  t('conceptOf climbs to the nearest ancestor that has one', T.conceptOf('coffee') === 'Dining', T.conceptOf('coffee'));
  t('poolOf gives the notification its finer voice', T.poolOf('coffee') === 'coffee' && T.poolOf('milktea') === 'milktea');
  t('a ride pool comes off the leaf, not the group', T.poolOf('bikehail') === 'ride' && T.poolOf('transport') === null);
}

console.log('\n-- the keyword matcher finds what it should --');
{
  const hit = (s, want) => t('"' + s + '" → ' + want, T.keywordNode(s, 'expense') === want, T.keywordNode(s, 'expense'));
  hit('MPOS*WAYNESCOFFEE HO CHI MINH VN', 'coffee');     // brand glued to a gateway prefix
  hit('PAYOO-REVICOFFEEHCM03', 'coffee');
  hit('AEON NGUYEN VAN LINH', 'groceries');
  hit('tien dien thang 9', 'electric');
  hit('cafe 50k', 'coffee');                              // a typed note, not a bank memo
  t('a brand spanning two groups stays unanswered', T.keywordNode('VIB MOCA GRAB', 'expense') === null, T.keywordNode('VIB MOCA GRAB', 'expense'));
  t('a marketplace answers at GROUP level, never a leaf', T.keywordNode('Shopee VN', 'expense') === 'shopping');
  t('income keywords live in their own tree', T.keywordNode('thanh toan luong thang 03', 'income') === 'wage'
    && T.keywordNode('thanh toan luong thang 03', 'expense') === null);
}

console.log('\n-- and NOT what it should not (the expensive half) --');
{
  /* Every one of these is a real string from a real mailbox that an earlier
     version of the tree filed wrongly. A bank memo is mostly people's names,
     and Vietnamese without diacritics is full of collisions. */
  const clean = (s) => t('"' + s + '" stays unanswered', T.keywordNode(s, 'expense') === null, T.keywordNode(s, 'expense'));
  clean('616066 - NGO CUC THUY MY');                      // "thu y" (vet) inside the name THUY MY
  clean('468888 - TRUONG CAM THUY');                      // "truong" (school) is a surname
  clean('1029761712 - TANG KHANH HAO');                   // "tang" (to gift) is a surname
  clean('0721000536225 - MA PHI THONG');                  // "phi" (fee) is a given name
  clean('chuyen tien noi bo');                            // "noi" (pot) inside "nội bộ"
  clean('chua ro');                                       // "chua" (temple) vs "chưa" (not yet)
  clean('vay tieu dung');                                 // "vay" (skirt) vs "vay" (to borrow)
  clean('QOPAQUE SHOP');                                  // "shop" is in half the merchant names
  clean('Cong ty CPDV DDTT thanh toan luong thang 03');   // must not read as an expense at all
  t('"mua hang" is buying, not dancing', T.keywordNode('mua hang tiki', 'expense') === 'shopping');
}

console.log('\n-- the partition: labels claim nodes, most specific wins --');
{
  const labels = [
    { key: 'Ăn ngoài', claims: ['eatout', 'drinks'] },
    { key: 'Đi chợ', claims: ['groceries'] },
    { key: 'Cà phê', claims: ['coffee'] },
    { key: 'Others', claims: ['*'] },
  ];
  t('a leaf claim beats its group', P.fhLabelForNode('coffee', labels).key === 'Cà phê');
  t('a sibling of that leaf stays with the group', P.fhLabelForNode('milktea', labels).key === 'Ăn ngoài');
  t('a node under another claim goes there', P.fhLabelForNode('fresh', labels).key === 'Đi chợ');
  t('anything unclaimed lands in the catch-all', P.fhLabelForNode('fuel', labels).key === 'Others');
  t('an unknown code still lands in the catch-all', P.fhLabelForNode('zzz', labels).key === 'Others');
  t('no labels at all is null, never a crash', P.fhLabelForNode('coffee', []) === null);
}

console.log('\n-- default claims for the categories people already have --');
{
  const d = (name, emoji) => P.fhDefaultClaimsFor(name, emoji);
  t('a seeded name maps to its group', JSON.stringify(d('Ăn ngoài', '🍽️')) === '["eatout"]', d('Ăn ngoài', '🍽️'));
  t('Nhà ở → home', JSON.stringify(d('Nhà ở', '🏠')) === '["home"]', d('Nhà ở', '🏠'));
  t('the catch-all owns the root', JSON.stringify(d('Others', '🗂️')) === '["*"]', d('Others', '🗂️'));
  /* A label that spans several groups claims nothing rather than guessing one:
     "Con cái" is kids' food AND kids' clothes AND school fees. */
  t('a cross-cutting label claims nothing', d('Con cái', '👶').length === 0, d('Con cái', '👶'));
  t('an unknown name with a known emoji still maps', JSON.stringify(d('Mèo của tôi', '🐶')) === '["pets"]', d('Mèo của tôi', '🐶'));
}

console.log('\n-- the guess, and what a label may contribute --');
{
  t('a note alone is enough', P.fhNodeGuess({ note: 'cafe 50k' }) === 'coffee');
  /* The label is evidence only when the words are not: "200k" says nothing, so
     the label's own claim answers — at GROUP level, never a leaf. */
  t('a silent note falls back to the label claim', P.fhNodeGuess({ note: '200k', labelClaims: ['groceries'] }) === 'groceries');
  t('claims inside one group answer with that group',
    P.fhNodeGuess({ note: 'xxx', labelClaims: ['eatout', 'drinks'] }) === 'food',
    P.fhNodeGuess({ note: 'xxx', labelClaims: ['eatout', 'drinks'] }));
  t('claims across two groups contribute nothing',
    P.fhNodeGuess({ note: 'xxx', labelClaims: ['eatout', 'tuition'] }) === null,
    P.fhNodeGuess({ note: 'xxx', labelClaims: ['eatout', 'tuition'] }));
  /* The rule the SUPERSPORTS bug broke: a merchant the tree knows outranks the
     label, even when the label says something else. */
  t('evidence outranks a disagreeing label',
    P.fhNodeGuess({ note: 'QR2CK3U3TT SUPERSPORTS', labelClaims: ['food'] }) === 'hobby',
    P.fhNodeGuess({ note: 'QR2CK3U3TT SUPERSPORTS', labelClaims: ['food'] }));
  t('a repayment never guesses (it inherits its loan)', P.fhNodeGuess({ kind: 'repayment', note: 'cafe' }) === null);
  t('corrections are siblings first', P.fhNodeCorrections('coffee').slice(0, 3).every((c) => T.get(c).parent === 'drinks'));
  t('depth: leaf 3, category 2, group 1, unknown 0',
    P.fhNodeDepth('coffee') === 3 && P.fhNodeDepth('drinks') === 2 && P.fhNodeDepth('food') === 1 && P.fhNodeDepth('zzz') === 0);
}

console.log('\n-- money to a person is classified, not unknown --');
{
  /* The spec's promise: a bare transfer to a human rests on "Chuyển cho người
     khác", a real group, rather than on the root. We know the channel even when
     we never learn the purpose, and saying so beats "Chưa rõ". */
  t('a bank\'s own transfer verb lands on p2p',
    P.fhNodeGuess({ note: 'CAO THÁI DUY HIỂN chuyen tien den NGUYEN DUC THIEN' }) === 'p2p');
  t('an account-number-and-name counterparty lands on p2p',
    P.fhNodeGuess({ note: '0111000158387 - CAO THAI MINH PHUONG' }) === 'p2p');
  /* And it never steals a row real evidence already answered. */
  t('a QR payment at a named shop stays with the shop',
    P.fhNodeGuess({ note: 'CAO THAI DUY HIEN thanh toan QRCODE tai AEON' }) === 'groceries');
  t('a label still outranks it',
    P.fhNodeGuess({ note: 'chuyen tien den ai do', labelClaims: ['groceries'] }) === 'groceries');
  t('genuinely silent text stays unanswered',
    P.fhNodeGuess({ note: '22853744443228090368' }) === null);
}

console.log('\n-- no oversized enum reaches Gemini (the v52 hard 400) --');
{
  const llm = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/mailbox/llm.mjs'), 'utf8');
  const cls = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/mailbox/classify.mjs'), 'utf8');
  t('the extraction schema has no node enum', !/node:\s*\{[^}]*enum/.test(llm));
  t('the classify schemas have no node enum', !/node:\s*\{[^}]*enum/.test(cls));
  /* The small, proven enums stay: they worked for months. */
  t('concept and pool keep their enums', /concept:\s*\{[^}]*enum/.test(cls) && /pool:\s*\{[^}]*enum/.test(cls));
}

console.log('\n-- the sweep cannot feed itself (the hot-phone loop) --');
{
  const bf = fs.readFileSync(path.join(ROOT, 'src/js-data/28-tree-backfill.js'), 'utf8');
  const wr = fs.readFileSync(path.join(ROOT, 'src/js-data/40-txn-writes-outbox.js'), 'utf8');
  /* Its own write must not read as a spouse's: realtime re-hydrates on any tick
     that is not stamped as local, and the hydrate tail starts the sweep. */
  t('fhTxnSetNode stamps _lastLocalWrite', /fhTxnSetNode[\s\S]{0,700}_lastLocalWrite/.test(wr));
  t('the sweep starts once per page load', /_tbfStarted\[scope\]/.test(bf));
  t('a backgrounded tab stops it', /document\.hidden/.test(bf));
  t('and it stops for the session after a cap', /_TBF_SESSION_MAX/.test(bf));
}

console.log('\n-- a mirrored row keeps the same answer as its family copy --');
{
  const pers = fs.readFileSync(path.join(ROOT, 'src/js-data/19-personal.js'), 'utf8');
  t('the mirror reads the master\'s node', /mastersBy\[r\.link_id\][\s\S]{0,260}node:/.test(pers));
  t('and refreshes when the family node changed', /fNode \|\| ''\) !== \(m\.node \|\| ''\)/.test(pers));
}

console.log('\n-- rows real mail proved we were getting wrong --');
{
  /* Every string here came out of a live mailbox with no node under the rules
     shipped before it. */
  const n = (note) => P.fhNodeGuess({ kind: 'expense', note: note });
  t('a bank memo after the counterparty still reads as p2p',
    n('13610000120606 - LE KHA NIN | Cam on a Lam hehe') === 'p2p');
  t('...and with a reference in the memo too',
    n('109876009159 - DAO THI TUOI | LGOINV2609020BJ7R519 HIEN CAO') === 'p2p');
  t('KOI through a payment gateway is milk tea', n('PAYOO-KOI CRM HO CHI MINH VN') === 'milktea');
  /* A card repayment is not spending and must never get an expense node; the
     review keeps it out of the ledger as a transfer instead. */
  const rv = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
  t('a row naming the card it repays is a card payment', /if \(re\.card_masked\) return true;/.test(rv));
  /* The greeting two VIB templates anchor on is not a counterparty. */
  const ex = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/mailbox/extract.mjs'), 'utf8');
  t('a salutation is dropped, not just hidden', /if \(merchant === ''\) out\.counterparty = null;/.test(ex));
}

console.log('\n-- decrypted from a real ledger: what 11tr of "Chưa rõ" was --');
{
  /* Every string below was read out of a live personal ledger with the owner's
     key, after they asked why so much was unclassified. Two thirds of it was
     never spending at all. */
  const n = (note) => P.fhNodeGuess({ kind: 'expense', note: note });
  t('a QR reference before a person still reads as p2p', n('VQRQ0001oqplk - VO DINH PHUC') === 'p2p');
  t('so does a payment reference before a name', n('LGOINV2609020BJ7R519 HIEN CAO') === 'p2p');
  t('MoMo\'s "send a card" is a gift', n('Gửi thiệp đến Cung Đức Tùng') === 'gifts');
  /* ...and none of that may steal a merchant the tree actually knows. */
  t('a merchant with a person-like name is still the merchant', n('AEON NGUYEN VAN LINH') === 'groceries');
  /* Money you move between your own two accounts is not spending, whatever
     else the row looked like. The check used to run only on rows already
     flagged as card payments, so a plain self-transfer of 7.000.000đ imported
     as an expense. */
  const rv = fs.readFileSync(path.join(ROOT, 'src/js-ui/57-csv-import-review.js'), 'utf8');
  t('the self-transfer check is not nested under isTransfer',
    !/if \(isTransfer\) \{[\s\S]{0,400}_isSelfTransfer/.test(rv) && /_isSelfTransfer\(_selfMemo \|\| desc\) \|\| _isSelfTransfer\(party\)/.test(rv));
}

console.log('\n-- money that moved is not money that was spent --');
{
  /* The 11tr of "Chưa rõ" in a real ledger was 8.2tr of this: transfers and card
     repayments that the bank reported as spending. They are not unknown — they
     are known and misfiled, and the tree already has their nodes. */
  t('my own name on both sides is a transfer between my accounts',
    P.fhTransferShape('CAO THÁI DUY HIỂN chuyen tien den CAO THAI DUY HIEN - 1046382279') === 'bankbank');
  t('a different name on the other side is NOT',
    P.fhTransferShape('CAO THAI DUY HIEN chuyen tien den VO DINH PHUC') === null);
  t("the bank's own payment mail is a card repayment",
    P.fhTransferShape('Ngân hàng TMCP Quốc tế Việt Nam') === 'cardpay');
  t('so is the wording on a statement payment',
    P.fhTransferShape('THANH TOAN THE TIN DUNG VIB') === 'cardpay');
  t('a wallet top-up is a transfer, not a purchase',
    P.fhTransferShape('Nap tien vao vi dien tu MOMO') === 'wallet');
  t('an ordinary merchant is left alone',
    P.fhTransferShape('AEON NGUYEN VAN LINH') === null && P.fhTransferShape('SUPERSPORTS VN') === null);
  /* The order matters: fhNodeGuess reads "chuyen tien" as money sent to another
     person, so the shape has to be asked FIRST or a self-transfer becomes p2p. */
  const bf = fs.readFileSync(path.join(ROOT, 'src/js-data/28-tree-backfill.js'), 'utf8');
  t('the sweep asks the transfer shape before the guess',
    bf.indexOf('fhTransferShape') < bf.indexOf('guess = fhNodeGuess'));
  /* And the rules changing is worthless if the sweep still thinks it is done. */
  t('the sweep cursor moved with the rules', /fh-tree-bf:v6:/.test(bf) && !/fh-tree-bf:v[1-5]:/.test(bf));
}

console.log('\n-- one selection, read by every surface --');
{
  const W = ctx.window;
  W.fhNodeSel = null;
  t('no selection matches everything', P.fhNodeSelMatch('groceries') && P.fhNodeSelMatch(null));
  W.fhNodeSel = 'food';
  t('a group matches its descendants', P.fhNodeSelMatch('groceries'));
  t('a group does not match a sibling group', !P.fhNodeSelMatch('transport'));
  t('a group does not match rows with no node at all', !P.fhNodeSelMatch(null));
  W.fhNodeSel = '_none';
  t('"Chưa rõ" matches exactly the rows with no usable node',
    P.fhNodeSelMatch(null) && P.fhNodeSelMatch('nonsense-code') && !P.fhNodeSelMatch('groceries'));
  W.fhNodeSel = null;
  /* The old TXV.noNode narrowed the list with nothing on screen saying so, and
     openTxns never cleared it. */
  const tx = fs.readFileSync(path.join(ROOT, 'src/js-ui/60-transactions.js'), 'utf8');
  t('the sticky invisible noNode filter is gone', !/TXV\.noNode/.test(tx));
  t('the selection is a counted, visible filter', /if\(TXV\.node\) n\+\+;/.test(tx));
  t('there is a "Tiêu vào gì" chip', /txnSheetNode\(\)/.test(tx) && /sheet-txnnode/.test(tx));
  t('the chip sheet has markup to open',
    /id="sheet-txnnode"/.test(fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8')));
  /* Transfer nodes have to be rendered somewhere, or 8.2tr leaves the breakdown
     while staying in the total and every percentage is quietly wrong. */
  const ui = fs.readFileSync(path.join(ROOT, 'src/js-ui/63-tree-ui.js'), 'utf8');
  t('not-spending gets its own section, out of the spending total',
    /kindOf\(r\.node\) !== 'expense'/.test(ui) && /tb-sect/.test(ui));
}

console.log('\n-- the four ways v552 filtered nothing and swept nothing --');
{
  const tx = fs.readFileSync(path.join(ROOT, 'src/js-ui/60-transactions.js'), 'utf8');
  const bf = fs.readFileSync(path.join(ROOT, 'src/js-data/28-tree-backfill.js'), 'utf8');
  const pe = fs.readFileSync(path.join(ROOT, 'src/js-ui/21-personal.js'), 'utf8');

  /* 1. The row shape the Giao dịch screen is built from never carried `node`.
     Every node filter therefore matched nothing (empty list) and the chip sheet
     saw a ledger with no nodes in it (no options to offer). */
  const pushes = tx.match(/rows\.push\(\{[\s\S]*?\}\);/g) || [];
  t('every personal row shape carries node', pushes.length >= 2 && pushes.every((b) => /\bnode:\s*t\.node/.test(b)), pushes.length);
  t('the filter and the row shape agree on the field name',
    /fhNodeSelMatch\(t\.node\)/.test(tx));

  /* 2. The sweep returned 0 both for "this batch needed no writes" and for
     "the ledger is finished", and the caller marked the scope done forever.
     Twelve unresolvable rows near the top were enough to end it permanently. */
  t('the sweep separates "nothing here" from "nothing left"',
    /\{ n: 0, more: true \}/.test(bf) && /\{ n: 0, more: false \}/.test(bf));
  t('only an exhausted walk marks the scope done',
    /if \(r\.n === 0\) _tbfMarkDone/.test(bf) && !/return 0;/.test(bf));
  t('the session cap stops without marking done',
    /_TBF_SESSION_MAX\) return \{ n: -1/.test(bf));
  /* Simulate the runner against the slice contract: a ledger whose first two
     batches resolve to nothing must still be walked to the end. */
  {
    const batches = [{ n: 0, more: true }, { n: 0, more: true }, { n: 5, more: true }, { n: 0, more: false }];
    let i = 0, done = false;
    const step = () => { const r = batches[i++]; if (r.more) return step(); if (r.n === 0) done = true; };
    step();
    t('a ledger with two dead batches is still walked to the end', done && i === batches.length, i);
  }

  /* 3. The personal sweep wrote nodes onto MIRROR rows, which fhPersonalMirror
     owns. Each write made the mirror disagree with its family row, rewrite it,
     bump the version and finish with a full fhPersonalHydrate: a whole ledger
     re-decrypted per round. That is the hot device and the stuck banner. */
  t('the personal sweep leaves mirror rows to the mirror',
    /if \(t\.spaceId \|\| t\.linkId\) \{ t\._tbfSkip = 1; continue; \}/.test(bf));

  /* 4. Caching the AGGREGATE under one selection meant every tap invalidated it
     and persSeries called persEnsureSlice() — a network fetch per tap. */
  t('the chart caches raw rows, not a filtered aggregate',
    /_persOldRows/.test(pe) && !/_persOldMap|_persOldSel/.test(pe));
  t('a tap never rebuilds the whole personal tab behind the overlay',
    /_overlayUp/.test(tx));
}

console.log('\n-- "chưa rõ chi tiết" is a work queue, not a category --');
{
  const W = ctx.window;
  /* A group-level answer is honest but it used to be a dead end: an inert grey
     row inside every category that named money nobody could act on. Half of
     "Mua sắm" was sitting in one. */
  W.fhNodeSel = '=food';
  t('an exact selection is the node and NOT its children',
    P.fhNodeSelMatch('food') && !P.fhNodeSelMatch('groceries') && !P.fhNodeSelMatch(null));
  t('a plain selection still includes the children',
    (W.fhNodeSel = 'food', P.fhNodeSelMatch('groceries') && P.fhNodeSelMatch('food')));
  W.fhNodeSel = '=food';
  t('the exact selection names itself apart from the group', /chưa rõ chi tiết/.test(P.fhNodeSelLabel()));
  t('fhNodeSelCode unwraps either form',
    P.fhNodeSelCode() === 'food' && (W.fhNodeSel = 'food', P.fhNodeSelCode() === 'food'));
  W.fhNodeSel = '_none';
  t('"Chưa rõ" is still its own thing', P.fhNodeSelCode() === null && P.fhNodeSelMatch(null));
  W.fhNodeSel = null;

  const ui = fs.readFileSync(path.join(ROOT, 'src/js-ui/63-tree-ui.js'), 'utf8');
  const tx = fs.readFileSync(path.join(ROOT, 'src/js-ui/60-transactions.js'), 'utf8');
  t('the rest row opens the rows it is made of', /go: 'fhTreeTapExact/.test(ui));
  t('it says how many rows that is', /cnt\[code\]/.test(ui) && /cnt\[r\.node\]/.test(ui));
  t('it no longer shares a name with the top-level "Chưa rõ"',
    !/'chưa rõ món'/.test(ui) && /Chưa rõ chi tiết/.test(ui));
  /* The queue has to be emptiable, or naming it just moves the complaint. */
  t('bulk select can assign a node', /txnBulkNodePick/.test(tx) && /txnBulkSheet\(&#39;node&#39;\)/.test(tx));
  t('the bulk picker is scoped to the group the queue came from', /_bulkNodeScope/.test(tx) && /fhNodeSelCode/.test(tx));
  t('assigning in bulk teaches, so the queue does not refill',
    /fhLessonLearnNode\(\{ note:raw\.note/.test(tx));
  t('bulk node writes go through the surgical writers, not a full row rewrite',
    /fhPersonalSetNode\(raw\.id, code\)/.test(tx) && /fhTxnSetNode\(raw\._dbId, code\)/.test(tx));
}

console.log('\n-- the generated targets stay in lockstep with the JSON --');
{
  const gen = require(path.join(ROOT, 'tools/gen-taxonomy.js'));
  const before = fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8');
  gen.generate();
  const after = fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8');
  t('regenerating changes nothing (the client is current)', before === after);
  t('the worker twin exists', fs.existsSync(path.join(ROOT, 'supabase/functions/_shared/mailbox/taxonomy.mjs')));
  t('the python twin exists', fs.existsSync(path.join(ROOT, 'earthy/serverless/functions/transaction-parser/parser/taxonomy.py')));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);