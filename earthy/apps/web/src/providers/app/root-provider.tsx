import { useEffect } from "react";
import { useSelector } from "@tanstack/react-store";
import type { ReactNode } from "react";
import {
  appStore,
  applyThemeToDocument,
  closeModal,
  cycleTheme,
  openModal,
  readStoredTheme,
  resolveTheme,
  setSidebarOpen,
  setTheme,
  syncResolvedTheme,
  toggleSidebar,
  type AppState,
} from "./app-store.ts";

/**
 * Owns the browser-side effects behind the app store.
 *
 * Two things have to happen once, app-wide, and neither belongs in a component:
 * hydrating the persisted theme into the store, and listening for system
 * preference changes. Components just read slices and call actions.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // The pre-paint script in `__root.tsx` already set the DOM from
    // localStorage. This catches the store up to it, so the UI agrees with what
    // is already on screen rather than briefly rendering the "auto" default.
    const stored = readStoredTheme();
    appStore.setState((prev) => {
      const resolved = resolveTheme(stored);
      return prev.theme === stored && prev.resolvedTheme === resolved
        ? prev
        : { ...prev, theme: stored, resolvedTheme: resolved };
    });
    applyThemeToDocument(stored, resolveTheme(stored));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    // Only matters in "auto", but subscribing unconditionally keeps this
    // effect from re-running every time the mode changes. `syncResolvedTheme`
    // is a no-op when the resolved value did not move.
    const onChange = () => syncResolvedTheme();
    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  return <>{children}</>;
}

/** Read any slice of app state. */
export function useApp<T>(
  selector: (state: AppState) => T,
  compare?: (a: T, b: T) => boolean,
): T {
  return useSelector(appStore, selector, { compare });
}

export const useTheme = () => useSelector(appStore, (s) => s.theme);
export const useResolvedTheme = () =>
  useSelector(appStore, (s) => s.resolvedTheme);
export const useSidebarOpen = () => useSelector(appStore, (s) => s.sidebarOpen);
export const useActiveModal = () => useSelector(appStore, (s) => s.activeModal);

/**
 * Actions are plain module functions, not context values.
 *
 * They never change identity, so there is nothing to memoize and no provider
 * lookup — unlike the auth actions, which close over the router.
 */
export const appActions = {
  setTheme,
  cycleTheme,
  setSidebarOpen,
  toggleSidebar,
  openModal,
  closeModal,
};
