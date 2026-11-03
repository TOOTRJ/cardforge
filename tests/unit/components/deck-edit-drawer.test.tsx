// @vitest-environment happy-dom
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicReady } from "@/tests/stubs/next-dynamic";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The deck's edit drawer (TODO DK5.18) on the OWNER's deck page, behind the
// admin switch:
//  - switch off (no `inlineEditor`): every Edit is DK5.5's link, exactly as
//    on main — no drawer, no "Create new card", `?edit=` ignored;
//  - switch on: Edit / Customize / Remix, the pop-up's Edit, "Edit next" and
//    "＋ Create new card" open a modal drawer named after the card, pushing
//    `?edit=`; Back / Esc / ✕ close it — asking first with changes (the
//    creator's own leave check, `bindLeave`) — and the focus goes back to
//    the row; ‹ › and "Save & next" walk (the URL replaced);
//  - a visitor's `?edit=` is ignored.
// The drawer's BODY (the creator chunk) is stubbed: what it receives is
// what these tests read. Its payloads are creator-host-payload.test.tsx's.
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
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span aria-label={alt} /> }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/creator/card-glossary", () => ({ CardGlossary: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="live-preview" /> }));
vi.mock("@/lib/decks/card-actions", () => ({
  updateDeckEntriesAction: vi.fn(),
  removeDeckEntriesAction: vi.fn(),
  restoreDeckEntriesAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
  unlinkDeckCardAction: vi.fn(),
  listMyCardsLiteAction: vi.fn(async () => ({ ok: true, cards: [] })),
}));
vi.mock("@/lib/decks/add-actions", () => ({ addToDeckAction: vi.fn(), addManyToDeckAction: vi.fn() }));
vi.mock("@/lib/decks/membership-actions", () => ({ privateCardOfferAction: vi.fn() }));

type BodyProps = {
  target: string;
  bindLeave: (ask: ((proceed: () => void) => boolean) | null) => void;
  saveAndNext: { label: string; onNext: () => void } | null;
  fullPageHref: string;
  onRequestClose: () => void;
  focusHome: () => void;
};
const body = vi.hoisted(() => ({
  props: null as BodyProps | null,
  dirty: false,
  pending: null as null | (() => void),
}));
vi.mock("@/components/decks/deck-edit-drawer-body", () => ({
  default: function StubBody(props: BodyProps) {
    body.props = props;
    const { bindLeave } = props;
    useEffect(() => {
      bindLeave((proceed) => {
        if (!body.dirty) {
          proceed();
          return false;
        }
        body.pending = proceed;
        return true;
      });
      return () => bindLeave(null);
    });
    return <div data-testid="drawer-body">{props.target}</div>;
  },
}));

import { DeckCardList } from "@/components/decks/deck-card-list";
import type { DeckItem } from "@/lib/decks/queries";

beforeAll(() => dynamicReady());

const DECK = { id: "33333333-3333-4333-8333-333333333333", slug: "ness", title: "Ness", format: "casual" as const };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entry(n: number, over: Record<string, unknown> = {}) {
  return {
    id: id(n),
    deck_id: DECK.id,
    board: "main",
    quantity: 1,
    position: n,
    card_id: null,
    scryfall_id: `sf-${n}`,
    source: "import",
    name: `Card ${n}`,
    set_code: "dom",
    collector_number: String(n),
    type_line: "Instant",
    mana_cost: "{R}",
    mana_value: 1,
    color_identity: ["R"],
    rarity: "common",
    image_url: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}
const item = (n: number, over: Record<string, unknown> = {}) => ({ entry: entry(n, over), card: null, cardOwner: null }) as unknown as DeckItem;
const BOLT = () => item(1, { name: "Lightning Bolt", quantity: 2 });
const RING = () => item(2, { name: "Sol Ring", type_line: "Artifact", mana_cost: "{1}" });

function deckPage({ inlineEditor, canManage = true }: { inlineEditor?: boolean; canManage?: boolean } = {}) {
  return render(
    <DeckCardList
      items={[BOLT(), RING()]}
      ownerUsername="kesh"
      canManage={canManage}
      deck={canManage ? DECK : null}
      initialPrefs={{ view: "list", group: "none", sort: "name" }}
      summary={{
        format: "casual",
        analytics: { total: 3, byBoard: { main: 3, side: 0, maybe: 0, commander: 0, companion: 0 }, averageManaValue: 1, totalManaValue: 3, lands: 0 },
        formatIssues: canManage ? [] : null,
      }}
      {...(inlineEditor === undefined ? {} : { inlineEditor })}
    />,
  );
}

const drawer = () => screen.queryByRole("dialog", { name: /Lightning Bolt|Sol Ring|New card/ });
const search = () => new URLSearchParams(window.location.search).get("edit");
const row = (n: number) => document.querySelector<HTMLElement>(`[data-deck-entry="${id(n)}"]`);

async function openMenu(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `More for ${name}` }));
  });
  return screen.findByRole("menu", { name: `${name}: actions` });
}

/** The browser's Back: the URL moves, then popstate. */
async function pressBack(to = "/deck/ness") {
  await act(async () => {
    window.history.replaceState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  window.history.replaceState(null, "", "/deck/ness");
  body.props = null;
  body.dirty = false;
  body.pending = null;
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
  // A drawer close goes Back off its entry; happy-dom's history.back() is a
  // no-op here, so the tests move the URL themselves.
  vi.spyOn(window.history, "back").mockImplementation(() => {
    window.history.replaceState(null, "", "/deck/ness");
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("switch off: the deck page as on main (DK5.5's navigation)", () => {
  for (const inlineEditor of [undefined, false]) {
    it(`keeps every Edit a link to the creator, no drawer, no "Create new card" (inlineEditor: ${String(inlineEditor)})`, async () => {
      deckPage({ inlineEditor });
      expect(screen.queryByRole("button", { name: /create new card/i })).toBeNull();
      const menu = await openMenu("Sol Ring");
      expect(within(menu).getByRole("menuitem", { name: "Customize" }).getAttribute("href")).toBe(
        `/create?deckCard=${id(2)}&returnTo=${encodeURIComponent(`/deck/ness#entry-${id(2)}`)}`,
      );
      const next = screen.getByRole("link", { name: /^Edit next/ });
      expect(next.getAttribute("href")).toBe(`/create?deckCard=${id(1)}&returnTo=${encodeURIComponent(`/deck/ness#next-${id(1)}`)}`);
      expect(drawer()).toBeNull();
      expect(search()).toBeNull();
    });
  }

  it("ignores `?edit=` on the owner's page while the switch is off", async () => {
    window.history.replaceState(null, "", `/deck/ness?edit=${id(1)}`);
    deckPage();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(drawer()).toBeNull();
    expect(search()).toBe(id(1));
  });

  it("ignores a visitor's `?edit=` (a visitor's page never offers the drawer)", async () => {
    window.history.replaceState(null, "", `/deck/ness?edit=${id(1)}`);
    deckPage({ canManage: false, inlineEditor: true });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(drawer()).toBeNull();
    expect(screen.queryByRole("button", { name: /create new card/i })).toBeNull();
  });
});

describe("switch on: edit in a drawer over the deck (DK5.18)", () => {
  it("opens from a row's menu: a modal named after the card, `?edit=` pushed, the row marked", async () => {
    const push = vi.spyOn(window.history, "pushState");
    deckPage({ inlineEditor: true });
    const menu = await openMenu("Sol Ring");
    const customize = within(menu).getByRole("menuitem", { name: "Customize" });
    expect(customize.getAttribute("href")).toBeNull();
    await act(async () => {
      fireEvent.click(customize);
    });
    const dialog = await screen.findByRole("dialog", { name: "Sol Ring" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(search()).toBe(id(2));
    expect(await within(dialog).findByTestId("drawer-body")).toBeTruthy();
    expect(body.props?.target).toBe(id(2));
    // DK5.5's page, kept as the way out.
    expect(within(dialog).getByRole("link", { name: /open full page/i }).getAttribute("href")).toBe(
      `/create?deckCard=${id(2)}&returnTo=${encodeURIComponent(`/deck/ness#entry-${id(2)}`)}`,
    );
    expect(row(2)?.hasAttribute("data-editing")).toBe(true);
    expect(row(1)?.hasAttribute("data-editing")).toBe(false);
  });

  it("closes on Escape, Back or ✕ with nothing to lose — the focus back on the row, never <body>", async () => {
    deckPage({ inlineEditor: true });
    // Escape.
    await act(async () => {
      fireEvent.click(within(await openMenu("Sol Ring")).getByRole("menuitem", { name: "Customize" }));
    });
    await screen.findByTestId("drawer-body");
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Sol Ring" }), { key: "Escape" });
    });
    await waitFor(() => expect(drawer()).toBeNull());
    expect(search()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(row(2)));
    expect(row(2)?.hasAttribute("data-editing")).toBe(false);

    // Back: one press.
    await act(async () => {
      fireEvent.click(within(await openMenu("Lightning Bolt")).getByRole("menuitem", { name: "Customize" }));
    });
    await screen.findByTestId("drawer-body");
    await pressBack();
    await waitFor(() => expect(drawer()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row(1)));

    // ✕.
    await act(async () => {
      fireEvent.click(within(await openMenu("Lightning Bolt")).getByRole("menuitem", { name: "Customize" }));
    });
    await screen.findByTestId("drawer-body");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close the editor" }));
    });
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("asks first with changes — Escape, ✕ and Back — and closes only on the creator's say-so", async () => {
    deckPage({ inlineEditor: true });
    await act(async () => {
      fireEvent.click(within(await openMenu("Sol Ring")).getByRole("menuitem", { name: "Customize" }));
    });
    await screen.findByTestId("drawer-body");
    body.dirty = true;

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Sol Ring" }), { key: "Escape" });
    });
    expect(drawer()).not.toBeNull();
    expect(body.pending).toBeTypeOf("function");
    body.pending = null;

    // Back with changes: the entry is put back, the drawer stays, and asks.
    const push = vi.spyOn(window.history, "pushState");
    await pressBack();
    expect(drawer()).not.toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(search()).toBe(id(2));
    expect(body.pending).toBeTypeOf("function");

    // "Leave without saving": closed.
    await act(async () => {
      body.pending?.();
    });
    await waitFor(() => expect(drawer()).toBeNull());
    expect(search()).toBeNull();
  });

  it("walks with ‹ › (the URL replaced, never pushed) and hands Save & next the next unchanged import", async () => {
    deckPage({ inlineEditor: true });
    await act(async () => {
      fireEvent.click(within(await openMenu("Lightning Bolt")).getByRole("menuitem", { name: "Customize" }));
    });
    const dialog = await screen.findByRole("dialog", { name: "Lightning Bolt" });
    await screen.findByTestId("drawer-body");
    expect(within(dialog).getByText(/1 of 2/)).toBeTruthy();
    expect(body.props?.saveAndNext?.label).toBe("Save & next");
    const push = vi.spyOn(window.history, "pushState");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Next card: Sol Ring" }));
    });
    await screen.findByRole("dialog", { name: "Sol Ring" });
    expect(search()).toBe(id(2));
    expect(push).not.toHaveBeenCalled();
    // From Sol Ring, the next unchanged import is Lightning Bolt: Save & next goes there.
    await waitFor(() => expect(body.props?.target).toBe(id(2)));
    await act(async () => {
      body.props?.saveAndNext?.onNext();
    });
    await screen.findByRole("dialog", { name: "Lightning Bolt" });
    expect(search()).toBe(id(1));
  });

  it("opens from the summary bar's Edit next and the new-card button", async () => {
    deckPage({ inlineEditor: true });
    const next = screen.getByRole("link", { name: /^Edit next/ });
    // A modified click is the browser's (a new tab): the link keeps its href.
    expect(next.getAttribute("href")).toContain("/create?deckCard=");
    await act(async () => {
      fireEvent.click(next);
    });
    await screen.findByRole("dialog", { name: "Lightning Bolt" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close the editor" }));
    });
    await waitFor(() => expect(drawer()).toBeNull());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create new card/i }));
    });
    const dialog = await screen.findByRole("dialog", { name: "New card" });
    expect(search()).toBe("new");
    expect(within(dialog).getByRole("link", { name: /open full page/i }).getAttribute("href")).toBe("/create");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close the editor" }));
    });
    await waitFor(() => expect(drawer()).toBeNull());
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/create new card/i));
  });

  it("reopens on arrival with `?edit=` (a reload), for the owner", async () => {
    window.history.replaceState(null, "", `/deck/ness?edit=${id(2)}`);
    deckPage({ inlineEditor: true });
    expect(await screen.findByRole("dialog", { name: "Sol Ring" }, { timeout: 3000 })).toBeTruthy();
    expect(search()).toBe(id(2));
  });
});

describe("the drawer's history entry, focus and the walk's ends (DK5.18 review)", () => {
  it("marks the entry it pushes, and reopens on a marked one (Back from the full page, a reload) without a second copy", async () => {
    const push = vi.spyOn(window.history, "pushState");
    deckPage({ inlineEditor: true });
    await act(async () => {
      fireEvent.click(within(await openMenu("Sol Ring")).getByRole("menuitem", { name: "Customize" }));
    });
    await screen.findByRole("dialog", { name: "Sol Ring" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toEqual({ pipglyphDeckEdit: id(2) });
    cleanup();

    // Back from "Open full page" lands on that marked entry.
    window.history.replaceState({ pipglyphDeckEdit: id(2) }, "", `/deck/ness?edit=${id(2)}`);
    push.mockClear();
    const replace = vi.spyOn(window.history, "replaceState");
    deckPage({ inlineEditor: true });
    await screen.findByRole("dialog", { name: "Sol Ring" }, { timeout: 3000 });
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    // …and it is still the drawer's own entry: closing goes Back off it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close the editor" }));
    });
    await waitFor(() => expect(drawer()).toBeNull());
    expect(window.history.back).toHaveBeenCalledTimes(1);
  });

  it("a shared link (no mark) still becomes the deck's entry plus the drawer's", async () => {
    window.history.replaceState(null, "", `/deck/ness?edit=${id(2)}`);
    const push = vi.spyOn(window.history, "pushState");
    deckPage({ inlineEditor: true });
    await screen.findByRole("dialog", { name: "Sol Ring" }, { timeout: 3000 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("'Keep editing' puts the focus back where it was in the drawer — or on its heading — never <body>", async () => {
    deckPage({ inlineEditor: true });
    await act(async () => {
      fireEvent.click(within(await openMenu("Lightning Bolt")).getByRole("menuitem", { name: "Customize" }));
    });
    const dialog = await screen.findByRole("dialog", { name: "Lightning Bolt" });
    await screen.findByTestId("drawer-body");
    body.dirty = true;
    const nextButton = within(dialog).getByRole("button", { name: "Next card: Sol Ring" });
    nextButton.focus();
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    expect(body.pending).toBeTypeOf("function");
    // The leave dialog took the focus and closed ("Keep editing").
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      body.props?.focusHome();
    });
    expect(document.activeElement).toBe(nextButton);

    // Nothing to go back to: the heading.
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      body.props?.focusHome();
    });
    expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "Lightning Bolt" }));
  });

  it("‹ turning itself off at the first card hands the focus to the heading", async () => {
    deckPage({ inlineEditor: true });
    await act(async () => {
      fireEvent.click(within(await openMenu("Sol Ring")).getByRole("menuitem", { name: "Customize" }));
    });
    const dialog = await screen.findByRole("dialog", { name: "Sol Ring" });
    const prev = within(dialog).getByRole("button", { name: "Previous card: Lightning Bolt" });
    prev.focus();
    await act(async () => {
      fireEvent.click(prev);
    });
    await screen.findByRole("dialog", { name: "Lightning Bolt" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Lightning Bolt" })));
  });

  it("offers no 'Save & next' on a new card", async () => {
    deckPage({ inlineEditor: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create new card/i }));
    });
    await screen.findByRole("dialog", { name: "New card" });
    await screen.findByTestId("drawer-body");
    expect(body.props?.saveAndNext).toBeNull();
  });

  it("never looks for rows to mark while the drawer is off, or for a visitor", async () => {
    const qsa = vi.spyOn(Element.prototype, "querySelectorAll");
    const page = deckPage();
    page.rerender(<></>);
    cleanup();
    deckPage({ canManage: false, inlineEditor: true });
    const asked = qsa.mock.calls.filter(([selector]) => String(selector).includes("data-editing"));
    expect(asked).toEqual([]);
  });
});
