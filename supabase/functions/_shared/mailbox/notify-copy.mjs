/* notify-copy — the voice of the txn_review notification.
 *
 * The push payload carries NO amount, NO merchant, NO category name. Context
 * (category concept × amount tier × daypart × an optional merchant-keyword
 * pool) is distilled HERE, at the only moment the pipeline holds the plaintext,
 * into a tiny enum meta {c, t, d, p}. push-send turns that meta into one
 * pre-written line, so what transits Apple/Google/Mozilla asserts nothing
 * private.
 *
 * SHAPE (2026-09-05): every line is a pair { e, b } —
 *   • e = the TITLE: exactly one face emoji, the app's reaction,
 *   • b = the BODY: plain text ending in "!", NO emoji, NO digits, ≤ 9 words.
 * VOICE: a fond, slightly nosy friend reacting to THIS one transaction —
 * playful judgment PLUS a smart nudge to spend/live wisely or healthily, never
 * preachy, never about the queue.
 *
 * DAYPART: for the time-sensitive concepts (Dining, Groceries) and the coffee /
 * milk-tea pools, a daypart line (sáng/trưa/chiều/tối, from occurred_at) is used
 * when a real clock time is known; a date-only row falls back to the tier line. */

const CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'];

/* VND tiers. Tier 1 (≤30k) matches the client's photo-nudge floor. A non-VND
 * amount has no honest tier — it reads as tier 2 rather than guessing. */
const TIERS = [30000, 500000, 5000000];

function tierOf(amount, currency) {
  if (currency && currency !== 'VND') return 2;
  const a = Number(amount) || 0;
  if (a <= TIERS[0]) return 1;
  if (a <= TIERS[1]) return 2;
  if (a <= TIERS[2]) return 3;
  return 4;
}

/* Daypart from occurred_at, in VN wall-clock (+07:00). Four buckets, no khuya —
 * tối absorbs the night. Null when there is no real time: a date-only row is
 * stored at UTC-midnight, so H:M:S all zero → no daypart (falls back to tier). */
function dayPartOf(occurredAt) {
  const t = Date.parse(occurredAt || '');
  if (!t) return null;
  const d = new Date(t);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return null;
  const h = (d.getUTCHours() + 7) % 24;
  if (h >= 5 && h < 11) return 'sang';
  if (h >= 11 && h < 14) return 'trua';
  if (h >= 14 && h < 18) return 'chieu';
  return 'toi';
}

/* Merchant/memo → pool key. Deburred, padded word match. Expenses only. */
const POOLS = {
  coffee: ['ca phe', 'cafe', 'coffee', 'highlands', 'phuc long', 'katinat', 'starbucks',
    'trung nguyen', 'trung nguyen legend', 'cong ca phe', 'cong caphe', 'phe la', 'cheese coffee',
    'guta', 'milano', 'the coffee house', 'tch', 'passio', 'aha cafe', 'ong bau', 'napoli',
    'laha', 'la viet', 'phindeli'],
  milktea: ['tra sua', 'gong cha', 'gongcha', 'koi the', 'koi', 'toco toco', 'tocotoco',
    'bobapop', 'ding tea', 'mixue', 'phuc tea', 'boba', 'tiger sugar', 'the alley',
    'royaltea', 'goky', 'maycha', 'tealive'],
  ride: ['grab', 'grabbike', 'grabcar', 'grab bike', 'grab car', 'gojek', 'be group', 'be bike',
    'xanh sm', 'vinasun', 'mai linh', 'g7 taxi', 'taxi', 'lado', 'emddi', 'vato', 'xe om'],
  cinema: ['cgv', 'lotte cinema', 'bhd star', 'galaxy cinema', 'beta cinema', 'cinestar',
    'mega gs', 'dcine', 'rap phim'],
};

function deburr(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function poolOf(extraction) {
  const hay = ' ' + deburr((extraction.counterparty || '') + ' ' + (extraction.memo || '')) + ' ';
  for (const key of Object.keys(POOLS)) {
    for (const kw of POOLS[key]) {
      if (hay.indexOf(' ' + kw + ' ') >= 0) return key;
    }
  }
  return undefined;
}

/* The whole plaintext → the tiny enum that leaves this process.
 * c: concept | 'income' | 'unknown' · t: 1..4 · d: daypart | absent · p: pool. */
export function copyMeta(extraction) {
  if (!extraction) return { c: 'unknown', t: 2 };
  const flow = extraction.flow
    || (extraction.direction === 'credit' ? 'income' : 'expense');
  const t = tierOf(extraction.amount, extraction.currency);
  const d = dayPartOf(extraction.occurred_at);
  if (flow === 'income') { const m = { c: 'income', t }; if (d) m.d = d; return m; }
  if (flow === 'transfer') { const m = { c: 'unknown', t }; if (d) m.d = d; return m; }
  const c = CONCEPTS.indexOf(extraction.category) >= 0 ? extraction.category : 'unknown';
  const meta = { c, t };
  if (d) meta.d = d;
  const p = poolOf(extraction);
  if (p) meta.p = p;
  return meta;
}

/* ── Base matrix ─────────────────────────────────────────────────────────────
 * MATRIX[lang][concept][tier-1] = 4 variants of { e: face, b: text! }. Used when
 * no daypart applies (date-only rows, or concepts without a daypart set). */
const MATRIX = {
  vi: {
    Dining: [
      [{ e: '😋', b: 'Ăn vặt cho vui miệng, đừng quá tay nha!' }, { e: '😌', b: 'Lai rai chút đỉnh, nhớ ăn thật ngon!' }, { e: '😏', b: 'Buồn miệng là tay lại nhấp liền à!' }, { e: '🙂', b: 'Nhỏ xíu thôi, tha cho lần này!' }],
      [{ e: '😋', b: 'Ăn ngon nhớ ăn đủ chất nha!' }, { e: '😌', b: 'Bữa này ổn, mai nấu nhà đổi vị!' }, { e: '😏', b: 'Lại ăn ngoài nữa rồi đó nha!' }, { e: '😊', b: 'No rồi, uống thêm nước cho khoẻ!' }],
      [{ e: '😳', b: 'Bữa này xịn dữ, thỉnh thoảng thôi nha!' }, { e: '😆', b: 'Chi cho miệng ghê, mai ăn nhẹ lại!' }, { e: '😍', b: 'Cỡ này là đại tiệc, tận hưởng đi!' }, { e: '😌', b: 'Sang một bữa, cân lại sau nha!' }],
      [{ e: '😱', b: 'Ăn gì mà tốn dữ, mai tiết kiệm lại!' }, { e: '🫢', b: 'Ví khóc rồi, tuần sau cơm nhà nha!' }, { e: '🤑', b: 'Đại gia ẩm thực, nhớ giữ sức khoẻ!' }, { e: '😵‍💫', b: 'Tốn cỡ này, mai ăn nhẹ nhàng thôi!' }],
    ],
    Groceries: [
      [{ e: '😌', b: 'Ghé chợ tí mà đảm đang ghê!' }, { e: '🙂', b: 'Mua lặt vặt mà siêng thật đó!' }, { e: '😋', b: 'Chút rau chút thịt, ăn nhà cho lành!' }, { e: '😊', b: 'Tay xách nách mang, chăm nhà ghê!' }],
      [{ e: '😌', b: 'Tủ lạnh đầy, tuần này ăn nhà cho khoẻ!' }, { e: '😊', b: 'Đi chợ về là bếp lại vui liền!' }, { e: '🥰', b: 'Nấu cơm nhà vừa rẻ vừa lành nha!' }, { e: '😍', b: 'Đảm đang quá, giữ nếp này nha!' }],
      [{ e: '😆', b: 'Trữ đồ dữ vậy, nhớ ăn cho hết!' }, { e: '😳', b: 'Chợ một chuyến bằng người ta ba!' }, { e: '😅', b: 'Bếp sắp thành siêu thị rồi đó!' }, { e: '😌', b: 'Mua nhiều thì lên thực đơn cho gọn!' }],
      [{ e: '😳', b: 'Chợ cỡ này là mở quán hả!' }, { e: '🫢', b: 'Ôm cả chợ về, nhớ đừng để phí!' }, { e: '😆', b: 'Tủ lạnh chắc không đủ chứa luôn!' }, { e: '🤩', b: 'Đảm đang cỡ này đáng nể thật!' }],
    ],
    Clothing: [
      [{ e: '😌', b: 'Món nhỏ điệu chút, ai chê nào!' }, { e: '🙂', b: 'Sắm tí cho xinh, vừa phải thôi nha!' }, { e: '😊', b: 'Thêm món nhỏ cho tủ đỡ buồn!' }, { e: '😏', b: 'Điệu vừa vừa thôi nha bạn!' }],
      [{ e: '😏', b: 'Lại sắm đồ mới nữa rồi hả!' }, { e: '😍', b: 'Diện lên chắc xinh, nhớ mặc nhiều nha!' }, { e: '😆', b: 'Tủ đồ chật thêm chút nữa rồi!' }, { e: '😌', b: 'Đẹp thì đẹp, chọn đồ bền mà mặc!' }],
      [{ e: '😳', b: 'Đầu tư nhan sắc dữ ta nha!' }, { e: '😍', b: 'Món này ưng lắm mới rước ha!' }, { e: '😎', b: 'Sang lên hẳn, mặc cho đáng nha!' }, { e: '😌', b: 'Mua ít mà chất còn hơn nhiều!' }],
      [{ e: '😱', b: 'Sắm đồ mà tốn cỡ này luôn!' }, { e: '🫢', b: 'Ví gầy vì đẹp, phanh lại chút nha!' }, { e: '😏', b: 'Tín đồ thời trang đây rồi nha!' }, { e: '😵‍💫', b: 'Đẹp thật nhưng tháng này nhẹ tay lại!' }],
    ],
    Shopping: [
      [{ e: '😌', b: 'Mua vui tí thôi, kệ đi nha!' }, { e: '🙂', b: 'Lặt vặt cho đời thêm chút vui!' }, { e: '😊', b: 'Món nhỏ này khỏi cần lý do!' }, { e: '😉', b: 'Tự thưởng tí, đừng thành thói quen nha!' }],
      [{ e: '😏', b: 'Lại lướt sàn nữa rồi hả!' }, { e: '😌', b: 'Món ngắm lâu rồi, xài cho đáng nha!' }, { e: '😆', b: 'Giỏ hàng cười mà ví hơi mếu!' }, { e: '😎', b: 'Thích thì mua, nhớ dùng cho hết!' }],
      [{ e: '😳', b: 'Chốt món to gớm ta ơi!' }, { e: '😏', b: 'Xuống tiền dứt khoát ghê chưa!' }, { e: '😌', b: 'Món lớn về, nhớ xài cho đáng nha!' }, { e: '🤩', b: 'Sộp thật, mà nhớ cân đối chút nha!' }],
      [{ e: '😱', b: 'Mua gì mà dữ vậy trời!' }, { e: '🫢', b: 'Ví bay màu, tháng này phanh lại nha!' }, { e: '😎', b: 'Chi lớn không chớp mắt luôn á!' }, { e: '😵‍💫', b: 'Xót ví chưa, lần sau tính kỹ nha!' }],
    ],
    Transport: [
      [{ e: '😌', b: 'Gửi xe tí cho yên tâm nha!' }, { e: '🙂', b: 'Đi gần thôi mà cũng tính à!' }, { e: '😊', b: 'Chuyến ngắn, đi bộ được càng khoẻ!' }, { e: '😏', b: 'Tiết kiệm sức chân, khôn đó nha!' }],
      [{ e: '😌', b: 'Lại đi xe nữa rồi nha!' }, { e: '😎', b: 'Có người chở, ngồi thảnh thơi ghê!' }, { e: '😏', b: 'Đổ xăng đầy, chạy đâu cũng tự tin!' }, { e: '😌', b: 'Tiền xe đổi lấy thời gian, đáng nha!' }],
      [{ e: '😳', b: 'Đi xa dữ ta, chơi lớn ha!' }, { e: '😎', b: 'Chuyến này sang, đi cho đáng nha!' }, { e: '🤨', b: 'Xăng xe cỡ này đi đâu vậy!' }, { e: '😌', b: 'Đi lại nhiều nhớ giữ sức khoẻ nha!' }],
      [{ e: '😱', b: 'Đi đâu mà tốn dữ vậy trời!' }, { e: '🫢', b: 'Chuyến này chắc đi xa lắm đây!' }, { e: '😵‍💫', b: 'Ví ngồi ghế VIP luôn rồi đó!' }, { e: '🤩', b: 'Sang thật, đi an toàn về kể nha!' }],
    ],
    Housing: [
      [{ e: '😌', b: 'Chút phí cho nhà chạy êm nha!' }, { e: '🙂', b: 'Lo nhà từ mấy khoản nhỏ nè!' }, { e: '😊', b: 'Chăm nhà sớm cho đỡ tốn lớn sau!' }, { e: '😌', b: 'Nhà đỡ trục trặc là vui rồi!' }],
      [{ e: '😮‍💨', b: 'Hoá đơn tới, đóng đủ rồi thở phào!' }, { e: '😌', b: 'Đóng sớm cho nhẹ đầu, ngủ ngon nha!' }, { e: '🥰', b: 'Điện nước đủ, nhà mới thành tổ ấm!' }, { e: '😅', b: 'Khoản này chán mà nhà cần thật!' }],
      [{ e: '😳', b: 'Tháng này nhà tốn dữ ta!' }, { e: '😅', b: 'Máy lạnh chạy hết ga rồi hả!' }, { e: '😮‍💨', b: 'Nuôi cái nhà cũng cực ghê nha!' }, { e: '😌', b: 'Xài điện nước khéo lại cho đỡ tốn!' }],
      [{ e: '😱', b: 'Nhà cửa nuốt tiền dữ vậy trời!' }, { e: '🫢', b: 'Khoản lớn cho tổ ấm, đáng mà!' }, { e: '😵‍💫', b: 'Ví lo cho chỗ ngủ hết mình luôn!' }, { e: '🤩', b: 'Tốn thật nhưng nhà lên đời hẳn!' }],
    ],
    Fun: [
      [{ e: '😌', b: 'Vui tí cho đời dễ thở nha!' }, { e: '🙂', b: 'Xả stress chút, ai trách gì đâu!' }, { e: '😊', b: 'Niềm vui nhỏ mà quý lắm đó!' }, { e: '😏', b: 'Chơi nhẹ thôi, mai còn cày nha!' }],
      [{ e: '😎', b: 'Chơi hết mình rồi mai cày lại!' }, { e: '😌', b: 'Vui có chừng mực thì vui dài nha!' }, { e: '😊', b: 'Nạp tí vui cho tinh thần khoẻ!' }, { e: '😏', b: 'Đúng lúc thì tiêu cũng đáng nha!' }],
      [{ e: '😆', b: 'Chơi lớn ha, vui cho đã nha!' }, { e: '😍', b: 'Trải nghiệm này đáng đồng tiền đó!' }, { e: '🤩', b: 'Xõa cỡ này nhớ giữ sức nha!' }, { e: '😎', b: 'Vui ra trò, mai lấy đà làm việc!' }],
      [{ e: '😱', b: 'Chơi gì mà tốn dữ vậy trời!' }, { e: '🫢', b: 'Cuộc vui này ví trả giá đó!' }, { e: '😵‍💫', b: 'Xõa hết cỡ, tháng sau nhẹ tay nha!' }, { e: '🤩', b: 'Đáng đời một chuyến, nhớ nghỉ ngơi nha!' }],
    ],
    Others: [
      [{ e: '🙂', b: 'Khoản nhỏ ghé qua, nhẹ nhàng thôi!' }, { e: '😌', b: 'Lặt vặt tí, đời là vậy mà!' }, { e: '😊', b: 'Cái này chắc nhớ liền là gì!' }, { e: '😉', b: 'Nhỏ xíu, ghi cho gọn sổ nha!' }],
      [{ e: '🤨', b: 'Khoản này là gì thế ta!' }, { e: '😌', b: 'Tiền đi có việc của nó mà!' }, { e: '😅', b: 'Ghi rõ kẻo mai lại quên nha!' }, { e: '😏', b: 'Chuyện gì đây, khai thật đi nào!' }],
      [{ e: '🤨', b: 'Khoản kha khá, khai báo đi nào!' }, { e: '😳', b: 'Cái này đáng để ý đó nha!' }, { e: '😌', b: 'Tiền đi đâu nhớ ghi rõ nha!' }, { e: '😬', b: 'Số này không nhỏ đâu nha!' }],
      [{ e: '😳', b: 'Khoản lớn mà bí ẩn ghê ta!' }, { e: '😱', b: 'Tiền bay đi đâu vậy trời!' }, { e: '🫢', b: 'Khai thật đi, tốn gì lớn vậy!' }, { e: '😵‍💫', b: 'Số này phải xem cho kỹ nha!' }],
    ],
    income: [
      [{ e: '😊', b: 'Có đồng vô, cười cái đã nha!' }, { e: '🙂', b: 'Tiền lẻ cũng quý, gom dần nha!' }, { e: '😌', b: 'Nhỏ mà có còn hơn không nha!' }, { e: '😄', b: 'Ting ting nhẹ, để dành luôn nha!' }],
      [{ e: '🤑', b: 'Tiền về rồi, để dành trước nha!' }, { e: '😍', b: 'Có khoản vô, chia ra tiêu khéo nha!' }, { e: '😌', b: 'Ví ấm lại rồi, đừng tiêu vội nha!' }, { e: '😎', b: 'Tiền vô đều, nhớ tiết kiệm nha!' }],
      [{ e: '🤩', b: 'Khoản bự về, để dành một phần nha!' }, { e: '😏', b: 'Tiền về đậm, thưởng nhẹ thôi nha!' }, { e: '😆', b: 'Ví cười tới mang tai luôn á!' }, { e: '😌', b: 'Vô mạnh vậy, lên kế hoạch giữ tiền!' }],
      [{ e: '🤩', b: 'Tiền về khủng, chia phần tương lai nha!' }, { e: '🤑', b: 'Đại gia đây rồi, đầu tư khôn nha!' }, { e: '😎', b: 'Giàu rồi, để dành trước khi tiêu nha!' }, { e: '😌', b: 'Số đẹp về, bình tĩnh phân bổ nha!' }],
    ],
    unknown: [
      [{ e: '🙂', b: 'Có khoản mới, ghé xem chút nha!' }, { e: '😌', b: 'Tiền vừa nhúc nhích tí đó nha!' }, { e: '😊', b: 'Dòng mới trong sổ, xem thử nha!' }, { e: '😉', b: 'Nhỏ thôi, liếc một cái cho rõ!' }],
      [{ e: '🤨', b: 'Khoản này là gì thế ta!' }, { e: '😏', b: 'Có giao dịch mới, vào xem nha!' }, { e: '😌', b: 'Tiền vừa đi, xem chút cho rõ!' }, { e: '😊', b: 'Sổ có dòng mới rồi đó nha!' }],
      [{ e: '😳', b: 'Khoản kha khá, ghé xem liền nha!' }, { e: '🤨', b: 'Cái này đáng liếc một cái đó!' }, { e: '😬', b: 'Số này không nhỏ đâu nha!' }, { e: '😌', b: 'Đáng chú ý đó, xem cho chắc nha!' }],
      [{ e: '😱', b: 'Khoản lớn vừa xuất hiện kìa!' }, { e: '🫢', b: 'Tiền bự đi đâu vậy trời!' }, { e: '😵‍💫', b: 'Cái này phải xem tận nơi nha!' }, { e: '😬', b: 'Số lớn đó, xem cho chắc nha!' }],
    ],
  },
  en: {
    Dining: [
      [{ e: '😋', b: 'Snacking for fun, just do not overdo it!' }, { e: '😌', b: 'A little nibble, savor it slowly!' }, { e: '😏', b: 'Bored mouth, busy hands again huh!' }, { e: '🙂', b: 'Tiny one, you are forgiven!' }],
      [{ e: '😋', b: 'Eat well, but eat properly too!' }, { e: '😌', b: 'Decent meal, cook home next time!' }, { e: '😏', b: 'Eating out again, are we!' }, { e: '😊', b: 'Full now, drink some water too!' }],
      [{ e: '😳', b: 'Posh meal, keep it occasional!' }, { e: '😆', b: 'Spoiling that mouth, eat light tomorrow!' }, { e: '😍', b: 'A feast this size, enjoy it!' }, { e: '😌', b: 'One fancy meal, balance it later!' }],
      [{ e: '😱', b: 'What a bill, save up tomorrow!' }, { e: '🫢', b: 'Wallet cried, home cooking next week!' }, { e: '🤑', b: 'Food tycoon, mind your health too!' }, { e: '😵‍💫', b: 'Big spend, eat lighter tomorrow please!' }],
    ],
    Groceries: [
      [{ e: '😌', b: 'Quick market run, so responsible!' }, { e: '🙂', b: 'Little errands, so diligent you!' }, { e: '😋', b: 'Greens and meat, home food is healthy!' }, { e: '😊', b: 'Hands full, caring for home!' }],
      [{ e: '😌', b: 'Full fridge, eat home and stay healthy!' }, { e: '😊', b: 'Market run, the kitchen cheers!' }, { e: '🥰', b: 'Home cooking, cheap and wholesome!' }, { e: '😍', b: 'So domestic, keep this habit!' }],
      [{ e: '😆', b: 'Stocking up, remember to eat it all!' }, { e: '😳', b: 'One trip, enough for many!' }, { e: '😅', b: 'Kitchen becoming a supermarket now!' }, { e: '😌', b: 'Bought lots, plan the meals well!' }],
      [{ e: '😳', b: 'Opening a restaurant or what!' }, { e: '🫢', b: 'Whole market home, waste nothing please!' }, { e: '😆', b: 'Fridge cannot hold all this!' }, { e: '🤩', b: 'Domestic hero, truly impressive!' }],
    ],
    Clothing: [
      [{ e: '😌', b: 'A small piece, why not!' }, { e: '🙂', b: 'Little treat to look cute, easy there!' }, { e: '😊', b: 'One more thing to wear!' }, { e: '😏', b: 'Stay cute, but keep it modest!' }],
      [{ e: '😏', b: 'New clothes again, are we!' }, { e: '😍', b: 'Bet you look great, wear it often!' }, { e: '😆', b: 'Closet getting a bit tighter!' }, { e: '😌', b: 'Pretty, but pick pieces that last!' }],
      [{ e: '😳', b: 'Investing in the looks, huh!' }, { e: '😍', b: 'Must have loved that one!' }, { e: '😎', b: 'Levelled up, wear it plenty!' }, { e: '😌', b: 'Fewer but better beats more!' }],
      [{ e: '😱', b: 'That is a lot for clothes!' }, { e: '🫢', b: 'Wallet slimmed, ease off a bit!' }, { e: '😏', b: 'A certified fashionista right here!' }, { e: '😵‍💫', b: 'Gorgeous, but go gentle this month!' }],
    ],
    Shopping: [
      [{ e: '😌', b: 'A little fun buy, fine!' }, { e: '🙂', b: 'Small stuff, a bit more joy!' }, { e: '😊', b: 'No reason needed for this!' }, { e: '😉', b: 'A treat, just not a habit!' }],
      [{ e: '😏', b: 'Browsing the apps again, huh!' }, { e: '😌', b: 'Eyed it for ages, use it well!' }, { e: '😆', b: 'Cart smiles, wallet weeps!' }, { e: '😎', b: 'Like it, buy it, use it fully!' }],
      [{ e: '😳', b: 'Big-ticket checkout, look at you!' }, { e: '😏', b: 'Checked out without a flinch!' }, { e: '😌', b: 'Big buy home, make it count!' }, { e: '🤩', b: 'Big spender, but stay balanced!' }],
      [{ e: '😱', b: 'What did you even buy!' }, { e: '🫢', b: 'Wallet vanished, ease off this month!' }, { e: '😎', b: 'Spent big without a blink!' }, { e: '😵‍💫', b: 'Feel that ache, plan better next time!' }],
    ],
    Transport: [
      [{ e: '😌', b: 'Parking fee, playing it safe!' }, { e: '🙂', b: 'Charging even a short hop!' }, { e: '😊', b: 'Short ride, walking would be healthier!' }, { e: '😏', b: 'Saving your legs, smart move!' }],
      [{ e: '😌', b: 'Booking a ride again, huh!' }, { e: '😎', b: 'Let someone else drive, nice!' }, { e: '😏', b: 'Full tank, go anywhere confident!' }, { e: '😌', b: 'Ride money buys time, fair!' }],
      [{ e: '😳', b: 'Going far, big plans huh!' }, { e: '😎', b: 'A posh trip, make it worth it!' }, { e: '🤨', b: 'That much fuel, going where!' }, { e: '😌', b: 'Travelling lots, mind your rest!' }],
      [{ e: '😱', b: 'Where are you even going!' }, { e: '🫢', b: 'Quite the journey this time!' }, { e: '😵‍💫', b: 'Wallet riding first class now!' }, { e: '🤩', b: 'So fancy, travel safe and tell us!' }],
    ],
    Housing: [
      [{ e: '😌', b: 'Small fee, house runs smooth!' }, { e: '🙂', b: 'Caring for home, bit by bit!' }, { e: '😊', b: 'Fix early to avoid big costs later!' }, { e: '😌', b: 'Fewer squeaks, a small win!' }],
      [{ e: '😮‍💨', b: 'Bills came, paid and relieved!' }, { e: '😌', b: 'Paid early, lighter head, sleep well!' }, { e: '🥰', b: 'Power and water on, now it is home!' }, { e: '😅', b: 'Boring bill, but the home needs it!' }],
      [{ e: '😳', b: 'The house ate a lot lately!' }, { e: '😅', b: 'The AC ran full blast, huh!' }, { e: '😮‍💨', b: 'Keeping a home is tiring!' }, { e: '😌', b: 'Use power wisely to trim it down!' }],
      [{ e: '😱', b: 'The house is devouring cash!' }, { e: '🫢', b: 'A big one for the nest, fair!' }, { e: '😵‍💫', b: 'Wallet invested in your sleep!' }, { e: '🤩', b: 'Costly, but the home shines now!' }],
    ],
    Fun: [
      [{ e: '😌', b: 'A little fun, breathe easier!' }, { e: '🙂', b: 'Blow off steam, no judgment!' }, { e: '😊', b: 'Small joys matter, you know!' }, { e: '😏', b: 'Play light, work waits tomorrow!' }],
      [{ e: '😎', b: 'Play hard, grind tomorrow, fair!' }, { e: '😌', b: 'Fun in moderation lasts longer!' }, { e: '😊', b: 'Feeding the soul keeps you well!' }, { e: '😏', b: 'Right time, worth every bit!' }],
      [{ e: '😆', b: 'Going big, enjoy it fully!' }, { e: '😍', b: 'This experience is worth it!' }, { e: '🤩', b: 'Party hard, but keep your energy!' }, { e: '😎', b: 'One proper blast, well earned!' }],
      [{ e: '😱', b: 'What kind of fun costs this!' }, { e: '🫢', b: 'This good time cost plenty!' }, { e: '😵‍💫', b: 'Went all out, ease off next month!' }, { e: '🤩', b: 'Worth remembering, now get some rest!' }],
    ],
    Others: [
      [{ e: '🙂', b: 'A small one dropped by!' }, { e: '😌', b: 'Little bits, that is life!' }, { e: '😊', b: 'Bet you recall this one!' }, { e: '😉', b: 'Tiny, just tidy the books!' }],
      [{ e: '🤨', b: 'What even is this one!' }, { e: '😌', b: 'Money moved for a reason!' }, { e: '😅', b: 'Note it before you forget!' }, { e: '😏', b: 'What was this, confess now!' }],
      [{ e: '🤨', b: 'A biggish one, please explain!' }, { e: '😳', b: 'This one deserves a look!' }, { e: '😌', b: 'Where did it go, note it!' }, { e: '😬', b: 'Not a small one, careful!' }],
      [{ e: '😳', b: 'A big mystery charge, hmm!' }, { e: '😱', b: 'Where did all that go!' }, { e: '🫢', b: 'Confess, what cost this much!' }, { e: '😵‍💫', b: 'This one needs a close look!' }],
    ],
    income: [
      [{ e: '😊', b: 'Money in, allow a smile!' }, { e: '🙂', b: 'Small change counts, save it up!' }, { e: '😌', b: 'Something beats nothing, right!' }, { e: '😄', b: 'Little ting, tuck it away!' }],
      [{ e: '🤑', b: 'Money is in, save some first!' }, { e: '😍', b: 'Something landed, spend it wisely!' }, { e: '😌', b: 'Wallet warm again, no rush spending!' }, { e: '😎', b: 'Steady income, keep saving though!' }],
      [{ e: '🤩', b: 'Big one landed, set some aside!' }, { e: '😏', b: 'Rich arrival, treat yourself lightly!' }, { e: '😆', b: 'Wallet grinning ear to ear!' }, { e: '😌', b: 'Nice haul, make a plan for it!' }],
      [{ e: '🤩', b: 'Huge arrival, save the future first!' }, { e: '🤑', b: 'Big shot now, invest it smart!' }, { e: '😎', b: 'Rich now, save before you spend!' }, { e: '😌', b: 'Lovely number, allocate it calmly!' }],
    ],
    unknown: [
      [{ e: '🙂', b: 'New entry, come take a peek!' }, { e: '😌', b: 'Money just twitched a little!' }, { e: '😊', b: 'A new line in the book!' }, { e: '😉', b: 'Tiny one, a quick glance!' }],
      [{ e: '🤨', b: 'What even is this one!' }, { e: '😏', b: 'New transaction, come have a look!' }, { e: '😌', b: 'Money moved, take a look!' }, { e: '😊', b: 'A new line just landed!' }],
      [{ e: '😳', b: 'A biggish one, come look!' }, { e: '🤨', b: 'This deserves a quick glance!' }, { e: '😬', b: 'Not a small one, careful!' }, { e: '😌', b: 'Worth noticing, take a look!' }],
      [{ e: '😱', b: 'A big one just appeared!' }, { e: '🫢', b: 'Where did that money go!' }, { e: '😵‍💫', b: 'This needs an in-person look!' }, { e: '😬', b: 'Big number, check it carefully!' }],
    ],
  },
};

/* ── Daypart overrides ──────────────────────────────────────────────────────
 * For Dining & Groceries: used (over the tier line) when a real clock time is
 * known. 2 variants of { e, b } per part. */
const DAYPART = {
  vi: {
    Dining: {
      sang: [{ e: '😋', b: 'Ăn sáng đủ chất, ngày dài mới khoẻ!' }, { e: '😌', b: 'Sáng ăn ngon miệng, cả ngày hứng khởi!' }],
      trua: [{ e: '😊', b: 'Cơm trưa xong, nghỉ chút rồi làm tiếp!' }, { e: '😌', b: 'Trưa ăn vừa đủ, chiều đỡ buồn ngủ!' }],
      chieu: [{ e: '😏', b: 'Xế chiều buồn miệng, ăn nhẹ thôi nha!' }, { e: '😋', b: 'Ăn xế chút cho tỉnh, đừng quá tay!' }],
      toi: [{ e: '😌', b: 'Bữa tối thong thả, ăn sớm dễ ngủ!' }, { e: '😊', b: 'Tối ăn nhẹ nhàng, bụng nhẹ ngủ ngon!' }],
    },
    Groceries: {
      sang: [{ e: '😌', b: 'Đi chợ sáng đồ tươi, khéo ghê!' }, { e: '😋', b: 'Chợ sáng rau cá tươi, chuẩn bài!' }],
      trua: [{ e: '🙂', b: 'Tranh thủ trưa đi chợ, siêng thật!' }, { e: '😌', b: 'Chợ trưa nhanh gọn, về nấu liền nha!' }],
      chieu: [{ e: '😌', b: 'Chợ chiều lo bữa tối, nấu nhà cho lành!' }, { e: '😊', b: 'Tan làm ghé chợ, cơm nhà rẻ ngon!' }],
      toi: [{ e: '😊', b: 'Đi siêu thị tối, tranh thủ ghê ta!' }, { e: '😌', b: 'Mua đồ tối xong nhớ nghỉ sớm nha!' }],
    },
  },
  en: {
    Dining: {
      sang: [{ e: '😋', b: 'Hearty breakfast, energy for the day!' }, { e: '😌', b: 'A good morning meal, off you go!' }],
      trua: [{ e: '😊', b: 'Lunch done, rest a bit then back!' }, { e: '😌', b: 'Light lunch keeps the afternoon sharp!' }],
      chieu: [{ e: '😏', b: 'Afternoon craving, keep the snack light!' }, { e: '😋', b: 'A little pick-me-up, do not overdo it!' }],
      toi: [{ e: '😌', b: 'Easy dinner, eat early to sleep well!' }, { e: '😊', b: 'Light supper, lighter belly, better sleep!' }],
    },
    Groceries: {
      sang: [{ e: '😌', b: 'Morning market, freshest picks, nicely done!' }, { e: '😋', b: 'Fresh greens and fish at dawn!' }],
      trua: [{ e: '🙂', b: 'Squeezed in a noon run, diligent!' }, { e: '😌', b: 'Quick noon shop, cook it fresh!' }],
      chieu: [{ e: '😌', b: 'Afternoon shop for dinner, cook home healthy!' }, { e: '😊', b: 'After-work run, home food beats takeout!' }],
      toi: [{ e: '😊', b: 'Evening market run, squeezing it in!' }, { e: '😌', b: 'Late shop done, get some rest!' }],
    },
  },
};

/* ── Keyword pools ──────────────────────────────────────────────────────────
 * The only place copy is allowed to be specific (merchant said so). Base lines
 * + daypart overrides for coffee & milk tea. */
const POOL_LINES = {
  vi: {
    coffee: [{ e: '😌', b: 'Cà phê nạp năng lượng, nhớ uống nước nha!' }, { e: '😏', b: 'Lại cà phê nữa rồi hả bạn!' }, { e: '😎', b: 'Tỉnh rồi thì làm cho đáng ly nha!' }, { e: '😋', b: 'Cà phê là chân ái, vừa phải thôi!' }],
    milktea: [{ e: '😋', b: 'Trà sữa là niềm vui hợp pháp mà!' }, { e: '😆', b: 'Topping đầy, đường ít lại nha!' }, { e: '😌', b: 'Một ly hạnh phúc, đừng nhiều quá nha!' }, { e: '😏', b: 'Ngọt miệng mà nhớ giữ dáng nha!' }],
    ride: [{ e: '😎', b: 'Có người chở, ngồi thảnh thơi ghê!' }, { e: '😏', b: 'Lười đi bộ thì chịu chi thôi!' }, { e: '😌', b: 'Tiền xe mua sự đúng giờ, đáng nha!' }, { e: '😉', b: 'Đi xe an toàn là trên hết nha!' }],
    cinema: [{ e: '😌', b: 'Xem phim thư giãn, xứng đáng mà!' }, { e: '😆', b: 'Bắp nước chắc mắc hơn vé luôn!' }, { e: '😎', b: 'Hai tiếng rời điện thoại, khoẻ đầu óc!' }, { e: '😏', b: 'Phim hay dở gì cũng vui mà!' }],
  },
  en: {
    coffee: [{ e: '😌', b: 'Coffee for a boost, drink water too!' }, { e: '😏', b: 'Coffee again, are we!' }, { e: '😎', b: 'Awake now, make it count!' }, { e: '😋', b: 'Coffee is love, just not too much!' }],
    milktea: [{ e: '😋', b: 'Milk tea, the legal little joy!' }, { e: '😆', b: 'Full toppings, go easy on sugar!' }, { e: '😌', b: 'One cup of happiness, not too many!' }, { e: '😏', b: 'Sweet treat, mind the waistline!' }],
    ride: [{ e: '😎', b: 'Someone else drives, sit back nicely!' }, { e: '😏', b: 'Too lazy to walk, huh!' }, { e: '😌', b: 'Ride money buys punctuality, fair!' }, { e: '😉', b: 'Safe ride first, always!' }],
    cinema: [{ e: '😌', b: 'A movie to unwind, worth it!' }, { e: '😆', b: 'Popcorn costs more than tickets!' }, { e: '😎', b: 'Two hours off the phone, refreshing!' }, { e: '😏', b: 'Good or bad, still fun!' }],
  },
};

const POOL_DAYPART = {
  vi: {
    coffee: {
      sang: [{ e: '😌', b: 'Cà phê sáng cho tỉnh, thêm ly nước nha!' }, { e: '😊', b: 'Sáng làm ly cà phê, sẵn sàng cày!' }],
      trua: [{ e: '😏', b: 'Cà phê trưa chống buồn ngủ hả!' }, { e: '😌', b: 'Trưa một ly cho tỉnh, chiều đỡ gục!' }],
      chieu: [{ e: '😪', b: 'Cà phê chiều tỉnh táo, tối ngủ sớm nha!' }, { e: '😌', b: 'Xế làm ly nữa, nhớ uống thêm nước!' }],
      toi: [{ e: '😏', b: 'Cà phê giờ này, đêm nay khó ngủ đó!' }, { e: '😅', b: 'Tối còn cà phê, mai đừng than mệt!' }],
    },
    milktea: {
      sang: [{ e: '😌', b: 'Sáng sớm trà sữa, ngọt ghê ta!' }, { e: '😋', b: 'Sáng ngọt tí, chiều nhớ bớt lại nha!' }],
      trua: [{ e: '😊', b: 'Trà sữa trưa cho vui, ít đường nha!' }, { e: '😌', b: 'Trưa ngọt tí cũng được, đừng nhiều quá!' }],
      chieu: [{ e: '😋', b: 'Chiều buồn ngủ làm ly trà sữa hả!' }, { e: '😏', b: 'Trà sữa xế chiều, topping vừa phải nha!' }],
      toi: [{ e: '😌', b: 'Trà sữa tối, ít đường ngủ ngon nha!' }, { e: '😅', b: 'Ngọt buổi tối, nhớ đánh răng nha!' }],
    },
  },
  en: {
    coffee: {
      sang: [{ e: '😌', b: 'Morning coffee to wake up, water too!' }, { e: '😊', b: 'A morning cup, ready to grind!' }],
      trua: [{ e: '😏', b: 'Noon coffee fighting the slump huh!' }, { e: '😌', b: 'A midday cup keeps you sharp!' }],
      chieu: [{ e: '😪', b: 'Afternoon coffee, sleep early tonight!' }, { e: '😌', b: 'Another cup, drink some water too!' }],
      toi: [{ e: '😏', b: 'Coffee this late, sleep will suffer!' }, { e: '😅', b: 'Evening coffee, do not blame us tomorrow!' }],
    },
    milktea: {
      sang: [{ e: '😌', b: 'Milk tea this early, so sweet!' }, { e: '😋', b: 'Sweet start, ease off later today!' }],
      trua: [{ e: '😊', b: 'Noon milk tea, go easy on sugar!' }, { e: '😌', b: 'A little sweet is fine, not much!' }],
      chieu: [{ e: '😋', b: 'Afternoon slump, milk tea to the rescue!' }, { e: '😏', b: 'Afternoon cup, keep toppings modest!' }],
      toi: [{ e: '😌', b: 'Milk tea tonight, less sugar for sleep!' }, { e: '😅', b: 'Sweet at night, brush your teeth!' }],
    },
  },
};

function _pick(arr, r) {
  const v = arr[Math.floor(r * arr.length) % arr.length];
  return { title: v.e, body: v.b };
}

/* meta {c,t,d,p} → { title: emoji, body: text! } about THIS transaction. Pool
 * wins (with a daypart variant if the pool has one), then a concept daypart
 * override, then the tier line. A missing cell degrades to unknown/t2. */
export function reviewBody(meta, lang, rnd) {
  const lg = lang === 'en' ? 'en' : 'vi';
  const r = typeof rnd === 'number' ? rnd : Math.random();
  const m = meta && typeof meta === 'object' ? meta : {};
  if (m.p) {
    const pd = m.d && POOL_DAYPART[lg][m.p] && POOL_DAYPART[lg][m.p][m.d];
    const pool = pd || POOL_LINES[lg][m.p];
    if (pool) return _pick(pool, r);
  }
  const dc = m.d && DAYPART[lg][m.c] && DAYPART[lg][m.c][m.d];
  if (dc) return _pick(dc, r);
  const rows = MATRIX[lg][m.c] || MATRIX[lg].unknown;
  const t = Math.min(4, Math.max(1, Number(m.t) || 2));
  const cell = rows[t - 1] || rows[1];
  return _pick(cell, r);
}

/* The one-time backfill digest — the single line allowed a number (a batch
 * size is not private). Same {title, body} shape; face in the title. */
export function digestBody(count, lang) {
  const n = Math.max(1, Number(count) || 1);
  return lang === 'en'
    ? { title: '🙂', body: `Found ${n} past transactions, review whenever you like!` }
    : { title: '🙂', body: `Đã tìm thấy ${n} giao dịch cũ, xem lúc rảnh nha!` };
}
