import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { WANT_ALL } from "./fixtures/layout-designs";
import { DFC_DESIGNS, DFC_FRONT, TRANSFORM } from "./fixtures/dfc-designs";

// ---------------------------------------------------------------------------
// Double-faced cards from the AI dialog (PR 3), driven through the REAL fill
// job (plan + both steps) and the REAL credit wrapper over stubbed Supabase,
// ledger helpers, model and image calls — design → plan → steps → what the
// creator is handed, for every kind:
//
//   - the design writes the back face whole, with its own art prompt; the
//     card as the creator will hold it passes every double-faced gate at
//     PLAN time (or is redone once, then refused — nothing reserved);
//   - TWO pictures, two steps, one credit each: `fill:0` paints the front,
//     `fill:1` the back from its own prompt in its own body's window with
//     its body's art direction.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  inserted: [] as Record<string, unknown>[],
  patched: [] as Array<{ key: string; patch: Record<string, unknown> }>,
  spend: vi.fn(),
  refund: vi.fn(),
  job: null as unknown as { steps: Array<Record<string, unknown>> } & Record<string, unknown>,
  answers: [] as unknown[][],
  prompts: [] as string[],
  imagePrompts: [] as string[][],
  imageShapes: [] as Array<{ width: number; height: number }>,
  imageCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester", is_admin: false }),
  createClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        insert: (row: Record<string, unknown>) => {
          s.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "job-1", ...row }, error: null }) }) };
        },
        maybeSingle: async () => (table === "ai_generation_jobs" ? { data: s.job, error: null } : { data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));
// The job store: claim_job_step / patch_job_step as migrations 0066 / 0106
// write them — the named step (or the first pending one) is claimed, and a
// patch merges into its step.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") {
        const wanted = args.p_step_key as string | null;
        const step = s.job.steps.find((candidate) =>
          wanted ? candidate.key === wanted && candidate.status !== "done" : candidate.status === "pending",
        );
        if (!step) return { data: { job: s.job, step_key: null }, error: null };
        step.status = "running";
        return { data: { job: structuredClone(s.job), step_key: step.key }, error: null };
      }
      if (name === "patch_job_step") {
        const key = args.p_step_key as string;
        const patch = args.p_patch as Record<string, unknown>;
        s.patched.push({ key, patch });
        s.job.steps = s.job.steps.map((step) => (step.key === key ? { ...step, ...patch } : step));
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
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
vi.mock("@/lib/ai/image-gen", async (importOriginal) => {
  const image = async (prompts: string[], shape: { width: number; height: number }) => {
    s.imageCalls += 1;
    s.imagePrompts.push(prompts);
    s.imageShapes.push(shape);
    return { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", promptIndex: 0 };
  };
  return {
    ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
    generatePlainImage: image,
    generateImageWithFallbacks: image,
  };
});
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({ ok: true, publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/art-${s.imageCalls}.png` }),
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
}));

import { createCardFillJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { frameArtBrief } from "@/lib/ai/frame-art-brief";
import type { AiDfcKind } from "@/lib/ai/dfc-design";

const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const EVERY = FRAME_TEMPLATE_VALUES.flatMap((template) => COLOURS.map((colour) => frameComboKey(template as FrameTemplate, colour)));
const designPrompts = () => s.prompts.filter((prompt) => prompt.includes("Fresh design #"));
type StoredPlan = Record<string, unknown> & {
  fields: Record<string, unknown> & { back_face?: Record<string, unknown> };
  frame_template: string | null;
  art_brief?: string;
  back_art?: { prompt: string; face: Record<string, unknown>; brief?: string };
};
const plan = () => s.inserted.at(-1)!.plan as StoredPlan;

beforeEach(() => {
  s.verified = EVERY;
  s.inserted = [];
  s.patched = [];
  s.answers = [];
  s.prompts = [];
  s.imagePrompts = [];
  s.imageShapes = [];
  s.imageCalls = 0;
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const fill = (kind: AiDfcKind, over: Record<string, unknown> = {}) =>
  createCardFillJob({
    want: WANT_ALL as never,
    locked: {},
    steer: {},
    frame: DFC_FRONT[kind] as FrameTemplate,
    dfc: kind,
    ...over,
  });

/** Store the plan's job as inserted and run its steps in order. */
async function runSteps() {
  const row = s.inserted.at(-1)!;
  s.job = { id: "job-1", owner_id: USER, kind: "card_fill", status: "generating", request: {}, deck_id: null, error: null, plan: row.plan, steps: structuredClone(row.steps as Array<Record<string, unknown>>) };
  for (const step of s.job.steps.map((candidate) => candidate.key as string)) {
    const result = await runNextJobStep("job-1", step);
    expect(result.ok).toBe(true);
  }
  return s.job.steps as Array<{ key: string; status: string; fill?: Record<string, unknown> & { back_face?: Record<string, unknown> }; spend_ref?: string | null }>;
}

/** What each kind's FRONT step hands the creator (its text), art aside. */
const HANDED: Record<AiDfcKind, Record<string, unknown>> = {
  transform: {
    card_type: "creature",
    color_identity: ["red"],
    frame_template: "m15dfcfront",
    back_face: { title: "Moonlit Ravager", cost: "", card_type: "creature", subtypes: ["Werewolf"], rules_text: "Trample", power: "5", toughness: "4", color_identity: ["red"] },
  },
  mdfc: {
    card_type: "sorcery",
    color_identity: ["blue"],
    frame_template: "m15mdfcfront",
    back_face: { title: "Tidecaller's Grotto", cost: "", card_type: "land", rules_text: "This land enters tapped.\n{T}: Add {U}.", power: null, toughness: null, color_identity: ["blue"] },
  },
  dfc_saga: {
    card_type: "enchantment",
    subtypes: ["Saga"],
    frame_template: "sagadfcfront",
    rules_text: expect.stringContaining("(As this Saga enters and after your draw step, add a lore counter.)\nI — You gain 3 life."),
    back_face: { title: "Lantern Oathkeeper", cost: "", card_type: "creature", power: "3", toughness: "3", color_identity: ["white"] },
  },
  dfc_token: {
    card_type: "token",
    supertype: "Creature",
    frame_template: "m20token",
    back_face: { title: "Soldier", cost: "", card_type: "token", supertype: "Creature", subtypes: ["Soldier"], power: "1", toughness: "1", color_identity: ["white"] },
  },
};

const BACK_BODY: Record<AiDfcKind, string> = { transform: "m15dfcback", mdfc: "m15mdfclandback", dfc_saga: "m15dfcback", dfc_token: "m20token" };

describe("design → plan → two steps → what the creator is handed, per kind", () => {
  it.each(Object.keys(HANDED) as AiDfcKind[])("%s", async (kind) => {
    s.answers = [[structuredClone(DFC_DESIGNS[kind])]];
    const out = await fill(kind);
    expect(out.ok).toBe(true);
    // ONE design, briefed with the kind's shape and its back face.
    expect(designPrompts()).toHaveLength(1);
    expect(designPrompts()[0]).toContain("Write `back_face`");
    expect(plan().frame_template).toBe(DFC_FRONT[kind]);
    // Each face its own picture: the front's direction and the back's —
    // from its OWN prompt, in its own body's window.
    expect(plan().art_brief ?? "").toBe(frameArtBrief(DFC_FRONT[kind]));
    expect(plan().back_art).toMatchObject({
      prompt: DFC_DESIGNS[kind].back_face!.art_prompt,
      face: { template: BACK_BODY[kind] },
    });
    expect(plan().back_art!.brief ?? "").toBe(frameArtBrief(BACK_BODY[kind]));
    // Two steps, nothing reserved at plan time.
    expect((s.inserted.at(-1)!.steps as Array<{ key: string }>).map((step) => step.key)).toEqual(["fill:0", "fill:1"]);
    expect(s.spend).not.toHaveBeenCalled();
    const steps = await runSteps();
    expect(steps.map((step) => step.status)).toEqual(["done", "done"]);
    expect(steps[0]!.fill).toMatchObject(HANDED[kind]);
    expect(steps[0]!.fill!.art_url).toMatch(/art-1\.png$/);
    // The back's picture is its own (the back step's), with its credit.
    expect(steps[1]!.fill).toEqual({ back_face: { art_url: expect.stringMatching(/art-2\.png$/), artist_credit: "Tester" } });
    expect(s.imageCalls).toBe(2);
    expect(s.imagePrompts[1]![0]).toContain(DFC_DESIGNS[kind].back_face!.art_prompt);
    expect(s.imagePrompts[1]![0]).not.toContain(DFC_DESIGNS[kind].art_prompt);
    // One credit per picture, each step its own ledger ref, both settled.
    expect(s.spend.mock.calls.map((call) => [call[0], call[1]])).toEqual([[1, "fill_card"], [1, "fill_card"]]);
    const refs = s.spend.mock.calls.map((call) => (call[2] as { ref: string }).ref);
    expect(refs[0]).toMatch(/^spend:job-1:fill:0:/);
    expect(refs[1]).toMatch(/^spend:job-1:fill:1:/);
    expect(steps.map((step) => step.spend_ref)).toEqual(refs);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("a fill that doesn't paint is ONE step and one credit, as any fill", async () => {
    s.answers = [[structuredClone(TRANSFORM)]];
    await fill("transform", { want: WANT_ALL.filter((field) => field !== "art") });
    expect((s.inserted.at(-1)!.steps as unknown[]).length).toBe(1);
    expect(plan().back_art).toBeUndefined();
    const steps = await runSteps();
    expect(steps[0]!.status).toBe("done");
    expect(s.imageCalls).toBe(0);
    expect(s.spend.mock.calls.map((call) => call[0])).toEqual([1]);
  });

  it("the back's picture is painted in its OWN body's window (a land back's, a token's)", async () => {
    s.answers = [[structuredClone(DFC_DESIGNS.mdfc)]];
    await fill("mdfc");
    expect(plan().back_art!.face).toMatchObject({ template: "m15mdfclandback", card_type: "land", color_identity: ["blue"] });
  });
});

describe("the fit, at plan time — nothing reserved before it", () => {
  it("a back that can't be saved is redone ONCE, told why", async () => {
    const broken = { ...structuredClone(TRANSFORM), back_face: null };
    s.answers = [[broken], [], [structuredClone(TRANSFORM)]];
    const out = await fill("transform");
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect(designPrompts()[1]).toContain("YOUR LAST DESIGN COULD NOT BE SAVED AS THIS DOUBLE-FACED CARD: A double-faced card needs its back_face.");
  });

  it("twice: refused with frame_unfit — no job, nothing reserved, and it says so", async () => {
    const broken = { ...structuredClone(TRANSFORM), back_face: null };
    s.answers = [[broken], [], [structuredClone(broken)], []];
    const out = await fill("transform");
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(!out.ok && out.error).toContain("No credits were used.");
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("a back colour its body isn't published in: redone, then refused", async () => {
    s.verified = ["m15dfcfront", "m15dfcback"].flatMap((template) => [frameComboKey(template, "r")]);
    const greenBack = { ...structuredClone(TRANSFORM), back_face: { ...TRANSFORM.back_face!, color_identity: ["green"] } };
    s.answers = [[structuredClone(greenBack)], [structuredClone(greenBack)]];
    const out = await fill("transform");
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("a land front on the spell front is kept on the land front — and told", async () => {
    const land = {
      ...structuredClone(TRANSFORM),
      card_type: "land",
      cost: "—",
      subtypes: [],
      rules_text: "{T}: Add {R}.",
      power: null,
      toughness: null,
    };
    s.answers = [[structuredClone(land)], [structuredClone(land)]];
    const out = await fill("transform");
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect(plan().frame_template).toBe("m15dfclandfront");
    expect(plan().frame_notice).toBe("Designed as a land, so it's on Transform land front.");
  });

  it("a kept colour no front is published in is refused before any model call", async () => {
    s.verified = ["m15dfcfront", "m15dfcback"].flatMap((template) => [frameComboKey(template, "r")]);
    const out = await fill("transform", { want: WANT_ALL.filter((field) => field !== "color_identity"), locked: { color_identity: ["green"] } });
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(!out.ok && out.error).toMatch(/aren't published in green yet/);
    expect(s.prompts).toEqual([]);
  });
});

describe("the icon family (review of #639)", () => {
  it("the plan judges and paints the back on the body the card's family derives", async () => {
    s.answers = [[structuredClone(TRANSFORM)]];
    const out = await fill("transform", { dfcIcon: "sunmoon" });
    expect(out.ok).toBe(true);
    expect(plan().back_art!.face.template).toBe("m15dfcbackleft");
  });
});
