import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// AN AI DECK CARD SAVES WITH ITS FRAME (owner 2026-10-14).
//
// The deck job's card step saved no frame template, so every AI deck card
// drew the default (m15 creature) frame — a land and an artifact too: a
// colourless land showed the see-through m15/c, not m15land/c. The step now
// lands each card as a single generated card lands: resolveGeneratedFrame,
// the same verified set, asked for the card type's M15 standard
// (deckCardFrameRequest) — subtype and enchantment dresses, a token's text
// box and height, a walker's rows, wherever published in the card's colour.
//
// Two verified sets: `supabase/seed.sql` (the mirror of production's ticks,
// snapshotted 2026-10-13 — production may be ahead of it) and EVERY combo
// ticked (what each card lands on once its dress is verified).
//
// Stubbed: Supabase, the ledger, the image generators and the card actions
// (captured). No generation is run.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  job: null as unknown as Record<string, unknown>,
  spend: vi.fn(),
  refund: vi.fn(),
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
        maybeSingle: async () =>
          table === "ai_generation_jobs"
            ? { data: s.job, error: null }
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
      if (name === "claim_job_step") return { data: { job: s.job, step_key: "card:0" }, error: null };
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => null }));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
  return { ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()), generatePlainImage: image, generateImageWithFallbacks: image, restyleImage: image };
});
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({ ok: true, publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png` }),
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "made" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";

/** production's ticks as `supabase/seed.sql` mirrors them. */
function seedVerified(): string[] {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = sql.split("-- frame_reviews:begin")[1]!.split("-- frame_reviews:end")[0]!;
  const [whole, partial] = block.split("-- Partially verified");
  const templates = [...whole!.matchAll(/^\s+'([a-z0-9]+)',?$/gm)].map((match) => match[1]!);
  const keys = templates.flatMap((template) => ["w", "u", "b", "r", "g", "c", "m"].map((colour) => `${template}/${colour}`));
  for (const match of partial!.matchAll(/\('([a-z0-9]+)', '([a-z])', true/g)) keys.push(`${match[1]}/${match[2]}`);
  return keys;
}
const SEED = seedVerified();
const EVERY = FRAME_TEMPLATE_VALUES.flatMap((template) => ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template as FrameTemplate, colour)));

const card = (over: Record<string, unknown>) => ({
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: [] as string[],
  rarity: "rare",
  color_identity: ["red"],
  rules_text: "Flying, haste",
  flavor_text: null,
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  art_prompt: "A scene.",
  ...over,
});
const STATION_LINE = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 9+.)";
const PLANET_LINE = "Station (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)";

/** [kind, the designed card, its role, the template saved with seed.sql's ticks, with every combo ticked]. */
const KINDS: Array<[string, ReturnType<typeof card>, string, string, string]> = [
  ["creature", card({ subtypes: ["Dragon"], power: "4", toughness: "4" }), "creature", "m15", "m15"],
  ["commander (legendary creature)", card({ subtypes: ["Dragon"], power: "4", toughness: "4" }), "commander", "m15", "m15"],
  ["instant", card({ card_type: "instant", color_identity: ["blue"], rules_text: "Draw two cards." }), "removal", "m15", "m15"],
  ["sorcery", card({ card_type: "sorcery", color_identity: ["black"], rules_text: "Destroy target creature." }), "removal", "m15", "m15"],
  ["artifact", card({ card_type: "artifact", cost: "{2}", color_identity: ["colorless"], subtypes: ["Equipment"], rules_text: "Equipped creature gets +2/+1.\nEquip {2}" }), "noncreature", "m15artifact", "m15artifact"],
  ["coloured artifact", card({ card_type: "artifact", cost: "{1}{U}", color_identity: ["blue"], rules_text: "{T}: Scry 1." }), "noncreature", "m15artifact", "m15artifact"],
  ["artifact creature", card({ supertype: "Artifact", subtypes: ["Golem"], cost: "{4}", color_identity: ["colorless"], power: "3", toughness: "3" }), "creature", "m15", "m15"],
  ["enchantment", card({ card_type: "enchantment", color_identity: ["white"], rules_text: "Creatures you control get +1/+1." }), "noncreature", "m15", "m15nyx"],
  ["Aura", card({ card_type: "enchantment", subtypes: ["Aura"], color_identity: ["white"], rules_text: "Enchant creature\nEnchanted creature gets +2/+2." }), "noncreature", "m15", "m15nyx"],
  ["enchantment creature", card({ supertype: "Enchantment", subtypes: ["Spirit"], color_identity: ["white"], power: "2", toughness: "1" }), "creature", "m15", "m15nyx"],
  ["land", card({ card_type: "land", cost: "—", color_identity: ["red"], rules_text: "{T}: Add {R}." }), "land", "m15land", "m15land"],
  ["colourless land", card({ card_type: "land", cost: "—", color_identity: ["colorless"], rules_text: "{T}: Add {C}." }), "land", "m15land", "m15land"],
  ["two-colour land", card({ card_type: "land", cost: "—", color_identity: ["black", "green"], rules_text: "{T}: Add {B} or {G}." }), "land", "m15land", "m15land"],
  ["basic-like land (Basic Land — Forest)", card({ title: "Forest", card_type: "land", cost: "—", supertype: "Basic", subtypes: ["Forest"], color_identity: ["green"], rules_text: "({T}: Add {G}.)" }), "land", "m15land", "m15land"],
  ["colourless creature", card({ cost: "{7}", color_identity: ["colorless"], subtypes: ["Eldrazi"], power: "7", toughness: "7" }), "creature", "m15", "m15"],
  ["multicolour creature", card({ cost: "{B}{G}", color_identity: ["black", "green"], subtypes: ["Gorgon"], power: "2", toughness: "2" }), "commander", "m15", "m15"],
  ["Vehicle", card({ card_type: "artifact", cost: "{3}", color_identity: ["colorless"], subtypes: ["Vehicle"], rules_text: "Flying\nCrew 2", power: "3", toughness: "3" }), "noncreature", "m15vehicle", "m15vehicle"],
  ["Spacecraft with a tier", card({ card_type: "artifact", cost: "{3}", color_identity: ["colorless"], subtypes: ["Spacecraft"], rules_text: `${STATION_LINE}\n9+ | Flying`, power: "4", toughness: "4" }), "noncreature", "m15artifact", "m15station"],
  ["Spacecraft without a tier", card({ card_type: "artifact", cost: "{3}", color_identity: ["colorless"], subtypes: ["Spacecraft"], rules_text: "Flying", power: "4", toughness: "4" }), "noncreature", "m15artifact", "m15artifact"],
  ["Planet with a tier", card({ card_type: "land", cost: "—", color_identity: ["colorless"], subtypes: ["Planet"], rules_text: `{T}: Add {C}.\n${PLANET_LINE}\n6+ | {T}: Add {C}{C}.` }), "land", "m15land", "m15stationland"],
  ["token (creature)", card({ card_type: "token", cost: "—", supertype: "Creature", subtypes: ["Soldier"], color_identity: ["white"], rules_text: null, power: "1", toughness: "1" }), "creature", "m15token", "m15token"],
  ["token (creature with text)", card({ card_type: "token", cost: "—", supertype: "Creature", subtypes: ["Soldier"], color_identity: ["white"], rules_text: "Vigilance", power: "1", toughness: "1" }), "creature", "m15tokentext", "m15tokentext"],
  ["token (Treasure)", card({ card_type: "token", cost: "—", supertype: "Artifact", subtypes: ["Treasure"], color_identity: ["colorless"], rules_text: "{T}, Sacrifice this artifact: Add one mana of any color." }), "noncreature", "m15tokenartifacttext", "m15tokenartifacttext"],
  ["planeswalker", card({ card_type: "planeswalker", supertype: "Legendary", subtypes: ["Veyra"], color_identity: ["blue"], rules_text: "+1: Draw a card.\n-3: Return target creature to its owner's hand.", loyalty: "4" }), "noncreature", "m15pw", "m15pw"],
  ["saga (enchantment — Saga)", card({ card_type: "enchantment", subtypes: ["Saga"], color_identity: ["green"], rules_text: "I — Draw a card.\nII, III — Create a 2/2 Bear." }), "noncreature", "m15", "m15"],
  ["battle", card({ card_type: "battle", subtypes: ["Siege"], color_identity: ["red"], rules_text: "When this enters, it deals 2 damage to any target.", defense: "5" }), "noncreature", "none", "battle"],
];

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0);
});

async function deckStep(designed: ReturnType<typeof card>, role: string, step: Record<string, unknown> = {}) {
  s.job = {
    id: "job-1", owner_id: USER, kind: "deck", status: "generating", request: {}, deck_id: "deck-1", error: null,
    plan: { deck_title: "Deck", strategy: "Go wide.", theme: "embers", style: null, format: "commander", cards: [designed], roles: [role], quantities: [1] },
    steps: [{ key: "card:0", label: "Card", status: "running", ...step }],
  };
  const result = await runNextJobStep("job-1", "card:0");
  expect(result.ok).toBe(true);
  return s.created.at(-1) as Record<string, unknown> | undefined;
}

describe("an AI deck card saves with its frame", () => {
  it.each(KINDS)("%s", async (_kind, designed, role, withSeed, withEvery) => {
    s.verified = SEED;
    const seeded = await deckStep(designed, role);
    expect((seeded!.frame_style as { template?: string } | undefined)?.template ?? "none").toBe(withSeed);
    s.verified = EVERY;
    const every = await deckStep(designed, role);
    expect((every!.frame_style as { template?: string } | undefined)?.template ?? "none").toBe(withEvery);
    // One credit a card, as before.
    expect(s.spend.mock.calls.map((call) => call[0])).toEqual([1, 1]);
  });

  it("saves no template where nothing published fits (the verified read failed): the default frame, as before", async () => {
    s.verified = [];
    const saved = await deckStep(KINDS[10]![1], "land");
    expect(JSON.parse(JSON.stringify(saved))).not.toHaveProperty("frame_style");
  });

  it("a station frame saves its rows, as the single-card job does", async () => {
    s.verified = EVERY;
    const saved = await deckStep(KINDS.find(([kind]) => kind === "Spacecraft with a tier")![1], "noncreature");
    expect(saved!.frame_style).toEqual({ template: "m15station" });
    expect(saved).toHaveProperty("face_content");
  });

  it("a retried step whose card exists creates nothing and re-frames nothing", async () => {
    s.verified = EVERY;
    const saved = await deckStep(KINDS[10]![1], "land", { card_id: "card-9" });
    expect(saved).toBeUndefined();
  });
});
