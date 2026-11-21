# Vercel build cost: audit and ranked recommendations (2026-11)

The owner wants a full audit of what decides when Vercel builds and how long
each build takes, then ranked options to cut build CPU minutes without
lowering security. **This is research only.** Nothing in `vercel.json`,
`next.config.ts`, `package.json`, CI or the Vercel / Supabase dashboards was
changed. Every step below waits for the owner's approval.

**Sources and evidence.** The numbers come from three places:

- the Vercel project itself, read through the Vercel API (read-only):
  `cardforge`, team `orderoftheredjester`, the **last 100 deployments**
  (2026-10-30 02:13 → 2026-11-02 21:50 UTC, 3.8 days) and the build logs of
  two production builds;
- this repository at `main` 397d351;
- vendor docs. This session could not open `vercel.com` (network policy).
  Vercel's docs were read through the Vercel MCP documentation index and
  search snippets of the pages cited.

Marks used below: **[M]** measured on this project; **[P]** primary vendor
docs; **[S]** a secondary source (blog, community thread); **[U]**
unverified or inferred. Prices are **[S]**: check them on the Billing page
before relying on a dollar figure.

### What was measured (100 deployments, 3.8 days) [M]

| Group | Builds | Mean build | Median | Min–max | Wall min | Billed min (each build rounded up) | Share of billed |
|---|---|---|---|---|---|---|---|
| Production (`main`) | 22 | 316 s | 290 s | 230–797 s | 116 | 127 | 37 % |
| `dev` (sync of every merge) | 22 | 145 s | 123 s | 112–200 s | 53 | 62 | 18 % |
| PR branches, `source: git` | 42 | 138 s | 123 s | 56–217 s | 96 | 116 | 34 % |
| PR branches, Supabase redeploys | 14 | 147 s | 146 s | 56–227 s | 34 | 40 | 12 % |
| **All** | **100** | | | | **300** | **345** | |

345 billed minutes × 8 vCPU ≈ **2 760 CPU minutes in 3.8 days**, about
**$9.70 at the quoted Elastic rate**, which projects to about **$75 a month**
for `cardforge` at this pace [S for the rate]. The pace is about 26 builds
and 5.8 merges a day; October averaged 2.5 merges a day. The dashboard
(section 5) has the real figure.

Inside those minutes [M]:

- the production **frames check**: mean 172 s, median 147 s, 107–671 s; it
  is **54 % of all production build time**, and 21 % of all build time;
- **TypeScript** inside `next build`: 49–51 s in each READY build, about
  80 of the 300 wall minutes (**~27 %**);
- **notes-only** work: 13 builds, ~37 wall minutes (7 PR builds and the 6
  main + `dev` builds of 3 notes-only merges);
- **overtaken builds:** 5 production builds (25 wall minutes) and 4 `dev`
  builds (9 minutes) were still running when a newer build of the same
  branch started, in merge bursts. On 2026-11-02 at 21:48–21:50, three
  merges built three production deployments side by side. Only the last
  took the domains; the other two finished with no alias at all. The three
  checks shared storage, and each took 107–164 s for the same work.

## TL;DR

1. **Every build runs on an 8-core Enhanced machine, and much of the time it
   is waiting on the network.** The project uses *Elastic* build machines,
   which picked "8 cores, 16 GB (Enhanced Build Machine)" for every build
   sampled [M]. Elastic is billed per **CPU minute** (build minutes × vCPUs)
   [S]. The production build's frames check is 4 280 HTTP lookups, 4 at a
   time. It took **107–164 s** on normal days (median 147 s over 22 builds) and **671 s (11.2 min) of a
   13.3-minute build** on 2026-11-02 [M]. The other seven cores did nothing
   meanwhile. Pinning a smaller machine is one dashboard switch, touches no
   security property, and is likely the single largest saving.
2. **About 44 % of all builds are main + dev.** Every merge builds twice:
   production for `main`, then a preview of `dev`, which `sync-dev.yml`
   fast-forwards a few seconds later. That was 22 + 22 of the 100 [M]. The
   `dev` build is needed: its alias is the dev database's auth `site_url`
   and the Stripe sandbox's webhook. But it doesn't need to run on a
   notes-only merge.
3. **A quarter of PR builds are duplicates made by Supabase.** On a PR that
   touches `supabase/`, the integration "is always automatically
   re-deploying the most recent deployment of the given pull request" [P].
   So every push builds twice: 14 of the 56 PR builds had `source:
   "redeploy"` with the same SHA, all on `supabase/` PRs [M].
4. **Nothing is skipped today.** There is no Ignored Build Step. Drafts,
   notes-only branches and notes-only merges all build [M]. Seven of the 82
   merges since 2026-10-01 were notes-only. Notes-only branches made 7 of
   the 56 PR builds [M].
5. **Next.js type-checks inside every Vercel build: 49–51 s, about a
   quarter of all build time** [M]. CI's required check already does it on
   the same tree. That is more than the frames check's 21 % (which is 54 %
   of production builds).
6. **Top 3** (details in [the plan](#step-by-step-plan-for-the-top-3)):
   1. pin the build machine instead of Elastic (try Standard, then Basic),
      and allow one active build per branch;
   2. skip the type check inside Vercel builds only (CI keeps it);
   3. an Ignored Build Step script, fail-safe to *build*, that skips
      notes-only changes everywhere, then drafts' previews as phase 2.

   Fourth, with its own plan because the owner asked about it: make the
   in-build frames check incremental. New manifest objects are checked in
   full, plus a canary sample of the rest.

   Together, the estimate is roughly **45 % fewer build minutes** before
   the machine change, and **~70 % fewer CPU minutes** with Standard [U].
   No production gate is weakened, no secret moves, and preview protection
   is untouched.

## 1. Audit: today's flow

### 1.1 What triggers a Vercel build

Vercel for GitHub builds **every push to every branch**, plus every
redeploy [M]. No `ignoreCommand` exists: `vercel.json` holds only the
crons, there is no `vercel.ts` and no `.vercelignore`. `git.deploymentEnabled`
is not set, and nothing in the project settings returned by the API skips a
branch.

```
push to a PR branch (draft or ready, code or notes)
  └─▶ Vercel Preview build #1                     (source: git)
      └─ PR touches supabase/? → Supabase branch run → Preview build #2 (source: redeploy)

close + reopen a PR (to rebuild its Supabase branch)
  └─▶ Supabase creates the branch → redeploys the PR's latest deployment → build

merge to main (every merge, notes-only included)
  ├─▶ Vercel Production build (main)  — frames check (prod only) + next build
  ├─▶ GitHub CI on main (verified / full / notes tier)
  └─▶ sync-dev.yml: git push origin main:dev
        ├─▶ Vercel Preview build of `dev`  (→ cardforge-git-dev-… alias)
        └─▶ Supabase migrates the dev DB from the dev git branch
```

Answers to the brief's questions:

- **Every push to every branch?** Yes, drafts included. `github.autoJobCancelation`
  is at its default, so a newer push on the same branch cancels the older
  commit's build [P].
- **Docs-only changes?** Yes, on PRs *and* on `main`. The three notes-only
  merges in the window (#695, #698, #699) each made a production build and a
  `dev` build [M].
- **Does every merge build twice?** Yes. All 22 merges in the window have
  a production deployment and a `dev` deployment of the same SHA, about
  20 s apart [M].
- **Does a reopen build again?** Yes. Supabase redeploys once the new branch
  is ready [P]. A reopen costs one more full preview build, plus the
  Supabase branch run.

### 1.2 What a build does, and how long it takes

Measured on the production build of 397d351 (`dpl_AQoucX…`, a good day) and
of 127ff10 (`dpl_9JN4FS…`, 2026-11-02, slow storage) [M]:

| Step | 397d351 | 127ff10 | Runs on |
|---|---|---|---|
| Queue → clone (3 s) → cache restore → `npm install` (cache hit, 1 s) | ~6 s | ~5 s | every build |
| `frames-check.mjs --if-production`: 4 280 HEAD-style reads of prod storage, 4 in flight | **107 s** | **671 s** | production only |
| `next build`: Turbopack compile | 38.7 s | 38.0 s | every build |
| `next build`: TypeScript | **51 s** | **49 s** | every build |
| `next build`: collect + 170 static pages (7 workers) | ~15 s | ~20 s | every build |
| Deploy outputs | 11 s | ~12 s | every build |
| Create + upload build cache (216 MB) | ~9 s | ~9 s | every build |
| **Total (buildingAt → ready)** | **230 s (3.8 min)** | **797 s (13.3 min)** | |

A preview build skips the frames check (`VERCEL_ENV !== "production"`), so
it is roughly the `next build` part alone. Measured examples [M]: the `dev`
build of 397d351 took 119 s, a code PR 188 s, a Supabase redeploy 210 s, a
notes-only PR 112 s, and a failing build 56 s.

- **Machine:** "Build machine configuration: 8 cores, 16 GB (Enhanced Build
  Machine)" in all 22 production logs. The project's build machine type is **elastic**
  (the API's filter matched it for `elastic`, not for `default`, `enhanced`
  or `turbo`) [M]. Elastic sizes "based on your recent build durations" and
  bills CPU minutes [S]. **Inference [U]:** the 11-minute frames-check builds
  make the project look slow, so Elastic picks a bigger machine, even though
  the slow part is network-bound and gains nothing from cores.
- **Cache:** `.next/cache` is restored on every build ("Restored build cache
  from previous deployment", 216 MB) [M]. Turbopack's *persistent build*
  cache (`experimental.turbopackFileSystemCacheForBuild`) is not enabled, so
  compile starts cold every time apart from what Next keeps in `.next/cache`.
  The **frame cache does not cross builds on Vercel**: the frames check never
  downloads frames, it only checks them, and `public/frames` is excluded from
  function tracing (`next.config.ts`). CI's two frame caches are GitHub
  caches and do not help Vercel.
- **Output tracing and images** are already lean: frames and default deck
  covers are excluded, `deviceSizes` / `imageSizes` are trimmed, and
  `minimumCacheTTL` is 31 days. Image optimisation is a runtime cost, not a
  build cost.
- **Prebuilt pages:** 169–170 static/SSG pages take 13–18 s. The
  `generateStaticParams` routes (`/learn/[category]`, `/help/[section]`, the
  hubs, articles, challenges) are small. This is not a cost driver.

### 1.3 The frames check: how often, and why it is slow

`npm run build` = `node scripts/frames-check.mjs --if-production && next build`.
On a production build (`VERCEL_ENV=production`) it checks **every** object in
`lib/frames/frame-manifest.json` (4 280) against production's public
`frames` bucket. It runs 4 at a time because it reads production storage,
re-checks every apparent miss, and has a 780 s budget. It runs inside
Vercel's build minutes on **every production build**, whether or not the
manifest moved.

- Only **9 of the 82 merges** since 2026-10-01 changed the manifest [M].
- Bucket objects are **content-addressed**: the key holds the sha
  (`frameObjectKey(key, hash)`). No script deletes from the production bucket:
  `frames-promote.mjs` only copies objects production lacks. An object that
  was verified once stays verified unless someone deletes it by hand or
  Supabase loses data.
- CI's **Frames published** job runs the same full check on GitHub Actions
  for every main merge in the full and verified tiers, and it is a required
  check on PRs (`docs/FRAMES.md`). So the in-build check is the *second*
  copy. It exists for the one case CI cannot stop: an admin-bypassed or
  out-of-order merge reaching production with unpromoted frames.

### 1.4 What GitHub Actions and Vercel both do

| Work | GitHub Actions (ci.yml) | Vercel |
|---|---|---|
| `next build` | `static` job, every draft push and every full run | every push, every merge, the `dev` sync, every Supabase redeploy |
| TypeScript | `npm run typecheck`, **and** again inside `next build` | inside every `next build` |
| Frames check (full) | `frames` job, full + verified tiers | every production build |
| Deploy | none | every build |

A green full CI run (build + e2e + visual + parity) already proves a commit.
Vercel's preview build is what the owner *clicks*; Vercel's production build
is what *ships*. The repository is **public** [M, `list_repos`]. GitHub
Actions on standard runners is free for public repositories [P]. CLAUDE.md
still says minutes are billed because the repo is private; one of the two is
out of date, and the owner should confirm which. While the repo is public,
work moved from Vercel to Actions costs nothing.

## 2. Cost drivers, with estimates

Window: 100 deployments in 3.8 days, about 26 a day [M]. CPU minutes = build
minutes × 8 vCPU on today's Enhanced machine. Vercel rounds each build up to
a whole minute [S]. At the quoted Elastic rate of $0.0035 per CPU minute
[S], one Enhanced minute costs about $0.028.

| # | Cost driver | Builds | Billed min (of 345) | Share | Why |
|---|---|---|---|---|---|
| D1 | **Machine size**: 8 vCPU on every build | 100 | — (a ×8 multiplier on all of it) | — | Elastic chose Enhanced; at least half of a production build is network-bound |
| D2 | **Type check inside `next build`** | 96 READY | ~80 wall | ~25 % | duplicates CI's required check |
| D3 | **Frames check in production builds** | 22 | ~63 wall | ~19 % | full 4 280-object check on every production build; only 11 % of merges move the manifest |
| D4 | **`dev` mirror build of every merge** | 22 | 62 | 18 % | needed for the staging alias, but not on notes-only merges |
| D5 | **Supabase redeploys** on `supabase/` PRs | 14 | 40 | 12 % | by design of the integration [P]; `supabase/` PRs were 32 of the 56 PR builds |
| D6 | **Notes-only builds** (PRs + merges) | 13 | ~42 | ~12 % | no Ignored Build Step |
| D7 | **Overtaken builds in merge bursts** (main + `dev`) | 9 | ~38 | ~10 % | builds start side by side; only the newest is used |
| D8 | **Draft PR previews** | unknown | part of the 156 PR minutes | unknown [U] | every push to a draft builds; most sessions open drafts |

The drivers overlap. A notes-only merge is in D4 and D6, for example, so
the shares don't add up to 100 %.

**Per merge** (code change, normal storage day): production ~4.8 min
(rounded up to 5–6, ≈ 44 CPU min) plus `dev` ~2.4 min (3 billed, ≈ 24 CPU
min) ≈ **68 CPU min ≈ $0.24**. On a slow-storage day the production build
alone is ~14 min (~112 CPU min), ≈ **$0.48 per merge**.

**Per PR push:** ~2.3 min (3 billed) ≈ 24 CPU min ≈ **$0.08**. On a
`supabase/` PR it doubles to ≈ **$0.17**, because of the redeploy. A reopen
adds one more.

**What the owner should check** (the estimates assume list prices and
Enhanced on every build):

1. Vercel dashboard → team **orderoftheredjester** → **Usage** → **Builds**
   (Build minutes / Build CPU minutes). Set the range to the last 30 days and
   group or filter by **project** `cardforge`, then by **branch** and
   **environment**. Compare `main` (production), `dev` and everything else.
2. The same page → **On-Demand Concurrent Builds**: is any usage shown?
   (The API filter for "elastic concurrency enabled" matched all four team
   projects, which suggests the filter was ignored [U].)
3. Any deployment → **Build** tab: since 2026 a deployment shows its
   **billable duration and CPU minutes** [S]. Open `dpl_9JN4FS…`
   (127ff10, 2026-11-02) to see a slow-frames-check build's real charge.
4. Project → **Settings → Build and Deployment → Build Machine**: confirm
   "Elastic", and which sizes it has chosen recently.
5. **Billing → Invoices / Usage breakdown**: the line items for Build CPU
   minutes, and on-demand concurrency if any. (The API's billing-charges
   endpoint answered "Plan not found" to this session, so no dollar figures
   could be read.)

## 3. Options, researched

### 3.1 Build machine size and concurrency

- **What:** Elastic picks between 4 and 30 vCPUs and bills per CPU minute
  [S]. Fixed choices are **Basic** (2 vCPU / 8 GB, about $0.007 per build
  minute, offered to Pro since 2026-09), **Standard** (4 vCPU / 8 GB, about
  $0.014), **Enhanced** (8 / 16, about $0.028) and **Turbo** (30 vCPU,
  about $0.105) [S]. A commit marker `#VERCEL_BUILD_MACHINE=TURBO` buys
  Turbo for one deploy [P]. Unlike Turbo, there is no documented per-commit
  marker that buys a *smaller* machine.
- **Why it pays here:** at least 2 of the ~4 minutes of a production build
  are the network-bound frames check, deploy upload and cache upload. They
  take the same time on 2 cores as on 8. TypeScript is mostly
  single-threaded. Only the Turbopack compile and the page generation scale
  with cores. Expected on **Standard**: about 50 % fewer CPU minutes per
  build for perhaps +20–40 % wall time [U]. On **Basic**: about 65–75 %
  fewer, for perhaps +60–120 % wall time, *if* 8 GB holds the build [U].
- **Concurrency:** many cloud sessions push at once. If on-demand concurrent
  builds are on, every parallel build is paid for immediately. With them off,
  builds queue on the plan's included slots. `WAIT_FOR_NAMESPACE_QUEUE`
  limits a branch to one active build [P]. In the window, 5 production and
  4 `dev` builds ran beside a newer build of the same branch, and only the
  newest was used (D7) [M]. With one active build per branch, a burst of
  merges builds the first and the last.
  - **[U]:** confirm on the dashboard that Vercel's default job cancellation
    then drops the queued middle ones. Today's side-by-side builds suggest
    cancellation only reaches builds that have not started.
- **Security:** none. Production gates, env scoping and protection are
  unchanged. **Risk:** slower deploys, including hotfixes, and a possible
  out-of-memory error on Basic. Revert with one switch.

### 3.2 Ignored Build Step (`ignoreCommand`)

- **How it works [P]:** Vercel runs the command when the deployment enters
  BUILDING. Exit **0 skips** (the deployment becomes CANCELED), exit **1
  builds**. A skipped build still counts toward deployment quotas and
  concurrent build slots [S], but it runs for seconds, not minutes.
  `VERCEL_GIT_PREVIOUS_SHA` = the SHA of the **last successful deployment
  for the project and branch**. It is only set when an Ignored Build Step is
  configured, it is empty on a branch's first push, and community threads
  report it empty when it shouldn't be [S]. `VERCEL_ENV`,
  `VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_PULL_REQUEST_ID` are available.
  The clone is shallow, so the script must fetch what it compares.
- **The rule that keeps production safe:** the script **builds on any
  doubt**. That covers an empty or unreachable previous SHA, a `git` error,
  an empty diff, a file it cannot classify, and any exception. It reuses the
  repo's own allow-list (`scripts/lib/ci-docs-only.mjs` `isNotesFile`:
  dependency-free, already held by `tests/unit/devops/ci-docs-only.test.ts`).
  It exits 0 only when every file between the last successful deployment of
  this branch and HEAD is a notes file. Because "last successful" skips
  failed builds, a code merge whose production build failed is still in the
  diff of the next merge, which then builds. A production build of real code
  is never skipped. The app reads none of those files at run time: `rg` over
  `app/ lib/ components/ proxy.ts next.config.ts` finds only comments.
- **What it can skip:**
  - (a) **notes-only, everywhere** (production, `dev`, PRs);
  - (b) **draft PRs' previews:** a call to
    `api.github.com/repos/TOOTRJ/cardforge/pulls/$VERCEL_GIT_PULL_REQUEST_ID`.
    It needs no token while the repo is public. Unauthenticated calls are
    limited to 60 an hour per IP, and Vercel build IPs are shared, so a 403 /
    429 / timeout means *build*;
  - (c) `dependabot/*` or other bot branches. None exist in the sample, but
    a one-line rule is cheap.
- **Drafts and the owner's previews:** a skipped draft has **no preview
  URL**. Marking the PR ready does **not** push, so nothing rebuilds by
  itself. The preview appears only on the next push, or when the owner
  presses **Redeploy** on the cancelled deployment. A Redeploy also runs the
  Ignored Build Step; the script must then see "ready" and build [U, test].
  Most sessions already open PRs as drafts (CLAUDE.md's CI tiers), so this
  is the biggest PR-side saving and the biggest change to how the owner
  works. Hence phase 2, behind its own approval.
- **Drafts and Supabase:** on a `supabase/` draft PR, Supabase's redeploy of
  "the most recent deployment" would redeploy a CANCELED one. It is not
  documented whether that redeploy runs the ignore step again [U]. Test it
  on one `supabase/` PR before relying on it. If it builds, the draft rule
  saves only the git-triggered half on those PRs.
- **The `dev` branch:** skipping it entirely (`git.deploymentEnabled: { "dev":
  false }`, the docs' own example [P]) would leave
  `cardforge-git-dev-orderoftheredjester.vercel.app` serving stale code. That
  alias is the dev database's auth `site_url` (`supabase/config.toml`
  `[remotes.dev]`) and the Stripe sandbox webhook endpoint
  (`docs/BILLING.md`), while its database keeps migrating with `dev`. So:
  apply rule (a) only, which skips the `dev` build when the merge was
  notes-only. Not recommended: turning `dev` off and rebuilding it from a
  deploy hook only when code changed. That adds a hook URL as a new GitHub
  secret, and it saves only the code merges' `dev` builds, which are needed
  anyway.
- **Security:** touches the **production deploy gate**. The script decides
  whether production builds at all. The fail-safe rule above, and a unit
  test that pins "any doubt builds", carry the guarantee. Preview protection,
  env scoping and secrets are untouched; rule (b) uses no secret.

### 3.3 Preview builds only when needed (ready PRs, or a label)

- **Ready-only** is rule (b) of 3.2.
- **Label-gated** ("preview" label): same mechanism, reading
  `labels` from the same API call. Adding a label does not push either, so
  it needs the same Redeploy click. It is not better than "ready" unless the
  owner wants previews of some drafts.
- **Actions-triggered previews** (a workflow on `ready_for_review` that
  creates the deployment) need a **Vercel access token in GitHub Actions**.
  Vercel tokens are team-wide, not environment-scoped: that token can deploy
  to production. **Rejected:** it moves a powerful secret to a less
  protected place.

### 3.4 Moving the frames check out of the Vercel build

The guarantee to keep: **a deploy never goes live with missing frames.**

| Option | How | Keeps the guarantee? | Saving | Security property touched |
|---|---|---|---|---|
| **A. Incremental in-build check (recommended)** | The build keeps the gate. It re-checks in full every manifest entry **not verified by an earlier production build**, plus a random canary sample (e.g. 200), and runs a full check if the marker is missing, older than 7 days, or the manifest file can't be read. The record is a file in the restored build cache, written by `VERCEL_ENV=production` builds only, after a pass against the production origin. | Yes. Every new object is checked before the build can succeed; content-addressed keys make "verified once" durable; the canary and weekly full run catch hand deletions. | mean 172 s (median 147 s) of every production build, ≈ 54 % of production build time; up to 11 min on a slow day; only ~11 % of merges touch the manifest | Frames gate: still in the build, still fails closed. It trusts a build-cache file written by production builds only [U: confirm production builds restore only production caches, as the log's "Restored build cache from previous deployment (3vswMH…)" — the previous *production* deploy — suggests] |
| **B. Vercel Deployment Checks** | Drop the in-build check. In Vercel → Settings → Deployment Checks, require the GitHub check **Frames published** before a production deployment is **promoted** (the deployment is built but not attached to the domains until the check passes) [P] | Yes for promotion, as long as the setting stays. Caveats: it lives in the dashboard, not in git; anyone can **Force Promote** [P]; GitHub warns of race conditions between check runs, rulesets and Deployment Checks [P]; on a notes-tier merge the CI `frames` job is *skipped*, and how Vercel reads a skipped check is not documented [U] | the whole check | Frames gate: moves from code to dashboard configuration with a bypass button |
| **C. Promote-after-CI** | Production builds with `--skip-domain` (or `github.autoAlias: false`), and CI promotes after green | Yes | the whole check | Needs a Vercel token in Actions → **rejected** (3.3) |
| D. Keep as is | — | Yes | 0 | — |

The other prebuild gate: `package.json` has no `prebuild` or `postbuild`
script. `scripts/check-dev-env.mjs` and the prod guards run only in `npm run
dev` / owner scripts, never in a Vercel build. The frames check is the only
gate inside the build.

### 3.5 Prebuilt deploys (`vercel build` in Actions + `vercel deploy --prebuilt`)

The docs describe it [P]. It moves build CPU to Actions, which is free while
the repo is public, and leaves Vercel only the upload. **Not recommended:**

- a team-scoped `VERCEL_TOKEN` must live in GitHub Actions;
- a production prebuilt build needs `vercel pull --environment=production`
  on a GitHub runner, which puts production's Stripe secret, Supabase secret
  key and other secrets there;
- "System Environment Variables are missing at build time with this flag"
  [P], and `BUILD_ID` / `lib/site-url.ts` read `VERCEL_*`;
- Supabase's branch redeploy and the per-branch env vars it writes are tied
  to Vercel's own git builds.

It lowers **secret protection**: this fails the brief's "no secrets move to
less-protected places".

### 3.6 Skip the type check inside Vercel builds

Next.js 16 `typescript.ignoreBuildErrors` [P], set **only when
`process.env.VERCEL === "1"`**. CI's `next build` (the `static` job) keeps
it on. That matters: `tsc --noEmit` alone doesn't see Next's generated
route types (`.next/types`, listed in `tsconfig.json` `include`) on a fresh
checkout, and the in-build check does.

- **Saving:** 49–51 s on every Vercel build (~7 CPU min each).
- **Risk:** a type error can reach production only through a merge that
  bypassed the required "Typecheck, lint, unit" check. The emitted JS is
  the same either way.
- **Security:** none. Correctness gating moves wholly to CI's required check
  (it already is the gate).

### 3.7 Turbopack's persistent build cache

`experimental.turbopackFileSystemCacheForBuild` (separate from the dev flag
since 16.0; Next 16.3's release notes promote it, with about 2.3× faster
builds on nextjs.org [P]). The repo is on 16.2.6. It could cut the ~38 s
compile on a warm cache.

- **Risk:** experimental. A stale cache is a correctness risk for a renderer
  held pixel-identical to the bake. Try it on previews only first
  (`VERCEL_ENV === "preview"`), compare a parity / visual run, then decide
  about production.
- **Security:** none.

### 3.8 Supabase's double preview builds

Supabase redeploys because of "possible race conditions between Supabase
setting correct variables, and Vercel running a deployment process" [P]. The
git-triggered build of a `supabase/` PR may have prerendered against a
schema that wasn't migrated yet.

- **Don't** try to cancel either half by script. Supabase's runner fails
  silently at times (`docs/ENVIRONMENTS.md` §4), and the PR would then have
  no good preview.
- The draft rule (3.2 b) removes both halves while a `supabase/` PR is a
  draft, subject to the redeploy test above.
- **Close / reopen** costs one build (plus a Supabase branch). Use it only
  when the branch needs re-seeding, as the runbook says.

### 3.9 Build work that is not worth touching

The 170 static pages (13–18 s), output tracing (already excludes 163 MB of
frames), image settings (runtime, already trimmed), unused routes (no large
ones found) and the 216 MB cache upload (~9 s) together are under a minute,
and each change carries its own risk.

## 4. Ranked recommendations

Saving is per build CPU minute, from the measured window. Risk is the chance
of a bad outcome times how bad it is.

| Rank | Option | Saving (share of today's billed minutes) | Risk | Effort | Security property touched |
|---|---|---|---|---|---|
| **1** | **Pin the build machine**: Standard, then try Basic, instead of Elastic (3.1) | ~50 % of CPU minutes on Standard, ~65–75 % on Basic [U] | Low: slower deploys; out-of-memory possible on Basic | one dashboard switch | none |
| **1b** | **One active build per branch** (`WAIT_FOR_NAMESPACE_QUEUE`) and no on-demand concurrency (3.1) | up to ~10 % (D7), more on busy days | Low: in a burst, intermediate merges get no production deployment of their own (the next one contains them), so there are fewer rollback targets [U: confirm queued builds are superseded] | dashboard | none |
| **2** | **Skip TypeScript in Vercel builds only** (`ignoreBuildErrors` when `VERCEL=1`) (3.6) | ~20–25 % (D2) | Low: a type error can only reach production through a bypassed required check | 3 lines + a test | none (CI's required check remains the gate) |
| **3** | **Ignored Build Step**, fail-safe to build: notes-only everywhere (3.2 a) | ~12 % (D6) | Low: builds on every doubt; pinned by a unit test | small script + test + one `vercel.json` key | **production deploy gate** (decides whether production builds) |
| **3b** | Phase 2: **skip draft previews** (3.2 b) | up to ~20 % if half of PR builds are drafts (D8) [U] | Medium: no preview until ready + Redeploy/push; Supabase redeploy of a cancelled build untested | same script | none (public API, no token) |
| **4** | **Incremental frames check in the build** (3.4 A), plus a **nightly full check in CI** | ~18 % (D3), and it removes the 11-minute tail | Low–medium: relies on content-addressed keys and on production-only build caches | script change + tests; small CI PR | **frames gate**: stays in-build, fails closed; trusts a production-written cache file |
| 5 | Turbopack persistent build cache, previews first (3.7) | ~5–10 % of compile time [U] | Medium: experimental; renderer parity | config + a parity / visual run | none |
| 6 | Frames gate via **Deployment Checks** instead of in-build (3.4 B) | ~19 % (all of D3) | Medium: the gate moves to the dashboard, can be Force-Promoted, and skipped-check semantics are undocumented | dashboard + `package.json` | **frames gate** leaves git |
| — | `dev` deployments off (`git.deploymentEnabled`) | 18 % (D4) | **High**: the staging alias (dev auth `site_url`, Stripe sandbox webhook) serves stale code | — | — **not recommended** (rule 3 covers its notes-only part) |
| — | Prebuilt deploys from Actions (3.5) | most of D1–D7 | **High** | — | **secrets** move to GitHub runners; a team-wide Vercel token in Actions → **rejected** |
| — | Actions-triggered previews / promote-after-CI (3.3, 3.4 C) | varies | — | — | a Vercel token in Actions → **rejected** |
| — | Cancel Supabase's redeploys by script (3.8) | ~12 % (D5) | High: no good preview when Supabase's runner hiccups | — | **not recommended** |

Combined effect of 1b + 2 + 3 + 4, before the machine change: roughly 45 %
fewer billed minutes. Most of the drivers are separate, but not all, so this
is less than the sum. With Standard on top, roughly 70 % fewer CPU minutes.
With Basic on top, possibly ~80 % [U]. The owner's dashboard numbers after
each step are the real measure.

## Step-by-step plan for the top 3

Each step is its own small PR or dashboard change, approved separately,
with a way back.

### 1. Pin the build machine (dashboard; no PR)

1. Read the baseline first: Usage → Builds for `cardforge`, last 7 days, CPU
   minutes per day. Note two recent production builds' "billable CPU
   minutes" on their Build tab.
2. Project → Settings → Build and Deployment → **Build Machine** → **Standard**.
   **On-Demand Concurrent Builds**: off, and the build queue set to one
   active build per branch (`WAIT_FOR_NAMESPACE_QUEUE`, 1b). In the next
   burst of merges, check that the middle production builds are cancelled
   or skipped and the last one goes live.
3. Push nothing special. Watch the next 3 previews and the next production
   build: duration, "Build machine configuration" line, out-of-memory
   errors.
4. After 2–3 days compare CPU minutes per day. If Standard holds, try
   **Basic** the same way for a few days. Watch for out-of-memory errors
   (8 GB) and decide whether the extra production wall time is acceptable.
5. **Way back:** the same switch, back to Elastic or Standard. **Security:**
   no property touched.

### 2. Skip the type check inside Vercel builds only (one PR)

1. `next.config.ts`: `typescript: { ignoreBuildErrors: process.env.VERCEL === "1" }`,
   with a comment pointing to CI's required "Typecheck, lint, unit" check
   and to this document.
2. A unit test (`tests/unit/devops/`) asserts the value is `false` without
   `VERCEL` and `true` with it. CI's `static` job (`npm run typecheck`, then
   `npm run build`, with no `VERCEL`) then still type-checks twice, including
   Next's generated route types.
3. Check on the PR's preview: the build log no longer shows "Running
   TypeScript ...", and the build is ~50 s shorter [U: confirm Next 16.2
   skips the step rather than running it and ignoring the result].
4. **Way back:** revert the PR. **Security:** none. A type error cannot
   reach `main` without bypassing the required check, and a bypass already
   skips every check.

### 3. Ignored Build Step, fail-safe to build (one PR, then phase 2)

1. **PR 1, notes-only:** add `scripts/vercel-ignore.mjs`.
   - It imports `isNotesFile` from `scripts/lib/ci-docs-only.mjs` (no npm
     dependency: the step runs before `npm install`).
   - It reads `VERCEL_GIT_PREVIOUS_SHA` and fetches that commit
     (`git fetch --depth=1 origin <sha>`), then
     `git diff --name-only <sha> HEAD`.
   - It exits **0 only if** the SHA is non-empty, the fetch and diff
     succeeded, the list is non-empty, and every file is a notes file.
     Everything else, exceptions included, exits **1**.
   - It logs its verdict and the first files it read.
   - `vercel.json`: `"ignoreCommand": "node scripts/vercel-ignore.mjs"`.
   - A unit test (`tests/unit/devops/vercel-ignore.test.ts`) pins the rule:
     empty SHA, unreadable diff, an `.mdx`, a `supabase/README.md`, a
     `.github/` file, a mixed diff all build; `docs/x.md` + `TODO.md` skips.
2. **Test on the PR's own preview:** a docs-only push should show CANCELED
   with the script's log line; a code push should build. After merge, the
   next notes-only merge should cancel both the `main` and the `dev` build;
   the next code merge should build both.
3. **Phase 2 (separate approval), drafts:** in the same script, if
   `VERCEL_ENV === "preview"` and `VERCEL_GIT_PULL_REQUEST_ID` is set, call
   the GitHub API with a 5 s timeout.
   - `draft: true` → skip.
   - Anything else (not a draft, no PR, a 403 / 429, a timeout, bad JSON) →
     build.
   - `dev` and production never call it.
   - Test: Redeploy of a cancelled draft after "ready" builds; a `supabase/`
     draft's Supabase redeploy is skipped or built (record which).
   - Write the new habit into `docs/ENVIRONMENTS.md` §4: "mark ready, then
     Redeploy (or push) to get a preview".
4. **Way back:** delete `ignoreCommand` from `vercel.json` (one-line PR), or
   override the Ignored Build Step in Project Settings to `exit 1`
   immediately.
5. **Security:** the production deploy gate. Fail-safe by construction and
   pinned by a test. No secret added. Preview protection and env scoping
   unchanged.

### 4. Incremental frames check in the production build (one PR; outside the top 3)

1. `scripts/frames-check.mjs --if-production` gains a **verified-objects
   record**: `.next/cache/pipglyph-frames-verified.json` = `{ origin,
   checkedAt, keys: [...] }`. It is read only when `VERCEL_ENV ===
   "production"` and the origin is production's.
   - It checks in full every manifest key **not** in the record, plus a
     random canary sample of 200 recorded keys.
   - It runs a **full** check when the record is missing, unreadable, for
     another origin, or older than 7 days.
   - It rewrites the record only after a fully passing run.
   - A miss fails the build exactly as today, with the same budget and the
     same message.
2. Unit tests for the selection: new keys always checked; the canary always
   present; full on a stale, absent or garbled record; never writes a
   record after a failure or outside production.
3. **Belt and braces, CI (separate small PR):** add `frames` to the nightly
   tier (`scripts/lib/ci-docs-only.mjs` `TIERS.nightly.frames = true`, the
   gate's table and its test). Production storage is then fully checked
   every night on free Actions minutes. Keep **Frames published** required
   on `main`.
4. **Confirm first** (owner, Vercel docs or support): a production build
   restores only a previous **production** deployment's build cache, never a
   preview's. If that can't be confirmed, keep the full check and take
   option 3.6 instead.
5. **Way back:** revert the PR. The full check is the default path whenever
   the record is absent anyway.
6. **Security:** the frames gate stays inside the build and fails closed. It
   now trusts one build-cache file, written by production builds only.
7. With option 1b's queue in place, the slow-storage days that come from
   three checks running side by side (D7) also become rarer.

## 5. Owner's dashboard steps (to check the estimates)

1. **Usage → Builds**, team `orderoftheredjester`, last 30 days: Build CPU
   minutes for `cardforge`, split by **branch** (`main`, `dev`, everything
   else) and by **environment**. The audit predicts main ≈ dev in build
   *count*, main ≈ 2× dev in CPU minutes, and PR branches the largest share.
2. **Usage → On-Demand Concurrent Builds**: any charge?
3. **Deployments**, filter Production: open the slowest recent builds and
   read the Build tab's billable CPU minutes. Expect the slow ones to be
   frames-check days (the log line "Checking 4280 manifest objects").
4. **Deployments**, filter Preview, branch `claude/peaceful-cannon-4v51ax`:
   you'll see pairs of builds of one SHA, the second with Source
   "Redeploy". These are Supabase's.
5. **Settings → Build and Deployment**: Build Machine (Elastic today),
   On-Demand Concurrent Builds, Ignored Build Step (none today).
6. **Settings → Deployment Protection**: Vercel Authentication should stay
   "Standard Protection" (the API reports `ssoProtection:
   all_except_custom_domains` [M]). None of the recommendations change it.

## Sources

Primary [P]:

- Vercel, *Project configuration*: `ignoreCommand` ("build continues when
  the command exits with code 1 and is ignored when it exits with 0"),
  `git.deploymentEnabled` (its own `"dev": false` example),
  `github.autoJobCancelation`, `github.autoAlias` —
  vercel.com/docs/project-configuration/vercel-json and
  /git-configuration (via the Vercel MCP docs index).
- Vercel, *Ignored Build Step* —
  [vercel.com/docs/projects/project-configuration/ignored-build-step](https://vercel.com/docs/projects/project-configuration/ignored-build-step)
  and the KB [dynamic build commands](https://vercel.com/kb/guide/dynamic-build-commands.md).
- Vercel, *Managing builds* (elastic concurrency,
  `WAIT_FOR_NAMESPACE_QUEUE` / `SKIP_NAMESPACE_QUEUE`) —
  [vercel.com/docs/builds/managing-builds](https://vercel.com/docs/builds/managing-builds);
  *Vercel for GitHub* (`#VERCEL_BUILD_MACHINE=TURBO`, `deploy --prebuilt --prod`).
- Vercel, *CLI deploy* (`--prebuilt`: "System Environment Variables are
  missing at build time with this flag").
- Vercel, *Deployment Checks* —
  [vercel.com/docs/deployment-checks](https://vercel.com/docs/deployment-checks),
  [changelog: block promotions with GitHub Actions](https://vercel.com/changelog/block-vercel-deployment-promotions-with-github-actions).
- Vercel changelog, [deployments now show billable duration and CPU minutes](https://vercel.com/changelog/deployments-now-show-billable-duration-and-cpu-minutes),
  [reduced pricing for Turbo build machines](https://vercel.com/changelog/reduced-pricing-for-turbo-build-machines).
- Supabase, *Branching → Integrations → Vercel* ("Supabase is always
  automatically re-deploying the most recent deployment of the given pull
  request") — supabase.com/docs/guides/deployment/branching/integrations.
- Next.js, [16.3 release: Turbopack persistent build cache](https://nextjs.org/blog/next-16-3-turbopack);
  [turbopackFileSystemCache config reference](https://nextjs.org/docs/beta/app/api-reference/config/next-config-js/turbopackFileSystemCache).
- GitHub, [how use of GitHub Actions is measured](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  (free for public repositories on standard runners);
  [2026 pricing changes](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/).

Secondary [S]:

- Build machine prices and Elastic's CPU-minute billing:
  [lucaberton.com, reduce Vercel build costs 2026](https://lucaberton.com/blog/reduce-vercel-build-costs-2026/),
  [Vercel community: Elastic build machines feedback](https://community.vercel.com/t/elastic-build-machines-feedback-thread/49515.md),
  [Vercel community: avoiding high build-minute costs](https://community.vercel.com/t/how-to-avoid-high-build-minute-costs-on-vercel-pro-plan/36958),
  [createwith: Basic build machines for Pro](https://www.createwith.com/tool/vercel/updates/vercel-brings-basic-build-machines-to-pro-and-enterprise-teams),
  [omidsaffari.com: Basic vs Elastic](https://omidsaffari.com/blog/cut-vercel-build-costs-basic-machines).
- `VERCEL_GIT_PREVIOUS_SHA` only set with an Ignored Build Step, and empty
  reports: [Vercel community thread](https://community.vercel.com/t/vercel-git-previous-sha-is-always-empty/39835);
  [vercel-ignore](https://github.com/lfades/vercel-ignore).

Measured [M]: Vercel API reads of project `prj_JvPzqiiIZlvSyolfaRaTrncoNZAW`
(deployments, two build logs, project filters), `git log` / `git diff` of
this repository, and GitHub's PR list. All reads only.
