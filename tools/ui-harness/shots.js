/* UI harness screenshot runner.
   Drives the REAL built index.html in headless Chrome at iPhone size, against
   the stubbed Supabase fed with the fixture family + a sealed personal
   snapshot (tools/ui-harness/session.js). No credentials, no network.

   node tools/ui-harness/shots.js <manifest.js> [--only name[,name]] [--langs vi,en] [--themes sage,ocean] [--out dir] [--strict]

   Manifest: { feature, langs?, themes?, shots: [{ name, setup, settleMs?, langs?, themes? }] }
     setup — JS source evaluated in the page after boot (globals: go, openSheet, openExpense, …)
   Output: <out>/<name>.<lang>.<theme>.png (+ .jpg for the storyboard) and <out>/report.json,
   each shot carrying its console errors and a DOM lint (tools/ui-harness/lint.js).
   Exit 1 when any setup threw or the page raised an uncaught error; with --strict, also on lint hits.
   A partial run (--only/--langs/--themes) merges into the previous report.json. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { launch } = require('./browser');
const { serve } = require('./serve');
const { bootPage, fixtureStrings, isBad, ROOT } = require('./session');
const { domLint } = require('./lint');

function args() {
  const a = process.argv.slice(2), o = { only: null, langs: null, themes: null, out: null, manifest: null, strict: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--only') o.only = a[++i].split(',');
    else if (a[i] === '--langs') o.langs = a[++i].split(',');
    else if (a[i] === '--themes') o.themes = a[++i].split(',');
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--strict') o.strict = true;
    else o.manifest = a[i];
  }
  if (!o.manifest) { console.error('usage: node tools/ui-harness/shots.js <manifest.js> [--only a,b] [--langs vi,en] [--themes sage,ocean] [--out dir] [--strict]'); process.exit(2); }
  return o;
}
const lintCount = (l) => l ? l.targets.length + l.overflow.length + l.language.length + (l.pageScroll ? 1 : 0) : 0;

(async () => {
  const o = args();
  const manifest = require(path.resolve(o.manifest));
  const feature = manifest.feature || path.basename(o.manifest, '.js');
  const out = path.resolve(o.out || path.join(ROOT, 'shots', feature));
  fs.mkdirSync(out, { recursive: true });
  const langs = o.langs || manifest.langs || ['vi', 'en'];
  const themes = o.themes || manifest.themes || ['sage'];
  const shots = manifest.shots.filter((s) => !o.only || o.only.includes(s.name));
  if (!shots.length) { console.error('no shots selected'); process.exit(2); }

  /* FH_MINIFY=1 shoots the build Vercel actually serves (build.js --deploy, esbuild).
     Worth doing before a release: ~253 inline on* handlers call top-level functions BY
     NAME, so a minifier that renamed one would leave every tap silently dead. */
  execSync('node build.js' + (process.env.FH_MINIFY ? ' --deploy' : ''), { cwd: ROOT, stdio: 'inherit' });
  const srv = await serve(ROOT);
  const browser = await launch();
  const userStrings = fixtureStrings();
  let prev = null; try { prev = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')); } catch (e) {}
  const partial = !!(o.only || o.langs || o.themes);
  const report = { feature, at: new Date().toISOString(), langs: partial && prev ? prev.langs : langs, themes: partial && prev ? prev.themes : themes, shots: [] };
  let failed = 0, lintHits = 0;

  for (const lang of langs) for (const theme of themes) {
    const wanted = shots.filter((s) => (!s.langs || s.langs.includes(lang)) && (!s.themes || s.themes.includes(theme)));
    if (!wanted.length) continue;
    let sess;
    try { sess = await bootPage(browser, srv.url, { lang, theme }); }
    catch (e) { console.error(`  ✗ boot ${lang}/${theme}: ${e.message}`); failed++; report.shots.push({ name: '(boot)', lang, theme, error: e.message, errors: [] }); continue; }
    const { page, errors } = sess;
    for (const s of wanted) {
      const t0 = Date.now();
      errors.length = 0;
      await page.evaluate(() => { try { closeModals(); } catch (e) {} try { closeSheet(); } catch (e) {} });
      const err = await page.evaluate((src) => { try { (0, eval)(src); return null; } catch (e) { return String(e && e.stack || e).slice(0, 400); } }, s.setup || '');
      await new Promise((r) => setTimeout(r, s.settleMs || 400));
      const file = `${s.name}.${lang}.${theme}`;
      await page.screenshot({ path: path.join(out, file + '.png') });
      await page.screenshot({ path: path.join(out, file + '.jpg'), type: 'jpeg', quality: 80 });
      let lint = null;
      try { lint = await page.evaluate(domLint, { lang, userStrings }); } catch (e) { lint = { error: String(e).slice(0, 200), targets: [], overflow: [], language: [], pageScroll: false }; }
      const lc = lintCount(lint); lintHits += lc;
      const bad = !!err || isBad(errors) || (o.strict && lc > 0);
      if (bad) failed++;
      report.shots.push({ name: s.name, lang, theme, file: file + '.png', ms: Date.now() - t0, setupError: err, errors: errors.slice(), lint });
      const lintNote = lc ? `  lint: ${lint.targets.length} targets, ${lint.overflow.length} overflow, ${lint.language.length} language${lint.pageScroll ? ', page scrolls sideways' : ''}` : '';
      console.log(`  ${bad ? '✗' : '✓'} ${file}${err ? '  setup: ' + err.split('\n')[0] : ''}${errors.length ? '  console: ' + errors.length : ''}${lintNote}`);
    }
    await sess.close();
  }

  if (partial && prev) {
    const key = (s) => s.name + '|' + s.lang + '|' + s.theme;
    const fresh = new Set(report.shots.map(key));
    report.shots = prev.shots.filter((s) => !fresh.has(key(s))).concat(report.shots);
    const order = manifest.shots.map((s) => s.name);
    report.shots.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); srv.close();
  console.log(`\n${report.shots.length} shots → ${path.relative(ROOT, out)}/  (${failed} failed, ${lintHits} lint hits${o.strict ? ', strict' : ''})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('shots crashed:', e); process.exit(2); });
