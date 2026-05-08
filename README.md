# Custom Card Creator — Claude Code MVP Pack

This pack is designed for building a modern custom trading card creator in controlled phases using Claude Code.

## How to use

1. Create a new repo.
2. Add these files to the repo root.
3. Start with `CLAUDE.md`.
4. Run the phases in order.
5. Do not allow Claude to skip ahead.
6. After each phase, require Claude to run:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
7. Commit after each completed phase.

## Phase order

1. `00_PHASE_ZERO_LOCKED_SPEC.md`
2. `01_FOUNDATION.md`
3. `02_DATABASE_AND_AUTH.md`
4. `03_CARD_DATA_MODEL.md`
5. `04_CREATOR_MVP.md`
6. `05_RENDER_AND_EXPORT.md`
7. `06_LIBRARY_AND_PUBLIC_SHARING.md`
8. `07_SETS_MVP.md`
9. `08_AI_ASSISTANT_MVP.md`
10. `09_POLISH_AND_LAUNCH.md`

## Core rule

Build one phase at a time. Each phase should end in a working, buildable app.
