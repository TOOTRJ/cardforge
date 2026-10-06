import { describe, expect, it, vi } from "vitest";
import referencesData from "@/lib/cards/frame-references.json";
import registryPrintingsData from "../cards/fixtures/reference-printings.json";
import importPrintingsData from "./fixtures/dfc-import-printings.json";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { CardFace } from "@/lib/cards/card-face";
import type { DfcIconFamily, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.0d — what /admin/frame-compare, the sign-off's side-by-side and the
// scorer are handed for a DOUBLE-FACED reference (buildFrameComparePayload on
// the REAL profiles and the captured printings; no network):
//
//   1. the printing's icon FAMILY. The reference preview never carried it, so
//      `frame_style.dfcIcon` was absent and read as `arrows`: every sun / moon
//      back on the 2016–22 body drew a ▼ in the well where the scan prints
//      the moon, and a sun / moon front the ▲ for its sun. It is now the
//      family the printing's `frame_effects` name — the mapper's own
//      derivation (lib/cards/dfc.ts dfcIconFamilyFromEffects) — on every
//      transform body, front and back, whichever face is viewed; a modal
//      body has none;
//   2. the cross-face block ON the payload. A front's `dfc` block (the
//      back's P/T for the grey tab, the family, the modal strip's word, line
//      and key) was derived only inside the live preview, so the scorer,
//      which bakes the payload's preview as given, baked a front without
//      any of it. The front payload now carries the block lib/cards/faces.ts
//      derives (frontPreviewData), as the back's always did
//      (backPreviewData).
//
// The printings: every reference `lib/cards/frame-references.json` lists on a
// double-faced body (tests/unit/cards/fixtures/reference-printings.json — the
// registry names two families there today, sun / moon on MID / VOW / SOI and
// the plain ▲ / ▼ on INR / MOM / LCI / TLA / ECL / FIN), and, for the
// families no registry row has yet (as an admin's pinned printing would
// bring them), 5.4's import captures (fixtures/dfc-import-printings.json:
// EMN #63 moon / Emrakul, XLN #22 compass / land, BOT #1 `convertdfc`,
// ORI #60 `originpwdfc`) and NEO #227, the registry's own fan printing (on
// `saga`).
//
// "As it was": the last block holds the payloads this must NOT move — an
// `arrows` reference, a modal one and every non-DFC template — to a snapshot
// GENERATED ON THE BASE (origin/feat/dfc-strip-rider d9e877e6, this file run
// there; the split and the adventure by the #470 skeptic with main's
// builder — lib/ is the same tree at d9e877e6 and at main fe34b749) and only
// read since.
// ---------------------------------------------------------------------------

vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  const registry = (await import("../cards/fixtures/reference-printings.json")).default as Record<string, unknown>;
  const imports = (await import("./fixtures/dfc-import-printings.json")).default as Record<string, unknown>;
  const byId = new Map<string, unknown>();
  for (const [key, card] of Object.entries(imports)) {
    if (key !== "_note") byId.set((card as { id: string }).id, card);
  }
  // The registry's own capture wins for a printing both files hold.
  for (const [id, card] of Object.entries(registry)) byId.set(id, card);
  return {
    ...actual,
    getCardById: async (id: string) => (byId.has(id) ? actual.scryfallCardSchema.parse(byId.get(id)) : null),
  };
});

import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { bodyFor, dfcBodyOf, dfcIconFamilyFromEffects, faceUnderTest } from "@/lib/cards/dfc";
import { frontPreviewData } from "@/lib/cards/faces";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, parseTypeLine } from "@/lib/scryfall/import-mapper";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

type Printing = {
  id: string;
  name: string;
  set: string;
  collector_number: string;
  frame_effects?: string[];
  card_faces?: Array<{ name?: string; type_line?: string }>;
};
type Ref = { name: string; set: string; scryfallId: string; face?: 1 };

const registry = referencesData as unknown as Record<string, { colors: Record<string, Ref[] | null> }>;
const registryPrintings = registryPrintingsData as unknown as Record<string, Printing>;
const importPrintings = importPrintingsData as unknown as Record<string, Printing>;

/** What each family prints in the well of each face (frames.md §4.6) — the
 *  test's own table, not the code's. */
const GLYPH: Record<DfcIconFamily, { front: string; back: string }> = {
  arrows: { front: "default", back: "downarrow" },
  sunmoon: { front: "sun", back: "moon" },
  moon: { front: "fullmoon", back: "emrakul" },
  compass: { front: "compass", back: "land" },
  fan: { front: "fanclosed", back: "fanopen" },
};

/** The bodies whose well the rider fills: the two left-well faces and the
 *  land front. The ▼-right back's ▼ is in its master and the land back has
 *  no well. */
const RIDER_BODIES: readonly string[] = ["m15dfcfront", "m15dfcbackleft", "m15dfclandfront"];

/** The icon rider a face draws from the data a renderer is HANDED — the
 *  bake's own reading (lib/render/card-image.tsx anatomyFactsOf: the `dfc`
 *  block as given, never derived there), so a payload without the block
 *  draws none. */
function iconRiderOf(data: CardPreviewData): string | null {
  const profile = getFrameProfile(data.frameStyle?.template);
  const rider = resolveFrameOverlays(profile, data.frameStyle, {
    colors: data.colorIdentity,
    cost: data.cost,
    cardType: data.cardType,
    supertype: data.supertype,
    rarity: data.rarity,
    dfc: data.dfc ? { role: data.dfc.role, icon: data.dfc.icon, stripKey: data.dfc.otherFace.stripKey } : null,
    colorKey: pickFrameColorKey(data.colorIdentity),
  }).find((overlay) => overlay.anatomy === "dfcIcon");
  if (!rider) return null;
  expect(rider.path).toBe(`/frames/dfcicon/${rider.key}.png`);
  return rider.key;
}

async function payloadOf(id: string, template: FrameTemplate, face: CardFace = "front") {
  const payload = await buildFrameComparePayload(id, template, face);
  if (!payload) throw new Error(`no payload for ${id} on ${template}`);
  return payload;
}

type Row = { combo: string; template: FrameTemplate; colour: string; ref: Ref; printing: Printing };
const rows: Row[] = Object.entries(registry)
  .filter(([template]) => dfcBodyOf(template))
  .flatMap(([template, def]) =>
    Object.entries(def.colors).flatMap(([colour, list]) =>
      (list ?? []).map((ref, index) => ({
        combo: `${template}/${colour}#${index}`,
        template: template as FrameTemplate,
        colour,
        ref,
        printing: registryPrintings[ref.scryfallId],
      })),
    ),
  );

const familyOf = (printing: Printing): DfcIconFamily => dfcIconFamilyFromEffects(printing.frame_effects);
const faceType = (printing: Printing, face: 0 | 1) => parseTypeLine(printing.card_faces?.[face]?.type_line).card_type;
const refOf = (template: string, colour: string, index = 0): Ref => {
  const ref = registry[template]?.colors[colour]?.[index];
  if (!ref) throw new Error(`no registry reference at ${template}/${colour}#${index}`);
  return ref;
};

describe("fixtures", () => {
  it("the rider bodies are the profiles that declare the icon rider", () => {
    const declared = FRAME_TEMPLATE_VALUES.filter((template) =>
      (getFrameProfile(template).overlays ?? []).some((overlay) => overlay.anatomy === "dfcIcon"),
    );
    expect([...declared].sort()).toEqual([...RIDER_BODIES].sort());
  });

  it("every double-faced reference has a captured printing with two faces", () => {
    expect(rows.length).toBeGreaterThan(80);
    for (const row of rows) {
      expect(row.printing, row.combo).toBeDefined();
      expect(row.printing.card_faces, row.combo).toHaveLength(2);
    }
  });

  it("the registry's rows exercise both a sun / moon printing and a plain ▲ / ▼ one on the front, and a left-well back is never the ▼'s", () => {
    const familiesOn = (template: string) =>
      [...new Set(rows.filter((row) => row.template === template).map((row) => familyOf(row.printing)))].sort();
    // Today: arrows + sun / moon on the front, sun / moon alone on the
    // 2016–22 back (11 rows), arrows on the land front.
    expect(familiesOn("m15dfcfront")).toEqual(expect.arrayContaining(["arrows", "sunmoon"]));
    expect(familiesOn("m15dfcbackleft")).toContain("sunmoon");
    // The pin check's rule (transformBackBodyFor): a ▲ / ▼ printing's back
    // wears the ▼-right body.
    expect(familiesOn("m15dfcbackleft")).not.toContain("arrows");
    // Scryfall's effect per set, on the registry's own captures.
    const bySet: Record<string, DfcIconFamily[]> = {};
    for (const row of rows.filter((r) => dfcBodyOf(r.template)?.layout === "transform")) {
      bySet[row.ref.set] = [...new Set([...(bySet[row.ref.set] ?? []), familyOf(row.printing)])];
    }
    expect(bySet).toMatchObject({
      mid: ["sunmoon"],
      vow: ["sunmoon"],
      soi: ["sunmoon"],
      inr: ["arrows"],
      mom: ["arrows"],
    });
  });
});

describe("every double-faced reference of the registry, on the face its row compares", () => {
  it.each(rows)("$combo $ref.name ($ref.set) carries its printed family and draws that family's glyph", async (row) => {
    const body = dfcBodyOf(row.template)!;
    // A modal housing has no family (lib/cards/faces.ts dfcBlock).
    const family = body.layout === "transform" ? familyOf(row.printing) : null;
    const { preview, face } = await payloadOf(row.ref.scryfallId, row.template, faceUnderTest(row.template));

    expect(face).toBe(body.role);
    // The block rides on the payload itself, front and back: the face as
    // the bake is handed it.
    expect(preview.dfc, row.combo).toMatchObject({ layout: body.layout, role: body.role, icon: family });
    // The key is named for a family that is not the default; `arrows` is the
    // absent key, so a ▲ / ▼ reference's style is what it was.
    expect(preview.frameStyle?.dfcIcon, row.combo).toBe(family && family !== "arrows" ? family : undefined);
    expect(iconRiderOf(preview), row.combo).toBe(
      family && RIDER_BODIES.includes(row.template) ? GLYPH[family][body.role] : null,
    );
  });

  it("the 2016–22 back's seven default references (MID's sun / moon backs) draw the MOON in the left well — each drew the ▼", async () => {
    // The row the owner opens first: MID #27's back.
    const phantom = refOf("m15dfcbackleft", "w");
    expect(`${phantom.set} ${phantom.name}`).toBe("mid Luminous Phantom");
    expect(iconRiderOf((await payloadOf(phantom.scryfallId, "m15dfcbackleft", "back")).preview)).toBe("moon");
    // …and every colour's default: its own family's back glyph, never the
    // default family's ▼ (a left well prints none).
    for (const colour of ["w", "u", "b", "r", "g", "c", "m"]) {
      const ref = refOf("m15dfcbackleft", colour);
      const family = familyOf(registryPrintings[ref.scryfallId]);
      const { preview } = await payloadOf(ref.scryfallId, "m15dfcbackleft", "back");
      expect(preview.dfc?.icon, colour).toBe(family);
      expect(iconRiderOf(preview), colour).toBe(GLYPH[family].back);
      expect(iconRiderOf(preview), colour).not.toBe("downarrow");
    }
  });

  it("a sun / moon FRONT reference draws the SUN (it drew the ▲); the ▲ references keep theirs", async () => {
    const sun = refOf("m15dfcfront", "g", 1);
    expect(`${sun.set} ${sun.name}`).toBe("mid Bird Admirer");
    expect(iconRiderOf((await payloadOf(sun.scryfallId, "m15dfcfront")).preview)).toBe("sun");
    const arrow = refOf("m15dfcfront", "w");
    expect(`${arrow.set} ${arrow.name}`).toBe("mom Tarkir Duneshaper");
    expect(iconRiderOf((await payloadOf(arrow.scryfallId, "m15dfcfront")).preview)).toBe("default");
  });
});

describe("one family on both faces, viewed from either", () => {
  const transformPrintings = [
    ...new Map(
      rows
        .filter((row) => dfcBodyOf(row.template)?.layout === "transform")
        .map((row) => [row.ref.scryfallId, row.printing] as const),
    ).values(),
  ];

  it.each(transformPrintings)("$name ($set #$collector_number)", async (printing) => {
    const family = familyOf(printing);
    const frontBody = bodyFor("transform", "front", faceType(printing, 0));
    const backBody = bodyFor("transform", "back", faceType(printing, 1), family);
    if (!frontBody || !backBody) throw new Error(`no body for ${printing.name}`);

    const front = (await payloadOf(printing.id, frontBody)).preview;
    const back = (await payloadOf(printing.id, backBody, "back")).preview;
    expect(front.dfc).toMatchObject({ layout: "transform", role: "front", icon: family });
    expect(back.dfc).toMatchObject({ layout: "transform", role: "back", icon: family });
    expect(iconRiderOf(front)).toBe(GLYPH[family].front);
    expect(iconRiderOf(back)).toBe(RIDER_BODIES.includes(backBody) ? GLYPH[family].back : null);

    // The front body's `?face=back` view is a LEGACY back (the back's
    // content on the front's frame, no block): nothing is drawn from the
    // family there, as before.
    const legacy = (await payloadOf(printing.id, frontBody, "back")).preview;
    expect(legacy.dfc).toBeNull();
    expect(iconRiderOf(legacy)).toBeNull();
  });
});

describe("every family, as a pinned printing would bring it", () => {
  const imported = (key: string): Printing => {
    const printing = importPrintings[key];
    if (!printing) throw new Error(`no import fixture ${key}`);
    return printing;
  };
  const kamiWar = registryPrintings[refOf("saga", "m").scryfallId];

  const CASES: Array<{
    label: string;
    printing: Printing;
    family: DfcIconFamily;
    front: FrameTemplate;
    back: FrameTemplate;
  }> = [
    { label: "sun / moon — MID #169", printing: imported("mid-169"), family: "sunmoon", front: "m15dfcfront", back: "m15dfcbackleft" },
    { label: "sun / moon — VOW #157", printing: imported("vow-157"), family: "sunmoon", front: "m15dfcfront", back: "m15dfcbackleft" },
    // EMN #63's colourless Eldrazi back is the see-through sample (5.11):
    // the pin check keeps it off the `c` row, the builder draws what it is
    // given — the one capture that prints the Emrakul glyph.
    { label: "moon / Emrakul — EMN #63", printing: imported("emn-63"), family: "moon", front: "m15dfcfront", back: "m15dfcbackleft" },
    // XLN's back is a LAND: the land back, which has no well (the parchment
    // back is 5.8) — the family still rides on the card.
    { label: "compass / land — XLN #22", printing: imported("xln-22"), family: "compass", front: "m15dfcfront", back: "m15dfclandback" },
    { label: "fan — NEO #227", printing: kamiWar, family: "fan", front: "m15dfcfront", back: "m15dfcbackleft" },
    { label: "▲ / ▼, no effect — INR #60", printing: imported("inr-60"), family: "arrows", front: "m15dfcfront", back: "m15dfcback" },
    { label: "▲ / ▼, no effect — MOM #36", printing: imported("mom-36"), family: "arrows", front: "m15dfcfront", back: "m15dfcback" },
    { label: "▲ / ▼, convertdfc — BOT #1", printing: imported("bot-1"), family: "arrows", front: "m15dfcfront", back: "m15dfcback" },
    { label: "▲ / ▼, a land back — LCI #26", printing: imported("lci-26"), family: "arrows", front: "m15dfcfront", back: "m15dfclandback" },
  ];

  it("the captures name the effects the cases stand on", () => {
    expect(imported("emn-63").frame_effects).toContain("mooneldrazidfc");
    expect(imported("xln-22").frame_effects).toContain("compasslanddfc");
    expect(kamiWar.frame_effects).toContain("fandfc");
    expect(`${kamiWar.set} #${kamiWar.collector_number}`).toBe("neo #227");
    expect(imported("bot-1").frame_effects).toContain("convertdfc");
    expect(imported("ori-60").frame_effects).toContain("originpwdfc");
    for (const key of ["inr-60", "mom-36"]) expect(imported(key).frame_effects ?? []).toEqual([]);
  });

  it.each(CASES)("$label: the front's glyph and the back's, the family the mapper derives", async ({ printing, family, front, back }) => {
    expect(familyOf(printing)).toBe(family);
    const frontPreview = (await payloadOf(printing.id, front)).preview;
    const backPreview = (await payloadOf(printing.id, back, "back")).preview;

    expect(frontPreview.dfc).toMatchObject({ layout: "transform", role: "front", icon: family });
    expect(backPreview.dfc).toMatchObject({ layout: "transform", role: "back", icon: family });
    expect(iconRiderOf(frontPreview)).toBe(GLYPH[family].front);
    expect(iconRiderOf(backPreview)).toBe(RIDER_BODIES.includes(back) ? GLYPH[family].back : null);

    const key = family === "arrows" ? undefined : family;
    expect(frontPreview.frameStyle?.dfcIcon).toBe(key);
    expect(backPreview.frameStyle?.dfcIcon).toBe(key);
    // The back is drawn on the body under test, the family beside it.
    expect(backPreview.frameStyle?.template).toBe(back);
  });

  it("the family is the PRINTING's, not the import patch's: a pin the check accepts on a body the import does not land on names none on its patch", async () => {
    // EMN #63's front on m15dfcfront/u: the import is blocked by the
    // colourless Eldrazi back (5.11), so the mapper names no
    // `printed_dfc_icon` — the reference still prints the full moon.
    const angler = scryfallCardSchema.parse(imported("emn-63"));
    expect(validateReferenceForCombo(angler, "m15dfcfront", "u").errors).toEqual([]);
    expect(mapScryfallToFormPatch(angler, { artPreviewUrl: null })).not.toHaveProperty("printed_dfc_icon");
    expect(iconRiderOf((await payloadOf(angler.id, "m15dfcfront")).preview)).toBe("fullmoon");
    // NEO #227's creature back on m15dfcbackleft/m, under its Saga front
    // (5.5): the same, and the back draws the open fan.
    const war = scryfallCardSchema.parse(kamiWar);
    expect(validateReferenceForCombo(war, "m15dfcbackleft", "m").errors).toEqual([]);
    expect(mapScryfallToFormPatch(war, { artPreviewUrl: null })).not.toHaveProperty("printed_dfc_icon");
    expect(iconRiderOf((await payloadOf(war.id, "m15dfcbackleft", "back")).preview)).toBe("fanopen");
    // A printing that lands (MID #169) names the same family on both.
    const admirer = scryfallCardSchema.parse(imported("mid-169"));
    expect(mapScryfallToFormPatch(admirer, { artPreviewUrl: null }).printed_dfc_icon).toBe("sunmoon");
    expect((await payloadOf(admirer.id, "m15dfcfront")).preview.frameStyle?.dfcIcon).toBe("sunmoon");
  });

  it("ORI #60's walker back (the import drops it, 5.13): the front keeps the plain ▲ — `originpwdfc` names no wave-1 family", async () => {
    const front = (await payloadOf(imported("ori-60").id, "m15dfcfront")).preview;
    expect(front.dfc).toMatchObject({ layout: "transform", role: "front", icon: "arrows" });
    // A walker back prints no P/T: the tab stays empty.
    expect(front.dfc?.otherFace.printsPt).toBe(false);
    expect(front.frameStyle?.dfcIcon).toBeUndefined();
    expect(iconRiderOf(front)).toBe("default");
  });

  it("a family rides on a TRANSFORM body only: the same printings on a plain frame, and on a modal body, name none", async () => {
    for (const key of ["mid-169", "emn-63", "xln-22"]) {
      const { id } = imported(key);
      // A plain frame: the front as it was (no block), the back a legacy back.
      const plain = (await payloadOf(id, "m15")).preview;
      expect(plain.frameStyle, key).not.toHaveProperty("dfcIcon");
      expect(plain, key).not.toHaveProperty("dfc");
      const plainBack = (await payloadOf(id, "m15", "back")).preview;
      expect(plainBack.frameStyle, key).not.toHaveProperty("dfcIcon");
      expect(plainBack.dfc, key).toBeNull();
      // A modal housing has no family, whatever the printing's effects say.
      const modal = (await payloadOf(id, "m15mdfcfront")).preview;
      expect(modal.frameStyle, key).not.toHaveProperty("dfcIcon");
      expect(modal.dfc, key).toMatchObject({ layout: "modal", role: "front", icon: null });
      expect(iconRiderOf(modal), key).toBeNull();
    }
  });

  it("the modal captures carry the strip's facts on the payload and no family", async () => {
    // ZNR #12: a white sorcery // a land whose mana is white.
    const emeria = (await payloadOf(imported("znr-12").id, "m15mdfcfront")).preview;
    expect(emeria.dfc).toEqual({
      layout: "modal",
      role: "front",
      icon: null,
      otherFace: { typeWord: "Land", line: "{T}: Add {W}.", printsPt: false, power: null, toughness: null, stripKey: "w" },
    });
    // STX #147: a green creature // a BLUE sorcery — the strip is the back's.
    const pugilist = (await payloadOf(imported("stx-147").id, "m15mdfcfront")).preview;
    expect(pugilist.dfc).toEqual({
      layout: "modal",
      role: "front",
      icon: null,
      otherFace: { typeWord: "Sorcery", line: "{3}{U}{U}", printsPt: false, power: null, toughness: null, stripKey: "u" },
    });
    for (const preview of [emeria, pugilist]) {
      expect(preview.frameStyle).not.toHaveProperty("dfcIcon");
      expect(iconRiderOf(preview)).toBeNull();
    }
  });
});

describe("the front payload carries the block lib/cards/faces.ts derives — nothing re-derived", () => {
  it.each(rows.filter((row) => dfcBodyOf(row.template)?.role === "front"))(
    "$combo $ref.name: the payload is frontPreviewData of itself",
    async (row) => {
      const { preview } = await payloadOf(row.ref.scryfallId, row.template);
      const { dfc, ...card } = preview;
      expect(dfc, row.combo).toBeDefined();
      // The one derivation: what the live preview (components/cards/
      // card-preview.tsx) and a stored card's bake (rowToPreviewData) run.
      expect(preview).toEqual(frontPreviewData(card));
      // …and running it again changes nothing.
      expect(frontPreviewData(preview)).toEqual(preview);
    },
  );

  it("a transform front names the back's P/T for its grey tab — and prints none for a back without one", async () => {
    // MOM #43: Burnished Dunestomper is a 4/3.
    const duneshaper = (await payloadOf(refOf("m15dfcfront", "w").scryfallId, "m15dfcfront")).preview;
    expect(duneshaper.dfc?.otherFace).toMatchObject({ printsPt: true, power: "4", toughness: "3" });
    // INR #287: the land front's tab prints Ormendahl's 9/7.
    const abbey = (await payloadOf(refOf("m15dfclandfront", "c").scryfallId, "m15dfclandfront")).preview;
    expect(abbey.dfc?.otherFace).toMatchObject({ printsPt: true, power: "9", toughness: "7", typeWord: "Demon" });
    // XLN #22: Adanto is a land — the tab prints empty.
    const landing = (await payloadOf(importPrintings["xln-22"].id, "m15dfcfront")).preview;
    expect(landing.dfc?.otherFace).toMatchObject({ printsPt: false, typeWord: "Land" });
  });

  it("a pathway's front names its back's word, mana line and colour key (the land front's own references)", async () => {
    const ref = refOf("m15mdfclandfront", "w");
    expect(`${ref.set} ${ref.name}`).toBe("znr Brightclimb Pathway");
    const { preview } = await payloadOf(ref.scryfallId, "m15mdfclandfront");
    expect(preview.dfc).toEqual({
      layout: "modal",
      role: "front",
      icon: null,
      otherFace: { typeWord: "Land", line: "{T}: Add {B}.", printsPt: false, power: null, toughness: null, stripKey: "b" },
    });
  });

  it("a printing with no second face on a front body: no block to carry", async () => {
    const serra = refOf("m15", "w");
    const { preview } = await payloadOf(serra.scryfallId, "m15dfcfront");
    expect(preview.backFace).toBeNull();
    expect(preview).not.toHaveProperty("dfc");
  });
});

describe("as it was — generated on the base (d9e877e6), only read since", () => {
  const GRN_EXPANSION: Ref = { name: "Expansion // Explosion", set: "grn", scryfallId: "e0644c92-4d67-475e-8c8e-0e2c493682fb" };
  // The whole payload, byte for byte.
  const WHOLE: Array<[string, () => Ref, FrameTemplate, CardFace]> = [
    ["an arrows reference: INR #60's back on m15dfcback/u", () => refOf("m15dfcback", "u"), "m15dfcback", "back"],
    ["an arrows reference: MOM #43's back on m15dfcback/m", () => refOf("m15dfcback", "m"), "m15dfcback", "back"],
    ["an arrows land back: FIN #31 on m15dfclandback/c", () => refOf("m15dfclandback", "c"), "m15dfclandback", "back"],
    ["a modal reference: STX #147's back on m15mdfcback/u", () => refOf("m15mdfcback", "u"), "m15mdfcback", "back"],
    ["a non-DFC template: Serra Angel on m15/w", () => refOf("m15", "w"), "m15", "front"],
    ["a non-DFC template: NEO #227 (a fan printing) on saga/m", () => refOf("saga", "m"), "saga", "front"],
    ["a non-DFC template: MID #169 (a sun / moon printing) on m15, front", () => refOf("m15dfcfront", "g", 1), "m15", "front"],
    ["a non-DFC template: MID #169 on m15, its legacy back", () => refOf("m15dfcfront", "g", 1), "m15", "back"],
    // Two-part layouts (the skeptic's): ONE picture whose second half is
    // the back-face content — a card WITH a back face on a template that is
    // no double-faced body, the path every front now takes through
    // frontPreviewData.
    // (GRN #224 by its own id: it was split/m's registry reference when the
    // snapshot was generated and left the registry with TODO 4.21b — a
    // hybrid // gold card is 4.26's — while its capture stays in the
    // printings fixture. The payload is the same bytes.)
    ["a non-DFC template: GRN Expansion // Explosion on split/m (a second half, no flip)", () => GRN_EXPANSION, "split", "front"],
    ["a non-DFC template: ELD Faerie Guidemother on adventure/w (the storybook page)", () => refOf("adventure", "w"), "adventure", "front"],
  ];

  it.each(WHOLE)("%s", async (_label, ref, template, face) => {
    expect(await payloadOf(ref().scryfallId, template, face)).toMatchSnapshot();
  });

  // A FRONT body: everything the payload held, byte for byte — its one new
  // key, the block, is pinned above to the derivation the live preview
  // already ran on this very payload (so the compare page draws the same
  // picture; the scorer now bakes it too).
  const FRONTS: Array<[string, () => Ref, FrameTemplate]> = [
    ["an arrows reference: MOM #43's front on m15dfcfront/w", () => refOf("m15dfcfront", "w"), "m15dfcfront"],
    ["an arrows reference: INR #60's front on m15dfcfront/u", () => refOf("m15dfcfront", "u"), "m15dfcfront"],
    ["an arrows land front: INR #287 on m15dfclandfront/c", () => refOf("m15dfclandfront", "c"), "m15dfclandfront"],
    ["a modal reference: STX #147's front on m15mdfcfront/g", () => refOf("m15mdfcfront", "g", 1), "m15mdfcfront"],
    ["a modal land reference: ZNR #259's front on m15mdfclandfront/w", () => refOf("m15mdfclandfront", "w"), "m15mdfclandfront"],
  ];

  it.each(FRONTS)("%s — without its block", async (_label, ref, template) => {
    const payload = await payloadOf(ref().scryfallId, template);
    const { dfc: _block, ...asItWas } = payload.preview;
    void _block;
    expect({ ...payload, preview: asItWas }).toMatchSnapshot();
  });
});
