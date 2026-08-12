  /* ═══ .xlsx reader — no library, no CDN ═══════════════════════════════════
     An .xlsx is a ZIP of XML parts, and the browser can already do both jobs:
     DecompressionStream('deflate-raw') inflates, DOMParser reads the XML. So
     this ships as ~150 lines instead of a ~900 KB spreadsheet library, adds
     nothing to the precache, works offline, and -- the reason it isn't a CDN
     script -- never tells a third party that this family is importing their
     finances. Same instinct as masking the Gemini sample.

     Scope is deliberately narrow: the FIRST worksheet of a normal export
     (bank / Money Lover / Misa / "Save as .xlsx"). Not a spreadsheet engine
     -- no formulas (their cached results are read), no multi-sheet picking,
     no charts. That is exactly the shape a transaction export has.

     Requires DecompressionStream (Safari 16.4+, Chrome 80+). Callers get a
     clear "save it as CSV instead" message when it's missing, rather than a
     silent failure. */

  function _xlsxSupported() { return typeof DecompressionStream === 'function'; }

  // --- ZIP: central directory -> { name: Uint8Array } for the parts we need ---
  async function _zipEntries(buf, wanted) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    // End of Central Directory: scan back from the tail for its signature.
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);           // central directory offset

    const out = {};
    const dec = new TextDecoder();
    for (let i = 0; i < count && p + 46 <= u8.length; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + cmtLen;
      if (!wanted(name)) continue;
      // Local header: name/extra lengths there can differ from the central copy.
      if (dv.getUint32(localOff, true) !== 0x04034b50) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(start, start + compSize);
      out[name] = (method === 0) ? raw : await _inflateRaw(raw);
    }
    return out;
  }

  async function _inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function _xml(bytes) {
    if (!bytes) return null;
    return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  }

  // "BC" -> 54. Cell refs carry their column, so sparse rows stay aligned.
  function _colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  /* Excel serial -> 'YYYY-MM-DD'. Day 1 is 1900-01-01 but Excel also counts a
     phantom 1900-02-29, which the 1899-12-30 epoch absorbs for every date from
     1900-03-01 on -- i.e. every date a transaction export will ever hold. */
  function _serialToISO(n) {
    const ms = Math.round((n - 25569) * 86400000);   // 25569 = days 1899-12-30 -> 1970-01-01
    const d = new Date(ms);
    if (isNaN(d)) return String(n);
    const p = (x) => String(x).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  /* Which style indexes format their number as a date? Built-ins 14-22 and
     45-47 are date/time; custom formats are date-ish if their code has d/m/y
     tokens outside quoted literals. Without this every date cell would arrive
     as "45870" and fail date detection on every row. */
  function _dateStyles(stylesDoc) {
    const isDate = {};
    if (!stylesDoc) return isDate;
    const custom = {};
    stylesDoc.querySelectorAll('numFmts > numFmt').forEach((n) => {
      const id = n.getAttribute('numFmtId');
      const code = (n.getAttribute('formatCode') || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
      custom[id] = /[dmyhs]/i.test(code);
    });
    const xfs = stylesDoc.querySelector('cellXfs');
    if (!xfs) return isDate;
    Array.prototype.forEach.call(xfs.children, (xf, i) => {
      const id = xf.getAttribute('numFmtId');
      if (id == null) return;
      const num = +id;
      isDate[i] = (num >= 14 && num <= 22) || (num >= 45 && num <= 47) || !!custom[id];
    });
    return isDate;
  }

  // Path of the first worksheet, resolved through the workbook's relationships.
  function _firstSheetPath(wbDoc, relsDoc) {
    try {
      const sheet = wbDoc && wbDoc.querySelector('sheets > sheet');
      const rid = sheet && (sheet.getAttribute('r:id') || sheet.getAttribute('id'));
      if (rid && relsDoc) {
        const rel = relsDoc.querySelector('Relationship[Id="' + rid + '"]');
        let target = rel && rel.getAttribute('Target');
        if (target) {
          target = target.replace(/^\//, '');
          return target.indexOf('xl/') === 0 ? target : 'xl/' + target;
        }
      }
    } catch (e) {}
    return 'xl/worksheets/sheet1.xml';
  }

  /* ArrayBuffer -> string[][], the same shape the CSV parser produces, so the
     rest of the import pipeline can't tell the two apart. */
  /* A password-protected workbook isn't a ZIP at all -- Office wraps the
     encrypted package in an OLE2 compound file, which starts with this magic.
     Without this check the reader just reports "not a zip", which tells nobody
     anything; banks here routinely send statements locked with a phone number
     or a date of birth, so this is a case worth naming precisely. */
  function _isOleContainer(buf) {
    const u = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    const magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (u.length < 8) return false;
    for (let i = 0; i < 8; i++) if (u[i] !== magic[i]) return false;
    return true;
  }

  /* Legacy .xls uses that same container, so the magic alone can't tell a
     locked file from an old one -- and telling someone their file has a
     password when it doesn't sends them hunting for a password that never
     existed. 41-xlsx-decrypt.js reads the container properly and says which
     it is; with a password in hand it also hands back a plain .xlsx, so
     everything below this point is unaware the file was ever locked. */
  async function fhParseXlsxBuffer(buf, password) {
    if (!_xlsxSupported()) throw new Error('xlsx_unsupported');
    if (_isOleContainer(buf)) {
      let kind = 'unsupported';
      try { kind = window.fhXlsxEncryptionKind(buf); } catch (e) { kind = 'none'; }
      if (kind === 'none') throw new Error('xls_legacy');              // an old .xls
      if (kind !== 'agile') throw new Error('xlsx_enc_unsupported');   // a scheme we don't open
      if (!password) throw new Error('xlsx_encrypted');                // ask, then come back
      buf = await window.fhDecryptXlsx(buf, password);
    }

    // First pass: the parts whose names are fixed.
    const meta = await _zipEntries(buf, (n) =>
      n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml');

    const sheetPath = _firstSheetPath(_xml(meta['xl/workbook.xml']), _xml(meta['xl/_rels/workbook.xml.rels']));
    const sheetPart = await _zipEntries(buf, (n) => n === sheetPath);
    const sheetDoc = _xml(sheetPart[sheetPath]);
    if (!sheetDoc) throw new Error('no_sheet');

    const sst = [];
    const sstDoc = _xml(meta['xl/sharedStrings.xml']);
    if (sstDoc) {
      sstDoc.querySelectorAll('sst > si').forEach((si) => {
        // Rich text splits one string across several <t> runs.
        let s = '';
        si.querySelectorAll('t').forEach((t) => { s += t.textContent; });
        sst.push(s);
      });
    }
    const dateStyle = _dateStyles(_xml(meta['xl/styles.xml']));

    const rows = [];
    sheetDoc.querySelectorAll('sheetData > row').forEach((row) => {
      const cells = [];
      row.querySelectorAll('c').forEach((c) => {
        const ref = c.getAttribute('r') || '';
        const idx = ref ? _colIndex(ref) : cells.length;
        const type = c.getAttribute('t');
        const vEl = c.querySelector('v');
        let val = '';
        if (type === 's') {
          const i = vEl ? +vEl.textContent : -1;
          val = (sst[i] != null) ? sst[i] : '';
        } else if (type === 'inlineStr') {
          const t = c.querySelector('is');
          val = t ? t.textContent : '';
        } else if (type === 'b') {
          val = (vEl && vEl.textContent === '1') ? 'TRUE' : 'FALSE';
        } else if (vEl) {
          const raw = vEl.textContent;
          const sIdx = c.getAttribute('s');
          val = (sIdx != null && dateStyle[+sIdx] && raw !== '' && !isNaN(+raw)) ? _serialToISO(+raw) : raw;
        }
        while (cells.length < idx) cells.push('');   // keep sparse rows aligned
        cells[idx] = val;
      });
      rows.push(cells);
    });
    return rows;
  }

  // File -> { headers, rows }, matching fhParseCsvFile's contract.
  async function fhParseXlsxFile(file, password) {
    const rows = (await fhParseXlsxBuffer(await file.arrayBuffer(), password))
      .filter((r) => r.some((cell) => String(cell).trim() !== ''));
    const [headers, ...dataRows] = rows;
    return { headers: (headers || []).map(function (h) { return String(h); }), rows: dataRows };
  }

  window.fhParseXlsxFile = fhParseXlsxFile;
  window.fhXlsxSupported = _xlsxSupported;
