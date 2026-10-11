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
   A face never invents a colour. No colour in the registry means neutral. */
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
    var m = monoOf(s); return m ? { mono: m, hex: '', dk: false, label: s } : null;
  }
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
  /* One face. `size` in px: 26 and up shows the whole monogram in a square;
     under that the face sits inside a line of text beside the name it belongs
     to, so it shows one letter (two when the monogram IS two: MB, ZP) and the
     colour does the rest. `cls` adds classes ('in' = inline before a name). */
  function html(f, size, cls) {
    if (!f) return '';
    size = size || 28;
    var txt = f.em || ((size < 26 && f.mono.length > 2) ? f.mono.charAt(0) : f.mono);
    var id = txt + '|' + (f.hex || '') + '|' + (f.dk ? 1 : 0) + '|' + size + '|' + (cls || '');
    if (HTML[id]) return HTML[id];
    var h = '<span class="sf' + (f.em ? ' em' : '') + (f.dk ? ' dk' : '') + (cls ? ' ' + cls : '') + '" style="--sfs:' + size + 'px'
      + (f.hex ? ';--sfh:#' + f.hex : '') + '" data-n="' + (f.em ? 'e' : txt.length) + '" aria-hidden="true">' + _esc(txt) + '</span>';
    if (HTML_N > 600) { HTML = {}; HTML_N = 0; }
    HTML[id] = h; HTML_N++;
    return h;
  }
  function byId(id) {
    var pd = (typeof window.fhPersonalData === 'function') ? window.fhPersonalData() : null;
    var list = (pd && pd.accounts) || [], i;
    for (i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }
  return { monoOf: monoOf, ofKey: ofKey, ofProse: ofProse, ofAcct: ofAcct, ofInst: ofInst, keyOfProse: keyOfProse, html: html, byId: byId, esc: _esc };
})();
window.FH_SRC_FACE = FH_SRC_FACE;
/* The calls a surface makes. Each returns an HTML string, '' when there is
   nothing to show, so a caller can concatenate without a guard. */
function fhSrcFace(acct, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofAcct(acct), size, cls); }              // an account object
function fhSrcFaceId(acctId, size, cls) { return acctId ? fhSrcFace(FH_SRC_FACE.byId(acctId), size, cls) : ''; }    // an account id
function fhSrcFaceKey(key, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofKey(key), size, cls); }             // a registry key
function fhSrcFaceOf(prose, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofProse(prose), size, cls); }         // a provider as printed
function fhSrcFaceInst(inst, size, cls) { return FH_SRC_FACE.html(FH_SRC_FACE.ofInst(inst), size, cls); }          // "VIB · tín dụng ••4512"
/* The face and the name together, for a chip or a value: the name is escaped
   here, so pass it raw. */
function fhSrcLabel(acct, name) { return fhSrcFace(acct, 18, 'in') + FH_SRC_FACE.esc(name != null ? name : (acct && acct.name) || ''); }
/* The 42px list tile of a row that moves money BETWEEN sources: the account
   it left, with the account it reached overlapping its corner. One account
   known (a card payment tagged to its card) gives that one face, full size.
   '' when neither resolves, so the caller keeps its own tile. */
function fhSrcPairTile(fromAcct, toAcct) {
  var a = FH_SRC_FACE.ofAcct(fromAcct), b = FH_SRC_FACE.ofAcct(toAcct);
  if (a && b) return '<div class="r-ico sfp">' + FH_SRC_FACE.html(a, 25) + FH_SRC_FACE.html(b, 25) + '</div>';
  return (a || b) ? FH_SRC_FACE.html(a || b, 42, 'r-ico') : '';
}
window.fhSrcPairTile = fhSrcPairTile;
window.fhSrcFace = fhSrcFace; window.fhSrcFaceId = fhSrcFaceId; window.fhSrcFaceKey = fhSrcFaceKey;
window.fhSrcFaceOf = fhSrcFaceOf; window.fhSrcFaceInst = fhSrcFaceInst; window.fhSrcLabel = fhSrcLabel;