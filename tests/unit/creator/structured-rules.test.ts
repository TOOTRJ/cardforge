import { describe, expect, it } from "vitest";
import { loyaltyFromRulesText, sagaFromRulesText } from "@/lib/cards/face-content";
import {
  MAX_STRUCTURED_ROWS,
  sagaRowsNeedingNumber,
  structuredRowsSaveAsText,
  structuredRowsUntouched,
  submittedRulesOf,
  type StructuredRulesValues,
} from "@/lib/creator/structured-rules";
import { faceContentSchema } from "@/lib/validation/card";

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

// A marker the editor can't number beside ones it can ("I — …" + "XI — …"):
// the row opens with a text and no chapter. It never saves as a chapter,
// but it is a row its maker can edit or remove (the independent check,
// 2026-10-13).
describe("an edit of a saga with a chapter the editor can't number", () => {
  const TEXT = "I — One.\nXI — Eleven.";
  const opened = values({
    rules_text: TEXT,
    saga_chapters: sagaFromRulesText(TEXT).chapters.map((ch) => ({ numerals: [...ch.numerals], text: ch.text })),
  });

  it("it opens as a numbered row and an unnumbered one", () => {
    expect(opened.saga_chapters).toEqual([
      { numerals: [1], text: "One." },
      { numerals: [], text: "Eleven." },
    ]);
  });

  it("untouched: the stored text, and NO rows written beside it", () => {
    // `face_content` is what the renderers read first; chapter I alone
    // there would take chapter XI off the card on a retitle.
    expect(submittedRulesOf("saga", opened, editOf(opened))).toEqual({
      rulesText: TEXT,
      faceContent: null,
      keepsStored: true,
    });
  });

  it("…a stored face_content is kept as it is", () => {
    const stored = { v: 1 as const, saga: { intro: null, chapters: [{ numerals: [1], text: "One." }] } };
    expect(submittedRulesOf("saga", opened, { opened, storedFaceContent: stored })).toEqual({
      rulesText: TEXT,
      faceContent: stored,
      // …by not being sent at all.
      keepsStored: true,
    });
  });

  it("the unnumbered row removed: an edit — the text follows the rows", () => {
    const now = { ...opened, saga_chapters: [opened.saga_chapters[0]] };
    expect(submittedRulesOf("saga", now, editOf(opened))).toEqual({
      rulesText: "I — One.",
      faceContent: { v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "One." }] } },
    });
  });

  it("the unnumbered row's text edited: an edit too (the row still saves no chapter)", () => {
    const now = { ...opened, saga_chapters: [opened.saga_chapters[0], { numerals: [], text: "Changed." }] };
    expect(submittedRulesOf("saga", now, editOf(opened)).rulesText).toBe("I — One.");
  });

  it("the row given a number: its chapter", () => {
    const now = { ...opened, saga_chapters: [opened.saga_chapters[0], { numerals: [2], text: "Eleven." }] };
    expect(submittedRulesOf("saga", now, editOf(opened)).rulesText).toBe("I — One.\nII — Eleven.");
  });

  it("a new card (no opened values) saves the numbered rows, as before", () => {
    expect(submittedRulesOf("saga", opened).rulesText).toBe("I — One.");
  });
});

// ---------------------------------------------------------------------------
// The #528 follow-up (2026-10-13): rows are written as `face_content` only
// where the server stores them and they draw what the card draws.
// ---------------------------------------------------------------------------

const walkerOpened = (text: string) =>
  values({
    rules_text: text,
    loyalty_abilities: loyaltyFromRulesText(text).map((r) => ({ cost: r.cost ?? "", text: r.text })),
  });
const sagaOpened = (text: string) => {
  const saga = sagaFromRulesText(text);
  return values({
    rules_text: text,
    saga_intro: saga.intro ?? "",
    saga_chapters: saga.chapters.map((ch) => ({ numerals: [...ch.numerals], text: ch.text })),
  });
};

describe("the limits of face_content", () => {
  it("MAX_STRUCTURED_ROWS is the server schema's row count and highest chapter", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ cost: "+1", text: `Row ${i + 1}.` }));
    const ok = (content: unknown) => faceContentSchema.safeParse(content).success;
    expect(ok({ v: 1, loyalty: { abilities: rows(MAX_STRUCTURED_ROWS) } })).toBe(true);
    expect(ok({ v: 1, loyalty: { abilities: rows(MAX_STRUCTURED_ROWS + 1) } })).toBe(false);
    const chapter = (n: number) => ({ v: 1, saga: { chapters: [{ numerals: [n], text: "x" }] } });
    expect(ok(chapter(MAX_STRUCTURED_ROWS))).toBe(true);
    expect(ok(chapter(MAX_STRUCTURED_ROWS + 1))).toBe(false);
  });

  const SEVEN = ["Flying", "+2: a", "+1: b", "0: c", "−1: d", "−3: e", "−8: f"].join("\n");

  it("a seven-line walker, untouched: the stored text and nothing sent beside it", () => {
    const opened = walkerOpened(SEVEN);
    expect(submittedRulesOf("planeswalker", opened, editOf(opened))).toEqual({
      rulesText: SEVEN,
      faceContent: null,
      keepsStored: true,
    });
    expect(structuredRowsUntouched("planeswalker", opened, opened)).toBe(true);
  });

  it("…edited (and on a new card): plain text that parses back into the rows", () => {
    const opened = walkerOpened(SEVEN);
    const now = {
      ...opened,
      loyalty_abilities: opened.loyalty_abilities.map((r, i) => (i === 1 ? { ...r, text: "A" } : r)),
    };
    const out = submittedRulesOf("planeswalker", now, editOf(opened));
    expect(out).toEqual({ rulesText: "Flying\n+2: A\n+1: b\n0: c\n-1: d\n-3: e\n-8: f", faceContent: null });
    expect(loyaltyFromRulesText(out.rulesText).map((r) => r.text)).toEqual(["Flying", "A", "b", "c", "d", "e", "f"]);
    expect(submittedRulesOf("planeswalker", opened).faceContent).toBeNull();
    expect(structuredRowsSaveAsText("planeswalker", now)).toBe(true);
    expect(structuredRowsSaveAsText("planeswalker", walkerOpened("+1: a\n-1: b"))).toBe(false);
  });

  it("a saga with a chapter VII, or seven rows: untouched stays stored, edited saves as text", () => {
    const sevenRows = ["I", "II", "III", "IV", "V", "VI", "I, II"].map((m) => `${m} — x`).join("\n");
    for (const text of ["I — a\nVII — g", sevenRows]) {
      const opened = sagaOpened(text);
      expect(submittedRulesOf("saga", opened, editOf(opened))).toEqual({
        rulesText: text,
        faceContent: null,
        keepsStored: true,
      });
      expect(structuredRowsSaveAsText("saga", opened)).toBe(true);
      const now = { ...opened, saga_intro: "(Intro.)" };
      const out = submittedRulesOf("saga", now, editOf(opened));
      expect(out.faceContent).toBeNull();
      expect(out.keepsStored).toBeUndefined();
      expect(sagaFromRulesText(out.rulesText)).toEqual({
        intro: "(Intro.)",
        chapters: opened.saga_chapters.map((ch) => ({ numerals: ch.numerals, text: ch.text })),
      });
    }
    expect(structuredRowsSaveAsText("saga", sagaOpened("I — a\nVI — b"))).toBe(false);
  });

  it("rows that would draw another card than the stored text does are not written on a retitle", () => {
    for (const text of ["II, I — Both.\nIII — c", "I, XI — Both.\nII — b"]) {
      const opened = sagaOpened(text);
      expect(submittedRulesOf("saga", opened, editOf(opened))).toEqual({
        rulesText: text,
        faceContent: null,
        keepsStored: true,
      });
    }
  });
});

describe("the saga rows the form asks a chapter number for", () => {
  const XI = sagaOpened("I — One.\nXI — Eleven.");
  it("none on an untouched edit", () => {
    expect(sagaRowsNeedingNumber("saga", XI, XI)).toEqual([]);
  });
  it("the unnumbered row once anything was edited, and on a new card", () => {
    const now = { ...XI, saga_chapters: [{ numerals: [1], text: "Changed." }, XI.saga_chapters[1]] };
    expect(sagaRowsNeedingNumber("saga", now, XI)).toEqual([1]);
    expect(sagaRowsNeedingNumber("saga", XI)).toEqual([1]);
  });
  it("alone: only once its text (or the intro) no longer reads as the hidden text", () => {
    const only = sagaOpened("XI — Eleven.");
    expect(sagaRowsNeedingNumber("saga", only)).toEqual([]);
    expect(sagaRowsNeedingNumber("saga", { ...only, saga_chapters: [{ numerals: [], text: "Changed." }] })).toEqual([0]);
    expect(sagaRowsNeedingNumber("saga", { ...only, saga_intro: "(Typed.)" })).toEqual([0]);
    // A new saga typed here: no hidden text to keep.
    expect(sagaRowsNeedingNumber("saga", values({ saga_chapters: [{ numerals: [], text: "Draw." }] }))).toEqual([0]);
  });
  it("never a row without a text, never another kind", () => {
    expect(sagaRowsNeedingNumber("saga", values({ saga_chapters: [{ numerals: [], text: " " }] }))).toEqual([]);
    expect(sagaRowsNeedingNumber("creature", XI)).toEqual([]);
  });
});
