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
// The live preview is covered by its own tests; here it reports the watched
// form values it was handed, which is what the assertions read.
vi.mock("@/components/cards/card-preview", () => ({
  CardPreview: (props: {
    title?: string;
    cardType?: string | null;
    rulesText?: string;
    frameStyle?: { template?: string };
    faceContent?: unknown;
    backFace?: { title?: string; card_type?: string } | null;
  }) => (
    <div
      data-testid="card-preview"
      data-title={props.title ?? ""}
      data-card-type={props.cardType ?? ""}
      data-template={props.frameStyle?.template ?? ""}
      data-rules={props.rulesText ?? ""}
      data-face-content={JSON.stringify(props.faceContent ?? null)}
      data-back-face={JSON.stringify(props.backFace ?? null)}
    />
  ),
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

/** What the live preview was last handed (desktop and mobile get the same). */
function preview() {
  const el = screen.getAllByTestId("card-preview")[0];
  return {
    title: el.dataset.title,
    cardType: el.dataset.cardType,
    template: el.dataset.template,
    rules: el.dataset.rules,
    faceContent: JSON.parse(el.dataset.faceContent ?? "null"),
    backFace: JSON.parse(el.dataset.backFace ?? "null"),
  };
}

async function pickKind(label: RegExp) {
  const group = screen.getByRole("radiogroup", { name: "Card type" });
  const chip = Array.from(group.querySelectorAll("[role='radio']")).find((el) =>
    label.test(el.textContent ?? ""),
  );
  if (!chip) throw new Error(`no kind chip ${label}`);
  await act(async () => {
    fireEvent.click(chip);
  });
}

async function applyIdea(patch: Record<string, unknown>) {
  ideas.patch = patch;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "test: apply idea" }));
  });
}

const WALKER_IDEA = {
  title: "Tamsin, Tide-Reader",
  card_type: "planeswalker",
  supertype: "Legendary",
  subtypes_text: "Tamsin",
  cost: "{2}{U}{U}",
  color_identity: ["blue"],
  rarity: "mythic",
  rules_text: "+1: Draw a card.\n−2: Tap target creature.\n−7: You get an emblem.",
  flavor_text: "",
  power: "",
  toughness: "",
  loyalty: "4",
  defense: "",
};

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

// ---------------------------------------------------------------------------
// 3b.2 — the Ideas dialog wrote card_type straight into the form, bypassing
// the kind-change path (the only writer of the frame): a planeswalker idea
// on the default frame saved as card_type planeswalker on plain m15.
// ---------------------------------------------------------------------------

describe("3b.2 an idea's card type goes through the kind change", () => {
  it("a planeswalker idea on the default creature frame moves to the planeswalker frame", async () => {
    renderForm({ mode: "create" });
    expect(preview().template).toBe("m15");
    await applyIdea(WALKER_IDEA);

    expect(preview().cardType).toBe("planeswalker");
    expect(preview().template).toBe("m15pw");
    expect(preview().title).toBe("Tamsin, Tide-Reader");
    // The ability rows are seeded from the idea's rules, so the preview
    // prints loyalty rows.
    expect(preview().faceContent?.loyalty?.abilities).toHaveLength(3);
    expect(preview().faceContent.loyalty.abilities[0]).toEqual({
      cost: "+1",
      text: "Draw a card.",
    });
  });

  it("an idea the current kind already prints keeps the kind and its frame", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Saga/);
    expect(preview().template).toBe("saga");
    await applyIdea({
      ...WALKER_IDEA,
      title: "The Drowned Archive",
      card_type: "enchantment",
      supertype: "",
      subtypes_text: "Saga",
      rules_text:
        "I — Draw a card.\nII — Scry 2.\nIII — Return target creature to its owner's hand.",
      loyalty: "",
    });
    expect(preview().template).toBe("saga");
    expect(preview().cardType).toBe("enchantment");
    expect(preview().faceContent?.saga?.chapters).toHaveLength(3);
  });

  it("an idea of another type leaves a layout kind the way a kind chip would", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    expect(preview().template).toBe("split");
    await applyIdea({
      ...WALKER_IDEA,
      card_type: "creature",
      supertype: "",
      subtypes_text: "Merfolk",
      loyalty: "",
      power: "2",
      toughness: "2",
    });
    expect(preview().cardType).toBe("creature");
    expect(preview().template).toBe("m15");
    // Leaving the split frame drops its intrinsic second half.
    expect(preview().backFace).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3b.3 — the loyalty / saga rows outlived their kind: they folded into
// rules_text on the way out but stayed in the form, so a return trip skipped
// the re-seed and resubmitted the stale rows; and the "frames unpublished"
// early return changed the type without folding at all.
// ---------------------------------------------------------------------------

async function clickNext(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
}

describe("3b.3 structured rows fold, empty, and re-seed across kind changes", () => {
  it("planeswalker → creature → new text → planeswalker re-seeds from the new text", async () => {
    renderForm({ mode: "create" });
    await applyIdea(WALKER_IDEA);
    expect(preview().faceContent.loyalty.abilities).toHaveLength(3);

    await pickKind(/^Creature/);
    expect(preview().template).toBe("m15");
    expect(preview().faceContent).toBeNull();
    expect(preview().rules).toMatch(/^\+1: Draw a card\./);

    // New creature text (an idea of the same type changes no kind).
    await applyIdea({ card_type: "creature", rules_text: "Flying." });
    expect(preview().rules).toBe("Flying.");

    await pickKind(/^Planeswalker/);
    expect(preview().template).toBe("m15pw");
    // Before the fix the three stale abilities came back here.
    expect(preview().faceContent.loyalty.abilities).toEqual([
      { cost: null, text: "Flying." },
    ]);
  });

  it("a saga's intro and chapters fold into the rules and leave the editor empty", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Saga/);
    await applyIdea({
      card_type: "enchantment",
      rules_text: "(As this Saga enters, add a lore counter.)\nI — Draw a card.\nII — Scry 2.",
    });
    expect(preview().faceContent.saga.chapters).toHaveLength(2);

    await pickKind(/^Enchantment/);
    expect(preview().faceContent).toBeNull();
    expect(preview().rules).toBe(
      "(As this Saga enters, add a lore counter.)\nI — Draw a card.\nII — Scry 2.",
    );

    await applyIdea({ card_type: "enchantment", rules_text: "Creatures you control get +1/+1." });
    await pickKind(/^Saga/);
    expect(preview().faceContent?.saga?.chapters ?? []).toHaveLength(0);
    expect(preview().rules).toBe("Creatures you control get +1/+1.");
  });

  it("a type change whose frames are unpublished still folds the rows first", async () => {
    renderForm({
      mode: "create",
      verifiedFrameKeys: VERIFIED.filter((key) => !key.startsWith("battle")),
    });
    await applyIdea(WALKER_IDEA);
    // Edit the first ability's cost so the rows differ from the rules text.
    await clickNext(2); // Card → Identity → Text
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Ability 1 loyalty cost"), {
        target: { value: "+2" },
      });
    });
    expect(preview().faceContent.loyalty.abilities[0].cost).toBe("+2");

    // No battle frame is published: the type changes, the frame stays.
    await applyIdea({ card_type: "battle", defense: "5" });
    expect(toast.info).toHaveBeenCalledWith(
      "That card type's frames aren't published yet — keeping the current frame.",
    );
    expect(preview().cardType).toBe("battle");
    expect(preview().template).toBe("m15pw");
    expect(preview().faceContent).toBeNull();
    // The edited rows survive as the rules text (they used to be dropped).
    expect(preview().rules).toMatch(/^\+2: Draw a card\./);
  });
});
