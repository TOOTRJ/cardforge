# Easier manual testing on preview deployments (research, 2026-11-02)

The owner's standing rule for every merge is: screenshots of visual changes, a
summary of what changed, and a short manual-test list. Today, testing a
preview means passing Vercel's login wall, then signing in by hand as a seeded
`dev_*` account whose password lives only in a local `.env.local`. On a PR
that touches `supabase/`, the preview runs on its own branch database, where
the seeded accounts have random, unknowable passwords, so nobody can sign in
as them at all.

This document compares the ways to fix that, ranks them, and designs the top
two. **Nothing has been built.** Every design below is a proposal that needs
the owner's go-ahead.

**How the sources were read.** This session could not open `vercel.com` or
`supabase.com` directly: the network allow-list blocked them. Each claim is
tagged with where it came from:

- **[D]**: an excerpt from the official docs, read through Vercel's or
  Supabase's own documentation-search tool. The excerpts quote the page and
  name its URL.
- **[S]**: a search engine's snippet. The page itself was not opened.
- **[A]**: read from the owner's Vercel account through the API (read-only),
  on 2026-11-02.
- **[C]**: read from this repository at `main` (`8379ccc`).

Anything with no tag, or marked **verify**, is the author's inference. Check
it before relying on it.

---

## 0. TL;DR: the recommendation, ranked

| Rank | Option | Effort | Running cost | Risk once guarded |
|---|---|---|---|---|
| **1** | **One-click "Sign in as…" page on previews** (`/qa/sign-in`), plus a **preview ribbon** that shows which database and which account you are on | ~1 day + tests | $0 | Low. It is compiled only into preview builds and refuses production five independent ways (§3). |
| **2** | **Automatic before/after screenshots** posted as ONE sticky PR comment. Playwright runs against the preview and the `dev` alias, through Vercel's *Protection Bypass for Automation*, and signs in through option 1. | ~1–2 days | a few Actions minutes per ready PR (§4.6) | Low. The bypass secret lives only in GitHub secrets; the workflow runs `main`'s code, never the PR's. |
| 3 | Use what Vercel already gives you: Toolbar **comments** on previews (agents can read them through the Vercel MCP), and `vercel curl` | 0 | $0 | None |
| 4 | Argos (hosted visual review) instead of the do-it-yourself comment in rank 2 | ½ day | free up to 5,000 screenshots/month | A third party holds the screenshots |
| 5 | Vercel **shareable links**, for a *person outside the team only*, made by hand with a time limit | 0 | $0 | Medium if a link leaks (§2.3). **Never** post one in a PR: the repo is public. |
| ✗ | Turning Deployment Protection off for previews, Deployment Protection *Exceptions* for previews, a known seed password in the repo or in branch secrets, Storybook, Chromatic, Percy, Lost Pixel | — | — | Rejected (§6) |

Ranks 1 and 2 reinforce each other. Option 1 is what makes option 2 cheap,
because the screenshot job signs in the same way a human would. Once option 1
exists, Vercel Authentication on previews is what stops strangers from using
it, so it must stay on.

---

## 1. Where things stand today (verified)

| Fact | Source |
|---|---|
| Project `cardforge` uses Vercel Authentication with `deploymentType: "all_except_custom_domains"`, i.e. **Standard Protection**: every deployment URL is protected except production's custom domains (`www.pipglyph.com`, `pipglyph.com`). Password protection and Trusted IPs are off. | [A] `get_project`, 2026-11-02 |
| Standard Protection also protects production's own *generated* `*.vercel.app` URLs. | [D] vercel.com/docs/deployment-protection ("the production generated deployment URL becomes restricted") |
| The repository is **public**. `CLAUDE.md` describes CI minutes as billed because the repo is private; the GitHub search API reports `private: false`. **Owner, verify:** standard GitHub-hosted runners are free for public repositories, so the CI cost picture in `CLAUDE.md` / `tests/README.md` may be out of date. Either way, everything posted to a PR is world-readable. | [A] `search/repositories`, 2026-11-02 |
| Preview scope → the shared **dev** branch DB `znipzaxgpaiandwiqabn`. A PR touching `supabase/` gets branch-specific vars from the Supabase integration, which override the generic Preview ones. | [C] `docs/ENVIRONMENTS.md` §3 |
| Seed accounts `{admin,pro,free,artist,new}` at `dev.pipglyph.test`, with fixed UUIDs `d0000000-0000-4000-a000-00000000000{1..5}`, get a **random, unknowable** password in SQL. Only `npm run seed:dev` sets a real one, from the owner's local `DEV_SEED_PASSWORD`, and only on the database its env file names. | [C] `supabase/seeds/10_dev_data.sql`, `scripts/seed-dev.mjs` |
| So on a **per-PR branch DB** the seeded accounts exist but nobody can sign in as them. The only workarounds today are signing up a fresh account (email confirmation is off on branches) or running `seed:dev --env-file` with that branch's keys. | [C] `docs/ENVIRONMENTS.md` §1, §4 |
| Production guards already exist: `scripts/lib/prod-guard.mjs` (`isProductionSupabaseUrl`, `isProductionAppUrl`, the production refs and hosts), `scripts/check-dev-env.mjs`, and the seed SQL's "more than 25 real users → refuse" guard. | [C] |
| A build-time route lock already exists: `/dev/parity` is a `page.parity.tsx` file. Only a server started with `PARITY_HARNESS=1` adds that page extension (`parityHarnessEnabled`, `next.config.ts`), so no other build compiles it. `tests/unit/devops/parity-harness-route.test.ts` holds the lock. | [C] |
| `/preview` and `/create-guest` are redirected to `/create` by `proxy.ts`, so a new route must not be named `/preview`. | [C] `proxy.ts:37` |
| Email confirmation on previews already uses a server-side `verifyOtp({ type, token_hash })` in `confirmEmailLinkAction`, which sets the session cookies. | [C] `app/(auth)/actions.ts:405` |
| `/reset-password` accepts a session whose JWT `amr` records an **`otp`** method within the hour (`lib/auth/recovery-session.ts`). Supabase records a magic-link verification as `otp`: "`otp` - any one-time password based sign in (email code, SMS code, magic link)". | [C], [D] supabase.com/docs/guides/auth/auth-mfa (FAQ) |
| `*.vercel.app` is on the Public Suffix List, so each preview host is its own cookie site. A session made on one preview never reaches another. That is why each new preview needs its own sign-in, and also why previews are isolated from each other. | inference: well-known PSL entry, **verify** |

**What could not be read:** the team's Vercel **plan** (`get_team` returns no
plan field) and the project's env-var list (403 for this session's token).
Every Vercel feature this document relies on is documented as available on
**all** plans, so the plan does not change the recommendation (§2).

---

## 2. Vercel's own tools

### 2.1 Vercel Authentication (what is on now)

- Only signed-in members of the Vercel team pass. The first visit to each
  preview host bounces through vercel.com and sets a cookie for that host. If
  the browser is already signed in to vercel.com, there is no prompt, just a
  redirect.
- **Where the friction really is:** on a phone, or in a fresh or private
  browser, you must sign in to vercel.com first, once per browser. Fix that
  once per device; nothing needs building.
- **Keep it on.** After option 1 ships, it is the outer wall in front of
  "sign in as `dev_admin`".

### 2.2 Protection Bypass for Automation

- [D] "Protection Bypass for Automation is available on all plans" [S]. It
  generates a project secret that "can be used to bypass deployment
  protection on all deployments in a project until it is revoked". Vercel
  also exposes it to deployments as the system variable
  `VERCEL_AUTOMATION_BYPASS_SECRET`.
- [D] To use it, send the header `x-vercel-protection-bypass: <secret>`
  (strongly preferred). A query parameter works too, but "the secret appears
  in the URL, which may be logged by proxies, CDNs, and server access logs".
  Adding `x-vercel-set-bypass-cookie: true` sets a cookie, so in-browser
  navigation keeps working. Vercel's own Playwright example puts both headers
  in `use.extraHTTPHeaders`.
- [D] Manage it in Project → Settings → Deployment Protection, with
  `vercel project protection enable --protection-bypass`, or with
  `PATCH /v1/projects/{id}/protection-bypass`. A secret can carry a note and
  be revoked and regenerated.
- **Use it for:** the screenshot job (option 2) and any other CI job against
  a preview.
- **Never:** hand it to a human as a link, or put it in a PR, an issue, a
  commit or a doc. Because it opens every deployment in the project, it is
  as strong as a team login.

### 2.3 Shareable links

- [S] Shareable links are available on all plans: Hobby is limited to one
  link per account, Pro and Enterprise are "Included". [D] The API takes a
  `ttl` in seconds; without one, "the shareable link will never expire". A
  link can be revoked and regenerated. Anyone holding it gets into that
  deployment, and can comment there if comments are on.
- **Use it for:** a person who is not on the Vercel team, with a short
  `ttl`, sent privately.
- **Never post one on a PR.** The repo is public, so a shareable link in a PR
  comment opens the preview to the internet. Once option 1 exists, that also
  means anyone can sign in as `dev_admin` on the dev database. The screenshot
  workflow (§4) must never generate or post one.

### 2.4 Vercel Toolbar and Comments

- [S] Comments are "enabled by default on all preview deployments, for all
  account plans, free of charge". By default only team members can comment;
  on Pro/Enterprise external users can be invited. [D] Turn the toolbar off
  for one branch with the Preview env var `VERCEL_PREVIEW_FEEDBACK_ENABLED=0`.
- [D] The toolbar has a Share button, which makes a shareable link, so the
  §2.3 rule applies to it too.
- **Worth using more:** a comment left on a preview is a pinned, per-page
  note. The Vercel MCP can list and resolve these threads
  (`list_toolbar_threads`, `reply_to_toolbar_thread`), so a Claude session
  working on the PR can read "this button is misaligned" straight from the
  preview and answer on it. It costs nothing and is already on.

### 2.5 `vercel curl`

- [D] `vercel curl /path --deployment <url>` "automatically handles deployment
  protection". This is handy for a quick check of an API route on a preview
  from a terminal. It is not a browser session.

### 2.6 Protection Exceptions and Password Protection

- [S] Deployment Protection **Exceptions** make chosen domains public; the
  pricing table lists them as included on all plans. **Password Protection**
  is a paid extra on Pro: older docs say $150/month for "Advanced Deployment
  Protection", newer ones say $20 per project per month. The two sources
  disagree.
- **Rejected for previews.** An exception removes the wall that option 1
  needs. A password is one more shared secret, and a worse wall than a team
  login.

---

## 3. Option 1: one-click "Sign in as…" on previews

### 3.1 How the session is made

There are three ways to mint a session for a seeded account on the server:

| Way | How | Verdict |
|---|---|---|
| **A. Magic-link hash, verified on the server** | The service role calls `auth.admin.generateLink({ type: "magiclink", email })`, which creates the link without sending any email [D: "Generates an email link … without sending it"]. The route reads `properties.hashed_token` and calls `verifyOtp({ type: "email", token_hash })` on the cookie-bound server client, the same call `confirmEmailLinkAction` already makes. Session cookies are set; no password is touched. | **Recommended.** No password is needed anywhere, it works on per-PR branch DBs (whose seed passwords are random), and no auth redirect allow-list entry is needed (nothing is redirected through GoTrue). |
| B. Set a password, then sign in | The service role sets the account's password to a Preview-scoped secret (e.g. `DEV_SEED_PASSWORD` stored in Vercel's Preview env), then `signInWithPassword`. | Works, and its `amr` is `password` (see 3.4). But it puts a second copy of a password in Vercel, rewrites `auth.users` on every click, and silently changes the shared dev DB's password whenever the two copies drift, which breaks the owner's local sign-in. |
| C. Sign the owner's own JWT | Mint an access token with the project's JWT secret. | Rejected: it needs the JWT signing secret in the app, bypasses GoTrue's session table, and Supabase is moving to asymmetric keys. |

**Verify during implementation:** the exact `verifyOtp` type that accepts a
`magiclink` hash. The JS reference says the email types are `email`,
`recovery`, `invite` and `email_change`, with "`signup` and `magiclink`
deprecated" [S]. A unit test pins the call shape; a manual check on a preview
confirms it.

### 3.2 Who can reach it (threat model)

| Who | Can they reach `/qa/sign-in` on a preview? |
|---|---|
| A stranger with a preview URL (URLs are in public PRs and Vercel's bot comments) | **No.** Vercel Authentication answers first. |
| A member of the Vercel team | Yes. That is the point. |
| Someone holding a **shareable link** to that deployment | **Yes.** This is why shareable links are for named people only and never go in a PR (§2.3). |
| A CI job with the **automation bypass** secret | Yes. That is option 2. |
| Anyone, if Deployment Protection were turned off or an Exception added for previews | **Yes.** Guard 4 below refuses any host that is not one of the team's protected `*.vercel.app` names, and the ribbon says so. Still, **never turn protection off** (owner rule, §7). |
| Anyone on **production** | **No route exists** (guard 1), and four more independent refusals stand behind that (guards 2–5). |

**What an attacker would gain** if the wall fell: an admin session on a
**non-production** database holding only seed data. That includes the
`/admin/*` tools on that data, the Preview-scoped AI key (budget-capped,
`docs/ENVIRONMENTS.md` §3), dev storage uploads, and Stripe sandbox checkouts.
Previews cannot send email (Resend is production-only). The blast radius is
small, but not zero, hence defence in depth.

### 3.3 The five guards (any one alone refuses)

1. **Build time: the route does not exist outside a preview build.** Copy the
   parity harness's lock. Its files are named `page.qa.tsx` and
   `actions.qa.ts`, and `next.config.ts` adds the `qa.tsx` / `qa.ts` page
   extensions only when `previewQaEnabled(process.env)` is true:

   ```ts
   export function previewQaEnabled(env = process.env): boolean {
     return env.VERCEL_ENV === "preview" && env.PREVIEW_QA === "1";
   }
   ```

   A production build (`VERCEL_ENV=production`), a local `npm run dev`
   (`VERCEL_ENV` unset) and CI's builds never compile the page, so
   `/qa/sign-in` is an ordinary 404 there and the code is not in the bundle.
   [D] confirms that `VERCEL_ENV` is set at build time; it is missing only
   with `vercel --prebuilt`, which this project does not use.
   - `PREVIEW_QA` is a **Preview-scoped** env var in Vercel, never Production
     or Development, so turning the whole feature off is one switch.
2. **Runtime environment.** The page and the action each call ONE gate,
   `previewQaGate(request)` in `lib/preview-qa/gate.ts`, which first checks
   `VERCEL_ENV === "preview"` and `PREVIEW_QA === "1"` again at runtime.
3. **Database is not production.** The gate checks `isProductionSupabaseUrl(NEXT_PUBLIC_SUPABASE_URL)`
   from `scripts/lib/prod-guard.mjs`, the same function `check-dev-env` and
   `seed-dev` use. Import it, never restate it; a twin TS module may
   re-export it.
4. **Host is a protected preview host.** The host must not satisfy
   `isProductionAppUrl()`, and must end in `-orderoftheredjester.vercel.app`,
   the team's suffix, which Standard Protection always covers. This catches
   two edge cases:
   - a custom domain added to a preview branch (not protected under Standard);
   - a preview deployment promoted to production **without a rebuild**.
     [D] says the REST promote endpoint "does not rebuild the deployment".
     Such a deployment would still carry `VERCEL_ENV=preview` and the dev
     DB's URL, but it would answer on `www.pipglyph.com`.
5. **Account allow-list.** `as` must be one of the five keys, mapped to the
   five **fixed UUIDs**. The gate loads the user with
   `auth.admin.getUserById(uuid)` and goes on only if the email is exactly
   `<key>@dev.pipglyph.test`. Free-form emails are never accepted, so there
   is no enumeration and no way to name a real user.
   - Optional sixth check, the seed SQL's own: refuse if the database has
     more than 25 users outside `*.pipglyph.test`. Production fails this by
     a wide margin. It costs one `listUsers` page per sign-in; worth it.

**Audit log.** On success or refusal, write ONE structured line to Vercel's
runtime logs:
`[qa-sign-in] ok as=dev_pro db=<ref> host=<host> deploy=<VERCEL_DEPLOYMENT_ID>`,
or `refused reason=<guard>`. Do not log the token hash, the cookie or the IP;
a hashed user agent is enough. No database table is needed: that would mean a
migration plus grants for a preview-only feature, and Vercel's logs already
keep the record.

### 3.4 Side effects to handle

- **The recovery gate.** A session from route A carries `amr: otp`, so for
  one hour `/reset-password` would let that tester set a new password for
  `dev_admin`. On the shared dev DB, that breaks the owner's local sign-in
  until `npm run seed:dev` is run again. Fix: the password-reset action, and
  Settings' email and password change, refuse the five seed accounts by
  their fixed UUIDs, in every environment (they do not exist in production).
  The message: "Seed accounts keep their password — sign up a fresh account
  to test this flow." To test the reset flow itself, sign up a fresh account
  on the preview.
- **Mutable seed state.** Testing changes the accounts. `dev_new` gets
  onboarded once and stays onboarded on the shared DB, and `dev_free` spends
  its 5 credits. A follow-up could add a **"Reset this account"** button on
  `/qa/sign-in`: the service role puts back the seed's plan, credits and
  `onboarded_at` for that one UUID. It runs behind the same gate.
- **Signing in as one account replaces any current session** on that preview
  host. That is intended: it is how you switch accounts.

### 3.5 The UI

- **`/qa/sign-in`** shows five buttons, one per account, each with its role
  line from the seed table: "dev_pro — paid Pro, 200 credits". There is a
  `next` field, passed through `safeRedirectPath()` only. The page is
  `robots: noindex`.
- **One-click links:** `/qa/sign-in?as=pro&next=/create` pre-selects the
  account. A client effect submits the form once, "Signing you in as
  dev_pro…", so the user just clicks a link in the PR. A GET never mints
  anything; only the POST action does. A link prefetch does not run the
  effect.
  - Login CSRF (another site linking a team member into a dev session) is
    harmless here and is accepted.
- **The PR template change.** The "## Manual testing (preview)" section links
  each step straight in:
  `https://<preview>/qa/sign-in?as=pro&next=/deck/abc`. The preview URL is
  already public in PRs, and the wall is Vercel's.
- **The preview ribbon** (`components/layout/preview-ribbon.tsx`) is a client
  island mounted by the root layout only when
  `process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"`. [D] says that variable
  is available at build and runtime. Next inlines it at build time, so
  production's bundle drops the ribbon as dead code. The root layout still
  reads no cookies, as `CLAUDE.md` requires.

  The ribbon's text:
  **PREVIEW · PR #123 · DB: shared dev | PR branch `abcd…` · Signed in as dev_pro · Switch account · Test steps ↗**

  | Ribbon part | Where it comes from |
  |---|---|
  | DB name | The host of `NEXT_PUBLIC_SUPABASE_URL`, compared with the dev ref (the same constant `supabase/config.toml` holds). Any other ref reads "PR branch". |
  | Account | `/api/me`, fetched on the client in preview builds only. |
  | PR link | `NEXT_PUBLIC_VERCEL_GIT_PULL_REQUEST_ID` (**verify** that the framework-prefixed twin exists; otherwise inline `VERCEL_GIT_PULL_REQUEST_ID` through `next.config.ts` `env`), linked to `https://github.com/TOOTRJ/cardforge/pull/<id>`. |
  | Test steps | Links to that PR. |

  The ribbon must stay out of the screenshots in option 2 (it is masked
  there) and out of the parity harness, which runs without the `VERCEL_*`
  variables and so never mounts it.

### 3.6 Per-PR branch databases: does it work there?

Yes. The branch DB runs `supabase/seed.sql` and `supabase/seeds/*.sql` when
it is created [D: "Seed - Runs seed files to populate your branch"]. The five
accounts exist with their fixed UUIDs, and route A needs no password.

The one dependency is the branch's **`SUPABASE_SECRET_KEY`** in the
branch-scoped Vercel vars. **Owner, verify** on the next `supabase/` PR with
`vercel env ls preview <branch>`. It may only write a legacy
`SUPABASE_SERVICE_ROLE_KEY`, which `lib/supabase/admin.ts` ignores. If so,
uploads and bakes already fail on those previews, and `/qa/sign-in` says
"this preview has no service key — sign up a fresh account instead" rather
than failing silently.

### 3.7 Tests

| Test | Holds |
|---|---|
| `tests/unit/devops/preview-qa-route.test.ts`, modelled on `parity-harness-route.test.ts` | `previewQaEnabled()`'s truth table: production, development, unset, `PREVIEW_QA≠1` → false. The `qa.*` files exist only under `app/qa/`. No `page.tsx` or `route.ts` twin exists there. `next.config.ts` adds the extensions only through `previewQaEnabled`. |
| `tests/unit/auth/preview-qa-gate.test.ts` | Every guard refuses on its own: a production Supabase URL (by host, by the ref inside a pooler URL, and `auth.pipglyph.com`), a production app host, a non-team `vercel.app` host, a custom domain, an unknown `as`, a UUID whose email doesn't match, `VERCEL_ENV=production`, `PREVIEW_QA` missing. The happy path calls `generateLink` then `verifyOtp` with the expected shapes (Supabase mocked at the module boundary, as the billing tests do). |
| A build check in CI's existing build job, in the draft tier with no extra build | After `next build` (no `VERCEL_ENV`), `.next/server/app/qa` must not exist. It fails loudly if a refactor ever compiles the page into a non-preview build. |
| Seed-account guard tests | The reset-password, email-change and password-change actions refuse the five UUIDs. |
| Manual, once on a preview | Each account signs in. `next` goes where asked. A per-PR branch preview works. `/qa/sign-in` on a production deployment URL is a 404. |

---

## 4. Option 2: automatic before/after screenshots on the PR

### 4.1 Goal

When a ready PR's preview finishes deploying, post ONE sticky comment that
shows the pages the change touches, **before** and **after**, at desktop and
phone width, signed in as the right account. The comment is updated on every
new deploy, not appended. Together with the PR body's summary and
"Manual testing (preview)" section, that covers the owner's rule.

### 4.2 The trick: what "before" is

Comparing against production is meaningless, because production's data is
not the preview's. The **`dev` alias**
(`cardforge-git-dev-orderoftheredjester.vercel.app`, [C] §3) is a much better
baseline:

- It runs `main`'s code. `sync-dev.yml` fast-forwards `dev` after each merge.
- It runs on the **same shared dev database** as every preview of a PR that
  does not touch `supabase/`. Same seed data, same accounts, same cards, so a
  pixel difference is the PR's code, not data drift.
- For a `supabase/` PR, the branch DB is built from the same seed files.
  Close, but timestamps and anything created since differ. Mask those, and
  flag the comment "branch DB — data may differ".
- Caveat: the alias lags `main` for the few minutes `sync-dev` takes. The
  comment names the `dev` SHA it compared against.

### 4.3 The workflow (`.github/workflows/preview-shots.yml`)

- **Trigger.** Use `repository_dispatch` with type
  `vercel.deployment.success`, which Vercel's docs now show in place of
  `deployment_status` [D]. The preview URL is in `client_payload.url`, and
  the workflow file must exist on the default branch.
  - **Verify** whether the project needs this event turned on in its Git
    settings. Falling back to `on: deployment_status` with
    `state == 'success'` works today [D].
- **Find the PR.** Look up the PR for the deployed SHA
  (`GET /repos/{o}/{r}/commits/{sha}/pulls`). Skip drafts, so the owner's
  review stage is where minutes are spent. Also run when the `screenshots`
  label is added to a draft.
- **Trust boundary.** The job checks out **`main`**, never the PR head. It
  tests a URL, so it has no need for the PR's code, and running PR-authored
  code next to the bypass secret is exactly what must not happen.
  - Never use `pull_request_target`.
  - Fork PRs don't deploy (Vercel's Git fork protection); **verify** that it
    is on.
- **What to shoot.** There are two inputs:
  - a fixed list in `tests/preview-shots/pages.ts`: a dozen key surfaces ×
    the account that sees them (`/`, `/gallery`, `/create` as free and as
    pro, a deck page, a card page, `/dashboard`, `/pricing` as free);
  - optional lines from the PR body, in a fenced block the PR author (often
    a Claude session) fills in:

    ````md
    ```preview-shots
    pro /deck/dev-pro-deck
    free /create?kind=token
    ```
    ````

    These are **data, not code**. Each line is `<account> <path>`. The
    account must be one of the five keys, the path must pass the same
    `safeRedirectPath` rules, and there are at most 12 lines. Anything else
    is dropped and said in the comment.
- **How to shoot.** Use Playwright Chromium (already cached in CI) with
  `extraHTTPHeaders` = the bypass header plus `x-vercel-set-bypass-cookie:
  true` [D]. For each (account, path):
  1. Visit `/qa/sign-in?as=<account>&next=<path>` on both hosts.
  2. Wait for fonts and network idle.
  3. Take a full-page shot at 1280×800 and at 390×844.
  4. Settings: `animations: "disabled"`, `caret: "hide"`; mask the ribbon
     and the dates.
- **Diff.** Use `pixelmatch` (or Playwright's own comparer) between before
  and after. Pages with **no** difference are listed in one line ("12 pages
  unchanged"). Only changed pages get images, side by side, with the diff
  overlay in a collapsed `<details>`.
- **Where images live.** GitHub's API cannot attach images to comments.
  Recommended: commit the PNGs to an orphan, machine-owned branch
  `preview-shots`, under `pr-<n>/<sha>/…`, and embed
  `https://raw.githubusercontent.com/TOOTRJ/cardforge/preview-shots/…`.
  - This works because the repo is public; the images show only seed data.
  - A weekly cleanup deletes the folders of closed PRs.
  - Like `dev`, nobody commits to it by hand.
  - The alternative is Argos (§4.5).
- **The comment** is found by a marker, `<!-- preview-shots -->`, and edited
  in place. It ends with the attribution footer `CLAUDE.md` requires for
  posts. Its top line links each changed page as a one-click sign-in link
  (§3.5).
- **Permissions:** `contents: write` (only for the `preview-shots` branch;
  the `main` ruleset already blocks direct pushes to `main`) and
  `pull-requests: write`.

### 4.4 Secrets and what must never leak

- `VERCEL_AUTOMATION_BYPASS_SECRET` is a **GitHub Actions secret**. The job
  sends it only as a header, never as a query parameter: query strings land
  in logs [D].
- The comment shows images and URLs **without** any bypass token or
  shareable link.
- Screenshots never include a page that shows a key. None exist today; the
  rule stands for the future.
- No seed password is involved anywhere. Sign-in is option 1's.

### 4.5 Do it ourselves, or a hosted service?

| | Cost | Fit |
|---|---|---|
| **Do it ourselves (above)** | Actions minutes only | Images inline in the PR, which is where the owner reviews. No third party. ~1–2 days to build. |
| **Argos** | [S] Hobby plan free "forever for individual developers" with 5,000 screenshots/month and no extra screenshots; Pro from $100/month for 35,000 | A good review UI with a GitHub check, but images are on argos-ci.com rather than inline, and it adds a dependency. Rough volume: 30 PRs × 15 pages × 2 widths ≈ 900/month, well inside the free plan. **Second choice**, or the upgrade path if the do-it-ourselves diffing becomes a chore. |
| **Percy** (BrowserStack) | [S] 5,000 screenshots/month free, counted per browser × width | Same shape as Argos, heavier SDK. |
| **Chromatic** | [S] 5,000 snapshots/month free, paused when exhausted | Storybook-first. PipGlyph has no Storybook (§5). |
| **Lost Pixel** | [S] reportedly being sunset after its team joined Figma (April 2026). **Unverified**; one source only. | Don't adopt. |

### 4.6 Cost

Per run: about 1 minute to set up (cached `node_modules` and Chromium), plus
roughly 2–4 minutes of shooting (2 hosts × ~15 pages × 2 widths), plus a few
seconds to diff and post. Call it **4–6 runner-minutes per ready-PR deploy**.

- On a **public** repo, standard runners cost nothing.
- If the minutes are billed (see the §1 visibility note), it is a few cents
  a run at GitHub's Linux per-minute rate, much less than one full-tier CI
  run (~61 minutes, `tests/README.md`).
- Vercel side: a few hundred page and function hits on a preview, which is
  negligible.

---

## 5. Other common options considered

| Option | Verdict |
|---|---|
| **Seed a known password on every branch** (Supabase branch secrets or the vault, read by a seed) | [D] "Secrets are branch-specific … not automatically available in other branches", so every new PR branch would need the secret set by hand, and seeds are plain SQL. Route A (§3.1) needs no password at all. **Rejected.** |
| **Keep `DEV_SEED_PASSWORD` in 1Password** (or another password manager) | Fine as the *human fallback* for the shared dev DB. It doesn't help on branch DBs. Keep it, with no change needed. |
| **Vercel Flags / Flags Explorer** to switch accounts or features | Overkill: PipGlyph has no feature flags today, and account switching is option 1. Revisit if flags arrive. |
| **Storybook** | Most of what changes visually depends on data (the creator, deck pages, card renders), and the parity harness already pins the card renderer (`tests/parity/`). Big setup and upkeep for little review value. **Rejected for now.** |
| **Recorded walkthroughs** (Playwright video or trace of the manual-test steps, attached to the PR) | A cheap add-on to option 2 later. A trace can be opened at trace.playwright.dev without installing anything. Not first. |
| **Toolbar comments, read by agents** (§2.4) | Already on and free. Worth a line in the PR template: "leave comments on the preview — the Claude session reads them". |
| **One sign-in for every preview** (a shared cookie domain) | Impossible by design: `vercel.app` is a public suffix. Option 1's one-click link is the substitute. |
| **A QR code in the ribbon** to open the same page on a phone | A nice touch, but the phone still needs a vercel.com sign-in (§2.1). Optional. |

---

## 6. What NOT to do (and why)

- **Don't turn Deployment Protection off** for previews, and don't add a
  Protection Exception for previews or the `dev` alias. After option 1, that
  wall is what keeps `dev_admin` private.
- **Don't post a shareable link, a bypass secret or a `?x-vercel-protection-bypass=`
  URL** in a PR, issue, commit, comment or doc. The repo is public.
- **Don't put any password in the repo**, in `supabase/config.toml`, in a
  seed, or in a fixture (`CLAUDE.md`: no credentials, "not even test
  passwords").
- **Don't let the sign-in route take an email address.** It takes a key
  that maps to a fixed UUID, and nothing else.
- **Don't run the PR's code in the screenshot job** (no `pull_request_target`,
  no checkout of the head).
- **Don't weaken `prod-guard.mjs`.** Import it.
- **Don't use `--with-data` branching** to get realistic screenshots (an
  existing rule).

---

## 7. Owner steps

### For option 1 (sign-in page + ribbon)

1. **Vercel → Project → Settings → Environment Variables:** add `PREVIEW_QA`
   = `1` scoped to **Preview only**. Untick Production and Development. If a
   multi-scope record appears, split it the way `docs/ENVIRONMENTS.md` §3
   warns.
2. **Vercel → Settings → Deployment Protection:** leave Vercel
   Authentication on **Standard Protection** (it is, [A]). Add no
   Exceptions. Assign no custom domain to a preview branch.
3. On the next PR that touches `supabase/`, run
   `vercel env ls preview <branch>`. Confirm `SUPABASE_SECRET_KEY` (not only
   `SUPABASE_SERVICE_ROLE_KEY`) is among the branch-scoped vars (§3.6).
4. **Each phone or new browser you test from:** sign in to vercel.com once.
5. **Turning it off:** delete `PREVIEW_QA` and redeploy. The route
   disappears from the next build.

### For option 2 (screenshots)

1. **Vercel → Settings → Deployment Protection → Protection Bypass for
   Automation → Generate.** Add the note "preview screenshots (GitHub
   Actions)".
2. **GitHub → Settings → Secrets and variables → Actions:** add
   `VERCEL_AUTOMATION_BYPASS_SECRET` with that value.
3. **Vercel → Settings → Git:** check that the `repository_dispatch` events
   are sent (**verify** whether this is a setting). Check that Git fork
   protection is on.
4. **GitHub → Settings → Actions → General:** workflow permissions allow
   `contents: write` for the workflow's own token, as `sync-dev.yml` already
   needs. The `main` ruleset needs no change, since the job writes only to
   `preview-shots`.
5. **Rotation:** if the secret ever leaks, revoke and regenerate it in Vercel
   (it works on every deployment until revoked [D]) and update the GitHub
   secret.

### For Argos (only if chosen instead of §4.3's do-it-ourselves version)

Install the Argos GitHub App on `TOOTRJ/cardforge`, add `ARGOS_TOKEN` as an
Actions secret, and confirm the Hobby plan's terms fit a team project [S].

---

## 8. Proposed build order (each its own PR, owner sign-off between)

1. `feat(qa): one-click sign-in as a seed account on previews`.
   - Contents: §3 (gate, page, action, audit line, seed-account password
     guard, tests). No ribbon yet.
   - Its "Manual testing (preview)" section *is* the feature: click
     `/qa/sign-in?as=pro`.
   - Its first preview only works after the owner adds `PREVIEW_QA` (step 1)
     and redeploys.
2. `feat(qa): preview ribbon — database, account, PR`. §3.5's ribbon.
3. `ci: before/after preview screenshots on ready PRs`. §4, after the owner
   adds the bypass secret.
4. Follow-ups:
   - "Reset this account" (§3.4);
   - a PR-template line linking `/qa/sign-in?as=…`;
   - an optional Playwright trace of the manual-test steps.

---

## Sources

**Vercel** (through the Vercel documentation-search tool, [D], unless marked):

- Protection Bypass for Automation, deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation. Header and query names, `x-vercel-set-bypass-cookie`, "available on all plans" ([S], also the docs.vercel.com mirror).
- Automated agent access, deployment-protection/automated-agent-access. The Playwright `extraHTTPHeaders` example and the warning that query strings are logged.
- REST `PATCH /v1/projects/{id}/protection-bypass` and `PATCH /aliases/{id}/protection-bypass` (shareable link `ttl`, revoke and regenerate).
- Deployment Protection overview: Standard Protection restricts the production generated URL.
- Vercel Authentication `deploymentType` values; `vercel project protection` CLI.
- Shareable links on all plans, Hobby limited to one link ([S] vercel.com/docs/deployment-protection/usage-and-pricing, …/sharable-links).
- Comments on all plans, on by default for previews ([S] vercel.com/docs/comments/how-comments-work); `VERCEL_PREVIEW_FEEDBACK_ENABLED` (vercel-toolbar/managing-toolbar).
- Password Protection and Advanced Deployment Protection pricing, conflicting ([S] vercel.com/docs/deployment-protection/usage-and-pricing, vercel.com/docs/plans/pro-plan, community.vercel.com thread 42415).
- `repository_dispatch` with `vercel.deployment.success` and the migration from `deployment_status` (git/vercel-for-github); `vercel/repository-dispatch/actions/status` (deployment-checks).
- `NEXT_PUBLIC_VERCEL_ENV` at build and runtime (environment-variables/framework-environment-variables); system variables missing with `--prebuilt` (cli/deploy).
- The promote API "does not rebuild the deployment" (rest-api/projects/point-production-traffic-to-a-given-deployment); `vercel promote` of a preview asks for confirmation (cli/promote).
- `vercel curl` handles protection (cli/curl).

**Supabase** (through the Supabase documentation-search tool, [D]):

- Branching (guides/deployment/branching): seeds run on branch creation, branches are data-less.
- Branching configuration (…/branching/configuration): `[remotes]`, and "Secrets are branch-specific".
- GitHub integration (…/branching/github-integration): seeding, no production data.
- JWT claims reference (guides/auth/jwt-fields): the `amr` method values.
- MFA FAQ (guides/auth/auth-mfa): "`otp` — … magic link".
- `auth.admin.generateLink` ("without sending it"; reference/swift, reference/csharp).
- `verifyOtp` types ([S] reference/javascript/auth-verifyotp).

**Screenshot services** ([S]):

- argos-ci.com/pricing and argos-ci.com/docs/learn/billing-and-subscription/subscription/pricing-plans: Hobby 5,000 per month, Pro from $100.
- browserstack.com/docs/percy/overview/plans-and-billing: 5,000 per month.
- chromatic.com/docs/billing: 5,000 per month, paused when exhausted.
- 21st.dev/blog/lost-pixel-alternatives: Lost Pixel sunset, unverified.
- Community write-ups of the Playwright + Vercel preview pattern: focusreactive.com/playwright-testing-on-ci-using-github-actions-and-vercel; shipyard.build/blog/visual-diffs-with-claude-playwright-github-actions (images committed to a screenshots branch).

**Owner's account** ([A], 2026-11-02): `get_project cardforge` (`ssoProtection`, domains); `get_team` (no plan field); GitHub `search/repositories` (`private: false`).

**This repo** ([C]): `CLAUDE.md`, `docs/ENVIRONMENTS.md`, `docs/BILLING.md`,
`scripts/lib/prod-guard.mjs`, `scripts/seed-dev.mjs`,
`supabase/seeds/10_dev_data.sql`, `next.config.ts` (`parityHarnessEnabled`),
`app/dev/parity/page.parity.tsx`, `app/(auth)/actions.ts`
(`confirmEmailLinkAction`), `lib/auth/recovery-session.ts`,
`lib/supabase/admin.ts`, `lib/site-url.ts`, `proxy.ts`, `tests/README.md`.
