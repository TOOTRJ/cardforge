import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 5.4 — a MODAL printing once 5.1b declares its bodies. The modal rows
// of `bodyFor` are 5.1b's; until then dfc-imports.test.ts shows a modal
// printing landing as TODAY. Here four existing templates stand in for the
// modal bodies (never the real PROFILES — a declared `dfc` on their
// profile, `bodyFor`'s modal rows and the kind's gallery mocked): m15snow =
// the modal front, m15devoid = the modal back (both dress `c` as the
// artifact master, design D2), m15snowland / m15textlessland = the land pair
// (one master, no stand-in). The same mapper, registry and remix code then
// turns a modal printing onto the bodies by itself.
// ---------------------------------------------------------------------------

const { MODAL_FRONT, MODAL_BACK, MODAL_LAND_FRONT, MODAL_LAND_BACK } = vi.hoisted(() => ({
  MODAL_FRONT: "m15snow",
  MODAL_BACK: "m15devoid",
  MODAL_LAND_FRONT: "m15snowland",
  MODAL_LAND_BACK: "m15textlessland",
}));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const declared: Record<string, { dfc: import("@/lib/cards/template-layout").DfcProfile; artifactMasterKeys?: { c: "a" } }> = {
    [MODAL_FRONT]: { dfc: { layout: "modal", role: "front", well: "left" }, artifactMasterKeys: { c: "a" } },
    [MODAL_BACK]: { dfc: { layout: "modal", role: "back", well: "left" }, artifactMasterKeys: { c: "a" } },
    [MODAL_LAND_FRONT]: { dfc: { layout: "modal", role: "front", well: "left", land: true } },
    [MODAL_LAND_BACK]: { dfc: { layout: "modal", role: "back", well: "left", land: true } },
  };
  const cache = new Map<string, ReturnType<typeof real.getFrameProfile>>();
  return {
    ...real,
    getFrameProfile: (template: string | undefined) => {
      const base = real.getFrameProfile(template);
      const extra = template ? declared[template] : undefined;
      if (!extra) return base;
      const hit = cache.get(template!);
      if (hit) return hit;
      const merged = { ...base, ...extra };
      cache.set(template!, merged);
      return merged;
    },
  };
});

vi.mock("@/lib/cards/dfc", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/dfc")>();
  const modal = (role: string, faceType: string | null | undefined) =>
    role === "front"
      ? faceType === "land"
        ? MODAL_LAND_FRONT
        : MODAL_FRONT
      : faceType === "land"
        ? MODAL_LAND_BACK
        : MODAL_BACK;
  return {
    ...real,
    bodyFor: (layout: "transform" | "modal", role: "front" | "back", faceType: string | null | undefined, family?: never) =>
      layout === "modal" ? modal(role, faceType) : real.bodyFor(layout, role, faceType, family),
    isDeclaredDfcBody: (template: string | null | undefined) =>
      [MODAL_FRONT, MODAL_BACK, MODAL_LAND_FRONT, MODAL_LAND_BACK].includes(template ?? "") || real.isDeclaredDfcBody(template),
  };
});

vi.mock("@/lib/creator/card-kinds", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/creator/card-kinds")>();
  const modalFronts: string[] = [MODAL_FRONT, MODAL_LAND_FRONT];
  return {
    ...real,
    KIND_DEFS: { ...real.KIND_DEFS, mdfc: { ...real.KIND_DEFS.mdfc, layoutTemplates: modalFronts } },
    templateSupportsKind: (template: string, kind: string) =>
      kind === "mdfc" ? modalFronts.includes(template) : real.templateSupportsKind(template as never, kind as never),
  };
});

import dfcPrintings from "./fixtures/dfc-import-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { dfcImportOf, frameMatchFromScryfall, kindFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

const ALL = { ...dfcPrintings, ...signaturePrintings } as Record<string, unknown>;
const printing = (key: string): ScryfallCard => scryfallCardSchema.parse(ALL[key]);
const keys = (...combos: [string, string][]) =>
  new Set(combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour)));

describe("a modal printing once the modal bodies exist (5.1b)", () => {
  it("lands on the modal bodies: the Modal kind, the front body by the front's type, the back by the back's, each face's own colour (no family)", () => {
    // STX #147 Augmenter Pugilist // Echoing Equation: a green creature
    // front, a blue sorcery back.
    const facts = dfcImportOf(printing("stx-147"));
    expect(facts).toMatchObject({ layout: "modal", kind: "mdfc", blocked: null, frontBody: MODAL_FRONT, backBody: MODAL_BACK });
    expect(kindFromScryfall(printing("stx-147"))).toBe("mdfc");
    const patch = mapScryfallToFormPatch(printing("stx-147"));
    expect(patch).toMatchObject({ kind: "mdfc", frame_template: MODAL_FRONT, color_identity: ["green"] });
    expect(patch.printed_dfc_icon).toBeUndefined();
    expect(patch.back_face).toMatchObject({ title: "Echoing Equation", card_type: "sorcery", cost: "{3}{U}{U}", frame_style: { template: MODAL_BACK }, color_identity: ["blue"] });
    // ZNR #12 Emeria's Call: a sorcery front // a land back, colourless on
    // the land back; KHM #112 Tergrid: a black artifact back with a cost.
    expect(mapScryfallToFormPatch(printing("znr-12"))).toMatchObject({
      kind: "mdfc",
      frame_template: MODAL_FRONT,
      back_face: { card_type: "land", frame_style: { template: MODAL_LAND_BACK }, color_identity: ["colorless"] },
    });
    expect(mapScryfallToFormPatch(printing("khm-112")).back_face).toMatchObject({
      card_type: "artifact",
      cost: "{3}{B}",
      frame_style: { template: MODAL_BACK },
      color_identity: ["black"],
    });
    // A land // land Pathway: the land pair, both colourless.
    expect(mapScryfallToFormPatch(printing("znr-284"))).toMatchObject({
      kind: "mdfc",
      frame_template: MODAL_LAND_FRONT,
      color_identity: ["colorless"],
      back_face: { frame_style: { template: MODAL_LAND_BACK }, color_identity: ["colorless"] },
    });
  });

  it("the registry: exact on the modal front body; a colourless Avatar front is the body's frame landing on the standard (5.11); devoid and borderless are nearest on the body", () => {
    expect(frameMatchFromScryfall(printing("stx-147"))).toMatchObject({ signature: "modal/2015", status: "exact", template: MODAL_FRONT });
    expect(frameMatchFromScryfall(printing("znr-12"))).toMatchObject({ signature: "modal/2015", status: "exact", template: MODAL_FRONT });
    // STX #6 Wandering Archaic: a colourless creature front with no
    // Artifact word.
    expect(dfcImportOf(printing("stx-6"))).toMatchObject({ blocked: "colourless-face", frontBody: MODAL_FRONT, backBody: MODAL_BACK });
    expect(frameMatchFromScryfall(printing("stx-6"))).toMatchObject({ signature: "dfc/colourless-face", status: "nearest", template: MODAL_FRONT, landOn: "m15", blockedBy: "5.11" });
    expect(mapScryfallToFormPatch(printing("stx-6"))).toMatchObject({ kind: "creature", frame_template: "m15" });
    // MH3 #253 Drowner of Truth, a devoid MDFC.
    expect(frameMatchFromScryfall(printing("mh3-253"))).toMatchObject({ signature: "dfc/devoid", status: "nearest", template: MODAL_FRONT, blockedBy: "5.11" });
    // ZNR #284 Branchloft Pathway, borderless: nearest on the land front
    // (no bordered twin to land on).
    expect(frameMatchFromScryfall(printing("znr-284"))).toMatchObject({ signature: "borderless/dfc", status: "nearest", template: MODAL_LAND_FRONT, blockedBy: "5.7" });
    expect(frameMatchFromScryfall(printing("znr-284")).landOn).toBeUndefined();
    // ZNR #305 Kazandu Mammoth, the hedron showcase: the showcase frame
    // can't dress the Modal kind, so it lands on the body.
    expect(frameMatchFromScryfall(printing("znr-305"))).toMatchObject({ status: "nearest", template: "fullart", landOn: MODAL_FRONT });
  });

  it("the landing is verified on both faces, and the remix keeps both at two credits", () => {
    const patch = mapScryfallToFormPatch(printing("stx-147"));
    const frontOnly = finalizeImportMatch(patch, keys([MODAL_FRONT, "g"]));
    expect(frontOnly).toMatchObject({ kind: "creature", frame_template: "m15" });
    expect(frontOnly.frame_match).toMatchObject({ status: "nearest", landOn: "m15", unverified: true, reason: "the back face's frame isn't verified in blue yet" });
    const both = keys([MODAL_FRONT, "g"], [MODAL_BACK, "u"]);
    expect(finalizeImportMatch(patch, both)).toMatchObject({ kind: "mdfc", frame_template: MODAL_FRONT, frame_match: { status: "exact" } });
    const remix = scryfallRemixMechanics(patch, "Augmenter Pugilist", both);
    if (!remix.ok) throw new Error(remix.error);
    expect(remix.mechanics).toMatchObject({
      frame_template: MODAL_FRONT,
      card_type: "creature",
      back_face: { title: "Echoing Equation", cost: "{3}{U}{U}", frame_style: { template: MODAL_BACK }, color_identity: ["blue"] },
    });
    expect(remix.mechanics.anatomy.dfcIcon).toBeUndefined();
    expect(remixCreditsOf(remix.mechanics)).toBe(2);
    const standard = scryfallRemixMechanics(patch, "Augmenter Pugilist", keys(["m15", "g"]));
    if (!standard.ok) throw new Error(standard.error);
    expect(standard.mechanics.frame_template).toBe("m15");
    expect(standard.mechanics.back_face).toBeUndefined();
  });
});
