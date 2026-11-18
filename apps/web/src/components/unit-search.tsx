/** Polling unit lookup. A plain GET form, so it works without JavaScript. */
export function UnitSearch({ defaultValue }: { defaultValue?: string }) {
  return (
    <search>
      <form action="/results" method="get" className="grid gap-2">
        <label htmlFor="unit" className="font-semibold text-ink">
          Find your polling unit result
        </label>
        <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-1.5 focus-within:border-brand">
          <input
            id="unit"
            name="unit"
            type="text"
            required
            pattern="\d{1,2}[\-/]\d{1,2}[\-/]\d{1,2}[\-/]\d{1,3}"
            aria-describedby="unit-help"
            defaultValue={defaultValue}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            className="min-h-12 min-w-0 flex-1 basis-48 rounded-xl bg-transparent px-3 text-[max(1rem,1em)] text-ink tabular user-invalid:text-mismatch"
          />
          <button
            type="submit"
            className="min-h-12 grow rounded-xl bg-brand px-6 font-semibold text-brand-ink hover:bg-brand-strong sm:grow-0"
          >
            Find result
          </button>
        </div>
        <p id="unit-help" className="text-sm text-ink-muted">
          Polling unit code, for example 24-05-11-003. It is on your voter&apos;s card and the
          result poster.
        </p>
      </form>
    </search>
  );
}
