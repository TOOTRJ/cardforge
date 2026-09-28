import { describe, expect, it } from "vitest";
import printings from "./fixtures/import-printings.json";
import {
  hasBackFaceImage,
  scryfallCardSchema,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  mapScryfallToFormPatch,
  scryfallFaceArtist,
} from "@/lib/scryfall/import-mapper";
import { previewFromImportPatch } from "@/lib/scryfall/preview-from-patch";

// ---------------------------------------------------------------------------
// TODO 1.8 — back-face art only when the face has its own image, and each
// face's own artist. Real (trimmed) Scryfall payloads, captured 2026-09-26
// and, for their image_uris, 2026-09-28:
//   • Delver of Secrets ISD #51 — a transform DFC: each face has image_uris;
//   • Bonecrusher Giant ELD #115 — an adventure: ONE image, faces without;
//   • Fire // Ice DMR #215 — a split card: one image, each half its own
//     artist (David Martin / Franz Vohwinkel), card-level "David Martin &
//     Franz Vohwinkel".
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printings;
const printing = (key: PrintingKey): ScryfallCard =>
  scryfallCardSchema.parse(printings[key]);

describe("hasBackFaceImage — the named route's has_back_image", () => {
  it("is true for a DFC whose second face has its own image (Delver ISD #51)", () => {
    expect(hasBackFaceImage(printing("isd-51"))).toBe(true);
  });

  it("is false for cards whose faces share one image", () => {
    // An adventure, a split card, an aftermath card, a flip card: their
    // second face is text on the one image — no back-face art to import.
    for (const key of ["eld-115", "dmr-215", "akh-211", "chk-202", "woe-38", "dgm-123"] as const) {
      expect(hasBackFaceImage(printing(key)), key).toBe(false);
    }
  });

  it("is false for a single-faced card", () => {
    expect(hasBackFaceImage(printing("dom-168"))).toBe(false);
  });

  it("ignores an image_uris object with no URL in it", () => {
    const card = scryfallCardSchema.parse({
      id: "x",
      name: "A // B",
      card_faces: [{ name: "A" }, { name: "B", image_uris: {} }],
    });
    expect(hasBackFaceImage(card)).toBe(false);
  });
});

describe("per-face artist (TODO 1.8)", () => {
  it("credits each half of Fire // Ice (DMR #215) to its own artist", () => {
    const fireIce = printing("dmr-215");
    expect(fireIce.artist).toBe("David Martin & Franz Vohwinkel");
    const patch = mapScryfallToFormPatch(fireIce);
    expect(patch.artist_credit).toBe("David Martin");
    expect(patch.back_face?.artist_credit).toBe("Franz Vohwinkel");
    expect(scryfallFaceArtist(fireIce, 0)).toBe("David Martin");
    expect(scryfallFaceArtist(fireIce, 1)).toBe("Franz Vohwinkel");
  });

  it("keeps one artist where both faces share one (Delver, Bonecrusher)", () => {
    const delver = mapScryfallToFormPatch(printing("isd-51"));
    expect(delver.artist_credit).toBe("Nils Hamm");
    expect(delver.back_face?.artist_credit).toBe("Nils Hamm");
    const giant = mapScryfallToFormPatch(printing("eld-115"));
    expect(giant.artist_credit).toBe("Victor Adame Minguez");
    expect(giant.back_face?.artist_credit).toBe("Victor Adame Minguez");
  });

  it("falls back to the card-level artist when a face has none", () => {
    const card = scryfallCardSchema.parse({
      id: "x",
      name: "A // B",
      artist: "Both Artists",
      card_faces: [{ name: "A", artist: "Front Artist" }, { name: "B" }],
    });
    expect(scryfallFaceArtist(card, 0)).toBe("Front Artist");
    expect(scryfallFaceArtist(card, 1)).toBe("Both Artists");
  });

  it("a single-faced card has its card-level artist and no second face's", () => {
    const elves = printing("dom-168");
    expect(scryfallFaceArtist(elves, 0)).toBe(elves.artist);
    expect(scryfallFaceArtist(elves, 1)).toBeUndefined();
    expect(mapScryfallToFormPatch(elves).artist_credit).toBe(elves.artist);
  });

  it("the admin frame-compare render (previewFromImportPatch) picks up each face's artist", () => {
    const fireIce = printing("dmr-215");
    const preview = previewFromImportPatch(mapScryfallToFormPatch(fireIce), fireIce.name, "split");
    expect(preview.artistCredit).toBe("David Martin");
    expect(preview.backFace?.artist_credit).toBe("Franz Vohwinkel");
  });
});
