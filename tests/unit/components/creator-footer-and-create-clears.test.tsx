// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The follow-up to the emptied-field fix (creator-clear-fields-save.test.tsx),
// through the real CardCreatorForm:
//
// 1. The footer mark. The field SHOWS the profile default on a card whose
//    stored footer_text is NULL ("use my profile default"), and the form
//    resent it on every edit: a retitle froze the NULL to "" or to the
//    default's text. An edit now sends footer_text only when the maker
//    changed what the field opened with; emptying it is the explicit ""
//    (no footer mark). A new card and a remix always send it.
// 2. A NEW planeswalker / saga whose rows were all removed sent the hidden
//    textarea's copy of them as rules_text (the edit was fixed first).
// 3. A walker stored without face_content gains it on its first edit (the
//    dual write) — its rules_text travels byte for byte.
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
const VERIFIED = ["m15", "m15pw", "m15land", "saga"].flatMap((t) =>
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

describe("the footer mark on an edit that did not touch it", () => {
  it("a NULL footer (use my profile default) is not sent — it stays NULL in the row", async () => {
    renderForm("edit", savedCard({ footer_text: null }), PAID);
    await type("title", "Another Name");
    const payload = await sentUpdate();
    // Not the profile default the field shows, and not "".
    expect(payload).not.toHaveProperty("footer_text");
    expect(payload.title).toBe("Another Name");
  });

  it("…with no profile default either", async () => {
    renderForm("edit", savedCard({ footer_text: null }), { isPaid: true, defaultFooterText: null });
    await type("title", "Another Name");
    expect(await sentUpdate()).not.toHaveProperty("footer_text");
  });

  it.each([
    ["an explicit none", ""],
    ["the card's own text", "kesh.example"],
  ])("%s is not resent", async (_label, stored) => {
    renderForm("edit", savedCard({ footer_text: stored }), PAID);
    await type("title", "Another Name");
    expect(await sentUpdate()).not.toHaveProperty("footer_text");
  });

  it("a free account sends none (the step is an upsell)", async () => {
    renderForm("edit", savedCard({ footer_text: "from.a.past.plan" }), { isPaid: false });
    await type("title", "Another Name");
    expect(await sentUpdate()).not.toHaveProperty("footer_text");
  });

  it("typed and put back as it opened: still untouched", async () => {
    renderForm("edit", savedCard({ footer_text: null }), PAID);
    await type("title", "Another Name");
    await goTo("Subscriber");
    await type("footer_text", "something else");
    await type("footer_text", "tester.art");
    expect(await sentUpdate()).not.toHaveProperty("footer_text");
  });
});

describe("the footer mark on an edit that changed it", () => {
  it("a new text is sent", async () => {
    renderForm("edit", savedCard({ footer_text: null }), PAID);
    await goTo("Subscriber");
    await type("footer_text", "  kesh.example ");
    expect((await sentUpdate()).footer_text).toBe("kesh.example");
  });

  it("emptied over a NULL that showed the profile default: the explicit \"\" — no footer mark", async () => {
    renderForm("edit", savedCard({ footer_text: null }), PAID);
    await goTo("Subscriber");
    await type("footer_text", "");
    expect(await sentUpdate()).toHaveProperty("footer_text", "");
  });

  it("emptied over the card's own text", async () => {
    renderForm("edit", savedCard({ footer_text: "kesh.example" }), PAID);
    await goTo("Subscriber");
    await type("footer_text", "   ");
    expect(await sentUpdate()).toHaveProperty("footer_text", "");
  });
});

describe("a new card and a remix always send the footer mark", () => {
  it("a remix: the remixer's default, whatever the parent stores", async () => {
    renderForm("remix", savedCard({ footer_text: "parent.example" }), PAID);
    await type("title", "My Own Name");
    expect((await sentCreate()).footer_text).toBe("tester.art");
  });

  it("a remix by a free account: \"\" (the action ignores it)", async () => {
    renderForm("remix", savedCard({ footer_text: "parent.example" }), { isPaid: false });
    await type("title", "My Own Name");
    expect((await sentCreate()).footer_text).toBe("");
  });
});

// A remix opens a NEW card on the parent's rows: the create flow with a
// hidden textarea that holds a copy of them.
describe("a new planeswalker whose rows were all removed", () => {
  const walker = (over: Record<string, unknown> = {}) =>
    savedCard({
      card_type: "planeswalker",
      subtypes: ["Kesh"],
      power: null,
      toughness: null,
      loyalty: "4",
      rules_text: "+1: Draw a card.\n-2: Deal 3 damage to any target.",
      face_content: {
        v: 1,
        loyalty: {
          abilities: [
            { cost: "+1", text: "Draw a card." },
            { cost: "-2", text: "Deal 3 damage to any target." },
          ],
        },
      },
      frame_style: { finish: "regular", template: "m15pw" },
      ...over,
    });

  it("saves no rules text and no rows — not the hidden copy of them", async () => {
    renderForm("remix", walker());
    await goTo("Text & stats");
    await typeRich("loyalty_abilities.0.text", "");
    await typeRich("loyalty_abilities.1.text", "");
    const payload = await sentCreate();
    expect(payload.rules_text).toBeUndefined();
    expect(payload.face_content).toBeNull();
    expect(payload.loyalty).toBe("4");
  });

  it("one row left: that row is the text", async () => {
    renderForm("remix", walker());
    await goTo("Text & stats");
    await typeRich("loyalty_abilities.0.text", "");
    const payload = await sentCreate();
    expect(payload.rules_text).toBe("-2: Deal 3 damage to any target.");
    expect(payload.face_content).toEqual({
      v: 1,
      loyalty: { abilities: [{ cost: "-2", text: "Deal 3 damage to any target." }] },
    });
  });

  it("untouched rows travel as the parent's", async () => {
    renderForm("remix", walker());
    await type("title", "My Own Name");
    const payload = await sentCreate();
    expect(payload.rules_text).toBe("+1: Draw a card.\n-2: Deal 3 damage to any target.");
  });
});

describe("a new saga whose chapters were all removed", () => {
  const saga = (over: Record<string, unknown> = {}) =>
    savedCard({
      card_type: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      power: null,
      toughness: null,
      flavor_text: null,
      frame_style: { finish: "regular", template: "saga" },
      ...over,
    });
  const WITH_INTRO = {
    rules_text: "(Reminder.)\nI — Draw a card.",
    face_content: { v: 1, saga: { intro: "(Reminder.)", chapters: [{ numerals: [1], text: "Draw a card." }] } },
  };

  it("no intro: no rules text", async () => {
    renderForm(
      "remix",
      saga({
        rules_text: "I — Draw a card.",
        face_content: { v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "Draw a card." }] } },
      }),
    );
    await goTo("Text & stats");
    await typeRich("saga_chapters.0.text", "");
    const payload = await sentCreate();
    expect(payload.rules_text).toBeUndefined();
    expect(payload.face_content).toBeNull();
  });

  it("the intro kept: the intro is the text — not the hidden chapters", async () => {
    renderForm("remix", saga(WITH_INTRO));
    await goTo("Text & stats");
    await typeRich("saga_chapters.0.text", "");
    const payload = await sentCreate();
    expect(payload.rules_text).toBe("(Reminder.)");
    expect(payload.face_content).toBeNull();
  });

  it("only an intro, typed on a saga that had no text: the intro is saved", async () => {
    renderForm("remix", saga({ rules_text: null, face_content: null }));
    await goTo("Text & stats");
    await typeRich("saga_intro", "(Reminder.)");
    expect((await sentCreate()).rules_text).toBe("(Reminder.)");
  });

  it("a chapter the editor can't number is not an emptied editor: the text stays", async () => {
    renderForm("remix", saga({ rules_text: "XI — Draw a card.", face_content: null }));
    await type("title", "My Own Name");
    expect((await sentCreate()).rules_text).toBe("XI — Draw a card.");
  });

  it("an untouched saga travels as the parent's", async () => {
    renderForm("remix", saga(WITH_INTRO));
    await type("title", "My Own Name");
    const payload = await sentCreate();
    expect(payload.rules_text).toBe("(Reminder.)\nI — Draw a card.");
    expect(payload.face_content).toEqual(WITH_INTRO.face_content);
  });
});

// The dual write: a walker stored as plain text has no face_content; its
// first edit sends the rows the editor read — and the SAME rules text.
describe("a planeswalker stored without face_content, on its first edit", () => {
  const TEXTS = [
    "+1: Draw a card.",
    "Flying\n+1: Draw a card.\n-2: Deal 3 damage to any target.\n-7: You get an emblem.",
    "0: Untap target land.\n+2: Scry 2, then draw a card.\n-X: Deal X damage to each creature.",
    "As long as it's your turn, creatures you control have haste.\n+1: Create a 1/1 Elf.",
    "It’s “quoted” — and dashed.\n+1: Draw {2} cards. {T}'s effect.",
  ];
  it.each(TEXTS)("rules_text is resent byte for byte: %j", async (text) => {
    renderForm(
      "edit",
      savedCard({
        card_type: "planeswalker",
        subtypes: ["Kesh"],
        power: null,
        toughness: null,
        loyalty: "4",
        rules_text: text,
        face_content: null,
        frame_style: { finish: "regular", template: "m15pw" },
      }),
    );
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    // It gains the structured rows (the dual write)…
    const rows = (payload.face_content as { loyalty: { abilities: { cost: string | null; text: string }[] } }).loyalty
      .abilities;
    // …which read back as that same text.
    expect(rows.map((r) => (r.cost ? `${r.cost}: ${r.text}` : r.text)).join("\n")).toBe(text);
  });
});

// The rows serialize canonically ("-2: …", "I, II — …"); a stored text spelled
// another way was rewritten by a save that only retitled the card.
describe("rows the maker did not change keep the stored text, however it is spelled", () => {
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

  it.each([
    // Scryfall's oracle text sets a loyalty cost with U+2212.
    "−2: Deal 2 damage to any target.\n+1: Draw a card.",
    "–3: Draw.",
    "+1 : Scry 1.",
    "+1: Scry 1.\n\n-2: Draw.",
    "-x: Deal X damage.",
    "+1:Draw.",
  ])("a planeswalker: %j", async (text) => {
    renderForm("edit", walker(text));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(text);
    // The rows it gains hold the cost as the schema stores it (ASCII).
    const rows = (payload.face_content as { loyalty: { abilities: { cost: string | null }[] } }).loyalty.abilities;
    for (const row of rows) expect(row.cost ?? "").toMatch(/^[-+0-9X]*$/);
  });

  it("a planeswalker that already has its rows", async () => {
    const text = "−2: Deal 2 damage.";
    renderForm("edit", walker(text, { v: 1, loyalty: { abilities: [{ cost: "-2", text: "Deal 2 damage." }] } }));
    await type("title", "Another Name");
    expect((await sentUpdate()).rules_text).toBe(text);
  });

  it.each(["I,II — Draw a card.\n\nIII — Win.", "(Reminder.)\n\ni — Draw a card."])("a saga: %j", async (text) => {
    renderForm("edit", saga(text));
    await type("title", "Another Name");
    expect((await sentUpdate()).rules_text).toBe(text);
  });

  it("a card stored with its rows alone (rules_text NULL): the NULL is not filled", async () => {
    const rows = { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }] } };
    renderForm("edit", walker(null as unknown as string, rows));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBeNull();
    expect(payload.face_content).toEqual(rows);
  });

  it("…and a row that WAS edited saves the rows as they read now", async () => {
    renderForm("edit", walker("−2: Deal 2 damage.\n+1 : Scry 1."));
    await goTo("Text & stats");
    await typeRich("loyalty_abilities.1.text", "Scry 2.");
    expect((await sentUpdate()).rules_text).toBe("-2: Deal 2 damage.\n+1: Scry 2.");
  });

  it("a remix (a NEW card) saves the canonical text, as before", async () => {
    renderForm("remix", walker("−2: Deal 2 damage."));
    await type("title", "My Own Name");
    expect((await sentCreate()).rules_text).toBe("-2: Deal 2 damage.");
  });
});

// The independent check's probes (2026-10-13): "rows that still read as the
// rows the form opened with keep the stored text" must never swallow a
// change the maker DID make — and must hold for what the card DRAWS, which
// is `face_content` before `rules_text` (lib/cards/face-content.ts).
describe("an edit of a walker's / saga's rows is never read as untouched", () => {
  const walker = (rules_text: string) =>
    savedCard({
      card_type: "planeswalker",
      subtypes: ["Kesh"],
      power: null,
      toughness: null,
      loyalty: "4",
      rules_text,
      face_content: null,
      frame_style: { finish: "regular", template: "m15pw" },
    });
  const saga = (rules_text: string) =>
    savedCard({
      card_type: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      power: null,
      toughness: null,
      flavor_text: null,
      rules_text,
      face_content: null,
      frame_style: { finish: "regular", template: "saga" },
    });
  const W = "−2: Deal 2 damage.\n+1 : Scry 1.";
  const S = "(Reminder.)\n\nI,II — Draw a card.\nIII — Win.";
  const clickLabel = async (label: string) => {
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(label)[0]);
    });
  };
  const clickButton = async (name: RegExp) => {
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name })[0]);
    });
  };
  const openRows = async (card: Card) => {
    renderForm("edit", card);
    await type("title", "Another Name");
    await goTo("Text & stats");
  };

  it("a cost alone (+1 → +2)", async () => {
    await openRows(walker(W));
    await type("loyalty_abilities.1.cost", "+2");
    expect((await sentUpdate()).rules_text).toBe("-2: Deal 2 damage.\n+2: Scry 1.");
  });

  it("a cost emptied (the row turns static)", async () => {
    await openRows(walker(W));
    await type("loyalty_abilities.1.cost", "");
    expect((await sentUpdate()).rules_text).toBe("-2: Deal 2 damage.\nScry 1.");
  });

  it("a row removed, a row added", async () => {
    await openRows(walker(W));
    await clickLabel("Remove ability 1");
    await clickButton(/Add ability/);
    await typeRich("loyalty_abilities.1.text", "New.");
    // (A second row is offered the "-2" cost.)
    expect((await sentUpdate()).rules_text).toBe("+1: Scry 1.\n-2: New.");
  });

  it("two rows' texts swapped", async () => {
    await openRows(walker("+1 : A.\n+1 : B."));
    await typeRich("loyalty_abilities.0.text", "B.");
    await typeRich("loyalty_abilities.1.text", "A.");
    expect((await sentUpdate()).rules_text).toBe("+1: B.\n+1: A.");
  });

  it.each([
    [
      "a text edited and put back",
      async () => {
        await typeRich("loyalty_abilities.1.text", "Scry 9.");
        await typeRich("loyalty_abilities.1.text", "Scry 1.");
      },
    ],
    [
      "a row added and removed again",
      async () => {
        await clickButton(/Add ability/);
        await typeRich("loyalty_abilities.2.text", "New.");
        await clickLabel("Remove ability 3");
      },
    ],
    [
      "an empty row added",
      async () => {
        await clickButton(/Add ability/);
      },
    ],
    // The cost as Scryfall spells it reads as the "-2" the row opened with.
    [
      "the same cost retyped with U+2212",
      async () => {
        await type("loyalty_abilities.0.cost", "−2");
      },
    ],
  ])("…while %s IS untouched: the stored text, byte for byte", async (_label, edit) => {
    await openRows(walker(W));
    await edit();
    expect((await sentUpdate()).rules_text).toBe(W);
  });

  it("a saga's intro alone", async () => {
    await openRows(saga(S));
    await typeRich("saga_intro", "(Other.)");
    expect((await sentUpdate()).rules_text).toBe("(Other.)\nI, II — Draw a card.\nIII — Win.");
  });

  it("a saga's intro emptied", async () => {
    await openRows(saga(S));
    await typeRich("saga_intro", "");
    expect((await sentUpdate()).rules_text).toBe("I, II — Draw a card.\nIII — Win.");
  });

  it("a chapter's number alone", async () => {
    await openRows(saga(S));
    await clickLabel("Chapter II for row 1");
    expect((await sentUpdate()).rules_text).toBe("(Reminder.)\nI — Draw a card.\nIII — Win.");
  });

  it("…a number switched off and on again is untouched", async () => {
    await openRows(saga(S));
    await clickLabel("Chapter II for row 1");
    await clickLabel("Chapter II for row 1");
    expect((await sentUpdate()).rules_text).toBe(S);
  });

  // A marker the editor cannot number ("XI") opens as a row with a text and
  // no chapter. It never saves as a chapter — but it is a row.
  const XI = "I — One.\nXI — Eleven.";
  it("a saga with a chapter the editor can't number, untouched: the text AND the plain-text storage stay", async () => {
    renderForm("edit", saga(XI));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe(XI);
    // No dual write here: `face_content` with chapter I alone would be what
    // the card draws, and chapter XI would leave it on a retitle.
    expect(payload.face_content).toBeNull();
  });

  it("…that row REMOVED is an edit: the text follows the rows", async () => {
    await openRows(saga(XI));
    await clickLabel("Remove chapter row 2");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe("I — One.");
    expect(payload.face_content).toEqual({ v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "One." }] } });
  });

  it("…that row given a number is saved as its chapter", async () => {
    await openRows(saga(XI));
    await clickLabel("Chapter II for row 2");
    expect((await sentUpdate()).rules_text).toBe("I — One.\nII — Eleven.");
  });
});

describe("the footer mark across two saves of one editing session", () => {
  // The refreshed card arrives after the save; until then the form still
  // holds the card as it opened.
  it("typed and saved, then put back to what it opened with and saved again: sent again", async () => {
    renderForm("edit", savedCard({ footer_text: null }), PAID);
    await type("title", "Another Name");
    await goTo("Subscriber");
    await type("footer_text", "kesh.example");
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    expect(actions.updateCardAction.mock.calls[0][1]).toHaveProperty("footer_text", "kesh.example");
    await type("footer_text", "tester.art");
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(2));
    expect(actions.updateCardAction.mock.calls[1][1]).toHaveProperty("footer_text", "tester.art");
  });

  it("…and a second save that leaves it alone does not resend it", async () => {
    renderForm("edit", savedCard({ footer_text: null }), PAID);
    await goTo("Subscriber");
    await type("footer_text", "kesh.example");
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(1));
    await goTo("Text & stats");
    await type("flavor_text", "Another line.");
    await save();
    await waitFor(() => expect(actions.updateCardAction).toHaveBeenCalledTimes(2));
    expect(actions.updateCardAction.mock.calls[1][1]).not.toHaveProperty("footer_text");
  });
});
