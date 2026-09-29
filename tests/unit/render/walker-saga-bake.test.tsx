import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { parseChapters, parseLoyaltyAbilities, parseSagaIntro } from "@/lib/cards/card-display";
import { layoutProfileLoyaltyRows, loyaltyRowLines, loyaltyRowsDrawing } from "@/lib/cards/loyalty-rows";
import { rectPx, type RulesTarget } from "@/lib/cards/rules-layout";
import { layoutSagaRail, sagaBadgeWidthPx, sagaRailMetrics, sagaRailPx } from "@/lib/cards/saga-rail";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The walker rows and the saga rail on REAL bakes at BOTH targets — the 750
// px bake (OG images, live free downloads) and the stored HD bake — since
// layout v33 (TODO 3.29) draws each ability's and each chapter's lines as
// the rules layout broke them (lib/cards/loyalty-rows.ts, lib/cards/
// saga-rail.ts). For every walker in the matrix, at each target:
//
//   * every row's ink stays inside its own stripe — no row overlaps the next;
//   * its ink sits where the layout put its lines (within a px);
//   * no line runs past its column, and none under the loyalty shield (baked
//     WITHOUT the shield, so anything under it shows).
//
// For the sagas (owner decision 2026-09-28: correctness only, v32's sizes,
// rows and badges): each chapter's lines are where the layout puts them in
// v32's equal rows, as many as it broke, inside their column; DOM #122's
// "Add {R}{R}." draws two red pips; U+2212 draws exactly as a hyphen.
//
// The m15pw masters live in the frames bucket (never in git): the walkers
// get a white stand-in with a transparent art window through a stubbed
// bucket, the rows / badges / geometry are the real M15PW profile's. The
// saga frame is a git file (read from disk). Offline and deterministic.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const PW = getFrameProfile("m15pw");
const SAGA = getFrameProfile("saga");
const TARGETS: { target: RulesTarget; preset: "default" | "hd" }[] = [
  { target: "default", preset: "default" },
  { target: "hd", preset: "hd" },
];

const WALKERS: Record<string, { rulesText?: string; faceContent?: unknown }> = {
  "1 / 1 / 5": {
    rulesText:
      "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"",
  },
  "reaches the shield": {
    rulesText:
      "+1: Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n−3: Return target creature card from your graveyard to your hand.\n−7: Search your library for up to three creature cards, reveal them, put them into your hand, then shuffle. You gain 1 life for each card.",
  },
  "ALL CAPS": {
    rulesText:
      "+1: CREATURES YOU CONTROL GET +2/+2 AND GAIN TRAMPLE UNTIL END OF TURN.\n−3: DESTROY TARGET CREATURE OR PLANESWALKER WITH MANA VALUE 4 OR GREATER. ITS CONTROLLER CREATES A TREASURE TOKEN AND A CLUE TOKEN.\n−8: YOU GET AN EMBLEM WITH \"WHENEVER A CREATURE YOU CONTROL ATTACKS, DRAW A CARD.\"",
  },
  "pips + reminder": {
    rulesText:
      "+1: Add {B}{B}{B}. (Mana abilities don't use the stack.)\n−2: Target creature gets −{X}/−{X} until end of turn, where X is the number of {S} permanents you control.\n−6: Search your library for up to {7} cards and put them into your hand.",
  },
  "accented first line + a static ability's two paragraphs": {
    faceContent: {
      v: 1,
      loyalty: {
        abilities: [
          { cost: null, text: "Éowyn can be your commander.\nÉowyn can't be countered." },
          { cost: "+1", text: "Ölmir and Ñandú each draw a card." },
          { cost: "-4", text: "Destroy target creature. Its controller loses 2 life." },
        ],
      },
    },
  },
  "long ultimate": {
    rulesText:
      "+1: Draw a card, then discard a card.\n−2: Draw a card.\n−10: Search your library for any number of creature cards, put them onto the battlefield, then shuffle. They gain haste. Exile them at the beginning of the next end step.",
  },
};

const SAGAS: Record<string, string> = {
  "DOM #122": "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga deals 1 damage to each creature without flying.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain. If you do, this Saga deals 3 damage to each creature.",
  "combined marker": "I — Kashimo gets reach and double strike permanently give him 2 1/1 counters Kashimo also stuns for 3 turns now\nII, III, IV — Give target creature 4 stun counters and 2 −1/−1 counters (They're gone next turn.)\nV — Tap Kashimo.",
};

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const [fw, fh] = [1500, 2100];
  const a = PW.artSlot;
  const [x0, x1] = [Math.round((a.leftPct / 100) * fw), Math.round(((a.leftPct + a.widthPct) / 100) * fw)];
  const [y0, y1] = [Math.round((a.topPct / 100) * fh), Math.round(((a.topPct + a.heightPct) / 100) * fh)];
  const px = Buffer.alloc(fw * fh * 4);
  for (let y = 0; y < fh; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue; // the window: transparent
      px.fill(255, (y * fw + x) * 4, (y * fw + x) * 4 + 4);
    }
  }
  const frame = await sharp(px, { raw: { width: fw, height: fh, channels: 4 } }).png().toBuffer();
  const plate = await sharp({ create: { width: 240, height: 154, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15pw/b.png": frame, "m15pw/loyalty/b.png": plate };
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  return { manifest, byUrl };
}

type Raw = { width: number; data: Buffer; sha: string };
const lum = (r: Raw, x: number, y: number) => {
  const i = (y * r.width + x) * 3;
  return 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
};

describe("walker rows and the saga rail — real bakes at 750 and HD", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let art: string;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    bucket = await standInBucket();
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 40, b: 40 } } }).png().toBuffer();
    art = `data:image/png;base64,${png.toString("base64")}`;
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
  });

  async function bake(over: Partial<CardPreviewData>, preset: "default" | "hd"): Promise<Raw> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const buf = bucket.byUrl.get(String(input));
        if (!buf) throw new Error(`unexpected fetch: ${input}`);
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({ manifest: bucket.manifest, origin: ORIGIN });
    const mod = await import("@/lib/render/card-image");
    const card = {
      title: "Probe",
      cost: "{B}",
      cardType: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Probe"],
      rarity: "rare",
      colorIdentity: ["black"],
      rulesText: null,
      flavorText: null,
      power: null,
      toughness: null,
      // No starting loyalty: the shield isn't drawn, so any text under it shows.
      loyalty: null,
      defense: null,
      artistCredit: "Probe",
      artUrl: art,
      artPosition: {},
      frameStyle: { template: "m15pw", finish: "regular" },
      setIconUrl: null,
      setIconCode: null,
      backFace: null,
      faceContent: null,
      watermark: null,
      ...over,
    } as unknown as CardPreviewData;
    const png = Buffer.from(await (await mod.renderCardImage(card, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
    return {
      width: RENDER_PRESETS[preset].width,
      data: await sharp(png).removeAlpha().raw().toBuffer(),
      sha: createHash("sha256").update(png).digest("hex"),
    };
  }

  for (const { target, preset } of TARGETS) {
    it(`holds every ability in its own stripe where the layout put its lines, clear of the shield (${preset})`, async () => {
      const box = rectPx(PW.rules.rect, "portrait", 7 / 5, target);
      const shield = rectPx(PW.loyalty!.plateRect!, "portrait", 7 / 5, target);
      // The rows' box rounds its corners (the art shows there): scan short
      // of them — inside the rows' right padding.
      const radius = Math.round(RENDER_PRESETS[preset].width * 0.012);
      for (const [name, over] of Object.entries(WALKERS)) {
        const { resolveLoyaltyRows } = await import("@/lib/cards/face-content");
        const abilities = resolveLoyaltyRows(over.faceContent as never, over.rulesText ?? null);
        const rows = layoutProfileLoyaltyRows(PW, abilities, 7 / 5);
        expect(rows.clipped, name).toBe(false);
        const draw = loyaltyRowsDrawing(rows, target);
        const raw = await bake(over as Partial<CardPreviewData>, preset);
        const textLeft = box.left + draw.row.rail;
        rows.text.forEach((_, i) => {
          const [top, bottom] = [box.top + draw.edges[i], box.top + draw.edges[i + 1]];
          const placed = loyaltyRowLines(rows, i, target);
          const right = textLeft + draw.text[i].column;
          let [inkTop, inkBottom, inkRight] = [Infinity, -Infinity, -Infinity];
          for (let y = top; y < bottom; y += 1) {
            for (let x = textLeft - 2; x < box.right - radius - 1; x += 1) {
              if (lum(raw, x, y) >= 70) continue;
              [inkTop, inkBottom, inkRight] = [Math.min(inkTop, y), Math.max(inkBottom, y), Math.max(inkRight, x)];
            }
          }
          const label = `${name} row ${i} (${preset})`;
          expect(inkTop, label).toBeLessThan(Infinity);
          // Inside its own stripe…
          expect(inkTop - top, label).toBeGreaterThanOrEqual(1);
          expect(bottom - 1 - inkBottom, label).toBeGreaterThanOrEqual(1);
          // …where the layout put its lines (their ink reach is an upper
          // bound, a px either way for Yoga's rounding of a centred block)…
          expect(inkTop, label).toBeGreaterThanOrEqual(Math.floor(placed.lines[0].inkTop) - 1);
          expect(inkBottom, label).toBeLessThanOrEqual(Math.ceil(placed.lines.at(-1)!.inkBottom) + 1);
          // …its first line where the model put its baseline: capitals or
          // ascenders reach ≈0.7 em above it.
          const m = placed.metrics;
          const baseline = placed.lines[0].top + m.baselinePx.regular;
          expect(Math.abs(inkTop - (baseline - 0.69 * m.fontPx)), label).toBeLessThanOrEqual(0.22 * m.fontPx + 2);
          // …and no line past its column (but for a glyph's ink past its
          // advance: MPlantin's "f" hangs ≈0.08 em over, into the padding).
          expect(inkRight, label).toBeLessThanOrEqual(right + Math.ceil(0.1 * m.fontPx));
        });
        // Nothing under the shield (inside the box).
        let under = 0;
        for (let y = shield.top; y < box.bottom - 2; y += 1) {
          for (let x = shield.left; x < box.right - radius - 1; x += 1) if (lum(raw, x, y) < 70) under += 1;
        }
        expect(under, `${name}: text under the shield (${preset})`).toBe(0);
      }
    }, 120_000);

    it(`draws each chapter's lines where the layout puts them in v32's equal rows, pips as pips (${preset})`, async () => {
      const railBox = rectPx(SAGA.chapters!.rect, "portrait", 7 / 5, target);
      const px = sagaRailPx(SAGA.chapters!, target);
      for (const [name, rules] of Object.entries(SAGAS)) {
        const rail = layoutSagaRail(SAGA.chapters!, parseSagaIntro(rules), parseChapters(rules));
        const m = sagaRailMetrics(rail, target);
        const raw = await bake(
          { cardType: "enchantment", subtypes: ["Saga"], rulesText: rules, frameStyle: { template: "saga", finish: "regular" } } as Partial<CardPreviewData>,
          preset,
        );
        const introLines = rail.intro ? rail.intro.reduce((n, b) => n + b.lines.length, 0) : 0;
        const introH = rail.intro ? 2 * px.introPadY + introLines * m.intro.linePx + 1 : 0;
        const rowH = (railBox.height - introH) / rail.chapters.length;
        rail.chapters.forEach((ch, i) => {
          const label = `${name} ${ch.marker} (${preset})`;
          const top = railBox.top + introH + i * rowH;
          const lines = ch.blocks.reduce((n, b) => n + b.lines.length, 0);
          const blockH = lines * m.chapter.linePx;
          const blockTop = top + px.rowPadY + (rowH - 2 * px.rowPadY - blockH) / 2;
          const left = railBox.left + px.rowPadX + sagaBadgeWidthPx(ch.marker, px) + px.badgeGap;
          const column = railBox.width - 2 * px.rowPadX - sagaBadgeWidthPx(ch.marker, px) - px.badgeGap;
          // The ink rows of the text column, as bands (one per line: at 1.22 em
          // the lines' ink never touch).
          const inked: number[] = [];
          let inkRight = -Infinity;
          for (let y = Math.floor(top) + 1; y < Math.floor(top + rowH) - 1; y += 1) {
            let hit = false;
            for (let x = left - 1; x < railBox.right - 1; x += 1) {
              if (lum(raw, x, y) < 90) {
                hit = true;
                inkRight = Math.max(inkRight, x);
              }
            }
            if (hit) inked.push(y);
          }
          const bands = inked.filter((y, k) => k === 0 || y - inked[k - 1] > 2).length;
          expect(bands, label).toBe(lines);
          expect(inked[0], label).toBeGreaterThanOrEqual(Math.floor(blockTop) - 1);
          expect(inked.at(-1)!, label).toBeLessThanOrEqual(Math.ceil(blockTop + blockH) + 1);
          expect(inkRight, label).toBeLessThanOrEqual(left + column + Math.ceil(0.1 * m.chapter.fontPx));
        });
        if (name === "DOM #122") {
          // Chapter II's "Add {R}{R}.": two red discs (the bake's r gem,
          // #db8664), never the literal braces v32 baked.
          const top = railBox.top + introH + rowH;
          let red = 0;
          for (let y = Math.floor(top); y < Math.floor(top + rowH); y += 1) {
            for (let x = railBox.left; x < railBox.right; x += 1) {
              const k = (y * raw.width + x) * 3;
              const [r, g, b] = [raw.data[k], raw.data[k + 1], raw.data[k + 2]];
              if (Math.abs(r - 0xdb) < 12 && Math.abs(g - 0x86) < 12 && Math.abs(b - 0x64) < 12) red += 1;
            }
          }
          const disc = m.chapter.pipPx;
          expect(red, "red pip area").toBeGreaterThan(2 * 0.25 * disc * disc);
        }
      }
    }, 120_000);
  }

  it("keeps a saga typed with no chapter markers (ALL intro) inside its rail, at both targets", async () => {
    // Without a "I —" marker every line is the intro, which a long text used
    // to push out of the rail over the type line and the border below it
    // (v32 did too; the layout v33 review). The rail clips it now: below the
    // rail the card is exactly what a one-line intro bakes.
    const dense = "Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life. ".repeat(14);
    const saga = (rulesText: string, preset: "default" | "hd") =>
      bake({ cardType: "enchantment", subtypes: ["Saga"], rulesText, frameStyle: { template: "saga", finish: "regular" } } as Partial<CardPreviewData>, preset);
    for (const { target, preset } of TARGETS) {
      const rail = layoutSagaRail(SAGA.chapters!, parseSagaIntro(dense), parseChapters(dense));
      expect(rail.chapters).toHaveLength(0);
      const railBox = rectPx(SAGA.chapters!.rect, "portrait", 7 / 5, target);
      const [long, short] = [await saga(dense, preset), await saga("Draw a card.", preset)];
      let differ = 0;
      const height = long.data.length / 3 / long.width;
      for (let y = railBox.bottom + 1; y < height; y += 1) {
        for (let x = railBox.left; x < railBox.right; x += 1) {
          const k = (y * long.width + x) * 3;
          if (long.data[k] !== short.data[k] || long.data[k + 1] !== short.data[k + 1] || long.data[k + 2] !== short.data[k + 2]) differ += 1;
        }
      }
      expect(differ, preset).toBe(0);
    }
  }, 60_000);

  it("draws U+2212 exactly as the hyphen MPlantin has, in a chapter and in an ability", async () => {
    const saga = (dash: string) =>
      bake(
        {
          cardType: "enchantment",
          subtypes: ["Saga"],
          rulesText: `I — Put a ${dash}1/${dash}1 counter on target creature.\nII — Draw a card.`,
          frameStyle: { template: "saga", finish: "regular" },
        } as Partial<CardPreviewData>,
        "default",
      );
    expect((await saga("−")).sha).toBe((await saga("-")).sha);
    const walker = (dash: string) => bake({ rulesText: `+1: Target creature gets ${dash}2/${dash}0.\n−3: Draw a card.` }, "default");
    expect((await walker("−")).sha).toBe((await walker("-")).sha);
    // (The badges' "−3" is the same text in both, and parseLoyaltyAbilities
    // normalizes a cost's sign.)
    expect(parseLoyaltyAbilities("−3: Draw a card.")[0].cost).toBe("-3");
  }, 60_000);
});
