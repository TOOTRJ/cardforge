import { describe, expect, it } from "vitest";
import { resolveSagaChapters } from "@/lib/cards/face-content";
import { resolveSagaCreature, splitSagaCreatureText } from "@/lib/cards/saga-creature";

// ---------------------------------------------------------------------------
// TODO 4.5d — the saga creature's text (owner 2026-10-28: no new field): on
// the saga creature body the lines AFTER the last chapter are its second
// box's, as Scryfall's Oracle text sets them; a modal chapter's "•" lines
// stay with their chapter. Every other saga reads its text as before.
// ---------------------------------------------------------------------------

const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after V.)";

describe("splitSagaCreatureText", () => {
  it("FIN #36: the line after chapter V is the box's", () => {
    const text = `${REMINDER}\nI, II, III, IV — Create three 2/2 white Knight creature tokens.\nV — Ultimate End — Other creatures you control get +2/+2 until end of turn.\nIndestructible`;
    expect(splitSagaCreatureText(text)).toEqual({
      railText: `${REMINDER}\nI, II, III, IV — Create three 2/2 white Knight creature tokens.\nV — Ultimate End — Other creatures you control get +2/+2 until end of turn.`,
      creatureText: "Indestructible",
    });
  });

  it("FIC #71: a modal chapter keeps its bullets; the line after them is the box's", () => {
    const text = [
      REMINDER,
      "I, II, III — Choose one at random —",
      "• Combine Powers! — Put three +1/+1 counters on target creature.",
      "• Defense! — Put a shield counter on target creature. You gain 3 life.",
      "Haste",
    ].join("\n");
    const { railText, creatureText } = splitSagaCreatureText(text);
    expect(creatureText).toBe("Haste");
    expect(railText).toContain("• Defense!");
    expect(resolveSagaCreature(null, text).chapters).toHaveLength(1);
  });

  it("a saga creature whose box holds only flavour (FIN #160) has no creature text", () => {
    const text = `${REMINDER}\nI — Chain — Exile the top card of your library.\nII, III — Gestalt Mode — When you next cast a creature spell this turn, it gains haste.`;
    expect(splitSagaCreatureText(text)).toEqual({ railText: text, creatureText: null });
  });

  it("two lines after the chapters are both the box's; blank lines between are dropped", () => {
    const text = `I — Draw a card.\n\nFlying, vigilance\nWard {2}\n`;
    expect(splitSagaCreatureText(text)).toEqual({ railText: "I — Draw a card.", creatureText: "Flying, vigilance\nWard {2}" });
  });

  it("a text with no chapter, or none at all, is all rail", () => {
    expect(splitSagaCreatureText("Flying")).toEqual({ railText: "Flying", creatureText: null });
    expect(splitSagaCreatureText(null)).toEqual({ railText: null, creatureText: null });
    expect(splitSagaCreatureText("")).toEqual({ railText: "", creatureText: null });
  });
});

describe("resolveSagaCreature", () => {
  it("draws the stored rows first, and the box from the text after the chapters", () => {
    const faceContent = { v: 1 as const, saga: { intro: REMINDER, chapters: [{ numerals: [1, 2], text: "Draw a card." }] } };
    const text = `${REMINDER}\nI, II — Draw a card.\nFlying`;
    expect(resolveSagaCreature(faceContent, text)).toEqual({ ...resolveSagaChapters(faceContent, text), creatureText: "Flying" });
  });

  it("parses a plain text's chapters WITHOUT the box's lines (the plain saga appends them to the last chapter)", () => {
    const text = `I — Draw a card.\nII — Scry 2.\nMenace`;
    expect(resolveSagaCreature(null, text).chapters).toEqual([
      { marker: "I", text: "Draw a card." },
      { marker: "II", text: "Scry 2." },
    ]);
    expect(resolveSagaChapters(null, text).chapters.at(-1)!.text).toBe("Scry 2. Menace");
  });
});
