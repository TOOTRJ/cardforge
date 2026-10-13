import { describe, expect, it } from "vitest";
import { sagaFromRulesText } from "@/lib/cards/face-content";
import { submittedRulesOf, type StructuredRulesValues } from "@/lib/creator/structured-rules";

// ---------------------------------------------------------------------------
// What a planeswalker's / a saga's row editors save. The rules textarea is
// hidden for those kinds and holds a COPY of the text the rows were read
// from; submittedRulesOf decides when that copy travels:
// - never once the rows were all removed (it brought them back — on a new
//   card too, the create half of the 2026-10-12 emptied-field bug);
// - on an edit, unchanged whenever the rows still read as the rows the form
//   OPENED with (a stored text is never re-spelled, and a stored NULL never
//   filled, by a save that didn't edit the rows).
// ---------------------------------------------------------------------------

const values = (over: Partial<StructuredRulesValues> = {}): StructuredRulesValues => ({
  rules_text: "",
  loyalty_abilities: [],
  saga_intro: "",
  saga_chapters: [],
  ...over,
});
/** An edit: the form opened with these values. */
const editOf = (opened: StructuredRulesValues) => ({ opened });

describe("every other kind", () => {
  it("the textarea, trimmed; no rows", () => {
    expect(submittedRulesOf("creature", values({ rules_text: "  Haste \n" }))).toEqual({
      rulesText: "Haste",
      faceContent: null,
    });
    // Rows left in the form by another kind are not this card's.
    expect(
      submittedRulesOf("creature", values({ rules_text: "Haste", loyalty_abilities: [{ cost: "+1", text: "Draw." }] })),
    ).toEqual({ rulesText: "Haste", faceContent: null });
  });
});

describe("a planeswalker", () => {
  const ROWS = [
    { cost: "+1", text: "Draw a card." },
    { cost: "", text: "Flying" },
  ];

  it("rows: the structured rows and their serialized text", () => {
    expect(submittedRulesOf("planeswalker", values({ loyalty_abilities: ROWS }))).toEqual({
      rulesText: "+1: Draw a card.\nFlying",
      faceContent: {
        v: 1,
        loyalty: {
          abilities: [
            { cost: "+1", text: "Draw a card." },
            { cost: null, text: "Flying" },
          ],
        },
      },
    });
  });

  it("a cost's U+2212 minus and en dash become ASCII, upper-cased", () => {
    const out = submittedRulesOf(
      "planeswalker",
      values({
        loyalty_abilities: [
          { cost: "−2", text: "A." },
          { cost: "–x", text: "B." },
        ],
      }),
    );
    expect(out.rulesText).toBe("-2: A.\n-X: B.");
  });

  it.each(["a new card", "an edit"])("every row removed (%s): no text, no rows — not the hidden copy", (label) => {
    const hidden = "+1: Draw a card.\n-2: Deal 3 damage.";
    const options =
      label === "an edit"
        ? editOf(
            values({
              rules_text: hidden,
              loyalty_abilities: [
                { cost: "+1", text: "Draw a card." },
                { cost: "-2", text: "Deal 3 damage." },
              ],
            }),
          )
        : {};
    expect(submittedRulesOf("planeswalker", values({ rules_text: hidden }), options)).toEqual({
      rulesText: "",
      faceContent: null,
    });
    // Rows left with no text are removed rows.
    expect(
      submittedRulesOf(
        "planeswalker",
        values({ rules_text: hidden, loyalty_abilities: [{ cost: "+1", text: "  " }] }),
        options,
      ),
    ).toEqual({ rulesText: "", faceContent: null });
  });

  it("an edit: rows that still read as the stored text keep it byte for byte", () => {
    const stored = "−2: Deal 2 damage.\n\n+1 : Scry 1.\nFlying";
    const rows = [
      { cost: "-2", text: "Deal 2 damage." },
      { cost: "+1", text: "Scry 1." },
      { cost: "", text: "Flying" },
    ];
    const opened = values({ rules_text: stored, loyalty_abilities: rows });
    const out = submittedRulesOf("planeswalker", opened, editOf(opened));
    expect(out.rulesText).toBe(stored);
    expect(out.faceContent?.loyalty?.abilities).toHaveLength(3);
    // Costs the form opened with in another spelling are the same rows.
    expect(
      submittedRulesOf(
        "planeswalker",
        values({ rules_text: stored, loyalty_abilities: [{ cost: " −2 ", text: " Deal 2 damage. " }, rows[1], rows[2]] }),
        editOf(opened),
      ).rulesText,
    ).toBe(stored);
    // A new card has no stored text: canonical.
    expect(submittedRulesOf("planeswalker", values({ rules_text: stored, loyalty_abilities: rows })).rulesText).toBe(
      "-2: Deal 2 damage.\n+1: Scry 1.\nFlying",
    );
  });

  it("an edit: a changed, added, removed or reordered row saves the rows", () => {
    const stored = "−2: Deal 2 damage.\n+1: Scry 1.";
    const a = { cost: "-2", text: "Deal 2 damage." };
    const b = { cost: "+1", text: "Scry 1." };
    const opened = values({ rules_text: stored, loyalty_abilities: [a, b] });
    const out = (rows: { cost: string; text: string }[]) =>
      submittedRulesOf("planeswalker", values({ rules_text: stored, loyalty_abilities: rows }), editOf(opened)).rulesText;
    expect(out([a, b])).toBe(stored);
    expect(out([a, { ...b, text: "Scry 2." }])).toBe("-2: Deal 2 damage.\n+1: Scry 2.");
    expect(out([a, { ...b, cost: "+2" }])).toBe("-2: Deal 2 damage.\n+2: Scry 1.");
    expect(out([a, b, { cost: "", text: "Flying" }])).toBe("-2: Deal 2 damage.\n+1: Scry 1.\nFlying");
    expect(out([a])).toBe("-2: Deal 2 damage.");
    expect(out([b, a])).toBe("+1: Scry 1.\n-2: Deal 2 damage.");
  });
});

describe("a saga", () => {
  const CH1 = { numerals: [1], text: "Draw a card." };

  it("chapters: the structured rows and their serialized text", () => {
    expect(
      submittedRulesOf(
        "saga",
        values({ saga_intro: " (Reminder.) ", saga_chapters: [{ numerals: [2, 1], text: " Draw a card. " }] }),
      ),
    ).toEqual({
      rulesText: "(Reminder.)\nI, II — Draw a card.",
      faceContent: { v: 1, saga: { intro: "(Reminder.)", chapters: [{ numerals: [1, 2], text: "Draw a card." }] } },
    });
  });

  it.each(["a new card", "an edit"])("every chapter removed (%s): the intro is the text — \"\" with none", (label) => {
    const hidden = "(Reminder.)\nI — Draw a card.";
    const options =
      label === "an edit"
        ? editOf(values({ rules_text: hidden, saga_intro: "(Reminder.)", saga_chapters: [CH1] }))
        : {};
    expect(submittedRulesOf("saga", values({ rules_text: hidden, saga_intro: "(Reminder.)" }), options)).toEqual({
      rulesText: "(Reminder.)",
      faceContent: null,
    });
    expect(submittedRulesOf("saga", values({ rules_text: hidden }), options)).toEqual({
      rulesText: "",
      faceContent: null,
    });
    expect(
      submittedRulesOf("saga", values({ rules_text: hidden, saga_chapters: [{ numerals: [1], text: "" }] }), options),
    ).toEqual({ rulesText: "", faceContent: null });
  });

  it("only an intro, on a saga with no hidden text: the intro is saved", () => {
    expect(submittedRulesOf("saga", values({ saga_intro: "(Reminder.)" })).rulesText).toBe("(Reminder.)");
  });

  it("a hidden text with no chapter, shown as the intro and untouched: resent as it is", () => {
    // The editor joins its lines; the text keeps its line break.
    const hidden = "Flying\nTrample";
    const intro = sagaFromRulesText(hidden).intro ?? "";
    expect(intro).not.toBe(hidden);
    expect(submittedRulesOf("saga", values({ rules_text: hidden, saga_intro: intro })).rulesText).toBe(hidden);
    expect(submittedRulesOf("saga", values({ rules_text: hidden, saga_intro: "Flying, haste" })).rulesText).toBe(
      "Flying, haste",
    );
  });

  it("a row with a text and no chapter number is not an emptied editor", () => {
    const row = { numerals: [], text: "Draw a card." };
    // The hidden text stays…
    expect(
      submittedRulesOf("saga", values({ rules_text: "XI — Draw a card.", saga_chapters: [row] })).rulesText,
    ).toBe("XI — Draw a card.");
    // …and with none to keep, the intro is the text rather than nothing.
    expect(submittedRulesOf("saga", values({ saga_intro: "(Reminder.)", saga_chapters: [row] })).rulesText).toBe(
      "(Reminder.)",
    );
  });

  it("an edit: chapters that still read as the stored text keep it byte for byte", () => {
    const stored = "(Reminder.)\n\nI,II — Draw a card.";
    const v = values({ rules_text: stored, saga_intro: "(Reminder.)", saga_chapters: [{ numerals: [1, 2], text: "Draw a card." }] });
    const EDIT = editOf(v);
    expect(submittedRulesOf("saga", v, EDIT).rulesText).toBe(stored);
    expect(submittedRulesOf("saga", v).rulesText).toBe("(Reminder.)\nI, II — Draw a card.");
    // The intro edited: the rows are the text.
    expect(submittedRulesOf("saga", { ...v, saga_intro: "(New.)" }, EDIT).rulesText).toBe("(New.)\nI, II — Draw a card.");
    // A chapter renumbered.
    expect(
      submittedRulesOf("saga", { ...v, saga_chapters: [{ numerals: [1], text: "Draw a card." }] }, EDIT).rulesText,
    ).toBe("(Reminder.)\nI — Draw a card.");
    expect(submittedRulesOf("saga", { ...v, saga_chapters: [CH1, { numerals: [3], text: "Win." }] }, EDIT).rulesText).toBe(
      "(Reminder.)\nI — Draw a card.\nIII — Win.",
    );
  });
});

describe("an edit of a card stored with its rows alone (rules_text NULL)", () => {
  it("untouched rows: the text stays empty — the NULL is not filled by a retitle", () => {
    const walker = values({ loyalty_abilities: [{ cost: "+1", text: "Draw a card." }] });
    expect(submittedRulesOf("planeswalker", walker, editOf(walker)).rulesText).toBe("");
    expect(submittedRulesOf("planeswalker", walker, editOf(walker)).faceContent).not.toBeNull();
    const saga = values({ saga_chapters: [{ numerals: [1], text: "Draw a card." }] });
    expect(submittedRulesOf("saga", saga, editOf(saga)).rulesText).toBe("");
  });

  it("an edited row writes the text", () => {
    const opened = values({ loyalty_abilities: [{ cost: "+1", text: "Draw a card." }] });
    expect(
      submittedRulesOf("planeswalker", values({ loyalty_abilities: [{ cost: "+1", text: "Draw two cards." }] }), editOf(opened))
        .rulesText,
    ).toBe("+1: Draw two cards.");
  });

  it("a hidden text that is no longer the one the form opened with (an AI fill): the rows are the text", () => {
    const opened = values({ rules_text: "−2: Old.", loyalty_abilities: [{ cost: "-2", text: "Old." }] });
    expect(
      submittedRulesOf(
        "planeswalker",
        values({ rules_text: "−2: Old. ", loyalty_abilities: [{ cost: "-2", text: "Old." }] }),
        editOf(opened),
      ).rulesText,
    ).toBe("-2: Old.");
  });
});
