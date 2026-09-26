/* Flow runner: scripted user journeys through the REAL app against the stub,
   with assertions on what the screen shows and what the backend received.

   node tools/ui-harness/flows.js <flows.js> [--only name] [--lang vi] [--out dir]

   Flow file: { feature, flows: [{ name, lang?, theme?, run: async (t) => { … } }] }
   `t` helpers: t.page (puppeteer), t.eval(js|fn, ...args), t.click(sel), t.type(sel, text),
                t.wait(ms), t.expect(cond, msg), t.shot(name), t.writes() (stub write log),
                t.toast() (last toast text), t.step(name) (labels the next assertions).
   Output: <out>/flows.json + <out>/flows/<flow>/<shot>.png. Exit 1 on any failed flow. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { launch } = require('./browser');
const { serve } = require('./serve');
const { bootPage, isBad, ROOT } = require('./session');

function args() {
  const a = process.argv.slice(2), o = { only: null, lang: null, out: null, file: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--only') o.only = a[++i].split(',');
    else if (a[i] === '--lang') o.lang = a[++i];
    else if (a[i] === '--out') o.out = a[++i];
    else o.file = a[i];
  }
  if (!o.file) { console.error('usage: node tools/ui-harness/flows.js <flows.js> [--only name] [--lang vi] [--out dir]'); process.exit(2); }
  return o;
}

function helpers(sess, dir, rec) {
  const { page } = sess;
  let step = 'start';
  const t = {
    page,
    step: (name) => { step = name; rec.steps.push({ name, ok: true, checks: [] }); },
    eval: (src, ...a) => typeof src === 'function' ? page.evaluate(src, ...a) : page.evaluate((s) => (0, eval)(s), src),
    click: async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 4000 }); await page.click(sel); },
    type: async (sel, text) => { await page.waitForSelector(sel, { visible: true, timeout: 4000 }); await page.click(sel, { clickCount: 3 }); await page.type(sel, text); },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    writes: () => page.evaluate(() => (window.__stubWrites || []).map((w) => ({ table: w.table, op: w.op, payload: w.payload, eq: w.eq }))),
    toast: () => page.evaluate(() => { const el = document.getElementById('toast'); return el ? el.textContent.trim() : ''; }),
    shot: async (name) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name + '.png'); await page.screenshot({ path: f }); rec.shots.push(path.relative(ROOT, f)); },
    expect: (cond, msg) => {
      const cur = rec.steps[rec.steps.length - 1] || (t.step(step), rec.steps[rec.steps.length - 1]);
      cur.checks.push({ msg, ok: !!cond });
      if (!cond) { cur.ok = false; rec.ok = false; throw new Error(`expect failed at "${cur.name}": ${msg}`); }
    }
  };
  return t;
}

(async () => {
  const o = args();
  const mod = require(path.resolve(o.file));
  const feature = mod.feature || path.basename(o.file, '.flow.js');
  const out = path.resolve(o.out || path.join(ROOT, 'shots', feature));
  const flows = mod.flows.filter((f) => !o.only || o.only.includes(f.name));
  if (!flows.length) { console.error('no flows selected'); process.exit(2); }

  execSync('node build.js', { cwd: ROOT, stdio: 'inherit' });
  const srv = await serve(ROOT);
  const browser = await launch();
  const report = { feature, at: new Date().toISOString(), flows: [] };
  let failed = 0;

  for (const f of flows) {
    const lang = o.lang || f.lang || 'vi', theme = f.theme || 'sage';
    const rec = { name: f.name, lang, theme, ok: true, steps: [], shots: [], errors: [], ms: 0 };
    const t0 = Date.now();
    let sess = null;
    try { fs.rmSync(path.join(out, 'flows', f.name, 'FAILED.png'), { force: true }); } catch (e) {}   // no stale failure shot from an earlier run
    try {
      sess = await bootPage(browser, srv.url, { lang, theme });
      const t = helpers(sess, path.join(out, 'flows', f.name), rec);
      await f.run(t);
      if (isBad(sess.errors)) { rec.ok = false; rec.error = 'page errors during flow'; }
    } catch (e) {
      rec.ok = false; rec.error = String(e && e.message || e).slice(0, 400);
      try { if (sess) { fs.mkdirSync(path.join(out, 'flows', f.name), { recursive: true }); await sess.page.screenshot({ path: path.join(out, 'flows', f.name, 'FAILED.png') }); rec.shots.push(path.relative(ROOT, path.join(out, 'flows', f.name, 'FAILED.png'))); } } catch (e2) {}
    }
    if (sess) { rec.errors = sess.errors.slice(); await sess.close(); }
    rec.ms = Date.now() - t0;
    if (!rec.ok) failed++;
    report.flows.push(rec);
    const checks = rec.steps.reduce((n, s) => n + s.checks.length, 0);
    console.log(`  ${rec.ok ? '✓' : '✗'} ${f.name} (${lang}) · ${rec.steps.length} steps, ${checks} checks, ${rec.ms}ms${rec.error ? '\n      ' + rec.error : ''}`);
  }

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'flows.json'), JSON.stringify(report, null, 2));
  await browser.close(); srv.close();
  console.log(`\n${report.flows.length} flows → ${path.relative(ROOT, out)}/flows.json  (${failed} failed)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('flows crashed:', e); process.exit(2); });
