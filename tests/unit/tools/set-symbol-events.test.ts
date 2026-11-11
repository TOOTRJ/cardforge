import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What Set Symbol Studio tells the tool's log (lib/tools/events.ts
// recordToolEventLater, after the response) — what /admin/tools reads as
// "started, worked, failed and why, credits spent or refunded":
//   - POST /api/tools/set-symbol-studio/generate: `generate` with the credit
//     charged, or `generate_failed` with a `reason` code — a refusal before
//     the charge, a failure after it with whether the credit went back;
//   - the free actions: `upload` / `recut` / `rename` / `delete` when they
//     worked (`delete` only when a symbol really went), `upload_failed` /
//     `recut_failed` with a `reason`.
// Codes, choices and numbers only — never the description, a name, a file
// name or an id.
// ---------------------------------------------------------------------------

const ID = "00000000-0000-4000-8000-0000000000b1";

type Logged = { slug: string; userId: string; event: string; access: string; props?: Record<string, unknown> };

const s = vi.hoisted(() => ({
  events: [] as Logged[],
  access: { userId: "u1", via: "release" } as null | { userId: string; via: string },
  kept: 0 as number | null,
  rateLimited: false,
  spendFails: null as null | "insufficient_credits" | "error",
  charged: true,
  refundLands: true,
  refunds: 0,
  settles: 0,
  image: "ok" as "ok" | "art_blocked" | "art_timeout",
  flagged: false,
  paint: "ok" as "ok" | "cut" | "boom",
  rowWritten: true,
  uploadLimited: false,
  symbol: null as null | Record<string, unknown>,
  source: new Uint8Array([1]) as Uint8Array | null,
  /** What the owner's session answers an update / a delete with. */
  rows: [{ id: "row" }] as Array<{ id: string }>,
  dbError: null as null | { message: string },
  /** The last chain a delete ran: `select` is how the action learns a row went. */
  deleteAskedForRows: false,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => true }));
vi.mock("@/lib/media/user-storage", () => ({ isUserStorageConfigured: () => true }));
vi.mock("@/lib/billing/credit-reconcile", () => ({ reconcileUserSpends: async () => undefined }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => s.access }));
vi.mock("@/lib/tools/events", () => {
  const record = (input: Logged) => void s.events.push(input);
  return { recordToolEvent: async (input: Logged) => record(input), recordToolEventLater: record };
});
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: async () => (s.rateLimited ? { ok: false, message: "Slow down.", retryAfterSeconds: 30 } : { ok: true }),
  checkDailyActionLimit: async () => ({ ok: true }),
  getFreshCreditBalance: async () => 4,
  logAiCall: async () => undefined,
  spendCredits: async () =>
    s.spendFails
      ? { ok: false, reason: s.spendFails, message: "No credits.", balance: 0 }
      : { ok: true, charged: s.charged, balance: 4 },
  settleSpend: async () => void (s.settles += 1),
  refundCredits: async () => {
    s.refunds += 1;
    return s.refundLands;
  },
}));
vi.mock("@/lib/ai/image-gen", () => ({
  generateImageWithFallbacks: async () =>
    s.image === "ok"
      ? { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", promptIndex: 1, model: "flux" }
      : { ok: false, error: "boom", failure: s.image, safetyBlocked: s.image === "art_blocked" },
}));
vi.mock("@/lib/moderation/image-scan", () => ({ scanImageBytes: async () => ({ flagged: s.flagged }) }));
vi.mock("@/lib/media/upload-bytes", () => ({ prepareUploadBytes: async (bytes: Buffer) => bytes }));
vi.mock("@/lib/media/upload-rate-limit", () => ({
  checkUploadRateLimit: async () =>
    s.uploadLimited ? { ok: false, message: "Too fast.", retryAfterSeconds: 9 } : { ok: true },
  uploadRateLimitFailure: (denied: { message: string; retryAfterSeconds: number }) => ({
    ok: false,
    error: denied.message,
    code: "UPLOAD_RATE_LIMITED",
    retryAfterSeconds: denied.retryAfterSeconds,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const answer = { data: null as unknown, error: null as unknown };
      const chain: Record<string, unknown> = {
        update: () => chain,
        delete: () => {
          s.deleteAskedForRows = false;
          return chain;
        },
        eq: () => chain,
        select: () => {
          s.deleteAskedForRows = true;
          return chain;
        },
        // The chain is awaited where it ends (after `.eq()` or `.select()`).
        then: (resolve: (value: typeof answer) => void) =>
          resolve({ data: s.dbError ? null : s.rows, error: s.dbError }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/tools/set-symbol/server", () => {
  class SymbolCutError extends Error {}
  const painted = async () => {
    if (s.paint === "cut") throw new SymbolCutError("Nothing is left after removing the background.");
    if (s.paint === "boom") throw new Error("storage down");
    return { mode: "edges", legibility: 0.82 };
  };
  const row = async (input: { name?: string }) =>
    s.rowWritten ? { id: "sym-1", name: input.name ?? "Kept", source: "ai", files: {} } : null;
  return {
    SET_SYMBOL_SLUG: "set-symbol-studio",
    SymbolCutError,
    LIBRARY_FULL_MESSAGE: "full",
    countSymbols: async () => s.kept,
    decodeWorking: async () => ({ width: 1, height: 1, data: new Uint8Array(4) }),
    paintSymbolFiles: painted,
    newSymbolVersion: () => "33333333-3333-4333-8333-333333333333",
    sourceExtensionOf: (format: string | undefined) =>
      ({ png: "png", jpeg: "jpg", webp: "webp" })[format ?? ""] ?? (format === undefined ? "png" : null),
    storeSymbolVersion: async () => ({ source: "https://x/src.png" }),
    removeSymbolVersion: async () => undefined,
    insertSymbolRow: row,
    updateSymbolVersion: row,
    readOwnSymbol: async () => s.symbol,
    fetchOwnSource: async () => s.source,
  };
});

import { POST } from "@/app/api/tools/set-symbol-studio/generate/route";
import {
  deleteSymbolAction,
  recutSymbolAction,
  renameSymbolAction,
  uploadSymbolAction,
} from "@/lib/tools/set-symbol/actions";

const SUBJECT = "a cracked moon above a lighthouse";

function generate(body: unknown) {
  return POST(
    new Request("http://localhost/api/tools/set-symbol-studio/generate", { method: "POST", body: JSON.stringify(body) }),
  );
}

beforeEach(() => {
  Object.assign(s, {
    events: [],
    access: { userId: "u1", via: "release" },
    kept: 0,
    rateLimited: false,
    spendFails: null,
    charged: true,
    refundLands: true,
    refunds: 0,
    settles: 0,
    image: "ok",
    flagged: false,
    paint: "ok",
    rowWritten: true,
    uploadLimited: false,
    symbol: { id: ID, name: "Moonlight", files: { source: "https://x/src.png" } },
    source: new Uint8Array([1]),
    rows: [{ id: "row" }],
    dbError: null,
    deleteAskedForRows: false,
  });
});

/** The one line written to the tool's log. */
function logged() {
  expect(s.events).toHaveLength(1);
  const [{ slug, userId, event, access, props }] = s.events;
  expect({ slug, userId, access }).toEqual({ slug: "set-symbol-studio", userId: "u1", access: "release" });
  // Never the maker's words, a symbol's or a file's name, or an id.
  expect(JSON.stringify(props ?? {})).not.toMatch(/moon|lighthouse|Moonlight|dragon|\.png|0000-4000/i);
  for (const key of Object.keys(props ?? {})) expect(key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  expect(Object.keys(props ?? {}).length).toBeLessThanOrEqual(12);
  return props === undefined ? { event } : { event, props };
}

describe("generate — a symbol that was drawn", () => {
  it("is `generate` with the style, the prompt's rung, how it reads and the credit charged", async () => {
    const body = await (await generate({ subject: SUBJECT, style: "runic" })).json();
    expect(body.ok).toBe(true);
    expect(s.settles).toBe(1);
    const { event, props } = logged();
    expect(event).toBe("generate");
    expect(props).toEqual({ style: "runic", rung: 1, legibility: 0.82, credits: 1, ms: expect.any(Number) });
  });

  it("an uncharged one (an admin, billing off) says no credit", async () => {
    s.charged = false;
    expect((await (await generate({ subject: SUBJECT })).json()).ok).toBe(true);
    expect(s.settles).toBe(0);
    expect(logged().props).toMatchObject({ style: "bold", credits: 0 });
  });
});

describe("generate — refused before the charge: `generate_failed`, why, and no refund", () => {
  it.each([
    ["a description we don't send", { subject: "a swastika" }, 400, { reason: "prompt_refused", problem: "hate_symbol" }],
    ["a description too short", { subject: "a" }, 400, { reason: "prompt_refused", problem: "too_short" }],
    ["a body the schema can't read", { subject: SUBJECT, style: "neon" }, 400, { reason: "invalid" }],
  ] as const)("%s", async (_name, body, status, props) => {
    expect((await generate(body)).status).toBe(status);
    expect(logged()).toEqual({ event: "generate_failed", props });
    expect(s.refunds).toBe(0);
  });

  it("a full library, and one that couldn't be read", async () => {
    s.kept = 10_000;
    expect((await generate({ subject: SUBJECT })).status).toBe(409);
    expect(logged()).toEqual({ event: "generate_failed", props: { reason: "library_full" } });
    s.events = [];
    s.kept = null;
    expect((await generate({ subject: SUBJECT })).status).toBe(503);
    expect(logged()).toEqual({ event: "generate_failed", props: { reason: "library_unreadable" } });
  });

  it("the AI rate limit", async () => {
    s.rateLimited = true;
    expect((await generate({ subject: SUBJECT })).status).toBe(429);
    expect(logged()).toEqual({ event: "generate_failed", props: { reason: "rate_limited" } });
  });

  it("an empty balance, and a credit check that failed", async () => {
    s.spendFails = "insufficient_credits";
    expect((await generate({ subject: SUBJECT })).status).toBe(402);
    expect(logged()).toEqual({ event: "generate_failed", props: { reason: "insufficient_credits" } });
    s.events = [];
    s.spendFails = "error";
    expect((await generate({ subject: SUBJECT })).status).toBe(503);
    expect(logged()).toEqual({ event: "generate_failed", props: { reason: "credit_check_failed" } });
  });

  it("a closed tool logs nothing", async () => {
    s.access = null;
    expect((await generate({ subject: SUBJECT })).status).toBe(404);
    expect(s.events).toHaveLength(0);
  });
});

describe("generate — failed after the charge: `generate_failed`, why, and the credit", () => {
  it.each([
    ["the image service's filter", { image: "art_blocked" }, "art_blocked"],
    ["the image service timing out", { image: "art_timeout" }, "art_timeout"],
    ["our own scan of the picture", { flagged: true }, "scan_blocked"],
    ["a picture with nothing to cut out", { paint: "cut" }, "no_symbol"],
    ["a paint that threw", { paint: "boom" }, "art_failed"],
    ["a row that wasn't written", { rowWritten: false }, "art_store"],
  ] as const)("%s", async (_name, state, reason) => {
    Object.assign(s, state);
    const body = await (await generate({ subject: SUBJECT })).json();
    expect(body.ok).toBe(false);
    expect(s.refunds).toBe(1);
    expect(s.settles).toBe(0);
    expect(logged()).toEqual({ event: "generate_failed", props: { reason, refunded: true, ms: expect.any(Number) } });
  });

  it("a refund that didn't land is pending, never refunded; nothing charged refunds nothing", async () => {
    s.image = "art_timeout";
    s.refundLands = false;
    await generate({ subject: SUBJECT });
    expect(logged().props).toMatchObject({ reason: "art_timeout", refunded: false, refund_pending: true });

    s.events = [];
    s.charged = false;
    s.refunds = 0;
    await generate({ subject: SUBJECT });
    expect(s.refunds).toBe(0);
    const { props } = logged();
    expect(props).toMatchObject({ reason: "art_timeout", refunded: false });
    expect(props).not.toHaveProperty("refund_pending");
  });
});

async function pictureForm(bytes: Uint8Array, name = "Moonlight") {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], "my dragon logo.png", { type: "image/png" }));
  form.append("name", name);
  form.append("settings", JSON.stringify({ mode: "edges", tolerance: 40, ink: "colour" }));
  return form;
}

const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
const tiff = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).tiff().toBuffer();

describe("upload (bring your own) and re-cut", () => {
  it("a saved picture is `upload` with how it was cut", async () => {
    expect((await uploadSymbolAction(await pictureForm(await png()))).ok).toBe(true);
    expect(logged()).toEqual({ event: "upload", props: { mode: "edges", ink: "colour", legibility: 0.82 } });
  });

  it.each([
    ["rate_limited", { uploadLimited: true }, "png"],
    ["library_full", { kept: 10_000 }, "png"],
    ["library_unreadable", { kept: null }, "png"],
    ["invalid_image", {}, "junk"],
    ["unsupported_format", {}, "tiff"],
    ["scan_blocked", { flagged: true }, "png"],
    ["no_symbol", { paint: "cut" }, "png"],
    ["store_failed", { paint: "boom" }, "png"],
  ] as const)("a refusal is `upload_failed` with reason %s", async (reason, state, picture) => {
    Object.assign(s, state);
    const bytes = picture === "png" ? await png() : picture === "tiff" ? await tiff() : Buffer.from("not a picture at all");
    expect((await uploadSymbolAction(await pictureForm(bytes))).ok).toBe(false);
    expect(logged()).toEqual({ event: "upload_failed", props: { reason } });
  });

  it("a picture over the size limit is `too_large`", async () => {
    expect((await uploadSymbolAction(await pictureForm(new Uint8Array(4 * 1024 * 1024 + 1)))).ok).toBe(false);
    expect(logged()).toEqual({ event: "upload_failed", props: { reason: "too_large" } });
  });

  it("a new cut is `recut` with how it was cut", async () => {
    const result = await recutSymbolAction({ id: ID, settings: { mode: "drawing", tolerance: 55, ink: "one" } });
    expect(result.ok).toBe(true);
    expect(logged()).toEqual({ event: "recut", props: { mode: "edges", ink: "one", legibility: 0.82 } });
  });

  it.each([
    ["rate_limited", { uploadLimited: true }],
    ["gone", { symbol: null }],
    ["source_unreadable", { source: null }],
    ["no_symbol", { paint: "cut" }],
    ["store_failed", { rowWritten: false }],
  ] as const)("a refusal is `recut_failed` with reason %s", async (reason, state) => {
    Object.assign(s, state);
    expect((await recutSymbolAction({ id: ID, settings: {} })).ok).toBe(false);
    expect(logged()).toEqual({ event: "recut_failed", props: { reason } });
  });
});

describe("rename and delete", () => {
  it("a saved name is `rename` — with no props: never the name", async () => {
    expect(await renameSymbolAction({ id: ID, name: "Moonlight II" })).toEqual({ ok: true });
    expect(logged()).toEqual({ event: "rename" });
    s.events = [];
    s.rows = [];
    expect((await renameSymbolAction({ id: ID, name: "Moonlight III" })).ok).toBe(false);
    expect(s.events).toHaveLength(0);
  });

  it("`delete` only when a symbol really went (the removed row is asked back)", async () => {
    expect(await deleteSymbolAction({ id: ID })).toEqual({ ok: true });
    expect(s.deleteAskedForRows).toBe(true);
    expect(logged()).toEqual({ event: "delete" });

    // A second press: no row left to remove — the same answer, nothing logged.
    s.events = [];
    s.rows = [];
    expect(await deleteSymbolAction({ id: ID })).toEqual({ ok: true });
    expect(s.events).toHaveLength(0);

    s.dbError = { message: "boom" };
    expect((await deleteSymbolAction({ id: ID })).ok).toBe(false);
    expect(s.events).toHaveLength(0);
  });
});
