**The keystroke fetch is the visible edge of a worse bug: the effect refires on every render, so the component fetches in a self-sustaining loop.**

## Why it fires on every keystroke

`query` is an effect dependency and there is no debounce. Each keystroke changes `query`, so the effect re-runs and calls `fetch`. That alone explains one request per character.

## Why it is worse than that

`options` is recreated on every render and is also a dependency:

[`SearchResults.tsx:L10`](./SearchResults.tsx#L10) and [`L30`](./SearchResults.tsx#L30):

```tsx
const options = { headers: { "content-type": "application/json" } };
// ...
}, [query, options]);
```

React compares dependencies with `Object.is`. A fresh object literal never matches the previous one, so the effect runs after **every** render. That closes a loop:

```
fetch resolves → setResults(new array) → re-render
  → new options object → deps differ → effect runs → fetch → …
```

`setResults` always receives a fresh array, so React never bails out of the re-render. The loop sustains itself with nobody typing. `setLoading(true)` at [`L18`](./SearchResults.tsx#L18) adds a further render, and therefore a further fetch, per cycle.

## Other bugs

| # | Defect | Evidence | Effect |
|---|---|---|---|
| 1 | No cleanup or cancellation | effect returns nothing at [`L12-L30`](./SearchResults.tsx#L12-L30) | Responses land out of order. A slow reply for `"ab"` overwrites the reply for `"abc"`, so the list disagrees with the input box. |
| 2 | `query` is not escaped | `` `/api/search?q=${query}` `` at [`L20`](./SearchResults.tsx#L20) | Typing `&`, `#` or `+` corrupts the request. `a&b` sends `q=a` plus a stray parameter `b`. |
| 3 | `error` is never cleared | set at [`L27`](./SearchResults.tsx#L27), read at [`L32`](./SearchResults.tsx#L32) | One failure disables the component permanently. Later searches still run, but the early return renders the old message forever. |
| 4 | No `res.ok` check | [`L21`](./SearchResults.tsx#L21) | `fetch` rejects only on network failure. A 500 with an HTML body reaches `res.json()`, which throws `Unexpected token '<'` — shown to the user as the error text. |
| 5 | `data.results` is unvalidated | [`L23`](./SearchResults.tsx#L23) | `res.json()` returns `any`, so a payload shaped differently puts `undefined` into state. The next render crashes at `results.map` on [`L37`](./SearchResults.tsx#L37). |

Two smaller points. The empty-query branch at [`L13-L16`](./SearchResults.tsx#L13-L16) clears `results` but leaves `loading` true, and an in-flight response then repopulates the cleared list. The loading row also renders above stale results rather than replacing them.

## Status

I read the file and analysed it; I made no edits, as you asked. Nothing here is runtime-verified, because the directory holds only this one file, with no project, dependencies, or test setup to run it against.
