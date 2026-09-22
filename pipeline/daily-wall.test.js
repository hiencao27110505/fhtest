#!/usr/bin/env node
/* The model's daily wall, wired (email-reading-v2 §10.3; 0116 model_pause,
 * spend_model_budget, pause_model). `node pipeline/daily-wall.test.js`
 *
 * llm.mjs has told a per-day 429 from a per-minute one since 2026-09-02 and
 * nothing used it: on that day one mailbox re-read the same window 66 times
 * against an exhausted daily pool. Driven through the real runGrant:
 *   1. a per-day 429 writes the wall down (pause_model, Pacific reset) and the
 *      rest of the run makes no model call: model-needing mail is parked
 *   2. a run that starts paused makes no model call at all; the free tiers read
 *   3. the day's ledger is asked before every call, on the right lane; `false`
 *      parks the mail and stops the calls
 *   4. priority when short: statement verdicts and classification stand down
 *      before extraction does
 */
import { W, L, makeCtx, memoryDb, mailFor, settled, reporter, TXN_ANSWER, DAY_429, MINUTE_429 } from './v2-harness.mjs';
const { t, done } = reporter();

const mail = (id) => mailFor(id, id.startsWith('t') ? 'table' : 'model', id);

console.log('\n-- 1. a per-day 429 mid-run: written down, then no more calls this run --');
{
  const db = memoryDb();
  const before = Date.now();
  const ctx = makeCtx({ db, queue: ['m1', 'm2', 'm3', 't1'], mail, maxModelCalls: 40,
    llm: (n) => (n === 1 ? { status: 429, body: DAY_429 } : { status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('exactly ONE model call was made: the wall stopped the next two', ctx.model.calls === 1, ctx.model.calls);
  const p = db.calls.find((c) => c[0] === 'pauseModel');
  t('pause_model was called for the model, reason quota_day', p && p[1] === L.DEFAULT_MODEL && p[2] === 'quota_day', p);
  const until = Date.parse(db.pause.until);
  t('...until the next Pacific reset (within a day, in the future)', until > before && until <= before + 86400000 + 1000, db.pause.until);
  t('all three model-needing mails are parked, none held', r.parked === 3 && r.held === 0, r);
  t('the table-readable mail still staged and the cursor advanced', r.staged === 1 && db.calls.some((c) => c[0] === 'markSynced'), r);
  t('the summary says why', r.modelPaused === 'rate_day', r.modelPaused);
  t('the first hold names the wall, the later ones the pause', db.holds.get('m1').reason === 'rate_day' && db.holds.get('m2').reason === 'model_paused', [...db.holds]);
}

console.log('\n-- 2. a run that starts paused: no model call at all, the free tiers read --');
{
  const db = memoryDb();
  db.pause.until = new Date(Date.now() + 3600000).toISOString();
  const ctx = makeCtx({ db, queue: ['m1', 't1'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('the pause row was read once', db.calls.filter((c) => c[0] === 'modelPausedUntil').length === 1);
  t('no model call', ctx.model.calls === 0);
  t('the model-bound mail is parked without a body fetch (its shape is unknown, so headers then body... no: unknown shapes are fetched, then parked)',
    r.parked === 1 && db.holds.get('m1').reason === 'model_paused', r);
  t('the table mail staged', r.staged === 1, r);
  t('summary.modelPaused = paused', r.modelPaused === 'paused', r.modelPaused);
  /* And the slow lane stays shut while paused: a parked message is not retried
     into a wall we know about. */
  const ctx2 = makeCtx({ db, queue: [], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  const r2 = await W.runGrant(settled(), ctx2);
  t('the slow lane does not run while paused', r2.retried === 0 && ctx2.model.calls === 0, r2);
}

console.log('\n-- 3. the day\'s ledger is asked before every call, on the grant\'s lane --');
{
  const db = memoryDb({ dailyCap: 2 });
  const ctx = makeCtx({ db, queue: ['m1', 'm2', 'm3'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  const spends = db.calls.filter((c) => c[0] === 'spendModelBudget');
  t('spend_model_budget was asked before each call, lane live', spends.length === 3 && spends.every((c) => c[2] === 'live' && c[3] === 1), spends);
  t('two calls were made, the third was refused by the ledger and parked', ctx.model.calls === 2 && r.staged === 2 && r.parked === 1, r);
  t('the refusal stops the model for the rest of the run', r.modelPaused === 'budget', r.modelPaused);

  const db2 = memoryDb();
  const ctx2 = makeCtx({ db: db2, queue: ['m1'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  await W.runGrant(settled({ backfilled_at: null }), ctx2);
  t('a backfilling grant spends on the backfill lane', db2.calls.some((c) => c[0] === 'spendModelBudget' && c[2] === 'backfill'), db2.calls.filter((c) => c[0] === 'spendModelBudget'));
}

console.log('\n-- 4. a per-minute 429 also stops this run\'s calls, but writes no pause row --');
{
  const db = memoryDb();
  const ctx = makeCtx({ db, queue: ['m1', 'm2'], mail, maxModelCalls: 40,
    llm: (n) => (n === 1 ? { status: 429, body: MINUTE_429 } : { status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('one call, then parked', ctx.model.calls === 1 && r.parked === 2, r);
  t('no pause row for a per-minute wall', !db.calls.some((c) => c[0] === 'pauseModel') && db.pause.until === null);
  t('summary says rate_minute', r.modelPaused === 'rate_minute', r.modelPaused);
}

console.log('\n-- 5. priority when short: statements and classification stand down before extraction --');
{
  /* A grant budget of 1: extraction may use it; a statement verdict needs 2
     remaining; a classify needs 5. Observed through the gates the worker
     builds, by asking them the way statement.mjs and classify.mjs do. */
  const db = memoryDb();
  let seenClassify = null;
  const origEnrich = null;
  const ctx = makeCtx({ db, queue: ['m1'], mail, maxModelCalls: 1, classifyBudget: { left: 3 },
    llm: () => ({ status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('extraction spent the one call', ctx.model.calls === 1 && r.staged === 1, r);
  t('the classifier made no call: its share reads 0 while extraction has fewer than classifyMin left', ctx.model.calls === 1 && ctx.classifyBudget.left === 3, ctx.classifyBudget);
  /* The control: with room to spare the same mail DOES cost a classify call,
     so the line above is the gate and not the cascade answering locally. */
  const ctl = makeCtx({ db: memoryDb(), queue: ['m1'], mail, maxModelCalls: 10, classifyBudget: { left: 3 }, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  await W.runGrant(settled(), ctl);
  t('...control: with 10 calls left the classifier spends one', ctl.model.calls === 2 && ctl.classifyBudget.left === 2, [ctl.model.calls, ctl.classifyBudget]);
  t('MODEL_PRIORITY: statement 2, classify 5', W.MODEL_PRIORITY.statementMin === 2 && W.MODEL_PRIORITY.classifyMin === 5, W.MODEL_PRIORITY);
  /* The statement lane's gate, in isolation: statement.mjs asks ctx.spendModel('statement'). */
  const S = await import(new URL('../supabase/functions/_shared/mailbox/statement.mjs', import.meta.url));
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../supabase/functions/_shared/mailbox/statement.mjs', import.meta.url), 'utf8'));
  t('statement.mjs asks the worker\'s gate before a verdict, and treats no as "decide next run"',
    /ctx\.spendModel && !\(await ctx\.spendModel\('statement'\)\)\) \{ summary\.undecided\+\+; limited = true; continue; \}/.test(src));
  const w = await import('node:fs').then((fs) => fs.readFileSync(new URL('../supabase/functions/_shared/mailbox/worker.mjs', import.meta.url), 'utf8'));
  t('the worker hands the lane that gate', /runStatementLane\(grant, \{ \.\.\.ctx, access, domains, days, backfillDays, spendModel \}\)/.test(w));
  t('...which refuses while extraction keeps fewer than statementMin', /kind === 'statement' && \(modelPaused \|\| \(ctx\.budget && ctx\.budget\.left\(\) < priority\.statementMin\)\)\) return false/.test(w));
}

done();
