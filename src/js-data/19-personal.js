  /* ═══ Personal ledger (0071) ═══════════════════════════════════════════════
     Double-entry re-architecture, client side. Every user gets a PERSONAL
     container (families.type='personal', single member, own DEK + own Key
     Card). A family transaction the user authored is MIRRORED into the
     personal container as a linked master (same link_id, re-encrypted to the
     personal key, space_id = the family it flows to). The family tab is
     untouched — it never reads these columns.

     Crash-safe mirror ordering: reserve link_id on the FAMILY row first, then
     insert the master. A reserved link with no master is repaired by the next
     reconcile pass (idempotent by link_id, no cursors).

     Personal-key session is deliberately separate from 15-crypto's active-
     family session: this module keeps its own CryptoKey handle, cached in the
     same 'fh-keys' IndexedDB store keyed by the personal fid. */
  (function () {
    const P = {
      fid: null, key: null, memberId: null, wrap: null,
      fams: [], cats: [], txns: [], incomes: [],
      state: 'boot',   // boot | provisioning | locked | loading | ready | error
      mirrorRan: false,
    };
    window.fhPersonalData = function () { return P; };

    const _sb = () => window.sb;
    async function _uid() {
      try { const s = await _sb().auth.getSession(); return s.data.session ? s.data.session.user.id : null; } catch (e) { return null; }
    }

    /* ── fh-keys IDB (same DB 15-crypto uses; own accessor, keyPath 'fid') ── */
    function _kOpen() {
      return new Promise((res, rej) => {
        let rq; try { rq = indexedDB.open('fh-keys', 1); } catch (e) { return rej(e); }
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('k')) db.createObjectStore('k', { keyPath: 'fid' }); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    }
    async function _kPut(fid, key) {
      try { const db = await _kOpen(); await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put({ fid: fid, key: key, at: Date.now() }); tx.oncomplete = () => res(1); tx.onerror = () => rej(tx.error); }); } catch (e) {}
    }
    async function _kGet(fid) {
      try { const db = await _kOpen(); return await new Promise((res) => { const tx = db.transaction('k', 'readonly'); const rq = tx.objectStore('k').get(fid); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; }
    }

    const _encP = (v) => FHCrypto.encVal(P.key, v);
    const _decP = async (b64) => { try { return b64 ? await FHCrypto.decVal(P.key, b64) : null; } catch (e) { return null; } };

    function _render() { try { if (window.renderPersonal) window.renderPersonal(); } catch (e) {} }
    function _setState(s) { P.state = s; _render(); }

    /* ── boot: called post-hydrate (and on personal tab open) ── */
    let _booting = false;
    window.fhPersonalBoot = async function () {
      if (_booting || !_sb()) return; _booting = true;
      try {
        const fams = (await _sb().rpc('my_families')).data || [];
        P.fams = fams;
        const mine = fams.find((f) => f.type === 'personal');
        if (!mine) { await _provision(); }
        else {
          P.fid = mine.family_id;
          const rec = await _kGet(P.fid);
          if (rec && rec.key) { P.key = rec.key; await _afterKey(); }
          else { await _loadWrap(); _setState('locked'); }
        }
      } catch (e) { console.warn('fhPersonalBoot failed', e); _setState('error'); }
      finally { _booting = false; }
    };

    async function _loadWrap() {
      const r = await _sb().from('family_key_wraps').select('kdf_salt,kdf_iters,kdf_version,wrapped_dek')
        .eq('family_id', P.fid).eq('kind', 'card').is('rotated_at', null).maybeSingle();
      P.wrap = r.data || null;
    }

    /* ── provisioning: silent, card-born, enc-from-birth ── */
    async function _provision() {
      _setState('provisioning');
      const card = FHCrypto.genCard();
      const salt = FHCrypto.genSaltHex();
      const keys = await FHCrypto.deriveKeys(card.key, salt, window.FH_KDF_ITERS_CARD, 1);
      const dekRaw = await FHCrypto.genDekRaw();
      const wrapped = await FHCrypto.wrapDek(dekRaw, keys.kWrap);
      let myName = null;
      try { myName = ((window.FAM && FAM.members) || []).filter((m) => m.me).map((m) => m.name)[0] || null; } catch (e) {}
      const r = await _sb().rpc('create_personal_ledger', {
        p_kdf_salt: salt, p_kdf_iters: window.FH_KDF_ITERS_CARD, p_kdf_version: 1,
        p_wrapped_dek: wrapped, p_member_name: myName,
      });
      if (r.error) { console.warn('create_personal_ledger failed', r.error); _setState('error'); return; }
      P.fid = r.data;
      P.key = await FHCrypto.importDek(dekRaw);
      await _kPut(P.fid, P.key);
      // The one secret the user must protect. Shown once, saveable from the sheet.
      window.__fhPersonalCard = card;
      try { if (window.fhPCardIntro) window.fhPCardIntro(); } catch (e) {}
      await _afterKey();
    }

    /* ── unlock with the personal card (new device / evicted cache) ── */
    window.fhPersonalUnlock = async function (input) {
      const p = FHCrypto.parseCard(input);
      if (!p.ok) return { ok: false, error: p.error };
      if (!P.wrap) await _loadWrap();
      if (!P.wrap) return { ok: false, error: 'no_wrap' };
      try {
        const keys = await FHCrypto.deriveKeys(p.key, P.wrap.kdf_salt, P.wrap.kdf_iters, P.wrap.kdf_version);
        const raw = await FHCrypto.unwrapDek(P.wrap.wrapped_dek, keys.kWrap);
        P.key = await FHCrypto.importDek(raw);
        await _kPut(P.fid, P.key);
        await _afterKey();
        return { ok: true };
      } catch (e) { return { ok: false, error: 'wrong_card' }; }
    };

    async function _afterKey() {
      await _findMemberId();
      await window.fhPersonalHydrate();
      _mirrorSoon();
    }

    async function _findMemberId() {
      if (P.memberId) return;
      const uid = await _uid(); if (!uid) return;
      const r = await _sb().from('members').select('id').eq('family_id', P.fid).eq('user_id', uid).is('archived_at', null).maybeSingle();
      P.memberId = r.data ? r.data.id : null;
    }

    /* ── hydrate: 3 windowed selects, decrypted with the personal key ── */
    function _winFrom() { const d = new Date(); d.setMonth(d.getMonth() - 1); d.setDate(1); return d.toISOString().slice(0, 10); }
    window.fhPersonalHydrate = async function () {
      if (!P.fid || !P.key) return;
      _setState('loading');
      try {
        const [cr, tr, ir] = await Promise.all([
          _sb().from('categories').select('id,name,name_enc,emoji,color').eq('family_id', P.fid).is('archived_at', null),
          _sb().from('transactions').select('id,txn_date,category_id,amount,amount_enc,note,note_enc,link_id,space_id,kind,status,updated_at,version').eq('family_id', P.fid).gte('txn_date', _winFrom()).order('txn_date', { ascending: false }),
          _sb().from('incomes').select('id,amount,amount_enc,note,note_enc,income_date').eq('family_id', P.fid).gte('income_date', _winFrom()),
        ]);
        P.cats = [];
        for (const c of (cr.data || [])) P.cats.push({ id: c.id, name: c.name != null ? c.name : await _decP(c.name_enc), emoji: c.emoji, color: c.color });
        P.txns = [];
        for (const t of (tr.data || [])) P.txns.push({
          id: t.id, date: t.txn_date, catId: t.category_id, linkId: t.link_id, spaceId: t.space_id,
          kind: t.kind, status: t.status, updatedAt: t.updated_at, version: t.version || 1,
          amt: t.amount != null ? Number(t.amount) : Number(await _decP(t.amount_enc)),
          note: t.note != null ? t.note : await _decP(t.note_enc),
        });
        P.incomes = [];
        for (const i of (ir.data || [])) P.incomes.push({
          id: i.id, date: i.income_date,
          amt: i.amount != null ? Number(i.amount) : Number(await _decP(i.amount_enc)),
          note: i.note != null ? i.note : await _decP(i.note_enc),
        });
        _setState('ready');
      } catch (e) { console.warn('personal hydrate failed', e); _setState('error'); }
    };

    /* ── writes: private expense / income (personal container, enc-only) ── */
    window.fhPersonalAddExpense = async function (amt, note, catId, dateIso) {
      if (!P.fid || !P.key || !P.memberId) return false;
      const row = {
        family_id: P.fid, category_id: catId || null, member_id: P.memberId, created_by: P.memberId,
        txn_date: dateIso || new Date().toISOString().slice(0, 10), status: 'realized', kind: 'expense',
        space_id: null, link_id: null,
        amount: null, amount_enc: await _encP(Number(amt)),
        note: null, note_enc: note ? await _encP(note) : null,
      };
      const r = await _sb().from('transactions').insert(row);
      if (r.error) { console.warn('personal expense failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };
    window.fhPersonalAddIncome = async function (amt, note) {
      if (!P.fid || !P.key || !P.memberId) return false;
      const row = {
        family_id: P.fid, member_id: P.memberId,
        income_date: new Date().toISOString().slice(0, 10),
        amount: null, amount_enc: await _encP(Number(amt)),
        note: null, note_enc: note ? await _encP(note) : null,
      };
      const r = await _sb().from('incomes').insert(row);
      if (r.error) { console.warn('personal income failed', r.error); return false; }
      await window.fhPersonalHydrate(); return true;
    };

    /* ── mirror engine: family (ACTIVE) → personal masters ──
       Scope v1: the active family only — its key is the one this session holds
       (fhDecStr). Other families mirror when the user switches to them. */
    let _mirrorTries = 0, _mirroring = false, _debounce = null;
    function _mirrorSoon(ms) { setTimeout(() => { window.fhPersonalMirror(); }, ms || 1200); }
    // Called by the family write paths (create/edit/delete) so the personal
    // ledger updates promptly instead of only on next hydrate/tab-open. Debounced
    // so a bulk import (many writes) coalesces into one mirror pass. Idempotent +
    // re-entrancy-guarded, so a spurious call is harmless.
    window.fhPersonalMirrorSoon = function () {
      _mirrorTries = 0;                                        // a real write resets the gate-retry budget
      if (_debounce) clearTimeout(_debounce);
      _debounce = setTimeout(() => { _debounce = null; window.fhPersonalMirror(); }, 1500);
    };

    window.fhPersonalMirror = async function () {
      if (_mirroring) return;                                 // re-entrancy: retries/boot must never overlap a live run
      if (!P.fid || !P.key) return;
      if (!P.memberId) await _findMemberId();                 // may have been blocked pre-0072 — re-resolve
      const fid = window.DB && DB.fid, myMem = window.DB && DB.ownerMemberId;
      if (!P.memberId || !fid || fid === P.fid || !myMem || !window.fhKeyReady || !fhKeyReady()) {
        if (_mirrorTries++ < 5) _mirrorSoon(4000);            // gates not ready yet → bounded retry, never give up on first boot
        return;
      }
      _mirroring = true;
      try {
        // family categories (id → name) via the ACTIVE family key
        const fc = await _sb().from('categories').select('id,name,name_enc,emoji,color').eq('family_id', fid).is('archived_at', null);
        const famCat = {};
        for (const c of (fc.data || [])) famCat[c.id] = { name: c.name != null ? c.name : await fhDecStr(c.name_enc), emoji: c.emoji, color: c.color };

        const from = _winFrom();
        // 1) adopt: my authored, realized, unlinked family rows
        const un = await _sb().from('transactions')
          .select('id,txn_date,category_id,amount,amount_enc,note,note_enc,updated_at')
          .eq('family_id', fid).eq('created_by', myMem).eq('status', 'realized').eq('kind', 'expense')
          .is('link_id', null).gte('txn_date', from).limit(100);
        for (const row of (un.data || [])) {
          const amtS = row.amount != null ? String(row.amount) : await fhDecStr(row.amount_enc);
          if (amtS == null || amtS === '') continue;          // family ciphertext unreadable → skip (never mirror a 0)
          const amt = Number(amtS);
          if (!isFinite(amt)) continue;
          const note = row.note != null ? row.note : await fhDecStr(row.note_enc);
          const catName = row.category_id && famCat[row.category_id] ? famCat[row.category_id].name : null;
          const pCatId = await _catFor(catName, row.category_id && famCat[row.category_id]);
          const linkId = crypto.randomUUID();
          // reserve on the family row FIRST (crash-safe), then insert the master.
          // .select() so a raced/0-row update is DETECTED — a match-nothing update
          // is not an error, and proceeding on it is what minted duplicate masters.
          const u = await _sb().from('transactions').update({ link_id: linkId }).eq('id', row.id).is('link_id', null).select('id');
          if (u.error || !u.data || u.data.length !== 1) continue;
          await _insertMaster(linkId, fid, row, amt, note, pCatId);
        }

        // 2) reconcile: linked family rows ↔ masters (repair / refresh / tombstone).
        // Masters are re-queried FRESH here — using the pre-adopt P.txns made the
        // repair step blind to masters adopt just inserted, duplicating them.
        const ln = await _sb().from('transactions')
          .select('id,link_id,txn_date,category_id,amount,amount_enc,note,note_enc,updated_at')
          .eq('family_id', fid).eq('created_by', myMem).not('link_id', 'is', null).gte('txn_date', from).limit(400);
        const famBy = {}; (ln.data || []).forEach((r) => { famBy[r.link_id] = r; });
        const mq = await _sb().from('transactions')
          .select('id,link_id,txn_date,amount_enc,note_enc,updated_at,version,created_at')
          .eq('family_id', P.fid).eq('space_id', fid).not('link_id', 'is', null).gte('txn_date', from).order('created_at');
        const mastersBy = {};
        for (const r of (mq.data || [])) {
          if (mastersBy[r.link_id]) {                          // self-heal: duplicate master for one link → keep earliest, drop the rest
            await _sb().from('transactions').delete().eq('id', r.id);
            continue;
          }
          mastersBy[r.link_id] = {
            id: r.id, linkId: r.link_id, date: r.txn_date, updatedAt: r.updated_at, version: r.version || 1,
            amt: Number(await _decP(r.amount_enc)), note: await _decP(r.note_enc),
          };
        }

        for (const lid of Object.keys(famBy)) {
          const f = famBy[lid], m = mastersBy[lid];
          const amtS = f.amount != null ? String(f.amount) : await fhDecStr(f.amount_enc);
          if (amtS == null || amtS === '') continue;
          const amt = Number(amtS);
          if (!isFinite(amt)) continue;
          const note = f.note != null ? f.note : await fhDecStr(f.note_enc);
          if (!m) {                                            // reserved link, master missing → repair
            const catName = f.category_id && famCat[f.category_id] ? famCat[f.category_id].name : null;
            await _insertMaster(lid, fid, f, amt, note, await _catFor(catName, f.category_id && famCat[f.category_id]));
          } else if (f.updated_at > m.updatedAt && (amt !== m.amt || (note || '') !== (m.note || ''))) {
            await _sb().from('transactions').update({
              amount: null, amount_enc: await _encP(amt),
              note: null, note_enc: note ? await _encP(note) : null,
              txn_date: f.txn_date, version: (m.version || 1) + 1,
            }).eq('id', m.id);
          }
        }
        // tombstones + orphans: masters pointing at this family, in-window, whose
        // family copy is gone (deleted) or never carried this link (raced adopt)
        for (const lid of Object.keys(mastersBy)) {
          if (!famBy[lid]) await _sb().from('transactions').delete().eq('id', mastersBy[lid].id);
        }
        P.mirrorRan = true;
        await window.fhPersonalHydrate();
      } catch (e) {
        console.warn('personal mirror failed', e);
        if (_mirrorTries++ < 5) _mirrorSoon(6000);            // transient (offline, mid-hydrate) → bounded retry
      } finally { _mirroring = false; }
    };

    async function _insertMaster(linkId, spaceFid, famRow, amt, note, pCatId) {
      return _sb().from('transactions').insert({
        family_id: P.fid, category_id: pCatId, member_id: P.memberId, created_by: P.memberId,
        txn_date: famRow.txn_date, status: 'realized', kind: 'expense',
        link_id: linkId, space_id: spaceFid, version: 1,
        amount: null, amount_enc: await _encP(amt),
        note: null, note_enc: note ? await _encP(note) : null,
      });
    }

    /* personal category for a family category name — match by name, create on miss */
    async function _catFor(name, famCat) {
      if (!name) return null;
      const hit = P.cats.find((c) => (c.name || '').trim().toLowerCase() === name.trim().toLowerCase());
      if (hit) return hit.id;
      const ins = await _sb().from('categories').insert({
        family_id: P.fid, name: null, name_enc: await _encP(name),
        emoji: (famCat && famCat.emoji) || '🗂️', color: (famCat && famCat.color) || null, sort_order: 90,
      }).select('id').single();
      if (ins.error || !ins.data) return null;
      P.cats.push({ id: ins.data.id, name: name, emoji: (famCat && famCat.emoji) || '🗂️' });
      return ins.data.id;
    }

    // Resolve a category NAME (as shown in the family chips) to a personal-ledger
    // category id, creating it on first use. Used by the shared capture modal
    // when logging a personal-scoped expense.
    window.fhPersonalCatId = async function (name, emoji) {
      if (!P.key || !name) return null;
      try { return await _catFor(name, emoji ? { emoji: emoji } : null); } catch (e) { return null; }
    };
  })();
