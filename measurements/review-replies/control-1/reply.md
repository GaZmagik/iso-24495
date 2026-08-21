## Why it fires on every keystroke

Two separate causes, and the second one is worse than the premise of your question.

**1. No debounce.** `query` is a prop, it's in the dependency array (`SearchResults.tsx:30`), and the parent presumably updates it on each `onChange`. So at minimum one fetch per character typed.

**2. `options` is recreated on every render** (`SearchResults.tsx:10`), and it's also in the dependency array. Object literals get a new identity each render, so React's `Object.is` dep comparison always sees a change. That means the effect re-runs on *every render*, not just when `query` changes.

That turns into a self-sustaining loop: fetch resolves → `setResults(data.results)` sets a fresh array (always a state change) → re-render → new `options` object → effect re-runs → fetch → repeat. It never converges. As long as `query` is non-empty, the component hammers `/api/search` in a loop paced only by network latency — even if the user stops typing entirely.

## Other bugs

**Crash on any error response** (`:21`, `:23`, `:37`). `fetch` doesn't reject on 4xx/5xx. A 500 returning `{"error": "..."}` parses fine, `data.results` is `undefined`, `setResults(undefined)`, and then `results.map` throws a TypeError that takes the component down. There's no `res.ok` check.

**Race condition — stale results can overwrite fresh ones** (`:20`). No `AbortController` and no effect cleanup. Type `a` then `ab`: if the `a` response lands second, you display results for `a` while the input says `ab`. Same gap causes setState-after-unmount if the component goes away mid-flight.

**`error` is never cleared** (`:8`, `:32`). Once set, nothing resets it. The early `return <p>{error}</p>` permanently replaces the entire list — one transient network blip and the component is dead for the rest of its life, no matter how many successful searches follow.

**Query isn't URL-encoded** (`:20`). `` `?q=${query}` `` breaks on `&`, `#`, `+`, and spaces. Searching `foo&bar=1` injects a spurious parameter into the request.

**The empty-query branch leaks state** (`:13-16`). It clears `results` but not `loading` or `error`. Clear the input while a request is in flight and you're left with a stuck "Loading..." — plus the in-flight request still resolves and repopulates `results` for a query the user already erased.

**Minor:** the `content-type: application/json` header on a bodyless GET does nothing useful and, cross-origin, is enough to force a CORS preflight on every request. And `loading` renders *alongside* stale results rather than replacing them, so users see old data labelled as loading.

## The shape of the fix

Move `options` inside the effect (or drop it), debounce `query` before it hits the effect, wire an `AbortController` into the cleanup, check `res.ok` before `res.json()`, and reset `error` at the top of each new request.

No files were modified.
