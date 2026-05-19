# SPEC.md

## What this is

A personal portfolio for a Data Scientist & AI Systems Engineer. Three pages. Static. Fast. Built by hand, not from a template.

## What it must communicate

In order of priority:
1. I'm a builder. I ship things.
2. I work fluently with modern AI tooling (Claude Code, MCP, Claude API).
3. I have rigorous data science foundations (MS, 6 years of work).
4. I have taste — the site itself is evidence.

## Aesthetic direction: Terminal / Builder's Log

**Restrained interpretation.** The site looks like the personal site of someone who lives in a terminal — not a recreation of one.

### Visual rules

- Background: near-black (`#0a0a0a`)
- Text: off-white (`#e8e8e8`)
- Dim text: gray (`#6b6b6b`)
- Accent: muted amber (`#d4a857`)
- Font: JetBrains Mono, weights 400 and 600 only
- Max content width: 720px
- Single column, generous line-height (1.7)
- One blinking cursor (on the hero, respects `prefers-reduced-motion`)
- `~` symbol before the brand name in the header (Unix home directory)
- `## ` prefix before section headings, in accent color
- `> ` prefix before the role line on the hero, in accent color
- `./` prefix before the current nav item, in accent color
- Project links open in new tabs
- Selection highlight uses accent color

### Anti-patterns (do not do these)

- No ASCII art
- No fake terminal prompts on body sections
- No glowing neon, no gradients, no glassmorphism
- No hero illustration, no abstract shapes, no mesh background
- No cards with shadows
- No buttons (use text links)
- No icons beyond what's strictly needed
- No scroll-triggered animations
- No "matrix rain" or typing animations
- No dark/light toggle

## Pages and sections

### `/` (Home)

1. Header (shared): brand `~ {github_handle}` + nav (home, projects, about)
2. Hero: display name + blinking cursor, role line (`> data scientist · ai systems engineer`), 2-paragraph bio
3. `## selected work`: 4 project entries (compact — name, year, one-liner, stack, links)
4. `## elsewhere`: GitHub link + dim note
5. Footer (shared)

### `/projects`

1. Header
2. `<h1>projects</h1>` + dim subtitle
3. `## log`: 4 project entries (expanded — adds body paragraph)
4. Footer

### `/about`

1. Header
2. `<h1>about</h1>` + 2 bio paragraphs
3. `## current`: definition list (role, education, experience)
4. `## skills`: comma-separated skill list
5. `## how I work`: 2 paragraphs
6. `## elsewhere`: GitHub link
7. Footer

## Project entry format

Compact (home):
```
[YEAR] [NAME]                          [link] [link]
one-line description
stack · tags · here
```

Expanded (projects page): same, plus a body paragraph between the description and stack line.

Private projects: same layout, but instead of links, show `[private] work / private` in dim text.

## Mobile rules

- Header collapses gracefully (nav wraps below brand if needed)
- Body font drops to 14px below 600px viewport
- Definition lists stack vertically below 500px
- No horizontal scroll, ever
- Tap targets ≥ 44px

## Accessibility

- Semantic HTML (`<header>`, `<main>`, `<footer>`, `<article>`, `<nav>`, `<h1>`–`<h2>`)
- `aria-current="page"` on the active nav item
- Sufficient contrast (off-white on near-black easily passes WCAG AA)
- `prefers-reduced-motion` disables the cursor animation
- All interactive elements reachable by keyboard