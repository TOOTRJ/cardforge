// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  GlyphCoverageNotice,
  GlyphNoticeAnnouncer,
  UndrawableSymbolNotice,
} from "@/components/creator/glyph-coverage-notice";
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
    // Not a live region of its own: GlyphNoticeAnnouncer says it (6.7).
    expect(notice.hasAttribute("role")).toBe(false);
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
      <UndrawableSymbolNotice values={{ ...VALUES, cost: "{2}{W/U}{G/P}{G/W/P}", rules_text: "{T}: Add {G}. ({G/W/P} can be paid with {G}, {W}, or 2 life.)" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names the symbols the card leaves out, field by field", () => {
    render(
      <UndrawableSymbolNotice
        values={{
          ...VALUES,
          cost: "{21}{W/U/P}{W/W/P}{G}",
          rules_text: "{T}, Pay {C/P}: Draw a card.",
          flavor_text: "{1/2} in flavor text prints as typed.",
        }}
      />,
    );
    const notice = screen.getByTestId("undrawable-symbol-notice");
    // Not a live region of its own: GlyphNoticeAnnouncer says it (6.7).
    expect(notice.hasAttribute("role")).toBe(false);
    expect(notice.textContent).toContain("Some symbols can't be drawn on the card");
    // {W/U/P} draws (layout v49) and is not named; {W/W/P} is no symbol.
    expect(notice.textContent).toContain("Mana cost: {21} and {W/W/P} can't be drawn and will be left off the card.");
    expect(notice.textContent).not.toContain("{W/U/P}");
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

// TODO 6.7: the notices are said by ONE polite live region, always mounted,
// whose words change only when the fields named change — never an alert,
// never a second region per notice, never at every keystroke.
describe("GlyphNoticeAnnouncer", () => {
  it("is mounted, empty and polite while the card draws everything", () => {
    render(<GlyphNoticeAnnouncer values={VALUES} />);
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the fields of both notices in one region", () => {
    const { rerender } = render(<GlyphNoticeAnnouncer values={VALUES} />);
    const region = screen.getByRole("status");
    rerender(<GlyphNoticeAnnouncer values={{ ...VALUES, title: "Ember 🔥 Drake", rules_text: "{T}, Pay {C/P}: Draw." }} />);
    expect(screen.getAllByRole("status")).toEqual([region]);
    expect(region.textContent).toBe(
      "Some characters may not show on the card image: Name. Some symbols can't be drawn on the card: Rules text.",
    );
  });

  it("keeps its words while the same fields are edited", () => {
    const { rerender } = render(<GlyphNoticeAnnouncer values={{ ...VALUES, title: "Ember 🔥 Drake" }} />);
    const region = screen.getByRole("status");
    const textNode = region.firstChild;
    rerender(<GlyphNoticeAnnouncer values={{ ...VALUES, title: "Ember 🔥🔥 Drake" }} />);
    expect(region.textContent).toBe("Some characters may not show on the card image: Name.");
    // The same text node, untouched: nothing new for a screen reader to say.
    expect(region.firstChild).toBe(textNode);
  });
});
