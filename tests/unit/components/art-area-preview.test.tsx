// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import type { CardType, ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Layout v35 (TODO 4.4 (2), 4.17a, 4.17b) in the live preview: the same art
// rects the bake paints (tests/unit/render/art-area-bake.test.ts) — the
// under-frame art from the black border's inner edge on every see-through
// master (m15pw's colourless one new, as ONE picture: its window drawn in
// that rect too, no second layer), the CC M15 profiles' window art in
// CC_M15_ART_SLOT, nyx's and fullart's art on down under their whole text
// box. Both renderers read one resolver (artLayersFor), so the rects are the
// parity.
// ---------------------------------------------------------------------------

afterEach(cleanup);

// Our storage (the legacy project host), a user folder: art the preview draws.
const ART = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-art/11111111-1111-4111-8111-111111111111/art.png";

function preview(template: FrameTemplate, colorIdentity: ColorIdentity[], cardType: CardType = "artifact") {
  return render(
    <CardPreview title="Probe" cardType={cardType} colorIdentity={colorIdentity} artUrl={ART} frameStyle={{ template, finish: "regular" }} />,
  ).container;
}

const pct = (el: HTMLElement | null) => el && [el.style.left, el.style.top, el.style.width, el.style.height];
const under = (root: HTMLElement) => pct(root.querySelector<HTMLElement>('[data-testid="under-frame-art"]'));
/** The art slot's box: the element holding the card's artwork image. */
const slot = (root: HTMLElement) => pct(root.querySelector<HTMLElement>('img[alt="Artwork for Probe"]')?.closest<HTMLElement>("div.absolute") ?? null);

describe("layout v35 — the preview paints the art where the bake does", () => {
  it("under-frame art from the border's inner edge on every see-through master; m15pw/c's as ONE picture", () => {
    for (const [template, colours, type] of [
      ["m15", ["colorless"], "artifact"],
      ["m15devoid", ["black"], "creature"],
      ["m15token", ["colorless"], "token"],
      ["m15tokentext", ["colorless"], "token"],
    ] as const) {
      expect(under(preview(template, [...colours], type)), template).toEqual(["3.7%", "2.7%", "92.6%", "93.3%"]);
      cleanup();
    }
    // The colourless walker: the window's art IS the under-frame picture —
    // no second, separately cropped layer to meet it in a seam.
    const walker = preview("m15pw", ["colorless"], "planeswalker");
    expect(under(walker)).toBeNull();
    expect(slot(walker)).toEqual(["3.7%", "2.7%", "92.6%", "93.3%"]);
    cleanup();
    // A coloured walker keeps M15PW's slot.
    expect(slot(preview("m15pw", ["blue"], "planeswalker"))).toEqual(["6.7%", "9.9%", "86.4%", "81.7%"]);
    cleanup();
    // Without art the empty-art box stays in the profile's slot.
    const empty = render(
      <CardPreview title="Probe" cardType="planeswalker" colorIdentity={["colorless"]} artUrl={null} frameStyle={{ template: "m15pw", finish: "regular" }} />,
    ).container;
    expect(under(empty)).toBeNull();
    expect(pct(empty.querySelector<HTMLElement>("span.font-display")?.closest<HTMLElement>("div.absolute") ?? null)).toEqual(["6.7%", "9.9%", "86.4%", "81.7%"]);
    cleanup();
    // Opaque masters draw no under-frame art.
    expect(under(preview("m15pw", ["blue"], "planeswalker"))).toBeNull();
    cleanup();
    expect(under(preview("m15", ["white"]))).toBeNull();
  });

  it("the window's art in CC_M15_ART_SLOT on the CC M15 profiles, M15's own slot on adventure; nyx and fullart to 93 %", () => {
    for (const template of ["m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid"] as const) {
      expect(slot(preview(template, ["green"])), template).toEqual(["7.67%", "11.25%", "84.76%", "44.33%"]);
      cleanup();
    }
    expect(slot(preview("adventure", ["green"], "creature"))).toEqual(["7.8%", "11.4%", "84.4%", "44%"]);
    cleanup();
    expect(slot(preview("nyx", ["white"], "creature"))).toEqual(["6%", "11.2%", "88%", "81.8%"]);
    cleanup();
    // fullart: to 93 % and out past the hedron ring's anti-aliased rim.
    expect(slot(preview("fullart", ["white"], "creature"))).toEqual(["3.8%", "2.7%", "92.4%", "90.3%"]);
  });
});
