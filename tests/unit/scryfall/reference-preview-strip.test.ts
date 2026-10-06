import { describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { AGADEEM_ID, ARCHANGEL_AVACYN_ID, DFC_PRINTINGS, SERRA_ANGEL_ID, VALKI_ID } from "./fixtures/dfc-printings";

// ---------------------------------------------------------------------------
// TODO 5.1c on the admin compare page (buildFrameComparePayload, the REAL
// profiles): the modal strip takes the colour of the frame the OTHER face
// wears, so the compared card must know its back's colour. Viewed from the
// FRONT, the back used to carry content alone (backFaceFromPatch) — a back
// with no colour follows the front's, so every two-colour reference (the
// five pathways that ARE the land front's references, STX's cards, KHM
// #114) drew its own colour's tab beside a scan that prints the back's. On a
// MODAL front body under test the back now carries its printed colour and
// the body its type derives, as the import stores it; a walker back (kept
// off the bodies, 5.13) the colour alone; a transform front (which draws
// nothing from its back's colour) and every other template nothing.
// ---------------------------------------------------------------------------

const PNG = (id: string, face: "front" | "back") => `https://cards.scryfall.io/png/${face}/${id[0]}/${id[1]}/${id}.png`;
const images = (id: string, face: "front" | "back") => ({ png: PNG(id, face), normal: PNG(id, face), art_crop: PNG(id, face) });

/** ZNR #259's shape: a white land front, a BLACK land back (a pathway —
 *  each face coloured by its own mana ability). */
const PATHWAY_ID = "a9a9a9a9-0009-4009-8009-000000000009";
const pathway = {
  id: PATHWAY_ID,
  name: "Brightclimb Pathway // Grimclimb Pathway",
  layout: "modal_dfc",
  set: "znr",
  collector_number: "259",
  rarity: "rare",
  frame: "2015",
  color_identity: ["B", "W"],
  image_status: "highres_scan",
  card_faces: [
    { name: "Brightclimb Pathway", mana_cost: "", type_line: "Land", oracle_text: "{T}: Add {W}.", colors: [], artist: "Test", image_uris: images(PATHWAY_ID, "front") },
    { name: "Grimclimb Pathway", mana_cost: "", type_line: "Land", oracle_text: "{T}: Add {B}.", colors: [], artist: "Test", image_uris: images(PATHWAY_ID, "back") },
  ],
} as unknown as ScryfallCard;

/** STX #147's shape: a green creature front, a BLUE sorcery back. */
const PUGILIST_ID = "b0b0b0b0-0010-4010-8010-000000000010";
const pugilist = {
  id: PUGILIST_ID,
  name: "Augmenter Pugilist // Echoing Equation",
  layout: "modal_dfc",
  set: "stx",
  collector_number: "147",
  rarity: "rare",
  frame: "2015",
  color_identity: ["G", "U"],
  image_status: "highres_scan",
  card_faces: [
    { name: "Augmenter Pugilist", mana_cost: "{1}{G}{G}", type_line: "Creature — Troll Druid", oracle_text: "Trample", colors: ["G"], power: "3", toughness: "3", artist: "Test", image_uris: images(PUGILIST_ID, "front") },
    { name: "Echoing Equation", mana_cost: "{3}{U}{U}", type_line: "Sorcery", oracle_text: "Choose target creature you control.", colors: ["U"], artist: "Test", image_uris: images(PUGILIST_ID, "back") },
  ],
} as unknown as ScryfallCard;

/** STX #149's shape: a W/B front, a B/R sorcery back (two colours each). */
const EXTUS_ID = "c1c1c1c1-0011-4011-8011-000000000011";
const extus = {
  id: EXTUS_ID,
  name: "Extus, Oriq Overlord // Awaken the Blood Avatar",
  layout: "modal_dfc",
  set: "stx",
  collector_number: "149",
  rarity: "mythic",
  frame: "2015",
  color_identity: ["B", "R", "W"],
  image_status: "highres_scan",
  card_faces: [
    { name: "Extus, Oriq Overlord", mana_cost: "{1}{W}{B}{B}", type_line: "Legendary Creature — Human Warlock", oracle_text: "Double strike", colors: ["B", "W"], power: "2", toughness: "4", artist: "Test", image_uris: images(EXTUS_ID, "front") },
    { name: "Awaken the Blood Avatar", mana_cost: "{6}{B}{R}", type_line: "Sorcery", oracle_text: "Each opponent sacrifices a creature.", colors: ["B", "R"], artist: "Test", image_uris: images(EXTUS_ID, "back") },
  ],
} as unknown as ScryfallCard;

vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  const { DFC_PRINTINGS: fixtures } = await import("./fixtures/dfc-printings");
  return {
    ...actual,
    getCardById: async (id: string) => ({ ...(fixtures as Record<string, ScryfallCard>), [PATHWAY_ID]: pathway, [PUGILIST_ID]: pugilist, [EXTUS_ID]: extus })[id] ?? null,
  };
});

import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { frontPreviewData } from "@/lib/cards/faces";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import type { CardPreviewData } from "@/components/cards/card-preview";

/** The strip rider a face draws, as both renderers resolve it (CardPreview
 *  and the bake derive a FRONT's block through frontPreviewData; a back
 *  payload is backPreviewData already). */
function riderOf(preview: CardPreviewData, face: "front" | "back"): string | null {
  const data = face === "front" ? frontPreviewData(preview) : preview;
  const profile = getFrameProfile(data.frameStyle?.template as never);
  const rider = resolveFrameOverlays(profile, data.frameStyle, {
    colors: data.colorIdentity,
    cost: data.cost,
    cardType: data.cardType,
    supertype: data.supertype,
    rarity: data.rarity,
    dfc: data.dfc ? { role: data.dfc.role, icon: data.dfc.icon, stripKey: data.dfc.otherFace.stripKey } : null,
    colorKey: pickFrameColorKey(data.colorIdentity),
  }).find((o) => o.anatomy === "mdfcStrip");
  return rider ? rider.path : null;
}

describe("the compare page's FRONT view of a modal reference (TODO 5.1c)", () => {
  it("the fixtures: every printing the cases use is served", () => {
    expect(Object.keys(DFC_PRINTINGS)).toEqual(expect.arrayContaining([VALKI_ID, AGADEEM_ID, SERRA_ANGEL_ID, ARCHANGEL_AVACYN_ID]));
  });

  it("a pathway's front (the land front's own references): the back on the land back body in ITS mana's colour — the front wears the back's tab, as the scan does", async () => {
    const payload = await buildFrameComparePayload(PATHWAY_ID, "m15mdfclandfront");
    if (!payload) throw new Error("no payload");
    expect(payload.preview.colorIdentity).toEqual(["white"]);
    expect(payload.preview.backFace).toMatchObject({ title: "Grimclimb Pathway", card_type: "land", frame_style: { template: "m15mdfclandback" }, color_identity: ["black"] });
    expect(frontPreviewData(payload.preview).dfc?.otherFace).toMatchObject({ typeWord: "Land", line: "{T}: Add {B}.", stripKey: "b" });
    expect(riderOf(payload.preview, "front")).toBe("/frames/m15mdfclandfront/strip/b.png");
    // …and its back, on the land back body: the FRONT's tab (white).
    const back = await buildFrameComparePayload(PATHWAY_ID, "m15mdfclandback", "back");
    expect(back?.preview.colorIdentity).toEqual(["black"]);
    expect(riderOf(back!.preview, "back")).toBe("/frames/m15mdfclandback/strip/w.png");
  });

  it("STX #147's shape: the green front wears the BLUE tab for its sorcery back (on the spell back body), the blue back the green one", async () => {
    const payload = await buildFrameComparePayload(PUGILIST_ID, "m15mdfcfront");
    expect(payload?.preview.backFace).toMatchObject({ card_type: "sorcery", frame_style: { template: "m15mdfcback" }, color_identity: ["blue"] });
    expect(riderOf(payload!.preview, "front")).toBe("/frames/m15mdfcfront/strip/u.png");
    const back = await buildFrameComparePayload(PUGILIST_ID, "m15mdfcback", "back");
    expect(riderOf(back!.preview, "back")).toBe("/frames/m15mdfcback/strip/g.png");
  });

  it("STX #149's shape: a two-colour back is GOLD on the front (the front, drawn gold without the compare tool's switch, already paints it: no piece); the back's own strip is gold for the two-colour front", async () => {
    const payload = await buildFrameComparePayload(EXTUS_ID, "m15mdfcfront");
    expect(payload?.preview.colorIdentity).toEqual(["black", "white"]);
    expect(payload?.preview.backFace).toMatchObject({ frame_style: { template: "m15mdfcback" }, color_identity: ["black", "red"] });
    expect(frontPreviewData(payload!.preview).dfc?.otherFace.stripKey).toBe("m");
    expect(riderOf(payload!.preview, "front")).toBeNull();
    const back = await buildFrameComparePayload(EXTUS_ID, "m15mdfcback", "back");
    expect(back?.preview.dfc?.otherFace.stripKey).toBe("m");
    expect(riderOf(back!.preview, "back")).toBeNull();
  });

  it("a mono-colour reference draws none (ZNR #90: a black front, a land back whose mana is black) — the look the ticks were made on", async () => {
    const payload = await buildFrameComparePayload(AGADEEM_ID, "m15mdfcfront");
    expect(payload?.preview.backFace).toMatchObject({ card_type: "land", frame_style: { template: "m15mdfclandback" }, color_identity: ["black"] });
    expect(frontPreviewData(payload!.preview).dfc?.otherFace.stripKey).toBe("b");
    expect(riderOf(payload!.preview, "front")).toBeNull();
    const back = await buildFrameComparePayload(AGADEEM_ID, "m15mdfclandback", "back");
    expect(riderOf(back!.preview, "back")).toBeNull();
  });

  it("KHM #114: the walker back stays a LEGACY back (no body — the import keeps it off the bodies) but names its colour, so Valki's front wears the gold tab the scan prints", async () => {
    const payload = await buildFrameComparePayload(VALKI_ID, "m15mdfcfront");
    const back = payload!.preview.backFace!;
    expect(back.card_type).toBe("planeswalker");
    expect(back.frame_style).toBeUndefined();
    expect(back.color_identity).toEqual(["black", "red"]);
    expect(frontPreviewData(payload!.preview).dfc?.otherFace).toMatchObject({ typeWord: "Tibalt", stripKey: "m" });
    expect(riderOf(payload!.preview, "front")).toBe("/frames/m15mdfcfront/strip/m.png");
  });

  it("a TRANSFORM front is untouched (it draws nothing from its back's colour): the back stays content alone, and no strip rider exists there", async () => {
    const payload = await buildFrameComparePayload(ARCHANGEL_AVACYN_ID, "m15dfcfront");
    expect(payload?.preview.backFace).toMatchObject({ title: "Avacyn, the Purifier" });
    expect(payload?.preview.backFace?.frame_style).toBeUndefined();
    expect(payload?.preview.backFace?.color_identity).toBeUndefined();
    // The block is still derived (the tab's digits, the icon rider) — from content alone.
    expect(frontPreviewData(payload!.preview).dfc).toMatchObject({ layout: "transform", role: "front" });
    expect(riderOf(payload!.preview, "front")).toBeNull();
  });

  it("any other template is untouched: a DFC printing on a plain frame keeps its content-only (legacy) back, a single-faced card has none", async () => {
    const plain = await buildFrameComparePayload(PUGILIST_ID, "m15");
    expect(plain?.preview.backFace).toMatchObject({ title: "Echoing Equation" });
    expect(plain?.preview.backFace?.frame_style).toBeUndefined();
    expect(plain?.preview.backFace?.color_identity).toBeUndefined();
    expect(frontPreviewData(plain!.preview).dfc).toBeUndefined();
    const single = await buildFrameComparePayload(SERRA_ANGEL_ID, "m15mdfcfront");
    expect(single?.preview.backFace).toBeNull();
    expect(riderOf(single!.preview, "front")).toBeNull();
  });
});
