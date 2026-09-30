// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { FrameThumb } from "@/components/creator/frame-pickers";
import { FINISHES, PAIR_CASES, pairCaseCard } from "../render/two-colour-cases";

// ---------------------------------------------------------------------------
// TODO 4.6b — the two-colour look in the LIVE PREVIEW on the REAL profiles,
// held to the SAME parity table as the bake (tests/unit/render/
// two-colour-cases.ts; the bake's twin: tests/unit/render/
// two-colour-bake.test.tsx): each case × regular / foil / etched paints the
// case's frame master, masks the finish with it, and paints the case's plate.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

/** "/frames/m15/wu.png" → the stem every URL for it carries ("m15/wu."). */
const stem = (path: string) => `${path.replace(/^\/frames\//, "").replace(/\.png$/, "")}.`;

describe("the preview paints the pair master and plate the bake paints", () => {
  for (const c of PAIR_CASES) {
    it.each(FINISHES)(`${c.id} — %s`, (finish) => {
      const card = pairCaseCard(c, finish);
      const { container } = render(<CardPreview {...card} brandMark={false} />);
      const frame = container.querySelector<HTMLElement>("[data-frame-key]")!;
      expect(frame.getAttribute("data-frame-key")).toBe(c.master.split("/")[1]);
      expect(frame.style.backgroundImage).toContain(stem(`/frames/${c.master}.png`));
      if (finish !== "regular") {
        // The finish is masked by exactly the frame the face painted.
        const hrefs = [...container.querySelector("mask")!.querySelectorAll("image")].map((i) => i.getAttribute("href") ?? "");
        expect(hrefs[0]).toContain(stem(`/frames/${c.master}.png`));
      }
      const images = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
      const plates = images.filter((src) => /\/pt\/[a-z]\./.test(src));
      if (c.plate) {
        expect(plates.length).toBeGreaterThan(0);
        for (const src of plates) expect(src).toContain(stem(c.plate));
      } else {
        expect(plates).toEqual([]);
      }
    });
  }
});

describe("the creator's frame tile shows the pair the card paints (FrameThumb)", () => {
  const keyOf = (el: HTMLElement) => el.querySelector("[data-frame-key]")?.getAttribute("data-frame-key") ?? el.firstElementChild?.getAttribute("data-frame-key");

  it("the card's own colours with the two-colour frame on: its pair master, by the cost's dress", () => {
    const tile = (props: Parameters<typeof FrameThumb>[0]) => {
      const { container } = render(<FrameThumb {...props} />);
      const key = keyOf(container);
      cleanup();
      return key;
    };
    const wu = ["white", "blue"] as const;
    expect(tile({ template: "m15", colorKey: "m", colorIdentity: [...wu], type: { cardType: "creature", cost: "{1}{W}{U}" }, anatomy: { twoColor: true } })).toBe("wu");
    expect(tile({ template: "m15", colorKey: "m", colorIdentity: [...wu], type: { cardType: "creature", cost: "{W/U}{W/U}" }, anatomy: { twoColor: true } })).toBe("wu-h");
    expect(tile({ template: "m15land", colorKey: "m", colorIdentity: [...wu], type: { cardType: "land", cost: null }, anatomy: { twoColor: true } })).toBe("wu");
    // Off, absent, or a frame without pair masters: the gold tile, as before.
    expect(tile({ template: "m15", colorKey: "m", colorIdentity: [...wu], type: { cardType: "creature", cost: "{1}{W}{U}" }, anatomy: { twoColor: false } })).toBe("m");
    expect(tile({ template: "m15", colorKey: "m", colorIdentity: [...wu], type: { cardType: "creature", cost: "{1}{W}{U}" } })).toBe("m");
    expect(tile({ template: "m15snow", colorKey: "m", colorIdentity: [...wu], type: { cardType: "creature", cost: "{1}{W}{U}" }, anatomy: { twoColor: true } })).toBe("m");
    // Another colour's tile (the colour chips) is that colour, never the pair.
    expect(tile({ template: "m15", colorKey: "u", colorIdentity: [...wu], type: { cardType: "creature", cost: "{1}{W}{U}" }, anatomy: { twoColor: true } })).toBe("u");
  });
});
