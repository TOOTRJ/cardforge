// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 4.6.0 through the real CardCreatorForm, with the anatomy 4.6a / 4.6b
// will declare (tests/unit/cards/anatomy-fixture.ts): what a NEW card and an
// EDIT send for the anatomy switches (owner rule 2026-09-29). A new card
// sends every switch on inside frame_style; an edit never sends frame_style
// (locked structure) and carries only a switch its owner flipped — plus, for
// a stored multicolour card, the pair pre-filled from its cost — on
// `frame_anatomy`. An ordinary edit sends nothing about them. Harness
// adapted from creator-form-reliability.test.tsx.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("../cards/anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

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
  CardPreview: (props: { frameStyle?: unknown; colorIdentity?: string[] }) => (
    <div
      data-testid="card-preview"
      data-frame-style={JSON.stringify(props.frameStyle ?? null)}
      data-colors={(props.colorIdentity ?? []).join(",")}
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
const previewStyle = () => JSON.parse(screen.getAllByTestId("card-preview")[0].dataset.frameStyle ?? "null");

describe("an edit", () => {
  it("of a stored Legendary card: the crown switch is off with the hint; switched on, only frame_anatomy is sent", async () => {
    renderForm("edit", savedCard());
    const crown = screen.getByRole("switch", { name: "Legendary crown" });
    expect(crown.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("anatomy-hint-crown")).toBeTruthy();
    await act(async () => {
      fireEvent.click(crown);
    });
    expect(previewStyle()).toMatchObject({ crown: true });
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    const [, payload] = actions.updateCardAction.mock.calls[0];
    expect(payload.frame_anatomy).toEqual({ crown: true });
    expect(payload).not.toHaveProperty("frame_style");
    expect(payload).not.toHaveProperty("color_identity");
  });

  it("a stored card its owner switched on shows the switch on, with no hint", () => {
    renderForm("edit", savedCard({ frame_style: { template: "m15", finish: "foil", crown: true } }));
    expect(screen.getByRole("switch", { name: "Legendary crown" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("anatomy-hint-crown")).toBeNull();
    expect(previewStyle()).toEqual({ template: "m15", finish: "foil", crown: true });
  });

  it("an ordinary edit sends nothing about the switches", async () => {
    renderForm("edit", savedCard());
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Emberbound Wyrm"), { target: { value: "Kesh the Second" } });
    });
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    const [, payload] = actions.updateCardAction.mock.calls[0];
    expect(payload.frame_anatomy).toBeUndefined();
    expect(payload).not.toHaveProperty("frame_style");
  });

  it("of a stored multicolour card: switching the two-colour frame on sends the pair pre-filled from the cost", async () => {
    renderForm("edit", savedCard({ color_identity: ["multicolor"], cost: "{1}{W}{U}", supertype: null }));
    expect(screen.getByTestId("anatomy-hint-twoColor")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Two-colour frame" }));
    });
    expect(screen.getAllByTestId("card-preview")[0].dataset.colors).toBe("white,blue");
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    const [, payload] = actions.updateCardAction.mock.calls[0];
    expect(payload.frame_anatomy).toEqual({ twoColor: true, pair: ["white", "blue"] });
    expect(payload).not.toHaveProperty("color_identity");
  });
});

describe("a new card", () => {
  it("starts with every switch on and sends them inside frame_style", async () => {
    renderForm("create");
    expect(previewStyle()).toMatchObject({ template: "m15", crown: true, twoColor: true });
  });

  it("a remix starts on too, keeping a switch its parent's owner turned off", () => {
    renderForm("remix", savedCard({ frame_style: { template: "m15", crown: false } }));
    expect(previewStyle()).toMatchObject({ template: "m15", crown: false, twoColor: true });
    expect(screen.getByRole("switch", { name: "Legendary crown" }).getAttribute("aria-checked")).toBe("false");
    // A remix is a new card: no stored-card hint.
    expect(screen.queryByTestId("anatomy-hint-crown")).toBeNull();
  });
});
