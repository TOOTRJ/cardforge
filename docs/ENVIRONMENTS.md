# Environments: local dev → preview branches → production

How PipGlyph code and database changes flow from your machine to production,
using **Supabase branching** (Pro plan) for the test environment.

| | App runs | Database | Who sees it |
|---|---|---|---|
| **Local** | `next dev` on your machine | Local Supabase (Docker, `supabase start`) | Just you |
| **Preview** (per PR) | Vercel Preview deployment | An ephemeral **Supabase preview branch**, created automatically for the PR | You + anyone with the preview link |
| **Production** | Vercel Production (`main`) | The prod Supabase project | Everyone |

The promotion path: **build locally against the local DB → open a PR
(Supabase spins up a preview branch with your migrations applied; Vercel
deploys a preview wired to it) → test on the preview URL → merge → Supabase
applies the new migrations to production and Vercel deploys `main`.**

Migrations in `supabase/migrations/` are the single source of truth for the
schema (complete, 0001→…). With branching enabled, **you never run a manual
migration push in the normal flow** — the GitHub integration does it on every
preview-branch commit and again on merge to `main` (its deploy workflow is
Clone → Pull → Health → Configure → Migrate → Seed → Deploy).

---

## 1. Local development (one-time setup)

Prereqs: Docker or colima (`brew install colima docker && colima start --memory 4`)
and the Supabase CLI (`brew install supabase/tap/supabase`).

```bash
supabase start    # starts the local stack, applies all migrations + supabase/seed.sql
supabase status   # prints your local URL + keys (API http://127.0.0.1:54321)
```

Point `.env.local` at the LOCAL stack, not prod:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key from `supabase status`>
SUPABASE_SECRET_KEY=<secret key from `supabase status`>
# AI keys etc. can stay as-is; leave NEXT_PUBLIC_GA_MEASUREMENT_ID unset
```

> ⚠️ **Until now `.env.local` pointed at production** — local card saves,
> likes, and experiments wrote to the live database. Switching to the local
> stack is the single most important change in this document.

Day-to-day:

```bash
supabase start             # once per boot
npm run dev                # app on :3000 against the local DB
node scripts/seed-e2e.mjs  # optional: create the e2e test user
npm run db:reset           # re-apply all migrations + seed for a clean slate
```

Creating a schema change:

```bash
supabase migration new my_change_name   # new supabase/migrations/00NN_*.sql
# write the SQL, then verify the full chain applies cleanly:
npm run db:reset
```

Never edit an already-shipped migration — always add a new one. With
branching, an edited historical migration will fail the branch's Migrate
step and block the PR (which is the guard working as intended).

## 2. Branching setup (one-time, ~15 minutes, dashboard-side)

1. **Enable branching**: Supabase dashboard → your project → **Branches** →
   Enable branching (Pro plan feature).
2. **Connect GitHub**: install the Supabase GitHub App on the
   `TOOTRJ/cardforge` repo when prompted, and set the **production branch**
   to `main`. From now on Supabase watches PRs.
3. **Connect Vercel**: install the
   [Supabase integration from the Vercel Marketplace](https://vercel.com/marketplace/supabase)
   and connect it to the `cardforge` Vercel project. This is what copies each
   preview branch's credentials (URL + publishable key + secret key) into the
   matching Vercel Preview deployment, and auto-registers the preview URL in
   the branch's auth redirect allow-list.
4. **Sanity-check the first PR**: open a trivial PR, wait for the Supabase
   check to go green, open the Vercel preview, and confirm the app talks to
   the branch (Vercel deployment → Environment variables should show
   branch-specific `NEXT_PUBLIC_SUPABASE_URL` / publishable key / secret
   key). If a variable the app needs didn't sync, add it Preview-scoped by
   hand once — names the app reads: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

Notes:

- **Preview branches start EMPTY (schema, no data)** — by design, so prod
  data never leaks into previews. `supabase/seed.sql` runs on every branch
  creation: put baseline/demo rows there as the app grows so previews are
  testable without manual clicking.
- **Costs**: preview branches bill per hour (~$0.013/hr) and pause when
  idle; a typical PR costs cents. Branches are deleted when the PR merges
  or closes.
- **Env sync happens when the PR opens** — a long-lived ("persistent")
  branch does NOT get Vercel env syncing, which is why the per-PR flow is
  the primary staging story. If you later want an always-on staging URL,
  create a persistent branch + a Vercel custom environment and wire its
  vars by hand (that's the "later, if the site grows" tier).
- **Dashboard-side auth config** (Google OAuth client, email templates) is
  per-branch-from-`config.toml`, not copied from prod. Email/password auth
  works on previews out of the box; only add `[auth.external.google]` to
  config.toml if you need to test Google sign-in on previews.
- **Stripe** stays test-mode outside production: set the test-mode keys
  Preview-scoped in Vercel (or leave `NEXT_PUBLIC_BILLING_ENABLED=false`
  for Preview).

## 3. The shipping flow

```
feature branch ──PR──▶ Supabase preview branch (migrations + seed auto-applied)
                       Vercel Preview deployment (branch creds auto-synced)
                                    │ test on the preview URL
                                 approve
                                    ▼
                              merge to main
                                    │
        Supabase applies new migrations to PRODUCTION (automatic)
        Vercel deploys main to production
```

1. Branch, build, test locally (local DB).
2. Open the PR. Wait for the **Supabase check** — if a migration is broken,
   it fails here, on the branch, not on prod.
3. Test the Vercel preview URL (it's already pointed at the branch DB).
4. Merge. Supabase migrates prod; Vercel ships the code. Done — no manual
   push in the normal path.

### Manual fallback

`npm run db:push:prod` still exists for out-of-band situations (hotfix SQL
pushed outside a PR, or re-syncing if the integration hiccups). It reads
`SUPABASE_PROD_REF` from `.env.local` and requires typing `production`.
`npm run db:push:staging` (ref: `SUPABASE_STAGING_REF`) is only relevant if
you later create a persistent branch — a branch has its own project ref you
can point it at. Neither script is part of the everyday flow anymore.

## 4. Later, if the site grows

- GitHub Action for typecheck/lint/unit tests on PRs (the Supabase check
  gates migrations; nothing currently gates app code).
- A persistent `staging` branch + Vercel custom environment with a stable
  `staging.pipglyph.com` domain, for QA that outlives single PRs.
- Data-seeding strategy for previews (richer seed.sql, or a scrubbed
  data-clone script) once "empty preview" stops being enough.
