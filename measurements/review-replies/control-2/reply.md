## Why it fires on every keystroke

Two layers, and the second is the real bug.

**1. The direct cause (baked in):** the parent re-renders `SearchResults` with a new `query` on each keystroke, the effect lists `query` as a dependency, and there's no debounce. So one request per keystroke is by design.

**2. The actual bug — it's far worse than per-keystroke.** `options` (line 10) is recreated as a new object literal on *every* render, and it's in the dependency array (line 30). React compares deps with `Object.is`, so the deps always differ and the effect re-runs after every committed render.

That closes a self-perpetuating loop:

```
effect runs → fetch → .then(setResults(data.results))
   ↑                          ↓  (freshly-parsed array = new identity, no bailout)
   └──── effect re-runs ←── re-render
```

Each response forces a render, each render re-runs the effect, each effect run fires another request — an unbounded request loop paced only by network latency, with no keystrokes required. `setLoading(false)` compounds it.

The same spin happens with an **empty** query too: the `!query` branch calls `setResults([])` with a new empty array each time → re-render → new `options` → effect again. No network traffic, but an endless render/effect cycle. The bug isn't gated on typing at all.

## Other bugs, roughly by severity

**`query` isn't URL-encoded** (line 20). `` `?q=${query}` `` breaks on `&`, `#`, `+`, and spaces — typing `a&b=c` corrupts the query string and injects a bogus parameter. Needs `encodeURIComponent(query)`.

**No `res.ok` check** (line 21). A 4xx/5xx that returns a JSON error body parses fine, so `data.results` is `undefined` → `setResults(undefined)` → `results.map` throws a TypeError on the next render. The `.catch` doesn't help because nothing rejected.

**No request cancellation → stale-response race.** The effect has no cleanup and no `AbortController`. Type `ab` then `abc`; if the `ab` response lands second, it overwrites the `abc` results. Responses aren't guaranteed to arrive in request order.

**One error permanently bricks the component.** `setError` is never reset to `null` at the start of a new request, and line 32 returns early. After a single failure the component renders the error text forever — subsequent successful searches set `results`, but the early return means they're never displayed.

**Clearing the input doesn't cancel in-flight work.** The `!query` branch (lines 13–16) returns without resetting `loading`, and an outstanding request still resolves and calls `setResults(...)` — so results reappear for an empty query, and `loading` can stay `true` in the meantime.

**Minor:**
- `err.message` in the catch assumes an `Error`; a thrown non-Error yields `undefined` as the message.
- `data` is implicitly `any` — `Result[]` is asserted by the `useState` generic but never validated at the boundary.
- Previous results stay visible underneath "Loading..." during a new search, which reads as stale data rather than a pending state.
- State updates after unmount (no cleanup) — harmless in React 18+, but it's the same missing-cleanup gap as the race above.

**Fix for the headline issue:** move `options` outside the component (or inline it into the `fetch` call) and drop it from the deps — it's a constant. Then add a debounce and an `AbortController` cleanup.

I haven't modified anything, including the empty `reply.md` in this directory.
