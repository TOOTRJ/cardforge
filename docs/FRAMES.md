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
  `<template>/symbol/{w,u,b,r,g,c}.png` for the profile's basic-symbol slot;
- the 2014–19 text-box tokens from 'Regular (Bordered M15)' (4.49 (b)):
  m15tokentext and its artifact dress m15tokenartifacttext, re-cut onto the
  prints (below);
- the emblem from 'Planeswalker Emblems' (4.52): `emblem`, CC's one master
  copied 1:1 into every colour key (an emblem is colourless; see "Emblems"
  below).

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
- **Re-cut (the text-box tokens, 4.49 (b)).** CC's 'Regular (Bordered
  M15)' master draws its lower band ~3 %H above every print: the window ends
  at 1340 px and the pill's outline runs 1356–1477, where TDOM #2, TM19 #1,
  TC17 #9 and TWAR #16 end the art at ~1404–1409 and print the pill's
  outline at 1420–1540. The importer composites the pack as CC draws it,
  then moves rows 1240–1559 (the window's straight sides through the top of
  the text box) 64 px down
  as one piece (`TOKEN_REGULAR_RECUT`, `recutBand` in
  `scripts/lib/cc-frames.mjs`): the rows it opens repeat the window's sides,
  the box keeps its bottom, and each seam is cross-faded over 24 rows. The
  shift puts the pill, the window edge and the box's top edge within 1 px
  of those prints (their title bars sit where CC's does, ±1 px), and the
  alignment score (`lib/frames/align.ts`) agrees: over the 19 reference
  prints 62 and 64 px tie at 94.5 % (56 px 93.9, 59 px 94.3, 65 px 94.4,
  CC's master as-is 92.8 %, today's m15token over the same prints 93.9 %),
  and on the four ruler prints (TXLN #10, TDOM #2, TM19 #1, TC17 #9) 64 px
  scores best: the published masters 95.0 % (62 px 94.9, CC as-is 93.1;
  re-scored independently in the skeptic pass, which also measured CC's
  band 60–65 px above the prints and the re-cut within ±2 px). Provenance
  records the re-cut (`recut`, `transforms`).
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
- **Art-window coverage (TODO 7.6).** Right after the edge contract, the
  importer flood-fills each master's see-through window (α < 16) from the
  centre of every art slot its profile paints (`artSlot`, and a second
  face's `secondFace.artSlot` turned by its `rotation`) and asks the slot to
  cover it with ≥ 0.05 % of the card to spare, and every translucent frame
  part (α < 250 — a text box or type bar the art shows through) with a
  pixel under the slot to stay inside it, give or take a 0.2 % anti-aliased
  rim; on a see-through master (`underFrameArt`, 4.17) the under-frame rect
  must cover the window and every pixel the frame lets ≥ 2 % through. A
  see-through pixel no art covers shows the bake's #101015 (a seam where a
  translucent box runs past the art). `lib/frames/art-window.ts` holds the
  check and its known failures, each with the TODO item that fixes it and a
  `maxMissPx` bound it may not get worse than; the
  importer reads the profiles through `scripts/lib/ts-alias-hooks.mjs`, and
  a violation makes it exit non-zero. CI runs it on every master
  (`tests/unit/render/art-window-coverage.test.ts`): the checks job fetches
  the manifest's PNGs from production's PUBLIC bucket first
  (`node scripts/frames-fetch.mjs`, sha256-checked, cached by the
  manifest's hash, the dev bucket only for a PR's frames not promoted yet)
  and sets `FRAMES_BUILD_DIR`, so the bucket halves of the edge contract,
  the square corners and the plate ink run there too. Locally:
  `node scripts/frames-fetch.mjs` (into the gitignored `.frames-cache`),
  then `FRAMES_BUILD_DIR=.frames-cache npm run test:unit`.
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

## Tokens: the 2014–19 frame and the type words (TODO 4.49, 3b.15, layout v34)

`m15token` / `m15tokenartifact` draw the 2014–19 arch token (M15 → MH1,
2014-07-18 → 2019-05-30). Their references are those prints only
(`frame-references.json`; `scripts/find-frame-references.mjs` stops at M20,
`date<2019-07-12`); the M20+ full-art prints wait for 4.48 / 4.50. At v34
(`M15TOKEN` in `lib/cards/template-layout.ts`):

- the P/T is M15's slot — CC's plate box 0.13 %H lower (88.61 %H, where the
  prints put the plate; `TOKEN_PLATE_PRINT_DY_PCT`), M15's value box
  unmoved, 0.05 W dark ink — on M15's own plates: `m15/pt/{color}` on `m15token`,
  `m15artifact/pt/{color}` on `m15tokenartifact` (CC's silver plate for
  `c`, the colour's own otherwise, as TC18 #7 prints). Both plates are in
  `PLATE_INK` already, so the rules layout keeps its lines off them;
- the 14 masters are RE-CUT onto the prints (owner decision 2026-09-29;
  `TOKEN_TEXTLESS_RECUT` in `scripts/lib/cc-frames.mjs`, recorded in
  `frame-sources.json`): the 15 textless pins print CC's window edge, type
  pill and the pill's shadow 8.2 px lower on average, while the title bar,
  the frame texture under the pill and the border sit where CC draws them.
  The importer moves rows 1640–1856 (the window's straight sides through the
  shadow) 8 px down as one piece over the top of the texture — the opened
  rows repeat the window's sides, cross-faded over 24 rows; the bottom seam
  fades over the shadow's last 2 rows only (`recutBand`, `blendBottom: 2`),
  so the pill keeps its edge and the texture's step matches CC's own. Edge
  by edge the pill is −0.9 … +1.6 px from the prints' means after the cut
  (−8.9 … −6.4 before) and the alignment score over the pins 94.47 → 94.99 %
  (a 6–10 px sweep peaks at 8 and 9). The profile rides the cut
  (`TOKEN_RECUT_PX`, a unit test holds it to the importer's shift): the art
  slot 8 px taller (69.38 %H), the type band on the moved pill;
- the type line runs left-aligned from 8.54 %W to the set symbol, fitted
  (`fit: "measured"`), its baseline on the prints' 1800 HD px
  (`TOKEN_TYPE_PRINT_DY`: the band rule sets it 4 px lower in its pill than
  the prints do);
- the set symbol has its own `symbolRect`: CC's box (right edge 92.13 %W),
  centred on the re-cut pill (84.77 %H = CC's 84.39 + 8 px; the prints
  centre theirs on their pill the same way), M15's 86 px box with the ink
  fit, clear of the pill's bevels (`TOKEN_PILL_INTERIOR_PX`). Its colour
  stays the card's rarity (a new token and a token's remix save as common);
- still to come: the TALL text box (4.55), the gold small-caps name and
  the art slot (4.53).

**The text-box token (4.49 (b)): `m15tokentext` / `m15tokenartifacttext`.**
The same arch with a cream type pill and a text box, from CC 'Regular
(Bordered M15)' re-cut onto the prints by its OWN band
(`TOKEN_REGULAR_RECUT`: rows 1240–1559 64 px down, both seams cross-faded
over 24 rows — not the textless masters' 8 px band above), for tokens that
print rules or flavour text (TDOM #2 Knight, TM19 #1 Angel, TXLN #7
Treasure). The profile (`M15TOKENTEXT`) is M15TOKEN's with:

- the window ending at 1404 px (66.9 %H; 1408 on the see-through `c`; the
  art slot to 67.2 %H, 7.6's overscan), the pill 292 px above CC's textless
  one's (M15TOKEN's re-cut pill sits 8 px lower still);
- the type line on the pill, left from 8.54 %W, its baseline on the prints'
  1500 px (twelve prints 1498–1505) — CC's band moved up with the pill
  (`TOKEN_CC_TYPE_TOP_PCT`, `TOKEN_CC_TYPE_PRINT_DY`), not M15TOKEN's, which
  rides the textless re-cut 8 px lower (spread as is, the band sat 8 px low
  in the pill and its text 8 px higher to make up for it); the set symbol
  right-anchored at 92.13 %W and centred on 70.48 %H (CC's 67.43 moved down
  with the band) — CC's own box (`TOKEN_CC_SYMBOL_RECT`), not M15TOKEN's
  (moved 8 px down with the textless re-cut): this master's own re-cut
  already put CC's pill, and the symbol with it, on the prints (TDOM #2 /
  TM19 #1 / TXLN #10 / TC16 #9 centre their symbols 0.5 px below ours on
  average; M15TOKEN's box would sit 8 px low);
- the rules in dark ink in CC's box moved down with the band and ending 5 px
  inside the drawn box as it starts (8.6 / 74.48 / 82.8 × 18 %: 1564–1942 px
  in the drawn box's 1559–1947; CC's ended at 1930, and a centred line sat
  5 px above the prints' 1751–1753), 2 px of
  padding each side (the prints' ink runs x 130–1372), centred vertically,
  and `rules.alignSingleLine: "center"`: ONE rules line is centred on the box
  ("Vigilance", "Flying", "This creature is all colors."); two or more lines,
  or a line with flavour, start at the left. `lib/cards/rules-layout.ts`
  places the line (a whole-px indent per target, `singleLineIndentPx`) and
  both renderers draw that indent as the line's margin, so the keep-outs
  are judged where it lands. No scrim;
- the P/T exactly as on M15TOKEN — M15's value box, the plate box 0.13 %H
  lower (88.61 %H): the text-box prints put their plate where the textless
  ones do (TDOM #2 / TM19 #1 / TC16 #9: 4.1 px below CC's 88.48 box, 1.4
  after the move) — `m15artifact/pt` on the artifact dress;
- `c` see-through like m15token's: CC's silver frame at 35 %, the pill and
  the box at 80 % over the art (BFZ #2 / OGW #1 Eldrazi Scion). A coloured
  artifact keeps the silver box and takes the colour through the title,
  type and pinline masks (TC16 #9, TC18 #8 Thopter).

The Artifact word dresses it as on the textless pair (`TYPE_WORD_DRESSES`:
m15tokentext ↔ m15tokenartifacttext). Both templates shipped UNVERIFIED
(#414) and were verified on production in every colour on 2026-09-29. The
registry resolves a 2015-frame token that prints text to them
(`printsTokenTextBox`); where one isn't verified in the card's colour that is
a `nearest` "not yet verified" answer, and the import lands on the textless
dress (`TEXT_BOX_TOKEN_FALLBACK` in `lib/creator/frame-resolve.ts`:
m15token, m15tokenartifact for a Treasure).

**The text box follows the text (owner decision 5, 2026-09-29).** On the
token kind the arch wears its text-box variation while the card has rules or
flavour text and the textless one while it has none — the renderers' own
test, `hasRulesBoxText` (`lib/cards/card-display.ts`: either column, blank =
nothing but what `String.prototype.trim` removes). `TEXT_BOX_DRESSES` in
`lib/creator/card-kinds.ts` holds the pairs (`textBoxFrameFor`; with the
Artifact word, `tokenFrameFor`), and every writer follows it:

- the creator (`card-creator-form.tsx`): entering the token kind picks the
  variation the text wants; after that the frame follows the text coming or
  going (`followTokenTextBox`) only while it is the one the text picked — a
  variation picked by hand in the setup panel's Variations sticks for the
  session, and a stored card whose frame disagrees with its text (the
  textless arch over text, an empty box) keeps it. A Frame-section pick of
  the arch is automatic again. It runs while revising a saved card too (the
  text isn't locked there); an import or an AI fill that wrote the frame, and
  the admin walk-through's combo under test, settle it
  (`settleTokenTextFollow`), and an admin's saved frame preview never
  follows (it previews its combo). An unverified variation is never
  written: the card keeps its frame and a toast says so. The AI fill dialog
  no longer offers the text box (the text it writes picks it);
- the import: the registry's `archTokenFrame` picks by the printing's text
  (the 2015 arch, the 1997 / 2003 tokens, and a borderless token's
  `nearest` — `borderless/token` is the m15 family's pick), and a token
  whose own frame isn't published (an Alpha token) falls back to the arch
  its text and type words pick (`importFrameCandidates`: `tokenFrameFor`,
  then its textless dress);
- the AI jobs: `resolveGeneratedFrame` prefers the variation the generated
  text picks (a request for either one means that one; while it isn't
  published, the textless arch asked for), and the deck remix saves the one
  its FINAL text picks (`autoTokenTextBoxFrame` — the AI's flavour replaces
  the printing's);
- stored cards: migration 0129 moved every non-land card with text from
  m15token / m15tokenartifact to its text-box variation — never an admin's
  frame preview (0121), which stays on the combo it previews (only the
  `template` key; a null stamp, so the automatic re-bake draws the box — 33
  public cards on 2026-09-29, all on m15token). No layout bump: the
  renderers didn't change, and the templates were live before the move.

The textless frames keep their scrim (`rules.backdropHex`) as a FALLBACK: it
draws only when there is text (as it always did), which after 0129 is only a
card whose owner picked the textless variation by hand over text, a frame
preview, a land, or one an older client saved — its text stays readable
instead of being lost or set straight on the art.

TSOI #11 Clue prints the TALL box (type bar ~56 %H, no CC source: its own
item, 4.55, P3) and is not a reference. The registry pins the 21 arch printings with
the tall box (`TALL_BOX_TOKEN_PINS`: every black-bordered pre-M20 arch token
with rules text measured against this master — Amonkhet / Hour of
Devastation's embalmed and eternalized cards, the SOI Clues, TDOM #7, TC18
#4 / #10 / #19, TRIX #1, TUST #18): the `tall-box` gap answers `nearest` the
regular box with `blockedBy` 4.55, so the import lands there (the text
shrinks to fit) and the 1.6 log counts the demand, instead of calling the
regular box exact.

A token's card types are WORDS in `supertype` (`card_type` stays `token`):
"Creature", "Artifact", "Enchantment", plus "Legendary", toggled by the token
kind's picker in printed order (`withSupertypeWord` /
`withoutSupertypeWord`); none on is a Copy's bare "Token". `buildTypeLine`
prints "Token" first ("Token Artifact — Treasure", "Token Basic — Wastes") on
every template. `showsPowerToughness(cardType, subtypes, supertype)` (the
creator's inputs, the AI lint) is true for a token only with Creature or a
Vehicle / Spacecraft subtype; the renderers gate on `printsPowerToughness`,
which also keeps a stored word-less token's P/T (migration 0128 gave those
rows "Creature" and a null render stamp, so the automatic re-bake redraws
them with the word whichever of the migration and the deploy lands first). The frame follows the Artifact word
(`typeWordFrameFor`): there is no separate "Artifact Token" chip, and stored
cards keep their template.

The bump is card-scoped (`VERSION_SCOPES[34]`): every card on the two token
frames, plus a token whose printed line changes on any other template
(`tokenTypeLineChanged` — alphatoken, the showcases, flip's Roles; a
template list would AND those away). It is NOT verification-neutral: the
m15token / m15tokenartifact ticks go stale (`VERIFICATION_TEMPLATE_SCOPES`;
a pre-0115 tick is judged as made at `LEGACY_TICK_LAYOUT_VERSION` 33, so the
14 legacy ones do too) and are re-verified against the new pins in the
walk-through. A stale tick stays verified, so the creator keeps offering
the frames; the wording alone stales no tick anywhere.

## Emblems (TODO 4.52 + 6.23)

CR 114: an emblem has no colour, mana cost, types, rarity or P/T, and every
one printed since M20 (2019-07-12) is on one silver frame — the source
planeswalker's name in a dark bar, the art in a planeswalker-spark cut-out,
a type bar reading "Emblem", a light text box. The `emblem` template is Card
Conjurer's 'Planeswalker Emblems' master as it is (`CC_TEMPLATES.emblem`, no
re-cut: its bars, box and border sit within 3 px of eight prints), one
master for every colour key (only `c` has references: TFDN #25 Vivien Reid,
TFDN #24, TDSK #17).

- **Profile** (`EMBLEM` in `lib/cards/template-layout.ts`, an M15-family
  member): no cost or stat slot; the name white and centred, the type line
  left from 8.54 %W on the pill's interior, each moved onto the prints'
  baseline (`EMBLEM_TITLE_PRINT_DY`, `EMBLEM_TYPE_PRINT_DY`); CC's symbol
  box; the rules in CC's box made 10 px wider on the right so ONE centred
  line lands where the prints centre it (`alignSingleLine`), two or more
  from the left.
- **Art.** The window is Scryfall's emblem `art_crop` box
  (`EMBLEM_SCRYFALL_CROP_PX`): for an emblem that crop is cut from the
  printed card around the spark, so an imported emblem's art registers
  with the print. It is grown up to 232 px to take in the spark's
  anti-aliased tips. CC's tall artBounds is the `underFrameArt` layer,
  which the spark's tail (80 % white through the type bar and the box)
  shows faintly, as the prints do.
- **Kind.** The emblem is its own card type (migration 0130) and kind
  (`KIND_DEFS.emblem`), reached from the token kind's "Token type" section
  (the Emblem choice), never a kind chip of its own. It wears the emblem
  frame and nothing else, and the emblem frame dresses nothing else
  (`templateRefusesKind`, so the server's kind gate refuses both ways). The
  card actions store every emblem colourless with no cost, supertype or
  stats (`lib/cards/emblem.ts`); `buildTypeLine` prints "Emblem", or
  "Emblem — Kaito" with the optional subtype.
- **New and unverified.** The Emblem choice shows "Soon" until `emblem/c`
  is verified; the walk-through reaches it
  (`/create?previewFrames=emblem&kind=emblem&template=emblem&color=c&seed=reference`).
  No stored card sits on it, so it shipped without a layout bump.

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
  earlier 2015-frame tokens ARE the arch (`era/2015`, exact). Either way the
  family pick is the text-box arch (`m15tokentext` / `m15tokenartifacttext`,
  4.49 (b)) for a printing with rules or flavour text — a box, not the
  scrim — and the textless one otherwise; the arch's tall box is the
  `tall-box` gap (pinned, `TALL_BOX_TOKEN_PINS`). A token's Nyx
  is the `nyx-dress` gap (4.51), not `nyx` (4.7). Role cards (`token/role`,
  unsupported) and double-faced tokens import their front face only.
  Tokens and emblems are only found through the import dialog's "Tokens &
  emblems" scope or the no-match fallback its Cards scope asks for
  (`fallback=tokens`; `lib/scryfall/search-scope.ts`, Scryfall's
  `include_extras`).
- **Emblems (TODO 1.23 / 6.23).** "Emblem" is the emblem card type, so
  every `layout: emblem` printing imports on the emblem kind (the title
  without Scryfall's " Emblem", colourless, common; a subtype only on the
  2014–19 look and AFR, `emblemPrintsSubtype`). The M20 design is
  `emblem/m20`, exact on the emblem frame; the 2014–19 EMBLEM bar
  (`emblem/2014-19`, the tokens' date / List-prefix rule) and the 2003
  plaque (`emblem/old-frame`) are nearest it; the Universes Beyond
  full-bleed emblems, The Ring's two faces and MB2's playtest card are
  `emblem/one-off`, unsupported and logged. Every one of the 141 is held by
  `tests/unit/scryfall/emblem-imports.test.ts`.
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
- **Scoring in one job (4.12).** "Score all N colours" (and "Score N
  colours", the unscored / stale ones) is ONE request to
  `POST /api/admin/frame-score-batch`: the server plans each colour's
  reference from one review read, scores two at a time with one override
  map, records every score as a `score` event (the same path as the
  per-colour Score, `lib/frames/score-record.ts`) and streams NDJSON
  progress (`lib/frames/score-batch.ts`). A run stops starting combos after
  200 s and the tab's store (`components/admin/score-batch-store.ts`) sends
  the rest in a follow-up; Cancel stops it and keeps what was scored. The
  view shows a progress panel, a per-slot × colour table of scores and
  nudges with a **Template nudge** column (the move most colours agree on —
  one layout override moves every colour; apply it in Compare → Edit
  layout), and every colour **side by side** (our live render next to its
  printing; each printing is looked up once per server instance and reused
  for 30 min, and a lookup unanswered after 8 s shows the sample). When the
  template's frame set has other frames, the **Treatment** panel scores all
  of them in one job and pools the slots they draw on the same rect into one
  nudge. The job never ticks: publishing is still the checkbox or Publish.

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
CI's **Visual regression** check enforces it: a new frame object changes the
matrix's hashes (`tests/visual/`, `tests/README.md`), so the PR fails until it
bumps and commits the regenerated baseline (`npm run test:visual -- --update`).
The job reads the frames from production's bucket, falling back to the dev
bucket for objects not promoted yet (same bytes: the manifest's sha256 is
checked). A NEW template joins the matrix by itself; its cases only need the
regenerated baseline, not a bump.

### Additions vs corrections (owner rule, 2026-09-29)

Every change to how cards look is one of two kinds, and the kind decides the
rollout:

- **Addition or new look — opt-in per card.** A new anatomy element or a
  different style a card owner might reasonably not want: legendary crowns,
  two-colour frames, the full-art token design, the Nyx starfield, the
  collector line and holofoil stamp, the vehicle P/T plate, colour
  indicators, coloured-artifact blends, new frames and treatments.
  - NEW cards get it by default, with a switch to turn it off.
  - EXISTING cards keep their look; the owner can open the card and switch
    it on (the editor may hint at it).
  - Scryfall imports follow the printing (a crown only on printings from
    Dominaria, 2018-04, on; a two-colour frame only where the printing has
    one).
  - It is stored as card data (`frame_style`), so the preview and the bake
    read the same switch; stored cards are NOT swept and owners are NOT
    badged. Announce it with a site update.
- **Correction — sweep.** Fixing a look that is wrong against its own print
  (P/T on the border, clipped text, a misplaced pill or symbol, wrong sizes,
  a mis-sourced frame): a `CARD_LAYOUT_VERSION` bump with a `"sweep"`
  rollout for every affected card, after the owner signs off the
  before/after sheet. No badge.
- **Borderline** (e.g. era fonts on the old frames, 4.8): ask the owner.

Why: a design choice belongs to the card's owner (789 legendary cards were
printed without a crown between M15 and Rivals, so a crownless legendary is
an authentic look), but a broken look must not stay broken; and every
per-card switch is a permanent second render path — both renderers, the
verification ticks and the tests — so switches are reserved for real design
choices.

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
