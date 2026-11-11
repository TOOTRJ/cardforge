// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { StudioSymbol } from "@/lib/tools/set-symbol/model";

// ---------------------------------------------------------------------------
// The one moment of Set Symbol Studio no server action sees and the browser
// can say safely — a saved symbol's PNG opened in a new tab — goes to the
// tool's log from the browser (lib/tools/track-client.ts trackToolEvent):
// `open_png` with the symbol's kind only, never its name, its description
// or its id. (The two "New card with this…" links navigate and are not
// logged from the browser — see the note in studio-workspace.tsx. The
// server's side is set-symbol-events.test.ts.)
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/tools/set-symbol-studio/studio-symbol-picker", () => ({ forgetStudioSymbols: vi.fn() }));
vi.mock("@/lib/tools/set-symbol/browser", () => ({
  decodeForPreview: vi.fn(),
  decodeUrlForPreview: vi.fn(),
  previewLooks: vi.fn(),
}));
vi.mock("@/lib/tools/set-symbol/actions", () => ({
  deleteSymbolAction: vi.fn(),
  recutSymbolAction: vi.fn(),
  renameSymbolAction: vi.fn(),
  uploadSymbolAction: vi.fn(),
}));
vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: h.track }));

import { SetSymbolStudio } from "@/components/tools/set-symbol-studio/studio-workspace";

const file = (look: string) => `https://x.supabase.co/storage/v1/object/public/set-covers/u1/sym-v-${look}.png`;

const symbol = (patch: Partial<StudioSymbol> = {}): StudioSymbol => ({
  id: "00000000-0000-4000-8000-0000000000b1",
  name: "Moonlight",
  source: "ai",
  prompt: "a cracked moon above a lighthouse",
  settings: { mode: "edges", tolerance: 40, ink: "one" },
  files: {
    auto: file("auto"),
    common: file("common"),
    uncommon: file("uncommon"),
    rare: file("rare"),
    mythic: file("mythic"),
    plain: file("plain"),
    watermark: file("watermark"),
    source: file("source"),
  },
  legibility: 0.8,
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  ...patch,
});

beforeEach(() => h.track.mockReset());
afterEach(cleanup);

/** The "Open the PNG" link, clicked without the test window following it
 *  (happy-dom would fetch the picture). */
function clickPng(): HTMLAnchorElement {
  const png = screen.getByText("Open the PNG").closest("a")!;
  png.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(png);
  return png;
}

describe("Set Symbol Studio — the clicks the browser logs", () => {
  it("the PNG opened — for a picture the maker brought, said so", () => {
    render(<SetSymbolStudio initialSymbols={[symbol({ source: "upload", prompt: null })]} aiReady />);
    const png = clickPng();
    expect(png.getAttribute("href")).toBe(file("plain"));
    expect(png.getAttribute("target")).toBe("_blank");
    expect(h.track.mock.calls).toEqual([["set-symbol-studio", "open_png", { source: "upload" }]]);
  });

  it("never the symbol's name, its description or its id; nothing until the click", () => {
    render(<SetSymbolStudio initialSymbols={[symbol()]} aiReady />);
    expect(h.track).not.toHaveBeenCalled();
    clickPng();
    expect(h.track.mock.calls).toEqual([["set-symbol-studio", "open_png", { source: "ai" }]]);
    expect(JSON.stringify(h.track.mock.calls)).not.toMatch(/Moonlight|moon|lighthouse|0000-4000|\.png/i);
  });
});
