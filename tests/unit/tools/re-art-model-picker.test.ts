import { describe, expect, it } from "vitest";
import {
  REART_DEFAULT_MODEL,
  REART_MODELS,
  REART_MODEL_IDS,
  REART_NO_FRAME_LINE,
  REART_PLAIN_CLOSING_LINE,
  buildReartPrompt,
  canPickReartModel,
  reartArtPrompt,
  reartCardLine,
  reartClosingLine,
  reartGatewayModel,
  reartModelLabel,
  reartModelOf,
  reartRunSchema,
  reartStyleBlock,
} from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's model picker (migration 0211; lib/tools/re-art/model.ts).
//
//   * The list is the TOOL's: Automatic (what every other tool paints with)
//     and five gateway models — the three the owner asked for, plus Grok
//     Imagine 2.0 and Gemini 3.1 Flash Image. No OpenAI image model (the
//     image door has no OpenAI path). A run's model is one of the list's ids
//     or the run is refused: never a user's free text.
//   * Who painted is said in words wherever a card shows it.
//   * A model other than FLUX.2 is sent the same prompt in PLAINER words.
//     FLUX.2's wording ("Trading-card illustration of “Name”…", a quoted
//     flavour line, "NO frame, NO text") made FLUX.1 Kontext and Grok
//     Imagine paint a card frame with the title and flavour text in it, and
//     Gemini a page with a white margin (tried on the dev key, 2026-11-13).
//     FLUX.2's wording itself is, character for character, what it was.
// ---------------------------------------------------------------------------

const STYLE = { preset: "storybook", theme: "a goblin warren at dusk" };
const LOOK =
  "Rendered strictly in storybook style. Art direction: a storybook illustration with warm gouache color, soft outlines and a whimsical charm.";
const KRENKO = {
  title: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  rulesText: "{T}: Create X 1/1 red Goblin creature tokens.",
};

describe("the models a run may be painted with", () => {
  it("are Automatic and five gateway models, Automatic first and the default", () => {
    expect(REART_MODEL_IDS).toEqual([
      "auto",
      "bfl/flux-2-pro",
      "bfl/flux-kontext-pro",
      "spacexai/grok-imagine-image",
      "spacexai/grok-imagine-image-2.0",
      "google/gemini-3.1-flash-image",
    ]);
    expect(REART_DEFAULT_MODEL).toBe("auto");
    expect(REART_MODELS[0]).toMatchObject({ id: "auto", label: "Automatic" });
    // Every one has a name and a line of its own.
    expect(new Set(REART_MODELS.map((model) => model.label)).size).toBe(REART_MODELS.length);
    for (const model of REART_MODELS) expect(model.hint.length).toBeGreaterThan(10);
  });

  it("hold no OpenAI image model, and Grok under the id the gateway lists it by", () => {
    for (const id of REART_MODEL_IDS) expect(id).not.toMatch(/^openai\//);
    expect(REART_MODEL_IDS).not.toContain("xai/grok-imagine-image");
  });

  it("Automatic names no gateway model (the image door's default and its backup); every other is its own id", () => {
    expect(reartGatewayModel("auto")).toBeUndefined();
    expect(reartGatewayModel(null)).toBeUndefined();
    expect(reartGatewayModel(undefined)).toBeUndefined();
    for (const id of REART_MODEL_IDS.filter((id) => id !== "auto")) expect(reartGatewayModel(id)).toBe(id);
  });

  it("an id the list doesn't know is Automatic — never passed to the gateway", () => {
    expect(reartModelOf("openai/gpt-image-1").id).toBe("auto");
    expect(reartGatewayModel("openai/gpt-image-1")).toBeUndefined();
    expect(reartGatewayModel("")).toBeUndefined();
  });

  it("only FLUX.2 is sent FLUX.2's wording", () => {
    expect(Object.fromEntries(REART_MODELS.map((model) => [model.id, model.framing]))).toEqual({
      auto: "flux2",
      "bfl/flux-2-pro": "flux2",
      "bfl/flux-kontext-pro": "plain",
      "spacexai/grok-imagine-image": "plain",
      "spacexai/grok-imagine-image-2.0": "plain",
      "google/gemini-3.1-flash-image": "plain",
    });
  });
});

describe("who may name the model — admins and testers (owner 2026-11-13)", () => {
  const NOW = new Date("2026-11-13T12:00:00Z");
  const live = { grantedAt: "2026-11-01T00:00:00Z", expiresAt: null };
  const dated = (expiresAt: string) => ({ grantedAt: "2026-11-01T00:00:00Z", expiresAt });

  it("an admin, and a tester the grant let in", () => {
    expect(canPickReartModel({ via: "admin", grant: null }, NOW)).toBe(true);
    expect(canPickReartModel({ via: "grant", grant: live }, NOW)).toBe(true);
  });

  it("never someone the tool opens for through their plan — unless they hold a live tester grant too", () => {
    expect(canPickReartModel({ via: "release", grant: null }, NOW)).toBe(false);
    expect(canPickReartModel({ via: "release", grant: live }, NOW)).toBe(true);
    expect(canPickReartModel({ via: "release", grant: dated("2026-12-01T00:00:00Z") }, NOW)).toBe(true);
    // A grant that ran out is no grant.
    expect(canPickReartModel({ via: "release", grant: dated("2026-11-10T00:00:00Z") }, NOW)).toBe(false);
  });

  it("nobody the tool is closed to", () => {
    expect(canPickReartModel(null)).toBe(false);
    expect(canPickReartModel(undefined)).toBe(false);
    expect(canPickReartModel({ via: null, grant: null }, NOW)).toBe(false);
  });
});

describe("a run's request names its model", () => {
  const id = "00000000-0000-4000-8000-000000000001";

  it("is Automatic when it names none (every caller before the picker)", () => {
    expect(reartRunSchema.parse({ deckId: id }).model).toBe("auto");
  });

  it("takes each of the list's ids and nothing else", () => {
    for (const model of REART_MODEL_IDS) expect(reartRunSchema.parse({ deckId: id, model }).model).toBe(model);
    for (const model of ["openai/gpt-image-1", "xai/grok-imagine-image", "bfl/flux-2-flex", "", "AUTO", 3, null]) {
      expect(reartRunSchema.safeParse({ deckId: id, model }).success).toBe(false);
    }
  });
});

describe("who painted, in words", () => {
  it("names a model of the list, and the ones Automatic paints with", () => {
    expect(reartModelLabel("bfl/flux-kontext-pro")).toBe("FLUX.1 Kontext [pro]");
    expect(reartModelLabel("spacexai/grok-imagine-image-2.0")).toBe("Grok Imagine 2.0");
    expect(reartModelLabel("google/gemini-3.1-flash-image")).toBe("Gemini 3.1 Flash Image");
    expect(reartModelLabel("bfl/flux-2-flex")).toBe("FLUX.2 [flex]");
    expect(reartModelLabel("bfl/flux-2-pro")).toBe("FLUX.2 [pro]");
  });

  it("a two-faced card painted by two models names both", () => {
    expect(reartModelLabel("bfl/flux-2-flex + bfl/flux-2-pro")).toBe("FLUX.2 [flex] + FLUX.2 [pro]");
  });

  it("an id nobody named is shown as it is; nothing recorded says nothing", () => {
    expect(reartModelLabel("vendor/new-model")).toBe("vendor/new-model");
    // A picture is painted by a MODEL: the picker's "Automatic" is no model's name.
    expect(reartModelLabel("auto")).toBe("auto");
    expect(reartModelLabel(null)).toBeNull();
    expect(reartModelLabel(undefined)).toBeNull();
    expect(reartModelLabel("  ")).toBeNull();
  });
});

describe("FLUX.2's wording is what it was", () => {
  it("the template, character for character", () => {
    expect(reartArtPrompt({ title: "Sol Ring", typeLine: "Artifact", flavorText: "Lost to time is the artificer's art." }, STYLE)).toBe(
      `Trading-card illustration of "Sol Ring", a Artifact. Its mood: Lost to time is the artificer's art. ${LOOK} The deck's world and look: a goblin warren at dusk. Every card of this deck is one cohesive set: the same rendering technique, palette, lighting and level of detail. ${REART_NO_FRAME_LINE}`,
    );
  });

  it("no framing named is FLUX.2's: the same prompt, the same block, the same closing line", () => {
    const subjects = [
      KRENKO,
      { title: "Forest", typeLine: "Basic Land — Forest" },
      { title: 'The "Unnamed" One', typeLine: null, flavorText: '"Who goes there?" —Gate guard' },
    ];
    const styles = [STYLE, { preset: "surprise", theme: "" }, { ...STYLE, mode: "custom" as const, prompt: "{card}, in oils. {flavor}" }];
    const words = [null, { text: "a goblin chef", only: false }, { text: "a goblin chef", only: true }];
    for (const subject of subjects) {
      for (const style of styles) {
        for (const own of words) {
          expect(buildReartPrompt(subject, style, own)).toEqual(buildReartPrompt(subject, style, own, "flux2"));
        }
      }
    }
    expect(reartStyleBlock(STYLE)).toBe(reartStyleBlock(STYLE, "flux2"));
    expect(reartClosingLine()).toBe(REART_NO_FRAME_LINE);
    expect(reartCardLine(KRENKO)).toBe('"Krenko, Mob Boss", a Legendary Creature — Goblin Warrior');
  });
});

describe("the plain wording (every model but FLUX.2)", () => {
  it("the template says what the picture is, with no quoted title, no “trading-card” and no “deck”", () => {
    expect(reartArtPrompt(KRENKO, STYLE, null, "plain")).toBe(
      `Fantasy illustration of Krenko, Mob Boss, a Legendary Creature — Goblin Warrior. As a scene, what it does: Create X 1/1 red Goblin creature tokens. ${LOOK} The world and look: a goblin warren at dusk. One of a cohesive series of paintings: the same rendering technique, palette, lighting and level of detail. ${REART_PLAIN_CLOSING_LINE}`,
    );
  });

  it("a flavour line loses its quotation marks: a quoted line reads as words to write in the picture", () => {
    const prompt = reartArtPrompt(
      { title: 'Krenko, "Mob Boss"', typeLine: "Legendary Creature — Goblin", flavorText: '“Who\'s the boss?” —Krenko' },
      STYLE,
      null,
      "plain",
    );
    expect(prompt.startsWith("Fantasy illustration of Krenko, Mob Boss, a Legendary Creature — Goblin. Its mood: Who's the boss? —Krenko.")).toBe(true);
    expect(prompt).not.toMatch(/["“”]/);
  });

  it("takes “an” before a vowel, and a card with no type or text is its name alone", () => {
    expect(reartCardLine({ title: "Sol Ring", typeLine: "Artifact" }, "plain")).toBe("Sol Ring, an Artifact");
    expect(reartArtPrompt({ title: "Forest", typeLine: null }, { preset: "surprise", theme: "" }, null, "plain")).toBe(
      `Fantasy illustration of Forest. Painterly fantasy illustration style. One of a cohesive series of paintings: the same rendering technique, palette, lighting and level of detail. ${REART_PLAIN_CLOSING_LINE}`,
    );
    // A name that is nothing but quotation marks is no name.
    expect(reartCardLine({ title: '""', typeLine: null }, "plain")).toBe("an unnamed card");
  });

  it("the card's own words keep the maker's punctuation; the style block and the closing line are the plain ones", () => {
    const prompt = reartArtPrompt(KRENKO, STYLE, { text: 'a goblin boss shouting "MORE!" from a throne of crates', only: false }, "plain");
    expect(prompt).toBe(
      `a goblin boss shouting "MORE!" from a throne of crates. ${reartStyleBlock(STYLE, "plain")} ${REART_PLAIN_CLOSING_LINE}`,
    );
    expect(reartArtPrompt(KRENKO, STYLE, { text: "A lone lighthouse in a storm", only: true }, "plain")).toBe(
      `A lone lighthouse in a storm. ${REART_PLAIN_CLOSING_LINE}`,
    );
  });

  it("the maker's own deck prompt is theirs: only what the CARD fills in is unquoted", () => {
    const style = { ...STYLE, mode: "custom" as const, prompt: 'An oil painting of {card}, lit by a "dying" candle. {flavor}' };
    const subject = { title: 'Archivist of "Lost" Hours', typeLine: "Creature — Human Wizard", flavorText: '"Every hour is filed."' };
    expect(reartArtPrompt(subject, style, null, "plain")).toBe(
      `An oil painting of Archivist of Lost Hours, a Creature — Human Wizard, lit by a "dying" candle. Every hour is filed. ${REART_PLAIN_CLOSING_LINE}`,
    );
    expect(reartArtPrompt(subject, style, null, "flux2")).toBe(
      `An oil painting of "Archivist of "Lost" Hours", a Creature — Human Wizard, lit by a "dying" candle. "Every hour is filed." ${REART_NO_FRAME_LINE}`,
    );
  });

  it("its closing line says the picture is art from edge to edge, with no text", () => {
    expect(reartClosingLine("plain")).toBe(REART_PLAIN_CLOSING_LINE);
    expect(REART_PLAIN_CLOSING_LINE).toMatch(/edge to edge/);
    expect(REART_PLAIN_CLOSING_LINE).toMatch(/no text/);
    expect(REART_PLAIN_CLOSING_LINE).not.toMatch(/card/i);
  });

  it("a prompt past the body's limit is cut the same way, and still ends on the closing line", () => {
    const style = { ...STYLE, mode: "custom" as const, prompt: Array.from({ length: 200 }, () => "{card} in thick oil paint").join(", ") };
    const { prompt, cut } = buildReartPrompt(KRENKO, style, null, "plain");
    expect(cut).toBe(true);
    expect(prompt.endsWith(REART_PLAIN_CLOSING_LINE)).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(3000 + 2 + REART_PLAIN_CLOSING_LINE.length);
  });
});
