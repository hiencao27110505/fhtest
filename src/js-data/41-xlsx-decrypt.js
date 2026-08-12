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
     than half-attempted. */

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

    // Follow a chain, concatenating whole sectors; callers trim to the size.
    const chain = (start, size, secSize, source) => {
      const out = new Uint8Array(size);
      let at = 0, id = start, guard = 0;
      while (id < CFB_END && at < size && guard++ < 1 << 22) {
        const from = source ? id * secSize : sectorAt(id);
        const take = Math.min(secSize, size - at);
        out.set((source || u8).subarray(from, from + take), at);
        at += take;
        id = fat[id];
        if (id === undefined) break;
      }
      return out;
    };

    // Directory entries, 128 bytes each.
    const dirBytes = chain(dirStart, 1 << 22, sectorSize, null);
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
      if (!miniData && root) miniData = chain(root.start, root.size, sectorSize, null);
      return miniData;
    };
    let miniFat = null;
    const miniFatTable = () => {
      if (!miniFat) {
        const raw = chain(miniFatStart, 1 << 22, sectorSize, null);
        const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        miniFat = [];
        for (let i = 0; i * 4 + 4 <= raw.length; i++) miniFat.push(d.getUint32(i * 4, true));
      }
      return miniFat;
    };

    const out = {};
    entries.forEach((e) => {
      if (e.type !== 2) return;
      if (e.size < miniCutoff) {
        const mini = miniStream(), mf = miniFatTable();
        const bytes = new Uint8Array(e.size);
        let at = 0, id = e.start, guard = 0;
        while (id < CFB_END && at < e.size && guard++ < 1 << 22) {
          const take = Math.min(miniSize, e.size - at);
          bytes.set(mini.subarray(id * miniSize, id * miniSize + take), at);
          at += take; id = mf[id];
          if (id === undefined) break;
        }
        out[e.name] = bytes;
      } else {
        out[e.name] = chain(e.start, e.size, sectorSize, null);
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
  function _xdCat() {
    const parts = [].slice.call(arguments);
    let n = 0; parts.forEach((p) => { n += p.length; });
    const out = new Uint8Array(n);
    let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }
  function _le32(n) { return new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]); }
  function _utf16le(s) {
    const u = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = c >> 8; }
    return u;
  }
  const _HASH = { SHA512: 'SHA-512', SHA384: 'SHA-384', SHA256: 'SHA-256', SHA1: 'SHA-1' };

  /* WebCrypto's AES-CBC always wants PKCS#7 padding; this format has none. So
     append one block that decrypts to a full pad -- E(0x10*16 XOR lastBlock),
     which is exactly the first block AES-CBC encryption produces when seeded
     with lastBlock as the IV -- and let WebCrypto strip it back off. */
  async function _aesCbcNoPad(keyBytes, iv, data) {
    const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt']);
    const last = data.subarray(data.length - 16);
    const padBlock = new Uint8Array(16).fill(16);
    const seeded = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, k, padBlock));
    const ext = _xdCat(data, seeded.subarray(0, 16));
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, ext));
  }

  // Block keys are fixed by the spec; each derives a different key from the same password.
  const BK_VERIFIER_IN = new Uint8Array([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
  const BK_VERIFIER_VAL = new Uint8Array([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
  const BK_KEY_VALUE = new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

  function _attrs(xml, tag) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const el = doc.getElementsByTagName(tag)[0]
            || doc.getElementsByTagNameNS('*', tag.replace(/^.*:/, ''))[0];
    if (!el) return null;
    const o = {};
    Array.prototype.forEach.call(el.attributes, (a) => { o[a.name.replace(/^.*:/, '')] = a.value; });
    return o;
  }

  function fhXlsxEncryptionKind(buf) {
    const streams = _cfbRead(buf);
    if (!streams.EncryptionInfo || !streams.EncryptedPackage) return 'none';
    const dv = new DataView(streams.EncryptionInfo.buffer, streams.EncryptionInfo.byteOffset);
    const major = dv.getUint16(0, true), minor = dv.getUint16(2, true);
    return (major === 4 && minor === 4) ? 'agile' : 'unsupported';
  }

  /* Locked .xlsx + password -> a plain .xlsx ArrayBuffer.
     Throws 'bad_password' when the verifier says so, which is a real check --
     not a guess from whether the output happens to look like a ZIP. */
  async function fhDecryptXlsx(buf, password) {
    const streams = _cfbRead(buf);
    const info = streams.EncryptionInfo, pkg = streams.EncryptedPackage;
    if (!info || !pkg) throw new Error('xlsx_enc_unsupported');
    const dv0 = new DataView(info.buffer, info.byteOffset);
    if (!(dv0.getUint16(0, true) === 4 && dv0.getUint16(2, true) === 4)) throw new Error('xlsx_enc_unsupported');

    const xml = new TextDecoder().decode(info.subarray(8));
    const kd = _attrs(xml, 'keyData'), ek = _attrs(xml, 'p:encryptedKey');
    if (!kd || !ek) throw new Error('xlsx_enc_unsupported');
    const hash = _HASH[(ek.hashAlgorithm || '').toUpperCase().replace('-', '')];
    if (!hash || (ek.cipherAlgorithm || '').toUpperCase() !== 'AES') throw new Error('xlsx_enc_unsupported');

    const pwSalt = _xdB64(ek.saltValue);
    const keyLen = (+ek.keyBits) / 8;
    const spin = +ek.spinCount || 100000;

    // H = hash(salt || password), then hash(counter || H), spinCount times.
    let h = new Uint8Array(await crypto.subtle.digest(hash, _xdCat(pwSalt, _utf16le(password))));
    for (let i = 0; i < spin; i++) {
      h = new Uint8Array(await crypto.subtle.digest(hash, _xdCat(_le32(i), h)));
    }
    const keyFor = async (blockKey) =>
      (new Uint8Array(await crypto.subtle.digest(hash, _xdCat(h, blockKey)))).subarray(0, keyLen);

    // The verifier: decrypt a known value two ways and see if they agree.
    const vIn = await _aesCbcNoPad(await keyFor(BK_VERIFIER_IN), pwSalt, _xdB64(ek.encryptedVerifierHashInput));
    const vVal = await _aesCbcNoPad(await keyFor(BK_VERIFIER_VAL), pwSalt, _xdB64(ek.encryptedVerifierHashValue));
    const expect = new Uint8Array(await crypto.subtle.digest(hash, vIn));
    for (let i = 0; i < expect.length; i++) if (expect[i] !== vVal[i]) throw new Error('bad_password');

    const secret = (await _aesCbcNoPad(await keyFor(BK_KEY_VALUE), pwSalt, _xdB64(ek.encryptedKeyValue))).subarray(0, keyLen);

    // The package is encrypted in 4096-byte segments, each with its own IV.
    const dvPkg = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
    const total = dvPkg.getUint32(0, true) + dvPkg.getUint32(4, true) * 4294967296;
    const kdSalt = _xdB64(kd.saltValue), blockSize = +kd.blockSize || 16;
    const body = pkg.subarray(8);
    const out = new Uint8Array(total);
    let at = 0;
    for (let seg = 0; seg * 4096 < body.length; seg++) {
      const chunk = body.subarray(seg * 4096, Math.min((seg + 1) * 4096, body.length));
      const iv = (new Uint8Array(await crypto.subtle.digest(hash, _xdCat(kdSalt, _le32(seg))))).subarray(0, blockSize);
      const plain = await _aesCbcNoPad(secret, iv, chunk);
      const take = Math.min(plain.length, total - at);
      if (take <= 0) break;
      out.set(plain.subarray(0, take), at);
      at += take;
    }
    return out.buffer;
  }

  window.fhDecryptXlsx = fhDecryptXlsx;
  window.fhXlsxEncryptionKind = fhXlsxEncryptionKind;
