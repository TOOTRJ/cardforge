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

function chipIn(group: string, label: RegExp) {
  const radiogroup = screen.getByRole("radiogroup", { name: group });
  const chip = Array.from(radiogroup.querySelectorAll("[role='radio']")).find(
    (el) => label.test(el.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
  if (!chip) throw new Error(`no ${group} chip ${label}`);
  return chip;
}

async function clickChip(group: string, label: RegExp) {
  const chip = chipIn(group, label);
  await act(async () => {
    fireEvent.click(chip);
  });
}

const pickKind = (label: RegExp) => clickChip("Card type", label);

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
      expect(screen.getByRole("alert").textContent).toMatch(/The save didn.t go through/),
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
      expect(screen.getByRole("alert").textContent).toMatch(/The save didn.t go through/),
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

// ---------------------------------------------------------------------------
// 3b.4 — a dual land with no rules text yet was read as a basic of its first
// type: the Text step became the land-icon step (no rules box to type in)
// and the Nonbasic chip snapped back to Basic.
// ---------------------------------------------------------------------------

describe("3b.4 dual lands are nonbasic", () => {
  it("Tundra — Plains Island gets a rules box and stays Nonbasic", async () => {
    renderForm({ mode: "create" });
    await clickChip("Color identity", /^white/i);
    await pickKind(/^Land/);
    expect(chipIn("Land type", /^Basic/).getAttribute("aria-checked")).toBe("true");
    await clickChip("Land type", /^Nonbasic/);
    expect(chipIn("Land type", /^Nonbasic/).getAttribute("aria-checked")).toBe("true");

    await clickNext(); // Card → Identity
    await typeTitle("Tundra");
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), {
        target: { value: "Plains, Island" },
      });
    });
    await clickNext(); // Identity → Text
    expect(screen.getByLabelText("Rules text")).toBeTruthy();
    expect(screen.queryByText("Land icon")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    expect(chipIn("Land type", /^Nonbasic/).getAttribute("aria-checked")).toBe("true");
  });

  it("a single basic type with no supertype is still the basic-land icon step", async () => {
    renderForm({ mode: "create" });
    await clickChip("Color identity", /^green/i);
    await pickKind(/^Land/);
    await clickChip("Land type", /^Nonbasic/);
    await clickNext();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), {
        target: { value: "Forest" },
      });
    });
    await clickNext();
    expect(screen.getByText("Land icon")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3b.5 — the inline frames' second-face name (Adventure spell, split /
// aftermath / flip half) was silently required for ANY save: Save stayed
// enabled, the save failed on a field folded away in the Identity step's
// "More options", and the leave dialog's "Save as draft" closed before the
// failed submit. [decide] implemented as the recommendation: a draft may be
// saved without it; publishing needs it.
// ---------------------------------------------------------------------------

const saveHint = () =>
  screen.queryByText(/to enable Save\.$/, { selector: "p" })?.textContent ?? null;

async function goToLastStep() {
  while (screen.queryByRole("button", { name: /^Next/ })) {
    await clickNext();
  }
}

const SPLIT_CARD = {
  title: "Fire",
  card_type: "instant",
  subtypes: [],
  power: null,
  toughness: null,
  rules_text: "Fire deals 2 damage divided as you choose among one or two targets.",
  frame_style: { finish: "regular", template: "split" },
  back_face: { title: "Ice", card_type: "instant", rules_text: "Tap target permanent." },
};

describe("3b.5 the second face's name", () => {
  it("publishing a split card lists the missing name; a draft saves without it", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "fire",
    });
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    await clickNext(); // Identity
    await typeTitle("Fire");
    expect(saveHint()).toBe("Add artwork and the second face's name to enable Save.");
    expect(saveButton().disabled).toBe(true);

    await goToLastStep();
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    expect(saveHint()).toBeNull();
    expect(saveButton().disabled).toBe(false);
    await clickSave();

    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0];
    expect(payload.visibility).toBe("private");
    expect(payload.back_face.title).toBe("");
    expect(payload.back_face.card_type).toBeTruthy();
  });

  it("the section holding a missing second-face name opens without an error", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    await clickNext(); // Identity
    // The Save hint asks for the name, so its folded section is open.
    const details = screen
      .getByText(/More options — artist credit & second face/)
      .closest("details") as HTMLDetailsElement;
    expect(saveHint()).toMatch(/the second face's name/);
    expect(details.open).toBe(true);
  });

  it("a named second face leaves the section folded", async () => {
    renderForm({ mode: "edit", card: savedCard({ ...SPLIT_CARD, visibility: "public" }) });
    const details = screen
      .getByText(/More options — artist credit & second face/)
      .closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
  });

  it("an Adventure names what's missing as the adventure", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Adventure/);
    await clickNext();
    await typeTitle("Bonecrusher Giant");
    expect(saveHint()).toBe("Add artwork and the adventure's name to enable Save.");
  });

  it("edit: clearing a public card's second-face name disables Save and says why", async () => {
    renderForm({ mode: "edit", card: savedCard({ ...SPLIT_CARD, visibility: "public" }) });
    // Identity step → More options → the second face's name field.
    const nameInput = screen.getByPlaceholderText("Insectile Aberration") as HTMLInputElement;
    expect(nameInput.value).toBe("Ice");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "" } });
    });
    expect(saveHint()).toBe("Add the second face's name to enable Save.");
    expect(saveButton().disabled).toBe(true);
  });

  it("a subtypes error opens the Identity step's folded More options too", async () => {
    renderForm({ mode: "create" });
    await clickNext(); // Identity
    await typeTitle("Too Many Types");
    const details = screen
      .getByText("More options — supertype, subtypes")
      .closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), {
        target: { value: "A, B, C, D, E, F, G, H, I, J, K" },
      });
    });
    await goToLastStep();
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    await clickSave();
    // Client validation jumps back to Identity and unfolds the field.
    await waitFor(() =>
      expect(
        (
          screen
            .getByText("More options — supertype, subtypes")
            .closest("details") as HTMLDetailsElement
        ).open,
      ).toBe(true),
    );
    expect(screen.getByText("A card can have up to 10 subtypes.")).toBeTruthy();
    expect(actions.createCardAction).not.toHaveBeenCalled();
  });

  it("a second-face error opens the folded More options that holds the field", async () => {
    actions.updateCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { "back_face.title": "That name is taken by the front face." },
    });
    renderForm({ mode: "edit", card: savedCard({ ...SPLIT_CARD, visibility: "private" }) });
    const details = screen.getByText(/More options — artist credit & second face/).closest(
      "details",
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await typeTitle("Fire, Again");
    await clickSave();

    await waitFor(() => expect(details.open).toBe(true));
    expect(screen.getByText("That name is taken by the front face.")).toBeTruthy();
  });

  it("the leave dialog stays open through a failed save, says why, and continues only after a successful one", async () => {
    actions.updateCardAction
      .mockResolvedValueOnce({ ok: false, formError: "The server said no." })
      .mockResolvedValueOnce({ ok: true, slug: "emberbound-wyrm" });
    renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm, Reborn");
    // An in-app link while dirty → the guard asks.
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Leave without saving\?/);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    });
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    // Still open, with the reason; nothing navigated.
    expect(screen.getByRole("dialog")).toBeTruthy();
    await waitFor(() =>
      expect(
        Array.from(screen.getByRole("dialog").querySelectorAll("[role='alert']")).map(
          (el) => el.textContent,
        ),
      ).toContain("The server said no."),
    );
    expect(router.push).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/go/card/${CARD_ID}`));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 3b.6 — an edit save marked the form clean, then router.refresh() brought a
// new updated_at and the keyed reset called reset(defaults): anything typed
// between the click and the refresh vanished.
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const statusBadge = () =>
  screen.queryByText("Unsaved changes") ? "Unsaved changes" : screen.queryByText("Up to date") ? "Up to date" : null;

describe("3b.6 an edit save keeps keystrokes typed before the refresh lands", () => {
  const LATER = "2026-09-26T10:05:00.000Z";

  it("typed while the request was in flight: kept and still unsaved after the refresh", async () => {
    const pending = deferred<unknown>();
    actions.updateCardAction.mockReturnValue(pending.promise);
    const view = renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm II");
    await clickSave();
    await typeTitle("Emberbound Wyrm III"); // mid-request
    await act(async () => {
      pending.resolve({ ok: true, slug: "emberbound-wyrm" });
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(statusBadge()).toBe("Unsaved changes");

    // The refresh lands: the server has what was SENT.
    await act(async () => {
      view.rerenderWith({
        card: savedCard({ title: "Emberbound Wyrm II", updated_at: LATER }),
      });
    });
    expect(titleInput().value).toBe("Emberbound Wyrm III");
    expect(statusBadge()).toBe("Unsaved changes");
    expect(saveButton().disabled).toBe(false);
  });

  it("typed after the save, before the refresh: kept", async () => {
    actions.updateCardAction.mockResolvedValue({ ok: true, slug: "emberbound-wyrm" });
    const view = renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm II");
    await clickSave();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(statusBadge()).toBe("Up to date");
    await typeTitle("Emberbound Wyrm II, typed on");

    await act(async () => {
      view.rerenderWith({
        card: savedCard({ title: "Emberbound Wyrm II", updated_at: LATER }),
      });
    });
    expect(titleInput().value).toBe("Emberbound Wyrm II, typed on");
    expect(statusBadge()).toBe("Unsaved changes");
    // Typing back to the saved value is clean again (the baseline moved).
    await typeTitle("Emberbound Wyrm II");
    expect(statusBadge()).toBe("Up to date");
  });

  it("nothing typed: the refresh swaps in server truth", async () => {
    actions.updateCardAction.mockResolvedValue({ ok: true, slug: "emberbound-wyrm" });
    const view = renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm II ");
    await clickSave();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    await act(async () => {
      view.rerenderWith({
        card: savedCard({ title: "Emberbound Wyrm II", updated_at: LATER }),
      });
    });
    expect(titleInput().value).toBe("Emberbound Wyrm II");
    expect(statusBadge()).toBe("Up to date");
  });

  it("another card always resets, even with unsaved edits", async () => {
    const view = renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Half-finished edit");
    await act(async () => {
      view.rerenderWith({
        card: savedCard({
          id: "66666666-6666-4666-8666-666666666666",
          title: "Grizzly Bears",
          slug: "grizzly-bears",
        }),
      });
    });
    expect(titleInput().value).toBe("Grizzly Bears");
    expect(statusBadge()).toBe("Up to date");
  });
});

// ---------------------------------------------------------------------------
// 3b.7 — the guard's Back sentinel (pushed while dirty) outlived the save:
// Back had to be pressed twice after an edit save, and a create's redirect
// left Back pointing at a blank /create. The save now pops it first.
// ---------------------------------------------------------------------------

describe("3b.7 a save takes the Back sentinel off before navigating", () => {
  const isSentinel = (call: unknown[]) =>
    (call[0] as { pipglyphUnsavedGuard?: boolean } | null)?.pipglyphUnsavedGuard === true;

  function spyHistory() {
    const pushState = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      setTimeout(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })), 0);
    });
    return { pushState, back };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("edit: the sentinel is popped once, before the refresh", async () => {
    const { pushState, back } = spyHistory();
    actions.updateCardAction.mockResolvedValue({ ok: true, slug: "emberbound-wyrm" });
    renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm II");
    expect(pushState.mock.calls.filter(isSentinel)).toHaveLength(1);
    await clickSave();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(back).toHaveBeenCalledTimes(1);
    expect(back.mock.invocationCallOrder[0]).toBeLessThan(
      router.refresh.mock.invocationCallOrder[0],
    );
  });

  it("create path: popped before the redirect", async () => {
    const { back } = spyHistory();
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "wyrm-of-the-second-dawn",
    });
    actions.updateCardAction.mockResolvedValue({ ok: true, slug: "front-card" });
    renderForm({
      mode: "remix",
      card: savedCard({ visibility: "public" }),
      backForCardId: "55555555-5555-4555-8555-555555555555",
      backForSlug: "tester/front-card",
    });
    await typeTitle("Wyrm of the Second Dawn");
    await clickSave();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(back).toHaveBeenCalledTimes(1);
    expect(back.mock.invocationCallOrder[0]).toBeLessThan(
      router.replace.mock.invocationCallOrder[0],
    );
  });

  it("a link's \"Leave without saving\" pops the sentinel once, before navigating", async () => {
    const { back } = spyHistory();
    renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm II");
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    });
    await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/go/card/${CARD_ID}`));
    expect(back).toHaveBeenCalledTimes(1);
    expect(back.mock.invocationCallOrder[0]).toBeLessThan(
      router.push.mock.invocationCallOrder[0],
    );
    expect(actions.updateCardAction).not.toHaveBeenCalled();
  });

  it("keystrokes typed during the save keep their guard (and its sentinel)", async () => {
    const { back } = spyHistory();
    const pending = deferred<unknown>();
    actions.updateCardAction.mockReturnValue(pending.promise);
    renderForm({ mode: "edit", card: savedCard() });
    await typeTitle("Emberbound Wyrm II");
    await clickSave();
    await typeTitle("Emberbound Wyrm III");
    await act(async () => {
      pending.resolve({ ok: true, slug: "emberbound-wyrm" });
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(back).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3b.8 — a split / aftermath card's second half defaulted to "Creature"
// (EMPTY_BACK_FACE) and was saved that way.
// ---------------------------------------------------------------------------

describe("3b.8 the second half is typed from the kind", () => {
  it("split → instant, aftermath → sorcery, and a Clear keeps the kind's type", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    expect(preview().backFace?.card_type).toBe("instant");
    await pickKind(/^Aftermath/);
    expect(preview().backFace?.card_type).toBe("sorcery");

    // Give the half some content, then clear it.
    await clickNext();
    const nameInput = screen.getByPlaceholderText("Insectile Aberration");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Dawn" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear second face" }));
    });
    expect(preview().backFace?.title).toBe("");
    expect(preview().backFace?.card_type).toBe("sorcery");
  });

  it("a second half the user already wrote keeps its own type across a kind change", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    await clickNext();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Insectile Aberration"), {
        target: { value: "Ice" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await pickKind(/^Aftermath/);
    expect(preview().backFace).toMatchObject({ title: "Ice", card_type: "instant" });
  });

  it("a split card saves its untouched second half as an instant", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "fire",
    });
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    await clickNext();
    await typeTitle("Fire");
    await goToLastStep();
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    await clickSave();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0][0].back_face.card_type).toBe("instant");
  });
});

// ---------------------------------------------------------------------------
// The leave dialog's "Save as draft" on /create?deckCard= or ?backFor= used
// to return before the link step: the card saved, but never landed in the
// deck (or on the front card). The link now runs first, then the navigation
// the user was attempting.
// ---------------------------------------------------------------------------

describe("a save from the leave dialog still links the new card", () => {
  const NEW_CARD = "44444444-4444-4444-8444-444444444444";
  const FRONT_CARD = "55555555-5555-4555-8555-555555555555";

  async function leaveViaLinkAndSaveDraft() {
    const anchor = document.createElement("a");
    anchor.href = "/dashboard";
    anchor.textContent = "Dashboard";
    document.body.appendChild(anchor);
    try {
      await act(async () => {
        fireEvent.click(anchor);
      });
      await screen.findByRole("dialog");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Save as draft/ }));
      });
      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard"));
    } finally {
      anchor.remove();
    }
  }

  it("a back face is linked to its front, then the leave continues", async () => {
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: NEW_CARD, slug: "the-back" });
    actions.updateCardAction.mockResolvedValue({ ok: true, slug: "front-card" });
    renderForm({ mode: "create", backForCardId: FRONT_CARD, backForSlug: "tester/front-card" });
    await clickNext(); // Identity
    await typeTitle("The Back");
    await leaveViaLinkAndSaveDraft();

    expect(actions.createCardAction).toHaveBeenCalledTimes(1);
    expect(actions.updateCardAction).toHaveBeenCalledWith(FRONT_CARD, { back_card_id: NEW_CARD });
    expect(actions.updateCardAction.mock.invocationCallOrder[0]).toBeLessThan(
      router.push.mock.invocationCallOrder[0],
    );
    // The dialog's destination wins over the flow's own "back to the front".
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a deck proxy is linked into its deck, then the leave continues", async () => {
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: NEW_CARD, slug: "my-bolt" });
    actions.linkDeckCardAction.mockResolvedValue({ ok: true });
    renderForm({
      mode: "create",
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: null,
        deckSlug: "tester/burn",
        deckTitle: "Burn",
        entryName: "Lightning Bolt",
      },
    });
    await clickNext(); // Identity
    await typeTitle("My Bolt");
    await leaveViaLinkAndSaveDraft();

    expect(actions.linkDeckCardAction).toHaveBeenCalledWith(
      "66666666-6666-4666-8666-666666666666",
      NEW_CARD,
    );
    expect(actions.linkDeckCardAction.mock.invocationCallOrder[0]).toBeLessThan(
      router.push.mock.invocationCallOrder[0],
    );
    expect(toast.success).toHaveBeenCalledWith("Linked into “Burn”.");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
