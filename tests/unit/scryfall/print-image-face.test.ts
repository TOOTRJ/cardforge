import { describe, expect, it } from "vitest";
import { hasBackFaceImage, pickPrintImageUrl, type ScryfallCard } from "@/lib/scryfall/client";
import { archangelAvacyn, beanstalkGiant, serraAngel } from "./fixtures/dfc-printings";

// ---------------------------------------------------------------------------
// pickPrintImageUrl per face (TODO 5.0b): face 0 is what it always was (the
// top-level image, else the first face's); face 1 is the SECOND face's own
// scan and nothing else — a printing with no second face, or one whose
// faces carry no images (split, adventure: one picture), answers null, so a
// back-face comparison can never fall back to the front's scan.
// ---------------------------------------------------------------------------

const png = (id: string, face: "front" | "back") => `https://cards.scryfall.io/png/${face}/${id[0]}/${id[1]}/${id}.png`;

describe("pickPrintImageUrl", () => {
  it("face 0 is the front: the top-level image, else the first face's — as before", () => {
    expect(pickPrintImageUrl(serraAngel)).toBe(png(serraAngel.id, "front"));
    expect(pickPrintImageUrl(serraAngel, 0)).toBe(png(serraAngel.id, "front"));
    expect(pickPrintImageUrl(archangelAvacyn)).toBe(png(archangelAvacyn.id, "front"));
    expect(pickPrintImageUrl(beanstalkGiant)).toBe(png(beanstalkGiant.id, "front"));
    // The top level wins over the faces, as it always did.
    const both = {
      ...archangelAvacyn,
      image_uris: { png: "https://cards.scryfall.io/png/front/t/o/top.png" },
    } as ScryfallCard;
    expect(pickPrintImageUrl(both)).toBe("https://cards.scryfall.io/png/front/t/o/top.png");
    expect(pickPrintImageUrl(both, 0)).toBe("https://cards.scryfall.io/png/front/t/o/top.png");
  });

  it("face 1 is the second face's own scan", () => {
    expect(pickPrintImageUrl(archangelAvacyn, 1)).toBe(png(archangelAvacyn.id, "back"));
    expect(hasBackFaceImage(archangelAvacyn)).toBe(true);
  });

  it("face 1 never falls back to the top level or the front", () => {
    // One face: no second face at all.
    expect(pickPrintImageUrl(serraAngel, 1)).toBeNull();
    // Two faces of text on one picture: the faces carry no images.
    expect(pickPrintImageUrl(beanstalkGiant, 1)).toBeNull();
    expect(hasBackFaceImage(beanstalkGiant)).toBe(false);
    // A top-level image beside faces with none is still the front's only.
    const topOnly = {
      ...archangelAvacyn,
      image_uris: { png: "https://cards.scryfall.io/png/front/t/o/top.png" },
      card_faces: archangelAvacyn.card_faces!.map((face) => ({ ...face, image_uris: null })),
    } as ScryfallCard;
    expect(pickPrintImageUrl(topOnly, 1)).toBeNull();
    expect(pickPrintImageUrl(topOnly, 0)).toBe("https://cards.scryfall.io/png/front/t/o/top.png");
  });

  it("prefers png, then large, normal, border_crop on either face", () => {
    const back = {
      ...archangelAvacyn,
      card_faces: [
        archangelAvacyn.card_faces![0],
        { ...archangelAvacyn.card_faces![1], image_uris: { large: "L", normal: "N", border_crop: "B" } },
      ],
    } as ScryfallCard;
    expect(pickPrintImageUrl(back, 1)).toBe("L");
    const normalOnly = {
      ...back,
      card_faces: [back.card_faces![0], { ...back.card_faces![1], image_uris: { normal: "N", border_crop: "B" } }],
    } as ScryfallCard;
    expect(pickPrintImageUrl(normalOnly, 1)).toBe("N");
  });
});
