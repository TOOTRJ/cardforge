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
- Auth: `profiles.username` is NOT NULL + unique (0094) — the signup trigger
  mints a generated handle (`ember_sphinx_4821`) when none/invalid/taken is
  supplied and NEVER derives one from the email. Reserved handles live in
  `is_reserved_username()` AND `lib/auth/usernames.ts` (a unit test keeps them
  in sync). Post-auth redirects go through `safeRedirectPath()` only. Auth
  errors stay generic (anti-enumeration) except codes that can't leak account
  existence (`weak_password`, rate limits, `email_not_confirmed` — GoTrue
  checks the password first).
- Email: ONE shell, `lib/email/layout.ts` (dependency-free; BRAND hexes).
  Supabase auth templates are GENERATED from it
  (`npm run email:build-auth-templates` → `supabase/templates/`, never
  hand-edited) and link to `/auth/confirm?token_hash=…` (button-press verify;
  works cross-device). `config.toml` templates reach local + preview branches
  only — production needs `npm run email:push-auth-templates`. App emails
  (welcome, team message, weekly digest, newsletter) are built in
  `lib/email/messages.ts`, sent by `lib/email/send.ts` (Resend REST, batch
  ≤100), gated by `email_preferences` (0095: newsletter is OPT-IN, consent
  stamped by trigger) and always carry RFC 8058 one-click unsubscribe headers.
  Never email `site_update` rows outside the newsletter list. Details +
  owner setup: `docs/EMAIL.md`.
- Onboarding: `profiles.onboarded_at` NULL → the (app) layout redirects to
  `/onboarding` (its own route group, so no loop). Every profile always has an
  avatar + banner: the DB deals a random built-in pair at insert (0095,
  `public/defaults`, site-relative paths — use `absoluteProfileMediaUrl()`
  for OG/JSON-LD/email), "Remove" swaps in another built-in, and
  `chooseDefaultProfileMediaAction` only accepts paths `isDefaultProfileMedia`
  recognises. The seeded e2e user is pre-onboarded (`scripts/seed-e2e.mjs`).
- Viewer-independent server reads use `createPublicClient()` (cookie-free,
  keeps routes ISR-eligible); cookie-bound reads via `createClient()` make
  a route dynamic. `lib/supabase/admin.ts` bypasses RLS — webhook/cron,
  credit grants/refunds, protected billing columns, and is_admin-gated
  tooling only; every non-cron caller checks auth itself.
- Watermark policy (layout v20): every DISPLAY surface — stored bake,
  gallery tile, OG image, live preview — carries the pipglyph.com mark and
  no custom footer text, whatever the owner's plan. Only a paid VIEWER's
  download renders clean (`downloadBrandMark`); never make display
  viewer-dependent (the stored PNG is one public URL).
- Card preview and the server Satori bake must stay pixel-identical: the
  `.ttf`/PNG masters in `public/` feed the bake — browser-side asset
  optimizations must not touch what the bake reads.
  `public/frames` is excluded from function tracing (`next.config.ts`) —
  the bake fetches frames from the deployment's own CDN and memoizes them
  (`lib/render/card-frames.ts`); any new `public/frames` asset the renderer
  reads synchronously must be added to `frameAssetPathsFor()` in
  `lib/render/card-image.tsx` or it renders as a transparent pixel on
  Vercel. PNG/PDF serve the stored bake when it is current
  (`lib/render/stored-render.ts`); the OG share image serves it even when
  stale (`allowStale`) because the gallery tile shows that same image. A
  renderer change still needs the `CARD_LAYOUT_VERSION` bump (owners then
  update via the badge; a sweep is optional). Every bake also writes a
  600 px WebP thumbnail beside the HD PNG (`cards.rendered_thumb_url`,
  `lib/cards/render-thumb.ts`) — gallery-style tiles MUST use
  `BakedCardThumbnail` with `renderedThumbUrl`, never the 3 MB PNG;
  `scripts/backfill-render-thumbs.mjs` fills thumbs for older bakes.
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
