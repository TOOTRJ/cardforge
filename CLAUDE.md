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
  checks the password first). `/reset-password` accepts only a session from a
  RECENT recovery link (`lib/auth/recovery-session.ts`, JWT `amr`); a plain
  signed-in session changes its password in Settings with the current one.
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
  Frames listed in `lib/frames/frame-manifest.json` live in the `frames`
  storage bucket, not git (content-addressed; `frameUrl()` resolves every
  preview + bake path; publish → preview → owner `frames:promote` → merge,
  `docs/FRAMES.md`) — Card Conjurer-derived frames NEVER enter the repo.
  `public/frames` is excluded from function tracing (`next.config.ts`) —
  the bake fetches frames from the deployment's own CDN and memoizes them
  (`lib/render/card-frames.ts`); any new `public/frames` asset the renderer
  reads synchronously must be added to `frameAssetPathsFor()` in
  `lib/render/card-image.tsx` or it renders as a transparent pixel on
  Vercel. A free (watermarked) PNG download serves the stored bake unless a
  platform correction is pending (`hasServableStoredRender`, 0.21: a card
  downloads the way it looks); paid clean PNG/PDF render live; the OG share
  image serves any bake (`accept: "any"`). A renderer change still needs
  the `CARD_LAYOUT_VERSION` bump + a `VERSION_ROLLOUT` policy: only
  "opt-in" bumps badge owners (`hasNewerLook`); "sweep" bumps and
  frame-override saves (null stamp) are re-baked by the platform — the
  compare page does it right after a save (`/api/admin/rebake-marked`). Every bake also writes a
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
  reintroduce a whole-`steps`-array overwrite. Credit settlement (0106):
  `patch_job_step` stamps `credit_ledger.settled_at` (via `settle_spend`) in
  the same transaction as a step's done-write and the sync idea routes call
  `settleSpend()`; the reconcile cron refunds every aged UNSETTLED `spend:`
  row and never reads job rows — a new charged flow that forgets to settle
  its ref hands the credit back to the user a day later.
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
  `/set/[slug]` routes, the AI "set" job kind) were REMOVED on 2026-09-22 —
  app in #337, schema in migration 0105 (owner-confirmed; 8 sets from 5
  owners were dropped). The `set-covers` bucket keeps its historical name
  because deck covers and card set icons live there. A card's printed set
  symbol (`set_icon_url` / `set_icon_code`, the Set icon step) is a rendering
  feature and stays.
- Saved-card capacity is enforced in the DATABASE (migration 0104:
  `card_capacity_for()` + the `cards_enforce_capacity` trigger, advisory-locked
  per owner) and mirrored in the app: `CARD_CAPACITY` in `lib/billing/plans.ts`
  (a unit test keeps the SQL in sync), `getCardCapacity()` +
  `describeCapacity()` feed the `CapacityNotice` warnings (creator, deck
  wizard, in-deck AI panel, My Cards meter), the jobs route refuses an
  over-cap batch with `code: "CARD_CAPACITY"`, and `createCardAction` maps the
  trigger's `card_capacity_exceeded` to the upgrade prompt. A batch step that
  hits a plan limit fails with `error_code` (`CARD_CAPACITY` /
  `INSUFFICIENT_CREDITS`); the runner stops on it and opens the matching
  modal, and retries check `/api/me`'s `cardCapacity` before the credit
  confirm. Change the caps in both places together.
- SEO contract for public pages: a missing or unreadable entity answers a
  real HTTP 404 — call `notFound()` BEFORE any Suspense/loading boundary (the
  global `loading.tsx` lives in `app/(app)/` for exactly this reason; the card
  route checks existence in its segment `layout.tsx` so its skeleton can still
  stream) and again in `generateMetadata` (detail queries are React `cache()`d,
  so it costs nothing). Every public detail page sets a self-canonical,
  OG/Twitter, JSON-LD, and `robots: noindex` for anything unlisted or THIN (a
  handle-only profile, an empty deck). `app/sitemap.ts` lists only what is
  indexable (public cards, profiles with a public card, non-empty public
  decks) and never a `?` URL or a "now" lastmod; `app/robots.ts` never
  disallows a page that carries its own noindex (crawlers can't read it
  otherwise) — `/create` stays crawlable. Card/deck mutations announce their
  URLs to Bing & co. through `revalidateCardPaths()` / `revalidateDeckPaths()`
  (`lib/seo/indexnow.ts`, production only, `INDEXNOW_KEY`). `/llms.txt` is
  generated by `app/llms.txt/route.ts` — never hand-write it. A removed public
  route gets a 308 in `proxy.ts` (like `/sets` → `/decks`), never a 404.
  Browse hubs (`/gallery/tag/[tag]`, `/gallery/type/[type]`,
  `/decks/format/[format]`, `lib/cards/hubs.ts`) are ISR pages built from
  migration 0108's public count functions; a hub renders for any real key but
  is indexed (and sitemapped) only above its threshold — link tags to
  `/gallery/tag/<slug>` (`tagSlug`), never to `/gallery?tag=`. The public card
  page carries a text "Card details" block and a CreativeWork with
  ImageObject/keywords/isPartOf — keep those in step with what the render
  shows. A render write is NOT an edit: `updated_at` ignores the render
  columns (0108) and the OG cache-buster is `renderVersionOf()`
  (`max(updated_at, rendered_at)`), never `updated_at` alone.
- Fonts are SELF-HOSTED as OFL variable woff2 files under `app/fonts/*` with
  their licences: Geist Sans/Mono subset to latin + latin-ext
  (`scripts/subset-geist.mjs` regenerates them from the `geist` package),
  Cinzel from google/fonts; card/OG fonts are committed `.ttf`s under
  `public/`. Never import `next/font/google` — it
  fetches fonts.googleapis.com at BUILD time and the 2026-09-22 production
  deploy of a green merge failed inside that loader
  (`tests/unit/content/fonts-self-hosted.test.ts` guards it).
- Billing storefront: `/pricing` and the upgrade modal pick every button from
  `pricingCtaFor()` (`components/billing/pricing-cta.ts`) fed by a
  `BillingViewer` (`lib/billing/viewer.ts`: `hasBillingAccount`,
  `hasLiveSubscription`, `hasSubscribed`, effective `tier`). `/pricing` is
  the static ANONYMOUS storefront; `proxy.ts` rewrites a visitor with a
  session cookie to the dynamic `app/(marketing)/pricing-member` twin, which
  resolves the viewer on the server and passes `initialViewer` — so the HTML
  carries the right buttons and nothing flashes (a client-side /api/me swap
  is only for the upgrade modal). PAID accounts (live Plus/Pro, comp, admin)
  never see the storefront: `/pricing` redirects them to `/dashboard/billing`
  (plan + dates, the same PricingPlans grid for in-place Plus↔Pro /
  monthly↔annual switches, credits + packs, card + invoices via
  `lib/billing/subscription-details.ts`, portal deep links via
  `createPortalSessionAction(flow)`) and the header/mobile nav hide Pricing.
  Checkout resolves prices from Stripe's catalog by LOOKUP KEY
  (`lib/stripe/prices.ts`; `STRIPE_PRICE_*` is only a fallback) — a stale env
  id silently broke every live pack purchase until 2026-09-22 — and every
  Stripe error in `lib/stripe/actions.ts` is logged, never just toasted. Full
  picture, env matrix, sandbox ids and the standards comparison:
  `docs/BILLING.md`. `isPaid` is NOT "has a subscription" —
  admins and comped accounts are paid with no Stripe customer, and offering
  them "Manage plan" opened a portal that doesn't exist (2026-09-22). One
  trial per account, Plus or Pro: `createCheckoutSessionAction` grants
  `trial_period_days` only when the profile has never synced a subscription
  AND Stripe's history (status "all") is empty. The trial REQUIRES A CARD
  (2026-09-24; never reintroduce `payment_method_collection: if_required`),
  grants `TRIAL_CREDITS` (25, reason `trial_grant`, under the month's base
  refill key) at creation and the full allotment on first payment; a
  card-backed trial switches plans through the portal confirm flow, a legacy
  no-card one is superseded by a checkout that carries `trial_end` over
  (≥48 h left, Stripe's minimum). A trial that ends unconverted
  (`isUnconvertedTrial`) gets ONE `trial_lapsed` notification + win-back
  email (0111); checkout applies coupon `TRIAL_WINBACK_COUPON_ID` for 30
  days from that row, never a client-supplied code. Active plans:
  an UPGRADE switches in place through the portal confirm flow (prorated,
  charged now); a DOWNGRADE (`isPlanDowngrade` in `lib/billing/plan-change.ts`: lower tier, or
  annual → monthly) is scheduled for the end of the paid period with a subscription
  schedule (`scheduleDowngrade`; "Keep {Plan}" =
  `cancelScheduledPlanChangeAction` releases it; the billing page reads
  `pendingChange` from the expanded schedule) — never through the portal,
  whose `schedule_at_period_end` only works within one product. Stripe's
  `trial_will_end` becomes ONE `trial_ending` notification + "account" email
  per subscription (migration 0109; honest about whether a card is on file).
  `invoice.paid` writes ONE `billing_payments` row per invoice (0110; the
  admin Revenue panel reads only that table), resyncs the subscription, and
  notifies `payment_received` only when money was taken; a
  `checkout.session.expired` session becomes ONE `checkout_reminder`
  notification + email per user per 30 days, skipped once the plan/pack was
  bought — every Checkout session carries `purchase_kind`/`tier`/`period`
  metadata for it. Every event must be subscribed on every webhook
  endpoint (live + sandbox). FREE DOES NOT REFILL (owner decision
  2026-09-24): `SIGNUP_CREDITS` (5, the `profiles.credits` default) once,
  `MONTHLY_CREDITS.free` = 0, `refillTierFor` → null for free — copy says
  "5 to start", never "a month". Three packs (`PACK_ORDER` mini/small/large,
  lookup keys `pack_<key>`), listed inside the out-of-credits modal;
  ACTIVE subscribers get coupon `PACK_SUBSCRIBER_COUPON_ID` applied by the
  checkout action (never client-supplied). FUNNEL: every money step writes
  a `funnel_events` row (0112) via `recordFunnelEvent()` — server steps in
  the checkout action/webhook, browser steps through `trackFunnelEvent()` →
  POST `/api/events` (allow-listed names in `lib/analytics/funnel-events.ts`,
  allow-listed scalar props, anonymous rows carry NO identifier); a new CTA
  passes `surface`, a new gate opens the upgrade modal (that IS the
  `upgrade_modal_open` event); product activity goes through
  `recordActivity()` (card_saved / ai_generation / download + the
  once-per-user `first_*` milestones the prune never deletes); signup
  attribution is first-touch sessionStorage → hidden fields → a `signup`
  row for real new users only, never a cookie; the admin Funnel panel reads
  `admin_funnel_counts()` + `admin_trial_engagement()`. The month's
  credit top-up is measured against EVERY refill row of the month
  (`refill:<user>:<period>%`), never the base row alone. The seeded e2e user
  is an ADMIN (unlocked) — billing specs sign in as the free `e2e_free` user
  (`signIn(page, { as: "free" })`).
- Browse surfaces: `/gallery` and `/decks` are static (ISR) LANDINGS — search
  box + hub chips on top, curated rows below — that never read
  `searchParams`. Every search/filter/sort/page control lives on the VISIBLE
  dynamic siblings `/gallery/browse` and `/decks/browse` and navigates within
  them (`useSearchParamPatch`, `buildHref`/`pageHref`, `BrowseSearchBox`).
  Never link to `/gallery?…` or `/decks?…` (`proxy.ts` 308s known params to
  the sibling) and never bring back a hidden rewrite: Next's client router
  reuses the cached static tree for a same-path query change and never calls
  the server, so the URL changed while the grid stayed frozen (2026-09-22).

