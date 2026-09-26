import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  EDGE_CONTRACTS,
  EDGE_CONTRACT_KNOWN_FAILURES,
  edgeContractViolations,
  isKnownEdgeFailure,
  type EdgeContract,
} from "@/lib/frames/edge-contract";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 7.7 — the edge contract, for every template × colour master.
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

  it("lists today's known failures — 7.7's list plus the four this check found", () => {
    expect(Object.keys(EDGE_CONTRACT_KNOWN_FAILURES).sort()).toEqual(
      [
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

describe("every frame master honours its template's edge contract", () => {
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
        expect(edgeContractViolations(contract, data, width, height, getFrameProfile(template).artSlot)).toEqual([]);
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
