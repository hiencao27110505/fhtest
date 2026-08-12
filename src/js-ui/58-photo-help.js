/* ---------- photo-picker permission recovery ----------
   If the OS camera/photo permission was dismissed or denied, tapping an
   <input type=file accept=image/*> silently does nothing — the OS won't re-prompt,
   and a web page cannot force the prompt back. So instead of trying to re-trigger it
   (impossible), we detect the "picker never opened" case and surface a dismissible
   hint that points to device Settings, with a one-tap retry.

   Signal: opening a real picker HIDES or BLURS the page; a blocked one does not. On
   the FIRST tap the OS shows its permission dialog (which blurs) — we don't nag then.
   On the SECOND tap, already-denied, no dialog and no picker open → no blur → that's
   the stuck state we catch.

   Gated hard so a normal cancel never nags:
     • only for users who have NEVER successfully added a photo,
     • once per session, dismissible,
     • skipped on iOS — its file action sheet always reaches the Photo Library, so
       there is nothing to unblock (the hard block is an Android / installed-PWA case). */
(function(){
  var isIOS = /iP(hone|od|ad)/.test(navigator.userAgent || '')
           || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS masquerades as Mac
  var OK = 'fh-photo-ok';
  function everOk(){ try { return localStorage.getItem(OK) === '1'; } catch(e){ return false; } }
  window.fhPhotoMarkOk = function(){ try { localStorage.setItem(OK, '1'); } catch(e){} hide(); };

  var pending = false, opened = false, shown = false, lastInput = null;

  // Picker/permission dialog took over the screen → it opened, so a later empty
  // return is a normal cancel, not a block.
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') opened = true; }, true);
  window.addEventListener('blur', function(){ opened = true; }, true);

  // A photo actually came back on ANY image picker → success, remember it forever.
  document.addEventListener('change', function(e){
    var t = e.target;
    if(t && t.tagName === 'INPUT' && t.type === 'file' && String(t.accept || '').indexOf('image') >= 0 && t.files && t.files.length){
      pending = false; window.fhPhotoMarkOk();
    }
  }, true);

  if(!isIOS) document.addEventListener('click', function(e){
    var el = e.target;                                  // label taps arrive here as a synthetic click on the input
    if(!el || el.tagName !== 'INPUT' || el.type !== 'file') return;
    if(String(el.accept || '').indexOf('image') < 0) return;
    lastInput = el; opened = false; pending = true;
    setTimeout(function(){
      if(!pending) return; pending = false;
      if(opened) return;                                // picker (or perm dialog) opened → user's own cancel, don't nag
      if(everOk() || shown) return;                     // never nag someone who has added photos before
      show();
    }, 900);
  }, true);

  function _l(){ return window.L || function(a){ return a; }; }
  function show(){
    shown = true;
    var el = document.getElementById('fh-photo-hint');
    if(!el){ el = document.createElement('div'); el.id = 'fh-photo-hint'; el.className = 'fh-photo-hint'; (document.body || document.documentElement).appendChild(el); }
    var _L = _l();
    el.innerHTML = '<div class="fph-in"><span class="fph-ic">📷</span>'
      + '<span class="fph-tx">' + _L('Không mở được ảnh? Quyền Ảnh/Máy ảnh có thể đang tắt.',
                                      'Photos won’t open? Camera/Photos access may be off.') + '</span>'
      + '<button class="fph-fix" onclick="fhPhotoGuide()">' + _L('Khắc phục','Fix it') + '</button>'
      + '<button class="fph-x" aria-label="' + _L('Đóng','Close') + '" onclick="fhPhotoHintClose()">✕</button></div>';
    void el.offsetWidth; el.classList.add('on');
  }
  function hide(){ var el = document.getElementById('fh-photo-hint'); if(el) el.classList.remove('on'); }

  /* The "Fix it" guide. A one-tap link to Chrome's site-settings page is impossible —
     chrome:// URLs are blocked from web content, and a standalone PWA has no address
     bar to reach them anyway — so this shows the reachable route (Android app
     permissions) step by step, plus the browser route with a copy-address helper,
     and ends on Retry. Reinstalling is called out as a non-fix (the permission is
     remembered per origin, so a WebAPK reinstall reuses the same denied state). */
  function guide(){
    var _L = _l();
    var g = document.getElementById('fh-photo-guide');
    if(!g){ g = document.createElement('div'); g.id = 'fh-photo-guide'; g.className = 'fh-photo-guide'; (document.body || document.documentElement).appendChild(g); }
    var origin = '';
    try { origin = location.origin; } catch(e){}
    g.innerHTML =
      '<div class="fpg-scrim" onclick="fhPhotoGuideClose()"></div>'
      + '<div class="fpg-card" role="dialog" aria-modal="true">'
      +   '<div class="fpg-h">' + _L('Bật lại quyền ảnh','Re-enable photo access') + '</div>'
      +   '<p class="fpg-note">' + _L('Gỡ rồi cài lại ứng dụng sẽ KHÔNG đặt lại quyền này — quyền được nhớ theo trang web. Hãy làm theo cách dưới.',
                                      'Uninstalling and reinstalling will NOT reset this — the permission is remembered per site. Do this instead.') + '</p>'
      +   '<div class="fpg-way">' + _L('Trên điện thoại','On your phone') + '</div>'
      +   '<ol class="fpg-steps">'
      +     '<li>' + _L('Mở <b>Cài đặt</b> của điện thoại','Open your phone’s <b>Settings</b>') + '</li>'
      +     '<li>' + _L('<b>Ứng dụng</b> → <b>FamilyHub</b>','<b>Apps</b> → <b>FamilyHub</b>') + '</li>'
      +     '<li>' + _L('<b>Quyền</b> → bật <b>Máy ảnh</b> và <b>Ảnh/Bộ nhớ</b>','<b>Permissions</b> → allow <b>Camera</b> and <b>Photos/Files</b>') + '</li>'
      +     '<li>' + _L('Quay lại đây và bấm <b>Thử lại</b>','Come back here and tap <b>Retry</b>') + '</li>'
      +   '</ol>'
      +   '<div class="fpg-way">' + _L('Hoặc trong Chrome','Or in Chrome') + '</div>'
      +   '<p class="fpg-alt">' + _L('Mở trang trong trình duyệt Chrome → chạm ⋮ → <b>Cài đặt trang (Site settings)</b> → <b>Đặt lại quyền (Reset permissions)</b>.',
                                     'Open the site in the Chrome browser → tap ⋮ → <b>Site settings</b> → <b>Reset permissions</b>.') + '</p>'
      +   (origin ? '<button class="fpg-copy" onclick="fhPhotoCopyOrigin()">' + _L('Sao chép địa chỉ trang','Copy site address') + '</button>' : '')
      +   '<div class="fpg-actions">'
      +     '<button class="fpg-close" onclick="fhPhotoGuideClose()">' + _L('Đóng','Close') + '</button>'
      +     '<button class="fpg-retry" onclick="fhPhotoGuideClose();fhPhotoRetry()">' + _L('Thử lại','Retry') + '</button>'
      +   '</div>'
      + '</div>';
    void g.offsetWidth; g.classList.add('on');
  }
  window.fhPhotoGuide = guide;
  window.fhPhotoGuideClose = function(){ var g = document.getElementById('fh-photo-guide'); if(g) g.classList.remove('on'); };
  window.fhPhotoCopyOrigin = function(){
    var _L = _l(), o = '';
    try { o = location.origin; } catch(e){}
    var done = function(){ if(window.toast) window.toast(_L('Đã sao chép địa chỉ trang','Site address copied')); };
    try { if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(o).then(done, done); return; } } catch(e){}
    try { var ta = document.createElement('textarea'); ta.value = o; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); } catch(e){}
  };
  window.fhPhotoHintClose = hide;
  window.fhPhotoRetry = function(){ hide(); if(lastInput){ try { lastInput.click(); } catch(e){} } };
})();
