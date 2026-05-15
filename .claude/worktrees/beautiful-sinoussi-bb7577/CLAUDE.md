# Claude Code Operating Instructions

You are helping build a production-grade custom trading card creator web app.

## Project Goal

Build a modern web platform where users can create, save, export, share, remix, and organize custom trading cards.

The MVP launches with an MTG-inspired fantasy card creator, but the underlying architecture must support future game systems, card templates, and non-MTG custom trading card formats.

## Critical Product Principles

1. Do not build a clone of any existing site.
2. Do not use copyrighted Wizards of the Coast card frames, symbols, logos, fonts, set symbols, card backs, trademarks, or official art.
3. The app should be clearly positioned as an unofficial custom card design and playtesting tool.
4. Store cards as structured data first, not just rendered images.
5. Keep the first editor simple, fast, and beautiful.
6. Build progressive complexity: simple mode first, advanced mode later.
7. Every phase must leave the app in a working state.

## Tech Stack

Use:

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase
- Supabase Auth
- Supabase Storage
- Zod
- React Hook Form
- Server Actions where appropriate
- Sharp for server-side image export when export phase begins

Avoid unless explicitly required:

- Large canvas editor frameworks in the first MVP
- Complex drag/drop systems before the simple editor works
- Premature marketplaces
- Premature multiplayer collaboration
- Premature AI set generation

## Engineering Standards

- Use strict TypeScript.
- Use clean folder structure.
- Prefer server components by default.
- Use client components only when interactivity is required.
- Validate all form input with Zod.
- Never trust client-provided ownership IDs.
- Enforce row-level security in Supabase.
- Keep database migrations explicit and readable.
- Keep UI responsive from the beginning.
- Avoid giant files.
- Avoid unrelated refactors during a phase.

## Required Workflow For Every Phase

Before coding:

1. Inspect the current project.
2. Read the current phase file.
3. Summarize the implementation plan.
4. Confirm scope boundaries internally.
5. Implement only the current phase.

After coding:

1. Run lint.
2. Run typecheck.
3. Run build.
4. Fix all errors.
5. Summarize changed files.
6. Summarize known limitations.
7. Stop.

## Do Not Skip Ahead

If the current phase is Foundation, do not build AI.
If the current phase is Creator MVP, do not build collaboration.
If the current phase is Public Sharing, do not build marketplace.
If the current phase is Sets MVP, do not build full draft simulation.

## App Naming Placeholder

Use the placeholder name `CardForge` until the final brand name is chosen.

Do not hard-code MTG-specific branding into global app names. Use neutral naming in architecture:
- game systems
- card templates
- card projects
- card exports
- card sets

## Legal/Branding Guardrails

Use generic fantasy card terminology.

Allowed examples:
- mana-like cost
- fantasy cost
- rarity
- rules text
- flavor text
- power
- toughness
- card type
- subtype
- color identity

Avoid official proprietary terms in marketing copy where possible:
- Magic: The Gathering
- Wizards of the Coast
- official mana symbols
- official card frames
- official set symbols
- official card back
- official fonts

A public disclaimer should eventually say:

"CardForge is an unofficial custom card design and playtesting tool. It is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or any official trading card game publisher. Users are responsible for ensuring they have rights to any uploaded artwork."

## MVP North Star

A new user should be able to:

1. Land on the site.
2. Create an account.
3. Open the card creator.
4. Enter card details.
5. Upload artwork.
6. See a live preview.
7. Save the card.
8. Download a PNG.
9. Share a public card page.

That is the MVP.
