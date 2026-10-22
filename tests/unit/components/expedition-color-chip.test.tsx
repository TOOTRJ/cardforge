// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ColorSection } from "@/components/creator/panels/color-section";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { chipOff } from "../helpers/chip";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 1 (owner 2026-10-22): a two-colour Expedition stays gold in
// its data while its FRAME paints the plain land master `c`
// (frame_style.plainLandMaster). The Card step's colour chips follow the
// master the card draws: the card's own Multicolor chip is gated in — and
// its tile shows — `c` on the two Expedition frames, as the save's gate and
// both renderers are. Before (the skeptic check of #602): with `m` unticked
// the card's own chip read "Soon", disabled, and its tile was gold.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function chips(template: FrameTemplate, verified: string[], plainLandMaster?: true) {
  const { container } = render(
    <ColorSection
      summary="Multicolor"
      template={template}
      selection={["multicolor"] as ColorIdentity[]}
      onChange={() => {}}
      verifiedKeys={new Set(verified)}
      frameType={{ cardType: "land" }}
      plainLandMaster={plainLandMaster}
    />,
  );
  const byLabel = (label: string) =>
    [...container.querySelectorAll('[role="radio"]')].find((chip) => chip.textContent?.toLowerCase().includes(label))!;
  const status = container.querySelector('[role="status"]');
  return { byLabel, status };
}

describe("the colour chips of a two-colour Expedition (TODO 4.11)", () => {
  for (const template of ["expeditionland", "expeditionlandbfz"] as const) {
    it(`${template}: the Multicolor chip is gated in, and paints, the plain land master c`, () => {
      const onlyC = [frameComboKey(template, "c")];
      const { byLabel, status } = chips(template, onlyC, true);
      const multi = byLabel("multicolor");
      expect(chipOff(multi)).toBe(false);
      expect(multi.textContent).not.toMatch(/soon/i);
      expect(multi.querySelector("[data-frame-key]")?.getAttribute("data-frame-key")).toBe("c");
      // The card's colour is verified there: no "isn't verified" note.
      expect(status).toBeNull();
      // Colorless is the plain land too, so it is reachable as well.
      expect(chipOff(byLabel("colorless"))).toBe(false);
    });

    it(`${template}: with only gold ticked, the Multicolor chip of a plain-land card is off`, () => {
      const onlyM = [frameComboKey(template, "m")];
      const { byLabel, status } = chips(template, onlyM, true);
      expect(chipOff(byLabel("multicolor"))).toBe(true);
      expect(status).not.toBeNull();
    });

    it(`${template}: without the stand-in (an any-colour land, printed gold) the chip is the gold master`, () => {
      const onlyM = [frameComboKey(template, "m")];
      const { byLabel, status } = chips(template, onlyM);
      const multi = byLabel("multicolor");
      expect(chipOff(multi)).toBe(false);
      expect(multi.querySelector("[data-frame-key]")?.getAttribute("data-frame-key")).toBe("m");
      expect(status).toBeNull();
    });
  }

  it("a frame without the stand-in ignores the key: m15land's Multicolor chip is gold", () => {
    const { byLabel } = chips("m15land", [frameComboKey("m15land", "m")], true);
    const multi = byLabel("multicolor");
    expect(chipOff(multi)).toBe(false);
    expect(multi.querySelector("[data-frame-key]")?.getAttribute("data-frame-key")).toBe("m");
  });
});
