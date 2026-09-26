/* Shared browser launcher for the UI harness and the boot harness.
   Uses puppeteer-core + the Chrome already installed on this machine (no
   Chromium download). Override the binary with PUPPETEER_EXECUTABLE_PATH. */
const fs = require('fs');

const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

function chromePath() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('No Chrome found. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH.');
}

function loadPuppeteer() {
  try { return { pp: require('puppeteer'), core: false }; } catch (e) { /* fall through */ }
  return { pp: require('puppeteer-core'), core: true };
}

/* iPhone 13/14 logical viewport. dpr 2 keeps text crisp in screenshots. */
const IPHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function launch(opts) {
  const { pp, core } = loadPuppeteer();
  const o = Object.assign({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] }, opts || {});
  if (core && !o.executablePath) o.executablePath = chromePath();
  return pp.launch(o);
}

module.exports = { launch, IPHONE, chromePath };
