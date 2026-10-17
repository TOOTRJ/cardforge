// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { CARD_KIND_VALUES, KIND_DEFS, dfcLayoutForKind } from "@/lib/creator/card-kinds";
import { blankSecondFaceFor, isBlankBackFace } from "@/lib/creator/card-fields";
import { EMPTY_BACK_FACE, type BackFaceFormValues } from "@/lib/creator/form-types";
import {
  LEGACY_SECOND_PART_WORDS,
  SECOND_PART_WORDS,
  secondPartFieldName,
  secondPartWordsFor,
  secondPartWordsOfCard,
} from "@/lib/creator/second-part";
import { describeSecondPartLoss, secondPartContents } from "@/lib/creator/second-part-loss";
import { listPhrase, saveNeedsOf, saveNeedsSentence } from "@/lib/creator/save-needs";
import { findFieldElement, revealAndFocusField } from "@/lib/creator/focus-field";
import { cardGlyphFields, cardSymbolFields } from "@/lib/validation/card-glyphs";

// TODO 5.14 (quick fixes, 2026-10-12): the ONE table of the words for a
// card's two parts, the rule the Save line and the Save button share, what a
// kind change would remove, and the focus helper behind the links.

describe("the second-part words, per kind", () => {
  it("every kind with a second part has its own noun; Face tabs' switch labels come from the same row", () => {
    expect(
      Object.fromEntries(
        Object.entries(SECOND_PART_WORDS).map(([kind, w]) => [kind, [w.first, w.second, w.phrase]]),
      ),
    ).toEqual({
      transform: ["Front face", "Back face", "the back face"],
      mdfc: ["Front face", "Back face", "the back face"],
      adventure: ["Creature", "Adventure spell", "the adventure spell"],
      split: ["Left half", "Right half", "the right half"],
      aftermath: ["Top half", "Aftermath half", "the aftermath half"],
      flip: ["Top side", "Flipped side", "the flipped side"],
      battle: ["Battle", "Back face", "the back face"],
      // A double-faced saga's back (TODO 5.5 (b)).
      saga: ["Saga", "Back face", "the back face"],
    });
  });

  it("covers exactly the kinds whose frame carries a second part — plus the battle, whose back is optional (TODO 5.5), and the saga, whose double-faced front has one (5.5 (b))", () => {
    const withPart = CARD_KIND_VALUES.filter(
      (kind) => KIND_DEFS[kind].inlineSecondFace || dfcLayoutForKind(kind) !== null,
    );
    expect(Object.keys(SECOND_PART_WORDS).sort()).toEqual([...withPart, "battle", "saga"].sort());
    for (const kind of CARD_KIND_VALUES) {
      expect(secondPartWordsFor(kind) !== null, kind).toBe(kind === "battle" || kind === "saga" || withPart.includes(kind));
    }
    // Every kind's back is built since TODO 5.5: a battle whose back can't
    // be a face of its own is greyed by the form (lib/creator/battle-back.ts).
    expect(SECOND_PART_WORDS.battle).toMatchObject({ available: true, unavailableNote: null, blankCardType: "creature" });
    for (const words of Object.values(SECOND_PART_WORDS)) expect(words!.available).toBe(true);
    for (const kind of withPart) expect(SECOND_PART_WORDS[kind]!.available, kind).toBe(true);
  });

  it("no kind lends its example name or rules to another", () => {
    const rows = Object.entries(SECOND_PART_WORDS).filter(([, w]) => w.available);
    expect(new Set(rows.map(([, w]) => w.namePlaceholder)).size).toBe(rows.length);
    expect(new Set(rows.map(([, w]) => w.rulesPlaceholder)).size).toBe(rows.length);
    for (const [kind, w] of rows) {
      expect(w.namePlaceholder, kind).not.toBe("");
      if (kind !== "transform") expect(w.namePlaceholder, kind).not.toBe("Insectile Aberration");
    }
  });

  it("an adventure's blank spell is an instant; every other blank keeps the kind's own type", () => {
    expect(blankSecondFaceFor("adventure").card_type).toBe("instant");
    for (const kind of ["split", "aftermath", "flip", "transform", "mdfc"] as const) {
      expect(SECOND_PART_WORDS[kind]!.blankCardType, kind).toBeNull();
      expect(blankSecondFaceFor(kind).card_type, kind).toBe(KIND_DEFS[kind].cardType);
    }
  });

  it("a form's words follow its frame; a back kept on a one-part frame is a “Back face”, a battle's its own (TODO 5.5)", () => {
    expect(secondPartWordsOfCard("instant", "split").second).toBe("Right half");
    expect(secondPartWordsOfCard("creature", "adventure").second).toBe("Adventure spell");
    expect(secondPartWordsOfCard("creature", "m15dfcfront").second).toBe("Back face");
    expect(secondPartWordsOfCard("creature", "m15")).toBe(LEGACY_SECOND_PART_WORDS);
    expect(secondPartWordsOfCard("battle", "battle")).toBe(SECOND_PART_WORDS.battle);
    expect(secondPartFieldName(SECOND_PART_WORDS.split!, "rules text")).toBe("Right half rules text");
  });

  it("the creator's notices name the part the same way", () => {
    const base = {
      title: "Fire",
      cost: "",
      supertype: "",
      subtypes_text: "",
      rules_text: "",
      flavor_text: "",
      power: "",
      toughness: "",
      loyalty: "",
      defense: "",
      artist_credit: "",
      footer_text: "",
      has_back_face: true,
      back_face: { ...EMPTY_BACK_FACE, title: "Ice" },
    };
    const labels = (template: string) =>
      cardGlyphFields({ ...base, frame_style: { template } } as never).map((f) => f.label);
    expect(labels("split")).toContain("Right half rules text");
    expect(labels("split")).not.toContain("Back face rules text");
    expect(labels("adventure")).toContain("Adventure spell name");
    expect(labels("m15dfcfront")).toContain("Back face rules text");
    expect(
      cardSymbolFields({ ...base, frame_style: { template: "aftermath" } } as never).map((f) => f.label),
    ).toContain("Aftermath half mana cost");
  });
});

describe("what Save still needs — one rule", () => {
  const words = SECOND_PART_WORDS.transform!;
  const input = {
    title: "",
    artUrl: "",
    hasBackFace: true,
    backFace: { title: "", art_url: "" },
    savesAsDraft: false,
    visibility: "public",
    doubleFaced: true,
    words,
  };
  it("a public double-faced card needs a title, both arts and the back's name — each with its field", () => {
    expect(saveNeedsOf(input)).toEqual([
      { id: "title", label: "a title", field: "title" },
      { id: "art", label: "artwork", field: "art_url" },
      { id: "second-art", label: "the back face's artwork", field: "back_face.art_url" },
      { id: "second-name", label: "the back face's name", field: "back_face.title" },
    ]);
    expect(saveNeedsSentence(saveNeedsOf(input))).toBe(
      "Add a title, artwork, the back face's artwork and the back face's name to enable Save.",
    );
  });
  it("a draft needs a title alone; a one-faced card never needs a second anything", () => {
    expect(saveNeedsOf({ ...input, savesAsDraft: true }).map((n) => n.id)).toEqual(["title"]);
    expect(
      saveNeedsOf({ ...input, title: "Bolt", hasBackFace: false, doubleFaced: false, words: LEGACY_SECOND_PART_WORDS }).map((n) => n.id),
    ).toEqual(["art"]);
    expect(saveNeedsSentence([])).toBeNull();
  });
  it("a split card names its half, and only its name (the half's art is never required)", () => {
    const needs = saveNeedsOf({ ...input, title: "Fire", artUrl: "https://x/a.png", doubleFaced: false, words: SECOND_PART_WORDS.split! });
    expect(needs).toEqual([{ id: "second-name", label: "the right half's name", field: "back_face.title" }]);
  });
  it("listPhrase", () => {
    expect(listPhrase([])).toBe("");
    expect(listPhrase(["a"])).toBe("a");
    expect(listPhrase(["a", "b"])).toBe("a and b");
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("what a kind change would remove", () => {
  const face = (over: Partial<BackFaceFormValues>): BackFaceFormValues => ({ ...EMPTY_BACK_FACE, ...over });
  const ask = (over: Partial<BackFaceFormValues>) =>
    describeSecondPartLoss({ face: face(over), words: SECOND_PART_WORDS.transform!, fromLabel: "Transform", toLabel: "Creature" });

  it("nothing to ask for an empty part — its type, colour and art position are not content", () => {
    expect(ask({})).toBeNull();
    expect(ask({ card_type: "land", color_identity: ["green"] })).toBeNull();
    expect(ask({ title: "   " })).toBeNull();
  });
  it("names the part, its name and everything it holds, in printed order", () => {
    expect(ask({ title: "Insectile Aberration", rules_text: "Flying", art_url: "https://x/b.png" })).toEqual({
      title: "Remove the back face?",
      message: "Changing this card to Creature removes the back face (“Insectile Aberration”) — its name, rules text and artwork.",
      restoreNote: "If you switch back to Transform before you leave this page, it comes back as it was. It is never saved with a Creature card.",
      confirmLabel: "Remove the back face",
    });
    expect(ask({ power: "3" })!.message).toBe("Changing this card to Creature removes the back face — its stats.");
  });
  it("agrees with isBlankBackFace on every content field", () => {
    for (const key of [
      "title", "cost", "supertype", "subtypes_text", "rules_text", "flavor_text",
      "power", "toughness", "loyalty", "defense", "artist_credit", "art_url",
    ] as const) {
      const f = face({ [key]: "x" });
      expect(isBlankBackFace(f), key).toBe(false);
      expect(secondPartContents(f).length, key).toBe(1);
    }
    expect(secondPartContents(EMPTY_BACK_FACE)).toEqual([]);
  });
});

describe("focusing a field by its name", () => {
  it("finds an input by name and a control by its anchor; opens every closed fold above it; focuses it", () => {
    document.body.innerHTML = `
      <div id="root">
        <input name="title" />
        <details id="outer"><summary>More</summary>
          <details id="inner"><summary>Even more</summary><input name="back_face.title" /></details>
        </details>
        <button data-field-anchor="art_url">Choose file</button>
      </div>`;
    const root = document.getElementById("root");
    expect(findFieldElement(root, "art_url")?.textContent).toBe("Choose file");
    expect(findFieldElement(root, "nope")).toBeNull();
    expect(revealAndFocusField(root, "nope")).toBe(false);
    expect(revealAndFocusField(root, "back_face.title")).toBe(true);
    expect((document.getElementById("outer") as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById("inner") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement?.getAttribute("name")).toBe("back_face.title");
    expect(revealAndFocusField(root, "art_url")).toBe(true);
    expect(document.activeElement?.getAttribute("data-field-anchor")).toBe("art_url");
    expect(revealAndFocusField(null, "title")).toBe(false);
  });
});
