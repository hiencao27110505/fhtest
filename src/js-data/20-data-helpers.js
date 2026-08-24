  // ═══════════════════════════════════════════════════════════════════════════
  //  DATA LAYER — hydrate the app's globals from the DB + write-through mutations
  // ═══════════════════════════════════════════════════════════════════════════
  // warm start hands us the last-known maps so writes work before the hydrate lands
  window.DB = Object.assign(
    { fid: null, month: null, monthKey: null, catById: {}, catByName: {}, memberById: {}, memberByAppName: {}, sharedId: null, ownerMemberId: null, eventById: {}, rtFid: null },
    window.__fhSnapDB || {},
    { rtFid: null }                                    // realtime must re-subscribe for real
  );

  const _pad = (n) => (n < 10 ? '0' : '') + n;
  const _isoMonth = (d) => d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-01';
  const _isoDate = (d) => d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
  const MO = window.MONA || ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MOF = window.MONF || ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function _memberIdForWho(who) {
    const key = (who || '').toLowerCase();
    if (key === 'both' || key === 'shared') return window.DB.sharedId || window.DB.ownerMemberId;
    const id = window.DB.memberByAppName[who];
    if (id) return id;
    // case-insensitive fallback
    for (const n in window.DB.memberByAppName) { if (n.toLowerCase() === key) return window.DB.memberByAppName[n]; }
    return window.DB.ownerMemberId || window.DB.sharedId;
  }
  window._categoryIdForName = (n, e, so) => _categoryIdForName(n, e, so);
  async function _categoryIdForName(name, emoji, sort) {
    const nm = String(name == null ? '' : name).trim();
    if (!nm) return null;
    if (window.DB.catByName[nm]) return window.DB.catByName[nm];
    const lower = nm.toLowerCase();                                     // case-insensitive: don't duplicate "Fun" vs "fun"
    for (const k in window.DB.catByName) { if (k.toLowerCase() === lower) return window.DB.catByName[k]; }
    try {
      /* Archived-row revival, decrypted-side first: catById holds every row —
         archived included — with names already resolved by the hydrate, which
         is the only place ciphertext names can be matched. The server ilike
         below still covers plaintext families (and rows this device can't
         decrypt can't be matched by anyone's query anyway). */
      for (const id in window.DB.catById) {
        const c = window.DB.catById[id];
        if (c && c.archived_at && c.name && String(c.name).toLowerCase() === lower) {
          await _w(sb.from('categories').update({ archived_at: null }).eq('id', id), 'write categories');
          window.DB.catByName[nm] = id; c.archived_at = null;
          return id;
        }
      }
      const found = (await sb.from('categories').select('id,name,archived_at').eq('family_id', window.DB.fid).ilike('name', nm).limit(1)).data;
      if (found && found.length) {
        const c = found[0];
        if (c.archived_at) await _w(sb.from('categories').update({ archived_at: null }).eq('id', c.id), 'write categories');
        window.DB.catByName[nm] = c.id; window.DB.catById[c.id] = { id: c.id, name: c.name, emoji: emoji };
        return c.id;
      }
      const res = await sb.from('categories').insert(Object.assign(
        { family_id: window.DB.fid, emoji: emoji || '🏷️', color: '#8f8a99', sort_order: sort || 99 },
        await fhField('name', nm))).select('id').single();
      if (res.data) { window.DB.catByName[nm] = res.data.id; window.DB.catById[res.data.id] = { id: res.data.id, name: nm, emoji: emoji }; return res.data.id; }
    } catch (e) { console.warn('category create failed', e); }
    return null;
  }
  function _txnIso(t, exD) {
    if (exD && exD.getFullYear) return _isoDate(exD);
    const d = t.date || ''; const now = new Date();
    if (d === 'Today' || d === 'Just now') return _isoDate(now);
    const m = d.match(/([A-Za-z]{3,})\s+(\d{1,2})/);
    if (m) { const mi = MO.indexOf(m[1].slice(0, 3)); if (mi >= 0) return now.getFullYear() + '-' + _pad(mi + 1) + '-' + _pad(parseInt(m[2])); }
    return _isoDate(now);
  }

  // fhAvStyle / fhAvIni now live in the classic js-ui layer (10-nav-model.js) so
  // they exist at parse-time boot render; used here for the hero + spender rows.
  function updateHeroFam() {
    const box = document.getElementById('hero-fam');
    if (box && window.FAM) box.innerHTML = (window.FAM.members || []).slice(0, 5).map((mm) =>
      '<div class="av av-hero" style="' + window.fhAvStyle(mm) + '">' + (mm.av ? '' : window.esc(inits(mm.name))) + '</div>').join('') +
      '<span class="hero-fam-cap">' + window.esc(window.FAM.familyName || '') + '</span>';
  }

  // first-load spinner (so the app never flashes empty/mock before real data arrives)
  function _showLoading() {
    if (document.getElementById('fh-loading')) return;
    if (_resuming()) return;                     // the resume splash is already covering the screen
    if (document.documentElement.classList.contains('fh-warm')) return;   // warm start shows real data + "Updating…"
    const ov = document.createElement('div');
    ov.id = 'fh-loading';
    ov.style.cssText = 'position:absolute;inset:0;z-index:66;display:flex;align-items:center;justify-content:center;background:var(--canvas)';
    ov.innerHTML = '<div style="text-align:center"><div style="width:34px;height:34px;border:3px solid var(--hairline);border-top-color:var(--brand);border-radius:50%;margin:0 auto 14px;animation:fhspin2 .8s linear infinite"></div><div style="font-size:14px;color:var(--muted)">' + L('Đang tải gia đình của bạn…','Loading your family…') + '</div></div>';
    (document.getElementById('phone') || document.body).appendChild(ov);
  }
  function _hideLoading() { const ov = document.getElementById('fh-loading'); if (ov) ov.remove(); }
  // surface write failures instead of failing silently
  function _writeErr(what, e) {
    console.warn(what, e);
    // a rejected plaintext write (0033 'enc_required') self-heals: SW update
    // check + re-sync + passcode prompt, so the user can retry immediately
    if (/enc_required/i.test(String((e && (e.message || e.error_description)) || '')) && window._fhEncRecover) window._fhEncRecover();
    // A connection drop isn't "something went wrong": the transaction is already
    // queued (R9) and other writes reconcile on the next hydrate. Staying silent
    // here stops a false error toast from stomping the "Saved on this device" one.
    if (navigator.onLine === false || _isNetErr(e)) return;
    try { if (window.toast) window.toast(_friendly(e)); } catch (x) {}
  }
  /* supabase-js RESOLVES {data,error} on 4xx — it does not throw. A bare
     `await sb.from(x).update(...)` therefore swallows RLS denials and constraint
     violations, and the caller reports success for a write that never landed.
     Route every write through this so the surrounding try/catch actually works. */
  async function _w(q, what) {
    const { data, error } = await q;
    if (error) { console.warn(what || 'write failed', error); throw error; }
    return data;
  }
  // re-fetch shortly after any write so every screen stays consistent. R6: default to a
  // WINDOWED refresh (recent txns/photos/reactions merged onto what we hold); pass
  // full=true for a write that can touch an out-of-window row (txn edit/delete, a
  // reaction on an old txn), so the change can't be silently dropped by the window.
  let _syncTimer = null;
  function _syncSoon(full) { try { window.DB._lastLocalWrite = Date.now(); } catch (e) {} try { if (window.fhPersonalMirrorSoon) window.fhPersonalMirrorSoon(); } catch (e) {} clearTimeout(_syncTimer); _syncTimer = setTimeout(() => { if (window.editingTx != null) return; window.loadFamilyData && window.loadFamilyData(full ? {} : { windowed: true }); }, 700); }
  // Is a loaded transaction (by DB id) older than the current refresh window? Unknown
  // id → treated as old (forces full) so an out-of-window change is never missed.
  function _isOldTxnById(dbId) {
    if (!window.DB._winBoundMs) return false;                  // no window in effect → windowed == full, doesn't matter
    const arr = window.txns || [];
    for (let i = 0; i < arr.length; i++) { if (arr[i]._dbId === dbId) return !!(arr[i]._d && arr[i]._d.getTime() < window.DB._winBoundMs); }
    return true;
  }

  // colored txn-row avatars from the real member palette (overrides the mock spMap version)
  window.spAv = function (who) {
    const key = (who || '').toLowerCase(); let mm = null;
    if (key === 'both' || key === 'shared') mm = window.membersMeta && window.membersMeta['Shared'];
    else if (window.membersMeta) { for (const n in window.membersMeta) { if (n.toLowerCase() === key) { mm = window.membersMeta[n]; break; } } }
    mm = mm || { col: '#8f8a99', ini: '👥' };
    return '<div class="r-sp av" style="' + window.fhAvStyle(mm) + '">' + window.esc(window.fhAvIni(mm)) + '</div>';
  };

  // rebuild the "who paid" / "added by" chips from the real family (replaces mock Emma/James/…)
  function _rebuildWhoChips() {
    const mems = (window.FAM && window.FAM.members) || [];
    const bothLabel = (window.LANG === 'vi') ? 'Chung' : 'Both';
    function fill(id, onclick) {
      const box = document.getElementById(id); if (!box) return;
      let html = mems.map((m, i) => '<button class="choice' + (i === 0 ? ' on' : '') + '" data-v="' + window.esc(m.name) + '" onclick="' + onclick + '">' + window.esc(m.name) + '</button>').join('');
      html += '<button class="choice" data-v="Both" onclick="' + onclick + '">' + bothLabel + '</button>';
      box.innerHTML = html;
    }
    fill('ex-who', 'pickExWho(this)');
    fill('fn-who', "pick('fn-who',this)");
    fill('mom-who', 'pickMomWho(this)');
    if (mems[0]) window.lastWho = mems[0].name;
  }
