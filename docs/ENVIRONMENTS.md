# Environments: local → dev/preview → production

How PipGlyph code and database changes get from your machine to production.
Rewritten 2026-09-21 after a full DevOps audit (findings at the bottom).

| | App | Database | Data | Who sees it |
|---|---|---|---|---|
| **Production** | Vercel Production (`main`) → pipglyph.com | Prod Supabase project `zkwkisxoqdhdchqyjwdc` | Real users | Everyone |
| **Preview — most PRs** | Vercel Preview | Persistent **`dev` branch** `znipzaxgpaiandwiqabn` (shared) | Seeded test data | Anyone signed in to the Vercel team |
| **Preview — PR touching `supabase/`** | Vercel Preview | Its **own ephemeral branch** (fresh schema incl. the PR's migrations) | Seeded test data | same |
| **Local (default)** | `npm run dev` | The same shared **`dev` branch** | Seeded test data | You |
| **Local (migration work, e2e)** | `next dev` / Playwright | **Docker stack** (`npm run db:start`) | Seeded test data | You |

Two rules everything else hangs off:

1. **Nothing outside Vercel Production talks to the production database.** The
   dev machine is guarded (`npm run dev` refuses to start against it), the
   scripts are guarded (`scripts/lib/prod-guard.mjs`), and Vercel's Preview +
   Development scopes hold only the dev branch's keys.
2. **Schema reaches production one way: a numbered migration, in a PR, merged
   to `main`.** Supabase's GitHub integration applies it. No `db push` to prod,
   no dashboard SQL, no MCP `apply_migration` (that writes timestamped history
   and breaks the integration — it happened once, repaired 2026-07-09).

---

## 1. Local development

One-time:

```bash
vercel link                                                # if not linked yet
vercel env pull .env.local --environment=development       # → the dev branch's URL + keys
```

Then add to `.env.local` (never committed — this repo is **public**):

```bash
DEV_SEED_PASSWORD=<anything 12+ chars>    # password for the dev_* test accounts
```

```bash
npm run dev         # app on :3000 against the shared dev database
npm run seed:dev    # (re)sets the test-account passwords, prints the logins
```

`npm run dev` runs `scripts/check-dev-env.mjs` first. If `.env.local` (or the
shell) points at production it **refuses to start** and tells you how to fix
it. The one deliberate way through:

```bash
npm run dev:prod    # reads .env.prod-peek, prints a loud banner — for a read-only look
```

`.env.prod-peek` holds the production credentials that used to live in
`.env.local`. Next.js never auto-loads it. Delete it if you'd rather re-pull
from Vercel when needed (`vercel env pull --environment=production`).

### Test accounts (on every non-production database)

All five share `DEV_SEED_PASSWORD` once `npm run seed:dev` has run.

| Login | Username | What it's for |
|---|---|---|
| `admin@dev.pipglyph.test` | `dev_admin` | `is_admin` + comped Pro — `/admin/*`, challenge authoring |
| `pro@dev.pipglyph.test` | `dev_pro` | Paid Pro, 200 credits — premium/export/deck tools |
| `free@dev.pipglyph.test` | `dev_free` | Free tier, 5 credits — upgrade prompts, drafts |
| `artist@dev.pipglyph.test` | `dev_artist` | 15 cards across every verified frame kind — gallery, profile, trending |
| `new@dev.pipglyph.test` | `dev_new` | **Not onboarded** — exercises the first-run wizard |

Plus 22 cards (public / unlisted / private, remixes, a planeswalker, a saga,
snow, devoid, a token), likes / comments / follows (the triggers turn those
into 19 notifications), two decks, an active + closed + upcoming challenge, a
published + a scheduled site update, and production's verified frame combos
(`supabase/seed.sql`: 97 as of 2026-09-28). A refresh of that list does not
reach this database on its own: it has already run `seed.sql`, and the CLI
never re-runs a seed file (see below). Run the file's frame_reviews block in
the dev branch's SQL editor after each refresh.

### When to use the Docker stack instead

The shared dev database is for *using* the app. Use the local stack when you
are going to **change or destroy** things:

- **Writing a migration.** `npm run db:start`, create
  `supabase/migrations/NNNN_name.sql` by hand (next number — not
  `supabase migration new`, which emits a timestamp), then `npm run db:reset`
  to prove the whole chain + seeds apply from scratch. Point a throwaway env at
  it (`.env.e2e` has the shape) to click around.
- **E2E tests.** They create and wipe data; they only ever run against the
  local stack (`tests/README.md`). CI does the same inside the runner.

```bash
colima start --memory 4     # or Docker Desktop
npm run db:start            # boots the stack, applies migrations + seeds
npm run db:reset            # clean slate
npx supabase stop && colima stop
```

## 2. The dev branch (shared dev database)

A **persistent Supabase branch** named `dev`: always on, never auto-deleted,
~$10/month (Micro compute, $0.01344/h — billed outside the Spend Cap, not
covered by compute credits). It is a separate Postgres with its own keys; it
has never held production data (`with_data: false`).

**How it stays in sync with production's schema.** The branch tracks the
**`dev` git branch**. `.github/workflows/sync-dev.yml` fast-forwards `dev` to
`main` after every merge, and Supabase's integration then applies any new
migrations to the dev database. Nobody commits to `dev` directly.

**Manual controls** (you need `npx supabase login`; no password is stored
anywhere — the script asks the CLI for a connection string each time, verifies
it names the dev ref and not production, then runs):

```bash
npm run db:push:dev     # apply unapplied migrations to dev
npm run db:seed:dev     # …and run the seed files dev hasn't run yet (the CLI
                        # records each one in supabase_migrations.seed_files;
                        # a file it already ran is never re-run, even when it
                        # changed — it only records the new hash)
npm run seed:dev        # passwords; add `-- --copy-cards-from <username>` to
                        # copy that user's PUBLIC prod cards into dev (read-only
                        # on prod, anonymous API; images re-hosted in dev storage)
```

`[remotes.dev]` in `supabase/config.toml` carries the branch's ref, turns
seeding on for it (persistent branches don't seed unless told to) and sets its
auth Site URL + redirect allow-list. To wipe dev completely: Supabase dashboard
→ Branches → `dev` → Reset (re-runs migrations + seeds), then `npm run seed:dev`.
  After a reset, refill the frames bucket: `npm run frames:restore-dev -- --write` (docs/FRAMES.md).

## 3. Vercel wiring

| Scope | `NEXT_PUBLIC_SUPABASE_URL` / publishable key / `SUPABASE_SECRET_KEY` |
|---|---|
| Production | production project (set by the Supabase marketplace integration) |
| Preview (all branches) | **dev branch** — set by hand 2026-09-21 |
| Preview (one git branch) | that PR's ephemeral branch — written by the integration when the PR opens; **branch-specific variables override the generic Preview ones** (Vercel's documented precedence) |
| Development | **dev branch** — what `vercel env pull` writes into `.env.local` |

Other scoping, on purpose:

- **Production only:** Stripe secret + webhook secret, `NEXT_PUBLIC_BILLING_ENABLED`,
  Resend key + senders, `CRON_SECRET`, `INDEXNOW_KEY` (production only, see `lib/seo/indexnow.ts`), GA id. Previews can't charge, can't
  email, and Vercel only runs crons on production deployments anyway.
- **`AI_GATEWAY_API_KEY`:** a *separate, budget-capped* key on Preview +
  Development (set 2026-09-21); production keeps its own. Gotcha: `vercel env
  rm NAME preview` removes the WHOLE record when one record spans several
  scopes — it took Production's key with it and had to be re-added. Split a
  multi-scope variable by adding the new scopes first, then removing.
- Previews sit behind **Vercel Authentication** (Deployment Protection →
  Standard). They also carry `X-Robots-Tag: noindex` automatically.
- A preview knows its own URL: `lib/site-url.ts` prefers `VERCEL_BRANCH_URL` /
  `VERCEL_URL` when `VERCEL_ENV=preview` (Vercel sets
  `VERCEL_PROJECT_PRODUCTION_URL` on *every* deployment — before this fix
  previews sent their auth links to pipglyph.com).
- The `dev` git branch gets its own stable preview URL,
  `cardforge-git-dev-orderoftheredjester.vercel.app` — a permanent "staging".

## 4. The shipping flow

```
feature branch ──PR──▶ CI: typecheck · lint · unit · e2e (local Supabase in the runner)
                       Vercel Preview → dev database        (most PRs)
                       Vercel Preview → its own branch DB   (PR touches supabase/)
                                    │ test on the preview URL with the dev_* accounts
                                 merge to main
                                    │
        Supabase applies new migrations to PRODUCTION      (automatic)
        Vercel deploys main to production                  (automatic)
        sync-dev fast-forwards `dev` → dev DB migrates     (automatic)
```

1. Branch. Build against the dev database (`npm run dev`), or the Docker stack
   if you're writing a migration.
2. Open the PR. CI runs. If it touches `supabase/`, wait for **Supabase
   Preview** too.
3. Test on the Vercel preview URL. Sign in with a `dev_*` account (shared dev
   DB), or sign up fresh (email confirmation is off on branches).
4. Merge. Everything after that is automatic.

### Writing migrations — rules learned the hard way

- **State your grants.** Production is an *old* Supabase project that
  auto-grants new `public` objects to `anon` / `authenticated` /
  `service_role`. **New projects — every branch — don't.** `0097` made the
  existing schema explicit and aligned the default privileges, but a new table
  or function should still say who may use it:
  ```sql
  grant select, insert, update, delete on table public.my_table to authenticated, service_role;
  grant execute on function public.my_rpc(uuid) to authenticated, service_role;
  ```
  Symptom when forgotten: `permission denied for table …` (42501) on a branch
  whose Supabase check is green.
- **Admin checks in policies use `public.viewer_is_admin()`**, never a subquery
  on `profiles.is_admin` (unreadable to `authenticated` since 0074 — this broke
  challenge authoring in production until 0096).
- **No storage write policies.** Since 0126 users can't insert, update or
  delete `storage.objects` with their own JWT; uploads and removals are server
  actions on the service role (`lib/media/user-storage.ts` forces the
  `{userId}/` folder). A new bucket or upload path follows that — never an
  owner-folder policy (`supabase/migrations/README.md`, "Storage"). The same
  goes for a card's render columns (`cards_guard_render_columns`: an API
  role may only clear them). Uploads therefore need `SUPABASE_SECRET_KEY` in
  every environment — a local checkout or a preview without it can't upload,
  bake or delete a render (the app logs that loudly).
- **Picture URL columns hold our storage only** (0127): a user can store
  only an object in their own folder of the right bucket (or a built-in
  image / a Scryfall deck image) — see "Storage" in
  `supabase/migrations/README.md`. The origins it accepts are
  `public.storage_origins`: production's two in the migration, and every
  other database's OWN origin, which the app registers itself before its
  first upload (`lib/media/storage-origin.ts`: the origin of
  `NEXT_PUBLIC_SUPABASE_URL`, service role, once per process) — so the dev
  branch, each preview branch and the local stack accept exactly their own
  storage, never another project's, and nothing in `supabase/seed.sql` is
  needed. `npm run seed:dev -- --copy-cards-from` registers the dev origin
  too. A storage domain change registers itself the same way (the old host
  still goes into `LEGACY_SUPABASE_HOSTS`, `lib/media/storage-hosts.ts`, for
  the display side).

### When the Supabase check misbehaves

| Symptom | Cause | Do |
|---|---|---|
| Check stuck on "Waiting for branch action run" for minutes | The runner failed silently. `gh api repos/TOOTRJ/cardforge/commits/<sha>/check-runs` → `output.summary` has the reason | Close + reopen the PR to re-run |
| `Capacity is unavailable at this time…` | Supabase-side AWS capacity. Not you. Not listed on their status page when it happened (2026-09-21) | Retry later. The failed check doesn't block merging; validate with `npm run db:reset` locally |
| Branch `MIGRATIONS_FAILED`, database has **no tables** | A branch created outside a PR (CLI/dashboard) is built by replaying the parent's *recorded* migration history. Prod's rows for 0001–0053 are repair stubs with no SQL, so the replay skips them and dies at 0054 | Branch DB only: delete the statement-less rows from `supabase_migrations.schema_migrations`, then `npm run db:push:dev`. PR-created branches build from the repo and aren't affected |
| Preview loads but everything is "permission denied" | Missing grants — see above | Add the grants in a migration |
| Preview builds point at the wrong database | `NEXT_PUBLIC_*` is inlined at build time; the integration writes branch vars when the PR *opens* | Redeploy the preview; for an already-open PR, close + reopen |

### Manual production fallback

`npm run db:push:prod` still exists (reads `SUPABASE_PROD_REF`, requires typing
`production`). For genuine emergencies only.

### Storage orphan sweep (owner-run, TODO 3.14b)

`scripts/sweep-storage-orphans.mjs` lists, and with `--apply` deletes, the
storage objects no database row references: flagged uploads and replaced
avatars/banners that the pre-0126 user-session removes never deleted, art
uploaded for a card that was never saved, renders of deleted cards, leftovers
of deleted accounts. Run it from an up-to-date `main` checkout:

```bash
node scripts/sweep-storage-orphans.mjs                  # dev (.env.local), dry run
node scripts/sweep-storage-orphans.mjs --target prod    # prod, dry run (hidden-prompt key)
node scripts/sweep-storage-orphans.mjs --target prod --apply --batch-size 100 \
  --backup-dir ~/.pipglyph/sweep-backups/$(date +%F)
```

**Owner steps on production, in this order, once #409, #411 and the
moderation/CDN follow-up (fix/moderation-cdn-followup) are live** (each
step's dry run first; nothing is deleted or changed without `--apply` +
"yes"):

1. `node scripts/sweep-storage-orphans.mjs --target prod` — the dry run:
   orphans, plus the two review lists below.
2. `node scripts/sweep-storage-orphans.mjs --target prod --rescan-review` —
   moderation-scans the review list (asks for production's `OPENAI_API_KEY`
   at a second hidden prompt) and lists flagged files, each with the rows
   that name it and what `--apply` will do to each. If any:
   `… --rescan-review --apply` asks for production's `CRON_SECRET` (a third
   hidden prompt; Vercel → Settings → Environment Variables), checks that
   https://www.pipglyph.com talks to the production database, and — after
   "yes" — through the app hides every card that draws a flagged file (the
   moderation hide), gives every avatar/banner that is one a built-in image,
   clears such deck covers and removes such custom pips, then removes the
   file. Rows it lists as "listed only" (a message, a notification, a job
   payload, a challenge image, a deck entry, card text) are yours to decide
   about.
3. `node scripts/sweep-storage-orphans.mjs --target prod --private-renders`,
   then `… --private-renders --apply` (asks for the `CRON_SECRET` too) —
   removes the renders of private cards and purges their `/render-cdn` CDN
   copies through the app (a deleted card's render is an orphan: step 4
   judges it).
4. The orphan sweep's `--apply` (above). Last on purpose: its
   `--backup-dir` copies what it deletes to your disk, so flagged files and
   private cards' renders are removed first, without copies.

**Acting through the app** (steps 2–3's `--apply`, owner answers
2026-09-29): the script calls `POST /api/admin/storage-sweep`
(`app/api/admin/storage-sweep/route.ts`) with `Authorization: Bearer
<CRON_SECRET>` — the row actions have to be the app's own code paths, and
only a function running on Vercel can purge its CDN. Production's app is
fixed (https://www.pipglyph.com; `--app-url` is refused there) and its
secret is read only at the hidden prompt. On the dev target pass
`--app-url http://localhost:3000` (a local `npm run dev` on the dev
database) with the same `CRON_SECRET` in `.env.local` for both the server
and the script (off Vercel there is no CDN — the purge is a no-op and the
run says so). The app is asked which database it talks to before "yes"; an
app on another database than `--target` stops the run with nothing done.

- **What counts as a reference:** the object's `{uuid}/{file}` key anywhere
  in any string of any row — the scan reads EVERY text/JSON column of EVERY
  table the API exposes (PostgREST's OpenAPI document), not a column list,
  and finds keys inside public URLs (either host), `/render-cdn/` paths,
  percent-encoded next/image URLs, Markdown, JSON at any depth and bare
  storage paths. A new column that stores a storage URL is covered without a
  code change; a new way of naming an object that doesn't contain its
  `{uuid}/{file}` key is not — keep keys in the stored value.
- **What is never deleted:** anything younger than 7 days (`--min-age-days`,
  floor 7, every bucket — AI job steps and the creator's unsaved drafts point
  at fresh uploads); a card-renders bake or thumb whose card still exists; an
  object outside the `{uuid}/{file}` user-folder shape (listed for you to
  judge); the `frames` bucket (never listed) and `card-exports` (legacy
  download history, still named by `card_exports` rows and possibly shared
  as links — listed, never deleted).
- **`--apply`** (type "yes"): batches of 25 (`--batch-size`, max 100).
  **Every batch re-reads the whole database** (every text/JSON column of
  every table, `notifications`, `funnel_events` and `ai_generation_jobs`
  included), so N orphans cost N / batch-size full reads — on production
  pass `--batch-size 100` (the prompt prints the number of full reads before
  you type "yes"). Per batch: `--backup-dir` copies each object
  (recommended for the first production run — storage has no undo; a copy
  that doesn't match the listed MD5 eTag keeps the object; the directory is
  refused inside any git working tree, since this repo is public and the
  copies are users' images — keep them under `~/.pipglyph/`), then a fresh
  full database scan for the batch's keys and card ids, then a lookup of
  every object at once right before the delete (gone, another eTag/size, or
  recently changed → kept). After the delete every object is looked up again
  and only what storage reports gone is appended to
  `~/.pipglyph/sweep-storage-orphans.<project>.manifest.jsonl` (bucket, path,
  size, eTag, last change, reason, copy); an object it can't confirm stays in
  the state file with its copy and the next run settles it. `--limit n`
  deletes at most n per run. Accepted race: a custom pip re-uploaded in the
  milliseconds between that last lookup and the delete (its name is fixed,
  `{uid}/{SYMBOL}.png`) is deleted — the user saves the pip again.
- **Listed for review, never deleted by the orphan sweep** — each list has
  its own mode (owner decisions 2026-09-29; own state + manifest,
  `~/.pipglyph/sweep-storage-orphans.<project>.<mode>.json` /
  `.manifest.jsonl`):
  - **User-folder objects whose names the server doesn't make today** (an
    older upload path, or a file written straight to storage with the
    user's own session before 0126 — it skipped the byte sniff, the strip
    and the moderation scan). `--rescan-review` runs the upload path's own
    scan on exactly this list (`lib/moderation/image-scan-core.ts`: same
    request, model and categories), paced (`--per-minute`, default 60),
    retrying 429/5xx; an error is "not scanned", never clean, and is tried
    again next run; verdicts are kept per object + eTag, so a re-run only
    scans new or changed files. `--apply` removes the object as the upload
    path does a flagged upload — but first acts, through the app
    (`lib/moderation/flagged-file.ts`), on every row that DRAWS it: a card
    (art, second-face art, set icon, watermark icon, its bake) → the
    moderation hide (`lib/moderation/hide-card.ts`, the admin's "Hide":
    private, render removed, reports actioned, pages + CDN purged); an
    avatar/banner → a random built-in of that kind; a deck cover → cleared;
    a custom pip → removed like the owner's "Remove" (and the owner's cards
    that draw it re-baked). Each action re-reads its row and acts only
    while it still draws that exact file (our host, its bucket, its key),
    compare-and-set; then the file's URLs are purged from Vercel's Image
    Optimization cache. A failed action keeps the file (a re-run retries);
    a row naming the file anywhere else is listed only; nobody is notified.
    The output and the manifest name every row and every action with its
    result (`rowActions`, `listedOnly`). No copies, ever (`--backup-dir` is
    refused). Production's `OPENAI_API_KEY` is read only
    at the hidden prompt and only sent to api.openai.com; the dev target
    reads it from the env file. Objects outside the `{uuid}/{file}` shape
    are not on the list (the dry run lists them separately).
  - **Renders of PRIVATE cards that are still stored** (publicly fetchable
    at their URL — going private should have deleted them).
    `--private-renders` removes the PNG + thumb of every card whose row
    says private — only on that positive evidence: a card with no row in
    the answer is never touched here (a deleted card's render is an orphan,
    judged by the orphan sweep with its reference check, age floor and
    backup), and a visibility answer whose exact count doesn't match the
    rows returned stops the run. Per batch of cards: first the render
    pointer of those that are private at that moment (one conditional
    UPDATE of `rendered_image_url`, `rendered_thumb_url`, `rendered_at` —
    what going private writes), then every object is looked up (gone, or
    new bytes since the listing → kept), then the visibility is read AGAIN,
    then the remove: a card that is public, unlisted or without a row by
    then is never touched. After each batch, the cards whose objects
    storage confirmed gone have their CDN copies purged through the app
    (`purge-cards` → `purgeHiddenCards`: `/render-cdn/<owner>/<card>.png`
    is cached for a year, tagged `card-<id>`); each card is noted in the
    state file (`purgePending`) before its remove and taken off once
    purged, so a crash or a refused purge is retried first by the next
    `--apply` (or purge the tags in the Vercel dashboard: CDN → Caches →
    Purge cache → Cache Tag, Delete). The dry run prints card ids and
    counts only — no titles, no owners. No backups (a render is derived).
- **Decisions recorded 2026-09-29** (upload limit, #411): AI art stays
  EXEMPT from the upload limit (it is credit-metered and already behind
  `checkAiRateLimit`); the fail-closed refusal's wording "Uploads are paused
  for a moment — try again in a minute." is approved.
- Checked on dev 2026-09-29 (a throwaway object in a fake folder, uploaded,
  removed, gone): the listing's `metadata.eTag` and `info()`'s `etag` are the
  same quoted MD5, `remove()` echoes the full paths, and `info()` of a gone
  object is a 400 with `statusCode: "404"` — the sweep compares eTags
  however they are quoted and trusts only the lookup anyway.
- Dev dry run 2026-09-29: 218 card-art objects (193 referenced, 24
  unreferenced but under 7 days, 1 test file outside a user folder), 380
  card-renders (all referenced), the other buckets empty — 0 orphans; the
  reference scan read 35 tables (768 rows) in about 2 s. The same day:
  `--private-renders` found 380 renders of 190 cards, all public/unlisted
  (nothing to remove); `--rescan-review` listed 598 objects, review list
  empty (nothing to scan).

### Branch protection on `main` (ruleset "main", created 2026-09-21)

Direct pushes and force-pushes to `main` are blocked; changes arrive by PR
only, and the merge button stays grey until **`Typecheck, lint, unit`**,
**`E2E (local Supabase)`** and **`Supabase Preview`** all pass on the PR's
latest commit (a *skipped* Supabase Preview — PRs without `supabase/`
changes — satisfies it). "Require up to date" is off, so merging one PR
doesn't force the others to rebase. **Repository admins can bypass** the
ruleset (the merge button offers it, and it's logged) — that is the escape
hatch for the day Supabase's runner is down and a PR's check never reports.
Manage it at Settings → Rules → Rulesets.

## 5. What is deliberately NOT done

- **No production data in dev.** `--with-data` branching clones real users'
  rows behind preview URLs; never use it. The only prod→dev path is
  `seed:dev --copy-cards-from`, which reads *public* cards anonymously.
- **No credentials in the repo.** It's public. Seed accounts get random
  passwords in SQL; real ones come from your local `DEV_SEED_PASSWORD`.
- **No Vercel custom environment / staging domain.** The `dev` branch's
  preview URL covers it for free. (A custom staging domain also loses the
  automatic `noindex` header — add it by hand if you ever create one.)

## 6. Audit findings (2026-09-21) and what fixed them

| # | Finding | Fix |
|---|---|---|
| 1 | Generic Vercel Preview scope had an **empty** `NEXT_PUBLIC_SUPABASE_URL` and no keys → every PR not touching `supabase/` previewed with no database | Preview + Development scopes → dev branch |
| 2 | Every Supabase branch was unreadable by the API: migrations relied on old-project default grants that new projects don't have | Migration `0097_explicit_api_grants.sql` |
| 3 | `.env.local` pointed at production | Repointed at dev; `check-dev-env.mjs` guard; `.env.prod-peek` |
| 4 | Branches had no test data; the creator showed every frame as "Soon" | `supabase/seed.sql` (verified frames) + `supabase/seeds/10_dev_data.sql` + `scripts/seed-dev.mjs` |
| 5 | No CI — the e2e suite drifted to 12 failures hiding 2 real bugs | `.github/workflows/ci.yml` |
| 6 | Previews believed they were pipglyph.com (auth links went to prod) | `lib/site-url.ts` |
| 7 | Branch auth redirect allow-list had only `127.0.0.1` | `config.toml` wildcard for the team's `*.vercel.app` |
| 8 | Previews shared production's paid AI key | Separate budgeted key on Preview + Development (done 2026-09-21) |
| 9 | Branch failures were silent (hung checks, empty DBs) | Runbook table above |
