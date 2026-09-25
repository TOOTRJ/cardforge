// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { FoilSheen, FoilStripeSheen, coverPlacement, foilArtLayers, loyaltyStripeRects } from "@/lib/cards/foil-finish";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// Foil finish: ONE shared SVG (lib/cards/foil-finish.tsx) drawn by the live
// preview and the Satori bake — the etched finish's pattern. The old preview
// spun a mix-blend-mode conic gradient the bake could never draw (Satori
// drops blend modes and `inset`), so no foil ever reached a saved image.
// Real-pixel bake checks live in foil-bake.test.tsx.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const entry = (c: string) => ({ hash: c.repeat(12), sha256: c.repeat(64), bytes: 1, width: 1, height: 1 });
const MANIFEST: FrameManifest = {
  version: 1,
  bucket: "frames",
  files: {
    "m15/w.png": entry("1"),
    "m15/w.webp": entry("2"),
    "m15/pt/w.png": entry("3"),
    "m15/pt/w.webp": entry("4"),
  },
};

let restore: () => void = () => {};
afterEach(() => {
  restore();
  cleanup();
  vi.unstubAllGlobals();
});

describe("coverPlacement — the CSS/Satori object-fit: cover math", () => {
  const slot = { x: 100, y: 50, width: 600, height: 400 };
  it("fills the short axis and offsets the long one by focal · overflow", () => {
    // 1200×600 into 600×400 → scale 2/3 → 800×400, 200 px of overflow.
    const p = coverPlacement(slot, { width: 1200, height: 600 }, 0.25, 0.5, 1);
    expect(p.width).toBeCloseTo(800);
    expect(p.height).toBeCloseTo(400);
    expect(p.x).toBeCloseTo(100 - 0.25 * 200);
    expect(p.y).toBeCloseTo(50);
    expect(p.transform).toBeUndefined();
  });

  it("zooms about the focal point like transform-origin: focal%", () => {
    const p = coverPlacement(slot, { width: 600, height: 400 }, 0.3, 0.8, 1.5);
    // origin = (100 + 0.3·600, 50 + 0.8·400) = (280, 370); matrix e = ox(1 − s).
    expect(p.transform).toBe(`matrix(1.5 0 0 1.5 ${280 * -0.5} ${370 * -0.5})`);
  });
});

describe("foilArtLayers", () => {
  const art = { href: "a.png", naturalWidth: 1000, naturalHeight: 800 };
  it("redraws the window art, plus the under-frame art on see-through frames", () => {
    const m15 = getFrameProfile("m15");
    expect(foilArtLayers({ layout: m15, colorKey: "w", art, artPosition: { scale: 2 } })).toHaveLength(1);
    const clear = foilArtLayers({ layout: m15, colorKey: "c", art, artPosition: { scale: 2 } });
    expect(clear).toHaveLength(2);
    // Under-frame art is drawn at scale 1 in both renderers.
    expect(clear.map((l) => l.scale)).toEqual([1, 2]);
    expect(foilArtLayers({ layout: m15, colorKey: "w", art: null, artPosition: {} })).toEqual([]);
  });

  it("rotates a split's second window with its face", () => {
    const split = getFrameProfile("split");
    const layers = foilArtLayers({ layout: split, colorKey: "w", art, artPosition: {}, secondArt: art, secondArtPosition: {} });
    expect(layers).toHaveLength(2);
    expect(layers[1].rect).toEqual(split.secondFace!.artSlot);
    expect(layers[1].rotation).toBe(split.secondFace!.rotation);
  });
});

describe("FoilSheen markup", () => {
  it("never emits an undefined attribute (Satori would print it verbatim)", () => {
    const html = renderToStaticMarkup(
      FoilSheen({
        id: "f",
        frameHref: "frame.png",
        art: foilArtLayers({
          layout: getFrameProfile("m15"),
          colorKey: "c",
          art: { href: "a.png", naturalWidth: 1000, naturalHeight: 800 },
          artPosition: { scale: 1 },
        }),
        width: 750,
        height: 1050,
      }),
    );
    expect(html).not.toContain("undefined");
    expect(html).not.toMatch(/mix-blend|inset/);
    // Luminance mask: art layers first, the frame on top.
    const mask = html.slice(html.indexOf("<mask"), html.indexOf("</mask>"));
    expect(mask.lastIndexOf('href="a.png"')).toBeLessThan(mask.indexOf('href="frame.png"'));
  });
});

describe("foil finish — preview", () => {
  it("masks the sheen with the frame the face paints, the art it shows, and gives the P/T plate its own", async () => {
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
    // happy-dom never decodes images: report a 1200×800 art on load.
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 0;
        naturalHeight = 0;
        onload: (() => void) | null = null;
        set src(_v: string) {
          this.naturalWidth = 1200;
          this.naturalHeight = 800;
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const { container } = render(
      <CardPreview
        title="Foil Test"
        cardType="creature"
        colorIdentity={["white"]}
        power="2"
        toughness="2"
        artUrl="https://art.example/a.png"
        artPosition={{ focalX: 0.3, focalY: 0.5, scale: 1.25 }}
        frameStyle={{ template: "m15", finish: "foil" }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const masks = Array.from(container.querySelectorAll("mask"));
    expect(masks).toHaveLength(2);
    const [card, plate] = masks;
    // Stacking: the card-level sheen sits right above the frame (z-6) and
    // below every text layer (z-20) — on a real foil the ink is on top.
    const cardSvg = card.closest("svg") as SVGSVGElement;
    expect(cardSvg.style.zIndex).toBe("6");
    const cardImages = Array.from(card.querySelectorAll("image")).map((i) => i.getAttribute("href"));
    expect(cardImages).toEqual(["https://art.example/a.png", "https://b.example/frames/m15/w.222222222222.webp"]);
    expect(Array.from(plate.querySelectorAll("image")).map((i) => i.getAttribute("href"))).toEqual([
      "https://b.example/frames/m15/pt/w.444444444444.webp",
    ]);
    // The art layer uses the shared cover geometry for the art slot.
    const p = getFrameProfile("m15").artSlot;
    const expected = coverPlacement(
      { x: (p.leftPct / 100) * 1500, y: (p.topPct / 100) * 2100, width: (p.widthPct / 100) * 1500, height: (p.heightPct / 100) * 2100 },
      { width: 1200, height: 800 },
      0.3,
      0.5,
      1.25,
    );
    const img = card.querySelector("image")!;
    expect(Number(img.getAttribute("width"))).toBeCloseTo(expected.width, 1);
    expect(Number(img.getAttribute("x"))).toBeCloseTo(expected.x, 1);
    expect(img.getAttribute("transform")).toBe(expected.transform);
    // Ids are url()-safe and unique per instance.
    const ids = masks.map((m) => m.getAttribute("id") ?? "");
    for (const id of ids) {
      expect(id).toMatch(/^foil-[A-Za-z0-9_-]+-lum$/);
      expect(container.querySelector(`g[mask="url(#${id})"]`)).not.toBeNull();
    }
    expect(new Set(ids).size).toBe(2);
    // The old blend-mode shimmer is gone.
    expect(container.innerHTML).not.toMatch(/mix-blend|card-shimmer|conic-gradient/);
  });

  it("renders no foil for other finishes", () => {
    for (const finish of ["regular", "etched", "showcase"] as const) {
      const { container } = render(
        <CardPreview title="Plain" cardType="creature" power="1" toughness="1" colorIdentity={["white"]} frameStyle={{ template: "m15", finish }} />,
      );
      expect(container.querySelector('[id^="foil-"]'), finish).toBeNull();
      cleanup();
    }
  });
});

describe("foil finish — one component, both renderers", () => {
  it("the bake draws the shared SVG right after the frame (and on its plates), never a blend-mode overlay", () => {
    const bake = read("lib/render/card-image.tsx");
    expect(bake).toContain('from "@/lib/cards/foil-finish"');
    const frameImg = bake.indexOf("src={frameDataUrl}");
    const sheen = bake.indexOf("<FoilSheen");
    expect(frameImg).toBeGreaterThan(0);
    expect(sheen).toBeGreaterThan(frameImg);
    expect(bake.slice(frameImg, sheen)).not.toContain("<Band");
    expect(bake).toContain("foilArtLayers({");
    expect(bake).not.toMatch(/mixBlendMode:|inset: 0,/);
    // Satori resolves an inline SVG's <image href> only from its image cache:
    // the mask's art copies must be listed as the root's (unrendered) children.
    expect(bake).toMatch(/<image key=\{i\} href=\{source\.href\} \/>/);
  });

  it("the preview draws the same component (full card at z-6, plates in StatOverlay)", () => {
    const preview = read("components/cards/card-preview.tsx");
    expect(preview).toContain('from "@/lib/cards/foil-finish"');
    expect(preview.match(/<FoilSheen/g)?.length).toBe(2);
    expect(preview).toContain("foilArtLayers({");
    expect(preview).not.toMatch(/mix-blend-overlay|card-shimmer/);
  });
});

// ---------------------------------------------------------------------------
// Planeswalker ability stripes: the rows' translucent stripes sit above the
// full-card sheen, so each stripe carries its own (FoilStripeSheen), drawn
// over the stripe and under the badge + text. Real-pixel checks live in
// foil-bake.test.tsx.
// ---------------------------------------------------------------------------

const norm = (css: string | null | undefined) => (css ?? "").replace(/\s+/g, "");
const PW_RULES = "+1: Scry 1.\n−2: Draw a card.\n−7: You win.";

describe("loyaltyStripeRects", () => {
  it("cuts the rules rect into equal, contiguous rows — the renderers' flex: 1 rows", () => {
    const rect = { topPct: 60, leftPct: 8, widthPct: 84, heightPct: 30 };
    const rows = loyaltyStripeRects(rect, 3);
    expect(rows).toHaveLength(3);
    rows.forEach((r, i) => {
      expect(r.leftPct).toBe(8);
      expect(r.widthPct).toBe(84);
      expect(r.heightPct).toBeCloseTo(10);
      expect(r.topPct).toBeCloseTo(60 + 10 * i);
    });
    expect(loyaltyStripeRects(rect, 1)).toEqual([rect]);
  });
});

describe("FoilStripeSheen markup", () => {
  const region = { topPct: 70, leftPct: 10, widthPct: 80, heightPct: 10 };
  it("masks the card-space rainbow with the stripe's own colour, over just the row", () => {
    const html = renderToStaticMarkup(
      FoilStripeSheen({ id: "s", region, fill: "rgba(244,238,226,0.78)", width: 600, height: 105 }),
    );
    expect(html).not.toContain("undefined");
    expect(html).not.toMatch(/mix-blend|inset/);
    // The SVG shows the row's box of the HD card…
    expect(html).toContain('viewBox="150 1470 1200 210"');
    // …while the gradients span the whole card, like the card-wide sheen's.
    expect(html.match(/<linearGradient[^>]*x2="1500" y2="2100"/g)).toHaveLength(2);
    const mask = html.slice(html.indexOf("<mask"), html.indexOf("</mask>"));
    expect(mask).toContain('id="s-lum"');
    expect(mask.match(/<rect /g)).toHaveLength(1);
    expect(mask).toContain('fill="rgba(244,238,226,0.78)"');
    expect(mask).not.toContain("<image");
    expect(html).toContain('mask="url(#s-lum)"');
  });

  it("uses the landscape card space for a landscape frame", () => {
    const html = renderToStaticMarkup(
      FoilStripeSheen({ id: "s", region, fill: "#fff", landscape: true, width: 600, height: 75 }),
    );
    expect(html).toContain('viewBox="210 1050 1680 150"');
    expect(html.match(/<linearGradient[^>]*x2="2100" y2="1500"/g)).toHaveLength(2);
  });
});

describe("foil finish — planeswalker ability stripes in the preview", () => {
  const stripeSheens = (root: HTMLElement) =>
    Array.from(root.querySelectorAll("svg")).filter((svg) => /-rows-\d+-lum$/.test(svg.querySelector("mask")?.id ?? ""));

  it("draws a sheen in every row, over its stripe and under its badge + text", () => {
    const { container } = render(
      <CardPreview
        title="Probe, the Walker"
        cardType="planeswalker"
        colorIdentity={["white"]}
        rulesText={PW_RULES}
        loyalty="4"
        frameStyle={{ template: "m15pw", finish: "foil" }}
      />,
    );
    const sheens = stripeSheens(container);
    expect(sheens).toHaveLength(3);
    const p = getFrameProfile("m15pw");
    const expected = loyaltyStripeRects(p.rules.rect, 3);
    const ids = new Set<string>();
    sheens.forEach((svg, i) => {
      const row = svg.parentElement as HTMLElement;
      // Mask = the stripe the row paints (A/B alternate).
      const fill = svg.querySelector("mask rect")?.getAttribute("fill");
      expect(norm(fill)).toBe(norm(i % 2 === 0 ? p.loyaltyRows!.stripeAHex : p.loyaltyRows!.stripeBHex));
      expect(norm(row.style.background)).toBe(norm(fill));
      // Stacking: the sheen is the row's first child; the badge and the text
      // after it are positioned, so they paint over it (the bake's order).
      expect(row.style.position).toBe("relative");
      expect(row.firstElementChild).toBe(svg);
      const [, badge, text] = Array.from(row.children) as HTMLElement[];
      expect(badge.style.position).toBe("relative");
      expect(text.style.position).toBe("relative");
      // (RulesBody sets words as spans: compare without whitespace.)
      expect(norm(text.textContent)).toContain(norm(["Scry 1.", "Draw a card.", "You win."][i]));
      // The row's card-space box, so the rainbow runs on from the card's.
      const r = expected[i];
      const px = (v: number) => Math.round(v * 100) / 100;
      expect(svg.getAttribute("viewBox")).toBe(
        [(r.leftPct / 100) * 1500, (r.topPct / 100) * 2100, (r.widthPct / 100) * 1500, (r.heightPct / 100) * 2100].map(px).join(" "),
      );
      const id = svg.querySelector("mask")!.id;
      expect(id).toMatch(/^foil-[A-Za-z0-9_-]+-rows-\d+-lum$/);
      ids.add(id);
    });
    expect(ids.size).toBe(3);
  });

  it("gives the editor-only empty planeswalker's striped rows the same sheen", () => {
    const { container } = render(
      <CardPreview title="New Walker" cardType="planeswalker" colorIdentity={["blue"]} frameStyle={{ template: "m15pw", finish: "foil" }} staticInEditor />,
    );
    const sheens = stripeSheens(container);
    expect(sheens).toHaveLength(3);
    expect(norm(sheens[0].parentElement!.textContent)).toContain(norm("Loyalty abilities appear here"));
  });

  it("leaves every other finish's rows exactly as they were", () => {
    const { stripeAHex, stripeBHex } = getFrameProfile("m15pw").loyaltyRows!;
    const [stripeA, stripeB] = [norm(stripeAHex), norm(stripeBHex)];
    for (const finish of ["regular", "etched", "showcase"] as const) {
      for (const staticInEditor of [false, true]) {
        const { container } = render(
          <CardPreview
            title="Probe"
            cardType="planeswalker"
            colorIdentity={["white"]}
            rulesText={staticInEditor ? null : PW_RULES}
            loyalty="4"
            frameStyle={{ template: "m15pw", finish }}
            staticInEditor={staticInEditor}
          />,
        );
        expect(stripeSheens(container), finish).toHaveLength(0);
        const rows = Array.from(container.querySelectorAll("div")).filter((d) =>
          [stripeA, stripeB].includes(norm(d.style.background)),
        );
        expect(rows, finish).toHaveLength(3);
        for (const row of rows) expect(row.style.position, finish).toBe("");
        cleanup();
      }
    }
  });
});

describe("foil stripes — one component, both renderers", () => {
  /** The ability-row map of a renderer's rows component. */
  const rowsSource = (src: string, fn: string) => {
    const start = src.indexOf(`function ${fn}(`);
    return src.slice(start, src.indexOf("\n}\n", start));
  };

  it("each renderer draws FoilStripeSheen as the row's first child, masked by the stripe it paints", () => {
    for (const [file, fn] of [
      ["lib/render/card-image.tsx", "LoyaltyRowsBake"],
      ["components/cards/card-preview.tsx", "LoyaltyRows"],
    ] as const) {
      const src = read(file);
      expect(src, file).toMatch(/import \{[^}]*FoilStripeSheen[^}]*loyaltyStripeRects[^}]*\} from "@\/lib\/cards\/foil-finish"/);
      const rows = rowsSource(src, fn);
      expect(rows, file).toContain("loyaltyStripeRects(slot.rect, abilities.length)");
      expect(rows, file).toContain("background: stripe(i),");
      expect(rows, file).toContain("fill={stripe(i)}");
      const sheen = rows.indexOf("<FoilStripeSheen");
      expect(sheen, file).toBeGreaterThan(rows.indexOf("background: stripe(i),"));
      expect(sheen, file).toBeLessThan(rows.indexOf("loyaltyBadgeAssetFor(ab.cost)"));
    }
  });

  it("both of the preview's ability-row states get the foil (real rows and the editor-only empty state)", () => {
    const preview = read("components/cards/card-preview.tsx");
    const uses = preview.match(/<LoyaltyRows\b[\s\S]*?\/>/g) ?? [];
    expect(uses).toHaveLength(2);
    for (const use of uses) expect(use).toContain("foil={plateFoil && { ...plateFoil, id: `${foilId}-rows` }}");
    const bake = read("lib/render/card-image.tsx");
    const at = bake.indexOf("? LoyaltyRowsBake({");
    expect(at).toBeGreaterThan(0);
    expect(bake.slice(at, bake.indexOf("})", at))).toContain("foil: plateFoil,");
  });
});
