# Traffic data

This branch holds nothing but recorded GitHub traffic figures for
[iso-24495](https://github.com/GaZmagik/iso-24495). It shares no history with
`main`, so the daily commits here never clutter the code history.

The `Traffic snapshot` workflow on `main` writes to it once a day. GitHub keeps
traffic for only fourteen days and then discards it, so a figure that is not
written down here is lost for good.

## What each file holds

| File | One row per | Holds |
|---|---|---|
| `data/daily.csv` | calendar day | clones, unique cloners, views, unique visitors |
| `data/windows.csv` | snapshot run | the rolling fourteen-day totals, plus stars, forks and watchers |
| `data/referrers.csv` | snapshot run and referrer | views and unique visitors from that source |

## Why the window figures need their own file

You cannot rebuild `windows.csv` from `daily.csv`. GitHub de-duplicates a
cloner who returns on a later day, so the window uniques are smaller than the
daily uniques added together. On 22 August 2026 the daily uniques summed to
686 while GitHub reported 587 for the window. The smaller figure is the more
useful one, and only the snapshot preserves it.

## Reading these numbers honestly

- **None of this is an install count.** Claude Code sends no telemetry to
  plugin authors, so unique cloners is a proxy and nothing more.
- **The workflow inflates its own figures.** Each daily run checks out the
  repository twice, so expect roughly two machine clones a day that no person
  performed. The `Tests` workflow adds more on every push and pull request.
- **A day may be corrected.** The current day's figures are still moving when
  a run reads them, so a later run overwrites that day's row.
- **A missed day usually repairs itself.** Every run re-reads the whole
  fourteen-day window, so one failed run loses nothing as long as the next
  fourteen days contain a successful one.
- **Scheduled workflows stop after sixty days of repository inactivity.** If
  the repository goes quiet, check that this job is still running.

## Running it by hand

From a checkout of `main`, with a fine-grained token that has Administration
(read) on the repository:

```bash
GITHUB_TRAFFIC_TOKEN=<token> bun scripts/traffic-snapshot-cli.ts <path>/data
```

Add `--dry-run` to print the merged tables without writing them.
