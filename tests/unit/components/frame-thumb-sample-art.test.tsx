// @vitest-environment happy-dom
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { frameBackgroundImage, frameMasterKeyForColor } from "@/components/cards/frame-layer";
import { FRAME_THUMB_SAMPLE_ART, FrameThumb } from "@/components/creator/frame-pickers";
import { artFillsCard, artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";
import { isDefaultProfileMedia } from "@/lib/profile/default-media";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.45: the creator's frame tiles for the art-first frames (borderless,
// full-art basics) draw a sample art in the profile's art slot under the
// master — their masters are see-through where the art goes, so the bare
// master read as a black tile. Every other tile is drawn exactly as before,
// and no card surface ever draws the sample.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const ART_FIRST: FrameTemplate[] = ["m15borderless", "m15borderlessartifact", "m15fullartland", "fullartland"];
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
type TileType = { cardType?: string | null } | null;
const TYPES: TileType[] = [null, { cardType: "artifact" }];

function tile(template: FrameTemplate, colorKey: string, type: TileType) {
  return render(<FrameThumb template={template} colorKey={colorKey} type={type} />).container
    .firstElementChild as HTMLElement;
}

describe("artFillsCard — which frames are art-first", () => {
  it("is the borderless M15 skins and both full-art basics, nothing else", () => {
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

describe("FrameThumb — art-first tiles draw a sample art under the master", () => {
  it.each(ART_FIRST)("%s: sample art in the art slot, the frame on a layer above it", (template) => {
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

  it("every other tile is drawn as before: the frame is the tile's own background, no sample", () => {
    for (const template of FRAME_TEMPLATE_VALUES.filter((t) => !ART_FIRST.includes(t))) {
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

  it("is a picker-tile thing only: the card preview of an art-first frame never draws it", () => {
    for (const template of ART_FIRST) {
      const html = render(
        <CardPreview title="No Art Yet" cardType="land" colorIdentity={["green"]} frameStyle={{ template }} />,
      ).container.innerHTML;
      expect(html).toContain(`/frames/${template}/`);
      expect(html).not.toContain(FRAME_THUMB_SAMPLE_ART);
      cleanup();
    }
  });
});
