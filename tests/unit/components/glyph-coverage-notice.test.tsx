// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GlyphCoverageNotice } from "@/components/creator/glyph-coverage-notice";
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
