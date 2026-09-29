import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { mainRulesLayout } from "@/lib/cards/rules-box";
import { linePositions, type RulesTarget } from "@/lib/cards/rules-layout";
import { EOE_30 } from "@/tests/unit/cards/fixtures/rules-texts";

// ---------------------------------------------------------------------------
// The v33 rules layout on REAL card bakes (renderCardImage, layout v33, TODO
// 3.29): the card's rules box is drawn exactly where lib/cards/rules-box.ts
// lays it out — the same size, line count, line pitch, paragraph gap and
// flavor step — at the 750 px and the HD preset, on a portrait and a
// landscape frame. The rules ink is recoloured pure magenta (colour only),
// so it is the only magenta on the card; frames the bucket holds draw as a
// transparent pixel here, which leaves the text alone on the card.
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

type Case = { name: string; template: string; card: Partial<CardPreviewData>; show: { pt?: boolean; defense?: boolean } };

const CASES: Case[] = [
  {
    // (A git-framed 9 pt box with its P/T plate: the M15 masters live in the
    // frames bucket.)
    name: "Dragon Wing creature, three abilities + flavor with the bar",
    template: "tarkirdragon",
    card: { cardType: "creature", power: "2", toughness: "3", rulesText: EOE_30, flavorText: "\"The line holds.\"\n—Captain Ysolde" },
    show: { pt: true },
  },
  {
    name: "Retro, flavor with no bar",
    template: "retro",
    card: { cardType: "creature", power: "2", toughness: "2", rulesText: "Flying\n{T}: Target creature gains flying until end of turn.", flavorText: "The sky is no limit." },
    show: { pt: true },
  },
  {
    name: "Battle (landscape)",
    template: "battle",
    card: { cardType: "battle", subtypes: ["Siege"], defense: "5", rulesText: "When this Siege enters, search your library for a card.\nScry 2." },
    show: { defense: true },
  },
];

describe("rules lines on real bakes", () => {
  for (const c of CASES) {
    for (const preset of ["default", "hd"] as const) {
      it(`${c.name} — ${preset}`, async () => {
        const { getFrameProfile } = await import("@/lib/cards/template-layout");
        const { renderCardImage } = await import("@/lib/render/card-image");
        const card = {
          title: "Probe",
          cost: "{1}{W}",
          supertype: null,
          subtypes: [],
          rarity: "common",
          colorIdentity: ["white"],
          artistCredit: "Probe",
          artUrl: null,
          artPosition: {},
          frameStyle: { template: c.template, finish: "regular" },
          ...c.card,
        } as unknown as CardPreviewData;
        const layout = getFrameProfile(c.template);
        const aspect = layout.orientation === "landscape" ? 5 / 7 : 7 / 5;
        const rules = mainRulesLayout({ layout, rulesText: c.card.rulesText, flavorText: c.card.flavorText, aspect, show: c.show });
        const placed = linePositions(rules, preset as RulesTarget);

        const png = Buffer.from(
          await (await renderCardImage(card, preset, { brandMark: false, watermarkText: null, corners: "square" })).arrayBuffer(),
        );
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const { box } = placed;
        const inkRows: number[] = [];
        for (let y = box.top; y < box.top + box.height; y += 1) {
          let hit = false;
          for (let x = box.left; x < box.left + box.width && !hit; x += 1) {
            const i = (y * info.width + x) * 3;
            hit = magenta(data[i], data[i + 1], data[i + 2]);
          }
          if (hit) inkRows.push(y);
        }
        // Every magenta row inside a modelled line's ink band (or the bar's
        // row); every modelled line has ink.
        const bandOf = (y: number) => placed.lines.findIndex((l) => y >= Math.floor(l.inkTop) - 1 && y <= Math.ceil(l.inkBottom) + 1);
        const bar = placed.bar ? Math.round(placed.bar.top) : null;
        const stray = inkRows.filter((y) => bandOf(y) < 0 && (bar === null || Math.abs(y - bar) > 1));
        expect(stray, "ink outside every line").toEqual([]);
        const inked = new Set(inkRows.map(bandOf).filter((i) => i >= 0));
        expect(inked.size, "lines with ink").toBe(placed.lines.length);
        // The first line's ink starts at its band's top (a capital), the
        // last one's reaches its band's bottom (a descender): the whole block
        // sits where the layout put it, to the px.
        expect(Math.abs(inkRows[0] - placed.lines[0].inkTop)).toBeLessThanOrEqual(2);
        const last = placed.lines[placed.lines.length - 1];
        expect(Math.abs(inkRows[inkRows.length - 1] - (last.inkBottom - 1))).toBeLessThanOrEqual(2);
      }, 60_000);
    }
  }
});
