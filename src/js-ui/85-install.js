/* ---------- install-to-home-screen capture ----------
   Chromium fires `beforeinstallprompt` when the app is installable; we
   preventDefault + stash it so our OWN affordance (a Settings row + a one-time
   post-onboarding nudge) can trigger the native prompt on demand, instead of the
   browser's mini-infobar. iOS has no such event — install there is a manual "Add to
   Home Screen", so the affordance shows an explainer. Everything is gated on the app
   not already running standalone. Captured here in js-ui (classic script, runs before
   the deferred data module) so the event isn't missed. */
window.__fhBip = null;
function fhIsStandalone(){ return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
function fhIsIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent || ''); }
// An install affordance is worth showing when we're not already installed AND either the
// browser gave us a prompt to fire, or it's iOS Safari (where A2HS is manual).
function fhCanInstall(){ return !fhIsStandalone() && (!!window.__fhBip || fhIsIOS()); }
function _fhInstallReveal(){ if(fhCanInstall()) document.documentElement.classList.add('fh-can-install'); else document.documentElement.classList.remove('fh-can-install'); }
window.fhIsStandalone = fhIsStandalone; window.fhIsIOS = fhIsIOS; window.fhCanInstall = fhCanInstall;

window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); window.__fhBip = e; _fhInstallReveal(); });
window.addEventListener('appinstalled', function(){
  window.__fhBip = null;
  document.documentElement.classList.remove('fh-can-install');
  try{ if(window.toast) toast(L('Đã thêm Earthy vào màn hình chính 🎉','Earthy added to your home screen 🎉')); }catch(e){}
});
_fhInstallReveal();   // iOS reveals immediately (no event); Android reveals when the prompt lands above