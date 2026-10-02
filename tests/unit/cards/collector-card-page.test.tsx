// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardDetails, buildCardJsonLd, collectorLineText } from "@/components/cards/card-detail-content";
import { cardGlyphFields, drawsCollectorLine } from "@/lib/validation/card-glyphs";

// ---------------------------------------------------------------------------
// TODO 4.9b — the public card page says what the render prints: the Card
// details block and the CreativeWork's caption gain "Set · Number ·
// Language" ONLY when the card draws the collector line (its switch names
// a style and its template has the slot); a card whose line is off or
// absent says nothing about a printing. And the creator's glyph warnings
// read the footer mark in the body face on a collector card.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(() => cleanup());

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Sheoldred, the Apocalypse",
  slug: "sheoldred-the-apocalypse",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  rendered_at: null,
  flavor_text: null,
  rules_text: "Deathtouch",
  artist_credit: "Chris Rahn",
  cost: "{2}{B}{B}",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["Phyrexian", "Praetor"],
  rarity: "mythic",
  color_identity: ["black"],
  power: "4",
  toughness: "5",
  loyalty: null,
  defense: null,
  set_icon_code: "dmu",
  layout: "normal",
  tags: ["phyrexian"],
  set_code: "DMU",
  collector_number: "107/281",
  lang: "es",
};

describe("collectorLineText", () => {
  it("the printed pieces in the card's style, only while the line is drawn", () => {
    expect(collectorLineText({ ...base, frame_style: { template: "m15", collector: "2015" } })).toBe("DMU · 107/281 · Spanish");
    expect(collectorLineText({ ...base, frame_style: { template: "m15", collector: "2023" } })).toBe("DMU · 0107 · Spanish");
    expect(collectorLineText({ ...base, lang: "en", collector_number: "9", frame_style: { template: "m15pw", collector: "2023" } })).toBe("DMU · 0009 · English");
    expect(collectorLineText({ ...base, set_code: null, lang: "he", frame_style: { template: "m15", collector: "2015" } })).toBe("107/281");
    expect(collectorLineText({ ...base, set_code: null, collector_number: null, lang: "he", frame_style: { template: "m15", collector: "2015" } })).toBeNull();
    for (const frame_style of [{ template: "m15" }, { template: "m15", collector: "off" }, { template: "m15borderless", collector: "2023" }, null, undefined]) {
      expect(collectorLineText({ ...base, frame_style }), JSON.stringify(frame_style)).toBeNull();
    }
  });
});

describe("the Card details block and the CreativeWork", () => {
  it("carry the line when it is drawn, and nothing of it otherwise", () => {
    const on = render(<CardDetails card={{ ...base, frame_style: { template: "m15", collector: "2015" } }} inDecks={[]} />).container;
    expect(on.textContent).toContain("Collector line");
    expect(on.textContent).toContain("DMU · 107/281 · Spanish");
    cleanup();
    const off = render(<CardDetails card={{ ...base, frame_style: { template: "m15" } }} inDecks={[]} />).container;
    expect(off.textContent).not.toContain("Collector line");
    expect(off.textContent).not.toContain("107/281");

    const args = { inDecks: [], username: "kesh", ownerDisplay: "Kesh", siteBase: "https://pipglyph.com" };
    const drawn = buildCardJsonLd({ ...args, card: { ...base, frame_style: { template: "m15", collector: "2015" } } });
    expect((drawn.image as { caption: string }).caption).toContain("collector line DMU · 107/281 · Spanish");
    expect(String(drawn.keywords)).toContain("dmu");
    const plain = buildCardJsonLd({ ...args, card: { ...base, frame_style: { template: "m15" } } });
    expect((plain.image as { caption: string }).caption).not.toContain("collector line");
    expect(String(plain.keywords).split(", ")).not.toContain("dmu");
  });
});

describe("the glyph warnings on a collector card", () => {
  const values = {
    title: "Kesh",
    supertype: "",
    subtypes_text: "",
    rules_text: "",
    flavor_text: "",
    power: "",
    toughness: "",
    loyalty: "",
    defense: "",
    artist_credit: "Chris Rahn",
    footer_text: "forged by kesh",
    saga_intro: "",
    has_back_face: false,
    back_face: { title: "", supertype: "", subtypes_text: "", rules_text: "", flavor_text: "", power: "", toughness: "", loyalty: "", defense: "" },
  };

  it("read the footer mark in the body face as typed, and the artist in the display face as capitals", () => {
    expect(drawsCollectorLine({ template: "m15", collector: "2023" })).toBe(true);
    expect(drawsCollectorLine({ template: "m15", collector: "off" })).toBe(false);
    expect(drawsCollectorLine({ template: "m15borderless", collector: "2023" })).toBe(false);
    expect(drawsCollectorLine({ template: "regular", collector: "2015" })).toBe(true); // a legacy template draws m15
    expect(drawsCollectorLine(null)).toBe(false);
    const on = cardGlyphFields({ ...values, frame_style: { template: "m15", collector: "2023" } });
    expect(on.find((f) => f.label === "Footer mark")).toEqual({ label: "Footer mark", face: "body", value: "forged by kesh" });
    expect(on.find((f) => f.label === "Artist")).toEqual({ label: "Artist", face: "display", value: "Chris Rahn", uppercase: true });
    const off = cardGlyphFields({ ...values, frame_style: { template: "m15" } });
    expect(off.find((f) => f.label === "Footer mark")).toEqual({ label: "Footer mark", face: "display", value: "forged by kesh", uppercase: true });
    expect(cardGlyphFields(values).find((f) => f.label === "Footer mark")?.face).toBe("display");
  });
});
