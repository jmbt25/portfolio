# CONTENT.md

All copy lives here. Used verbatim by the pages. Do not paraphrase.

## Placeholders to replace before deploy

- `{{github_handle}}` — used in header brand, footer link, and project source link
- `{{your_name}}` — display name on the home hero

## Home page (`/`)

### Hero

Display name: `{{your_name}}`

Role line: `data scientist · ai systems engineer`

Bio paragraph 1:
> Six years building data and ML systems. Currently at MBM IT Consulting. MS in Data Science from the Asian Institute of Management.

Bio paragraph 2:
> I spend most of my day in Claude Code, shipping AI-powered tools — MCP servers, NLP pipelines, LLM integrations — and the kind of small, opinionated software I want to exist.

### Elsewhere section

```
github.com/{{github_handle}} · code, in progress and otherwise
```

## About page (`/about`)

### Bio paragraph 1

> I'm a Data Scientist and AI Systems Engineer with 6+ years of experience building production data and ML systems. I work at the intersection of rigorous data work and the new generation of AI tooling — using Claude Code daily and building MCP servers, NLP pipelines, and LLM-powered applications.

### Bio paragraph 2

> My background is in data science fundamentals: pipelines, modeling, evaluation. What I care about now is closing the loop between those foundations and the AI systems that are reshaping how software gets built. I like writing small, opinionated tools that do one thing well.

### Current (definition list)

| Term | Definition |
|---|---|
| role | Data Scientist at MBM IT Consulting |
| education | MS in Data Science, Asian Institute of Management |
| experience | 6+ years across data science and ML engineering |

### Skills (in this order)

Python, Claude API, Claude Code, MCP servers, NLP pipelines, LLM integrations, Docker, GCP

### How I work — paragraph 1

> I default to building rather than slide-decking. A working prototype answers questions faster than a meeting. I write production-grade code even for personal projects — typed, tested where it matters, structured logging — because the discipline transfers.

### How I work — paragraph 2

> Claude Code is my main editor now. Most of the projects on this site were built with it as a collaborator, which means I spend less time on boilerplate and more on the parts that actually require thinking.

## Projects

### 1. LaborQuest (2025)

- One-liner: `text-based RPG teaching Filipino workers their labor rights`
- Stack tags: `python`, `claude api`, `web`
- Links: `live ↗` → `https://laborquest.app`
- Body (expanded view):
  > An interactive narrative game where players navigate workplace scenarios — wage disputes, illegal dismissal, working hour violations — and learn how Philippine labor law actually applies. Built end-to-end with Claude Code: branching narrative engine, scenario authoring, deployment. Aimed at workers who would never sit through a legal seminar.

### 2. Dota Weakness Report (2025)

- One-liner: `analyzes a Dota 2 player's weaknesses against pro player vector comparisons`
- Stack tags: `python`, `data pipeline`, `vector comparison`, `web`
- Links: `live ↗` → `https://dotaweakness.com`
- Body:
  > Pulls match history from the OpenDota API, builds per-hero performance vectors, and compares them against aggregated pro-player baselines to surface specific weaknesses — laning, item timing, map presence — instead of generic stats. Web app with a Python data pipeline behind it.

### 3. dota-deals (2024)

- One-liner: `async Python data pipeline with production-quality error handling`
- Stack tags: `python`, `asyncio`, `data pipeline`
- Links: `src` → `https://github.com/{{github_handle}}/dota-deals`
- Body:
  > Pipeline that ingests Dota 2 Steam Market data on a schedule, handles partial failures gracefully, and exposes a clean data surface for downstream analysis. Written with the discipline of production code — typed, retries with backoff, structured logging — even though it's a personal project.

### 4. ADO MCP Server (2024) — private

- One-liner: `MCP server connecting Claude to Azure DevOps for natural-language project management`
- Stack tags: `python`, `mcp`, `azure devops`
- Private indicator: `[private] work / private` (no links)
- Body:
  > A Model Context Protocol server that lets Claude query and act on Azure DevOps work items, pipelines, and repos in plain language. Used internally for faster triage, status summaries, and ticket creation without leaving a chat interface.

## Footer (shared)

Left side: `built by hand · deployed on cloudflare`
Right side: `github.com/{{github_handle}}` (linked)

## Page titles (`<title>` tag)

- Home: `{{github_handle}} — Data Scientist & AI Systems Engineer`
- Projects: `projects — {{github_handle}}`
- About: `about — {{github_handle}}`

## Meta description (used on all pages)

> Data Scientist and AI Systems Engineer. Builder of AI-powered systems.