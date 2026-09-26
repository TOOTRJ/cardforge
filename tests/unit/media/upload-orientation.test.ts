import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient } from "@/tests/stubs/supabase-chain";
import {
  UPRIGHT_H,
  UPRIGHT_W,
  looksUpright,
  storedAs,
  upright,
  type FixtureFormat,
} from "@/tests/stubs/exif-fixtures";

// ---------------------------------------------------------------------------
// TODO 3.14 — EXIF orientation at UPLOAD. Every human upload path stores
// upright pixels with no orientation tag (same format, so extension and
// Content-Type stay right), and an untagged upload is stored byte-for-byte.
// The render-time half (lib/render/art-source.ts) is pinned in
// tests/unit/render/exif-orientation.test.ts.
// ---------------------------------------------------------------------------

type Upload = { bucket: string; path: string; body: Buffer; contentType?: string };

const state = vi.hoisted(() => ({
  uploads: [] as { bucket: string; path: string; body: unknown; contentType?: string }[],
  generateTextCalls: [] as unknown[],
}));

function storageClient() {
  const db = chainClient(() => ({ data: null, error: null }));
  return {
    from: db.client.from,
    rpc: db.client.rpc,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown, opts: { contentType?: string }) => {
          state.uploads.push({ bucket, path, body, contentType: opts?.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => storageClient(),
  getCurrentUser: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
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

import {
  autoOrientBytes,
  needsAutoOrient,
  normalizeUploadOrientation,
  orientedSize,
  swapsAxes,
} from "@/lib/media/orientation";
import { uploadCardArtServerAction } from "@/lib/cards/upload-art-server";
import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import { uploadCoverServerAction } from "@/lib/media/upload-cover-server";
import { uploadProfileMediaServerAction } from "@/lib/profile/upload-server";
import { saveCustomPipAction } from "@/lib/pips/actions";
import { restyleImage } from "@/lib/ai/image-gen";

const MIME: Record<FixtureFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function form(bytes: Buffer, format: FixtureFormat, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], `photo.${format}`, { type: MIME[format] }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function lastUpload(bucket: string): Upload {
  const hit = [...state.uploads].reverse().find((u) => u.bucket === bucket && !u.path.includes(".pending."));
  expect(hit, `an upload to ${bucket}`).toBeDefined();
  return { ...hit!, body: Buffer.from(hit!.body as Uint8Array) };
}

async function expectUprightUntagged(body: Buffer, format: string) {
  const meta = await sharp(body).metadata();
  expect(meta.format).toBe(format);
  expect(meta.orientation ?? 1).toBe(1);
  expect(await looksUpright(body)).toBe(true);
}

beforeEach(() => {
  state.uploads.length = 0;
  state.generateTextCalls.length = 0;
});

describe("orientation helpers", () => {
  it("only 2–8 need turning; only 5–8 swap the axes", () => {
    expect([undefined, null, 0, 1, 9, 2.5].map((o) => needsAutoOrient(o))).toEqual([false, false, false, false, false, false]);
    expect([2, 3, 4, 5, 6, 7, 8].every((o) => needsAutoOrient(o))).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((o) => swapsAxes(o))).toEqual([false, false, false, false, true, true, true, true]);
  });

  it("orientedSize is the size the browser reports (naturalWidth/naturalHeight)", () => {
    expect(orientedSize({ width: 400, height: 300, orientation: 6 })).toEqual({ width: 300, height: 400 });
    expect(orientedSize({ width: 400, height: 300, orientation: 8 })).toEqual({ width: 300, height: 400 });
    expect(orientedSize({ width: 400, height: 300, orientation: 5 })).toEqual({ width: 300, height: 400 });
    expect(orientedSize({ width: 400, height: 300, orientation: 7 })).toEqual({ width: 300, height: 400 });
    expect(orientedSize({ width: 400, height: 300, orientation: 3 })).toEqual({ width: 400, height: 300 });
    expect(orientedSize({ width: 400, height: 300, orientation: undefined })).toEqual({ width: 400, height: 300 });
    expect(orientedSize({ width: undefined as unknown as number, height: 300 })).toBeNull();
  });
});

describe("normalizeUploadOrientation", () => {
  it.each([2, 3, 4, 5, 6, 7, 8])("orientation %i → upright pixels, no tag, same format (jpeg/png/webp)", async (o) => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const original = await storedAs(o, format);
      const meta = await sharp(original).metadata();
      const { buffer, reoriented } = await normalizeUploadOrientation(original, meta);
      expect(reoriented).toBe(true);
      const out = await sharp(buffer).metadata();
      expect(out.format).toBe(format);
      expect(out.orientation ?? 1).toBe(1);
      // Swapped for 5–8: the stored file is now the size the browser showed.
      expect([out.width, out.height]).toEqual([UPRIGHT_W, UPRIGHT_H]);
      expect(await looksUpright(buffer)).toBe(true);
    }
  });

  it("stores an untagged / orientation-1 upload byte-for-byte (no re-encode)", async () => {
    for (const bytes of [await upright("jpeg"), await upright("png"), await storedAs(1)]) {
      const { buffer, reoriented } = await normalizeUploadOrientation(bytes, await sharp(bytes).metadata());
      expect(reoriented).toBe(false);
      expect(buffer).toBe(bytes);
    }
  });

  it("keeps the original bytes when the upright re-encode would not fit the bucket cap", async () => {
    const bytes = await storedAs(6, "png");
    const { buffer, reoriented } = await normalizeUploadOrientation(bytes, await sharp(bytes).metadata(), { maxBytes: 64 });
    expect(reoriented).toBe(false);
    expect(buffer).toBe(bytes);
  });

  it("leaves animated images alone (the bake still turns their first frame)", async () => {
    const bytes = await storedAs(6, "webp");
    const meta = { ...(await sharp(bytes).metadata()), pages: 3 };
    expect((await normalizeUploadOrientation(bytes, meta)).buffer).toBe(bytes);
  });
});

describe("every upload path stores upright pixels", () => {
  it("card art: an orientation-6 phone JPEG is stored upright, untagged, as image/jpeg", async () => {
    const result = await uploadCardArtServerAction(form(await storedAs(6, "jpeg"), "jpeg"));
    expect(result.ok).toBe(true);
    const up = lastUpload("card-art");
    expect(up.path).toMatch(/\.jpg$/);
    expect(up.contentType).toBe("image/jpeg");
    await expectUprightUntagged(up.body, "jpeg");
  });

  it("card art: an untagged upload is stored byte-for-byte", async () => {
    const bytes = await upright("jpeg");
    expect((await uploadCardArtServerAction(form(bytes, "jpeg"))).ok).toBe(true);
    expect(lastUpload("card-art").body.equals(bytes)).toBe(true);
  });

  it("custom watermark (PNG, orientation 8)", async () => {
    expect((await uploadWatermarkServerAction(form(await storedAs(8, "png"), "png"))).ok).toBe(true);
    await expectUprightUntagged(lastUpload("card-art").body, "png");
  });

  it("deck cover / set icon (JPEG, orientation 3)", async () => {
    expect((await uploadCoverServerAction(form(await storedAs(3, "jpeg"), "jpeg"))).ok).toBe(true);
    await expectUprightUntagged(lastUpload("set-covers").body, "jpeg");
  });

  it("profile avatar (WebP, orientation 6)", async () => {
    expect((await uploadProfileMediaServerAction("avatar", form(await storedAs(6, "webp"), "webp"))).ok).toBe(true);
    await expectUprightUntagged(lastUpload("profile-media").body, "webp");
  });

  it("custom pip (JPEG, orientation 6) — the square crop is taken from the upright photo", async () => {
    const result = await saveCustomPipAction(form(await storedAs(6, "jpeg"), "jpeg", { symbol: "R" }));
    expect(result.ok).toBe(true);
    const up = lastUpload("custom-pips");
    const meta = await sharp(up.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 256, 256]);
    expect(await looksUpright(up.body)).toBe(true);
  });
});

describe("AI remix hands the model the art as the owner sees it", () => {
  it("an orientation-6 source reaches the model upright; an untagged one untouched", async () => {
    await restyleImage({ source: new Uint8Array(await storedAs(6)), sourceContentType: "image/jpeg", prompt: "Oil painting" });
    type Part = { type: string; image?: Uint8Array; mediaType?: string };
    const imagePart = (call: unknown) =>
      (call as { messages: { content: Part[] }[] }).messages[0].content.find((p) => p.type === "image")!;
    const sent = imagePart(state.generateTextCalls[0]);
    expect(await looksUpright(Buffer.from(sent.image!))).toBe(true);
    expect((await sharp(Buffer.from(sent.image!)).metadata()).orientation ?? 1).toBe(1);

    const plain = new Uint8Array(await upright());
    await restyleImage({ source: plain, sourceContentType: "image/jpeg", prompt: "Oil painting" });
    const second = imagePart(state.generateTextCalls[1]);
    expect(second.image).toBe(plain);
    expect(second.mediaType).toBe("image/jpeg");
  });

  it("autoOrientBytes: undecodable input comes back unchanged", async () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(await autoOrientBytes(junk, "image/png")).toEqual({ bytes: junk, contentType: "image/png" });
  });
});
