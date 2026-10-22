// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 6.2 — CARDNAME / `~` in the LIVE PREVIEW: drawn as the name the
// title bar prints (the nickname where it shows), as typed on a card
// migration 0142 flagged, and byte for byte as before on every card without
// a token.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Grizzly Bears",
    cost: "{1}{G}",
    cardType: "creature",
    subtypes: ["Bear"],
    rarity: "common",
    colorIdentity: ["green"],
    power: "2",
    toughness: "2",
    rulesText: "~ deals 3 damage to any target.\nWhen CARDNAME dies, draw a card.",
    frameStyle: { template: "m15", finish: "regular" },
    brandMark: true,
    ...over,
  };
}

const text = (over: Partial<CardPreviewData> = {}) => {
  const { container } = render(<CardPreview {...card(over)} />);
  const out = (container.textContent ?? "").normalize("NFKC").replace(/\s+/g, "");
  cleanup();
  return out;
};

describe("CARDNAME / ~ in the live preview", () => {
  it("draws the card's name", () => {
    const shown = text();
    expect(shown).toContain("GrizzlyBearsdeals3damage");
    expect(shown).toContain("WhenGrizzlyBearsdies");
    expect(shown).not.toContain("~");
    expect(shown).not.toContain("CARDNAME");
  });

  it("draws the nickname where the title bar prints it, the name where it doesn't", () => {
    expect(text({ nickname: "Ursa Major" })).toContain("UrsaMajordeals3damage");
    expect(text({ nickname: "Ursa Major", frameStyle: { template: "modern", finish: "regular" } })).toContain("GrizzlyBearsdeals3damage");
  });

  it("draws a flagged card's token as typed", () => {
    const shown = text({ frameStyle: { template: "m15", finish: "regular", selfName: "literal" } });
    expect(shown).toContain("~deals3damage");
    expect(shown).toContain("CARDNAMEdies");
  });

  it("lays the text out exactly as the name typed out (ONE substitution before every layout — the bake's twin)", () => {
    expect(renderToStaticMarkup(<CardPreview {...card()} />)).toBe(
      renderToStaticMarkup(<CardPreview {...card({ rulesText: "Grizzly Bears deals 3 damage to any target.\nWhen Grizzly Bears dies, draw a card." })} />),
    );
  });
});
