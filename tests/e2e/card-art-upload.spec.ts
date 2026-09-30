import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { e2eCredentials, signIn } from "./helpers/sign-in";
import { noisePng } from "../stubs/noise-png";

// ---------------------------------------------------------------------------
// TODO 6.10 — print-quality card art uploads. A 2000×2800 lossless PNG is
// 8–15 MiB: over the old 8 MB cap, and far over what a Vercel Function takes
// as a request body (4.5 MB), so the creator no longer posts the file to a
// server action. It PUTs it to a signed URL in the PRIVATE staging bucket
// (card-art-incoming, migration 0131), and the finish action sniffs, strips,
// scans and stores it in card-art (lib/cards/upload-art-server.ts).
//
// This runs that whole path in the real creator against the local stack (CI
// boots one with every migration): an ~11 MiB PNG lands in card-art, pixel
// for pixel, and the staged copy is consumed. With no OPENAI_API_KEY in the e2e
// env the moderation scan is a pass-through.
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const hasStack = Boolean(e2eCredentials() && url && serviceKey) && /127\.0\.0\.1|localhost/.test(url);

test.describe("card art upload (TODO 6.10)", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  test("an ~11 MiB lossless PNG uploads through the staging bucket and is stored as sent", async ({ page }) => {
    test.setTimeout(120_000);
    // Incompressible, so its size is its pixels: 1600×2400×3 ≈ 11 MiB.
    const art = await noisePng(1600, 2400);
    expect(art.byteLength).toBeGreaterThan(8 * 1024 * 1024);

    await signIn(page);
    await page.goto("/create");
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^identity$/i }).click();
    await expect(page.getByText(/up to 20 MB/).first()).toBeVisible();

    await page
      .locator('input[aria-label="Upload card art"]')
      .setInputFiles({ name: "print-art.png", mimeType: "image/png", buffer: art });
    await expect(page.getByText("Artwork uploaded.")).toBeVisible({ timeout: 60_000 });

    // The preview now shows the stored object: card-art/{user}/{uuid}.png.
    const src = await page.getByAltText("Card artwork preview").getAttribute("src");
    const match = /\/storage\/v1\/object\/public\/card-art\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.png)$/.exec(src ?? "");
    expect(match, `stored art URL: ${src}`).not.toBeNull();
    const [, userId, name] = match!;

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    try {
      // Stored as sent: a clean PNG goes through the metadata strip untouched.
      const stored = await admin.storage.from("card-art").download(`${userId}/${name}`);
      expect(stored.error).toBeNull();
      const bytes = Buffer.from(await stored.data!.arrayBuffer());
      expect(bytes.byteLength).toBe(art.byteLength);
      expect(bytes.equals(art)).toBe(true);
      expect((await sharp(bytes).metadata()).width).toBe(1600);

      // The staged file's bytes never outlive the finish call: its key holds
      // the 8-byte tombstone (so the signed URL can't put it again) until
      // the user's next start clears it.
      const { data: left } = await admin.storage.from("card-art-incoming").list(userId, { limit: 100 });
      const withBytes = (left ?? []).filter(
        (o) => o.name.endsWith(".upload") && Number((o.metadata as { size?: number } | null)?.size ?? 0) > 8,
      );
      expect(withBytes).toEqual([]);
    } finally {
      await admin.storage.from("card-art").remove([`${userId}/${name}`]);
    }
  });

  test("a file over 20 MB is refused in the browser, before any upload", async ({ page }) => {
    await signIn(page);
    await page.goto("/create");
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^identity$/i }).click();
    let staged = false;
    page.on("request", (req) => {
      if (req.url().includes("/object/upload/sign/")) staged = true;
    });
    await page
      .locator('input[aria-label="Upload card art"]')
      .setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
    await expect(page.getByText("That image is over 20 MB. Pick a smaller file.")).toBeVisible();
    expect(staged).toBe(false);
  });
});
