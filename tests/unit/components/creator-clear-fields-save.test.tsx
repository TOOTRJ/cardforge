// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// An EMPTIED optional text through the real CardCreatorForm (bug 2026-10-12:
// a flavor text emptied on /card/<slug>/edit came back on reload). The form
// used to send `undefined` for every empty optional text, which the update
// action reads as "leave the column alone". An EDIT now says null for a
// field it holds empty — cost, rules, flavor, the stats its type prints,
// artist, art — and the action clears the column; a NEW card and a remix
// still leave an empty field out (createCardSchema takes no null). Harness:
// creator-anatomy-save.test.tsx.
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
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem];
const VERIFIED = ["m15", "m15pw"].flatMap((t) =>
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
    flavor_text: "\"Hold the line.\"",
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

function renderForm(mode: "create" | "edit" | "remix", card?: Card) {
  return render(
    <CardCreatorForm
      mode={mode}
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
  actions.updateCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
  actions.createCardAction.mockResolvedValue({ ok: true, cardId: CARD_ID, slug: "kesh" });
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
const field = (name: string) => {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) throw new Error(`no field named ${name}`);
  return el as HTMLInputElement | HTMLTextAreaElement;
};
const type = async (name: string, value: string) => {
  await act(async () => {
    fireEvent.change(field(name), { target: { value } });
  });
};
/** The pip editors (rules text, a walker's rows) are contenteditable boxes
 *  named by `data-field`. */
const typeRich = async (name: string, value: string) => {
  const el = document.querySelector(`[data-field="${name}"]`);
  if (!el) throw new Error(`no editor named ${name}`);
  await act(async () => {
    el.textContent = value;
    fireEvent.input(el);
  });
};
const goTo = async (step: string) => {
  await act(async () => {
    fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
  });
};
const sentUpdate = async () => {
  await save();
  await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
  return actions.updateCardAction.mock.calls[0][1] as Record<string, unknown>;
};

describe("an edit that empties a field sends null for it", () => {
  it("the flavor text", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await type("flavor_text", "");
    const payload = await sentUpdate();
    expect(payload.flavor_text).toBeNull();
    // What was left alone travels as it is stored.
    expect(payload.rules_text).toBe("Haste");
    expect(payload.power).toBe("3");
    expect(payload.cost).toBe("{2}{R}{R}");
  });

  it("a field of spaces is an emptied field", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await type("flavor_text", "   ");
    expect((await sentUpdate()).flavor_text).toBeNull();
  });

  it("rules text, power, toughness and the artist credit", async () => {
    renderForm("edit", savedCard());
    await type("artist_credit", "");
    await goTo("Text & stats");
    await typeRich("rules_text", "");
    await type("power", "");
    await type("toughness", "");
    const payload = await sentUpdate();
    expect(payload).toMatchObject({ rules_text: null, power: null, toughness: null, artist_credit: null });
    expect(payload.flavor_text).toBe("\"Hold the line.\"");
  });

  it("a stat the card's type does not print is never sent — the stored one stays", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await type("flavor_text", "");
    const payload = await sentUpdate();
    expect(payload.loyalty).toBeUndefined();
    expect(payload.defense).toBeUndefined();
  });

  it("a planeswalker's loyalty, and its rows once every one is emptied", async () => {
    renderForm(
      "edit",
      savedCard({
        card_type: "planeswalker",
        subtypes: ["Kesh"],
        power: null,
        toughness: null,
        loyalty: "4",
        rules_text: "+1: Draw a card.",
        face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }] } },
        frame_style: { finish: "regular", template: "m15pw" },
      }),
    );
    await goTo("Text & stats");
    await type("loyalty", "");
    await typeRich("loyalty_abilities.0.text", "");
    const payload = await sentUpdate();
    expect(payload.loyalty).toBeNull();
    expect(payload.face_content).toBeNull();
    // Not the stored copy of the rows, which would bring them back.
    expect(payload.rules_text).toBeNull();
    expect(payload.power).toBeUndefined();
  });
});

describe("a new card and a remix leave an empty field out", () => {
  it("a remix with its flavor text emptied", async () => {
    renderForm("remix", savedCard());
    await type("artist_credit", "");
    await goTo("Text & stats");
    await type("flavor_text", "");
    await save();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.flavor_text).toBeUndefined();
    expect(payload.artist_credit).toBeUndefined();
    // The stored texts it kept still travel.
    expect(payload.rules_text).toBe("Haste");
    expect(actions.updateCardAction).not.toHaveBeenCalled();
  });
});
