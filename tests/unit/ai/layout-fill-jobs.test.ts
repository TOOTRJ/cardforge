import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { LAYOUT_DESIGNS, SAGA, SPLIT, WANT_ALL } from "./fixtures/layout-designs";

// ---------------------------------------------------------------------------
// Sagas and two-part cards from the AI dialog (PR 2), driven through the
// REAL fill job (plan + step) and the REAL credit wrapper over stubbed
// Supabase, ledger helpers, model and image calls — design → plan → step →
// what the creator is handed, for every kind:
//
//   - the design is made for the kind's one frame (the brief names its shape)
//     and kept there; a design that can't be saved there is redone once with
//     why, then refused at PLAN time (no job, nothing reserved);
//   - a saga's rows come back as its rules text; a two-part card's second
//     part as the creator's back_face fields, only those its frame draws;
//   - each part in its own colour where the frame draws it (on where both
//     colours are verified, off where not); color_identity the WHOLE card's;
//   - ONE picture, one credit.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  inserted: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  spend: vi.fn(),
  refund: vi.fn(),
  job: null as unknown as Record<string, unknown>,
  answers: [] as unknown[][],
  prompts: [] as string[],
  imagePrompts: [] as string[][],
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") return { data: { job: s.job, step_key: "fill:0" }, error: null };
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
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
  const image = async (prompts: string[]) => {
    s.imageCalls += 1;
    s.imagePrompts.push(prompts);
    return { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", promptIndex: 0 };
  };
  return {
    ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
    generatePlainImage: image,
    generateImageWithFallbacks: image,
  };
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

import { createCardFillJob, runNextJobStep } from "@/lib/ai/generation-jobs";
import { LAYOUT_TEMPLATE, sagaReminder, type AiLayoutKind } from "@/lib/ai/layout-design";
import { frameArtBrief } from "@/lib/ai/frame-art-brief";

const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const EVERY = FRAME_TEMPLATE_VALUES.flatMap((template) => COLOURS.map((colour) => frameComboKey(template as FrameTemplate, colour)));
const designPrompts = () => s.prompts.filter((prompt) => prompt.includes("Fresh design #"));
const plan = () => s.inserted.at(-1)!.plan as Record<string, unknown> & { fields: Record<string, unknown>; frame_template: string | null; art_brief?: string };

beforeEach(() => {
  s.verified = EVERY;
  s.inserted = [];
  s.patched = [];
  s.answers = [];
  s.prompts = [];
  s.imagePrompts = [];
  s.imageCalls = 0;
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const fill = (layout: AiLayoutKind, over: Record<string, unknown> = {}) =>
  createCardFillJob({
    want: WANT_ALL as never,
    locked: {},
    steer: {},
    frame: LAYOUT_TEMPLATE[layout],
    layout,
    ...over,
  });

async function stepOf(stored: Record<string, unknown>) {
  s.job = { id: "job-1", owner_id: USER, kind: "card_fill", status: "generating", request: {}, deck_id: null, error: null, plan: stored, steps: [{ key: "fill:0", label: "Card", status: "running" }] };
  const result = await runNextJobStep("job-1", "fill:0");
  expect(result.ok).toBe(true);
  return s.patched.at(-1)! as { status: string; fill?: Record<string, unknown>; spend_ref?: string };
}

/** What the creator is handed for each kind, the art aside. */
const HANDED: Record<AiLayoutKind, Record<string, unknown>> = {
  saga: {
    card_type: "enchantment",
    subtypes: ["Saga"],
    color_identity: ["green"],
    rules_text: `${sagaReminder(3)}\nI — Draw a card.\nII, III — Create a 2/2 green Bear creature token.`,
    frame_template: "saga",
  },
  adventure: {
    card_type: "creature",
    power: "4",
    toughness: "4",
    frame_template: "adventure",
    back_face: { card_type: "instant", supertype: null, subtypes: ["Adventure"], title: "Stomp Through", cost: "{1}{G}", rules_text: "Target creature you control gets +2/+2 until end of turn.", color_identity: ["green"] },
    part_color: true,
  },
  prepare: {
    card_type: "creature",
    frame_template: "prepare",
    back_face: { card_type: "sorcery", supertype: null, subtypes: [], title: "Gentle Recall", cost: "{W}", rules_text: "You gain 3 life.", color_identity: ["white"] },
    part_color: true,
  },
  split: {
    card_type: "instant",
    // The WHOLE card's colour (M2) — the first half's own is frame data.
    color_identity: ["red", "blue", "multicolor"],
    frame_template: "split",
    back_face: { card_type: "instant", supertype: null, subtypes: [], title: "Frostbind", cost: "{1}{U}", rules_text: "Tap target permanent. Draw a card.", color_identity: ["blue"] },
    part_color: true,
    first_part_color: ["red"],
  },
  aftermath: {
    card_type: "sorcery",
    color_identity: ["red", "green", "multicolor"],
    frame_template: "aftermath",
    back_face: {
      card_type: "sorcery",
      title: "Regrowth Rite",
      cost: "{3}{G}",
      rules_text: "Aftermath (Cast this spell only from your graveyard. Then exile it.)\nCreate two 2/2 green Wolf creature tokens.",
      color_identity: ["green"],
    },
    part_color: true,
    first_part_color: ["red"],
  },
  flip: {
    card_type: "creature",
    supertype: "Legendary",
    frame_template: "flip",
    // No cost (a flipped side has none), its own P/T.
    back_face: { card_type: "creature", supertype: "Legendary", subtypes: ["Human", "Wizard"], title: "Ashen Pyromancer", rules_text: expect.stringContaining("Ashen Pyromancer deals 1 damage"), power: "3", toughness: "3" },
  },
};

describe("design → plan → step → what the creator is handed, per kind", () => {
  it.each(Object.keys(HANDED) as AiLayoutKind[])("%s", async (kind) => {
    s.answers = [[structuredClone(LAYOUT_DESIGNS[kind])]];
    const out = await fill(kind);
    expect(out.ok).toBe(true);
    // ONE design, briefed with the kind's frame and shape; the schema's
    // extra field is asked for by name.
    expect(designPrompts()).toHaveLength(1);
    expect(designPrompts()[0]).toContain("FRAME (the maker picked it — design the card FOR it)");
    expect(designPrompts()[0]).toContain(kind === "saga" ? "Write `saga`" : "Write `second_part`");
    expect(plan().frame_template).toBe(LAYOUT_TEMPLATE[kind]);
    expect(plan().art_brief).toBe(frameArtBrief(LAYOUT_TEMPLATE[kind]));
    expect(s.spend).not.toHaveBeenCalled();
    // The one step: one picture, one credit.
    const step = await stepOf(plan());
    expect(step.status).toBe("done");
    expect(step.fill).toMatchObject(HANDED[kind]);
    expect(step.fill!.art_url).toMatch(/card-art/);
    expect(s.imageCalls).toBe(1);
    expect(s.spend.mock.calls.map((call) => [call[0], call[1]])).toEqual([[1, "fill_card"]]);
    expect(s.refund).not.toHaveBeenCalled();
    // A second part never carries a field its frame never draws.
    const back = (step.fill!.back_face ?? {}) as Record<string, unknown>;
    for (const key of ["flavor_text", "artist_credit", "loyalty", "defense"]) expect(back, `${kind} ${key}`).not.toHaveProperty(key);
    // A split / aftermath half's own window shows the SAME stored picture
    // (owner 2026-10-28) — painted once, one credit; no other part gets one.
    if (kind === "split" || kind === "aftermath") expect(back.art_url).toBe(step.fill!.art_url);
    else expect(back, `${kind} art_url`).not.toHaveProperty("art_url");
    if (kind !== "flip") {
      expect(back).not.toHaveProperty("power");
      expect(back).not.toHaveProperty("toughness");
    } else {
      expect(back).not.toHaveProperty("cost");
    }
    if (kind === "saga") expect(step.fill).not.toHaveProperty("back_face");
  });

  it("the art is the card's one picture, with the frame's direction", async () => {
    s.answers = [[structuredClone(SPLIT)]];
    await fill("split");
    const step = await stepOf(plan());
    expect(s.imagePrompts[0]![0]).toContain("ONE picture for the whole card");
    // Painted ONCE and stored once; the same URL in both windows.
    expect(s.imageCalls).toBe(1);
    expect((step.fill!.back_face as Record<string, unknown>).art_url).toBe(step.fill!.art_url);
  });

  it("a fill that doesn't paint leaves the second half's window as it is", async () => {
    s.answers = [[structuredClone(SPLIT)]];
    await fill("split", { want: WANT_ALL.filter((field) => field !== "art") });
    const step = await stepOf(plan());
    expect(step.fill!.back_face).not.toHaveProperty("art_url");
    expect(s.imageCalls).toBe(0);
  });
});

describe("the fit, at plan time — nothing reserved before it", () => {
  it("a design that can't be saved on the frame is redone ONCE, told why", async () => {
    const broken = { ...structuredClone(SPLIT), second_part: null };
    s.answers = [[broken], [], [structuredClone(SPLIT)]];
    const out = await fill("split");
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect(designPrompts()[1]).toContain("YOUR LAST DESIGN COULD NOT BE PUT ON THIS FRAME: A two-part card needs its second_part.");
    expect((plan().fields.back_face as Record<string, unknown>).title).toBe("Frostbind");
  });

  it("twice: refused with frame_unfit — no job, nothing reserved, and it says so", async () => {
    const broken = { ...structuredClone(SPLIT), second_part: null };
    s.answers = [[broken], [], [structuredClone(broken)], []];
    const out = await fill("split");
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(!out.ok && out.error).toContain("No credits were used.");
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("a saga whose rows the judge can't mend is repaired by the autofix (renumbered, never invented) and kept", async () => {
    const offset = { ...structuredClone(SAGA), saga: { intro: null, chapters: [{ numerals: [2], text: "Draw a card." }, { numerals: [3, 4], text: "Create a 2/2 green Bear creature token." }] } };
    s.answers = [[offset], []];
    const out = await fill("saga");
    expect(out.ok).toBe(true);
    expect(plan().fields.rules_text).toBe(`${sagaReminder(3)}\nI — Draw a card.\nII, III — Create a 2/2 green Bear creature token.`);
  });

  it("a saga keeping a rules text with no chapters is refused before any model call", async () => {
    const out = await fill("saga", { want: ["card_type", "title", "art"], locked: { rules_text: "Draw a card." } });
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(s.prompts).toEqual([]);
  });

  it("a second part's colour not verified on the frame: the look OFF, the card's whole colour — never a refusal", async () => {
    s.verified = EVERY.filter((key) => key !== "split/u");
    s.answers = [[structuredClone(SPLIT)]];
    const out = await fill("split");
    expect(out.ok).toBe(true);
    expect(plan().fields).toMatchObject({ part_color: false, back_face: { color_identity: [] } });
    expect(plan().fields).not.toHaveProperty("first_part_color");
  });

  it("a free colour is held to the colours the frame is published in", async () => {
    s.verified = [...EVERY.filter((key) => !key.startsWith("saga/")), "saga/g"];
    s.answers = [[structuredClone(SAGA)]];
    await fill("saga");
    expect(designPrompts()[0]).toContain("Its color must be green");
    expect(designPrompts()[0]).toContain("color: green.");
  });

  it("a kept colour that doesn't cover the second part: redone, then refused", async () => {
    // (A clean design: no judge call between the two.)
    s.answers = [[structuredClone(SPLIT)], [structuredClone(SPLIT)]];
    const out = await fill("split", { want: ["card_type", "title", "cost", "rules_text", "art"], locked: { color_identity: ["red"] } });
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(s.inserted).toEqual([]);
  });
});

describe("what the maker keeps", () => {
  it("the second part's kept fields are pinned for the designer and never written back", async () => {
    s.answers = [[structuredClone(SPLIT)]];
    const out = await fill("split", {
      want: ["card_type", "color_identity", "cost", "rules_text"],
      locked: { title: "Emberlash", back_face: { title: "Frostbind" } },
    });
    expect(out.ok).toBe(true);
    expect(designPrompts()[0]).toContain('Its second part already exists in part. Keep these EXACTLY as given in second_part, verbatim: title "Frostbind".');
    const back = plan().fields.back_face as Record<string, unknown>;
    expect(back).not.toHaveProperty("title");
    expect(back).toMatchObject({ cost: "{1}{U}", rules_text: "Tap target permanent. Draw a card." });
  });

  it("a one-faced fill asks for what it always did: no layout field, no layout words", async () => {
    s.answers = [[{ ...structuredClone(LAYOUT_DESIGNS.adventure), second_part: undefined }]];
    const out = await createCardFillJob({ want: ["card_type", "title"] as never, locked: {}, steer: { card_type: "creature" }, frame: "m15", designKind: "creature" });
    expect(out.ok).toBe(true);
    expect(designPrompts()[0]).not.toContain("second_part");
    expect(plan().fields).not.toHaveProperty("back_face");
    expect(plan().fields).not.toHaveProperty("part_color");
  });
});
