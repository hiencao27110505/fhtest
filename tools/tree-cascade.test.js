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
  + ';globalThis.__P={fhPipeNodeOk,fhStructNode,fhSellerSignal,fhLabelForNode,fhDefaultClaimsFor,fhNodeGuess,fhNodeDepth,fhNodeFromClaims,fhNodeGroup,fhTransferShape,fhLooksSelfTransfer,fhNodeSelMatch,fhNodeSelLabel,fhNodeSelCode,fhCountsAsSpending,fhXferCashOut};', ctx);
const T = ctx.FH_TAX, P = ctx.__P;
const FH_TAX_VI = (c) => T.get(c).vi;

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
  /* Grab is rides AND food, two groups with no shared parent. The KEYWORDS stay
     silent (the worker shares them, and there a hit would replace the legacy
     "Transport" concept); the client's who-was-paid tier rests it on "paid to a
     seller", which is true, and it never claims a ride or a meal. */
  t('a brand spanning two groups: the shared keywords stay silent', T.keywordNode('VIB MOCA GRAB', 'expense') === null, T.keywordNode('VIB MOCA GRAB', 'expense'));
  t('…and the guess rests it on "paid to a seller", never on either group',
    P.fhNodeGuess({ kind: 'expense', counterparty: 'VIB MOCA GRAB', note: 'Thanh toán dịch vụ - hàng hóa' }) === 'purchase'
    && P.fhNodeGuess({ kind: 'expense', note: 'GRAB' }) === 'purchase');
  t('…while the brand\'s own product names still reach their leaf',
    T.keywordNode('GRABFOOD', 'expense') === 'delivery' && T.keywordNode('GrabBike', 'expense') === 'bikehail');
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
  /* (the siblings-first correction list is gone: the picker is the tree itself,
     in the tree's own order — see "the picker is one outline" below) */
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
     review keeps it out of the ledger as a transfer instead.
     This USED to be asserted by matching the source line `if (re.card_masked)
     return true;` — which pinned a bug in place instead of catching it. Two
     extractors fill card_masked: llm.mjs is told to set it only on a repayment,
     but labeltable.mjs matches any "số thẻ" line, which every card PURCHASE
     alert prints. So the rule turned Apple, Co.op Mart and Wayne's Coffee into
     "Trả nợ thẻ". Run the real function instead. */
  const rv = fs.readFileSync(path.join(ROOT, 'src/js-data/72-txn-review.js'), 'utf8');
  {
    const from = rv.indexOf('var _CARD_PAY_RX');
    const to = rv.indexOf('};', rv.indexOf('window.fhCardPayShaped')) + 2;
    const c2 = { window: {} };
    vm.createContext(c2);
    vm.runInContext(rv.slice(from, to) + ';globalThis.CP = window.fhCardPayShaped;', c2);
    const cp = (re) => !!c2.CP(re);
    t('a card PURCHASE is spending, however loudly the mail prints the card number',
      !cp({ card_masked: '****5140', memo: 'APPLE.COM/BILL' })
      && !cp({ card_masked: '****1234', memo: 'CO.OP MART NHIEU LOC' })
      && !cp({ card_masked: '****1234', memo_display: 'WAYNESCOFFEE' }));
    /* THE EXACT SHAPE Vietcombank's card template produces, which survived the
       first fix: memo null, memo_display an EMPTY STRING, and the merchant only
       in counterparty. Reading "" as "the mail named nobody" kept these filed
       as repayments. An empty string must fall through like a null. */
    const vcbPurchase = { card_masked: '…0035', account_masked: '…2279', account_kind: null,
      memo: null, memo_display: '', counterparty: 'MPOS*WAYNESCOFFEE HO CHI MINH VN' };
    t('Vietcombank names the merchant in counterparty while memo_display is ""', !cp(vcbPurchase));
    t('…and the same for the supermarket',
      !cp({ ...vcbPurchase, counterparty: 'CO.OPMART NHIEU LOC HO CHI MINH VN' }));
    /* VIB's real repayment mail, same empty memo_display — told apart by the
       counterparty being the issuer rather than a shop. */
    const vibRepay = { card_masked: 'CAO THAI DUY HIEN - ●●●● 4751', account_masked: '…5140',
      account_kind: 'credit_card', memo: null, memo_display: '',
      counterparty: 'Ngân hàng TMCP Quốc tế Việt Nam' };
    t('the real VIB repayment mail still reads as a repayment', cp(vibRepay));
    t('a mail naming nobody at all still reads as a repayment',
      cp({ card_masked: '****5140', memo: null }));
    t('explicit repayment wording needs no card number at all',
      cp({ memo: 'THANH TOAN THE TIN DUNG VIB' }) && cp({ memo: 'Tra no the 5140' }));
    t('an ordinary merchant with no card is left alone', !cp({ memo: 'HIGHLANDS COFFEE' }));
  }
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
  /* Was p2p until the tree could say "paid to a seller": VQRQ… is a collection
     account a QR service issued, which a friend's account never is. */
  t('a merchant-QR account before a person\'s name is a purchase, not p2p', n('VQRQ0001oqplk - VO DINH PHUC') === 'purchase', n('VQRQ0001oqplk - VO DINH PHUC'));
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
  t('the sweep cursor moved with the rules', /fh-tree-bf:v7:/.test(bf) && !/fh-tree-bf:v[1-6]:/.test(bf));
}

console.log('\n-- who was paid: a seller leaves marks a friend does not --');
{
  /* Real strings from two mailboxes (VIB writes "ACCOUNT - NAME", MB writes
     "NAME - ACCOUNT"), names shortened. research/category-patterns.html */
  const g = (note, counterparty) => P.fhNodeGuess({ kind: 'expense', note: note, counterparty: counterparty });
  const VIB = 'CAO THÁI DUY HIỂN chuyen tien den ';
  t('a Techcombank shop alias with a person\'s name', g(VIB + 'NGUYEN THI N M - PHATLOC169208', 'PHATLOC169208 - NGUYEN THI N M') === 'purchase');
  t('a till-printed order code to an all-digit personal account', g('66527 N9GDR', '3666689689 - HOANG P A') === 'purchase');
  t('"TT HD" and an invoice number', g('TT HD BH00120', '0721000536225 - MA PHI THONG') === 'purchase');
  t('a legal entity with no telling name is a company', g(VIB + 'CONG TY TNHH HYEIN - 1301965011', '1301965011 - CONG TY TNHH HYEIN') === 'bizpay');
  t('MB\'s order (name first) reads the same', g('NGUYEN THU TRANG chuyen tien', 'HO KINH DOANH BALI CAMA - MS00P0XXXXXXXXX') === 'bizpay');
  t('a masked virtual account still counts', g('NGUYEN THU TRANG chuyen tien', 'DO T H - PMC26018XXXXXXXXXXX') === 'purchase');
  t('the bank\'s merchant-QR sentence', g('CAO THAI DUY HIEN thanh toan QRCODE tai DZINE', 'DZINE') === 'purchase');
  t('MoMo\'s "pay" verb, as opposed to its "send" verb', g('Thanh toán cho NGUYEN NGOC H (VietinBank)') === 'purchase');
  /* What the keywords know still wins: the mark only answers WHO. */
  t('a known dish beats the mark', g(VIB + 'CONG TY TNHH HU TIEU HONG PHAT - 38933888', '38933888 - CONG TY TNHH HU TIEU HONG PHAT') === 'restaurant');
  t('a wallet merchant with a known brand', g(VIB + 'MOMO_PASSIO - 99MM25155M65000522', '99MM25155M65000522 - MOMO_PASSIO') === 'coffee');
  /* The expensive half: friends, family, and the default memo. */
  t('the bank\'s default memo to a person stays p2p', g(VIB + 'LE CAO HUNG - 102811489', '102811489 - LE CAO HUNG') === 'p2p');
  t('a thank-you to a person stays p2p', g('Cam on anh Lamm', '13610000120606 - LE KHA NIN') === 'p2p');
  t('an unknown alphanumeric account is not a mark', g(VIB + 'NGUYEN HOANG NGOC - 9ZI4801', '9ZI4801 - NGUYEN HOANG NGOC') === 'p2p');
  t('an issuer\'s name is never a shop', P.fhSellerSignal({ counterparty: 'NGAN HANG THUONG MAI CO PHAN QUOC TE VIET NAM' }) === null);
  t('an employer paying a salary is not a purchase', P.fhNodeGuess({ kind: 'income', note: 'CONG TY CP DICH VU DI DONG TRUC TUYEN thanh toan luong thang 03' }) === 'wage');
  t('"gui tien nha" is a sentence particle, not rent', g('Em gui tien nha. Cam on anh.', '6209991888 - NGUYEN VINH QUANG') === 'p2p');
  t('real rent wording still reaches the leaf', g('dong tien nha thang 9') === 'rentpay');
  t('a fund a person NAMED is not read for keywords it happens to contain', g('Chuyển tiền vào Quỹ Growth Claude') === 'split');
  t('a catering company is not software', g('CAO THAI DUY HIEN thanh toan QRCODE tai DZINE', 'DZINE') !== 'software' && T.keywordNode('DZINE FOOD SOLUTIONS C', 'expense') === null);
  t('an FX fee line is a bank fee, not a building\'s management fee', T.keywordNode('Phí Quản Lý Giao Dịch VND Tại Nước Ngoài', 'expense') === 'fxfee');
  t('"pizza" alone stops at eating out', T.keywordNode('PAYOO PIZZA SOMEWHERE', 'expense') === 'eatout' && T.keywordNode('PAYOO PIZZA4PS 15C', 'expense') === 'restaurant');
}

console.log('\n-- a node sealed by an older copy of the keywords is checked against today\'s --');
{
  const ok = (node, note, cp, sweep) => P.fhPipeNodeOk(node, { note: note, counterparty: cp }, sweep);
  t('a catering firm sealed as software is dropped', ok('software', 'Thanh toán dịch vụ - hàng hóa', 'DZINE FOOD SOLUTIONS C') === null);
  t('…but Anthropic sealed as software stands: today\'s keywords still agree', ok('software', '', 'ANTHROPIC* CLAUDE SUB') === 'software');
  t('"gui tien nha" sealed as rent is dropped in the queue', ok('rentpay', 'Em gui tien nha. Cam on anh.', '6209991888 - NGUYEN VINH QUANG') === null);
  t('…and left alone in the ledger, where its owner confirmed it', ok('rentpay', '6209991888 - NGUYEN VINH QUANG | Em gui tien nha.', '', true) === 'rentpay');
  t('real rent wording sealed as rent stands', ok('rentpay', 'dong tien nha thang 9', '') === 'rentpay');
  t('an FX fee sealed as a building fee is dropped, in the ledger too', ok('mgmt', 'Phí Quản Lý Giao Dịch VND Tại Nước Ngoài', '', true) === null);
  t('a real building fee stands', ok('mgmt', 'Can ho B10401 nop tien phi quan ly thang 8', '') === 'mgmt');
  t('a sealed p2p yields to a seller mark', ok('p2p', '66527 N9GDR', '3666689689 - HOANG P A') === null);
  t('a node no retired keyword touches passes untouched', ok('coffee', '', 'MPOS*WAYNESCOFFEE') === 'coffee' && ok('zzz', '', '') === null);
}

console.log('\n-- codes a payment system assigned answer before any word does --');
{
  const S = (o) => P.fhStructNode(o);
  t('MCC 5812 alone stops at eating out: it is restaurants AND delivery', S({ mcc: '5812-Eating Places', desc: 'Mua Hàng / SOME PLACE' }) === 'eatout');
  t('…and a keyword may go deeper INSIDE the code\'s branch', S({ mcc: '5812-Eating Places', desc: 'Mua Hàng / Foody' }) === 'delivery'
    && S({ mcc: '5818', desc: 'Mua Hàng / APPLE.COM/BILL' }) === 'streaming');
  t('…but never sideways: the code outranks a keyword from another branch', S({ mcc: '5812', desc: 'Mua Hàng / COFFEE AND BOOKS sach' }) !== 'books');
  t('MCC 5734 reaches the software leaf', S({ mcc: '5734', desc: 'Mua Hàng / ANTHROPIC* CLAUDE SUB' }) === 'software');
  t('a marketplace MCC stops at the group', S({ mcc: '5399', desc: 'Mua Hàng / SPEEPAY*Shopee' }) === 'shopping');
  t('a fee line carries the purchase\'s MCC, and the words win', S({ mcc: '5734-Computer Software', desc: 'Phí Giao Dịch Ngoại Tệ' }) === 'fxfee'
    && S({ mcc: '5818', desc: 'Phí Quản Lý Giao Dịch VND Tại Nước Ngoài' }) === 'fxfee');
  t('an airline MCC range', S({ mcc: '3144' }) === 'flight');
  t('MoMo: a telco top-up service', S({ svc: 'm4b_vttimobifone_topupdata', desc: 'Nạp Data MobiFone' }) === 'mobile');
  t('MoMo: a group fund is pooling, whatever the person named it', S({ svc: 'mp_81212708_1y9i1bgnwd7m2i4ocy8zxh', desc: 'Chuyển tiền vào Quỹ Growth Claude' }) === 'split');
  t('MoMo: the cinema service', S({ svc: 'ecomcgvcinema', desc: 'Mua vé xem phim' }) === 'cinema');
  t('MoMo: a bank top-up coming in is a wallet move', S({ svc: 'vcb03.78.bank', desc: 'Nạp tiền vào Ví để thanh toán dịch vụ', out: false }) === 'wallet');
  t('MoMo: payroll coming in', S({ svc: 'accounting_mm', desc: 'Nhận lương từ MOMO', out: false }) === 'wage');
  t('Grab\'s service id says nothing about ride or food', S({ svc: 'm4becomgrab_moca_v3', desc: 'GRAB' }) === null);
  t('a person\'s masked wallet says nothing', S({ svc: '*******991', desc: 'Chuyển đến Nguyễn Thu Trang' }) === null);
  t('no codes at all is null, never a guess', S({ desc: 'CAO THAI DUY HIEN chuyen tien den LE CAO HUNG' }) === null && S({}) === null);
  t('every MCC target is a real node', (() => { const src = fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8');
    const m = src.match(/var _MCC_NODE=\{([\s\S]*?)\};/)[1]; return [...m.matchAll(/:'([a-z0-9]+)'/g)].every((x) => !!T.get(x[1])); })());
}

console.log('\n-- money sent to a P2P exchange desk is funding, not spending --');
{
  t('a bare 20-digit order id', P.fhTransferShape('126109249 - NGUYEN H P | 22853744443228090368') === 'investfund');
  t('the desk\'s own sentence, with an amount nobody rounds to', P.fhTransferShape('CAO THII DUY HIEN chuyen tien 114112', 52717845) === 'investfund');
  t('the same words with a round amount could be anyone', P.fhTransferShape('HIEN chuyen tien 114112', 5000000) === null);
  t('…and without an amount it says nothing', P.fhTransferShape('CAO THII DUY HIEN chuyen tien 114112') === null);
  t('a 23-digit till reference is not an order id', P.fhTransferShape('VQRQALTWY2264 - FPT PHARMA | 58013187941788600655024') === null);
  t('and that row is not spending', P.fhCountsAsSpending('investfund') === false);
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

console.log('\n-- a group-level row is named at its group, and is still a work queue --');
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
  t('an exact selection is named at the known level too', P.fhNodeSelLabel() === FH_TAX_VI('food'));
  t('fhNodeSelCode unwraps either form',
    P.fhNodeSelCode() === 'food' && (W.fhNodeSel = 'food', P.fhNodeSelCode() === 'food'));
  W.fhNodeSel = '_none';
  t('"Chưa rõ" is still its own thing', P.fhNodeSelCode() === null && P.fhNodeSelMatch(null));
  W.fhNodeSel = null;

  const ui = fs.readFileSync(path.join(ROOT, 'src/js-ui/63-tree-ui.js'), 'utf8');
  const tx = fs.readFileSync(path.join(ROOT, 'src/js-ui/60-transactions.js'), 'utf8');
  t('the rest row opens the rows it is made of', /go: 'fhTreeTapExact/.test(ui));
  t('no leftover counting machinery once the count came off the row',
    !/cnt\[/.test(ui));
  t('rows the tree placed at group level are named at that group, not "unknown"',
    !/'chưa rõ món'/.test(ui) && !/Chưa rõ chi tiết/.test(ui) && /row\(\{ name: n\.vi, amt: own/.test(ui));
  t('only the genuinely un-placed top-level row keeps the muted "rest" look',
    (ui.match(/rest: true/g) || []).length === 1);
  t('the group row and its own-rows highlight separately',
    /opts\.own \? window\.fhNodeSel === '=' \+ opts\.code/.test(ui));
  /* The queue has to be emptiable, or naming it just moves the complaint. */
  t('bulk select can assign a node', /txnBulkNodePick/.test(tx) && /txnBulkSheet\(&#39;node&#39;\)/.test(tx));
  t('the bulk picker is scoped to the group the queue came from', /_bulkNodeScope/.test(tx) && /fhNodeSelCode/.test(tx));
  t('assigning in bulk teaches, so the queue does not refill',
    /fhLessonLearnNode\(\{ note:raw\.note/.test(tx));
  t('bulk node writes go through the surgical writers, not a full row rewrite',
    /fhPersonalSetNode\(raw\.id, code\)/.test(tx) && /fhTxnSetNode\(raw\._dbId, code\)/.test(tx));
}

console.log('\n-- one definition of "spending", so the totals cannot drift apart --');
{
  t('an ordinary expense counts', P.fhCountsAsSpending('groceries') && P.fhCountsAsSpending('rentpay'));
  t('a row with no node still counts, so nothing new is hidden', P.fhCountsAsSpending(null));
  t('money moved to yourself does not', !P.fhCountsAsSpending('bankbank') && !P.fhCountsAsSpending('wallet'));
  t('a card paid off does not', !P.fhCountsAsSpending('cardpay'));
  t('money GIVEN to someone else still does', P.fhCountsAsSpending('p2p'));
  /* "Còn lại" is money you can still spend. Paying a card down really took it;
     shuffling between your own accounts did not. */
  t('only the card repayment dents Còn lại',
    P.fhXferCashOut('cardpay') && !P.fhXferCashOut('bankbank') && !P.fhXferCashOut('cashout')
      && !P.fhXferCashOut('wallet') && !P.fhXferCashOut('savings'));

  /* Every screen that says "spending" must ask the same question. Missing one
     is exactly how the header came to say 27,2tr while the breakdown said 18tr. */
  const sites = [
    ['src/js-data/30-hydrate.js', 'family month + category totals'],
    ['src/js-ui/20-budget.js', 'family chart, buổi map, range guide'],
    ['src/js-ui/21-personal.js', 'personal Ra, month picker, chart, range'],
    ['src/js-ui/60-transactions.js', 'the label legend'],
  ];
  sites.forEach(([f, what]) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    t('asks it: ' + what, /fhCountsAsSpending/.test(src));
  });
  const bud = fs.readFileSync(path.join(ROOT, 'src/js-ui/20-budget.js'), 'utf8');
  t('all three family sums ask, not just one', (bud.match(/fhCountsAsSpending/g) || []).length === 3);
  const pers = fs.readFileSync(path.join(ROOT, 'src/js-ui/21-personal.js'), 'utf8');
  t('every personal sum asks', (pers.match(/fhCountsAsSpending/g) || []).length >= 7);
  t('Còn lại carries the card-repayment dent, and says so',
    /xferCash/.test(pers) && /Trả nợ thẻ/.test(pers));

  /* The breakdown and the header must land on the same number for the same
     rows — that is the whole point, so compute both and compare. */
  {
    const rows = [
      { node: 'groceries', amt: 3000000 }, { node: 'rentpay', amt: 7500000 },
      { node: 'home', amt: 500000 }, { node: null, amt: 350000 },
      { node: 'bankbank', amt: 7000000 }, { node: 'cardpay', amt: 1080000 },
    ];
    const headerRa = rows.filter((r) => P.fhCountsAsSpending(r.node)).reduce((s2, r) => s2 + r.amt, 0);
    // what fhTreeBreakdownHTML puts in its spending total: expense-kind nodes + no-node
    const treeTotal = rows.reduce((s2, r) => {
      if (!r.node || !T.get(r.node)) return s2 + r.amt;
      return T.kindOf(r.node) === 'expense' ? s2 + r.amt : s2;
    }, 0);
    t('header "Ra" and the tree breakdown agree to the đồng', headerRa === treeTotal, { headerRa, treeTotal });
    t('and the 8,08tr that is not spending is excluded from both', headerRa === 11350000, headerRa);
  }
}

console.log('\n-- the review card names what the app actually knows --');
{
  /* The queue showed "Others" on a transfer to another person: the card was
     reading the legacy label, while the tree already knew it was p2p. The chip
     now leads with the tree and falls back to the label. */
  const ui = fs.readFileSync(path.join(ROOT, 'src/js-ui/56-csv-import-ui.js'), 'utf8');
  const c2 = {
    /* catStyle is read as window.catStyle, the way the app holds it. */
    window: { catStyle: { Others: ['🗂️'], 'Ăn uống': ['🍽️'] } },
    localStorage: { getItem: () => null, setItem: () => {} }, L: (vi) => vi,
    esc: (x) => String(x), catValid: () => true, CAT_FALLBACK: 'Others',
    isFallbackCat: (n) => String(n || '').trim().toLowerCase() === 'others',
    catStyle: { Others: ['🗂️'], 'Ăn uống': ['🍽️'] },
  };
  vm.createContext(c2);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/11-taxonomy.js'), 'utf8'), c2);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/13-partition.js'), 'utf8'), c2);
  /* LOAD THE WHOLE FILE, not a slice of it. Slicing the helpers out and running
     them in isolation is exactly what hid the bug that broke the queue: they
     were declared INSIDE csvStagedRowsCard while being called from two other
     functions, so every real caller threw a ReferenceError and the review
     screen would not open. Evaluating the real file is what proves they are
     reachable from anywhere. */
  vm.runInContext(ui, c2);
  t('the chip helpers are reachable from every caller, not nested in one',
    typeof c2.csvCatChipText === 'function' && typeof c2.csvCatLabel === 'function');
  vm.runInContext('globalThis.CHIP=csvCatChipText;globalThis.CLBL=csvCatLabel;', c2);

  t('a transfer to another person reads as one, not as the catch-all',
    c2.CHIP({ node: 'p2p', cat: 'Others' }, 'expense') === '🤝 Chuyển cho người khác');
  t('the tree beats the label when both are known',
    c2.CHIP({ node: 'coffee', cat: 'Ăn uống' }, 'expense') === '🍽️ Cà phê');
  t('the label still carries a row the tree could not place',
    c2.CHIP({ node: null, cat: 'Ăn uống' }, 'expense') === '🍽️ Ăn uống');
  t('a node of the wrong kind is ignored rather than shown',
    c2.CHIP({ node: 'p2p', cat: 'Ăn uống' }, 'income') === '🍽️ Ăn uống');
  t('a row with neither says so', c2.CHIP({ node: null, cat: null }, 'expense') === null);
  /* CAT_FALLBACK is STORED as the literal "Others" and translated only for
     display — the legend has always done it, the review screen never did. */
  t('the catch-all is shown in Vietnamese, not as the stored string',
    c2.CLBL('Others') === 'Khác' && c2.CHIP({ node: null, cat: 'Others' }, 'expense') === '🗂️ Khác');
  t('a real category keeps its own name', c2.CLBL('Ăn uống') === 'Ăn uống');
  t('the expanded row and its picker translate it too',
    (ui.match(/csvCatLabel\(/g) || []).length >= 4);

  /* And the rows actually in the queue resolve to something worth reading. */
  const seen = {};
  [['CAO THÁI DUY HIỂN chuyen tien den NGUYEN DUC THIEN - 220999999994', 'p2p'],
   ['MPOS*WAYNESCOFFEE HO CHI MINH VN', 'coffee'],
   ['CO.OPMART NHIEU LOC HO CHI MINH VN', 'groceries'],
   ['APPLE.COM/BILL', 'streaming']].forEach(([note, want]) => {
     seen[note.slice(0, 18)] = P.fhNodeGuess({ kind: 'expense', note: note }) === want;
   });
  t('every card in the screenshot lands on a real node', Object.values(seen).every(Boolean), seen);
}

console.log('\n-- statements get the same node the email path gets --');
{
  /* The statement lane never assigned a node: merchant-concepts computed one
     (conceptsForMerchants returns {concepts, nodes}) and then dropped it on
     the way out, and the client stored only the concept. So a merchant on a
     bank email got its leaf while the same merchant on a statement stopped at
     the group. Both ends now carry it, in the same sealed field. */
  const mc = fs.readFileSync(path.join(ROOT, 'supabase/functions/merchant-concepts/index.ts'), 'utf8');
  const st = fs.readFileSync(path.join(ROOT, 'src/js-data/77-statement-capture.js'), 'utf8');
  const cl = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/mailbox/classify.mjs'), 'utf8');
  t('the shared cascade already returns nodes', /return \{ concepts: result, nodes,/.test(cl));
  t('the function hands them to the client', /nodes: out\.nodes/.test(mc) && /nodes: \{\}, limited: false/.test(mc));
  t('the client reads them and validates against the tree it has',
    /res\.data\.nodes/.test(st) && /FH_TAX\.get\(nd\)\) p\.node = nd/.test(st));
  t('and seals them where fhStagedNode reads email rows', /node: p\.node \|\| null,/.test(st));
}

console.log('\n-- the picker is one outline of the tree, in the tree\'s own order --');
{
  /* Whole files, not slices: a helper nested inside another function passes a
     sliced test and breaks the app. */
  const c3 = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, L: (vi) => vi,
    esc: (x) => String(x == null ? '' : x), escAttr: (x) => String(x == null ? '' : x), fmtK: (v) => String(v),
    document: { getElementById: () => null, querySelector: () => null } };
  vm.createContext(c3);
  ['11-taxonomy', '13-partition', '63-tree-ui', '56-csv-import-ui'].forEach((f) =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js-ui/' + f + '.js'), 'utf8'), c3));
  const H = (o) => c3.fhNodeOutlineHTML(Object.assign({ kind: 'expense', q: '', open: {},
    pick: (c) => 'PICK(' + c + ')', toggle: (c) => 'TOG(' + c + ')', clear: 'CLEAR()' }, o));
  const names = (html) => [...html.matchAll(/class="npick-nm"[^>]*>([^<]*)</g)].map((m) => m[1]);
  const roots = T.roots('expense').filter((r) => !T.get(r).manual);

  const open = c3.fhNodeOutlineSeed('streaming');
  const html = H({ cur: 'streaming', open });
  t('the tree keeps ITS order: the chosen branch is opened, never hoisted',
    names(html)[0] === T.get(roots[0]).vi && T.root('streaming') !== roots[0], names(html).slice(0, 3));
  t('every group is there, in taxonomy order',
    JSON.stringify(names(html).filter((n) => roots.some((r) => T.get(r).vi === n)).slice(0, roots.length)) === JSON.stringify(roots.map((r) => T.get(r).vi)));
  t('the path down to the current node is open', names(html).includes(T.get('streaming').vi) && names(html).includes(T.get(T.get('streaming').parent).vi));
  t('other branches stay folded', !names(html).includes(T.get('drinks').vi));
  t('the current node is the marked one', /npick-row on[^>]*>(?:(?!npick-row)[\s\S])*PICK\(streaming\)/.test(html));
  t('a GROUP is one tap, same as a leaf', html.includes('PICK(leisure)') && html.includes('PICK(streaming)'));
  t('you can go DOWN: opening a branch lists its children', names(H({ cur: null, open: { food: 1 } })).includes(T.get('drinks').vi));
  t('a leaf has no chevron to tap', !html.includes('TOG(streaming)') && html.includes('TOG(leisure)'));
  const found = names(H({ cur: null, q: 'ca phe' }));
  t('search filters the outline and keeps the ancestors', found.includes(T.get('coffee').vi) && found.includes(T.get('drinks').vi) && found.includes(T.get('food').vi) && !found.includes(T.get('rent').vi), found.slice(0, 6));
  t('"Chưa rõ" is the clear row and the only way to it', (html.match(/CLEAR\(\)/g) || []).length === 1 && !html.includes('PICK(xunfiled)'));
  t('no node at all marks the clear row', /npick-clear on/.test(H({ cur: null })));
  t('income rows get the income tree', names(H({ kind: 'income', cur: null })).every((n) => !roots.some((r) => T.get(r).vi === n)));
  t('nothing found says so', /npick-empty/.test(H({ q: 'zzzzqqq' })));

  /* The reveal moved THE WHOLE APP. scrollIntoView scrolls every scrollable
     ancestor, html/body/.phone are overflow:hidden (finger-proof, not
     script-proof), and nothing scrolls them back. */
  {
    let pageScrolled = false;
    const rowEl = { getBoundingClientRect: () => ({ top: 900, height: 48 }), scrollIntoView: () => { pageScrolled = true; } };
    const listEl = { scrollTop: 100, clientHeight: 400, getBoundingClientRect: () => ({ top: 300 }), querySelector: () => rowEl };
    c3.fhNodeOutlineReveal(listEl);
    t('revealing the chosen row scrolls ONLY its own list', pageScrolled === false && listEl.scrollTop === 100 + (900 - 300) - (400 - 48) / 2, listEl.scrollTop);
    const topList = { scrollTop: 0, clientHeight: 400, getBoundingClientRect: () => ({ top: 300 }), querySelector: () => ({ getBoundingClientRect: () => ({ top: 310, height: 48 }) }) };
    c3.fhNodeOutlineReveal(topList);
    t('a row already near the top never scrolls negative', topList.scrollTop === 0);
    t('no chosen row, nothing moves', (function(){ const l = { scrollTop: 7, querySelector: () => null }; c3.fhNodeOutlineReveal(l); return l.scrollTop === 7; })());
  }
  {
    const offenders = [];
    ['src/js-ui', 'src/js-data'].forEach((dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/\.scrollIntoView\s*\(/.test(src)) offenders.push(f);
    }));
    t('nothing in the app calls scrollIntoView', offenders.length === 0, offenders);
  }
  t('both pickers draw the same component',
    /fhNodeOutlineHTML\(/.test(fs.readFileSync(path.join(ROOT, 'src/js-ui/56-csv-import-ui.js'), 'utf8'))
    && typeof c3.fhNodePickToggle === 'function' && typeof c3.fhNodePickClear === 'function');
  t("the review sheet's outline state lives at file scope",
    typeof c3.csvNodeToggle === 'function' && typeof c3.csvNodeSearch === 'function' && typeof c3.csvNodeListHTML === 'function');
  t('the flat siblings-first list is gone', typeof c3.fhNodeCorrections === 'undefined');
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