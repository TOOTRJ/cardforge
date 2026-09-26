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
  bordered pack. Every colourless substitution is noted in the recipe.
- **See-through frames.** CC's colourless M15 frame, every devoid frame and
  the colourless creature token are see-through, like the printed cards. The
  profile's `underFrameArt` draws the art under the whole frame (TODO 4.17);
  the window keeps its exact crop. The colourless token is a PipGlyph
  composite of CC's silver token frame at reduced opacity, because CC's
  bordered token pack has no colourless frame.
- **Output.** 1500×2100 PNGs with rounded transparent corners, WebP
  siblings, P/T plates at native size, and (full-art basics) the 168 px
  mana symbols. The borderless and full-art masters are native 1500×2100
  and copied 1:1 (no resample).
- **Provenance.** Which pack files made each frame is written to
  `lib/cards/frame-sources.json`.
- **Edge contract (TODO 7.7).** Every master is checked against its
  template's declared edges in `lib/frames/edge-contract.ts` (`border`,
  `art` or `bar` per edge) right after the downscale; a violation, or a
  template with no declaration, makes the importer exit non-zero. CI runs
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
