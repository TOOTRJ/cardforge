// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { frameBackgroundImage, frameMasterKeyForColor } from "@/components/cards/frame-layer";
import { FRAME_THUMB_SAMPLE_ART, FrameThumb } from "@/components/creator/frame-pickers";
import { artFillsCard, artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { isDefaultProfileMedia } from "@/lib/profile/default-media";
import { FRAME_TEMPLATE_VALUES, type CardType, type ColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.45: the creator's frame tiles for the art-first frames (borderless,
// full-art basics) draw a sample art in the profile's art slot under the
// master — their masters are see-through where the art goes, so the bare
// master read as a black tile. The owner added six more near-black tiles on
// 2026-09-27 (Anime, Ghostfire, the ZNR hedron, both textless frames, Nyx):
// no rule picks exactly those, so they opt in by name
// (FrameProfile.pickerSampleArt). Every other tile is drawn exactly as
// before, and no card surface ever draws the sample.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const ART_FIRST: FrameTemplate[] = ["m15borderless", "m15borderlessartifact", "m15borderlessland", "m15fullartland", "fullartland"];
/** The owner's six (2026-09-27), in FRAME_TEMPLATE_VALUES order. */
const OPT_IN: FrameTemplate[] = ["bloomanime", "tarkirghostfire", "fullart", "m15textless", "m15textlessland", "nyx"];
/** Every tile that draws the sample — exactly these 11 of the 43 templates,
 *  in FRAME_TEMPLATE_VALUES order. Spelled out, not derived, so a flag that
 *  leaks through a profile spread (or a widened rule) fails here. */
const SAMPLED: FrameTemplate[] = [
  "m15borderless",
  "m15borderlessartifact",
  // 4.34's borderless land: art-first like the other borderless frames.
  "m15borderlessland",
  "bloomanime",
  "tarkirghostfire",
  "fullart",
  "m15fullartland",
  "fullartland",
  "m15textless",
  "m15textlessland",
  "nyx",
];
/** Tiles between the six on window size and brightness that stay as they
 *  were (owner decision 2026-09-27). */
const NEIGHBOURS_LEFT_OUT: FrameTemplate[] = ["m15pw", "m15token", "m15tokenartifact", "expeditionland"];
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
type TileType = { cardType?: string | null; supertype?: string | null } | null;
const TYPES: TileType[] = [null, { cardType: "artifact" }, { cardType: "land" }, { cardType: "creature", supertype: "Artifact" }];

function tile(template: FrameTemplate, colorKey: string, type: TileType) {
  return render(<FrameThumb template={template} colorKey={colorKey} type={type} />).container
    .firstElementChild as HTMLElement;
}

describe("artFillsCard — which frames are art-first", () => {
  it("is the borderless M15 skins, the borderless land and both full-art basics, nothing else", () => {
    expect(FRAME_TEMPLATE_VALUES.filter((t) => artFillsCard(getFrameProfile(t)))).toEqual(ART_FIRST);
  });

  it("takes m15fullartland's inset window through its basic-symbol slot, not its edges", () => {
    const p = getFrameProfile("m15fullartland");
    expect(artReachesCardEdge(p)).toBe(false);
    expect(artFillsCard(p)).toBe(true);
    // The same tall window without a basic's symbol slot (a showcase's)…
    expect(artFillsCard({ artSlot: p.artSlot })).toBe(false);
    // …and a basic's symbol slot on a framed window (an M15 land's) are not.
    expect(artFillsCard({ artSlot: getFrameProfile("m15land").artSlot, basicSymbol: p.basicSymbol })).toBe(false);
  });

  it("a basic's inset window qualifies at 85 % or more on BOTH axes", () => {
    const { basicSymbol } = getFrameProfile("m15fullartland");
    // Inset 5 % from the top-left, so no window here reaches a card edge.
    const win = (widthPct: number, heightPct: number) => ({ topPct: 5, leftPct: 5, widthPct, heightPct });
    expect(artFillsCard({ artSlot: win(85, 85), basicSymbol })).toBe(true);
    expect(artFillsCard({ artSlot: win(84.9, 90), basicSymbol })).toBe(false);
    expect(artFillsCard({ artSlot: win(90, 84.9), basicSymbol })).toBe(false);
  });
});

describe("pickerSampleArt — the owner's six near-black tiles opt in by name", () => {
  it("is set (to true) on exactly the six profiles, none of them art-first", () => {
    const flagged = FRAME_TEMPLATE_VALUES.filter((t) => "pickerSampleArt" in getFrameProfile(t));
    expect(flagged).toEqual(OPT_IN);
    for (const t of OPT_IN) {
      expect(getFrameProfile(t).pickerSampleArt, t).toBe(true);
      expect(artFillsCard(getFrameProfile(t)), t).toBe(false);
    }
  });

  it("leaves out the frames between them on window size and brightness", () => {
    for (const t of NEIGHBOURS_LEFT_OUT) {
      const p = getFrameProfile(t);
      expect(p.pickerSampleArt, t).toBeUndefined();
      expect(artFillsCard(p), t).toBe(false);
    }
  });
});

describe("FrameThumb — art-first and opted-in tiles draw a sample art under the master", () => {
  it("draws the sample on exactly 11 of the 43 templates, on every colour and type dress", () => {
    const drawn = new Set<FrameTemplate>();
    for (const template of FRAME_TEMPLATE_VALUES) {
      const counts = { with: 0, without: 0 };
      for (const key of KEYS) {
        for (const type of TYPES) {
          const el = tile(template, key, type);
          counts[el.querySelector("[data-frame-sample-art]") ? "with" : "without"]++;
          cleanup();
        }
      }
      // All or nothing per template.
      expect(counts.with === 0 || counts.without === 0, template).toBe(true);
      if (counts.with > 0) drawn.add(template);
    }
    expect(FRAME_TEMPLATE_VALUES).toHaveLength(43);
    expect(FRAME_TEMPLATE_VALUES.filter((t) => drawn.has(t))).toEqual(SAMPLED);
  });

  it.each(SAMPLED)("%s: sample art in the art slot, the frame on a layer above it", (template) => {
    const slot = getFrameProfile(template).artSlot;
    for (const key of KEYS) {
      for (const type of TYPES) {
        const el = tile(template, key, type);
        const masterKey = frameMasterKeyForColor(getFrameProfile(template), key, type);
        expect(el.dataset.frameKey).toBe(masterKey);
        // The tile's own background no longer carries the frame.
        expect(el.style.backgroundImage).toBe("");
        const [art, frame, ...rest] = [...el.children] as HTMLElement[];
        expect(rest).toHaveLength(0);
        expect(art.hasAttribute("data-frame-sample-art")).toBe(true);
        expect(art.style.backgroundImage).toContain(FRAME_THUMB_SAMPLE_ART);
        expect([art.style.top, art.style.left, art.style.width, art.style.height]).toEqual([
          `${slot.topPct}%`,
          `${slot.leftPct}%`,
          `${slot.widthPct}%`,
          `${slot.heightPct}%`,
        ]);
        // Later in the DOM = painted above the art, as long as neither layer
        // lifts itself with a z-index.
        for (const layer of [art, frame]) {
          expect(layer.style.zIndex).toBe("");
          expect(layer.className).not.toMatch(/(^|\s)-?z-/);
        }
        expect(frame.hasAttribute("data-frame-layer")).toBe(true);
        expect(frame.style.backgroundImage).toBe(frameBackgroundImage(template, masterKey));
        cleanup();
      }
    }
  });

  it("the six's windows are their own profiles' (not a full-card rect)", () => {
    const expected: Record<string, [number, number]> = {
      bloomanime: [93, 92],
      tarkirghostfire: [93, 92],
      // Layout v35 (4.17b): nyx's and fullart's art run under the whole text
      // box (fullart's out past its ring's rim too).
      fullart: [92.4, 90.3],
      m15textless: [84, 80.7],
      m15textlessland: [84, 80.7],
      nyx: [88, 81.8],
    };
    for (const t of OPT_IN) {
      const art = tile(t, "u", null).querySelector<HTMLElement>("[data-frame-sample-art]")!;
      expect([art.style.width, art.style.height], t).toEqual(expected[t].map((v) => `${v}%`));
      cleanup();
    }
  });

  it("every other tile is drawn as before: the frame is the tile's own background, no sample", () => {
    for (const template of FRAME_TEMPLATE_VALUES.filter((t) => !SAMPLED.includes(t))) {
      for (const key of KEYS) {
        for (const type of TYPES) {
          const el = tile(template, key, type);
          const masterKey = frameMasterKeyForColor(getFrameProfile(template), key, type);
          expect(el.querySelector("[data-frame-sample-art], [data-frame-layer]"), template).toBeNull();
          expect(el.children, template).toHaveLength(0);
          expect(el.dataset.frameKey).toBe(masterKey);
          expect(el.style.backgroundImage).toBe(frameBackgroundImage(template, masterKey));
          cleanup();
        }
      }
    }
  });

  it("the sample is one of the app's own built-in banners, served from public/", () => {
    expect(isDefaultProfileMedia(FRAME_THUMB_SAMPLE_ART, "banner")).toBe(true);
    expect(existsSync(path.join(process.cwd(), "public", FRAME_THUMB_SAMPLE_ART))).toBe(true);
  });
});

describe("a picker-tile thing only — no card surface draws the sample", () => {
  const CASES: Array<{ cardType: CardType; colorIdentity: ColorIdentity[] }> = [
    { cardType: "land", colorIdentity: ["green"] },
    { cardType: "creature", colorIdentity: ["blue"] },
    { cardType: "artifact", colorIdentity: [] },
    { cardType: "instant", colorIdentity: ["white", "black"] },
  ];

  it.each(SAMPLED)("%s: the card preview never draws it, with or without art", (template) => {
    for (const c of CASES) {
      for (const artUrl of [null, "https://example.test/art.webp"]) {
        const html = render(
          <CardPreview title="No Art Yet" {...c} artUrl={artUrl} frameStyle={{ template }} />,
        ).container.innerHTML;
        expect(html).toContain(`/frames/${template}/`);
        expect(html).not.toContain(FRAME_THUMB_SAMPLE_ART);
        expect(html).not.toContain("data-frame-sample-art");
        cleanup();
      }
    }
  });

  // The flag and the sample are read by the tile alone: nothing under lib/
  // (the bake, OG images, the finishes), components/ or app/ else mentions
  // them, so no card, preview or bake can start drawing it by accident.
  const ROOTS = ["lib", "components", "app"];
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(ts|tsx|mjs|js)$/.test(name) ? [p] : [];
    });
  }
  const ALL = ROOTS.flatMap((r) => sources(path.join(process.cwd(), r))).map((p) => ({
    rel: path.relative(process.cwd(), p),
    text: readFileSync(p, "utf8"),
  }));

  it("pickerSampleArt is declared and set in the profiles, and read only by FrameThumb", () => {
    expect(ALL.filter((f) => f.text.includes("pickerSampleArt")).map((f) => f.rel).sort()).toEqual([
      "components/creator/frame-pickers.tsx",
      "lib/cards/template-layout.ts",
    ]);
    const layout = ALL.find((f) => f.rel === "lib/cards/template-layout.ts")!.text;
    expect(layout.match(/pickerSampleArt: true/g)).toHaveLength(OPT_IN.length);
    expect(layout).not.toMatch(/(?<!FrameProfile)\.pickerSampleArt\b/);
    const pickers = ALL.find((f) => f.rel === "components/creator/frame-pickers.tsx")!.text;
    expect(pickers.match(/(?<!FrameProfile)\.pickerSampleArt\b/g)).toHaveLength(1);
  });

  it("the sample art path lives in the picker alone", () => {
    const file = path.basename(FRAME_THUMB_SAMPLE_ART);
    expect(ALL.filter((f) => f.text.includes(file)).map((f) => f.rel)).toEqual([
      "components/creator/frame-pickers.tsx",
    ]);
    expect(
      ALL.filter((f) => f.text.includes("FRAME_THUMB_SAMPLE_ART")).map((f) => f.rel),
    ).toEqual(["components/creator/frame-pickers.tsx"]);
  });
});
