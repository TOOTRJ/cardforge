# Frame assets: git, the frames bucket, and how a frame ships

Frames plan item 4.2 (TODO.md). Frame masters are 1500×2100 PNGs that the
Satori bake draws; each has a WebP sibling that the browser preview draws. The
bake and the preview must read the same master, or the preview and the stored
render drift apart.

## Two homes, one resolver

- **`public/frames/`**: every frame that is still in git. The browser loads
  `/frames/<template>/<file>` from the same origin. The bake reads the file
  from disk, or from the deployment CDN on Vercel, where `public/frames` is
  kept out of the function bundles.
- **The `frames` storage bucket** (migration 0116): every frame listed in
  `lib/frames/frame-manifest.json`. Objects are content-addressed as
  `<template>/<name>.<sha256-12>.<ext>` and cached for a year. A replaced
  frame gets a new URL, so no cache ever serves an old master. Frames that
  must never be in the public repo, starting with the Card Conjurer M15
  family, live only here.

`lib/frames/frame-url.ts` `frameUrl(path)` decides where a frame lives. The
preview's frame, P/T plates and loyalty badges go through it
(`components/cards/frame-layer.tsx`, `card-preview.tsx`), and so does the bake
(`lib/render/card-frames.ts`). The bake checks every bucket download
against the manifest's full sha256 and keeps a size-bounded LRU cache. A
bucket frame that fails to load is logged and not cached, and the render
throws. A bake or sweep then records a failure. It never stores a frameless
card or another template's frame.

### Which bucket an environment reads

`NEXT_PUBLIC_FRAME_ORIGIN` if it is set. Otherwise the `frames` bucket of the
environment's own Supabase project, taken from `NEXT_PUBLIC_SUPABASE_URL`.

| Environment | Reads | Why |
|---|---|---|
| Production | production's bucket | derived from its Supabase URL |
| Local `npm run dev`, Vercel previews on the dev DB | the dev bucket | derived |
| Vercel previews with a per-PR Supabase branch | the dev bucket | **Preview-scoped `NEXT_PUBLIC_FRAME_ORIGIN`** (owner step below); a branch's own bucket is empty |
| CI e2e (local Docker stack) | the dev bucket | `.env.e2e` in `.github/workflows/ci.yml` |
| Local e2e / local Docker stack | the dev bucket | `NEXT_PUBLIC_FRAME_ORIGIN` in `.env.e2e` (see `.env.e2e.example`); the local bucket is empty |

## Card Conjurer frames (4.3)

`scripts/import-cc-frames.mjs` builds the Card Conjurer templates into
`.frames-build/`:

- the M15 family: m15, m15artifact, m15land, m15snow, m15snowland, m15pw,
  m15token and m15tokenartifact (4.3 / 4.4);
- the borderless M15 frame from 'Borderless (Alt)' (4.32): m15borderless and
  its artifact dress m15borderlessartifact, each with the pack's own P/T
  plates;
- the full-art basics from 'Fullart Basics (2022)' (4.39): the
  black-bordered m15fullartland and the borderless fullartland (the same
  frame with its Border mask erased), each with CC's mana symbols at
  `<template>/symbol/{w,u,b,r,g,c}.png` for the profile's basic-symbol slot.

```bash
node scripts/import-cc-frames.mjs --only m15,m15land
```

- **Source.** The Investigamer/cardconjurer fork at a pinned commit, cached
  under `~/.cache/pipglyph-cc/<commit>`, or set `CC_CACHE`. It takes about
  4 minutes for the M15 family; `--only` builds a subset.
- **Recipe.** It is in `scripts/lib/cc-frames.mjs`. Layers are composited
  exactly as Card Conjurer draws them: only each mask's alpha counts, in
  CC's draw order, at the pack's native size, then downscaled once. A
  coloured artifact is the artifact frame and border with the colour's
  pinline, title bar, type bar and text box. Tokens come from CC's textless
  bordered pack. Every colourless substitution is noted in the recipe. A
  borderless key drops a region the frame paints itself (fullartland's
  Border mask) by subtracting the mask's coverage (alpha − mask alpha), so
  the ring's anti-aliased inner edge leaves nothing behind; multiplying by
  (1 − mask alpha) left a faint 1 px rounded rectangle over the art.
- **See-through frames.** CC's colourless M15 frame, every devoid frame and
  the colourless creature token are see-through, like the printed cards. The
  profile's `underFrameArt` draws the art under the whole frame (TODO 4.17);
  the window keeps its exact crop. The colourless token is a PipGlyph
  composite of CC's silver token frame at reduced opacity, because CC's
  bordered token pack has no colourless frame.
- **Output.** 1500×2100 PNGs with transparent corners cut at the one card
  corner (64.5 px, see "The card corner" below), WebP siblings, P/T plates
  at native size, and (full-art basics) the 168 px mana symbols. The borderless and full-art masters are native 1500×2100
  and copied 1:1 (no resample).
- **Provenance.** Which pack files made each frame is written to
  `lib/cards/frame-sources.json`.
- **Edge contract (TODO 7.7).** Every master is checked against its
  template's declared edges in `lib/frames/edge-contract.ts` (`border`,
  `art` or `bar` per edge), and by the corner check (3.26), right after the
  downscale and the corner cut; a violation, or a template with no
  declaration, makes the importer exit non-zero. CI runs
  the same check on every git master
  (`tests/unit/frames/edge-contract.test.ts`), and on the bucket masters
  when a local build is present (`FRAMES_BUILD_DIR`, else `.frames-build`,
  checked against the manifest's sha256). A new template declares its edges
  there first; today's known failures are listed as expected failures.
- **Never committed.** Card Conjurer's site was shut down after a Wizards of
  the Coast cease-and-desist, and the fork has no licence file. The converted
  frames only ever go to the bucket.

Shipping them is 4.4: publish, delete the git copies, fix the profiles, bump
the layout version once and sweep. 4.32 / 4.39 followed the same path: the
new templates need no sweep (no card sits on them), and fullartland's
re-source is its own template-scoped v30 sweep. A new template stays out of
the picker until the owner verifies each colour in `/admin/frame-compare`;
an import never lands on one (the creator only offers it, once verified).
The compare page's alignment score leaves out printed details a master
doesn't draw (`scoreExclusionsFor` in `lib/frames/align.ts`: on the
borderless templates, the arch the rules-box pinline makes around a rare's
holo stamp, until 4.9 draws it).

## The card corner (TODO 3.26)

One radius for every card corner: `lib/cards/card-corner.ts`,
`cardCornerRadiusPx(w, h)` = 4.3 % of the card's SHORT side, never rounded
(64.5 px at 1500×2100 and at 2100×1500; Scryfall cuts 4.32–4.34 %). The
display CSS, the bake's transparent corner mask and the frame masters all
read it.

- **Card Conjurer masters.** The importer cuts them at the constant
  (`CORNER_RADIUS` in `scripts/lib/cc-frames.mjs`, the same
  `applyCardCornerMask` the bake uses). The 3.26 re-import changed only
  alpha inside the four corner squares (2,576 values a master, 1,288 on the
  borderless pair whose top corners were already clear); a re-cut of the
  old objects was pixel-identical to it. fullartland, the P/T plates, the
  symbol discs and the loyalty shields did not change.
- **The corner check.** `cornerViolations` (`lib/frames/edge-contract.ts`)
  runs beside the edge contract in the importer, in Phase B's gate and in
  CI: on a `border` or `bar` edge, every pixel the cut keeps whole within
  8 px of the arc (0.5 ≤ −d ≤ 8) must be opaque (α ≥ 0.99) and dark
  (luma ≤ 48). It catches a paper crescent, a grey paper rim right at the
  arc (a light ring on a round bake) and a transparent ring, none of which
  the edge check (which skips each corner by `Math.ceil(radius) + 2` = 67 px
  on the short side) can see. An `art` edge's half of the arc is skipped.
  It fails only on the edge contract's known failures: the rings, the
  showcase corners that are design, and two α 0.97 specks on alphaland/b.
  (It also found adventure's 1–2 px grey paper rim, luma ≤ 97 on all seven
  keys; the owner put adventure on Phase B's allow-list on 2026-09-28.)
- **Git MSE masters (Phase B).** Most Full-Magic-Pack frames paint their own
  rounded corner (r ≈ 57–76 px) and fill the rest with card-stock paper, so
  a light crescent showed inside the 64.5 px cut. `node
  scripts/round-frame-corners.mjs` repaints that paper, its grey
  anti-aliased fringe and the fringe's dark tail, then cuts the corner —
  only on the allow-list in `scripts/lib/frame-corners.mjs` (retro,
  retroland, modern, modernland, saga, aftermath, extendedart, fullart,
  m15textless, m15textlessland, flip, alphatoken, adventure — its 1–2 px
  grey paper rim just inside the arc, added 2026-09-28 — and
  expeditionland w/u/r/c/m, whose paper reached 1–2 px inside the cut),
  never on a showcase family: Bloomburrow, LOTR and Tarkir draconic keep
  their drawn top corners in square outputs and print (owner,
  2026-09-28). The paint is the border AS IT RUNS BESIDE THE CORNER:
  the edge band's colour at the same depth inside the card's outline,
  sampled along each edge just past the paper (retro's scanned border reads
  16/16/16/13/8/3 on its outer rows; a flat black paint left a 0 → 34 luma
  step where the old corner ended). The tail follows the paper edge's
  gradient downhill until it meets the border at its depth, never deeper
  than 10 px inside the outline.
  - **Its gate** (`normalisedMasterFailures`, shared by the runner and the
    builders' hook): every change inside the four 96 × 96 px corner boxes;
    no corner skipped (a flood that reaches the 96 px guard arc, or no dark
    border to paint with); the LIGHT it repaints ≤ the light the cut showed
    before (the challenge's P8 count) and none left; the WHOLE repaint —
    light paper, grey fringe and dark tail, every pixel the cut keeps whose
    colour changed — within 10 px of the outline and only ever darker; and
    the edge contract and corner check on the result. The fringe and tail
    are necessarily more pixels than the light (about 1.4–3 ×; leaving them
    is a grey hairline where the old corner was). It is idempotent.
  - **Its box is 96 px, not the bake's 68.** On retro, retroland, modern,
    modernland and extendedart the paper's anti-aliased edge runs along the
    card edge to ~77 px from the corner (≤ 9 px from the edge), so a repaint
    confined to ceil(r) + 3 = 68 px would leave a grey run on the straight
    edge. A bake-level scope proof compares against 96 px boxes for these
    templates.
  - The MSE builders (`convert-mse-frame.mjs`, `build-era-frames.mjs`,
    `build-variation-frames.mjs`, `build-aftermath-frame.mjs`,
    `build-flip-frame.mjs`, `build-adventure-frame.mjs`) run the same pass
    AND gate before they write (`normaliseMasterCorners` throws and
    restores the master on any failure), so a rebuild can't bring the
    white back. Then `npm run assets:frame-webp`.
    (`build-adventure-frame.mjs` composites on the MSE m15 master, which
    left git with 4.4's Card Conjurer swap: restore it from `cd2ffcc^`
    outside `public/frames` first, never the Card Conjurer m15.) The
    normalised masters are truecolour PNGs: a lossless palette is
    impossible (the base palettes were already full at 255–256 colours and
    the cut's alpha ramp adds 35–58), and a quantised one moves the mask's
    alpha — so a builder writes truecolour after the gate. sharp's `effort`
    turns palette quantisation on: on a rebuilt adventure master it moved
    every pixel of the cut's ramp (by up to 52), and the corner check still
    passed. `build-adventure-frame.mjs` and `build-variation-frames.mjs`
    write truecolour; the aftermath, era, flip and `convert-mse-frame.mjs`
    builders still pass `effort: 10` (a follow-up;
    `tests/unit/frames/frame-corners.test.ts` lists them).
- **Square outputs.** Print (the PDF card and sheets, the Pro deck PDF +
  ZIP) and the Square PNG are the round render squared again
  (`squareCardCorners`): outside the arc each corner is the card's border
  colour — the border black by default, the root's #101015 where a master's
  edge band is see-through (the rings; bloomburrow / lotr / tarkirdraconic
  bottoms; expeditionland b/g) — or, where art or frame design runs into
  the corner (an art-to-edge frame; the tops of bloomburrow, lotr and
  tarkirdraconic), what was drawn. The table is `lib/frames/square-corners.ts`;
  `tests/unit/frames/square-corners.test.ts` holds it to every master, so a
  new or rebuilt frame whose corner changes turns CI red.
- **Left alone.** The Alpha masters (agclassic, alphaland) keep their clean
  60 px cut, inside the 64.5 px one (square outputs paint the annulus
  between the two cuts in the border black). expeditionland b/g keep their
  paper: a see-through band leaves no border to paint with (7.7). The
  showcase families keep their drawn corners (Bloomburrow's pale corner,
  LOTR's tan, Tarkir draconic's ornament; owner, 2026-09-28). The small
  steps where a Phase B repaint meets the untouched border — visible only
  at 6× contrast — are accepted (owner, 2026-09-28).

## Text sizes on the M15-era family (TODO 4.20, layout v32)

The M15-era family (`M15_FAMILY_TEMPLATES` in `lib/cards/m15-family.ts`,
23 templates; split and battle join with 4.21) prints its names, type
lines, pips and set symbol at ONE set of sizes, Card Conjurer's, which match
the prints. They live in `lib/cards/typography.ts`, as fractions of a
portrait card's width: `TITLE_SIZE_PCT` 0.0533 (80 px at HD),
`TYPE_SIZE_PCT` 0.0453 (68 px), `COST_DISC_PCT` 0.0485, the set-symbol box
`SET_SYMBOL_BOX_PCT` 0.0574 (86 px; `SET_SYMBOL_BOX_PCT_THIN_BAR` 0.0533 on
the planeswalker and saga) and the adventure panel's `ADVENTURE_PANEL_PCT` /
`ADVENTURE_PANEL_COST_PCT`; `displayPct(pct, orientation)` gives a landscape
slot the same absolute size.

A family profile:

- references those constants, never a literal;
- sets `fit: "measured"` on its title and type slots, so both renderers take
  the name's text, size and width from `fitTitleBand`
  (`lib/cards/title-band.ts`) and the type line's from `fitTypeLineBand`
  (`lib/cards/render-tiers.ts`). Each shrinks only as far as its room needs,
  down to 5 pt of the card's orientation; past that floor the helper cuts it
  with ONE "…", and both renderers draw that string. The room: a name runs
  to one band gap (`BAND_GAP_PCT`, 0.02 W) before its pips, inline or in a
  `costRect`, or to the band's end with no cost; a type line runs to
  `TYPE_SYMBOL_GAP_PCT` (0.013 W, the prints' gap) before the set symbol's
  INK as drawn, inline (both renderers pull the symbol left over the band
  gap by `inlineSymbolPullPct`; it stays where it was) or in a `symbolRect`
  that overlaps the band. The bake sets a shrunk line at `measuredLinePx`
  (the whole px below its fit, never below the floor's own px), and the
  preview shows it at the stored HD bake's px (`measuredLinePreviewPct`);
- keeps a grown slot's baseline with `TextSlot.dy` (`keepBaseline` in
  `template-layout.ts`): it moves the TEXT only — the rects, pips and set
  symbol stay where they were verified. A line the fit shrank keeps its
  band's baseline too (`slotTextDy`). Front faces only; second faces and the
  adventure panel centre their text in the rect;
- gives the set symbol a box in `symbolSizePct` and sets
  `setSymbolFit: "ink"` (code-owned, never in an override). `setSymbolSize`
  (`lib/cards/set-symbol-size.ts`) draws an uploaded icon or the default mark
  in a square of the box and fits a Keyrune glyph to it by its ink, from
  `lib/cards/keyrune-metrics.ts`. After a keyrune upgrade, run
  `node scripts/generate-keyrune-metrics.mjs`; its test fails until then.

Every frame outside the family keeps the old code paths byte-for-byte: no
`fit` flag (the character estimate and the CSS ellipsis) and no box or ink
fit (the symbol drawn at `type.sizePct × 1.1`, or at an override's
`symbolSizePct`, which stays a font size there). Bringing a frame into the
family is a layout bump of its own. Rules text is not part of this standard: it has its
own layout (below).

## Rules text and the stat plates (TODO 3.29, layout v33)

Every rules box — the main box on every template, the adventure page, the
flip / split / aftermath second faces — is laid out by ONE pure module,
`lib/cards/rules-layout.ts`, fed by `lib/cards/rules-box.ts`, and both
renderers draw its lines (`RulesBox` in the preview, `RulesBoxBake` in
the bake); neither wraps text itself. The planeswalker ability rows
(`lib/cards/loyalty-rows.ts`) and the saga rail's text
(`lib/cards/saga-rail.ts`) are broken by the same module and drawn by
`RulesLines` / `RulesLinesBake`.

How rules text is sized and set:

- **Size**: the largest step of the even HD-px ladder (`RULES_SIZE_PX`:
  76 = the prints' 9 pt at 63 mm, 68, 64, down to the 42 px floor in 2 px
  steps) at which the text fits at BOTH bakes — the HD one (whose px the
  preview draws in cqw) and the 750 px one (OG images, live free
  downloads), each with its own whole-px gaps and pips. No safety factor:
  lines are measured with MPlantin's own advances (`lib/cards/rules-metrics.ts`,
  every glyph through Latin Extended-A; a character a face lacks is budgeted
  a full em). Text that doesn't fit at the floor clips, set from the box's
  top so the clip takes the tail, never the first line.
- **Spacing**: 0.98 em line pitch (rules, flavor and attribution alike), a
  fixed 24 HD px between abilities, 30 px either side of the 1 px flavor bar
  (42 px on a frame without one). A lone em dash after a word ("choose one
  —", "Landfall —") never starts a line: it breaks with its word, as the
  prints set it.
- **Positions per bake**: the lines are the same at 750 and HD, but each
  rounds its own px, so the 750 bake's pitch is 0.962–0.974 em (1.0 em from
  42 to 50 px) against HD's 0.974–0.986, and its line tops drift up to 6 HD
  px (a later word up to 20 HD px sideways) from HD's, halved. The preview
  draws each word in its ceiled box (`wordWidthPx`), so its words sit where
  the HD bake's do; the MPlantin `@font-face` rules carry the face's hhea as
  metric overrides, so Windows browsers set the same line box as macOS.

What a frame gives it:

- the rules slot's rect, its ceiling (`rulesPxToPct(RULES_SIZE_PX.*)`, never
  a point literal), `vAlign`, `flavorDivider`, and its padding in HD px
  (`TextSlot.padPx`; default 9 / 18, M15 and its skins the prints' 4 / 0 —
  a 0.98 em line box already holds the air above the ascenders, and an
  accented first capital gets its own headroom). A rect that holds part of
  the frame's own textbox border pads past it, per side: split's halves
  (`SPLIT_TEXTBOX_BORDER_PX`, 33 / 38 px measured on the masters by
  `tests/unit/cards/rules-box.test.ts`, then the MSE split style's 24 / 16);
- a planeswalker frame's `loyaltyRows.maxSizePct`: the walker ceiling (64 px
  on m15pw) for the ability rows and a walker drawn in the plain box; any
  other card on the frame keeps the rules slot's own size (68 px). The row
  anatomy (badge, rail, padding) is drawn at one size, `LOYALTY_ROW_SIZE_PX`
  (46 px: the text starts at x 275, where the walker prints start theirs),
  whatever the text's size;
- keep-outs: a line never runs into a stat badge the card draws — judged
  glyph by glyph, each glyph's own ink where it sits (a word without a
  descender just above a P/T plate is clear of it). A plate's ink comes
  from `lib/cards/plate-ink.ts`, measured on the plate masters by
  `scripts/measure-plate-ink.mjs` (alpha ≥ 128, every colour, as fractions
  of the plate image — so it follows the plate's box wherever a profile or an
  override puts it). A NEW plate (`plateAssetPathTemplate`) needs its entry
  there — `tests/unit/cards/plate-ink.test.ts` fails until it has one — and a
  replaced plate a re-run:

  ```bash
  FRAMES_BUILD_DIR=… node scripts/measure-plate-ink.mjs
  ```

  Bucket plates are read from the local build (sha256-checked against the
  manifest), git plates from `public/frames`; paste the printed rows into
  `PLATE_INK`, and the bucket plates' manifest hashes (the script prints
  them too) into the test's `MEASURED_ON` — CI has no bucket frames, so that
  pin is what fails when a promoted plate replaces one the table was
  measured on. A value printed on the art (no plate) keeps its rect clear, a
  drawn badge (the battle's defense) its disc.

## Which printing is which frame (TODO 1.4)

A Scryfall import knows which PipGlyph frame reproduces THIS printing from
the frame signature registry, `lib/scryfall/frame-signatures.ts`: an
ordered rule table (first match wins) over the printing's frame year,
border colour, frame effects, promo types, set, set type and collector
number. Each rule has a stable signature id and resolves to `exact`,
`nearest` (with a reason and the TODO item that would make it exact) or
`unsupported`. The import patch carries it as `frame_match`; `exact` also
needs the combo verified in the card's colour (`withVerification`,
`lib/creator/frame-resolve.ts`).

The import dialog (TODO 1.5) shows every printing's finalized match as a
badge (✓ Exact · ≈ Nearest · ✕ Not available — `/api/scryfall/printings`)
and, for anything but an exact match that lands on its own frame, asks for
a frame before the import (`lib/creator/import-frame-choice.ts`): the kind's
published frames in the card's colour, the import's own landing preselected
and listed first with the printing's own frame, the kind's M15 standard and
the printing's family (its frame set — a skin only when it IS the printing's
frame); every other frame sits behind "Show all frames". A printing short of
nothing but a detail no frame draws — the legendary crown, a colour
indicator (`FrameMatch.gaps` ⊆ `UNDRAWN_DETAIL_GAPS`) — doesn't ask: it
lands on its own frame, the Card step shows "Nearest frame" with the reason,
and the deck pre-fill doesn't toast (owner decisions C1–C3, 2026-09-29).
So a newly verified frame shows up in the chooser and turns its printings'
badges to Exact the moment its `frame_reviews` row is ticked.

- **A new frame** gets a rule for the printings it reproduces (a set +
  collector range for a showcase run; never `full_art` alone), a fixture
  printing in `tests/unit/scryfall/fixtures/signature-printings.json`, and
  a row in `tests/unit/scryfall/frame-signatures.test.ts`. The completeness
  test fails until some rule can reach it.
- **Tokens (TODO 1.23).** Scryfall has no field for a token's design, so
  the date decides: `isM20DesignPrinting` (released on or after 2019-07-12,
  a `plst` reprint by its collector prefix — `PLST_PRE_M20_PREFIX_SETS`,
  held to Scryfall by `tests/unit/scryfall/fixtures/plst-token-prefixes.json`).
  Those print the full-art design (4.48), so `token/m20` answers `nearest`
  the 2014–19 arch until 4.48's templates exist (then `onceVerified`); the
  earlier 2015-frame tokens ARE the arch (`era/2015`, exact). A token's Nyx
  is the `nyx-dress` gap (4.51), not `nyx` (4.7). Role cards (`token/role`,
  unsupported) and double-faced tokens import their front face only.
  Tokens and emblems are only found through the import dialog's "Tokens &
  emblems" scope or the no-match fallback its Cards scope asks for
  (`fallback=tokens`; `lib/scryfall/search-scope.ts`, Scryfall's
  `include_extras`).
- **Signature ids are stored.** Every import that isn't exact writes a
  `frame_requests` row keyed by its signature (TODO 1.6, migration 0123,
  `lib/frames/frame-requests.ts`; never from an admin's frame preview or
  its stepper walk-through — admin tooling isn't demand), with its cause — `missing` (the rule's
  own nearest / unsupported answer) or `unverified` (an exact frame
  `withVerification` downgraded) — and `/admin/frame-requests` counts them
  per signature + set in those two groups, most distinct users first, to
  decide what to build or verify next. Never rename a rule's key: old rows
  would stop grouping with new ones, and the page flags them "not in
  registry". Split a rule under a new key instead.
- **A frame whose border isn't true yet** stays in
  `BORDER_PENDING_TEMPLATES` (or, for single colour masters,
  `BORDER_PENDING_COLOURS`), capped at `nearest`. The list is the edge
  contract's known failures (`lib/frames/edge-contract.ts`, 7.7) except
  alphaland's invisible corner specks, and a test holds them together:
  once a master is fixed and struck from the known failures, take its cap
  out too (4.35).
- **A frame the registry names for later** (`onceVerified`): a rule may
  name a verified frame now and another once that one is verified in the
  card's colour — the 2003-frame textless promos name the 2003 frame until
  `m15textless` is verified. `withVerification` makes the swap, so
  verifying the combo is all it takes.
- **Registry references** (`lib/cards/frame-references.json`) must resolve
  to their own template and pass the pin check;
  `tests/unit/cards/frame-reference-signatures.test.ts` holds that over a
  trimmed capture of every reference printing
  (`tests/unit/cards/fixtures/reference-printings.json` — re-capture it
  when you add a reference). Never replace the DEFAULT reference of a combo
  production has verified; add an alternate and ask the owner to
  re-verify.

## Walking the stepper and signing off a template (TODO Phase 2)

Verification is still the only gate (`frame_reviews`), but an admin can now
check an unverified frame the way a user would meet it, before publishing it:

- **Preview mode (2.1).** `/create` and `/card/<slug>/edit` take
  `?previewFrames=all`, a template (`?previewFrames=battle`, all seven
  colours) or a list (`battle/w,saga`). For an ADMIN — decided from the
  server-read profile, never the URL — the named combos join the verified
  set in the frame picker, and a banner says so on every step. Everyone else
  gets the ordinary creator; the guest creator (`/create-guest`, ISR) never
  reads the URL; AI jobs, and the in-form AI dialog, keep the verified set
  (`lib/creator/frame-preview.ts`).
- **Walk the stepper (2.2).** Each row of the checklist (and the compare
  view, and each colour of the sign-off view) links to
  `/create?previewFrames=all&kind=…&template=…&color=…&seed=reference`. The
  page builds the seed from the compare view's own payload
  (`buildFrameComparePayload`, the second face included) through
  `lib/creator/frame-walkthrough.ts`; the form applies it through the same
  handler as a user's Scryfall import, pins the frame and colour and starts
  on the Card step. A combo with no real printing (or a failed lookup) is
  seeded with the compare view's sample content (`seed=sample` asks for it
  directly), and the banner says which. Art isn't imported.
- **Preview saves (2.3).** A save on an unverified combo in preview mode, and
  every save during a walk, asks the server for `frame_preview`;
  `createCardAction` / `updateCardAction` honour it only for an admin (the
  verification gate is skipped, the kind gate still runs) and store the card
  PRIVATE with `cards.frame_preview = true` (migration 0121: a CHECK keeps a
  flagged card private, a trigger lets only an admin's API session raise the
  flag). It never joins a deck and never counts as product activity. The
  checklist lists previews under their template with **Re-verify** (the
  card reopened in preview mode on today's frame) and **Delete**
  (`deleteFramePreviewCardAction`, flagged rows only). In the admin's own
  My Cards a preview carries a **Frame preview** badge in every view (grid,
  compact, list) so it can be spotted and deleted there too. A bulk "make
  public" or "make unlisted" skips the previews and changes the rest:
  `updateCardsVisibilityAction` reads the flag itself, and the toast says
  "Published 5 cards. Skipped 2 frame previews — they stay private." A batch
  of only previews changes nothing and says why.
- **Template sign-off (2.4).** `/admin/frame-compare?template=<t>` (no colour)
  shows every colour's reference, verification record (0.10), recorded
  auto-score (0.9) and walked previews. **Score** records a `score` event
  (`scoreFrameColorAction`); a per-colour tick's own score (its `verify`
  event) counts too, whichever is newer (`latestScoreEvents`). **Publish**
  (`signOffFrameTemplateAction`) needs every colour that has a reference
  scored on today's renderer and override (`lib/cards/frame-signoff.ts`, the
  tick's own staleness rule) AND against the reference the combo stands for
  today (a re-pin stales the old score) plus the owner's tick, then stamps
  each of those colours like a tick and logs
  `verify` events and one `signoff` event. Colours with no real printing
  stay on their own checkbox, which also still withdraws a single colour.
  The recorded score is an edge difference (lower is better); the view also
  shows it as a match, 100 − the difference. A colour whose match is below
  `SIGN_OFF_LOW_MATCH_PCT` (90 %) is marked on its row, and Publish first
  asks "N colours score below 90% — publish anyway?", naming them. It is a
  warning, never a block. The `signoff` event records those colours as
  `lowMatch`.

Nothing here changes a stored bake or a renderer.

## Shipping a frame change

1. Build the files into `.frames-build/<template>/…`, which is gitignored.
   The Card Conjurer importer does this from 4.3 onward.
2. Publish them to the dev bucket and update the manifest:

   ```bash
   npm run frames:publish -- --source .frames-build --only m15,m15land
   ```

   That is a plan only. Add `--write` to upload and write the manifest. Uploads
   are content-addressed and never overwrite, and the target is refused if it
   is production. Delete any git copy of a published frame; a unit test fails
   while a frame exists in both places.
3. Open the PR. Its preview draws the new frames from the dev bucket. Verify
   the frames there.
4. **Owner:** copy the objects to production before merging. Run it from an
   up-to-date `main` checkout, and give it the PR's manifest as data. Never
   run a PR branch's scripts with the production key.

   ```bash
   git fetch origin && git show origin/<pr-branch>:lib/frames/frame-manifest.json > /tmp/frames.json
   ```

   ```bash
   node scripts/frames-promote.mjs --manifest /tmp/frames.json
   ```

   That prints the plan and needs no key. To copy:

   ```bash
   CONFIRM=yes node scripts/frames-promote.mjs --manifest /tmp/frames.json
   ```

   It asks for production's secret key from the Supabase dashboard without
   echoing it, so the key never lands in shell history or `.env.local`.
   Every object is checked against the manifest's full sha256 before upload.
5. CI's **Frames published** check (`npm run frames:check`) turns green once
   production serves every manifest object. Then merge. The production build
   runs the same check (`npm run build` with `--if-production`), so an
   unpromoted manifest fails the Vercel production deploy and the previous
   deployment keeps serving.

A frame swap that changes baked output still needs its `CARD_LAYOUT_VERSION`
bump with a `"sweep"` rollout, so owners are never badged. After the deploy,
the automatic re-bake sweeps the affected cards on its own (next section).

## Re-bakes after a deploy (automatic)

Nobody runs a sweep by hand any more. `/api/cron/auto-rebake`
(`vercel.json`, every 5 minutes, production only; `lib/cards/auto-rebake.ts`)
re-bakes every published card that a `"sweep"` bump, a frame-layout save or a
migration left on an older render.

- **What it runs.** The same batch as the manual script (`runRebakeBatch`,
  scope `sweep`): opt-in-only cards are left alone with their owner badge,
  a card whose only pending bumps are scoped out is just stamped, and the
  overlap guards still apply. Batches of 8 until a batch finds nothing, or
  until about 240 s have gone (`maxDuration` is 300 s). The next run carries
  on. A 700-card sweep takes roughly an hour.
- **When idle** it costs a state read, one head count and a timestamp
  write. The count covers published cards that were never baked, have no
  stamp, or are stamped below the newest sweep version
  (`latestSweepVersion()`). If only opt-in leftovers remain,
  the count is remembered and the scan is skipped for up to 6 hours.
- **Never clean.** It refuses (412, and records it) unless
  `NEXT_PUBLIC_BILLING_ENABLED` is `true`. `ALLOW_UNWATERMARKED_SWEEP` does
  not apply to it.
- **One sweeper at a time.** One lease (`render_sweep_state`, migration 0120;
  `lib/cards/sweep-lease.ts`) is shared by the cron,
  `POST /api/admin/rebake` (the script) and `POST /api/admin/rebake-marked`
  (the compare page's "Re-bake now"). A manual call that finds the cron
  running asks it to stop after its current batch and waits. Between two
  manual calls the lease stays parked for the manual run, so the cron stays
  out until the run ends. If the lease is still busy after 2 minutes, the
  manual route answers `503` with `Retry-After: 60` and says why. The
  script's retry helper (`scripts/lib/rebake-request.mjs`) backs off and
  retries a 503. The compare page shows it next to "Try again". Never
  `409`: the script treats that as fatal.
- **Failures.** A card that fails is skipped for the rest of that run. After
  it fails in 3 runs it goes on the **poison list**: every later run skips
  it and the pending count leaves it out. "Retry these cards" gives each
  one more try. An entry whose card no longer needs a re-bake (the owner
  saved it again, unpublished or deleted it) leaves the list on the next
  working run.
- **A run that dies.** A run killed at the 300 s limit or out of memory
  writes nothing. It records the batch it is baking first (`in_flight`), so
  the next run gives each of those cards a strike: a card that kills the
  renderer ends up on the poison list like one that fails.
- **Time limit.** No batch starts if it would end past 240 s. A batch still
  running at 280 s keeps the lease (it may still write) and ends the run.
  If it had been running for 2 minutes or more, that is a **hung** batch
  (breaker). A shorter one was just a slow last batch (an "overrun"): the
  next run carries on.
- **Breaker.** It pauses the automatic sweep and sends every admin a
  `render_sweep_paused` notification (a toast and a bell entry) when any of
  these happens:
  - a whole batch of first-time failures re-bakes nothing (≥ 3 cards);
  - 10 cards fail for the first time in one run;
  - a batch hangs (see above);
  - the batch query fails 3 runs in a row (a blip heals itself; code that
    reads a column its migration hasn't added yet doesn't);
  - 2 runs in a row die before finishing;
  - one run pushes the poison list past 50 cards. It trips once, when the
    list crosses 50, so Resume lets the sweep carry on past cards you
    can't fix yet.

  A known-bad card that fails again doesn't count.
- **Watching it.** `/admin/renders` (Admin → Re-bakes) shows the status, a
  pending estimate, the last run (re-baked / stamped / failed / remaining /
  why it stopped), the pause reason, the cards that keep failing, and
  **Pause / Resume / Retry**. Resuming clears the breaker. Vercel logs carry
  one line per run: `[auto-rebake] v32 stop=… rebaked=… failed=…`.
- **The manual script still works** (`scripts/rebake-renders.mjs`, which also
  has the `version` and `legacy-art` scopes). Use it for a one-off. It
  takes turns with the cron through the lease.
- **Previews never run crons.** On a preview, `/admin/renders` shows the
  branch's state. To run one invocation by hand, call the route with the
  Preview `CRON_SECRET` (`curl -H "Authorization: Bearer …"
  <preview>/api/cron/auto-rebake`).

**Gotcha: a migration that marks cards for a CODE fix.** Say a PR ships a
renderer fix together with a migration that sets `layout_version = null`
(0118 did this). On merge, the migration can reach production minutes before
the new deployment does. In that window, the old deployment's cron could
re-bake those cards with the OLD code and stamp them current. So ship such a
fix with a `"sweep"` bump that covers those cards, and the new code will
re-bake them again. Or pause the automatic re-bake before merging and resume
it once the deploy is live.

## Owner setup (once)

- Vercel → Project → Settings → Environment Variables: add
  `NEXT_PUBLIC_FRAME_ORIGIN` =
  `https://znipzaxgpaiandwiqabn.supabase.co/storage/v1/object/public/frames`,
  scoped to **Preview** only. This is needed before the first manifest entry
  merges. Without it, previews of PRs that touch `supabase/` draw no frame
  for bucket-hosted templates.
- **Required:** add **Frames published** to the `main` ruleset's required
  status checks before the first manifest entry merges. Without that, the
  check is advisory, and only the production build gate stands between a
  merge and missing frames.

## If the dev branch is reset

A reset drops the dev branch's storage objects. Previews, local dev and CI
e2e would then draw no bucket frames. Refill them from production's public
copies:

```bash
npm run frames:restore-dev -- --write
```

Frames published to dev but not yet promoted aren't on production. Re-run
`npm run frames:publish` for those.
