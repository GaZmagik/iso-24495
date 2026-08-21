# Half the prose, the same bugs

## What an output style does to Opus 5, measured

Every prompt-engineering post claims to make the model less verbose. Almost none of them measure it, and none of them check the obvious risk: that a model told to be brief becomes a model that misses things.

So I measured both. I maintain an MIT-licensed Claude Code plugin that holds every reply to the plain language principles of the ISO 24495 series. Here is what it does to Claude Opus 5, and what it does not do.

## The setup

Two arms, one prompt, three runs each, Opus 5 in both. The only difference between arms is whether the output style is switched on.

The fixture is a React component with a bug you have probably shipped:

```tsx
const options = { headers: { "content-type": "application/json" } };

useEffect(() => {
  if (!query) { setResults([]); return; }
  setLoading(true);
  fetch(`/api/search?q=${query}`, options)
    .then((res) => res.json())
    .then((data) => { setResults(data.results); setLoading(false); })
    .catch((err) => { setError(err.message); setLoading(false); });
}, [query, options]);
```

`options` is rebuilt on every render and sits in the dependency array. The effect therefore refires on every render, and each response schedules the next request. It is an infinite fetch loop paced by network latency. There is no cleanup either, so a slow response can overwrite a newer one.

The prompt asks why the component fetches on every keystroke, and whether there are other bugs.

## Result one: the reply gets shorter, and finds the same bugs

Per reply, median of three runs, counting prose and excluding code blocks:

| Measure | Style off | Style on |
|---|---|---|
| Words of prose | 513 | 417 |
| Sentences | 35 | 26 |
| Longest sentence | 35 words | 32 words |

Prose fell by 19 per cent and sentence count by 26 per cent. The longest sentence barely moved, which surprised me, because capping sentence length is one of the rules.

More importantly, nothing was lost. All six runs found the dependency-array loop. All six found the missing cleanup. Five of six mentioned the unencoded query string.

Here are the opening lines, same prompt, same model. I have taken each arm's median run by length, rather than the pair that flatters the result most.

Without the style:

> ## Why it fires on every keystroke
>
> Two layers, and the second is the real bug.

With the style:

> **The direct cause:** `query` is in the effect's dependency array (line 30) and changes on every keystroke, with no debounce.

One opens with a heading and a teaser. The other opens with the answer. That is the whole difference in miniature.

## Result two: it leaves your code alone

A style that governs prose could easily leak into the code itself. That is the objection I would raise, so I tested it before publishing.

Different task: implement a duration parser from a written specification. `1h30m` becomes 5400000. Decimals allowed, units case-insensitive, `RangeError` on a negative value, `TypeError` on anything else invalid. Three runs per arm again.

First, correctness, so that we are comparing working code with working code. I scored every implementation with 16 hidden tests the model never sees. All six scored 16 out of 16.

Then readability, measured four ways across the six files:

| Measure | Style off | Style on |
|---|---|---|
| Lines of code, mean | 67 | 65 |
| Comment lines per file, mean | 11 | 9 |
| Words per comment line | 10.8 | 10.5 |
| Longest comment sentence | 15 words | 14 words |
| Mean words per error message | 8.5 | 7.9 |
| Error messages showing the offending value | 14 of 17 | 13 of 14 |
| Identifier length, mean characters | 8.6 | 7.6 |
| Identifiers of one or two characters | 0 | 0 |

Every one of those gaps is smaller than the run-to-run variation. The honest reading is that the style made no measurable difference to the code.

I then tried a harder task, because an easy one can hide a difference. This time an expression evaluator: precedence, right-associative `^`, unary minus, parentheses, and errors that report the position of the offending character. Twenty-five hidden tests.

Every run passed all 25, in both arms. The structure did not move either: a median of 12 named functions or methods without the style against 11 with it, and both arms reached for the same recursive-descent design. The styled code carried a few more comment lines, 21 against 17 at the median, but the ranges overlap and I would not claim that at three runs per arm.

That is the documented behaviour rather than a surprise. The skills exempt code blocks, commands and logs, and this is what that exemption looks like when you measure it. The style reshapes the prose around the code and stops at the fence.

It cuts both ways, so be clear about it. If your complaint is that the model writes rambling explanations, this helps. If your complaint is that it writes unreadable code, this is not the tool, and no measurement here suggests otherwise.

On the coding task the style also saved no words in the reply. The styled replies averaged 496 words against 470 without it. When most of a reply is a code block, a prose style has little to work on. The verbosity gain lives in prose.

## The finding I did not expect

The styled replies grew sections the unstyled ones never wrote. Two of the three ended with headings like **What I did not do** and **Status**.

That comes from a rule about reporting work: separate what you built from what you verified, and name every check still open. The practical effect is that the model stops implying it did more than it did. For anyone reviewing agent output, that is worth more than the word count.

## What this does not show

I tested one model, one fixture per task, and three runs per arm. Repeated runs under identical conditions vary, so treat single-run differences as noise and the medians as indicative.

I also tested reply quality with mechanical checks and my own reading, not with a blind panel. Nobody has judged these replies except me, and I wrote the plugin.

## Two methodology traps, if you try this yourself

**Your own instructions will hide the effect**. My first attempt at this measurement found nothing at all. The reason was embarrassing and instructive: my global `CLAUDE.md` already told every session to write this way, so the control arm was never unstyled. The measured effect was zero because the treatment had nothing left to add. Any A/B test of instruction files has to neutralise the instructions you forgot you were already giving.

**Moving your config aside is more dangerous than it looks**. To get a clean control I moved my global instruction files out of the way and restored them afterwards with a shell trap. A batch then exceeded my tool's ten-minute timeout. The timeout kills the shell before the trap runs, so the restore never happened. I then spent a while repairing a machine whose instructions had silently vanished mid-session.

**My own measuring tool flattered the result**. My first pass reported that sentences fell by 52 per cent. They did not.

The sentence splitter treated a full stop inside bold, as in `**Lead in.** Next sentence.`, as no boundary at all. It merged pairs of sentences and undercounted them. Both arms write that markdown pattern, and the styled replies write it more, so the bug exaggerated the very effect I was hoping to find. The corrected figure is 26 per cent.

If you are measuring text, test your measurement on text you have counted by hand first. I did not, and I nearly published a number twice the size of the real one.

The fix was to stop moving files at all. Claude Code takes `--setting-sources project`, which excludes user-level configuration for that run, and the style can be supplied as a project file instead. Nothing on disk changes. If you are benchmarking instruction files, use the flag rather than the trap.

## Try it

The plugin is free and MIT licensed. It ships six skills and an output style.

```
/plugin marketplace add https://github.com/GaZmagik/iso-24495.git
/plugin install iso-24495-plain-language@iso-24495
```

It installs in Codex from the same address, and `npx skills add gazmagik/iso-24495` covers the other agents that read the Agent Skills format.

The rules are my interpretation of the published standards, and the plugin makes no conformance claim. It reports mechanical findings and leaves the judgement to you.

Repository: https://github.com/GaZmagik/iso-24495
