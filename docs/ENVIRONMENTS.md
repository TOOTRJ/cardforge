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
published + a scheduled site update, and production's 71 verified frame combos.

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
npm run db:seed:dev     # …and (re)apply the seed files — idempotent
npm run seed:dev        # passwords; add `-- --copy-cards-from <username>` to
                        # copy that user's PUBLIC prod cards into dev (read-only
                        # on prod, anonymous API; images re-hosted in dev storage)
```

`[remotes.dev]` in `supabase/config.toml` carries the branch's ref, turns
seeding on for it (persistent branches don't seed unless told to) and sets its
auth Site URL + redirect allow-list. To wipe dev completely: Supabase dashboard
→ Branches → `dev` → Reset (re-runs migrations + seeds), then `npm run seed:dev`.

## 3. Vercel wiring

| Scope | `NEXT_PUBLIC_SUPABASE_URL` / publishable key / `SUPABASE_SECRET_KEY` |
|---|---|
| Production | production project (set by the Supabase marketplace integration) |
| Preview (all branches) | **dev branch** — set by hand 2026-09-21 |
| Preview (one git branch) | that PR's ephemeral branch — written by the integration when the PR opens; **branch-specific variables override the generic Preview ones** (Vercel's documented precedence) |
| Development | **dev branch** — what `vercel env pull` writes into `.env.local` |

Other scoping, on purpose:

- **Production only:** Stripe secret + webhook secret, `NEXT_PUBLIC_BILLING_ENABLED`,
  Resend key + senders, `CRON_SECRET`, GA id. Previews can't charge, can't
  email, and Vercel only runs crons on production deployments anyway.
- **`AI_GATEWAY_API_KEY`:** use a *separate, budget-capped* key for Preview +
  Development so testing AI features can't spend the production budget.
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

### Writing migrations — two rules learned the hard way

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
| 8 | Previews shared production's paid AI key | Separate budgeted key for Preview + Development (owner step) |
| 9 | Branch failures were silent (hung checks, empty DBs) | Runbook table above |
