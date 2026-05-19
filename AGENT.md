# AGENT.md

The agent system that maintains `/thinking`.

## Two agents, both Claude Code

**scout** — the worker. Runs daily. Reads news, picks relevant items, writes an entry, commits it.

**reviewer** — the meta-agent. Runs weekly. Reads scout's recent output and feedback signals. Proposes edits to scout's instructions via a PR.

Neither agent is a Python script or an API consumer. Both are markdown prompts executed by Claude Code in headless mode (`claude -p`) inside a GitHub Actions workflow.

## Authentication

Claude Code runs in CI authenticated with a long-lived OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`). Usage draws from my Claude subscription, not API credits. The token is generated once locally with `claude setup-token` (verify exact command — Claude Code documents the current name), stored as a GitHub repo secret.

A second secret, `AGENT_GITHUB_TOKEN`, is a GitHub PAT used by the workflow to push commits and open PRs.

## Directory structure

```
agent/
├── SKILLS.md              # scout's instructions. The "soul" of the worker.
├── projects-context.md    # facts about my work for the agent to reason against
├── sources.yaml           # curated RSS feeds and APIs scout reads
├── sources-status.json    # auto-maintained: which feeds are alive/dead
├── scout-prompt.md        # the prompt Claude Code executes daily
├── reviewer-prompt.md     # the prompt Claude Code executes weekly
├── entries/
│   └── YYYY-MM-DD.json    # one per day, written by scout
├── feedback/
│   └── <uuid>.json        # vote signals, one file per voting event
└── retrospectives/
    └── YYYY-MM.md         # optional monthly hindsight notes

.github/workflows/
├── scout.yml              # daily cron
└── reviewer.yml           # weekly cron

functions/api/
└── vote.ts                # Cloudflare Pages Function for vote persistence

src/pages/
└── thinking.astro         # the /thinking page

docs/
└── SECRETS-SETUP.md       # step-by-step setup instructions for me
```

## Entry schema (`agent/entries/YYYY-MM-DD.json`)

```json
{
  "date": "2026-05-19",
  "items": [
    {
      "id": "2026-05-19-a",
      "kind": "improvement" | "new-project" | "quiet-day",
      "source_title": "Anthropic releases MCP transport spec",
      "source_url": "https://...",
      "source_name": "Anthropic Blog",
      "headline": "MCP transport spec is cleaner now",
      "body": "Two-to-four sentence agent-voice note connecting this to my work or proposing a project.",
      "related_project": "ADO MCP Server" | "Dota Weakness Report" | null,
      "confidence": 0.0-1.0
    }
  ],
  "meta": {
    "sources_checked": 6,
    "sources_failed": 0,
    "generated_at": "2026-05-19T13:04:22Z"
  }
}
```

A `quiet-day` entry has one item with `kind: "quiet-day"`, no `source_*` fields, and an honest body. Never fabricate.

## Vote schema (`agent/feedback/<uuid>.json`)

```json
{
  "entry_id": "2026-05-19-a",
  "signal": "up" | "down",
  "voted_at": "2026-05-19T22:15:00Z",
  "ip_hash": "<sha256 of IP + daily salt>"
}
```

One file per vote. IP is hashed with a daily-rotating salt for dedup without storing actual IPs. Pages Function rejects duplicate (ip_hash, entry_id) pairs within 24h.

## SKILLS.md is the agent's soul

`SKILLS.md` is what scout reads to decide how to behave. It is the only file the reviewer agent is allowed to edit. It contains both **tunable** sections and `# IMMUTABLE` sections.

Tunable:
- Voice/tone guidance
- "What counts as relevant" criteria
- Source weighting hints
- Confidence calibration rules

Immutable (reviewer must not touch):
- Output JSON schema
- The quiet-day rule
- The honesty rules (no fabrication, no clickbait)
- Cost/turn discipline

The page shows "tuned N times" computed from `git log --oneline -- agent/SKILLS.md | wc -l`.

## Feedback floor

Reviewer requires ≥ 5 thumb signals in the review period to propose any changes. Below that, it opens a no-op PR (`tune skills: no changes (insufficient signal)`) and exits. Better silence than overfitting.

## Cost and runtime discipline

- Scout: max 8 turns per run
- Reviewer: max 10 turns per run
- Both use Claude Code's default Sonnet model
- Workflows have a 10-minute timeout safety net

If either agent hits the turn limit, it writes a minimal valid output (quiet-day for scout, no-op PR for reviewer) and exits cleanly.

## Failure modes

Acceptable:
- Scout finds nothing → quiet-day entry. Charming.
- A feed is dead → logged in `sources-status.json`, skipped. After 3 consecutive failures, the source is removed from `sources.yaml` with commit message `remove dead source: <name>`.
- Reviewer has insufficient signal → no-op PR.
- Vote button fails silently → console logged, not alerted.

Not acceptable:
- Scout fabricates a source URL or content. The quiet-day escape exists to prevent this.
- Reviewer rewrites SKILLS.md without grounding. The 5-signal floor exists to prevent this.
- Either agent loops past its turn cap and burns subscription credit.