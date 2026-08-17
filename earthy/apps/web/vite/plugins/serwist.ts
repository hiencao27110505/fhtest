import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { injectManifest } from "@serwist/build";
import { type Plugin, build } from "vite";

/**
 * Builds the service worker for TanStack Start.
 *
 * `vite-plugin-pwa` cannot be used here: it does not support the Vite
 * environment API that Start builds on, so its service-worker step silently
 * never runs in a production build (TanStack/router#4988). We bundle the
 * worker ourselves with a nested Vite build instead, which is the approach
 * from TanStack/router#4770 adapted for this app's Nitro 3 output layout.
 *
 * Two details are specific to server-rendering, and both differ from the
 * SPA recipes you will find elsewhere:
 *
 *  1. Client assets are emitted to `.output/public`, not `dist/client`. The
 *     manifest must be globbed from there or Nitro ships without the worker.
 *  2. SSR emits no HTML at build time, so there is nothing to precache as an
 *     app shell. We render one static `offline.html` and precache that as the
 *     navigation fallback.
 */

const SW_FILENAME = "sw.js";
const SW_SOURCE = path.join("src", "sw.ts");

/** Where Nitro 3 puts the client bundle. Not `dist/client`. */
const PROD_OUT_DIR = path.join(".output", "public");

type Mode = "dev" | "prod";

export function serwist(): Plugin {
  let rootDir: string;
  let isProduction: boolean;
  // The nested `build()` call below re-enters Vite's plugin pipeline. Without
  // this guard the worker build would trigger its own worker build, forever.
  let building = false;

  return {
    name: "fhub:serwist",
    // Run after the app's own output is written, so the glob sees real files.
    enforce: "post",

    configResolved(config) {
      rootDir = config.root;
      isProduction = config.isProduction;
    },

    async buildStart() {
      if (isProduction || building) return;
      building = true;
      try {
        await buildServiceWorker(rootDir, "dev");
      } finally {
        building = false;
      }
    },

    async buildEnd() {
      // The dev build writes `public/sw.js` so the browser can register a real
      // worker at the dev origin. That file must not survive into a production
      // build, where `public/` is copied verbatim into the output and would
      // shadow the generated worker with one that has no precache manifest.
      if (isProduction) await rm(path.resolve(rootDir, "public", SW_FILENAME), { force: true });
    },

    // `writeBundle` rather than `closeBundle`: a Start build runs several Vite
    // environments (client, ssr, server) and `closeBundle` fires for each, so
    // the worker was being rebuilt three times over a half-written directory.
    // This hook is per-environment and runs after that environment's files are
    // on disk, so gating it to `client` gives exactly one build against the
    // finished client output.
    async writeBundle() {
      if (!isProduction || building) return;
      if (this.environment?.name !== "client") return;
      building = true;
      try {
        await buildServiceWorker(rootDir, "prod");
      } finally {
        building = false;
      }
    },
  };
}

async function buildServiceWorker(rootDir: string, mode: Mode) {
  const production = mode === "prod";
  const outDir = production
    ? path.resolve(rootDir, PROD_OUT_DIR)
    : path.resolve(rootDir, "public");
  const swSrc = path.resolve(rootDir, SW_SOURCE);
  const swDest = path.resolve(outDir, SW_FILENAME);

  if (!existsSync(swSrc)) {
    throw new Error(`[serwist] service worker source not found: ${swSrc}`);
  }
  await mkdir(outDir, { recursive: true });

  if (production) await writeOfflineShell(outDir);

  await build({
    root: rootDir,
    configFile: false,
    // `webworker` keeps Vite from injecting DOM-oriented helpers (and from
    // assuming a document exists) into a worker bundle.
    build: {
      target: "esnext",
      outDir,
      emptyOutDir: false,
      minify: production,
      copyPublicDir: false,
      // A worker cannot load chunks the way a page can, so it must be one file.
      lib: { entry: swSrc, formats: ["es"], fileName: () => SW_FILENAME },
      rollupOptions: { output: { entryFileNames: SW_FILENAME, inlineDynamicImports: true } },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
      // In dev there is no manifest to inject, but the worker still reads the
      // token — define it so the bundle is valid rather than throwing.
      ...(production ? {} : { "self.__SW_MANIFEST": "undefined" }),
    },
    logLevel: "error",
  });

  if (!production) return;

  const { count, size, warnings } = await injectManifest({
    swSrc: swDest,
    swDest,
    globDirectory: outDir,
    globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,woff2,webmanifest}"],
    // The worker itself must never be precached — a worker that caches its own
    // bytes can never be replaced, and the app freezes on that version.
    globIgnores: [SW_FILENAME, "**/*.map"],
    // Nitro copies `public/` into the output *after* the client bundle is
    // written, which is when this hook runs — so globbing `outDir` alone
    // silently misses the manifest and icons. `injectManifest` only accepts one
    // directory, so those are hashed separately and appended here.
    additionalPrecacheEntries: await publicPrecacheEntries(rootDir),
    injectionPoint: "self.__SW_MANIFEST",
  });

  for (const warning of warnings) console.warn(`[serwist] ${warning}`);
  console.log(
    `[serwist] precached ${count} files (${(size / 1024 / 1024).toFixed(2)} MB) -> ${path.relative(rootDir, swDest)}`,
  );
}

/**
 * Precache entries for the files in `public/`.
 *
 * Each entry needs a `revision` hash so the worker can tell when the file has
 * changed between releases — unlike `assets/*`, these URLs are not
 * content-hashed, so the URL alone carries no version information.
 *
 * `sw.js` is excluded for the same reason as in the glob: a worker that
 * precaches itself can never be replaced.
 */
async function publicPrecacheEntries(rootDir: string) {
  const publicDir = path.resolve(rootDir, "public");
  if (!existsSync(publicDir)) return [];

  const files = await readdir(publicDir, { recursive: true, withFileTypes: true });
  const entries = [];

  for (const file of files) {
    if (!file.isFile() || file.name === SW_FILENAME) continue;
    const abs = path.join(file.parentPath, file.name);
    const url = path.relative(publicDir, abs).split(path.sep).join("/");
    const revision = createHash("md5").update(await readFile(abs)).digest("hex");
    entries.push({ url, revision });
  }

  return entries;
}

/**
 * Renders the static offline page.
 *
 * This is deliberately hand-written rather than server-rendered from a route:
 * the offline shell has to be byte-stable across builds and must not depend on
 * the router, the query client, or any request-time state — all of which are
 * unavailable in the situation where this page is actually shown.
 */
async function writeOfflineShell(outDir: string) {
  const dest = path.join(outDir, "offline.html");
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#2E9E6B" />
<link rel="icon" href="/icons/icon-192.png" type="image/png" />
<title>Không có mạng · Earthy</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100svh; display: grid; place-items: center;
    padding: 2rem; text-align: center;
    font-family: Manrope, ui-sans-serif, system-ui, sans-serif;
    background: #f4f1f6; color: #1c1b1f;
  }
  @media (prefers-color-scheme: dark) { body { background: #17151a; color: #eee9f0; } }
  img { width: 72px; height: 72px; border-radius: 20px; margin: 0 0 1.25rem; }
  h1 { font-size: 1.375rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1.5rem; opacity: .72; max-width: 34ch; line-height: 1.55; }
  .en { font-size: .8125rem; opacity: .55; }
  button {
    font: inherit; font-weight: 600; cursor: pointer;
    padding: .75rem 1.5rem; border-radius: 999px; min-height: 44px;
    border: 1px solid rgba(46,158,107,.4); background: rgba(46,158,107,.14); color: inherit;
  }
</style>
</head>
<body>
  <main>
    <img src="/icons/icon-192.png" alt="Earthy" />
    <h1>Đang ngoại tuyến</h1>
    <p>Trang này cần kết nối mạng. Nó sẽ tải lại ngay khi bạn có mạng trở lại.</p>
    <p class="en">You're offline. This page will load as soon as you're back online.</p>
    <button onclick="location.reload()">Thử lại</button>
  </main>
  <script>addEventListener('online', function () { location.reload() })</script>
</body>
</html>
`;
  await writeFile(dest, html, "utf8");
}
