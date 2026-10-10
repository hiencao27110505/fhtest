/* Receipt scan: review → save. Drives the REAL engine with seeded rows (headless
   Chrome has no camera and no network) and asserts what the stub database was told:
   one transactions insert per ready row carrying source=scan, one transaction_photos
   insert per row whose object name starts with rcpt_, and no receipt in the
   memories feed. The unread row must survive the save. */
module.exports = {
  feature: 'receipt-scan',
  flows: [
    {
      name: 'scan-review-save-family',
      lang: 'vi',
      run: async (t) => {
        t.step('seed a reviewed batch: two ready rows and one the model could not read');
        await t.eval(`(function(){
          var c=document.createElement('canvas'); c.width=120; c.height=160; var x=c.getContext('2d'); x.fillStyle='#fbfaf6'; x.fillRect(0,0,120,160); x.fillStyle='#222'; x.fillText('TONG 85.000',10,80);
          var a=c.toDataURL('image/jpeg',0.8); x.fillText('118.000',10,100); var b=c.toDataURL('image/jpeg',0.8); x.fillText('?',10,120); var d=c.toDataURL('image/jpeg',0.8);
          /* today, read from the app's own clock: the ledger renders the current
             period, so a hard-coded date silently walks off screen as time passes. */
          var _t=isoDate(TODAY);
          __fhScanSeed({ scope:'family', items:[
            { src:a, state:'ok', amt:85, note:'QC Circle K', cat:'Ăn uống', date:_t, time:'08:12' },
            { src:b, state:'flag', amt:118, note:'QC Highlands', cat:'Ăn uống', date:_t, time:'09:40' },
            { src:d, state:'bad' } ] });
        })()`);
        await t.wait(400);
        t.expect(await t.eval(() => document.getElementById('scan-review').classList.contains('on')), 'review list is open');
        t.expect((await t.eval(() => document.getElementById('scan-save').textContent)) === 'Lưu 2', 'Save counts the two ready rows');
        t.expect(/Sổ gia đình/.test(await t.eval(() => document.getElementById('scan-dest').textContent)), 'header names the family book');
        await t.shot('01-review');

        t.step('save');
        // record every toast: the batch toast is followed by the existing "photo saved" toast once uploads land
        await t.eval(`(function(){ window.__toasts=[]; var o=window.toast; window.toast=function(m){ window.__toasts.push(String(m)); return o.apply(this, arguments); }; })()`);
        await t.click('#scan-save');
        await t.wait(150);
        t.expect(await t.eval(() => window.txns.filter((x) => /^QC /.test(x.note)).every((x) => x.source === 'scan')), 'each local row is stamped source=scan before hydrate');
        t.expect(await t.eval(() => document.querySelectorAll('#tx-rows .row.scan-new').length === 2), 'the two saved rows are marked in the list');
        await t.wait(750);
        const toasts = await t.eval(() => window.__toasts.slice());
        t.expect(toasts.some((m) => /Đã ghi 2 khoản · còn 1 ảnh chưa đọc/.test(m)), 'a toast named the count and the photo still unread: ' + JSON.stringify(toasts));
        t.expect(toasts.filter((m) => /Đã ghi \d+ khoản/.test(m)).length === 1, 'exactly one batch toast, not the bulk one as well: ' + JSON.stringify(toasts));
        t.expect(await t.eval(() => { const e = document.getElementById('toast'); return e.scrollWidth <= e.clientWidth + 1; }), 'the toast fits its pill');
        t.expect(/1 ảnh đang chờ nhập tay/.test(await t.eval(() => document.getElementById('scan-wait').textContent)), 'the add-sheet row says a photo is waiting');
        t.expect(await t.eval(() => !document.getElementById('scan-review').classList.contains('on')), 'the review steps aside so the ledger is what shows');
        t.expect(await t.eval(() => window.txns.filter((x) => /^QC /.test(x.note)).length === 2), 'two rows in the local ledger');
        t.expect(await t.eval(() => window.txns.some((x) => x.note === 'QC Circle K' && x.amt === 85)), 'amount landed in base units (85)');
        t.expect(await t.eval(() => window.txns.filter((x) => /^QC /.test(x.note)).every((x) => x.photos && x.photos.length === 1)), 'each saved row carries its own receipt');
        t.expect(await t.eval(() => {
          const a = window.txns.find((x) => x.note === 'QC Circle K'), b = window.txns.find((x) => x.note === 'QC Highlands');
          return !!(a && b && a.time === '08:12' && b.time === '09:40');
        }), 'each row kept its OWN time, not the first row\'s');
        await t.shot('02-saved');

        t.step('the backend was told the right things');
        await t.wait(600);
        const w = await t.writes();
        const tx = w.filter((x) => x.table === 'transactions' && x.op === 'insert' && /^QC /.test(x.payload.note || ''));
        t.expect(tx.length === 2, 'two transactions inserts');
        t.expect(tx.every((x) => x.payload.source === 'scan'), 'both carry source=scan: ' + JSON.stringify(tx.map((x) => x.payload.source)));
        const ph = w.filter((x) => x.table === 'transaction_photos' && x.op === 'insert');
        t.expect(ph.length >= 2, 'a transaction_photos insert per row (' + ph.length + ')');
        t.expect(ph.every((x) => /\/rcpt_/.test(x.payload.photo_url || '')), 'every receipt object name starts with rcpt_: ' + JSON.stringify(ph.map((x) => x.payload.photo_url)));

        t.step('receipts never became memories');
        await t.eval(`go('events'); if(typeof renderEvents==='function') renderEvents();`);
        await t.wait(400);
        t.expect(await t.eval(() => !(window.memRecords || []).some((r) => r.type === 'expense' && /^QC /.test(r.cap || ''))), 'no QC receipt in the memories feed');

        t.step('the unread row stayed behind');
        t.expect(await t.eval(() => window.fhScanHasBatch()), 'the batch still holds the unread row');
        t.expect(/Chưa đọc được/.test(await t.eval(() => document.getElementById('scan-rows').textContent)), 'it still reads as not read');
        await t.eval(`fhScanStart('personal')`);   // came back by the OTHER row
        await t.wait(300);
        t.expect(await t.eval(() => document.getElementById('scan-review').classList.contains('on')), 'the scan row reopens the waiting batch');
        t.expect(/Sổ gia đình/.test(await t.eval(() => document.getElementById('scan-dest').textContent)), 'and it is still a family batch, whichever row reopened it');
      },
    },
    {
      /* The personal book saves through _submitPersonalExpense, not submitBulk. Its
         interactive parse used to overwrite row 0 with the empty form, so the FIRST
         receipt of every personal batch vanished while the toast counted it. */
      name: 'scan-review-save-personal',
      lang: 'vi',
      run: async (t) => {
        t.step('open the personal book and seed three read receipts');
        await t.eval(`go('personal')`);
        await t.wait(1200);
        /* the harness hangs personal reads so the painted snapshot survives; a save
           must be allowed through, and its re-read has nothing real to fetch */
        await t.eval(`(function(){
          window.__STUB.hang='';
          window.fhPersonalHydrate=async function(){};
          var c=document.createElement('canvas'); c.width=120; c.height=160; var x=c.getContext('2d'); x.fillStyle='#fbfaf6'; x.fillRect(0,0,120,160);
          var a=c.toDataURL('image/jpeg',0.8), _t=isoDate(TODAY);
          __fhScanSeed({ scope:'personal', items:[
            { src:a, state:'ok', amt:85, note:'QP Circle K', cat:'Ăn uống', date:_t, time:'08:12' },
            { src:a, state:'ok', amt:236, note:'QP Long Châu', cat:'Khác', date:_t, time:'16:05' },
            { src:a, state:'ok', amt:118, note:'QP Highlands', cat:'Ăn uống', date:_t, time:'09:40' } ] });
        })()`);
        await t.wait(400);
        t.expect((await t.eval(() => document.getElementById('scan-save').textContent)) === 'Lưu 3', 'Save counts three rows');
        t.expect(/Sổ cá nhân/.test(await t.eval(() => document.getElementById('scan-dest').textContent)), 'header names the personal book');

        t.step('save');
        await t.eval(`(function(){ window.__toasts=[]; var o=window.toast; window.toast=function(m){ window.__toasts.push(String(m)); return o.apply(this, arguments); }; })()`);
        await t.click('#scan-save');
        await t.wait(2500);
        const w = await t.writes();
        const tx = w.filter((x) => x.table === 'personal_transactions' && x.op === 'insert');
        t.expect(tx.length === 3, 'three personal_transactions inserts, the first row included (' + tx.length + ')');
        t.expect(tx.every((x) => x.payload.source === 'scan'), 'each carries source=scan');
        t.expect(!w.some((x) => x.table === 'transactions' && x.op === 'insert'), 'nothing was written to the family ledger');
        const ph = w.filter((x) => x.table === 'personal_transaction_photos' && x.op === 'insert');
        t.expect(ph.length === 3, 'a receipt per row (' + ph.length + ')');
        const toasts = await t.eval(() => window.__toasts.slice());
        t.expect(toasts.some((m) => /Đã ghi 3 khoản từ hóa đơn/.test(m)), 'the toast counts what was written: ' + JSON.stringify(toasts));
        t.expect(!toasts.some((m) => /Đã ghi vào sổ cá nhân/.test(m)), 'one toast, not the personal one as well');
        t.expect(await t.eval(() => !window.fhScanHasBatch()), 'the batch is finished');
        await t.shot('03-personal-saved');
      },
    },
  ],
};
