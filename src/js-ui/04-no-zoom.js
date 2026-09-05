/* ---------- zoom lock ----------
   Accidental pinch/double-tap zooms while tapping fast kept breaking the layout.
   The viewport meta (maximum-scale=1, user-scalable=no) covers standalone PWA mode,
   but iOS Safari in a browser tab ignores user-scalable=no — so also swallow the
   proprietary iOS gesture events there. touch-action:manipulation (15-shell.css)
   handles double-tap. */
['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
  try { document.addEventListener(evt, function (e) { e.preventDefault(); }, { passive: false }); } catch (e) {}
});
