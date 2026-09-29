import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CORNER_CHECK_FROM_PX,
  CORNER_CHECK_TO_PX,
  EDGE_CONTRACTS,
  EDGE_CONTRACT_KNOWN_FAILURES,
  cornerViolations,
  edgeContractViolations,
  edgeCornerSkipPx,
  isKnownEdgeFailure,
  type EdgeContract,
} from "@/lib/frames/edge-contract";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 7.7 — the edge contract, for every template × colour master, and its
// corner check (TODO 3.26: the border reaches the one card corner's arc).
//
// Git masters (public/frames) are checked everywhere. Frames-bucket masters
// (the Card Conjurer M15 family) are not in the repo: they are checked when a
// local build of them is present — FRAMES_BUILD_DIR, else <repo>/.frames-build
// — and only when its bytes are the manifest's (sha256), and the importer
// runs the same check when it builds them (scripts/import-cc-frames.mjs).
// Today's failures are EXPECTED failures (it.fails): fixing one turns this
// red until it is struck from EDGE_CONTRACT_KNOWN_FAILURES.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const PUBLIC = path.join(process.cwd(), "public", "frames");
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(process.cwd(), ".frames-build");

type Master = { template: string; key: string; file: string; bucket: boolean };

function mastersOf(template: string): Master[] {
  const out: Master[] = [];
  for (const key of FRAME_MASTER_KEYS) {
    const rel = `${template}/${key}.png`;
    const entry = manifest.files[rel];
    if (entry) {
      const file = path.join(BUILD, rel);
      if (!fs.existsSync(file)) continue;
      const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (sha === entry.sha256) out.push({ template, key, file, bucket: true });
      continue;
    }
    const file = path.join(PUBLIC, rel);
    if (fs.existsSync(file)) out.push({ template, key, file, bucket: false });
  }
  return out;
}

async function rgbaOf(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe("the edge-contract table", () => {
  it("declares every template (a new template must say what its edges are)", () => {
    const missing = FRAME_TEMPLATE_VALUES.filter((t) => !EDGE_CONTRACTS[t]);
    expect(missing).toEqual([]);
  });

  it("declares 4.32 / 4.39's templates (7.7's fixtures)", () => {
    for (const template of ["m15borderless", "m15borderlessartifact"]) {
      expect(EDGE_CONTRACTS[template].bottom, template).toEqual({ kind: "bar", depthPct: 7.76 });
      expect(EDGE_CONTRACTS[template].top.kind, template).toBe("art");
      expect(EDGE_CONTRACTS[template].left, template).toEqual({ kind: "art", except: [[78, 100]] });
    }
    // m15fullartland: a border on all four edges; fullartland: art on all
    // four, its two bars floating inside the card (checked below).
    expect(Object.values(EDGE_CONTRACTS.m15fullartland).every((e) => e.kind === "border")).toBe(true);
    expect(Object.values(EDGE_CONTRACTS.fullartland).every((e) => e.kind === "art")).toBe(true);
  });

  it("lists today's known failures — 7.7's list, the four this check found, and the corner check's one", () => {
    // adventure's grey paper rim (a corner-check find) left the list when
    // Phase B took it on (owner, 2026-09-28).
    expect(Object.keys(EDGE_CONTRACT_KNOWN_FAILURES).sort()).toEqual(
      [
        "alphaland",
        "avatar",
        "battle",
        "bloomanime",
        "bloomburrow",
        "expeditionland",
        "lotr",
        "lotrscroll",
        "tarkirdraconic",
        "tarkirdragon",
        "tarkirghostfire",
      ].sort(),
    );
    expect(isKnownEdgeFailure("expeditionland", "b")).toBe(true);
    expect(isKnownEdgeFailure("expeditionland", "w")).toBe(false);
    expect(isKnownEdgeFailure("fullartland", "w")).toBe(false);
    expect(isKnownEdgeFailure("alphaland", "b")).toBe(true);
    expect(isKnownEdgeFailure("alphaland", "w")).toBe(false);
    for (const k of ["w", "u", "b", "r", "g", "c", "m"]) expect(isKnownEdgeFailure("adventure", k), k).toBe(false);
  });

  it("gives every known failure a corner note (3.26) — the rings', the painted corners' and the corner check's own one", () => {
    for (const [template, { why }] of Object.entries(EDGE_CONTRACT_KNOWN_FAILURES)) {
      expect(why, template).toMatch(/; corner: /);
    }
    // The corner check's own entry fails on the corner only.
    expect(EDGE_CONTRACT_KNOWN_FAILURES.alphaland.why).toMatch(/^edges pass; corner: /);
  });
});

// TODO 3.26 — one card corner: 4.3 % of the short side (64.5 px at HD).
describe("the edge check's corner skip and the corner check", () => {
  const border: EdgeContract = {
    top: { kind: "border" },
    right: { kind: "border" },
    bottom: { kind: "border" },
    left: { kind: "border" },
  };
  /** An opaque black HD master (portrait or landscape). */
  const black = (w: number, h: number) => {
    const buf = new Uint8Array(w * h * 4);
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    return buf;
  };
  /** Paint the corner exterior of a `painted`-px rounded corner white — an
   *  MSE master's card-stock paper (retro paints r ≈ 76). */
  const withPaper = (buf: Uint8Array, w: number, h: number, painted: number) => {
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      for (let ly = 0; ly < painted; ly += 1) {
        for (let lx = 0; lx < painted; lx += 1) {
          if (Math.hypot(painted - lx - 0.5, painted - ly - 0.5) <= painted) continue;
          const o = ((fy ? h - 1 - ly : ly) * w + (fx ? w - 1 - lx : lx)) * 4;
          buf[o] = buf[o + 1] = buf[o + 2] = 255;
        }
      }
    }
    return buf;
  };

  it("skips the corner by the constant's radius on the SHORT side, rounded up, + 2 px", () => {
    expect(edgeCornerSkipPx(1500, 2100)).toBe(67);
    // Landscape: the short side again (it was 4 % of the width: 84 px).
    expect(edgeCornerSkipPx(2100, 1500)).toBe(67);
    expect(edgeCornerSkipPx(300, 420)).toBe(15);
  });

  it("passes a master cut at the constant, where the old 60 px skip read α 0.875 at (60, 0)", () => {
    const m = black(1500, 2100);
    applyCardCornerMask(m, 1500, 2100);
    expect(m[(0 * 1500 + 60) * 4 + 3]).toBe(223);
    expect(edgeContractViolations(border, m, 1500, 2100)).toEqual([]);
    expect(cornerViolations(border, m, 1500, 2100)).toEqual([]);
  });

  it("checks a landscape master from 67 px, not 84 (split, battle)", () => {
    const m = black(2100, 1500);
    applyCardCornerMask(m, 2100, 1500);
    expect(edgeContractViolations(border, m, 2100, 1500)).toEqual([]);
    m[(1 * 2100 + 75) * 4 + 3] = 0; // a hole the 84 px skip hid
    expect(edgeContractViolations(border, m, 2100, 1500)).toEqual([expect.stringMatching(/^top: border, but the frame is α 0\.00 at 75,1/)]);
  });

  it("fails a 39 px cut over white paper (the MSE crescent) and passes the same corner painted with the border", () => {
    const paper = withPaper(black(1500, 2100), 1500, 2100, 74);
    applyCardCornerMask(paper, 1500, 2100, 39);
    // The edge check never sees it: the paper sits inside the 67 px skip.
    expect(edgeContractViolations(border, paper, 1500, 2100)).toEqual([]);
    const v = cornerViolations(border, paper, 1500, 2100);
    expect(v).toHaveLength(8); // four corners × both halves of each arc
    for (const s of v) expect(s).toMatch(/corner \((top|bottom|left|right) border\): luma 255 at \d+,\d+ just inside the arc/);
    // Black to the corner passes whatever the cut (Card Conjurer's 39 px).
    const cc = black(1500, 2100);
    applyCardCornerMask(cc, 1500, 2100, 39);
    expect(cornerViolations(border, cc, 1500, 2100)).toEqual([]);
  });

  it("fails a transparent ring at the arc (the #101015 ring a bake shows)", () => {
    const ring = black(1500, 2100);
    for (let y = 0; y < 2100; y += 1) {
      for (let x = 0; x < 1500; x += 1) if (x < 30 || y < 30 || x >= 1470 || y >= 2070) ring[(y * 1500 + x) * 4 + 3] = 0;
    }
    const v = cornerViolations(border, ring, 1500, 2100);
    expect(v).toHaveLength(8);
    expect(v[0]).toMatch(/^top-left corner \(top border\): the frame is α 0\.00/);
  });

  it(`reads every pixel the cut keeps whole, ${CORNER_CHECK_FROM_PX}–${CORNER_CHECK_TO_PX} px inside the arc: a grey rim right at the arc fails, the cut's own ramp passes`, () => {
    const at = (x: number, y: number) => (y * 1500 + x) * 4;
    const m = black(1500, 2100);
    applyCardCornerMask(m, 1500, 2100);
    // The ramp (−0.5 < d < 0.5) is the cut's own: never read.
    m.set([200, 200, 200], at(0, 56)); // d ≈ −0.002
    expect(cornerViolations(border, m, 1500, 2100)).toEqual([]);
    // A grey pixel 1.2 px inside the arc (adventure's rim before Phase B,
    // luma ≤ 97) fails: a round bake shows it as a light ring.
    m.set([74, 74, 74], at(3, 47)); // d ≈ −1.2
    expect(cornerViolations(border, m, 1500, 2100)).toEqual([expect.stringMatching(/^top-left corner \(left border\): luma 74 at 3,47/)]);
    // Deeper than 8 px it is the frame's business, not the corner's.
    const deep = black(1500, 2100);
    deep.set([200, 200, 200], at(25, 25)); // d ≈ −9.4
    expect(cornerViolations(border, deep, 1500, 2100)).toEqual([]);
  });

  it("skips an art edge's half of the arc and checks a bar's (m15borderless)", () => {
    const contract = EDGE_CONTRACTS.m15borderless;
    const m = black(1500, 2100);
    // Art to the top corners and down the sides: see-through above the bar.
    for (let y = 0; y < 1640; y += 1) for (let x = 0; x < 1500; x += 1) m[(y * 1500 + x) * 4 + 3] = 0;
    applyCardCornerMask(m, 1500, 2100);
    expect(cornerViolations(contract, m, 1500, 2100)).toEqual([]);
    // The bottom bar's corner must be the border.
    withPaper(m, 1500, 2100, 74);
    const v = cornerViolations(contract, m, 1500, 2100);
    expect(v.length).toBeGreaterThan(0);
    for (const s of v) expect(s).toMatch(/^bottom-(left|right) corner \(bottom bar\)/);
  });
});

describe("edgeContractViolations", () => {
  const W = 300;
  const H = 420;
  /** A synthetic master: alpha from `alpha(x, y)`. */
  const master = (alpha: (x: number, y: number) => number) => {
    const buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) buf[(y * W + x) * 4 + 3] = alpha(x, y);
    return buf;
  };
  const border: EdgeContract = {
    top: { kind: "border" },
    right: { kind: "border" },
    bottom: { kind: "border" },
    left: { kind: "border" },
  };
  const ring = (w: number) => (x: number, y: number) =>
    x < w || y < w || x >= W - w || y >= H - w ? 255 : 0;

  it("passes an opaque ring and fails a transparent one (the #101015 ring)", () => {
    expect(edgeContractViolations(border, master(ring(12)), W, H)).toEqual([]);
    const v = edgeContractViolations(border, master(() => 0), W, H);
    expect(v).toHaveLength(4);
    expect(v[0]).toMatch(/^top: border, but the frame is α 0\.00/);
    // One semi-transparent pixel in the band is enough.
    const holed = master((x, y) => (x === 150 && y === 2 ? 240 : ring(12)(x, y)));
    expect(edgeContractViolations(border, holed, W, H)).toEqual([expect.stringMatching(/^top: border/)]);
  });

  it("ignores the rounded corners", () => {
    const rounded = master((x, y) => (x + y < 10 ? 0 : ring(12)(x, y)));
    expect(edgeContractViolations(border, rounded, W, H)).toEqual([]);
  });

  it("checks an art edge for a see-through band, the art window's reach, and skips declared bars", () => {
    const art: EdgeContract = {
      top: { kind: "art" },
      right: { kind: "art", except: [[80, 100]] },
      bottom: { kind: "bar", depthPct: 8 },
      left: { kind: "art", except: [[80, 100]] },
    };
    // Clear everywhere but a bottom bar 10 % deep with fins up the sides
    // from 82 % H.
    const borderless = master((x, y) => (y >= H * 0.9 || (y >= H * 0.82 && (x < 8 || x >= W - 8)) ? 255 : 0));
    const slot = { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 92 };
    expect(edgeContractViolations(art, borderless, W, H, slot)).toEqual([]);
    // Without the `except` the fins break the art edges.
    const strict = { ...art, left: { kind: "art" as const }, right: { kind: "art" as const } };
    expect(edgeContractViolations(strict, borderless, W, H, slot)).toHaveLength(2);
    // An inset art window breaks every art edge.
    const inset = { topPct: 2.5, leftPct: 3.5, widthPct: 93, heightPct: 92 };
    expect(edgeContractViolations(art, borderless, W, H, inset).filter((s) => /doesn't reach/.test(s))).toHaveLength(3);
    // A bar shallower than declared fails.
    const shallow = master((x, y) => (y >= H * 0.95 ? 255 : 0));
    expect(edgeContractViolations(art, shallow, W, H, slot)).toEqual([expect.stringMatching(/^bottom: bar \(8 %\)/)]);
  });
});

describe("every frame master honours its template's edge contract and corner check", () => {
  const bucketTemplates = new Set(Object.keys(manifest.files).map((k) => k.split("/")[0]));
  for (const template of FRAME_TEMPLATE_VALUES) {
    const masters = mastersOf(template);
    const contract = EDGE_CONTRACTS[template];
    if (masters.length === 0) {
      // A bucket template without a local build (CI): the importer checks it.
      it.skip(`${template}: masters not available here (frames bucket; set FRAMES_BUILD_DIR)`, () => {});
      continue;
    }
    if (!bucketTemplates.has(template)) {
      it(`${template}: every colour master is checked (git)`, () => {
        // 7.6's lesson (expeditionland b/g): never sample one colour.
        expect(masters.length).toBeGreaterThanOrEqual(7);
      });
    }
    for (const m of masters) {
      const known = isKnownEdgeFailure(template, m.key);
      const run = known ? it.fails : it;
      run(`${template}/${m.key}${m.bucket ? " (bucket)" : ""}${known ? " — known failure" : ""}`, async () => {
        const { data, width, height } = await rgbaOf(m.file);
        expect([width, height]).toEqual(
          getFrameProfile(template).orientation === "landscape" ? [2100, 1500] : [1500, 2100],
        );
        expect([
          ...edgeContractViolations(contract, data, width, height, getFrameProfile(template).artSlot),
          // TODO 3.26: the border reaches the one card corner's arc (no paper
          // crescent, no transparent ring inside the cut).
          ...cornerViolations(contract, data, width, height),
        ]).toEqual([]);
      });
    }
  }
});

// 7.7's full-art fixtures: "fullartland has art on all four edges plus its
// two bars" — the edges are checked above; here the bars: opaque across the
// title bar and the type bar on the card's centre column, see-through
// between them (the Border mask erased, nothing else). m15fullartland keeps
// the same bars inside its ring. Run where the masters are available.
describe("the full-art basics keep their two bars (7.7 fixture)", () => {
  for (const template of ["fullartland", "m15fullartland"]) {
    const masters = mastersOf(template);
    if (masters.length === 0) {
      it.skip(`${template}: masters not available here (frames bucket; set FRAMES_BUILD_DIR)`, () => {});
      continue;
    }
    it(`${template}: title bar 5–10.5 % H and type bar 84.5–90.3 % H, clear between`, async () => {
      for (const m of masters) {
        const { data, width, height } = await rgbaOf(m.file);
        const alpha = (xPct: number, yPct: number) =>
          data[(Math.round((yPct / 100) * (height - 1)) * width + Math.round((xPct / 100) * (width - 1))) * 4 + 3] / 255;
        for (const x of [30, 50, 70]) {
          for (let y = 5; y <= 10.5; y += 0.5) expect(alpha(x, y), `${m.key} title ${x},${y}`).toBeGreaterThanOrEqual(0.99);
          for (let y = 84.5; y <= 90.3; y += 0.5) expect(alpha(x, y), `${m.key} type ${x},${y}`).toBeGreaterThanOrEqual(0.99);
          for (let y = 15; y <= 80; y += 5) expect(alpha(x, y), `${m.key} art ${x},${y}`).toBeLessThanOrEqual(0.05);
        }
      }
    });
  }
});

// The owner's evidence (2026-09-26): erasing the Border mask as alpha × (1 −
// mask alpha) left the ring's anti-aliased inner edge behind — α 10–14 on
// x 59, x 1439, y 60 and y 1933 (up to 64 in the rounded corners), a faint
// rounded rectangle over the art that the 2 % edge bands and the 5 %-step
// fixture above both miss. Every pixel outside the two bars is now clear.
describe("fullartland keeps nothing of the erased Border ring", () => {
  const masters = mastersOf("fullartland");
  if (masters.length === 0) {
    it.skip("fullartland: masters not available here (frames bucket; set FRAMES_BUILD_DIR)", () => {});
  } else {
    it("is α 0 on every row outside the title bar (77–245) and the type bar with its disc (1724–1935)", async () => {
      expect(masters).toHaveLength(7);
      for (const m of masters) {
        const { data, width, height } = await rgbaOf(m.file);
        expect([width, height]).toEqual([1500, 2100]);
        const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
        const lit: string[] = [];
        for (let y = 0; y < height; y += 1) {
          if ((y >= 77 && y <= 245) || (y >= 1724 && y <= 1935)) continue;
          for (let x = 0; x < width; x += 1) if (alpha(x, y) > 0) lit.push(`${x},${y}=${alpha(x, y)}`);
        }
        // The first cut lit 4,390 here: 1,478 on each of x 59 and x 1439,
        // 1,338 on y 60 and 96 in the rounded corners.
        expect(lit.slice(0, 8), `${m.key}: ${lit.length} lit pixels`).toEqual([]);
        // y 1933 crosses the type bar's rows: only the symbol disc's
        // shadow (x 121–170) hangs there, never the ring's bottom edge (829
        // lit pixels in the first cut).
        for (let x = 260; x < 1440; x += 1) expect(alpha(x, 1933), `${m.key} y 1933, x ${x}`).toBe(0);
        // The bars are still there: opaque mid-bar on the centre column.
        expect(alpha(750, 160), `${m.key} title bar`).toBe(255);
        expect(alpha(750, 1835), `${m.key} type bar`).toBe(255);
      }
    });
  }
});

// TODO 4.49 (b): the text-box tokens are Card Conjurer's 'Regular (Bordered
// M15)' masters with the lower band re-cut 64 px down onto the prints (CC's
// window ended at 1340 px, the prints' at ~1404–1409): the window now ends at
// 1404 px (1408 on the see-through `c`), the pill's top outline sits at 1420
// and the box starts at 1559. And 7.6's art-window coverage: the transparent
// window flood-filled (α < 16) from the profile's artSlot centre lies inside
// the artSlot with ≥ 0.05 % overscan on every side. Run where the masters
// are available (the importer builds them; CI has no bucket frames).
describe("the text-box tokens' re-cut window and 7.6's art-window coverage", () => {
  /** The α < 16 region 4-connected to (cx, cy): its bounding box. */
  function windowBox(data: Buffer, width: number, height: number, cx: number, cy: number) {
    const seen = new Uint8Array(width * height);
    const stack = [cy * width + cx];
    let x0 = cx;
    let x1 = cx;
    let y0 = cy;
    let y1 = cy;
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || data[i * 4 + 3] >= 16) continue;
      seen[i] = 1;
      const x = i % width;
      const y = (i - x) / width;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      if (x > 0) stack.push(i - 1);
      if (x < width - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - width);
      if (y < height - 1) stack.push(i + width);
    }
    return { x0, x1: x1 + 1, y0, y1: y1 + 1 };
  }

  for (const template of ["m15tokentext", "m15tokenartifacttext"]) {
    const masters = mastersOf(template);
    if (masters.length === 0) {
      it.skip(`${template}: masters not available here (frames bucket; set FRAMES_BUILD_DIR)`, () => {});
      continue;
    }
    it(`${template}: every colour's window ends ~1404 px, the pill and box below it, inside the art slot`, async () => {
      expect(masters).toHaveLength(7);
      const slot = getFrameProfile(template).artSlot;
      for (const m of masters) {
        const { data, width, height } = await rgbaOf(m.file);
        const cx = Math.round(((slot.leftPct + slot.widthPct / 2) / 100) * width);
        const cy = Math.round(((slot.topPct + slot.heightPct / 2) / 100) * height);
        const win = windowBox(data, width, height, cx, cy);
        // The re-cut: the window ends 64 px lower than CC's 1341.
        expect(win.y1, `${m.key} window bottom`).toBeGreaterThanOrEqual(1405);
        expect(win.y1, `${m.key} window bottom`).toBeLessThanOrEqual(1409);
        // …then opaque from the pill's top outline (1420) through the box
        // (1559–1947) on the centre column.
        for (const y of [1422, 1480, 1540, 1600, 1760, 1940]) {
          expect(data[(y * width + 750) * 4 + 3], `${m.key} α at 750, ${y}`).toBeGreaterThan(m.key === "c" && template === "m15tokentext" ? 150 : 250);
        }
        // 7.6: the art slot covers the window with ≥ 0.05 % overscan.
        const over = { x: 0.0005 * width, y: 0.0005 * height };
        expect((slot.leftPct / 100) * width, `${m.key} left`).toBeLessThanOrEqual(win.x0 - over.x);
        expect(((slot.leftPct + slot.widthPct) / 100) * width, `${m.key} right`).toBeGreaterThanOrEqual(win.x1 + over.x);
        expect((slot.topPct / 100) * height, `${m.key} top`).toBeLessThanOrEqual(win.y0 - over.y);
        expect(((slot.topPct + slot.heightPct) / 100) * height, `${m.key} bottom`).toBeGreaterThanOrEqual(win.y1 + over.y);
      }
    });
  }
});
