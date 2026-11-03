// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CreatorHost } from "@/components/creator/creator-host";
import { DECK_EDIT_NEW, type DeckEditShared } from "@/lib/decks/inline-editor-shared";

// ---------------------------------------------------------------------------
// The deck's edit drawer, its BODY (TODO DK5.18 review):
//  - a NEW card's save (a customize, a remix, "＋ Create new card") never
//    leaves the create form armed: it waits for the card to come back as an
//    edit of itself, and when it can't — the link into the entry failed, the
//    read failed — it says so with the saved card's own link (a second Save
//    would have made a second card); an EDIT keeps its form either way;
//  - the page-wide props (`shared=1`) are read once a visit, again only
//    after a new card (capacity, decks).
// The creator is stubbed: its host is what these tests drive.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { message: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/decks/inline-editor-actions", () => ({ revalidateDeckAfterInlineSaveAction: vi.fn(async () => ({ ok: true })) }));
type FormStubProps = { mode: string; host: CreatorHost; card?: { id: string } | null; pipOverrides?: Record<string, string> };
const form = vi.hoisted(() => ({ props: null as null | FormStubProps, mounts: 0 }));
vi.mock("@/components/creator/card-creator-form", async () => {
  const { useEffect } = await import("react");
  return {
    CardCreatorForm: function FormStub(props: FormStubProps) {
      form.props = props;
      useEffect(() => {
        form.mounts += 1;
      }, []);
      return <div data-testid="creator-form" data-mode={props.mode} />;
    },
  };
});

import DeckEditDrawerBody from "@/components/decks/deck-edit-drawer-body";
import { announcePipsChanged } from "@/lib/creator/pips-changed";

const DECK = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";
const ENTRY2 = "66666666-6666-4666-8666-666666666666";
const CARD = "55555555-5555-4555-8555-555555555555";
const SHARED = { userId: "u", myDecks: [], gameSystems: [], capacity: null } as unknown as DeckEditShared;

const customize = (entryId = ENTRY) => ({
  mode: "create",
  card: null,
  deckRemix: { deckCardId: entryId, scryfallId: "sf", deckSlug: "ness", deckTitle: "Ness", entryName: "Island", deckVisibility: "public" },
  entryId,
  initialDeckId: null,
  title: "Island",
  fullPageHref: "/create",
});
const editOf = (cardId: string, entryId = ENTRY) => ({
  mode: "edit",
  card: { id: cardId, title: "Island of Embers" },
  deckRemix: null,
  entryId,
  initialDeckId: null,
  title: "Island of Embers",
  fullPageHref: "/card/x/edit",
});

let replies: Array<() => Response | Promise<Response>>;
const fetchMock = vi.fn(async (url: string) => {
  void url;
  const next = replies.shift();
  if (!next) throw new Error("no reply queued");
  return next();
});
const ok = (target: unknown, withShared: boolean | DeckEditShared) => () =>
  new Response(
    JSON.stringify({ ok: true, target, ...(withShared ? { shared: withShared === true ? SHARED : withShared } : {}) }),
    { status: 200 },
  );
const refused = (error: string) => () => new Response(JSON.stringify({ ok: false, error }), { status: 404 });
const newCard = () => ({ mode: "create", card: null, deckRemix: null, entryId: null, initialDeckId: DECK, title: "New card", fullPageHref: "/create" });

function mount(target = ENTRY) {
  let cache: DeckEditShared | null = null;
  const sharedCache = { get: () => cache, set: (s: DeckEditShared | null) => void (cache = s) };
  const props = {
    deckId: DECK,
    bindLeave: vi.fn(),
    focusHome: vi.fn(),
    onSettled: vi.fn(),
    sharedCache,
    scrollRoot: null,
    wide: true,
    saveAndNext: null,
    fullPageHref: "/create",
    onRequestClose: vi.fn(),
    onCloseNow: vi.fn(),
    onRetarget: vi.fn(),
  };
  const view = render(<DeckEditDrawerBody {...props} target={target} />);
  return { props, view, rerender: (t: string) => view.rerender(<DeckEditDrawerBody {...props} target={t} />) };
}

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  form.props = null;
  form.mounts = 0;
  for (const fn of [...Object.values(router), toast, toast.message, toast.success, toast.error]) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a new card's save never leaves the create form armed", () => {
  it("the link into the entry failed: the form is gone, the saved card has its own link", async () => {
    replies.push(ok(customize(), true));
    mount();
    await screen.findByTestId("creator-form");
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "island-of-embers", mode: "create", linked: false });
    });
    expect(screen.queryByTestId("creator-form")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/saved, but it couldn't be put into this deck's entry/i);
    expect(screen.getByRole("link", { name: /open the saved card/i }).getAttribute("href")).toBe("/card/island-of-embers/edit");
    // No re-read was even tried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("linked, but the read back failed: the same — never the create form again", async () => {
    replies.push(ok(customize(), true));
    mount();
    await screen.findByTestId("creator-form");
    let fail!: () => void;
    replies.push(() => new Promise<Response>((_, reject) => (fail = () => reject(new Error("offline")))));
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "island-of-embers", mode: "create", linked: true });
    });
    // On its way back: a loading state, no form to press Save on twice.
    expect(screen.queryByTestId("creator-form")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/opening the editor/i);
    await act(async () => fail());
    expect(screen.queryByTestId("creator-form")).toBeNull();
    expect(screen.getByRole("link", { name: /open the saved card/i })).toBeTruthy();
  });

  it("linked and read back: the edit of the saved card", async () => {
    replies.push(ok(customize(), true));
    mount();
    await screen.findByTestId("creator-form");
    replies.push(ok(editOf(CARD), true));
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "island-of-embers", mode: "create", linked: true });
    });
    await waitFor(() => expect(screen.getByTestId("creator-form").getAttribute("data-mode")).toBe("edit"));
    expect(form.props!.card?.id).toBe(CARD);
  });

  it("an EDIT whose read back fails keeps its form (a second Save updates the same card)", async () => {
    replies.push(ok(editOf(CARD), true));
    mount();
    await screen.findByTestId("creator-form");
    replies.push(() => Promise.reject(new Error("offline")));
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "island-of-embers", mode: "edit", linked: false });
    });
    expect(screen.getByTestId("creator-form").getAttribute("data-mode")).toBe("edit");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the page-wide props are read once a visit", () => {
  it("asks for `shared=1` on the first open only, and again after a new card", async () => {
    replies.push(ok(customize(), true));
    const { rerender } = mount();
    await screen.findByTestId("creator-form");
    expect(String(fetchMock.mock.calls[0][0])).toContain("shared=1");

    // The walk: the next entry, without the page-wide props.
    replies.push(ok(customize(ENTRY2), false));
    rerender(ENTRY2);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("shared=1");
    await screen.findByTestId("creator-form");

    // A new card changes capacity and decks: its read back asks again.
    replies.push(ok(editOf(CARD, ENTRY2), true));
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "c", mode: "create", linked: true });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2][0])).toContain("shared=1");
  });
});

describe("a failed read belongs to that open of the card (DK5.18 re-check)", () => {
  it("walked away and back, the card is read again — and shows when it loads", async () => {
    replies.push(refused("The editor couldn't open."));
    const { rerender } = mount(ENTRY);
    expect((await screen.findByRole("alert")).textContent).toContain("The editor couldn't open.");
    replies.push(ok(customize(ENTRY2), true));
    rerender(ENTRY2);
    await screen.findByTestId("creator-form");
    let land!: () => void;
    replies.push(() => new Promise<Response>((resolve) => (land = () => resolve(ok(customize(ENTRY), false)()))));
    rerender(ENTRY);
    // Loading, not the old error.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/opening the editor/i);
    await act(async () => land());
    await screen.findByTestId("creator-form");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a new card saved into ANOTHER deck says where it went (DK5.18 re-check)", () => {
  const OTHER = "77777777-7777-4777-8777-777777777777";
  const withDecks = { ...SHARED, myDecks: [{ id: OTHER, title: "Gorgon Attack", format: "casual", slug: "gorgon-attack" }] } as unknown as DeckEditShared;

  it("names the deck, with a way to it, and closes", async () => {
    replies.push(ok(newCard(), withDecks));
    const { props } = mount(DECK_EDIT_NEW);
    await screen.findByTestId("creator-form");
    replies.push(ok(newCard(), withDecks));
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "c", mode: "create", linked: false, deckId: OTHER });
    });
    await waitFor(() => expect(props.onCloseNow).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Saved into “Gorgon Attack”.", expect.anything());
    const options = toast.success.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } };
    expect(options.action.label).toBe("Open deck");
    options.action.onClick();
    expect(router.push).toHaveBeenCalledWith("/deck/gorgon-attack");
  });

  it("in no deck: says so, with My Cards", async () => {
    replies.push(ok(newCard(), withDecks));
    mount(DECK_EDIT_NEW);
    await screen.findByTestId("creator-form");
    replies.push(ok(newCard(), withDecks));
    await act(async () => {
      form.props!.host.onSaved({ cardId: CARD, slug: "c", mode: "create", linked: false, deckId: null });
    });
    await waitFor(() => expect(toast.message).toHaveBeenCalledWith(expect.stringMatching(/isn't in a deck/), expect.anything()));
  });
});

describe("a custom pip changed in the drawer reaches its creator (DK5.18 re-check)", () => {
  it("reads the page-wide props again and hands the form the new overrides — the form kept", async () => {
    replies.push(ok(editOf(CARD), true));
    mount();
    await screen.findByTestId("creator-form");
    expect(form.props!.pipOverrides ?? {}).toEqual({});
    replies.push(ok(editOf(CARD), { ...SHARED, pipOverrides: { W: "https://example.com/w.png" } } as unknown as DeckEditShared));
    await act(async () => announcePipsChanged());
    await waitFor(() => expect(form.props!.pipOverrides).toEqual({ W: "https://example.com/w.png" }));
    expect(String(fetchMock.mock.calls[1][0])).toContain("shared=1");
    expect(form.mounts).toBe(1);
  });
});
