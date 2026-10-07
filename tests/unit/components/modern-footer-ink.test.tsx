// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import type { ColorIdentity } from "@/types/card";
import { footerInk, getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The 2003 frame's artist line in the PREVIEW (TODO 4.23a, layout v44): the
// same footerInk() on frameMasterKey's master as the bake — white on
// `modern`/b and on every `modernland` key, the slot's dark ink elsewhere,
// no shadow. The bake half is pinned on real bakes in
// tests/unit/render/modern-footer-ink.test.tsx.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const COLOR: Record<string, ColorIdentity[]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  m: ["white", "blue"],
};

/** "#rrggbb" or "rgb(r, g, b)" → [r, g, b]. */
function rgb(value: string): number[] {
  const m = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return m.slice(1).map((h) => parseInt(h, 16));
  return (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

function renderOn(template: "modern" | "modernland", key: string) {
  const land = template === "modernland";
  const { container } = render(
    <CardPreview
      title="Ink Probe"
      cost={land ? null : "{2}{B}"}
      cardType={land ? "land" : "creature"}
      subtypes={land ? [] : ["Zombie"]}
      colorIdentity={COLOR[key]}
      power={land ? null : "2"}
      toughness={land ? null : "2"}
      artistCredit="Douglas Schuler"
      frameStyle={{ template }}
    />,
  );
  const spans = [...container.querySelectorAll("span")];
  // The display lines' words are joined by no-break spaces (displayLine).
  const text = (s: Element) => s.textContent?.replace(/\s+/g, " ") ?? "";
  const footer = spans.find((s) => text(s) === "Art: Douglas Schuler")?.parentElement as HTMLElement;
  const name = spans.find((s) => text(s) === "Ink Probe") as HTMLElement;
  const pt = spans.find((s) => s.textContent === "2/2") as HTMLElement | undefined;
  const frame = container.querySelector<HTMLElement>("[data-frame-key]");
  return { footer, name, pt, frame };
}

describe("CardPreview — the 2003 footer ink (the same footerInk as the bake)", () => {
  it.each(Object.keys(COLOR))("modern %s", (key) => {
    const layout = getFrameProfile("modern");
    const { footer, name, pt, frame } = renderOn("modern", key);
    expect(frame?.dataset.frameKey).toBe(key);
    const ink = footerInk(layout.footer!, key, layout);
    expect(rgb(footer.style.color)).toEqual(rgb(ink.colorHex));
    expect(rgb(footer.style.color)).toEqual(key === "b" ? [255, 255, 255] : rgb(layout.footer!.colorHex));
    expect(footer.style.textShadow).toBe("");
    // The name and the P/T keep the dark ink on every colour.
    expect(name.style.color).toBe("");
    expect(rgb((name.parentElement as HTMLElement).style.color)).toEqual(rgb(layout.title.colorHex));
    expect(rgb(pt!.style.color)).toEqual(rgb(layout.pt!.colorHex));
  });

  it.each(Object.keys(COLOR))("modernland %s: white on the one brown land frame", (key) => {
    const layout = getFrameProfile("modernland");
    const { footer, name, frame } = renderOn("modernland", key);
    expect(frame?.dataset.frameKey).toBe(key);
    expect(rgb(footer.style.color)).toEqual([255, 255, 255]);
    expect(rgb(footer.style.color)).toEqual(rgb(footerInk(layout.footer!, key, layout).colorHex));
    expect(footer.style.textShadow).toBe("");
    expect(name.style.color).toBe("");
    expect(rgb((name.parentElement as HTMLElement).style.color)).toEqual(rgb(layout.title.colorHex));
  });
});
