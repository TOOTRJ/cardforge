// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import {
  BASIC_SYMBOL_DISC_FILL,
  BASIC_SYMBOL_HALO,
  BASIC_SYMBOL_INK,
  basicSymbolBox,
  basicSymbolGlyphSizePct,
} from "@/lib/cards/basic-symbol";
import {
  BASIC_SYMBOL_MSE_SOCKET,
  BRAND_MARK_ON_ART,
  BRAND_MARK_PILL,
  ON_ART_OUTLINE,
  getFrameProfile,
  type Rect,
} from "@/lib/cards/template-layout";
import type { FrameProfileOverride } from "@/lib/cards/profile-override";
import { frameUrl } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// The live-preview half of the edge-to-edge / full-art renderer pieces (TODO
// 3.23 / 3.24): the same profile numbers the bake draws in px land here as
// card-percent boxes and cqw sizes. The bake half, with pixels, is
// tests/unit/render/edge-to-edge-bake.test.tsx.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const cqw = (f: number) => `${(f * 100).toFixed(3)}cqw`;
/** The server markup, parsed: happy-dom's CSSOM drops cqw font sizes and
 *  padding that React sets on the client, the SSR string keeps them (as
 *  aftermath-preview.test.tsx reads them). */
const markup = (ui: React.ReactElement) =>
  new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html").body;
/** A declaration as written in a style attribute. */
const decl = (el: Element, prop: string) =>
  new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(el.getAttribute("style") ?? "")?.[1]?.trim() ?? null;
const rgba = (s: string) => s.replace(/,\s*/g, ", ");
const expectRect = (el: HTMLElement, rect: Rect) => {
  expect(parseFloat(el.style.top)).toBeCloseTo(rect.topPct, 6);
  expect(parseFloat(el.style.left)).toBeCloseTo(rect.leftPct, 6);
  expect(parseFloat(el.style.width)).toBeCloseTo(rect.widthPct, 6);
  expect(parseFloat(el.style.height)).toBeCloseTo(rect.heightPct, 6);
};

const onArt: FrameProfileOverride = {
  basicSymbol: BASIC_SYMBOL_MSE_SOCKET,
  brandMark: BRAND_MARK_ON_ART,
  footerOnArt: true,
};

function plains(extra: Partial<CardPreviewData> = {}, override?: FrameProfileOverride) {
  return render(plainsUi(extra, override));
}

function plainsUi(extra: Partial<CardPreviewData> = {}, override?: FrameProfileOverride) {
  return (
    <CardPreview
      title="Plains"
      cardType="land"
      supertype="Basic"
      subtypes={["Plains"]}
      colorIdentity={["white"]}
      artistCredit="Test Artist"
      frameStyle={{ template: "fullartland" }}
      brandMark
      {...(override ? { profileOverrides: { fullartland: override } } : {})}
      {...extra}
    />
  );
}

describe("CardPreview — the basic-land symbol slot (TODO 3.24)", () => {
  it("draws the disc under the frame and the symbol above it, in the slot's square box", () => {
    const { container } = plains({}, onArt);
    const box = basicSymbolBox(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5);
    const disc = container.querySelector('[data-testid="basic-symbol-disc"]') as HTMLElement;
    expectRect(disc, box);
    expect(disc.style.zIndex).toBe("1");
    expect(disc.style.borderRadius).toBe("50%");
    expect(disc.style.background).toBe(BASIC_SYMBOL_DISC_FILL.w);
    const symbol = container.querySelector('[data-testid="basic-symbol"]') as HTMLElement;
    expectRect(symbol, box);
    expect(symbol.style.zIndex).toBe("10");
    const glyph = symbol.querySelector("i.ms.ms-w") as HTMLElement;
    const ssrGlyph = markup(plainsUi({}, onArt)).querySelector('[data-testid="basic-symbol"] i.ms-w') as HTMLElement;
    expect(decl(ssrGlyph, "font-size")).toBe(cqw(basicSymbolGlyphSizePct(BASIC_SYMBOL_MSE_SOCKET.rect, 7 / 5)));
    expect(glyph.style.color).toBe(BASIC_SYMBOL_INK.w);
    expect(glyph.style.textShadow).toBe(BASIC_SYMBOL_HALO);
    // …and no big watermark in the rules box: the sun is drawn once.
    expect(container.querySelectorAll("i.ms-w")).toHaveLength(1);
  });

  it("keeps today's rules-box watermark on a profile without a slot", () => {
    const { container } = plains();
    expect(container.querySelector('[data-testid="basic-symbol"]')).toBeNull();
    expect(container.querySelector('[data-testid="basic-symbol-disc"]')).toBeNull();
    const glyph = container.querySelector("i.ms.ms-w") as HTMLElement;
    const holder = glyph.parentElement as HTMLElement;
    expectRect(holder, getFrameProfile("fullartland").rules.rect);
  });

  it("swaps an explicit watermark into the slot", () => {
    const mana = plains({ watermark: { kind: "mana", key: "b", size: "large" } }, onArt);
    expect(mana.container.querySelector('[data-testid="basic-symbol"] i.ms-b')).not.toBeNull();
    expect(mana.container.querySelectorAll("i.ms")).toHaveLength(1);
    cleanup();
    const preset = plains({ watermark: { kind: "preset", key: "order-sun", size: "normal" } }, onArt);
    const img = preset.container.querySelector('[data-testid="basic-symbol"] img') as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/watermarks/order-sun.png");
    expect(img.style.width).toBe("80%");
    expect(img.style.objectFit).toBe("contain");
  });

  it("draws the slot's symbol image (the WebP sibling, through frameUrl) at the full box", () => {
    const { container } = plains(
      {},
      { ...onArt, basicSymbol: { ...BASIC_SYMBOL_MSE_SOCKET, style: "glyph", assetPathTemplate: "/frames/fullartland/symbol/{symbol}.png" } },
    );
    expect(container.querySelector('[data-testid="basic-symbol-disc"]')).toBeNull();
    const img = container.querySelector('[data-testid="basic-symbol"] img') as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(frameUrl("/frames/fullartland/symbol/w.webp"));
    expect(img.style.width).toBe("100%");
  });
});

describe("CardPreview — the brand mark and the footer on the art (TODO 3.23)", () => {
  const mark = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("div")).find((d) => d.textContent === "pipglyph.com") as HTMLElement;

  it("backs the mark with the pill — the bake's padding, radius and fill", () => {
    const { container } = plains({}, onArt);
    const el = mark(container);
    expect(el.style.right).toBe(`${BRAND_MARK_ON_ART.rightPct}%`);
    expect(el.style.bottom).toBe(`${BRAND_MARK_ON_ART.bottomPct}%`);
    expect(el.style.background).toBe(rgba(BRAND_MARK_PILL.fill));
    const ssr = Array.from(markup(plainsUi({}, onArt)).querySelectorAll("div")).find(
      (d) => d.textContent === "pipglyph.com",
    ) as HTMLElement;
    expect(decl(ssr, "padding")).toBe(`${cqw(BRAND_MARK_PILL.padYPct)} ${cqw(BRAND_MARK_PILL.padXPct)}`);
    expect(el.style.borderRadius).toBe(`calc(${BRAND_MARK_PILL.radiusEm}em + ${cqw(BRAND_MARK_PILL.padYPct)})`);
  });

  it("has no pill by default", () => {
    const { container } = plains();
    const el = mark(container);
    expect(el.style.background).toBe("");
    expect(el.style.padding).toBe("");
  });

  it("outlines the footer only when the profile prints it on the art", () => {
    const footerOf = (c: HTMLElement) =>
      Array.from(c.querySelectorAll("span")).find((s) => /Test.Artist/.test(s.textContent ?? ""))!
        .parentElement as HTMLElement;
    const on = plains({}, onArt);
    // fullartland declares its own outline — drawn now.
    expect(footerOf(on.container).style.textShadow).toBe(getFrameProfile("fullartland").footer!.shadowCss);
    cleanup();
    const off = plains();
    expect(footerOf(off.container).style.textShadow).toBe("");
    cleanup();
    // A footer that declares none takes ON_ART_OUTLINE.
    const textless = render(
      <CardPreview
        title="X"
        cardType="instant"
        artistCredit="Test Artist"
        frameStyle={{ template: "m15textless" }}
        profileOverrides={{ m15textless: { footerOnArt: true } }}
      />,
    );
    expect(footerOf(textless.container).style.textShadow).toBe(ON_ART_OUTLINE);
  });
});

describe("CardPreview — a split type line (TODO 3.24)", () => {
  const split = {
    leftRect: { topPct: 85.4, leftPct: 18, widthPct: 28, heightPct: 4.2 },
    rightRect: { topPct: 85.4, leftPct: 58, widthPct: 26, heightPct: 4.2 },
  };
  it("prints the two halves in their own boxes — left start, right centred — and no inline set symbol", () => {
    const forestUi = (
      <CardPreview
        title="Forest"
        cardType="land"
        supertype="Basic"
        subtypes={["Forest"]}
        colorIdentity={["green"]}
        frameStyle={{ template: "fullartland" }}
        profileOverrides={{ fullartland: { type: { split } } }}
      />
    );
    const { container } = render(forestUi);
    const left = container.querySelector('[data-type-half="left"]') as HTMLElement;
    const right = container.querySelector('[data-type-half="right"]') as HTMLElement;
    expect(left.textContent).toBe("Basic Land");
    expect(right.textContent).toBe("Forest");
    expectRect(left.parentElement as HTMLElement, split.leftRect);
    expectRect(right.parentElement as HTMLElement, split.rightRect);
    expect((left.parentElement as HTMLElement).style.justifyContent).toBe("space-between");
    expect((right.parentElement as HTMLElement).style.justifyContent).toBe("center");
    // Both halves share one size.
    const ssr = markup(forestUi);
    const size = decl(ssr.querySelector('[data-type-half="left"]')!.parentElement!, "font-size");
    expect(size).toMatch(/cqw$/);
    expect(decl(ssr.querySelector('[data-type-half="right"]')!.parentElement!, "font-size")).toBe(size);
    expect(container.textContent).not.toContain("—");
    // The whole line never prints.
    expect(container.textContent).not.toContain("Basic Land — Forest");
  });
});

describe("CardPreview — a textless frame (TODO 3.24)", () => {
  const titan = (override?: FrameProfileOverride) =>
    render(
      <CardPreview
        title="Textless Titan"
        cost="{3}{G}{G}"
        cardType="creature"
        subtypes={["Giant"]}
        colorIdentity={["green"]}
        rulesText={"Trample\nWard {2}"}
        flavorText="Big."
        power="6"
        toughness="6"
        frameStyle={{ template: "m15textless" }}
        {...(override ? { profileOverrides: { m15textless: override } } : {})}
      />,
    );

  it("prints only the title, cost and P/T (and footer) — no type line, rules or flavour", () => {
    const { container } = titan({ textless: true });
    const text = container.textContent ?? "";
    expect(container.querySelector('span[title="Textless Titan"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Cost {3}{G}{G}"]')).not.toBeNull();
    expect(text).toContain("6/6");
    expect(text).not.toContain("Giant");
    expect(text).not.toContain("Trample");
    expect(text).not.toContain("Big.");
  });

  it("prints them all without the flag", () => {
    const text = titan().container.textContent ?? "";
    expect(text).toContain("Giant");
    expect(text).toContain("Trample");
    expect(text).toContain("Big.");
  });
});
