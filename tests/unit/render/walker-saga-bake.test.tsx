import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { parseChapters, parseLoyaltyAbilities, parseSagaIntro } from "@/lib/cards/card-display";
import { layoutProfileLoyaltyRows, loyaltyRowLines, loyaltyRowsDrawing } from "@/lib/cards/loyalty-rows";
import { RULES_TARGET_SCALE, linePositions, rectPx, type RulesTarget } from "@/lib/cards/rules-layout";
import { sagaRail, sagaRailDrawing } from "@/lib/cards/saga-rail";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RENDER_PRESETS, frameAssetPathsFor } from "@/lib/render/card-image";

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
// For the sagas (TODO 4.21c: the printed rail, lib/cards/saga-rail.ts), at
// each target: the reminder block and every chapter's lines are where the
// layout puts them — in content-sized rows, inside their column — with real
// pips; each chapter badge and row divider is drawn at the layout's box
// (stand-in bitmaps: a red block for the badge, a green one for the
// divider), each numeral's ink centred on its badge; a rail past its floor
// and a saga that is ALL reminder leave nothing below the rail; U+2212
// draws exactly as a hyphen.
//
// The m15pw and saga masters live in the frames bucket (never in git): the
// bakes get white stand-ins with a transparent art window through a stubbed
// bucket; the rows, rail, badges and geometry are the real profiles'.
// Offline and deterministic.
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

const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)";
const SAGAS: Record<string, string> = {
  "DOM #122": `${REMINDER}\nI — This Saga deals 1 damage to each creature without flying.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain. If you do, this Saga deals 3 damage to each creature.`,
  // The stored production saga's shape: no reminder, a II–IV stack.
  "no reminder, a three-badge stack": "I — Kashimo gets reach and double strike permanently give him 2 1/1 counters Kashimo also stuns for 3 turns now\nII, III, IV — Give target creature 4 stun counters and 2 −1/−1 counters (They're gone next turn.)\nV — Tap Kashimo.\nVI — Exile this card.",
  "six rows": `${REMINDER.replace("III", "VI")}\nI — Draw a card.\nII — Create a 2/2 white Knight creature token with vigilance.\nIII — Draw two cards.\nIV — Add {R}{R}{R}.\nV — Knights you control get +2/+1 until end of turn.\nVI — Destroy target artifact or enchantment.`,
  // 300 characters of reminder: more than its box holds at the ladder's
  // floor — it is set in the chapters' column, the rows start under it.
  "a reminder that outgrows its box": `${REMINDER.slice(0, -1)} Whenever you cast your second spell each turn, put another lore counter on this Saga. If it would leave the battlefield, exile it with three time counters on it instead. Skipped chapters don't trigger.)\nI — Draw a card.\nII, III — Each opponent discards a card.`,
};
/** The stand-in badge and divider: flat colours a scan can tell from the
 *  white master, the dark ink and each other. */
const BADGE_RGB = [220, 60, 60];
const DIVIDER_RGB = [60, 170, 60];
const isRgb = (r: Raw, x: number, y: number, [wr, wg, wb]: number[]) => {
  const i = (y * r.width + x) * 3;
  return Math.abs(r.data[i] - wr) < 24 && Math.abs(r.data[i + 1] - wg) < 24 && Math.abs(r.data[i + 2] - wb) < 24;
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
  // The saga: a white master with ITS window clear, and the rail's two
  // bitmaps as flat blocks a pixel scan can find — the badge red, the
  // divider green (neither is "ink": their luminance is above the scans').
  const sagaPx = Buffer.alloc(fw * fh * 4);
  {
    const w = SAGA.artSlot;
    const [sx0, sx1] = [Math.round((w.leftPct / 100) * fw), Math.round(((w.leftPct + w.widthPct) / 100) * fw)];
    const [sy0, sy1] = [Math.round((w.topPct / 100) * fh), Math.round(((w.topPct + w.heightPct) / 100) * fh)];
    for (let y = 0; y < fh; y += 1) {
      for (let x = 0; x < fw; x += 1) {
        if (x >= sx0 && x < sx1 && y >= sy0 && y < sy1) continue;
        sagaPx.fill(255, (y * fw + x) * 4, (y * fw + x) * 4 + 4);
      }
    }
  }
  const sagaFrame = await sharp(sagaPx, { raw: { width: fw, height: fh, channels: 4 } }).png().toBuffer();
  const block = (width: number, height: number, [r, g, b]: number[]) =>
    sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  const files: Record<string, Buffer> = {
    "m15pw/b.png": frame,
    "m15pw/loyalty/b.png": plate,
    "saga/r.png": sagaFrame,
    "saga/chapter/badge.png": await block(118, 132, BADGE_RGB),
    "saga/chapter/divider.png": await block(592, 9, DIVIDER_RGB),
  };
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

  /** A red saga on the stand-in master (white, its window clear). */
  const saga = (rulesText: string, preset: "default" | "hd") =>
    bake(
      {
        cost: "{2}{R}",
        cardType: "enchantment",
        supertype: null,
        subtypes: ["Saga"],
        colorIdentity: ["red"],
        rulesText,
        frameStyle: { template: "saga", finish: "regular" },
      } as Partial<CardPreviewData>,
      preset,
    );

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

    it(`draws the reminder and each chapter's lines where the layout puts them, in content-sized rows, pips as pips (${preset})`, async () => {
      const slot = SAGA.chapters!;
      const column = rectPx(slot.rect, "portrait", 7 / 5, target);
      for (const [name, rules] of Object.entries(SAGAS)) {
        const rail = sagaRail(slot, parseSagaIntro(rules), parseChapters(rules));
        expect(rail.clipped, name).toBe(false);
        const d = sagaRailDrawing(rail, target);
        const raw = await saga(rules, preset);
        d.rows.forEach((row, i) => {
          const label = `${name} row ${i} (${preset})`;
          const placed = linePositions(row.text, target);
          const m = placed.metrics;
          // The text column's ink rows inside this row, as bands — one per
          // line (the lines' ink never touch at 0.97 em).
          const inked: number[] = [];
          let inkRight = -Infinity;
          for (let y = row.top; y < row.bottom; y += 1) {
            let hit = false;
            for (let x = column.left - 2; x < column.right + Math.ceil(0.1 * m.fontPx); x += 1) {
              if (lum(raw, x, y) < 70) {
                hit = true;
                inkRight = Math.max(inkRight, x);
              }
            }
            if (hit) inked.push(y);
          }
          expect(inked.length, label).toBeGreaterThan(0);
          // (At HD the lines' ink never touch — one band per line; at 750 a
          // thin descender's rows anti-alias away, so the count is HD's, and
          // tests/unit/render/rules-no-clip.test.tsx holds every word to its
          // line at both.)
          const bands = inked.filter((y, k) => k === 0 || y - inked[k - 1] > 1).length;
          if (target === "hd") expect(bands, label).toBe(placed.lines.length);
          // Inside its own row, where the layout put its lines (their ink
          // reach is an upper bound; a px for Yoga's rounding of a centred
          // block)…
          expect(inked[0], label).toBeGreaterThanOrEqual(row.top);
          expect(inked.at(-1)!, label).toBeLessThan(row.bottom);
          expect(inked[0], label).toBeGreaterThanOrEqual(Math.floor(placed.lines[0].inkTop) - 1);
          expect(inked.at(-1)!, label).toBeLessThanOrEqual(Math.ceil(placed.lines.at(-1)!.inkBottom) + 1);
          // …its first line on the model's baseline: capitals reach ≈ 0.69 em
          // above it…
          const baseline = placed.lines[0].top + m.baselinePx.regular;
          expect(Math.abs(inked[0] - (baseline - 0.69 * m.fontPx)), label).toBeLessThanOrEqual(0.22 * m.fontPx + 2);
          // …and no line past its column.
          expect(inkRight, label).toBeLessThanOrEqual(column.right + Math.ceil(0.1 * m.fontPx));
        });
        if (d.intro) {
          // The reminder: its lines' ink inside its box, as many bands as
          // lines, the first on the model's baseline.
          const placed = linePositions(d.intro, target);
          const box = rectPx(d.intro.input.rect, "portrait", 7 / 5, target);
          const inked: number[] = [];
          for (let y = box.top; y < box.bottom; y += 1) {
            for (let x = box.left - 2; x < box.right + 4; x += 1) {
              if (lum(raw, x, y) < 70) {
                inked.push(y);
                break;
              }
            }
          }
          if (target === "hd") expect(inked.filter((y, k) => k === 0 || y - inked[k - 1] > 1).length, `${name} reminder (${preset})`).toBe(placed.lines.length);
          const baseline = placed.lines[0].top + placed.metrics.baselinePx.italic;
          expect(Math.abs(inked[0] - (baseline - 0.69 * placed.metrics.fontPx)), `${name} reminder (${preset})`).toBeLessThanOrEqual(3);
          // No ink between the reminder's box and the first row.
          for (let y = box.bottom; y < d.rows[0].top - 2; y += 1) {
            for (let x = box.left; x < box.right; x += 1) expect(lum(raw, x, y) < 70, `${name}: ink under the reminder at ${x},${y}`).toBe(false);
          }
          // One that outgrew its box is drawn in the chapters' column, past
          // where the fixed box ends — and nothing left of that column down
          // to the first row (the fold, then the ribbon, on a real master).
          expect(rail.introGrown, name).toBe(name === "a reminder that outgrows its box");
          if (rail.introGrown) {
            const fixed = rectPx(slot.intro.rect, "portrait", 7 / 5, target);
            expect([box.left, box.right], name).toEqual([column.left, column.right]);
            expect(inked.at(-1)!, name).toBeGreaterThan(fixed.bottom);
            expect(d.rows[0].top, name).toBeGreaterThan(rectPx({ ...slot.rect, topPct: slot.rowsTopPct }, "portrait", 7 / 5, target).top);
            for (let y = box.top; y < d.rows[0].top - 2; y += 1) {
              for (let x = fixed.left; x < column.left - 2; x += 1) expect(lum(raw, x, y) < 70, `${name}: ink left of the chapters' column at ${x},${y}`).toBe(false);
            }
          }
        }
        if (name === "DOM #122") {
          // The standard reminder: the prints' baselines, 341 px at HD.
          const placed = linePositions(d.intro!, target);
          expect(placed.lines[0].top + placed.metrics.baselinePx.italic).toBe(target === "hd" ? 341 : 171);
          // Chapter II's "Add {R}{R}.": two red discs (the bake's r gem,
          // #db8664), never literal braces.
          const row = d.rows[1];
          let red = 0;
          for (let y = row.top; y < row.bottom; y += 1) {
            for (let x = column.left; x < column.right; x += 1) {
              const k = (y * raw.width + x) * 3;
              const [r, g, b] = [raw.data[k], raw.data[k + 1], raw.data[k + 2]];
              if (Math.abs(r - 0xdb) < 12 && Math.abs(g - 0x86) < 12 && Math.abs(b - 0x64) < 12) red += 1;
            }
          }
          const disc = linePositions(row.text, target).metrics.pipPx;
          expect(red, "red pip area").toBeGreaterThan(2 * 0.25 * disc * disc);
        }
      }
    }, 120_000);

    it(`draws every badge and divider at the layout's box, each numeral's ink centred on its badge (${preset})`, async () => {
      const slot = SAGA.chapters!;
      const scale = RULES_TARGET_SCALE[target];
      for (const [name, rules] of Object.entries(SAGAS)) {
        const d = sagaRailDrawing(sagaRail(slot, parseSagaIntro(rules), parseChapters(rules)), target);
        const raw = await saga(rules, preset);
        for (const [i, row] of d.rows.entries()) {
          const label = `${name} row ${i} (${preset})`;
          // The divider: the stand-in's green over its whole box, the row's
          // edge inside it, white above and below.
          if (row.divider) {
            const v = row.divider;
            expect(v.top).toBeLessThanOrEqual(row.top);
            expect(v.top + v.height).toBeGreaterThan(row.top);
            // (Its first px lie under the badge, which is drawn over it.)
            const pastBadge = row.badges[0].left + row.badges[0].width + 2;
            for (const x of [pastBadge, v.left + Math.round(v.width / 2), v.left + v.width - 2]) {
              for (let y = v.top; y < v.top + v.height; y += 1) expect(isRgb(raw, x, y, DIVIDER_RGB), `${label}: divider at ${x},${y}`).toBe(true);
              expect(isRgb(raw, x, v.top - 1, DIVIDER_RGB), `${label}: above the divider`).toBe(false);
              expect(isRgb(raw, x, v.top + v.height, DIVIDER_RGB), `${label}: below the divider`).toBe(false);
            }
          } else {
            expect(i, label).toBe(0);
          }
          expect(row.badges.length, label).toBeGreaterThan(0);
          for (const b of row.badges) {
            // The badge: the stand-in's red at the box's corners and edges,
            // none just outside (the divider's green may cross a point).
            for (const [x, y] of [
              [b.left, b.top],
              [b.left + b.width - 1, b.top],
              [b.left, b.top + b.height - 1],
              [b.left + b.width - 1, b.top + b.height - 1],
            ]) {
              expect(isRgb(raw, x, y, BADGE_RGB), `${label}: badge corner ${x},${y}`).toBe(true);
            }
            expect(isRgb(raw, b.left - 1, b.top + 2, BADGE_RGB), `${label}: left of the badge`).toBe(false);
            expect(isRgb(raw, b.left + b.width, b.top + 2, BADGE_RGB), `${label}: right of the badge`).toBe(false);
            // Inside its row.
            expect(b.top, label).toBeGreaterThanOrEqual(row.top);
            expect(b.top + b.height, label).toBeLessThanOrEqual(row.bottom);
            // The numeral: dark ink inside the badge, centred across it, its
            // capitals centred ONE HD px below the badge's centre (the
            // layout's labelTop; MPlantin's capitals are 0.682 em) — the
            // number itself, not the layout's constant.
            let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
            for (let y = b.top; y < b.top + b.height; y += 1) {
              for (let x = b.left; x < b.left + b.width; x += 1) {
                if (lum(raw, x, y) >= 60) continue;
                [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
              }
            }
            expect(x0, `${label}: "${b.label}" drawn`).toBeLessThan(Infinity);
            expect(Math.abs((x0 + x1 + 1) / 2 - (b.left + b.width / 2)), `${label}: "${b.label}" centred across`).toBeLessThanOrEqual(2.5 * scale + 0.5);
            const capCentre = b.top + b.height / 2 + 1 * scale;
            expect(Math.abs((y0 + y1 + 1) / 2 - capCentre), `${label}: "${b.label}" centred down`).toBeLessThanOrEqual(2 * scale + 1);
            expect(y1 - y0 + 1, `${label}: "${b.label}" capitals`).toBeGreaterThanOrEqual(Math.floor(0.66 * b.fontPx));
            expect(y1 - y0 + 1, `${label}: "${b.label}" capitals`).toBeLessThanOrEqual(Math.ceil(0.72 * b.fontPx) + 1);
          }
        }
      }
    }, 120_000);
  }

  it("preloads the rail's two bitmaps only when it draws them", () => {
    const card = (rulesText: string | null) =>
      ({ cardType: "enchantment", subtypes: ["Saga"], colorIdentity: ["red"], rulesText, frameStyle: { template: "saga", finish: "regular" } }) as unknown as CardPreviewData;
    expect(frameAssetPathsFor(card(SAGAS["DOM #122"]))).toEqual(["/frames/saga/chapter/badge.png", "/frames/saga/chapter/divider.png"]);
    expect(frameAssetPathsFor(card("I — Draw a card."))).toEqual(["/frames/saga/chapter/badge.png"]);
    expect(frameAssetPathsFor(card("Only a reminder."))).toEqual([]);
    expect(frameAssetPathsFor(card(null))).toEqual([]);
  });

  it("leaves nothing below the rail — a saga that is ALL reminder, and a rail past its floor — at both targets", async () => {
    // Without a "I —" marker every line is the reminder; six 600-character
    // chapters can never fit. Both clip inside the rail: below it the card
    // is exactly what a short saga bakes.
    const dense = "Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life. ".repeat(14);
    const overfull = ["I", "II", "III", "IV", "V", "VI"].map((n) => `${n} — ${dense.slice(0, 590)}`).join("\n");
    for (const { target, preset } of TARGETS) {
      const railBox = rectPx(SAGA.chapters!.rect, "portrait", 7 / 5, target);
      const allReminder = sagaRail(SAGA.chapters!, parseSagaIntro(dense), parseChapters(dense));
      expect(allReminder.rows).toHaveLength(0);
      expect(sagaRail(SAGA.chapters!, null, parseChapters(overfull)).clipped).toBe(true);
      const short = await saga("I — Draw a card.", preset);
      const height = short.data.length / 3 / short.width;
      for (const rules of [dense, overfull]) {
        const long = await saga(rules, preset);
        let differ = 0;
        for (let y = railBox.bottom + 1; y < height; y += 1) {
          for (let x = 0; x < railBox.right + 20 * RULES_TARGET_SCALE[target]; x += 1) {
            const k = (y * long.width + x) * 3;
            if (long.data[k] !== short.data[k] || long.data[k + 1] !== short.data[k + 1] || long.data[k + 2] !== short.data[k + 2]) differ += 1;
          }
        }
        expect(differ, `${preset}: ${rules.slice(0, 12)}`).toBe(0);
      }
    }
  }, 120_000);

  it("draws U+2212 exactly as the hyphen MPlantin has, in a chapter and in an ability", async () => {
    const chapter = (dash: string) => saga(`I — Put a ${dash}1/${dash}1 counter on target creature.\nII — Draw a card.`, "default");
    expect((await chapter("−")).sha).toBe((await chapter("-")).sha);
    const walker = (dash: string) => bake({ rulesText: `+1: Target creature gets ${dash}2/${dash}0.\n−3: Draw a card.` }, "default");
    expect((await walker("−")).sha).toBe((await walker("-")).sha);
    // (The badges' "−3" is the same text in both, and parseLoyaltyAbilities
    // normalizes a cost's sign.)
    expect(parseLoyaltyAbilities("−3: Draw a card.")[0].cost).toBe("-3");
  }, 60_000);
});
