import { describe, expect, it } from "vitest";
import type { Card, FaceContent } from "@/types/card";
import { resolveSagaChapters } from "@/lib/cards/face-content";
import { resolveSagaCreature, sagaCreatureTextAfterRows } from "@/lib/cards/saga-creature";
import { isSagaCreatureDress } from "@/lib/creator/card-kinds";
import { defaultValuesFor, openedForFrame, sagaRowsForFrame, sagaRowsFromText } from "@/lib/creator/card-fields";
import { cardFormSchemaFor, SAGA_CREATURE_NEEDS_CHAPTER } from "@/lib/creator/form-schema";
import type { FormValues } from "@/lib/creator/form-types";
import { structuredRowsUntouched, submittedRulesOf } from "@/lib/creator/structured-rules";
import { printTypography, withPrintTypography, withPrintTypographyUpdate } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// TODO 4.5d — the saga creature's TEXT MODEL, end to end (the independent
// check of #651): the real chain the creator and the renderers run —
// defaultValuesFor → (the frame move's re-read) → submittedRulesOf → the
// server's typography pass → resolveSagaCreature — over several saves.
//
// The rule: beside stored rows (face_content.saga, which the rail draws
// first) the creature box's text is what the rules text holds after the
// rows' exact serialization; with no rows, on the saga creature frame, the
// lines after the last chapter. Nothing is drawn twice, nothing grows on a
// save, nothing typed vanishes, and an untouched edit keeps its text.
// ---------------------------------------------------------------------------

const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after V.)";
const FIN_36 = [
  REMINDER,
  "I, II, III, IV — Create three 2/2 white Knight creature tokens.",
  "V — Ultimate End — Other creatures you control get +2/+2 until end of turn. Put a +1/+1 counter on each creature you control.",
  "Indestructible",
].join("\n");

function storedCard(over: Partial<Card> & { template: string }): Card {
  const { template, ...rest } = over;
  return {
    id: "00000000-0000-4000-8000-000000000036",
    title: "Summon: Knights of Round",
    slug: "summon-knights-of-round",
    game_system_id: "gs",
    cost: "{3}{W}{W}{W}{W}",
    color_identity: ["white"],
    supertype: "Creature",
    card_type: "enchantment",
    subtypes: ["Saga", "Knight"],
    tags: [],
    rarity: "mythic",
    rules_text: FIN_36,
    flavor_text: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: null,
    art_position: {},
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    ...rest,
    frame_style: { template },
  } as unknown as Card;
}

type Move = { template?: string; edit?: (values: FormValues) => FormValues };

/** One EDIT, as the creator runs it: open the stored card, move its frame
 *  (the form's re-read while the rows are untouched — card-creator-form's
 *  effect), edit, save (submittedRulesOf + the server's typography pass),
 *  and the row the update writes. */
function saveEdit(card: Card, { template, edit }: Move = {}): Card & { sentFaceContent: boolean } {
  const storedTemplate = (card.frame_style as { template: string }).template;
  const defaults = defaultValuesFor(card, []);
  let values: FormValues = defaults;
  const to = template ?? storedTemplate;
  if (to !== storedTemplate) {
    const moved = { ...values, frame_style: { ...values.frame_style, template: to } } as FormValues;
    values = structuredRowsUntouched("saga", moved, openedForFrame(defaults, card, storedTemplate))
      ? { ...moved, ...sagaRowsForFrame(card, to) }
      : moved;
  }
  if (edit) values = edit(values);
  const out = submittedRulesOf("saga", values, {
    opened: openedForFrame(defaults, card, to),
    storedFaceContent: card.face_content ?? null,
    sagaCreatureFrame: isSagaCreatureDress(to as never),
  });
  const patch = withPrintTypographyUpdate(
    {
      rules_text: out.rulesText,
      ...(out.keepsStored ? {} : { face_content: out.faceContent }),
      card_type: card.card_type,
      frame_style: { template: to },
    },
    card as never,
  );
  return {
    ...card,
    rules_text: patch.rules_text ?? null,
    face_content: out.keepsStored ? card.face_content : ((patch.face_content ?? null) as FaceContent | null),
    frame_style: { template: to },
    sentFaceContent: !out.keepsStored,
  } as Card & { sentFaceContent: boolean };
}

/** A NEW card's save, as the creator runs it. */
function saveNew(values: Partial<FormValues>, template: string): Card {
  const base = { ...defaultValuesFor(undefined, []), card_type: "enchantment", ...values } as FormValues;
  const out = submittedRulesOf("saga", base, { sagaCreatureFrame: isSagaCreatureDress(template as never) });
  const payload = withPrintTypography({
    rules_text: out.rulesText,
    face_content: out.faceContent,
    card_type: "enchantment",
    frame_style: { template },
  });
  return storedCard({ template, rules_text: payload.rules_text ?? null, face_content: (payload.face_content ?? null) as FaceContent | null });
}

const drawn = (card: Card) => resolveSagaCreature(card.face_content, card.rules_text);
/** How often `needle` is drawn on the saga creature frame: rail + box. */
const timesDrawn = (card: Card, needle: string) => {
  const { intro, chapters, creatureText } = drawn(card);
  return [intro ?? "", ...chapters.map((c) => c.text), creatureText ?? ""].join("\n").split(needle).length - 1;
};
const retitle = (v: FormValues) => ({ ...v, title: `${v.title}!` });
const editRow = (v: FormValues) => ({
  ...v,
  saga_chapters: v.saga_chapters.map((r, i) => (i === 0 ? { ...r, text: `${r.text} Scry 1.` } : r)),
});

describe("item 1 — a FIN import retitled on the saga frame, then moved onto the body", () => {
  // On main, the untouched retitle dual-wrote face_content from the rows the
  // saga frame reads: the last chapter JOINED to the "Indestructible" line.
  const imported = storedCard({ template: "saga" });
  const retitled = saveEdit(imported, { edit: retitle });

  it("(main's state) the retitle kept the text and wrote the joined chapter as rows", () => {
    expect(retitled.rules_text).toBe(FIN_36);
    expect(retitled.face_content?.saga?.chapters.at(-1)?.text).toMatch(/each creature you control\. Indestructible$/);
  });

  it("on the body the ability is drawn ONCE — the rows' (the text after them is nothing)", () => {
    const onBody = { ...retitled, frame_style: { template: "sagacreature" } } as Card;
    expect(sagaCreatureTextAfterRows(onBody.face_content, onBody.rules_text)).toBeNull();
    expect(timesDrawn(onBody, "Indestructible")).toBe(1);
  });

  it("moved on an edit: untouched it keeps the text byte for byte; with a row edited, still drawn once", () => {
    const moved = saveEdit(retitled, { template: "sagacreature", edit: retitle });
    expect(moved.rules_text).toBe(FIN_36);
    expect(timesDrawn(moved, "Indestructible")).toBe(1);
    const edited = saveEdit(retitled, { template: "sagacreature", edit: editRow });
    expect(timesDrawn(edited, "Indestructible")).toBe(1);
    // …and again, saved on the body.
    const again = saveEdit(edited, { edit: editRow });
    expect(timesDrawn(again, "Indestructible")).toBe(1);
  });

  it("the variant: no face_content, moved with a row edited — the line goes to the box, not the chapter", () => {
    const edited = saveEdit(imported, { template: "sagacreature", edit: editRow });
    expect(edited.rules_text!.endsWith("\nIndestructible")).toBe(true);
    expect(drawn(edited).creatureText).toBe("Indestructible");
    expect(drawn(edited).chapters.at(-1)!.text).not.toContain("Indestructible");
    expect(timesDrawn(edited, "Indestructible")).toBe(1);
    // The editor opens it there again.
    const reopened = defaultValuesFor(edited, []);
    expect(reopened.saga_creature_text).toBe("Indestructible");
    expect(reopened.saga_chapters.at(-1)!.text).not.toContain("Indestructible");
  });

  it("the variant, untouched: moved and retitled, the stored text is kept byte for byte", () => {
    const moved = saveEdit(imported, { template: "sagacreature", edit: retitle });
    expect(moved.rules_text).toBe(FIN_36);
    expect(drawn(moved).creatureText).toBe("Indestructible");
    expect(timesDrawn(moved, "Indestructible")).toBe(1);
  });
});

describe("item 2 — a two-line last chapter on the body", () => {
  const chapters = [
    { numerals: [1], text: "Draw a card." },
    { numerals: [2], text: "Gain 2 life.\nScry 1." },
  ];

  it("is drawn once and never grows, over several save rounds", () => {
    let card = saveNew({ saga_intro: "", saga_chapters: chapters, saga_creature_text: "Flying" }, "sagacreature");
    expect(card.rules_text).toBe("I — Draw a card.\nII — Gain 2 life.\nScry 1.\nFlying");
    expect(drawn(card).creatureText).toBe("Flying");
    for (let round = 0; round < 4; round += 1) {
      expect(timesDrawn(card, "Scry 1.")).toBe(1);
      const opened = defaultValuesFor(card, []);
      expect(opened.saga_chapters.at(-1)!.text).toBe("Gain 2 life.\nScry 1.");
      expect(opened.saga_creature_text).toBe("Flying");
      // An untouched retitle keeps the text…
      const before = card.rules_text;
      card = saveEdit(card, { edit: retitle });
      expect(card.rules_text).toBe(before);
      // …and an edit of a row writes it again, the same length but the row.
      card = saveEdit(card, {
        edit: (v) => ({ ...v, saga_chapters: v.saga_chapters.map((r, i) => (i === 0 ? { ...r, text: `Draw ${round + 2} cards.` } : r)) }),
      });
      expect(card.rules_text).toBe(`I — Draw ${round + 2} cards.\nII — Gain 2 life.\nScry 1.\nFlying`);
    }
    expect(card.rules_text!.split("Scry 1.").length - 1).toBe(1);
    expect(timesDrawn(card, "Gain 2 life.\nScry 1.")).toBe(1);
    expect(drawn(card).creatureText).toBe("Flying");
  });
});

describe("item 3 — box lines that read as a bullet or a chapter stay the box's", () => {
  const rows = { saga_intro: REMINDER, saga_chapters: [{ numerals: [1], text: "Draw a card." }] };

  it("a leading • (\"- \" on blur) is kept", () => {
    const typed = printTypography("- Vivi gets +1/+1.", "rules");
    expect(typed).toBe("• Vivi gets +1/+1.");
    const card = saveNew({ ...rows, saga_creature_text: typed }, "sagacreature");
    expect(drawn(card).creatureText).toBe("• Vivi gets +1/+1.");
    expect(drawn(card).chapters.map((c) => c.text)).toEqual(["Draw a card."]);
    expect(defaultValuesFor(card, []).saga_creature_text).toBe("• Vivi gets +1/+1.");
    expect(saveEdit(card, { edit: editRow }).rules_text!.endsWith("\n• Vivi gets +1/+1.")).toBe(true);
  });

  it("a line like \"Vivi — …\" (a chapter marker to the line split) is kept", () => {
    const card = saveNew({ ...rows, saga_creature_text: "Vivi — Flying\nWard {2}" }, "sagacreature");
    expect(drawn(card).creatureText).toBe("Vivi — Flying\nWard {2}");
    expect(drawn(card).chapters).toHaveLength(1);
    const reopened = defaultValuesFor(card, []);
    expect(reopened.saga_creature_text).toBe("Vivi — Flying\nWard {2}");
    expect(reopened.saga_chapters).toHaveLength(1);
    const edited = saveEdit(card, { edit: editRow });
    expect(drawn(edited).creatureText).toBe("Vivi — Flying\nWard {2}");
    expect(timesDrawn(edited, "Vivi")).toBe(1);
  });
});

describe("item 4 — text is never dropped in silence", () => {
  it("(a) a stored body card moved to the saga frame with a row changed keeps its box's text", () => {
    // Stored with rows: the field keeps its value (shown on any frame while
    // it holds one) and the save writes it after the chapters.
    const withRows = saveNew(
      { saga_intro: REMINDER, saga_chapters: [{ numerals: [1], text: "Draw a card." }], saga_creature_text: "Flying" },
      "sagacreature",
    );
    const moved = saveEdit(withRows, { template: "saga", edit: editRow });
    expect(moved.rules_text!.endsWith("\nFlying")).toBe(true);
    expect(defaultValuesFor(moved, []).saga_creature_text).toBe("Flying");
    // …and moved back it is the box's again.
    const back = saveEdit(moved, { template: "sagacreature", edit: retitle });
    expect(drawn(back).creatureText).toBe("Flying");
    // Stored as plain text: on the saga frame the line continues the chapter,
    // as that frame draws it — kept in the text.
    const plain = storedCard({ template: "sagacreature" });
    const plainMoved = saveEdit(plain, { template: "saga", edit: editRow });
    expect(plainMoved.rules_text).toContain("Indestructible");
    expect(resolveSagaChapters(plainMoved.face_content, plainMoved.rules_text).chapters.at(-1)!.text).toContain("Indestructible");
  });

  it("(b) the box's text with no chapter to follow blocks the save, and says so", () => {
    const values = {
      ...defaultValuesFor(undefined, []),
      title: "Summon: Shiva",
      card_type: "enchantment",
      supertype: "Creature",
      subtypes_text: "Saga",
      frame_style: { ...defaultValuesFor(undefined, []).frame_style, template: "sagacreature" },
      saga_intro: REMINDER,
      saga_chapters: [],
      saga_creature_text: "Flying",
    } as FormValues;
    const issue = (v: FormValues) =>
      cardFormSchemaFor(null).safeParse(v).error?.issues.find((i) => i.path.join(".") === "saga_creature_text")?.message ?? null;
    expect(issue(values)).toBe(SAGA_CREATURE_NEEDS_CHAPTER);
    expect(issue({ ...values, saga_chapters: [{ numerals: [1], text: "Draw a card." }] })).toBeNull();
    expect(issue({ ...values, saga_creature_text: "" })).toBeNull();
  });
});

describe("an untouched edit of a stored saga creature keeps rules_text byte for byte", () => {
  it("stored as plain text, as an import stores it", () => {
    const card = storedCard({ template: "sagacreature" });
    expect(saveEdit(card, { edit: retitle }).rules_text).toBe(FIN_36);
  });

  it("stored as plain text spelled off the rows' serialization: kept, rows NOT written (the box would go)", () => {
    const text = "I: Draw a card.\nII: Scry 2.\nFlying";
    const card = storedCard({ template: "sagacreature", rules_text: text });
    const saved = saveEdit(card, { edit: retitle });
    expect(saved.rules_text).toBe(text);
    expect(saved.sentFaceContent).toBe(false);
    expect(drawn(saved).creatureText).toBe("Flying");
  });

  it("stored with rows", () => {
    const card = saveNew(
      { saga_intro: REMINDER, saga_chapters: [{ numerals: [1, 2], text: "Draw a card." }], saga_creature_text: "Flying" },
      "sagacreature",
    );
    expect(saveEdit(card, { edit: retitle }).rules_text).toBe(card.rules_text);
  });
});

describe("a text that ARRIVES (an import, an AI fill) seeds the editor for the frame it lands on", () => {
  it("on the body the line after the chapters seeds the box; on the saga frame it continues the chapter", () => {
    const onBody = sagaRowsFromText(FIN_36, "sagacreature");
    expect(onBody.saga_creature_text).toBe("Indestructible");
    expect(onBody.saga_chapters.at(-1)!.text).not.toContain("Indestructible");
    const onSaga = sagaRowsFromText(FIN_36, "saga");
    expect(onSaga.saga_creature_text).toBe("");
    expect(onSaga.saga_chapters.at(-1)!.text).toMatch(/Indestructible$/);
    // …the very rows the editor opens a stored card with on each frame.
    expect(onBody).toEqual(sagaRowsForFrame(storedCard({ template: "saga" }), "sagacreature"));
    expect(onSaga).toEqual(sagaRowsForFrame(storedCard({ template: "sagacreature" }), "saga"));
  });
});
