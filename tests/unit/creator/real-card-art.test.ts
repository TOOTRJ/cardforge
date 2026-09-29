import { describe, expect, it, vi } from "vitest";
import {
  applyRealCardArt,
  CENTERED_ART_POSITION,
  defaultRealCardArtMode,
  realCardArtModes,
  realCardArtOrigin,
  realCardArtWrites,
  realCardFaceNames,
} from "@/lib/creator/real-card-art";

// ---------------------------------------------------------------------------
// TODO 1.15's contract: "Use art from a real card" writes the target face's
// art_url, a re-centred art_position and its artist_credit — and nothing
// else (the full import is the one that overwrites text, frame and colour).
// ---------------------------------------------------------------------------

const URL = "https://project.supabase.co/storage/v1/object/public/card-art/u/x.jpg";

describe("realCardArtWrites", () => {
  it("front: art_url, a centred art_position and the artist credit", () => {
    expect(realCardArtWrites("front", { publicUrl: URL, artist: "Rebecca Guay" })).toEqual([
      ["art_url", URL],
      ["art_position", { focalX: 0.5, focalY: 0.5, scale: 1 }],
      ["artist_credit", "Rebecca Guay"],
    ]);
  });

  it("back: the same three fields on back_face", () => {
    expect(
      realCardArtWrites("back", { publicUrl: URL, artist: "Nils Hamm" }).map(([name]) => name),
    ).toEqual(["back_face.art_url", "back_face.art_position", "back_face.artist_credit"]);
  });

  it("never names another field", () => {
    const allowed = new Set([
      "art_url",
      "art_position",
      "artist_credit",
      "back_face.art_url",
      "back_face.art_position",
      "back_face.artist_credit",
    ]);
    for (const target of ["front", "back"] as const) {
      for (const [name] of realCardArtWrites(target, { publicUrl: URL, artist: null })) {
        expect(allowed.has(name)).toBe(true);
      }
    }
  });

  it("a printing Scryfall credits no one clears the old credit (the new art isn't theirs)", () => {
    expect(realCardArtWrites("front", { publicUrl: URL, artist: null })[2]).toEqual([
      "artist_credit",
      "",
    ]);
    expect(realCardArtWrites("front", { publicUrl: URL, artist: "   " })[2]![1]).toBe("");
  });

  it("the credit is trimmed and held to the field's 120 characters", () => {
    const long = `  ${"A".repeat(130)}  `;
    expect(realCardArtWrites("front", { publicUrl: URL, artist: long })[2]![1]).toBe(
      "A".repeat(120),
    );
  });

  it("each write gets its own position object (the constant stays frozen)", () => {
    const [, first] = realCardArtWrites("front", { publicUrl: URL, artist: null });
    const [, second] = realCardArtWrites("front", { publicUrl: URL, artist: null });
    expect(first![1]).not.toBe(second![1]);
    expect(Object.isFrozen(CENTERED_ART_POSITION)).toBe(true);
  });
});

describe("applyRealCardArt", () => {
  it("front: exactly the three front art writes, each dirty", () => {
    const setValue = vi.fn();
    applyRealCardArt(setValue, "front", { publicUrl: URL, artist: "Rebecca Guay" });
    expect(setValue.mock.calls).toEqual([
      ["art_url", URL, { shouldDirty: true }],
      ["art_position", { focalX: 0.5, focalY: 0.5, scale: 1 }, { shouldDirty: true }],
      ["artist_credit", "Rebecca Guay", { shouldDirty: true }],
    ]);
  });

  it("writes each field dirty, like a user edit", () => {
    const setValue = vi.fn();
    applyRealCardArt(setValue, "back", { publicUrl: URL, artist: "Nils Hamm" });
    expect(setValue.mock.calls).toEqual([
      ["back_face.art_url", URL, { shouldDirty: true }],
      ["back_face.art_position", { focalX: 0.5, focalY: 0.5, scale: 1 }, { shouldDirty: true }],
      ["back_face.artist_credit", "Nils Hamm", { shouldDirty: true }],
    ]);
  });
});

describe("modes", () => {
  it("the back art only for a printing whose back face has its own image", () => {
    expect(realCardArtModes({ has_back_image: false })).toEqual(["art"]);
    expect(realCardArtModes({ has_back_image: true })).toEqual(["art", "art-back"]);
  });

  it("starts on the back art only for the back face of a two-image printing", () => {
    expect(defaultRealCardArtMode("front", { has_back_image: true })).toBe("art");
    expect(defaultRealCardArtMode("back", { has_back_image: true })).toBe("art-back");
    expect(defaultRealCardArtMode("back", { has_back_image: false })).toBe("art");
  });
});

describe("realCardFaceNames", () => {
  it("splits a two-faced name; a one-faced name has no back", () => {
    expect(realCardFaceNames("Delver of Secrets // Insectile Aberration")).toEqual({
      front: "Delver of Secrets",
      back: "Insectile Aberration",
    });
    expect(realCardFaceNames("Llanowar Elves")).toEqual({ front: "Llanowar Elves", back: null });
  });
});

describe("realCardArtOrigin", () => {
  it("remembers the printing's border and full-art / textless flags for the Art step's note", () => {
    expect(
      realCardArtOrigin({ border_color: "borderless", full_art: true, textless: false }, URL),
    ).toEqual({ artUrl: URL, borderless: true, fullArt: true, textless: false });
    expect(
      realCardArtOrigin({ border_color: "black", full_art: false, textless: true }, URL),
    ).toEqual({ artUrl: URL, borderless: false, fullArt: false, textless: true });
  });
});
