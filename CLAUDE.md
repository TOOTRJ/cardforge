# PipGlyph (MTGCardForge)

Custom MTG-style card creator. Next.js 16 App Router + Supabase + Tailwind v4
(CSS-first tokens in `app/globals.css`, dark default). Full environment story:
`docs/ENVIRONMENTS.md`.

## ⚠️ Local env points at PRODUCTION

`.env.local` currently targets the LIVE database (deliberate, see TODO.md).
Until that changes: treat every local mutation as a prod write — no
destructive experiments, no test-data seeding, no schema pokes from local.
The local Supabase stack (`npm run db:start`) exists and works; switching to
it is TODO.md item #1.

## Shipping workflow (Supabase branching is live)

1. Branch → PR. **If the PR touches `supabase/`**, the GitHub integration
   creates a preview branch (own DB: migrations + `supabase/seed.sql`
   applied) and the Vercel preview is wired to it automatically.
2. Test on the Vercel preview URL. A failing migration fails the PR's
   "Supabase Preview" check — fix it there, never on prod.
3. Merge to `main` → Vercel deploys AND Supabase applies new migrations to
   production automatically. No manual `db push` in the normal flow.

Rules and gotchas:

- **Schema changes = a new numbered file in `supabase/migrations/` (next
  `NNNN_name.sql`), shipped through a PR. NEVER apply migrations to prod
  via the Supabase MCP/dashboard** — ad-hoc applies write timestamped
  versions into the migration history and break the integration (this
  happened once; repaired 2026-07-09). Never edit an already-merged
  migration file.
- Preview branches are created **when the PR opens** — pushes to an
  already-open PR won't create one; close/reopen the PR instead.
- "Supabase changes only" is ON: PRs without `supabase/` changes get no
  preview branch; their Vercel previews use Preview-scoped env vars.
- Preview branches start EMPTY by design. Baseline rows belong in
  `supabase/seed.sql` (runs on branch creation + local `db reset`); it does
  NOT run against prod.
- Manual fallback only: `npm run db:push:prod` (guard-railed, see
  `scripts/db-push.mjs`).

## Commands

- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck`
- `npm run test:unit` (vitest, fast — run before pushing)
- `npm run test:e2e` (Playwright; full suite needs the local Supabase stack
  + `.env.e2e` — see `tests/README.md`; without it only marketing/a11y
  specs run)
- `npm run db:start` / `npm run db:reset` (local stack)

## Conventions

- PR-based flow; merge commits (`gh pr merge --merge`). Conventional-commit
  titles (`feat(cards): …`, `perf: …`, `fix(validation): …`).
- Validation: zod schemas shared client+server (`lib/validation/*`,
  `lib/auth/schemas.ts`) mirroring DB CHECK constraints; server actions
  `safeParse` and return typed field errors. URL fields must be
  https-gated (`HTTPS_URL_BASE` / `isSafeImageUrl`) — bare `z.url()`
  accepts `javascript:` schemes.
- Viewer-independent server reads use `createPublicClient()` (cookie-free,
  keeps routes ISR-eligible); cookie-bound reads via `createClient()` make
  a route dynamic. `lib/supabase/admin.ts` bypasses RLS — webhook/cron use
  only.
- Card preview and the server Satori bake must stay pixel-identical: the
  `.ttf`/PNG masters in `public/` feed the bake — browser-side asset
  optimizations must not touch what the bake reads.
- AI image generation goes through the **Vercel AI Gateway ONLY** (FLUX for
  text-to-image, Gemini for the "AI remix" i2i) — `lib/ai/image-gen.ts` has no
  direct-OpenAI path. `AI_GATEWAY_API_KEY` is required for any image flow; a
  missing key returns a clear error, never a silent gpt-image-1 fallback.
  `OPENAI_API_KEY` is moderation-only (the omni-moderation scan on human
  uploads). AI batch jobs (deck/set/card) step through `patch_job_step`
  (atomic per-step write); the client runs a few steps in parallel, so never
  reintroduce a whole-`steps`-array overwrite.
