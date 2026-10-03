// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 6.15 — "Print / download selected" in My Cards:
//   * the bulk bar offers it on your own cards AND on the Liked tab (where
//     the cards aren't yours, so it is the ONLY action);
//   * below Pro it opens the upgrade modal (the deck export's entitlement),
//     at Pro the print dialog;
//   * the dialog starts from the settings this browser used last, sends
//     them (and each card's copies) to the background exporter, and saves
//     them again.
// ---------------------------------------------------------------------------

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/cards/baked-card-thumbnail", () => ({
  BakedCardThumbnail: (props: { title: string }) => <div data-testid="thumb">{props.title}</div>,
}));
vi.mock("@/components/cards/render-update", () => ({ RenderUpdateBadge: () => null }));
vi.mock("@/components/cards/quick-like-button", () => ({ QuickLikeButton: () => null }));
vi.mock("@/lib/cards/preview-data", () => ({ cardToPreviewData: () => ({}) }));
vi.mock("@/lib/cards/actions", () => ({ updateCardsVisibilityAction: vi.fn(), deleteCardsAction: vi.fn() }));
const upgrade = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({ useUpgradeModal: () => upgrade }));
const exporter = vi.hoisted(() => ({ busy: false, start: vi.fn(), cancel: vi.fn(), openDetails: vi.fn(), active: null }));
vi.mock("@/components/decks/deck-export-provider", () => ({ useDeckExport: () => exporter }));

import { MyCardsBrowser } from "@/components/creator/my-cards-browser";
import { PrintSelectionDialog } from "@/components/cards/print-selection-dialog";
import { PRINT_SELECTION_SETTINGS_KEY } from "@/lib/cards/print-selection";
import { DEFAULT_MY_CARDS_SORT } from "@/lib/cards/my-cards-view";
import type { DashboardCard } from "@/components/creator/dashboard-card-tile";
import type { CardWithStats } from "@/lib/cards/queries";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = {
  rendered_image_url: null,
  rendered_thumb_url: null,
  supertype: null,
  card_type: "creature",
  subtypes: [],
  likes_count: 0,
  updated_at: "2026-09-28T10:00:00Z",
  created_at: "2026-09-28T10:00:00Z",
  parent_card_id: null,
};
const mine = [1, 2].map(
  (n) => ({ ...base, id: id(n), slug: `mine-${n}`, title: `Mine ${n}`, visibility: "public" }) as unknown as DashboardCard,
);
const liked = [3, 4].map(
  (n) =>
    ({
      ...base,
      id: id(n),
      slug: `liked-${n}`,
      title: `Liked ${n}`,
      visibility: "public",
      owner: { username: "someone", display_name: null },
      liked_by_viewer: true,
    }) as unknown as CardWithStats,
);

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

function browser(filter: "all" | "liked", canPrint: boolean) {
  render(
    <MyCardsBrowser
      cards={mine}
      likedCards={liked}
      remixParents={{}}
      initialView="grid"
      initialFilter={filter}
      initialSort={DEFAULT_MY_CARDS_SORT}
      canPrint={canPrint}
    />,
  );
}

const bar = () => screen.getByRole("region", { name: /selected/i });

// An in-memory localStorage (Node's own global one needs a backing file).
const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", localStorage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  upgrade.open.mockReset();
  exporter.start.mockReset();
  exporter.busy = false;
});

describe("My Cards — the Print / download bulk action", () => {
  it("your cards: Print / download sits beside the visibility and delete actions", async () => {
    browser("all", true);
    await click(screen.getByRole("button", { name: "Select Mine 1" }));
    const actions = within(bar());
    expect(actions.getByRole("button", { name: /print \/ download/i })).toBeTruthy();
    expect(actions.getByRole("button", { name: /make public/i })).toBeTruthy();
    expect(actions.getByRole("button", { name: /delete/i })).toBeTruthy();
  });

  it("the Liked tab can select too — and Print / download is its only action", async () => {
    browser("liked", true);
    await click(screen.getByRole("button", { name: /^select$/i }));
    // Select mode: a plain click on a liked card toggles it instead of opening it.
    await click(screen.getByRole("link", { name: "Select Liked 3" }));
    await click(screen.getByRole("button", { name: "Select Liked 4" }));
    const actions = within(bar());
    expect(screen.getByText("2 selected", { selector: "span" })).toBeTruthy();
    expect(actions.getByRole("button", { name: /print \/ download/i })).toBeTruthy();
    expect(actions.queryByRole("button", { name: /make public/i })).toBeNull();
    expect(actions.queryByRole("button", { name: /delete/i })).toBeNull();

    await click(actions.getByRole("button", { name: /print \/ download/i }));
    expect(screen.getByRole("dialog", { name: /print or download 2 cards/i })).toBeTruthy();
    const copies = within(screen.getByTestId("print-selection-copies"));
    expect(copies.getByText("Liked 3")).toBeTruthy();
    expect(copies.getByText("Liked 4")).toBeTruthy();
  });

  it("below Pro it opens the upgrade modal instead of the dialog, and says Pro", async () => {
    browser("all", false);
    await click(screen.getByRole("button", { name: "Select Mine 2" }));
    const print = within(bar()).getByRole("button", { name: /print \/ download/i });
    expect(print.textContent).toContain("Pro");
    await click(print);
    expect(upgrade.open).toHaveBeenCalledWith("batch_export");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("PrintSelectionDialog", () => {
  const cards = [
    { id: id(1), slug: "mine-1", title: "Mine 1" },
    { id: id(2), slug: "mine-2", title: "Mine 2" },
  ];
  const dialog = (onStarted = vi.fn()) => {
    const onOpenChange = vi.fn();
    render(<PrintSelectionDialog open onOpenChange={onOpenChange} cards={cards} onStarted={onStarted} />);
    return { onOpenChange, onStarted };
  };
  const chip = (group: string, label: RegExp) =>
    within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: label });

  it("starts from the defaults: Letter sheets, no gap, corner marks, 2.5 × 3.5 in, nine to a sheet", () => {
    dialog();
    expect(chip("Layout", /letter/i).getAttribute("aria-checked")).toBe("true");
    expect(chip("Spacing", /no gap/i).getAttribute("aria-checked")).toBe("true");
    expect(chip("Cut guides", /corner marks/i).getAttribute("aria-checked")).toBe("true");
    expect(chip("Card size", /2\.5 × 3\.5/).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("print-selection-summary").textContent).toContain("9 per sheet · 2 cards on 1 sheet");
  });

  it("remembers the last settings: opens with them, builds with them, per-card copies included", async () => {
    localStorage.setItem(
      PRINT_SELECTION_SETTINGS_KEY,
      JSON.stringify({ kind: "pdf", layout: "sheet-a4", gap: "sixteenth", marks: "lines", cardSize: "mm", bleed: true }),
    );
    const { onOpenChange, onStarted } = dialog();
    expect(chip("Layout", /a4/i).getAttribute("aria-checked")).toBe("true");
    expect(chip("Spacing", /1\/16/).getAttribute("aria-checked")).toBe("true");
    expect(chip("Cut guides", /full-length/i).getAttribute("aria-checked")).toBe("true");
    expect(chip("Card size", /63 × 88/).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("print-selection-bleed") as HTMLInputElement).checked).toBe(true);
    // A4 with the bleed turns the page: eight to a sheet.
    expect(screen.getByTestId("print-selection-summary").textContent).toContain("8 per sheet (landscape page)");

    await click(screen.getByRole("button", { name: "One more copy of Mine 2" }));
    await click(screen.getByRole("button", { name: "One more copy of Mine 2" }));
    await click(screen.getByRole("button", { name: /build pdf/i }));

    expect(exporter.start).toHaveBeenCalledWith({
      cards: [
        { id: id(1), copies: 1 },
        { id: id(2), copies: 3 },
      ],
      kind: "pdf",
      quality: "hd",
      layout: "sheet-a4",
      sheet: { gap: "sixteenth", marks: "lines", cardSize: "mm" },
      bleed: true,
      // A double-faced card's back comes along by default (TODO 5.3).
      includeBacks: true,
      titles: { [id(1)]: "Mine 1", [id(2)]: "Mine 2" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onStarted).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({
      layout: "sheet-a4",
      gap: "sixteenth",
      marks: "lines",
      cardSize: "mm",
      bleed: true,
    });
  });

  it("a choice made now is what the next open starts from", async () => {
    dialog();
    await click(chip("Output", /zip/i));
    await click(chip("Image size", /standard/i));
    await click(screen.getByRole("button", { name: /build zip/i }));
    expect(exporter.start).toHaveBeenCalledWith(expect.objectContaining({ kind: "zip", quality: "default", bleed: false }));
    cleanup();
    dialog();
    expect(chip("Output", /zip/i).getAttribute("aria-checked")).toBe("true");
    expect(chip("Image size", /standard/i).getAttribute("aria-checked")).toBe("true");
  });

  it("the bleed comes with HD images only; one-per-page ignores copies", async () => {
    dialog();
    await click(chip("Output", /zip/i));
    await click(chip("Image size", /standard/i));
    expect((screen.getByTestId("print-selection-bleed") as HTMLInputElement).disabled).toBe(true);
    await click(chip("Output", /print pdf/i));
    await click(chip("Layout", /one per page/i));
    expect(screen.queryByTestId("print-selection-copies")).toBeNull();
    expect(screen.getByTestId("print-selection-summary").textContent).toContain("2 pages, one card each");
  });

  it("a ZIP for MakePlayingCards (TODO 6.1): MPC's files, never the 1/8″ bleed on top — and remembered", async () => {
    localStorage.setItem(PRINT_SELECTION_SETTINGS_KEY, JSON.stringify({ kind: "zip", quality: "hd", bleed: true }));
    dialog();
    expect((screen.getByTestId("print-selection-bleed") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("print-selection-mpc")).toBeNull();
    await click(chip("Image size", /makeplayingcards/i));
    const bleed = screen.getByTestId("print-selection-bleed") as HTMLInputElement;
    expect(bleed.disabled).toBe(true);
    expect(bleed.checked).toBe(false);
    expect(screen.getByText("MakePlayingCards files carry MPC's own bleed.")).toBeTruthy();
    expect(screen.getByTestId("print-selection-mpc").textContent).toContain("822 × 1122 at 300 dpi");
    await click(screen.getByRole("button", { name: /build zip/i }));
    expect(exporter.start).toHaveBeenCalledWith(expect.objectContaining({ kind: "zip", quality: "mpc", bleed: false }));
    expect(JSON.parse(localStorage.getItem(PRINT_SELECTION_SETTINGS_KEY)!)).toMatchObject({ quality: "mpc" });
    cleanup();
    dialog();
    expect(chip("Image size", /makeplayingcards/i).getAttribute("aria-checked")).toBe("true");
  });

  it("the copies field can be cleared and retyped (it used to snap back to 1, so 1 → ⌫ → 5 read 15)", async () => {
    dialog();
    const field = screen.getByRole("spinbutton", { name: "Copies of Mine 1" }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "" } });
    });
    expect(field.value).toBe("");
    await act(async () => {
      fireEvent.change(field, { target: { value: "5" } });
    });
    expect(field.value).toBe("5");
    await act(async () => {
      fireEvent.blur(field);
    });
    expect(field.value).toBe("5");
    await click(screen.getByRole("button", { name: /build pdf/i }));
    expect(exporter.start).toHaveBeenCalledWith(
      expect.objectContaining({
        cards: [
          { id: id(1), copies: 5 },
          { id: id(2), copies: 1 },
        ],
      }),
    );
  });

  it("a running export blocks a second one", () => {
    exporter.busy = true;
    dialog();
    expect((screen.getByRole("button", { name: /build pdf/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/already running/i)).toBeTruthy();
  });
});
