import { describe, expect, it } from "vitest";
import printingsData from "../scryfall/fixtures/signature-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameMatchFromScryfall, verifiedFrameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  BASIC_SYMBOL_CC_2022,
  BASIC_SYMBOL_ZEN_MEDALLION,
  SNC_BASIC_BAR_DY_PCT,
  SNC_BASIC_MEDALLION_DY_PCT,
  ZEN_BASIC_BAR_DY_PCT,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { CARD_KIND_VALUES, templateIsBasicOnly, templateRefusesKind } from "@/lib/creator/card-kinds";
import { FRAME_COLOR_KEYS } from "@/lib/creator/card-kinds";
import { FRAME_TEMPLATE_SET, type FrameTemplate } from "@/types/card";
import { SNC_BASIC_RECUT, ZEN_BASIC_RECUT, recutBarAndMedallion } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// The older full-art basics (TODO 4.40 / 4.41): three NEW stored templates —
// the Zendikar-style split bar on the stone ring, the same bars on SNC's
// white ring, and the plain bar — basic lands only, with the imports that
// land on them once each is verified. Additions: no stored card changes.
// ---------------------------------------------------------------------------

type Key = keyof typeof printingsData;
const printing = (key: Key, over: Record<string, unknown> = {}) =>
  scryfallCardSchema.parse({ ...printingsData[key], ...over });

const NEW: readonly FrameTemplate[] = ["m15fullartlandzen", "m15fullartlandsnc", "m15fullartlandthb"];
const everyColour = (templates: readonly FrameTemplate[]) =>
  new Set(templates.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
/** What production has ticked of the full-art basics today (seed.sql). */
const TODAY = everyColour(["m15fullartland"]);
const VERIFIED = everyColour(["m15fullartland", ...NEW]);

describe("the templates", () => {
  it("are basic-only lands in the Full Art set, like the 2022 design", () => {
    for (const t of NEW) {
      expect(FRAME_TEMPLATE_SET[t], t).toBe("fullartset");
      expect(templateIsBasicOnly(t), t).toBe(true);
      for (const kind of CARD_KIND_VALUES) expect(templateRefusesKind(t, kind), `${t} ${kind}`).toBe(kind !== "land");
    }
  });

  it("split the type line round the medallion, each slot moved with the bar or medallion it sits on", () => {
    const zen = getFrameProfile("m15fullartlandzen");
    const snc = getFrameProfile("m15fullartlandsnc");
    // CC's boxes at y 81.96 %, set 0.29 % down (as FULL_ART_BASIC sets its own), plus the re-cut.
    expect(zen.type.split!.leftRect.topPct).toBeCloseTo(81.96 + 0.29 + 7 / 21, 9);
    expect(snc.type.split!.leftRect.topPct).toBeCloseTo(81.96 + 0.29 - 13 / 21, 9);
    expect(ZEN_BASIC_BAR_DY_PCT).toBeCloseTo((ZEN_BASIC_RECUT.bar.dy / 2100) * 100, 12);
    expect(SNC_BASIC_BAR_DY_PCT).toBeCloseTo((SNC_BASIC_RECUT.bar.dy / 2100) * 100, 12);
    expect(SNC_BASIC_MEDALLION_DY_PCT).toBeCloseTo((SNC_BASIC_RECUT.medallion.dy / 2100) * 100, 12);
    // The right half: CC's 58 % on the stone ring, 57.4 % on SNC (its print).
    expect(zen.type.split!.rightRect.leftPct).toBe(58);
    expect(snc.type.split!.rightRect.leftPct).toBe(57.4);
    // The medallion's symbol, the template's own image, glyph over the master.
    for (const [t, dy] of [["m15fullartlandzen", 0], ["m15fullartlandsnc", SNC_BASIC_MEDALLION_DY_PCT]] as const) {
      const slot = getFrameProfile(t).basicSymbol!;
      expect(slot.style).toBe(BASIC_SYMBOL_ZEN_MEDALLION.style);
      expect(slot.assetPathTemplate).toBe(`/frames/${t}/symbol/{symbol}.png`);
      expect(slot.rect.topPct, t).toBeCloseTo((1648 / 2100) * 100 + dy, 9);
      // Square on the card, centred on the medallion's x.
      expect(slot.rect.widthPct * 1500).toBeCloseTo(slot.rect.heightPct * 2100, 6);
      expect(slot.rect.leftPct + slot.rect.widthPct / 2).toBeCloseTo(50, 9);
    }
  });

  it("prints no symbol on the plain bar, and its type line from the bar's left end", () => {
    const thb = getFrameProfile("m15fullartlandthb");
    expect(thb.basicSymbol).toEqual({ rect: BASIC_SYMBOL_CC_2022.rect, style: "none" });
    expect(thb.type.split).toBeUndefined();
    expect(thb.type.rect.leftPct).toBe(8.54);
    expect(getFrameProfile("m15fullartland").type.rect.topPct).toBe(thb.type.rect.topPct);
  });
});

describe("the imports (frame-signatures: onceVerified)", () => {
  const rows: Array<[Key, Record<string, unknown>, string, FrameTemplate, "exact" | "nearest"]> = [
    ["bfz-250", {}, "fullart/basic/split-bar", "m15fullartlandzen", "exact"],
    ["znr-269", {}, "fullart/basic/split-bar", "m15fullartlandzen", "exact"],
    ["znr-266", {}, "fullart/basic/split-bar", "m15fullartlandzen", "exact"],
    ["snc-272", {}, "fullart/basic/split-bar/ring", "m15fullartlandsnc", "exact"],
    ["thb-250", {}, "fullart/basic/plain-bar", "m15fullartlandthb", "exact"],
    ["spm-189", {}, "fullart/basic/plain-bar", "m15fullartlandthb", "exact"],
    ["mh1-250", {}, "fullart/basic/split-bar/snow", "m15fullartlandzen", "nearest"],
    ["zen-230", {}, "fullart/basic/split-bar/2003", "m15fullartlandzen", "nearest"],
    // BRO and Innistrad's dark bars (synthetic: an SNC Plains in their sets).
    ["snc-272", { set: "bro", collector_number: "278" }, "fullart/basic/split-bar/bro", "m15fullartlandsnc", "nearest"],
    ["snc-272", { set: "mid", collector_number: "268" }, "fullart/basic/split-bar/dark", "m15fullartlandsnc", "nearest"],
  ];

  it.each(rows)("%s %o: %s — on m15fullartland until its frame is verified, then on %s (%s)", (key, over, signature, template, status) => {
    const card = printing(key, over);
    const match = frameMatchFromScryfall(card);
    expect(match).toMatchObject({ signature, status: "nearest", template: "m15fullartland", onceVerified: template });
    // Today: where it always landed.
    const today = verifiedFrameMatchFromScryfall(card, TODAY);
    expect({ template: today.template, status: today.status }).toEqual({ template: "m15fullartland", status: "nearest" });
    if (status === "exact") expect(today.reason).toMatch(/^not yet verified in /);
    else expect(today.reason).toBe(match.reason);
    // Once verified: its own frame.
    const later = verifiedFrameMatchFromScryfall(card, VERIFIED);
    expect({ template: later.template, status: later.status }).toEqual({ template, status });
    if (status === "nearest") expect(later.reason, "the reason holds on the new frame too").toBe(match.reason);
  });

  it("moves no other full-art basic", () => {
    for (const key of ["fdn-282", "hob-194", "one-262", "neo-293", "dft-507"] as Key[]) {
      if (!(key in printingsData)) continue;
      const card = printing(key);
      expect(frameMatchFromScryfall(card).onceVerified, key).toBeUndefined();
    }
  });
});

describe("recutBarAndMedallion (the importer's re-cut)", () => {
  // A 20 × 40 image: rows 10–19 a "bar" (value 100 + row), the rest α 0,
  // a "medallion" disc of r 3 at (10, 15) painted 250.
  const W = 20;
  const H = 40;
  const make = () => {
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const o = (y * W + x) * 4;
        const disc = Math.hypot(x - 10, y - 15) <= 3;
        if (disc) buf.fill(250, o, o + 4);
        else if (y >= 10 && y < 20) {
          buf.fill(100 + y, o, o + 3);
          buf[o + 3] = 255;
        }
      }
    }
    return buf;
  };
  const px = (buf: Buffer, x: number, y: number) => [...buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

  it("moves the bar down and keeps the medallion where it was", () => {
    const out = recutBarAndMedallion(make(), W, H, {
      bar: { fromY: 8, toY: 22, dy: 2 },
      medallion: { cx: 10, cy: 15, r: 3, pad: 0, feather: 1, dy: 0 },
    });
    // A bar row moved 2 px down; the rows it left repeat the clear row above.
    expect(px(out, 2, 12)).toEqual([110, 110, 110, 255]);
    expect(px(out, 2, 10)).toEqual([0, 0, 0, 0]);
    expect(px(out, 2, 21)).toEqual([119, 119, 119, 255]);
    // The medallion's centre is its own pixel, unmoved.
    expect(px(out, 10, 15)).toEqual([250, 250, 250, 250]);
  });

  // …and one whose medallion hangs below the bar (rows 21–27, centre 24),
  // as SNC's cap does.
  const below = () => {
    const buf = make();
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const o = (y * W + x) * 4;
        if (Math.hypot(x - 10, y - 15) <= 3 && !(y >= 10 && y < 20)) buf.fill(0, o, o + 4);
        if (Math.hypot(x - 10, y - 15) <= 3 && y >= 10 && y < 20) {
          buf.fill(100 + y, o, o + 3);
          buf[o + 3] = 255;
        }
        if (Math.hypot(x - 10, y - 24) <= 3) buf.fill(250, o, o + 4);
      }
    }
    return buf;
  };
  const SNC_LIKE = { bar: { fromY: 8, toY: 32, dy: -2 }, medallion: { cx: 10, cy: 24, r: 3, pad: 0, feather: 1, dy: -4, keepRows: [10, 20] } };

  it("moves the medallion by its own distance and clears its old cap", () => {
    const out = recutBarAndMedallion(below(), W, H, SNC_LIKE);
    // The disc's centre moved 4 px up…
    expect(px(out, 10, 20)).toEqual([250, 250, 250, 250]);
    // …its old bottom (row 27; row 25 once the band moved 2 px up) is clear.
    expect(px(out, 10, 25)).toEqual([0, 0, 0, 0]);
    // The bar moved 2 px up beside it.
    expect(px(out, 2, 10)).toEqual([112, 112, 112, 255]);
  });

  it("refuses a bad recut and a medallion beside a painted pixel", () => {
    expect(() =>
      recutBarAndMedallion(make(), W, H, { bar: { fromY: 8, toY: 8, dy: 2 }, medallion: { cx: 10, cy: 15, r: 3, pad: 0, feather: 1, dy: 0 } }),
    ).toThrow(/bad recut/);
    expect(() => recutBarAndMedallion(below().fill(255), W, H, SNC_LIKE)).toThrow(/not clear/);
  });
});
