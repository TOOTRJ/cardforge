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
  An owner-run script reads production's key ONLY through `promptHidden()`
  (`scripts/lib/hidden-prompt.mjs`) — a `_writeToOutput` filter echoed it.
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
  Minutes are BILLED (private repo) and CI runs in TIERS
  (`scripts/lib/ci-docs-only.mjs`, `tests/README.md` "Tiers"): open a PR as
  a DRAFT while iterating (typecheck + lint + build + the notes tests,
  ~7 min) and `gh pr ready <n>` when it needs the FULL run (~67 min; that
  starts it on the same commit — `--undo` goes back). A NOTES-ONLY change
  (every file on the allow-list: root `*.md`, `docs/**/*.md`,
  `.claude/**/*.md`, the two tests READMEs — never `.mdx`, `supabase/**`,
  `.github/**`) runs `npm run test:docs` alone; a unit test that starts to
  read a Markdown file joins that script
  (`tests/unit/devops/ci-docs-only.test.ts` fails until it does). A new job
  goes behind the `changes` condition, never behind a workflow-level
  `paths-ignore`; a draft's gate is named "Draft checks" on purpose.
  PR unit shards run WITHOUT coverage (owner 2026-10-16): the floors are
  held on `main`'s full runs and the nightly schedule, and a red
  `Unit coverage` there fails `main`'s run and opens ONE issue ("CI: unit
  coverage is red on main") — run `npm run test:coverage` yourself when a
  change touches a floored area. A merge whose tree is its PR head's AND
  whose head has a green FULL PR run (`scripts/lib/ci-runs.mjs`, read-only
  token) is the `verified` tier on `main`: only the cache warm-up (the frame
  and npm caches PRs restore from `main`) and Frames published; any doubt
  is the full run. A renamed full-tier job is renamed in `FULL_RUN_JOBS` too.

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
- Strong language (owner policy 2026-10-28): violence and mild words
  ("damn", "hell") are fine; a card whose TEXT holds strong profanity or a
  slur is saved PRIVATE, never refused, and its maker is told why. ONE
  detector, `lib/moderation/profanity.ts` (`containsProfanity`,
  `profaneFields` over every text field of both faces, rows, tags and the
  stats / collector line; per-word (plus prefix stems no English word
  starts with), so "Cockatrice" / "Scunthorpe" pass; a match needs a real
  letter, so "600k" does not; the list ROT13'd — the repo is public) and
  ONE rule, `languageForcesPrivate`, applied in BOTH
  card actions on the row as written (every save path: creator, AI jobs,
  deck remix, imports) with a typed `forcedPrivate` notice, in My Cards'
  bulk publish (left as it was, `skippedLanguage`) and by the creator
  (`lib/creator/strong-language.ts`: the Publish step's one polite note,
  Public / Unlisted aria-disabled, the save sends private, one toast). An
  edit of a card already in view is left alone only while every flagged
  field's text is UNCHANGED (its normalised words) and it widens nothing
  (no retroactive change); a forced edit leaves view through the existing
  private path (purge + private bake), never a second hide. A public deck
  shows such a card's entry as "Private card" to everyone but its owner
  (`lib/decks/private-card-name.ts`), and so does the API (0152): a
  HIDDEN entry — no printing, and a linked card the deck doesn't show a
  visitor, or a card-brought entry whose card was deleted
  (`deck_entry_hidden`, `isPrivateForViewer`) — is the deck OWNER's row
  alone (`deck_cards` read policy); a surface that LISTS a deck's rows for
  anyone reads them through `deck_entries_for_viewer` (`readDeckItems`:
  masked, "Private card") — the table hands a visitor none of them. A
  hidden entry adds nothing to the default cover's colours for ANY viewer,
  owner included (`lib/decks/cover.ts`), so the tiles and the share image
  (which read the table) and the page draw one cover for everyone. The
  database trigger is TODO 7.17.
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
- Uploads: every server action that stores a user's file passes it through
  `prepareUploadBytes()` (`lib/media/upload-bytes.ts`) — upright
  (`lib/media/orientation.ts`, TODO 3.14) and with no camera metadata
  (`lib/media/strip-metadata.ts`, TODO 3.14a: EXIF/GPS, XMP, IPTC, text
  chunks… dropped at the container level, pixels + ICC kept byte-exact). A
  new upload path does the same; a client-side strip never counts. It also
  calls `checkUploadRateLimit()` first (30 per 60 s, 300 per 24 h, sliding;
  admins exempt; fail-closed), and a picture URL column only takes the
  caller's own storage objects (0127 `media_url_allowed`; a remix copies its
  parent's) on an origin in `storage_origins` — production's in the
  migration, every other database's own registered by the app
  (`lib/media/storage-origin.ts`; never list another host or a wildcard) —
  draw one only through `isAllowedMediaUrl()` / `profileMediaSrc()`
  (`lib/media/media-urls.ts`).
- Viewer-independent server reads use `createPublicClient()` (cookie-free,
  keeps routes ISR-eligible); cookie-bound reads via `createClient()` make
  a route dynamic. `lib/supabase/admin.ts` bypasses RLS — webhook/cron,
  credit grants/refunds, protected billing columns, is_admin-gated tooling,
  storage writes into the caller's own folder via
  `lib/media/user-storage.ts` (users have no storage write policy since
  0126; card renders through `lib/cards/bake-core.ts`, which takes an
  owner + card ids, never a path), and a card's render pointer
  (`cards_guard_render_columns`, 0126: an API role may only CLEAR
  `rendered_*` / `layout_version`; draw one only if `isStoredRenderUrl()`)
  only; every non-cron caller checks auth itself.
- Watermark policy (layout v20): every DISPLAY surface — stored bake,
  gallery tile, OG image, live preview — carries the pipglyph.com mark and
  no custom footer text, whatever the owner's plan. Only a paid VIEWER's
  download renders clean (`downloadBrandMark`); never make display
  viewer-dependent (the stored PNG is one public URL).
- Card preview and the server Satori bake must stay pixel-identical: the
  `.ttf`/PNG masters in `public/` feed the bake — browser-side asset
  optimizations must not touch what the bake reads. CI's **Preview parity**
  check holds them together (`npm run test:parity`, `tests/parity/`,
  `tests/README.md`): a change to ONE renderer that moves a region 2 px
  fails it — fix the renderer; re-record `tests/parity/baseline/` (one file
  per case per platform, `tests/parity/README.md`; `--update` rewrites only
  the cases that moved) only
  when both were changed on purpose, never raise a limit, and give a new
  rendering feature of both renderers a case in `tests/parity/cases.ts`.
  Frames listed in `lib/frames/frame-manifest.json` live in the `frames`
  storage bucket, not git (content-addressed; `frameUrl()` resolves every
  preview + bake path; publish → preview → owner `frames:promote` → merge,
  `docs/FRAMES.md`, which also holds "Adding a frame" and the verification
  SOP) — Card Conjurer-derived frames NEVER enter the repo.
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
  compare page does it right after a save (`/api/admin/rebake-marked`).
  WHICH rollout (owner rule 2026-09-29): an ADDITION or new look (crown,
  two-colour frame, full-art token design, Nyx, collector line, vehicle
  plate, colour indicator, new frames) is OPT-IN PER CARD — new cards get it
  by default with an off switch, existing cards keep their look until the
  owner switches it on, imports follow the printing; it is card data
  (`frame_style`), never a sweep of stored cards, and never badges. A
  CORRECTION of a look that is wrong against its own print is a "sweep",
  after the owner's before/after sign-off. Flag borderline cases
  (`docs/FRAMES.md` "Additions vs corrections"). Every bake also writes a
  600 px WebP thumbnail beside the HD PNG (`cards.rendered_thumb_url`,
  `lib/cards/render-thumb.ts`) — gallery-style tiles MUST use
  `BakedCardThumbnail` with `renderedThumbUrl`, never the 3 MB PNG;
  `scripts/backfill-render-thumbs.mjs` fills thumbs for older bakes.
  Taking a card out of public view (private, moderation hide — ONE function,
  `lib/moderation/hide-card.ts` — delete, account deletion) removes its
  render objects and THEN purges tag `card-<id>` (`purgeHiddenCard(s)` /
  `purgeCardCdnCache`: delete, never invalidate): the tag is on the share
  image AND the one-year immutable `/render-cdn` bake, which serves only a
  bake's names, and on a CDN miss only while the card is public or
  unlisted under that owner (one read before storage: Supabase's CDN keeps
  a removed object up to 60 s, which could refill ours after the purge).
  A card's render names are FOUR (5.0a, migration 0134): the front's
  `{id}.png` + `.thumb.webp` and the back face's `{id}.back.png` +
  `.back.thumb.webp` — `renderObjectNames` (`lib/cards/bake-core.ts`) is the
  ONE list every reader derives from (`isStoredRenderUrl`, `/render-cdn`,
  `removeRenderObjects`, the hide, the orphan sweep's `renderCardId`), the
  0126 guard lists all six render columns — the FIVE pointers of
  `CLEARED_RENDER_POINTERS` (what every out-of-view path clears) plus
  `layout_version` (cleared by the bake paths only) — and
  `lib/cards/faces.ts` is the one source of a double-faced card's cross-face
  data (`frontPreviewData` / `backPreviewData`; derived at render, never
  stored — a body-less `back_face` draws on the front's frame as today).
  The transform bodies (5.1a: `m15dfcfront`, `m15dfcback`, `m15dfcbackleft`
  and the land pair) draw their icon rider, reverse P/T and colour dot from
  that `dfc` block — never from the `dfcIcon` switch (off for an absent
  key, which reads as `arrows`); a BACK body is never a card's own template
  (`templateRefusesKind`), and nothing on them is offered until each colour
  of the front AND the default back is ticked (after 5.3). A double-sided
  TOKEN (5.5 (c), owner Round 76) is no DFC body: two tokens back to back,
  its back another TOKEN template in the front's design (arch with arch,
  full-art with full-art) derived from the back's own words and text —
  a dress or height only where verified in its colour, as a new token's
  front (`tokenBackBodyFor`, `lib/creator/token-back.ts`; the vocabulary
  `lib/cards/token-faces.ts`) — through the same gate. The modal bodies
  (5.1b: `m15mdfcfront`, `m15mdfcback` and the land pair) draw the flipside
  strip's two TEXTS from that same block (`FrameProfile.flipside`,
  `lib/cards/flipside-strip.ts`: the other face's LAST type word + its cost
  or mana line, white on a front, dark on a back) — the housing, the ◀ and
  the strip are in the masters, painted in the master's OWN colour, and
  since 5.1c a two-colour card's strip takes the OTHER face's colour as
  the prints do, through the `mdfcStrip` overlay (`<template>/strip/<key>`:
  the masters' own tabs cut through CC's Flipside mask, keyed by
  `dfc.otherFace.stripKey` — `lib/cards/faces.ts` `stripKeyOf`: a letter,
  gold `m` for a two-colour spell, the land grey `l` for a two-colour land
  or a hybrid-dressed front — and drawn only when it differs from the
  master's own: a mono-colour card's bake is the master's bytes; never a
  master "fix"); the painted strip is a rules keep-out
  (`FlipsideSlots.keepOut` → `DrawnStats.strip`), and the transform
  front's reverse P/T digits are a rules FLOAT (`DrawnStats.reversePt` →
  `RulesLayoutInput.floats`, `endAlignedStatKeepOut`): the lines whose
  rows meet them break short of them, never a plain keep-out (the digits
  sit too far up the box for a size step to clear). Since 5.1d every DFC body
  with a printed legendary face declares the crown — `m15dfccrown` /
  `m15dfccrownright` / `m15mdfccrown`, the m15crown band CUT round the
  well or housing through CC's twin's alpha (never the twin's older flat
  art) — and the five spell faces the split pair masters (the prints split
  a BACK's rings and box over its gold bars too: MOM #43, MID #246), the
  modal front the hybrid dress as well; opt-in per card like m15's, the
  rider drawn after the crown; the land pair and the ▼ land back draw
  neither (no print). The DARK borderless bodies (5.7:
  `m15borderlessdfcfront` / `…dfcback` / `…mdfcfront` / `…mdfcback`) are
  PipGlyph's own masters (`scripts/build-dfc-borderless-frames.mjs`:
  m15borderless's with Card Conjurer's light DFC pieces grafted, moved onto
  print); `bodyFor`'s `look` makes a borderless front's back borderless
  (spell faces, the arrows only — a face with no borderless body is refused,
  never drawn on the other look), and an `inverted` borderless import lands
  there only once BOTH combos are verified, the bordered bodies until then. A back face's
  body and colour pass ONE gate on every save (5.2, `lib/cards/dfc-gate.ts`
  `resolveDfcBackFace`: the body is `bodyFor(layout, "back", type, family)`
  — the STORED one wins on an edit, re-derived only by `frame_anatomy.dfcIcon`,
  and so does the stored COLOUR (owner 2026-10-05: locked like the front's;
  a changed `back_face.color_identity` is refused, `DFC_BACK_COLOR_SET`, no
  preview skip) — verified per colour, `c` only with an Artifact word, a
  transform back with no cost; a public DFC needs both arts), and the FRONT its own
  (`dfcFrontTypeError`: a wave-1 face type on the body its type derives —
  the kind gate can't see it, a card on a front body IS the kind —
  `dfcFrontColorError`: `c` only with an Artifact word); the retired
  `back_card_id` is accepted only to CLEAR (its removal is 5.0c, after
  5.4); the 8 imported DFCs move onto the bodies only by their owner's
  click (`adoptDfcBodiesAction`, `lib/cards/dfc-adopt.ts`; onto the ONE
  layout the back's shape derives — a costed back is a modal card, onto
  the modal pair (5.1b) and never Transform; a cost-less LAND back is
  transform only with the printed sign of one, "(Transforms from …)" or
  "transform" on either face, else modal — `cards.layout` is never written
  before 5.4; a TRANSFORM land back goes colourless — that pair is verified
  on `c` alone — while the modal land back keeps the front's colour, one
  tint per colour).
  In the creator a Transform / Modal card has ONE Front face | Back face
  switch above every step (Face tabs, 5.14 part 1: `face-switch.tsx`, words
  from `SECOND_PART_WORDS`; a battle's back is optional, 5.5 (a); a saga is
  two-faced on the double-faced saga front `sagadfcfront`, 5.5 (b) — the
  Saga kind's own frame, `DfcProfile.saga`, picked on the Card step's Faces
  row, its back required; `dfcLayoutForCard` is the one "is this card
  double-faced" for a kind with a two-faced frame; a transform BACK that is
  an enchantment Saga — MOM's praetors, LCI #189 — wears `sagadfcback`, 5.5
  (b) PR 2, where it is published in the back's colour, else the ▼ back:
  `backBodyFor` in `lib/cards/dfc.ts` is the answer the gate, the creator
  and the import share) —
  the tab is the one source of "which face": each back field sits on the
  step of its front twin (`panels/back-face-panels.tsx`, `BACK_FIELD_STEP`
  in `lib/creator/face-tabs.ts`; the same `back_face.*` paths), the preview
  shows that face large with the other small and never turns by itself.
  A "still needed" link or a server error on a back field selects its tab
  as well as its step; one-faced cards render no switch.
  The four two-part kinds that are ONE picture — split, aftermath,
  adventure, flip — have the same switch in their own words (5.14 part 2,
  "Left half | Right half"): the second part's fields per step in
  `panels/second-part-panels.tsx` (`PART_FIELD_STEP`: its card type is on
  Identity, editable on an edit — it picks no frame; all nine type chips
  stay), a field the card NEVER DRAWS for the part HIDDEN WHILE EMPTY and
  shown whenever it holds a value (owner round 52, 2026-10-13;
  `lib/creator/second-part-fields.ts` reads "never drawn" from the profile
  — loyalty, defense, flavour and the artist credit on every second part,
  power / toughness without `secondFace.pt`, the art box without
  `secondFace.artSlot` — held to both renderers by
  `tests/unit/render/second-part-never-drawn.test.tsx`; once shown a field
  stays until Start over or another card, `use-second-part-fields.ts`; a
  hidden field is not rendered, its value stays in the form, so a save is
  unchanged; never a "show more" control — a stored or arriving value, or a
  server error, is what shows one),
  ONE preview with a ring on the part being edited (`part-outline.tsx`,
  boxes from the profile via `lib/creator/part-outline.ts`: creator chrome
  beside `CardPreview`, never inside it or any renderer), and a part with
  no picture of its own (adventure spell, flip side) is never asked for
  artwork. A save's payload is pinned to `origin/main`'s by
  `creator-face-tabs-payload.test.tsx` — a moved field keeps its path.
  A card on a DFC body (a back with a body: `bakedBackOf`, 5.3) bakes TWO
  PNGs + TWO thumbs — the back's `{id}.back.png` / `.back.thumb.webp`
  through `renderBackFace` in both bake paths, the four pointers in ONE
  write; a back failure fails the whole bake; a legacy back stays
  single-bake — `?face=back` serves it (png / pdf) and opens the page
  flipped (the client island only), `?faces=both` (png, 5.3c) serves BOTH
  faces side by side in ONE PNG — each half what `face=` serves, a
  transparent gutter between, the modal's default on a two-faced card,
  never a print variant or a JPEG (400) — the page is "Front // Back"
  (`cardPageName`), and the OG image stays the front.
  A two-faced TILE (5.15, owner 2026-10-12 — it replaces 5.3's "nothing
  moves on hover"): a card with a back PICTURE (`tileBackThumbOf` /
  `hasBackPicture`, `lib/cards/tile-faces.ts` — a stored back thumb beside
  the front's, portrait; the ONE answer for every surface) gets a labelled
  "2 faces" button, bottom-LEFT, 44 px tall, named "Show back / front face
  of <title>" (`components/cards/baked-card-flip.tsx`, inside
  `BakedCardThumbnail` — never a second implementation), and ALSO turns
  when a mouse rests on it for `HOVER_REST_MS` (333) — only under
  `(hover: hover) and (pointer: fine)`, never under
  `prefers-reduced-motion: reduce` (there the button cross-fades), back to
  the front when the pointer leaves; a click still opens the card. The
  rest starts with a real pointer MOVE on the tile — never on
  pointerenter: a browser fires that (and no pointermove) on whatever a
  wheel scroll or a page load slides under a still cursor, and the grid
  turned its cards while the reader only scrolled. The turning stage
  (`.tile-flip-stage`) takes NO pointer events: inside `CardHoverEffect`'s
  3D tilt a browser hit-tests by depth, and the faces took the button's
  clicks (never "fix" it by lifting the button with translateZ — its hit
  area then leaves its drawn box). The button is NEVER inside the tile's
  link or `role="button"` (5.17: a control in a control is invalid HTML,
  axe "nested-interactive"): every gallery-style tile is nested by ONE
  component, `CardTile` (`components/cards/card-tile.tsx`) — a one-faced
  tile's link wraps the picture as it always did; a two-faced tile's link
  (or My Cards' role="button") is an EMPTY element UNDER the picture,
  first child of `.card-hover-effect` (`CardHoverEffect`'s `under`; the
  very box the wrapping link was, focus ring included), the tilt's rotor
  takes no pointer events so the pointer falls through the picture to it,
  and the button alone is `pointer-events-auto` — keyboard order link →
  "2 faces" → what follows. The hover-rest is therefore heard on
  `.card-hover-effect` (native listeners), never on the picture. A
  `BakedCardThumbnail` draws the button only with `backFaceButton`, which
  `CardTile` alone sets: a new tile surface uses `CardTile`, never a
  hand-nested `Link` + `CardHoverEffect` + thumbnail
  (`card-tile-structure.test.tsx` scans for it). A pointermove "really
  moved" the mouse only against its last place ANYWHERE on the page — one
  passive document listener (`trackMouse`, `baked-card-flip.tsx`), never a
  place remembered per tile: WebKit sends a pointermove at the unchanged
  px on every wheel notch, and a mouse parked beside the grid turned the
  tiles that scrolled under it. The deck pop-up's picture
  link opens the face it shows (`?face=back`) and closing the pop-up
  returns the focus to the row that opened it — once more when a backdrop
  click is over (its mousedown blurs the row), and to the row that took
  its place when the entry is gone (removed, filtered away), never
  `<body>`. The back's 600 px thumb is mounted only
  on intent (the pointer moving on a tile that can hover-turn, the
  button's focus or press) — never at rest, never the HD PNG; a hover
  turns only once it has arrived, and a back that fails to load (removed
  by an edit after the list was built) leaves the front with no button.
  An older two-faced card with no back picture shows
  NOTHING, and neither does a card mid-save (pointers cleared: the live
  front, no button — `cardToPreviewData` carries no back). Where the
  picture is too small to turn (the deck list's rows, My Cards' list view,
  the pinned-cards picker) the same cards carry the `TwoFacesMark` text,
  and the deck pop-up a Front / Back switch (one face at a time).
  Imports follow the printing PER FACE (5.4; `dfcImportOf` in the mapper):
  a transform / modal printing lands on the bodies — the front body by the
  front's type, the back body by the back's type and the printing's family
  (`printed_dfc_icon` from `frame_effects`), the back's own colour (a land
  face colourless on the TRANSFORM land bodies, its mana's colour on the
  modal ones) — only when BOTH combos are verified
  (`lib/scryfall/dfc-import.ts`, `finalizeImportMatch`), else as before
  (standard frame + legacy back); a walker face imports the front alone
  (toast + a `dfc/walker` request row), a colourless face without an
  Artifact word on a TRANSFORM body and a devoid / snow dress keep today's
  landing (5.11, `dfc/colourless-face` / `dfc/devoid` / `dfc/snow`). The
  modal spell bodies' `c` is the SEE-THROUGH frame (5.11a, STX #6 Wandering
  Archaic: `scripts/build-mdfc-colourless-frames.mjs`), offered to a face
  with no Artifact word only once its `c` row is ticked at
  `SEE_THROUGH_COLORLESS_SINCE_LAYOUT_VERSION` or later — the older ticks
  verified the artifact stand-in (`seeThroughTickKeys`; every gate reads
  `colorlessFaceAllowed(template, face, verifiedKeys)`, the mapper and the
  references `colorlessFaceFits`). The AI deck remix of such an
  entry costs 2 credits (two pictures), priced at plan time
  (`lib/ai/remix-estimate.ts`, `/api/ai/remix-estimate` — the deck's owner
  only, behind the AI rate limit: it calls Scryfall) and shown in the
  estimate before anyone pays; the step reserves what the plan priced.
  The remix lands where the IMPORT lands: `remixFrameFor` finalizes the
  mapper's static landing with the database's verified combos through
  `finalizeImportMatch` (the function `/api/scryfall/named` runs), so a
  frame the registry names "once verified" (`onceVerified`,
  `landOnOnceVerified`: Vehicles on `m15vehicle`, M20+ tokens on the
  full-art design) is taken by a remix the day it is ticked — never read a
  mapped patch's `frame_template` for a landing without it, and never copy
  its rules.
  A remix of the user's OWN card (a deck entry's `card_id`, read before its
  printing) keeps the source's FRAME (owner 2026-10-13): its template with
  the stored anatomy switches (`storedAnatomyOf`; never the finish) where
  the save's own gates pass it — `ownCardRemixFrame`
  (`lib/ai/remix-mechanics.ts`: published in the card's colour, the kind
  gate — judged again on the NEW name before the art — a two-part frame
  with its second half, a double-faced body with its back on a verified
  body, priced 2 by the estimate through the same function) — else no
  template: the default landing, one face. A fallback, never a refused
  save after the art; a token's height still follows the saved text.
  A remix never SAVES a text on a frame that draws none (TODO 1.24): where
  both paths save, `remixSavedFrame` (`lib/creator/frame-resolve.ts`) takes
  a landing whose PROFILE is `textless` (`frameHidesRulesBoxText` — the
  renderers' flag and `hasRulesBoxText`; today the full-art token's two
  textless heights and the textless promo pair) off it once the final text is known — a printing onto
  its landing with the textless frames read as unverified
  (`withoutTextlessFrames`, the registry's own stand-in, `text_stand_in`),
  an own token onto the 2014–19 arch its type words pick, else an own card
  onto the default landing, where the save's gates pass it
  (`ownCardTextStandIn`) — and leaves it where the card saves with no text
  or nothing else is published in the colour; `resolveGeneratedFrame`'s
  random pool and a frame it is asked for by name read the same test. The "M15 Textless" frames ARE textless
  profiles since layout v58 (the black-bordered textless promos, CC 'Magic
  Fest Promos') — the guard reads the flag; never test a template's name.
  An EMBLEM is never remixed (owner 2026-10-13; it prints its walker's
  name, and a remix renames each card by itself): left out at plan time —
  `remixableDeckItems` for an own emblem, a 0 in the estimate's
  `creditsByEntry` for a printed one; `emblems` in the estimate, one line
  in the dialog, no step, no charge — and an older plan's emblem step
  fails with `REMIX_EMBLEM_LEFT_OUT` before any AI call (an own one before
  the reserve: no ledger row).
  Owner-run scripts reach the app for such work through
  `POST /api/admin/storage-sweep` (cron bearer; `scripts/lib/app-endpoint.mjs`).
- Automatic re-bake (migration 0120, `docs/FRAMES.md` "Re-bakes after a
  deploy" + "Re-bake runbook"): `/api/cron/auto-rebake` (`vercel.json`,
  every 5 min, production only; `lib/cards/auto-rebake.ts`) re-bakes what a
  "sweep" bump or a null stamp left behind — `runRebakeBatch` scope `sweep`,
  ≤240 s per run, never without `NEXT_PUBLIC_BILLING_ENABLED`; idle = one
  head count below `latestSweepVersion()`. ONE lease (`render_sweep_state`, service-role only —
  it names unlisted cards; `lib/cards/sweep-lease.ts`) is shared with
  `POST /api/admin/rebake` (the script, which still works) and
  `/api/admin/rebake-marked`: a manual call makes the cron yield after its
  batch and parks the lease between calls; still busy after 2 min → 503 +
  Retry-After, never 409. A card failing 3 runs goes on the poison list
  (skipped until "Retry"; dropped once it no longer owes a re-bake); a run
  that dies (maxDuration, OOM) is detected by the next one, which strikes the
  batch it left in `in_flight`. The breaker (whole batch / 10 new failures /
  hung batch / batch query failing 3 runs / 2 dead runs / a run pushing the
  poison list past 50) pauses it and sends every admin a
  `render_sweep_paused` notification; `/admin/renders` = status + Pause /
  Resume / Retry. A migration that nulls stamps for a CODE fix ships with a
  sweep bump (or pause first): the old deployment's cron can re-bake them
  with the old code before the new deploy is live.
- Shadows (layout v74, TODO 3.5 / 3.25): a shadow or outline length on a
  profile is CARD-WIDTH px — `cardPx(n)` (n px of a
  750 px card, written in `cqw`), never a CSS px literal: the preview draws
  `cqw` natively, the bake through `bakeShadowCss` / `textShadowCopies` at
  its own width (a raw `cqw` reaching Satori is dropped). A shadow of two or
  more zero-blur layers (`OUTLINE_SHADOW`, `ON_ART_OUTLINE`) is drawn by the
  bake as offset COPIES of its text (librsvg keeps a merged filter's last
  layer only — a one-sided shadow) and belongs to its TEXT in both
  renderers (`shadowDrawsAsCopies`: `bandTextStyle` sets it on the name /
  type line, never the band); never put `textShadow: undefined` in a Satori
  style (it throws) — drop the key.
- The art's zoom (layout v51): a Satori `transform-origin` built from a
  number goes through `satoriTransformOrigin()` (`lib/render/card-image.tsx`)
  — Satori drops a ZERO component (`0%`) and zooms about the centre on that
  axis; `left` / `top` are read as 0. `docs/FRAMES.md` "Art under and around
  the frame".
- ONE card corner (layout v31, TODO 3.26): `lib/cards/card-corner.ts`
  (`CARD_CORNER_OF_SHORT_SIDE` 0.043 of the SHORT side — 64.5 px at HD in
  both orientations, never `Math.round`ed; no imports). The bake cuts it
  into the PNG's alpha (`applyCardCornerMask` via `renderPng`'s
  `cornerRadiusPx`), so every stored bake, thumb and OG image is ROUND;
  display boxes use `.card-corners` / `.card-corners-landscape`
  (`cardCornersClass()`, only on an exact 5:7 / 7:5 box) — never a fixed px
  or `rounded-*` radius on a card image. Print always passes
  `corners: "square"` (PDF card + sheets, the Pro deck export's
  `corners=square`): the round render squared again, each corner in the
  border's colour from `lib/frames/square-corners.ts` (#000, #101015 on a
  ring, or the art/design) — a test holds that table to every master.
  `/api/cards/[id]/png` defaults to SQUARE (old links, stale export tabs);
  the download modal asks `corners=round` or `square` by name, a free
  Square is the stored round bake squared with the same fills, and
  `corners` is in the ETag. The CC importer cuts masters at the constant;
  the allow-listed MSE masters are normalised by Phase B
  (`scripts/lib/frame-corners.mjs`, run by the builders too) — `docs/FRAMES.md`.
- PRINT exports (TODO 6.10 / 6.1a / 6.1b / 6.15 / 6.1): the PDF (card + sheets),
  the 800 ppi / 1/8″ bleed PNGs (`?ppi=800`, `?bleed=1`), MakePlayingCards'
  file (`?bleed=mpc` — MPC's own bleed per axis, `MPC_BLEED_IN`, always
  portrait; the MPC ZIP image size) and the Pro
  exports' 600 ppi print render (`?print=1` — every deck/selection PDF card
  and HD ZIP image, `exportCardHref` in `lib/decks/export-client.ts`) render
  through `lib/render/card-print.ts` — Satori draws the HD layout WITHOUT the art
  (`renderCardImage` `printLayer`, CardImage `omitArt`; `outputWidth`
  re-renders the vectors at 800 ppi) and sharp composites the ORIGINAL art
  under it with the same fit (the boxes come from Satori's `onNodeDetected`),
  then squares it; the bleed extends each edge by `EDGE_CONTRACTS`
  (`lib/frames/edge-contract.ts`). Always live and square (the images PNG
  only); the bleed and `print=1` follow the clean download, 800 ppi
  `PRINT_800_PPI_PAID_ONLY` (`lib/cards/print-export.ts`). Never route a
  stored bake, thumb or OG image through it. Every print surface (My Cards'
  selection, the deck export, the download modal's PDF tab) shares the sheet
  options UI (`components/cards/print-sheet-options.tsx`) and the remembered
  settings (`lib/cards/print-selection.ts`); a card PDF link is built by
  `lib/cards/card-pdf-link.ts`.
- ONE M15-era display size (layout v32, TODO 4.20): the family
  (`M15_FAMILY_TEMPLATES`, `lib/cards/m15-family.ts`; v32's scope is the
  frozen literal in `layout-version.ts`) prints names, type lines, pips and
  the set symbol at the constants in `lib/cards/typography.ts`
  (`TITLE_SIZE_PCT`, `TYPE_SIZE_PCT`, `COST_DISC_PCT`, `SET_SYMBOL_BOX_PCT`…)
  — never a profile literal. The 36 CC-framed M15 profiles' cost row is ONE
  spread, `CC_M15_COST` (layout v61: `CC_M15_COST_DISC_PCT` 70 px, the
  2023+ prints' place, `costDx` a translate that never moves the name's
  room); the walkers take the 70 px disc and their own `costDx` (place
  kept); flip, aftermath and the MSE showcases keep 72.75. A slot with `fit: "measured"` takes its size,
  text (ONE "…" past the 5 pt floor) and width from `fitTitleBand` /
  `fitTypeLineBand` in BOTH renderers (bake: `measuredLinePx`; preview: the
  HD bake's px); `TextSlot.dy` moves the text only; the set symbol's size and
  drawn width come from `setSymbolSize()` (the ink fit only with the
  code-owned `setSymbolFit: "ink"`; a Keyrune glyph of a set in
  `lib/cards/set-symbol-prints.ts` draws at that set's PRINTED size, v36 —
  keyline-inclusive boxes, so a `setSymbolKeyline` bar fits ink + ring;
  never past CC's 0.12 W but the core-set pills `SET_SYMBOL_PRINTED_PAST_CAP`,
  which a symbolRect never shrinks; adding or re-measuring a set is a bump;
  the full-art basics' "ink-box" never reads the table). Frames outside the
  family keep the old paths byte-for-byte — bringing one in is its own
  layout bump (`docs/FRAMES.md`).
- The landscape pair (layout v43, TODO 4.21b): `split` and `battle` are Card
  Conjurer masters in the bucket at 2100 × 1500 — the importer's
  `orientation: "landscape"` recipes (split turned a quarter turn clockwise
  with no resample, battle downscaled once). A recipe's `shift` moves whole
  blocks onto the prints through FLAT zones only (`shiftBlocksRgba8` throws
  otherwise; `SPLIT_HALF_RECUT`, `BATTLE_BLOCK_RECUT`), and the profile
  writes its rects in the PACK's px and rides the moves (`SPLIT_RECUT_PX`,
  `BATTLE_LOWER_RECUT_PX`; a unit test holds recipe and profile together).
  What no block reaches on the battle is re-cut after the shift (layout
  v45, TODO 4.21d, the recipe's `printRecut`): the bars' paper stretched
  right (`recutColumns`, `BATTLE_RIGHT_RECUT` — it throws unless the
  window columns it covers are one colour a row), the shield set 12 px
  right through the pack's Defense mask, source-over (`BATTLE_SHIELD.dx`),
  the icon's rings REDRAWN at the prints' radii (`BATTLE_ICON_RECUT`:
  flat geometry, said so in provenance); the slots ride
  `BATTLE_TOP_RECUT_PX` / `BATTLE_RIGHT_RECUT_PX` — the name moves up
  with its pill, the cost keeps the prints' rows (`costDy`). The bump is
  `BATTLE_RECUT_LAYOUT_VERSION`.
  Battle is in the M15 family through `displayPct(…, "landscape")`; split
  is NOT — a half prints smaller (`SPLIT_*` in `lib/cards/typography.ts`,
  `setSymbolFit: "ink-height"`) — yet both its halves are `fit: "measured"`
  (an unturned second face is fitted as a front band is). The battle's
  defense is the value alone in the shield the MASTER paints
  (`StatSlot.paintedRect`: a rules keep-out on every battle; never a drawn
  badge), and both print the artist credit down the left border
  (`FrameProfile.footerTurn`, both renderers through `unturnedRect`; the
  collector line there is 4.9d's). The split's half masks and the battle's
  Defense mask are importer inputs, never published. `docs/FRAMES.md` "The
  landscape layouts".
- ONE rules layout (layout v33, TODO 3.29): `lib/cards/rules-layout.ts`
  decides the size (the even HD-px ladder `RULES_SIZE_PX` 76 / 68 / 64 → 42;
  profiles use `rulesPxToPct(RULES_SIZE_PX.*)`, never a pt literal), every
  line break (MPlantin's real advances, `lib/cards/rules-metrics.ts`, checked
  at BOTH the 750 and HD bakes, no safety factor; a lone " —" breaks with its
  word) and every position (0.98 em pitch, 24 HD px between abilities,
  12 before a "•" mode, whose wrapped lines HANG where its first word
  starts — `hangIndentPx`, never spree's "+"; 29 + 4 + 28 around the flavor
  bar, 96 % of the column with faded ends, ONE SVG in both renderers,
  `lib/cards/flavor-bar.ts` — layout v74, TODO 3.16 / 3.19) of rules,
  flavor, walker rows and the saga rail; the token height rule measures
  modes as plain paragraphs (`bulletModes: "plain"`, its answers held to
  the pre-v74 layout's). Both renderers only DRAW its lines (`rulesDraw` → `RulesBox` /
  `RulesBoxBake`, `RulesLines*`: nowrap rows, word gaps as `marginLeft`, each
  preview word at its ceiled `wordWidthPx`) — never a box that wraps. An
  inline pip is a 0.785 em disc centred 0.334 em above the baseline (on the
  capitals, v36), drawn at the layout's `pipTopPx` in a run the line box tall
  — never centred by flexbox — and FLAT on every symbol style (v49: the
  shadow is the cost row's alone); a LARGE pip — a hybrid, a twobrid, a
  Phyrexian and a two-colour Phyrexian symbol (`isLargePip`, v53) — sits on
  the prints' larger disc on the same centre: ×1.28 in rules text on every
  frame, and in a cost the symbol style's `largePipScale` (×1.2; 85 px
  beside 66 on the 2003 frame) (`pipScale` in `lib/cards/mana-gem.ts`, read
  with the style of the PLACE — the frame's for a cost, `inlineSymbolStyle`'s
  for text — the ONE answer the layout's `pipWidthPx` / `pipTopOf`, `costRowTerms`, the
  detached cost's `manaCostWidthPct` — v52: a name's room before a
  `costRect` cost counts each pip's own disc — and both renderers read; a
  new measure of a cost row reads it too, never a disc per pip). WHAT a pip
  is — the prints' untap, Phyrexian, two-colour
  Phyrexian, snow (an SVG flake) and disc-less energy since v49 — is
  `manaGemSpec` alone (`docs/FRAMES.md` "Symbols as printed").
  `TextSlot.padPx` pads past any textbox border the rect holds (split).
  Keep-outs = the stat badges the card DRAWS (`statKeepOuts`; plate ink in
  `lib/cards/plate-ink.ts` — a new or replaced plate needs
  `scripts/measure-plate-ink.mjs` + the test's `MEASURED_ON`), judged glyph
  by glyph. Walkers ≤ `walkerSizePct`, row anatomy at `LOYALTY_ROW_SIZE_PX`;
  the saga's rail (4.21c) is `lib/cards/saga-rail.ts` — the reminder block
  (its fixed box, its lines out of the fold's corner, `intro.keepOuts`; one
  the box can't hold at the floor outgrows it into the chapters' column,
  the rows under it — never a clip while the rows can give way), rows sized
  by the walkers' `contentRowsAt` (never shorter than their badge stack;
  stacks that cannot fit — alone, or beside the text at the floor — become
  the combined marker before any text clips; past the floor a row keeps
  its badge, `rowFractionsPastFloor`), the reminder ONE paragraph,
  badges and dividers as frame pieces under the finishes.
  `tests/unit/render/rules-no-clip.test.tsx` holds real bakes to the layout.
- Tokens (layout v34, TODO 4.49 + 3b.15): a token's card types are WORDS in
  `supertype` (Creature / Artifact / Enchantment / Legendary, printed order,
  `withSupertypeWord`; none = a Copy's bare "Token"); `buildTypeLine` prints
  "Token" first on every template. P/T: `showsPowerToughness(type, subtypes,
  supertype)` for inputs and the AI (a token needs Creature or a Vehicle /
  Spacecraft subtype), `printsPowerToughness` in both renderers (keeps a
  stored word-less token's P/T; 0128 gave them "Creature" + a null stamp,
  and gave it to P/T tokens saying Artifact / Enchantment without Creature
  or a Vehicle / Spacecraft subtype; `formSupertypeOf` reads the same word).
  The Artifact word picks `m15tokenartifact` (`typeWordFrameFor`; no
  "Artifact Token" chip); new tokens AND a token's remix save as common
  (creator AND AI jobs), chips hidden. `m15token` / `m15tokenartifact` = the
  2014–19 arch prints only (M20+ = 4.48): masters RE-CUT 8 px onto the prints
  (`TOKEN_TEXTLESS_RECUT` in the CC importer; the profile rides it through
  `TOKEN_RECUT_PX`), P/T on M15's plates, type line left from 8.54 %W, own
  `symbolRect` centred on the moved pill; on all four arch frames (4.53,
  layout v59) the name is GOLD in small caps SYNTHESIZED from Beleren Bold
  (`TextSlot.smallCaps`, `lib/cards/small-caps.ts`: runs with explicit
  widths on the row's bottom in both renderers — never a flex baseline,
  never the engine's own run box; no font file) and the art slot is the
  masters' window + 7.6's overscan (`TOKEN_ART_SLOT` /
  `TOKEN_WIDE_ART_SLOT`, the see-through `c` its own). `m15tokentext` /
  `m15tokenartifacttext` (4.49 (b)) = the same arch with a text box (CC
  'Regular (Bordered M15)' re-cut 64 px down onto the prints,
  `TOKEN_REGULAR_RECUT` — its own band, symbol and type band from CC's
  (`TOKEN_CC_*`), never M15TOKEN's re-cut ones); `rules.alignSingleLine:
  "center"` centres ONE rules line (the layout places it, both renderers
  draw its indent). The text box FOLLOWS THE TEXT (owner decision 5):
  `textBoxFrameFor` / `tokenFrameFor` on `hasRulesBoxText` (the renderers'
  test) — the creator (`followTokenTextBox`: automatic until a Variations
  pick, which sticks, as does a stored frame that disagrees with its text),
  the registry (unverified → `TEXT_BOX_TOKEN_FALLBACK`), `resolveGeneratedFrame` and the
  remix (`autoTokenTextBoxFrame`); 0129 moved stored non-land, non-preview
  cards with text off the textless pair (null stamp, no bump). The textless pair's
  scrim is ONLY the fallback for text left on them. The arch's TALL box
  (4.55: `m15tokentall` / `m15tokenartifacttall`, PipGlyph's own cut of the
  published text-box masters — `scripts/build-token-tall-frames.mjs`, the
  pill / box top / window edge 238 px up, `TOKEN_TALL_UP_PX` held to the
  recipe) makes the arch three heights like the full-art design
  (`ARCH_TOKEN_TEMPLATES`, `tokenHeightForText(text, "arch")` against the
  arch's own regular box, through `tokenFrameFor` in every writer); where it
  isn't verified in the colour the regular box STANDS IN
  (`archTallStandIn`), never the textless scrim; its import stays pinned
  (`TALL_BOX_TOKEN_PINS`, rule `token/tall-box`: nearest the regular box,
  exact on the tall box once verified — the SOI Clue's 39 characters print
  tall, so never the text rule). A
  later bump whose slots move on fewer templates than its bakes change on
  lists them in `VERIFICATION_TEMPLATE_SCOPES`; legacy ticks
  are judged at `LEGACY_TICK_LAYOUT_VERSION` (33) (`docs/FRAMES.md`
  "Tokens"). M20+ tokens (4.48 / 4.50) = six NEW templates `m20token` /
  `m20tokentext` / `m20tokentall` + `m20tokenartifact…` (CC's 'Textless' —
  re-cut 5 px, `M20_TOKEN_TEXTLESS_RECUT` — 'Short' and 'Tall' packs; never
  CC's 'Regular'; the importer's `finish` composites darken the colourless
  and artifact type pills to the prints and make every type pill solid, and
  the artifact name pill slate and solid): the textless height is 3.24's
  `textless` with `textlessTypeLine`; the height follows the text
  (`tokenHeightForText`, `lib/cards/token-height.ts`: the regular box down
  to 72 px — the import's rule too; `tokenFrameFor` applies it for the
  pickers, AI jobs and remix); `token/m20` is exact on them once verified
  (`onceVerified` + `exactOnceVerified` → `FrameMatch.onceVerifiedMatch`,
  applied by `withVerification`; `borderless/token` names them too, still
  nearest). The tall box squeezes its paragraph gaps before its size steps
  down (`TextSlot.paragraphGapMinPx`, that box only). A NEW token starts on
  the full-art design only where its template/colour is VERIFIED, else on
  round 11's arch ("Token (2014–2019)") — re-applied when a colour is
  picked after the type, until a frame pick (`defaultTokenFrameIn`) — and
  its height follows the text until a Variations pick
  (`lib/creator/token-frame-auto.ts`, wired into the form's round-11 effect;
  `docs/FRAMES.md` "Full-art tokens"). Its crown and two-colour split are
  ADDITIONS (4.48's last pieces): CC's floating crown band
  (`M20_TOKEN_CROWN`, `tokens: true` — the ONE crown a Legendary token
  qualifies for, `qualifiesForCrown(facts, tokens)`) and `<pair>` masters
  whose P/T is the grey `c` plate (`FrameProfile.twoColorPlate`). The Nyx
  dress (4.51, an ADDITION): six more STORED templates `m20tokennyx…` /
  `m20tokenartifactnyx…` — the starfield in the NAME PILL only, PipGlyph's
  composite over the published masters (`scripts/build-token-nyx.mjs`;
  never a CC file), keys w u b r g c m, no pairs — an enchantment dress
  (`ENCHANTMENT_DRESSES` `token` bases; the token kind's alone): the height
  and the Artifact word keep it (`m20TokenTemplate(height, artifact, nyx)`),
  a NEW Enchantment token starts on (and follows onto) it where verified —
  in ONE colour only (owner Round 74, `followsTokenNyxDressIn`: a
  two-colour token keeps 4.48's split; picked by hand it wears gold `m`) —
  a stored one keeps its frame; the import names it once verified and, until then, the plain
  template where that is (`FrameMatch.onceVerifiedFallback`, applied by
  `withVerification` only). `docs/FRAMES.md` "The full-art token's Nyx
  dress".
- The type line (layout v50, TODO 1.20): `supertype` holds every word left
  of the dash but the card type's own (the importer's rule, 1.3) and
  `typeLineWords` / `buildTypeLine` (`lib/cards/card-display.ts`) put the
  card type back in PRINTED order at build time — Basic, Legendary, Ongoing,
  Snow, World, Host / Elite, Kindred / Tribal, Enchantment, Artifact, Land,
  Planeswalker, Creature ("Legendary Enchantment Creature", "Enchantment
  Land", "Land Creature"); Instant / Sorcery / Battle print last; a word the
  order doesn't know stays where it was typed and nothing moves across it.
  Never store the order, never build a type line by hand. A face whose words
  say Creature shows and prints a P/T whatever its card type (Dryad Arbor: a
  land with "Creature"; `showsPowerToughness`), never an emblem. The table
  and its Scryfall sample are `tests/unit/cards/type-line-order.test.ts`;
  changing the order is a layout bump (`v50FaceChanged` is frozen).
  That BUILT line is what prints while `cards.printed_types` is NULL (every
  card saved before TODO 3b.16 / migration 0137, AI cards, nearly every
  import). The creator's Types field (`components/creator/types-field.tsx`,
  pre-filled with the built line) lets the maker reorder the words, type
  round the card type's word or remove it: `printed_types` (a second face:
  `back_face.printed_types`) then holds the words AS TYPED and
  `typeLineWords` prints them unordered ("" = emptied: the subtypes alone, no
  dash) — stored only when it differs from the built line
  (`resolvePrintedTypes`, `lib/cards/type-line-field.ts`). It is DISPLAY
  only: what a card IS reads `card_type` (frame, P/T inputs, hubs, stats, AI
  lint) and `supertype`, which the field writes as the typed words minus the
  card type's own (`supertypeFromTypes`) — never read `printed_types` to
  decide behaviour, never write it without the helpers. A token's "Token" is
  a fixed prefix outside it; an emblem never has one. On an edit / remix the
  field changes the printed words ONLY (`supertype` stays locked). Each word
  of a type-line part is capitalised by `printTypography(…, "type")`
  (`capitalizeTypeWords`: the Types field, supertype and subtypes). A DASH
  typed in the field moves the words after it to Subtypes on blur
  (`splitTypedDash`; the card draws the dash itself — not on an edit, whose
  subtypes are locked), and a card-type change swaps the old type's word in
  a typed line for the new one (`typesAfterCardTypeChange`). The bake's
  reads go through `selectBakeColumns` (`lib/cards/bake-select.ts`: the same
  read without `printed_types` on a database 0137 has not reached — remove
  it once 0137 is on production and dev).
- Emblems (TODO 4.52 + 6.23, migration 0130): `card_type` 'emblem' and the
  `emblem` kind, reached ONLY through the token kind's Emblem choice
  (`KIND_PICKER_KINDS` leaves it out of the kind chips; `kindPickerChip`
  lights Token). The kind wears the `emblem` frame alone and the frame
  dresses nothing else (`templateRefusesKind` both ways, so the server's
  kind gate too); every save is colourless with no cost, supertype or stats
  (`withEmblemShape` / `withEmblemUpdateShape`, `lib/cards/emblem.ts`), new
  ones common, rarity chips hidden (`kindHidesRarity`); `buildTypeLine`
  prints "Emblem" (+ " — subtype"). The frame is CC's one master in every
  colour key (only `c` is referenced), its name pill, silver, type pill
  and text box toned onto the prints (`EMBLEM_TONES`) and its spark's
  centre ray bridged over above the art (`EMBLEM_RAY_BRIDGE`, CC
  importer); its art window is
  Scryfall's emblem `art_crop` box EXACTLY (a crop of the printed card, at
  the prints' scale — never grown), CC's tall artBounds the `underFrameArt`
  layer the spark's 80 % tail shows. Its page and new slug say "Emblem"
  (`cardPageName`: "Kaito, Cunning Infiltrator Emblem", …-emblem, like
  Scryfall) while the card prints the walker's name. Imports: "Emblem"
  is the emblem card type (title minus " Emblem", subtype only on the
  2014–19 look / AFR); registry `emblem/m20` exact, `emblem/2014-19` /
  `emblem/old-frame` nearest, `emblem/one-off` unsupported. Emblems stay out
  of the AI's design types AND its output enum (`designedCardsSchema`: a
  fill may only PIN one); the lint errors on an emblem's cost or colour.
  An emblem names no rarity on its card page (`cardTypeHasRarity`).
- Art windows (TODO 7.6, layout v35): every art slot covers its master's
  see-through window with 0.05 % to spare and every translucent part the art
  shows through (`lib/frames/art-window.ts`; CI checks every template ×
  colour master, the bucket ones fetched by sha; a known failure is listed
  with its TODO item and a `maxMissPx` it may not exceed — fixing one means
  striking it). See-through masters (`underFrameArt`: m15/c, every devoid,
  the colourless tokens and planeswalker) draw the art under the frame from
  the border's inner edge (`UNDER_FRAME_RECT`); their window's slot must
  cover the window too and meet that separately cropped layer on the frame's
  OPAQUE outline — or be ONE picture (`underFrameArt.artSlot` = the rect,
  m15pw/c); both renderers and the foil mask read `artLayersFor()`. The
  CC-framed M15 profiles use `CC_M15_ART_SLOT`, never M15's MSE slot
  (adventure keeps that). A frame-compare save that moves an `artSlot`
  passes the same check on the bake's own masters or is refused
  (`lib/frames/art-window-override.ts`).
- Printed pieces a card SWITCHES ON (crown, two-colour; 4.6 — the collector
  line and its ★, 4.9b): `frame_style.crown` / `twoColor`, drawn only
  `=== true`, `frame_style.collector` (`"2015"` / `"2023"` / `"off"`; drawn
  for a style) and `star` (`true` or absent) (`lib/cards/anatomy.ts`); new
  cards start on — but the collector line, which starts `"off"` (owner
  2026-10-30; an import follows its printing) — every save runs `normalizeAnatomy`, an edit sends only
  `frame_anatomy`, and a piece is declared on a `PROFILES` entry only — the
  old frames' pairs too (4.6h: `modern`, `modernland`, `retroland`; masters
  SYNTHESISED from the template's own finished masters, `oldFramePairLayers`,
  never a scan; `retro` none — the 1997 frame printed one gold; an import
  names the switch only where the print has the look, `printsTwoColorFrame`)
  (`FrameProfile.collector` = `M15_COLLECTOR` on the wave-1 entries,
  `COLLECTOR_TEMPLATES`) — `docs/FRAMES.md` "Printed pieces". The crown has
  TWO controls on ONE state (3b.17): the Variations section's "Legendary"
  chip and the anatomy panel's switch both read `legendaryVariationOf`
  (`lib/creator/legendary-variation.ts`) and write `frame_style.crown` —
  never a template; the chip is a NEW card's (it adds the word "Legendary"
  there; an edit or a remix has the switch alone, plus one line of reason
  for a non-legendary card on a crowned frame), disabled with its reason
  where the card's own template declares no crown — and the Variations
  section shows only when it has something to pick (never the dead chip
  alone). The live preview reads the style through `previewFrameStyleOf`. On a card
  with the line the pipglyph.com mark sits in its © slot (line 2 with a
  drawn stat plate, else line 1 — m15pw's `markLine: 2` keeps it off the
  empty loyalty shield; `lib/cards/collector-layout.ts`) and a clean
  download prints `footer_text` there (cut with one "…" past
  `MARK_TEXT_MAX_WIDTH_PCT`); the collector face
  (`public/fonts/Montserrat-Medium.ttf`, OFL, subset ⊆ MPlantin's cmap) is
  registered after MPlantin and BEFORE Keyrune, never last: Satori draws a
  character no font has with the LAST registered font (its `.notdef` and
  advance), so a new face at the end changes stored bakes
  (`collector-font.test.ts` pins the order) — and never add a glyph
  MPlantin lacks. The holofoil stamp (4.9c) is `frame_style.stamp`
  (`"auto"` = the oval on a rare or mythic, `"oval"` / `"triangle"` =
  always the frame's own shape, `"none"`; absent = unstamped — cards saved
  before it included): our own silver oval (`lib/cards/holo-stamp-art.ts`,
  a generated bitmap drawn ABOVE the sheens at `holoStampArtRect`) over
  CC's notch with its hologram region cut clear (`m15holostamp/*`,
  `m15pwholostamp/*`: bucket only, `HOLO_STAMP_NOTCHES`), declared as the
  `holoStamp` overlay on the seven wave-1 entries (`lib/cards/holo-stamp.ts`,
  `resolveHoloStamp`); never on a token or an emblem, the FRONT face only;
  a card drawn as its PAIR master takes the pair's notch
  (`m15holostamp/<pair>`: the same arch with its rim tinted PER COLUMN to
  the pair master's bar across the 40→60 %W pinline ramp — one piece per
  pair for the split, hybrid, artifact, land, snow and snow-land masters,
  whose bar under it is the same pixels; the importer refuses a drift); its
  arch is a
  glyph-level rules keep-out (`DrawnStats.stamp`) — the rules rect never
  shrinks.
- The Vehicle frame (`m15vehicle`; TODO 4.5c): a STORED template of its
  own, picked under Variations beside the Artifact frame — never a
  render-time pick from the subtype and not a `frame_style` switch (owner
  2026-09-29). Card Conjurer's bronze 'Vehicle Frame' under m15artifact's
  bars, box and pinline (the importer's own recipe, the ten split pairs
  too), m15artifact's slots, crown, stamp notch and collector line, and ONE
  brown plate under every colour key with WHITE digits, toned onto the
  prints with its hue kept (`VEHICLE_PLATE_TONE`: never a per-channel gain,
  which turns the bevel lavender). It dresses a card whose subtypes say
  Vehicle and nothing else (`SUBTYPE_DRESSES` / `subtypeFrameFits` in
  `lib/creator/card-kinds.ts`: the chip, the server's kind gate, random and
  stand-in picks, the import chooser, reference pins); Spacecraft are 4.27.
  An ADDITION: a new Vehicle follows its subtype onto it where it is
  verified (`subtypeFrameFor`: the creator's effect, `resolveGeneratedFrame`),
  a stored Vehicle keeps its frame, an import names it once verified
  (`vehicle/2015`, `onceVerified`) — no bump, no sweep, no badge. The saga
  body still draws no P/T: the printed saga creature (FIN 2025) is another
  body, 4.5d's. `docs/FRAMES.md` "The Vehicle frame".
- The Nyx dress (`m15nyx`; TODO 4.7): the printed ENCHANTMENT frame — the
  M15 frame with a starfield in its frame field (every enchantment creature
  and artifact since 2020, every enchantment since Foundations 2024). A
  STORED template of its own, never a render-time pick from the type words;
  not the `nyx` template (the THB constellation showcase) and not the
  token's Nyx (4.51). Card Conjurer's seven 'Nyx' masters whole (bars, box,
  pinline and border are M15's own pixels; `c` is the pack's silver
  starfield, no art under the frame), m15's twenty pair masters over them,
  m15's slots, plates, stamp notch and collector line, and its OWN crown
  band (`M15_NYX_CROWN`, `m15nyxcrown/*`: the m15 crown with the starfield
  strip inside it — one band, never two overlays). It dresses a card whose
  type words say Enchantment — `card_type` or a `supertype` word, never
  `printed_types` — in the creature, enchantment and artifact kinds
  (`ENCHANTMENT_DRESSES` / `enchantmentFrameFits` in
  `lib/creator/card-kinds.ts`: the server's kind gate, random and stand-in
  picks, the import chooser). A creature and an artifact BORROW it (picking
  it writes "Enchantment", as the artifact frame writes "Artifact" — a word
  a pick WROTE is remembered by the FORM, never by the Card step's panel
  (`components/creator/borrowed-words.tsx`: it comes out when the card
  leaves that frame, on any step; a hand edit of the front Types field makes
  the words the maker's, and another card — an import, an AI fill, an idea,
  Start over — forgets; a new card only, and a new writer of `supertype`
  calls `forgetBorrowedWords()`); the
  Enchantment kind wears it as its own skin (`KIND_SKIN_VARIANTS` — never
  `TEMPLATE_SKIN_VARIANTS.m15`, which an instant shares). An ADDITION: a
  new card whose words say Enchantment follows them onto it where it is
  verified (`enchantmentFrameFor`: the creator's effect,
  `resolveGeneratedFrame`) — a PLAIN enchantment and an Aura too (owner
  2026-10-13, as print does since Foundations), never a land, a token, a
  saga or a double-faced face (no base for those kinds), never a Saga /
  Class / Case / Room subtype (`followsEnchantmentDress`: a body of its
  own in print — offered, not moved); a
  stored card keeps its frame; an import names it once verified
  (`era/2015+nyx` keeps its key and gains `onceVerified`,
  `nyxOnceVerified`) — no bump, no sweep, no badge. Borderless and
  extended-art Nyx printings stay where they land (no frame field, no
  starfield on the print). `docs/FRAMES.md` "The Nyx dress".
- The constellation crown (template `nyx`, owner 2026-10-13): every print of
  the Theros constellation showcase (THB #258–268, all legendary) wears the
  STANDARD 2015 crown in the card's colour with the Nyx starfield strip
  inside it — never one dark / silver crown. `NYX_CONSTELLATION_CROWN` on
  the `nyx` entry only (never the NYX base; `keyMap` c → a), bands
  `nyxcrown/<w u b r g m a>`: PipGlyph's own cut of the published
  `m15nyxcrown` bands (`scripts/build-nyx-crown.mjs`, numbers in
  `scripts/lib/nyx-crown.mjs`; bucket only) whose ONE cut is the arms
  fading out over rows 372–408 — alpha only, never a colour — because the
  MSE masters' side rim is 3 px narrower than the crown's arm, and whose ONE
  tint (owner Round 59) is the colourless card's `a`: its silver toned onto
  the colourless master's bronze (`RECIPE.tint`, `tintNyxCrownBand`: hue
  kept toward white, the starfield strip — where the band differs from the
  plain `m15crown/a` — left alone, alpha never). No pairs (a
  two-colour card wears gold on the gold master), no stamp, no collector
  line. An ADDITION: opt-in per card, no bump, no sweep; a stored card on
  the frame keeps its look. One of the showcases whose import names the
  crown ON (`CROWNED_SHOWCASE_SIGNATURES`, `lib/scryfall/import-mapper.ts`;
  with the LOTR scroll and the ZNR hedron, TODO 4.11) — every
  other legendary showcase still imports with it off. Since v55 the
  masters' RIM wears the M15 FAMILY's tones (owner Rounds 59 / 61: print
  read per card against the same card's regular printing — never a raw
  scan colour; `scripts/lib/nyx-frame.mjs` `toneNyxRim`: w b r g, blue's
  is the pack's own, gold onto the gold crown's arm, colourless onto MSE's
  bronze), so the untinted bands match it — crown = rim per key. Since
  layout v73 (TODO 4.17f) the masters are Card Conjurer's 'Nyx Showcase'
  in the frames BUCKET (never back in `public/frames/nyx`; `CC_TEMPLATES.nyx`,
  the rim and v37's bar / box darkness as the importer's `masterPass`): its
  lower half on print, never re-cut; the type band rides its bar.
  `docs/FRAMES.md` "The constellation crown", "The constellation frame
  on its prints" and "The constellation frame's lower half on print".
- The station frame (`m15station`, `m15stationland`; TODO 4.27a): Edge of
  Eternities' Spacecraft (an artifact whose subtype says Spacecraft) and
  Planets (a land whose subtype says Planet) — `SUBTYPE_DRESSES`, the
  Vehicle's gate, nothing else. Masters are OUR OWN derivation
  (`scripts/build-station-frames.mjs`, numbers in
  `scripts/lib/station-2025.mjs`: the published m15artifact / m15land
  masters with the frame field at α 0 and the text box at × 0.68; bucket
  only; each WebP's alpha must equal its PNG's). The picture is ONE picture
  under the whole frame (`underFrameArt.artSlot`). The text box is a top
  band over 0–3 TIERS (`FrameProfile.tiers`): plain text in Scryfall's shape
  (`N+ | text` opens a tier) or `face_content.station` rows, read first
  (`resolveStationTiers`, `lib/cards/station.ts`); the P/T is on a drawn
  plate on ONE tier (the one the reminder names, else the last; rows may
  name another; never the top band, never without a printed P/T) — these
  profiles have NO `pt` slot and no text-alignment switch. ONE layout,
  `cardStation()` (`lib/cards/station-layout.ts`): one size for the box,
  the bands by PRINT'S RULE (`stationBands`, layout v54 — PR 2): the SAME
  air above and below every band's text, a tier never under its floor
  (168 / 180 px), 22 px more under a STAMPED last tier, whose text sits
  above the arch — the holofoil stamp's keep-out is part of the fit, never
  measure a band without it; lines by the rules layout, the plate a float;
  both renderers only draw it. The box is the box: before any text clips
  the bands give up their floor (never print's 14 px of air), then the
  badge and the plate are drawn smaller, and past the smallest size the
  bands share the box by their text — never a band over the type bar
  (`rules-no-clip.test.tsx` holds every band). Bands, badge discs and the
  plate are our own inline SVGs
  (`lib/cards/station-art.ts`: the same `data:` URL in preview, bake and
  finish masks; the ring and rim in the PRINTED ring's tone) drawn right
  after the frame, UNDER both finishes; numerals and digits go through the
  stat fit. Every piece's box is EVEN in HD px (whole px at 750) — never a
  half-px band edge, never `opacity` / blend modes on the washes. A
  correction of the look is a bump scoped to the pair
  (`STATION_BANDS_LAYOUT_VERSION`). In the creator the TIER EDITOR
  (`panels/station-editor.tsx`, on any frame with `tiers`:
  `isStationFrame`) is a VIEW of the ONE `rules_text` — the top band and
  0–3 tier rows read from the text, every change written back into it
  (`lib/creator/station-rows.ts`); never a second copy of the tiers in the
  form. The one thing the text cannot always say, the P/T on another tier,
  is `station_pt_tier` (null = as the text says). A save
  (`submittedRulesOf`, `stationFrame`): UNTOUCHED = the stored text byte
  for byte and `face_content` not sent (a plain-text card is given no rows
  by a retitle); EDITED / new / remix = the rows the text holds with the
  plate on the maker's tier, beside the canonical text — an edit never
  drops the rows (PR 1 did: one word typed moved the plate); a fourth tier
  line stays in the third tier's text and is named, a tier with no text or
  numbers that do not rise are asked for first. The server's typography
  pass reads the top band and each tier as boxes of their own. A card with
  a P/T and NO tier prints none: `frontDrawsPowerToughness(template,
  text)` (the note under the inputs, the card page). A NEW artifact /
  land follows its subtype onto the frame where it is verified
  (`SUBTYPE_DRESS_WORDS`, `subtypeFrameFor`: a card on a dress its
  subtypes still say keeps it); "Standard" is the way back.
  The AI (PR 3, `lib/ai/station-design.ts`): the designer is told print's
  shape and the lint holds an artifact that says Spacecraft / a land that
  says Planet to it as ERRORS (a tier line, at most three, rising numbers,
  the Station line word for word as the top band's last line); the autofix
  repairs spelling and order and never invents a tier, so
  `resolveGeneratedFrame` keeps a text with no tier OFF the frame
  (`stationFrameFits` — never weaken it: the frame prints a P/T on a tier
  only). A job that saves on the frame writes rows (`stationSaveFields`);
  a remix keeps its source's tiers and P/T tier; a fill of the rules text
  writes only a tier left empty (`mergeStationFill`) and keeps the P/T
  choice with its tier — and is refused at PLAN time, before any charge,
  when that tier comes back empty (`stationGapsLeftEmpty`). A new AI path that writes rules text goes through
  `designCards`, or it knows nothing of tiers. What every OTHER card saves
  through the AI jobs is pinned to main (`job-payloads-pinned.test.ts`).
  The tier editor's notes (`lib/creator/station-fit.ts`: text really cut,
  a band over the 600-character row limit) read the layout and the save's
  rule; nothing reads them back.
  Its Spacecraft DRESSES (step 2, PR 4): `extendedartstation` (the
  published extended-art masters with the same two cuts — the pack is M15's
  pixels below the type bar) and `m15borderlessstation` (the borderless
  artifact masters and crowned twins with m15station's box swapped in) —
  same `cardStation()`, never a second tier layout. A PICK, never followed
  (`SUBTYPE_DRESSES` `follow: false`, `isPickOnlyDress`: no new card, random
  pool or deck lands there; a card on one goes back to the frame it
  re-dresses); imports: extended art names its own frame once verified
  (exact), else the bordered one as its landing; borderless and the
  showcases land on the bordered frame once verified (`stationDress`), an
  edge-to-edge frame never being an import's landing. No dress for Planets
  (none printed); the viewport Planets / TRK #557 showcases stay 4.11's.
  `docs/FRAMES.md` "The Station frame".
- The Prepare frame (`prepare`; TODO 4.27): Secrets of Strixhaven's Prepare
  creatures — M15 with the SPELL on a page on the RIGHT, the creature's
  rules in the left box. It is the `adventure` capability on its own rects
  (both renderers draw the page from `profile.adventure`; `placeholderName`
  / `rulesHint` are the page's code-owned words), and the Prepare KIND, a
  creature: `TREATMENT_KINDS.prepare` + `EXCLUSIVE_KINDS` keep it and the
  adventure frame apart (same anatomy, never each other's cards). The spell
  is the second part ("Creature | Prepare spell", no picture of its own).
  Masters: PipGlyph's own derivation (`scripts/build-prepare-frames.mjs`,
  numbers `scripts/lib/prepare-2026.mjs`; the published m15 masters with the
  adventure master's page bars; bucket only). Imports: the Prepare kind
  keeps the spell, exact once verified — short of the frame in the card's
  colour, main's import (the creature kind on M15 / extended art, a legacy
  back: `finalizeImportMatch`); a textless printing keeps the
  creature kind; a spell page of another colour is the `part-colour` gap
  (4.26). An ADDITION: no bump, no sweep. Since 4.27b (additions, opt-in
  per card): the oval stamp's notch `prepareholostamp/<key>` (each master's
  own foot LIFTED along print's arch, `PREPARE_STAMP`; keyed by the MASTER
  drawn, `keyByMaster` — the two pair dresses' strips differ under the
  arch), M15's collector line, and the extended-art dress
  `extendedartprepare` (a MERGE of the published extendedart top and
  prepare bottom, `PREPARE_EXTENDED`; the Prepare kind's Variations pick —
  `TEMPLATE_SKIN_VARIANTS.prepare`, a layout template's skin is its kind's,
  never a default or stand-in — `isLayoutSkin`; an AI fill keeps it where it
  fits, `layoutFrameFitOf`; imports exact on it once verified, else
  `prepare`, else the creature on `extendedart`); the stamp's rules
  keep-out follows the arch (`PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE`). `docs/FRAMES.md` "The Prepare frame (4.27)" and "…stamp,
  collector line and extended-art dress (4.27b)".
- The saga creature (`sagacreature`; TODO 4.5d): FIN / FIC's "Summon:"
  cards — a saga whose type words say Creature (the card type or a
  supertype word, never `printed_types`), the Saga kind's third layout frame
  (`TREATMENT_KINDS` + ONE gate, `sagaCreatureFrameFits` in
  `lib/creator/card-kinds.ts`: the server's kind gate, the Frame tile, the
  import chooser, the reference validator, stand-in picks). Masters: OUR OWN
  composite (`scripts/build-saga-creature-frames.mjs`, numbers in
  `scripts/lib/saga-creature.mjs`: Card Conjurer's textured saga read from
  the pinned commit — never published as it is — rows cut, the reminder
  widened into a band, m15nyx's rows from the box down; bucket only). The
  profile is the saga's rail raised with its type bar 173 px, m15nyx's
  plates, and a SECOND box (`ChapterSlot.creatureBox`): the plain rules box,
  its text the lines AFTER the last chapter (`lib/cards/saga-creature.ts`,
  both renderers — a "•" line stays with its chapter; every other saga reads
  its text as before) and the flavour, ONE line centred on print's row
  (`alignSingleLine: "centerAny"`, `singleLinePadPx`), the plate a float
  (`TextSlot.ptFloat`). In the creator that text is the saga editor's
  **Creature abilities** field on this frame only (`saga_creature_text`,
  form-only; `submittedRulesOf` `sagaCreatureFrame` writes it after the
  chapters — never a field of its own in the row). Its PROFILES entry adds
  the Universes Beyond triangle stamp and M15's collector line (opt-in). An
  ADDITION: a new saga follows its Creature word onto it where verified
  (`sagaCreatureFrameFor`: the creator's effect, the AI deck), a stored saga
  keeps its frame; imports `saga/creature/2015`, exact once verified, the
  borderless printings nearest as before. The ▼-back variant and the
  colourless see-through are part B. `docs/FRAMES.md` "The saga creature".
- The Universes Beyond frames (`m15ub`, `m15ubartifact`, `m15ubland`; TODO
  4.25): STORED templates of their own (owner 2026-10-13), skins of m15 /
  m15artifact / m15land under Variations — never a render-time pick, never
  a new card's default, never an era standard. Card Conjurer's accurate
  'Universes Beyond' pack (the M15 pack's geometry and masks, smooth
  streaked art), so each profile is its M15 twin's slots with the pack's
  masters, pair masters and plates, the Universes Beyond crown band
  (`UB_CROWN`, `m15ubcrown/*`: no `c` key) and the TRIANGLE stamp's notch
  (`M15UB_HOLO_STAMP`, `m15ubholostamp/*`: CC's piece resampled once, the
  triangle cut clear, our own triangle art from `holoStampArtOf`). On a
  TRIANGLE frame `"auto"` stamps EVERY rarity, as print does (owner Round
  57; layout v56, a sweep scoped to the three frames): `holoStampWanted`
  reads the slot's shape, and the face's tone is `holoStampToneOf` — the
  flat MATTE grey on a common or uncommon, our silver at the hologram's
  printed level on a rare or mythic, whatever "on" value asks for it; an
  oval frame's rule (a rare or mythic) and its one oval are untouched. The
  pack's colourless frame is missing from Card Conjurer's tree: `m15ub/c`
  is print's SEE-THROUGH frame all the same (owner Round 57; layout v57,
  scoped to that one master) — the accurate pack's see-through `new/c.png`
  (m15/c's edges and ALPHA, value for value) with the older Universes
  Beyond pack's paper as colour only, paper onto paper
  (`UB_SEE_THROUGH_LAYERS`), `underFrameArt` for `c` as m15, its own
  colourless crown and notch keys; the artifact and land frames keep their
  opaque colourless masters (keyMap c → a / l). Three
  of the pack's tones are TONED onto print before the first tick (owner
  Round 57): the green bars, the gold bars and gold box, the land-grey
  bars and box — `UB_PRINT_TONES`, applied to the pack FILE as the importer
  loads it (`CC_SOURCE_TONES`: g / lg, m / lm, l), so every master drawn
  from one follows; never tone one master of a family by itself, and once
  a colour is ticked a tone change is a correction (bump + sweep).
  `frame_style.stamp` keeps its meaning on them — "auto" is a rare or
  mythic although print stamps every rarity there; every "on" value draws
  the frame's own shape. An ADDITION: no bump, no sweep, no badge; an
  import names one only once verified in the colour (`ub/2015`:
  `security_stamp: triangle`, released 2021-11-01 or later, a plain
  black-bordered spell, artifact or land — never a Vehicle, a layout, a
  colourless non-artifact spell or the etched run, which keep their frame
  with the `universes-beyond` gap). `docs/FRAMES.md` "The Universes Beyond
  frames".
- The older full-art basics (`m15fullartlandzen`, `m15fullartlandsnc`,
  `m15fullartlandthb`; TODO 4.40 / 4.41): STORED templates of their own in
  the Full Art set, basic lands only (`BASIC_ONLY_TEMPLATES`), from Card
  Conjurer's ZEN, SNC and THB basic packs (bucket only) — measured on every
  printing first: the ZEN bar re-cut 7 px down and the stone the pack's own
  colourless frame under every colour (`ZEN_BASIC_RECUT`), the SNC bar 13 px
  and its medallion 18 px up (`SNC_BASIC_RECUT`, `recutBarAndMedallion` in
  `scripts/lib/cc-frames.mjs`); the slots ride the same px
  (`ZEN_BASIC_BAR_DY_PCT`, `SNC_BASIC_*_DY_PCT`). The split bar is 3.24's
  `type.split`, the medallion's symbol the template's own image
  (`SPLIT_BAR_SYMBOL_RECT`), the plain bar's symbol slot `"none"`. An
  ADDITION: no bump, no sweep, no badge; imports keep landing on
  `m15fullartland` until a template is verified in the colour
  (`onceVerified`: exact on the stone ring, SNC, the plain bar; nearest for
  MH1's snow bars, BRO, MID / VOW's dark bars and ZEN / J14).
  `docs/FRAMES.md` "The older full-art basics".
- The 1997 frame (`retro`, `retroland`; TODO 4.10a, layout v46) is the
  ORIGINAL cards of 1996–2003, never the 2006 timeshifted redrawing or the
  2021+ reprints (imports of those are `nearest`: the `timeshifted-frame`
  and `reprint-colours` gaps). Masters: the frames bucket —
  Card Conjurer's Seventh drawing re-cut edge by edge PER KEY and toned
  region by region (`scripts/lib/print-cut.mjs`, the numbers in
  `scripts/lib/seventh-1997.mjs` as DATA: no scan is read by a build), gold
  from the MSE file `scripts/frame-inputs/retro-m-mse.png` cut with the same
  edge map. Text: white with a hard shadow as PER-KEY ink (`inkByColorKey`,
  never a band's `shadowCss`: it would emboss the pips), sizes from
  `RETRO_*` in `lib/cards/typography.ts`, the type line and the artist line
  in MPlantin — no font file is added for an era; the P/T is set against its
  RIGHT edge as printed (`align: "end"` + `endKerned`: two digits grow to
  the left at full size), never centred. A CENTRED footer declares
  `FrameProfile.copyrightSlot` (`lib/cards/copyright-slot.ts`): the mark
  sits there on display (not on the border) and a paid clean download
  prints the card's `footer_text` there — without the slot that text is
  dropped. A frame's era symbols are `symbolStyle` (`"1997"`: flat discs,
  `tap-4ed`), a correction, never a per-card switch. `docs/FRAMES.md` "The
  1997 frame".
- The 2003 frame (`modern`, `modernland`; TODO 4.10b, layout v47) is the
  frame's LATER drawing, CHK 2004 → JOU 2014 (8ED → 5DN draw the title bar
  6–8 px differently: no second master, no import gap). Masters: the frames
  bucket — Card Conjurer's 8th drawing re-cut with ONE piecewise-linear cut
  for all fourteen and toned through the pack's own five masks
  (`scripts/lib/eighth-2003.mjs`, DATA: no scan is read by a build), its
  P/T plates on a gain per colour at the printed box (`pt.plateRect`); `c`
  is the artifact frame, `m` the three-colour look (two-colour gold is
  4.6h). Text: dark, no shadow, `MODERN_*` sizes (EVEN at HD — an odd size
  rounds wide at 750 px); the P/T is CENTRED on the plate's face as printed
  (never the 1997 frame's `align: "end"`). The footer is two left-aligned
  lines: the brush (`FrameProfile.footerBrush`, our own path in
  `lib/cards/footer-brush.ts`) and the bare credit over a `copyrightSlot`
  with `startPct` — a profile with a © slot never prints the custom footer
  text on line 1; the footer's ink map (white on the black frame and on
  lands, v44) covers the brush and the slot. `symbolStyle: "2003"` shadows
  the COST discs (66 px; 6 px down, 2 px left) and leaves rules pips flat
  (`inlineSymbolStyle`: an inline pip never reads a style's shadow
  directly). `docs/FRAMES.md` "The 2003 frame".
- The 1993 frame (`agclassic`, `alphaland`; TODO 4.10c, layout v48) is the
  ALPHA / BETA printing (proof 3: 118 scans), text and symbols only — its
  MSE masters stay in git, untouched. Sizes are `ALPHA_*` in
  `lib/cards/typography.ts`: the name in Beleren, the type line, the credit
  and the P/T in MPlantin (their printed face; no font file is added), the
  P/T set against its RIGHT end as 1997's. The name and the type line
  START where the prints start them (owner 2026-10-08: ink at 109 and
  155 px — `ALPHA_TITLE_LEFT_PX` / `ALPHA_TYPE_LEFT_PX` are pen positions,
  EVEN, and the name band ends on 90.999 %: the 750 px bake rounds left
  and width apart, and anything else moves the cost row or the set symbol
  a pixel there), and the set symbol's box is PINNED (`ALPHA_SET_SYMBOL_BOX_PCT`,
  49.5 px — it does not follow the type line). The credit is the printed
  `Illus. <artist>` — never a © of our making, never a Wizards line — and a
  card with NO artist prints no credit at all (`footer.noArtist: "omit"`:
  `footerArtistLine` → null, neither renderer draws the footer; this pair
  only, and only beside a `copyrightSlot`). It shares ONE
  line with the P/T, so the © slot is the black border under the frame
  (`copyrightSlot.endPct`: the mark where it always sat, a clean download's
  `footer_text` there). `symbolStyle: "original"`: flat discs with their own
  gap (`costGapDiscs`), and the five COLOUR symbols as the 1993 drawings —
  frames-bucket IMAGES (`manaoriginal/*`, Card Conjurer's: never git), a
  whole pip each (`symbolImages` → `manaGemSpec` `kind: "image"`), which
  `frameAssetPathsFor()` warms through `symbolImagePathsIn()` (an unwarmed
  one bakes as a transparent pixel; a missing one fails the bake); an
  owner's custom pip still wins. A test that bakes the pair offline with a
  colour pip serves `serveStandInSymbols()`. Imports from Fallen Empires on
  are `nearest` (the `two-line-footer` gap). `docs/FRAMES.md` "The 1993
  frame".
- The white border (TODO 4.30): `frame_style.border` (`"white"` or absent =
  black; the form and an edit's patch also say `"black"`, never stored) — a
  card's own switch on the four frames whose `PROFILES` entry declares
  `whiteBorder` (`retro`, `retroland`, `modern`, `modernland`; never the
  1993 pair — other drawings on another box, its own step). A NEW card
  starts BLACK (with the text alignment, the other anatomy key no default
  stamps), an import follows `border_color`. ONE inline SVG
  (`lib/cards/white-border.ts`: the white over the master's own black
  border, the black keyline — 3 px on 1997, 4 px on 2003 — drawn INSIDE the
  frame box) is the same `data:` URL in the preview, the bake and both
  finish masks; square corners fill the white (`squareCornerFillsOf`), a
  bleed copies it out, and a tile backs the picture with it. TWO whites
  (owner 2026-10-12): `#ececea` on every DISPLAY surface (stored bake,
  thumb, OG, preview, the plain PNG round or square — the free Square too)
  and pure `#ffffff` in a PRINT file, i.e. everything
  `lib/render/card-print.ts` makes (ring, squared corners, bleed) — the
  `"print"` medium is passed by that path alone (`renderCardImage`'s
  `printLayer`, `squareCornerFillsOf(card, "print")`); never read a white
  as a literal. The keyline is the same black in both. No ink sits on these frames' borders: a profile may
  declare the piece only beside a © slot inside the frame (a test holds
  it). Never a sweep or a bump; `docs/FRAMES.md` "The white border".
- Text alignment (TODO 4.21e): `frame_style.rulesAlign` (`"center"` or
  absent = left; the form and an edit's patch also say `"left"`, never
  stored) — a card's own choice on EVERY frame with plain rules boxes
  (`profileOffersRulesAlign`: not `textless`, the saga's `chapters`, a
  walker frame's `loyaltyRows`; a profile opts out with `rulesAlignSwitch:
  false`). A NEW card starts LEFT, an import stays left (owner 2026-10-07)
  — the one anatomy key no default stamps. Centred = every line of every
  rules box of the card (rules, reminder, flavour; halves and faces alike)
  on its box's centre: `RulesLayoutInput.align`, a whole-px indent per line
  per target, at EXACTLY the size, breaks and vertical positions of the
  left-aligned layout (`fitRulesLayout` fits the left twin first). A line
  whose centred place would land on a drawn keep-out or float (plate,
  stamp arch, shield, strip, reverse P/T) is HELD SHORT of it
  (`heldLineIndentPx`: the nearest clear indent, `HELD_LINE_AIR_PX` of air
  where there is room) — never a size step: Centred never sets a text
  smaller than Left and never clips one Left fits (owner 2026-10-07).
  Both renderers pass the card's value through `rulesAlignOf` and only
  draw the indents. A new template offers
  it by default — `rules-align.test.ts` names the ten that don't (the station pair and the textless promo pair among them). Never a sweep or a bump; `docs/FRAMES.md` "The text alignment".
- The nickname (TODO 6.3, migration 0141): `cards.nickname` (NULL = none,
  never blank — BLANK_IS_NULL_TEXTS; Scryfall's `flavor_name`, the front
  face's on a multi-face printing) prints in the title bar and the card's
  own `title` in MPlantin italic on a dark plate hanging from the art
  window, as every black-bordered flavour-name printing does — ONE module,
  `lib/cards/nickname.ts` (`resolveNickname`: the plate is our own inline
  SVG, rim = the master's pinline colour, a pair's two over the 40 → 60 %W
  ramp, drawn with the frame and in both finish masks; the name line steps
  down in even HD px, then one "…"). Declared per PROFILES entry
  (`FrameProfile.nickname`: the M15-skeleton frames whose window opens at
  238 px — never devoid, station, tokens, borderless; the borderless plate
  is a follow-up), FRONT face only (`backPreviewData` clears it). A card
  without one draws byte for byte as before: a preview / row / patch names
  the key only when it holds one, a new card's insert only then, and an
  edit sends it only when the field changed (`nicknameBaseline`, the
  footer's rule). `title` stays the card's name everywhere else (slug, H1,
  canonical, decks, hubs, AI); the page `<title>` is "Name (Nickname)"
  (`cardTitleWithNickname`), the JSON-LD `alternateName`, the line under
  the H1 "Printed as" only where the frame prints it, else "Also known as"
  (`nicknamePageLine`); an idea or an AI fill that names a new card or a
  REMIX forgets the nickname of the card before it, and a remix renamed by
  hand clears it ONCE on leaving the title (`clearRemixNicknameOnRename`;
  an edit keeps it); gallery search
  (search_vector weight A + the ILIKE half) and My Cards' search read it. A
  print-typography "name" field (front only).
- CARDNAME / `~` (TODO 6.2): `~` and the capitalised word CARDNAME in rules
  text draw as the name the title bar PRINTS (the nickname where its frame
  draws it, else `title`; a second face / back its own name) — at RENDER
  time, never at save (the stored text keeps the token, so a rename
  follows): ONE function, `withSelfNames` (`lib/cards/self-name.ts`), called
  on the card each renderer is handed before any layout reads the text
  (rules, walker / saga / station rows, the back's rules; never flavour);
  the card page's description reads `storedRulesTextWithSelfName`. A card
  stored before it with a literal token is flagged by migration 0142
  (`frame_style.selfName: "literal"`, drawn as typed); EVERY rules area
  holding a token (rules, walker / saga rows, station tiers, a back's /
  second part's rules) offers "Print ~ as the card's name"
  (`SelfNameLiteralNote`: one way — an edit's `frame_anatomy.selfName:
  "name"` — and it hands the focus on as it goes). Every new card has no
  key. A face with no name keeps its `~`. An imported FLAVOUR-NAME
  printing writes its own name as `~` (`oracleSelfNamesAsTokens`: the whole name; a legendary's short form only
  where the printing's AND the landing frame print the plate; never a rules
  word or keyword — `lib/cards/card-names.ts`, shared with the AI remix;
  a plain import keeps Oracle's name). CARDNAME is a word: no letter, digit or
  underscore on either side (Unicode's in TS; 0142 the same as
  `(?<![[:alnum:]_])CARDNAME(?![[:alnum:]_])`). The rules
  toolbar's words row (`RulesSymbolToolbar selfReference`): `~`, the
  card's "this …" (`selfReferenceFor`) and the keywords with their reminder
  text only when ticked — `lib/cards/keyword-reminders.ts` is DATA, the CR
  rule numbers sourced and dated (`CR_SOURCE`).
- Each part in its own colour (TODO 4.26): `frame_style.partColor` (an
  addition, drawn only `=== true`; a new card on split / aftermath /
  prepare starts on through `useSecondPartColorFollow` — never
  NEW_CARD_ANATOMY — an import follows the printing, a stored card keeps
  its look) with the second part's colour on `back_face.color_identity`
  (`partColorFromCost`, `lib/cards/part-color.ts`; empty = the card's).
  A split / aftermath card's `color_identity` stays the WHOLE card's (M2:
  Fire // Ice is red + blue); its first half's frame colour is
  `frame_style.firstPartColor` (frame data, never read for behaviour; the
  gate reads `frameGateColors`). Imports and AI remixes take the look on
  only where both parts are verified (`partColourVerdict`, M1) — else off,
  never a refused save after the art.
  Split / aftermath draw the second part's master past a hard seam in the
  masters' black gutter (`partColorSeam`, `cardFrameSplit` — the
  twoColorSplit machinery on an axis, both renderers, both finish masks,
  the preload); the Prepare spell's page is a `partPage` overlay
  (`prepare/page/<key>`, `partPageKeyOf`) over the creature's master or its
  pair master. The second colour is gated in its own colour
  (`partColorGateError`). Adventure and flip: not built (owner decision).
- The art's automatic fit (TODO 3b.18): a picture that lands on a card
  (upload, a real card's art, an import, an AI picture) takes
  `fitArtToWindow()` (`lib/cards/art-fit.ts`: fill the window, show the
  centre) — never three literal numbers — and is "untouched" exactly while
  its position EQUALS that fit (`isArtFitted`; no flag, no column). Only an
  untouched picture is re-fitted on a frame / kind / colour / face change; a
  hand-set one is carried (3.23) or left alone, and a stored card's numbers
  are never rewritten by opening it. A zoom-out STOPS AT 100 % (owner
  2026-10-12: under it the window is part empty on the card): every hand
  zoom goes through `stepArtZoom` (floor = `min(current zoom, 1)`, so a
  stored zoom under 100 % opens as stored, never goes lower and only climbs)
  — a creator rule; the validator, the database and the renderers keep
  0.5 – 4, and no automatic path (landing = the fit, carry = the maker's
  zoom) makes one.
- Print typography (TODO 6.11): `printTypography(text, field)`
  (`lib/validation/print-typography.ts`, pure, idempotent) turns what a plain
  keyboard types into what a card prints — curly quotes and apostrophes
  (`'90s`, `{T}'s`), ` - ` / `--` → an em dash, a rules line's leading `- ` /
  `* ` → `•`, a flavor line's leading `-` → the attribution's `—` — and never
  reads inside `{…}` or a URL. It runs in the creator when a text field loses
  focus (one `onBlur` on the form; an AI fill, an idea and a Scryfall import
  land converted through `printTypographyPatch`) and on the server in BOTH
  card actions: a new card whole, an EDIT only in the fields whose text the
  save changes (`withPrintTypographyUpdate` — a stored card never changes
  where it wasn't edited; never a migration, bump or sweep). A character it
  may introduce is listed in `PRINT_TYPOGRAPHY_CHARACTERS` and must have INK
  in every face that draws that field (a test reads the font files) — so no
  U+2212: MPlantin's is an EMPTY glyph, rules text sets it as a hyphen. A new
  text field of the card is added to `typographyFieldOf` and the server
  helpers together. Stored text now holds ’ “ ” — where people TYPE ' " -:
  anything that matches a typed string against a title or a name folds both
  sides with `typedForMatching()` (My Cards' search, the deck's card picker,
  the deck copy-limit names) — the gallery's SQL title search folds the same
  six characters (migration 0136; a test holds the two tables together).
  Never compare a query with a stored title character for character.
- Automatic tags (owner 2026-10-30): a NEW card's Tags field follows what
  its rules text and subtypes suggest — every face's and part's (the back,
  a split card's second half), its NAME never ("Wrath of God" is no God) —
  ONE function, `autoTagsFor` (`lib/cards/auto-tags.ts`: a fixed vocabulary
  of plural tribes, CR keywords and themes, never a word the maker typed; a
  tribe from rules text only in a tribal phrase — "Goblin creature token",
  "Elves you control", "other Merfolk", "Dragon spells"; reminder text read
  as nothing; ≤ 6) — until the field changes under anything else (the
  maker, a challenge toggle, an AI fill that writes tags;
  `stepAutoTagsFollow`, `lib/creator/auto-tags-follow.ts`, wired by
  `useAutoTagsFollow`, which reads the field through `getValues` — a
  StrictMode re-run must not end it); Start over starts it again. Create
  mode only and never a deck-card proxy (`/create?deckCard=`, whose
  "unchanged" baseline is the reset after its import): an edit never
  rewrites a stored card's tags, a remix keeps its parent's, and the AI
  jobs and the deck remix save what they did (no server-side tagging — it
  would put back a tag the maker removed). A creator import is a new card:
  it follows.
- Flavour's upright words (layout v71): a balanced `*…*` pair on one line of
  FLAVOUR text is Scryfall's markup for words the print sets ROMAN inside the
  italic — stored as typed (no migration), read ONLY through
  `lib/cards/flavor-markup.ts` (`flavorSegments` → the rules layout's
  `flavorRuns`, measured in the roman face; the stars never drawn;
  `stripFlavorMarkup` for a plain-text surface; `hasFlavorMarkup` = the
  sweep's scope, mirrored by the owner's SQL). Any other star is printed;
  rules text has no markup. Print typography never converts a star and
  reads a quote through them.
- The display face is Beleren Bold P1.01 with its 21 collision-guard kerns
  (K→y, R→j, f→l, f→i…) at 0 (layout v72; print sets them tight): the pairs
  are DATA in `lib/cards/display-kerning.ts`, written into BOTH
  `public/fonts/Beleren-Bold.ttf` and `.woff2` by
  `scripts/fix-beleren-kerning.mjs`, then `generate-font-metrics.mjs`. A
  re-import of the font goes through that script (the unpatched pack file
  fails `tests/unit/cards/display-kerning.test.ts`); a pair joins the list
  only with print evidence, as its own bump. An accented right letter is its
  own record, zeroed only where listed (fí; fì / fî / fï keep the font's
  wider kerns). A scan that judges stored bakes against the card scopes
  without baking selects `SCOPE_CARD_COLUMNS` through `selectScopeColumns`
  (`lib/cards/bake-select.ts`): a scope column it leaves out reads as
  "owes the bump" on every card.
- An EDIT never changes a field its maker did not touch (#524 + its
  follow-up; `tests/unit/components/creator-clear-fields-save.test.tsx`,
  `creator-footer-and-create-clears.test.tsx`). The editor resends the
  revisable fields as stored; an EMPTIED optional text travels as `null`
  (`updateCardSchema`), which clears the column — omitted leaves it alone,
  and a blank `""` sent to either card action is NULL in the row
  (`withBlankTexts`, `BLANK_IS_NULL_TEXTS`; never `printed_types` or
  `footer_text`, where "" and NULL mean two things). `footer_text` has THREE
  values (migration 0090): NULL = the profile default, resolved at download
  time; "" = explicitly none; a text = the card's own — the field shows the
  default on a NULL row, so an edit sends it ONLY when it differs from what
  it opened with (`footerBaseline`: what the form last SET the field to —
  it follows a save of the session, never prop churn). A walker's / saga's rows save through `submittedRulesOf`
  (`lib/creator/structured-rules.ts`, the preview's rules text too): the
  hidden textarea's copy of the rows never travels once they are all
  removed (new card, remix and edit alike), and on an edit rows that still
  read as the rows the form OPENED with keep the stored text byte for byte
  (the rows serialize canonically — "-2:", "I, II —" — and a text spelled
  "−2:", or the NULL of a card stored with its rows alone, must not be
  rewritten by a retitle). "Read as they opened" counts EVERY row that
  holds a text — a saga row with no chapter number too (a marker the editor
  can't read, "XI —"): removing or editing it is an edit, and so is
  dropping the stored marker a row carries (below). The one write an
  untouched edit still makes is the dual write: a walker / saga stored as
  plain text gains `face_content` — which the renderers read BEFORE
  `rules_text` (`resolveLoyaltyRows` / `resolveSagaChapters`), so it is
  skipped where the rows cannot say all the text does (that unnumbered
  row): the card stays plain text and draws as it did. The dual write is
  made only where the rows pass the server's `faceContentSchema` (6 rows,
  chapters I–VI, a three-digit cost, 600 characters a row, a 400-character
  intro — limits that are NOT raised for it) AND resolve to what the stored
  card draws today; else `keepsStored`: the text byte for byte and
  `face_content` NOT SENT (a seven-line walker, a chapter VII, "I, XI —",
  "II, I —", which the rows would re-order) — main refused the first two
  whole and redrew the last two on a retitle. `face_content` is left out
  only until a save of the session has gone out for that card
  (`savedUnderKey`: until the refresh lands "untouched" is read against the
  card as it OPENED, so the opened value is sent), and an edit's form schema
  (`cardFormSchemaFor(opened)`) checks nothing about rows that read as they
  opened. EDITED (or new — a remix) past the limits, a card saves as PLAIN
  TEXT: the rows serialized, `face_content` null, which both renderers
  parse back into the same rows (the editors say so under the rows); the
  server still reads each line as a row — one the stored card holds keeps
  its characters (`plainTextRows`, `lib/validation/print-typography.ts`).
  A saga row with a text and no chapter number is never dropped by a save:
  `sagaRowsNeedingNumber` puts "Pick a chapter number for this row, or
  remove it." on it and the save waits — never on an untouched edit. A
  save a row's chapter numbers blocked moves the focus to the first such
  row's chapter group (`data-field-anchor` `saga_chapters.N.numerals`,
  through `goToField`) and lists the rows above Save as links
  (`SaveBlockedRowsLine` — never a live region: the row's `role="alert"` is
  the one announcement). An EDITED saga save keeps the MARKER of every row
  whose numbers were not changed (the 3b.25 follow-up): the editor holds a
  chapter as numbers and writes them ascending, so a row whose stored
  marker says more — an order ("II, I —"), a numeral with no toggle
  ("I, XI —", "XI —") — CARRIES it (`SagaChapterFormValues.marker`, set by
  `sagaEditorRows`, `lib/cards/face-content.ts`, only where the numbers
  alone would not give it back; an ordinary row has none) and
  `submittedRulesOf` writes it while the numbers are still the marker's own
  (`keepsStoredMarker`), whatever else was edited — the row's text
  included: "II, I" as `face_content` numerals `[2, 1]` (the renderers read
  the array's order), a marker the rows cannot hold as PLAIN TEXT
  (`serializeSagaMarkers`; the server's `plainTextRows` reads it by marker).
  Numbers CHANGED on a marker that mixes numerals the toggles show with one
  they can't ("I, XI") are never saved short of it without a word:
  `sagaRowsLosingMarker` blocks on the row until they are put back or the
  maker presses "Drop XI" (the row's `marker` cleared — an edit by itself);
  changed on an order-only marker, or picked on one with no readable
  numeral ("XI —"), the numbers picked are the row's — and a row a save
  wrote from its numbers FORGETS its marker in that save (onSubmit, before
  its `reset`), never only at the refresh: put back inside that window, the
  numbers wrote the opened marker again ("XI —" back on a row just saved as
  "II —"). The keyed same-card reset keeps field errors (`keepErrors`): the
  refresh of the save before must not wipe a blocked Save's message. Never write a saga
  row's line from its numbers alone — `sagaRowsOut` is the one answer (a
  kind switch and the AI's context read it too; a kind switch keeps a held
  row's unreadable numeral too, `sagaRowsForKindSwitch`, TODO 3b.30). A walker whose loyalty
  badges touch on its frame gets a note under its rows
  (`lib/creator/walker-crowding.ts`: read from `layoutProfileLoyaltyRows`,
  never a count compared — 9 one-line rows on `m15pw`, 11 on the tall
  borderless box; nothing is blocked, no renderer reads it).
- Creator fields and chips for a keyboard and a screen reader (TODO 3b.10 /
  3b.19 / 3b.24): a `FieldGroup` (`components/creator/field-group.tsx`) has
  ONE of three shapes, all the same look. `field` (default): one text input /
  select / textarea in a `<label>` — its NAME is the caption alone, the
  helper or the error that replaces it is its DESCRIPTION (`aria-describedby`,
  an error also `aria-invalid`), given to a plain first child automatically
  and to anything else through a function child (`{(aria) => …}`); never let
  the helper back into the name. `control`: ONE control with a role of its
  own (a chip row, the rules editor under its toolbar) — NO role on the
  wrapper, the control named for the field: a group around one control says
  the field twice. `group`: a SET of controls with names of their own (the
  cost picker, chips beside an uploader). A field error is never an alert of
  its own — a blocked save focuses the refused field, a server refusal is the
  form's one alert. A `ChipGroup` chip that cannot be picked is
  `aria-disabled`, never `disabled` (reachable, its reason in its name; unit
  tests ask `chipOff()`, `tests/unit/helpers/chip.ts`, which also refuses an
  off chip that still has a click handler — `aria-disabled` alone stops
  nothing, so never give an off chip an `onClick`); a single-select row
  is one tab stop whose arrow keys move the focus and never pick (owner
  2026-10-13: Space / Enter picks; the stop is the focused chip while the
  focus is in the row, the picked one otherwise). A control that removes
  itself hands the focus on (`useRowFocus`; the Publish step's deck
  quick-create both ways) — and a button inside a `<label>` that removes
  itself on click cancels that click (`preventDefault`), or WebKit forwards
  it to the label's control. The Power /
  Toughness inputs are described by the "frame draws no P/T" note while it
  shows (`usePtNotDrawnNoteId`).
- Notifications are push, not pull: `notifications` is on the
  `supabase_realtime` publication (migration 0075) and
  `components/notifications/realtime-alerts.tsx` subscribes to the signed-in
  user's rows (toast + bell badge + debounced `router.refresh()`; polls the
  unread count if the socket fails). Anything that should alert a user or
  admin in real time just needs a `notifications` row — DB triggers for the
  social/feedback/message kinds, `notifyUser()` in `lib/admin/user-actions.ts`
  for credit grants, comp plans and card-limit overrides. New kinds go in the
  type CHECK + `lib/notifications/describe.ts` (the ONE copy source for bell,
  page and toast). ONE stream per user per tab: every mounted `RealtimeAlerts`
  queues through `lib/notifications/stream-claim.ts` and only the holder
  subscribes — the browser client hands back the channel a topic already has,
  so a second `.on("postgres_changes")` throws once the first has subscribed
  (and binds twice, toasting twice, before that). Nothing in that effect may
  throw (it reaches the root error boundary and replaces the page). A stream
  that is down — it can't be set up or joined, or the server closed it —
  polls, and looks again after a pause (30 s doubling to 5 min): a freshly
  read session token for the socket, and a fresh channel only if it holds
  none (never a replacement for one the client is still retrying). The
  server closes a channel whose token expired — any tab left in the
  background past the token's lifetime — and the client never rejoins a
  closed channel by itself.
- AI image generation goes through the **Vercel AI Gateway ONLY** (FLUX for
  text-to-image, Gemini for the "AI remix" i2i) — `lib/ai/image-gen.ts` has no
  direct-OpenAI path. `AI_GATEWAY_API_KEY` is required for any image flow; a
  missing key returns a clear error, never a silent gpt-image-1 fallback.
  Text-to-image is HEDGED by ONE backup gateway model (owner 2026-10-28:
  `bfl/flux-2-pro`, started at 60 s or on the default's failure, once per
  picture, inside the caller's budget — `generatePlainImage`); one credit per
  picture whichever model paints, `image_model` on the step. Every art prompt
  carries the "fully clothed" line (added at that one door), and violence is
  allowed in art — the ladder softens nudity / sexual words only.
  `OPENAI_API_KEY` is moderation-only (the omni-moderation scan on human
  uploads, and on every AI picture's BYTES before it is stored, with the
  SEXUAL categories alone and one 10 s cap, no retries — `persistGeneratedArt`:
  flagged → never stored, `art_blocked`, refunded once; fail open). AI batch jobs (deck/set/card) step through `patch_job_step`
  (atomic per-step write); the client runs a few steps in parallel, so never
  reintroduce a whole-`steps`-array overwrite. Credit settlement (0106):
  `patch_job_step` stamps `credit_ledger.settled_at` (via `settle_spend`) in
  the same transaction as a step's done-write and the sync idea routes call
  `settleSpend()`; the reconcile cron refunds every aged UNSETTLED `spend:`
  row and never reads job rows — a new charged flow that forgets to settle
  its ref hands the credit back to the user a day later.
- Shared helpers — never re-implement: `isUuid`/`randomId` (`lib/ids.ts`),
  `rateLimitedResponse` + `cronRouteGuard` (`lib/api/*`), date strings
  (`lib/format/dates.ts`; a BILLING date a subscriber sees is `<LocalDate>` /
  `<LocalDateText>`, `components/ui/local-date.tsx` — the viewer's own day, as
  Stripe's portal shows it; an admin page prints `formatUtcDate`, labelled), `lookupUsername`/`revalidateProfilePage`
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
  `describeCapacity()` feed the `CapacityNotice` warnings (creator, in-deck
  AI panel, My Cards meter), the jobs route refuses an
  over-cap batch with `code: "CARD_CAPACITY"`, and `createCardAction` maps the
  trigger's `card_capacity_exceeded` to the upgrade prompt. A batch step that
  hits a plan limit fails with `error_code` (`CARD_CAPACITY` /
  `INSUFFICIENT_CREDITS`); the runner stops on it and opens the matching
  modal, and retries check `/api/me`'s `cardCapacity` before the credit
  confirm. Change the caps in both places together. Decks are unlimited on
  every plan (owner 2026-10-29, after shipping and removing a private-deck
  cap: 0145 added it, 0147 drops it; `tests/unit/decks/no-deck-cap.test.ts`
  holds it) — paid conversion is saved-card capacity; never reintroduce a
  deck cap without the owner. A deck's 500 entries (0143) are a safety
  limit, not a plan cap.
- SEO contract for public pages: a missing or unreadable entity answers a
  real HTTP 404 — call `notFound()` BEFORE any Suspense/loading boundary (the
  global `loading.tsx` lives in `app/(app)/` for exactly this reason; the card
  route checks existence in its segment `layout.tsx` so its skeleton can still
  stream) and again in `generateMetadata` (detail queries are React `cache()`d,
  so it costs nothing). Next draws that 404 INSIDE the route group's layout,
  so every group has its own `not-found.tsx` — `NotFoundContent`, no shell;
  only `app/not-found.tsx` (unmatched URLs, root layout alone) wraps it in
  `AppShell`. A group without one falls back to the root file inside its own
  layout: two headers, ribbons and footers, and two headers' worth of client
  islands (`tests/unit/content/not-found-chrome.test.ts`). Every public
  detail page sets a self-canonical,
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
  (`max(updated_at, rendered_at)`), never `updated_at` alone. An EDIT that
  a deferred re-bake follows clears the row's render pointers and stamp in
  its OWN update (`REBAKE_PENDING_RENDER`, `lib/cards/bake-core.ts`): until
  the bake lands every surface draws the live preview of the saved row,
  never the bake of the card as it was, and the save bake therefore always
  removes a one-faced card's `.back.*` names. The revalidation an `after()`
  callback asks for is SKIPPED by Next for every path the action already
  revalidated, so a deferred bake revalidates with `afterBake: true`
  (`lib/cards/revalidate.ts`): the ISR'd tile pages by their PAGE tag
  (`BAKED_TILE_PAGE_ROUTES` — file-system routes, route group included; a
  new ISR page that draws card tiles joins the list), which is not skipped —
  best effort, never relied on for correctness.
- Theme: the `cardforge-theme` cookie (dark / light / system; none = dark).
  The root layout reads NO cookies (every route stays static/ISR-eligible):
  server HTML is always `data-theme="dark"` and the `<head>` no-flash script
  corrects it before paint. An inline `<script>` in a layout only runs in
  HTML the SERVER sent: a document React renders in the browser — every
  `notFound()` above the Suspense boundaries (Next answers an empty
  `<html id="__next_error__">` shell), an error thrown there, a root
  hydration React gives up on — gets the layout's "dark" and a script that
  is never executed, so `<ThemeRestore>` (`components/layout/theme-restore.tsx`;
  a LAYOUT effect: same commit, before paint) re-applies the saved theme.
  ONE resolution in two forms, `noFlashScript()` and `resolveSavedTheme()`
  (`lib/theme-shared.ts`), held together case for case by
  `tests/unit/lib/theme-resolution.test.ts` — never read the cookie or
  `prefers-color-scheme` anywhere else.
- Fonts are SELF-HOSTED as OFL variable woff2 files under `app/fonts/*` with
  their licences: Geist Sans/Mono subset to latin + latin-ext
  (`scripts/subset-geist.mjs` regenerates them from the `geist` package),
  Cinzel from google/fonts; card/OG fonts are committed `.ttf`s under
  `public/`. Never import `next/font/google` — it
  fetches fonts.googleapis.com at BUILD time and the 2026-09-22 production
  deploy of a green merge failed inside that loader
  (`tests/unit/content/fonts-self-hosted.test.ts` guards it). Same rule at
  RENDER time: Node Satori renders (the bake, node OG images) go through
  `lib/render/satori-png.ts` / `lib/og/image-response.ts`, never next/og's
  `ImageResponse` (it fetches Google Fonts + Twemoji for any character the
  registered fonts lack) — only the edge brand images keep next/og. Missing
  characters resolve in `lib/render/fallback-assets.ts` (bundled Noto Sans
  subset; emoji stripped; other scripts draw blank or boxes) and the creator
  warns (`lib/validation/card-glyphs.ts`, per-face tables with an ink check —
  MPlantin maps Č/°/×/→ to EMPTY glyphs); `satori` is pinned to next/og's bundled
  version (`tests/unit/render/satori-pipeline.test.ts`).
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
  whose `schedule_at_period_end` only works within one product. A CANCELLED
  plan is read ONLY through `subscriptionEndsAt()` / `endsByPeriodEnd()`
  (`lib/billing/subscription-ending.ts`: `cancel_at_period_end`, the
  portal's `cancel_at` date, a schedule ending in "cancel") and the plan
  card's copy + buttons come from `planStatusOf()`
  (`lib/billing/plan-status.ts`: ending is decided BEFORE trial / renews;
  "Resume", never "Cancel plan") — never read the boolean alone. Every
  OTHER page that names the plan (dashboard notice + badges, Settings, the
  avatar menu, the upgrade modal, the plan grid, `/admin/users` list +
  detail) says "cancelled, ends <date>" from the PROFILE through ONE reader,
  `planEndingOf()` (`lib/billing/plan-ending.ts`: `subscription_ends_at` /
  `subscription_canceled_at`, migration 0135, written by the sync; the flag
  + period end only as the pre-0135 fallback) — a new surface that prints a
  tier uses it. "Resume {Plan}" is IN-APP (`ResumePlanButton` → confirm with
  the date + price from `getResumePreviewAction` → `resumeSubscriptionAction`,
  funnel `subscription_resumed`, portal only as `fallback: "portal"`);
  un-cancelling goes through `clearCancellation` (`cancel_at: ""` for the
  portal's dated shape, `cancel_at_period_end: false` for the flag — NEVER
  both in one call, Stripe refuses it), which `scheduleDowngrade` runs first
  too; an upgrade on an ending plan goes to the portal confirm untouched
  (Stripe renews it on confirm). Stripe's
  `trial_will_end` becomes ONE `trial_ending` notification + "account" email
  per subscription (migration 0109; honest about whether a card is on file).
  `invoice.paid` writes ONE `billing_payments` row per invoice (0110) and a
  PAID pack session ONE `billing_pack_payments` row (0138, keyed by the
  session like its grant, `on conflict do nothing` — a pack has no invoice);
  the admin Revenue panel reads both, counts only money taken (a $0 trial
  invoice is listed as "Trial start", never totalled) and totals per
  currency. `invoice.paid` also resyncs the subscription, and
  notifies `payment_received` only when money was taken; a
  `checkout.session.expired` session becomes ONE `checkout_reminder`
  notification + email per user per 30 days, skipped once the plan/pack was
  bought — every Checkout session carries `purchase_kind`/`tier`/`period`
  metadata for it. Every event must be subscribed on every webhook
  endpoint (live + sandbox). Events arrive in ANY order and more than once:
  `syncSubscriptionForUser` writes Stripe's CURRENT state (the event's
  subscription re-read by id + the customer's list), never the event's
  snapshot — pass a webhook object as `eventSub`, an object you just read or
  wrote as `currentSub`; only `deleted` is taken from the event
  (`docs/BILLING.md` "a late event"). FREE DOES NOT REFILL (owner decision
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
- Page width (TODO WD1, WD3, WD4, WD8): every page frame is `<PageContainer
  size="standard|wide|full">` (`components/layout/page-container.tsx`;
  `page-container-structure.test.ts` fails on a hand-written
  `mx-auto … max-w-7xl px-4`). Standard (1280) = reading and marketing pages
  and the creator (D8); wide (1920) = the browse pages, profiles, the deck
  page, the dashboard (`DashboardShell readable` caps a page of forms at
  1024) and ALWAYS the header, footer and ribbon (D7). Extra width is more
  columns, never wider tiles: card grids are `CardGrid` / `CARD_GRID_CLASS`
  (2 / 3 / 4 / 5 / 6 by CONTAINER width — the grid sits in an `@container`;
  the five-column step keeps 1440–1536 px laptops near 260–280 px tiles
  (owner 2026-10-29)), deck grids `DeckGrid` (1 / 2 / 3 / 4). A tile drawn
  from a bigger file than its thumbnail asks for its FRAME's `sizes`
  (`CARD_GRID_SIZES` / `DECK_GRID_SIZES` on a wide page, the `DASHBOARD_*`
  lists in the dashboard; `card-grid.test.ts` holds each to its tile) — the
  thumbnail's default is the generous window-grid answer. Running text keeps
  a measure.
- Decks (2026-10-28 plan, TODO DK0–DK2; owner decisions D1–D13): a deck
  STORES `card_count` / `linked_card_count` (0143: physical cards,
  maybeboard out; kept by ONE statement trigger, `sync_deck_from_entries`,
  which also touches `updated_at`) — tiles, lists, hubs and robots read
  them, never the entry rows (PostgREST's 1000-row cap). Counters
  (`likes_count`, `view_count`, the two counts, `created_at`; cards' too)
  are the SERVER's: 0143's guards revert an API role's write. Entry INSERTS
  go through the RPCs — `import_deck_entries` (the decklist commit, ONE
  transaction, merge-or-insert) and `add_custom_deck_entry` (a card added to
  a deck) — under the per-deck advisory lock and the 500-entry cap. Deck AI
  is PAUSED (`lib/ai/deck-ai-pause.ts`, `DECK_AI_PAUSED`: every new deck job,
  remix, estimate, idea and guide refused before any charge; running jobs
  finish, D6); the creator's card AI is untouched (D5). Vocabulary: proxy =
  any card made on PipGlyph; an entry is Imported (a real card, unchanged),
  Edited, Remix, Original or Not found — ONE `deckEntryStatus(entry, card)`
  (`lib/decks/entry-status.ts`) every surface reads, never a second
  derivation; "No longer available" is `deckEntryUnavailable`. Where an entry
  came from is `deck_cards.source` (0144: both RPCs write it; NULL = an older
  row; descriptive, never a gate). A card's import provenance is
  `cards.import_scryfall_id` + `import_fingerprint` (0144): INSERT-ONLY (the
  0126-style guard refuses an API role's change), written by
  createCardAction's insert — never a trigger, never an edit — the
  fingerprint the ONE hash of `lib/cards/import-fingerprint.ts`. "Edited" is
  ANY change to the card (owner 2026-10-29): it covers every field a maker
  can set — text, colour, rarity, frame + every `frame_style` switch, art +
  crop, collector fields, watermark, footer, `face_content`,
  `printed_types`, the whole `back_face` — and leaves out only what isn't
  the card (ids, owner, slug, visibility, tags, render pointers, stamps,
  counters, timestamps); its two lists name every `cards` column (a test
  reads `types/supabase.ts`), so a new column is a decision. Its field list
  is a version (v1 was widened before production stored one; the next
  change is `v2`, never a silent one). It is stored only when the creator
  says the card is still the import's (`lib/creator/import-baseline.ts`:
  form values against the import AFTER its own automatic steps — art fit,
  frame follows, part colour, anatomy — re-taken on every value change while
  the SETTLE WINDOW is open; it shuts on a quiet spell (150 ms, capped at
  500 ms), on any user gesture anywhere on the page (window capture,
  `IMPORT_SETTLE_GESTURES`: a drag-pan, a wheel zoom, a drop or a paste
  never pass the form's own events) and in every writer the maker sets off
  without one — a new one (an AI fill, an idea, a toast action) calls
  `closeImportBaseline()` first; a value the form held before the import
  and the import doesn't write (footer, watermark, set icon, finish) starts
  the card changed, `preImportChanges`; every fixture printing proves an
  untouched save, `creator-import-unchanged-printings.test.tsx`, and
  `creator-import-settle-window.test.tsx` the maker's changes). A
  PLATFORM rewrite of a fingerprinted field (a frame sweep, a typography
  fix) re-fingerprints the untouched imports it changes, in the same UPDATE
  on the trusted path (the guard allows it): `fingerprintAfterRewrite(before,
  after)`. SQL can't compute the hash (the canonical text is that module's
  JSON), so a SQL migration rewrites only rows `where import_fingerprint is
  null` and leaves the fingerprinted ones to a service-role script that
  calls the helper — else every untouched import it touches reads Edited
  (`tests/unit/db/import-fingerprint-migrations.test.ts` fails a migration
  after 0144 that doesn't, short of a `-- import-fingerprint: exempt` note).
  An entry's type line, cost, colours and
  mana value are `effectiveEntryFields` (`lib/decks/effective-entry.ts`: the
  printing is the authority for an unchanged import of it and for any card
  with no provenance linked onto a printing; else the card's own win — but
  a card's `color_identity` is its FRAME colour, so the entry's real
  letters win over a gold / colourless / land frame, and a split or
  aftermath card sums both halves' costs). D3: a deck holds its owner's
  own cards at any visibility or ANOTHER creator's PUBLIC card, on BOTH
  sides — the write (the insert policy and `deck_cards_guard_card_link`, a
  NEW `card_id` only, so an entry whose card stopped being public stays
  editable) and the read (`listDeckCards`, the one deck read every surface
  and export uses, withholds another creator's card that isn't public: RLS
  hands an unlisted card to anyone; a surface that reads its own rows —
  the share image, the tiles' cover colours — goes through
  `withDeckVisibleCards`, and the hero's fan, `featuredCardsOf`, takes the
  deck's owner); `canLinkIntoDeck` is the one rule — never widen either
  side to unlisted. A card's PAGE names the owner's own public, non-empty
  decks, and another user's only from a real creator — no admin, at least
  one public card of their own, and only while the card is public
  (0144 `public_decks_containing_card`, read by `listPublicDecksContaining`;
  "In decks", the "Decks with this card" tiles and the JSON-LD `isPartOf`
  are that one list, never a second read). Since 0149 "a real creator" is
  ONE function, `owner_is_creator(owner)` (no admin, a public card of their
  own — the anti-spam rule; trending and /creators' `list_public_creators`
  read it too, never a restated
  predicate), and the rule lives in ONE
  function, `public_deck_card_pairs`, which that list, the gallery tile's
  batched "In N decks" (`public_deck_counts_for_cards` →
  `publicDeckCountsForCards`, `CardWithStats.public_deck_count`) and the
  `deck_card_added` notification all read — a count, a list or a
  notification about "decks with this card" goes through it, never a
  restated predicate. Another creator's card is credited
  ("by @handle", `DeckItem.cardOwner`) and linked at its maker's card page;
  its downloads are the card routes' (the viewer's plan). A gone card reads
  "No longer available" and never says why.
  Every deck LIST draws ONE tile, `DeckTile` (`components/decks/deck-tile.tsx`,
  TODO DK8.1: /decks + browse, format hubs, trending rows, profiles, My
  decks, a card's decks — never a tile of its own), fed by `listDeckTileArt`
  (`lib/decks/tile-art.ts`: ONE embedded read per page of decks — the
  colours and the first three of the page's own fan, by the page's rules: a
  private card nowhere, another creator's only while public, thumbs only).
  Its title is its one link, stretched over it; the author and the heart are
  siblings. Trending (DK8.2) is `list_trending_decks` (0149: the last 7
  days' likes minus the owner's own, public, non-empty, real creators'
  decks only — `owner_is_creator`), cookie-free on /decks and the gallery
  (both stay ISR); /decks'
  controls live on /decks/browse alone (sort, ChipGroup formats, `?owner=`).
  Deck notifications (DK8.6, 0149): `deck_like` (a public deck, never the
  owner's own like, once per liker and deck — never retracted, so a like
  loop can't toast again) and `deck_card_added` (ONE row per recipient and
  deck, never per card — payload `cardIds` / `count`; later cards MERGE
  into it, unread again only when the set grew, and an UPDATE raises no
  toast — a DEFERRED constraint trigger judged at commit, when 0143's
  statement trigger has stored `card_count`, and when a deck turns public);
  neither trigger can fail the write that fired it. The maybeboard is not
  the deck there either: `public_deck_card_pairs` leaves it out, as
  `card_count`, the tiles and the fans do.
  A deck's fan (`featuredCardsOf`: the hero, the tiles, the share image) is
  the commanders, then the owner's "Feature on cover" picks
  (`deck_cards.featured_rank`, 0150: 1–5, one entry per rank and deck,
  written by `set_deck_featured_entries` — the WHOLE list, rank 1 first,
  under the entry lock — or the owner's own UPDATE), then the seeded fill;
  a pick obeys the fan's rules (no private card for anyone, another
  creator's only while public). `decks.cover_url` may also hold one of the
  sixteen built-in backgrounds ("Shuffle" / a pick in the cover editor):
  0150's ONE `media_url_allowed` branch, site-relative and anchored, never
  a host — the app's twin `isDefaultDeckCover`
  (`lib/decks/default-covers.ts`); `deckCoverOf` draws a stored one as a
  default, never as an upload.
  A SAVED card joins or leaves the owner's decks from My Cards, the
  creator's edit and another creator's card page (TODO DK9) through ONE
  picker (`components/decks/deck-membership-picker.tsx`: checkboxes, a
  one-card row's board / copies, "＋ New deck" with its visibility ON SHOW
  as the card creator's Publish control — "Keep it private" over Unlisted /
  Public, Public picked (owner 2026-10-29); decks are unlimited) and
  ONE writer, `changeDeckMembershipAction` (`lib/decks/membership-actions.ts`:
  one deck, ≤ `MAX_MEMBERSHIP_BATCH` cards, `add_custom_deck_entry` per card
  with source `link`, D3 refused before the RPC, the 500 cap in words —
  `deckFullMessage` — a result per card, ONE revalidation). A removal deletes
  only an entry whose source SAYS the card brought it (no printing) and
  unlinks every other — a printing, an import / manual source, or NO source
  (unknown: in doubt the line stays). The creator's
  "Add to a deck" box (`creator-deck-box.tsx`, under the live preview) gives
  a NEW card / remix the save's `deck_id` — the payload main sends, pinned;
  never a remix's "change something" (`hasMeaningfulChange`) — and acts AT
  ONCE on an edit (D13), never touching the form; never for a
  guest or a frame preview; a deck that refuses the new card comes back as
  `deckEntryError` (the card is saved).
  The deck PAGE (TODO DK5, part 1) is one wide screen (`WIDE_FRAME_CLASS`):
  hero, the owner's bar, the CARDS first, then the breakdown and the guide.
  It reads `listDeckPageCards` — `listDeckCards`' rules (D3 filter, credits)
  with only `DECK_PAGE_CARD_COLUMNS` (identity, render pointers, provenance
  and every fingerprinted field; a late column missing on a database is
  dropped on 42703) — never `cards.*`. Views (Stacks / Grid / List / Table),
  grouping, sorting and the status filter are `lib/decks/deck-view.ts`
  (rows built on `deckEntryStatus` + `effectiveEntryFields`; rarity through
  `effectiveEntryRarity`), the view / group / sort remembered in ONE cookie
  (`pg_deck_view`, path `/deck`; no cookie = List on a phone UA, else
  Stacks). Every opener carries `data-deck-entry` (the pop-up's focus
  hand-back) and a name with its quantity and status (`deckRowLabel`);
  custom cards draw through `DeckEntryTile` → `CardTile`, printings on their
  own 5:7 tile (Scryfall "normal"), list rows at Scryfall "small"
  (`entryPrintingImage`). A visitor never reads a private card's title:
  `publicDeckItems` hides the entry name of a card they can't read unless
  the entry stands for a printing (then it is the REAL card's name), and the
  views draw a "Private card" tile — no art; the owner gets
  `DeckPrivateCardsNotice` ("Make public" is `updateCardsVisibilityAction`,
  its strong-language rule included). The sticky summary bar's format check
  and "Edit next" are the owner's. The page's status numbers — the filter
  chips, the bar's composition, the breakdown's "Card status" — are ONE
  count, `deckStatusCountsOf` (the deck's cards: the maybeboard never
  counts; each card under the badge it wears, "No longer available" its
  own); never a second count. Group by "None" keeps the sideboard and the
  maybeboard apart from the deck. Every group stays in the accessibility
  tree: no `content-visibility` or windowing on the card area (it hid
  off-screen groups from screen readers and made the page jump).
  The breakdown's charts (TODO DK7, free for everyone) are
  `computeDeckCharts` (`lib/decks/deck-charts.ts`, over `deckRowsOf`: the
  effective fields, the maybeboard never counted; its curve adds up to
  `computeDeckAnalytics`' card for card), both over the VIEWER's rows
  (`viewerDeckBreakdown`: through `publicDeckItems`, so a visitor's
  counts never name the type a "Private card" tile hides): ONE curve bucket,
  `manaValueSlot`, shared with the list's "Group by mana value". The curve,
  the average / median mana value, Card types and the lands count the main
  deck and the commander only, never the sideboard or a companion
  (`countsTowardDeckStats`: also the summary bar, the report PDF and the AI
  deck brief / guide) (owner 2026-10-29). A curve
  bar FILTERS the list above through `DeckCurveFilterProvider`
  (`components/decks/deck-curve-filter.tsx`, around both sections; it
  holds the picked column only — the ids come from the page's latest
  curve), and the focus goes to the list's notice and back. Every chart
  has a table twin (`DeckChartCard`'s "Table" switch); the series are
  `--color-chart-1` / `-2` (validated pair; a mana colour only where it
  means a colour). The playtest (draw odds, the sample hand:
  `lib/decks/draw-odds.ts`, `lib/decks/sample-hand.ts`) shuffles the
  MAINBOARD and reads the viewer's rows (`publicDeckItems`); its pictures
  are the list's (600 px thumbs, printings on 5:7 tiles, a "Private card"
  face). Turn order and the free mulligan come from `lib/decks/format-rules.ts`
  (`formatIsMultiplayer`: Commander / Oathbreaker are on the draw with no
  play / draw choice, CR 103.8c — Brawl is 1v1; `formatHasFreeMulligan`:
  every commander format, CR 103.5c); a kept hand (Keep or a draw) takes
  no more mulligans. Keywords read only the rules text a PipGlyph card carries
  (`lib/decks/keyword-frequency.ts`; deck_cards stores no Oracle text).
  What the API hands out matches the page (TODO DK0.11, migration 0151).
  An UNLISTED deck is link-only: the decks policy admits it only to a
  request that NAMES it — its slug or id in the `x-pipglyph-deck` header,
  `viaDeckLink` (`lib/decks/deck-link.ts`) — so no list holds it, and its
  entries, likes and feedback follow (their policies ask the decks policy,
  never a visibility list of their own). A read or write that reaches an
  unlisted deck as a visitor names it (the page's deck by slug and rows by
  id, the share image, the like, the deck feedback); without it the deck
  reads as missing. A deck GUIDE is read through ONE function,
  `deck_guide_for_viewer` (`getDeckGuide`): the text only for a Pro viewer
  (`viewer_is_pro()`, held to entitlements.ts by a test), redacted for
  anyone but the owner — a card the visitor's list hides reads "Private
  card", or its printing's name — and `withheld` (the teaser) otherwise; no
  API role reads `deck_guides`, and the stored text is never rewritten. The
  redaction matches names FOLDED (`guide_name_fold`: typedForMatching's
  six, accents, æ / œ / ß, spaces) in ONE pass of ONE longest-first
  pattern built once per guide, each match named by its fold in a jsonb
  map (one the map can't name reads "Private card": fail closed), the shown
  names that hold a hidden one as guards kept whole — never a chain of
  replaces (a replacement was read again), never a regex per name per
  match; past 150 hidden names (or 400 in all) a visitor gets the teaser. A
  VIEW counts once per viewer, deck and UTC day (`recordDeckView`,
  `lib/decks/views.ts` → `record_deck_view`, service role only): never the
  owner, a crawler (isbot), an empty user agent or a prefetch; the viewer is
  an HMAC of the user id, else the network + agent, re-keyed in the database
  by a SHA-256 under the day's salt, which it drops after the day — no
  address, id or cookie is stored. `deck_views_by_day` is the owner's
  per-day read (DK7.4's data); the weekly prune cron keeps 400 days.
  Unlisted CARDS are still listable through the API (the same shape; a
  follow-up). The app shipped BEFORE 0151 (#679): `getDeckGuide` and
  `recordDeckView` fall back to main's calls on PGRST202 — remove both once
  0151 is on production and dev.
- A deck is started through ONE dialog (TODO DK4; the four-step wizard is
  gone): `NewDeckDialog` (`components/decks/new-deck-dialog.tsx`), opened
  from any page by `useNewDeck().openNewDeck({ format?, cardId? })` /
  `NewDeckButton` (`NewDeckProvider` sits in the root layout; the dialog's
  code loads on first use); `/dashboard/decks/new` (the header's link) opens
  it over My Decks. Visibility is PUBLIC by default and private is the
  maker's choice — "change" opens the card creator's Publish control in deck
  words (a "Keep it private" box over Unlisted | Public). It reads the
  viewer from GET `/api/me` (never a server action), makes the deck FIRST
  and then imports a pasted list through the deck page's resolve → commit
  with NO review step — so only an EXACT match goes in as its card; a best
  guess is committed as the name typed (a placeholder) and the toast names
  it and the skipped lines. Never twice: a refused list keeps the deck and
  offers the list again under the commit's `firstImportOnly` (refused once
  the deck holds an imported entry), and a press after a lost create
  answer sends `reuseRecentTwin` (the same deck made in the last minute
  comes back). An empty deck opens as `/deck/<slug>?new=1`
  (`useFocusAddOnNewDeck` focuses the empty deck's "Paste a decklist" door —
  else the owner bar's Import decklist — and drops the flag under the rule
  below; the addresses are `lib/decks/new-deck-paths.ts`, kept
  free of the parser); a signed-out visitor's input waits in
  sessionStorage for the trip through sign-in (`lib/decks/new-deck.ts`,
  never the URL; sign-up returns through onboarding's own `next`). Closed,
  the focus goes back to its opener; a render that throws (a chunk that
  won't load) is caught by the provider, never Next's whole-page error.

- A router navigation a component makes BY ITSELF (an effect's
  `router.replace`, e.g. dropping `?import=1`) runs ONCE (a ref: StrictMode
  runs effects twice in dev) and the component's own server actions wait
  for it (`useTransition`
  around the navigation, the button disabled while it is pending): Next
  16.2's router queue loses an action dispatched while a navigation that
  pre-empted another is pending — it is chained after the pre-empted node
  (`components/decks/import-decklist-dialog.tsx`; e2e `decks.spec.ts`).
