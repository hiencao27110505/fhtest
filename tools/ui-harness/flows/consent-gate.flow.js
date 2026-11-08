/* Consent gate journeys (docs/briefs/consent-gate.md): a bank_email v4 person
   (the harness fixture) sees what is off, opens the sheet scoped to it, declines
   without a trace, agrees with one insert, and the row is gone. Drives the real
   code against the stub; writes are read from the stub's log. */
module.exports = {
  feature: 'consent-gate',
  flows: [
    {
      name: 'v4-sees-rows-declines-then-agrees',
      lang: 'vi',
      run: async (t) => {
        t.step('the empty queue shows what is off');
        await t.eval(`(window.fhConsentState ? fhConsentState() : Promise.resolve()).then(function(){ fhTxnReviewSheet({ kind:'personal' }); })`);
        await t.wait(900);
        const rowsBefore = await t.eval(() => document.querySelectorAll('#sheet-cst .cst-lrow[data-cst]').length);
        t.expect(rowsBefore === 2, 'two status rows (statements, receipts) are drawn: ' + rowsBefore);
        t.expect(await t.eval(() => /Đang tắt/.test(document.getElementById('sheet-cst').textContent)), 'the rows read "Đang tắt"');
        t.expect(await t.eval(() => !/Bật<\/span>/.test(document.getElementById('sheet-cst').innerHTML)), 'no verb in the value slot');
        await t.shot('01-queue-empty');

        t.step('tapping the statements row opens the sheet scoped to statements');
        await t.eval(() => { const b = document.querySelector('#sheet-cst .cst-lrow[data-cst="statements"]'); if (b) b.click(); });
        await t.wait(600);
        const sheet = await t.eval(() => (document.getElementById('fh-sheet-body') || {}).innerHTML || '');
        t.expect(/SAO KÊ TỪ EMAIL/.test(sheet) && /Bật sao kê từ email/.test(sheet), 'kicker names the feature, title is the verb');
        t.expect((sheet.match(/<li>/g) || []).length === 1, 'only the statements entry is in the change block');
        await t.shot('02-sheet-scoped');

        t.step('Để sau writes nothing');
        await t.eval(() => { const b = document.querySelector('#fh-sheet-body .btn-skip'); if (b) b.click(); });
        await t.wait(300);
        let w = await t.writes();
        t.expect(!w.some((x) => x.table === 'user_consents'), 'no consent row was written');

        t.step('a second tap asks again (no latch)');
        await t.eval(`fhTxnReviewSheet({ kind:'personal' })`);
        await t.wait(800);
        await t.eval(() => { const b = document.querySelector('#sheet-cst .cst-lrow[data-cst="statements"]'); if (b) b.click(); });
        await t.wait(600);
        t.expect(await t.eval(() => !!document.getElementById('cst-agree')), 'the sheet is up again');

        t.step('agree: one insert at the current version, the toast, and the row is gone');
        await t.click('#cst-agree');
        await t.wait(700);
        w = await t.writes();
        const ins = w.filter((x) => x.table === 'user_consents' && x.op === 'insert');
        t.expect(ins.length === 1 && ins[0].payload.kind === 'bank_email' && ins[0].payload.version >= 7, 'one bank_email insert at the current version');
        const toast = await t.toast();
        t.expect(/Đã bật sao kê từ email/.test(toast), 'toast confirms after the write: ' + toast);
        await t.eval(`fhTxnReviewSheet({ kind:'personal' })`);
        await t.wait(800);
        const rowsAfter = await t.eval(() => document.querySelectorAll('#sheet-cst .cst-lrow[data-cst]').length);
        t.expect(rowsAfter === 0, 'nothing is off any more: ' + rowsAfter);
        await t.shot('03-agreed');
      }
    }
  ]
};
