// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";

// TODO 5.14 (quick fix 3): the editor preview's turn hint said "Click to see
// the back" on a phone too. The verb now follows the device — "Click" where
// the pointer can hover, "Tap" where it cannot — by CSS alone (both words
// are in the page; a media query shows one).

afterEach(() => cleanup());

function renderPreview(face: "front" | "back") {
  return render(
    <CardPreview
      title="Delver of Secrets"
      cardType="creature"
      colorIdentity={["blue"]}
      frameStyle={{ template: "m15" }}
      backFace={{ title: "Insectile Aberration", card_type: "creature" }}
      flipOnClick
      face={face}
      staticInEditor
    />,
  );
}

describe("the editor preview's turn hint", () => {
  it.each([
    ["front", "to see the back"],
    ["back", "to see the front"],
  ] as const)("showing the %s: Click / Tap %s", (face, rest) => {
    const { container } = renderPreview(face);
    const click = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === "Click");
    const tap = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === "Tap");
    expect(click, "the mouse wording").toBeTruthy();
    expect(tap, "the touch wording").toBeTruthy();
    // One of the two shows: "Click" hides where nothing can hover, "Tap"
    // shows only there.
    expect(click!.className).toContain("[@media(hover:none)]:hidden");
    expect(tap!.className).toContain("hidden");
    expect(tap!.className).toContain("[@media(hover:none)]:inline");
    expect(click!.parentElement!.textContent).toBe(`ClickTap ${rest}`);
  });
});
