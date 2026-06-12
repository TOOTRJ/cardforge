# Phase 11 — Premium Polish & Power Features

## Goal

Take CardForge from "Phase 9 polished MVP" to "feels like a paid product."
Combines deferred hardening items (M1 byte sniffing, M5 username routes,
test suite) with the premium-feel candidates surfaced in the audit.

## How to use this folder

Each chunk is an independently shippable PR-sized unit. Work through them
in the listed order — earlier chunks lay foundations later chunks rely on.
Hand a single chunk file back to the agent to begin that piece of work.

Every chunk file has the same shape:

- **Goal** — one paragraph, why this exists
- **Scope** — what's in and what's deliberately out
- **Files to add / modify** — explicit paths
- **Implementation approach** — the design call, not a step-by-step
- **Acceptance criteria** — how we verify it works
- **Dependencies** — earlier chunks that must land first
- **Estimated effort** — rough wall-clock time
- **Done when** — the explicit stop signal

## Chunk order

1. [`01_UI_PRIMITIVES.md`](01_UI_PRIMITIVES.md) — Radix Dialog + Popover, multi-select ChipGroup
2. [`02_MANA_GLYPHS_EXPANSION.md`](02_MANA_GLYPHS_EXPANSION.md) — Hybrid, Phyrexian, tap/snow glyphs
3. [`03_PREMIUM_CARD_FINISHES.md`](03_PREMIUM_CARD_FINISHES.md) — Foil / etched / borderless / showcase presets
4. [`04_GALLERY_HOVER_EFFECTS.md`](04_GALLERY_HOVER_EFFECTS.md) — 3D tilt + glare on gallery cards
5. [`05_LOADING_SKELETONS.md`](05_LOADING_SKELETONS.md) — Shimmer skeletons + view transitions
6. [`06_ONBOARDING_AND_COMMAND_PALETTE.md`](06_ONBOARDING_AND_COMMAND_PALETTE.md) — `/create` start-with hero + global ⌘K
7. [`07_AI_STREAMING.md`](07_AI_STREAMING.md) — Stream AI suggestions token-by-token
8. [`08_BULK_DASHBOARD_ACTIONS.md`](08_BULK_DASHBOARD_ACTIONS.md) — Multi-select + batch operations
9. [`09_SET_DRAG_REORDER.md`](09_SET_DRAG_REORDER.md) — Drag-handle reorder inside a set
10. [`10_DFC_SUPPORT.md`](10_DFC_SUPPORT.md) — Double-faced cards in form, preview, Scryfall import
11. [`11_USERNAME_CARD_ROUTES.md`](11_USERNAME_CARD_ROUTES.md) — `/card/[username]/[slug]` to kill cybersquatting
12. [`12_LIGHT_MODE.md`](12_LIGHT_MODE.md) — Theme toggle + light palette
13. [`13_SCRYFALL_SOURCE_TRACKING.md`](13_SCRYFALL_SOURCE_TRACKING.md) — Source column + remix lineage
14. [`14_UPLOAD_BYTE_SNIFFING.md`](14_UPLOAD_BYTE_SNIFFING.md) — Sharp-based MIME validation (M1)
15. [`15_USAGE_INSIGHTS_UI.md`](15_USAGE_INSIGHTS_UI.md) — AI & Scryfall usage panel
16. [`16_AUTOMATED_TESTS.md`](16_AUTOMATED_TESTS.md) — Vitest + Playwright

## Items intentionally NOT scoped here

- **Set draft simulator** — bigger feature, belongs in its own phase after Phase 7 lands fully.
- **Foil shimmer paused in editor** — intentional design call to keep typing focus.
- **AI rate-limit fail-OPEN posture** — intentional fail-safe so a Supabase hiccup doesn't wedge the editor.

## Workflow per chunk

Each chunk follows the CLAUDE.md after-coding checklist:

1. Run lint
2. Run typecheck
3. Run build
4. Fix all errors
5. Summarize changed files
6. Summarize known limitations
7. Stop and wait for the next chunk
