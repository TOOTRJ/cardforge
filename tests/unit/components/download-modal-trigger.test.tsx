// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The download modal's trigger (2026-11-02 hydration fix). The card page — a
// SERVER component — used to hand the modal a <Button> ELEMENT as its
// trigger, which the modal put under Radix's `DialogTrigger asChild`. In dev
// React Flight sends such an element as a lazy reference, and Radix's Slot
// renders NOTHING for a child that fails `React.isValidElement`: whether the
// server drew the Download button was a race, and hydration failed. The
// trigger is now its look as PROPS, and the modal builds the button itself.
// ---------------------------------------------------------------------------

vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { DownloadModal } from "@/components/cards/download-modal";

afterEach(cleanup);

const root = process.cwd();

/** The props of the first `<Tag … />` in a source, up to its closing `/>`. */
function jsxPropsOf(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("/>", start);
  return source.slice(start + tag.length + 1, end);
}

/** Every .tsx file under a directory. */
function tsxFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(dir, f));
}

const isClientModule = (source: string) => /^\s*["']use client["']/.test(source);

describe("the card page's Download trigger", () => {
  it("passes DownloadModal no element — its trigger is plain props", () => {
    const page = readFileSync(join(root, "components/cards/card-detail-content.tsx"), "utf8");
    expect(isClientModule(page)).toBe(false);
    const props = jsxPropsOf(page, "DownloadModal")
      // Comments may name an element; the props may not hold one.
      .replace(/\/\/.*$/gm, "");
    expect(props).not.toMatch(/<[A-Za-z]/);
    expect(props).toMatch(/trigger=\{\{\s*variant:/);
  });

  it("no server component hands a client component a trigger ELEMENT", () => {
    const offenders = [...tsxFiles("app"), ...tsxFiles("components")].filter((file) => {
      const source = readFileSync(join(root, file), "utf8");
      return !isClientModule(source) && /\btrigger=\{\s*</.test(source);
    });
    expect(offenders).toEqual([]);
  });
});

describe("DownloadModal's trigger button", () => {
  it("is an outline “Download” button by default, and opens the modal", async () => {
    render(<DownloadModal cardId="c1" cardSlug="grizzly" />);
    const button = screen.getByRole("button", { name: "Download" });
    expect(button.className).toContain("border-border");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // One text node, as the hand-written button had: no split " " + "Download".
    expect([...button.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent)).toEqual([" Download"]);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByRole("dialog", { name: "Download this card" })).toBeTruthy();
  });

  it("takes the card page's look: variant, size, classes and label", () => {
    render(
      <DownloadModal
        cardId="c1"
        cardSlug="grizzly"
        trigger={{ variant: "primary", size: "lg", className: "w-full sm:w-auto", label: "Get it" }}
      />,
    );
    const button = screen.getByRole("button", { name: "Get it" });
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("h-12");
    expect(button.className).toContain("w-full");
    expect(button.className).toContain("sm:w-auto");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });
});
