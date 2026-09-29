import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cameraPhoto } from "@/tests/stubs/metadata-fixtures";

// ---------------------------------------------------------------------------
// Every upload is rate-limited per user (owner decision 2026-09-29, TODO
// 3.14b): each action that stores a user's file calls checkUploadRateLimit()
// right after its auth check — before the bytes are sniffed, stripped,
// scanned or written — and a refusal comes back as the action's usual
// `{ ok: false, error }` plus `code: "UPLOAD_RATE_LIMITED"` and the wait
// (the route: a 429 with Retry-After). This runs each one with the limiter
// saying no, and keeps the list of storage writers closed at the source
// level: a new upload path must count too.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  limited: false,
  checks: [] as string[],
  storageOps: 0,
  sniffs: 0,
  scans: 0,
}));

vi.mock("@/lib/media/upload-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/upload-rate-limit")>();
  return {
    ...actual,
    checkUploadRateLimit: async (userId: string) => {
      state.checks.push(userId);
      return state.limited
        ? {
            ok: false,
            code: actual.UPLOAD_RATE_LIMITED,
            window: "minute",
            retryAfterSeconds: 17,
            message: actual.UPLOAD_TOO_FAST_MESSAGE,
          }
        : { ok: true };
    },
  };
});
vi.mock("@/lib/supabase/server", async () => {
  const { chainClient } = await import("@/tests/stubs/supabase-chain");
  const db = chainClient(() => {
    if (state.limited) throw new Error("no row work expected while rate-limited");
    return { data: null, error: null };
  });
  return {
    createClient: async () => ({ from: db.client.from }),
    getCurrentUser: async () => ({ id: USER }),
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    storage: {
      from: () => ({
        upload: async () => {
          state.storageOps += 1;
          return { data: null, error: null };
        },
        remove: async () => {
          state.storageOps += 1;
          return { data: [], error: null };
        },
        copy: async () => {
          state.storageOps += 1;
          return { data: null, error: null };
        },
        getPublicUrl: (key: string) => ({ data: { publicUrl: `https://project.supabase.co/x/${key}` } }),
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/moderation/image-scan", () => ({
  scanImageUrl: async () => {
    state.scans += 1;
    return { flagged: false, categories: [] };
  },
}));
vi.mock("@/lib/media/upload-bytes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/upload-bytes")>();
  return {
    ...actual,
    prepareUploadBytes: async (...args: Parameters<typeof actual.prepareUploadBytes>) => {
      state.sniffs += 1;
      return actual.prepareUploadBytes(...args);
    },
  };
});
vi.mock("@/lib/scryfall/rate-limit", () => ({
  checkScryfallRateLimit: async () => ({ ok: true }),
  logScryfallCall: async () => undefined,
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => {
    throw new Error("no Scryfall lookup expected while rate-limited");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/profile/username", () => ({ revalidateProfilePage: vi.fn() }));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));

import { uploadCardArtServerAction } from "@/lib/cards/upload-art-server";
import { uploadWatermarkServerAction } from "@/lib/cards/upload-watermark-server";
import { uploadCoverServerAction } from "@/lib/media/upload-cover-server";
import { uploadProfileMediaServerAction } from "@/lib/profile/upload-server";
import { saveCustomPipAction } from "@/lib/pips/actions";
import { POST as importArt } from "@/app/api/scryfall/import-art/route";

async function form(type = "image/png", extra: Record<string, string> = {}): Promise<FormData> {
  const bytes = await cameraPhoto("png", { alpha: true });
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(bytes)], "a.png", { type }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

const ACTIONS: { label: string; run: () => Promise<unknown> }[] = [
  { label: "card art", run: async () => uploadCardArtServerAction(await form()) },
  { label: "design watermark / land icon", run: async () => uploadWatermarkServerAction(await form()) },
  { label: "deck cover / set icon", run: async () => uploadCoverServerAction(await form()) },
  { label: "avatar", run: async () => uploadProfileMediaServerAction("avatar", await form()) },
  { label: "banner", run: async () => uploadProfileMediaServerAction("banner", await form()) },
  { label: "custom pip", run: async () => saveCustomPipAction(await form("image/png", { symbol: "G" })) },
];

beforeEach(() => {
  state.limited = true;
  state.checks.length = 0;
  state.storageOps = 0;
  state.sniffs = 0;
  state.scans = 0;
});

describe.each(ACTIONS)("$label upload over the limit", ({ run }) => {
  it("is refused with the typed error before the bytes are touched or anything is written", async () => {
    const result = await run();
    expect(result).toEqual({
      ok: false,
      error: "You're uploading too fast — try again in a minute.",
      code: "UPLOAD_RATE_LIMITED",
      retryAfterSeconds: 17,
    });
    expect(state.checks).toEqual([USER]); // the session's user, once
    expect(state.storageOps).toBe(0);
    expect(state.sniffs).toBe(0);
    expect(state.scans).toBe(0);
  });
});

describe("a Scryfall art import over the limit", () => {
  it("answers 429 + Retry-After and never looks the card up", async () => {
    const res = await importArt(
      new Request("https://www.pipglyph.com/api/scryfall/import-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scryfallId: "11bf83bb-c95b-4b4f-9a56-ce7a1816307a", mode: "art" }),
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(await res.json()).toEqual({ ok: false, error: "You're uploading too fast — try again in a minute." });
    expect(state.checks).toEqual([USER]);
    expect(state.storageOps).toBe(0);
  });
});

describe("under the limit", () => {
  it("each action counts exactly one upload and goes on to store the file", async () => {
    state.limited = false;
    for (const { label, run } of ACTIONS) {
      state.checks.length = 0;
      state.storageOps = 0;
      expect(await run(), label).toMatchObject({ ok: expect.any(Boolean) });
      expect(state.checks, label).toEqual([USER]);
      expect(state.storageOps, label).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The closed list: every module that writes into a user's folder
// (`userFolder(…)` with `.upload(` / `.copyIn(`) counts the upload, except
// the ones listed here with the reason.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const NOT_COUNTED: Record<string, string> = {
  "lib/media/user-storage.ts": "the door itself",
  "lib/cards/bake-core.ts": "our own renders (card-renders): the save bake and the admin sweep",
  "lib/ai/random-art.ts": "AI art: paid for in credits and capped by lib/ai/rate-limit.ts",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("every user-folder writer counts the upload", () => {
  const files = ["app", "lib", "components"]
    .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
    .map((file) => ({ rel: path.relative(ROOT, file).split(path.sep).join("/"), src: readFileSync(file, "utf8") }));
  const writers = files.filter(({ src }) => /\buserFolder\(/.test(src) && /\.(upload|copyIn)\(/.test(src));

  it("finds the writers", () => {
    expect(writers.map((w) => w.rel).sort()).toEqual([
      "app/api/scryfall/import-art/route.ts",
      "lib/ai/random-art.ts",
      "lib/cards/bake-core.ts",
      "lib/cards/remix-media.ts",
      "lib/cards/upload-art-server.ts",
      "lib/cards/upload-watermark-server.ts",
      "lib/media/upload-cover-server.ts",
      "lib/media/user-storage.ts",
      "lib/pips/actions.ts",
      "lib/profile/upload-server.ts",
    ]);
  });

  it("each one not listed as exempt calls checkUploadRateLimit", () => {
    for (const { rel, src } of writers) {
      if (rel in NOT_COUNTED) continue;
      expect(src, rel).toMatch(/await checkUploadRateLimit\(/);
    }
  });
});
