import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  AANG_ID,
  AGADEEM_ID,
  ARCHANGEL_AVACYN_ID,
  BEANSTALK_ID,
  SERRA_ANGEL_ID,
  TERGRID_ID,
  VALKI_ID,
} from "./fixtures/dfc-printings";

// ---------------------------------------------------------------------------
// buildFrameComparePayload per FACE (TODO 5.0b) on the REAL profiles, where
// no template is a DFC body: `face: "back"` renders the printing's second
// face as the preview draws a LEGACY back today — the back's content on the
// template under test with the FRONT's colour, no watermark, no collector
// line, nothing to flip to — against the back's OWN scan (Scryfall's
// `/back/` path), never the front's. The fixtures are the Scryfall shapes of
// the printings production's imported double-faced cards came from (the
// nine `back_face` rows: tests/unit/cards/fixtures/dfc-legacy-backs.json),
// on the templates those rows sit on (m15devoid, m15, m15borderless). The
// front path (`face` omitted) is pinned byte for byte in
// reference-preview-front-snapshot.test.ts.
// ---------------------------------------------------------------------------

const lookup = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  const { DFC_PRINTINGS } = await import("./fixtures/dfc-printings");
  return {
    ...actual,
    getCardById: async (id: string) => {
      lookup.ids.push(id);
      return (DFC_PRINTINGS as Record<string, ScryfallCard>)[id] ?? null;
    },
  };
});

import { FrameCompareFaceError, buildFrameComparePayload } from "@/lib/scryfall/reference-preview";

/** What the live preview draws for a legacy back today (the same shape
 *  tests/unit/cards/faces.test.ts holds lib/cards/faces.ts to): the back's
 *  content on the front's template, colour, rarity, finish and switches. */
function todaysLegacyBack(front: CardPreviewData): CardPreviewData {
  const back = front.backFace!;
  return {
    ...front,
    title: back.title ?? null,
    cost: back.cost ?? null,
    cardType: back.card_type ?? null,
    supertype: back.supertype ?? null,
    subtypes: back.subtypes ?? [],
    rulesText: back.rules_text ?? null,
    flavorText: back.flavor_text ?? null,
    power: back.power ?? null,
    toughness: back.toughness ?? null,
    loyalty: back.loyalty ?? null,
    defense: back.defense ?? null,
    artistCredit: back.artist_credit ?? null,
    artUrl: back.art_url ?? null,
    artPosition: back.art_position ?? {},
    faceContent: null,
    watermark: null,
    setCode: null,
    collectorNumber: null,
    lang: null,
    backFace: null,
    backCard: null,
    dfc: null,
  };
}

const BACK_PNG = (id: string) => `https://cards.scryfall.io/png/back/${id[0]}/${id[1]}/${id}.png`;
const FRONT_PNG = (id: string) => `https://cards.scryfall.io/png/front/${id[0]}/${id[1]}/${id}.png`;

beforeEach(() => {
  lookup.ids = [];
});

describe("the production shapes: a legacy back on a non-DFC front, as the preview draws it today", () => {
  it.each([
    // The nine rows' sources on their templates (dfc-legacy-backs.json).
    ["Titânia (m15devoid // Avacyn, the Purifier)", ARCHANGEL_AVACYN_ID, "m15devoid", "Avacyn, the Purifier", ["white"]],
    ["Erza Scarlet (m15 // Avacyn, the Purifier)", ARCHANGEL_AVACYN_ID, "m15", "Avacyn, the Purifier", ["white"]],
    ["Darth Vader (m15 // Tergrid's Lantern)", TERGRID_ID, "m15", "Tergrid's Lantern", ["black"]],
    ["Sung Jin-Woo (m15borderless // Tergrid's Lantern)", TERGRID_ID, "m15borderless", "Tergrid's Lantern", ["black"]],
    ["Chrollo (m15 // Tibalt, Cosmic Impostor)", VALKI_ID, "m15", "Tibalt, Cosmic Impostor", ["black"]],
    ["ARISE! (m15borderless // Agadeem, the Undercrypt)", AGADEEM_ID, "m15borderless", "Agadeem, the Undercrypt", ["black"]],
    ["Avatar Aang (m15 // Aang, Master of Elements)", AANG_ID, "m15", "Aang, Master of Elements", ["multicolor"]],
  ] as const)("%s", async (_label, id, template, backTitle, frontColour) => {
    const front = await buildFrameComparePayload(id, template);
    const back = await buildFrameComparePayload(id, template, "back");
    if (!front || !back) throw new Error("no payload");

    // The back's content on the template under test, in the FRONT's
    // colour — exactly what the card page flips to today.
    expect(back.preview).toEqual(todaysLegacyBack(front.preview));
    expect(back.preview.title).toBe(backTitle);
    expect(back.preview.frameStyle).toEqual({ template });
    expect(back.preview.colorIdentity).toEqual(frontColour);
    expect(back.preview.backFace).toBeNull();
    expect(back.preview.dfc).toBeNull();
    // No rehosted art on either face: the scan shows it.
    expect(back.preview.artUrl).toBeNull();

    // The BACK's own scan, never the front's.
    expect(back.scanUrl).toBe(BACK_PNG(id));
    expect(front.scanUrl).toBe(FRONT_PNG(id));
    expect(back.scanUrl).not.toBe(front.scanUrl);

    expect(back.face).toBe("back");
    expect(back.faceName).toBe(backTitle);
    expect(back.hasBackScan).toBe(true);
    // The same seed for the walk-through: the whole printing, both faces.
    expect(back.patch).toEqual(front.patch);
    expect(back.cardName).toBe(front.cardName);
  });

  it("a legacy back's stats are its own: a planeswalker back carries its loyalty, a land back no P/T", async () => {
    const tibalt = await buildFrameComparePayload(VALKI_ID, "m15", "back");
    expect(tibalt?.preview).toMatchObject({ cardType: "planeswalker", loyalty: "5", cost: "{5}{B}{R}", power: null });
    const agadeem = await buildFrameComparePayload(AGADEEM_ID, "m15borderless", "back");
    expect(agadeem?.preview).toMatchObject({ cardType: "land", power: null, toughness: null, loyalty: null });
    expect(agadeem?.preview.rulesText).toContain("{T}: Add {B}.");
    const avacyn = await buildFrameComparePayload(ARCHANGEL_AVACYN_ID, "m15devoid", "back");
    expect(avacyn?.preview).toMatchObject({ power: "6", toughness: "5", supertype: "Legendary" });
  });
});

describe("the front path says what it has", () => {
  it("names the front face of a two-faced printing and that a back scan exists", async () => {
    const payload = await buildFrameComparePayload(ARCHANGEL_AVACYN_ID, "m15");
    expect(payload).toMatchObject({ face: "front", faceName: "Archangel Avacyn", hasBackScan: true });
    expect(payload?.preview.backFace?.title).toBe("Avacyn, the Purifier");
  });

  it("a single-faced printing has no face name and no back scan", async () => {
    const payload = await buildFrameComparePayload(SERRA_ANGEL_ID, "m15");
    expect(payload).toMatchObject({ face: "front", faceName: null, hasBackScan: false });
  });

  it("an adventure is one picture: a back face, no back scan", async () => {
    const payload = await buildFrameComparePayload(BEANSTALK_ID, "adventure");
    expect(payload).toMatchObject({ face: "front", faceName: "Beanstalk Giant", hasBackScan: false });
    expect(payload?.preview.backFace?.title).toBe("Fertile Footsteps");
  });
});

describe("a face the printing can't show is a named refusal, never the front's scan", () => {
  it("a single-faced printing has no second face", async () => {
    await expect(buildFrameComparePayload(SERRA_ANGEL_ID, "m15", "back")).rejects.toThrow(FrameCompareFaceError);
    await expect(buildFrameComparePayload(SERRA_ANGEL_ID, "m15", "back")).rejects.toThrow(
      "Serra Angel has no second face to compare.",
    );
  });

  it("an adventure's second face has no scan of its own (one picture)", async () => {
    await expect(buildFrameComparePayload(BEANSTALK_ID, "adventure", "back")).rejects.toThrow(
      "Beanstalk Giant // Fertile Footsteps is one picture: its second face has no scan of its own.",
    );
  });

  it("no such printing is still null, for either face", async () => {
    expect(await buildFrameComparePayload("00000000-0000-4000-8000-000000000000", "m15", "back")).toBeNull();
    expect(await buildFrameComparePayload("00000000-0000-4000-8000-000000000000", "m15")).toBeNull();
    expect(lookup.ids).toHaveLength(2);
  });
});
