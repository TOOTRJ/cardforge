// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import type { CreatorHost } from "@/components/creator/creator-host";
import type { DeckRemixContext } from "@/types/deck";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The creator HOSTED by the deck's edit drawer (TODO DK5.18) saves what its
// own page saves: the same CardCreatorForm, the same payload builders — the
// host only decides what follows a save (no navigation, `host.onSaved`).
// Each scenario runs twice, once as /create or /card/…/edit mount it and
// once hosted, and the two payloads must be EQUAL. An untouched edit sends
// nothing (Save stays off) in both. Harness: creator-face-tabs-payload.
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
const actions = vi.hoisted(() => ({ createCardAction: vi.fn(), updateCardAction: vi.fn(), linkDeckCardAction: vi.fn() }));
vi.mock("@/lib/cards/actions", () => ({ createCardAction: actions.createCardAction, updateCardAction: actions.updateCardAction }));
vi.mock("@/lib/cards/dfc-adopt-actions", () => ({ adoptDfcBodiesAction: vi.fn() }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: actions.linkDeckCardAction }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/creator/art-uploader", () => ({
  ArtUploader: (props: {
    fieldAnchor?: string;
    onArtChange: (next: { artUrl: string | null; artPosition: { focalX: number; focalY: number; scale: number } }) => void;
  }) => (
    <button
      type="button"
      data-art-stub={props.fieldAnchor}
      onClick={() => props.onArtChange({ artUrl: "https://example.com/front.png", artPosition: { focalX: 0.31, focalY: 0.62, scale: 1.4 } })}
    >
      set art
    </button>
  ),
}));
vi.mock("@/components/cards/card-preview", () => ({ CardPreview: () => <div data-testid="card-preview" /> }));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const DECK_ID = "44444444-4444-4444-8444-444444444444";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15artifact", "m15land"].flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)));
const MY_DECKS = [{ id: DECK_ID, title: "Ness", format: "casual" as const, slug: "ness", visibility: "public" as const, theme: null, style: null }];

function storedCard(): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Dusk Ferryman",
    slug: "dusk-ferryman",
    game_system_id: GAME,
    cost: "{1}{U}",
    color_identity: ["blue"],
    supertype: "Legendary",
    card_type: "creature",
    subtypes: ["Human", "Rogue"],
    tags: ["test"],
    rarity: "rare",
    rules_text: "Vigilance",
    flavor_text: "“One coin. Both ways.”",
    power: "2",
    toughness: "3",
    loyalty: null,
    defense: null,
    artist_credit: "Anya Vale",
    art_url: "https://example.com/front.png",
    art_position: { focalX: 0.31, focalY: 0.62, scale: 1.4 },
    frame_style: { finish: "regular", template: "m15" },
    visibility: "public",
    lang: "en",
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-10-02T10:00:00.000Z",
  } as unknown as Card;
}

type FormProps = Parameters<typeof CardCreatorForm>[0];
function makeHost() {
  const onSaved = vi.fn<CreatorHost["onSaved"]>();
  const host: CreatorHost = {
    onSaved,
    bindLeave: vi.fn<CreatorHost["bindLeave"]>(),
    onCancel: vi.fn(),
    onDeleted: vi.fn(),
    wide: true,
    scrollRoot: null,
    saveAndNext: null,
  };
  return Object.assign(host, { onSaved });
}
function renderForm(props: Partial<FormProps>) {
  return render(
    <CardCreatorForm
      mode="create"
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured={false}
      verifiedFrameKeys={VERIFIED}
      {...props}
    />,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/deck/ness");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "saved" });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "saved" });
  actions.linkDeckCardAction.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
async function goTo(step: RegExp) {
  const rail = screen.getByRole("navigation", { name: /card editor steps/i });
  const button = Array.from(rail.querySelectorAll("button")).find((b) => step.test(b.textContent ?? ""));
  if (button) await click(button);
}
async function reach<T extends Element>(find: () => T | null, what: string): Promise<T> {
  if (find()) return find()!;
  for (const step of [/^card/i, /^identity/i, /^text/i, /^publish/i]) {
    await goTo(step);
    if (find()) return find()!;
  }
  throw new Error(`not found anywhere: ${what}`);
}
async function type(name: string, value: string) {
  const el = await reach(() => document.querySelector<HTMLInputElement>(`[name='${name}']`), name);
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  });
}
const saveButton = () => screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;
async function save(action: "createCardAction" | "updateCardAction") {
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  await click(saveButton());
  await waitFor(() => expect(actions[action]).toHaveBeenCalledTimes(1));
  const call = actions[action].mock.calls[0];
  return JSON.parse(JSON.stringify(action === "createCardAction" ? call[0] : call[1])) as Record<string, unknown>;
}

/** The same scenario, on its page and hosted: both payloads. */
async function both(
  props: Partial<FormProps>,
  scenario: () => Promise<Record<string, unknown>>,
): Promise<{ page: Record<string, unknown>; hosted: Record<string, unknown>; host: ReturnType<typeof makeHost> }> {
  renderForm(props);
  const page = await scenario();
  cleanup();
  for (const fn of [...Object.values(actions), ...Object.values(router)]) fn.mockClear();
  const host = makeHost();
  renderForm({ ...props, host });
  const hosted = await scenario();
  return { page, hosted, host };
}

describe("hosted saves send what the page sends (DK5.18)", () => {
  it("an edit: the same update payload; the host keeps the card (no navigation)", async () => {
    const { page, hosted, host } = await both({ mode: "edit", card: storedCard(), aiDecks: MY_DECKS }, async () => {
      await type("flavor_text", "The river keeps what it is paid.");
      return save("updateCardAction");
    });
    expect(hosted).toEqual(page);
    expect(hosted.flavor_text).toBe("The river keeps what it is paid.");
    await waitFor(() => expect(host.onSaved).toHaveBeenCalledWith({ cardId: CARD_ID, slug: "saved", mode: "edit", linked: false }));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("an untouched edit sends nothing — Save stays off, on the page and hosted", async () => {
    renderForm({ mode: "edit", card: storedCard() });
    expect(saveButton().disabled).toBe(true);
    cleanup();
    renderForm({ mode: "edit", card: storedCard(), host: makeHost() });
    expect(saveButton().disabled).toBe(true);
    expect(actions.updateCardAction).not.toHaveBeenCalled();
  });

  it("a deck entry's own version (Customize): the same create payload, linked into the entry", async () => {
    const deckRemix: DeckRemixContext = {
      deckCardId: ENTRY_ID,
      scryfallId: null,
      deckSlug: "ness",
      deckTitle: "Ness",
      entryName: "Sol Ring",
      deckVisibility: "public",
    };
    const { page, hosted, host } = await both({ mode: "create", deckRemix, myDecks: MY_DECKS }, async () => {
      await type("title", "Sol Ring, Forged");
      await click(await reach(() => document.querySelector("[data-art-stub='art_url']"), "art"));
      return save("createCardAction");
    });
    expect(hosted).toEqual(page);
    await waitFor(() => expect(host.onSaved).toHaveBeenCalledWith({ cardId: CARD_ID, slug: "saved", mode: "create", linked: true, deckId: null }));
    expect(actions.linkDeckCardAction).toHaveBeenCalledWith(ENTRY_ID, CARD_ID, { surface: "creator" });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a new card into the deck: the deck box starts on it, on the page and hosted alike", async () => {
    const { page, hosted } = await both({ mode: "create", myDecks: MY_DECKS, initialDeckId: DECK_ID }, async () => {
      await type("title", "Ember Scout");
      await click(await reach(() => document.querySelector("[data-art-stub='art_url']"), "art"));
      return save("createCardAction");
    });
    expect(hosted).toEqual(page);
    expect(hosted.deck_id).toBe(DECK_ID);
  });

  it("the deck box says where a save goes: back to the deck on the page, the entry's place in the drawer", () => {
    const deckRemix: DeckRemixContext = {
      deckCardId: ENTRY_ID,
      scryfallId: null,
      deckSlug: "ness",
      deckTitle: "Ness",
      entryName: "Sol Ring",
      deckVisibility: "public",
    };
    renderForm({ mode: "create", deckRemix, myDecks: MY_DECKS });
    expect(screen.getByTestId("creator-deck-return").textContent).toBe("Saving returns you to “Ness”.");
    cleanup();
    renderForm({ mode: "create", deckRemix, myDecks: MY_DECKS, host: makeHost() });
    expect(screen.getByTestId("creator-deck-return").textContent).toBe("Saving puts it into “Ness” in this entry’s place. You stay here.");
  });

  it("a deck it doesn't own is never picked for it", async () => {
    renderForm({ mode: "create", myDecks: MY_DECKS, initialDeckId: "66666666-6666-4666-8666-666666666666" });
    await type("title", "Ember Scout");
    await click(await reach(() => document.querySelector("[data-art-stub='art_url']"), "art"));
    const payload = await save("createCardAction");
    expect(payload.deck_id ?? null).toBeNull();
  });
});

describe("Save & next on an edit never drops what was typed during the save (DK5.18 re-check)", () => {
  function hostWithNext() {
    const host = makeHost();
    const onNext = vi.fn();
    host.saveAndNext = { label: "Save & next", onNext };
    return { host, onNext };
  }
  const saveAndNext = () => screen.getByRole("button", { name: /Save & next/ }) as HTMLButtonElement;

  it("keystrokes made while the save was in flight: saved, no walk — the newer text stays, unsent and guarded", async () => {
    let land!: () => void;
    actions.updateCardAction.mockImplementation(
      () => new Promise((resolve) => (land = () => resolve({ ok: true, cardId: CARD_ID, slug: "saved" }))),
    );
    const { host, onNext } = hostWithNext();
    renderForm({ mode: "edit", card: storedCard(), host });
    await type("flavor_text", "The river keeps what it is paid.");
    await waitFor(() => expect(saveAndNext().disabled).toBe(false));
    await click(saveAndNext());
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    await type("flavor_text", "The river keeps what it is paid, and more.");
    await act(async () => land());
    await waitFor(() => expect(host.onSaved).toHaveBeenCalledTimes(1));
    expect(onNext).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith(expect.stringMatching(/save again to move on/i));
    expect(document.querySelector<HTMLTextAreaElement>("[name='flavor_text']")?.value).toBe("The river keeps what it is paid, and more.");
    // Still a change to save: Save is on, and the guard still asks.
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const ask = (host.bindLeave as ReturnType<typeof vi.fn>).mock.calls.map(([fn]) => fn).filter(Boolean).at(-1) as
      | ((proceed: () => void) => boolean)
      | undefined;
    const proceed = vi.fn();
    expect(ask?.(proceed)).toBe(true);
    expect(proceed).not.toHaveBeenCalled();
  });

  it("nothing typed during the save: it walks on", async () => {
    const { host, onNext } = hostWithNext();
    renderForm({ mode: "edit", card: storedCard(), host });
    await type("flavor_text", "The river keeps what it is paid.");
    await waitFor(() => expect(saveAndNext().disabled).toBe(false));
    await click(saveAndNext());
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(host.onSaved).toHaveBeenCalledTimes(1);
  });
});

