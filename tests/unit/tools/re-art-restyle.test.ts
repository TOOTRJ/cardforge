import { describe, expect, it } from "vitest";
import {
  REART_DEFAULT_METHOD,
  REART_METHODS,
  REART_METHOD_HINTS,
  REART_METHOD_LABELS,
  REART_MODEL_IDS,
  REART_MODEL_NOT_YOURS,
  REART_NO_ART_COPY,
  REART_PLAIN_CLOSING_LINE,
  REART_PROMPT_BODY_MAX,
  REART_RESTYLE_LEAD,
  buildReartPrompt,
  reartArtPrompt,
  reartBodyMaxOf,
  reartMethodVerb,
  reartOwnSourceArt,
  reartRunSchema,
  reartStyleBlock,
  reartWordingOf,
} from "@/lib/tools/re-art/model";
import { exactArtPromptLadder } from "@/lib/ai/art-prompt-safety";
import { withFullyClothedLine } from "@/lib/ai/image-gen";

// ---------------------------------------------------------------------------
// Re-art deck — a picture that starts from the card's own ART (ReartMethod
// "restyle", migration 0212; for testing, like the model picker): the real
// card's art on Scryfall, or — a card of the maker's own with no printing —
// the art it had before Re-art, repainted in the deck's style.
//
//   * The prompt goes WITH the picture: it opens with what to do with it
//     (keep every figure and pose; leave out any signature), says the deck's
//     look — or the maker's own words — and ends on the plain closing line.
//     The card's name, type and text are left out: the picture is the
//     subject. Always the plain wording, whichever model.
//   * A model that reads a shorter prompt (Kontext) still reads the lines
//     that are always added.
//   * A card of the maker's own starts from its art BEFORE Re-art — never
//     from a picture Re-art painted.
// ---------------------------------------------------------------------------

const STYLE = { preset: "storybook", theme: "a goblin warren at dusk" };
const KRENKO = {
  title: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  rulesText: "{T}: Create X 1/1 red Goblin creature tokens.",
  flavorText: '"Who\'s the boss?"',
};
const restyle = (style: Parameters<typeof reartArtPrompt>[1], words?: Parameters<typeof reartArtPrompt>[2], model: string | null = null) => {
  const { framing, bodyMax } = reartWordingOf(model, "restyle");
  return reartArtPrompt(KRENKO, style, words, framing, bodyMax, "restyle");
};

describe("what a picture starts from", () => {
  it("is the prompt alone (the default, what the tool always did) or the card's own art", () => {
    expect(REART_METHODS).toEqual(["paint", "restyle"]);
    expect(REART_DEFAULT_METHOD).toBe("paint");
    expect(REART_METHOD_LABELS).toEqual({ paint: "The prompt alone", restyle: "The card's own art" });
    expect(REART_METHOD_HINTS.restyle).toMatch(/real card's art on Scryfall/);
    expect(REART_METHOD_HINTS.restyle).toMatch(/the art it had before Re-art/);
    expect(reartMethodVerb("restyle")).toBe("Restyled");
    expect(reartMethodVerb("paint")).toBe("Painted");
    expect(reartMethodVerb(null)).toBe("Painted");
  });

  it("a run's request takes it, and is from the prompt alone when it names none", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(reartRunSchema.parse({ deckId: id }).method).toBe("paint");
    expect(reartRunSchema.parse({ deckId: id, method: "restyle" }).method).toBe("restyle");
    for (const method of ["Restyle", "art", "", 1, null]) expect(reartRunSchema.safeParse({ deckId: id, method }).success).toBe(false);
  });

  it("the sentence a run without the right to choose is told covers it", () => {
    expect(REART_MODEL_NOT_YOURS).toMatch(/what a picture starts from/);
    expect(REART_MODEL_NOT_YOURS).toMatch(/testers/);
    expect(REART_MODEL_NOT_YOURS).toMatch(/Nothing was painted or charged/);
  });
});

describe("a restyle's wording", () => {
  it("is the plain wording on EVERY model — FLUX.2's own included — and its opening lines count against the body", () => {
    for (const id of REART_MODEL_IDS) {
      const { framing, bodyMax } = reartWordingOf(id, "restyle");
      expect(framing).toBe("plain");
      expect(bodyMax).toBe(reartBodyMaxOf(id) - REART_RESTYLE_LEAD.length - 1);
    }
    // A picture painted from the prompt keeps each model's own wording and limit.
    expect(reartWordingOf("auto", "paint")).toEqual({ framing: "flux2", bodyMax: REART_PROMPT_BODY_MAX });
    expect(reartWordingOf("bfl/flux-kontext-pro")).toEqual({ framing: "plain", bodyMax: 1400 });
  });

  it("opens by saying what to do with the picture: keep every figure and pose, leave out any signature", () => {
    expect(REART_RESTYLE_LEAD).toMatch(/^Repaint this exact picture in a new art style\./);
    expect(REART_RESTYLE_LEAD).toMatch(/Keep every character and object, their poses and the composition/);
    expect(REART_RESTYLE_LEAD).toMatch(/clearly the same picture/);
    expect(REART_RESTYLE_LEAD).toMatch(/Remove any signature, watermark or lettering/);
  });
});

describe("a restyle's prompt", () => {
  it("the template: the opening, the deck's look, the closing line — and nothing of the card's name, type or text", () => {
    const prompt = restyle(STYLE);
    expect(prompt).toBe(`${REART_RESTYLE_LEAD} ${reartStyleBlock(STYLE, "plain")} ${REART_PLAIN_CLOSING_LINE}`);
    expect(prompt).not.toMatch(/Krenko|Goblin Warrior|Create X|boss|Trading-card|Fantasy illustration|NO frame/);
  });

  it("is the same on every model: the picture is the subject, and the wording never follows the model", () => {
    const prompts = new Set(REART_MODEL_IDS.map((id) => restyle(STYLE, null, id)));
    expect(prompts.size).toBe(1);
  });

  it("a card's own words say what changes in it, before the deck's look; “only these words” leaves the look out", () => {
    expect(restyle(STYLE, { text: "the goblins wear party hats", only: false })).toBe(
      `${REART_RESTYLE_LEAD} the goblins wear party hats. ${reartStyleBlock(STYLE, "plain")} ${REART_PLAIN_CLOSING_LINE}`,
    );
    expect(restyle(STYLE, { text: "Make it a woodcut", only: true })).toBe(`${REART_RESTYLE_LEAD} Make it a woodcut. ${REART_PLAIN_CLOSING_LINE}`);
  });

  it("the maker's own deck prompt is the instruction, its braces filled in (unquoted) for the card", () => {
    const own = { ...STYLE, mode: "custom" as const, prompt: "Turn it into a neon city night, with {name} lit in magenta. {flavor}" };
    expect(restyle(own)).toBe(
      `${REART_RESTYLE_LEAD} Turn it into a neon city night, with Krenko, Mob Boss lit in magenta. Who's the boss? ${REART_PLAIN_CLOSING_LINE}`,
    );
    // The card's own words stand where {card} does — or first, with none.
    const withCard = { ...STYLE, mode: "custom" as const, prompt: "A gouache painting: {card}" };
    expect(restyle(withCard, { text: "everyone is asleep", only: false })).toBe(
      `${REART_RESTYLE_LEAD} A gouache painting: everyone is asleep. ${REART_PLAIN_CLOSING_LINE}`,
    );
  });

  it("{card} on a card with no words of its own is “the same subject” — never its name and type (a famous name was redrawn from memory)", () => {
    // The starter prompt ("{card}. <the look>") and any prompt written for a picture from scratch.
    const starter = { ...STYLE, mode: "custom" as const, prompt: `{card}. ${reartStyleBlock(STYLE, "plain")}` };
    expect(restyle(starter)).toBe(`${REART_RESTYLE_LEAD} the same subject. ${reartStyleBlock(STYLE, "plain")} ${REART_PLAIN_CLOSING_LINE}`);
    const oil = { ...STYLE, mode: "custom" as const, prompt: "An oil painting of {card}, candle-lit" };
    expect(restyle(oil)).toBe(`${REART_RESTYLE_LEAD} An oil painting of the same subject, candle-lit. ${REART_PLAIN_CLOSING_LINE}`);
    expect(restyle(oil)).not.toMatch(/Krenko|Goblin Warrior/);
    // From the prompt alone it is still the card's name and type.
    expect(reartArtPrompt(KRENKO, oil, null, "plain")).toContain("An oil painting of Krenko, Mob Boss, a Legendary Creature — Goblin Warrior, candle-lit.");
  });

  it("a long prompt is cut — said as cut — so that even the model that reads least reads the lines always added", () => {
    const long = { ...STYLE, mode: "custom" as const, prompt: Array.from({ length: 30 }, () => "{card} in thick oil paint, candle-lit").join(", ") };
    const kontext = reartWordingOf("bfl/flux-kontext-pro", "restyle");
    const { prompt, cut } = buildReartPrompt(KRENKO, long, null, kontext.framing, kontext.bodyMax, "restyle");
    expect(cut).toBe(true);
    expect(prompt.startsWith(REART_RESTYLE_LEAD)).toBe(true);
    expect(prompt.endsWith(REART_PLAIN_CLOSING_LINE)).toBe(true);
    // Everything Kontext is sent, on either rung, at the image door: inside 512 tokens (about 1,800 characters).
    for (const rung of exactArtPromptLadder(prompt)) {
      const sent = withFullyClothedLine(rung, 4000);
      expect(sent.length).toBeLessThanOrEqual(1800);
      expect(sent.endsWith("it is fully clothed.")).toBe(true);
    }
    // On a model with no limit of its own the same prompt is sent whole.
    const other = reartWordingOf("spacexai/grok-imagine-image-2.0", "restyle");
    expect(buildReartPrompt(KRENKO, long, null, other.framing, other.bodyMax, "restyle").cut).toBe(false);
  });

  it("a picture painted from the prompt is untouched by all this: the method defaults to it", () => {
    for (const framing of ["flux2", "plain"] as const) {
      expect(buildReartPrompt(KRENKO, STYLE, null, framing)).toEqual(buildReartPrompt(KRENKO, STYLE, null, framing, REART_PROMPT_BODY_MAX, "paint"));
      expect(reartArtPrompt(KRENKO, STYLE, null, framing)).not.toContain(REART_RESTYLE_LEAD);
    }
  });
});

describe("the art a card of the maker's own is restyled from", () => {
  const ART = (name: string) => `https://x.supabase.co/storage/v1/object/public/card-art/u1/${name}`;

  it("is the art on the card — unless that is a picture Re-art painted: then the art it had before", () => {
    // Never painted: the card's own art.
    expect(reartOwnSourceArt(ART("mine.png"), null)).toBe(ART("mine.png"));
    // Showing Re-art's picture: the art to put back, never the AI picture
    // (a re-roll would restyle a restyle).
    expect(reartOwnSourceArt(ART("ai-1.jpg"), { artUrl: ART("ai-1.jpg"), previousArtUrl: ART("mine.png") })).toBe(ART("mine.png"));
    // Painted once, then given other art by hand: that art is the card's own now.
    expect(reartOwnSourceArt(ART("new.png"), { artUrl: ART("ai-1.jpg"), previousArtUrl: ART("mine.png") })).toBe(ART("new.png"));
    // Given its own art back from the tool (the row keeps no picture).
    expect(reartOwnSourceArt(ART("mine.png"), { artUrl: null, previousArtUrl: null })).toBe(ART("mine.png"));
  });

  it("is nothing for a card with no art, or one Re-art painted that had none before", () => {
    expect(reartOwnSourceArt(null, null)).toBeNull();
    expect(reartOwnSourceArt(undefined, undefined)).toBeNull();
    expect(reartOwnSourceArt(ART("ai-1.jpg"), { artUrl: ART("ai-1.jpg"), previousArtUrl: null })).toBeNull();
    expect(REART_NO_ART_COPY).toMatch(/No art of its own to restyle/);
    expect(REART_NO_ART_COPY).toMatch(/paint it from the prompt instead/);
  });
});
