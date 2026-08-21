It fires on every *render*, not just every keystroke — and that is worse than the symptom you described. Two separate causes stack up.

## Why it refetches

**1. `options` is a new object on every render (line 10, line 30).**
The effect lists `options` in its dependency array. React compares dependencies by identity, so a freshly created object never matches the previous one, and the effect re-runs after every single render.

**2. That loop is self-sustaining.**
Each response calls `setResults(data.results)` with a newly parsed array (line 23). The identity always differs, even when the data is identical, so the component re-renders → new `options` → new fetch. The `setLoading(true)` bail-out does not stop this, because `setResults` re-renders unconditionally.

**3. There is no debounce.**
`query` is a dependency (line 30) and the parent passes the raw input value, so each character typed queues its own request even after you fix `options`.

## Other bugs

Ranked by impact:

1. **Race condition — no abort or stale-response guard (lines 20–29).** A slow request for `"ca"` can resolve after a fast one for `"cat"`, so the list shows results for a query the user has moved past. Fix: an `AbortController` aborted in the effect cleanup.
2. **No `res.ok` check (line 21).** On an HTTP 500 returning `{"error": "..."}`, `data.results` is `undefined`, `setResults(undefined)` runs, and `results.map` on line 37 throws a `TypeError` on the next render — the component crashes rather than showing the error.
3. **`error` is never reset to `null`.** It is set on line 27 but nothing clears it, so line 32 returns the error paragraph forever. One failed request permanently disables the component for the rest of its life.
4. **`query` is not URL-encoded (line 20).** A query containing `&`, `#`, `+`, or a space corrupts the request — `a&b=1` injects a parameter, and `#` truncates the query server-side. Fix: `encodeURIComponent(query)`.
5. **The empty-query branch leaks state (lines 13–16).** It clears results but leaves `loading` at `true` and does not cancel the in-flight fetch. Clearing the input mid-request leaves a stuck "Loading..." row, then repopulates the list with stale results when that request lands.

Two minor points: `setLoading`/`setResults` can fire after unmount (no cleanup), and lines 36–39 render "Loading..." above stale results rather than replacing them.

## Fix sketch

Move `options` inside the effect (or out of the component) and drop it from the deps; debounce `query` before it reaches the effect; add an `AbortController` with cleanup; check `res.ok`; clear `error` at the start of each request; encode `query`.

I read the file only — no edits made, and `reply.md` in the same directory was left untouched.
