import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Frame-first generation (the AI dialog redesign, PR 1), driven through the
// REAL fill job (plan + step) and the REAL credit wrapper over stubbed
// Supabase, ledger helpers, model and image calls:
//
//   - a frame picked by name is briefed to the designer and KEPT — never a
//     random draw — or the design is redone once, then refused at PLAN time
//     (no job, nothing reserved);
//   - a free colour is held to the frame's colours, a kept colour is the
//     card's;
//   - the dialog's "Surprise me" kind never comes back as a battle;
//   - the assembled theme / style reach the designer, and the style preset's
//     look and the frame's art direction reach the painter.
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
import { assemblePrompt } from "@/lib/ai/presets";

const COLOURS = ["w", "u", "b", "r", "g", "c", "m"];
const EVERY = FRAME_TEMPLATE_VALUES.flatMap((template) => COLOURS.map((colour) => frameComboKey(template as FrameTemplate, colour)));

const designed = (over: Record<string, unknown> = {}) => ({
  title: "Lanternhollow Muse",
  cost: "{1}{W}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Spirit"],
  rarity: "common",
  color_identity: ["white"],
  rules_text: "Vigilance",
  flavor_text: "She keeps the lanterns lit.",
  power: "2",
  toughness: "1",
  loyalty: null,
  defense: null,
  art_prompt: "A pale spirit with a lantern on a fog-drowned wall.",
  ...over,
});
const NYX_MUSE = designed({ supertype: "Enchantment" });
const WANT_ALL = ["card_type", "color_identity", "title", "cost", "rules_text", "flavor_text", "stats", "art"];
/** The design calls only (each carries a fresh spark). */
const designPrompts = () => s.prompts.filter((prompt) => prompt.includes("Fresh design #"));
const plan = () => s.inserted.at(-1)!.plan as Record<string, unknown> & { frame_template: string | null; art_brief?: string };

beforeEach(() => {
  s.verified = EVERY;
  s.inserted = [];
  s.patched = [];
  s.answers = [];
  s.prompts = [];
  s.imagePrompts = [];
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const fill = (over: Record<string, unknown> = {}) =>
  createCardFillJob({
    want: WANT_ALL as never,
    locked: {},
    steer: { card_type: "creature" },
    frame: "m15nyx",
    designKind: "creature",
    ...over,
  });

/** Run the fill's one step on the stored plan: what the creator is handed. */
async function stepOf(stored: Record<string, unknown>) {
  s.job = { id: "job-1", owner_id: USER, kind: "card_fill", status: "generating", request: {}, deck_id: null, error: null, plan: stored, steps: [{ key: "fill:0", label: "Card", status: "running" }] };
  const result = await runNextJobStep("job-1", "fill:0");
  expect(result.ok).toBe(true);
  return s.patched.at(-1)! as { status: string; fill?: Record<string, unknown> };
}

const WOLF = designed({
  title: "Wolf",
  cost: "",
  card_type: "token",
  supertype: "Creature",
  subtypes: ["Wolf"],
  color_identity: ["green"],
  rules_text: "Trample",
  flavor_text: null,
});
const THOPTER = designed({
  title: "Thopter",
  cost: "",
  card_type: "token",
  supertype: "Artifact Creature",
  subtypes: ["Thopter"],
  color_identity: ["colorless"],
  rules_text: "",
  flavor_text: null,
  power: "1",
  toughness: "1",
});

// Owner 2026-10-28, "redo, then keep and tell": EXACTLY the frame picked is
// kept; anywhere else is redone once with a stronger brief, then kept on the
// frame the creator's own rules give it with a notice for the maker; a
// design no frame can dress is refused. Every path before any charge.
describe("a frame picked by name", () => {
  it("path 1 — exactly the frame: briefed, kept, no notice, one design", async () => {
    s.answers = [[NYX_MUSE]];
    const out = await fill();
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(1);
    expect(designPrompts()[0]).toContain('FRAME (the maker picked it — design the card FOR it): "Nyx"');
    expect(designPrompts()[0]).toContain('supertype must include the word "Enchantment"');
    expect(plan().frame_template).toBe("m15nyx");
    expect(plan()).not.toHaveProperty("frame_notice");
    expect(s.spend).not.toHaveBeenCalled();
    const step = await stepOf(plan());
    expect(step.fill).not.toHaveProperty("frame_notice");
  });

  it("a miss is redone once with a stronger brief — the second, exact, kept with no notice", async () => {
    s.answers = [[designed()], [NYX_MUSE]];
    const out = await fill();
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect(designPrompts()[0]).not.toContain("YOUR LAST DESIGN");
    expect(designPrompts()[1]).toContain(
      'YOUR LAST DESIGN MISSED THIS FRAME: Designed without the Enchantment type. This time the card MUST land on "Nyx"',
    );
    expect(plan().frame_template).toBe("m15nyx");
    expect(plan()).not.toHaveProperty("frame_notice");
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("path 2 — Standard picked, an Enchantment Creature twice: kept on Nyx, and the maker is told", async () => {
    s.answers = [[NYX_MUSE], [designed({ title: "Ashveil Courier", supertype: "Enchantment" })]];
    const out = await fill({ frame: "m15" });
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect(plan().frame_template).toBe("m15nyx");
    expect(plan().frame_notice).toBe("Designed as an Enchantment Creature, so it's on Nyx.");
    expect(s.spend).not.toHaveBeenCalled();
    // The notice reaches the creator with the fill, at the one credit.
    const step = await stepOf(plan());
    expect(step.status).toBe("done");
    expect(step.fill).toMatchObject({ frame_template: "m15nyx", frame_notice: "Designed as an Enchantment Creature, so it's on Nyx." });
    expect(s.spend).toHaveBeenCalledTimes(1);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("path 2 — the plain full-art token picked, an Artifact Thopter twice: on the Artifact Token, told", async () => {
    s.answers = [[THOPTER], [THOPTER]];
    const out = await fill({ steer: { card_type: "token" }, frame: "m20token", designKind: "token" });
    expect(out.ok).toBe(true);
    expect(designPrompts()[0]).toContain('must NOT include "Artifact"');
    expect(plan().frame_template).toBe("m20tokenartifact");
    expect(plan().frame_notice).toBe("Designed as an Artifact token, so it's on Artifact Token.");
  });

  it("path 2 — a token height its text doesn't fit: redone, then kept on the text box, told", async () => {
    s.answers = [[WOLF], [WOLF]];
    const out = await fill({ steer: { card_type: "token" }, frame: "m20token", designKind: "token" });
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect(designPrompts()[0]).toContain("NO text box");
    expect(designPrompts()[1]).toContain("YOUR LAST DESIGN MISSED THIS FRAME: Its text needs the text box.");
    expect(plan().frame_template).toBe("m20tokentext");
    expect(plan().frame_notice).toBe("Its text needs the text box, so it's on Token, text box.");
  });

  it("path 3 — a design no frame can dress, twice: refused before any charge, never a random frame", async () => {
    // An instant the creature's Nyx frame can't draw.
    const spell = designed({ card_type: "instant", subtypes: [], power: null, toughness: null, rules_text: "Draw a card." });
    s.answers = [[spell], [spell]];
    const out = await fill();
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
    expect(!out.ok && out.error).toBe(
      "The AI's design didn't fit the frame you picked. Try again, or let it choose the frame with Surprise me. No credits were used.",
    );
    expect(designPrompts()[1]).toContain("YOUR LAST DESIGN COULD NOT BE PUT ON THIS FRAME AT ALL");
    expect(s.inserted).toEqual([]);
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.refund).not.toHaveBeenCalled();
  });
});

describe("the card's colour on the frame picked", () => {
  it("a FREE colour is held to the frame's colours, in the brief and in the fit", async () => {
    s.verified = [...EVERY.filter((key) => !key.startsWith("m15nyx/")), frameComboKey("m15nyx", "w"), frameComboKey("m15nyx", "u")];
    s.answers = [[designed({ supertype: "Enchantment", color_identity: ["red"], cost: "{1}{R}" })], [designed({ supertype: "Enchantment", color_identity: ["red"], cost: "{1}{R}" })]];
    const out = await fill();
    expect(designPrompts()[0]).toContain("Its color must be white or blue");
    expect(designPrompts()[0]).toMatch(/color: (white|blue)\./);
    // Red is not a colour the frame has: refused, not moved.
    expect(out).toMatchObject({ ok: false, code: "frame_unfit" });
  });

  it("a KEPT colour is the card's: the colour hint is never the frame's random one", async () => {
    s.answers = [[NYX_MUSE]];
    await fill({ want: ["card_type", "title", "rules_text"] as never, locked: { color_identity: ["white"] } });
    expect(designPrompts()[0]).toContain("color: white.");
    expect(designPrompts()[0]).not.toContain("Its color must be");
  });
});

describe("the dialog's Surprise me kind", () => {
  it("never comes back as a battle, even with a battle frame published", async () => {
    s.answers = [[designed()]];
    const out = await createCardFillJob({ want: WANT_ALL as never, locked: {}, steer: {}, frame: "random", designKind: "surprise" });
    expect(out.ok).toBe(true);
    expect(designPrompts()[0]).toContain("card_type: anything but battle.");
    // An older client (no kind named) is what it always was.
    s.prompts = [];
    s.answers = [[designed()]];
    await createCardFillJob({ want: WANT_ALL as never, locked: {}, steer: {}, frame: "random" });
    expect(designPrompts()[0]).not.toContain("anything but");
  });

  it("a battle that comes back anyway is designed again — the prompt alone is no gate", async () => {
    s.answers = [[designed({ card_type: "battle", subtypes: ["Siege"], defense: "5", power: null, toughness: null })], [designed()]];
    const out = await createCardFillJob({ want: WANT_ALL as never, locked: {}, steer: {}, frame: "random", designKind: "surprise" });
    expect(out.ok).toBe(true);
    expect(designPrompts()).toHaveLength(2);
    expect((plan().fields as { card_type?: string }).card_type).toBe("creature");
    expect(s.spend).not.toHaveBeenCalled();
  });

  it("keeps today's draw when the frame is Surprise me (no brief)", async () => {
    s.answers = [[designed()]];
    await fill({ frame: "random" });
    expect(designPrompts()[0]).not.toContain("FRAME (the maker picked it");
    expect(plan().frame_template).not.toBeNull();
  });
});

describe("the presets reach the designer and the painter", () => {
  it("the assembled theme and style lead the prompt, the twist first", async () => {
    const assembled = assemblePrompt({ theme_preset: "gothic-horror", theme_twist: "lighthouse keepers", style_preset: "stained-glass" })!;
    s.answers = [[NYX_MUSE]];
    await fill({ theme: assembled.theme, style: assembled.style, assembled: { artStyle: assembled.artStyle, styleArt: assembled.styleArt } });
    const prompt = designPrompts()[0]!;
    expect(prompt).toContain("Theme: lighthouse keepers (the maker's own words: they outrank the preset and any spark, never the frame or the rules) — set in gothic horror");
    expect(prompt).toContain("Art & tone style: stained glass: a stained-glass window");
    // The spark ranks below the theme (lib/ai/design-variety.ts).
    expect(prompt.indexOf("Theme:")).toBeLessThan(prompt.indexOf("Fresh design #"));
  });

  it("the painter reads the style, then the style's look and the frame's art direction", async () => {
    const assembled = assemblePrompt({ style_preset: "stained-glass", style_twist: "candlelight" })!;
    s.answers = [[designed({ title: "Glasswing Seraph" })]];
    await fill({ frame: "stainedglass", style: assembled.style, assembled: { artStyle: assembled.artStyle, styleArt: assembled.styleArt } });
    const stored = plan();
    expect(stored.frame_template).toBe("stainedglass");
    expect(stored.style).toBe("candlelight, stained glass");
    expect(stored.art_brief).toContain("Art direction: a stained-glass window");
    expect(stored.art_brief).toContain("Paint it as a leaded stained-glass window");
    // …and the step paints with it, at its one credit.
    s.job = { id: "job-1", owner_id: USER, kind: "card_fill", status: "generating", request: {}, deck_id: null, error: null, plan: stored, steps: [{ key: "fill:0", label: "Card", status: "running" }] };
    const result = await runNextJobStep("job-1", "fill:0");
    expect(result.ok).toBe(true);
    const first = s.imagePrompts.at(-1)![0]!;
    expect(first).toContain("Rendered strictly in candlelight, stained glass style. Art direction: a stained-glass window");
    expect(first).toContain("Paint it as a leaded stained-glass window");
    expect(s.spend).toHaveBeenCalledTimes(1);
    expect(s.spend.mock.calls[0]![0]).toBe(1);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("a plan with nothing to direct stores no art brief (an older plan's step paints as before)", async () => {
    s.answers = [[designed()]];
    await createCardFillJob({ want: ["title", "art"] as never, locked: { card_type: "creature" }, steer: {}, artFrame: "m15" });
    expect(plan()).not.toHaveProperty("art_brief");
  });
});

// PINNED (review of #635): an OLD-SHAPE painting fill — no preset, no kind,
// the art ticked on a card that keeps its type (create, edit and remix
// revise alike) — now gets the art direction of the frame the card is on
// when that frame is in the table (lib/ai/frame-art-brief.ts), and nothing
// else; on a frame outside the table its art prompt is main's, word for
// word.
describe("an old-shape painting fill", () => {
  const OLD = { want: ["title", "art"] as never, locked: { card_type: "creature" as const, color_identity: ["white" as const] }, steer: {} };
  const MAIN_PROMPT =
    "A pale spirit with a lantern on a fog-drowned wall. NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.";

  it("on a frame in the table: the frame's art direction, after the designer's prompt", async () => {
    s.answers = [[designed()]];
    await createCardFillJob({ ...OLD, artFrame: "stainedglass" });
    expect(plan().art_brief).toBe("Paint it as a leaded stained-glass window: jewel-toned glass panes, dark lead lines, light glowing through.");
    await stepOf(plan());
    expect(s.imagePrompts.at(-1)![0]).toBe(
      "A pale spirit with a lantern on a fog-drowned wall. Paint it as a leaded stained-glass window: jewel-toned glass panes, dark lead lines, light glowing through. NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.",
    );
  });

  it("on M15: no art brief, main's art prompt word for word", async () => {
    s.answers = [[designed()]];
    await createCardFillJob({ ...OLD, artFrame: "m15" });
    expect(plan()).not.toHaveProperty("art_brief");
    expect(plan()).not.toHaveProperty("frame_notice");
    await stepOf(plan());
    expect(s.imagePrompts.at(-1)![0]).toBe(MAIN_PROMPT);
  });
});
