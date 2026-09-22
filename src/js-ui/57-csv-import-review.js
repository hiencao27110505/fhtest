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

/* A memo shaped "X chuyển tiền đến X" — the SAME name on both sides — is a move
   between the person's own accounts, not a card payment. The pipeline can only
   call it flow:'transfer' (money left the account); it can't know the two ends
   are the same person, but the memo does. Detecting it lets the review default
   to an internal transfer (which asks "to which account") instead of a card
   payment (which asks "which card") for exactly the case where "which card" is
   the wrong question. Conservative on purpose: only fires when both name halves
   match after stripping account numbers, so a false miss (stays card payment) is
   the failure mode, never a false self-transfer. */
function _isSelfTransfer(memo) {
  var m = deburr(String(memo || '').toLowerCase());
  var mm = m.match(/(.+?)\s+chuyen\s+(?:tien|khoan)\s+(?:den|toi|cho|sang)\s+(.+)/);
  if (!mm) return false;
  var norm = function (s) {
    return s.replace(/\s*[-–:].*$/, '')     // drop a "- 1046382279" account tail
            .replace(/\d+/g, ' ')
            .replace(/[^a-z ]+/g, ' ')
            .replace(/\s+/g, ' ').trim();
  };
  var a = norm(mm[1]), b = norm(mm[2]);
  return a.length >= 6 && a === b;
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

/* Merchant → concept. Matched as a deburred SUBSTRING (see csvMerchantConcept),
   first hit wins in array order, so tokens must stay distinctive — short/generic
   or person-name-like strings (e.g. "tien phong" = TPBank, "tam anh" a person)
   are deliberately left out to avoid false positives. Vietnam brands enriched
   2026-09-05; Groceries covers the supermarket + minimart + convenience field. */
var CSV_MERCHANTS = [
  ['Transport', ['grab','grabbike','grabcar','grab bike','grab car','gojek','be group','beamin','baemin','xanh sm','vinasun','mai linh','g7 taxi','taxi group','taxi','uber','vato','lado','emddi','xe om','petrolimex','pvoil','pv oil','xang dau','xang','shell','caltex','idemitsu','mipec','vetc','epass','parking','giu xe','gui xe','bai xe','iparking','cao toc','tram thu phi']],
  ['Dining',    ['highlands','phuc long','trung nguyen','trung nguyen legend','katinat','the coffee house','tch','starbucks','passio','cong caphe','cong ca phe','guta','milano','aha cafe','ong bau','napoli','laha','la viet','phindeli','coffee','cafe','ca phe','koi the','bobapop','ding tea','toco toco','tocotoco','phuc tea','phe la','tiger sugar','the alley','royaltea','goky','maycha','tealive','tra sua','gong cha','mixue','kfc','lotteria','jollibee','mcdonald','burger king','burger','pizza hut','pizza 4ps','4ps','the pizza company','pizza','domino','texas chicken','popeyes','bbq chicken','king bbq','gogi','sumo bbq','manwah','kichi kichi','dookki','pho 24','pho24','pho ','bun','bun cha','com tam','com ga','banh mi','sushi','bbq','lau','nuong','hai san','buffet','nha hang','restaurant','golden gate','redsun','shopeefood','grabfood','befood','now.vn','beefood','foody','loship']],
  ['Groceries', ['quick save','minimart','mini mart','tap hoa','bach hoa','bach hoa xanh','bhx','winmart','win mart','wincommerce','vinmart','vincommerce','coopmart','co.opmart','co opmart','coop food','coop xtra','coopxtra','coop smile','coopsmile','finelife','co.op','big c','bigc','go bigc','go mall','tops market','emart','aeon','aeon maxvalu','maxvalu','aeon citimart','citimart','mega market','mm mega','metro','lotte mart','lottemart','satra','satrafoods','satramart','lan chi','lanchi','kingfoodmart','king food','fujimart','fuji mart','brgmart','brg mart','hapromart','hapro','intimex','fivimart','seika mart','nutrimart','nam an market','annam','annam gourmet','kmarket','k-market','soi bien','bac tom','circle k','circlek','gs25','familymart','family mart','ministop','7-eleven','7eleven','cheers','bsmart','b s mart','sieu thi','cua hang tien loi','thuc pham','farmers market']],
  ['Housing',   ['evn','dien luc','evnhcmc','evn hanoi','sawaco','cap nuoc','nuoc sach','hawacom','tien dien','tien nuoc','fpt telecom','viettel','vnpt','vinaphone','mobifone','internet','vtvcab','sctv','truyen hinh cap','tien nha','thue nha','chung cu','ban quan ly','quan ly toa nha','phi quan ly','phi dich vu','phi chung cu','vinhomes','masterise','pccc','gas','pgas','petrolgas','petrolimex gas','saigon petro','binh gas','total gas','elf gas','sua chua','dien nuoc','ve sinh','giup viec','btaskee']],
  ['Fun',       ['cgv','lotte cinema','bhd star','galaxy cinema','beta cinema','cinestar','mega gs','dcine','rap phim','netflix','spotify','youtube premium','youtube','fpt play','galaxy play','vieon','danet','k+','disney','hbo','apple music','apple tv','zing mp3','nhaccuatui','steam','playstation','psn','nintendo','garena','vng','riot','lien quan','gym','california fitness','citigym','fit24','elite fitness','the new gym','kingsport','curves','yoga','kara','karaoke','icool','nnice','massage','spa','nail','du lich','booking.com','agoda','traveloka','klook','trip.com','expedia','vietravel','saigontourist','mytour','luxstay','airbnb','vinpearl','muong thanh','vietjet','vietnam airlines','bamboo airways','pacific airlines','vexere','ve may bay','ve tau','ticketbox','concert']],
  ['Shopping',  ['crescent mall','vincom','parkson','takashimaya','saigon centre','saigon center','gigamall','van hanh mall','estella place','estella','vivocity','diamond plaza','aeon mall','the loop','shopee','lazada','tiki','sendo','tiktok shop','tiktokshop','chotot','amazon','apple.com','itunes','icloud','google','play store','uniqlo','zara','h&m','muji','decathlon','canifa','ivy moda','routine','coolmate','juno','vascara','the north face','adidas','nike','yody','gumac','elise','blue exchange','ninomaxx','hasaki','the face shop','innisfree','sociolla','sephora','cocoon','nguyen kim','dien may xanh','dienmayxanh','the gioi di dong','thegioididong','tgdd','dmx','fpt shop','cellphones','hoang ha mobile','di dong viet','phong vu','gearvn','mediamart','pico','fahasa','nha sach','phuong nam book']],
  ['Others',    ['pharmacity','long chau','an khang','trung son','phano','eco pharma','medicare','matsumoto','guardian','watsons','nha thuoc','benh vien','phong kham','vinmec','medlatec','hoan my','fv hospital','columbia asia','cho ray','nhi dong','da khoa','xet nghiem','nha khoa','rang ham mat','kham benh','bao hiem','insurance','prudential','manulife','bao viet','dai-ichi','daiichi','fwd','generali','apollo','vus','yola','wall street english','hoc phi','tuition','truong','hoc vien','udemy','coursera','kyna','ghn','ghtk','ninja van','spx','viettel post','vnpost','buu dien','giao hang nhanh','giao hang tiet kiem']],
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
var CSV_GATEWAYS = /\b(payoo|mpos|vnpay|onepay|napas|ecpay|appota|zalopay|shopeepay|viettelpay|smartpay|nganluong|baokim|revi)\b/g;

function csvPatternKey(c) {
  var base = (c.counterparty || c.description || '');
  return deburr(String(base).toLowerCase())
    .replace(CSV_BANK_NOISE, ' ')
    .replace(CSV_GATEWAYS, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 40);
}

/* The correction sync key (#3). This is NOT csvPatternKey — it must reproduce the
   server's merchantKey() in classify.mjs byte-for-byte, because the sha256 of this
   string is the only thing the mailbox worker can match a taught merchant on. KEEP
   THE TWO IN LOCKSTEP: the deburr → lowercase → strip-punct → gateways → bank-noise
   → drop-4+-digits → slice(40) sequence, and the two word lists, are shared law. */
var FH_GATEWAYS = /\b(payoo|mpos|vnpay|onepay|napas|ecpay|appota|zalopay|shopeepay|viettelpay|smartpay|nganluong|baokim|revi)\b/g;
var FH_BANK_NOISE = /\b(customer|khach hang|thanh toan|chuyen tien|thanh toan qr|qr|pos|atm|ck|tt|nd|gd|ref|trace|mbvcb|mbct|vcb|tcb|acb|bidv|vietinbank|agribank|ib|ibft|ft)\b/g;
function fhMerchantKey(counterparty, memo) {
  var t = deburr(String(counterparty || '') + ' ' + String(memo || ''))
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(FH_GATEWAYS, ' ').replace(FH_BANK_NOISE, ' ').replace(/[0-9]{4,}/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 40).trim();
}
function fhSha256Hex(s) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}

/* Push a taught merchant→concept up so the NOTIFICATION side can voice it too
   (the in-app category already learns locally via csvLearned). Privacy: only the
   hashed key and one of the 8 concept labels leave the device — never the merchant
   name. Fire-and-forget: a failed sync just means the lesson stays device-local,
   exactly as before this existed. */
function fhSyncMerchantCorrection(c) {
  try {
    if (typeof sb === 'undefined' || !sb || !window.fhUser || !window.fhUser.id) return;
    if (!crypto || !crypto.subtle) return;
    var concept = (typeof conceptFromNote === 'function') ? conceptFromNote(c.categoryName || '') : '';
    if (!concept || CONCEPT_ORDER.indexOf(concept) < 0) return;   // only the shared 8 concepts sync
    var key = fhMerchantKey(c.counterparty || c.description, c.description);
    if (!key || key.length < 2) return;
    fhSha256Hex(key).then(function (hash) {
      sb.from('merchant_corrections').upsert({
        owner_user_id: window.fhUser.id,
        merchant_hash: hash,
        concept: concept,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_user_id,merchant_hash' }).then(function () {}, function () {});
    }, function () {});
  } catch (e) { /* the correction still lives locally; the sync is a bonus */ }
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

/* Synced-lessons bridge (0122): the encrypted personal_lessons blob mirrors
   these category lessons so they survive a device change. localStorage stays
   the fast cache + the offline/locked fallback; the blob is the durable copy. */
window.csvLearnedExport = function(){ return csvLearned; };
window.csvLearnedMergeIn = function(map){
  var changed = false;
  for (var k in (map||{})) if (csvLearned[k] === undefined) { csvLearned[k] = map[k]; changed = true; }
  if (changed) csvLearnSave();
};
function csvLearnSave(){
  try{
    if (window.fhLessonsCatChanged) { try{ fhLessonsCatChanged(csvLearned); }catch(e){} }
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
  if(changed){ csvLearnSave(); if(typeof fhSyncMerchantCorrection === 'function') fhSyncMerchantCorrection(c); }
}

// Wipes what this device has learned -- a bad lesson shouldn't be permanent.
function csvLearnForget(){
  csvLearned = {};
  try{ localStorage.removeItem(FH_CSV_LEARNED); }catch(e){}
  if (window.fhLessonsCatChanged) { try{ fhLessonsCatChanged({}); }catch(e){} }
}

/* ═══ The lending pass (0122, lending-capture-spec §2) ═══════════════════════
   Runs over the FULL candidate set after categories resolve, staged mode only,
   and only while the personal ledger is unlocked (a loan can only ever land in
   the personal book, so with it locked there is nothing safe to pre-select).

   Strict precedence, most-certain first (spec Q15):
     1. already classified (transfer pair / card payment / internal move) — the
        pass never touches those rows;
     2. beneficiary matches a person YOU OWE → pre-select 🤝 Trả nợ. This
        doubles as the veto: a loan lesson must never fire on a transfer to a
        creditor — that would GROW a fake receivable while the real payable
        sits untouched, the worst possible misread;
     3. an opposite-direction candidate with the same amount within ±1.5 days
        exists in this batch → likely an own-account transfer pair the matcher
        will propose — the loan lesson stands down;
     4. the banded kind lesson (fhKindLesson) → pre-select 🤝 Cho vay;
   and on the money-IN side: sender matches a person who OWES YOU → pre-select
   🤝 Thu nợ + the person (the matcher the borrowing-lending spec promised).
   Everything here is a PRE-SELECT — rows still pass the human gate; nothing
   auto-imports. */
function _debtNorm(s){
  return (typeof deburr==='function' ? deburr(String(s||'').toLowerCase()) : String(s||'').toLowerCase())
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
/* Whole-phrase containment with word boundaries: "nguyen van minh" inside
   "nguyen van minh chuyen tien" hits; "minh" inside "minh chau store" also
   hits — accepted, because the people list is tiny (only open balances) and
   this only ever pre-selects. Names under 4 letters never match. */
function _debtNameHit(list, text){
  var nt = ' ' + _debtNorm(text) + ' ';
  for (var i=0;i<list.length;i++){
    var nw = _debtNorm(list[i].who);
    if (nw.length >= 4 && nt.indexOf(' ' + nw + ' ') >= 0) return list[i];
  }
  return null;
}
function _lendClearCat(c){
  c.categoryName = null; c.catSource = null;
  var i = c.flags ? c.flags.indexOf('needs_category') : -1;
  if (i >= 0) c.flags.splice(i, 1);
}
function csvLendingPass(candidates){
  if (!window.csvStagedMode) return;
  if (typeof csvScopeReady === 'function' && !csvScopeReady()) return;
  var pd = window.fhPersonalDebts ? fhPersonalDebts() : null;
  var people = (pd && pd.people) || [];
  var iOwe = people.filter(function(p){ return p.balance < -0.5; });
  var oweMe = people.filter(function(p){ return p.balance > 0.5; });
  var haveLessons = !!window.fhKindLesson;
  if (!iOwe.length && !oweMe.length && !haveLessons) return;
  candidates.forEach(function(c){
    if (c.isTransfer || c._xfer || c._repay || c._loan || c._invest || c.amount == null) return;
    if (c._sigHold) return;   // a v2 signal already decided this row (email-reading-v2-spec §9: it outranks this pass)
    var text = (c.counterparty || '') + ' ' + (c.description || '');
    if (c.isIncome){
      var owed = _debtNameHit(oweMe, text);
      if (owed){ c._repay = true; c._repayWho = owed.who; c._scope = 'personal'; c._lessonWhy = 'owed'; return; }
      /* remembered OTC counterparty sending money back → Bán đầu tư
         (0123, investment-spec I9). Pre-select only, human gate stands. */
      var vpos = window.fhInvMemoryMatch ? fhInvMemoryMatch(c.counterparty || c.description) : null;
      if (vpos){ c._invest = true; c._investPosId = vpos; c._scope = 'personal'; c._lessonWhy = 'invest'; }
      return;
    }
    var owe = _debtNameHit(iOwe, text);
    if (owe){ c._repay = true; c._repayWho = owe.who; c._scope = 'personal'; c._lessonWhy = 'owe'; _lendClearCat(c); return; }
    /* pair-shaped? both legs of an own-account move in the same batch — the
       transfer matcher's territory, not a loan (spec Q15 precedence) */
    var paired = candidates.some(function(o){
      return o !== c && o.isIncome && o.amount === c.amount && o.date && c.date
        && Math.abs(o.date.getTime() - c.date.getTime()) <= 1.5 * 86400000;
    });
    if (paired) return;
    /* remembered OTC seller → Đầu tư + the position, ahead of the loan
       lesson: an explicit seller→position mapping the person committed once
       is more specific than a banded kind lesson (investment-spec I9). */
    var ipos = window.fhInvMemoryMatch ? fhInvMemoryMatch(c.counterparty || c.description) : null;
    if (ipos){
      c._invest = true; c._investPosId = ipos; c._scope = 'personal';
      c._lessonWhy = 'invest';
      _lendClearCat(c);
      return;
    }
    var key = (typeof csvLearnKey === 'function') ? csvLearnKey(c) : '';
    var lesson = (key && haveLessons) ? fhKindLesson(key) : null;
    if (lesson){
      c._loan = true; c._loanWho = lesson.who; c._scope = 'personal';
      c._lessonWhy = 'learned'; c._lessonKey = key;
      _lendClearCat(c);
    }
  });
}

/* ═══ payload v2: from a signal to a pre-selected kind ════════════════════════
   (email-reading-v2-spec §5, §9.) A v2 mail arrives with a `signal`: what the
   mail ITSELF can say about the movement ("this is a card repayment", "this is
   payroll"). The server cannot know the rest: a transfer is "the other side is
   YOUR account", a repayment is "the card is YOURS". That half is only on this
   device, so the kind is decided here.

   FH_SIGNALS mirrors SIGNALS in supabase/functions/_shared/mailbox/contract.mjs,
   the single source of truth. This file cannot import it (single-file PWA), so
   tools/payload-v2-contract.test.js compares the two and fails when they drift.
   `proposes` speaks csvRowKindCur's vocabulary; `node` is the one taxonomy code
   a signal maps to, or null when the mail's own words or the merchant decide. */
var FH_SIGNALS = {
  purchase:          { proposes: 'expense', node: null },
  bill_payment:      { proposes: 'expense', node: null },
  fee:               { proposes: 'expense', node: null },
  p2p:               { proposes: null,      node: null },
  own_transfer:      { proposes: 'xfer',    node: 'bankbank' },
  card_repayment:    { proposes: 'cardpay', node: 'cardpay' },
  wallet_move:       { proposes: 'xfer',    node: 'wallet' },
  cash_move:         { proposes: 'xfer',    node: null },
  savings_move:      { proposes: 'xfer',    node: null },
  broker_funding:    { proposes: 'xfer',    node: 'investfund' },
  fx_exchange:       { proposes: 'xfer',    node: 'fx' },
  securities_trade:  { proposes: 'invest',  node: null },
  yield:             { proposes: 'income',  node: null },
  salary:            { proposes: 'income',  node: 'wage' },
  refund:            { proposes: 'income',  node: null },
  loan_disbursement: { proposes: 'loan',    node: null },
  installment:       { proposes: 'repay',   node: 'pay' }
};
/* Mail that moves no money (spec §6). Never a review card: see fhNoticesApply. */
var FH_NOTICE_SIGNALS = ['card_due', 'installment_due', 'statement_ready'];
/* Which taxonomy kind a review kind files under (the tree and the ledger share
   the six kind names). */
var FH_KIND_NODEKIND = { expense: 'expense', income: 'income', xfer: 'transfer', cardpay: 'transfer',
                         invest: 'investment', loan: 'loan', repay: 'repayment' };

function fhIsV2(x){ return !!(x && Number(x.v) >= 2); }
function _sigTail(s){ return String(s == null ? '' : s).replace(/\D/g, '').slice(-4); }
/* Where a field's value came from, off the payload's `src` map. A block field is
   looked up as 'investment.symbol' and then as its block, 'investment'. */
function fhSrcOf(x, field){
  var m = x && x.src;
  if (!m || typeof m !== 'object') return null;
  if (m[field]) return m[field];
  var dot = String(field).indexOf('.');
  return dot > 0 ? (m[String(field).slice(0, dot)] || null) : null;
}
/* Provenance decides WHERE a row shows, never WHETHER it imports (spec §3).
   A judgment ('model') or a guess ('heuristic') under any of `fields` sends the
   row to "Cần bạn xem". A field with no recorded source says nothing either
   way: a v1 row has no `src` at all and sits where it always sat. */
function fhSrcWeak(x, fields){
  for (var i = 0; i < (fields || []).length; i++) {
    var s = fhSrcOf(x, fields[i]);
    if (s === 'model' || s === 'heuristic') return true;
  }
  return false;
}
/* What the person owns, read once per build: accounts (cards, deposits,
   wallets, positions) and the people with an open balance. */
function fhSignalOwn(){
  var pd = window.fhPersonalData ? fhPersonalData() : null;
  var debts = null;
  try { debts = window.fhPersonalDebts ? fhPersonalDebts() : null; } catch (e) {}
  return { ready: (typeof csvScopeReady === 'function') ? csvScopeReady() : !!(pd && pd.key),
           accounts: (pd && pd.accounts) || [], people: (debts && debts.people) || [] };
}
/* Has the person already taught something about this payee? A lesson comes from
   an explicit pick, and an explicit pick outranks everything the mail can say. */
function fhSignalLessonHit(c){
  try {
    if (!c.isIncome && window.fhKindLesson && typeof csvLearnKey === 'function') {
      var k = csvLearnKey(c);
      if (k && fhKindLesson(k)) return true;
    }
    if (window.fhInvMemoryMatch && fhInvMemoryMatch(c.counterparty || c.description)) return true;
  } catch (e) {}
  return false;
}
/* The counterpart of a transfer among the accounts the person owns. An exact
   key first (the printed account tail); then, weaker, the named bank or wallet
   when the person has exactly ONE account there. Never the row's own
   instrument, never a card (that is a repayment), never a position. */
function _sigCounterpart(x, own, acct){
  var mine = acct || {};
  var pool = (own.accounts || []).filter(function (a) {
    if (a.kind === 'credit_card' || a.kind === 'investment') return false;
    if (mine.tail && a.tail === mine.tail && csvCanonicalProvider(a.provider) === csvCanonicalProvider(mine.provider)) return false;
    return true;
  });
  var tail = _sigTail(x.counterparty_account_tail);
  var bank = csvCanonicalProvider(x.counterparty_bank || '');
  if (tail.length === 4) {
    var hits = pool.filter(function (a) { return (a.tail || '') === tail; });
    if (hits.length > 1 && bank) hits = hits.filter(function (a) { return csvCanonicalProvider(a.provider) === bank; });
    if (hits.length === 1) return { id: hits[0].id, exact: true };
    if (hits.length > 1) return null;                 // two accounts share the tail: not ours to pick
  }
  var name = bank;
  if (!name && (x.signal === 'wallet_move' || x.counterparty_kind === 'wallet')) {
    var w = csvCanonicalProvider(x.counterparty_raw || x.counterparty || '').match(/momo|zalopay|shopeepay|viettelmoney/);
    name = w ? w[0] : '';
  }
  if (!name) return null;
  var byName = pool.filter(function (a) { return csvCanonicalProvider(a.provider) === name; });
  return byName.length === 1 ? { id: byName[0].id, exact: false } : null;
}
/* THE precedence (spec §9), first match wins. One function for the full review
   and the quick sheet, so the two can never propose different kinds for one row.

     1. the person's explicit pick, or a lesson learned from one
     2. a signal PLUS a matching thing the person owns
     3. a signal alone: the kind is proposed, the missing half rests unset
     4. the lending pass, with its veto rules (lending-capture-spec Q15)
     5. direction alone

   Returns NULL when the signal has nothing to add, and the caller then runs
   exactly what it ran before v2 existed. That covers: every v1 row; a v2 row
   whose signal is null or unknown to this build (a v2 row the server could not
   classify is never worse off than a v1 row); a row a lesson already answers
   (1: the lesson is applied where it always was, by the lending pass, vetoes
   and all); a signal the row's own direction contradicts; a personal-only kind
   while the personal ledger is locked.

   Otherwise { kind, tier, hold, weak, node, ...the pre-filled half }:
     hold  the lending pass stands down (2 and 3 outrank 4). False for `p2p`,
           which proposes nothing and is the pass's own territory.
     weak  the pre-selection rests on a judgment or a guess, so the row is shown
           in "Cần bạn xem". It still imports like any other row.

   row: { x, direction, counterparty, description, amount, acct, provider }
   own: fhSignalOwn() plus, optionally, lesson (bool) and cardFor (function). */
function fhKindFromSignal(row, own){
  var x = row && row.x;
  if (!fhIsV2(x) || !x.signal) return null;
  var sig = FH_SIGNALS.hasOwnProperty(x.signal) ? FH_SIGNALS[x.signal] : null;
  if (!sig) return null;                              // a notice, or a signal newer than this build
  own = own || {};
  var credit = row.direction === 'credit';
  if (row.direction !== 'credit' && row.direction !== 'debit') return null;
  if (own.lesson) return null;                        // 1
  /* E7: a card number is not proof of a repayment. The server already requires
     that the mail names no merchant; if its own two statements disagree, the
     signal is not trusted and the row is read the old way. */
  if (x.signal === 'card_repayment' && x.counterparty_kind === 'merchant') return null;

  var kind = sig.proposes;
  var out = { signal: x.signal, tier: 3, hold: true, weak: false, node: sig.node || null };
  /* What the pre-selection RESTS on, for placement. Chi tiêu for a debit and Thu
     nhập for a credit rest on the direction, which the mail printed, so a
     guessed `purchase` does not send every purchase to "Cần bạn xem" (the
     server's signal detector reads free text, so most signals arrive as
     'heuristic'). A kind the direction alone would NOT have given (a transfer,
     a repayment, a loan, an investment) rests on the signal itself. */
  var basis = (kind === 'expense' || kind === 'income' || !kind) ? [] : ['signal'];
  if (x.signal === 'cash_move') out.node = credit ? 'cashin' : 'cashout';

  if (!kind) {                                        // p2p: direction decides, the lending pass may override
    out.kind = credit ? 'income' : 'expense'; out.tier = 5; out.hold = false;
    return out;
  }
  if ((kind === 'expense' && credit) || (kind === 'income' && !credit)) return null;
  if ((kind === 'loan' || kind === 'repay' || kind === 'invest') && !own.ready) return null;
  out.kind = kind;

  if (kind === 'income') {
    var cats = (typeof FH_INCOME_CATS !== 'undefined') ? FH_INCOME_CATS : [];
    out.incomeCat = x.signal === 'salary' ? 'Lương'
      : x.signal === 'refund' ? 'Hoàn tiền'
      : (x.signal === 'yield' && cats.indexOf('Lãi đầu tư') >= 0) ? 'Lãi đầu tư' : 'Khác';
  } else if (kind === 'cardpay') {
    var cardId = null;
    if (typeof own.cardFor === 'function') { try { cardId = own.cardFor() || null; } catch (e) { cardId = null; } }
    else {
      var ct = _sigTail(x.card_masked);
      var cards = (own.accounts || []).filter(function (a) { return a.kind === 'credit_card' && ct && (a.tail || '') === ct; });
      if (cards.length === 1) cardId = cards[0].id;
    }
    if (cardId) { out.cardId = cardId; out.tier = 2; if (x.card_masked) basis.push('card_masked'); }
  } else if (kind === 'xfer') {
    if (x.signal === 'cash_move') { out.otherId = '_cash'; out.tier = 2; }
    else {
      var cp = _sigCounterpart(x, own, row.acct);
      if (cp) {
        out.otherId = cp.id; out.tier = 2;
        if (cp.exact) basis.push('counterparty_account_tail'); else out.weak = true;
      }
    }
  } else if (kind === 'invest') {
    var inv = (x.investment && typeof x.investment === 'object') ? x.investment : {};
    var sym = String(inv.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (sym) {
      var pos = (own.accounts || []).filter(function (a) {
        return a.kind === 'investment' && String(a.assetSymbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === sym;
      });
      if (pos.length === 1) { out.posId = pos[0].id; out.tier = 2; basis.push('investment.symbol'); }
    }
    var q = Number(inv.quantity);
    if (q > 0 && isFinite(q)) { out.qty = q; basis.push('investment.quantity'); }
  } else if (kind === 'loan' || kind === 'repay') {
    /* Money IN from a lender opens (or deepens) what the person owes; an
       instalment going OUT draws it down. Anything else is not this shape. */
    if ((kind === 'loan') !== credit) return null;
    var text = (row.counterparty || '') + ' ' + (row.description || '');
    var owe = _debtNameHit((own.people || []).filter(function (p) { return p.balance < -0.5; }), text);
    if (owe) { out.who = owe.who; out.tier = 2; out.weak = true; }   // a name match is a guess: it may flag, never block
    else if (kind === 'loan') {
      /* No balance to match: the lender named by the mail is the same one-tap
         default csvPickRowKind gives a hand-picked loan. */
      out.who = String(row.counterparty || '').trim()
        || ((typeof fhProviderName === 'function') ? fhProviderName(row.provider || '') : '') || null;
    }
    var due = x.loan && typeof x.loan === 'object' ? String(x.loan.due_date || '') : '';
    if (kind === 'loan' && /^\d{4}-\d{2}-\d{2}$/.test(due)) { out.due = due; basis.push('loan.due_date'); }
  }
  if (fhSrcWeak(x, basis)) out.weak = true;
  return out;
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
  /* 0144 — the same idea one layer down: what NODE did a human-categorised row
     with this wording end up on? Built from the ledger the person already has,
     so the second Highlands charge inherits the first one's leaf. */
  /* The legacy 8 concepts are exactly one group's worth of confidence, so each
     maps to the tree GROUP that carries it — never to a leaf. This is how a
     pipeline row sealed before the tree existed (or by an older worker) still
     lands somewhere true. Kept here rather than in the taxonomy file because it
     describes the OLD vocabulary, which the tree is replacing. */
  var CONCEPT_TREE_GROUP = { Housing: 'home', Groceries: 'groceries', Clothing: 'clothing',
    Shopping: 'shopping', Transport: 'transport', Dining: 'food', Fun: 'leisure', Others: null };

  /* Only a node that says WHAT was bought, and that the row's own label does not
     contradict, is evidence (fhNodeIsEvidence). A who-node or a stale machine
     guess in the ledger must not become the answer for the next row. */
  var nodeHistoryMap = (function () {
    var m = {};
    var ev = function (node, claims) { return (typeof fhNodeIsEvidence === 'function') ? fhNodeIsEvidence(node, claims) : !!node; };
    try {
      (window.txns || []).forEach(function (t) {
        if (!t || !t.node || t.future) return;
        if (!ev(t.node, (window.catClaims || {})[t.cat])) return;
        var k = normDescForDedup(t.note || '');
        if (k && !m[k]) m[k] = t.node;
      });
      var P = window.fhPersonalData ? fhPersonalData() : null;
      var labels = (P && P.labels) || [];
      ((P && P.txns) || []).forEach(function (t) {
        if (!t || !t.node) return;
        var lab = t.labelId && labels.find(function (l) { return l.id === t.labelId; });
        var claims = lab ? lab.claims : (typeof fhDefaultClaimsFor === 'function' ? fhDefaultClaimsFor(t.cat, t.emoji) : null);
        if (!ev(t.node, claims)) return;
        var k = normDescForDedup(t.note || '');
        if (k && !m[k]) m[k] = t.node;
      });
    } catch (e) {}
    return m;
  })();

  /* The same PAYEE, whatever was typed this time. A ledger note reads "payee |
     memo", and the memo changes every month ("Em gui tien nha", "Em chuyen tien
     nha. Cam on anh Quang") while the payee does not. Answered only when every
     past row to that payee agrees and there are at least two of them: one row is
     an anecdote, and a payee filed two ways is a shop that sells two things. The
     who-was-paid nodes do not vote — they say nothing about what was bought. */
  var payeeNodeMap = (function () {
    var votes = {}, m = {};
    var see = function (t) {
      if (!t || !t.node || t.future || (typeof fhIsWhoNode === 'function' && fhIsWhoNode(t.node))) return;
      var head = String(t.note || '').split('|')[0].trim();
      if (!/\d{6,}/.test(head) || !/[A-Za-zÀ-ỹ]{2,}\s+[A-Za-zÀ-ỹ]{2,}/.test(head)) return;   // an account AND a name
      var k = normDescForDedup(head); if (!k) return;
      (votes[k] = votes[k] || {})[t.node] = (votes[k][t.node] || 0) + 1;
    };
    try {
      (window.txns || []).forEach(see);
      var P = window.fhPersonalData ? fhPersonalData() : null;
      ((P && P.txns) || []).forEach(see);
      Object.keys(votes).forEach(function (k) {
        var ns = Object.keys(votes[k]);
        if (ns.length === 1 && votes[k][ns[0]] >= 2) m[k] = ns[0];
      });
    } catch (e) {}
    return m;
  })();

  /* payload v2: what the person owns, read once for the whole build. */
  var _sigOwn = (window.csvStagedMode && typeof window.fhStagedRawX === 'function') ? fhSignalOwn() : null;

  return parsed.rows.map(function(row, i) {
    var flags = [];
    var dateRaw = colFor.occurred_at !== undefined ? row[colFor.occurred_at] : '';
    var amtRaw = colFor.amount !== undefined ? row[colFor.amount] : '';
    var desc = colFor.description !== undefined ? (row[colFor.description] || '').trim() : '';
    var catGuess = colFor.category !== undefined ? (row[colFor.category] || '').trim() : '';
    /* 0144 — what the pipeline sealed for THIS row: its tree node, its legacy
       concept, and whether the mail came from a merchant (a receipt) rather than
       a bank. Null for a file import, which has no pipeline behind it. */
    var _pipe = (window.csvStagedMode && typeof window.fhStagedNode === 'function') ? window.fhStagedNode(i) : null;
    var rowNodeHint = _pipe ? _pipe.node : null;
    var catGuessConcept = _pipe ? _pipe.concept : '';
    var isReceipt = !!(_pipe && _pipe.receipt);

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
    /* payload v2 (email-reading-v2-spec §9). Asked BEFORE any free-text rule
       below reads the row: where the mail states a signal, the signal wins and
       those rules stand down. _sig is null for every v1 row, for a v2 row the
       server could not classify, and for a row a lesson already answers, and
       then everything below runs exactly as it did before v2. */
    var _sig = null, _sigX = null, _sigAcct = null;
    if (_sigOwn) {
      _sigX = window.fhStagedRawX(i);
      if (fhIsV2(_sigX)) {
        _sigAcct = window.fhStagedAcct ? window.fhStagedAcct({ rowIndex: i }) : null;
        var _sigAmt = classifyAmount(amtRaw);
        var _sigRow = { x: _sigX, direction: _sigX.direction,
          counterparty: colFor.counterparty !== undefined ? (row[colFor.counterparty] || '').trim() : '',
          description: desc, amount: _sigAmt.status === 'ok' ? Math.abs(_sigAmt.value) : null,
          acct: _sigAcct, provider: _sigAcct && _sigAcct.provider };
        _sig = fhKindFromSignal(_sigRow, Object.assign({}, _sigOwn, {
          lesson: fhSignalLessonHit({ counterparty: _sigRow.counterparty, description: desc, amount: _sigRow.amount, isIncome: _sigX.direction === 'credit' }),
          cardFor: window.fhResolveRepaidCard ? function () { return window.fhResolveRepaidCard(_sigX, _sigAcct, desc); } : null }));
      }
    }
    /* Some exports put everything in one column, so the words have to carry
       it: a salary run, an incoming transfer, a refund or interest is money
       IN. Filing a salary as spending would corrupt the month badly, so this
       leans towards holding a row back for review rather than importing it. */
    if (!isIncome && !_sig) {
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
    if (!isIncome && !_sig) {
      var ttext = ' ' + deburr((desc || '').toLowerCase()) + ' ';
      if (/thanh toan (sao ke |du no )?the( tin dung)?|tt the tin dung|tra no the|thanh toan the (visa|master|jcb)|credit card payment|tra tien the tin dung/.test(ttext)) isTransfer = true;
    }
    /* Staged (bank-email) rows carry the pipeline's own sealed verdicts —
       flow (its internal-transfer call) and account_kind (the 0105 instrument
       classifier). The §8.3 matrix: money INTO a credit card is a payment or
       refund drawing the debt down — a transfer, never income. The memo regex
       above still stands for CSV files and rows staged before the classifier. */
    if (window.csvStagedMode && typeof window.fhStagedRawX === 'function') {
      var _sx = window.fhStagedRawX(i);
      /* fhStagedAcct carries the classifier verdict AND the local fallback for
         rows staged before it existed (masked-PAN / wallet provider). */
      var _sa = window.fhStagedAcct ? window.fhStagedAcct({ rowIndex: i }) : null;
      if (_sx && _sig) {
        /* The signal decides. One STRUCTURAL rule stays above it, because it is
           not a reading of free text: money INTO a credit card draws the debt
           down, whatever the mail calls it (a refund to a card is a transfer into
           that card, never income: income cannot land on a card). */
        if (_sa && _sa.kind === 'credit_card' && _sx.direction === 'credit' && _sig.kind !== 'cardpay') {
          _sig = { kind: 'cardpay', signal: _sig.signal, tier: 3, hold: true, weak: false, node: 'cardpay' };
        }
        isIncome = (_sx.direction === 'credit');       // doubles as the direction under every kind
        if (_sig.kind === 'cardpay') { isTransfer = true; isIncome = false; }
      } else if (_sx) {
        if (_sx.flow === 'transfer') { isTransfer = true; isIncome = false; }
        else if (_sa && _sa.kind === 'credit_card' && _sx.direction === 'credit') { isTransfer = true; isIncome = false; }
        /* A bank's own payment-confirmation mail can carry NO memo at all (VIB
           "Thanh toán thẻ tín dụng thành công" templates memo:null), so the
           regex above never sees it. fhCardPayShaped reads the sealed shape
           instead: classifier-says-card while the number is a non-card account
           the user owns = a card payment leaving that account. */
        else if (window.fhCardPayShaped && window.fhCardPayShaped(_sx)) { isTransfer = true; isIncome = false; }
        /* Money INTO a deposit/wallet is a first-class candidate now (0109 full
           ledger): a checkable card with a 3-way Kind control — Thu nhập /
           Chuyển khoản nội bộ / Thu nợ — not a row parked in the inflow strip. */
        else if (_sx.direction === 'credit') { isIncome = true; }
      }
    }

    /* Read BEFORE the self-transfer test below, which asks it a question. It used
       to be declared after that test: `var` hoists the name, so nothing threw, the
       test simply saw undefined on every row and its counterparty half never ran. */
    var party = colFor.counterparty !== undefined ? (row[colFor.counterparty] || '').trim() : '';

    /* Self-transfer ("X chuyển tiền đến X") is an internal move between own
       accounts, not a card payment — reclassify cardpay → xfer so the review
       asks which account, not which card. Reads the staged memo (the counterparty
       tail lives there) and falls back to the description for CSV rows. */
    var _xfer = false;
    /* A statement row carries the file's OWN evidence of an internal transfer
       (statement-capture-spec.md section 11, level 2): the wallet's funding column
       names a bank on a top-up, or the bank memo's recipient is the holder. That is
       structured evidence, so the row is pre-set to "Chuyển khoản nội bộ" -- and
       flagged for a look rather than dropped into the ready list, because one side
       of a transfer is still a claim the person should see. A holder-name memo
       alone never sets this (the parser does not raise it). */
    var _stmtHint = (window.csvStagedMode && typeof window.fhStagedRawX === 'function') ? ((window.fhStagedRawX(i) || {}).stmt || null) : null;
    /* _xferDir: which way the money moved on a row pre-set as a transfer. Everywhere
       else isIncome doubles as the direction flag (the Kind control never clears it
       when a credit is flipped to a transfer), but the line below clears it, and with
       it the only record that a wallet's top-up is money coming IN. The review card
       has always asked `isIncome || _xferDir === 'in'` (56) and nothing ever set the
       second half, so such a row was offered the money-out kinds and its wallet leg
       was imported with the wrong sign. Set from the staged row's own direction. */
    var _xferDir;
    if (_stmtHint && _stmtHint.xfer) {
      _xferDir = ((window.fhStagedRawX(i) || {}).direction === 'credit') ? 'in' : 'out';
      _xfer = true; isTransfer = false; isIncome = false;
    }
    var _selfMemo = '';
    if (window.csvStagedMode && typeof window.fhStagedRawX === 'function') {
      var _rx = window.fhStagedRawX(i);
      _selfMemo = _rx ? (_rx.memo_display != null ? _rx.memo_display : (_rx.memo || '')) : '';
    }
    if (_sig) { if (_sig.kind === 'xfer') _xfer = true; }
    else if (_isSelfTransfer(_selfMemo || desc) || _isSelfTransfer(party)) { _xfer = true; isTransfer = false; }
    /* The personal-only kinds a signal can propose. Same marks the lending pass
       leaves, and the same forced scope: a loan, a repayment or an investment
       leg can only ever land in the personal book. */
    var _sigLoan = !!(_sig && _sig.kind === 'loan'), _sigRepay = !!(_sig && _sig.kind === 'repay'),
        _sigInvest = !!(_sig && _sig.kind === 'invest');

    /* Which owned credit card this card payment pays off, matched from the
       mail's own evidence (card_masked → card-side account_masked → memo tail →
       one card). Set here so "Trả cho thẻ" pre-selects the card instead of
       "Chưa rõ" (card-repayment-routing-spec.md §8.2). One shared resolver with
       the promote path, so the shown card and the imported card agree. Only for
       real card payments; an internal transfer or plain expense carries none,
       and an unnameable card stays null → "Chưa rõ" (never guessed). */
    var _payCardId = null;
    if (isTransfer && !_xfer && window.fhResolveRepaidCard) {
      try { _payCardId = window.fhResolveRepaidCard(_sx, _sa, desc) || null; } catch (e) { _payCardId = null; }
    }

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
    var catName = (isIncome || isTransfer || _xfer || _sigLoan || _sigRepay || _sigInvest) ? null : matchCategoryName(catGuess);
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
    /* A loan, a repayment or an investment leg has no spending category: the
       money changed shape, not owner (the same clearing the lending pass does). */
    if (_sigLoan || _sigRepay || _sigInvest) { catName = null; catSource = null; }
    else if (!catName) flags.push('needs_category');

    /* ── 0144: the tree node, beside the label ──────────────────────────────
       The label above answers "which of MY buckets"; the node answers "what did
       the money buy". They are resolved from the same evidence and they are
       allowed to disagree — the label is the person's, the node is the machine's.
       Order is confidence, strongest first, and every tier is free but the first
       (the pipeline already spent whatever it spent). */
    var node = null, nodeSource = null;
    var nodeKind = (_sig && FH_KIND_NODEKIND[_sig.kind]) || (isIncome ? 'income' : (isTransfer || _xfer) ? 'transfer' : 'expense');
    if (typeof FH_TAX !== 'undefined' && typeof fhNodeGuess === 'function') {
      var _okN = function (c) { return (c && FH_TAX.get(c) && FH_TAX.kindOf(c) === nodeKind) ? c : null; };
      // 1. the pipeline's own answer, sealed with the row (raw_extracted.node)
      node = _okN(rowNodeHint);
      /* …unless it rests on a keyword the tree has since retired (fhPipeNodeOk). */
      if (node && typeof fhPipeNodeOk === 'function') node = fhPipeNodeOk(node, { note: desc, counterparty: party });
      if (node) nodeSource = 'pipeline';
      // 2. a ledger row with the same wording that already carries a node
      if (!node) {
        var hn = (desc && nodeHistoryMap[normDescForDedup(desc)]) || (party && nodeHistoryMap[normDescForDedup(party)])
          || (party && payeeNodeMap[normDescForDedup(party)]);
        node = _okN(hn); if (node) nodeSource = 'history';
      }
      // 3. what this person taught about this merchant, at this size
      if (!node && typeof window.fhLessonNode === 'function') {
        try { node = _okN(window.fhLessonNode({ counterparty: party, memo: desc, amount: amount })); } catch (e) {}
        if (node) nodeSource = 'learned';
      }
      // 4. the tree's own keywords over counterparty + memo
      if (!node) {
        node = _okN(fhNodeGuess({ kind: nodeKind, note: desc, counterparty: party, amount: amount, whatOnly: true }));
        /* A transfer to another PERSON keeps the place it always had, ahead of the
           hint and the label. Only the newer seller nodes wait for tier 7. */
        if (!node && typeof fhWhoNode === 'function'
            && fhWhoNode({ kind: nodeKind, note: desc, counterparty: party, amount: amount }) === 'p2p') node = _okN('p2p');
        if (node) nodeSource = 'keyword';
      }
      /* 4b. the statement's own reading of the row. fhStmtClassify calls a debit
             whose words say "phí" a fee, and that verdict used to die at the
             hand-off (77 kept cardpay and topup only). It is the same class of
             evidence as tier 4, a word, so it speaks only when the tree's own
             keywords named nothing more specific ("phi giu xe" is parking, and
             stays parking). It rests on the GROUP: the word says "a fee", never
             which one. _okN keeps it off any row that is not an expense. */
      if (!node && _stmtHint && _stmtHint.flow === 'fee') {
        node = _okN('fees'); if (node) nodeSource = 'statement';
      }
      /* 4c. the node the SIGNAL itself maps to (payroll is `wage`, an own-account
             move is `bankbank`). Below every tier that read this row's own words
             or this person's history, because it is the vaguer answer (E14a). */
      if (!node && _sig && _sig.node) {
        node = _okN(_sig.node); if (node) nodeSource = 'signal';
      }
      /* 5. the legacy 8-concept hint, lifted to the tree GROUP that carries it.
            A concept is exactly a group's worth of confidence, so it lands on the
            group and never pretends to a leaf. */
      if (!node && catGuessConcept && nodeKind === 'expense') {
        var grp = (typeof fhConceptGroup === 'function') ? fhConceptGroup(catGuessConcept) : CONCEPT_TREE_GROUP[catGuessConcept];
        node = _okN(grp); if (node) nodeSource = 'concept';
      }
      // 6. the label the person's own partition implies, when it implies one thing
      if (!node && catName && window.catClaims && typeof fhNodeFromClaims === 'function') {
        node = _okN(fhNodeFromClaims(window.catClaims[catName]));
        if (node) nodeSource = 'label';
      }
      /* 7. LAST: nothing says what was bought, so say who was paid — a seller, or
            another person. Below every tier that knows WHAT, because "Đi lại" says
            more than "Thanh toán cho người bán" ever can. */
      if (!node && typeof fhWhoNode === 'function') {
        node = _okN(fhWhoNode({ kind: nodeKind, note: desc, counterparty: party, amount: amount }));
        if (node) nodeSource = 'who';
      }
    }

    /* Income category default (0109): the small income-side set, guessed from
       wording, always overridable on the card. Never a family expense category. */
    var incomeCat = null;
    if (isIncome) {
      /* A statement row arrives already classified by the file's own reader
         (fhStmtClassify: a credit it called a refund or a salary). That is the
         source's stated answer, so it goes ahead of the keyword guess below, the
         same precedence the file's category column gets over guessCat. Read from
         stmt.incomeCat, and from the flow for a payload that carries only that.
         Only a name the income set really has is accepted. */
      var _stmtInc = _stmtHint ? (_stmtHint.incomeCat || ({ salary: 'Lương', refund: 'Hoàn tiền' })[_stmtHint.flow] || '') : '';
      if (_stmtInc && typeof FH_INCOME_CATS !== 'undefined' && FH_INCOME_CATS.indexOf(_stmtInc) < 0) _stmtInc = '';
      var itext = deburr(String(desc || '').toLowerCase());
      incomeCat = _sig ? (_sig.incomeCat || 'Khác')      // the signal wins over the wording (spec §9)
        : _stmtInc ? _stmtInc
        : /\b(luong|salary|payroll)\b/.test(itext) ? 'Lương'
        : /\b(thuong|bonus)\b/.test(itext) ? 'Thưởng'
        : /\b(hoan tien|refund|hoan phi)\b/.test(itext) ? 'Hoàn tiền'
        : 'Khác';
    }

    /* payload v2: where the row SHOWS (spec §3). A pre-selected kind, card or
       counterpart that rests on the model's judgment or on a guess is shown in
       "Cần bạn xem"; so is the row's own account when its number was judged
       rather than read; so is a v2 row whose signal the server withdrew because
       its two readers disagreed (it seals `signal: null` and keeps `src.signal`).
       The tick is untouched: provenance decides where, never whether. */
    var _srcAttn = false;
    if (fhIsV2(_sigX)) {
      if (_sig && _sig.weak) _srcAttn = true;
      else if (!_sigX.signal && fhSrcOf(_sigX, 'signal')) _srcAttn = true;
      else if (_sigAcct && fhSrcWeak(_sigX, ['account_masked'])) _srcAttn = true;
    }
    /* payload v2: a printed fee is its own small expense (full-ledger-spec §3.4).
       It rides ON its parent rather than as a second candidate: one staged row
       is one candidate everywhere (rowIndex is how a row is retired), so a fee
       that were its own candidate could hold its parent in the queue, or retire
       it, by being ticked differently. Ticked only when the mail PRINTED it. */
    var _fee = null;
    if (fhIsV2(_sigX) && Number(_sigX.fee_amount) > 0 && isFinite(Number(_sigX.fee_amount))
        && !(window.fhStagedFx && window.fhStagedFx(i))) {
      _fee = { amount: Number(_sigX.fee_amount), on: fhSrcOf(_sigX, 'fee_amount') === 'printed',
               node: (typeof FH_TAX !== 'undefined' && FH_TAX.get('bankfees')) ? 'bankfees' : null };
    }

    /* A foreign row the app could NOT estimate (no rate for its currency)
       arrives DESELECTED — it has no VND figure, so it must never ride a
       select-all into the ledger; the tick unlocks once the person types the ₫
       amount. A foreign row we DID estimate is import-ready like any VND row
       (zero-typing) and is selected by default. */
    var _fxSkip = false;
    if (window.csvStagedMode && typeof window.fhStagedFx === 'function') {
      var _fxp = window.fhStagedFx(i);
      _fxSkip = !!(_fxp && _fxp.kind === 'foreign' && !(_fxp.est && _fxp.est.vnd > 0));
    }

    return {
      rowIndex: i, raw: row, flags: flags, _skipImport: _fxSkip || undefined,
      date: date, dateDisplay: date ? (date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')) : '',
      amount: amount, negative: aclass.status === 'ok' && String(amtRaw).trim().indexOf('-') === 0,
      _incomeCat: incomeCat,
      description: desc || catGuess || L('(không có mô tả)','(no description)'),
      // Did this row actually SAY anything? The line above substitutes a
      // placeholder, and that placeholder is identical on every silent row —
      // which the duplicate check must not read as them all being the same thing.
      _hasDesc: !!(desc || catGuess),
      categoryGuess: catGuess, categoryName: catName, catSource: catSource,
      _node: node, _nodeSource: nodeSource, _nodeKind: nodeKind, _receipt: isReceipt || undefined,
      counterparty: party, who: who, isIncome: isIncome, isTransfer: isTransfer, _xfer: _xfer,
      _xferDir: _xferDir,
      /* The bank's own reference, off the staged row. csvInfoScore has always counted
         it when choosing the richest of two copies of one payment, and no candidate
         ever carried it. Review-only: it has no ledger column, on purpose
         (email-reading-v2-spec §4), and the file-import draft does not keep it. */
      reference_number: (window.csvStagedMode && typeof window.fhStagedRawX === 'function'
        && String((window.fhStagedRawX(i) || {}).reference_number || '').trim()) || undefined,
      _payCardId: _payCardId,
      /* payload v2 (all undefined on a v1 row). The kind a signal proposed and
         the half of it this device could fill in from what the person owns. */
      _v2: fhIsV2(_sigX) || undefined,
      _sigKind: (_sig && _sig.kind) || undefined, _sigTier: (_sig && _sig.tier) || undefined,
      _sigHold: (_sig && _sig.hold) || undefined,
      _srcAttn: _srcAttn || undefined,
      _loan: _sigLoan || undefined, _repay: _sigRepay || undefined, _invest: _sigInvest || undefined,
      _scope: (_sigLoan || _sigRepay || _sigInvest) ? 'personal' : undefined,
      _xferOtherId: (_sig && _sig.kind === 'xfer' && _sig.otherId) || undefined,
      _investPosId: (_sigInvest && _sig.posId) || undefined, _investQty: (_sigInvest && _sig.qty) || undefined,
      _loanWho: (_sigLoan && _sig.who) || undefined, _loanDue: (_sigLoan && _sig.due) || undefined,
      _repayWho: (_sigRepay && _sig.who) || undefined,
      _fee: _fee || undefined,
      _stmtAttn: !!(_stmtHint && _stmtHint.attn) || undefined,
      _stmtFlow: (_stmtHint && _stmtHint.flow) || undefined,   // the statement's own word for the row (fee, refund, salary, topup, cardpay)
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

/* Display-canonical provider name for rows ALREADY staged under the old,
   uncoordinated names ('MB', 'MBank', 'MBBank' — three authors, no canon; the
   pipeline normalises new rows at extraction now, this heals the sealed
   history at read time). Mirrors canonProviderName in senders.mjs — same
   noise-stripped key, registry display names, unknowns pass through. */
var FH_PROVIDER_CANON = {
  mb:'MB Bank', m:'MB Bank', vietcom:'Vietcombank', vcb:'Vietcombank',
  vib:'VIB', vp:'VPBank', techcom:'Techcombank', tcb:'Techcombank',
  acb:'ACB', tp:'TPBank', vietin:'VietinBank', vtb:'VietinBank',
  agri:'Agribank', bidv:'BIDV', sacom:'Sacombank', shb:'SHB', hdb:'HDBank',
  ocb:'OCB', msb:'MSB', seab:'SeABank', eximb:'Eximbank', momo:'MoMo',
  zalopay:'ZaloPay', shopeepay:'ShopeePay', viettelmoney:'Viettel Money'
};
function fhProviderName(name){
  if(!name) return '';
  var key = csvCanonicalProvider(name);
  return FH_PROVIDER_CANON[key] || String(name).trim();
}
window.fhProviderName = fhProviderName;

/* How much a candidate actually TELLS someone, for picking between copies of
   one payment. Ordered by what a person reads first on the card: a real
   description outranks everything (and a longer one is usually the more
   specific one — a beneficiary name over a bare merchant code), then a
   category, then the smaller corroborating details. Deliberately not a
   proxy for "which transport": transports change, informativeness is the
   thing actually wanted. */
function csvInfoScore(c) {
  if (!c) return -1;
  var desc = String(c.description || '').trim();
  var score = 0;
  if (desc) score += 100 + Math.min(desc.length, 40);
  if (c.categoryName) score += 20;
  if (String(c.counterparty || '').trim()) score += 10;
  if (typeof csvRowTime === 'function' && csvRowTime(c)) score += 5;
  if (String(c.reference_number || '').trim()) score += 2;
  return score;
}

function csvCanonicalProvider(name) {
  if (!name) return '';
  var s = deburr(String(name)).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Longest first: strip 'ebanking' before 'banking' can leave a stray 'e'.
  for (var i = 0; i < CSV_PROVIDER_NOISE.length; i++) s = s.split(CSV_PROVIDER_NOISE[i]).join('');
  return s;
}

/* Ledger, near-miss, pipeline and cross-source matching moved to
   58-dedup-engine.js (dedup-flaws-review.md Part E): one engine, one verdict
   per row, evidence attached. This function keeps only the FACT tiers that
   need the raw staged row — richest-copy merge, resolved_before, in-batch —
   and the bucket assignment. */
function bucketCsvCandidates(candidates, mixedSigns) {
  var seen = {}; // ident|amount|day|time -> first candidate seen
  var staged = !!window.csvStagedMode;
  var ready = [], needsCategoryGroups = {}, possibleDuplicate = [], deferred = [], merged = 0;

  /* ONE PAYMENT, THE RICHEST COPY — decided before anything else is bucketed.

     A payment can reach us more than once (both transports live, a bank that
     notifies twice, a forward someone sent by hand), and we cannot stop that
     from the client, so the job is to survive it well. The copies are never
     equally informative: one carries the beneficiary, another only the bank's
     boilerplate memo that tidy correctly empties, leaving "(không có mô tả)".
     Keying the check on TEXT is what let those diverge and both slip through —
     the identity has to be something no wording can reshape.

     So: amount + the exact SECOND, which is the identity the pipeline's own
     fingerprint uses. Two payments cannot share both; two copies of one payment
     always do. Whichever copy says the most survives, the rest are flagged —
     never the other way round, and never "first one wins", because arrival
     order is an accident and the person is left reading whichever it picked.

     Requires a real instant: a day-only date (a UTC-midnight placeholder) would
     collapse two honest same-amount purchases, so those fall through to the
     text rule below, as do all file-import rows. */
  if (staged) {
    var richest = {};
    candidates.forEach(function(c){
      var srow = (window._fhStagedRows || [])[c.rowIndex];
      var inst = srow && srow.occurred_at;
      if (!inst || !c.amount) return;
      var dt = new Date(inst);
      /* v2 STATES whether the mail carried a clock time (time_precision); v1 is
         still inferred from "exactly UTC midnight". Same rule as fhStagedRowTime. */
      var tp = (srow.raw_extracted || {}).time_precision;
      if (tp === 'day') return;                                                      // date-only: no instant to key on
      if (tp !== 'second' && tp !== 'minute'
          && !isNaN(dt.getTime()) && dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) return;  // date-only: no instant to key on
      var k = inst + '|' + c.amount;
      var held = richest[k];
      if (!held) { richest[k] = c; return; }
      if (csvInfoScore(c) > csvInfoScore(held)) { held._mergedCopy = true; richest[k] = c; }
      else { c._mergedCopy = true; }
    });
  }

  /* ── 0144: the RECEIPT JOIN ─────────────────────────────────────────────
     A merchant's own mail (Grab, Shopee, Apple — senders.mjs RECEIPT_DOMAINS)
     describes a purchase a bank or wallet ALREADY reported. Importing both
     double-counts, and flagging it as a duplicate asks a question the person
     cannot usefully answer ("which of these two is the real one?" — they are
     one thing). So a receipt is not a candidate at all: it hands its node to
     the bank row it matches and retires with the batch.

     Matched on exact amount within ±2 days, which is the same evidence the
     transfer matcher trusts, and for the same reason: a receipt and its bank
     charge are the same money, and the merchant's clock and the bank's rarely
     agree to the minute. The receipt's node WINS when it is deeper — the
     merchant knows what it sold better than the bank's memo does. An unmatched
     receipt stays an ordinary candidate: better one extra row to judge than a
     purchase silently dropped. */
  if (staged) {
    var _recs = [], _banks = [];
    candidates.forEach(function (c) {
      if (c._mergedCopy) return;
      (c._receipt ? _recs : _banks).push(c);
    });
    _recs.forEach(function (r) {
      if (!r.amount || !r.date) return;
      var hit = null;
      for (var i = 0; i < _banks.length; i++) {
        var b = _banks[i];
        if (b._receiptJoined || !b.amount || !b.date) continue;
        if (Math.round(b.amount) !== Math.round(r.amount)) continue;
        if (Math.abs(b.date - r.date) > 2 * 864e5) continue;
        hit = b; break;
      }
      if (!hit) return;
      hit._receiptJoined = true;
      r._joinedInto = hit.rowIndex;                       // retired with the batch, never imported
      if (r._node && (!hit._node || fhNodeDepth(r._node) > fhNodeDepth(hit._node))) {
        hit._node = r._node; hit._nodeSource = 'receipt';
      }
      /* The merchant's own wording beats a bank memo that says nothing. */
      if (r.description && (!hit.description || /^\(kh/.test(hit.description))) hit.description = r.description;
    });
  }

  var rest = [];   // rows the fact tiers below did not settle — the engine's turn
  candidates.forEach(function(c) {
    /* A poorer copy of a payment already kept in this batch. MERGED AWAY, not
       shown: "same amount to the second" is one payment by construction, and
       asking someone to confirm it is asking a question with no second answer.
       Not silent, though: counted, and the header says how many were merged.
       And still RETIRED on import — being in none of ready/groups/dup/deferred,
       fhStagedIdsForResolved reads them as finished, which they are. */
    if (c._mergedCopy) { merged++; return; }

    /* A receipt that found its bank row: counted like a merged copy (it IS the
       same purchase), retired on import, never shown as a second transaction. */
    if (c._joinedInto !== undefined) { merged++; return; }

    /* CERTAIN, not suspected: the server re-staged this mail knowing its id was
       already promoted or dismissed in a previous connection (resolved_before,
       0113). Message-id equality is not a guess, so this outranks every tier
       below. Still a flag and a tap, never a deletion — the ledger is the
       anchor, and only the person knows whether they since removed the row. */
    if (staged) {
      var srowRB = (window._fhStagedRows || [])[c.rowIndex];
      if (srowRB && srowRB.resolved_before) {
        c.duplicateResolvedBefore = true; c._dupTier = 'sure'; c._dupWhy = 'resolved_before';
        possibleDuplicate.push(c); return;
      }
    }

    /* A card payment is a real thing to import now — a TRANSFER that draws a
       card's balance down. So in staged (bank-email) mode it is a normal,
       checkable, importable card. Only CSV-file transfers stay deferred, where
       importing a card statement AND a bank statement genuinely double-counts.
       Since 0109 the same goes for money IN: a staged credit row is a normal
       card with a 3-way Kind control — only CSV-file income stays deferred. */
    if (mixedSigns || (c.isIncome && !staged) || (c.isTransfer && !staged) || c.flags.indexOf('date_missing') >= 0 || c.flags.indexOf('amount_missing') >= 0) {
      deferred.push(c); return;
    }

    /* IN-BATCH: the same words, the same amount, the same day — and, for rows
       that carry a bank time, the same MINUTE (two topups to the same person on
       one day are how people actually move money; Trang's queue held 44 of
       them, all parked as "duplicates" nobody asked about). A staged row with
       NO time (a date-only bank) needs the bank's own reference to agree
       instead — a reference is unique per transaction, so equality is a fact
       and inequality clears the pair; without either, the pair is not judged.
       Identity is what the row says, or failing that who it was with; a row
       with neither is simply not deduped here (a placeholder made two unrelated
       transfers "identical" once). */
    var ident = (c._hasDesc ? normDescForDedup(c.description) : '') ||
                normDescForDedup(c.counterparty || '');
    if (ident) {
      var tm = (staged && typeof csvRowTime === 'function') ? (csvRowTime(c) || '') : '';
      var ref = '';
      if (staged && !tm && typeof window.fhStagedRawX === 'function') {
        var rx0 = window.fhStagedRawX(c.rowIndex);
        ref = (rx0 && rx0.reference_number) ? String(rx0.reference_number) : '';
      }
      var key = ident + '|' + c.amount + '|' + (c.dateDisplay || '') + '|' + tm + '|' + ref;
      var judge = !staged || tm || ref;             // staged, no time, no reference: not judged
      if (judge && seen[key]) {
        c.duplicateOfBatch = true; c._dupTier = (staged && tm) ? 'sure' : 'likely'; c._dupWhy = 'in_batch';
        c._dupTwin = seen[key]; c._dupTwinKind = 'queue';
        possibleDuplicate.push(c); return;
      }
      if (judge) seen[key] = c;
    }
    rest.push(c);
  });

  /* THE ENGINE (58-dedup-engine.js): every remaining row against both books
     at once, then against the rest of the queue. It returns a verdict it can
     show evidence for, or nothing. The legacy flag names are kept on the row
     for the chips, the filters and the tests that read them. */
  var index = (typeof fhDedupLedgerIndex === 'function') ? fhDedupLedgerIndex() : { rows: [], byAmt: {} };
  var ecs = rest.map(function(c){
    var meta = (staged && window.fhStagedMeta) ? window.fhStagedMeta(c.rowIndex) : null;
    var rx = (staged && typeof window.fhStagedRawX === 'function') ? window.fhStagedRawX(c.rowIndex) : null;
    return { amount: c.amount, date: c.date, dateDisplay: c.dateDisplay,
             time: (staged && typeof csvRowTime === 'function') ? (csvRowTime(c) || '') : '',
             description: c._hasDesc ? c.description : '', counterparty: c.counterparty || '',
             isIncome: !!c.isIncome, isTransfer: !!(c.isTransfer || c._xfer || c._repay || c._loan || c._invest),
             accountKind: (rx && rx.account_kind) || null, shape: (rx && rx.transaction_type) || '',
             provider: (meta && meta.provider) || '', kind: (meta && meta.kind) || '',
             currency: (meta && meta.currency) || '', pipelineDupOf: (meta && meta.pipelineDup) ? meta.dupOfId : '',
             statement: !!(rx && rx._transport === 'statement') };
  });
  var verdicts = (typeof fhDedupAssess === 'function')
    ? fhDedupAssess(ecs, index, { kindById: window.fhStagedKindById })
    : ecs.map(function(){ return null; });

  rest.forEach(function(c, i) {
    var v = verdicts[i];
    if (ecs[i].pipelineDupOverruled) c.pipelineDupOverruled = true;   // two banks; falls through to the normal path
    if (v) {
      c._dupTier = v.tier; c._dupWhy = v.why; c._dupTwin = v.twin; c._dupTwinKind = v.twinKind; c._dupShared = v.shared || '';
      if (v.twinKind === 'ledger') {
        if (v.why === 'rounded_merchant') c.duplicateNearMiss = v.twin; else c.duplicateOfExisting = v.twin;
      } else if (v.why === 'cross_source' || v.why === 'same_bank_pair') { c.duplicateOfSource = v.twin; }
      else if (v.why === 'pipeline') { c.duplicateOfPipeline = true; }
      possibleDuplicate.push(c); return;
    }

    /* A transfer (card payment) has no category and needs none — it is not
       spending. It goes straight to ready rather than the pick-a-category
       queue; its card marks itself "Trả nợ thẻ" instead. Income likewise: its
       category set is the income one (_incomeCat, defaulted at build), never
       the family expense picker. */
    if (!c.categoryName && !c.isTransfer && !c.isIncome && !c._loan && !c._repay && !c._xfer && !c._invest) {
      var gkey = normDescForDedup(c.description);
      (needsCategoryGroups[gkey] = needsCategoryGroups[gkey] || []).push(c);
      return;
    }

    ready.push(c);
  });

  return { ready: ready, needsCategoryGroups: needsCategoryGroups, possibleDuplicate: possibleDuplicate, deferred: deferred, mergedCount: merged };
}

