import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// TODO 4.27a, PR 3 — the design ENGINE with the model mocked (no generation
// is ever run): what the designer and the judge are told, what happens to a
// Spacecraft that comes back out of shape, and what a per-field fill and the
// ideas dialog hand back. `ai`'s generateObject is the one stub; the prompts,
// the lint, the judge loop, the autofix, designCardFill and
// generateCardIdeas are the real ones.
// ---------------------------------------------------------------------------

type Call = { system: string; prompt: string; model: string };
const s = vi.hoisted(() => ({
  calls: [] as { system: string; prompt: string; model: string }[],
  /** One answer per call, in order: the design, then the judge. `null` = the
   *  call throws (the judge is best-effort). */
  answers: [] as (unknown[] | null)[],
}));

vi.mock("ai", () => ({
  generateObject: async (args: Call) => {
    s.calls.push(args);
    const cards = s.answers.shift();
    if (cards === null) throw new Error("model unavailable");
    return { object: { cards: cards ?? [] } };
  },
}));
vi.mock("@/lib/ai/provider", () => ({ designModel: () => "test/design", judgeModel: () => "test/judge" }));

import { designCards } from "@/lib/ai/card-design";
import { designCardFill } from "@/lib/ai/card-fill";
import { generateCardIdeas } from "@/lib/ai/card-ideas";
import { lintCardDesign } from "@/lib/ai/mtg-rules";
import { parseStationText } from "@/lib/cards/station";
import { stationReminder } from "@/lib/creator/station-rows";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

const LINE = (n: number | null, word: "Spacecraft" | "Planet" = "Spacecraft") => stationReminder(word, n);

const ship = (over: Record<string, unknown> = {}) => ({
  title: "Halcyon Driftbarge",
  cost: "{2}{U}",
  card_type: "artifact",
  supertype: null,
  subtypes: ["Spacecraft"],
  rarity: "rare",
  color_identity: ["blue"],
  rules_text: `${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying`,
  flavor_text: null,
  power: "4",
  toughness: "5",
  loyalty: null,
  defense: null,
  art_prompt: "A teal barge drifting above a ringed planet, cold starlight.",
  ...over,
});
const dragon = (over: Record<string, unknown> = {}) =>
  ship({ title: "Emberwake Tyrant", cost: "{3}{R}{R}", card_type: "creature", subtypes: ["Dragon"], color_identity: ["red"], rules_text: "Flying, haste", ...over });

const TICKED = new Set([frameComboKey("m15artifact", "u"), frameComboKey("m15station", "u"), frameComboKey("m15", "u")]);
const landing = (card: ReturnType<typeof ship>) =>
  resolveGeneratedFrame({
    cardType: card.card_type as never,
    requested: "random",
    colorIdentity: card.color_identity as never,
    verifiedKeys: TICKED,
    face: { cardType: card.card_type as never, supertype: card.supertype, subtypes: card.subtypes, title: card.title, rulesText: card.rules_text, power: card.power, toughness: card.toughness },
    random: () => 0.99,
  });

beforeEach(() => {
  s.calls = [];
  s.answers = [];
});

describe("the designer and the judge are told print's convention", () => {
  it("the design call's system prompt carries the Station line and the tier grammar; the judge's keeps the shape", async () => {
    s.answers = [[ship({ rules_text: "Flying" })], [ship()]];
    await designCards({ slots: [{ cardType: "artifact" }] });
    const [design, judge] = s.calls;
    expect(design!.model).toBe("test/design");
    expect(design!.system).toContain("SPACECRAFT AND PLANETS");
    expect(design!.system).toContain("on this Spacecraft. Station only as a sorcery. It's an artifact creature at N+.)");
    expect(design!.system).toContain('"N+ | text"');
    expect(design!.system).toContain("Halcyon Driftbarge");
    expect(judge!.model).toBe("test/judge");
    expect(judge!.system).toContain("keeps its tier shape");
  });
});

describe("AI card / deck generation: a Spacecraft comes out in the printed shape", () => {
  it("a well-formed Spacecraft passes untouched — no judge call", async () => {
    s.answers = [[ship()]];
    const { cards, report } = await designCards({ slots: [{}] });
    expect(s.calls).toHaveLength(1);
    expect(report.judged).toBe(false);
    expect(cards[0]!.rules_text).toBe(ship().rules_text);
    expect(landing(cards[0] as never)).toBe("m15station");
  });

  it("MAIN'S CASE — a tierless Spacecraft: the lint names it, the judge is asked, and its fix is what saves", async () => {
    const tierless = ship({ rules_text: "Flying\nWhen this Spacecraft enters, draw a card." });
    s.answers = [[tierless], [ship()]];
    const { cards, report } = await designCards({ slots: [{}] });
    expect(report.judged).toBe(true);
    expect(s.calls[1]!.prompt).toContain('add one to three lines "N+ | text"');
    expect(s.calls[1]!.prompt).toContain("its power/toughness is printed on the last one");
    const text = parseStationText(cards[0]!.rules_text, true);
    expect(text.tiers.map((tier) => [tier.threshold, tier.pt])).toEqual([
      [2, false],
      [9, true],
    ]);
    expect(lintCardDesign(cards[0]!).errors).toEqual([]);
    expect(landing(cards[0] as never)).toBe("m15station");
  });

  it("the judge fails too: nothing invents a tier — and the card never lands on the station frame", async () => {
    const tierless = ship({ rules_text: "Flying\nWhen this Spacecraft enters, draw a card." });
    s.answers = [[tierless], null];
    const { cards, report } = await designCards({ slots: [{}] });
    expect(report.judged).toBe(true);
    expect(report.autofixed).toEqual([0]);
    expect(cards[0]!.rules_text).toBe(tierless.rules_text);
    // Main: m15station, no tier, the 4/5 not drawn. Now: the Artifact frame,
    // where the P/T has its corner.
    expect(landing(cards[0] as never)).toBe("m15artifact");
  });

  it("a near-miss the judge leaves alone is repaired by machine: tier lines, order, the Station line", async () => {
    const rough = ship({ rules_text: "When this Spacecraft enters, scry 2.\nStation\n9+: Flying, vigilance\n2+ — Draw a card." });
    s.answers = [[rough], [rough]];
    const { cards, report } = await designCards({ slots: [{}] });
    expect(report.autofixed).toEqual([0]);
    expect(cards[0]!.rules_text).toBe(`When this Spacecraft enters, scry 2.\n${LINE(9)}\n2+ | Draw a card.\n9+ | Flying, vigilance`);
    expect(lintCardDesign(cards[0]!).errors).toEqual([]);
    expect(landing(cards[0] as never)).toBe("m15station");
  });

  it("a Planet: tiers, its own Station line, no power / toughness", async () => {
    const planet = ship({
      title: "Evenfall",
      cost: "—",
      card_type: "land",
      subtypes: ["Planet"],
      color_identity: ["green"],
      rules_text: "This land enters tapped.\n{T}: Add {G}.\nStation\n12+: {G}, {T}: Add {G}{G}.",
      power: "2",
      toughness: "2",
    });
    s.answers = [[planet], [planet]];
    const { cards } = await designCards({ slots: [{ cardType: "land" }] });
    expect(cards[0]).toMatchObject({ power: null, toughness: null });
    expect(cards[0]!.rules_text).toBe(`This land enters tapped.\n{T}: Add {G}.\n${LINE(null, "Planet")}\n12+ | {G}, {T}: Add {G}{G}.`);
    expect(lintCardDesign(cards[0]!).errors).toEqual([]);
  });

  it("a card that is no Spacecraft is designed exactly as before: no finding, no judge, no rewrite", async () => {
    s.answers = [[dragon(), ship({ subtypes: ["Vehicle"], rules_text: "Flying\nCrew 2", color_identity: ["blue"] })]];
    const { cards, report } = await designCards({ slots: [{}, {}] });
    expect(s.calls).toHaveLength(1);
    expect(report).toEqual({ judged: false, autofixed: [], warnings: [] });
    expect(cards.map((card) => card.rules_text)).toEqual(["Flying, haste", "Flying\nCrew 2"]);
  });
});

describe("the ideas dialog: an idea for a Spacecraft carries its tiers", () => {
  it("each idea goes through the same lint, judge and autofix", async () => {
    const rough = ship({ rules_text: "Station\n7+: Flying" });
    s.answers = [[dragon(), rough, ship()], [rough]];
    const ideas = await generateCardIdeas({ theme: "void traders" });
    expect(ideas).toHaveLength(3);
    expect(ideas[0]!.rules_text).toBe("Flying, haste");
    expect(ideas[1]!.rules_text).toBe(`${LINE(7)}\n7+ | Flying`);
    for (const idea of ideas.slice(1)) expect(parseStationText(idea.rules_text).tiers.length).toBeGreaterThan(0);
  });
});

describe("the per-field fill on a station card", () => {
  const locked = { title: "Halcyon Driftbarge", card_type: "artifact" as const, subtypes: ["Spacecraft"], color_identity: ["blue" as const], power: "4", toughness: "5" };

  it("the model dropped the subtype from ITS card: the text is still put in shape for the card the form holds", async () => {
    // The engine lints the model's card (a plain artifact here: no finding);
    // the fill writes the text onto the form's Spacecraft.
    const drifted = ship({ subtypes: [], power: null, toughness: null, rules_text: "Station\n9+: Flying\n2+: Scry 1." });
    s.answers = [[drifted], [drifted]];
    const { fields } = await designCardFill({ want: ["rules_text"], locked, steer: {} });
    expect(fields).toEqual({ rules_text: `${LINE(9)}\n2+ | Scry 1.\n9+ | Flying` });
  });

  it("a tier left empty is the only line written; the designer is told which", async () => {
    const station_text = `When this Spacecraft enters,  scry 2.\n${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | `;
    s.answers = [[ship({ rules_text: `Rewritten top.\n${LINE(9)}\n2+ | Rewritten tier.\n9+ | Flying, vigilance` })]];
    const { fields } = await designCardFill({ want: ["rules_text"], locked: { ...locked, station_text }, steer: {} });
    expect(s.calls[0]!.prompt).toContain("Write ONLY the text of tier 9+");
    expect(s.calls[0]!.prompt).toContain("When this Spacecraft enters,  scry 2.");
    expect(fields.rules_text).toBe(`When this Spacecraft enters,  scry 2.\n${LINE(9)}\n2+ | Whenever you cast an artifact spell, scry 1.\n9+ | Flying, vigilance`);
  });

  it("no gap: a new text, in shape, and the designer is told the layout it had", async () => {
    const station_text = `${LINE(9)}\n2+ | Scry 1.\n9+ | Flying`;
    s.answers = [[ship({ rules_text: `${LINE(8)}\n3+ | Draw a card.\n8+ | Flying, trample` })]];
    const { fields } = await designCardFill({ want: ["rules_text"], locked: { ...locked, station_text }, steer: {} });
    expect(s.calls[0]!.prompt).toContain("laid out in tiers (2+, 9+)");
    expect(fields.rules_text).toBe(`${LINE(8)}\n3+ | Draw a card.\n8+ | Flying, trample`);
  });

  it("a fill that does not write the rules text never touches it; nor does any fill of another card", async () => {
    s.answers = [[ship({ title: "New Name" })]];
    expect((await designCardFill({ want: ["title"], locked, steer: {} })).fields).toEqual({ title: "New Name" });
    s.answers = [[dragon({ rules_text: "Flying\n3+ | not a tier on a Dragon" })]];
    const fill = await designCardFill({ want: ["rules_text"], locked: { card_type: "creature", subtypes: ["Dragon"] }, steer: {} });
    expect(fill.fields).toEqual({ rules_text: "Flying\n3+ | not a tier on a Dragon" });
    expect(s.calls.at(-1)!.prompt).not.toContain("tier");
  });

  it("the type is generated too: the shape follows the DESIGNED identity", async () => {
    s.answers = [[ship({ rules_text: "Station\n9+: Flying" })], [ship({ rules_text: "Station\n9+: Flying" })]];
    const { fields } = await designCardFill({ want: ["card_type", "rules_text", "stats"], locked: {}, steer: { card_type: "artifact" } });
    expect(fields).toMatchObject({ card_type: "artifact", subtypes: ["Spacecraft"], rules_text: `${LINE(9)}\n9+ | Flying`, power: "4", toughness: "5" });
  });
});
