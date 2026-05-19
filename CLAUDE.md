# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project-specific guidelines

### Stack discipline

- **Astro 4, static output only.** No SSR, no server endpoints, no API routes.
- **Zero client JavaScript.** If you find yourself adding a `<script>` tag or a `client:*` directive, stop and ask first.
- **One font family** (JetBrains Mono), two weights. Don't add another font without asking.
- **No CSS framework.** Plain CSS with custom properties. No Tailwind, no PostCSS plugins beyond what Astro includes by default.
- **No UI framework.** No React, no Vue, no Svelte. `.astro` components only.

### Content discipline

- **Copy is in CONTENT.md.** Use it verbatim. Don't paraphrase, don't "improve."
- **The terminal aesthetic is restrained**, not literal. No fake terminal prompts on every section. No ASCII art borders. No blinking cursors except on the hero. If you're about to add a `>` or `$` to make something look "terminal-y," ask first.

### Build discipline

- Run `npm run build` after every meaningful change. If the build breaks, fix it before moving on — don't pile up errors.
- The production HTML for any single page should be under 15KB uncompressed. If it isn't, something is wrong.
- No console warnings during build. Treat warnings as errors.

### Git discipline

- Commit at each completed step from the plan. One step, one commit.
- Commit messages are lowercase, present tense, no period: `add base layout`, `wire up projects data`, `fix mobile header wrap`.
- Don't push until I confirm the build is clean locally.