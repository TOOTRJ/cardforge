import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import legacy from "./fixtures/dfc-legacy-backs.json";

// ---------------------------------------------------------------------------
// TODO 5.2 — the 8 imported double-faced cards onto the real frames (owner
// 2026-10-02, Q3: in place, one click): who the hint is offered to (4 of
// the 8 today — Titânia on devoid, Erza, Tobirama's land back, Aang; Vader's
// costed artifact back is a MODAL card and gets nothing until the modal
// bodies exist — owner 2026-10-05: the hint offers ONLY the layout the
// back's shape derives, see dfc-adopt-modal.test.ts for the day they do;
// never the two on m15borderless, the walker back or the adventure row),
// what the move writes, and the action's gates.
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
  it("offers exactly the FOUR wave-1 rows of production's nine today — the layout the back's SHAPE derives, so Vader's costed back (a modal card) waits for the modal bodies", () => {
    const offered = rows.map((row) => ({ label: row.label, offer: dfcAdoptionOffer(cardOf(row)) }));
    expect(offered.filter((r) => r.offer).map((r) => r.label.split("//")[1]?.trim().split(" (")[0])).toEqual([
      "Avacyn, the Purifier",
      "Avacyn, the Purifier",
      "Temple of Civilization",
      "Aang, Master of Elements",
    ]);
    const refused = offered.filter((r) => !r.offer).map((r) => r.label);
    expect(refused).toHaveLength(5);
    expect(refused.join("\n")).toMatch(/Tibalt/); // a walker back
    expect(refused.join("\n")).toMatch(/NOT a DFC/); // the adventure row
    expect(refused.filter((label) => /m15borderless/.test(label))).toHaveLength(2);
    // Vader (owner 2026-10-05): a back WITH a mana cost is a modal card, so
    // its shape derives the MODAL layout — whose bodies don't exist yet —
    // and nothing is offered: a move onto Transform would have dropped the
    // Lantern's cost. The shape is still read (the action's message).
    expect(refused.filter((label) => /modal: black legendary creature \/\/ Tergrid's Lantern/.test(label))).toHaveLength(1);
    expect(dfcAdoptionShape(cardOf(rows[1]))).toBe("modal");
    expect(dfcAdoptionShape(cardOf(rows[0]))).toBe("transform");
    // A row that is no candidate at all has no shape either.
    expect(dfcAdoptionShape(cardOf(rows[3]))).toBeNull();
    expect(dfcAdoptionShape(cardOf(rows[6]))).toBeNull();
    // The devoid front leaves its dress behind (no devoid DFC twin).
    expect(offered[0].offer?.losesDress).toBe("devoid");
    expect(offered[2].offer?.losesDress).toBeNull();
  });

  it("the offer is ONE layout — the shape's — with both bodies; a modal-shaped back has none until 5.1b", () => {
    expect(dfcAdoptionOffer(cardOf(rows[2]))).toEqual({
      layout: "transform",
      label: "Transform",
      frontBody: "m15dfcfront",
      backBody: "m15dfcback",
      losesDress: null,
    });
    expect(dfcAdoptionOffer(cardOf(rows[1]))).toBeNull();
    // The same back with its cost blanked is a transform card again.
    const costless = { ...cardOf(rows[1]), back_face: { ...rows[1].back_face, cost: "" } };
    expect(dfcAdoptionShape(costless)).toBe("transform");
    expect(dfcAdoptionOffer(costless)?.backBody).toBe("m15dfcback");
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
    expect(plan.frame_style).toEqual({ finish: "foil", template: "m15dfcfront", collector: "2023", dfcIcon: "arrows" });
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
    // plan (it would drop the Lantern's cost) and no modal plan until the
    // bodies exist. Erza's cost-less back is a transform card: never modal.
    expect(adoptDfcBodiesPlan(cardOf(rows[1]), "transform")).toBeNull();
    expect(adoptDfcBodiesPlan(cardOf(rows[1]), "modal")).toBeNull();
    expect(adoptDfcBodiesPlan(cardOf(rows[2]), "modal")).toBeNull();
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

  it("refuses a modal-shaped back's 'transform' — and its 'mdfc' until the modal bodies exist (owner 2026-10-05)", async () => {
    state.verified = [frameComboKey("m15dfcfront", "b"), frameComboKey("m15dfcback", "b")];
    state.existing = { id: CARD, owner_id: USER, slug: "vader", visibility: "public", ...cardOf(rows[1]) };
    const stub = db();
    const notYet = { ok: false, formError: "The Modal double-faced frames aren't built yet." };
    expect(await adoptDfcBodiesAction(CARD, "transform")).toEqual(notYet);
    expect(await adoptDfcBodiesAction(CARD, "modal")).toEqual(notYet);
    expect(await adoptDfcBodiesAction(CARD, "mdfc")).toEqual(notYet);
    expect(written(stub)).toBeUndefined();
    expect(state.baked).toEqual([]);
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
