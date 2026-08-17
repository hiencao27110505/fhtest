import { usePwa } from "#/hooks/use-pwa.ts";

/**
 * Registers the service worker and offers the new version when one is waiting.
 *
 * Rendering this once, near the root, is the whole PWA client integration.
 */
export function PwaUpdatePrompt() {
  const { needsRefresh, update } = usePwa();

  if (!needsRefresh) return null;

  return (
    // `<output>` carries an implicit `status` role, so screen readers announce
    // this politely when it appears without stealing focus.
    <output
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-[rgba(46,158,107,0.32)] bg-[var(--surface-strong)] px-4 py-3 shadow-lg backdrop-blur sm:inset-x-auto sm:right-4"
    >
      <p className="m-0 flex-1 text-sm text-(--sea-ink)">
        Đã có phiên bản mới.
        <span className="block text-xs opacity-65">
          A new version is ready.
        </span>
      </p>
      <button
        type="button"
        onClick={update}
        className="min-h-11 shrink-0 rounded-full border border-[rgba(46,158,107,0.4)] bg-[rgba(46,158,107,0.16)] px-4 py-2 text-sm font-semibold text-[#2E9E6B] transition hover:bg-[rgba(46,158,107,0.26)]"
      >
        Tải lại
      </button>
    </output>
  );
}
