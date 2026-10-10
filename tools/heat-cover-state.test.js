#!/usr/bin/env node
/* Covered state (device heat, approach D): a full-screen cover over the active
 * tab flips body.fh-covered, which pauses the tab's animations (15-shell.css)
 * and holds the cash-flow auto-rotate (20-budget.js cfStartAuto).
 * `node tools/heat-cover-state.test.js`
 *
 * Runs src/js-ui/10-nav-model.js in a vm over a tiny DOM stub: the pure part
 * (fhCoverIsOn / fhCoverAnyOn) directly, then the observer wiring with a fake
 * MutationObserver, so the class toggling and the 'fhcover' event are checked
 * without a browser. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/js-ui/10-nav-model.js'), 'utf8');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* ── a DOM just big enough ── */
function classList(init) {
  const s = new Set(init || []);
  return { contains: (c) => s.has(c), add: (c) => s.add(c), remove: (c) => s.delete(c),
           toggle: (c, force) => { const on = force === undefined ? !s.has(c) : !!force; on ? s.add(c) : s.delete(c); return on; } };
}
function el(id, classes) { return { id: id || '', classList: classList(classes) }; }
function makeDom(covers) {
  const observed = [];
  const events = [];
  const body = { classList: classList(), querySelectorAll: () => covers };
  const phone = { querySelectorAll: () => covers };
  const document = {
    body: body,
    getElementById: (id) => (id === 'phone' ? phone : null),
    addEventListener: () => {},
    dispatchEvent: (e) => { events.push(e.detail.on); return true; },
  };
  let cb = null;
  function MutationObserver(fn) { cb = fn; }
  MutationObserver.prototype.observe = function (target, opts) { observed.push({ target, opts }); };
  const ctx = {
    window: {}, document, MutationObserver, console,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  ctx.window = ctx;   // js-ui code writes window.x and reads bare x: same object, as in a browser
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, body, phone, observed, events, fire: (muts) => cb(muts || [{ type: 'attributes' }]) };
}

/* ── pure helper ── */
{
  const d = makeDom([]);
  const F = d.ctx;
  t('an .overlay/.modal/.peek/.celebrate covers only with the on class', () => {
    assert.strictEqual(F.fhCoverIsOn(el('txn-overlay', ['overlay'])), false);
    assert.strictEqual(F.fhCoverIsOn(el('txn-overlay', ['overlay', 'on'])), true);
    assert.strictEqual(F.fhCoverIsOn(el('review-modal', ['modal', 'fh-screen'])), false);
    assert.strictEqual(F.fhCoverIsOn(el('review-modal', ['modal', 'fh-screen', 'on'])), true);
    assert.strictEqual(F.fhCoverIsOn(el('peek', ['peek'])), false);
    assert.strictEqual(F.fhCoverIsOn(el('celebrate', ['celebrate', 'on'])), true);
  });
  t('the lock wall covers by being mounted (it has no open class)', () => {
    assert.strictEqual(F.fhCoverIsOn(el('fh-lockwall', [])), true);
  });
  t('null and class-less things never cover', () => {
    assert.strictEqual(F.fhCoverIsOn(null), false);
    assert.strictEqual(F.fhCoverIsOn({ id: 'x' }), false);
  });
  t('fhCoverAnyOn: any one open cover is enough; none open is false; empty is false', () => {
    const closed = [el('a', ['overlay']), el('b', ['modal']), el('c', ['peek'])];
    assert.strictEqual(F.fhCoverAnyOn(closed), false);
    assert.strictEqual(F.fhCoverAnyOn(closed.concat([el('d', ['overlay', 'on'])])), true);
    assert.strictEqual(F.fhCoverAnyOn([]), false);
    assert.strictEqual(F.fhCoverAnyOn(null), false);
  });
  t('fhCovered and fhCoverAnyOn are exposed on window for other layers', () => {
    assert.strictEqual(typeof F.window.fhCovered, 'function');
    assert.strictEqual(typeof F.window.fhCoverAnyOn, 'function');
  });
}

/* ── observer wiring ── */
{
  const covers = [el('txn-overlay', ['overlay']), el('review-modal', ['modal', 'fh-screen']), el('peek', ['peek'])];
  const d = makeDom(covers);
  const F = d.ctx;
  t('boot: every cover is observed for class changes and #phone for its child list', () => {
    const classWatched = d.observed.filter((o) => o.opts.attributes && o.opts.attributeFilter[0] === 'class').map((o) => o.target);
    covers.forEach((c) => assert.ok(classWatched.indexOf(c) >= 0, c.id + ' watched'));
    assert.ok(d.observed.some((o) => o.target === d.phone && o.opts.childList), 'phone child list watched');
  });
  t('boot with everything closed: not covered, body class off', () => {
    assert.strictEqual(F.fhCovered(), false);
    assert.strictEqual(d.body.classList.contains('fh-covered'), false);
  });
  t('an overlay opens: covered, body.fh-covered on, fhcover event says on', () => {
    covers[0].classList.add('on'); d.fire();
    assert.strictEqual(F.fhCovered(), true);
    assert.strictEqual(d.body.classList.contains('fh-covered'), true);
    assert.strictEqual(d.events[d.events.length - 1], true);
  });
  t('a screen opens over the open overlay: still covered, and the event still fires (tiles under it may now be seen)', () => {
    const before = d.events.length;
    covers[1].classList.add('on'); d.fire();
    assert.strictEqual(F.fhCovered(), true);
    assert.strictEqual(d.events.length, before + 1);
  });
  t('the overlay closes under the open screen: still covered', () => {
    covers[0].classList.remove('on'); d.fire();
    assert.strictEqual(F.fhCovered(), true);
    assert.strictEqual(d.body.classList.contains('fh-covered'), true);
  });
  t('the last cover closes: uncovered, body class off, event says off', () => {
    covers[1].classList.remove('on'); d.fire();
    assert.strictEqual(F.fhCovered(), false);
    assert.strictEqual(d.body.classList.contains('fh-covered'), false);
    assert.strictEqual(d.events[d.events.length - 1], false);
  });
  t('the lock wall mounting (a childList mutation) re-scans and covers; leaving uncovers', () => {
    const wall = el('fh-lockwall', []);
    covers.push(wall); d.fire([{ type: 'childList' }]);
    assert.strictEqual(F.fhCovered(), true);
    assert.ok(d.observed.some((o) => o.target === wall), 'the new wall is watched too');
    covers.pop(); d.fire([{ type: 'childList' }]);
    assert.strictEqual(F.fhCovered(), false);
  });
}

/* ── source-shape guards: the consumers actually read the state ── */
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'src/css/15-shell.css'), 'utf8');
  const tabs = fs.readFileSync(path.join(__dirname, '..', 'src/css/40-spending-tabs.css'), 'utf8');
  const budget = fs.readFileSync(path.join(__dirname, '..', 'src/js-ui/20-budget.js'), 'utf8');
  t('15-shell.css pauses animations under .view.on while covered', () => {
    assert.ok(/body\.fh-covered \.view\.on,body\.fh-covered \.view\.on \*\{animation-play-state:paused!important\}/.test(css));
  });
  t('40-spending-tabs.css drops the tab bar blur while covered', () => {
    assert.ok(/body\.fh-covered \.tabbar\{backdrop-filter:none/.test(tabs));
  });
  t('cfStartAuto holds its tick while covered', () => {
    assert.ok(/if\(window\.fhCovered && fhCovered\(\)\) return;/.test(budget));
  });
}

console.log('\nALL ' + n + ' checks passed');
