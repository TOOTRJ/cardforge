// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { collectorLayout, type CollectorLayout } from "@/lib/cards/collector-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line in the LIVE PREVIEW on the real profiles,
// held to the layout the bake draws (tests/unit/render/collector-bake
// .test.tsx): every run at the layout's x / top (% of the card) and size
// (cqw), with the face's own line height; the ★ and the brush as the
// layout's path boxes; the brand mark in the © slot at the layout's anchor
// (its own size) on display, the footer text in the body face on a
// subscriber's download preview; today's footer and bottom-right mark
// where the key is absent or "off", and on a frame without the slot.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Sheoldred, the Apocalypse",
    cost: "{2}{B}{B}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Phyrexian", "Praetor"],
    rarity: "mythic",
    colorIdentity: ["black"],
    power: "4",
    toughness: "5",
    artistCredit: "Chris Rahn",
    frameStyle: { template: "m15", finish: "regular", collector: "2015" },
    setCode: "DMU",
    collectorNumber: "107/281",
    lang: "en",
    brandMark: true,
    ...over,
  };
}

/** What the bake draws for `data` (the same layout function). */
function bakeLayout(data: CardPreviewData, surface: { kind: "display" } | { kind: "download"; footerText: string | null }): CollectorLayout | null {
  return collectorLayout(
    getFrameProfile(data.frameStyle?.template),
    {
      cardType: data.cardType,
      supertype: data.supertype,
      rarity: data.rarity,
      setCode: data.setCode,
      collectorNumber: data.collectorNumber,
      lang: data.lang,
      artistCredit: data.artistCredit,
      finish: data.frameStyle?.finish,
      star: data.frameStyle?.star,
      collector: data.frameStyle?.collector,
      plates: { pt: Boolean(data.power || data.toughness), loyalty: false, defense: false },
    },
    surface,
  );
}

const cqw = (pct: number) => `${(pct * 100).toFixed(3)}cqw`;
// happy-dom drops `cqw` lengths from element.style: read the server markup
// for the sizes (the measured-fit preview test's pattern).
const markup = (ui: React.ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html").body;
const prop = (el: Element, name: string) => new RegExp(`(?:^|;)${name}:([^;]+)`).exec(el.getAttribute("style") ?? "")?.[1] ?? null;

describe("the preview draws the bake's collector line", () => {
  it("every text run at the layout's x, top and size, with the face's line height; the paths in their boxes", () => {
    const data = card();
    const layout = bakeLayout(data, { kind: "display" })!;
    const container = markup(<CardPreview {...data} />);
    const block = container.querySelector<HTMLElement>("[data-collector-line]")!;
    expect(block).not.toBeNull();
    expect(block.getAttribute("data-collector-line")).toBe("2015");
    const nodes = [...block.querySelectorAll<HTMLElement>("[data-collector-run]")];
    expect(nodes).toHaveLength(layout.runs.length);
    layout.runs.forEach((run, i) => {
      const node = nodes[i];
      expect(node.getAttribute("data-collector-run"), `${i}`).toBe(run.role);
      expect(parseFloat(prop(node, "left") ?? ""), `${run.role} x`).toBeCloseTo(run.xPct, 6);
      expect(parseFloat(prop(node, "top") ?? ""), `${run.role} top`).toBeCloseTo(run.topPct, 6);
      if (run.kind === "text") {
        expect(node.tagName).toBe("SPAN");
        expect(node.textContent).toBe(run.text);
        expect(prop(node, "font-size"), run.role).toBe(cqw(run.sizePct));
        expect(parseFloat(prop(node, "line-height") ?? ""), run.role).toBeCloseTo(run.lineHeight, 6);
        expect(prop(node, "letter-spacing"), run.role).toBe(`${run.letterSpacingEm}em`);
        expect(prop(node, "white-space")).toBe("nowrap");
        const family = (prop(node, "font-family") ?? "").replace(/&quot;/g, '"');
        expect(family, run.role).toContain(run.face === "collector" ? "CollectorLine" : run.face === "display" ? "CardDisplay" : "MPlantin");
        if (run.face === "collector") expect(family).toMatch(/^"CollectorLine"/);
      } else {
        expect(node.tagName.toLowerCase()).toBe("svg");
        expect(parseFloat(prop(node, "width") ?? ""), run.role).toBeCloseTo(run.widthPct, 6);
        expect(parseFloat(prop(node, "height") ?? ""), run.role).toBeCloseTo(run.heightPct, 6);
        expect(node.getAttribute("preserveAspectRatio")).toBe("none");
        expect(node.querySelector("path")?.getAttribute("fill-rule")).toBe("evenodd");
      }
    });
    // Today's footer is gone while the line is drawn.
    expect(container.textContent).not.toMatch(/Art:\s*Chris\s*Rahn/);
  });

  it("display: the brand mark in the © slot at the layout's anchor — the same size, on line 2 with a plate, line 1 without", () => {
    for (const data of [card(), card({ cardType: "instant", supertype: null, subtypes: [], power: null, toughness: null, rarity: "common" })]) {
      const layout = bakeLayout(data, { kind: "display" })!;
      expect(layout.mark.kind).toBe("brand");
      if (layout.mark.kind !== "brand") return;
      const container = markup(<CardPreview {...data} />);
      const mark = container.querySelector<HTMLElement>("[data-brand-mark=collector]")!;
      expect(mark).not.toBeNull();
      expect(mark.textContent).toContain("pipglyph.com");
      expect(parseFloat(prop(mark, "right") ?? "")).toBeCloseTo(100 - layout.mark.anchor.rightPct, 6);
      expect(parseFloat(prop(mark, "top") ?? "")).toBeCloseTo(layout.mark.anchor.topPct, 6);
      expect(prop(mark, "font-size")).toBe(cqw(layout.mark.anchor.sizePct));
      expect(prop(mark, "font-size")).toBe(cqw(0.026));
      expect(parseFloat(prop(mark, "line-height") ?? "")).toBeCloseTo(layout.mark.anchor.lineHeight, 6);
      // No bottom-right mark beside it.
      expect(container.querySelectorAll("[data-brand-mark=collector]")).toHaveLength(1);
      const legacy = [...container.querySelectorAll<HTMLElement>("div")].filter((d) => prop(d, "bottom") && d.textContent === "pipglyph.com");
      expect(legacy).toHaveLength(0);
    }
  });

  it("a subscriber's download preview (no brand mark): the footer mark in the body face in the © slot, or an empty slot", () => {
    const data = card({ brandMark: false, footerWatermark: "Forged by Kesh" });
    const layout = bakeLayout(data, { kind: "download", footerText: "Forged by Kesh" })!;
    expect(layout.mark.kind).toBe("text");
    const container = markup(<CardPreview {...data} />);
    expect(container.querySelector("[data-brand-mark=collector]")).toBeNull();
    const markText = container.querySelector<HTMLElement>("[data-collector-run=mark-text]")!;
    expect(markText.textContent).toBe("Forged by Kesh");
    expect((prop(markText, "font-family") ?? "").replace(/&quot;/g, '"')).toMatch(/^"MPlantin"/);
    const empty = markup(<CardPreview {...card({ brandMark: false, footerWatermark: null })} />);
    expect(empty.querySelector("[data-collector-run=mark-text]")).toBeNull();
    expect(empty.querySelector("[data-brand-mark=collector]")).toBeNull();
    expect(empty.querySelector("[data-collector-line]")).not.toBeNull();
  });

  it("draws today's footer and bottom-right mark where the bake does: the key absent, off, or a frame without the slot", () => {
    for (const data of [
      card({ frameStyle: { template: "m15", finish: "regular" } }),
      card({ frameStyle: { template: "m15", finish: "regular", collector: "off", star: true } }),
      card({ frameStyle: { template: "m15borderless", finish: "regular", collector: "2023" } }),
    ]) {
      expect(bakeLayout(data, { kind: "display" }), JSON.stringify(data.frameStyle)).toBeNull();
      const { container } = render(<CardPreview {...data} />);
      expect(container.querySelector("[data-collector-line]"), JSON.stringify(data.frameStyle)).toBeNull();
      expect(container.querySelector("[data-brand-mark=collector]")).toBeNull();
      expect(container.textContent).toMatch(/Art:\s*Chris\s*Rahn/);
      expect(container.textContent).toContain("pipglyph.com");
      cleanup();
    }
  });

  it("the ★ by the flag and by a foil finish, the 2023 style's letter first, a token's T, an emblem's E", () => {
    const star = render(<CardPreview {...card({ frameStyle: { template: "m15", finish: "regular", collector: "2015", star: true } })} />).container;
    expect(star.querySelector("[data-collector-run=separator]")).not.toBeNull();
    expect(star.querySelector("[data-collector-run=set]")?.textContent).toBe("DMU");
    cleanup();
    const foil = render(<CardPreview {...card({ frameStyle: { template: "m15", finish: "foil", collector: "2015" } })} />).container;
    expect(foil.querySelector("[data-collector-run=separator]")).not.toBeNull();
    cleanup();
    const modern = render(<CardPreview {...card({ frameStyle: { template: "m15", finish: "regular", collector: "2023" }, collectorNumber: "9" })} />).container;
    const runs = [...modern.querySelectorAll<HTMLElement>("[data-collector-run]")].map((n) => [n.dataset.collectorRun, n.textContent]);
    expect(runs.slice(0, 2)).toEqual([
      ["set", "DMU • EN"],
      ["letter", "M"],
    ]);
    expect(runs).toContainEqual(["number", "0009"]);
    cleanup();
    const token = render(
      <CardPreview {...card({ cardType: "token", supertype: "Creature", rarity: "rare", frameStyle: { template: "m15token", finish: "regular", collector: "2015" }, setCode: "DOM", collectorNumber: "1/16" })} />,
    ).container;
    expect(token.querySelector("[data-collector-run=letter]")?.textContent).toBe("T");
    expect(token.querySelector("[data-collector-run=number]")?.textContent).toBe("001/016");
    cleanup();
    const emblem = render(
      <CardPreview {...card({ cardType: "emblem", supertype: null, subtypes: [], cost: null, power: null, toughness: null, rarity: "common", colorIdentity: ["colorless"], frameStyle: { template: "emblem", finish: "regular", collector: "2023" }, setCode: "FDN", collectorNumber: "24" })} />,
    ).container;
    expect(emblem.querySelector("[data-collector-run=letter]")?.textContent).toBe("E");
    expect(emblem.querySelector("[data-collector-run=number]")?.textContent).toBe("0024");
    // No plate on an emblem: the mark on line 1.
    const layout = bakeLayout(card({ cardType: "emblem", power: null, toughness: null, frameStyle: { template: "emblem", collector: "2023" } }), { kind: "display" })!;
    expect(layout.markLine).toBe(1);
  });
});
