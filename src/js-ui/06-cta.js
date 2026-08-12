/* ---------- fhCTA: instant, Apple-grade feedback for async buttons ----------
   Any button that starts an await — create family, unlock, switch family, a modal
   save — MUST change state on the same frame as the tap, before the first await,
   or a low-end phone feels dead and the user taps again. Repeat taps on the
   onboarding CTA is exactly what minted duplicate families. fhCTA(el, fn, opts):
     • synchronously fires a 10ms haptic, disables the button, marks it busy
       (.fh-busy → dim + pointer-blocked) and, if opts.busyText is given, swaps the
       label ("Đang lưu…") — all instant acknowledgement;
     • runs fn(); restores the button when the promise settles, UNLESS its text was
       already changed by the handler (a success that closed a modal leaves it torn
       down, which is fine — the node is gone);
     • is re-entrant-safe: a second tap while in flight is ignored and resolves to
       undefined, so no double-submit can slip through even if a caller forgets its
       own guard.
   Returns a promise of fn's result. Defined at 06- so every later handler can wrap
   its async work in it. */
function fhCTA(el, fn, opts) {
  el = (typeof el === 'string') ? document.getElementById(el) : el;
  opts = opts || {};
  if (!el) { return Promise.resolve(fn ? fn() : undefined); }
  if (el.dataset.fhBusy === '1') return Promise.resolve(undefined);   // in flight → drop the repeat tap
  el.dataset.fhBusy = '1';
  var wasDisabled = !!el.disabled;
  var prevText = el.textContent;
  el.classList.add('fh-busy');
  el.setAttribute('aria-busy', 'true');
  if (opts.busyText != null) el.textContent = opts.busyText;
  try { el.disabled = true; } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}   // a tiny tactile "got it"
  var restore = function () {
    if (!el) return;
    delete el.dataset.fhBusy;
    el.classList.remove('fh-busy');
    el.removeAttribute('aria-busy');
    // only restore the label we set — never stomp text the handler itself changed
    if (opts.busyText != null && el.textContent === opts.busyText) el.textContent = prevText;
    if (!wasDisabled) { try { el.disabled = false; } catch (e) {} }
  };
  var out;
  try { out = fn ? fn() : undefined; }
  catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.then(function (r) { restore(); return r; }, function (e) { restore(); throw e; });
  restore();
  return Promise.resolve(out);
}
window.fhCTA = fhCTA;
