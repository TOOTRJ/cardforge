import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/station-printings.json";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27a, PR 3 — Spacecraft and Planets through the real AI JOBS (plan
// and step), with the station frames TICKED: what each path that can reach a
// ticked station frame hands createCardAction (or the creator), the credits
// it reserves and that the charge is kept and stamped for settlement.
//
// The twin of job-payloads-pinned.test.ts, whose matrix is every card that
// is NOT a station card (byte-equal to main); this one is the station cards.
// Stubbed: Supabase, the ledger helpers (the REAL credit wrapper runs over
// them), the model (`ai` generateObject and the remix identity — no
// generation is run), the image generators, the Scryfall client and the two
// card actions (captured). The payloads are also run through the server's
// own schema (`createCardSchema`).
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
  identity: vi.fn(),
  job: null as unknown as Record<string, unknown>,
  stepKey: "card:0",
  answers: [] as (unknown[] | null)[],
  prompts: [] as string[],
  /** Image-model calls (the art a step pays for). */
  images: 0,
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
    const cards = s.answers.shift();
    if (cards === null) throw new Error("model unavailable");
    return { object: { cards: cards ?? [] } };
  },
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  designModel: () => "test/design",
  judgeModel: () => "test/judge",
}));
vi.mock("@/lib/ai/remix", () => ({ generateRemixIdentity: s.identity }));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async () => {
    s.images += 1;
    return { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };
  };
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

import { REMIX_STATION_SHAPE_LOST, createCardFillJob, createCardGenerationJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { createCardSchema } from "@/lib/validation/card";
import { resolveStationTiers } from "@/lib/cards/station";
import { stationReminder } from "@/lib/creator/station-rows";
import { frameKindGateError, cardFieldsFace } from "@/lib/cards/frame-kind-gate";
import type { FaceContent } from "@/types/card";

type PrintingKey = keyof typeof printings;
const LINE = (n: number | null, word: "Spacecraft" | "Planet" = "Spacecraft") => stationReminder(word, n);
const keys = (...combos: [string, string][]) => combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour));
/** The twelve station colours ticked, beside the frames they stand on. */
const TICKED = keys(
  ...(["w", "u", "b", "r", "g", "m", "c"] as const).flatMap((k) => [["m15station", k], ["m15artifact", k], ["m15", k], ["m15vehicle", k]] as [string, string][]),
  ...(["w", "u", "b", "r", "g"] as const).flatMap((k) => [["m15stationland", k], ["m15land", k]] as [string, string][]),
);
const UNTICKED = TICKED.filter((key) => !key.startsWith("m15station"));

const ship = (over: Record<string, unknown> = {}) => ({
  title: "Halcyon Driftbarge",
  cost: "{2}{U}",
  card_type: "artifact",
  supertype: null,
  subtypes: ["Spacecraft"],
  rarity: "rare",
  color_identity: ["blue"],
  rules_text: `${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying`,
  flavor_text: null,
  power: "4",
  toughness: "5",
  loyalty: null,
  defense: null,
  art_prompt: "A teal barge drifting above a ringed planet, cold starlight.",
  ...over,
});

function job(kind: string, plan: Record<string, unknown>, stepKey: string, extra: Record<string, unknown> = {}) {
  s.stepKey = stepKey;
  s.job = { id: "job-1", owner_id: USER, kind, status: "generating", request: {}, deck_id: null, error: null, plan, steps: [{ key: stepKey, label: "Card", status: "running" }], ...extra };
}

async function runStep() {
  const result = await runNextJobStep("job-1", s.stepKey);
  expect(result.ok).toBe(true);
  return { step: s.patched.at(-1)!, saved: s.created.at(-1) };
}

/** ONE charge of `amount`, kept, and stamped for settlement: the step's
 *  `spend_ref` is the ledger ref patch_job_step settles with its done-write
 *  (migration 0106). */
function expectCharged(step: Record<string, unknown>, amount: number, reason: string) {
  expect(s.spend).toHaveBeenCalledTimes(1);
  expect(s.spend.mock.calls[0]!.slice(0, 2)).toEqual([amount, reason]);
  expect(s.refund).not.toHaveBeenCalled();
  expect(step.spend_ref).toBe((s.spend.mock.calls[0]![2] as { ref: string }).ref);
}

/** What the card DRAWS: its rows first, as both renderers read them. */
function drawn(saved: Record<string, unknown>) {
  const hasPt = Boolean(saved.power && saved.toughness);
  return resolveStationTiers((saved.face_content ?? null) as FaceContent | null, saved.rules_text as string, hasPt).tiers.map((tier) => `${tier.threshold}+${tier.pt ? " (P/T)" : ""}`);
}

/** The server takes the payload (its schema) and the frame fits the card. */
function expectSavable(saved: Record<string, unknown>) {
  const parsed = createCardSchema.safeParse(saved);
  expect(parsed.success ? null : parsed.error.issues).toBeNull();
  const template = (saved.frame_style as { template?: string } | undefined)?.template;
  expect(frameKindGateError(template, cardFieldsFace(saved as never))).toBeNull();
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.inserted = [];
  s.answers = [];
  s.prompts = [];
  s.images = 0;
  s.verified = TICKED;
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(undefined);
  s.identity.mockReset().mockResolvedValue({ title: "Remixed Name", flavor_text: null, art_instruction: "A painted scene." });
  vi.restoreAllMocks();
});

describe("AI card generation: a Spacecraft on a ticked station frame", () => {
  it("PLAN — a designed Spacecraft with tiers lands on the station frame", async () => {
    s.answers = [[ship()]];
    const out = await createCardGenerationJob({ cardType: "artifact", frame: "m15station" });
    expect(out.ok).toBe(true);
    expect((s.inserted[0]!.plan as { frame_template: string }).frame_template).toBe("m15station");
    // …asked for on the Artifact frame, or at random, it follows its subtype.
    s.answers = [[ship()]];
    await createCardGenerationJob({ cardType: "artifact", frame: "m15artifact" });
    expect((s.inserted[1]!.plan as { frame_template: string }).frame_template).toBe("m15station");
  });

  it("PLAN — MAIN'S CASE: a tierless Spacecraft the judge cannot fix stays on the Artifact frame (main: m15station, P/T undrawn)", async () => {
    const tierless = ship({ rules_text: "Flying\nWhen this Spacecraft enters, draw a card." });
    for (const frame of ["m15station", "m15artifact", "random"] as const) {
      s.answers = [[tierless], null];
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      await createCardGenerationJob({ cardType: "artifact", frame });
      const plan = s.inserted.at(-1)!.plan as { frame_template: string; card: { rules_text: string } };
      expect(plan.card.rules_text).toBe(tierless.rules_text);
      expect(plan.frame_template === "m15station", frame).toBe(false);
      if (frame !== "random") expect(plan.frame_template).toBe("m15artifact");
    }
  });

  it("PLAN — the judge's repair is what the plan stores, on the station frame", async () => {
    s.answers = [[ship({ rules_text: "Flying" })], [ship()]];
    await createCardGenerationJob({ cardType: "artifact", frame: "m15station" });
    const plan = s.inserted[0]!.plan as { frame_template: string; card: { rules_text: string } };
    expect(plan).toMatchObject({ frame_template: "m15station", card: { rules_text: ship().rules_text } });
  });

  it("STEP — the card saves with its rows, the P/T on the tier the Station line names; one credit, kept and settled", async () => {
    job("card", { card: ship({ rules_text: `  ${ship().rules_text}\n` }), style: null, frame_template: "m15station" }, "card:0");
    const { step, saved } = await runStep();
    expect(step.status).toBe("done");
    expect(saved).toMatchObject({
      frame_style: { template: "m15station" },
      rules_text: ship().rules_text,
      face_content: {
        v: 1,
        station: { intro: LINE(9), tiers: [{ threshold: 2, text: "Whenever you cast an artifact spell, scry 1." }, { threshold: 9, text: "Flying", pt: true }] },
      },
      power: "4",
      toughness: "5",
    });
    expect(drawn(saved!)).toEqual(["2+", "9+ (P/T)"]);
    expectSavable(saved!);
    expectCharged(step, 1, "generate_random_card");
  });

  it("STEP — the same card on the Artifact frame (unticked, or the plan's fallback) saves as it always did: no rows", async () => {
    job("card", { card: ship(), style: null, frame_template: "m15artifact" }, "card:0");
    const { saved } = await runStep();
    expect(saved).toMatchObject({ frame_style: { template: "m15artifact" }, rules_text: ship().rules_text });
    expect("face_content" in saved!).toBe(false);
    expectSavable(saved!);
  });

  it("STEP — a Planet's rows mark no tier", async () => {
    const planet = ship({ title: "Evenfall", cost: "—", card_type: "land", subtypes: ["Planet"], color_identity: ["green"], rules_text: `This land enters tapped.\n{T}: Add {G}.\n${LINE(null, "Planet")}\n12+ | {G}, {T}: Add {G}{G}.`, power: null, toughness: null });
    job("card", { card: planet, style: null, frame_template: "m15stationland" }, "card:0");
    const { saved } = await runStep();
    expect((saved!.face_content as FaceContent).station!.tiers).toEqual([{ threshold: 12, text: "{G}, {T}: Add {G}{G}." }]);
    expectSavable(saved!);
  });
});

describe("AI deck generation: a designed Spacecraft never names a frame", () => {
  it("the deck step saves it frameless — the default frame, its P/T in the corner — with the tier text as lines; one credit", async () => {
    const plan = { deck_title: "Deck", strategy: "Charge up.", theme: "void", style: null, cards: [ship()], roles: ["noncreature"], quantities: [1] };
    job("deck", plan, "card:0", { deck_id: "44444444-4444-4444-8444-444444444444" });
    const { step, saved } = await runStep();
    expect(saved!.frame_style).toBeUndefined();
    expect("face_content" in saved!).toBe(false);
    expect(saved!.rules_text).toBe(ship().rules_text);
    expectCharged(step, 1, "generate_deck");
  });
});

describe("the deck remix of a printed Spacecraft / Planet", () => {
  async function remix(key: PrintingKey) {
    const printing = scryfallCardSchema.parse(structuredClone(printings[key]));
    s.printing = printing;
    const plan = { deck_title: "Deck", style: "watercolour", theme: null, skipped: 0, entries: [{ board: "main", quantity: 1, name: printing.name, card_id: null, scryfall_id: printing.id }] };
    job("deck_remix", plan, "remix:0", { deck_id: "44444444-4444-4444-8444-444444444444" });
    return { ...(await runStep()), printing };
  }

  it("Lumen-Class Frigate EOE #25: the station frame, its two tiers as rows, the plate on 12+; one credit", async () => {
    const { step, saved, printing } = await remix("eoe-25");
    expect(step.status).toBe("done");
    expect(saved).toMatchObject({ title: "Remixed Name", frame_style: { template: "m15station" }, card_type: "artifact", subtypes: ["Spacecraft"], power: "3", toughness: "5" });
    // The rules are the printing's, to the character (it calls itself "this Spacecraft").
    expect(saved!.rules_text).toBe(printing.oracle_text);
    expect((saved!.face_content as FaceContent).station!.tiers).toEqual([
      { threshold: 2, text: "Other creatures you control get +1/+1." },
      { threshold: 12, text: "Flying, lifelink", pt: true },
    ]);
    expect(drawn(saved!)).toEqual(["2+", "12+ (P/T)"]);
    expectSavable(saved!);
    expectCharged(step, 1, "generate_deck");
  });

  it("Infinite Guideline Station EOE #219: its own name is renamed in the top band AND in the tier — the shape stays", async () => {
    const { step, saved, printing } = await remix("eoe-219");
    expect(step.status).toBe("done");
    expect(saved!.rules_text).toBe((printing.oracle_text as string).replaceAll("Infinite Guideline Station", "Remixed Name"));
    expect(saved!.rules_text).not.toContain("Infinite Guideline");
    const rows = (saved!.face_content as FaceContent).station!;
    expect(rows.intro).toContain("When Remixed Name enters");
    expect(rows.tiers).toEqual([{ threshold: 12, text: "Flying\nWhenever Remixed Name attacks, draw a card for each multicolored permanent you control.", pt: true }]);
    expectSavable(saved!);
  });

  it("The Eternity Elevator EOE #241 (no P/T) and a Planet (Evendo EOE #253): rows that plate no tier", async () => {
    const elevator = await remix("eoe-241");
    expect(elevator.saved).toMatchObject({ frame_style: { template: "m15station" } });
    expect((elevator.saved!.face_content as FaceContent).station!.tiers.some((tier) => tier.pt)).toBe(false);
    expectSavable(elevator.saved!);
    const planet = await remix("eoe-253");
    expect(planet.saved).toMatchObject({ frame_style: { template: "m15stationland" }, card_type: "land", subtypes: ["Planet"] });
    expect((planet.saved!.face_content as FaceContent).station!.tiers).toEqual([{ threshold: 12, text: "{G}, {T}: Add {G} for each creature you control." }]);
    expectSavable(planet.saved!);
  });

  it("with the station frames unticked the remix lands where it did, with no rows: the tiers are lines of text", async () => {
    s.verified = UNTICKED;
    const { saved, printing } = await remix("eoe-25");
    expect(saved).toMatchObject({ frame_style: { template: "m15artifact" }, rules_text: printing.oracle_text });
    expect("face_content" in saved!).toBe(false);
  });

  it("the other dresses keep their landing (PR 4): an extended-art and a borderless Spacecraft are not on the station frame", async () => {
    for (const key of ["eoe-321", "eoc-1"] as PrintingKey[]) {
      const { saved } = await remix(key);
      expect((saved!.frame_style as { template: string }).template, key).not.toBe("m15station");
      expect("face_content" in saved!, key).toBe(false);
    }
  });

  it("a new name that would make a tier line fails the step before the save — and the credit goes back", async () => {
    s.identity.mockResolvedValue({ title: "Bad\n3+ | Name", flavor_text: null, art_instruction: "A painted scene." });
    const { step, saved } = await remix("eoe-219");
    expect(step).toMatchObject({ status: "failed", error: REMIX_STATION_SHAPE_LOST, spend_ref: null });
    expect(saved).toBeUndefined();
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(s.refund.mock.calls[0]![1]).toBe(1);
    // …and BEFORE the art, like every other naming refusal: no picture is
    // generated for a card that is not saved (the independent check).
    expect(s.images).toBe(0);
  });
});

describe("the deck remix of the user's own Spacecraft", () => {
  const text = `${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying`;
  const row = (over: Record<string, unknown> = {}) => ({
    id: SOURCE_ID,
    title: "Halcyon Driftbarge",
    cost: "{2}{U}",
    card_type: "artifact",
    supertype: null,
    subtypes: ["Spacecraft"],
    rarity: "rare",
    color_identity: ["blue"],
    rules_text: text,
    flavor_text: null,
    power: "4",
    toughness: "5",
    loyalty: null,
    defense: null,
    art_url: null,
    back_face: null,
    face_content: null,
    frame_style: { template: "m15station" },
    ...over,
  });
  async function remix(source: Record<string, unknown>) {
    s.source = source;
    const plan = { deck_title: "Deck", style: "watercolour", theme: null, skipped: 0, entries: [{ board: "main", quantity: 1, name: source.title, card_id: SOURCE_ID, scryfall_id: null }] };
    job("deck_remix", plan, "remix:0", { deck_id: "44444444-4444-4444-8444-444444444444" });
    return runStep();
  }

  it("stored as plain text: the frame is kept, the rows written, the plate where the text has it", async () => {
    const { step, saved } = await remix(row());
    expect(saved).toMatchObject({ frame_style: { template: "m15station" }, rules_text: text, parent_card_id: SOURCE_ID });
    expect(drawn(saved!)).toEqual(["2+", "9+ (P/T)"]);
    expectSavable(saved!);
    expectCharged(step, 1, "generate_deck");
  });

  it("the maker put the P/T on tier 1: the remix keeps it there (main: back on the last tier)", async () => {
    const rows = { v: 1, station: { intro: LINE(9), tiers: [{ threshold: 2, text: "Whenever you cast an artifact spell, scry 1.", pt: true }, { threshold: 9, text: "Flying" }] } };
    const { saved } = await remix(row({ face_content: rows }));
    expect(saved!.face_content).toEqual(rows);
    expect(drawn(saved!)).toEqual(["2+ (P/T)", "9+"]);
    expectSavable(saved!);
  });

  it("rows that say another text than rules_text: the remix copies what the card SHOWS — the rows", async () => {
    const rows = { v: 1, station: { intro: "Vigilance", tiers: [{ threshold: 6, text: "Trample", pt: true }] } };
    const { saved } = await remix(row({ face_content: rows }));
    expect(saved!.rules_text).toBe("Vigilance\n6+ | Trample");
    expect(saved!.face_content).toEqual(rows);
  });

  it("a title that is a tier's number (\"9\" in \"9+ | Flying\"): the rename would unmake the tier — refused before the art, refunded (main: saved a broken card)", async () => {
    const { step, saved } = await remix(row({ title: "9" }));
    expect(step).toMatchObject({ status: "failed", error: REMIX_STATION_SHAPE_LOST, spend_ref: null });
    // No plan-limit code: the runner stops on nothing and opens no modal.
    expect(step.error_code ?? null).toBeNull();
    expect(saved).toBeUndefined();
    expect(s.images).toBe(0);
    expect(s.spend).toHaveBeenCalledTimes(1);
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(s.refund.mock.calls[0]!.slice(1, 4)).toEqual([1, "generate_deck", `refund:${(s.spend.mock.calls[0]![2] as { ref: string }).ref}`]);
  });

  it("a kept remix pays for its one picture", async () => {
    await remix(row());
    expect(s.images).toBe(1);
  });

  it("the station frame unticked since: the default landing, no rows — as an own card always fell back", async () => {
    s.verified = UNTICKED;
    const { saved } = await remix(row());
    expect(saved!.frame_style).toBeUndefined();
    expect("face_content" in saved!).toBe(false);
    expect(saved!.rules_text).toBe(text);
  });
});

describe("the per-field fill job on a station card", () => {
  const locked = { title: "Halcyon Driftbarge", card_type: "artifact" as const, subtypes: ["Spacecraft"], color_identity: ["blue" as const], power: "4", toughness: "5" };

  it("a tier left empty is the one line written; the fill hands it over at its one credit, kept and settled", async () => {
    const station_text = `When this Spacecraft enters,  scry 2.\n${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | `;
    s.answers = [[ship({ rules_text: `Rewritten.\n${LINE(9)}\n2+ | Rewritten tier.\n9+ | Flying, vigilance` })]];
    const out = await createCardFillJob({ want: ["rules_text"], locked: { ...locked, station_text }, steer: {} });
    expect(out.ok).toBe(true);
    const stored = s.inserted[0]! as { plan: { fields: Record<string, unknown>; frame_template: unknown }; steps: unknown };
    expect(stored.plan.fields).toEqual({ rules_text: `When this Spacecraft enters,  scry 2.\n${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying, vigilance` });
    expect(stored.plan.frame_template).toBeNull();
    job("card_fill", stored.plan as never, "fill:0");
    const { step } = await runStep();
    expect(step).toMatchObject({ status: "done", fill: stored.plan.fields });
    expectCharged(step, 1, "fill_card");
  });

  it("the empty tier came back EMPTY (model and judge): the fill is refused at plan time — no job, no charge, no refund, no settle, no picture (owner 2026-10-14; main: charged 1 and handed the text back unchanged)", async () => {
    const station_text = `When this Spacecraft enters,  scry 2.\n${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | `;
    // Every design / judge answer keeps the gap; art is ticked too.
    s.answers = [[ship({ rules_text: station_text })], [ship({ rules_text: station_text })], [ship({ rules_text: station_text })]];
    const out = await createCardFillJob({ want: ["rules_text", "art"], locked: { ...locked, station_text }, steer: {} });
    expect(out).toEqual({
      ok: false,
      code: "STATION_TIER_UNFILLED",
      error: "The AI couldn't write that tier — nothing was charged. Try again or write it yourself.",
    });
    // No job row → no step the client could run, retry or loop on; no
    // ledger row of any kind (spend, refund) and nothing for patch_job_step
    // to settle; no image generated.
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.refund).not.toHaveBeenCalled();
    expect(s.patched).toEqual([]);
    expect(s.images).toBe(0);
  });

  it("two gaps, only one written: refused the same way (nothing half-filled is sold)", async () => {
    const station_text = `${LINE(9)}\n2+ | \n9+ | `;
    const half = ship({ rules_text: `${LINE(9)}\n2+ | Scry 1.` });
    s.answers = [[half], [half], [half]];
    const out = await createCardFillJob({ want: ["rules_text"], locked: { ...locked, station_text }, steer: {} });
    // The message names the ONE tier still unwritten.
    expect(out).toMatchObject({ ok: false, code: "STATION_TIER_UNFILLED", error: expect.stringMatching(/^The AI couldn't write that tier — nothing was charged/) });
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("refused WHOLE with title, flavour and art ticked beside the gap: none of them is handed over, no picture is painted", async () => {
    const station_text = `${LINE(9)}\n2+ | Scry 1.\n9+ | `;
    const keeps = ship({ title: "New Name", flavor_text: "New flavour.", rules_text: `${LINE(9)}\n2+ | Scry 1.` });
    s.answers = [[keeps], [keeps], [keeps]];
    const out = await createCardFillJob({ want: ["title", "rules_text", "flavor_text", "art"], locked: { ...locked, station_text }, steer: {} });
    expect(out).toMatchObject({ ok: false, code: "STATION_TIER_UNFILLED" });
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.images).toBe(0);
  });

  it("a Planet's gap: refused when it comes back empty, charged once when written", async () => {
    const planetLocked = { title: "Verdant Orb", card_type: "land" as const, subtypes: ["Planet"], color_identity: ["green" as const] };
    const planet = (rules_text: string) => ship({ title: "Verdant Orb", cost: "", card_type: "land", subtypes: ["Planet"], color_identity: ["green"], power: null, toughness: null, rules_text });
    const station_text = `${LINE(null, "Planet")}\n3+ | {T}: Add {G}.\n7+ | `;
    s.answers = [[planet(station_text)], [planet(station_text)], [planet(station_text)]];
    expect(await createCardFillJob({ want: ["rules_text"], locked: { ...planetLocked, station_text }, steer: {} })).toMatchObject({ ok: false, code: "STATION_TIER_UNFILLED" });
    expect(s.inserted).toEqual([]);
    s.answers = [[planet(`${LINE(null, "Planet")}\n3+ | {T}: Add {G}.\n7+ | Draw a card.`)]];
    const out = await createCardFillJob({ want: ["rules_text"], locked: { ...planetLocked, station_text }, steer: {} });
    expect(out.ok).toBe(true);
    job("card_fill", (s.inserted[0] as { plan: Record<string, unknown> }).plan, "fill:0");
    const { step } = await runStep();
    expectCharged(step, 1, "fill_card");
  });

  it("a fill that designs the type into a NON-station card is never refused for the old gap (the designed text is the answer, as on main)", async () => {
    const station_text = `${LINE(9)}\n2+ | Scry 1.\n9+ | `;
    const creature = ship({ card_type: "creature", subtypes: ["Human"], rules_text: "Flying" });
    s.answers = [[creature], [creature]];
    const out = await createCardFillJob({ want: ["card_type", "rules_text"], locked: { title: "Halcyon", color_identity: ["blue"], station_text }, steer: {} });
    expect(out.ok).toBe(true);
    expect((s.inserted[0] as { plan: { fields: { rules_text: string } } }).plan.fields.rules_text).toBe("Flying");
  });

  it("a fill that designs the type: a Spacecraft with tiers takes the station frame, a tierless one the Artifact frame", async () => {
    s.answers = [[ship()]];
    await createCardFillJob({ want: ["card_type", "color_identity", "rules_text", "stats"], locked: {}, steer: { card_type: "artifact" }, frame: "m15station" });
    expect((s.inserted[0]!.plan as { frame_template: string }).frame_template).toBe("m15station");
    s.answers = [[ship({ rules_text: "Flying" })], null];
    await createCardFillJob({ want: ["card_type", "color_identity", "rules_text", "stats"], locked: {}, steer: { card_type: "artifact" }, frame: "m15station" });
    expect((s.inserted[1]!.plan as { frame_template: string }).frame_template).toBe("m15artifact");
  });
});
