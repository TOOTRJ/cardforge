// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck UI's quick fixes (deck audit 2026-10-28; TODO DK0.5, DK0.7,
// DK0.10, DK0.12):
//  - "Link an existing card" draws each card's 600 px thumb, never its HD
//    PNG (up to 24 × ~3 MB per open);
//  - "Copy decklist" is the header's free control (plain + Arena);
//  - `?import=1` leaves the address bar once the import dialog is open;
//  - a review row's Board change keeps the row (and the focus);
//  - the deck delete confirm is the site's Radix dialog: focus back on the
//    trigger when it closes, and nothing closes it mid-delete.
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
// next/image's optimizer URL is not this test's business: what it was asked
// to draw is.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <span data-testid="next-image" data-src={src} aria-label={alt} />,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
const deckCardActions = vi.hoisted(() => ({
  linkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(),
  removeDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  updateDeckCardAction: vi.fn(),
}));
vi.mock("@/lib/decks/card-actions", () => deckCardActions);
const deckActions = vi.hoisted(() => ({ deleteDeckAction: vi.fn() }));
vi.mock("@/lib/decks/actions", () => deckActions);
const importActions = vi.hoisted(() => ({ resolveDecklistAction: vi.fn(), commitDeckImportAction: vi.fn() }));
vi.mock("@/lib/decks/import", () => importActions);

import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { DeckCopyDecklist } from "@/components/decks/deck-copy-decklist";
import { DeleteDeckDialog } from "@/components/decks/delete-deck-dialog";
import { ImportDecklistDialog } from "@/components/decks/import-decklist-dialog";
import type { DeckItem } from "@/lib/decks/queries";

const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const fn of [
    ...Object.values(router),
    ...Object.values(toast),
    ...Object.values(deckCardActions),
    ...Object.values(deckActions),
    ...Object.values(importActions),
  ]) {
    fn.mockReset();
  }
});

async function click(el: Element) {
  await act(async () => {
    fireEvent.click(el);
  });
}

describe("DK0.5 — \"Link an existing card\" draws thumbnails", () => {
  const realEntry = {
    entry: {
      id: "22222222-2222-4222-8222-222222222222",
      deck_id: "33333333-3333-4333-8333-333333333333",
      card_id: null,
      scryfall_id: "sf-1",
      name: "Lightning Bolt",
      quantity: 4,
      board: "main",
      type_line: "Instant",
      mana_cost: "{R}",
      image_url: null,
      set_code: "m11",
      collector_number: "149",
    },
    card: null,
  } as unknown as DeckItem;

  it("each tile is the bake's 600 px WebP; a bake with no thumb goes through next/image; never the HD PNG raw", async () => {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "44444444-4444-4444-8444-444444444444";
    deckCardActions.listMyCardsLiteAction.mockResolvedValue({
      ok: true,
      cards: [
        { id: A, title: "Bolt of Ember", slug: "bolt-of-ember", rendered_image_url: `${RENDERS}/${A}.png?v=2`, rendered_thumb_url: `${RENDERS}/${A}.thumb.webp?v=2` },
        { id: B, title: "Old Bake", slug: "old-bake", rendered_image_url: `${RENDERS}/${B}.png?v=1`, rendered_thumb_url: null },
        { id: "c", title: "Never Baked", slug: "never-baked", rendered_image_url: null, rendered_thumb_url: null },
      ],
    });
    render(<DeckCardModal item={realEntry} ownerUsername="kesh" canManage open onOpenChange={() => {}} preferProxy />);
    await click(screen.getByRole("button", { name: /link an existing card/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Bolt of Ember/ })).toBeTruthy());

    const tile = (title: RegExp) => screen.getByRole("button", { name: title });
    expect(tile(/Bolt of Ember/).querySelector("img")?.getAttribute("src")).toBe(`/render-cdn/owner-1/${A}.thumb.webp?v=2`);
    expect(tile(/Old Bake/).querySelector("img")).toBeNull();
    expect(tile(/Old Bake/).querySelector("[data-testid=next-image]")?.getAttribute("data-src")).toBe(`${RENDERS}/${B}.png?v=1`);
    expect(tile(/Never Baked/).querySelector("img, [data-testid=next-image]")).toBeNull();
    // No <img> anywhere in the picker draws a PNG.
    for (const img of Array.from(document.querySelectorAll("img"))) {
      expect(img.getAttribute("src") ?? "").not.toMatch(/\.png/);
    }
  });
});

describe("DK0.7 — Copy decklist", () => {
  it("copies the plain list or the Arena list, then closes", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<DeckCopyDecklist plainText={"4 Lightning Bolt\n20 Mountain"} arenaText={"About\nName Burn\n\nDeck\n4 Lightning Bolt (M11) 149"} />);

    await click(screen.getByRole("button", { name: "Copy decklist" }));
    await click(screen.getByRole("button", { name: "Plain text" }));
    expect(writeText).toHaveBeenLastCalledWith("4 Lightning Bolt\n20 Mountain");
    expect(toast.success).toHaveBeenLastCalledWith("Decklist copied to your clipboard.");
    expect(screen.queryByRole("button", { name: "Plain text" })).toBeNull();

    await click(screen.getByRole("button", { name: "Copy decklist" }));
    await click(screen.getByRole("button", { name: "Arena format" }));
    expect(writeText).toHaveBeenLastCalledWith("About\nName Burn\n\nDeck\n4 Lightning Bolt (M11) 149");
  });
});

describe("DK0.10 / DK0.12 — the import dialog", () => {
  it("?import=1 leaves the address bar once the dialog has opened (a reload doesn't reopen it)", async () => {
    window.history.replaceState(null, "", "/deck/kesh/burn?import=1&via=x");
    render(<ImportDecklistDialog deckId="d1" defaultOpen />);
    expect(screen.getByRole("dialog", { name: "Import a decklist" })).toBeTruthy();
    expect(router.replace).toHaveBeenCalledWith("/deck/kesh/burn?via=x", { scroll: false });
  });

  it("without the flag, nothing is replaced", () => {
    window.history.replaceState(null, "", "/deck/kesh/burn");
    render(<ImportDecklistDialog deckId="d1" defaultOpen />);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a review row's Board change keeps the row — and the focus on its select", async () => {
    window.history.replaceState(null, "", "/deck/kesh/burn");
    importActions.resolveDecklistAction.mockResolvedValue({
      ok: true,
      title: null,
      parseWarnings: [],
      lines: [
        { line: 1, raw: "4 Lightning Bolt", name: "Lightning Bolt", quantity: 4, board: "main", status: "unresolved", resolved: null },
        { line: 2, raw: "20 Mountain", name: "Mountain", quantity: 20, board: "main", status: "unresolved", resolved: null },
      ],
    });
    render(<ImportDecklistDialog deckId="d1" defaultOpen />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Decklist text" }), { target: { value: "4 Lightning Bolt\n20 Mountain" } });
    });
    await click(screen.getByRole("button", { name: /preview import/i }));
    const select = (await screen.findByRole("combobox", { name: "Board for Lightning Bolt" })) as HTMLSelectElement;
    select.focus();
    await act(async () => {
      fireEvent.change(select, { target: { value: "side" } });
    });
    expect(select.isConnected).toBe(true);
    expect(select.value).toBe("side");
    expect(document.activeElement).toBe(select);
    expect(screen.getByRole("combobox", { name: "Board for Lightning Bolt" })).toBe(select);
  });
});

describe("DK0.12 — the deck delete confirm", () => {
  it("is a dialog named by its question; Escape closes it and the focus goes back to the trigger", async () => {
    render(<DeleteDeckDialog deckId="d1" deckTitle="Burn" />);
    const trigger = screen.getByRole("button", { name: /delete deck/i });
    trigger.focus();
    await click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Delete this deck?" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Radix hands the focus back on the tick after the unmount.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("stays open while the delete is in flight — Escape and the corner X do nothing", async () => {
    let finish: (value: { ok: true }) => void = () => {};
    deckActions.deleteDeckAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DeleteDeckDialog deckId="d1" deckTitle="Burn" />);
    await click(screen.getByRole("button", { name: /delete deck/i }));
    const dialog = screen.getByRole("dialog");
    await click(screen.getByRole("button", { name: "Delete deck" }));
    expect(deckActions.deleteDeckAction).toHaveBeenCalledWith("d1");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      finish({ ok: true });
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard/decks"));
    expect(toast.success).toHaveBeenCalledWith("Deleted Burn.");
  });
});
