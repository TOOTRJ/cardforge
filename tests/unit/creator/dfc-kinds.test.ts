import { describe, expect, it } from "vitest";
import {
  CARD_KIND_VALUES,
  DFC_FACE_TYPES,
  KIND_DEFS,
  KIND_PICKER_KINDS,
  LAYOUT_KIND_CARD_TYPES,
  dfcFrontBodyFor,
  dfcKindFor,
  dfcLayoutForKind,
  framesForKind,
  kindFromCard,
  kindHasAvailableFrame,
  planKindChange,
  templateRefusesKind,
} from "@/lib/creator/card-kinds";
import { KIND_REQUIRES } from "@/lib/cards/kind-anatomy";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { blankSecondFaceFor, defaultValuesFor } from "@/lib/creator/card-fields";
import { panelConfigFor } from "@/lib/creator/steps";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { cardFormSchema } from "@/lib/creator/form-schema";
import { EMPTY_BACK_FACE, EMPTY_WATERMARK, type FormValues } from "@/lib/creator/form-types";
import { DFC_BACK_TYPE_REFUSED, DFC_COLORLESS_NEEDS_ARTIFACT } from "@/lib/cards/dfc-gate";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.2 — the editor's model for the double-faced kinds: the two chips
// (Transform lit only with a verified front AND default back; Modal dark
// until 5.1b's bodies), the front body a face type derives, the forced back
// face, the blank back, the hydrated back colour, an edit's family patch
// and the form schema's back-face rules.
// ---------------------------------------------------------------------------

describe("the two double-faced kinds", () => {
  it("are chips of the picker; the Modal kind has an empty body family until 5.1b", () => {
    expect(CARD_KIND_VALUES).toContain("mdfc");
    expect(KIND_PICKER_KINDS).toContain("transform");
    expect(KIND_PICKER_KINDS).toContain("mdfc");
    expect(KIND_DEFS.mdfc).toMatchObject({ label: "Modal double-faced", cardType: "creature", layoutTemplates: [], inlineSecondFace: false });
    expect(KIND_REQUIRES.mdfc).toEqual(["dfcFront"]);
    expect(LAYOUT_KIND_CARD_TYPES.mdfc).toEqual(DFC_FACE_TYPES);
    expect(LAYOUT_KIND_CARD_TYPES.transform).toEqual(DFC_FACE_TYPES);
    expect(dfcLayoutForKind("transform")).toBe("transform");
    expect(dfcLayoutForKind("mdfc")).toBe("modal");
    for (const kind of CARD_KIND_VALUES) {
      if (kind === "transform" || kind === "mdfc") continue;
      expect(dfcLayoutForKind(kind), kind).toBeNull();
    }
    expect(dfcKindFor("m15dfcback")).toBe("transform");
  });

  it("the Modal chip stays dark whatever is verified; the Transform chip lights with a front and the default back", () => {
    const everything = new Set(["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback", "m15"].flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k))));
    expect(kindHasAvailableFrame("mdfc", everything)).toBe(false);
    expect(framesForKind("mdfc", everything)).toEqual([]);
    expect(kindHasAvailableFrame("transform", everything)).toBe(true);
    expect(kindHasAvailableFrame("transform", new Set([frameComboKey("m15dfcfront", "u")]))).toBe(false);
    expect(kindHasAvailableFrame("transform", new Set([frameComboKey("m15dfcfront", "u"), frameComboKey("m15dfcback", "u")]))).toBe(true);
    // Picking the modal kind programmatically keeps the card where it is.
    expect(planKindChange("mdfc", { cardType: "creature", template: "m15" })).toEqual({ action: "apply", patch: { card_type: "creature", template: "m15" } });
    expect(kindFromCard("creature", "m15")).toBe("creature");
    // No template dresses the modal kind yet: a back body and a showcase
    // refuse it (like every layout kind); border-era and layout frames are
    // never judged by templateRefusesKind (the galleries decide there).
    for (const t of ["m15dfcback", "m15dfcbackleft", "nyx", "fullart"] as const) expect(templateRefusesKind(t, "mdfc"), t).toBe(true);
    for (const t of ["m15", "m15dfcfront"] as const) expect(templateRefusesKind(t, "mdfc"), t).toBe(false);
  });

  it("the front body follows the face type: the land front for a land, the spell front for the rest; none for the modal kind yet", () => {
    for (const type of ["creature", "artifact", "enchantment", "instant", "sorcery"] as const) {
      expect(dfcFrontBodyFor("transform", type), type).toBe("m15dfcfront");
      expect(dfcFrontBodyFor("mdfc", type), type).toBeNull();
    }
    expect(dfcFrontBodyFor("transform", "land")).toBe("m15dfclandfront");
    expect(dfcFrontBodyFor("transform", "")).toBe("m15dfcfront");
    expect(dfcFrontBodyFor("creature", "creature")).toBeNull();
  });

  it("the back face is forced on for the double-faced kinds (clear, never remove) and starts as a creature", () => {
    expect(panelConfigFor({ template: "m15dfcfront", cardType: "creature", hasBackFace: true, kind: "transform" }).forcedBackFace).toBe(true);
    expect(panelConfigFor({ template: "m15", cardType: "creature", hasBackFace: false, kind: "mdfc" }).forcedBackFace).toBe(true);
    expect(panelConfigFor({ template: "m15", cardType: "creature", hasBackFace: false, kind: "creature" }).forcedBackFace).toBe(false);
    expect(blankSecondFaceFor("transform")).toEqual({ ...EMPTY_BACK_FACE, card_type: "creature", color_identity: [] });
    expect(blankSecondFaceFor("creature")).toBe(EMPTY_BACK_FACE);
    expect(EMPTY_BACK_FACE.color_identity).toEqual([]);
  });

  it("hydrates a stored back's colour; a legacy back names none", () => {
    const card = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Delver",
      slug: "delver",
      game_system_id: "g",
      color_identity: ["blue"],
      card_type: "creature",
      subtypes: [],
      frame_style: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" },
      visibility: "public",
      back_face: { title: "Aberration", card_type: "creature", frame_style: { template: "m15dfcbackleft" }, color_identity: ["green"] },
    } as unknown as Card;
    const values = defaultValuesFor(card, []);
    expect(values.back_face.color_identity).toEqual(["green"]);
    expect(values.frame_style.dfcIcon).toBe("sunmoon");
    expect(values.has_back_face).toBe(true);
    expect(values).not.toHaveProperty("back_card_id");
    const legacy = defaultValuesFor({ ...card, back_face: { title: "Aberration", card_type: "creature" } } as unknown as Card, []);
    expect(legacy.back_face.color_identity).toEqual([]);
  });

  it("an edit's anatomy patch carries a changed family, and nothing when the form holds the stored one", () => {
    const stored = { frame_style: { template: "m15dfcfront", dfcIcon: "arrows", collector: "2023" }, color_identity: ["blue"] as const };
    const values = { frame_style: { template: "m15dfcfront", dfcIcon: "compass", collector: "2023" }, color_identity: ["blue"] } as FormValues;
    expect(frameAnatomyPatchFor(stored, values)).toEqual({ dfcIcon: "compass" });
    expect(frameAnatomyPatchFor(stored, { ...values, frame_style: { ...values.frame_style, dfcIcon: "arrows" } })).toBeUndefined();
    // A family on a plain card's form (none stored) travels too — the
    // server drops it on a template that doesn't draw it.
    expect(frameAnatomyPatchFor({ frame_style: { template: "m15" }, color_identity: ["blue"] }, { ...values, frame_style: { template: "m15", dfcIcon: "fan" } })).toEqual({ dfcIcon: "fan" });
  });
});

describe("the form schema's back-face rules on a transform card", () => {
  function values(over: Partial<FormValues> = {}): FormValues {
    return {
      title: "Delver of Secrets",
      slug: "",
      game_system_id: "g",
      cost: "{U}",
      color_identity: ["blue"],
      supertype: "",
      card_type: "creature",
      subtypes_text: "Human Wizard",
      tags_text: "",
      rarity: "common",
      rules_text: "",
      loyalty_abilities: [],
      saga_intro: "",
      saga_chapters: [],
      flavor_text: "",
      power: "1",
      toughness: "1",
      loyalty: "",
      defense: "",
      artist_credit: "",
      art_url: "https://example.com/art.png",
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: { finish: "regular", template: "m15dfcfront", dfcIcon: "arrows" },
      visibility: "public",
      save_as_draft: false,
      has_back_face: true,
      back_face: { ...EMPTY_BACK_FACE, title: "Insectile Aberration", card_type: "creature", art_url: "https://example.com/back.png" },
      source_scryfall_id: "",
      set_icon_url: "",
      set_icon_code: "",
      set_code: "",
      collector_number: "",
      lang: "en",
      deck_id: "",
      watermark: EMPTY_WATERMARK,
      footer_text: "",
      ...over,
    };
  }
  const issueAt = (v: FormValues, path: string) =>
    cardFormSchema.safeParse(v).error?.issues.find((i) => i.path.join(".") === path)?.message ?? null;

  it("accepts the shape the panel produces; refuses a walker back and a colourless non-artifact back; an artifact back may be colourless", () => {
    expect(cardFormSchema.safeParse(values()).success).toBe(true);
    expect(issueAt(values({ back_face: { ...values().back_face, card_type: "planeswalker" } }), "back_face.card_type")).toBe(DFC_BACK_TYPE_REFUSED);
    expect(issueAt(values({ back_face: { ...values().back_face, color_identity: ["colorless"] } }), "back_face.color_identity")).toBe(DFC_COLORLESS_NEEDS_ARTIFACT);
    // The front's colour when the back names none: a colourless front.
    expect(issueAt(values({ color_identity: ["colorless"] }), "back_face.color_identity")).toBe(DFC_COLORLESS_NEEDS_ARTIFACT);
    expect(issueAt(values({ back_face: { ...values().back_face, card_type: "artifact", color_identity: ["colorless"] } }), "back_face.color_identity")).toBeNull();
    expect(issueAt(values({ back_face: { ...values().back_face, supertype: "Artifact", color_identity: ["colorless"] } }), "back_face.color_identity")).toBeNull();
    // A land back takes any colour (one master under every key).
    expect(issueAt(values({ back_face: { ...values().back_face, card_type: "land", color_identity: ["colorless"] } }), "back_face.color_identity")).toBeNull();
    // On a plain card the rules don't apply.
    expect(cardFormSchema.safeParse(values({ frame_style: { finish: "regular", template: "m15" }, has_back_face: false })).success).toBe(true);
  });
});
