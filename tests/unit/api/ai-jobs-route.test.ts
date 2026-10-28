import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs pre-flight — the checks that decide whether a paid job
// starts at all: batch size defaults (never the 100-card ceiling by
// omission), the saved-card cap (403 CARD_CAPACITY with the numbers), the
// credit balance (402 INSUFFICIENT_CREDITS), the one Pro gate (deck-aware
// card design), and the deck-remix refusal for an empty/foreign deck.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  tier: "free" as "free" | "plus" | "pro",
  credits: 10,
  capacity: { used: 0, cap: 50, tier: "free" } as { used: number; cap: number; tier: "free" | "plus" | "pro" } | null,
  remixable: 5,
  /** Remixable entries that are double-faced (two credits each, TODO 5.4). */
  doubleFaced: 0,
  /** Emblems the estimate leaves out (owner 2026-10-13). */
  emblems: 0,
  /** The AI rate limit's answer. */
  rate: { ok: true } as Record<string, unknown>,
  /** How often the deck remix's estimate (its Scryfall work) ran. */
  estimateCalls: 0,
  created: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  /** What createCardFillJob answers instead of a job (a refused plan). */
  fillRefusal: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  getCurrentProfile: async () => ({ is_admin: false }),
}));
vi.mock("@/lib/ai/provider", () => ({ isDesignAiConfigured: () => true }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  checkAiRateLimit: async () => s.rate,
  checkRandomCardDailyLimit: async () => ({ ok: true }),
  checkDailyActionLimit: async () => ({ ok: true }),
  getFreshCreditBalance: async () => s.credits,
}));
vi.mock("@/lib/billing/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/entitlements")>();
  const RANK = { free: 0, plus: 1, pro: 2 };
  return {
    ...actual,
    getEntitlements: async () => ({ credits: s.credits, effectiveTier: s.tier, isPaid: s.tier !== "free" }),
    requireTier: async (min: "free" | "plus" | "pro") => {
      if (RANK[s.tier] < RANK[min]) throw new actual.UpgradeRequiredError(min);
      return { credits: s.credits, effectiveTier: s.tier };
    },
  };
});
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => s.capacity }));
// The deck remix's estimate (TODO 5.4): `remixable` entries, `doubleFaced`
// of them priced at two credits (both faces painted).
vi.mock("@/lib/ai/remix-estimate", () => ({
  estimateDeckRemix: async () => {
    s.estimateCalls += 1;
    return {
      cards: s.remixable,
      credits: s.remixable + s.doubleFaced,
      doubleFaced: s.doubleFaced,
      skipped: 0,
      emblems: s.emblems,
      unresolved: 0,
      creditsByEntry: Object.fromEntries(
        Array.from({ length: s.remixable }, (_, i) => [`entry-${i}`, i < s.doubleFaced ? 2 : 1]),
      ),
    };
  },
}));
vi.mock("@/lib/ai/generation-jobs", () => {
  const record = (kind: string) => async (input: Record<string, unknown>) => {
    s.created.push({ kind, input });
    return { ok: true, job: { id: `job-${kind}`, steps: [], plan: { fields: { title: "Unpaid text" } } }, deckSlug: "deck-slug" };
  };
  return {
    createCardGenerationJob: record("card"),
    createCardFillJob: async (input: Record<string, unknown>) =>
      s.fillRefusal ?? record("card_fill")(input),
    createDeckGenerationJob: record("deck"),
    createDeckRemixJob: record("deck_remix"),
  };
});

import { POST } from "@/app/api/ai/jobs/route";

const DECK_ID = "11111111-1111-4111-8111-111111111111";
const post = async (body: unknown) => {
  const res = await POST(
    new Request("http://x/api/ai/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  s.tier = "free";
  s.credits = 10;
  s.capacity = { used: 0, cap: 50, tier: "free" };
  s.remixable = 5;
  s.doubleFaced = 0;
  s.rate = { ok: true };
  s.estimateCalls = 0;
  s.emblems = 0;
  s.created = [];
  s.fillRefusal = null;
});

describe("POST /api/ai/jobs", () => {
  it("defaults a deck without a size to the 3-card batch, never the 100-card ceiling", async () => {
    const { status } = await post({ kind: "deck", theme: "goblins", format: "commander" });
    expect(status).toBe(200);
    expect(s.created).toEqual([expect.objectContaining({ kind: "deck", input: expect.objectContaining({ size: 3 }) })]);
  });

  it("refuses an over-cap batch up front with 403 CARD_CAPACITY and the numbers", async () => {
    s.capacity = { used: 48, cap: 50, tier: "free" };
    const { status, json } = await post({ kind: "deck", theme: "x", format: "commander", size: 5 });
    expect(status).toBe(403);
    expect(json.code).toBe("CARD_CAPACITY");
    expect(String(json.error)).toContain("2 slots left");
    expect(s.created).toHaveLength(0);
  });

  it("answers 402 INSUFFICIENT_CREDITS before spending a plan call", async () => {
    s.credits = 1;
    const { status, json } = await post({ kind: "deck", theme: "x", format: "commander", size: 3 });
    expect(status).toBe(402);
    expect(json).toMatchObject({ code: "INSUFFICIENT_CREDITS", needed: 3, balance: 1 });
    expect(s.created).toHaveLength(0);
  });

  it("gates deck-aware card design behind Pro — the only tier gate on this route", async () => {
    const free = await post({ kind: "card", theme: "x", deck_id: DECK_ID });
    expect(free.status).toBe(403);
    expect(free.json.code).toBe("UPGRADE_REQUIRED");
    s.tier = "pro";
    const pro = await post({ kind: "card", theme: "x", deck_id: DECK_ID });
    expect(pro.status).toBe(200);
    expect(s.created.map((c) => c.kind)).toEqual(["card"]);
    // A card WITHOUT a deck needs no tier at all.
    s.tier = "free";
    expect((await post({ kind: "card", theme: "x" })).status).toBe(200);
  });

  it("refuses a deck remix with nothing to remix (or a deck that isn't the caller's) with a 400", async () => {
    s.remixable = 0;
    const { status, json } = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/no cards to remix/);
    s.remixable = 5;
    expect((await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" })).status).toBe(200);
  });

  // Emblems are not remixed (owner 2026-10-13): the estimate leaves them
  // out of `cards` and `credits`, so the pre-check never asks a credit for
  // one, and a deck of emblems alone is refused in plain words.
  it("never charges for an emblem: a deck of emblems alone is refused, a mixed one needs its other cards' credits only", async () => {
    s.remixable = 0;
    s.emblems = 2;
    const only = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(only.status).toBe(400);
    expect(String(only.json.error)).toBe("That deck has only emblems, and emblems aren't remixed.");
    expect(s.created).toHaveLength(0);

    s.remixable = 2;
    s.emblems = 1;
    s.credits = 2;
    const mixed = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(mixed.status).toBe(200);
    s.credits = 1;
    const short = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(short.status).toBe(402);
    expect(short.json).toMatchObject({ needed: 2 });
  });

  it("a rate-limited caller is refused BEFORE the deck remix's estimate does its Scryfall work", async () => {
    s.rate = { ok: false, reason: "per_minute", retryAfterSeconds: 30, message: "Slow down." };
    const { status } = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(status).toBe(429);
    expect(s.estimateCalls).toBe(0);
    expect(s.created).toHaveLength(0);
  });

  // TODO 5.4 (owner Q4): a deck remix's double-faced entries cost TWO
  // credits — the estimate prices them, the pre-check needs them, and the
  // plan's per-entry credits reach the job so each step reserves its own.
  it("prices a deck remix's double-faced entries at two credits before anything is spent", async () => {
    s.remixable = 3;
    s.doubleFaced = 2;
    s.credits = 4;
    const short = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(short.status).toBe(402);
    expect(short.json).toMatchObject({ code: "INSUFFICIENT_CREDITS", needed: 5, balance: 4 });
    expect(String(short.json.error)).toMatch(/3 cards, 2 of them double-faced at 2 credits/);
    expect(s.created).toHaveLength(0);

    s.credits = 5;
    const ok = await post({ kind: "deck_remix", deck_id: DECK_ID, style: "ink" });
    expect(ok.status).toBe(200);
    expect(s.created).toEqual([
      expect.objectContaining({
        kind: "deck_remix",
        input: expect.objectContaining({ creditsByEntry: { "entry-0": 2, "entry-1": 2, "entry-2": 1 } }),
      }),
    ]);
  });

  it("rejects a malformed body and an unknown kind", async () => {
    expect((await post({ kind: "sets", theme: "x" })).status).toBe(400);
    const res = await POST(new Request("http://x/api/ai/jobs", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });
});

// TODO 6.23: a per-field fill on an open emblem pins the card's own type
// (`locked`), while the design types the dialogs offer stay the nine
// standard ones (emblems are kept out until asked).
describe("POST /api/ai/jobs — an emblem's per-field fill", () => {
  it("accepts an emblem as the locked card type, and never as a design type", async () => {
    const locked = await post({ kind: "card_fill", want: ["art"], locked: { card_type: "emblem", title: "Kaito" } });
    expect(locked.status).toBe(200);
    expect(s.created.at(-1)?.kind).toBe("card_fill");
    const steered = await post({ kind: "card_fill", want: ["card_type"], steer: { card_type: "emblem" } });
    expect(steered.status).toBe(400);
    const designed = await post({ kind: "card", card_type: "emblem" });
    expect(designed.status).toBe(400);
  });
});

// Owner 2026-10-14: a station card's per-field fill whose empty tier came
// back empty is refused at plan time — the route passes the refusal on with
// its code (no job, no credit) for the fill dialog's message.
describe("POST /api/ai/jobs — a station fill refused at plan time", () => {
  it("answers the refusal with 422 (an expected outcome, not a gateway fault), its code and message; no job is created", async () => {
    s.fillRefusal = {
      ok: false,
      code: "STATION_TIER_UNFILLED",
      error: "The AI couldn't write that tier — nothing was charged. Try again or write it yourself.",
    };
    const { status, json } = await post({ kind: "card_fill", want: ["rules_text"], locked: { card_type: "artifact", subtypes: ["Spacecraft"], station_text: "Station\n3+ | " } });
    expect(status).toBe(422);
    expect(json).toEqual(s.fillRefusal);
    expect(s.created).toHaveLength(0);
  });

  it("any other refused plan answers as it did on main: no code", async () => {
    s.fillRefusal = { ok: false, error: "AI card design failed: boom" };
    const { status, json } = await post({ kind: "card_fill", want: ["title"], locked: {} });
    expect(status).toBe(502);
    expect(json).toEqual({ ok: false, error: "AI card design failed: boom" });
  });
});

// TODO 4.48b: an art fill names the creator's frame so the picture is
// painted in its window's shape — a KNOWN template only, never a refused
// fill: anything else is dropped (the art is then painted for the default).
describe("POST /api/ai/jobs — the art fill's frame", () => {
  it("passes a known template on as artFrame; drops an unknown one without refusing the fill", async () => {
    const known = await post({ kind: "card_fill", want: ["art"], locked: { card_type: "token" }, art_frame: "m20token" });
    expect(known.status).toBe(200);
    expect(s.created.at(-1)?.input).toMatchObject({ artFrame: "m20token" });
    for (const art_frame of ["regular", "../../etc", 42, { template: "m15" }]) {
      const dropped = await post({ kind: "card_fill", want: ["art"], locked: {}, art_frame });
      expect(dropped.status, String(art_frame)).toBe(200);
      expect((s.created.at(-1)?.input as Record<string, unknown>).artFrame).toBeUndefined();
    }
  });
});

// 2026-10-28 (fix/ai-generation-live): the fill's pinned context is the open
// form as it stands — a value outside a limit (a 31-character tag, a long
// subtype, a legacy "spell" type, a deck theme past the dialog's maxLength)
// used to refuse the WHOLE generation with "Invalid generation request.".
// It is clipped or dropped now; the request itself is never refused for it.
describe("POST /api/ai/jobs — a fill's pins never refuse the generation", () => {
  it("clips a pin past its limit and drops an unknown type", async () => {
    const { status } = await post({
      kind: "card_fill",
      want: ["rules_text"],
      locked: {
        card_type: "spell",
        subtypes: ["Dragon".repeat(8), ...Array.from({ length: 12 }, (_, i) => `Sub${i}`)],
        tags: ["a".repeat(31), ...Array.from({ length: 14 }, (_, i) => `tag${i}`)],
        power: "123456789012345678",
      },
      theme: "t".repeat(400),
    });
    expect(status).toBe(200);
    const input = s.created.at(-1)!.input as {
      locked: { card_type?: string; subtypes: string[]; tags: string[]; power: string };
      theme: string;
    };
    expect(input.locked.card_type).toBeUndefined();
    expect(input.locked.subtypes).toHaveLength(10);
    expect(input.locked.subtypes[0]).toHaveLength(40);
    expect(input.locked.tags).toHaveLength(12);
    expect(input.locked.tags[0]).toHaveLength(30);
    expect(input.locked.power).toHaveLength(16);
    expect(input.theme).toHaveLength(300);
  });

  it("the plan never leaves the server: a fill's text is not handed over before the step charges", async () => {
    for (const body of [
      { kind: "card_fill", want: ["rules_text"], locked: {} },
      { kind: "card", theme: "embers" },
      { kind: "deck", theme: "goblins", format: "commander" },
    ]) {
      const { status, json } = await post(body);
      expect(status).toBe(200);
      expect(json.job).toMatchObject({ id: expect.any(String) });
      expect(json.job).not.toHaveProperty("plan");
      expect(JSON.stringify(json)).not.toContain("Unpaid text");
    }
  });

  it("a refused request says no credits were used", async () => {
    const { status, json } = await post({ kind: "card_fill", want: [] });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("No credits were used.");
  });

  it("a refused plan passes its failure kind on (its message already says nothing was used)", async () => {
    s.fillRefusal = {
      ok: false,
      code: "design_busy",
      error: "The AI service is busy right now. Wait a minute, then try again. No credits were used.",
    };
    const { status, json } = await post({ kind: "card_fill", want: ["title"], locked: {} });
    expect(status).toBe(502);
    expect(json).toEqual(s.fillRefusal);
  });
});

// The AI dialog redesign (PR 1): the theme / style presets and the maker's
// twists are assembled HERE (lib/ai/presets.ts assemblePrompt), the twist
// first; the dialog's kind steers the type and makes the fill frame-first.
// Every one of them is cleaned, clipped or dropped — never a refusal — and a
// request that names none of them reaches the job exactly as before.
describe("POST /api/ai/jobs — the dialog's presets, twists and kind", () => {
  it("assembles the theme and style from presets and twists, the twist first", async () => {
    const { status } = await post({
      kind: "card_fill",
      want: ["card_type", "title", "art"],
      locked: {},
      theme_preset: "gothic-horror",
      theme_twist: "lighthouse keepers",
      style_preset: "stained-glass",
      design_kind: "creature",
      frame: "m15nyx",
    });
    expect(status).toBe(200);
    const input = s.created.at(-1)!.input as Record<string, unknown>;
    expect(String(input.theme)).toMatch(/^lighthouse keepers \(the maker's own words: they win\) — set in gothic horror/);
    expect(String(input.style)).toMatch(/^stained glass: /);
    expect(input.assembled).toEqual({ artStyle: "stained glass", styleArt: expect.stringMatching(/^Art direction: a stained-glass window/) });
    expect(input.designKind).toBe("creature");
    expect(input.steer).toEqual({ card_type: "creature" });
    expect(input.frame).toBe("m15nyx");
  });

  it("cleans and clips a twist, drops an unknown preset or kind — never refuses", async () => {
    const { status } = await post({
      kind: "card_fill",
      want: ["card_type", "title"],
      locked: {},
      theme_preset: "not-a-preset",
      theme_twist: `  ${"x".repeat(400)}\u0000 `,
      style_preset: 42,
      style_twist: ["no"],
      design_kind: "battle",
    });
    expect(status).toBe(200);
    const input = s.created.at(-1)!.input as Record<string, unknown>;
    expect(input.theme).toBe("x".repeat(160));
    expect(input.style).toBeUndefined();
    expect(input).not.toHaveProperty("designKind");
  });

  it("Surprise me leaves the type free; a kind is ignored when the type isn't being written", async () => {
    await post({ kind: "card_fill", want: ["card_type", "title"], locked: {}, design_kind: "surprise" });
    expect(s.created.at(-1)!.input).toMatchObject({ designKind: "surprise", steer: {} });
    await post({ kind: "card_fill", want: ["title"], locked: {}, design_kind: "creature" });
    expect(s.created.at(-1)!.input).not.toHaveProperty("designKind");
  });

  it("a request that names none of them reaches the job as before (its own theme and style)", async () => {
    await post({ kind: "card_fill", want: ["title"], locked: {}, theme: "embers", style: "oil" });
    const input = s.created.at(-1)!.input as Record<string, unknown>;
    expect(input).toMatchObject({ theme: "embers", style: "oil" });
    expect(input).not.toHaveProperty("assembled");
    expect(input).not.toHaveProperty("designKind");
  });

  it("a design that didn't fit the frame picked is an expected outcome (422), nothing created", async () => {
    s.fillRefusal = {
      ok: false,
      code: "frame_unfit",
      error: "The AI's design didn't fit the frame you picked. Try again, or let it choose the frame with Surprise me. No credits were used.",
    };
    const { status, json } = await post({ kind: "card_fill", want: ["card_type"], locked: {}, design_kind: "creature", frame: "m15nyx" });
    expect(status).toBe(422);
    expect(json).toEqual(s.fillRefusal);
  });
});
