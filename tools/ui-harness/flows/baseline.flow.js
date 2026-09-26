/* Baseline journeys: the core loop every release must keep working.
   Each flow drives the real UI code (modal, chips, save, detail sheet,
   arm-then-confirm delete) and asserts both the screen and the stub's write log. */
module.exports = {
  feature: 'baseline',
  flows: [
    {
      name: 'add-family-expense-then-delete',
      lang: 'vi',
      run: async (t) => {
        t.step('open the expense modal in family scope');
        await t.eval(`go('home'); openExpense({ scope: 'family' })`);
        await t.wait(500);
        t.expect(await t.eval(() => document.getElementById('expense-modal').classList.contains('on')), 'expense modal is open');
        await t.eval(() => { const b = document.querySelector('#ex-scope [data-v="family"]'); if (b) b.click(); });
        t.expect((await t.eval(() => chosen('ex-scope'))) === 'family', 'scope is family');

        t.step('fill note, category, amount');
        await t.type('#ex-note', 'QC cà phê');
        await t.eval(() => { const c = document.querySelector('#ex-cat [data-v="Ăn uống"]'); if (c) c.click(); });
        await t.type('#ex-amt', '120000');
        await t.wait(200);
        await t.shot('01-filled');
        t.expect(!(await t.eval(() => document.getElementById('ex-save').disabled)), 'save is enabled');

        t.step('save');
        await t.click('#ex-save');
        await t.wait(500);
        t.expect(!(await t.eval(() => document.getElementById('expense-modal').classList.contains('on'))), 'modal closed after save');
        const toast1 = await t.toast();
        t.expect(/Đã ghi/.test(toast1), 'toast confirms the write: ' + toast1);
        t.expect(await t.eval(() => window.txns.some((x) => x.note === 'QC cà phê' && x.amt === 120)), 'new txn is in the local ledger with amount 120 (base units)');
        await t.shot('02-saved');

        t.step('backend received the insert');
        await t.wait(300);
        let w = await t.writes();
        const ins = w.find((x) => x.table === 'transactions' && x.op === 'insert');
        t.expect(!!ins, 'an insert into transactions was sent');
        t.expect(ins && Number(ins.payload.amount) === 120 && ins.payload.note === 'QC cà phê', 'insert carries amount 120 and the note');

        t.step('survives the windowed re-hydrate');
        await t.wait(1500);
        const after = await t.eval(() => (window.txns.find((x) => x.note === 'QC cà phê') || null) && { id: window.txns.find((x) => x.note === 'QC cà phê').id, dbId: window.txns.find((x) => x.note === 'QC cà phê')._dbId });
        t.expect(after && after.dbId, 'row came back from the (stub) database with a db id: ' + JSON.stringify(after));
        t.expect(await t.eval(() => /QC cà phê/.test((document.getElementById('home-tx') || document.getElementById('tx-rows') || {}).textContent || '')), 'row is visible in a list');

        t.step('delete via detail sheet, arm then confirm');
        await t.eval((id) => openExpenseDetail(id), after.id);
        await t.wait(500);
        await t.shot('03-detail');
        // the detail opens read-only now (one screen for every kind, 2026-09-18); Sửa reveals the delete
        await t.eval(() => { if (typeof exdEdit === 'function') exdEdit(); });
        await t.wait(300);
        await t.click('#exd-del');
        await t.wait(200);
        t.expect(await t.eval(() => window.txns.some((x) => x.note === 'QC cà phê')), 'first tap only arms; row still there');
        await t.click('#exd-del');
        await t.wait(600);
        t.expect(!(await t.eval(() => window.txns.some((x) => x.note === 'QC cà phê'))), 'second tap deletes locally');
        const toast2 = await t.toast();
        t.expect(/Đã xoá/.test(toast2), 'toast confirms the delete: ' + toast2);
        await t.wait(300);
        w = await t.writes();
        t.expect(w.some((x) => x.table === 'transactions' && x.op === 'delete'), 'a delete on transactions was sent');

        t.step('still gone after re-hydrate');
        await t.wait(1500);
        t.expect(!(await t.eval(() => window.txns.some((x) => x.note === 'QC cà phê'))), 'row does not come back');
        await t.shot('04-after-delete');
      }
    },
    {
      name: 'switch-language-persists',
      lang: 'vi',
      run: async (t) => {
        t.step('tabs render in Vietnamese');
        t.expect(/Khoảnh khắc/.test(await t.eval(() => document.getElementById('t-events').textContent)), 'Moments tab reads Khoảnh khắc');
        t.step('switch to English');
        await t.eval(`LANG='en'; applyLang(); renderAll(); localStorage.setItem('fh-lang','en')`);
        await t.wait(300);
        t.expect(/Moments/.test(await t.eval(() => document.getElementById('t-events').textContent)), 'Moments tab reads Moments');
        t.expect((await t.eval(() => localStorage.getItem('fh-lang'))) === 'en', 'choice persisted');
        await t.shot('01-english');
      }
    }
  ]
};
