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
family is a layout bump of its own. Rules text is not part of this standard: it keeps the
9 pt ceiling and its fit (the recalibration is TODO 3.29).

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
run the sweep.

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
