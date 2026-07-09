# Environments: local dev → staging → production

How PipGlyph code and database changes flow from your machine to production.
Three environments, deliberately simple:

| | App runs | Database | Who sees it |
|---|---|---|---|
| **Local** | `next dev` on your machine | Local Supabase (Docker, `supabase start`) | Just you |
| **Staging** | Vercel **Preview** deployments (every PR gets a URL) | `pipglyph-staging` Supabase project (free tier) | You + anyone with the preview link |
| **Production** | Vercel Production (`main` branch) | The existing prod Supabase project | Everyone |

The promotion path: **build locally against the local DB → open a PR (Vercel
auto-deploys a preview against staging) → approve → merge to `main` (Vercel
deploys prod) → push migrations to prod.**

Migrations in `supabase/migrations/` are the single source of truth for the
schema. They are complete (0001→0053) — any fresh database built from them is
a faithful, empty copy of prod's schema, RLS policies, and storage buckets.

---

## 1. Local development (one-time setup)

Prereqs: Docker or colima (`brew install colima docker && colima start --memory 4`)
and the Supabase CLI (`brew install supabase/tap/supabase`).

```bash
# Start the local stack — applies all migrations + supabase/seed.sql
supabase start

# See your local URL + keys (API URL http://127.0.0.1:54321)
supabase status
```

Point `.env.local` at the LOCAL stack, not prod:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from `supabase status`>
SUPABASE_SECRET_KEY=<secret key from `supabase status`>
# AI keys etc. can stay as-is; leave NEXT_PUBLIC_GA_MEASUREMENT_ID unset
```

> ⚠️ **Until now `.env.local` pointed at production** — meaning local card
> saves, likes, and experiments wrote to the live database. Switching to the
> local stack is the single most important change in this document. If you
> occasionally need to eyeball prod data locally, keep a `.env.production-peek`
> file to swap in consciously, never as the default.

Day-to-day:

```bash
supabase start          # once per boot (fast if containers exist)
npm run dev             # app on :3000 against the local DB
node scripts/seed-e2e.mjs  # optional: create the e2e test user
supabase db reset       # nuke + re-apply all migrations + seed when you want a clean slate
```

Creating a schema change:

```bash
supabase migration new my_change_name   # creates supabase/migrations/00NN_my_change_name.sql
# write SQL in the new file, then:
supabase db reset                        # verify the full chain applies cleanly
```

Never edit an already-shipped migration file — always add a new one.

## 2. Staging (one-time setup, ~20 minutes)

1. **Create the project**: Supabase dashboard → New project → name it
   `pipglyph-staging` (free tier is fine). Choose the same region as prod.
2. **Apply the schema** from your machine:
   ```bash
   supabase link --project-ref <STAGING_REF>   # ref is in the project's dashboard URL
   supabase db push                             # applies all migrations
   ```
3. **Auth config** (dashboard → Authentication): set Site URL to your Vercel
   preview domain pattern and add `https://*-<team>.vercel.app/**` to the
   redirect allow-list. Email/password works out of the box; only configure
   Google OAuth here if you need to test it on staging.
4. **Wire it to Vercel Preview**: Vercel dashboard → cardforge project →
   Settings → Environment Variables. For each of these, add a value scoped to
   **Preview only** (Production keeps its current values):
   - `NEXT_PUBLIC_SUPABASE_URL` → `https://<STAGING_REF>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → staging publishable key
   - `SUPABASE_SECRET_KEY` → staging secret key
   - `NEXT_PUBLIC_BILLING_ENABLED` → `false` (or wire Stripe **test-mode**
     keys + a staging webhook if you want to test billing)
   - leave `NEXT_PUBLIC_GA_MEASUREMENT_ID` unset for Preview
5. **Seed it** (optional): run `node scripts/seed-e2e.mjs` with a temporary
   `.env.e2e` pointing at staging, or just sign up and create a few cards on
   the preview URL. Note the seed script's localhost guard must be bypassed
   deliberately — it exists to protect prod; staging seeding by hand is fine.

That's it. From now on **every PR automatically gets a preview URL running
against the staging database** — no per-PR work.

## 3. The shipping flow

```
feature branch ──PR──▶ Vercel Preview + staging DB ──approve──▶ merge to main
                                                                    │
     supabase db push (staging)  ◀── if the PR has a migration      ▼
                                                          Vercel Production build
                                                                    │
                                              npm run db:push:prod  ▼ (only if migrations changed)
                                                          prod DB updated
```

1. Branch, build, test locally (local DB).
2. If the change includes a migration: `npm run db:push:staging` **before**
   asking anyone to test the preview — the preview app expects the new schema.
3. Open the PR, click the Vercel preview link, test against staging data.
4. Approve + merge. Vercel deploys `main` to production automatically.
5. If migrations shipped: `npm run db:push:prod` **before or immediately
   after** the prod deploy goes live (new code usually tolerates the old
   schema for seconds, but push promptly; for breaking schema changes, push
   the migration first, then merge).

npm scripts (thin wrappers so you never push to the wrong project):

```bash
npm run db:push:staging   # supabase db push against pipglyph-staging
npm run db:push:prod      # supabase db push against prod — asks for confirmation
```

## 4. What stays manual (on purpose)

- **Migration pushes** are a deliberate command, not CI magic — you asked for
  "not overdone," and a human-triggered `db:push:prod` after approval is the
  simplest gate that still prevents untested schema reaching prod.
- **Dashboard-side config** (Google OAuth creds, email templates, auth
  redirect URLs) lives per-project in the Supabase dashboard. When you change
  one in prod, mirror it in staging. There are only a handful.
- **Stripe** stays test-mode-only outside production.

## 5. Later, if the site grows

- GitHub Action that runs typecheck/lint/unit tests on PRs (cheap, add anytime).
- Supabase **branching** (~$0.013/hr per branch) for per-PR databases instead
  of one shared staging DB — worth it only when multiple people ship
  conflicting schema changes simultaneously.
- A dedicated `staging` Vercel custom environment (Pro plan) with a stable
  `staging.pipglyph.com` domain instead of per-PR preview URLs.
