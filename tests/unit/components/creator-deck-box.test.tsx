// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The creator's "Add to a deck" box (TODO DK9.3), through the REAL
// CardCreatorForm:
//
//   * its own box under the live preview on every step; the Publish step
//     no longer has a deck picker;
//   * a NEW card (and a remix): the save carries `deck_id` exactly as main
//     has always sent it — picking a deck changes that key and nothing else
//     (the pinned payload suites hold everything a save without a deck
//     sends: creator-face-tabs-payload.test.tsx, job-payloads-pinned.test.ts,
//     creator-clear-fields-save.test.tsx — none changed);
//   * a deck that refused the card (its 500 entries) is said after the save;
//   * the deck flow (/create?deckCard=…) says where saving goes, offers no
//     deck (#645: that save never sends a deck_id);
//   * an EDIT (owner decision D13): each tick is written at once through the
//     membership action, apart from Save — the card's own save is the same
//     whether the box was used or not;
//   * never for a guest, nor an admin's frame preview.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
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
const actions = vi.hoisted(() => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
  updateDeckCardAction: vi.fn(),
  recordFrameRequestAction: vi.fn(),
  getDeckPickerDataAction: vi.fn(),
  changeDeckMembershipAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: actions.linkDeckCardAction,
  updateDeckCardAction: actions.updateDeckCardAction,
}));
vi.mock("@/lib/decks/membership-actions", () => ({
  getDeckPickerDataAction: actions.getDeckPickerDataAction,
  changeDeckMembershipAction: actions.changeDeckMembershipAction,
}));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "77777777-7777-4777-8777-777777777777";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15"].flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)));
const MY_DECKS = [
  { id: DECK, title: "Burn", format: "modern" },
  { id: "88888888-8888-4888-8888-888888888888", title: "Goblins", format: "pauper" },
];

function savedCard(overrides: Partial<Record<string, unknown>> = {}): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Kesh, Emberforge Warden",
    slug: "kesh",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    supertype: "Legendary",
    card_type: "creature",
    subtypes: ["Dwarf"],
    tags: [],
    rarity: "rare",
    rules_text: "Haste",
    flavor_text: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: "m15" },
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-09-29T10:00:00.000Z",
    ...overrides,
  } as unknown as Card;
}

type FormProps = Partial<React.ComponentProps<typeof CardCreatorForm>>;
function renderForm(mode: "create" | "edit" | "remix", props: FormProps = {}) {
  return render(
    <CardCreatorForm
      mode={mode}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: "new-card", slug: "kesh-2" });
  actions.getDeckPickerDataAction.mockResolvedValue({
    ok: true,
    decks: MY_DECKS.map((deck) => ({ ...deck, visibility: "public" })),
    memberships: {},
  });
  actions.changeDeckMembershipAction.mockResolvedValue({
    ok: true,
    deckId: DECK,
    deckTitle: "Burn",
    deckSlug: "burn",
    results: [{ cardId: CARD_ID, status: "added" }],
    entries: [{ cardId: CARD_ID, deckId: DECK, entryId: "e1", board: "main", quantity: 1 }],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  });
};
const goTo = async (step: string) => {
  await act(async () => {
    fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
  });
};
const box = () => screen.getByTestId("creator-deck-box");
const deckSelect = () => within(box()).getByRole("combobox", { name: "Deck for this card" }) as HTMLSelectElement;

/** A remix of the stored card, saved — after `before`. The payload. */
async function remixSave(before: () => Promise<void> = async () => {}) {
  renderForm("remix", { card: savedCard(), myDecks: MY_DECKS });
  await before();
  await act(async () => {
    fireEvent.change(document.querySelector('[name="title"]')!, { target: { value: "Kesh Reforged" } });
  });
  await save();
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(JSON.stringify(actions.createCardAction.mock.calls[0]![0])) as Record<string, unknown>;
  cleanup();
  actions.createCardAction.mockClear();
  return sent;
}

describe("the creator's Add to a deck box (TODO DK9.3)", () => {
  it("sits under the live preview on every step; the Publish step has no deck picker any more", async () => {
    renderForm("create", { myDecks: MY_DECKS });
    const aside = box().closest("aside");
    expect(aside).not.toBeNull();
    // After the preview.
    const preview = within(aside!).getByTestId("card-preview");
    expect(preview.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const step of ["Text & stats", "Publish"]) {
      await goTo(step);
      expect(screen.getAllByTestId("creator-deck-box")).toHaveLength(1);
    }
    // Only the box offers a deck (the Publish step's select is gone).
    expect(screen.getAllByRole("combobox", { name: /deck/i })).toEqual([deckSelect()]);
  });

  it("a new card's deck travels as deck_id — and changes nothing else in the save", async () => {
    const without = await remixSave();
    const withDeck = await remixSave(async () => {
      await act(async () => {
        fireEvent.change(deckSelect(), { target: { value: DECK } });
      });
    });
    expect(without.deck_id).toBeNull();
    expect(withDeck.deck_id).toBe(DECK);
    expect({ ...withDeck, deck_id: null }).toEqual(without);
    // A new card's deck is the save's, not an immediate write.
    expect(actions.changeDeckMembershipAction).not.toHaveBeenCalled();
  });

  it("a deck that didn't take the card is said after the save (the card IS saved)", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "new-card",
      slug: "kesh-2",
      deckEntryError: "“Burn” is full — a deck holds at most 500 different entries. Remove some from it, or add the card to another deck.",
    });
    renderForm("remix", { card: savedCard(), myDecks: MY_DECKS });
    await act(async () => {
      fireEvent.change(deckSelect(), { target: { value: DECK } });
      fireEvent.change(document.querySelector('[name="title"]')!, { target: { value: "Kesh Reforged" } });
    });
    await save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "Not added to the deck: “Burn” is full — a deck holds at most 500 different entries. Remove some from it, or add the card to another deck.",
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("a deck alone doesn't make a remix the maker's own: Save stays off", async () => {
    renderForm("remix", { card: savedCard(), myDecks: MY_DECKS });
    const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
    expect(saveButton().disabled).toBe(true);
    await act(async () => {
      fireEvent.change(deckSelect(), { target: { value: DECK } });
    });
    expect(deckSelect().value).toBe(DECK);
    // "Change something": the deck is where the card goes, not a change to it.
    expect(saveButton().disabled).toBe(true);
    await save();
    expect(actions.createCardAction).not.toHaveBeenCalled();
    // …and a real change still saves, with the deck.
    await act(async () => {
      fireEvent.change(document.querySelector('[name="title"]')!, { target: { value: "Kesh Reforged" } });
    });
    expect(saveButton().disabled).toBe(false);
  });

  it("the deck flow says where saving goes, and offers no deck", () => {
    renderForm("create", {
      myDecks: MY_DECKS,
      deckRemix: { deckCardId: "66666666-6666-4666-8666-666666666666", scryfallId: null, deckSlug: "burn", deckTitle: "Burn", entryName: "Shock" },
    });
    expect(within(box()).getByTestId("creator-deck-return").textContent).toBe("Saving returns you to “Burn”.");
    expect(within(box()).queryByRole("combobox")).toBeNull();
    expect(within(box()).queryByRole("button", { name: /New deck/ })).toBeNull();
  });

  it("an edit: each tick is written at once, apart from Save — whose payload is the same either way", async () => {
    const editSave = async (useBox: boolean) => {
      renderForm("edit", { card: savedCard() });
      const burn = await within(box()).findByRole("checkbox", { name: "Burn" });
      expect(actions.getDeckPickerDataAction).toHaveBeenCalledWith([CARD_ID]);
      if (useBox) {
        await act(async () => {
          fireEvent.click(burn);
        });
        expect(actions.changeDeckMembershipAction).toHaveBeenCalledWith({ deckId: DECK, add: [CARD_ID], privateCards: "ask" });
        expect((within(box()).getByRole("checkbox", { name: "Burn" }) as HTMLInputElement).checked).toBe(true);
        expect(within(box()).getByTestId("deck-membership-status").textContent).toBe("Added to “Burn”.");
        // Written, and the card was never saved for it.
        expect(actions.updateCardAction).not.toHaveBeenCalled();
      }
      await act(async () => {
        fireEvent.change(document.querySelector('[name="title"]')!, { target: { value: "Kesh, Ember Warden" } });
      });
      await save();
      await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
      const sent = JSON.parse(JSON.stringify(actions.updateCardAction.mock.calls[0])) as unknown[];
      cleanup();
      actions.updateCardAction.mockClear();
      return sent;
    };
    const plain = await editSave(false);
    const withBox = await editSave(true);
    expect(withBox).toEqual(plain);
    // The edit's save never names a deck.
    expect(JSON.stringify(plain)).not.toMatch(/deck_id/);
  });

  it("is never offered to a guest, nor on an admin's frame preview", () => {
    renderForm("create", { userId: null, myDecks: [] });
    expect(screen.queryByTestId("creator-deck-box")).toBeNull();
    cleanup();
    renderForm("edit", { card: savedCard({ frame_preview: true, visibility: "private" }) });
    expect(screen.queryByTestId("creator-deck-box")).toBeNull();
    expect(actions.getDeckPickerDataAction).not.toHaveBeenCalled();
  });
});

describe("a PRIVATE new card into a deck others can open (TODO DK0.13)", () => {
  const VISIBLE_DECKS = [
    { ...MY_DECKS[0]!, visibility: "public" as const },
    { ...MY_DECKS[1]!, visibility: "private" as const },
  ];
  const note = () => screen.queryByTestId("creator-deck-private-note");
  /** The Publish step's "Save as a draft": the card saves private. */
  const makeDraft = async () => {
    await goTo("Publish");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /Save as a draft/ }));
    });
  };

  it("a private remix into a public deck: what visitors see, and Make it public sets the Publish step's own fields", async () => {
    renderForm("remix", { card: savedCard(), myDecks: VISIBLE_DECKS });
    await act(async () => {
      fireEvent.change(document.querySelector('[name="title"]')!, { target: { value: "Kesh Reforged" } });
    });
    await makeDraft();
    expect(note()).toBeNull();
    await act(async () => {
      fireEvent.change(deckSelect(), { target: { value: DECK } });
    });
    expect(note()!.textContent).toContain("This card is private. Visitors will see “Private card” in this deck.");
    const button = within(note()!).getByRole("button", { name: "Make it public" });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    // The button removed itself: the note is gone and the focus went on to
    // the deck's choice, never <body>.
    expect(note()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(deckSelect()));
    await save();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0]![0]).toMatchObject({ visibility: "public", deck_id: DECK });
  });

  it("no note for a private deck, nor for a public card", async () => {
    renderForm("remix", { card: savedCard(), myDecks: VISIBLE_DECKS });
    await makeDraft();
    await act(async () => {
      fireEvent.change(deckSelect(), { target: { value: VISIBLE_DECKS[1]!.id } });
    });
    expect(note()).toBeNull();
    cleanup();
    renderForm("remix", { card: savedCard(), myDecks: VISIBLE_DECKS });
    await act(async () => {
      fireEvent.change(deckSelect(), { target: { value: DECK } });
    });
    expect(note()).toBeNull();
  });

  it("text that keeps the card private: the reason instead of the button", async () => {
    const rot13 = (text: string) =>
      text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
    renderForm("remix", {
      card: savedCard({ rules_text: `Haste. ${rot13("fuvg")}.` }),
      myDecks: VISIBLE_DECKS,
    });
    await makeDraft();
    await act(async () => {
      fireEvent.change(deckSelect(), { target: { value: DECK } });
    });
    expect(within(note()!).queryByRole("button")).toBeNull();
    expect(note()!.textContent).toMatch(/rules text includes strong language/);
  });

  it("the deck flow (/create?deckCard=…) says the same about the entry's public deck", async () => {
    renderForm("remix", {
      card: savedCard(),
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: null,
        deckSlug: "burn",
        deckTitle: "Burn",
        entryName: "Shock",
        deckVisibility: "unlisted",
      },
    });
    await makeDraft();
    expect(note()!.textContent).toContain("Visitors will see “Private card” in this deck.");
  });
});
