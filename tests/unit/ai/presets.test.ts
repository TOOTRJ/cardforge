import { describe, expect, it } from "vitest";
import {
  STYLE_PRESETS,
  SURPRISE_PRESET_ID,
  THEME_PRESETS,
  TWIST_MAX,
  assemblePrompt,
  cleanTwist,
  composeArtStyle,
  composeStyle,
  composeTheme,
  styleArtBrief,
} from "@/lib/ai/presets";

// ---------------------------------------------------------------------------
// The AI dialog's presets (lib/ai/presets.ts) are data: unique ids, sentence-
// case labels, words for the designer (and, for a style, the painter), and
// no proper nouns. The twist outranks the preset; neither leaves the choice
// to the AI (the spark — which the prompt ranks below "the theme above").
// ---------------------------------------------------------------------------

const ALL = [...THEME_PRESETS, ...STYLE_PRESETS];

describe("the presets are data", () => {
  it("has a distinct set of 10–14 themes and of styles, ids unique and kebab-case, never the Surprise id", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(THEME_PRESETS.length).toBeLessThanOrEqual(14);
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(STYLE_PRESETS.length).toBeLessThanOrEqual(14);
    const ids = ALL.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(id).not.toBe(SURPRISE_PRESET_ID);
    }
  });

  it("labels are sentence case and short; every preset has its words", () => {
    for (const preset of ALL) {
      expect(preset.label, preset.id).toMatch(/^[A-Z0-9]/);
      // Sentence case: no capital after the first word (a hyphenated word
      // keeps its own).
      expect(preset.label.split(" ").slice(1).join(" "), preset.id).not.toMatch(/(^|\s)[A-Z]/);
      expect(preset.label.length, preset.id).toBeLessThanOrEqual(24);
      expect(preset.prompt.trim().length, preset.id).toBeGreaterThan(10);
    }
    for (const preset of STYLE_PRESETS) expect(preset.art.trim().length, preset.id).toBeGreaterThan(20);
  });

  it("names no franchise, publisher or Magic world", () => {
    const words = ALL.flatMap((preset) => [preset.label, preset.prompt, "art" in preset ? preset.art : ""]).join(" ");
    expect(words).not.toMatch(/wizards|magic:|ravnica|innistrad|theros|kamigawa|amonkhet|ixalan|zendikar|phyrexia|disney|ghibli|marvel|tolkien/i);
  });
});

describe("the twist", () => {
  it("is cleaned and clipped, never refused", () => {
    expect(cleanTwist("  haunted \n\t keepers  ")).toBe("haunted keepers");
    expect(cleanTwist("a\u0000b‮c")).toBe("a b c");
    expect(cleanTwist("x".repeat(500))).toHaveLength(TWIST_MAX);
    expect(cleanTwist(undefined)).toBe("");
    expect(cleanTwist("   ")).toBe("");
  });
});

describe("prompt assembly — the twist outranks the preset, both outrank the spark", () => {
  it("theme: preset alone, twist alone, both (twist first), neither", () => {
    const gothic = THEME_PRESETS.find((preset) => preset.id === "gothic-horror")!;
    expect(composeTheme("gothic-horror", "")).toBe(gothic.prompt);
    expect(composeTheme(undefined, "lighthouse keepers")).toBe("lighthouse keepers");
    const both = composeTheme("gothic-horror", "lighthouse keepers")!;
    expect(both.startsWith("lighthouse keepers (the maker's own words: they win)")).toBe(true);
    expect(both).toContain(gothic.prompt);
    expect(composeTheme(undefined, undefined)).toBeUndefined();
    expect(composeTheme(SURPRISE_PRESET_ID, undefined)).toBeUndefined();
  });

  it("style: the designer reads the look and the tone, the painter the twist and the name, then the look", () => {
    const glass = STYLE_PRESETS.find((preset) => preset.id === "stained-glass")!;
    expect(composeStyle("stained-glass", "")).toBe(`stained glass: ${glass.art}; ${glass.prompt}`);
    expect(composeStyle("stained-glass", "candlelight")!.startsWith("candlelight (the maker's own words: they win), over stained glass")).toBe(true);
    expect(composeArtStyle("stained-glass", "")).toBe("stained glass");
    expect(composeArtStyle("stained-glass", "candlelight")).toBe("candlelight, stained glass");
    expect(composeArtStyle(undefined, "candlelight")).toBe("candlelight");
    expect(styleArtBrief("stained-glass")).toBe(`Art direction: ${glass.art}.`);
    expect(styleArtBrief(SURPRISE_PRESET_ID)).toBe("");
    // Style "Surprise me" adds no style at all (owner, milestone 1).
    expect(composeStyle(SURPRISE_PRESET_ID, "")).toBeUndefined();
    expect(composeArtStyle(SURPRISE_PRESET_ID, "")).toBeUndefined();
  });

  it("an unknown preset id is dropped, never refused", () => {
    expect(composeTheme("not-a-preset", "")).toBeUndefined();
    expect(composeTheme("not-a-preset", "keepers")).toBe("keepers");
    expect(composeStyle("<script>", "")).toBeUndefined();
  });

  it("assemblePrompt: null for a request that names none of the fields (an older client keeps its own words)", () => {
    expect(assemblePrompt({})).toBeNull();
    expect(assemblePrompt({ theme_preset: "pirates" })).toMatchObject({ theme: expect.stringContaining("piracy"), style: undefined });
    expect(assemblePrompt({ style_twist: "neon" })).toEqual({ theme: undefined, style: "neon", artStyle: "neon", styleArt: "" });
  });

  it("the longest assembly fits the designer's assembled line", async () => {
    const { ASSEMBLED_PROMPT_MAX } = await import("@/lib/ai/card-design");
    const twist = "x".repeat(TWIST_MAX);
    for (const theme of THEME_PRESETS) expect(composeTheme(theme.id, twist)!.length, theme.id).toBeLessThanOrEqual(ASSEMBLED_PROMPT_MAX);
    for (const style of STYLE_PRESETS) expect(composeStyle(style.id, twist)!.length, style.id).toBeLessThanOrEqual(ASSEMBLED_PROMPT_MAX);
  });
});
