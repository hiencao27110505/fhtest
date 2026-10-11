/* Money-source faces (source-face-spec.md): the one mark a bank, a card or a
   wallet wears wherever the app names it. A monogram on the provider's own
   colour, both read from the provider registry (taxonomy/providers.json →
   FH_PROVIDERS, the `face` block). Nothing is fetched: which banks a person
   uses is theirs, and a logo request would say it to a third party.

   Every surface calls this file and nothing else, so what a face IS can change
   here (a glyph instead of a monogram, another shape) without touching a
   single call site.

   What a source wears, in order:
     1. its registry face, by provider_key (the account row stores it, 0150);
     2. the registry face its prose resolves to (an account from before 0150, a
        staged row's source_provider, a family row's instrument string);
     3. a monogram made from its own name, on the neutral fill: a provider the
        registry does not know, or an account the person named by hand;
     4. the kind's emoji on the neutral tint, for cash and for a position.
   A face never invents a colour. No colour in the registry means neutral.

   Three shapes, one per place (source-face-spec §2, decided after v628 put a
   7px letter inside a line of text):
     SQUARE  26px and up: the whole monogram. Tiles, titles, the setup screen.
     TAG     under 26px, inside a line of text or a chip: the whole monogram
             in a short tag, type never under 9.5px. It stands IN PLACE of the
             provider's name, never beside it.
     BADGE   on the corner of a list row's tile: one letter. The tile says
             where the money went, the badge says which account it moved. */
var FH_SRC_FACE = (function () {
  var HTML = {}, HTML_N = 0;
  function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function _R() { return window.FH_PROVIDERS || null; }
  function _up(c) { return c !== c.toLowerCase(); }
  /* A monogram for a name with no registry face: a short all-caps name is its
     own monogram (VIB, HSBC); several words give their initials (Home Credit →
     HC, Quỹ đen → QĐ); one long word gives its capitals (VietinBank → VB) or
     its first two letters (Techcombank → Te). Account tails are not a name. */
  function monoOf(name) {
    var s = String(name == null ? '' : name).replace(/[•·*]+\s*\d*/g, ' ').replace(/\d{3,}/g, ' ').trim();
    var words = s.split(/[\s\-_\/.,()]+/).filter(Boolean), i, out = '';
    if (!words.length) return '';
    if (words.length === 1) {
      var w = words[0];
      if (w.length <= 4 && w === w.toUpperCase()) return w;
      for (i = 0; i < w.length && out.length < 3; i++) { if (_up(w.charAt(i))) out += w.charAt(i); }
      return out.length >= 2 ? out : (w.charAt(0).toUpperCase() + w.charAt(1).toLowerCase());
    }
    for (i = 0; i < words.length && out.length < 3; i++) out += words[i].charAt(0).toUpperCase();
    return out;
  }
  function ofKey(key) {
    var R = _R(), p = R && key ? R.get(key) : null; if (!p || p.kind === 'receipt') return null;
    var f = p.face || {};
    return { mono: f.mono || monoOf(p.label), hex: f.hex || '', dk: !!f.dk, label: p.label };
  }
  /* Prose → a registry key, or ''. The whole string first, through the same
     fold account identity uses; then its leading word, so "VCB lương" and
     "Techcombank chung" (accounts a person named) still find their bank. A
     leading word under three letters is too short to trust on its own ("TP",
     "MB" are also ordinary abbreviations), so it is tried with its neighbour
     ("MB Bank lương") and otherwise left alone. */
  function keyOfProse(prose) {
    var R = _R(), s = String(prose == null ? '' : prose).trim(), k, w;
    if (!R || !s) return '';
    k = R.keyOf(s);
    if (!k && typeof window.fhAcctProviderKey === 'function') { k = window.fhAcctProviderKey(s); if (!R.get(k)) k = ''; }
    if (k) return k;
    w = s.replace(/[•·*]+\s*\d*/g, ' ').split(/\s+/).filter(Boolean);
    if (!w.length) return '';                                   // "VIB ••5140" is the one word VIB
    return (w.length > 1 ? R.keyOf(w[0] + ' ' + w[1]) : '') || (w[0].length >= 3 ? R.keyOf(w[0]) : '') || '';
  }
  function ofProse(prose) {
    var s = String(prose == null ? '' : prose).trim(); if (!s) return null;
    var f = ofKey(keyOfProse(s)); if (f) return f;
    var m = monoOf(s); return m ? { mono: m, hex: '', dk: false, label: s, own: true } : null;   // own: made from the name itself, not from the registry
  }
  var DOTS = '••', DOT_TAIL = /\s*[•*]+\s*\d{2,}$/;
  var EMOJI = { cash: '💵', investment: '📈' };
  /* An account object: { kind, providerKey, provider, name }. Also takes the
     looser shape a staged row's instrument has ({ kind, provider, tail }). */
  function ofAcct(a) {
    if (!a) return null;
    if (EMOJI[a.kind]) return { em: EMOJI[a.kind] };
    return ofKey(a.providerKey) || (a.provider ? ofProse(a.provider) : null) || ofProse(a.name) || null;
  }
  /* A display-grade instrument string, as a family row stores it: "VIB · tín
     dụng ••4512", an account's own name, or "Tiền mặt". */
  function ofInst(str) {
    var s = String(str == null ? '' : str).trim(); if (!s) return null;
    if (/^(tiền mặt|tien mat|cash)$/i.test(s)) return { em: EMOJI.cash };
    return ofProse(s.split(/\s+·\s+/)[0]);
  }
  /* One face. `size` in px. 26 and up is the SQUARE with the whole monogram.
     Under that it is the TAG: the whole monogram again, as wide as it needs,
     16px tall at least, so its type never drops under 9.5px. A monogram made
     from the name itself (`own`) gives no tag: it would only repeat, in grey,
     the first letters of the words printed right after it. `cls` adds classes
     ('in' = inline before text). */
  function html(f, size, cls) {
    if (!f) return '';
    size = size || 28;
    var tag = size < 26 && !f.em;
    if (tag && f.own) return '';
    if (tag && size < 16) size = 16;
    var txt = f.em || f.mono;
    var id = txt + '|' + (f.hex || '') + '|' + (f.dk ? 1 : 0) + '|' + size + '|' + (cls || '');
    if (HTML[id]) return HTML[id];
    var h = '<span class="sf' + (tag ? ' tg' : '') + (f.em ? ' em' : '') + (f.dk ? ' dk' : '') + (cls ? ' ' + cls : '') + '" style="--sfs:' + size + 'px'
      + (f.hex ? ';--sfh:#' + f.hex : '') + '"' + (tag ? '' : ' data-n="' + (f.em ? 'e' : txt.length) + '"') + ' aria-hidden="true">' + _esc(txt) + '</span>';
    if (HTML_N > 600) { HTML = {}; HTML_N = 0; }
    HTML[id] = h; HTML_N++;
    return h;
  }
  /* The BADGE on a list tile's corner: one letter (two when the monogram is
     two: MB, ZP), on the provider's colour. */
  function badge(f) {
    if (!f) return '';
    var txt = f.em || (f.mono.length > 2 ? f.mono.charAt(0) : f.mono);
    return '<span class="r-src' + (f.em ? ' em' : '') + (f.dk ? ' dk' : '') + '"' + (f.hex ? ' style="--sfh:#' + f.hex + '"' : '')
      + (!f.em && txt.length > 1 ? ' data-n="2"' : '') + ' aria-hidden="true">' + _esc(txt) + '</span>';
  }
  /* A name with the provider's own words taken off its front, because the tag
     already says them: "Vietcombank ••2279" → "••2279", "VCB lương" → "lương",
     "MoMo" → "". A name that does not start with them comes back whole. */
  function rest(f, name) {
    var s = String(name == null ? '' : name).trim(), low = s.toLowerCase(), c = [f && f.label, f && f.mono], i, w;
    for (i = 0; i < c.length; i++) {
      w = String(c[i] || '').toLowerCase();
      if (w && low.indexOf(w) === 0 && !/[a-z0-9\u00c0-\u1ef9]/i.test(low.charAt(w.length))) return s.slice(w.length).replace(/^[\s:\-]+/, '');
    }
    return s;
  }
  /* "••1217" for an account that has a number, else ''. */
  function tail(a) { var t = a && a.tail ? String(a.tail).replace(/\D/g, '').slice(-4) : ''; return t ? DOTS + t : ''; }
  /* An account's name without the number on its end: "VIB ••5140" → "VIB". */
  function shortName(a) {
    var n = String((a && a.name) || '').trim();
    return n.replace(DOT_TAIL, '').trim() || n;
  }
  function byId(id) {
    var pd = (typeof window.fhPersonalData === 'function') ? window.fhPersonalData() : null;
    var list = (pd && pd.accounts) || [], i;
    for (i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }
  return { monoOf: monoOf, ofKey: ofKey, ofProse: ofProse, ofAcct: ofAcct, ofInst: ofInst, keyOfProse: keyOfProse, html: html, badge: badge, rest: rest, tail: tail, shortName: shortName, byId: byId, esc: _esc };
})();
window.FH_SRC_FACE = FH_SRC_FACE;
/* The calls a surface makes. Each returns an HTML string, '' when there is
   nothing to show, so a caller can concatenate without a guard. */
function fhSrcFace(acct, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofAcct(acct), size, cls); }              // an account object
function fhSrcFaceId(acctId, size, cls) { return acctId ? fhSrcFace(FH_SRC_FACE.byId(acctId), size, cls) : ''; }    // an account id
function fhSrcFaceKey(key, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofKey(key), size, cls); }             // a registry key
function fhSrcFaceOf(prose, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofProse(prose), size, cls); }         // a provider as printed
function fhSrcFaceInst(inst, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofInst(inst), size, cls); }          // "VIB · tín dụng ••4512"
/* An account in a chip or a value: its tag, then what is left of its name once
   the provider's words are off the front ("VCB" + "••2279"). An account with
   no tag (cash, a hand-named account, an unknown bank) keeps its whole name.
   The name is escaped here, so pass it raw. */
function fhSrcLabel(acct, name) {
  var F = FH_SRC_FACE, f = F.ofAcct(acct), n = name != null ? name : (acct && acct.name) || '', t = F.html(f, 18, 'in');
  return t + F.esc((t && f && !f.em) ? F.rest(f, n) : n);
}
/* A family row's instrument string ("VIB · tín dụng ••4512"): the tag, then
   the words after the provider. Unknown provider: the string as it is. */
function fhSrcInstLabel(inst) {
  var F = FH_SRC_FACE, s = String(inst == null ? '' : inst), f = F.ofInst(s), t = F.html(f, 18, 'in'), i;
  if (!t || f.em) return t + F.esc(s);
  i = s.search(/\s+\u00b7\s+/);
  return t + F.esc(i > 0 ? s.slice(i).replace(/^\s+\u00b7\s+/, '') : F.rest(f, s));
}
/* A provider named on its own (the queue card's top line, the peek card):
   its tag when the registry has its colour, else `shown` as plain text. */
function fhSrcName(prose, shown) {
  var F = FH_SRC_FACE, f = F.ofProse(prose);
  return (f && f.hex && !f.own) ? F.html(f, 16, 'nm') : F.esc(shown != null ? shown : (prose || ''));
}
/* ── list rows (source-face-spec §3) ──────────────────────────────────────────
   The badge for a row's tile corner: the account the row moves. */
function fhSrcBadge(acct) { return FH_SRC_FACE.badge(FH_SRC_FACE.ofAcct(acct)); }
/* What the subline says about that account, as text: its four digits; an
   account with no number says its name; cash says nothing, its badge did. */
function fhSrcRowSub(acct) {
  if (!acct || acct.kind === 'cash') return '';
  return FH_SRC_FACE.tail(acct) || String(acct.name || '').trim();
}
/* "VIB → Vietcombank": the two ends of a transfer by name, numbers left off
   unless the names alone would read the same. '' when an end is unknown. */
function fhSrcXferTitle(from, to) {
  if (!from || !to) return '';
  var F = FH_SRC_FACE, a = F.shortName(from), b = F.shortName(to);
  return (a && b && a !== b) ? a + ' \u2192 ' + b : String(from.name || '') + ' \u2192 ' + String(to.name || '');
}
/* The tile of a row that moves money between accounts: neutral, two arrows.
   Never a bank's face at tile size; that reads as the shop that was paid. */
var FH_SRC_XFER_TILE = '<div class="r-ico personal-ico xf"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/></svg></div>';
window.FH_SRC_XFER_TILE = FH_SRC_XFER_TILE;
window.fhSrcInstLabel = fhSrcInstLabel; window.fhSrcName = fhSrcName; window.fhSrcBadge = fhSrcBadge;
window.fhSrcRowSub = fhSrcRowSub; window.fhSrcXferTitle = fhSrcXferTitle;
window.fhSrcFace = fhSrcFace; window.fhSrcFaceId = fhSrcFaceId; window.fhSrcFaceKey = fhSrcFaceKey;
window.fhSrcFaceOf = fhSrcFaceOf; window.fhSrcFaceInst = fhSrcFaceInst; window.fhSrcLabel = fhSrcLabel;