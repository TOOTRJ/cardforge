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
(`lib/render/card-frames.ts`). The bake also checks every bucket download
against the manifest hash and keeps a size-bounded LRU cache.

### Which bucket an environment reads

`NEXT_PUBLIC_FRAME_ORIGIN` if it is set. Otherwise the `frames` bucket of the
environment's own Supabase project, taken from `NEXT_PUBLIC_SUPABASE_URL`.

| Environment | Reads | Why |
|---|---|---|
| Production | production's bucket | derived from its Supabase URL |
| Local `npm run dev`, Vercel previews on the dev DB | the dev bucket | derived |
| Vercel previews with a per-PR Supabase branch | the dev bucket | **Preview-scoped `NEXT_PUBLIC_FRAME_ORIGIN`** (owner step below); a branch's own bucket is empty |
| CI e2e (local Docker stack) | the dev bucket | `.env.e2e` in `.github/workflows/ci.yml` |

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
4. **Owner:** copy the objects to production before merging. It is a plan
   first, then the copy:

   ```bash
   FRAMES_PROD_SECRET_KEY=sb_secret_… npm run frames:promote
   ```

   ```bash
   FRAMES_PROD_SECRET_KEY=sb_secret_… CONFIRM=yes npm run frames:promote
   ```

   The key is production's secret key from the Supabase dashboard. It is
   typed in the shell and never saved to `.env.local`. Every object is
   re-hashed against the manifest before upload.
5. CI's **Frames published** check (`npm run frames:check`) turns green once
   production serves every manifest object. Then merge.

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
- Optional: make **Frames published** a required status check on `main`.
