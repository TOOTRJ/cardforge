import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import legacy from "./fixtures/dfc-legacy-backs.json";

// ---------------------------------------------------------------------------
// TODO 5.2 — the 8 imported double-faced cards onto the real frames (owner
// 2026-10-02, Q3: in place, one click): who the hint is offered to (5 of
// the 8 — Titânia on devoid, Erza, Tobirama's land back, Aang onto the
// transform pair; Vader's costed artifact back is a MODAL card and goes onto
// the modal pair, 5.1b — owner 2026-10-05: the hint offers ONLY the layout
// the back's shape derives, dfc-adopt-modal.test.ts holds the mechanism
// with mocked bodies; never the two on m15borderless, the walker back or
// the adventure row), what the move writes, and the action's gates.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  existing: null as unknown,
  client: null as unknown,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  baked: [] as string[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => state.user,
  getCurrentUsername: async () => "tester",
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => state.verified }));
vi.mock("@/lib/cards/queries", () => ({ getCardById: async () => state.existing }));
vi.mock("@/lib/cards/bake-render", () => ({
  bakeAndPersistCardRender: vi.fn(async (id: string) => {
    state.baked.push(id);
  }),
}));
vi.mock("@/lib/cards/revalidate", () => ({ revalidateCardPaths: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));

import { adoptDfcBodiesPlan, dfcAdoptionOffer, dfcAdoptionShape, parseDfcAdoptionLayout, type DfcAdoptionCard } from "@/lib/cards/dfc-adopt";
import type { ColorIdentity } from "@/types/card";
import { adoptDfcBodiesAction } from "@/lib/cards/dfc-adopt-actions";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

type LegacyRow = {
  label: string;
  layout: string;
  front: Record<string, unknown> & { frame_style: { template?: string }; color_identity: ColorIdentity[]; card_type: string };
  back_face: Record<string, unknown> & { card_type?: string; cost?: string | null; loyalty?: string | null };
};
const rows = (legacy as unknown as { rows: LegacyRow[] }).rows;
const cardOf = (row: LegacyRow): DfcAdoptionCard & { back_face: LegacyRow["back_face"] } => ({ ...row.front, back_face: row.back_face });

describe("dfcAdoptionOffer — who gets the hint", () => {
  it("offers exactly the FIVE wave-1 rows of production's nine — the layout the back's SHAPE derives: Vader's costed back (a modal card) the modal pair since 5.1b", () => {
    const offered = rows.map((row) => ({ label: row.label, offer: dfcAdoptionOffer(cardOf(row)) }));
    expect(offered.filter((r) => r.offer).map((r) => r.label.split("//")[1]?.trim().split(" (")[0])).toEqual([
      "Avacyn, the Purifier",
      "Tergrid's Lantern",
      "Avacyn, the Purifier",
      "Temple of Civilization",
      "Aang, Master of Elements",
    ]);
    const refused = offered.filter((r) => !r.offer).map((r) => r.label);
    expect(refused).toHaveLength(4);
    expect(refused.join("\n")).toMatch(/Tibalt/); // a walker back
    expect(refused.join("\n")).toMatch(/NOT a DFC/); // the adventure row
    expect(refused.filter((label) => /m15borderless/.test(label))).toHaveLength(2);
    // Vader (owner 2026-10-05): a back WITH a mana cost is a modal card, so
    // its shape derives the MODAL layout — the modal pair since 5.1b, never
    // Transform, which would have dropped the Lantern's cost.
    expect(offered[1].offer).toEqual({ layout: "modal", label: "Modal double-faced", frontBody: "m15mdfcfront", backBody: "m15mdfcback", losesDress: null });
    expect(dfcAdoptionShape(cardOf(rows[1]))).toBe("modal");
    expect(dfcAdoptionShape(cardOf(rows[0]))).toBe("transform");
    // A row that is no candidate at all has no shape either.
    expect(dfcAdoptionShape(cardOf(rows[3]))).toBeNull();
    expect(dfcAdoptionShape(cardOf(rows[6]))).toBeNull();
    // The devoid front leaves its dress behind (no devoid DFC twin).
    expect(offered[0].offer?.losesDress).toBe("devoid");
    expect(offered[2].offer?.losesDress).toBeNull();
  });

  it("the offer is ONE layout — the shape's — with both bodies: Erza's cost-less back the transform pair, Vader's costed back the modal pair (5.1b)", () => {
    expect(dfcAdoptionOffer(cardOf(rows[2]))).toEqual({
      layout: "transform",
      label: "Transform",
      frontBody: "m15dfcfront",
      backBody: "m15dfcback",
      losesDress: null,
    });
    expect(dfcAdoptionOffer(cardOf(rows[1]))).toEqual({
      layout: "modal",
      label: "Modal double-faced",
      frontBody: "m15mdfcfront",
      backBody: "m15mdfcback",
      losesDress: null,
    });
    // The same back with its cost blanked is a transform card again.
    const costless = { ...cardOf(rows[1]), back_face: { ...rows[1].back_face, cost: "" } };
    expect(dfcAdoptionShape(costless)).toBe("transform");
    expect(dfcAdoptionOffer(costless)?.backBody).toBe("m15dfcback");
  });

  it("a cost-less LAND back is a transform card only with the printed sign of one (skeptic 2026-10-05): Ojer Taq's Temple keeps its reminder and its offer, a modal land back (Agadeem's shape on m15) reads as modal and is offered the modal pair (5.1b)", () => {
    // Row 6: the LCI transform land back prints "(Transforms from Ojer Taq,
    // Deepest Foundation.)" — the sign the cost can't give.
    const temple = cardOf(rows[5]);
    expect(dfcAdoptionShape(temple)).toBe("transform");
    expect(dfcAdoptionOffer(temple)).toMatchObject({ layout: "transform", frontBody: "m15dfcfront", backBody: "m15dfclandback" });
    // Row 9's shape (a ZNR modal land back: "enters tapped", no "transform"
    // on either face) moved onto m15 — the borderless skin aside, the cost
    // alone would have read it as transform and offered the transform land
    // back; the sign reads it as modal: the modal front for its sorcery, the
    // modal land back (5.1b).
    const agadeemOnM15 = { ...cardOf(rows[8]), frame_style: { finish: "regular", template: "m15" } };
    expect(/transform/i.test(`${rows[8].front.rules_text}${rows[8].back_face.rules_text}`)).toBe(false);
    expect(dfcAdoptionShape(agadeemOnM15)).toBe("modal");
    expect(dfcAdoptionOffer(agadeemOnM15)).toMatchObject({ layout: "modal", frontBody: "m15mdfcfront", backBody: "m15mdfclandback" });
    expect(adoptDfcBodiesPlan(agadeemOnM15, "transform")).toBeNull();
    // The Temple with its reminder cut from the back and nothing on the
    // front: modal too — held, never the transform land back on a guess.
    const unmarked = {
      ...temple,
      rules_text: "Vigilance",
      back_face: { ...rows[5].back_face, rules_text: "{T}: Add {W}." },
    };
    expect(dfcAdoptionShape(unmarked)).toBe("modal");
    expect(dfcAdoptionOffer(unmarked)).toMatchObject({ layout: "modal", frontBody: "m15mdfcfront", backBody: "m15mdfclandback" });
    // The front's word alone is enough (Golden Guardian's "returns
    // transformed"), as is the back's.
    expect(dfcAdoptionShape({ ...unmarked, rules_text: "When it dies, return it to the battlefield transformed." })).toBe("transform");
    expect(dfcAdoptionShape({ ...unmarked, back_face: { ...unmarked.back_face, rules_text: "(Transforms from Golden Guardian.)\n{T}: Add {C}." } })).toBe("transform");
    // A cost-less NON-land back needs no sign: every modal back but a land
    // carries a cost, so a cost-less creature back is a transform card
    // (Aang's row says "transform" nowhere).
    expect(/transform/i.test(`${rows[7].front.rules_text}${rows[7].back_face.rules_text}`)).toBe(false);
    expect(dfcAdoptionShape(cardOf(rows[7]))).toBe("transform");
  });

  it("never offers a card on a DFC body, one with a back body already, one with no back, or a template outside the M15 family", () => {
    const base = cardOf(rows[2]);
    expect(dfcAdoptionOffer({ ...base, frame_style: { template: "m15dfcfront" } })).toBeNull();
    expect(dfcAdoptionOffer({ ...base, back_face: { ...base.back_face, frame_style: { template: "m15dfcback" } } })).toBeNull();
    expect(dfcAdoptionOffer({ ...base, back_face: null })).toBeNull();
    expect(dfcAdoptionOffer({ ...base, frame_style: { template: "agclassic" } })).toBeNull();
    expect(dfcAdoptionOffer({ ...base, frame_style: { template: "m15borderless" } })).toBeNull();
    // No template at all (production's `{}` rows) draws as m15: offered.
    expect(dfcAdoptionOffer({ ...base, frame_style: {} })).not.toBeNull();
    expect(dfcAdoptionOffer({ ...base, frame_style: null })).not.toBeNull();
  });

  it("parses the layout on the wire: bodyFor's names and the kind's", () => {
    expect(parseDfcAdoptionLayout("transform")).toBe("transform");
    expect(parseDfcAdoptionLayout("modal")).toBe("modal");
    expect(parseDfcAdoptionLayout("mdfc")).toBe("modal");
    expect(parseDfcAdoptionLayout("flip")).toBeNull();
    expect(parseDfcAdoptionLayout(null)).toBeNull();
  });
});

describe("adoptDfcBodiesPlan — what the move writes", () => {
  it("the front onto its DFC twin with the family stamped and the switches the body can't draw dropped; the back onto its body in the front's colour, a transform back's cost stripped", () => {
    const card = { ...cardOf(rows[2]), frame_style: { finish: "foil", template: "m15", crown: true, twoColor: true, collector: "2023" } };
    const plan = adoptDfcBodiesPlan(card, "transform")!;
    expect(plan.frontBody).toBe("m15dfcfront");
    expect(plan.backBody).toBe("m15dfcback");
    // The crown and the two-colour switch survive the move since 5.1d (the
    // transform front body draws both).
    expect(plan.frame_style).toEqual({ finish: "foil", template: "m15dfcfront", crown: true, twoColor: true, collector: "2023", dfcIcon: "arrows" });
    expect(plan.back_face).toEqual({ ...rows[2].back_face, frame_style: { template: "m15dfcback" }, color_identity: ["white"] });
    expect(plan.back_face).not.toHaveProperty("cost");
    // The land back (Tobirama) lands on the land back, COLOURLESS — the land
    // pair is verified on `c` alone (one master under every key), so the
    // front's white could never pass the gate; the colourless Aang
    // back takes the front's five colours (the hint says: editable after).
    expect(adoptDfcBodiesPlan(cardOf(rows[5]), "transform")?.backBody).toBe("m15dfclandback");
    expect(adoptDfcBodiesPlan(cardOf(rows[5]), "transform")?.back_face.color_identity).toEqual(["colorless"]);
    expect(adoptDfcBodiesPlan(cardOf(rows[7]), "transform")?.back_face.color_identity).toEqual(rows[7].front.color_identity);
    // Vader (owner 2026-10-05): a costed back is a modal card — NO transform
    // plan (it would drop the Lantern's cost); the modal plan (5.1b) keeps
    // the cost, stamps no family and puts the back on the modal back in the
    // front's colour. Erza's cost-less back is a transform card: never modal.
    expect(adoptDfcBodiesPlan(cardOf(rows[1]), "transform")).toBeNull();
    const vaderModal = adoptDfcBodiesPlan(cardOf(rows[1]), "modal")!;
    expect(vaderModal).toMatchObject({ layout: "modal", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    expect(vaderModal.back_face.cost).toBe(rows[1].back_face.cost);
    expect(vaderModal.frame_style).not.toHaveProperty("dfcIcon");
    expect(vaderModal.back_face.color_identity).toEqual(rows[1].front.color_identity);
    expect(adoptDfcBodiesPlan(cardOf(rows[2]), "modal")).toBeNull();
    // Tobirama's transform-shaped land back has no modal plan; a modal LAND
    // back (Agadeem's shape on m15) onto the MODAL land back keeps the
    // front's colour (one land tint per colour, verified per colour) —
    // colourless is the transform land back's rule alone.
    expect(adoptDfcBodiesPlan(cardOf(rows[5]), "modal")).toBeNull();
    const agadeemOnM15 = { ...cardOf(rows[8]), frame_style: { finish: "regular", template: "m15" } };
    expect(adoptDfcBodiesPlan(agadeemOnM15, "modal")?.back_face).toMatchObject({
      card_type: "land",
      frame_style: { template: "m15mdfclandback" },
      color_identity: rows[8].front.color_identity,
    });
    // A row that isn't offered has no plan.
    expect(adoptDfcBodiesPlan(cardOf(rows[3]), "transform")).toBeNull();
  });
});

describe("adoptDfcBodiesAction", () => {
  function db() {
    const stub = chainClient((table, calls): ChainAnswer => {
      if (table === "cards" && called(calls, "update")) return { data: { id: CARD, slug: "erza" }, error: null };
      return { data: null, error: null, count: 0 };
    });
    state.client = stub.client;
    return stub;
  }
  const written = (stub: ReturnType<typeof db>) => {
    const entry = stub.forTable("cards").find((e) => called(e.calls, "update"));
    return payloadOf(entry?.calls ?? [], "update") as Record<string, unknown> | undefined;
  };
  const erza = () => ({ id: CARD, owner_id: USER, slug: "erza", visibility: "public", ...cardOf(rows[2]) });

  beforeEach(() => {
    state.verified = [frameComboKey("m15dfcfront", "w"), frameComboKey("m15dfcback", "w")];
    state.existing = erza();
    state.user = { id: USER };
    state.baked = [];
  });

  it("moves the card in place and re-bakes it (the front now; the back's bake is 5.3's)", async () => {
    const stub = db();
    const result = await adoptDfcBodiesAction(CARD, "transform");
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "erza", frontBody: "m15dfcfront", backBody: "m15dfcback" });
    const row = written(stub)!;
    expect(row.frame_style).toEqual({ finish: "regular", template: "m15dfcfront", dfcIcon: "arrows" });
    expect(row.back_face).toEqual({ ...rows[2].back_face, frame_style: { template: "m15dfcback" }, color_identity: ["white"] });
    expect(Object.keys(row).sort()).toEqual(["back_face", "frame_style"]);
    expect(state.baked).toEqual([CARD]);
  });

  it("moves Tobirama's land back onto the land back body in `c` with the front in the card's colour", async () => {
    state.verified = [frameComboKey("m15dfcfront", "w"), frameComboKey("m15dfclandback", "c")];
    state.existing = { id: CARD, owner_id: USER, slug: "tobirama", visibility: "public", ...cardOf(rows[5]) };
    const stub = db();
    const result = await adoptDfcBodiesAction(CARD, "transform");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = written(stub)!;
    expect((row.back_face as { frame_style: unknown; color_identity: unknown }).frame_style).toEqual({ template: "m15dfclandback" });
    expect((row.back_face as { color_identity: unknown }).color_identity).toEqual(["colorless"]);
    // The land back in the front's white is never asked for.
    state.verified = [frameComboKey("m15dfcfront", "w"), frameComboKey("m15dfclandback", "w")];
    expect((await adoptDfcBodiesAction(CARD, "transform")).ok).toBe(false);
  });

  it("the front's own rules hold on the new body: a colourless non-artifact front is refused (D2)", async () => {
    state.verified = [frameComboKey("m15dfcfront", "c"), frameComboKey("m15dfcback", "c")];
    state.existing = { ...erza(), color_identity: ["colorless"] };
    const stub = db();
    const result = await adoptDfcBodiesAction(CARD, "transform");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.formError).toMatch(/Artifact/);
    expect(written(stub)).toBeUndefined();
  });

  it("refuses until the front body AND the back body are verified in the card's colour", async () => {
    state.verified = [frameComboKey("m15dfcfront", "w")];
    const stub = db();
    const result = await adoptDfcBodiesAction(CARD, "transform");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.formError).toMatch(/isn't available in white yet/);
    expect(written(stub)).toBeUndefined();
    state.verified = [frameComboKey("m15dfcback", "w")];
    expect((await adoptDfcBodiesAction(CARD, "transform")).ok).toBe(false);
  });

  it("a modal-shaped back (owner 2026-10-05): 'transform' is refused by shape; 'mdfc' moves it onto the modal pair (5.1b) once both bodies are verified in the card's colour, the Lantern's cost kept", async () => {
    state.verified = [frameComboKey("m15dfcfront", "b"), frameComboKey("m15dfcback", "b")];
    state.existing = { id: CARD, owner_id: USER, slug: "vader", visibility: "public", ...cardOf(rows[1]) };
    const stub = db();
    expect(await adoptDfcBodiesAction(CARD, "transform")).toEqual({
      ok: false,
      formError: "This card moves onto the Modal double-faced frames only — its back carries a mana cost.",
    });
    // The transform pair verified is not the modal pair.
    const dark = await adoptDfcBodiesAction(CARD, "mdfc");
    expect(dark.ok).toBe(false);
    expect(dark.ok ? "" : dark.formError).toMatch(/isn't available in black yet/);
    expect(written(stub)).toBeUndefined();
    expect(state.baked).toEqual([]);
    state.verified = [frameComboKey("m15mdfcfront", "b"), frameComboKey("m15mdfcback", "b")];
    const result = await adoptDfcBodiesAction(CARD, "mdfc");
    expect(result).toEqual({ ok: true, cardId: CARD, slug: "erza", frontBody: "m15mdfcfront", backBody: "m15mdfcback" });
    const row = written(stub)!;
    expect(row.frame_style).toMatchObject({ template: "m15mdfcfront" });
    expect(row.frame_style).not.toHaveProperty("dfcIcon");
    expect(row.back_face).toEqual({ ...rows[1].back_face, frame_style: { template: "m15mdfcback" }, color_identity: ["black"] });
    expect(state.baked).toEqual([CARD]);
    // A modal LAND back (Agadeem's shape on m15: cost-less, no "transform"
    // on either face) is a modal card to the action too — never the
    // transform land back on the cost alone (skeptic 2026-10-05); its pair
    // is the modal front and the modal land back, in the front's colour.
    state.baked = [];
    state.verified = [frameComboKey("m15dfcfront", "b"), frameComboKey("m15dfclandback", "c")];
    state.existing = { id: CARD, owner_id: USER, slug: "agadeem", visibility: "public", ...cardOf(rows[8]), frame_style: { finish: "regular", template: "m15" } };
    const land = db();
    expect(await adoptDfcBodiesAction(CARD, "transform")).toEqual({
      ok: false,
      formError: "This card moves onto the Modal double-faced frames only — its back is a land without the printed sign of a transform card.",
    });
    expect((await adoptDfcBodiesAction(CARD, "mdfc")).ok).toBe(false);
    expect(written(land)).toBeUndefined();
    state.verified = [frameComboKey("m15mdfcfront", "b"), frameComboKey("m15mdfclandback", "b")];
    const moved = await adoptDfcBodiesAction(CARD, "mdfc");
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    expect(written(land)!.back_face).toMatchObject({ frame_style: { template: "m15mdfclandback" }, color_identity: ["black"] });
    expect(state.baked).toEqual([CARD]);
  });

  it("refuses a card that isn't offered, the layout the back's shape rules out, a bad layout, a card that isn't the caller's", async () => {
    const stub = db();
    state.existing = { ...erza(), frame_style: { template: "m15borderless" } };
    expect((await adoptDfcBodiesAction(CARD, "transform")).ok).toBe(false);
    state.existing = erza();
    expect(await adoptDfcBodiesAction(CARD, "modal")).toEqual({
      ok: false,
      formError: "This card moves onto the Transform frames only — its back has no mana cost.",
    });
    expect((await adoptDfcBodiesAction(CARD, "flip")).ok).toBe(false);
    state.existing = { ...erza(), owner_id: "99999999-9999-4999-8999-999999999999" };
    expect((await adoptDfcBodiesAction(CARD, "transform")).ok).toBe(false);
    state.existing = erza();
    state.user = null;
    expect((await adoptDfcBodiesAction(CARD, "transform")).ok).toBe(false);
    expect((await adoptDfcBodiesAction("not-a-uuid", "transform")).ok).toBe(false);
    expect(written(stub)).toBeUndefined();
    expect(state.baked).toEqual([]);
  });
});
