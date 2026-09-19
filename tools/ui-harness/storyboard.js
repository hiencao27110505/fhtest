/* Storyboard: one self-contained HTML page from a shots/<feature>/ run.
   Rows = screens, columns = languages, theme toggle on top. Acceptance
   criteria come from the brief's "- [ ]" lines; known gaps from report.json
   (setup / console errors) plus the brief's "Known gaps" section.

   node tools/ui-harness/storyboard.js shots/<feature> [--brief docs/briefs/<feature>.md] [--out file.html] [--title "..."]

   Output is a LOCAL file (open it in the browser; never publish it). It
   inlines every screenshot as JPEG, so keep manifests per feature. */
const fs = require('fs');
const path = require('path');

function args() {
  const a = process.argv.slice(2), o = { dir: null, brief: null, out: null, title: null, target: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--brief') o.brief = a[++i];
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--title') o.title = a[++i];
    else if (a[i] === '--target') o.target = a[++i];
    else o.dir = a[i];
  }
  if (!o.dir) { console.error('usage: node tools/ui-harness/storyboard.js shots/<feature> [--brief file.md] [--out file.html] [--target shots/<feature>-target]'); process.exit(2); }
  return o;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function section(md, titleRe) {
  // returns the body of the first "## <title>" section matching titleRe (any heading level)
  const lines = md.split('\n'); let on = false, depth = 0, out = [];
  for (const ln of lines) {
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { if (on && h[1].length <= depth) break; if (!on && titleRe.test(h[2])) { on = true; depth = h[1].length; continue; } }
    if (on) out.push(ln);
  }
  return out.join('\n');
}

(function main() {
  const o = args();
  const dir = path.resolve(o.dir);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  // --target: the approved target pictures (stage 2), shown beside each built shot of the same name
  const tdir = o.target ? path.resolve(o.target) : null;
  const treport = tdir && fs.existsSync(path.join(tdir, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(tdir, 'report.json'), 'utf8')) : null;
  if (o.target && !treport) { console.error('storyboard: --target has no report.json: ' + o.target); process.exit(2); }
  const feature = report.feature || path.basename(dir);
  const title = o.title || `${feature} storyboard`;
  const brief = o.brief && fs.existsSync(o.brief) ? fs.readFileSync(o.brief, 'utf8') : '';

  // criteria + gaps from the brief
  const critMd = brief ? section(brief, /acceptance|tiêu chí|nghiệm thu/i) : '';
  const criteria = [...critMd.matchAll(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/gm)].map((m) => ({ done: m[1] !== ' ', text: m[2].trim() }));
  const gapsMd = brief ? section(brief, /known gaps|out of scope|không bao gồm|giới hạn/i) : '';
  const briefGaps = [...gapsMd.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1].trim());
  const runGaps = report.shots.filter((s) => s.setupError || (s.errors && s.errors.length)).map((s) => `${s.name} (${s.lang}/${s.theme}): ${s.setupError ? s.setupError.split('\n')[0] : s.errors.map((e) => e.text).join(' · ')}`);

  // flows (from flows.json, if the feature has journeys)
  let flowsHtml = '';
  try {
    const fj = JSON.parse(fs.readFileSync(path.join(dir, 'flows.json'), 'utf8'));
    flowsHtml = `<ul class="crit">` + fj.flows.map((f) => {
      const checks = f.steps.reduce((n, st) => n + st.checks.length, 0);
      const failed = f.steps.flatMap((st) => st.checks.filter((c) => !c.ok).map((c) => st.name + ': ' + c.msg));
      return `<li class="${f.ok ? 'done' : ''}"><span class="box">${f.ok ? '✓' : '✗'}</span><span>${esc(f.name)} <span class="muted">· ${f.steps.length} steps · ${checks} checks · ${f.ms} ms</span>${failed.length ? '<br><span class="bad">' + esc(failed.join(' · ')) + '</span>' : ''}${f.error && !failed.length ? '<br><span class="bad">' + esc(f.error) + '</span>' : ''}</span></li>`;
    }).join('') + `</ul>`;
  } catch (e) {}

  // lint totals per screen (from report.json)
  const lintRows = [];
  report.shots.forEach((s) => { if (!s.lint) return; const n = s.lint.targets.length + s.lint.overflow.length + s.lint.language.length + (s.lint.pageScroll ? 1 : 0); if (n) lintRows.push(`<li><span class="box">${n}</span><span>${esc(s.name)} <span class="muted">${esc(s.lang)}/${esc(s.theme)}</span> · ${s.lint.targets.length} small targets · ${s.lint.overflow.length} overflow · ${s.lint.language.length} language${s.lint.pageScroll ? ' · page scrolls sideways' : ''}</span></li>`); });
  const lintHtml = lintRows.length ? `<ul class="crit lint">${lintRows.join('')}</ul>` : '<p class="muted">No lint hits.</p>';

  // screens × langs × themes, keep manifest order
  const names = []; report.shots.forEach((s) => { if (s.name !== '(boot)' && !names.includes(s.name)) names.push(s.name); });
  if (treport) {   // journey order comes from the target; built-only shots follow
    const tn = []; treport.shots.forEach((s) => { if (s.name !== '(boot)' && !tn.includes(s.name)) tn.push(s.name); });
    const rest = names.filter((n) => !tn.includes(n)); names.length = 0; names.push(...tn, ...rest);
  }
  const langs = report.langs || ['vi', 'en'], themes = report.themes || ['sage'];
  const img = (file) => {
    const jpg = path.join(dir, file.replace(/\.png$/, '.jpg')), png = path.join(dir, file);
    if (fs.existsSync(jpg)) return 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64');
    if (fs.existsSync(png)) return 'data:image/png;base64,' + fs.readFileSync(png).toString('base64');
    return '';
  };
  const cellBuilt = (name, lang, theme) => {
    const s = report.shots.find((x) => x.name === name && x.lang === lang && x.theme === theme);
    if (!s) return `<div class="cell empty"><span>—</span></div>`;
    const src = img(s.file);
    const bad = s.setupError || (s.errors && s.errors.length);
    return `<figure class="cell${bad ? ' bad' : ''}"><img src="${src}" alt="${esc(name)} ${lang} ${theme}" loading="lazy"><figcaption>${esc(lang)}${bad ? ' · ⚠ ' + esc((s.setupError || s.errors[0].text).split('\n')[0].slice(0, 80)) : ''}</figcaption></figure>`;
  };

  const cellTarget = (name, lang, theme) => {
    const single = !treport.themes || treport.themes.length <= 1;
    const s = treport.shots.find((x) => x.name === name && x.lang === lang && (single || x.theme === theme));
    if (!s) return `<div class="cell empty"><span>—</span></div>`;
    const jpg = path.join(tdir, s.file.replace(/\.png$/, '.jpg')), png = path.join(tdir, s.file);
    const src = fs.existsSync(jpg) ? 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64') : (fs.existsSync(png) ? 'data:image/png;base64,' + fs.readFileSync(png).toString('base64') : '');
    return `<figure class="cell"><img src="${src}" alt="${esc(name)} target ${lang}" loading="lazy"><figcaption>${esc(lang)}</figcaption></figure>`;
  };
  const cell = (name, lang, theme) => treport
    ? `<div class="pair"><div class="side"><div class="pl">target</div>${cellTarget(name, lang, theme)}</div><div class="side"><div class="pl">built</div>${cellBuilt(name, lang, theme)}</div></div>`
    : cellBuilt(name, lang, theme);

  const rows = names.map((n) => themes.map((t) => `<section class="row" data-theme-row="${esc(t)}"><h3>${esc(n)}</h3><div class="cells">${langs.map((l) => cell(n, l, t)).join('')}</div></section>`).join('')).join('');
  const themeBtns = themes.map((t, i) => `<button class="tb${i === 0 ? ' on' : ''}" data-t="${esc(t)}" onclick="pick('${esc(t)}')">${esc(t)}</button>`).join('');
  const critHtml = criteria.length ? `<ul class="crit">${criteria.map((c) => `<li class="${c.done ? 'done' : ''}"><span class="box">${c.done ? '✓' : ''}</span>${esc(c.text)}</li>`).join('')}</ul>` : '<p class="muted">No acceptance criteria in the brief.</p>';
  const gaps = runGaps.concat(briefGaps);
  const gapsHtml = gaps.length ? `<ul class="gaps">${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>';

  const html = `<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--bg:#f7f5f0;--card:#ffffff;--ink:#1d2420;--mut:#6a716c;--line:#e2e5df;--acc:#2f8f6b;--bad:#b8412f;--chip:#eef1ea;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15181a;--card:#1f2325;--ink:#ecefe9;--mut:#9aa39c;--line:#2c3230;--acc:#62c497;--bad:#ff8a73;--chip:#262b2d;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#15181a;--card:#1f2325;--ink:#ecefe9;--mut:#9aa39c;--line:#2c3230;--acc:#62c497;--bad:#ff8a73;--chip:#262b2d;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font:15px/1.55 "IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding-inline:20px;padding-block:28px 56px;max-width:1180px;margin:0 auto;font-variant-numeric:tabular-nums}
h1,h2{font-family:"Fraunces","Iowan Old Style",Georgia,serif;font-weight:600;text-wrap:balance;letter-spacing:-.01em}
h1{font-size:30px;margin:0 0 6px}h2{font-size:20px;margin:36px 0 12px}
h3{font-size:12px;margin:0 0 10px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.meta{color:var(--mut);margin:0 0 8px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 6px}.bar span{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.08em}
.tb{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:6px 14px;border-radius:999px;cursor:pointer;min-height:36px;font:inherit}
.tb.on{border-color:var(--acc);color:var(--acc);font-weight:600}.tb:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.row{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--acc);border-radius:12px;padding:14px 16px;margin:12px 0}
.row[hidden]{display:none}
.cells{display:flex;gap:14px;flex-wrap:wrap}
.cell{margin:0;flex:1 1 200px;max-width:280px}.cell img{width:100%;border-radius:14px;border:1px solid var(--line);display:block;background:var(--chip)}
.cell figcaption{font-size:12px;color:var(--mut);margin-top:6px;text-transform:uppercase;letter-spacing:.08em}.cell.bad img{border-color:var(--bad)}.cell.bad figcaption{color:var(--bad);text-transform:none;letter-spacing:0}
.cell.empty{display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--mut)}
.crit,.gaps{list-style:none;padding:0;margin:0;max-width:68ch}.crit li,.gaps li{padding:8px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:flex-start}
.box{display:inline-flex;width:18px;height:18px;border:1.5px solid var(--mut);border-radius:5px;align-items:center;justify-content:center;font-size:12px;flex:none;margin-top:3px}
.crit li.done .box{border-color:var(--acc);color:var(--acc)}.gaps li{color:var(--bad)}.muted{color:var(--mut)}.bad{color:var(--bad)}
.lint .box{width:auto;min-width:18px;padding:0 5px;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:no-preference){.tb{transition:border-color .15s,color .15s}}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:0 0 4px}
</style>
<h1>${esc(title)}</h1>
<p class="meta">${report.shots.length} shots · ${esc(langs.join(' / '))} · ${new Date(report.at).toLocaleString('en-GB')}</p>
<h2>Acceptance criteria</h2>${critHtml}
<h2>Known gaps</h2>${gapsHtml}
${flowsHtml ? '<h2>Flows</h2>' + flowsHtml : ''}
<h2>DOM lint</h2>${lintHtml}
<h2>Screens</h2>
<div class="bar"><span>Theme</span>${themeBtns}</div>
${rows}
<script>
function pick(t){document.querySelectorAll('.row').forEach(function(r){r.hidden=r.getAttribute('data-theme-row')!==t});document.querySelectorAll('.tb').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-t')===t)});try{localStorage.setItem('sb-theme',t)}catch(e){}}
var _t=null;try{_t=localStorage.getItem('sb-theme')}catch(e){}pick(_t&&document.querySelector('.tb[data-t="'+_t+'"])?_t:'${esc(themes[0])}');
</script>
`;
  const out = path.resolve(o.out || path.join(dir, 'storyboard.html'));
  fs.writeFileSync(out, html);
  console.log(`storyboard: ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB, ${names.length} screens, ${criteria.length} criteria, ${gaps.length} gaps)`);
})();
