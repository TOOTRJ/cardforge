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
import type { GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import emblemData from "../scryfall/fixtures/emblem-printings.json";

// ---------------------------------------------------------------------------
// TODO 6.23 through the real CardCreatorForm (the harness of
// creator-form-reliability.test.tsx): the Emblem choice inside the token
// kind makes the card an emblem on the emblem frame — colourless, common,
// no cost, supertype or stats — and back; it saves that way; an emblem
// import lands on it with the source's name. The server actions, the
// router, the billing providers and the heavy dialogs are stubbed.
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
// The AI fill dialog reports the fields the form hides from it.
const fill = vi.hoisted(() => ({ hidden: undefined as readonly string[] | undefined }));
vi.mock("@/components/creator/ai-fill-dialog", () => ({
  AiFillDialog: (props: { hiddenFields?: readonly string[] }) => {
    fill.hidden = props.hiddenFields;
    return null;
  },
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

/** What the live preview was last handed (desktop and mobile get the same). */
function preview() {
  const el = screen.getAllByTestId("card-preview")[0];
  return {
    title: el.dataset.title,
    cardType: el.dataset.cardType,
    supertype: el.dataset.supertype,
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

async function clickNext(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    });
  }
}

async function goToLastStep() {
  while (screen.queryByRole("button", { name: /^Next/ })) {
    await clickNext();
  }
}

const WITH_EMBLEM = [...VERIFIED, frameComboKey("emblem", "c")];

function emblemToggle() {
  const chip = document.querySelector("[aria-label='Emblem'] button") as HTMLButtonElement | null;
  if (!chip) throw new Error("no Emblem choice");
  return chip;
}

async function toggleEmblem() {
  await act(async () => {
    fireEvent.click(emblemToggle());
  });
}

describe("6.23 the Emblem choice inside the token kind", () => {
  it("makes the card an emblem on the emblem frame — colourless, common, no supertype or P/T — and back", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    expect(preview().supertype).toBe("Creature");
    await toggleEmblem();
    expect(preview().cardType).toBe("emblem");
    expect(preview().template).toBe("emblem");
    expect(preview().supertype).toBe("");
    expect(preview().power).toBe("");
    expect(preview().rarity).toBe("common");
    expect(emblemToggle().getAttribute("aria-pressed")).toBe("true");
    // Off again: a Creature token on the token frame.
    await toggleEmblem();
    expect(preview().cardType).toBe("token");
    expect(preview().template).toBe("m15token");
    expect(preview().supertype).toBe("Creature");
  });

  it("the Text step offers no cost, rarity or stats; the name is the walker's", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    await toggleEmblem();
    await clickNext(); // Card → Identity
    // The walker's name, and only the subtype under "More options".
    expect(screen.getByPlaceholderText("Kaito, Cunning Infiltrator")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Legendary")).toBeNull();
    expect(screen.queryByPlaceholderText("Snow")).toBeNull();
    expect(screen.getByPlaceholderText("Kaito")).toBeTruthy();
    await clickNext(); // Identity → Text & stats
    expect(screen.queryByRole("radiogroup", { name: "Rarity" })).toBeNull();
    expect(screen.queryByPlaceholderText("4")).toBeNull();
    expect(screen.queryByRole("group", { name: /mana cost/i })).toBeNull();
  });

  it("saves card_type emblem, colourless and common, with no cost, supertype or stats", async () => {
    actions.createCardAction.mockResolvedValue({
      ok: true,
      cardId: "44444444-4444-4444-8444-444444444444",
      slug: "kaito-cunning-infiltrator",
    });
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Creature/);
    await pickKind(/^Token/);
    await toggleEmblem();
    await clickNext();
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Kaito, Cunning Infiltrator"), {
        target: { value: "Kaito, Cunning Infiltrator" },
      });
    });
    await goToLastStep();
    await act(async () => {
      fireEvent.click(screen.getByTestId("save-as-draft"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    });
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "Kaito, Cunning Infiltrator",
      card_type: "emblem",
      color_identity: ["colorless"],
      rarity: "common",
      frame_style: { template: "emblem" },
    });
    for (const key of ["cost", "supertype", "power", "toughness", "loyalty", "defense"]) {
      expect(payload[key], key).toBeUndefined();
    }
  });

  it("an emblem import lands on the emblem kind and frame with the source's name (TFDN #25)", async () => {
    const raw = (emblemData as { printings: Array<{ set: string; collector_number: string }> }).printings.find(
      (p) => p.set === "tfdn" && p.collector_number === "25",
    )!;
    const card = scryfallCardSchema.parse(raw);
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
    renderForm({
      mode: "create",
      verifiedFrameKeys: WITH_EMBLEM,
      deckRemix: {
        deckCardId: "66666666-6666-4666-8666-666666666666",
        scryfallId: card.id,
        deckSlug: "tester/deck",
        deckTitle: "Deck",
        entryName: card.name,
      },
    });
    await waitFor(() => expect(preview().template).toBe("emblem"));
    expect(preview().cardType).toBe("emblem");
    expect(preview().title).toBe("Vivien Reid");
    expect(preview().supertype).toBe("");
    expect(preview().rarity).toBe("common");
  });
});

describe("6.23 skeptic review: entering the emblem keeps nothing a token had", () => {
  it("a red token becomes an emblem with no colour switch toast: the emblem is silver in every colour", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    await clickChip("Color identity", /^red/i);
    toast.info.mockReset();
    await toggleEmblem();
    expect(preview().template).toBe("emblem");
    expect(preview().cardType).toBe("emblem");
    const said = toast.info.mock.calls.map((call) => String(call[0]));
    expect(said.filter((text) => /isn.t available|switched the colou?r/i.test(text))).toEqual([]);
  });

  it("a token's subtype doesn't follow it in: the emblem starts on today's bare \"Emblem\"", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    await clickNext(); // Card → Identity
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), { target: { value: "Soldier" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await toggleEmblem();
    await clickNext(); // Card → Identity
    expect((screen.getByPlaceholderText("Kaito") as HTMLInputElement).value).toBe("");
  });

  // Owner evidence 2026-09-29: a Soldier token (named by its subtypes)
  // turned emblem kept "Soldier" as the emblem's name.
  it("a token named by its subtypes leaves that name behind: the emblem asks for the walker's", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    await clickNext(); // Card → Identity
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), { target: { value: "Soldier" } });
    });
    // The token's name follows its subtypes.
    expect(preview().title).toBe("Soldier");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await toggleEmblem();
    expect(preview().title).toBe("");
    await clickNext(); // Card → Identity
    expect((screen.getByPlaceholderText("Kaito, Cunning Infiltrator") as HTMLInputElement).value).toBe("");
  });

  it("a token with its own name keeps it as the emblem's", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    await clickNext(); // Card → Identity
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Dragon, Elder"), { target: { value: "Wolf" } });
    });
    const name = document.querySelector<HTMLInputElement>("input[name='title']");
    if (!name) throw new Error("no name input");
    await act(async () => {
      fireEvent.change(name, { target: { value: "Voja Fenstalker" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
    });
    await toggleEmblem();
    expect(preview().title).toBe("Voja Fenstalker");
  });

  it("the AI fill offers an emblem no cost, colour, rarity or stats; a token keeps them", async () => {
    renderForm({ mode: "create", verifiedFrameKeys: WITH_EMBLEM });
    await pickKind(/^Token/);
    expect(fill.hidden ?? []).toEqual([]);
    await toggleEmblem();
    expect([...(fill.hidden ?? [])].sort()).toEqual(["color_identity", "cost", "rarity", "stats"]);
  });
});
