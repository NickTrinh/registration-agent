// Implements: ADR 0024 (the annotated worksheet, not a chat app)
//
// The old status bar was a permanent colored card — GREEN, forever, to
// announce that nothing was wrong: the loudest treatment for the most boring
// fact. This is its replacement: a 28px strip flush under the header. One
// quiet line when things work; while a turn is in flight, a 1px maroon
// hairline sweeps along its bottom edge — the panel's ONE indeterminate
// indicator. Degraded states don't render here at all: the caller swaps the
// strip for a <Notice>, which owns everything that has a severity.

export default function StatusStrip({
  text,
  busy = false,
}: {
  text: string;
  busy?: boolean;
}) {
  return (
    <div className="relative shrink-0 h-7 flex items-center px-3 border-b border-stone-100 dark:border-stone-800">
      <p className="text-xs text-stone-600 dark:text-stone-400 truncate">{text}</p>
      {busy && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px overflow-hidden"
        >
          <span className="block h-full w-1/3 bg-fordham-maroon dark:bg-fordham-maroon-ink animate-sweep" />
        </span>
      )}
    </div>
  );
}
