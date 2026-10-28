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
| Local `frames-fetch`, `test:visual`, `test:parity` | the dev bucket (`--origin` names another), through ONE shared store per machine | `scripts/lib/frame-cache.mjs`: `~/.cache/pipglyph/frames` (`PIPGLYPH_FRAMES_CACHE`), sha256-checked; [tests/README.md](../tests/README.md#the-shared-frame-cache) |

## Provenance and legal

Where every frame came from, and the rules that follow from it:

- **MSE Full-Magic-Pack → git.** The masters in `public/frames/` (the Alpha
  era — the 1997 frame left for Card Conjurer's drawing with TODO
  4.10a, its gold master cut from the MSE conversion kept as
  `scripts/frame-inputs/retro-m-mse.png`, and the 2003 frame with TODO
  4.10b — the showcase families, the variation treatments and the
  planeswalker loyalty badges; adventure, flip and aftermath left for Card
  Conjurer's masters with TODO 4.21a, split and battle with 4.21b, saga
  with 4.21c, the textless pair with 4.35 and the Expeditions with 4.11
  wave 1) are converted from
  Magic Set
  Editor's Full-Magic-Pack styles by the builders under `scripts/`
  (`convert-mse-frame.mjs`, `build-era-frames.mjs`,
  `build-showcase-frames.mjs`, `build-variation-frames.mjs`, …). The pack
  lives outside the repo on the owner's machine; the builders name its
  path. `scripts/audit-frame-sources.mjs` answers "which pack file was this
  frame built from?", and `docs/mse-profile-report.md` keeps the MSE
  baselines the profiles started from. The card faces' Beleren Bold comes
  from the same non-commercial pack (`lib/render/card-fonts.ts`); what each
  font file is, is the **Fonts** bullet below.
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
- **Fonts: what the files are.** Facts as read on 2026-10-06 (the era
  design) and re-read from the committed files for TODO 4.10.0; no view on
  what they allow is taken here. The owner decided on 2026-10-07 (round 36)
  to leave the three card-face files where they are.
  - `public/fonts/Beleren-Bold.ttf` (+ `.woff2`; "CardDisplay": names, type
    lines, stats, the mark). Its own name table: family "Beleren", "Bold",
    "Version P1.01", unique id "DelveFonts: Beleren Bold: 2013", copyright
    "Copyright (c) 2013 Wizards of the Coast, a Hasbro Subsidiary. All
    rights reserved.", trademark "Beleren is a trademark of Wizards of the
    Coast.", manufacturer "Delve Fonts", designer "Delve Withrington"; no
    licence string. sha256 `00d9238f…910d`, recorded as byte-identical to
    the MSE Full-Magic-Pack's `Magic - Fonts/beleren-bold_P1.01.ttf`. **No
    licence text accompanies it.** It is Beleren Bold itself: the comments
    that called it "an OFL Beleren stand-in" dated from six days in June
    2026 when the display face was Sorts Mill Goudy.
  - `public/fonts/mplantin.ttf` (+ `.woff`, `.woff2`; rules text). Name
    table: family "MPlantin", copyright field "Converted by ALLTYPE",
    version "Converted from C:\1E\PLA.TF1 by ALLTYPE"; no licence string.
    sha256 `ebfb5d57…2ab5`, byte-identical to
    `node_modules/mana-font/fonts/mplantin.ttf` (mana-font 1.18.0), which is
    the file the bake reads. The package's README licenses "the Mana font"
    (SIL OFL 1.1) and its CSS, LESS and Sass files (MIT), and its
    `package.json` says MIT; neither names `mplantin.ttf`. **No licence text
    accompanies it.** The comment in `app/globals.css` that called it "SIL
    OFL 1.1" was wrong.
  - `public/fonts/mplantin-italic.ttf` (+ `.woff2`; flavour and reminder
    text). Name table: family "MPlantin-Italic", copyright field "Converted
    by ALLTYPE", version "Converted from C:\1E\PLAI.TF1 by ALLTYPE"; no
    licence string. sha256 `e81d8360…3290`, recorded as byte-identical to
    the MSE pack's `mplantinit.ttf`. **No licence text accompanies it.**
  - With their licence beside them: `Montserrat-Medium.ttf` (the collector
    line; SIL OFL 1.1, `public/fonts/Montserrat-OFL.txt`),
    `NotoSans-Fallback.ttf` (SIL OFL 1.1, `NotoSans-OFL.txt`), and the site
    chrome's Geist and Cinzel under `app/fonts/*` (each folder's `OFL.txt`).
    `mana.ttf` is mana-font's own file (same bytes; the package's README:
    SIL OFL 1.1) and Keyrune is read from its package, which ships its own
    licence file.
  - Where they go: the repo is public; the card faces are served to every
    browser from `/fonts/*`, traced into every render function
    (`next.config.ts`), and a subset of `mplantin.ttf` is embedded in an
    exported deck PDF.
  - **A new font** follows the rule below for a new frame source: where it
    came from, what its own name table and any licence text say, and which
    home that allows, recorded here BEFORE it ships. The old cards' own
    typefaces (Magic Medieval, Matrix) and the 2016 Beleren build are not in
    the repo and are not being added (owner 2026-10-07; TODO 4.8c, 4.8d).
- **A new source** is recorded before its first frame ships: where it came
  from (repo and commit, or pack and style), what licence it carries, and
  which home that allows. A source with no licence the owner has cleared
  for the public repo goes to the bucket only, like Card Conjurer's.

## Card Conjurer frames

TODO 4.3. `scripts/import-cc-frames.mjs` builds the Card Conjurer templates
into `.frames-build/` — 63 templates today (`CC_TEMPLATES` in
`scripts/lib/cc-frames.mjs`):

- the Zendikar Rising hedron showcase (4.11, wave 1, layout v63): fullart —
  the 'Zendikar Rising' pack's frames whole with their title ends, each
  master written with the straight bar and the stamp notch split off as its
  own piece, the pack's plates and its crown band (`fullartcrown`)
  ([The Zendikar Rising hedron showcase](#the-zendikar-rising-hedron-showcase-411-layout-v63));

- the extended-art frame and the textless promo pair (4.7 / 4.35 / 4.42,
  layout v58): extendedart — the accurate 'Extended Art Frames' pack whole,
  its see-through colourless 'Eldrazi Frame' as `c` and its artifact frame
  as `a` — its land dress extendedartland (the same pack's land frames:
  `l` grey, `l<k>`, `lm` gold) — and m15textless and m15textlessland — 'Magic Fest Promos' whole
  ([The extended-art and textless frames from Card
  Conjurer](#the-extended-art-and-textless-frames-from-card-conjurer-47--435-v58));

- the Zendikar Expeditions (4.11 wave 1, layout v64): expeditionland — the
  'ZNR Expeditions (2020)' pack whole, the ZNE look — and expeditionlandbfz
  — the 'BFZ Expeditions (2015)' land frame with a colour in its pinline,
  the EXP look ([The Expeditions](#the-expeditions-411-wave-1-layout-v64));

- the M15 family (4.4, shipped in #380, layout v24): m15, m15artifact,
  m15land, m15snow, m15snowland, m15devoid, m15pw, m15token and
  m15tokenartifact;
- the Vehicle frame (4.5c): m15vehicle — the accurate M15 pack's bronze
  'Vehicle Frame' through its Border and Frame masks under the colour's
  (or the artifact's) bars, box and pinline, its ten two-colour pair
  masters and the brown 'Vehicle Power/Toughness' plate, toned onto the
  prints ([The Vehicle frame](#the-vehicle-frame-45c));
- the Nyx dress (4.7): m15nyx — the accurate M15 pack's seven 'Nyx
  (Theros)' masters whole, m15's twenty pair masters over them, and
  m15nyxcrown, the crown band with the pack's Nyx inner crown on top
  ([The Nyx dress](#the-nyx-dress-47));
- the Universes Beyond frames (4.25): m15ub, m15ubartifact and m15ubland —
  the accurate 'Universes Beyond' pack (`m15/new/ub/`, the accurate M15
  pack's geometry and masks with smooth streaked art), their M15 twins'
  recipes over its files with the pair masters, its own plates, its crown
  band (`m15ubcrown`) and the triangle stamp's notch (`m15ubholostamp`)
  ([The Universes Beyond frames](#the-universes-beyond-frames-425));
- the Lord of the Rings scroll showcase (4.11, layout v62): lotrscroll —
  the 'Scroll' pack's eight frames whole (`c` its land frame, `a` its
  artifact frame), its plates, its crown band (`lotrscrollcrown`) and its
  own triangle stamp notch per key (`lotrscrollholostamp`) ([The Lord of
  the Rings scroll](#the-lord-of-the-rings-scroll-411-layout-v62));
- the Lord of the Rings ring showcase (4.11, layout v65): lotr — the 'Ring'
  pack's eight frames whole at its native 1500 px (`c` its land frame, `a`
  its artifact frame, the top corners kept square), its plates, its crown
  band (`lotrcrown`) and its own triangle stamp notch per key
  (`lotrholostamp`) ([The Lord of the Rings ring](#the-lord-of-the-rings-ring-411-layout-v65));
- the MUL Tarkir showcase (4.11, layout v67): tarkirdragon — the 'Tarkir'
  pack's six colour frames whole at its native 1500 px (`c` its artifact
  frame), the w and u wings toned onto print, its plates, its crown band
  with the ten pairs (`tarkirdragoncrown`) and its oval stamp notch
  (`tarkirdragonholostamp`) ([The MUL Tarkir showcase](#the-mul-tarkir-showcase-411-layout-v67));
- the borderless M15 frame from 'Borderless (Alt)' (4.32): m15borderless and
  its artifact dress m15borderlessartifact, each with the pack's own P/T
  plates — and, since 4.6f (wave 2a), their pinline-split pair masters and
  the crowned twin of every master (CC's floating crown, `<key>-legendary`;
  [The borderless crown and pair pinline](#the-borderless-crown-and-pair-pinline-46f-wave-2a));
- the borderless nonbasic land (4.34): m15borderlessland, a composite of
  the same pack's pixels (below), on m15borderless's plates — and, since
  4.56, its ten two-colour pair masters from the same function
  ([The borderless land's pairs](#the-borderless-lands-pairs-456));
- the full-art basics from 'Fullart Basics (2022)' (4.39): the
  black-bordered m15fullartland and the borderless fullartland (the same
  frame with its Border mask erased), each with CC's mana symbols at
  `<template>/symbol/{w,u,b,r,g,c}.png` for the profile's basic-symbol slot;
- the older full-art basic designs (4.40 / 4.41): m15fullartlandzen from
  'Fullart Basics (ZEN)' (the stone ring of the pack's 'Colorless Frame'
  under every colour, the type bar re-cut 7 px down), m15fullartlandsnc
  from 'Fullart Basics (SNC)' (the bar 13 px and the medallion 18 px up)
  — both with the ZEN pack's medallion symbols at `<template>/symbol/` —
  and m15fullartlandthb from 'Fullart Basics (THB)', as drawn ([The older
  full-art basics](#the-older-full-art-basics-440--441));
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
- the 1997 frame from 'Seventh Edition' (4.10a, layout v46): `retro` and
  `retroland` — the pack's drawing RE-CUT edge by edge and TONED region by
  region onto the original cards of 1996–2003, gold from the MSE artwork
  cut with the same edge map (see
  [The 1997 frame](#the-1997-frame-410a-layout-v46));
- the 1993 frame's five colour symbols (4.10c, layout v48): `manaoriginal`
  — the creator's old mana-symbol set, one SVG per colour holding the whole
  pip, rasterised at 216 px (a `CC_RIDERS` set, like the transform icons;
  see [The 1993 frame](#the-1993-frame-410c-layout-v48)). The frame's
  MASTERS stay the MSE artwork in git;
- the 2003 frame from '8th Edition' (4.10b, layout v47): `modern` and
  `modernland` — the pack's drawing RE-CUT with one piecewise-linear map per
  axis and TONED through its own five masks onto the prints of 2004–2014,
  with the pack's P/T plates under `modern/pt/` (see
  [The 2003 frame](#the-2003-frame-410b-layout-v47));
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
- the landscape layouts (4.21b, layout v43), the importer's first
  2100×1500 masters: `split` from 'Split' (the pack draws it portrait with
  its text turned; the composite is turned a quarter turn clockwise, a
  pixel permutation, then its two halves are moved onto the prints through
  the flat black border and spine; colourless = the pack's artifact frame,
  a render stand-in that is never offered) and `battle` from 'Battle' (the
  pack's 2814×2010 canvas downscaled once, then its lower block moved 4 px
  down through flat rows; the defense shield stays in the master;
  colourless = the pack's see-through frame) — see
  [The landscape layouts](#the-landscape-layouts-421b-layout-v43);
- the saga (4.21c): `saga` from the saga 'Regular Frames' pack — w u b r g
  m are the pack's `sagaFrame<K>`, `c` its 'Land Frame' (the only printed
  colourless saga is a land, MH2 #259 Urza's Saga), copied 1:1 at their
  native 1500×2100 with the chapter ribbon in the master. Two more things a
  recipe can carry ship with it: `pieces` — a pack's own bitmaps published
  beside the masters at native size (the rail's `saga/chapter/badge.png`,
  118 × 132, and `saga/chapter/divider.png`, 592 × 9, which both renderers
  draw) — and `maskInputs`, pack masks RECORDED for a later recipe (the
  two-colour saga's pair masters, 4.6f): fetched into the cache, listed in
  provenance, never written to the build folder or the bucket — see
  [The saga (4.21c)](#the-saga-421c);
- the double-faced saga front (5.5 (b)): `sagadfcfront` from the
  'Saga (Transform)' pack (packSagaDFC.js) — w u b r g m its masters, `c`
  its 'Land Frame', copied 1:1 at 1500×2100; the chapter pieces are the
  saga's — see [The double-faced saga front](#the-double-faced-saga-front-55-b);
- the transform bodies (5.1a) from the 'Transform' packs: m15dfcfront
  ('Transform (Front)'), m15dfcback ('Transform (Back) (New)', the ▼ at the
  right) and m15dfcbackleft ('Transform (Back)', the empty left well) in
  w u b r g m + `a` (= `c`, the artifact stand-in), the land pair
  m15dfclandfront / m15dfclandback (one master under every key), the ▼
  back's dark P/T plates `m15dfcback/pt/<k>.png`, the backs toned onto the
  prints (`DFC_BACK_TONES`), and the 12 icon riders (`CC_RIDERS.dfcicon`,
  CC's glyph SVGs rasterised at 220 px) — see
  [The transform bodies (5.1a)](#the-transform-bodies-51a);
- the modal bodies (5.1b) from the 'Modal Regular' pack: m15mdfcfront
  (`<k>.png`) and m15mdfcback (`<k>b.png`) in w u b r g m + `a` (= `c`, the
  artifact stand-in) copied 1:1 (the housing, its ring and the flipside
  strip are the masters'), the backs toned onto the prints
  (`MDFC_BACK_TONES`), and the land pair m15mdfclandfront /
  m15mdfclandback — a PipGlyph recipe: the colour's modal master with its
  frame body (and the front's text box) REPLACED through the pack's own
  `frame.svg` / `textbox.svg` by the 2015 land tint (`m15/new/l<k>.png`,
  the m15land masters' file), the land backs toned onto ZNR / MH3's prints
  (`MDFC_LAND_BACK_TONES`); `c` the pack's grey land modal, `m` the gold
  tint, both stand-ins — see [The modal bodies (5.1b)](#the-modal-bodies-51b).

```bash
node scripts/import-cc-frames.mjs --only m15,m15land
```

- **Source.** The fork at the pinned commit, cached under
  `~/.cache/pipglyph-cc/<commit>`, or set `CC_CACHE`. It takes about
  4 minutes for the M15 family; `--only` builds a subset.
- **Pairs.** m15, m15artifact and m15land also build their two-colour pair
  masters (`<pair>.png`, and m15's hybrid `<pair>-h.png`; TODO 4.6b —
  [The two-colour frames](#the-two-colour-frames-46b)); so do the
  borderless frames (wave 2a), the snow frames (wave 2c), the double-faced
  spell faces (5.1d) and the borderless land (4.56).
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
  layouts](#the-portrait-layouts-layout-v38)). A fourth kind needs no
  cross-fade: whole blocks moved through FLAT zones (`shiftBlocksRgba8`, a
  recipe's `shift` — it throws on a zone that isn't flat): the split's two
  halves and the battle's two blocks (`SPLIT_HALF_RECUT`,
  `BATTLE_BLOCK_RECUT`, layout v43 — [The landscape
  layouts](#the-landscape-layouts-421b-layout-v43)). A fifth stretches a
  band SIDEWAYS through a cross-fade in a bar's own paper (`recutColumns`,
  the battle's right ends — with its shield set aside through a mask and
  its icon's rings redrawn, layout v45: [The battle re-cut onto the
  prints](#the-battle-re-cut-onto-the-prints-421d-layout-v45)).
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
  two-colour land prints grey bars with a split pinline and box — the ten
  pair masters `<pair>.png`, the same function with a letter pair (4.56,
  [The borderless land's pairs](#the-borderless-lands-pairs-456)). About a
  quarter of the borderless nonbasic lands print the spells' look instead —
  the colour's title bar over a dark type bar AND a dark box (TDM, WOE,
  ACR, EOE, FIC, FRA #379, many 2024+ SLD drops) — a few a dark type bar
  alone over the tinted box (FRA #380–381, SLD #250 / #1989 / #2143 /
  #7112), the two-colour runs of 2025 on a see-through box with a shadow
  behind the text under the land's own bars (SPG #109–118, ECL #347–351,
  SOS #301–305, MSH #380–384, SLD #2440, FRA #397–401), and some the short
  box (the SNC triomes, UNF's shock lands, SLD #456–460): none is drawn, no
  reference comes from them, and the registry pins them `nearest` (4.37's
  variants; `BORDERLESS_LAND_DARK_PINS` /
  `BORDERLESS_LAND_DARK_TYPE_BAR_PINS` / `BORDERLESS_LAND_SHADOW_BOX_PINS` /
  `BORDERLESS_LAND_SHORT_BOX_PINS` in `lib/scryfall/frame-signatures.ts`,
  read by eye on every printing it called `exact` — compare the title, type
  and box bands side by side: the type bar is the easy one to miss, and the
  shadow box only shows against a flat tinted one). One rules line starts at the box's
  left, as on M15: the only non-SLD borderless lands printing a single
  line (the ZNR / KHM pathways) do; only SLD #300–304 centre it. w, u and
  g keep ONE reference (MH3 #354 / #350 / #357): the other exact mono-u /
  mono-g prints are Secret Lair scans whose bars show the art through
  (owner round 15), and white dropped Ancient Den SLD #300, an offset scan
  of the centred one-line print (owner round 16; it still imports as the
  exact borderless land).
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
- **Output.** 1500×2100 PNGs (2100×1500 for a landscape recipe: split,
  battle) with transparent corners cut at the one card
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
cases added to the baseline (its pair masters, 4.56, are an addition a card
switches on: the same). A new
template stays out of the picker until the owner verifies each colour
([Verifying a frame](#verifying-a-frame)); an import never lands on one (the
creator only offers it, once verified). The compare page's alignment score
leaves out printed details a master doesn't draw (`scoreExclusionsFor` in
`lib/frames/align.ts`; none today: the borderless spell, artifact and land
frames draw the stamp's arch since 4.9d and the borderless walkers since
owner Round 72, so their score includes it).

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
  (luma ≤ 48); on a `design` edge (the frame's own design to the edge: the
  LOTR ring's frame field, 4.11) opaque only — its corner is the design's
  colour. It catches a paper crescent, a grey paper rim right at the
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
  `scripts/lib/frame-corners.mjs`: (retro and retroland left it with TODO
  4.10a, modern and modernland with 4.10b, extendedart, m15textless and
  m15textlessland with 4.7 / 4.35, expeditionland — whose w/u/r/c/m
  paper reached 1–2 px inside the cut — with 4.11 wave 1: the importer
  cuts their corner) fullart;
  adventure — its 1–2 px grey paper rim just inside the arc, added
  2026-09-28 — flip and aftermath left the list with 4.21a and saga with
  4.21c, their Card Conjurer masters cut by the importer), never on a
  showcase family (`NEVER_NORMALISE`):
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
    retired with 4.21a, the split builder and the battle's ring remover
    with 4.21b: those masters are Card Conjurer's, in the bucket.)
  - **Truecolour only.** The normalised masters are truecolour PNGs: a
    lossless palette is impossible (the base palettes were already full at
    255–256 colours and the cut's alpha ramp adds 35–58), and a quantised
    one moves the mask's alpha. sharp's `effort` turns palette quantisation
    on: on a rebuilt adventure master (then MSE's) it moved every pixel of
    the cut's ramp (by up to 52), and the corner check still passed. So the
    builders above write the master the gate checked, truecolour, and
    `tests/unit/frames/frame-corners.test.ts` fails one whose write after
    the gate passes `effort`, `palette`, `quality`, `colours` or `dither`.
    (The showcase and Alpha builders, whose masters the pass never
    touches, still quantise; Alpha only without `ALPHA_FULL_COLOUR=1`.)
- **Square outputs.** Print (the PDF card and sheets, the Pro deck PDF +
  ZIP) and the Square PNG are the round render squared again
  (`squareCardCorners`): outside the arc each corner is the card's border
  colour — the border black by default, the root's #101015 where a master's
  edge band is see-through (the rings — the Tarkir draconic's left it with
  its painted border, 4.11 layout v68, the ghostfire's ring with its own,
  and the Avatar elemental and bloomburrow's bottom with their painted
  footers, v69, and bloomanime, the last, with its full bleed, v70: no ring
  is left) — or, where art or frame design runs into the corner (an
  art-to-edge frame — bloomanime's art and footer since v70; bloomburrow — its leafy top band, and since v69 its
  coloured footer, kept square by the builder — the LOTR ring — its frame
  field, kept square by the importer since 4.11 — and tarkirdraconic),
  what was drawn. The table is `lib/frames/square-corners.ts`;
  `tests/unit/frames/square-corners.test.ts` holds it to every master, so a
  new or rebuilt frame whose corner changes turns CI red.
- **Left alone.** The Alpha masters (agclassic, alphaland) keep their clean
  60 px cut, inside the 64.5 px one (square outputs paint the annulus
  between the two cuts in the border black). (expeditionland b/g kept their
  paper — a see-through band left no border to paint with, 7.7 — until
  4.11 wave 1 re-sourced them from Card Conjurer.) The showcase families keep their drawn corners (Bloomburrow's pale corner,
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
| Art-window coverage (7.6) | `lib/frames/art-window.ts`, `tests/unit/render/art-window-coverage.test.ts` + its per-master parts `art-window-coverage-<n>.test.ts` (`art-window-masters.ts`) | the art slot covers the window; translucent parts stay inside it |
| Square corners (3.26) | `lib/frames/square-corners.ts`, `tests/unit/frames/square-corners.test.ts` | the print corner fill matches the master |
| Plate ink (3.29) | `lib/cards/plate-ink.ts`, `tests/unit/cards/plate-ink.test.ts` | every P/T plate has measured ink, pinned to its manifest hash |
| Visual regression (7.1) | `tests/visual/`, `scripts/lib/visual-gate.mjs` | no stored-image change without a layout bump ([Shipping a frame change](#shipping-a-frame-change)) |

- **Edge contract (TODO 7.7).** Each template declares its four edges in
  `lib/frames/edge-contract.ts` (`border`, `art`, `bar` or `design`). A violation, or
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
  `.frames-cache`, from the DEV bucket on a local run, hard-linked from the
  machine's shared frame store when it has the objects — see
  [tests/README.md](../tests/README.md#the-shared-frame-cache)), then
  `FRAMES_BUILD_DIR=.frames-cache npm run test:unit`.

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
   `ERA_TYPE_FRAME`, `TEMPLATE_SKIN_VARIANTS`, an M15 treatment set or a
   showcase set ([Which group a frame sits in](#which-group-a-frame-sits-in)),
   or a kind's `layoutTemplates` in `lib/creator/card-kinds.ts`. Which kinds
   a showcase, an M15 treatment or a Borderless frame dresses follows from
   the anatomy its profile draws
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

### Retiring a frame

A template leaves `FRAME_TEMPLATE_VALUES` only after its replacement is in
`RETIRED_FRAME_TEMPLATES` (`types/card.ts`). An UNKNOWN `frame_style.template`
draws `DEFAULT_FRAME_TEMPLATE` — m15, the creature frame — so without the map
a row, draft or remix payload that still names the old value would change
kind on screen. The map is the read path, and the only one:

- `normalizeFrameTemplate(template, face)` / `retiredFrameTemplate`
  (`lib/cards/card-display.ts`): both renderers, the print paths, the
  creator's load for an edit and a remix, the re-bake scope rules. Pass the
  card's text where the reader has it — a replacement may depend on it.
- `getFrameProfile` (`lib/cards/template-layout.ts`): a reader handed the
  stored value as it is (the anatomy rules, the kind rules) gets the
  replacement's bare profile, never m15's.
- the validator's `frame_style.template` preprocess
  (`lib/validation/card.ts`): an old payload parses instead of failing.
- `staleTemplateFilter`: an override of the replacement marks the rows that
  draw on it; the PNG download's ETag reads the replacement's override too.

The stored value leaves a row on its owner's next save, by the card
actions (`lib/cards/actions.ts`): `createCardAction` runs
`withRetiredFrameTemplate` on the payload before it is parsed (a remix, a
crafted or stale payload: the frame the payload's own text asks for, then
that frame's verification gate), and `updateCardAction` — an edit never
sends its template — writes `retiredFrameStyleRewrite` of the stored style,
judged by the text the row holds after the edit, with no verification gate
(the card already draws there). Nothing else rewrites a stored row, and its
stored bake keeps the old look until it is re-baked.
`tests/unit/cards/retired-frame-template.test.ts`, `retired-frame-save
.test.ts` and `tests/unit/render/retired-frame-bake.test.tsx` hold each
reader; a new retired value needs no new code, only its map entry and its
rows there.

**`alphatoken`** (TODO 4.54, retired 2026-10-07; owner decision 2026-09-29):
a 1993-style token frame of our own — no 1993-frame token was ever printed —
with no reference, no tick and, counted on production the day it went, no
card (public, unlisted or private). It reads as `m15token`, or
`m15tokentext` when the card has rules or flavour text. No migration: no
seed, CHECK, `frame_reviews` or `frame_profile_overrides` row named it on
production; a row on a dev, preview or local database is covered by the
map, and a `frame_reviews` / override row there is never read (both are
looked up by a current template key). The registry's 1993 family now
answers a token as `token/old-frame` does for 1997 and 2003 (nearest, the
M15 token, 4.43). Its 17 Visual cases were removed without a bump (0 stored
cards; a removal changes no case).

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

**A double-faced reference is drawn as it prints (TODO 5.0d).** On a
transform body under test, front or back, the compared card carries the
printing's icon family — `frame_style.dfcIcon` from its `frame_effects`
through the import mapper's own `dfcIconFamilyFromEffects` (`arrows` stays
the absent key) — so MID's backs on the 2016–22 body show the moon their
scans print, not the default ▼; and a FRONT's `preview` is
`frontPreviewData` of that card, its `dfc` block included, so the page, the
sign-off's side-by-side and the scorer's bake are handed ONE object (the
bake derives nothing: a front used to be scored without its reverse P/T,
its icon rider and its modal strip;
`tests/unit/scryfall/reference-preview-dfc-family.test.ts`). A score
recorded for a double-faced front body, or for the 2016–22 back, before
5.0d measured another picture, which the staleness rule below cannot see.
Measured on the live printings, the real masters and the scans (the 50
references whose scored picture changed — 39 fronts, the 11 left-well
backs — each before and after): 49 move by at most 0.2 points and none
crosses the 90 % line; MID #169's front (`m15dfcfront/g`'s alternate) reads
6.3 → 8.0, because its rules text now breaks round the 3/5 and the scorer's
vertical registration — which keeps the text rows — lands 0.8 %H off
(confidence 0.72 → 0.55): the number moved, not the frame. To put today's
picture on record, run "Score all N colours" and then **Publish** on the
sign-off of `m15dfcfront`, `m15dfclandfront`, `m15mdfcfront`,
`m15mdfclandfront` and `m15dfcbackleft` — Publish re-stamps a tick that
already stands and never withdraws one. A tick made on `m15dfcbackleft`
before 5.0d was made beside the ▼: look at its seven colours again.

**When a tick goes stale.** A tick records the layout version and a hash of
the template's override (migration 0115). It goes stale when a later bump
touches the template (`VERIFICATION_TEMPLATE_SCOPES` when a bump's slots
move on fewer templates than its bakes change on) or the override changes;
`VERIFICATION_NEUTRAL_VERSIONS` (31, 32, 33, 35, 36, 37, … 61) never stale one (v36's
4.47 moved the planeswalkers' `symbolRect`, a box the alignment score reads,
but the owner kept it neutral as v32's 15 px m15pw cost-box move was — owner
round 18, 2026-09-30; v60's 4 px walker pip and name move likewise), and a
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
  scrim — and the textless one otherwise; the arch's tall box is its own
  rule since 4.55 (`token/tall-box`, pinned `TALL_BOX_TOKEN_PINS`: `nearest`
  the regular box until the tall box is verified, then `exact` on it —
  "The arch token's tall text box" below). A token's Nyx
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
- **A LANDING the registry names for later** (`landOnOnceVerified`): a rule
  may keep its match — the printing's own frame, its status, gaps and
  signature — and name only another frame to land on once that one is
  verified in the card's colour, for the printings its `match` holds on (a
  borderless or extended-art Vehicle on `m15vehicle`, "The Vehicle frame").
  `withVerification` applies it, and only in place of a stand-in landing: a
  printing on its own verified frame stays there.
- **The mapper's landing is STATIC** (`patch.frame_template`,
  `frame_match`): both rules above are applied by `finalizeImportMatch`
  with the database's verified combos, and EVERY reader that lands a
  printing calls it — `/api/scryfall/named` for the creator, and the AI
  deck remix inside `remixFrameFor` (2026-10-13; it used to read the static
  landing, so a remixed Vehicle kept the silver artifact frame and a remixed
  M20+ token the 2014–19 arch after their frames were ticked). A new reader
  of a mapped patch does the same, through that one function — never its
  own copy of the rules. `remix-mechanics.test.ts` holds the remix's
  landing to the import's.
- **Registry references** (`lib/cards/frame-references.json`) must resolve
  to their own template and pass the pin check;
  `tests/unit/cards/frame-reference-signatures.test.ts` holds that over a
  trimmed capture of every reference printing
  (`tests/unit/cards/fixtures/reference-printings.json` — re-capture it
  when you add a reference). Never replace the DEFAULT reference of a combo
  production has verified; add an alternate and ask the owner to
  re-verify. A template's `pairs` (4.56) lists the prints of its two-colour
  pair masters: the same two rules, and no checklist row — a pair rides its
  template's `m` tick.

## Additions vs corrections

Owner rule, 2026-09-29. Every change to how cards look is one of two kinds,
and the kind decides the rollout:

- **Addition or new look — opt-in per card.** A new anatomy element or a
  different style a card owner might reasonably not want: legendary crowns,
  two-colour frames, the full-art token design, the Nyx starfield, the
  collector line and holofoil stamp, the vehicle P/T plate, colour
  indicators, coloured-artifact blends, new frames and treatments.
  - NEW cards get it by default, with a switch to turn it off.
    (Two switches start OFF instead, because they are a printing's or an
    owner's choice rather than today's standard look: the text alignment —
    left — and the white border — black; [The white
    border](#the-white-border-430).)
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

### The landscape layouts (4.21b, layout v43)

TODO 4.21b (the second of 4.21's three PRs; design 2026-09-29, owner
decisions 2026-09-29, built 2026-10-06): split and battle leave their MSE
composites in git for Card Conjurer's masters in the bucket
(`CC_TEMPLATES.split` / `.battle`) — the importer's first LANDSCAPE recipes
(`orientation: "landscape"`, written 2100×1500, `outputSizeOf`), cut at the
one corner (64.5 px: 4.3 % of the SHORT side in either orientation). Every
px below is HD, 2100 × 1500. The prints are Scryfall PNGs turned a quarter
turn clockwise and scaled to that size, registered edge by edge (each
edge's profile cross-correlated with the master's over a ±24 px search —
one global fit hides a half that sits off on its own); every difference is
print − ours, + = right or down.

- **Owner decisions** (all five round-33 sheets signed off; it merges as
  built).
  - owner round 33, 2026-10-06: split keeps the PRINTS' text sizes (name
    76 px, type line 53, pips 68, the 48 px symbol box), not the design's.
  - owner round 33, 2026-10-06: the gold split (`split/m`) stays unticked
    until per-part colour (TODO 4.26); the owner ticks red and blue only,
    per colour.
  - owner round 33, 2026-10-06: centring a split half's short rules text
    is a rules-layout follow-up (TODO 4.21e), before the first split tick.
    (Built 2026-10-07 as the card's own Left / Centred choice, on every
    kind of card: [The text alignment](#the-text-alignment-421e).)
  - owner round 33, 2026-10-06: the battle merges as built; its right side
    is re-cut onto the prints in a follow-up (TODO 4.21d), before the first
    battle tick.
- **The two recipes.**
  - `split` — Card Conjurer's 'Split' pack (packSplit.js) is drawn PORTRAIT
    with its text at −90°. The importer composites it at the pack's native
    1500×2100 and turns it a quarter turn clockwise (`rotateCwRgba8`: a
    pixel permutation, no resample), so the portrait card's bottom border —
    where the collector line runs — is the landscape card's left border.
    w u b r g m come from their own file; `c` is the pack's 'Artifact
    Frame', a render stand-in that is never offered (no colourless split
    was printed; owner 2026-09-29).
  - `battle` — the 'Battle' pack (packBattle.js) is a 2814 × 2010 canvas:
    ONE Lanczos pass to 2100×1500, every colour from its own file, `c` the
    pack's see-through 'Colorless Frame' (MOM #1 Invasion of Ravnica). The
    pack's artifact and land frames are not built (no print).
- **Whole blocks moved onto the prints** (a recipe's `shift`,
  `shiftBlocksRgba8` in `scripts/lib/cc-frames.mjs`). Each pack leaves the
  prints by a near-constant offset over a whole piece of the card, with
  FLAT zones — lines that are identical from one edge of the image to the
  other — between the pieces: the split's black border and spine, the
  battle's window sides and bottom border. The importer moves each block
  byte for byte and lets the zones between them take up the difference by
  repeating (or dropping) their one line: no resample, no cross-fade, and
  it THROWS when a zone it would change is not flat, when two blocks would
  meet or when a block would leave the image. (The tokens' and flip's
  re-cuts cross-fade a seam through texture; these have no seam to fade.)
  - `SPLIT_HALF_RECUT` — the pack's collector border is 160 px where MH2
    #123 / #60 and TSR #161 / #186 print 147–148, and its halves sit 5–14
    px right of theirs: columns 160–1081 (the left half) move 11 px left
    and columns 1118–2040 (the right half) 3 px. The border becomes 149
    px, the spine 44 (1071–1114; the pack's 36), the right border 62
    (from 2038; the pack's 59).
  - `BATTLE_BLOCK_RECUT` (v43's `BATTLE_LOWER_RECUT`, with a second block
    since layout v45) — nine MOM battles print the type bar, the text box
    and the shield 2.5–5.5 px lower than the pack: rows 842–1467 move 4 px
    down. The window's sides grow 4 rows and the bottom border is 54 px
    (from 1446; the pack's 58). TODO 4.21d added the top block — rows
    57–362, 2 px up — and re-cut what no block reaches: "The battle re-cut
    onto the prints" below.

  A profile's numbers are written in the PACK's px and ride the moves
  (`SPLIT_RECUT_PX`, `BATTLE_LOWER_RECUT_PX`, `BATTLE_TOP_RECUT_PX`,
  `BATTLE_RIGHT_RECUT_PX`, `splitLeftPct` /
  `splitRightPct` / `battleLowerPct` in `lib/cards/template-layout.ts` — as
  the tokens ride `TOKEN_RECUT_PX`); `tests/unit/frames/landscape-importer.test.ts`
  holds the recipe's and the profile's constants together. To take a move
  out, drop the recipe's `shift` and zero its constant: nothing else reads
  it.

  **Split**, the mean of four prints (MH2 #123 Fast // Furious, MH2 #60
  Said // Done, TSR #161 Dead // Gone, TSR #186 Rough // Tumble), L = the
  left half, R = the right:

  | Edge | The pack as drawn | The master |
  |---|---|---|
  | L body, left / right | −13.1 / −7.3 | −2.1 / +3.6 |
  | L window, left / right | −12.7 / −10.4 | −1.7 / +0.6 |
  | L name bar, left / right end | −14.3 / −7.8 | −3.3 / +3.3 |
  | L text box, left / right | −12.8 / −11.0 | −1.8 / 0.0 |
  | R body, left / right | −5.0 / +0.2 | −2.0 / +3.2 |
  | R window, left / right | −6.1 / −2.2 | −3.1 / +0.8 |
  | R name bar, left / right end | −6.1 / +0.2 | −3.1 / +3.2 |
  | R text box, left / right | −5.1 / −3.4 | −2.1 / −0.3 |
  | Rows (name bar top, window top and bottom, box top and bottom; not moved) | −1.9 … +1.5 | the same |

  The worst edge's mean goes from 14.3 px to 3.6 (any one print: 16.4 →
  5.4). What is left is the halves' WIDTH: the prints' bodies are about
  6 px wider than the pack's (−2 at the left edge, +3 at the right), which
  no move closes. On the master the left window is 204–1017 × 239–795 px
  and the right one 1171–1983; the MSE composite's were 133–952 and
  1149–1968 × 201–800 (37 px high, the left one 69 px left of the prints'),
  on a black canvas with no coloured body round either half.

  **Battle**, the mean of nine MOM prints (#1, #21, #22, #63, #115, #147,
  #149, #190, #230 — the seven default references and two alternates):

  | Edge | The pack as drawn | The master |
  |---|---|---|
  | Top border, inner edge | −0.3 | −0.3 |
  | Name pill, top / bottom | −2.5 / −0.8 | the same (above the moved block) |
  | Type bar, top | +5.3 … +5.5 | +1.3 … +1.5 |
  | Type bar bottom / text box top | +4.6 | +0.6 |
  | Text box, bottom | +2.5 | −1.5 |
  | Shield, top / bottom | +2.8 / +5.0 | −1.2 / +1.0 |
  | Name pill, right end | +10.8 | +10.8 |
  | Type bar, left / right end | +1.9 / +9.2 | +1.7 / +9.4 |
  | Text box, left / right | +0.5 / +8.3 | +0.5 / +8.3 |
  | Shield, left point | +11.8 | +11.7 |
  | Bottom border, top edge (under the text box) | +0.9 | −3.1 |
  | Battle icon's dark disc: centre x / y, radius | −0.9 / −3.4, −2.9 | the same (above the moved block) |

  The rows are within 1.5 px of the prints' mean after the move (2.3 px of
  any one). **Not closed:** the prints' name pill, type bar and text box
  end 8–11 px further RIGHT than Card Conjurer's and their shield sits 12
  px right, while the left ends and the border agree (≤ 2 px); and the
  pack's battle icon is a little larger and lower than the prints' (its
  dark disc a circle of radius 55.2 px centred 290.5 / 131.6 px on the
  master; eight prints: 52.3 px, 289.6 / 128.2 — each fitted within 0.4
  px). No flat zone crosses the bars or the icon, so a block move can't
  reach either; widening the bars would mean repeating single texture
  columns along each and redrawing the shield over the border. Left as
  the pack has it in this change — owner round 33: the right side and the
  icon are re-cut in TODO 4.21d, before the first battle tick. Text is
  placed relative to the master's own bars (below), so a name or a cost is
  not 10 px off its bar. (The one edge the move takes OFF the prints is
  the bottom border's: the prints' text-box rim is about 2 px thinner than
  the pack's, so with the box on the prints the border starts 3 px below
  theirs.)

  **Skeptic pass (2026-10-06).** Both tables re-measured on other rows
  and columns, two ways (half-level crossings and profile correlation, the
  master blurred to the scan's sharpness): the battle's numbers within
  about 1 px (right ends +10.0 / +8.6 / +7.6…+8.8, the shield's black
  interior +11.7 by its centroid, the icon's disc r 54.6 against the
  prints' 52.0, 3.9 px lower), the split's within 1–3 px by where an edge
  is read (the prints' bodies 4–5.5 px wider than the pack's). A fresh
  importer run from the pinned commit gives the 28 published objects byte
  for byte; every zone a block moves through is one line repeated on all
  14 masters, so no seam exists to look for (pack and master agree pixel
  for pixel on both sides of every boundary). **The battle's right side
  CAN be re-cut** the way the tokens and flip were, and the top block and
  the icon with it — prototyped on all seven keys (scratchpad only, never
  published; the recipe is TODO 4.21d): the name pill's end 10 px right
  and the type bar's and text box's 8, each through a 24-column
  cross-fade inside the bar's own paper (the lines it crosses there are
  horizontal), the shield lifted through the pack's Defense mask and set
  12 px right over the border, where the prints' sits — every right-side
  edge then lies within 1 px of the nine prints' mean (the pill +0.1, the
  type bar +0.7, the box −0.3, the shield −0.3); rows 57–362 two px up
  through the flat top border (one more block for `BATTLE_BLOCK_RECUT`:
  the pill's top −0.5, its bottom +0.6); and the icon's three rings
  redrawn flat at the prints' radii, 1.4 px above the centre of their rim
  as the prints set them (the disc r 52.0, 0.5 px from the prints'
  centre; its triangle kept — the prints' is the pack's size). **Built as
  layout v45** — "The battle re-cut onto the prints" below; the table
  above is the master as v43 shipped it.

- **How text is placed on both.** Where the prints set a line RELATIVE TO
  ITS OWN BAR of the master: a baseline below its bar's face, a name's
  start past its bar's left end, a cost's end before its bar's right end.
  The card then reads right on the frame it is drawn on, and a later
  master fix moves the slot with its bar.
- **Split's slots** (`SPLIT` in `lib/cards/template-layout.ts`; the px
  are the PACK's left half — 11 px further left on the master. The right
  half is the back-face content, a second face with `rotation: 0` and its
  own art window, every slot the left half's 966 px over —
  `SPLIT_HALF_DX_PCT`: the pack's 958 px and the 8 px the two moves differ
  by):
  - **Art** — the windows + 0.1 % (2.1 px across, 1.5 px down): the pack's
    215–1028 and 1174–1986 × 239–795, moved.
  - **Sizes — the prints', not the family's.** Each half is a small card of
    its own and every line on it prints smaller than a regular card's
    (`lib/cards/typography.ts`): the name 76 px (`SPLIT_TITLE_SIZE_PCT` —
    ten names measure 0.94–0.97 of an 80 px one, x-height 38–39 px against
    a regular card's 41–42), the type line 53 px on its 69 px bar
    (`SPLIT_TYPE_SIZE_PCT` — "Sorcery" prints 177–178 px wide; the design's
    60 px, Card Conjurer's 0.0286 H, sets it 201), the pips 68 px
    (`SPLIT_COST_DISC_PCT` — the prints' generic disc is 64–65 px across,
    a regular card's 68.7–69.6), and the set symbol in a 48 px box
    (`SPLIT_SET_SYMBOL_BOX_PCT`) that a Keyrune glyph's INK fills top to
    bottom (`setSymbolFit: "ink-height"`: MH2's wide mark and TSR's tall
    hourglass both print 47–50 px tall), never wider than the box × the
    family's width-to-box ratio. So split is NOT in `M15_FAMILY_TEMPLATES`.
    The design asked for the family's 80 px name and 72.75 px disc and a
    60 px type line; the prints decided (flagged for the owner).
  - **The name and the cost** — the name bar's face rows (104.5–209.5):
    a centred 76 px name's baseline is 182.3 px, the prints' 182.7 (nine
    halves, 180.8–184.4), and the pips centre on 157.0, the prints' 156.6
    — no `dy`, no `costDy`. From 226 px (the prints start a name 30–32 px
    past the bar's left end) to 1030 (their last disc ends 19 px before
    the bar's face does).
  - **The type line** — rows 815–884, its baseline the prints' 867.9 px
    (ours 867.2), from 226 px; the left half's set symbol inline, ending
    at 1030 px (MH2's ends 20–21 px before the bar's face). The right half
    draws no symbol yet (TODO 3.9; the prints do).
  - **Rules** — 228–1008 × 927–1426 px, inside the box's paper (so
    `SPLIT_TEXTBOX_BORDER_PX` is 0 / 0: the MSE rect spanned the window's
    width and held 33 / 38 px of border), the block centred as the prints
    centre theirs (ink centred on 1178.5 px ± 2), at the 9 pt ladder top
    (`RULES_SIZE_PX.standard`: TSR #161 and #186 set two and three lines
    at 76 px, a 74–75 px pitch; MH2 #123's halves 70–71, a smaller text
    than its length needs). Some prints also CENTRE a text's lines (MH2
    #123, TSR #156 / #161 / #186, C16 #239 — one to four lines), others set
    theirs left (MH2 #60's three and five lines, GRN #224, and DMR #209's
    one- and two-line texts): no rule of length separates them, so ours is
    left-aligned unless the CARD says centred (`frame_style.rulesAlign`,
    TODO 4.21e — [The text alignment](#the-text-alignment-421e)). The
    halves' missing 5 px also leave each text column about 10 px narrower
    than the prints' (780 px against a 790 px printed line on TSR #186:
    "Tumble deals 6 damage" breaks one word earlier in ours).
  - **Both halves are `fit: "measured"`.** An unturned second face draws
    its name and type line through `fitTitleBand` / `fitTypeLineBand`
    exactly as the front draws its own, in both renderers; a turned one
    (aftermath, flip) keeps the character estimate.
- **Battle's slots** (`BATTLE`; the MOM Siege front, MOM #149):
  - (The numbers in this list are layout v43's. Since v45 the art rect's
    top is 56.2 px, the name sits 2 px higher, the cost ends at 1952.3 px, the type line's rect, the
    symbol and the rules box end 8 px further right and the shield, its
    value and its ink span sit 12 px right — "The battle re-cut onto the
    prints" below.)
  - **Art — ONE rect for every colour** (`BATTLE_ART_RECT`,
    7.85/3.88/89.4 × 91.91: 164.9–2042.3 × 58.2–1436.9 px), from the
    border's inner edge to the bottom border. On the master the full-art
    window is clear over 168–2038 px across from 61 px down — beside the
    type bar and the text box too, to 1386 px on the left — and again in a
    sliver between the shield's right point and the border, down to 1432
    px (α < 250 over 166–2040 × 59–1435). A slot that ended at the text
    box would leave those on #101015: the design's 7.90/3.97/89.30 × 88.33
    did. Card Conjurer's own artBounds run the art under the text box the
    same way, as the print does.
  - **Colourless** — the see-through `battle/c`: its pill, type bar and
    text box are translucent (α ≈ 191) down to the bottom border, so the
    `PROFILES` entry declares the same rect as its `underFrameArt` AND as
    that layer's `artSlot`: ONE picture, nothing to seam (as m15pw/c).
  - **The family's sizes** through `displayPct(…, "landscape")` (battle is
    in `M15_FAMILY_TEMPLATES`, joined with this bump): an 80 px name with
    M15's 0.01 em tracking (untracked it came out 2.5–2.8 % short of the
    nine prints'), a 68 px type line, the family's cost disc and 86 px
    symbol box with the ink fit. Both lines `fit: "measured"`.
  - **The name** — the pill's face rows (76–181.5), from 392 px: the
    prints start it 20–23 px past the pill's left end, right of the battle
    icon. That closes TODO 3.28 (the MSE rect began 269 px in, under the
    icon). Its baseline is the prints' 158.4 px (157.4–159.3), 2 px below
    centred — `dy` 2 / 2100, a whole px at HD and at the 750 bake, so the
    bake (which rounds a dy to whole px) and the preview move it alike.
  - **The cost** — right-aligned to 1942.3 px: the prints end their last
    disc 24 px before the pill's face ends, and centre the discs on the
    face (no `costDy`).
  - **The type line and the set symbol** — the type bar's face (the pack's
    871–975.5), from 268 px, its baseline 76.9 px below the face's top as
    printed; the symbol in CC's 180 × 86 px box, its right edge 25 px
    before the bar's face ends, centred on the face.
  - **Rules** — CC's box (the pack's 272–1933 × 1008–1422), centred, at
    the 9 pt ladder top (MOM #21's lines pitch 74–75 px; the fuller boxes
    step down the ladder as everywhere).
  - **Defense — in the shield the master paints.** The value alone, white,
    78 px, centred where the prints centre their digit (81 px right of the
    shield's left point, 82 px below its top). The drawn disc and its
    outline are gone (owner 2026-09-29). The shield is `StatSlot.paintedRect`
    (`BATTLE_SHIELD_RECT`: the pack's Defense mask at the master's size,
    moved with the lower block — `BATTLE_SHIELD` in the recipe, which the
    importer checks against the mask's solid box and against solid paint
    under it on every colour): a rules keep-out on EVERY battle, with or
    without a defense value, since the paint is always there. A value
    wider than the shield's black interior (87 px on the digits' rows,
    `inkSpanPct`) is fitted to it: "20" draws at 74.7 px, "100" at 52.9.
- **The artist credit** (3.8's slice for the two; artist only — the
  collector number, set and language beside it are 4.9d's). The printed
  card is the portrait card turned clockwise, so M15's footer line is the
  landscape card's LEFT border, running down it from the top with the
  letters' heads toward the card: `footerTurnedWithCard` turns M15's slot
  (the band it covers is centred 79.8 px from the left edge and starts
  97.5 px down; MH2 #123, TSR #186 and MOM #149 print their second border
  line 75–79 px in, from 97–99 px), and `FrameProfile.footerTurn: 90` has
  both renderers lay the line out in `unturnedRect(rect, …)` and turn it in
  place. Code-owned: not an override field.
- **The brand mark** — centred in the new bottom borders (battle's 54 px:
  ink 1454–1492; split's 57 px: 1452–1490). Battle's ends at 1865 px, 16 px
  short of the shield's left point; split's sits under the right half's
  text box.
- **Masks are importer inputs, never published.** The split pack's
  'Bottom Half' and 'Top Half' masks are, after the turn, the LEFT and
  RIGHT halves — plain rectangles cut at x 1100 of the pack's card, 1093 on
  the master (the middle of its spine; `SPLIT_HALF_MASKS`, checked and
  recorded in `lib/cards/frame-sources.json`), 4.26's inputs for a
  per-half colour. The battle's Defense mask is the shield's box.
- **The registry** (`lib/cards/frame-references.json`). split/r = MH2 #123
  Fast // Furious, with WHO #77 Coward // Killer and TSR #156 / #161 / #186
  as alternates; split/u = MH2 #60 Said // Done; split/m = C16 #239
  Trial // Error — the only gold // gold M15 split outside a showcase, in
  the frame's 2016 ARRANGEMENT (the collector line along the bottom
  border: both halves end about 100 px higher and the left one starts
  about 90 px further left), so it shows the gold dress, not where the
  halves sit — and each of its halves prints its own two-colour pinline
  and box tint over the gold (a W|U half, a U|B half), which our plain
  gold `m` master doesn't: a loose reference, best left unticked until
  4.26. w, b, g and c have no reference: built, never offered (owner
  2026-09-29). J21 #730 Fast // Furious, which the design listed as an
  alternate, is an Arena render in Arena's own layout, not a print: left
  out. A split whose halves differ in colour (GRN #224, DMR #209) imports
  `nearest`, blocked by 4.26. The old note that no mono-colour split was
  printed in M15 is gone. Battle keeps its MOM references in all seven
  keys; every battle still imports `nearest` until 5.5 (a battle is a
  transform DFC and its back face isn't modelled), but it left
  `BORDER_PENDING_TEMPLATES`: its border is the printed black one now.

Both left their git masters, the split builder, the battle's ring remover
and their `import-mse-profiles.mjs` rows behind; battle left
`NEVER_NORMALISE`, the edge contract's known failures and the square
corners' `root` fills (a square battle's corners are #000 now); both left
`ART_WINDOW_KNOWN_FAILURES`. Their masters pass the edge contract, the
corner check and the art-window check in the importer and in CI — the
split windows with 1.5–2.1 px to spare, the battle's with 2.8–3.8, its
translucent body with 0.8–1.25. Held by
`tests/unit/frames/landscape-importer.test.ts` (the helpers, the recipes
against the profiles, the published masters pixel by pixel) and
`tests/unit/render/landscape-v43-bake.test.tsx` (real bakes at HD and at
the 1050 px default: where each line, the shield's value, the turned
credit and the mark land).

Template-scoped sweep (`TEMPLATE_SCOPED_VERSIONS[43]`: every card on the
two, art or none); production, anonymous read 2026-10-06: 0 public or
unlisted cards on either (private cards and previews re-bake on their next
save). NOT verification-neutral — masters and every slot move — but neither
template has a tick to go stale. The owner's first ticks wait for the two
follow-ups (owner round 33): battle in its seven colours against its MOM
prints after TODO 4.21d, split/r and split/u against MH2 #123 and #60
after 4.21e. Tick split PER COLOUR: a template's **Publish** ticks every
colour that has a reference, and split/m — its C16 print is the 2016
arrangement with per-half pinlines — stays unticked until 4.26. Neither
is offered until then; an admin sees both with
`?previewFrames=split,battle`.

The browser half (the design's stepper check; a dev server on the shared
dev database, the admin walk-through `/create?previewFrames=split,battle&kind=…&template=…&color=…&seed=sample`
saved as a private frame preview, Chromium against the app's own live
render of the same card): with the preview laid out at the card's own px,
every line's ink sits within 2 px of the render at HD on split r / u and
battle r / u (the names and type lines 1 px high, the rules 0–1, the
defense digit 1–2, the turned credit within 1 px across; a name's width
within 3 px) — the verified m15 measured the same way: 0–2 px. In the
creator's 384 px column Chrome
sets a line's box in whole CSS px (font ascent and descent rounded, the
half-leading floored), which moves small text up to about 1.5 CSS px on
every template (m15's rules 1.1); that is the browser's, not a slot's.
(Skeptic pass, the real `CardPreview` at 384 px against the HD render: a
name sits 0.8 CSS px high on m15, 0.5 on battle and 1.2–1.5 on split —
Chrome's baseline against the font's unrounded metrics is 1.2 / 0.8 / 1.0
px high — and the type lines 0.7–0.8 on all three. No profile number
closes it: a slot's `dy` moves both renderers alike. The preview's cost
discs are also 5 % smaller than the render's on every template, m15
included (69 px against 73 at HD) — mana-font's `.ms-cost` is `font-size:
.95em; width: 1.3em`, a disc of 1.235 em of the wrapper `pipFont` sizes
by 1.3 — which is older than this change and not its business.)
A private card has no stored bake, so its My Cards tile is the live
preview letterboxed in the 5:7 tile; a public one shows its baked
thumbnail in the same box.

### The battle re-cut onto the prints (4.21d, layout v45)

Owner round 33 (2026-10-06): the battle merged as built (v43) and its right
side is re-cut BEFORE the first battle tick. After v43's block move Card
Conjurer's 'Battle' master still left the nine MOM prints (#1, #21, #22,
#63, #115, #147, #149, #190, #230) by 8–12 px on its right side, 2 px at
the name pill and 5 % at the icon's disc. The importer now re-cuts all
three (`CC_TEMPLATES.battle`: `shift` + `printRecut`, in
`scripts/lib/cc-frames.mjs`), in this order, on the 2100 × 1500 downscale
and before the corner is cut. Every row and column is the MASTER's.

1. **The top block, 2 px up** — `BATTLE_BLOCK_RECUT` gained a block: rows
   57–362 (the pill, the icon, the arc's upper curve) move 2 px up through
   the flat top border, byte for byte (`shiftBlocksRgba8`; rows 0–56 are
   one row on all seven masters). The top border is 55 rows (the pack's
   57), the window 485, the bottom border 28. 3 px up is worse (the
   border's inner edge would leave the prints by 2.3 px).
2. **The bars' right ends, stretched** — `BATTLE_RIGHT_RECUT.bands`,
   `recutColumns` (`recutBand`'s seam turned a quarter turn): inside a
   band's rows the columns from 1820 to `toX` land `by` px right, and over
   the 24 columns from 1820 each row is a premultiplied cross-fade of
   itself with itself `by` px back. The seam is opened inside each bar's
   own mottled paper, where every line a row crosses is horizontal, so
   nothing with an edge is blended; the clear window columns after `toX`
   give up `by` columns, and the importer THROWS unless they are one
   colour a row (`clearTo`).

   | Band | Rows | `toX` | `by` |
   |---|---|---|---|
   | name pill | 0–599 | 1998 | 10 |
   | type bar + text box (with its arrow notch) | 600–1299 | 2010 | 8 |
   | the text box under the shield | 1300–1471 | 2030 | 8 |

3. **The shield, 12 px right, over the border** — `BATTLE_SHIELD.dx`. The
   pack's Defense mask (moved 4 px down with its block) is the shield's
   exact outline. Its footprint (+1 px) is first repainted with what is
   beside it (`eraseMaskFootprint`, `BATTLE_RIGHT_RECUT.erase`: the paper
   mirrored from the left of each row; above row 1326 each column
   continued from above; from x 1986 the box's rim and clear window of row
   1295; the border black), the text box under it is stretched (band 3),
   then the pack's own shield pixels, lifted through the mask, are drawn
   12 px right — source-OVER (`setThroughMask`: the shield's alpha times
   the mask's coverage). A plain replace would leave the shield's
   anti-aliased edge see-through on top of the opaque border, which the
   art-window check refuses. What shows of the repaint is a 4 px crescent
   along the shield's left-facing edges. The recipe's box is 1893,1304
   164 × 166 (`paintedShieldFindings` holds the mask to it and the master
   to solid paint under it); its tips end at x 2056, short of the right
   edge's 42 px band.
4. **The icon's rings, redrawn** — `BATTLE_ICON_RECUT`, `redrawBattleIcon`.
   The pack's dark disc is r 54.9 px and concentric in its rim; the prints'
   is r 52.0 and sits 1.4 px above the rim's centre. Inside r 65 of the
   rim's centre (290.5 / 129.5) every pixel is repainted by its distance
   from 289.1 / 128.1: black to 52.0, white to 58.5, black to 62.3, then
   the rim's own colour (sampled per angle 67 px from the rim's centre,
   where every key is flat), 1 px linear edges; the pack's triangle
   (inside r 40) is kept, 1 px left. **A redraw of flat geometry, not the
   pack's pixels** — `frame-sources.json` says so (`printRecut.icon.how`).

**Measured against the nine prints** (print − master, HD px, + = right /
down; the builder's own regions and code — each edge's profile, the median
over its rows, slid under the print's fixed window; the shield by its
black interior on the rows clear of the digit; the icon by circle fits to
radial half-level crossings. The 4.21b skeptic's numbers, measured on
other rows by correlation and crossings, are in brackets):

| Edge | v43 | v45 |
|---|---|---|
| Name pill, right end | +9.6 (7.5 … 12.1) [+10.0] | **−0.4** (−2.4 … +2.1) [+0.1] |
| Type bar, right end | +8.7 (7.1 … 9.2) [+8.6] | **+0.7** (−0.9 … +1.2) [+0.7] |
| Text box, right edge | +9.1, median +8.6 [+7.6 / +8.8] | **+1.1**, median +0.6 [−0.3] |
| Shield, black interior's centre | +11.8 (left +10.9, right +12.6) [+11.7] | **−0.2** (left −1.1, right +0.6) [−0.3] |
| Name pill, face top / bottom | −2.9 / −1.4 [−2.5 / −1.4] | **−0.9 / +0.6** [−0.5 / +0.6] |
| Top border, inner edge (7 prints) | −1.3 [−0.7] | +0.7 [+1.3] |
| Icon disc, centre x / y | +1.35 / +3.86 low (290.5 / 131.5; prints 289.15 / 127.64) | **0.05 / 0.46** (289.1 / 128.1) |
| Icon disc, radius | 54.91 (prints 51.94, each 51.89–52.01) | **51.98** |
| Icon white ring, outer radius | 60.86 (prints 58.41) | **58.38** |
| Not moved: type bar top, bar bottom / box top, type bar left end, box left, box bottom | +0.9, −0.2, −1.4, −0.1, −1.4 | the same |

+9 would put the bar at −0.3 and the box at −1.3. (The builder's box
detector read MOM #115's edge 5 px right of the others'; the skeptic's two —
the paper's colour crossing on four row bands and a gradient correlation —
read it +1.0 / +0.1, with the rest: no per-print or per-colour miss.)

**Skeptic pass 2026-10-07** (other regions and methods, every colour;
print − ours, + = right / down): pill end −0.2 (−0.9 … +0.5 on eight
prints; the paper → outline crossing on the rows of the face's middle),
type bar end +0.9 (+0.2 … +1.4, all nine), box edge −0.1 (−1.2 … +0.6, all
nine, by correlation; −0.5 … +1.3 by crossing on u / b / r / g), shield
−0.4 (−1.6 … +0.2: each row's first and last black pixel of the interior,
rows 1350–1435), icon disc r 51.87 on every key against 52.03 ± 0.04,
centre 289.1 / 128.1 against 289.14 / 127.65 (sd 0.46 / 0.30), white ring
58.0–58.4 against 58.41. w, u, b, g, c and m land as red does. The 24
cross-fade columns: no step in any bar's row-mean on any key (the largest
column-to-column step is the pack's own, elsewhere in the bar); the paper's
texture energy there is 0.74–0.97 of its neighbours' (a slight softening,
not visible at 8×). The 14 objects rebuilt byte-identical from a fourth
fresh cache. **Left as the pack
has it:** the bottom border's edge (the prints' box rim is 2 px thinner),
the siege arc, and the name pill's left end (a plain concave arc on the
pack, a bracket on the prints).

**The profile rides it** (`BATTLE` in `lib/cards/template-layout.ts`;
`BATTLE_TOP_RECUT_PX` −2, `BATTLE_RIGHT_RECUT_PX` { pill 10, bars 8,
shield 12 } — `landscape-importer.test.ts` holds them to the recipe):

- the art rect's top 58.2 → 56.2 px (the see-through frame starts at row
  57 now; `battle/c` fails the art-window check without it — masters and
  profile are ONE commit);
- **the name 2 px up with its pill** (the title rect's top 76 → 74 px). On
  nine bakes of the prints' own names the letters' feet were on row 158
  where the prints' are on 156–157 (read pixel by pixel on MOM #22, #63 and
  #149; v43 took 158.4 for the prints'), the ink's top 1.7 px low and
  "Invasion of" as a whole 1.6 px low by a 2-D correlation — 0.4 px high
  after the move (skeptic pass, half-level crossings under each letter on
  all nine: the prints' feet at 155.8 px, 154.8–156.7; v43's bakes 157.5,
  these 155.5; the "I" spans 99.6–157.1 on the prints, 99.5–157.6 on ours);
- **the name 4 px left** (the title rect from 388 px, v43's 392 — the
  skeptic pass's one change to the profile). By direct reads on nine
  prints "Invasion" spans 392.6–685.2 px (its start 391.0–394.2); from 392
  ours spanned 398.2–687.7, 5.5 px right at its start and 2.5 at its end
  (the builder's 2-D correlation read 2.7 px right). From 388 it spans
  394.2–683.7: −1.5 / +1.5 px, centred on the prints' (ours is 1 % narrower
  at the same cap height);
- **the type line is NOT moved**: "Battle — Siege" starts 273.4 px in
  where the prints' starts 271.0–271.9 (2 px right) and ends 682.3 where
  theirs ends 689.4–691.0 (8 px left) — at the same size ("Siege" and the
  dash are the prints' widths to the px, 152 and 48) the prints' "Battle"
  is 168 px wide against our 162 (their fount's own pair spacing) and
  their word spaces a px wider. That is the 2-D correlation's "4 px left":
  the line's middle, not its start. A family question (the type line
  carries no tracking), left for the owner;
- **the cost keeps its rows** (`costDy` 2 / 2100 gives the 2 px back): the
  prints centre their discs 128.5–129.3 px down, 2 px below the middle of
  their pill's face. The same nine bakes' last disc lies 0.5 px below the
  prints' where it is and would lie 1.5 px above had it moved with the name;
- the cost's right end 1942.3 → 1952.3 px (the prints end their last disc
  at 1952–1953);
- the type line's rect to 1943 px and the set symbol's box to 1950 (each
  8 px with the bar);
- **the rules box keeps the pack's column** (272–1933 px). The prints'
  lines run to about 1942 px, but they WRAP round the shield; ours keep
  out of it by stepping the size down (a plain keep-out). With the pack's
  column, nine bakes of the prints' own texts set every one within 1.5 px
  of its print's size (line pitch ÷ 0.98: ours 64 / 76 / 60 / 68 / 60 / 72
  / 58 / 60 / 62, the prints 65.4 / 75.8 / 61.3 / 67.5 / 61.5 / 71.9 /
  59.3 / 61.3 / 63.3); 8 px wider, four came out 2–6 px smaller (MOM #149
  54, #230 56). Widening it wants the shield as a rules FLOAT first
  (`RulesLayoutInput.floats`, as the transform front's reverse P/T) — a
  follow-up, the owner's call;
- the shield's rect (the rules keep-out), the defense value and its ink
  span 12 px right (the value centred 1974 px across);
- the brand mark stays where it was (it ends 28 px short of the shield's
  left point now).

**Rollout.** Layout v45 (`BATTLE_RECUT_LAYOUT_VERSION` — ONE constant: it
was built as v44 beside the 2003 footer ink, which merged first and holds
44; this bump took the next number by changing the constant and
`CARD_LAYOUT_VERSION`), template-scoped to
`battle`, a "sweep" (a correction). Production, anonymous read 2026-10-07:
0 public or unlisted battles. NOT verification-neutral — the masters and
the right-side slots move — and no battle tick exists to stale: **the
owner's first battle ticks follow this bump**, in the seven colours against
the MOM references. 14 bucket objects (seven masters + WebP), reproducible
from a fresh cache of the pinned Card Conjurer commit.

### The saga (4.21c)

TODO 4.21c = 3.7 (the third of 4.21's PRs; design 2026-09-29, owner
decisions 2026-09-29; its layout bump is `SAGA_RAIL_LAYOUT_VERSION` in
`lib/cards/layout-version.ts`). The saga leaves its 375 px MSE cut in git
for Card Conjurer's saga 'Regular Frames' pack in the bucket
(`CC_TEMPLATES.saga`, native 1500×2100, copied 1:1 and cut at the one
corner) and takes the printed anatomy: the chapter ribbon in the master,
the rail on the profile. A CORRECTION — the frame was verified and in use.
Against the prints (Scryfall PNGs at 1500 × 2100; the rail measured on 54
of them, DOM → MH3):

- **Masters.** w u b r g m are the pack's `sagaFrame<K>`; `c` is its 'Land
  Frame' (owner 2026-09-29: the only printed colourless saga is a land, MH2
  #259 Urza's Saga — a colourless non-land saga wears it too). The window
  is 752–1384 × 237–1758 px on every key and the art slot is that + 0.1 %
  (50.03/11.19/42.4 × 72.68; the MSE slot started 26 px left of the
  prints'). The title bar, the type bar, the window and the rail's outline
  register with DOM #21 / #42 / #90 / #122 / #173 and MH2 #259 within the
  scans' own tolerance (1.5 px on most lines, 3.5 px on all): no re-cut.
  The ribbon (x 66–166 px with its gold outlines, full width from the fold
  at ≈ 610 px down to 1663 px, then tapering) is the pack's own drawing: on
  the DOM prints its body lies where the pack's does (the face's edge at
  153–158 px against 156; DOM prints a fatter outline, ending 164–169 px
  against 164.5), and THB, 40K, WOE, LTR / LTC, WHO and MH3 print it 3–6 px
  further right (their outline ends 169.4–171.1 px). Its TIP is not the
  prints': the pack's ends at 1748 px, 12 px above the rail's foot, where
  the five DOM references end at ≈ 1722–1730 px and the later sets higher
  still (≈ 1710 px on WOE #23, WHO #35, LTC #58, 40K #126; read off the
  scans, ± 4 px) — left as the pack draws it (skeptic pass 2026-10-06: a
  re-cut of the taper is the owner's call).
- **The bars.** The cost discs at the CC-framed M15 height
  (`CC_M15_COST_DY`: the prints centre them on 151.5–153 px; since layout
  v61 the 2023+ prints' 157 — "The cost row as printed since 2023") in a title
  band that ends at 92.2 %W (the last disc ends at 1383–1386 px on the
  prints; ours ended at 1365 and sat 12 px lower). The type line on the
  prints' baseline, 1855.3 px (1854–1857 on the five DOM references; ours
  was 1846 — `TextSlot.dy` +9.3 px), from 8.5 %W. The set symbol in the
  pack's box: its right edge at 92.27 %W and its centre on 87.39 %H (the
  prints' 1380–1384 and 1835–1836.5 px; ours ended at 1360, centred 1827).
- **The rail** is ONE layout, `lib/cards/saga-rail.ts` (`sagaRail` →
  `sagaRailDrawing(rail, target)`), in whole px per bake target, and both
  renderers only draw it (`ChapterBake` / `ChapterRail`, `RulesBoxBake` /
  `RulesBox` for every text block). The frame's numbers are on the profile
  (`FrameProfile.chapters`):
  - *The reminder block* (`chapters.intro`): its own fixed box above the
    first divider, 132–736 × 237–597 px, 62 px on a 62 px pitch — the
    standard four-line reminder then sits on the prints' baselines (341 /
    403 / 465 / 527 px). The prints set it at the chapters' 64 px in an
    italic narrower than our MPlantin italic; at 62 px ours breaks into
    their four lines. A longer reminder steps down the rules ladder INSIDE
    the box and never pushes the rows, and its lines keep out of the FOLD'S
    CORNER (`intro.keepOuts`: the ribbon folds out of the frame's left edge
    under the reminder, and on every master the fold's edge crosses the
    box's bottom-left — x 133 at y 572, 138 at 580, 144 at 588, 151 at
    596 px; a keep-out judged glyph by glyph, as for a stat badge, so a
    reminder whose last line would start on the fold is a step smaller).
    Only a reminder the box cannot hold at the 42 px floor (about 240
    characters; the editor takes 400, and layout v41 drew every one in
    full) OUTGROWS it (`SagaRail.introGrown`): it is set at the floor in
    the chapters' column (203–728 px — clear of the fold and of the ribbon,
    which the box's own width is not below the fold) from the rail's top,
    with the rows' 14 px above and below, in a box as tall as its text
    needs at both bake targets, and the rows start 24 px under it (the
    fixed box's foot to the first divider) with the divider on their top
    edge. It may take the rail down to one badge a row; only past that does
    it clip, from its tail: a reminder past ≈ 900 characters over one
    chapter, ≈ 810 over two, ≈ 730 over three, ≈ 450 over six (fifteen
    lines). Inside the editor's 400 characters a reminder reaches that only
    over SIX chapters, when its words are wide enough for sixteen lines:
    none of 20,000 random texts over one to five chapters; over six, none
    of 3,000 texts of reminder prose, and of 3,000 of card words with pips
    and numbers about one in five (25 ran to seventeen lines and lost ink;
    a sixteenth line stands in the box's own padding). (Skeptic pass
    2026-10-06 — as built it clipped past ≈ 270 characters, mid-line, with
    the rows half empty.) Its emphasis is the text's own — a parenthesised
    reminder italic, a keyword before it roman (DMU #85's "Read ahead (…)")
    — where v33 set the whole block italic. It is ONE paragraph: a line
    break typed in it is a space, as every print sets it, as v41 drew it
    and as legacy rules text reads (`parseSagaIntro`); only a chapter's
    line breaks are paragraphs.
  - *Where the rows start*: the first divider, 621 px (`rowsTopPct`; 619–621
    on 50 of the 54 prints, mean 620.1 — the pack draws 608) — lower only
    under a reminder that outgrew its box —, or the rail's
    own top at 237 px when the saga has NO reminder (owner 2026-09-29: no
    empty reminder band, no generated reminder — every stored production
    saga). Chapter I's badge then sits beside the frame's fold, above where
    the ribbon starts.
  - *The text*: the column 203–728 px (`chapters.rect`; the prints' ink
    starts at 204–206), 64 px at the top of the rules ladder on a 62 px
    pitch (v33 drew 43.5 px); a line break typed inside a chapter is a
    paragraph, as in every other rules box (v33 joined a chapter into one).
  - *The rows* are sized by their content with the walker rows' arithmetic
    (`contentRowsAt` in `lib/cards/loyalty-rows.ts`, fed a `RowAnatomy`: the
    walker's badge rail and one-badge minimum, or the saga's column and
    stack minimum): a row's natural height is its text block + 14 px above
    and below, or its stack of chapter badges, whichever is taller; the
    text is ONE size for the whole rail, the largest ladder step at which
    every row fits at both bake targets; what the rail has left is shared
    equally. (The prints set their rows by hand — DOM #21 gives chapter III
    more room than the I / II row above it — so a row's edges are ours, not
    a print's; of the simple rules, the equal share was the closest over 37
    prints.) Past the floor — by then with one badge a row, the combined
    marker below — the rows are scaled alike into the rail and a row that
    cannot hold its text sets it from its top; but no row gives up its
    badge (`rowFractionsPastFloor`: a row that scaling would squeeze under
    it is held at it, the others share the rest), so the hexagons never
    meet and never leave the rail. Six chapters of about 115 characters
    under a reminder are already past the floor; as first built a one-line
    chapter beside long ones was squeezed to half its badge (skeptic pass
    2026-10-06).
  - *The badges*: the pack's gold hexagon (`saga/chapter/badge.png`,
    118 × 132 px from x 58; the prints' reads 119–120 × 130–132, centred on
    x 117), one per chapter numeral, stacked down the ribbon. A stack's
    pitch is 160 px on DOM, THB, KHM, 40K, WOE and PIP (DOM #21 159.8) and
    134–142 px on LTR, LTC, WHO and MH3 (LTC #58 138.3 / 138.6) — by set,
    whatever room the row has: ours is the roomiest even step from 160 down
    to 138 at which the rows fit at the text's size
    (`SAGA_BADGE_PITCH_PX`), and the text steps down only once the stacks
    are at 138. A stack is centred in its row and lifted 0.17 em onto the
    text's leading, never out of the row. Up to six badges stack in ONE row
    (`SAGA_RAIL.maxStack`), as the prints do (LTR #174 six, WHO #99 five,
    WHO #86 four — the design's "four or more → the combined marker" took
    those for unprinted).
  - *The combined marker*: stacks that CANNOT FIT turn every multi-badge
    row into ONE badge with a combined label ("I–III", or "I,III,V" when
    the numerals are not a run), its size fitted to the badge; a legacy
    marker past VI is fitted the same way. "Cannot fit" is: alone (repeated
    numerals — validation lets several rows name the same chapter, so the
    stacks' own heights can pass the rail), or beside the text — the rows
    not fitting even at the ladder's floor with the stacks tight (skeptic
    pass 2026-10-06, after the owner's decision 5 and for the owner to
    confirm: v41 drew ONE marker a row, so a saga it baked whole —
    chapter I of 300 characters beside II–VI under a reminder — baked as
    first built with five hexagons and chapter I's last line cut; the
    hexagons give way before a chapter loses a line, and the text then
    takes the largest size that fits, 60 px there). Wherever the rows fit
    with their stacks — down to the 42 px floor — they are stacked.
  - *Numerals and dividers*: the numerals are MPlantin at 72 px, their
    capitals centred on the badge (the prints set a bolder Plantin semibold
    — TODO 4.8). The pack's divider (`saga/chapter/divider.png`, 592 × 9,
    drawn 6 px tall from x 150) lies on every row's top edge but the first
    row of a saga with no reminder.
- **Pieces, not ink.** The badges and dividers are frame pieces: both
  renderers draw them right after the frame, under both finish sheens and
  in their masks (`sagaRailPieces`, with the profile's overlays), and
  `frameAssetPathsFor` preloads them (`sagaRailAssetPaths`). The numerals
  and the text stay above the sheens.
- **Masks.** The pack's nine masks (Pinline, Title, Type, Frame, Banner,
  Banner (Right), Text, Text (Right), Border) are recorded on the recipe as
  `maskInputs` for the two-colour saga's pair masters (4.6f) and are never
  published.
- **Owner decisions** (owner round 34, 2026-10-06 — the before/after
  sheets' five sections signed off, every question answered AS BUILT):
  1. a saga with no reminder starts its chapters at the rail's top;
  2. a line break typed inside a chapter is a paragraph;
  3. the chapter text takes the largest size that fits, even when that fills the rail;
  4. the swap of the three DMU alternates stays (WOE #23, DOM #102, THB #160);
  5. hexagons stack up to six — the combined marker only for repeats that cannot fit, or more than six;
  6. the stack pitch runs from 160 px down to 138 px by room;
  7. the reminder keeps the text's own emphasis.
- **No saga v41 baked whole bakes clipped** (skeptic pass 2026-10-06): of
  60,000 random sagas inside the editor's limits — one to six chapters,
  stacks to six, reminders to 396 characters with and without line breaks,
  legacy numerals to VIII — layout v41 baked 29,180 with every line of
  their text, and this layout bakes every one of those whole too (as first
  built it clipped 1,098 to 1,866 of the ≈ 10,000 in each set of 20,000:
  the reminder past ≈ 270 characters); and it bakes whole another 7,786
  to 7,850 of each 20,000 that v41 clipped. Four rules hold that together:
  the reminder outgrows its box, it is one paragraph, the stacks give way
  to the combined marker before a chapter's text clips, and past the floor
  a row keeps its badge.
- **What it does not do**: flavour text (no printed saga has any — a typed
  one is not drawn, as on main); a saga creature's P/T (4.5d); the crown and
  the pairs (4.6f); the holofoil stamp (4.9d); DMU's read-ahead frame, whose
  reminder box is 97 px taller (chapters from 717 px) — a read-ahead
  reminder steps down inside the regular box instead; NEO's transforming
  sagas (5.5).

The saga left Phase B's allow-list, `ART_WINDOW_KNOWN_FAILURES` and
`import-mse-profiles.mjs` (its masters pass the edge contract, the corner
check and the art-window check in the importer and in CI). **Rollout:** a
template-scoped sweep (`TEMPLATE_SCOPED_VERSIONS[SAGA_RAIL_LAYOUT_VERSION]`
= `saga`: every card on it, art or none), never a badge. Production,
anonymous read 2026-10-06: 4 public sagas, one owner, none with a reminder
(3 gold, 1 blue; unlisted and private ones: owner SQL) — the automatic
sweep re-bakes the public and unlisted ones after the deploy, on the
owner's before/after sheet (round 34); a private saga and a preview
re-bake on their next save. NOT verification-neutral — the masters, the art
slot, the type line and the whole rail move: production's seven saga ticks
are judged by the bump's scope, so each stays offered in the creator
(`getVerifiedFrameKeys` reads `verified` alone) and is flagged "needs
re-verification" on the checklist until the owner ticks it again against
its reference. **References** (`lib/cards/frame-references.json`): w u b r
g keep their DOM defaults; gold is 40K #126 The Horus Heresy with LTC #58
In the Darkness Bind Them (three-colour prints on the plain gold frame; NEO
The Kami War is a transforming saga with an enchantment frame effect, and
KHM's two-colour sagas wait for 4.6f's pair masters); colourless is MH2
#259 alone; no FIN Summon and no DMU read-ahead saga is listed. The walker
rows moved onto the shared arithmetic unchanged:
`tests/unit/cards/loyalty-rows-pinned.test.ts` holds every size, row, line
and foil stripe of 24 layouts on the three walker bodies to what layout
v41 computed, and `tests/unit/render/pw-rows-pinned-bake.test.tsx` 28
m15pw bakes (750 and HD, regular and foil) to the pixels main baked.
Sheets: scratchpad `c421c/sheets/`.

### The 2003 footer ink (4.23a, layout v44)

Era step E1 (design 2026-10-06), a correction. Eighth Edition → Journey into
Nyx print the artist line black on white, blue, red, green, gold and the
artifact frame and **white on the black frame and on lands** (M12 #81 Blood
Seeker `#fcfdf8`, M12 #224 Buried Ruin `#f9fcf9`; Card Conjurer's 8th
Edition pack script encodes the same rule). `MODERN.footer` printed `INK_DARK` on
every master: 1.1 : 1 on `modern`/b and 2.2–2.3 : 1 on the one brown band all
seven `modernland` keys share, so only the brush painted into the MSE master
showed. Now `MODERN.footer.inkByColorKey = { b: white }` and `MODERNLAND`'s is
white on all seven keys (`footerInk()`, both renderers; 16.2 : 1 and
8.1–8.5 : 1, no shadow — the prints have none). `c` stays dark on `modern`:
it is the artifact frame, whose print is black. Nothing else moves: sizes,
masters, the P/T plate, symbols and the footer's layout are 4.10b; a hybrid
card following its left half and the Eldrazi frame have no master here.

Rollout: `"sweep"`, template-scoped to the pair
(`TEMPLATE_SCOPED_VERSIONS[44]`) and card-scoped (`VERSION_SCOPES[44]`,
`v44Changed`: every `modernland` card, a `modern` card on the black master).
Production, anonymous read 2026-10-07: 7 `modern` cards (gold ×4, the
artifact `c` ×2, green ×1), none on b, none on `modernland` — all seven are
stamped without a re-bake, and a replay of their rows (their own art, HD and
750, before and after) is byte-identical. The visual matrix against v43: 20
cases change (`modern`/b ×3, `modernland` ×17) and no other. Verification-
neutral (`VERIFICATION_NEUTRAL_VERSIONS`): no slot moves, so the fourteen 2003
ticks stay fresh on the owner's round-37 sheet; 4.10b re-opens them once.
Tests: since 4.10b the rule is held by the 2003 frame's own tests
(`tests/unit/cards/modern-2003-profile.test.ts`,
`tests/unit/render/modern-2003-bake.test.tsx` and its preview twin), which
replaced v44's `modern-footer-ink` pair when the masters moved to the
bucket.

### The 1997 frame (4.10a, layout v46)

Era step E4 (design 2026-10-06; owner round 38, 2026-10-07): `retro` and
`retroland` as the ORIGINAL cards printed them, Mirage 1996 → Scourge 2003 —
not the 2021+ reprints. A correction, made before anything is stored or
ticked on the pair. HD px throughout; ΔE is CIE76 against the per-pixel
median of a key's prints.

**Masters** (the frames bucket; `scripts/lib/print-cut.mjs`,
`scripts/lib/seventh-1997.mjs`, built by `scripts/import-cc-frames.mjs`).
Neither source was right as it stood: Card Conjurer's 'Seventh Edition'
drawing is sharp (its outer edge 1 px wide, a scan's 2.4, the MSE
conversion's 5.8) but carries the reprints' colours (white frame 215 luma,
the originals 157) on a frame 5 px off centre with a text box 8–9 px short;
MSE has the colours on a blur. So:

- **Re-cut, per key.** The prints' outer frame and art window are the same on
  every colour; their text boxes are not (against white's: blue's top 6.6 px
  lower, red's bottom 6.5 px higher, green's plank 24 px narrower, the
  land's 10 px shorter). One scale per axis cannot place six edges that are
  each off by their own amount, so the importer has a new step,
  `recutPiecewise`: one piecewise-linear map per axis through `[source px,
  print px]` anchors (outer frame, art window, text box), the art rows' and
  the text-box rows' column maps lerped across the type band; Catmull-Rom,
  premultiplied, one resample; local stretch 0.89–1.15. The anchors:
  `SEVENTH_EDGES` → `PRINT_EDGES_1997` (21 white prints) + the key's
  `SEVENTH_TEXT_BOX`.
- **Regions from the drawing's own lines, not the pack's masks.** Its Pinline
  mask is the land's coloured rings (not the bevels); its Trim mask starts
  2 px outside the text box's line, and toned through it that sliver reads as
  a pale halo. `seventhRegions`: frame body, text box and the four sides
  each of the outer bevel, the art bevel and the box's trim, cut as
  rectangles in the drawing's px and moved with the same map. Green's plank
  and black's parchment have no drawn outline: their box is cut by colour.
  A land's rings are their own region.
- **Toned with an offset.** `toneMasked` / `toneRegion` multiply; the black
  frame would need × 1.23 / 1.77 / 1.43, which doubles its grain and turns
  the highlights mint. `toneRegions`: in the body and the text box
  `(in − from) × k + to` per channel (`from` the region's mean in the
  drawing, `to` the prints', `k` the prints' texture contrast over the
  drawing's, 0.56–1.08); a per-channel gain `to ÷ from` per bevel side. The
  constants are DATA (`SEVENTH_TONES`, about 50 per key, read off the prints
  once and recorded in `lib/cards/frame-sources.json`); no scan is read by
  the build.
- **Gold is the MSE artwork.** Card Conjurer's gold failed the eye (less
  fine detail than MSE's, twice the prints' contrast, violet bevels). The
  MSE conversion — `scripts/frame-inputs/retro-m-mse.png`, the one
  MSE-derived importer input, in git — is cut with the same edge map
  (`retroGoldCut`), so its window and frame box are the other seven's, and
  not toned. Its window was cut out of a white rectangle on a 375 px JPEG,
  which left the last five px of the art ring fading grey → white — a ragged
  white hairline between the art and the ring on every bake, on `main` too;
  `clearWindowHalo` gives those px the ring's own colour (alpha untouched,
  so the window is the same window). One home per template: gold is
  published to the bucket like the rest.
- **`retroland`.** `c` = the plain land (`l.png`, the orange box of Fifth
  Edition 1997 on); `w`–`g` = the pack's coloured land boxes, toned onto the
  seven black-bordered basics of each colour (MIR, TMP, USG, MMQ, INV, ODY,
  ONS), their rings and trim by an offset (a gain on a channel near 0
  multiplies its noise); `m` = a render STAND-IN, the plain land with the
  pack's gold box laid in through its Rules mask — no three-colour 1997 land
  was measured, two-colour ones print a blend (4.6h) — which is never ticked.

Measured on the published masters (print minus master; edge = the RMS of
twelve structural edges by correlation over the key's prints):

| master | edge RMS | colour, six bands: mean / worst ΔE | before (MSE) |
|---|---|---|---|
| `retro`/w | 0.9 px (21 prints) | 1.5 / 5.2 | 2.6 / 3.3 |
| `retro`/u | 0.7 px (9) | 2.1 / 5.2 | 4.4 / 6.9 |
| `retro`/b | 3.4 px (9; the parchment's bottom reads − 9 px by correlation and 2 px by its extent) | 1.2 / 2.6 | 6.9 / 9.0 |
| `retro`/r | 1.1 px (9) | 1.1 / 2.5 | 8.1 / 9.4 |
| `retro`/g | 1.0 px on its drawn lines (the plank's ragged edge defeats the correlation) | 1.4 / 2.1 | 5.8 / 7.3 |
| `retro`/c (artifact) | 0.9 px (9) | 1.7 / 3.2 | 8.3 / 11.0 |
| `retro`/m (MSE) | 2.1 px (8); its art ring stays the MSE drawing's, up to 4.8 px off the gold prints' | 3.1 / 5.2 | 3.1 / 5.2 |
| `retroland`/c | 0.6 px (9) | 1.0 / 1.3 | 5.0 / 11.3 |
| `retroland`/w u b r g | 1.0 / 0.7 / 0.8 / 1.3 / 0.6 px (7 basics each) | 0.6–0.8 / ≤ 1.4 | 4.4–4.8 / ≤ 6.0 |

The owner accepted three drawing caveats on the prototype sheet: Card
Conjurer's blue is a flat-shaded redraw (hard shapes where the print has
brushwork), green's plank has no grain, black's parchment keeps a burnt rim.

**Profile** (`RETRO`, `RETROLAND`; sizes are `RETRO_*` in
`lib/cards/typography.ts`; no font file was added — owner 2026-10-07):

| slot | face, HD px | ink | on the prints |
|---|---|---|---|
| name | Beleren 71, measured | white `#f0f3ef` + shadow + 5 / + 3 | baseline 163, starts at 166 |
| cost | flat discs 73 (`symbolStyle: "1997"`) | — | row 137, ends at 1383, 80.5 apart |
| type line | MPlantin 67, measured | white + shadow + 4.5 / + 3.3 | baseline 1229, starts at 162 |
| rules | MPlantin 76 (the shared ladder) | dark | one box for all keys: 192–1308 × 1288–1828 |
| P/T | Beleren 86, set against its right edge (`align: "end"`, `endKerned`) | white + shadow + 6.7 / + 5.7 | baseline 1963, the ink ending at 1364–1370 on every value: one digit a side covers 1253–1367, two digits grow to the LEFT at the same size (NEM #116 10/10 1160–1370, MIR #315 12/12 1164–1364, LGN #130 13/13 1170–1368) |
| footer line 1 | `Illus. <artist>`, MPlantin 58, centred, mixed case | white + shadow + 3.5 / + 3.5 | baseline 1933, centred on 748 |
| footer line 2, the © slot | the mark at a 33 px em · a clean download's footer text, MPlantin 33 | black on the white frame, white elsewhere; no shadow | baseline 1976, centred on 748 |

The shadows are per-key ink entries (`inkByColorKey`), never a band's own
`shadowCss`: that would emboss the pips. The type line and the artist line
are MPlantin because it is their printed face; names and the P/T stay
Beleren (the prints' Magic Medieval and heavier Plantin are not in the repo
and are not being added). The footer is the centred layout of Exodus 1998 on
(D1); the mark sits in the © slot in the line's printed ink — flat dark on
the white frame, its standard white elsewhere (D2) — and no Wizards line is
printed. `{T}` is the 1997 symbol (mana-font `tap-4ed`); the five colour
symbols are the font's, as printed.

**Rollout.** `"sweep"`, template-scoped to the pair
(`RETRO_1997_LAYOUT_VERSION`, the ONE constant `CARD_LAYOUT_VERSION` reads).
Production, anonymous read 2026-10-07: no public or unlisted card on either
template, and no tick — nothing is re-baked or re-ticked. Not
verification-neutral. First ticks follow the merge: `retro` w u b r g c m
(`c` against an artifact) and `retroland` w u b r g c — thirteen;
`retroland`/m is not ticked. Imports: an original is `exact`; a Time Spiral
timeshifted printing (2006) is `nearest` — the `timeshifted-frame` gap,
`RETRO_TIMESHIFTED_FROM`: a redrawn old frame (21 prints, three per key,
against these masters: the art window's top 9–11 px lower and the text box's
bottom 5–14 px higher on every key, blue ΔE 13, red and gold 7; white, black
and green keep the old colours) — and a printing on the frame released from
2021 is `nearest` too (the `reprint-colours` gap,
`RETRO_REPRINT_COLOURS_FROM`; TODO 4.10e is those looks as their own skins).

Tests: `tests/unit/frames/print-cut.test.ts` (the two steps),
`retro-1997-importer.test.ts` (recipes, provenance, the published masters),
`tests/unit/cards/retro-1997-profile.test.ts` (sizes, ink, the © slot, the
bump, imports), `tests/unit/render/retro-1997-bake.test.tsx` (baselines,
shadows, discs, the slot and the print path on real bakes) and its preview
twin under `components/`.

### The 2003 frame (4.10b, layout v47)

Era step E5 (design 2026-10-06; owner 2026-10-07: the artwork is SWAPPED in
the same sweep as the text fix — one re-bake, one round of re-ticks, never
twice). `modern` and `modernland` as the frame's LATER drawing printed them,
Champions of Kamigawa 2004 → Journey into Nyx 2014. A correction of a LIVE
pair: 14 ticked combos and 8 stored cards on production (anonymous read
2026-10-07: gold × 5, the artifact `c` × 2, green × 1). HD px throughout; ΔE
is CIE76 against the median over a master's prints of each print's band
colour.

**The first year is another drawing.** Eighth Edition 2003 → Fifth Dawn
2004 draw the title bar and the left inner edges 6–8 px differently; from
Champions of Kamigawa on the frame is one drawing (33 of the 36 sets
measured). There is no second master and no import gap for the first year:
a black-bordered 2003 printing is `exact` whatever its date.

**Proof 2, the dry run** (before the build; the numbers below are the
published masters', which are the dry run's pixel for pixel). Card
Conjurer's '8th Edition' drawing is sharp — its outer edge 1.7–2.2 px wide,
a scan's 2.6, the MSE conversion's 6.2–6.8 — but about 1 % SMALL (frame box
1344.8 × 1946.0 px against the prints' 1358 × 1958: 5.1–6.1 px RMS over
fifteen structural edges on every key), and in colour it is a draw with the
MSE art: both sit 10–25 luma above the prints on most bands.

**Masters** (the frames bucket; `scripts/lib/eighth-2003.mjs` on the 1997
frame's steps in `scripts/lib/print-cut.mjs`, built by
`scripts/import-cc-frames.mjs`):

- **Re-cut, ONE cut for all fourteen** (`EIGHTH_CUT`; the 2003 prints' edges
  do not differ by colour, unlike the 1997 text boxes). One scale per axis
  between the outer frame's edges (× 1.0098 wide, × 1.0061 tall — the black
  border outside is never stretched) leaves 1.1–1.8 px, and what stays off
  is the same on every key by two independent reads: the type bar's top
  line 3–4 px high (the pack's bar is that much taller than the prints'),
  the text box's top line 2 px high, its bottom line 2 px low, its right
  line 2 px right. Those are anchors of the piecewise-linear map (seven on
  the rows, three on the text-box rows' columns). Catmull-Rom,
  premultiplied, ONE resample: the outer edge is 1.7–2.5 px wide after it
  (as drawn 1.7–2.2) and the 2 px lines are as drawn at 4×.
- **Regions = the pack's own masks.** Frame, Title, Type, Rules and Pinline
  are this drawing's regions (on the Seventh pack they were not); each is
  moved with the same map and the pinline is taken out of the other four
  (`eighthRegions`).
- **Every key is toned** (`EIGHTH_TONES`, 70 regions, read off the prints
  once: no scan is read by a build). By the rule "worse than MSE by a
  visible margin" seven keys needed it, but toning seven onto the prints
  beside seven left 10–25 luma light would set two looks side by side. A
  region the prints set DARKER takes the offset `(in − from) × k + to` (`k`
  = the prints' texture contrast over the drawing's, held to 0.7–1.2); one
  they set LIGHTER takes the plain gain `to ÷ from` while it is under × 1.35
  — an offset would lift the drawing's black lines to grey.
- **Keys.** `modern` w u b r g m and `c` = the pack's ARTIFACT frame, as
  before (its own `c.png` is the translucent Eldrazi frame: TODO 4.10d);
  `m` is the look of a THREE-colour card (a two-colour gold card wears
  two-colour pinlines: TODO 4.6h). `modernland` `c` = the plain land, w–g
  the basics' coloured frames, `m` the gold land of three- and five-colour
  lands. No key stays on MSE; `public/frames/{modern,modernland}/` is gone
  and both left Phase B's allow-list and `build-era-frames.mjs`.
- **P/T plates**: the pack's eight (322 × 176) under `modern/pt/`, each on a
  per-channel gain onto its prints' plate face (`EIGHTH_PLATE_TONES`: gold
  read 30 luma light as drawn, blue 20 light, red 16 dark; the rest within
  ΔE 3), drawn at `MODERN.pt.plateRect` so the outline lands on the printed
  box 1112.5–1374.8 × 1880.8–1996.9 px within a pixel (the MSE plate was
  drawn 253.5 × 99: 17 px too flat). `modernland` draws the same set.

Measured on the published masters (prints: CHK 2004 → JOU 2014,
black-bordered; edge = print minus master over fifteen structural edges by
correlation, worst edge in brackets; line = an independent read of the
dark lines' centres, no correlation):

| master | prints | edge RMS: as drawn → new | line read | colour, six bands, mean / worst ΔE: as drawn → new | MSE (before) |
|---|---|---|---|---|---|
| `modern`/w | 34 | 5.6 → **0.7** (1.3) | 1.1 | 8.1 / 10.0 → **1.2 / 1.9** | 6.2 / 7.1 |
| `modern`/u | 11 | 5.8 → **0.6** (1.3) | 1.2 | 7.7 / 9.0 → **1.8 / 3.9** | 8.0 / 9.4 |
| `modern`/b | 10 | 5.1 → **1.2** (2.8) | 1.6 | 6.5 / 9.6 → **4.8 / 10.0** | 6.0 / 8.7 |
| `modern`/r | 11 | 5.5 → **0.6** (1.2) | 1.2 | 10.9 / 16.8 → **2.0 / 4.3** | 6.6 / 7.8 |
| `modern`/g | 11 | 5.7 → **0.7** (1.7) | 1.2 | 8.8 / 15.5 → **2.5 / 5.3** | 9.1 / 11.6 |
| `modern`/m (gold) | 8 three-colour | 5.8 → **1.0** (2.6) | 2.2 | 10.7 / 17.7 → **1.7 / 3.7** | 10.1 / 14.4 |
| `modern`/c (artifact) | 10 | 5.8 → **0.8** (1.8) | 1.9 | 4.3 / 9.7 → **3.4 / 6.4** | 8.5 / 13.0 |
| `modernland`/c | 13 | 5.7 → **0.7** (1.2) | 1.7 | 2.9 / 6.6 → **1.8 / 2.7** | 8.3 / 10.8 |
| `modernland`/w | 8 basics | 5.3 → **1.0** (1.9) | 1.5 | 6.4 / 9.1 → **2.3 / 3.9** | 7.6 / 10.7 |
| `modernland`/u | 8 basics | 5.6 → **1.0** (2.1) | 1.3 | 6.8 / 12.2 → **2.6 / 5.7** | 7.5 / 10.4 |
| `modernland`/b | 8 basics | 6.0 → **1.0** (2.0) | 1.3 | 4.4 / 7.7 → **1.9 / 3.9** | 8.9 / 11.0 |
| `modernland`/r | 8 basics | 6.1 → **1.0** (2.4) | 1.1 | 5.6 / 6.6 → **1.8 / 5.2** | 8.4 / 10.2 |
| `modernland`/g | 8 basics | 5.6 → **0.8** (1.8) | 1.1 | 3.4 / 6.9 → **2.6 / 5.4** | 8.7 / 11.6 |
| `modernland`/m | 9 | 5.7 → **1.0** (1.9) | 2.0 | 10.6 / 17.2 → **2.4 / 3.9** | 8.7 / 12.9 |

(The correlation false-locks on the black frame's right-hand edges against
the black border and on red's art-R: those four reads are left out; the
line read covers them.) Known drawing caveats: the pack's WHITE body is a
blocky mottling where the prints have marble veins (faint at card size,
visible at 2×) and its keylines are flat where the prints shade them; the
BLACK frame's body is left as drawn (its sides and bottom strip read 10–20
luma under the prints' grey stone — its mean over the whole body is the
prints'); every key has clean digital bevels, not the prints' soft ones.

**Profile** (`MODERN`, `MODERNLAND`; sizes are `MODERN_*` in
`lib/cards/typography.ts`, EVEN at HD so the 750 px bake draws exactly half;
no font file was added — owner 2026-10-07: the prints' Matrix Bold is not in
the repo, Beleren Bold stands in at print-matched sizes). Read on 79 prints
of white, blue, red, green, artifact and gold:

| slot | face, HD px | ink | on the prints |
|---|---|---|---|
| name | Beleren 80, measured (before the detached cost) | dark `#17120c`, no shadow | capitals 55–56 px, baseline 198.5, starts at 133; M12 #1 "Aegis Angel" 405 px wide (Beleren's at 79) |
| cost | 66 px discs on rows 140–206 ending at 1370, a black shadow 6 px down and 2 px to the left (`symbolStyle: "2003"`) | — | discs 66.8 px on rows 139.7–206.7 (centre 172.8 ± 1.4), ending at 1369.9, 74 apart, the shadow a crescent from nine o'clock to four ending on row 211.9 and reaching 1302 px; flat pips in the rules text; the modern tap |
| type line | Beleren 66, measured | dark | capitals 46 px, baseline 1264, starts at 151 |
| rules | MPlantin 76 (the shared ladder) | dark | the column 153–1347 px inside the box's face 130–1370 × 1314–1904 |
| P/T | Beleren 80, CENTRED on 1258 px | dark | digits 58–59 px on 1959; every value centred on 1257–1260 at one size — 83 one-digit values (sd 1.9 px), CON #121 10/10 1168–1349, WWK #57 13/13 1170–1349, RTR #140 15/15 1177–1343, RAV #191 9/14 1181–1332 |
| footer line 1 | the brush (`footerBrush`: our own path, 118–227 × 1946–1969 px) + the artist, Beleren 50, mixed case, from 235 px | dark; WHITE on `modern`/b and all seven `modernland` keys (v44's map) | capitals 33 px, baseline 1967 |
| footer line 2, the © slot | the mark at a 32 px em · a clean download's footer text, MPlantin 32, from 128 px | the line's ink | baseline 2015, starts at 128 |

**The P/T is centred, not end-aligned.** The 1997 prints end every value at
one px and grow to the left; the 2003 prints centre every value on the
plate's FACE — 1258 px, 14 px right of the outline's centre (the plate
bulges left) — and set two digits a side at the full size. So `MODERN.pt`
has no `align`; a value keeps 80 px up to `99/99` and shrinks onto the face
(1134–1367 px) past it.

**The cost row** (re-measured in the skeptic pass after the owner's round-41
note "the pips are too low"; 84 prints the build did not use, CHK 2004 → JOU
2014, every colour). A printed disc often stands only a few luma off its
bar, so its own edges read 60–67 px by colour; the SHADOW is black against
the bar on every colour, and a circle fitted to its outer arc (checked on
our own bakes: radius within 0.05 px) gives radius 33.4 ± 0.5 px, lowest
point row 211.9, left-most point 1302.0 px beside the last disc. Where the
disc does stand clear (18 prints) it is rows 139.7–206.7, ending at 1369.9
px, centre 172.8 ± 1.4 — 6.5 px below the middle of the bar's face — and the
shadow lies 6.3 px under it and 1–2 px to its LEFT: a crescent from nine
o'clock round the bottom to four, none on the right. As first built (68 px
discs centred on row 174, ending at 1368, a shadow straight down to row
214, pitch 76 px) the row sat 1.4 px low and 2.3 px left of the prints'.
Now: 66 px (even: 33 at 750 px; × 1.12 is the prints' 74 px pitch), rows
140–205, ending at 1370 px, the shadow 6 px down and 2 px left to row 212 —
print minus ours: row +0.2, lowest point +0.6, left-most point +0.5 px. (Main
before 4.10b drew 63 px discs centred on row 166, 7 px ABOVE the prints:
against a stored card's old bake the corrected row is lower, and right.)
Rules-text pips stay flat.

**The footer.** The MSE masters had the brush PAINTED IN (dark: on the black
frame and on lands only the brush showed); Card Conjurer's have none.
`FrameProfile.footerBrush` is its ink box, drawn by both renderers from
`lib/cards/footer-brush.ts` in the footer's ink on that master. The line
has no prefix (`prefix: ""`), no capitals and no tracking. The © slot
(`copyrightSlot.startPct`: set from its LEFT end, under the brush) holds the
pipglyph.com mark on display — dark and flat on every `modern` master but
the black one, the standard white there and on lands (D2) — and a paid
clean download's footer text; a profile with a © slot never prints that
text at the end of line 1.

**Rollout.** `"sweep"`, template-scoped to the pair
(`MODERN_2003_LAYOUT_VERSION`, the ONE constant `CARD_LAYOUT_VERSION`
reads), no card predicate: every stored card on the pair re-bakes once (the
automatic re-bake, after the deploy). NOT verification-neutral: the fourteen
ticks are flagged "needs re-verification" — they stay verified and offered
— and the owner re-ticks them once. Their references: the gold defaults
flipped to THREE-colour prints (`modern`/m Sprouting Thrinax ALA,
`modernland`/m Seaside Citadel C13 — the master is that look), `modernland`/c
to the black-bordered Swarmyard TSP, and `modernland`/b's white-bordered
Ninth Edition alternate became M14's Swamp; a default may change here
because the bump re-opens every tick on the pair anyway. Before the merge
the owner signs the before / after of the stored cards and of all fourteen
combos (round 41) and runs `frames:promote`. Of the 8 stored cards (2026-
10-07): every name keeps the full 80 px, four type lines shrink (to 51–62
px, none cut), no rules text clips (one steps from 44 to 42 px, the
ladder's floor), every P/T keeps 80 px (a 7/99 among them).

Tests: `tests/unit/frames/modern-2003-importer.test.ts` (the cut, the
regions, the tone rule, provenance, the published masters),
`tests/unit/cards/modern-2003-profile.test.ts` (sizes, ink, the footer, the
© slot, the P/T, the symbol style, the bump, references),
`tests/unit/render/modern-2003-bake.test.tsx` (baselines, the brush, the
shadow, the slot and the print path on real bakes at 750 and HD) and its
preview twin under `components/`.

### The 1993 frame (4.10c, layout v48)

Era step E6 (design 2026-10-06; proof 3, 2026-10-08): `agclassic` and
`alphaland` at the sizes, faces and rows of the ALPHA and BETA prints. A
correction of the text and the symbols only — the masters (MSE's
magic-agclassic, in git), the art slot, the rules box and the 2026-09-25 ink
do not move. HD px throughout.

**Proof 3** measured what the design had not: 118 black-bordered Alpha and
Beta scans (and 105 of twelve later sets on the frame, for the symbols, the
tap and the footer), each registered on the master by its own top and right
frame edges (the prints' frame box: 79.6–1422.8 × 88.3–1999.4 px, ± 1–2).
Lettering by the era design's overlay (the printed ink against the same
string in a candidate face, unstretched); cost discs by a circle fitted to
each disc's outer edge — the tool reads our own flat 72 px disc as
71.6–72.5 px. Every printed line is EMBOSSED, a dark body under a light
upper-left edge; "dark layer" is the dark ink, the only part the white frame
shows.

| slot | face, HD px | on the prints (median ± sd, n) | print − ours |
|---|---|---|---|
| name | Beleren 72, measured | Goudy Medieval ≈ 84: capitals 57.5, x-height 33.5, baseline 171.5 (20 white prints); Beleren overlaps that ink best at 73.7 ± 4.3; first ink column 109.0 ± 2.9 (48) | baseline − 0.4; start + 1.5 ± 3.8 (round 44) |
| cost | flat discs 72, a 12 px gap (`symbolStyle: "original"`) | 72.6 ± 1.0 across (166 discs), row 142.5 ± 1.3, 83.2 ± 1.3 apart, the last ending at 1364.9 ± 1.0; no shadow | diameter + 0.2…0.6, row + 0.1, end 0.0, pitch − 0.8 |
| type line | MPlantin 70, measured | MPlantin 70.0 ± 0.2 (16; overlap error 0.43, Beleren 0.61), baseline 1227.4 ± 0.7; first ink column 155.1 ± 0.9 (36) | size 0.0, baseline − 0.4; start + 1.1 ± 0.9 (round 44) |
| rules | MPlantin 76 (the shared ladder) | not measured | — |
| credit | `Illus. <artist>`, MPlantin 70, mixed case; nothing for a card with no artist | `Illus. © <artist>`, MPlantin 69.2 ± 0.3 (16), dark layer on 1950.4 ± 0.9 from 153.8 ± 2.2 | size − 0.8, pen + 1.0, baseline + 1.3 (flat ink) / − 1.1 (the dark edge) |
| P/T | MPlantin 84, set against its right end (`align: "end"`, `endKerned`) | MPlantin 84.5 ± 0.4 (16; error 0.31, Beleren 0.49), dark layer on 1950.7 ± 1.1; one digit a side covers 1270–1378 px, and DRK #30 10/10, ICE #89 11/11, ALL #112 10/4 grow to the LEFT (ink ending 1383–1392) | size + 0.5, baseline + 1.5 / − 1.4, right end + 3.5 |
| the © slot | the mark at its standard em (39 px) · a clean download's footer text, MPlantin 39, silver | no second line before Fallen Empires | — |

- **One line of emboss.** Ours is the face plus `ALPHA_EMBOSS`'s dark edge
  0.035 em down and right (2.45 px at 70, 2.94 at 84). The name and the type
  line — flat dark on five keys of seven — sit ON the dark layer. The credit
  and the P/T — embossed on six of seven — sit HALF that edge above and left
  of it: the white frame's flat ink is then 1.2–1.5 px short of the print's
  and the other keys' dark edge 1.2–1.5 px past it.
- **Where the name and the type line start** (owner, round 44,
  2026-10-08 — round 4's shared 178 px margin, the art window's edge, is
  retired): where the prints start them. The name's first ink column is
  109.0 ± 2.9 px on 48 white prints, the type line's 155.1 ± 0.9 on 36; the
  slots' left edges are the PEN positions that put our ink there —
  `ALPHA_TITLE_LEFT_PX` = 104 (Beleren inks 3–7 px into its first letter's
  advance) and `ALPHA_TYPE_LEFT_PX` = 150 (MPlantin's I, S, E: 4 px). Both
  bands keep their right ends (1365, the last disc's; 1314, the set
  symbol's), so the measured fits have 74 and 28 px more room. Read with
  the second read's tool on the same 48 / 36 prints: name print − ours
  + 1.5 ± 3.8 px by the median, − 0.1 by the mean (ours 108.0 ± 1.2), type
  line + 1.1 ± 0.9 (ours 154.0). The name's spread (− 5.8…+ 5.1) is the
  two faces' first letters, not the slot: a printed B, D or H starts at
  104–106 px where Beleren's starts at 110 (− 4…− 5), a printed C, G or W
  at 109–113 where ours starts at 106–108 (+ 2…+ 4). Both pens are EVEN:
  the 750 px bake rounds a band's left and width to whole px each, and an
  odd pen set what hangs on the band's right end — the cost row, the set
  symbol — one 750 px pixel to the right (105 and 151 are 1 px nearer the
  prints at HD). For the same reason the name band ends on 90.999 %, not
  91: on the four stored cards the cost row and the set symbol are the
  pixels they were before the move, at HD and at 750 px. On every master
  the bevel is over by 92 px (`agclassic`, eight keys) or 96 px
  (`alphaland`, seven: its coloured line covers 87–91): the name's ink
  starts 11–15 px inside it and the type line's 55–60 px. The credit starts
  where the prints' does.
- **No artist, no credit** (owner, round 44): a card with no artist prints
  NO credit line on this pair — `footer.noArtist: "omit"`
  (`footerArtistLine` returns null and neither renderer draws the footer;
  the strip is the master's own pixels). Every other frame still prints its
  prefix and "Unknown". Three of the four stored cards are such cards. Only
  for a footer whose clean-download text has its own `copyrightSlot` (a
  test holds that), since a footer that carried it would lose it with the
  line.
- **The credit** is the printed one, without its ©: Alpha → Antiquities
  print `Illus. © <artist>`, Legends and The Dark `Illus. © 1994 <artist>`,
  Fallen Empires on `Illus. <artist>` over a Wizards line. PipGlyph prints
  neither a Wizards line nor a © of its own making.
- **The © slot is the border.** A 1993 card has one line in its strip, so
  `copyrightSlot` (with `endPct`: the line ENDS there) is the black band
  under the frame, ending where the border mark has always ended (3.5 % in):
  the mark on display — at HD (every stored bake) its pixels in that band
  are main's, byte for byte; the 750 px render sets it ONE pixel lower (the
  slot anchors the mark's baseline, `brandMark` anchored its bottom, and
  19.5 px rounds to 20) — and a paid clean download's footer text in
  MPlantin, in the strip's silver. That text is exact at HD; at 750 px the
  bake's whole-px font (20 for 19.5) sets it 2.5 % wide from its left end,
  so it ends past the slot's end — 5 px on a 16-letter text, 8 px on one
  cut at the slot's full width (12 px at most), still 14 px inside the card
  — the same rounding the mark has on every frame. On main that text was set at the END of the credit line, in the
  credit's face; at 70 px it would run into the P/T.
- **The symbols** (`symbolStyle: "original"`, 4.24): the five colour symbols
  are the 1993 DRAWINGS — the ringed twelve-ray sun; the drop, skull, flame
  and tree drawn to fill their pale discs — as IMAGES, Card Conjurer's
  `img/manaSymbols/old/old{w,u,b,r,g}.svg` rasterised at 216 px into the
  frames bucket (`manaoriginal/<letter>.png`; `CC_RIDERS.manaoriginal`,
  provenance in `lib/cards/frame-sources.json`; never git). mana-font has
  only the sun. `SymbolStyleSpec.symbolImages` names them,
  `manaGemSpec()` returns `{ kind: "image", path }` and both renderers draw
  the whole pip in the disc's box — the element an owner's custom pip uses,
  and an owner's own pip still wins. The bake reads them synchronously:
  `frameAssetPathsFor()` warms exactly the ones the card's text names
  (`symbolImagePathsIn`: cost, rules text, second face, structured face) —
  one missing from the bucket fails the bake, as a master does. Generic
  numbers, hybrids, `{C}`, `{X}` and `{T}` stay the font's glyph on our
  disc; `{T}` is the tilted T (mana-font `tap-3ed`). Discs are flat in the
  cost and in the rules text, and the gap between two cost discs is the
  style's (`costGapDiscs`: 12 px here, 0.12 of the disc on every other
  style — `costPipGapPx`, read by the bake's cost row, the preview's and the
  name's room).
- **Which sets print what** (by eye on 14 sets): the old sun on LEA, LEB,
  2ED, ARN, ATQ, 3ED, LEG, DRK, FEM — Fourth Edition 1995 prints today's;
  the drop, skull, flame and tree are today's shapes throughout (Alpha, Beta
  and Unlimited a rougher skull). `{T}`: LEA, LEB, 2ED, ARN and ATQ spell
  the word "Tap"; the tilted T is Revised's (3ED, LEG, DRK, FEM); the turned
  arrow from Fourth Edition. Inline mana in the rules text of 1993–94 is the
  bare drawing with no disc — not built (the inline disc stays 0.785 em).

- **The set symbol keeps its old size** (owner, round 44): the pair pins
  `symbolSizePct` to `ALPHA_SET_SYMBOL_BOX_PCT`, 49.5 px — what the 45 px
  type line × 1.1 gave it before v48 — so it does not follow the 70 px type
  line (unpinned, the box was 77 px and the default mark 75 × 75 in the
  83 px type band). Alpha and Beta print no set symbol; no print decides
  it. The default mark (all four stored cards) is 50 × 50 px on columns
  1264–1314, rows 1174–1224 (centred on 1199, the band's middle): on the
  four stored cards those pixels are main's, byte for byte, at HD and at
  750 px.

**A second read** (the skeptic's pass on PR #493, 2026-10-08: 128 Alpha /
Beta prints the build did not use, moved onto our bake by their own frame
edges; the same tool on the print and on our bake of the same card):

| what | prints | ours | print − ours |
|---|---|---|---|
| cost disc (a circle fit by the ring's strongest colour step, 147 discs on 80 cards) | 72.0 ± 0.6 | 72.0 | + 0.2 ± 0.6 |
| discs' centre row, below the frame's top edge | 54.0 ± 0.9 | 54.2 | − 0.2 ± 0.9 |
| last disc's centre, left of the frame's right edge | 92.0 ± 1.5 | 92.2 | − 0.1 ± 1.5 |
| pitch | 82.9 ± 1.2 (66 pairs; two equal colour symbols 82.8 ± 0.2) | 84.0 | − 1.1 a step: the third disc from the right sits 2.3 px left of the print's, the fourth 3.4 (83 would break "the 750 px bake is half": its gap is 5.5 px) |
| shadow: luma under the disc less luma above it | + 2.1 ± 8.6 (149 discs; main's shadowed discs − 16) | flat | — |
| the five drawings, as a share of their disc (10–22 discs each) | W 88 × 90 %, U 43 × 82 %, B 88 × 88 %, R 78 × 85 %, G 87 × 88 % | 90 × 92, 45 × 85, 89 × 89, 79 × 86, 86 × 89 % | within 3 % of the disc; centred within 1 px |
| name, first ink column (48 white prints) | 109.0 ± 2.9 | 182–186 (round 44: 108.0 ± 1.2) | − 73, the round-4 margin (round 44: + 1.5 ± 3.8) |
| name, ink width, the same string | — | — | the print's is 7.9 ± 4.6 % wider (Beleren would need ≈ 78 px) |
| name, capitals / x-height / baseline (26 names with no descender) | 58.1 / 35.0 / 172.6 ± 1.3 | 52 / 36 / 172.0 | + 6 (≈ 80 px by the capitals) / − 1 (≈ 70 px by the x-height) / + 0.1 |
| type line, the same printed string (36: `Instant`, `Sorcery`, `Enchantment`, `Enchant Creature`) | starts 155.1 ± 0.9, bottom 1228.5 ± 1.0 | 183.0 / 1228.0 (round 44: starts 154.0) | − 27.6, the round-4 margin (round 44: + 1.1 ± 0.9) / + 0.5; width print / ours 1.010 ± 0.008 |
| `Illus.` (48 white prints) | 49.0 px tall, starts 158.1 ± 0.9, bottom 1951.6 ± 0.7 | 49.0 / 156.0 / 1950.0 | height 0.0, start + 2.1, **2.0 ± 0.8 px lower in print** |
| P/T, one digit a side (6 white prints) | ink 1270.4–1374.1, bottom 1951.7 ± 0.7 | 1270.0–1373.0, 1949.0 | left + 0.3, right + 1.6 ± 0.7, **2.4 ± 0.4 px lower in print**, 1.9 % larger |

So the cost row holds within a pixel but for its pitch, and the white
frame's flat credit and P/T sit about 2 px above the print's (the list
above says 1.2–1.5); on the red and green frames our silver face reads
about 2 px BELOW the print's light face — the two halves of the same
half-emboss compromise, each nearer 2 px than 1.5. Beleren at 72 px is the
print's name by its x-height, 8 % narrow by its width and 6 px short in its
capitals. By eye: on the red and green frames the prints set the NAME and
the TYPE LINE in the embossed LIGHT ink (LEA #154, #199; ours: flat dark,
the 2026-09-25 ink decision — not this step's); inline in the rules text
the prints of 1994 set the colour symbols and the numerals bare and only
the tilted T on a grey disc (3ED #211, FEM #26); printed generic numerals
are heavier and taller in their disc than the font's, and the printed red
and green discs are paler than Card Conjurer's.

**Rollout.** `"sweep"`, template-scoped to the pair
(`ALPHA_1993_LAYOUT_VERSION`, the ONE constant `CARD_LAYOUT_VERSION` reads),
no card predicate. Production, anonymous read 2026-10-08: 4 public cards on
`agclassic` (white, red, the artifact `a`, a colourless foil on `c`), none
on `alphaland` — each re-bakes once (the automatic re-bake, after the
deploy), after the owner's before / after sheet and `frames:promote` (ten
objects: the five PNGs and their WebP siblings). Not verification-neutral;
no tick exists on the pair — first ticks follow the merge. Imports: a
black-bordered printing of 1993–94 (LEA, LEB, ARN, ATQ, LEG, DRK) is
`exact`; a white-bordered one names the `border` gap (4.30); a printing
released from Fallen Empires on is `nearest` — the `two-line-footer` gap,
`ALPHA_TWO_LINE_FOOTER_FROM` = 1994-11-01, TODO 4.10h (a smaller credit over
a second line, and from Fourth Edition today's sun and the turned-arrow
tap).

Not done here: the generic numeral's printed look (a Plantin numeral on a
halftone disc), the rules text's printed size, the 1993–94 inline symbols without discs (the owner
keeps the discs, round 44), the print's © in the credit (the owner: none), the Alpha
bevel lighting (4.31), Card Conjurer's Legends multicolour for `m`, the
white border (4.30).

Tests: `tests/unit/cards/alpha-1993-profile.test.ts` (sizes, faces, the
credit, the P/T, the © slot, the symbol style, the bump, imports),
`tests/unit/render/alpha-1993-bake.test.tsx` (baselines, the emboss, the
cost row, image pips and their warm-up, an owner's pip, the slot — on real
bakes at 750 and HD — and the published symbols),
`tests/unit/frames/alpha-1993-importer.test.ts` (the recipe, provenance) and
the preview twin under `components/`.

### Two colours on the old frames (4.6h)

An ADDITION ([above](#additions-vs-corrections)): the card's own
`frame_style.twoColor` switch, as on m15 — new two-colour cards start with it
on, a stored card keeps plain gold until its owner switches it on, an import
follows the printing. No layout bump, no sweep, no badge.

**What the prints do** (181 scans read on 2026-10-08; each print pixel's
share between OUR two single-colour masters of the frame, a ramp fitted by
least squares):

| Look | Prints | What splits | Where |
|---|---|---|---|
| 2003 gold card, two colours (Ravnica 2005 → Journey into Nyx 2014) | 52 | the pinline and the text box; the frame body, the bars and the P/T box stay gold | box: a soft blend 25→73 %W on every pair. Pinline: the same soft blend (25→71) on wu wb ub ur br rg gu, a narrow straight one (42→59) on bg (8 of 8), gw (6 of 7) and rw (6 of 8) |
| 2003 two-colour land (Eighth Edition 2003 → Theros 2013) | 36 | the pinline and the text box, over the PLAIN land's body and grey bars | one straight ramp, 42→59 %W |
| 1997 two-colour land (Sixth Edition 1999 → Onslaught 2002) | 36 | the text box and the box's ring, over the plain land — its gold outer and art rings too | one straight ramp, 40→60 %W |

What prints NO two-colour look, and so is not built:

- **1997 gold spells** — one gold frame whatever the colours (12 of 12,
  Mirage 1996 → Odyssey 2001). `retro` declares no pairs, and the registry
  no longer calls a two-colour 1997 gold printing a gap (`GOLD_PAIR_TEMPLATES`).
- **1997 lands of 1997–98** (Fifth Edition, Tempest, Anthologies: 11 of 11)
  and the ones coloured only by their abilities (Judgment, Onslaught: 5 of
  5) — the plain land's orange box. They import as the plain land
  (`landFrameColors`).
- **The 2003 frame before Ravnica** — its one two-colour gold card, Iname as
  One (SOK #151, June 2005), is plain gold. It imports on the gold master
  with no switch (`TWO_COLOUR_2003_GOLD_FROM`).
- **2003 hybrid cards** — the frame BODY is split, the bars and the P/T box
  are grey (10 of 10). Another look, not drawn: the `two-colour-hybrid` gap
  stays. An all-hybrid cost with the switch on gets the gold card's split,
  with the creator's one-line note, as on m15artifact.

**The masters are synthesised.** Card Conjurer's packs hold no two-colour
file for either era (the 8th pack: fifteen single masters and five masks;
the Seventh pack: fourteen, and a "Dual Land" mask of nested rectangles that
no print wears). A pair master is made of the template's OWN finished
masters — the pack's drawings after their re-cut and tones, never a scan
(`oldFramePairLayers`, `scripts/import-cc-frames.mjs` `pairOfFinishedMasters`):
the base whole (`modern/m`; the plain land `c`), and inside the split
regions the pair's two colour masters blended left to right by a
premultiplied lerp (`scripts/lib/pair-ramp.mjs`; a ramp may now be
`[from, to, "smooth"]`, a smoothstep). The regions are the pack's own Rules
and Pinline masks moved with the cut (2003) and the drawing's own box and
ring (1997). A 1997 pair's two sides are built on the PLAIN land's cut: the
basics' boxes sit up to 2.5 px off it, the dual prints' box within 1 px of
it. `tests/unit/frames/old-frame-pair-masters.test.ts` recombines every 2003
pair from the published files to the byte.

**Code.** `twoColorMasters: ["split"]` on the `modern`, `modernland` and
`retroland` PROFILES entries (`twoColorForLands` on the two lands), with the
pair keys' ink through `withPairInk` (a pair prints its base master's ink:
the gold frame's dark footer and mark, the land's white, the 1997 white with
its shadow). The P/T plate is the gold `m` plate (`plateKeyFor`). Both
renderers, the creator's switch and its copy, the save and the remix are
4.6b's, untouched.

**Import** (`printsTwoColorFrame`): the 2003 frame — a land always, a gold
card from Ravnica on (`TWO_COLOUR_2003_GOLD_FROM`), never a hybrid card; the
1997 frame — a land that taps for both colours, printed from 1999 on
(`TWO_COLOUR_1997_LAND_FROM`), or an Onslaught fetch land. Two printings the
data cannot tell, found by the skeptic pass on 251 further printings
(2026-10-08) and named:

- Scryfall dates the 2005 promos 2005-01-01. Arena League's Skyknight
  Legionnaire (PAL05 #8) prints the split, the textless Psychatog of Player
  Rewards (P05 #1) plain gold — so the one early set is named
  (`TWO_COLOUR_2003_GOLD_EARLY_SETS`), never "any promo". The seven
  printings Scryfall dates before the day are those two, Iname as One and
  Unhinged's four (plain gold).
- Riftstone Portal (JUD #143) taps for {C} alone; the {G} and {W} Scryfall
  lists are what it grants other lands. It prints the plain land
  (`LAND_FRAME_OVERRIDES`).

**Verification.** A pair rides its template's `m` tick (owner decision
2026-09-29, V-A), after the owner signs the PR's pair sheets — nothing new to
tick. The creator's gate reads the colour key (`frameGateError`,
`pickFrameColorKey`), and a pair's is `m`. Production, read 2026-10-08:
`modern/m`, `modernland/m` AND `retroland/m` are ticked (`retroland`'s seven
keys were ticked together that morning, at layout 46), so all three
templates' pairs are offered there as soon as the masters are promoted and
this is deployed. `retroland/m` itself is a render stand-in (the plain land
with a gold box, which no printing read wears — a three-colour 1997 land
prints the plain orange box); its tick is what offers the pairs AND that
stand-in. The dev database has no `retro` / `retroland` tick at all, so on a
preview only an admin's `?previewFrames=retroland` reaches them. One tick
reads stale on the sign-off page after this: `retroland/m` was scored against
Seaside Haven (ONS #323), which now imports as the plain land `c` and left
the slot for Crosis's Catacombs — the gate (verified rows only) is not
affected.

**Proof that nothing stored changes.** The replay of 124 visible production
cards (all 8 on `modern`; production holds none on the other three) is
byte-identical at 750 and HD, base against head; with the switch forced on,
the 8 stay identical (their colour is stored `multicolor`, no pair); the
visual matrix: 1,451 unchanged, 0 changed, 15 new.

### The Vehicle frame (4.5c)

TODO 4.5c (owner 2026-09-29 and 2026-10-12). `m15vehicle` is the printed
Vehicle frame, Kaladesh 2016 → today: a bronze frame where an artifact has
the silver one, the card's own bars, text box and pinline (silver for a
colourless Vehicle, the colour's for a coloured one — War of the Spark
2019 on — gold for two colours or more), and ONE brown P/T plate with
WHITE digits whatever the colour.

**What the prints show** (68 Vehicle prints read at 1500 × 2100,
2026-10-12, from 522 Vehicle printings on the 2015 frame): 67 of them —
52 of 53 plain black-bordered, 7 of 7 borderless, 8 of 8 extended art —
wear the brown plate with white digits (ink 252 / 252 / 253 at the median, never under
241), and every plain one the bronze frame. The one exception is DOM #237
Weatherlight (bronze frame, a SILVER plate, dark digits): not offered
(owner 2026-10-12). The plate's brown box reads x 1173–1420, y 1868–1985 px
at the median; ours, at M15's plate box, 1172–1423 × 1873–1980. Spacecraft
(EOE 2025) print another frame — the station layout: no brown plate but a
BLACK one with WHITE digits, set inside the tier that makes the card a
creature (12 of 12 plated scans in the frame roadmap of 2026-10-13;
re-read on EOE #25 and #208: the plate's face at luma 42–43, its digits at
255) — and are TODO 4.27a's, not Vehicles. (An earlier note here said
"dark digits": the plate is dark, the digits are not.) Until that frame is
built an import of a station printing — Scryfall's keyword Station, its
only field for the frame — lands on the artifact frame (a Planet on the
land frame) as its NEAREST and is logged (`station/2015`; the extended-art,
borderless and showcase printings keep their own rule with the `station`
gap), where `era/2015` used to call it exact.

**Masters** (the frames bucket; `scripts/lib/cc-frames.mjs`): Card
Conjurer's own recipe for a type line that says Vehicle
(`cardFrameProperties`) — the accurate M15 pack's 'Vehicle Frame'
(`m15/new/v.png`) through its Border and Frame masks, then the colour's
(colourless: the artifact frame's) text box, title bar, type bar and
pinline through the pack's masks: m15artifact's recipe with `v.png` for
`a.png`. The ten two-colour pair masters (owner 2026-10-12) are
m15artifact's split recipe the same way — gold bars, the text box and the
pinline in the two colours over the bronze frame (DFT #188–220, NEO #231,
MKM #215); no hybrid dress. Nothing is synthesised.

**The plate** is the pack's `m15PTV.png` (381 × 209), one image under
every colour key (`m15vehicle/pt/<k>.png`), TONED onto the prints (owner
2026-10-12): Card Conjurer's face reads 110 / 73 / 30 where the prints'
median is 123 / 91 / 67 (52 plain Vehicles, the same box). A per-channel
gain would need × 2.23 on blue and turns the bevel's light rim lavender, so
the tone keeps each pixel's hue — `VEHICLE_PLATE_TONE`: its colour pulled
toward its own luminance (× 0.552) and the whole lifted (× 1.235), the
least-squares fit of the face (116 / 89 / 64 after). The importer's
`plateTone` records it in provenance. Its ink row is in
`lib/cards/plate-ink.ts`, so the rules lines keep out of it like any plate.

**The profile** is m15artifact's with that plate and white digits: the
same slots, crown (a colourless Vehicle's is the artifact silver — DMU
#230 — a coloured one's its colour, KHM #169), stamp notch (the bar under
it is the artifact master's, byte for byte, on all seven keys) and
collector line; `twoColorMasters: ["split"]`.

**A frame for Vehicles only.** It is a stored template of its own, picked
under Variations ("Vehicle", beside the Artifact frame) — never a
render-time pick from the subtype, which would re-dress every stored
Vehicle, and not a `frame_style` switch (owner 2026-09-29). The Artifact
kind covers every artifact, so the rule is a per-card one, like the
basic-only frames: `SUBTYPE_DRESSES` in `lib/creator/card-kinds.ts`
(`subtypeFrameFits`). The chip is disabled with its reason on any card
whose subtypes don't say Vehicle, the server's kind gate refuses the save
(`lib/cards/frame-kind-gate.ts`: also an edit that takes the word off a
card on the frame), a random, stand-in or AI-fill frame pick never lands on
it, and a reference printing pinned to it must be a Vehicle.

**Rollout: an addition.** No stored card sits on a new template, so there
is no layout bump, no sweep and no badge.

- A NEW Vehicle starts on it: in the creator the frame follows the subtype
  between the artifact frame and its Vehicle dress (`subtypeFrameFor`) —
  the moment the subtypes first say Vehicle on a card wearing the artifact
  frame — and the AI jobs land a Vehicle there (`resolveGeneratedFrame`).
  Only where the frame is verified in the card's colour; until then nothing
  changes and nothing is said. "Artifact" in Variations is the way back,
  and a pick made by hand sticks.
- A STORED Vehicle keeps its frame (the artifact frame's silver plate, or
  whatever it wears) until its owner picks "Vehicle".
- An IMPORT follows the printing: the registry's `vehicle/2015` rule lands
  a plain 2015-frame Vehicle on the artifact frame, as before, until
  `m15vehicle` is verified in its colour, and from then on names it, exact
  (`onceVerified` — the `vehicle` gap is drawn there, `gapDrawnBy`). The
  extended-art and borderless Vehicles and a Vehicle BACK face keep the gap
  — and so does the one silver-plated print, Dominaria's Weatherlight (DOM
  #237, its prerelease stamp and its List reprint:
  `SILVER_PLATE_VEHICLE_PINS`), which is never "exact" on a brown plate and
  lands on the artifact frame as it did before.
- A BORDERLESS or EXTENDED-ART Vehicle lands on the Vehicle frame as its
  NEAREST (owner 2026-10-12, round 48; 67 borderless — 4 of them nicknamed —
  and 49 extended-art printings, Scryfall `t:vehicle` 2026-10-12, 573
  printings). The prints wear the brown plate (7 of 7 and 8 of 8 read) on a
  dress we have no Vehicle plate for, so the match is unchanged — the
  printing's own frame (`m15borderlessartifact`, `extendedart`), `nearest`,
  the `vehicle` gap, the same signature — and only the LANDING moves
  (`FrameMatch.landOnOnceVerified`, applied by `withVerification`): the
  silver artifact frame until `m15vehicle` is verified in the card's colour,
  the Vehicle frame from then on, and the reason says so ("this printing is
  borderless, and PipGlyph draws the Vehicle plate on its bordered Vehicle
  frame only"; a nicknamed one keeps its nickname reason). It replaces a
  STAND-IN landing only: the borderless frame's bordered twin (1.18 — the
  chooser still offers the borderless artifact frame, second, and the
  artifact frame), or an unverified frame's fallback. An extended-art Vehicle
  whose `extendedart` frame IS verified in its colour stays on that frame
  (no colour is today) — which of the two is nearer then is the owner's to
  say. The AI deck REMIX of a Vehicle printing lands where its import lands
  (plain, borderless or extended art; Dominaria's Weatherlight on the
  artifact frame), at the same one credit — `remixFrameFor` finalizes the
  mapper's landing through `finalizeImportMatch` (2026-10-13). Only the
  Artifact kind with the subtype on its front face, off the
  pinned silver plate: no Spacecraft (4.27), no back face (5.10).
- NOT the showcase Vehicles (17 printings: NEO, KHM, MH2, DSK, WHO, OTP,
  LTR's scroll, DFT's Japan showcase, the FCA source-material Copter). Each
  set's showcase draws its own plate — brown with white digits on three of
  the nine looked at (NEO #404, KHM #315, MH2 #378), grey, black, newsprint
  or parchment on five, none on FCA #62 — so "the print wears the Vehicle
  plate" does not hold for them as a group, and they land where they did
  (the artifact frame, `nearest`: 4.11's per-set frames).

**Sagas are not part of it.** The item's other half — a P/T on the saga
body — is not built (owner 2026-10-12). The only saga creatures printed
with the saga layout are Final Fantasy's "Summon:" cards (FIN / FIC 2025),
and their body is not ours: the textured saga with its type bar raised by
173 px (its outline at 1588–1722 px of an HD card on all 19 black-bordered
prints read, 1760–1899 on six plain DOM / DMU sagas and on our master), a
second text box under it (1723–1947 px) and the plate at the M15 spot (the
digits' ink there on 19 of 19, none where Card Conjurer puts its saga
plate), the rail and the art column that much shorter. No plain saga
ever printed a P/T, and Card Conjurer's `saga/pt` plates sit on the type
bar's right end, where the set symbol goes. The printed body comes with
4.5d's textured saga, as a new template; until then the creator's note
("This frame doesn't draw power / toughness", `lib/cards/pt-drawn.ts`)
stays true for a saga creature.

### The Nyx dress (4.7)

TODO 4.7 (owner decisions A3 / A4, 2026-09-29; the frame roadmap of
2026-10-13, block 3). `m15nyx` is the printed ENCHANTMENT frame on the 2015
frame: the M15 frame with a starfield in its frame field. It is not the
`nyx` template (the Theros Beyond Death constellation showcase, THB
#258–268, which stays — its own crown is [The constellation
crown](#the-constellation-crown)) and not the token kind's Nyx (4.51).

**Which printings** (Scryfall `frame:nyxtouched` — the `enchantment` frame
effect — 2026-10-13: 1,746 printings). 131 are on the 2003 frame (Theros,
Born of the Gods, Journey into Nyx 2013–14, their promos and List
reprints): out of scope, they keep `nyx/2003` (nearest). 1,615 are on the
2015 frame, and 983 of those are plain — black border, one face, no other
treatment, no token, no saga: 386 enchantment creatures, 6 enchantment
artifacts and 591 plain enchantments and Auras; 134 legendary, 85 in two
colours (4 with a hybrid cost), 21 in three or more, 4 colourless.

- Enchantment creatures: 1 in 2014, 11 in 2015, 20 in 2016–19 (reprints of
  Theros cards), then every one — 354 of the 388 plain printings since
  Theros Beyond Death 2020; the 34 without it are Arena's Pioneer Masters
  (31), a playtest card, MB2 #575 and SLD #7039.
- Enchantment artifacts: all six plain printings (Bident of Thassa C15 #86,
  A25 #42, LCC #146; Whip of Erebos CP2 #5; Hammer of Purphoros EOC #88; a
  promo), each in its COLOUR's starfield, never an artifact frame.
- Plain enchantments: none before Foundations (2024-11-15), every one
  since — 591, and 0 on the plain frame in any premier or Commander set
  from FDN on (the plain ones left are promos, List reprints, Alchemy, and
  Foundations Jumpstart). The frame is the enchantment frame now, not the
  enchantment-creature frame.
- The rest of the 1,615 are other bodies or dresses: 201 sagas (4.5d), 138
  borderless, 109 extended art, 66 showcase, 49 double-faced, 29 full art,
  8 classes, 4 adventures, a case, 4 tokens, and 23 black-, white- or
  yellow-bordered `inverted` / etched printings.

**What the prints show** (101 plain prints read at 1500 × 2100, every
colour, C15 2015 → FRA 2026, against Card Conjurer's masters):

- The starfield is in the frame field ONLY. Inside Card Conjurer's Title,
  Type, Rules, Pinline and Border masks its Nyx masters equal the regular
  M15 masters (mean difference 0.00–0.20 of 255 on all seven; 46–62 inside
  the Frame mask). On the prints the bars, the box and the pinline read
  within 13 levels a channel of our masters with 0 % bright specks (a pixel
  45 luma over its region's median) — against 10–30 % in the frame field —
  and the P/T plate face is M15's own, 0 % specks on 58 creatures.
- It is the same drawing as the masters': the prints' frame field
  correlates 0.84–0.89 with the Nyx master of its colour (median per
  colour; 0.58–0.92 over all prints, lowest on the 2014–15 scans) and
  0.30–0.36 with the regular M15 master (0.68 on white, light either way).
  A plain enchantment's (0.85, n 38) is an enchantment creature's (0.84,
  n 51).
- Tones need no correction. Field medians, print / master: white
  126/130/112 – 128/135/110, blue 9/78/115 – 1/79/116, black 36/30/67 –
  41/37/68, red 159/66/40 – 162/68/38, green 47/90/55 – 48/92/53, gold
  141/115/63 – 147/120/61.
- Two colours print m15's two dresses over the starfield: the gold field
  with the split box and pinline (THB #220, NEO #225, FRC #52; 14 read),
  and for a hybrid cost the two colours' fields under grey bars (HOB #155,
  FRA #134, ECC #121, SLD #2444).
- Colourless: Eldrazi Conscription (SOC #131) wears the pack's silver
  starfield (48/63/67 against the master's 50/63/73, correlation 0.85).
  Faceless One (CLB #1) prints a tan frame of its own (189/173/127) and is
  not matched by any master; the registry cannot tell it apart.
- The crown: 30 of 31 legendary prints since Theros Beyond Death carry the
  starfield in the strip INSIDE the crown, between its arch and the title
  bar (it correlates 0.87–0.96 with Card Conjurer's Nyx inner crown, 0.65–
  0.84 with the plain crown band; white reads 130/118/99 there against the
  plain crown's 242/241/236). The one flat crown is the oldest, Kestia
  (C18 #42, 2018). The crown itself is M15's.

**Masters** (the frames bucket; `scripts/lib/cc-frames.mjs`): Card
Conjurer's 'Nyx (Theros)' of the accurate M15 pack — seven whole masters at
2010 × 2814 (`m15/new/nyx/<k>.png`), downscaled once. The colourless key is
the pack's artifact starfield (`a.png`; there is no see-through master, so
no art under the frame). The twenty pair masters are m15's recipes with the
Nyx files: `<pair>` the gold starfield with the split box and pinline,
`<pair>-h` the two starfields across the frame ramp under the regular
pack's grey land bars (the Nyx pack has no land file; its bars are the
regular masters' own). The plates are m15's seven images — the colourless
key keeps the grey m15PTC, which is the hybrid dress's plate and what
Faceless One's plate reads (206/202/202). Nothing is synthesised or toned.

**The crown** is its own band, `m15nyxcrown/<key>.png`: the m15crown
recipe with Card Conjurer's Nyx inner crown (`innerCrowns/new/nyx`, 1353 ×
64) as its last layer at the pack's bounds — one overlay, never two
stacked (`M15_NYX_CROWN`; keys w u b r g m a and the ten pairs). The stamp
notch is m15's (`m15holostamp`: the bar under it is the same pixels on
every Nyx master, checked by the importer for the twenty pairs).

**The profile** is m15's — slots, sizes, both two-colour dresses, the
collector line, the stamp, the text alignment — with its own masters,
plates and crown band, and no `underFrameArt`.

**Who wears it.** A stored template of its own, never a render-time pick
from the type words, which would re-dress every stored enchantment. It
dresses a card whose TYPE WORDS say Enchantment — the card type, or a word
in `supertype` ("Enchantment Creature" is the creature card type with the
word; "Enchantment Artifact" the Enchantment card type with "Artifact", as
the importer writes them; never `printed_types`) — in the three kinds such
a card can be (`TREATMENT_KINDS`: creature, enchantment, artifact;
`ENCHANTMENT_DRESSES` / `enchantmentFrameFits` in
`lib/creator/card-kinds.ts`). The server's kind gate refuses it on any
other card, and on an edit that takes the word off a card on the frame.

- In **Variations** it is "Nyx". A creature and an artifact BORROW it, as
  they borrow the artifact frame and the constellation showcase (A3 / A4):
  picking it writes "Enchantment" into the type line, and leaving the frame
  takes the word out again if the pick put it there. The Enchantment kind
  wears it as its own skin (`KIND_SKIN_VARIANTS`); an instant or a sorcery,
  whose standard is m15 too, is never offered it.
- **A new card follows** onto it (`enchantmentFrameFor`: the creator's
  effect, `resolveGeneratedFrame` when a frame is asked for) when its words
  say Enchantment — the moment they first do, on the kind's M15 frame,
  where the Nyx frame is verified in the card's colour; "Standard" in
  Variations is the way back, and a pick made by hand sticks. A card on the
  frame whose words stop saying Enchantment goes back to its kind's frame.
- **A plain enchantment and an Aura follow too** (owner decision 1, Round
  56, 2026-10-13: as print does since Foundations; the build had offered it
  and never moved it). Never a card of a kind with no base here — an
  Enchantment Land, a token, the saga kind, a double-faced face — and never
  an enchantment whose SUBTYPES name a body of its own in print (Saga,
  Class, Case, Room typed on a plain enchantment:
  `ENCHANTMENT_DRESS_OWN_BODY_SUBTYPES`, read by `followsEnchantmentDress`
  alone): those are offered the frame, may wear it, and are never moved.
  While the frame is unverified in the card's colour nothing follows.
- **An AI card follows where a frame is asked for** ("random" or a named
  frame; `resolveGeneratedFrame`): an enchantment's M15 frame gives way to
  the Nyx frame where both are published. A job that asks for no frame
  keeps the default landing (M15), as a Vehicle's does. The art window, the
  rules box and every slot are m15's, so nothing else about a generation
  changes.
- **A stored card keeps its frame** until its owner picks "Nyx"; an edit
  and a remix never move one. **An import follows its PRINTING**, never
  this rule: a plain enchantment printed before Foundations lands on M15,
  one printed since lands on Nyx (once verified).

**Owner decisions, Round 56 (2026-10-13).** (1) a new plain enchantment
follows — built here. (2) The label stays "Nyx". (3) The word a borrowed
frame wrote ("Enchantment", like "Artifact") stays after a step change:
accepted for now, a follow-up with the artifact borrow — DONE: the words a
frame pick wrote are remembered by the creator form
(`components/creator/borrowed-words.tsx`), so the word comes out when the
card leaves that frame on any later visit; a word the maker typed or kept
by hand in the Types field stays; a new card only. (4) Faceless One
(CLB #1) and the ten `inverted`-only promo-pack printings become
`nearest` in a follow-up. (5) Beleren's "ffi" ligature in the preview
(`hd-beleren-ffi-ligature`, tests/parity) is its own PR, after fi / ff / fl
are measured. — DONE in that PR: Beleren's GSUB `liga` holds two ligatures,
ffi and ffl, and nothing else (no fi, fl or ff; MPlantin and the collector
face have no GSUB). Chromium and WebKit form both on a line with no
letter-spacing — a type line; a tracked name never had them — and Satori
forms neither, so the PREVIEW switches them off (`font-variant-ligatures:
none` on `CardPreview`'s root; kerning stays on). No bake changed: no bump,
no sweep. The known difference is struck; `@ffi-ligature` and
`@ffl-ligature` (tests/parity) and
`tests/unit/render/card-font-ligatures.test.tsx` hold it.

**Rollout: an addition.** No stored card sits on a new template: no layout
bump, no sweep, no badge.

**Imports follow the printing.** The registry's `era/2015+nyx` rule is what
it was — the kind's M15 frame, nearest, the starfield its gap — and now
names `m15nyx` once that is verified in the card's colour
(`nyxOnceVerified`: `onceVerified`, exact; the crown and the pairs are
drawn there). Only where the frame dresses the card as it stands: a saga,
a class, a case, an adventure, a token and a double-faced printing (the
flag is the card's; one face is the enchantment) never reach it. Run over
6,394 printings (all 1,746 Nyx ones and 4,648 others) against production's
verified list: no landing differs from `main` — frame, kind, type words,
switches, the chooser, the remix. 994 Nyx printings carry the new
`onceVerified`; 984 of them now say "not yet verified in <colour>" where
they said the starfield isn't drawn, and log to the request log as "Not yet
verified" instead of "Missing" (the frame exists). With `m15nyx` verified
in seven colours those 994 land on it — 984 exact, 10 nearest for a later
gap (6 foil-etched, 3 yellow-bordered, 1 white-bordered) — and no other
printing moves. The AI deck remix lands where the import lands
(`remixFrameFor`). Since the follow-up (owner decision 4, Round 56) eleven
of those 984 are `nearest` on the Nyx frame instead — the ten whose only
other frame effect is Scryfall's `inverted` (the `nyx-inverted` gap, by the
flags) and Faceless One (CLB #1, pinned: `nyx-own-frame`) — so 973 exact,
21 nearest; both gaps belong to the frame taken once verified
(`NYX_FRAME_GAPS`, no signature of their own), and until then those eleven
say the starfield isn't drawn and log as "Missing".

Not moved, on purpose:

- **Borderless (138) and extended art (109).** The prints have no frame
  field left to carry a starfield (NEO #480 / #483, DFT #382, INR #306, SLD
  #1279 read): the bordered twin or the extended-art frame stays their
  landing. Unlike a Vehicle's plate, nothing of the dress is lost there.
- **Showcase (66)** — each set's own frame (4.11) — **masterpieces** (9:
  OMB, SPG), **sagas** (4.5d's textured saga), **double-faced** printings,
  classes, cases, adventures, **tokens** (4.51) and the **2003 frame**.
- 23 bordered `inverted` / etched printings ride the rule like any plain
  one (the registry has never read `inverted` on the bordered M15 frame):
  the promo-pack look (THB #353, NEO #508) is the starfield with DARK bars,
  so "exact" overstates the ten that are `inverted` alone; the etched and
  odd-bordered ones stay nearest for their own gap.

One m15 reference left the registry with this: Obsessive Pursuit (TLA
#112), an alternate of `m15/b`, is a Nyx printing and would have had the
owner compare a starfield against the plain frame.

### The constellation crown

Owner 2026-10-13. The `nyx` template ("Nyx Constellation", the Theros
Beyond Death showcase) drew no legendary crown; print has one on every
card of the frame.

**What print does** — the eleven printings of the frame, THB #258–268, all
legendary (Scryfall: `enchantment` + `showcase` + `legendary` + `inverted`);
there is no nonlegendary constellation card to compare against. Read
2026-10-13 from Scryfall's 745 × 1040 scans scaled to 1500 × 2100, nothing
kept:

- It is the STANDARD 2015 legendary crown — the scallops, wings and arms of
  FDN's — **in the card's colour**: silver on white (#258 / #259), blue
  (#260 / #261), dark grey on black (#262 / #263), red (#264 / #265), green
  (#266 / #267). Not one dark, silver-edged crown for every colour. The one
  two-colour card, #268 Klothys, splits it red | green over a GOLD title
  bar and inner strip.
- Inside the crown, between the arch and the title bar, runs the Nyx
  starfield strip (rows 60–92 at x = 600) — the Nyx dress's "inner crown".
- Edges on the 1500 × 2100 card at x = 600: crown top edge row 51–53, the
  bar's top outline 93–96, its bottom outline 214–216, the rim under it
  217–225, the art from 227. The side rim beside the art is 13 px wide
  (x 98–110). The name does not move: it sits in the bar as on any card of
  the frame.
- Tones of the arm / rim beside the art: white 233,230,234; blue 12,86,179;
  black 56,51,47; red 213,57,23; green 47,108,69.

**The source.** Card Conjurer's own 'Nyx Showcase' pack (the fork's
js/frames/packM15NyxShowcase.js) has seven crownless masters — the same drawing as
our MSE ones — and lists the Nyx 'Inner Crown' beside them: its crown is the
M15 'Legend Crown' with that strip, which is exactly the band the Nyx dress
publishes (`m15nyxcrown/<key>`, [above](#the-nyx-dress-47)). Its tones match
the prints (green arm 42,108,69; black 58,56,50; red 209,77,53; blue
0,117,190; white 244,243,236), and it registers on our masters' title bar:
the MSE bar's outline sits on rows 101–104, the M15 pack's on 100–103, under
the band's own outline.

**The one cut** (`scripts/lib/nyx-crown.mjs`, `scripts/build-nyx-crown.mjs`
→ `nyxcrown/<w u b r g m a>`, bucket only; PipGlyph's own derivation of the
published bands, recorded as such in `lib/cards/frame-sources.json`). Our
`nyx` masters' side rim is 10 px wide (x 101–110; 1389–1399 on the right)
where the prints' and the crown's arm are 13 (x 98–110; 1391–1402), and it
is another tone on three keys (green 0,124,67; black 39,38,36; red 241,56,39
— and, until Round 59's tint below, the colourless master's bronze under
the silver crown). Drawn as
published, the arms end on row 408 in a 3 px jog and a tone step. So the
arms' last rows fade out — alpha × (1 − t) over rows 372–408 — and the crown
hands over to the master's own rim. Alpha only: every colour is the (toned,
for `a`) parent band's, every pixel above row 372 is the parent's byte for byte, and the
WebP's alpha equals the PNG's (the build checks both).

**The one tint** (owner Round 59, 2026-10-14). There is no printed
colourless constellation card, and the colourless master is a bronze drawing
(rim beside the art 172,148,132) under what was Card Conjurer's artifact
silver (arm 223,225,225): two metals on one card. So `nyxcrown/a` — that
band only — has its metal toned onto the master's rim, 223,225,225 →
172,148,132 (`RECIPE.tint`, `tintNyxCrownBand`). The tone is
`toneSourceRegions`' (the Universes Beyond tones'): the colour multiplied by
to ÷ from, the colour part of the gain fading out toward white, so the
bevel's highlights stay highlights of the same metal instead of turning (a
plain per-channel gain is the Vehicle plate's lesson); darker bevel pixels
take the same gains, black stays black. The starfield strip is not toned:
every pixel where the Nyx band differs from the published plain crown band
`m15crown/a` is the parent's byte — but for the strip's soft edge (strip
pixels within 2 px of metal), which takes the share of the tone the crown
shows through it; left alone it stays a silver hairline round the stars.
Alpha is never touched. Measured on the bake: crown arm 172,148,132, the
frame's rim beside it 172,148,132. The other six bands are byte-identical
to before (their sha256 unchanged in the manifest).

**Declared** as `NYX_CONSTELLATION_CROWN` on the `nyx` entry only (`keyMap`
c → a, the artifact band toned to the master's bronze — no printed
colourless card), at `M15_CROWN`'s rect. It is the frame's one overlay: no stamp, no collector line, no pairs —
a two-colour card is drawn on the gold master and wears the gold crown
(print splits it; that is the pair masters' step). Nothing else moves: no
slot, no keep-out (the band has a hole for the title bar and reaches the art
only as the crown's soft shadow on its top rows, as on m15).

**An addition** ([Additions vs corrections](#additions-vs-corrections)):
opt-in per card through `frame_style.crown`, no bump, no sweep, no badge. A
card stored on the frame names no switch and bakes byte for byte as before; a
new legendary card on it starts with the crown on; the Variations section's
"Legendary" chip and the "Legendary crown" switch are offered on the
template (`legendaryVariationOf` reads the declared overlay). An import of
one of the eleven names the switch ON: `showcase/thb/constellation` is the
one showcase signature that prints the standard crown
(`CROWNED_SHOWCASE_SIGNATURES` in `lib/scryfall/import-mapper.ts`) — every
other legendary showcase still imports with it off, as its scan. Until the
`nyx` frame is ticked, such an import lands on its fallback, M15, **with the
crown on** — M15's own crown, as any legendary M15 card (owner Round 59:
fine).

**Not done here**, on purpose: the masters are not re-cut, and pair masters
are not built (#268's red | green). The frame's own correction against
print followed (Round 59): [the constellation frame on its prints](#the-constellation-frame-on-its-prints-round-59).

### The constellation frame on its prints (Round 59)

Owner Rounds 59 (decision 1: correct the `nyx` masters against the eleven
printings before the frame is ticked) and 61 (the rim takes the M15
FAMILY's tones). Layout **v55** (`NYX_PRINT_TONES_LAYOUT_VERSION`, `nyx`
only, "sweep"; a correction of a look against its own print). Recipe as
data: `scripts/lib/nyx-frame.mjs`.

**How print was read** (2026-10-14; Scryfall's `highres_scan` PNGs, 745 ×
1040, measured at that native size with our masters downscaled by the same
kernel, reported in 1500 × 2100 px; nothing kept). A scan's crop AND its
colour are the scan's, so both are registered PER CARD: the showcase scan
is read against our `nyx` master, and the SAME card's regular printing
(THB #9, #18, #45, #71, #93, #119, #125, #150, #185, #196, #220 — the Nyx
dress) against our print-verified `m15nyx` master; the second reading is
taken off the first.

**Colour.** The rim (both sides, the plateau beside the art) read on the
showcase scan minus the same card's regular scan, laid on the family's rim:

| Key | Family rim (m15nyx) | showcase − regular, median (readings) | Registered | MSE before | After |
|---|---|---|---|---|---|
| w | 244,243,236 | +1.5,+1.5,+1 (4) | 246,245,237 | 252,254,255 | 244,243,236 |
| u | 0,117,190 | +5,−2,−3 (3) | 5,115,187 | 0,117,190 | unchanged |
| b | 58,56,50 | −2.5,−4,−1 (4) | 56,52,49 | 39,38,36 | 58,56,50 |
| r | 209,77,53 | −3,−2,−4 (3) | 206,75,49 | 239,56,39 | 209,77,53 |
| g | 42,108,69 | 0,−2,−7.5 (4) | 42,106,62 | 0,123,67 | 42,108,69 |

Every median is inside one print's spread (card to card a channel moves
by up to 8–11): the constellation rim IS the family's rim, and `to` is the
family's tone itself. The independent check read the same (w ≈ 246,244,238;
u ≈ 1,119,190; b ≈ 54,52,48; r ≈ 209,76,50; g ≈ 42,107,64). The raw scan
colours (e.g. red 220,59,22) are the scans' and are not used. Gold has no
print (#268 is red | green): its rim goes onto the gold crown band's own
flat arm, 246,210,98 → 233,212,125. Colourless keeps MSE's bronze (Round
59's `a` crown is toned to it); there is no artifact key.

**The crown bands are not touched**: `nyxcrown/*` are cut from the family's
`m15nyxcrown`, whose arms ARE the family's rims (w 244,243,236 · u 0,117,190
· b 58,56,50 · r 209,77,53 · g 42,108,69 · m 233,212,125), so with the rims
on those tones crown and rim are one tone on every key with no tint —
`nyxcrown/*` stay #555's bytes (only `a` is tinted, Round 59).

**Geometry**, registered the same way, is NOT changed:

| Finding (median of 11) | Raw against the scans | Registered | Verdict |
|---|---|---|---|
| Title bar | −6.5 px | −0.9 (control −6.1) | the scans', not the frame's |
| Side rim width | — | print 12.2 (11.1–13.6), ours 11.9 | equal — no re-cut |
| Rim position | L −2.3 / R +2.1 | L −1.3 / R +1.1 | under a re-cut |
| Type bar top / bottom | −4.0 / −4.1 | −5.2 / −3.7 | real — a later step (TODO.md) |
| Text box bottom | −5.0 | −6.0 | as above |

Card Conjurer's 'Nyx Showcase' masters (the same drawing, same tones, on the
regular M15 pack's geometry) sit on print at the type bar and box bottom
(−0.2 / +1.8 / +2.1). Re-sourcing from them moves every lower-frame slot;
the owner deferred it (Round 61; TODO.md), as the title bar's and box's
redraw (print's title bar is the card's colour with sparkles).

**The tone** (`toneNyxRim`, run by `scripts/build-variation-frames.mjs`
after the type bar / box tone): the rim is ONE flat colour in each master,
drawn over black outlines. Its region is that flat colour in pieces of ≥
2000 px (a white star in the field is white's rim colour and is left alone)
plus every pixel within 2 px of it that is a rim / black mix; each moves by
t × (to − from), t its coverage of the rim — the flat rim lands on `to`
exactly, an edge keeps its coverage, black stays black. A flat colour has
no bevel, so no highlight can change hue. Nothing else of a master changes.

**Rollout**: after the deploy the automatic re-bake runs, as after any
sweep, over every card up to the new latest sweep version: a card on `nyx`
re-bakes (production has none — the frame was never ticked), every other
card is only STAMPED to v55 (no render). `/admin/renders` therefore shows
stamp-only batches, not "idle", until every card is stamped. The visual
matrix: the `nyx` cases of w b r g and gold change, nothing else.

### The constellation frame's text on its prints (4.11, layout v66)

Owner-approved 2026-10-22 (the showcase survey: keep the masters, fix the
geometry). Layout **v66** (`NYX_GEOMETRY_LAYOUT_VERSION`, `nyx` only,
"sweep"; a correction of the text against the frame's own prints). The
masters are not touched — v55's tones and the `nyxcrown` cut stay byte for
byte.

**How print was read** (2026-10-22). Scryfall's PNGs of THB #258–268 at
1500 × 2100 against our bakes of the same names, costs, type lines and
rules texts (the crown on, a flat grey picture), measured by the same code
on both: a bar's outline is the centroid of its darkness, median over the
text-free columns; a disc is a circle fitted to the edge of its top arc and
sides (the drop shadow is below-left); a line's baseline is its last row
with ≥ 30 % of its peak ink. Every text is registered on ITS OWN BAR —
never on the card's edge — because a scan's crop wanders: these scans sit
~6 px high against the frame.

**The title bar is not re-cut.** Raw, print's title bar sits 6–8 px above
ours (mid 154.9 against 161.3). But the same cards' REGULAR printings
(THB #9 … #220) sit 5.6 px above the print-verified M15 master's bar in the
same scans (mid 155.0 against 160.6), and showcase − regular, per card, is
−0.6 px (median of 11): registered, the constellation bar is ~1.3 px above
ours, as Round 59 read it (−0.9). That is the scans' crop, not the frame's —
no flat-zone re-cut is warranted (and none would be clean: the bar's
outline, bevel and starfield run the bar's whole height).

| Text (median of the prints, each on its own bar) | Print | Ours before | After |
|---|---|---|---|
| Disc diameter / pitch | 69.9 / 78.0 | 72.75 / 82 | 70 / 78 |
| Disc centre − title bar middle | −8.8 (−7.0 … −10.1, 10 cards) | +2.8 (164.1 px) | −9.7 (151.6 px) |
| Last disc's right edge − bar's right outline | −22.6 | −28.2 (1382.5) | −22.2 (1388.5) |
| Name baseline − title bar middle | 26.1 | 28.1 | 26.1 |
| Name x-height | 40 | 40 | 40 |
| Type baseline − type bar's bottom outline | −31.7 | −42.4 | −32.4 |
| Set symbol centre − type bar middle | +6.0 (4 cards) | −4.0 | +6.0 |
| Set symbol right edge | 1376–1378 (raw) | 1382 | 1377 |

- **The cost row** (`NYX_COST`): the CC-framed M15 family's disc and pitch
  (`CC_M15_COST_DISC_PCT`), lifted 12 px and moved 6 px right on M15's
  title band — both whole px at 750 AND at HD (6 / 3 at 750), so neither
  bake rounds a half px away from the preview. Print's 152.5 / 1388 is
  drawn at 152.0 / 1388.5 on the HD bake (the band lays the disc out from
  128.8 → 129 px; the preview 151.8).
- **The name** (`NYX_TITLE_DY`): 2 px up; its size was print's.
- **The type band**: print sets the constellation's type row LOW in its bar
  (the regular THB printings' baseline sits ~37 px above the bar's bottom,
  the symbol on the bar's middle). The band's rect moves 10 px down — its
  line and the inline set symbol together — and ends 6 px further left,
  where the prints end the symbol. The symbol's size is the set's
  (`set-symbol-prints.ts`), not the frame's.
- **Unchanged, inside the scans' wander:** the rules (size, breaks, line
  pitch 62 / 86 px against our 63 / 87, the first baseline 0–6 px), the P/T
  plate and its digits (≤ 3 px), every text's left edge (2–3 px). The plate's
  printed look — white digits on a plate in the card's colour — is 4.17g's,
  not geometry.
- **The type bar itself sits low** — TODO 4.17f's 5.2 / 3.7 px (top /
  bottom, Round 59's registration; this PR's independent check read 3.0 /
  3.3 / 7.4). The type line above is placed on print against ITS OWN bar,
  so 4.17f's re-source of the lower frame moves it again, with the bar.

**Rollout**: a sweep scoped to `nyx`. Production has no card on the frame
unless the owner's count says otherwise (`select count(*) from
public.cards where frame_style->>'template' = 'nyx'`); the cron re-bakes
whatever it finds and stamps every other card. The visual matrix: the `nyx`
cases change, nothing else.

### The Station frame (4.27a)

TODO 4.27a (owner 2026-10-13, rounds 53–54). `m15station` and
`m15stationland` are the frame Edge of Eternities (2025) prints its
Spacecraft (artifacts) and Planets (lands) on: the M15 bars, pinlines and
border with **no frame field** — the picture runs under the whole card —
and a **see-through text box cut into bands**: a top band (abilities and
the Station reminder), then one band per charge tier, each with an "N+"
badge on the box's left pinline, and the card's P/T on a black plate with
white digits on the tier that makes it a creature. PR 1 ships the body
(masters, profiles, layout, both renderers); PR 2 the creator's tier
editor and the follow; PR 3 the AI and the editor's notes. Until the owner verifies a colour
nobody is offered the frames (an admin: `?previewFrames=m15station`).

**What the prints show** (30 bordered station printings against 16 M15
controls of the same set, read at 1500 × 2100 on 2026-10-13; the numbers
and their spreads are `scripts/lib/station-2025.mjs`, the constants the
renderers read `lib/cards/station.ts` `STATION`): title bar, type bar,
pinlines, art-window rail and border equal the M15 controls' to 0–4 levels
and 0–1 px; the field between the border and the bars is the untinted
picture on 30 of 30; the box is the M15 box at about 0.68 strength; a tier's
wash is the key's own colour over it at 0.25 (tier 1) and 0.57 (tier 2);
a badge is a dark disc r 50 in a 10 px ring of the pinline's colour, centred
x 100 and on its band; the plate is 230 × 112 with a 14 px rim, x 1190–1420,
centred on its band, its digits white on 21 of 21.

**Masters are PipGlyph's own derivation** (`scripts/build-station-frames.mjs`;
neither Card Conjurer nor MSE has the frame at print size):
`m15station/<w u b r g m c>` from the published `m15artifact/<k>`,
`m15stationland/<w u b r g m c>` from `m15land/<k>`, each with two cuts —
the frame FIELD to α 0 (its shape is where `m15/<k>` and `m15artifact/<k>`
differ: the two paint the same bars and boxes over two fields; the run
refuses a mask whose box is not the recorded one) and the text box's
interior to α × 0.68. Nothing is drawn into a master. Every WebP's alpha is
checked equal to its PNG's (the preview reads one, the bake the other: one
level of alpha is a visible step over bright art). Printed Planets are
w u b r g; `m` and `c` exist so that no colour of a land resolves to a
missing master, and stay unticked. Provenance: `frame-sources.json`
(`source: "pipglyph"`; the Card Conjurer importer leaves another builder's
entries alone). The bucket is the only home: a master cut from a bucket
master never enters git.

**Profiles.** The parents' slots, crown, stamp notch and collector line;
`underFrameArt` with `artSlot` = the under-frame rect (ONE picture, as the
colourless walker — the art positioner, the AI's art size and the print
path read the same rect); `tiers` (the inks: black text, white digits);
**no `pt` slot** — the plate is on a tier, never in the corner — and
`rulesAlignSwitch: false` (no Centred in the first build, owner round 54).
The kind gate is the Vehicle's (`SUBTYPE_DRESSES`): `m15station` dresses an
artifact whose subtypes say Spacecraft, `m15stationland` a land whose
subtypes say Planet, nothing else; `subtypeFrameFor` reads a base's whole
family of dresses (m15artifact has two).

**Data.** A station card's text is Scryfall's own shape — the top band's
lines, then `N+ | text` opening each tier, further lines joining the open
tier — or structured rows in `face_content.station`
(`{ intro, tiers: [{ threshold, text, pt? }] }`), read FIRST
(`resolveStationTiers`). 0–3 tiers (a fourth line stays in the third tier's
text; the schema refuses a fourth row); a Spacecraft with no tier is a top
band alone. The plate sits on ONE tier: from plain text the tier the
reminder names ("creature at N+"), else the last; rows may name another —
never the top band, and only on a card that prints a P/T
(`printsPowerToughness`), so a Planet has none.

**The tiers layout** (`lib/cards/station-layout.ts`, the `tiers` anatomy of
the ONE rules layout): one size for the whole box; every band's lines are
`layoutRulesAt`'s (both targets), a tier's column from x 180; the plate is a
FLOAT of its tier (the lines break short of it) and the stamp's arch a
keep-out of the last band. Every band, badge and plate box is EVEN in HD
px — a whole px at the 750 px target.

*The bands are print's rule* (`stationBands`, layout v54 — PR 2, after the
independent check of #543): **every band of a card — the top band and each
tier — has the same air above and below its text**, whatever the box has
left once the text is set; a tier is never shorter than its floor (168 px,
a one-line upper tier; 180 px, a one-line last tier); and under a STAMPED
last tier print leaves 22 px more, the text sitting that much above the
arch while the badge and the plate stay on the band's centre. A size is
taken while that air is at least 14 px (the fit takes the LARGEST such
size, 50 px or more). The bands are re-solved on the heights the text
really has beside its keep-outs, so the stamp is part of the fit — PR 1's
rule (text + 2 × 20 px, the top band the rest) had been fitted on a layout
that left the stamp's keep-out out, and its real bakes sat 37–84 px off
print on the stamped rares (EOE #250, #208, #259, #35, EOC #7).

Measured on the REAL bake against the check's re-measured prints
(`tests/unit/cards/fixtures/station-print-edges.json`; the table is
`station-layout.test.ts`'s, `STATION_REPORT_FILE=<path>` writes it):

| ours − print, band edges | PR 1 | now |
| --- | --- | --- |
| 36 edges of the 30 bordered printings (fitted on): within 10 px | 28 | 25 |
| … within 20 px | 29 | **34** |
| … worst | 84 px | **25 px** |
| 23 edges of 13 extended-art + 2 borderless printings (not fitted on): within 10 px | 11 | 12 |
| … within 20 px | 14 | **19** |
| … worst | 89 px | **42 px** |

What is left: print does not always take the largest size that fits (EOE
#253 and #260 set a one-line tier at 60–64 px where ours takes 70 and wraps
it: 14 px high), and the extended-art printings keep their bordered
printing's size with the reminder gone — neither is a rule a custom card
could follow. Three in-sample cards are a little further from print than
PR 1 had them (#253, #260: +2 → −14; #255: 0 → −12).

*The ceiling — the box is the box.* A card fuller than any print gives way
in this order, and text clips only after all of it: (1) the size steps down
to 50 px on print's rule; (2) the tiers give up their FLOOR (124 px: a
badge still fits) but keep print's 14 px of air, down to 42 px; (3) at 42–46
px a band may be shorter than a badge — the badge and the plate are then
drawn smaller (the saga's rail gives up its badge stacks the same way);
(4) past that the bands share the box in proportion to their text, each
text clipped to its own band, the layout `clipped` — never a band over the
type bar or the art. PR 1 clipped a realistic three-tier card (two keyword
lines, the reminder, three one-word tiers) at 42 px and grew the bands of a
very long text over the type bar. `tests/unit/render/rules-no-clip.test.tsx`
now holds every band of the matrix's texts, six shapes and the 36 printed
cards to the no-clip rules at both targets (PR 1 skipped the frame).

*Sizes and tones* (the same check): a two-digit numeral ("10+", "20+") is
set as tall as a one-digit one where the face allows (ink span 92 of the
disc's 100 px: 39–42 px against print's 43; PR 1: 35–39); a wide plate value
shrinks as print's does ("20/20": 47 px, PR 1: 54 — the digits' span is the
plate less 34 px a side); numerals and digits sit 2–3 px right, where
print's are; the ring and the rim are drawn in the PRINTED ring's median
tone (`STATION_COLOURS.rim`, about 35 levels under PR 1's), the bevel's
shape kept, its highlight and shade half as strong (owner round 55). The
tier washes are unchanged: the check read tier 1 nearer 0.19 than 0.25, a
reading this PR did not repeat on the scans, so it was not re-fitted.

**Drawing.** `cardStation()` is what both renderers call; they only draw
its `StationDrawing`: the PIECES — each tier's wash, the badge discs, the
plate — are our own inline SVGs (`lib/cards/station-art.ts`, the white
border's pattern: the same `data:` URL in the preview, the bake and both
finish masks; nothing to warm, nothing to promote), drawn right after the
frame and UNDER both finishes, which mask with them (the saga rail's
pattern); the "N+" numerals and the P/T digits are ink through the stat fit
(a wide value shrinks to the plate's face); the text is `RulesBox` /
`RulesBoxBake`. The ring and the rim are lit from above with a dark seam
against a face with a soft lighter middle (the bevel round, owner round 54
decision 3 — darkened to the printed ring's tone in PR 2, round 55; `flat`
is kept for the comparison sheet only).

**Checks.** The art-window check passes on the under-frame rect; the edge
contract is the parents' (border on every edge), square corners black.
Visual matrix: both templates × every colour, short and long, plus
`@tiers-one` / `-three` (rows, the plate on the middle tier) / `-none` /
`-wide` (20/20) / `-star`, the crown, stamp and collector-line cases of
every template that draws them, foil and etched. Parity: six cases — two over a high-contrast STRIPE picture
(black, white and saturated bars under every band, blue and red keys), one
tier, the dressed card, foil, a Planet — and a `tiers` region over the box
with its badges and plate. No limit was raised and no known difference
added.

**Import.** Step 0's rule `station/2015` (the Station keyword on the 2015
frame; #540) now names the frame: `onceVerified: { family: "station" }`
(a Planet → `m15stationland`, else `m15station`) and `exactOnceVerified`.
Until the frame is verified in the card's colour the import lands where it
always did (the artifact / land frame, `nearest`, "not yet verified in
<colour>", an `unverified` row in the request log); once it is, it lands on
the station frame, exact — the oracle text is already the tiers' grammar,
so the bands draw as imported. The other dresses (extended art, borderless,
showcase) keep their own rules and the `station` gap — and land as "The
other dresses" (step 2, PR 4) below says.

**The tier editor** (PR 2; `components/creator/panels/station-editor.tsx`,
shown on the Text step for any frame whose profile has `tiers` —
`isStationFrame`). The top band (the ordinary rules box, with a button that
adds the Station reminder) and 0–3 tier rows, each a number of charge
counters and its text; ONE "Power / toughness on this tier" choice, shown
when the card shows a P/T; a fourth tier is refused with a message.

- **One source.** The editor is a VIEW of the form's one `rules_text`
  (`lib/creator/station-rows.ts`): the rows are read from the text and every
  change is written back into it. Nothing is written by opening a card, and
  every other way a text arrives — an AI fill, an import, a frame or kind
  change away and back, a remix — shows up as rows by itself; off the frame
  the same text is in the ordinary rules box. The boxes keep the maker's
  keystrokes as typed (a trailing space, a number box that is empty for a
  moment) for as long as the text is still the one they wrote.
- **The P/T tier** is the one thing the text cannot always say (it plates
  the tier its reminder names, else the last): the form's `station_pt_tier`
  (null = as the text says), written into the rows by a save.
- **What a save writes** (`submittedRulesOf` with `stationFrame`):
  UNTOUCHED — the text and the P/T tier as the form opened — the stored text
  byte for byte and `face_content` not sent; a card stored as plain text is
  given no rows by a save that only retitled it. EDITED, new or a remix —
  the rows the text holds, the plate on the maker's tier, beside the
  canonical text (`serializeStation`). No tier left: the text alone, and
  `face_content: null`. PR 1 dropped the rows on ANY edit of the text — one
  word typed moved the plate back to the tier the text plates; that path is
  closed, and `creator-station-tiers-save.test.tsx` holds it through the
  real form and the server's schema.
- **Shapes the rows cannot show are kept.** A fourth tier LINE stays in the
  third tier's text as typed and the editor names it; stored rows that say
  another text than `rules_text` (written by the API) open as the rows —
  they are what the card draws — and an untouched save still keeps the
  stored text; rows that plate no tier keep plating none. A tier with no
  text and numbers that do not rise are asked for before the save goes out.
- **Typography.** A box is set in print typography when it loses focus, and
  on an edit only a box whose text is not one the card opened with; the
  server's pass does the same per box (`lib/validation/print-typography.ts`).
- **No tier and a P/T** (allowed — owner round 54): the frame prints the
  P/T on a tier, so none is drawn; the note under the inputs says to add a
  tier, and the card page's details list no stats
  (`frontDrawsPowerToughness(template, text)`).

**The follow** (PR 2). A NEW artifact whose subtypes first say Spacecraft
and a NEW land whose subtypes first say Planet take the frame where it is
VERIFIED in the card's colour (`subtypeFrameFor`, the Vehicle's effect —
it now watches every dress word, `SUBTYPE_DRESS_WORDS`). Nothing is ticked,
so only an admin's `?previewFrames=m15station,m15stationland` shows it.
"Standard" in Variations is the way back and sticks until the word comes or
goes; a stored card keeps its frame. The dresses coexist: a Vehicle retyped
as a Spacecraft goes to the station frame (before its tick: back to the
Artifact frame, never left on the Vehicle frame); a card already on a dress
its subtypes still say keeps it, so an artifact that is both a Vehicle and
a Spacecraft is never flipped (from the Artifact frame it takes the Vehicle
frame, the station frame a Variations pick); a card on any other frame (an
Enchantment Artifact on Nyx, a Spacecraft on the 2003 frame) is not moved.
The disabled chips say why ("The Spacecraft frame is for Spacecraft", "…
for Planets"), and the picker tile draws its sample art under the whole
frame.

**The tier editor's notes** (PR 3; `lib/creator/station-fit.ts` — readers of
the layout and of the save's rule, nothing blocked, no renderer reads them;
both are part of the tier group's description, `aria-describedby`, never a
live region):

- *The text does not fit* (owner round 58, decision 2): the bands whose
  text is really CUT, read from the layout of the card the preview draws
  (the same profile, P/T tier, flavour text and stamp). Not the layout's
  `clipped` flag, which is also set when no size leaves every band its
  minimum air — a card that is drawn whole. A band is cut when its own
  `RulesLayout.clipped` says so at either bake target; a card with more
  text than the whole box says so once.
- *A band over 600 characters* (the row limit of `face_content`, the
  walker's and the saga's — not raised): the save keeps the card's tiers as
  lines of text, which draw the same bands, and the one thing only the rows
  hold is lost — a P/T on another tier than the text plates. The save did
  that without a word; the editor now says so before it, and names the tier
  the plate goes back to.

A Planet's rows mark no tier (`stationShowsPt`; they carried `pt: true`,
never drawn). A tier line ending in `\r` reads as a tier
(`parseStationText` splits on `\r\n`, `\r` and `\n` — a text saved through
the API with Windows line ends used to draw a top band alone; this is the
one line of this PR a renderer reads, and it changes no card whose text has
`\n` line ends). A fourth tier line that becomes a tier of its own when
another is removed is not typeset by the server (`storedRowTexts` reads
every tier line the stored text holds).

**The AI and the frame** (PR 3; `lib/ai/station-design.ts`, pure — the
prompt's rules, the lint, the autofix, the fill's merge and the job's rows
— on the ONE design engine every flow runs through, `designCards`).

*What print does* (Scryfall `keyword:station`, one row per card,
2026-10-14: 35 cards — 30 Spacecraft, 5 Planets; 32 in paper, 3 Arena-only;
`tests/unit/ai/fixtures/station-printed.json`, counted by
`station-design.test.ts`):

| | print |
| --- | --- |
| Type line | "Artifact — Spacecraft" 30 of 30 (8 Legendary), never "Artifact Creature"; "Land — Planet" 5 of 5 |
| Tiers | one on 27 cards (22 Spacecraft, 5 Planets), two on 8 (all Spacecraft), three on none |
| Numbers | 1+ … 20+, rising. A lone Spacecraft tier 3+ … 20+ (7+ six times, 8+ five); of two, the first 1+ … 3+ on 7 of 8 and the last 8+ … 20+; every Planet 12+ |
| The Station line | the LAST line of the top band on 35 of 35; word for word on the 32 paper cards: "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at N+.)" — a Planet "on this Planet", ending at "…as a sorcery.)"; the 3 Arena-only cards the bare word |
| N | the last tier's number on all 26 paper Spacecraft with a P/T; The Eternity Elevator (no P/T) has no creature sentence |
| P/T | 29 of 30 Spacecraft, on the last tier, whose first line is a keyword line starting with "Flying" on 28 of 29; no Planet |
| Before the Station line | nothing on 10 Spacecraft (all 8 two-tier ones), one ability on 19, two on 1; a Planet two ("This land enters tapped." and its mana ability) |
| Length | whole texts 144–423 characters, a tier 6–183 |

*The designer* is told exactly that (`STATION_DESIGN_RULES`, with one
example card, in the system prompt of every design call) — only for a card
it chooses to make a Spacecraft or a Planet. *The lint*
(`stationDesignProblems`, errors of `lintCardDesign`) holds an ARTIFACT
whose subtypes say Spacecraft and a LAND whose subtypes say Planet — the
frames' own gate, `SUBTYPE_DRESSES` — to it: at least one tier line, at
most three, numbers rising, no empty tier, no band over 600 characters, and
the Station line as the last line of the top band, word for word, its N one
of the card's tiers (the creature sentence only with a P/T; never on a
Planet). Every paper printing passes it. Nothing is said about any other
card. *The judge* is asked to fix what is named and keep the shape. *The
autofix* (`repairStationText`) then repairs by machine what is left: tier
lines spelled another way ("8+: Flying", "8+ — …", "STATION 8+ | …"), empty
tiers, numbers out of order, tiers past the third (folded into the third)
and the Station line — and returns a text with NO tier line unchanged: a
machine does not invent a tier.

*The frame.* `resolveGeneratedFrame` never picks a station frame for a text
with no tier (`stationFrameFits`): the frame prints the P/T on a tier and
nowhere else. Such a card falls back to its base — the Artifact / Land
frame — asked for by name or at random, as every other dress falls back.
(The creator has no such gate: a maker on the frame sees the tier editor
and the "add a tier" note.) A generated DECK names no frame at all: its
Spacecraft save frameless, on the default frame.

*The save.* A card an AI job saves on a station frame is saved as the
creator saves a new one (`stationSaveFields`): the canonical text beside
`face_content.station`, the P/T on the tier the text plates. Off the frame,
or for a text with no tier, nothing is added to the payload.

*The remix* copies its source's rules and only swaps the card's names in
them, so the tiers are the source's: a printed Spacecraft or Planet lands
on the station frame once that is verified in its colour (the import's
landing) with its tiers as rows; an own card keeps its frame, its rows and
the tier its maker put the P/T on (and, where its rows say another text
than `rules_text`, the rows — what the card shows). A new name that made or
unmade a tier line fails the step before the save (`sameStationShape`).

*The per-field fill.* The engine lints the card the MODEL returned; a fill
keeps only the wanted fields, so `designCardFill` puts the designed text in
shape for the card the FORM holds. On a card that already has tiers the
form sends them (`locked.station_text`, on a station frame only): the
designer is told the layout, and **a tier left empty is the only line a
fill of the rules text writes** — every other line is kept byte for byte
(`mergeStationFill`). The maker's "power / toughness on this tier" follows
its tier by number into the filled text (`stationPtChoiceAfterFill`); a
fill used to reset it. A fill whose empty tier comes back EMPTY (model and judge
alike: `stationGapsLeftEmpty`) is refused at plan time
(`StationGapUnfilledError`, code `STATION_TIER_UNFILLED`, HTTP 422): no
job, so no credit is charged and nothing in the form changes (owner
2026-10-14). A gap is never filled "by place" with a designed tier whose
number the text already has (that is a copy, not a fill), and a tier
written as punctuation or the Station reminder alone is still a gap.

*The ideas dialog* runs the same engine: an idea for a Spacecraft carries
its tiers.

What every other card saves through these paths is pinned to `origin/main`
byte for byte (`tests/unit/ai/job-payloads-pinned.test.ts`: 54 payloads —
the card, deck and remix steps, the plans, the fill — recorded on main's
`lib/`), with the credits each reserves; the station cards are
`station-jobs.test.ts`.

**Before a tick.** After PR 3 every path that can reach a ticked station
frame hands it a card it draws: the creator (PR 2), the import of a
bordered printing, and the AI — generation, fill, ideas and both remixes.
PR 4 (below) added the dresses; what is left is the owner's eye on the
frames themselves.

**The other dresses** (TODO 4.27a step 2, PR 4; owner 2026-10-13 Q4). The
26 paper station printings that are NOT the black-bordered frame, measured
first (`scripts/lib/station-dresses-2025.mjs`, the numbers; 2026-10-14):

| Printings | What print is | Built |
| --- | --- | --- |
| Extended art, 13 (EOE #321–355, EOC #27 / #34, TRK #481) — w ×2, u ×2, b, r, g ×2, gold (five colours), colourless ×4 | Card Conjurer's extended-art bars (no rails: the art to the side edges; the BLACK type bar with white ink) over the station box; the field beside the box the picture; black border beside and under the box. Its bars against the masters (median \|ΔRGB\| over their opaque non-black pixels): **4.3–10.0** on the new dress, 59.0–81.0 on today's landing (`extendedart`), 38.0–81.0 on the bordered station frame | `extendedartstation` (w u b r g m c) |
| Borderless, 2 (EOC #1 / #2: three-colour legendary commanders) | Card Conjurer's borderless pack — bars with thick gold rims floating on the art, the black bottom bar and fins, the floating crown, white title and type ink — with the STATION box (the light paper, the tier washes, black text) in place of the pack's dark one: **16.0 / 16.7** (today's landing, the bordered artifact frame: 121.7 / 122.3) | `m15borderlessstation` (w u b r g m c, and the crowned twins) |
| Showcase, 11: the ten "viewport" Planets (EOE #277–285, #372–380 galaxy foil: five cards) and TRK #557 | No frame to master. The Planets: borderless, the picture the whole card, its lower part PAINTED near-black (each card's window — struts, ribs, arches — is the art), white name, type and text set on it, the badge alone. TRK #557: a one-off schematic design (linework, small caps, no bars) | nothing — `nearest`, 4.11's |

No extended-art or borderless PLANET is printed (the borderless Planets are
the viewport showcase), so neither dress has a land twin.

*Masters* (`scripts/build-station-frames.mjs`, the same builder; PipGlyph's
own derivation, bucket only, provenance `source: "pipglyph"`):
`extendedartstation/<key>` is the published `extendedart/<key>` (the
colourless one from the pack's silver artifact `a`) with the station
recipe's two cuts — the pack is M15's pixels from row 1320 down (the run
refuses a pack that moved), so the field mask and the box cut are the
bordered frame's, and so are the bands, badges, plate, stamp notch and
collector line; `m15borderlessstation/<key>` and `<key>-legendary` are the
published `m15borderlessartifact` masters and crowned twins whose
translucent box interior takes `m15station/<key>`'s pixels (the box paper at
× 0.68). Re-running the builder rebuilds `m15station` / `m15stationland`
byte for byte.

*Profiles*: `extendedartstation` = extendedart's slots (white type ink, the
set symbol's keyline, the crown band `EXTENDED_CROWN` — a colourless legend's
grey C, as on extendedart) without the corner P/T slot, ONE picture under
the whole frame from the border's inner edge to the card's sides
(`EXTENDED_UNDER_FRAME_RECT`), M15's stamp notch and collector line;
`m15borderlessstation` = the borderless artifact frame's slots and crowned
twins (`crownMasters`), M15's rules slot (its box is M15's), no stamp notch
and no collector line (the borderless frames have neither yet; the prints
do). Both: `tiers`, `rulesAlignSwitch: false`. A crowned twin's master key
(`m-legendary`) washes its tiers in its colour (`stationColours`).

*Gates and follow*: `SUBTYPE_DRESSES` — an artifact whose subtypes say
Spacecraft, nothing else — with `follow: false`: a PICK (Variations, after
the station frame; the extended-art one is listed as an M15 treatment). A
new Spacecraft follows its subtype onto the BORDERED frame only; a card on
`extendedart` or `m15borderlessartifact` stays there; a card on a dress
keeps it while it says Spacecraft and goes back to the frame the dress
re-dresses (`extendedart`, `m15borderlessartifact`) when it doesn't. The AI
never draws one at random and a deck never asks for one
(`isPickOnlyDress`); asked for by name, a Spacecraft with a tier gets it.

*Import* (`stationDress` in `lib/scryfall/frame-signatures.ts`; the
`station` gap's reason now says "this printing's Station frame"):

- extended art: `extendedart+station` names `extendedartstation` once it is
  verified in the card's colour — exact (the crown is drawn); until then the
  bordered station frame is its landing once THAT is verified
  (`landOnOnceVerified`), `extendedart` before. A verified own frame wins
  over the stand-in (`withVerification`). The plain `extendedart` frame
  never does (owner Round 66): verified in the colour or not, it would print
  the tiers as plain lines, so the station stand-in replaces it too
  (`overOwnFrame` — the Vehicle stand-in still keeps a verified extended-art
  frame). The remix follows (it finalizes through the same function); a
  maker's own pick of plain extended art in the creator is still allowed.
- borderless: lands on the bordered station frame once verified, the
  artifact frame before. Never on `m15borderlessstation`: an edge-to-edge
  frame is no import's landing (Scryfall's art crop is the window, 1.18) —
  the template is listed in `TEMPLATES_WITHOUT_PRINTED_SIGNATURE`, and its
  two references are allowlisted in the reference test.
- showcase: still nearest with 4.11's item; the viewport Planets land on
  the bordered Planet frame once verified (the land frame before), TRK #557
  names the bordered Spacecraft frame (`onceVerified`, nearest).
- Main (after #571) against this branch over all 95 printings of the
  search, five verified states — production's ticks without the station
  ones, production's ticks (the bordered pair ticked, #570), those plus
  `extendedart` in every colour, every main template, every template: the
  13 extended-art printings land on `m15station` in the middle three
  (main: `extendedart`), on `extendedartstation` in the last; the borderless
  and showcase ones on `m15station` / `m15stationland` wherever the
  bordered pair is ticked (main: the artifact / land frame); the 65 black-bordered 2015-frame station
  printings (61 paper, the playtest card, 3 Arena-only) and the 4 Doctor Who
  planes are identical in every state; the 26 above move, and only as
  described.

*Checks*: visual matrix +49 cases (both templates × every colour and shape,
the crown, the stamp, the tier shapes, foil / etched), 0 changed; parity +4
cases (darwin recorded; the linux half is CI's red round); `rules-no-clip`
holds the dresses to the bordered frame's layout text for text (their
inputs are the same); `station-dresses-bake.test.tsx` (the box pixels, the
edges, a crowned gold card's washes, a print file with bleed);
`tests/unit/creator/station-dresses.test.ts` (gate, follow, AI). The
art-window and edge-contract checks pass on the published masters.

**Rollout.** PR 1 was an ADDITION: new templates no stored card sits on —
no layout bump, no sweep, no badge, no migration. PR 2's corrections of the
look are layout **v54**, scoped to the two templates
(`STATION_BANDS_LAYOUT_VERSION`, "sweep"): production holds no card on
either, the dev database's seeds re-bake. A stored Spacecraft on the
artifact frame keeps it.

### The Prepare frame (4.27)

TODO 4.27 (owner 2026-10-21: Prepare first; Room and Omen planned, not
built). Secrets of Strixhaven (2026) prints its **Prepare** creatures — a
creature and the spell it can cast a copy of while it is prepared — on the
M15 frame with the lower text area split in two: the creature's rules in
M15's box on the LEFT, and the spell on a **page** on the RIGHT, a name bar
(name and cost) and a type bar in the colour, white ink, and a box of its
own, darker paper. It is the adventure's two parts, mirrored, and it is
drawn with the same anatomy: `prepare` is a profile with the `adventure`
capability on its own rects (`PREPARE`, `lib/cards/template-layout.ts`).
Reference: SOS #109 Blazing Firesinger // Seething Song; SOS #170 Abigale,
Poet Laureate. Until the owner verifies a colour nobody is offered the frame
(an admin: `?previewFrames=prepare`).

**What the prints show** (the 93 plain 2015-frame printings of Scryfall's
`layout:prepare` — 124 printings in all, 2026-10-21 — each Scryfall PNG at
1500 × 2100; geometry the median over all 93, tones the median image of the
printings whose spell is the card's one colour; the numbers are
`scripts/lib/prepare-2026.mjs`): everything above the type bar is M15's;
the page runs from a black outline at x 746–749 (which also closes the
left box) and 1313–1315 down to 1872–1875, open to M15's pinline on the
right; its bars are 1325–1416 and 1426–1517 from x 758, a square left end
and a half-ellipse right end reaching x 1410 over the pinline (centre 1390,
20 px across), a 3 px black outline; its box is M15's paper at about 0.8 of
the left box's (1532–1862); under the page the frame field shows, lighter
than the frame's own field, down to M15's box bottom, and M15's P/T plate
sits on it. Text: the creature's rules centred in the left box (ink x
127–733) at up to 76 px (most cards pitch 66, SOS #27 sets 74; owner
Round 79 raised the first cut's 68 to the standard ceiling, the fit
stepping a long text down), the page's name on the adventure panel's
baseline (1388) and size (62 px, pips 60 px, right edge 1392), its type line
baseline 1490, its rules left-aligned and centred down the page's box at
68 px. The page's ink lands on print's columns — SOS #109's "Seething Song"
from x 783, "Instant" 785, "Add" 778 on print; 783 / 786 / 778 on the bake
(the first cut's rects sat 5 px left: owner Round 79).

| key | name bar (print → master) | type bar | page box |
| --- | --- | --- | --- |
| w | 170 161 147 → 172 168 154 | 121 111 94 → 121 112 94 | 213 208 197 → 215 209 197 |
| u | 1 124 159 → 14 130 173 | 0 75 103 → 0 75 103 | 171 196 212 → 179 201 219 |
| b | 92 87 86 → 87 86 84 | 56 49 49 → 56 49 50 | 167 165 161 → 170 168 164 |
| r | 181 82 61 → 181 82 65 | 134 42 30 → 135 42 30 | 208 175 162 → 215 180 166 |
| g | 47 93 56 → 48 93 56 | 2 55 22 → 2 56 22 | 167 183 172 → 173 187 175 |

**Masters are PipGlyph's own derivation** (`scripts/build-prepare-frames.mjs`;
neither Card Conjurer, whose fork ends June 2024, nor MSE has the frame):
`prepare/<w u b r g m>` from the published `m15/<key>`, `prepare/c` from
`m15artifact/c` (m15/c is see-through), each page's bars from the published
`adventure/<key>` (Card Conjurer's adventure page bars are the prints' two
tones). The run moves the base box's right edge onto the left box, fills
the page's rim with the base's pinline, lays the base's frame field (a
quarter turn — two runs of its inside, cross-faded over 6 rows, never its
bright outer rim, which the first cut ran across the strip on blue and
black — toned onto print's strip) under the page, re-dresses the
page's box as the base's paper under a per-key gain with the base box's own
edges, cuts the adventure bars to the prints' shape — toned onto print and
lit by the prints' bevel — and darkens the page's outline. The only drawn
geometry is the two outlines, flat black at the prints' coverage (said so
in provenance, `frame-sources.json`, `source: "pipglyph"`). Every WebP's
alpha is checked equal to its PNG's; the bucket is the only home. `m` and
`c` exist so that no colour resolves to a missing master (no plain gold
page or colourless Prepare is printed). The owner ticks GOLD as a known
close stand-in (Round 79): the 22 bordered two-colour printings then land
on `prepare/m` — the Prepare kind, `nearest` with the two-colour gap (print
draws the split frame, its page in the spell's colour) — and the 5
two-colour extended-art ones move onto it from the extended-art frame; `c`
stays unticked.

**Profile.** M15's slots, cost lift, type baseline, art window
(`CC_M15_ART_SLOT`), P/T plate and crown (`M15_CROWN`, `c` → the artifact's
`a`: SOS #170 and the five other legendary prints wear it; opt-in per card).
No stamp notch (the page's outline runs through M15's notch), no collector
line, no pairs yet. The page's slots carry `placeholderName: "Spell"` and
their own editor hint — the adventure's stay as they were.

**Kind.** `prepare` is a layout kind (`KIND_DEFS.prepare`: a creature, the
one card type every print has) whose template is `prepare`. Both renderers'
page anatomy is the adventure's, so the kind gate keeps the two apart by
trade dress: `TREATMENT_KINDS.prepare = ["prepare"]` and `prepare` is an
EXCLUSIVE kind, as the emblem — the Prepare frame dresses nothing else and
the Prepare card wears nothing else (`templateRefusesKind`, the server's
gate). The spell is the card's second part: the creator's "Creature |
Prepare spell" switch (`SECOND_PART_WORDS.prepare`, a sorcery to start),
its fields on the steps of its creature twin, the never-drawn fields hidden
(no picture of its own), the outline on the page.

**Import.** A Prepare printing is the Prepare kind and keeps its spell as
the back face, which the frame draws (main imported the creature on M15
with the spell as a back face no frame drew). The bordered printings are
EXACT on `prepare` once it is verified in the card's colour. Short of the
frame in the card's colour (before its tick; colourless stays unticked)
the import is main's — the CREATURE kind on the printing's own
landing (M15, or the extended-art frame), the spell a legacy back
(`finalizeImportMatch`): the Prepare kind wears its frame alone, so kept on
an unpublished one the import chooser had nothing to offer. A two-colour card (the split frame,
4.6f) and a spell page of another colour (`part-colour`, 4.26: SOS #170's
{W/B} spell on a grey page, FRA #3's {G/W} on a white creature) are
`nearest` on it; the extended-art printings land on it `nearest`; the two
TEXTLESS printings (FRA #402, SOS #306) keep main's landing, the creature
on the textless frames. Over all 124: 66 exact, 22 two-colour, 5 part
colour, 29 extended art, 2 textless (`tests/unit/scryfall/prepare-imports.test.ts`).
The AI deck remix lands where the import does and names the spell as the
creature's own (`SECOND_HALF_RELATIONSHIP.prepare`); the AI does not design
Prepare cards (its design types are one-faced).

**Left for later** (TODO 4.27), in the owner's order (Round 79): the page's
own colour and the two-colour pairs — BUILT by 4.26 (next section, "Each
part in its own colour") — then the stamp notch and the collector line; the
extended-art and borderless dresses; Omen, then Room. (The import paragraph
above is 4.27's: since 4.26 the two-colour and part-colour printings are
exact on `prepare` once it is verified in the card's colour.)

### Each part in its own colour (4.26)

TODO 4.26 (owner 2026-10-21, Prepare first). Print colours each part of a
two-part card by the part: Fire // Ice is a red half and a blue half (DMR
#215), Cut // Ribbons a red top and a black lower part (AKH #223), and a
Prepare card's spell page is the SPELL's colour. PipGlyph had one colour key
per card. The second part's colour is card data — `back_face.color_identity`
(absent or empty: the card's own) — and the look is an ADDITION, opt-in per
card: `frame_style.partColor`, drawn only `=== true` (lib/cards/anatomy.ts,
FRAME_ANATOMY_KEYS; lib/cards/part-color.ts).

- **Rollout.** A NEW card on split, aftermath, prepare or adventure starts on (the
  creator switches it on for a card on one of them —
  `useSecondPartColorFollow`, never NEW_CARD_ANATOMY, so a card on any other
  frame sends what it always did — and `anatomyDefaults` stamps it for a
  payload that names none, the AI jobs); an import follows its printing
  (on; each part's colour from its own cost, `partColorFromCost`); every
  save drops the key on a template that draws neither a seam nor a page
  (normalizeAnatomy). A card stored before it names no key and keeps its
  look whatever its second colour says — the 108 two-part cards of the dev
  database (2026-10-21) name no second colour at all, and
  `tests/unit/render/part-colour-bake.test.tsx` holds a stored card with
  one, switch absent or off, byte for byte to the card without. No layout
  bump, no sweep, no badge. An edit switches it on (`frame_anatomy.
  partColor`) and fills an empty second colour from the part's cost (a
  colour verified on the frame only).
- **The second part's colour.** From its cost (`partColorFromCost`): one
  colour; two — the PAIR in printed order, its dress the cost's
  (`twoColorDressOf`: an all-hybrid cost the hybrid's grey, else the
  gold-split); three or more `["multicolor"]` (gold); none `[]` (the card's
  own). The creator fills it from the part's cost on a new card and offers
  the "Second part's colour" row under the switch on the second part's tab.
  The server gates it like the front's colour (`partColorGateError`: the
  part's colour key must be published on the frame — on a new card; on an
  edit when the switch goes on, the colour changes or the frame changes
  with the look on, L2).

**Split and aftermath: a seam between two masters** (FrameProfile.
`partColorSeam`, the twoColorSplit machinery on an axis): the first part
paints the card's master, the second its own colour's master
(`frameMasterKey` — gold `m` for a two-colour half) past a hard seam, in both
renderers (`FrameLayer` clip-paths, the bake's `FrameSlice` boxes), both
finish masks and the bake's preload (`cardFrameSplit` / `frameColorKeysFor`).
No asset: never pre-flattened pairs.

| frame | seam | where | why there |
| --- | --- | --- | --- |
| split | x 52 %W (1092 px) | the black gutter between the halves, black on every row from x 1071 to 1114 of all seven masters | the prints' gutter centre is 1092.5 (DMR #210 / #214 / #215: 989–1026 on the portrait scan, turned); 546 px at the 1050 bake |
| aftermath | y 54.2857 %H (1140 px) | the black band between the parts, black on every column from row 1135 to 1143 of all seven masters | 570 px at the 750 bake; the prints' gap reads 1136–1137 dark across (AKH #215 / #220 / #223) |

**The card's colour stays the whole card's** (owner decision M2): a split
or aftermath card's `color_identity` is both halves' colours, as before 4.26
(Fire // Ice is red and blue — the single-select model's gold "multicolor"),
so the card page, the OG image, the filters and the deck stats don't move.
Its FIRST half's frame colour is `frame_style.firstPartColor` (colour words,
kept on a seam frame only — normalizeAnatomy; never read for behaviour),
named where it is not what the whole colour paints (Fire's red); absent, the
card's own colour paints the first half (every creator card: its picked
colour IS the first half's — a colour picked by hand after an import drops
the import's). The frame is gated in the colour it draws
(`frameGateColors`: the first half's with the look on, else the card's).
With the look OFF a card draws main's look exactly (Fire // Ice gold).

Import: a split or aftermath printing (Scryfall layout `split`, aftermath
with the Aftermath keyword; never a Room, L1) keeps its whole colour and
names its first half's (`printed_first_part_color`, from that half's cost —
Scryfall gives a split card's faces no colours of their own) and its second
half's (`back_face.color_identity`, from its cost). A two-colour printing on
these frames is exact now (the `two-colour` gap was 4.26's here,
`gapDrawnBy`); a HYBRID half (Incubation {G/U}, Depose {1}{W/U}) prints a
hybrid half PipGlyph draws gold — still nearest, the `two-colour-hybrid`
gap.

**Never a refused save after the art** (M1): an import
(`finalizeImportMatch`), the AI deck remix of a printing (`remixFrameFor`,
`scryfallRemixMechanics`) and of an own card (`ownCardRemixFrame`) judge a
landing with `partColourVerdict`: the look stays on only where BOTH parts'
colours are verified on the frame (the first half's master, the second's —
a Prepare page's colour, a pair's gold key) and the landing is then verified
in the first part's colour; short of it the card lands with the look OFF
(`printed_part_color: false`, an own remix's `part_color_off`) in its whole
colour — main's landing. The creator's "Second part's colour" row offers a
colour only where the frame is verified in it (aria-disabled with its
reason), the cost never fills an unverified one, a colour the cost filled
never crosses onto a double-faced body (nor a back's onto the part tab, L3),
and a refused save's message shows at the row.

**Prepare: the page overlay** (a `partPage` overlay slot, PREPARE_PAGE): the
spell's page cut out of the Prepare master of its key —
`prepare/page/<key>`, cols 746..1413 × rows 1314..1875 of the HD card (even
px, whole px at the 750 bake) — drawn over the creature's master where the
spell's PAGE key (`partPageKeyOf`) is not the page the master already
paints. What the prints show (the 38 two-colour and part-colour plain
printings of `layout:prepare`, 2026-10-21):

| the spell | its page | prints |
| --- | --- | --- |
| one colour | that colour's page (bars, rim, box) | YFRA #27 (red on an R/G creature), YFRA #29 (blue on U/B) |
| a gold two-colour cost | GOLD bars, the rim and the box ramped from its first colour (left) to its second about the PAGE's centre | SOC #45–50, SOS #198 / #223 / #237 |
| an all-hybrid cost | GREY bars (light name bar, dark type bar), the same ramp | FRA #3 / #39 / #70 / #85 / #105 and the ten hybrid creatures, SOS #170 / #199 |
| three colours or more | the gold page (`m`) | — (none printed) |

The name ink stays WHITE on the grey bar, as on every print (SOS #170's
"Heroic Stanza" included). The page's ramp: 10 / 50 / 90 % at 941 / 1061 /
1205 px (median of the 25 two-colour pages, the rim between the bars the
same) — linear 898 → 1228. Its paper at each end is that colour's own page
paper (FRA #105's red end 212/180/167 = SOS #109's red page).

**The two-colour Prepare creature** (`twoColorMasters: ["split",
"hybrid"]`, `prepare/<pair>` and `prepare/<pair>-h`): M15's pair master of
the dress — its field, bars and crown pinline (the hybrid's field split at
the card's centre, FRA #130) — with the LEFT box ramped about its own centre
(25 / 50 / 75 % at 408 / 420 / 432 on the 18 two-colour creatures: 396 →
444) and the pinline under both boxes about x 688 (660 → 716, SOC #48 /
#49, SOS #223), where M15's pair ramps both 600 → 900; the page is the pair
page of the same dress, the strip under it the gold field's (185/156/83 on
the 10 gold creatures) or, on the hybrid dress, its second colour's (FRA
#130 / #133 / #139 read the mono prints' w / u / g strips). The crown is
M15's pair band (`m15crown/<pair>`); the hybrid dress's plate the grey `c`.
A two-colour creature with a mono spell (YFRA #27) draws that colour's page
over its pair master; a gold creature with a hybrid spell (SOS #170) the
grey page.

**Masters** (`scripts/build-prepare-frames.mjs`, numbers `scripts/lib/
prepare-2026.mjs` `pairs` / `page`): the twenty pair masters are PipGlyph's
own derivation of the published `m15/<pair>`, `m15/<pair>-h` and one-colour
m15 masters (the pair master's left box and bottom pinline re-lerped from
the two one-colour masters onto print's columns; the page read from the two
lerped about the page's centre, its box's gain the two keys' lerped the same
way; the bars from `adventure/m` — gold — or `adventure/b` — the nearest to
print's neutral grey — toned onto print and lit by print's bevel); the
twenty-seven pages are every master's page cut out (col 746 and rows
1872..1875 see-through — the outline's soft edge over the creature's own
paper; right of the rim only the bars' rounded ends at their coverage,
un-blended from the page under them). The seven one-colour masters are
byte-identical to 4.27's. Dev bucket only until the owner promotes.

**Verification.** A pair master and a page ride the gate of the card's
colour key (a pair is `m`); the seam's second master is gated in its own
colour (`partColorGateError`). For the owner's ticks: `split/w`, `split/b`,
`split/g`, `split/m` and `aftermath/m` (built in 4.21, unticked "until 4.26")
against their prints, and `prepare/m` now covers the two-colour Prepare's
pair masters (its known close stand-in no longer).

**Adventure: the storybook page** (owner decision 2026-10-22: pre-cut
pieces; a `partPage` overlay slot, ADVENTURE_PAGE — the slot Prepare's page
uses, so no renderer code of its own). Print paints the storybook's LEFT
page — its name and type bars, its paper, its curled edge and the left half
of the spine — in the SPELL's colour and the right page in the creature's:
WOE #221 Callous Sell-Sword // Burn Together is a red page beside a black
frame. Of the 347 plain 2015-frame adventure printings (Scryfall
2026-10-22: `layout:adventure frame:2015`, no extended art, borderless,
showcase, full art or etched), 78 print a spell of other colours than the
creature: 62 a mono spell beside a mono creature (WOE #221–241, LCI #231,
their promos and List reprints, the Alchemy `ywoe` / `ytdm` cards — and
TDM's Stormbroods, Omens that print a page of their own: still nearest, the
`omen` gap), 14 a mono spell beside a colourless creature (HOB #170 / #174 /
#176, FIN's Towns, MB2 #577), one a two-colour spell beside a colourless
land (MB2 #621, a playtest card) and one a mono spell beside a three-colour
creature (YTDM #26, Alchemy). No print shows a TWO-COLOUR spell's page beside a creature of other
colours: the two-colour spells (MKM #212, MH3 #196, ELD #212's hybrid, HOB
#166) sit on a creature of the same pair, whose master already paints the
page.

- **The pieces** (`adventure/page/<key>`, `scripts/lib/cc-frames.mjs`
  ADVENTURE_PAGE_CUT, built by `import-cc-frames.mjs --only adventure`
  after the masters): each key's PUBLISHED master cropped to x 72..753 ×
  y 1312..1937 (the mask's bbox, 73..752 × 1313..1937, grown to an even
  origin and size — whole px at the 750 bake), its alpha Card Conjurer's
  `bookLeft` mask (native 1500 × 2100, no resample: 415 121 opaque px and
  3 147 on its soft edge), its colour the master's on every px — a piece
  over its own master is that master. Keys `w u b r g m`; a two-colour
  spell (either dress) maps to the gold page (the slot's `keyMap`), which a
  gold creature's master already paints. CC's `bookLeftMulticolor` (a page
  ramped between two colours, x ≈ 360 → 560) is read by nothing; no
  colourless page (no adventure SPELL is colourless; a colourless CREATURE
  — HOB #170 / #174 / #176, FIN #283–293, on `adventure/c`, CC's artifact
  frame, verified like the other six keys — with a coloured spell draws
  that colour's page: HOB #170's white page over `adventure/c` matches
  print). Twelve objects (PNG +
  WebP), dev bucket only until the owner promotes; provenance in
  `frame-sources.json` (`adventure.page`). The seven masters rebuild byte
  for byte.
- **Drawn** only with the switch on and where the spell's page key (after
  the keyMap) differs from the creature's colour key — a mono adventure
  (ELD #115 Bonecrusher Giant) draws nothing new.
- **Import**: an adventure printing (Scryfall layout `adventure`) names its
  spell's colour from the spell's cost (`back_face.color_identity`); the
  card's colour is the creature's (Scryfall's card `colors`), never a first
  part's. The `part-colour` gap now matches adventure printings too, and the
  adventure frame draws it: WOE #221–241 stay exact, as on main. The
  crowned (WOE #220, LCI #231, HOB), two-colour (MKM #212, MH3 #196, ELD
  #212) and Omen (TDM) printings keep their gaps. A colourless creature
  with a coloured spell (HOB #170 The Arkenstone // Seek the Heart: a white
  page over the artifact frame) draws that colour's page over
  `adventure/c` where the look is on. TDM's Omens (layout `adventure`, the
  `omen` gap) now draw their spell's colour page too — not measured
  against TDM's print yet (TODO 4.26).
- **Measured on print** (WOE #221–241 and LCI #231 at 1500 × 2100; the
  page's bars right of the name, the type bar right of its text, the left
  page's paper, the right page's paper — median colour; 17 printings whose
  spell is another colour): the name bar is Δ 28 (RGB distance, mean; max
  70) from print with the page on against Δ 107 with it off, the type bar
  Δ 15 against 118, the right page Δ 7 either way (the creature's). The
  left page's PAPER is about 28–35 levels per channel darker than print's
  on every colour (Δ 54 on, 59 off; the independent check: Δ 51–56 on WOE
  #221 / #223 / #233 / #239) — the Card Conjurer masters' own paper, the
  same on a one-colour adventure (ELD #115 Δ 72–76 for red on red): a tone
  of the masters, not of the page, and out of this change (a correction:
  TODO 4.26a). Where the creature's own paper sat closer to print's than the
  spell colour's does, the look ON reads further from print there (WOE #233:
  a white creature, a green spell — the green master's darker paper). The edges are the
  masters': the page's left edge at x 60 (print 61), its bottom at 1937
  (print 1937), the spine's dark fold at x 751 (print 749 — the masters'
  own, unchanged); the name and type ink is WHITE on every colour's bars,
  the white page's taupe bars included (print's brightest 0.5 % reads 255
  on all 17), as the profile draws it — no ink changes with the colour.

**Verification.** The page rides the adventure tick of the spell's colour
key (`partColourVerdict`, `partColorGateError`; a two-colour spell the gold
`m`): `adventure` is verified in all seven keys — `c` included, CC's
artifact frame for the colourless creatures (`supabase/seed.sql`, which
mirrors production) — so the look lands on in every colour once the pieces
are promoted. A tick
was given against the creature's master; the owner signs the pages off on
the review sheet (or re-ticks against WOE #221–241).

**Not built: flip** (no flip printing on the 2015 frame is two-coloured:
the 8 print both halves in the card's colour).

### The Universes Beyond frames (4.25)

TODO 4.25 (owner 2026-10-13, roadmap Q5: three frames of their own — spell,
artifact, land — reached by a pick or an import only). `m15ub`,
`m15ubartifact` and `m15ubland` are the frame Universes Beyond printed from
the 2021-11 Secret Lair drops and Warhammer 40,000 (2022-10) to Final
Fantasy (2025-06): M15's card with smooth, streaked bars, box and frame
where M15 has its mottled paper, a smooth crown, smooth P/T plates, and the
TRIANGLE holofoil stamp on every rarity.

**What the prints show** (677 plain black-bordered printings read at
1500 × 2100, 2026-10-13: 545 across every Universes Beyond set and stamp,
53 more of the Secret Lair and promo sets, 79 DSK / FDN / DMU controls;
each compared with our Universes Beyond master AND our M15 master of its
colour key by a normalised cross-correlation of the bars and the text box,
the text's ink left out):

- **Which sets wear it.** Every triangle-stamped set from 40K to FIN
  correlates with the Universes Beyond drawing (median 0.68–0.76; the M15
  drawing 0.20–0.38): 40K, LTR / LTC and their promos, WHO, PIP, ACR, FIN /
  FIC and their promos, the Secret Lair drops from 2021-11 on (21 of 22):
  179 of 189 prints of those sets clearly, none on the M15 side (the other
  ten are gold, hybrid and colourless cards the measure reads poorly). Every set from Marvel's
  Spider-Man (2025-09) on correlates with M15 (0.51–0.70; ours 0.24–0.48),
  as the 79 controls do (0.42–0.70): SPM, SPE, TLA, TLE, TMT, TMC, MSH,
  MSC, HOB, HOC, TRK, TRC print the plain M15 frame with the OVAL stamp on
  rares and none below. Scryfall's `security_stamp: triangle` is the one
  field that names the frame (3,784 plain printings; 1 without it before
  2025-09). Not covered by it: one 2020 Secret Lair print with the triangle
  on another frame (the rule starts at 2021-11-01), Heroes of the Realm
  2021, and a handful of late Final Fantasy promos (`pmei`) that keep the
  streaked frame under an oval stamp — those import as M15, as before.
- **Same slots as M15.** Against the master, the Universes Beyond prints'
  title bar sits at +1.5 px, the type bar at +0.2, the box's bottom at
  −1.1 (the controls: +1.5 / +0.2 / −1.2), the name's ink starts at row 128
  on both and the type line's at 1209 / 1212 (medians at HD; p10–p90 within
  3 px of each other). Card Conjurer's pack says the same thing: the M15
  pack's six masks, art bounds and text boxes. So each profile is its M15
  twin's, slot for slot.
- **Pairs.** A two-colour card prints the split box and pinline over gold
  bars (40K #104, LTR #287), a hybrid one the two frames under grey bars
  (PIP #212, ACR #55), a two-colour artifact the silver frame under gold
  bars (40K #110), a two-colour land the land frame with the split box
  (40K #268) — M15's dresses, so the pair masters are 4.6b's recipe over
  the pack's files.
- **Crown.** Every legendary printing on the frame wears the STANDARD
  crown's shape in the smooth art (40K #10, LTR #173, FIN #558; gold 40K
  #2; a land's LTR #257). Card Conjurer's floating Universes Beyond crowns
  belong to its full-art and extended looks and are not imported.
- **Stamp.** The triangle sits at 688–814 px under a top edge at 1919 px,
  its apex at 1991 (61 prints), under a pinline that steps up and over it
  (the black from 1911 px), on 191 of 198 prints read — every rarity; a
  common's and an uncommon's is a matte grey triangle, a rare's and a
  mythic's the hologram.
- **Colourless.** The three colourless non-artifact cards in print (ACR
  #1, FIN #2, WHO #9) wear a SEE-THROUGH frame, the art under translucent
  grey bars — not the artifact frame. Built since (below, "The see-through
  colourless frame").
- **Tones** (the bars and box against ours, the medians of 9–13 prints a
  key): within 8 levels a channel on w u b r, the artifact frame and its
  coloured keys; the green title bar prints 14 lighter in red and blue
  (193,215,185 against 179,214,172), gold 7–12 darker. Left as Card
  Conjurer drew them in this reading; toned since (the tone pass, below).

**A second reading** (#544's independent check, 2026-10-13: 238 OTHER
printings — none of the 677 above — each read twice, by eye on the bars and
by correlation with both masters):

- **Scope.** 143 of 145 triangle-stamped plain printings of 2021-11 →
  2025-08 wear the streaked frame and none the M15 one (the two others are
  the see-through colourless card), every non-full-art basic land among
  them (40K, LTR, WHO, ACR, the 2021 Secret Lair five). Of 77 Universes
  Beyond printings WITHOUT the stamp from 2025-09 on, one wears the streaked
  frame: PMEI 2025-21 (Cloud, Midgar Mercenary, 2025-12) — its scan shows
  the triangle, Scryfall tags it `oval`, so it imports as M15. A 2026
  printing that does carry the triangle (PMEI 2026-17) is streaked: the
  rule has no end date on purpose. The one plain triangle print before
  2021-11 (SLD #581, 2020) wears a dark brushed frame of its own. In
  Scryfall's data no plain black-bordered Universes Beyond printing of
  2021-11 → 2025-08 lacks the stamp.
- **Stamp.** On 114 prints the triangle's top edge is at 1918 px (1917–
  1927), its apex at 1991, 686–816 px wide 8 px down; ours read the same
  way: 1920, 1992, 683–816. Its TONE differs: a common's and an uncommon's
  is a flat dark grey (97, 97, 97), a rare's and a mythic's hologram reads
  135–150 — ours is one silver at 214 on every rarity.
- **Tones, on the cleanest prints** (the digital renders, a few levels of
  spread): green title bar 187–194, 210–212, 176–182 against our
  173, 211, 165; gold title bar 238–240, 218–220, 128–140 against
  241, 227, 157 and gold text box 245, 234, 196 against 249, 242, 213; the
  COLOURLESS LAND (PIP #254, LTR #261) title bar 198, 187, 178 against
  214, 210, 194 and text box 231, 227, 221 against 220, 214, 195 — the
  largest miss. White, blue, black, red and the artifact frame are within
  about 8. A tone pass on `g`, `m` and the land's `c` is best done BEFORE
  those colours are ticked: afterwards it is a correction, with a sweep.
  ("Ours" in this bullet is the pack as drawn; the pass is below.)

**The tone pass** (owner Round 57, 2026-10-14: tone them before the frames
are promoted, so no stored card ever wore the old tones — no bump, no
sweep). Print was read a THIRD time first, on 190 printings neither earlier
reading used (Scryfall's images of FIN, FIC, ACR, PIP, WHO, LTR, LTC and
their promos, 40K, the Secret Lair), by the second reading's method — the
per-channel median of the region's paper at 1500 × 2100, the brightest 5 %
and the darker 40 % (ink, rims) left out; title bar x 140–1360 × y 118–198,
type bar y 1198–1272, text box x 150–1350 × y 1350–1880. 47 were set aside
for a cast of their own (the date-stamped promos, the surge foils, 40K's
and the Secret Lair's scans); the other 143 agree within a few levels a
set. Medians [min–max]; "before" and "after" are our master read the same
way:

| Place | Before | Print: builder | Print: second reader | Print: Round 57 | After |
|---|---|---|---|---|---|
| Green title bar | 173, 211, 165 | 193, 215, 185 | 187–194, 210–212, 176–182 | 185, 211, 178 [180–194, 209–213, 173–182] (27 spells) | 188, 211, 179 |
| Green type bar | 170, 209, 162 | — | — | 180, 209, 173 [175–188, 206–212, 165–178] (27) | 182, 209, 173 |
| Gold title bar | 241, 227, 157 | "7–12 darker" | 238–240, 218–220, 128–140 | 237, 219, 139 [231–241, 216–222, 127–145] (29 spells of 3+ colours); 239, 221, 134 (11 two-colour spells); 241, 221, 135 (6 two-colour artifacts); 240, 222, 133 (20 gold lands) | 239, 220, 135 |
| Gold type bar | 241, 226, 154 | — | — | 237, 219, 135; 239, 219, 130; 241, 219, 129; 241, 222, 130 (the same four groups) | 238, 219, 132 |
| Gold text box | 249, 242, 213 | — | 245, 234, 196 | 244, 234, 198 [241–246, 233–235, 196–202] (29); 243, 234, 198 (20 gold lands) | 244, 234, 197 |
| Colourless land title bar | 214, 210, 194 | — | 198, 187, 178 (2 lands) | 197, 185, 176 [192–200, 182–187, 174–177] (32 lands); 197, 184, 176 (12 two-colour lands) | 197, 186, 177 |
| Colourless land type bar | 212, 208, 191 | — | — | 197, 185, 176 (32); 197, 184, 175 (12) | 197, 185, 176 |
| Colourless land text box | 220, 214, 195 | — | 231, 227, 221 (2) | 230, 226, 219 [229–232, 224–227, 217–221] (32) | 230, 226, 220 |

Gold prints in two inks — WHO / ACR / LTC with blue at 122–131, FIN / FIC /
PIP / LTR at 133–145 — and the target sits between them. Untouched: the
green text box (215, 227, 215 against our 219, 229, 218); white, blue,
black, red and the artifact frame, within about 8 on the two earlier
readings (not read again here); the white and the black land, within 6 on
two prints each.

- **How.** `UB_PRINT_TONES` (`scripts/lib/cc-frames.mjs`) is the recipe:
  per region `from` (what the pack's file reads) and `to` (the centre the
  three readings agree on) — numbers, no scan is read by a build. The
  importer tones the FILE as it loads it (`CC_SOURCE_TONES`,
  `toneSourceRegions`), through the pack's own Title, Type and Rules masks,
  before any mask, ramp or composite: the colour is multiplied by
  to ÷ from, so streaks, bevels and rims keep their shading and black stays
  black, and the gain's colour part fades out between the region's tone and
  white, where only the luminance gain is left. (A plain per-channel gain
  was tried first: green's × 1.087 / 1 / 1.085 turned the bar's light
  streaks pink — the Vehicle plate's lesson.) Alpha is never touched.
- **What shares the pixels.** Five files are toned: `g.png` and `lg.png`
  (the green land's bars are the green frame's, pixel for pixel), `m.png`
  and `lm.png` (the gold land's bars AND box are the gold frame's), and
  `l.png`. So one tone reaches every master built from them: `m15ub/g`,
  `m15ub/m`, the ten gold-split pairs (their bars are `m.png`'s) and the ten
  hybrids (their grey bars are `l.png`'s — PIP #212 / #740 and ACR #55
  print them at 198–202, 187–191, 177–179); `m15ubartifact/g`, `m15ubartifact/m` and
  its ten pairs (gold bars); `m15ubland/c`, `m15ubland/g`, `m15ubland/m` and its ten pairs
  (the land's grey bars). 47 masters and their 47 WebP twins, 94 objects.
- **What did not move.** The frame field, the pinline and the border of
  every master (the changed pixels are rows 97–225, 1178–1307 and
  1312–1939 only, x 84–1416; 0 alpha values), so the stamp notches — their
  rim is tinted to the pinline — rebuild to the same bytes, as do the 36
  crown pieces, the 28 plates and the other 28 masters (w, u, b, r and the
  artifact silver): 128 of the 222 objects are byte-identical, and nothing
  outside the three templates changed in the manifest. Every WebP's alpha
  still equals its PNG's.
- **Left as it is.** The green LAND's two prints read (LTR #260, LTC #341)
  agree with the green bar's new tone, on two prints only. The gold
  pinline, the crowns' gold and the plates were not measured against print
  in this pass.

**The masters.** Card Conjurer's accurate 'Universes Beyond' pack
(its `packUBNew` pack, `m15/new/ub/`, 2010 × 2814): the colour frames whole, the
artifact frame under the colour's bars for a coloured artifact, the land
frame and its tints — `m15`, `m15artifact` and `m15land`'s recipes with
`ubFrameFile` for the file of a letter. The pack lists a 'Colorless Frame'
that is **missing from Card Conjurer's tree**; `m15ub/c` was first the
pack's ARTIFACT frame, borrowed (owner 2026-10-13), and is now print's
see-through frame (below). Plates: the pack's own `m15/ub/pt/<k>.png`
(282 × 154) at M15's plate box — the grey 'Colorless' plate under `c` on
the spell frame (the hybrid dress's too), the silver 'Artifact' one on the
artifact frame; the land frame draws the spell frame's. Their ink is
within a pixel of M15's (`lib/cards/plate-ink.ts`).

**The see-through colourless frame** (owner Round 57, decision 3; layout
**v57**). Print's only colourless non-artifact cards on this frame — ACR #1
The Capitoline Triad, FIN #2 Ultima, Origin of Oblivion (and its PFIN #2s
promo), WHO #9 Clara Oswald (and its #614 surge foil): five printings, all
LEGENDARY — wear a see-through frame: the art runs under the frame field,
the bars and the text box are translucent over it, the rims, pinline and
crown white-silver. `m15ub/c` is built from two Card Conjurer drawings
(`UB_SEE_THROUGH_LAYERS` in `scripts/lib/cc-frames.mjs`):

- the ACCURATE pack's see-through colourless frame (`m15/new/c.png`, m15/c's
  own file) gives every edge, line, rim, bevel and the ALPHA — the master's
  alpha equals m15/c's in every pixel (0 of 3,150,000 differ): the same
  window, bars at 212 / 255, box at 179 / 255 and the faint wash over the
  frame field. So the profile declares what m15 declares for `c`
  (`underFrameArt: { rect: UNDER_FRAME_RECT, colors: ["c"] }`), both
  renderers and the finish masks read it through `artLayersFor()`, and the
  art-window check passes on the bucket master as it does on m15/c;
- the OLDER Universes Beyond pack's see-through colourless frame
  (`m15/ub/regular/c.png`, its smooth streaked paper) gives the colour of
  the bars and the box, as colour only (`recolour`, the alpha below kept),
  through the accurate pack's Title, Type and Rules masks, PAPER ONTO
  PAPER: weighted by that drawing's own luma and by the luma of the
  accurate drawing below (each 0 at or below 150, whole from 190), never
  where the older drawing is opaque (its rims, `maxAlpha`). That drawing
  is not used whole: measured against the accurate pack its lines sit 1–5
  px off (2010-wide: the title bar's bottom line 292 against 294, the
  right rim 1879 against 1883, the box's rim 2596 against 2597) and its
  bars end in another cap — the crown band, the stamp notch and the plates
  are cut for the accurate geometry.

The crown is `m15ubcrown/c`: the pack's `ub/crowns/new/c.png`, which IS
the M15 pack's colourless crown byte for byte, so the object has
`m15crown/c`'s pixels under this band's name. The notch is
`m15ubholostamp/c`, its rim sampled from `m15ub/c`'s white rim (as
`m15holostamp/c` is from m15/c). The plate stays the pack's grey
'Colorless' one. The artifact and land frames keep their opaque colourless
masters (their profiles map `c` to `a` / `l`).

*Reference printings*: ACR #1, FIN #2, WHO #9 (all legendary — the crown is
drawn). *Rollout*: an addition on a combo no card can be on (never ticked,
offered nowhere), but the visual gate records the master swap as a bump,
so it is one — v57 (`UB_SEE_THROUGH_C_LAYOUT_VERSION`), "sweep", scoped to
`m15ub` and to a card that paints the colourless master (`v57Changed`),
verification-neutral (the owner's ticks on the other colours stay
fresh). The visual matrix: 4 of 1724 cases change, all `m15ub/c`.

**The crown** is `m15ubcrown/<key>.png`: `m15crown`'s recipe at the same
rects over the pack's smooth crowns (`UB_CROWN_BAND`), keys w u b r g, m,
a, l, c (the see-through frame's colourless crown, above) and the ten
pairs.

**The triangle stamp.** `frame_style.stamp` already held `"triangle"` (an
import of a triangle-stamped printing has written it since 4.9c); until
this frame it drew the M15 frame's OVAL, because every "on" value draws the
shape the frame's notch is cut for. It still does on M15; on the three
Universes Beyond frames the notch is the triangle's:
`m15ubholostamp/<key>.png` is Card Conjurer's stamp piece (299 × 137 on
its 2015-wide card) resampled once to 223 × 102 px at 638, 1891 — the rim
tinted to our master's bar, per column on a pair, the triangle (the
hologram capture) cut clear (`HOLO_STAMP_NOTCHES.m15ubholostamp`,
`UB_STAMP_HOLE`) — and the art over it is our own silver triangle on the
prints' geometry (`UB_STAMP_FACE`; `HOLO_STAMP_TRIANGLE_ART` in
`lib/cards/holo-stamp-art.ts`, generated by
`scripts/generate-holo-stamp-art.mjs`). The rules keep-out is the raised
pinline (`M15UB_HOLO_STAMP_KEEP_OUT`).

*"Auto" is the frame's own print* (owner Round 57, decision 2; layout
**v56**). On a frame whose notch is cut for the triangle, `"auto"` stamps
EVERY rarity — `holoStampWanted` reads the slot's shape — where it stamped
a rare or a mythic; `"oval"` / `"triangle"` ("Always") and `"none"` mean
what they meant, an absent key stays unstamped, a token, an emblem and a
back face never draw one, and an oval frame keeps the oval's rule. The
face has two TONES (`holoStampToneOf`, read from the rarity whatever "on"
value asked for the stamp):

| | Print (54 digital prints, 2026-10-14) | Ours before | Ours now |
|---|---|---|---|
| Common / uncommon | one flat grey, 95, 97, 96 (26 digital prints, 95–101, sd 0–1; no keyline, no sheen) | none on "auto"; silver on "Always" (mean luminance 209 in the bake) | `HOLO_STAMP_TRIANGLE_MATTE_ART`: 95, 97, 96, flat |
| Rare / mythic | the hologram: mean luminance 148 (144–153 on 28 prints), its darker tenth 113, its lighter tenth 189, a tan cast (157, 150, 113) | one silver, mean 209 in the bake (tenths 163 / 238) | `HOLO_STAMP_TRIANGLE_ART`: our neutral silver sheen at mean 151 in the bake, tenths 107 / 178 |

Read at 1500 × 2100 on the face 9 px inside its edge, 16 printings a
rarity over 40K, ACR, FIC, FIN, LTC, LTR, PIP and WHO (Scryfall's images;
none kept). 40K's ten are real scans (surge foils and photographs: 38–130
below a rare, a gold foil at rare) and are left out of the centres. The
hologram keeps OUR drawing — a neutral silver with our sheen and no symbol;
print's tan cast and its artwork are not copied.

- **Rollout: a correction, swept.** The look was wrong against the frame's
  own print, so v56 is a "sweep" (`UB_STAMP_TONES_LAYOUT_VERSION`), scoped
  to the three templates and, on them, to a card whose switch asks for a
  stamp (`v56Changed`: "auto", "oval" or "triangle", no token or emblem).
  Verification-neutral: no slot, master, notch piece or plate moves, and no
  tick scores the stamp. The frames were a day old and reached by a pick or
  an import only; `/admin/renders` shows what the cron re-bakes.
- **Text.** The notch and its keep-out are the same pieces: a card that
  drew the stamp keeps every line. A common or uncommon on "auto" GAINS
  the notch, and with it the keep-out its "Always" twin always had — its
  bake is that twin's layout, pixel for pixel but the triangle's face.
- **Imports** keep writing `"triangle"` for a triangle-stamped printing
  (the printing HAS a stamp: it then draws on either frame — the oval on
  M15 where the card lands until the colour is ticked — in the rarity's
  tone here). `"auto"` would un-stamp a common wherever it lands on M15.
- **The creator** says so: the chip reads "Auto: every rarity" on these
  frames, the answer line names the tone ("Common → matte grey triangle").

**Who gets it.** An addition: no stored card moves, no bump, no sweep, no
badge.

- A NEW card never starts on one: none is an era's standard. Each is the
  last skin of its M15 twin under Variations (`TEMPLATE_SKIN_VARIANTS`),
  offered where it is verified in the card's colour — the spell frame to a
  creature, instant, sorcery or enchantment, the artifact frame to an
  artifact (an Artifact Creature borrows it, as it borrows `m15artifact`),
  the land frame to a land. Print restricts nothing more, so any card of
  the kind may pick the look.
- An import: the registry's `ub/2015` rule — a plain black-bordered
  2015-frame spell, artifact or land with the triangle stamp, released
  2021-11-01 or later — is `nearest` on the M15 frame (where it always
  landed; the answer says "not yet verified") until the Universes Beyond
  frame is verified in the card's colour, then names it and is `exact`
  (the crown, both pair dresses and the stamp are drawn there). The AI
  deck remix follows (`remixFrameFor` finalizes the same match). A
  colourless non-artifact spell takes the rule too since `m15ub/c` is the
  see-through frame: the see-through `m15/c` until `m15ub/c` is ticked,
  then `m15ub` — 5 printings (ACR #1, FIN #2, PFIN #2s, WHO #9, WHO #614;
  main against this rule over all 10,661 Universes Beyond and
  triangle-stamped printings, 2026-10-14: 0 other printings change in any
  field, under production's list, with every colour ticked, or with every
  colour but `m15ub/c`).
- A Universes Beyond printing on another body keeps its frame as the
  `nearest`, with the `universes-beyond` gap: a saga, an adventure or a
  split (`layout/2015`), a Vehicle (`vehicle/2015` — the bronze frame is
  the closer one), a double-faced card, extended art. The foil-etched and
  "inverted" runs are dresses of their own and never take the rule.

Measured on 19,807 printings (every Universes Beyond printing and 8,312
others, Scryfall 2026-10-13) through the import path with production's
verified list: 0 landings change before the ticks (4,752 Universes Beyond
printings change their ANSWER — exact on M15 becomes "not yet verified",
or the `universes-beyond` gap — and no other printing changes at all);
with the three templates verified in every colour 3,234 printings move,
all Universes Beyond, onto their own frame (2,001 spells, 614 artifacts,
619 lands).

**Not built** (follow-ups, in 4.25): the Universes Beyond Vehicle frame
(the pack's `v.png`), extended art, full
art, the saga and spree dresses, the floating crowns, borderless.

### The Expeditions (4.11 wave 1, layout v64)

The Zendikar Expeditions printed two looks, and PipGlyph draws both from
Card Conjurer's packs (frames bucket only, 1500 × 2100 native, copied 1:1):

- **`expeditionland` — ZNE 2020** (Zendikar Rising Expeditions #1–30), from
  'ZNR Expeditions (2020)' (`expedition/znr/expeditionNewFrame<K>.png`, w u
  b r g m c). The hedron stone round a window that runs into a LIGHT
  translucent rules panel (white, α 153) over the same picture, dark ink on
  the title bar, the panel and the type bar. It replaced the 375 px MSE
  masters (the 2015 BFZ look, an opaque black box and light ink, upscaled
  4×; black and green leaked their border): a CORRECTION, layout v64
  (`EXPEDITION_CC_LAYOUT_VERSION`), a sweep scoped to the template. Its
  border, art window and corner checks pass on every colour, so its rows
  left `BORDER_PENDING_COLOURS`, `EDGE_CONTRACT_KNOWN_FAILURES`,
  `ART_WINDOW_KNOWN_FAILURES`, `SQUARE_CORNERS` and Phase B's allow-list.
  The pack is RE-CUT onto the ZNE prints (owner 2026-10-22,
  `EXPEDITION_ZNR_RECUT`, the recipe's `shift`): its title bar sits 4 px
  below the prints' and its window foot, panel, type bar and bottom stone
  11 px above them (each band registered on ZNE #21 / #22 / #27 / #28 /
  #29 / #30), and only three runs of rows are flat on all seven masters —
  the top border, the window's straight sides (730–776) and the bottom
  border — so rows 60–729 move 4 px up and rows 777–1938 11 px down, whole
  rows byte for byte, the flat runs giving and taking the rows. Left after
  it: the prints' type bar is ~5 px thinner than the pack's (its top +2 …
  +3 px, its foot −2 … −4 after the move), which no block move gives.
- **`expeditionlandbfz` — EXP 2015** (Zendikar Expeditions #1–45, BFZ and
  OGW), from 'BFZ Expeditions (2015)'. Every EXP print wears the pack's
  'Land Frame' (the beige carved stone, light bars) with its colours in the
  PINLINE only, but for the two any-colour lands (Forbidden Orchard, Mana
  Confluence), which print the gold frame. So `c` is the land frame, `m`
  the gold frame, and w u b r g the land frame with the colour frame's
  pinline laid in through the pack's Pinline mask (no mono-colour EXP land
  was printed; the pack's colour-stone frames are worn by no print). Its
  rules panel is lifted onto print's opacity (owner 2026-10-22,
  `EXPEDITION_BFZ_PANEL_GAIN`): the pack draws it at α 128 (0.50); measured
  from the art's continuity across the window / panel divider on the twelve
  EXP prints where the art crosses it clearly, print's is ~0.65 (0.62 by
  the spread, 0.68 by the slope), so the land and gold layers' alpha is
  multiplied by 166 / 128 — the panel α 166, its rim and the divider's dark
  line opaque, every clear or opaque pixel unchanged. Its bars are NOT
  re-cut: the title bar registers within 0–2 px of the prints, the type bar
  with no one offset (+2 … +8 at its top, −1 … +7 at its foot over nine
  prints). An ADDITION: no card sits on it, no bump.

Measured at 1500 × 2100 against Scryfall's scans (2026-10-21; median
|ΔRGB| over each candidate master's opaque pixels at the best offset):
ZNE colourless 18.3–20.7 on C, Valakut 20.7 on R, Cavern / Prismatic Vista
19.0–19.3 on M, the MSE masters 100–108 on all; EXP colourless 21.0–23.7 on
L (A 26.0–30.3), gold 27.0–31.3 on M. EXP #37 Dust Bowl and #38 Eye of Ugin
are a whiter run (closest to the pack's W, 20.3): not references.

The profiles (`EXPEDITIONLAND`, `EXPEDITIONLANDBFZ` in
`lib/cards/template-layout.ts`) share one anatomy: the art slot is the
window plus the panel with 7.6's overscan (ZNE 224–1724 px down and
59–1441 across on the re-cut master, EXP 112–1388 × 231–1702); the name at
the family's 80 px with its text 2 px above M15's (`EXPEDITION_TITLE_DY`) —
on ZNE in M15's band riding the title block 4 px up, baseline 182 (the
prints' 181–183), on EXP 186 (prints 187); the type line at 68 px on its
own band, baseline 1805 on ZNE's moved bar ("Land" bakes at 1804, the
prints' 1802–1806) and 1798 on EXP; the set symbol in its own box
(`symbolRect`) right-aligned at 1419 / 1371 px, centred on 1783 / 1776; the
rules box on the panel, standard size, dark ink, centred, M15's print
margins (ZNE 141–1365 × 1219–1713, EXP 131–1365 × 1262–1694). The ZNE
slots ride `EXPEDITION_ZNR_TITLE_UP_PX` / `EXPEDITION_ZNR_LOWER_DOWN_PX`, a
test holding them to the importer's blocks; no cost,
no crown (EXP's legendary lands print none), no stamp notch. The collector
line (4.9b, opt-in per card) is M15's slot on each look's rows:
`EXPEDITION_ZNR_COLLECTOR` (1995.5 / 2033.5 px, 2 px below M15's) and
`EXPEDITION_BFZ_COLLECTOR` (1987 / 2025.5, 6.5 px above).

Import: ZNE → `expeditionland` (`expedition`), EXP → `expeditionlandbfz`
(`expedition/bfz`), each exact once verified; a two-colour land — the duals
and the fetch lands, whose pinline prints their two colours — is
`nearest` through the `two-colour` gap (blocked by 4.11: the pair masters,
not built; its request-log row is kept) and is dressed in the frame's PLAIN
land master `c`, not the gold one (owner 2026-10-22,
`twoColourLandOnPlainFrame` in `lib/scryfall/frame-signatures.ts`). The
card's COLOUR is untouched — `color_identity` is what main imports (its
"multicolor": the card page, the filters, the decks; owner 2026-10-22, as
4.26's M2 for split cards) — and the frame data rides beside it:
`printed_plain_land_master` on the import patch, stored as
`frame_style.plainLandMaster` (kept by an edit and a remix, dropped at the
save on any frame without `FrameProfile.plainLandStandIn` and on a card
whose colour doesn't key gold). Both renderers (`frameMasterKey`, and the
watermark's tint), the save's gate and the import's verification and
landing (`frameGateColors`) read it through ONE test,
`plainLandMasterDrawn` (`lib/cards/frame-color-key.ts`): the stand-in
declared, the key set, the card gold-keyed — so the `c` tick is the gate, while the frame draws no two-colour pinline.
Every import surface asks the key PER FRAME through
`importFrameColorKey` (`lib/creator/frame-resolve.ts`): the chooser's
options, its preselected nearest and the applied pick
(`lib/creator/import-frame-choice.ts`), the landing's fallbacks
(`resolvePublishedFrame`'s `colorKeyFor`: `c` on the Expedition frames, the
card's gold on `m15land`), the AI deck remix's landing (`remixFrameFor`:
it lands where the import lands, and its save passes the gate), the deck
pre-fill's toast, the overwrite note and the request row — and the Card step's colour chips follow the master the
card draws (`ColorSection`'s `plainLandMaster`: its own Multicolor chip is
gated in, and its tile paints, `c`). Over all 75
printings (`tests/unit/scryfall/expedition-imports.test.ts`): ZNE 6 exact,
24 two-colour; EXP 9 exact, 36 two-colour.

Not built (follow-ups): the two-colour pinline pair masters on both (the
BFZ pack has its Pinline mask; the ZNR pack too) — they lift the gap and
the plain-land landing; the holofoil stamp's notch (the prints' oval sits
on a cut in the stone); the ZNE / EXP set symbols at their printed size
(`lib/cards/set-symbol-prints.ts` — a card-scoped bump of its own, every
frame a ZNE or EXP symbol sits on); the ZNE type bar's ~5 px thickness.

### The Lord of the Rings scroll (4.11, layout v62)

`lotrscroll` — the scroll showcase of LTR #452–730 and LTC #411–490, our
most-printed showcase — is Card Conjurer's 'Scroll' pack (packScroll.js,
`img/frames/scroll/`, 2010 × 2814) since the showcase rebuild's first wave.
The 646 px MSE drawing left git (its masters under public/frames and
its row in `build-showcase-frames.mjs`); the pack goes to the frames bucket through
`scripts/import-cc-frames.mjs` (`CC_TEMPLATES.lotrscroll`, the `SCROLL`
block of `scripts/lib/cc-frames.mjs`). A CORRECTION (layout v62, a sweep,
`LOTR_SCROLL_LAYOUT_VERSION`): no colour was ticked.

- **Masters.** The pack's eight frames whole, downscaled once to
  1500 × 2100 (Lanczos, as `m15ub`'s), with the parchment wash over the
  art window that every print shows (the pack's 'No Art Overlay' mask, which
  drops it, is not used). w u b r g m are the colour frames; `a` is the
  light-blue 'Artifact Frame' a colourless ARTIFACT paints
  (`artifactMasterKeys { c: "a" }`: LTR #687–703, LTC #485–489); `c` is the
  brown 'Land Frame' — the pack has no colourless frame, and a colourless
  printing that is not an artifact is a land (#712 Shire Terrace). A
  coloured land wears its colour's frame (#711 The Shire is green; LTC #490,
  LTR #704). A colourless creature that is neither an artifact nor a land
  draws the brown land master with the artifact's plate: no print has that
  shape.
  The masters carry the printed black border, so the transparent ring of
  4.35 is gone: `lotrscroll` left `BORDER_PENDING_TEMPLATES`, the edge
  contract's and the art window's known failures, `SQUARE_CORNERS` (its
  square corner is the border black now) and `NEVER_NORMALISE`.
- **The corner.** The pack's corners are square black, so the importer cuts
  the ONE card corner (64.5 px) as on every Card Conjurer master. The MSE
  drawing's corner was its transparent ring (a #101015 arc on the bake):
  the showcase families keep their drawn corners (owner, 2026-09-28), but
  the scroll's drawn corner is now the border's, so there is nothing of a
  design to keep — flagged for the owner on the review sheet.
- **Plates.** The pack's seven scroll plates (`scroll/pt/<k>.png`,
  435 × 266) at its ptBounds (`LOTRSCROLL_PLATE_RECT`); the colourless card
  wears the artifact's light-blue plate (#700 Shire Scarecrow). Their ink box
  is in `lib/cards/plate-ink.ts`.
- **Slots.** The pack's text layout is the accurate M15 pack's number for
  number, so the profile is M15's slots and the M15-era family's sizes
  (`fit: "measured"` name and type line, joined WITH v62), the CC M15 cost
  row (`CC_M15_COST`: 70 px discs, 78 pitch, the row ending at 1385, centred
  on 157) and type baseline, the art slot over the masters' window
  (111–1388 × 230–1168 px on every key: `LOTRSCROLL_ART_SLOT`), and the
  name 4 px left of M15's. Measured 2026-10-22 on 14 Scryfall PNGs at
  1500 × 2100 (LTR #457 / 470 / 526 / 546 / 595 / 619 / 643 / 687 / 697 /
  700 / 704 / 712, LTC #412 / 422) by the shift that best registers our
  bake of the same card on the print, region by region: the frame ±2 px
  (the scans' own scale), the cost row 0 / +1, the name −4 → 0 after the
  move, the type line +1 / +2, the set symbol −2 / 0, the P/T −1 / +1; a
  generic disc's face 69 px tall on print and ours, centred 156.0 on both,
  its right edge 1387 on print (3 prints) against our 1385.
- **Crown** (`LOTRSCROLL_CROWN`, `lotrscrollcrown/<key>.png`): the pack's
  'Legendary Crown' — the rolled top edge of the title scroll (LTR #470,
  #526, LTC #422) — at its bounds, a 1500 × 100 band. Keys w u b r g m, `a`
  (a colourless artifact, through the slot's `artifactKeyMap`) and `l` (any
  other colourless card, `keyMap`). An ADDITION, opt-in per card; an import
  of a legendary scroll printing names it (`CROWNED_SHOWCASE_SIGNATURES`).
- **Stamp** (`LOTRSCROLL_HOLO_STAMP`, `lotrscrollholostamp/<key>.png`): every
  print wears the Universes Beyond TRIANGLE (705–797 px wide at row 1950,
  apex 1992–1993), so the slot is the triangle's — "auto" stamps every
  rarity, matte below a rare. The notch is the pack's OWN piece per key (its
  rim is textured parchment in the frame's colour — no flat bar for
  `m15holostamp`'s tint), placed at its bounds, downscaled with the card,
  cut to 266 × 140 at 620, 1877; the triangle's hole + 2 px cut clear and
  the 2 px round it painted black, because the pack draws its hologram ~2 px
  larger and higher than the stamp (`blackoutAndCut`; the check places the
  pack's `gray.png` the same way and finds α ≤ 1 outside). An ADDITION.
- **Collector line**: M15's slot (`COLLECTOR_TEMPLATES`) — LTR / LTC set
  both lines within 1–2 px of it. An ADDITION.
- **Imports.** `showcase/ltr/scroll` is exact on `lotrscroll` once a colour
  is verified (the cap is gone); a two-colour printing (LTR #642–686, LTC
  #449–484) is `nearest` through the `two-colour` gap, item 4.11.

**Not built** (follow-ups, in 4.11): the two-colour dress (the colour frames
split by the pack's `maskRightHalf.png` under its 'Multicolored Bars'), and
the scroll saga (CC's `SagaLTR`, 4.5d).

### The Lord of the Rings ring (4.11, layout v65)

`lotr` — the ring showcase of LTR #302–331 and their surge-foil twins
#794–823 (sixty printings, every one a legendary creature: 14 mono, 12
two-colour, 4 gold) — is Card Conjurer's 'Ring' pack (packRing.js,
`img/frames/lotr/`, 1500 × 2100 NATIVE: nothing is resampled) since the
showcase rebuild's first wave. The 646 px MSE drawing left git (its masters
under public/frames and its rows in `build-showcase-frames.mjs` /
`import-mse-profiles.mjs`); the pack goes to the frames bucket through
`scripts/import-cc-frames.mjs` (`CC_TEMPLATES.lotr`, the `RING` block of
`scripts/lib/cc-frames.mjs`). A CORRECTION (layout v65, a sweep,
`LOTR_RING_LAYOUT_VERSION`): no colour was ticked.

- **Masters.** The pack's eight frames whole: w u b r g m are the colour
  frames; `a` the blue-grey 'Artifact Frame' a colourless ARTIFACT paints
  (`artifactMasterKeys { c: "a" }`); `c` the brown 'Land Frame' — the
  scroll's split (#604), applied unprinted: the ring run prints no
  colourless card.
- **The edges.** The frame field runs to the card's TOP and SIDE edges (no
  border there, on every print) and the bottom is the black border's
  shoulders. The edge contract declares that as it is printed: three
  `design` edges (opaque like a border, but the corner is the design's
  colour, never held dark — `lib/frames/edge-contract.ts`) and a `border`
  bottom. The transparent band 7.7 found under the MSE drawing is gone:
  `lotr` left `BORDER_PENDING_TEMPLATES`, the edge contract's and the art
  window's known failures and `NEVER_NORMALISE`.
- **The corners.** The importer cuts the ONE card corner (64.5 px) at the
  two BOTTOM corners, as on every Card Conjurer master, and keeps the two
  top corners square (the recipe's `keepCorners`, on the masters and the
  crown band): the frame field runs into them, so a square output keeps it
  there (`SQUARE_CORNERS.lotr`: top "frame", bottom the border black) — a
  black or #101015 cap on the taupe field would be a seam. Every round
  output (the stored bake, the thumb, the OG image, the preview) cuts the
  standard corner at render, so the round card is the standard one.
- **The round window.** The masters are opaque but for the window: see-
  through (α < 16) on 150–1350 × 254–1160 px with a soft white foot (α 90)
  down to row 1170, on every key. The pack's own artBounds (149 / 252 /
  1202 × 918, `LOTR_ART_SLOT`) cover it as ONE plain slot with the art-
  window check's 0.05 % to spare; the frame hides the rect's corners round
  the circle. No `underFrameArt`: nothing else on the master lets the art
  through.
- **Plates.** The pack's plates (`lotr/pt/<k>.png`, 268 × 134) at its
  ptBounds (`LOTR_PLATE_RECT`); the colourless card wears the artifact's
  (the plate follows the colour key). Their ink box is in
  `lib/cards/plate-ink.ts`.
- **The pack against its prints.** Measured 2026-10-22 on 11 Scryfall PNGs
  at 1500 × 2100 (LTR #302 / 305 / 307 / 310 / 312 / 313 / 316 / 317 / 318 /
  328 / 331) by the shift that best registers our bake on the print, region
  by region, and by ink profiles: the pack DRAWS its title bar 12 px lower
  than the prints (outlines 113.5 / 231.5 px against 100.5 / 218.5), its
  type bar where they do (1182.5 / 1299 on both), its box bottom and plate
  6 px higher, and its sides 4 px in. Every slot is placed against ITS OWN
  bar, as the print places it against the print's.
- **The geometry, as drawn — accepted** (owner 2026-10-22): the top
  block (edge inscription, title bar, its rim) stays 12 px below print and
  the box bottom and plate 6 px above it. A lossless re-cut of the top was
  built and reviewed (rows 12–237 up 12 px through a flat zone): the only
  flat zone under the moved block is the title bar's cream rim, so the rim
  came out ~21 rows thick where print's is 8 and the plain bar's end caps
  turned into a square step — below the rim the inscription, the ring and
  the window's top differ row to row, and no other seam exists. The owner
  dropped it: the slots ride the pack's own bars instead.
- **Tones onto print** (owner 2026-10-22, `RING_PRINT_TONES` through
  `RING_SOURCE_TONES`, the Universes Beyond frames' mechanism): Card
  Conjurer's text-box paper was 40–60 levels off print on u / b / r / g
  (the MSE masters were within ~3), the frame field 10–23 off on r and g.
  The paper of w u b r g and gold is toned through the pack's Rules mask
  (85th luma percentile of the box 200–1100 × 1700–1820, print vs pack:
  w 218,212,191 → 213,206,179; u 123,165,195 → 163,188,216; b 156,157,156 →
  204,202,202; r 210,136,126 → 216,177,146; g 123,170,141 → 184,202,188;
  gold 228,208,155 → 212,187,133), the field of r (118,34,34 → 108,46,41)
  and g (13,68,45 → 36,65,48) by its own flat colour (`nearRegionPlane`: CC
  paints the field, the bars' faces and the plate's face one colour), as
  each FILE loads — masters, crowns, plates and stamp pieces alike. The
  scans of one colour agree to 1 level (LTR #302–306, #307–308, #309–311,
  #312, #313–315, gold #317 / #328 / #329 / #331). Left as drawn: the w, b
  and gold fields (≤ 5 levels) and the blue field, whose prints set the bars
  LIGHTER than the field (one tone of CC's single colour would move the bars
  12 off to fix the field by 9); `a` and `l` (no print).
- **Slots.** The pack's text layout is the accurate M15 pack's but for the
  title bar, so the profile is M15's slots and the M15-era family's sizes
  (`fit: "measured"` name and type line, joined WITH v65), white name and
  type line, with:
  - the name and the cost row 10.4 px lower (CC's title y 120 against
    M15's 109.6 of 2100), on the pack's own bar; the name's ink then sits
    within 1–2 px of the print's against the bar (left edge 131–132 against
    129–134);
  - the CC M15 cost row (70 px discs, 78 pitch, its right end) CENTRED on
    the bar, as the prints centre it (the disc's face 124.5–193.5 under
    outlines 100.5 / 218.5 on #307 / #310 / #312: −0.3 px off the bar's
    centre), where the v61 lift left ours 6 px above it: `costDy` −2 px —
    ours 138–206 under the pack's bar (113.5 / 231.5).
    The last disc ends 0.5 px from the print's against the bar's right end;
  - the type line on the CC baseline + 2 px (the prints set it on 1261 px,
    6 prints, under the same bar; CC M15's lift leaves 1259);
  - the P/T digits centred on the plate's face (1185–1393 px) as printed
    (1290.3 px, 5 prints): CC's box left them 8 px left and 1 px high;
  - the set symbol where M15's sits: its ink centre within 1.5 / 2 px of
    the print's.
  The prints set the type line ~5 % larger than the family's constant and
  the LTR symbol ~6 % smaller than the regular LTR print the per-set table
  measured; both stay the family's (a per-frame size is its own item).
- **Crown** (`LOTR_CROWN`, `lotrcrown/<key>.png`): the pack's 'Legendary
  Crown' — the scalloped cream title bar every print carries — at its
  bounds, a 1500 × 272 band (rows 0–271) that repaints the card's whole
  top, its top corners kept square like the masters'. Keys w u b r g m, `a`
  (a colourless artifact, `artifactKeyMap`) and `l` (any other colourless
  card, `keyMap`). An ADDITION, opt-in per card; an import of a ring
  printing names it (`CROWNED_SHOWCASE_SIGNATURES`: all sixty are
  legendary).
- **Stamp** (`LOTR_HOLO_STAMP`, `lotrholostamp/<key>.png`): every print
  wears the Universes Beyond TRIANGLE (hole 687–812 × 1924.6–1992.5 px), so
  "auto" stamps every rarity, matte below a rare. The notch is the pack's
  OWN piece per key (212 × 95 at 644 / 1893, 1:1), cut to a 214 × 106 box
  at 643, 1892 — 1 px round the piece and 10 px past its foot, so the hole
  and its ring fit. The pack draws its hologram 8–10 px HIGHER than the
  printed stamp (its `gray.png` shape from 1915 px against the hole's
  1924.6), so the importer paints that shape black first
  (`blackoutStampShape`, grown 1 px), then cuts the hole + 2 px clear and
  paints the 2 px round it black (`blackoutAndCut`): no pixel of the
  capture is published (`stampShapeBlackFindings`). An ADDITION.
- **Collector line**: M15's slot (`COLLECTOR_TEMPLATES`) — the prints set
  both lines there in the black bottom border. An ADDITION.
- **Imports.** `showcase/ltr/ring` is exact on `lotr` once a colour is
  verified (the cap is gone); a two-colour printing (LTR #316, #318–327,
  #330 and their twins: 24) is `nearest` through the `two-colour` gap, item
  4.11.

**Not built** (follow-ups, in 4.11): the two-colour dress (the colour frames
split by the pack's `lotr/maskRightHalf.png`).

### The MUL Tarkir showcase (4.11, layout v67)

`tarkirdragon` — "Dragon Wing", the Multiverse Legends Tarkir showcase: MUL
#1 Anafenza, Kin-Tree Spirit (white) and #60 Taigam, Ojutai Master
(white-blue), with their halo-foil twins #131 / #131z / #190 / #190z (six
printings of two legendary creatures, every one rare, each stamped with the
oval) — is Card Conjurer's 'Tarkir' pack ("Tarkir Sketch (MOM)",
packTarkir.js, `img/frames/tarkir/`, 1500 × 2100 NATIVE: nothing is
resampled) since TODO 4.11. The 646 px MSE drawing left git (its masters
and plates under public/frames and its rows in `build-showcase-frames.mjs`
/ `import-mse-profiles.mjs`); the pack goes to the frames bucket through
`scripts/import-cc-frames.mjs` (`CC_TEMPLATES.tarkirdragon`, the `TARKIR`
block of `scripts/lib/cc-frames.mjs`). A CORRECTION (layout v67, a sweep,
`TARKIR_DRAGON_LAYOUT_VERSION`; taken after #609's v66): no colour was
ticked.

- **Masters.** The pack's six colour frames whole (w u b r g, m gold) and
  `c` = the pack's 'Artifact Frame' (`tarkir/a.png`, silver-blue wings):
  the pack's Colorless frame and plate are commented out of packTarkir.js
  and absent from the tree, so a colourless card wears the frame Card
  Conjurer itself offers it (no colourless card prints on the frame). The
  pack draws ONE drawing whose dragon wings alone carry the colour — any
  two masters differ only on x 47–442 and 1069–1457 px (the wings run down
  the box's sides too, x 58–182 and 1329–1440) — with a real black
  border all round, cut at the one card corner by the importer. 4.35's
  #101015 ring is gone: `tarkirdragon` left `BORDER_PENDING_TEMPLATES`, the
  edge contract's known failures, `SQUARE_CORNERS` (its corners are the
  border black) and `NEVER_NORMALISE`.
- **The window.** See-through (α < 16) on 144–1349 × 244–1157 px with a
  soft shadow round it (α < 250 on 131–1365 × 232–1158) on every key — the
  pack's artBounds (131 / 233 / 1235 × 926) less a pixel. The art slot
  covers the shadow with the art-window check's 0.05 % to spare:
  130–1367 × 231–1160 (`TARKIRDRAGON_ART_SLOT`).
- **Two colours.** The frame keeps its split wings (`twoColorSplit` at
  50 %W, owner 2026-09-25, MUL #60): the pack's own two-colour dress
  ('Right Half' = `tarkir/maskFrame.png`, a ramp across 41.7–61.3 %W)
  crosses identical pixels on every pair, so the hard seam reads the same.
  The plate stays gold, as Taigam's.
- **Plates.** The pack's plates (`tarkir/pt/<k>.png`, 274 × 150; the white
  one 273 × 150, stretched to them) at its ptBounds (1155 / 1850, 274 ×
  150); `c` the artifact's. They fill their image to every edge
  (`lib/cards/plate-ink.ts`).
- **The pack against its prints.** Measured 2026-10-22 on the six Scryfall
  PNGs at 1500 × 2100 (≥ 250 ms apart; the halo-foil twins print another
  ink and are read for geometry only) by the shift that best registers the
  pack's drawing on the print, region by region: the top corners and the
  title bar −5.7 / −6.4 px (print higher), the side wings at mid-height
  −2.3, the type bar +0.5 / +1, the box bottom, plate and stamp +5 / +6;
  horizontally +2 on the left, +7 on the right. Print is the same drawing
  0.66 % taller and 0.4 % wider. No flat zone allows a re-cut (the wings
  run unbroken from the title bar to the box), so the masters stay as
  drawn and every slot is placed against ITS OWN bar, as the print places
  it against the print's.
- **Tones onto print** (`TARKIR_PRINT_TONES` through `TARKIR_SOURCE_TONES`):
  ONE rule, the ring's (#607) — the raw median of the scans against the
  pack's, over the same pixels (each print registered on the pack's
  drawing; text and misregistered outlines, |Δluma| > 45, left out of
  both), and a region off by ≥ 9 levels on a channel is toned. Per region
  (pack → MUL #1 / #60):

  | Region | Pack | Print | Off | |
  |---|---|---|---|---|
  | w wings | 207,178,138 | 202,180,152 | 14 | toned |
  | u wings | 56,110,211 | 75,105,177 | 34 | toned |
  | text box (dark ground) | 53,53,52 | 61,61,61 / 66,65,67 → 64,63,64 | 11 | toned |
  | w plate's tan ends | 214,190,154 | 201,183,164 | 13 | toned |
  | title bar's face | 197,197,197 | 198,198,201 | 4 | as drawn |
  | type bar's face | 191,190,190 | 193,192,194 / 192,191,193 | 4 | as drawn |
  | plate's face | 201,202,203 | 196,199,201 / 196,198,198 | 5 | as drawn |
  | gold plate's ends | 188,146,56 | 187,151,51 | 5 | as drawn |

  The wings are the pixels where the colour's file differs from the
  artifact file (`diff`, `diffRegionPlane`: ≥ 40 levels, eroded 3 px for
  the reading); the box its dark ground inside the box where the master is
  the same as another (`box`, `boxRegionPlane`: the dragon wings that run
  down its sides are not the box), on every master; the plate's ends its
  coloured pixels (`chroma`, `chromaRegionPlane`); the stamp notch piece the
  box's ground its arch carries round it, read at its place on the card
  (else it composites ~8 levels darker than the toned box: a faint halo).
  Toned as each FILE
  loads, so the masters, crowns and plates drawn from it agree. b r g, the
  gold wings and the artifact silver have no print: as drawn.
- **Slots.** The pack's text layout is the accurate M15 pack's but for its
  title and type bands, so the profile is M15's slots and the M15-era
  family's sizes (`fit: "measured"` name and type line, joined WITH v67),
  with:
  - the name and the cost row 7 px above M15's band: print's baseline
    174.5 / 173.8 px under a bar 6.4 px higher than the pack's — 181.5 on
    the pack's (the pack's own title y is 104 against M15's 109.6);
  - the name's pen 2 px left (print's capitals at 126–127 px, the bar 2 px
    right of the pack's; Card Conjurer moves it 4);
  - the CC M15 cost row (70 px discs, 78 pitch, its right end — print's
    last disc ends 1392.5 px, 7 right of ours where the bar is 7 right
    too), its lift cut by the band's move: `costDy` −1.7 px, the discs
    centred on 155.1 (bake 155), print's 148.75 under its bar (+6.55 →
    155.3); within 1 px of print against the bar after the change;
  - the type band 4.5 px up — its line on print's baseline (1255.7 under a
    bar 0.8 px lower: 1254.9 on the pack's, the CC M15 baseline 1259.5) and
    the inline set symbol with it (print's centre 1237 → 1236.2; ours sat on
    1240.5) — and its pen 5 px left (print's L at 130 on the pack's bar,
    ours 135; Card Conjurer's 123 against M15's 128); black ink (print's
    20,22,12), not M15's softer type ink;
  - white rules (print's core 255,255,255) in M15's box but its foot: the
    pack's box ends at 1926 px (M15's at 1949), and print's full box (MUL
    #60, nine lines at the 64 px step) sets its last descender on 1912 px —
    1906.5 on the pack's — so the box ends at 1911;
  - the P/T where print sets it on the plate: the ink-weighted centre of
    "2/2" and "3/4" at 1928.4 / 1928.0 px on the pack's plate (each print
    registered on the plate's ends and top rim, +5.8 px; a first 4.4 px
    lift left ours 2.5 px high) — the box 1.2 px above M15's, its top on a
    whole px: the bake's centre 1928.5 / 1928.2, within 0.3 px. Across,
    "2/2" sits within 1 px of print; "3/4"'s ink ~4 px left of print's,
    most likely the digits' own ink asymmetry (the box is centred) — not
    moved (TODO 4.11).
  Flagged, not changed: MUL is not in the per-set symbol table, so its
  glyph prints at the family's ink fit, ~0.73 of print's (a per-set row is
  its own bump, and every MUL card on any frame would move); print's P/T
  digits are ~7 % taller and lighter than the family's Beleren bold.
- **Crown** (`TARKIRDRAGON_CROWN`, `tarkirdragoncrown/<key>.png`): the
  pack's 'Legend Crown' — the row of dragon-wing spikes along the title
  bar's top that all six printings carry — 1:1 at its bounds (180 / 51,
  1145 × 65 px), a 1500 × 120 band over the master's own bar. Keys w u b r
  g m, `c` (the artifact crown, as the master) and the ten pairs: the first
  colour's crown left and the second's right across the pack's own ramp
  (`TARKIR_PAIR_RAMP`, 41.7 → 61.3 %W), as MUL #60 prints its white-blue
  crown — its centre bulb the two blended (159,144,152 on print);
  `pairCrownOnGold`, the template drawing its two colours as halves. The
  blend of tan and blue is near-neutral, so the bulb cannot reach print's
  faint purple: accepted for now (TODO 4.11). An
  ADDITION, opt-in per card; an import of the run names it
  (`CROWNED_SHOWCASE_SIGNATURES`: both legends print it).
- **Stamp** (`TARKIRDRAGON_HOLO_STAMP`, `tarkirdragonholostamp/<key>.png`):
  every printing is rare and wears the OVAL, so "auto" is a rare or mythic
  as on M15. The notch is the pack's one 'Holo Stamp' (`tarkir/stamp.png`,
  225 × 101 at 638 / 1888, 1:1) — the box's bottom rim arched over a black
  well — cut to a 227 × 110 box at 637, 1887 (1 px round the piece, 8 px
  past its foot), the same piece for every key (the masters' rim under it
  is the same pixels). The pack paints a capture of the hologram in the
  well (685–815 × 1924.5–1987.5 px, measured on the piece); the cut is the
  PRINTS' oval, 134 × 64 on the well's centre (683–817 × 1924–1988 px —
  MUL #1 / #60 / #131 / #190: ink 132–133 px across the widest row, 62–65
  rows down the centre; M15's 134 × 67 agrees in width only), covering the
  capture: that oval + 2 px is cut clear and the 2 px round it painted
  black (`blackoutAndCut`, now
  for an oval too — `notchCutOf`), and the importer holds every lit pixel
  of the well inside the cut and its ring (`capturePlane`) — no pixel of
  the capture is published; our oval art covers the cut. The arch's rim is
  a rules keep-out (638–863 × 1888–1928 px). An ADDITION.
- **Collector line**: M15's slot on the ZNE Expeditions' rows
  (`EXPEDITION_ZNR_COLLECTOR`: 1995.5 / 2033.5 px — MUL #1 / #60 / #131 /
  #190 end both lines' ink on 1996 / 2034, the © line at 1402–1403). An
  ADDITION.
- **Imports.** `showcase/mul/tarkir` is exact on `tarkirdragon` once a
  colour is verified (the border cap is gone); #60 / #190 Taigam is the
  frame's own split wings, so no two-colour gap.

### The Tarkir: Dragonstorm showcases (4.11 / 4.35, layout v68)

`tarkirdraconic` (TDM #292–326, the gold-railed dragon frame) and
`tarkirghostfire` (TDM #399–408, the black run; #409–418 are the white
halo-foil run, 4.30's) came out after Card Conjurer's last pack, so they
stay on their Magic Set Editor masters
(`magic-m15-showcase-tarkir-draconic` / `-ghostfire`, upscaled in git by
`scripts/build-showcase-frames.mjs`). A CORRECTION (layout v68, a sweep
scoped to the two templates, `TARKIR_MSE_LAYOUT_VERSION`; taken after
#610's v67): no colour of either frame is ticked. Measured 2026-10-27 on
every printing of both runs (Scryfall PNGs at 1500 × 2100, ≥ 300 ms apart)
against the set's regular printings (TDM #1–12, the same scans) and our
bakes of the same cards; sheet: the owner's design-backup
`mse-showcase/tarkir-sheet.jpg`.

- **The border MSE paints at render time** (4.35). An MSE style draws its
  border colour in a `border color` layer, through a mask, when it renders
  a card — so the card PNGs it ships are see-through where print has its
  black border, and our bake showed the card root's #101015 there. The
  builder now paints it UNDER each master
  (`scripts/lib/mse-showcase-borders.mjs`, the numbers as data; never over
  a pixel the drawing paints), in the border black of the print-verified
  Card Conjurer M15 masters (0,0,0: Scryfall's PNGs read 19,12,12 on every
  black border, the regular M15 printings' included — their scanning, not
  the frame; owner 2026-10-22), cut at the one card corner:
  - **draconic** — every see-through pixel joined to the card's outline
    (MSE's own `border_mask.png` marks the text box, not a border): the
    band below and beside the dragons, which print fills black to the
    bottom edge and up the lower sides; the dragons themselves run to the
    side edges above it and their heads into the TOP corners (left as
    drawn). The art window is never joined to it (the builder throws if
    the flood reaches an art seed). Edge contract: top and bottom `border`,
    the sides `design`; square corners: the top pair `frame`, the bottom
    pair the border black.
  - **ghostfire** — a black ring round an art window of MSE's shape
    (`border_mask.png`, 744 × 1039: top corners r ≈ 11, the bottom ones
    chamfered 45° under the ribbon, the footer from y 932 — 1884 px) whose
    straight edges are PRINT'S: the ring's inner edge by its half-level
    crossing on every bright-art row and column of #399–408, median 78.3 /
    80.2 / 80.0 px from the left, right and top edges (MSE's scaled mask,
    76.6 / 76.6 / 78.8, drew it 1–3 px narrow) — 78–1420 × 80–1884 px on
    whole px, drawn as geometry (4 × 4 supersampled), not as the 2×
    upscale of a 744 px mask, so its edge is clean at 2×. (#402 / #404 /
    #405 let their art break over the ring: popouts, not drawn.) Edge
    contract `ALL_BORDER`, every corner the border black.
  - The masters stay a palette PNG, but WITHOUT dithering
    (`PALETTE_PNG_OPTIONS`): a dithered palette mapped a few opaque
    near-black border pixels onto a dark translucent entry (α 231–240 on
    the draconic's sides), and the builder now decodes what it wrote and
    refuses a border pixel left short of opaque (`borderLost`). Side by
    side at 2× the drawing is the same.
  Both templates left `BORDER_PENDING_TEMPLATES`, the edge contract's and
  the art-window check's known failures, and the ring corners of
  `SQUARE_CORNERS`.
- **Draconic slots: M15's.** On the prints the name, type line, rules box,
  set symbol and collector line sit where the set's regular printings set
  them (name baseline 188 / 189 px, rules ink from x 133 on both, the
  title bar's outlines within 1 px of our master's), so the profile is
  M15's slots at the M15-era family's sizes (`fit: "measured"`, joined WITH
  v68) and the CC M15 cost row (print: 70.4 px discs at a 77–78 px pitch,
  the row ending at 1385.4; it drew 57 px discs ending ~1306–1353) — the
  same row the regular TDM printings carry, and it is ON print: registered
  as #598 registers it, the {U} disc's centre is 157.0 px against TDM
  #295's 156.5–157.5 (the independent check, 2026-10-27). A raw circle fit
  of the scans reads print ~4 px lower than our bakes — that is #598's two
  known traps (the scans' 1.1 px image offset, and the W / B / R / G
  symbols pulling the fit down), not a misplaced row: never move M15's row
  for it. One nudge: the type line 2 px below the CC M15 baseline, because MSE's type
  bar is 2 px lower than the Card Conjurer M15 master's (its outlines at
  1185 / 1303 px, print's own, against 1184 / 1301) and print sets the line
  on it as M15 does on its own (1263 px; the regular printings 1261). The
  serpent-ringed P/T plate and its digits stay as #386 set them.
- **Draconic art slot** on the master's window: α < 250 on 64–1451 ×
  242–1179 px on every key, plus six see-through holes between the
  dragons' claws at its edges (from row 240), with the art-window check's
  0.05 % to spare: 63–1453 × 239–1183 (`TARKIRDRACONIC_ART_SLOT`). The old
  slot (135–1365 × 252–1218) left the gaps between the dragons showing the
  root's #101015 68–84 px past it (7.6).
- **Draconic colourless.** MSE's own `c` is a BROWN drawing no print
  wears (its dragons 116,71,47 against the colourless prints' steel
  78,94,100 — 53 levels off; no tone carries a hue change across a
  textured frame). Every colourless printing of the run is an ARTIFACT
  (#323 Boulderborn Dragon, #324 Dragonfire Blade, #325 Mox Jasper — the
  `c` reference) and wears MSE's STEEL drawing, so `c` is built from
  `acard.png` (`sourceKeys` in the builder; raw scan medians against the
  file over the same pixels: dragons 78,94,99 against print's 75,91,97,
  text box 248,238,230 on both, title bar 3 levels off — nothing is
  toned, `c` needs no cap), with the steel plate (`apt.png`) and the steel
  stamp rim. A colourless non-artifact card has no print on the frame; it
  takes the same steel `c`, plate and rim alike. #326 Maelstrom of the
  Spirit Dragon is no colourless reference: a land that taps for any
  colour prints GOLD, and the importer's land rule (`produced_mana`) reads
  it as the gold `m` card it is — MSE's gold matches it (dragons
  140,104,51 against 139,101,46).
- **Ghostfire slots: its own, at the family's sizes.** Its bars are not
  M15's (the type bar at 51–57 %H), so the profile keeps its print-measured
  rects, with the family's name and type sizes (`fit: "measured"`, each
  band's baseline kept from its old print-matched size), the family's
  86 px set symbol box with the ink fit, the 70 px disc centred in its
  title band as before (print: 70.2 px, the row ending at 1386; ours 1385)
  and the type line 2 px up onto print's 1158 px. Its art slot is the
  ring's window (77–1421 × 79–1885, `TARKIRGHOSTFIRE_ART_SLOT`; it ran
  from 52.5 px, under the ring). It had no footer slot — no artist credit
  at all; it takes M15's on the black footer the master now paints (every
  print sets the credit there, in the collector line's second row).
- **References.** The ghostfire's eight pointed at the white halo-foil run
  (#409–418); they are the black run's now — w #400 / #401, r #402 / #403,
  g #404, c #399, m #408 / #405 (u and b have no printing). The white run
  stays `nearest` on its border (`showcase/tdm/ghostfire/white`, 4.30:
  Scryfall says white, the scans show its halo foil there; its footer is
  black). Imports: `showcase/tdm/draconic` and `showcase/tdm/ghostfire` are
  exact once a colour is verified.
- **Stamp** (draconic, `TARKIRDRACONIC_HOLO_STAMP`,
  `tarkirdraconicholostamp/<key>.png`, git): MSE's own stamp as a stamped
  card draws it — the `card stamp border` (the border black through
  `stamp_border_mask.png`: the well) under the `card stamp rim`
  (`stamp/<c>stamp.png`: the serpent rim arched over the well) — upscaled
  like the masters and cut to its box, 239 × 65 px at 631, 1895 (each
  colour its own rim). The oval is the prints' hologram, centred on 750.8 ×
  1955 px on every stamped printing (#295, #300–303, #308, #309, #314,
  #317, #319, #321, #324–326), at M15's 134 × 67. Print stamps every rare
  and mythic and nothing else, so "auto" is M15's rule. The arch is a rules
  keep-out (631–870 × 1895–1950). An ADDITION, opt-in per card. The
  ghostfire's stamp sits in its ribbon's own dip — no notch piece, no
  stamp yet (TODO 4.11).
- **Collector line** (both, `M15_COLLECTOR`): the prints set both lines on
  M15's rows (line 1 at 1990–1991 px, line 2 at 2029, the © line ending at
  1395 — the regular TDM printings the same, by the same reading), on the
  black footer the masters now paint. An ADDITION.
- **No crown**: the legendary printings (draconic #302, #308, #314, #317,
  #319, #321, #325; ghostfire #403, #407) print the same top as the rest.
- **Flagged, not changed** (TODO 4.11):
  - the draconic's TOP: print runs a scaled serpent across the whole top
    edge, its heads at a third and two thirds; MSE draws black there with
    a head in each corner (no source has the print's drawing);
  - the ghostfire's translucent boxes print darker, a nearly opaque deep
    teal, where MSE's 60 % teal over the art reads lighter; a translucent
    box over art has no raw median to tone by, so it waits for a measure
    of its own;
  - TDM's set symbol: Keyrune's drawing is not print's (rotated, no black
    keyline);
  - on the densest rules texts the M15 rules layout sets one ladder step
    smaller than these prints do — M15's own behaviour, not this frame's.

### The Avatar elemental and Bloomburrow woodland showcases (4.11 / 4.35, layout v69)

`avatar` (TLA #336–353 and TLE #305–317, the Eternal-legal companion
set's printings of the same frame) and `bloomburrow` (BLB #295–336, the
woodland run) came out after Card Conjurer's last pack, so they stay on
their Magic Set Editor masters
(`magic-m15-showcase-avatar-elemental` / `-bloomburrow-woodland`, upscaled
in git by `scripts/build-showcase-frames.mjs`). A CORRECTION (layout v69,
a sweep scoped to the two templates, `AVATAR_BLOOMBURROW_LAYOUT_VERSION`;
taken after #613's v68, and a test refuses it while v68 has no rollout):
no colour of either frame is ticked. Measured 2026-10-27 on the runs'
printings (Scryfall PNGs at 1500 × 2100, ≥ 250 ms apart) against the
sets' regular printings (TLA / BLB #1–14, the same scans) and our bakes of
the same cards; sheet: the owner's design-backup
`mse-showcase/avatar-bloomburrow-sheet.jpg`.

- **What MSE paints at render time, built in.** Both styles draw parts of
  the printed card in render-time layers, so the card PNGs they ship are
  see-through there and our bake showed the root's #101015:
  - **the Avatar's title bar** — every printing, legendary or not, wears
    the ornate bar MSE draws as `crown/<c>.png` (its plain `noncrown` bar
    has no print). The builder lays it UNDER the drawing on every key
    (`underlays` in the builder, the colourless key from MSE's silver `a`);
  - **the Avatar's black footer** and **the woodland's coloured footer** —
    every see-through pixel outside the art window (the window being the
    α < 250 flood from the art's seeds: `outsideCoverage`, kind
    `"outside"` in `scripts/lib/mse-showcase-borders.mjs`), painted UNDER
    the drawing. The Avatar's in the border black 0,0,0, cut at the one
    card corner. The woodland's in each colour's own tone
    (`WOODLAND_FOOTER_RGB`: MSE's `border/<c>border.png` — w 64,49,56 ·
    u 0,55,81 · b 19,12,13 · r 84,0,9 · g 18,66,7 · gold 64,37,49 — equal
    to the raw scan medians channel for channel, so nothing is toned; the
    black footer's 19,12,13 is print's own tone, not the scanner's — every
    black woodland print reads it (#309, #311, #312, #314) where the same
    BLB scans read 0,0,0 on the regular black borders (#1, #60, #86, #90,
    #100, #210), so it is never the border black; `c` has no print and
    keeps MSE's 51,31,21), kept to the corner (`keepCorners`):
    the footer is the card's edge there, so a square output shows it.
  - Encoding: a palette PNG without dithering where that keeps every
    painted pixel opaque; the woodland's leafy band has too many colours
    for one palette on some keys, so the builder tries a finer palette and
    then truecolour (`BORDERED_PNG_ATTEMPTS`) and takes the first encode
    that loses no border pixel (bloomburrow `r` truecolour, `g` and `u` at
    q90, `m` at q80, the rest the plain palette).
  Both left `BORDER_PENDING_TEMPLATES` (`bloomanime` was the last, until
  its layout v70), the
  edge contract's and the art-window check's known failures, and the ring
  entry of `SQUARE_CORNERS` (bloomburrow is `frame` on all four corners).
- **Slots: M15's.** `artForwardShowcase()` set the name on the type bar
  and the type line under it; print sets every text where the sets'
  regular printings do — the name's ink 145–189 px against 145–188 on the
  regular TLA cards (baseline 188–188.5, ours 189), the type line's
  1220–1260 against 1223–1259 (ours 1260), the collector rows 1988–1989 /
  2027 with the © line ending at 1396 (`M15_COLLECTOR`). So both profiles
  are M15's slots at the M15-era family's sizes (`fit: "measured"`, joined
  WITH v69) with the CC M15 cost row (print: 70.2 px discs at a 78.5–78.6
  px pitch, centred on 157.8 px, the row ending at 1386.3 / 1384.7; ours
  69.9 px on 156.5, ending at 1384.4 — within #598's known offsets, the
  row kept). The type line takes the CC M15 baseline (both MSE type bars
  sit where the CC M15 master's does: the Avatar's 1183 / 1296 px against
  1185 / 1298, its title bar 82.5 px tall against 82). Name and type ink
  are white, no shadow (print's 255,255,255 on every bar); the rules box
  and its margins are M15's, dark ink on the paper.
- **Art slots on print's windows.** The Avatar's art runs out of the top
  edge and down the sides to the type bar (α < 250 on 0–1499 × 0–1165 px
  on every key): `AVATAR_ART_SLOT`, 0–1500 × 0–1168. It is NOT an
  edge-to-edge treatment (`artReachesCardEdge` asks for a window taller
  than wide as well): the bars, box and footer are opaque, so Etched stays
  offered, and Scryfall's art_crop of its printings is the classic 626 ×
  457 (TLA #338), which fills a 1500 × 1168 window with 6 % of its width
  trimmed — an import keeps the frame, as before. The woodland's window
  runs to both side edges between its top band and its medallions (0–1499
  × 234–1183): `BLOOMBURROW_ART_SLOT`, 0–1500 × 232–1186. The old slots
  (6 / 2.5 / 88 × 54 and 6–94 %W) left the sides showing the root (7.6).
- **Edges, as printed** (7.7 had `ALL_BORDER`; both are borderless): the
  Avatar's top is `art` but where its title bar meets the edge (3.3–96.6 %),
  its sides `art` but along the bar's ends and below the art (5.1–8.4 %,
  from 52.3 % on the right and 43.5 % on the left), its bottom a 7 % `bar`
  (the footer); the woodland's top and bottom `design` (the leafy band, the
  coloured footer), its sides `art` between them (24.8–40.2 %).
- **P/T boxes:** MSE's own, cropped by the builder as the draconic's
  (`avatar/pt/<c>.png`, the framed parchment box at 1159, 1859, 270 × 141
  px; `bloomburrow/pt/<c>.png`, the box with its vine flourishes at 1038,
  1863, 445 × 131), ink measured (`plate-ink.ts`). Dark digits on them, as
  M15's.
- **Colourless.** The Avatar's colourless printings are artifacts (TLE
  #315 Arcane Signet, #316, #317) and wear the silver drawing MSE ships as
  `a` (within 1 level of the scans), so `c` is built from it — card, title
  bar and plate alike. The woodland has no colourless printing; its `c`
  keeps MSE's own.
- **Opt-ins** (ADDITIONS, opt-in per card; never a sweep):
  - the woodland's **crown** — the leaf crown MSE draws as
    `crown/<c>crown.png` above the title band (`BLOOMBURROW_CROWN`,
    `bloomburrowcrown/<key>.png`, git: 1500 × 301 from the top). The
    legendary printings (#304, #314, #327–336) wear it, and
    `showcase/blb/woodland` imports with it on (`CROWNED_SHOWCASE_SIGNATURES`).
    The Avatar has no crown switch: its ornate bar IS the printed bar;
  - the woodland's **stamp** — MSE's own notch: the well (its
    `border_stamp_mask.png`) in the footer's own tone under the rim
    (`stamp/<c>stamp.png`), cut to its box (`bloomburrowholostamp/<key>.png`,
    631, 1882, 240 × 82), our oval at the prints' hologram (687–814 ×
    1921–1986 on the stamped printings: 684, 1920, 134 × 67), the arch a
    rules keep-out (631–871 × 1882–1952). Every printing of the run is
    rare or mythic, so "auto" is M15's rule. Every Avatar print is
    oval-stamped on its black footer, but `avatar` declares no `holoStamp`
    slot yet, so an import's `printed_stamp: "oval"` draws nothing — a
    follow-up addition (TODO 4.11);
  - the **collector line** on both (`M15_COLLECTOR`), on the footers.
- **Flagged, not changed** (TODO 4.11):
  - the Avatar's bender medallion at the type bar's left end shows the
    card's own element on print (water, earth, fire, air); MSE draws one
    fixed symbol per colour, and so do our masters;
  - MSE's Avatar P/T box is ~8 px wider than print's;
  - the two-colour dresses split the frame field left / right (BLB
    #327–330 / #333–336; TLA #348, #351) — they import `nearest` with the
    `two-colour` gap, on the gold master, until they ship;
  - the woodland's `c` has no print to measure against.

### The Bloomburrow anime showcase (4.11 / 4.35, layout v70)

`bloomanime` (BLB #343–355, the thirteen raised-foil legends: twelve
creatures and #353 Ral, a walker, which stays out of scope — a walker lands
on a walker frame) came out after Card Conjurer's last pack, so it stays on
Magic Set Editor's style (`magic-m15-showcase-bloomburrow-borderless-anime`).
A CORRECTION (layout v70, a sweep scoped to the one template,
`ANIME_LAYOUT_VERSION`; taken after #615's v69, and a test refuses it
while v69 has no rollout): no colour is ticked. Measured 2026-10-27 on all
thirteen printings (Scryfall PNGs at 1500 × 2100, ≥ 250 ms apart).
**These scans are photographs of raised foil:** the crop wanders 0–12 px,
so every scan is registered on MSE's stroke shapes region by region (the
corners, the name and type rows, the footer; the best of ±30 px by the
darkest mean under the strokes) and every number is a median; sheet: the
owner's design-backup `mse-showcase/bloomanime-sheet.jpg`.

- **One master for every key.** MSE's style is a RECOLOUR template: its
  strokes (`card.png`, the P/T dress's `nonptpt.png`) are flat red that MSE
  recolours per card colour at render, and its name and text boxes
  (`namebox.png`, `textbox_pt.png`) are `set_alpha(recolor_image(…), 70 %)`.
  Print wears ONE look on every colour — the run is two-colour legends, all
  on the same frame — so the builder bakes one master (`layered` in
  `scripts/build-showcase-frames.mjs`, the numbers in
  `scripts/lib/mse-showcase-borders.mjs` `ANIME_*`), every key the same
  bytes, in MSE's z order:
  - the **boxes** at print's opacity, from pairs of pixels 7 px inside and
    outside every box edge (strokes masked off), fitted inside = (1 − α) ·
    outside + α · C per channel over the twelve creatures: the name box α
    0.78 over 45,50,52 (a slate, lighter than MSE's 70 % black), the type /
    text box α 0.80 over 39,40,35;
  - the **footer** through MSE's `border_pt_mask.png`, OVER the boxes, in
    print's own tone 15,20,16 (the median of the twelve footers; 20 levels
    off black on green where the same BLB scans read 0,0,0 on the regular
    black borders — print's tone, as the woodland's black) and kept to the
    card corner (`keepCorners`: the footer is the card's edge there);
  - the **strokes** in ONE flat tone, 35,31,12: the raw median of every
    stroke's core (2 px eroded) over 75 registered regions, 531,750 px
    (owner 2026-10-27: one flat tone; print's raised foil runs 15–98 per
    region) — with print's **copper rim** (owner 2026-10-27: add it,
    `ANIME_RIM`, `copperRimLayer`): a copper edge on the strokes' UPPER
    edges only (outward normal within ~37° of straight up — the share of
    copper pixels per 15° bin is 0.41–0.55 within ±15°, 0.25–0.46 at ±30°,
    0.13–0.26 at ±45°, the background's 0.03–0.09 past 60°), straddling
    MSE's stroke edge: one ring inside and one outside fully, a half ring
    past it (print's copper share peaks on the edge's first rings, 0.51
    inside / 0.55 outside, and fades by the third; a 2 + 3 ring rim read
    heavier than print's on the sheet), full strength to 30° from up,
    fading to none at 50°, in 180,103,59 — the median of the copper pixels
    of those rings within ±45° (68,570 px). The strokes' core stays
    35,31,12 (the rings past the rim read 34–38, 29–33, 9–16). The P/T
    outline, the crown and the stamp's arch wear the same rim.
  Every print has a P/T, so the master is MSE's P/T dress: the text box's
  tab under the P/T and the shorter right stroke; the P/T box's outline
  (`pt.png`, with the rim) is the plate (`bloomanime/pt/<key>.png`,
  1157, 1846, 254 × 151). A card with no P/T keeps the tab without the outline (no print to
  match).
- **Full bleed.** The art runs under the whole card (`artSlot` 0 / 0 / 100
  × 100; it was inset 2.5 / 3.5 / 93 × 92 over a #101015 ring). The edge
  contract is print's: art on the top and sides but where the strokes touch
  them (the top corners' flourishes, the sides at the name box and the type
  line), the footer a bar at least 108 px deep that also climbs both sides
  from 75.2 %. It left the edge contract's, the art-window check's and
  `BORDER_PENDING_TEMPLATES`'s lists (`BORDER_PENDING_TEMPLATES` is empty
  now) and `SQUARE_CORNERS` (no ring is left: its art covers every corner).
  As a full-bleed frame it is art-first (`artFillsCard`: the picker tile's
  sample art by rule, no longer `pickerSampleArt`), Etched is hidden, and
  an import lands on the standard frame with the anime offered (1.18:
  Scryfall's art_crop is the classic window).
- **Its own layout on M15's slots** at the M15-era family's sizes (`fit:
  "measured"`, joined WITH v70), each measured on the twelve creatures
  against our bakes of the same cards:
  - the name: baseline 164 px (25 above M15's: the band's rect moves),
    its pen at 125 (6 px left);
  - the cost row: the CC M15 70 px disc on print's row — centred on 139.5
    (8 px under the band's lift), ending at 1389 (4.5 px right);
  - the type line: the CC M15 baseline (print's 1261, ours 1260), its pen
    at 127 (4 px left);
  - the rules: 125–1372.5 × 1320–1882 px — lines from 128.5, the widest
    to ~1362–1366 on print (BLB #352, #344: the box's right stroke at
    1387–1395, ~17 px of margin inside it), so the rect ends where M15's
    does; centred on 1601.5 (MSE's rect centres them 14 px lower); M15's
    padding, white. Print's rules glyphs run ~3 % wider than ours at the
    same 76 px size (the same 74 px pitch), so a long text breaks a word
    earlier there (BLB #344's second line ends "sorcery", ours "sorcery
    spell,");
  - the P/T: MSE's text rect 6 px left and 12 px down, the digits on
    print's (1282, 1930), white;
  - name and type ink white, no shadow; no scrim any more (the boxes are
    the master's).
- **Opt-ins** (ADDITIONS, opt-in per card):
  - the **crown** — MSE's `crown.png`, the small flourish above the name
    box, in the strokes' tone (`BLOOMANIME_CROWN`, 646, 16, 209 × 64). All
    twelve creatures are legendary and print it, so `showcase/blb/anime`
    imports with it on (`CROWNED_SHOWCASE_SIGNATURES`; Ral, the walker,
    names none) — but ONLY on the anime frame
    (`printed_crown_frames`, `OWN_FRAME_CROWN_SIGNATURES`): the import lands
    on the standard frame (1.18), where the printing wears no standard
    crown, so the switch is off there and on when the card is switched to
    the anime (the chooser's tile too);
  - the **stamp** — MSE's own notch, the footer's tone through
    `border_stamp_mask.png` under `stamp.png`'s arch in the strokes' tone
    (`bloomanimeholostamp/<key>.png`, 494, 1882, 540 × 58), our oval at
    the prints' hologram (684, 1920, 134 × 67; print's within 3 px). Every
    print is rare or mythic: "auto" is M15's rule;
  - the **collector line** (`M15_COLLECTOR`): print's rows within 3 px of
    M15's, its pen ~5 px left.
- **Flagged, not changed** (TODO 4.11):
  - the P/T digits print ~25 px wider than ours at the same height, and
    the rules glyphs ~3 % wider (a word breaks earlier on print);
  - #353 Ral, the walker, stays out of scope.

### The Zendikar Rising hedron showcase (4.11, layout v63)

TODO 4.11, wave 1 (owner-approved 2026-10-22). `fullart` is the Zendikar
Rising showcase (ZNR #290–313) — the key is history; the frame is not full
art. Until v63 its masters were MSE's `zendikar` drawing at 375 px, upscaled
4× into git and missing MSE's hedron `back` layer, and its type line printed
at 73.6 %H, inside the box, under an empty painted bar. A CORRECTION: one
template-scoped bump (`ZNR_HEDRON_LAYOUT_VERSION`, `"sweep"`), no badge; no
colour of the frame is ticked, so no tick goes stale. The owner counts the
stored cards on it before the sweep (production can't be read from here).

- **Masters** — Card Conjurer's 'Zendikar Rising' pack
  (packZendikarRising, 1500 native, no resample; the frames bucket
  only; `scripts/lib/cc-frames.mjs` ZNR_* block): each colour's frame whole
  with its title pill's ends at CC's bounds on top, w u b r g m and the
  see-through 'Colorless Frame' as `c` (not 'Colorless Frame (2)', whose one
  difference is a see-through notch). The pack's artifact and land frames
  are not imported: no ZNR showcase printing is colourless, and the
  template keeps the MSE masters' seven keys (a colourless artifact draws
  `c`). The art runs under the whole frame on every key — the window, the
  strip above the title bar and the box's V are see-through — so the art
  slot is CC's art bounds with the art-window check's spare (58.5–1441.5 ×
  58.8–1877.4 px), no `underFrameArt`.
- **The stamp notch, split off.** CC paints the box's bottom rim arched over
  a hologram oval on EVERY key; the prints arch it only on a rare or mythic
  and run it straight on a common or uncommon. So the importer writes each
  master PLAIN (`ZNR_NOTCH`, `splitZnrNotch`): under the arch every column
  is the straight bar's beside it, and the hedron texture the arch hid is
  filled ALONG ITS OWN RIDGES — the box's lines run parallel to the V's
  edges, so a pixel left of the centre takes the one 64 px up and to the
  left, one right of it the one up and to the right (`srcDiag`) —
  cross-faded over 6 rows above and the centre's 16 columns (owner
  2026-10-22: the first cut, a horizontal copy 192 px out, left a soft
  rounded mound under the V's tip). The pixels that differ are the notch
  piece, `fullart/holostamp/<key>.png` (220 × 125 at 640, 1880, 1:1), its
  oval (685–814 × 1927–1990, every key) cut clear with 2 px; drawn over the
  plain master it gives CC's pixels back exactly outside the cut — the
  importer records the sha256 of CC's master so drawn (corners cut, the oval
  cleared) per key in `lib/cards/frame-sources.json`, and a unit test holds
  the PUBLISHED pair to it (`restoredZnrMaster`). The
  profile declares it as the `holoStamp` overlay (`ZNR_HOLO_STAMP`, oval
  `ZNR_HOLO_STAMP_OVAL`, keep-out from the bevel's top at 1895 px), so
  `"auto"` stamps a rare or mythic as ZNR does, with our oval art.
- **The crown** — the pack's crown (the title pill's two ends drawn bigger,
  with their hedron points) at CC's bounds over a clear canvas, 1:1, rows
  0–299: the band `fullartcrown/<key>` (`ZNR_CROWN_BAND`, the overlay
  `ZNR_CROWN`). It covers the title piece's ends whole, as CC draws it.
  Keys: w u b r g m c and the ten pairs — the first colour's end left, the
  second's right, over the gold master (`pairCrownOnGold`), as #313
  Phylath prints R|G. An ADDITION on this frame: opt-in per card, like
  every crown — and an import follows the print (owner 2026-10-22): the
  legendary printings (#300, #312, #313: Scryfall's `legendary` effect)
  import with the crown ON, `showcase/znr/hedron` being one of
  `CROWNED_SHOWCASE_SIGNATURES` (`lib/scryfall/import-mapper.ts`) beside
  the THB constellation and the LOTR scroll.
- **Geometry, measured on ZNR #290–313** (Scryfall PNGs at 1500 × 2100,
  ≥ 250 ms apart; every text registered on its own bar's outline, as the
  cost-row read does). CC's bars sit on the M15 pack's rows (title outline
  101.5 / 219.5 px, type 1182.5 / 1300.5); the prints' title bar sits
  4.3 px higher and their type bar 1.8 px higher in their PNGs — inside the
  wander of a Scryfall scan — so the masters are CC's as drawn, and the
  slots are the CC-framed M15 profile's: name (within 1.1 px of the prints
  on its bar), rules box, set symbol box, plate bounds. Three differ: the
  type line takes the 2014–22 prints' baseline (`ZNR_TYPE_DY`: 5.6 px below
  the current-print M15 slot; median of five prints); the cost row is
  ZNR's (`ZNR_COST`: 70 px discs, 78 pitch, centres 6.7 px above the
  bar's middle — 153.6 px — and the last disc's centre 56.3 px left of the
  pill's outline, 1351.2 px: 3 px above and 1.7 px right of the v61 row;
  the MSE master drew 72.75 px discs at 165.2); and the set symbol wears the
  prints' white keyline (`setSymbolKeyline`). Checked on our bakes of the
  24 against the prints: name 1.1 px, type line 1 px, discs 0.5 px, P/T
  digits 2 px.
- **Ink.** The name and the type line BLACK on the white key's ivory bars
  (#290–294, no shadow) and white with `SHOWCASE_SHADOW` on every other
  key (the gold bars of #311–313 too); the rules white on every key; the
  P/T black on the light plates (w, m — #311–313's cream gold plate — and
  c) and white on u b r g.
- **Plates** — the pack's own for w, b, m and c and the 'Nickname' pack's
  for u, r and g, as the pack lists them (282 × 154, at M15's plate
  bounds); their ink row in `lib/cards/plate-ink.ts`.
- **Collector line** — the 2015 style where M15 prints it (#293, #313: the
  lines at 1994 / 2033 px from x 95): `M15_COLLECTOR`, opt-in per card.
- **Import.** `showcase/znr/hedron` already names `fullart` exact: it is
  `nearest`, "not yet verified", until the owner ticks a colour, then exact
  (`withVerification`). #305 Kazandu Mammoth, the one modal printing, keeps
  its landing on the modal front body (the showcase frame dresses no modal
  kind).
- **Gone from the repo:** the git masters under public/frames and their recipe in
  `scripts/build-variation-frames.mjs`, and its row on Phase B's
  allow-list (`CORNER_NORMALISE_TEMPLATES`).
- **Not built:** the pair masters (a two-colour card draws the gold master,
  as before; #313 Phylath's corner pieces print its two colours), the
  modal front's flipside strip and ◀ (#305 lands on the modal body), the
  artifact and land dresses.

### The older full-art basics (4.40 / 4.41)

Three black-bordered full-art basic designs older than the 2022 one
(`m15fullartland`), each a STORED template of its own in the Full Art set
(an M15 treatment in the picker, #556), basic lands only
(`BASIC_ONLY_TEMPLATES`, the kind gate's rule for every full-art basic):

| Template | The look | Printings it reproduces | Nearest only |
|---|---|---|---|
| `m15fullartlandzen` | a brown stone ring round the window, the title bar, "Basic Land" left of a centred medallion and the subtype right of it | BFZ, OGW (the Wastes), AKH, HOU — 37 | ZNR's type line (15), MH1's snow bars, ZEN / J14 on the 2003 frame |
| `m15fullartlandsnc` | the same bars and medallion over the art, a white ring round the window, no stone | SNC — 10 | BRO (no ring, the bars ~80 px lower), MID / VOW (dark bars) |
| `m15fullartlandthb` | the title bar and a plain "Basic Land — Plains" bar, no symbol | THB, 2XM, DMU, SPM, SOS, PLG25 — 31 | — |

Measured on print FIRST (Scryfall PNGs at 1500 × 2100, every printing of
each look, 2026-10-14), then the pack:

- **ZEN.** The pack's title bar (104 / 232 px vs the prints' medians 104 /
  233), window (112 / 1386 vs 115 / 1387), medallion (1640 / 1917 vs 1640 /
  1918) and border (1948 vs 1947) are the prints'; its TYPE BAR is 7 px
  high on every printing (inner top 1716 vs 1723, range 1721–1729; bottom
  1845 vs 1851). The pack paints each colour's own frame texture round the
  window where every print wears the same brown stone, which is the pack's
  own 'Colorless Frame' (`l.png`): every key lays it over the field through
  the pack's Frame mask. `ZEN_BASIC_RECUT` moves the bar (and the mask with
  it, so the stone keeps its own pixels) and draws the medallion back over
  it (`recutBarAndMedallion`, `scripts/lib/cc-frames.mjs`). On the re-cut
  master BFZ's bar edges sit within 1 px; AKH / HOU / ZNR print 3–4 px
  lower still (a set-to-set offset; the type line follows BFZ's). ZNR
  also sets its SUBTYPE 22–28 px further right than BFZ / AKH / HOU / OGW
  do — on every ZNR printing measured (#266, #267, #270, #273, #276, #279;
  the independent check of #571), not one printing's quirk, and its bars
  and name 3–5 px off — so ZNR is this frame's NEAREST (owner Round 64):
  `fullart/basic/split-bar+znr-type-line`, the `znr-type-line` gap, before
  and after the frame is verified; its printings are no references.
- **SNC.** The pack draws the bar 13 px and the medallion 18 px low (bar
  rim 1711 vs 1698–1701, medallion top 1636 vs 1616–1617), and the art's
  lower edge 13–17 px low: `SNC_BASIC_RECUT` moves the band down to the
  border's black, clears the medallion's old cap to the art and draws it
  back 18 px up. The re-cut master matches SNC #272–281 within 1–2 px. The
  subtype centres 9 px left of the pack's box (`rightRect` from 57.4 %).
- **THB.** The pack is the prints' within 1–3 px (bar 1778 / 1906 vs 1779 /
  1906); no re-cut. Its basic-symbol slot is `"none"`: nothing is drawn
  and no watermark lands on the art.

The medallion's symbol is the ZEN pack's `s?.svg` (both split-bar packs
name it), published as `<template>/symbol/<key>.png` (bucket only) and
drawn in a 228 px box 10 px above CC's centre (`SPLIT_BAR_SYMBOL_RECT`:
CC's 240 px box drew it 6–13 % larger and ~10 px lower than BFZ / SNC
print it). The WHITE sun is PipGlyph's own shading of CC's shape (owner
Round 64; `WHITE_MEDALLION_SYMBOL`, `shadeWhiteMedallionSymbol`): CC's is
white with a lavender rim, faint on the cream medallion, where BFZ #250,
AKH #250, MH1 #250, SNC #272 and BRO #278 print a cream sun set off by a
dark shadow down and to the left — its alpha kept, repainted 246,244,234
over a shadow of the shape (5 px down, 3 px left, softened) in 38,30,24;
bucket only, `design-backup/fullart-basics/plains-medallion.png`. The type line is 3.24's split (`type.split`): one size for both
halves, cut at the em dash; a Wastes prints "Basic Land" alone.

**Imports** (`lib/scryfall/frame-signatures.ts`): each printing lands on
`m15fullartland` as before until its own template is verified in the
card's colour, then on it (`onceVerified`): exact for the looks above
(`fullart/basic/split-bar`, `…/split-bar/ring`, `fullart/basic/plain-bar`),
nearest for the ones it only comes closest to (`…/split-bar+znr-type-line`,
`…/split-bar/snow`, `…/bro`, `…/dark`, `…/split-bar/2003`). No other
full-art basic moves: of all 680 full-art and borderless basics, 158 move
once everything is verified — 78 exact (the stone ring 37: BFZ 25, OGW 2,
AKH 5, HOU 5; SNC 10; the plain bar 31) and 80 nearest (ZNR 15, MH1 5,
BRO 10, MID / VOW 25, ZEN / J14 25).

**Rollout.** ADDITIONS: no stored card sits on them, so no layout bump, no
sweep and no badge; their visual cases are new. The owner verifies each
colour (references: `lib/cards/frame-references.json`); `m` is never
verified (no multicolour basic), nor `c` on the SNC and plain-bar frames
(no such Wastes was printed).

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
  showcase — but the THB constellation showcase, which prints the standard
  crown and imports with it on ([The constellation
  crown](#the-constellation-crown)) — and absent for a nonlegendary
  printing, a showcase one included
  (owner 2026-09-30); `printed_two_color` is `true` (with
  its pair) for a 2015-frame printing of exactly two colours — and, since
  4.6h, for an old-frame printing that prints them
  ([above](#two-colours-on-the-old-frames-46h)) — else absent, never
  `false`. A switch the printing doesn't name takes the new-card
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
  on a land frame (`twoColorFits`: m15land, m15snowland, the borderless
  land and, since 4.6h, modernland and retroland — `twoColorForLands`). A two-colour
  land stored with no template draws on m15, whose gold-split isn't a
  land's (Shadowwood Hollow, Sunfade Citadel): the switch is hidden there,
  the save drops it and the renderers don't draw it (owner round 17).
- **The crown's two controls are one state** (TODO 3b.17). The Card step's
  Variations section leads its frame chips with a **Legendary** chip — "the
  legendary crown version of the selected frame" — and the Identity step
  keeps the
  "Legendary crown" switch. Both write `frame_style.crown` through the form
  (never `frame_style.template`), and both read ONE rule,
  `legendaryVariationOf` (`lib/creator/legendary-variation.ts`):
  - **offered** when the card's OWN template declares a crown (the front
    body of a double-faced card — the template the save's
    `normalizeAnatomy` judges) and a face would draw it: the card type
    prints one, and the key it would paint is published (`crownKeyFor`). A
    double-faced card's back counts on the body its type and family derive.
    Anywhere else the chip is **disabled with its reason** ("This frame
    has no legendary crown"), as the section's other unavailable chips
    are — where the section shows at all: it shows only when it has
    something to pick (a land mode, a frame chip, or the offered chip —
    owner 2026-10-12), so a kind whose section would hold only the dead
    chip (emblem, saga, adventure, aftermath, flip) has none, as before;
  - **selected** only while the switch is exactly `true` AND a face has the
    word "Legendary" — the crown is drawn. A new card that is not legendary
    holds the new-card default (`crown: true`) and still reads unselected;
  - **the switch's row** shows when the chip is offered and a face has the
    word, and its on/off is then the chip's;
  - **the word:** picking the chip on a NEW card with no legendary face
    puts "Legendary" first in the supertype (`withLegendaryWord`) and a
    toast says so; un-picking keeps the word (a legendary card without the
    crown is every pre-2018 print). An edit or a remix has no Card step, a
    locked type line (`lib/creator/revise.ts`) and NO chip (owner
    2026-10-12): the switch is the one control there. Where the switch
    can't show on a frame that prints the crown — the stored card is not
    legendary — the Identity step says so in one line ("Only a card created
    as Legendary prints the crown — rewording the type line here changes the
    printed words only": since 3b.16 an edit can reword the PRINTED line, and
    typing "Legendary" there does not make the card legendary,
    `LegendaryCrownReason`); the word is never written on an edit.
  A frame change never clears the switch in the form: a move to a frame
  with no crown and back restores it; only the save drops it. Imports and
  AI jobs are untouched (the printing; the save's default).
  The creator's live preview draws the crown the save keeps: it reads the
  form's style through `previewFrameStyleOf`, which leaves out a crown
  switch the card's own template drops — the one card that changes is a
  modal LAND front with a legendary nonland back (`m15mdfclandfront` draws
  no crown, its back's body `m15mdfcback` does, and a new card's switch
  starts on), whose preview drew a crown the saved image never had.
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
  text box 45→57, crown 45→55 %W, the floating crown 40→60, the borderless
  land's pinline and box 39→61)
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
one showcase that prints it, the Theros constellation frame, draws the Nyx
crown band with faded arms — [The constellation
crown](#the-constellation-crown); the
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
`legendary` + `etched`) — except the showcases that print the standard
crown (`CROWNED_SHOWCASE_SIGNATURES`: the THB constellation frame), which
follow their `legendary` effect like any 2015-frame printing; not named for a nonlegendary printing, a showcase
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
  extended art (its crown band draws no pairs: wave 2b) — keeps the
  `two-colour` gaps, now pointing at 4.6f (the borderless frames draw theirs
  since wave 2a, the snow frames since wave 2c, the borderless land since
  4.56, below; devoid's two-colour printings ARE its gold frame, so the gap
  is no gap there); an M20 token's gaps point at 4.48 (its own central rim
  split and pill crown).
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
- **With the stamp** (the 4.9c follow-up): a two-colour rare drawn as its
  pair master takes the pair's notch `m15holostamp/<pair>`, its rim the
  pair master's own bar read per column across the pinline ramp ([The
  holofoil stamp](#the-holofoil-stamp-49c)) — on every dress and template
  that has the notch, the snow pairs included; drawn gold it takes the
  gold notch.
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

#### The borderless land's pairs (4.56)

m15borderlessland draws a two-colour land the way the prints do — the
colourless land's grey bars over a pinline AND a text box split between the
two colours (Deserted Beach MID #281, Spirebluff Canal OTJ #304, the RVR
shock lands, the MKM surveil lands) — from ten pair masters `<pair>.png`
(`twoColorMasters: ["split"]`, `twoColorForLands`), through the same
switch, hints, import rule and registry gap as m15land. Opt-in per card: a
stored card on the frame's gold `m` master keeps it until its owner
switches the two-colour frame on (the 21 production cards on the frame on
2026-10-06 — six with a colour pair, none with the switch — bake
byte-identical at 750 and HD before and after); a NEW two-colour borderless
land starts on its pair, with the off switch. No bump, no sweep, no badge.

- **The recipe** is the mono masters' function with a letter pair
  (`borderlessLandLayers({ frame: "l", box: [x, y], pinline: [x, y] })`,
  `scripts/lib/cc-frames.mjs`): the grey 'Land Frame', its title bar pasted
  on the type row, the box structure re-tinted to each colour's own box tint
  (the mono masters' tints, sampled at the same point) and the two lerped
  across the ramp, then the two colours' frames lerped across the same ramp
  through the pack's Pinline mask. Nothing is a new source: eleven files of
  the pinned commit; the seven mono masters rebuild byte-identical and a
  fresh cache reproduces the ten pairs byte for byte.
- **One ramp, 39→61 %W** (`PAIR_RAMPS.borderlessLand`), for the pinline and
  the box. Measured on the 110 prints of the tinted look that register
  within 12 px (of 119), each ring's own left-end and right-end colours
  taken as 0 and 1: the four rings cross 10 / 50 / 90 % at 41.3 / 50.2 /
  58.9 %W (the median of 420 rings; their mean 41.2 / 50.0 / 58.8; the
  2023+ digital renders alone 41.3 / 50.2 / 58.9) and the box's text-free
  top band at 40.9 / 49.8 / 59.0 (the median profile of 102 boxes). The same reading of a 40→60 master gives 42.0 /
  50.0 / 58.0 exactly, and of the borderless spells FDN #344 / #345 42.5 /
  51.5 / 59.0 and 41.8 / 50.5 / 58.4 — so the land's split is a little
  wider than the spells' pinline, and its box splits where its pinline
  does, not on the bordered frames' narrower 45→57. The built masters read
  41.2 / 50.0 / 58.8 on every ring and on the box. Per pair the prints'
  middle crossing is 48.2–48.7 on W|B, U|B and U|R and 50.0–51.1 on the
  other seven: a blend that is not straight in sRGB, not a moved ramp — one
  symmetric ramp serves all ten, as on every other pair master (the
  owner's decision too, 2026-10-07: one centred split).
  **Re-measured by the skeptic (2026-10-07)** on its own regions, a
  least-squares ramp fitted to every ring (Scryfall's digital renders from
  LCI on are 256-colour images: a threshold reads the palette's steps, a
  fit does not): 71 digital renders, 284 rings, 39.05 → 61.05 %W — width
  22.0, interquartile 21.7–22.2, every set from CMM to DFT within
  21.8–22.3; 252 of the 284 fit 39→61 better than 40→60; the same fit
  returns 39.0 → 61.0 on the built masters, 40.0 → 60.0 on a 40→60 control
  and a width of 19.0 %W (17.4–20.9) on the type rings of FDN's nine
  borderless SPELLS (#343–351; the two uncrowned ones, #344 / #345, read
  19.9–21.1 on all four rings), so the land's wider split is no noise. The
  70 boxes' median profile fits 38.5 → 61.05 (rms 0.011 against 39→61,
  0.023 against 40→60, 0.095 against the bordered box's 45→57). The three
  pairs that cross left of centre are no moved ramp: on all ten the
  gradient STARTS and ENDS in the same place (its 3 % point at 38.7–39.8
  %W, its 97 % point at 60.0–61.2), the three
  channels of ONE ring cross up to 3 %W apart (U|R: red at 47.3, blue at
  50.2 — no shifted mask does that), and read in linear light the centres
  scatter over 8 %W with which side is the darker colour (45.9–54.0) where
  sRGB keeps all ten within 2.8: the prints blend close to an sRGB lerp,
  bent a little by their colour pipeline. (Scans of physical cards — MID,
  VOW, 2X2, DMU — read the same start and end, 39.2 / 61.0, with a steeper
  middle: width 19.7–20.7 fitted.)
- **The bars are the colourless land's grey**, never gold and never a
  blend: on the prints the title bar reads α 0.71 (Card Conjurer's 0.70)
  and, at CC's α, a tint of 148 / 142 / 136 (141 / 135 / 130 on the digital
  renders) — the mono colourless borderless lands' 145 / 137 / 137, about
  ten levels under Card Conjurer's 'Land Frame' 156 / 151 / 144 as the mono
  `c` master is against its own prints, and nowhere near the gold land's
  114 / 91 / 29.
- **The box halves are the mono boxes'.** Where one set prints both, a
  half reads what that colour's own borderless land does: over the same
  art, the two-colour prints' white half predicts Monumental Henge MH3
  #354's box within 3 levels (121 / 117 / 93 read, 121 / 117 / 95
  predicted) and their red half Arena of Glory MH3 #351's within 10 (159 /
  63 / 49 read, 151 / 64 / 59) — so the pairs take the mono masters' tints
  through the same function. Those are Card Conjurer's, a little brighter
  and more see-through than the prints: white reads α 0.84 at 124 / 120 /
  108 on the prints (the master 0.75 at 166 / 155 / 133), blue 0.83 at 15 /
  103 / 168 (0 / 117 / 190), black 0.73 at 50 / 49 / 48 (39 / 38 / 36), red
  0.83 at 149 / 40 / 34 (130 / 22 / 14), green 0.79 at 40 / 84 / 66 (0 /
  81 / 65). The owner chose NOT to re-tone them (2026-10-07: the
  boxes stay as built, now and later — not a planned item). (The skeptic's read, on other
  regions with its own calibration, 95 digital renders: white 0.83 at 119 /
  116 / 102, blue 0.85 at 5 / 101 / 160, black 0.73 at 41 / 40 / 38, red
  0.82 at 147 / 38 / 28, green 0.83 at 34 / 79 / 59; colourless 0.76 at
  140 / 137 / 129 and gold 0.79 at 136 / 121 / 81 against the masters' 156 /
  151 / 144 and 173 / 136 / 52. Over the prints' own art that is a built
  white half 20–32 levels brighter than the printed one, a gold box 27
  brighter in red and 22 lower in blue, a red half 18 darker in red, a
  green one 24 lower in red, a colourless one 11 brighter; blue within 13,
  black within 2. Where the ramp is 0 or 1 a pair's box IS its mono
  master's, pixel for pixel — 0 of 296,201 differ on either half of all
  ten.)
- **No gold or mismatched hairline.** Every pair's rings (≈ 91,000 px) are
  the lerp of its two mono masters within 4 levels where neither colour is
  black; with black, within 17 levels on at most 75 px at the bar caps (the
  black frame's outline is dark grey where the others are black), no row or
  column holding more than 16 of them; the box is the lerp of the two mono
  boxes within 1 level (0.1 on average); at most 77 px of a master are
  explained by neither (recomputed by the skeptic: the same numbers on
  that ring; counting every opaque pixel that differs between the masters,
  the outline's anti-aliased edge included, 106 px at most over 8 levels,
  26 in one column at a bar cap, never two in a row, 17 the worst — and
  each is a mix of the grey master and the lerp, none a third colour). The
  grey frame is used whole, so Card Conjurer's
  gold frame — whose type-bar and box rings sit one row higher than the
  colour frames' (wave 2a's 1 px gold line) — is never in the stack.
- **No crown, no stamp notch, no collector line**: the frame declares none
  (and the creator offers none there: the two-colour switch alone).
  A crowned or nicknamed two-colour print stays `nearest` on those gaps.
  No printed land carries P/T; a custom land with a Vehicle or Spacecraft
  subtype prints its P/T on m15borderless's plate in its colour key — the
  gold `m` for a pair, over the grey bars (`plateKeyFor`, as m15land's
  pairs do; the grey plate the hybrid dress takes would match them — an
  open detail, no print to follow).
- **Which prints.** Of the 192 two-colour borderless nonbasic lands
  (Scryfall 2026-10-06; 702 borderless nonbasic lands in all), 119 print
  this look and resolve `exact` — MID, VOW, 2X2, DMU, BRO, ONE, CMM, LCI,
  RVR, MKM, CLU, OTJ, DSK, DFT, MH3's five fetch lands (a fetch land prints
  the two colours it searches for, m15land's rule) and 14 SLD:
  `gapDrawnBy` drops the `two-colour` gap where the landing frame draws the
  pair, no new gate. The other 73 stay `nearest`: 25 on the short box (UNF
  #277–286 / #528–537, SLD #456–460), 10 on the dark type bar and box (ACR,
  WOE), 31 on the see-through shadow box (SPG #109–118, ECL #347–351, SOS
  #301–305, MSH #380–384, SLD #2440, FRA #397–401 — the 2025 look: the
  land's own bars and split pinline over a box that only shades the art
  behind the text; gap `shadow-box`, 4.37) and 7 on a crown or a nickname
  bar (LTR #343 / #754, HOC #50 / #90; LTC #366 / #396 / #396z). The art
  still lands an import on m15land (1.18), which draws its own pair;
  choosing Borderless Land in the import's frame chooser keeps the pair and
  the switch, and draws the pair master — and the chooser's tiles show it:
  a tile paints what the import stores on that frame (`ImportFrameChooser`
  `printing`, `importedAnatomy`), where a two-colour printing's tiles were
  the gold master on every pair frame since 4.6b, whichever was picked
  (skeptic pass). Nothing but the pin lists keeps the other 73 `nearest`
  now that the gap is closed, so the census is a fixture:
  `tests/unit/scryfall/fixtures/borderless-land-census.json` holds all 192
  and the 46 other pinned printings as Scryfall listed them on 2026-10-07,
  each with the look read on its scan, and
  `borderless-land-census.test.ts` holds the registry and the four lists
  to it both ways (ten of the 31 shadow-box pins — MSH's and SOS's — could
  be deleted with every test green before it).
- **References:** two prints per pair on the frame's entry
  (`frame-references.json` `pairs`, `framePairReferenceOptions`) — the
  pair's MKM surveil land, then Deserted Beach MID #281, an OTJ fast land
  (Spirebluff Canal #304 among them) or a DSK verge; every one resolves
  `exact`. The nineteen digital renders register to the frame within 2 px
  (the DSK verges within 4); Deserted Beach MID #281, the item's own
  headline print, is a scan of a physical card whose frame sits 6–20 px
  left of the master's and whose split reads 39.6 / 47.0 / 56.0 — judge its
  bars and box, not where its split falls. The pairs ride the `m`
  tick (V-A), so they feed no checklist row; the compare page's pair strip
  is 4.6g.
- **Tests:** `tests/unit/frames/borderless-land-pair-masters.test.ts` (the
  recipe, the manifest, each master's pixels against its two mono masters,
  the ramp's crossings), `tests/unit/render/borderless-land-pair-bake.test.tsx`
  (real bakes: the pair in the bake, the switch off or absent
  byte-identical, mono and three-colour lands untouched, the ramp at HD),
  `tests/unit/scryfall/frame-signatures.test.ts` (the pins and where each
  class of printing lands), `tests/unit/scryfall/borderless-land-census.test.ts`
  (every one of the 192 and every pin),
  `tests/unit/components/creator-import-borderless-land-pair.test.tsx` (the
  real chooser and creator form: the pick keeps the pair, the tiles show
  it, no `m` tick → not offered), the matrix's five
  `m15borderlessland/wu/…@pair*` cases.

#### The extended-art crown (4.6f, wave 2b)

`extendedart` draws the same floating crown as the borderless frames, as an
OVERLAY band rather than crowned twins (`EXTENDED_CROWN` on its `PROFILES`
entry: `extendedcrown/<key>.png`, 1500 × 260, keys `w u b r g m c`, and
since the 4.7 follow-up the ten pairs),
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
  it (the extendedart masters were MSE-built when the band was cut; since
  4.7 they are Card Conjurer's own extended frames — both in the bucket).
  The importer composites the three pieces 1:1 at
  1500 × 2100 (every piece 1500-native) and crops rows 0–259
  (`CC_OVERLAY_BANDS.extendedcrown`, the importer's generic `layers` /
  `findings` band: the outline's peak at row 36 ± 1 on the centre column,
  the cover strip opaque black in a crown dip, no alpha below the band).
- **The slot is CC's bounds, from row 0** (layout v58, TODO 4.7): the
  print's title bar (FDN #442 / #455) and CC's `m15/new/extended` top out
  at 4.98 %H, and since 4.7 the master IS CC's extended frame, so the
  crown's peak lands on the print's row 42 at 1500 × 2100. (Over the old
  MSE masters, whose bar topped out at 5.43 %H, it sat 10 px lower.) The
  band's bytes did not change.
- **Keys:** the template's seven colour keys; since the 4.7 follow-up
  (below) the ten pairs over the pair masters. A colourless card wears
  CC's grey C crown (PUMA U1), the artifact master included — the overlay
  is keyed by the card's colour, not the master painted (owner Round 67).
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

#### The extended-art and textless frames from Card Conjurer (4.7 / 4.35, v58)

Owner Q6 (2026-10-13): neither look was verified in any colour, so both left
their 744 / 375 px MSE masters in git for Card Conjurer's sharper packs
(frames bucket, `scripts/import-cc-frames.mjs --only
extendedart,m15textless,m15textlessland`). A CORRECTION of three looks
against their own prints: layout v58 (`CC_RESOURCE_LAYOUT_VERSION`), sweep,
never a badge.

- **Measured first** (Scryfall PNGs at 1500 × 2100, 2026-10-14; the median
  |ΔRGB| over each master's opaque pixels, and the vertical offset that
  minimises it):
  - extended art, 48 printings (WOE, TLA, CMR, NEC, MAT, EOE, NCC, MOC,
    TDC, KHM, CLB, SLD, MID, LCC, ECL, OTJ, BRO, BIG, MSC, AFC, ONC, M21,
    DFT, STX, CMM, MSH, SPM, MOM, ONE; every colour, gold, artifacts, lands,
    colourless, 11 legendary): the MSE masters 45.4 (best −10 px), CC's
    'Extended Art Frames' 14.2 (best 0 px). The prints run the art to the
    card's SIDE edges between the title bar and the type bar (0 px of black
    there, the median on 13 of 14 measured); the MSE masters painted white
    rails there, set the title bar 10 px low and ended the box 41 px high.
  - textless on the 2015 frame, 57 printings: the 38 black-bordered promos
    (SCH, PF19–PF27, PSPL, PLG24, PL22, SLD, SLP, FDN #718, HOB #249) —
    MSE 47.0, CC 'Magic Fest Promos' 18.5, CC 'Generic Showcase' textless
    32.5; the 19 borderless (TLA, TRK, MSH, SPM, FIN, SLD, EOE, and basics)
    — none fits (55–76): they are one-off designs with outlined pills, and
    keep landing `nearest` (`borderless/textless`).
- **`extendedart`:** each master is CC's whole extended file, downscaled
  once (no border added); `c` is the pack's see-through 'Eldrazi Frame'
  with the art under it as ONE picture (`EXTENDED_UNDER_FRAME_RECT`) and a
  colourless ARTIFACT paints the silver `a` (`artifactMasterKeys`). The
  slots are the m15 entry's (the pack's text layout is M15's), with CC's
  art window (`EXTENDED_ART_SLOT`, to the side edges), white type ink and
  the set symbol's keyline on the black type bar. Edge contract:
  `EXTENDED_ART_EDGES` (art on the sides from 11.3 to 59.2 %H). Its crown
  band is unchanged; its slot moved 10 px up onto CC's bounds.
- **`m15textless`, `m15textlessland`:** CC's 'Magic Fest Promos' whole
  (1500 × 2100, no resample): the black ring, a dark translucent title bar,
  the art to the bottom ring in a rim of the card's colour. `textless`
  (3.24): no type line, no rules, a white name; M15's plate and footer. The
  spell's `c` is the pack's silver rim (every colourless promo wears it),
  the land's the brown land rim. This is 4.42's look on the existing
  templates — not 4.35 (a)'s borderless re-source, which no print fits
  (an owner question on the PR).
- **`extendedartland` (owner Round 63, 2026-10-14):** the land dress, a
  template of its own as m15land is M15's — the pack's land frames whole:
  `c` = the grey 'Land Frame' `l`, w u b r g = `l<k>`, gold `m` = `lm` (the
  any-colour land). EXTENDEDART's slots with the land entry's differences
  (no cost, M15LAND's title band), no see-through or artifact master, the
  same crown band (a colourless legend wears the grey C crown). The kind
  gate splits the pair: `extendedart` dresses every kind its body draws but
  the land, `extendedartland` the land alone (`TREATMENT_KINDS`); the
  registry's `extendedart` rule names the `extended` family, which picks
  the land frame for a land. A land stored on `extendedart` before the
  split keeps it and stays editable. Measured on 32 extended-art land
  printings (median |ΔRGB| over the master's opaque pixels, at 0 px):
  colourless utility lands on `l` 3.3–5.3 (FDN #487, BLB #368, DFT #425,
  MSC #491, M3C #83; the MSE masters 51.7–54.0), mono lands on `l<k>`
  2.0–19.7 against the spell masters' 12.3–57.3 (NEO #501–505, ELD
  #386–389, MH2 #480, M3C #81; ELD #390 Castle Vantress prints the blue
  SPELL frame: 27.3 vs 12.3), any-colour lands on `lm` 10.3–19.0 (CMR
  #705, MSC #470, DMU #421, KHM #373; the grey `l` 20.7–30.7). A
  two-colour land (264 of the 409 single-faced extended-art land
  printings) prints the grey frame with a split box in its two land tints
  (MSC #468 / #477 / #489 / #499, STX #360, THB #348, CMR #709, M21 #390,
  SOC #101; grey `l` 17.0–42.0, gold `lm` 27.0–64.0) — the pair masters
  came in the follow-up below. Fetch lands print the colours they fetch
  (MH3 #464).
- **Not built (follow-ups, owner Round 63):** the Vehicle's `v` (4.27a
  step 2 builds on `extendedFrameFile`), the collector line and the stamp
  notch. The pair masters and the textless crown are the next section.

#### Two-colour extended art and the textless crown (4.7 / 4.35 follow-ups)

Owner Rounds 63 and 67 (2026-10-14). ADDITIONS, opt-in per card: no layout bump,
no sweep, no badge. A stored card keeps its look — every save dropped the
`twoColor` key on these frames while they drew no pairs and the `crown`
key on the textless pair while it drew none (`normalizeAnatomy`), so a
stored card reads as off; production holds no card on extended art or the
textless pair (owner SQL 2026-10-14) and neither is ticked.

- **Measured first** (Scryfall PNGs at 1500 × 2100, the median |ΔRGB| over
  the candidate master's opaque, non-black pixels, the best vertical offset
  within ±6 px):
  - 20 gold-split extended-art spells, two per pair (SOS #353 / #357 /
    #358 / #359, FRC #96, FDN #476–483, OTJ #348 / #366 / #367, WOE #360,
    MKM #413, SOC #98, DSC #65, WOC #39): the pair master 10.0–22.7 against
    the gold frame's 15.3–38.0 — lower on every print. Print: gold bars,
    the box and the pinline split, as m15's gold-split.
  - 5 hybrid ones (STX #334 / #341, IKO #360, ECL #372 / #374): the hybrid
    master 8.7–15.7, the gold-split 9.0–17.3, gold 16.7–26.0. Print: the
    two frames split over GREY bars, as m15's hybrid.
  - 17 two-colour extended-art lands (SOC #101 / #103 / #107, FRC #102,
    BRO #370, CLB #602 / #606, STX #360 / #365, CMR #709 / #711, M21 #390,
    THB #348 / #351, EOC #43, MSC #468 / #477): the land pair 4.0–15.0
    against the gold land frame's 20.3–67.3 and the grey `l`'s 22.0–44.0.
  - The crown of a crowned pair (FRC #96, FDN #476 / #479 / #481–483, WOE
    #360, OTJ #366 / #367, WOC #39), over the band's own pixels: the split
    crown 15.3–24.0 against the gold crown's 51.0–121.7.
  - A colourless legendary artifact's crown (BRO #367, ONE #394, LCI #389,
    WOE #369, NEO #496, MID #377, AFR #394): CC's artifact crown 17.0–42.0
    (median 22.7), the grey C crown 18.3–29.0 (median 22.0), CC's 'Artifact
    Legend Crown (Alt)' 29.3–45.0. The independent check added FRA #431,
    MSH #428, TLA #385 and WOE #368, all closer to C: C on 8 of 11. Owner
    Round 67: a colourless legendary artifact KEEPS the grey C crown (as
    before this follow-up — no stored card changes); CC's artifact crowns
    are not built.
  - Legendary black-bordered textless promos (PSPL #8, SCH #20 / #38, SCH
    #6 / #12 gold, PF26 #15 / #16 and PL22 #2 pairs): the STANDARD crown
    (our `m15crown` band) over the promo master 9.0–14.0 against CC's older
    'Legend Crowns' (`m15Crown?.png`, the pack its textless group lists)
    10.3–18.0, every print; a pair prints the SPLIT crown over the gold rim
    (`m15crown/<pair>` 7.0 / 11.3 / 23.0 against gold 54.0 / 84.3 / 61.0).
- **The pair masters:** `extendedPairLayers` (`scripts/lib/cc-frames.mjs`)
  — 4.6b's `pairMasterLayers` over the extended pack's own files and masks
  (`EXTENDED_MASK`: the accurate M15 Title, Type, Rules, Frame and Border,
  and the pack's own Pinline). `extendedart`: `<pair>` = `m.png` whole with
  the box (45→57 %W) and pinline (40→60) split, `<pair>-h` = the two
  frames across the frame ramp (44→57) under the grey `l.png` bars with the
  split box and pinline (the grey plate `pt/c`). `extendedartland`:
  `<pair>` = the grey `l.png` whole with the box and pinline in the two
  land tints. Declared on the two `PROFILES` entries (`twoColorMasters`;
  the land's `twoColorForLands`), so the switch, the import rule
  (`printsTwoColorFrame`: the 2015 frame always), the registry's
  `two-colour` / `two-colour-hybrid` gaps and the crown's pair keys follow
  by themselves. 30 masters, frames bucket.
- **The crown:** `extendedcrown/<pair>` — the pair's two floating crowns
  lerped across `PAIR_RAMPS.crownFloating` (40→60 %W, the borderless
  pairs'), drawn where the card is drawn as its pair master. The crown is
  still keyed by the card's colour (`resolveFrameOverlays` unchanged but
  for `pairCrownOnGold`, below): a colourless artifact on its silver `a`
  master wears the grey C crown, as before.
- **No stored style changes:** main against this branch over every
  template × colour (w, c, three colours, a pair with a split cost and with
  a hybrid one, a land pair) × card type (7) × supertype (none, Legendary,
  Legendary Artifact, Artifact) × crown / two-colour switch (absent, on,
  off) × stamp (absent, auto, none) × rarity (common, rare) — 644,183
  combinations, the master painted, every overlay, the plate, the save's
  `normalizeAnatomy` and the new-card style: 34,996 differ, ALL on the four
  frames and all additions — each one either a style main's save never
  stores (the `twoColor` switch on the extended frames, the `crown` switch
  on the textless pair) or the new-card default that now starts them on;
  every style main can store draws and saves identically (0 exceptions).
- **The textless crown:** the `m15crown` band on `m15textless` (keyMap c →
  a: the silver rim) and `m15textlessland` (c → l: the land rim) — the
  promo master's title bar and side rim sit on M15's rows, so the band's
  hole and arms register as on m15. A pair's crown is SPLIT over the gold
  rim with no pair masters and no two-colour switch: the slot's
  `pairCrownOnGold` keys the crown by the stored pair. No new objects.
- **Imports:** main against this branch over every extended-art printing
  (4,236) and every textless one (291), with no combo verified and with
  every one: 928 extended-art rows change and only their `frame_match` —
  the `two-colour` (1,790) and `two-colour-hybrid` (66) gaps drop, and 482
  move `nearest` → `exact` once verified (393 on `extendedart`, 89 on
  `extendedartland`); the rest keep another gap (Universes Beyond, a
  Vehicle, a layout). Template, colour, switches and every other field are
  identical. The textless rows don't change: the registry's `textless/2015`
  rule is still `nearest` (`blockedBy` 4.42; making it `exact` is later,
  TODO 4.42a) — but their patch already
  names `printed_crown` (the `legendary` effect), which a save now keeps on
  the textless pair, so an imported legendary promo draws its crown.
- **Tests:** `tests/unit/frames/extended-art-importer.test.ts` (the pair
  recipe, the published pair masters' alpha and split),
  `tests/unit/frames/extended-crown-band.test.ts` (the pair keys, no `a`),
  `tests/unit/cards/extended-textless-crowns.test.ts`, the matrix's new
  `extendedart` / `extendedartland` `@pair*` and `m15textless*` `@crown*`
  cases; parity `extendedart/wu/creature-long@pair-crown`
  and `m15textless/u/creature-long@crown`.

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
  oval here and keeps its key for a frame that prints the triangle (lotr
  and lotrscroll draw their own triangle since 4.11). `resolveHoloStamp` (lib/cards/anatomy.ts) answers
  both renderers, the rules layout and the creator (on a TRIANGLE frame
  "auto" is every rarity and the face has a tone — "The Universes Beyond
  frames", layout v55): the notch overlay
  (resolved like the crown — `resolveFrameOverlays`, the master's key
  through the slot's `keyMap`), the oval, the art rect and the keep-out —
  or null. The oval is never drawn without its notch (the straight box edge
  would run through it); a card drawn as its PAIR master takes the pair's
  notch since the follow-up below (wave 1 drew none there).
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
  and 182 × 107, 1:1 at HD (plus the ten pair keys of the follow-up below).
  Provenance (`lib/cards/frame-sources.json`) names the one source piece,
  the tint per key (a pair's: its ramp across the piece and the masters
  that share its bar) and the cut; the unused CC pieces were fetched and
  inspected, never published.
- **The pair frames** (the 4.9c follow-up, owner round 26, 2026-10-03: a
  new two-colour rare starts on the pair frame, so it gets its stamp like
  every other rare). `M15_HOLO_STAMP` publishes the ten pair keys beside
  the nine bars — `m15holostamp/<pair>` — and `resolveFrameOverlays` keys
  the notch by the master drawn, as it keys the crown: the pair in printed
  order on either dress. The piece is the same U geometry with the rim
  tinted PER COLUMN: a pair master's bar under the notch is its pinline
  layer, the two colours lerped across `PAIR_RAMPS.pinline` (40→60 %W =
  600–900 px at HD), and the notch sits at 654–846 px, INSIDE the ramp —
  its left foot stands on an ≈ 20 % blend of the two bars and its right on
  ≈ 80 %, so one flat tint can't meet both. The importer reads the bar off
  the pair master itself at every column of the piece's bounds (rows
  1940–1947, each column flat within 2 levels; `sampleBarColumns`,
  `rampKeys`), so the arch is that bar lifted: the foot matches the bar
  pixel for pixel at every solid-rim column of BOTH feet (`NOTCH_FOOT`
  runs x 4–12 and 180–188 on row 44, verified solid in CC's piece by
  `footRunsSolid`) and the rim runs through the ramp over the oval as the
  pinline does. ONE piece per pair serves every pair master with the
  notch: the bar's flat rows (1941–1949) are the same bytes on
  `m15/<pair>`, `m15/<pair>-h` (the hybrid dress's grey L bars are its
  title and type bars; its text-box pinline is the pair's),
  `m15artifact/<pair>`, `m15land/<pair>` and the snow pairs
  `m15snow/<pair>` / `m15snowland/<pair>` (4.6f wave 2c, #458: their
  white bars are the title and type bars too, and the snow pack's pinline
  is M15's — measured, the bar under the notch is m15's pair bar at every
  column; the land and snow pairs differ only on the bar's anti-aliased
  rows above the sampled ones — row 1938, ≤ 5 levels — as the mono `l`
  key does on m15land) —
  `barSharedBy` lists them, the importer refuses a pair whose shared
  master drifts, and `tests/unit/frames/holo-stamp-notch.test.ts` re-checks
  it on the real masters; a template that gains pairs with the notch
  declared fails that test and the matrix test until `barSharedBy` names
  its pair masters (and the importer has re-checked them) and
  `STAMP_PAIR_TEMPLATES` lists it with its `@stamp-pair-split` case. 20 objects (10 PNG + 10 WebP), the 32
  of wave 1 untouched byte for byte. The oval, the keep-out and the arch's
  position are wave 1's exactly; the creator's "no notch on the pair
  frame" note is gone. Opt-in like the rest: no stored card draws a pair
  notch until its owner's switch asks (every production pair card was
  saved without the key), no bump, no sweep; the visual gate retired wave
  1's `@stamp-pair` pin (the switch on a pair, nothing drawn — the gap this
  closes) for the pair cases (`@stamp-pair-split` on m15, m15artifact,
  m15land, m15snow and m15snowland, `-hybrid`, `-crown`, `-hd`, `-foil`).
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

#### The borderless stamp and collector line (4.9d)

TODO 4.9d, owner Round 66 (2026-10-14): every borderless print carries the
holofoil stamp (a rare or mythic) and the collector line, and our borderless
frames had neither — one follow-up for the family. `m15borderless`,
`m15borderlessartifact`, `m15borderlessland` and `m15borderlessstation`
declare both since, and the borderless planeswalkers (`m15borderlesspw`,
`m15borderlesspwtall`) since owner Round 70 (below). An ADDITION, exactly as 4.9b / 4.9c: the same
switches (`frame_style.stamp` / `collector` / `star`), new cards on by
default, a stored borderless card keeps its look (it was saved with neither
key — `normalizeAnatomy` dropped them on a template without the slot — so
none draws until its owner switches them on), imports follow the printing
(`printed_stamp` / `printed_collector` already name the printing's; a
"Use Borderless" switch now keeps them), no `CARD_LAYOUT_VERSION` bump, no
sweep, no badge, no verification tick.

- **Measured on print** (2026-10-15, Scryfall PNGs at 1500 × 2100; numbers
  in `scripts/lib/borderless-stamp.mjs`): the collector line sits exactly
  where the bordered frame prints it — line 1's ink 1965–1988 px, line 2's
  2003–2026, from x 99, on the borderless printings AND their bordered twins
  (FDN, DFT, INR, DSK…), white on the black bottom bar; the © line ends at x
  1394–1395, on line 2 beside a P/T plate and on line 1 without one (INR
  #311, 2X2 #381). Both styles print there (2015: M21 #318, MH2 #321, 2X2
  #381; 2023: FDN #376, INR #311). So the four entries take `M15_COLLECTOR`
  unchanged, the mark in its © slot. The stamp is the OVAL on every plain
  borderless printing (a Universes Beyond borderless printing prints the
  triangle — FIC #444, PW25 #16, FCA #56; about 1,116 printings, e.g. FIN
  #374 — and on these four frames a `"triangle"` draws NO stamp, owner
  Round 70: no triangle notch is cut for the borderless arch yet; see
  below); commons and
  uncommons print none (INR #311, FDN #325, DFT #300). The pinline ARCHES
  over it as on the bordered frame: the rim's lower edge rises from x 666 to
  32.6 px above the straight bar at the centre (1916.0 px against 1948.6;
  fourteen clean renders, symmetric about x 750 within 1–2.6 px), the rim
  and the bevel keeping the bar's vertical thickness; the physical scans
  agree (FDN #376: 1917). The oval sits where the bordered frame's does on
  the physical scans (FDN #376 1928/1930–1991, MH2 #321 1928–1994), so the
  slot draws `M15_HOLO_STAMP_OVAL` with our own art; Scryfall's clean
  renders draw it 7 px higher on bordered and borderless alike, which no
  physical print shows.
- **The notch is our own** (`scripts/build-borderless-stamp.mjs`, DATA in
  `scripts/lib/borderless-stamp.mjs`): Card Conjurer's borderless pack has
  no stamp piece, and its bordered arch (cut for a bar 12 rows thick) stood
  2–3 px proud of the borderless bar's 11-row rim at the feet. Each piece is
  its published master's own pinline LIFTED along the printed arch
  (`ARCH_LIFT_PX`): per pixel, the layer that, composited over the master,
  shows the master `lift` rows further down — the bevel, the rim, then the
  black under them — while the translucent box above the arch keeps its own
  pixels (the pinline's first row is read per column, `pinlineTop`: a
  station box's paper is never moved). The cover is exact wherever covering
  can do it; the one loss is a bevel's shaded edge row lifted a fraction of
  a row into its lighter middle, which no cover can thin (≤ 4.1 levels, the
  nearest cover over every art, `bestCover`). Both feet are the bar itself;
  a pair's ramp, a land's tinted box and bevel and the station's light rim
  come with their masters. 180 × 52 px at 660, 1896, 1:1 at HD. Three
  folders: `m15borderlessholostamp/<w u b r g m c a + 10 pairs>` (the
  spells and the artifact dress — `a` is the colourless artifact's silver,
  its keyMap; one piece serves the split and hybrid dresses, the artifact
  pairs and every crowned twin, the same pixels where the piece reads,
  which the build checks), `m15borderlesslandholostamp/<7 + 10 pairs>` and
  `m15borderlessstationholostamp/<w u b r g m c>` — 42 pieces, 84 objects
  with their WebPs (alpha equal to the PNG's, checked), in the DEV bucket
  until the owner's `frames:promote`. Nothing of a hologram is in a piece.
- **The keep-out FOLLOWS THE ARCH** (owner Round 70;
  `M15BORDERLESS_HOLO_STAMP_KEEP_OUT_SHAPE`, `borderlessArchKeepOut` in
  `lib/cards/holo-stamp.ts`): 4 px columns over the arch, each from 2 px
  above the lifted bevel's highest point in it (1895.4 px at the centre)
  down past the rules box's bottom (1925), the columns below the box left
  out — read by both renderers through `ResolvedHoloStamp.keepOutShape`
  (`DrawnStats.stamp` takes a list), glyph by glyph like every badge, so a
  line steps down only where its glyphs would really meet the arch. A single
  rect over the arch's highest point (the first cut: x 655–845 from 1892)
  stepped down 17 of a 1–95-word sweep on m15borderless where the arch's
  shape steps 2 (68 and 69 words) — the same sweep steps 10 on m15 with its
  one rect; no text clips that the box doesn't clip without the stamp, and
  every glyph is drawn clear of the columns (`rules-no-clip.test.tsx`).
  `M15BORDERLESS_HOLO_STAMP_KEEP_OUT` is the columns' bounds. The lift
  table is copied in `BORDERLESS_ARCH_LIFT_PX` beside the build's own
  (`ARCH_LIFT_PX`); a unit test holds them equal. The borderless STATION keeps M15's keep-out:
  its master has no bevel (the station box replaced it), so the arch's top
  is the rim's, 1904.4 px at the centre, and the dress lays out every text
  exactly as `m15station` (the stamped last band is built round that
  keep-out). Its tier washes are drawn over the arch as on `m15station`
  (the bands are UNDER both finishes, after the frame and its overlays);
  EOC #1 / #2 keep the arch clear of the washes — an owner question.
- **Tests and cases.** `tests/unit/frames/borderless-holo-stamp.test.ts`
  (the recipe, the published pieces byte for byte against a rebuild from
  their masters, the manifest, provenance, the profiles); the visual gate's
  new `m15borderless*` `@stamp…` / `@collector…` cases (every existing case
  unchanged); parity cases for the stamp and the line on the borderless
  frame (darwin).
- **A triangle draws nothing here** (owner Round 70): every slot of the
  four frames declares `ownShapeOnly` — `holoStampWanted` refuses the other
  shape, and a save keeps `"none"` for it (`normalizeAnatomy` /
  `stampForTemplate`; the import's "Use Borderless" offer writes it too),
  so a Universes Beyond printing moved onto a borderless frame shows no
  stamp rather than an oval it never printed. The borderless triangle's
  notch is a follow-up (TODO 4.9d). Visual case
  `m15borderless/u/creature-short@stamp-triangle` pins the plain look.
- **The borderless walkers** (`m15borderlesspw`, `m15borderlesspwtall`;
  owner Round 70, 2026-10-16: "Build them next") — built in their own PR,
  the same addition (opt-in per card, no bump, sweep or badge):
  - *Measured on print* (2026-10-16, Scryfall PNGs at 1500 × 2100; numbers
    in `scripts/lib/borderless-stamp.mjs` `WALKER_ARCH_LIFT_PX`): the dark
    outline under the ability window — its upper edge, where the light
    stripe ends — read column by column on thirteen stamped borderless
    walkers whose straight outline reads the same row (BLB #341, BLC #75 /
    #97, DFT #376, FDN #357 / #359, INR #322, LCI #307, OTJ #305 / #306, RVR
    #444, SLP #55, M21 #281): straight at 1918.8 px, lifted 24.2–24.4 px at
    the centre, rising from x 666 to x 834 (the spells' span, 8 px lower),
    symmetric within 0–1.5 px; the outline and the rim keep their thickness
    over the arch (BLC #75, OTJ #306: the rim 12 px on the bar and at the
    centre). Seven more (AFR #285, DMU #375, FDN #417 / #420 / #421, M21
    #280, UNF #276) read 23.7–24.6 at the centre where the edge could be
    read. The collector line sits on the same two rows from x 99, the ©
    line on line 2 beside the loyalty shield (IKO #277, AFR #285, FDN #417,
    UNF #276, SLP #55, MH3 #444), so both frames take `M15PW_COLLECTOR`
    (`markLine: 2`: the mark stays off the shield the master draws). The
    oval is M15's (`M15_HOLO_STAMP_OVAL`): the physical scans put it at
    ≈ 1931–1996, the bordered frame's place — not the 7 px higher one
    `M15PW_HOLO_STAMP_OVAL` takes from Card Conjurer's walker piece.
  - *The notch* (`m15borderlesspwholostamp/<w u b r g m c>`, 180 × 42 px at
    660, 1896; `WALKER_ARCH`): the same lift recipe over the walker masters
    — their 4-row black outline (1922–1925), the colour's flat 11-row rim
    (1926–1936) and the black bar under them moved up, the see-through
    window above left clear. One piece per key; the tall twin's master is
    the same pixels there (the build checks it, `sharedBy`). 7 pieces, 14
    objects with their WebPs (alpha equal), in the DEV bucket until the
    owner's `frames:promote`. No Card Conjurer piece, no scan.
  - *Drawn above the rows* (`HoloStampArt.aboveRows`): the walker's window
    is see-through and the rows' translucent stripes (and the plain box's
    backdrop) are drawn over it in the text layer, so a notch in the frame
    layer would show through a stripe as a grey ghost — print ends the
    window AT the arch. Both renderers leave the notch out of the frame
    layer and the finish masks (`frameLayerOverlays`) and draw it after the
    rules layer, with its own foil sheen as a plate gets one, then the
    oval; on an etched card the frame's hatch is drawn over it too
    (`EtchedSheen` masked by the notch alone, `frameHref: null`: the same
    card-space pattern, so the straight rim and the arch etch as one —
    owner Round 72). (m15pw's stamp, 4.9c, is unchanged: its stripe still
    washes over its arch — a later, separate correction, TODO.md.)
  - *The keep-out follows the arch* (`borderlessWalkerArchKeepOut`, 4 px
    columns from 2 px over the lifted outline, 1895.7 px at the centre,
    past the box's bottom) and holds against BOTH the plain box (glyph by
    glyph, `DrawnStats.stamp`) and the ability ROWS: `layoutLoyaltyRows`
    takes the arch (`stamp`, from `rowsStampKeepOut`) and, where a layout
    that holds its text and clears the shield fails only on the arch, holds
    the LAST row's text up over it at the same size by the SMALLEST even
    lift (2 … 24 px, `lastRowLiftHd`; even, so the 750 px bake's half is
    whole) that clears it, before any step down (owner Round 72). The lift
    is the TEXT column's bottom padding in both renderers, never the row's,
    so the badge stays centred on its stripe. The floor's fallback (nothing
    fits) takes no lift — exactly the unstamped rows. A walker whose text
    clears the arch lays out exactly as without the stamp. Audited
    2026-10-17 on 501 inputs per frame (327 real walkers' oracle text, 174
    synthetic): no new clip, no difference where the text clears, no glyph
    in the arch; real walkers step down a size 20 / 16 times (regular /
    tall; the first cut's all-or-nothing 24 px stepped 66 / 48 on the
    checker's 329, and clipped Ugin, Eye of the Storms). The unit sweep of a
    1–70-word last ability holds 12 / 15 up and steps 6 / 4. No badge comes near it: the rail ends ≈ 400 px left of the
    arch, the shield starts ≈ 350 px right of it. The creator's
    badge-crowding note still reads the rows without the stamp.
  - A triangle draws nothing here (`ownShapeOnly`), as on the other four.
  - The alignment score scores the arch on the walkers too (owner Round 72:
    `HOLO_STAMP_ARCH` excludes no template now); no stored tick changes.

### The text alignment (4.21e)

TODO 4.21e; owner 2026-10-07: "every kind of card can choose centring …
it starts on left, not centred". A card may set its rules text **Left** (the
look every card has had) or **Centred**. It is an addition (above): card
data, opt-in per card, no sweep, no badge, no `CARD_LAYOUT_VERSION` bump —
and the one switch a NEW card starts OFF on.

- **The prints.** Short texts are printed both ways, and no rule of length
  separates them. Split, read on Scryfall PNGs turned to 2100 × 1500:
  centred — MH2 #123, TSR #156 / #161 / #186, C16 #239 / #240 (one to four
  lines a half); left — MH2 #60, GRN #224, DMR #209 (a one-line half
  included), UMA #225. On the centred prints every line's ink is centred on
  the paper's centre (TSR: 607–610 px on the left half, 1572.5–1576 on the
  right; our boxes' centres are 607 and 1573) and the block is centred
  vertically, as ours already was. A plain card does it too: M20 #33
  (Planar Cleansing, one rules line, no flavour) is centred; XLN #180
  (a keyword with reminder and flavour) and M19 #9 (bullets and flavour)
  are left. **No print read here centres a text that has reminder text, a
  second paragraph or flavour** — those are set left.
- **The value.** `frame_style.rulesAlign`: `"center"` or absent (absent =
  left). ONE value for the card: every plain rules box of it is set alike
  — both halves of a split card (the six centred prints centre both), an
  aftermath's or flip's second face, the adventure page, both faces of a
  double-faced card (the back body reads the card's switches,
  `lib/cards/faces.ts`). The form and an edit's patch also say `"left"`;
  the save never stores it (`normalizeAnatomy`), so a stored `frame_style`
  never names the default. It is one of `FRAME_ANATOMY_KEYS`, validated by
  `frameStyleBaseSchema` / `frameAnatomyPatchSchema`
  (`RULES_ALIGN_VALUES`); no CHECK constrains `frame_style`.
- **Who sets it.** A new card starts left (no default ever stamps the key:
  not `NEW_CARD_ANATOMY`, not `anatomyDefaults`); an import stays left
  (`importedFormAnatomy` clears the form's key); a remix keeps its
  parent's (`storedAnatomyOf`); an edit sends `frame_anatomy.rulesAlign`
  only when it changed — `"left"` takes a stored `"center"` off
  (`frameAnatomyPatchFor`, `applyFrameAnatomyPatch`).
- **Which frames.** Every frame that sets its text in plain rules boxes,
  by default — capability data on the profile, read in ONE place:
  `profileOffersRulesAlign` (`lib/cards/template-layout.ts`). A profile
  opts out with `rulesAlignSwitch: false` (the station pair does, TODO 4.27a). It is never offered
  — and a stored key is dropped at the save and ignored at render
  (`rulesAlignOf`, `lib/cards/rules-box.ts`) — on a `textless` frame, on
  the saga (`chapters`: the text sits in rows beside its hexagons) and on
  the planeswalker frames (`loyaltyRows`: rows beside the loyalty badges;
  a walker with no abilities, or another card type on a walker frame, is
  drawn in the plain box and stays left too — one rule a frame). The modal
  flipside strip, names, type lines and footers are not rules text and are
  untouched.
- **What "centred" is.** `RulesLayoutInput.align: "center"`
  (`lib/cards/rules-layout.ts`): EVERY line of the block — rules, reminder
  text, every paragraph, flavour and its attribution — is set with its
  centre on the box's centre line, by a whole px of indent at each target
  (`centredLineIndentPx`; `RulesLinePlacement.indent`, which both renderers
  already drew for a token's one centred line). The centre is the middle of
  the box less its padding, not of the column the side headroom leaves, so
  an italic line's overhang never pulls the block off the paper's centre; a
  line that fills the column stays inside it. At one size the line breaks,
  every vertical position, the flavour bar (still the column's width) and
  the block's vertical alignment are exactly the left-aligned layout's —
  the lines only move sideways. The SIZE is the left-aligned one, always
  (next point). Centring reminder text and flavour with the
  rules is OUR reading of "centred" (one block, one alignment): the prints
  give no example either way, because they only centre texts that have
  neither.
- **Centred beside a badge** (owner 2026-10-07, after the skeptic pass's
  fuzz). A centred text is set at EXACTLY the size its left-aligned twin
  fits at (`fitRulesLayout`: the twin is fitted first, its size and any
  squeezed paragraph gap are the centred layout's), with the twin's lines.
  A line whose centred place would put ink in a drawn keep-out — the P/T
  plate, the holofoil stamp's arch, the battle's shield, the modal strip,
  a float's digits — is **held short of it**: set at the whole-px indent
  nearest its centred one at which no glyph of it enters any keep-out
  (`heldLineIndentPx`, judged glyph by glyph like the keep-out check),
  with `HELD_LINE_AIR_PX` (14 HD px) of air beside the badge where the
  room allows, else set against it. The left-aligned line's own place is
  always a candidate, so: **Centred never sets a text smaller than Left,
  and never clips a text Left fits.** A line that meets no keep-out where
  it is centred is not touched — it stays on the box's centre to the half
  px. On a float's rows (the transform front's reverse P/T) the line was
  already held at the float's left edge, its last glyph's ink included
  (`floatColumnsFor` measures the column from the box's edge, not from the
  indented line). A line no indent clears (the left-aligned one hits too)
  keeps its centred place and the text is clipped exactly as Left is.
  Measured on 9,516 fuzzed boxes (every frame with the choice, every badge
  drawn, 36,657 HD lines): 0 size differences, 0 texts that fit left and
  clip centred (12 that clip left at the floor fit centred: a modal face's
  last line held to the right of the strip); 500 lines held by a badge —
  median 84 px off the centre, at most 286 — and 212 on a float's rows
  (median 48, at most 110). Before this rule a badge stepped a centred
  text down like any keep-out (about 5 % of those boxes one to five steps
  smaller, 0.7 % clipped only when centred).
- **Tokens.** The text-box tokens' and the emblem's automatic ONE centred
  line (`alignSingleLine`, 4.49 (b)) is unchanged with the switch left;
  Centred centres the whole block, however many lines.
- **Split's text column stays.** Each half's rules rect is 780 px wide
  (the paper is 814); the centred prints' widest lines are 749–791 px. No
  width reproduces the prints' breaks, because they are not greedy on one
  column: TSR #186 sets "Tumble deals 6 damage" (791 px) but breaks
  "to each creature / with flying." where "with" fits; TSR #161 breaks
  before "its", TSR #156 before "you", where the word fits either column;
  MH2 #123 is set smaller (72 px). Measured with the layout itself on the
  19 reference halves: 12 break as printed at 780 px, 12 at +3 px a side,
  13 at +5, 11 at +8 and +10 (wider gains "Tumble deals 6 damage" and
  loses TSR #161's and DMR #209's left halves). So the rect is not
  widened, left-aligned split cards do not move, and there is no bump.
- **The creator.** The Text step (`TextPanel`) shows "Text alignment:
  Left / Centred" (a labelled radio group, `ChipGroup`) wherever
  `frameAnatomyOf(template).rulesAlign` — creating, remixing and editing;
  the live preview follows. A basic land (the icon step), a walker's
  ability rows and a saga's chapters have their own editors and no
  control.
- **Tests.** `tests/unit/cards/rules-align.test.ts` (the layout on every
  family, the save, the schemas, the edit patch),
  `tests/unit/render/rules-align-bake.test.tsx` (real bakes: each line's
  ink moved by exactly its indent), `tests/unit/components/
  rules-align-preview.test.tsx` (the preview's margins are the layout's
  px), `rules-align-control.test.tsx`, the centred half of
  `rules-no-clip`, and the visual gate's `@centred` cases.

### The nickname plate (6.3)

TODO 6.3 (owner 2026-10-21). A card's NICKNAME (`cards.nickname`,
migration 0141; Scryfall's `flavor_name`) prints in the title bar, and the
card's own name in small italic type on a dark plate hanging from the top
of the art window — the look of every black-bordered flavour-name printing
(MSC #276–290, SDS #3 / #15 / #24 / #27, TMC #48–56, SLD #478–483 / #697 /
#710 / #726 / #1186–1188). An addition: a card without a nickname draws
byte for byte as before; no layout bump, no sweep, no badge.

**Measured on 14 Scryfall PNGs (2026-10-21), HD px, symmetric about
x = 750.** The plate's rim is the frame's own pinline colour, 10 px, with a
black keyline either side; it leaves the window's top pinline (rows
223–231) at x ≈ 148, curves down to y 297.5 — its centre line 167 @ 240,
184.5 @ 250, 193.5 @ 260, 200 @ 270, 205 @ 280, 209.5 @ 290 — and runs
straight to the mirror side. One cubic draws the curve within 0.5 px of
every point; the bake's own rim reads within 1 px of MSC #282's on every
row. Inside, a dark wash the art shows through (the art under the plate at
0.43–0.65 of its level on eight prints): rgb(16,16,22) at α 0.6. A
two-colour card's rim is its pinline's two colours (MSC #282: green |
white) — the masters' 40 → 60 %W ramp. The name: MPlantin italic, white,
centred, baseline 274, 54 px (ink-to-advance 50.4–53.6 on the prints, 52.6
on the bake); a long name steps down in even px to 40, then ends in one
"…".

**What draws it.** `lib/cards/nickname.ts` alone: `resolveNickname`
(declared frame + a non-blank nickname + the FRONT face), the plate an
inline SVG `data:` URL (the station pieces' pattern: no bucket object, the
same string in the preview, the bake and both finish masks), the name line
a centred band. The rim colours are the masters' (rows 224–229 at x ≈ 300
and 1200; one palette across every declared template, a land frame's
colourless master the land grey) — `tests/unit/cards/nickname.test.ts`
reads them back off the masters when the frame cache is present.

**Where.** `FrameProfile.nickname` on the PROFILES entries whose art window
opens at 238 px under the 223–231 px pinline: m15, m15artifact, m15land,
m15snow, m15snowland, m15nyx, m15vehicle, m15ub, m15ubartifact, m15ubland.
Not devoid (no pinline there), the station frames (one picture under the
frame), the tokens (another title pill), the walkers, the two-part and
double-faced bodies, the old frames (no print) or the borderless family —
IKO #275's and the Secret Lair borderless nickname prints draw another
plate (a box under a floating title bar): those imports keep their
`nickname` gap. On any other frame the creator's field says the frame
prints no nickname; the card shows its name.

### The white border (4.30)

TODO 4.30, era step E8 (owner 2026-10-07: "the white border: YES, as the
last era step"). The printed border of the core sets up to Ninth Edition —
Fifth, Sixth and Seventh Edition, Anthologies, Battle Royale, Beatdown and
Deckmasters on the 1997 frame; Eighth and Ninth Edition on the 2003 frame —
as **a card's own switch**. An addition (above): opt-in per card, no layout
bump, no sweep, no badge.

- **The switch.** `frame_style.border`: `"white"` or absent (= black, the
  look every card had). The creator's form and an edit's patch also say
  `"black"`, which is never stored. It is an anatomy key
  (`FRAME_ANATOMY_KEYS`), and with the text alignment the second one **no
  default stamps**: a NEW card starts BLACK — a white border is a printing
  choice, not a default — an import follows its printing's `border_color`,
  a remix keeps its parent's. Every save runs `normalizeAnatomy`: the key
  stays only as `"white"` and only on a template whose `PROFILES` entry
  declares `whiteBorder`.
- **Where.** `retro`, `retroland`, `modern`, `modernland` — declared on
  those four `PROFILES` entries, never on the `RETRO` / `MODERN` bases. Not
  the 1993 pair (below), not the 2015 frames.
- **What is drawn** (`lib/cards/white-border.ts`): ONE inline SVG of two
  flat rings, stretched over the whole card right after the frame master
  and its overlays, under both finishes and every text layer — the same
  `data:` URL in the browser preview (`[data-white-border]`), in the Satori
  bake and in both finish masks, so the three agree by construction:
  - the **white** `#ececea` from the card's edge to the frame box — exactly
    the master's own black border (`whiteBorder.insetPx`: 73 / 73 px at the
    sides, 82 on top, 81 below on the 1997 pair; 70 px all round on the
    2003 pair). Never Card Conjurer's border mask: on the 8th pack it sits
    on the frame's edge and erases the keyline, and it fills `#ffffff`;
  - the black **keyline** just inside it, over the frame's outermost
    pixels: 3 px on the 1997 frame, 4 px on the 2003 frame
    (`whiteBorder.keylinePx`). It is drawn, not left to the master's black,
    so it is that wide on every master (the MSE gold's border is
    74 / 71 / 80 / 81).
- **Why inside the frame box.** On the prints the white ends where the black
  border of the same frame ends (37 prints on the 1997 frame: 73.7 / 73.4 /
  81.9 / 80.8 px; nine 9ED prints: 70.5 px on all four edges), and a 7ED,
  8ED or 9ED card and its own black-bordered foil printing put the frame's
  first light pixel on the same px, 3–4 px inside the white: the core-set
  plate is the era's frame with its outer edge taken by the line.
- **The colour is a choice, not a measurement.** Scryfall regenerates the
  border of its scans: all 88 white-bordered scans measured share two
  templates (`#ededef`, `#edecea`) to two decimals. `#ececea` is ΔE 0.2 from
  one and 2.0 from the other, and off-white on purpose — pure white has no
  edge on a white page. (Review, 2026-10-12, 68 more white-bordered scans:
  the border PIXELS are the same bytes from scan to scan — 5ED, 7ED, PTK
  and 2ED agree on all 55,228 border pixels; so do 8ED and 9ED, and the
  black-bordered TMP / 10E and 7ED★ / 8ED★ — and the `large` / `normal`
  JPEGs carry the same means. Other templates exist beside the two: Hachette
  UK's 235 / 235 / 233, the Sega Dreamcast cards' pure 255. In print the
  border was bare card stock, so `#ececea` — 16 % under paper white in
  luminance — would print as a faint tint on white paper.)
- **Two whites: the screen's and the print file's** (owner 2026-10-12).
  `#ececea` (`WHITE_BORDER_HEX`) on every DISPLAY surface — the stored
  bake, its thumb, the OG image, the live preview and the plain PNG
  download, round or square, the free Square included (a stored round bake
  squared with the same off-white, so its corners match its own border).
  Pure `#ffffff` (`WHITE_BORDER_PRINT_HEX`) in a PRINT file: everything
  `lib/render/card-print.ts` makes — the PDF card and sheets, `?bleed=1`,
  `?bleed=mpc`, `?ppi=800`, the Pro exports' `?print=1` — draws the ring,
  squares its corners and extends its bleed in it. One switch, the
  `WhiteBorderMedium` (`"screen"` by default, `"print"` from the print path
  alone: `renderCardImage` sets it wherever it is handed a `printLayer`,
  and `renderCardPrint` asks `squareCornerFillsOf(card, "print")`). The
  keyline is the same `#000000` in both, and inside the frame box a print
  file is the display Square pixel for pixel
  (`white-border-bake.test.tsx`).
- **No ink moves and none changes colour.** On both pairs the artist line,
  the © slot (the pipglyph.com mark on display, a clean download's footer
  text), the P/T and the set symbol are INSIDE the frame, as on the prints
  (no 1997 or 2003 print sets anything on the white). A unit test holds
  that: a profile may declare `whiteBorder` only beside a `copyrightSlot`
  whose line, like every text slot, ends above the keyline
  (`tests/unit/cards/white-border.test.ts`). A frame whose mark sits ON the
  border (the 1993 pair) must give the mark the brand's dark single-ink
  treatment before it declares the piece.
- **Corners, print, finishes.**
  - The white runs to the PNG's edge; the bake's corner cut rounds it
    (`applyCardCornerMask`) and the display clip does on screen.
  - A square output fills its corners with the same white
    (`squareCornerFillsOf` → `whiteBorderRgb(medium)`): the off-white on
    the paid Square and the free Square (the stored round bake squared with
    those fills), the print white on the PDF card and sheets and the Pro
    exports.
  - A bleed (1/8 in, MakePlayingCards', 800 ppi) copies the trim edge out,
    so it is the print white with no rule of its own: `EDGE_CONTRACTS` keeps `border`
    on these templates (the contract is about the master's opacity).
  - Foil and etched mask their sheen with the border too (`overlays` of
    `FoilSheen` / `EtchedSheen`), so the white takes the finish like any
    light part of the frame and the keyline takes none. (No real foil has a
    white border — the core sets' foils were black-bordered.)
  - The thumb and the OG image are the bake. A gallery tile
    (`BakedCardThumbnail`) backs a white-bordered card's picture with the
    white instead of `#101015`: on the dark backing the picture's soft
    corner edge showed as a grey arc round a white card. The surfaces
    that back a bake with `#101015` in their own markup still show that
    arc on a white-bordered card in the light theme (reproduced in review):
    the deck card modal and its card picker, the marketing hero, featured
    creators, the moderation list and the render-update compare — left
    as it is (owner 2026-10-12: no follow-up; they do not all carry the
    card's `frame_style`).
- **Imports** (`lib/scryfall/frame-signatures.ts`): the `border` gap is one
  gap for white, silver, gold and yellow, and `gapDrawnBy("border", …)` is
  true only for a WHITE border on a frame that declares the piece — so a
  white-bordered 5ED → 7ED, ATH, BRB, BTD, DKM, PTK, S99, 8ED or 9ED
  printing is `exact` on its frame and imports with the switch on
  (`printed_border`), its black-bordered foil twin imports black, and a
  later gap still holds beside it (a 2021+ reprint: `reprint-colours`). A
  white border on the 1993 or the 2015 frame, and every silver, gold or
  yellow border, stays `nearest`. A `…+border` request row logged before
  4.30 stays open (the row doesn't say which border it was). The rule
  reads the frame and the border, never the set, so the white-bordered
  printings outside that list land the same way: Starter 2000 (S00, 1997
  frame), Salvat 2005 (PSAL) and Hachette UK (PHUK) on the 2003 frame, the
  Sega Dreamcast cards (PSDG). They were not measured for the build; the
  one S00 scan looked at in review ends its white 4–5 px further out than
  ours (69 / 68 / 79 / 78 px) with a 4.5 px line. Deckmasters' and
  Beatdown's foils (DKM #7, BTD #29) are black-bordered and import black.
- **Verification.** Nothing new to tick: the white border rides its
  template's colour tick, as a pair rides its `m` tick — the frame inside
  the keyline is the ticked one, pixel for pixel
  (`tests/unit/render/white-border-bake.test.tsx`). A white-bordered
  reference printing is compared with its border drawn
  (`previewDataFromPatch`).
- **Not built: the 1993 pair.** Unlimited, Revised, Fourth Edition and
  Chronicles were measured with the rest (33 prints) and need their own
  step: the line there is OUTSIDE the frame box, 7 px wide and dark grey
  (2ED / 3ED); the frame sits 6 px higher than Alpha's (85 px of white
  below it, 98 px of black on our master); Revised and Fourth Edition are
  other drawings — flat, no bevel, Fourth Edition on a larger box with a
  thinner, fainter line; and the mark sits on that frame's border in
  silver. `agclassic` and `alphaland` declare nothing, the switch is not
  offered there, and their white-bordered printings import `nearest`.
- **Tests:** `white-border.test.ts` (the rules), `white-border-save.test.ts`
  (the actions), `white-border-bake.test.tsx` (real bakes: the rings, the
  frame inside them unchanged, square corners, bleeds, finishes, and no
  change with the switch off or on another frame),
  `white-border-preview.test.tsx` (the preview's image, the creator's
  switch, the tile's backing), `white-border-import.test.ts`; 23 visual
  cases (`@white…`).

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
  modal strip from (5.1a's riders, 5.1b's strip). `otherFace` is the
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

### The modal bodies (5.1b)

TODO 5.1b, 2026-10-05 (`feat/dfc-modal-bodies`). Four templates on Card
Conjurer's 'Modal Regular' pack — the modal double-faced bodies (`dfc`
declared with `layout: "modal"`; `bodyFor`'s modal rows filled, by the
face's kind alone: the housing's ▲ / ▲▼ is in the masters, so a modal card
has no icon family). Additions under the owner rule: no stored card
changes, no bump, no sweep, no badge; nothing is offered until the owner
ticks each colour × face.

| template | source | masters | `dfc` | what it draws |
|---|---|---|---|---|
| `m15mdfcfront` | 'Modal Regular' `<k>.png` | w u b r g m + `a` (= `c`, the artifact stand-in — no print: STX #154 Pestilent Cauldron is a BLACK artifact) | front, land no | the name from the icon-face inset, M15's plate, the strip's texts in WHITE |
| `m15mdfcback` | `<k>b.png`, toned | same (`c` has no print) | back | a cost of its own, white name / type / P/T on the toned dark bars, the dark plates (m15dfcback/pt), the strip's texts DARK, no indicator |
| `m15mdfclandfront` | recipe: `<k>.png` + the land tint's body and box | w u b r g (+ `m`, `c` stand-ins) | front, land | no cost, no P/T; the pathways' look |
| `m15mdfclandback` | recipe: `<k>b.png` + the land tint's body, toned | same | back, land | no cost, no P/T; the ZNR / MH3 land backs' look |

- **The strip** (`FrameProfile.flipside`, `lib/cards/flipside-strip.ts`):
  CC's housing-coloured tab at the text box's bottom left, its ◀ and its
  box are the master's; only two TEXTS are drawn, from the OTHER face
  (`CardPreviewData.dfc.otherFace`, `lib/cards/faces.ts`): its LAST type
  word in Beleren Bold from CC's flipside box at 6.8 %W
  (`MDFC_STRIP_WORD_PX` 49; the prints' ink from 103–110 px, capitals
  35–36 px tall) and its mana cost or, for a land, its mana ability as ONE
  inline-pip run (`MDFC_STRIP_LINE_PX` 54, the rules layout's own metrics
  and v36's pips) set against the box's right edge at 43.2 %W (the prints'
  last ink at 647–650 px). White on a front, `INK_DARK` on a back (CC's
  pack says white on both; the prints disagree). Both renderers draw the
  same runs (`FlipsideBake` / `FlipsideOverlay`), measured on real bakes
  at HD and 750 (`tests/unit/render/mdfc-bodies-bake.test.tsx`). The
  painted strip is a rules KEEP-OUT (`FlipsideSlots.keepOut` →
  `DrawnStats.strip`, judged glyph by glyph like a plate): the prints cut
  it into the text box, so a long text's last lines stop at its chevron
  (KHM #15 Halvar, KHM #114 Valki on the 5.1b sheet 2) — the rules rect
  never shrinks. The Marvel "4/4 Creature" form (SPM / MSH) is not built.
- **The strip's colour — an open question.** The masters paint the strip
  in their OWN colour. On a two-colour modal card the prints paint it in
  the colour of the face it DESCRIBES: STX #147's green front carries a
  blue strip for its blue back, the pathways' fronts their back's colour.
  Every mono-colour print (ZNR's, MH3's) agrees with ours; every STX,
  pathway and MH3-hybrid print differs on the strip's tint alone. A strip
  RIDER keyed by the other face's colour (14 pieces cut through CC's
  `reminder.svg`, an overlay like the icon rider) would follow the prints;
  it is not built — the owner decides on the 5.1b sheet.
- **The land pair** is a PipGlyph recipe (no CC coloured modal land
  exists): the colour's modal master with its frame body — and, on the
  front, its text box — REPLACED through the pack's own `frame.svg` /
  `textbox.svg` masks (a premultiplied lerp by the mask's alpha) by the
  2015 coloured land tint, `m15/new/l<k>.png`, the m15land masters' own
  file downscaled the same way. The pathways (ZNR #258–261, KHM #252)
  print the stone land body, the colour's pinline, the land tint's box
  and the modal housing and strip; the land backs (ZNR #12 / #90 / #134 /
  #189, MH3 #241) the stone body under the colour's dark bars and
  housing, with the modal back's light box (ZNR's neutral marble — MH3's
  is bluer) and light strip. `c` = CC's grey land modal (`l.png` /
  `lb.png`), `m` = the gold tint under the gold modal pieces: stand-ins
  with no reference, never offered.
- **The tone pass** (design D1): CC's spell backs read 3–16 luma light on
  w u b g m and 16 dark on r against STX / MSH's prints, the land backs
  10–30 apart from those on u, b and g (darker on u and g, lighter on b),
  so each template has its own table — `MDFC_BACK_TONES` (w 0.947 · u
  0.866 · b 0.967 · r 1.182 · g 0.886 · m 0.905 on the bars) and
  `MDFC_LAND_BACK_TONES` (w 0.95 · u 0.74 · b 1.088 · r 1.099 · g 0.783)
  — through the pack's Title (the bar and the housing's fill), the regular
  Type and the pack's Rules masks, `toneMasked` with the transform backs'
  luma ramp (the white ▲▼ and the light rims kept). Every built master
  lands within ±0.5 luma of its target (`tests/unit/frames/
  mdfc-importer.test.ts` holds them to ±8). The artifact back is untoned:
  no colourless modal back was printed (every KHM artifact back is a
  COLOURED artifact — KHM #15 Sword of the Realms white, KHM #112
  Tergrid's Lantern black — drawn on its colour's body in wave 1, as LCI
  #60 is on the transform bodies).
- **The name** starts at the icon face's inset on BOTH faces (the housing
  is at the left of every modal face; the prints' ink at 247–252 px).
  The art window is the transform bodies' (`DFC_ART_SLOT`: the pack cuts
  it at 115–1384 × 237–1165 like the transform packs). Edge contract
  `border` on all four sides, square corners #000, the art-window check
  clean on every master.
- **Kind and gate.** `KIND_DEFS.mdfc` (`layoutTemplates: [m15mdfcfront,
  m15mdfclandfront]`); the Modal chip lights once a colour is verified on
  a front body AND on `m15mdfcback` (`kindHasAvailableFrame`); the gate
  derives a modal back's body from the back's type alone, keeps its cost
  (`withTransformBackShape` strips a transform back's only) and refuses a
  transform back body under a modal front by name; the modal bodies refuse
  the Transform kind as the transform ones refuse the Modal kind. The
  one-click move (5.2, Q3) offers the modal pair now — Vader's costed
  artifact back onto `m15mdfcback` keeps its cost; a land back onto
  `m15mdfclandback` keeps the FRONT's colour (one land tint per colour,
  verified per colour — colourless is the TRANSFORM land back's rule), and
  so does the creator's back-type chip: picking Land on a modal card keeps
  the back following the front (the chip's Land → colourless switch is the
  transform layout's alone; 5.1b skeptic — before that fix a modal spell //
  land asked for the grey stand-in's `c`, which no tick offers).
- **The registry** (folded with 5.4's model, #465): `modal/2015` is EXACT
  on the modal front body the mapper's `dfcImportOf` puts the printing on
  (the `dfc` family's pick; the land front for a pathway) — the creator's
  verification says "not yet verified" until both faces are ticked
  (`finalizeImportMatch`); a snow or devoid modal printing (KHM #179 Jorn,
  MH3 #253 Drowner of Truth) is nearest on the body for its dress and
  LANDS on the era's snow / devoid frame with a legacy back (`dfc/snow` /
  `dfc/devoid`, the mapper's `dress` block → 5.11): without that rule the
  fold judged Jorn exact on the plain modal front. The modal backs have no
  signature of their own (`TEMPLATES_WITHOUT_PRINTED_SIGNATURE`). References per colour
  per face (`frame-references.json`): fronts ZNR #12 / MH3 #241 / ZNR #90 /
  #134 / #189, `m` MH3 #252 Bloodsoaked Insight (a HYBRID front — the only
  gold modal fronts on the plain frame are MH3's ten hybrid MDFC lands;
  the split hybrid pinline is 5.12, as the transform front's `m`), `c`
  NONE (no colourless modal front was printed: the design's STX #154
  Pestilent Cauldron is a BLACK artifact, {2}{B}, and STX #6 Wandering
  Archaic, the only colourless modal face, is an Avatar on the see-through
  frame — wave 2, 5.11); backs STX #150 / #147 / #148 / #159 / #151, `m`
  MSH #18 (its Marvel strip form not built), `c` NONE; the land fronts the
  five pathways; the land backs ZNR #12 / MH3 #241 / ZNR #90 / #134 / #189
  — with the KHM Gods (not Valki #114: its Tibalt back is a walker face the
  import keeps off the bodies, 5.13) and the other pathways as alternates.
  The pin check judges a modal land back's row by the back's colour (its
  mana ability), unlike the transform land back's one master; the import
  stores a modal LAND face in that colour too (`dfcFaceColorIdentity` —
  colourless is the transform land pair's rule alone).
- **Owner round 30 (2026-10-05), on the five sheets:** all signed off AS
  BUILT; the stand-in masters (the spell pair's `c` = the artifact master,
  the land pair's `c` grey and `m` gold) are KEPT and never offered; the
  strip's colour on a two-colour card follows the prints LATER — TODO 5.1c,
  after the ticks (a 14-piece rider through CC's `reminder.svg` keyed by
  `otherFace.colorKey`, an overlay like the icon rider). Measured by the
  skeptic on the signed masters and left for 5.1c's pass: the BACK strips'
  fill is 14–44 luma darker than every mono-colour print's (u 208 vs MH3
  #241's 231, b 175 vs ZNR #90 / KHM #112's 213–219, r 212 vs ZNR #134 /
  MH3 #246's 226–229, g 201 vs ZNR #189's 218; w 238 within the prints'
  238–249; CC's strips are also more saturated — the print's b strip is a
  cool lavender, CC's a warm grey); the front strips are within 5–11. A
  gain through the pack's Flipside mask (`reminder.svg` covers the whole
  tab, so the ◀ and the outline stay dark) of u 1.111 · b 1.234 · r 1.073
  · g 1.085 lands the lumas; not applied after the sign-off — a master
  change needs its own before / after OK.
- **The visual matrix:** the front bodies' cases come out of the
  per-template loop (the Modal kind's rows: an instant // land, a pathway,
  the long creature // creature with a cost on the back), every back body
  × 8 colours short / long baked as the back face (`dfcBodyRow` builds a
  modal row for a modal body), the strip's word cases (Equipment, God,
  Enchantment — the longest wave-1 word — Tibalt), a foil, a square: 75
  new cases, 0 changed, 0 redefined.
- **The strips toned (TODO 5.1d, before the first tick):** the skeptic's
  finding above landed as a master correction — the whole tab of the
  modal BACK masters takes a gain through the pack's Flipside mask
  (`reminder.svg`: the tab from the border's inner edge to the chevron's
  tip, so the ◀ and the outline stay dark — a multiplier keeps dark pixels
  dark), fitted on the tab's text-free fill (the median luma of rows
  1872–1876 and 1938–1942, x 110–640 at HD) of the same references as the
  bars, one table per template, to the luma the clamped channels give
  (`MDFC_BACK_TONES.strip` / `MDFC_LAND_BACK_TONES.strip`): the spell backs
  u 208.2 → 220.0 (STX #147), b 175.2 → 221.0 (STX #148 223, KHM #112 219),
  r 212.4 → 230.3 (STX #159), g 200.6 → 228.9 (STX #151 — the first cut's
  224.4 had a measuring row on the tab's top outline, which sits 3 px
  lower on that scan; re-cut by the skeptic), m 194.6 → 233.0
  (KHM #168 The Prismatic Bridge's gold back 233, STX #149's B|R back 233 —
  a mono-gold print does exist); the land backs u → 230.7 (MH3 #241), b →
  212.4 (ZNR #90; the pathways' b backs read 229–240), r → 227.8 (ZNR #134
  226, MH3 #246 229), g → 218.1 (ZNR #189). w stays (238 within STX #150's
  230 … KHM #15's 249; ZNR #12's 237), `a` / `c` stay (no print), the
  fronts stay (within 5–11). Ten masters re-cut (m15mdfcback u b r g m,
  m15mdfclandback u b r g m), each byte-identical outside the Flipside
  mask (bars, box, housing, body: 0 px differ; the built fills within
  ±0.5 luma of the targets). Two caveats for the sheet: the scans disagree
  by set — KHM's backs read 5–13 lighter than STX's on every key (u KHM #40
  242 vs STX #147 220, r KHM #123 237 vs STX #159 230, g KHM #181 234 vs
  STX #151 229; b KHM #112 219 vs STX #148 223), so the targets sit on STX
  with b on both — and a gain moves luma, not hue: Card Conjurer's tabs stay
  tinted in the frame's colour (ours u 199,226,244 · r 255,223,201 · g
  216,236,226 · m 255,235,163) where the prints' are near-neutral (STX #147
  216,221,228 · STX #159 228,228,245 · STX #151 226,227,245 · KHM #168
  233,233,234). The visual gate's record of the change is a
  template-scoped **sweep bump, layout v40** (v38 / v39's pattern: the
  modal faces, 0 cards on them, nothing re-bakes) — `tests/unit/frames/
  dfc-crowns-pairs.test.ts` holds the built strips to ±2.
- **What waits:** the ticks (the owner, after promote); the strip's colour
  on two-colour cards (above); the import's modal body / colour (5.4);
  the Marvel strip form; borderless / extended modal (5.7); the walker
  faces (5.13, ask first).

### Crowns and pairs on the double-faced bodies (5.1d)

TODO 5.1d, 2026-10-05 (`feat/dfc-crowns-pairs`; owner 2026-10-05: "go" on
crowns and two-colour frames for transform cards). Additions under the
owner rule: opt-in per card through the same switches, hints, import rule
and registry gaps as m15's (`frame_style.crown` / `twoColor`; a new DFC
card starts with both on; an import follows the printing; the save keeps a
switch only where the body draws it; no stored card changes, no bump for
them, no sweep, no badge).

| body | crown | pairs | printed references |
|---|---|---|---|
| `m15dfcfront` | `m15dfccrown` (LEFT well; `c` → `a`) | split | crowns VOW #21 w, #65 u, MID #109 b, MOM #137 r, #200 g, FIN #231 m, LCI #256 a; crowned pairs MID #246 R|G, #217 W|U, VOW #236 W|B, FIN #221 B|R, MID #233 U|B, BOT #7 R|W, FIN #219 U|R, #220 B|G, #240 G|W; uncrowned pairs MID #218 W|U, #231 R|G, INR #241 R|G, LCI #233 W|U |
| `m15dfcbackleft` | `m15dfccrown` (`c` → `a`) | split | VOW #21 w, #65 u, MID #109 b; pairs MID #246 R|G, #233 U|B; uncrowned pairs MID #218 W|U, #231 R|G backs (no r, g, m or a back was printed crowned in a left-well family — corrected in 5.0d, below the table) |
| `m15dfcback` | `m15dfccrownright` (RIGHT well; `c` → `a`) | split | FIN #39 w, MOM #63 u, #114 b, ECL #105 r, MOM #190 g, FIN #231 m, #272 a; pairs MOM #200 G|W, #75 U|B; uncrowned pair MOM #43 G|W |
| `m15dfclandfront` | `m15dfccrown` (`c` → `l`) | none | SLX #9 Havengul Laboratory (a colourless legendary land front: the land grey) |
| `m15dfclandback` | none | none | no legendary land back on this frame: LCI's / XLN's are the parchment back (5.8), SLX #9's the 2016–22 dark one |
| `m15mdfcfront` | `m15mdfccrown` (the housing; `c` → `a`) | split + hybrid | KHM #15 w, #40 u, #112 b, #123 r, #168 g; pairs MSH #219 W|U, STX #149 W|B (crowned, split); MH3 #252–261 (the ten hybrid fronts) |
| `m15mdfcback` | `m15mdfccrown` (`c` → `a`) | split | KHM #15 w, #40 u, #112 b, #123 r, #181 g, #168 m (gold); pairs MSH #219 W|U, #23 R|W, #49 R|G, #80 U|R, #18 G|W; STX #149's uncrowned B|R back |
| the modal land pair | none | none | no crowned or two-colour modal land face in print (the pathways and the MH3 land backs are mono) |

Surveyed on Scryfall (2026-10-05): every transform / modal printing on the
black-bordered 2015 frame (1,179; 682 with no showcase / borderless /
extended / etched / devoid / snow effect), classified per face —
scratchpad `dfc-1d/research/classified.json`.

**Corrected in 5.0d (2026-10-06): BOT's backs are the ▼-right body.** That
classifier took any `…dfc` frame effect for a left-well family, so BOT's
`convertdfc` — the plain ▲ / ▼ family, the ▼ at the RIGHT
(`dfcIconFamilyFromEffects`) — was counted on the 2016–22 back, and
`CROWN_REFERENCES.m15dfcbackleft` named BOT #6 Slicer, High-Speed Antagonist
(r) and BOT #12 Megatron, Destructive Force (m). Both backs print the ▼ at
the right, and the pin check refuses both on the left-well body. No red,
green, three-colour or colourless non-land legendary back was printed
crowned in a left-well family (Scryfall, 2026-10-06: 52 paper printings
carry a sun / moon, moon / Emrakul, compass or fan effect with `legendary`;
their legendary backs are w, u, b, the pairs W|U, U|B, W|B — VOW #236's
artifact — and R|G, and XLN's / RIX's lands; SOI #5's red Avacyn, the
Purifier predates the crown), so the two rows are gone and the compare
page's Legendary toggle on `m15dfcbackleft` r and m crowns the sample, as
on g and c. Round 31's sheet 2b was right all along: its bake spec derived
each body from the family, and its two BOT
cells are labelled and baked `m15dfcback/r` and `m15dfcback/m`. What was
wrong was the table (with the code comment and the TODO line that repeated
it) — so the toggle on those two rows drew the left-well body, a ▼ in its
LEFT well, beside a ▼-right scan. The crown PIECES of r and m are
unaffected: `m15dfccrown` is the front body's band too, shown there beside
MOM #137 and FIN #231. The `m15dfcback` r and m rows were always ECL #105
and FIN #231. A second slip in the same table: the two artifact prints
(LCI #256 on the transform front, FIN #272 on the ▼ back) were filed under
`a`, the crown's own key, while the toggle asks with the FRAME colour key —
so on those bodies' `c` rows it never found them and crowned the sample.
They are the `c` rows now, as on `m15artifact` and `m15land` (the crown
drawn is still `a`, through the slot's `keyMap`).
`tests/unit/cards/crown-references-dfc.test.ts` now holds every double-faced
row to its printing: the key the page asks with, the face it names, the
`legendary` effect, the colour of its key and the pin check of its own row.

- **The crown pieces are CUT bands, not twins.** Card Conjurer's own DFC
  crowns — 'Legend Crowns' (`m15/transform/crowns/regular/<k>.png`, cut
  round the LEFT well; `regular/new/<k>.png`, cut round the ▼ back's RIGHT
  well) and the modal 'Regular Legend Crowns' (`modal/crowns/regular/
  <k>.png`, cut round the housing), all 1418 × 350 at 2.74 / 1.91 / 94.54 ×
  16.67 % (x 41, y 40, 1:1 at HD) — carry the OLDER flat crown art, not the
  textured 'Legend Crowns (New)' band our m15crown is built from, so none
  is published. Each piece (`cutCrownBand`, `DFC_CROWN_WELLS` in
  `scripts/lib/cc-frames.mjs`) is the published m15crown band byte for byte
  outside the WELL REGION (the columns from the band's leg to the inset
  bar — x 80–235 on the left well, 1264–1419 on the right, 40–235 on the
  modal housing — rows 93–225); inside it the alpha is the twin's (the well
  cleared, the crown round it, the bar's edge where the bar starts) and the
  colour the band's OWN leg texture, its interior columns (60–77 / 1422–
  1439) mirror-tiled across the region on the same rows — the band has no
  pixels there: its hole is the plain M15 bar's, which starts at x 92,
  while a DFC bar starts past the well at 228 and the prints wrap the crown
  round the well with the ring on top (MID #246 Tovolar's sun well, VOW #21,
  MOM #190 Zilortha's ▼ well, KHM #112 Tergrid's housing on both faces).
  The fill is darkened only where the twin is darker than half its own leg
  (`DFC_CROWN_SHADE_KNEE`): CC's outline round the hole, never its smooth
  gradient (the prints' annulus reads 0.8–1.0 of the leg: MID #246 front
  1.04, its back 0.97, VOW #21 0.78, MOM #190 0.80 — the twin's 0.70 would
  be too dark). On the modal body the housing's tip reaches into the
  crown's leg, which keeps its own pixels under the twin's alpha. The
  transform twins' well is a circle (fitted on the twin's hole, 0.5 px:
  (143.5, 160.5) r 61.0 on the left, (1355.5, 160.5) r 60.8 on the right;
  the ▼ well's ring on the master spans 1296–1416), the modal twin's hole a
  teardrop (its point at x 59, row 160; its bottom at row 218); both end
  above the wrap under the bar, which stays the band's. Measured against
  the twins (scratchpad `dfc-1d/research/twins.json`): outside the well
  columns the twin's alpha lies entirely inside the band's (0 twin-only
  pixels in x 280–1220; the band's extra pixels there are its cover and
  the wrap's last 3 rows), and the twins' alphas are the same for every
  colour letter (the left `a` twin differs by ≤ 48 levels on 3,077 px).
  Keys per folder: w u b r g, m, a, l and the ten pairs (the pair band cut
  through the twin of the colour whose half the well is in) — never `c`
  (a DFC body's colourless is the artifact stand-in, `c` → `a`, or the land
  front's `l`). The slots (`DFC_CROWN_LEFT` / `DFC_CROWN_RIGHT` /
  `MDFC_CROWN`, `lib/cards/template-layout.ts`) are M15_CROWN's rect; the
  icon rider is declared AFTER the crown on the faces that have one (the
  well is cleared, so they never meet; the order keeps the glyph on top —
  `tests/unit/render/dfc-crowns-bake.test.tsx`).
- **The pair masters** are 4.6b's "m15" recipe over each body's OWN pack
  files and masks (`dfcPairLayers`, `DFC_PAIR_BODIES`): the gold frame
  whole (frontM / backM / m / mb), the text box lerped from the two colour
  frames across the rules ramp (45→57 %W) through the pack's Rules mask,
  the pinline across the pinline ramp (40→60) through the pack's Pinline
  mask; the modal front's hybrid dress the two fronts lerped across the
  frame ramp (44→57) under CC's grey Land frame's bars (`l.png` through
  the Title mask — the housing's fill is the Title mask's — and the Type
  mask) with the split box and pinline, the grey plate `pt/c`. No hairline
  on these packs: CC's transform and modal gold frames draw their ring rows
  where the colour frames do (the dark ring rows 100–103 / 218–221 / 1181–
  1184 / 1299–1302 on every file), unlike the borderless M frame (#449).
  Measured on the prints' title rings (per-row crossings at HD, scratchpad
  `dfc-1d/research/pairs.json`): the 2023+ printings split at 40→60 — LCI
  #233 41.7 / 49.5 / 57.4, the MH3 hybrids 41–43 / 49–52 / 58–60 (their
  frame band above the title 46–49 / 50–54 / 55–57 ≈ the 44→57 ramp) —
  and the Innistrad-era ones narrower, 45.5 / 51 / 56 (MID #218 / #231,
  INR #241, every ring row within 0.5 %W); the one 40→60 ramp of the FDN /
  TLA prints serves every DFC face, within 4 %W of Innistrad's. **The
  backs split too:** the design's "the gold backs never split (MOM #43)"
  was wrong — MOM #43's G|W back reads 44,74,47 → 133,135,129 across the
  title ring, the type ring and the box's top edge; MID #218's W|U, MID
  #246's R|G, EMN #191's R|G and STX #149's B|R backs the same, each over
  gold bars; and a legendary pair back's crown is the SPLIT crown (MID
  #246's back: a red leg 187,62,46 and a green leg 63,114,89; MOM #200,
  MSH #18 / #219 / #23 / #49 / #80) — so the three spell backs build the
  split dress over their back files and declare it (`twoColorMasters:
  ["split"]`), the back resolving its own pair from its own colours (the
  card-level switch), and the pair's crown with it. A pair BACK is toned
  like its mono backs — the gold bars (and the modal strip) at m's gains,
  the lerped box at the two colours' box gains lerped across the same
  rules ramp (`dfcPairBackTones`; `toneMasked` takes a ramped gain since
  5.1d) — so left of the ramp its box is the first colour's toned box,
  right of it the second's (`dfc-crowns-pairs.test.ts` holds ±6). No pair
  on a land body (no two-colour land face in print; the m15land land-tint
  recipe would also sit 1–2 px off the transform pack's pinline mask) and
  no hybrid dress on the transform front (no hybrid-cost transform front
  was printed) or on a back (MH3's hybrid fronts have land backs). The
  stamp notch: no DFC body declares a holo stamp (5.1a), so the pair
  notches are not involved.
- **Registry, import, creator:** the `crown` gap drops by itself on every
  body that declares the slot and the two-colour gaps where a body
  declares the dress (`gapDrawnBy` reads the profile), so KHM #112 Tergrid
  and MID #218 / #246 import `exact` on their bodies; BOT #1 stays
  `nearest` on its Vehicle back alone (`transform/2015+vehicle`, 5.10). The
  import's switches are the card's (`printed_crown` from the `legendary`
  effect, `printed_two_color` from the FRONT face's pair, which also stores
  the pair as the identity on a front that draws pairs); a back face
  qualifies for its own crown by its own supertype (`backPreviewData`
  carries the card's switches) and resolves its own pair from its own
  colours. The creator's one crown switch reads EITHER face (the skeptic's
  fix): a nonlegendary front with a legendary back on a back body that
  draws the crown (MOM #43's shape, Westvale Abbey // Ormendahl) shows the
  row — judged on the body the back's type and family derive (`bodyFor`,
  as the live preview does), never on the ▼ land back or the modal land
  pair, which draw none. The creator's hint for an all-hybrid cost on the
  transform front ("This frame has no hybrid version yet…") is the
  existing copy. `CROWN_REFERENCES` names a crowned print per body per key
  (the table above) for the compare page's Legendary toggle — a back body's
  reference is the printing's BACK face (`faceUnderTest`).
- **Verification:** the crown rides each colour's tick, a pair its body's
  `m` tick (V-A); the owner signs the round-31 sheets off in the PR and
  re-judges nothing (the crowns and pairs are opt-in additions on bodies
  with no tick yet). The strips (above) land before the first tick.
- **Tests:** `tests/unit/frames/dfc-crowns-pairs.test.ts` (the recipes, the
  ramped gain, the cut's geometry on a synthetic band and twin, what the
  profiles declare and the save keeps, the published masters — the pair's
  bars and body the gold master's, its box the colours' toned boxes, its
  title ring 40→60 centred on 50; the pieces the band outside the well,
  the hole a circle, the fill the band's leg; with the Card Conjurer cache
  a fresh cut reproduces the published piece byte for byte),
  `tests/unit/render/dfc-crowns-bake.test.tsx` (real bakes: the crown's
  piece under the rider, the switch absent byte-identical, the pair
  master and the pair's crown on a front and on each back, the modal
  faces, the land back drawing neither), the matrix's `@crown` / `@pair`
  cases on every declared body (`tests/visual/matrix.ts`: 63 new cases, 0 redefined; the 10 re-toned backs change their existing modal-back cases under v40, and the reverse-P/T float the ten `m15dfclandfront` long cases — 41 changed against main's baseline, every one in v40's scope).
- **Skeptic pass (2026-10-05, on 9be382ad):** every one of the 248
  promote objects re-fetched from the DEV bucket by manifest key
  (248 / 248 at the manifest's sha256 and bytes; main's 20 old objects
  still there); the 187 PNG + WebP of the ten templates and three cut
  folders rebuilt through the committed importer into a FRESH Card
  Conjurer cache (97 pack files fetched) — 374 / 374 byte-identical to
  the manifest, the provenance unchanged. Measured on the scans with own
  regions: **the two-colour backs DO split** — MOM #43's G|W back (a
  mono-white front) reads green 25,67,44 at the left of its type ring and
  white 141,139,139 at the right, its box 159,172,162 → 202,198,187 over
  gold bars (186,161,87 / 181,157,89); MID #246 R|G 95,36,31 → 28,50,42;
  MID #218 W|U 139,136,133 → 22,50,94; EMN #191, STX #149, MSH #219, MOM
  #200 / #75 the same — the 5.12 note was wrong and the 30 back pair
  masters stay. KHM #168's back is a gold modal back on the plain frame
  (gold bars 175,141,54, body 132,120,76, an unsplit box), its tab 233.4
  on the tab's own rows. Our pair masters: the gold master byte for byte
  outside the Rules + Pinline masks on all 60, the box and ring left of
  38 %W the first colour's and right of 62 %W the second's (the ~1,500 px
  that differ are the masks' anti-aliased edges), every title / type /
  box ring crossing 42 / 50 / 58, and the ring rows of the colour masters
  and the gold one coincide (100–103 / 1181–1184 / 1299–1302 on every
  file) — no hairline. The prints' rings: LCI #233 41.7 / 49.4 / 57.4 and
  MOM #43's back 41.7 / 51.6 / 60.4 on the 40→60 ramp; the Innistrad-era
  faces 45–46 / 50–51 / 55–56 (MID #218 front and back, MID #231, INR
  #241) and MSH #219's title ring 46.3 / 49.8 / 54.6 narrower, as the PR
  says. The 54 cut pieces: 0 px differ from the m15crown band outside the
  well region, the alpha inside it the twin's to the pixel, no pixel
  brighter than the tiled leg, the hole a circle (143.5, 160.5) r 61.0 /
  (1355.5, 160.5) r 60.8 (fit 0.5 px) ending at row 220, the modal
  teardrop at 216; the unshaded fill is the band's leg within 1–8 levels
  on the left well and the modal housing, but the RIGHT well's b and g
  pieces average 19–29 levels above the leg's reference rows (the band's
  right leg is lighter at the well's rows than at the reference's; the
  piece is still the band's own pixels, never brightened). The strips: the
  toned masters differ from main's on 0 px outside CC's Flipside mask, only
  brighter inside it, the outline and ◀ still 0; on rows inside the tab
  (1878–1884 + 1936–1942, x 120–480) u 220.0, b 221.1, r 230.1, m 232.8
  and the land backs within 0.9 of their prints — g read 224.6 against STX
  #151's 228.9 (the first cut's rows hit that scan's outline), re-cut to
  228.9 (`MDFC_BACK_TONES.g.strip` 1.141). Fixed: the creator's crown
  switch for a legendary BACK under a nonlegendary front; and the reverse
  P/T's digits running under dense rules text (sheet 4) — not as a plain
  keep-out (tried: the tab's rows, 84.2–87.8 %H, sit 80–155 px above the
  box's bottom, so any block taller than ~277 px has lines there, and the
  layout's one remedy for a keep-out hit, stepping the size down, reached
  the 42 px floor with 455 px of ink still under "12/12") but as a rules
  FLOAT, the prints' setting: `RulesLayoutInput.floats`
  (`lib/cards/rules-layout.ts`) — the lines whose box rows meet a float
  break against a column ending at its left edge (`floatColumnsFor`, settled
  with the side insets in `layoutParsedAt`, a float that would leave under
  a quarter of the column narrowing nothing), and a float is a keep-out
  too, so ink still entering it steps the size down; `DrawnStats.reversePt`
  (`drawnFloats`, never `drawnStatInk`) carries the digits' footprint from
  both renderers (`endAlignedStatKeepOut`: the value's laid-out width plus
  a quarter em of air, end-aligned at 92.87 %W over the tab's rows) only
  while they are drawn. The plate, stamp and strip stay keep-outs (a box
  without floats settles as it always has: the 120-row production replay
  at 750 + HD on 081ac82f and the final head is 120 / 120 identical); the
  two transform front bodies join v40's scope (their long bakes change;
  no tick, no card). `tests/unit/render/dfc-reverse-pt-float.test.tsx`: the
  footprint, the layout (the lines meeting the digits end before them at
  both targets, the ones above keep the column, two ladder steps at most
  against the text set free, nothing clipped), a real bake with no rules
  ink under 12/12 beside the same text running under an aura back's empty
  tab.

### The flipside strip rider (5.1c)

TODO 5.1c, 2026-10-06 (`feat/dfc-strip-rider`; owner round 30: the strip's
colour follows the prints after the ticks). On a modal card the prints
paint the flipside strip in the colour of the face it DESCRIBES, while
every master paints it in its own. An addition under the owner rule: no
stored card changes (none sits on a modal body), nothing re-bakes, no
badge; a mono-colour card keeps the master's bytes. The visual gate records
it as layout v41 (below). **Owner round 32 (2026-10-06): all five sheets
signed off as built** — the rider draws only when the other face's colour
differs from the master's own, the light back tabs keep Card Conjurer's
tint, the brightness targets stay on STX (the decisions are at the end of
this section).

- **The rule, measured on every modal scan** (`scratchpad/dfc-1c/research/
  prints-rule2.json`: per-channel medians of the tab's text-free pixels at
  HD): the strip is painted in the colour of the FRAME the other face
  wears. A mono-colour face → its letter — STX #147's green front carries
  a BLUE tab for Echoing Equation (55,119,191), STX #148's a black one
  (93,89,87), STX #151's a green (53,100,80), STX #159's a red
  (180,80,58); a coloured artifact its colour (KHM #15's white Sword of the
  Realms 170,160,151, KHM #112's black Lantern 99,95,84, KHM #123's red
  Harnfel 199,79,45); the pathways their back's (ZNR #258 W 140,133,130,
  #259 B 75,71,64, #260 B 102,97,87, #261 G 49,91,64, KHM #252 R
  197,77,43). A two-colour spell → GOLD: STX #149's front for its B/R back
  (160,143,111), KHM #114 Valki's for Tibalt (177,154,102), KHM #168's for
  the five-colour Bridge (173,150,98), KHM #179's, MSH #18's and #219's
  (149–150,132,90) — and on a back MSH #219's cream (246,239,211); STX
  #149's back (for W/B Extus) prints that gold tab near-white
  (240,232,230), the one light rendering. A two-colour LAND → the LAND
  GREY: MH3 #252–261's ten hybrid fronts, whose backs add two colours, all
  read 113,99,88 — CC's grey land modal's tab (`l.png`, 123,107,97), not
  gold. A front in the HYBRID dress → the land grey too: MH3 #252's land
  back reads 218,210,206, a warm light grey (the hybrid frame's bars are
  the grey land frame's; `lb.png`'s tab 206,192,183), never the gold
  cream. A colourless spell has no print on this frame (STX #6 Wandering
  Archaic is the see-through frame, its tab 116,102,100): the artifact
  stand-in. The back tabs the 5.1d gains were fitted on describe the OTHER
  face (STX #147's back tab is a green strip, KHM #168's a green one), all
  near-neutral — the lumas stand.
- **The key** (`lib/cards/faces.ts` `stripKeyOf`, on `DfcOtherFace.stripKey`
  — the one source both renderers read): a mono-colour face its letter; a
  land with no colour or more than one `l`; a two-colour spell `m`, or `l`
  when it is drawn in the hybrid dress (`wearsHybrid`: the two-colour look
  both renderers resolve, `resolveTwoColor` on the face's own template —
  the switch, a pair, an all-hybrid cost, a template with hybrid masters);
  a colourless spell `c`. The key starts from the key the face's MASTER is
  picked by (`pickFrameColorKey`, the 5.1c skeptic): the colour chip's and
  the 5.4 import's literal `multicolor` (`backFrameColorsFromScryfall`
  stores a two-colour back that way) is the gold master, so its strip is
  gold — the builder's re-count of colour words had made it the artifact
  tab. A back with no colour of its own follows the front's
  (backPreviewData's rule), so an unfinished back is mono.
- **The pieces** (`scripts/lib/cc-frames.mjs` `MDFC_STRIP_CUTS`;
  `<template>/strip/<key>.png` + `.webp`, 658 × 90): each modal template's
  OWN masters' tabs — the land pair's tab is a pixel off the spell pair's
  and its back is toned on its own table, so four folders — cut through
  CC's Flipside mask (`reminder.svg`: the whole tab, x 45–701 × y 1866–1955
  at HD, 53,828 full-alpha px and a 352-px rim), its full-alpha interior
  ERODED by one pixel (`insideMaskEroded`, 52,490 px) so the cut runs
  inside the tab's 4-px dark outline — the tab's outermost ring is luma 0
  on every master, so a cross-colour rider meets black on black on both
  sides of the cut (invisible: the contact sheet) — and then SNAPPED to the
  HD grid's 2 × 2 px blocks (`snapToBlocks` / `stripRiderInterior`, the
  5.1c skeptic: 51,208 px, every block kept whole or dropped), so the 750
  bake's 2:1 resample reads exactly one block per pixel and a piece over
  its own master is byte-identical at HD AND at 750 (0 px on all 28
  own-key pieces through the bake's rasteriser; the cut's opaque edge
  pixels luma ≤ 12, their clear neighbours ≤ 1 — the fill is never
  reached). Alpha 0 / 255, never a partial pixel of the cut's own at either
  preset; the box x 44–701 × y 1866–1955 (the mask's bbox grown to an even
  origin and size: 1:1 at HD, 2:1 at 750, the blocks aligned; the cut
  itself spans x 48–699 × y 1868–1953). A piece carries its tab's own ◀
  and the inner part of its outline (2,693–2,986 dark px), so their
  anti-aliasing is against the piece's own fill; the outline's outer ring
  stays the host master's. Keys: w u b r g m a (spell bodies; `c` → `a`) /
  w u b r g m c (land bodies; `l` → `c`), plus `l` on the spell bodies cut
  from the land pair's grey `c` master (`l.png` / `lb.png` byte for byte).
  30 pieces, 60 objects, 54 distinct blobs (230,638 bytes): the spell
  bodies' `l` is the land pair's `c`, and the gold BACK tab is one blob on
  the spell back and the land back. The
  pieces are cut AFTER the template loop from the published masters
  (`localMaster`: this run's own output first, else a copy at the
  manifest's sha256) — the 120 modal PNG + WebP rebuilt from the cache
  reproduced the manifest first; the provenance records each template's
  `strip` (mask, box, erosion, keys, sources, the sha of each master).
- **The renderers:** `FrameOverlaySlot` `anatomy: "mdfcStrip"` on the four
  modal PROFILES entries after the crown (`MDFC_STRIP_RIDER_FRONT` / `_BACK`
  / `_LAND_FRONT` / `_LAND_BACK`, `lib/cards/template-layout.ts`), resolved
  by `resolveFrameOverlays` from `facts.dfc.stripKey` through the slot's
  keyMap, **only when it differs from the key the master already paints**
  (`mdfcStripOwnKey`: the face's colour key; `m` on a split pair master,
  whose strip is the gold master's byte for byte; none on the hybrid dress,
  whose strip is lerped). Both renderers draw it where they draw the crown
  (the bake's overlay `<img>`s at z 5, the preview's `FrameOverlayLayer`),
  under the strip's texts (z 22); the keep-out is unchanged; the finish
  masks take it like the crown. `frameAssetPathsFor` preloads it.
- **Why not "always" (the brief said always):** the builder's eroded cut
  was byte-identical over its own master at HD on every key but never at
  the 750 bake — the 2:1 resample blended the cut's edge on the chevron's
  diagonals (1–3 px at ≤ 4 levels on the spell faces and the land backs,
  5–6 px at ≤ 7 on the land fronts; the plain mask's cut 35 px at ≤ 45) —
  so the visual gate's mono modal cases could not have stayed at 0 changed
  without a bump, and the no-op was skipped. The 5.1c skeptic refuted "no
  cut can block-align": the eroded interior snapped to the HD grid's 2 × 2
  px blocks is 0 px at BOTH presets on all 28 own-key pieces (a real bake
  on a busy synthetic master proves the slot lands the blocks 1:1 at 750
  too), with the cut still inside the outline; those are the published
  pieces now. So "always" became possible (a one-line change,
  `resolveFrameOverlays` without the `mdfcStripOwnKey` skip — a mono card's
  bake would be the same bytes either way) — and **the skip rule stays by
  the owner's choice** (round 32, 2026-10-06): the rider draws ONLY when
  the other face's colour differs from the master's own. One tone source
  either way: the pieces ARE the masters' tabs.
- **The compare page** (`lib/scryfall/reference-preview.ts`
  `withComparedBack`, the 5.1c skeptic): viewed from the FRONT, a
  reference's back used to carry content alone (`backFaceFromPatch`), and a
  back with no colour follows the front's — so every two-colour reference
  drew its own colour's tab beside a scan that prints the back's: all five
  land-front references are pathways. On a MODAL front body under test
  the back now carries its own printed colour (`referenceBackColorIdentity`:
  a modal land's is its mana's) and the body its type derives (`bodyFor`),
  as the import stores it; a walker back, which the import keeps off the
  bodies (5.13), takes the colour alone and stays a legacy back (KHM #114's
  front wears Tibalt's gold); a transform front, which draws nothing from
  its back's colour, and every other template are untouched. Through
  the real payload and Scryfall, the 51 references of the four faces:
  `m15mdfcback` — all six primaries draw a rider (STX #150 r, #147 g, #148
  g, #159 u, #151 u, MSH #18 w), the eight KHM alternates none (same-colour
  cards); `m15mdfclandfront` — all five primaries (ZNR #259 b, #260 b, KHM
  #252 r, ZNR #261 g, #258 w) and the three KHM alternates; `m15mdfcfront`
  — `m` (MH3 #252 → `l`) and four alternates (STX #159 r, #150 w, #147 u,
  MH3 #260 l), the five mono primaries and six KHM gods none;
  `m15mdfclandback` — the five primaries none (a land back under a
  same-colour spell), all eight pathway alternates one.
- **The ticks:** v41 is NOT verification-neutral (below), so a tick made
  on any of the four modal faces before it is KEPT — the row stays
  verified, the creator and the import go on offering that face — and the
  admin checklist flags it "Needs re-verification: the renderer changed
  since layout v40 (now v41)" until the owner ticks the box again
  (`verificationState`; `getVerifiedFrameKeys` reads `verified` alone).
  Nothing is dropped; a mono-colour card's bake is unchanged.
- **Owner round 32 (2026-10-06), on the five sheets: all signed off as
  built.** (1) The rider draws only when the other face's colour differs
  from the master's own — the skip rule stays although the snapped cut is
  byte-identical at both presets. (2) The light back tabs KEEP Card
  Conjurer's tint (ours u 199,226,244 · r 255,223,201 · g 216,236,226 · m
  255,235,163 against the prints' near-neutral STX #147 216,221,229, #159
  228,228,246, #151 226,227,246, KHM #168 233,234,235): no neutral-hue
  variant — the one sketched in the scratchpad is not built into the
  importer and nothing of it is published. (3) The brightness targets stay
  on STX (the KHM scans read 5–13 lighter). STX #149's near-white gold tab
  and the hybrid back's warm grey are followed as measured.
- **Tests:** `tests/unit/frames/mdfc-strip-rider.test.ts` (the recipe, the
  cut and its findings on a synthetic master, the snap on a synthetic mask
  (`snapToBlocks`: whole blocks or none), the key rule — the import's
  literal `multicolor` included — what the profiles declare and the
  resolver draws (mono none, the other face's key, the split's gold, the
  hybrid's `l`, the land pair), and, with the bucket's PNGs on disk
  (`FRAMES_BUILD_DIR`; CI fetches them from production or, before the
  promote, the dev bucket, and a missing one fails there): every piece its
  master's tab (0 px in colour, alpha binary), ONE cut for all thirty —
  51,208 px in whole 2 × 2 blocks, its shape pinned by a sha256 — and the
  identity through the bake's rasteriser at HD AND at 750 on the 28
  own-key pieces (0 px; another key's piece repaints the tab and nothing
  outside the box). None of that needs a Card Conjurer file; where this
  machine's importer cache is (never in CI: those two cases SKIP there —
  the first cut of this file asserted the cache and turned CI's unit job
  red on 4600abaf) the cut is shown to be the Flipside mask's interior
  eroded and snapped, a fresh cut reproduces every piece byte for byte and
  the un-snapped cut's 750 residual is shown real),
  `tests/unit/render/mdfc-strip-rider-bake.test.tsx` (real bakes: the
  paths and the order after the crown, the piece under the white / dark
  texts, the keep-out diff, the 1:1 placement on a synthetic master at both
  presets), `tests/unit/components/mdfc-strip-rider-preview.test.tsx` (the
  preview's twin), `tests/unit/scryfall/reference-preview-strip.test.ts`
  (the compare page: a pathway, STX #147's and #149's shapes, a mono card,
  KHM #114's walker back, a plain frame untouched),
  `tests/unit/cards/layout-version.test.ts` (v41: a sweep scoped to the
  four faces, not neutral — a v40 tick on a modal face is stale, one on
  m15 is not), the matrix's 13 `@strip-*` cases (new; the 14 existing
  two-colour-other-face modal cases change under v41's scope, every mono
  case unchanged, 0 redefined), `profiles-base.json` regenerated (the four
  overlays).
- **Layout v41** (`lib/cards/layout-version.ts`): the visual gate refuses a
  changed existing case without a bump, and the matrix already held
  two-colour-other-face modal cases (the Tibalt word case's B/R back, the
  `wu` / `wub` / `c` rows' two-colour and colourless land backs, the hybrid
  pair, the gold land pair) — template-scoped to the four modal faces,
  "sweep" as v40 (0 cards on any modal body: it re-bakes and badges
  nothing; the cron stamps every other v40 card 41 without baking it), and
  NOT verification-neutral (the 5.1c skeptic; the first cut had it neutral
  "because a tick is made on a mono-colour print"): no master, slot or
  text moves, but 12 of the 22 primary references — every spell-back and
  land-front one, and the spell front's `m` — draw a rider on the compare
  page now, and so do 15 alternates, the land back's eight among them (the
  list above); a tick made there before v41 judged a look that no longer
  renders. Every template has such a reference and a tick's scope is its
  template, so the four faces' ticks are judged by the bump's own scope
  (no `VERIFICATION_TEMPLATE_SCOPES` entry narrows it, as v38 / v39): kept
  and flagged for a re-check, never dropped ("The ticks", above).

- **Skeptic pass (2026-10-06, on 4600abaf):** the 60 objects re-fetched
  from the DEV bucket by manifest key (60 / 60 at the manifest's sha256 and
  bytes, the first cut's and then the re-cut's); the four templates rebuilt
  through the committed importer into a FRESH Card Conjurer cache (28 pack
  files fetched): 180 / 180 objects byte-identical to the manifest before
  the re-cut, the 120 masters still identical after it. The rule
  re-measured with own regions (the luma-mode band of the tab's interior
  and two text-free edge bands) on every modal scan: every number within 3
  levels of the first measurement, no print contradicts the key table —
  STX #154's front (a black artifact with a mono-GREEN back, {3}{G}{G})
  prints green; all nine MH3 hybrid fronts on disk (#252, #254–261) read
  exactly 113,99,88; MH3 #252's land back WEARS the grey land frame (its
  bars 161,147,138, its box 198,159,141 — not the gold land stand-in's
  161,135,71), so "the frame the other face wears" holds literally there;
  the light back tabs follow the front's colour in a pale palette (a green
  front: STX #147 216,221,229 = ZNR #189 216,220,227; a blue one: STX #151
  / #159 226–228,227–228,245–246). The split pair masters' tabs are the
  gold master's inside the cut (0 px on all 20; 104–126 px differ on the
  mask's rim, outside it); the hybrid dress paints the FIRST colour's tab
  with its tip lerped towards the second (778–887 px inside the cut), which
  a rider always covers. Real bakes with the real masters, on main and on
  the head (12 cards, both faces, 750 + HD): a mono card's and a split
  pair's four PNGs byte-identical to main's; every ridden face differs on
  0 px OUTSIDE the piece's box — a long rules text, a foil and an etched
  card included — and its tab's fill is the key's. The preview in Chromium
  at the HD width against the same bakes: the overlay's box x 44, y 1866,
  658 × 90 exactly, the layer at z 5 under the word at z 22, the fill
  within 1 level, the silhouette within 21 / 52 px of 14–15 thousand — the
  WebP-against-PNG noise a mono card's master shows by itself. Found and
  fixed: `stripKeyOf` re-counted colour WORDS, so the colour chip's and the
  import's literal `multicolor` (STX #149's back as
  `backFrameColorsFromScryfall` stores it) drew the ARTIFACT tab where the
  back is drawn gold — it keys from `pickFrameColorKey` now; the compare
  page's front view never knew the back's colour ("The compare page",
  above); v41 was listed verification-neutral; "no cut can block-align" was
  wrong — the 2 × 2-snapped cut is 0 px at both presets, built and
  published (60 new objects; the first cut's 60 stay in the dev bucket
  unreferenced); CI's unit job was red on 4600abaf because two tests
  asserted Card Conjurer's mask, which CI never has (the pieces themselves
  were there: `frames-fetch` takes them from the dev bucket before the
  promote); and the first measurement's copies of `m15mdfcback/g.png` were
  the pre-recut master (tab 211,232,222 / 224.6) where the manifest's is
  the 5.1d re-cut (216,236,226 / 228.9) — the piece was always cut from
  the true one. Left alone, reported: the compare page draws the default
  icon family on a transform body whatever the printing's (MID's backs on
  `m15dfcbackleft` show ▼ for the moon) and its scorer bakes a front
  without its cross-face block — both 5.1a's, neither this change's.

### The battle's back (5.5 (a))

TODO 5.5 (a), 2026-10-14 (`feat/dfc-battle-backs`). An ADDITION: no layout
bump, no sweep, no badge, no new master.

- **The body.** The `battle` PROFILES entry declares
  `dfc: { layout: "transform", role: "front", well: "left", battle: true }`:
  a transform FRONT whose back is the portrait ▼ back `bodyFor` derives
  (`m15dfcback`; a land back the land back). A battle wears no icon
  family (every battle printed — MOM 2023, INR #120 — is the plain ▲ / ▼):
  `anatomy.dfcIcon` is false there, the gate and the import use the
  default. It is not a front of the Transform kind (`dfcFront` capability,
  `dfcKindFor`, `frontBodyFor` leave it out): it stays the Battle kind.
- **The back is OPTIONAL** (`DfcProfile.battle`, `isBattleFront`). A battle
  with no back, or with a LEGACY back (its content and no body — what every
  battle import stored before 5.5), is what it was: the gate
  (`resolveDfcBackFace`) keeps it as sent (a legacy back's colour is never
  stored), the faces draw no cross-face block (`faces.ts dfcBlock`: a battle
  only beside a back with a body), nothing is baked for the back and the
  page keeps its name. A back that names its body is gated like any
  double-faced back: the ▼ back of its type, verified in its colour, its
  stored body and colour winning on an edit, no cost. `hasBackOfItsOwn`
  is the one predicate for "two pictures" (the remix's price and second
  picture, the page name).
- **The front's tab.** The battle master already paints the grey tab at the
  text box's right end (above the shield); the back's P/T is drawn there as
  the transform front's is (`BATTLE_REVERSE_PT`: #777, 61 px, end-aligned,
  a rules FLOAT), only while the back prints one. Measured on seventeen MOM
  fronts with a creature back (Scryfall PNGs turned and scaled to 2100 ×
  1500): the digits' ink ends at 1940–1943 px (median 1941.5) and spans
  1223–1269 px down; ours end at 1942 and span 1221–1269. An enchantment,
  sorcery or artifact back leaves the tab empty, as print does (MOM #64).
- **The crown** is the card's switch (`frame_style.crown`) and the ▼ back
  draws it: `frameAnatomyOf("battle").crown` is true so the save keeps it,
  the battle front itself draws none (its profile declares no crown band).
  The import names it from the printing's `legendary` effect (the ten MOM /
  PMOM legendary backs). A two-colour back wears the gold master: the
  battle declares no pair masters (its front has none) — and stays so
  (owner Round 68: no follow-up).
- **The import** (`dfcImportOf`): a battle printing lands on the battle
  frame with its back on the ▼ back once BOTH combos are verified (the
  battle in the front's colour, the ▼ back in the back's), else as before —
  the battle with a legacy back (`withoutDfcLanding` keeps the battle's
  kind and frame; the patch keeps the printing's back colour so the creator
  knows the back's body isn't published in it). A walker back (MOM #239
  Teferi) imports the front alone (5.13). The registry's `dfc` gap is
  drawn by the battle frame now (`era/2015`), the Nyx, Vehicle and
  two-colour gaps stay.
- **The creator** (`lib/creator/battle-back.ts`): a NEW battle edits its
  back on the Front | Back switch (BACK_FIELD_STEP; the Card step's back
  type and colour) once the ▼ back is published in some colour, with its
  back on from the start; an edit or remix only where the stored back has a
  body. A battle saved with one face, or with a legacy back, keeps today's
  editor: the switch with its Back tab greyed and the reason. The back
  saves on its body only while that is published in its colour, else as a
  legacy back — the live preview reads the same rule.
- **The back is the maker's choice** (owner Round 68): a new battle's Card
  step has a **Faces** row — "Two faces" | "One face", a single-select
  `ChipGroup` (one tab stop, arrows move, Space / Enter picks), under the
  card type (`BattleBackSection`, `panels/dfc-setup-sections.tsx`). "One
  face" is `has_back_face` off: the Back tab greys with "This battle has
  one face — choose Two faces on the Card step to give it a back", nothing
  of the back is asked for, and the battle saves one-faced — no
  `back_face`, one PNG — exactly as on main; the back's fields stay in the
  form for the visit, so "Two faces" brings them back. Nothing forces a
  battle's back on (the form's forced-second-part effect skips a battle);
  an import of a battle with no back the import keeps (a walker back) is
  one-faced. An edit has no row: the card keeps the faces it was saved
  with.
- **The crown switch** is shown only for a back that is a face of its own
  (`BackIsOwnFaceContext`, provided by the form for a battle): an edit of a
  battle with a legacy back — legendary or not — shows no switch, as main.
- **Older stored battles** keep their legacy back (owner Round 68: no
  move onto the ▼ back is offered).
- **Shapes.** The preview shows a battle's portrait back in a portrait box
  (a plain swap of the faces, not a turn); a tile turns it in the portrait
  tile, the landscape front letterboxed as a one-faced battle's is
  (`BakedCardFlip frontLandscape`); `?faces=both` sets the landscape front
  beside the portrait back, centred on its height, the gutter the portrait
  card's (60 / 30 px); the PDF turns the landscape page as before.

### The double-faced saga front (5.5 (b))

TODO 5.5 (b), PR 1, 2026-10-16 (`feat/dfc-saga-front`). An ADDITION: a new
template, `sagadfcfront`; no layout bump, no sweep, no badge; stored sagas
keep their look (a saga imported before it keeps its one-faced frame and its
legacy back).

- **The master** is Card Conjurer's 'Saga (Transform)' pack
  (packSagaDFC.js, seven masters: w u b r g m and the land frame as `c`, no
  artifact one), frames bucket only. Measured on the masters, it is the
  4.21c saga master pixel for pixel but in two places: the TITLE BAR is the
  transform front's (its icon well at the left, rows 89–223) and the RIBBON
  is cut 110 px short (its tip at 1635 px, the regular's at 1745) for the
  grey reverse-P/T tab notched into the left border. The art window is the
  saga's (752–1384 × 237–1758 px on all seven), so the art slot is.
- **The profile** (`SAGADFCFRONT`) is the saga's — its rail, badges,
  dividers, sizes, symbol — with: the name from the left-well inset
  (`DFC_ICON_FACE_TITLE_LEFT_PCT`: the prints' ink at 250–251 px, as on
  every left-well face); the icon rider (`DFC_ICON_RIDER`, the card's
  family: NEO's closed fan, TLA's ▲); the back's P/T LEFT-aligned at the tab
  (`SAGA_DFC_REVERSE_PT`, the transform tab's ink — 61 px, #777, no plate —
  in CC's 'Reverse PT' box: the prints' digits start at 125–133 px, median
  128, over 1679–1682 → 1724–1727 px; on a real HD bake "2/2" inks 128–213 ×
  1679–1727), drawn only while the back prints a P/T; and the chapters'
  rail ending at the tab's top (`SAGA_DFC_RAIL_FOOT_PX`, 1664 px: no print's
  chapter ink passes ~1655 px — Fable of the Mirror-Breaker #141 1649,
  Teachings of the Kirin #212 1653 — and the ribbon, the last badge on it,
  stops at 1635). The digits sit LEFT of the chapters' column (from 203 px)
  and under the rail's foot, so no chapter line ever shares a row with them:
  the rail needs no float (`endAlignedStatKeepOut` reads a start-aligned slot
  too, from its left edge, for any rules box that would).
- **The body.** `DfcProfile.saga`: a transform FRONT that is the SAGA kind's
  frame (the kind's second `layoutTemplates` entry; `kindFromCard` →
  `saga`), never a front of the Transform kind (`dfcFront` capability,
  `dfcKindFor`, `frontBodyFor` and `bodyFor` leave it out — `isOwnKindFront`
  names it beside the battle). Unlike the battle's, its back is REQUIRED
  (the master paints the well): `resolveDfcBackFace` gates it as every
  double-faced back — the body the card's family derives (NEO's fans → the
  2016–22 back with the open fan; the arrows → the ▼ back), verified in the
  back's colour, the stored body and colour winning on an edit, no cost. The
  front is a saga and nothing else (`dfcFrontTypeError`: an enchantment). The
  crown is the card's switch, drawn by its back (TLA #117's legendary
  back), as the battle's; the front declares no pair masters (a two-colour
  saga wears the gold master: NEO #221 is nearest for it).
- **The creator.** A NEW saga's Card step has a **Faces** row — "One face"
  (the saga frame) | "Two faces" (this front), a single-select `ChipGroup`
  (`SagaFacesSection`, `panels/dfc-setup-sections.tsx`), "Two faces" off
  with "Frames awaiting verification" until the front AND the default back
  are published in some colour (`sagaTwoFacesAvailable`). The pick IS the
  frame (a Frame tile does the same); with two faces the card wears the icon
  pairs' chips and the **Saga | Back face** switch (`SECOND_PART_WORDS.saga`,
  the back a creature to start), and `dfcLayoutForCard` answers "transform"
  for it everywhere the form asks the kind. Going back to one face puts the
  back aside for the visit (Two faces brings it back) and the saga saves
  one-faced — never as a legacy back. A colourless saga moving to two faces
  takes the first colour both faces are published in and says so ("A
  double-faced saga needs a colour — switched the colour to …"; a colourless
  back needs an Artifact word); where no colour has both, it stays and the
  line says it can't be saved with two faces until one does — the save is
  then refused on the back's colour in the same words
  (`lib/creator/saga-faces.ts`, owner Round 73). An edit keeps the faces the card was saved with.
- **The import** (`dfcImportOf`, kind `saga`): a transforming Saga whose
  back has a body lands on this front with its back on the body its family
  derives once BOTH combos are verified (`saga/dfc/2015`, exact; NEO's
  showcase and extended-art dresses and the borderless printings nearest on
  the same bodies; TLA's under the Nyx starfield nearest, the
  `nyx-saga-front` gap), else exactly as on main: the one-faced saga frame
  with a legacy back and no family (`withoutDfcLanding`;
  `tests/unit/scryfall/saga-dfc-imports.test.ts` holds all 124 paper
  printings to origin/main's landing). A Saga BACK (MOM's praetors, LCI
  #189, FIN's summons) has no body yet (PR 2), and TLA's colourless Avatar
  backs are 5.11's see-through faces (`dfc/colourless-face`). The AI deck
  remix follows the import (`remixFrameFor`, `dfcImportLanding`), its second
  picture a transform back's (`remixSecondHalfLayout`).

### The double-faced saga back (5.5 (b), PR 2)

TODO 5.5 (b), PR 2, 2026-10-18 (`feat/dfc-saga-back`). An ADDITION: a new
back body, `sagadfcback`; no layout bump, no sweep, no badge; stored cards
keep their look (a Saga back saved before it keeps the ▼ back, or its legacy
back).

- **What it dresses.** The back of a transform card whose BACK face is a
  Saga: March of the Machine's five praetors (MOM #12 Elesh Norn // The
  Argent Etchings, #65, #125, #169, #213 and their prerelease promos) and
  LCI #189 Huatli, Poet of Unity // Roar of the Fifth People (and the #296
  showcase). Every one wears today's ▼ (no family effect): no print wears a
  2016–22 saga back, so the body is the ▼ one alone. FIN's summons are saga
  CREATURE backs — a P/T on the dark back's plate — and are TODO 4.5d's
  body, not this one; REX #7's back is a land.
- **The masters** are PipGlyph's own composite of published masters
  (`scripts/build-saga-back-frames.mjs`, every number in
  `scripts/lib/saga-back.mjs`; frames bucket only, provenance in
  `lib/cards/frame-sources.json`): the 4.21c `saga/<k>` master whole, with
  `m15dfcback/<k>`'s dark title bar and ▼ well laid over it through Card
  Conjurer's 'Transform (Back) (New)' title mask, and its type bar through
  CC's M15 type mask moved down 593 px onto the saga's type row (the saga
  pack's own type mask is M15's moved 593 px — the run refuses any other
  fit within ±2 rows). Keys w u b r g m c (`c`: the saga's land frame
  under the bronze bars, untoned — no print).
- **Toned onto print before the first tick** (owner 2026-10-17), with the
  importer's tone (`toneSourceRegions`: hue kept on the highlights, black
  stays black; a pixel at `from` lands on `to`), read the UB way (the
  per-channel median of the region, every 2 px, the brightest 5 % and the
  darker 40 % left out) on MOM #12 / #65 / #125 / #169 / #213 and LCI #189
  (the date-stamped PMOM scans set aside for their blue cast):
  - the rail's PAPER (the reminder box and the chapter column, less the
    ribbon) → the printed backs' greyed box: w 216,211,203 · u 185,201,219 ·
    b 178,177,175 · r 210,186,176 · g 183,193,186 · m 225,217,190 (the
    saga's near-white ≈ 250 before; the ▼ back's own box reads 5–15 levels
    under the prints' saga paper);
  - the TITLE and TYPE bars per key (m15dfcback's as CC drew them, off by
    more than 8 levels a channel on every key): w 167,158,149 → 184,174,166
    (MOM #12's neutral mid-grey: lighter than CC's warm one), u 65,106,143 →
    51,126,184 (the prints' blue is far more saturated), b 81,77,77 →
    102,99,101, r's blue channel 32 → 52, g 51,80,57 → 67,105,59, gold
    184,146,56 → 166,143,74 — the ▼ well (from x 1240, faded out by 1262)
    untoned.
  The build re-reads `from` on the composite every run and refuses a drift
  over 2 levels (a re-published master means a new look at the table). Once
  a colour is ticked, a tone change is a correction (bump + sweep).
- **The profile** (`SAGADFCBACK`) is the saga's — rail, badges, dividers,
  sizes, set symbol, art window — with the ▼ back's deltas: no cost, WHITE
  name and type ink, the name band ending before the well
  (`DFC_RIGHT_WELL_TITLE_RIGHT_PCT`), and the colour-indicator dot on every
  coloured back MOVED DOWN with its bar (`FrameProfile.indicatorDyPct` =
  593 / 21 %H — the prints centre it ≈ 1832 px against the ▼ back's 1239;
  `colorIndicatorBox(dyPct)`, both renderers; 0 on every other body), the
  type line indented past it. No P/T slot, no crown (no legendary
  non-creature Saga back is printed), no pairs (a two- or three-colour back
  wears gold, as LCI #189 prints), no stamp. The chapters are the back's
  PLAIN rules text (a back face carries no structured rows,
  `backPreviewData`), parsed by the rail as a legacy saga's are.
- **Which back wears it** — ONE answer, `backBodyFor` (`lib/cards/dfc.ts`):
  a TRANSFORM back that is an ENCHANTMENT whose subtypes say Saga
  (`sagaBackBodyFor`), on the ▼ family and the bordered look, wears
  `sagadfcback` where it is published in the colour the back wears; short
  of that — and for a Saga back of another family or the borderless look —
  the body `bodyFor` gives its type (today's: the ▼ back). The server's gate
  (`resolveDfcBackFace`), the creator (`lib/creator/saga-back.ts`
  `creatorBackBodyFor`: the live preview and the save's payload agree with
  the gate; an edit keeps the stored body), the reference validator and,
  through the gate, the AI remix of an own card read it. A back body is
  never a card's own template (`isDfcBackBody`, `templateRefusesKind`).
- **The import** (`dfcImportOf`): MOM's and LCI's Saga backs (non-creature)
  land on the transform bodies — the front on `m15dfcfront`, the back on
  `sagadfcback` — once BOTH combos are verified (`finalizeImportMatch`:
  `transform/2015`, exact on the plain printings; the borderless and
  showcase dresses on the bordered bodies as every such printing), else
  exactly as on main: the front's standard frame with a legacy back
  (`tests/unit/scryfall/saga-dfc-imports.test.ts` holds every one of the
  124 transforming-saga printings to origin/main's landing until then). A
  saga CREATURE back (FIN) keeps today's landing (`face-type`). The AI deck
  remix follows the import (`remixFrameFor`, `dfcImportLanding`).
- **Owner Round 75 (2026-10-18)** — the look is signed off, and:
  1. **Adopt** (`adoptDfcBodiesAction`): an imported legacy DFC whose back is
     a Saga moves onto the saga back once it is verified in the back's
     colour, the ▼ back before — the gate derives the body (sent without
     one), where the import lands. Kept.
  2. **The own-card AI remix** follows onto the saga back once ticked (through
     the gate). Kept.
  3. `m15dfcback`'s blue reading less saturated than print: left as it is (no
     item); only the saga back's bars are toned.
  4. An imported multicolour back (LCI #189, MOM #43) draws no colour dot —
     its colour is stored as `["multicolor"]`: later, TODO 5.19, for every
     double-faced import.
  5. **One answer in the form too**: the creator form's colourless check
     (`lib/creator/form-schema.ts`) asks the body the save stores —
     `creatorBackBodyFor` → `backBodyFor`, with the verified keys and an
     edit's stored back (`FormBackBodyContext`) — never `bodyFor` alone: on
     `sagadfcback` the `c` key is the saga's own master, so a colourless Saga
     back the server takes where `sagadfcback/c` is verified is no longer
     refused by the form. `c` stays published but unticked.

### Double-sided tokens (5.5 (c))

TODO 5.5 (c), 2026-10-21 (`feat/dfc-tokens-pair`; owner Round 76). An
ADDITION: no template, no master, no layout bump, no sweep, no badge; every
stored token keeps its look and its data on every save path.

- **What prints.** Scryfall lays 121 printings out as `double_faced_token`.
  39 are two tokens back to back — Guild Kit 2018 (×10), the FNM / store
  promos (F17, F18, L16), A25 #5★, PEMN #1Z, CC2 #9, Q07 #T12, MOM's
  Incubator // Phyrexian (×5), GS1 #T1, the 2003-frame pairs F12 #1a and
  PHEL #1★, and Unstable's ten art-only backs and UNF's folded
  Contortionist. 2 pair a token with a reminder card (F18 #2 City's
  Blessing // Elemental, L17 #1 Gremlin // Energy Reserve), 80 are helper
  cards (Punchcards, the minigames, OTC's Bounties, Day // Night, the
  Initiative, The Ring). Each face of a pair is an ordinary token of its
  era: its own colour, its own height (the textless arch beside the
  text-box arch: GK1 #4 Goblin // Soldier), the Artifact dress where its own
  words say Artifact (F17 #11 Dinosaur // Treasure) — no transform icon.
- **The model** (`lib/cards/token-faces.ts`): the back is NOT a double-faced
  back body (those are never a card's own template): it is another TOKEN
  template — the very ones a one-faced token wears — in the FRONT's design,
  the 2014–19 arch (`m15token…`) with the arch, the full-art token
  (`m20token…`, Nyx included) with the full-art token (`tokenDesignOf`,
  `isTokenPairBack`). Which one is derived, never picked:
  `tokenBackBodyFor` (`lib/creator/token-back.ts`) dresses the design's
  plain textless template by the back's own words and text through
  `tokenFrameFor` (the Artifact word, the arch's text box, the full-art
  height) and, on the full-art design, onto the Nyx dress where its words
  say Enchantment in one colour (`enchantmentFrameFor`, owner Round 74's
  rule). The creator, the import and the server read this ONE function.
- **The ONE gate** (`resolveDfcBackFace`, `lib/cards/dfc-gate.ts`): a token
  front with no back, or a body-less back, is kept as it came (as on main);
  a back that names a body (or whose stored back has one) is a token
  (`TOKEN_BACK_TYPE_REFUSED` otherwise), stored on the body derived for the
  front as it is stored — whatever body was sent, refusing only a template
  that is no token at all (a remix's textless guard may move a full-art
  front onto the arch) — in its own colour (else the front's), verified for
  that template (`code: "unverified"`, an admin's preview skips it), with no
  cost. On an edit the STORED body and colour win (`DFC_BACK_COLOR_SET`; the
  front's template is locked on an edit too). A public save needs the back's
  picture (`dfcBackArtMissing`). `templateTakesBackBody`
  (`lib/cards/dfc.ts`) is what the actions read the verified keys for.
- **The faces.** `backBodyOf` honours a token back in the front's design, so
  `backPreviewData` draws it on its template and colour with no `dfc` block,
  `bakedBackOf` bakes it (`{id}.back.png` + thumb), the tile turns,
  `?face=back`, `?faces=both`, the downloads and the deck export offer it
  and the page is "Goblin // Soldier" (`hasBackOfItsOwn`). The crown stays
  each face's own (`qualifiesForCrown` reads the face's words): a
  legendary front over a plain back crowns the front alone.
- **The creator.** A NEW token on a token frame has a **Faces** row on the
  Card step (`TokenFacesSection`, `panels/dfc-setup-sections.tsx`): "One
  face" (the default — every token until now) | "Two faces". With two faces
  the Front face | Back face switch appears (`SECOND_PART_WORDS.token`): the
  back's token types (`TokenBackTypeSection`, no Emblem choice) and colour
  on the Card step, its name, Types, subtypes, art and artist on Identity,
  its rules, flavour and P/T on Text — no cost. Its frame follows the
  front's design with no picker of its own; the live preview draws what the
  save sends. "One face" saves the token alone (the back kept for the
  visit); leaving the token kind asks first and takes the back along
  (restored on the way back). An edit keeps the faces the card was saved
  with; on a frame that is no token frame "Two faces" is off with its
  reason.
- **The import** (`doubleFacedTokenShapeOf`, `lib/scryfall/import-mapper.ts`):
  a `pair` brings both faces — the back mapped as a token
  (`mapTokenBackFacePatch`) — and `finalizeImportMatch` keeps it only once
  BOTH faces' tokens are verified, each in its colour, the back derived again
  for the front the import lands on (`tokenPairImportLanding`,
  `lib/scryfall/dfc-import.ts`); short of either, exactly main's patch: the
  front alone with the toast. A `helper-front` printing (F18 #2) imports its
  TOKEN face by itself (`dropped_face: "helper-front"`, its own toast; the
  art import asks for that face). Everything else — L17 #1's helper back,
  Unstable's art-only backs (a back whose type line is a bare "Token"), the
  folded Contortionist (`TOKEN_FOLD_BACK_PINS`), the helper cards — imports
  as before. GS1 Mowu and the 2003-frame pairs bring both faces, nearest as
  their fronts are. `tests/unit/scryfall/dft-imports.test.ts` holds all 121
  printings to origin/main's landing (`fixtures/dft-main-landings.json`).
- **The transforming token.** MOM's Incubator // Phyrexian prints the ▲ well
  on its front, the ▼ on its back and the back's 0/0 at the front's text
  box: it lands on the plain full-art pair, **nearest** — the registry's
  `dfc-token-transform` gap on `token/m20` (blocked by TODO 5.5 (d), the
  transform-token body).
- **The AI remix** follows the import: a printing's pair is two pictures
  (2 credits, `remixCreditsOf` → `hasBackOfItsOwn`; the back's body derived
  for the front the remix lands on), one face on a one-credit plan or short
  of the ticks; an own pair keeps both faces through the gate
  (`ownCardRemixFrame`). The identity call names the back as a token of its
  own (`SECOND_HALF_RELATIONSHIP.token`). The step decides the frames it
  SAVES on — the front's and the back's — before any picture is made
  (`remixSavedFrames`, owner Round 78): a back that can't follow the front's
  text stand-in (a textless full-art pair whose text heights are unticked)
  keeps the pair on its landing, and a back that can't be saved at all fails
  the step before the art, refunded — never two pictures for one face.

### The borderless double-faced bodies (5.7)

TODO 5.7, 2026-10-15 (`feat/dfc-borderless`). Four templates for the DARK
borderless look of the transform and modal cards — `m15borderlessdfcfront`,
`m15borderlessdfcback` (the ▼ at the right), `m15borderlessmdfcfront`,
`m15borderlessmdfcback`. Additions under the owner rule: no stored card
changes, no bump, no sweep, no badge; nothing is offered until the owner
ticks each colour of the front AND the back.

**Print (Scryfall, 2026-10-14; scans at 745 × 1040 resized to 1500 ×
2100, measured, never committed).** 162 borderless transform / modal
printings; 134 plain (no showcase, full-art or shattered-glass effect): 91
transform, 43 modal. 98 of the 134 carry `inverted` — the DARK look:
m15borderless's floating bars, its dark box (median rules-box luma 10–93
on every inverted face but PR23 #3's light front) and white ink. The other
36 print the LIGHT look Card Conjurer draws ('Borderless (Front)' /
'(Back)', 'Modal Borderless': light pills, a light front box, a grey back
box — box luma 134–218): the ZNR / KHM / SLU pathways, SLD #1155–1212, STX
#277 / #278 — not built (owner question). Of the 98, 57 have faces the
bodies can dress (no walker, saga, battle or Vehicle face); almost all are
legendary and print m15borderless's FLOATING crown — the crowned twins —
around the well.

**The masters** are PipGlyph's own derivation
(`scripts/build-dfc-borderless-frames.mjs`, every number in
`scripts/lib/dfc-borderless.mjs`): the published `m15borderless/<key>`
master (its `-legendary` twin, its pair; `a` and `c` the
`m15borderlessartifact` colourless — the artifact stand-in, as on the
bordered bodies) with the double-faced pieces GRAFTED from Card Conjurer's
light packs, which share the dark masters' outline pixel for pixel
everywhere else (rims, outlines, box, fins, bottom bar — identical RGBA on
every key) because they are cut through the bordered transform packs'
masks:

| body | grafts |
|---|---|
| `m15borderlessdfcfront` | the icon well at the title bar's left end (ring, black disc, rim bulge, the bar's concave end); the reverse-P/T tab out of the box's right edge |
| `m15borderlessdfcback` | the ▼ well at the right end: the light FRONT's well mirrored, its disc (ring, black, ▼) the published `m15dfcback`'s |
| `m15borderlessmdfcfront` | the housing with its ▲ (its light interior kept, as print's); the flipside strip through CC's Flipside mask |
| `m15borderlessmdfcback` | the housing with its ▲▼ (its interior re-coloured to the bar's, as print's); the light strip |

Only the PIECE comes from the light pack: the ring and disc, the well's or
housing's rim and outline, the tab, the strip. Its rim is re-coloured to
the dark master's (`recolourRim`: the light packs paint the artifact rim
(246,247,245) where the dark master paints (197,203,217)), and the gold
masters' rim rows sit 1 px off the light pack's, so each band row of the
piece is read from the light row that matches the dark master's on the
bar's straight part; a piece pixel the mono master already paints is the
dark master's own; the bar's concave end keeps the light pack's shading
in the dark interior's colour out to 96 px from the well's centre;
everything else is the dark master's. So no graft edge shows a step — the
builder refuses a master with one (`seamsOf`: a pixel just inside a graft
rect that differs from its neighbour outside where the dark master's two
do not) and the masters test checks every key. On a crowned twin the
well's rim and outline are drawn over the crown; a plain or pair master's
round pill end is cut by the clear light pixels round the well. Pixels
outside the graft rects are the dark master's byte for byte
(`tests/unit/frames/dfc-borderless-masters.test.ts`).

**Moved onto print** (the light pieces sit where the bordered packs put
them; print's borderless pieces elsewhere): the white ring 93–206 × 104–217
px on 38 dark fronts (median; the bordered geometry 84–203 × 101–220) — the
well 6 px right, its disc at × 0.95 (radius 56.5 against 59.5); 1295–1408
on 39 backs (bordered 1296–1415) — 4 px left, × 0.95; the tab 4 px down;
the housing 5 px right (gradient correlation of each face against its
master, the type bar's offset taken off). After the moves the same
correlation reads the wells and the tab within 1 px. The housing reads 2 px
high, and so does the WHOLE title bar it sits in: the bar's top outline is
at 87–90 px on SLD #2655 and 89–92 on SLD #1608, m15borderless's at 85–88
— the borderless frame's own title bar (4.32), not the housing, so the
housing keeps the bar's rows (a housing moved alone would jog against
them). The strip is where print has it: on the one standard-form print,
SLD #2655, its top edge, chevron tip (700 px) and bottom sit on ours
within 1 px on both faces; the +4 / −3 px the correlation read rested on
MSH's Marvel strip form, another shape. The rider (`DFC_BORDERLESS_ICON_RIDER`) is the bordered rider
scaled × 0.95 about its centre and moved 6 px; the reverse P/T
(`DFC_BORDERLESS_REVERSE_PT`) prints #828282 (the digits' grey on the dark
box, median 128–133 on the clean scans) ending at 1378 px (ink end
1375–1380 on ECL #290 / #291, FIN #383, LMAR #3 …; the bordered rect
ended them at 1387–1389), its caps 3 px higher (rows 1780–1822). The name
ink starts at 252 px on the fronts (median of 38; the band at 16.45 %W
draws it at 250–251) and 132 px on the ▼ backs: the bordered bodies' bands.

**Profiles** (`lib/cards/template-layout.ts`): m15borderless's geometry and
ink (full-bleed art, the keylined set symbol, its plates and white P/T),
`dfc.look: "borderless"`, `crownMasters`, the split pair, the artifact
stand-in (`a-legendary` joins `LEGENDARY_MASTER_KEYS`); the front the
rider, the icon face's name band and the borderless reverse P/T; the back
no cost, the colour indicator and the ▼ band; the modal pair the strip's
texts (white on the front's dark strip, dark on the back's light one) and
the strip RIDER in the other face's colour (5.1c's model: the light pack's
tab per colour, `<template>/strip/<key>.png` cut from the published
masters through CC's Flipside mask — print's strip follows the face it
describes, MSH #331's blue front a light-blue strip on its gold back; no
`l`, a borderless modal face is never a land; each piece's WebP alpha is
checked against its PNG's by the builder). No holofoil stamp, no
collector line (m15borderless has neither — 4.9d's follow-up).

**The look a back follows.** `bodyFor(layout, role, type, family, look)`:
a borderless front's back is borderless (`dfcLookOf(front)` — the gate,
the creator's live preview and submit, the legendary switch, the import,
the reference pin check). The borderless table has the SPELL faces only
and, on the transform back, today's arrows only: a land face (SLD #1502's
and #2655's backs) and a 2016–22 family (VOW #332–341's sun / moon) have no
borderless body — the gate refuses them by name (`DFC_NO_BACK_BODY_YET`),
the creator's Land chips and the other icon pairs are off on a borderless
card, and the import lands those printings on the bordered bodies with the
`borderless-dfc-face` gap. An EDIT that moves a stored double-faced
card's front onto the other look while its back keeps its stored body is
refused (`DFC_LOOK_MISMATCH`): one card never draws two looks.

**Kinds.** The fronts are the third body of the Transform and Modal kinds
(`layoutTemplates`, never the default `[0]`); the backs refuse every kind.
The kind chips still need the bordered default back verified
(`kindHasAvailableFrame`).

**Import.** `dfcPrintedLookOf`: `border_color: borderless` + `inverted`,
and not a showcase, a shattered-glass or one-off set (BOT), or an
artist-lettered poster — the registry's earlier borderless rules. The
registry's `borderless/dfc` is EXACT on the borderless front body
(`withGaps`: `borderless-dfc-face` first, then the M15 era's); the light
look is `borderless/dfc/light`, nearest on the bordered body (5.7). Marvel
Super Heroes' variant faces — #355–363's floating name (no title bar),
#388–399's comic-cover backs — are nearest on the borderless bodies with
the `marvel-variant-face` gap (5.7d); #328–350 are exact. Until
the borderless front AND back are verified in their colours
`finalizeImportMatch` lands the printing on the BORDERED bodies — where it
landed before 5.7 — and says "the borderless double-faced frame isn't
verified in <colour> yet"; short of those too, the standard frame, as
before. Over all 162 printings with production's list: 0 landings change
(the answer text changes on 112); with the four bodies ticked: 44 move —
28 transform (ECL, FIN, SLD #1608 / #1612, SLX #29, LMAR #3, PR23 #3), 16
modal (MSH, SPM #200 / #202) — and only their bodies
(`tests/unit/scryfall/dfc-borderless-imports.test.ts` against the
recording made on origin/main).

**What waits:** the light look (36 printings; owner question), the
borderless land faces and the 2016–22 left-well back (VOW's sun / moon,
which also print the nickname line), the Marvel strip form (MSH / SPM's
"3/3 Creature" strip), the extended-art double-faced faces (CC's
'Extended Art (Front / Back)' and the modal extended pack: 60 transform +
24 modal printings — a follow-up), the walker faces (5.13, ask first).

### The editor (5.2)

TODO 5.2, 2026-10-02 (`feat/dfc-editor`, stacked on 5.1a). The Transform
and Modal kinds as chips, the back-face panel, the veil gone, the one-click
move of the imported cards. Minimal on purpose: two chips, two chip rows and
one panel in the existing steps — nothing moves (6.29, the stepper
redesign, stays last). Additions under the owner rule: 0 stored cards
change, no bump, no sweep.

- **The chips.** `CARD_KIND_VALUES` + `mdfc` ("Modal double-faced"; the
  Transform kind is 5.1a's), both in `KIND_PICKER_KINDS`. A double-faced
  chip lights only when a FRONT body AND the DEFAULT back body (`bodyFor`
  with `arrows`) each have a verified colour (`kindHasAvailableFrame`);
  until then "Frames awaiting verification" — none is ticked today (the
  owner ticks after 5.3), so both are dark in production and on every
  preview branch. The Modal kind's body family was EMPTY until 5.1b
  (`KIND_DEFS.mdfc.layoutTemplates` = `m15mdfcfront` / `m15mdfclandfront`
  now; the chip lights like Transform's once a front colour AND
  `m15mdfcback` are ticked).
  `DFC_FACE_TYPES` (`lib/cards/dfc.ts`: creature, artifact, enchantment,
  land, instant, sorcery — owner Q2: walker faces wait) is both kinds'
  `LAYOUT_KIND_CARD_TYPES` row.
- **The Card step** (`components/creator/panels/dfc-setup-sections.tsx`):
  under the kind chips, the FRONT face's type row (`DfcFaceTypeSection`;
  the body follows the type — the land front for a land, `dfcFrontBodyFor`
  — in the current colour where verified, else in a colour it is, as a
  frame tile: `handleDfcFaceTypePick`) and, for a transform, the icon
  family row (`DfcIconFamilySection`: `arrows` default — owner Q5 —
  sun / moon, moon / Emrakul, compass / land, fans; the family re-derives
  the BACK body). Entering the Transform kind stamps `frame_style.dfcIcon =
  "arrows"` and forces the back face on (`panelConfigFor.forcedBackFace`,
  `blankSecondFaceFor` types it a creature); leaving the kind drops the
  face with the frame.
- **The back-face panel** — *since TODO 5.14 (Face tabs, part 1) the panel
  is gone: a Transform / Modal card has ONE Front face | Back face switch
  above every step and each back field sits on the step of its front twin
  (`components/creator/panels/back-face-panels.tsx`, `face-switch.tsx`,
  `face-preview.tsx`, `lib/creator/face-tabs.ts`); the fields, their form
  paths and every rule below are unchanged.* As built in 5.2 (one panel,
  `DfcFacePanel`, modelled on the inline kinds' layout panel — itself split per step into
  `second-part-panels.tsx` by Face tabs part 2): its own SurfaceCard "Back face" on the
  Identity step under the front's art block (never inside "More options" —
  a whole face is not an option). Back type chips (`DFC_FACE_TYPES` →
  `back_face.card_type`), colour chips (`ColorSection`, extracted to
  `panels/color-section.tsx` with `SetupSection` → `panels/setup-section.tsx`;
  dressing the BACK body's verified keys; the Colorless chip dark with the
  reason on a spell body unless the type line says Artifact —
  `colorlessFaceAllowed`, D2), title, cost (modal only — a transform back
  prints none), supertype / subtypes, rules (`PipTextEditor` + the shared
  toolbar), flavour, P/T (`statVisibility` on the back's type), artist,
  `ArtUploader` for `back_face.art_url` (the staged upload every art goes
  through: `prepareUploadBytes`, `checkUploadRateLimit`, the 0127 rule) with
  `RealCardArtButton target="back"`. Focusing anything in it flips the live
  preview (`setPreviewFace("back")`); "Clear back face" empties the content
  and keeps the type and colour — the face is never removed. The form holds
  the back's COLOUR (`BackFaceFormValues.color_identity`; empty = the
  front's, sent explicitly) and never its body: the submit and the preview
  derive it (`bodyFor(layout, "back", back type, family)`), so the live
  preview's `backFace` prop carries `frame_style.template` + `color_identity`
  and `card-preview.tsx`'s back path draws the body through
  `backPreviewData` — the admin walk of a back body now shows the body
  (5.0b's limitation lifted: the walk sets the family that derives the body
  under test, `dfcIconFamilyForBackBody`, and the back's colour). In REVISE
  mode the back's type AND colour are locked, as the front's (owner
  2026-10-05: a colour change moves the back onto another master, which is
  what the lock exists for) — the panel shows both read-only with the
  lock's copy ("set when the card is created, like the front's"), the form
  resends them as stored, and the gate refuses a changed
  `back_face.color_identity` on a card whose back has a body
  (`DFC_BACK_COLOR_SET`; structure, not verification, so no admin preview
  skips it) and keeps the stored colour when a patch names none; the
  family chips move into the panel (the Card step is absent) — the family
  stays the ONE look change an edit may make to the back.
- **The gate** (`lib/cards/dfc-gate.ts` `resolveDfcBackFace` — ONE rule for
  `createCardAction`, `updateCardAction` and the move; the client's
  `form-schema.ts` mirrors what it can judge without the verified keys):
  a card on a DFC front body NEEDS its back face, typed one of
  `DFC_FACE_TYPES`; its body is `bodyFor(…)` — on a create filled in when
  the payload names none, refused when it names another; on an update the
  STORED body wins (structure, like the front's template — a back type that
  would derive another body is refused), re-derived only by a changed
  `frame_anatomy.dfcIcon` (`frameAnatomyPatchFor` carries it) and refused
  when that body isn't verified in the back's colour; the colour (the
  back's own, else the front's — stored explicitly) is verified for the
  body (`frameGateError`; an update re-checks only a changed body, the
  front's legacy-pin rule) and on an update of a card whose back has a
  body the STORED colour wins like the body does (owner 2026-10-05: a patch
  naming another is refused, verified or not and under the preview skip —
  `DFC_BACK_COLOR_SET`; a legacy back, a half-moved row and a create take
  the colour as sent), `c` only with an Artifact word —
  and the FRONT's `c` too (`dfcFrontColorError`, the same D2 rule: the
  Card step's Colorless chip is dark with the reason on a DFC front unless
  the type line says Artifact, and a card landing on a DFC front colourless
  — a new card picking Transform, a creature picked for the front — moves
  to the first colour the body is verified in and says so); the FRONT's
  type too (`dfcFrontTypeError`, skeptic 2026-10-02: a wave-1 face type on
  the body its type derives — the land front for a land, the spell front
  for the rest — because the kind gate can't see it: a card on a front
  body IS the Transform kind whatever `card_type` says, so a crafted
  planeswalker, token or battle front, a creature on the land front or a
  land on the spell front passed it; judged on create, on an update that
  moves the frame or the type, in the move, and in the form schema);
  a transform back saves with no cost (`withTransformBackShape`); a public
  save needs the back's name (`missingSecondFaceName`, as before) AND art
  (demoted to private without it, the front's "no artwork → no gallery"
  rule on both faces, D13 — legacy backs keep today's rule); a kind without
  a back carries no back body (refused, the front first), and a
  `frame_style`-only patch moving the front off a DFC body takes the stored
  back's body and colour off with it; `normalizeAnatomy` drops `crown` /
  `twoColor` on the DFC bodies (D17 — they declare neither). An admin's
  frame preview skips the back's verification as it skips the front's.
  The save stamps a transform front's family (`anatomyDefaults` → `arrows`)
  like every other switch.
- **The veil.** `ComingSoon` "Double-faced cards" in `publish-panel.tsx`,
  the back-face picker component, `onCreateBackFace` / `handleCreateBackFace`,
  the `/create?backFor=` return path and `FormValues.back_card_id` are gone;
  `ComingSoon` itself stays (the Subscriber step). The server keeps
  `back_card_id` only to CLEAR (`z.null()`): an old tab's save passes, a
  crafted uuid is refused; the column, its 0127 guard and the card page's
  `backCard` flip wait for a cleanup migration.
- **The imported cards** (owner Q3: in place, one click —
  `lib/cards/dfc-adopt.ts` + `dfc-adopt-actions.ts`, the hint
  `panels/dfc-adopt-hint.tsx` under the legacy back's art strip on a stored
  card's Identity step): `dfcAdoptionOffer` names a row with a LEGACY back
  (content only) on m15 or an M15 skin with no DFC twin (`m15devoid`,
  `m15snow`, `m15artifact` — the devoid / snow dress is left behind and the
  hint says so) whose faces are both wave-1 types and whose back is no
  walker; never the two on `m15borderless` (5.7), the walker back (5.13),
  nor the adventure stored as a back face (a costed instant / sorcery back
  under a permanent — the storybook page, not a face; the same shape as
  STX's creature // sorcery modal cards, which no imported row has: only
  the import can tell them apart, by the printing it stores — 5.4). The
  layout is the one the back's
  SHAPE derives, never a chip (owner 2026-10-05): a back WITH a mana cost
  is a modal card, and a layout whose bodies don't exist yet shows NO hint
  at all (`dfcAdoptionShape` still names it, `dfcAdoptionOffer` answers
  null) — a costed back is never offered Transform, which would drop its
  cost and change the card's rules. The one shape the cost can't settle is
  a cost-less LAND back (a transform land, XLN / RIX / LCI, and a modal
  land, ZNR / MH3, look the same): it reads as transform only with the
  printed sign of one — the back's "(Transforms from …)" reminder or
  either face saying "transform", which Scryfall's oracle text keeps and
  a modal land back never says — and as modal otherwise
  (`transformMarked`, skeptic 2026-10-05; `cards.layout` can't decide it:
  nothing writes that column before 5.4, so every row reads 'normal'). So
  5 of the 8 qualify: Titânia
  (on devoid), Erza Scarlet, Avatar Aang (a colourless back: the move gives
  it the front's five colours — locked after, like every stored back's),
  Tobirama (a land back — moved colourless, the one key the land back is
  verified in); Darth Vader's costed Lantern back onto the MODAL pair
  (5.1b: its cost kept, no family stamped;
  `tests/unit/cards/dfc-adopt-modal.test.ts` holds the mechanism with the
  mocked-profile fixture). `adoptDfcBodiesAction(cardId, "transform" |
  "mdfc")` refuses the other layout by name ("moves onto the Modal
  double-faced frames only — its back carries a mana cost" / "… is a land
  without the printed sign of a transform card" / "… the Transform frames
  only — its back has no mana cost") and a shape whose bodies aren't built
  ("aren't built yet" — none since 5.1b): front → its DFC twin, the
  family stamped, the switches the body can't draw dropped, the back onto
  its body in the front's colour —
  colourless on the TRANSFORM land back — the modal land back keeps the
  front's colour, one tint per colour (`adoptedBackColorIdentity`: the
  transform land pair
  has one master under every key and is verified on `c` alone, so a land
  back in the front's white could never pass the gate; the hint judges the
  back in that colour and says so) — the gates every save passes
  (verification of both bodies, the kind gate, the front's type and
  colourless rules, the back gate), then `bakeAndPersistCardRender` after
  the response, which bakes BOTH faces (5.3). The button is dark until the
  front is verified in the card's colour and the back body in the back's.
  Nothing happens until the click.
- **Seeds** (`supabase/seeds/10_dev_data.sql` 2d, dev_pro, …053–…056): a
  public transform creature // creature with both arts and bodies, a
  private draft with an unnamed back, a transform land front // creature
  back, a legacy-shaped `back_face` row for the hint. The modal seed waits
  for 5.1b; `seed.sql`'s mirror follows production's ticks (none).
- **Proofs.** `tests/unit/cards/dfc-gate.test.ts` (the gate on the real
  bodies), `dfc-editor-save.test.ts` (the actions with a mocked
  `frame_reviews`: the family stamp, both-arts rule, stored body wins, the
  family re-derive, the strip-off, the preview skip, the colour lock),
  `dfc-adopt.test.ts` (the nine production shapes: exactly four offered
  today, the shape's layout only — a cost-less land back by its printed
  sign, Agadeem's shape on m15 modal; the plan; the action's gates) +
  `dfc-adopt-modal.test.ts` (Vader the fifth once `bodyFor` answers the
  modal rows), `dfc-editor-hostile.test.ts` (the skeptic's crafted
  payloads + the colour lock: refused verified or not, no preview
  override, the stored colour kept when none is named, free on a legacy
  back / a half-moved row / a create),
  `tests/unit/creator/dfc-kinds.test.ts` (the chips with a mocked
  verified set, the forced face, the hydrated colour, the family patch, the
  form schema), `tests/unit/components/creator-dfc-editor.test.tsx` (the
  real form: the chips, the rows, the panel, the flip on focus, the payload,
  an edit's family patch, the hint), `tests/e2e/dfc-editor.spec.ts` (the
  Transform chip → both faces → save → the card page flips; through the
  admin preview since no combo is ticked anywhere and the spec never writes
  `frame_reviews`). The Visual gate is 0 changed / 0 redefined: no renderer
  changed.
- **What waits:** per-face AI fill (5.2b);
  the import's back colour / body / family (5.4 — the editor's chips accept
  what it will store: a `ColorIdentity[]`, two colours kept as a pair,
  three or more "multicolor"; and NOTE: the registry's `transform/2015`
  rule turns exact on `m15dfcfront` the moment a front colour is ticked,
  and the AI deck remix lands such a printing on the front body with NO
  back face — `templatePaintsSecondFace` says a DFC body paints none — so
  the gate refuses that step with "A double-faced card needs its back
  face" until 5.4 hands the back through); the `back_card_id` cleanup
  migration (5.0c — after 5.4, owner 2026-10-05).

### Both faces baked (5.3)

TODO 5.3, 2026-10-02 (`feat/dfc-bakes`, on 5.1a). A card whose back face
has a BODY of its own is baked, shown, downloaded and printed on both
faces; everything else is byte for byte what it was (a 120-row production
replay incl. the 9 `back_face` rows at 750 and HD: identical, no back bake
for any of them; Visual 0 changed / 0 redefined). Additions throughout.

- **The bake writes two PNGs + two thumbs.** `lib/cards/faces.ts`
  `bakedBackOf(card)` is the ONE predicate: the back is baked only when
  `backBodyOf` names a back body (a DFC front with a back body stored on
  `back_face.frame_style.template`); a legacy back (no body) never is — the
  8 imported DFCs stay single-bake, their back pointers written null.
  `renderBackFace` (`lib/cards/bake-render.ts`) renders the back right
  after the front in BOTH bake paths (the save bake and the admin sweep,
  `lib/cards/rebake-batch.ts` — so the auto-rebake cron and the compare
  page's "Re-bake now" carry it) through the same `renderCardImage` on
  `backPreviewData`: the back's own body, colour, art (through the same
  `resolveBakeArt` guard) and content, the card's ONE collector line with
  the back's artist, the mark in its © slot, the watermark; the back bodies
  declare no holofoil stamp, so none prints on a back. `uploadRenderObjects`
  takes `{ front, back }` and writes `{id}.back.png` + `.back.thumb.webp`
  beside the front's pair; the four pointers, `rendered_at` and ONE
  `layout_version` go in the one compare-and-set write. A back failure
  (art, render, upload) fails the whole bake — nothing persisted, every
  pointer cleared by the save bake; nothing removed from storage (a
  refused upsert leaves the previous object, and the sweep keeps a failed
  card's pointers, which must never point at a deleted object); a card
  that lost its back body has the stale `.back.*` objects removed with its
  next bake (`staleBack`, read off `BAKE_SELECT_COLUMNS`'
  `rendered_back_image_url`).
  **The one entry for "bake this card, both faces"** is
  `bakeAndPersistCardRender(cardId, ownerId)` — it re-reads the row, so a
  save that wrote a back body (5.2's `adoptDfcBodiesAction`, the creator)
  just calls it. `hasServableStoredRender(row, face)` /
  `fetchStoredRender(row, { face })` read the back's bake under the card's
  one correction rule (one stamp stamps both faces).
- **Display (owner decision Q6).** `BakedCardThumbnail` takes
  `renderedBackThumbUrl` (every gallery-style tile passes
  `rendered_back_thumb_url`; `list_gallery_cards()` returns `setof cards`,
  `narrowCard` spreads the row) and, with one of ours beside a front thumb,
  shows the FRONT with a control that turns the tile over in place
  (`components/cards/baked-card-flip.tsx`). Q6's control — a small corner
  flip button, "nothing on hover or by itself" — was REPLACED on
  2026-10-12 (TODO 5.15): a labelled "2 faces" button, bottom-left and
  44 px tall, plus a turn when a mouse RESTS on the tile for a third of a
  second (hovering fine pointers only, never under reduced motion); the
  back's thumb is mounted on intent only; which cards is ONE predicate,
  `lib/cards/tile-faces.ts`; list rows too small to turn carry the
  `TwoFacesMark` text and the deck pop-up a Front / Back switch. The card
  page's hero is a client island
  (`components/cards/card-hero-preview.tsx`) that reads `?face=back` with
  `useSearchParams` inside its own Suspense boundary — never the server
  component, so the route's rendering stays as it was. `cardPageName(title,
  type, faces)` is "Front // Back" ONLY on a DFC body with a named back
  (`cardPageFacesOf(row)`; the 8 legacy pages keep their name; the slug
  call passes no faces): `<title>`, H1, breadcrumb, share copy, oEmbed and
  the JSON-LD name. The CreativeWork gains the back as `hasPart` with its
  own `ImageObject` — the back bake through this site's
  `/render-cdn/<owner>/<file>` path, named only when it is THIS card's
  `.back.png` — and the back's words in
  `keywords`; "Card details" lists the back's facts; the OG image stays the
  front; both display bakes carry the mark (v20 unchanged).
- **Downloads.** `/api/cards/[id]/png?face=back` (`lib/cards/card-face.ts`
  `parseFaceParam` / `faceSlug`): the face the card page flips to
  (`flippableBackOf` — a back with a body on its body, a legacy back as the
  page draws it; a card with no back to flip to answers 404). A free
  viewer's download is the stored BACK bake (`rendered_back_image_url`), a
  paid viewer's a live clean render; every print variant (`ppi=800`,
  `bleed=1|mpc`, `print=1`) renders the back's mapping through
  `lib/render/card-print.ts` unchanged (the back's art under the back's
  layout). `face` joins the ETag only for the back (every front download
  keeps its tag); files are `<slug>-back.png`, `-back-square.png`,
  `-back.jpg`, `-back-800ppi.png`, `-back-mpc.png`, `-back-print.png`.
  **Both faces in one image (5.3c, owner decision 2026-10-05):**
  `?faces=both` serves ONE PNG with the front on the left and the back on
  the right — each half exactly what `face=front` / `face=back` serve at
  the same options, copied pixel for pixel onto a transparent canvas with
  a gutter of 1/25 of a face's width between them
  (`lib/render/faces-side-by-side.ts`), named `<slug>-both.png` /
  `-both-square.png`, its own ETag — and it is the download modal's first
  and default choice on a two-faced card. It is never a print file or a
  JPEG (one face each: `faces=both` with `ppi=800`, a bleed, `print=1` or
  `format=jpeg` answers 400; the modal disables those options with a note
  until a face is picked), and a single-faced card answers 404.
  `/api/cards/[id]/pdf`: `face=back` (one page), `faces=both` (two pages,
  `<slug>-both-faces.pdf`), and a sheet places the back BESIDE its front by
  default — cells run front, back, front, back…, a two-faced slot never
  split across pages (`lib/render/card-pdf.ts` `pageSheetSlots`) — unless
  `backs=0`; a legacy back is offered by name only (`flippableBackOf`), so
  a legacy two-faced card's sheet is unchanged. Duplex alignment and the
  generic card back stay TODO 6.27.
- **The modal and the exports.** The download modal (`hasBackFace` =
  `rowHasBakedBack(row)`) gets a Face switch on the Image tab, Faces
  (Front / Back / Both faces (2 pages)) on the one-card PDF and the shared
  "Include back faces" checkbox (`PrintBacksCheckbox`,
  `components/cards/print-sheet-options.tsx`) on the sheet, remembered
  with the print settings (`print-selection.ts` `includeBacks`, default
  ON — a proxy of a DFC without its back is unplayable). The deck and
  selection manifests list each card's `faces` (`exportFacesOf(row)`:
  `["front", "back"]` for a back body); the browser export
  (`lib/decks/export-client.ts`) fetches the back as the same render with
  `&face=back` and adds `<slug>-back.png` (HD and the 600 ppi print
  render), `<slug>-back-mpc.png` for MPC, a page of its own or beside its
  front on the PDF (`DeckPdfEntry.back`); a back that fails is listed as
  "<title> (back)" and the front still prints. Free vs paid is unchanged
  per face.
- **Tests:** `tests/unit/cards/bake-both-faces.test.ts` (the real save bake
  against mocked storage: four objects, one write, every failure path, the
  legacy single bake, the stale back), `tests/unit/cards/rebake-batch.test.ts`
  (the sweep carries the back), `tests/unit/render/stored-render.test.ts`
  (`face`), `tests/unit/api/card-png-route-faces.test.ts`,
  `tests/unit/api/card-pdf-route-faces.test.ts`,
  `tests/unit/render/card-pdf-faces.test.ts`,
  `tests/unit/decks/export-client.test.ts` (faces),
  `tests/unit/api/cards-export-route.test.ts` (faces),
  `tests/unit/cards/dfc-card-page.test.tsx` (`cardPageName`, JSON-LD
  `hasPart`, Card details), `tests/unit/components/baked-card-flip.test.tsx`
  (the tile flip, `?face=back`),
  `tests/unit/components/download-modal-faces.test.tsx`.
- **What waits:** the ticks — the walkthrough bakes both faces now, so the
  owner verifies the transform combos after merge and the Transform chip
  lights; the import (5.4); the DFC helper card (5.3b); duplex alignment
  (6.27). The editor and the seeds are 5.2's (above).

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
| battle | the defense value, in the shield its landscape master paints | `defense` + `orientation: "landscape"` |
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

### Import and the AI remix (5.4)

TODO 5.4, 2026-10-05 (`feat/dfc-import`, the last PR of the double-faced
line's first wave). Imports follow the printing PER FACE (owner 2026-10-02,
Q5: the family from `frame_effects`; the look per face); walker faces WAIT
(Q2); the AI deck remix of a double-faced card costs 2 credits (Q4), shown
before anyone pays. Additions: 0 stored cards change, no bump, no sweep.

- **One landing rule** — `dfcImportOf(card)` in `lib/scryfall/import-mapper.ts`
  (the mapper, the registry's `PrintingFacts.dfc` and the creator read it):
  a transform / modal printing lands on the double-faced bodies when both
  faces can wear one — the kind (`transform` / `mdfc`), the front body by the
  front's type (`bodyFor`: the land front for a land), the back body by the
  back's type and the printing's icon family (`dfcIconFamilyFromEffects`:
  `sunmoondfc` → sunmoon, `mooneldrazidfc` → moon, `compasslanddfc` →
  compass, `fandfc` → fan, `convertdfc` / none → arrows), the family on the
  patch as `printed_dfc_icon` (→ `frame_style.dfcIcon`, `importedAnatomy`),
  the front's colour its own, the back's own colour
  (`backFrameColorsFromScryfall`, single-select: 2+ → multicolor — the gold
  backs never split) — a LAND face colourless on the TRANSFORM land bodies
  (that pair has one master, verified on `c`; the editor's and the Q3 move's
  rule) and in the colour its mana ability adds on the MODAL land bodies
  (5.1b: one tint per colour, verified per colour — Emeria's back is white,
  a Pathway's faces each their own; `dfcFaceColorIdentity`).
  What blocks it, and what the printing does instead:
  - a **planeswalker face** (ORI's Kytheon // Gideon and Jace, KHM Valki,
    MH3's five, STX Rowan // Will, ECL Oko): the front imports alone on its
    standard frame, `dropped_face: "walker-face"` + the toast
    ("… has a planeswalker face — PipGlyph imported the front face … on its
    own"), and the registry's `dfc/walker` signature (nearest, 5.13) logs a
    `frame_requests` row — the request log counts the asks. The admin
    compare view still draws such a back as the legacy back a stored card
    has (Chrollo's Tibalt); a back-body pin refuses it.
  - a **Saga, battle or token face**: its own kind, as today (5.5) — the
    `dfc` gap on the standard frame now names 5.5.
  - **no body**: a layout with no body for a face — none since 5.1b's
    modal pair (the `modal/2015/pending` rule that held modal printings on
    the standard went with it); a wave-2 layout's printings turn onto their
    bodies by themselves once `bodyFor` answers.
  - a **devoid or snow dress** (MH3's five devoid MDFCs, KHM #179 Jorn):
    no body carries the dress, so the printing keeps today's landing — the
    era's devoid / snow frame with a legacy back (`dress`; `dfc/devoid` /
    `dfc/snow` → 5.11, nearest on the body, `landOn` the dress frame).
  - a **colourless face without the Artifact word** (EMN's Eldrazi backs —
    Grizzled Angler // Grisly Anglerfish — STX #6 Wandering Archaic's front):
    the body's `c` is the artifact master standing in (D2), so the printing
    keeps today's landing rather than a colour the print doesn't have;
    `dfc/colourless-face` → 5.11. A colourless ARTIFACT face (Tergrid's
    Lantern) wears `c`.
- **The registry** (`lib/scryfall/frame-signatures.ts`): `transform/2015`
  and `modal/2015` are EXACT on the front body (the family `dfc` pick is the
  printing's front body); the M15-era gaps hold on it but the double-faced
  marks (the body draws them), plus `parchment-land-back` (XLN / RIX /
  LCI's land backs print the parchment frame — nearest on `m15dfclandback`,
  5.8) and the `vehicle` gap read on the BACK too (a BOT convert's Vehicle
  back, 5.10). `dfc/2003` (ISD / DKA / AVR) is nearest on the M15 bodies;
  `dfc/devoid` / `dfc/snow` nearest on the body for the dress, landing on
  the devoid / snow frame (5.11); `borderless/dfc` nearest on the body (5.7,
  no bordered twin to land on). The back bodies keep no signature of their
  own (`TEMPLATES_WITHOUT_PRINTED_SIGNATURE`).
- **Verified on BOTH faces** (`lib/scryfall/dfc-import.ts`
  `dfcImportLanding`): the front body in the front's colour AND the back
  body in the back's colour must be ticked, or the server's gate would refuse
  the save after the art. `finalizeImportMatch` (the `/api/scryfall/named`
  route, the printings grid) downgrades the patch to today's landing — the
  front's standard kind and frame, the back a legacy back — and the match
  says so: an exact answer becomes "the back face's frame isn't verified in
  red yet" (`unverified`, the request log's "Not yet verified" cause), a
  nearest one keeps its reason, both `landOn` the standard. The creator
  then imports exactly as before 5.4; once the owner ticks both faces the
  same printing lands on the bodies with the back's colour and family set
  (the form sets the printing's colour BEFORE the kind change, so the
  colourless-front rule never fires on an import). An ADMIN's frame preview
  counts: the creator hands `previewFrames` to `/api/scryfall/named`
  (`?preview=`), which unions every colour of those templates into the set
  it finalizes against — for an admin only — so
  `/create?previewFrames=m15dfcfront,m15dfcbackleft` imports a transform
  printing onto the bodies before anyone has ticked them (the save is a
  private frame preview, as always).
- **The AI deck remix** keeps the back when the landed template
  `templateHasBackFace` (beside `templatePaintsSecondFace`): the back's
  body and colour ride through `scryfallRemixMechanics` → `createCardAction`
  (the gate derives the same body). The identity call names both halves and
  DESCRIBES the back's picture (`second_art_instruction`; relationships:
  transform "what the front becomes", mdfc "the other mode"); the step
  paints a second image and fails — refunding both credits — when either
  picture fails. **Two credits** (Q4): `remixCreditsOf` prices an entry at
  plan time — `lib/ai/remix-estimate.ts` resolves the deck's printings
  through Scryfall's collection endpoint (≤ 2 calls for 100 cards; for the
  deck's OWNER only, and only behind the AI rate limit, which the jobs route
  checks before it sizes a remix) and maps
  them through the remix's own frame choice — so the dialog's confirm
  (`GET /api/ai/remix-estimate`: "N double-faced cards cost 2 credits —
  both faces get art"), the jobs route's 402 pre-check and the plan entry's
  `credits` (what `withCreditedStep` reserves: one charge, one ledger ref,
  settled with the step — `settle_spend`) are the same number. A one-credit
  entry is remixed ONE-FACED whatever its printing; an entry priced for both
  faces whose bodies were un-ticked since fails plainly and refunds.
- **A remix never saves a text on a frame that draws none** (TODO 1.24,
  2026-10-13). A frame whose PROFILE is `textless` (`FrameProfile.textless`,
  3.24) hides the rules box in both renderers; the remix copies the
  source's rules and writes a flavour line, so since the remix follows
  verified landings (#529) and an own card keeps its frame (#533) it could
  save a text nobody can read. `remixSavedFrame`
  (`lib/creator/frame-resolve.ts`, pure) is the ONE guard, where both paths
  save (`executeDeckRemixStep`, after the identity — the first point the
  final text is known; the flavour is nullable, so a remix CAN save with
  none):
  1. a token follows its text first, as before (`autoTokenTextBoxFrame`:
     the box or height the text asks for, else the arch's text box);
  2. a landing that draws the text, and a card that saves with no text,
     stand;
  3. a landing that would hide the text (`frameHidesRulesBoxText`: the
     profile's flag and the renderers' `hasRulesBoxText`) gives way to the
     stand-in — for a PRINTING, its own landing resolved with the textless
     frames read as unverified (`withoutTextlessFrames`;
     `scryfallRemixMechanics` names it as `text_stand_in`): the registry's
     existing stand-in, the status still `nearest`; for an OWN card, a
     token's 2014–19 arch (`m15token`, `m15tokenartifact` for the Artifact
     word — what a printing of it gets), else the default landing (no
     template — where it landed before #533), each only where the save's
     gates pass it in the card's colour (`ownCardTextStandIn`);
  4. no stand-in (nothing else of the kind published in the colour) → the
     landing stands: a hidden text, never a refused save after the art.
  A stand-in is one-faced like the landing, so the plan's price never
  moves; the estimate is untouched. The import and the creator are not
  guarded (a maker picks a textless frame knowingly; the Text step says
  so). `resolveGeneratedFrame`'s random pool (AI card, fill, deck
  generation) reads the same test: a card with text never draws a textless
  profile while another frame it fits is published.

  | Landing | Reached by | Textless profile? | With text, the frame verified |
  |---|---|---|---|
  | `m20token`, `m20tokenartifact` | `token/m20`, its gap rules (`+nyx-dress`, `+border`, `+crown`, `+two-colour`, `+two-colour-hybrid`) and `borderless/token`, all `onceVerified`; an own token kept on them | yes | the regular / tall box, else the arch's text box (the height rule, unchanged); with NO text box in the colour: the arch (`m15token` / `m15tokenartifact`, its scrim) — an own card the same, the default frame only where the arch isn't published either |
  | `m15textless`, `m15textlessland` | `textless/2015`, `textless/future`, `borderless/textless`, `borderless/basic/textless` (static), `textless/old-frame` (`onceVerified`, A9); an own card kept on them | **yes** since layout v58 (the black-bordered textless promos, 4.35 / 4.42) | the stand-in: `m15`, `m15land`, `m15artifact`; `modern` for the 2003 promos |

  Production (2026-10-13) ticks every colour of all six full-art token
  templates and both arches, and neither "M15 Textless" frame. Flagging
  `m15textless*` `textless` (layout v58) made the guard cover that family
  with no other change — `tests/unit/ai/remix-textless-guard-flagged.test.ts`
  pins the stand-ins. Never test a template's NAME for this.
- **A remix of the user's OWN card keeps its frame** (2026-10-13; a deck
  entry's `card_id`, which the step reads before its printing — it used to
  carry no template, so a card on the Vehicle frame, the 2003 frame, a
  borderless frame or a full-art token came back on the default frame).
  `ownCardRemixFrame` (`lib/ai/remix-mechanics.ts`, pure) is the ONE
  choice the estimate prices and the step lands:
  - the source's stored template travels, with its stored anatomy switches
    (`storedAnatomyOf`: crown, two-colour, collector line, ★, stamp, icon
    family, alignment, border — as the creator's remix keeps them; the save
    stamps the new-card default for the rest and keeps what the frame
    draws). The finish does not travel, as before;
  - WHEN the save's own gates pass it: a current template, published in
    the card's colour (`frameGateError`), right for the kind
    (`frameKindGateError` — run again on the card as it SAVES, since a
    basic-only frame reads the name: a renamed Wastes falls back);
  - a two-part frame (split, aftermath, adventure, flip) carries its second
    half, renamed by the identity — one picture, one credit;
  - a double-faced body carries its back, on the body the gate derives
    (`resolveDfcBackFace`), only when BOTH combos are verified — then two
    pictures at two credits, priced by the estimate; a one-credit entry (an
    older plan, a body not ticked) lands as before, one-faced;
  - anything else — unverified in the colour, refused by the kind gate, a
    retired or missing template, a body-less legacy back — is the landing
    it had before: no template (the default frame), one face, one credit.
    A fallback, never a refused save after the art is paid for.
  - **never a text on a frame that draws none** (TODO 1.24, below).
  - an EMBLEM is not remixed at all (owner 2026-10-13) — an own emblem card
    or a printed one (`layout: emblem`). An emblem prints its planeswalker's
    name and a remix renames every card by itself, so the two would stop
    matching. It is left out at PLAN time: the estimate does not count it
    in `cards` or `credits` and reports it as `emblems` (the dialog's one
    line: "1 emblem is left out: emblems are not remixed."), and
    `createDeckRemixJob` makes no entry and no step for it — the user's own
    through `remixableDeckItems` (before the batch cap), a printed one as
    the 0 the estimate put in `creditsByEntry`. Nothing is reserved, so no
    `spend:` row exists; the new deck has no emblem. A step of an OLDER
    plan that still names one fails with `REMIX_EMBLEM_LEFT_OUT` before any
    AI call — an own emblem before the reserve (no ledger row), a printed
    one inside the wrapper (its one credit refunded). Before this an own
    emblem's remix painted the picture, was refused by the save (the
    default frame doesn't dress emblems) and refunded, every attempt; a
    printed emblem's was remixed for one credit.
  A token's height still follows the text the remix saves
  (`autoTokenTextBoxFrame`); a walker / saga stored with its rows alone
  (`rules_text` NULL) is copied with its rows as text (`ownCardRulesText`).
  `tests/unit/ai/deck-remix-own-card-frame.test.ts`.
- **Proofs.** `tests/unit/scryfall/dfc-imports.test.ts` (the mapping table
  on `fixtures/dfc-import-printings.json` — MID #7 / #169, INR #60, a VOW
  werewolf, a MOM transform, a BOT convert, XLN #22, LCI #26, EMN #63, ORI
  #23 / #60, a MOM battle, TMOM #16, ZNR #12 / #284, KHM #112, STX #6 /
  #147, ISD #51; the modal state before AND after 5.1b under the mocked
  bodies; the request row; the both-faces finalization), the parity test
  (`anatomy-import-default.test.ts`: the creator and the remix store the
  same frame style, family included), `deck-remix-step-frame.test.ts`
  (both faces, the second picture, the one-faced fallback, the credits),
  `deck-remix-dfc-credits.test.ts` (the money path through the REAL credit
  wrapper: one 2-credit reserve, one ref stamped for settlement, every
  failure after it refunded under that ref, a one-credit plan one-faced),
  `tests/unit/cards/dfc-import-save.test.ts` (every fixture printing saved
  through the real createCardAction — the bodies, the blocked landings, the
  walker's request row), `remix-estimate.test.ts`, the jobs route's 402
  (and its rate limit before the estimate), `remix-estimate-route.test.ts`,
  `remix-identity.test.ts` (the back's art instruction),
  `tests/e2e/scryfall-import.spec.ts` (MID #7 through the admin preview:
  the transform body, both arts, the family). Visual: 0 changed / 0 new.

### Which group a frame sits in

The picker has two groups for a frame that is not an era's standard or a
layout, and print decides which (audit of 2026-10-13, Scryfall the same day):

- **An M15 variation** — a treatment of the 2015 frame that ANY set prints
  on any card of its kind: Snow, Devoid, Borderless, the Nyx dress, the
  Vehicle and station frames, the Universes Beyond dress (`m15ub*`, 4.25:
  one dress across every crossover of 2022–25, never one IP's showcase),
  and since 2026-10-13 **extended art**
  (`frame_effects ∋ extendedart`: 4,235 printings in 86 sets, 2018 → today),
  the **full-art basics** (`full_art` basics on the 2015 frame: 688
  printings, 588 black-bordered in 52 sets) and the **textless** frames
  (`textless` on the 2015 frame, no token or basic: 78 printings in 24
  promo sets). Its era is "M15 (2015)", its chip sits with the kind's other
  variations and carries no set name.
- **A showcase** ("Showcase & Universes Beyond") — a frame ONE set, one
  block or one crossover printed: the Ring and Scroll (LTR), Avatar's
  elemental frame, Bloomburrow's woodland and anime, Tarkir: Dragonstorm's
  two, Multiverse Legends' Dragon Wing, Zendikar Rising's hedron, the
  Zendikar Expeditions (ZNE: 30 printings, 2020, on `expeditionland`; EXP:
  45, 2015–16, on `expeditionlandbfz` — two chips in the one Expeditions
  set) and **the constellation
  frame** (`nyx`: THB #258–268 alone — Scryfall `showcase`, BLACK border;
  it is not a borderless Nyx frame, and the printed enchantment frame is
  `m15nyx`). Its chip names its set ("Zendikar Rising — Hedron").

How the move of 2026-10-13 was made, for the next one. A frame's group is
its SET's era (`FRAME_SET_ERA`), so the two sets `extended` and
`fullartset` went to `m15`; `FRAME_TEMPLATE_SET` did not change (the
admin's treatment batches and the import chooser's families read it). Each
of those frames is ONE body several kinds wear (`extendedart` dresses a
creature, an artifact, a land and a token), where Borderless has a template
per kind — so they are not `TEMPLATE_SKIN_VARIANTS` rows: they are listed in
`M15_TREATMENT_SETS` (`types/card.ts`) and `skinVariantsFor` offers them
under whichever M15 standard the kind has, to exactly the kinds
`templateRefusesKind` lets them dress. Everything that read "is this a
showcase" to decide BEHAVIOUR reads `isTreatmentBody()`
(`lib/creator/frame-picker.ts`: a showcase or an M15 treatment) — the
capability rule below, the import's candidate frames, the import chooser's
families, the treatment notice's "bordered" — so a move changes a frame's
place and label and nothing a card wears or a save stores. What a user sees
change:

- the chip sits among the M15 variations, before every showcase, under the
  kind's M15 standard only (a card on the 1997 frame is no longer offered
  it: picking it changed the card's era, which the Frame section owns — as
  for Borderless since 4.32);
- labels: "Extended Art", "Full-Art Basic Land", "Borderless Full-Art Basic
  Land", "Textless", "Textless Land" (were "Full Art — Basic Land", …);
  copy says "M15 (2015) Extended Art";
- a kind change on a NEW card wearing one keeps the M15 era without the
  "Switch frame era?" question (the same frame as its "Switch to M15") —
  so it can no longer be refused, as on Borderless — and an import onto
  such a card no longer toasts "Switched to the M15 frame…";
- lists in gallery order follow the new order: an import's "Show all
  frames", the AI's pool (drawn uniformly), and the resolver's LAST resort
  (`resolvePublishedFrame`: the first published frame of the gallery,
  reached only where no era standard of the kind is published in the
  card's colour — never with production's list) now meets an M15 treatment
  before another set's showcase.

`tests/unit/creator/frame-picker-groups.test.ts` holds every frame decision
(gallery, kind gate, bases, resolver, import, remix, AI pools; production's
verified list and everything verified) to a recording of `origin/main`
before the move, the differences above asserted exactly;
`tests/unit/components/creator-frame-picker-groups-payload.test.tsx` does
the same for what a save sends. A frame that moves group later re-records
both on the commit before it.

### The kind gate

`templateRefusesKind` (`lib/creator/card-kinds.ts`) is two rules; either
refuses:

1. **Capability** — on a showcase treatment, an M15 treatment (extended
   art, the textless frames, the full-art basics) or a Borderless skin, the
   body must draw what the kind needs. So the ZNR hedron, the textless and
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
anatomy to its own body ships with its layout bump and a scoped sweep
after the owner's sign-off — which 4.5c's saga-creature P/T turned out not
to be: no plain saga ever printed one, so it becomes a new body with 4.5d
([The Vehicle frame](#the-vehicle-frame-45c)).

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
starting loyalty, the defense on a battle with one — the value alone since
layout v43, in the shield the battle's master paints
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
every slot, and offers each the fields the override schema reads at its
PATH (`fieldsForSlot`, `isStatSlotPath`): a rect for an art window, a size
and the value's offsets for a stat slot, a size alone for the saga's
chapter rail, a size, line height and tracking for a text slot — never by
the keys a profile's slot happens to carry (a P/T with no plate, the
battle's defense in its painted shield and the chapter rail were offered a
text slot's fields, and a draft that touched one could not be saved; a test
writes every offered field on every template and parses it).

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

### Faces, footer and symbol style are profile data

TODO 4.8.0 (a refactor: no pixel moved, no layout bump). Three things a
frame's era decides are DATA on its profile; no renderer names them.

- **Which face a text is set in** — `lib/cards/type-faces.ts`, the one
  resolver both renderers read at every text site outside the rules box:
  `slotFace(slot)` for a slot that carries `font` (`TextSlot.font`, and now
  `StatSlot.font`), `faceOf(profile, role)` for a role (name, type line,
  stat, numeral, badge, second-face name / type / stat, footer, strip word,
  mark). The faces are the two the repo has: `"display"` (CardDisplay =
  Beleren Bold) and `"body"` (MPlantin). Walker badges and saga numerals
  have no slot: `loyaltyRows.badgeFont`, `chapters.badge.numeralFont`. The
  pipglyph.com mark is ALWAYS the brand face, whatever the profile says. A
  rules box is always the body face: its lines are broken on MPlantin's
  advances (one rules layout). The fits measure in the slot's face too —
  `fitTitleBand`, `fitTypeLineBand`, `secondFaceLineSizes`,
  `fitStatSizePct`, a shrunk line's baseline (`slotTextDy`), the bake's
  centred-line margin (`displayRunPx`) and the creator's glyph warning.
- **The fonts of a render** — `cardFonts(profile)` in
  `lib/render/card-fonts.ts`: MPlantin, MPlantin italic, CardDisplay, [a
  profile's own faces], Mana, CollectorLine, Keyrune. Today the same six
  for every profile. A new face is registered only for the profiles that
  name it, in the bracketed place — never last (Satori draws a character no
  font has with the LAST registered font).
- **The metric tables** — `lib/cards/font-metrics.ts` is GENERATED from the
  committed TTFs: `node scripts/generate-font-metrics.mjs` (`--check` exits
  1 when stale). `display-metrics.ts`, `stat-fit.ts` and `rules-metrics.ts`
  read it; a test holds it byte-equal to the generator and equal to a
  frozen copy of the hand-kept tables it replaced. Regenerate after a font
  file changes; a new face is a line in `FONT_METRIC_FACES`
  (`scripts/lib/font-metrics.mjs`).
- **The footer line** — `TextSlot.prefix` on the footer (`"Art: "` when
  unset, `footerArtistLine` in `lib/cards/card-display.ts`) and the
  footer's own `align`: unset = the line at the rect's start and a clean
  download's custom mark at its end; `"center"` = the line centred, no
  custom mark on it. The 2003 frame's is `""`: the bare credit after its
  brush — `FrameProfile.footerBrush`, the brush's ink box, drawn by both
  renderers from `lib/cards/footer-brush.ts` in the footer's ink (TODO
  4.10b).
- **The © slot** — `FrameProfile.copyrightSlot`
  (`lib/cards/copyright-slot.ts`, TODO 4.10a): a two-line footer's second
  line — centred under a centred artist line (the 1997 frame) or set from
  its left end (`startPct`: the 2003 frame, TODO 4.10b). On display it
  holds the pipglyph.com mark (which then leaves the border: `brandMark`
  is not read), on a paid clean download the card's footer text, or
  nothing. The 1993 pair's slot IS the border (`endPct`: the line ends
  where the border mark ended, TODO 4.10c): its strip has one line. A profile with a centred footer and NO slot drops a paid
  viewer's footer text: declare both together; a profile WITH a slot never
  prints that text at the end of line 1.
- **The symbol style** — `FrameProfile.symbolStyle`
  (`lib/cards/symbol-style.ts`): `"modern"` (M15's discs, their hard offset
  shadow under the COST, flat pips in the rules text since layout v49, the
  modern tap — every profile that names none), `"1997"`
  (flat discs, mana-font's `tap-4ed`: `retro`, `retroland`) and `"2003"`
  (a COST disc with a black shadow down and a little to the left, flat pips in the rules
  text, the modern tap: `modern`, `modernland`) and `"original"` (flat discs
  12 px apart, the five colour symbols as the 1993 drawings — frames-bucket
  IMAGES through `symbolImages` — and mana-font's `tap-3ed`: `agclassic`,
  `alphaland`). Both renderers and both
  shadow models (the rules layout's inline pip, the cost row) read the
  resolved spec — an inline pip through `inlineSymbolStyle`, which drops
  the shadow where a style shadows the cost row alone. A style is a CORRECTION of a frame, never a per-card switch.

Adding a face, a prefix or a style is a profile change with its own layout
bump; `tests/unit/render/profile-data-parity.test.tsx` gives a throwaway
profile each of them and requires the same answer from the bake and the
preview.

**A card's pip is ONE description, drawn twice** (preview-symbol parity,
2026-10-07; the prints' own drawings since layout v49, below).
`lib/cards/mana-gem.ts` `manaGemSpec(symbol, pipPx, style)` holds what the
bake draws where a PLAIN pip's disc is `pipPx` — the disc's own diameter
(`discPx`: a Phyrexian symbol's is larger), its colour per tint or none, the
`#150d08` ink, the glyph's size (`manaGlyphPx` for most), a hybrid / twobrid
disc's 135° fill and its two half-symbols' size and corners, the snow
flake's SVG — and both the bake's `ManaGem` and the preview's `CardPip` read
it; neither keeps a table of its own. A number there is a stored-bake
number: changing one is a layout bump. `CardPip` takes mana-font's
`ms ms-<suffix>` for the font and the glyph ONLY and is marked
`data-pip="<suffix>"` (tests and tools select a card's pips by that); it
never takes mana-font's cost or shadow class, whose own look is not the
stored card's (its own untap disc, Phyrexian scale and snow glyphs, a disc
behind the energy symbol, lighter split colours at other offsets, `#111`
ink) and cannot be overridden from an element's style. Those classes stay on
every pip OUTSIDE a card (pickers, toolbar, deck lists, articles, the
dashboard), which keep mana-font's look. A symbol mana-font has no glyph for
(`{C/P}`, `{21}`, `{1/2}`…) draws NOTHING in either renderer — no
disc, no room, no gap: `hasManaGlyph()` is the browser's copy of the bake's
codepoint map (`lib/render/card-fonts.ts` is server-only), held to the
installed `mana.css` by `tests/unit/cards/mana-gem.test.ts` — a mana-font
upgrade that adds or drops a reachable glyph fails there until the list
follows. The creator WARNS about such a symbol and never blocks the save
(stored cards hold them): `undrawableSymbols()`
(`lib/validation/card-glyphs.ts`) reads a cost or a rules-style text with
the renderers' tokenizer and asks `drawsManaGem()` — no list of its own, the
owner's custom pip image first as both renderers do (today only `{W}`…`{C}`,
which the font has, so an override changes no answer) — and
`UndrawableSymbolNotice` names them per field beside the missing-character
notice ("Mana cost: {21} and {C/P} can't be drawn and will be left off the
card."); flavor text is not read, no renderer parses symbols there, and
neither is the `rules_text` of a planeswalker or saga frame with a filled
row — the card draws the rows, and the form's serialized copy (an import, a
saved card) has no field to edit it in (`cardSymbolFields`). The AI
lint refuses one in a cost or rules text through the same helper (the
judge's pass, then `withDrawableSymbols`: a generic past the font's last →
the largest that draws), and a Scryfall import of a printing that uses one
says so (`undrawableSymbolsNotice`: toast + the import dialog's note). The
hybrid Phyrexian symbols (`{G/U/P}`: Tamiyo, Compleated Sage; Ajani, Sleeper
Agent's `{G/W/P}`) DRAW since layout v49 — the notices follow
`drawsManaGem()` and no longer name them, and the AI's `{W/U/P}` → `{W/U}`
swap and prompt sentence are gone. The shadow's
colour in the preview is the one the PNG holds, not the style's CSS colour
(`bakedShadowHex()`: sharp's librsvg runs the shadow's filter in 8-bit
linearRGB, `#111` lands on `#0d0d0d`); `mana-gem-parity.test.tsx` reads it
out of a real bake. A new symbol style puts its pip data in the spec /
`mana-gem.ts` and both renderers follow.

### Symbols as printed (layout v49, TODO 6.16b; owner round 43, 2026-10-08)

Six corrections of a card's symbols against real prints — Scryfall PNGs,
2006 → 2025, each symbol's disc found by a fitted circle and scaled to the
HD bake (the round's sheets and measurement tables; no scan is read by a
build). The numbers live in `lib/cards/mana-gem.ts` as data.

| | the prints | a card (HD) | was |
|---|---|---|---|
| a pip in RULES text, `modern` style | flat: shadow 0.003 ± 0.010 of the disc under 31 text pips on 21 prints (M15 2014 → TDM 2025); 0.079 ± 0.017 under the same cards' cost discs | no shadow (`inlineShadow: false`); the cost row keeps 0.06 left / 0.07 down | the cost's shadow under every inline pip |
| Phyrexian `{W/P}`: the disc | 1.175 ± 0.020 of the plain pips beside it in a cost (n = 8, M15 frame; New Phyrexia's on the 2003 frame: 80.9 px against that frame's 66 = 1.22), 1.21 ± 0.08 in rules text (n = 8) | ×1.2: 88 px beside 73 in a cost, 72 beside 60 in 9-point text, on the plain pip's centre (re-measured and re-set by layout v53, below: ×1.28 in text, 85 px on the 2003 frame) | the plain pip's disc |
| Phyrexian: the symbol | 0.904 ± 0.009 of ITS disc tall in a cost (n = 11), 0.913 ± 0.018 in text (n = 8) | font size 0.91 of the disc (the glyph is 1 em tall; 0.90 in the PNG) | 0.73 × a 1 em glyph on the smaller disc: 0.70 |
| two-colour Phyrexian `{G/U/P}` | disc 1.224 ± 0.025 of its neighbours (n = 5: NEO, DMU, ONE); each half's symbol 0.453 ± 0.051 of the disc tall, 0.169 ± 0.029 of it off the centre | the hybrid's 135° fill on the ×1.2 disc, mana-font's `p` in each half at 0.45 of the disc (`PHYREXIAN_SPLIT_GEM`) | not drawn at all (no disc, no room) |
| untap `{Q}` | disc #202123, arrow #fefdfe, 0.639 ± 0.008 of the disc tall and 0.622 ± 0.011 wide (n = 9, SHM 2008 → MB2 2024) | disc `#211f23`, arrow `#ffffff`, font size 0.9 of the disc (mana-font's arrow is 0.704 em: 0.63) | the grey disc, a dark arrow 0.51 of it |
| snow `{S}` | a WHITE flake 0.921 ± 0.009 of its grey disc across (text, n = 6; 0.94 in a cost), a dark outline 3.1 ± 0.4 HD px = 0.056 of the flake (n = 8, CSP 2006 → J22 2022: one drawing throughout) | the generic disc, the flake 0.92 of it (56 × 54 px on 60), white inside a 2.3–2.8 px outline | mana-font's `s`: a dark line drawing 0.70 of the disc, no white |
| energy `{E}` | NO disc; the symbol 0.895 ± 0.012 of a text pip's disc tall, 0.883 ± 0.016 wide, advancing like a pip (18 symbols on 9 prints, KLD 2016 → DRC 2025) | no disc and no shadow (`bg: null`), font size 1.04 of the cell (0.863 em tall: 0.90), in a plain pip's cell | a grey disc with the symbol 0.63 of it |

**Per era.** One look on every symbol style, by the prints: the untap
symbol first printed on the 2003 frame (Shadowmoor / Eventide 2008) in the
drawing the M15 frame keeps; Phyrexian mana on the 2003 frame (New Phyrexia
2011) at the same ×1.2 and 0.90; the snow symbol on the 2003 frame
(Coldsnap 2006 — Ice Age and Alliances of 1995–96 print no snow symbol);
energy (Kaladesh 2016) and the two-colour Phyrexian symbol (Kamigawa: Neon
Dynasty 2022) on the M15 frame only. The 1997 and 1993 frames never printed
any of the five (the 2021+ retro reprints are not their reference), so a
card on them takes the nearest printed look — the same one: on the
`"original"` style (TODO 4.10c) the five COLOUR symbols stay the 1993
drawings (bucket images, a plain pip's disc), and `{Q}`, `{S}`, `{E}`, a
Phyrexian symbol and the two-colour Phyrexian disc are the font's glyphs in
the printed look, as on every other style. The flat inline pip is
`modern`'s correction alone: `"1997"`, `"2003"` and `"original"` already
set it flat. NOT part of v49: the hybrid and twobrid discs (layout v53,
"The large pips" below) and the plain cost disc's size (TODO 3.34).

**How.** `pipScale()` / `pipDiscPx()` / `pipRisePx()` (mana-gem.ts) are the
one answer to "how big is this pip": the rules layout measures a pip with
them (`pipWidthPx`, `pipTopOf` in `lib/cards/rules-layout.ts` — widths, ink
boxes, keep-outs, the clip check), the cost row's room for the name
(`costRowTerms` beside an inline cost; `manaCostWidthPct` before a detached
one since v52, below), and both renderers draw `manaGemSpec().discPx` at
`pipTopOf` — a larger disc keeps a plain pip's centre. The snow flake is
ONE inline SVG both renderers draw from the spec (`SnowFlakeSpec`: the
font's white parts — `lib/cards/snow-flake-path.ts`, glyph data of
mana-font's `s-mtga`, SIL OFL 1.1, no font file added — stroked in the ink,
then filled and stroked thinly in white): Satori has no text stroke, and
the same vector element in the browser is the same shape. The energy
symbol keeps a pip's cell, so no line moves.

**Rollout.** A CORRECTION: `"sweep"`, no badge, after the owner's round-43
sheets. Card-scoped (`v49Changed`): a redrawn symbol anywhere a pip is read
(cost, rules text, walker rows, saga rail, second face), or an inline pip
in printed text on a template that shadowed it (every template but
`retro`, `retroland`, `modern`, `modernland`, `agclassic`, `alphaland`), or
a modal double-faced body
(its strip sets the other face's cost as text pips); every other card is
stamped without a re-bake. Verification-neutral: no slot, master, size or
plate moves.

**What moved (measured 2026-10-08, v48's `main` `ad18f226` against the v49
commit).** Public production, 863 cards (anonymous read; each row replayed
art-less at HD on both commits — the replay of the one card baked with its
art on the v47 base is the stored production PNG pixel for pixel): 356
re-bake — 353 change pixels (349 by the flat pip alone, three by `{Q}`, one
by a Phyrexian `{W/P}`), 3 re-bake to the same pixels (a pip in a legacy
second face the frame does not draw) — and 507 are stamped, each
byte-identical on both commits; of 129 unlisted, 51 re-bake. No stored card
changes its rules size or a line break, the Phyrexian one included (72 px,
the same seven lines). 240 real rules texts: the flat pip alone moves no
size and no break; the larger Phyrexian disc moves a break in 4 of the 30
texts that carry one, and no size. The visual matrix: 656 of 1451 cases
change (650 the flat pip, 6 "edge" cards `{Q}` / `{B/P}`); one moves a
line break by the flat pip — the saga set past the floor, whose chapter
column was inset 3 px for the shadow of a pip that starts a line
(`sideInsetNeeded`) and is that much wider now — none changes size, none
its clipped state, and `rules-no-clip.test.tsx` draws a text of these
symbols through every rules consumer without a clip. Chromium against the
HD bake (m15, the 2003 and 1997 frames, a walker's rows, a saga's rail; 750
and 1500 px; 178 pips, each of the six in a cost and in text): every
symbol's ink box within 2 px in place and size (the two-colour disc's pair
of symbols within 4).

**The name before a detached cost (layout v52, TODO 6.16d; owner
2026-10-12).** Four templates place the cost in a box of its own
(`FrameProfile.costRect`: `modern`, `m15pw`, `m15borderlesspw`,
`m15borderlesspwtall`; `modernland` has the box but hides its cost) and fit
the name to the room the row leaves: `titleBandRoomPct` →
`manaCostWidthPct` (`lib/cards/title-band.ts`). That measure counted every
pip as ONE plain disc, so since v49 a Phyrexian symbol's ×1.2 disc was not
in it and a long name was set wider than its room. It now counts each pip at
`pipScale()` — the same one source `costRowTerms` reads for an inline cost;
there is no second table — and a plain pip's factor is exactly 1, so a cost
without a larger disc measures to the same float and bakes to the same
pixels.

Name end → first disc at HD (1500 px wide), the longest name the fit keeps
whole, on a flat stand-in master (negative: the name runs under the discs):

| symbols | `modern` plain | `modern` Phyrexian, before → after | `m15pw` plain | `m15pw` Phyrexian, before → after |
|---|---|---|---|---|
| 1 | 52 | 39 → 39 | 35 | 19 → 46 |
| 3 | 52 | 13 → 38 | 48 | 2 → 49 |
| 5 | 53 | −12 → 54 | 31 | −45 → 40 |
| 7 | 49 | −42 → 47 | 39 | −67 → 31 |
| 10 | 39 | −91 → 39 | 28 | −123 → 23 |

The two borderless walkers measure as `m15pw` (the same band and box) to
within 2 px. The plain columns are the same numbers on both commits. The
row as DRAWN is still a little longer than measured — the cost discs'
shadow and whole-px rounding, up to 1 px a pip, which no plain cost counted
either: measuring the detached row with `costRowWidthPct` would move every
`modern` / walker name by a pixel or two and is not part of this.
`tests/unit/render/title-room-scaled-pips-bake-<n>.test.ts` (the bakes of `title-room-scaled-pips-bake.test.tsx`, in four files) hold 20 px of air
on real bakes of all four at 0–10 such symbols, at 750 px and HD.

A CORRECTION: `"sweep"`, no badge. Scoped to the four templates
(`V52_DETACHED_COST_TEMPLATES`) AND to a card whose own cost holds a
Phyrexian symbol (`v52Changed` — the slash-less `{WP}` a cost typed by hand
may hold is read too: the tokenizer gives it the symbol's own suffix and
both renderers draw it on the larger disc); every other card is stamped.
Verification-neutral (no slot, master, size or plate moves). Production
(anonymous read, 2026-10-12): 17 public cards on the four templates, no
visible card on any template with a Phyrexian symbol in its cost — nothing
stored re-bakes. The visual matrix: no existing case changes; six are new
(`@phyrexian-cost-3`, `-5`, `-5-hd` on `modern` and `m15pw`).

**A pip's class is never written out as a literal.** mana-font's class for
generic mana is `ms-` + the number, and Tailwind reads the same token as a
`margin-inline-start` utility — which it emits for every candidate it finds
in ANY file git does not ignore (tests, scripts and docs too). The app
builds the class from the symbol, so the build has no such utility; one
literal anywhere (the first draft of the parity test spelled the generic-3
pip's class in an expectation) gives every such pip in the browser a 12 px
left margin — preview only, so no bake-side check sees it. mana-font guards
the 2 itself (`margin-left: inherit !important`); nothing guards the rest.
`tests/unit/content/mana-class-collision.test.ts` fails on any such token
in the tree: use `{X}` or a colour in a test's expectation.

### The large pips (layout v53, TODO 3.21; owner round 49, 2026-10-12)

One measuring pass over 279 Scryfall PNGs (2005 → 2026; each disc a circle
fitted to its outer edge — 90 rays, the edge on each the centroid of the
colour gradient's peak — which reads our own bakes, downscaled to a
Scryfall PNG's 745 px, to −0.09 ± 0.08 px on 169 discs of known size; no
scan is read by a build). Sizes in HD px.

| | the prints | a card (HD) | was |
|---|---|---|---|
| hybrid `{W/U}` in a cost | 2003 frame 84.9 ± 1.3 (87 discs, 53 prints; RAV 84.7, SHM / EVE 85.0, ARB 84.2, RTR 85.1) beside a 66.1 px plain pip = ×1.285; M15 frame 85.1 ± 1.2 (65 discs, 40 prints; 2014–19 85.1, 2020–22 85.7, 2023–26 84.4) beside a 70.2 px one = ×1.21 | 85 px beside 66 (`"2003"`: 85/66); 88 beside 73 (`"modern"`: ×1.2) | a plain pip's disc (66 / 73) |
| twobrid `{2/W}` in a cost | 2003 frame 85.0 ± 1.1 (24 discs, 9 prints); M15 frame 85.1 ± 1.6 (54 discs, 17 prints — Commander 2014 89.9 and Jace vs. Vraska 88.6 are larger, Modern Masters 2015 on 84.4–84.6) | the hybrid's | a plain pip's disc |
| Phyrexian `{W/P}` in a cost | 2003 frame (New Phyrexia) 84.8 ± 0.2 beside 65.5 = ×1.296 ± 0.006 (19 discs, 15 prints); M15 frame 84.6 ± 0.9 (8 discs, 6 prints) | 85 px beside 66; 88 beside 73 (unchanged) | 79 px on the 2003 frame |
| two-colour Phyrexian `{G/U/P}` in a cost | 84.7 ± 0.2, ×1.212 ± 0.004 of the plain pips on the same card (5 prints of 3 cards) | 88 beside 73 (unchanged) | — |
| any large pip in RULES text | 1.28 of the plain pip in the same text (median 1.283 over 9 cards: 2003 frame 1.286 ± 0.006, n = 4; M15 frame 1.275–1.34, n = 5) | ×1.28 on every style: 77 px beside 60 in 9-point text | hybrid and twobrid ×1.0, Phyrexian ×1.2 (72) |
| centre and spacing | the plain pips' centre line (+0.1 ± 0.5 px in a cost, −1.1 ± 1.7 in text); about 7 px between neighbours whatever their size | the plain pip's centre (`pipRisePx`); the style's gap | the same |

The prints draw ONE large disc, about 85 px, on both frames and in every
era measured; its step over the plain pip differs only because the M15
frame's plain cost pip is bigger than the 2003 frame's. In 9-point text a
77 px disc is about the line pitch (74 px), as on the prints (Boros Locket,
GRN #231: 70 px discs on a ≈ 70 px pitch): two on consecutive lines touch.

**Per era (owner decisions 2026-10-12).** `"modern"`: cost ×1.2 (the print's
×1.21), text ×1.28. `"2003"`: cost 85/66, text ×1.28. `"1997"` and
`"original"` never printed a large pip: they keep ×1.2 in the cost (decision
4) and take ×1.28 in text. The black disc on the white 1997 / 1993 frames
stays as it is — its colour is the prints' (1997: rgb(146, 141, 134) against
our reading of ours, rgb(156, 146, 138)), no print outlines a cost disc and
no rim is drawn (decision 5; TODO 3.32). The Phyrexian symbol stays
mana-font's (decision 6; TODO 3.33: the printed ring is 0.552 of the disc
wide against the font's 0.508, its line 0.078 against 0.063). The plain M15
cost pip measures 70.2 px on the prints against our 73: TODO 3.34, not
changed here (decision 7).

**How.** `isLargePip()` says which symbols are large (every split disc and
the Phyrexian symbol); `pipScale(symbol, style)` answers with the
`largePipScale` of the style of the PLACE: the frame's `SymbolStyleSpec` for
a cost (`costRowTerms`, `manaCostWidthPct`, the cost row's `ManaGem` /
`CardPip`), `inlineSymbolStyle(style)` for rules text — it hands the style's
`inlineLargePipScale` back as `largePipScale`, and the rules metrics carry
the same number (`RulesMetrics.largePipScale`, `RulesDraw.largePipScale`),
so the layout's `pipWidthPx` / `pipTopOf` and both renderers' inline pips
read one field. A new style names both factors; a renderer never learns a
style's name. The cost disc's shadow keeps its share of the disc (on the
2003 frame 3 px left and 8 down under an 85 px disc, 2 and 6 under 66).

**Rollout.** A CORRECTION: `"sweep"`, no badge, after the owner's round-49
sheets. Card-scoped on any template (`v53Changed`): a hybrid or twobrid
symbol anywhere a pip is read; a Phyrexian symbol in a text; a Phyrexian
symbol in a cost only on `modern` / `modernland` and on the modal
double-faced bodies (their strip sets the other face's cost as text pips).
Every other card is stamped without a re-bake. Verification-neutral: no
slot, master, size or plate moves.

**What moved (measured 2026-10-12, `main` against this commit).** Public production (a fresh anonymous read of every public card
with a slash symbol in its cost, rules text, second face, rows or rail: 14
rows, each unchanged since the 863-row read of 2026-10-08; each replayed at
HD on both commits): 7 cards re-bake and all 7 change pixels — six with a
hybrid pip (four in the cost, two in the rules text; one of them a modal
double-faced card, whose back face changes too: its strip sets the front's
hybrid cost) and one with a Phyrexian pip in its rules text. None changes
its rules size; one moves a line break (a `{G/U}{G/U}` mutate cost in the
text: "…for its / mutate cost" becomes "…for / its mutate cost"). The other
7 rows of the read (walkers and sagas whose rows hold "+1/+1") and every
other public card are stamped: 856 of 863, and all 129 unlisted cards of
the 2026-10-08 read; the 7 stamped rows of the fresh read bake
byte-identical on both commits. No stored public card sets a twobrid, and
none on the 2003, 1997 or 1993 frame sets a large pip. 120 real rules texts
with a large pip in the text (36 of round 43's 240 and 84 Scryfall oracle
texts): 2 change size by one step (one down, one UP — its larger pips move
a break and the text then fits a size larger), 6 more move a line break,
none clips. The visual matrix: 340 of 1526 cases change and 3 are new (`@large-pips-hd` on `m15`, `modern` and `retro`); every
changed case holds a symbol in v53's scope (the gate), 66 cases in scope
bake to the same pixels (a symbol in a text the frame does not print).
Chromium against the bake (`tests/parity`): the three new cases and the
`@symbols` card within the limits at 750 px and HD — the cost row 0 px off
at HD on all four.

### The cost row as printed since 2023 (layout v61, TODO 3.34; owner 2026-10-22)

Wizards moved the cost row in mid-2023: from The Lord of the Rings (LTR, June
2023) on, every M15-frame card sets its pips lower in the title bar than the
2014 – April 2023 cards did. The CC-framed M15 profiles' row
(`CC_M15_COST_DY`, v24 – v60) sat on the older cards. The owner chose "match
current cards" (2026-10-22), with TODO 3.34 (the disc's size) folded in.

**How it was measured (2026-10-21).** 308 Scryfall PNGs (two passes,
≥ 250 ms apart: 217 across 16 cells — mono, gold, 5–7-pip, hybrid,
Phyrexian, artifact, crowned, Nyx, saga, borderless, Universes Beyond,
snow, devoid, Vehicle, transform, modal — and 91 chosen by pip count with
only `{W}` / `{U}` / generic symbols), each era sampled apart (before
2023-06-01 / after). Our own HD bake of every card (same name, cost and
colour on the frame an import picks) went through the SAME pipeline:
downscaled to 745 px, a circle fitted to each disc's rim (the large-pips
fit above), and each image registered on its own title bar's dark outline
(top and bottom, median over 95 columns), so a print scanned or cropped a
pixel off still compares. Two traps, both checked by eye: the `{W}`, `{B}`,
`{R}` and `{G}` symbols run into the disc's rim and pull the fit 6 px down,
so position and size are read on `{U}`, numeral, `{X}` and `{C}` discs only;
and a June-2023+ image sits 1.1 ± 0.15 px lower in its PNG than ours, the
bar with it — hence the registration (raw, the 2023+ rows read 5.7 px low,
the investigation's +5.2).

| HD px | 2014 – April 2023 prints | June 2023 + prints | v24 – v60 | v61 |
|---|---|---|---|---|
| disc centre, below our old row (registered) | +1.1 (med; mean +1.8 ± 3.3, n = 11 — scans) | **+4.6** (+4.58 ± 0.05 on every 4- and 5-pip cost, n = 16; median of all, n = 32: +4.76) | 0 (152.0) | +5.0 (157.0: the disc on 122–192) |
| plain disc | 70.2 ± 2.0 | 70.1 ± 0.2 (4–5 pips) / 69.8 ± 1.3 (all) | 73 | **70** |
| pitch, plain to plain | 77.1 – 78.0 | 77.7 – 78.4 (77.8 ± 0.9) | 82 (73 + 9) | **78** (70 + 8) |
| large pip (hybrid, Phyrexian) | 84.6 – 86.6 | 84.4 ± 0.9 | 88 | **84** (× 1.2) |
| last disc's centre x | 1351.5 – 1354 (scans, ± 3) | 1349.2 – 1350.4 | 1346 | **1349.5** (the row's end 2 px right, `costDx`) |

So only the PLACE moved in 2023 — down about 4 px; the size (70 px) and the
pitch (78) are the same on both eras, and both were 3 – 4 px smaller than
ours (TODO 3.34's 70 against 73 holds on a sample chosen for it). After the
change the same pipeline reads print − ours on the 2023+ cards as centre
+0.1 (median, n = 67), disc +0.1, pitch −0.3, large pip +0.5.

**The walkers (owner 2026-10-22).** `m15pw`, `m15borderlesspw` and
`m15borderlesspwtall` take the same 70 px disc, 78 pitch and 84 large pip
(`M15PW.costSizePct`, which the borderless pair spread). Their PLACE is
#597's (layout v60: `costDy` 2 / 1500, the discs centred on 128 px) and is
not touched. Their row's end was read the same way, on 30 more walker PNGs
(regular and borderless, 20 of them June 2023 +, each paired with our bake of
the same name and cost): the prints' discs 70.0 – 70.2 px, pitch 78.2 – 78.7,
the last disc centred on 1350.4 – 1351.2 px — 4.2 – 4.6 px right of ours
once ours were 70 px (1346.5 – 1347). `costDx` 4 / 1500 puts it there
(print − ours after: +0.3 / −0.5 px, regular / borderless). The 2014 – 2022
walkers end their row 3 – 6 px further right still (scans, ± 5).

**The trade-off.** An older card — an import of a 2014 – April 2023 printing,
and every card made in the creator on these frames — now sits about 4 px
BELOW its own print (−3.5 median, −3.9 mean, n = 20; the investigation's
raw reading, ≈ 6 px). The owner chose current print; no per-era switch.

**Where.** `CC_M15_COST` in `lib/cards/template-layout.ts` — one spread of
`costSizePct: CC_M15_COST_DISC_PCT` (`lib/cards/typography.ts`, 70 / 1500),
`costDy: CC_M15_COST_DY` (−6.6 / 1500) and `costDx: CC_M15_COST_DX` (2 / 1500)
— on the 36 profiles that drew the Card Conjurer lift (m15 and its
artifact, Vehicle, Nyx, station, Universes Beyond, snow, devoid and
borderless dresses; the transform and modal bodies, front and back; saga and
its double-faced pair; adventure's and Prepare's fronts; extended art; the
textless pair).
The disc and the nudge are whole HD px; the lift is −6.6 px on purpose:
the bake lays the disc out on Satori's whole px (128.8 → 129) and moves it
by the whole px nearest the lift (−7), the preview by the exact fraction, so
−6.6 keeps the two within 0.4 px (−7 left the preview 0.8 px high).
At 750 px the 70 px disc is exactly 35 px, which retires the parity check's
known difference `750-cost-row-width` (the preview's row was wider by half a
pixel a pip against the bake's whole-px 36 px discs). `costDx` is a translate: the row's layout box,
which the name's room is measured against (`titleBandRoomPct` →
`costRowWidthPct`), stays put, and the narrower row gives a name beside a
cost 3 px per pip and 1 per gap MORE room — a name never loses room. Inline
rules pips are untouched (they follow the rules size, not the cost disc).
NOT changed: flip and aftermath (their own prints' rows), the old frames,
and the MSE-framed showcases (`nyx`, `fullart`, `expeditionland`,
`tarkirdraconic`, `tarkirghostfire`; `lotr`, `lotrscroll` and
`tarkirdragon` took the row with their Card Conjurer rebuilds, 4.11) — `COST_DISC_PCT` keeps 72.75 px for them; the showcases wait for
their Card Conjurer rebuild (TODO 4.11).

**Rollout.** A CORRECTION: `"sweep"`, no badge, after the owner's before /
after sheet. Template-scoped to the 39 (`COST_ROW_PRINT_TEMPLATES`: the 36
and the three walkers) and card-scoped (`v61Changed`): a card that draws a
cost — its front's, or on a double-faced body its back's. A card with no
cost bakes byte-identical and is stamped. Verification-neutral (owner
2026-10-22, as v32, v36 and v60): the discs move inside the title band or
cost box a tick verified — no slot, master or plate moves — and the owner
signs the row off on the before / after sheet, so every tick stays fresh.

## Text sizes on the M15-era family

TODO 4.20, layout v32. The M15-era family (`M15_FAMILY_TEMPLATES` in
`lib/cards/m15-family.ts`: 82 templates — the 23 of v32's frozen scope in
`lib/cards/layout-version.ts`, plus the two text-box tokens and their two
tall-box twins (4.55), the six
full-art tokens, 4.33's two borderless planeswalkers, 4.34's borderless
land, the emblem, 5.1a's five transform bodies, 5.1b's four modal
bodies, 4.5c's Vehicle frame, 4.7's Nyx dress, 4.27a's two station frames and its two Spacecraft dresses (step 2), 4.25's three Universes Beyond frames, extended art's land dress (4.7, owner Round 63), 4.40 / 4.41's three older full-art basics, 5.7's four borderless double-faced bodies and 5.5 (b)'s double-faced saga front and back, and 4.51's six Nyx dresses of the full-art tokens, 4.27's Prepare frame and 4.11's 2015 Expeditions, new templates that joined without a bump, and the battle, which
joined WITH one — layout v43, on its Card Conjurer master, the family's
one landscape member: its sizes are the constants through
`displayPct(…, "landscape")`, the same px on the card — and the Lord of
the Rings scroll, WITH one too: layout v62, on Card Conjurer's 'Scroll'
pack, the ring, layout v65, on its 'Ring' pack, the MUL Tarkir
dragon wings, layout v67, on its 'Tarkir' pack, and the Tarkir:
Dragonstorm draconic and ghostfire showcases, layout v68, on their MSE
masters with the printed border painted, and the Avatar elemental and
Bloomburrow woodland showcases, layout v69, on their MSE masters with the
title bar and footers MSE paints at render time built in) prints its names,
type lines, pips and set symbol at ONE set of sizes, Card Conjurer's, which
match the prints. Split is M15-era too and stays OUT: a split half prints
every line smaller than a regular card (the `SPLIT_*` constants, [The
landscape layouts](#the-landscape-layouts-421b-layout-v43)) — its slots
are `fit: "measured"` all the same. They live in `lib/cards/typography.ts`, as fractions of a
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
  adventure panel centre their text in the rect (an UNTURNED second face
  with `fit: "measured"` — the split's right half — is fitted and drawn as
  a front band is, v43);
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
  0.065 W glyph (`setSymbolFit: "ink-box"`), whatever the set; the split's
  thin bar fits a glyph's ink to its 48 px box by HEIGHT
  (`setSymbolFit: "ink-height"`, v43) and reads no printed-size table,
  which holds a regular card's sizes. A NEW entry
  (or a re-measured one) changes its set's stored bakes: a layout bump whose
  scope names the set. The planeswalkers' `symbolRect` ends where M15's
  band does (92.2 %W, 1383 px — layout v36, TODO 4.47): the walker prints
  put the symbol where their set's regular cards do (+0.1 px on average
  over seven walkers, 1380–1392 px), where 79 %W ended it 18 px short; the
  borderless walkers spread the rect and move with it (owner round 18). A
  symbol wider than a 12 %W `symbolRect` (the core-set pills) is never
  shrunk to it: it ends at the rect's right edge and reaches out on the
  left, in both renderers (`flexShrink: 0`).

**The planeswalker's cost row and name (layout v60).** Round 3 (layout
v27) put the walker's pips 48 % of the way down Card Conjurer's taller
title plate (132 px at HD) — a read of the plate, not of the print. Read on
the prints themselves (1500 × 2100 Scryfall PNGs, for measuring only; a
fixed-radius circle fit on the white, blue and generic discs — black, red
and green pull a fit into the drop shadow), every walker since 2023 centres
its pips at 127.3–127.7 px, regular (WOE #78, LCI #238, MKM #211, OTJ #271,
BLB #230, DSK #220, EOE #2) and borderless (LCI #307, OTJ #305, BLB #341,
FDN #357 / #359, INR #322) alike, and the earlier ones at 124.7–127.3 (ELD
#197, KHM #225, NEO #238). `M15PW.costDy` 0.004 → 2 / 1500 (two whole px
under the box's 126 px centre at HD, one at 750: 128 px in both bakes and
the preview) and the name's text 4 px up with them (`title.dy` −4 / 1500:
capitals 101 → 97 px, baseline ~161 → ~157; the prints set them at
~97–100 / ~156–158). The cost box, the title rect, the disc and every
master stay; `m15borderlesspw` and `m15borderlesspwtall` spread both. A
CORRECTION: layout v60 (`WALKER_COST_ROW_LAYOUT_VERSION`), "sweep", scoped
to the three templates (every card on them re-bakes), never a badge, and
verification-neutral as v32 and v36 were on the same frame. The disc is the
family's `COST_DISC_PCT`: a change of that constant reaches the walkers
too, centred on the same row.

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
(`lib/cards/loyalty-rows.ts`, drawn by `RulesLines` / `RulesLinesBake`) and
the saga rail (`lib/cards/saga-rail.ts`: its reminder block and each
chapter are rules layouts in their own boxes, drawn by the same
`RulesBox` / `RulesBoxBake`) are broken by the same module; the rows of
both are sized by one arithmetic (`contentRowsAt` in `loyalty-rows.ts` —
[The saga (4.21c)](#the-saga-421c)).

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
  the frame's own textbox border pads past it, per side
  (`SPLIT_TEXTBOX_BORDER_PX`: 0 / 0 since layout v43 — the Card Conjurer
  split's rules rects lie inside the paper, 17–20 px from its sides, which
  `tests/unit/cards/rules-box.test.ts` measures on every colour master; the
  MSE rects spanned the window's width and held 33 / 38 px of border);
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
  the art (no plate) keeps its rect clear, and a badge the MASTER paints
  its box, whether the card has a value or not (`StatSlot.paintedRect`:
  the battle's defense shield, v43). The renderers draw no badge of their
  own: the rounded disc behind a plate-less value went with the battle's,
  its one user (no override could ever declare one).

## Tokens

TODO 4.49, 3b.15, layout v34: the 2014–19 frame and the type words. A
double-sided token (two tokens back to back) is
[Double-sided tokens](#double-sided-tokens-55-c).

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
- the TALL text box is its own pair of templates since 4.55 ("The arch
  token's tall text box" below).

### The arch token's name and art slot (4.53, layout v59)

The rest of the print match, on all four arch frames (`m15token`,
`m15tokentext`, `m15tokenartifact`, `m15tokenartifacttext`), measured on 49
prints of 2014–19 (TDOM, TM19, TRNA, TGRN, TWAR, TMH1, TXLN, TBFZ, TOGW,
TEMN, TKLD, TC16: every colour, gold, colourless, the artifact dress, with
and without a text box; Scryfall PNGs, for measuring only):

- **The name** is GOLD (`TOKEN_ARCH_TITLE_INK`, Card Conjurer's `#fde367`;
  the prints' ink median 254, 222, 102 — the scans run 226, 200, 85 to
  255, 244, 159 as they are lit) in **small caps**, centred, on the prints'
  baseline (192.5 px; the band-centred 90 px line sets it 1 px lower,
  `TOKEN_ARCH_TITLE_PRINT_DY`). The prints set Beleren Small Caps, which the
  repo does not have (4.8e, parked): the name is SYNTHESIZED from Beleren
  Bold — `TextSlot.smallCaps`, `lib/cards/small-caps.ts`, the collector
  line's artist's recipe (4.9b) — capitals at 90 px (the prints' capital is
  62.6 px tall: Beleren's 0.7002 em capital at 89.4 px;
  `TOKEN_ARCH_TITLE_SIZE_PCT`), every lower-case letter as its capital at
  0.78 of it (the prints' 48.4 px small capitals, `TOKEN_ARCH_SMALL_CAP_EM`),
  tracking 0.047 em of the capital size (`TOKEN_ARCH_TITLE_TRACKING_EM`: 24
  clean names set through Satori as the bake sets them, against the
  prints' ink — median 1.001, mean 0.999, with the kerning below).
  No font file is added, no glyph: the runs are Beleren's capitals.
- **How both renderers draw it.** One row of runs (`smallCapsRuns`), each
  a flex item with an EXPLICIT width, in its face's own content box
  (`line-height` = ascent + descent), on the row's BOTTOM, a small run
  lifted by the descent it lacks (`smallCapsRunBox`), a word's gap as its
  left margin. Never a baseline alignment (Satori sets inline spans of two
  sizes top-aligned) and never the engine's own run box (Satori sized a
  small run narrower than it drew it, and the next run started under its
  last letter); the row is the same box in both renderers, so it centres
  alike and needs no kerned-width margin. The fit (`fitTitleBand`)
  measures the same runs (`smallCapsWidthEm`).
- **Kerning (owner Round 65).** Each engine kerns INSIDE a run, so a run's
  width is its KERNED width — each glyph's real advance and every pair the
  face kerns, tightening ones included — from
  `lib/cards/small-caps-metrics.ts`, generated from Beleren Bold by
  `scripts/generate-font-metrics.mjs` ("The SMALL-CAPS tables": 249
  drawable characters, the face's GPOS pairs). The line tables
  (`lib/cards/font-metrics.ts`) are untouched: they count only the pairs a
  face kerns apart and guess 1 em for a character they don't list, which
  left "Long-W inded", "SERVO  2.0" and "Cat  Dragon" with holes, Æ / Œ /
  Ø / Ω with gaps and "Avatar" 15 px left of centre. Two touching runs are
  two boxes no engine kerns across, so their pair — a capital and the small
  letter after it (W·A, V·A, T·A: −0.22 em) — is the second run's left
  margin (`kernBeforeEm`), at the small size, in both renderers. The creator's glyph check judges the name as
  capitals on these frames. Parity: `m15token/c/token-long@small-caps`
  (two words) and `m15tokenartifact/u/token-long@small-caps-lower` (a name
  all in lower case).
- **The art slot** is the window the art fills on the prints, with 7.6's
  overscan — never a larger box (until v58: 6.5 / 12 / 87 × 69.4, 17 px
  wider each side than the window, which drew every picture 2.7 % larger
  than print and cropped it past the window). The prints' keyline round the
  window (left 113.1, right 1386.8, bottom 1708.1 / 1406.3 px with a text
  box) is the masters' within 1 px, so the slot is the masters' window +
  1 px across and 2 px down (`tokenArtSlot`): 114–1386 × 261–1707 px on the
  opaque colours (`TOKEN_ART_SLOT`; the text box to 1407,
  `TOKEN_TEXT_ART_SLOT`), and 110–1390 × 257–1711 on the masters whose
  window is 4 px wider each side — the see-through `c` (its own window slot,
  `underFrameArt.artSlot`) and the coloured artifact dresses (the artifact
  templates' slot, `TOKEN_WIDE_ART_SLOT`). Card Conjurer's artBounds
  (7.67 / 12.48 / 84.76 × 68.43) is that window on its un-re-cut master.
  It strikes 4.53 (e) from `ART_WINDOW_KNOWN_FAILURES`; the see-through
  `c`'s seam (4.17c) shrinks (1457 → 1036 px: the arch above the window is
  still silver).
- **Rollout.** A CORRECTION — the look was wrong against the frame's own
  print — so layout v59 (`TOKEN_ARCH_PRINT_LAYOUT_VERSION`), "sweep",
  scoped to the four templates (every card on them; every other template
  bakes byte-identical), never a badge. NOT verification-neutral: the name
  and the art slot are what a tick judges, so the arch tokens' ticks go
  stale and are re-made once (4.53 "Rollout").

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

TSOI #11 Clue prints the TALL box (type bar ~56 %H) and is not a reference:
since 4.55 it is the tall box's ("The arch token's tall text box" below).
The registry pins the 21 arch printings with the tall box
(`TALL_BOX_TOKEN_PINS`: every black-bordered pre-M20 arch token with rules
text measured against this master — Amonkhet / Hour of Devastation's
embalmed and eternalized cards, the SOI Clues, TDOM #7, TC18 #4 / #10 / #19,
TRIX #1, TUST #18). Until 4.55 the `tall-box` gap answered `nearest` the
regular box (the text shrinks to fit) and the 1.6 log counted the demand;
the `token/tall-box` rule now names the tall box once verified.

### The arch token's tall text box (4.55)

`m15tokentall` / `m15tokenartifacttall`: the 2014–19 arch with the TALL box
the 21 pinned printings wear — a shorter window, the type pill high on the
card (56–62 %H), a box twice the regular one. Card Conjurer has no source,
so the masters are PipGlyph's OWN cut of the published `m15tokentext` /
`m15tokenartifacttext` masters (`scripts/build-token-tall-frames.mjs`, the
recipe and the measurements in `scripts/lib/token-tall.mjs`; bucket only,
each WebP's alpha the PNG's; provenance `source: "pipglyph"`).

- **Measured on print** (2026-10-18; Scryfall PNGs, measuring only — no
  scan is read by the build): every one of the 21 against the text-box
  master of its colour (w, b, r; the Clues on the artifact dress's `c`) by
  the correlation of the rows' edges. The title bar, the arch and the
  window's top sit where the master draws them (0 … +3 px, the scans' own
  offset), and so do the box's bottom, the plate and the border. The type
  pill, the box's top edge and the window's bottom edge sit 233–241 px
  HIGHER (median 238; 235–241 against each print's own offset), as ONE
  piece. The type line rides the pill (capitals 1211–1214 px against the
  regular box's 1450, baseline 1262–1266 against 1500) and starts where the
  regular one does (x 124–127). The rules are centred in the taller box
  (ink centres 1621–1635 px; the drawn box's centre is 1634). The box's
  tone is the regular box's within the prints' own spread (TC18 #4 reads
  the regular prints' 1.00 / 0.99 / 0.98 of the master; Amonkhet's warmer
  stock and its frame shift together): no re-tone.
- **The cut** (`recutTokenTall`; nothing drawn, every pixel the parent's,
  moved or cross-faded): rows 1300–1589 — the window's straight sides
  through the box's top edge and first paper rows — move up 238 px as one
  piece (`TOKEN_TALL_RECIPE.up`), faded in over 24 rows inside the window's
  sides. The 238 rows the box gains (1352–1589) are filled column by column:
  the box's paper (x 111–1388, between the pinlines; the window's keyline
  above it) continues the moved band — rows 1590–1827 of the box's own
  paper, so it reads as one taller box — and the side columns (border,
  frame texture, shadow line, pinline: the same structure beside the
  window and beside the box) take the rows 238 px above them, beside the
  window's straight sides, so the frame's lower inner corner (from ~1770)
  is never repeated. Each seam is cross-faded over 24 rows; every row above
  1062 and from 1590 on is the parent's byte for byte
  (`tests/unit/frames/token-tall-recut.test.ts` holds the cut on a coded
  image and every published master against its parent).
- **The profile** (`M15TOKENTALL`): `M15TOKENTEXT`'s, with what the cut
  moves moved by `TOKEN_TALL_UP_PX` (a unit test holds it to the recipe):
  the art slot 238 px shorter (115–1385 × 263–1167 on the opaque masters,
  the see-through `c` and the coloured artifact dresses 4 px wider — 4.53
  (e)'s rule), the type band and the set symbol's box on the moved pill
  (the same dy: the prints' baseline 1 px under the band's), the rules box
  from 1326 px (5 px inside the drawn box's moved top) to the regular box's
  1942, centred, one line centred on it, the plate a keep-out. Everything
  else — 4.53's gold small-caps name, the plate, the footer, the collector
  line, the stamp-less arch — is the text box's. Its see-through `c` keeps
  the arch's 4.17c seam (`ART_WINDOW_KNOWN_FAILURES`, 286 of 916 px down
  each side).
- **The height follows the text**, as on the full-art design: the arch has
  three heights now (`ARCH_TOKEN_TEMPLATES`; `tokenHeightForText(text,
  "arch")` against the arch's OWN regular box — the regular box while it
  holds the text at 72 px or more, else the tall box), and every writer
  reads it through `tokenFrameFor`: the creator (`followTokenHeight` — a
  text going or coming still moves the box as round 11 did, a height that
  disagreed with the old text stays, a Variations pick sticks), a new token
  (`newTokenFrame` / `archTokenFrameIn`), the AI jobs
  (`resolveGeneratedFrame`) and the remix (`autoTokenTextBoxFrame`).
  Wherever the tall box isn't verified in the card's colour the regular
  text box STANDS IN (`archTallStandIn`): the text shrinks to fit as it did
  before 4.55 — never the textless arch's scrim. A stored card keeps its
  frame (the follow moves only a card whose height agreed with its text).
- **Imports**: Scryfall can't tell the height and the text length doesn't
  (the SOI Clue's 39 characters print tall), so the 21 printings stay
  PINNED: the `token/tall-box` rule (`TALL_BOX_TOKEN_PINS`) is `nearest`
  the regular box — where the import always landed — until the tall box is
  verified in the card's colour, then `exact` on it (`onceVerified` +
  `exactOnceVerified`, family `tokentall`); every other M15-era gap still
  names its item. No other printing moves. A request row logged before
  4.55 (`era/2015+tall-box`, landed on the regular box) is ANSWERED on the
  admin page once the tall box is verified in every colour its set's pins
  print (`legacyTallBoxAnswered`, `TALL_BOX_TOKEN_PIN_COMBOS`; owner Round
  77) — those printings import exact then.
- **The deck remix** of a pinned printing follows the PRINTING (owner Round
  77): once it lands on the tall box (verified in its colour), it SAVES
  there whatever its new text — `ScryfallRemixMechanics.printed_height`,
  honoured by `remixSavedFrame` — never re-deciding the height from the
  text (the SOI Clue's text would ask for the regular box). Every other
  token's remix is unchanged: it follows its saved text. Stored tokens with
  long text stay on the regular box (owner Round 77).
- **Tall prints that can't land on it today** (owner Round 77, in TODO
  4.55): TFRF #4 and TC18 #1, the Manifest reminder cards — they import as
  `m15` creatures, a mis-landing of their own — and F18 #2's Elemental back
  (the front, City's Blessing, is another design).
- **References** (`frame-references.json`): TAKH #1 / TC18 #4 (w), THOU #2
  / TDOM #7 (b), TC18 #10 / TRIX #1 (r), TSOI #11 / TC18 #19 (the artifact
  dress's `c`); no other colour printed the tall box (documented nulls).
- **Rollout.** An ADDITION: two new templates, no stored card on them — no
  layout bump, no sweep, no badge; every existing Visual case is
  byte-identical, the new ones join the baseline.

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
(`tokenTypeLineChanged` — the since-retired alphatoken, the showcases, flip's Roles; a
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
  Two colours draw gold (`m`) with the two-colour switch off, and their
  central split with it on; a Legendary token its floating crown with the
  crown switch on (both since 4.48's last pieces, below). The artifact templates are the silver `A` master whole plus
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
  reason for the Nyx dress or a white border (logged "missing" either
  way). A crown and two colours are drawn there since 4.48's last pieces:
  their gaps close on the full-art template (`gapDrawnBy`), so those
  printings are exact once verified, and the import names the switches
  (`printed_crown` from the `legendary` frame effect, `printed_two_color`
  with the pair as the colour). A borderless token (`borderless/token`: WONE, WMOM, SLD —
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

### The full-art token's crown and two-colour split (TODO 4.48's last pieces)

Both are ADDITIONS ([Additions vs corrections](#additions-vs-corrections)):
switches on the card (`frame_style.crown`, `frame_style.twoColor`), on by
default for a new token, absent — off — on every token stored before them,
named by an import only where the print has them; no layout bump, no sweep,
no badge. Scryfall 2026-10-15 (3,037 token and emblem printings, through the
registry): 181 M20+ printings — 51 crowned, 138 two-colour, 8 of them
both — the largest of 1.23's three remaining `nearest` groups (the Nyx
dress 7, the arch's tall box 21).

- **The crown** is Card Conjurer's FLOATING crown, the borderless frame's,
  round the name pill — an overlay band `m20tokencrown/<key>.png`
  (`M20_TOKEN_CROWN`, 1500 × 260 over rows 0–259; `CC_OVERLAY_BANDS
  .m20tokencrown` in the importer): the outline UNDER the crown at CC's
  borderless bounds (2.8/1.72/94.4 × 10.62 % and 3.07/1.91/93.87 ×
  10.24 %), 1:1, nothing erased or covered (the token master has no ring at
  the top to replace). Its hole is the pill's interior — the importer
  checks α 0 there (`M20_TOKEN_PILL_HOLE`) — so it repaints only the
  pill's rims and ends, as the prints' crown carries them. Measured on 11
  crowned prints (TFDN #13, TOTJ #6, TTDC #18 / #19, TMOM #6, TLCC #7, TLTR
  #20, TCMM #60, TAFR #8 / #13, TM3C #11; Scryfall PNGs at 1500 × 2100): the
  crown's top edge into the black border +2.5 px from CC's on the 2023+
  prints, its wings +4 / +1 px — used as drawn, as the name pill (+1.3).
  Keys: the colours, gold, CC's grey C crown (the plain templates' charcoal
  colourless), CC's silver A crown (the artifact templates map `c` → `a`:
  TNEO #16 Tamiyo's Notebook) and the ten pairs (the two crowns across the
  token's split: TDMU #21). The slot says `tokens: true`: a Legendary TOKEN
  qualifies for this crown only (`qualifiesForCrown(facts, tokens)`,
  `crownsTokens`) — every other crown is never a token's, and the 2014–19
  arch draws none (its crown would be 4.6f's).
- **The two-colour split** (`twoColorMasters: ["split"]`, `<pair>.png` on
  all six templates): 32 two-colour prints measured (all ten pairs, three
  heights, 2019 → 2026) split the name pill, the rims, the box and the
  colour strip on ONE untilted ramp, `PAIR_RAMPS.m20Token` 40→60 %W (strip
  42.9 / 50.3 / 58.3 at 10 / 50 / 90 %, the name pill's rim 42.6 / 50.1 /
  58.2, the regular type pill's rim 42.4 / 50.0 / 58.9 — a 40→60 master
  reads 42 / 50 / 58). The plain templates' pair is the two colour masters
  lerped WHOLE (premultiplied), then CC's grey 'Land Frame' type pill in its
  place through the pack's Type mask — the prints' type pill is neither
  colour but one neutral warm grey on every pair (median 193/187/187 on 16
  regular prints) — tinted to it (`M20_PAIR_TYPE_TINT`) and made solid. The
  artifact templates' pair is the silver A frame whole with the two colours'
  pinlines lerped (4.50's recipe, split). A pair's P/T plate is the grey
  colourless one, `c` (`FrameProfile.twoColorPlate`; the prints'
  204/197/192, `m15/pt/c` 203/196/191).
- **The white half of a white pair's name pill** (owner Round 69: tone,
  never an outline on the name) is toned to print's metal: CC's white pill
  reads 220/221/221 there, where 17 white-pair prints (WU, WB, RW, GW on the
  plain templates; the pill's interior rows 110–212 on the white side,
  x 150–450 or 1050–1350, the darker 60 % so the name's ink is left out)
  read rgb 109/109/105 (luminance 108, 87–122) — a white name on near-white
  read 1.16 : 1 at its worst column. A per-channel gain × 0.495 / 0.493 /
  0.475 (`M20_PAIR_WHITE_PILL_GAIN`) in the importer's `finish` step
  (`rampGain`): full on the white side of the split, fading across 40→60 %W,
  only on the pill's translucent interior (α ≤ 230; the rims and outline keep
  CC's pixels), so the pill keeps its own hue and bevel. After: the same
  reading 109/109/105 on every white pair master; white name ink against the
  pill, column by column over x 200–1300 on the name's rows: worst 4.21 : 1
  over mid-grey art and 3.55 : 1 over white art (the pill is α 230), median
  5.6–6.0 — every other pair 5.36 : 1 or more (the artifact templates' slate
  6.2). The black half and every non-white pair are the monos' lerp.
- **Import** (1.23): `token/m20`'s `crown` and `two-colour` gaps still name
  4.48 while the arch stands in (unverified), and are drawn on the full-art
  template (`gapDrawnBy`), so the 181 printings are `exact` once their
  template is verified in the card's colour — all of them on production's
  ticks (`supabase/seed.sql`). One printing prints the crown without the
  word: T2XM #28 Tuktuk the Returned ("Token Artifact Creature — Goblin
  Golem", the rules text makes it legendary). Owner Round 69: it imports
  legendary — "Legendary" in `supertype` (`legendaryTokenSupertype`: a
  token with Scryfall's `legendary` frame effect and no Legendary word),
  which draws the crown — and its line prints as the card does through
  `printed_types` ("Artifact Creature", `printedTypesOfPrinting` →
  `resolvePrintedTypes`).
- **Creator**: the anatomy panel's crown and two-colour switches and the
  Variations "Legendary" entry read the profile like any frame's; a new
  token starts with both on (`anatomyDefaults`).

### The full-art token's Nyx dress (TODO 4.51)

An ADDITION ([Additions vs corrections](#additions-vs-corrections)): six
NEW stored templates, no stored card on them — no layout bump, no sweep,
no badge. Not `m15nyx` (4.7, the non-token frame) and not the `nyx`
constellation showcase.

**Which printings** (Scryfall `t:token t:enchantment`, 2026-10-17): seven
wear the dress — on the full-art design TDSK #4 Glimmer (W, textless),
TDSK #10 Horror (B, textless), SLD #1835 Shrine (C, textless), TEOC #13
Golem (C Enchantment Artifact, textless), TSOC #3 Contract (W Aura,
regular box, no P/T), TMDD #8 Spirit Sorcerer (U, regular box); on the
2014–19 arch TC15 #23 Spirit (WB). Every one from September 2024 on but
TC15 #23. The other enchantment tokens (TKHM #1 / TDSK #2 Shard, TNEC,
TCMM #62, TWHO, TPIP #8) print the plain pill; Roles stay unsupported.

**What the prints show** (Scryfall PNGs at 1500 × 2100, the pill's face
rows 118–202, x 130–1370, the name's columns 420–1080 left out): the
starfield is in the NAME PILL only — the type pill, box, rims and strip
are the plain design's (TDSK #2, same set, 0 % specks). The pill keeps its
colour — black 42/38/46, blue 20/85/127, colourless 124/125/124, the
artifact slate 74/80/96 — but the white pill prints a mid SILVER
(166/161/154 and 175/173/164; the plain white pill is near-white,
236/237/238 on our master), dark ink on it. The stars sit where the
starfield inside the title bar of Magic Set Editor's constellation master
(`public/frames/nyx/b.png`) has them (the bright star at x ≈ 205 on every
print).

**Masters** (`scripts/build-token-nyx.mjs`, recipe in
`scripts/lib/token-nyx.mjs`; frames bucket only): PipGlyph's composite
over the PUBLISHED full-art masters — no Card Conjurer file is read:
`m20tokennyx`, `m20tokennyxtext`, `m20tokennyxtall` from `m20token*`,
`m20tokenartifactnyx…` from `m20tokenartifact…`, keys w u b r g c m. The
region is the published crown band's α-0 hole (`m20tokencrown/w`, the
pill's interior) connected to the pill's centre, weighted by the parent's
alpha (full at α ≤ 230, none from 244 — the bevel, rims and outline keep
the parent's pixels); in it `P + offset + 2.7 × (starfield luma − its
median)`, the starfield the MSE bar's luminance at the same pixel (a
neutral layer: the pill keeps its hue), the offset solved per key so the
face's median, read over mid-grey art, is print's (keys with no print — r,
g, m — take no offset). Alpha is never touched; every byte outside the
face is the parent's (the build refuses otherwise); each WebP's alpha
equals its PNG's. After: medians within 1 of print on every printed key.
No pair masters: no two-colour Nyx token is printed, so a two-colour card
on the dress wears gold (`m`).

**Profiles**: the plain full-art profiles with these masters
(`M20_NYX_TOKEN_ANATOMY`: the crown band — its hole shows the starry pill —
and no `twoColorMasters` / `twoColorPlate`); every slot, plate and ink as
the plain twin's (dark name ink on the white key, as TDSK #4 prints).

**Who wears it** (the Nyx pattern, 4.7): an enchantment dress
(`ENCHANTMENT_DRESSES`, `token` bases: each full-art template its dress),
the token kind's alone (`TREATMENT_KINDS`) — the server's kind gate refuses
it on a token whose words don't say Enchantment (`enchantmentFrameFits`).
The height and the Artifact word move between the dresses as between the
plain templates (`m20TokenTemplate(height, artifact, nyx)`,
`tokenHeightFrameFor` / `followTokenHeight` keep the dress,
`TYPE_WORD_DRESSES`: an Enchantment Artifact token wears the slate pill
with the stars, TEOC #13). A NEW token whose words say Enchantment starts
on (or follows onto) the dress where it is verified in the card's colour
(`newTokenFrame`, the form's enchantment effect); "Token" under Variations
is the way back (the plain 2021–23 look); a stored token keeps its frame.
The random and requested AI picks read the same rules
(`resolveGeneratedFrame`). The 2014–19 arch has no dress (TC15 #23, the one
printing).

**Owner Round 74 (2026-10-18)** — the look is approved, and:

- **Only a SINGLE-colour token follows onto the dress** (one colour or
  colourless: `followsTokenNyxDressIn`, the frame colour key w u b r g c).
  Every printed Nyx token is one colour. A two-colour (or three-colour)
  Enchantment token keeps its plain full-art frame with 4.48's split and
  pair crown. That holds for the creator's start (`newTokenFrame`), its
  words follow (`enchantmentFrameFor(…, colorKey)`), a colour picked after
  (the form's colour follow: two colours take a followed token off the
  dress, one colour back onto it — until a frame is picked by hand), and
  the AI's random and requested picks. On a pick under Variations the
  two-colour token wears the dress in GOLD (`m`, no pair masters). An AI
  request that names the dress itself is the same kind of pick. Imports are
  unaffected: the printings are single-colour.
- r, g and m keep their masters (the starfield over the pill's own tone).
- TC15 #23 stays nearest on the arch (`era/2015+nyx-dress`).

**Imports**: `token/m20+nyx-dress` names the dress of the printing's height
through `onceVerified` (the `m20` family's pick; `gapDrawnBy("nyx-dress")`
on the six), exact once it is verified in the card's colour. Until then the
plain full-art template stands in where IT is verified
(`FrameMatch.onceVerifiedFallback`, applied by `withVerification`) —
nearest, the starfield its gap, as before the dress. Run over all 3,037
token and emblem printings, main vs branch, under no ticks, production's
ticks, production's plus the dress and everything verified: 3,031
identical in every policy; on production's ticks all 3,037 identical; the
six M20+ Nyx printings move onto the dress, exact, once it is verified;
with nothing verified they say "not yet verified" (the dress exists)
instead of naming the starfield. TC15 #23 stays `era/2015+nyx-dress`.

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

### The art's zoom and a focal point of exactly 0 (layout v51)

The art is one `<img>`: `object-fit: cover`, `object-position` at the focal
point, then `transform: scale(zoom)` about that same point
(`lib/cards/art-framing.ts` is the arithmetic). Satori 0.25 keeps a
`transform-origin` length or percentage only when it is truthy, so a ZERO on
an axis (`0%`, `0px`) was dropped and that axis fell back to the centre: a
card whose focal point is exactly 0 across — or down — with a zoom other
than 100 % was baked zoomed about the MIDDLE of its window on that axis (the
picture's left or top edge pushed out of sight by (zoom − 1) / 2 of the
window), while the preview, the art positioner and the print render zoom
about the edge. The bake writes the origin through
`satoriTransformOrigin()` (`lib/render/card-image.tsx`): `left` / `top` for
a zero — the spelling Satori reads as 0, and the same origin in a browser —
and the percentage for every other value. Both `<img>` sites use it (the
main window, which a double-faced back body's bake draws too, and the
split's second window); aftermath's turned window is placed in px and never
had the fault. Any new Satori `transform-origin` built from a number goes
through it.

**Rollout.** A CORRECTION: `"sweep"`, no badge, after the owner's before /
after sheet. Card-scoped on any template (`v51Changed`): a face with art, a
zoom ≠ 1 and `focalX` or `focalY` exactly 0, front or back face; every
other card is stamped. Production on 2026-10-09 (anonymous read): 3 public
cards and 1 unlisted, no back face. Verification-neutral.
`tests/unit/render/art-focal-zero-bake.test.tsx` holds real bakes of a coded
picture to the browser's crop.

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
