import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { mainRulesLayout } from "@/lib/cards/rules-box";
import { linePositions, type RulesTarget } from "@/lib/cards/rules-layout";

// ---------------------------------------------------------------------------
// Inline rules pips on REAL bakes (layout v36, TODO 3.31): the disc is
// centred on its line's capitals, as the prints centre it — its centre
// 0.334 em above the baseline and 0.785 em across (37 discs on 14 prints:
// 0.323–0.348 / 0.754–0.812 em). Centred in the line box at 0.86 em, a 76 px
// line drew it 21 px up and 65 px tall where the prints put it 25 px up and
// 60 px tall. The rules ink is recoloured pure magenta, so the letters are
// the only magenta on the card and the {G} disc the only mana green; frames
// the bucket holds draw as a transparent pixel here, which leaves the text
// alone on the card.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: string) => {
      const p = real.getFrameProfile(template);
      return { ...p, rules: { ...p.rules, colorHex: "#ff00ff" } };
    },
  };
});

const magenta = (r: number, g: number, b: number) => r > 150 && b > 150 && g < 120;
/** The {G} disc's fill (MANA_GEM_BG.g, #93b483), anti-aliased edge included. */
const green = (r: number, g: number, b: number) => Math.abs(r - 0x93) < 28 && Math.abs(g - 0xb4) < 28 && Math.abs(b - 0x83) < 28 && g > r + 15;

// Git-framed templates with a full 9 pt box (the M15 masters live in the
// bucket): the pip's place in its line is the layout's on every template.
// (Alpha left this list with TODO 4.10c: its colour pips are the 1993
// drawings — bucket images, not a font glyph on the disc this test reads;
// tests/unit/render/alpha-1993-bake.test.tsx holds its pips.)
const TEMPLATES = ["tarkirdraconic", "tarkirdragon"] as const;

describe("inline pips centred on the capitals on real bakes (3.31)", () => {
  for (const template of TEMPLATES) {
    for (const preset of ["default", "hd"] as const) {
      it(`${template} — ${preset}`, async () => {
        const { getFrameProfile } = await import("@/lib/cards/template-layout");
        const { renderCardImage } = await import("@/lib/render/card-image");
        const card = {
          title: "Probe",
          cost: "{G}",
          cardType: "creature",
          supertype: null,
          subtypes: ["Elf"],
          rarity: "common",
          colorIdentity: ["green"],
          power: "1",
          toughness: "1",
          artistCredit: "Probe",
          artUrl: null,
          artPosition: {},
          rulesText: "Add {G}. Add Add.",
          frameStyle: { template, finish: "regular" },
        } as unknown as CardPreviewData;
        const layout = getFrameProfile(template);
        const rules = mainRulesLayout({ layout, rulesText: card.rulesText, flavorText: null, aspect: 7 / 5, show: { pt: true } });
        const placed = linePositions(rules, preset as RulesTarget);
        expect(placed.lines).toHaveLength(1);
        const line = placed.lines[0];
        const fontPx = placed.metrics.fontPx;

        const png = Buffer.from(
          await (await renderCardImage(card, preset, { brandMark: false, watermarkText: null, corners: "square" })).arrayBuffer(),
        );
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const rows = { disc: [] as number[], letters: [] as number[] };
        const y0 = Math.floor(line.top) - 4;
        const y1 = Math.ceil(line.top + line.height) + 8;
        for (let y = y0; y < y1; y += 1) {
          let isDisc = false;
          let isLetter = false;
          for (let x = Math.floor(line.left) - 8; x < line.left + line.width + 8; x += 1) {
            const i = (y * info.width + x) * 3;
            if (green(data[i], data[i + 1], data[i + 2])) isDisc = true;
            if (magenta(data[i], data[i + 1], data[i + 2])) isLetter = true;
          }
          if (isDisc) rows.disc.push(y);
          if (isLetter) rows.letters.push(y);
        }
        expect(rows.disc.length).toBeGreaterThan(0);
        // "Add {G}. Add Add." has no descender: the letters' last row is the
        // baseline's (the period and the letters sit on it).
        const baseline = rows.letters[rows.letters.length - 1] + 1;
        const discTop = rows.disc[0];
        const discBottom = rows.disc[rows.disc.length - 1] + 1;
        const centreAbove = baseline - (discTop + discBottom) / 2;
        // The prints: 0.334 em (0.323–0.348) — 25.4 px at 76 px type, 12.7
        // at the 750 bake's 38 (whose line box may start on a half px). Old:
        // 21 / 10.5 px.
        expect(Math.abs(centreAbove - 0.334 * fontPx)).toBeLessThanOrEqual(1.5);
        // The prints: 0.785 em (0.754–0.812) — 60 / 30 px. Old: 65 / 33.
        expect(Math.abs(discBottom - discTop - 0.785 * fontPx)).toBeLessThanOrEqual(1);
        // …and exactly where the layout says: its top, its size.
        expect(Math.abs(discTop - (line.top + placed.metrics.pipTopPx))).toBeLessThanOrEqual(1);
        expect(Math.abs(discBottom - discTop - placed.metrics.pipPx)).toBeLessThanOrEqual(1);
      }, 60_000);
    }
  }
});
