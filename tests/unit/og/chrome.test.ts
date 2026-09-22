import { describe, expect, it } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  BrandLockup,
  OgBody,
  OgCoverHero,
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

  it("the shell, the home card, the cover hero and the copy primitives are clean", () => {
    expect(undefinedStyleKeys(OgShell({ children: OgBody({ children: "hello" }) }))).toEqual([]);
    expect(undefinedStyleKeys(HomeOgCard())).toEqual([]);
    expect(
      undefinedStyleKeys(
        OgCoverHero({ cover: "data:image/png;base64,", eyebrow: "Deck", title: "T", byline: "by @x" }),
      ),
    ).toEqual([]);
    expect(undefinedStyleKeys(BrandLockup({}))).toEqual([]);
    expect(undefinedStyleKeys(OgBody({ children: "x", tone: "dim" }))).toEqual([]);
  });
});
