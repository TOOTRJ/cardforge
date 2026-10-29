import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The AI deck remix of the user's OWN card keeps the source card's frame
// (owner 2026-10-13; found by the check of #529). The own-card mechanics
// carried no template, so a card on the Vehicle frame, the 2003 frame, a
// borderless frame or a full-art token came back on the default frame. It
// now keeps the template where the save's own gates pass it — published in
// the card's colour, right for the kind, a double-faced body with its back's
// body verified too — and lands exactly as before otherwise.
//
// Through runNextJobStep with the REAL credit wrapper over stubbed ledger
// helpers (the amount reserved is asserted), the real frame choice, and the
// server's real gates run on the payload createCardAction is handed. No AI
// call is made: the identity and the image generators are stubs.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  source: null as unknown,
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  identity: vi.fn(),
  image: vi.fn(),
  restyle: vi.fn(),
  spend: vi.fn(),
  refund: vi.fn(),
  job: null as unknown as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester" }),
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
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") return { data: { job: s.job, step_key: "remix:0" }, error: null };
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
vi.mock("@/lib/ai/remix", () => ({ generateRemixIdentity: s.identity }));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
  generatePlainImage: s.image,
  restyleImage: s.restyle,
}));
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({
    ok: true,
    publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png`,
  }),
}));
// The REAL wrapper (withCreditedStep) over stubbed ledger helpers.
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
}));
vi.mock("@/lib/cards/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cards/queries")>()),
  getCardById: async () => s.source,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "remixed" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { REMIX_DFC_FRAMES_GONE, runNextJobStep } from "@/lib/ai/generation-jobs";
import { REMIX_EMBLEM_LEFT_OUT, ownCardRemixFrame, ownCardRulesText, remixCreditsOf } from "@/lib/ai/remix-mechanics";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import {
  dfcFrontColorError,
  dfcFrontTypeError,
  resolveDfcBackFace,
  type DfcBackFacePayload,
} from "@/lib/cards/dfc-gate";
import { newCardFrameStyle } from "@/lib/cards/anatomy";

const keys = (...combos: [string, string][]) =>
  combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour));

type Row = Record<string, unknown>;

/** A stored `cards` row, as getCardById narrows it. */
function row(over: Row): Row {
  return {
    id: SOURCE_ID,
    title: "Kesh, Emberforge Warden",
    cost: "{2}{R}{R}",
    card_type: "creature",
    supertype: null,
    subtypes: ["Dwarf"],
    rarity: "rare",
    color_identity: ["red"],
    rules_text: "Haste",
    flavor_text: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    art_url: null,
    back_face: null,
    face_content: null,
    frame_style: { template: "m15" },
    ...over,
  };
}

async function remix(source: Row, options: { credits?: number } = {}) {
  s.source = source;
  s.job = {
    id: "job-1",
    owner_id: USER,
    kind: "deck_remix",
    status: "generating",
    request: {},
    deck_id: "deck-1",
    error: null,
    plan: {
      deck_title: "Deck",
      style: "watercolour",
      theme: null,
      skipped: 0,
      entries: [
        {
          board: "main",
          quantity: 1,
          name: source.title,
          card_id: SOURCE_ID,
          scryfall_id: null,
          ...(options.credits ? { credits: options.credits } : {}),
        },
      ],
    },
    steps: [{ key: "remix:0", label: source.title, status: "running" }],
  };
  const result = await runNextJobStep("job-1", "remix:0");
  expect(result.ok).toBe(true);
  return { step: s.patched.at(-1)!, card: s.created.at(-1) };
}

/** The credits the step reserved — ONE charge. */
function reserved(): number {
  expect(s.spend).toHaveBeenCalledTimes(1);
  return (s.spend.mock.calls[0] as [number])[0];
}

/** The server's gates (createCardAction's), run on the payload it was
 *  handed with the same verified set: a kept frame must never be refused. */
function expectSavable(card: Row) {
  const style = newCardFrameStyle((card.frame_style ?? {}) as Row, card.card_type as string);
  const verified = new Set(s.verified);
  const colours = card.color_identity as never;
  expect(frameGateError(style.template as string, colours, verified)).toBeNull();
  expect(frameKindGateError(style.template as string, cardFieldsFace(card))).toBeNull();
  expect(dfcFrontTypeError(style.template as string, card.card_type as string)).toBeNull();
  expect(
    dfcFrontColorError(
      style.template as string,
      { cardType: card.card_type as string, supertype: card.supertype as string },
      colours,
      new Set<string>(),
    ),
  ).toBeNull();
  const gate = resolveDfcBackFace({
    frontTemplate: style.template as string,
    back: card.back_face as DfcBackFacePayload | undefined,
    family: (style as Row).dfcIcon as string | undefined,
    frontColorIdentity: colours,
    verifiedKeys: verified,
  });
  expect(gate.ok).toBe(true);
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.verified = [];
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(undefined);
  s.identity.mockReset().mockImplementation(async (input: { secondHalf?: unknown }) => ({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
    ...(input.secondHalf
      ? { second_title: "Remixed Other", second_flavor_text: null, second_art_instruction: "The other side." }
      : {}),
  }));
  s.image.mockReset().mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
  s.restyle.mockReset();
});

const VEHICLE = () =>
  row({
    title: "Rustwing Skiff",
    cost: "{2}",
    card_type: "artifact",
    subtypes: ["Vehicle"],
    color_identity: ["colorless"],
    rules_text: "Flying\nCrew 1",
    power: "3",
    toughness: "3",
    frame_style: { template: "m15vehicle" },
  });

describe("an own card's deck remix keeps its frame", () => {
  it("keeps the Vehicle frame — one credit, one picture, a payload the save's gates pass", async () => {
    s.verified = keys(["m15vehicle", "c"], ["m15", "c"]);
    const { step, card } = await remix(VEHICLE());
    expect(step.status).toBe("done");
    expect(card!.frame_style).toEqual({ template: "m15vehicle" });
    expect(card!.parent_card_id).toBe(SOURCE_ID);
    expect(card!.back_face).toBeUndefined();
    expect(reserved()).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
    expect(s.refund).not.toHaveBeenCalled();
    expectSavable(card!);
  });

  it("keeps a 2003-frame card on the 2003 frame, with the switches that frame draws (the white border)", async () => {
    s.verified = keys(["modern", "r"], ["m15", "r"]);
    const { card } = await remix(row({ frame_style: { template: "modern", border: "white", finish: "foil" } }));
    // The template and the stored anatomy switches travel; a finish does not
    // (as before: it is not a frame choice, and a premium one would be
    // refused by the save).
    expect(card!.frame_style).toEqual({ template: "modern", border: "white" });
    expect(newCardFrameStyle(card!.frame_style as Row, "creature")).toMatchObject({ template: "modern", border: "white" });
    expect(reserved()).toBe(1);
    expectSavable(card!);
  });

  it("keeps a borderless frame", async () => {
    s.verified = keys(["m15borderless", "g"], ["m15", "g"]);
    const { card } = await remix(
      row({ color_identity: ["green"], cost: "{G}", frame_style: { template: "m15borderless", crown: false } }),
    );
    expect(card!.frame_style).toEqual({ template: "m15borderless", crown: false });
    expectSavable(card!);
  });

  it("keeps a split card's frame AND its second half, renamed — still one credit, one picture", async () => {
    s.verified = keys(["split", "r"], ["m15", "r"]);
    const { card } = await remix(
      row({
        title: "Fire",
        card_type: "instant",
        subtypes: [],
        power: null,
        toughness: null,
        rules_text: "Fire deals 2 damage to any target.",
        frame_style: { template: "split" },
        back_face: {
          title: "Ice",
          cost: "{1}{U}",
          card_type: "instant",
          rules_text: "Tap target permanent.\nDraw a card.",
          art_url: "https://example.supabase.co/storage/v1/object/public/card-art/other/ice.png",
          artist_credit: "Someone",
        },
      }),
    );
    expect(card!.frame_style).toEqual({ template: "split" });
    expect(card!.back_face).toEqual({
      title: "Remixed Other",
      cost: "{1}{U}",
      card_type: "instant",
      rules_text: "Tap target permanent.\nDraw a card.",
      flavor_text: undefined,
    });
    expect(card!.rules_text).toBe("Remixed Name deals 2 damage to any target.");
    expect(reserved()).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
    expectSavable(card!);
  });

});

// Emblems are NOT remixed (owner 2026-10-13). A new plan has no step for one
// (the estimate and createDeckRemixJob leave it out); a step of an OLDER plan
// is refused before the reserve — no ledger row at all — and before any AI
// call. (Before: the picture was generated, the save refused the emblem on
// the default frame, and the credit was refunded — every attempt.)
describe("an own emblem is not remixed", () => {
  it("an older plan's emblem step is refused BEFORE the reserve: nothing spent, nothing refunded, no AI call", async () => {
    s.verified = keys(["emblem", "c"], ["m15", "c"]);
    const { step, card } = await remix(
      row({
        title: "Kaito",
        cost: null,
        card_type: "emblem",
        subtypes: ["Kaito"],
        color_identity: ["colorless"],
        power: null,
        toughness: null,
        rules_text: "Ninjas you control get +1/+1.",
        frame_style: { template: "emblem" },
      }),
    );
    expect(step.status).toBe("failed");
    expect(step.error).toBe(REMIX_EMBLEM_LEFT_OUT);
    expect(step.error_code ?? null).toBeNull();
    expect(step.spend_ref).toBeNull();
    expect(card).toBeUndefined();
    expect(s.spend).not.toHaveBeenCalled();
    expect(s.refund).not.toHaveBeenCalled();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
    expect(s.restyle).not.toHaveBeenCalled();
  });
});

describe("an own card's deck remix falls back to the default landing", () => {
  it("when the frame isn't published in the card's colour — the payload names no template, as before", async () => {
    s.verified = keys(["m15vehicle", "u"], ["m15", "c"]);
    const { step, card } = await remix(VEHICLE());
    expect(step.status).toBe("done");
    expect(card!.frame_style).toBeUndefined();
    expect(reserved()).toBe(1);
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("when the kind gate refuses the frame for the card (a Vehicle frame on a card that says no Vehicle)", async () => {
    s.verified = keys(["m15vehicle", "c"], ["m15", "c"]);
    const { step, card } = await remix({ ...VEHICLE(), subtypes: ["Equipment"] });
    expect(step.status).toBe("done");
    expect(card!.frame_style).toBeUndefined();
  });

  it("when the kind gate refuses the kind outright (a land stored on the borderless spell skin)", async () => {
    s.verified = keys(["m15borderless", "r"], ["m15", "r"]);
    const land = row({ card_type: "land", cost: null, power: null, toughness: null, frame_style: { template: "m15borderless", crown: true } });
    expect(frameKindGateError("m15borderless", cardFieldsFace(land))).not.toBeNull();
    const { card } = await remix(land);
    expect(card!.frame_style).toEqual({ crown: true });
  });

  it("when the NEW name no longer fits the frame (Wastes on a full-art basic frame, renamed) — never a refused save", async () => {
    s.verified = keys(["m15fullartland", "c"], ["m15", "c"]);
    const wastes = row({
      title: "Wastes",
      cost: null,
      card_type: "land",
      supertype: "Basic",
      subtypes: [],
      color_identity: ["colorless"],
      rules_text: null,
      power: null,
      toughness: null,
      frame_style: { template: "m15fullartland" },
    });
    // The frame fits the source…
    expect(ownCardRemixFrame(wastes as never, new Set(s.verified))).toEqual({ frame_template: "m15fullartland" });
    // …but not the card as the remix saves it.
    const { step, card } = await remix(wastes);
    expect(step.status).toBe("done");
    expect(card!.title).toBe("Remixed Name");
    expect(card!.frame_style).toBeUndefined();
  });

  it("when the row names no template, or a retired one", async () => {
    s.verified = keys(["m15", "r"]);
    expect((await remix(row({ frame_style: {} }))).card!.frame_style).toBeUndefined();
    expect((await remix(row({ frame_style: { template: "regular" } }))).card!.frame_style).toBeUndefined();
  });
});

describe("an own token's deck remix: the height follows the text it saves with", () => {
  const token = (template: string, over: Row = {}) =>
    row({
      title: "Goblin",
      cost: null,
      card_type: "token",
      supertype: "Creature",
      subtypes: ["Goblin"],
      rarity: "common",
      rules_text: null,
      power: "1",
      toughness: "1",
      frame_style: { template },
      ...over,
    });

  it("a textless full-art token gains the text box for the remix's flavour, where that frame is published", async () => {
    s.verified = keys(["m20token", "r"], ["m20tokentext", "r"], ["m15", "r"]);
    const { card } = await remix(token("m20token"));
    expect(card!.flavor_text).toBe("New flavour.");
    expect((card!.frame_style as Row).template).toBe("m20tokentext");
    expect(reserved()).toBe(1);
    expectSavable(card!);
  });

  // TODO 1.24: the textless height draws no rules box, so the flavour the
  // remix writes would save unprinted. With no text box published in the
  // colour the card lands as it did before its frame was kept (#533's
  // fallback: no template, the default frame) — the text is drawn.
  it("…and never keeps the remix's text on the textless height: with no text box in the colour it lands on the default frame", async () => {
    s.verified = keys(["m20token", "r"], ["m15", "r"]);
    const { step, card } = await remix(token("m20token"));
    expect(step.status).toBe("done");
    expect(card!.flavor_text).toBe("New flavour.");
    expect(card!.frame_style).toBeUndefined();
    expect(reserved()).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
    expect(s.refund).not.toHaveBeenCalled();
    expectSavable(card!);
  });

  // …and where the 2014–19 arch is published in the colour it is the
  // stand-in (the text on its scrim), as for a printing of the same token:
  // a token stays on a token frame; the Artifact word picks the dress.
  it("…with the arch published in the colour it lands on the arch, not the default frame", async () => {
    s.verified = keys(["m20token", "r"], ["m15token", "r"], ["m15", "r"]);
    const { step, card } = await remix(token("m20token"));
    expect(step.status).toBe("done");
    expect(card!.flavor_text).toBe("New flavour.");
    expect((card!.frame_style as Row).template).toBe("m15token");
    expect(reserved()).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
    expect(s.refund).not.toHaveBeenCalled();
    expectSavable(card!);
  });

  it("…an artifact token on the textless height lands on the artifact arch", async () => {
    s.verified = keys(["m20tokenartifact", "r"], ["m15tokenartifact", "r"], ["m15token", "r"], ["m15", "r"]);
    const { card } = await remix(token("m20tokenartifact", { supertype: "Artifact Creature" }));
    expect((card!.frame_style as Row).template).toBe("m15tokenartifact");
    expectSavable(card!);
  });

  it("…a remix that saves with no text keeps the textless height", async () => {
    s.verified = keys(["m20token", "r"], ["m15", "r"]);
    s.identity.mockResolvedValueOnce({ title: "Remixed Name", flavor_text: null, art_instruction: "A painted scene." });
    const { card } = await remix(token("m20token"));
    expect(card!.flavor_text).toBeUndefined();
    expect((card!.frame_style as Row).template).toBe("m20token");
    expectSavable(card!);
  });

  it("…an own token that already carried rules on the textless height is drawn the same way (the copied rules are text)", async () => {
    s.verified = keys(["m20token", "r"], ["m15", "r"]);
    s.identity.mockResolvedValueOnce({ title: "Remixed Name", flavor_text: null, art_instruction: "A painted scene." });
    const { card } = await remix(token("m20token", { rules_text: "Haste" }));
    expect(card!.rules_text).toBe("Haste");
    expect(card!.frame_style).toBeUndefined();
    expectSavable(card!);
  });

  it("…and where the default frame isn't published in the colour either, the kept frame stands (never a refused save)", async () => {
    s.verified = keys(["m20token", "r"]);
    const { step, card } = await remix(token("m20token"));
    expect(step.status).toBe("done");
    expect((card!.frame_style as Row).template).toBe("m20token");
    expect(card!.flavor_text).toBe("New flavour.");
    expectSavable(card!);
  });

  it("the 2014–19 arch follows its text the same way", async () => {
    s.verified = keys(["m15token", "r"], ["m15tokentext", "r"], ["m15", "r"]);
    const { card } = await remix(token("m15token"));
    expect((card!.frame_style as Row).template).toBe("m15tokentext");
    expectSavable(card!);
  });
});

describe("an own double-faced card's deck remix: both faces or neither", () => {
  const BOTH = () => keys(["m15dfcfront", "w"], ["m15dfcbackleft", "r"], ["m15", "w"]);
  const dfc = () =>
    row({
      title: "Brutal Cathar",
      cost: "{2}{W}",
      color_identity: ["white"],
      subtypes: ["Human", "Soldier", "Werewolf"],
      rules_text: "Daybound",
      power: "2",
      toughness: "2",
      frame_style: { template: "m15dfcfront", dfcIcon: "sunmoon" },
      back_face: {
        title: "Moonrage Brute",
        card_type: "creature",
        subtypes: ["Werewolf"],
        rules_text: "First strike\nNightbound",
        power: "3",
        toughness: "3",
        art_url: "https://example.supabase.co/storage/v1/object/public/card-art/other/back.png",
        artist_credit: "Someone",
        frame_style: { template: "m15dfcbackleft" },
        color_identity: ["red"],
      },
    });

  it("the frame choice prices it: two credits on both bodies, one while either isn't published", () => {
    expect(remixCreditsOf(ownCardRemixFrame(dfc() as never, new Set(BOTH())))).toBe(2);
    for (const verified of [
      keys(["m15", "w"]),
      keys(["m15", "w"], ["m15dfcfront", "w"]),
      keys(["m15", "w"], ["m15dfcbackleft", "r"]),
    ]) {
      const kept = ownCardRemixFrame(dfc() as never, new Set(verified));
      expect(kept).toEqual({});
      expect(remixCreditsOf(kept)).toBe(1);
    }
    // A one-credit plan never takes the bodies, whatever is published.
    expect(ownCardRemixFrame(dfc() as never, new Set(BOTH()), { singleFace: true })).toEqual({});
  });

  it("a plan priced at two keeps both bodies: 2 reserved once, two pictures, a back the gate accepts", async () => {
    s.verified = BOTH();
    const { step, card } = await remix(dfc(), { credits: 2 });
    expect(step.status).toBe("done");
    expect(step.label).toBe("Remixed Name // Remixed Other");
    expect(reserved()).toBe(2);
    expect(s.image).toHaveBeenCalledTimes(2);
    expect(card!.frame_style).toEqual({ template: "m15dfcfront", dfcIcon: "sunmoon" });
    const back = card!.back_face as Row;
    expect(back.title).toBe("Remixed Other");
    expect(back.frame_style).toEqual({ template: "m15dfcbackleft" });
    expect(back.color_identity).toEqual(["red"]);
    // The back's picture is the remix's own, never the source's.
    expect(back.art_url).toBe(`https://example.supabase.co/storage/v1/object/public/card-art/${USER}/x.png`);
    expect(back.artist_credit).toBeUndefined();
    expectSavable(card!);
  });

  it("a one-credit plan stays one-faced on the default landing: 1 reserved, one picture, no back", async () => {
    s.verified = BOTH();
    const { step, card } = await remix(dfc());
    expect(step.status).toBe("done");
    expect(reserved()).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
    expect(card!.back_face).toBeUndefined();
    expect(card!.frame_style).toEqual({ dfcIcon: "sunmoon" });
  });

  it("a plan priced at two whose bodies were un-ticked since fails BEFORE any AI call and refunds both credits", async () => {
    s.verified = keys(["m15", "w"], ["m15dfcfront", "w"]);
    const { step, card } = await remix(dfc(), { credits: 2 });
    expect(step.status).toBe("failed");
    expect(step.error).toBe(REMIX_DFC_FRAMES_GONE);
    expect(card).toBeUndefined();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
    expect(reserved()).toBe(2);
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect((s.refund.mock.calls[0] as [string, number])[1]).toBe(2);
  });

  // A job planned BEFORE this change priced an entry with both ids by its
  // PRINTING: a double-faced printing behind a one-faced own card reserved
  // two, and the step — which always remixed the own card — painted one
  // picture for them. Resumed after the change, that step is refused before
  // any AI call and the two credits go back: never two for one picture.
  it("an older plan that priced two for a ONE-FACED own card (by its printing) is refused and refunded", async () => {
    s.verified = [...BOTH(), ...keys(["m15", "r"])];
    const { step, card } = await remix(row({}), { credits: 2 });
    expect(step.status).toBe("failed");
    expect(step.error).toBe(REMIX_DFC_FRAMES_GONE);
    expect(card).toBeUndefined();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
    expect(s.restyle).not.toHaveBeenCalled();
    expect(reserved()).toBe(2);
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect((s.refund.mock.calls[0] as [string, number])[1]).toBe(2);
  });

  // Every failure after the reserve hands back exactly what was reserved,
  // once: the identity call throwing, the second picture failing, and the
  // save refusing the card after both pictures.
  it("a two-credit step that fails after the reserve refunds both credits, once", async () => {
    s.verified = BOTH();
    s.identity.mockRejectedValueOnce(new Error("model timeout"));
    let { step } = await remix(dfc(), { credits: 2 });
    expect(step.status).toBe("failed");
    expect(step.spend_ref).toBeNull();
    expect(s.image).not.toHaveBeenCalled();
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect((s.refund.mock.calls[0] as [string, number])[1]).toBe(2);

    s.spend.mockClear();
    s.refund.mockClear();
    s.image
      .mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([1]), contentType: "image/png" })
      .mockResolvedValueOnce({ ok: false, error: "The image model is busy." });
    ({ step } = await remix(dfc(), { credits: 2 }));
    expect(step.status).toBe("failed");
    expect(step.error).toBe("The image model is busy.");
    expect(s.created).toEqual([]);
    expect(reserved()).toBe(2);
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect((s.refund.mock.calls[0] as [string, number])[1]).toBe(2);
  });

  it("a legacy back (no body) on a standard frame keeps the frame and stays one-faced, as before", async () => {
    s.verified = keys(["m15", "w"]);
    const legacy = { ...dfc(), frame_style: { template: "m15" }, back_face: { title: "Moonrage Brute", card_type: "creature" } };
    const { card } = await remix(legacy);
    expect(card!.frame_style).toEqual({ template: "m15" });
    expect(card!.back_face).toBeUndefined();
    expect(reserved()).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
  });
});

describe("ownCardRulesText — a walker / saga stored with its rows alone", () => {
  it("copies the stored text when there is one", () => {
    expect(ownCardRulesText({ rules_text: "Haste", face_content: null })).toBe("Haste");
  });

  it("serialises the rows of a card whose rules_text is NULL", () => {
    expect(
      ownCardRulesText({
        rules_text: null,
        face_content: { loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }, { cost: "-3", text: "Destroy target creature." }] } },
      } as never),
    ).toBe("+1: Draw a card.\n-3: Destroy target creature.");
    expect(
      ownCardRulesText({
        rules_text: null,
        face_content: { saga: { intro: null, chapters: [{ numerals: [1, 2], text: "Scry 1." }, { numerals: [3], text: "Draw a card." }] } },
      } as never),
    ).toBe("I, II — Scry 1.\nIII — Draw a card.");
    expect(ownCardRulesText({ rules_text: null, face_content: null })).toBeUndefined();
  });
});
