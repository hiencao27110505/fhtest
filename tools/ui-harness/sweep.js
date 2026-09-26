/* Regression sweep: every manifest and every flow file, summarised and
   compared with the approved summary per feature.

   node tools/ui-harness/sweep.js [--feature name] [--approve] [--skip-flows]

   Regression = a shot that vanished, a shot with new console/page errors, a
   lint count that grew (targets/overflow/language/pageScroll), or a flow that
   was passing and now fails. Pixel diffs are deliberately not used (fixture
   dates float). `--approve` writes the current summary to
   tools/ui-harness/approved/<feature>.json (committed) as the new baseline.
   Output: shots/sweep.json and a table; exit 1 on any regression. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MAN = path.join(__dirname, 'manifests'), FLOWS = path.join(__dirname, 'flows'), APPROVED = path.join(__dirname, 'approved');
const a = process.argv.slice(2);
const only = a.includes('--feature') ? a[a.indexOf('--feature') + 1] : null;
const approve = a.includes('--approve'), skipFlows = a.includes('--skip-flows');

const run = (script, file) => spawnSync(process.execPath, [script, file], { cwd: ROOT, encoding: 'utf8' });
const lintOf = (l) => l ? { targets: l.targets.length, overflow: l.overflow.length, language: l.language.length, pageScroll: l.pageScroll ? 1 : 0 } : { targets: 0, overflow: 0, language: 0, pageScroll: 0 };

function summarise(feature) {
  const out = { feature, shots: {}, flows: {} };
  try {
    const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'shots', feature, 'report.json'), 'utf8'));
    r.shots.forEach((s) => { out.shots[`${s.name}.${s.lang}.${s.theme}`] = { errors: (s.errors || []).length + (s.setupError ? 1 : 0), lint: lintOf(s.lint) }; });
  } catch (e) {}
  try {
    const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'shots', feature, 'flows.json'), 'utf8'));
    f.flows.forEach((x) => { out.flows[x.name] = x.ok; });
  } catch (e) {}
  return out;
}

function compare(cur, prev) {
  const regs = [];
  if (!prev) return regs;
  for (const k of Object.keys(prev.shots)) {
    const p = prev.shots[k], c = cur.shots[k];
    if (!c) { regs.push(`${k}: shot missing`); continue; }
    if (c.errors > p.errors) regs.push(`${k}: errors ${p.errors} → ${c.errors}`);
    for (const m of ['targets', 'overflow', 'language', 'pageScroll']) if (c.lint[m] > p.lint[m]) regs.push(`${k}: lint.${m} ${p.lint[m]} → ${c.lint[m]}`);
  }
  for (const k of Object.keys(prev.flows)) {
    if (prev.flows[k] && cur.flows[k] === false) regs.push(`flow ${k}: was passing, now fails`);
    if (prev.flows[k] && cur.flows[k] === undefined) regs.push(`flow ${k}: missing`);
  }
  return regs;
}

const manifests = fs.readdirSync(MAN).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
const flowFiles = fs.existsSync(FLOWS) ? fs.readdirSync(FLOWS).filter((f) => f.endsWith('.flow.js')).map((f) => f.replace(/\.flow\.js$/, '')) : [];
const features = [...new Set(manifests.concat(flowFiles))].filter((f) => !only || f === only);
const results = [];
let regressions = 0, failures = 0;
for (const feature of features) {
  const line = { feature, shots: '-', flows: '-', regressions: [] };
  if (manifests.includes(feature)) {
    const r = run(path.join(__dirname, 'shots.js'), path.join(MAN, feature + '.js'));
    const m = (r.stdout || '').match(/(\d+) shots → .*\((\d+) failed, (\d+) lint hits/);
    line.shots = m ? `${m[1]} shots, ${m[2]} failed, ${m[3]} lint` : 'crashed';
    if (r.status !== 0) failures++;
  }
  if (!skipFlows && flowFiles.includes(feature)) {
    const r = run(path.join(__dirname, 'flows.js'), path.join(FLOWS, feature + '.flow.js'));
    const m = (r.stdout || '').match(/(\d+) flows → .*\((\d+) failed/);
    line.flows = m ? `${m[1]} flows, ${m[2]} failed` : 'crashed';
    if (r.status !== 0) failures++;
  }
  const cur = summarise(feature);
  const apf = path.join(APPROVED, feature + '.json');
  let prev = null; try { prev = JSON.parse(fs.readFileSync(apf, 'utf8')); } catch (e) {}
  line.regressions = compare(cur, prev);
  regressions += line.regressions.length;
  if (approve) { fs.mkdirSync(APPROVED, { recursive: true }); fs.writeFileSync(apf, JSON.stringify(cur, null, 2)); line.approved = true; }
  else if (!prev) line.note = 'no approved baseline yet (run with --approve)';
  results.push(line);
}
fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'shots', 'sweep.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log('\nfeature          shots                         flows                 regressions');
for (const l of results) console.log(`${l.feature.padEnd(16)} ${l.shots.padEnd(29)} ${l.flows.padEnd(21)} ${l.regressions.length}${l.approved ? '  (approved)' : ''}${l.note ? '  ' + l.note : ''}`);
for (const l of results) for (const r of l.regressions) console.log(`  ✗ ${l.feature}: ${r}`);
console.log(`\nsweep: ${features.length} features, ${failures} runner failures, ${regressions} regressions → shots/sweep.json`);
process.exit(regressions || failures ? 1 : 0);
