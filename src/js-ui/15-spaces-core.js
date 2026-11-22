/* ── Spaces ("Nhóm") — the pure rules (docs/specs/spaces-spec.md) ─────────────
   No DOM, no network, no keys: profile defaults, the split arithmetic, the
   balance sum, and the plan of rows a space puts into one member's own book.
   Everything that decides a NUMBER lives here so tools/spaces-core.test.js can
   pin it and every surface (expense sheet, review card, money tab, the book
   pass) can only agree.

   Amounts are base units (thousands of đồng), as everywhere in the client. */

/* The eight switches (spec section 3). `mode` is what a new expense defaults
   to: 'chung' (nobody owes) or 'chia' (split equally among every member). */
var FH_SPACE_FEATURES = ['budget','split','moments','react','goals','ask','house','source'];
var FH_SPACE_PRESETS = {
  family: { budget:true,  split:false, moments:true, react:true, goals:true,  ask:true,  house:true,  source:true,  mode:'chung' },
  friend: { budget:false, split:true,  moments:true, react:true, goals:false, ask:false, house:false, source:false, mode:'chia' },
  other:  { budget:false, split:true,  moments:true, react:true, goals:false, ask:false, house:false, source:false, mode:'chia' }
};
/* The preset a container reads as when its profile does not name one: a
   family is 'family', anything else 'friend'. An existing family has
   profile {} and therefore every switch it has today (S4, S39). */
function fhSpacePresetOf(type, profile){
  var p = profile && profile.preset;
  if(p && FH_SPACE_PRESETS[p]) return p;
  return (!type || type === 'family') ? 'family' : 'friend';
}
function fhSpaceProfileOf(type, profile){
  var preset = fhSpacePresetOf(type, profile), base = FH_SPACE_PRESETS[preset], out = { preset: preset };
  FH_SPACE_FEATURES.forEach(function(k){ out[k] = (profile && typeof profile[k] === 'boolean') ? profile[k] : base[k]; });
  out.mode = (profile && (profile.mode === 'chung' || profile.mode === 'chia')) ? profile.mode : base.mode;
  if(!out.split) out.mode = 'chung';
  return out;
}

/* Round to the đồng. */
function fhK3(v){ return Math.round((Number(v) || 0) * 1000) / 1000; }

/* The split of one bill.
     o.amt      the bill, as paid
     o.members  ids of the members who share (ticked)
     o.parts    how many shares the bill is cut into; ≥ members.length. Shares
                above the member count belong to people outside the space (S32)
     o.exact    optional { memberId: amount }: typed amounts win over equal parts
   Returns { ok, map, out, inside, parts, per, err }:
     map     { memberId: amount } for members only
     out     what the people outside owe the payer (0 when there are none)
     inside  amt − out: the amount the space itself records
   The đồng left over by rounding goes to the outside share when there is one
   (it is the payer's own receivable), otherwise to the last member. */
function fhSplitCompute(o){
  var amt = fhK3(o && o.amt), ids = ((o && o.members) || []).slice(), n = ids.length;
  if(!(amt > 0)) return { ok:false, err:'amount' };
  if(!n) return { ok:false, err:'members' };
  var map = {}, sum = 0, out = 0, parts = n, per = null;
  if(o.exact){
    ids.forEach(function(id){ var v = fhK3(o.exact[id]); if(v > 0){ map[id] = v; sum = fhK3(sum + v); } });
    if(!Object.keys(map).length) return { ok:false, err:'members' };
    out = fhK3(amt - sum);
    if(out < -0.0005) return { ok:false, err:'over', sum:sum };
    if(out < 0.0005) out = 0;
    parts = Object.keys(map).length + (out > 0 ? 1 : 0);
  } else {
    parts = Math.max(n, Math.round(Number(o.parts) || n));
    per = fhK3(amt / parts);
    ids.forEach(function(id, i){
      var v = (parts === n && i === n - 1) ? fhK3(amt - sum) : per;
      map[id] = v; sum = fhK3(sum + v);
    });
    out = parts > n ? fhK3(amt - sum) : 0;
  }
  return { ok:true, map:map, out:out, inside:fhK3(amt - out), parts:parts, per:per };
}
/* What is sealed into txn_shares.shares_enc. Keys starting with '_' are never
   member ids; the balance sum skips them. */
function fhSplitPayload(r, amt){
  var p = {}; Object.keys(r.map).forEach(function(k){ p[k] = r.map[k]; });
  if(r.out > 0){ p._out = r.out; p._parts = r.parts; p._bill = fhK3(amt); }
  return p;
}
function fhSplitMembers(map){ return Object.keys(map || {}).filter(function(k){ return k.charAt(0) !== '_'; }); }
/* The amount of a shared expense was edited: the same people still share it,
   in the same proportions (equal stays exactly equal), and an outside share
   scales with it. `newInside` is the amount the space row now carries. */
function fhSplitRescale(map, newInside){
  var ids = fhSplitMembers(map), amt = fhK3(newInside), old = 0;
  if(!ids.length || !(amt > 0)) return null;
  ids.forEach(function(id){ old += Number(map[id]) || 0; });
  var equal = ids.every(function(id){ return Math.abs((Number(map[id]) || 0) - (Number(map[ids[0]]) || 0)) < 0.002; });
  var out = {}, sum = 0;
  ids.forEach(function(id, i){
    var v = (i === ids.length - 1) ? fhK3(amt - sum) : fhK3((equal || !(old > 0)) ? amt / ids.length : amt * (Number(map[id]) || 0) / old);
    out[id] = v; sum = fhK3(sum + v);
  });
  if(Number(map._out) > 0 && old > 0){ out._out = fhK3(Number(map._out) * amt / old); out._parts = map._parts; out._bill = fhK3(amt + out._out); }
  return out;
}

/* Balances from raw rows (spec 5.2): net = paid − share + sent − received.
   Positive = the space owes this member. */
function fhSpaceBalancesOf(d){
  var by = {};
  (d.members || []).forEach(function(m){ by[m.id] = { member:m, paid:0, share:0, out:0, in:0 }; });
  (d.txns || []).forEach(function(t){
    if(t._unreadable) return;
    var s = d.shares && d.shares[t.id]; if(!s || !s.map) return;   // a Chung row moves no balance
    if(by[s.payer]) by[s.payer].paid += t.amt;
    fhSplitMembers(s.map).forEach(function(mid){ if(by[mid]) by[mid].share += Number(s.map[mid]) || 0; });
  });
  (d.settles || []).forEach(function(s){
    if(s._unreadable) return;
    if(by[s.from]) by[s.from].out += s.amt;
    if(by[s.to]) by[s.to].in += s.amt;
  });
  return (d.members || []).map(function(m){
    var b = by[m.id];
    return { member:m, net:fhK3(b.paid - b.share + b.out - b.in), paid:fhK3(b.paid), share:fhK3(b.share) };
  });
}
/* Who pays whom, fewest transfers first (greedy, largest first). */
function fhSpacePairwiseOf(bal){
  var cr = bal.filter(function(b){ return b.net > 0.0005; }).map(function(b){ return { m:b.member, v:b.net }; }).sort(function(a,b){ return b.v - a.v; });
  var db = bal.filter(function(b){ return b.net < -0.0005; }).map(function(b){ return { m:b.member, v:-b.net }; }).sort(function(a,b){ return b.v - a.v; });
  var out = [], i = 0, j = 0;
  while(i < db.length && j < cr.length){
    var x = fhK3(Math.min(db[i].v, cr[j].v));
    if(x > 0) out.push({ from:db[i].m, to:cr[j].m, amt:x });
    db[i].v = fhK3(db[i].v - x); cr[j].v = fhK3(cr[j].v - x);
    if(db[i].v < 0.0005) i++;
    if(cr[j].v < 0.0005) j++;
  }
  return out;
}

/* A stable UUID-shaped id from a string: the same space row and role give the
   same personal link on every device of the same person, so the book pass is
   idempotent without writing anything back to the space row. Not a secret and
   not a security boundary: it only has to be stable and not collide within one
   person's book (four independent 32-bit mixes). */
function fhSpaceLinkId(seed){
  var s = String(seed), h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for(var i = 0; i < s.length; i++){
    var c = s.charCodeAt(i);
    h[0] = Math.imul(h[0] ^ c, 16777619);
    h[1] = Math.imul(h[1] + c, 2246822519) ^ (h[1] >>> 13);
    h[2] = Math.imul(h[2] ^ (c + i), 3266489917) ^ (h[2] >>> 16);
    h[3] = Math.imul((h[3] << 5) - h[3] + c, 668265263) ^ (h[3] >>> 15);
  }
  for(var r = 0; r < 4; r++){ h[r] ^= h[(r + 1) % 4] >>> 11; h[r] = Math.imul(h[r], 2654435761); h[r] ^= h[r] >>> 15; }
  var hex = h.map(function(x){ return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-a' + hex.slice(17,20) + '-' + hex.slice(20,32);
}
var FH_SPACE_WHO = '@space:';
function fhSpaceWho(fid){ return FH_SPACE_WHO + fid; }
function fhIsSpaceWho(who){ return typeof who === 'string' && who.indexOf(FH_SPACE_WHO) === 0; }
function fhSpaceWhoFid(who){ return fhIsSpaceWho(who) ? who.slice(FH_SPACE_WHO.length) : null; }

/* The rows one member's own book should hold for one space (spec section 12).
   Sign convention is the lending one already in the book (19-personal.js):
     loan +X = I lent · loan −X = I borrowed
     repayment +X = they repaid me · repayment −X = I repaid
   Returns [{ link, role, kind, amt, date, who, note, catId, src }], where
   role is 'x' (my share), 'l' (my position against the space), 'o' (what
   people outside owe me), 's' (a settle-up). Chung rows are not planned here:
   today's mirror keeps handling them. */
function fhSpaceBookPlan(fid, myId, d){
  var rows = [];
  if(!fid || !myId || !d) return rows;
  var whoSp = fhSpaceWho(fid);
  (d.txns || []).forEach(function(t){
    if(t._unreadable) return;
    var s = d.shares && d.shares[t.id]; if(!s || !s.map) return;
    var mine = fhK3(s.map[myId]), paidByMe = s.payer === myId, out = fhK3(s.map._out);
    var base = { date:t.date, note:t.note || '', catId:t.catId || null, src:t.id, time:t.time || null };
    if(mine > 0) rows.push(Object.assign({ link:fhSpaceLinkId(t.id + ':x'), role:'x', kind:'expense', amt:mine, who:null }, base));
    if(paidByMe){
      var rest = fhK3(t.amt - mine);
      if(rest > 0) rows.push(Object.assign({ link:fhSpaceLinkId(t.id + ':l'), role:'l', kind:'loan', amt:rest, who:whoSp }, base));
      if(out > 0) rows.push(Object.assign({ link:fhSpaceLinkId(t.id + ':o'), role:'o', kind:'loan', amt:out, who:null }, base));
    } else if(mine > 0){
      rows.push(Object.assign({ link:fhSpaceLinkId(t.id + ':l'), role:'l', kind:'loan', amt:-mine, who:whoSp }, base));
    }
  });
  (d.settles || []).forEach(function(s){
    if(s._unreadable) return;
    var sign = s.from === myId ? -1 : (s.to === myId ? 1 : 0);
    if(!sign) return;
    rows.push({ link:fhSpaceLinkId(s.id + ':s'), role:'s', kind:'repayment', amt:fhK3(sign * s.amt), who:whoSp,
      date:s.date, note:s.note || '', catId:null, src:s.id, time:null });
  });
  return rows;
}
/* What the pass must do to get from the rows the book has to the plan.
   `have`  = [{ id, link, kind, amt, date }] — my book's rows for this space
   `since` = the oldest date the space read covers ('YYYY-MM-DD'), or null when
             it holds the space's whole history. A row older than that is never
             deleted: its space expense may simply not have been read. */
function fhSpaceBookDiff(plan, have, since){
  var want = {}, seen = {}, ins = [], upd = [], del = [];
  plan.forEach(function(p){ want[p.link] = p; });
  (have || []).forEach(function(h){
    if(!h.link) return;
    if(seen[h.link]){ del.push(h); return; }      // a duplicate of a link: the later one goes
    seen[h.link] = 1;
    var p = want[h.link];
    if(!p){ if(!since || (h.date && h.date >= since)) del.push(h); return; }
    if(Math.abs(fhK3(h.amt) - p.amt) > 0.0005 || h.date !== p.date || h.kind !== p.kind) upd.push({ have:h, want:p });
  });
  plan.forEach(function(p){ if(!seen[p.link]) ins.push(p); });
  return { ins:ins, upd:upd, del:del };
}

/* One line saying how a shared expense was counted, for a row or a card. */
function fhSplitLine(s, myId, fmtFn){
  if(!s || !s.map) return '';
  var n = fhSplitMembers(s.map).length, mine = Number(s.map[myId]) || 0, f = fmtFn || function(v){ return String(v); };
  var vi = (typeof isVi !== 'function') || isVi();
  return (vi ? 'chia ' : 'split ') + (s.map._parts || n) + (mine > 0 ? ' · ' + (vi ? 'bạn ' : 'you ') + f(mine) : '');
}

/* ── The space key, sealed to one invitee (spaces-spec section 21) ───────────
   A link cannot open an installed web app on an iPhone, so the key also
   travels this way: the owner's device seals the space's Key Card to the
   invitee's own public key (the X25519 half every account already has for
   sealed bank mail, personal_keys.staging_pub) and the server stores only that
   box. The invitee's device opens it with a private key that never leaves
   their personal safe.

   The box binds the space id and the invited email INSIDE it, so one moved
   onto another invitation is refused when opened. What it cannot prove is that
   the public key the server handed the owner really is the invitee's: `p`
   carries a short fingerprint of that key so the two people can compare
   ("mã xác nhận") if they want certainty.

   `naclLib` is passed in (window.nacl in the app, the vendored file in tests). */
function _spB64(bytes){ var s = ''; for(var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function _spBytes(b64){ var bin = atob(String(b64)), out = new Uint8Array(bin.length); for(var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function _spUtf8(str){ var e = unescape(encodeURIComponent(String(str))), out = new Uint8Array(e.length); for(var i = 0; i < e.length; i++) out[i] = e.charCodeAt(i); return out; }
function _spFromUtf8(bytes){ var s = ''; for(var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return decodeURIComponent(escape(s)); }
/* Six characters that name a public key: enough for two people to read to each
   other, not a secret. */
function fhSpaceKeyCode(pubB64){
  var id = fhSpaceLinkId('pub:' + String(pubB64 || '')).replace(/-/g, '').toUpperCase();
  return id.slice(0, 2) + '-' + id.slice(2, 4) + '-' + id.slice(4, 6);
}
function fhSpaceSealMake(naclLib, fid, email, card, pubB64){
  var pub = _spBytes(pubB64);
  if(pub.length !== 32) throw new Error('bad_pubkey');
  var eph = naclLib.box.keyPair(), nonce = naclLib.randomBytes(naclLib.box.nonceLength);
  var msg = _spUtf8(JSON.stringify({ v: 1, f: String(fid), m: String(email || '').toLowerCase().trim(), k: String(card) }));
  var box = naclLib.box(msg, nonce, pub, eph.secretKey);
  for(var i = 0; i < eph.secretKey.length; i++) eph.secretKey[i] = 0;
  return JSON.stringify({ v: 1, e: _spB64(eph.publicKey), n: _spB64(nonce), c: _spB64(box), p: fhSpaceKeyCode(pubB64) });
}
/* → { ok, card, code } or { ok:false, error }. `fid` is the space the caller
   believes this is for; a box made for another space is refused. */
function fhSpaceSealOpen(naclLib, sealedStr, privBytes, fid){
  var o;
  try{ o = JSON.parse(String(sealedStr)); }catch(e){ return { ok: false, error: 'format' }; }
  if(!o || o.v !== 1 || !o.e || !o.n || !o.c) return { ok: false, error: 'format' };
  var opened;
  try{ opened = naclLib.box.open(_spBytes(o.c), _spBytes(o.n), _spBytes(o.e), privBytes); }catch(e){ opened = null; }
  if(!opened) return { ok: false, error: 'not_for_this_key' };
  var m;
  try{ m = JSON.parse(_spFromUtf8(opened)); }catch(e){ return { ok: false, error: 'format' }; }
  if(!m || m.v !== 1 || !m.k) return { ok: false, error: 'format' };
  if(String(m.f) !== String(fid)) return { ok: false, error: 'other_space' };
  return { ok: true, card: m.k, email: m.m || '', code: o.p || '' };
}
/* An invite link, read: { fid, card (the opaque fragment value, or null), name }. */
function fhSpaceLinkParse(src){
  var s = String(src == null ? '' : src);
  var m = s.match(/[#&?]fh-s=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if(!m) return null;
  var k = s.match(/[#&]fh-k=([^&\s]+)/i), n = s.match(/[#&]fh-n=([^&\s]+)/i), name = '';
  if(n){ try{ name = decodeURIComponent(n[1]).slice(0, 60); }catch(e){ name = ''; } }
  return { fid: m[1].toLowerCase(), k: k ? k[1] : null, name: name };
}
/* The browsers that live inside another app and usually cannot finish a Google
   sign-in. Telegram and iMessage on iOS open a real Safari sheet and are not here. */
function fhInAppBrowser(ua){
  var u = String(ua || '');
  if(/Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|MicroMessenger|KAKAOTALK|Snapchat/i.test(u)) return true;
  return /; wv\)/.test(u);                                // an Android WebView
}