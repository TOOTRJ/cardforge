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
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import { chipOff } from "../helpers/chip";

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
  recordFrameRequestAction: vi.fn(),
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: actions.createCardAction,
  updateCardAction: actions.updateCardAction,
}));
vi.mock("@/lib/decks/card-actions", () => ({
  linkDeckCardAction: actions.linkDeckCardAction,
}));
vi.mock("@/lib/frames/frame-request-actions", () => ({
  recordFrameRequestAction: actions.recordFrameRequestAction,
}));

// The dialogs the tests don't drive render nothing; the Ideas dialog is a
// button that applies whatever patch the test put in `ideas.patch`.
const ideas = vi.hoisted(() => ({ patch: {} as Record<string, unknown> }));
vi.mock("@/components/creator/scryfall-import-dialog", () => ({
  ScryfallImportDialog: () => null,
  // The deck pre-fill toasts the printing's treatment notice through it.
  toastImportNotice: () => {},
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
    supertype?: string | null;
    printedTypes?: string | null;
    power?: string | null;
    rarity?: string | null;
    rulesText?: string;
    frameStyle?: { template?: string };
    faceContent?: unknown;
    backFace?: { title?: string; card_type?: string } | null;
  }) => (
    <div
      data-testid="card-preview"
      data-title={props.title ?? ""}
      data-card-type={props.cardType ?? ""}
      data-supertype={props.supertype ?? ""}
      data-printed-types={JSON.stringify(props.printedTypes ?? null)}
      data-power={props.power ?? ""}
      data-rarity={props.rarity ?? ""}
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
  // A server action always returns a promise; a bare vi.fn() returns
  // undefined, and the form's fire-and-forget `.catch` on it would throw
  // mid-import for any inexact printing (Beck // Call DGM #123 in 1.21 is a
  // nearest split) — the frame request tests override this per test.
  actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
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
    supertype: el.dataset.supertype,
    /** The Types field as typed, or null while the line is built. */
    printedTypes: JSON.parse(el.dataset.printedTypes ?? "null") as string | null,
    power: el.dataset.power,
    rarity: el.dataset.rarity,
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
    // The deck proxy's link (the one follow-up request left since the
    // /create?backFor= back-face flow went with TODO 5.2).
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "wyrm-of-the-second-dawn",
    });
    actions.linkDeckCardAction.mockRejectedValue(new TypeError("Failed to fetch"));
    renderForm({
      mode: "remix",
      card: savedCard({ visibility: "public" }),
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: null,
        deckSlug: "tester/burn",
        deckTitle: "Burn",
        entryName: "Lightning Bolt",
      },
    });
    await typeTitle("Wyrm of the Second Dawn");
    await clickSave();

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith("/deck/tester/burn");
    expect(toast.error).toHaveBeenCalledWith("Saved, but couldn't link it into the deck.");
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

  // TODO 3b.30 (owner 2026-10-13, #539's check): a row whose marker names a
  // numeral the editor has no toggle for ("I, XI —") and whose numbers were
  // changed is HELD by a save (sagaRowsLosingMarker) — but a kind switch
  // folded it into the rules text as the numbers picked, and the XI went
  // without a word. It is KEPT now: plain text can say it.
  it("a held mixed-marker row keeps its unreadable numeral when the kind leaves saga", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Saga/);
    await applyIdea({ card_type: "enchantment", rules_text: "I, XI — Both.\nII — Two." });
    const stepTo = async (step: string) => {
      await act(async () => {
        fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
      });
    };
    await stepTo("Text & stats");
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText("Chapter III for row 1")[0]);
    });
    await stepTo("Card");
    await pickKind(/^Enchantment/);
    expect(preview().faceContent).toBeNull();
    // Was "I, III — Both." — the XI dropped.
    expect(preview().rules).toBe("I, III, XI — Both.\nII — Two.");
    // …and back to saga it is the same row, its marker carried.
    await pickKind(/^Saga/);
    expect(preview().rules).toBe("I, III, XI — Both.\nII — Two.");
  });
});

// ---------------------------------------------------------------------------
// 3b.14 — a hand-made adventure was always a creature (the kind writes its
// own card type) and a flip card too: the 22 non-creature adventurers (the
// WOE Virtues…) could not be made. The Identity step offers the types the
// frame draws; the kind and the frame stay.
// ---------------------------------------------------------------------------

describe("3b.14 a layout kind's card type on the Identity step", () => {
  const stepTo = async (step: string) => {
    await act(async () => {
      fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
    });
  };

  it("a new adventure picks Enchantment: the frame stays, the P/T goes", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Adventure/);
    expect(preview().cardType).toBe("creature");
    await stepTo("Identity");
    const chips = screen.getByRole("radiogroup", { name: "Adventure card type" });
    expect(Array.from(chips.querySelectorAll("[role='radio']")).map((el) => el.textContent?.trim())).toEqual([
      "Creature",
      "Instant",
      "Sorcery",
      "Artifact",
      "Enchantment",
      "Land",
    ]);
    await act(async () => {
      fireEvent.click(chipIn("Adventure card type", /^Enchantment/));
    });
    expect(preview().cardType).toBe("enchantment");
    expect(preview().template).toBe("adventure");
    await stepTo("Text & stats");
    expect(document.querySelector('[name="power"]')).toBeNull();
    // The kind is still Adventure.
    await stepTo("Card");
    expect(chipIn("Card type", /^Adventure/).getAttribute("aria-checked")).toBe("true");
  });

  it("a new flip card offers Creature and Enchantment", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Flip/);
    await stepTo("Identity");
    await act(async () => {
      fireEvent.click(chipIn("Flip card type", /^Enchantment/));
    });
    expect(preview().cardType).toBe("enchantment");
    expect(preview().template).toBe("flip");
  });

  it("no chips on another kind, nor on an edit (the card type is locked)", async () => {
    renderForm({ mode: "create" });
    await stepTo("Identity");
    expect(screen.queryByRole("radiogroup", { name: /card type$/ })).toBeNull();
    cleanup();
    renderForm({
      mode: "edit",
      card: savedCard({ frame_style: { finish: "regular", template: "adventure" }, back_face: { title: "Spell", card_type: "instant" } }),
    });
    expect(screen.queryByRole("radiogroup", { name: "Adventure card type" })).toBeNull();
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
    expect(screen.getByRole("textbox", { name: "Rules text" })).toBeTruthy();
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

// The Save hint: the line of links while the card still needs something
// (TODO 5.14: the same sentence, each item a link to its field), else the
// plain sentence.
const saveHint = () =>
  screen.queryByTestId("save-needs")?.textContent ??
  screen.queryByText(/to enable Save\.$/, { selector: "p" })?.textContent ??
  null;

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
    // Face tabs, part 2 (TODO 5.14): the same list, grouped per part; the
    // Save rule's own sentence is the button's hover text, as before.
    expect(saveHint()).toBe("Still needed to save: Left half — artwork · Right half — a name.");
    expect(saveButton().title).toBe("Add artwork and the right half's name to enable Save.");
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

  it("the missing second-part name is in plain view on its own tab — no fold holds it (Face tabs, part 2)", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    await clickNext(); // Identity
    expect(screen.queryByText(/More options — artist credit & right half/)).toBeNull();
    expect(saveHint()).toMatch(/Right half — a name/);
    const rightHalf = screen.getByRole("tab", { name: /^Right half/ });
    expect(rightHalf.textContent).toMatch(/needs a name and artwork/);
    await act(async () => {
      fireEvent.click(rightHalf);
    });
    const nameInput = screen.getByPlaceholderText("Ice");
    expect(nameInput.closest("details")).toBeNull();
  });

  it("a stored split card opens on its Left half; the Right half tab names the half", async () => {
    renderForm({ mode: "edit", card: savedCard({ ...SPLIT_CARD, visibility: "public" }) });
    expect(screen.queryByText(/More options — artist credit & right half/)).toBeNull();
    expect(screen.getByRole("tab", { name: /^Left half/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByPlaceholderText("Ice")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Right half/ }).textContent).toMatch(/needs artwork/);
  });

  it("an Adventure names what's missing as the adventure", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Adventure/);
    await clickNext();
    await typeTitle("Bonecrusher Giant");
    expect(saveHint()).toBe("Still needed to save: Creature — artwork · Adventure spell — a name.");
    expect(saveButton().title).toBe("Add artwork and the adventure spell's name to enable Save.");
  });

  it("edit: clearing a public card's second-face name disables Save and says why", async () => {
    renderForm({ mode: "edit", card: savedCard({ ...SPLIT_CARD, visibility: "public" }) });
    // Identity step → the Right half tab → the half's name field.
    // A split half's example name is a split card's ("Ice"), never the
    // transform back's it used to borrow (TODO 5.14).
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /^Right half/ }));
    });
    expect(screen.queryByPlaceholderText("Insectile Aberration")).toBeNull();
    const nameInput = screen.getByPlaceholderText("Ice") as HTMLInputElement;
    expect(nameInput.value).toBe("Ice");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "" } });
    });
    expect(saveHint()).toBe("Still needed to save: Right half — a name.");
    expect(saveButton().title).toBe("Add the right half's name to enable Save.");
    expect(saveButton().disabled).toBe(true);
  });

  it("a subtypes error jumps back to the Identity step, where the field is in plain view (3b.16: never folded)", async () => {
    renderForm({ mode: "create" });
    await clickNext(); // Identity
    await typeTitle("Too Many Types");
    // The type line's two fields are primary: no "More options" holds them.
    expect(screen.queryByText("More options — supertype, subtypes")).toBeNull();
    expect(screen.getByPlaceholderText("Dragon, Elder").closest("details")).toBeNull();
    expect(screen.getByTestId("types-field-input-front").closest("details")).toBeNull();
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
    // Client validation jumps back to Identity, the error under its field.
    await waitFor(() => expect(screen.getByText("A card can have up to 10 subtypes.")).toBeTruthy());
    expect(actions.createCardAction).not.toHaveBeenCalled();
  });

  it("a second-part error selects the part's tab, where the field and its message are in view", async () => {
    actions.updateCardAction.mockResolvedValue({
      ok: false,
      fieldErrors: { "back_face.title": "That name is taken by the front face." },
    });
    renderForm({ mode: "edit", card: savedCard({ ...SPLIT_CARD, visibility: "private" }) });
    const rightHalf = screen.getByRole("tab", { name: /^Right half/ });
    expect(rightHalf.getAttribute("aria-selected")).toBe("false");
    await typeTitle("Fire, Again");
    await clickSave();

    await waitFor(() => expect(rightHalf.getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByText("That name is taken by the front face.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Ice").closest("details")).toBeNull();
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
    actions.linkDeckCardAction.mockResolvedValue({ ok: true });
    renderForm({
      mode: "remix",
      card: savedCard({ visibility: "public" }),
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: null,
        deckSlug: "tester/burn",
        deckTitle: "Burn",
        entryName: "Lightning Bolt",
      },
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
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /^Aftermath half/ }));
    });
    const nameInput = screen.getByPlaceholderText("Ribbons");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Dawn" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear the aftermath half" }));
    });
    expect(preview().backFace?.title).toBe("");
    expect(preview().backFace?.card_type).toBe("sorcery");
  });

  it("a second half the user already wrote keeps its own type across a kind change", async () => {
    renderForm({ mode: "create" });
    await pickKind(/^Split/);
    await clickNext();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /^Right half/ }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Ice"), {
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
// 3b.15 — the token kind: its type picker writes the words, the frame and the
// P/T follow them, the name follows the subtypes, and a new token is common.
// ---------------------------------------------------------------------------

describe("3b.15 the token type picker", () => {
  const WITH_ARTIFACT_TOKEN = [...VERIFIED, ...EVERY_COLOUR.map((k) => frameComboKey("m15tokenartifact", k))];

  function tokenChip(label: RegExp) {
    const chip = Array.from(
      document.querySelectorAll("[aria-label='Token types'] button, [aria-label='Token supertypes'] button"),
    ).find((el) => label.test(el.textContent ?? "")) as HTMLButtonElement | undefined;
    if (!chip) throw new Error(`no token chip ${label}`);
    return chip;
  }
  async function toggle(label: RegExp) {
    const chip = tokenChip(label);
    await act(async () => {
      fireEvent.click(chip);
    });
  }

  it("a new token is a common Creature token with a P/T", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Token/);
    expect(preview().cardType).toBe("token");
    expect(preview().template).toBe("m15token");
    expect(preview().supertype).toBe("Creature");
    expect(preview().power).toBe("1");
    expect(preview().rarity).toBe("common");
    expect(tokenChip(/^Creature/).getAttribute("aria-pressed")).toBe("true");
    expect(tokenChip(/^Artifact/).getAttribute("aria-pressed")).toBe("false");
    // Back to a creature: the picker's word leaves with the kind.
    await pickKind(/^Creature/);
    expect(preview().supertype).toBe("");
  });

  it("Artifact picks the artifact token frame; the P/T goes with Creature; off again → the plain frame", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Token/);
    await toggle(/^Creature/);
    await toggle(/^Artifact/);
    expect(preview().supertype).toBe("Artifact");
    expect(preview().template).toBe("m15tokenartifact");
    // The form still holds the new card's 1/1, but a Treasure prints none.
    expect(preview().power).toBe("");
    await toggle(/^Legendary/);
    await toggle(/^Enchantment/);
    expect(preview().supertype).toBe("Legendary Enchantment Artifact");
    await toggle(/^Artifact/);
    expect(preview().supertype).toBe("Legendary Enchantment");
    expect(preview().template).toBe("m15token");
    // No toggle at all: a bare "Token", on the plain frame.
    await toggle(/^Legendary/);
    await toggle(/^Enchantment/);
    expect(preview().supertype).toBe("");
    expect(preview().template).toBe("m15token");
  });

  it("the \"Artifact Token\" frame is no chip of its own", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Token/);
    const variations = screen.getByRole("radiogroup", { name: "Frame variations" });
    const labels = Array.from(variations.querySelectorAll("[role='radio']")).map((el) => el.textContent ?? "");
    expect(labels.some((text) => /^Standard/.test(text))).toBe(true);
    expect(labels.some((text) => /Artifact Token/.test(text))).toBe(false);
  });

  it("an unverified artifact frame keeps the plain one and says so", async () => {
    renderForm({ mode: "create" }); // m15tokenartifact isn't verified here
    await pickKind(/^Token/);
    await toggle(/^Artifact/);
    expect(preview().supertype).toBe("Artifact Creature");
    expect(preview().template).toBe("m15token");
    expect(toast.info.mock.calls.map((call) => String(call[0])).join(" ")).toMatch(/isn't verified in colorless yet/);
  });

  it("the name follows the subtypes until the user types one", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Token/);
    await clickNext(); // Card → Identity
    const subtypes = screen.getByPlaceholderText("Dragon, Elder");
    await act(async () => {
      fireEvent.change(subtypes, { target: { value: "Rabbit, Knight" } });
    });
    expect(titleInput().value).toBe("Rabbit Knight");
    await act(async () => {
      fireEvent.change(subtypes, { target: { value: "Rabbit" } });
    });
    expect(titleInput().value).toBe("Rabbit");
    await typeTitle("Warren Warleader");
    await act(async () => {
      fireEvent.change(subtypes, { target: { value: "Rabbit, Knight" } });
    });
    expect(titleInput().value).toBe("Warren Warleader");
  });

  it("a Treasure saves as \"Artifact\", common, with no P/T, on the artifact token frame", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "treasure",
    });
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Token/);
    await toggle(/^Creature/);
    await toggle(/^Artifact/);
    await clickNext();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), { target: { value: "Treasure" } });
    });
    // No rarity chips for a token.
    await clickNext();
    expect(screen.queryByRole("radiogroup", { name: "Rarity" })).toBeNull();
    expect(screen.queryByPlaceholderText("4")).toBeNull();
    await goToLastStep();
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    await clickSave();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "Treasure",
      card_type: "token",
      supertype: "Artifact",
      subtypes: ["Treasure"],
      rarity: "common",
      frame_style: { template: "m15tokenartifact" },
    });
    expect(payload.power).toBeUndefined();
    expect(payload.toughness).toBeUndefined();
  });

  const typesField = () => screen.getByTestId("types-field-input-front") as HTMLInputElement;

  it("the Identity step's Types field holds the token's words after a fixed “Token”, in step with the picker (3b.16)", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Token/);
    await toggle(/^Legendary/);
    expect(preview().supertype).toBe("Legendary Creature");
    await clickNext(); // Card → Identity
    // "Token" is a fixed prefix beside the field, never in it.
    expect(screen.getByTestId("types-field-token-prefix").textContent).toBe("Token");
    expect(typesField().value).toBe("Legendary Creature");
    expect(preview().printedTypes).toBeNull();
    // The maker's order wins: the words are stored and printed as typed.
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "snow Legendary Creature " } });
    });
    expect(typesField().value).toBe("snow Legendary Creature ");
    expect(preview().supertype).toBe("snow Legendary Creature");
    expect(preview().printedTypes).toBe("snow Legendary Creature ");
    // Leaving the field capitalises each word.
    await act(async () => {
      fireEvent.blur(typesField());
    });
    expect(typesField().value).toBe("Snow Legendary Creature");
    expect(preview().supertype).toBe("Snow Legendary Creature");
    // The picker reads the typed words, and its toggles write into the text
    // where the printed order sets them — every other word stays put.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    expect(tokenChip(/^Legendary/).getAttribute("aria-pressed")).toBe("true");
    await toggle(/^Creature/);
    await toggle(/^Artifact/);
    expect(preview().supertype).toBe("Snow Legendary Artifact");
    expect(preview().printedTypes).toBe("Snow Legendary Artifact");
    expect(preview().template).toBe("m15tokenartifact");
    await clickNext();
    expect(typesField().value).toBe("Snow Legendary Artifact");
    // Leaving and re-entering the field without typing writes nothing.
    await act(async () => {
      fireEvent.focus(typesField());
      fireEvent.blur(typesField());
    });
    expect(preview().printedTypes).toBe("Snow Legendary Artifact");
    // Reset hands the line back to the card: the built, printed order.
    await act(async () => {
      fireEvent.click(screen.getByTestId("types-field-reset-front"));
    });
    expect(preview().printedTypes).toBeNull();
    expect(typesField().value).toBe("Legendary Snow Artifact");
  });

  it("an imported \"Token Legendary Artifact Creature — Construct\" saves every word through the picker, the Types field and Enter", async () => {
    const card = scryfallCardSchema.parse({
      ...importPrintings["tkld-7"],
      name: "Construct",
      type_line: "Token Legendary Artifact Creature — Construct",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith("/api/scryfall/named")
          ? new Response(
              JSON.stringify({
                ok: true,
                card: { name: card.name, scryfall_uri: null },
                patch: JSON.parse(JSON.stringify(mapScryfallToFormPatch(card))),
              }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ ok: false }), { status: 200 }),
      ),
    );
    actions.createCardAction.mockResolvedValue({ ok: true, cardId: "44444444-4444-4444-8444-444444444444", slug: "construct" });
    actions.linkDeckCardAction.mockResolvedValue({ ok: true });
    renderForm({
      mode: "create",
      verifiedFrameKeys: WITH_ARTIFACT_TOKEN,
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: card.id,
        deckSlug: "tester/deck",
        deckTitle: "Deck",
        entryName: card.name,
      },
    });
    await waitFor(() => expect(preview().supertype).toBe("Legendary Artifact Creature"));
    expect(preview().cardType).toBe("token");
    expect(preview().template).toBe("m15tokenartifact");
    // The import opens on the Identity step with the printing's own line —
    // which is the built one, so nothing is stored beside the supertype.
    expect(typesField().value).toBe("Legendary Artifact Creature");
    expect(preview().printedTypes).toBeNull();
    const goTo = async (step: string) => {
      await act(async () => {
        fireEvent.click(screen.getAllByTitle(`Go to ${step}`)[0]);
      });
    };
    // The picker (Card step): Enchantment on, Legendary off.
    await goTo("Card");
    await toggle(/^Enchantment/);
    await toggle(/^Legendary/);
    expect(preview().supertype).toBe("Enchantment Artifact Creature");
    // A draft (the import brought no art), saved from the Identity step.
    await goToLastStep();
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    await goTo("Identity");
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "snow legendary Enchantment Artifact Creature" } });
    });
    expect(preview().supertype).toBe("snow legendary Enchantment Artifact Creature");
    // Enter submits the form with the field still focused — no blur. The
    // words are capitalised first, so the save stores what the field shows.
    await act(async () => {
      fireEvent.keyDown(typesField(), { key: "Enter" });
    });
    expect(typesField().value).toBe("Snow Legendary Enchantment Artifact Creature");
    expect(saveButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.submit(typesField().form!);
    });
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0][0]).toMatchObject({
      title: "Construct",
      card_type: "token",
      // The maker's order, sent whole; the action keeps `printed_types`
      // because it is not the built line ("Legendary Snow …").
      supertype: "Snow Legendary Enchantment Artifact Creature",
      printed_types: "Snow Legendary Enchantment Artifact Creature",
      subtypes: ["Construct"],
      frame_style: { template: "m15tokenartifact" },
    });
  });

  it("a creature's Types field starts as “Creature”; words go before and after it, and it may be removed (3b.16)", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Creature/);
    await clickNext();
    expect(screen.queryByTestId("types-field-token-prefix")).toBeNull();
    expect(typesField().value).toBe("Creature");
    expect(preview().printedTypes).toBeNull();
    expect(screen.queryByTestId("types-field-reset-front")).toBeNull();
    // Words before and after: the supertype is every word but "Creature".
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "legendary Creature snow" } });
      fireEvent.blur(typesField());
    });
    expect(typesField().value).toBe("Legendary Creature Snow");
    expect(preview().supertype).toBe("Legendary Snow");
    expect(preview().printedTypes).toBe("Legendary Creature Snow");
    // The word removed: the line prints "Goblin", the card stays a creature
    // (its P/T is still there) and the field says so.
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "goblin" } });
      fireEvent.blur(typesField());
    });
    expect(typesField().value).toBe("Goblin");
    expect(preview().supertype).toBe("Goblin");
    expect(preview().printedTypes).toBe("Goblin");
    expect(preview().cardType).toBe("creature");
    expect(preview().power).toBe("1");
    expect(screen.getByTestId("types-field-note-front").textContent).toContain("still a creature");
    // Emptied: nothing before the dash, still a creature.
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "" } });
    });
    expect(preview().printedTypes).toBe("");
    expect(preview().supertype).toBe("");
    // Reset: the pre-filled line again.
    await act(async () => {
      fireEvent.click(screen.getByTestId("types-field-reset-front"));
    });
    expect(typesField().value).toBe("Creature");
    expect(preview().printedTypes).toBeNull();
  });

  it("a dash typed in the Types field moves the words after it to Subtypes — one dash on the card (3b.16)", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Creature/);
    await clickNext();
    const subtypesField = () => screen.getByPlaceholderText("Dragon, Elder") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(subtypesField(), { target: { value: "Wizard" } });
      fireEvent.change(typesField(), { target: { value: "legendary creature - goblin wizard" } });
      fireEvent.blur(typesField());
    });
    // "Wizard" was there already: it is not listed twice.
    expect(typesField().value).toBe("Legendary Creature");
    expect(subtypesField().value).toBe("Wizard, Goblin");
    expect(preview().supertype).toBe("Legendary");
    // A dash with nothing after it is dropped; a hyphen inside a word stays.
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "Assembly-Worker Creature —" } });
      fireEvent.blur(typesField());
    });
    expect(typesField().value).toBe("Assembly-Worker Creature");
    expect(subtypesField().value).toBe("Wizard, Goblin");
    expect(preview().supertype).toBe("Assembly-Worker");
  });

  it("a typed line follows a card type change: the old type's word becomes the new one's, the rest is kept (3b.16)", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Creature/);
    await clickNext();
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "Goblin Creature Snow" } });
    });
    expect(preview().supertype).toBe("Goblin Snow");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await pickKind(/^Land/);
    // The maker's words and order stay; "Creature" was the old type's word,
    // not a type word typed onto a land — so no P/T follows it there.
    expect(preview().cardType).toBe("land");
    expect(preview().printedTypes).toBe("Goblin Land Snow");
    expect(preview().supertype).toBe("Goblin Snow");
    await clickNext();
    expect(typesField().value).toBe("Goblin Land Snow");
    expect(screen.queryByTestId("types-field-note-front")).toBeNull();
  });

  it("a line whose maker took the type's word out is kept whole across a card type change (3b.16)", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_ARTIFACT_TOKEN });
    await pickKind(/^Creature/);
    await clickNext();
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "Goblin" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await pickKind(/^Land/);
    expect(preview().printedTypes).toBe("Goblin");
    expect(preview().supertype).toBe("Goblin");
    await clickNext();
    expect(screen.getByTestId("types-field-note-front").textContent).toContain("doesn’t say “Land”");
  });

  it("an edit re-words the PRINTED line only: the card's type words, its P/T and a typed dash stay as they are (3b.16)", async () => {
    renderForm({
      mode: "edit",
      verifiedFrameKeys: WITH_ARTIFACT_TOKEN,
      card: savedCard({ card_type: "land", supertype: "goblin", subtypes: ["Forest"], power: null, toughness: null, cost: null }),
    });
    // The stored line, as it prints today — not re-spelled by a focus.
    expect(typesField().value).toBe("goblin Land");
    await act(async () => {
      fireEvent.focus(typesField());
      fireEvent.blur(typesField());
    });
    expect(typesField().value).toBe("goblin Land");
    expect(preview().printedTypes).toBeNull();
    // "Creature" typed on a saved land prints, and changes nothing else:
    // the type words (`supertype`) are locked on an edit.
    await act(async () => {
      fireEvent.change(typesField(), { target: { value: "land creature - dryad" } });
      fireEvent.blur(typesField());
    });
    expect(typesField().value).toBe("Land Creature — Dryad");
    expect(preview().printedTypes).toBe("Land Creature — Dryad");
    expect(preview().supertype).toBe("goblin");
  });

  it("a stored token from before the picker opens as a Creature token with its P/T", async () => {
    renderForm({
      mode: "edit",
      card: savedCard({
        title: "Stalzalfos",
        card_type: "token",
        supertype: null,
        subtypes: ["Skeleton"],
        power: "1",
        toughness: "1",
        cost: null,
        rarity: "uncommon",
        frame_style: { finish: "regular", template: "m15token" },
      }),
    });
    expect(preview().supertype).toBe("Creature");
    expect(preview().power).toBe("1");
    // Its stored rarity stays.
    expect(preview().rarity).toBe("uncommon");
    expect(screen.getByTestId("locked-summary").textContent).toMatch(/Token Creature — Skeleton/);
  });

  // Owner 2026-09-29: a remix saves a NEW card, so a token's remix is common
  // like every new token (the creator's and the AI jobs' rule) — the token
  // kind hides the rarity chips, so the parent's rare could never be set
  // back on the remix. An edit keeps the stored rarity (above).
  it.each([
    ["an uncommon Creature token", { supertype: "Creature", power: "2", toughness: "2", rarity: "uncommon" }],
    ["a mythic Treasure", { supertype: "Artifact", subtypes: ["Treasure"], rarity: "mythic", frame_style: { finish: "regular", template: "m15tokenartifact" } }],
  ])("a remix of %s saves as common, and previews so", async (_label, over) => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "soldier-remix",
    });
    renderForm({
      mode: "remix",
      verifiedFrameKeys: WITH_ARTIFACT_TOKEN,
      card: savedCard({
        title: "Soldier",
        card_type: "token",
        subtypes: ["Soldier"],
        power: null,
        toughness: null,
        cost: null,
        visibility: "public",
        frame_style: { finish: "regular", template: "m15token" },
        ...over,
      }),
    });
    expect(preview().rarity).toBe("common");
    await typeTitle("Soldier of the Second Dawn");
    await clickSave();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0];
    expect(payload.parent_card_id).toBe(CARD_ID);
    expect(payload.card_type).toBe("token");
    expect(payload.rarity).toBe("common");
  });

  it("a remix of a non-token keeps its parent's rarity", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "wyrm-of-the-second-dawn",
    });
    renderForm({ mode: "remix", card: savedCard({ visibility: "public" }) });
    expect(preview().rarity).toBe("rare");
    await typeTitle("Wyrm of the Second Dawn");
    await clickSave();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCardAction.mock.calls[0][0].rarity).toBe("rare");
  });
});

// ---------------------------------------------------------------------------
// 4.49 (b), owner decision 5 — the token text box follows the text: on the
// token kind the arch wears its text-box variation while the card has rules
// or flavour text and the textless one while it has none, until the user
// picks a variation by hand (it sticks).
// ---------------------------------------------------------------------------

describe("4.49 (b) the token text box follows the text", () => {
  const WITH_TEXT_BOX = [
    ...VERIFIED,
    ...["m15tokenartifact", "m15tokentext", "m15tokenartifacttext"].flatMap((t) =>
      EVERY_COLOUR.map((k) => frameComboKey(t, k)),
    ),
  ];
  const flavour = () => screen.getByPlaceholderText("A coil of fire, bound by oath.") as HTMLTextAreaElement;
  async function typeFlavour(value: string) {
    await act(async () => {
      fireEvent.change(flavour(), { target: { value } });
    });
  }
  async function back(times = 1) {
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
      });
    }
  }
  async function toggleToken(label: RegExp) {
    const chip = Array.from(document.querySelectorAll("[aria-label='Token types'] button")).find((el) =>
      label.test(el.textContent ?? ""),
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(chip);
    });
  }

  it("a new token wears the text box while it has text, and the textless arch while it has none", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_TEXT_BOX });
    await pickKind(/^Token/);
    expect(preview().template).toBe("m15token");
    await clickNext(2); // Card → Identity → Text
    await typeFlavour("Enemies of the heir, beware.");
    expect(preview().template).toBe("m15tokentext");
    // More text: still the box.
    await typeFlavour("Enemies of the heir, beware. All of them.");
    expect(preview().template).toBe("m15tokentext");
    // Blank is no text.
    await typeFlavour("   ");
    expect(preview().template).toBe("m15token");
    await typeFlavour("Vigilance, of a sort.");
    expect(preview().template).toBe("m15tokentext");
    // The Artifact word dresses the box, and leaving takes both back.
    await back(2);
    await toggleToken(/^Artifact/);
    expect(preview().template).toBe("m15tokenartifacttext");
    expect(chipIn("Frame variations", /^Token \(2014–2019\), text box/).getAttribute("aria-checked")).toBe("true");
    expect(chipIn("Frame variations", /^Standard/).getAttribute("aria-checked")).toBe("false");
    await clickNext(2);
    await typeFlavour("");
    expect(preview().template).toBe("m15tokenartifact");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("a variation picked by hand sticks, whatever the text does after", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_TEXT_BOX });
    await pickKind(/^Token/);
    await clickNext(2);
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m15tokentext");
    await back(2);
    // The textless arch over the text: its scrim keeps the text.
    await clickChip("Frame variations", /^Standard/);
    expect(preview().template).toBe("m15token");
    await clickNext(2);
    await typeFlavour("");
    await typeFlavour("A knight, again.");
    expect(preview().template).toBe("m15token");
    // The text box picked by hand stays through a card with no text.
    await back(2);
    await clickChip("Frame variations", /^Token \(2014–2019\), text box/);
    expect(preview().template).toBe("m15tokentext");
    await clickNext(2);
    await typeFlavour("");
    expect(preview().template).toBe("m15tokentext");
  });

  it("a card turned into a token with text lands on the text box", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_TEXT_BOX });
    await pickKind(/^Creature/);
    await clickNext(2);
    await typeFlavour("It came from the sea.");
    await back(2);
    await pickKind(/^Token/);
    expect(preview().template).toBe("m15tokentext");
  });

  it("an idea for a token with text lands on the text box", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_TEXT_BOX });
    await applyIdea({
      title: "Knight",
      card_type: "token",
      supertype: "Creature",
      subtypes_text: "Knight",
      color_identity: ["white"],
      rules_text: "Vigilance",
      flavor_text: "",
      power: "2",
      toughness: "2",
    });
    expect(preview().cardType).toBe("token");
    expect(preview().template).toBe("m15tokentext");
  });

  it("a text box not verified in the colour keeps the textless arch and says so", async () => {
    renderForm({ mode: "create" }); // m15tokentext isn't verified here
    await pickKind(/^Token/);
    await clickNext(2);
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m15token");
    expect(toast.info.mock.calls.map((call) => String(call[0])).join(" ")).toMatch(
      /text box isn't verified in colorless yet — keeping M15 \(2015\) Token \(2014–2019\)\./,
    );
  });

  it("a saved token given its first line of text moves to the box while editing", async () => {
    renderForm({
      mode: "edit",
      verifiedFrameKeys: WITH_TEXT_BOX,
      card: savedCard({
        title: "Soldier",
        card_type: "token",
        supertype: "Creature",
        subtypes: ["Soldier"],
        power: "1",
        toughness: "1",
        cost: null,
        rules_text: null,
        flavor_text: null,
        color_identity: ["white"],
        frame_style: { finish: "regular", template: "m15token" },
      }),
    });
    expect(preview().template).toBe("m15token");
    await goToText();
    await typeFlavour("Hold the line.");
    expect(preview().template).toBe("m15tokentext");
    await typeFlavour("");
    expect(preview().template).toBe("m15token");
  });

  it("a saved token whose frame disagrees with its text keeps it (a choice that sticks)", async () => {
    renderForm({
      mode: "edit",
      verifiedFrameKeys: WITH_TEXT_BOX,
      card: savedCard({
        title: "Knight",
        card_type: "token",
        supertype: "Creature",
        subtypes: ["Knight"],
        power: "2",
        toughness: "2",
        cost: null,
        rules_text: null,
        flavor_text: null,
        color_identity: ["white"],
        // An empty text box, picked by hand.
        frame_style: { finish: "regular", template: "m15tokentext" },
      }),
    });
    await goToText();
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m15tokentext");
  });

  it("an admin's saved frame preview keeps the combo it previews, whatever its text does", async () => {
    // TODO 2.3: the card previews m15token/w — text typed into it never
    // moves it onto the text box (nor migration 0129: it skips previews).
    renderForm({
      mode: "edit",
      verifiedFrameKeys: WITH_TEXT_BOX,
      card: savedCard({
        title: "Soldier",
        card_type: "token",
        supertype: "Creature",
        subtypes: ["Soldier"],
        power: "1",
        toughness: "1",
        cost: null,
        rules_text: null,
        flavor_text: null,
        color_identity: ["white"],
        frame_style: { finish: "regular", template: "m15token" },
        frame_preview: true,
      }),
    });
    await goToText();
    await typeFlavour("Hold the line.");
    expect(preview().template).toBe("m15token");
    await typeFlavour("");
    expect(preview().template).toBe("m15token");
  });

  async function goToText() {
    await act(async () => {
      fireEvent.click(screen.getAllByTitle("Go to Text & stats")[0]);
    });
  }
});

// ---------------------------------------------------------------------------
// 4.48 / 4.50 (owner decisions 2026-09-29) — the full-art token, wired into
// the text-box follow above: once its template is VERIFIED in the card's
// colour a NEW token starts on it (else on the arch, as above), its height
// follows the text (no box → the regular box → the tall box) until the user
// picks one in Variations (it sticks), and a stored card keeps its frame.
// Flavour text drives the text here (the rules field is a rich editor); the
// height rule counts it like rules text.
// ---------------------------------------------------------------------------

describe("4.48 the full-art token: the default switch and the automatic height", () => {
  const M20 = ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"];
  const ARCH = ["m15tokenartifact", "m15tokentext", "m15tokenartifacttext"];
  const combos = (templates: string[], colours = EVERY_COLOUR) => templates.flatMap((t) => colours.map((k) => frameComboKey(t, k)));
  const ALL = [...VERIFIED, ...combos(ARCH), ...combos(M20)];
  // Long enough that the regular box would hold it only below 72 px.
  const LONG =
    "When this creature enters, look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";
  const flavour = () => screen.getByPlaceholderText("A coil of fire, bound by oath.") as HTMLTextAreaElement;
  async function typeFlavour(value: string) {
    await act(async () => {
      fireEvent.change(flavour(), { target: { value } });
    });
  }
  async function back(times = 1) {
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
      });
    }
  }
  async function toggleToken(label: RegExp) {
    const chip = Array.from(document.querySelectorAll("[aria-label='Token types'] button")).find((el) =>
      label.test(el.textContent ?? ""),
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(chip);
    });
  }
  async function goToText() {
    await act(async () => {
      fireEvent.click(screen.getAllByTitle("Go to Text & stats")[0]);
    });
  }

  it("a new token starts on the full-art design once it is verified, its height following the text", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: ALL });
    await pickKind(/^Token/);
    expect(preview().template).toBe("m20token");
    await clickNext(2);
    await typeFlavour("Enemies of the heir, beware.");
    expect(preview().template).toBe("m20tokentext");
    await typeFlavour(LONG);
    expect(preview().template).toBe("m20tokentall");
    await typeFlavour("Short again.");
    expect(preview().template).toBe("m20tokentext");
    await typeFlavour("   ");
    expect(preview().template).toBe("m20token");
    // The Artifact word dresses whichever height the card wears.
    await typeFlavour(LONG);
    await back(2);
    await toggleToken(/^Creature/);
    await toggleToken(/^Artifact/);
    expect(preview().template).toBe("m20tokenartifacttall");
    await clickNext(2);
    await typeFlavour("");
    expect(preview().template).toBe("m20tokenartifact");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("starts on the arch while the full-art template isn't verified in the card's colour — round 11's pick", async () => {
    // Verified in every colour but colourless (a new card's colour).
    renderForm({ mode: "create", verifiedFrameKeys: [...VERIFIED, ...combos(ARCH), ...combos(M20, ["w", "u", "b", "r", "g", "m"])] });
    await pickKind(/^Token/);
    expect(preview().template).toBe("m15token");
    await clickNext(2);
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m15tokentext");
    // A token entered with text: the arch's text box, no full-art height.
    await back(2);
    await pickKind(/^Creature/);
    await pickKind(/^Token/);
    expect(preview().template).toBe("m15tokentext");
  });

  it("a card turned into a token with text starts on the height its text asks for", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: ALL });
    await pickKind(/^Creature/);
    await clickNext(2);
    await typeFlavour(LONG);
    await back(2);
    await pickKind(/^Token/);
    expect(preview().template).toBe("m20tokentall");
  });

  it("an idea for a token with text lands on the full-art text box", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: ALL });
    await applyIdea({
      title: "Knight",
      card_type: "token",
      supertype: "Creature",
      subtypes_text: "Knight",
      color_identity: ["white"],
      rules_text: "Vigilance",
      flavor_text: "",
      power: "2",
      toughness: "2",
    });
    expect(preview().cardType).toBe("token");
    expect(preview().template).toBe("m20tokentext");
  });

  it("a height picked by hand in Variations sticks, whatever the text does after", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: ALL });
    await pickKind(/^Token/);
    await clickNext(2);
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m20tokentext");
    await back(2);
    await clickChip("Frame variations", /^Token, tall text box/);
    expect(preview().template).toBe("m20tokentall");
    await clickNext(2);
    await typeFlavour("");
    await typeFlavour("A knight, again.");
    expect(preview().template).toBe("m20tokentall");
    // …even the height the text asks for, picked by hand: it no longer
    // follows.
    await back(2);
    await clickChip("Frame variations", /^Token, text box/);
    await clickNext(2);
    await typeFlavour(LONG);
    expect(preview().template).toBe("m20tokentext");
    // A Frame-section pick of the arch is the arch, automatic again.
    await back(2);
    await clickChip("M15 (2015) frames", /^Token \(2014–2019\)/);
    expect(preview().template).toBe("m15tokentext");
    await clickNext(2);
    await typeFlavour("");
    expect(preview().template).toBe("m15token");
  });

  it("never moves onto a height that isn't verified in the colour, and says so", async () => {
    // Only the textless height verified.
    renderForm({ mode: "create", verifiedFrameKeys: [...VERIFIED, ...combos(ARCH), ...combos(["m20token", "m20tokenartifact"])] });
    await pickKind(/^Token/);
    expect(preview().template).toBe("m20token");
    await clickNext(2);
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m20token");
    expect(toast.info.mock.calls.map((call) => String(call[0])).join(" ")).toMatch(
      /M15 \(2015\) Token, text box isn't verified in colorless yet — keeping M15 \(2015\) Token\./,
    );
  });

  it("a saved full-art token keeps a height that disagrees with its text; one that agrees follows it", async () => {
    const saved = (template: string, flavor: string | null) =>
      savedCard({
        title: "Knight",
        card_type: "token",
        supertype: "Creature",
        subtypes: ["Knight"],
        power: "2",
        toughness: "2",
        cost: null,
        rules_text: null,
        flavor_text: flavor,
        color_identity: ["white"],
        frame_style: { finish: "regular", template },
      });
    const { unmount } = renderForm({ mode: "edit", verifiedFrameKeys: ALL, card: saved("m20tokentall", "A knight.") });
    expect(preview().template).toBe("m20tokentall");
    await goToText();
    await typeFlavour("A knight, still.");
    expect(preview().template).toBe("m20tokentall");
    unmount();
    renderForm({ mode: "edit", verifiedFrameKeys: ALL, card: saved("m20tokentext", "A knight.") });
    await goToText();
    await typeFlavour(LONG);
    expect(preview().template).toBe("m20tokentall");
  });

  it("the height follows the text on the Nyx dress too — the starfield stays (TODO 4.51)", async () => {
    const NYX = ["m20tokennyx", "m20tokennyxtext", "m20tokennyxtall"];
    renderForm({
      mode: "edit",
      verifiedFrameKeys: [...ALL, ...combos(NYX)],
      card: savedCard({
        title: "Glimmer",
        card_type: "token",
        supertype: "Enchantment Creature",
        subtypes: ["Glimmer"],
        power: "1",
        toughness: "1",
        cost: null,
        rules_text: null,
        flavor_text: "It shines.",
        color_identity: ["white"],
        frame_style: { finish: "regular", template: "m20tokennyxtext" },
      }),
    });
    expect(preview().template).toBe("m20tokennyxtext");
    await goToText();
    await typeFlavour(LONG);
    expect(preview().template).toBe("m20tokennyxtall");
    await typeFlavour("   ");
    expect(preview().template).toBe("m20tokennyx");
  });

  it("a stored arch token stays on the arch: the switch is for new tokens only", async () => {
    renderForm({
      mode: "edit",
      verifiedFrameKeys: ALL,
      card: savedCard({
        title: "Soldier",
        card_type: "token",
        supertype: "Creature",
        subtypes: ["Soldier"],
        power: "1",
        toughness: "1",
        cost: null,
        rules_text: null,
        flavor_text: null,
        color_identity: ["white"],
        frame_style: { finish: "regular", template: "m15token" },
      }),
    });
    await goToText();
    await typeFlavour("Hold the line.");
    expect(preview().template).toBe("m15tokentext");
  });

  // The Card step asks type, frame, colour in that order and a new card
  // starts colourless: the switch follows a colour picked after the type,
  // or a token started before its colour stays on the arch wherever the
  // full-art design is verified (and one started on it can't reach a colour
  // it isn't verified in).
  const colourChip = (label: RegExp) => chipIn("Color identity", label) as HTMLButtonElement;
  const pickColour = (label: RegExp) => clickChip("Color identity", label);

  it("a colour picked after the type: the new token follows it onto the full-art design, and back to the arch", async () => {
    // The full-art design verified in white only (the rollout's first step).
    renderForm({ mode: "create", verifiedFrameKeys: [...VERIFIED, ...combos(ARCH), ...combos(M20, ["w"])] });
    await pickKind(/^Token/);
    expect(preview().template).toBe("m15token");
    await pickColour(/^white/i);
    expect(preview().template).toBe("m20token");
    await pickColour(/^blue/i);
    expect(preview().template).toBe("m15token");
    expect(toast.info.mock.calls.map((call) => String(call[0])).join(" ")).toMatch(
      /M15 \(2015\) Token isn't verified in blue yet — using M15 \(2015\) Token \(2014–2019\)\./,
    );
    // With text: the arch's text box in blue, the full-art box in white.
    await clickNext(2);
    await typeFlavour("A knight.");
    expect(preview().template).toBe("m15tokentext");
    await back(2);
    await pickColour(/^white/i);
    expect(preview().template).toBe("m20tokentext");
    // …and its height still follows the text.
    await clickNext(2);
    await typeFlavour(LONG);
    expect(preview().template).toBe("m20tokentall");
  });

  it("a new token on the full-art design can take a colour it isn't verified in: the arch", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: [...VERIFIED, ...combos(ARCH), ...combos(M20, ["c", "w"])] });
    await pickKind(/^Token/);
    expect(preview().template).toBe("m20token");
    expect(chipOff(colourChip(/^blue/i))).toBe(false);
    await pickColour(/^blue/i);
    expect(preview().template).toBe("m15token");
    await pickColour(/^white/i);
    expect(preview().template).toBe("m20token");
  });

  it("a frame the user picks is theirs: a colour picked after it never moves it", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: [...VERIFIED, ...combos(ARCH), ...combos(M20, ["c", "w"])] });
    await pickKind(/^Token/);
    // The arch, picked in the Frame section: the new look's off switch.
    await clickChip("M15 (2015) frames", /^Token \(2014–2019\)/);
    expect(preview().template).toBe("m15token");
    await pickColour(/^white/i);
    expect(preview().template).toBe("m15token");
    // A full-art height picked in Variations: its colours are its own.
    await clickChip("Frame variations", /^Token, tall text box/);
    expect(preview().template).toBe("m20tokentall");
    expect(chipOff(colourChip(/^blue/i))).toBe(true);
    await pickColour(/^colorless/i);
    expect(preview().template).toBe("m20tokentall");
  });

  // TODO 4.51, owner Round 74: an Enchantment token follows onto the Nyx
  // dress in ONE colour only; two colours keep the plain design's split
  // (and take it off the dress again), and the dress picked by hand stays —
  // in gold — whatever the colour.
  it("the Nyx dress: a single-colour Enchantment token follows it, a two-colour one keeps the split, a hand pick stays", async () => {
    const NYX = ["m20tokennyx", "m20tokennyxtext", "m20tokennyxtall", "m20tokenartifactnyx", "m20tokenartifactnyxtext", "m20tokenartifactnyxtall"];
    renderForm({ mode: "create", verifiedFrameKeys: [...ALL, ...combos(NYX)] });
    await pickKind(/^Token/);
    await pickColour(/^white/i);
    expect(preview().template).toBe("m20token");
    await toggleToken(/^Enchantment/);
    expect(preview().template).toBe("m20tokennyx");
    // Another single colour: still the dress.
    await pickColour(/^blue/i);
    expect(preview().template).toBe("m20tokennyx");
    // Two colours (Multicolor): off the dress, onto the plain design (its split).
    await pickColour(/^multicolor/i);
    expect(preview().template).toBe("m20token");
    // Back to one colour: the dress again.
    await pickColour(/^white/i);
    expect(preview().template).toBe("m20tokennyx");
    // Picked by hand in two colours: it stays, gold.
    await pickColour(/^multicolor/i);
    expect(preview().template).toBe("m20token");
    await clickChip("Frame variations", /^Nyx Token/);
    expect(preview().template).toBe("m20tokennyx");
    await pickColour(/^white/i);
    await pickColour(/^multicolor/i);
    expect(preview().template).toBe("m20tokennyx");
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

    // `surface` is the funnel's (TODO DK3.8: deck_card_customized).
    expect(actions.linkDeckCardAction).toHaveBeenCalledWith(
      "66666666-6666-4666-8666-666666666666",
      NEW_CARD,
      { surface: "creator" },
    );
    expect(actions.linkDeckCardAction.mock.invocationCallOrder[0]).toBeLessThan(
      router.push.mock.invocationCallOrder[0],
    );
    expect(toast.success).toHaveBeenCalledWith("Linked into “Burn”.");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TODO 1.21 — an import keeps a layout kind's printed card type. The form
// used to write the kind's own type over it (applyKindProgrammatic), so an
// Enchantment adventurer saved as a Creature and the aftermath / split
// halves swapped Instant and Sorcery. Driven through the deck-remix prefill
// (/create?deckCard=…), which runs the same handleScryfallImport as the
// dialog, with the real mapper's patch for real (trimmed) printings.
// ---------------------------------------------------------------------------

describe("1.21 an import keeps a layout kind's printed card type", () => {
  type PrintingKey = keyof typeof importPrintings;

  function prefillFrom(key: PrintingKey) {
    const card = scryfallCardSchema.parse(importPrintings[key]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/scryfall/named")) {
          return new Response(
            JSON.stringify({
              ok: true,
              card: { name: card.name, scryfall_uri: null },
              patch: JSON.parse(JSON.stringify(mapScryfallToFormPatch(card))),
            }),
            { status: 200 },
          );
        }
        // No art: the text-only prefill.
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }),
    );
    renderForm({
      mode: "create",
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: card.id,
        deckSlug: "tester/deck",
        deckTitle: "Deck",
        entryName: card.name,
      },
    });
  }

  it.each([
    // Virtue of Loyalty WOE #38 — an Enchantment adventurer (was Creature).
    ["woe-38", "adventure", "enchantment", "Ardenvale Fealty"],
    // Commit // Memory AKH #211 — its front is an Instant (was Sorcery).
    ["akh-211", "aftermath", "instant", "Memory"],
    // Beck // Call DGM #123 — a Sorcery split card (was Instant).
    ["dgm-123", "split", "sorcery", "Call"],
    // Control: an adventurer that IS a creature.
    ["eld-115", "adventure", "creature", "Stomp"],
  ] as const)("%s lands on %s as %s", async (key, template, cardType, backTitle) => {
    prefillFrom(key);
    await waitFor(() => expect(preview().template).toBe(template));
    expect(preview().cardType).toBe(cardType);
    // The second half rides along, typed as printed.
    expect(preview().backFace?.title).toBe(backTitle);
  });
});

// TODO 1.6: an import PipGlyph can't reproduce exactly writes one frame
// request row, fire and forget — driven here through the deck pre-fill
// (/create?deckCard=…), the path that calls handleScryfallImport itself.
describe("frame request log", () => {
  function stubScryfall(card: ScryfallCard) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("/api/scryfall/named")) {
          return new Response(
            JSON.stringify({
              ok: true,
              card: { name: card.name, scryfall_uri: null },
              // What the route sends: the match finalized against the
              // verified combos (an unverified exact frame is nearest).
              patch: finalizeImportMatch(mapScryfallToFormPatch(card), new Set(VERIFIED)),
            }),
            { status: 200 },
          );
        }
        if (String(url).startsWith("/api/scryfall/import-art")) {
          return new Response(
            JSON.stringify({ ok: true, publicUrl: "https://example.com/imported.png" }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }),
    );
  }

  function prefill(card: ScryfallCard) {
    stubScryfall(card);
    renderForm({
      mode: "create",
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: card.id,
        deckSlug: "tester/deck",
        deckTitle: "Deck",
        entryName: card.name,
      },
    });
  }

  it("logs a nearest printing from the deck pre-fill, with its art flag", async () => {
    // Zilortha IKO #275: borderless with the nickname line, which no frame
    // draws (4.11) — nearest by the registry's own answer. (Sheoldred DMU
    // #435 was the example until Borderless drew its crown, 4.6f.)
    const zilortha = (signaturePrintings as unknown as Record<string, ScryfallCard>)["iko-275"];
    actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
    prefill(zilortha);
    await waitFor(() => expect(actions.recordFrameRequestAction).toHaveBeenCalledTimes(1));
    expect(actions.recordFrameRequestAction).toHaveBeenCalledWith({
      signature: "borderless/standard+nickname",
      label: "Borderless frame",
      setCode: "iko",
      collectorNumber: "275",
      scryfallId: zilortha.id,
      status: "nearest",
      cause: "missing",
      template: "m15",
      artFlag: "window-cropped",
      source: "deck_prefill",
    });
  });

  it("logs an exact frame that isn't verified in the card's colour as 'unverified' (D1)", async () => {
    // Heliod THB #259 is exact on Nyx (owner decision A3); Nyx isn't in this
    // test's verified list, so the route sends it as nearest and the card
    // lands on the M15 standard.
    const heliod = (signaturePrintings as unknown as Record<string, ScryfallCard>)["thb-259"];
    actions.recordFrameRequestAction.mockResolvedValue({ ok: true });
    prefill(heliod);
    await waitFor(() => expect(actions.recordFrameRequestAction).toHaveBeenCalledTimes(1));
    expect(actions.recordFrameRequestAction).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: "showcase/thb/constellation",
        status: "nearest",
        cause: "unverified",
        template: "m15",
        source: "deck_prefill",
      }),
    );
  });

  it("a log call that fails (offline) never blocks the import, and its rejection is handled", async () => {
    const oko = (signaturePrintings as unknown as Record<string, ScryfallCard>)["eld-271"];
    // The call is fire-and-forget: without its own .catch a rejected server
    // action (offline, a stale deployment) is an unhandled rejection in the
    // browser. Watch for one while the import runs.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      actions.recordFrameRequestAction.mockImplementation(() => {
        // A thenable, not a Promise: vitest's spy attaches its own handlers
        // to a returned Promise (to record its settled result), which would
        // hide a missing .catch. This rejection is the form's alone to handle.
        const rejected = Promise.reject(new TypeError("Failed to fetch"));
        return { then: rejected.then.bind(rejected), catch: rejected.catch.bind(rejected) };
      });
      prefill(oko);
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Pre-filled from Oko")),
      );
      expect(actions.recordFrameRequestAction).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
      // Node reports an unhandled rejection after the microtask queue drains.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("logs nothing for an exact printing (Llanowar Elves DOM #168 on the verified M15 frame)", async () => {
    const elves = (importPrintings as unknown as Record<string, ScryfallCard>)["dom-168"];
    prefill(elves);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Pre-filled from Llanowar Elves")),
    );
    expect(actions.recordFrameRequestAction).not.toHaveBeenCalled();
  });

  it("an admin's frame preview never logs — the stepper walk-through seeds through the same handler", async () => {
    // The walk (TODO 2.2) applies the combo's reference printing with
    // handleScryfallImport — here Sheoldred DMU #435, the borderless printing
    // the first test logs as nearest from the deck pre-fill. In a frame
    // preview it is admin tooling, not a user missing a frame.
    const sheoldred = (signaturePrintings as unknown as Record<string, ScryfallCard>)["dmu-435"];
    renderForm({
      mode: "create",
      framePreview: {
        param: "all",
        publishedKeys: VERIFIED,
        walkthrough: {
          template: "m15",
          colorKey: "b",
          kind: "creature",
          note: "Walking m15/b",
          previewFace: "front",
          cardTemplate: "m15",
          seed: {
            patch: { ...mapScryfallToFormPatch(sheoldred), frame_template: "m15" },
            source: { name: sheoldred.name, scryfallUri: null },
            fromReference: true,
          },
        },
      },
    });
    await waitFor(() => expect(preview().title).toBe(sheoldred.name));
    expect(preview().template).toBe("m15");
    expect(actions.recordFrameRequestAction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TODO 6.11 — print typography in the editor: a text field that loses focus
// shows what a card prints (lib/validation/print-typography.ts), text an
// idea pours in arrives printed, a remix starts printed (it saves a NEW
// card) — and EDITING a stored card touches only a field whose text differs
// from the stored one.
// ---------------------------------------------------------------------------

async function blurTitle() {
  await act(async () => {
    fireEvent.blur(titleInput());
  });
}

describe("6.11 print typography on blur", () => {
  it("create: the typed title turns into print's characters when the field loses focus", async () => {
    renderForm();
    await clickNext();
    await typeTitle(`Urza's "Saga" - Part '99`);
    // As typed until the field is left: nothing moves under the caret.
    expect(titleInput().value).toBe(`Urza's "Saga" - Part '99`);
    await blurTitle();
    expect(titleInput().value).toBe("Urza’s “Saga” — Part ’99");
    expect(preview().title).toBe("Urza’s “Saga” — Part ’99");
    // A second blur changes nothing.
    await blurTitle();
    expect(titleInput().value).toBe("Urza’s “Saga” — Part ’99");
  });

  it("edit: a stored field that was only visited keeps its stored characters", async () => {
    renderForm({ mode: "edit", card: savedCard({ title: "Urza's Wyrm" }) });
    expect(titleInput().value).toBe("Urza's Wyrm");
    await blurTitle();
    expect(titleInput().value).toBe("Urza's Wyrm");
    expect(preview().title).toBe("Urza's Wyrm");
  });

  it("edit: a field the owner changes is converted whole; changed back, it is the stored text again", async () => {
    renderForm({ mode: "edit", card: savedCard({ title: "Urza's Wyrm" }) });
    await typeTitle("Urza's Elder Wyrm");
    await blurTitle();
    expect(titleInput().value).toBe("Urza’s Elder Wyrm");
    await typeTitle("Urza's Wyrm");
    await blurTitle();
    expect(titleInput().value).toBe("Urza's Wyrm");
  });

  it("edit: a stored trailing space the owner deletes is not an edit of the text — nothing converts", async () => {
    renderForm({ mode: "edit", card: savedCard({ title: "Urza's Wyrm " }) });
    await typeTitle("Urza's Wyrm");
    await blurTitle();
    expect(titleInput().value).toBe("Urza's Wyrm");
  });

  it("remix: the new card starts on the printed characters", async () => {
    renderForm({ mode: "remix", card: savedCard({ title: "Urza's Wyrm", rules_text: "It can't block." }) });
    expect(titleInput().value).toBe("Urza’s Wyrm (remix)");
    expect(preview().rules).toBe("It can’t block.");
  });

  it("an idea's text lands printed", async () => {
    renderForm();
    await applyIdea({ title: "O'Kagachi's Echo", rules_text: `Landfall - It can't block.\nIt has "{T}: Add {G}."` });
    await clickNext();
    expect(titleInput().value).toBe("O’Kagachi’s Echo");
    expect(preview().rules).toBe("Landfall — It can’t block.\nIt has “{T}: Add {G}.”");
  });
});

// ---------------------------------------------------------------------------
// TODO DK0.6 (deck audit 2026-10-28, M1) — a deck entry's custom card
// (/create?deckCard=) is linked INTO that entry on save. The Publish step's
// "Add to deck" picker still showed there: picking the same deck inserted a
// second entry beside the one the save then linked.
// ---------------------------------------------------------------------------

describe("DK0.6 a deck entry's custom card offers no second \"Add to deck\"", () => {
  const MY_DECKS = [{ id: "77777777-7777-4777-8777-777777777777", title: "Burn", format: "modern" }];
  async function goToPublish() {
    const nav = screen.getByRole("navigation", { name: /card editor steps/i });
    const publish = Array.from(nav.querySelectorAll("button")).find((b) => /publish/i.test(b.textContent ?? ""));
    if (!publish) throw new Error("no Publish step");
    await act(async () => {
      fireEvent.click(publish);
    });
  }

  // The picker left the Publish step for the "Add to a deck" box under the
  // live preview (TODO DK9.3): the rule is the same on every step.
  const deckPicker = () => screen.queryByRole("combobox", { name: "Deck for this card" });

  it("a new card has the picker", async () => {
    renderForm({ myDecks: MY_DECKS });
    await goToPublish();
    expect(deckPicker()).not.toBeNull();
  });

  it("the deck entry's flow hides it", async () => {
    renderForm({
      myDecks: MY_DECKS,
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: null,
        deckSlug: "tester/burn",
        deckTitle: "Burn",
        entryName: "Lightning Bolt",
      },
    });
    await goToPublish();
    // On the Publish step (its visibility control is there)…
    expect(screen.getByRole("radiogroup", { name: /visibility/i })).toBeTruthy();
    // …with no deck picker: the box only says where saving goes.
    expect(deckPicker()).toBeNull();
    expect(screen.getByTestId("creator-deck-return").textContent).toBe("Saving returns you to “Burn”.");
  });
});
