import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { cameraPhoto, expectNoCameraMetadata } from "@/tests/stubs/metadata-fixtures";

// ---------------------------------------------------------------------------
// Migration 0126 took every user write policy off storage.objects: a signed-in
// user can no longer write their folder straight from the Supabase client,
// around the upload actions' byte sniff, metadata strip (TODO 3.14a) and
// NSFW scan. The actions now write with the SERVICE ROLE, so each one must:
//
//   * refuse a signed-out caller before touching storage;
//   * put the object in the CALLER's folder under a name the server made up
//     — never a name, path or owner id from the request;
//   * strip (prepareUploadBytes) before the write and scan after it, and
//     remove a flagged object from that same folder;
//   * never hand storage to the user's cookie client (its `.storage` throws
//     here, so a regression fails loudly);
//   * say so plainly when the service role isn't configured.
//
// …and the "Remove" flows (replaced / default avatar, deleted pip) only ever
// delete the caller's own objects — a profile URL pointing into ANOTHER
// user's folder is left alone by the service role.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

type Op = { bucket: string; op: "upload" | "remove"; keys: string[]; body?: Buffer };

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  adminConfigured: true,
  flagged: false,
  scans: [] as string[],
  ops: [] as Op[],
  /** Storage ops and row writes, in the order they happened. */
  seq: [] as string[],
  adminClients: 0,
  profileRow: {} as Record<string, string | null>,
  profileUpdateError: null as null | { message: string },
}));

function cookieClient() {
  const db = chainClient((table, calls): ChainAnswer => {
    for (const write of ["update", "upsert", "insert", "delete"]) {
      if (called(calls, write)) {
        state.seq.push(`db:${table}:${write}`);
        if (table === "profiles" && write === "update") return { error: state.profileUpdateError };
        return { error: null };
      }
    }
    if (table === "profiles") return { data: state.profileRow };
    return { data: null };
  });
  const client = { from: db.client.from, rpc: db.client.rpc };
  Object.defineProperty(client, "storage", {
    get() {
      throw new Error("the user's cookie client must never touch storage (migration 0126)");
    },
  });
  return client;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => cookieClient(),
  getCurrentUser: async () => state.user,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.adminConfigured,
  createAdminClient: () => {
    state.adminClients += 1;
    return {
      // The upload limit (0127, fail-closed) answers "allowed"; the storage
      // origin registration (lib/media/storage-origin.ts) is a no-op upsert.
      rpc: async () => ({ data: [{ allowed: true, retry_after_seconds: 0, limited_by: null }], error: null }),
      from: () => ({ upsert: async () => ({ error: null }) }),
      storage: {
        from: (bucket: string) => ({
          upload: async (key: string, body: Uint8Array | ArrayBuffer) => {
            state.ops.push({ bucket, op: "upload", keys: [key], body: Buffer.from(body as Uint8Array) });
            state.seq.push(`upload:${bucket}:${key}`);
            return { data: null, error: null };
          },
          remove: async (keys: string[]) => {
            state.ops.push({ bucket, op: "remove", keys });
            state.seq.push(`remove:${bucket}:${keys.join(",")}`);
            return { data: [], error: null };
          },
          getPublicUrl: (key: string) => ({
            data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${key}` },
          }),
        }),
      },
    };
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/moderation/image-scan", () => ({
  scanImageUrl: async (url: string) => {
    state.scans.push(url);
    return { flagged: state.flagged, categories: [] };
  },
}));
vi.mock("@/lib/media/upload-bytes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/upload-bytes")>();
  return { ...actual, prepareUploadBytes: vi.fn(actual.prepareUploadBytes) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: vi.fn() }));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));

import { uploadCardArtServerAction } from "@/lib/cards/upload-art-server";
import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import { uploadCoverServerAction } from "@/lib/media/upload-cover-server";
import {
  chooseDefaultProfileMediaAction,
  uploadProfileMediaServerAction,
} from "@/lib/profile/upload-server";
import { deleteCustomPipAction, saveCustomPipAction } from "@/lib/pips/actions";
import { persistGeneratedArt } from "@/lib/ai/random-art";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";

const publicUrl = (bucket: string, key: string) =>
  `https://project.supabase.co/storage/v1/object/public/${bucket}/${key}`;

/** A form a hostile client might post: a traversal file name plus fields
 *  naming someone else's folder. None of it may reach the object key. */
function hostileForm(bytes: Buffer, type: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], `../../${OTHER}/evil.png`, { type }));
  fd.set("path", `${OTHER}/evil.png`);
  fd.set("userId", OTHER);
  fd.set("owner_id", OTHER);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

type Case = {
  label: string;
  bucket: string;
  /** The stored object's name inside the caller's folder. */
  name: RegExp;
  /** Runs through prepareUploadBytes (the pip is a sharp re-encode instead). */
  stripped: boolean;
  file: () => Promise<{ bytes: Buffer; type: string }>;
  run: (fd: FormData) => Promise<{ ok: boolean }>;
  extra?: Record<string, string>;
  /** The pip scans a staged `.pending.png` before writing the real object. */
  scannedName?: RegExp;
};

const jpeg = async () => ({ bytes: await cameraPhoto("jpeg"), type: "image/jpeg" });
const png = async () => ({ bytes: await cameraPhoto("png", { alpha: true }), type: "image/png" });

const CASES: Case[] = [
  { label: "card art", bucket: "card-art", name: new RegExp(`^${UUID}\\.jpg$`), stripped: true, file: jpeg, run: uploadCardArtServerAction },
  { label: "design watermark / land icon", bucket: "card-art", name: new RegExp(`^wm-${UUID}\\.png$`), stripped: true, file: png, run: uploadWatermarkServerAction },
  { label: "deck cover / card set icon", bucket: "set-covers", name: new RegExp(`^${UUID}\\.jpg$`), stripped: true, file: jpeg, run: uploadCoverServerAction },
  { label: "avatar", bucket: "profile-media", name: new RegExp(`^avatar-${UUID}\\.jpg$`), stripped: true, file: jpeg, run: (fd) => uploadProfileMediaServerAction("avatar", fd) },
  { label: "banner", bucket: "profile-media", name: new RegExp(`^banner-${UUID}\\.jpg$`), stripped: true, file: jpeg, run: (fd) => uploadProfileMediaServerAction("banner", fd) },
  {
    label: "custom pip",
    bucket: "custom-pips",
    name: /^G\.png$/,
    stripped: false,
    file: jpeg,
    run: saveCustomPipAction,
    extra: { symbol: "G" },
    scannedName: /^G\.pending\.png$/,
  },
];

const uploads = (bucket: string) => state.ops.filter((o) => o.bucket === bucket && o.op === "upload");
const removes = () => state.ops.filter((o) => o.op === "remove");

beforeEach(() => {
  state.user = { id: USER };
  state.adminConfigured = true;
  state.flagged = false;
  state.scans.length = 0;
  state.ops.length = 0;
  state.seq.length = 0;
  state.adminClients = 0;
  state.profileRow = {};
  state.profileUpdateError = null;
  vi.mocked(prepareUploadBytes).mockClear();
});

describe.each(CASES)("$label upload", (c) => {
  it("refuses a signed-out caller before any storage call", async () => {
    state.user = null;
    const { bytes, type } = await c.file();
    const result = await c.run(hostileForm(bytes, type, c.extra));
    expect(result.ok).toBe(false);
    expect(state.ops).toEqual([]);
    expect(state.adminClients).toBe(0);
  });

  it("writes the caller's own folder with the service role — stripped, then scanned", async () => {
    const { bytes, type } = await c.file();
    const result = await c.run(hostileForm(bytes, type, c.extra));
    expect(result).toMatchObject({ ok: true });

    // Every key the action touched is in the caller's folder, under a name
    // the server chose — the file name, `path`, `userId`, `owner_id` fields
    // of the request never reach it.
    const keys = state.ops.flatMap((o) => o.keys);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith(`${USER}/`), key).toBe(true);
      expect(key.split("/")).toHaveLength(2);
      expect(key).not.toContain(OTHER);
      expect(key).not.toContain("evil");
    }
    const stored = uploads(c.bucket).at(-1)!;
    expect(stored.keys[0].slice(USER.length + 1)).toMatch(c.name);
    expect(state.ops.every((o) => o.bucket === c.bucket)).toBe(true);

    // Stripped before the write…
    if (c.stripped) expect(prepareUploadBytes).toHaveBeenCalledTimes(1);
    await expectNoCameraMetadata(stored.body!);
    // …and the scan saw the object that was written.
    const scannedKey = c.scannedName
      ? uploads(c.bucket).find((u) => c.scannedName!.test(u.keys[0].slice(USER.length + 1)))!.keys[0]
      : stored.keys[0];
    expect(state.scans).toHaveLength(1);
    expect(state.scans[0].split("?")[0]).toBe(publicUrl(c.bucket, scannedKey));
  });

  it("a flagged image is removed from that same folder, and the upload is refused", async () => {
    state.flagged = true;
    const { bytes, type } = await c.file();
    const result = await c.run(hostileForm(bytes, type, c.extra));
    expect(result.ok).toBe(false);
    const [scanned] = uploads(c.bucket);
    expect(uploads(c.bucket)).toHaveLength(1); // never a second (canonical) write
    expect(removes()).toEqual([{ bucket: c.bucket, op: "remove", keys: scanned.keys }]);
  });

  it("without service-role storage it answers plainly and writes nothing", async () => {
    state.adminConfigured = false;
    const { bytes, type } = await c.file();
    const result = await c.run(hostileForm(bytes, type, c.extra));
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(state.ops).toEqual([]);
    expect(state.adminClients).toBe(0);
  });
});

describe("a pip's staged copy never outlives the upload", () => {
  it("writes pending → scans it → writes the real object → drops the pending one", async () => {
    const { bytes, type } = await jpeg();
    expect(await saveCustomPipAction(hostileForm(bytes, type, { symbol: "W" }))).toMatchObject({ ok: true });
    expect(state.seq).toEqual([
      `upload:custom-pips:${USER}/W.pending.png`,
      `upload:custom-pips:${USER}/W.png`,
      `remove:custom-pips:${USER}/W.pending.png`,
      "db:custom_pips:upsert",
    ]);
  });
});

describe("profile media: only the caller's own old object is ever deleted", () => {
  const own = (name: string) => publicUrl("profile-media", `${USER}/${name}`);

  it("a replaced avatar is removed from the caller's folder — after the profile points at the new one", async () => {
    state.profileRow = { avatar_url: own("avatar-old.png") };
    const { bytes, type } = await jpeg();
    expect(await uploadProfileMediaServerAction("avatar", hostileForm(bytes, type))).toMatchObject({ ok: true });
    const newKey = uploads("profile-media")[0].keys[0];
    expect(state.seq).toEqual([
      `upload:profile-media:${newKey}`,
      "db:profiles:update",
      `remove:profile-media:${USER}/avatar-old.png`,
    ]);
  });

  it("an avatar_url pointing into ANOTHER user's folder is never deleted", async () => {
    state.profileRow = { avatar_url: publicUrl("profile-media", `${OTHER}/avatar-theirs.png`) };
    const { bytes, type } = await jpeg();
    expect(await uploadProfileMediaServerAction("avatar", hostileForm(bytes, type))).toMatchObject({ ok: true });
    expect(removes()).toEqual([]);
  });

  it("a failed profile update removes the new object and keeps the old one", async () => {
    state.profileRow = { avatar_url: own("avatar-old.png") };
    state.profileUpdateError = { message: "nope" };
    const { bytes, type } = await jpeg();
    expect((await uploadProfileMediaServerAction("avatar", hostileForm(bytes, type))).ok).toBe(false);
    const newKey = uploads("profile-media")[0].keys[0];
    expect(removes()).toEqual([{ bucket: "profile-media", op: "remove", keys: [newKey] }]);
  });

  it("an unknown kind never names a stored file", async () => {
    const { bytes, type } = await jpeg();
    const result = await uploadProfileMediaServerAction("../x" as "avatar", hostileForm(bytes, type));
    expect(result.ok).toBe(false);
    expect(state.ops).toEqual([]);
  });

  it("choosing a built-in image deletes the uploaded one only once the row has moved off it", async () => {
    state.profileRow = { avatar_url: own("avatar-old.png") };
    const result = await chooseDefaultProfileMediaAction("avatar", "/defaults/avatars/avatar-01.webp");
    expect(result).toMatchObject({ ok: true });
    expect(state.seq).toEqual(["db:profiles:update", `remove:profile-media:${USER}/avatar-old.png`]);
  });

  it("…a failed update deletes nothing, and another user's object is never touched", async () => {
    state.profileRow = { avatar_url: own("avatar-old.png") };
    state.profileUpdateError = { message: "nope" };
    expect((await chooseDefaultProfileMediaAction("avatar", "/defaults/avatars/avatar-01.webp")).ok).toBe(false);
    expect(removes()).toEqual([]);

    state.profileUpdateError = null;
    state.profileRow = { avatar_url: publicUrl("profile-media", `${OTHER}/avatar-theirs.png`) };
    expect((await chooseDefaultProfileMediaAction("avatar", "/defaults/avatars/avatar-01.webp")).ok).toBe(true);
    expect(removes()).toEqual([]);
  });
});

describe("deleting a custom pip", () => {
  it("removes the caller's own object with the service role, after the row", async () => {
    expect(await deleteCustomPipAction("W")).toMatchObject({ ok: true });
    expect(state.seq).toEqual(["db:custom_pips:delete", `remove:custom-pips:${USER}/W.png`]);
  });

  it("refuses a signed-out caller and an unknown symbol without touching storage", async () => {
    expect((await deleteCustomPipAction("../W")).ok).toBe(false);
    state.user = null;
    expect((await deleteCustomPipAction("W")).ok).toBe(false);
    expect(state.ops).toEqual([]);
  });
});

describe("AI art lands in the caller's card-art folder", () => {
  it("under a server-made ai-* name, through the service role", async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#123" } }).jpeg().toBuffer();
    const result = await persistGeneratedArt(new Uint8Array(bytes), "image/jpeg");
    expect(result).toMatchObject({ ok: true });
    const [stored] = uploads("card-art");
    expect(stored.keys[0]).toMatch(new RegExp(`^${USER}/ai-${UUID}\\.jpg$`));
    expect(result.ok && result.publicUrl).toBe(publicUrl("card-art", stored.keys[0]));
  });

  it("refuses a signed-out caller", async () => {
    state.user = null;
    expect((await persistGeneratedArt(new Uint8Array([1]), "image/png")).ok).toBe(false);
    expect(state.ops).toEqual([]);
  });
});
