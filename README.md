# PipGlyph

**Precision tools for legendary ideas.** PipGlyph ([www.pipglyph.com](https://www.pipglyph.com))
is an MTG-style custom card creator: a kind-first, four-step editor
(Card → Identity → Text & stats → Publish) with precise mana pips (including
per-user **custom pip icons**), frames spanning three decades of card design,
an AI rules-text assistant, a community gallery with likes and remixing, full
expansion-set building, design challenges, and print-ready PNG/PDF export.
The live preview and the exported image share one layout engine, so what you
see is exactly what renders.

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · Tailwind 4 (CSS-first tokens in `app/globals.css`)
- **Supabase** (Postgres + RLS, Auth, Storage) via `@supabase/ssr`
- **Satori + resvg** server rendering for card exports (`lib/render/card-image.tsx`)
- **Stripe** (flag-gated billing: `NEXT_PUBLIC_BILLING_ENABLED`), **GA4** (env-gated), Vercel hosting
- Tests: **Vitest** (unit) + **Playwright** (e2e against a local Supabase stack)

## Local setup

```bash
npm install
cp .env.example .env.local        # fill in Supabase URL + publishable key (see comments)
npm run dev                       # http://localhost:3000
```

For the **full e2e suite** (auth, editor, challenges flows) you need the local
Supabase stack — see [tests/README.md](tests/README.md):

```bash
supabase start                    # needs a container runtime (colima works)
cp .env.e2e.example .env.e2e      # paste keys from `supabase status`
node scripts/seed-e2e.mjs         # idempotent test user (local-only by design)
npx playwright test               # full suite, on its own :3100 server
```

## Useful scripts

| Script | Purpose |
| --- | --- |
| `scripts/seed-e2e.mjs` | Seed the e2e user into the **local** stack (refuses non-local URLs). |
| `scripts/rebake-renders.mjs` | Re-render stored card PNGs after a renderer/layout change (bump `CARD_LAYOUT_VERSION` first — see `lib/cards/layout-version.ts`). |
| `scripts/visual-audit.mjs` | Side-by-side render comparisons against reference scans. |
| `scripts/generate-brand-assets.mjs` | Regenerate the brand kit (`public/brand/*` + `app/favicon.ico`) from `lib/brand` after any mark/palette change. Node ≥ 23.6. |
| `scripts/build-wordmark-path.mjs` | One-time: re-outline the Cinzel wordmark into `lib/brand/wordmark.ts` (only if the wordmark text/face changes). |

## Architecture notes

- **Editor**: `components/creator/card-creator-form.tsx` orchestrates the
  contextual panels (`components/creator/panels/`) over a pure 4-step model in
  `lib/creator/steps.ts`; the card KIND (creature/saga/split/…) is derived,
  never stored (`lib/creator/card-kinds.ts`).
- **Frame availability**: verification is the only gate. A (template, color)
  combo is user-pickable exactly when its `frame_reviews` checkbox is checked
  in `/admin/frame-compare` (`lib/cards/frame-availability.ts`); unverified
  kinds/frames render as disabled "Soon" chips.
- **Watermarks & basic lands**: `cards.watermark` (jsonb) holds the faint
  mark behind rules text. Basic lands (by subtype) automatically print the
  large mana symbol instead of rules text (`lib/cards/watermark.ts`); the
  creator seeds Land cards as the basic matching the frame color and offers
  an icon picker on the Text & stats step.
- **Preview ↔ export parity**: both renderers read the same frame profiles
  (`lib/cards/template-layout.ts`); any change inside card pixels must land in
  `components/cards/card-preview.tsx` **and** `lib/render/card-image.tsx`
  together, with a `CARD_LAYOUT_VERSION` bump + rebake.
- **Migrations**: `supabase/migrations/` is canonical; apply to the remote via
  the Supabase MCP/CLI. Storage upserts need owner `SELECT` policies (see
  migrations `0038`–`0040` for the pattern).
- **Billing setup**: [BILLING_SETUP.md](BILLING_SETUP.md).

## History

Planning and audit documents from the original build-out live in
[docs/archive/](docs/archive/) — kept for provenance; superseded by this file.
