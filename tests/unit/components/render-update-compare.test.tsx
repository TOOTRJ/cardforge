// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/cards/render-actions", () => ({
  listStaleOwnCardsAction: vi.fn(),
  rebakeOwnCardAction: vi.fn(),
}));

import { RenderUpdateNotice } from "@/components/cards/render-update";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 3.26 — the render-update compare view: "Current image" (the stored
// bake) draws the same card box as the live "After update" preview beside it,
// with the ONE card corner — not a fixed 20 px radius cutting into a rounded
// bake, and never a landscape bake letterboxed square in a 5:7 box.
// ---------------------------------------------------------------------------

afterEach(cleanup);

function openCompare(template: string) {
  render(
    <RenderUpdateNotice
      card={{
        id: "00000000-0000-4000-8000-000000000001",
        title: "Probe",
        renderedImageUrl: "/renders/probe.png",
        previewData: { title: "Probe", frameStyle: { template } } as CardPreviewData,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /compare/i }));
  const current = document.querySelector('[data-testid="compare-current-image"]') as HTMLElement;
  expect(current).not.toBeNull();
  return { current, classes: new Set(current.className.split(/\s+/)) };
}

describe("render-update CompareView corners", () => {
  it("portrait: a 5:7 box with .card-corners and the image on #101015", () => {
    const { current, classes } = openCompare("m15");
    expect(classes.has("aspect-[5/7]")).toBe(true);
    expect(classes.has("card-corners")).toBe(true);
    expect(classes.has("rounded-frame")).toBe(false);
    expect(current.querySelector("img")?.className).toContain("bg-[#101015]");
  });

  it("landscape: a 7:5 box with the landscape corner, like the live preview beside it", () => {
    const { classes } = openCompare("battle");
    expect(classes.has("aspect-[7/5]")).toBe(true);
    expect(classes.has("card-corners-landscape")).toBe(true);
    expect(classes.has("card-corners")).toBe(false);
    expect(classes.has("aspect-[5/7]")).toBe(false);
  });
});
