# PDPL Compliance — position, consent, dossiers (bank-email pipeline)

> **Companion doc:** `docs/user-data-privacy-laws.md` (on branch
> `docs/user-data-privacy-laws`, 2026-08-23) carries the law-first analysis —
> what counts as personal data, why E2EE does not exit the law's scope (Đ12.1),
> the cross-border data map. THIS doc is the operational half: where we stand,
> the consent sheet ready to wire, what goes in the filings, and what to ask
> counsel. Read both; they deliberately do not repeat each other.
>
> Written 2026-08-23 (forwarding session). Gap analysis for working with
> counsel — **not legal advice**. The companion doc's §4–6 carry the P0–P3
> action plan; this doc's scorecard cross-references it. Article numbering
> differs slightly between the two docs — counsel keys final filings to the
> statute text, using the companion doc's appendix as the map.

---

## 1. The instrument stack, corrected

As of 01/01/2026 the operative law is **Luật 91/2025/QH15** plus its
implementing decree **Nghị định 356/2025/NĐ-CP** (issued 31/12/2025), which
**replaces Nghị định 13/2023/NĐ-CP outright**. Anything citing Decree 13 as
live law is stale — including the sensitive-data category table in the
companion doc, which notes it relies on NĐ 13; the categories carry forward,
but filings cite Law 91 + NĐ 356. The banking category (customer information
of credit institutions: accounts, deposits, **transactions**) remains
enumerated as sensitive.

## 2. Position in one paragraph

We process sensitive personal data (bank transaction information) of ~4
subjects across 3 families, on offshore infrastructure (Supabase, Gmail,
Gemini — plus Vercel and Telegram for the app at large, see companion doc §3).
The Đ38 small-operator exemptions are **explicitly void for anyone directly
processing sensitive data**, so every duty applies despite our size. Our risk
is concentrated in **unfiled paper, not unprotected data**: the technical
measures (sealing, E2E ledger encryption, masking, retention, minimized
metadata) exceed what filings typically claim; the documents and two product
mechanics are what is missing.

## 3. Obligations scorecard

| # | Obligation | Source | Status 2026-08-23 |
|---|---|---|---|
| 1 | Explicit consent naming the data as sensitive | L91 consent arts. + NĐ 356 | ✅ BUILT (branch `bank-email-sealing`, consent_v 3 + 0071): gates forwarding, OAuth, and the retro pass; provable record; deploys once 0071 is applied |
| 2 | DPIA dossier, Form 04, 60 days from processing start, to A05 | Đ21 | ❌ overdue — file promptly, with remediation timeline |
| 3 | Cross-border dossier (TIA) | Đ20/22 | ❌ unstarted; inventory favorable (values cross as ciphertext); updated every 6 months, not file-and-forget |
| 4 | Named data-protection personnel, reported to A05 | Đ33.2 | ❌ proposal: Hiên |
| 5 | 72h breach notification process | L91 + 356 | 🟡 detectors live; runbook unwritten |
| 6 | 72h deletion on request | L91 + 356 | 🟡 levers live; procedure unwritten; disconnect button missing |
| 7 | Security measures appropriate to sensitivity | Đ27 et al. | ✅ see §7 inventory; Đ27 also bans credit-scoring use, matching our red-lines |
| 8 | Children's data: members ≥7 need child + guardian consent | Đ24 | ❌ APP-WIDE gap (kid members' names/photos), no child marking exists — see companion doc P0 #4 |
| 9 | Sign-in's "By continuing, you agree to our Terms & Privacy Policy" | Đ9.3/9.4 | ❌ bundled consent pointing at a page that does not exist — fix with the policy page |

Penalty frame for context: data trading up to 10× illicit gains; unlawful
cross-border transfer up to 5% prior-year revenue; other violations up to
3 tỷ đồng; individuals at half rates. Floors are existential at our scale;
enforcement attention realistically targets platforms and brokers — but
"filed late with strong measures" is defensible and "unfiled" is not.

## 4. The three ship-blockers the consent sheet creates

The consent text below only promises what the system does IF three mechanics
exist first. They join the beta-reopen checklist:

1. **Disconnect button** on the mailbox status sheet (today deletion is a
   founder SQL lever). Must also instruct removing the user's own Gmail
   forwarding rule — disconnecting our side does not stop their filter.
2. **Parse-failed retention**: the sweep deliberately never touches
   `txn/parse-failed`, so failed emails currently live in the relay forever —
   contradicting any deletion promise. Give them their own window (90 days) in
   `sweepProcessedMail`. Small `.gs` change + test.
3. **Consent record + review**: store `consent_v` + `consented_at` + user id
   on the connection (consent must be provable — the record shows the person
   "chủ động xác nhận đồng ý", MoMo's affirmative-act phrasing), and a "Xem
   lại điều bạn đã đồng ý" row so the person can re-read what they accepted
   (v3 text below is consent_v = 3).
4. **A real privacy-policy page** (`privacy.html` exists as an OAuth stub —
   it becomes the full Chính sách quyền riêng tư). The consent sheet is the
   moment; the policy is the reference it links to for the complete rights
   enumeration, retention table, and sharing list. Skeleton per MoMo's
   counsel-vetted section headers: Phạm vi áp dụng · Nguyên tắc xử lý dữ liệu
   cá nhân · Các loại thông tin cá nhân được thu thập và xử lý · Mục đích xử
   lý dữ liệu · Chia sẻ dữ liệu · Thời hạn lưu trữ dữ liệu · Quyền lựa chọn
   của Người dùng.

## 5. Consent sheet v3 — legally reviewed, benchmarked against MoMo

Placement: connect flow, between the intro sheet and the which-email step.
One affirmative CTA; declining costs only this feature. The four grandfathered
users see it once, retroactively. v1 → v2 fixed five overclaims (relay
deletion timing incl. trash tail; parse-failed carve-out; "we cannot read it"
softened to design-intent; "values never leave" scoped to Gemini; two-step
withdrawal) and six omissions (controller identity, family visibility,
whole-email transit scope, retention per category, refusal consequence,
rights contact). v2 → v3 benchmarks against MoMo's privacy policy
(momo.vn/chinh-sach-quyen-rieng-tu), adopting their exact terms where
stronger:

- **"với vai trò là bên kiểm soát và xử lý dữ liệu cá nhân"** — the statutory
  role naming, verbatim.
- **"đặt ngoài lãnh thổ Việt Nam"** — the statutory cross-border phrase
  (was: "đặt ngoài Việt Nam").
- **The state-authority carve-out.** Our "không chia sẻ cho ai khác" was
  absolute and therefore falsifiable under a lawful order. Adopted MoMo's
  "cơ quan nhà nước có thẩm quyền" category — with our honest addendum that
  for sealed values what we can produce is ciphertext.
- **Canonical rights enumeration** (quyền truy cập, chỉnh sửa, yêu cầu xóa,
  rút lại sự đồng ý, hạn chế hoặc phản đối xử lý, phản ánh và khiếu nại) —
  as a pointer line into the policy page.

Deliberately NOT adopted from MoMo: their vague retention formula ("trong
thời gian cần thiết…") — our concrete numbers are stronger; and they never
name data as sensitive in the consent moment — ours must (sensitive-data
consent requirement), and does.

### Tiếng Việt

> **Trước khi kết nối, đọc phút này đã nhé**
>
> Earthy được vận hành bởi [tên pháp lý / hai người vận hành], với vai trò là
> bên kiểm soát và xử lý dữ liệu cá nhân — liên hệ về dữ liệu: [email]. Khi
> bạn chuyển tiếp email ngân hàng, tụi mình xử lý nội dung email đó, và trích
> xuất thông tin giao dịch: số tiền, thời điểm, người nhận hay cửa hàng, lời
> nhắn chuyển khoản, số tài khoản đã che bớt, tên ngân hàng.
>
> **Theo Luật Bảo vệ dữ liệu cá nhân, đây là dữ liệu cá nhân nhạy cảm.** Tụi
> mình cần bạn biết điều đó, và đồng ý rõ ràng, trước khi bắt đầu.
>
> **Dữ liệu được xử lý thế nào:**
> • Email đi qua một hộp thư trung gian trên Gmail, được xoá sau 7 ngày và tự
> huỷ hẳn trong khoảng một tháng. Email không đọc được sẽ được giữ lâu hơn để
> tụi mình sửa lỗi, tối đa 90 ngày.
> • Với ngân hàng lần đầu gặp, nội dung được che hết số tiền, tên, số tài
> khoản thật rồi mới nhờ Google Gemini đọc cấu trúc. Giá trị thật không bao
> giờ được gửi cho Gemini.
> • Giao dịch được niêm phong ngay khi nhận, lưu trên máy chủ Supabase đặt
> ngoài lãnh thổ Việt Nam, và được thiết kế để chỉ thiết bị của nhà bạn mở
> được. Bản chờ duyệt giữ đến khi bạn duyệt hoặc ngắt kết nối.
> • Giao dịch bạn duyệt sẽ vào sổ chi tiêu chung và hiển thị cho các thành
> viên trong gia đình bạn, đến khi gia đình xoá.
>
> **Dùng để làm gì:** ghi sổ và quản lý chi tiêu trong ứng dụng, cho chính gia
> đình bạn. Không bán, không quảng cáo, không chia sẻ cho ai khác ngoài các
> dịch vụ nêu trên, trừ trường hợp cơ quan nhà nước có thẩm quyền yêu cầu theo
> đúng quy định pháp luật. Khi đó, với các giá trị đã niêm phong, thứ tụi mình
> có thể cung cấp chỉ là dữ liệu đã mã hoá.
>
> **Quyền của bạn:** đổi ý lúc nào cũng được. Ngắt kết nối trong Cài đặt, và
> xoá quy tắc chuyển tiếp trong Gmail của bạn, là dừng hẳn. Giao dịch đang chờ
> duyệt được xoá trong vòng 72 giờ. Muốn xoá sạch dữ liệu, nhắn tụi mình theo
> địa chỉ trên. Bạn còn có quyền truy cập, chỉnh sửa, yêu cầu xóa dữ liệu, rút
> lại sự đồng ý, hạn chế hoặc phản đối xử lý, và phản ánh, khiếu nại — chi
> tiết trong Chính sách quyền riêng tư [link]. Không đồng ý thì tính năng này
> không bật, các phần khác của Earthy vẫn dùng bình thường.
>
> **[Tôi hiểu và đồng ý]** · *Để sau*

### English

> **One minute before you connect**
>
> Earthy is operated by [legal name / the two operators], acting as the
> personal-data controller and processor — data contact: [email]. When you
> forward bank emails, we process the content of those emails, and extract
> the transaction information: amount, time, who was paid, the transfer note,
> the partially hidden account number, and the bank's name.
>
> **Under the Personal Data Protection Law, this is sensitive personal data.**
> We want you to know that, and to agree clearly, before anything starts.
>
> **How it's handled:**
> • Emails pass through a relay inbox on Gmail, are deleted after 7 days, and
> are gone for good within about a month. Emails we fail to read are kept
> longer so we can fix the error, at most 90 days.
> • For a bank we haven't seen before, every real amount, name and account
> number is masked before Google Gemini reads the structure. Real values are
> never sent to Gemini.
> • Each transaction is sealed on arrival, stored on Supabase servers located
> outside Vietnam, and designed so only your family's devices can open it.
> Pending items are kept until you review them or disconnect.
> • Transactions you approve enter the shared family ledger and are visible to
> your family members, until the family deletes them.
>
> **What it's for:** recording and managing spending in the app, for your own
> family. Never sold, never used for ads, never shared beyond the services
> above — except where a competent state authority lawfully requires it, in
> which case, for sealed values, what we can produce is ciphertext.
>
> **Your rights:** change your mind anytime. Disconnecting in Settings, plus
> deleting your forwarding rule in Gmail, stops everything. Pending
> transactions are deleted within 72 hours. To erase everything, contact us at
> the address above. You also have the rights to access, correct, request
> deletion, withdraw consent, restrict or object to processing, and lodge a
> complaint — detailed in the Privacy Policy [link]. If you decline, only this
> feature stays off — the rest of Earthy works normally.
>
> **[I understand and agree]** · *Not now*

## 6. Dossier outlines (Đ21 + Đ22)

Both share ~80% of their content; draft together. Common core: controller
identity + protection personnel; categories (banking item, named sensitive);
~4 subjects, growth gated; purpose = household ledger, basis = §5 consent;
flow diagram (forward → relay ≤7d → masked extraction, new senders only →
sealed staging → human review → encrypted ledger); processors and what each
can technically see; measures (§7); residual risks stated honestly (metadata
remainder, relay window, masking's shape-heuristic limits, counterparty
names); remediation timeline (gate 16/08, sealing 17/08, retention 17/08).
Đ22 adds: destination jurisdictions per provider, their standard DPAs, the
consent sentence naming offshore storage, and the ciphertext-only inventory
for values. The companion doc's §3 table is the transfer inventory for the
app beyond the pipeline (incl. Vercel, Telegram) — fold it in.

## 7. Measures inventory (the part already true)

Masking before any third-party model (shape-preserving, unconditional) ·
sealed staging, ephemeral-static X25519, server provably cannot read its own
output · permanent DEK ledger encryption ('enc' terminal since 0035, verified
plain_amount=0 across all four bank-email families 2026-08-17) · relay
retention 7d + ~30d trash tail · parse_failures metadata-only · minimized
clear metadata, documented as deliberate · key-substitution: TOFU pin (robot)
+ device self-check + family-wide alarm · execution lock + write-ahead DRBG ·
breach-visible logging on the notification path.

## 8. Counsel questions

1. Unincorporated operators: which duties attach to two individuals running a
   service, and can Form 04 be filed without an enterprise registration?
2. Form 04 mechanics under NĐ 356 (portal? paper? A05 contact point) and
   whether the sanctions decree detailing fines has issued.
3. Counterparty names in transfers: third-party data processed under the
   user's direction — personal-notebook analogy acceptable?
4. Đ38 reading: confirm sensitive-data processing voids the exemption even at
   our scale, or whether "trực tiếp xử lý" admits any narrowing.
5. Minors, upgraded per companion-doc P0 #4: bank email presumes adults, but
   the APP processes child members' data (names, photos). Đ24 wants child +
   guardian consent from age 7. What marking + consent mechanics suffice for
   a family app where parents create the accounts?
6. TIA update cadence: confirm the 6-month refresh obligation and what
   counts as a material change requiring earlier update.

## 9. Sources

- [Bộ Công an — Luật BVDLCN hiệu lực 01/01/2026](https://bocongan.gov.vn/chinh-sach-phap-luat/bai-viet/luat-bao-ve-du-lieu-ca-nhan-chinh-thuc-co-hieu-luc-thi-hanh-tu-ngay-01-01-2026-1767186124)
- [LuatVietnam — Luật BVDLCN và văn bản hướng dẫn (NĐ 356 thay NĐ 13)](https://luatvietnam.vn/linh-vuc-khac/luat-bao-ve-du-lieu-ca-nhan-moi-nhat-va-van-ban-huong-dan-883-106497-article.html)
- [Thư viện Pháp luật — toàn văn Luật 91/2025/QH15](https://thuvienphapluat.vn/van-ban/Bo-may-hanh-chinh/Luat-Bao-ve-du-lieu-ca-nhan-2025-so-91-2025-QH15-625628.aspx)
- [Đ38 exemptions cho hộ kinh doanh / DN nhỏ / khởi nghiệp](https://thuvienphapluat.vn/phap-luat/mot-so-luu-y-khi-luat-bao-ve-du-lieu-ca-nhan-2025-co-hieu-luc-danh-cho-ho-kinh-doanh-doanh-nghiep-s-924781-244918.html)
- [Mức phạt: 10× thu lợi, 5% doanh thu, sàn 3 tỷ](https://sunteco.vn/luat-91-2025-qh15-va-nghi-dinh-356-2025-doanh-nghiep-can-biet-gi/)
- [Đ21 DPIA: Form 04, 60 ngày, các trường hợp loại trừ](https://congchungnguyenhue.com/tin-tuc/danh-gia-tac-dong-xu-ly-du-lieu-ca-nhan-doanh-nghiep-nao-khong-phai-lap-ho-so-189-122267.html)
- Nghị định 13/2023/NĐ-CP Đ2.4 (lịch sử — đã bị thay thế): mục h, thông tin
  khách hàng tổ chức tín dụng.
