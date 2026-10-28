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
import { sagaRail, sagaRailDrawing, type SagaRail } from "@/lib/cards/saga-rail";
import { M15_HOLO_STAMP_KEEP_OUT } from "@/lib/cards/holo-stamp";
import { STATION, parseStationText, type StationText } from "@/lib/cards/station";
import { stationLayout, type StationLayout } from "@/lib/cards/station-layout";
import stationOracle from "@/tests/unit/cards/fixtures/station-oracle.json";
import { getFrameProfile, profileOffersRulesAlign, type FrameProfile } from "@/lib/cards/template-layout";
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
//
// The saga's rail (TODO 4.21c) is the same drawing: its reminder block and
// each chapter are rules layouts in their own boxes (lib/cards/saga-rail.ts
// sagaRailDrawing), drawn by RulesBoxBake — held to the same four rules at
// both targets, each chapter inside ITS row, on the matrix's texts split
// over chapters and on the rail's own shapes (no reminder, a long reminder,
// a reminder that outgrows its box, stacks, six rows).
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
/** `contours`: the ink as each glyph's own contours — a word is ONE path,
 *  so its box spans every glyph in it (a descender at its left, a raised
 *  quote at its right); the keep-out check reads each subpath's box (the
 *  hull of its points, control points included: an upper bound of its
 *  ink). A drawn box (a pip) is its own contour. */
type Svg = { words: (Box | null)[]; ink: Box[]; contours: Box[]; bars: number[] };

/** Satori's SVG, read: its glyph paths (absolute M/L/Q/C/Z — opentype's path
 *  data) in document order, every drawn box (a pip's disc and shadow carry
 *  x / y / width / height) and the flavor bar (a 1 px box in the ink at 44
 *  alpha). Masks, clip paths and defs draw nothing. */
function readSvg(svg: string): Svg {
  const drawn = svg
    .replace(/<defs>[\s\S]*?<\/defs>/g, "")
    .replace(/<mask[\s\S]*?<\/mask>/g, "")
    .replace(/<clipPath[\s\S]*?<\/clipPath>/g, "");
  const out: Svg = { words: [], ink: [], contours: [], bars: [] };
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
      out.contours.push({ x0: x, y0: y, x1: x + w, y1: y + h });
      continue;
    }
    const boxOf = (d: string): Box | null => {
      const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      let box: Box | null = null;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const [x, y] = [nums[i], nums[i + 1]];
        box = box
          ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) }
          : { x0: x, y0: y, x1: x, y1: y };
      }
      return box;
    };
    const box = boxOf(attrs.d ?? "");
    if (box) out.ink.push(box);
    // Each subpath (absolute M/L/Q/C/Z: an M opens one) on its own.
    for (const sub of (attrs.d ?? "").split(/(?=M)/)) {
      const c = boxOf(sub);
      if (c) out.contours.push(c);
    }
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
  // 2. Nothing in a keep-out — judged glyph contour by glyph contour (a
  // word's whole box would put a descender at its left and a raised quote
  // at its right into one rectangle that ink never fills: "fall.”" beside
  // the scroll plate's rolled top, TODO 4.11).
  for (const k of keepOuts) {
    for (const b of svg.contours) {
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
function consumersOf(template: FrameTemplate, text: RulesCase, rulesAlign?: "center"): Consumer[] {
  const layout = getFrameProfile(template);
  const aspect = aspectOf(layout);
  const show: DrawnStats = {
    pt: Boolean(layout.pt),
    defense: Boolean(layout.defense),
    secondFacePt: Boolean(layout.secondFace?.pt),
  };
  const out: Consumer[] = [];
  // The saga's rail replaces its box; a walker with abilities draws rows; a
  // textless frame (the full-art token's textless height) draws no box.
  // (The station frame sets its text through its own tiers layout, never this box — TODO 4.27a; "the station box" below holds its bands to the same rules.)
  if (!layout.chapters && !layout.textless && !layout.tiers) {
    out.push({ key: `${template}/main`, layout: mainRulesLayout({ layout, rulesText: text.rules, flavorText: text.flavor, aspect, show, rulesAlign }) });
  }
  if (layout.loyalty) {
    // A planeswalker with no abilities: its text in the plain box, clear of
    // its loyalty shield.
    const flavor = [text.rules, text.flavor].filter(Boolean).join("\n");
    out.push({
      key: `${template}/walker`,
      layout: mainRulesLayout({ layout, rulesText: null, flavorText: flavor, aspect, show: { loyalty: true }, rulesAlign }),
    });
  }
  const adventure = adventureRulesLayout({ layout, rulesText: text.rules ?? text.flavor, aspect, show, rulesAlign });
  if (adventure) out.push({ key: `${template}/adventure`, layout: adventure });
  const second = secondFaceRulesLayout({ layout, rulesText: text.rules ?? text.flavor, aspect, show, rulesAlign });
  if (second) out.push({ key: `${template}/second face`, layout: second });
  return out;
}

/** One layout per distinct input: sibling templates that share a rules box
 *  (m15 and its skins) are baked once. */
function matrix(texts: readonly RulesCase[], templates: readonly FrameTemplate[], rulesAlign?: "center") {
  const seen = new Map<string, { keys: string[]; layout: RulesLayout; text: RulesCase }>();
  for (const template of templates) {
    for (const text of texts) {
      for (const c of consumersOf(template, text, rulesAlign)) {
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
      "agclassic/main", "alphaland/main", "bloomanime/main", "extendedart/main", "extendedartland/main", "lotr/main", "lotrscroll/main", "m15/main",
      "m15artifact/main", "m15borderless/main", "m15borderlessartifact/main", "m15borderlessland/main", "m15devoid/main", "m15land/main",
      "m15pw/main", "m15pw/walker", "m15snow/main", "m15snowland/main", "modern/main", "modernland/main",
      // 4.33's borderless planeswalkers: m15pw's box, and the tall one's
      // 138 px taller still can't hold them.
      "m15borderlesspw/main", "m15borderlesspw/walker", "m15borderlesspwtall/main", "m15borderlesspwtall/walker",
      "nyx/main", "retro/main", "retroland/main", "tarkirdraconic/main", "tarkirdragon/main", "tarkirghostfire/main",
      // 5.1a's transform bodies: M15's box on every face.
      "m15dfcfront/main", "m15dfcback/main", "m15dfcbackleft/main", "m15dfclandfront/main", "m15dfclandback/main",
      // 5.1b's modal bodies: the same box, the flipside strip a keep-out
      // in its last lines.
      "m15mdfcfront/main", "m15mdfcback/main", "m15mdfclandfront/main", "m15mdfclandback/main",
      // 4.5c's Vehicle frame: m15artifact's box, its own plate in the corner.
      "m15vehicle/main",
      // 4.7's Nyx dress: m15's box.
      "m15nyx/main",
      // 4.25's Universes Beyond frames: their M15 twins' boxes.
      "m15ub/main", "m15ubartifact/main", "m15ubland/main",
      // 4.11's Zendikar Rising hedron showcase: the CC-framed M15 box (layout v63).
      "fullart/main",
      // 5.7's borderless double-faced bodies: m15borderless's box.
      "m15borderlessdfcfront/main", "m15borderlessdfcback/main", "m15borderlessmdfcfront/main", "m15borderlessmdfcback/main",
      // 4.11's Avatar elemental and Bloomburrow woodland showcases: M15's box (layout v69).
      "avatar/main", "bloomburrow/main",
      // 4.11 wave 2's New Capenna Art Deco: M15's box in its translucent one.
      "sncartdeco/main",
      // 4.11 wave 2's D&D Sourcebook: M15's box ending above the page's
      // rounded foot (1877.5 px) — it holds the level-up card, not 1,200
      // characters.
      "dndsourcebook/main",
      // 4.11 wave 2's MKM dossier: M15's box (a new template).
      "dossier/main",
      // 4.11 wave 2's Enchanting Tales: Card Conjurer's text rect (604 px,
      // 1313–1917) — it holds the run's fullest boxes, not 1,200 characters.
      "enchantingtales/main",
      // 4.11 wave 2's Dominaria United Stained Glass: M15's box 8.5 px
      // shorter at each end (the run's own) — it holds the level-up card,
      // not 1,200 characters.
      "stainedglass/main",
      // 4.11 wave 2's Strixhaven Mystical Archive: M15's box, 3 px up.
      "mysticalarchive/main",
    ],
    ["1200 chars"],
  ],
  // The shorter boxes: level-up's seven paragraphs too.
  // …and the emblem's box (TODO 4.52: 74.4–91.9 %H, no plate; an emblem's
  // text is a sentence or two).
  // …and the 2015 Expeditions' rules panel (TODO 4.11 wave 1: 432 px over
  // the art — a land's text is a line or four).
  // (The Lord of the Rings scroll took M15's box with its Card Conjurer
  // re-source, layout v62 / TODO 4.11: it holds the level-up card now —
  // and the Avatar elemental and Bloomburrow woodland with theirs, v69.)
  [["battle/main", "emblem/main", "expeditionlandbfz/main"], ["1200 chars", "level up"]],
  // The 2020 Expeditions' panel (layout v64: 494 px, where the MSE box was
  // 441) holds the level-up card and the typed text now; 1,200 characters
  // still don't fit.
  [["expeditionland/main"], ["1200 chars"]],
  // Split's halves on Card Conjurer's boxes (layout v43, TODO 4.21b): each
  // 780 × 499 px text column holds 400 characters, TLA #112 and the level-up
  // card at the floor again (the MSE boxes, 57 / 54 px of padding inside a
  // narrower rect, clipped all three); a full card's 1,200 characters and
  // EOE #30's three abilities still don't fit half a card.
  [["split/main", "split/second face"], ["1200 chars", "EOE #30"]],
  [["aftermath/second face"], ["1200 chars", "EOE #30"]],
  // The text-box tokens' box (TODO 4.49 (b): 74.5–92.5 %H, the P/T plate in
  // its corner) holds 400 characters but not a planeswalker's worth.
  [["m15tokentext/main", "m15tokenartifacttext/main"], ["1200 chars", "EOE #30", "level up"]],
  // …and the arch's TALL box (TODO 4.55: 63.1–92.5 %H, the plate in its
  // corner) holds everything but 1,200 characters, as the full-art tall box.
  [["m15tokentall/main", "m15tokenartifacttall/main"], ["1200 chars"]],
  // The full-art tokens (TODO 4.48): the regular box (73.9–92.1 %H, the
  // plate in its corner) holds what the arch's does; the tall box (62.8 %H
  // down) everything but 1,200 characters. The textless height draws no box
  // (no consumer: the renderers skip a textless frame's rules).
  // …and their Nyx dress (TODO 4.51): the same boxes.
  [["m20tokentext/main", "m20tokenartifacttext/main", "m20tokennyxtext/main", "m20tokenartifactnyxtext/main"], ["1200 chars", "EOE #30", "level up"]],
  [["m20tokentall/main", "m20tokenartifacttall/main", "m20tokennyxtall/main", "m20tokenartifactnyxtall/main"], ["1200 chars"]],
  // Adventure's pages are Card Conjurer's (layout v38, TODO 4.21a): the
  // creature's right page 65.0–88.58 %H (was 63.5–92.0) and the adventure's
  // 73.58–88.58 (was 71.6–91.9), the prints' boxes — a few more of the long
  // texts clip at the floor there, as they would on a printed page.
  [["adventure/main"], ["1200 chars", "400 chars", "EOE #30", "TLA #112", "level up"]],
  [["adventure/adventure"], ["1200 chars", "400 chars", "200 chars", "EOE #30", "TLA #112", "level up", "blank lines", "flavor only", "pips + reminder"]],
  // The Prepare frame (TODO 4.27): the creature's half of M15's box
  // (63.6–91.6 %H, 615 px wide, at the standard 76 px ceiling since owner
  // Round 79) and the spell's page (73.3–88.2 %H, 616 px from x 774: the
  // text on print's columns since Round 79, 5 px narrower than the first
  // cut — "pips + reminder" clips there now, as on the adventure's page) —
  // the prints' boxes; a full card's text clips at the floor, as on print.
  [["prepare/main"], ["1200 chars", "EOE #30", "typed, as printed"]],
  [["prepare/adventure"], ["1200 chars", "400 chars", "EOE #30", "TLA #112", "level up", "blank lines", "flavor only", "pips + reminder", "typed, as printed"]],
  // The ~12 %-high boxes (tokens, flip, aftermath's top half, the ZNR
  // hedron panel): a full card's text never fits them. (The textless promo
  // pair draws no box since layout v58 — no consumer, as the full-art
  // token's textless height.)
  [
    ["aftermath/main", "flip/main", "m15token/main", "m15tokenartifact/main"],
    ["1200 chars", "400 chars", "EOE #30", "TLA #112", "accented first line", "blank lines", "level up", "modal bullets"],
  ],
  [["flip/second face"], ["1200 chars", "400 chars", "EOE #30", "TLA #112", "blank lines", "level up", "modal bullets"]],
  // (fullart's box is the CC-framed M15 box since layout v63, TODO 4.11.)
  // "typed, as printed" (TODO 6.11): five paragraphs — an ability word, a
  // modal list with its bullets, quoted abilities — over a quoted flavor
  // line and its attribution. The short boxes that can't hold the level-up
  // card's paragraphs can't hold these; every full-size box draws them.
  [
    [
      "adventure/adventure", "adventure/main", "aftermath/main", "battle/main", "emblem/main",
      "expeditionlandbfz/main", "flip/main", "flip/second face", "m15token/main", "m15tokenartifact/main", "m15tokenartifacttext/main", "m15tokentext/main",
      "m20tokenartifacttext/main", "m20tokentext/main", "m20tokenartifactnyxtext/main", "m20tokennyxtext/main", "split/main",
    ],
    ["typed, as printed"],
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
      if (!p.chapters && !p.textless && !p.tiers) expect(keys.has(`${t}/main`), t).toBe(true);
      if (p.textless) expect(keys.has(`${t}/main`), t).toBe(false);
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

describe("the holofoil stamp's arch on the borderless frames (TODO 4.9d) — a keep-out never adds a clip", () => {
  // The renderers pass the profile's keep-out while the stamp is drawn
  // (DrawnStats.stamp): on the borderless frames the ARCH'S SHAPE (owner
  // Round 70: 4 px columns 2 px above the lifted bevel, keepOutShape).
  const stampedText = (template: FrameTemplate, rulesText: string | null | undefined, flavorText: string | null | undefined) => {
    const layout = getFrameProfile(template);
    const slot = (layout.overlays ?? []).find((o) => o.anatomy === "holoStamp");
    if (!slot || slot.anatomy !== "holoStamp") throw new Error(`${template} has no notch`);
    expect(slot.stamp.keepOutShape?.length, template).toBeGreaterThan(30);
    const show: DrawnStats = { pt: Boolean(layout.pt) };
    const plain = mainRulesLayout({ layout, rulesText, flavorText, aspect: aspectOf(layout), show });
    const arch = mainRulesLayout({ layout, rulesText, flavorText, aspect: aspectOf(layout), show: { ...show, stamp: slot.stamp.keepOutShape ?? slot.stamp.keepOut } });
    return { plain, arch };
  };
  const stamped = (template: FrameTemplate, text: RulesCase) => stampedText(template, text.rules, text.flavor);
  /** The owner's sweep (Round 70): a text of 1 … 95 words. */
  const SWEEP_WORDS =
    "Whenever this creature attacks each opponent loses two life and you gain two life then draw a card and discard a card unless you control an artifact Flying vigilance and trample until end of turn target creature gets plus three plus three and gains first strike when it dies return it to the battlefield under its owner's control at the beginning of your upkeep scry two then you may sacrifice a land if you do create a treasure token search your library for a basic land card reveal it put it into your hand then shuffle".split(" ");
  const sweepText = (n: number) => `${Array.from({ length: n }, (_, i) => SWEEP_WORDS[i % SWEEP_WORDS.length]).join(" ")}.`;
  const TEMPLATES = ["m15borderless", "m15borderlessartifact", "m15borderlessland"] as const;

  it("clips exactly the texts the box clips without the stamp, never sets one larger", () => {
    for (const template of TEMPLATES) {
      for (const text of RULES_MATRIX) {
        const { plain, arch } = stamped(template, text);
        expect(arch.clipped, `${template} · ${text.name}`).toBe(plain.clipped);
        expect(arch.sizePx, `${template} · ${text.name}`).toBeLessThanOrEqual(plain.sizePx);
      }
    }
  });

  it("the sweep of 1 … 95 words: no new clip, a step down only where glyphs meet the arch (2 of 95 on each frame)", () => {
    for (const template of TEMPLATES) {
      const stepped: number[] = [];
      for (let n = 1; n <= 95; n += 1) {
        const { plain, arch } = stampedText(template, sweepText(n), null);
        expect(arch.clipped, `${template} · ${n} words`).toBe(plain.clipped);
        if (arch.sizePx < plain.sizePx) stepped.push(n);
      }
      // (The same sweep on m15 with its one-rect keep-out steps 10.)
      expect(stepped, template).toEqual([68, 69]);
    }
  });

  it("draws the sweep's stamped layouts clear of the arch, glyph by glyph (750 px)", async () => {
    for (let n = 1; n <= 95; n += 1) {
      const { arch } = stampedText("m15borderless", sweepText(n), null);
      if (arch.clipped) continue;
      await checkDrawn(arch, "default", `m15borderless stamped · ${n} words`);
    }
  }, 300_000);

  it("draws every stamped layout inside its box, clear of the arch, line for line (750 px)", async () => {
    let n = 0;
    for (const text of RULES_MATRIX) {
      const { arch } = stamped("m15borderless", text);
      if (arch.clipped) continue;
      await checkDrawn(arch, "default", `m15borderless stamped · ${text.name}`);
      n += 1;
    }
    expect(n).toBeGreaterThan(10);
  }, 120_000);
});

describe("the borderless walkers' arch (TODO 4.9d, owner Round 70) — the plain box keeps out of it, never a new clip", () => {
  // A walker with no ability rows (or another card forced onto the frame)
  // draws its text in the plain box, which reads the arch's columns
  // (DrawnStats.stamp) beside the loyalty shield. The rows themselves are
  // held in tests/unit/frames/borderless-walker-holo-stamp.test.ts.
  const TEMPLATES = ["m15borderlesspw", "m15borderlesspwtall"] as const;
  const stamped = (template: FrameTemplate, text: RulesCase) => {
    const layout = getFrameProfile(template);
    const slot = (layout.overlays ?? []).find((o) => o.anatomy === "holoStamp");
    if (!slot || slot.anatomy !== "holoStamp") throw new Error(`${template} has no notch`);
    expect(slot.stamp.aboveRows, template).toBe(true);
    const show: DrawnStats = { loyalty: true };
    const plain = mainRulesLayout({ layout, rulesText: text.rules, flavorText: text.flavor, aspect: aspectOf(layout), show });
    const arch = mainRulesLayout({ layout, rulesText: text.rules, flavorText: text.flavor, aspect: aspectOf(layout), show: { ...show, stamp: slot.stamp.keepOutShape ?? slot.stamp.keepOut } });
    return { plain, arch };
  };

  it("clips exactly the texts the box clips without the stamp, never sets one larger", () => {
    for (const template of TEMPLATES) {
      for (const text of RULES_MATRIX) {
        const { plain, arch } = stamped(template, text);
        expect(arch.clipped, `${template} · ${text.name}`).toBe(plain.clipped);
        expect(arch.sizePx, `${template} · ${text.name}`).toBeLessThanOrEqual(plain.sizePx);
      }
    }
  });

  it("draws every stamped layout inside its box, clear of the arch and the shield, line for line (750 px)", async () => {
    let n = 0;
    for (const template of TEMPLATES) {
      for (const text of RULES_MATRIX) {
        const { arch } = stamped(template, text);
        if (arch.clipped) continue;
        await checkDrawn(arch, "default", `${template} stamped · ${text.name}`);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(20);
  }, 240_000);
});

describe("rules consumers — the HD bake (subset)", () => {
  const TEMPLATES: FrameTemplate[] = ["m15", "m15pw", "m15token", "adventure", "flip", "split", "aftermath", "battle", "retro", "m15borderless"];
  // "symbols as printed" (layout v49): the Phyrexian pip's larger disc is drawn
  // at the stored bake's own px too — not only at 750.
  const TEXTS = RULES_MATRIX.filter((t) => ["400 chars", "pips + reminder", "symbols as printed", "accented first line", "blank lines", "EOE #30", "minus sign", "flavor + attribution", "typed, as printed"].includes(t.name));
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

// ---------------------------------------------------------------------------
// The card's text alignment (TODO 4.21e, FrameStyle.rulesAlign): the whole
// matrix again with every consumer's lines CENTRED, held to the same four
// rules — a centred line is still inside its box, clear of every keep-out
// where it now lands, and the layout's line.
// ---------------------------------------------------------------------------
/** Matrix texts that fit their box left-aligned and clip centred: none, by
 *  the rule (a centred line that would land on a drawn badge is held short
 *  of it; the left-aligned line's own place is always free). */
const CENTRED_ONLY_CLIPS: string[] = [];

describe("rules consumers, centred (FrameStyle.rulesAlign) — no clip, no keep-out ink, the layout's lines", () => {
  const cases = matrix(RULES_MATRIX, FRAME_TEMPLATE_VALUES, "center");
  const left = matrix(RULES_MATRIX, FRAME_TEMPLATE_VALUES);

  it("centres every consumer of a frame that offers the choice, and no other", () => {
    for (const c of cases) {
      const template = c.keys[0].split("/")[0] as FrameTemplate;
      expect(c.layout.input.align, c.keys[0]).toBe(profileOffersRulesAlign(getFrameProfile(template)) ? "center" : undefined);
    }
    expect(cases.filter((c) => c.layout.input.align === "center").length).toBeGreaterThan(300);
  });

  it("sets every text at exactly the left-aligned size, and clips none the left-aligned layout fits (owner 2026-10-07: held short of a badge, never a size step)", () => {
    const leftByKey = new Map(left.flatMap((c) => c.keys.map((k) => [k, c.layout] as const)));
    let n = 0;
    for (const c of cases) {
      for (const k of c.keys) {
        const twin = leftByKey.get(k);
        expect(twin, k).toBeDefined();
        expect(c.layout.sizePx, k).toBe(twin!.sizePx);
        if (!twin!.clipped) expect(c.layout.clipped, k).toBe(false);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(800);
    const leftClips = new Set(left.filter((c) => c.layout.clipped).flatMap((c) => c.keys));
    const only = cases.filter((c) => c.layout.clipped).flatMap((c) => c.keys).filter((k) => !leftClips.has(k)).sort();
    expect(only, "centred-only clips").toEqual(CENTRED_ONLY_CLIPS);
  });

  it("draws every other layout inside its box, clear of every keep-out, line for line (750 px)", async () => {
    let n = 0;
    for (const c of cases) {
      if (c.layout.clipped || c.layout.input.align !== "center") continue;
      const { placed } = await checkDrawn(c.layout, "default", `centred ${c.keys[0]}`);
      // …and the lines are where the layout centred them: some line moved.
      if (placed.lines.some((l) => placed.interior.width - l.width > 8)) expect(placed.lines.some((l) => l.indent > 0), c.keys[0]).toBe(true);
      n += 1;
    }
    expect(n).toBeGreaterThan(100);
  }, 240_000);

  it("the HD bake (subset): inside its box, clear of every keep-out, the same lines at both targets", async () => {
    const TEMPLATES: FrameTemplate[] = ["m15", "m15token", "m15tokentext", "adventure", "flip", "split", "aftermath", "battle", "retro", "emblem", "m15dfcfront", "m15mdfcback"];
    const TEXTS = RULES_MATRIX.filter((t) => ["one line", "short + flavor", "400 chars", "pips + reminder", "accented first line", "blank lines", "EOE #30", "flavor + attribution", "modal bullets", "typed, as printed"].includes(t.name));
    for (const c of matrix(TEXTS, TEMPLATES, "center")) {
      const [hd, small] = [rulesDraw(c.layout, "hd"), rulesDraw(c.layout, "default")];
      expect(small.blocks.map((b) => (b.kind === "blank" ? 0 : b.lines))).toEqual(hd.blocks.map((b) => (b.kind === "blank" ? 0 : b.lines)));
      if (!c.layout.clipped) await checkDrawn(c.layout, "hd", `centred ${c.keys[0]}`);
    }
  }, 240_000);
});

// …on the saga AND on the double-faced saga front (TODO 5.5 (b)), whose
// rail ends at the reverse-P/T tab's top (SAGA_DFC_RAIL_FOOT_PX), and on its BACK
// (5.5 (b) PR 2: the saga's rail, read from a back face's plain text).
for (const template of ["saga", "sagadfcfront", "sagadfcback"] as const)
describe(`the saga rail on ${template} — its reminder block and every chapter row (TODO 4.21c, 5.5 (b))`, () => {
  const SLOT = getFrameProfile(template).chapters!;
  const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)";
  const NUMERALS = ["I", "II", "III", "IV", "V", "VI"];
  /** A matrix text as a saga: its paragraphs dealt over (at most six)
   *  chapters, under the standard reminder — or, for a flavor-only case,
   *  the flavor as the reminder over one chapter. */
  function sagaOf(text: RulesCase): SagaRail {
    const paragraphs = (text.rules ?? "Draw a card.").split(/\n+/).filter((p) => p.trim());
    const rows = paragraphs.slice(0, 6).map((p, i) => ({ marker: NUMERALS[i], text: i === 5 ? paragraphs.slice(5).join("\n") : p }));
    return sagaRail(SLOT, text.rules ? REMINDER : text.flavor, rows);
  }
  const SHAPES: Record<string, SagaRail> = {
    "no reminder": sagaRail(SLOT, null, [
      { marker: "I", text: "Create a 2/2 white Knight creature token with vigilance." },
      { marker: "II", text: "Knights you control get +2/+1 until end of turn." },
    ]),
    "a three-badge stack": sagaRail(SLOT, REMINDER, [
      { marker: "I,II,III", text: "Create a 3/3 black Wraith creature token with menace. The Ring tempts you." },
      { marker: "IV", text: "For each opponent, gain control of up to one target creature that player controls until end of turn. Untap those creatures. They gain haste until end of turn. The Ring tempts you." },
    ]),
    "six rows": sagaRail(
      SLOT,
      REMINDER,
      NUMERALS.map((marker, i) => ({ marker, text: ["Draw a card.", "Add {G}{G}{G}.", "Éowyn's Élan — Put a −1/−1 counter on target creature.", "Scry 2.", "Create a Treasure token. (It's an artifact.)", "Destroy target artifact or enchantment."][i] })),
    ),
    "a long reminder": sagaRail(SLOT, `${REMINDER.slice(0, -1)} Whenever you cast your second spell each turn, put another lore counter on this Saga, then scry 1.)`, [
      { marker: "I", text: "Draw a card." },
      { marker: "II,III", text: "Each opponent discards a card." },
    ]),
    // 330 characters: past what the reminder's box holds at the floor — it
    // is set in the chapters' column, as tall as its text, the rows under it.
    "a reminder that outgrows its box": sagaRail(
      SLOT,
      `${REMINDER.slice(0, -1)} Whenever you cast your second spell each turn, put another lore counter on this Saga, then scry 1. If this Saga would leave the battlefield, exile it with three time counters on it instead. Skipped chapters don't trigger.)`,
      [
        { marker: "I,II", text: "Create a 2/2 white Knight creature token with vigilance." },
        { marker: "III", text: "Knights you control get +2/+1 until end of turn." },
      ],
    ),
    "a stored saga (no reminder, II–IV on one row, two paragraphs)": sagaRail(SLOT, null, [
      { marker: "I", text: "Kashimo gets reach and double strike permanently give him 2 1/1 counters Kashimo also stuns for 3 turns now" },
      { marker: "II,III,IV", text: "Give kashimo a 1/1 counter and give target creature 4 stun counters and 2 -1/-1 counters" },
      { marker: "V", text: "Tap Kashimo" },
      { marker: "VI", text: "opp picks 1 X 1/1 hexproof nurses\n/tap 1 creature a land remove buffs shuffle 3 cards from hand +1 field card into deck" },
    ]),
  };
  const sagas = (): [string, SagaRail][] => [...RULES_MATRIX.map((text): [string, SagaRail] => [text.name, sagaOf(text)]), ...Object.entries(SHAPES)];

  it("clips only the texts no rail can hold at the floor — and says so", () => {
    const clipped = sagas().filter(([, rail]) => rail.clipped || rail.intro?.clipped || rail.rows.some((row) => row.text.clipped));
    // 1,200 characters in one chapter. (A long reminder is not one of them:
    // the 260-character one outgrows its box — the chapters' column, the
    // ladder's floor, the rows under it — and so does the 330-character one.)
    expect(clipped.map(([name]) => name).sort()).toEqual(["1200 chars"]);
    for (const [name, rail] of clipped) {
      if (rail.clipped) expect(rail.sizePx, name).toBe(RULES_SIZE_PX.floor);
    }
    const grown = sagas().filter(([, rail]) => rail.introGrown);
    expect(grown.map(([name]) => name).sort()).toEqual(["a reminder that outgrows its box", "flavor only"]);
    for (const [name, rail] of grown) {
      expect(rail.intro!.sizePx, name).toBe(RULES_SIZE_PX.floor);
      expect(rail.intro!.clipped, name).toBe(false);
    }
  });

  for (const target of ["default", "hd"] as const) {
    it(`draws every fitted rail inside its boxes, line for line (${target})`, async () => {
      let boxes = 0;
      for (const [name, rail] of sagas()) {
        if (rail.clipped) continue;
        const d = sagaRailDrawing(rail, target);
        if (d.intro && !d.intro.clipped) {
          await checkDrawn(d.intro, target, `saga · ${name} · reminder`);
          boxes += 1;
        }
        let bottom = -Infinity;
        for (const [i, row] of d.rows.entries()) {
          if (row.text.blocks.every((b) => b.lines.length === 0)) continue;
          const { placed } = await checkDrawn(row.text, target, `saga · ${name} · row ${i}`);
          // …inside its OWN row: the box checkDrawn held the ink to is the
          // row's whole-px box, below the row before it.
          expect([placed.box.top, placed.box.top + placed.box.height]).toEqual([row.top, row.bottom]);
          expect(row.top).toBeGreaterThanOrEqual(bottom);
          bottom = row.bottom;
          boxes += 1;
        }
      }
      expect(boxes).toBeGreaterThan(40);
    }, 180_000);
  }

  it("draws the same lines at both targets, the 750 font exactly half the HD one", () => {
    for (const [name, rail] of sagas()) {
      const [hd, small] = [sagaRailDrawing(rail, "hd"), sagaRailDrawing(rail, "default")];
      const layouts = (d: typeof hd) => [...(d.intro ? [d.intro] : []), ...d.rows.map((row) => row.text)];
      layouts(hd).forEach((layout, i) => {
        const [a, b] = [rulesDraw(layout, "hd"), rulesDraw(layouts(small)[i], "default")];
        expect(b.fontPx * 2, name).toBe(a.fontPx);
        expect(b.blocks.map((x) => (x.kind === "blank" ? 0 : x.lines))).toEqual(a.blocks.map((x) => (x.kind === "blank" ? 0 : x.lines)));
      });
    }
  });
});

describe("the station box — the top band and every tier band (TODO 4.27a)", () => {
  const PROFILE = getFrameProfile("m15station");
  const REMINDER =
    "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)";
  /** Each layout's inputs, for its dresses' twin (below). */
  const laidInputs = new Map<StationLayout, Parameters<typeof stationLayout>[0]>();
  const lay = (text: StationText, pt: string | null, stamped: boolean, flavorText: string | null = null): StationLayout => {
    const input = { profile: PROFILE, text, flavorText, ptValue: pt, stamp: stamped ? M15_HOLO_STAMP_KEEP_OUT : null };
    const laid = stationLayout(input);
    laidInputs.set(laid, input);
    return laid;
  };
  /** A matrix text as a station card: the reminder over (at most three)
   *  tiers its paragraphs are dealt on, the plate on the last, stamped. */
  function stationOf(text: RulesCase): StationLayout {
    // (The fallback-glyph line stays a FIRST line, as it is in the matrix:
    // its ink is taller than the face's, which only a first line allows for.)
    const paragraphs = text.name === "non-Latin + emoji" ? [text.rules!] : (text.rules ?? "Flying").split(/\n+/).filter((p) => p.trim());
    const tiers = paragraphs.slice(0, 3).map((p, i, all) => ({ threshold: 3 * (i + 1), text: i === 2 ? paragraphs.slice(2).join("\n") : p, pt: i === all.length - 1 }));
    return lay({ intro: REMINDER, tiers }, "4/4", true, text.flavor);
  }
  const one = (word: string, threshold: number, pt = false) => ({ threshold, text: word, pt });
  const SHAPES: Record<string, StationLayout> = {
    // The card the independent check of #543 clipped at 42 px.
    "two keyword lines, the reminder, three one-word tiers": lay({ intro: `Flash\nWard {2}\n${REMINDER}`, tiers: [one("Flying", 2), one("Vigilance", 6), one("Trample", 10, true)] }, "5/5", true),
    "three full tiers, the plate on the middle one": lay(
      {
        intro: REMINDER,
        tiers: [
          one("Flying", 2),
          one("Whenever this Spacecraft attacks, draw a card, then discard a card.", 8, true),
          one("Other creatures you control get +2/+2 and have vigilance.", 14),
        ],
      },
      "20/20",
      true,
    ),
    "no tier": lay({ intro: `Flying\n${REMINDER}`, tiers: [] }, null, true),
    "no top text": lay({ intro: "", tiers: [one("{T}: Add {G}{G}.", 4), one("Flying, trample", 9, true)] }, "6/6", false),
    "a Planet (no plate), stamped": lay({ intro: "{T}: Add {W}.", tiers: [one("{3}{W}, {T}: Create a token that's a copy of target artifact or enchantment you control, except it's legendary. Activate only as a sorcery.", 12)] }, null, true),
    "pips beside the plate": lay({ intro: REMINDER, tiers: [one("{2}{U}{U}, {T}: Draw two cards. {W/U}{W/U}: This Spacecraft gains flying until end of turn.", 8, true)] }, "10/10", true),
  };
  const printed = (stationOracle as { name: string; oracle_text: string; power: string | null; toughness: string | null }[]).map((card): [string, StationLayout] => {
    const pt = card.power !== null && card.toughness !== null ? `${card.power}/${card.toughness}` : null;
    return [card.name, lay(parseStationText(card.oracle_text, pt !== null), pt, true)];
  });
  const stations = (): [string, StationLayout][] => [...RULES_MATRIX.map((text): [string, StationLayout] => [text.name, stationOf(text)]), ...Object.entries(SHAPES), ...printed];

  it("clips only the texts no box can hold at the floor — and says so, its bands still inside the box", () => {
    const clipped = stations().filter(([, laid]) => laid.clipped);
    // Three texts that fill an ORDINARY box to its floor, here under a whole
    // Station reminder and with tier bands to pay for: 1,200 characters, the
    // seven-paragraph level-up text, and a full card of typed rules + flavor.
    expect(clipped.map(([name]) => name).sort()).toEqual(["1200 chars", "level up", "typed, as printed"]);
    for (const [name, laid] of clipped) {
      expect(laid.sizePx, name).toBe(RULES_SIZE_PX.floor);
      expect(laid.rule, name).toBe(STATION.bandRules.length - 1);
    }
    for (const [name, laid] of stations()) {
      expect(laid.bands.top.y0, name).toBe(STATION.box.top);
      let y = laid.bands.top.y1;
      for (const band of laid.bands.tiers) {
        expect(band.y0, name).toBe(y);
        expect(band.y1, name).toBeGreaterThan(band.y0);
        y = band.y1;
      }
      expect(y, name).toBe(STATION.box.bottom);
    }
  });

  for (const target of ["default", "hd"] as const) {
    it(`draws every fitted band's text inside its band, clear of the stamp, line for line (${target})`, async () => {
      let boxes = 0;
      const scale = RULES_TARGET_SCALE[target];
      for (const [name, laid] of stations()) {
        if (laid.clipped) continue;
        // The HD bake: the shapes and the matrix; the 36 printed cards at 750 px only.
        if (target === "hd" && printed.some(([n]) => n === name)) continue;
        const bands = [laid.bands.top, ...laid.bands.tiers];
        const texts = [laid.top, ...laid.tiers.map((t) => t.text)];
        for (const [i, text] of texts.entries()) {
          if (!text || text.blocks.every((b) => b.lines.length === 0)) continue;
          const { placed } = await checkDrawn(text, target, `station · ${name} · band ${i}`);
          // …inside its OWN band: the box the ink is held to is the band's rows.
          expect(placed.box.top, `${name} band ${i}`).toBeGreaterThanOrEqual(bands[i]!.y0 * scale - EPS);
          expect(placed.box.top + placed.box.height, `${name} band ${i}`).toBeLessThanOrEqual(bands[i]!.y1 * scale + EPS);
          boxes += 1;
        }
      }
      expect(boxes).toBeGreaterThan(target === "hd" ? 30 : 100);
    }, 300_000);
  }

  it("its Spacecraft dresses (TODO 4.27a step 2) lay out every one of these texts exactly as the bordered frame — the holds above are theirs", () => {
    for (const template of ["extendedartstation", "m15borderlessstation"] as const) {
      const dress = getFrameProfile(template);
      expect(dress.tiers, template).toEqual(PROFILE.tiers);
      for (const [name, laid] of stations()) {
        // The same inputs on the dress's profile: the layout is the same, band for band and line for line.
        const again = stationLayout({ ...laidInputs.get(laid)!, profile: dress });
        expect(again, `${template} · ${name}`).toEqual(laid);
      }
    }
  }, 30_000);

  it("draws the same lines at both targets, the 750 font exactly half the HD one", () => {
    for (const [name, laid] of stations()) {
      for (const text of [laid.top, ...laid.tiers.map((t) => t.text)]) {
        if (!text) continue;
        const [a, b] = [rulesDraw(text, "hd"), rulesDraw(text, "default")];
        expect(b.fontPx * 2, name).toBe(a.fontPx);
        expect(b.blocks.map((x) => (x.kind === "blank" ? 0 : x.lines))).toEqual(a.blocks.map((x) => (x.kind === "blank" ? 0 : x.lines)));
      }
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
