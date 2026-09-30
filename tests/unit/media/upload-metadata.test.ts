import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient } from "@/tests/stubs/supabase-chain";
import {
  FAKE_OWNER,
  cameraGif,
  cameraPhoto,
  cleanPhoto,
  expectNoCameraMetadata,
  gpsTiff,
  pngChunk,
  withPngChunks,
} from "@/tests/stubs/metadata-fixtures";
import { looksUpright, storedAs } from "@/tests/stubs/exif-fixtures";
import { noisePng } from "@/tests/stubs/noise-png";
import { forgetStaged, resetStaging, stagingBucketApi, uploadCardArtViaStaging } from "@/tests/stubs/card-art-staging";

// ---------------------------------------------------------------------------
// TODO 3.14a — every server path that stores a user's file stores it WITHOUT
// camera metadata (EXIF incl. GPS, XMP, IPTC, PNG text, GIF comments…):
//
//   card art — both faces (ArtUploader → start / staged PUT /
//     finishCardArtUploadAction, TODO 6.10)
//   design watermark + land icon (uploadWatermarkServerAction)
//   deck cover + card set icon (upload-cover → uploadCoverServerAction)
//   avatar + banner (uploadProfileMediaServerAction)
//   custom pip (saveCustomPipAction — a sharp re-encode, pinned here)
//   the AI remix source handed to the model (restyleImage)
//
// …and the lossless path keeps the ICC profile and the exact pixels, while a
// tagged photo (orientation re-encode, TODO 3.14) also ends with no metadata.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  uploads: [] as { bucket: string; path: string; body: unknown; contentType?: string }[],
  generateTextCalls: [] as unknown[],
}));

// The user's cookie-bound client reads and writes rows only; every storage
// write goes through the service role (lib/media/user-storage.ts, 0126).
function dbClient() {
  const db = chainClient(() => ({ data: null, error: null }));
  return { from: db.client.from, rpc: db.client.rpc };
}

function storageClient() {
  return {
    // The upload limit (0127, fail-closed) answers "allowed"; the storage
    // origin registration (lib/media/storage-origin.ts) is a no-op upsert.
    rpc: async () => ({ data: [{ allowed: true, retry_after_seconds: 0, limited_by: null }], error: null }),
    from: () => ({ upsert: async () => ({ error: null }) }),
    storage: {
      from: (bucket: string) => ({
        ...stagingBucketApi(bucket),
        upload: async (path: string, body: unknown, opts: { contentType?: string }) => {
          state.uploads.push({ bucket, path, body, contentType: opts?.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
        remove: async (keys: string[]) => {
          forgetStaged(bucket, keys);
          return { error: null };
        },
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => dbClient(),
  getCurrentUser: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => storageClient(),
  isAdminConfigured: () => true,
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/moderation/image-scan", () => ({
  scanImageUrl: async () => ({ flagged: false, categories: [] }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: vi.fn() }));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("ai", () => ({
  experimental_generateImage: vi.fn(),
  generateText: async (args: unknown) => {
    state.generateTextCalls.push(args);
    return { files: [{ mediaType: "image/png", uint8Array: new Uint8Array([1]) }] };
  },
}));

import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import { uploadCoverServerAction } from "@/lib/media/upload-cover-server";
import { uploadProfileMediaServerAction } from "@/lib/profile/upload-server";
import { saveCustomPipAction } from "@/lib/pips/actions";
import { restyleImage } from "@/lib/ai/image-gen";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;

function form(bytes: Buffer, format: keyof typeof MIME, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], `photo.${format}`, { type: MIME[format] }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function lastUpload(bucket: string) {
  const hit = [...state.uploads].reverse().find((u) => u.bucket === bucket && !u.path.includes(".pending."));
  expect(hit, `an upload to ${bucket}`).toBeDefined();
  return { ...hit!, body: Buffer.from(hit!.body as Uint8Array) };
}

const raw = (bytes: Uint8Array) => sharp(bytes, { animated: true }).raw().toBuffer();

/** Stored losslessly: same pixels, same ICC profile, same format. */
async function expectLossless(original: Buffer, stored: Buffer) {
  expect((await raw(stored)).equals(await raw(original))).toBe(true);
  const [a, b] = [await sharp(original).metadata(), await sharp(stored).metadata()];
  expect(b.format).toBe(a.format);
  if (a.icc) expect(b.icc?.equals(a.icc)).toBe(true);
}

beforeEach(() => {
  state.uploads.length = 0;
  state.generateTextCalls.length = 0;
  resetStaging();
});

/** A card-art upload the way the browser runs it: start → PUT → finish. */
const uploadCardArt = (bytes: Buffer, format: keyof typeof MIME) => uploadCardArtViaStaging(bytes, MIME[format]);

describe("every upload path stores the file without camera metadata", () => {
  it("card art (JPEG with GPS): no EXIF/XMP, same pixels and ICC profile, image/jpeg", async () => {
    const photo = await cameraPhoto("jpeg");
    expect((await uploadCardArt(photo, "jpeg")).ok).toBe(true);
    const up = lastUpload("card-art");
    expect(up.contentType).toBe("image/jpeg");
    expect(up.path).toMatch(/\.jpg$/);
    await expectNoCameraMetadata(up.body);
    expect((await sharp(up.body).metadata()).exif).toBeUndefined();
    await expectLossless(photo, up.body);
  });

  it("card art (a rotated phone JPEG with GPS): the orientation re-encode also ends with no metadata", async () => {
    const photo = await storedAs(6, "jpeg");
    const tagged = await sharp(photo).keepMetadata().withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "0/1 12/1 34/1" } }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">GPSLatitude</x:xmpmeta>').jpeg({ quality: 100 }).toBuffer();
    expect((await sharp(tagged).metadata()).orientation).toBe(6);
    expect((await uploadCardArt(tagged, "jpeg")).ok).toBe(true);
    const up = lastUpload("card-art");
    const meta = await sharp(up.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);
    expect(await looksUpright(up.body)).toBe(true);
    await expectNoCameraMetadata(up.body);
  });

  it("card art (GIF with a comment and XMP)", async () => {
    const gif = await cameraGif();
    expect((await uploadCardArt(gif, "gif")).ok).toBe(true);
    const up = lastUpload("card-art");
    expect(up.contentType).toBe("image/gif");
    await expectNoCameraMetadata(up.body);
    await expectLossless(gif, up.body);
  });

  it("card art (a GIF the container walk refuses — no trailer — is re-encoded, still without metadata)", async () => {
    const gif = await cameraGif({ trailer: false });
    expect((await uploadCardArt(gif, "gif")).ok).toBe(true);
    const up = lastUpload("card-art");
    expect((await sharp(up.body).metadata()).format).toBe("gif");
    await expectNoCameraMetadata(up.body);
    expect(up.body.toString("latin1").includes(FAKE_OWNER)).toBe(false);
  });

  it("card art cut short (a JPEG with no EOI, a PNG with no IEND): still uploads, re-encoded without metadata", async () => {
    // Browsers draw these and uploads stored them as-is before 3.14a; the
    // container walk refuses them, so the fallback re-encode must decode them
    // (leniently) instead of turning them into "not a valid image".
    for (const format of ["jpeg", "png"] as const) {
      const whole = await cameraPhoto(format);
      const cut = whole.subarray(0, whole.length - (format === "jpeg" ? 2 : 12));
      const result = await uploadCardArt(cut, format);
      expect(result, format).toMatchObject({ ok: true });
      const up = lastUpload("card-art");
      const meta = await sharp(up.body).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([format, 96, 64]);
      await expectNoCameraMetadata(up.body);
    }
  });

  it("design watermark / land icon (PNG with a GPS eXIf and text chunks)", async () => {
    const png = withPngChunks(
      await cameraPhoto("png", { alpha: true }),
      pngChunk("tEXt", `Author\0${FAKE_OWNER}`),
    );
    expect((await uploadWatermarkServerAction(form(png, "png"))).ok).toBe(true);
    const up = lastUpload("card-art");
    expect(up.path).toMatch(/\/wm-.*\.png$/);
    await expectNoCameraMetadata(up.body);
    await expectLossless(png, up.body);
  });

  it("design watermark (WebP with EXIF + XMP)", async () => {
    const webp = await cameraPhoto("webp", { alpha: true });
    expect((await uploadWatermarkServerAction(form(webp, "webp"))).ok).toBe(true);
    const up = lastUpload("card-art");
    await expectNoCameraMetadata(up.body);
    await expectLossless(webp, up.body);
  });

  it("deck cover / card set icon (WebP with GPS)", async () => {
    const webp = await cameraPhoto("webp");
    expect((await uploadCoverServerAction(form(webp, "webp"))).ok).toBe(true);
    const up = lastUpload("set-covers");
    await expectNoCameraMetadata(up.body);
    await expectLossless(webp, up.body);
  });

  it("avatar (JPEG with GPS) and banner (PNG with a GPS eXIf)", async () => {
    const jpeg = await cameraPhoto("jpeg");
    expect((await uploadProfileMediaServerAction("avatar", form(jpeg, "jpeg"))).ok).toBe(true);
    const avatar = lastUpload("profile-media");
    await expectNoCameraMetadata(avatar.body);
    await expectLossless(jpeg, avatar.body);

    const png = withPngChunks(await cleanPhoto("png"), pngChunk("eXIf", await gpsTiff()));
    expect((await uploadProfileMediaServerAction("banner", form(png, "png"))).ok).toBe(true);
    const banner = lastUpload("profile-media");
    expect(banner.path).toMatch(/\/banner-/);
    await expectNoCameraMetadata(banner.body);
    await expectLossless(png, banner.body);
  });

  it("custom pip (JPEG with GPS) — its sharp re-encode writes no metadata either", async () => {
    expect((await saveCustomPipAction(form(await cameraPhoto("jpeg"), "jpeg", { symbol: "G" }))).ok).toBe(true);
    const up = lastUpload("custom-pips");
    const meta = await sharp(up.body).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif, meta.icc]).toEqual(["png", 256, 256, undefined, undefined]);
    await expectNoCameraMetadata(up.body);
  });

  it("a clean upload is still stored byte-for-byte", async () => {
    const clean = await cleanPhoto("webp");
    expect((await uploadCoverServerAction(form(clean, "webp"))).ok).toBe(true);
    expect(lastUpload("set-covers").body.equals(clean)).toBe(true);
  });
});

describe("prepareUploadBytes", () => {
  it("keeps the orientation of a tagged file whose upright re-encode would overflow the cap — and nothing else", async () => {
    const photo = await cameraPhoto("jpeg", { orientation: 6 });
    // No re-encode fits 64 bytes: normalizeUploadOrientation keeps the
    // original, and the strip must then keep its Orientation (or the creator
    // would show it sideways) while dropping the GPS, camera and XMP.
    const tight = await prepareUploadBytes(photo, await sharp(photo).metadata(), { maxBytes: 64 });
    expect((await sharp(tight).metadata()).orientation).toBe(6);
    await expectNoCameraMetadata(tight);
    await expectLossless(photo, tight);
  });
});

describe("the AI remix source reaches the model without camera metadata", () => {
  type Part = { type: string; image?: Uint8Array; mediaType?: string };
  const sentImage = (call: unknown) =>
    (call as { messages: { content: Part[] }[] }).messages[0].content.find((p) => p.type === "image")!;

  it("a stored JPEG with GPS (uploaded before 3.14a) is sent stripped, same pixels, same type", async () => {
    const photo = await cameraPhoto("jpeg");
    await restyleImage({ source: new Uint8Array(photo), sourceContentType: "image/jpeg", prompt: "Oil painting" });
    const sent = sentImage(state.generateTextCalls[0]);
    expect(sent.mediaType).toBe("image/jpeg");
    await expectNoCameraMetadata(sent.image!);
    await expectLossless(photo, Buffer.from(sent.image!));
  });

  it("a print-size source over 8 MiB (card art may be 20 MiB, TODO 6.10) goes as a 2048 px copy — Gemini takes ≤ 20 MB inline", async () => {
    // A 2000×2800 noise PNG (~16 MiB): print-size art at its most incompressible.
    const big = await noisePng(2000, 2800);
    expect(big.byteLength).toBeGreaterThan(8 * 1024 * 1024);
    await restyleImage({ source: new Uint8Array(big), sourceContentType: "image/png", prompt: "Oil painting" });
    const sent = sentImage(state.generateTextCalls[0]);
    expect(sent.mediaType).toBe("image/jpeg");
    const meta = await sharp(sent.image!).metadata();
    expect([meta.width, meta.height]).toEqual([1463, 2048]);
    expect(sent.image!.byteLength).toBeLessThan(8 * 1024 * 1024);
  });
});
