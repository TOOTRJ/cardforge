// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Card, GameSystem } from "@/types/card";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// An EMPTIED optional text through the real CardCreatorForm (bug 2026-10-12:
// a flavor text emptied on /card/<slug>/edit came back on reload). The form
// used to send `undefined` for every empty optional text, which the update
// action reads as "leave the column alone". An EDIT now says null for a
// field it holds empty — cost, rules, flavor, the stats its type prints,
// artist, art — and the action clears the column; a NEW card and a remix
// still leave an empty field out (createCardSchema takes no null). Harness:
// creator-anatomy-save.test.tsx.
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
/** The pip editors (rules text, a walker's rows) are contenteditable boxes
 *  named by `data-field`. */
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

describe("an edit that empties a field sends null for it", () => {
  it("the flavor text", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await type("flavor_text", "");
    const payload = await sentUpdate();
    expect(payload.flavor_text).toBeNull();
    // What was left alone travels as it is stored.
    expect(payload.rules_text).toBe("Haste");
    expect(payload.power).toBe("3");
    expect(payload.cost).toBe("{2}{R}{R}");
  });

  it("a field of spaces is an emptied field", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await type("flavor_text", "   ");
    expect((await sentUpdate()).flavor_text).toBeNull();
  });

  it("rules text, power, toughness and the artist credit", async () => {
    renderForm("edit", savedCard());
    await type("artist_credit", "");
    await goTo("Text & stats");
    await typeRich("rules_text", "");
    await type("power", "");
    await type("toughness", "");
    const payload = await sentUpdate();
    expect(payload).toMatchObject({ rules_text: null, power: null, toughness: null, artist_credit: null });
    expect(payload.flavor_text).toBe("\"Hold the line.\"");
  });

  it("a stat the card's type does not print is never sent — the stored one stays", async () => {
    renderForm("edit", savedCard());
    await goTo("Text & stats");
    await type("flavor_text", "");
    const payload = await sentUpdate();
    expect(payload.loyalty).toBeUndefined();
    expect(payload.defense).toBeUndefined();
  });

  it("a planeswalker's loyalty, and its rows once every one is emptied", async () => {
    renderForm(
      "edit",
      savedCard({
        card_type: "planeswalker",
        subtypes: ["Kesh"],
        power: null,
        toughness: null,
        loyalty: "4",
        rules_text: "+1: Draw a card.",
        face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }] } },
        frame_style: { finish: "regular", template: "m15pw" },
      }),
    );
    await goTo("Text & stats");
    await type("loyalty", "");
    await typeRich("loyalty_abilities.0.text", "");
    const payload = await sentUpdate();
    expect(payload.loyalty).toBeNull();
    expect(payload.face_content).toBeNull();
    // Not the stored copy of the rows, which would bring them back.
    expect(payload.rules_text).toBeNull();
    expect(payload.power).toBeUndefined();
  });
});

// A saga keeps its text in the intro + chapter rows; the rules textarea is
// hidden and still holds the STORED text. It may be resent only while it is
// what the editor shows.
describe("a saga's rows on an edit", () => {
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

  it("every chapter emptied, no intro: the rules text clears", async () => {
    renderForm(
      "edit",
      saga({
        rules_text: "I — Draw a card.",
        face_content: { v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "Draw a card." }] } },
      }),
    );
    await goTo("Text & stats");
    await typeRich("saga_chapters.0.text", "");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBeNull();
    expect(payload.face_content).toBeNull();
  });

  it("every chapter emptied, the intro kept: the intro is the text — not the stored chapters", async () => {
    renderForm("edit", saga(WITH_INTRO));
    await goTo("Text & stats");
    await typeRich("saga_chapters.0.text", "");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe("(Reminder.)");
    expect(payload.face_content).toBeNull();
  });

  it("an untouched saga travels as stored", async () => {
    renderForm("edit", saga(WITH_INTRO));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe("(Reminder.)\nI — Draw a card.");
    expect(payload.face_content).toEqual(WITH_INTRO.face_content);
  });

  it("a stored text with no chapter is never rewritten by an edit of another field", async () => {
    // The editor shows it as the intro, its lines joined — the stored
    // text keeps its line break.
    renderForm("edit", saga({ rules_text: "Flying\nTrample" }));
    await type("title", "Another Name");
    expect((await sentUpdate()).rules_text).toBe("Flying\nTrample");
  });

  it("…and its intro, once edited, is what is saved", async () => {
    renderForm("edit", saga({ rules_text: "Flying" }));
    await goTo("Text & stats");
    await typeRich("saga_intro", "Flying, haste");
    expect((await sentUpdate()).rules_text).toBe("Flying, haste");
  });

  it("…or cleared, once emptied", async () => {
    renderForm("edit", saga({ rules_text: "Flying" }));
    await goTo("Text & stats");
    await typeRich("saga_intro", "");
    expect((await sentUpdate()).rules_text).toBeNull();
  });

  it("a chapter the editor can't number is not an emptied editor: the stored text stays", async () => {
    // "XI" is past the markers the rows read (I–X): the row holds the text
    // and no number, so it never survives the submit filter.
    renderForm("edit", saga({ rules_text: "XI — Draw a card." }));
    await type("title", "Another Name");
    expect((await sentUpdate()).rules_text).toBe("XI — Draw a card.");
  });
});

describe("a planeswalker's rows on an edit", () => {
  it("a walker stored as plain text (no structured rows) travels as stored", async () => {
    renderForm(
      "edit",
      savedCard({
        card_type: "planeswalker",
        subtypes: ["Kesh"],
        power: null,
        toughness: null,
        loyalty: "4",
        rules_text: "Flying\n+1: Draw a card.",
        face_content: null,
        frame_style: { finish: "regular", template: "m15pw" },
      }),
    );
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.rules_text).toBe("Flying\n+1: Draw a card.");
    expect(payload.loyalty).toBe("4");
  });
});

describe("an edit of ANOTHER field never clears a stored one", () => {
  it("every stored text and stat travels as stored; the stats the type doesn't print are left out", async () => {
    renderForm("edit", savedCard({ loyalty: "5", defense: "6" }));
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload).toMatchObject({
      cost: "{2}{R}{R}",
      rules_text: "Haste",
      flavor_text: "\"Hold the line.\"",
      power: "3",
      toughness: "4",
      artist_credit: "Anya Vale",
      art_url: "https://example.com/art.png",
    });
    // A creature prints neither: a stored loyalty / defense is never sent,
    // so it is never cleared.
    expect(payload).not.toHaveProperty("loyalty", null);
    expect(payload).not.toHaveProperty("defense", null);
    expect(payload.loyalty).toBeUndefined();
    expect(payload.defense).toBeUndefined();
    // The locked structure never leaves the client on an edit.
    for (const key of ["supertype", "subtypes", "card_type", "color_identity", "frame_style"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("a land with a stored P/T it doesn't print: not sent, so not cleared", async () => {
    renderForm(
      "edit",
      savedCard({ card_type: "land", supertype: null, subtypes: [], cost: null, power: "1", toughness: "1" }),
    );
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.power).toBeUndefined();
    expect(payload.toughness).toBeUndefined();
    expect(payload.cost).toBeNull();
  });
});

describe("a new card and a remix leave an empty field out", () => {
  it("a remix with its flavor text emptied", async () => {
    renderForm("remix", savedCard());
    await type("artist_credit", "");
    await goTo("Text & stats");
    await type("flavor_text", "");
    await save();
    await waitFor(() => expect(actions.createCardAction).toHaveBeenCalledTimes(1));
    const payload = actions.createCardAction.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.flavor_text).toBeUndefined();
    expect(payload.artist_credit).toBeUndefined();
    // The stored texts it kept still travel.
    expect(payload.rules_text).toBe("Haste");
    expect(actions.updateCardAction).not.toHaveBeenCalled();
  });
});

// Face tabs, part 2 (TODO 5.14): a split, aftermath, adventure or flip card's
// second part is edited on its own tab. It travels WHOLE in `back_face`, so
// a field emptied there clears by leaving the object — and an edit of the
// first part hands every stored value of the second back, the ones its tab
// never shows included (an adventure spell's flavour, stats and picture).
describe("a two-part card's parts on an edit", () => {
  const STORED_SECOND = {
    title: "Second",
    cost: "{1}{U}",
    card_type: "sorcery",
    subtypes: ["Trap"],
    rules_text: "Draw a card.",
    flavor_text: "Kept.",
    power: "4",
    toughness: "5",
    loyalty: "3",
    defense: "6",
    artist_credit: "Bo Reed",
    art_url: "https://example.com/back.png",
    art_position: { focalX: 0.2, focalY: 0.8, scale: 1.7 },
  };
  const KINDS = [
    ["split", "instant", "Right half"],
    ["aftermath", "sorcery", "Aftermath half"],
    ["adventure", "creature", "Adventure spell"],
    ["flip", "creature", "Flipped side"],
  ] as const;
  const twoPart = (template: string, cardType: string) =>
    savedCard({
      card_type: cardType,
      supertype: null,
      subtypes: [],
      frame_style: { finish: "regular", template },
      back_face: STORED_SECOND,
    });
  const secondTab = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
    });
  };

  for (const [template, cardType, second] of KINDS) {
    it(`${template}: a title-only edit hands the second part back as stored`, async () => {
      renderForm("edit", twoPart(template, cardType));
      await type("title", "Kesh, Renamed");
      const payload = await sentUpdate();
      expect(payload.title).toBe("Kesh, Renamed");
      expect(payload.back_face).toEqual(STORED_SECOND);
      expect(payload.rules_text).toBe("Haste");
      expect(payload.flavor_text).toBe("\"Hold the line.\"");
    });

    it(`${template}: the second part's rules text, emptied on its tab, clears — and nothing else does`, async () => {
      renderForm("edit", twoPart(template, cardType));
      await goTo("Text & stats");
      await secondTab(second);
      await typeRich("back_face.rules_text", "");
      const payload = await sentUpdate();
      const rest: Record<string, unknown> = { ...STORED_SECOND };
      delete rest.rules_text;
      expect(payload.back_face).toEqual(rest);
      expect((payload.back_face as Record<string, unknown>).rules_text).toBeUndefined();
      expect(payload.rules_text).toBe("Haste");
      expect(payload.flavor_text).toBe("\"Hold the line.\"");
    });

    it(`${template}: the first part's flavor text, emptied on its tab, clears; the second part stays`, async () => {
      renderForm("edit", twoPart(template, cardType));
      await goTo("Text & stats");
      await type("flavor_text", "");
      const payload = await sentUpdate();
      expect(payload.flavor_text).toBeNull();
      expect(payload.back_face).toEqual(STORED_SECOND);
    });
  }
});

// TODO 3b.29 (owner 2026-10-13, found by #539's check): a card with a LEGACY
// back — a stored `back_face` on a frame that draws no second face (a saga, a
// plain M15 card) — was rebuilt from the form on every edit, so a title-only
// edit dropped the back's `color_identity` (only a frame that draws a part
// colour sends one), gave it the form's default `art_position`, and turned a
// stored null or "" into an absent key. The row-diff of #524: an untouched
// back the form cannot rebuild as stored is LEFT OUT of the update — the
// action keeps the row's back as it is (an omitted `back_face` is "leave it
// alone"). A back that round-trips (every second part above) still travels.
describe("a legacy back on an edit (TODO 3b.29)", () => {
  const LEGACY_BACK = {
    title: "The Other Side",
    cost: "{1}{B}",
    card_type: "creature",
    supertype: "Legendary",
    subtypes: ["Spirit"],
    rules_text: "Flying",
    color_identity: ["black"],
    power: "2",
    toughness: "2",
  };
  const sagaWithLegacyBack = (back: Record<string, unknown> = LEGACY_BACK) =>
    savedCard({
      card_type: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      power: null,
      toughness: null,
      flavor_text: null,
      rules_text: "I — Draw a card.",
      face_content: { v: 1, saga: { intro: null, chapters: [{ numerals: [1], text: "Draw a card." }] } },
      frame_style: { finish: "regular", template: "saga" },
      back_face: back,
    });

  it("a title-only edit of a saga leaves its legacy back out — the row keeps it", async () => {
    renderForm("edit", sagaWithLegacyBack());
    await type("title", "Another Name");
    const payload = await sentUpdate();
    expect(payload.title).toBe("Another Name");
    // Not null (that would clear it), not a rebuilt object: no key at all.
    expect(payload).not.toHaveProperty("back_face");
    expect(payload.rules_text).toBe("I — Draw a card.");
  });

  it("…and so does a title-only edit of a plain M15 card with one", async () => {
    renderForm("edit", savedCard({ back_face: LEGACY_BACK }));
    await type("title", "Another Name");
    expect(await sentUpdate()).not.toHaveProperty("back_face");
  });

  it("a back stored with null and blank fields is left out too", async () => {
    const sparse = { title: "Back", cost: null, rules_text: "", subtypes: [] };
    renderForm("edit", sagaWithLegacyBack(sparse));
    await type("title", "Another Name");
    expect(await sentUpdate()).not.toHaveProperty("back_face");
  });

  it("a back the form rebuilds as stored still travels (main's payload)", async () => {
    const whole = {
      title: "Back",
      cost: "{1}{B}",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Spirit"],
      rules_text: "Flying",
      flavor_text: "Kept.",
      power: "2",
      toughness: "2",
      loyalty: "3",
      defense: "4",
      artist_credit: "Bo Reed",
      art_url: "https://example.com/back.png",
      art_position: { focalX: 0.2, focalY: 0.8, scale: 1.7 },
    };
    renderForm("edit", sagaWithLegacyBack(whole));
    await type("title", "Another Name");
    expect((await sentUpdate()).back_face).toEqual(whole);
  });

  it("a card with no back still says null (nothing to keep)", async () => {
    renderForm("edit", savedCard());
    await type("title", "Another Name");
    expect((await sentUpdate()).back_face).toBeNull();
  });
});
