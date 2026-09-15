// ---------------------------------------------------------------------------
// One-off: write the 600 px WebP thumbnail beside every existing baked render
// WITHOUT re-baking (the thumb is a pure downscale of the stored PNG, so the
// card's look does not change — no layout-version or owner decision involved).
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=... \
//     node scripts/backfill-render-thumbs.mjs
//
//   DRY_RUN=1   list what would be done, write nothing
//   LIMIT=N     stop after N cards (default: all)
//
// Idempotent: cards that already have rendered_thumb_url are skipped, and the
// thumb object is upserted. Safe to re-run after a partial failure.
// ---------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DRY = process.env.DRY_RUN === "1";
const LIMIT = Number(process.env.LIMIT ?? "0") || Infinity;
if (!SUPABASE_URL || !SECRET) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

// Mirrors lib/cards/render-thumb.ts (ESM script — can't import the TS module).
const WIDTH = 600;
const QUALITY = 78;
const thumbPathFor = (renderPath) => renderPath.replace(/\.png$/, "") + ".thumb.webp";

let done = 0;
let failed = 0;
let skipped = 0;
for (let from = 0; ; from += 500) {
  const { data: rows, error } = await supabase
    .from("cards")
    .select("id, owner_id, rendered_image_url, rendered_thumb_url")
    .not("rendered_image_url", "is", null)
    .is("rendered_thumb_url", null)
    .order("id", { ascending: true })
    .range(from, from + 499);
  if (error) {
    console.error(`Page read failed: ${error.message}`);
    process.exit(1);
  }
  for (const row of rows ?? []) {
    if (done + failed >= LIMIT) break;
    const path = `${row.owner_id}/${row.id}.png`;
    const thumbPath = thumbPathFor(path);
    if (DRY) {
      console.log(`would thumb ${row.id}`);
      skipped += 1;
      continue;
    }
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from("card-renders").download(path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "download failed");
      const png = Buffer.from(await blob.arrayBuffer());
      const webp = await sharp(png).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
      const { error: upErr } = await supabase.storage
        .from("card-renders")
        .upload(thumbPath, webp, { cacheControl: "31536000", contentType: "image/webp", upsert: true });
      if (upErr) throw new Error(upErr.message);
      // Keep the PNG's ?v= stamp so both URLs bust together on the next bake.
      const version = new URL(row.rendered_image_url).searchParams.get("v") ?? String(Date.now());
      const url = `${supabase.storage.from("card-renders").getPublicUrl(thumbPath).data.publicUrl}?v=${version}`;
      const { error: rowErr } = await supabase.from("cards").update({ rendered_thumb_url: url }).eq("id", row.id);
      if (rowErr) throw new Error(rowErr.message);
      done += 1;
      if (done % 25 === 0) console.log(`…${done} thumbs written`);
    } catch (err) {
      failed += 1;
      console.warn(`✗ ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if ((rows?.length ?? 0) < 500 || done + failed >= LIMIT) break;
  // The filter excludes rows we just updated, so always re-read from 0.
  if (!DRY) from = -500;
}
console.log(`Done. ${done} thumbs written, ${failed} failed${DRY ? `, ${skipped} would be written (dry run)` : ""}.`);
