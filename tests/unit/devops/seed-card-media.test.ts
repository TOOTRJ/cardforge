import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extensionOf, rehostCardMedia } from "@/scripts/lib/seed-card-media.mjs";

// ---------------------------------------------------------------------------
// `npm run seed:dev -- --copy-cards-from` copies a production user's public
// cards into a dev database. Every picture a card DRAWS must be re-hosted in
// the target's storage (review 2026-09-29): only art_url was, so a copied
// card's custom watermark, set icon and second-face art still pointed at
// production — dropped from every dev preview and bake (the display draws
// only the deployment's own storage), and a remix of it failed to save.
// ---------------------------------------------------------------------------

const PROD = "https://auth.pipglyph.com/storage/v1/object/public";
const DEV = "https://dev.supabase.co/storage/v1/object/public";
const OWNER = "d0000000-0000-4000-a000-000000000001";
const CARD = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

function fakeRehost(fail: string[] = []) {
  const calls: { from: string; bucket: string; path: string }[] = [];
  const rehost = async (from: string, bucket: string, path: string) => {
    calls.push({ from, bucket, path });
    return fail.some((f) => from.includes(f)) ? null : `${DEV}/${bucket}/${path}`;
  };
  return { calls, rehost };
}

const source = {
  id: CARD,
  art_url: `${PROD}/card-art/prod-owner/front.jpg`,
  set_icon_url: `${PROD}/set-covers/prod-owner/icon.png`,
  watermark: { kind: "custom", url: `${PROD}/card-art/prod-owner/wm-1.webp`, opacity: 0.4 },
  back_face: { title: "Back", art_url: `${PROD}/card-art/prod-owner/back.jpeg` },
};

describe("rehostCardMedia", () => {
  it("re-hosts art, set icon, custom watermark and second-face art into the new owner's folder", async () => {
    const { calls, rehost } = fakeRehost();
    const out = await rehostCardMedia(source, OWNER, rehost);
    expect(calls).toEqual([
      { from: source.art_url, bucket: "card-art", path: `${OWNER}/${CARD}.jpg` },
      { from: source.set_icon_url, bucket: "set-covers", path: `${OWNER}/icon-${CARD}.png` },
      { from: source.watermark.url, bucket: "card-art", path: `${OWNER}/wm-${CARD}.webp` },
      { from: source.back_face.art_url, bucket: "card-art", path: `${OWNER}/back-${CARD}.jpeg` },
    ]);
    expect(out).toEqual({
      art_url: `${DEV}/card-art/${OWNER}/${CARD}.jpg`,
      set_icon_url: `${DEV}/set-covers/${OWNER}/icon-${CARD}.png`,
      watermark: { kind: "custom", url: `${DEV}/card-art/${OWNER}/wm-${CARD}.webp`, opacity: 0.4 },
      back_face: { title: "Back", art_url: `${DEV}/card-art/${OWNER}/back-${CARD}.jpeg` },
    });
    // Nothing is left pointing at production.
    expect(JSON.stringify(out)).not.toContain("auth.pipglyph.com");
  });

  it("drops a picture it couldn't copy instead of leaving a production link", async () => {
    const { rehost } = fakeRehost(["wm-1", "back.jpeg", "icon.png", "front.jpg"]);
    expect(await rehostCardMedia(source, OWNER, rehost)).toEqual({
      art_url: null,
      set_icon_url: null,
      watermark: null,
      back_face: { title: "Back" },
    });
  });

  it("keeps built-in images and preset watermarks as they are, and copies nothing for empty fields", async () => {
    const { calls, rehost } = fakeRehost();
    const out = await rehostCardMedia(
      {
        id: CARD,
        art_url: "/defaults/banners/banner-03.webp",
        set_icon_url: null,
        watermark: { kind: "preset", key: "rose" },
        back_face: { title: "Back", art_url: "https://pipglyph.com/defaults/avatars/avatar-07.webp" },
      },
      OWNER,
      rehost,
    );
    expect(calls).toEqual([]);
    expect(out).toEqual({
      art_url: "/defaults/banners/banner-03.webp",
      set_icon_url: null,
      watermark: { kind: "preset", key: "rose" },
      back_face: { title: "Back", art_url: "https://pipglyph.com/defaults/avatars/avatar-07.webp" },
    });
  });

  it("extensionOf reads the path, not the query", () => {
    expect(extensionOf(`${PROD}/card-art/x/a.PNG?v=3`, "webp")).toBe("png");
    expect(extensionOf(`${PROD}/card-art/x/noext`, "webp")).toBe("webp");
    expect(extensionOf("/defaults/banners/banner-03.webp", "png")).toBe("webp");
  });

  it("scripts/seed-dev.mjs re-hosts through it and registers the target's storage origin", () => {
    const script = readFileSync(join(process.cwd(), "scripts/seed-dev.mjs"), "utf8");
    expect(script).toContain("Object.assign(row, await rehostCardMedia(source, DEV_ADMIN_ID, rehost));");
    expect(script).toMatch(/from\("storage_origins"\)\s*\.upsert\(\{ origin,/);
  });
});
