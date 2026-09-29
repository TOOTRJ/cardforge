import satori, { type Font } from "satori";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { RulesBoxBake } from "@/lib/render/card-image";
import {
  MANA_FONT_BYTES,
  MPLANTIN_FONT_BYTES,
  MPLANTIN_ITALIC_FONT_BYTES,
} from "@/lib/render/card-fonts";
import { loadLocalAdditionalAsset } from "@/lib/render/fallback-assets";
import {
  adventureRulesLayout,
  mainRulesLayout,
  rulesDraw,
  secondFaceRulesLayout,
  type DrawnStats,
} from "@/lib/cards/rules-box";
import {
  RULES_TARGET_SCALE,
  layoutRulesAt,
  linePositions,
  rectPx,
  type RulesLayout,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH, RULES_SIZE_PX } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { RULES_MATRIX, plainText, type RulesCase } from "@/tests/unit/cards/fixtures/rules-texts";

// ---------------------------------------------------------------------------
// The no-clip matrix (layout v33, TODO 3.29): every rules CONSUMER — the main
// box on every template, the adventure page, the flip / split / aftermath
// second faces (in their own unturned frame), a planeswalker drawn in the
// plain box — × a text matrix (1 line … 1,200 characters, pips and reminder
// text, flavor with its bar and attribution, blank lines, bullets, accented
// capitals on the FIRST line, non-Latin and emoji, level-up text, U+2212),
// drawn by the bake's own RulesBoxBake through real Satori with the box's
// clip OFF, text in a sentinel ink. Read off Satori's SVG (every glyph an
// absolute path, every pip a box), it holds:
//
//   * no ink outside the box — so the real clip never cuts a letter;
//   * no ink in a keep-out — the P/T plate's measured ink, the loyalty
//     shield, the battle's defense disc;
//   * every word inside ITS line's ink band (bands of consecutive lines don't
//     overlap) — so the drawn lines are the layout's, in its order, at its
//     positions;
//   * the first line's ink top and the last line's ink bottom within 2 px of
//     the model's.
//
// The whole matrix at 750 px (the OG image, free live downloads), a subset at
// HD. A layout the fit could only CLIP (past the 42 px floor) is an explicit
// expectation below — its lines still draw at the floor, not smaller.
// ---------------------------------------------------------------------------

const SENTINEL = "#ff00ff";
let FONTS: Font[] = [];

beforeAll(() => {
  FONTS = [
    { name: "MPlantin", data: MPLANTIN_FONT_BYTES, weight: 400, style: "normal" },
    { name: "MPlantin", data: MPLANTIN_ITALIC_FONT_BYTES, weight: 400, style: "italic" },
    { name: "Mana", data: MANA_FONT_BYTES, weight: 400, style: "normal" },
  ];
});

type Box = { x0: number; y0: number; x1: number; y1: number };
type Svg = { words: (Box | null)[]; ink: Box[]; bars: number[] };

/** Satori's SVG, read: its glyph paths (absolute M/L/Q/C/Z — opentype's path
 *  data) in document order, every drawn box (a pip's disc and shadow carry
 *  x / y / width / height) and the flavor bar (a 1 px box in the ink at 44
 *  alpha). Masks, clip paths and defs draw nothing. */
function readSvg(svg: string): Svg {
  const drawn = svg
    .replace(/<defs>[\s\S]*?<\/defs>/g, "")
    .replace(/<mask[\s\S]*?<\/mask>/g, "")
    .replace(/<clipPath[\s\S]*?<\/clipPath>/g, "");
  const out: Svg = { words: [], ink: [], bars: [] };
  for (const m of drawn.matchAll(/<rect ([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (attrs.fill === `${SENTINEL}44`) out.bars.push(Number(attrs.y));
  }
  for (const m of drawn.matchAll(/<path ([^>]*?)\/?>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (attrs.stroke === `${SENTINEL}44`) {
      out.bars.push(Number(/M[\d.]+,([\d.]+)/.exec(attrs.d ?? "")?.[1] ?? NaN));
      continue;
    }
    if (attrs.x !== undefined && attrs.width !== undefined) {
      const [x, y, w, h] = [attrs.x, attrs.y, attrs.width, attrs.height].map(Number);
      out.ink.push({ x0: x, y0: y, x1: x + w, y1: y + h });
      continue;
    }
    const nums = (attrs.d ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    let box: Box | null = null;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const [x, y] = [nums[i], nums[i + 1]];
      box = box
        ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) }
        : { x0: x, y0: y, x1: x, y1: y };
    }
    if (box) out.ink.push(box);
    if (attrs.fill === SENTINEL) out.words.push(box);
  }
  return out;
}

async function bake(layout: RulesLayout, target: RulesTarget): Promise<Svg> {
  const width = RULES_HD_WIDTH[layout.orientation] * RULES_TARGET_SCALE[target];
  const height = Math.round(width * layout.input.aspect);
  const svg = await satori(
    <div style={{ display: "flex", position: "relative", width, height }}>
      {RulesBoxBake({ layout, target, colorHex: SENTINEL, clip: false })}
    </div>,
    { width, height, fonts: [...FONTS], loadAdditionalAsset: loadLocalAdditionalAsset },
  );
  return readSvg(svg);
}

/** The layout's words in drawing order, with the index of their line in
 *  linePositions' order. */
function wordsOf(layout: RulesLayout): { v: string; line: number }[] {
  const out: { v: string; line: number }[] = [];
  let line = 0;
  for (const b of layout.blocks) {
    for (const l of b.lines) {
      for (const run of l.runs) for (const item of run) if (item.t === "w") out.push({ v: item.v, line });
      line += 1;
    }
  }
  return out;
}

// A glyph path's decimals and control points; Yoga's half-px rounding of a
// centred block (the model keeps its offset fractional).
const EPS = 0.51;
// A word against its line's modelled band: the half px above, plus the
// baseline Satori rounds to the px.
const EPS_BAND = 1.05;

async function checkDrawn(layout: RulesLayout, target: RulesTarget, label: string) {
  const placed = linePositions(layout, target);
  const { box } = placed;
  const svg = await bake(layout, target);
  const orientation = layout.orientation;
  const keepOuts = (layout.input.keepOuts ?? []).map((r) => rectPx(r, orientation, layout.input.aspect, target));
  // 1. Nothing outside the box (the clip never cuts ink).
  for (const b of svg.ink) {
    expect(b.x0, `${label}: ink left of the box`).toBeGreaterThanOrEqual(box.left - EPS);
    expect(b.x1, `${label}: ink right of the box`).toBeLessThanOrEqual(box.left + box.width + EPS);
    expect(b.y0, `${label}: ink above the box`).toBeGreaterThanOrEqual(box.top - EPS);
    expect(b.y1, `${label}: ink below the box`).toBeLessThanOrEqual(box.top + box.height + EPS);
  }
  // 2. Nothing in a keep-out.
  for (const k of keepOuts) {
    for (const b of svg.ink) {
      const hit = b.x1 > k.left + EPS && b.x0 < k.right - EPS && b.y1 > k.top + EPS && b.y0 < k.bottom - EPS;
      expect(hit, `${label}: ink in a keep-out`).toBe(false);
    }
  }
  // 3. Every word inside its own line's ink band.
  const words = wordsOf(layout);
  expect(svg.words.length, `${label}: words drawn`).toBe(words.length);
  const bands = new Map<number, { top: number; bottom: number }>();
  words.forEach((w, i) => {
    const b = svg.words[i];
    if (!b) return; // a word with no outline (a stripped emoji)
    const line = placed.lines[w.line];
    expect(b.y0, `${label}: "${w.v}" above line ${w.line}`).toBeGreaterThanOrEqual(line.inkTop - EPS_BAND);
    expect(b.y1, `${label}: "${w.v}" below line ${w.line}`).toBeLessThanOrEqual(line.inkBottom + EPS_BAND);
    const band = bands.get(w.line);
    bands.set(w.line, band ? { top: Math.min(band.top, b.y0), bottom: Math.max(band.bottom, b.y1) } : { top: b.y0, bottom: b.y1 });
  });
  // 4. The first line's ink top and the last line's ink bottom, as modelled:
  //    the model's glyph table is an upper bound, tight (0.005 em) for a
  //    capital's top and a descender's foot — so a first line with a capital
  //    reaches within 2 px of the model's top, a last line with a descender
  //    within 2 px of its bottom.
  const lineText = (i: number) => words.filter((w) => w.line === i).map((w) => w.v).join(" ");
  // (A line with a pip: its disc and shadow set the modelled band, the
  // words stay inside it — checked above.)
  const pipLines = new Set<number>();
  {
    let i = 0;
    for (const b of layout.blocks) {
      for (const l of b.lines) {
        if (l.runs.some((run) => run.some((item) => item.t === "m"))) pipLines.add(i);
        i += 1;
      }
    }
  }
  const first = placed.lines[0];
  const last = placed.lines[placed.lines.length - 1];
  const firstDrawn = bands.get(0);
  const lastDrawn = bands.get(placed.lines.length - 1);
  if (firstDrawn && !pipLines.has(0) && /[A-Z]/.test(lineText(0))) {
    expect(firstDrawn.top - first.inkTop, `${label}: first ink top`).toBeLessThanOrEqual(2);
  }
  const lastIndex = placed.lines.length - 1;
  if (lastDrawn && !pipLines.has(lastIndex) && /[gjpqy]/.test(lineText(lastIndex))) {
    expect(last.inkBottom - lastDrawn.bottom, `${label}: last ink bottom`).toBeLessThanOrEqual(2);
  }
  // 5. The flavor bar where the layout puts it.
  if (placed.bar) {
    const bar = placed.bar.top;
    expect(svg.bars.some((y) => Math.abs(y - bar) <= 1), `${label}: the flavor bar at ${bar} (${svg.bars})`).toBe(true);
  }
  return { placed, svg };
}

// ---------------------------------------------------------------------------
// The consumers
// ---------------------------------------------------------------------------

type Consumer = { key: string; layout: RulesLayout };

const aspectOf = (p: FrameProfile) => (p.orientation === "landscape" ? 5 / 7 : 7 / 5);

/** Each template's consumers of one text, as the renderers build them for a
 *  creature (a battle on the battle frame) — so every drawn stat badge is a
 *  keep-out — plus the walker drawn in the plain box. */
function consumersOf(template: FrameTemplate, text: RulesCase): Consumer[] {
  const layout = getFrameProfile(template);
  const aspect = aspectOf(layout);
  const show: DrawnStats = {
    pt: Boolean(layout.pt),
    defense: Boolean(layout.defense),
    secondFacePt: Boolean(layout.secondFace?.pt),
  };
  const out: Consumer[] = [];
  // The saga's rail replaces its box; a walker with abilities draws rows.
  if (!layout.chapters) {
    out.push({ key: `${template}/main`, layout: mainRulesLayout({ layout, rulesText: text.rules, flavorText: text.flavor, aspect, show }) });
  }
  if (layout.loyalty) {
    // A planeswalker with no abilities: its text in the plain box, clear of
    // its loyalty shield.
    const flavor = [text.rules, text.flavor].filter(Boolean).join("\n");
    out.push({
      key: `${template}/walker`,
      layout: mainRulesLayout({ layout, rulesText: null, flavorText: flavor, aspect, show: { loyalty: true } }),
    });
  }
  const adventure = adventureRulesLayout({ layout, rulesText: text.rules ?? text.flavor, aspect, show });
  if (adventure) out.push({ key: `${template}/adventure`, layout: adventure });
  const second = secondFaceRulesLayout({ layout, rulesText: text.rules ?? text.flavor, aspect, show });
  if (second) out.push({ key: `${template}/second face`, layout: second });
  return out;
}

/** One layout per distinct input: sibling templates that share a rules box
 *  (m15 and its skins) are baked once. */
function matrix(texts: readonly RulesCase[], templates: readonly FrameTemplate[]) {
  const seen = new Map<string, { keys: string[]; layout: RulesLayout; text: RulesCase }>();
  for (const template of templates) {
    for (const text of texts) {
      for (const c of consumersOf(template, text)) {
        const sig = JSON.stringify([c.layout.input, c.layout.sizePx]);
        const hit = seen.get(sig);
        if (hit) hit.keys.push(`${c.key} · ${text.name}`);
        else seen.set(sig, { keys: [`${c.key} · ${text.name}`], layout: c.layout, text });
      }
    }
  }
  return [...seen.values()];
}

// The layouts that only fit by clipping at the 42 px floor — long text in a
// box that can never hold it. Each still draws its lines at the floor (the
// box's overflow clips the rest, as it always has). Consumers → the matrix
// texts they can't hold.
const EXPECTED_FLOOR_CLIPS: readonly [consumers: readonly string[], texts: readonly string[]][] = [
  // 1,200 characters fill no box at 5 pt (the widest full boxes hold ~1,000).
  [
    [
      "agclassic/main", "alphaland/main", "bloomanime/main", "extendedart/main", "lotr/main", "m15/main",
      "m15artifact/main", "m15borderless/main", "m15borderlessartifact/main", "m15devoid/main", "m15land/main",
      "m15pw/main", "m15pw/walker", "m15snow/main", "m15snowland/main", "modern/main", "modernland/main",
      "nyx/main", "retro/main", "retroland/main", "tarkirdraconic/main", "tarkirdragon/main", "tarkirghostfire/main",
    ],
    ["1200 chars"],
  ],
  // The shorter boxes: level-up's seven paragraphs too.
  // …and the emblem's box (TODO 4.52: 74.4–91.9 %H, no plate; an emblem's
  // text is a sentence or two).
  [["avatar/main", "battle/main", "bloomburrow/main", "emblem/main", "expeditionland/main", "lotrscroll/main"], ["1200 chars", "level up"]],
  // Split's halves set their text inside the textbox border their boxes
  // hold (SPLIT_TEXTBOX_BORDER_PX): 400 characters no longer fit either.
  [["split/main", "split/second face"], ["1200 chars", "400 chars", "EOE #30", "TLA #112", "level up"]],
  [["aftermath/second face"], ["1200 chars", "EOE #30"]],
  // The text-box tokens' box (TODO 4.49 (b): 74.5–92.5 %H, the P/T plate in
  // its corner) holds 400 characters but not a planeswalker's worth.
  [["m15tokentext/main", "m15tokenartifacttext/main"], ["1200 chars", "EOE #30", "level up"]],
  [["adventure/main"], ["1200 chars", "400 chars", "EOE #30", "TLA #112"]],
  [["adventure/adventure"], ["1200 chars", "400 chars", "EOE #30", "TLA #112", "level up"]],
  // The ~12 %-high boxes (tokens, flip, aftermath's top half, the ZNR
  // hedron and textless panels): a full card's text never fits them.
  [
    ["aftermath/main", "flip/main", "m15token/main", "m15tokenartifact/main"],
    ["1200 chars", "400 chars", "EOE #30", "TLA #112", "accented first line", "blank lines", "level up", "modal bullets"],
  ],
  [["flip/second face"], ["1200 chars", "400 chars", "EOE #30", "TLA #112", "blank lines", "level up", "modal bullets"]],
  [
    ["fullart/main", "m15textless/main", "m15textlessland/main"],
    ["1200 chars", "400 chars", "EOE #30", "TLA #112", "accented first line", "blank lines", "level up"],
  ],
  [
    ["alphatoken/main"],
    [
      "1200 chars", "400 chars", "EOE #30", "TLA #112", "accented first line", "blank lines", "flavor only",
      "level up", "modal bullets", "pips + reminder",
    ],
  ],
];

const expectedClips = () =>
  new Set(EXPECTED_FLOOR_CLIPS.flatMap(([consumers, texts]) => consumers.flatMap((c) => texts.map((t) => `${c} · ${t}`))));

describe("rules consumers — no clip, no keep-out ink, the layout's lines (Satori, 750 px)", () => {
  const cases = matrix(RULES_MATRIX, FRAME_TEMPLATE_VALUES);

  it("covers every template's consumers", () => {
    const keys = new Set(cases.flatMap((c) => c.keys.map((k) => k.split(" · ")[0])));
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(t);
      if (!p.chapters) expect(keys.has(`${t}/main`), t).toBe(true);
    }
    expect(keys.has("adventure/adventure")).toBe(true);
    for (const t of ["flip", "split", "aftermath"]) expect(keys.has(`${t}/second face`), t).toBe(true);
    expect(keys.has("m15pw/walker")).toBe(true);
  });

  it("clips only where the floor can't hold the text — and says so", () => {
    const clipped = cases.filter((c) => c.layout.clipped);
    for (const c of clipped) expect(c.layout.sizePx, c.keys[0]).toBe(RULES_SIZE_PX.floor);
    const names = new Set(clipped.flatMap((c) => c.keys));
    const expected = expectedClips();
    expect([...names].filter((k) => !expected.has(k)).sort(), "clips no one expected").toEqual([]);
    expect([...expected].filter((k) => !names.has(k)).sort(), "expected clips that fit now").toEqual([]);
  });

  it("draws every other layout inside its box, clear of every keep-out, line for line", async () => {
    let n = 0;
    for (const c of cases) {
      if (c.layout.clipped) continue;
      await checkDrawn(c.layout, "default", c.keys[0]);
      n += 1;
    }
    expect(n).toBeGreaterThan(100);
  }, 120_000);
});

describe("rules consumers — the HD bake (subset)", () => {
  const TEMPLATES: FrameTemplate[] = ["m15", "m15pw", "m15token", "adventure", "flip", "split", "aftermath", "battle", "retro", "m15borderless"];
  const TEXTS = RULES_MATRIX.filter((t) => ["400 chars", "pips + reminder", "accented first line", "blank lines", "EOE #30", "minus sign", "flavor + attribution"].includes(t.name));
  const cases = matrix(TEXTS, TEMPLATES);

  it("draws inside its box, clear of every keep-out, line for line", async () => {
    for (const c of cases) {
      if (c.layout.clipped) continue;
      await checkDrawn(c.layout, "hd", c.keys[0]);
    }
  }, 120_000);

  it("draws the same lines at both targets, the 750 font exactly half the HD one", () => {
    for (const c of cases) {
      const [hd, small] = [rulesDraw(c.layout, "hd"), rulesDraw(c.layout, "default")];
      expect(small.fontPx * 2, c.keys[0]).toBe(hd.fontPx);
      expect(small.blocks.map((b) => (b.kind === "blank" ? 0 : b.lines))).toEqual(hd.blocks.map((b) => (b.kind === "blank" ? 0 : b.lines)));
    }
  });
});

describe("the 750 bake's own whole-px gaps (s = 50 / 58 / 66 / 74)", () => {
  // Doubled, the 750 bake's word gap is a px wider than the HD one at these
  // sizes: a line the HD column would just hold must break for the 750
  // column. Lines filling the 750 column to within 10 px, drawn at 750.
  it("never draws a 750 line past its column", async () => {
    const m15 = getFrameProfile("m15");
    const vocabulary = plainText(400).split(" ").concat(["a", "of", "it", "{G}", "{T}:", "+1/+1", "(reminder)", "Trample"]);
    let tight = 0;
    for (const size of [50, 58, 66, 74]) {
      let found = false;
      for (let seed = 1; seed < 400 && !found; seed += 1) {
        // A deterministic shuffle of words, three lines' worth.
        let x = seed;
        const words = Array.from({ length: 24 }, () => {
          x = (x * 1103515245 + 12345) % 2147483648;
          return vocabulary[x % vocabulary.length];
        });
        const layout = layoutRulesAt(
          {
            rulesText: words.join(" "),
            rect: m15.rules.rect,
            aspect: 7 / 5,
            sizePct: m15.rules.sizePct,
            padPx: m15.rules.padPx,
            vAlign: "start",
          },
          size,
        );
        if (layout.clipped) continue;
        const placed = linePositions(layout, "default");
        // A line (not the last) that fills the 750 column to within 10 px.
        const full = placed.lines.slice(0, -1).some((l) => placed.interior.width - l.width <= 10);
        if (!full) continue;
        found = true;
        tight += 1;
        await checkDrawn(layout, "default", `${size} px, seed ${seed}`);
      }
    }
    expect(tight).toBe(4);
  }, 60_000);
});

describe("a layout clipped at the floor", () => {
  // Its flavor bar lands past the box. The bar is a 1 px box, never a
  // border: Satori clips a border with a clip path of its own, so a border
  // escaped the box's overflow clip and drew a line across the frame.
  it("keeps its flavor bar — and all its ink — inside the box's clip", async () => {
    const token = getFrameProfile("m15token");
    const layout = mainRulesLayout({
      layout: token,
      rulesText: plainText(800),
      flavorText: "\"The line holds.\"\n—Captain Ysolde",
      aspect: 7 / 5,
      show: {},
    });
    const placed = linePositions(layout, "default");
    const { box } = placed;
    expect(layout.clipped).toBe(true);
    expect(placed.bar && placed.bar.top > box.top + box.height).toBe(true);
    const [width, height] = [750, 1050];
    const svg = await satori(
      <div style={{ display: "flex", position: "relative", width, height }}>
        {RulesBoxBake({ layout, target: "default", colorHex: SENTINEL })}
      </div>,
      { width, height, fonts: [...FONTS], loadAdditionalAsset: loadLocalAdditionalAsset },
    );
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let outside = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const inBox =
          x >= Math.floor(box.left) &&
          x < Math.ceil(box.left + box.width) &&
          y >= Math.floor(box.top) &&
          y < Math.ceil(box.top + box.height);
        if (!inBox && data[(y * info.width + x) * 4 + 3] > 0) outside += 1;
      }
    }
    expect(outside, "pixels drawn outside the box").toBe(0);
  });
});
