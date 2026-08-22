/// <reference lib="webworker" />

// Service worker source. Bundled to `sw.js` by `vite/plugins/serwist.ts`, NOT
// by the app's own Vite build — it needs its own worker build so it does not
// inherit the DOM/browser entry graph.
//
// The precache manifest is injected at `self.__SW_MANIFEST` during the
// production build. In dev the token is defined as `undefined`, so the worker
// registers its runtime routes and precaches nothing.

import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
	CacheFirst,
	ExpirationPlugin,
	NavigationRoute,
	NetworkFirst,
	NetworkOnly,
	Serwist,
	StaleWhileRevalidate,
} from "serwist";

declare global {
	interface WorkerGlobalScope extends SerwistGlobalConfig {
		__SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
	}
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The page precached and served when a navigation cannot reach the network.
 *
 * This app is server-rendered, so there is no build-time `index.html` to fall
 * back on the way an SPA would — every page is rendered per-request. The build
 * emits this one static file (see the Vite plugin), which makes it the only
 * HTML guaranteed to be in the cache while offline.
 *
 * The path must match the precache manifest entry exactly, and the manifest is
 * globbed from the output directory — so it is `/offline.html`, the real file,
 * not a pretty route the SSR server would have to be online to render.
 */
const OFFLINE_URL = "/offline.html";

const serwist = new Serwist({
	precacheEntries: self.__SW_MANIFEST,
	// Take over immediately rather than waiting for every tab to close. The
	// update prompt in `use-pwa.ts` asks the user before this happens,
	// so an in-flight session is never swapped out from under them.
	skipWaiting: false,
	clientsClaim: true,
	navigationPreload: true,
	runtimeCaching: [
		{
			// Auth and API calls must never be served stale: a cached 200 for a
			// signed-out user would resurrect a dead session. NetworkOnly keeps the
			// SW out of the way entirely and lets these fail normally when offline.
			matcher: ({ url, sameOrigin }) =>
				sameOrigin && url.pathname.startsWith("/api/"),
			handler: new NetworkOnly(),
		},
		{
			// Hashed build assets are immutable: a content change produces a new
			// filename, so the cached copy can never be wrong.
			matcher: ({ url, sameOrigin }) =>
				sameOrigin && url.pathname.startsWith("/assets/"),
			handler: new CacheFirst({
				cacheName: "static-assets",
				plugins: [
					new ExpirationPlugin({
						maxEntries: 128,
						maxAgeSeconds: 60 * 60 * 24 * 365,
					}),
				],
			}),
		},
		{
			matcher: ({ request, sameOrigin }) =>
				sameOrigin &&
				(request.destination === "image" || request.destination === "font"),
			handler: new StaleWhileRevalidate({
				cacheName: "media",
				plugins: [
					new ExpirationPlugin({
						maxEntries: 64,
						maxAgeSeconds: 60 * 60 * 24 * 30,
					}),
				],
			}),
		},
		{
			// Google Fonts stylesheets change rarely; the font files they point at
			// are versioned URLs and effectively immutable.
			matcher: ({ url }) => url.origin === "https://fonts.googleapis.com",
			handler: new StaleWhileRevalidate({
				cacheName: "google-fonts-stylesheets",
			}),
		},
		{
			matcher: ({ url }) => url.origin === "https://fonts.gstatic.com",
			handler: new CacheFirst({
				cacheName: "google-fonts-webfonts",
				plugins: [
					new ExpirationPlugin({
						maxEntries: 32,
						maxAgeSeconds: 60 * 60 * 24 * 365,
					}),
				],
			}),
		},
	],
});

/**
 * Navigations go to the network first so server-rendered HTML is always fresh
 * — an SSR page carries per-request state (auth, data) that must not be served
 * from cache. Only when the network fails does the precached offline shell
 * answer, which is what makes the app open at all with no connection.
 */
serwist.registerRoute(
	new NavigationRoute(
		new NetworkFirst({
			cacheName: "pages",
			networkTimeoutSeconds: 10,
			plugins: [
				{
					handlerDidError: async () =>
						(await serwist.matchPrecache(OFFLINE_URL)) ?? Response.error(),
				},
			],
		}),
	),
);

// Let the page tell a waiting worker to activate (see `use-pwa.ts`).
self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

serwist.addEventListeners();
