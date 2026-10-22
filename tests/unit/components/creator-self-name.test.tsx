// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 6.2 — CARDNAME / `~` in the real CardCreatorForm: the rules editor's
// words row (the card's name as ~, "this …", the keywords with their
// reminder text only when asked for) and a card stored with a literal ~
// (migration 0142's flag): its note, its one-way switch, and an edit that
// leaves it alone sending nothing for it. Harness:
// creator-clear-fields-save.test.tsx.
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
const VERIFIED = ["m15", "m15pw", "m15land", "saga", "split", "aftermath", "adventure", "flip"].flatMap((t) =>
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
const rulesText = () => document.querySelector('[data-field="rules_text"]')?.textContent ?? "";
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};

describe("the rules editor's words row", () => {
  it("is a group of its own beside the symbols, named for what it does", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    const words = screen.getByRole("group", { name: "Insert words" });
    expect(words).toBeTruthy();
    expect(screen.getByRole("group", { name: "Insert a symbol" })).toBeTruthy();
    // Each button its own name; never the group's.
    expect(screen.getByRole("button", { name: "Insert the card's name (~)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insert “this creature”" })).toBeTruthy();
  });

  it("inserts ~ and the card's \"this …\" into the rules text", async () => {
    renderForm("edit", savedCard({ rules_text: "" }));
    await goTo("Text & stats");
    await click("Insert the card's name (~)");
    expect(rulesText()).toContain("~");
    await click("Insert “this creature”");
    expect(rulesText()).toContain("this creature");
  });

  it("inserts a keyword bare by default, with its reminder text only when ticked", async () => {
    renderForm("edit", savedCard({ rules_text: "" }));
    await goTo("Text & stats");
    await click("Insert Flying");
    expect(rulesText()).toContain("Flying");
    expect(rulesText()).not.toContain("(This creature");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "With reminder text" }));
    });
    await click("Insert Vigilance with its reminder text");
    expect(rulesText()).toContain("Vigilance (Attacking doesn’t cause this creature to tap.)");
  });
});

describe("a card stored with a literal ~ (migration 0142's flag)", () => {
  const FLAGGED = { rules_text: "~ deals 3 damage to any target.", frame_style: { finish: "regular", template: "m15", selfName: "literal" } };

  it("an edit that leaves it alone sends nothing for it", async () => {
    renderForm("edit", savedCard(FLAGGED));
    await type("title", "Kesh, Emberforge Keeper");
    const payload = await sentUpdate();
    expect(payload.frame_anatomy).toBeUndefined();
  });

  it("says so under the editor and switches the name on — one way — on the next save", async () => {
    renderForm("edit", savedCard(FLAGGED));
    await goTo("Text & stats");
    expect(screen.getByTestId("self-name-literal-note").textContent).toMatch(/prints as typed/);
    await click("Print ~ as the card’s name");
    expect(screen.queryByTestId("self-name-literal-note")).toBeNull();
    const payload = await sentUpdate();
    expect(payload.frame_anatomy).toEqual({ selfName: "name" });
  });

  it("the switch hands the focus on to the rules editor when it goes (never <body>)", async () => {
    renderForm("edit", savedCard(FLAGGED));
    await goTo("Text & stats");
    const button = screen.getByRole("button", { name: "Print ~ as the card’s name" });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-field")).toBe("rules_text"));
  });

  it.each([
    [
      "a walker's rows",
      {
        card_type: "planeswalker",
        subtypes: ["Kesh"],
        power: null,
        toughness: null,
        loyalty: "4",
        rules_text: "+1: ~ deals 1 damage to any target.",
        face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "~ deals 1 damage to any target." }] } },
        frame_style: { finish: "regular", template: "m15pw", selfName: "literal" },
      },
    ],
    [
      "a saga's rows",
      {
        card_type: "enchantment",
        supertype: null,
        subtypes: ["Saga"],
        power: null,
        toughness: null,
        rules_text: "I — Exile ~.",
        face_content: { v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "Exile ~." }] } },
        frame_style: { finish: "regular", template: "saga", selfName: "literal" },
      },
    ],
    [
      "a station's tiers",
      {
        card_type: "artifact",
        supertype: null,
        subtypes: ["Spacecraft"],
        power: "3",
        toughness: "3",
        rules_text: "Station\n6+ | ~ has flying.",
        face_content: null,
        frame_style: { finish: "regular", template: "m15station", selfName: "literal" },
      },
    ],
  ])("is offered beside %s too", async (_label, over) => {
    renderForm("edit", savedCard(over));
    await goTo("Text & stats");
    expect(screen.getByTestId("self-name-literal-note")).toBeTruthy();
    await click("Print ~ as the card’s name");
    expect(screen.queryByTestId("self-name-literal-note")).toBeNull();
    expect((await sentUpdate()).frame_anatomy).toEqual({ selfName: "name" });
  });

  it("is offered beside a second part's rules too", async () => {
    renderForm(
      "edit",
      savedCard({
        card_type: "instant",
        supertype: null,
        subtypes: [],
        power: null,
        toughness: null,
        rules_text: "Fire deals 2 damage.",
        back_face: { title: "Ice", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent. ~ draws a card." },
        frame_style: { finish: "regular", template: "split", selfName: "literal" },
      }),
    );
    await goTo("Text & stats");
    expect(screen.queryByTestId("self-name-literal-note")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /right half/i }));
    });
    expect(screen.getByTestId("self-name-literal-note")).toBeTruthy();
  });

  it("no note on a card without the flag, or with no token in its text", async () => {
    renderForm("edit", savedCard({ rules_text: "~ attacks." }));
    await goTo("Text & stats");
    expect(screen.getByRole("group", { name: "Insert words" })).toBeTruthy();
    expect(screen.queryByTestId("self-name-literal-note")).toBeNull();
    cleanup();
    renderForm("edit", savedCard({ ...FLAGGED, rules_text: "Haste" }));
    await goTo("Text & stats");
    expect(screen.getByRole("group", { name: "Insert words" })).toBeTruthy();
    expect(screen.queryByTestId("self-name-literal-note")).toBeNull();
  });
});
