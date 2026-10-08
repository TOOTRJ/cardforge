import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sourcesJson from "@/lib/cards/frame-sources.json";
import { ORIGINAL_DISC_PX, ORIGINAL_SYMBOL_FOLDER, ORIGINAL_SYMBOL_LETTERS, SYMBOL_STYLES, originalSymbolPath } from "@/lib/cards/symbol-style";
import { frameManifestEntry } from "@/lib/frames/frame-url";
import { CC_COMMIT, CC_RIDERS, MANA_ORIGINAL_FILES, MANA_ORIGINAL_SIZE } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// The 1993 frame's five colour symbols as the IMPORTER builds them (TODO
// 4.10c / 4.24; scripts/lib/cc-frames.mjs CC_RIDERS.manaoriginal, built by
// scripts/import-cc-frames.mjs): Card Conjurer's old set, one SVG per colour
// holding the whole pip, rasterised at 216 px into the frames bucket — never
// git. The published bytes themselves:
// tests/unit/render/alpha-1993-bake.test.tsx (it needs FRAMES_BUILD_DIR).
// ---------------------------------------------------------------------------

describe("the original symbols' recipe", () => {
  it("is one rasterised set of five, keyed by the symbol style's own letters and folder", () => {
    const def = CC_RIDERS[ORIGINAL_SYMBOL_FOLDER];
    expect(def).toBeDefined();
    expect(Object.keys(def.files)).toEqual([...ORIGINAL_SYMBOL_LETTERS]);
    expect(def.files).toEqual(MANA_ORIGINAL_FILES);
    for (const c of ORIGINAL_SYMBOL_LETTERS) expect(def.files[c]).toBe(`img/manaSymbols/old/old${c}.svg`);
    // Three times the HD bake's cost disc: no bake upsamples one.
    expect(def.size).toBe(MANA_ORIGINAL_SIZE);
    expect(MANA_ORIGINAL_SIZE).toBe(3 * ORIGINAL_DISC_PX);
  });

  it("every image the style draws is a published object, PNG and WebP, at that size", () => {
    for (const c of ORIGINAL_SYMBOL_LETTERS) {
      const png = frameManifestEntry(originalSymbolPath(c));
      expect(png, c).toMatchObject({ width: MANA_ORIGINAL_SIZE, height: MANA_ORIGINAL_SIZE });
      expect(png!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(frameManifestEntry(originalSymbolPath(c).replace(/\.png$/, ".webp")), c).not.toBeNull();
      expect(SYMBOL_STYLES.original.symbolImages![c]).toBe(originalSymbolPath(c));
    }
  });

  it("provenance: Card Conjurer at the pinned commit, the five source files, what proof 3 found", () => {
    const entry = (sourcesJson as unknown as Record<string, { source: string; commit: string; kind: string; output: string; sourceFiles: string[]; notes: string[] }>)[ORIGINAL_SYMBOL_FOLDER];
    expect(entry).toMatchObject({ source: "cardconjurer", commit: CC_COMMIT, kind: "rider" });
    expect(entry.sourceFiles).toEqual(Object.values(MANA_ORIGINAL_FILES).sort());
    expect(entry.output).toContain("216x216 mana symbols");
    expect(entry.notes.join(" ")).toMatch(/Alpha 1993 → Fallen Empires 1994/);
    expect(entry.notes.join(" ")).toMatch(/Fourth Edition 1995/);
  });

  it("Card Conjurer-derived pixels never enter git: no symbol file under public/", () => {
    expect(fs.existsSync(path.join(process.cwd(), "public/frames", ORIGINAL_SYMBOL_FOLDER))).toBe(false);
  });
});
