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
  migration file — stale header comments are corrected in
  `supabase/migrations/README.md` (errata) instead.
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
  a route dynamic. `lib/supabase/admin.ts` bypasses RLS — webhook/cron,
  credit grants/refunds, protected billing columns, and is_admin-gated
  tooling only; every non-cron caller checks auth itself.
- Card preview and the server Satori bake must stay pixel-identical: the
  `.ttf`/PNG masters in `public/` feed the bake — browser-side asset
  optimizations must not touch what the bake reads.
  `public/frames` is excluded from function tracing (`next.config.ts`) —
  the bake fetches frames from the deployment's own CDN and memoizes them
  (`lib/render/card-frames.ts`); any new `public/frames` asset the renderer
  reads synchronously must be added to `frameAssetPathsFor()` in
  `lib/render/card-image.tsx` or it renders as a transparent pixel on
  Vercel. OG/PNG/PDF serve the stored bake when it is current
  (`lib/render/stored-render.ts`) — a renderer change still needs the
  `CARD_LAYOUT_VERSION` bump + rebake sweep.
- Notifications are push, not pull: `notifications` is on the
  `supabase_realtime` publication (migration 0075) and
  `components/notifications/realtime-alerts.tsx` subscribes to the signed-in
  user's rows (toast + bell badge + debounced `router.refresh()`; polls the
  unread count if the socket fails). Anything that should alert a user or
  admin in real time just needs a `notifications` row — DB triggers for the
  social/feedback/message kinds, `notifyUser()` in `lib/admin/user-actions.ts`
  for credit grants, comp plans and card-limit overrides. New kinds go in the
  type CHECK + `lib/notifications/describe.ts` (the ONE copy source for bell,
  page and toast).
- AI image generation goes through the **Vercel AI Gateway ONLY** (FLUX for
  text-to-image, Gemini for the "AI remix" i2i) — `lib/ai/image-gen.ts` has no
  direct-OpenAI path. `AI_GATEWAY_API_KEY` is required for any image flow; a
  missing key returns a clear error, never a silent gpt-image-1 fallback.
  `OPENAI_API_KEY` is moderation-only (the omni-moderation scan on human
  uploads). AI batch jobs (deck/set/card) step through `patch_job_step`
  (atomic per-step write); the client runs a few steps in parallel, so never
  reintroduce a whole-`steps`-array overwrite.
