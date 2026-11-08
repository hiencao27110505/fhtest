#!/usr/bin/env python3
"""Builds the SYNTHETIC PDF statement fixture under tools/fixtures/statements/.

Layout copied from one real credit-card statement (pdf-statements-spec.md §4:
letter size, one bilingual two-line header on page 1, pages 2+ continuing with
no header at the same x positions, two-line descriptions, fee rows with a post
date only, a card repayment as a credit, an original-amount column carrying a
currency, a totals block, negative = owed, a glossary page). Every name, number
and amount is invented; the totals reconcile by construction.

    <venv>/bin/python tools/make-pdf-fixture.py        (needs reportlab + pypdf)

Writes credit-card-techcombank.locked.pdf (AES-256, password below) and merges
its entry into manifest.json. Real statements never enter the repo.
"""
import io, os, json, random
from datetime import date, timedelta
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'statements')
os.makedirs(OUT, exist_ok=True)
PASSWORD = '01011990'
HOLDER = 'TRAN THI MAI'
FILE = 'credit-card-techcombank.locked.pdf'

# a font with Vietnamese glyphs; the app's own vendored Inter has the Latin + Vietnamese sets
FONT = 'FixtureFont'
for cand in ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf',
             '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
    if os.path.exists(cand) and cand.endswith('.ttf'):
        pdfmetrics.registerFont(TTFont(FONT, cand)); break
else:
    FONT = 'Helvetica'   # diacritics will degrade; the reader deburrs anyway

W, H = letter
# column x positions (pt, from the left), copied from the real file
# the real file's headings sit far enough apart to stay separate text runs; a
# gap under a space width makes pdf.js glue two headings into one run
X_DATE, X_POST, X_FX, X_DEBIT_R, X_CREDIT_R, X_DESC = 28, 104, 178, 330, 408, 432
Y_HEADER = H - 241         # the real header sits 241 pt from the top
ROW_H = 12.5

def money(n): return f'{n:,}'

random.seed(7)
merchants = ['MPOS*BY PREM QUAN 1 VN', '7ELEVEN_1234 HO CHI MINH VN', 'VNPAY*THENEWGYM HA NOI VN', 'APPLE.COM/BILL ITUNES.COM IE',
             'MPOS*SOOKAFE Q1 QUAN 1 VN', 'METRO HCM QUAN 2 VN', 'CO.OPMART NHIEU LOC HO CHI MINH VN', 'VNPAY*LAVIETTQT HCM VN',
             'Shopee VN https://shop VN', 'CIRCLE K_SG0012 HO CHI MINH VN', 'CH 25 NGUYEN GIA TRI HO CHI MINH VN']
stmt_date = date(2026, 10, 28)
rows = []   # (txn_date|None, post_date, fx_text, debit|None, credit|None, line1, line2)
d = stmt_date - timedelta(days=29)
rows.append((d, d + timedelta(days=1), '3,250,000 VND', None, 3250000, 'Thanh toan no the tin dung - Sotien 3250000 VND - Ngay', (d).strftime('%d/%m/%Y')))
for i in range(30):
    d = stmt_date - timedelta(days=28 - (i * 28) // 30)
    m = merchants[i % len(merchants)]
    amt = random.choice([25000, 38000, 45000, 62000, 89000, 120000, 155000, 240000, 412000])
    if 'APPLE' in m and i % 2 == 0:
        # a foreign purchase: original amount in USD, the VND debit, then the fee row with a post date only
        rows.append((d, d + timedelta(days=1), '2.99 USD', 78000, None, 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: 4111...1234', m))
        rows.append((None, d + timedelta(days=1), '2,340 VND', 2340, None, 'PHI GIAO DICH NOI TE O NUOC NGOAI - Số Thẻ/Card No:', '4111...1234 ' + m))
    else:
        rows.append((d, d + timedelta(days=1), money(amt) + ' VND', amt, None, 'Giao dịch thanh toán/Purchase - Số Thẻ/Card No: 4111...1234', m))
total_debit = sum(r[3] or 0 for r in rows)
total_credit = sum(r[4] or 0 for r in rows)
prev_balance = 3250000                       # owed before, printed negative
closing = prev_balance + total_debit - total_credit
assert closing == prev_balance + total_debit - total_credit

buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=letter)
c.setFont(FONT, 8)

def text(x, y, s, size=8, right=False):
    c.setFont(FONT, size)
    if right: c.drawRightString(x, y, s)
    else: c.drawString(x, y, s)

# ── page 1: preamble (the real one carries the holder's name, address, full card
#    number, limit, statement date, due time + date on two lines)
text(W - 300, H - 33, 'SAO KÊ TÀI KHOẢN THẺ TÍN DỤNG', 10)
text(W - 300, H - 45, 'Credit Card Account Statement', 8)
text(X_DATE, H - 70, 'Ông/Bà:'); text(200, H - 70, HOLDER); text(W - 260, H - 70, 'Ngày sao kê:'); text(W - 74, H - 70, stmt_date.strftime('%d/%m/%Y'))
text(X_DATE, H - 80, 'Mr/Ms'); text(W - 260, H - 80, 'Statement Date')
text(X_DATE, H - 95, 'Địa chỉ:'); text(200, H - 95, '12/34 LE VAN SY, P.13, Q.3, TP.HO CHI')
text(X_DATE, H - 105, 'Address'); text(300, H - 105, 'MINH')
text(W - 260, H - 110, 'Dư nợ cuối kỳ (VND):'); text(W - 74, H - 110, '-' + money(closing), right=True)
text(W - 260, H - 120, 'Statement Balance')
text(X_DATE, H - 129, 'Số tài khoản thẻ tín dụng:'); text(300, H - 129, '19031234567890'); text(W - 260, H - 129, 'Mức trả nợ tối thiểu (VND):'); text(W - 74, H - 129, money(max(50000, closing // 20)), right=True)
text(X_DATE, H - 139, 'Credit Card Account Number'); text(W - 260, H - 139, 'Minimum Payment Due')
text(X_DATE, H - 150, 'Hạn mức tín dụng (VND):'); text(300, H - 150, money(50000000)); text(W - 260, H - 150, 'Thời hạn thanh toán trước:'); text(W - 74, H - 150, '17:00', right=True)
text(X_DATE, H - 160, 'Credit Limit'); text(W - 260, H - 160, 'Payment due date')
text(W - 74, H - 170, (stmt_date + timedelta(days=15)).strftime('%d/%m/%Y'), right=True)
text(X_DATE, H - 195, 'Thông tin chi tiết Statement details', 9)
text(X_DATE, H - 215, 'Số dư kỳ trước (VND) Previous Balance:'); text(220, H - 215, '-' + money(prev_balance))

# ── the header, bilingual over two lines, once
y = Y_HEADER
text(X_DATE, y, 'Ngày giao dịch'); text(X_POST, y, 'Ngày cập nhật hệ'); text(X_FX, y, 'Số tiền giao dịch'); text(X_DEBIT_R, y, 'Ghi nợ (VND)', right=True); text(X_CREDIT_R, y, 'Ghi có (VND)', right=True); text(X_DESC, y, 'Diễn giải giao dịch')
y -= 10
text(X_DATE, y, 'Transaction Date'); text(X_POST, y, 'thống Post Date'); text(X_FX, y, 'gốc Original Amount'); text(X_DEBIT_R, y, 'Debit', right=True); text(X_CREDIT_R, y, 'Credit', right=True); text(X_DESC, y, 'Transaction Description')
y -= 22

def row_out(r, y):
    td, pd, fx, db, cr, l1, l2 = r
    if td: text(X_DATE, y, td.strftime('%d/%m/%Y'))
    text(X_POST, y, pd.strftime('%d/%m/%Y'))
    text(X_FX + 64, y, fx, right=True)
    if db is not None: text(X_DEBIT_R, y, money(db), right=True)
    if cr is not None: text(X_CREDIT_R, y, money(cr), right=True)
    text(X_DESC, y, l1)
    text(X_DESC, y - 10, l2)

page = 1
for i, r in enumerate(rows):
    if y < 60:
        text(W - 40, 24, f'{page}/ 3', right=True)
        c.showPage(); page += 1; y = H - 24     # pages 2+ continue with no header
    row_out(r, y)
    y -= 2 * ROW_H

# ── the totals block
y -= 10
text(X_DATE, y, 'Tổng ghi nợ trong kỳ Total Debit in period:'); text(X_DEBIT_R + 20, y, money(total_debit), right=True); y -= 16
text(X_DATE, y, 'Tổng ghi có trong kỳ Total Credit in period:'); text(X_CREDIT_R + 20, y, money(total_credit), right=True); y -= 16
text(X_DATE, y, 'Số dư cần thanh toán(VND) Outstanding Balance:'); text(250, y, '-' + money(closing)); y -= 12
text(X_DATE, y, 'Quý khách không phải thanh toán nếu trước Số dư cần thanh toán không có dấu (-)', 7); y -= 24
text(W / 2 - 60, y, 'Kết thúc sao kê End of Statement'); y -= 12
text(W - 40, 24, f'{page}/ 3', right=True)
c.showPage(); page += 1
# ── a glossary page, outside the table
text(X_DATE, H - 40, 'CÁCH ĐỌC VÀ HIỂU SAO KÊ', 9); text(W / 2 + 20, H - 40, 'INTERPRETATION AND UNDERSTANDING OF A STATEMENT', 9)
text(X_DATE, H - 56, '• Ngày sao kê: Là ngày lập sao kê.', 7); text(W / 2 + 20, H - 56, '• Statement Date: the date the statement is generated.', 7)
text(X_DATE, H - 68, '• Dư nợ cuối kỳ: Là số tiền Chủ thẻ đang nợ tính đến hết Ngày sao kê.', 7)
text(W - 40, 24, f'{page}/ 3', right=True)
c.save()

reader = PdfReader(io.BytesIO(buf.getvalue()))
writer = PdfWriter()
for p in reader.pages: writer.add_page(p)
writer.encrypt(user_password=PASSWORD, owner_password=PASSWORD, algorithm='AES-256')
with open(os.path.join(OUT, FILE), 'wb') as fh: writer.write(fh)

entry = {'file': FILE, 'password': PASSWORD, 'rows': len(rows), 'failed': 0, 'ext': 'pdf',
         'layout': 'credit card, PDF: one bilingual header on page 1, pages 2+ with no header, two-line descriptions, fee rows with post date only, an original-amount column with currency, negative = owed',
         'totals': {'prevDebt': prev_balance, 'totalDebit': total_debit, 'totalCredit': total_credit, 'endDebt': closing},
         'fee_rows': sum(1 for r in rows if r[0] is None), 'fx_rows': sum(1 for r in rows if 'USD' in r[2]), 'pages': page, 'stmtDate': stmt_date.isoformat()}
mp = os.path.join(OUT, 'manifest.json')
man = json.load(open(mp, encoding='utf-8')) if os.path.exists(mp) else {'fixtures': []}
man['fixtures'] = [f for f in man.get('fixtures', []) if f.get('file') != FILE] + [entry]
json.dump(man, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(json.dumps(entry, ensure_ascii=False, indent=2))
