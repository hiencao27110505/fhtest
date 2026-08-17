import { appActions, useTheme } from '@/providers/app/root-provider'

/**
 * Theme switcher.
 *
 * State and the DOM side effects live in the app store; this only reads the
 * current mode and cycles it. Hydration and the `prefers-color-scheme`
 * listener are handled once in `AppProvider`.
 */
export default function ThemeToggle() {
  const mode = useTheme()

  const label =
    mode === 'auto'
      ? 'Theme mode: auto (system). Click to switch to light mode.'
      : `Theme mode: ${mode}. Click to switch mode.`

  return (
    <button
      type="button"
      onClick={appActions.cycleTheme}
      aria-label={label}
      title={label}
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
    >
      {mode === 'auto' ? 'Auto' : mode === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
