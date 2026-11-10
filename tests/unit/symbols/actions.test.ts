import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainCall } from "@/tests/stubs/supabase-chain";
import { cameraPhoto } from "@/tests/stubs/metadata-fixtures";

// ---------------------------------------------------------------------------
// New mana symbols' writes (lib/symbols/actions.ts): the tool gate before
// anything, the upload rules (counted once, sniffed, stripped, scanned BEFORE
// the store, a 256 px PNG under a server-made name in the caller's own
// custom-pips folder), the friendly early refusals that spend no upload, the
// file cleaned up when the row is refused, and "Remove" as the database's
// delete guard decides it — gone for good, or kept as removed.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const SYMBOL_ID = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "http://127.0.0.1:54321";
const pubUrl = (name: string) => `${ORIGIN}/storage/v1/object/public/custom-pips/${USER}/${name}`;
const OLD_FILE = "sym-33333333-3333-4333-8333-333333333333.png";

const state = vi.hoisted(() => ({
  access: true as boolean,
  forgeAccess: true as boolean,
  forgePx: 256,
  limited: false,
  flagged: false,
  checks: 0,
  scans: 0,
  uploads: [] as Array<{ bucket: string; key: string; bytes: Buffer; upsert: unknown }>,
  removes: [] as string[][],
  events: [] as Array<{ event: string; props?: unknown }>,
  rebakes: [] as string[],
  rows: [] as Array<Record<string, unknown>>,
  /** What the next write of each kind answers. */
  insertError: null as null | { message: string; code?: string },
  deleteError: null as null | { message: string; code?: string },
  log: [] as Array<{ table: string; calls: ChainCall[] }>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/symbols/rebake", () => ({
  rebakeCardsNamingSymbol: (ownerId: string, code: string) => {
    state.rebakes.push(`${ownerId}:${code}`);
  },
}));
vi.mock("@/lib/tools/events", () => ({
  recordToolEvent: async (input: { event: string; props?: unknown }) => {
    state.events.push({ event: input.event, props: input.props });
  },
}));
vi.mock("@/lib/tools/queries", () => ({
  checkToolAccess: async (slug: string) => {
    if (slug === "pip-forge") return state.forgeAccess ? { userId: USER, via: "grant" } : null;
    return state.access ? { userId: USER, via: "grant" } : null;
  },
}));
vi.mock("@/lib/media/upload-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/upload-rate-limit")>();
  return {
    ...actual,
    checkUploadRateLimit: async () => {
      state.checks += 1;
      return state.limited
        ? { ok: false, code: actual.UPLOAD_RATE_LIMITED, window: "minute", retryAfterSeconds: 9, message: actual.UPLOAD_TOO_FAST_MESSAGE }
        : { ok: true };
    },
  };
});
vi.mock("@/lib/moderation/image-scan", () => ({
  scanImageBytes: async () => {
    state.scans += 1;
    return { flagged: state.flagged, categories: [] };
  },
}));
vi.mock("@/lib/media/storage-origin", () => ({ ensureStorageOriginRegistered: async () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, bytes: Buffer, opts: { upsert?: unknown }) => {
          state.uploads.push({ bucket, key, bytes, upsert: opts?.upsert });
          return { data: null, error: null };
        },
        remove: async (keys: string[]) => {
          state.removes.push(keys);
          return { data: [], error: null };
        },
        getPublicUrl: (key: string) => ({ data: { publicUrl: `${ORIGIN}/storage/v1/object/public/${bucket}/${key}` } }),
      }),
    },
  }),
}));
vi.mock("@/lib/tools/pip-forge/server", async () => {
  const pngOf = (px: number) =>
    sharp({ create: { width: px, height: px, channels: 4, background: "#336699" } }).png().toBuffer();
  return {
    readOwnPip: async (_u: string, id: string) =>
      id === "44444444-4444-4444-8444-444444444444"
        ? { id, name: "Cipher", files: { pip: "https://x/pip.png", glyph: "https://x/glyph.png" } }
        : null,
    fetchOwnPipFile: async () => new Uint8Array(await pngOf(state.forgePx)),
    decodePng: async (bytes: Uint8Array) => {
      const meta = await sharp(bytes).metadata();
      return { width: meta.width, height: meta.height };
    },
  };
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: SYMBOL_ID,
    code: "ABC",
    name: "Aether",
    mana_value: 2,
    base_color: "U",
    image_url: `${pubUrl(OLD_FILE)}?v=1`,
    source: "upload",
    deleted_at: null,
    created_at: "2026-11-09T00:00:00Z",
    updated_at: "2026-11-09T00:00:00Z",
    ...overrides,
  };
}

vi.mock("@/lib/supabase/server", () => {
  const db = chainClient((table, calls) => {
    if (table !== "custom_symbols") return { data: null, error: null };
    if (called(calls, "insert")) {
      if (state.insertError) return { data: null, error: state.insertError };
      const payload = payloadOf(calls, "insert") as Record<string, unknown>;
      return { data: row({ ...payload, id: SYMBOL_ID }), error: null };
    }
    if (called(calls, "delete")) {
      if (state.deleteError) return { data: null, error: state.deleteError };
      return { data: [{ id: SYMBOL_ID }], error: null };
    }
    if (called(calls, "update")) {
      const payload = payloadOf(calls, "update") as Record<string, unknown>;
      const current = state.rows.find((r) => r.id === SYMBOL_ID) ?? row();
      return { data: { ...current, ...payload }, error: null };
    }
    if (called(calls, "maybeSingle")) {
      return { data: state.rows.find((r) => r.id === SYMBOL_ID) ?? null, error: null };
    }
    return { data: state.rows, error: null };
  });
  state.log = db.log;
  return {
    createClient: async () => ({ from: db.client.from }),
    getCurrentUser: async () => ({ id: USER }),
  };
});

import {
  createSymbolAction,
  createSymbolFromForgedPipAction,
  removeSymbolAction,
  replaceSymbolPictureAction,
  restoreSymbolAction,
  updateSymbolAction,
} from "@/lib/symbols/actions";

async function form(fields: Record<string, string>, withFile = true): Promise<FormData> {
  const fd = new FormData();
  if (withFile) {
    const bytes = await cameraPhoto("jpeg");
    fd.set("file", new File([new Uint8Array(bytes)], "a.jpg", { type: "image/jpeg" }));
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const NEW = { code: "abc", name: "Aether", manaValue: "2", baseColor: "U" };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ORIGIN);
  state.access = true;
  state.forgeAccess = true;
  state.forgePx = 256;
  state.limited = false;
  state.flagged = false;
  state.checks = 0;
  state.scans = 0;
  state.uploads.length = 0;
  state.removes.length = 0;
  state.events.length = 0;
  state.rows = [];
  state.insertError = null;
  state.deleteError = null;
  state.log.length = 0;
  state.rebakes.length = 0;
});

describe("making a symbol", () => {
  it("is refused before anything when the tool isn't open to the viewer", async () => {
    state.access = false;
    const result = await createSymbolAction(await form(NEW));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("isn't open") });
    expect(state.checks).toBe(0);
    expect(state.uploads).toEqual([]);
    expect(state.log).toEqual([]);
  });

  it("stores a 256 px PNG under a server-made name in the caller's folder, then the row", async () => {
    const result = await createSymbolAction(await form({ ...NEW, code: " {*abc} " }));
    expect(result).toMatchObject({ ok: true, symbol: { code: "ABC", manaValue: 2, baseColor: "U" } });
    expect(state.checks).toBe(1);
    expect(state.scans).toBe(1);
    expect(state.uploads).toHaveLength(1);
    const [upload] = state.uploads;
    expect(upload.bucket).toBe("custom-pips");
    expect(upload.key).toMatch(new RegExp(`^${USER}/sym-[0-9a-f-]{36}\\.png$`));
    expect(upload.upsert).toBe(false);
    const meta = await sharp(upload.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 256, 256]);
    expect(meta.exif).toBeUndefined();
    const insert = state.log.find((e) => called(e.calls, "insert"));
    expect(payloadOf(insert!.calls, "insert")).toMatchObject({
      owner_id: USER,
      code: "ABC",
      name: "Aether",
      mana_value: 2,
      base_color: "U",
      source: "upload",
      image_url: expect.stringMatching(new RegExp(`^${ORIGIN}/storage/v1/object/public/custom-pips/${USER}/sym-[0-9a-f-]{36}\\.png\\?v=\\d+$`)),
    });
    expect(state.events).toEqual([{ event: "create", props: { source: "upload", mana_value: 2, coloured: true } }]);
    // A card that named {*ABC} before it existed drew the placeholder: re-baked.
    expect(state.rebakes).toEqual([`${USER}:ABC`]);
  });

  it("strong language in a code or a name is refused on its field, before any upload", async () => {
    const code = await createSymbolAction(await form({ ...NEW, code: "FUCK" }));
    expect(code).toMatchObject({ ok: false, field: "code", error: expect.stringContaining("public") });
    const name = await createSymbolAction(await form({ ...NEW, name: "Shit storm" }));
    expect(name).toMatchObject({ ok: false, field: "name", error: expect.stringContaining("public") });
    const forged = await createSymbolFromForgedPipAction({
      forgedPipId: "44444444-4444-4444-8444-444444444444",
      code: "Q",
      name: "fucking pip",
      manaValue: 1,
      baseColor: "",
    });
    expect(forged).toMatchObject({ ok: false, field: "name" });
    // A mild word is fine (owner policy 2026-10-28).
    expect(await createSymbolAction(await form({ ...NEW, name: "Hell bloom" }))).toMatchObject({ ok: true });
    expect(state.checks).toBe(1);
    expect(state.uploads).toHaveLength(1);
  });

  it("a taken code or a full set is refused before the upload is counted", async () => {
    state.rows = [row({ code: "ABC" })];
    expect(await createSymbolAction(await form(NEW))).toMatchObject({ ok: false, field: "code" });
    state.rows = Array.from({ length: 20 }, (_, i) => row({ id: `r${i}`, code: `C${i}` }));
    expect(await createSymbolAction(await form(NEW))).toMatchObject({ ok: false, error: expect.stringContaining("20 symbols") });
    state.rows = [row({ code: "ABC", deleted_at: "2026-11-01T00:00:00Z" })];
    expect(await createSymbolAction(await form(NEW))).toMatchObject({ ok: false, error: expect.stringContaining("restore") });
    expect(state.checks).toBe(0);
    expect(state.uploads).toEqual([]);
  });

  it("a bad code spends nothing", async () => {
    expect(await createSymbolAction(await form({ ...NEW, code: "1x" }))).toMatchObject({ ok: false, field: "code" });
    expect(state.checks).toBe(0);
  });

  it("over the upload limit: the typed refusal, no bytes read", async () => {
    state.limited = true;
    const result = await createSymbolAction(await form(NEW));
    expect(result).toMatchObject({ ok: false, code: "UPLOAD_RATE_LIMITED", retryAfterSeconds: 9 });
    expect(state.scans).toBe(0);
    expect(state.uploads).toEqual([]);
  });

  it("a flagged picture is never stored", async () => {
    state.flagged = true;
    expect(await createSymbolAction(await form(NEW))).toMatchObject({ ok: false, field: "file" });
    expect(state.uploads).toEqual([]);
  });

  it("not an image: refused, nothing stored", async () => {
    const fd = await form(NEW, false);
    fd.set("file", new File([new Uint8Array([60, 115, 118, 103])], "a.png", { type: "image/png" }));
    expect(await createSymbolAction(fd)).toMatchObject({ ok: false, field: "file" });
    expect(state.uploads).toEqual([]);
  });

  it("a refused row takes its new file with it, in words", async () => {
    state.insertError = { message: "custom_symbol_limit: at most 20 symbols", code: "23514" };
    const result = await createSymbolAction(await form(NEW));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("20 symbols") });
    expect(state.removes).toEqual([[state.uploads[0].key]]);
  });

  it("from a forged pip: needs Pip Forge too, copies its picture", async () => {
    const input = { forgedPipId: "44444444-4444-4444-8444-444444444444", code: "Q", name: "Cipher", manaValue: 1, baseColor: "" };
    state.forgeAccess = false;
    expect(await createSymbolFromForgedPipAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("Pip Forge") });
    expect(state.uploads).toEqual([]);
    state.forgeAccess = true;
    const result = await createSymbolFromForgedPipAction(input);
    expect(result).toMatchObject({ ok: true, symbol: { code: "Q", source: "forge", baseColor: null } });
    expect(state.checks).toBe(1);
    expect(state.uploads[0].key).toMatch(/\/sym-[0-9a-f-]{36}\.png$/);
  });
});

describe("from a forged pip, refused", () => {
  const input = { forgedPipId: "44444444-4444-4444-8444-444444444444", code: "Q", name: "Cipher", manaValue: 1, baseColor: "" };

  it("a file that isn't the forge's 256 px pip is refused, never resized", async () => {
    state.forgePx = 300;
    expect(await createSymbolFromForgedPipAction(input)).toMatchObject({ ok: false, error: expect.stringContaining("couldn't be read") });
    expect(state.uploads).toEqual([]);
  });

  it("a pip that isn't the caller's (readOwnPip finds none) stores nothing", async () => {
    const result = await createSymbolFromForgedPipAction({ ...input, forgedPipId: "55555555-5555-4555-8555-555555555555" });
    expect(result).toMatchObject({ ok: false, error: "That forged pip is gone." });
    expect(state.uploads).toEqual([]);
  });
});

describe("changing a symbol", () => {
  it("an edit writes name and meaning only", async () => {
    state.rows = [row()];
    const result = await updateSymbolAction({ id: SYMBOL_ID, code: "ZZZ", name: "New", manaValue: 3, baseColor: "C" });
    expect(result).toMatchObject({ ok: true, symbol: { code: "ABC", name: "New", manaValue: 3, baseColor: null } });
    const update = state.log.find((e) => called(e.calls, "update"));
    expect(payloadOf(update!.calls, "update")).toEqual({ name: "New", mana_value: 3, base_color: null });
    expect(called(update!.calls, "is", "deleted_at")).toBe(true);
    // A name or a meaning draws nothing new.
    expect(state.rebakes).toEqual([]);
  });

  it("a rename to strong language is refused on the name, nothing written", async () => {
    state.rows = [row()];
    expect(await updateSymbolAction({ id: SYMBOL_ID, name: "Cunt", manaValue: 1, baseColor: "" })).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(state.log.some((e) => called(e.calls, "update"))).toBe(false);
  });

  it("a removed symbol must be restored first", async () => {
    state.rows = [row({ deleted_at: "2026-11-01T00:00:00Z" })];
    expect(await updateSymbolAction({ id: SYMBOL_ID, name: "x", manaValue: 1, baseColor: "" })).toMatchObject({ ok: false });
  });

  it("a new picture is a new file, and the old one goes", async () => {
    state.rows = [row()];
    const result = await replaceSymbolPictureAction(await form({ id: SYMBOL_ID }));
    expect(result).toMatchObject({ ok: true });
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].key).not.toContain(OLD_FILE);
    expect(state.removes).toEqual([[`${USER}/${OLD_FILE}`]]);
    expect(state.rebakes).toEqual([`${USER}:ABC`]);
  });
});

describe("removing a symbol", () => {
  it("one no card names is deleted, its file with it", async () => {
    state.rows = [row()];
    const result = await removeSymbolAction({ id: SYMBOL_ID });
    expect(result).toEqual({ ok: true, outcome: "deleted", symbol: null });
    expect(state.removes).toEqual([[`${USER}/${OLD_FILE}`]]);
  });

  it("one a card names is kept as removed, its file kept", async () => {
    state.rows = [row()];
    state.deleteError = { message: "custom_symbol_in_use: a card still uses {*ABC}", code: "23514" };
    const result = await removeSymbolAction({ id: SYMBOL_ID });
    expect(result).toMatchObject({ ok: true, outcome: "kept", symbol: { deletedAt: expect.any(String) } });
    expect(state.removes).toEqual([]);
    expect(state.events.at(-1)).toEqual({ event: "remove", props: { kept: true, was_removed: false } });
  });

  it("a removed symbol a card still names can't be deleted for good", async () => {
    state.rows = [row({ deleted_at: "2026-11-01T00:00:00Z" })];
    state.deleteError = { message: "custom_symbol_in_use: a card still uses {*ABC}", code: "23514" };
    expect(await removeSymbolAction({ id: SYMBOL_ID })).toMatchObject({ ok: false, error: expect.stringContaining("still uses") });
  });

  it("restore brings it back, under the cap", async () => {
    state.rows = [row({ deleted_at: "2026-11-01T00:00:00Z" })];
    expect(await restoreSymbolAction({ id: SYMBOL_ID })).toMatchObject({ ok: true, symbol: { deletedAt: null } });
  });
});
