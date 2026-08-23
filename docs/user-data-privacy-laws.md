# User Data Privacy — Rules & Laws (FamilyHub)

> **Chủ đề:** Luật Bảo vệ dữ liệu cá nhân Việt Nam và tác động lên FamilyHub.
> **Căn cứ:** Luật số **91/2025/QH15** — Bảo vệ dữ liệu cá nhân, Quốc hội khóa XV thông qua 26/6/2025, **có hiệu lực từ 01/01/2026**.
> **Cập nhật:** 2026-08-23
> **Lưu ý:** Tài liệu này là phân tích khoảng trống kỹ thuật/sản phẩm để làm việc với pháp chế — **không phải tư vấn pháp lý**.

---

## 0. TL;DR cho cả team

- FamilyHub là **Bên kiểm soát và xử lý dữ liệu cá nhân** (Điều 2.9). Chúng ta xử lý cả **dữ liệu nhạy cảm (tài chính)** và **chuyển dữ liệu xuyên biên giới** (Supabase / Vercel / Google / Telegram) — hai điểm luật siết chặt nhất.
- Luật **đã có hiệu lực** → các mốc "60 ngày nộp hồ sơ" tính từ lần xử lý/chuyển đầu tiên, với app đang chạy coi như **đã tới hạn / quá hạn**.
- **E2EE là điểm mạnh nhất của chúng ta**, nhưng **không** giúp thoát khỏi phạm vi DLCN (Điều 12.1). Nó là *biện pháp giảm thiểu rủi ro*, không phải *tấm vé miễn trừ*.
- Việc code sửa được ngay và giảm rủi ro nhanh nhất: **(1) trang Chính sách bảo mật thật**, **(2) luồng đồng ý tường minh cho quét email ngân hàng**, **(3) màn "Quyền của tôi"** (xóa tài khoản / xuất dữ liệu / rút đồng ý).

---

## 1. Dữ liệu cá nhân (DLCN) là gì?

### 1.1 Hai nguyên tắc gốc

**a) Phép thử "xác định được người" (Điều 2.1)**
DLCN = *dữ liệu số hoặc thông tin dạng khác **xác định hoặc giúp xác định** một con người cụ thể*. Không cần là tên/CCCD — chỉ cần **giúp** truy ra một người là đủ. Một `member_id`, một email, một chuỗi giao dịch gắn với một người → đều là DLCN.

**b) Mã hóa KHÔNG làm mất tư cách DLCN (Điều 12.1)**
Luật nói thẳng: *"dữ liệu cá nhân sau khi được mã hóa vẫn là dữ liệu cá nhân"*. Không phân biệt ai giữ khóa hay nhà vận hành có đọc được hay không.

Chỉ có **khử nhận dạng không thể đảo ngược** (Điều 2.11 — *tạo ra dữ liệu mới không thể xác định một con người cụ thể*) mới làm dữ liệu **không còn** là DLCN. Mã hóa luôn đảo ngược được (khóa tồn tại) → là *pseudonymisation*, không phải *anonymisation*.

> **So sánh GDPR (cùng logic):** dữ liệu mã hóa = "pseudonymised" → vẫn là personal data; chỉ dữ liệu ẩn danh không đảo ngược mới thoát phạm vi.

### 1.2 Hai loại DLCN (danh mục do Chính phủ ban hành — hiện dựa trên NĐ 13/2023)

| Cơ bản (Điều 2.2) | Nhạy cảm (Điều 2.3) — bảo vệ chặt hơn |
|---|---|
| Họ tên, ngày sinh, giới tính | Tình trạng sức khỏe, di truyền, sinh trắc học |
| Email, số điện thoại | Quan điểm chính trị / tôn giáo, dân tộc |
| Nơi ở, số CCCD | Đời sống / xu hướng tình dục |
| Thông tin tài khoản số, ID định danh | **Thông tin khách hàng tổ chức tín dụng / dữ liệu tài chính** |
| Dữ liệu phản ánh hoạt động trên mạng | Dữ liệu vị trí (GPS), dữ liệu về tội phạm |

---

## 2. Trường hợp E2EE: "Supabase đọc vô nghĩa, có còn là DLCN không?"

**Có — vẫn là DLCN.** Đây là hiểu lầm phổ biến, cần tách bạch *phân loại pháp lý* và *mức độ rủi ro*.

### 2.1 Vì sao vẫn là DLCN
- **Điều 12.1** viết thẳng, không ngoại lệ.
- **Khử nhận dạng (Điều 2.11)** đòi hỏi *không thể đảo ngược*. Mã hóa luôn đảo ngược được → không đạt.
- **Metadata quanh nó thường không mã hóa:** dòng giao dịch vẫn gắn `member_id`, `family_id`, `created_at` ở dạng rõ. Dù số tiền là ciphertext, hệ thống vẫn biết *"một người X trong gia đình Y phát sinh giao dịch lúc T"* → tự nó đã giúp xác định người.
- **FamilyHub là bên điều phối hệ khóa:** dù khóa nằm trên máy user, chính chúng ta thiết kế luồng để dữ liệu giải mã được.

### 2.2 E2EE đổi được gì

| | Trước | Sau khi có E2EE |
|---|---|---|
| Phân loại | DLCN nhạy cảm | DLCN nhạy cảm (không đổi) |
| Rủi ro khi lộ | Cao | **Rất thấp** — chỉ thấy rác |
| Trong hồ sơ TIA | Điểm trừ | **Điểm cộng lớn** |

→ E2EE là **"biện pháp kỹ thuật bảo vệ DLCN"** mà Điều 3.4, 12.3, 27, 30.3 yêu cầu. **Chiến lược đúng:** khai đầy đủ nhóm dữ liệu này trong hồ sơ, rồi dùng chính E2EE làm luận điểm trung tâm chứng minh rủi ro đã được kiểm soát ở mức cao nhất.

---

## 3. Chuyển dữ liệu xuyên biên giới — cái gì là DLCN khi rời VN

Supabase / Vercel / Google / Telegram gần như chắc chắn lưu/xử lý ngoài lãnh thổ VN → kích hoạt nghĩa vụ tại **Điều 20 & 22**.

| Dữ liệu trong app | Loại | Chảy đi đâu ngoài VN | Còn là DLCN dù mã hóa? |
|---|---|---|---|
| Email (Google SSO), Google account ID | Cơ bản | Supabase, Google, Vercel logs | ✅ (không mã hóa) |
| Tên thành viên, avatar/ảnh | Cơ bản | Supabase Storage | ✅ Có |
| **Giao dịch, số tiền, caption, category** | **Nhạy cảm (tài chính)** | Supabase | ✅ Có |
| **Nội dung email ngân hàng đã quét** | **Nhạy cảm (tài chính)** | Supabase / pipeline | ✅ Có |
| `member_id`, `family_id`, `key_unlocked_at`, timestamps | Cơ bản (định danh gián tiếp) | Supabase, Telegram | ✅ Có |
| Push subscription, device session, IP/device | Cơ bản (hoạt động mạng) | Supabase, Vercel | ✅ Có |

**Founder Telegram alerts (mig 0061):**
- Ping "family mới / member-joined" nếu mang định danh (`family_id`, `member_id`, email) → **là chuyển DLCN xuyên biên giới**.
- **Digest đếm số 21:00** (chỉ một con số tổng, không truy được cá nhân) → **KHÔNG phải DLCN** — ví dụ đúng của dữ liệu đã tổng hợp/khử nhận dạng.
- 👉 *Cần kiểm tra payload thực tế để phân loại chính xác từng loại ping.*

**Kết luận:** gần như toàn bộ dữ liệu FamilyHub trên hạ tầng ngoài VN đều là DLCN, phần lớn là **nhạy cảm** → **hồ sơ đánh giá tác động chuyển xuyên biên giới (TIA) là bắt buộc**, không né được bằng lý do "đã mã hóa". Cách duy nhất loại một luồng ra khỏi phạm vi: **khử nhận dạng không đảo ngược** hoặc **lưu trong VN**.

---

## 4. Phân tích khoảng trống của FamilyHub (Gap Analysis)

Ưu tiên theo P0–P3 (P0 = xử lý trước, rủi ro cao nhất).

### P0 — Rủi ro pháp lý cao nhất

**1. Chính sách quyền riêng tư thật sự (Điều 4.1a, Điều 29.6)**
Hiện `src/index.html` chỉ có dòng *"By continuing, you agree to our Terms & Privacy Policy"* — **không link, không trang chính sách nào**. Điều 29 buộc dịch vụ trực tuyến công khai chính sách: *thu thập gì / mục đích / chia sẻ với ai / lưu bao lâu*. → Viết + host trang chính sách thật, link vào onboarding.

**2. Cơ chế đồng ý đúng chuẩn (Điều 9, Điều 11.1)**
"By continuing" là **đồng ý ngầm/gộp** — luật cấm (Điều 9.3, 9.4: tường minh, theo từng mục đích, im lặng ≠ đồng ý, kiểm chứng/in được). Đặc biệt **quét email ngân hàng** (`73-mailbox-gate.js`) = thu thập dữ liệu tài chính nhạy cảm → cần màn hình đồng ý riêng, tách bạch, **lưu bằng chứng** (thời điểm, phạm vi).

**3. Chuyển dữ liệu xuyên biên giới — Hồ sơ TIA (Điều 20, 22)**
Lập **Hồ sơ đánh giá tác động chuyển DLCN xuyên biên giới**, gửi **01 bản chính cho Bộ Công an trong 60 ngày** từ lần chuyển đầu; cập nhật mỗi 6 tháng. App đang chạy → **cần làm gấp**.

**4. Dữ liệu trẻ em (Điều 24)**
App gia đình → khả năng cao có thành viên là trẻ em (tên, ảnh). Trẻ **từ đủ 7 tuổi**: cần đồng ý của *cả trẻ và người đại diện*; dưới 7: người đại diện. Hiện app không phân biệt tuổi → cần cơ chế đánh dấu thành viên trẻ em + luồng đồng ý tương ứng.

### P1 — Iteration kế tiếp

**5. Quyền của chủ thể dữ liệu (Điều 4.1, 10, 13, 14)**
Hiện `60-settings-family-ui.js` mới có `leave_family`. Cần self-service cho:
- **Xóa tài khoản + toàn bộ DLCN** (Điều 14) — gồm cả blob ảnh trong Storage, phải xóa tự động không sót.
- **Rút lại đồng ý** (Điều 10) — nhất là tắt quét email ngân hàng, bằng văn bản/điện tử kiểm chứng được.
- **Xem / chỉnh sửa / cung cấp (portability)** DLCN của mình.

**6. Thông báo vi phạm 72 giờ (Điều 23)**
Quy trình: phát hiện lộ/mất dữ liệu → báo Bộ Công an ≤ 72 giờ; báo người dùng nếu ảnh hưởng tài khoản ngân hàng/tài chính (Điều 27.1.d).

**7. Hồ sơ đánh giá tác động xử lý DLCN — DPIA (Điều 21)**
Lập + gửi trong 60 ngày. **Lưu ý:** miễn trừ cho doanh nghiệp nhỏ/khởi nghiệp (Điều 38.2) **không áp dụng** khi xử lý dữ liệu nhạy cảm — dữ liệu tài chính của ta nhiều khả năng là nhạy cảm → **không được miễn**.

**8. Dữ liệu tài chính/ngân hàng (Điều 27)**
Chỉ thu thập dữ liệu *cần thiết*, không dùng để chấm điểm tín dụng, có giải pháp khôi phục khi mất, thông báo khi lộ. E2EE là điểm cộng lớn ở đây.

### P2 — Backlog

**9. Hợp đồng xử lý dữ liệu — DPA (Điều 8, 37)** với Supabase, Vercel, Google, Telegram (thường có DPA sẵn, chỉ cần ký/chấp nhận + lưu).
**10. Chỉ định người/bộ phận phụ trách BVDLCN (Điều 33)** — vì xử lý dữ liệu nhạy cảm, khó dùng miễn trừ.
**11. Thời hạn lưu trữ (Điều 3.3)** — quy định rõ lưu bao lâu, xóa khi hết mục đích (email đã quét, giao dịch cũ).

---

## 5. Điểm FamilyHub đã làm tốt (giữ và tận dụng)

- **Mã hóa / E2EE** (Điều 12, 27, 30.3): passcode + envelope encryption; ảnh/caption/tên/số tiền mã hóa → đáp ứng rất tốt "biện pháp kỹ thuật bảo vệ". Là lá bài trung tâm của hồ sơ TIA/DPIA.
- **Founder alerts không mang tiêu đề/số tiền** (Điều 3.2 — tối thiểu hóa dữ liệu) — đúng hướng; chỉ cần bổ sung cơ sở pháp lý cho việc chuyển ra Telegram và phân loại từng loại ping.

---

## 6. Bước tiếp đề xuất

Ưu tiên **P0 #1 + #2** (sửa được trong code, giảm rủi ro nhanh nhất); song song để pháp chế lo hồ sơ TIA/DPIA (#3, #7). Các hạng mục code cụ thể có thể mở thành task riêng:

- [ ] (a) Trang **Chính sách bảo vệ DLCN** song ngữ VN/EN + link vào onboarding
- [ ] (b) **Màn hình đồng ý tường minh** cho quét email ngân hàng (lưu vết consent)
- [ ] (c) Màn **"Quyền của tôi"** trong Settings (xóa tài khoản + xuất dữ liệu + rút đồng ý)
- [ ] (d) Kiểm tra payload Telegram alert (mig 0061) → chốt ping nào là DLCN
- [ ] (e) Bảng kê DLCN + luồng chuyển xuyên biên giới → phần lõi hồ sơ TIA

---

## Phụ lục — Các điều luật hay dẫn chiếu

| Điều | Nội dung |
|---|---|
| 2 | Định nghĩa (DLCN, cơ bản/nhạy cảm, bên kiểm soát/xử lý, khử nhận dạng) |
| 3 | Nguyên tắc (đúng mục đích, tối thiểu hóa, biện pháp bảo vệ) |
| 4 | Quyền & nghĩa vụ của chủ thể dữ liệu |
| 9 | Sự đồng ý (tường minh, từng mục đích, im lặng ≠ đồng ý) |
| 10 | Rút lại đồng ý / hạn chế xử lý |
| 12 | Mã hóa — *dữ liệu mã hóa vẫn là DLCN* |
| 13–14 | Chỉnh sửa / xóa, hủy, khử nhận dạng |
| 20 | Chuyển dữ liệu xuyên biên giới |
| 21–22 | Đánh giá tác động (DPIA) + cập nhật hồ sơ |
| 23 | Thông báo vi phạm (≤ 72 giờ) |
| 24 | Dữ liệu trẻ em / người mất-hạn chế năng lực hành vi |
| 27 | Tài chính, ngân hàng, thông tin tín dụng |
| 29 | Mạng xã hội / dịch vụ truyền thông trực tuyến |
| 30 | Dữ liệu lớn, AI, blockchain, điện toán đám mây |
| 33 | Lực lượng bảo vệ DLCN |
| 37 | Trách nhiệm bên kiểm soát / xử lý |
| 38–39 | Hiệu lực (01/01/2026), miễn trừ DN nhỏ, chuyển tiếp |
