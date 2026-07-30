# Baseline v2, the post-launch production reference

Captured against live `https://jmbt.dev` immediately after the launch merge, and
this is the set the analytics watch compares against from here on.

| | |
|---|---|
| Deployed commit | `cd45850`, merge of PR #8 into `main` |
| Contains | the graded collection landing (PR #8) and the inner page retheme (PR #9) |
| Captured | 2026-07-30, Lighthouse 13.4.1 |
| Previous baseline | [../baseline-v1/](../baseline-v1/), the pre-revamp site at `8e84b73` |

## Why v1 is not a like-for-like comparison

`baseline-v1` measured a different site. Its Lighthouse runs are the original
dark, static portfolio; this one is the paper landing with a lazily hydrated
three.js island. Performance numbers are comparable in the sense that both are
production runs, but a regression hunt should diff v2 against later v2-era runs
rather than reading across the launch.

The one number that genuinely moved on merit is accessibility, 95 to 100. The
old 95 was a `color-contrast` failure across 35 nodes, caused by the `rise`
reveal animating opacity from 0.2 so that body copy sampled mid-reveal composited
to `#363636` on `#0a0a0a`. That reveal is transform-only now.

## Scores

All three routes, both form factors, production.

| Route | Form factor | Perf | A11y | Best practices | SEO | Agentic |
|---|---|---|---|---|---|---|
| `/` | desktop | 100 | 100 | 100 | 100 | 100 |
| `/` | mobile | 99 | 100 | 100 | 100 | 100 |
| `/projects/` | desktop | 100 | 100 | 100 | 100 | 100 |
| `/projects/` | mobile | 99 | 100 | 100 | 100 | 100 |
| `/about/` | desktop | 100 | 100 | 100 | 100 | 100 |
| `/about/` | mobile | 100 | 100 | 100 | 100 | 100 |

SEO reads 100 here. The 66 seen during Phase 5 was the Cloudflare Pages preview
deployment sending its own `noindex`, which production does not.

## Contents

- `lighthouse/` JSON for all six runs, which is what to diff. HTML is kept for
  the two `/` runs only, since six full reports is roughly 3.6 MB of duplicate
  detail that the JSON already carries.
- `screenshots/` all four routes at 1440x900 and 390x844, viewport and full
  page, plus `probe.json` recording the computed tokens, painted background and
  overflow state for each.

## Standing recovery path

If a deploy needs to be undone, revert the merge commit and let Pages rebuild
from the revert. Never force push `main`.

    git revert -m 1 cd45850
