import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";
import { bandTextStyle, footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { renderCardImage, RENDER_PRESETS, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Frame-review follow-ups (layout v25/v26, owner review 2026-09-25), pinned on
// REAL bakes rather than source greps: every template here draws a git frame
// from public/frames (read from disk), so the renders are deterministic and
// offline. Rendered at the "default" preset (750 × 1050) unless a block
// says otherwise.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;

function card(template: FrameTemplate, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe Knight",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Knight"],
    rarity: "uncommon",
    colorIdentity: ["white"],
    rulesText: "Vigilance",
    flavorText: null,
    power: "4",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData, brandMark = false, preset: RenderPreset = "default"): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

/** Bounding box of pixels that differ by more than 24 on any channel. */
function diffBox(a: Raw, b: Raw) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 3;
      if (
        Math.abs(a.data[i] - b.data[i]) > 24 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 24 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 24
      ) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const lum = (r: Raw, x: number, y: number) => {
  const i = (y * r.width + x) * 3;
  return 0.299 * r.data[i] + 0.587 * r.data[i + 1] + 0.114 * r.data[i + 2];
};

describe("etched finish (v26)", () => {
  it.each<FrameTemplate>(["retro", "modern"])("%s: texture on the frame only — no left-edge strip, border and art untouched", async (template) => {
    const [regular, etched] = [await bake(card(template)), await bake(card(template, { frameStyle: { template, finish: "etched" } }))];
    // Black border = pixels that are black in the regular bake. The texture
    // is masked by the frame's luminance, so near-black frame pixels may move
    // by a few levels (measured max 30 of 765 summed RGB); the old Fragment
    // bug painted a gold (#d4a64a) strip OVER the black border — ~450.
    let border = 0;
    let art = 0;
    let frame = 0;
    const artSlot = getFrameProfile(template).artSlot;
    const ax0 = Math.ceil((W * (artSlot.leftPct + 1)) / 100);
    const ax1 = Math.floor((W * (artSlot.leftPct + artSlot.widthPct - 1)) / 100);
    const ay0 = Math.ceil((H * (artSlot.topPct + 1)) / 100);
    const ay1 = Math.floor((H * (artSlot.topPct + artSlot.heightPct - 1)) / 100);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 3;
        const d = Math.abs(regular.data[i] - etched.data[i]) + Math.abs(regular.data[i + 1] - etched.data[i + 1]) + Math.abs(regular.data[i + 2] - etched.data[i + 2]);
        if (d === 0) continue;
        if (lum(regular, x, y) < 12) {
          if (d > 60) border += 1;
        }
        else if (x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1) art += 1;
        else frame += 1;
      }
    }
    expect(border).toBe(0);
    expect(art).toBe(0);
    expect(frame).toBeGreaterThan(5000);
  }, 60_000);
});

describe("pipglyph.com mark sits inside the black border (v25)", () => {
  // extendedart shares modern's placement (brand-mark-placement.test.ts) but
  // preloads the bucket-hosted M15 P/T plate, so it can't bake offline here.
  it.each<FrameTemplate>(["agclassic", "alphaland", "alphatoken", "retro", "retroland", "modern", "modernland", "battle", "split"])(
    "%s",
    async (template) => {
      // No P/T: extendedart draws the M15 plate, which lives in the frames
      // bucket (not on disk). The mark's placement doesn't depend on it.
      const land = template === "alphaland" || template === "retroland" || template === "modernland";
      const data = card(template, { cardType: land ? "land" : "instant", cost: land ? null : "{2}{W}", power: null, toughness: null });
      const [off, on] = [await bake(data, false), await bake(data, true)];
      const box = diffBox(off, on);
      expect(box).not.toBeNull();
      // Every pixel the mark covers must be black border in the unmarked bake.
      let lit = 0;
      let total = 0;
      for (let y = box!.y0; y <= box!.y1; y += 1) {
        for (let x = box!.x0; x <= box!.x1; x += 1) {
          total += 1;
          if (lum(off, x, y) > 40) lit += 1;
        }
      }
      expect(lit / total).toBeLessThan(0.01);
    },
    60_000,
  );
});

describe("Alpha brand mark is centred in the re-cut black band", () => {
  it.each<FrameTemplate>(["agclassic", "alphaland"])("%s: ink centred on 2000–2100 px", async (template) => {
    const land = template === "alphaland";
    const data = card(template, { cardType: land ? "land" : "instant", cost: land ? null : "{2}{W}", power: null, toughness: null });
    const box = diffBox(await bake(data, false), await bake(data, true))!;
    const cy = ((box.y0 + box.y1 + 1) / 2 / H) * 2100;
    expect(Math.abs(cy - 2050)).toBeLessThan(6);
  }, 60_000);
});

describe("Alpha P/T sits in the strip below the text box (v25, re-cut)", () => {
  it("centres the digits where the print does (strip 1855–2000 px = 88.33–95.24 %H)", async () => {
    const [none, pt] = [await bake(card("agclassic", { power: null, toughness: null })), await bake(card("agclassic"))];
    const box = diffBox(none, pt)!;
    const cy = ((box.y0 + box.y1 + 1) / 2 / H) * 100;
    const cx = ((box.x0 + box.x1 + 1) / 2 / W) * 100;
    const at = (cy - 88.33) / (95.24 - 88.33);
    // Printed Alpha/Beta digits: centred at 1920–1925 px (0.45–0.49 of the
    // strip), ~88 %W under the text box's right corner (19 LEA/LEB scans).
    expect(at).toBeGreaterThan(0.4);
    expect(at).toBeLessThan(0.52);
    expect(cx).toBeGreaterThan(86.5);
    expect(cx).toBeLessThan(89.5);
    // …and entirely inside the strip, clear of the text box and the pinstripe.
    expect(box.y0 / H).toBeGreaterThan(1855 / 2100);
    expect((box.y1 + 1) / H).toBeLessThan(1990 / 2100);
  }, 60_000);
});

describe("Alpha ink: silver lettering on every frame but white", () => {
  const COLOR: Record<string, CardPreviewData["colorIdentity"]> = {
    w: ["white"],
    u: ["blue"],
    b: ["black"],
    r: ["red"],
    g: ["green"],
    c: ["colorless"],
    m: ["white", "blue"],
  };
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lumOf = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b;

  /** The median colour of the lightest (or darkest) 3 % of `pixels`. */
  function extreme(r: Raw, pixels: number[], light: boolean) {
    const sorted = [...pixels].sort((a, b) => {
      const d = lumOf([...r.data.subarray(a, a + 3)]) - lumOf([...r.data.subarray(b, b + 3)]);
      return light ? -d : d;
    });
    const pick = sorted.slice(0, Math.max(3, Math.round(sorted.length * 0.03)));
    const mid = pick[Math.floor(pick.length / 2)];
    return [...r.data.subarray(mid, mid + 3)];
  }
  /** Pixel offsets inside a card-percent rect. */
  function rectPixels(r: Raw, rect: { topPct: number; leftPct: number; widthPct: number; heightPct: number }) {
    const out: number[] = [];
    for (let y = Math.ceil((rect.topPct / 100) * H); y < Math.floor(((rect.topPct + rect.heightPct) / 100) * H); y += 1) {
      for (let x = Math.ceil((rect.leftPct / 100) * W); x < Math.floor(((rect.leftPct + rect.widthPct) / 100) * W); x += 1) {
        out.push((y * W + x) * 3);
      }
    }
    return out;
  }

  it.each(["w", "u", "b", "r", "g", "c", "m"])("agclassic %s: the bake prints the P/T in slotInk's colour", async (key) => {
    const layout = getFrameProfile("agclassic");
    const ink = slotInk(layout.pt!, key);
    const [none, pt] = [
      await bake(card("agclassic", { colorIdentity: COLOR[key], power: null, toughness: null })),
      await bake(card("agclassic", { colorIdentity: COLOR[key] })),
    ];
    const b = diffBox(none, pt)!;
    const pixels: number[] = [];
    for (let y = b.y0; y <= b.y1; y += 1) for (let x = b.x0; x <= b.x1; x += 1) pixels.push((y * W + x) * 3);
    const light = key !== "w";
    // White keeps the dark ink; every other colour is light silver.
    expect(lumOf(hex(ink.colorHex)) > 120).toBe(light);
    const got = extreme(pt, pixels, light);
    hex(ink.colorHex).forEach((c, i) => expect(Math.abs(got[i] - c), `${key} channel ${i}`).toBeLessThan(14));
    // The emboss: silver digits carry a dark lower-right edge.
    if (light) expect(lumOf(extreme(pt, pixels, false))).toBeLessThan(lumOf(extreme(none, pixels, false)) - 10);
  }, 60_000);

  it.each([
    ["agclassic", "b"],
    ["agclassic", "r"],
    ["agclassic", "w"],
    ["alphaland", "w"],
  ])("%s %s: the bake prints the artist line in footerInk's colour", async (template, key) => {
    const layout = getFrameProfile(template as FrameTemplate);
    const ink = footerInk(layout.footer!, key);
    const land = template === "alphaland";
    const r = await bake(card(template as FrameTemplate, {
      colorIdentity: COLOR[key],
      artistCredit: "Douglas Schuler",
      ...(land ? { cardType: "land", cost: null, power: null, toughness: null } : {}),
    }));
    const light = lumOf(hex(ink.colorHex)) > 120;
    // The land frame is brown on every key, so even its white key is silver.
    expect(light).toBe(land || key !== "w");
    const got = extreme(r, rectPixels(r, layout.footer!.rect), light);
    hex(ink.colorHex).forEach((c, i) => expect(Math.abs(got[i] - c), `channel ${i}`).toBeLessThan(18));
    // The emboss: silver lettering carries a dark lower-right edge in the
    // bake too (the preview's is pinned in alpha-ink.test.tsx).
    // Compared with the bare frame master (an empty credit still prints
    // "Art: Unknown", so a second bake would carry lettering too).
    if (light) {
      const { data: frame } = await sharp(`public/frames/${template}/${key}.png`)
        .flatten({ background: "#000" })
        .resize(W, H, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bare: Raw = { data: frame, width: W, height: H };
      // Light lettering can only brighten the frame; only the emboss shadow
      // darkens it — so count pixels the bake draws darker than the master.
      // (On the near-black strip of the black frame a shadow has nothing to
      // darken, as on the print, so that key checks the colour only.)
      const pixels = rectPixels(r, layout.footer!.rect);
      const lumAt = (raw: Raw, o: number) => lumOf([...raw.data.subarray(o, o + 3)]);
      const stripLum = pixels.reduce((sum, o) => sum + lumAt(bare, o), 0) / pixels.length;
      if (stripLum > 60) {
        const darker = pixels.filter((o) => lumAt(r, o) < lumAt(bare, o) - 20).length;
        expect(darker).toBeGreaterThan(20);
      }
    }
  }, 60_000);

  // The name and type line (TODO 4.31): silver on every colour Alpha printed,
  // dark on white and on our gold, silver on every land — the same
  // bandTextStyle() the preview applies (pinned in alpha-ink.test.tsx).
  it.each([
    ...["w", "u", "b", "r", "g", "c", "m"].map((k) => ["agclassic", k]),
    ["alphaland", "w"],
    ["alphaland", "m"],
  ])("%s %s: the bake prints the name and type line in bandTextStyle's colour", async (template, key) => {
    const land = template === "alphaland";
    const layout = getFrameProfile(template as FrameTemplate);
    const base = { colorIdentity: COLOR[key], cost: null, power: null, toughness: null, rarity: null };
    const named = await bake(card(template as FrameTemplate, {
      ...base,
      title: "Sengir Vampire",
      cardType: land ? "land" : "creature",
      subtypes: [land ? "Swamp" : "Vampire"],
    }));
    // A one-dot name and a blank type line: whatever else moved is lettering.
    const blank = await bake(card(template as FrameTemplate, { ...base, title: ".", cardType: null, supertype: null, subtypes: [" "] } as unknown as Partial<CardPreviewData>));
    const { data: frame } = await sharp(`public/frames/${template}/${key}.png`)
      .flatten({ background: "#000" })
      .resize(W, H, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bare: Raw = { data: frame, width: W, height: H };
    const lumAt = (raw: Raw, o: number) => lumOf([...raw.data.subarray(o, o + 3)]);
    for (const [what, slot] of [["name", layout.title], ["type line", layout.type]] as const) {
      const want = bandTextStyle(slot, key);
      const light = Boolean(want.color);
      expect(light, `${key} ${what}`).toBe(land || !"wm".includes(key));
      const moved = rectPixels(named, slot.rect).filter((o) =>
        [0, 1, 2].some((c) => Math.abs(named.data[o + c] - blank.data[o + c]) > 24),
      );
      expect(moved.length, `${key} ${what}`).toBeGreaterThan(200);
      const got = extreme(named, moved, light);
      hex(want.color ?? slot.colorHex).forEach((c, i) => expect(Math.abs(got[i] - c), `${key} ${what} channel ${i}`).toBeLessThan(18));
      // The emboss: silver lettering darkens the frame down and right of
      // each stroke (not on the near-black frame, where there's nothing to
      // darken — as on the print).
      const bandLum = moved.reduce((sum, o) => sum + lumAt(bare, o), 0) / moved.length;
      if (light && bandLum > 60) {
        expect(moved.filter((o) => lumAt(named, o) < lumAt(bare, o) - 20).length, `${key} ${what} emboss`).toBeGreaterThan(20);
      }
    }
  }, 60_000);

  it("the pips print the same on every Alpha colour: the emboss stays on the name", async () => {
    // Baked at HD with a one-dot name: a band-level text-shadow (inherited
    // by the pip glyphs) would draw a dark offset copy of each symbol inside
    // its disc on the silver colours only.
    const pipsOn = (key: string, cost: string | null) =>
      bake(card("agclassic", { colorIdentity: COLOR[key], title: ".", cost, power: null, toughness: null }), false, "hd");
    // Where the 54 px disc sits, read off the white frame (its hard shadow
    // falls down-left, so the box's top and right edges are the disc's).
    const crop = (r: Raw): Raw => ({ data: r.data.subarray(80 * r.width * 3, 215 * r.width * 3), width: r.width, height: 135 });
    const box = diffBox(crop(await pipsOn("w", "{6}")), crop(await pipsOn("w", null)))!;
    const [cx, cy] = [box.x1 - 27, box.y0 + 80 + 27];
    /** The disc's interior, RGB. */
    const disc = async (key: string) => {
      const pips = await pipsOn(key, "{6}");
      const out: number[] = [];
      for (let y = cy - 14; y <= cy + 14; y += 1) for (let x = cx - 14; x <= cx + 14; x += 1) out.push(...pips.data.subarray((y * pips.width + x) * 3, (y * pips.width + x) * 3 + 3));
      return out;
    };
    const white = await disc("w");
    for (const key of ["b", "r", "c"]) {
      const got = await disc(key);
      const worst = Math.max(...got.map((v, i) => Math.abs(v - white[i])));
      expect(worst, key).toBeLessThanOrEqual(2);
    }
  }, 120_000);
});

describe("Alpha name, pips and type line (owner review round 4)", () => {
  // Baked at the "hd" preset (1500 × 2100) so every number is an HD px and a
  // 1–2 px move is visible (the default preset halves it). The art window's
  // edge is ~178 px (the owner's pick, "B2"); round 3 put the name at ~114 px
  // and the type line at ~157, with 48 px caps and 63 px pip discs centred
  // ~5 px above the caps.
  const hd = (data: CardPreviewData) => bake(data, false, "hd");
  /** diffBox limited to rows y0–y1. */
  function bandBox(a: Raw, b: Raw, y0: number, y1: number) {
    const crop = (r: Raw): Raw => ({
      data: r.data.subarray(y0 * r.width * 3, y1 * r.width * 3),
      width: r.width,
      height: y1 - y0,
    });
    const box = diffBox(crop(a), crop(b));
    return box && { ...box, y0: box.y0 + y0, y1: box.y1 + y0 };
  }
  const differs = (a: Raw, b: Raw, x: number, y: number) => {
    const i = (y * a.width + x) * 3;
    return Math.abs(a.data[i] - b.data[i]) > 24 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 24 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 24;
  };
  const TITLE_ROWS: [number, number] = [80, 215];
  const TYPE_ROWS: [number, number] = [1150, 1262];

  it.each<FrameTemplate>(["agclassic", "alphaland"])("%s: name and type line start on one left margin, the art window's edge", async (template) => {
    const land = template === "alphaland";
    const base = {
      title: "Dawn Treader",
      cost: land ? null : "{6}",
      cardType: land ? "land" : "creature",
      supertype: "Legendary",
      subtypes: land ? ["Island"] : ["Horror"],
      power: null,
      toughness: null,
    } as Partial<CardPreviewData>;
    const full = await hd(card(template, base));
    // A blank title bakes as "Untitled Card", so the name box is the union of
    // both names' ink: one left margin, caps + the d/l/t ascenders, no
    // descenders.
    const noName = await hd(card(template, { ...base, title: " " }));
    const noType = await hd(card(template, { ...base, cardType: null, supertype: null, subtypes: [" "] }));
    const name = bandBox(full, noName, ...TITLE_ROWS)!;
    const type = bandBox(full, noType, ...TYPE_ROWS)!;
    expect(name).not.toBeNull();
    expect(type).not.toBeNull();
    // Both start at the art window's edge (~178–181 px) — round 3 had the
    // name at ~114 and the type line at 156–158.
    for (const [what, box] of [["name", name], ["type", type]] as const) {
      expect(box.x0, what).toBeGreaterThanOrEqual(176);
      expect(box.x0, what).toBeLessThanOrEqual(184);
    }
    expect(Math.abs(name.x0 - type.x0)).toBeLessThanOrEqual(3);
    // 41 px caps: the two names' ink measures ~45 px with the ascenders and
    // anti-aliasing (round 3's 48 px caps: ~54), centred at ~141 px.
    const inkH = name.y1 - name.y0 + 1;
    expect(inkH).toBeGreaterThan(40);
    expect(inkH).toBeLessThan(50);
    expect(Math.abs((name.y0 + name.y1 + 1) / 2 - 141)).toBeLessThan(4);
  }, 60_000);

  it("agclassic: smaller pips, still ending at ~1362 px and centred on the name's caps", async () => {
    const base = { title: "Dawn Treader", cost: "{6}", power: null, toughness: null } as Partial<CardPreviewData>;
    const full = await hd(card("agclassic", base));
    const pipsOnly = await hd(card("agclassic", { ...base, title: " " }));
    const blank = await hd(card("agclassic", { ...base, title: " ", cost: null }));
    const name = bandBox(full, pipsOnly, ...TITLE_ROWS)!;
    const pip = bandBox(pipsOnly, blank, ...TITLE_ROWS)!;
    expect(Math.abs(pip.x1 + 1 - 1362)).toBeLessThanOrEqual(4);
    // The RENDERED disc, not the profile's number: its hard shadow falls
    // down-left, so the top and right edges are clean. The rows whose ink
    // reaches one px in from the right edge straddle the disc's centre, and
    // top → centre is the radius.
    const rows: number[] = [];
    for (let y = pip.y0; y <= pip.y1; y += 1) if (differs(pipsOnly, blank, pip.x1 - 1, y)) rows.push(y);
    expect(rows.length).toBeGreaterThan(2);
    const pipMid = (rows[0] + rows[rows.length - 1] + 1) / 2;
    const d = 2 * (pipMid - pip.y0);
    // 54 px discs (round 3: 63).
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(58);
    // Centred on the name's caps: round 3's lift (costDy −0.004) would sit
    // today's discs ~4 px high.
    const capMid = (name.y0 + name.y1 + 1) / 2;
    expect(Math.abs(pipMid - capMid)).toBeLessThanOrEqual(2);
  }, 60_000);
});

describe("Alpha masters are re-cut to the printed proportions", () => {
  // scripts/build-alpha-frames.mjs: frame 80–1421 × 89–2000, art opening
  // 178–1319 × 219–1138, text box 186–1318 × 1247–1855 (HD px).
  async function master(template: string, key: string) {
    const { data, info } = await sharp(`public/frames/${template}/${key}.png`)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * 4;
      return {
        l: 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
        s: Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]),
        a: data[i + 3],
      };
    };
    /** Mean luminance and min alpha of the 9 × 9 box around (x, y). */
    const box = (x: number, y: number) => {
      let l = 0;
      let a = 255;
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const p = at(x + dx, y + dy);
          l += p.l / 81;
          a = Math.min(a, p.a);
        }
      }
      return { l, a };
    };
    /** Mean luminance (over black) — or saturation, with `sat` — across
     *  `span` (x when `axis` is "x", else y), averaged along `along`,
     *  indexed by absolute pixel. */
    const profile = (axis: "x" | "y", along: [number, number], span: [number, number], sat = false) => {
      const p = new Float64Array(axis === "x" ? info.width : info.height);
      for (let t = span[0]; t < span[1]; t += 1) {
        let sum = 0;
        for (let s = along[0]; s < along[1]; s += 1) {
          const q = axis === "x" ? at(t, s) : at(s, t);
          sum += ((sat ? q.s : q.l) * q.a) / 255;
        }
        p[t] = sum / (along[1] - along[0]);
      }
      return p;
    };
    return { info, at, box, profile };
  }

  it.each(["agclassic", "alphaland"])("%s: black border, art opening and strip where the print has them", async (template) => {
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      const { info, at, box } = await master(template, key);
      expect([info.width, info.height], key).toEqual([1500, 2100]);
      // The 100 px black band below the frame, 80 px at the sides, 89 on top
      // (the old MSE upscale had 60 px all round).
      for (const [x, y] of [[750, 2006], [750, 2090], [40, 1000], [1460, 1000], [750, 45], [70, 1000], [1430, 1000]]) {
        expect(box(x, y).a, `${key} ${x},${y}`).toBe(255);
        expect(box(x, y).l, `${key} ${x},${y}`).toBeLessThan(6);
      }
      // Frame just inside those edges: the strip, the side borders, the
      // title band.
      for (const [x, y] of [[750, 1990], [750, 1900], [130, 600], [1375, 600], [750, 150]]) {
        expect(box(x, y).a, `${key} ${x},${y}`).toBe(255);
        expect(box(x, y).l, `${key} ${x},${y}`).toBeGreaterThan(12);
      }
      // The art opening is cut exactly; the bevel around it is opaque.
      expect(at(178, 219).a).toBe(0);
      expect(at(1318, 1137).a).toBe(0);
      for (const [x, y] of [[177, 600], [1319, 600], [750, 218], [750, 1138]]) {
        expect(at(x, y).a, `${key} ${x},${y}`).toBe(255);
      }
      // Rounded card corners stay transparent.
      expect(at(0, 0).a).toBe(0);
      expect(at(1499, 2099).a).toBe(0);
    }
  });

  it("agclassic c is the artifact card: a dark warm-brown frame round a light text box (TODO 4.31)", async () => {
    // Printed colourless Alpha cards are artifacts (Sol Ring, Juggernaut —
    // frame ≈ #645a53, crackle box ≈ #c8c4bc on the scans); MSE's ccard.jpg
    // was a flat mid-grey (title band ≈ #767676, box ≈ #989898).
    const { data, info } = await sharp("public/frames/agclassic/c.png").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    /** Mean RGB over an HD px rect [x0, y0, x1, y1). */
    const mean = ([x0, y0, x1, y1]: number[]) => {
      const sum = [0, 0, 0];
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) for (let c = 0; c < 3; c += 1) sum[c] += data[(y * info.width + x) * 3 + c];
      return sum.map((v) => v / ((x1 - x0) * (y1 - y0)));
    };
    for (const [what, rect] of [["title band", [200, 110, 1300, 190]], ["type band", [200, 1172, 1300, 1240]], ["strip", [200, 1870, 1300, 1975]]] as const) {
      const [r, g, b] = mean([...rect]);
      expect(0.299 * r + 0.587 * g + 0.114 * b, what).toBeLessThan(70);
      expect(r - b, `${what}: warm`).toBeGreaterThan(15);
    }
    const [r, g, b] = mean([260, 1300, 1240, 1800]);
    expect(0.299 * r + 0.587 * g + 0.114 * b, "text box").toBeGreaterThan(180);
  });

  it("the art slot covers the opening and stays under the art box's bevel", () => {
    // The art box outline (agclassic) and the land border's inner dark line
    // (alphaland) both end at ~159 / 1344 × 201 / 1160.
    for (const template of ["agclassic", "alphaland"] as const) {
      const a = getFrameProfile(template).artSlot;
      const x0 = (a.leftPct / 100) * 1500;
      const x1 = ((a.leftPct + a.widthPct) / 100) * 1500;
      const y0 = (a.topPct / 100) * 2100;
      const y1 = ((a.topPct + a.heightPct) / 100) * 2100;
      expect(x0).toBeLessThanOrEqual(178);
      expect(x0).toBeGreaterThan(159);
      expect(x1).toBeGreaterThanOrEqual(1319);
      expect(x1).toBeLessThan(1344);
      expect(y0).toBeLessThanOrEqual(219);
      expect(y0).toBeGreaterThan(201);
      expect(y1).toBeGreaterThanOrEqual(1138);
      expect(y1).toBeLessThan(1160);
    }
  });

  // Owner decision (2026-09-25, round 2): the lines drawn the print's way.
  // Every line group is read off a luminance (for the land's coloured lines,
  // saturation) profile taken across it and averaged along it — the same
  // measurement as on the scans, whose medians are the targets: 19 LEA/LEB
  // non-land scans for agclassic, 7 basic lands for alphaland. The first
  // re-cut drew MSE's dark · light · dark lines ~2× the print's; a thinner
  // copy of that structure still read as double lines.
  const median = (p: Float64Array, a: number, b: number) => [...p.subarray(a, b)].sort((u, v) => u - v)[(b - a) >> 1];
  /** Sub-pixel position (pixel-edge coordinates) where p crosses `level` between i and i + 1. */
  const cross = (p: Float64Array, i: number, level: number) =>
    i + 0.5 + (p[i] === p[i + 1] ? 0.5 : (level - p[i]) / (p[i + 1] - p[i]));
  /** The black → frame edge: half way between the border and the frame. */
  function edge(p: Float64Array, win: [number, number], black: [number, number], frame: [number, number], blackFirst: boolean) {
    const level = (median(p, ...black) + median(p, ...frame)) / 2;
    if (blackFirst) {
      for (let i = win[0]; i < win[1] - 1; i += 1) if (p[i] < level && p[i + 1] >= level) return cross(p, i, level);
    } else {
      for (let i = win[1] - 2; i >= win[0]; i -= 1) if (p[i] >= level && p[i + 1] < level) return cross(p, i, level);
    }
    return NaN;
  }
  /** Prominent dark lines in `win`: local minima at least 12 below the
   *  brightest point within 4 px on BOTH sides (pixel-centre positions). */
  function darkLines(p: Float64Array, win: [number, number]) {
    const out: number[] = [];
    for (let i = win[0]; i < win[1]; i += 1) {
      if (!(p[i] <= p[i - 1] && p[i] < p[i + 1])) continue;
      const left = Math.max(...p.subarray(i - 4, i));
      const right = Math.max(...p.subarray(i + 1, i + 5));
      if (Math.min(left, right) - p[i] > 12) out.push(i + 0.5);
    }
    return out;
  }
  /** The darkest line in `win`, measured at half depth against each flank. */
  function line(p: Float64Array, win: [number, number], flankA: [number, number], flankB: [number, number]) {
    let m = win[0];
    for (let i = win[0]; i < win[1]; i += 1) if (p[i] < p[m]) m = i;
    const [a, b] = [(p[m] + median(p, ...flankA)) / 2, (p[m] + median(p, ...flankB)) / 2];
    let i = m;
    while (i > win[0] && p[i - 1] < a) i -= 1;
    let j = m;
    while (j < win[1] && p[j + 1] < b) j += 1;
    const first = cross(p, i - 1, a);
    const last = cross(p, j, b);
    return { first, last, width: last - first, centre: (first + last) / 2 };
  }
  /** Profiles are read this far beyond each group's window, on both sides. */
  const READ_PAD = 8;
  /** A coloured line: where saturation rises above half its peak over the
   *  median of the whole profile read (the window ± READ_PAD — the text
   *  box's right ring alone fills half its window, so the window's own
   *  median sat on the ring's edge pixel and moved with that one column's
   *  palette colour). [first, last) in pixel edges, or null. */
  function colourBand(s: Float64Array, win: [number, number]) {
    const base = median(s, win[0] - READ_PAD, win[1] + READ_PAD);
    let peak = 0;
    for (let i = win[0]; i < win[1]; i += 1) peak = Math.max(peak, s[i] - base);
    if (peak < 25) return null;
    let first = -1;
    let last = -1;
    for (let i = win[0]; i < win[1]; i += 1) {
      if (s[i] - base > peak / 2) {
        if (first < 0) first = i;
        last = i + 1;
      }
    }
    return [first, last] as const;
  }
  type Group = { axis: "x" | "y"; along: [number, number]; win: [number, number] };
  // Where each line group is read (the masters carry no text).
  const G: Record<string, Group> = {
    pinL: { axis: "x", along: [400, 1000], win: [78, 100] },
    pinR: { axis: "x", along: [400, 1000], win: [1400, 1421] },
    pinT: { axis: "y", along: [400, 1100], win: [88, 108] },
    pinB: { axis: "y", along: [750, 1150], win: [1980, 2000] },
    artL: { axis: "x", along: [400, 1000], win: [140, 170] },
    artR: { axis: "x", along: [400, 1000], win: [1336, 1362] },
    artT: { axis: "y", along: [400, 1100], win: [184, 210] },
    artB: { axis: "y", along: [400, 1100], win: [1154, 1176] },
    txtL: { axis: "x", along: [1350, 1750], win: [180, 210] },
    txtR: { axis: "x", along: [1350, 1750], win: [1290, 1322] },
    txtT: { axis: "y", along: [500, 1000], win: [1242, 1274] },
    txtB: { axis: "y", along: [500, 1000], win: [1828, 1860] },
  };
  const read = (m: Awaited<ReturnType<typeof master>>, g: Group, sat = false) =>
    m.profile(g.axis, g.along, [g.win[0] - READ_PAD, g.win[1] + READ_PAD], sat);
  /** The frame's black edges, the same on both templates (print 81.2 ·
   *  1422.3 · 88.6 · 1999.5; the masters keep 80 · 1421 · 89 · 2000). */
  function frameEdges(m: Awaited<ReturnType<typeof master>>, tag: string) {
    const near = (got: number, want: number, what: string) =>
      expect(Math.abs(got - want), `${tag} ${what}: ${got.toFixed(1)} vs ${want}`).toBeLessThanOrEqual(2);
    const rows = m.profile("x", [400, 1000], [40, 1460]);
    near(edge(rows, [66, 100], [45, 66], [120, 145], true), 81.2, "left frame edge");
    near(edge(rows, [1400, 1436], [1436, 1455], [1355, 1380], false), 1422.3, "right frame edge");
    near(edge(m.profile("y", [1000, 1300], [40, 260]), [75, 110], [50, 72], [125, 150], true), 88.6, "top frame edge");
    near(edge(m.profile("y", [950, 1150], [1780, 2060]), [1985, 2020], [2020, 2045], [1900, 1935], false), 1999.5, "bottom frame edge");
  }

  it.each(["w", "u", "b", "r", "g", "c", "m"])("agclassic %s: ONE thin dark line per group, where the print has it", async (key) => {
    const m = await master("agclassic", key);
    const tag = `agclassic/${key}`;
    frameEdges(m, tag);
    // Print medians of the lines' darkest point (19 scans). The pinstripe is
    // a light band then this one line; the art box one outline, then its
    // bevel face; the text box one outline, then a shaded bevel.
    const PRINT: Record<string, number> = {
      pinL: 87.5, pinR: 1412.5, pinT: 98, pinB: 1992.5,
      artL: 157.5, artR: 1345.5, artT: 199.5, artB: 1161.5,
      txtL: 187.5, txtR: 1316.5, txtT: 1248.5, txtB: 1853.5,
    };
    for (const [name, want] of Object.entries(PRINT)) {
      const lines = darkLines(read(m, G[name]), G[name].win);
      // The black frame's art box outline barely shows against its bevel.
      if (key === "b" && lines.length === 0) continue;
      expect(lines, `${tag} ${name}: dark lines ${lines.join(", ")}`).toHaveLength(1);
      expect(Math.abs(lines[0] - want), `${tag} ${name}: ${lines[0]} vs print ${want}`).toBeLessThanOrEqual(2);
    }
    // Outline widths at half depth, all four sides (print 2.4–4.2 px).
    const rows = m.profile("x", [400, 1000], [100, 1400]);
    const cols = m.profile("y", [400, 1100], [150, 1250]);
    const textRows = m.profile("x", [1350, 1750], [150, 1350]);
    const textCols = m.profile("y", [500, 1000], [1200, 1880]);
    const outlines: [string, ReturnType<typeof line>, number][] = [
      ["art box (left)", line(rows, [150, 166], [120, 145], [165, 172]), 157.4],
      ["art box (right)", line(rows, [1336, 1352], [1325, 1340], [1352, 1380]), 1345.2],
      ["art box (top)", line(cols, [192, 208], [160, 190], [204, 212]), 199.9],
      ["art box (bottom)", line(cols, [1154, 1170], [1143, 1156], [1170, 1200]), 1162],
      ["text box (left)", line(textRows, [180, 196], [150, 180], [192, 198]), 187.3],
      ["text box (right)", line(textRows, [1308, 1324], [1302, 1312], [1324, 1345]), 1317],
      ["text box (top)", line(textCols, [1240, 1256], [1215, 1240], [1253, 1260]), 1248.3],
      ["text box (bottom)", line(textCols, [1844, 1860], [1838, 1848], [1860, 1880]), 1853.8],
    ];
    for (const [what, got, want] of outlines) {
      if (key === "b" && what.startsWith("art box") && got.width > 8) continue; // (see above)
      expect(Math.abs(got.centre - want), `${tag} ${what} outline at ${got.centre.toFixed(1)} vs print ${want}`).toBeLessThanOrEqual(2);
      expect(got.width, `${tag} ${what} outline ${got.width.toFixed(1)} px`).toBeGreaterThanOrEqual(1.5);
      expect(got.width, `${tag} ${what} outline ${got.width.toFixed(1)} px`).toBeLessThanOrEqual(5);
    }
    // The text box's bevel ends where the print's does (textured area
    // L 201 · R 1299.5 · T 1265 · B 1835): half way between the bevel's
    // level and the textured area's, scanning outward from the text.
    const smooth = (p: Float64Array) => p.map((_, i) => (p[i - 1] + p[i] + p[i + 1]) / 3);
    const bevels: [string, Float64Array, [number, number], [number, number], number, number][] = [
      ["left", smooth(textRows), [215, 235], [190, 196], -1, 201],
      ["right", smooth(textRows), [1265, 1285], [1303, 1310], 1, 1299.5],
      ["top", smooth(textCols), [1285, 1300], [1252, 1258], -1, 1265],
      ["bottom", smooth(textCols), [1800, 1815], [1840, 1848], 1, 1835],
    ];
    for (const [side, p, inner, bevel, dir, want] of bevels) {
      const [a, b] = [median(p, ...inner), median(p, ...bevel)];
      if (Math.abs(a - b) < 12) continue; // no visible bevel on this colour
      const level = (a + b) / 2;
      let at = NaN;
      for (let i = dir > 0 ? inner[1] : inner[0]; dir > 0 ? i < bevel[1] : i > bevel[0]; i += dir) {
        if ((p[i] - level) * (p[i + dir] - level) <= 0) {
          at = i + 0.5 + dir * 0.5;
          break;
        }
      }
      expect(Math.abs(at - want), `${tag} text box bevel (${side}) ends at ${at} vs print ${want}`).toBeLessThanOrEqual(6);
    }
  });

  it.each(["w", "u", "b", "r", "g", "c", "m"])("alphaland %s: the land print's dark · colour · dark lines", async (key) => {
    const m = await master("alphaland", key);
    const tag = `alphaland/${key}`;
    frameEdges(m, tag);
    // Land prints (7 basics): the pinstripe and the art box border are
    // dark · colour · dark (the border OUTSIDE the non-land outline), the
    // text box an outline, a 12–15 px coloured ring and an inner line.
    // [outer dark line, inner dark line, coloured band [first, last)].
    const PRINT: Record<string, [number, number, [number, number]]> = {
      pinL: [86.5, 93.5, [88, 91]],
      pinR: [1413, 1406.5, [1408, 1412]],
      pinT: [99.5, 105.5, [100, 104.5]],
      pinB: [1992.5, 1985.5, [1987, 1990]],
      artL: [145.5, 157.5, [148, 154]],
      artR: [1355.5, 1345.5, [1349, 1353]],
      artT: [190.5, 201.5, [192, 198]],
      artB: [1171.5, 1162.5, [1163, 1169]],
      txtL: [188.5, 202.5, [191.5, 201.5]],
      txtR: [1317.5, 1296.5, [1298, 1313]],
      txtT: [1250.5, 1268.5, [1253, 1267]],
      txtB: [1853.5, 1836.5, [1838, 1850.5]],
    };
    for (const [name, [outer, inner, band]] of Object.entries(PRINT)) {
      const lines = darkLines(read(m, G[name]), G[name].win);
      const hit = (want: number) => lines.some((l) => Math.abs(l - want) <= 2.5);
      const found = `${tag} ${name}: dark lines ${lines.join(", ")} vs print ${outer} / ${inner}`;
      // The black land's colour is dark itself, so one of its lines may merge.
      if (key === "b") expect(hit(outer) || hit(inner), found).toBe(true);
      else expect(hit(outer) && hit(inner), found).toBe(true);
      // The coloured band, where the land colour stands out: not on the
      // white or black land, nor round green's (itself green) text box.
      if ("wb".includes(key) || (key === "g" && name.startsWith("txt"))) continue;
      const got = colourBand(read(m, G[name], true), G[name].win);
      expect(got, `${tag} ${name}: no coloured band`).not.toBeNull();
      expect(Math.abs(got![0] - band[0]), `${tag} ${name}: band ${got} vs print ${band}`).toBeLessThanOrEqual(2.5);
      expect(Math.abs(got![1] - band[1]), `${tag} ${name}: band ${got} vs print ${band}`).toBeLessThanOrEqual(2.5);
    }
  });

  it("the text rects sit inside the re-cut bands", () => {
    // HD px, from scripts/build-alpha-frames.mjs (checked on the masters above).
    const BANDS = {
      agclassic: { title: [90, 100, 1411, 198], type: [90, 1164, 1411, 1247], text: [201, 1265, 1299.5, 1835], strip: [90, 1855, 1411, 1991] },
      alphaland: { title: [94, 106, 1405, 189.5], type: [94, 1172, 1405, 1249], text: [207, 1272, 1292.5, 1832], strip: [94, 1854.5, 1405, 1984.5] },
    } as const;
    const hd = (r: { topPct: number; leftPct: number; widthPct: number; heightPct: number }) => ({
      x0: (r.leftPct / 100) * 1500,
      y0: (r.topPct / 100) * 2100,
      x1: ((r.leftPct + r.widthPct) / 100) * 1500,
      y1: ((r.topPct + r.heightPct) / 100) * 2100,
    });
    for (const template of ["agclassic", "alphaland"] as const) {
      const layout = getFrameProfile(template);
      const b = BANDS[template];
      const inside = (what: string, v: number, lo: number, hi: number) =>
        expect(v >= lo && v <= hi, `${template} ${what}: ${v.toFixed(1)} not in ${lo}–${hi}`).toBe(true);
      // Rules: inside the textured area with ≥ 8 px to spare on every side.
      const rules = hd(layout.rules.rect);
      inside("rules left", rules.x0, b.text[0] + 8, b.text[2]);
      inside("rules right", rules.x1, b.text[0], b.text[2] - 8);
      inside("rules top", rules.y0, b.text[1] + 8, b.text[3]);
      inside("rules bottom", rules.y1, b.text[1], b.text[3] - 8);
      // Name and type line: inside the pinstripe, centred in their bands.
      for (const [what, rect, band] of [["title", hd(layout.title.rect), b.title], ["type", hd(layout.type.rect), b.type]] as const) {
        inside(`${what} left`, rect.x0, band[0], band[2]);
        inside(`${what} right`, rect.x1, band[0], band[2]);
        const quarter = (band[3] - band[1]) / 4;
        inside(`${what} centre`, (rect.y0 + rect.y1) / 2, band[1] + quarter, band[3] - quarter);
      }
      // Artist line and P/T: within the strip, above its pinstripe.
      for (const [what, rect] of [["footer", hd(layout.footer!.rect)], ["pt", hd(layout.pt!.rect)]] as const) {
        inside(`${what} top`, rect.y0, b.strip[1], b.strip[3]);
        inside(`${what} bottom`, rect.y1, b.strip[1], b.strip[3]);
      }
    }
  });
});

describe("Dragon Wing P/T plates (v25)", () => {
  it("ships a 271 × 149 plate for every colour, drawn exactly at its crop box", async () => {
    for (const c of ["w", "u", "b", "r", "g", "c", "m"]) {
      const meta = await sharp(`public/frames/tarkirdragon/pt/${c}.png`).metadata();
      expect([meta.width, meta.height], c).toEqual([271, 149]);
      const webp = await sharp(`public/frames/tarkirdragon/pt/${c}.webp`).metadata();
      expect([webp.width, webp.height], `${c}.webp`).toEqual([271, 149]);
    }
    // scripts/build-showcase-frames.mjs crops MSE's plate at 1156,1850 on the
    // 1500 × 2100 card.
    const r = getFrameProfile("tarkirdragon").pt!.plateRect!;
    expect((r.leftPct / 100) * 1500).toBeCloseTo(1156, 0);
    expect((r.topPct / 100) * 2100).toBeCloseTo(1850, 0);
    expect((r.widthPct / 100) * 1500).toBeCloseTo(271, 0);
    expect((r.heightPct / 100) * 2100).toBeCloseTo(149, 0);
  });
});
