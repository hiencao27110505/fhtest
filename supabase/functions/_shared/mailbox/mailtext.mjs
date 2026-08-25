/**
 * Turning a bank email into text a parser can read.
 *
 * Bank mail is HTML, and not the tidy kind: a real MoMo receipt measured 4.5MB
 * of nested tables, inline CSS and tracking markup around about 2KB of actual
 * content. Handing that to a model is expensive and to a template matcher is
 * useless, so normalisation happens once, here, before anything else looks at
 * the body.
 *
 * THE FIELD BOUNDARY IS THE WHOLE PROBLEM. Bank mail lays its fields out in a
 * table, so what separates a label from its value is a cell boundary and
 * nothing else. Flatten the markup naively and `Tổng tiền` runs into the number
 * below it, giving `Tổng tiền 165.000đ Giá vé 165.000đ` where the template
 * anchors expect a line each. Every block-level tag therefore becomes a
 * newline, not a space.
 *
 * The mirror of that: when Gmail gives us `text/plain` there is no markup at
 * all and a line ending is the ONLY boundary there is, so newlines must survive
 * whitespace collapsing. `declutter` collapses spaces and blank runs but never
 * merges two lines into one.
 */

/** Tags whose content is markup, not text, and must not survive at all. */
const DROP = /<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Tags that end a line. A cell boundary is a field boundary. */
const BLOCK = /<\/?(br|p|div|tr|td|th|table|thead|tbody|li|ul|ol|h[1-6]|hr|blockquote|section|article|header|footer)\b[^>]*>/gi;

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  ndash: '-', mdash: '-', hellip: '...', middot: '·',
};

/** Decodes the entities bank mail actually uses, plus any numeric reference. */
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => _fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => _fromCode(parseInt(d, 10)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}

function _fromCode(n) {
  // A bad numeric entity is left as text rather than becoming U+FFFD: the
  // template matcher anchors on literal substrings, and a replacement character
  // in the middle of a label breaks an anchor that would otherwise have held.
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

/**
 * HTML to text, preserving the line structure the fields sit in.
 *
 * Not a parser. A regex sweep is the right tool here precisely because the
 * input is machine-generated mail with no user-authored markup in it, and
 * because nothing downstream cares about structure beyond "where do the lines
 * break".
 */
export function stripHtml(input) {
  let s = String(input || '');
  if (s.indexOf('<') === -1) return s;      // already text, leave it alone

  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(DROP, ' ');
  s = s.replace(BLOCK, '\n');
  s = s.replace(/<[^>]+>/g, ' ');           // every remaining tag: a space, not nothing
  return decodeEntities(s);
}

/**
 * Squeeze the whitespace without losing a line.
 *
 * Spaces and tabs collapse, three or more blank lines become one blank line,
 * trailing space per line goes. Two lines never become one: see the header.
 */
export function declutter(input) {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The whole normalisation, in the order the two steps have to run. */
export function toText(input) {
  return declutter(stripHtml(input));
}

/**
 * Gmail hands part bodies back base64url-encoded.
 *
 * Decoded as UTF-8 with replacement rather than throwing: a mail with one bad
 * byte is still a transaction, and refusing the whole message over it would
 * lose a row for a reason nobody could act on.
 */
export function decodeBase64Url(data) {
  if (!data) return '';
  const b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let bin;
  try { bin = atob(padded); } catch { return ''; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
