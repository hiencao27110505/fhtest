  // ═══ Install to Home Screen ═══════════════════════════════════════════════
  /* Reuses the app's dynamic sheet (_fhSheet/_btn/_S from 60-settings). On Android/
     desktop we fire the stashed beforeinstallprompt directly; on iOS (or when no
     prompt was captured) we show an explainer. Entry points: a Settings row and a
     one-time gentle nudge after onboarding. Install matters especially on iOS, where
     Web Push only reaches an installed PWA. */
  window.fhInstall = async function () {
    const bip = window.__fhBip;
    if (bip) {
      try {
        bip.prompt();
        const r = await bip.userChoice;
        window.__fhBip = null;
        document.documentElement.classList.remove('fh-can-install');
        return;                                            // accepted or dismissed — nothing more to show
      } catch (e) { /* fall through to the explainer */ }
    }
    window.fhInstallSheet();                               // iOS, or no captured prompt
  };

  window.fhInstallSheet = function () {
    const h = '<div class="fh-s-h">' + L('Thêm vào màn hình chính', 'Add to Home Screen') + '</div>';
    let sub, act;
    if (window.fhIsStandalone && window.fhIsStandalone()) {
      sub = L('Earthy đã ở trên máy này rồi. 🎉', 'Earthy is already on this device. 🎉');
      act = _btn(L('Xong', 'Done'), '_closeOv()', _S.cta);
    } else if (window.__fhBip) {
      sub = L('Cài Earthy như một app riêng: mở nhanh từ màn hình chính, chạy toàn màn hình và nhận thông báo.',
              'Install Earthy as its own app: open it fast from your home screen, run full-screen, and get notifications.');
      act = _btn(L('Cài đặt', 'Install'), '_closeOv();fhInstall()', _S.cta) + _btn(L('Để sau', 'Not now'), '_closeOv()', _S.ghost);
    } else if (window.fhIsIOS && window.fhIsIOS()) {
      sub = L('Mở nhanh như một app riêng và nhận thông báo: bấm nút Chia sẻ ở thanh dưới Safari, rồi chọn “Thêm vào MH chính”.',
              'Open it like its own app and get notifications: tap the Share button in Safari’s bottom bar, then choose “Add to Home Screen”.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    } else {
      sub = L('Để cài, mở menu trình duyệt rồi chọn “Cài đặt” hoặc “Thêm vào màn hình chính”.',
              'To install, open your browser menu and choose “Install” or “Add to Home Screen”.');
      act = _btn(L('Đã hiểu', 'Got it'), '_closeOv()', _S.cta);
    }
    _fhSheet(h + '<div class="fh-s-sub">' + sub + '</div>' + act);
  };

  // One-time gentle nudge after onboarding finishes (an earned moment, not a boot popup).
  // Only when installable and not already shown; the sheet itself is fully dismissible.
  window.fhInstallNudge = function () {
    try {
      if (!(window.fhCanInstall && window.fhCanInstall())) return;
      if (localStorage.getItem('fh-install-nudged') === '1') return;
      localStorage.setItem('fh-install-nudged', '1');
      setTimeout(function () { try { window.fhInstallSheet(); } catch (e) {} }, 1200);
    } catch (e) {}
  };