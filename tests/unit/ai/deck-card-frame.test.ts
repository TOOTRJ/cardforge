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
// box and height, a walker's rows, an Artifact Creature's artifact frame —
// wherever published in the card's colour; where the type's frame is not,
// NO template (never another border era or a showcase in a deck).
//
// The follow-up (owner 2026-10-14, resolveDeckCardFrame): a saga with a
// chapter line lands on the saga frame, a Snow card on the snow frames
// (where its landing is the plain m15 / m15land, or the artifact frame an
// Artifact Creature borrows), and a token on the frame a new creator token
// starts on (defaultTokenFrameIn: the full-art design at its text's height)
// — each only where verified in the card's colour.
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
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";

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
  ["artifact creature", card({ supertype: "Artifact", subtypes: ["Golem"], cost: "{4}", color_identity: ["colorless"], power: "3", toughness: "3" }), "creature", "m15artifact", "m15artifact"],
  ["coloured artifact creature", card({ supertype: "Artifact", subtypes: ["Golem"], cost: "{2}{R}", color_identity: ["red"], power: "3", toughness: "3" }), "creature", "m15artifact", "m15artifact"],
  ["enchantment artifact creature", card({ supertype: "Enchantment Artifact", subtypes: ["Golem"], cost: "{4}", color_identity: ["colorless"], power: "3", toughness: "3" }), "creature", "m15artifact", "m15nyx"],
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
  ["token (creature)", card({ card_type: "token", cost: "—", supertype: "Creature", subtypes: ["Soldier"], color_identity: ["white"], rules_text: null, power: "1", toughness: "1" }), "creature", "m20token", "m20token"],
  ["token (creature with text)", card({ card_type: "token", cost: "—", supertype: "Creature", subtypes: ["Soldier"], color_identity: ["white"], rules_text: "Vigilance", power: "1", toughness: "1" }), "creature", "m20tokentext", "m20tokentext"],
  ["token (Treasure)", card({ card_type: "token", cost: "—", supertype: "Artifact", subtypes: ["Treasure"], color_identity: ["colorless"], rules_text: "{T}, Sacrifice this artifact: Add one mana of any color." }), "noncreature", "m20tokenartifacttext", "m20tokenartifacttext"],
  ["planeswalker", card({ card_type: "planeswalker", supertype: "Legendary", subtypes: ["Veyra"], color_identity: ["blue"], rules_text: "+1: Draw a card.\n-3: Return target creature to its owner's hand.", loyalty: "4" }), "noncreature", "m15pw", "m15pw"],
  ["saga (enchantment — Saga)", card({ card_type: "enchantment", subtypes: ["Saga"], color_identity: ["green"], rules_text: "I — Draw a card.\nII, III — Create a 2/2 Bear." }), "noncreature", "saga", "saga"],
  ["saga with no chapter line", card({ card_type: "enchantment", subtypes: ["Saga"], color_identity: ["green"], rules_text: "Draw a card, then create a 2/2 Bear." }), "noncreature", "m15", "m15"],
  ["token (artifact creature, tall text)", card({ card_type: "token", cost: "—", supertype: "Artifact Creature", subtypes: ["Construct"], color_identity: ["colorless"], rules_text: "This creature gets +1/+1 for each artifact you control.\nWhenever another artifact you control enters, put a +1/+1 counter on target creature you control. Then if you control five or more artifacts, draw a card.\nWhen this creature dies, create a Treasure token.", power: "0", toughness: "0" }), "creature", "m20tokenartifacttall", "m20tokenartifacttall"],
  ["snow creature", card({ supertype: "Snow", subtypes: ["Troll"], color_identity: ["green"], power: "3", toughness: "3" }), "creature", "m15snow", "m15snow"],
  ["snow instant", card({ card_type: "instant", supertype: "Snow", color_identity: ["blue"], rules_text: "Counter target spell unless its controller pays {S}." }), "removal", "m15snow", "m15snow"],
  ["snow land", card({ card_type: "land", cost: "—", supertype: "Snow", color_identity: ["blue"], rules_text: "{T}: Add {U}." }), "land", "m15snowland", "m15snowland"],
  ["snow basic-like land (Basic Snow Land — Island)", card({ title: "Snow-Covered Island", card_type: "land", cost: "—", supertype: "Basic Snow", subtypes: ["Island"], color_identity: ["blue"], rules_text: "({T}: Add {U}.)" }), "land", "m15snowland", "m15snowland"],
  ["snow artifact creature", card({ supertype: "Snow Artifact", subtypes: ["Golem"], cost: "{4}", color_identity: ["colorless"], power: "3", toughness: "3" }), "creature", "m15snow", "m15snow"],
  ["snow artifact (the artifact frame: the snow frame doesn't dress an artifact)", card({ card_type: "artifact", cost: "{3}", supertype: "Snow", color_identity: ["colorless"], rules_text: "{T}: Add {C}." }), "noncreature", "m15artifact", "m15artifact"],
  ["snow enchantment (an enchantment dress keeps its frame)", card({ card_type: "enchantment", supertype: "Snow", color_identity: ["white"], rules_text: "Creatures you control get +1/+1." }), "noncreature", "m15snow", "m15nyx"],
  ["snow Vehicle (a subtype dress keeps its frame)", card({ card_type: "artifact", cost: "{3}", supertype: "Snow", color_identity: ["colorless"], subtypes: ["Vehicle"], rules_text: "Crew 2", power: "3", toughness: "3" }), "noncreature", "m15vehicle", "m15vehicle"],
  ["snow token (the token's own frame)", card({ card_type: "token", cost: "—", supertype: "Snow Creature", subtypes: ["Elemental"], color_identity: ["blue"], rules_text: null, power: "1", toughness: "1" }), "creature", "m20token", "m20token"],
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

  it("a commander is always Legendary — added to the words the design gave it (a Snow commander saved non-legendary before)", async () => {
    s.verified = SEED;
    const snow = await deckStep(card({ supertype: "Snow", subtypes: ["Troll"], color_identity: ["green"], power: "3", toughness: "3" }), "commander");
    expect(snow!.supertype).toBe("Legendary Snow");
    const plain = await deckStep(card({ subtypes: ["Dragon"], power: "4", toughness: "4" }), "commander");
    expect(plain!.supertype).toBe("Legendary");
    const already = await deckStep(card({ supertype: "Legendary", subtypes: ["Elf"], power: "2", toughness: "2" }), "commander");
    expect(already!.supertype).toBe("Legendary");
    // A non-commander keeps the design's words untouched.
    const notCommander = await deckStep(card({ supertype: "Snow", subtypes: ["Troll"], color_identity: ["green"], power: "3", toughness: "3" }), "creature");
    expect(notCommander!.supertype).toBe("Snow");
  });

  it("saves no template where nothing published fits (the verified read failed): the default frame, as before", async () => {
    s.verified = [];
    const saved = await deckStep(KINDS[10]![1], "land");
    expect(JSON.parse(JSON.stringify(saved))).not.toHaveProperty("frame_style");
  });

  it("where the type's M15 frame is unpublished in the card's colour: NO template — never another era or a showcase (owner 2026-10-14)", async () => {
    // The 1997 / 2003 land frames and full-art lands stay ticked in red;
    // only m15land/r is taken away.
    s.verified = SEED.filter((key) => key !== "m15land/r");
    const land = KINDS.find(([kind]) => kind === "land")![1];
    const saved = await deckStep(land, "land");
    expect(JSON.parse(JSON.stringify(saved))).not.toHaveProperty("frame_style");
    // …while the single-card job's resolver (the default fallback) still
    // degrades to a random published frame of the type, as on main.
    const single = resolveGeneratedFrame({
      cardType: "land",
      requested: "m15land",
      colorIdentity: ["red"],
      verifiedKeys: new Set(s.verified),
      face: { cardType: "land", title: land.title, rulesText: land.rules_text, subtypes: [] },
      random: () => 0,
    });
    expect(single).not.toBeNull();
    expect(single).not.toBe("m15land");
  });

  // The #568 follow-up (owner 2026-10-14): a saga, a snow card and a token
  // follow their own looks in a deck only where VERIFIED in the card's
  // colour — else the landing #568 gave them — and the single-card job,
  // which asks for the frame its maker named, is unchanged.
  it.each([
    ["saga (enchantment — Saga)", "saga/g", "m15"],
    ["snow creature", "m15snow/g", "m15"],
    ["snow land", "m15snowland/u", "m15land"],
    ["snow artifact creature", "m15snow/c", "m15artifact"],
    ["token (creature)", "m20token/w", "m15token"],
    ["token (creature with text)", "m20tokentext/w", "m15tokentext"],
    ["token (Treasure)", "m20tokenartifacttext/c", "m15tokenartifacttext"],
  ])("%s: with %s unticked, the standard's landing (%s), as #568 saved it", async (kind, unticked, landing) => {
    s.verified = SEED.filter((key) => key !== unticked);
    const [, designed, role] = KINDS.find(([name]) => name === kind)!;
    const saved = await deckStep(designed, role);
    expect((saved!.frame_style as { template?: string }).template).toBe(landing);
  });

  it.each([
    ["saga (enchantment — Saga)", "m15", "m15"],
    ["snow creature", "m15", "m15"],
    ["snow land", "m15land", "m15land"],
    ["token (creature)", "m15token", "m15token"],
    ["token (creature with text)", "m15token", "m15tokentext"],
    ["token (Treasure)", "m15token", "m15tokenartifacttext"],
  ])("the single-card job asked for %s's %s lands where it did (%s): the deck's looks are the deck's", (kind, requested, landing) => {
    const [, designed] = KINDS.find(([name]) => name === kind)!;
    const single = resolveGeneratedFrame({
      cardType: designed.card_type as never,
      requested: requested as FrameTemplate,
      colorIdentity: designed.color_identity as never,
      verifiedKeys: new Set(SEED),
      face: {
        cardType: designed.card_type,
        supertype: designed.supertype,
        subtypes: designed.subtypes,
        title: designed.title,
        rulesText: designed.rules_text,
        flavorText: designed.flavor_text,
        power: designed.power,
        toughness: designed.toughness,
      },
      random: () => 0,
    });
    expect(single).toBe(landing);
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
