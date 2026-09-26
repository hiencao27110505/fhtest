/* DOM lint, evaluated inside the page after each shot. Deterministic, cheap,
   catches the mechanical half of what the design and i18n reviewers look for:
     targets   — visible tappable elements under 44×44 CSS px (and no tappable ancestor that is big enough)
     overflow  — leaf text that spills past its box without an ellipsis, and any horizontal page scroll
     language  — Vietnamese text visible in English mode (fixture user-data strings are excluded)
   Returns { targets:[], overflow:[], language:[], pageScroll:boolean }. Informational by default;
   shots.js --strict turns a non-empty result into a failure. */
function domLint(opts) {
  opts = opts || {};
  const MIN = 44, out = { targets: [], overflow: [], language: [], pageScroll: false };
  const vw = window.innerWidth, vh = window.innerHeight;
  const where = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return t ? s + ' "' + t + '"' : s;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
    // hidden inside a closed sheet/modal/overlay: some ancestor is invisible
    let p = el.parentElement;
    while (p && p !== document.body) { const pc = getComputedStyle(p); if (pc.display === 'none' || pc.visibility === 'hidden' || Number(pc.opacity) === 0) return false; p = p.parentElement; }
    return true;
  };
  const tappable = 'button, a[href], [onclick], [role="button"], input:not([type="hidden"]), select, textarea, summary';
  const seen = new Set();
  document.querySelectorAll(tappable).forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width >= MIN && r.height >= MIN) return;
    if (r.width >= MIN && r.height >= 34 && el.matches('input, select, textarea')) return;   // text fields: width is what matters
    let anc = el.parentElement, covered = false;
    while (anc && anc !== document.body) { if (anc.matches(tappable)) { const ar = anc.getBoundingClientRect(); if (ar.width >= MIN && ar.height >= MIN) { covered = true; break; } } anc = anc.parentElement; }
    if (covered) return;
    const key = where(el); if (seen.has(key)) return; seen.add(key);
    out.targets.push({ el: key, w: Math.round(r.width), h: Math.round(r.height) });
  });
  out.pageScroll = document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.children.length) continue;
    if (!(n.textContent || '').trim()) continue;
    if (!visible(n)) continue;
    const cs = getComputedStyle(n);
    if (n.scrollWidth > n.clientWidth + 2 && cs.overflowX === 'visible' && cs.whiteSpace !== 'normal' && cs.textOverflow !== 'ellipsis') {
      out.overflow.push({ el: where(n), by: n.scrollWidth - n.clientWidth });
    }
  }
  if (opts.lang === 'en') {
    const vi = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/;
    const skip = new Set(opts.userStrings || []);
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let t, found = new Set();
    while ((t = tw.nextNode())) {
      const txt = (t.nodeValue || '').trim();
      if (!txt || !vi.test(txt)) continue;
      const el = t.parentElement; if (!el || !visible(el)) continue;
      if (el.closest('[lang="vi"], [data-user-text]')) continue;
      if ([...skip].some((s) => txt.includes(s))) continue;
      const key = where(el) + '|' + txt.slice(0, 40); if (found.has(key)) continue; found.add(key);
      out.language.push({ el: where(el), text: txt.slice(0, 60) });
    }
  }
  return out;
}
module.exports = { domLint };
