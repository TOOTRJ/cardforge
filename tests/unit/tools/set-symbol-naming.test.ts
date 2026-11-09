import { describe, expect, it } from "vitest";
import {
  isRarityFollowingSetIcon,
  setIconForRarity,
  symbolFileName,
  symbolVariantUrl,
  symbolWatermarkName,
} from "@/lib/tools/set-symbol/naming";
import {
  buildSymbolPrompt,
  symbolPromptProblem,
} from "@/lib/tools/set-symbol/prompt";

const USER = "d0000000-0000-4000-8000-000000000002";
const V = "a1b2c3d4-0000-4000-8000-00000000abcd";
const BASE = `https://example.supabase.co/storage/v1/object/public/set-covers/${USER}/`;

describe("set symbol file names", () => {
  it("names every file under one version", () => {
    expect(symbolFileName(V, "auto")).toBe(`sym-${V}-auto.png`);
    expect(symbolWatermarkName(V)).toBe(`wm-sym-${V}.png`);
    // user-storage's file-name rule.
    expect(symbolFileName(V, "mythic")).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
  });

  it("an -auto set icon follows the card's rarity", () => {
    const auto = `${BASE}sym-${V}-auto.png`;
    expect(isRarityFollowingSetIcon(auto)).toBe(true);
    expect(setIconForRarity(auto, "mythic")).toBe(`${BASE}sym-${V}-mythic.png`);
    expect(setIconForRarity(auto, "uncommon")).toBe(`${BASE}sym-${V}-uncommon.png`);
    expect(setIconForRarity(auto, null)).toBe(`${BASE}sym-${V}-common.png`);
  });

  it("every other set icon draws as stored", () => {
    const plain = `${BASE}sym-${V}-plain.png`;
    const upload = `${BASE}icon-${V}.png`;
    const otherBucket = `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/sym-${V}-auto.png`;
    for (const url of [plain, upload, otherBucket, "", null, undefined]) {
      expect(setIconForRarity(url, "rare")).toBe(url);
    }
    expect(isRarityFollowingSetIcon(plain)).toBe(false);
    expect(isRarityFollowingSetIcon(otherBucket)).toBe(false);
  });

  it("finds a version's other files from any one of them", () => {
    expect(symbolVariantUrl(`${BASE}sym-${V}-rare.png`, "auto")).toBe(`${BASE}sym-${V}-auto.png`);
    expect(symbolVariantUrl(`${BASE}icon-${V}.png`, "auto")).toBeNull();
  });
});

describe("symbol prompts", () => {
  it("asks for one black shape on white around the maker's subject", () => {
    const prompt = buildSymbolPrompt("  a cracked moon over a tower.  ", "runic");
    expect(prompt).toContain("a cracked moon over a tower.");
    expect(prompt).toContain("black shape on a plain pure white background");
    expect(prompt).toContain("runic");
  });

  it("refuses hate symbols and strong language, in words", () => {
    expect(symbolPromptProblem("a swastika in a circle")).toBe("hate_symbol");
    expect(symbolPromptProblem("KKK cross")).toBe("hate_symbol");
    expect(symbolPromptProblem("ab")).toBe("too_short");
    expect(symbolPromptProblem("a dragon skull with a crown")).toBeNull();
    // Words that hold a term are not the term.
    expect(symbolPromptProblem("a nazgul ring")).toBeNull();
  });
});
