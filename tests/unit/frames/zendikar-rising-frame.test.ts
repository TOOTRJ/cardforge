import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import printingsData from "../scryfall/fixtures/signature-printings.json";
import { resolveFrameOverlays, resolveHoloStamp } from "@/lib/cards/anatomy";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { frameComboKey, TWO_COLOR_PAIRS } from "@/lib/cards/frame-reference-registry";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { CC_M15_COST_DISC_PCT, TITLE_SIZE_PCT, TYPE_SIZE_PCT } from "@/lib/cards/typography";
import {
  M15_COLLECTOR,
  ZNR_CROWN,
  ZNR_HOLO_STAMP,
  ZNR_HOLO_STAMP_KEEP_OUT,
  ZNR_HOLO_STAMP_OVAL,
  getFrameProfile,
  slotInk,
} from "@/lib/cards/template-layout";
import { withVerification } from "@/lib/creator/frame-resolve";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { CC_OVERLAY_BANDS, CC_TEMPLATES, ZNR_CROWN_BAND, ZNR_NOTCH, splitZnrNotch, znrCrownLayers } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// TODO 4.11 (wave 1) — the Zendikar Rising hedron showcase (`fullart`, ZNR
// #290–313) re-sourced from Card Conjurer's 'Zendikar Rising' pack (layout
// v62): the recipe, the notch it splits off, the crown band, the profile's
// slots and inks, and the import's landing.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const manifest = manifestJson as { files: Record<string, { sha256: string; width?: number; height?: number }> };
const printing = (key: keyof typeof printingsData) => scryfallCardSchema.parse(printingsData[key]);
const profile = getFrameProfile("fullart");

describe("the recipe", () => {
  const def = CC_TEMPLATES.fullart;
  it("builds every colour key from the pack's frame with its title ends on top — no artifact or land master", () => {
    expect(Object.keys(def.colors).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) {
      const [frame, title] = def.colors[k];
      expect(frame.src).toBe(`img/frames/m15/zendikarRising/m15ZendikarRisingFrame${k.toUpperCase()}.png`);
      expect(title.src).toBe(`img/frames/m15/zendikarRising/m15ZendikarRisingTitle${k.toUpperCase()}.png`);
      expect(title.at).toEqual({ leftPct: 3.74, topPct: 2.62, widthPct: 92.54, heightPct: 10.91 });
    }
    expect(profile.artifactMasterKeys).toBeUndefined();
  });

  it("takes the pack's own plates for w b m c and the Nickname pack's for u r g, as CC lists them", () => {
    expect(def.plates).toEqual({
      w: "img/frames/m15/zendikarRising/m15ZendikarRisingPTW.png",
      u: "img/frames/m15/nickname/m15NicknamePTU.png",
      b: "img/frames/m15/zendikarRising/m15ZendikarRisingPTB.png",
      r: "img/frames/m15/nickname/m15NicknamePTR.png",
      g: "img/frames/m15/nickname/m15NicknamePTG.png",
      m: "img/frames/m15/zendikarRising/m15ZendikarRisingPTM.png",
      c: "img/frames/m15/zendikarRising/m15ZendikarRisingPTC.png",
    });
  });

  it("publishes every master, plate and notch piece with its WebP, and every crown band", () => {
    for (const k of KEYS) {
      for (const rel of [`fullart/${k}`, `fullart/pt/${k}`, `fullart/holostamp/${k}`]) {
        expect(manifest.files[`${rel}.png`], rel).toBeDefined();
        expect(manifest.files[`${rel}.webp`], rel).toBeDefined();
      }
      expect(manifest.files[`fullart/${k}.png`]).toMatchObject({ width: 1500, height: 2100 });
      expect(manifest.files[`fullart/holostamp/${k}.png`]).toMatchObject({ width: ZNR_NOTCH.box.width, height: ZNR_NOTCH.box.height });
    }
    for (const key of ZNR_CROWN_BAND.keys) {
      expect(manifest.files[`fullartcrown/${key}.png`], key).toMatchObject({ width: 1500, height: ZNR_CROWN_BAND.rows });
      expect(manifest.files[`fullartcrown/${key}.webp`], key).toBeDefined();
    }
    // Nothing of the frame is in git any more.
    expect(fs.existsSync(path.join(process.cwd(), "public/frames/fullart"))).toBe(false);
  });
});

describe("the stamp notch, split off every master", () => {
  it("is the overlay the profile draws: the importer's box, oval and keys", () => {
    const px = (r: { leftPct: number; topPct: number; widthPct: number; heightPct: number }) => [
      Math.round((r.leftPct / 100) * 1500),
      Math.round((r.topPct / 100) * 2100),
      Math.round((r.widthPct / 100) * 1500),
      Math.round((r.heightPct / 100) * 2100),
    ];
    expect(px(ZNR_HOLO_STAMP.rect)).toEqual([ZNR_NOTCH.box.x, ZNR_NOTCH.box.y, ZNR_NOTCH.box.width, ZNR_NOTCH.box.height]);
    expect(px(ZNR_HOLO_STAMP_OVAL)).toEqual([ZNR_NOTCH.oval.x, ZNR_NOTCH.oval.y, ZNR_NOTCH.oval.width, ZNR_NOTCH.oval.height]);
    expect([...ZNR_HOLO_STAMP.keys].sort()).toEqual([...KEYS].sort());
    expect(ZNR_HOLO_STAMP.assetPathTemplate).toBe("/frames/fullart/holostamp/{key}.png");
    // The keep-out covers the arch's bevel at the centre, down past the box.
    const top = (ZNR_HOLO_STAMP_KEEP_OUT.topPct / 100) * 2100;
    expect(top).toBeLessThan(ZNR_NOTCH.archTop[0][1] - ZNR_NOTCH.bevelRows + 1);
    expect(((ZNR_HOLO_STAMP_KEEP_OUT.topPct + ZNR_HOLO_STAMP_KEEP_OUT.heightPct) / 100) * 2100).toBeGreaterThanOrEqual(
      ((profile.rules.rect.topPct + profile.rules.rect.heightPct) / 100) * 2100,
    );
  });

  it("draws on a rare or mythic under 'auto' and never otherwise — as ZNR prints it", () => {
    const facts = (rarity: string) => ({ cardType: "creature", rarity, colors: ["blue"] as const, colorKey: "u", supertype: null });
    expect(resolveHoloStamp(profile, { stamp: "auto" }, facts("rare"))).toMatchObject({ shape: "oval", notch: { path: "/frames/fullart/holostamp/u.png" } });
    expect(resolveHoloStamp(profile, { stamp: "auto" }, facts("mythic"))).not.toBeNull();
    expect(resolveHoloStamp(profile, { stamp: "auto" }, facts("common"))).toBeNull();
    expect(resolveHoloStamp(profile, {}, facts("rare"))).toBeNull();
    // A triangle (no ZNR printing has one) draws nothing on the oval notch.
    expect(resolveHoloStamp(profile, { stamp: "triangle" }, facts("rare"))).toBeNull();
  });

  it("splits a master into the plain bar and a piece that gives the master back (a synthetic arch)", () => {
    const W = 1500;
    const H = 2100;
    const buf = Buffer.alloc(W * H * 4);
    const set = (x: number, y: number, rgba: number[]) => rgba.forEach((v, c) => (buf[(y * W + x) * 4 + c] = v));
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        // A textured box above the bar, the straight bar, the black below.
        set(x, y, y < 1930 ? [100 + (x % 17), 90 + (y % 13), 60, 255] : y < 1937 ? [200, 200, 180, 255] : y <= 1947 ? [250, 250, 250, 255] : [0, 0, 0, 255]);
      }
    }
    // The arch: white rim from its table's row, black under it, an oval.
    for (let x = 654; x <= 846; x += 1) {
      const dx = Math.abs(x - 750);
      const top = dx < 18 ? 1905 : 1905 + Math.round(((dx - 18) / 76) * 32);
      for (let y = top; y < Math.min(top + 11, 2004); y += 1) set(x, y, [250, 250, 250, 255]);
      for (let y = top + 11; y < 2004; y += 1) set(x, y, [0, 0, 0, 255]);
    }
    for (let y = 1927; y < 1991; y += 1) for (let x = 685; x < 815; x += 1) if (((x + 0.5 - 750) / 65) ** 2 + ((y + 0.5 - 1959) / 32) ** 2 <= 1) set(x, y, [180, 190, 200, 255]);
    const original = Buffer.from(buf);
    const { plain, piece, findings } = splitZnrNotch(buf, W, H);
    expect(findings.failures).toEqual([]);
    expect(buf.equals(original)).toBe(true);
    // The plain master's bar is straight under the arch: every rim row is
    // the bar's white, the rows under it black.
    for (let x = 640; x <= 860; x += 1) {
      expect([...plain.subarray(((1940 * W) + x) * 4, ((1940 * W) + x) * 4 + 4)], `x ${x}`).toEqual([250, 250, 250, 255]);
      expect(plain[((1970 * W) + x) * 4 + 3]).toBe(255);
      expect(plain[((1970 * W) + x) * 4]).toBe(0);
    }
    // The piece over the plain master gives back the original everywhere
    // but the oval's cut.
    const { box, oval, cutMarginPx } = ZNR_NOTCH;
    for (let y = 0; y < box.height; y += 1) {
      for (let x = 0; x < box.width; x += 1) {
        const cx = box.x + x;
        const cy = box.y + y;
        const inCut = ((cx + 0.5 - (oval.x + oval.width / 2)) / (oval.width / 2 + cutMarginPx)) ** 2 + ((cy + 0.5 - (oval.y + oval.height / 2)) / (oval.height / 2 + cutMarginPx)) ** 2 <= 1;
        const p = (y * box.width + x) * 4;
        const o = (cy * W + cx) * 4;
        if (inCut) {
          expect(piece[p + 3]).toBe(0);
          continue;
        }
        const drawn = piece[p + 3] === 255 ? piece.subarray(p, p + 4) : plain.subarray(o, o + 4);
        expect([...drawn], `${cx}, ${cy}`).toEqual([...original.subarray(o, o + 4)]);
      }
    }
  });

  // The published masters (bucket; CI fetches them, FRAMES_BUILD_DIR).
  const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
  const onDisk = (rel: string) => {
    const file = path.join(BUILD, rel);
    return fs.existsSync(file) && createHash("sha256").update(fs.readFileSync(file)).digest("hex") === manifest.files[rel]?.sha256 ? file : null;
  };
  const published = KEYS.every((k) => onDisk(`fullart/${k}.png`) && onDisk(`fullart/holostamp/${k}.png`));
  it.runIf(published)("every published master runs its bar straight under the box, and its piece arches it with the oval cut clear", async () => {
    for (const k of KEYS) {
      const { data } = await sharp(onDisk(`fullart/${k}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let x = ZNR_NOTCH.centerX - ZNR_NOTCH.halfWidth; x <= ZNR_NOTCH.centerX + ZNR_NOTCH.halfWidth; x += 1) {
        for (let y = ZNR_NOTCH.rimRows[0]; y <= ZNR_NOTCH.rimRows[1]; y += 1) {
          const ref = x < 750 ? ZNR_NOTCH.refX.left : ZNR_NOTCH.refX.right;
          for (let c = 0; c < 4; c += 1) expect(data[(y * 1500 + x) * 4 + c], `${k} (${x}, ${y})`).toBe(data[(y * 1500 + ref) * 4 + c]);
        }
      }
      const piece = await sharp(onDisk(`fullart/holostamp/${k}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => piece.data[((y - ZNR_NOTCH.box.y) * ZNR_NOTCH.box.width + (x - ZNR_NOTCH.box.x)) * 4 + 3];
      // The arch's rim at the centre is drawn; the oval's centre is clear.
      expect(at(750, 1908), k).toBe(255);
      expect(at(750, 1959), k).toBe(0);
    }
  });
});

describe("the crown band", () => {
  it("is the pack's crown at CC's bounds, the pairs split across the crown ramp, keyed as the profile asks", () => {
    expect(CC_OVERLAY_BANDS.fullartcrown.keys).toEqual(ZNR_CROWN_BAND.keys);
    expect([...ZNR_CROWN.keys]).toEqual([...ZNR_CROWN_BAND.keys]);
    expect(ZNR_CROWN.assetPathTemplate).toBe("/frames/fullartcrown/{key}.png");
    expect((ZNR_CROWN.rect.heightPct / 100) * 2100).toBeCloseTo(ZNR_CROWN_BAND.rows, 6);
    expect(ZNR_CROWN.anatomy === "crown" && ZNR_CROWN.pairCrownOnGold).toBe(true);
    expect(znrCrownLayers("r")).toEqual([{ src: "img/frames/m15/zendikarRising/m15ZendikarRisingCrownR.png", at: { leftPct: 2.94, topPct: 2.34, widthPct: 94.14, heightPct: 11.67 } }]);
    expect(znrCrownLayers("rg")[0]).toMatchObject({ src: expect.stringContaining("CrownR"), right: expect.stringContaining("CrownG"), ramp: [45, 55] });
    for (const pair of TWO_COLOR_PAIRS) expect(ZNR_CROWN_BAND.keys).toContain(pair);
  });

  it("is opt-in per card: off unless the card switches it on, the pair's split crown over the gold master", () => {
    const facts = { cardType: "creature", supertype: "Legendary", colors: ["red", "green"] as const, colorKey: "m" };
    expect(resolveFrameOverlays(profile, {}, facts).filter((o) => o.anatomy === "crown")).toEqual([]);
    expect(resolveFrameOverlays(profile, { crown: true }, facts).find((o) => o.anatomy === "crown")).toMatchObject({ path: "/frames/fullartcrown/rg.png" });
    expect(resolveFrameOverlays(profile, { crown: true }, { ...facts, colors: ["red", "green", "white", "blue"] as const }).find((o) => o.anatomy === "crown")).toMatchObject({ path: "/frames/fullartcrown/m.png" });
  });
});

describe("the profile", () => {
  it("is an M15-family frame on the CC-framed M15 slots, the label unchanged", () => {
    expect(M15_FAMILY_TEMPLATES).toContain("fullart");
    expect(profile.label).toBe("Zendikar Rising Hedron");
    expect(profile.title.sizePct).toBe(TITLE_SIZE_PCT);
    expect(profile.type.sizePct).toBe(TYPE_SIZE_PCT);
    expect(profile.title.fit).toBe("measured");
    expect(profile.type.fit).toBe("measured");
    // The type line is on the painted bar (56.4–62.7 %H), not in the box.
    expect(profile.type.rect.topPct).toBeGreaterThan(55);
    expect(profile.type.rect.topPct + profile.type.rect.heightPct).toBeLessThan(63);
    expect(profile.costSizePct).toBe(CC_M15_COST_DISC_PCT);
    expect(profile.pt?.plateAssetPathTemplate).toBe("/frames/fullart/pt/{color}.png");
    expect(profile.collector).toBe(M15_COLLECTOR);
    expect(COLLECTOR_TEMPLATES).toContain("fullart");
  });

  it("puts the art under the whole frame: the slot covers CC's art bounds (4/2.86/92 × 86.48)", () => {
    const a = profile.artSlot;
    expect(a.leftPct).toBeLessThanOrEqual(4);
    expect(a.topPct).toBeLessThanOrEqual(2.86);
    expect(a.leftPct + a.widthPct).toBeGreaterThanOrEqual(96);
    expect(a.topPct + a.heightPct).toBeGreaterThanOrEqual(2.86 + 86.48);
    expect(profile.underFrameArt).toBeUndefined();
  });

  it("inks the bars black on the white key and white with a shadow elsewhere; the P/T black on the light plates", () => {
    expect(profile.title.inkByColorKey?.w).toBeUndefined();
    expect(profile.title.colorHex).not.toBe("#ffffff");
    for (const k of ["u", "b", "r", "g", "m", "c"] as const) {
      expect(profile.title.inkByColorKey?.[k]?.colorHex, k).toBe("#ffffff");
      expect(profile.type.inkByColorKey?.[k]?.shadowCss, k).toBeTruthy();
    }
    expect(profile.rules.colorHex).toBe("#ffffff");
    for (const k of ["u", "b", "r", "g"]) expect(slotInk(profile.pt!, k).colorHex, k).toBe("#ffffff");
    for (const k of ["w", "m", "c"]) expect(slotInk(profile.pt!, k).colorHex, k).not.toBe("#ffffff");
  });
});

describe("the import", () => {
  it("names the hedron showcase exact on `fullart` once verified in the colour — nearest until then", () => {
    const match = frameMatchFromScryfall(printing("znr-293"));
    expect(match).toMatchObject({ status: "exact", template: "fullart" });
    expect(withVerification(match, "w", new Set())).toMatchObject({ status: "nearest", unverified: true });
    expect(withVerification(match, "w", new Set([frameComboKey("fullart", "w")]))).toMatchObject({ status: "exact", template: "fullart" });
  });

  it("lands the one modal printing (#305 Kazandu Mammoth) on the modal front body, as before", () => {
    expect(frameMatchFromScryfall(printing("znr-305"))).toMatchObject({ status: "nearest", template: "fullart", landOn: "m15mdfcfront" });
  });
});
