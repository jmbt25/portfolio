# projects-context.md

Facts about jmbt25 for the scout agent to reason against. Updated by hand only. Reviewer agent must not edit this file.

## Who

- Joshua, GitHub `jmbt25`
- Data Scientist & AI Systems Engineer
- MBM IT Consulting, MS in Data Science (Asian Institute of Management)
- Based in Manila
- 6+ years building data and ML systems
- Daily Claude Code user

## What he ships

### portfolio (2026) — public, this site
- The portfolio at jmbt.dev. Astro 4 static + Cloudflare Pages Functions.
- Hosts `/thinking` — the agent system that runs scout and reviewer (you).
- Stack: Astro 4, plain CSS, JetBrains Mono, Cloudflare Pages, GitHub Actions, Claude Code (OAuth)
- Hand-built, no UI framework, zero client JS except the `/thinking` vote handler
- github.com/jmbt25/portfolio
- Constraints worth knowing if you propose changes: static output only, no SSR, zero client JS by default, plain CSS (no Tailwind), one font (JetBrains Mono, 2 weights), restrained terminal aesthetic — these are intentional, not gaps.

### LaborQuest (2025) — public
- Text-based RPG teaching Filipino workers labor rights
- Stack: Python, Claude API, web frontend
- Built end-to-end with Claude Code
- Civic-tech angle
- github.com/Labor-Quest/labor-rights-rpg (separate org, single repo)

### Mini World (2026) — public
- Browser 3D life simulation with emergent tribes, wars, and a Black Mirror-style awareness layer
- Stack: JavaScript, Three.js, vanilla web (no build step), localStorage persistence
- WorldBox-inspired sandbox; inhabitants progressively notice the camera and leave offerings, glyphs, words
- github.com/jmbt25/jmbt25.github.io, live at jmbt25.github.io

### Dota Weakness Report (2025) — public
- Web app, analyzes a player's weaknesses via pro-player vector comparison
- Stack: Python, OpenDota API, data pipeline, web frontend
- Per-hero performance vectors vs. pro baselines
- github.com/jmbt25/dota-weakness-report

### dota-deals (2024) — public
- Async Python data pipeline ingesting Steam Market data
- Production-grade error handling, retries, structured logging
- github.com/jmbt25/dota-deals

### ADO MCP Server (2024) — private
- MCP server connecting Claude to Azure DevOps
- Natural-language project management
- Stack: Python, MCP, Azure DevOps API

## Stack he uses

Python (primary), Claude API, Claude Code, MCP servers, async/await, data pipelines, vector comparisons, Docker, GCP, Cloudflare Pages, Astro.

## Stack he doesn't currently

TypeScript primary, React, Next.js, LangChain, LangGraph, paid vector DBs, Kubernetes, AWS.

## Tendencies

- Small opinionated tools over frameworks
- Production-grade code even for personal projects
- Skeptical of overhyped abstractions and "agentic framework" announcements
- Interested in: MCP, agent design, data pipelines, vector methods, civic tech, gaming/Dota
- Not interested in: enterprise SaaS news, VC rounds, AGI discourse, conference recaps, generic "AI in industry X"
- Filipino context often a real angle for civic-tech ideas

## Likely next builds

(Update quarterly.)

- A second public MCP server
- An OpenDota-powered tool sibling to Dota Weakness Report
- The agent system on this portfolio (you're part of it)
- Civic-tech tools aimed at Filipino-context users

## Won't build

- Next.js SaaS
- LangChain chatbot
- AI girlfriend / character AI
- GPT-4 wrapper
- A "platform"