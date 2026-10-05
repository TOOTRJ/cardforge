import { describe, expect, it, vi } from "vitest";
import legacy from "./fixtures/dfc-legacy-backs.json";

// ---------------------------------------------------------------------------
// TODO 5.2 follow-up (owner 2026-10-05) — the hint ONCE the modal bodies
// exist (5.1b). The hint offers only the layout a legacy back's SHAPE
// derives — a back with a mana cost is a modal card — so Vader's Lantern
// gets nothing today (dfc-adopt.test.ts). Here the mocked-profile fixture
// (tests/unit/cards/dfc-fixture.ts) declares m15snow a modal FRONT and
// m15devoid a modal BACK, and bodyFor answers them for the modal layout:
// Vader is then offered the Modal layout, the plan keeps the Lantern's
// cost, and a move onto Transform is still refused by shape.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("./dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});
vi.mock("@/lib/cards/dfc", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/dfc")>();
  const bodyFor: typeof real.bodyFor = (layout, role, faceType, family) =>
    layout === "modal" ? (role === "front" ? "m15snow" : "m15devoid") : real.bodyFor(layout, role, faceType, family);
  return { ...real, bodyFor };
});

import { adoptDfcBodiesPlan, dfcAdoptionOffer, dfcAdoptionShape, type DfcAdoptionCard } from "@/lib/cards/dfc-adopt";
import type { ColorIdentity } from "@/types/card";

type LegacyRow = {
  label: string;
  front: Record<string, unknown> & { frame_style: { template?: string }; color_identity: ColorIdentity[]; card_type: string };
  back_face: Record<string, unknown> & { card_type?: string; cost?: string | null };
};
const rows = (legacy as unknown as { rows: LegacyRow[] }).rows;
const cardOf = (row: LegacyRow): DfcAdoptionCard & { back_face: LegacyRow["back_face"] } => ({ ...row.front, back_face: row.back_face });

describe("dfcAdoptionOffer once bodyFor answers the modal layout", () => {
  it("Vader is offered the Modal layout — the fifth of the nine; the four transform rows, the walker, the borderless two and the adventure row are as today", () => {
    const offered = rows.map((row) => ({ label: row.label, offer: dfcAdoptionOffer(cardOf(row)) }));
    expect(offered.filter((r) => r.offer).map((r) => r.label.split("//")[1]?.trim().split(" (")[0])).toEqual([
      "Avacyn, the Purifier",
      "Tergrid's Lantern",
      "Avacyn, the Purifier",
      "Temple of Civilization",
      "Aang, Master of Elements",
    ]);
    expect(offered[1].offer).toEqual({
      layout: "modal",
      label: "Modal double-faced",
      frontBody: "m15snow",
      backBody: "m15devoid",
      losesDress: null,
    });
    expect(offered[0].offer?.layout).toBe("transform");
    // The adventure stored as a back face (a costed sorcery under a
    // permanent) is excluded by SHAPE, modal bodies or not.
    expect(dfcAdoptionShape(cardOf(rows[6]))).toBeNull();
    expect(dfcAdoptionOffer(cardOf(rows[6]))).toBeNull();
    // A modal LAND back (Agadeem's shape, moved off the borderless skin onto
    // m15) is offered the MODAL pair that day — never the transform land
    // back: a cost-less land back without the printed sign of a transform
    // card reads as modal (skeptic 2026-10-05). The Temple, with its
    // "(Transforms from …)" reminder, stays transform.
    const agadeemOnM15 = { ...cardOf(rows[8]), frame_style: { finish: "regular", template: "m15" } };
    expect(dfcAdoptionShape(agadeemOnM15)).toBe("modal");
    expect(dfcAdoptionOffer(agadeemOnM15)).toMatchObject({ layout: "modal", frontBody: "m15snow", backBody: "m15devoid" });
    expect(adoptDfcBodiesPlan(agadeemOnM15, "transform")).toBeNull();
    expect(adoptDfcBodiesPlan(agadeemOnM15, "modal")?.back_face).toMatchObject({ card_type: "land", frame_style: { template: "m15devoid" } });
    expect(dfcAdoptionOffer(cardOf(rows[5]))).toMatchObject({ layout: "transform", backBody: "m15dfclandback" });
  });

  it("the modal plan keeps the Lantern's cost and stamps no family; a transform plan is still refused by shape", () => {
    const plan = adoptDfcBodiesPlan(cardOf(rows[1]), "modal")!;
    expect(plan.layout).toBe("modal");
    expect(plan.frontBody).toBe("m15snow");
    expect(plan.backBody).toBe("m15devoid");
    expect(plan.frame_style.template).toBe("m15snow");
    expect(plan.frame_style).not.toHaveProperty("dfcIcon");
    expect(plan.back_face).toMatchObject({
      cost: "{3}{B}",
      card_type: "artifact",
      frame_style: { template: "m15devoid" },
      color_identity: ["black"],
    });
    expect(adoptDfcBodiesPlan(cardOf(rows[1]), "transform")).toBeNull();
    // A transform-shaped back is never a modal plan either.
    expect(adoptDfcBodiesPlan(cardOf(rows[2]), "modal")).toBeNull();
    expect(adoptDfcBodiesPlan(cardOf(rows[2]), "transform")?.backBody).toBe("m15dfcback");
  });
});
