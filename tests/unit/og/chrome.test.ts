import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  BrandLockup,
  OgBody,
  OgDeckHero,
  OgGlow,
  OgShell,
} from "@/lib/og/chrome";
import { HomeOgCard } from "@/lib/og/home-card";

// ---------------------------------------------------------------------------
// Satori (next/og) calls .trim() on every style value, so a single
// `undefined` in a style object crashes the whole image. That took every OG
// image down once (OgGlow spread its absent anchor as `right: undefined`).
// This walks the element trees the chrome produces — expanding the plain
// function components — and asserts no style key is undefined.
// ---------------------------------------------------------------------------

type AnyProps = { style?: Record<string, unknown>; children?: ReactNode };

function undefinedStyleKeys(node: ReactNode, path = ""): string[] {
  if (Array.isArray(node)) return node.flatMap((child) => undefinedStyleKeys(child, path));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<AnyProps>;
  const name =
    typeof element.type === "function"
      ? ((element.type as { name?: string }).name ?? "component")
      : String(element.type);
  const here = `${path}/${name}`;
  const found: string[] = [];
  for (const [key, value] of Object.entries(element.props.style ?? {})) {
    if (value === undefined) found.push(`${here}.${key}`);
  }
  const rendered =
    typeof element.type === "function"
      ? (element.type as (props: AnyProps) => ReactNode)(element.props)
      : element.props.children;
  return found.concat(undefinedStyleKeys(rendered, here));
}

describe("OG chrome is Satori-safe (no undefined style values)", () => {
  it("OgGlow only emits the anchor it was given", () => {
    expect(undefinedStyleKeys(OgGlow({ top: -120, left: -80 }))).toEqual([]);
    expect(
      undefinedStyleKeys(OgGlow({ top: -140, right: -60, size: 640, color: "rgba(0,0,0,0.2)" })),
    ).toEqual([]);
  });

  it("the shell, the home card, the deck hero and the copy primitives are clean", () => {
    expect(undefinedStyleKeys(OgShell({ children: OgBody({ children: "hello" }) }))).toEqual([]);
    expect(undefinedStyleKeys(HomeOgCard())).toEqual([]);
    // The deck share image (TODO DK6.6): with or without a cover, with no
    // card, one, and the full fan of five (more are cut to five).
    for (const cover of ["data:image/png;base64,", null]) {
      for (const count of [0, 1, 3, 5, 7]) {
        const cards = Array.from({ length: count }, (_, i) => ({ src: "data:image/png;base64,", landscape: i === 1 }));
        expect(
          undefinedStyleKeys(OgDeckHero({ cover, cards, eyebrow: "Commander deck", title: "T", byline: "by @x" })),
          `${cover ? "cover" : "no cover"}, ${count} cards`,
        ).toEqual([]);
      }
    }
    expect(undefinedStyleKeys(BrandLockup({}))).toEqual([]);
    expect(undefinedStyleKeys(OgBody({ children: "x", tone: "dim" }))).toEqual([]);
  });
});

describe("the deck share image's fan (TODO DK6.6)", () => {
  const imagesOf = (node: ReactNode): string[] => {
    if (Array.isArray(node)) return node.flatMap(imagesOf);
    if (!isValidElement(node)) return [];
    const element = node as ReactElement<{ src?: string; children?: ReactNode }>;
    const here = element.type === "img" && element.props.src ? [element.props.src] : [];
    const rendered =
      typeof element.type === "function"
        ? (element.type as (props: unknown) => ReactNode)(element.props)
        : element.props.children;
    return here.concat(imagesOf(rendered));
  };

  it("draws at most five cards, back to front — the first card (the commander) LAST, on top (Satori has no z-index)", () => {
    const cards = ["one", "two", "three", "four", "five", "six"].map((name) => ({ src: `data:image/png;base64,${name}`, landscape: false }));
    const drawn = imagesOf(OgDeckHero({ cover: null, cards, eyebrow: "Deck", title: "T", byline: "b" }));
    const fan = drawn.filter((src) => src.startsWith("data:image/png;base64,") && !src.endsWith(","));
    expect(fan).toHaveLength(5);
    expect(fan.at(-1)).toBe(cards[0].src);
    expect(fan).not.toContain(cards[5].src);
  });

  it("letterboxes a landscape card (Battle, Split) whole in its portrait slot — never a portrait crop", () => {
    const tree = OgDeckHero({
      cover: null,
      cards: [{ src: "data:image/png;base64,battle", landscape: true }],
      eyebrow: "Deck",
      title: "T",
      byline: "b",
    });
    const find = (node: ReactNode): ReactElement<{ src?: string; width?: number; height?: number }> | null => {
      if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null;
      if (!isValidElement(node)) return null;
      const element = node as ReactElement<{ src?: string; width?: number; height?: number; children?: ReactNode }>;
      if (element.type === "img" && element.props.src === "data:image/png;base64,battle") return element;
      const rendered =
        typeof element.type === "function"
          ? (element.type as (props: unknown) => ReactNode)(element.props)
          : element.props.children;
      return find(rendered);
    };
    const image = find(tree)!;
    // 7:5, as wide as the slot.
    expect(image.props.width! / image.props.height!).toBeCloseTo(7 / 5, 1);
  });
});
