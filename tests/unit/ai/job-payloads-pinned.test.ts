import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// WHAT THE AI JOBS SAVE, pinned to origin/main (TODO 4.27a, PR 3).
//
// PR 3 taught the design engine, the per-field fill and the job saves about
// Spacecraft and Planets. Every OTHER card must leave those paths exactly as
// it did: this file drives the real jobs (plan and step) over a matrix of
// cards that are not station cards and compares, byte for byte, what
// createCardAction is handed, what the fill hands the creator, the plan a
// job stores and the credits it reserves with `fixtures/job-payloads-main.json`
// — recorded by this same file on `origin/main`'s lib/ (re-recorded on a53e4b51 after #556 reordered the random frame pool: only `lastFrame` of the random-frame cases moved; the three "station ·" fills ADDED on 97481a22's lib/ — main after #557 — when a fill whose empty tier comes back empty began to be refused, every existing entry unchanged; the land card's random-frame `lastFrame` moved to `expeditionlandbfz` with TODO 4.11 wave 1 — a new template at the land pool's end, every combo ticked here — nothing else), which is
// why it imports nothing PR 3 added.
//
// `JOB_PAYLOADS_UPDATE=1` rewrites the fixture. Do that only with the
// reason in the PR: a changed payload is changed saved data.
//
// Stubbed: Supabase, the ledger helpers (the REAL credit wrapper runs over
// them), the model (`ai` generateObject — no generation is run), the image
// generators, the Scryfall client and the two card actions (captured).
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  printing: null as unknown,
  source: null as unknown,
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  spend: vi.fn(),
  refund: vi.fn(),
  job: null as unknown as Record<string, unknown>,
  stepKey: "card:0",
  /** The model's answers, one per generateObject call. */
  answers: [] as unknown[][],
  prompts: [] as string[],
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
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => null }));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => s.printing,
}));
vi.mock("@/lib/cards/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cards/queries")>()),
  getCardById: async () => s.source,
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: async (args: { prompt: string }) => {
    s.prompts.push(args.prompt);
    return { object: { cards: s.answers.shift() ?? [] } };
  },
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  designModel: () => "test/design",
  judgeModel: () => "test/judge",
}));
vi.mock("@/lib/ai/remix", () => ({
  generateRemixIdentity: async (input: { secondHalf?: unknown }) => ({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
    ...(input.secondHalf ? { second_title: "Remixed Page", second_flavor_text: null, second_art_instruction: "The other side." } : {}),
  }),
}));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
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
    publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png`,
  }),
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

import { createCardFillJob, createCardGenerationJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";

const FIXTURE = join(process.cwd(), "tests/unit/ai/fixtures/job-payloads-main.json");
const UPDATE = process.env.JOB_PAYLOADS_UPDATE === "1";
const recorded: Record<string, unknown> = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>) : {};
const fresh: Record<string, unknown> = {};

/** The records this branch changes on purpose, as main's record → the
 *  new one. TODO 4.26: a split printing's halves each print their own
 *  colour — Fire // Ice (DMR #215) saves Ice's blue as its second half's
 *  colour and Fire's red as its FIRST half's frame colour
 *  (frame_style.firstPartColor). Its `color_identity` is main's — the
 *  whole card's, "multicolor" — since owner decision M2 (2026-10-22: the
 *  first cut saved Fire's red there, which reverted). */
const MEANT_CHANGES: Record<string, (record: unknown) => unknown> = {
  "remix printing · dmr-215": (record) => {
    const saved = (record as { saved: Record<string, unknown> }).saved;
    (saved.frame_style as Record<string, unknown>).firstPartColor = ["red"];
    (saved.back_face as Record<string, unknown>).color_identity = ["blue"];
    return record;
  },
  // TODO 4.26, the adventure's page (feat/adventure-part-colours): an
  // adventure printing names its spell's colour from the spell's cost, as a
  // Prepare / split printing does — Bonecrusher Giant's Stomp {1}{R} red.
  // The page draws only where it differs from the creature's (here it
  // doesn't: the bake is unchanged).
  "remix printing · eld-115": (record) => {
    const saved = (record as { saved: Record<string, unknown> }).saved;
    (saved.back_face as Record<string, unknown>).color_identity = ["red"];
    return record;
  },
};

/** Compare with main's record (or record it). JSON round-trip: what a
 *  payload is on the wire — an `undefined` key is no key. */
function pinned(name: string, value: unknown) {
  const wire = JSON.parse(JSON.stringify(value)) as unknown;
  fresh[name] = wire;
  if (UPDATE) return;
  expect(recorded, `no record for "${name}" — run with JOB_PAYLOADS_UPDATE=1 on main's lib/`).toHaveProperty([name]);
  const changed = MEANT_CHANGES[name];
  if (changed) {
    // A change this branch MEANS, laid over main's record (equal, not
    // byte for byte: the keys it adds land where the wire puts them).
    expect(wire, name).toEqual(changed(structuredClone(recorded[name])));
    return;
  }
  expect(wire, name).toEqual(recorded[name]);
  // …and not merely equal: the same keys in the same order, the same bytes.
  expect(JSON.stringify(wire), name).toBe(JSON.stringify(recorded[name]));
}

/** Every template in every colour ticked — station frames included, so a
 *  card that is no station card is shown never to be drawn onto one. */
const EVERY = FRAME_TEMPLATE_VALUES.flatMap((template) => ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template as FrameTemplate, colour)));

const designed = (over: Record<string, unknown> = {}) => ({
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rarity: "rare",
  color_identity: ["red"],
  rules_text: "Flying, haste\nWhenever Emberwake Tyrant attacks, it deals 2 damage to each player.",
  flavor_text: "Its allies learned to fly behind it.",
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  art_prompt: "A crimson dragon over a caldera at dawn.",
  ...over,
});

/** A Spacecraft the model designs, for the station fills that are not
 *  refused (the text spelled out: this file imports nothing PR 3 added). */
const SHIP_LINE =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 9+.)";
const SHIP = designed({
  title: "Halcyon Driftbarge",
  cost: "{2}{U}",
  card_type: "artifact",
  subtypes: ["Spacecraft"],
  color_identity: ["blue"],
  rules_text: `Rewritten top.\n${SHIP_LINE}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying, vigilance`,
  flavor_text: "It drifts where the light is coldest.",
  power: "4",
  toughness: "5",
  art_prompt: "A teal barge drifting above a ringed planet, cold starlight.",
});
const SHIP_LOCKED = { title: "Halcyon Driftbarge", card_type: "artifact", subtypes: ["Spacecraft"], color_identity: ["blue"], power: "4", toughness: "5" };

/** Cards that are NOT station cards — among them the ones nearest to one. */
const CARDS: Record<string, { card: ReturnType<typeof designed>; frame: string | null }> = {
  creature: { card: designed(), frame: "m15" },
  "creature, no frame": { card: designed(), frame: null },
  instant: { card: designed({ title: "Riptide Calculus", cost: "{1}{U}{U}", card_type: "instant", subtypes: [], color_identity: ["blue"], rules_text: "Counter target spell unless its controller pays {2}. Draw a card.", power: null, toughness: null }), frame: "m15" },
  "artifact (Equipment)": { card: designed({ title: "Gearwright's Maul", cost: "{2}", card_type: "artifact", subtypes: ["Equipment"], color_identity: ["colorless"], rules_text: "Equipped creature gets +2/+1.\nEquip {2}", flavor_text: null, power: null, toughness: null }), frame: "m15artifact" },
  "artifact (Vehicle, on its frame)": { card: designed({ title: "Skiff of Nine Lanterns", cost: "{3}", card_type: "artifact", subtypes: ["Vehicle"], color_identity: ["colorless"], rules_text: "Flying\nCrew 2", flavor_text: null, power: "3", toughness: "3" }), frame: "m15vehicle" },
  // A plain artifact whose TEXT has tier-looking lines: not a Spacecraft.
  "artifact with 'N+ |' lines": { card: designed({ title: "Counting Engine", cost: "{4}", card_type: "artifact", subtypes: [], color_identity: ["colorless"], rules_text: "Station\n3+ | {T}: Draw a card.\n8+ | {T}: Draw two cards.", flavor_text: null, power: null, toughness: null }), frame: "m15artifact" },
  // A CREATURE that says Spacecraft: the station frame dresses artifacts.
  "creature that says Spacecraft": { card: designed({ title: "Living Hull", cost: "{4}", supertype: "Artifact", subtypes: ["Spacecraft"], color_identity: ["colorless"], rules_text: "Flying", power: "3", toughness: "3" }), frame: "m15artifact" },
  land: { card: designed({ title: "Cinderfall Reach", cost: "—", card_type: "land", subtypes: [], color_identity: ["red"], rules_text: "{T}: Add {R}.", flavor_text: null, power: null, toughness: null }), frame: "m15land" },
  planeswalker: { card: designed({ title: "Veyra, Tide Oracle", cost: "{2}{U}{U}", card_type: "planeswalker", supertype: "Legendary", subtypes: ["Veyra"], color_identity: ["blue"], rules_text: "+1: Draw a card.\n-3: Return target creature to its owner's hand.", flavor_text: null, power: null, toughness: null, loyalty: "4" }), frame: "m15pw" },
  "token (Treasure)": { card: designed({ title: "Treasure", cost: "—", card_type: "token", supertype: "Artifact", subtypes: ["Treasure"], color_identity: ["colorless"], rules_text: "{T}, Sacrifice this artifact: Add one mana of any color.", flavor_text: null, power: null, toughness: null }), frame: "m15tokenartifacttext" },
  "enchantment creature": { card: designed({ title: "Lanternhollow Muse", cost: "{1}{W}", supertype: "Enchantment", subtypes: ["Spirit"], color_identity: ["white"], rules_text: "Vigilance", power: "2", toughness: "1" }), frame: "m15nyx" },
  // (ADDED on #568, recorded on origin/main ad4de3bc's lib/ — every entry
  // above unchanged.)
  "artifact creature": { card: designed({ title: "Ironclad Golem", cost: "{4}", supertype: "Artifact", subtypes: ["Golem"], color_identity: ["colorless"], rules_text: "Trample", flavor_text: null, power: "3", toughness: "3" }), frame: "m15artifact" },
};

function job(kind: string, plan: Record<string, unknown>, stepKey: string, extra: Record<string, unknown> = {}) {
  s.stepKey = stepKey;
  s.job = { id: "job-1", owner_id: USER, kind, status: "generating", request: {}, deck_id: null, error: null, plan, steps: [{ key: stepKey, label: "Card", status: "running" }], ...extra };
}

/** One step, run through the real credit wrapper: what was saved, the
 *  credits reserved and that the charge was kept (no refund) and stamped
 *  for settlement (`spend_ref`, which patch_job_step settles). */
async function runStep() {
  const result = await runNextJobStep("job-1", s.stepKey);
  expect(result.ok).toBe(true);
  const step = s.patched.at(-1)!;
  return {
    saved: s.created.at(-1) ?? null,
    step: { status: step.status, error: step.error ?? null, label: step.label ?? null, settles: typeof step.spend_ref === "string" && /^spend:job-1:/.test(step.spend_ref) },
    credits: s.spend.mock.calls.map((call) => ({ amount: call[0], reason: call[1] })),
    refunds: s.refund.mock.calls.length,
  };
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.inserted = [];
  s.answers = [];
  s.prompts = [];
  s.verified = EVERY;
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0);
});

describe("the single-card job's step saves what main saved", () => {
  it.each(Object.keys(CARDS))("%s", async (name) => {
    const { card, frame } = CARDS[name]!;
    job("card", { card, style: "oil painting", frame_template: frame, deck_id: null }, "card:0");
    pinned(`card step · ${name}`, await runStep());
  });
});

describe("the deck job's card step saves what main saved, and its frame", () => {
  // Since the AI deck cards got their FRAME (owner 2026-10-14) the save
  // carries `frame_style` — the frame resolveGeneratedFrame gives the card
  // (tests/unit/ai/deck-card-frame.test.ts); main saved none. Everything
  // else is main's record, byte for byte (the record is untouched).
  it.each(["creature", "artifact (Vehicle, on its frame)", "artifact with 'N+ |' lines", "land"])("%s", async (name) => {
    const { card, frame } = CARDS[name]!;
    const plan = { deck_title: "Deck", strategy: "Go wide.", theme: "embers", style: null, cards: [card], roles: [name === "creature" ? "commander" : "noncreature"], quantities: [1] };
    job("deck", plan, "card:0", { deck_id: "deck-1" });
    const out = await runStep();
    const { frame_style: frameStyle, ...saved } = out.saved as Record<string, unknown>;
    pinned(`deck step · ${name}`, { ...out, saved });
    expect(frameStyle).toEqual({ template: frame });
  });
});

describe("the deck remix of a printing saves what main saved", () => {
  const keys: (keyof typeof printings)[] = ["lea-255", "m21-239", "mrd-283", "dom-168", "c17-11", "tmsh-27", "eld-115", "dmr-215", "isd-51", "neo-141", "c13-281"];
  it.each(keys)("%s", async (key) => {
    const printing = scryfallCardSchema.parse(structuredClone(printings[key]));
    s.printing = printing;
    const plan = { deck_title: "Deck", style: "watercolour", theme: null, skipped: 0, entries: [{ board: "main", quantity: 1, name: printing.name, card_id: null, scryfall_id: printing.id }] };
    job("deck_remix", plan, "remix:0", { deck_id: "deck-1" });
    pinned(`remix printing · ${key}`, await runStep());
  });
});

describe("the deck remix of the user's own card saves what main saved", () => {
  const row = (over: Record<string, unknown>) => ({
    id: SOURCE_ID,
    title: "Kesh, Emberforge Warden",
    cost: "{2}{R}{R}",
    card_type: "creature",
    supertype: "Legendary",
    subtypes: ["Dwarf"],
    rarity: "rare",
    color_identity: ["red"],
    rules_text: "Haste\nWhenever Kesh attacks, it deals 1 damage to any target.",
    flavor_text: "Old flavour.",
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    art_url: null,
    back_face: null,
    face_content: null,
    frame_style: { template: "m15" },
    ...over,
  });
  const SOURCES: Record<string, Record<string, unknown>> = {
    creature: row({}),
    "Vehicle on the Vehicle frame": row({ title: "Skiff of Nine Lanterns", cost: "{3}", card_type: "artifact", supertype: null, subtypes: ["Vehicle"], color_identity: ["colorless"], rules_text: "Flying\nCrew 2", frame_style: { template: "m15vehicle", crown: false } }),
    "walker stored with its rows alone": row({ title: "Veyra, Tide Oracle", card_type: "planeswalker", subtypes: ["Veyra"], color_identity: ["blue"], cost: "{2}{U}{U}", rules_text: null, power: null, toughness: null, loyalty: "4", face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }, { cost: "-3", text: "Return target creature to its owner's hand." }] } }, frame_style: { template: "m15pw" } }),
    "saga with rows": row({ title: "The Long Thaw", card_type: "enchantment", supertype: null, subtypes: ["Saga"], color_identity: ["green"], cost: "{2}{G}", rules_text: "I — Draw a card.\nII, III — Create a 2/2 Bear.", power: null, toughness: null, face_content: { v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "Draw a card." }, { numerals: [2, 3], text: "Create a 2/2 Bear." }] } }, frame_style: { template: "saga" } }),
    // An artifact OFF the station frame that still holds station rows (its
    // frame was changed): the rows are nothing the remix reads.
    "artifact holding station rows off-frame": row({ title: "Counting Engine", cost: "{4}", card_type: "artifact", supertype: null, subtypes: ["Spacecraft"], color_identity: ["colorless"], rules_text: "Station\n8+ | Flying", power: "3", toughness: "3", face_content: { v: 1, station: { intro: "Other text", tiers: [{ threshold: 6, text: "Trample", pt: true }] } }, frame_style: { template: "m15artifact" } }),
  };
  it.each(Object.keys(SOURCES))("%s", async (name) => {
    s.source = SOURCES[name];
    const plan = { deck_title: "Deck", style: "watercolour", theme: null, skipped: 0, entries: [{ board: "main", quantity: 1, name: SOURCES[name]!.title, card_id: SOURCE_ID, scryfall_id: null }] };
    job("deck_remix", plan, "remix:0", { deck_id: "deck-1" });
    pinned(`remix own card · ${name}`, await runStep());
  });
});

describe("the plans the jobs store, the model mocked", () => {
  const plan = () => {
    const row = s.inserted.at(-1)!;
    return { kind: row.kind, plan: row.plan, steps: row.steps };
  };

  it.each(Object.keys(CARDS))("single card, frame random · %s", async (name) => {
    s.answers = [[CARDS[name]!.card], [CARDS[name]!.card]];
    const out = await createCardGenerationJob({ theme: "embers", frame: "random", cardType: CARDS[name]!.card.card_type as never });
    expect(out.ok).toBe(true);
    // (The random frame is the pool's first and its last: Math.random is
    // pinned below, so the pool itself is what is compared.)
    const first = plan();
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    s.answers = [[CARDS[name]!.card], [CARDS[name]!.card]];
    await createCardGenerationJob({ theme: "embers", frame: "random", cardType: CARDS[name]!.card.card_type as never });
    const last = plan();
    pinned(`card plan · ${name}`, { ...first, lastFrame: (last.plan as { frame_template: unknown }).frame_template, prompts: s.prompts });
  });

  const FILLS: Record<string, { want: string[]; locked: Record<string, unknown>; answer: Record<string, unknown> }> = {
    "rules text of a creature": { want: ["rules_text", "flavor_text"], locked: { title: "Emberwake Tyrant", card_type: "creature", subtypes: ["Dragon"], color_identity: ["red"], cost: "{3}{R}{R}", power: "4", toughness: "4" }, answer: designed() },
    "everything but the type of an artifact": { want: ["title", "cost", "rarity", "rules_text", "flavor_text", "stats", "tags"], locked: { card_type: "artifact", subtypes: ["Equipment"], color_identity: ["colorless"] }, answer: CARDS["artifact (Equipment)"]!.card },
    "rules text of a Vehicle": { want: ["rules_text"], locked: { title: "Skiff of Nine Lanterns", card_type: "artifact", subtypes: ["Vehicle"], color_identity: ["colorless"], power: "3", toughness: "3" }, answer: CARDS["artifact (Vehicle, on its frame)"]!.card },
    "rules text of a plain artifact whose text has 'N+ |' lines": { want: ["rules_text"], locked: { title: "Counting Engine", card_type: "artifact", subtypes: [], color_identity: ["colorless"] }, answer: CARDS["artifact with 'N+ |' lines"]!.card },
    "a walker's rows": { want: ["rules_text", "stats"], locked: { title: "Veyra, Tide Oracle", card_type: "planeswalker", supertype: "Legendary", subtypes: ["Veyra"], color_identity: ["blue"], cost: "{2}{U}{U}" }, answer: CARDS.planeswalker!.card },
    "the type too (create)": { want: ["card_type", "color_identity", "title", "rules_text", "stats"], locked: {}, answer: designed() },
    // The station fills that are NOT refused (owner 2026-10-14: only a fill
    // whose empty tier comes back empty is) — recorded on origin/main
    // 97481a22's lib/, so their plan, fill and credit stay main's.
    "station · rules text, no gap (a new text)": { want: ["rules_text"], locked: { ...SHIP_LOCKED, station_text: `${SHIP_LINE}\n2+ | Scry 1.\n9+ | Flying` }, answer: SHIP },
    "station · rules text, the gap the model writes": { want: ["rules_text"], locked: { ...SHIP_LOCKED, station_text: `When this Spacecraft enters,  scry 2.\n${SHIP_LINE}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | ` }, answer: SHIP },
    "station · rules text and flavour, the gap written by place": { want: ["rules_text", "flavor_text"], locked: { ...SHIP_LOCKED, station_text: `${SHIP_LINE}\n3+ | \n9+ | Flying` }, answer: SHIP },
  };
  it.each(Object.keys(FILLS))("fill · %s", async (name) => {
    const { want, locked, answer } = FILLS[name]!;
    s.answers = [[answer], [answer]];
    const out = await createCardFillJob({ want: want as never, locked: locked as never, steer: {}, frame: undefined });
    expect(out.ok).toBe(true);
    const stored = plan();
    pinned(`fill plan · ${name}`, { ...stored, prompts: s.prompts });
    // …and the step that hands it to the creator, at its one credit.
    job("card_fill", stored.plan as Record<string, unknown>, "fill:0");
    s.job.steps = stored.steps as never;
    const result = await runNextJobStep("job-1", "fill:0");
    expect(result.ok).toBe(true);
    const step = s.patched.at(-1)!;
    pinned(`fill step · ${name}`, { status: step.status, fill: step.fill ?? null, credits: s.spend.mock.calls.map((call) => ({ amount: call[0], reason: call[1] })), refunds: s.refund.mock.calls.length });
  });
});

/** The ONE single-card change (owner 2026-10-14): an Artifact Creature
 *  asked onto the creature's M15 frame by name lands on the artifact frame
 *  it borrows (resolveGeneratedFrame, artifactCreatureFrameFor) — main kept
 *  m15. Every other case of the by-name matrix is main's, byte for byte;
 *  these differ from main's record in `frame_template` alone. */
const ARTIFACT_CREATURE_MOVES: Record<string, { main: string; branch: string }> = {
  "card plan by name · artifact creature · m15": { main: "m15", branch: "m15artifact" },
  "card plan by name · creature that says Spacecraft · m15": { main: "m15", branch: "m15artifact" },
};

describe("the single-card job's plan, a frame asked for by name", () => {
  const cases = Object.keys(CARDS).flatMap((name) => ["m15", "m15artifact", CARDS[name]!.frame ?? "m15"].filter((frame, index, all) => all.indexOf(frame) === index).map((frame) => [name, frame] as const));
  it.each(cases)("%s · %s", async (name, frame) => {
    s.answers = [[CARDS[name]!.card], [CARDS[name]!.card]];
    const out = await createCardGenerationJob({ theme: "embers", frame: frame as FrameTemplate, cardType: CARDS[name]!.card.card_type as never });
    expect(out.ok).toBe(true);
    const row = s.inserted.at(-1)!;
    const value = { kind: row.kind, plan: row.plan, steps: row.steps };
    const key = `card plan by name · ${name} · ${frame}`;
    const moved = ARTIFACT_CREATURE_MOVES[key];
    if (!moved || UPDATE) return pinned(key, value);
    expect((value.plan as { frame_template: string }).frame_template).toBe(moved.branch);
    expect((recorded[key] as { plan: { frame_template: string } }).plan.frame_template).toBe(moved.main);
    pinned(key, { ...value, plan: { ...(value.plan as object), frame_template: moved.main } });
  });
});

describe("the record", () => {
  it("is written on request, and otherwise names exactly the cases above", () => {
    if (UPDATE) {
      writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 1)}\n`);
      return;
    }
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(recorded).sort());
  });
});
