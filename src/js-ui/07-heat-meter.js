/* ---------- heat meter (window.fhHeat) ----------
   The phone got hot and nobody could say from WHAT: the review queue idling, a
   personal hydrate repainting a hidden sheet, a KDF spin, a standing animation.
   This counts the things that burn — WebCrypto calls, NaCl unseals, network
   requests by class, named renders, long tasks, DOM growth, running
   animations — so the acceptance bars in tools/boot-harness/README.md are a
   console call, not a devtools afternoon. Same spirit as fhReadLoopStats (74),
   widened to the whole app. Not telemetry: nothing leaves the device.

   ALWAYS ON, NEAR-ZERO COST. Every hot wrapper is one integer increment and a
   pass-through `apply`; URL classing is a few indexOf calls on a string that
   already exists. No allocation on the hot path. Anything that costs (DOM
   mutation counting, animation sampling, element counts) is either opt-in
   (deep) or on-demand (snapshot).

   RUNS FIRST (07- in js-ui, the classic block) so the wrappers are in place
   before the js-data module does any crypto. tweetnacl.js is a deferred vendor
   script, so NaCl is armed at DOMContentLoaded (or on the first snapshot).

   Every setup step is its own try/catch: this file must never be the reason
   the app does not boot, and a browser missing any one API loses that one
   counter and nothing else.

   API (all safe to call at any time):
     fhHeat.tick(name)        count one named event ('renderPersonal', 'renderCsvReview', …)
     fhHeat.snapshot()        plain object of every counter + ticks + sampled animations
     fhHeat.reset()           zero everything, restart the clock
     fhHeat.rates()           per-minute rates since reset (sync)
     fhHeat.window(ms)        Promise: per-minute rates measured over the NEXT ms;
                              with no argument, same as rates()
     fhHeat.report()          console.table of totals + per-minute + ticks
     fhHeat.deep(on)          start/stop counting DOM nodes added (MutationObserver; off by default)
     fhHeat.diff(a, b)        b minus a, for two snapshots
   Call sites use `window.fhHeat && fhHeat.tick('x')`; tick is always a function. */
(function () {
  var W = (typeof window !== 'undefined') ? window : this;
  try {
  var now = function () { try { return performance.now(); } catch (e) { return Date.now(); } };

  // Counters: flat integers. Hot wrappers touch only these.
  var C = {
    decrypts: 0, encrypts: 0, digests: 0, deriveBits: 0, importKeys: 0,
    unseals: 0,                                   // nacl.box.open + nacl.secretbox.open
    fetches: 0, fetchRest: 0, fetchRpc: 0, fetchStorage: 0, fetchAuth: 0,
    fetchRealtime: 0, fetchFn: 0, fetchOther: 0,
    fetchesHidden: 0,                             // issued while document.hidden (the spec says: zero)
    longTasks: 0, longTaskMs: 0,
    nodesAdded: 0
  };
  var T = {};                                     // tick name -> count
  var since = now();
  var deepOn = false, mo = null, naclArmed = false;
  var armed = { subtle: false, fetch: false, longtask: false, nacl: false };

  function tick(name) { T[name] = (T[name] | 0) + 1; }

  // ── WebCrypto ───────────────────────────────────────────────────────────
  // Own-property assignment on the SubtleCrypto INSTANCE shadows the prototype
  // method; `this` is forwarded (bare calls would be an Illegal invocation in
  // the original too, so nothing changes for callers).
  function wrapSubtle(subtle, method, counter) {
    try {
      var o = subtle[method];
      if (typeof o !== 'function') return false;
      subtle[method] = function () { C[counter]++; return o.apply(this, arguments); };
      return true;
    } catch (e) { return false; }
  }
  try {
    var subtle = W.crypto && W.crypto.subtle;
    if (subtle) {
      armed.subtle = wrapSubtle(subtle, 'decrypt', 'decrypts');
      wrapSubtle(subtle, 'encrypt', 'encrypts');
      wrapSubtle(subtle, 'digest', 'digests');
      wrapSubtle(subtle, 'deriveBits', 'deriveBits');
      wrapSubtle(subtle, 'importKey', 'importKeys');
    }
  } catch (e) {}

  // ── fetch, by URL class ─────────────────────────────────────────────────
  try {
    var ofetch = W.fetch;
    if (typeof ofetch === 'function') {
      W.fetch = function (input) {
        C.fetches++;
        try {
          var u = (typeof input === 'string') ? input : (input && input.url) || '';
          if (u.indexOf('/rest/v1/rpc/') >= 0) C.fetchRpc++;
          else if (u.indexOf('/rest/v1/') >= 0) C.fetchRest++;
          else if (u.indexOf('/storage/v1/') >= 0) C.fetchStorage++;
          else if (u.indexOf('/auth/v1/') >= 0) C.fetchAuth++;
          else if (u.indexOf('/realtime/v1/') >= 0) C.fetchRealtime++;
          else if (u.indexOf('/functions/v1/') >= 0) C.fetchFn++;
          else C.fetchOther++;
          if (typeof document !== 'undefined' && document.hidden) C.fetchesHidden++;
        } catch (e) {}
        return ofetch.apply(this === undefined ? W : this, arguments);
      };
      armed.fetch = true;
    }
  } catch (e) {}

  // ── long tasks ──────────────────────────────────────────────────────────
  try {
    if (typeof PerformanceObserver === 'function') {
      var types = PerformanceObserver.supportedEntryTypes;
      if (!types || types.indexOf('longtask') >= 0) {
        var po = new PerformanceObserver(function (list) {
          var es = list.getEntries();
          for (var i = 0; i < es.length; i++) { C.longTasks++; C.longTaskMs += es[i].duration; }
        });
        po.observe({ type: 'longtask', buffered: true });
        armed.longtask = true;
      }
    }
  } catch (e) {}

  // ── NaCl (deferred vendor; armed late) ──────────────────────────────────
  function armNacl() {
    if (naclArmed) return;
    try {
      var n = W.nacl;
      if (!n) return;
      if (n.box && typeof n.box.open === 'function') {
        var ob = n.box.open;
        var wb = function () { C.unseals++; return ob.apply(this, arguments); };
        for (var k in ob) wb[k] = ob[k];          // nacl.box.open.after rides along
        n.box.open = wb;
      }
      if (n.secretbox && typeof n.secretbox.open === 'function') {
        var os = n.secretbox.open;
        n.secretbox.open = function () { C.unseals++; return os.apply(this, arguments); };
      }
      naclArmed = true; armed.nacl = true;
    } catch (e) {}
  }
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armNacl);
      else armNacl();
    }
  } catch (e) {}

  // ── DOM growth, opt-in ──────────────────────────────────────────────────
  function deep(on) {
    try {
      if (on && !deepOn) {
        if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return false;
        mo = new MutationObserver(function (recs) {
          for (var i = 0; i < recs.length; i++) C.nodesAdded += recs[i].addedNodes.length;
        });
        mo.observe(document.documentElement || document, { childList: true, subtree: true });
        deepOn = true;
      } else if (!on && deepOn) {
        mo.disconnect(); mo = null; deepOn = false;
      }
    } catch (e) { return false; }
    return deepOn;
  }

  // ── read-outs ───────────────────────────────────────────────────────────
  function animations() {
    try {
      if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return -1;
      var all = document.getAnimations(), n = 0;
      for (var i = 0; i < all.length; i++) if (all[i].playState === 'running') n++;
      return n;
    } catch (e) { return -1; }
  }
  function snapshot() {
    armNacl();
    var s = { sinceMs: Math.round(now() - since) };
    for (var k in C) s[k] = C[k];
    s.longTaskMs = Math.round(s.longTaskMs);
    s.nodesAdded = deepOn ? C.nodesAdded : null;
    s.animations = animations();
    try { s.domNodes = (typeof document !== 'undefined') ? document.getElementsByTagName('*').length : -1; } catch (e) { s.domNodes = -1; }
    s.ticks = {};
    for (var t in T) s.ticks[t] = T[t];
    s.armed = { subtle: armed.subtle, fetch: armed.fetch, longtask: armed.longtask, nacl: armed.nacl, deep: deepOn };
    return s;
  }
  function reset() {
    for (var k in C) C[k] = 0;
    T = {};
    since = now();
  }
  function diff(a, b) {
    var d = {};
    for (var k in b) {
      if (k === 'ticks') { d.ticks = {}; for (var t in b.ticks) d.ticks[t] = b.ticks[t] - ((a.ticks && a.ticks[t]) | 0); }
      else if (k === 'armed') d.armed = b.armed;
      else if (typeof b[k] === 'number' && typeof a[k] === 'number' && k !== 'animations' && k !== 'domNodes') d[k] = b[k] - a[k];
      else d[k] = b[k];
    }
    return d;
  }
  function perMinute(d) {
    var mins = Math.max(d.sinceMs, 1) / 60000, r = { windowMs: d.sinceMs };
    for (var k in d) if (typeof d[k] === 'number' && k !== 'sinceMs' && k !== 'animations' && k !== 'domNodes') r[k] = Math.round(d[k] / mins * 10) / 10;
    r.ticks = {};
    for (var t in d.ticks) r.ticks[t] = Math.round(d.ticks[t] / mins * 10) / 10;
    return r;
  }
  function rates() { return perMinute(snapshot()); }
  function windowRates(ms) {
    if (!(ms > 0)) return rates();
    var a = snapshot();
    return new Promise(function (res) {
      setTimeout(function () { var d = diff(a, snapshot()); res(perMinute(d)); }, ms);
    });
  }
  function report() {
    var s = snapshot(), r = perMinute(s), rows = [];
    for (var k in s) if (typeof s[k] === 'number' && k !== 'sinceMs') rows.push({ metric: k, total: s[k], perMin: r[k] == null ? '' : r[k] });
    for (var t in s.ticks) rows.push({ metric: 'tick:' + t, total: s.ticks[t], perMin: r.ticks[t] });
    try { console.log('fhHeat · ' + (s.sinceMs / 1000).toFixed(1) + 's since reset · armed ' + JSON.stringify(s.armed)); console.table(rows); }
    catch (e) { try { console.log(JSON.stringify(rows)); } catch (e2) {} }
    return rows;
  }

  W.fhHeat = { tick: tick, snapshot: snapshot, reset: reset, rates: rates, window: windowRates, report: report, deep: deep, diff: diff, armNacl: armNacl };
  } catch (e) {
    // Last resort: the call sites' `window.fhHeat && fhHeat.tick('x')` must stay a no-op, never a throw.
    if (!W.fhHeat) {
      var noop = function () {}, empty = function () { return { ticks: {}, armed: {}, setupError: String(e) }; };
      W.fhHeat = { tick: noop, snapshot: empty, reset: noop, rates: empty, window: function () { return empty(); }, report: empty, deep: function () { return false; }, diff: function (a, b) { return b; }, armNacl: noop };
    }
  }
})();