import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// The preview half of TODO 4.49 (a) + (d): the live preview draws the 2014–19
// token frames' P/T plate, value box, left-aligned type band and
// right-anchored set-symbol box in the SAME rects the bake draws them in —
// the bake half is measured on real bakes (HD and 750) in
// tests/unit/render/token-frame-bake.test.tsx. Read from the server markup
// (happy-dom drops container-query widths).
// ---------------------------------------------------------------------------

const hash = (c: string) => c.repeat(12);
const entry = (c: string) => ({ hash: hash(c), sha256: c.repeat(64), bytes: 1, width: 1, height: 1 });
const MANIFEST: FrameManifest = {
  version: 1,
  bucket: "frames",
  files: {
    "m15/pt/w.png": entry("1"),
    "m15/pt/w.webp": entry("2"),
    "m15artifact/pt/c.png": entry("3"),
    "m15artifact/pt/c.webp": entry("4"),
    "m15artifact/pt/u.png": entry("5"),
    "m15artifact/pt/u.webp": entry("6"),
  },
};

let restore: () => void = () => {};
afterEach(() => {
  restore();
  restore = () => {};
});

function markup(template: string, over: { colorIdentity?: string[]; power?: string | null; toughness?: string | null } = {}) {
  restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
  return renderToStaticMarkup(
    <CardPreview
      title="Soldier"
      cardType="token"
      supertype="Creature"
      subtypes={["Soldier"]}
      colorIdentity={(over.colorIdentity ?? ["white"]) as ["white"]}
      power={over.power === undefined ? "1" : over.power}
      toughness={over.toughness === undefined ? "1" : over.toughness}
      rarity="common"
      setIconUrl="https://example.test/icon.png"
      frameStyle={{ template: template as "m15token" }}
    />,
  );
}

/** The preview's rectStyle() as serialized markup. */
const rect = (r: Rect) => `position:absolute;top:${r.topPct}%;left:${r.leftPct}%;width:${r.widthPct}%;height:${r.heightPct}%`;

/** Every opening tag whose style starts with `rect`'s. */
function tagsAt(html: string, r: Rect): string[] {
  return (html.match(/<[a-z]+ [^>]*>/g) ?? []).filter((tag) => tag.includes(`style="${rect(r)}`));
}

describe("CardPreview — 2014–19 token frame (TODO 4.49 (a) + (d))", () => {
  it.each(["m15token", "m15tokenartifact"] as const)("%s: the P/T on M15's plate, in the bake's boxes", (template) => {
    const pt = getFrameProfile(template).pt!;
    // CC's plate box 0.13 %H lower, onto the prints' plate (2.7 px at HD),
    // and M15's value box (4.18) unmoved — what the bake measures.
    expect(pt.plateRect).toEqual({ topPct: 88.61, leftPct: 75.73, widthPct: 18.8, heightPct: 7.33 });
    expect(getFrameProfile("m15").pt!.plateRect).toEqual({ topPct: 88.48, leftPct: 75.73, widthPct: 18.8, heightPct: 7.33 });
    expect(pt.rect).toEqual(getFrameProfile("m15").pt!.rect);
    const html = markup(template, template === "m15tokenartifact" ? { colorIdentity: [] } : {});
    const plate = tagsAt(html, pt.plateRect!).filter((tag) => tag.startsWith("<img"));
    expect(plate).toHaveLength(1);
    expect(plate[0]).toContain(
      template === "m15token"
        ? 'src="https://b.example/frames/m15/pt/w.111111111111.png"'
        : 'src="https://b.example/frames/m15artifact/pt/c.333333333333.png"',
    );
    // The value centres in its own box, above the plate.
    const value = html.indexOf(">1/1</span>");
    expect(value).toBeGreaterThan(0);
    const box = html.lastIndexOf("<div ", value);
    expect(html.slice(box, value)).toContain(`style="${rect(pt.rect)};z-index:22`);
  });

  it("draws the coloured artifact token's plate from M15's artifact set (TC18 #7 Myr)", () => {
    const html = markup("m15tokenartifact", { colorIdentity: ["blue"] });
    expect(html).toContain('srcSet="https://b.example/frames/m15artifact/pt/u.666666666666.webp"');
  });

  it("draws no plate on a token without a P/T", () => {
    const html = markup("m15tokenartifact", { colorIdentity: [], power: null, toughness: null });
    expect(tagsAt(html, getFrameProfile("m15tokenartifact").pt!.plateRect!)).toEqual([]);
    expect(html).not.toContain("/pt/");
  });

  it.each(["m15token", "m15tokenartifact"] as const)(
    "%s: the type line from x 8.54 (card percent), the set symbol in its own right-anchored box",
    (template) => {
      const p = getFrameProfile(template);
      const html = markup(template);
      // The band: from 8.54 %W to the symbol box's right edge, start-aligned
      // (space-between with the line alone in it), not centred.
      const band = tagsAt(html, p.type.rect);
      expect(band).toHaveLength(1);
      expect(p.type.rect.leftPct).toBe(8.54);
      expect(band[0]).toContain("justify-content:space-between");
      expect(band[0]).not.toContain("justify-content:center");
      // The symbol: CC's box, on the prints (right edge 92.13 %W, centre
      // 84.78 %H), right-aligned and centred in it, holding the icon, and
      // none inline in the band.
      expect(p.symbolRect).toEqual({ topPct: 82.73, leftPct: 80.13, widthPct: 12, heightPct: 4.1 });
      const symbolBox = tagsAt(html, p.symbolRect!);
      expect(symbolBox).toHaveLength(1);
      expect(symbolBox[0]).toContain("align-items:center;justify-content:flex-end");
      const at = html.indexOf(symbolBox[0]);
      expect(html.indexOf('alt="Set icon"', at)).toBeGreaterThan(at);
      expect(html.match(/alt="Set icon"/g)).toHaveLength(1);
    },
  );
});
