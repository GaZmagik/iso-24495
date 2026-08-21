**The direct cause:** `query` is in the effect's dependency array (line 30) and changes on every keystroke, with no debounce — so typing produces one request per character by design.

**The worse defect underneath it:** `options` is also in that dependency array, and it is a fresh object literal created on every render (line 10). React compares dependencies by identity, so the effect re-runs on *every* render, not just when `query` changes. Because each response calls `setResults(data.results)` with a newly parsed array (line 23), every request causes a render, which causes another request. That is a self-sustaining request loop that keeps firing even when nobody is typing.

The fix is to move `options` outside the component or drop it from the deps, then add a debounce on top.

## Other bugs

**1. No cleanup, so responses race (lines 12–30)**
The effect never returns a cleanup function and the fetch has no `AbortSignal`. If the response for `"ca"` arrives after the response for `"cat"`, the older results overwrite the newer ones and the list contradicts the input box. The same gap means `setResults` and `setLoading` can fire after the component unmounts.

**2. The query is not URL-encoded (line 20)**
`q=${query}` interpolates raw user text into the query string. Typing `A&B` sends a stray `B` parameter, and `#` truncates everything after it. The user sees results for a query they did not type.

**3. HTTP errors are treated as success (lines 20–25)**
`fetch` only rejects on network failure, so a 500 response flows into the `.then` chain. `res.json()` then parses an error body, `data.results` is `undefined`, and `results.map` on line 37 throws — the component crashes instead of showing the error. Checking `res.ok` before parsing fixes it.

**4. The error state is never cleared (lines 8, 26–29, 32)**
`setError` is only ever called with a message; nothing resets it to `null`. After one failed request, the guard on line 32 returns the error paragraph forever, and every later successful search is invisible.

**5. `loading` is not reset when the query is emptied (lines 13–16)**
The early return clears `results` but leaves `loading` and `error` untouched. Combined with bug 4, clearing the input can leave a stale error on screen with no way back.

## What I did not do

I made no edits, as you asked. I also did not run the component — this is a static read of the 42 lines, so the race condition in bug 1 is reasoned from the code rather than reproduced.
