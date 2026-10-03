# Frames: assets, layouts, verification and re-bakes

How a card frame gets from a source pack onto a user's card, and how stored
card images follow when it changes. Frame masters are 1500×2100 PNGs
(2100×1500 for a landscape frame) that the Satori bake draws; each has a WebP
sibling that the browser preview draws. The bake and the preview must read
the same master, or the preview and the stored render drift apart.

The code is the source of truth. Numbers here are copied from the named
constants; when one moves, the constant wins and this doc is the one to fix.
TODO numbers (4.20, 3.29, …) point at `TODO.md`'s frames plan for the history.

## Contents

Frames as files
1. [Where frame files live](#where-frame-files-live)
2. [Provenance and legal](#provenance-and-legal)
3. [Card Conjurer frames](#card-conjurer-frames)
4. [The card corner](#the-card-corner)
5. [Checks every master passes](#checks-every-master-passes)

Workflows
6. [Adding a frame](#adding-a-frame)
7. [Shipping a frame change](#shipping-a-frame-change)
8. [Verifying a frame](#verifying-a-frame)
9. [Walking the stepper and signing off a template](#walking-the-stepper-and-signing-off-a-template)
10. [Which printing is which frame](#which-printing-is-which-frame)
11. [Additions vs corrections](#additions-vs-corrections)

How a profile sets text and art
12. [Kind anatomy and bodies](#kind-anatomy-and-bodies)
13. [Text sizes on the M15-era family](#text-sizes-on-the-m15-era-family)
14. [Rules text and the stat plates](#rules-text-and-the-stat-plates)
15. [Tokens](#tokens)
16. [Art under and around the frame](#art-under-and-around-the-frame)
17. [Emblems](#emblems)

Operations
18. [Re-bakes after a deploy](#re-bakes-after-a-deploy)
19. [Re-bake runbook](#re-bake-runbook)
20. [Announcing a change](#announcing-a-change)
21. [Environment setup](#environment-setup)
22. [If the dev branch is reset](#if-the-dev-branch-is-reset)
23. [Non-goals](#non-goals)

## Where frame files live

TODO 4.2. A frame has one of two homes:

- **`public/frames/`**: every frame that is still in git (the MSE-derived
  masters). The browser loads `/frames/<template>/<file>` from the same
  origin. The bake reads the file from disk, or from the deployment CDN on
  Vercel, where `public/frames` is kept out of the function bundles
  (`next.config.ts`): an asset the bake reads synchronously must be listed
  in `frameAssetPathsFor()` (`lib/render/card-image.tsx`), or it renders as
  a transparent pixel on Vercel.
- **The `frames` storage bucket** (migration 0116): every frame listed in
  `lib/frames/frame-manifest.json`. Objects are content-addressed as
  `<template>/<name>.<sha256-12>.<ext>` and cached for a year. A replaced
  frame gets a new URL, so no cache ever serves an old master. Frames that
  must never be in the public repo, starting with the Card Conjurer M15
  family, live only here. A frame is never in both places, and every
  manifest PNG has its WebP sibling
  (`tests/unit/frames/frame-manifest.test.ts`).

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
| Vercel previews with a per-PR Supabase branch | the dev bucket | Preview-scoped `NEXT_PUBLIC_FRAME_ORIGIN` ([Environment setup](#environment-setup)); a branch's own bucket is empty |
| CI e2e (local Docker stack) | the dev bucket | `.env.e2e` in `.github/workflows/ci.yml` |
| Local e2e / local Docker stack | the dev bucket | `NEXT_PUBLIC_FRAME_ORIGIN` in `.env.e2e` (see `.env.e2e.example`); the local bucket is empty |
| CI unit tests, visual regression | production's PUBLIC bucket, then dev for frames not promoted yet | `scripts/frames-fetch.mjs` / `scripts/visual-regression.mjs`, sha256-checked against the manifest |

## Provenance and legal

Where every frame came from, and the rules that follow from it:

- **MSE Full-Magic-Pack → git.** The masters in `public/frames/` (the Alpha,
  1997 and 2003 eras, saga, split, battle, the showcase families, the
  variation treatments, the textless and expedition frames, and the
  planeswalker loyalty badges; adventure, flip and aftermath left for Card
  Conjurer's masters with TODO 4.21a) are converted from Magic Set
  Editor's Full-Magic-Pack styles by the builders under `scripts/`
  (`convert-mse-frame.mjs`, `build-era-frames.mjs`,
  `build-showcase-frames.mjs`, `build-variation-frames.mjs`, …). The pack
  lives outside the repo on the owner's machine; the builders name its
  path. `scripts/audit-frame-sources.mjs` answers "which pack file was this
  frame built from?", and `docs/mse-profile-report.md` keeps the MSE
  baselines the profiles started from. The card faces' Beleren Bold comes
  from the same non-commercial pack (`lib/render/card-fonts.ts`).
- **Card Conjurer → the bucket only.** Every Card Conjurer-derived master is
  built from the Investigamer/cardconjurer fork at a pinned commit
  (`CC_COMMIT` in `scripts/lib/cc-frames.mjs`). Card Conjurer's site was shut
  down after a Wizards of the Coast cease-and-desist, and the fork has no
  licence file, so the converted frames are NEVER committed: the importer
  writes them to the gitignored `.frames-build/`, and they only ever go to
  the bucket. Which pack files made each frame, and every substitution and
  transform, is recorded in `lib/cards/frame-sources.json` (written by the
  importer; `recut` / `transforms` for a re-cut master). `.frames-build/`
  and `.frames-cache/` are gitignored; a build written anywhere else in the
  checkout is not, so stage files by name, never with `git add -A`.
- **References are looked at, not kept.** The compare tools show Scryfall's
  scan of a reference printing next to our render; the registry
  (`lib/cards/frame-references.json`) and the test fixtures store only
  printing data (names, sets, Scryfall ids). No scan is stored in git or
  the bucket.
- **A new source** is recorded before its first frame ships: where it came
  from (repo and commit, or pack and style), what licence it carries, and
  which home that allows. A source with no licence the owner has cleared
  for the public repo goes to the bucket only, like Card Conjurer's.

## Card Conjurer frames

TODO 4.3. `scripts/import-cc-frames.mjs` builds the Card Conjurer templates
into `.frames-build/` — 33 templates today (`CC_TEMPLATES` in
`scripts/lib/cc-frames.mjs`):

- the M15 family (4.4, shipped in #380, layout v24): m15, m15artifact,
  m15land, m15snow, m15snowland, m15devoid, m15pw, m15token and
  m15tokenartifact;
- the borderless M15 frame from 'Borderless (Alt)' (4.32): m15borderless and
  its artifact dress m15borderlessartifact, each with the pack's own P/T
  plates — and, since 4.6f (wave 2a), their pinline-split pair masters and
  the crowned twin of every master (CC's floating crown, `<key>-legendary`;
  [The borderless crown and pair pinline](#the-borderless-crown-and-pair-pinline-46f-wave-2a));
- the borderless nonbasic land (4.34): m15borderlessland, a composite of
  the same pack's pixels (below), on m15borderless's plates;
- the full-art basics from 'Fullart Basics (2022)' (4.39): the
  black-bordered m15fullartland and the borderless fullartland (the same
  frame with its Border mask erased), each with CC's mana symbols at
  `<template>/symbol/{w,u,b,r,g,c}.png` for the profile's basic-symbol slot;
- the 2014–19 text-box tokens from 'Regular (Bordered M15)' (4.49 (b)):
  m15tokentext and its artifact dress m15tokenartifacttext;
- the full-art tokens (M20 → today) from the 'Textless', 'Short' and 'Tall'
  token packs (4.48 / 4.50): m20token, m20tokentext, m20tokentall and their
  artifact templates m20tokenartifact, m20tokenartifacttext and
  m20tokenartifacttall — the textless pair re-cut 5 px onto the prints, the
  colourless and artifact type pills darkened to the prints, every type pill
  solid, the artifact name pill slate and solid (PipGlyph composites,
  "Full-art tokens" below);
- the borderless planeswalkers from 'Borderless' and 'Tall Borderless'
  (4.33): m15borderlesspw (three ability rows) and m15borderlesspwtall (four;
  its type bar and ability window 138 px higher), each with the master's own
  shield cut out to `loyalty/` as on m15pw. The regular pack has no
  colourless frame: `c` is its see-through 'Artifact Frame' with its alpha
  lifted ×255/234 (a layer's `gain`), so the rim is opaque like every other
  colour's and the tall pack's 'Colorless Frame'. The gold `m` is MATCHED TO
  THE PRINTS (owner round 15, 2026-09-29): CC's 'Multicolored Frame' paints
  flat tan faces where every mono-gold borderless walker prints a pale cream
  face veined with gold, so the pack's 'White Frame' recolours the m frame's
  title and type faces through CC's Title and Type masks (a `recolour`
  layer: colour only, the alpha below kept, weighted by the white face's own
  luminance — `PW_GOLD_FACE`, fitted to the 13 exact prints;
  `tests/unit/frames/gold-walker-faces.test.ts` holds a built master to
  their range, `tests/unit/frames/fixtures/gold-walker-prints.json`);
- the emblem from 'Planeswalker Emblems' (4.52): `emblem`, CC's one master
  in every colour key (an emblem is colourless), its name pill, silver, type
  pill and text box toned onto the prints and its spark's centre ray bridged
  over above the art window (see [Emblems](#emblems));
- the portrait layouts (4.21a, layout v38): `flip` from 'Flip' (with its
  two P/T plates, cut per creature half from the pack's two-plate image
  through its Top PT / Bottom PT masks into `flip/pt/<k>-top.png` and
  `<k>-bottom.png`; colourless = the pack's see-through frame), `adventure`
  from 'Adventure' and `aftermath` from 'Aftermath' (colourless = each
  pack's artifact frame, a render stand-in that is never offered) — see
  [The portrait layouts](#the-portrait-layouts-layout-v38). Their slots are
  the packs' own (packFlip.js, packAdventure.js, packAftermath.js) and the
  masters are copied 1:1 at their native 1500×2100;
- the transform bodies (5.1a) from the 'Transform' packs: m15dfcfront
  ('Transform (Front)'), m15dfcback ('Transform (Back) (New)', the ▼ at the
  right) and m15dfcbackleft ('Transform (Back)', the empty left well) in
  w u b r g m + `a` (= `c`, the artifact stand-in), the land pair
  m15dfclandfront / m15dfclandback (one master under every key), the ▼
  back's dark P/T plates `m15dfcback/pt/<k>.png`, the backs toned onto the
  prints (`DFC_BACK_TONES`), and the 12 icon riders (`CC_RIDERS.dfcicon`,
  CC's glyph SVGs rasterised at 220 px) — see
  [The transform bodies (5.1a)](#the-transform-bodies-51a).

```bash
node scripts/import-cc-frames.mjs --only m15,m15land
```

- **Source.** The fork at the pinned commit, cached under
  `~/.cache/pipglyph-cc/<commit>`, or set `CC_CACHE`. It takes about
  4 minutes for the M15 family; `--only` builds a subset.
- **Pairs.** m15, m15artifact and m15land also build their two-colour pair
  masters (`<pair>.png`, and m15's hybrid `<pair>-h.png`; TODO 4.6b —
  [The two-colour frames](#the-two-colour-frames-46b)).
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
- **Re-cuts.** Two token recipes move a band of the composited master onto
  the prints before the downscale (`recutBand`): the textless arch
  (`TOKEN_TEXTLESS_RECUT`, 8 px — see [Tokens](#tokens)) and the text-box
  token (`TOKEN_REGULAR_RECUT`). CC's 'Regular (Bordered M15)' master draws
  its lower band ~3 %H above every print: the window ends at 1340 px and the
  pill's outline runs 1356–1477, where TDOM #2, TM19 #1, TC17 #9 and TWAR
  #16 end the art at ~1404–1409 and print the pill's outline at 1420–1540.
  The importer composites the pack as CC draws it, then moves rows
  1240–1559 (the window's straight sides through the top of the text box)
  64 px down as one piece: the rows it opens repeat the window's sides, the
  box keeps its bottom, and each seam is cross-faded over 24 rows. The shift
  puts the pill, the window edge and the box's top edge within 1 px of those
  prints (their title bars sit where CC's does, ±1 px), and the alignment
  score (`lib/frames/align.ts`) agrees: over the 19 reference prints 62 and
  64 px tie at 94.5 % (56 px 93.9, 59 px 94.3, 65 px 94.4, CC's master as-is
  92.8 %, today's m15token over the same prints 93.9 %), and on the four
  ruler prints (TXLN #10, TDOM #2, TM19 #1, TC17 #9) 64 px scores best: the
  published masters 95.0 % (62 px 94.9, CC as-is 93.1; re-scored
  independently in the skeptic pass, which also measured CC's band 60–65 px
  above the prints and the re-cut within ±2 px). Provenance records the
  re-cut (`recut`, `transforms`). A third re-cut moves a block UP in two
  pieces (`recutBlockUp`, `recutUp`): the flip masters' lower half
  (`FLIP_LOWER_RECUT`, layout v39 — [The portrait
  layouts](#the-portrait-layouts-layout-v38)).
- **The borderless land (4.34).** A borderless land prints its colour on
  the title bar, the type bar AND the text box, where a borderless spell
  tints only its title bar (checked on 50+ printings, 2026-09-29). No CC
  file draws that — its 'Land Frame' is the spell look in grey — so
  `borderlessLandLayers` (`scripts/lib/cc-frames.mjs`) builds it in four
  layers: the colour's 'Borderless (Alt)' frame whole (its title bar,
  pinline, bottom bar and fins; the grey Land Frame for colourless); the
  same frame's title bar moved 1081 px down onto the type bar, replacing
  it through CC's Type mask (`replace`: the layer stands instead of what is
  under it, a premultiplied lerp by the mask); genericShowcase's neutral
  text box (#9a9a9a α191 with its bevels and the shadow under the type bar)
  re-tinted to the colour's title-bar tint (`retintStructure`, read at a
  flat pixel the importer asserts), replacing the dark box through CC's
  Rules mask; and the pinline through the pack's Pinline mask on top. `m`
  is the three-and-more-colour land (gold bars, box and pinline); a
  two-colour land prints grey bars with a split pinline and box, which are
  4.6's pair masters (the same function with a letter pair). About a
  quarter of the borderless nonbasic lands print the spells' look instead —
  the colour's title bar over a dark type bar AND a dark box (TDM, WOE,
  ACR, EOE, FIC, FRA #379 / #397–401, many 2024+ SLD drops) — a few a
  dark type bar alone over the tinted box (FRA #380–381, SLD #250 /
  #1989 / #2143 / #7112), and a few the short box (the SNC triomes): none
  is drawn, no reference comes from them, and the registry pins them
  `nearest` (4.37's variants; `BORDERLESS_LAND_DARK_PINS` /
  `BORDERLESS_LAND_DARK_TYPE_BAR_PINS` / `BORDERLESS_LAND_SHORT_BOX_PINS`
  in `lib/scryfall/frame-signatures.ts`, read by eye on every printing it
  called `exact` — compare the title, type and box bands side by side: the
  type bar is the easy one to miss). One rules line starts at the box's
  left, as on M15: the only non-SLD borderless lands printing a single
  line (the ZNR / KHM pathways) do; only SLD #300–304 centre it. w, u and
  g keep ONE reference (MH3 #354 / #350 / #357): the other exact mono-u /
  mono-g prints are Secret Lair scans whose bars show the art through
  (owner round 15), and white dropped Ancient Den SLD #300, an offset scan
  of the centred one-line print (owner round 16; it still imports as the
  exact borderless land). The two-colour pair masters are TODO 4.56 (with
  4.6b).
- **See-through frames.** CC's colourless M15 frame, every devoid frame, the
  colourless creature tokens (both token frames) and the colourless
  planeswalker are see-through, like the printed cards. The profile's
  `underFrameArt` draws the art under the whole frame (TODO 4.17); the
  window keeps its exact crop. Since layout v35 (4.17a) that art starts at
  the black border's inner edge (`UNDER_FRAME_RECT` 3.7/2.7/92.6 × 93.3 —
  the prints' border ends 2.69–2.88 %H down, 3.76–4.16 %W in); v24's
  4/4/92 × 92 left a 25 px #101015 band above every see-through title bar.
  The colourless token is a PipGlyph composite of CC's silver token frame at
  reduced opacity, because CC's bordered token pack has no colourless frame.
  The window keeps its own crop (cover + focal + the card's zoom) and the
  under-frame layer is a separate cover fit, so where they meet the picture
  jumps: the join must lie on an OPAQUE part of the master — the window's
  outline (m15/c, devoid: cols 98–114, rows 220–236 round the window). The
  art-window check holds every see-through master to that (the first pixels
  outside the slot, all round, α ≥ 250) and to the slot covering the window
  itself. A master with no outline to hide the join draws ONE picture —
  `underFrameArt.artSlot` = the under-frame rect, the window a part of it
  (m15pw `c`, v35: translucent from the border to the window, no outline
  down the ability box; its window's picture is ~14 % larger than the
  coloured walkers'). The colourless tokens' join lies in their translucent
  silver (the slot ends 2.5 px short of the outline, and the arch above the
  window is translucent) — a known failure since v34, TODO 4.17c, one
  picture there being an owner decision (it would zoom the token window
  1.34–1.69×). See [Art under and around the
  frame](#art-under-and-around-the-frame).
- **The CC M15 art slot.** The CC-framed M15 profiles (m15, land, snow land,
  artifact, snow, devoid) draw the art in `CC_M15_ART_SLOT`
  (7.67/11.25/84.76 × 44.33, layout v35, 4.4 (2)): CC's artBounds with the
  top 0.04 % higher for 7.6's overscan. Their window is 116–1384 ×
  238–1165 px on every colour; the inherited MSE slot left a 1–1.6 px
  hairline on every side. Adventure's slot is its own, pinned at its
  masters' window + 0.1 % (layout v38, 4.21a).
- **Output.** 1500×2100 PNGs with transparent corners cut at the one card
  corner (64.5 px, see [The card corner](#the-card-corner)), WebP siblings,
  P/T plates at native size, and (full-art basics) the 168 px mana symbols.
  The borderless and full-art masters are native 1500×2100 and copied 1:1
  (no resample).
- **Checks.** Right after the downscale and the corner cut, the importer
  runs the edge contract, the corner check and the art-window coverage on
  every master it builds and exits non-zero on a violation ([Checks every
  master passes](#checks-every-master-passes)).
- **Overlay bands** (`CC_OVERLAY_BANDS`) are printed pieces drawn OVER a
  master, not templates. `m15crown` (4.6a) is CC's black 'Legend Crown
  Border Cover' then the crown (`crowns/new/<k>.png`), composited at
  2010×2814, downscaled once, corner cut and cropped to rows 0–409: one
  1500×410 band per key, CC's nine (w u b r g, m, a, l, c) plus the ten
  pairs (the first colour's crown lerped into the second's across the
  untilted 45→55 %W ramp). The importer fails a band with alpha below row
  409, a peak off row 42 ± 2 or more than a shadow (α ≤ 127) over the art.
  Build it with `node scripts/import-cc-frames.mjs --only m15crown`.
  `extendedcrown` (4.6f, wave 2b) is the extended-art frame's FLOATING
  crown — CC's black cover strip, the crown, the outline on top — composited
  1:1 at 1500×2100 and cropped to rows 0–259, one band per colour key: a
  generic band (`layers` / `findings`; [The extended-art
  crown](#the-extended-art-crown-46f-wave-2b)), built with
  `--only extendedcrown`.

The M15 family shipped in 4.4 (#380): published, git copies deleted,
profiles fixed, one layout bump (v24) and a sweep. 4.32 / 4.39 / 4.49 (b)
followed the same path; a new template needs no sweep (no card sits on it),
while fullartland's re-source was its own template-scoped v30 sweep. 4.34's
borderless land is new too: no bump, no sweep, only its visual-regression
cases added to the baseline. A new
template stays out of the picker until the owner verifies each colour
([Verifying a frame](#verifying-a-frame)); an import never lands on one (the
creator only offers it, once verified). The compare page's alignment score
leaves out printed details a master doesn't draw (`scoreExclusionsFor` in
`lib/frames/align.ts`: on the borderless templates, the arch the rules-box
pinline makes around a rare's holo stamp, until 4.9 draws it).

## The card corner

TODO 3.26, layout v31. One radius for every card corner:
`lib/cards/card-corner.ts`, `cardCornerRadiusPx(w, h)` = 4.3 % of the card's
SHORT side (`CARD_CORNER_OF_SHORT_SIDE` 0.043), never rounded (64.5 px at
1500×2100 and at 2100×1500; Scryfall cuts 4.32–4.34 %). The display CSS, the
bake's transparent corner mask and the frame masters all read it.

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
  only on the allow-list (`CORNER_NORMALISE_TEMPLATES` in
  `scripts/lib/frame-corners.mjs`: retro, retroland, modern, modernland,
  saga, extendedart, fullart, m15textless, m15textlessland, alphatoken, and
  expeditionland w/u/r/c/m, whose paper reached 1–2 px inside the cut;
  adventure — its 1–2 px grey paper rim just inside the arc, added
  2026-09-28 — flip and aftermath left the list with 4.21a, their Card
  Conjurer masters cut by the importer), never on a showcase family
  (`NEVER_NORMALISE`):
  Bloomburrow, LOTR and Tarkir draconic keep their drawn top corners in
  square outputs and print (owner, 2026-09-28). The paint is the border AS
  IT RUNS BESIDE THE CORNER: the edge band's colour at the same depth inside
  the card's outline, sampled along each edge just past the paper (retro's
  scanned border reads 16/16/16/13/8/3 on its outer rows; a flat black paint
  left a 0 → 34 luma step where the old corner ended). The tail follows the
  paper edge's gradient downhill until it meets the border at its depth,
  never deeper than 10 px inside the outline.
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
    `build-variation-frames.mjs`) run the same pass AND gate before they
    write (`normaliseMasterCorners` throws and restores the master on any
    failure), so a rebuild can't bring the white back. Then `npm run
    assets:frame-webp`. (The adventure, flip and aftermath builders were
    retired with 4.21a: those masters are Card Conjurer's, in the bucket.)
  - **Truecolour only.** The normalised masters are truecolour PNGs: a
    lossless palette is impossible (the base palettes were already full at
    255–256 colours and the cut's alpha ramp adds 35–58), and a quantised
    one moves the mask's alpha. sharp's `effort` turns palette quantisation
    on: on a rebuilt adventure master (then MSE's) it moved every pixel of
    the cut's ramp (by up to 52), and the corner check still passed. So the
    builders above write the master the gate checked, truecolour, and
    `tests/unit/frames/frame-corners.test.ts` fails one whose write after
    the gate passes `effort`, `palette`, `quality`, `colours` or `dither`.
    (The showcase, split and Alpha builders, whose masters the pass never
    touches, still quantise; Alpha only without `ALPHA_FULL_COLOUR=1`.)
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

## Checks every master passes

Every master, git or bucket, in every colour, is checked by CI. The Card
Conjurer importer runs the edge contract, the corner check and the
art-window coverage on every master it builds and exits non-zero on a
violation (the files are still written, so read its output before
publishing), and the MSE builders run Phase B's gate (the edge contract and
the corner check among it) on the templates they normalise, refusing to
write a master that fails ([The card corner](#the-card-corner)).
A check's known failures are listed in the check's own table, each with the
TODO item that fixes it: fixing a master means striking its row.

| Check | Where | What it asks |
|---|---|---|
| Manifest | `tests/unit/frames/frame-manifest.test.ts` | well-formed entries; no frame in git AND the bucket; every PNG has its WebP |
| Edge contract (7.7) | `lib/frames/edge-contract.ts`, `tests/unit/frames/edge-contract.test.ts` | each edge is what the template declares |
| Corner check (3.26) | `cornerViolations`, same files | the pixels just inside the card corner are the border |
| Art-window coverage (7.6) | `lib/frames/art-window.ts`, `tests/unit/render/art-window-coverage.test.ts` | the art slot covers the window; translucent parts stay inside it |
| Square corners (3.26) | `lib/frames/square-corners.ts`, `tests/unit/frames/square-corners.test.ts` | the print corner fill matches the master |
| Plate ink (3.29) | `lib/cards/plate-ink.ts`, `tests/unit/cards/plate-ink.test.ts` | every P/T plate has measured ink, pinned to its manifest hash |
| Visual regression (7.1) | `tests/visual/`, `scripts/lib/visual-gate.mjs` | no stored-image change without a layout bump ([Shipping a frame change](#shipping-a-frame-change)) |

- **Edge contract (TODO 7.7).** Each template declares its four edges in
  `lib/frames/edge-contract.ts` (`border`, `art` or `bar`). A violation, or
  a template with no declaration, makes the importer exit non-zero; CI runs
  the same check on every git master and on the bucket masters. A new
  template declares its edges there first; today's known failures are
  listed as expected failures.
- **Art-window coverage (TODO 7.6).** The check flood-fills each master's
  see-through window (α < 16) from the centre of every art slot its profile
  paints (`artSlot`, and a second face's `secondFace.artSlot` turned by its
  `rotation`) and asks the slot to cover it with ≥ 0.05 % of the card to
  spare, and every translucent frame part (α < 250 — a text box or type bar
  the art shows through) with a pixel under the slot to stay inside it,
  give or take a 0.2 % anti-aliased rim; on a see-through master
  (`underFrameArt`, 4.17) the under-frame rect must cover the window and
  every pixel the frame lets ≥ 2 % through, and the window's own slot must
  cover the window too and meet the separately cropped under-frame layer on
  the frame's OPAQUE outline (the first pixels outside the slot, all round,
  α ≥ 250) — or be one picture (`underFrameArt.artSlot`, layout v35). A
  see-through pixel no art covers shows the bake's #101015 (a seam where a
  translucent box runs past the art). `lib/frames/art-window.ts` holds the
  check and its known failures (`ART_WINDOW_KNOWN_FAILURES`), each with the
  TODO item that fixes it and a `maxMissPx` bound it may not get worse
  than; the importer reads the profiles through
  `scripts/lib/ts-alias-hooks.mjs`.
- **The frame-compare save gate (v35).** The editor holds a saved layout to
  the same rule: an override that moves an `artSlot` (or
  `secondFace.artSlot`) is checked on every master the template paints —
  the bake's own masters, bucket ones at the manifest's sha256
  (`lib/frames/art-window-override.ts`) — with CI's verdict (a known
  failure may stay, no worse than its bound), and a failing draft is
  refused with the finding before anything is written.
- **Bucket masters in CI.** CI has no bucket frames of its own: the checks
  job fetches the manifest's PNGs from production's PUBLIC bucket first
  (`node scripts/frames-fetch.mjs`, sha256-checked, cached by the manifest's
  hash, the dev bucket only for a PR's frames not promoted yet) and sets
  `FRAMES_BUILD_DIR`, where a missing bucket master fails instead of
  skipping — so the bucket halves of the edge contract, the art window, the
  square corners and the plate ink run there too. Locally the tests read
  `FRAMES_BUILD_DIR`, else `.frames-build` when it exists (each file
  checked against the manifest's sha256), and skip the bucket masters when
  neither is there: `node scripts/frames-fetch.mjs` (into the gitignored
  `.frames-cache`), then `FRAMES_BUILD_DIR=.frames-cache npm run
  test:unit`.

## Adding a frame

A NEW template is an addition ([Additions vs corrections](#additions-vs-corrections)):
no stored card sits on it, so it ships with no layout bump and no sweep, and
nobody can pick it until the owner verifies it colour by colour.
Re-sourcing an EXISTING template is a correction: the same steps, plus the
layout bump, the owner's before/after sheet and the sweep ([Shipping a
frame change](#shipping-a-frame-change)).

1. **Pick the source** ([Provenance and legal](#provenance-and-legal)). A
   Card Conjurer frame lives in the bucket only; an MSE frame lives in git.
2. **Build the masters.** One 1500×2100 PNG per colour key
   `w u b r g c m` (`FRAME_COLOR_KEYS`; plus `a` only for a profile with
   `artifactMasterKeys`, and the pair masters only for one with
   `twoColorMasters`), 2100×1500 for a landscape frame. The art window
   is cut to α = 0 so the art renders below the frame; the corners are cut
   at the one card corner; each PNG has its WebP sibling.
   - Card Conjurer: a recipe in `CC_TEMPLATES` (`scripts/lib/cc-frames.mjs`),
     then `node scripts/import-cc-frames.mjs --only <template>` into
     `.frames-build/<template>/`. The importer cuts the corners, makes the
     WebPs, runs the checks and writes the provenance.
   - MSE: a builder under `scripts/` writes `public/frames/<template>/`,
     then `npm run assets:frame-webp`. A master whose corner paints
     card-stock paper goes on Phase B's allow-list ([The card
     corner](#the-card-corner)).
   - Plates, badges and symbols the profile draws sit in the template's
     folder (`<template>/pt/<colour>.png`, `<template>/symbol/…`). A new
     P/T plate needs its ink row ([Rules text and the stat
     plates](#rules-text-and-the-stat-plates)).
3. **Register the template** in `types/card.ts`: `FRAME_TEMPLATE_VALUES`,
   `FRAME_TEMPLATE_LABELS` and `FRAME_TEMPLATE_SET` (exhaustive: the
   compiler names what is missing), and where the picker offers it:
   `ERA_TYPE_FRAME`, `TEMPLATE_SKIN_VARIANTS`, a showcase set, or a kind's
   `layoutTemplates` in `lib/creator/card-kinds.ts`. Which kinds a showcase
   or Borderless frame dresses follows from the anatomy its profile draws
   (a showcase with no `loyalty` + `loyaltyRows` refuses planeswalkers, one
   with no `defense` battles), plus a trade-dress row in `TREATMENT_KINDS`
   when the print is one kind's dress ([Kind anatomy and
   bodies](#kind-anatomy-and-bodies)). Give the template its row in
   `tests/unit/cards/fixtures/kind-capabilities.json`. A walker body for a
   treatment is a new template, never anatomy added to one that exists.
4. **Write the profile**: one entry in `PROFILES`
   (`lib/cards/template-layout.ts`). Spread the closest verified profile,
   measure the bands on the master (a column scan: the transparent run is
   the art window, the painted runs the title, type and text bands) and
   tune in the live preview. Sizes come from `lib/cards/typography.ts`,
   never a literal. An M15-era frame joins `M15_FAMILY_TEMPLATES`
   ([Text sizes](#text-sizes-on-the-m15-era-family)). Neither renderer
   changes: both read the profile (a landscape frame sets
   `orientation: "landscape"`). A field the compare page's editor should
   nudge goes in the override schema (`lib/cards/profile-override.ts`).
   An edge-to-edge or full-art frame opts into the pieces it needs
   (`brandMark: BRAND_MARK_ON_ART`, `footerOnArt`, `basicSymbol`,
   `type.split`, `textless`).
5. **Declare its checks** ([Checks every master
   passes](#checks-every-master-passes)): its edges in
   `lib/frames/edge-contract.ts` (required); its square-output corners in
   `lib/frames/square-corners.ts` only where a corner isn't border black;
   a known failure only with the TODO item that fixes it.
6. **Teach the import** ([Which printing is which
   frame](#which-printing-is-which-frame)): a frame-signature rule for the
   printings it reproduces, its fixture and test row, and reference
   printings for every colour that has one (candidates from
   `node scripts/find-frame-references.mjs`, reviewed by a person before
   they land in `lib/cards/frame-references.json`).
7. **Test.** A bucket template first goes to the dev bucket (step 2 of
   [Shipping a frame change](#shipping-a-frame-change)): the checks match
   each master against the manifest. Then `npm run typecheck` and
   `npm run test:unit` (with `FRAMES_BUILD_DIR=.frames-build` for a bucket
   template): the tests that iterate `FRAME_TEMPLATE_VALUES` name every
   other table the template is missing from. Then
   `npm run test:visual -- --update`: the template joins the visual matrix
   by itself, and its new cases need only the regenerated baseline, no bump.
8. **Ship it** ([Shipping a frame change](#shipping-a-frame-change)) and
   **have it verified** ([Verifying a frame](#verifying-a-frame)).
   `supabase/seed.sql` follows production's ticks afterwards, never before.

## Shipping a frame change

1. Build the files into `.frames-build/<template>/…`, which is gitignored.
   The Card Conjurer importer does this. (A git frame skips to step 3.)
2. Publish them to the dev bucket and update the manifest:

   ```bash
   npm run frames:publish -- --source .frames-build --only m15,m15land
   ```

   That is a plan only. Add `--write` to upload and write the manifest. Uploads
   are content-addressed and never overwrite, and the target is refused if it
   is production. Delete any git copy of a published frame; a unit test fails
   while a frame exists in both places.
3. Open the PR. Its preview draws the new frames from the dev bucket. Check
   the frames there, every colour.
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
bump with a `"sweep"` rollout, so owners are never badged, and the owner's
sign-off on a before/after sheet of every frame combo existing cards use
before it reaches production. After the deploy, the automatic re-bake sweeps
the affected cards on its own ([Re-bakes after a
deploy](#re-bakes-after-a-deploy)). CI's **Visual regression** check
enforces the bump: a new frame object changes the matrix's hashes
(`tests/visual/`, `tests/README.md`), so the PR fails until it bumps and
commits the regenerated baseline (`npm run test:visual -- --update`). The job
reads the frames from production's bucket, falling back to the dev bucket
for objects not promoted yet (same bytes: the manifest's sha256 is checked).
A NEW template joins the matrix by itself; its cases only need the
regenerated baseline, not a bump.

## Verifying a frame

Verification is the ONLY gate (owner decision, 2026-07-04): a
(template, colour) combo is offered in the creator exactly when its
`frame_reviews` row is ticked (`lib/cards/frame-availability.ts`, enforced
in the picker and again on save by `frameGateError`). Existing cards keep
rendering whatever they saved. The owner ticks, in `/admin/frame-compare`
on production. No script, migration or agent writes production's
`frame_reviews` or `frame_profile_overrides`; `supabase/seed.sql` only
mirrors production's ticks onto branches and the dev database.

The standard operating procedure for one template:

1. **Before.** The frame is merged and live on production (the bucket
   objects promoted, or the git masters deployed), every colour looked at
   on the PR preview, and CI's checks green.
2. **Check the reference.** The checklist row shows the printing each
   combo is compared with (the registry's default). In the compare view,
   "Change reference card" pins another printing for that combo and
   "Revert to default" restores the registry's pick; a re-pin stales the
   old score. In the registry itself, never replace the DEFAULT reference
   of a combo production has verified: add an alternate and ask the owner
   to re-verify.
3. **Compare.** Overlay, Side-by-side, and Difference (matching pixels go
   dark, misalignment glows). "Score alignment" lines the scan up with our
   render, masks the art and the text, and scores the frame and each
   element as an edge difference (lower is better; the sign-off view also
   shows a match, 100 − the difference). Text never reaches 0: fonts
   differ, so trust the nudge, not the absolute number.
4. **Fix geometry in code.** A profile change ships as a PR (a layout bump
   if stored cards move). The compare page's "Edit layout" saves a
   `frame_profile_overrides` row that goes live for every card on the
   template immediately and marks those cards for a re-bake; use it for a
   quick fix only, then fold the values back into the profile ("Copy as
   TS") and delete the row, so code stays the single source of truth.
5. **Walk the stepper** and **score every colour in one job**
   ([Walking the stepper and signing off a
   template](#walking-the-stepper-and-signing-off-a-template)).
6. **Tick.** Each colour's checkbox, or the template sign-off's
   **Publish**, which needs every colour that has a reference scored on
   today's renderer and override. Colours with no real printing stay on
   their own checkbox.
7. **After.** In the next PR, refresh `supabase/seed.sql` from production
   (the query is in its header), so previews offer the same frames
   production does. A registry rule that names the frame `onceVerified`,
   and the import dialog's Exact badges, follow the tick by themselves.

**Per face (TODO 5.0b).** Every step above is run on ONE face of the
reference printing. A template that is a BACK body of a double-faced card
(`FrameProfile.dfc.role === "back"`; none exists before 5.1a) is compared,
scored, walked and ticked against its printing's **back** face — Scryfall's
`card_faces[1]` and its back scan (the CDN's "back" path) — everywhere,
with no switch to set:
`faceUnderTest(template)` (`lib/cards/dfc.ts`) decides it for the checklist
row (the back thumbnail, a "back face" tag, the Walk link with
`&face=back`), the compare view (a fixed "Back" badge), the Score button,
the tick's recorded score, the sign-off's side-by-side and job, and the
walk-through, whose card is pinned to the body's paired FRONT
(`frontBodyFor`, for the printing's front type) with the live preview
opened on the back. The registry
entries of a back body carry `face: 1`; "Change reference card" on such a
row shows each printing's back art and refuses one with no second face,
one whose back the import drops (a double-faced token, a Role card) or
whose BACK is another colour (`validateReferenceForCombo`). The render is
the back exactly as the card page and the bake will draw it —
`backPreviewData` (`lib/cards/faces.ts`) on the card the import would
store, in the back's own printed colour (`referenceBackColorIdentity`),
with the front's facts in its `dfc.otherFace`. On any OTHER template the
compare view takes `?face=back` — a Front / Back switch appears when the
printing has a back scan — and shows the back as a **legacy back** draws
today (its content on that frame in the front's colour, the way the
imported double-faced cards flip) against the back scan, scores it on the
Score button, and walks it with the preview flipped; the tick and its
recorded score stay the front's. A printing with no such face (one face;
a split, flip or adventure, which is one picture; a double-faced token or
Role card, whose back the import drops) is named instead of silently
measured against the front's scan (`FrameCompareFaceError`), and
`buildFrameComparePayload(id, template)` with no face is byte for byte
what it was (`tests/unit/scryfall/reference-preview-front-snapshot.test.ts`).

**When a tick goes stale.** A tick records the layout version and a hash of
the template's override (migration 0115). It goes stale when a later bump
touches the template (`VERIFICATION_TEMPLATE_SCOPES` when a bump's slots
move on fewer templates than its bakes change on) or the override changes;
`VERIFICATION_NEUTRAL_VERSIONS` (31, 32, 33, 35, 36, 37) never stale one (v36's
4.47 moved the planeswalkers' `symbolRect`, a box the alignment score reads,
but the owner kept it neutral as v32's 15 px m15pw cost-box move was — owner
round 18, 2026-09-30), and a
pre-0115 tick is judged as made at `LEGACY_TICK_LAYOUT_VERSION` (33)
(`lib/cards/frame-verification-state.ts`). A stale tick stays verified —
the creator keeps offering the combo — and the admin pages show "needs
re-verification" until it is ticked again.

## Walking the stepper and signing off a template

TODO Phase 2. Verification is still the only gate (`frame_reviews`), but an
admin can check an unverified frame the way a user would meet it, before
publishing it:

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
  directly), and the banner says which. Art isn't imported. `&face=back`
  (TODO 5.0b) opens the live preview on the back face once the seed is
  applied — a back body's links always carry it, and its card is pinned to
  the body's paired front for the printing's front type
  (`FrameWalkthrough.cardTemplate`, `frontBodyFor`: the land pair under a
  land front); a printing with no second face opens on the front and the
  banner says so. The compare view's walk link also carries the registry
  alternate on screen (`&ref=`), so the walk seeds from the printing the
  view shows — a front template's back view is reached only through a
  double-faced alternate, and the row's default printing may have no
  second face.
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
  each of those colours like a tick and logs `verify` events and one
  `signoff` event. Colours with no real printing stay on their own
  checkbox, which also still withdraws a single colour. A colour whose
  match is below `SIGN_OFF_LOW_MATCH_PCT` (90 %) is marked on its row, and
  Publish first asks "N colours score below 90% — publish anyway?", naming
  them. It is a warning, never a block. The `signoff` event records those
  colours as `lowMatch`.
- **Scoring in one job (4.12).** "Score all N colours" (and "Score N
  colours", the unscored / stale ones) is ONE request to
  `POST /api/admin/frame-score-batch`: the server plans each colour's
  reference from one review read, scores two at a time
  (`SCORE_BATCH_CONCURRENCY`) with one override map, records every score as
  a `score` event (the same path as the per-colour Score,
  `lib/frames/score-record.ts`) and streams NDJSON progress
  (`lib/frames/score-batch.ts`). A run stops starting combos after 200 s
  (`SCORE_BATCH_BUDGET_MS`) and the tab's store
  (`components/admin/score-batch-store.ts`) sends the rest in a follow-up;
  Cancel stops it and keeps what was scored. The view shows a progress
  panel, a per-slot × colour table of scores and nudges with a **Template
  nudge** column (the move most colours agree on — one layout override
  moves every colour; apply it in Compare → Edit layout), and every colour
  **side by side** (our live render next to its printing; each printing is
  looked up once per server instance and reused for 30 min, and a lookup
  unanswered after 8 s shows the sample). When the template's frame set has
  other frames, the **Treatment** panel scores all of them in one job and
  pools the slots they draw on the same rect into one nudge. The job never
  ticks: publishing is still the checkbox or Publish.

Nothing here changes a stored bake or a renderer.

## Which printing is which frame

TODO 1.4. A Scryfall import knows which PipGlyph frame reproduces THIS
printing from the frame signature registry, `lib/scryfall/frame-signatures.ts`:
an ordered rule table (first match wins) over the printing's frame year,
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
nothing but a detail no frame draws — a colour indicator
(`FrameMatch.gaps` ⊆ `UNDRAWN_DETAIL_GAPS`) — doesn't ask: it
lands on its own frame, the Card step shows "Nearest frame" with the reason,
and the deck pre-fill doesn't toast (owner decisions C1–C3, 2026-09-29). The
legendary crown left that list with 4.6a: m15, m15artifact and m15land draw
it, so a crowned printing whose own frame doesn't (snow, devoid …) asks.
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
  the 2014–19 arch until 4.48's template is verified in the card's colour,
  then `exact` on it (`onceVerified` + `exactOnceVerified`, "Full-art
  tokens" below); the
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
- **The borderless planeswalker's tall box follows the rows (4.33).**
  Card Conjurer draws two masters: the regular one for up to three printed
  ability rows and the tall one for four (a loyalty ability is a row, a run
  of static abilities shares one — `walkerRowCount` in
  `lib/creator/card-kinds.ts`; 206 of the 210 printings the
  `borderless/planeswalker` rule matches print the box it picks — Gideon
  Blackblade MED #WS2 prints its two statics as two rows, and Comet UNF
  #275 / #526 its die-roll table on the tall box, Nicol Bolas, Dragon-God
  PS19 #207 four rows on the regular one; `WALKER_ROW_BOX_PINS` makes those
  four `nearest`). Every path picks by
  that count: the registry's borderless family, the creator (its one
  "Borderless Planeswalker" chip stands for both, and the frame follows the
  rows as they change), the import chooser and the AI's frame pick. A
  borderless walker lands on the bordered m15pw (1.18) with Borderless
  Planeswalker offered once verified; `inverted` printings, the
  dark-barred ones (every mono-black one but `LIGHT_BLACK_WALKER_PINS`, and
  `DARK_BAR_WALKER_PINS`' gold PS19 #207) and the two Secret Lair walkers
  that letter their name across the art (`LETTERED_NAME_WALKER_PINS`, SLD
  #1619 / #1622) are `nearest` (owner round 15, 2026-09-29: they stay so,
  and the box stays automatic). A walker with no ability text shows the
  light first stripe in its see-through window, never the bare art
  (`rules.backdropWhenEmpty`, `drawsRulesBackdrop` in both renderers; the
  editor keeps its hint rows).
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
  its stepper walk-through — admin tooling isn't demand), with its cause —
  `missing` (the rule's own nearest / unsupported answer) or `unverified`
  (an exact frame `withVerification` downgraded) — and
  `/admin/frame-requests` counts them per signature + set in those two
  groups, most distinct users first, to decide what to build or verify
  next. Never rename a rule's key: old rows would stop grouping with new
  ones, and the page flags them "not in registry". Split a rule under a new
  key instead.
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

## Additions vs corrections

Owner rule, 2026-09-29. Every change to how cards look is one of two kinds,
and the kind decides the rollout:

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
    badged. Announce it with a site update ([Announcing a
    change](#announcing-a-change)).
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

The "opt-in" `VERSION_ROLLOUT` policy (a "newer look available" badge on
each affected card, `hasNewerLook`) predates this rule; v22 is the one bump
that uses it. `lib/cards/layout-version.ts` explains both policies and
`TEMPLATE_SCOPED_VERSIONS` / `VERSION_SCOPES`, which limit a bump to the
cards it changes.

### Correction round 2 (layout v36)

One sweep for three looks the prints showed wrong (owner rule above; the
before/after sheets are the sign-off, owner round 18, 2026-09-30): inline
rules pips on the capitals at the prints' size (TODO 3.31, [Rules text and
the stat plates](#rules-text-and-the-stat-plates)), Keyrune set symbols at
their set's printed size (4.46) and the planeswalker's symbol at M15's right
edge (4.47) ([Text sizes on the M15-era
family](#text-sizes-on-the-m15-era-family)). No frame master changes.
`VERSION_SCOPES[36]` (`v36Changed`): every card on m15pw, m15borderlesspw
and m15borderlesspwtall; a listed set's code (its Keyrune glyph, or an
uploaded icon the renderers may drop for it — a drawable icon re-bakes to
the same pixels) on a printed-size template; a card whose PRINTED text has
an inline pip (its rules text unless the frame prints none
or it is a basic land's, a saga's chapters, a back face's rules text where
the adventure page or a second face draws it). No template list: the pips
reach every template. Production, anonymous read 2026-09-30: 363 of 879
public / unlisted cards (m15 217, m15land 36, m15artifact 34, m15tokentext
25, m15borderlessartifact 15, m15borderless 10, m15pw 8, m15snow 7, m15devoid
5, modern 3, agclassic / tarkirghostfire / tarkirdragon 1 each; 8 walkers,
14 Keyrune glyphs, 341 pip-only). Real HD bakes of all 879 on v35 and v36
(sha-checked dev-bucket frames): exactly those 363 change and no other; 80
synthetic cards, one per branch of the scope (back faces, sagas, textless
tokens, basic lands, flavor, icons, aliases, the keylined bars), bake as
the scope says, but for its two conservative cases (a drawable icon beside
a listed code; FDN on a keylined bar, whose ring-fitted size rounds to v32's
px — a long type line there still loses the ring's room). The
visual matrix (1,046 cases) against v35: 536 change, every one inside the
scope, and the scope holds no unchanged case. Verification-neutral, the
walkers included (owner round 18; `VERIFICATION_NEUTRAL_VERSIONS`, see
[When a tick goes stale](#verifying-a-frame)): no tick goes stale.

### Nyx's type bar and text box (layout v37)

TODO 4.17e, owner rounds 13 and 18 (2026-09-29 / 30); its own small bump so
v36 shipped without it. MSE's Theros constellation masters paint the type bar
and the text box flat black at α 127.5 (50 %), and since v35 the art runs
under both (4.17b). On the THB constellation prints (#258 Daxos, #259 Heliod,
#268 Klothys; median luminance without the text over the art window's bottom
strip) the box lets 0.28–0.39 of the art through (mean 0.33) and the bar
0.36–0.46; ours let 0.50 through both. The seven masters are rebuilt from
MSE's sources with the box's black at α 171 (0.33 through) and the bar's at
α 150 (0.41, the range's middle; the prints' bar reads 1.19–1.35 × their box,
and 150 over 171 gives 1.25): `node scripts/build-variation-frames.mjs --only
nyx`, which runs `scripts/lib/nyx-tone.mjs` before the corner normalisation
and refuses a master already toned; then the WebP siblings. Only MSE's black
changes (122,130 px on the bar, 766,082 in the box) and the frame's
anti-aliased edge within 3 px of it, which keeps its colour and coverage over
the darker black — 907,896 px per master, rows 1197–1938. Template-scoped
(`TEMPLATE_SCOPED_VERSIONS[37]` = nyx: every nyx card, art or none);
production, anonymous read 2026-09-30: 0 cards on nyx. The visual matrix
against v36: the 19 nyx cases change and no other. Verification-neutral (no
slot moves, and nyx has no tick).

### The portrait layouts (layout v38)

TODO 4.21a (the first of 4.21's three PRs; design 2026-09-29, owner
decisions 2026-09-29): flip, adventure and aftermath leave their 241–375 px
MSE composites in git for Card Conjurer's native 1500×2100 masters in the
bucket (`CC_TEMPLATES.flip` / `.adventure` / `.aftermath`), each copied 1:1
and cut at the one corner. Against the M15 prints (Scryfall PNGs at
1500 × 2100):

- **Flip** sat 30–80 px low from the title bar down (the only M15-frame
  flips, C18 #134 Budoka Gardener and CM2 #71 Nezumi Graverobber: title bar
  71–177 px against ours at 105–215, the window 626–1308 against 648–1393,
  the upside-down type bar 1338–1444 against 1417–1518). Every rect is
  packFlip.js's; the art slot the masters' window + 0.1 %
  (7.57/29.57/84.87 × 33.25 — 115–1385 × 623–1317 px on every colour); the
  top name and type line on the prints' baselines (dy −9.2 / −4.9 px, the
  pips on the name's capitals, costDy −9.6 px, and ending where the prints'
  do: the title rect runs to 92.5 %W — the last disc's edge is 1387 px on
  C18 #134 and 1388.5 on CM2 #71; the pack right-aligns its mana box at
  92.92 %W, its title box ends at 91.46); the upside-down bars placed
  where the prints centre their text (a second face takes no dy); the set
  symbol in CC's box (right edge 78.4 %W, centred 26.0 %H), left of the
  plate. **The P/T plates** (owner 2026-09-29: a CORRECTION — every printed
  M15 flip creature carries one per half; the vehicle plate's opt-in was the
  nearest rule, so it was flagged): the pack draws both plates from one
  image at its bounds through its Top PT / Bottom PT masks; the importer
  cuts them into `flip/pt/<k>-top.png` and `<k>-bottom.png`
  (`FLIP_PT_BOXES`, 243 × 160 px each, the bodies 215 × 126), and a plate
  draws only when its half has a P/T. The bottom plate is upside-down in
  the source, as the card prints it, so both renderers draw it at its box
  UNTURNED and turn only the value (`SecondFacePanel` /
  `SecondFaceBake`; `frameAssetPathsFor` preloads it; its ink row in
  `lib/cards/plate-ink.ts`). **Colourless** = CC's see-through 'Colorless
  Frame' (bars α 191–248, the body between the border and the pinline
  clear, a 15 px opaque pinline round the window): the PROFILES entry draws
  the art under it from the border's inner edge (`UNDER_FRAME_RECT`, 4.17a),
  the window's crop meeting it on the pinline. No crown. The artist credit
  on M15's footer line (3.8's slice; the prints' second border line centres
  at 2019–2020 px). **Where the master itself leaves the prints:** CC drew
  the bottom half as the top half turned, and the cards are not that
  symmetric — on both prints the window ends 9 px higher (the art's edge
  626.5–1308 px against the masters' 623–1317; the frame's inner line
  centred 621 / 1312.5 against 620.5 / 1318.5) and the upside-down type bar
  sits 5 px higher (1339–1444 against 1344–1449), while the upside-down
  name bar agrees (1761–1865 / 1758–1864); the top name bar's interior is
  3.5 px low (75–181 against 72–177). The upside-down type line is set on
  the prints' baseline, so it rides 5 px nearer its bar's art-side edge
  than printed. No profile number moves a master: closing these is a re-cut
  in the importer (as the tokens' `recut`) — **done in layout v39** (the
  4.21a follow-up, owner decision round 22, 2026-10-02, before flip is
  verified): the importer re-cuts the lower half onto the prints
  (`FLIP_LOWER_RECUT`, `recutBlockUp` in `scripts/lib/cc-frames.mjs`).
  Measured on both prints with the master's profile blurred to the scan
  (per-band correlation and half-level crossings; the two prints within
  0.5 px of each other), the window's inner line and the type bar's dark
  top band sit 7 px low on CC's master (the line centred 1311 against
  1318.5; the band's top 1324 against 1331.5), the bar's bottom outline and
  the text box's top edge 5 px low (1444.7 against 1449.7; the box's edge
  ≈ 1465 against 1470.8), and the upside-down name bar is CC's (2 px the
  other way, inside the scans' tolerance). The print's own art edge reads
  1308.5 by the half-contrast detector the table above used, but that
  reading carries the scan's blur: the same detector puts the window's TOP
  edge 3.5 px off on a line that agrees within 0.5 px, so the line is the
  mark. Two pieces move up — rows 1290–1339 (the window's lower rows, its
  line, the pinline, the bar's outline and the first rows of its bevel) by
  7 and rows 1340–1499 (the rest of the bevel, the bar's face, its bottom
  outline, the pinline below and the box's top edge into its paper) by 5,
  split inside the bevel's flat plateau (CC rows 1337–1342; the two rows
  that opens repeat it, and the print's dark band is itself 3–5 px taller
  than CC's) — the seams cross-faded over 24 rows inside the window (the
  frame's side texture, as the tokens' re-cuts), 3 at the split (only the
  bar's 45° end-cap chamfers cross it; the left one lies under the bottom
  plate) and 24 inside the paper. Every row above 1283 and from 1500 on is
  CC's byte for byte; the plates are untouched (the same 28 objects); seven
  new masters (14 bucket objects). The result: the window ends at 1310 px
  (the slot's bottom follows, 33.25 → 32.91 %H), the bar's face 1339–1444
  on every colour (both prints' 1339–1444), its bottom outline centred
  1447 (the prints'), the paper from 1467 (the rules rect follows, 70.1 →
  69.86 %H; the prints' edge ≈ 1464–1466.5 by two readings); the
  upside-down type line keeps its print-matched baseline (its body now
  32–33 px below the bar's face top; the prints' 30–34), the name bar, the
  top half, the cost and the plates do not move. Held by
  `tests/unit/frames/flip-lower-block.test.ts` (the masters, row by row)
  and `tests/unit/render/portrait-v39-bake.test.tsx` (the profile on real
  bakes at HD and 750). Sheets: scratchpad `flip-fu/sheets/`.
- **Adventure** was within 3–10 px on a softer, re-drawn master whose
  window ran 10 / 6 px narrow. The CC master is M15's bars with the
  storybook; the art slot is PINNED at its masters' window + 0.1 %
  (7.57/11.19/84.87 × 44.44; design D4: never M15's MSE slot or
  `CC_M15_ART_SLOT` again — re-inheriting either would itself be a bake
  change); the panel's name and type line 8.14–48.14 %W at 62 px, centred on
  ELD #115's (baselines 1388 / 1481 px), the pips right-aligned to 48.14;
  the pages 8.54–48.01 × 73.58–88.58 and 52.67–91.34 × 65.0–88.58, both
  CENTRING their text as the print does (ELD #115's adventure lines run
  1611–1803 px in the 1545–1860 page, the creature's 1391–1815 in the
  1365–1860 one — the MSE profile set both from the top; the smaller CC
  pages clip a few of the no-clip matrix's longest texts at the floor, as
  the prints' pages would); the type line and pips take the CC-framed M15
  profiles' print offsets
  (`CC_M15_TYPE_DY`, `CC_M15_COST_DY`). The P/T plate stays M15's (the pack
  draws CC's `m15PT<K>.png` at M15's bounds). Colourless = CC's artifact
  frame as a render stand-in, never offered (no printing; owner
  2026-09-29).
- **Aftermath** was within 3–5 px on an MSE stack with flat white text
  boxes; CC's are textured cream. The art slots are the windows + 0.1 %
  (7.57/11.19/84.87 × 22.44; the sideways one's pre-rotation box
  44.63/63.62/49.41 × 20.33); the set symbol in CC's box (right 92.13 %W,
  centred 37.1 %H); the artist credit on M15's footer line. The text slots
  stay as print-matched in 0.22 / v32 — the name and type line, that is:
  the top half's cost was never set on the prints and still ended 27 px
  left of theirs and 8 px low (its last disc's edge 1357.5 px against AKH's
  1384, the discs centred 167 px against 159; the same on the MSE master,
  so no part of the v38 bump). **Layout v39** (the 4.21a follow-up,
  2026-10-02) puts it on the prints: AKH #210–214 and HOU #157 end their
  last disc at 1383–1385 px (mean 1384.0) with the discs centred on row
  158–161 (mean 159.4), so `AFTERMATH.title`'s rect runs to 92.3 %W (was
  90.5) and `costDy` lifts the discs 8.6 px — the bake's last disc ends at
  1384, its discs centre on 159.5; the name's baseline (190 px) and left
  edge, the type line and the set symbol do not move. Colourless = CC's
  artifact frame as a render stand-in, never offered; `aftermath/m` has NO
  reference since v39: no gold // gold aftermath was printed (every
  two-colour one is mono // mono, TODO 4.26's per-part colour), its two HOU
  stand-ins would have been ticked by the template's Publish, so they left
  the registry and the combo stays unverified until 4.26 or a print. The
  signature registry names the same item: a two-colour split or aftermath
  imports `layout/2015+two-colour` blocked by 4.26 (4.6f's dress on the
  other layout frames; `signatureBlockedBy(signature, template)`).

The three left Phase B's allow-list and `ART_WINDOW_KNOWN_FAILURES` (their
masters pass the edge contract, the corner check and the art-window check
in the importer and in CI); their MSE builders and `import-mse-profiles.mjs`
rows are gone. Template-scoped sweep (`TEMPLATE_SCOPED_VERSIONS[38]`:
every card on the three, art or none); production, anonymous read
2026-09-30: 0 public or unlisted cards on any of them (private cards and
previews re-bake on their next save). NOT verification-neutral — the slots
move — but no tick exists to go stale: adventure's seven `frame_reviews`
rows and `aftermath/w` are unverified on production and flip has none, so
the owner's first ticks come after the deploy (flip/g against C18 #134,
flip/b against CM2 #71, adventure and aftermath against their ELD / WOE /
AKH prints; flip w/u/r/m/c, adventure/c, aftermath/c and aftermath/m stay
unticked — owner 2026-09-29, print-referenced combos only). Tick flip PER
COLOUR (its g against C18 #134, its b against CM2 #71): flip w/u/r carry
only 2003-frame references (sample content with the era warning), and a
template's **Publish** ticks every colour that has a reference. Layout v39
(the lower-half re-cut + aftermath's cost) ships before the first flip
tick, so no tick goes stale; its sweep has nothing to re-bake on
production (0 cards on either template, anonymous read 2026-10-02). Masks
stay importer inputs, never published: adventure's shaped book masks and
aftermath's rectangles (cut at y 1139, 54.24 %H) are 4.26's; the flip
plates' half masks are the card's halves.

### Printed pieces a card switches on

TODO 4.6.0. The legendary crown (4.6a) and the two-colour frames (4.6b) are
additions (above): opt-in per card, never a sweep, never a badge. The
plumbing is `lib/cards/anatomy.ts`; 4.6.0 shipped it with no template drawing
anything, and a template only draws a piece once its `PROFILES` entry
declares it — and even then no stored card changes, because only a switch set
to `true` draws it (4.6a: the crown, 4.6b: the two-colour frames, both on
m15, m15artifact and m15land — [below](#the-two-colour-frames-46b)).

- **The switches are card data:** `frame_style.crown` and
  `frame_style.twoColor` (booleans, `frameStyleBaseSchema`). Both renderers
  draw a piece only when its switch is exactly `true`; absent and `false` are
  the look the card always had. So declaring a piece on a template changes
  no stored card, and needs no `CARD_LAYOUT_VERSION` bump.
- **Who sets them:** a new card starts with every switch on
  (`NEW_CARD_ANATOMY` in the creator; `createCardAction` stamps
  `newCardFrameStyle` for a payload that names none — the AI jobs; a remix,
  the creator's or the AI deck remix of an own card, keeps its parent's
  explicit ones, `storedAnatomyOf`). An import
  follows the printing and names only what the printing says (owner round
  17, 2026-09-30: printing-only; `importedAnatomy`): `printed_crown` is
  `true` for Scryfall's `legendary` frame effect, `false` for a Legendary
  card printed without it (M15–RIX, List reprints) and for a Legendary
  showcase, and absent for a nonlegendary printing, a showcase one included
  (owner 2026-09-30); `printed_two_color` is `true` (with
  its pair) for a 2015-frame printing of exactly two colours, else absent —
  never `false`. A switch the printing doesn't name takes the new-card
  default (the save's stamp; the creator's form, `importedFormAnatomy`), so a
  card made Legendary or given a pair later starts on, like any new card.
  A stored card shows each switch OFF with a one-line
  hint in the editor (`AnatomyPanel`) until its owner turns it on; an edit
  sends only `frame_anatomy`, merged over the stored `frame_style`
  (`applyFrameAnatomyPatch`). A switch (and its hint) shows only where it
  can draw: the crown on a Legendary non-planeswalker; the two-colour frame
  on a pair, or a plain `["multicolor"]` card whose cost spans two colours
  or has no coloured pip (`offersTwoColor` — never three colour words, never
  a Multicolor card whose cost spans one or three-plus), and for a LAND only
  on a land frame (`twoColorFits`: m15land, `twoColorForLands`). A two-colour
  land stored with no template draws on m15, whose gold-split isn't a
  land's (Shadowwood Hollow, Sunfade Citadel): the switch is hidden there,
  the save drops it and the renderers don't draw it (owner round 17).
- **Every save** drops a switch its template can't draw for the card
  (`normalizeAnatomy`, with the card's type), so a template that gains a
  piece later (4.6f) never changes a card stored on it before, and a crafted
  payload can't give a land on m15 or m15artifact the two-colour frame —
  judged by the type the card is SAVED with, so a crafted `card_type` change
  to Land drops a switch it had as a creature too (`updateCardAction`).
- **The colour pair** is `color_identity` with exactly two WUBRG words (the
  AI's `multicolor` token is ignored), picked in the Colour step's "Two
  colours" row and pre-filled from the cost (`twoColorFromCost`,
  `useTwoColorPairFollow`, which also takes a pair it filled back to plain
  Multicolor when the card moves to a frame that doesn't draw pairs) — never
  derived at render. On the Pips step a card that holds a pair is prompted
  when its cost names another pair or three colours (the "Switch" prompt). A stored
  `["multicolor"]` card gets it only when its owner switches the two-colour
  frame on (a refinement; a stored mono or three-colour card is never
  re-coloured). The **dress** is print's for the cost (`twoColorDressOf`):
  hybrid when every coloured pip is a two-colour hybrid (or a nonland has
  none), gold-split otherwise — a mixed cost too.
- **A template draws a piece** only through its `PROFILES` entry:
  `overlays` (the crown band: `FrameOverlaySlot` — rect, `{key}` image,
  published `keys`, `keyMap`), `twoColorMasters` (`<template>/<pair>.png`
  split, `<pair>-h.png` hybrid) and `twoColorForLands` (its pairs are a land
  frame's: only there does a land card wear them). Never on a base another
  profile spreads (`M15` is spread by 11 profiles, `M15LAND` by
  m15snowland). All three are code-owned (the override schema refuses them).
- **Renderers:** the overlays draw right after the frame master
  (`FrameOverlayLayer` / the bake's `<img>`s, never a Fragment) and inside
  both finish masks; `frameAssetPathsFor` preloads them;
  `frameMasterKey(..., frameStyle)` paints the pair master; `plateKeyFor`
  gives a hybrid its grey plate. The bake keeps one key list per asset
  family (`FRAME_MASTER_KEYS` with the pair masters, `FRAME_PLATE_KEYS`) and
  loads an overlay with no fallback key (`getFrameOverlayDataUrl`), so it
  reads the file the preview shows (`tests/unit/render/anatomy-key-parity.test.ts`).
- **Registry:** the `crown`, `two-colour` and `two-colour-hybrid` gaps
  (`hybridCost`) drop where the frame the import lands on draws the piece
  (`gapDrawnBy`) — nothing to keep in step by hand.
- **Importer** (`scripts/lib/cc-frames.mjs`): a layer through a list of masks,
  `twoColorRecipe` (CC's cardFrameProperties, corrected) and `CROWN_BAND`.
  The split itself lives in ONE module, `scripts/lib/pair-ramp.mjs`, which
  both the pair masters and the pair crown bands read: the untilted
  `rampMask` (`PAIR_RAMPS`: pinline 40→60, a hybrid's outer frame 44→57,
  text box 45→57, crown 45→55 %W)
  and the premultiplied `lerpLayers` (`blendPair` = the two together).

Turning a piece on for a template (4.6a / 4.6b / 4.6f): build its assets
into `.frames-build`, publish to the dev bucket, declare it on the
`PROFILES` entry (`overlays` for a crown band, `crownMasters` for a crown
baked into `-legendary` twins, `twoColorMasters` for the pairs), update the
pinned sets in `tests/unit/cards/anatomy.test.ts`,
add its cases to the visual matrix (`tests/visual/matrix.ts`: new cases, no
bump), sign it off on a print sheet in the PR, promote, merge, and post the
site update ([Announcing a change](#announcing-a-change)). No bump, no sweep:
a card gets the look when its owner switches it on, and new cards get it by
default.

**The legendary crown (4.6a)** is `M15_CROWN` in
`lib/cards/template-layout.ts`, on the m15, m15artifact and m15land entries
— and, since 4.6f wave 2c, the m15snow and m15snowland entries, whose
masters share the M15 pack's geometry ([Devoid and
snow](#devoid-and-snow-46f-wave-2c)) — never devoid (the owner's call),
adventure, saga, the tokens or a showcase (4.6f and the token items; the
borderless frames draw CC's FLOATING crown from crowned twin masters and
the extended-art frame the same crown as its own band, `EXTENDED_CROWN` —
[The borderless crown and pair
pinline](#the-borderless-crown-and-pair-pinline-46f-wave-2a), [The
extended-art crown](#the-extended-art-crown-46f-wave-2b)). It draws when the switch is
`true`, the supertype has the word Legendary and the card is not a
planeswalker, token, battle or emblem (`qualifiesForCrown`). Its key is the
pinline of the master actually drawn (`resolveFrameOverlays`): the colour,
gold `m` for three or more colours or a pair drawn gold, the pair where the
two-colour frame is drawn (4.6b), and for a colourless card the frame's own
grey — `c` on m15, `a` on m15artifact, `l` on m15land (the slot's
`keyMap`). The band is the top 410 / 2100 of the card at full width; nothing
else moves, and its only mark on the art is the crown's soft shadow over the
window's top rows. `lib/cards/crown.ts` answers `showsCrown` / `crownKeyFor`
for the creator and the admin page, and holds `CROWN_REFERENCES`, the
crowned prints the band is judged against (FDN #2 / #45 / #72 / #91 / #106 /
#243, UMA #6 / #241, FDN #677, NEO #74 / #266–278, M20 #131): the
/admin/frame-compare "Legendary" toggle renders the sample crowned beside
them (a tick still records the combo's own reference). An import's switch is
`printed_crown` (`crownSwitchFromPrinting`) — on for the `legendary` effect;
off for a Legendary card printed without it (M15–RIX, List and playtest
reprints) and for a Legendary showcase, by Scryfall's `showcase` effect or
the registry's showcase signature (MUL's etched run carries only
`legendary` + `etched`); not named for a nonlegendary printing, a showcase
one included (owner 2026-09-30), which gets the new-card default (owner
round 17: printing-only). The standard crowns are Card
Conjurer's as they are — u / r / g too, untinted (owner round 17). No tick
changes: the owner signs the crown off once on a print sheet in the PR.

#### The two-colour frames (4.6b)

40 pair masters in the frames bucket: m15 draws both of print's dresses —
gold-split `<pair>.png` (the gold frame and bars, the pinline and text box
split; FDN #122) and hybrid `<pair>-h.png` (the outer frame split too, CC's
grey land bars, the grey plate `pt/c`; TLA #212 and TLA #223–252) — and
m15artifact (the artifact frame, gold bars and plate; DFT gearhulks) and
m15land (the land frame and bars, the split in the two land tints; MKM
#259–271) the gold-split one. `twoColorMasters` says which, on those three
`PROFILES` entries only.

- **Built by the Card Conjurer importer** (`pairMasterLayers` in
  `scripts/lib/cc-frames.mjs`) over the SAME pack files as each template's
  verified masters, drawn the way those are: m15 and m15land from CC's whole
  image (m.png / a hybrid's two colours / l.png) with the split regions over
  it; m15artifact from regions only, like its coloured artifacts. A split
  region is its two colours' files blended across an UNTILTED ramp by a
  premultiplied lerp — `scripts/lib/pair-ramp.mjs`, the one module the pair
  crown bands read too: pinline 40→60 %W, a hybrid's outer frame 44→57,
  text box 45→57, crown 45→55 (CC's `maskRightHalf.png` tilts +1.35 %W; the
  prints don't). The same run rebuilds the templates' mono masters byte-identical
  to the manifest, and every pair master passes the edge contract, the
  corner check, the square-corner table and the art-window check with no
  known-failure entry (v35's `CC_M15_ART_SLOT` covers their window like the
  mono masters').
- **Measured like the prints** (`tests/unit/render/two-colour-bake-pixels.test.tsx`
  bakes them at HD): the pinline's 10 / 50 / 90 % points at 10.8 and
  55.9 %H within ±1.5 %W of the 47 prints' 42.2 / 50.3 / 58.8 with no tilt;
  the text box's, and a hybrid's outer frame band above the title bar
  (2.95–4.15 %H), each pixel de-shaded against the same pixel of the two
  single-colour bakes, within ±1.0 of the prints measured the same way —
  45.9 / 50.6 / 55.3 (FDN, text-free rows) and 45.1 / 50.3 / 55.6 (TLA ×10);
  the first canonical colour (WU WB UB UR BR BG RG RW GW GU) on the left.
  **Re-measured 2026-09-29 (the 4.6 review), before any card used them:**
  the design had folded the hybrid's frame band into the pinline's 40→60
  (the prints split it steeper: FDN #656 / #668 show both on one card), and
  its text-box and crown figures (47.2 / 51.3 / 56.8; 42.7 / 48.5 / 53.0)
  came from a column profile that the text and the crown's own shading
  skew — so the frame band went 40→60 → 44→57, the text box 46→58 → 45→57
  and the crown 43→55 → 45→55, and the 40 pair masters and 10 pair crowns
  were rebuilt (the mono masters and crowns byte-identical).
- **Which dress:** print's for the cost (`twoColorDressOf`). m15artifact has
  no hybrid plate yet, so an all-hybrid artifact draws the gold-split pair
  (the creator says so under the switch) and its import stays `nearest`
  (`two-colour-hybrid`). What no frame draws yet — sagas, adventures,
  extended art (its crown band draws no pairs: wave 2b), the borderless
  land — keeps the `two-colour` gaps, now pointing at 4.6f (the borderless
  frames draw theirs since wave 2a, the snow frames since wave 2c, below;
  devoid's two-colour printings ARE its gold frame, so the gap is no gap
  there); an M20 token's gaps point at 4.48 (its own central rim split and
  pill crown).
- **With the crown:** a two-colour legend drawn as its pair master wears the
  split crown band `m15crown/<pair>` (the first colour's crown lerped into
  the second's across 45→55 %W, the same `pair-ramp.mjs`), on every dress and
  template; with the two-colour switch off it stays gold under a gold crown.
  Measured on the bands (each pixel de-shaded against the two single-colour
  crowns, rows 4.42–4.66 %H): 46.0 / 50.0 / 54.0 %W at 10 / 50 / 90 % on all
  ten pairs; the prints, measured the same way against their own
  single-colour crowns: 45.5 / 49.3 / 53.6 on FDN's crowned gold pairs
  (#122 #123 #115 #651 #126 #119 #245, MKM #238), 46.4 / 49.4 / 53.6 on
  TLA's hybrids (`tests/unit/frames/crown-band.test.ts` holds ±1.0).
- **Verification (owner decision 2026-09-29, V-A):** a pair rides its
  template's `m` tick — a deterministic recipe over the verified masters,
  like `a` riding `c` — and the owner signs off a pair sheet in the PR
  (10 pairs × dress × template beside the FDN / TLA / DFT / MKM prints, and
  the ramp table). No migration, no tick goes stale. Signed off in round 17
  (2026-09-30), with FDN's UNCROWNED gold prints as the references for the
  W|B, B|G and R|G split crowns (FDN #120 / #125 / #117: FDN printed no
  crowned card in those pairs).

#### The borderless crown and pair pinline (4.6f, wave 2a)

m15borderless and m15borderlessartifact draw both pieces from their own
masters, through the same switches, hints, import rule and registry gaps
as the band frames (`frameAnatomyOf` reads `crownMasters` as "draws the
crown"). Opt-in per card: no stored card changes (every visible production
card on the two frames bakes byte-identical with the switches absent).

- **The crown is a crowned twin, not a band** (`FrameProfile.crownMasters`,
  `lib/cards/master-key.ts`): beside every master the frame paints —
  `w u b r g c m`, the pairs, m15borderless's hybrid pairs — the bucket
  holds `<key>-legendary.png` (`LEGENDARY_MASTER_KEYS`), and a Legendary
  card with `crown: true` paints that twin (`frameMasterKey` →
  `crownedMasterKey`; `crownKeyFor` names its key). Why: the print's crown
  is Card Conjurer's FLOATING crown (its packM15LegendCrownsFloating.js pack,
  `autoBorderlessFrame`), drawn after CC ERASES the strip 3.94/2.77/92.14×
  1.77 % of the frame — rows 58–94 at HD, where the master's title-bar ring
  (its black outer line, rows 85–88, and the α 255 pinline ring under it, in
  the frame's own colour: white on the white master) would show above the
  crown's inner edge and in its end notches — 843 px of it, drawn without
  the erase — then the outline (1416×223 at
  2.8/1.72/94.4×10.62 %) UNDER the crown (1408×215 at 3.07/1.91/93.87×
  10.24 %), all 1500-native, 1:1. An overlay can only add pixels, so the
  importer (`borderlessMasters` / `borderlessCrownLayers`, a layer `at` CC's
  bounds and an `erase` layer) bakes the twins; the plain masters rebuild
  byte-identical. The crown letter is the master's: the colour, M on gold,
  C on m15borderless's see-through frame, A on the artifact dress (its
  colourless master IS CC's artifact frame; CC's crown letter for an
  Artifact type line). What is keyed by the master a card paints — ink
  maps, a see-through master's under-frame art — reads the plain key
  (`baseMasterKey`): the crown changes nothing below the title bar. (Neither
  profile declares an ink map or `underFrameArt` today — the art slot is the
  whole card — so a unit test holds the rule on slots that have them. The
  square-corner table is asked with the key as painted and names no key of
  these frames: a crowned frame that gets a keyed entry there must read the
  plain key too.) The twins' edges are the plain masters' but for the
  crown's peak, which reaches into the top band's 2 % between 46 and 54 %W
  as the prints' does (`CROWNED_EDGE_CONTRACTS`, `edgeContractFor`).
- **The pairs split only the pinline** (`twoColorMasters`: both dresses on
  m15borderless, the split on the artifact dress): the gold M frame with
  the two colours' frames lerped across the pinline ramp (40→60 %W, m15's)
  through the pack's own Pinline mask — the prints' look on the title and
  type rings (FRA #376 / #377, HOB #213, TLA #306, BLC #86, MH2 #321, FRA
  #461, FDN #343–351; the uncrowned FDN #344 / #345 measure 42.0–43.4 /
  50.2–51.2 / 58.4–59.0 at 10 / 50 / 90 %). A HYBRID cost prints the same
  split over CC's grey 'Land Frame' bars (2X2 #374 / #385, SPG #142 / #144,
  ECL #292–296: `cardFrameProperties`'s `typeTitle` L), so m15borderless
  builds `<pair>-h` on the L frame with the grey plate (`plateKeyFor`'s `c`
  = the pack's listed colourless plate, pt/l.png; CC's auto frame names the
  unlisted pt/c.png for its `pt` C — the same grey tone, medians within 3
  levels); a hybrid artifact falls back to the split, like m15artifact.
  m15borderlessartifact's `m` tick (verified 2026-09-28) has two-colour
  references: the switch now gives them their split. Under the pinline the
  split dress first takes CC's Rules and Type regions (the regular M15
  masks CC's own stack lists for those layers) from the two colour frames,
  in place of the gold frame's (`replace`): CC's gold M frame draws its
  type-bar and box rings one row higher than the colour frames, so with the
  M frame kept whole the split masters (and their twins) kept a 1 px gold
  line above the text box's top and bottom pinline (rows 1302 and 1936 at
  HD) that no print has (FDN #344 / #345 go black straight into the
  pinline; the hybrid masters, on the L frame, never had it — found by the
  skeptic on 2026-10-02 and re-cut in #449's review follow-up: the 20 split
  masters per dress differ from the first build in rows 1181–1936 only, the
  other 124 objects byte-identical). `legendary-masters.test.ts` holds the
  two rows to the colour frames' pixels.
- **The pair's crown** is the two floating crowns lerped across
  `PAIR_RAMPS.crownFloating` = 40→60 %W — wider than the standard band's
  45→55: FDN's seven crowned borderless pairs (#343 B|R, #346 W|B, #347 G|U,
  #348 W|U, #349 B|G, #350 U|R, #351 G|U), each pixel de-shaded against the
  set's crowned monos (#294 / #309 / #324 / #330 / #336) inside the crown's
  own alpha, fit an untilted ramp at 41.6 / 50.0 / 58.4 %W on the crown's
  top band (1.9–4.2 %H) and 41.6 / 50.2 / 58.8 on its wrap under the bar
  (9.6–11.9 %H). The same fit on the standard crown (FDN #122 against #2 /
  #45) gives 45.0 / 49.0 / 53.0, the 4.6b figure — the two crowns really
  split differently.
- **References and verification:** the crown rides the colour's tick (both
  frames are verified in all seven colours), the pairs the `m` tick (V-A);
  `CROWN_REFERENCES` names a crowned print per colour for the compare
  page's Legendary toggle (FDN #294 / #309 / #324 / #330 / #336, 2XM #354,
  2X2 #336; the artifact dress LTC #505, FIN #333 / #337, DFT #308, LCI
  #340, MH3 #372, 2XM #362). The registry's `crown`, `two-colour` and
  `two-colour-hybrid` gaps drop on the two frames by themselves
  (`gapDrawnBy`): DMU #435 Sheoldred and 907 of the 925 crowned
  standard-borderless printings behind the crown gap (81 of the artifact
  dress's 92) import `exact` on their own frame (the art still lands them on
  the bordered twin, 1.18); the other 29 fall to their next gap and stay
  `nearest` — a light text box (12), the Vehicle plate (9), Nyx (8).
- **Tests:** `tests/unit/frames/legendary-masters.test.ts` (the keys, the
  recipe, the manifest, the twins' pixels against their masters),
  `tests/unit/render/borderless-crown-bake.test.tsx` (real bakes: the twin
  and the pair in the bake, the switches off byte-identical), the matrix's
  `m15borderless*` `@crown` / `@pair` cases.

#### The extended-art crown (4.6f, wave 2b)

`extendedart` draws the same floating crown as the borderless frames, as an
OVERLAY band rather than crowned twins (`EXTENDED_CROWN` on its `PROFILES`
entry: `extendedcrown/<key>.png`, 1500 × 260, keys `w u b r g m c`),
through the same switch, hints, import rule and registry gap. Opt-in per
card: production holds no visible card on the frame, and the bake with the
switch absent or off is byte-identical.

- **Why a band:** CC's `autoExtendedArtFrame` (its creator-23.js, lines
  1311–1362; `makeExtendedArtFrameByLetter` 2296–2365) draws, for a Legendary card,
  a BLACK 'Crown Border Cover' strip (`img/black.png` at 3.94/2.77/92.14×
  1.77 %) — drawn, not erased, where the borderless frame erases its strip
  — then the floating crown (3.07/1.91/93.87×10.24 %) with the outline ON
  TOP (2.8/1.72/94.4×10.62 %: pushed first, and `drawFrames` draws the
  list reversed). Nothing is removed from the master, so an overlay can add
  it — and the extendedart masters are MSE-built, in git: CC's pixels stay
  in the bucket. The importer composites the three pieces 1:1 at
  1500 × 2100 (every piece 1500-native) and crops rows 0–259
  (`CC_OVERLAY_BANDS.extendedcrown`, the importer's generic `layers` /
  `findings` band: the outline's peak at row 36 ± 1 on the centre column,
  the cover strip opaque black in a crown dip, no alpha below the band).
- **The slot sits 10 px lower than CC's bounds** (`topPct` = 10/2100): the
  print's title bar (FDN #442 / #455) and CC's `m15/new/extended` top out
  at 4.98 %H, our MSE master's at 5.43, so the band is registered on OUR
  bar — the crown's peak lands at row 50 against the print's 42 at
  1500 × 2100, the bar's top at 110 against 99. 4.7's CC-built extendedart
  master takes the offset back to 0 (and brings the print's floating title
  plate and the non-legendary 'Title Cutout', neither of which ours draws).
- **Keys:** the masters' seven colour keys. No pair masters: a pair wears
  the gold crown and the two-colour switch is not offered
  (`frameAnatomyOf("extendedart")` is the crown alone); a colourless card
  wears CC's grey C crown over our grey master (PUMA U1), not the artifact
  crown.
- **References:** `CROWN_REFERENCES.extendedart` — w FDN #442, u #455,
  b #463, r #466, g #470, m M21 #278, c PUMA U1; the crown rides the
  colour's tick.
- **Registry:** the `crown` gap drops on extendedart by itself
  (`gapDrawnBy`). Of the 1,159 crowned extended-art printings behind it,
  740 import `exact`; the 402 two-colour ones fall to the `two-colour`
  gaps (383, and 19 hybrid) and stay `nearest` — this frame draws them
  gold, with the gold crown — 13 fall to the Vehicle plate, and 4 two-part
  prints stay `nearest` for their layout.
- **Tests:** `tests/unit/frames/extended-crown-band.test.ts` (the recipe,
  the slot, the manifest and provenance, the built bands' pixels),
  `tests/unit/render/extended-crown-bake.test.tsx` (real bakes: the band
  inside the slot's rows only, 1:1 at HD, absent / off byte-identical), the
  matrix's `extendedart` `@crown` cases.

#### Devoid and snow (4.6f, wave 2c)

Owner round 20 (2026-10-01): devoid gets NO crown (option (i)); snow gets
crown A — the standard band exactly as on M15, over the snow bars — and the
white-bar pairs on m15snow and m15snowland. Opt-in per card like the rest
of 4.6: every visible production card on the three frames (37 on
2026-10-02: 20 devoid, 16 snow, 1 snow land) bakes byte-identical at 750
and HD with the switches absent; with both on, 7 of them change (the band
on 4 Legendary snow creatures, the pair on 3 snow pairs — one of them a
stored "multicolor" card whose pair the switch pre-fills from its cost).

- **Devoid draws neither — and its two-colour printings import exact.**
  The one crowned devoid printing (M3C #4 Ulalek) is the see-through
  Eldrazi frame with gold bars, not this patterned frame, so the `crown`
  gap stays on m15devoid and crowned devoid imports stay `nearest`. The
  pairs were to be built "checked against BFZ #200 and the three devoid
  `m` references" — and the check says there is nothing to build: every
  two-colour devoid printing on the devoid frame (29 of the 31 two-colour
  printings Scryfall lists for the keyword: BFZ #199–207, OGW #148–150,
  MH3 #177 / #204 / #206 / #208 and their reprints — DDP, M3C, PLST, the
  prerelease stamps, MH3 #517 / #518) prints the UNIFORM gold devoid frame
  — a gold title bar, a gold pinline on BOTH ends of every ring (R − B
  65–119 at every x on the eight measured, where a mono devoid print's
  ring is its colour: blue on BFZ #57, green on BFZ #169; the review
  re-measured thirteen more — BFZ #199 / #201 / #202 / #204 / #205 / #207,
  MH3 #206 / #208 / #517 / #518, M3C #272 / #275, DDP #64 — gold at both
  ends of the body and of the bar, R − B +78 … +119, against blue / green /
  red / white / black monos and the hybrid's green-left blue-right body),
  the silver Eldrazi type bar and the grey plate — which is the `m` master
  m15devoid already draws, verified against three of them (Void Grafter,
  Flayer Drone, Abstruse Appropriation). So m15devoid declares no
  `twoColorMasters`, offers no switch, and the registry's `two-colour` gap
  is no gap on it (`GOLD_PAIR_TEMPLATES` in `lib/scryfall/frame-signatures.ts`):
  OGW #150 and the 28 others import `exact` on the gold frame (the import
  patch's identity is `multicolor`, so the card paints `m15devoid/m`; the
  printing's `twoColor` switch is dropped at the save, as on any frame
  without pair masters), the old "two-colour on devoid" request rows read
  as answered. The other two of the 31: the ONE hybrid devoid printing
  (MH3 #253 Drowner of Truth, an MDFC) prints the split hybrid dress —
  green left, blue right, grey bars — so `two-colour-hybrid` stays a gap
  there (behind the `dfc` gap, Phase 5); MH3 #342 Abstruse Appropriation
  is a borderless `inverted` showcase, not the devoid frame at all (the
  borderless rules take it).
- **Snow's crown is the standard band.** Card Conjurer's 'Snow (Kaldheim)'
  pack (`m15/new/snow/<k>.png`, packSnowNew.js) is the accurate M15 pack's
  geometry — the dark ring rows of its title bar, type bar and box sit on
  the same rows as `new/<k>.png`'s, letter for letter — so `M15_CROWN`
  registers on the snow bar as it does on m15's, `keyMap: { c: "a" }` on
  m15snow (its colourless master is CC's snow ARTIFACT frame: the artifact
  silver crown) and `{ c: "l" }` on m15snowland (DMR #244 Dark Depths, the
  one crowned snow-frame land). The band's black cover strip sits on the
  snow frames' black border. The twelve crowned snow printings — KHM #224
  Narfi U|B, #223 Moritte G|U, #230 Svella R|G (+ 3 PLST), J22 #12 Isu and
  #319 Marit Lage's Slumber (u), PH19 #5 Myntasha and KHM #179 Jorn (g,
  an MDFC), DMR #244 — print the standard crown's shape and registration
  (the peak at row 42 ± 2 at HD, as 4.6a measured it) over a speckled
  texture; no w, b, r or artifact snow crown exists. `CROWN_REFERENCES.
  m15snow` names u (J22 #12), g (PH19 #5) and the gold pair (KHM #224),
  `m15snowland` c (DMR #244). A snow pair's crown is the pair band
  (`m15crown/<pair>`, 45→55): Moritte's G|U crown, de-shaded against KHM
  #179's green and J22 #12's blue crown, reads 43.2 / 48.3 / 51.6 at
  10 / 50 / 90 % against the band's 46.0 / 50.0 / 54.0 — one measurable
  card (KHM printed no b or r snow crown), cross-set references, within
  the texture's noise; the band is shared with m15, not re-cut.
- **The snow pairs are white-bar pairs** (`snowPairLayers` in
  `scripts/lib/cc-frames.mjs`, 4.6b's recipe over the snow pack's files
  through the same six masks): the snow gold frame whole — the gold body
  the prints have (the strip beside the box reads 152/142/126 on all three
  KHM pairs, CC's snow m.png 161/149/124; the blue mono's 111/123/140) —
  with the text box lerped across 45→57 %W and the pinline across 40→60
  (the type-bar and box rings of the three pairs and the ten KHM snow duals
  read a median 42.8 / 50.0 / 57.2 at 10 / 50 / 90 %, 24 of 26 readings
  within 40.8–45.1 / 49.1–51.4 / 55.5–59.4), the GOLD plate (174/154/105
  on all three; the monos print their colour's) — and the bars WHITE: the
  pack's white frame's title and type regions through CC's Title and Type
  masks, warmed a quarter toward the gold bar's (`SNOW_PAIR_BAR_GOLD_SHARE`
  = 0.25, snow/m.png at 25 % through the same masks). Why a quarter: on
  WotC's KHM renders the pairs' bars (246–248 / 241–243 / 239–243) are the
  whitest of the set but for the white mono's (248/245/249), with a faint
  warm cast (R − B +6 … +8, where the blue bar reads −8, the red +10 and
  the white −1) — the gold snow bar at KHM's faint tint; CC's snow m bar
  (236/231/213, R − B +23) is that bar at CC's tint strength, as CC's blue
  bar (220/233/242) is to KHM's (240/239/248). One more gold snow pair
  exists, uncrowned: MB2 #83 Ice-Fang Coatl (2024, white-bordered — it
  imports `nearest` for the border), whose bar reads CREAM, 237/230/211
  (R − B +26, CC's tint strength) on a scan whose border is pure white; so
  the two printers disagree, KHM's three at +6 … +8 and MB2's one at +26.
  The owner's call (round 20)
  is the print's absolute look — white — so the least-squares share of
  (m − w) that reproduces the prints' (pair − w) = (−1, −3, −8) against
  CC's (−8, −13, −29), 0.26, is the recipe; CC's cream `m` bar as it is
  would be one letter away (`typeTitle` "m"). The snow LAND pairs are the
  land recipe over the snow land files: `snow/l.png` whole (its neutral
  bars are every KHM snow land's, basics and duals alike: R − B −1 … −9)
  with the box and pinline in the two land tints, as the ten KHM duals
  print (saturation × 4 shows their box's two tints meeting at the
  centre). No hybrid dress: no hybrid snow print exists; a hybrid snow
  cost falls back to the split, like m15artifact. The #449 hairline can't
  happen on this pack: every ring row of the snow m / snow l frames lies
  inside CC's Pinline mask (`snow-pair-masters.test.ts` holds it, and
  holds every pair master to the two colour masters' lerp inside the mask —
  mean 0.1 level, worst pixel 14 — with no base-pinline pixel outside it).
  V-A: the pairs ride each template's `m` tick, which is referenced to
  KHM #224 (m15snow) and the KHM duals (m15snowland) — the switch gives
  those references their printed look.
- **Tests:** `tests/unit/frames/snow-pair-masters.test.ts` (the recipe,
  the declared keys, the manifest and provenance, the masters' pixels),
  `tests/unit/render/snow-crown-bake.test.tsx` (real bakes: the band
  inside its rows only, 1:1 at HD with the peak at row 42, the pair
  masters, a land's pair on the snow land frame only, absent / off / a
  planeswalker byte-identical), the shared pair table
  (`two-colour-cases.ts`: both renderers), `crown-preview` /
  `two-colour-preview`, `frame-signatures` (KHM #224 / #249, J22 #12, DMR
  #244 and OGW #150 exact; MH3 #253 nearest), the matrix's `m15snow*`
  `@crown` / `@pair` cases.

#### The collector line (4.9b)

TODO 4.9b, owner decisions 2026-09-29/30. The two lines a 2015-frame card
prints in its bottom border — the collector number and rarity letter, the
set code, language and artist — as an ADDITION: `frame_style.collector`
holds a printed style (`"2015"` or `"2023"`), the owner's explicit `"off"`,
or nothing (a card from before the line, which keeps its look and gets the
editor's hint "New: add a collector line and holofoil stamp"); the
foil-printing ★ is `frame_style.star` (`true` or absent — a flag, no sheen,
free for every plan; a Foil or Etched finish prints the ★ without it —
owner 2026-10-02: etched is a foil treatment and every etched print
carries the ★). Both join `FRAME_ANATOMY_KEYS`, so they travel in an
edit's `frame_anatomy` patch like the crown. A new card starts `"2023"`;
a remix starts on unless the parent turned it off; an import follows the
printing (`printed_collector` / `printed_star`, below); every save drops
both keys on a template without the slot. No `CARD_LAYOUT_VERSION` bump, no
sweep, no badge: production's 886 visible cards baked byte-identical at
750 and HD before and after (2026-09-30, a 282-card stratified sample).

- **The slot.** `FrameProfile.collector` (`CollectorSlot`) is `M15_COLLECTOR`
  (the walker's `M15PW_COLLECTOR`: the same geometry, the © slot on line 2)
  on exactly the wave-1 `PROFILES` entries — m15, m15land, m15snowland,
  m15artifact, m15snow, m15devoid, m15pw, the four 2014–19 token frames and
  emblem (`COLLECTOR_TEMPLATES`, `lib/cards/collector-line.ts`; the tokens,
  the walker and the emblem print their lines at M15's positions, TDOM #1 /
  DOM #1 / TFDN #24) — never on the `M15` / `M15LAND` / `M15TOKEN` bases
  other profiles spread, never through an admin override. Wave 2
  (borderless, saga, adventure, extended art, the showcases, the full-art
  tokens) is 4.9d, each template with its own entry.
- **Measured on the prints** (thirteen scans at 1500 × 2100, `M15_COLLECTOR`'s
  notes): both lines from Card Conjurer's pen x 6.47 %W (97 px; the ink
  starts at 96–101); line 1's baseline 1993.5 px and line 2's 2032 (the
  scans' means — CC's bands sit 35.9 px apart, the prints 38.5); capitals
  24–26 px tall, so the 36 px size (0.024 W); the brush's ink at 287 px,
  40 wide, 27 above line 2's baseline to 3 above it, the artist's pen
  46 px after its left edge; the © line's right edge 1403 px (93.54 %W).
- **Content** (`lib/cards/collector-line.ts`, pure): the letter T on a token
  (whatever rarity is stored), E on an emblem, L on a basic land, else
  C / U / R / M. The `"2015"` style pads the number and any stored set size
  to three ("001/016") and stands the letter in a column at the brush's x
  (or one space after a number that reaches it); the `"2023"` style prints
  the letter, a space and the number padded to four ("R 0009"), with any
  "/size" dropped. Line 2: the printed set code, `•` — or the ★ for the
  flag or a Foil or Etched finish — and the printed language code (es prints SP, ko
  KR; the six codes no scan has verified print nothing), then the brush and
  the artist. Empty fields are left out, never invented; never a Wizards,
  ™ or licensor line.
- **Layout** (`lib/cards/collector-layout.ts`): ONE function feeds both
  renderers absolute runs — a pen x, a baseline, a size, the face's own
  line height (ascent + descent, so the browser and Satori put the baseline
  at the same row; Satori's "normal" box drops MPlantin's lineGap, the
  browser's keeps it) — measured from the committed fonts' advances
  (`lib/cards/collector-metrics.ts`, generated by
  `scripts/generate-collector-metrics.mjs`; `display-metrics.ts`;
  `rules-metrics.ts`). The number carries 0.1 em of tracking (the prints'
  pitch). The artist is Beleren Bold in synthesized small caps (capitals at
  38 px, lower-case as capitals at 0.8 of it, word by word), cut with ONE
  "…" before the © slot's content; real Beleren small caps later is a
  correction for collector-on cards (TODO 4.8). `CollectorBake` replaces
  `FooterBake` when the line is drawn (one wrapper div, never a Fragment),
  `CollectorBlock` the preview's footer; `tests/unit/render/collector-bake
  .test.tsx` holds real bakes at HD and 750 to the layout's baselines,
  `tests/unit/components/collector-preview.test.tsx` the preview's boxes.
- **The © slot** (owner Q2): on every DISPLAY surface the pipglyph.com brand
  mark sits there — the same mark at the same size, its right edge on
  93.54 %W, on line 2 when the renderer draws a stat plate (a P/T, the
  loyalty shield, the defense badge — the plate it draws, never the data's
  presence) and on line 1 without one — so the watermark policy is
  unchanged. The planeswalker is the one frame whose MASTER draws its
  shield (the loyalty outline, on all seven colour keys), so its slot is
  always on line 2 (`M15PW_COLLECTOR`, `CollectorSlot.markLine`): a walker
  saved without a loyalty value draws no plate, and a line-1 mark crossed
  the outline (review 2026-10-02). A paid viewer's clean download prints
  the card's `footer_text` there in MPlantin at 34 px, or nothing — cut
  with ONE "…" past 45 % of the card's width (`MARK_TEXT_MAX_WIDTH_PCT`:
  forty characters of ordinary text fit; forty capitals ran back over the
  artist, the set code and line 1's number). Cards without the line keep
  today's mark position.
- **The face.** Montserrat Medium (SIL OFL, `public/fonts/Montserrat-OFL
  .txt`), instanced and subset by `scripts/build-collector-font.mjs` to the
  67 code points the line prints (A–Z a–z 0–9 / - • † space), every one in
  MPlantin's cmap, with no GSUB / GPOS; registered in the bake's fonts
  array as "CollectorLine" — after MPlantin, BEFORE Keyrune, never last —
  and loaded by the preview's `@font-face` with its hhea as metric
  overrides. Satori resolves a glyph through the requested families and
  then every registered font in order, so a glyph only this face had would
  change existing cards' text; and a character NO font has (★, CJK, Thai,
  an arrow — `lib/render/fallback-assets.ts` answers those with nothing)
  is drawn with the LAST registered font: its `.notdef` and advance, and
  the whole word in that face when the word starts with one. Registered
  last, the collector face turned a stored "日本 Dragon" title into two
  boxes and a sans-serif "Dragon" and a "★" in rules text into a 0.59 em
  box (it is a 1 em gap), on cards with no collector key at all (review
  2026-10-02). The subset, the order and a real Satori run with and
  without the face (`tests/unit/render/collector-font.test.ts`) hold all
  three. The ★ and the brush are our own SVG paths
  (`COLLECTOR_STAR_PATH`, `COLLECTOR_BRUSH_PATH`; the brush's slit is an
  evenodd hole).
- **Imports follow the printing** (`lib/scryfall/import-mapper.ts`):
  `printed_collector` is the printing's style by `released_at` against
  `COLLECTOR_2023_FROM` (2023-03-26), or `"off"` for a pre-2015 frame
  (which prints "Illus." in its box); `printed_star` is `true` for a
  foil-only printing (`finishes` all foil / etched: KLD #265 "KLD★EN", ONC
  #29 etched "ONC★EN"). The boundary was pinned on the scans of every
  2015-frame paper printing of February–March 2023
  (`tests/unit/scryfall/collector-style.test.ts`): the two styles overlap
  by PRODUCT for six weeks — PL23 #1, SLD #8001, SLP #1 and SLD #1243–1246
  already print the 2023 style while the Secret Lair bonus cards (#685,
  #716, #681), PRCQ #1, SCH #7, PW23 #1 and P30H #1 (2023-03-21, the last)
  still print the 2015 style; from SLD #728 / #1237–1242 (03-26) every
  scan is 2023-style. `COLLECTOR_2023_STYLE_EARLY` names the early
  products (pl23, slp, sld from #1243), and only from the first one's day
  on (`COLLECTOR_2023_STYLE_EARLY_FROM`, 2023-02-10): Secret Lair has
  numbers past 1243 a year older — SLD #9995–9999 (2022-04-12, the
  mirrored drop) print the 2015 style.
- **Editor, page, warnings.** The Set & collector info step holds the
  switch (`collector-panel.tsx`: on → `"2015"` when the stored number
  carries a set size, else `"2023"`; off → `"off"`), the style chips and
  the ★ switch; a frame without the slot says it prints its own footer. The
  public card page's details block and CreativeWork caption carry "Set ·
  Number · Language" only while the line is drawn (`collectorLineText`).
  The glyph warnings read the footer mark in the body face on a collector
  card. `sampleFramePreview` switches the line on for the walk-through.
- **Verification-neutral:** no frame pixel moves and nothing is bumped, so
  the ticks stay; the visual gate gained 33 new cases (`@collector…`,
  `@collector-etched` since round 22) and changed none — re-proved at
  layout v38 after folding in #451 (0 changed / 0 redefined against main's
  1,051). The stamp (4.9c, below) and wave 2 (4.9d) follow.

#### The holofoil stamp (4.9c)

TODO 4.9c, owner decisions 2026-09-29. The silver oval the 2015 frame prints
in its bottom border on rares and mythics, with the notch the text box's
pinline arches over it — as an ADDITION: `frame_style.stamp` holds `"auto"`
(the oval on a rare or mythic; a new card's default on a frame with the
notch), `"oval"` / `"triangle"` (the owner's "Always", or an import
following its printing's `security_stamp`), `"none"` (the owner's "Never")
or nothing (a card saved before the stamp — cards saved between 4.9b and
4.9c included — which keeps its look and gets the editor's hint "New: the
printed holofoil stamp"). It joins `FRAME_ANATOMY_KEYS`, so it travels in
an edit's `frame_anatomy` patch; a remix keeps its parent's explicit value;
an import always names the printing's (`printed_stamp`: oval → `"oval"`,
triangle → `"triangle"`, anything else → `"none"` — never `"auto"`, so an
unstamped common imported onto a rare's frame stays unstamped); every save
drops the key on a template without the notch (`normalizeAnatomy`). No
`CARD_LAYOUT_VERSION` bump, no sweep, no badge, no verification tick: the
stamp is gated in code by the overlay (`FrameOverlaySlot` with `anatomy:
"holoStamp"`), production's visible cards bake byte-identical with the key
absent, and the visual gate gained its `@stamp…` cases and changed none.

- **The rule** (`lib/cards/holo-stamp.ts`, pure): `holoStampWanted` — "auto"
  on a rare or mythic (23,889 + 7,732 of the 36,545 stamped 2015-frame
  prints; 353 at any other rarity), "oval" and "triangle" always, "none" and
  absent never, and never on a token or an emblem (`STAMPLESS_CARD_TYPES`:
  ordinary tokens and emblems print none; their control is hidden). The
  SHAPE drawn is the frame's own (`FrameOverlaySlot.stamp.shape`): every
  wave-1 notch is cut for the oval, so an imported `"triangle"` draws the
  oval here and keeps its key for a frame that prints the triangle (4.9d's
  lotr / lotrscroll). `resolveHoloStamp` (lib/cards/anatomy.ts) answers
  both renderers, the rules layout and the creator: the notch overlay
  (resolved like the crown — `resolveFrameOverlays`, the master's key
  through the slot's `keyMap`), the oval, the art rect and the keep-out —
  or null. The oval is never drawn without its notch (the straight box edge
  would run through it), so a card drawn as its PAIR master draws no stamp
  in wave 1 (no slot publishes a pair key; the creator says so) — the split
  notch is its own sheet, a follow-up.
- **The oval is ours** (owner Q3): `lib/cards/holo-stamp-art.ts`, a
  280 × 146 PNG data URI generated by `scripts/generate-holo-stamp-art.mjs`
  from an SVG — a neutral mirror-silver gradient, fine diagonal sheen lines,
  a faint holographic tint, a glint, a bevelled rim and a 2 px dark keyline,
  NO symbol — inside a ring of the notch's black. A bitmap because Satori
  draws no gradients; both renderers stretch it over `holoStampArtRect(oval)`
  — CC's 'Plain Holo Stamp' box 45.54 / 91.72 / 8.94 × 3.2 % (683–817 ×
  1926–1993 px at HD, the ellipse the prints' silver fills: M15 #3, KLD #124,
  DMU #107, FDN #1) grown by `HOLO_STAMP_ART_MARGIN_PX` 3 px, one more than
  the importer's cut — ABOVE the finish sheens (z 7 in the preview, after the
  sheens in the bake): a real stamp is foil of its own, never tinted by the
  card's. The walker's oval sits 7 px higher (`M15PW_HOLO_STAMP_OVAL`),
  where CC's walker piece holds its hologram.
- **The notch is Card Conjurer's arch, cleaned** (owner 2026-09-29): every
  one of CC's `m15/holoStamps/m15HoloStamp{W,U,B,R,G,M,A,L,C,A2,A3}.png` and
  `planeswalker/holo/{w,u,b,r,g,m,a,l}.png` holds a capture of WotC's
  hologram inside its oval (the planeswalker symbol tiled in silver), so no
  piece reaches the bucket as it is. `scripts/lib/cc-frames.mjs
  HOLO_STAMP_NOTCHES` (`scripts/import-cc-frames.mjs --only
  m15holostamp,m15pwholostamp`) takes ONE piece per pack as the arch's
  geometry — CC's U, the one flat saturated rim, which decomposes exactly
  into its bevel (white, translucent), rim (0,117,190) and black — tints the
  rim to OUR master's bar (sampled at x 750 where it is flat: rows 1940–1947
  on M15, 1932–1935 on the walker), keeps the bevel and the black, and cuts
  the oval region (the slot's oval plus `HOLO_STAMP_CUT_MARGIN_PX` 2 px, in
  card coordinates) to transparent — `notchFindings` refuses a piece that is
  not clear inside the cut, not black in the 4 px band around it, or whose
  rim foot is not the tint. The tint is the point: CC's holo pack predates
  its accurate M15 pack, so its W rim is a bluish white (252,254,255)
  against our cream bar (244,243,236), its R and G over-saturated (239,56,39
  / 0,123,67 against 209,77,53 / 42,108,69), its C darker (192,191,188
  against 223,224,224); only U matches. The walker rims match our walker
  masters exactly, so the tinted w u b r g m reproduce CC's own pieces
  outside the cut, and the colourless walker — which CC has no piece for —
  is sampled like the rest. Keys: `m15holostamp/{w,u,b,r,g,m,a,l,c}`
  (a = the artifact silver from m15artifact/c, the nearest of CC's three
  artifact rims being A2; l = the land taupe from m15land/c) and
  `m15pwholostamp/{w,u,b,r,g,m,c}` — 32 objects with their WebPs, 192 × 96
  and 182 × 107, 1:1 at HD. Provenance (`lib/cards/frame-sources.json`)
  names the one source piece, the tint per key and the cut; the unused CC
  pieces were fetched and inspected, never published.
- **The slots** (`M15_HOLO_STAMP`, `M15PW_HOLO_STAMP` in
  `lib/cards/template-layout.ts`) are `FrameOverlaySlot`s with `anatomy:
  "holoStamp"` — the slot type is now a discriminated union on `anatomy`
  (`"crown" | "holoStamp"`, each with its own rule in
  `resolveFrameOverlays`; 5.0's DFC icon adds its member) — on exactly the
  seven wave-1 entries: m15, m15land (`c` → `l`), m15artifact (`c` → `a`),
  m15snow (its bars are M15's pixels), m15snowland (`c` → `l`), m15devoid
  (every key → `c`: every devoid bar is the colourless grey) and m15pw (its
  own folder). Never on a token frame, the emblem, a base another profile
  spreads, or through an admin override. M15's slot sits 2 px (0.095 %H)
  BELOW CC's bounds 43.6 / 90.34 / 12.8 × 4.58 %: the piece's rim foot is 11
  rows, cut for CC's older M15 bar, and our accurate-pack bar is 12 (rows
  1938–1949), so at CC's bounds the foot stood 1 px proud of the bar's top
  and the piece's black covered the bar's last two rows — a step at both
  feet; 2 px lower the foot's bottom edge is the bar's own (the importer
  builds the cut at the same offset). The arch's rim then bottoms out at
  1917 px at the centre against the prints' 1910–1912. The walker's slot
  keeps CC's bounds (its foot sits inside the bar).
- **The rules keep-out** (`M15_HOLO_STAMP_KEEP_OUT`: x 655–845 px from 1905
  past the box's bottom, 43.67 / 90.71 / 12.67 × 0.93 %): a glyph-level
  keep-out beside the stat badges (`DrawnStats.stamp` →
  `drawnStatInk`), passed only while the stamp is drawn. A line steps the
  size down only when its ink enters the arch (the matrix's `@stamp-arch`
  text: 50 → 48 px); a short block never moves, and the rules rect itself
  NEVER shrinks — M15's box is `vAlign: "center"`, so a shrink would lift
  every short block ≈ 9 px off the prints. The walker's plain box reads its
  own keep-out; the ability rows keep their shield rule and get the arch in
  4.9d.
- **Renderers:** the notch rides `resolveFrameOverlays` — drawn right after
  the master, inside both sheen masks, preloaded by `frameAssetPathsFor`
  only while the stamp is drawn (a notch that failed to load fails the bake,
  like a master); the oval `<img>` / `HoloStampOval` above the sheens.
  `tests/unit/render/holo-stamp-bake.test.tsx` holds real bakes with the
  real masters and notch pieces at 750 and HD (the stamped bake differs
  from the key-absent one only inside the notch's rows; the notch is the
  piece 1:1 over the master; the oval is the bitmap; the foil bake's oval
  equals the regular bake's), `tests/unit/components/holo-stamp-preview
  .test.tsx` the preview's twins, `tests/unit/frames/holo-stamp-notch
  .test.ts` the recipe, the cut and the published objects.
- **Editor and compare tool.** The Set & collector info step holds the
  stamp switch under the collector line's (`collector-panel.tsx`: the
  switch is on while the card DRAWS a stamp; off writes "none", on writes
  "auto" where the auto rule stamps the card and the frame's shape — the
  chips' "Always" — where it would not, so a common never gets a dead
  click; the chips "Auto: rares & mythics", "Always" (the frame's shape),
  "Never"; the live answer "Rare → stamp"; the pair note), hidden on a
  token or an emblem — whose collector hint then names
  the line alone. `/admin/frame-compare` (and the walkthrough) stamps the
  comparison card when the reference printing carries a `security_stamp`
  (`previewFromImportPatch`), so the notch is judged against the scan's.
  The public card page lists nothing for it: the stamp is card design, not
  data.
- **The collector size quantisation** rode in with this, the first collector
  pixel change (the 4.9b review): every collector run's drawn SIZE is now a
  whole HD pixel in the layout (`quantizedPx`) — the artist's lower-case
  small caps 38 × 0.8 = 30.4 px draw at 30 in BOTH renderers (the bake
  always rounded; the preview drew 30.4). The pen advances keep the nominal
  size, so the bake is byte-identical (the 33 collector cases unchanged);
  quantising the advances too would move the chunk after a lower-case run
  by ≈ 1 px per five letters on every collector card — a correction for the
  first collector-scoped sweep.

### Double-faced cards (TODO 5; the 5.0a plumbing)

Design 2026-10-02 (`design-next/5/final.md`, the owner's seven decisions
Q1–Q7). A **DFC** has two printed faces — a transform card (SOI, MID, BOT…)
or a modal double-faced card (ZNR, KHM, STX…); a two-part layout (flip,
split, aftermath, adventure) is ONE face whose master paints a second panel
and is not one (`templatePaintsSecondFace` stays that inline predicate).
Every PR of Phase 5 is an **addition** under the rule above: new kinds, new
templates, new columns; 0 stored cards change, no bump, no sweep, no badge.
5.0a laid the plumbing with **no pixel and no template** (Visual 0 changed /
0 new / 0 redefined):

- **One card holds both faces (Q1).** `cards.back_face` keeps its 0015
  content shape and gains the back's own BODY (`frame_style: { template }`,
  a back-face template only) and COLOUR (`color_identity`); everything else
  — rarity, finish, set symbol, the collector fields (both faces print the
  card's one collector line, each its own artist), the watermark and the
  anatomy switches — stays card-level. A `back_face` with no body (the 8
  imported DFCs, every row from before Phase 5) is a **legacy back**: drawn
  on the FRONT's template and colour exactly as today, by construction.
  `backFaceSchema` is the gate (no CHECK on the jsonb, 0015 / 0041 by
  design); the actions refuse a body under a front that has no back face,
  and a body that is not a back body (`lib/cards/dfc.ts` `backBodyError`) —
  so until 5.1a's bodies exist no stored card can gain one.
- **Bodies are profiles that declare `dfc`** (`FrameProfile.dfc`: `layout`
  transform | modal, `role` front | back, `well` left | right — the icon
  well's or housing's side — and `land`): a FRONT body is a card's
  template, a BACK body is the back face's and is never a front
  (`templateHasBackFace` = the front role, `isDfcBackBody` = the back).
  Code-owned, set on a `PROFILES` entry only (the override schema refuses
  it); **none is declared yet** — 5.1a brings the five transform bodies
  (`m15dfcfront`, `m15dfcback`, `m15dfcbackleft`, `m15dfclandfront`,
  `m15dfclandback`), 5.1b the four modal ones. `bodyFor(layout, role, face
  type, family)` is the ONE table the creator, the server gate, the import
  and the remix read for which body a face draws on; it is empty until then.
  The colourless `c` row of a DFC body is the ARTIFACT master standing in
  (D2): `colorlessFaceAllowed` offers it only to a face whose type line says
  Artifact.
- **The transform icon FAMILY is one card-level switch**, `frame_style
  .dfcIcon` (`arrows` — today's ▲ / ▼ with the ▼ at the right, every
  transform printed since 2022-11, the default (Q5) — `sunmoon`, `moon`,
  `compass`, `fan`; `spark` arrives with the walker bodies, 5.13). It joins
  `FRAME_ANATOMY_KEYS` after `star`, travels in an edit's `frame_anatomy`,
  and the save drops it on any template that is not a transform FRONT body
  (`normalizeAnatomy`), so today it is always dropped. It picks the back
  body too (`arrows` → the ▼ back, the four left families → the 2016–22
  back; a land back its own whatever the family); the MDFC housing has no
  family. `NEW_CARD_ANATOMY` is unchanged: the family's default is the
  Transform kind's (5.2), not the template's.
- **Cross-face data is derived at render, never stored** (D7):
  `lib/cards/faces.ts` maps one card onto two `CardPreviewData`s —
  `frontPreviewData` / `backPreviewData` / `facesOf` — each carrying a
  `dfc` block `{ layout, role, icon, otherFace }`, the ONE source both
  renderers will draw the icon rider, the front's grey reverse P/T and the
  modal strip from (5.1a / 5.1b; nothing reads it yet). `otherFace` is the
  other face's LAST type word ("Land", "Equipment", "God", "Warrior"), its
  cost or a land's mana ability (`{T}: Add {W}.` — never a land's first
  printed line, D9), and whether it PRINTS a P/T (`printsPowerToughness`;
  the front's tab draws the back's P/T only then and prints empty otherwise,
  Q7). A legacy back gets no block.
- **Four render names, one list.** Migration 0134 adds
  `cards.rendered_back_image_url` / `rendered_back_thumb_url` — the back's
  bake `{owner}/{id}.back.png` and its `.back.thumb.webp` in `card-renders`
  (written by 5.3 only for a card with a back body) — re-creates 0126's
  `cards_guard_render_columns` with both in its `update of` list and body
  (an API role may only CLEAR them) and 0108's `set_cards_updated_at`
  ignoring them (a back bake is not an edit). `renderObjectNames` in
  `lib/cards/bake-core.ts` returns all four and every reader derives from
  it: `isStoredRenderUrl`, `bakeObjectCardId` and the
  `/render-cdn/<owner>/<file>` proxy
  (ONE tag `card-<id>` covers both faces, so the purge is unchanged),
  `removeRenderObjects` (every out-of-view path removes all four names and
  clears every pointer, `CLEARED_RENDER_POINTERS`), the moderation hide,
  and the orphan sweep's `renderCardId` (a `.back.png` of a live card is
  never an orphan — before 5.0a it would have been swept). One
  `layout_version` and one `rendered_at` per card.
- **The tools per face (5.0b):** [Verifying a frame](#verifying-a-frame)
  "Per face" — a back body is compared, scored, walked and ticked on its
  printing's back face by the template alone; any other template's compare
  view takes `?face=back` for a legacy back.
- **What follows:** 5.1a (the transform bodies: masters, riders, the colour indicator,
  the tone pass, a review sheet beside the prints, `frames:promote`), 5.2
  (the Transform and Modal kinds, the back-face panel, the one-click move
  of the 8 imported cards — Q3), 5.3 (both faces baked, the tile flip — Q6,
  `?face=back`, downloads and print), 5.1b (the modal bodies), 5.4 (the
  import and the AI deck remix at 2 credits — Q4). Walker faces wait (ask
  first, 5.13).

### The transform bodies (5.1a)

TODO 5.1a, 2026-10-02 (`feat/dfc-transform-bodies`). Five templates on Card
Conjurer's 'Transform' packs — the first double-faced bodies (`dfc` declared
on their `PROFILES` entries; `bodyFor`'s transform rows filled). Additions
under the owner rule: no stored card changes, no bump, no sweep, no badge;
nothing is offered until the owner ticks each colour (after 5.3, when the
walkthrough bakes both faces).

| template | CC pack | masters | `dfc` | what it draws |
|---|---|---|---|---|
| `m15dfcfront` | 'Transform (Front)' `front{K}.png` | w u b r g m + `a` (= `c`, the artifact stand-in) | front, well left | the icon rider in the well, the name from the icon-face inset, the back's P/T in the grey tab |
| `m15dfcback` | 'Transform (Back) (New)' `new/back{K}.png` | same | back, well right | the ▼ (in the master), no cost, white name / type, the dot, the dark plate |
| `m15dfcbackleft` | 'Transform (Back)' `back{K}.png` | same | back, well left | the family's back glyph in the empty well, the inset name, the dot, the dark plate |
| `m15dfclandfront` | `frontL.png` | one master under every key, `c` verified | front, land | the rider, the tab (INR #287 prints 9/7) |
| `m15dfclandback` | `new/backL.png` | one master under every key, `c` verified | back, land | no cost, no P/T, no dot; dark band ink on the light tan bars (FIN #31) |

Which back a card wears is the family's (`frame_style.dfcIcon`, default
`arrows` — owner decision Q5): `arrows` → `m15dfcback`; `sunmoon`, `moon`,
`compass`, `fan` → `m15dfcbackleft`; a land back is `m15dfclandback`
whatever the family (the 2016–22 parchment land back is TODO 5.8).

- **The masters.** CC's whole images 1:1 (the icon well with its white
  ring, the grey pentagonal tab and the ▼ are the master's); `c` = the
  pack's 'Artifact Frame' standing in (design D2: no colourless non-artifact
  transform face printed on this frame — EMN's Eldrazi backs are see-through,
  TODO 5.11), so `artifactMasterKeys: { c: "a" }` with `a.png` the same
  bytes, and the `c` row is ticked against an ARTIFACT print (LCI #262
  Sunbird Standard // Sunbird Effigy, MID #256 Mystic Monstrosity; LCI #60
  Inverted Iceberg is a BLUE artifact — it draws the blue body, as every
  coloured artifact face does in wave 1). Their own art slot
  (`DFC_ART_SLOT`): the transform packs cut the window 1 px wider than the
  plain M15 masters' on every side (115–1385 × 237–1166), so
  `CC_M15_ART_SLOT` missed the 0.05 % the check asks. Edge contract
  `border` on all four sides, square corners #000, the art-window check
  clean on every master.
- **The tone pass** (design D1: before the first tick, free; after, a
  sweep). CC's back bars and box are off the prints on every key — mostly
  LIGHT (G 81 → 67, U 118 → 96, B 91 → 79, W 168 → 156, A 143 → 126 on the
  bars; the boxes 5–20 light), but the red back DARKER (78 → 97) and the
  land back much darker (127 → 155 on the bars, 158 → 209 on the box: FIN
  #31's light tan bars and cream box, with DARK name and type ink — so the
  land back's bands print dark ink, unlike the coloured backs' white), gold
  within 7. `DFC_BACK_TONES` (`scripts/lib/cc-frames.mjs`) multiplies the
  bars and the box per key through the pack's Title / Type / Rules masks
  (`toneMasked`: the gain fades to ×1 between luma 215 and 245, so the
  well's white ring, the ▼ and the light rims keep CC's tone; the body and
  the plates untouched). Fitted on the medians of the bars' flat face and
  the box of 25 print scans (the design folder's plus nine fetched for the
  fit); every key lands within ±1 luma of its targets
  (`tests/unit/frames/dfc-importer.test.ts` holds the built masters to ±8).
  Recorded per key in `frame-sources.json`.
- **The plates.** The pack's dark `pt<K>.png` (285 × 156) ONCE, as
  `m15dfcback/pt/<k>.png` (the 2016–22 back's profile draws the same set;
  `c` the artifact plate), at M15's plate box with white digits; the lit face
  from 79.3 to 93.0 %W (`inkSpanPct`); a plate-ink row (`PLATE_INK`) with
  its `MEASURED_ON` hashes. The fronts draw M15's plates.
- **The icon riders** (`CC_RIDERS.dfcicon`): the 12 glyphs a printing wears,
  CC's SVGs / PNGs rasterised at 220 px (2× the drawn 110), keys LOWERCASE
  (`default`, `downarrow`, `sun`, `moon`, `fullmoon`, `emrakul`, `compass`,
  `land`, `spark`, `planeswalker`, `fanclosed`, `fanopen` — the bucket's keys
  are lowercase). `FrameOverlaySlot` is now a discriminated union
  (`anatomy: "crown" | "dfcIcon"`); the rider slot (`DFC_ICON_RIDER`, CC's
  icon bounds 5.94 / 5.05 / 7.34 × 5.24 %) is keyed by the family's glyph
  for the BODY's role (`lib/cards/dfc-icons.ts` `DFC_ICON_GLYPHS`) from the
  face's `dfc` block — never from the `dfcIcon` switch, which is off for an
  absent key while the family reads as `arrows`. The front's glyph
  overdraws the master's own ▲; the 2016–22 back's fills its empty well;
  the ▼ back carries no slot (`downarrow` is published but drawn by no
  wave-1 body). Both renderers draw it right after the master, inside both
  sheen masks; `frameAssetPathsFor` lists it (and the dark plate) for the
  face drawn.
- **The name.** On a face with the icon at the left the band starts at
  16.45 %W (`DFC_ICON_FACE_TITLE_LEFT_PCT`) so the first capital's INK lands
  at 250–252 px — the prints' 249–252 (SOI #203, MID #169, INR #60 / #193,
  XLN #22; CC's pack sets its box at 0.16 = 240). The design's 16.7 %W was
  the ink's start; Beleren's side bearing is ~4 px at 80 px, measured on
  real bakes at HD and 750. The ▼ back keeps M15's 8.5 % start, its band
  ending at 82.0 %W (the well's circle starts at 84.7).
- **The reverse P/T** (`DFC_REVERSE_PT`, `StatSlot.align: "end"`): CC's
  'Reverse PT' box, 61 px, #777 (the prints' neutral grey, luma 107–125;
  CC's #666 reads darker), no plate, its right edge run to 92.87 %W so the
  digits' solid ink ends at 1389 px (the builder's reading of the prints,
  1389–1392; CC's edge put them at 1384). Drawn only when the back PRINTS a
  P/T (`dfc.otherFace.printsPt`); the tab prints EMPTY otherwise (XLN #22,
  VOW #12, LCI #158 — owner decision Q7). **Open (skeptic, 2026-10-02):**
  read inside the caps' rows only (clear of the tab's shaded notch, which
  the 1389–1392 reading took in), the prints' digits end at 1378–1390
  (median 1382 on 13 scans — INR #60 1382, MID #169 1384, INR #287 1380,
  SOI #203 1384, LCI #60 1380, MOM #43 1390), ours at 1387–1389: 3–8 px
  right of the same digits. CC's own edge (92.4 %W) lands them at ≈ 1384.
  An owner call beside the dot's 0.3 %W nudge; left as built.
- **The colour indicator** (`lib/cards/color-indicator.ts`, design D4):
  intrinsic to the coloured back bodies (`indicator: "coloured"`), drawn by
  both renderers for any identity with a colour word — Ø 3.5 %W at 9.3 /
  59.0 % with a dark ring outside, the standard mana colours, two colours
  split on the top-right → bottom-left diagonal with the first colour
  top-left, three or more in wedges clockwise from the BOTTOM (BOT #13
  Optimus Prime, Autobot Leader, {U}{R}{W}: blue bottom-left, red centred
  at the top, white bottom-right — a wedge on 12 o'clock, never a boundary;
  the first bake started them at the top, the print's figure turned 180°,
  caught by the skeptic) — the colours in the order the mana cost would
  print them (`canonicalColorSequence`: MOM #43's green-white back prints
  GREEN top-left, {G}{W}; WUBRG order would put white there, which the scan
  refutes; MOM #36's white-black back prints white top-left, as ours); the
  type line
  starts at 13.4 %W while it draws (the prints' ink at 200–204 px). None on
  an artifact / colourless back or a land back. 4.6c adds the per-card
  switch for ordinary cards and reuses the module.
- **Kind and gate.** `KIND_DEFS.transform` (`layoutTemplates:
  [m15dfcfront, m15dfclandfront]`, `cardType` creature), the `dfcFront`
  capability (`FrameProfile.dfc.role === "front"`), `LAYOUT_KIND_CARD_TYPES
  .transform` = creature, artifact, enchantment, land, instant, sorcery;
  a BACK body refuses every kind (`templateRefusesKind`, the server's gate
  too); `kindHasAvailableFrame("transform")` needs a colour verified on a
  front body AND on the default back body. The kind is not a chip of the
  picker until its editor (5.2); `walkthroughKindFor` starts a back body's
  walk on the Transform kind (5.0b flips it to the back).
- **The registry.** A 2015-frame transform printing on a kind the front
  draws is `transform/2015`: nearest on the M15 standard until the front
  body is verified in its colour, then exact on it (`onceVerified` +
  `exactOnceVerified`, the M20 token's model; `dfcFrontDressesKind` lets the
  kind check through); the `dfc` gap drops where the landing body draws the
  marks (`gapDrawnBy` → `templateHasBackFace`). The back bodies have no
  signature of their own (`TEMPLATES_WITHOUT_PRINTED_SIGNATURE`): a
  printing's back wears `bodyFor`'s body (5.4's mapper). References per
  colour per face in `frame-references.json`, `face: 1` on a back body's
  (`referenceThumbUrl` → Scryfall's back scan; the pin check — 5.0b's,
  on the printing's BACK face — holds its colour to the row's, the `c` row
  to an Artifact face where the profile dresses `c` as `a`, a declared
  transform back body to the printings it dresses by icon family and the
  back's type, and the land back (one master, verified on `c`) to any land
  back).
- **The visual matrix.** The front bodies' cases come out of the
  per-template loop (the Transform kind's rows carry a back with a body);
  the back bodies are never a card's own template, so their cases bake the
  row's BACK face (`VisualCase.face`, `backPreviewData`; the fingerprint
  carries `face: "back"`): every back body × 8 colours short / long, HD,
  the families' glyphs on both faces, the empty tab, a foil, the squared
  print, and a legacy-shaped `back_face` on m15 whose front hash is the
  base's. The bake maps a row through `frontPreviewData`
  (`rowToPreviewData`) — the identity for every non-DFC row, byte-identical
  on the corpus.
- **What waits:** the ticks (after 5.3); the editor (5.2) — until then
  `?previewFrames=m15dfcfront,m15dfcback&kind=transform` shows the bodies;
  the back bake (5.3); the import's back body / colour / family (5.4 — until
  it lands, a transform import whose front body is verified lands on the
  front body with a LEGACY back, drawn on the front's master: tick after
  5.4, or accept that window); the modal bodies (5.1b); the parchment land
  back (5.8); see-through colourless faces (5.11); two-colour fronts (5.12);
  the walker faces (5.13, ask first); DFC crowns (4.6f).

## Kind anatomy and bodies

TODO 4.5 (design 2026-09-29) and 4.5.0. A **body** is a template: its
masters plus its profile. What a card KIND needs the frame to draw — its
anatomy — is declared on the body, as fields of its `PROFILES` entry in
`lib/cards/template-layout.ts`, never overlaid onto another template at
render time:

| Kind | Needs (`KIND_REQUIRES`) | Profile fields |
|---|---|---|
| creature | the P/T | `pt` (a plate or ink) |
| planeswalker | the starting-loyalty shield and the ability rows | `loyalty` + `loyaltyRows` |
| battle | the defense shield, on the landscape card | `defense` + `orientation: "landscape"` |
| saga | the chapter rail | `chapters` |
| adventure | the storybook page | `adventure` |
| split, aftermath, flip | the second face | `secondFace` |
| instant, sorcery, artifact, enchantment, land, token, emblem | nothing a body can lack | — |

A basic land's symbol socket (`basicSymbol`) is optional anatomy: a body
without one draws the watermark in the rules box. The P/T of a Vehicle, a
Spacecraft or a Creature token is the same `pt` slot, gated by the card's
type (`printsPowerToughness`).

`lib/cards/kind-anatomy.ts` reads a profile's anatomy from its fields
(`capabilitiesOf` — a spread profile and a builder-made one count alike)
and says whether a body draws a kind (`profileDrawsKind`). Bodies that share
anatomy share a **builder call**, with every value the body's own:
`walkerAnatomy({ shield, stripes, badgeTextHex, maxSizePct,
rulesBackdropHex, … })` builds the walker anatomy of m15pw and both
borderless walkers — the shield (the three differ only by the plate cut
from their own masters), the ability stripes, the badge ink, the walker
text's ceiling and the see-through window's backdrop. Every walker draws
MSE's M15 cost badges today, so the builder takes no badge set yet: 4.5b b3
adds `badges` together with the `LoyaltyRowsSlot.badgeSet` field that
carries it. The output is deep-frozen. There is no registry of shared
overlays: the P/T is per body (22 distinct `pt` slots over 44 templates at
4.5.0), and so is every shield.

### The kind gate

`templateRefusesKind` (`lib/creator/card-kinds.ts`) is two rules; either
refuses:

1. **Capability** — on a showcase treatment or a Borderless skin, the body
   must draw what the kind needs. So the ZNR hedron, the textless and
   extended-art frames and the IP showcases (the Ring and Scroll, Avatar,
   Bloomburrow woodland and Anime, the three Tarkir frames) — P/T only —
   refuse planeswalkers, battles and every layout kind. Border-era
   standards and layout templates are not judged: an off-kind legacy card
   (an artifact stored on plain `m15`) stays savable.
2. **Trade dress** — `TREATMENT_KINDS`, for what a capability can't say:
   the full-art basics, the textless land and the expeditions are land
   dress; Nyx is enchantment dress an Enchantment Creature borrows; the
   borderless skins dress their base's kinds (`m15borderless` no land or
   token, `m15borderlessartifact` artifacts and Artifact Creatures,
   `m15borderlessland` lands, the borderless walkers planeswalkers); the
   emblem frame dresses the emblem alone, and the emblem is an EXCLUSIVE
   kind that wears nothing else.

`templateIsBasicOnly` stays its own per-card check: the Land kind covers
basics and nonbasics alike. The creator's gallery (`framesForKind`), the
server's kind gate (`lib/cards/frame-kind-gate.ts`), reference pinning, the
AI's frame pick and the visual matrix (`kindsByTemplate`) all follow the
one function.

### A template never gains a kind

Owner rule, 2026-09-29. Adding a kind's anatomy to a template that exists —
a shield on the Anime frame, a P/T on the saga — re-dresses every stored
card of that kind on it at its next bake (an edit, an admin re-bake, a
sweep), and the visual gate can't see it: a matrix case that comes back is
a NEW case, which needs no layout bump. So a new (treatment, kind) pair is
a **new template key** (4.5b's `extendedartpw` and `tarkirghostfirepw`,
4.5c's `m15vehicle`), or a stored per-card switch through
`normalizeAnatomy` ([Printed pieces a card switches
on](#printed-pieces-a-card-switches-on)). A correction that must add
anatomy to its own body (4.5c's saga-creature P/T) ships with its layout
bump and a scoped sweep after the owner's sign-off.

`tests/unit/cards/kind-capability-baseline.test.ts` pins every template's
capabilities in `tests/unit/cards/fixtures/kind-capabilities.json`: a gain
(or a loss) fails it, and so does a template with no row. The file holds
the 4.5.0 base map (`baseCapabilities`, never edited — the test pins its
sha256), a `changes` log, and today's map (`capabilities`), which must
equal the base with every change applied. So a row can't change without a
`changes` entry saying why (`gain` / `loss` of one capability,
`new-template`, `removed-template`), for the owner to review. Edited by
hand, never regenerated.

### Type-gated slots

The bake draws a stat plate only for a card that prints the stat: the P/T
under `printsPowerToughness`, the loyalty shield on a planeswalker with a
starting loyalty, the defense shield on a battle with one
(`drawnStatSlots` in `lib/render/card-image.tsx`). It preloads exactly
those plates (`frameAssetPathsFor` calls the same function): a bucket plate
that can't load fails the whole bake, so before 4.5.0 one missing plate
failed every card on its body; now it fails only the cards that draw it.
The preview keeps its own copies of the same gates, except that the editor
shows an empty loyalty shield before a value is typed.
`tests/unit/render/kind-anatomy-preload.test.tsx` bakes every type-gated
case (creature, Creature and word-less tokens, Vehicle, Spacecraft, the
walkers, a battle, a saga creature, an instant with a stray P/T) with an
empty frame cache over a stubbed bucket that publishes every plate, and
fails on any "was not preloaded" warning; the visual bake
(`tests/visual/bake.visual.ts`) empties the cache before every case and
fails a case on the same warning, so a plate one case forgot can't be
served from an earlier case's preload.

The compare page's scoring follows the same split: `listSlotPaths(profile,
kind)` (`lib/cards/profile-override.ts`) lists the loyalty shield, the
defense and the chapter rail for their own kind only, and a score passes
its reference printing's kind (`lib/frames/score-combo.ts`), so a creature
printing is never scored against a walker's shield. The layout editor lists
every slot.

### Adding a body

A new body is a new template: every step of [Adding a
frame](#adding-a-frame), plus —

- its anatomy on its own `PROFILES` entry, through the shared builder where
  one exists (`walkerAnatomy()` for a walker, with the shield cut from its
  own masters);
- its row in `kind-capabilities.json` and a `changes` line;
- a trade-dress row in `TREATMENT_KINDS` when it dresses one kind only (a
  treatment's walker body);
- its square-corner fills (`lib/frames/square-corners.ts`), manifest and
  preload coverage, `lib/cards/frame-sources.json` provenance, and a parity
  case between the preview and the bake;
- the matrix picks it up by itself (its kind, short and long, in every
  colour): new cases, a regenerated baseline, no bump.

The picker's route from a treatment to its body for another kind (4.5b's
`bodyFor`) lands with its first consumer.

### Proving a refactor of the profiles

A change that must not move a pixel (4.5.0's builders) proves it four ways:

- `node scripts/dump-frame-profiles.mjs --check`: every template's profile,
  and its merge with sample admin overrides, deep-equal
  `tests/unit/cards/fixtures/profiles-base.json` (the base commit is in the
  file; `tests/unit/cards/profile-refactor-baseline.test.ts` runs the same
  comparison; `pickerSampleArt`, which no renderer reads, is left out).
  Both renderers read a card's layout only through its profile and its
  master path, so this covers every stored card, private ones too. The
  snapshot stays after 4.5.0: a PR that MEANS to change a profile (a new
  template, a moved rect under its layout bump) regenerates it on its own
  tree (`node scripts/dump-frame-profiles.mjs`) and says why — the fixture
  diff is the profile change, for review. A refactor that has to be proven
  again after main moved a profile regenerates it on the new base (a
  detached worktree at the merge base), never on the branch.
- `tests/unit/creator/kind-gate-baseline.test.ts`: every
  `templateRefusesKind` / `templateSupportsKind` pair, every
  `framesForKind` list and the matrix's kinds per template equal
  `tests/unit/creator/fixtures/kind-gate-base.json`
  (`UPDATE_KIND_GATE_FIXTURE=1` regenerates it, for a change the PR means).
- `npm run test:visual`: every existing case keeps its hash, no bump.
  Each case bakes with an empty frame cache and fails on a "was not
  preloaded" warning.
- A corpus replay: every visible production card baked at 750 px and HD
  on the base and on the branch, over sha-checked frames, byte-identical.

## Text sizes on the M15-era family

TODO 4.20, layout v32. The M15-era family (`M15_FAMILY_TEMPLATES` in
`lib/cards/m15-family.ts`: 40 templates — the 23 of v32's frozen scope in
`lib/cards/layout-version.ts`, plus the two text-box tokens, the six
full-art tokens, 4.33's two borderless planeswalkers, 4.34's borderless
land, the emblem and 5.1a's five transform bodies, new templates that
joined without a bump; split and battle join with 4.21) prints its names, type
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
- draws a Keyrune glyph of a MEASURED set at the size that set prints at
  (layout v36, TODO 4.46; `lib/cards/set-symbol-prints.ts`): a per-set table
  of the prints' keyline-inclusive symbol boxes, [height, width] in HD px —
  30 sets, each measured on a rare and an uncommon regular M15-frame print
  (Scryfall PNGs, the silhouette's half-darkness edge from the bar to the
  keyline). The glyph is fitted INSIDE its set's box by its ink (never
  bigger than the print in either direction) and never wider than CC's
  0.12 W but for the three core-set pills, M19 / M20 / M21, which print
  187.5–189 px wide and draw at their print's width
  (`SET_SYMBOL_PRINTED_PAST_CAP`, owner round 18) — by its ink AND its
  keyline's ring on the borderless bars, which
  draw a white keyline 0.05 em round the glyph (`setSymbolKeyline`, 4.32;
  `SET_SYMBOL_KEYLINE_EM`): the box is keyline-inclusive, and there the
  type line stops a gap before the ring (`inkLeftPct` less the ring). An
  unlisted set on those bars keeps v32's fit, ring not counted, as since
  4.32. Our M15 glyph has no keyline: its flat rarity ink fills the whole
  printed silhouette (a common's reads about 12 px taller than the print's
  black body inside its white keyline — sheet 2g; owner round 18 kept the
  keyline-inclusive box, so FDN grows 78 → 88.5 px). The walker, saga and
  token prints set a set's symbol at the same
  size as its regular cards (0.98–1.01 of the height), so the thin-bar box
  (80 px) no longer shrinks a listed glyph. v32's box fit drew these sets
  0.47–1.03 of the print's height (the wide ones — M20 / M21 / M19 0.47,
  NEO / DSK 0.64, OTJ 0.58 — capped by box × `KEYRUNE_EM_PER_BOX`); the
  table draws them 0.88–1.00 (the core-set pills 0.91–0.92, 78 px tall at
  their print's width — under CC's 180 px cap they were 0.87; they, EOE, OTJ
  and GRN 0.88–0.92 because Keyrune draws them wider in proportion than the
  print, so their width binds). A set not in the table keeps v32's fit
  (owner round 18) — BFZ, WAR and ZNR are measured but left there (v32
  already draws them at the print's size to the whole px on the M15 bars;
  on the walker and saga bars they keep its 80 px box where their prints
  set ~86 — later, TODO 4.46). A wide symbol at its printed width leaves the type
  line less room — DSK's "Enchantment Creature — Avatar Horror" 62 → 59 px
  beside its 151.5 px symbol, where the print keeps 68 (our display face sets
  it wider than the print's, TODO 4.8). The full-art basics keep 4.39's print-checked
  0.065 W glyph (`setSymbolFit: "ink-box"`), whatever the set. A NEW entry
  (or a re-measured one) changes its set's stored bakes: a layout bump whose
  scope names the set. The planeswalkers' `symbolRect` ends where M15's
  band does (92.2 %W, 1383 px — layout v36, TODO 4.47): the walker prints
  put the symbol where their set's regular cards do (+0.1 px on average
  over seven walkers, 1380–1392 px), where 79 %W ended it 18 px short; the
  borderless walkers spread the rect and move with it (owner round 18). A
  symbol wider than a 12 %W `symbolRect` (the core-set pills) is never
  shrunk to it: it ends at the rect's right edge and reaches out on the
  left, in both renderers (`flexShrink: 0`).

Every frame outside the family keeps the old code paths byte-for-byte: no
`fit` flag (the character estimate and the CSS ellipsis) and no box or ink
fit (the symbol drawn at `type.sizePct × 1.1`, or at an override's
`symbolSizePct`, which stays a font size there). Bringing a frame that
stored cards sit on into the family is a layout bump of its own. Rules text
is not part of this standard: it has its own layout (next section).

## Rules text and the stat plates

TODO 3.29, layout v33. Every rules box — the main box on every template, the
adventure page, the flip / split / aftermath second faces — is laid out by
ONE pure module, `lib/cards/rules-layout.ts`, fed by `lib/cards/rules-box.ts`,
and both renderers draw its lines (`RulesBox` in the preview, `RulesBoxBake`
in the bake); neither wraps text itself. The planeswalker ability rows
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
- **Inline pips** (layout v36, TODO 3.31): a disc `RULES_TEXT.pipDiscEm`
  0.785 em across, centred `pipCentreEm` 0.334 em above the line's baseline
  — on the capitals (half MPlantin's 0.682 em cap height), not on the
  x-height and not in the middle of the line box. 37 inline discs on 14
  prints (DOM #168, AER #106, FIN #188, BFZ #223, MH1 #230, ELD #196, SOI
  #258, M20 #178, TDM #126, EOE #170, TFDN #22 / #23, TLCI #17, TMKM #14;
  each disc circle-fitted, the em from its line's cap height) measure
  0.754–0.812 em across and centre 0.323–0.348 em up: 60 px and 25 px at
  76 px type, where v33–v35 drew 65 px centred in the line box (21 px up;
  its bottom 11.5 px below the baseline against the prints' 4.5). The layout
  gives the disc's top in its line box (`metricsFor(…).pipTopPx`, whole px
  per bake: 3 px at 76 HD px, 1 at the 750 bake's 38) and both renderers put
  it there — each run is the line box tall and the pip `alignSelf:
  flex-start` with that margin — and the ink model (headroom, keep-outs)
  reads the same box. A narrower disc makes a pip-bearing line shorter, so
  a line break or a size step can move on such a text. (The prints' inline
  pips have no shadow: TODO 3.17, not part of v36.)
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
  them too) into the test's `MEASURED_ON` — that pin is what fails when a
  promoted plate replaces one the table was measured on. A value printed on
  the art (no plate) keeps its rect clear, a drawn badge (the battle's
  defense) its disc.

## Tokens

TODO 4.49, 3b.15, layout v34: the 2014–19 frame and the type words.

### The 2014–19 arch

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

### The text-box token

TODO 4.49 (b): `m15tokentext` / `m15tokenartifacttext`. The same arch with a
cream type pill and a text box, from CC 'Regular (Bordered M15)' re-cut onto
the prints by its OWN band (`TOKEN_REGULAR_RECUT`: rows 1240–1559 64 px
down, both seams cross-faded over 24 rows — not the textless masters' 8 px
band above), for tokens that print rules or flavour text (TDOM #2 Knight,
TM19 #1 Angel, TXLN #7 Treasure). The profile (`M15TOKENTEXT`) is
M15TOKEN's with:

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

### The text box follows the text

Owner decision 5, 2026-09-29. On the token kind the arch wears its text-box
variation while the card has rules or flavour text and the textless one
while it has none — the renderers' own test, `hasRulesBoxText`
(`lib/cards/card-display.ts`: either column, blank = nothing but what
`String.prototype.trim` removes). `TEXT_BOX_DRESSES` in
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

### Type words

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
them with the word whichever of the migration and the deploy lands first).
The frame follows the Artifact word (`typeWordFrameFor`): there is no
separate "Artifact Token" chip, and stored cards keep their template.

The bump is card-scoped (`VERSION_SCOPES[34]`): every card on the two token
frames, plus a token whose printed line changes on any other template
(`tokenTypeLineChanged` — alphatoken, the showcases, flip's Roles; a
template list would AND those away). It is NOT verification-neutral: the
m15token / m15tokenartifact ticks go stale (`VERIFICATION_TEMPLATE_SCOPES`;
a pre-0115 tick is judged as made at `LEGACY_TICK_LAYOUT_VERSION` 33, so the
14 legacy ones do too) and are re-verified against the new pins in the
walk-through. A stale tick stays verified, so the creator keeps offering
the frames; the wording alone stales no tick anywhere.

### Full-art tokens: M20 → today (TODO 4.48 / 4.50)

Core Set 2020 (2019-07-12) moved tokens to a full-art design, and about three
quarters of token printings since 2014 wear it. PipGlyph draws it with six
NEW templates from Card Conjurer's token packs (its groupToken-2.js), built by
the importer (`m20TokenTemplate` in `scripts/lib/cc-frames.mjs`) into the
frames bucket — never git:

| height | plain | artifact | CC pack | type pill |
| --- | --- | --- | --- | --- |
| no box | `m20token` | `m20tokenartifact` | 'Textless' (re-cut 5 px) | 81.2–88.1 %H |
| regular box | `m20tokentext` | `m20tokenartifacttext` | 'Short' | 66.9–73.7 %H |
| tall box | `m20tokentall` | `m20tokenartifacttall` | 'Tall' | 55.7–62.5 %H |

- **Measure first.** CC's 'Regular' pack (type pill at 64 %H) matches no
  print and is not used; its 'Short' pack is the printed regular box.
  Measured against the prints (Scryfall PNGs at 1500 × 2100, profile
  correlation over each piece; 63 prints, 28 / 19 / 16 by height): the
  regular and tall pills sit +0.9 / +0.7 px from the prints, the name pill
  +1.3, the colour strip −1.0 — used as drawn. The textless pill prints
  4.8 px lower than CC's (its top outline +4.4, bottom +5.7): the importer
  moves rows 1687–1844 down 5 px (`M20_TOKEN_TEXTLESS_RECUT`, hard seams —
  only clear art and the black ring meet them; provenance records it), and
  the profile rides it (`M20_TOKEN_TEXTLESS_RECUT_PX`). After: −0.2 px
  (median) on the textless prints.
- **Colours.** w/u/b/r/g/m are CC's masters, `c` its charcoal `frameC`.
  Two colours land on gold (`m`) until 4.6's gradient; legends wait for
  4.6's crown. The artifact templates are the silver `A` master whole plus
  the colour's master through the pack's Pinline mask — silver pills and
  box, the colour on the rims, pinline and strip (TDSK #7, TSOC #8) — not
  4.16's `m15artifact` recipe; their plates are M15's artifact set.
- **PipGlyph composites** (owner decisions 2026-09-29; `finish` in the
  recipe, `compositeFinish` in `scripts/lib/cc-frames.mjs`, applied to CC's
  flattened pixels before the re-cut, in order, and recorded in provenance;
  an entry may name the colours it applies to, `finishFor`):
  - the colourless and artifact TYPE pills are darkened to the prints
    (round 14): the same print-fitted "tint" as the name pill's slate, on
    CC's flat pill interior only (full weight at its α, none from the first
    bevel α — the bevel, outline and rim keep CC's pixels). Measured behind
    the type line (the pill's interior rows inset 25 px, x 620–1080, the ink
    left out): the plain templates' `c` (`frameC`, a flat 209) takes a flat
    rgb 164/149/143 at 65 % (`M20_COLOURLESS_TYPE_TINT`, `c` only) → rgb
    176/165/160, luminance 168, the median of 4 colourless prints
    (157–180); every colour of the artifact templates (the silver
    `tokenFrameA`, 193) takes rgb 151/170/181 at 65 %
    (`M20_ARTIFACT_TYPE_TINT`) → rgb 160/178/188, luminance 174, the median
    of 16 artifact prints (160–190). The five coloured pills and the gold one
    keep CC's colour (4–12 lighter than the scans: their offset);
  - the TYPE pill is solid, as every print's: CC draws its interior at
    α 204 (`c` 166), so a fifth of the art showed through; every pixel the
    pack's Type mask covers keeps its colour and becomes opaque (after the
    tint: a tint weighs CC's α);
  - the ARTIFACT templates' name pill is the prints' dark slate: CC's
    `tokenFrameA` pill is a silver gradient (luminance ~77 in the middle,
    ~246 at the caps: a white name read 3.5–5.7 : 1 in the bake), where 16
    M20+ artifact prints are slate (luminance 54–71 behind the name, white
    ink 9–11 : 1). A flat rgb 30/40/48 at 65 % source-over CC's translucent
    interior through M15's Title mask (`M20_ARTIFACT_NAME_SLATE`; full weight
    at CC's α 230, none from α 244, so the rims and outline keep CC's silver
    or colour): luminance 63.5 behind the name, white ink 10.4 : 1, the caps
    lighter (~105) as printed. Then that pill is made SOLID (round 14,
    `M20_ARTIFACT_SOLID_NAME_PILL`: α ≈ 246 → 255 through the same mask,
    which covers nothing CC draws below α 230): on flat mid-grey art 61.5
    behind the name, white ink 10.8 : 1.
    `tests/unit/frames/edge-contract.test.ts` holds every master to all of
    them (the tones within the prints' range and 2 of their median, the
    coloured pills at CC's, the artifact name pill at α 255).
- **Profile** (`M20TOKENTEXT` and the heights spread from it,
  `lib/cards/template-layout.ts`): the art to the ring (CC's bounds with
  7.6's overscan), the name in CC's box at `TITLE_SIZE_PCT` — snapped to
  whole px at both bake targets (`M20_TOKEN_TITLE_BOX_PX`, 110 + 114 px at
  HD: CC's 109.62 + 114.03 px set the 750 px preview's name 2 px above the
  bake's; now 1 px, as on the arch token) — white, dark
  on the plain white pill (`inkByColorKey`) — the type line on the pill
  from 8.54 %W at `TYPE_SIZE_PCT`, the set symbol in CC's 86 px box
  (right edge 92.13 %W), the P/T on M15's plate with M15's value box, the
  rules in the box with `rules.alignSingleLine: "center"`. The textless
  height sets 3.24's `textless` flag with `textlessTypeLine` (both
  renderers keep the type band; the rules, flavour and watermark stay
  hidden, and the Text step says so). Onto the prints (medians, HD px):
  name baseline 190 (`M20_TOKEN_TITLE_PRINT_DY`), type baseline 1797 / 1496
  / 1261 (`M20_TOKEN_TYPE_PRINT_DY`), symbol centre 1775 / 1476 / 1241.5
  (`M20_TOKEN_SYMBOL_CENTRE_PX`), digits 3.5 px above M15's value box
  (`M20_TOKEN_PT_PRINT_DY_EM`). `tests/unit/render/m20-token-bake.test.tsx`
  holds real bakes to them, `tests/unit/components/m20-token-preview.test.tsx`
  the preview.
- **Height** (`lib/cards/token-height.ts`, owner decisions 2026-09-29): the
  smallest printed height whose text fits — no text → no box; the regular
  box while it holds the text at `M20_TOKEN_REGULAR_MIN_PX` (72 px, 8.5 pt)
  or more → regular; else tall. WotC sets regular-box text below 9 pt rather
  than grow the box (TTDC #12 Dragon Egg fits at 72). On the 117-print height
  study it agrees on 110 — every tall print stays tall (they fit the regular
  box at 70 px at most); the six regular-box prints WotC sets at 62–70 px
  (TBLB #1, TBLC #23, TINR #13, TMID #7, TSPM #1, TTSR #5) go tall, listed
  in the fixture.
- **The tall box** (calibrated 2026-09-29 on the 17 tall prints): its rules
  rect is 1326–1922 px (`M20_TOKEN_TALL_RULES_PX`): the prints' fullest
  text block — eight lines at 9 pt, TLCI #17 / TBIG #7, ink 1335–1920 — on
  even rows, centred 1 px above the box's middle, where the six prints set
  at 9 pt with our line breaks put their first and last baselines (+0.5 /
  +1 px median; the box-centred 1319–1932 rect set them +2 / +2.5 low, and
  let a text run up to the box's top edge, where the prints keep ≥ 20 px).
  It closes the gaps between abilities before its text shrinks
  (`TextSlot.paragraphGapMinPx`, 10 px — the tall box only): the fit sets
  each size with the paragraph gaps squeezed, 2 px at a time, before the
  next size down, and the layout carries the gap it placed, so both
  renderers draw it. TBLB #5 Warren Warleader prints at 9 pt with 10–13 px
  gaps; with 24 px our last line ran into the P/T plate and stepped down to
  70 px — now 76 px with 12 px gaps, baselines within 2 px of the print's.
  TBLB #9 prints below 9 pt (cap height 51 vs 53 px, line pitch 71 vs
  74–75: ~8.5–8.75 pt, tighter leading) in seven lines; ours is 74 px in
  seven. What the box doesn't reach: the prints' glyphs run ~3 % narrower
  than MPlantin's advances, so a few print one line fewer (TDRC #1), and
  the Universes Beyond boxes (TWHO #32 / #64 run their text past the
  plate's top) stay at 70 px.
- **Import** (TODO 1.23). `token/m20` names the height's template through
  `onceVerified` (family `m20`) and is `exactOnceVerified`: until the
  template is verified in the card's colour the 2014–19 arch stands in —
  `nearest`, "not yet verified in <colour>", marked `unverified` (the
  request log's "Not yet verified") when the full-art template would be
  exact; once it is, `withVerification` makes the match `exact` on it
  (`FrameMatch.onceVerifiedMatch`) — or `nearest` with the gap's own
  reason for a crown, two colours or the Nyx dress (logged "missing"
  either way). A borderless token (`borderless/token`: WONE, WMOM, SLD —
  every one an M20+ printing) names the full-art design the same way once
  it is verified, still `nearest` (the borderless dress is 4.37).
- **Creator** (wired 2026-09-29, `lib/creator/token-frame-auto.ts` inside
  round 11's follow in `components/creator/card-creator-form.tsx`). The six
  are variations of the token kind (`TEMPLATE_SKIN_VARIANTS.m15token`), each
  height's artifact template its Artifact-word dress (`TYPE_WORD_DRESSES`).
  The default switch: a NEW token — the token kind entered on the M15 era's
  arch — starts on the full-art template its text and type words ask for
  once that template is verified in the card's colour (`newTokenFrame`),
  else on round 11's arch pick; per colour and per height, so nothing
  changes until the owner verifies them. The Card step asks type, frame,
  colour in that order and a new card starts colourless, so while the token
  wears the switch's pick a colour picked AFTER the type moves it the same
  way (`defaultTokenFrameIn`, the form's `handleColorIdentityChange`): onto
  the full-art design where it is verified in that colour, back to the arch
  (with a toast) where it isn't, and its colour tiles offer every colour
  one of them is verified in. Before this, a token started colourless
  stayed on the arch in a colour the full-art design was verified in, and
  one started on the full-art design couldn't reach a colour it wasn't
  verified in. Any frame the user picks (Frame section or Variations), an
  import or an AI fill that names a frame, and leaving the token kind end
  it. The arch stays offered, labelled
  "Token (2014–2019)" — the new look's off switch — and stored cards keep
  their frame (an addition, not a correction: "Additions vs corrections").
  Verified in every colour (2026-09-30), the full-art design is labelled
  plain "Token" / "Artifact Token" (", text box" / ", tall text box"; TODO
  4.48a, label-only): toasts read "M15 (2015) Token" beside Alpha's
  "Classic (1993) Token", and the admin pages show the template key.
  The height then follows the text (`followTokenHeight`) with round 11's
  rules: any height picked in Variations sticks, the one the text asks for
  included (`pinsTokenHeight`: the form's one `manual` flag); a
  Frame-section pick goes back to automatic; a stored card whose height
  disagrees with its text keeps it; the Artifact word's dress stays the
  type-word effect's; never an unverified combo (a toast says why).
  `tokenFrameFor` (`lib/creator/card-kinds.ts`), the rule the pickers, the
  AI jobs (`resolveGeneratedFrame`) and the deck remix
  (`autoTokenTextBoxFrame`) share, picks the height too
  (`tokenHeightFrameFor`, P/T-aware): the AI dialog offers the full-art
  token once, never its heights, and an AI or remix token never lands on
  the textless height over text it would hide.
- **Rollout.** New templates, no stored card: no layout bump, no sweep. The
  owner runs `frames:promote`, then verifies each colour (0.9 → 2.2 → 2.4)
  against the references in `lib/cards/frame-references.json`.

## Art under and around the frame

TODO 4.4 (2), 4.17a, 4.17b, layout v35. One correction round for every
place the bake showed its #101015 ground where the print shows art (found by
7.6's art-window check; owner decisions 2026-09-29). Only where the ART is
painted moves — no text, bar, pip, symbol or plate — so v35 is
verification-neutral (as v31–v33) and a "sweep"
([Additions vs corrections](#additions-vs-corrections)):

- **The CC M15 art slot (4.4 (2)).** `CC_M15_ART_SLOT` 7.67/11.25/84.76 ×
  44.33 on m15, m15land, m15snowland, m15artifact, m15snow and m15devoid
  (115.05–1386.45 × 236.25–1167.18 px): the masters' window 116–1384 ×
  238–1165 with 0.95 / 2.45 / 1.75 / 2.18 px to spare (was a 1–1.6 px
  hairline on every side, ≈ 10,000 px of #101015 around every such art).
  CC's own artBounds top (11.29 %) left 0.91 px, short of 7.6's 1.05.
- **Under-frame art from the border (4.17a).** `UNDER_FRAME_RECT`
  3.7/2.7/92.6 × 93.3 on every see-through master (m15/c, m15devoid, m15token
  /c, m15tokentext/c, m15pw/c): the see-through body runs from 58–59 px; the
  art started at 84 px. #101015 px left under the frame (α < 250, not fully
  under art) per master: 42,743 on m15/c and devoid/c — 34,274 of them the
  band above the title bar (34,142 on the token `c`s), the rest down the
  sides — 37,514–37,530 on the token `c`s, 3,024 (sides) on the coloured
  devoids; 0 now.
- **Nyx (4.17b, owner decision).** The art runs under the whole translucent
  type bar and text box, one picture as on the THB constellation prints
  (#258 Daxos, #259 Heliod, #268 Klothys: art to 91.9 %H, the box's light rim
  to 92.7 %): `artSlot` 6/11.2/88 × 81.8, to 93 % (was 70, ending at 81.2 %:
  the box's last 241 px were #101015 — a seam across the rules text). The
  window's crop comes from the taller slot, so a landscape picture sits
  about 17 % larger in the window than before. The bar and box over it are
  the prints' darkness since layout v37 (α 150 / 171, was MSE's 128 —
  [Nyx's type bar and text box](#nyxs-type-bar-and-text-box-layout-v37)).
- **fullart (4.17b).** `artSlot` 3.8/2.7/92.4 × 90.3: to 93 % (was 88.3: a
  31 px dark strip along the translucent box's bottom) and out to whole
  pixels past the hedron ring's anti-aliased rim (57–1443 × 56.7 px; the
  rim, α 128–249 on rows 59–60 and columns 59 / 1440–1441, was 7,956 px
  half-dark over #101015 — a thin line along the art's top). The ZNR prints
  paint that box as an opaque hedron panel; our MSE master's is translucent
  (α 179) — a re-source question, not this fix.
- **m15pw `c` (4.17b).** CC's colourless planeswalker is see-through (α ≈ 180
  body, translucent type bar; DOM #1 Karn, M21 #1 Ugin) and had no
  under-frame art: 334,216 px of it showed #101015. It gets
  `underFrameArt { colors: ["c"], artSlot: UNDER_FRAME_RECT }` — ONE
  picture, the window drawn in 4.17a's rect too. (The first build kept
  M15PW's slot over a separate under-frame layer: its edges, 5 px past the
  window in the silver, seamed all round.)
- **The see-through rules (7.6 + the save gate).** On a see-through master
  the window's slot must cover the window too (an m15devoid artSlot override
  moved inside the window used to save — every devoid master is see-through
  and only the under-frame rect was judged) and meet the under-frame art on
  the opaque outline, or be one picture.

Scope (`VERSION_SCOPES[35]`, frozen `V35_ART_SLOT_TEMPLATES` /
`V35_SEE_THROUGH_C_TEMPLATES`): every card on the six CC M15 profiles, nyx and
fullart (the legacy templates drawn as m15 included; with no art the empty
art box moves too), and on m15token / m15tokentext / m15pw only a colourless
card with art (m15pw/c's one picture, too, only under art: without art its
empty box stays in M15PW's slot). Production, anonymous read 2026-09-29: 740
of 827 public / unlisted cards (m15 611, m15land 49, m15artifact 37,
m15devoid 20, m15snow 13, m15tokentext 9 of 33, m15pw 1 of 7; none on
m15snowland, m15token, nyx, fullart); re-baked on v35, every one of the 740
changes, only inside its art rects, and no card outside the scope does. The
visual matrix (841 cases) against v34: 162 stored cases change + 1
print-only one (`m15/w/creature-short@square`, which the gate exempts), all
inside the scope, and the scope holds no unchanged case; 8 no-art cases are
new (the empty-art box on v35's slots, and no under-frame change without
art).

Previews: Vercel previews on the dev DB are never swept (the auto-rebake
cron runs in production only), so a preview's stored bakes — gallery tiles,
OG images, free downloads — stay at v34 while its creator draws v35. Judge a
v35 change in the creator's live preview, or re-save a `dev_*` card.

## Emblems

TODO 4.52 + 6.23. CR 114: an emblem has no colour, mana cost, types, rarity
or P/T, and every one printed since M20 (2019-07-12) is on one silver frame
— the source planeswalker's name in a dark bar, the art in a
planeswalker-spark cut-out, a type bar reading "Emblem", a light text box.
The `emblem` template is Card Conjurer's 'Planeswalker Emblems' master
(`CC_TEMPLATES.emblem`: its bars, box and border sit within 3 px of eight
prints, so nothing moves), one master for every colour key (only `c` has
references: TFDN #25 Vivien Reid, TFDN #24, TDSK #17), with these touches
onto the prints (TFDN #24 / #25, TM20 #11, TDSK #17, TBLB #30, TFRA #16):

- **The name pill, toned** (`EMBLEM_NAME_PILL_TONE`, `toneRegion`). CC's pack
  draws `frame.png` alone — no darkening layer — and its pill is a light
  gradient (median luma 90 over the name band) where the prints print a dark
  one (52). The pill's body (inside its dark outline, under CC's highlight)
  is multiplied by a gain fitted on the six M20 prints, by distance from the
  pill's centre, and made opaque.
- **The silver, the type pill and the text box, toned** (owner decision
  2026-09-29: `EMBLEM_SILVER_TONE` with `toneSilver`; `EMBLEM_TYPE_PILL_TONE`
  and `EMBLEM_TEXT_BOX_TONE` with `toneRegion`, `keepAlpha`). CC's silver
  read 17–32 luma over the prints' median by region (the rails beside the
  spark 141 against 101–113), its type pill 239 against 224–231 and its box
  237 against 226–233. The silver — the body from the name bar's shadow to
  the type bar's rim, and beside the bars each row from the edge to the
  bar's light rim — is multiplied by a gain bilinear in the SIGNED offset
  from the centre and the row, each side fitted on its own (round 12b,
  owner decision 2026-09-29: CC lights its silver evenly, the prints do
  not — beside the spark's base 113–122 on the left, 178–187 on the right,
  and the right rail is the card's darkest silver). Five knots a side, 12
  rows, 0.45–1.2; the segment between the halves' innermost knots (±100 px)
  joins them, so there is no seam at the centre line and, bilinear, no step
  anywhere. Each region's median sits on the prints' per side, and the 50 px
  squares of pure silver land within 10 of the prints' median on 69 % of
  the left half and 85 % of the right (round 12: 51 % and 31 %); what they
  still miss is CC's brushed streaks against the prints'. The pill and the
  box take one gain each (0.94, 0.96). A gain, not a fill: CC's highlights
  and shading stay. The rims, the light bar under the name and the flat
  strip above it keep CC's tone, and the spark's tail and glow (pure white,
  translucent) stay as drawn; through the pill and the box the tail is
  toned with them and keeps its alpha.
- **The spark's centre ray, bridged over** (owner decision 2026-09-29,
  `EMBLEM_RAY_BRIDGE`, `bridgeRayTip`). The art window starts at 250.4 px
  (below); CC's centre ray runs on up to the bar under the name, where an
  art_crop has no pixels (holding CC's black shadow there read as a dark
  block on light art). The frame closes over it: the bar's shadow and the
  silver under it are blended across from either side, and the ray ends at
  251 px, 18 px short of the bar, its tip drawn with the colour profile of
  its own right edge — dark over the top right, light down the left, like
  the side rays' tips — with its corners rounded. Everything above 251 is
  opaque, so only the art window's picture shows in the ray. (Against the
  slot's 250.4 that is 0.6 px of overscan where layout v35's see-through
  slot rule asks 1.05, so the emblem is listed in
  `ART_WINDOW_KNOWN_FAILURES` under 4.52 — the art covers row 251 whole.)

- **Profile** (`EMBLEM` in `lib/cards/template-layout.ts`, an M15-family
  member): no cost or stat slot; the name white and centred, the type line
  left from 8.54 %W on the pill's interior, each moved onto the prints'
  baseline (`EMBLEM_TITLE_PRINT_DY`, `EMBLEM_TYPE_PRINT_DY`); CC's symbol
  box; the rules in CC's box made 10 px wider on the right so ONE centred
  line lands where the prints centre it (`alignSingleLine`), two or more
  from the left.
- **Art.** The window is Scryfall's emblem `art_crop` box exactly
  (`EMBLEM_SCRYFALL_CROP_PX`): for an emblem that crop is cut from the
  printed card around the spark, so an imported emblem's art registers
  with the print at its printed size (grown to take in the ray's tip, it
  drew the art 1.6–1.8 % larger — the frame closes over the tip now).
  An older Scryfall crop (TM20 #11: 684 × 570) is too short to fill the
  window at the print's scale and draws ~1.5–1.9 % larger; the owner
  accepted that (2026-09-29).
  CC's tall artBounds is the `underFrameArt` layer, which the spark's tail
  (80 % white through the type bar and the box) shows faintly, as the
  prints do.
- **Kind.** The emblem is its own card type (migration 0130) and kind
  (`KIND_DEFS.emblem`), reached from the token kind's "Token type" section
  (the Emblem choice), never a kind chip of its own. It wears the emblem
  frame and nothing else, and the emblem frame dresses nothing else
  (`templateRefusesKind`, so the server's kind gate refuses both ways). The
  card actions store every emblem colourless with no cost, supertype or
  stats (`lib/cards/emblem.ts`); `buildTypeLine` prints "Emblem", or
  "Emblem — Kaito" with the optional subtype.
- **Page name** (owner decision 2026-09-29). The card prints the walker's
  name; its page and address say "Emblem" as Scryfall's do ("Kaito, Cunning
  Infiltrator Emblem", …/kaito-cunning-infiltrator-emblem): `cardPageName`
  for the new card's slug, `<title>`, OG / Twitter, JSON-LD name, heading
  and oEmbed.
- **New and unverified.** The Emblem choice shows "Soon" until `emblem/c`
  is verified; the walk-through reaches it
  (`/create?previewFrames=emblem&kind=emblem&template=emblem&color=c&seed=reference`).
  No stored card sits on it, so it shipped without a layout bump.

## Re-bakes after a deploy

Automatic (migration 0120): nobody needs to run a sweep by hand.
`/api/cron/auto-rebake` (`vercel.json`, every 5 minutes, production only;
`lib/cards/auto-rebake.ts`) re-bakes every published (public or unlisted)
card that a `"sweep"` bump, a frame-layout save or a migration left on an
older render. Private cards have no stored render: they are drawn live, so
they show a change at once.

- **What it runs.** The same batch as the manual script (`runRebakeBatch`,
  scope `sweep`, `lib/cards/rebake-batch.ts`): opt-in-only cards are left
  alone with their owner badge, a card whose only pending bumps are scoped
  out is just stamped, and the overlap guards still apply. Batches of 8
  (`DEFAULT_BATCH`) until a batch finds nothing, or until about 240 s have
  gone (`AUTO_REBAKE_BUDGET_MS`; `maxDuration` is 300 s). The next run
  carries on. A 700-card sweep takes roughly an hour.
- **When idle** it costs a state read, one head count and a timestamp
  write. The count covers published cards that were never baked, have no
  stamp, or are stamped below the newest sweep version
  (`latestSweepVersion()`). If only opt-in leftovers remain, the count is
  remembered and the scan is skipped for up to 6 hours
  (`IDLE_RECHECK_MS`).
- **Never clean.** It refuses (412, and records it) unless
  `NEXT_PUBLIC_BILLING_ENABLED` is `true`. `ALLOW_UNWATERMARKED_SWEEP` does
  not apply to it.
- **One sweeper at a time.** One lease (`render_sweep_state`, migration 0120;
  `lib/cards/sweep-lease.ts`) is shared by the cron,
  `POST /api/admin/rebake` (the script) and `POST /api/admin/rebake-marked`
  (the compare page's "Re-bake now"). A manual call that finds the cron
  running asks it to stop after its current batch and waits. Between two
  manual calls the lease stays parked for the manual run (up to 120 s,
  `MANUAL_PARK_SECONDS`), so the cron stays out until the run ends. If the
  lease is still busy after 2 minutes (`MANUAL_WAIT_MS`), the manual route
  answers `503` and says why — the script's route with `Retry-After: 60`,
  which the script's retry helper (`scripts/lib/rebake-request.mjs`) backs
  off on and retries; the compare page shows it next to "Try again". Never
  `409`: the script treats that as fatal. A lease always expires on its
  own: 310 s after it was taken (`SWEEP_LEASE_TTL_SECONDS`, just past
  `maxDuration`), or when a park runs out.
- **Failures.** A card that fails is skipped for the rest of that run. After
  it fails in 3 runs (`POISON_AFTER_STRIKES`) it goes on the **poison
  list**: every later run skips it and the pending count leaves it out. A
  strike nobody renewed for 7 days is forgotten (`STRIKE_TTL_MS`). "Retry
  these cards" gives each one more try. An entry whose card no longer needs
  a re-bake (the owner saved it again, unpublished or deleted it) leaves the
  list on the next working run.
- **A run that dies.** A run killed at the 300 s limit or out of memory
  writes nothing. It records the batch it is baking first (`in_flight`), so
  the next run gives each of those cards a strike: a card that kills the
  renderer ends up on the poison list like one that fails.
- **Time limit.** No batch starts if it would end past 240 s. A batch still
  running at 280 s (`AUTO_REBAKE_HARD_STOP_MS`) keeps the lease (it may
  still write) and ends the run. If it had been running for 2 minutes or
  more (`AUTO_REBAKE_HUNG_BATCH_MS`), that is a **hung** batch (breaker). A
  shorter one was just a slow last batch (an "overrun"): the next run
  carries on.
- **Breaker.** It pauses the automatic sweep and sends every admin a
  `render_sweep_paused` notification (a toast and a bell entry) when any of
  these happens (constants in `lib/cards/auto-rebake-state.ts`):
  - a whole batch of first-time failures re-bakes nothing (≥ 3 cards,
    `BREAKER_WHOLE_BATCH_MIN`);
  - 10 cards fail for the first time in one run (`BREAKER_NEW_FAILURES`);
  - a batch hangs (see above);
  - the batch query fails 3 runs in a row (`BREAKER_ERROR_RUNS`; a blip
    heals itself, code that reads a column its migration hasn't added yet
    doesn't);
  - 2 runs in a row die before finishing (`BREAKER_CRASHED_RUNS`);
  - one run pushes the poison list past 50 cards (`POISON_MAX`). It trips
    once, when the list crosses 50, so Resume lets the sweep carry on past
    cards you can't fix yet.

  A known-bad card that fails again doesn't count.
- **Watching it.** `/admin/renders` (Admin → Re-bakes) shows the status, a
  pending estimate, the layout version the deployment runs, the last run
  (re-baked / stamped / failed / remaining / why it stopped), the pause
  reason, the cards that keep failing, and **Pause / Resume / Retry**.
  Resuming clears the breaker. Vercel logs carry one line per run:
  `[auto-rebake] v<N> stop=… batches=… rebaked=… stamped=… failed=…
  superseded=… remaining=…`, and `[auto-rebake] idle v<N> pending=…` when
  there was nothing to do.
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
it once the deploy is live ([Re-bake runbook](#re-bake-runbook)).

## Re-bake runbook

TODO 7.5. What an admin does around a sweep, and when the automatic re-bake
needs a hand. Everything below happens on `/admin/renders` unless it says
otherwise; the page's reason texts are quoted as they appear.

### Before and after merging a sweep bump

1. **Before merging.** Check `/admin/renders`: the last run finished
   ("Finished — nothing left to re-bake") with 0 failed, and nothing is
   paused. The runs don't care whether two sweeps overlap, but a failure is
   only attributable to one change when they don't. If the PR also ships a
   migration that nulls stamps for a code fix and has no sweep bump
   covering those cards, **Pause** first (the gotcha above).
2. **After the deploy.** Wait for Vercel's production deployment to be
   Ready. The **Layout** stat now shows the new version (it is the running
   deployment's `CARD_LAYOUT_VERSION`). If you paused, **Resume** now.
   Within 5 minutes a run starts: the status reads "Running now" while it
   bakes, the pending estimate starts falling, **Last run** counts what it
   re-baked, and the Vercel log shows one `[auto-rebake] v<N> stop=… …` line
   per run (`stop=budget` while cards are left, `stop=done` on the last).
3. **How big is it?** The pending estimate is an upper bound (it counts
   opt-in-only and stamp-only cards). For the exact plan, run the manual
   script's dry run against production (below) — `SCOPE=sweep` without
   `CONFIRM` plans and writes nothing: re-bake / stamp current / leave for
   owner opt-in.
4. **Done.** The last run reads "Finished — nothing left to re-bake". Open a
   few affected public cards and check their image against the editor
   preview. Then announce it ([Announcing a
   change](#announcing-a-change)).

### Why the last run stopped

The **Last run** block says why it stopped (`STOP_LABELS` in
`components/admin/auto-rebake-panel.tsx`):

| The page says | What to do |
|---|---|
| "Finished — nothing left to re-bake" | Nothing: the sweep is done |
| "Used its time budget — the next run continues" | Nothing: a sweep in progress |
| "Handed over to a manual re-bake" | Nothing: a script run or "Re-bake now" has the lease; the cron comes back when it ends |
| "Paused by an admin mid-run" | Resume when ready |
| "Lost the sweep lease mid-run" | Nothing once. It should not happen: nobody can take a live lease, and the lease (310 s) outlives the run (300 s). If it repeats, it is a bug: check the Vercel logs for that run |
| "Breaker tripped — paused" | [When the breaker trips](#when-the-breaker-trips) |
| "A batch hung — paused" | [When the breaker trips](#when-the-breaker-trips) |
| "A slow last batch ran into the time limit — the next run continues" | Nothing: the next run carries on |
| "The run before this one died without finishing (time limit or out of memory)" | Nothing once: its batch got a strike each; two in a row trip the breaker |
| "Stopped on an error" | The error is shown; a blip heals itself, three in a row trip the breaker |
| "Refused — the billing flag is off (bakes would be clean)" | Set `NEXT_PUBLIC_BILLING_ENABLED=true` on Production and redeploy |

### Pause, Resume, Retry

- **Pause** — every cron run skips until you resume. Use it before a risky
  merge, while a breaker's cause is being fixed, or to keep the renderer
  quiet. Manual re-bakes (the script, the compare page's "Re-bake now")
  still run while paused.
- **Resume** — clears the pause (the breaker's or an admin's) and the idle
  fingerprint, so the next run, within 5 minutes, scans afresh. Resume only
  once the pause reason is dealt with, or the breaker trips again.
- **Retry these cards** — empties the poison list. Each of those cards gets
  ONE more attempt in the next run: it comes back with 2 strikes, so if it
  fails again it goes straight back on the list, and it doesn't count as a
  new failure for the breaker. Retry after fixing what made them fail.

### The poison list

"Cards that keep failing" lists each card, its last error and how often it
failed. For each one:

- **Read the error.** Art that can't be fetched (a deleted upload, a dead
  external host), a frame object missing from the bucket (`npm run
  frames:check`), or a render that throws for this card only.
- **Fix what can be fixed**, then **Retry these cards**. A frame object
  missing from production's bucket is an owner `frames:promote` away. A
  card-specific render error is a renderer bug: fix it in a PR (it ships
  with its own sweep bump if other cards change).
- **Leave what can't be fixed.** A poisoned card is skipped, and its stored
  image (the old look) keeps serving. It leaves the list by itself when it
  no longer owes a re-bake — the owner saves it again (a save bakes it), or
  it is unpublished or deleted.

### When the breaker trips

Every admin gets a `render_sweep_paused` notification; the paused banner
quotes the reason. Find the reason, fix the cause, then **Resume**:

| Reason starts with | Likely cause | What to do |
|---|---|---|
| "A whole batch failed (N cards): …" | Systemic: a renderer regression, storage or the frames bucket unreachable, a frame object not promoted | Read the error it quotes; check the latest deploy and `npm run frames:check`; fix, then Resume |
| "N cards failed to re-bake in one run …" | Same as above, spread over several batches | Same |
| "A re-bake batch was still running after N s — a render may hang" | A card hangs the renderer, or storage stalled | The last run lists the cards in that batch. A hang strikes no card, so Resume retries the same cards: a one-off stall passes; the same batch hanging again is a renderer bug, keep it paused and fix it |
| "The re-bake batch failed N runs in a row: …" | The batch query fails: a deploy reads a column its migration hasn't applied yet, or the database is down | Check that production's migrations applied after the merge and that the database answers; Resume once the query works |
| "N automatic runs in a row died before finishing …" | A card crashes the function (time limit, out of memory) | Its batch got a strike each (listed on the last run). Check Vercel's function logs; Resume — a crasher reaches the poison list after 3 strikes |
| "N cards keep failing (more than 50) …" | Something wrong beyond single cards | Look for the common error on the list; fix; Retry these cards; Resume (it trips once, so Resume carries on past cards you can't fix yet) |
| "Paused by @…" | An admin paused it (not the breaker) | Ask them, or Resume |

### A sweep that seems stuck

| What the page shows | What it means | What to do |
|---|---|---|
| **Last check** older than ~10 minutes while the status reads "On — every 5 minutes" | The cron isn't reaching the route, or the route fails before it records anything | Vercel → Project → Settings → Cron Jobs, and the logs for `/api/cron/auto-rebake`: a 401 is a wrong or missing `CRON_SECRET`, a 503 a missing `SUPABASE_SECRET_KEY`, a 500 with `[auto-rebake] error="…"` a failed state read or pending count. Crons run only on the production deployment. (A paused sweep, or one waiting for a manual run's lease, skips without updating **Last check**: that is expected.) |
| Last run "Refused — the billing flag is off (bakes would be clean)" and the red banner | `NEXT_PUBLIC_BILLING_ENABLED` isn't `true` on this deployment | Set it on Production and redeploy. Never bake around it |
| "Manual re-bake active" for a long time | A script run is in progress, or a killed one left the lease parked | The page says when the lease lapses (a park lasts ≤ 120 s, a held lease ≤ 310 s); a finished or killed script frees it by itself |
| "Running now" on every visit for a long time | A big sweep: each run bakes for about 4 minutes, and the next starts 5 minutes after the last | Nothing, while **Last run** keeps moving and the pending estimate falls. A batch that outlives its run keeps the lease at most 310 s after the run took it; that run then stopped as an overrun (the next run carries on) or a hung batch (paused, see the breaker) |
| **Pending (estimate)** above 0, but the last run "Finished — nothing left to re-bake" | The leftovers are opt-in-only cards (they keep their owner badge), cards that failed in that run (**Failed** above 0: the next run retries them), or more than 150 poisoned ids the count can't exclude | Nothing to do. The script's dry run shows the split |
| Last run "Stopped on an error", run after run | The batch query fails | It trips the breaker on the 3rd run; see the table above |
| Pending not falling, failures growing | Cards failing one by one | See [The poison list](#the-poison-list) |

The lease never needs a hand: there is no SQL to run and no row to edit.

### The manual script

`scripts/rebake-renders.mjs` drives the same batch through
`POST /api/admin/rebake`, one batch per request, taking turns with the cron
through the lease. Use it when the cron can't run (a Vercel cron outage),
for a one-off `version` or `legacy-art` scope, or for the exact plan of a
sweep. It is no way around the billing flag: the route refuses to bake
(412) and the script stops after its plan when the server's
`NEXT_PUBLIC_BILLING_ENABLED` is off. It always plans first and writes
nothing without `CONFIRM=yes`; a network failure is retried
(`REBAKE_RETRIES`, default 5) and every run is safe to repeat, because the
route re-plans from what is still pending. It ends by re-planning (nothing
may be left in scope) and checking that a few re-baked renders are
reachable.

Against production (owner), in a terminal:

```bash
SCOPE=sweep REBAKE_URL=https://www.pipglyph.com/api/admin/rebake node scripts/rebake-renders.mjs
```

It first asks for production's `CRON_SECRET` (Vercel → Settings →
Environment Variables) at a hidden prompt: paste it and press Enter. Nothing
typed or pasted is echoed (`scripts/lib/hidden-prompt.mjs`), and the secret
never enters your shell history or any other program's environment. Without
a terminal (a pipe, CI) it refuses, and it refuses production over
`http://`. Then it prints the plan. Add `CONFIRM=yes` to write; each run
asks for the secret again. Other scopes:
`SCOPE=version VERSION=<n>` (only the cards bump n changed; n must be a
"sweep" version) and `SCOPE=legacy-art` (art on a legacy storage host,
renders older than `BEFORE`). `BATCH` sets cards per request (default 8,
max 25). The compare page's "Re-bake now" (the `marked` scope: cards a
frame-layout save marked) is the same batch from an admin session.

## Announcing a change

An addition is announced with a site update (the rule above), and so is a
correction sweep that changes cards people will notice. Write it in
Admin → Updates (`/admin/updates`); it shows on `/news` (What's new). The
FAQ entry "Why
does my card look slightly different than before?" (`lib/content/faq.ts`,
Exports & printing, `/faq#exports`) is the standing answer to link. A post
is plain text: title ≤ 120 characters, summary ≤ 280 (a single line), body
≤ 4000. The page keeps the body's line breaks, so each paragraph or bullet
is ONE line: paste each block below into its field as it stands. Post a
correction once its sweep has finished; an addition when it ships.

**Correction (a sweep)** — kind "update", link `/faq#exports`. Title,
summary, body:

```text
Cards on <frames> now match their printed frames more closely
```

```text
We corrected <what> on <frames>. Published cards on those frames have been re-rendered with the fix — there's nothing you need to do.
```

```text
What changed
- <one line per correction, in plain words, e.g. "Names and type lines on the M15 frames are now the size printed cards use.">

Which cards
- Every card on <frames>. Only the drawing changed: your cards' names, text, art and stats are exactly as you left them.

Downloads
- Images you downloaded before stay as they were. Download the card again for the updated image.
```

**Addition (opt-in per card)** — kind "update" (or "upcoming" before it
ships), link to where it shows (the creator, a guide). Title, summary, body:

```text
New: <feature> for <frames or card kind>
```

```text
New cards get <feature> by default. Your existing cards keep their look — switch it on in the editor if you want it.
```

```text
What's new
- <what it looks like, and which printed cards have it>

Your cards
- New cards: on by default; turn it off in <where the switch is>.
- Existing cards: unchanged. Open a card and switch it on in <where the switch is>.
- Scryfall imports follow the printing: a card that prints <feature> gets it.
```

## Environment setup

Done (the frame origin and Frames published on 2026-09-25, Visual
regression with 7.1); kept here for rebuilding an environment.

- Vercel → Project → Settings → Environment Variables:
  `NEXT_PUBLIC_FRAME_ORIGIN` =
  `https://znipzaxgpaiandwiqabn.supabase.co/storage/v1/object/public/frames`,
  scoped to **Preview** only. Without it, previews of PRs that touch
  `supabase/` draw no frame for bucket-hosted templates.
- The `main` ruleset requires **Frames published** and **Visual
  regression** (with typecheck/lint/unit, e2e and Supabase Preview).
  Without **Frames published**, only the production build gate stands
  between a merge and missing frames.
- Production needs `NEXT_PUBLIC_BILLING_ENABLED=true`, `CRON_SECRET` and
  `SUPABASE_SECRET_KEY` for the automatic re-bake ([Re-bake
  runbook](#re-bake-runbook)).

## If the dev branch is reset

A reset drops the dev branch's storage objects. Previews, local dev and CI
e2e would then draw no bucket frames. Refill them from production's public
copies:

```bash
npm run frames:restore-dev -- --write
```

Frames published to dev but not yet promoted aren't on production. Re-run
`npm run frames:publish` for those.

## Non-goals

Card Conjurer's free-form editor is a deliberate non-goal (Card Conjurer
audit 2026-09-25): verified geometry wins. PipGlyph does not offer per-layer
x / y / size / opacity / erase / HSL controls, uploaded frames or masks,
free text-box bounds, `{kerning}` / `{permashift}`-style inline codes, or
extra text boxes. Every card on a frame is drawn by that frame's one
profile, which the owner verified against real prints; giving up that
freedom is the price of the guarantee. The Card Conjurer guide
(`content/articles/card-conjurer-alternative.mdx`) names them honestly as
Card Conjurer's advantages (TODO 0.24).
