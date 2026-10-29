// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { resolveSagaChapters } from "@/lib/cards/face-content";
import { updateCardSchema } from "@/lib/validation/card";
import { withPrintTypographyUpdate } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// The follow-up to #534 (creator-structured-rows-save.test.tsx), through the
// real CardCreatorForm. Three things its independent check left:
//
// 1. A save blocked by "Pick a chapter number for this row, or remove it."
//    left the focus on Save, the message somewhere above it. The first such
//    row's chapter group takes the focus, and the row is listed above Save
//    as a link to it — not a second announcement: the row's message is the
//    alert.
// 2. An EDITED save of a saga wrote every row's marker from its numbers:
//    editing row A re-ordered row B's "II, I —" to "I, II —" and took the XI
//    off "I, XI —" — on the card too. A row whose numbers the maker did not
//    change now keeps its marker as stored, in `rules_text` and in what the
//    renderers resolve; numbers changed on a marker with a numeral the
//    editor can't set are never saved short of it without a word.
// 3. A walker with so many rows that its loyalty badges touch says the card
//    will be crowded (a note — nothing is blocked).
//
// Every `sent` payload is what the form handed updateCardAction; the marker
// cases are also run through the SERVER's schema and its typography pass.
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

/** What both renderers draw the rail from: each row's marker and text. */
const drawn = (payload: Record<string, unknown>) =>
  resolveSagaChapters(payload.face_content as never, payload.rules_text as string).chapters;
const storedDraws = (rules_text: string, face_content: unknown = null) =>
  resolveSagaChapters(face_content as never, rules_text).chapters;
/** The server's typography pass over the patch (updateCardAction runs it
 *  after its schema): what the ROW ends up holding. */
const asStored = (payload: Record<string, unknown>, card: Card) =>
  withPrintTypographyUpdate(payload as never, card as never) as unknown as Record<string, unknown>;
const focused = () => document.activeElement as HTMLElement | null;

const NEEDS_NUMBER = "Pick a chapter number for this row, or remove it.";

describe("1. a save blocked by a row's chapter number", () => {
  it("moves the focus to that row's chapter group — the step opened, the message its description", async () => {
    await openRows(saga("I — One.\nII — Two."));
    await clickLabel("Chapter II for row 2");
    // Away from the Text step: the blocked save has to open it again.
    await goTo("Identity");
    await blockedSave();
    const group = await waitFor(() => screen.getByRole("group", { name: "Chapters of row 2" }));
    await waitFor(() => expect(focused()).toBe(group));
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((el) => el.textContent)).toEqual([NEEDS_NUMBER]);
    expect(group.getAttribute("aria-describedby")).toBe(alerts[0].id);
    expect(group.getAttribute("tabindex")).toBe("-1");
  });

  it("the FIRST such row when there are two", async () => {
    await openRows(saga("I — One.\nII — Two.\nIII — Three."));
    await clickLabel("Chapter II for row 2");
    await clickLabel("Chapter III for row 3");
    await blockedSave();
    await waitFor(() => expect(focused()).toBe(screen.getByRole("group", { name: "Chapters of row 2" })));
  });

  it("lists the rows above Save as links to them — and says it once: the line is not a live region", async () => {
    await openRows(saga("I — One.\nII — Two.\nIII — Three."));
    await clickLabel("Chapter II for row 2");
    await clickLabel("Chapter III for row 3");
    await blockedSave();
    const line = screen.getByTestId("save-blocked-rows");
    expect(line.textContent).toBe("Not saved — check the chapters of row 2 and row 3.");
    expect(line.getAttribute("role")).toBeNull();
    expect(line.getAttribute("aria-live")).toBeNull();
    // The message is announced by the rows' own alerts, nowhere else.
    expect(screen.queryAllByRole("status").filter((el) => el.textContent?.includes("chapter"))).toEqual([]);
    // A link moves the focus to its row, like every "still needed" link.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^row 3 — go to its chapters/ }));
    });
    await waitFor(() => expect(focused()).toBe(screen.getByRole("group", { name: "Chapters of row 3" })));
    // Answered, a row leaves the line; with the last one the line goes.
    await clickLabel("Chapter III for row 3");
    await waitFor(() => expect(screen.getByTestId("save-blocked-rows").textContent).toBe("Not saved — check the chapters of row 2."));
    await clickLabel("Chapter II for row 2");
    await waitFor(() => expect(screen.queryByTestId("save-blocked-rows")).toBeNull());
    expect((await sentUpdate()).rules_text).toBe("I — One.\nII — Two.\nIII — Three.");
  });

  // (The independent check of #539.) The refresh after a save lands a moment
  // later; a Save pressed and blocked inside that window had its message
  // wiped by the keyed reset — the focus on a row that no longer said why.
  it("the message and the line outlive the refresh of the save before", async () => {
    const card = saga("I — One.\nII — Two.");
    const view = renderForm("edit", card);
    await goTo("Text & stats");
    await typeRich("saga_chapters.0.text", "One, changed.");
    await sentUpdate();
    await clickLabel("Chapter II for row 2");
    await save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(NEEDS_NUMBER));
    // The refresh: the same card, as the first save left it.
    await act(async () => {
      view.rerender(
        <CardCreatorForm
          mode="edit"
          card={{ ...card, rules_text: "I — One, changed.\nII — Two.", updated_at: "2026-09-29T10:00:05.000Z" } as Card}
          userId={USER}
          ownerUsername="tester"
          gameSystems={GAME_SYSTEMS}
          aiConfigured
          verifiedFrameKeys={VERIFIED}
        />,
      );
    });
    expect(screen.getByRole("alert").textContent).toBe(NEEDS_NUMBER);
    expect(screen.getByTestId("save-blocked-rows").textContent).toBe("Not saved — check the chapters of row 2.");
    expect(actions.updateCardAction).toHaveBeenCalledTimes(1);
    // …and it still goes when the row is answered.
    await clickLabel("Chapter II for row 2");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("save-blocked-rows")).toBeNull();
  });

  it("no line and no moved focus on a save that goes through", async () => {
    await openRows(saga("I — One.\nII — Two."));
    await typeRich("saga_chapters.1.text", "Two, changed.");
    await sentUpdate();
    expect(screen.queryByTestId("save-blocked-rows")).toBeNull();
  });
});

describe("2. an edited save keeps the marker of a row whose numbers were not touched", () => {
  const ORDER = "II, I — Both.\nIII — Three.";
  const ELEVEN = "I, XI — Both.\nII — Two.";

  it("“II, I —” with ANOTHER row edited: not re-ordered, in the text or on the card", async () => {
    const card = saga(ORDER);
    await openRows(card);
    await typeRich("saga_chapters.1.text", "Three, changed.");
    const sent = await sentUpdate();
    expect(sent.rules_text).toBe("II, I — Both.\nIII — Three, changed.");
    expect(drawn(sent)[0]).toEqual(storedDraws(ORDER)[0]);
    expect(drawn(sent).map((ch) => ch.marker)).toEqual(["II,I", "III"]);
    expect(serverAccepts(sent)).toBe(true);
    expect(drawn(asStored(sent, card))).toEqual(drawn(sent));
  });

  it("“I, XI —” with another row edited: the XI stays — the card saves as plain text, which is what draws", async () => {
    const card = saga(ELEVEN);
    await openRows(card);
    await typeRich("saga_chapters.1.text", "Two, changed.");
    expect(screen.getByTestId("rows-save-as-text")).toBeTruthy();
    const sent = await sentUpdate();
    expect(sent.rules_text).toBe("I, XI — Both.\nII — Two, changed.");
    expect(sent.face_content).toBeNull();
    expect(drawn(sent)[0]).toEqual(storedDraws(ELEVEN)[0]);
    expect(drawn(sent).map((ch) => ch.marker)).toEqual(["I,XI", "II"]);
    expect(serverAccepts(sent)).toBe(true);
    expect(asStored(sent, card).rules_text).toBe(sent.rules_text);
  });

  it("…a stored face_content beside that text is replaced by it, never left to draw the old rows", async () => {
    const stored = { v: 1, saga: { intro: null, chapters: [{ numerals: [2, 1], text: "Both." }, { numerals: [3], text: "Three." }] } };
    const card = saga(ORDER, stored);
    await openRows(card);
    await typeRich("saga_chapters.1.text", "Three, changed.");
    const sent = await sentUpdate();
    expect((sent.face_content as typeof stored).saga.chapters[0]).toEqual({ numerals: [2, 1], text: "Both." });
    expect(drawn(sent)[0]).toEqual(storedDraws(ORDER, stored)[0]);
  });

  it("the marker row's own TEXT edited: its marker is kept", async () => {
    for (const [text, marker] of [
      [ORDER, "II, I"],
      [ELEVEN, "I, XI"],
    ] as const) {
      const card = saga(text);
      await openRows(card);
      await typeRich("saga_chapters.0.text", "Both, changed.");
      const sent = await sentUpdate();
      expect((sent.rules_text as string).split("\n")[0]).toBe(`${marker} — Both, changed.`);
      expect(drawn(sent)[0].marker).toBe(marker.replace(" ", ""));
      expect(serverAccepts(sent)).toBe(true);
      cleanup();
      actions.updateCardAction.mockClear();
    }
  });

  it("the row says what it is stored as, while it keeps it", async () => {
    await openRows(saga(ELEVEN));
    expect(screen.getByTestId("saga-row-0-stored-marker").textContent).toContain("Stored as “I, XI”");
    expect(screen.queryByTestId("saga-row-1-stored-marker")).toBeNull();
  });

  it("its NUMBERS changed on “I, XI —”: the save waits and the row says the XI would go", async () => {
    await openRows(saga(ELEVEN));
    await clickLabel("Chapter III for row 1");
    await blockedSave();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "This row is stored as “I, XI”, and the editor can’t set XI. Put its chapters back to keep it as it is, or drop XI.",
    );
    const group = screen.getByRole("group", { name: "Chapters of row 1" });
    expect(group.getAttribute("aria-describedby")).toBe(alert.id);
    await waitFor(() => expect(focused()).toBe(group));
    expect(screen.getByTestId("save-blocked-rows").textContent).toBe("Not saved — check the chapters of row 1.");
  });

  it("…put back, the marker is kept and the save goes through", async () => {
    await openRows(saga(ELEVEN));
    await clickLabel("Chapter III for row 1");
    await blockedSave();
    await clickLabel("Chapter III for row 1");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    // (Only the title differs from the card as it opened: the stored text.)
    expect((await sentUpdate()).rules_text).toBe(ELEVEN);
  });

  it("…or dropped by name: the numbers picked are the row's", async () => {
    await openRows(saga(ELEVEN));
    await clickLabel("Chapter III for row 1");
    await blockedSave();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Drop XI" }));
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    const sent = await sentUpdate();
    expect(sent.rules_text).toBe("I, III — Both.\nII — Two.");
    expect(serverAccepts(sent)).toBe(true);
  });

  it("…dropped and the numbers put back to I: the drop is the maker's edit, it is not undone", async () => {
    await openRows(saga(ELEVEN));
    await clickLabel("Chapter III for row 1");
    await blockedSave();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Drop XI" }));
    });
    await clickLabel("Chapter III for row 1");
    expect((await sentUpdate()).rules_text).toBe("I — Both.\nII — Two.");
  });

  it("its numbers changed on “II, I —” (nothing the editor can't set): the numbers picked, ascending", async () => {
    await openRows(saga(ORDER));
    await clickLabel("Chapter IV for row 1");
    expect((await sentUpdate()).rules_text).toBe("I, II, IV — Both.\nIII — Three.");
  });

  // (The independent check of #539.) A row a save wrote from its NUMBERS no
  // longer holds the marker it opened with — and the form knew it only once
  // the refresh after the save had landed: inside that window the numbers
  // put back wrote the OPENED marker again.
  const secondUpdate = async () => {
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(2));
    return actions.updateCardAction.mock.calls[1][1] as Record<string, unknown>;
  };

  it("“II, I —” saved as “I, II, IV —”, then IV off before the refresh: what the row holds, ascending — not the opened order", async () => {
    await openRows(saga(ORDER));
    await clickLabel("Chapter IV for row 1");
    expect((await sentUpdate()).rules_text).toBe("I, II, IV — Both.\nIII — Three.");
    expect(screen.queryByTestId("saga-row-0-stored-marker")).toBeNull();
    await clickLabel("Chapter IV for row 1");
    expect(screen.queryByTestId("saga-row-0-stored-marker")).toBeNull();
    const sent = await secondUpdate();
    expect(sent.rules_text).toBe("I, II — Both.\nIII — Three.");
    expect(drawn(sent).map((ch) => ch.marker)).toEqual(["I,II", "III"]);
  });

  it("“XI —” saved under a picked number, then the number off before the refresh: asked, the XI does not come back", async () => {
    await openRows(saga("I — One.\nXI — Eleven."));
    await clickLabel("Chapter II for row 2");
    expect((await sentUpdate()).rules_text).toBe("I — One.\nII — Eleven.");
    await clickLabel("Chapter II for row 2");
    await save();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(actions.updateCardAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(NEEDS_NUMBER);
  });

  it("…a row that KEPT its marker through a save still carries it (another row edited twice)", async () => {
    await openRows(saga(ORDER));
    await typeRich("saga_chapters.1.text", "Three, changed.");
    expect((await sentUpdate()).rules_text).toBe("II, I — Both.\nIII — Three, changed.");
    await typeRich("saga_chapters.1.text", "Three, changed again.");
    const sent = await secondUpdate();
    expect(sent.rules_text).toBe("II, I — Both.\nIII — Three, changed again.");
    expect(drawn(sent).map((ch) => ch.marker)).toEqual(["II,I", "III"]);
    expect(screen.getByTestId("saga-row-0-stored-marker")).toBeTruthy();
  });

  it("“Drop XI” leaves the focus on the row's chapters, not on a button that is gone", async () => {
    await openRows(saga(ELEVEN));
    await clickLabel("Chapter III for row 1");
    await blockedSave();
    const drop = screen.getByRole("button", { name: "Drop XI" });
    drop.focus();
    await act(async () => {
      fireEvent.click(drop);
    });
    expect(screen.queryByRole("button", { name: "Drop XI" })).toBeNull();
    expect(focused()?.getAttribute("data-field-anchor")).toBe("saga_chapters.0.numerals");
  });

  it("a remix (a new card) keeps its parent's markers too", async () => {
    await openRows(saga(ELEVEN), "remix");
    const sent = await sentCreate();
    expect(sent.rules_text).toBe(ELEVEN);
  });

  it("an ordinary saga is unchanged: an edited row saves the rows, ascending, beside their text", async () => {
    await openRows(saga("(Reminder.)\nI, II — Draw a card.\nIII — Win."));
    expect(screen.queryByTestId("saga-row-0-stored-marker")).toBeNull();
    await typeRich("saga_chapters.1.text", "Win more.");
    const sent = await sentUpdate();
    expect(sent.rules_text).toBe("(Reminder.)\nI, II — Draw a card.\nIII — Win more.");
    expect(sent.face_content).toEqual({
      v: 1,
      saga: {
        intro: "(Reminder.)",
        chapters: [
          { numerals: [1, 2], text: "Draw a card." },
          { numerals: [3], text: "Win more." },
        ],
      },
    });
  });

  it("the server keeps an untouched row's characters on such a plain-text save (its quotes are not re-set)", async () => {
    const QUOTED = "I, XI — Say \"both\".\nII — Two.";
    const card = saga(QUOTED);
    await openRows(card);
    await typeRich("saga_chapters.1.text", "Two, \"changed\".");
    const sent = await sentUpdate();
    expect(asStored(sent, card).rules_text).toBe("I, XI — Say \"both\".\nII — Two, “changed”.");
  });
});

describe("3. a walker whose loyalty badges touch", () => {
  const lines = (count: number) => Array.from({ length: count }, (_, i) => `+${i + 1}: Draw a card.`).join("\n");

  // (Layout v75: the badges at print's size meet from six one-line rows on
  // m15pw — nine with the 69 px badges before; lib/creator/walker-crowding.ts.)
  it("six one-line abilities on m15pw: the editor says the card will be crowded", async () => {
    await openRows(walker(lines(6)));
    expect(screen.getByTestId("rows-crowded").textContent).toBe(
      "With this many rows the card will be crowded: its loyalty badges touch.",
    );
    // A note: the card still saves.
    expect((await sentUpdate()).rules_text).toBe(lines(6));
  });

  it("five, and an ordinary walker: no note", async () => {
    await openRows(walker(lines(5)));
    expect(screen.queryByTestId("rows-crowded")).toBeNull();
    cleanup();
    await openRows(walker("+1: Draw a card.\n−2: Deal 3 damage to any target.\n−7: You get an emblem."));
    expect(screen.queryByTestId("rows-crowded")).toBeNull();
  });

  it("follows the rows as they are removed", async () => {
    await openRows(walker(lines(6)));
    expect(screen.getByTestId("rows-crowded")).toBeTruthy();
    await clickLabel("Remove ability 6");
    await waitFor(() => expect(screen.queryByTestId("rows-crowded")).toBeNull());
  });
});
