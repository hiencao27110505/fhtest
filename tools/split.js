#!/usr/bin/env node
/* ONE-TIME Phase-1 split. Reads the current index.html and carves the three big
   bodies (CSS, classic-UI JS, module data JS) into concern-aligned source files,
   and writes src/index.html (the shell/markup template with build markers).

   Every file is a VERBATIM contiguous slice — no content is rewritten — so the
   build (build.js) reproduces index.html byte-for-byte. This script asserts, before
   writing, that each region's files tile it exactly and concatenate back to the
   original region; run `node build.js` then `diff` the snapshot to confirm.

   After this runs once, day-to-day editing happens in src/ + `node build.js`. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Region bodies in the ORIGINAL index.html (1-based inclusive), and their build marker.
const REGIONS = {
  css:  { start: 55,   end: 1229, dir: 'css',     marker: '/*@build:css@*/' },
  ui:   { start: 2035, end: 4670, dir: 'js-ui',   marker: '//@build:js-ui@' },
  data: { start: 4680, end: 6388, dir: 'js-data', marker: '//@build:js-data@' },
};

// Per-region ordered files that TILE [start,end]. Filled from the decomposition workflow.
// Each entry: { name, start, end } — name is numeric-prefixed so lexical sort = concat order.
const MANIFEST = {
  // CSS <style> body — grouped by UI surface; each file starts on a section banner.
  css: [
    { name: '10-tokens.css',            start: 55,   end: 80   }, // :root theme tokens (Sage default + vars)
    { name: '15-shell.css',             start: 81,   end: 116  }, // iOS PWA shell / device frame / full-bleed
    { name: '20-hero.css',              start: 117,  end: 199  }, // Home hero dashboard, welcome, stats, breakdown, Đáng nhớ preview
    { name: '25-events-home.css',       start: 200,  end: 291  }, // event cards, past/upcoming timeline, row photos, coming-up stats
    { name: '30-budget-calendar.css',   start: 292,  end: 356  }, // budget pane, 6-month trend chart, events calendar
    { name: '35-memory-calendar.css',   start: 357,  end: 411  }, // memories photo calendar, prompt, empty-state action, plan trigger
    { name: '40-spending-tabs.css',     start: 412,  end: 543  }, // spending revamp, child-tab header, cards, rows, avatars, segmented, tab bar
    { name: '45-goals-txn-detail.css',  start: 544,  end: 645  }, // goals summary/list, full txn screen, floating add, overlay, category detail
    { name: '50-sheets-modals.css',     start: 646,  end: 727  }, // scrim + sheets, full-screen modal, bulk photo-assignment
    { name: '55-event-sheet-catrows.css', start: 728, end: 811 }, // new-event sheet, founders' note, editable category rows
    { name: '60-memories.css',          start: 812,  end: 911  }, // Home strip/feed, grouped collage sections, picker strip, memory detail
    { name: '65-peek-celebrate.css',    start: 912,  end: 1003 }, // photo peek, add-memory sheet, remove button, celebration
    { name: '70-onboarding.css',        start: 1004, end: 1148 }, // onboarding: resume/warm splash, form fields, steps, choice/code, done
    { name: '80-settings-families.css', start: 1149, end: 1229 }, // settings internals, member/income rows, families picker, banners
  ],
  // classic <script> (global scope) — grouped by feature; each file starts on a section banner.
  ui: [
    { name: '10-nav-model.js',            start: 2035, end: 2141 }, // nav (go/momSec/segTo), model vars, reserved calcs, currency, trend
    { name: '12-format-helpers.js',       start: 2142, end: 2191 }, // month/weekday lookups, i18n date fns, fmt/parse/days, setTxt/setHTML
    { name: '20-budget.js',               start: 2192, end: 2481 }, // budget+run-rate, cat budget, members, month picker, budget setup → setBudget
    { name: '30-events-render.js',        start: 2482, end: 2667 }, // events: tiles, past preview, plan trigger, empty, renderEvents
    { name: '35-goals.js',                start: 2668, end: 2752 }, // saving goals (create/fund/render)
    { name: '40-memories.js',             start: 2753, end: 3056 }, // photo calendar, mem records, collage/mosaic, renderMemoriesTab, openMemory
    { name: '50-sheets-expense-capture.js', start: 3057, end: 3346 }, // sheets, event/expense modals, initSheetDrag, fast capture, edit vars, EXIF
    { name: '55-expense-photos-writes.js', start: 3347, end: 3722 }, // expense photos, bulk assign, exForm, submit/save/delete, event pickers, toast
    { name: '60-transactions.js',         start: 3723, end: 3969 }, // txns render, full txn drill-in screen, category detail, addExpense
    { name: '65-events-gallery-peek.js',  start: 3970, end: 4241 }, // events fund/create, gallery, photo peek, memory sheet, ring, addFunds/addEvent
    { name: '70-theme-i18n.js',           start: 4242, end: 4345 }, // celebration, theme, greeting, i18n (LANG/I18N/applyLang)
    { name: '80-onboard-boot.js',         start: 4346, end: 4670 }, // onboarding, warm start, boot gesture-wiring, deep links, connectivity
  ],
  // <script type="module"> Supabase data layer — file split + purposes from the design workflow.
  data: [
    { name: '10-client-auth.js',            start: 4680, end: 4938 }, // client+config, _rpc, resume gate, afterLogin, family picker, Google sign-in
    { name: '20-data-helpers.js',           start: 4939, end: 5058 }, // DB globals, date/map resolvers, spinner, _writeErr, _w, _syncSoon, avatars
    { name: '30-hydrate.js',                start: 5059, end: 5294 }, // loadFamilyData: get_family_snapshot RPC (+13-query fallback), map, render
    { name: '40-txn-writes-outbox.js',      start: 5295, end: 5541 }, // photo pipeline, R9 IndexedDB outbox, txn DB writers (before file 50 decorators)
    { name: '50-writethrough-realtime.js',  start: 5542, end: 5816 }, // write-through decorators, _dbInsertEvent/_dbSaveBudget, realtime, resume refresh
    { name: '60-settings-family-ui.js',     start: 5817, end: 6104 }, // settings infra (_fhSheet/_fhModal/_friendly), delete-event, family/member mgmt
    { name: '70-goals-income-onboard-ui.js', start: 6105, end: 6388 }, // goals/income, bootstrap IIFE, create/join family, invite, auth-state, sign-out
  ],
};

const lines = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('\n'); // lines[i] = line i+1
const slice = (a, b) => lines.slice(a - 1, b).join('\n'); // lines a..b inclusive (1-based)

function run() {
  for (const key of Object.keys(REGIONS)) {
    const r = REGIONS[key], files = MANIFEST[key];
    if (!files.length) throw new Error('MANIFEST.' + key + ' is empty — fill it from the workflow first');
    if (files[0].start !== r.start) throw new Error(key + ': first.start ' + files[0].start + ' != ' + r.start);
    for (let i = 1; i < files.length; i++)
      if (files[i].start !== files[i - 1].end + 1)
        throw new Error(key + ': gap/overlap before ' + files[i].name + ' (' + files[i].start + ' after ' + files[i - 1].end + ')');
    if (files[files.length - 1].end !== r.end) throw new Error(key + ': last.end ' + files[files.length - 1].end + ' != ' + r.end);

    const dir = path.join(SRC, r.dir);
    fs.mkdirSync(dir, { recursive: true });
    const parts = [];
    for (const f of files) {
      const content = slice(f.start, f.end);
      fs.writeFileSync(path.join(dir, f.name), content);
      parts.push(content);
    }
    if (parts.join('\n') !== slice(r.start, r.end)) throw new Error(key + ': concat != original region (byte mismatch)');
    process.stdout.write(key + ': ' + files.length + ' files, lines ' + r.start + '-' + r.end + ' ✓\n');
  }

  // Build the template: replace each region body with its single marker line (bottom-up
  // so earlier line indices stay valid).
  const regs = Object.values(REGIONS).sort((a, b) => b.start - a.start);
  const tlines = lines.slice();
  for (const r of regs) tlines.splice(r.start - 1, r.end - r.start + 1, r.marker);
  fs.mkdirSync(SRC, { recursive: true });
  fs.writeFileSync(path.join(SRC, 'index.html'), tlines.join('\n'));
  process.stdout.write('template: src/index.html written\n');
}

run();
