// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 4.9a through the real CardCreatorForm (skeptic 2026-09-30): the
// "Set & collector info" step shows the three stored fields on an EDIT, an
// edit's payload carries exactly what the step holds (the revise lists: no
// frame_style rides along), an empty field clears with null, the stored
// other language ("he") survives a save untouched, the Keyrune "Use DMU"
// offer never writes on its own, and "Fill from the printing" shows only
// for a card that came from a printing and still has an empty field.
// Harness adapted from creator-anatomy-save.test.tsx; the form reads its
// landing step from window.location.search (?step=seticon).
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/card/kesh/edit",
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
  recordFrameRequestAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: actions.linkDeckCardAction }));
vi.mock("@/lib/frames/frame-request-actions", () => ({ recordFrameRequestAction: actions.recordFrameRequestAction }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({ ScryfallImportDialog: () => null, toastImportNotice: () => {} }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({ AiFillDialog: () => null }));
vi.mock("@/components/creator/card-ideas-dialog", () => ({ CardIdeasDialog: () => null }));
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: { setCode?: string | null; collectorNumber?: string | null; lang?: string | null }) => (
    <div
      data-testid="card-preview"
      data-set-code={props.setCode ?? ""}
      data-collector-number={props.collectorNumber ?? ""}
      data-lang={props.lang ?? ""}
    />
  ),
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15land", "m15artifact"].flatMap((t) =>
  ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k)),
);

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
    artist_credit: null,
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: "m15" },
    visibility: "public",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    set_code: "DMU",
    collector_number: "107/281",
    lang: "he",
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-09-29T10:00:00.000Z",
    ...overrides,
  } as unknown as Card;
}

function renderEdit(card: Card) {
  // The form lands on the step the URL names.
  window.history.replaceState(null, "", "/card/kesh/edit?step=seticon");
  return render(
    <CardCreatorForm
      mode="edit"
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
    />,
  );
}

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;
const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
  });
  await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
  return actions.updateCardAction.mock.calls[0][1] as Record<string, unknown>;
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) fn.mockReset();
});

describe("the Set & collector info step on an edit", () => {
  it("shows the stored code, number and the stored other language, and feeds the preview the same three", () => {
    renderEdit(savedCard());
    expect(screen.getAllByText("Set & collector info").length).toBeGreaterThan(0);
    expect(field("set_code").value).toBe("DMU");
    expect(field("collector_number").value).toBe("107/281");
    const lang = field("lang") as HTMLSelectElement;
    expect(lang.value).toBe("he");
    expect(lang.selectedOptions[0]?.textContent).toBe("Other (not printed) — he");
    // Filled fields: no Keyrune offer, no printing to fill from.
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    expect(screen.queryByRole("button", { name: /Fill from the printing/ })).toBeNull();
    const preview = screen.getAllByTestId("card-preview")[0];
    expect(preview.dataset.setCode).toBe("DMU");
    expect(preview.dataset.collectorNumber).toBe("107/281");
    expect(preview.dataset.lang).toBe("he");
  });

  it("an edited number saves with the untouched code and language, and never a frame_style", async () => {
    renderEdit(savedCard());
    await act(async () => {
      fireEvent.change(field("collector_number"), { target: { value: "108/281" } });
    });
    const payload = await save();
    expect(payload).toMatchObject({ set_code: "DMU", collector_number: "108/281", lang: "he" });
    expect(payload).not.toHaveProperty("frame_style");
    expect(payload).not.toHaveProperty("color_identity");
  });

  it("a cleared set code saves as null (the number stays), lower-case input stores upper-case", async () => {
    renderEdit(savedCard());
    await act(async () => {
      fireEvent.change(field("set_code"), { target: { value: "" } });
    });
    const payload = await save();
    expect(payload).toMatchObject({ set_code: null, collector_number: "107/281", lang: "he" });

    cleanup();
    actions.updateCardAction.mockReset().mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
    renderEdit(savedCard());
    await act(async () => {
      fireEvent.change(field("set_code"), { target: { value: " fdn " } });
    });
    expect((await save()).set_code).toBe("FDN");
  });

  it("the Keyrune symbol's 'Use DMU' is an offer: an unrelated save keeps the empty code, a click fills it", async () => {
    renderEdit(savedCard({ set_icon_code: "dmu", set_code: null, collector_number: null, lang: "en" }));
    expect(field("set_code").value).toBe("");
    expect(screen.getByRole("button", { name: /^Use DMU$/ })).toBeTruthy();
    await act(async () => {
      fireEvent.change(field("collector_number"), { target: { value: "42" } });
    });
    const untouched = await save();
    expect(untouched).toMatchObject({ set_code: null, collector_number: "42", lang: "en" });

    cleanup();
    actions.updateCardAction.mockReset().mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
    renderEdit(savedCard({ set_icon_code: "dmu", set_code: null, collector_number: null, lang: "en" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Use DMU$/ }));
    });
    expect(field("set_code").value).toBe("DMU");
    expect((await save()).set_code).toBe("DMU");
  });

  it("offers 'Fill from the printing' only on a card from a printing with an empty field", () => {
    renderEdit(
      savedCard({ source_scryfall_id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2", set_code: null, collector_number: null, lang: "en" }),
    );
    expect(screen.getByRole("button", { name: /Fill from the printing/ })).toBeTruthy();
    cleanup();
    renderEdit(savedCard({ source_scryfall_id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2" }));
    expect(screen.queryByRole("button", { name: /Fill from the printing/ })).toBeNull();
  });
});
