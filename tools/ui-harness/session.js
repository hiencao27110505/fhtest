/* Shared boot for the screenshot runner and the flow runner: an isolated
   browser context, the stubbed Supabase fed with the fixture family, a
   sealed personal snapshot in IndexedDB, and a wait until the app is hydrated. */
const fs = require('fs');
const path = require('path');
const { IPHONE } = require('./browser');
const { makeFixture, makePersonal, UID } = require('./fixture-family');

const ROOT = path.join(__dirname, '..', '..');
const STUB = fs.readFileSync(path.join(ROOT, 'tools', 'boot-harness', 'stub-supabase.js'), 'utf8');
const BOOT_TIMEOUT = 15000;

/* Runs inside the page before any app script (same recipe as the boot
   harness's `warm` scenario). Personal-table reads are HUNG so the painted
   snapshot is never replaced by a refresh against garbage ciphertext. */
function seed(lang, theme, familyJson, personalJson, uid) {
  localStorage.setItem('fh-resume', '1');
  localStorage.setItem('fh-onboarded', '1');
  localStorage.setItem('fh-fam', JSON.stringify({ user: { name: 'Minh', email: 'stub@test.local', color: '#5b8def' }, familyName: 'Nhà Minh', mode: 'create', members: [], budget: 0, catBudget: null }));
  localStorage.setItem('fh-lang', lang);
  localStorage.setItem('fh-theme', theme);
  // first-run nudges that would otherwise pop over a flow (install nudge, key-card reminder, celebrations)
  localStorage.setItem('fh-install-nudged', '1');
  localStorage.setItem('fh-card-later', String(Date.now()));
  localStorage.setItem('fh-celebrated', '1');
  /* the push offer (55-push.js) is keyed on the member id, which the fixture only
     mints at hydrate — arming its guard here suppresses it whoever the member is */
  window._fhPushOfferArmed = true;
  localStorage.setItem('stub-lang', lang);
  localStorage.setItem('stub-lat', '0');
  localStorage.setItem('stub-hang', 'from:personal_');
  localStorage.setItem('stub-family', familyJson);
  (async () => {
    try {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(personalJson)));
      const all = new Uint8Array(iv.length + ct.length); all.set(iv); all.set(ct, iv.length);
      let s = ''; for (let i = 0; i < all.length; i++) s += String.fromCharCode(all[i]);
      const recs = [{ fid: 'p:' + uid, key, at: Date.now() }, { fid: 'psnap:' + uid, key: btoa(s), at: Date.now() }];
      await new Promise((res, rej) => {
        const rq = indexedDB.open('fh-keys', 1);
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('k')) db.createObjectStore('k', { keyPath: 'fid' }); };
        rq.onsuccess = () => { const tx = rq.result.transaction('k', 'readwrite'); for (const r of recs) tx.objectStore('k').put(r); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); };
        rq.onerror = () => rej(rq.error);
      });
      window.__idbSeeded = true;
    } catch (e) { window.__idbSeedErr = String(e); }
  })();
}

/* Strings the fixture puts on screen legitimately in Vietnamese (user data),
   so the language lint does not flag them in English mode. */
function fixtureStrings() {
  const f = makeFixture(), p = makePersonal(), out = new Set();
  [f.family.name].concat(f.members.map((m) => m.name), f.categories.map((c) => c.name), f.transactions.map((t) => t.note),
    f.events.map((e) => e.name), f.saving_goals.map((g) => g.name), f.event_memories.map((m) => m.caption),
    p.txns.map((t) => t.note), p.txns.map((t) => t.cat), Object.keys(p.catBudget)).forEach((s) => { if (s) out.add(s); });
  return [...out];
}

/* bootPage(browser, base, {lang, theme}) → { page, ctx, errors, close() } */
async function bootPage(browser, base, opts) {
  const lang = opts.lang || 'vi', theme = opts.theme || 'sage';
  const familyJson = opts.familyJson || JSON.stringify(makeFixture());
  const personalJson = opts.personalJson || JSON.stringify(makePersonal());
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(IPHONE);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('vendor/supabase.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: STUB });
    if (!r.url().startsWith(base)) return r.respond({ status: 200, contentType: 'text/plain', body: '' });   // fonts/external neutralized
    r.continue();
  });
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: String(e && e.message || e).slice(0, 300) }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ kind: 'console', text: m.text().slice(0, 300) }); });
  await page.evaluateOnNewDocument(seed, lang, theme, familyJson, personalJson, UID);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  // "What's new" auto-opens 900ms after load when the newest release id is unseen; mark it seen now
  await page.evaluate(() => { try { fhMarkReleasesSeen(); } catch (e) {} });
  const t0 = Date.now();
  while (Date.now() - t0 < BOOT_TIMEOUT) {
    const ok = await page.evaluate(() => !!(window.DB && window.DB._hydrated === true) && !document.getElementById('fh-splash'));
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const booted = await page.evaluate(() => ({ hydrated: !!(window.DB && window.DB._hydrated), splash: !!document.getElementById('fh-splash'), seeded: !!window.__idbSeeded, seedErr: window.__idbSeedErr || null, fam: window.FAM && window.FAM.familyName }));
  if (!booted.hydrated || booted.splash) { await ctx.close(); throw new Error('boot did not reach hydrated state: ' + JSON.stringify(booted)); }
  await new Promise((r) => setTimeout(r, 600));
  return { page, ctx, errors, lang, theme, close: async () => { try { await page.close(); } catch (e) {} try { await ctx.close(); } catch (e) {} } };
}

const isBad = (errors) => errors.some((e) => e.kind === 'pageerror' || /ReferenceError|TypeError|SyntaxError/.test(e.text));

module.exports = { bootPage, seed, fixtureStrings, isBad, ROOT, STUB };
