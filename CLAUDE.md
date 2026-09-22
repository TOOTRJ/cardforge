# PipGlyph (MTGCardForge)

Custom MTG-style card creator. Next.js 16 App Router + Supabase + Tailwind v4
(CSS-first tokens in `app/globals.css`, dark default). Full environment story:
`docs/ENVIRONMENTS.md`.

## Environments (full story: `docs/ENVIRONMENTS.md`)

- **Production** = Vercel Production + the prod Supabase project. Nothing else
  may touch it.
- **Dev database** = the persistent Supabase branch `dev`
  (`znipzaxgpaiandwiqabn`), seeded with test data. It backs **local
  `npm run dev`** AND every **Vercel preview** that has no per-PR branch.
  Writes there are fine — it's what it's for. Test logins:
  `{admin,pro,free,artist,new}@dev.pipglyph.test`, password =
  `DEV_SEED_PASSWORD` in `.env.local` (`npm run seed:dev` sets it).
- **Local Docker stack** (`npm run db:start`) = migration work + e2e only.
- `npm run dev` REFUSES to start against production
  (`scripts/check-dev-env.mjs`; every script shares
  `scripts/lib/prod-guard.mjs`). `npm run dev:prod` is the deliberate, loud
  exception (reads `.env.prod-peek`). Never weaken these guards, never put
  production keys back in `.env.local`, never use `--with-data` branching.
- The repo is **public**: no credentials in seeds, fixtures or docs — not even
  test passwords.

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
- Seeds never run against prod. `supabase/seed.sql` = baseline rows the app
  needs (the verified `frame_reviews` combos — frame verification is the
  creator's only gate; the list mirrors production, never runs ahead of it).
  `supabase/seeds/*.sql` = synthetic test data (5 accounts, cards, decks,
  challenges…) for branches, the dev DB and local resets. Both are
  idempotent. New feature with new tables → add seed rows so previews can
  exercise it.
- **Every migration states its grants.** Prod is an old Supabase project that
  auto-grants new `public` objects to the API roles; NEW projects (every
  branch) do not. 0097 made the existing schema explicit — never replace it
  with a blanket `grant all on all tables` (that undoes the 0073/0074/0088
  lockdowns). Forgotten grants = `permission denied` (42501) on a branch whose
  Supabase check is green.
- The `dev` git branch is machine-owned (`sync-dev.yml` fast-forwards it to
  `main`; Supabase migrates the dev DB from it). Never commit to it.
- Supabase's branch runner fails silently sometimes (hung check, empty DB,
  "Capacity is unavailable"). Runbook: `docs/ENVIRONMENTS.md` §4.
- Manual fallback only: `npm run db:push:prod` (guard-railed, see
  `scripts/db-push.mjs`).

## Commands

- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck`
- `npm run test:unit` (vitest, fast — run before pushing)
- `npm run test:e2e` (Playwright; full suite needs the local Supabase stack
  + `.env.e2e` — see `tests/README.md`; without it only marketing/a11y
  specs run)
- `npm run db:start` / `npm run db:reset` (local Docker stack)
- `npm run db:push:dev` / `npm run db:seed:dev` / `npm run seed:dev` (the
  shared dev branch — target-verified, see `scripts/db-dev.mjs`)
- CI (`.github/workflows/ci.yml`) runs typecheck + lint + unit + the full e2e
  suite on every PR. Keep it green — a red e2e may be a real bug, not drift.

## Conventions

- PR-based flow; merge commits (`gh pr merge --merge`). Conventional-commit
  titles (`feat(cards): …`, `perf: …`, `fix(validation): …`). Every PR whose
  change is visible in the app ends with a **"## Manual testing (preview)"**
  section: preview URL, which `dev_*` account, the exact clicks, the expected
  result (and the old wrong behaviour when that helps), plus what can't be
  tested on a preview. Docs/test-only/refactor PRs say so in one line.
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
- Shared helpers — never re-implement: `isUuid`/`randomId` (`lib/ids.ts`),
  `rateLimitedResponse` + `cronRouteGuard` (`lib/api/*`), date strings
  (`lib/format/dates.ts`), `lookupUsername`/`revalidateProfilePage`
  (`lib/profile/username.ts`) + `getCurrentUsername()` for handles,
  `narrowCard` (`lib/cards/narrow.ts`), `useSearchParamPatch` for browse
  filters (always resets `page`), `RARITY_LABELS`/`COLOR_IDENTITY_LABELS`/
  `COLOR_LETTER_IDENTITY` in `types/card.ts`, OG chrome in
  `lib/og/chrome.tsx` (edge-safe; the sharp pre-fetch lives in
  `lib/og/shell.tsx`), like toggles through `lib/social/like-toggle.ts`,
  render upload/delete through `lib/cards/bake-core.ts`.
- Sets (`card_sets` / `card_set_items` / `set_likes`, the `/sets` and
  `/set/[slug]` routes, the AI "set" job kind) were REMOVED from the app on
  2026-09-22. The tables, `cards.primary_set_id`, `ai_generation_jobs.set_id`,
  the `card_like_rank_in_set` / `admin_user_stats` functions and the
  `set-covers` bucket (deck covers and card set icons live there) still exist
  until a confirmed drop migration — production held 8 sets from 5 owners at
  removal time. A card's printed set symbol (`set_icon_url` / `set_icon_code`,
  the Set icon step) is a rendering feature and stays.
- Saved-card capacity is enforced in the DATABASE (migration 0104:
  `card_capacity_for()` + the `cards_enforce_capacity` trigger, advisory-locked
  per owner) and mirrored in the app: `CARD_CAPACITY` in `lib/billing/plans.ts`
  (a unit test keeps the SQL in sync), `getCardCapacity()` +
  `describeCapacity()` feed the `CapacityNotice` warnings (creator, deck
  wizard, in-deck AI panel, My Cards meter), the jobs route refuses an
  over-cap batch with `code: "CARD_CAPACITY"`, and `createCardAction` maps the
  trigger's `card_capacity_exceeded` to the upgrade prompt. Change the caps in
  both places together.
