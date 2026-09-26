import { describe, expect, it } from "vitest";
import {
  blankSecondFaceFor,
  defaultValuesFor,
  isBlankBackFace,
  remixValuesFrom,
} from "@/lib/creator/card-fields";
import { EMPTY_BACK_FACE } from "@/lib/creator/form-types";
import { normalizeCardFinish } from "@/lib/cards/card-display";
import { PLACEHOLDER_RULES_TEXT } from "@/lib/cards/typography";
import type { Card } from "@/types/card";

describe("new-card defaults", () => {
  it("starts as a 1/1 common creature with the default PipGlyph set icon and no text", () => {
    const v = defaultValuesFor(null, []);
    expect(v.card_type).toBe("creature");
    expect(v.rarity).toBe("common");
    expect(v.power).toBe("1");
    expect(v.toughness).toBe("1");
    expect(v.rules_text).toBe("");
    // Empty icon fields = the PipGlyph mark (SetSymbol's default source).
    expect(v.set_icon_url).toBe("");
    expect(v.set_icon_code).toBe("");
  });
  it("uses the plain placeholder in the editor preview", () => {
    expect(PLACEHOLDER_RULES_TEXT).toBe("Add text and rules here.");
  });
});

// TODO 0.25 / migration 0119: the retired "borderless" finish. The edit /
// remix summary (components/creator/locked-summary.tsx) printed
// "Finish: Borderless" from the form values, and a save re-submitted it.
function savedCard(frameStyle: unknown): Card {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Smothering Tithe",
    slug: "smothering-tithe",
    game_system_id: "gs",
    cost: "{3}{W}",
    color_identity: ["white"],
    supertype: null,
    card_type: "enchantment",
    subtypes: [],
    tags: [],
    rarity: "rare",
    rules_text: "Whenever an opponent draws a card, that player may pay {2}.",
    flavor_text: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: null,
    art_position: {},
    frame_style: frameStyle,
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
  } as unknown as Card;
}

describe("a saved card's finish in the creator", () => {
  it("reads a legacy 'borderless' card as Regular for an edit and a remix", () => {
    const legacy = savedCard({ finish: "borderless", template: "tarkirdragon" });
    expect(defaultValuesFor(legacy, []).frame_style).toEqual({
      finish: "regular",
      template: "tarkirdragon",
    });
    expect(remixValuesFrom(legacy, []).frame_style).toEqual({
      finish: "regular",
      template: "tarkirdragon",
    });
  });

  it("keeps every current finish, and defaults a missing one to Regular", () => {
    for (const finish of ["regular", "foil", "etched", "showcase"] as const) {
      expect(defaultValuesFor(savedCard({ finish, template: "m15" }), []).frame_style.finish).toBe(finish);
    }
    expect(defaultValuesFor(savedCard({ template: "m15" }), []).frame_style.finish).toBe("regular");
    expect(defaultValuesFor(savedCard(null), []).frame_style.finish).toBe("regular");
  });

  it("normalizeCardFinish maps retired and unknown values, never a prototype key", () => {
    expect(normalizeCardFinish("borderless")).toBe("regular");
    expect(normalizeCardFinish("etched")).toBe("etched");
    expect(normalizeCardFinish("rainbow")).toBe("regular");
    expect(normalizeCardFinish("constructor")).toBe("regular");
    expect(normalizeCardFinish(undefined)).toBe("regular");
    expect(normalizeCardFinish(7)).toBe("regular");
  });
});

// TODO 3b.8: a split / aftermath card's second half started — and saved —
// as a Creature (EMPTY_BACK_FACE's type). A blank second face now takes the
// kind's own type.
describe("blankSecondFaceFor / isBlankBackFace (3b.8)", () => {
  it("types a blank second face like the kind's own card", () => {
    expect(blankSecondFaceFor("split").card_type).toBe("instant");
    expect(blankSecondFaceFor("aftermath").card_type).toBe("sorcery");
    expect(blankSecondFaceFor("flip").card_type).toBe("creature");
    // Adventure keeps today's default until 3b.14 gives its spell a type.
    expect(blankSecondFaceFor("adventure").card_type).toBe("creature");
    // Kinds without an intrinsic second face keep the plain blank.
    expect(blankSecondFaceFor("instant")).toBe(EMPTY_BACK_FACE);
    expect(blankSecondFaceFor("saga")).toBe(EMPTY_BACK_FACE);
    expect(isBlankBackFace(blankSecondFaceFor("split"))).toBe(true);
  });

  it("a stored split card with no second face loads a blank instant half", () => {
    const card = {
      ...savedCard({ template: "split" }),
      card_type: "instant",
      back_face: null,
    } as unknown as Card;
    const v = defaultValuesFor(card, []);
    expect(v.has_back_face).toBe(false); // the form forces it on for the frame
    expect(v.back_face.card_type).toBe("instant");
    // A stored second face is loaded as-is.
    const withFace = {
      ...card,
      back_face: { title: "Ice", card_type: "sorcery" },
    } as unknown as Card;
    expect(defaultValuesFor(withFace, []).back_face.card_type).toBe("sorcery");
    // A standard frame's missing back face stays the plain blank.
    expect(defaultValuesFor(savedCard({ template: "m15" }), []).back_face).toEqual(
      EMPTY_BACK_FACE,
    );
  });

  it("anything the user wrote makes a face non-blank; its type doesn't", () => {
    expect(isBlankBackFace({ ...EMPTY_BACK_FACE, card_type: "sorcery" })).toBe(true);
    expect(isBlankBackFace({ ...EMPTY_BACK_FACE, rules_text: "Draw a card." })).toBe(false);
    expect(isBlankBackFace({ ...EMPTY_BACK_FACE, art_url: "https://example.com/a.png" })).toBe(false);
  });
});
