#!/usr/bin/env node
/* The coverage matrix holds (statement-coverage-spec.md §5):
 *   a supported row has a fixture that PROVES through the real reader;
 *   a fixture has a row; a seeded shape has a row; a row's shape is what
 *   statementShape() computes from its subject sample; a row's provider is in the
 *   registry; the spec's generated block is current.
 *
 *   node tools/statement-coverage.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require(path.join(ROOT, 'tools', 'gen-statement-coverage.js'));
const S = require(path.join(ROOT, 'src', 'js-ui', '59-statement-table.js'));
const FX = path.join(__dirname, 'fixtures', 'statements');
let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 240) : '')); ok ? pass++ : fail++; };

global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'src', 'js-data', '43-pdf-grid.js'), 'utf8'));
const usable = (r) => r.date !== undefined && (r.amount !== undefined || r.debit !== undefined || r.credit !== undefined);

async function gridOf(row) {
  if (row.ext === 'pdf') {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const man = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8')).fixtures.find((m) => m.file === row.fixture) || {};
    const pages = await window.fhPdfPagesOf(lib, fs.readFileSync(path.join(FX, row.fixture)), man.password);
    return window.fhPdfItemsToGrid(pages, { roles: S.fhStmtRoles, usable });
  }
  const g = path.join(FX, row.fixture.replace(/\.locked/, '').replace(/\.(xlsx|csv)$/, '') + '.grid.json');
  return JSON.parse(fs.readFileSync(g, 'utf8'));
}

(async () => {
  const data = G.load();
  const ST = await import(path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'statement.mjs'));
  const providers = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy', 'providers.json'), 'utf8')).providers.map((p) => p.key);
  const fixtures = fs.readdirSync(FX).filter((f) => /\.(xlsx|csv|pdf)$/.test(f));

  console.log('\n-- every row --');
  for (const r of data.formats) {
    const id = r.provider + '/' + r.product + '/' + r.ext;
    t(id + ': status is one of supported | unsupported | unverified', ['supported', 'unsupported', 'unverified'].includes(r.status), r.status);
    t(id + ': provider is a registry key', providers.includes(r.provider), r.provider);
    t(id + ': subject_shape is what statementShape() computes from the sample', ST.statementShape(r.subject_sample) === r.subject_shape, { want: ST.statementShape(r.subject_sample), have: r.subject_shape });
    t(id + ': a fixture only on a supported row', (r.status === 'supported') === !!r.fixture, r.fixture);
    if (r.status === 'supported') {
      t(id + ': the fixture exists', fixtures.includes(r.fixture), r.fixture);
      let proved = false, how = '';
      try { const p = S.fhStmtParse(await gridOf(r), null, { provider: r.provider }); proved = !!(p.table && p.rows.length && p.proof.ok); how = p.proof.how; } catch (e) { how = String(e); }
      t(id + ': the fixture PROVES through the real reader (' + how + ')', proved, how);
    }
  }

  console.log('\n-- nothing unlisted, nothing stale --');
  const named = new Set(data.formats.map((r) => r.fixture).filter(Boolean));
  t('every fixture file has a row', fixtures.every((f) => named.has(f)), fixtures.filter((f) => !named.has(f)));
  const seeded = G.seededShapes();
  const rowsKeys = new Set(data.formats.map((r) => r.sender + '|' + r.subject_shape));
  t('every seeded shape has a row', [...seeded].every((k) => rowsKeys.has(k)), [...seeded].filter((k) => !rowsKeys.has(k)));
  const { spec, next } = G.render(data);
  t('the spec\'s coverage block is current (run tools/gen-statement-coverage.js)', spec === next);
  const sql = G.seedSql(data);
  t('the generator names the supported shapes still to seed (SQL for a hand-numbered migration)', /techcombank/.test(sql) === data.formats.some((r) => r.provider === 'techcombank' && !seeded.has(r.sender + '|' + r.subject_shape)));

  console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' PASSED'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
