  /* ═══ PDF statement → the spreadsheet grid (pdf-statements-spec.md §11) ═══
     A bank's PDF statement is read on the device, like a locked workbook: pdf.js
     opens it (password callback included), gives every page's text items with
     their coordinates, and this file turns those items into the same grid of
     rows and cells 42-xlsx-parse.js hands over -- so 59-statement-table.js
     (table finder, proof, classifier, account facts) needs no PDF branch.

     What the one real file taught (spec §4, Techcombank card, 3 pages):
       - ONE header, on page 1, bilingual over two text lines; pages 2-3
         continue with no header and every column keeps its x. So the header's
         column ranges are found once and carried across every page, never
         re-detected per page.
       - a description spans two lines; a fee row has no transaction date, only
         a post date; the totals block and a glossary follow the table.
     Rules: rows = items clustered by y; cells = items joined across small gaps;
     columns = the header cells' x-ranges, a cell assigned by its CENTRE (figures
     are right-aligned and a wide one starts left of its heading); a row whose
     cells all sit in the last column joins the row above (the second line of a
     description); the second header line, digit-free and inside the columns,
     merges into the header so both languages name the roles; a bare date on a
     line of its own in the preamble joins the line above it (a due date printed
     under its time).

     pdf.js is vendored (vendor/pdfjs/, pinned to pdfjs-dist by
     tools/vendor-pin.test.js) and loaded on the first PDF open, never precached:
     1.3 MB would double every service-worker bump. Its own worker runs the
     parsing and the AES key derivation off the main thread.

     Pure where it can be: fhPdfItemsToGrid takes items and returns a grid, so
     tools/pdf-grid.test.js runs the REAL builder on items pdfjs-dist extracts
     under Node from the synthetic fixture. fhPdfGrid is the browser door. */
  (function () {
    const PDF_LIB = './vendor/pdfjs/pdf.min.mjs', PDF_WORKER = './vendor/pdfjs/pdf.worker.min.mjs';   // relative on purpose: a bare specifier does not resolve in a module
    let _lib = null;
    window.fhPdfReady = function () {
      if (!_lib) {
        _lib = import(PDF_LIB).then((m) => { m.GlobalWorkerOptions.workerSrc = PDF_WORKER; return m; })
          .catch((e) => { _lib = null; throw e; });
      }
      return _lib;
    };
    /* Does this build read this extension? The card for a file nobody reads yet
       (spec §3) asks exactly this; the server never has an opinion. */
    window.fhStmtReaders = function () { return { xlsx: true, csv: true, pdf: true }; };

    const _isDate = (s) => /^\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s*$/.test(String(s || ''));
    const _isPageNo = (s) => /^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/.test(String(s || ''));

    /* items: [{str, x, y, w, h}] with y measured from the TOP of the page, per
       page in order. Returns the grid: an array of rows, each an array of cell
       strings. opts.roles / opts.usable are 59's fhStmtRoles / _stmtRolesUsable
       (window globals in the app; handed in by the test). */
    function fhPdfItemsToGrid(pages, opts) {
      opts = opts || {};
      const roles = opts.roles || window.fhStmtRoles, usable = opts.usable || window._stmtRolesUsable;
      /* 1. rows: cluster by y per page, read top to bottom; cells: items joined
            across gaps smaller than half a glyph height */
      const rows = [];
      (pages || []).forEach((pg, pi) => {
        const items = (pg.items || []).filter((it) => it && String(it.str).trim() !== '')
          .slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
        let cur = null;
        items.forEach((it) => {
          const tol = Math.max(2, (it.h || 10) * 0.4);
          if (!cur || Math.abs(it.y - cur.y) > tol) { cur = { page: pi, y: it.y, items: [] }; rows.push(cur); }
          cur.items.push(it);
        });
      });
      rows.forEach((r) => {
        r.items.sort((a, b) => a.x - b.x);
        const cells = [];
        r.items.forEach((it) => {
          const last = cells[cells.length - 1];
          const gap = last ? it.x - last.x1 : Infinity;
          const glue = Math.max(3, (it.h || 10) * 0.5);
          if (last && gap < glue) { last.text += (gap > 0.8 ? ' ' : '') + it.str; last.x1 = Math.max(last.x1, it.x + (it.w || 0)); }
          else cells.push({ x0: it.x, x1: it.x + (it.w || 0), text: it.str });
        });
        cells.forEach((c) => { c.text = c.text.replace(/\s+/g, ' ').trim(); });
        r.cells = cells.filter((c) => c.text !== '');
      });

      /* 2. the header. Headings are printed as one text run each, often so close
            that gap-merging joins two ("Ngày giao dịch Ngày cập nhật hệ") and the
            date role is lost -- so the header is looked for on the RAW runs first,
            and its column spans come from those runs' x. A row counts as the
            header when it names a date, an amount and at least one more role: a
            bilingual preamble prints "Credit Limit" beside "Payment due date",
            which is a date and a credit by the words alone, and a real header
            names more. Fallbacks: the gap-merged cells, then the first usable row. */
      const rolesOf = (texts) => (roles ? roles(texts) : null);
      const strong = (rl) => !!rl && (usable ? usable(rl) : (rl.date !== undefined)) && Object.keys(rl).length >= 3;
      const weak = (rl) => !!rl && (usable ? usable(rl) : (rl.date !== undefined));
      let h = -1, hv = null, first = null;
      for (let i = 0; i < rows.length && i < 120; i++) {
        const raw = rows[i].items.map((it) => ({ x0: it.x, x1: it.x + (it.w || 0), text: String(it.str).replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
        const variants = [raw, rows[i].cells];
        for (const v of variants) {
          const rl = rolesOf(v.map((c) => c.text));
          if (strong(rl)) { h = i; hv = v; break; }
          if (!first && weak(rl)) first = { i: i, v: v };
        }
        if (h >= 0) break;
      }
      if (h < 0 && first) { h = first.i; hv = first.v; }
      const out = [];
      if (h < 0) {                                   // no table: every line as it reads, for the summary and the "no table" card
        rows.forEach((r) => out.push(r.cells.map((c) => c.text)));
        return out;
      }
      /* 2a. the header's column spans come from its runs; the second header
             line (bilingual), digit-free, folds into them so both languages
             name the roles ("Ngày cập nhật hệ" + "thống Post Date") */
      const head = rows[h], hcells = hv;
      /* Column starts: each heading's x, SNAPPED to where the body's runs
         actually start under it when they do so consistently (a tight cluster
         of run starts within 12 pt of the heading). The real file prints its
         descriptions a few points left of their heading, and a boundary on the
         heading alone handed every memo to the credit column. Figures are
         right-aligned and never cluster, so their columns keep the heading's x. */
      const starts = {};
      for (let i = h + 1; i < rows.length; i++) rows[i].items.forEach((it) => { const k = Math.round(it.x / 2) * 2; starts[k] = (starts[k] || 0) + 1; });
      const bodyN = Math.max(1, rows.length - h - 1);
      const snap = (x) => {
        let best = x, bestN = 0;
        Object.keys(starts).forEach((k) => { const kx = +k, n = starts[k]; if (Math.abs(kx - x) <= 12 && n > bestN && n >= Math.max(4, bodyN * 0.15)) { best = Math.min(x, kx); bestN = n; } });
        return best;
      };
      const colX = hcells.map((c, i) => i === 0 ? c.x0 : snap(c.x0));
      const spans = colX.map((x, i) => ({ x0: i === 0 ? -Infinity : x - 2, x1: i === colX.length - 1 ? Infinity : colX[i + 1] - 2 }));
      /* a run belongs to the column its START falls in: a heading and the text
         under it share a left edge, and a right-aligned figure starts at or after
         its heading's start while its centre can stray into the next column (the
         real file's credit figures did exactly that). Known limit: a figure wider
         than its heading starts in the column before. */
      const colOf = (c) => { for (let i = spans.length - 1; i >= 0; i--) if (c.x0 >= spans[i].x0) return i; return 0; };
      let skip = -1;
      const next = rows[h + 1];
      if (next && next.page === head.page && !next.items.some((it) => /\d/.test(it.str))) {
        const merged = hcells.map((c) => c.text);
        next.items.forEach((it) => { const i = colOf({ x0: it.x, x1: it.x + (it.w || 0) }); merged[i] += ' ' + String(it.str).trim(); });
        if (next.items.length) { head.merged = merged; skip = h + 1; }
      }
      /* 3. the preamble as it is, with a lone bare date rejoining the line it
            belongs to: the nearest line above (up to three) whose last cell is a
            clock time, else the line above. A due date printed under its time. */
      for (let i = 0; i < h; i++) {
        const texts = rows[i].cells.map((c) => c.text);
        if (texts.length === 1 && _isDate(texts[0]) && out.length) {
          let k = out.length - 1;
          for (let back = out.length - 1; back >= Math.max(0, out.length - 3); back--) {
            if (/^\d{1,2}:\d{2}$/.test(out[back][out[back].length - 1] || '')) { k = back; break; }
          }
          const prev = out[k];
          prev[prev.length - 1] = (texts[0] + ' ' + prev[prev.length - 1]).trim();
        } else out.push(texts);
      }
      out.push((head.merged || hcells.map((c) => c.text)).map((x) => x.replace(/\s+/g, ' ').trim()));
      const headerIdx = out.length - 1, lastCol = spans.length - 1;
      const hr = roles ? roles(out[headerIdx]) : {};
      const dateCols = [hr.date, hr.postDate].filter((x) => x !== undefined);
      const numCols = new Set(['debit', 'credit', 'amount', 'balance', 'fxAmount'].map((k) => hr[k]).filter((x) => x !== undefined));
      /* pdf.js glues neighbouring cells into ONE text run when the gap between
         them is under a space: "5,386,180 Thanh toan no the tin dung …" came as
         one run starting in the credit column, and two real files glued a
         payment's figure to its memo in a way no word pattern foresaw (a credit
         of 7,270,899 became 7,270,899,672,708,996 and the memo became a date).
         The cut is GEOMETRIC, not lexical: a run that reaches past a column
         boundary is cut at that boundary, at the nearest space the run's
         average glyph width puts there, boundary after boundary. A run with no
         space near the boundary stays whole in its start column, where the
         reader's own shape check (59 fhStmtFigure) refuses it as an amount
         instead of guessing: an unreadable row is shown, never invented. A
         run that starts in the last column crosses no boundary. */
      const CUT_SLACK = 3;   // characters either side of the boundary where a space counts as the cut (more, the further the boundary: the average glyph width drifts)
      const split = (c) => {
        const text = c.text, n = text.length, k0 = colOf(c);
        if (!n || c.x1 <= c.x0 || k0 >= lastCol) return [c];
        const cw = (c.x1 - c.x0) / n, out = [];
        let from = 0, x0 = c.x0;
        for (let k = k0; k < lastCol; k++) {
          const bx = spans[k].x1;                       // where column k+1 begins
          if (c.x1 <= bx + cw) break;                   // the run ends inside column k
          const at = Math.round((bx - c.x0) / cw);      // the character under the boundary
          const slack = Math.max(CUT_SLACK, Math.ceil(at * 0.15));
          let sp = -1;
          for (let d = 0; d <= slack && sp < 0; d++) {
            if (at + d > from && at + d < n && text[at + d] === ' ') sp = at + d;
            else if (at - d > from && at - d < n && text[at - d] === ' ') sp = at - d;
          }
          if (sp < 0) break;                            // no space near the boundary: leave the rest whole
          const left = text.slice(from, sp).trim();
          if (left) out.push({ x0: x0, x1: c.x0 + sp * cw, text: left });
          from = sp + 1; x0 = Math.max(c.x0 + from * cw, spans[k + 1].x0);   // the remainder belongs to column k+1
        }
        const rest = text.slice(from).trim();
        if (rest) out.push({ x0: x0, x1: c.x1, text: rest });
        return out.length ? out : [c];
      };

      /* 4. every later row lands in the header's columns, across pages */
      let lastBody = -1;
      for (let i = h + 1; i < rows.length; i++) {
        if (i === skip) continue;
        const runs = rows[i].items.map((it) => ({ x0: it.x, x1: it.x + (it.w || 0), text: String(it.str).replace(/\s+/g, ' ').trim() })).filter((c) => c.text && !_isPageNo(c.text)).flatMap(split);
        if (!runs.length) continue;
        const row = new Array(spans.length).fill('');
        const used = new Set();
        runs.forEach((c) => { const k = colOf(c); row[k] = (row[k] ? row[k] + ' ' : '') + c.text; used.add(k); });
        const hasDate = dateCols.some((k) => _isDate(row[k]));
        /* the second line of a description: only the last column is filled and
           the row above is a body row */
        if (!hasDate && used.size === 1 && used.has(lastCol) && lastBody >= 0 && lastBody === out.length - 1) {
          out[lastBody][lastCol] = (out[lastBody][lastCol] + ' ' + row[lastCol]).trim();
          continue;
        }
        if (hasDate) { out.push(row); lastBody = out.length - 1; continue; }
        /* anything else after the table (the totals block, the glossary) keeps
           its gap-merged cells, so a bilingual label stays one cell and its
           figure is the next one, which is how the summary reader expects it */
        out.push(rows[i].cells.map((c) => c.text).filter((x) => !_isPageNo(x)));
      }
      return out;
    }
    window.fhPdfItemsToGrid = fhPdfItemsToGrid;

    /* The browser door: bytes (+ password) → grid. Throws the codes the
       statement flow already maps: 'pdf_encrypted' (needs a password),
       'bad_password', 'pdf_scanned' (no text layer), 'pdf_unsupported'. */
    window.fhPdfGrid = async function (bytes, password) {
      let lib;
      try { lib = await window.fhPdfReady(); }
      catch (e) { throw new Error('pdf_lib'); }        // the reader could not be fetched (offline, or a blocked module): say so, never "unreadable"
      const data = new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes);   // pdf.js transfers the buffer to its worker: hand it a copy, whatever the caller holds
      let doc;
      try {
        doc = await lib.getDocument({ data: data, password: password || undefined, isEvalSupported: false, useWorkerFetch: false, stopAtErrors: false }).promise;
      } catch (e) {
        if (e && e.name === 'PasswordException') throw new Error(e.code === 2 ? 'bad_password' : 'pdf_encrypted');
        throw new Error('pdf_unsupported');
      }
      const pages = [];
      try {
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          pages.push({ height: vp.height, items: (tc.items || []).filter((it) => it.str && it.str.trim()).map((it) => ({
            str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 })) });
          try { page.cleanup(); } catch (e2) {}
        }
      } finally { try { await doc.destroy(); } catch (e3) {} }
      if (!pages.some((pg) => pg.items.length)) throw new Error('pdf_scanned');
      return fhPdfItemsToGrid(pages);
    };
    /* pdfjs-dist's way of reading items, in one place, so the Node test and the
       app extract the same shape (the test passes its own `lib`). */
    window.fhPdfPagesOf = async function (lib, bytes, password, extra) {
      const doc = await lib.getDocument(Object.assign({ data: new Uint8Array(bytes), password: password || undefined, isEvalSupported: false, useWorkerFetch: false }, extra || {})).promise;
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
        pages.push({ height: vp.height, items: (tc.items || []).filter((it) => it.str && it.str.trim()).map((it) => ({
          str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 10 })) });
      }
      try { await doc.destroy(); } catch (e) {}
      return pages;
    };
  })();