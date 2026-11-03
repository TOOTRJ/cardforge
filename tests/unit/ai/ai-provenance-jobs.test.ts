import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// Every AI job marks what it made (TODO CP1, migration 0162) — through the
// service role, never in the card action's payload (the pinned payloads in
// job-payloads-pinned.test.ts stay main's):
//   * the card / deck job: every text part of the card it wrote — where the
//     receipt the server kept when it DESIGNED the card holds the plan's
//     text (a job row is owner-insertable, 0059: a forged plan marks
//     nothing);
//   * the deck remix: the name it gave the card (and its flavour);
//   * the per-field fill: a RECEIPT of the fields it wrote, kept when the
//     server plans it, which a later creator save's claim is checked
//     against (no card exists yet).
// The pictures need no writer: the database derives them from the address
// the AI art store gives them.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  job: null as unknown as Record<string, unknown>,
  stepKey: "card:0",
  printing: null as unknown,
  answers: [] as unknown[][],
  inserted: [] as Record<string, unknown>[],
  marked: [] as Record<string, unknown>[],
  receipts: [] as Record<string, unknown>[],
  created: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester", is_admin: false }),
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        insert: (row: Record<string, unknown>) => {
          s.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "job-1", ...row }, error: null }) }) };
        },
        maybeSingle: async () =>
          table === "ai_generation_jobs"
            ? { data: s.job, error: null }
            : { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => {
      // verifiedAiClaims' read: select → eq → gte → order → limit, awaited.
      const read = {
        eq: () => read,
        gte: () => read,
        order: () => read,
        limit: async () => ({
          data: table === "card_ai_receipts" ? s.receipts.map((row) => ({ values: row.values })) : [],
          error: null,
        }),
      };
      return {
        insert: async (row: Record<string, unknown>) => {
          if (table === "card_ai_receipts") s.receipts.push(row);
          return { error: null };
        },
        select: () => read,
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") return { data: { job: s.job, step_key: s.stepKey }, error: null };
      if (name === "patch_job_step") return { data: s.job, error: null };
      if (name === "add_card_ai_fields") {
        s.marked.push(args);
        return { data: args.p_fields, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));
vi.mock("@/lib/cards/frame-reviews", async () => {
  const { frameComboKey } = await import("@/lib/cards/frame-reference-registry");
  const { FRAME_TEMPLATE_VALUES } = await import("@/types/card");
  // Every combo ticked, as the pinned payload suite does.
  const every = FRAME_TEMPLATE_VALUES.flatMap((template) =>
    ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template as never, colour)),
  );
  return { getVerifiedFrameKeys: async () => every };
});
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => null }));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => s.printing,
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: async () => ({ object: { cards: s.answers.shift() ?? [] } }),
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  designModel: () => "test/design",
  judgeModel: () => "test/judge",
}));
vi.mock("@/lib/ai/remix", () => ({
  generateRemixIdentity: async () => ({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
  }),
}));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", model: "test/image" });
  return {
    ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
    generatePlainImage: image,
    generateImageWithFallbacks: image,
    restyleImage: image,
  };
});
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({
    ok: true,
    publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/ai-0f3c.png`,
  }),
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
  spendCredits: async () => ({ ok: true, balance: 4, charged: true }),
  refundCredits: async () => undefined,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "made" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { createCardFillJob, createCardGenerationJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";

const designed = (over: Record<string, unknown> = {}) => ({
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rarity: "rare",
  color_identity: ["red"],
  rules_text: "Flying, haste",
  flavor_text: "Its allies learned to fly behind it.",
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  art_prompt: "A crimson dragon over a caldera at dawn.",
  ...over,
});

function job(kind: string, plan: Record<string, unknown>, stepKey: string, extra: Record<string, unknown> = {}) {
  s.stepKey = stepKey;
  s.job = { id: "job-1", owner_id: USER, kind, status: "generating", request: {}, deck_id: null, error: null, plan, steps: [{ key: stepKey, label: "Card", status: "running" }], ...extra };
}

beforeEach(() => {
  s.inserted = [];
  s.marked = [];
  s.receipts = [];
  s.created = [];
  s.answers = [];
});

/** The receipt the server keeps when it designs a job's cards. */
const jobReceipt = (...cards: Record<string, unknown>[]) =>
  s.receipts.push({ owner_id: USER, source: "job", values: cards });

describe("an AI job marks the card it wrote", () => {
  it("the single-card job: every text part the card has", async () => {
    jobReceipt(designed());
    job("card", { card: designed(), style: null, frame_template: "m15", deck_id: null }, "card:0");
    expect((await runNextJobStep("job-1", "card:0")).ok).toBe(true);
    expect(s.marked).toEqual([
      { p_card_id: "card-1", p_owner_id: USER, p_fields: ["cost", "flavor_text", "rules_text", "stats", "title", "type_line"] },
    ]);
  });

  it("the deck job: the same, a card with no flavour or stats without them", async () => {
    const card = designed({ title: "Riptide Calculus", cost: "{1}{U}", card_type: "instant", subtypes: [], color_identity: ["blue"], rules_text: "Draw a card.", flavor_text: null, power: null, toughness: null });
    jobReceipt(designed(), card);
    job("deck", { deck_title: "Deck", strategy: "", theme: "", style: null, format: "standard", cards: [card], roles: ["noncreature"], quantities: [1] }, "card:0", { deck_id: "deck-1" });
    expect((await runNextJobStep("job-1", "card:0")).ok).toBe(true);
    expect(s.marked).toEqual([{ p_card_id: "card-1", p_owner_id: USER, p_fields: ["cost", "rules_text", "title", "type_line"] }]);
  });

  it("the deck remix of a printing: the AI's name and flavour — never the printing's rules", async () => {
    s.printing = scryfallCardSchema.parse(structuredClone(printings["m21-239"]));
    const plan = { deck_title: "Deck", style: "watercolour", theme: null, skipped: 0, entries: [{ board: "main", quantity: 1, name: "Printing", card_id: null, scryfall_id: (s.printing as { id: string }).id }] };
    job("deck_remix", plan, "remix:0", { deck_id: "deck-1" });
    expect((await runNextJobStep("job-1", "remix:0")).ok).toBe(true);
    expect(s.created).toHaveLength(1);
    expect(s.marked).toEqual([{ p_card_id: "card-1", p_owner_id: USER, p_fields: ["flavor_text", "title"] }]);
  });

  it("a FORGED plan (a job row its owner inserted) marks nothing the server didn't design", async () => {
    // No receipt at all: the card is saved (the credit is the user's), unmarked.
    job("card", { card: designed({ title: "My Own Words" }), style: null, frame_template: "m15", deck_id: null }, "card:0");
    expect((await runNextJobStep("job-1", "card:0")).ok).toBe(true);
    expect(s.created).toHaveLength(1);
    expect(s.marked).toEqual([]);
    // A real design, its rules rewritten in the row: every part but those.
    jobReceipt(designed());
    job("card", { card: designed({ rules_text: "Hand-written rules." }), style: null, frame_template: "m15", deck_id: null }, "card:0");
    expect((await runNextJobStep("job-1", "card:0")).ok).toBe(true);
    expect(s.marked).toEqual([
      { p_card_id: "card-1", p_owner_id: USER, p_fields: ["cost", "flavor_text", "stats", "title", "type_line"] },
    ]);
  });

  it("the card job keeps its receipt when the server designs it", async () => {
    s.answers = [[designed()]];
    const out = await createCardGenerationJob({ theme: "dragons" });
    expect(out.ok).toBe(true);
    expect(s.receipts).toHaveLength(1);
    expect(s.receipts[0]).toMatchObject({ owner_id: USER, source: "job" });
    const [value] = s.receipts[0]!.values as Record<string, unknown>[];
    expect(value).toMatchObject({ title: "Emberwake Tyrant", rules_text: "Flying, haste", cost: "{3}{R}{R}" });
  });

  it("the card action's payload carries no provenance (the column is the server's)", async () => {
    job("card", { card: designed(), style: null, frame_template: "m15", deck_id: null }, "card:0");
    await runNextJobStep("job-1", "card:0");
    expect(s.created.every((payload) => !("ai_fields" in payload))).toBe(true);
  });
});

describe("the per-field fill keeps a receipt of what it wrote", () => {
  it("only the generated fields — the pinned ones are the maker's", async () => {
    s.answers = [[designed()], [designed()]];
    const out = await createCardFillJob({
      want: ["rules_text", "flavor_text"] as never,
      locked: { title: "Emberwake Tyrant", card_type: "creature", subtypes: ["Dragon"], color_identity: ["red"], cost: "{3}{R}{R}", power: "4", toughness: "4" } as never,
      steer: {},
      frame: undefined,
    });
    expect(out.ok).toBe(true);
    // Kept when the server PLANS the fill — never from the row at step time.
    const receipt = { owner_id: USER, source: "fill", values: [{ rules_text: "Flying, haste", flavor_text: "Its allies learned to fly behind it." }] };
    expect(s.receipts).toEqual([receipt]);
    const row = s.inserted.at(-1)!;
    job("card_fill", row.plan as Record<string, unknown>, "fill:0");
    s.job.steps = row.steps as never;
    expect((await runNextJobStep("job-1", "fill:0")).ok).toBe(true);
    expect(s.receipts).toEqual([receipt]);
    // A fill makes no card: nothing is marked until the creator saves.
    expect(s.marked).toEqual([]);
  });
});
