// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { SetIconPanel } from "@/components/creator/panels/set-icon-panel";

// ---------------------------------------------------------------------------
// The Set icon step for an emblem (TODO 6.23): an emblem has no rarity (CR
// 114) — the "common" it stores only inks its symbol — so the step's symbol
// preview names none to a screen reader ("Set symbol", as the card preview's
// does), and a token or an emblem, whose rarity chips are hidden, isn't sent
// to "switch rarity on the Text & stats step". Any other card keeps both.
// ---------------------------------------------------------------------------

function Harness({ cardType, template, rarity }: { cardType: string; template: string; rarity: string }) {
  const methods = useForm({
    defaultValues: {
      card_type: cardType,
      rarity,
      frame_style: { template },
      set_icon_url: "",
      set_icon_code: "fdn",
    },
  });
  return (
    // The panel reads FormValues; the harness only carries what it touches.
    <FormProvider {...methods}>
      <SetIconPanel userId={null} />
    </FormProvider>
  );
}

afterEach(cleanup);

const glyph = (container: HTMLElement) => container.querySelector("i.ss-fdn:not(.ss-grad)");
const SWITCH_HINT = /try switching rarity on the Text & stats step/;

describe("SetIconPanel — the symbol's label and hint follow the card's rarity", () => {
  it("an emblem: 'Set symbol', and no hint to switch a rarity it hasn't got", () => {
    const { container } = render(<Harness cardType="emblem" template="emblem" rarity="common" />);
    expect(glyph(container)?.getAttribute("aria-label")).toBe("Set symbol");
    expect(container.textContent).not.toMatch(SWITCH_HINT);
    expect(container.textContent).toContain("The small symbol at the right end of the type line.");
  });

  it("a token: its rarity named, but no hint to the hidden rarity chips", () => {
    const { container } = render(<Harness cardType="token" template="m15token" rarity="common" />);
    expect(glyph(container)?.getAttribute("aria-label")).toBe("common rarity");
    expect(container.textContent).not.toMatch(SWITCH_HINT);
  });

  it("any other card: its rarity named, and the hint", () => {
    const { container } = render(<Harness cardType="creature" template="m15" rarity="rare" />);
    expect(glyph(container)?.getAttribute("aria-label")).toBe("rare rarity");
    expect(container.textContent).toMatch(SWITCH_HINT);
  });
});
