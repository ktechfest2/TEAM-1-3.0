/** Polling unit lookup. A plain GET form, so it works without JavaScript. */
export function UnitSearch({ defaultValue }: { defaultValue?: string }) {
  return (
    <search>
      <form action="/results" method="get" className="grid gap-2">
        <label htmlFor="unit" className="font-semibold">
          Polling unit code
        </label>
        <div className="flex flex-wrap gap-3">
          <input
            id="unit"
            name="unit"
            type="text"
            required
            pattern="\d{2}-\d{2}-\d{2}-\d{3}"
            aria-describedby="unit-help"
            defaultValue={defaultValue}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            className="min-h-12 min-w-0 flex-1 basis-56 rounded-lg border border-border bg-surface px-3 text-[max(1rem,1em)] text-ink tabular user-invalid:border-mismatch"
          />
          <button
            type="submit"
            className="min-h-12 rounded-lg bg-brand px-5 font-semibold text-brand-ink hover:opacity-90"
          >
            Find result
          </button>
        </div>
        <p id="unit-help" className="text-sm text-ink-muted">
          Format: state-LGA-ward-unit, for example 24-05-11-003. It is printed on the EC60E poster
          and on your voter&apos;s card.
        </p>
      </form>
    </search>
  );
}
