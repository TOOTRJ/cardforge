import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// A failed AI generation never costs the user a credit, and the user is told
// so in plain words (2026-10-28, fix/ai-generation-live).
//
// Drives the REAL jobs (plan + step) and the REAL credit wrapper over stubbed
// Supabase, ledger helpers, model, image calls and card actions, at every
// failure point after a reserve:
//
//   failure point                     credit                 the step says
//   ──────────────────────────────    ─────────────────────  ─────────────────────
//   design fails (plan time)          never reserved         "No credits were used."
//   image refused / timed out         refunded once          "…returned."
//   image provider error (raw text)   refunded once          our sentence, no raw text
//   art could not be stored           refunded once          "…returned."
//   the card save is refused          refunded once          the save's own words
//   the step throws                   refunded once          "Something went wrong…"
//   a refund that doesn't land        left to the sweep      "…comes back … within the hour"
//   admin / billing off               never charged          "No credits were used."
//   out of credits                    nothing reserved       the out-of-credits words
//   a finished step asked again       never charged again    (the result, no charge)
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  inserted: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  created: [] as Record<string, unknown>[],
  spend: vi.fn(),
  refund: vi.fn(),
  job: null as unknown as Record<string, unknown>,
  stepKey: "fill:0" as string | null,
  answers: [] as unknown[][],
  designError: null as Error | null,
  prompts: [] as string[],
  image: null as null | { ok: boolean; [key: string]: unknown },
  imageThrows: null as Error | null,
  imageCalls: 0,
  persistOk: true,
  createResult: null as null | Record<string, unknown>,
  createThrows: null as Error | null,
  recentLabels: [] as string[],
  eqs: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester", is_admin: false }),
  createClient: async () => ({
    from: (table: string) => {
      const result = () =>
        table === "ai_generation_jobs"
          ? { data: s.recentLabels.length ? [{ steps: s.recentLabels.map((label) => ({ label })) }] : [], error: null }
          : { data: [], error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          s.eqs.push([table, column, value]);
          return chain;
        },
        in: () => chain,
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
        then: (resolve: (value: unknown) => unknown) => resolve(result()),
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
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: async (args: { prompt: string }) => {
    s.prompts.push(args.prompt);
    if (s.designError) throw s.designError;
    return { object: { cards: s.answers.shift() ?? [] } };
  },
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  designModel: () => "test/design",
  judgeModel: () => "test/judge",
}));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async () => {
    s.imageCalls += 1;
    if (s.imageThrows) throw s.imageThrows;
    return s.image ?? { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", promptIndex: 0 };
  };
  return {
    ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
    generatePlainImage: image,
    generateImageWithFallbacks: image,
    restyleImage: image,
  };
});
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () =>
    s.persistOk
      ? { ok: true, publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png` }
      : { ok: false, error: "storage: The resource already exists (409) bucket card-art" },
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    if (s.createThrows) throw s.createThrows;
    s.created.push(payload);
    return s.createResult ?? { ok: true, cardId: "card-1", slug: "made" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { createCardFillJob, createCardGenerationJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { failedStepMessage } from "@/lib/ai/failure";
import { frameChoicesForType } from "@/lib/creator/frame-random";
import { LAYOUT_DESIGNS, WANT_ALL } from "./fixtures/layout-designs";
import { DFC_DESIGNS, DFC_FRONT, TRANSFORM } from "./fixtures/dfc-designs";

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
  flavor_text: "Its allies learned to fly behind it.",
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  art_prompt: "A crimson dragon over a caldera at dawn.",
  ...over,
});

const FILL_PLAN = {
  want: ["title", "rules_text", "art"],
  fields: { title: "Emberwake Tyrant", rules_text: "Flying, haste" },
  art_prompt: "A crimson dragon over a caldera at dawn.",
  style: null,
  frame_template: null,
  deck_id: null,
};
const CARD_PLAN = { card: designed(), style: null, frame_template: "m15", deck_id: null };

function job(kind: string, plan: Record<string, unknown>, stepKey: string, step: Record<string, unknown> = {}) {
  s.stepKey = stepKey;
  s.job = {
    id: "job-1",
    owner_id: USER,
    kind,
    status: "generating",
    request: {},
    deck_id: null,
    error: null,
    plan,
    steps: [{ key: stepKey, label: "Card", status: "running", ...step }],
  };
}

async function runStep(stepKey: string) {
  const result = await runNextJobStep("job-1", stepKey);
  expect(result.ok).toBe(true);
  return s.patched.at(-1)!;
}

const charged = () => s.spend.mockResolvedValue({ ok: true, balance: 4, charged: true });

beforeEach(() => {
  s.verified = EVERY;
  s.inserted = [];
  s.patched = [];
  s.created = [];
  s.answers = [];
  s.prompts = [];
  s.designError = null;
  s.image = null;
  s.imageThrows = null;
  s.imageCalls = 0;
  s.persistOk = true;
  s.createResult = null;
  s.createThrows = null;
  s.recentLabels = [];
  s.eqs = [];
  s.spend.mockReset();
  charged();
  s.refund.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("plan-time failures never reserve a credit", () => {
  it("a design the provider refuses (rate limit) — no job, no reserve, the user's sentence", async () => {
    s.designError = new Error("Gateway: 429 Too Many Requests from anthropic (request id abc123)");
    const out = await createCardFillJob({ want: ["title", "rules_text"] as never, locked: {}, steer: {} });
    expect(out).toMatchObject({ ok: false, code: "design_busy" });
    expect(!out.ok && out.error).toBe("The AI service is busy right now. Wait a minute, then try again. No credits were used.");
    expect(!out.ok && out.error).not.toContain("abc123");
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("a provider credential problem never tells the user about server keys", async () => {
    s.designError = new Error("401 Unauthorized: invalid api key sk-live-REDACTED");
    const out = await createCardGenerationJob({ theme: "embers" });
    expect(out).toMatchObject({ ok: false, code: "ai_unavailable" });
    expect(!out.ok && out.error).not.toMatch(/key|401|sk-/i);
    expect(s.spend).not.toHaveBeenCalled();
  });
});

describe("the fill step: every failure after the reserve is refunded once, and said so", () => {
  it("an image the safety filter refused", async () => {
    s.image = { ok: false, error: "The image service's safety filter declined this artwork.", failure: "art_blocked", safetyBlocked: true };
    job("card_fill", FILL_PLAN, "fill:0");
    const step = await runStep("fill:0");
    expect(step).toMatchObject({ status: "failed", failure: "art_blocked", refunded: 1, refund_pending: false, spend_ref: null });
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(String(s.refund.mock.calls[0]![3])).toMatch(/^refund:spend:job-1:fill:0:/);
    expect(failedStepMessage(step)).toBe(
      "The image service's safety filter declined this artwork. Try again — each try rewords the art prompt — or change the theme. Your credit was returned.",
    );
  });

  it("an image that timed out", async () => {
    s.image = { ok: false, error: "x", failure: "art_timeout", safetyBlocked: true };
    job("card_fill", FILL_PLAN, "fill:0");
    const step = await runStep("fill:0");
    expect(step).toMatchObject({ failure: "art_timeout", refunded: 1 });
    expect(failedStepMessage(step)).toContain("took too long");
    expect(failedStepMessage(step)).toContain("Your credit was returned.");
  });

  it("art that couldn't be stored — the storage text never reaches the user", async () => {
    s.persistOk = false;
    job("card_fill", FILL_PLAN, "fill:0");
    const step = await runStep("fill:0");
    expect(step).toMatchObject({ status: "failed", failure: "art_store", refunded: 1 });
    expect(String(step.error)).not.toContain("409");
    expect(s.refund).toHaveBeenCalledTimes(1);
  });

  it("a refund that doesn't land is pending — the user is told it comes back by itself", async () => {
    s.image = { ok: false, error: "x", failure: "art_failed", safetyBlocked: false };
    s.refund.mockResolvedValue(false);
    job("card_fill", FILL_PLAN, "fill:0");
    const step = await runStep("fill:0");
    expect(step).toMatchObject({ refunded: 0, refund_pending: true });
    expect(failedStepMessage(step)).toContain("comes back to you automatically within the hour");
  });

  it("an uncharged run (admin / billing off) says no credit was used, and refunds nothing", async () => {
    s.spend.mockResolvedValue({ ok: true, balance: Number.POSITIVE_INFINITY, charged: false });
    s.image = { ok: false, error: "x", failure: "art_busy", safetyBlocked: false };
    job("card_fill", FILL_PLAN, "fill:0");
    const step = await runStep("fill:0");
    expect(s.refund).not.toHaveBeenCalled();
    expect(failedStepMessage(step)).toBe("The image service is busy right now. Wait a minute, then try again. No credits were used.");
  });

  it("out of credits: nothing reserved, nothing painted", async () => {
    s.spend.mockResolvedValue({ ok: false, reason: "insufficient_credits", balance: 0, message: "You're out of AI credits." });
    job("card_fill", FILL_PLAN, "fill:0");
    const step = await runStep("fill:0");
    expect(step).toMatchObject({ status: "failed", error_code: "INSUFFICIENT_CREDITS" });
    expect(s.imageCalls).toBe(0);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("a step that already holds its result is never charged again (a duplicate request, a second tab)", async () => {
    job("card_fill", FILL_PLAN, "fill:0", { fill: { title: "Emberwake Tyrant" } });
    const step = await runStep("fill:0");
    expect(step.status).toBe("done");
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.imageCalls).toBe(0);
  });

  it("a finished job asked again claims nothing and charges nothing", async () => {
    job("card_fill", FILL_PLAN, "fill:0");
    s.stepKey = null; // claim_job_step: nothing claimable (done)
    const result = await runNextJobStep("job-1", "fill:0");
    expect(result.ok).toBe(true);
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.patched).toEqual([]);
  });
});

describe("the single-card step", () => {
  it("a refused save is refunded and keeps the save's own words", async () => {
    s.createResult = { ok: false, fieldErrors: { frame_style: "That frame isn't available in red yet — pick another frame or colour." } };
    job("card", CARD_PLAN, "card:0");
    const step = await runStep("card:0");
    expect(step).toMatchObject({ status: "failed", failure: "save_failed", refunded: 1 });
    expect(s.imageCalls).toBe(0);
    expect(failedStepMessage(step)).toBe(
      "That frame isn't available in red yet — pick another frame or colour. Your credit was returned.",
    );
  });

  it("a step that throws is refunded once, and the internal text stays in the log", async () => {
    s.createThrows = new Error("TypeError: cannot read properties of undefined (reading 'template') at lib/cards/actions.ts:412");
    job("card", CARD_PLAN, "card:0");
    const step = await runStep("card:0");
    expect(step).toMatchObject({ status: "failed", failure: "step_failed", refunded: 1, spend_ref: null });
    expect(String(step.error)).not.toContain("TypeError");
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(failedStepMessage(step)).toBe("Something went wrong while making this card. Try again. Your credit was returned.");
  });

  it("a success settles: the ref is stamped and no refund runs", async () => {
    job("card", CARD_PLAN, "card:0");
    const step = await runStep("card:0");
    expect(step).toMatchObject({ status: "done", failure: null, refunded: null });
    expect(String(step.spend_ref)).toMatch(/^spend:job-1:card:0:/);
    expect(s.refund).not.toHaveBeenCalled();
  });
});

describe("the same options twice never reuse a design (the owner's two identical cards)", () => {
  it("two fills with the same options send two different prompts", async () => {
    s.answers = [[designed()], [designed({ title: "Ashveil Courier" })]];
    const options = { want: ["title", "rules_text", "flavor_text", "art"] as never, locked: {}, steer: {} };
    await createCardFillJob(options);
    await createCardFillJob(options);
    expect(s.prompts).toHaveLength(2);
    expect(s.prompts[0]).not.toBe(s.prompts[1]);
    expect(s.prompts[0]).toMatch(/Fresh design #[0-9a-f]{8}/);
  });

  it("the recent titles are read for the caller only (owner filter beside RLS)", async () => {
    s.answers = [[designed({ title: "Ashveil Courier" })]];
    await createCardFillJob({ want: ["title"] as never, locked: {}, steer: {} });
    expect(s.eqs).toContainEqual(["ai_generation_jobs", "owner_id", USER]);
    expect(s.eqs).toContainEqual(["card_idea_batches", "owner_id", USER]);
  });

  it("an unreadable frame list never refuses a free design (an empty set avoids nothing)", async () => {
    s.verified = [];
    s.answers = [[designed()]];
    const out = await createCardFillJob({ want: ["card_type", "title"] as never, locked: {}, steer: {} });
    expect(out.ok).toBe(true);
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]).not.toContain("anything but");
  });

  it("a free type with no published frame in the design's OWN colour is designed again", async () => {
    // Every frame published, but no planeswalker frame in red.
    const walkerFrames = new Set(frameChoicesForType("planeswalker", new Set(EVERY)).map((choice) => choice.template));
    s.verified = EVERY.filter((key) => {
      const [template, colour] = key.split("/");
      return !(walkerFrames.has(template as FrameTemplate) && colour === "r");
    });
    const walker = designed({
      title: "Veyra, Ember Oracle",
      card_type: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Veyra"],
      rules_text: "+1: Draw a card.\n-3: Veyra deals 3 damage to any target.",
      flavor_text: null,
      loyalty: "4",
      power: null,
      toughness: null,
    });
    s.answers = [[walker], [designed()]];
    const out = await createCardFillJob({ want: ["card_type", "color_identity", "title", "rules_text"] as never, locked: {}, steer: {} });
    expect(out.ok).toBe(true);
    // Two DESIGN calls (each a fresh spark) — the walker was never kept.
    expect(s.prompts.filter((prompt) => prompt.includes("Fresh design #"))).toHaveLength(2);
    expect((s.inserted.at(-1)!.plan as { fields: { card_type?: string } }).fields.card_type).toBe("creature");
  });

  it("the user's recent AI titles are named as off-limits", async () => {
    s.recentLabels = ["Emberwake Tyrant", "Your card"];
    s.answers = [[designed({ title: "Ashveil Courier" })]];
    await createCardFillJob({ want: ["title", "rules_text"] as never, locked: {}, steer: {} });
    expect(s.prompts[0]).toContain('do NOT reuse or echo their names or concepts: "Emberwake Tyrant"');
    expect(s.prompts[0]).not.toContain('"Your card"');
  });

  it("a design that repeats a recent title is designed again before the job exists (no extra charge)", async () => {
    s.recentLabels = ["Emberwake Tyrant"];
    s.answers = [[designed()], [designed({ title: "Ashveil Courier" })]];
    const out = await createCardFillJob({ want: ["title", "rules_text"] as never, locked: {}, steer: {} });
    expect(out.ok).toBe(true);
    expect(s.prompts).toHaveLength(2);
    expect(s.prompts[1]).toContain('"Emberwake Tyrant"');
    const plan = s.inserted.at(-1)!.plan as { fields: { title?: string } };
    expect(plan.fields.title).toBe("Ashveil Courier");
    // Planning reserves nothing — the one credit is the step's.
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("the single-card job: same options, different prompts, a repeat designed again", async () => {
    s.recentLabels = ["Emberwake Tyrant"];
    s.answers = [[designed()], [designed({ title: "Ashveil Courier" })], [designed({ title: "Gloamtide Herald" })]];
    await createCardGenerationJob({ theme: "embers" });
    await createCardGenerationJob({ theme: "embers" });
    expect(s.prompts).toHaveLength(3);
    expect(new Set(s.prompts).size).toBe(3);
    const titles = s.inserted.map((row) => (row.plan as { card: { title: string } }).card.title);
    expect(titles).toEqual(["Ashveil Courier", "Gloamtide Herald"]);
  });

  it("a type with no published frame is designed again, and never saved (battle today)", async () => {
    s.verified = EVERY.filter((key) => !key.startsWith("battle/"));
    s.answers = [[designed({ card_type: "battle", defense: "4", power: null, toughness: null })], [designed()]];
    const out = await createCardFillJob({ want: ["card_type", "title", "rules_text", "stats"] as never, locked: {}, steer: {} });
    expect(out.ok).toBe(true);
    expect(s.prompts[0]).toContain("card_type: anything but battle.");
    const plan = s.inserted.at(-1)!.plan as { fields: { card_type?: string } };
    expect(plan.fields.card_type).toBe("creature");
  });
});

// The AI dialog's sagas and two-part cards (PR 2): one picture, one credit —
// and every gate the save runs is read at PLAN time, so a design that can't
// be saved on the kind's frame never reserves anything, and a step that
// fails after the reserve is refunded once, as every fill's is.
describe("sagas and two-part cards from the AI dialog", () => {
  const KINDS = ["saga", "adventure", "prepare", "split", "aftermath", "flip"] as const;
  const layoutFill = (kind: (typeof KINDS)[number]) =>
    createCardFillJob({ want: WANT_ALL as never, locked: {}, steer: {}, frame: kind, layout: kind });

  it.each(KINDS)("%s: a design the frame can't take, twice — refused at plan time, nothing reserved", async (kind) => {
    // No rows / no second part: the autofix never invents one.
    const broken = kind === "saga" ? { ...LAYOUT_DESIGNS.saga, saga: null, rules_text: "Draw a card." } : { ...LAYOUT_DESIGNS[kind], second_part: null };
    s.answers = [[structuredClone(broken)], [], [structuredClone(broken)], []];
    const out = await layoutFill(kind);
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(!out.ok && out.error).toContain("No credits were used.");
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.imageCalls).toBe(0);
  });

  it.each(KINDS)("%s: the step reserves ONE credit for its one picture, and a refused image returns it once", async (kind) => {
    s.answers = [[structuredClone(LAYOUT_DESIGNS[kind])]];
    const out = await layoutFill(kind);
    expect(out.ok).toBe(true);
    expect(s.spend).not.toHaveBeenCalled();
    s.image = { ok: false, error: "x", failure: "art_blocked", safetyBlocked: true };
    job("card_fill", s.inserted.at(-1)!.plan as Record<string, unknown>, "fill:0");
    const step = await runStep("fill:0");
    expect(s.spend.mock.calls.map((call) => call[0])).toEqual([1]);
    expect(step).toMatchObject({ status: "failed", failure: "art_blocked", refunded: 1 });
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(s.imageCalls).toBe(1);
    expect(failedStepMessage(step)).toContain("Your credit was returned.");
  });
});

// The AI dialog's double-faced cards (PR 3): TWO pictures, two credits — one
// step and one charge per face, each under its own ledger ref and refunded
// under `refund:{that ref}`. Every gate the save runs is read at PLAN time,
// so a design that can't be saved never reserves anything; a back that fails
// after the front succeeded returns the back's credit (the front's picture
// was delivered and its credit stands); a front that fails takes the back
// with it, uncharged.
describe("double-faced cards from the AI dialog: one credit per picture", () => {
  const KINDS = ["transform", "mdfc", "dfc_saga", "dfc_token"] as const;
  type Kind = (typeof KINDS)[number];
  const dfcFill = (kind: Kind) =>
    createCardFillJob({ want: WANT_ALL as never, locked: {}, steer: {}, frame: DFC_FRONT[kind] as FrameTemplate, dfc: kind });
  /** The two-step job as planned, with its front step in `front`'s state. */
  const twoStepJob = (plan: Record<string, unknown>, front: Record<string, unknown>, back: Record<string, unknown> = {}) => {
    job("card_fill", plan, "fill:1");
    s.job.steps = [
      { key: "fill:0", label: "Front", ...front },
      { key: "fill:1", label: "Back (back face)", ...back, status: "running" },
    ];
  };
  const refundKeys = () => s.refund.mock.calls.map((call) => call[3]);
  const spendRefs = () => s.spend.mock.calls.map((call) => (call[2] as { ref: string }).ref);

  it.each(KINDS)("%s: a design that can't be saved, twice — refused at plan time, neither credit reserved", async (kind) => {
    const broken = { ...structuredClone(DFC_DESIGNS[kind]), back_face: null };
    s.answers = [[structuredClone(broken)], [], [structuredClone(broken)], []];
    const out = await dfcFill(kind);
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(!out.ok && out.error).toContain("No credits were used.");
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.refund).not.toHaveBeenCalled();
    expect(s.imageCalls).toBe(0);
  });

  it.each(KINDS)("%s: the front OK and the back refused — the back's credit returned once, the front's stands", async (kind) => {
    s.answers = [[structuredClone(DFC_DESIGNS[kind])]];
    expect((await dfcFill(kind)).ok).toBe(true);
    const plan = s.inserted.at(-1)!.plan as Record<string, unknown>;
    job("card_fill", plan, "fill:0");
    const front = await runStep("fill:0");
    expect(front).toMatchObject({ status: "done" });
    twoStepJob(plan, front);
    s.image = { ok: false, error: "x", failure: "art_blocked", safetyBlocked: true };
    const back = await runStep("fill:1");
    expect(back).toMatchObject({ status: "failed", failure: "art_blocked", refunded: 1, spend_ref: null });
    expect(s.spend.mock.calls.map((call) => call[0])).toEqual([1, 1]);
    // Refunded exactly once, under the BACK's own charge — never the front's.
    const [frontRef, backRef] = spendRefs();
    expect(refundKeys()).toEqual([`refund:${backRef}`]);
    expect(front.spend_ref).toBe(frontRef);
    expect(failedStepMessage(back)).toContain("Your credit was returned.");
  });

  it("both faces fail: the front's credit returned, the back never charged — every credit taken comes back", async () => {
    s.answers = [[structuredClone(TRANSFORM)]];
    expect((await dfcFill("transform")).ok).toBe(true);
    const plan = s.inserted.at(-1)!.plan as Record<string, unknown>;
    s.image = { ok: false, error: "x", failure: "art_timeout" };
    job("card_fill", plan, "fill:0");
    const front = await runStep("fill:0");
    expect(front).toMatchObject({ status: "failed", refunded: 1 });
    twoStepJob(plan, front);
    const back = await runStep("fill:1");
    expect(back).toMatchObject({ status: "failed", refunded: 0, spend_ref: null });
    expect(failedStepMessage(back)).toContain("No credits were used.");
    // One charge, one refund under its own key; one picture tried.
    expect(s.spend.mock.calls.map((call) => call[0])).toEqual([1]);
    expect(refundKeys()).toEqual([`refund:${spendRefs()[0]}`]);
    expect(s.imageCalls).toBe(1);
  });

  it("both pictures fail after their own charges (a back retried after a refused one): each refunded once, under its own key", async () => {
    s.answers = [[structuredClone(TRANSFORM)]];
    expect((await dfcFill("transform")).ok).toBe(true);
    const plan = s.inserted.at(-1)!.plan as Record<string, unknown>;
    job("card_fill", plan, "fill:0");
    const front = await runStep("fill:0");
    twoStepJob(plan, front);
    s.image = { ok: false, error: "x", failure: "art_blocked", safetyBlocked: true };
    const first = await runStep("fill:1");
    twoStepJob(plan, front, first);
    s.imageThrows = new Error("socket hang up");
    const second = await runStep("fill:1");
    expect(first).toMatchObject({ status: "failed", refunded: 1 });
    expect(second).toMatchObject({ status: "failed", refunded: 1 });
    const refs = spendRefs();
    expect(refs).toHaveLength(3);
    expect(new Set(refs).size).toBe(3);
    // No double refund: one per failed charge, never the front's.
    expect(refundKeys()).toEqual([`refund:${refs[1]}`, `refund:${refs[2]}`]);
  });

  it("a finished back asked again is never charged again", async () => {
    s.answers = [[structuredClone(TRANSFORM)]];
    expect((await dfcFill("transform")).ok).toBe(true);
    const plan = s.inserted.at(-1)!.plan as Record<string, unknown>;
    twoStepJob(plan, { status: "done" }, { fill: { back_face: { art_url: "https://example.supabase.co/x.png" } } });
    const again = await runStep("fill:1");
    expect(again).toMatchObject({ status: "done" });
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.imageCalls).toBe(0);
  });
});
