  // ═══ bank-email: sealed-staging keys (0051) ═══════════════════════════════
  /* Client side of sealed staging. The pipeline's robot writes staged rows it
     can never read back: each row is sealed to the family's staging PUBLIC key
     (ephemeral-static X25519 + XSalsa20-Poly1305, TweetNaCl on both ends —
     constraint 4; the private key is DEK-wrapped, so WebCrypto/15-crypto.js
     still owns everything the DEK touches). Seal side + design rationale:
     pipeline/sealed-box.gs, pipeline/SEALED-STAGING-DESIGN.md.

     Folded in from pipeline/client-reference-staging-keys.js (vector-tested,
     13 assertions — the crypto below is byte-for-byte that reference; the only
     changes are the app's own _rpc, a cache keyed by family, and the unlock
     orchestration + mismatch alarm at the bottom). */

  var STAGING_ENC_V = 1;

  (function () {
    // b64 helpers match what the .gs seal side emits.
    function _sb64ToBytes(b64) {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function _sbytesToB64(bytes) {
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    }

    /* Open one sealed staging row. Throws on a version we don't know, on failed
       authentication (tamper or wrong key), and on an identity mismatch —
       constraint 1: the sealer binds family_id + gmail_message_id INSIDE the
       box, so ciphertext moved between rows is caught here, not imported onto
       the wrong transaction. */
    function fhStagingOpenRow(row, familyPriv) {
      if (row.enc_v !== STAGING_ENC_V) {
        throw new Error('staging_enc_version_unsupported:' + row.enc_v);
      }
      var opened = nacl.box.open(
        _sb64ToBytes(row.sealed),
        _sb64ToBytes(row.nonce),
        _sb64ToBytes(row.eph_pub),
        familyPriv
      );
      // null means Poly1305 rejected it: tampered bytes or not our box. Both are
      // integrity failures — surface them rather than skipping the row silently.
      if (!opened) throw new Error('staging_open_failed');

      var payload = JSON.parse(new TextDecoder().decode(opened));
      if (payload.family_id !== row.family_id ||
          payload.gmail_message_id !== row.gmail_message_id) {
        throw new Error('staging_identity_mismatch');
      }
      return payload;
    }

    /* The staging keypair for the ACTIVE family, cached per family so unlock
       costs one round trip, not one per row. Keyed by fid — a multi-family user
       switching families must never open one family's rows with another's key. */
    var _stagingCacheFid = null, _stagingCacheData = null;
    async function fhStagingKeys() {
      var fid = window.DB && window.DB.fid;
      if (!fid) throw new Error('no_active_family');
      if (_stagingCacheFid === fid && _stagingCacheData) return _stagingCacheData;
      var data = await _rpc('get_family_staging_key', {});      // migration 0051
      _stagingCacheFid = fid; _stagingCacheData = data;
      return data;
    }
    function fhStagingKeysForget() { _stagingCacheFid = null; _stagingCacheData = null; }

    /* The family's staging private key, unwrapped with the DEK. Requires an
       unlocked safe — fhKeyReady() must be true. */
    async function fhStagingPrivKey() {
      if (!window.fhKeyReady || !window.fhKeyReady()) throw new Error('locked');
      var keys = await fhStagingKeys();
      if (!keys || !keys.staging_priv_enc) throw new Error('staging_keypair_missing');
      var b64 = await window.fhDecStr(keys.staging_priv_enc);   // DEK unwrap
      if (!b64) throw new Error('staging_priv_unwrap_failed');
      return _sb64ToBytes(b64);
    }

    /* Ensure the family has a staging keypair; create one if not.
       MUST run with the DEK present (the only moment the private key can be
       wrapped). First-writer-wins is server-side (0051): the RPC only writes
       while staging_pub is null, then returns whatever is authoritative — ours
       if we won the race, the other device's if we lost. Adopt either way and
       NEVER retry with a fresh keypair: a second keypair orphans every box
       sealed to the first. Rotation is a separate, deliberate ceremony. */
    async function fhStagingEnsureKeypair() {
      if (!window.fhKeyReady || !window.fhKeyReady()) return false;  // try again after unlock
      var keys = await fhStagingKeys();
      if (keys && keys.staging_pub) return false;                    // already provisioned

      var kp = nacl.box.keyPair();                                   // browser CSPRNG
      var wrapped = await window.fhEncStr(_sbytesToB64(kp.secretKey));
      if (!wrapped) throw new Error('staging_priv_wrap_failed');

      var winning = await _rpc('set_family_staging_key', {
        p_pub: _sbytesToB64(kp.publicKey),
        p_priv_enc: wrapped,
      });

      _stagingCacheFid = window.DB && window.DB.fid; _stagingCacheData = winning;
      for (var i = 0; i < kp.secretKey.length; i++) kp.secretKey[i] = 0;
      return true;
    }

    /* Defense 2 — the real detector for key substitution (design doc §6).
       Re-derive the public key from our own private key and compare with the
       server's copy. An operator who swapped the stored key cannot make this
       pass: they cannot produce a value derived from a secret they never held.
       Cheap (one scalar multiplication), run on every unlock, zero false
       positives — a legitimate future rotation MUST announce itself through the
       DEK-authenticated path or it will trip this on every device at once. */
    async function fhStagingVerifyServerKey() {
      var keys = await fhStagingKeys();
      if (!keys || !keys.staging_pub) return true;        // nothing provisioned yet
      var priv = await fhStagingPrivKey();
      var derived = _sbytesToB64(nacl.box.keyPair.fromSecretKey(priv).publicKey);
      for (var i = 0; i < priv.length; i++) priv[i] = 0;
      return derived === keys.staging_pub;
    }

    /* ── mismatch alarm ──────────────────────────────────────────────────────
       Blocking, family-wide by construction: every device runs the same verify
       at its own unlock, so no push fan-out is needed for the state to spread.
       Freezes APPROVAL of staged rows only — the ledger is a different lock
       system entirely and stays fully usable; saying so plainly is the point
       of the copy. Persisted per family so a reload doesn't un-ring the bell;
       cleared only by a verify that passes again. */
    function _stagingAlarmKey(fid) { return 'fh-staging-alarm-' + fid; }
    function fhStagingAlarmActive() {
      var fid = window.DB && window.DB.fid;
      if (!fid) return false;
      try { return localStorage.getItem(_stagingAlarmKey(fid)) === '1'; } catch (e) { return false; }
    }
    function _stagingAlarmSet(on) {
      var fid = window.DB && window.DB.fid;
      if (!fid) return;
      try {
        if (on) localStorage.setItem(_stagingAlarmKey(fid), '1');
        else localStorage.removeItem(_stagingAlarmKey(fid));
      } catch (e) {}
    }
    function fhStagingAlarmShow() {
      if (document.getElementById('fh-staging-alarm')) return;
      var d = document.createElement('div');
      d.id = 'fh-staging-alarm';
      d.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(15,23,20,.55);' +
        'display:flex;align-items:center;justify-content:center;padding:24px;';
      d.innerHTML =
        '<div style="background:var(--card,#fff);border-radius:16px;max-width:340px;padding:22px 20px;text-align:left;box-shadow:0 12px 40px rgba(0,0,0,.25);">' +
          '<div style="font-size:17px;font-weight:800;margin-bottom:10px;">' +
            esc(L('Khoá niêm phong không khớp', 'Sealing key mismatch')) + '</div>' +
          '<div style="font-size:14px;line-height:1.55;color:var(--ink-2,#3d4a44);margin-bottom:8px;">' +
            esc(L('Khoá dùng để niêm phong giao dịch từ email ngân hàng không khớp với khoá do thiết bị này tạo ra. Để an toàn, việc duyệt các giao dịch chờ đã được tạm dừng cho cả nhà.',
                  'The key used to seal transactions from bank email does not match the one this device created. To be safe, reviewing pending transactions has been paused for the whole family.')) + '</div>' +
          '<div style="font-size:14px;line-height:1.55;color:var(--ink-2,#3d4a44);margin-bottom:16px;">' +
            esc(L('Sổ chi tiêu của gia đình KHÔNG bị ảnh hưởng — dữ liệu hiện có vẫn nguyên vẹn và dùng khoá khác hoàn toàn.',
                  'Your family ledger is NOT affected — existing data is intact and protected by an entirely separate key.')) + '</div>' +
          '<button class="btn-primary" style="width:100%;" onclick="document.getElementById(\'fh-staging-alarm\').remove()">' +
            esc(L('Đã hiểu', 'Got it')) + '</button>' +
        '</div>';
      document.body.appendChild(d);
    }

    /* ── unlock orchestration ────────────────────────────────────────────────
       Called (fire-and-forget) from every path that ends with a usable DEK:
       fhKeyAdopt (fresh unlock / join / set-code) and hydrate's fhKeyLoad
       (cached key on boot). Ensure-then-verify, once per family per session —
       ensure is idempotent and verify is cheap, but there is no reason to
       re-run either on every focus-refresh hydrate. A failed verify latches
       the alarm; a passing one clears it (covers a legitimate future rotation
       arriving through the DEK-authenticated path). */
    var _stagingCheckedFids = {};
    async function fhStagingAfterUnlock() {
      if (!window.fhKeyReady || !window.fhKeyReady()) return;
      if (!window.nacl) return;                     // vendor script missing/blocked: never break unlock
      var fid = window.DB && window.DB.fid;
      if (!fid || _stagingCheckedFids[fid]) return;
      _stagingCheckedFids[fid] = true;
      try {
        await fhStagingEnsureKeypair();
        var ok = await fhStagingVerifyServerKey();
        _stagingAlarmSet(!ok);
        if (!ok) fhStagingAlarmShow();
      } catch (e) {
        // Offline or a transient RPC failure is not evidence of tampering — do
        // not alarm, do not latch; let the next unlock try again.
        delete _stagingCheckedFids[fid];
        window.fhLogErr && window.fhLogErr('staging_after_unlock', e);
      }
    }

    window.fhStagingOpenRow = fhStagingOpenRow;
    window.fhStagingKeysForget = fhStagingKeysForget;
    window.fhStagingPrivKey = fhStagingPrivKey;
    window.fhStagingEnsureKeypair = fhStagingEnsureKeypair;
    window.fhStagingVerifyServerKey = fhStagingVerifyServerKey;
    window.fhStagingAfterUnlock = fhStagingAfterUnlock;
    window.fhStagingAlarmActive = fhStagingAlarmActive;
    window.fhStagingAlarmShow = fhStagingAlarmShow;
  })();