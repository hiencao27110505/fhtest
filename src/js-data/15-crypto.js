  /* ═══ E2EE crypto core (0030) ═══════════════════════════════════════════════
     The 6-digit family passcode never leaves the device. It is stretched with
     PBKDF2-SHA256, then HKDF-split into two independent keys:
       • K_auth — hex, sent to the server on join/verify; stored there only as a
         bcrypt hash. Proves "I know the code" without revealing it.
       • K_wrap — an AES-GCM key that stays on-device and unwraps the family DEK.
     HKDF domain separation means the server, having seen K_auth, still can't
     derive K_wrap — verifying the door never opens the safe.
     The DEK (random 256-bit) encrypts every money value / note / goal name as
     b64(iv‖AES-GCM ct). It is cached per family in IndexedDB so the passcode is
     asked for once per device, not per session; iOS storage eviction just means
     the passcode is asked again. */
  const FH_KDF_VERSION = 1;
  const FH_KDF_ITERS = 310000;                 // OWASP-level PBKDF2-SHA256 work factor
  const _te = new TextEncoder(), _td = new TextDecoder();
  const _hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const _unhex = (s) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));
  const _b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  function _unb64(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function _cat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }

  const FHCrypto = {
    genSaltHex() { return _hex(crypto.getRandomValues(new Uint8Array(16))); },

    // passcode + salt → { kAuthHex (to server), kWrap (device-only CryptoKey) }
    async deriveKeys(passcode, saltHex, iters, version) {
      if ((version || FH_KDF_VERSION) !== 1) throw new Error('unsupported kdf version ' + version);
      const base = await crypto.subtle.importKey('raw', _te.encode(String(passcode)), 'PBKDF2', false, ['deriveBits']);
      const master = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: _unhex(saltHex), iterations: iters || FH_KDF_ITERS }, base, 256);
      const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
      const authBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: _te.encode('fh-auth-v1') }, hk, 256);
      const kWrap = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: _te.encode('fh-wrap-v1') }, hk,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return { kAuthHex: _hex(authBits), kWrap: kWrap };
    },

    async genDekRaw() { return crypto.getRandomValues(new Uint8Array(32)); },
    async importDek(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); },

    async wrapDek(dekRaw, kWrap) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, kWrap, dekRaw);
      return _b64(_cat(iv, new Uint8Array(ct)));
    },
    async unwrapDek(wrappedB64, kWrap) {
      const all = _unb64(wrappedB64);
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, kWrap, all.slice(12));
      return new Uint8Array(raw);
    },

    async encVal(dek, value) {
      if (value === null || value === undefined || value === '') return null;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, dek, _te.encode(String(value)));
      return _b64(_cat(iv, new Uint8Array(ct)));
    },
    async decVal(dek, b64) {
      if (!b64) return null;
      const all = _unb64(b64);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, dek, all.slice(12));
      return _td.decode(pt);
    },

    /* binary twins of encVal/decVal for photo blobs — same iv‖ct package, kept
       as raw bytes (a ~200KB image has no business being base64'd twice) */
    async encBytes(dek, bytes) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, dek, bytes);
      return _cat(iv, new Uint8Array(ct));
    },
    async decBytes(dek, all) {
      const u8 = (all instanceof Uint8Array) ? all : new Uint8Array(all);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, dek, u8.slice(12));
      return new Uint8Array(pt);
    }
  };
  window.FHCrypto = FHCrypto;

  /* ── per-family key session ──
     _fhDek is the imported CryptoKey for the ACTIVE family; _fhDekRaw keeps the
     raw bytes only long enough to re-wrap on a passcode change. The IndexedDB
     cache ('fh-keys') survives app restarts; losing it (logout, iOS eviction)
     only means the passcode is asked for again. */
  let _fhDek = null, _fhDekRaw = null, _fhDekFid = null;
  const _KEYS_DB = 'fh-keys', _KEYS_STORE = 'k';
  function _keysOpen() {
    return new Promise((resolve, reject) => {
      let rq; try { rq = indexedDB.open(_KEYS_DB, 1); } catch (e) { return reject(e); }
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(_KEYS_STORE)) db.createObjectStore(_KEYS_STORE, { keyPath: 'fid' }); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function _keysPut(fid, raw) {
    try { const db = await _keysOpen(); await new Promise((res, rej) => { const tx = db.transaction(_KEYS_STORE, 'readwrite'); tx.objectStore(_KEYS_STORE).put({ fid: fid, raw: raw, at: Date.now() }); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); } catch (e) {}
  }
  async function _keysGet(fid) {
    try { const db = await _keysOpen(); return await new Promise((res) => { const tx = db.transaction(_KEYS_STORE, 'readonly'); const rq = tx.objectStore(_KEYS_STORE).get(fid); rq.onsuccess = () => res(rq.result ? rq.result.raw : null); rq.onerror = () => res(null); }); } catch (e) { return null; }
  }
  async function _keysDel(fid) {
    try { const db = await _keysOpen(); await new Promise((res) => { const tx = db.transaction(_KEYS_STORE, 'readwrite'); tx.objectStore(_KEYS_STORE).delete(fid); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); } catch (e) {}
  }

  // Load the active family's DEK into the session (from cache). True if usable.
  async function fhKeyLoad(fid) {
    if (_fhDek && _fhDekFid === fid) return true;
    const raw = await _keysGet(fid);
    if (!raw) { _fhDek = null; _fhDekRaw = null; _fhDekFid = null; return false; }
    _fhDekRaw = new Uint8Array(raw); _fhDek = await FHCrypto.importDek(_fhDekRaw); _fhDekFid = fid;
    return true;
  }
  // Adopt a DEK we just created/unwrapped (set-passcode, join, unlock).
  async function fhKeyAdopt(fid, dekRaw) {
    _fhDekRaw = new Uint8Array(dekRaw); _fhDek = await FHCrypto.importDek(_fhDekRaw); _fhDekFid = fid;
    await _keysPut(fid, _fhDekRaw);
  }
  function fhKeyDrop(fid) {
    if (_fhDekFid === fid || fid == null) { _fhDek = null; _fhDekRaw = null; _fhDekFid = null; }
    if (fid != null) _keysDel(fid);
    try { if (window.__fhPhotoCachePurge) window.__fhPhotoCachePurge(); } catch (e) {}   // decrypted photo object-URLs die with the key
  }
  function _fhSessionDek() { if (!_fhDek) throw new Error('locked'); return _fhDek; }
  function fhKeyReady() { return !!(_fhDek && window.DB && _fhDekFid === window.DB.fid); }
  window.fhKeyReady = fhKeyReady;
  window.fhKeyDrop = fhKeyDrop;

  // enc profile of the ACTIVE family, refreshed by every hydrate from snap.enc
  function fhEncState() { return (window.DB && window.DB.enc && window.DB.enc.enc_state) || 'off'; }
  // Should writes carry ciphertext? (dual = both, enc = ciphertext only)
  function fhEncOn() { return fhEncState() !== 'off' && fhKeyReady(); }
  window.fhEncState = fhEncState;

  // Encrypt a value with the session DEK (null-safe; throws if key missing).
  async function fhEnc(v) { if (!_fhDek) throw new Error('no key'); return FHCrypto.encVal(_fhDek, v); }
  async function fhDec(b64) { if (!_fhDek) throw new Error('no key'); return FHCrypto.decVal(_fhDek, b64); }
  async function fhEncBytes(bytes) { if (!_fhDek) throw new Error('no key'); return FHCrypto.encBytes(_fhDek, bytes); }
  async function fhDecBytes(all) { if (!_fhDek) throw new Error('no key'); return FHCrypto.decBytes(_fhDek, all); }
  /* string bridges for the classic-script side (drafts, snapshot): resolve null
     instead of throwing so js-ui callers can degrade gracefully when locked */
  window.fhEncStr = async function (s) { try { return _fhDek ? await fhEnc(s) : null; } catch (e) { return null; } };
  window.fhDecStr = async function (b64) { try { return _fhDek ? await fhDec(b64) : null; } catch (e) { return null; } };

  /* Build the write-shape for one logical field: plaintext / ciphertext / both,
     driven by enc_state. Usage: Object.assign(row, await fhField('amount', v)).
     'enc'  → { amount: null, amount_enc: <ct> }   (ciphertext only)
     'dual' → { amount: v,    amount_enc: <ct> }   (verification window)
     'off' or key missing → { amount: v }          (today's behaviour)
     In dual, a missing key degrades to plaintext-only rather than blocking the
     write — the encrypt-alongside job re-covers the row later. In enc state a
     missing key throws: writing plaintext there would break the promise. */
  async function fhField(name, value) {
    const st = fhEncState(), o = {};
    if (value === null || value === undefined || value === '') { o[name] = null; return o; }   // empty stays empty in every state
    if (st === 'enc') {
      if (!fhKeyReady()) throw new Error('locked');
      o[name] = null; o[name + '_enc'] = await fhEnc(value);
      return o;
    }
    o[name] = value;
    if (st === 'dual' && fhKeyReady()) o[name + '_enc'] = await fhEnc(value);
    return o;
  }
  window.fhField = fhField;

  /* Read-side resolver for one row field. Rule:
       enc state  → prefer ciphertext (plaintext may be scrubbed/placeholder);
       off/dual   → prefer plaintext; in dual ALSO verify ct==pt and log loudly
                    on mismatch (the whole point of the verification window).
     Returns the resolved plaintext value as a string (caller casts) or null. */
  async function fhRead(row, name) {
    const pt = row[name], ct = row[name + '_enc'];
    if (fhEncState() === 'enc') {
      if (ct != null && fhKeyReady()) { try { return await fhDec(ct); } catch (e) { console.warn('FH decrypt failed', name, e); return null; } }
      return pt != null ? String(pt) : null;                 // bank-import / legacy rows keep plaintext
    }
    if (fhEncState() === 'dual' && ct != null && pt != null && fhKeyReady()) {
      try {
        const v = await fhDec(ct);
        const ptS = String(pt), same = (v === ptS) || (Number(v) === Number(ptS) && v !== '' && ptS !== '');
        if (!same) console.error('FH DUAL MISMATCH', name, { plaintext: ptS, decrypted: v });
      } catch (e) { console.error('FH DUAL DECRYPT FAILED', name, e); }
    }
    return pt != null ? String(pt) : (ct != null && fhKeyReady() ? await fhDec(ct).catch(() => null) : null);
  }
  window.fhRead = fhRead;
