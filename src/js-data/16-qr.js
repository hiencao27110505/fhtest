  /* ═══ Minimal QR encoder (byte mode, EC level L, versions 1-5) ══════════════
     Repo forbids a CDN, so this is a compact self-contained encoder for the
     card URL (~75 bytes → version 4). Validated offline: Reed-Solomon matches
     the ISO/IEC 18004 reference vector, the format-info BCH matches the known
     L-mask table, and finder/timing structure checks out. Single-block only
     (v1-5 EC-L), so no interleaving; one alignment pattern (v2-5). */
  const _QR_EXP = new Uint8Array(512), _QR_LOG = new Uint8Array(256);
  (() => { let x = 1; for (let i = 0; i < 255; i++) { _QR_EXP[i] = x; _QR_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) _QR_EXP[i] = _QR_EXP[i - 255]; })();
  const _qrMul = (a, b) => (a === 0 || b === 0) ? 0 : _QR_EXP[_QR_LOG[a] + _QR_LOG[b]];
  function _qrGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= _qrMul(g[j], _QR_EXP[i]); } g = ng; } return g; }
  function _qrRs(data, n) { const g = _qrGen(n); const res = new Array(n).fill(0); for (const d of data) { const f = d ^ res[0]; res.shift(); res.push(0); if (f !== 0) for (let j = 0; j < n; j++) res[j] ^= _qrMul(g[j + 1], f); } return res; }
  const _QR_DATACW = [0, 19, 34, 55, 80, 108], _QR_ECCW = [0, 7, 10, 15, 20, 26], _QR_ALIGN = [0, 0, 18, 22, 26, 30];
  function _qrEncodeData(bytes, v) {
    const cap = _QR_DATACW[v] * 8, bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4); push(bytes.length, 8); for (const b of bytes) push(b, 8);
    push(0, Math.max(0, Math.min(4, cap - bits.length)));
    while (bits.length % 8) bits.push(0);
    let pad = 0xEC; while (bits.length < cap) { push(pad, 8); pad = pad === 0xEC ? 0x11 : 0xEC; }
    const cw = []; for (let i = 0; i < bits.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; cw.push(x); }
    return cw.concat(_qrRs(cw, _QR_ECCW[v]));
  }
  function _qrFmt(mask) {
    const data5 = (1 << 3) | mask;   // EC L = 01, then 3-bit mask
    let g = data5 << 10; const poly = 0b10100110111;
    for (let i = 14; i >= 10; i--) if ((g >> i) & 1) g ^= poly << (i - 10);
    return ((data5 << 10) | g) ^ 0b101010000010010;
  }
  // text → { matrix (0/1 grid), size }
  function _qrBuild(bytes) {
    let v = 1; while (v < 5 && _QR_DATACW[v] < Math.ceil((4 + 8 + bytes.length * 8) / 8)) v++;
    const size = 17 + 4 * v, cw = _qrEncodeData(bytes, v);
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (r, c, val) => { m[r][c] = val ? 1 : 0; fn[r][c] = true; };
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const rr = r + i, cc = c + j; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue; const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4); setF(rr, cc, on); } };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { const b = (i % 2 === 0) ? 1 : 0; setF(6, i, b); setF(i, 6, b); }
    setF(size - 8, 8, 1);
    if (_QR_ALIGN[v]) { const a = _QR_ALIGN[v]; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) setF(a + i, a + j, Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0); }
    for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    const allBits = []; for (const c of cw) for (let i = 7; i >= 0; i--) allBits.push((c >> i) & 1);
    let bi = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) { if (col === 6) col--; for (let k = 0; k < size; k++) { const row = up ? size - 1 - k : k; for (let dc = 0; dc < 2; dc++) { const cc = col - dc; if (fn[row][cc]) continue; m[row][cc] = bi < allBits.length ? allBits[bi++] : 0; } } up = !up; }
    const maskFn = [(r, c) => (r + c) % 2 === 0, (r, c) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
    function penalty(mm) { let p = 0; for (let r = 0; r < size; r++) { let rc = 1, cc = 1; for (let c = 1; c < size; c++) { if (mm[r][c] === mm[r][c - 1]) rc++; else { if (rc >= 5) p += 3 + (rc - 5); rc = 1; } if (mm[c][r] === mm[c - 1][r]) cc++; else { if (cc >= 5) p += 3 + (cc - 5); cc = 1; } } if (rc >= 5) p += 3 + (rc - 5); if (cc >= 5) p += 3 + (cc - 5); } return p; }
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mm = m.map((r) => r.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && maskFn[mask](r, c)) mm[r][c] ^= 1;
      const f = _qrFmt(mask);
      for (let i = 0; i < 15; i++) { const bit = (f >> i) & 1; if (i < 6) mm[i][8] = bit; else if (i < 8) mm[i + 1][8] = bit; else if (i === 8) mm[8][7] = bit; else mm[8][14 - i] = bit; if (i < 8) mm[8][size - 1 - i] = bit; else mm[size - 15 + i][8] = bit; }
      const p = penalty(mm); if (p < bestP) { bestP = p; best = mm; }
    }
    return { matrix: best, size };
  }
  // Render the QR for `text` onto a fresh <canvas> (white quiet zone + black modules).
  window.fhQrCanvas = function (text, scale, quiet) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const q = _qrBuild(bytes); scale = scale || 6; quiet = quiet == null ? 4 : quiet;
    const dim = (q.size + quiet * 2) * scale;
    const cv = document.createElement('canvas'); cv.width = dim; cv.height = dim;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, dim, dim); cx.fillStyle = '#000';
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.matrix[r][c]) cx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    return cv;
  };