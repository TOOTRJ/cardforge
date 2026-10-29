// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameSystem } from "@/types/card";

// ---------------------------------------------------------------------------
// A piece of creator chrome the owner saw on the live site while an AI
// generation ran (2026-10-28):
//
//   1. The busy overlays dim and blur EVERYTHING they cover. The card's
//      cost pips, set symbol, P/T plate, collector line and inline pips sit
//      at z 20–50 inside CardPreview and drew sharp over the "Designing…"
//      dim (z-10). Each covered box is now its own stacking context
//      (`isolate`) and the overlay is z-[100] inside it — above every
//      z-index the card or the form draws, never above the page around it.
//      Verified on a forced pending state (dev server, jobs API held open):
//      before, five card pieces painted above the overlay; after, none.
//
// CardPreview's drawing is untouched (parity): only its wrappers changed.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/create",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/billing/credit-confirm-provider", () => ({ useCreditConfirm: () => async () => true }));
vi.mock("@/lib/cards/actions", () => ({ createCardAction: vi.fn(), updateCardAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: ({ onGenerate }: { onGenerate: (options: Record<string, unknown>) => void }) => (
    <button type="button" data-testid="run-fill" onClick={() => onGenerate({ want: ["title", "art"] })}>
      run fill
    </button>
  ),
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: "33333333-3333-4333-8333-333333333333", slug: "mtg", name: "Magic" } as unknown as GameSystem];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderForm = () =>
  render(<CardCreatorForm mode="create" userId={USER} ownerUsername="tester" gameSystems={GAME_SYSTEMS} aiConfigured verifiedFrameKeys={["m15/w"]} />);

describe("the busy overlays cover everything they dim", () => {
  it("the card's overlay and the form's are z-[100] inside an isolated box that holds what they cover", async () => {
    // The jobs API never answers: the form stays "Designing…".
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderForm();
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-fill"));
    });
    const cardOverlays = await waitFor(() => {
      const found = screen.getAllByTestId("card-generating-overlay");
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const overlay of cardOverlays) {
      expect(overlay.className).toContain("z-[100]");
      const box = overlay.parentElement!;
      expect(box.className.split(/\s+/)).toContain("isolate");
      expect(box.querySelector('[data-testid="card-preview"]')).not.toBeNull();
    }
    const fill = screen.getByTestId("fill-overlay");
    expect(fill.className).toContain("z-[100]");
    expect(fill.parentElement!.className.split(/\s+/)).toContain("isolate");
  });

  it("z-[100] is above every z-index the card components draw", () => {
    const dir = join(process.cwd(), "components/cards");
    const values: number[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const match of source.matchAll(/zIndex:\s*(\d+)|\bz-(\d+)\b|\bz-\[(\d+)\]/g)) {
        values.push(Number(match[1] ?? match[2] ?? match[3]));
      }
    }
    expect(values.length).toBeGreaterThan(10);
    expect(Math.max(...values)).toBeLessThan(100);
  });
});
