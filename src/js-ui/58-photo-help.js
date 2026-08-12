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

  function show(){
    shown = true;
    var el = document.getElementById('fh-photo-hint');
    if(!el){ el = document.createElement('div'); el.id = 'fh-photo-hint'; el.className = 'fh-photo-hint'; (document.body || document.documentElement).appendChild(el); }
    var _L = window.L || function(a){ return a; };
    el.innerHTML = '<div class="fph-in"><span class="fph-ic">📷</span>'
      + '<span class="fph-tx">' + _L('Không mở được ảnh? Vào Cài đặt điện thoại → Ứng dụng → FamilyHub → Quyền, bật Máy ảnh và Ảnh/Bộ nhớ, rồi bấm Thử lại.',
                                      'Photos won’t open? Open Settings → Apps → FamilyHub → Permissions, allow Camera and Photos/Files, then tap Retry.') + '</span>'
      + '<button class="fph-retry" onclick="fhPhotoRetry()">' + _L('Thử lại','Retry') + '</button>'
      + '<button class="fph-x" aria-label="' + _L('Đóng','Close') + '" onclick="fhPhotoHintClose()">✕</button></div>';
    void el.offsetWidth; el.classList.add('on');
  }
  function hide(){ var el = document.getElementById('fh-photo-hint'); if(el) el.classList.remove('on'); }
  window.fhPhotoHintClose = hide;
  window.fhPhotoRetry = function(){ hide(); if(lastInput){ try { lastInput.click(); } catch(e){} } };
})();
