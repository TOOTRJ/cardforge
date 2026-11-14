import { describe, expect, it } from "vitest";
import {
  EMPTY_REART_STYLE,
  REART_IP_BLOCKED_COPY,
  REART_IP_BLOCKED_WITH_PICTURE_COPY,
  REART_IP_NAME_MAX,
  REART_MODEL_IDS,
  REART_PLAIN_CLOSING_LINE,
  REART_PROMPT_BODY_MAX,
  REART_REFERENCE_BLOCKED_COPY,
  REART_REFERENCE_LEAD,
  REART_REFERENCE_WITH_RESTYLE,
  REART_RESTYLE_LEAD,
  buildReartPrompt,
  cleanReartIpName,
  normalizeReartStyle,
  reartArtPrompt,
  reartBlockedCopy,
  reartBodyMaxOf,
  reartClosingLine,
  reartIpLine,
  reartIpStatement,
  reartRunSchema,
  reartStyleBlock,
  reartStyleProblem,
  reartStyleSchema,
  reartWordingOf,
  sameReartStyle,
  sameReartStyleFields,
} from "@/lib/tools/re-art/model";
import { exactArtPromptLadder } from "@/lib/ai/art-prompt-safety";
import { withFullyClothedLine } from "@/lib/ai/image-gen";

// ---------------------------------------------------------------------------
// Re-art deck — a deck that names a LICENSED PROPERTY, and a deck's
// REFERENCE PICTURE (migration 0214; owner 2026-11-13: the maker
// self-attests, and may say it in words or with a picture).
//
//   * Both are part of the deck's LOOK: a style with either is another
//     style (a new version), and a style with neither is, key for key, what
//     it always was — every stored style, plan and prompt before 0214 reads
//     the same.
//   * The property adds ONE line to every prompt, before the closing line;
//     a reference picture makes the prompt open with what the picture is
//     for, in the plain wording whatever the model.
//   * The sentence the maker confirms names the property and is theirs.
// ---------------------------------------------------------------------------

const STYLE = { preset: "storybook", theme: "a goblin warren at dusk" };
const REFERENCE = "https://x.supabase.co/storage/v1/object/public/set-covers/11111111-1111-4111-8111-111111111111/ref.webp";
const KRENKO = {
  title: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  rulesText: "{T}: Create X 1/1 red Goblin creature tokens.",
  flavorText: '"Who\'s the boss?"',
};

describe("the property's name", () => {
  it("is one clean line: no quotation marks, no control characters, at most the limit", () => {
    expect(cleanReartIpName("  Emberfall   Chronicles ")).toBe("Emberfall Chronicles");
    expect(cleanReartIpName('"Emberfall"\n“Chronicles”')).toBe("Emberfall Chronicles");
    expect(cleanReartIpName("Ember\u0000fall\tChronicles")).not.toMatch(/[\u0000-\u001f]/);
    expect(cleanReartIpName("x".repeat(400)).length).toBeLessThanOrEqual(REART_IP_NAME_MAX);
    for (const none of [undefined, null, "", "   ", '""']) expect(cleanReartIpName(none)).toBe("");
  });

  it("a name that says nothing is asked for again; no name is no problem", () => {
    expect(reartStyleProblem({ ...STYLE, ipName: "?" })).toBe("Name the licensed property.");
    expect(reartStyleProblem({ ...STYLE, ipName: "Emberfall Chronicles" })).toBeNull();
    expect(reartStyleProblem({ ...STYLE, ipName: "" })).toBeNull();
    expect(reartStyleProblem(STYLE)).toBeNull();
  });
});

describe("a style with a property or a reference picture", () => {
  it("holds them as keys only when set: a style with neither equals what it always was", () => {
    expect(normalizeReartStyle(STYLE)).toEqual({ preset: "storybook", theme: "a goblin warren at dusk", mode: "preset", prompt: "" });
    expect(normalizeReartStyle({ ...STYLE, ipName: "  ", referenceUrl: null })).toEqual(normalizeReartStyle(STYLE));
    expect(normalizeReartStyle({ ...STYLE, ipName: " Emberfall  Chronicles ", referenceUrl: ` ${REFERENCE} ` })).toEqual({
      preset: "storybook",
      theme: "a goblin warren at dusk",
      mode: "preset",
      prompt: "",
      ipName: "Emberfall Chronicles",
      referenceUrl: REFERENCE,
    });
    expect(Object.keys(EMPTY_REART_STYLE)).not.toContain("ipName");
    expect(Object.keys(EMPTY_REART_STYLE)).not.toContain("referenceUrl");
  });

  it("is another LOOK than the same style without — and than the same style with another", () => {
    const named = { ...STYLE, ipName: "Emberfall Chronicles" };
    const pictured = { ...STYLE, referenceUrl: REFERENCE };
    for (const same of [sameReartStyle, sameReartStyleFields]) {
      expect(same(STYLE, named)).toBe(false);
      expect(same(STYLE, pictured)).toBe(false);
      expect(same(named, { ...STYLE, ipName: "Tidewrights" })).toBe(false);
      expect(same(pictured, { ...STYLE, referenceUrl: REFERENCE.replace("ref.webp", "other.webp") })).toBe(false);
      // The same, however it was typed.
      expect(same(named, { ...STYLE, ipName: '  "Emberfall   Chronicles" ' })).toBe(true);
      expect(same(pictured, { ...STYLE, referenceUrl: REFERENCE })).toBe(true);
      expect(same(STYLE, { ...STYLE, ipName: "", referenceUrl: null })).toBe(true);
    }
  });

  it("a request takes both, and nothing else new", () => {
    expect(reartStyleSchema.safeParse({ ...STYLE, ipName: "Emberfall Chronicles", referenceUrl: REFERENCE }).success).toBe(true);
    expect(reartStyleSchema.safeParse({ ...STYLE, ipName: "x".repeat(REART_IP_NAME_MAX * 2 + 1) }).success).toBe(false);
    expect(reartStyleSchema.safeParse({ ...STYLE, referenceUrl: "x".repeat(601) }).success).toBe(false);
    expect(reartStyleSchema.safeParse({ ...STYLE, licence: true }).success).toBe(false);
  });
});

describe("what the maker confirms", () => {
  it("names the property, says the rights are theirs to use and publish, and that the responsibility is theirs", () => {
    const sentence = reartIpStatement("Emberfall Chronicles");
    expect(sentence).toBe(
      "I hold the rights to Emberfall Chronicles, or its rights holder's permission, to make art of it with AI and to publish that art on PipGlyph. I am responsible for this, and PipGlyph may ask me for proof and remove the art.",
    );
    // The record's own limit (0214: 1 to 1000 characters), at the longest name.
    expect(reartIpStatement("x".repeat(400)).length).toBeLessThanOrEqual(1000);
    expect(reartIpStatement("")).toContain("this property");
  });

  it("a run's request carries the confirmation as a boolean, and only as one", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(reartRunSchema.parse({ deckId: id }).attested).toBeUndefined();
    expect(reartRunSchema.parse({ deckId: id, attested: true }).attested).toBe(true);
    for (const attested of ["yes", 1, null]) expect(reartRunSchema.safeParse({ deckId: id, attested }).success).toBe(false);
  });
});

describe("the property in a prompt", () => {
  const named = { ...STYLE, ipName: "Emberfall Chronicles" };

  it("is one line, before the closing line — the rest of the prompt is what it was, word for word", () => {
    const line = reartIpLine("Emberfall Chronicles");
    expect(line).toBe(
      "Licensed artwork for Emberfall Chronicles: set in its world and painted in its own visual style, with its characters and designs as they are known.",
    );
    expect(reartIpLine("")).toBe("");
    for (const framing of ["flux2", "plain"] as const) {
      const without = reartArtPrompt(KRENKO, STYLE, null, framing);
      const withIt = reartArtPrompt(KRENKO, named, null, framing);
      const closing = reartClosingLine(framing);
      expect(without.endsWith(closing)).toBe(true);
      expect(withIt).toBe(`${without.slice(0, -closing.length)}${line} ${closing}`);
    }
  });

  it("is in the maker's own prompt, a card's own words and a restyle too", () => {
    const line = reartIpLine("Emberfall Chronicles");
    const own = { ...named, mode: "custom" as const, prompt: "{card} in thick oil paint" };
    expect(reartArtPrompt(KRENKO, own, null, "plain")).toContain(`in thick oil paint. ${line} ${REART_PLAIN_CLOSING_LINE}`);
    expect(reartArtPrompt(KRENKO, named, { text: "a goblin king on a throne of scrap", only: true }, "plain")).toBe(
      `a goblin king on a throne of scrap. ${line} ${REART_PLAIN_CLOSING_LINE}`,
    );
    const restyle = reartWordingOf(null, "restyle");
    expect(reartArtPrompt(KRENKO, named, null, restyle.framing, restyle.bodyMax, "restyle")).toBe(
      `${REART_RESTYLE_LEAD} ${reartStyleBlock(STYLE, "plain")} ${line} ${REART_PLAIN_CLOSING_LINE}`,
    );
  });

  it("never pushes the closing line out: a long prompt gives up its own end, said as cut", () => {
    const long = { ...named, ipName: "x".repeat(REART_IP_NAME_MAX), mode: "custom" as const, prompt: Array.from({ length: 60 }, () => "{card} in thick oil paint").join(", ") };
    for (const id of REART_MODEL_IDS) {
      const { framing, bodyMax } = reartWordingOf(id);
      const { prompt, cut } = buildReartPrompt(KRENKO, long, null, framing, bodyMax);
      expect(cut, id).toBe(true);
      expect(prompt.endsWith(`${reartIpLine(long.ipName)} ${reartClosingLine(framing)}`), id).toBe(true);
      // The line's room came out of the body's: the whole prompt is no
      // longer than the model reads (its body, a stop, the closing line).
      expect(prompt.length, id).toBeLessThanOrEqual(Math.min(bodyMax, REART_PROMPT_BODY_MAX) + reartClosingLine(framing).length + 2);
    }
  });
});

describe("a picture painted with the deck's reference picture", () => {
  const pictured = { ...STYLE, referenceUrl: REFERENCE };

  it("is in the plain wording on EVERY model, and its opening lines count against the body", () => {
    for (const id of REART_MODEL_IDS) {
      expect(reartWordingOf(id, "paint", true)).toEqual({ framing: "plain", bodyMax: reartBodyMaxOf(id) - REART_REFERENCE_LEAD.length - 1 });
    }
    // Without one, each model keeps its own wording and limit.
    expect(reartWordingOf("auto", "paint", false)).toEqual({ framing: "flux2", bodyMax: REART_PROMPT_BODY_MAX });
  });

  it("opens by saying what the picture is for — the look, never the composition", () => {
    expect(REART_REFERENCE_LEAD).toMatch(/^Paint a new picture in the visual style of the attached reference picture/);
    // A new scene each time: a deck's cards must not share the reference's room.
    expect(REART_REFERENCE_LEAD).toMatch(/compose a new scene from a new viewpoint/);
    expect(REART_REFERENCE_LEAD).toMatch(/do not reuse its composition or its background/);
  });

  it("the prompt: the opening, the card and the deck's look in plain words, the closing line — whatever wording is asked for", () => {
    const plain = reartArtPrompt(KRENKO, STYLE, null, "plain");
    for (const framing of ["flux2", "plain"] as const) {
      expect(reartArtPrompt(KRENKO, pictured, null, framing)).toBe(`${REART_REFERENCE_LEAD} ${plain}`);
    }
    expect(reartArtPrompt(KRENKO, pictured, null, "flux2")).not.toMatch(/Trading-card|"Krenko/);
    // With a property too: its line before the closing one.
    const both = reartArtPrompt(KRENKO, { ...pictured, ipName: "Emberfall Chronicles" }, null, "flux2");
    expect(both.startsWith(REART_REFERENCE_LEAD)).toBe(true);
    expect(both.endsWith(`${reartIpLine("Emberfall Chronicles")} ${REART_PLAIN_CLOSING_LINE}`)).toBe(true);
  });

  it("the model that reads least still reads the opening and every line always added", () => {
    const long = { ...pictured, ipName: "x".repeat(REART_IP_NAME_MAX), mode: "custom" as const, prompt: Array.from({ length: 60 }, () => "{card} in thick oil paint").join(", ") };
    const kontext = reartWordingOf("bfl/flux-kontext-pro", "paint", true);
    const { prompt, cut } = buildReartPrompt(KRENKO, long, null, kontext.framing, kontext.bodyMax);
    expect(cut).toBe(true);
    expect(prompt.startsWith(REART_REFERENCE_LEAD)).toBe(true);
    expect(prompt.endsWith(REART_PLAIN_CLOSING_LINE)).toBe(true);
    for (const rung of exactArtPromptLadder(prompt)) {
      const sent = withFullyClothedLine(rung, 4000);
      expect(sent.length).toBeLessThanOrEqual(1800);
      expect(sent.endsWith("it is fully clothed.")).toBe(true);
    }
  });

  it("a restyle never takes the reference's opening: the card's own art is the one picture", () => {
    const restyle = reartWordingOf(null, "restyle", true);
    const prompt = reartArtPrompt(KRENKO, pictured, null, restyle.framing, restyle.bodyMax, "restyle");
    expect(prompt.startsWith(REART_RESTYLE_LEAD)).toBe(true);
    expect(prompt).not.toContain(REART_REFERENCE_LEAD);
    expect(REART_REFERENCE_WITH_RESTYLE).toMatch(/can't be used together/);
  });
});

describe("what a declined picture is told", () => {
  it("a deck that names a property: services decline some names whatever licence you hold — and what to try", () => {
    expect(reartBlockedCopy({ ...STYLE, ipName: "Emberfall Chronicles" })).toBe(REART_IP_BLOCKED_COPY);
    expect(REART_IP_BLOCKED_COPY).toMatch(/whatever licence you hold/);
    expect(REART_IP_BLOCKED_COPY).toMatch(/add a reference picture/);
    // It has a picture with it already: never "add a reference picture".
    for (const copy of [
      reartBlockedCopy({ ...STYLE, ipName: "Emberfall Chronicles", referenceUrl: REFERENCE }),
      reartBlockedCopy({ ...STYLE, ipName: "Emberfall Chronicles" }, "restyle"),
    ]) {
      expect(copy).toBe(REART_IP_BLOCKED_WITH_PICTURE_COPY);
      expect(copy).not.toMatch(/add a reference picture/);
    }
  });

  it("a reference picture alone says so; a style with neither keeps the image door's own sentence", () => {
    expect(reartBlockedCopy({ ...STYLE, referenceUrl: REFERENCE })).toBe(REART_REFERENCE_BLOCKED_COPY);
    expect(reartBlockedCopy(STYLE)).toBeNull();
    expect(reartBlockedCopy(STYLE, "restyle")).toBeNull();
    // A restyle never paints with the reference (the two are refused together).
    expect(reartBlockedCopy({ ...STYLE, referenceUrl: REFERENCE }, "restyle")).toBeNull();
  });
});
