  // ---- write-through: transactions ----
  // downscale + re-encode to JPEG before upload; also normalizes iOS HEIC.
  // Falls back to the original data URI if decoding/encoding fails, so a photo is never lost.
  function _compressImage(dataUri, maxPx, quality) {
    maxPx = maxPx || 1600; quality = quality || 0.82;
    return new Promise((resolve) => {
      try {
        if (!dataUri || dataUri.indexOf('data:image/') !== 0) return resolve(dataUri);
        if (dataUri.indexOf('data:image/gif') === 0) return resolve(dataUri);     // keep animation intact
        const srcMime = (dataUri.match(/^data:([^;]+)/) || [])[1] || '';
        const webSafe = /^image\/(jpeg|png|webp)$/.test(srcMime);
        const img = new Image();
        img.onload = function () {
          try {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) return resolve(dataUri);
            const scale = Math.min(1, maxPx / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            const cx = cv.getContext('2d'); if (!cx) return resolve(dataUri);
            cx.drawImage(img, 0, 0, cw, ch);
            const out = cv.toDataURL('image/jpeg', quality);
            if (!out || out.indexOf('data:image/jpeg') !== 0) return resolve(dataUri);
            // always take the JPEG for non-web-safe sources (HEIC); otherwise keep whichever is smaller
            resolve((!webSafe || out.length < dataUri.length) ? out : dataUri);
          } catch (e) { resolve(dataUri); }
        };
        img.onerror = function () { resolve(dataUri); };
        img.src = dataUri;
      } catch (e) { resolve(dataUri); }
    });
  }
  async function _uploadPhoto(dataUri) {
    try {
      const fid = window.DB.fid; if (!fid || !dataUri || dataUri.indexOf('data:') !== 0) return null;
      dataUri = await _compressImage(dataUri);
      const m = dataUri.match(/^data:([^;]+);base64,(.*)$/); if (!m) return null;
      const mime = m[1]; const bin = atob(m[2]); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const ext = ((mime.split('/')[1]) || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const path = fid + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      // Paths embed a timestamp + random suffix and are never overwritten, so the
      // bytes at a given URL are immutable — cache them for a year instead of
      // Supabase's 1h default, which would otherwise force a revalidation round
      // trip per photo every hour.
      const { error } = await sb.storage.from('family-media').upload(path, arr, { contentType: mime, cacheControl: '31536000' });
      if (error) { console.warn('upload failed', error); return null; }
      return path;
    } catch (e) { console.warn('upload err', e); return null; }
  }
  /* EXIF capture date for a pre-compression data URI, recorded by readPhoto().
     Photos that predate the parser, or that carried no usable EXIF, return null
     and are stored as "date unknown" rather than guessed at. */
  function _takenOn(dataUri) {
    try {
      const m = (typeof PHOTO_TAKEN !== 'undefined') ? PHOTO_TAKEN : window.PHOTO_TAKEN;
      if (!m || !dataUri) return null;
      const hit = m.get(dataUri) || null;
      // Keys are the full data URIs, so a long session would pin every photo's
      // bytes in memory after its array is cleared. Bounded, oldest-first —
      // read first, so pruning can never drop the entry we were just asked for.
      if (m.size > 120) { const it = m.keys(); for (let i = 0; i < 40; i++) { const k = it.next(); if (k.done) break; m.delete(k.value); } }
      return hit;
    } catch (e) { return null; }
  }
  async function _dbUploadTxnPhotos(txnId, photos) {
    let failed = 0;
    try { window.fhUploadBusy && window.fhUploadBusy(photos.length); } catch (e) {}
    try {
      for (let i = 0; i < photos.length; i++) {
        const takenOn = _takenOn(photos[i]);
        const path = await _uploadPhoto(photos[i]);
        if (path) await _w(sb.from('transaction_photos').insert({ family_id: window.DB.fid, transaction_id: txnId, photo_url: path, sort_order: i, taken_on: takenOn }), 'write transaction_photos');
        else failed++;
      }
    } catch (e) { console.warn('txn photos failed', e); failed++; }
    finally { try { window.fhUploadBusy && window.fhUploadBusy(-photos.length); } catch (e) {} }
    _uploadOutcome(failed, photos.length);
  }
  async function _dbUploadEventMemories(eventId, memories, baseSort) {
    baseSort = baseSort || 0; let failed = 0;
    try { window.fhUploadBusy && window.fhUploadBusy(memories.length); } catch (e) {}
    try {
      for (let i = 0; i < memories.length; i++) {
        const mm = memories[i]; let path = null; const wantsPhoto = !!mm.src;
        const takenOn = _takenOn(mm.src);
        if (mm.src && mm.src.indexOf('data:') === 0) path = await _uploadPhoto(mm.src);
        else if (mm.src && mm.src.indexOf('http') === 0) path = mm.src;
        if (wantsPhoto && !path) { failed++; continue; }     // upload failed → skip the row (no photoless ghost memory)
        await _w(sb.from('event_memories').insert({ family_id: window.DB.fid, event_id: eventId, photo_url: path, caption: mm.caption || null, emoji: mm.emoji || null, sort_order: baseSort + i, taken_on: takenOn }), 'write event_memories');
      }
    } catch (e) { console.warn('event memories failed', e); failed++; }
    finally { try { window.fhUploadBusy && window.fhUploadBusy(-memories.length); } catch (e) {} }
    _uploadOutcome(failed, memories.length);
  }
  /* Report only once the bytes are actually stored. A failure names how many and
     tells the user the photo wasn't kept — the local copy is dropped on the next
     hydrate, so silence here reads as success and then loses the photo. */
  function _uploadOutcome(failed, total) {
    if (!total) return;
    if (!failed) { window.toast && window.toast(total === 1 ? L('Đã lưu ảnh 📸','Photo saved 📸') : L(total+' ảnh đã lưu 📸', total + ' photos saved 📸')); return; }
    window.toast && window.toast(
      failed === total
        ? (total === 1 ? L('Ảnh chưa lưu được, thử lại','Photo didn’t save, try again') : L('Ảnh chưa lưu được, thử lại','Photos didn’t save, try again'))
        : L(failed+'/'+total+' ảnh chưa lưu được', failed + ' of ' + total + ' photos didn’t save')
    );
  }

  function _storagePathFromUrl(u) {
    const m = String(u || '').match(/\/family-media\/([^?]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  // reconcile a transaction's photos on edit: keep existing, upload new (data:), delete removed (rows + storage files)
  async function _dbSyncTxnPhotos(txnId, photos) {
    const fid = window.DB.fid; if (!fid) return;
    photos = photos || [];
    const cur = (await sb.from('transaction_photos').select('id,photo_url').eq('transaction_id', txnId)).data || [];
    const kept = new Set(); const uploads = [];
    photos.forEach((p) => {
      if (typeof p !== 'string') return;
      if (p.indexOf('data:') === 0) { uploads.push(p); return; }
      const path = (window.DB.pathByUrl && window.DB.pathByUrl[p]) || _storagePathFromUrl(p);
      if (path) kept.add(path);
    });
    const removed = cur.filter((r) => !kept.has(r.photo_url));
    if (removed.length) {
      await _w(sb.from('transaction_photos').delete().in('id', removed.map((r) => r.id)), 'write transaction_photos');
      const files = removed.map((r) => r.photo_url).filter((p) => p && p.indexOf('http') !== 0);
      if (files.length) { try { await sb.storage.from('family-media').remove(files); } catch (e) {} }
    }
    let sort = cur.length - removed.length;
    for (const dataUri of uploads) {
      const takenOn = _takenOn(dataUri);
      const path = await _uploadPhoto(dataUri);
      if (path) await _w(sb.from('transaction_photos').insert({ family_id: fid, transaction_id: txnId, photo_url: path, sort_order: sort++, taken_on: takenOn }), 'write transaction_photos');
    }
  }

  /* ═══ R9 — offline write outbox ═══════════════════════════════════════════
     Writes are optimistic and fire-and-forget, so a lost connection used to drop a
     logged expense silently: the local row was replaced by server data on the next
     hydrate and the write never landed. The outbox makes the common case — "log a
     dinner (with a receipt photo) on no signal" — durable: the row is stored in
     IndexedDB and replayed when the connection returns. A client-generated uuid is
     the row's id, so a replay that already succeeded server-side collides on the PK
     and is treated as done (idempotent). Scope is transaction inserts + their photos;
     edits/deletes made before the first sync are a rare edge left for a later pass. */
  const _OB_DB = 'fh-outbox', _OB_STORE = 'q';
  let _obFlushing = false, _obHadItems = false;
  function _obOpen() {
    return new Promise((resolve, reject) => {
      let rq; try { rq = indexedDB.open(_OB_DB, 1); } catch (e) { return reject(e); }
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(_OB_STORE)) db.createObjectStore(_OB_STORE, { keyPath: 'id' }); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function _obAdd(rec) {
    try { const db = await _obOpen(); return await new Promise((res, rej) => { const tx = db.transaction(_OB_STORE, 'readwrite'); tx.objectStore(_OB_STORE).put(rec); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }
    catch (e) { return false; }
  }
  async function _obAll() {
    try { const db = await _obOpen(); return await new Promise((res) => { const out = []; const tx = db.transaction(_OB_STORE, 'readonly'); const cur = tx.objectStore(_OB_STORE).openCursor(); cur.onsuccess = () => { const c = cur.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; cur.onerror = () => res(out); }); }
    catch (e) { return []; }
  }
  async function _obDel(id) {
    try { const db = await _obOpen(); return await new Promise((res) => { const tx = db.transaction(_OB_STORE, 'readwrite'); tx.objectStore(_OB_STORE).delete(id); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); }
    catch (e) { return false; }
  }
  function _isNetErr(e) { const m = String((e && (e.message || e.error_description)) || e || ''); return /network|fetch|timeout|failed to fetch|load failed|offline/i.test(m); }
  async function _obQueueTxn(row, t) {
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
    const payload = { row: Object.assign({ id: id }, row), photos: (t && t.photos) ? t.photos.slice() : [] };
    if (t) t._dbId = id;                                   // local row now carries its eventual id
    const ok = await _obAdd({ id: id, kind: 'insertTxn', payload: payload, ts: Date.now() });
    _obHadItems = true;
    window.toast && window.toast(ok ? L('Đã lưu trên máy, sẽ đồng bộ khi có mạng','Saved on this device, will sync when you’re back online') : L('Đã lưu trên máy','Saved on this device'));
  }
  async function fhOutboxFlush() {
    if (_obFlushing || navigator.onLine === false || !window.DB || !window.DB.fid) return;
    _obFlushing = true;
    try {
      const items = (await _obAll()).sort((a, b) => a.ts - b.ts);
      for (const it of items) {
        try {
          if (it.kind === 'insertTxn') {
            const res = await sb.from('transactions').insert(it.payload.row).select('id').single();
            if (res.error) {
              if (/duplicate key|already exists/i.test(res.error.message || '')) { await _obDel(it.id); continue; }  // a prior replay landed it
              throw res.error;                             // still offline / real error → keep, retry later
            }
            const newId = res.data && res.data.id;
            if (newId && it.payload.photos && it.payload.photos.length) { try { await _dbUploadTxnPhotos(newId, it.payload.photos); } catch (e) {} }
            await _obDel(it.id);
          } else { await _obDel(it.id); }
        } catch (e) { break; }                             // stop at the first failure; a later online/hydrate retries
      }
    } finally { _obFlushing = false; }
    const left = (await _obAll()).length;
    if (!left && _obHadItems) { _obHadItems = false; window.toast && window.toast(L('Đã đồng bộ thay đổi ngoại tuyến ✓','Offline changes synced ✓')); if (window.loadFamilyData) window.loadFamilyData(); }
  }
  window.fhOutboxFlush = fhOutboxFlush;
  window.addEventListener('online', () => setTimeout(fhOutboxFlush, 600));
  setTimeout(() => { fhOutboxFlush(); }, 3000);            // catch anything queued from a previous session

  /* Encrypted families must not fall back to plaintext writes: when the family
     is post-scrub ('enc') and this device hasn't been unlocked, block the write
     and ask for the passcode instead of quietly leaking a plaintext row. */
  function _fhWriteLocked() {
    if (fhEncState() === 'enc' && !fhKeyReady()) {
      window.toast && window.toast(L('Nhập mã gia đình để ghi chép', 'Enter the family code to log entries'));
      if (window.fhUnlockPrompt) window.fhUnlockPrompt();
      return true;
    }
    return false;
  }
  async function _dbInsertTxn(t, exD) {
    const fid = window.DB.fid; if (!fid) return;
    if (_fhWriteLocked()) return;
    // Resolve the category id from the local map first. Creating a brand-new category
    // needs the network, so offline we fall back to the local maps / the catch-all
    // rather than blocking the queued write on a round trip that can't succeed.
    let catId = window.DB.catByName[t.cat];
    if (!catId && navigator.onLine !== false) { try { catId = await _categoryIdForName(t.cat, t.ico, window.catOrder.indexOf(t.cat) + 1); } catch (e) {} }
    if (!catId) catId = window.DB.catByName[CAT_FALLBACK] || Object.values(window.DB.catByName)[0];
    const row = Object.assign(
      { family_id: fid, category_id: catId, member_id: _memberIdForWho(t.who), txn_date: _txnIso(t, exD), status: t.future ? 'planned' : 'realized', created_by: (window.DB && window.DB.ownerMemberId) || null },
      await fhField('amount', t.amt), await fhField('note', t.note));
    // Offline → queue durably instead of losing the write.
    if (navigator.onLine === false) { await _obQueueTxn(row, t); return; }
    try {
      const res = await sb.from('transactions').insert(row).select('id').single();
      if (res.error) throw res.error;
      if (res.data) { t._dbId = res.data.id; if (t.photos && t.photos.length) _dbUploadTxnPhotos(t._dbId, t.photos); }
      _syncSoon();
    } catch (e) {
      // A connection dropped mid-write is recoverable — queue it; anything else is real.
      if (_isNetErr(e)) await _obQueueTxn(row, t);
      else _writeErr('txn insert failed', e);
    }
  }
  async function _dbUpdateTxn(dbId, t, exD) {
    if (_fhWriteLocked()) return;
    try {
      const catId = window.DB.catByName[t.cat] || await _categoryIdForName(t.cat, t.ico, window.catOrder.indexOf(t.cat) + 1);
      const patch = Object.assign(
        { category_id: catId, member_id: _memberIdForWho(t.who), txn_date: _txnIso(t, exD), status: t.future ? 'planned' : 'realized' },
        await fhField('amount', t.amt), await fhField('note', t.note));
      await _w(sb.from('transactions').update(patch).eq('id', dbId), 'write transactions');
      await _dbSyncTxnPhotos(dbId, t.photos);
      _syncSoon();
    } catch (e) { _writeErr('txn update failed', e); }
  }
  async function _dbDeleteTxn(dbId) {
    try {
      try {                                                   // remove storage files before the photo rows cascade away
        const ph = (await sb.from('transaction_photos').select('photo_url').eq('transaction_id', dbId)).data || [];
        const files = ph.map((r) => r.photo_url).filter((p) => p && p.indexOf('http') !== 0);
        if (files.length) await sb.storage.from('family-media').remove(files);
      } catch (e) {}
      await _w(sb.from('transactions').delete().eq('id', dbId), 'delete transaction');  // transaction_photos rows cascade on delete
      _syncSoon();
    } catch (e) { _writeErr('txn delete failed', e); }
  }
