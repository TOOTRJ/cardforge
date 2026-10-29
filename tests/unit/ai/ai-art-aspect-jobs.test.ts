import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { artShapeForFace, type ArtShape } from "@/lib/ai/art-aspect";
import { fillArtFrameOf } from "@/lib/ai/card-fill-shared";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.48b — the WIRING: each AI path paints its picture in the shape of
// the art window of the frame the card is on, decided BEFORE the art.
//
//   single card   plan.frame_template (the user's pick or the random one)
//   per-field fill  the frame it picked with the type, else the creator's
//                 current frame (`artFrame`), read for the shape alone
//   deck card     the frame the step saves the card on (resolveDeckCardFrame,
//                 owner 2026-10-14) — a retried step reads the saved row
//   deck remix    the text-to-image fallback: the frame the remix saves on
//
// Stubbed: Supabase, the credit wrapper, the designers, the remix identity,
// the Scryfall client, the card actions and the image generators (whose
// SHAPE argument is captured). No picture is generated, no gateway called.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  job: null as unknown as Record<string, unknown>,
  stepKey: "card:0",
  /** What a `cards` read answers (a retried step reads its card back). */
  cardRow: null as Record<string, unknown> | null,
  inserted: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  created: [] as Record<string, unknown>[],
  /** create / image, in the order they ran. */
  order: [] as string[],
  shapes: [] as unknown[],
  /** Each image call's options (its wait). */
  imageOptions: [] as unknown[],
  fillAnswer: null as unknown,
  printing: null as unknown,
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
            : table === "cards"
              ? { data: s.cardRow, error: null }
              : { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null },
        then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") return { data: { job: s.job, step_key: s.stepKey }, error: null };
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/ai/credited-step", () => ({
  withCreditedStep: async (_u: string, _j: string, _a: number, _r: string, _s: unknown, body: () => Promise<unknown>) => body(),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => null }));
vi.mock("@/lib/ai/card-fill", () => ({ designCardFill: async () => s.fillAnswer }));
vi.mock("@/lib/ai/remix", () => ({
  generateRemixIdentity: async () => ({ title: "Remixed Name", flavor_text: "New flavour.", art_instruction: "A painted scene." }),
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => s.printing,
}));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async (_prompt: unknown, shape: unknown, options?: unknown) => {
    s.order.push("image");
    s.shapes.push(shape);
    s.imageOptions.push(options);
    return { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", promptIndex: 0 };
  };
  return {
    ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
    generatePlainImage: image,
    generateImageWithFallbacks: image,
  };
});
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({ ok: true, publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.jpg` }),
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.order.push("create");
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "made" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { createCardFillJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { CARD_STEP_IMAGE_BUDGET_MS } from "@/lib/ai/image-gen";
import { scryfallCardSchema } from "@/lib/scryfall/client";

const EVERY = FRAME_TEMPLATE_VALUES.flatMap((template) =>
  ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template as FrameTemplate, colour)),
);

const designed = (over: Record<string, unknown> = {}) => ({
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rarity: "rare",
  color_identity: ["red"],
  rules_text: "Flying, haste",
  flavor_text: null,
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  art_prompt: "A dragon over a burning city.",
  ...over,
});

const size = (shape: unknown) => {
  const { width, height } = shape as ArtShape;
  return `${width}x${height}`;
};
const sizeOf = (template: string | null, colorIdentity: string[] = ["red"], cardType = "creature") =>
  size(artShapeForFace({ template, colorIdentity, cardType }));

function job(kind: string, plan: Record<string, unknown>, stepKey: string, step: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  s.stepKey = stepKey;
  s.job = { id: "job-1", owner_id: USER, kind, status: "generating", request: {}, deck_id: null, error: null, plan, steps: [{ key: stepKey, label: "Card", status: "running", ...step }], ...extra };
}

async function run() {
  const result = await runNextJobStep("job-1", s.stepKey);
  expect(result.ok).toBe(true);
  expect(s.patched.at(-1)?.status).toBe("done");
}

beforeEach(() => {
  s.verified = EVERY;
  s.cardRow = null;
  s.inserted = [];
  s.patched = [];
  s.created = [];
  s.order = [];
  s.shapes = [];
  s.imageOptions = [];
  s.fillAnswer = null;
  s.printing = null;
  vi.restoreAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0);
});

describe("the single-card job paints for plan.frame_template", () => {
  it.each(["m15", "m15pw", "m15borderless", "saga", "m20token", null])("%s", async (frame) => {
    job("card", { card: designed(), style: null, frame_template: frame, deck_id: null }, "card:0");
    await run();
    expect(s.shapes).toHaveLength(1);
    expect(size(s.shapes[0])).toBe(sizeOf(frame));
    expect(s.order).toEqual(["create", "image"]);
  });

  it("the picture waits the card step's budget: the card is created, attached and baked in the same 180 s", async () => {
    job("card", { card: designed(), style: null, frame_template: "m15", deck_id: null }, "card:0");
    await run();
    expect(s.imageOptions[0]).toEqual({ budgetMs: CARD_STEP_IMAGE_BUDGET_MS });
  });

  it("a colourless card on M15 paints for the see-through master's window", async () => {
    job("card", { card: designed({ color_identity: ["colorless"], cost: "{7}" }), style: null, frame_template: "m15", deck_id: null }, "card:0");
    await run();
    expect(size(s.shapes[0])).toBe(sizeOf("m15", ["colorless"]));
  });
});

describe("the deck job picks each card's frame FIRST, then paints for it (owner round 14b)", () => {
  const deckStep = async (card: Record<string, unknown>, step: Record<string, unknown> = {}) => {
    job(
      "deck",
      { deck_title: "Deck", strategy: "Go wide.", theme: "embers", style: null, format: "commander", cards: [card], roles: ["creature"], quantities: [1] },
      "card:0",
      step,
      { deck_id: "deck-1" },
    );
    await run();
  };

  it.each([
    ["a token on the full-art design", designed({ card_type: "token", cost: "—", supertype: "Creature", subtypes: ["Soldier"], color_identity: ["white"], rules_text: null, power: "1", toughness: "1" })],
    ["a saga", designed({ card_type: "enchantment", subtypes: ["Saga"], color_identity: ["green"], rules_text: "I — Draw a card.\nII, III — Create a 2/2 Bear.", power: null, toughness: null })],
    ["a walker", designed({ card_type: "planeswalker", supertype: "Legendary", subtypes: ["Veyra"], color_identity: ["blue"], rules_text: "+1: Draw a card.", loyalty: "4", power: null, toughness: null })],
    ["a creature", designed()],
  ])("%s: saved on its frame, then painted in that frame's window", async (_name, card) => {
    await deckStep(card);
    expect(s.order).toEqual(["create", "image"]);
    const template = (s.created[0]!.frame_style as { template?: string } | undefined)?.template ?? null;
    expect(template, "the step saves a frame").not.toBeNull();
    expect(size(s.shapes[0])).toBe(
      size(artShapeForFace({ template, colorIdentity: card.color_identity as string[], cardType: card.card_type as string })),
    );
  });

  it("the token's portrait window — not the 4:3 every picture was asked for", async () => {
    await deckStep(designed({ card_type: "token", cost: "—", supertype: "Creature", subtypes: ["Soldier"], color_identity: ["white"], rules_text: null, power: "1", toughness: "1" }));
    expect((s.created[0]!.frame_style as { template: string }).template).toBe("m20token");
    expect(s.shapes[0]).toMatchObject({ width: 864, height: 1184 });
  });

  it("a retried step whose card exists paints for the frame the card was SAVED on (read back, never re-framed)", async () => {
    s.cardRow = { frame_style: { template: "m15borderless" }, color_identity: ["red"], card_type: "creature", supertype: null, cost: "{3}{R}{R}" };
    await deckStep(designed(), { card_id: "card-9", attempts: 1 });
    expect(s.created).toHaveLength(0);
    expect(size(s.shapes[0])).toBe(sizeOf("m15borderless"));
  });

  it("…and a row that can't be read paints for the card as designed (its default frame)", async () => {
    s.cardRow = null;
    await deckStep(designed(), { card_id: "card-9", attempts: 1 });
    expect(size(s.shapes[0])).toBe(sizeOf(null));
  });
});

describe("the per-field fill paints for the creator's frame", () => {
  const fillPlan = () => s.inserted.at(-1)!.plan as Record<string, unknown>;

  it("an art-only fill: the creator's frame travels as artFrame, the plan keeps it for the shape, the step paints it", async () => {
    s.fillAnswer = { fields: {}, art_prompt: "A soldier at dawn." };
    const out = await createCardFillJob({
      want: ["art"],
      locked: { title: "Dawn Soldier", card_type: "token", color_identity: ["white"], supertype: "Creature" },
      steer: {},
      artFrame: "m20token",
    });
    expect(out.ok).toBe(true);
    expect(fillPlan().art_face).toEqual({ template: "m20token", color_identity: ["white"], card_type: "token", supertype: "Creature", cost: null });
    // The frame is never SET by it: the fill hands back no frame.
    expect(fillPlan().frame_template).toBeNull();
    job("card_fill", fillPlan(), "fill:0");
    await run();
    expect(s.shapes[0]).toMatchObject({ width: 864, height: 1184 });
    expect((s.patched.at(-1)!.fill as Record<string, unknown>).frame_template).toBeNull();
  });

  it("a fill that writes the type paints for the frame it picked with it, whatever artFrame says", async () => {
    s.fillAnswer = { fields: { card_type: "creature", color_identity: ["red"], title: "Emberwake Tyrant", subtypes: ["Dragon"] }, art_prompt: "A dragon." };
    const out = await createCardFillJob({
      want: ["card_type", "color_identity", "title", "art"],
      locked: {},
      steer: { card_type: "creature" },
      frame: "m15borderless",
      artFrame: "saga",
    });
    expect(out.ok).toBe(true);
    expect(fillPlan().frame_template).toBe("m15borderless");
    expect((fillPlan().art_face as { template: string }).template).toBe("m15borderless");
    job("card_fill", fillPlan(), "fill:0");
    await run();
    expect(size(s.shapes[0])).toBe(sizeOf("m15borderless"));
  });

  it("a fill without the art stores no art_face (the plan is what it was)", async () => {
    s.fillAnswer = { fields: { title: "Emberwake Tyrant" }, art_prompt: "A dragon." };
    await createCardFillJob({ want: ["title"], locked: { card_type: "creature" }, steer: {}, artFrame: "m15pw" });
    expect(fillPlan()).not.toHaveProperty("art_face");
  });

  it("a plan made before art_face paints for the frame it resolved (the default when none)", async () => {
    job("card_fill", { want: ["art"], fields: {}, art_prompt: "A scene.", style: null, frame_template: null, deck_id: null }, "fill:0");
    await run();
    expect(s.shapes).toHaveLength(1);
  });

  it("the dialog sends the creator's frame only for an art fill that keeps the type, and only a known template", () => {
    expect(fillArtFrameOf(["art"], "m20token")).toBe("m20token");
    expect(fillArtFrameOf(["art", "title"], "saga")).toBe("saga");
    expect(fillArtFrameOf(["title"], "saga")).toBeUndefined();
    expect(fillArtFrameOf(["art", "card_type"], "saga")).toBeUndefined();
    expect(fillArtFrameOf(["art"], "regular")).toBeUndefined();
    expect(fillArtFrameOf(["art"], "")).toBeUndefined();
    expect(fillArtFrameOf(["art"], undefined)).toBeUndefined();
  });
});

describe("the deck remix's text-to-image fallback paints for the frame the remix saves on", () => {
  const remix = async () => {
    s.printing = scryfallCardSchema.parse(structuredClone(printings["lea-255"]));
    job(
      "deck_remix",
      { deck_title: "Deck", style: "watercolour", theme: null, skipped: 0, entries: [{ board: "main", quantity: 1, name: "Juggernaut", card_id: null, scryfall_id: (s.printing as { id: string }).id }] },
      "remix:0",
      {},
      { deck_id: "deck-1" },
    );
    await run();
  };

  it("on the printing's own frame once verified (Juggernaut LEA #255 on the 1993 frame)", async () => {
    s.verified = [frameComboKey("agclassic", "c"), frameComboKey("m15artifact", "c")];
    await remix();
    expect((s.created[0]!.frame_style as { template: string }).template).toBe("agclassic");
    expect(s.order).toEqual(["image", "create"]);
    expect(size(s.shapes[0])).toBe(sizeOf("agclassic", ["colorless"]));
    expect(s.shapes[0]).toMatchObject({ width: 1136, height: 912 });
  });

  it("…and on M15's artifact frame while it isn't", async () => {
    s.verified = [frameComboKey("m15artifact", "c"), frameComboKey("m15", "c")];
    await remix();
    expect((s.created[0]!.frame_style as { template: string }).template).toBe("m15artifact");
    expect(size(s.shapes[0])).toBe(sizeOf("m15artifact", ["colorless"], "artifact"));
  });
});
