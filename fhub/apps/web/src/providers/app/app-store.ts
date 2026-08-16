import { Store, shallow } from "@tanstack/store";

/**
 * Global app state that is not auth and not server data.
 *
 * Deliberately separate from the auth store: auth is provider-driven and
 * server-verified, this is user-driven and partly persisted. Keeping them apart
 * means a token refresh cannot re-render a sidebar, and clearing a session does
 * not reset someone's theme.
 *
 * Server data belongs in TanStack Query, not here. This is for state the client
 * owns outright.
 */

export type ThemeMode = "light" | "dark" | "auto";
/** What `mode` resolves to once the system preference is taken into account. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export interface AppState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  /** Mobile nav / sidebar disclosure. */
  sidebarOpen: boolean;
  /** Id of the modal currently open, or null. One at a time by design. */
  activeModal: string | null;
}

/**
 * Read the persisted mode.
 *
 * Must agree with THEME_INIT_SCRIPT in `routes/__root.tsx`, which runs before
 * paint to set the same classes. If the two disagree the page flashes.
 */
export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // Safari in private mode throws on localStorage access.
  }
  return "auto";
}

export function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "auto") return mode;
  return prefersDark() ? "dark" : "light";
}

/**
 * Initial state.
 *
 * On the server this is always "auto"/"light" — there is no request-time way to
 * know the visitor's preference. The pre-paint script fixes the DOM before
 * first paint, and `AppProvider` syncs the store on mount, so the wrong initial
 * value is never visible.
 */
export const appStore = new Store<AppState>({
  theme: "auto",
  resolvedTheme: "light",
  sidebarOpen: false,
  activeModal: null,
});

/** Apply the theme to the document. The store is the source of truth; this mirrors it. */
export function applyThemeToDocument(mode: ThemeMode, resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);

  // `data-theme` marks an explicit choice. Its absence is what lets the
  // `:root:not([data-theme="light"])` media rules in styles.css follow the
  // system preference.
  if (mode === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }

  root.style.colorScheme = resolved;
}

/** Set the theme, mirror it to the DOM, and persist the choice. */
export function setTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);

  appStore.setState((prev) =>
    prev.theme === mode && prev.resolvedTheme === resolved
      ? prev
      : { ...prev, theme: mode, resolvedTheme: resolved },
  );

  applyThemeToDocument(mode, resolved);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

/**
 * Re-resolve without changing the mode.
 *
 * For the `prefers-color-scheme` listener: in "auto" the mode is unchanged but
 * what it resolves to just flipped.
 */
export function syncResolvedTheme() {
  const { theme } = appStore.state;
  const resolved = resolveTheme(theme);

  appStore.setState((prev) =>
    prev.resolvedTheme === resolved
      ? prev
      : { ...prev, resolvedTheme: resolved },
  );

  applyThemeToDocument(theme, resolved);
}

/** light -> dark -> auto -> light. Matches the existing toggle's order. */
export function cycleTheme() {
  const { theme } = appStore.state;
  setTheme(theme === "light" ? "dark" : theme === "dark" ? "auto" : "light");
}

export function setSidebarOpen(open: boolean) {
  appStore.setState((prev) =>
    prev.sidebarOpen === open ? prev : { ...prev, sidebarOpen: open },
  );
}

export function toggleSidebar() {
  setSidebarOpen(!appStore.state.sidebarOpen);
}

export function openModal(id: string) {
  appStore.setState((prev) =>
    prev.activeModal === id ? prev : { ...prev, activeModal: id },
  );
}

export function closeModal() {
  appStore.setState((prev) =>
    prev.activeModal === null ? prev : { ...prev, activeModal: null },
  );
}

export const selectTheme = (state: AppState) => state.theme;
export const selectResolvedTheme = (state: AppState) => state.resolvedTheme;
export const selectSidebarOpen = (state: AppState) => state.sidebarOpen;
export const selectActiveModal = (state: AppState) => state.activeModal;

export { shallow };
