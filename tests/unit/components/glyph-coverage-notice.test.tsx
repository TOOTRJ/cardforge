// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GlyphCoverageNotice, UndrawableSymbolNotice } from "@/components/creator/glyph-coverage-notice";
import type { GlyphCheckValues } from "@/lib/validation/card-glyphs";

// TODO 6.16a: the creator says which characters won't reach the card image
// (emoji, scripts outside the card fonts) — a notice, never a blocker.

afterEach(cleanup);

const VALUES: GlyphCheckValues = {
  title: "Ember Drake",
  supertype: "",
  subtypes_text: "Dragon",
  rules_text: "Flying",
  flavor_text: "",
  power: "4",
  toughness: "4",
  loyalty: "",
  defense: "",
  artist_credit: "Probe",
  footer_text: "",
  loyalty_abilities: [],
  saga_intro: "",
  saga_chapters: [],
  has_back_face: false,
  back_face: {
    title: "",
    supertype: "",
    subtypes_text: "",
    rules_text: "",
    flavor_text: "",
    power: "",
    toughness: "",
    loyalty: "",
    defense: "",
  },
};

describe("GlyphCoverageNotice", () => {
  it("renders nothing when the image can draw every character", () => {
    const { container } = render(<GlyphCoverageNotice values={VALUES} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the fields and characters the image can't draw", () => {
    render(
      <GlyphCoverageNotice
        values={{ ...VALUES, title: "Ember 🔥 Drake", flavor_text: "竜の炎​" }}
      />,
    );
    const notice = screen.getByTestId("glyph-coverage-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain("may not show on the card image");
    expect(notice.textContent).toContain("Name:");
    expect(notice.textContent).toContain("🔥");
    expect(notice.textContent).toContain("Flavor text:");
    expect(notice.textContent).toContain("竜");
    expect(notice.textContent).toContain("saved exactly as typed");
  });
});

// A `{…}` symbol the card has no pip for is left out of the preview and the
// image alike — the creator names it, on the cost and on the text fields.
describe("UndrawableSymbolNotice", () => {
  it("renders nothing when every symbol draws", () => {
    const { container } = render(
      <UndrawableSymbolNotice values={{ ...VALUES, cost: "{2}{W/U}{G/P}", rules_text: "{T}: Add {G}." }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names the symbols the card leaves out, field by field", () => {
    render(
      <UndrawableSymbolNotice
        values={{
          ...VALUES,
          cost: "{21}{W/U/P}{G}",
          rules_text: "{T}, Pay {C/P}: Draw a card.",
          flavor_text: "{1/2} in flavor text prints as typed.",
        }}
      />,
    );
    const notice = screen.getByTestId("undrawable-symbol-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain("Some symbols can't be drawn on the card");
    expect(notice.textContent).toContain("Mana cost: {21} and {W/U/P} can't be drawn and will be left off the card.");
    expect(notice.textContent).toContain("Rules text: {C/P} can't be drawn and will be left off the card.");
    expect(notice.textContent).not.toContain("{1/2}");
    expect(notice.textContent).not.toContain("{G}");
    expect(notice.textContent).toContain("saved exactly as typed");
  });

  it("reads the second face's cost and text once the card has one", () => {
    const back = { ...VALUES.back_face, cost: "{3/W}", rules_text: "Add {G}." };
    const { container } = render(<UndrawableSymbolNotice values={{ ...VALUES, back_face: back }} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    render(<UndrawableSymbolNotice values={{ ...VALUES, has_back_face: true, back_face: back }} />);
    expect(screen.getByTestId("undrawable-symbol-notice").textContent).toContain(
      "Back face mana cost: {3/W} can't be drawn and will be left off the card.",
    );
  });
});
