// @vitest-environment happy-dom
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The card creator's save + kind-change plumbing, driven through the real
// CardCreatorForm (TODO Phase 3b "Creator wizard bugs"). The server actions,
// the router, the billing providers and the heavy dialogs are stubbed; the
// form, its panels and its react-hook-form state are the real thing.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/create",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@next/third-parties/google", () => ({ sendGAEvent: vi.fn() }));
vi.mock("@/components/billing/upgrade-modal-provider", () => ({
  useUpgradeModal: () => ({ open: vi.fn() }),
}));
vi.mock("@/components/billing/credit-confirm-provider", () => ({
  useCreditConfirm: () => async () => true,
}));

const actions = vi.hoisted(() => ({
  createCardAction: vi.fn(),
  updateCardAction: vi.fn(),
  linkDeckCardAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: actions.linkDeckCardAction,
}));

// The dialogs the tests don't drive render nothing; the Ideas dialog is a
// button that applies whatever patch the test put in `ideas.patch`.
const ideas = vi.hoisted(() => ({ patch: {} as Record<string, unknown> }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
}));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: () => null,
}));
vi.mock("@/components/creator/card-ideas-dialog", () => ({
  CardIdeasDialog: ({ onApply }: { onApply: (patch: unknown) => void }) => (
    <button type="button" onClick={() => onApply(ideas.patch)}>
      test: apply idea
    </button>
  ),
}));
// The live preview is covered by its own tests; here it only has to exist.
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardCreatorForm } from "@/components/creator/card-creator-form";

const GAME = "33333333-3333-4333-8333-333333333333";
const CARD_ID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const GAME_SYSTEMS = [
  { id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem,
];
const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const VERIFIED = [
  "m15",
  "m15artifact",
  "m15land",
  "m15pw",
  "m15token",
  "saga",
  "battle",
  "split",
  "aftermath",
  "adventure",
  "flip",
].flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t, k)));

function savedCard(overrides: Partial<Record<string, unknown>> = {}): Card {
  return {
    id: CARD_ID,
    owner_id: USER,
    title: "Emberbound Wyrm",
    slug: "emberbound-wyrm",
    game_system_id: GAME,
    cost: "{2}{R}{R}",
    color_identity: ["red"],
    supertype: null,
    card_type: "creature",
    subtypes: ["Dragon"],
    tags: [],
    rarity: "rare",
    rules_text: "Flying",
    flavor_text: null,
    power: "5",
    toughness: "4",
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: "https://example.com/art.png",
    art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
    frame_style: { finish: "regular", template: "m15" },
    visibility: "private",
    back_face: null,
    back_card_id: null,
    source_scryfall_id: null,
    set_icon_url: null,
    set_icon_code: null,
    face_content: null,
    watermark: null,
    footer_text: null,
    updated_at: "2026-09-26T10:00:00.000Z",
    ...overrides,
  } as unknown as Card;
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p data-testid="error-boundary">{this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

type FormProps = Parameters<typeof CardCreatorForm>[0];

function renderForm(props: Partial<FormProps> = {}) {
  const all: FormProps = {
    mode: "create",
    userId: USER,
    ownerUsername: "tester",
    gameSystems: GAME_SYSTEMS,
    aiConfigured: true,
    verifiedFrameKeys: VERIFIED,
    ...props,
  };
  const view = render(
    <Boundary>
      <CardCreatorForm {...all} />
    </Boundary>,
  );
  return {
    ...view,
    rerenderWith: (next: Partial<FormProps>) =>
      view.rerender(
        <Boundary>
          <CardCreatorForm {...all} {...next} />
        </Boundary>,
      ),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of [...Object.values(toast), ...Object.values(router), ...Object.values(actions)]) {
    fn.mockReset();
  }
  ideas.patch = {};
});

const titleInput = () =>
  screen.getByPlaceholderText("Emberbound Wyrm") as HTMLInputElement;
const saveButton = () =>
  screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement;

async function typeTitle(value: string) {
  await act(async () => {
    fireEvent.change(titleInput(), { target: { value } });
  });
}

async function clickSave() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
}

// ---------------------------------------------------------------------------
// 3b.1 — a save request that THROWS (offline, a 5xx, a stale action id after
// a deploy) used to escape the transition and reach the error boundary,
// unmounting the editor and the unsaved card with it.
// ---------------------------------------------------------------------------

describe("3b.1 a failed save request keeps the editor", () => {
  it("edit: the form stays mounted with the typed values and says what happened", async () => {
    actions.updateCardAction.mockRejectedValue(new TypeError("Failed to fetch"));
    renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm, Reborn");
    await clickSave();

    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach PipGlyph to save/),
    );
    expect(screen.queryByTestId("error-boundary")).toBeNull();
    expect(titleInput().value).toBe("Emberbound Wyrm, Reborn");
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Your card is still here/));
    expect(router.refresh).not.toHaveBeenCalled();
    // Still dirty, so Save is offered again.
    expect(saveButton().disabled).toBe(false);
  });

  it("remix (create path): the form stays mounted with the typed values", async () => {
    actions.createCardAction.mockRejectedValue(new Error("Server Action not found"));
    renderForm({ mode: "remix", card: savedCard({ visibility: "public" }) });
    await typeTitle("Wyrm of the Second Dawn");
    await clickSave();

    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach PipGlyph to save/),
    );
    expect(screen.queryByTestId("error-boundary")).toBeNull();
    expect(titleInput().value).toBe("Wyrm of the Second Dawn");
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a saved card whose follow-up link request throws still reports the save and moves on", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "wyrm-of-the-second-dawn",
    });
    actions.updateCardAction.mockRejectedValue(new TypeError("Failed to fetch"));
    renderForm({
      mode: "remix",
      card: savedCard({ visibility: "public" }),
      backForCardId: "55555555-5555-4555-8555-555555555555",
      backForSlug: "tester/front-card",
    });
    await typeTitle("Wyrm of the Second Dawn");
    await clickSave();

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith("/card/tester/front-card/edit?step=publish");
    expect(toast.error).toHaveBeenCalledWith("Saved, but couldn't link it as the back face.");
    expect(screen.queryByTestId("error-boundary")).toBeNull();
  });
});
