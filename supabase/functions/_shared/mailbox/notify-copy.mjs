/* notify-copy — the voice of the txn_review notification.
 *
 * The push payload carries NO amount, NO merchant, NO category name. Context
 * (category concept × amount tier × an optional merchant-keyword pool) is
 * distilled HERE, at the only moment the pipeline holds the plaintext, into a
 * tiny enum meta {c, t, p}. push-send turns that meta into one pre-written
 * body line — so what actually transits Apple/Google/Mozilla is a sentence
 * that asserts nothing private. The rule for every line in the matrix:
 * a template may only say what its cell guarantees. Anything more specific
 * (coffee, a ride, a movie) exists only behind a deterministic keyword match
 * on the merchant/memo, with the generic cell as the fallback.
 *
 * Body-only by design: the title is left empty and the service worker's
 * `d.title || 'Earthy'` fallback names the app. One emoji per line is content,
 * not UI. Vietnamese carries full diacritics. No call to action — the copy
 * informs, the person decides. */

const CONCEPTS = ['Housing', 'Groceries', 'Clothing', 'Shopping', 'Transport', 'Dining', 'Fun', 'Others'];

/* VND tiers. Tier 1 (≤30k) matches the client's photo-nudge floor so "too
 * small to photograph" and "lặt vặt" stay the same idea. A non-VND amount has
 * no honest tier — it reads as tier 2 (the neutral everyday voice) rather
 * than guessing through a conversion. */
const TIERS = [30000, 500000, 5000000];   // ≤ → t1, t2, t3; above the last → t4

function tierOf(amount, currency) {
  if (currency && currency !== 'VND') return 2;
  const a = Number(amount) || 0;
  if (a <= TIERS[0]) return 1;
  if (a <= TIERS[1]) return 2;
  if (a <= TIERS[2]) return 3;
  return 4;
}

/* Merchant/memo → pool key. Deburred, padded word match — the same trick the
 * client's category guesser uses — so "CA PHE PHUC LONG" hits and "Nguyen
 * Caraphe" does not. Expenses only: a refund FROM Starbucks is still income. */
const POOLS = {
  coffee: ['ca phe', 'cafe', 'coffee', 'highlands', 'phuc long', 'katinat', 'starbucks',
    'trung nguyen', 'cong ca phe', 'phe la', 'cheese coffee', 'guta', 'milano'],
  milktea: ['tra sua', 'gong cha', 'gongcha', 'koi the', 'toco toco', 'tocotoco',
    'bobapop', 'ding tea', 'mixue', 'phuc tea', 'boba'],
  ride: ['grab', 'gojek', 'be group', 'xanh sm', 'vinasun', 'mai linh', 'taxi'],
  cinema: ['cgv', 'lotte cinema', 'galaxy cinema', 'beta cinema', 'cinestar', 'mega gs'],
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
 * c: concept | 'income' | 'unknown' · t: 1..4 · p: pool key (expenses only). */
export function copyMeta(extraction) {
  if (!extraction) return { c: 'unknown', t: 2 };
  const flow = extraction.flow
    || (extraction.direction === 'credit' ? 'income' : 'expense');
  const t = tierOf(extraction.amount, extraction.currency);
  if (flow === 'income') return { c: 'income', t };
  if (flow === 'transfer') return { c: 'unknown', t };
  const c = CONCEPTS.indexOf(extraction.category) >= 0 ? extraction.category : 'unknown';
  const meta = { c, t };
  const p = poolOf(extraction);
  if (p) meta.p = p;
  return meta;
}

/* ── The matrix ──────────────────────────────────────────────────────────────
 * MATRIX[lang][concept][tier-1] = 4 variants, rotated at send time.
 * Voice: funny like a person, a light "tiêu khéo, sống khoẻ" undertone,
 * never preachy, never a call to action, no em-dashes, no slang the product
 * has banned ("chốt đơn"), nothing a wrong guess could contradict. */
const MATRIX = {
  vi: {
    Dining: [
      ['Khoản nhỏ xíu mà vui cả buổi thì quá hời 🍡',
        'Ăn vặt chút xíu, ngày dài cũng cần ngọt ngào mà 🍬',
        'Nhỏ thôi mà ấm bụng là được giá rồi 🥟',
        'Chút đồ ăn vặt đổi lấy tâm trạng tốt là lời rồi 🍢'],
      ['Ăn ngon là khoản đầu tư ít khi lỗ 🍜',
        'Bụng no thì đầu óc mới sáng suốt được 🍚',
        'Bữa ngon đúng lúc đáng giá hơn con số của nó 🥘',
        'Ăn uống tử tế cũng là một cách thương bản thân 🍲'],
      ['Bữa này chắc ngon lắm đây, nhớ ăn chậm thôi 🍽️',
        'Chắc là một bữa ra trò rồi. Ngon miệng nha 🥂',
        'Bữa lớn thì niềm vui phải lớn theo mới đáng 🍱',
        'Ăn sang một bữa, tuần sau cơm nhà bù lại là đẹp 🍛'],
      ['Bữa này tầm cỡ đó nha. Kỷ niệm thì phải xứng đáng 🥢',
        'Chắc là dịp đặc biệt rồi. Vui hết mình nha 🍾',
        'Một bữa đáng nhớ. Nhớ lâu một chút cho bõ 🥂',
        'Ăn lớn cỡ này thì niềm vui phải để dành kể lại 🍽️'],
    ],
    Groceries: [
      ['Ghé chợ chút xíu mà tủ đồ đỡ trống hẳn 🥬',
        'Thêm miếng rau miếng thịt, cơm nhà lại đủ vị 🍅',
        'Chút đồ lặt vặt cho căn bếp chạy êm 🧄',
        'Bếp không bao giờ thiếu được mấy món nhỏ này 🥚'],
      ['Tủ lạnh đầy là tuần này yên tâm một nửa rồi 🥬',
        'Đi chợ về là căn bếp lại có chuyện để kể 🍳',
        'Cơm nhà rẻ hơn cơm tiệm, mà thường còn ngon hơn 🥘',
        'Chợ búa đầy đủ, cả tuần đỡ phải nghĩ ăn gì 🧺'],
      ['Chuyến chợ lớn ha. Tuần này bếp đỏ lửa rồi 🍲',
        'Trữ đồ kiểu này là tính chuyện dài lâu rồi đó 🧺',
        'Đi chợ một lần cho cả tuần, tính vậy mà khôn 🥕',
        'Bếp đầy thì nhà ấm, tiền này đáng từng đồng 🍚'],
      ['Sắm sửa cỡ này chắc là chuẩn bị gì lớn lắm 🧺',
        'Trữ đồ tầm này thì cả tháng khỏi lo bếp trống 🥩',
        'Chuyến chợ hoành tráng đó. Nhớ xếp tủ lạnh cho khéo 🧊',
        'Mua lớn cho bếp là khoản ít khi phải tiếc 🍱'],
    ],
    Clothing: [
      ['Món nhỏ thôi mà mặc lên thấy khác liền 🧦',
        'Đồ nhỏ xinh, giá nhỏ xinh, vui cũng xinh 🎀',
        'Thêm một món nhỏ cho tủ đồ đỡ buồn 👕',
        'Chút xíu vậy mà tự nhiên thấy tươm tất hơn 🧢'],
      ['Mặc đẹp một chút, ngày thường cũng thành dịp 👗',
        'Đồ mới mặc lần đầu lúc nào cũng vui nhất 👕',
        'Tủ đồ có món mới, gương nhà sắp bận rộn rồi 🪞',
        'Mua đồ vừa vặn là tiết kiệm kiểu tinh tế đó 👖'],
      ['Món này chắc ưng lắm mới rước về ha 👗',
        'Đẹp thì đẹp thật, nhớ phối cho hết công suất nha 🧥',
        'Đồ tốt mặc được lâu, tính kỹ ra là hời 👞',
        'Một món đáng tiền còn hơn ba món để không 🧣'],
      ['Đầu tư cho ngoại hình cỡ này là nghiêm túc rồi 🧥',
        'Món lớn đó nha. Mặc thật nhiều vào cho xứng 👗',
        'Đồ xịn thì phải có dịp xịn, tự tạo dịp luôn nha 👠',
        'Sắm lớn rồi thì tủ đồ cũ chịu khó nhường chỗ 🧳'],
    ],
    Shopping: [
      ['Món nhỏ nhỏ vầy mua vui là chính ha 🎁',
        'Lặt vặt chút xíu, thêm một niềm vui nhỏ 🧸',
        'Mấy món nhỏ này hay ở chỗ không cần lý do 🎈',
        'Chút quà nhỏ cho chính mình, hợp lệ nha 🎀'],
      ['Đẹp thì đẹp thật, nhớ xài cho kỹ nha 🛍️',
        'Món này chắc nằm trong danh sách lâu rồi ha 📦',
        'Mua được món ưng ý là bớt lướt điện thoại cả tuần 🛒',
        'Thứ mình thích mà còn dùng được hằng ngày là chuẩn rồi 🎯'],
      ['Món đáng chú ý đó nha. Xài bền là hời 🛍️',
        'Cân nhắc rồi mới mua thì cứ vui thôi 📦',
        'Món lớn về nhà, nhớ cho nó được trọng dụng nha 🪑',
        'Đồ tốt không rẻ, nhưng đồ rẻ hay phải mua hai lần 🧰'],
      ['Khoản này ra tấm ra món rồi. Xài cho đã nha 📦',
        'Món lớn cỡ này chắc nghĩ kỹ lắm rồi. Chúc mừng nha 🎉',
        'Sắm lớn một lần, vui và xài được thật lâu 🛋️',
        'Đầu tư cỡ này thì món đồ phải làm việc chăm vào 🧰'],
    ],
    Transport: [
      ['Xe an toàn, lòng thanh thản 🛵',
        'Vài đồng gửi xe đổi lấy khỏi lo ngó chừng 🅿️',
        'Đi tới nơi về tới chốn là đáng giá rồi 🚌',
        'Chuyến ngắn thôi mà đỡ mỏi chân bao nhiêu 🚏'],
      ['Về tới nơi êm ru, đáng từng đồng 🛵',
        'Đường xa có người chở, mình ngồi thở cũng đáng 🚕',
        'Đổ xăng đầy bình, đi đâu cũng tự tin 🏍️',
        'Tiền đi lại là tiền mua thời gian đó nha ⛽'],
      ['Chuyến này dài ha. Đi đứng cẩn thận nha 🚗',
        'Đi xa một chuyến, về kể chuyện cho đã 🚄',
        'Lo xe cộ đàng hoàng thì đường nào cũng êm 🔧',
        'Chuyến đi đáng tiền nhất là chuyến về nhà an toàn 🛣️'],
      ['Chuyến lớn rồi đây. Đi bình an, về đầy chuyện vui ✈️',
        'Đi xa cỡ này là phải có ảnh đẹp mang về nha 🧳',
        'Khoản đi lại lớn thường đổi lấy kỷ niệm lớn ✈️',
        'Đường dài mới biết chuyến đi có đáng. Đi mạnh giỏi nha 🚄'],
    ],
    Housing: [
      ['Chút phí nhỏ cho căn nhà chạy êm 🔧',
        'Nhà cửa là vậy, li ti hoài mà thiếu là biết liền 🧰',
        'Khoản nhỏ thôi mà nhà đỡ trục trặc là vui 🏠',
        'Chăm nhà là chăm từ mấy khoản nhỏ này 🪛'],
      ['Nhà chạy êm là nhờ mấy khoản đều đặn này 💡',
        'Đóng đủ hoá đơn, tối về ngủ ngon 🏠',
        'Điện nước đủ đầy, nhà mới là tổ ấm 🔌',
        'Khoản này không vui mấy, nhưng nhà thì ấm thiệt 🧾'],
      ['Máy lạnh tháng này chạy hết mình rồi đó ⚡',
        'Hoá đơn cao là dấu hiệu nhà mình sống hết công suất 💡',
        'Nhà cửa tháng này tốn kha khá. Đáng, vì là nhà mình 🏠',
        'Khoản lo cho nhà chưa bao giờ là phí 🧱'],
      ['Khoản lớn cho căn nhà. Nhà bền thì mình an tâm 🏠',
        'Đầu tư cho chỗ mình ngủ mỗi tối, xứng đáng mà 🛏️',
        'Nhà được chăm lớn vậy chắc sắp đẹp lên trông thấy 🧱',
        'Tiền cho tổ ấm ít khi nào uổng lắm 🏡'],
    ],
    Fun: [
      ['Vui nhỏ nhỏ vầy là gia vị của tuần đó 🎈',
        'Chút niềm vui giá mềm, tinh thần lên liền 🎮',
        'Giải trí nhẹ nhàng, đầu óc nhẹ theo 🎧',
        'Khoản vui nhỏ mà đúng lúc thì quý lắm 🎪'],
      ['Chơi hết mình rồi mai làm tiếp, công bằng mà 🎬',
        'Niềm vui có giá cả rồi, khỏi thấy áy náy nha 🎡',
        'Tinh thần cũng cần được đầu tư như ví vậy 🎶',
        'Vui đúng chỗ thì đồng nào cũng đáng 🎳'],
      ['Chơi lớn ha. Nhớ vui cho đủ vốn nha 🎢',
        'Trải nghiệm là thứ xài hoài không cũ 🎭',
        'Khoản vui này chắc để dành kể dài dài 🎤',
        'Vui một trận ra trò, tuần sau lấy đà làm việc 🎉'],
      ['Chơi tầm này là kỷ niệm để đời rồi 🎆',
        'Khoản vui lớn nhất là khoản mình không hối hận 🎇',
        'Trải nghiệm lớn đáng tiền hơn món đồ lớn, thiệt đó 🎢',
        'Vui cỡ này thì phải vui cho hết mình mới hoà vốn 🎉'],
    ],
    Others: [
      ['Một khoản nhỏ vừa ghé qua, nhẹ nhàng thôi 🍃',
        'Lặt vặt chút xíu, cuộc sống là vậy mà 🌿',
        'Khoản nhỏ này chắc mình nhớ liền là gì ha 📎',
        'Nhỏ thôi, ghi lại cho sổ sách gọn gàng 🗂️'],
      ['Một khoản vừa ghé sổ, xem qua chút nha 📒',
        'Tiền đi có việc của nó, mình chỉ cần nhớ là được 🧭',
        'Khoản này chắc có câu chuyện riêng của nó 📌',
        'Ghi chú rõ ràng hôm nay, đỡ đoán mò mai sau 🗒️'],
      ['Khoản kha khá vừa ghé. Liếc qua một chút nha 📒',
        'Tầm này thì nên biết nó là gì cho chắc 🧾',
        'Khoản đáng chú ý đó, xem lại cho yên tâm 📋',
        'Con số này xứng đáng được một cái ghi chú tử tế 🖊️'],
      ['Khoản lớn đó nha. Hít thở sâu, vào xem lại cho chắc 💸',
        'Tầm này là phải biết mặt biết tên rõ ràng nha 🧾',
        'Số lớn vừa đi. Xem lại một chút cho chắc bụng 📒',
        'Khoản này lớn thiệt. Xem qua rồi hẵng yên tâm 🗂️'],
    ],
    income: [
      ['Có đồng vô nè, nhỏ mà có còn hơn không 🪙',
        'Tiền lẻ về ví, gom lại cũng thành chuyện lớn 🪙',
        'Một khoản nhỏ vừa về, vui nhẹ cái đã 🌱',
        'Tiền về là tin vui, cỡ nào cũng vậy 💌'],
      ['Tiền về rồi. Để dành trước, tiêu sau, nhẹ đầu 🎉',
        'Có khoản vừa hạ cánh. Chào mừng về nhà 🛬',
        'Tiền vô đều đều là nhịp sống đang ổn đó 🌤️',
        'Một khoản vừa về ví. Hôm nay dễ thương ghê 💚'],
      ['Khoản kha khá vừa về. Tính trước một phần để dành nha 🌳',
        'Tiền về đậm đà. Thưởng mình chút xíu cũng được 🎁',
        'Khoản này về là kế hoạch tháng này dễ thở hẳn 🌿',
        'Tin vui vừa hạ cánh, ví cười thấy rõ 😄'],
      ['Khoản lớn vừa về. Chúc mừng, nhớ chia phần cho tương lai 🌳',
        'Tiền về cỡ này là thành quả đó. Tự hào chút đi 🏆',
        'Số đẹp vừa hạ cánh. Bình tĩnh phân bổ rồi hẵng vui tiếp 💚',
        'Về đậm nha. Để dành một phần, phần còn lại sống cho đã 🌤️'],
    ],
    unknown: [
      ['Một khoản nhỏ vừa ghé sổ, xem qua chút nha 📥',
        'Có giao dịch vừa cập bến, liếc một cái cho rõ 🛳️',
        'Tiền vừa nhúc nhích nè, vào xem là chuyện gì ha 👀',
        'Một dòng mới trong sổ đang chờ mình đặt tên 🏷️'],
      ['Một khoản vừa ghé sổ, ghé xem cho rõ ngọn ngành 📒',
        'Có giao dịch mới nè, vào đặt tên cho nó nha 🏷️',
        'Tiền vừa di chuyển, mình là người hiểu nó nhất đó 👀',
        'Sổ vừa có dòng mới, xem qua là gọn 📥'],
      ['Khoản kha khá vừa ghé sổ, xem một chút cho chắc 🧾',
        'Tầm này thì đáng một cái liếc mắt đó nha 👀',
        'Một khoản đáng chú ý đang chờ mình gọi tên 📋',
        'Số này không nhỏ đâu, ghé xem cho rõ nha 📒'],
      ['Khoản lớn vừa ghé. Hít thở sâu rồi vào xem nha 💸',
        'Số lớn đó. Biết mặt đặt tên xong mới yên tâm được 🧾',
        'Tầm này là phải đích thân xem một cái rồi 📒',
        'Khoản bự vừa xuất hiện, xem lại một chút cho chắc bụng 👀'],
    ],
  },
  en: {
    Dining: [
      ['A tiny treat that carries the whole afternoon is a bargain 🍡',
        'A little snack, because long days need sweet minutes 🍬',
        'Small bite, warm belly, fair trade 🥟',
        'Snack money for a better mood is a win 🍢'],
      ['Good food is the one investment that rarely loses 🍜',
        'A full stomach makes a much smarter brain 🍚',
        'The right meal at the right time beats its own price 🥘',
        'Eating well is a quiet way of being kind to yourself 🍲'],
      ['That sounds like a proper meal. Eat it slowly 🍽️',
        'A real feast, by the looks of it. Enjoy 🥂',
        'A big meal deserves an equally big appetite 🍱',
        'One fancy meal now, home cooking evens it out later 🍛'],
      ['That was a serious meal. Occasions deserve it 🥢',
        'Must be a special day. Enjoy every bit of it 🍾',
        'A meal worth remembering. Remember it well 🥂',
        'Dining this big earns a story to retell 🍽️'],
    ],
    Groceries: [
      ['A quick market stop and the shelves feel alive again 🥬',
        'A few greens and things, dinner is sorted 🍅',
        'Little kitchen bits that keep everything running 🧄',
        'The kitchen never stops needing these small things 🥚'],
      ['A full fridge is half the week already handled 🥬',
        'A market run always gives the kitchen a story 🍳',
        'Home cooking costs less and usually tastes better 🥘',
        'Pantry stocked, one less thing to think about all week 🧺'],
      ['Big market run. The stove is busy this week 🍲',
        'Stocking up like that is long-term thinking 🧺',
        'One big shop for the whole week is clever math 🥕',
        'A full kitchen makes a warm home, worth every bit 🍚'],
      ['Stocking up this big, something must be coming 🧺',
        'A haul like that covers the kitchen for weeks 🥩',
        'Grand market trip. Pack that fridge wisely 🧊',
        'Big kitchen spending is the kind you rarely regret 🍱'],
    ],
    Clothing: [
      ['Small piece, instantly sharper 🧦',
        'Tiny thing, tiny price, real joy 🎀',
        'One small piece to cheer the wardrobe up 👕',
        'Little touch, suddenly more put together 🧢'],
      ['Dress a little better and an ordinary day feels like one 👗',
        'New clothes are never happier than the first wear 👕',
        'New piece in the wardrobe, the mirror will be busy 🪞',
        'Buying what truly fits is its own kind of saving 👖'],
      ['Must have really liked that one to bring it home 👗',
        'Lovely indeed, now style it to full capacity 🧥',
        'Good clothes last, which makes them a quiet bargain 👞',
        'One piece worth the money beats three that sit unworn 🧣'],
      ['That is a serious wardrobe investment 🧥',
        'A big one. Wear it often enough to earn it 👗',
        'Fancy clothes need fancy occasions, so make some 👠',
        'After a haul like that, the old clothes can step aside 🧳'],
    ],
    Shopping: [
      ['A little something just for the fun of it 🎁',
        'Small bits, one more small joy 🧸',
        'The best small buys need no reason at all 🎈',
        'A tiny gift to yourself is perfectly allowed 🎀'],
      ['Lovely thing, use it well 🛍️',
        'That one was probably on the list for a while 📦',
        'Finding the right thing saves a week of scrolling 🛒',
        'Something you love and use daily is the sweet spot 🎯'],
      ['A notable one. Make it last and it pays off 🛍️',
        'Thought it through first, so enjoy it fully 📦',
        'A big item deserves to be properly used 🪑',
        'Good things cost more, cheap things get bought twice 🧰'],
      ['Now that is a proper purchase. Use it a lot 📦',
        'A buy this size took real thought. Congrats 🎉',
        'One big buy, years of use, fair deal 🛋️',
        'An investment like that should work hard for you 🧰'],
    ],
    Transport: [
      ['Bike parked safe, mind at ease 🛵',
        'Small parking money buys zero worrying 🅿️',
        'Getting there and back is always worth it 🚌',
        'A short hop that saved the legs plenty 🚏'],
      ['Arrived smooth, worth every bit 🛵',
        'Someone else drives, you just breathe. Fair 🚕',
        'Full tank, full confidence 🏍️',
        'Transport money is really time money ⛽'],
      ['A long one. Travel safe out there 🚗',
        'Go far, come back with stories 🚄',
        'A well-kept vehicle makes every road smoother 🔧',
        'The best trip money buys is a safe ride home 🛣️'],
      ['A big journey. Go safely, return full of stories ✈️',
        'Going that far calls for good photos to bring back 🧳',
        'Big travel spending usually buys big memories ✈️',
        'Long roads show a trip its worth. Safe travels 🚄'],
    ],
    Housing: [
      ['A small fee that keeps the house humming 🔧',
        'Homes run on tiny costs you only notice when missing 🧰',
        'Small fix, fewer squeaks, good trade 🏠',
        'Caring for a home starts with the little bills 🪛'],
      ['A home runs smoothly on these steady bills 💡',
        'Bills paid, sleep earned 🏠',
        'Power and water in order, now it is truly home 🔌',
        'Not the fun kind of spending, but the warm kind 🧾'],
      ['The air con clearly gave its all this month ⚡',
        'A high bill means the house is fully lived in 💡',
        'The home cost a fair bit this month. Worth it, it is home 🏠',
        'Money spent on the house is rarely wasted 🧱'],
      ['A big one for the house. A solid home is peace of mind 🏠',
        'Investing in where you sleep every night makes sense 🛏️',
        'Care that size means the place is about to look better 🧱',
        'Money for the nest almost never goes to waste 🏡'],
    ],
    Fun: [
      ['Small joys are the seasoning of the week 🎈',
        'Cheap fun, instant morale 🎮',
        'Light entertainment, lighter head 🎧',
        'A small joy at the right moment is precious 🎪'],
      ['Play hard today, work resumes tomorrow. Fair 🎬',
        'The fun is paid for, so no guilt allowed 🎡',
        'Your spirit deserves investment too 🎶',
        'Fun in the right place is worth every bit 🎳'],
      ['Going big on fun. Enjoy it to full value 🎢',
        'Experiences never wear out 🎭',
        'This one sounds like a story for later 🎤',
        'One proper blast, then momentum for the week 🎉'],
      ['Fun at this scale becomes a lifetime memory 🎆',
        'The best fun money is the kind you never regret 🎇',
        'Big experiences outlast big things, truly 🎢',
        'At this size, enjoy it completely to break even 🎉'],
    ],
    Others: [
      ['A small one just passed through, nothing heavy 🍃',
        'Little bits and pieces, that is life 🌿',
        'A small one you can probably name right away 📎',
        'Tiny, but the ledger likes to be tidy 🗂️'],
      ['A new entry just landed, worth a quick look 📒',
        'Money left for a reason, you just need to remember it 🧭',
        'This one probably has its own little story 📌',
        'A clear note today saves guessing later 🗒️'],
      ['A decent-sized one just landed. Take a peek 📒',
        'At this size it is worth knowing what it was 🧾',
        'A notable entry, a quick check buys peace of mind 📋',
        'A number like this deserves a proper note 🖊️'],
      ['A big one. Deep breath, then a proper look 💸',
        'This size needs a name and a face 🧾',
        'Big money just moved. A look settles the mind 📒',
        'Genuinely large. Check it, then relax 🗂️'],
    ],
    income: [
      ['Money in! Small, but in is in 🪙',
        'Little drops fill the wallet too 🪙',
        'A small arrival, a small smile 🌱',
        'Incoming money is good news at any size 💌'],
      ['Money is in. Save first, spend after, sleep easy 🎉',
        'A fresh arrival just landed. Welcome home 🛬',
        'Steady money in means life is on rhythm 🌤️',
        'Something just arrived. Lovely day already 💚'],
      ['A decent arrival. Set a slice aside first 🌳',
        'A rich landing. A small treat for yourself is fine 🎁',
        'With this in, the month just got easier to breathe 🌿',
        'Good news landed, the wallet is visibly smiling 😄'],
      ['A big arrival. Congrats, and save the future its share 🌳',
        'Money at this scale is an achievement. Be proud 🏆',
        'A beautiful number landed. Allocate calmly, then celebrate 💚',
        'A rich one. Save a part, enjoy the rest properly 🌤️'],
    ],
    unknown: [
      ['A small new entry just arrived, take a peek 📥',
        'A transaction just docked, one glance makes it clear 🛳️',
        'Money just moved, come see what it was 👀',
        'A new line in the book is waiting for its name 🏷️'],
      ['A new entry just landed, worth a proper look 📒',
        'Something new arrived, come give it a name 🏷️',
        'Money moved, and you know it best 👀',
        'The book has a new line, a quick look settles it 📥'],
      ['A decent-sized entry just landed, worth checking 🧾',
        'At this size it deserves a glance 👀',
        'A notable entry is waiting to be named 📋',
        'Not a small number, come see it clearly 📒'],
      ['A big one just landed. Deep breath, then a look 💸',
        'A large number. Name it and rest easy 🧾',
        'This size deserves a personal visit 📒',
        'A hefty entry appeared. A quick check for peace of mind 👀'],
    ],
  },
};

/* Keyword-gated pools — the only place the copy is allowed to be specific,
 * because the merchant string literally said so. */
const POOL_LINES = {
  vi: {
    coffee: ['Tỉnh táo rồi thì làm gì đó cho đáng ly cà phê nha ☕',
      'Một ly đổi lấy một buổi tỉnh táo, tính ra vẫn hời ☕',
      'Cà phê là chi phí vận hành của người lớn mà 😌',
      'Nạp caffeine xong rồi, giờ tới lượt mình chạy nha ⚡'],
    milktea: ['Trà sữa là liều động viên hợp pháp của ngày dài 🧋',
      'Ngọt một chút cho đời bớt gắt, hợp lý mà 🧋',
      'Topping hôm nay là tâm trạng tốt nha 🧋',
      'Một ly đầy topping đổi lấy nguyên buổi chiều vui 🧋'],
    ride: ['Có người chở đi, mình lo ngắm đường là được 🛵',
      'Đặt xe một cái, tới nơi lẹ làng khỏi đội nắng 🚕',
      'Tiền xe là tiền mua sự đúng giờ đó nha ⏱️',
      'Ngồi sau xe người ta chở, thảnh thơi cũng đáng giá 🛵'],
    cinema: ['Hai tiếng trong rạp là hai tiếng khỏi nhìn điện thoại 🎬',
      'Vé phim là vé đi trốn hợp pháp ngắn hạn 🎬',
      'Bắp nước cứ tự nhiên, vui là chính mà 🍿',
      'Phim hay dở gì thì cũng là một buổi ra ngoài vui 🎟️'],
  },
  en: {
    coffee: ['Caffeinated now, so make it count ☕',
      'One cup for a whole alert morning is still a bargain ☕',
      'Coffee is simply an adult operating cost 😌',
      'Caffeine loaded, your turn to run ⚡'],
    milktea: ['Milk tea is the legal kind of motivation 🧋',
      'A little sweetness takes the edge off the day 🧋',
      'Today’s topping is a better mood 🧋',
      'One full-topping cup buys a whole happy afternoon 🧋'],
    ride: ['Someone else drives, you enjoy the view 🛵',
      'One booking, there in no time, zero sunburn 🚕',
      'Ride money is punctuality money ⏱️',
      'Sitting back while someone drives is worth it 🛵'],
    cinema: ['Two hours in a cinema is two hours off the phone 🎬',
      'A movie ticket is a short legal escape 🎬',
      'Popcorn is allowed, joy is the point 🍿',
      'Good or bad, a movie out is a happy evening 🎟️'],
  },
};

/* meta {c,t,p} → one body line. The pool wins when present (it matched a real
 * keyword); a meta from an older sender or a missing cell degrades to
 * unknown/t2 rather than throwing inside a notification path. */
export function reviewBody(meta, lang, rnd) {
  const lg = lang === 'en' ? 'en' : 'vi';
  const r = typeof rnd === 'number' ? rnd : Math.random();
  const m = meta && typeof meta === 'object' ? meta : {};
  const pool = m.p && POOL_LINES[lg][m.p];
  if (pool) return pool[Math.floor(r * pool.length) % pool.length];
  const rows = MATRIX[lg][m.c] || MATRIX[lg].unknown;
  const t = Math.min(4, Math.max(1, Number(m.t) || 2));
  const cell = rows[t - 1] || rows[1];
  return cell[Math.floor(r * cell.length) % cell.length];
}

/* The one-time backfill digest — the single line allowed to state a number,
 * because a queue size is not private. Also used for the stall notice. */
export function digestBody(count, lang) {
  const n = Math.max(1, Number(count) || 1);
  return lang === 'en'
    ? `Your inbox is connected, ${n} past transaction${n > 1 ? 's are' : ' is'} in the queue 📬 Review at your own pace.`
    : `Hộp thư kết nối xong, ${n} giao dịch cũ đã vào hàng chờ 📬 Từ từ duyệt, không vội.`;
}

/* Appended when more sit behind the one the copy is voicing. */
export function queueSuffix(others, lang) {
  const n = Number(others) || 0;
  if (n <= 0) return '';
  return lang === 'en'
    ? ` · ${n} more waiting`
    : ` · còn ${n} khoản khác chờ duyệt`;
}
