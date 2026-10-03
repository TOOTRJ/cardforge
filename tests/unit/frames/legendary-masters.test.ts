import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BORDERLESS_CROWN,
  CC_TEMPLATES,
  LEGENDARY_MASTER_KEYS as IMPORTER_LEGENDARY_KEYS,
  LEGENDARY_MASTER_SUFFIX as IMPORTER_SUFFIX,
  MASTER_KEYS,
  borderlessCrownLayers,
  borderlessPairLayers,
  describeLayer,
  legendaryKey,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS } from "@/scripts/lib/pair-ramp.mjs";
import {
  FRAME_COLOR_KEYS,
  FRAME_MASTER_KEYS,
  LEGENDARY_MASTER_KEYS,
  LEGENDARY_MASTER_SUFFIX,
  TWO_COLOR_MASTER_KEYS,
  baseMasterKey,
  isLegendaryMasterKey,
  legendaryMasterKey,
} from "@/lib/cards/frame-reference-registry";
import { artLayersFor, bandTextStyle, footerInk, getFrameProfile, slotInk, underFrameArtRect } from "@/lib/cards/template-layout";
import { CROWNED_EDGE_CONTRACTS, EDGE_CONTRACTS, edgeContractFor } from "@/lib/frames/edge-contract";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (wave 2a) — the crowned twins: a template whose legendary crown
// is baked into its masters (FrameProfile.crownMasters — the borderless
// FLOATING crown, which Card Conjurer draws after ERASING the strip where the
// master's title-bar ring sits, so no overlay can draw it) has a
// `<key>-legendary.png` beside every master it paints: the seven colours and
// the pair masters of each dress it declares. Built by the Card Conjurer
// importer (scripts/lib/cc-frames.mjs borderlessMasters): the plain master,
// CC's erased strip, the outline UNDER the crown, the crown at CC's bounds,
// all 1500-native — a pair's crown its two floating crowns lerped across the
// untilted 40→60 %W ramp measured on FDN's crowned pairs
// (PAIR_RAMPS.crownFloating). The published twins' own pixels are checked
// when a local copy at the manifest's sha256 is on disk (FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them).
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]>; notes: string[] }
>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");

const CROWNED = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).crownMasters === true);

/** Every master a template paints: the colours and its declared pair keys. */
function plainKeysOf(template: string): string[] {
  const dresses = getFrameProfile(template).twoColorMasters ?? [];
  return [
    ...FRAME_COLOR_KEYS,
    ...TWO_COLOR_MASTER_KEYS.filter((key) => (key.endsWith("-h") ? dresses.includes("hybrid") : dresses.includes("split"))),
  ];
}

describe("the crowned twin's key", () => {
  it("is the master's key with -legendary: the seven colours and the pair masters of both dresses, in FRAME_MASTER_KEYS", () => {
    expect(LEGENDARY_MASTER_SUFFIX).toBe("-legendary");
    expect([...LEGENDARY_MASTER_KEYS]).toEqual([...FRAME_COLOR_KEYS, ...TWO_COLOR_MASTER_KEYS].map((k) => `${k}-legendary`));
    expect(LEGENDARY_MASTER_KEYS).toHaveLength(27);
    for (const key of LEGENDARY_MASTER_KEYS) expect(FRAME_MASTER_KEYS as readonly string[]).toContain(key);
    expect(legendaryMasterKey("w")).toBe("w-legendary");
    expect(legendaryMasterKey("wu-h")).toBe("wu-h-legendary");
    expect(legendaryMasterKey("w-legendary")).toBe("w-legendary");
    expect(baseMasterKey("w-legendary")).toBe("w");
    expect(baseMasterKey("wu-h-legendary")).toBe("wu-h");
    expect(baseMasterKey("wu")).toBe("wu");
    expect(isLegendaryMasterKey("c-legendary")).toBe(true);
    expect(isLegendaryMasterKey("c")).toBe(false);
    // The importer's own list is the registry's.
    expect(IMPORTER_SUFFIX).toBe(LEGENDARY_MASTER_SUFFIX);
    expect(IMPORTER_LEGENDARY_KEYS).toEqual([...LEGENDARY_MASTER_KEYS]);
    for (const key of LEGENDARY_MASTER_KEYS) expect(MASTER_KEYS).toContain(key);
    expect(legendaryKey("wu")).toBe("wu-legendary");
  });

  it("is declared on exactly the two borderless frames, which draw no crown band", () => {
    expect(CROWNED).toEqual(["m15borderless", "m15borderlessartifact"]);
    for (const t of CROWNED) expect(getFrameProfile(t).overlays).toBeUndefined();
    // The land dress spreads M15BORDERLESS and must not inherit it (its
    // pairs and crown are 4.56's).
    expect(getFrameProfile("m15borderlessland").crownMasters).toBeUndefined();
  });
});

describe("what is keyed by the master a card paints reads the plain key", () => {
  // Neither crowned profile declares an ink map or underFrameArt today (their
  // art slot is the whole card), so the rule (lib/cards/master-key.ts
  // baseMasterKey) is held on slots and a profile that have them: a crowned
  // twin must never fall back to the slot's default ink, or lose the art
  // under a see-through frame.
  const ink = { c: { colorHex: "#0a0a0a", shadowCss: "0 1px 0 #ffffff" } };

  it("a crowned twin prints its master's ink: a stat slot, the footer, the title and type bands", () => {
    const stat = { colorHex: "#ffffff", shadowCss: "0 0 2px #000000", inkByColorKey: ink };
    expect(slotInk(stat, "c")).toEqual({ colorHex: "#0a0a0a", shadowCss: "0 1px 0 #ffffff" });
    expect(slotInk(stat, "c-legendary")).toEqual(slotInk(stat, "c"));
    // A master the map doesn't name keeps the slot's own ink, crowned or not.
    expect(slotInk(stat, "w-legendary")).toEqual({ colorHex: "#ffffff", shadowCss: "0 0 2px #000000" });
    expect(slotInk(stat, "wu-h-legendary")).toEqual(slotInk(stat, "wu-h"));

    const band = { ...getFrameProfile("m15").title, inkByColorKey: ink };
    expect(bandTextStyle(band, "c")).toEqual({ color: "#0a0a0a", textShadow: "0 1px 0 #ffffff" });
    expect(bandTextStyle(band, "c-legendary")).toEqual(bandTextStyle(band, "c"));
    expect(bandTextStyle(band, "w-legendary")).toEqual({});

    const footer = { ...getFrameProfile("m15").footer!, inkByColorKey: ink };
    expect(footerInk(footer, "c").colorHex).toBe("#0a0a0a");
    expect(footerInk(footer, "c-legendary")).toEqual(footerInk(footer, "c"));
    expect(footerInk(footer, "w-legendary")).toEqual(footerInk(footer, "w"));
  });

  it("a crowned twin of a see-through master keeps the art under the frame", () => {
    // m15's colourless master is the see-through one (underFrameArt.colors).
    const m15 = getFrameProfile("m15");
    expect(m15.underFrameArt?.colors).toEqual(["c"]);
    expect(underFrameArtRect(m15, "c")).not.toBeNull();
    expect(underFrameArtRect(m15, "c-legendary")).toEqual(underFrameArtRect(m15, "c"));
    expect(underFrameArtRect(m15, "w-legendary")).toBeNull();
    expect(artLayersFor(m15, "c-legendary", true)).toEqual(artLayersFor(m15, "c", true));
    expect(artLayersFor(m15, "c-legendary", true).under).not.toBeNull();
  });
});

describe("the recipe — CC's autoBorderlessFrame, in its draw order", () => {
  const crowns = "img/frames/m15/crowns";

  it("erases CC's strip, draws the outline, then the floating crown, all at CC's bounds", () => {
    expect(BORDERLESS_CROWN.crown).toEqual({ leftPct: 3.07, topPct: 1.91, widthPct: 93.87, heightPct: 10.24 });
    expect(BORDERLESS_CROWN.outline).toEqual({ leftPct: 2.8, topPct: 1.72, widthPct: 94.4, heightPct: 10.62 });
    expect(BORDERLESS_CROWN.erase).toEqual({ leftPct: 3.94, topPct: 2.77, widthPct: 92.14, heightPct: 1.77 });
    expect(borderlessCrownLayers("w")).toEqual([
      { src: "img/black.png", at: BORDERLESS_CROWN.erase, erase: true },
      { src: `${crowns}/m15CrownFloatingOutline.png`, at: BORDERLESS_CROWN.outline },
      { src: `${crowns}/m15CrownWFloating.png`, at: BORDERLESS_CROWN.crown },
    ]);
    expect(borderlessCrownLayers("a")[2].src).toBe(`${crowns}/m15CrownAFloating.png`);
    expect(borderlessCrownLayers("c")[2].src).toBe(`${crowns}/m15CrownCFloating.png`);
    // A pair's crown: the first colour's crown lerped into the second's
    // across the floating crown's own ramp — 40→60, the pinline's, not the
    // standard band's 45→55 (FDN's seven crowned borderless pairs).
    expect(PAIR_RAMPS.crownFloating).toEqual([40, 60]);
    expect(PAIR_RAMPS.crown).toEqual([45, 55]);
    expect(borderlessCrownLayers(["u", "r"])[2]).toEqual({
      src: `${crowns}/m15CrownUFloating.png`,
      right: `${crowns}/m15CrownRFloating.png`,
      ramp: [40, 60],
      at: BORDERLESS_CROWN.crown,
    });
    expect(describeLayer(borderlessCrownLayers("w")[0])).toBe(
      "img/black.png at 3.94/2.77/92.14×1.77 % erased from the layers below (CC's erase: destination-out)",
    );
    expect(describeLayer(borderlessCrownLayers(["u", "r"])[2])).toBe(
      `(${crowns}/m15CrownUFloating.png | ${crowns}/m15CrownRFloating.png across procedural:ramp(40→60 %W)) at 3.07/1.91/93.87×10.24 %`,
    );
  });

  it("the pair masters: the gold M frame (split) or CC's grey Land frame (hybrid), the pinline lerped through the pack's Pinline mask — the split dress first REPLACING CC's Rules and Type regions, where the gold ring sits one row higher", () => {
    const frame = (k: string) => `img/frames/m15/borderless/m15GenericShowcaseFrame${k}.png`;
    const lerp = { src: frame("W"), right: frame("U"), ramp: [40, 60] };
    const pinline = { ...lerp, mask: "img/frames/m15/genericShowcase/m15GenericShowcaseMaskPinline.png" };
    // The regular M15 masks CC's own stack lists for its Rules and Type
    // layers, `replace`d (a premultiplied lerp INTO the layer where the mask
    // covers): source-over would double the translucent box.
    const rules = { ...lerp, mask: "img/frames/m15/regular/m15MaskRules.png", replace: true };
    const type = { ...lerp, mask: "img/frames/m15/regular/m15MaskType.png", replace: true };
    expect(borderlessPairLayers("wu")).toEqual([{ src: frame("M") }, rules, type, pinline]);
    // The L frame's rings sit on the colour frames' rows: nothing to replace.
    expect(borderlessPairLayers("wu", "hybrid")).toEqual([{ src: frame("L") }, pinline]);
    expect(PAIR_RAMPS.pinline).toEqual([40, 60]);
    expect(describeLayer(rules)).toBe(
      `(${frame("W")} | ${frame("U")} across procedural:ramp(40→60 %W)) replacing through img/frames/m15/regular/m15MaskRules.png`,
    );
    expect(describeLayer(pinline)).toBe(
      `(${frame("W")} | ${frame("U")} across procedural:ramp(40→60 %W)) through img/frames/m15/genericShowcase/m15GenericShowcaseMaskPinline.png`,
    );
  });

  it("every borderless template builds the twin of every master it paints — the artifact dress's colourless on CC's A frame with the A crown", () => {
    const templates = CC_TEMPLATES as Record<string, { colors: Record<string, Array<{ src: string }>> }>;
    for (const t of CROWNED) {
      const plain = plainKeysOf(t);
      expect(Object.keys(templates[t].colors).sort()).toEqual([...plain, ...plain.map(legendaryKey)].sort());
      for (const key of plain) {
        const twin = templates[t].colors[legendaryKey(key)];
        // The plain master's layers first, then the three crown layers.
        expect(twin.slice(0, -3)).toEqual(templates[t].colors[key]);
        expect(twin.slice(-3).map((l) => l.src)).toEqual(borderlessCrownLayers("w").map((l) => l.src).map((s, i) => (i === 2 ? twin.at(-1)!.src : s)));
      }
    }
    const art = templates.m15borderlessartifact.colors;
    expect(art["c-legendary"][0].src).toMatch(/FrameA\.png$/);
    expect(art["c-legendary"].at(-1)!.src).toMatch(/m15CrownAFloating\.png$/);
    expect(templates.m15borderless.colors["c-legendary"][0].src).toMatch(/FrameC\.png$/);
    expect(templates.m15borderless.colors["c-legendary"].at(-1)!.src).toMatch(/m15CrownCFloating\.png$/);
    // Never the unlisted (Alt) artifact crown.
    for (const t of CROWNED) {
      for (const layers of Object.values(templates[t].colors)) for (const l of layers) expect(l.src).not.toMatch(/FloatingAlt/);
    }
    // The coloured and pair twins are the same recipe on both dresses.
    for (const key of ["w", "m", "wu", "w-legendary", "wu-legendary"]) {
      expect(art[key]).toEqual(templates.m15borderless.colors[key]);
    }
  });

  it("provenance records each twin's recipe and the notes", () => {
    const templates = CC_TEMPLATES as Record<string, { colors: Record<string, unknown[]> }>;
    for (const t of CROWNED) {
      for (const key of plainKeysOf(t)) {
        const twin = legendaryKey(key);
        expect(provenance[t].colors[twin], `${t}/${twin}`).toEqual((templates[t].colors[twin] as never[]).map(describeLayer));
      }
      expect(provenance[t].notes.join(" ")).toMatch(/legendary crown \(TODO 4\.6f, wave 2a\)/);
      expect(provenance[t].notes.join(" ")).toMatch(/pair masters \(TODO 4\.6f, wave 2a\)/);
    }
  });
});

describe("the crowned twins' edges", () => {
  it("are the plain masters' but for the floating crown's peak, which reaches into the top band at 46–54 %W as the prints' does", () => {
    for (const t of CROWNED) {
      expect(edgeContractFor(t, "w")).toBe(EDGE_CONTRACTS[t]);
      expect(edgeContractFor(t, "w-legendary")).toBe(CROWNED_EDGE_CONTRACTS[t]);
      expect(CROWNED_EDGE_CONTRACTS[t]).toEqual({ ...EDGE_CONTRACTS[t], top: { kind: "art", except: [[45, 55]] } });
    }
    expect(Object.keys(CROWNED_EDGE_CONTRACTS).sort()).toEqual([...CROWNED].sort());
    // A template without crowned twins never reads the table.
    expect(edgeContractFor("m15", "w-legendary")).toBe(EDGE_CONTRACTS.m15);
  });
});

describe("published to the frames bucket", () => {
  it("lists every twin, PNG and WebP, full size — and no twin a template doesn't declare", () => {
    for (const t of CROWNED) {
      for (const key of plainKeysOf(t)) {
        for (const ext of ["png", "webp"]) {
          const entry = files[`${t}/${legendaryKey(key)}.${ext}`];
          expect(entry, `${t}/${legendaryKey(key)}.${ext}`).toBeDefined();
          expect([entry.width, entry.height]).toEqual([1500, 2100]);
        }
      }
    }
    for (const key of Object.keys(files)) {
      const [template, name] = key.split("/");
      if (!name || key.split("/").length !== 2 || !isLegendaryMasterKey(name.replace(/\.(png|webp)$/, ""))) continue;
      expect(CROWNED as readonly string[], key).toContain(template);
      expect(plainKeysOf(template).map(legendaryKey), key).toContain(name.replace(/\.(png|webp)$/, ""));
    }
  });
});

// --- the pixels of the built twins (when the build is here at the sha) ----

async function raw(rel: string) {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  if (createHash("sha256").update(bytes).digest("hex") !== files[rel].sha256) return null;
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

type Raw = NonNullable<Awaited<ReturnType<typeof raw>>>;

function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
      rows.add(Math.floor(i / 4 / a.width));
    }
  }
  return [...rows].sort((x, y) => x - y);
}

const px = (img: Raw, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

const PAIRS_CHECKED = ["wu", "ur", "bg"] as const;
const available = await (async () => {
  for (const t of CROWNED) {
    for (const key of ["w", "c", "m", "w-legendary", "c-legendary", "m-legendary", ...PAIRS_CHECKED.flatMap((p) => [p, `${p}-legendary`])]) {
      if (!(await raw(`${t}/${key}.png`))) return false;
    }
  }
  return (await raw("m15borderless/wu-h.png")) !== null && (await raw("m15borderless/wu-h-legendary.png")) !== null;
})();

describe.skipIf(!available)("the built twins (set FRAMES_BUILD_DIR if skipped)", () => {
  // The outline's rows at HD: 36.12 → 36 to 36.12 + 223.02 → 259; the crown
  // 40–254; the erased strip 58–94. Nothing below row 259 may differ.
  const OUTLINE_ROWS = [36, 259] as const;

  it.each(CROWNED)("%s: a twin differs from its master only inside the outline's rows; the crown peaks at row 40 on the art", async (t) => {
    for (const key of ["w", "c", "m"]) {
      const plain = (await raw(`${t}/${key}.png`))!;
      const twin = (await raw(`${t}/${key}-legendary.png`))!;
      const rows = differingRows(plain, twin);
      expect(rows.length, `${t}/${key}`).toBeGreaterThan(150);
      expect(rows[0], `${t}/${key} first`).toBeGreaterThanOrEqual(OUTLINE_ROWS[0]);
      expect(rows.at(-1), `${t}/${key} last`).toBeLessThanOrEqual(OUTLINE_ROWS[1]);
      // The top band stays art (α 0) above the crown; the first opaque row
      // at the centre column is the OUTLINE's peak, CC's 0.0172 × 2100 =
      // 36.12 (the crown's own edge follows at 40.11, CC's 0.0191).
      let peak = -1;
      for (let y = 0; y < 60 && peak < 0; y += 1) if (px(twin, 750, y)[3] >= 250) peak = y;
      expect(Math.abs(peak - 36), `${t}/${key} peak ${peak}`).toBeLessThanOrEqual(1);
      for (let y = 0; y < 36; y += 1) expect(px(twin, 750, y)[3], `${t}/${key} row ${y}`).toBe(0);
      // …and by row 44 the crown's own colour, not the outline's dark line.
      const outline = px(twin, 750, 37);
      const crown = px(twin, 750, 44);
      expect(crown[3]).toBe(255);
      expect(crown[0] + crown[1] + crown[2]).toBeGreaterThan(outline[0] + outline[1] + outline[2] + 60);
      // Where the plain master's title-bar ring sat in the erased strip
      // (row 92, α 255, the frame's own pinline colour: white on `w`, gold
      // on `m`), the twin shows the crown instead.
      expect(px(plain, 750, 92)[3]).toBe(255);
      expect(px(twin, 750, 92)[3]).toBe(255);
      expect(px(twin, 750, 92).slice(0, 3)).not.toEqual(px(plain, 750, 92).slice(0, 3));
    }
  });

  it("the artifact dress's colourless twin is the artifact frame under the (silver) artifact crown, not the colourless one", async () => {
    const art = (await raw("m15borderlessartifact/c-legendary.png"))!;
    const plain = (await raw("m15borderless/c-legendary.png"))!;
    // Both crown the same geometry: the crown's rows differ in colour only.
    expect(px(art, 750, 48)[3]).toBe(255);
    expect(px(plain, 750, 48)[3]).toBe(255);
    expect(px(art, 750, 48).slice(0, 3)).not.toEqual(px(plain, 750, 48).slice(0, 3));
  });

  it.each(PAIRS_CHECKED)("%s: the pair twin's crown is the first colour's left of 40 %W, the second's right of 60 %W, a blend between", async (pair) => {
    const [a, b] = pair.split("");
    const twin = (await raw(`m15borderless/${pair}-legendary.png`))!;
    const left = (await raw(`m15borderless/${a}-legendary.png`))!;
    const right = (await raw(`m15borderless/${b}-legendary.png`))!;
    // Row 48: the crown's band above the title bar, opaque across.
    for (const x of [300, 450, 570]) expect(px(twin, x, 48), `${pair} x ${x}`).toEqual(px(left, x, 48));
    for (const x of [930, 1050, 1200]) expect(px(twin, x, 48), `${pair} x ${x}`).toEqual(px(right, x, 48));
    const mid = px(twin, 750, 48);
    const l = px(left, 750, 48);
    const r = px(right, 750, 48);
    // Halfway: within the two crowns' colours, and not either of them.
    for (let c = 0; c < 3; c += 1) {
      expect(mid[c]).toBeGreaterThanOrEqual(Math.min(l[c], r[c]) - 1);
      expect(mid[c]).toBeLessThanOrEqual(Math.max(l[c], r[c]) + 1);
    }
    expect(mid.slice(0, 3)).not.toEqual(l.slice(0, 3));
    expect(mid.slice(0, 3)).not.toEqual(r.slice(0, 3));
    // The pair master under it is the pair master (the twin minus the crown).
    const plainPair = (await raw(`m15borderless/${pair}.png`))!;
    const rows = differingRows(plainPair, twin);
    expect(rows[0]).toBeGreaterThanOrEqual(OUTLINE_ROWS[0]);
    expect(rows.at(-1)).toBeLessThanOrEqual(OUTLINE_ROWS[1]);
  });

  it("a pair master is the gold frame with the pinline split: it differs from m only at the title ring and from the type bar to the box's foot; the hybrid from the L-barred one", async () => {
    const m = (await raw("m15borderless/m.png"))!;
    const wu = (await raw("m15borderless/wu.png"))!;
    const rows = differingRows(m, wu);
    // CC's Pinline mask covers rows 85–236 (the title ring) and 1166–1947
    // (the type ring and the text box's) at 1500 × 2100; the replaced Type
    // and Rules regions (rows 1181–1936) sit inside the second span.
    expect(rows.length).toBeGreaterThan(100);
    for (const y of rows) expect((y >= 85 && y <= 236) || (y >= 1166 && y <= 1947), `row ${y}`).toBe(true);
    // The hybrid dress: grey bars (CC's L frame), the same split pinline —
    // its title bar differs from the gold one's.
    const wuh = (await raw("m15borderless/wu-h.png"))!;
    expect(px(wuh, 750, 160).slice(0, 3)).not.toEqual(px(wu, 750, 160).slice(0, 3));
    expect(px(wuh, 300, 100)).toEqual(px(wu, 300, 100)); // the white left pinline on both
  });

  it.each(PAIRS_CHECKED)("%s: no gold hairline above the text box's top and bottom pinline — the rows the gold ring draws one higher are the colour frames' (skeptic 2026-10-02)", async (pair) => {
    const [a, b] = pair.split("");
    const m = (await raw("m15borderless/m.png"))!;
    const gold = px(m, 750, 1302).slice(0, 3); // CC's M ring, 246,210,98
    expect(gold).toEqual([246, 210, 98]);
    for (const key of [pair, `${pair}-legendary`]) {
      const master = (await raw(`m15borderless/${key}.png`))!;
      const left = (await raw(`m15borderless/${a}.png`))!;
      const right = (await raw(`m15borderless/${b}.png`))!;
      for (const x of [300, 750, 1200]) {
        // Row 1302: the type region's last row — black on every colour frame
        // (the Type mask's anti-aliased edge keeps ≤ 5 % of the gold).
        const top = px(master, x, 1302);
        expect(top[3], `${key} x ${x} row 1302 α`).toBe(255);
        expect(Math.max(top[0], top[1], top[2]), `${key} x ${x} row 1302 ${top}`).toBeLessThanOrEqual(16);
        // Row 1936: the box's bottom rim — the colour frames' own pixel.
        expect(px(master, x, 1936), `${key} x ${x} row 1936`).toEqual(px(x < 750 ? left : right, x, 1936));
        expect(px(master, x, 1936).slice(0, 3)).not.toEqual(gold);
        // Row 1935 above it was the gold frame's rim row: now the colours'.
        expect(px(master, x, 1935), `${key} x ${x} row 1935`).toEqual(px(x < 750 ? left : right, x, 1935));
      }
      // The split pinline under both rows stays: the first colour left of
      // the ramp, the second right of it.
      for (const y of [1303, 1937]) {
        expect(px(master, 300, y), `${key} row ${y} left`).toEqual(px(left, 300, y));
        expect(px(master, 1200, y), `${key} row ${y} right`).toEqual(px(right, 1200, y));
      }
    }
    // The hybrid dress never had the line: its L frame's rings sit on the
    // colour frames' rows, so its row 1302 is plain black.
    const hybrid = (await raw(`m15borderless/${pair}-h.png`))!;
    expect(px(hybrid, 750, 1302)).toEqual([0, 0, 0, 255]);
    // Both dresses share the split masters' bytes.
    const art = await raw(`m15borderlessartifact/${pair}.png`);
    expect(art?.data.equals((await raw(`m15borderless/${pair}.png`))!.data)).toBe(true);
  });
});
