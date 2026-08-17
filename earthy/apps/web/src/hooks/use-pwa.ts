import type { Serwist } from "@serwist/window";
import { useCallback, useEffect, useRef, useState } from "react";

export interface PwaState {
	/** A new version is installed and waiting. Prompt, then call `update()`. */
	needsRefresh: boolean;
	/** The app has been cached and will work offline. */
	offlineReady: boolean;
	/** Activates the waiting worker and reloads onto the new version. */
	update: () => void;
}

/**
 * Registers the service worker and reports update state.
 *
 * The worker is built with `skipWaiting: false`, so a new version installs but
 * stays inert until asked. That is deliberate: swapping the worker mid-session
 * can leave an already-loaded page requesting chunks the new build no longer
 * has. We surface `needsRefresh` and let the user choose when to take it.
 */
export function usePwa(): PwaState {
	const [needsRefresh, setNeedsRefresh] = useState(false);
	const [offlineReady, setOfflineReady] = useState(false);
	const serwistRef = useRef<Serwist | null>(null);

	useEffect(() => {
		if (typeof window === "undefined" || !("serviceWorker" in navigator))
			return;
		// A worker registered by `vite dev` would be bundled without a precache
		// manifest and only muddies local debugging.
		if (import.meta.env.DEV) return;

		let cancelled = false;

		// Imported lazily so `@serwist/window` stays out of the SSR bundle and off
		// the critical path of the initial client render.
		import("@serwist/window")
			.then(({ Serwist: SerwistWindow }) => {
				if (cancelled) return;

				// The worker is bundled as a single ES module (see the Vite plugin),
				// so it must be registered as `module`, not `classic`.
				const serwist = new SerwistWindow("/sw.js", {
					scope: "/",
					type: "module",
				});
				serwistRef.current = serwist;

				serwist.addEventListener("installed", (event) => {
					// `isUpdate` is false on the very first install — that is the moment
					// the app became available offline, not an update to prompt about.
					if (!event.isUpdate) setOfflineReady(true);
				});

				serwist.addEventListener("waiting", () => setNeedsRefresh(true));

				// Fires once the new worker takes control after `update()`.
				serwist.addEventListener("controlling", () => window.location.reload());

				return serwist.register();
			})
			.catch((error) => {
				// A failed registration must never break the app — it only means no
				// offline support for this session.
				console.error("[pwa] service worker registration failed", error);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const update = useCallback(() => {
		setNeedsRefresh(false);
		const serwist = serwistRef.current;
		// Reloading here would race the activation and land back on the old
		// version, so only tell the waiting worker to take over — the
		// `controlling` listener reloads once it actually has. The direct reload
		// is the fallback for when there is no worker to wait on.
		if (serwist) serwist.messageSkipWaiting();
		else window.location.reload();
	}, []);

	return { needsRefresh, offlineReady, update };
}
