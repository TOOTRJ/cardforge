import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/tools/pip-forge/forge — the money path. A refused description
// never reserves a credit; a stored pip settles it; every failure after the
// reserve (an illegible drawing even redrawn, a colour card that can't be
// kept, a flagged picture, a failed store) refunds it and keeps nothing.
//
// And what the tool's log is told (lib/tools/events.ts, after the response):
// `forge` with the credit charged, `forge_failed` with a `reason` code and
// whether the credit went back — codes and numbers, never the description.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  drawings: [] as Array<"bold" | "hairline" | "fail">,
  imageCalls: 0,
  flagged: false,
  cardFails: false,
  cardHangs: false,
  storeFails: false,
  spends: 0,
  settles: [] as string[],
  refunds: [] as string[],
  stored: [] as Array<{ disc: string }>,
  removed: 0,
  rateLimited: false,
  kept: 0 as number | null,
  spendFails: null as null | "insufficient_credits" | "error",
  charged: true,
  refundLands: true,
  events: [] as Array<{ slug: string; userId: string; event: string; access: string; props: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => true }));
vi.mock("@/lib/media/user-storage", () => ({ isUserStorageConfigured: () => true }));
vi.mock("@/lib/billing/credit-reconcile", () => ({ reconcileUserSpends: async () => undefined }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/tools/events", () => {
  const record = (input: (typeof state.events)[number]) => void state.events.push(input);
  return { recordToolEvent: async (input: (typeof state.events)[number]) => record(input), recordToolEventLater: record };
});
vi.mock("@/lib/tools/queries", () => ({
  checkToolAccess: async () => ({ userId: "u1", via: "grant" }),
}));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkAiRateLimit: async () =>
    state.rateLimited ? { ok: false, message: "Slow down.", retryAfterSeconds: 30 } : { ok: true },
  checkDailyActionLimit: async () => ({ ok: true }),
  getFreshCreditBalance: async () => 4,
  logAiCall: async () => undefined,
  spendCredits: async () => {
    if (state.spendFails) return { ok: false, reason: state.spendFails, message: "No credits.", balance: 0 };
    state.spends += 1;
    return { ok: true, charged: state.charged, balance: 4 };
  },
  settleSpend: async (ref: string) => {
    state.settles.push(ref);
  },
  refundCredits: async (_u: string, _n: number, _l: string, ref: string) => {
    state.refunds.push(ref);
    return state.refundLands;
  },
}));

function drawingPng(kind: "bold" | "hairline"): Promise<Buffer> {
  const S = 256;
  const C = S / 2;
  const raw = Buffer.alloc(S * S * 3, 255);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const ink =
        kind === "bold"
          ? Math.abs(Math.hypot(x - C, y - C) - 70) < 14
          : (Math.abs(x - C) < 1 && Math.abs(y - C) < 75) || (Math.abs(y - C) < 1 && Math.abs(x - C) < 75);
      if (ink) raw.fill(0, (y * S + x) * 3, (y * S + x) * 3 + 3);
    }
  }
  return sharp(raw, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer();
}

vi.mock("@/lib/ai/image-gen", () => ({
  generateImageWithFallbacks: async () => {
    const kind = state.drawings[state.imageCalls] ?? "fail";
    state.imageCalls += 1;
    if (kind === "fail") return { ok: false, error: "boom", failure: "art_failed", safetyBlocked: false };
    return { ok: true, bytes: new Uint8Array(await drawingPng(kind)), contentType: "image/png", promptIndex: 0, model: "flux" };
  },
}));
vi.mock("@/lib/moderation/image-scan", () => ({
  scanImageBytes: async () => ({ flagged: state.flagged }),
}));
vi.mock("@/lib/tools/set-symbol/server", () => ({
  decodeWorking: async (bytes: Uint8Array) => {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  },
}));

const CARD = {
  name: "Amber",
  epithet: "the colour of memory",
  philosophy: "It keeps what others forget.",
  values: ["Memory", "Patience", "Preservation"],
  keyword: { name: "Enshrine", reminder: "Exile it; cast it later." },
  mechanics: [
    { name: "Recursion", text: "Returning cards." },
    { name: "Counters", text: "Time counters." },
  ],
  cannot: ["It can't destroy creatures.", "It can't draw fast."],
  basicLand: "Grove",
  sitsBetween: "GW",
  alliesWhy: "Patience.",
  enemiesWhy: "Haste.",
};

vi.mock("@/lib/tools/pip-forge/colour-card", () => {
  class ColourCardError extends Error {}
  return {
    ColourCardError,
    designColourCard: async ({ signal }: { signal?: AbortSignal }) => {
      if (state.cardHangs) {
        // Answers only when the route ends the call.
        return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      if (state.cardFails) throw new ColourCardError("The colour card couldn't be written. Try again.");
      return { card: CARD, disc: "#8fcac0" };
    },
  };
});

vi.mock("@/lib/tools/pip-forge/server", () => ({
  countPips: async () => state.kept,
  LIBRARY_FULL_MESSAGE: "full",
  newPipVersion: () => "11111111-1111-4111-8111-111111111111",
  pipFileName: (v: string) => `pip-${v}.png`,
  glyphFileName: (v: string) => `glyph-${v}.png`,
  removePipFiles: async () => {
    state.removed += 1;
  },
  storePipFiles: async (_u: string, _v: string, _g: unknown, disc: string) => {
    if (state.storeFails) throw new Error("storage down");
    state.stored.push({ disc });
    return { pip: "https://x/pip.png", glyph: "https://x/glyph.png" };
  },
  insertPipRow: async (input: { name: string; disc: string }) => ({ id: "p1", name: input.name, disc: input.disc }),
}));

import { POST } from "@/app/api/tools/pip-forge/forge/route";

function post(body: unknown) {
  return POST(new Request("http://localhost/api/tools/pip-forge/forge", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  Object.assign(state, {
    drawings: [],
    imageCalls: 0,
    flagged: false,
    cardFails: false,
    cardHangs: false,
    storeFails: false,
    spends: 0,
    settles: [],
    refunds: [],
    stored: [],
    removed: 0,
    rateLimited: false,
    kept: 0,
    spendFails: null,
    charged: true,
    refundLands: true,
    events: [],
  });
});

/** The one line the route wrote to the tool's log. */
function logged() {
  expect(state.events).toHaveLength(1);
  const [{ slug, userId, event, access, props }] = state.events;
  expect({ slug, userId, access }).toEqual({ slug: "pip-forge", userId: "u1", access: "grant" });
  // Never the maker's words: every prop is a code, a number or a boolean.
  expect(JSON.stringify(props)).not.toMatch(/crowned|eye|sun/i);
  for (const key of Object.keys(props)) expect(key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  expect(Object.keys(props).length).toBeLessThanOrEqual(12);
  return { event, props };
}

describe("forge route", () => {
  it("refuses a mana-symbol look-alike before any credit is reserved", async () => {
    const res = await post({ subject: "a sun" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("PROMPT");
    expect(state.spends).toBe(0);
    expect(state.imageCalls).toBe(0);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "prompt_refused", problem: "mana_lookalike" } });
  });

  it("refuses a disc that isn't a colour before any credit is reserved", async () => {
    const res = await post({ subject: "a crowned eye", disc: "blue" });
    expect(res.status).toBe(400);
    expect(state.spends).toBe(0);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "invalid" } });
  });

  it("stores a legible pip on the maker's disc and settles the credit", async () => {
    state.drawings = ["bold"];
    const res = await post({ subject: "a crowned eye", disc: "#C5ABDC" });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(state.stored).toEqual([{ disc: "#c5abdc" }]);
    expect(state.settles).toHaveLength(1);
    expect(state.refunds).toHaveLength(0);
    expect(state.imageCalls).toBe(1);
    const { event, props } = logged();
    expect(event).toBe("forge");
    expect(props).toMatchObject({ credits: 1, rung: 0, redrawn: false, ai_disc: false, idea: false, at16: expect.any(Number) });
    expect(props.ms).toEqual(expect.any(Number));
    // The key the sanitizer dropped (camelCase) is gone for good.
    expect(props).not.toHaveProperty("aiDisc");
  });

  it("an uncharged forge (an admin, billing off) is logged with no credit", async () => {
    state.drawings = ["bold"];
    state.charged = false;
    expect((await (await post({ subject: "a crowned eye", idea: "memory and patience" })).json()).ok).toBe(true);
    expect(state.settles).toHaveLength(0);
    expect(logged().props).toMatchObject({ credits: 0, ai_disc: true, idea: true });
  });

  it("uses the colour card's disc when the maker lets it choose", async () => {
    state.drawings = ["bold"];
    await post({ subject: "a crowned eye", disc: null });
    expect(state.stored).toEqual([{ disc: "#8fcac0" }]);
    expect(logged().props).toMatchObject({ ai_disc: true });
  });

  it("redraws an illegible glyph once inside the same credit", async () => {
    state.drawings = ["hairline", "bold"];
    const body = await (await post({ subject: "a crowned eye" })).json();
    expect(body.ok).toBe(true);
    expect(state.imageCalls).toBe(2);
    expect(state.spends).toBe(1);
    expect(state.settles).toHaveLength(1);
    expect(logged()).toMatchObject({ event: "forge", props: { redrawn: true, credits: 1 } });
  });

  it("keeps nothing and refunds when the glyph is illegible even redrawn", async () => {
    state.drawings = ["hairline", "hairline"];
    const res = await post({ subject: "a crowned eye" });
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/too much fine detail/);
    expect(state.stored).toHaveLength(0);
    expect(state.settles).toHaveLength(0);
    expect(state.refunds).toHaveLength(1);
    expect(logged()).toMatchObject({ event: "forge_failed", props: { reason: "illegible", refunded: true } });
  });

  it("refunds when the colour card can't be kept", async () => {
    state.drawings = ["bold"];
    state.cardFails = true;
    const body = await (await post({ subject: "a crowned eye" })).json();
    expect(body.ok).toBe(false);
    expect(state.stored).toHaveLength(0);
    expect(state.refunds).toHaveLength(1);
    expect(logged()).toMatchObject({ event: "forge_failed", props: { reason: "design_failed", refunded: true } });
  });

  it("refunds a flagged picture with 422 and stores nothing", async () => {
    state.drawings = ["bold"];
    state.flagged = true;
    const res = await post({ subject: "a crowned eye" });
    expect(res.status).toBe(422);
    expect(state.stored).toHaveLength(0);
    expect(state.refunds).toHaveLength(1);
    expect(logged()).toMatchObject({ event: "forge_failed", props: { reason: "scan_blocked", refunded: true } });
  });

  it("refunds and cleans up when storing fails", async () => {
    state.drawings = ["bold"];
    state.storeFails = true;
    const body = await (await post({ subject: "a crowned eye" })).json();
    expect(body.ok).toBe(false);
    expect(state.refunds).toHaveLength(1);
    expect(state.settles).toHaveLength(0);
    expect(state.removed).toBe(1);
    expect(logged()).toMatchObject({ event: "forge_failed", props: { reason: "art_store", refunded: true } });
  });

  it("a failed drawing ends the colour card's call and refunds at once", async () => {
    state.drawings = ["fail"];
    state.cardHangs = true;
    const body = await (await post({ subject: "a crowned eye" })).json();
    expect(body.ok).toBe(false);
    expect(state.refunds).toHaveLength(1);
    expect(state.settles).toHaveLength(0);
    // The image service's own failure kind is the reason.
    expect(logged()).toMatchObject({ event: "forge_failed", props: { reason: "art_failed", refunded: true } });
  });
});

describe("forge route — what never reached the AI is logged with why, and no refund", () => {
  it("a refused idea, and a body the schema can't read", async () => {
    const res = await post({ subject: "a crowned eye", idea: "x".repeat(400) });
    expect(res.status).toBe(400);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "idea_refused", problem: "too_long" } });
    state.events = [];
    expect((await post({ subject: "a crowned eye", idea: "x".repeat(700) })).status).toBe(400);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "invalid" } });
    expect(state.spends).toBe(0);
  });

  it("a full library", async () => {
    state.kept = 10_000;
    expect((await post({ subject: "a crowned eye" })).status).toBe(409);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "library_full" } });
    expect(state.spends).toBe(0);
  });

  it("a library that couldn't be read", async () => {
    state.kept = null;
    expect((await post({ subject: "a crowned eye" })).status).toBe(503);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "library_unreadable" } });
  });

  it("the AI rate limit", async () => {
    state.rateLimited = true;
    expect((await post({ subject: "a crowned eye" })).status).toBe(429);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "rate_limited" } });
    expect(state.spends).toBe(0);
  });

  it("an empty balance, and a credit check that failed", async () => {
    state.spendFails = "insufficient_credits";
    expect((await post({ subject: "a crowned eye" })).status).toBe(402);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "insufficient_credits" } });
    state.events = [];
    state.spendFails = "error";
    expect((await post({ subject: "a crowned eye" })).status).toBe(503);
    expect(logged()).toEqual({ event: "forge_failed", props: { reason: "credit_check_failed" } });
    expect(state.imageCalls).toBe(0);
  });

  it("a refund that didn't land is said as pending, never as refunded", async () => {
    state.drawings = ["fail"];
    state.refundLands = false;
    await post({ subject: "a crowned eye" });
    expect(logged().props).toMatchObject({ reason: "art_failed", refunded: false, refund_pending: true });
  });

  it("a failure with nothing charged refunds nothing", async () => {
    state.drawings = ["fail"];
    state.charged = false;
    await post({ subject: "a crowned eye" });
    expect(state.refunds).toHaveLength(0);
    const { props } = logged();
    expect(props).toMatchObject({ reason: "art_failed", refunded: false });
    expect(props).not.toHaveProperty("refund_pending");
  });
});
