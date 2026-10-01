import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCmap } from "@/lib/render/font-cmap";
import { COLLECTOR_TEXT } from "@/scripts/lib/collector-metrics.mjs";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's face (public/fonts/Montserrat-Medium.ttf,
// scripts/build-collector-font.mjs) can never change an existing card's
// text: Satori resolves a glyph through the requested families and then
// EVERY registered font in registration order (satori's getEngine), so a
// code point only this face had would be drawn with it wherever MPlantin,
// Beleren, Mana and Keyrune lack the glyph — an unannounced correction.
// Two guards hold that:
//   • its cmap ⊆ MPlantin's (the first registered face, the fallback of
//     every family): nothing resolves to it unless asked for by name;
//   • it is registered LAST in renderCardImage's fonts array.
// Plus the self-hosting rules: the OFL beside it, a WOFF2 twin the preview
// loads, and the @font-face metric overrides from its hhea.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel));

describe("the collector face", () => {
  const collector = readCmap(read("public/fonts/Montserrat-Medium.ttf"));
  const mplantin = readCmap(read("node_modules/mana-font/fonts/mplantin.ttf"));

  it("maps exactly the subset text — 67 code points — and every one is in MPlantin's cmap", () => {
    const expected = [...new Set(Array.from(COLLECTOR_TEXT, (ch) => ch.codePointAt(0) as number))].sort((a, b) => a - b);
    expect([...collector.keys()].sort((a, b) => a - b)).toEqual(expected);
    expect(expected).toHaveLength(67);
    for (const cp of collector.keys()) expect(mplantin.has(cp), `U+${cp.toString(16)}`).toBe(true);
    // The ★ is in no card font — it is a path (lib/cards/collector-line.ts).
    expect(collector.has(0x2605)).toBe(false);
    expect(mplantin.has(0x2605)).toBe(false);
  });

  it("is registered last in the bake's fonts array, after MPlantin, Beleren, Mana and Keyrune", () => {
    const bake = readFileSync(path.join(ROOT, "lib/render/card-image.tsx"), "utf8");
    const names = [...bake.matchAll(/\{ name: "([A-Za-z]+)", data: [A-Z_]+_FONT_BYTES, weight: \d+, style: "(?:normal|italic)" \}/g)].map((m) => m[1]);
    expect(names).toEqual(["MPlantin", "MPlantin", "CardDisplay", "Mana", "Keyrune", "CollectorLine"]);
    expect(bake).toContain('{ name: "CollectorLine", data: COLLECTOR_FONT_BYTES, weight: 500, style: "normal" }');
    const fonts = readFileSync(path.join(ROOT, "lib/render/card-fonts.ts"), "utf8");
    expect(fonts).toMatch(/"public",\s*"fonts",\s*"Montserrat-Medium\.ttf"/);
  });

  it("ships beside its OFL with a WOFF2 twin, small, and the preview's @font-face carries its hhea as overrides", () => {
    expect(readFileSync(path.join(ROOT, "public/fonts/Montserrat-OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
    expect(existsSync(path.join(ROOT, "public/fonts/Montserrat-Medium.woff2"))).toBe(true);
    expect(statSync(path.join(ROOT, "public/fonts/Montserrat-Medium.ttf")).size).toBeLessThan(20_000);
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const face = /@font-face \{\s*font-family: "CollectorLine";[\s\S]*?\}/.exec(css)?.[0] ?? "";
    expect(face).toContain('url("/fonts/Montserrat-Medium.woff2") format("woff2")');
    expect(face).toContain('url("/fonts/Montserrat-Medium.ttf") format("truetype")');
    expect(face).toContain("font-weight: 500;");
    expect(face).toContain("ascent-override: 96.8%;");
    expect(face).toContain("descent-override: 25.1%;");
    expect(face).toContain("line-gap-override: 0%;");
  });

  it("has no kerning or substitution: both renderers lay the runs out from the advances alone", () => {
    const bytes = read("public/fonts/Montserrat-Medium.ttf");
    const count = bytes.readUInt16BE(4);
    const tags: string[] = [];
    for (let i = 0; i < count; i += 1) tags.push(bytes.subarray(12 + i * 16, 16 + i * 16).toString("latin1"));
    expect(tags).not.toContain("GPOS");
    expect(tags).not.toContain("GSUB");
    expect(tags).not.toContain("kern");
  });
});
