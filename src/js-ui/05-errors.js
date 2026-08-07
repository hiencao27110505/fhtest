/* ---------- global error visibility ----------
   The app is ~11k lines of inline JS across two scopes; an unexpected throw or
   promise rejection would otherwise vanish into a console the family never opens.
   Keep a small ring buffer (last 20, stamped with the running build) for debugging,
   and surface a toast ONLY when the error lands right after a user gesture — so
   boot-time noise stays quiet, but a tap that visibly failed gets acknowledged.
   Defined FIRST (05-) so it is armed before any later module can throw. */
window.__fhErrs = window.__fhErrs || [];
var __fhLastGesture = 0;
['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
  try { window.addEventListener(evt, function () { __fhLastGesture = Date.now(); }, { passive: true, capture: true }); } catch (e) {}
});
function fhLogErr(err) {
  try {
    var rec = {
      t: Date.now(),
      v: (typeof FH_VERSION !== 'undefined' && FH_VERSION) ? FH_VERSION : (window.FH_VERSION || '?'),
      msg: (err && (err.message || err.reason)) ? String(err.message || err.reason) : String(err || 'unknown'),
      stack: (err && err.stack) ? String(err.stack).slice(0, 800) : null
    };
    window.__fhErrs.push(rec);
    if (window.__fhErrs.length > 20) window.__fhErrs.shift();
    if (typeof console !== 'undefined') console.error('fhLogErr', rec.msg, err);
    // Only bother the user if this immediately followed something they did.
    if (Date.now() - __fhLastGesture < 3000 && typeof toast === 'function') {
      toast((typeof L === 'function') ? L('Có lỗi xảy ra, thử lại', 'Something went wrong, try again') : 'Something went wrong, try again');
    }
  } catch (e) {}
}
window.fhLogErr = fhLogErr;
window.addEventListener('error', function (e) { fhLogErr(e.error || e.message); });
window.addEventListener('unhandledrejection', function (e) { fhLogErr(e.reason); });