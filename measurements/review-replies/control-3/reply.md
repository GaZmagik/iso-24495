## Why it fires on every keystroke

Two separate causes, and the second is much worse than the first.

**1. No debounce (the surface answer).** `query` is a prop that changes on each keystroke, and the effect is keyed on `[query, ...]`. Every character typed = one request. That's the expected-but-unwanted behaviour.

**2. `options` is an unstable dependency (the actual bug).** `SearchResults.tsx:10` recreates the `options` object on *every render*, and it's in the dep array at line 30. Object identity changes each render, so the effect re-runs each render — and it's self-sustaining:

```
effect → fetch → res.json() → setResults(fresh array reference)
       → re-render → new `options` object → effect → fetch → …
```

`setResults` always receives a brand-new array from `res.json()`, so React never bails out of the re-render. Note this is *not* a synchronous render loop — `setLoading(true)` when it's already `true` does bail out via `Object.is`. It's an **infinite request loop paced by network latency**: each response schedules the next request. The component keeps hammering `/api/search` forever, even when the user stops typing.

## Other bugs

**Race condition / stale responses (lines 12–30).** No cleanup function and no `AbortController`. Responses can resolve out of order, so a slow request for `"ca"` can overwrite the results for `"cat"`. Concrete failure: user clears the input → the `!query` branch sets `results` to `[]` → the still-in-flight response then resolves and *restores the old results* into an empty search box. (Same missing cleanup also leaves `loading` stuck `true` in some clear-while-loading paths, though a pending fetch usually resolves it.)

**`error` is never reset — the component is permanently bricked after one failure (lines 8, 26–27, 32).** Nothing ever calls `setError(null)`. Combined with the `if (error) return` early return, one transient network blip means the user sees the error string forever; typing a new query re-fetches successfully but the results are never rendered again.

**No `res.ok` check → render crash on a server error (lines 20–23).** A 500 that returns an HTML error page either makes `res.json()` throw (caught, shows a confusing JSON-parse message) or parses to an object without `.results`. In the latter case `results` becomes `undefined` and `results.map` at line 37 throws during render, taking down the tree. `res.json()` only rejects on malformed JSON — it does not care about HTTP status.

**Query isn't URL-encoded (line 20).** `` `/api/search?q=${query}` `` breaks on `&`, `#`, `+`, and spaces. Typing `a&b=1` injects a bogus query parameter. Needs `encodeURIComponent(query)`.

**The `options` object is meaningless anyway (line 10).** `content-type` describes a request *body*; a GET has none. So the fix isn't to hoist or `useMemo` it — just delete it and drop it from the deps.

Minor: setState-after-unmount is technically possible here but harmless on React 18+ (the warning was removed).

## Suggested fixes, in priority order

1. Delete `options` entirely; dep array becomes `[query]`.
2. Add an `AbortController` and return a cleanup function from the effect that aborts; ignore `AbortError` in the catch.
3. Call `setError(null)` at the start of each effect run, and render the error inline rather than as an early return so results/loading still work.
4. Check `res.ok` before `res.json()`, and guard with `data.results ?? []`.
5. Wrap the query in `encodeURIComponent`.
6. Debounce (~250–300 ms) inside the effect via `setTimeout` + `clearTimeout` in the cleanup.

No files were modified.
