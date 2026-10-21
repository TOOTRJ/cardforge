// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { backPreviewData } from "@/lib/cards/faces";
import { NICKNAME_LINE_PX, nicknamePlateArt } from "@/lib/cards/nickname";

// ---------------------------------------------------------------------------
// TODO 6.3 — the nickname in the LIVE PREVIEW: on a frame that declares the
// plate, the nickname in the title bar, the plate (the same inline SVG the
// bake draws) and the card's own name on it; on any other frame, and on
// every card without a nickname, the preview is byte for byte what it was.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Fleecemane Lion",
    cost: "{G}{W}",
    cardType: "creature",
    subtypes: ["Cat"],
    rarity: "rare",
    colorIdentity: ["green", "white", "multicolor"],
    power: "3",
    toughness: "3",
    rulesText: "{3}{G}{W}: Monstrosity 1.",
    frameStyle: { template: "m15", finish: "regular" },
    brandMark: true,
    ...over,
  };
}

const titleText = (root: HTMLElement) => root.querySelector("span[title]")?.getAttribute("title");

describe("the nickname in the live preview", () => {
  it("prints the nickname in the title bar and the name on the plate", () => {
    const { container } = render(<CardPreview {...card({ nickname: "Wakandan War Panther" })} />);
    expect(titleText(container)).toBe("Wakandan War Panther");
    const plate = container.querySelector("[data-nickname-plate] img");
    expect(plate?.getAttribute("src")).toBe(nicknamePlateArt("m"));
    const line = container.querySelector("[data-nickname-line]");
    expect(line?.textContent?.normalize("NFKC").replace(/\s+/g, " ")).toBe("Fleecemane Lion");
    // In the body face's italic, white, at print's size (the static markup
    // keeps the cqw size happy-dom's style object drops).
    const band = line!.parentElement as HTMLElement;
    expect(band.style.fontStyle).toBe("italic");
    expect(band.style.color).toMatch(/#ffffff|rgb\(255, 255, 255\)/);
    const markup = renderToStaticMarkup(<CardPreview {...card({ nickname: "Wakandan War Panther" })} />);
    expect(markup).toMatch(new RegExp(`font-size:${((NICKNAME_LINE_PX / 1500) * 100).toFixed(2)}\\d*cqw`));
  });

  it("the two-colour pair's plate takes the pair master's key", () => {
    const { container } = render(
      <CardPreview {...card({ nickname: "Wakandan War Panther", frameStyle: { template: "m15", finish: "regular", twoColor: true } })} />,
    );
    const src = container.querySelector("[data-nickname-plate] img")?.getAttribute("src") ?? "";
    expect(decodeURIComponent(src)).toContain("linearGradient");
  });

  it("draws nothing of it without a nickname — a blank or null one is no nickname", () => {
    const plain = renderToStaticMarkup(<CardPreview {...card()} />);
    expect(plain).not.toContain("data-nickname");
    expect(renderToStaticMarkup(<CardPreview {...card({ nickname: null })} />)).toBe(plain);
    expect(renderToStaticMarkup(<CardPreview {...card({ nickname: "   " })} />)).toBe(plain);
  });

  it("changes nothing on a frame that prints no plate", () => {
    for (const template of ["modern", "retro", "m15borderless", "m15token", "saga"] as const) {
      const frameStyle = { template, finish: "regular" as const };
      expect(renderToStaticMarkup(<CardPreview {...card({ frameStyle, nickname: "Wakandan War Panther" })} />), template).toBe(
        renderToStaticMarkup(<CardPreview {...card({ frameStyle })} />),
      );
    }
  });

  it("is the front's alone: a back face never carries it", () => {
    const front = card({
      nickname: "Dracula, Lord of Blood",
      backFace: { title: "Bloodbat Summoner", card_type: "creature" } as CardPreviewData["backFace"],
    });
    expect(backPreviewData(front)?.nickname).toBeNull();
    expect(backPreviewData(card({ backFace: { title: "Back", card_type: "creature" } as CardPreviewData["backFace"] }))).not.toHaveProperty("nickname");
  });

  it("rides from the stored row only when the row has one (a row without is mapped as before)", () => {
    const row = {
      id: "1",
      owner_id: "2",
      title: "Fleecemane Lion",
      cost: null,
      card_type: "creature",
      supertype: null,
      subtypes: [],
      rarity: "rare",
      color_identity: ["green"],
      rules_text: null,
      flavor_text: null,
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
      artist_credit: null,
      art_url: null,
      art_position: {},
      frame_style: { template: "m15" },
      set_icon_url: null,
      set_icon_code: null,
      back_face: null,
      face_content: null,
      watermark: null,
    } satisfies CardRowForBake;
    expect(rowToPreviewData(row)).not.toHaveProperty("nickname");
    expect(rowToPreviewData({ ...row, nickname: null })).toEqual(rowToPreviewData(row));
    expect(rowToPreviewData({ ...row, nickname: "Wakandan War Panther" }).nickname).toBe("Wakandan War Panther");
  });
});
