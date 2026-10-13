// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { resolveLoyaltyRows, resolveSagaChapters } from "@/lib/cards/face-content";
import { updateCardSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// The follow-up to #528 (creator-footer-and-create-clears.test.tsx), through
// the real CardCreatorForm. Three faults its independent check found:
//
// 1. A walker stored as plain text with MORE THAN SIX lines, or a saga with
//    a chapter VII–X, could not be saved from the editor at all: the dual
//    write (rows beside the text) is past what `face_content` stores, and
//    the server refused the whole save — a retitle included. Untouched, the
//    card now stays plain text (no `face_content` sent); edited, it saves as
//    plain text — the rows serialized, which the renderers parse back into
//    the same rows. Every payload here is run through the SERVER's schema.
// 2. A saga row with a text and no chapter number was dropped by the save
//    without a word (or, alone, its edit was not saved). The row now says
//    "Pick a chapter number" and the save waits — never on a stored card
//    the maker only retitles.
// 3. The Subscriber step's helper said the card "keeps whatever is in the
//    box"; an untouched card with no footer of its own follows the default.
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

function renderForm(
  mode: "create" | "edit" | "remix",
  card?: Card,
  viewer: { isPaid?: boolean; defaultFooterText?: string | null } = {},
) {
  return render(
    <CardCreatorForm
      mode={mode}
      card={card}
      userId={USER}
      ownerUsername="tester"
      gameSystems={GAME_SYSTEMS}
      aiConfigured
      verifiedFrameKeys={VERIFIED}
      {...viewer}
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
/** The pip editors (a walker's rows, a saga's chapters) are contenteditable
 *  boxes named by `data-field`. */
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
const sentCreate = async () => {
  await save();
  await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
  return actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
};

const PAID = { isPaid: true, defaultFooterText: "tester.art" };

/** The server's own answer: would updateCardAction's schema take this? */
const serverAccepts = (payload: Record<string, unknown>) => updateCardSchema.safeParse(payload).success;

const walker = (rules_text: string, face_content: unknown = null) =>
  savedCard({
    card_type: "planeswalker",
    subtypes: ["Kesh"],
    power: null,
    toughness: null,
    loyalty: "4",
    rules_text,
    face_content,
    frame_style: { finish: "regular", template: "m15pw" },
  });
const saga = (rules_text: string, face_content: unknown = null) =>
  savedCard({
    card_type: "enchantment",
    supertype: null,
    subtypes: ["Saga"],
    power: null,
    toughness: null,
    flavor_text: null,
    rules_text,
    face_content,
    frame_style: { finish: "regular", template: "saga" },
  });
const clickLabel = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getAllByLabelText(label)[0]);
  });
};
const openRows = async (card: Card, mode: "edit" | "remix" = "edit") => {
  renderForm(mode, card);
  await type("title", "Another Name");
  await goTo("Text & stats");
};
/** A save that must NOT reach the server. */
const blockedSave = async () => {
  await save();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(actions.updateCardAction).not.toHaveBeenCalled();
  expect(actions.createCardAction).not.toHaveBeenCalled();
};

// Seven lines: one more than `face_content` stores. Spelled as Scryfall
// spells a cost (U+2212), so "byte for byte" is not the canonical text.
const SEVEN = [
  "Flying",
  "+2: Draw a card.",
  "+1: Scry 2.",
  "0: Untap target land.",
  "−1: Deal 1 damage to any target.",
  "−3: Destroy target creature.",
  "−8: You get an emblem.",
].join("\n");

describe("a planeswalker stored as plain text with seven lines", () => {
  it("a title-only edit saves: the text byte for byte, and no rows written beside it", async () => {
    renderForm("edit", walker(SEVEN));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.title).toBe("Another Name");
    expect(payload.rules_text).toBe(SEVEN);
    expect(payload).not.toHaveProperty("face_content");
    expect(serverAccepts(payload)).toBe(true);
  });

  it("an edited row saves what the editor shows — as plain text the renderers read back as those rows", async () => {
    await openRows(walker(SEVEN));
    await typeRich("loyalty_abilities.2.text", "Scry 3.");
    expect(screen.getByTestId("rows-save-as-text")).toBeTruthy();
    const payload = await sentUpdate();
    expect(serverAccepts(payload)).toBe(true);
    expect(payload.face_content).toBeNull();
    expect(payload.rules_text).toBe(
      [
        "Flying",
        "+2: Draw a card.",
        "+1: Scry 3.",
        "0: Untap target land.",
        "-1: Deal 1 damage to any target.",
        "-3: Destroy target creature.",
        "-8: You get an emblem.",
      ].join("\n"),
    );
    expect(resolveLoyaltyRows(null, payload.rules_text as string)).toEqual([
      { cost: null, text: "Flying" },
      { cost: "+2", text: "Draw a card." },
      { cost: "+1", text: "Scry 3." },
      { cost: "0", text: "Untap target land." },
      { cost: "-1", text: "Deal 1 damage to any target." },
      { cost: "-3", text: "Destroy target creature." },
      { cost: "-8", text: "You get an emblem." },
    ]);
  });

  it("a remix of it (a NEW card) saves too: the canonical text, no rows beside it", async () => {
    renderForm("remix", walker(SEVEN));
    await type("title", "My Own Name");
    const payload = await sentCreate();
    expect(payload.face_content).toBeNull();
    expect(resolveLoyaltyRows(null, payload.rules_text as string)).toEqual(resolveLoyaltyRows(null, SEVEN));
  });

  it("a row removed brings it to six: the rows are stored again", async () => {
    await openRows(walker(SEVEN));
    await clickLabel("Remove ability 1");
    expect(screen.queryByTestId("rows-save-as-text")).toBeNull();
    const payload = await sentUpdate();
    expect(serverAccepts(payload)).toBe(true);
    expect((payload.face_content as { loyalty: { abilities: unknown[] } }).loyalty.abilities).toHaveLength(6);
    expect(payload.rules_text).toBe(
      "+2: Draw a card.\n+1: Scry 2.\n0: Untap target land.\n-1: Deal 1 damage to any target.\n-3: Destroy target creature.\n-8: You get an emblem.",
    );
  });

  it.each([
    ["a cost of four digits", "+1000: Win.\n-1: Lose."],
    ["a line past 600 characters", `+1: ${"Draw a card. ".repeat(50).trim()}\n-1: Lose.`],
  ])("%s, untouched: it still retitles, as it is stored", async (_label, text) => {
    renderForm("edit", walker(text));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    expect(payload).not.toHaveProperty("face_content");
    expect(serverAccepts(payload)).toBe(true);
  });

  it("an ordinary walker is unchanged: the dual write, the text byte for byte", async () => {
    const text = "−2: Deal 2 damage.\n+1 : Scry 1.";
    renderForm("edit", walker(text));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    expect(payload.face_content).toEqual({
      v: 1,
      loyalty: {
        abilities: [
          { cost: "-2", text: "Deal 2 damage." },
          { cost: "+1", text: "Scry 1." },
        ],
      },
    });
  });
});

const VII = "(Reminder.)\nI, II — One.\nIII — Three.\nVII — Seven.";

describe("a saga stored as plain text with a chapter VII", () => {
  it("a title-only edit saves: the text byte for byte, and no rows written beside it", async () => {
    renderForm("edit", saga(VII));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(VII);
    expect(payload).not.toHaveProperty("face_content");
    expect(serverAccepts(payload)).toBe(true);
  });

  it("the row shows its chapter VII — it is not an unnumbered row", async () => {
    await openRows(saga(VII));
    expect(screen.getAllByLabelText("Chapter VII for row 3")[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    // …and an ordinary saga is offered I–VI, as before.
    cleanup();
    await openRows(saga("I — One.\nII — Two."));
    expect(screen.queryByLabelText("Chapter VII for row 1")).toBeNull();
    expect(screen.getAllByLabelText("Chapter VI for row 1").length).toBeGreaterThan(0);
  });

  it("an edited row saves what the editor shows — as plain text the renderers read back as those chapters", async () => {
    await openRows(saga(VII));
    await typeRich("saga_chapters.1.text", "Three, changed.");
    expect(screen.getByTestId("rows-save-as-text")).toBeTruthy();
    const payload = await sentUpdate();
    expect(serverAccepts(payload)).toBe(true);
    expect(payload.face_content).toBeNull();
    expect(payload.rules_text).toBe("(Reminder.)\nI, II — One.\nIII — Three, changed.\nVII — Seven.");
    expect(resolveSagaChapters(null, payload.rules_text as string)).toEqual({
      intro: "(Reminder.)",
      chapters: [
        { marker: "I,II", text: "One." },
        { marker: "III", text: "Three, changed." },
        { marker: "VII", text: "Seven." },
      ],
    });
  });

  it("seven rows of chapters I–VI and a shared one: the same", async () => {
    const text = ["I — a", "II — b", "III — c", "IV — d", "V — e", "VI — f", "I, VI — g"].join("\n");
    renderForm("edit", saga(text));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    expect(payload).not.toHaveProperty("face_content");
    expect(serverAccepts(payload)).toBe(true);
  });

  it.each([
    // The rows hold a row's numbers ascending: written as face_content, the
    // card would draw "I, II" where it draws "II, I" today.
    ["a marker out of order", "II, I — Both.\nIII — Three."],
    // XI is no number the editor has: the rows would say "I" alone.
    ["a marker the editor can number in part", "I, XI — Both.\nII — Two."],
  ])("%s, untouched: the card stays plain text", async (_label, text) => {
    renderForm("edit", saga(text));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    expect(payload).not.toHaveProperty("face_content");
  });

  it("an ordinary saga is unchanged: the dual write, the text byte for byte", async () => {
    const text = "(Reminder.)\n\nI,II — Draw a card.\nIII — Win.";
    renderForm("edit", saga(text));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    expect(payload.face_content).toEqual({
      v: 1,
      saga: {
        intro: "(Reminder.)",
        chapters: [
          { numerals: [1, 2], text: "Draw a card." },
          { numerals: [3], text: "Win." },
        ],
      },
    });
  });
});

describe("a saga row with a text and no chapter number", () => {
  const MESSAGE = "Pick a chapter number for this row, or remove it.";
  const XI = "I — One.\nXI — Eleven.";

  it("a number switched off: the save waits and the row says why", async () => {
    await openRows(saga("I — One.\nII — Two."));
    await clickLabel("Chapter II for row 2");
    await blockedSave();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(MESSAGE);
    // The message belongs to that row's chapter buttons.
    const group = screen.getByRole("group", { name: "Chapters of row 2" });
    expect(group.getAttribute("aria-describedby")).toBe(alert.id);
    expect(screen.getByRole("group", { name: "Chapters of row 1" }).getAttribute("aria-describedby")).toBeNull();
  });

  it("…and picking one clears it at once; the row is saved", async () => {
    await openRows(saga("I — One.\nII — Two."));
    await clickLabel("Chapter II for row 2");
    await blockedSave();
    await clickLabel("Chapter III for row 2");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((await sentUpdate()).rules_text).toBe("I — One.\nIII — Two.");
  });

  it("a stored marker the editor can't number: a retitle is not asked anything", async () => {
    renderForm("edit", saga(XI));
    await type("title", "Another Name");
    expect((await sentUpdate()).rules_text).toBe(XI);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("…but once ANOTHER row is edited that row would be dropped: it is asked for its number", async () => {
    await openRows(saga(XI));
    await typeRich("saga_chapters.0.text", "One, changed.");
    await blockedSave();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE);
    expect(screen.getByRole("group", { name: "Chapters of row 2" }).getAttribute("aria-describedby")).toBeTruthy();
    // Removing it is the other answer.
    await clickLabel("Remove chapter row 2");
    expect((await sentUpdate()).rules_text).toBe("I — One, changed.");
  });

  it("the only row, its text edited: the edit is not silently left unsaved", async () => {
    await openRows(saga("XI — Eleven."));
    await typeRich("saga_chapters.0.text", "Eleven, changed.");
    await blockedSave();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE);
    await clickLabel("Chapter I for row 1");
    expect((await sentUpdate()).rules_text).toBe("I — Eleven, changed.");
  });

  it("a new card (a remix) with such a row beside numbered ones: asked too", async () => {
    await openRows(saga(XI), "remix");
    await blockedSave();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE);
  });
});

describe("the Subscriber step's footer helper", () => {
  it("says what a card keeps and what follows the default", async () => {
    renderForm("edit", savedCard(), PAID);
    await goTo("Subscriber");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("keeps whatever is in the box");
    expect(text).toContain("a card you never changed here follows your default");
  });
});
