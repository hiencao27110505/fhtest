  /* ═══ Password-protected .xlsx — opened on the device ═════════════════════
     A locked workbook isn't a ZIP: Office puts the encrypted spreadsheet
     inside an OLE2 compound file next to a description of how it was locked.
     So this does two jobs the browser can't do for us -- walk that container,
     then run the ECMA-376 "agile" key derivation -- and hands 42-xlsx-parse.js
     an ordinary .xlsx buffer, which is why the reader needs no changes.

     Why bother, when "open it in Excel and save a copy without the password"
     is one sentence: that sentence needs a desktop with Excel. Bank statements
     here arrive as an email attachment, on a phone, locked with a phone number
     or a date of birth. For those people the instruction isn't a workaround,
     it's a dead end. Typing the password they already have is the short path.

     The password is used here and thrown away. It never goes to the network,
     never lands in storage -- the same rule the rest of the import follows.

     Scope: agile encryption (Office 2010+, AES + SHA-512), which is what
     current Excel and bank exports produce. The 2007-era scheme and legacy
     .xls RC4 are different formats and are reported as unsupported rather
     than half-attempted.

     WHERE THE WORK RUNS (device-heat fix, approach C). The key derivation is
     100,000 chained hashes by design: that is what makes a guessed password
     slow. The first version awaited crypto.subtle.digest 100,000 times in a
     row, each a round trip into the browser's crypto thread and back, on the
     main thread -- a phone spent several seconds at 100% with the screen
     frozen. Now the hashes are plain synchronous JavaScript (_xdMath: SHA-1,
     SHA-256, SHA-384, SHA-512, checked against WebCrypto in
     tools/xlsx-hash.test.js), and the whole unlock -- spin, verifier, package
     -- runs in a Web Worker built from a Blob URL of _xdMath's own source, so
     the screen keeps painting. Where a worker cannot be made the same
     function runs here, on the main thread; the maths has one home either
     way. */

  const CFB_END = 0xFFFFFFFE;                     // ENDOFCHAIN

  // --- OLE2 / CFB: the container -> { streamName: Uint8Array } --------------
  function _cfbRead(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const sectorSize = 1 << dv.getUint16(0x1E, true);
    const miniSize = 1 << dv.getUint16(0x20, true);
    const nFat = dv.getUint32(0x2C, true);
    const dirStart = dv.getUint32(0x30, true);
    const miniCutoff = dv.getUint32(0x38, true);
    const miniFatStart = dv.getUint32(0x3C, true);
    const difatStart = dv.getUint32(0x44, true);
    const nDifat = dv.getUint32(0x48, true);
    const sectorAt = (id) => (id + 1) * sectorSize;   // the header owns sector -1

    // DIFAT -> the list of sectors that hold the FAT itself.
    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) {
      const id = dv.getUint32(0x4C + i * 4, true);
      if (id < CFB_END) fatSectors.push(id);
    }
    let next = difatStart;
    for (let n = 0; n < nDifat && next < CFB_END; n++) {
      const base = sectorAt(next), perSector = sectorSize / 4 - 1;
      for (let i = 0; i < perSector && fatSectors.length < nFat; i++) {
        const id = dv.getUint32(base + i * 4, true);
        if (id < CFB_END) fatSectors.push(id);
      }
      next = dv.getUint32(base + perSector * 4, true);
    }

    const fat = [];
    fatSectors.forEach((s) => {
      const base = sectorAt(s);
      for (let i = 0; i < sectorSize / 4; i++) fat.push(dv.getUint32(base + i * 4, true));
    });

    /* Follow a chain and concatenate its sectors ONCE, sized by the walk itself
       (or by the directory entry's size when there is one). The first version
       zero-filled a 4 MiB array for the directory and another for the mini-FAT
       whatever the file held, twice per attempt; a statement is a few hundred KB. */
    const chain = (start, size) => {
      const parts = [];
      const limit = (size == null) ? Infinity : size;
      let at = 0, id = start, guard = 0;
      while (id < CFB_END && at < limit && guard++ <= fat.length) {
        const from = sectorAt(id);
        const take = Math.min(sectorSize, limit - at, u8.length - from);
        if (take <= 0) break;
        parts.push(u8.subarray(from, from + take));
        at += take;
        id = fat[id];
        if (id === undefined) break;
      }
      if (parts.length === 1) return parts[0].slice();
      const out = new Uint8Array(at);
      let p = 0; parts.forEach((s) => { out.set(s, p); p += s.length; });
      return out;
    };

    // Directory entries, 128 bytes each.
    const dirBytes = chain(dirStart, null);
    const entries = [];
    for (let p = 0; p + 128 <= dirBytes.length; p += 128) {
      const nameLen = dirBytes[p + 0x40] | (dirBytes[p + 0x41] << 8);
      const type = dirBytes[p + 0x42];
      if (type !== 2 && type !== 5) { if (type === 0) break; continue; }
      let name = '';
      for (let i = 0; i + 1 < Math.max(0, nameLen - 2); i += 2) {
        name += String.fromCharCode(dirBytes[p + i] | (dirBytes[p + i + 1] << 8));
      }
      const dvd = new DataView(dirBytes.buffer, dirBytes.byteOffset + p, 128);
      entries.push({ name: name, type: type,
                     start: dvd.getUint32(0x74, true),
                     size: dvd.getUint32(0x78, true) });   // >4GB is not a thing here
    }

    // Small streams live packed inside the root entry's mini stream.
    const root = entries.filter((e) => e.type === 5)[0];
    let miniData = null;
    const miniStream = () => {
      if (!miniData && root) miniData = chain(root.start, root.size);
      return miniData;
    };
    let miniFat = null;
    const miniFatTable = () => {
      if (!miniFat) {
        // Sized by the mini-FAT chain's real length: one entry per 4 bytes it holds.
        const raw = chain(miniFatStart, null);
        const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        miniFat = new Uint32Array(raw.length >> 2);
        for (let i = 0; i < miniFat.length; i++) miniFat[i] = d.getUint32(i * 4, true);
      }
      return miniFat;
    };

    const out = {};
    entries.forEach((e) => {
      if (e.type !== 2) return;
      if (e.size < miniCutoff) {
        const mini = miniStream(), mf = miniFatTable();
        if (!mini) return;
        const bytes = new Uint8Array(e.size);
        let at = 0, id = e.start, guard = 0;
        while (id < CFB_END && at < e.size && guard++ <= mf.length) {
          const take = Math.min(miniSize, e.size - at);
          bytes.set(mini.subarray(id * miniSize, id * miniSize + take), at);
          at += take; id = mf[id];
          if (id === undefined) break;
        }
        out[e.name] = bytes;
      } else {
        out[e.name] = chain(e.start, e.size);
      }
    });
    return out;
  }

  // --- helpers --------------------------------------------------------------
  function _xdB64(s) {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function _utf16le(s) {
    const u = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = c >> 8; }
    return u;
  }
  const _HASH = { SHA512: 'SHA-512', SHA384: 'SHA-384', SHA256: 'SHA-256', SHA1: 'SHA-1' };

  /* ═══ The maths, in one self-contained function ═══════════════════════════
     Everything the unlock needs after the container and the XML are read:
     the four hashes, the spin, the AES-CBC steps, the verifier and the
     package. It refers to NOTHING outside itself (only `crypto`, which both a
     window and a worker have), because its source text IS the worker script:
     '(' + _xdMath.toString() + ')().serve(self)'. The main thread calls the
     same object directly when no worker can be made. Keep it that way: a
     reference to an outer helper would work here and throw in the worker.

     The hashes are written out rather than asked of WebCrypto because the spin
     is 100,000 of them in a chain, and an awaited digest costs a round trip to
     another thread each time. Synchronous, the whole spin is a few hundred
     milliseconds on a phone. SHA-512 is done with 32-bit halves (no BigInt):
     each 64-bit add sums the unsigned low halves in a double, carries once. */
  function _xdMath() {
    'use strict';
    const K256 = new Int32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const IV256 = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    // 64-bit words as (hi, lo) pairs.
    const K512 = new Int32Array([
      0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
      0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
      0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
      0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
      0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
      0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
      0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
      0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
      0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
      0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
      0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
      0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
      0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
      0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
      0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
      0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
      0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
      0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
      0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
      0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817]);
    const IV512 = new Int32Array([
      0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
      0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179]);
    const IV384 = new Int32Array([
      0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
      0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4]);

    // Merkle-Damgård padding: 0x80, zeros, big-endian bit length in the last `lenBytes`.
    function padded(m, block, lenBytes) {
      const l = m.length, n = Math.ceil((l + 1 + lenBytes) / block) * block;
      const b = new Uint8Array(n); b.set(m); b[l] = 0x80;
      const dv = new DataView(b.buffer);
      dv.setUint32(n - 8, Math.floor(l / 536870912));       // bits >>> 32
      dv.setUint32(n - 4, (l * 8) >>> 0);
      return { b: b, dv: dv, n: n };
    }

    function sha1(m) {
      const p = padded(m, 64, 8), dv = p.dv;
      let h0 = 0x67452301, h1 = 0xEFCDAB89 | 0, h2 = 0x98BADCFE | 0, h3 = 0x10325476, h4 = 0xC3D2E1F0 | 0;
      const w = new Int32Array(80);
      for (let off = 0; off < p.n; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
        for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let i = 0; i < 80; i++) {
          let f, k;
          if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
          else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
          else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC | 0; }
          else { f = b ^ c ^ d; k = 0xCA62C1D6 | 0; }
          const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
          e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
      }
      const out = new Uint8Array(20), o = new DataView(out.buffer);
      o.setInt32(0, h0); o.setInt32(4, h1); o.setInt32(8, h2); o.setInt32(12, h3); o.setInt32(16, h4);
      return out;
    }

    function sha256(m) {
      const p = padded(m, 64, 8), dv = p.dv;
      const H = new Int32Array(IV256), w = new Int32Array(64);
      for (let off = 0; off < p.n; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
        for (let i = 16; i < 64; i++) {
          const x = w[i - 15], y = w[i - 2];
          const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
          const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
          const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
          const ch = (e & f) ^ (~e & g);
          const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
          const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (S0 + maj) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }
      const out = new Uint8Array(32), o = new DataView(out.buffer);
      for (let i = 0; i < 8; i++) o.setInt32(i * 4, H[i]);
      return out;
    }

    function sha512core(m, IV, outLen) {
      const p = padded(m, 128, 16), dv = p.dv;
      const H = new Int32Array(IV), wh = new Int32Array(80), wl = new Int32Array(80);
      const T = 4294967296;
      for (let off = 0; off < p.n; off += 128) {
        for (let i = 0; i < 16; i++) { wh[i] = dv.getInt32(off + i * 8); wl[i] = dv.getInt32(off + i * 8 + 4); }
        for (let i = 16; i < 80; i++) {
          const xh = wh[i - 15], xl = wl[i - 15], yh = wh[i - 2], yl = wl[i - 2];
          // σ0 = rotr1 ^ rotr8 ^ shr7
          const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
          const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
          // σ1 = rotr19 ^ rotr61 ^ shr6   (rotr61 = swap halves, rotr29)
          const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
          const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
          const lo = (wl[i - 16] >>> 0) + (s0l >>> 0) + (wl[i - 7] >>> 0) + (s1l >>> 0);
          wh[i] = (wh[i - 16] + s0h + wh[i - 7] + s1h + Math.floor(lo / T)) | 0;
          wl[i] = lo | 0;
        }
        let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
        let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
        for (let i = 0; i < 80; i++) {
          // Σ1 = rotr14 ^ rotr18 ^ rotr41   (rotr41 = swap halves, rotr9)
          const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
          const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
          const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
          let lo = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i * 2 + 1] >>> 0) + (wl[i] >>> 0);
          const t1h = (hh + S1h + chh + K512[i * 2] + wh[i] + Math.floor(lo / T)) | 0, t1l = lo | 0;
          // Σ0 = rotr28 ^ rotr34 ^ rotr39   (rotr34 = swap, rotr2; rotr39 = swap, rotr7)
          const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
          const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
          const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
          lo = (t1l >>> 0) + (S0l >>> 0) + (mjl >>> 0);
          const t2h = (t1h + S0h + mjh + Math.floor(lo / T)) | 0, t2l = lo | 0;
          hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
          lo = (dl >>> 0) + (t1l >>> 0);
          eh = (dh + t1h + Math.floor(lo / T)) | 0; el = lo | 0;
          dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
          ah = t2h; al = t2l;
        }
        const add = (k, xh, xl) => { const lo = (H[k + 1] >>> 0) + (xl >>> 0); H[k] = (H[k] + xh + Math.floor(lo / T)) | 0; H[k + 1] = lo | 0; };
        add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
      }
      const out = new Uint8Array(64), o = new DataView(out.buffer);
      for (let i = 0; i < 16; i++) o.setInt32(i * 4, H[i]);
      return outLen === 64 ? out : out.subarray(0, outLen);
    }
    const sha512 = (m) => sha512core(m, IV512, 64);
    const sha384 = (m) => sha512core(m, IV384, 48);
    const hashers = { 'SHA-1': sha1, 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 };

    function cat() {
      const parts = [].slice.call(arguments);
      let n = 0; parts.forEach((p) => { n += p.length; });
      const out = new Uint8Array(n);
      let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; });
      return out;
    }
    function le32(n) { return new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]); }

    /* H = hash(salt || password), then hash(counter || H), spinCount times. One
       reused input buffer; the counter is little-endian per the spec. */
    function spin(hashName, salt, pwUtf16, count) {
      const H = hashers[hashName]; if (!H) throw new Error('xlsx_enc_unsupported');
      let h = H(cat(salt, pwUtf16));
      const buf = new Uint8Array(4 + h.length);
      for (let i = 0; i < count; i++) {
        buf[0] = i & 255; buf[1] = (i >>> 8) & 255; buf[2] = (i >>> 16) & 255; buf[3] = (i >>> 24) & 255;
        buf.set(h, 4);
        h = H(buf);
      }
      return h;
    }

    /* WebCrypto's AES-CBC always wants PKCS#7 padding; this format has none. So
       append one block that decrypts to a full pad -- E(0x10*16 XOR lastBlock),
       which is exactly the first block AES-CBC encryption produces when seeded
       with lastBlock as the IV -- and let WebCrypto strip it back off. */
    async function aesCbcNoPad(keyBytes, iv, data) {
      const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt']);
      const last = data.subarray(data.length - 16);
      const padBlock = new Uint8Array(16).fill(16);
      const seeded = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, k, padBlock));
      const ext = cat(data, seeded.subarray(0, 16));
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, ext));
    }

    // Block keys are fixed by the spec; each derives a different key from the same password.
    const BK_VERIFIER_IN = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
    const BK_VERIFIER_VAL = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
    const BK_KEY_VALUE = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

    /* job = { hash, pwSalt, pw (UTF-16LE bytes), spin, keyLen, verIn, verVal,
       keyVal, kdSalt, blockSize, total, pkg (the EncryptedPackage stream) }
       -> the plain .xlsx bytes. Throws 'bad_password' when the verifier says
       so, which is a real check -- not a guess from whether the output happens
       to look like a ZIP. */
    async function unlock(j) {
      const H = hashers[j.hash]; if (!H) throw new Error('xlsx_enc_unsupported');
      const h = spin(j.hash, j.pwSalt, j.pw, j.spin);
      const keyFor = (bk) => H(cat(h, bk)).subarray(0, j.keyLen);

      // The verifier: decrypt a known value two ways and see if they agree.
      const vIn = await aesCbcNoPad(keyFor(BK_VERIFIER_IN), j.pwSalt, j.verIn);
      const vVal = await aesCbcNoPad(keyFor(BK_VERIFIER_VAL), j.pwSalt, j.verVal);
      const expect = H(vIn);
      for (let i = 0; i < expect.length; i++) if (expect[i] !== vVal[i]) throw new Error('bad_password');

      const secret = (await aesCbcNoPad(keyFor(BK_KEY_VALUE), j.pwSalt, j.keyVal)).subarray(0, j.keyLen);

      // The package is encrypted in 4096-byte segments, each with its own IV.
      const body = j.pkg.subarray(8);
      const out = new Uint8Array(j.total);
      let at = 0;
      for (let seg = 0; seg * 4096 < body.length; seg++) {
        const chunk = body.subarray(seg * 4096, Math.min((seg + 1) * 4096, body.length));
        const iv = H(cat(j.kdSalt, le32(seg))).subarray(0, j.blockSize);
        const plain = await aesCbcNoPad(secret, iv, chunk);
        const take = Math.min(plain.length, j.total - at);
        if (take <= 0) break;
        out.set(plain.subarray(0, take), at);
        at += take;
      }
      return out;
    }

    // Inside a worker: one message in ({ id, job }), one message out ({ id, ok, out | err }).
    function serve(scope) {
      scope.onmessage = async (ev) => {
        const d = ev.data || {};
        try { const out = await unlock(d.job); scope.postMessage({ id: d.id, ok: true, out: out }, [out.buffer]); }
        catch (e) { scope.postMessage({ id: d.id, ok: false, err: String((e && e.message) || e) }); }
      };
    }
    return { hash: hashers, spin: spin, unlock: unlock, aesCbcNoPad: aesCbcNoPad, serve: serve };
  }
  const _XD = _xdMath();

  /* ── the worker host ─────────────────────────────────────────────────────
     One worker, made on first use from a Blob URL of _xdMath's source, kept for
     the next attempt (a wrong password is usually followed by a right one) and
     let go after a minute idle. If the worker cannot be made (no Worker, no
     Blob URLs) or dies mid-job, the same unlock runs on the main thread. Only
     the two answers the UI knows ('bad_password', 'xlsx_enc_unsupported')
     cross back from a worker as answers; anything else is a worker failure and
     is retried here. */
  let _xdWorker = null, _xdWorkerUrl = null, _xdIdle = null, _xdSeq = 0;
  const _xdPending = new Map();
  const _XD_ANSWERS = { bad_password: 1, xlsx_enc_unsupported: 1 };
  function _xdWorkerOk() {
    return typeof Worker === 'function' && typeof Blob === 'function' &&
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  }
  function _xdWorkerDrop() {
    if (_xdWorker) { try { _xdWorker.terminate(); } catch (e) {} }
    _xdWorker = null;
    if (_xdWorkerUrl) { try { URL.revokeObjectURL(_xdWorkerUrl); } catch (e) {} _xdWorkerUrl = null; }
    if (_xdIdle) { clearTimeout(_xdIdle); _xdIdle = null; }
  }
  function _xdWorkerRest() {
    if (_xdIdle) clearTimeout(_xdIdle);
    _xdIdle = setTimeout(() => { _xdIdle = null; if (!_xdPending.size) _xdWorkerDrop(); }, 60000);
  }
  function _xdWorkerGet() {
    if (_xdWorker) return _xdWorker;
    _xdWorkerUrl = URL.createObjectURL(new Blob(['(' + _xdMath.toString() + ')().serve(self);'], { type: 'text/javascript' }));
    const w = new Worker(_xdWorkerUrl);
    w.onmessage = (ev) => {
      const d = ev.data || {}, p = _xdPending.get(d.id);
      if (!p) return;
      _xdPending.delete(d.id);
      if (d.ok) p.res(d.out); else p.rej(Object.assign(new Error(d.err), { fromWorker: true }));
      _xdWorkerRest();
    };
    w.onerror = () => {
      const err = new Error('xlsx_worker');
      _xdPending.forEach((p) => p.rej(err)); _xdPending.clear();
      _xdWorkerDrop();
    };
    _xdWorker = w;
    return w;
  }
  async function _xdRun(job) {
    if (_xdWorkerOk()) {
      const id = ++_xdSeq;
      try {
        return await new Promise((res, rej) => {
          _xdPending.set(id, { res: res, rej: rej });
          const w = _xdWorkerGet();
          /* The container keeps its own copy of the package: a wrong password
             tries again on the same streams, and a transferred buffer is gone. */
          const pkg = job.pkg.slice();
          w.postMessage({ id: id, job: Object.assign({}, job, { pkg: pkg }) }, [pkg.buffer]);
        });
      } catch (e) {
        _xdPending.delete(id);
        if (e && e.fromWorker && _XD_ANSWERS[e.message]) throw new Error(e.message);
        _xdWorkerDrop();                                   // the worker failed: same maths, here
      }
    }
    return _XD.unlock(job);
  }

  function _attrs(xml, tag) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const el = doc.getElementsByTagName(tag)[0]
            || doc.getElementsByTagNameNS('*', tag.replace(/^.*:/, ''))[0];
    if (!el) return null;
    const o = {};
    Array.prototype.forEach.call(el.attributes, (a) => { o[a.name.replace(/^.*:/, '')] = a.value; });
    return o;
  }

  /* The container, read ONCE per attempt: 42 asks what kind of lock this is
     and then hands the same object to fhDecryptXlsx, so the FAT is walked once
     where it used to be walked twice. */
  function fhXlsxContainer(buf) {
    const streams = _cfbRead(buf);
    let kind = 'none';
    if (streams.EncryptionInfo && streams.EncryptedPackage) {
      const dv = new DataView(streams.EncryptionInfo.buffer, streams.EncryptionInfo.byteOffset);
      const major = dv.getUint16(0, true), minor = dv.getUint16(2, true);
      kind = (major === 4 && minor === 4) ? 'agile' : 'unsupported';
    }
    return { kind: kind, streams: streams };
  }
  function fhXlsxEncryptionKind(buf) { return fhXlsxContainer(buf).kind; }

  /* Locked .xlsx (an ArrayBuffer, or the container fhXlsxContainer already
     read) + password -> a plain .xlsx ArrayBuffer. The container and the XML
     are read here (DOMParser has no worker twin); the derivation and the
     package go to the worker, or run here when there is none. */
  async function fhDecryptXlsx(src, password) {
    const c = (src && src.streams) ? src : fhXlsxContainer(src);
    const info = c.streams.EncryptionInfo, pkg = c.streams.EncryptedPackage;
    if (!info || !pkg || c.kind !== 'agile') throw new Error('xlsx_enc_unsupported');

    const xml = new TextDecoder().decode(info.subarray(8));
    const kd = _attrs(xml, 'keyData'), ek = _attrs(xml, 'p:encryptedKey');
    if (!kd || !ek) throw new Error('xlsx_enc_unsupported');
    const hash = _HASH[(ek.hashAlgorithm || '').toUpperCase().replace('-', '')];
    if (!hash || (ek.cipherAlgorithm || '').toUpperCase() !== 'AES') throw new Error('xlsx_enc_unsupported');

    const dvPkg = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
    const job = {
      hash: hash, pwSalt: _xdB64(ek.saltValue), pw: _utf16le(password || ''),
      spin: +ek.spinCount || 100000, keyLen: (+ek.keyBits) / 8,
      verIn: _xdB64(ek.encryptedVerifierHashInput), verVal: _xdB64(ek.encryptedVerifierHashValue), keyVal: _xdB64(ek.encryptedKeyValue),
      kdSalt: _xdB64(kd.saltValue), blockSize: +kd.blockSize || 16,
      total: dvPkg.getUint32(0, true) + dvPkg.getUint32(4, true) * 4294967296,
      pkg: pkg
    };
    const out = await _xdRun(job);
    return out.buffer;
  }

  window.fhDecryptXlsx = fhDecryptXlsx;
  window.fhXlsxEncryptionKind = fhXlsxEncryptionKind;
  window.fhXlsxContainer = fhXlsxContainer;
  window.fhXlsxMath = _XD;                          // the hashes + spin, for tools/xlsx-hash.test.js and the bench
