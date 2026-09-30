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
  optimizations must not touch what the bake reads.
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
  bake's two names, and on a CDN miss only while the card is public or
  unlisted under that owner (one read before storage: Supabase's CDN keeps
  a removed object up to 60 s, which could refill ours after the purge).
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
  — never a profile literal. A slot with `fit: "measured"` takes its size,
  text (ONE "…" past the 5 pt floor) and width from `fitTitleBand` /
  `fitTypeLineBand` in BOTH renderers (bake: `measuredLinePx`; preview: the
  HD bake's px); `TextSlot.dy` moves the text only; the set symbol's size and
  drawn width come from `setSymbolSize()` (the ink fit only with the
  code-owned `setSymbolFit: "ink"`; a Keyrune glyph of a set in
  `lib/cards/set-symbol-prints.ts` draws at that set's PRINTED size, v36 —
  keyline-inclusive boxes, so a `setSymbolKeyline` bar fits ink + ring;
  adding or re-measuring a set is a bump; the full-art basics' "ink-box"
  never reads the table). Frames outside the family keep the old
  paths byte-for-byte — bringing one in is its own layout bump
  (`docs/FRAMES.md`).
- ONE rules layout (layout v33, TODO 3.29): `lib/cards/rules-layout.ts`
  decides the size (the even HD-px ladder `RULES_SIZE_PX` 76 / 68 / 64 → 42;
  profiles use `rulesPxToPct(RULES_SIZE_PX.*)`, never a pt literal), every
  line break (MPlantin's real advances, `lib/cards/rules-metrics.ts`, checked
  at BOTH the 750 and HD bakes, no safety factor; a lone " —" breaks with its
  word) and every position (0.98 em pitch, 24 HD px between abilities,
  30 + 1 + 30 around the flavor bar) of rules, flavor, walker rows and the
  saga rail. Both renderers only DRAW its lines (`rulesDraw` → `RulesBox` /
  `RulesBoxBake`, `RulesLines*`: nowrap rows, word gaps as `marginLeft`, each
  preview word at its ceiled `wordWidthPx`) — never a box that wraps. An
  inline pip is a 0.785 em disc centred 0.334 em above the baseline (on the
  capitals, v36), drawn at the layout's `pipTopPx` in a run the line box tall
  — never centred by flexbox.
  `TextSlot.padPx` pads past any textbox border the rect holds (split).
  Keep-outs = the stat badges the card DRAWS (`statKeepOuts`; plate ink in
  `lib/cards/plate-ink.ts` — a new or replaced plate needs
  `scripts/measure-plate-ink.mjs` + the test's `MEASURED_ON`), judged glyph
  by glyph. Walkers ≤ `walkerSizePct`, row anatomy at `LOYALTY_ROW_SIZE_PX`;
  saga keeps v32's geometry (TODO 4.21).
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
  `symbolRect` centred on the moved pill. `m15tokentext` /
  `m15tokenartifacttext` (4.49 (b)) = the same arch with a text box (CC
  'Regular (Bordered M15)' re-cut 64 px down onto the prints,
  `TOKEN_REGULAR_RECUT` — its own band, symbol and type band from CC's
  (`TOKEN_CC_*`), never M15TOKEN's re-cut ones); `rules.alignSingleLine:
  "center"` centres ONE rules line (the layout places it, both renderers
  draw its indent). The text box FOLLOWS THE TEXT (owner decision 5):
  `textBoxFrameFor` / `tokenFrameFor` on `hasRulesBoxText` (the renderers'
  test) — the creator (`followTokenTextBox`: automatic until a Variations
  pick, which sticks, as does a stored frame that disagrees with its text),
  the registry (tall box = pinned `TALL_BOX_TOKEN_PINS`, nearest, 4.55;
  unverified → `TEXT_BOX_TOKEN_FALLBACK`), `resolveGeneratedFrame` and the
  remix (`autoTokenTextBoxFrame`); 0129 moved stored non-land, non-preview
  cards with text off the textless pair (null stamp, no bump). The textless pair's
  scrim is ONLY the fallback for text left on them. A
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
  `docs/FRAMES.md` "Full-art tokens").
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
- Printed pieces a card SWITCHES ON (crown, two-colour; 4.6): `frame_style.crown`
  / `twoColor`, drawn only `=== true` (`lib/cards/anatomy.ts`); new cards start
  on, every save runs `normalizeAnatomy`, an edit sends only `frame_anatomy`,
  and a piece is declared on a `PROFILES` entry only — `docs/FRAMES.md` "Printed pieces".
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

