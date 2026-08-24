/* ---- CSV import: row-level parsing, grouping, dedup, promotion -------------
   Turns a resolved column mapping (45-csv-import.js) + every real row into
   candidate transactions, buckets them (ready / needs-category / possible
   duplicate / deferred), and promotes approved ones by feeding the existing
   bulk-expense-logging machinery (bulkRows + submitBulk()) rather than a
   bespoke insert -- inherits fhField()/_fhWriteLocked() encryption-
   correctness for free, per CSV-IMPORT-ENCRYPTION.md.

   Scope for this pass: EXPENSE rows only. transactions has no direction
   column -- income lives in a separate `incomes` table this doesn't write
   to. A row is only treated as an expense when every amount in the source
   column was consistently unsigned or consistently negative; a column that
   mixes signs (a real income-and-expense statement) gets every row deferred
   rather than guessed at, since mis-filing income as an expense corrupts
   the ledger, not just mis-categorizes it. */

var MONTH_ABBR = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

function parseCsvDateValue(raw, format, convention) {
  var v = (raw || '').trim();
  if (!v) return null;
  var mmFirst = convention === 'mm/dd/yyyy';
  var m;

  // Strip a trailing time — "2026-08-01 14:30:00" is still 1 Aug.
  v = v.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?(\s*Z)?.*$/, '').trim();

  if (format === 'iso' || format === 'iso_slash') {
    m = v.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return _csvDate(+m[1], +m[2], +m[3]);
  }
  if (format === 'compact') {
    m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return _csvDate(+m[1], +m[2], +m[3]);
  }
  if (format === 'd_mon_y') {
    m = v.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})$/);
    if (m) { var mi1 = _csvMonth(m[2]); if (mi1 != null) return _csvDate(+m[3], mi1 + 1, +m[1]); }
  }
  if (format === 'mon_d_y') {
    m = v.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) { var mi2 = _csvMonth(m[1]); if (mi2 != null) return _csvDate(+m[3], mi2 + 1, +m[2]); }
  }
  if (format === 'vi_thg') {
    m = v.match(/^(\d{1,2})\s*(?:thg|thang)\s*(\d{1,2}),?\s*(\d{4})$/i);
    if (m) return _csvDate(+m[3], +m[2], +m[1]);
  }
  if (format === 'dmy_4' || format === 'dmy_2') {
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      // A value over 12 can only be the day, whichever order the file uses --
      // that beats the file-level convention, which is only a best guess.
      if (a > 12) return _csvDate(y, b, a);
      if (b > 12) return _csvDate(y, a, b);
      return mmFirst ? _csvDate(y, a, b) : _csvDate(y, b, a);
    }
  }
  if (format === 'dm_noyear') {
    m = v.match(/^(\d{1,2})[\/.-](\d{1,2})$/);
    if (m) {
      var a2 = +m[1], b2 = +m[2], y2 = (new Date()).getFullYear();
      if (a2 > 12) return _csvDate(y2, b2, a2);
      if (b2 > 12) return _csvDate(y2, a2, b2);
      return mmFirst ? _csvDate(y2, a2, b2) : _csvDate(y2, b2, a2);
    }
  }
  return null;
}

// Rejects impossible dates (13th month, 31 Feb) instead of letting Date roll
// them into the next month, which would silently file a row on the wrong day.
function _csvDate(y, mo, d) {
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  var dt = new Date(y, mo - 1, d);
  return (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) ? dt : null;
}

function _csvMonth(name) {
  var n = deburr(String(name || '').toLowerCase()).slice(0, 3);
  var i = MONTH_ABBR[n];
  return i === undefined ? null : i;
}

/* A family whose app is in Vietnamese shouldn't end up with an English
   category because their export happened to be labelled that way. Names that
   have a real equivalent are created in the app's language; anything genuinely
   untranslatable keeps the file's own wording rather than getting a clumsy
   invented name. Bilingual so it also works the other way round. */
var CSV_CAT_NAMES = [
  { vi:'Ăn uống',     en:'Dining',        match:['an uong','dining','food','eating','restaurant','ăn uống'] },
  { vi:'Đi chợ',      en:'Groceries',     match:['di cho','groceries','grocery','mart','market','supermarket'] },
  { vi:'Đi lại',      en:'Transport',     match:['di lai','di chuyen','transport','transportation','commute'] },
  { vi:'Nhà ở',       en:'Housing',       match:['nha o','housing','rent','utilities','tien nha'] },
  { vi:'Giải trí',    en:'Fun',           match:['giai tri','fun','entertainment','leisure'] },
  { vi:'Mua sắm',     en:'Shopping',      match:['mua sam','shopping'] },
  { vi:'Quần áo',     en:'Clothing',      match:['quan ao','clothing','clothes','apparel','fashion','thoi trang'] },
  { vi:'Sức khỏe',    en:'Health',        match:['suc khoe','health','medical','healthcare','pharmacy','thuoc','y te'] },
  { vi:'Học hành',    en:'Education',     match:['hoc hanh','education','tuition','school','hoc phi','courses'] },
  { vi:'Bảo hiểm',    en:'Insurance',     match:['bao hiem','insurance'] },
  { vi:'Du lịch',     en:'Travel',        match:['du lich','travel','trip','holiday','vacation'] },
  { vi:'Thể thao',    en:'Sports',        match:['the thao','sports','gym','fitness'] },
  { vi:'Làm đẹp',     en:'Beauty',        match:['lam dep','beauty','cosmetics','salon','spa','my pham'] },
  { vi:'Thú cưng',    en:'Pets',          match:['thu cung','pets','pet'] },
  { vi:'Quà tặng',    en:'Gifts',         match:['qua tang','gifts','gift','qua'] },
  { vi:'Con cái',     en:'Kids',          match:['con cai','kids','children','baby','tre em'] },
  { vi:'Dịch vụ số',  en:'Subscriptions', match:['dich vu so','subscriptions','subscription','streaming'] },
  { vi:'Xăng xe',     en:'Fuel',          match:['xang xe','fuel','petrol','gas station','do xang'] },
  { vi:'Điện thoại',  en:'Phone',         match:['dien thoai','phone','mobile','topup','nap the'] },
  { vi:'Từ thiện',    en:'Charity',       match:['tu thien','charity','donation','quyen gop'] },
  { vi:'Tiết kiệm',   en:'Savings',       match:['tiet kiem','savings','saving'] },
  { vi:'Đầu tư',      en:'Investment',    match:['dau tu','investment','invest'] },
  { vi:'Khác',        en:'Others',        match:['khac','other','others','misc','linh tinh'] },
];

// The app-language name for a file's category label, or '' when we have none.
function csvLocalizedCatName(name) {
  var g = deburr(String(name || '').trim().toLowerCase());
  if (!g) return '';
  for (var i = 0; i < CSV_CAT_NAMES.length; i++) {
    var row = CSV_CAT_NAMES[i];
    for (var j = 0; j < row.match.length; j++) {
      if (g === deburr(row.match[j])) return (window.LANG === 'vi' || LANG === 'vi') ? row.vi : row.en;
    }
  }
  return '';
}

/* Categories the file introduced, held PENDING until Import.

   These used to be pushed straight into the app's live catOrder, which the
   budget editor, the expense composer and the transaction list all read -- so
   merely opening a file made a category appear across the whole app, and
   cancelling the review left it behind. Nothing global is touched now until
   the rows are actually written. */
var csvPendingCats = [];
function csvAllCats(){ return (window.catOrder || []).concat(csvPendingCats); }
function csvCatOk(c){ return !!c && (catValid(c) || csvPendingCats.indexOf(c) >= 0); }

var csvFuzzyCats = true;   // false while an undo is in effect
var csvCatMerges = {};     // file name (normalized) -> the family category it merged into
var csvCatAmbiguous = {};  // file names that matched 2+ existing categories

/* Match a file's category name against the family's own categories.

   Exact-after-normalization first ("NHA CUA" == "Nhà cửa"). Then the case a
   real ledger hits constantly: people abbreviate. A file saying "Ăn" means
   the family's existing "Ăn uống" -- inventing a second, near-duplicate
   category would quietly split their history in two. So a name that is a
   whole-word prefix of (or contains) exactly ONE existing category merges
   into it, and the merge is reported so it can be reversed.

   "Exactly one" is the safety rule: "Ăn" against BOTH "Ăn uống" and "Ăn
   ngoài" is genuinely ambiguous, and guessing there would file real money
   under the wrong heading -- those fall through to the review for a human. */
function matchCategoryName(guess) {
  var g = deburr((guess || '').trim().toLowerCase());
  if (!g) return null;
  var order = csvAllCats(), i;
  for (i = 0; i < order.length; i++) {
    if (deburr(order[i].toLowerCase()) === g) return order[i];
  }
  if (!csvFuzzyCats) return null;
  var hits = [];
  for (i = 0; i < order.length; i++) {
    var n = deburr(order[i].toLowerCase());
    if (_csvWordIn(g, n) || _csvWordIn(n, g)) hits.push(order[i]);
  }
  if (hits.length === 1) { csvCatMerges[String(guess).trim()] = hits[0]; return hits[0]; }

  /* Same meaning, different word. A file saying "Food" or "Mart" means the
     family's "Ăn uống" and "Đi chợ" -- string matching can't see that, and
     creating an English twin of a category they already have quietly splits
     their history in two. So the file's label is resolved to a CONCEPT
     (CONCEPT_MATCH, the composer's own map, which already lists food/dining/
     groceries/mart together) and then back to whichever category this family
     actually uses for it. An existing category always wins over a new one. */
  var loc = csvLocalizedCatName(guess);
  if (loc) {
    for (i = 0; i < order.length; i++) {
      if (deburr(order[i].toLowerCase()) === deburr(loc.toLowerCase())) {
        csvCatMerges[String(guess).trim()] = order[i];
        return order[i];
      }
    }
  }

  if (hits.length === 0 && typeof CONCEPT_MATCH === 'object' && typeof familyCatForConcept === 'function') {
    for (var cpt in CONCEPT_MATCH) {
      var names = (CONCEPT_MATCH[cpt] && CONCEPT_MATCH[cpt].names) || [];
      for (var n = 0; n < names.length; n++) {
        var nm = deburr(String(names[n]).toLowerCase());
        if (g === nm || _csvWordIn(nm, g) || _csvWordIn(g, nm)) {
          var fam = familyCatForConcept(cpt);
          if (fam && csvCatOk(fam)) { csvCatMerges[String(guess).trim()] = fam; return fam; }
        }
      }
    }
  }
  // 2+ hits: "Ăn" could be "Ăn uống" OR "Ăn ngoài". Creating an "Ăn" category
  // would be as wrong as picking one at random, so mark it and let the review
  // ask -- csvUnknownFileCategories skips these when auto-creating.
  if (hits.length > 1) csvCatAmbiguous[g] = true;
  return null;
}

// whole-word containment, so "an" matches "an uong" but not "banh"
function _csvWordIn(needle, hay) {
  return new RegExp('(^|\\s)' + String(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(hay);
}

/* ---- bank-statement merchant recognition ---------------------------------
   guessCat() reads human notes ("đi chợ", "tiền điện"). A bank export doesn't
   write like that: it writes "CUSTOMER MBCT NGUYEN THU TRANG chuyen tien" or
   "CUSTOMER RetailMastercard.PBA-765078" -- protocol noise wrapped around a
   merchant name that may not even be there. So before giving up and filing a
   row under the catch-all, strip the bank's boilerplate and look for a
   merchant SUBSTRING (not whole-word: "momo" hides inside "MBCTMoMo").

   The concept it returns is fed through the app's own familyCatForConcept(),
   so it always lands on a category the family actually has, under their name
   for it -- never a category we invented. */
var CSV_BANK_NOISE = /\b(customer|khach hang|mbct|mbvcb|vcb|tcb|acb|bidv|vietinbank|agribank|napas|ib|ibft|ift|ft|trace|ref|pba|pos|atm|retailmastercard|mastercard|visa|jcb|napas247|ck|tk|stk|so tk|noi dung|nd|gd|tt)\b|[0-9]{4,}|[-_.]{2,}/g;

var CSV_MERCHANTS = [
  ['Transport', ['grab','gojek','be group','beamin','baemin','xanh sm','vinasun','mai linh','uber','vato','petrolimex','pvoil','xang dau','vetc','epass','parking']],
  ['Dining',    ['highlands','phuc long','trung nguyen','katinat','the coffee house','tch','starbucks','passio','cong caphe','coffee','cafe','ca phe','kfc','lotteria','jollibee','mcdonald','burger','pizza','domino','texas chicken','popeyes','sushi','bbq','buffet','nha hang','restaurant','shopeefood','grabfood','now.vn','beefood','bun','pho ','com tam','tra sua','gong cha','tocotoco','phuc tea','mixue']],
  ['Groceries', ['quick save','minimart','mini mart','tap hoa','bach hoa xanh','bhx','winmart','vinmart','coopmart','co.opmart','co opmart','big c','go mall','emart','aeon','mega market','lotte mart','satra','circle k','gs25','familymart','ministop','7-eleven','cheers','sieu thi','farmers market','annam']],
  ['Housing',   ['evn','dien luc','sawaco','cap nuoc','fpt telecom','viettel','vnpt','vinaphone','mobifone','internet','tien dien','tien nuoc','chung cu','ban quan ly','quan ly toa nha','pccc','gas','pgas','petrolgas']],
  ['Fun',       ['cgv','lotte cinema','bhd star','galaxy cinema','beta cinema','netflix','spotify','youtube premium','fpt play','vieon','k+','steam','playstation','nintendo','gym','california fitness','citigym','yoga','kara','massage','spa','du lich','booking.com','agoda','traveloka','vietjet','vietnam airlines','bamboo airways','vexere']],
  ['Shopping',  ['crescent mall','vincom','parkson','takashimaya','saigon centre','saigon center','gigamall','van hanh mall','estella place','vivocity','diamond plaza','aeon mall','shopee','lazada','tiki','sendo','tiktok shop','amazon','apple.com','itunes','icloud','google','play store','uniqlo','zara','h&m','muji','decathlon','nguyen kim','dien may xanh','the gioi di dong','tgdd','fpt shop','cellphones']],
  ['Others',    ['pharmacity','long chau','an khang','guardian','watsons','nha thuoc','benh vien','phong kham','vinmec','medlatec','hoan my','bao hiem','insurance','hoc phi','tuition','truong']],
];

/* MCC -> concept. Codes are ISO 18245 -- the same everywhere, unlike
   merchant names -- so a short table covers the spending a family statement
   actually contains. Codes not listed simply fall through to the next tier. */
var CSV_MCC_CONCEPT = {
  '5411':'Groceries','5422':'Groceries','5451':'Groceries','5462':'Groceries','5499':'Groceries',
  '5811':'Dining','5812':'Dining','5813':'Dining','5814':'Dining',
  '4111':'Transport','4121':'Transport','4131':'Transport','5541':'Transport','5542':'Transport','7523':'Transport',
  '5912':'Health','8011':'Health','8021':'Health','8062':'Health',
  '5651':'Clothing','5691':'Clothing','5661':'Clothing',
  '5262':'Shopping','5311':'Shopping','5399':'Shopping','5964':'Shopping','5999':'Shopping',
  '7832':'Fun','7841':'Fun','7994':'Fun','7996':'Fun',
  '4899':'Housing','4900':'Housing',
  '8211':'Education','8220':'Education','8299':'Education',
};

function csvMerchantConcept(desc) {
  var t = ' ' + deburr(String(desc || '').toLowerCase()).replace(CSV_BANK_NOISE, ' ').replace(/\s+/g, ' ') + ' ';
  if (t.trim().length < 2) return '';
  var i, j;
  for (i = 0; i < CSV_MERCHANTS.length; i++) {
    var concept = CSV_MERCHANTS[i][0], toks = CSV_MERCHANTS[i][1];
    for (j = 0; j < toks.length; j++) {
      if (t.indexOf(deburr(toks[j])) >= 0) return concept;
    }
  }
  /* Then the composer's BRAND words (KW_SHARED) only -- 'grab', 'netflix',
     'highlands' -- still as substrings, because a bank memo glues them to
     other tokens ("MBCTMoMo", "GRABVN").

     KW_VI / KW_EN are deliberately NOT scanned here. They're ordinary
     vocabulary, and a substring match on ordinary words is dangerous in a
     memo full of names: "tra" (tea) sits inside "TRANG", so every transfer
     this family made was being labelled food because of a person's name.
     guessCat already tried those words the safe way, with word boundaries. */
  if (typeof KW_SHARED === 'object') {
    for (var cpt in KW_SHARED) {
      var list = KW_SHARED[cpt];
      for (j = 0; j < list.length; j++) {
        var w = deburr(String(list[j]).toLowerCase());
        if (w.length >= 4 && t.indexOf(w) >= 0) return cpt;
      }
    }
  }
  return '';
}

/* The family's own history is the strongest category signal there is: if a
   description was categorized by a human before, a new row with the same
   description almost certainly belongs there too. window.txns is newest-first
   and already client-side-decrypted, so the first hit per description is the
   most recent human choice. */
function csvHistoryCategoryMap() {
  var map = {};
  (window.txns || []).forEach(function(t) {
    if (!t.note || !catValid(t.cat)) return;
    var k = normDescForDedup(t.note);
    if (!map[k]) map[k] = t.cat;
  });
  return map;
}

/* A statement usually ends with a total, not a transaction: no date, and an
   amount far larger than anything above it (your file's last line was
   28.725.893 with no date). Calling that "missing date" invites someone to
   "fix" a number that was never a purchase, so it's identified and set aside
   with an honest label instead.

   Deliberately narrow: only the LAST few rows, only without a date, and only
   when the amount is an outlier or the text says so. A genuinely dateless
   transaction mid-file is still a transaction. */
function csvMarkSummaryRows(candidates) {
  if (!candidates.length) return;
  var amounts = candidates.map(function (c) { return c.amount || 0; }).filter(function (a) { return a > 0; });
  if (!amounts.length) return;
  var sorted = amounts.slice().sort(function (a, b) { return a - b; });
  var median = sorted[Math.floor(sorted.length / 2)] || 0;

  var tailStart = Math.max(0, candidates.length - 3);
  for (var i = tailStart; i < candidates.length; i++) {
    var c = candidates[i];
    var saysTotal = /\b(tong|tong cong|cong|total|sum|so du|balance)\b/.test(deburr(String(c.description || '').toLowerCase()));
    var outlier = median > 0 && c.amount != null && c.amount > median * 8;
    if ((!c.date && (outlier || saysTotal || !c.description)) || (saysTotal && !c.date)) {
      c.isSummaryRow = true;
      c.flags.push('summary_row');
    }
  }
}

/* ---- pattern pass: what the SHAPE of the spending says ---------------------
   Some rows name nothing a dictionary can know -- a transfer to a person, a
   venue we've never heard of. But a month of statements has shape, and two
   patterns are unambiguous enough to act on:

     · the same payee, three or more times, never above ~50k
       -> a small daily habit. Coffee/food is what that is in practice.
     · the same large round amount, repeating across months
       -> rent. Nothing else in a household ledger looks like that.

   These are marked catSource:'pattern' -- a weaker signal than a named
   merchant, disclosed as a guess so it's checked rather than trusted. */
/* Payment gateways sit between the family and the shop, and the bank writes
   whichever one handled it: the same coffee shop arrives as "REVI PHU MY HUNG
   TOWER" one week and "PAYOO REVICOFFEEHCM" the next. Stripping the gateway
   name keeps the merchant recognisable across both, so a lesson taught once
   isn't asked again the next month. */
var CSV_GATEWAYS = /\b(payoo|mpos|vnpay|onepay|napas|ecpay|appota|zalopay|shopeepay|viettelpay|smartpay|nganluong|baokim)\b/g;

function csvPatternKey(c) {
  var base = (c.counterparty || c.description || '');
  return deburr(String(base).toLowerCase())
    .replace(CSV_BANK_NOISE, ' ')
    .replace(CSV_GATEWAYS, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 40);
}

function csvPatternPass(candidates) {
  if (typeof familyCatForConcept !== 'function') return;
  var byKey = {}, byAmount = {};
  candidates.forEach(function (c) {
    if (c.amount == null || c.isIncome) return;
    var k = csvPatternKey(c);
    if (k) (byKey[k] = byKey[k] || []).push(c);
    (byAmount[c.amount] = byAmount[c.amount] || []).push(c);
  });

  var dining = familyCatForConcept('Dining');
  if (dining && csvCatOk(dining)) {
    Object.keys(byKey).forEach(function (k) {
      var g = byKey[k];
      if (g.length < 3) return;
      if (!g.every(function (c) { return c.amount <= 50000; })) return;
      g.forEach(function (c) {
        if (c.catSource === 'fallback' || !c.categoryName) { c.categoryName = dining; c.catSource = 'pattern'; }
      });
    });
  }

  var housing = familyCatForConcept('Housing');
  if (housing && csvCatOk(housing)) {
    Object.keys(byAmount).forEach(function (a) {
      var g = byAmount[a];
      if (g.length < 2 || +a < 3000000) return;          // recurring AND large
      if (+a % 100000 !== 0) return;                      // rent is a round figure
      g.forEach(function (c) {
        if (c.catSource === 'fallback' || !c.categoryName) { c.categoryName = housing; c.catSource = 'pattern'; }
      });
    });
  }
}

/* ---- on-device learning ----------------------------------------------------
   Every correction the family makes is the best possible signal about their
   own spending, and it never has to leave the device to be useful. A fix like
   "this payee is Ăn ngoài" is remembered against the payee's normalized key,
   so the next import gets it right without asking again.

   Stored locally, encrypted for a committed-enc family exactly like the draft
   is; nothing is sent anywhere and no model is trained on anyone's data. */
var FH_CSV_LEARNED = 'fh-csv-learned';
var csvLearned = {};        // key -> category name (in memory for the sync tiers)
var _learnSeq = 0;

function csvLearnLoad(){
  var raw; try{ raw = localStorage.getItem(FH_CSV_LEARNED); }catch(e){ return; }
  if(!raw) return;
  var d; try{ d = JSON.parse(raw); }catch(e){ return; }
  if(d && d.enc){
    if(!window.fhDecStr) return;
    window.fhDecStr(d.ct).then(function(pt){ if(pt){ try{ csvLearned = JSON.parse(pt) || {}; }catch(e){} } });
    return;
  }
  csvLearned = (d && d.map) || {};
}

function csvLearnSave(){
  try{
    if(window.fhEncState && window.fhEncState()==='enc'){
      if(!(window.fhKeyReady && window.fhKeyReady()) || !window.fhEncStr) return;
      var seq = ++_learnSeq;
      window.fhEncStr(JSON.stringify(csvLearned)).then(function(ct){
        if(!ct || seq!==_learnSeq) return;
        try{ localStorage.setItem(FH_CSV_LEARNED, JSON.stringify({ v:1, enc:1, ct:ct })); }catch(e){}
      });
      return;
    }
    localStorage.setItem(FH_CSV_LEARNED, JSON.stringify({ v:1, map:csvLearned }));
  }catch(e){}
}

// Called when a person picks a category themselves -- the only signal strong
// enough to learn from. Guesses are never fed back, or a wrong guess would
// cement itself.
/* A payee key alone is too coarse for bank transfers: the SAME string --
   "nguyen thu trang chuyen tien" -- covers a 35k coffee and a 7.000.000 rent.
   Learning from one then silently relabels the other (this is exactly how a
   rent row turned into "Ăn uống"). So a lesson is scoped to the size of the
   payment as well as the payee: a correction on a small transfer never
   reaches a large one. */
function csvAmountBand(a){
  a = Number(a) || 0;
  if (a < 50000) return 'a';
  if (a < 500000) return 'b';
  if (a < 5000000) return 'c';
  return 'd';
}

/* A lesson is stored under TWO keys: the merchant with its amount band, and the
   merchant alone.

   The band exists so a place you spend two very different ways can be taught two
   answers — the same shop for a coffee and for a month's groceries. But it also
   meant a merchant taught at one size was a stranger at another: REVI PHU MY
   HUNG TOWER learned at 2.888đ (band 'a') told us nothing about the same shop at
   120.000đ (band 'b'), and the category people had already given us was silently
   not carried. Bands are 50k / 500k / 5M, so ordinary spending crosses them all
   the time.

   Banded key wins on lookup, bare key is the fallback. Specific knowledge still
   beats general knowledge; general knowledge beats none, which is what we had. */
function csvLearnKeyBase(c){
  return csvPatternKey(c) || '';
}
function csvLearnKey(c){
  var k = csvPatternKey(c);
  return k ? (k + '|' + csvAmountBand(c.amount)) : '';
}
// The one place that answers "what did we learn about this merchant?", so the
// precedence lives here rather than being re-derived at each call site.
function csvLearnedCat(c){
  var k = csvLearnKey(c);
  if (k && csvLearned[k]) return csvLearned[k];
  var b = csvLearnKeyBase(c);
  if (b && b.length >= 6 && csvLearned[b]) return csvLearned[b];
  return null;
}

function csvLearnFrom(c){
  if(!c || !c.categoryName || c.catSource !== 'user') return;
  var k = csvLearnKey(c);
  if(!k || k.length < 6) return;
  var base = csvLearnKeyBase(c);
  // Write both. The bare key is what makes the lesson carry to the same merchant
  // at a different size; the banded one keeps a deliberate per-size answer intact.
  var changed = false;
  if(csvLearned[k] !== c.categoryName){ csvLearned[k] = c.categoryName; changed = true; }
  if(base && base.length >= 6 && csvLearned[base] !== c.categoryName){ csvLearned[base] = c.categoryName; changed = true; }
  if(changed) csvLearnSave();
}

// Wipes what this device has learned -- a bad lesson shouldn't be permanent.
function csvLearnForget(){
  csvLearned = {};
  try{ localStorage.removeItem(FH_CSV_LEARNED); }catch(e){}
}

/* One candidate per data row. Never throws on a bad row -- flags it and
   moves on, so one malformed line can't abort the whole import.

   Category resolution tries three signals in confidence order: the file's
   own category column (exact after normalization), then the family's history
   (same description, previously categorized by a human), then guessCat()'s
   keyword matching (the same guesser bulk logging uses). All three only ever
   produce categories the family actually has, and a guess is never silently
   final -- it lands as a visible, tappable-to-change default on the review
   screen, which is the human gate before anything writes. */
function buildCsvCandidates(parsed, result) {
  var mapping = (result.llm && result.llm.column_mapping) || Object.keys(result.columnMap).map(function(i){
    return { column_index:+i, field:result.columnMap[i].field, confidence:result.columnMap[i].confidence };
  });
  // First-wins: a file can have two columns mapping to the same field (e.g.
  // "description" AND "note" are both description aliases) -- the earlier
  // column is the primary one; last-wins silently swapped every description
  // for the note text.
  var colFor = {};
  mapping.forEach(function(m){ if(colFor[m.field] === undefined) colFor[m.field] = m.column_index; });
  var convention = result.llm && result.llm.date_convention;
  var historyMap = csvHistoryCategoryMap();

  return parsed.rows.map(function(row, i) {
    var flags = [];
    var dateRaw = colFor.occurred_at !== undefined ? row[colFor.occurred_at] : '';
    var amtRaw = colFor.amount !== undefined ? row[colFor.amount] : '';
    var desc = colFor.description !== undefined ? (row[colFor.description] || '').trim() : '';
    var catGuess = colFor.category !== undefined ? (row[colFor.category] || '').trim() : '';

    var dclass = classifyDate(dateRaw);
    var date = dclass.status === 'matched' ? parseCsvDateValue(dateRaw, dclass.format, convention) : null;
    if (!date) flags.push('date_missing');

    /* A statement's credit column is money IN. This importer writes expenses
       only (transactions has no direction), so a credit row is held back for
       the person to look at rather than silently filed as spending -- the
       same rule the mixed-signs guard applies to a single signed column. */
    var creditRaw = colFor.credit !== undefined ? (row[colFor.credit] || '').trim() : '';
    var isIncome = false;
    if (creditRaw && classifyAmount(creditRaw).status === 'ok' && classifyAmount(creditRaw).value > 0
        && !(amtRaw && classifyAmount(amtRaw).status === 'ok' && classifyAmount(amtRaw).value > 0)) {
      isIncome = true;
      amtRaw = creditRaw;                       // show the real figure while it waits
    }
    /* Sổ-thu-chi apps put direction in the "category" column: Loại = Chi or
       Thu. Those words are an instruction, not a category -- turning them
       into categories gives the family a category literally named "Chi" and
       imports their salary as spending. Thu-side words mark income; chi-side
       words are consumed (the row's real category comes from the other
       tiers). */
    var dirWord = deburr((catGuess||'').trim().toLowerCase());
    if (/^(transfer_in|income|credit|thu nhap|tien vao|thu|khoan thu)$/.test(dirWord)) { isIncome = true; catGuess = ''; }
    else if (/^(expense|debit|chi|chi tieu|khoan chi|tien ra)$/.test(dirWord)) catGuess = '';
    /* Some exports put everything in one column, so the words have to carry
       it: a salary run, an incoming transfer, a refund or interest is money
       IN. Filing a salary as spending would corrupt the month badly, so this
       leans towards holding a row back for review rather than importing it. */
    if (!isIncome) {
      var dtext = deburr(String(desc || '').toLowerCase());
      if (/\b(thanh toan luong|tra luong|chi luong|luong thang|ck den|nhan tien|tien ve|hoan tien|lai suat|interest|salary|payroll|refund)\b/.test(dtext)) isIncome = true;
    }

    var aclass = classifyAmount(amtRaw);
    var amount = (aclass.status === 'ok') ? Math.abs(aclass.value) : null;
    if (amount === null) flags.push('amount_missing');

    if (!desc) flags.push('description_missing');
    if (isIncome) flags.push('income_row');

    /* Paying off your own credit card is money leaving the account, but it
       is not consumption -- the purchases it covers live on the CARD's
       statement, and a family importing both files would count the same
       month twice. Held out like income: named, totalled, one tap back in
       if the call is wrong. */
    var isTransfer = false;
    if (!isIncome) {
      var ttext = ' ' + deburr((desc || '').toLowerCase()) + ' ';
      if (/thanh toan (sao ke |du no )?the( tin dung)?|tt the tin dung|tra no the|thanh toan the (visa|master|jcb)|credit card payment|tra tien the tin dung/.test(ttext)) isTransfer = true;
    }

    var party = colFor.counterparty !== undefined ? (row[colFor.counterparty] || '').trim() : '';

    /* The file often records who paid, and the ledger has that field too --
       match it to a real member so nobody re-enters what the export knew.
       An unrecognised name falls back to the importer, never invents a member. */
    var paidRaw = colFor.paid_by !== undefined ? (row[colFor.paid_by] || '').trim() : '';
    var who = null;
    if (paidRaw) {
      var pn = deburr(paidRaw.toLowerCase());
      var mems = (window.FAM && window.FAM.members) || [];
      for (var mi = 0; mi < mems.length; mi++) {
        if (deburr(String(mems[mi].name).toLowerCase()) === pn) { who = mems[mi].name; break; }
      }
      if (!who && /^(chung|both|ca hai)$/.test(pn)) who = 'Both';
    }
    var catName = (isIncome || isTransfer) ? null : matchCategoryName(catGuess);
    var catSource = catName ? 'file' : null;
    /* History is keyed on what past transactions were CALLED (their note), so it
       only ever matched when the saved note happened to be the merchant. Rename a
       row on import — "Ăn trưa" instead of "REVI PHU MY HUNG TOWER" — and the
       category you just gave it could never be found again.
       The counterparty is the merchant stated plainly, so try it too. The note
       still wins: it is what the person chose to call this, and their own words
       are better evidence than the bank's. */
    if (!catName) {
      var h = (desc && historyMap[normDescForDedup(desc)])
           || (party && historyMap[normDescForDedup(party)]);
      if (h) { catName = h; catSource = 'history'; }
    }
    if (!catName) {
      var lc = csvLearnedCat({ counterparty: party, description: desc, amount: amount });
      if (lc && csvCatOk(lc)) { catName = lc; catSource = 'learned'; }
    }
    /* The MCC column, when a credit-card statement has one, is the cleanest
       signal in the whole file: "5411-Grocery Stores" is the network telling
       us the merchant's line of business. Only the leading code is read --
       the wording after the dash varies by bank. */
    if (!catName && colFor.mcc !== undefined && typeof familyCatForConcept === 'function') {
      var mccCode = String(row[colFor.mcc] || '').trim().slice(0, 4);
      var mccConcept = CSV_MCC_CONCEPT[mccCode];
      if (mccConcept) {
        var mfc = familyCatForConcept(mccConcept);
        if (mfc && csvCatOk(mfc)) { catName = mfc; catSource = 'merchant'; }
      }
    }
    /* Merchant names next -- and only THEN generic keywords. A brand is
       specific evidence; a keyword is a guess about vocabulary, and "COFFEE
       HOUSE" filed under Housing is what happens when the guess goes first. */
    if (!catName && desc && typeof familyCatForConcept === 'function') {
      // the counterparty column names the merchant plainly; the memo buries it
      var mc = csvMerchantConcept(party) || csvMerchantConcept(desc);
      if (mc) { var fc = familyCatForConcept(mc); if (fc && csvCatOk(fc)) { catName = fc; catSource = 'merchant'; } }
    }
    /* Least steps wins: if the file's own label, the family's history and the
       keyword guess all come up empty, file it under the catch-all rather
       than making someone tap a category for every row. It's disclosed in the
       summary and one tap on the row changes it -- an editable default beats
       a blocking question. */
    if (!catName && desc && typeof guessCat === 'function') {
      /* "Chuyển tiền cho X" is transfer phrasing, and after deburring, its
         "cho" (for) is the same word as "chợ" (market) -- which filed every
         P2P transfer under groceries. The phrase says nothing about what the
         money bought, so it is removed before the keyword pass reads it. */
      var g = guessCat(desc.replace(/chuy[eể\u1ec3\u00ea]n\s+(ti[eề\u1ec1\u00ea]n|kho[aả\u1ea3]n)\s+(cho|den|đến|toi|tới)\b/i, ' '));
      if (g && csvCatOk(g)) { catName = g; catSource = 'keyword'; }
    }
    if (!catName && !isIncome && csvCatOk(CAT_FALLBACK)) { catName = CAT_FALLBACK; catSource = 'fallback'; }
    if (!catName) flags.push('needs_category');

    return {
      rowIndex: i, raw: row, flags: flags,
      date: date, dateDisplay: date ? (date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')) : '',
      amount: amount, negative: aclass.status === 'ok' && String(amtRaw).trim().indexOf('-') === 0,
      description: desc || catGuess || L('(không có mô tả)','(no description)'),
      // Did this row actually SAY anything? The line above substitutes a
      // placeholder, and that placeholder is identical on every silent row —
      // which the duplicate check must not read as them all being the same thing.
      _hasDesc: !!(desc || catGuess),
      categoryGuess: catGuess, categoryName: catName, catSource: catSource,
      counterparty: party, who: who, isIncome: isIncome, isTransfer: isTransfer,
    };
  });
}

// A column that mixes signed and unsigned amounts is a real bank statement
// (income + expense together) -- this pass doesn't distinguish them, so
// every row gets deferred rather than silently filed as an expense.
/* One amount column carrying both signs means one of two conventions, and
   which one it is decides whether a row is money out or money in:

     A. negative = spending, positive = income   (most bank exports)
     B. positive = spending, negative = a refund (most budgeting apps)

   The tell is which sign is in the majority. A family spends many times a
   month and gets paid once or twice, so the dominant sign is the spending
   one and the rare sign is the exception. That reading also survives the
   awkward cases: an all-negative column is convention A at 100%, and a lone
   refund among fifty purchases is convention B.

   Only a genuinely even split is ambiguous -- with the signs near 50/50
   there's no majority to read, and guessing would silently mislabel half the
   file. That case still goes to review, which is where this used to send
   every mixed file regardless.

   Sign decides the file's CONVENTION. It does not decide what a row IS.
   A minus sign in a spending export means too many different things -- a
   refund, a correction, a bookkeeping habit, a hand-typed column -- to carry
   that weight alone. Calling those rows income labels real spending "Có thể
   là thu nhập" and drops it from the import, which is worse than the
   ambiguity it was resolving: the money was spent either way, and leaving it
   out understates the month. What a row IS comes from meaning -- a type
   column, a credit column, or wording that names it (lương, CK đến, hoàn
   tiền, salary, refund). */
var CSV_SIGN_MINORITY_MAX = 0.35;

function csvResolveSignMode(candidates) {
  var neg = 0, pos = 0;
  candidates.forEach(function(c){
    if (c.amount === null || c.isSummaryRow) return;
    if (c.negative) neg++; else pos++;
  });
  if (!neg || !pos) return 'none';                  // one sign only; nothing to resolve
  var total = neg + pos, minority = Math.min(neg, pos) / total;
  if (minority > CSV_SIGN_MINORITY_MAX) return 'ambiguous';
  return (neg > pos) ? 'neg_is_spend' : 'pos_is_spend';
}


/* Rows with nothing in them at all.

   Files arrive with spacer rows, and a bank statement's account header block
   (bank name, account number, the reporting period) parses as data because it
   sits above the real header row. None of it is a transaction, and none of it
   can be repaired -- there is no date to supply, no amount to correct. Putting
   those in front of someone as "Thiếu ngày" asks them to fix a row that was
   never theirs. Drop them, say how many, and move on. */
function csvDropBlankRows(candidates) {
  var kept = [], dropped = 0;
  candidates.forEach(function(c){
    /* No date AND no amount -- with or without text. A spacer row is empty;
       a statement's section banner ("Số thẻ/Số tài khoản 513892...") has
       words but is equally not a transaction, and "fixing" one would mean
       typing an entire transaction from scratch into a row the bank never
       meant as one. Both are structure, not data. */
    var blank = c.flags.indexOf('amount_missing') >= 0
             && c.flags.indexOf('date_missing') >= 0;
    if (blank) { dropped++; return; }
    kept.push(c);
  });
  return { kept: kept, dropped: dropped };
}

function normDescForDedup(s) { return deburr((s||'').trim().toLowerCase()).replace(/\s+/g,' '); }

/* One bank, many spellings. 'MB Bank', 'MBBank', 'MB' and 'NH TMCP Quan Doi'
   are the same institution, and the pipeline's dedup turns entirely on telling
   two providers apart -- so string equality collapsed two real transfers into
   one and hid a genuine 2.000đ row. This is the client-side twin of
   canonicalProvider() in pipeline/bank-email-pipeline.gs.

   Deliberate difference from the .gs twin: deburr also folds đ -> d, so 'Đông Á'
   canonicalises to 'donga' here and 'onga' there. Harmless, because neither side
   ever compares its names against the other's -- each only compares its own rows
   to its own rows, and both are internally consistent. Keep it that way: the
   moment one canonical form is stored and read by the other, they must merge. */
var CSV_PROVIDER_NOISE = ['internetbanking', 'mobilebanking', 'onlinebanking', 'smartbanking',
                          'ebanking', 'digibank', 'banking', 'ebank', 'bank', 'jsc'];

function csvCanonicalProvider(name) {
  if (!name) return '';
  var s = deburr(String(name)).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Longest first: strip 'ebanking' before 'banking' can leave a stray 'e'.
  for (var i = 0; i < CSV_PROVIDER_NOISE.length; i++) s = s.split(CSV_PROVIDER_NOISE[i]).join('');
  return s;
}

/* Cross-source dedup, client side. One purchase can be reported twice -- the
   bank emails a debit, the merchant emails a receipt -- and the two share only
   an amount. They will NOT share a description, which is exactly why the
   description-keyed in-batch check above cannot see them, and why the pipeline
   computes duplicate_of_id at all.

   The client can run the same rule, and with better evidence: it holds the
   DECRYPTED amount plus source_provider (never sealed, because a hash matches
   only exactly and bank names need fuzzy matching). What it adds over the
   pipeline is timing -- it runs in front of the person who made the purchase,
   every time the screen opens, so a wrong guess costs one tap instead of
   silently deleting a row.

   Same-provider pairs are NEVER duplicates: a bank does not report one debit
   twice, so two MB emails are two real transactions. Unknown on either side
   refuses to guess, for the reason the pipeline gives and this screen exists to
   honour -- a missed duplicate costs one tap to skip; a false one hides real
   money behind a decision nobody asked for. */
function csvStagedCrossSourceDup(c, provider, currency, kind, priors) {
  var mine = csvCanonicalProvider(provider);
  if (!mine || !c.date) return null;
  var cur = (currency || '').toUpperCase();
  for (var i = 0; i < priors.length; i++) {
    var p = priors[i];
    if (!p.provider || !p.c.date) continue;
    if (p.provider === mine) continue;                       // same bank -> two real transactions
    // Two DIFFERENT banks are also two real transactions: each sees only its own
    // account, so equal amounts are a coincidence, not one event twice. The real
    // duplicate is a bank plus a non-bank reporting one swipe.
    if (kind === 'bank' && p.kind === 'bank') continue;
    // Currency before amount: dedup_fp hashes 'amount|direction|currency', and
    // comparing the number alone made 200 USD and 200 VND one event. Direction
    // needs no check here -- credits are deferred out before this runs.
    if (p.currency !== cur) continue;
    if (Math.abs(Number(p.c.amount) - Number(c.amount)) >= 1) continue;
    if (Math.abs(p.c.date.getTime() - c.date.getTime()) / 86400000 > 3) continue;
    return p.c;
  }
  return null;
}

/* Buckets: ready / needsCategory (grouped by merchant) / possibleDuplicate /
   deferred. Self-dedup and cross-source dedup both happen here, before
   bucketing, so a row can't land in "ready" while also being a duplicate. */
function bucketCsvCandidates(candidates, mixedSigns) {
  var seen = {}; // normDesc+amount -> first candidate seen
  var existingTxns = window.txns || [];
  var staged = !!window.csvStagedMode;
  var priors = [];   // staged rows already bucketed, for the cross-source check

  var ready = [], needsCategoryGroups = {}, possibleDuplicate = [], deferred = [];

  candidates.forEach(function(c) {
    if (mixedSigns || c.isIncome || c.isTransfer || c.flags.indexOf('date_missing') >= 0 || c.flags.indexOf('amount_missing') >= 0) {
      deferred.push(c); return;
    }

    /* Within one file, the same description and amount on the SAME DAY is a
       double entry. On different days it's a habit -- the same coffee at the
       same place three times a month is the most ordinary row a Vietnamese
       spending file contains, and flagging those as duplicates buries real
       spending under a decision nobody should have to make. The date is what
       separates the two, so it belongs in the key. */
    /* Identify the row by what it says, or failing that by who it was with. A
       p2p transfer deliberately has NO description (72-txn-review: a pre-filled
       wrong answer is worse than a blank field), and the blank is then replaced
       by a placeholder that reads the same on every such row. Keyed on that, two
       unrelated transfers of the same amount on the same day looked like one
       entry made twice, and the second was hidden in the duplicates section.

       With neither a description nor a counterparty there is nothing to compare,
       so the row is simply not deduped. A missed duplicate costs one tap to skip;
       a false one hides a real transaction behind a decision nobody asked for. */
    var ident = (c._hasDesc ? normDescForDedup(c.description) : '') ||
                normDescForDedup(c.counterparty || '');
    if (ident) {
      var key = ident + '|' + c.amount + '|' + (c.dateDisplay || '');
      if (seen[key]) { c.duplicateOfBatch = true; possibleDuplicate.push(c); return; }
      seen[key] = c;
    }
    // No identity: skip the in-batch check ONLY. The row still goes through the
    // cross-match against the ledger and the needs-a-category grouping below —
    // returning early here would file an uncategorised row straight into ready.

    var crossMatch = existingTxns.find(function(t) {
      if (!t._d || !c.date) return false;
      var daysApart = Math.abs(t._d.getTime() - c.date.getTime()) / 86400000;
      return daysApart <= 3 && Math.abs(Number(t.amt) - c.amount) < 1;
    });
    if (crossMatch) { c.duplicateOfExisting = crossMatch; possibleDuplicate.push(c); return; }

    /* Staged email rows only, and last, so the most concrete reason wins: a
       match against a transaction already in the ledger beats a suspicion about
       another email in the same queue. */
    if (staged) {
      var meta = window.fhStagedMeta && window.fhStagedMeta(c.rowIndex);
      var provider = (meta && meta.provider) || '';

      /* The pipeline's verdict, demoted from delete order to suspicion. It sees
         a pair this screen cannot -- two unreviewed emails, same amount,
         different wording -- so the detection is kept. What it no longer gets
         is the power to act alone. */
      var currency = (meta && meta.currency) || '';
      var kind = (meta && meta.kind) || '';
      var prior = { c: c, provider: csvCanonicalProvider(provider), currency: currency, kind: kind };

      /* The pipeline cannot read transaction_type on the rows it compares (they
         are sealed), so it flags bank-vs-bank pairs it has no way to rule out.
         The screen can read both, so it drops a suspicion it can PROVE wrong
         rather than passing the tap on to a person. Only when both kinds are
         known: an unknown kind leaves the flag standing. */
      if (meta && meta.pipelineDup) {
        var matchedKind = window.fhStagedKindById && window.fhStagedKindById(meta.dupOfId);
        if (!(kind === 'bank' && matchedKind === 'bank')) {
          c.duplicateOfPipeline = true; possibleDuplicate.push(c);
          priors.push(prior);
          return;
        }
        c.pipelineDupOverruled = true;   // two banks; falls through to the normal path
      }

      var sourceMatch = csvStagedCrossSourceDup(c, provider, currency, kind, priors);
      priors.push(prior);
      if (sourceMatch) { c.duplicateOfSource = sourceMatch; possibleDuplicate.push(c); return; }
    }

    if (!c.categoryName) {
      var gkey = normDescForDedup(c.description);
      (needsCategoryGroups[gkey] = needsCategoryGroups[gkey] || []).push(c);
      return;
    }

    ready.push(c);
  });

  return { ready: ready, needsCategoryGroups: needsCategoryGroups, possibleDuplicate: possibleDuplicate, deferred: deferred };
}
