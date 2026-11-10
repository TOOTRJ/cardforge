// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import type { CommanderDraft } from "@/lib/tools/collection/builder";
import type { CommanderSupport } from "@/lib/tools/collection/commander-scores";
import { lastAiDraftKey } from "@/lib/tools/collection/last-ai-draft";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's build view (components/tools/collection/
// collection-build.tsx, owner 2026-11-09): the build bar sits ABOVE the
// commander list; its buttons stay reachable and say why while no commander
// is picked; the list folds to two rows ("Show all"), sorts by the free
// scores, and folds away behind "Change commander" once a draft is on
// screen (the focus goes to the draft); a paid AI draft is kept in this
// browser for a week and offered back, never shown by itself.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({ draft: vi.fn(), save: vi.fn() }));

vi.mock("@/lib/tools/collection/actions", () => ({
  draftCollectionDeckAction: m.draft,
  saveCollectionDeckAction: m.save,
}));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CollectionBuild, foldedTileClass } from "@/components/tools/collection/collection-build";

function commander(i: number, over: Partial<CollectionCard> = {}): CollectionCard {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return {
    id,
    scryfallId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Commander ${String(i).padStart(2, "0")}`,
    typeLine: "Legendary Creature — Goblin",
    manaCost: "{2}{R}",
    manaValue: 3,
    colorIdentity: ["R"],
    oracleText: null,
    rarity: "rare",
    setCode: "tst",
    setName: "Test",
    collectorNumber: String(i),
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal: true,
    canBeCommander: true,
    ...over,
  };
}

const COMMANDERS = Array.from({ length: 20 }, (_, i) => commander(i + 1));

function support(score: number): CommanderSupport {
  return {
    inColours: score,
    fit: Math.round(score / 2),
    roles: { ramp: 1, draw: 1, removal: 1, wipe: 0 },
    lands: 2,
    score,
    // The least supported commanders hold the most token cards.
    deckTypes: { tokens: 21 - score },
    tribes: score === 20 ? [{ tribe: "goblin", count: 14 }] : [],
  };
}

function draftFor(card: CollectionCard): CommanderDraft {
  return {
    commander: {
      cardId: card.id,
      scryfallId: card.scryfallId,
      name: card.name,
      role: "core",
      manaValue: 3,
      typeLine: card.typeLine,
      manaCost: card.manaCost,
      imageUrl: null,
    },
    picks: [],
    basics: [],
    total: 1,
    short: 99,
    counts: { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0, core: 0 },
    curve: [0, 0, 0, 0, 0, 0, 0, 0],
    poolSize: 0,
    warnings: [],
    strategy: null,
  };
}

let scoresBody: unknown;
const fetchMock = vi.fn();

// Node's own (flag-less, broken) localStorage shadows happy-dom's: a plain
// in-memory one stands in.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  // Commander 20 is the best supported, Commander 01 the least.
  scoresBody = { ok: true, scores: Object.fromEntries(COMMANDERS.map((c, i) => [c.id, support(i + 1)])) };
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("commander-scores")) return { json: async () => scoresBody };
    return { json: async () => ({ ok: true, draft: draftFor(COMMANDERS[0]), credits: 4 }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBuild(props: Partial<Parameters<typeof CollectionBuild>[0]> = {}) {
  return render(
    <CollectionBuild
      commanders={COMMANDERS}
      initialCommanderId={null}
      credits={5}
      aiAvailable
      collectionSize={71}
      viewerId="viewer-1"
      {...props}
    />,
  );
}

const draftButton = () => screen.getByRole("button", { name: /Draft a deck|Draft again|Drafting/ });
const aiButton = () => screen.getByRole("button", { name: /Build with AI/ });
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[name="commander"]')];
const descriptionOf = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the build bar", () => {
  it("sits above the commander list", async () => {
    renderBuild();
    await settle();
    const firstRadio = radios()[0];
    expect(draftButton().compareDocumentPosition(firstRadio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aiButton().compareDocumentPosition(firstRadio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("without a commander, both buttons stay reachable, say why and do nothing", async () => {
    renderBuild();
    await settle();
    for (const button of [draftButton(), aiButton()]) {
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(descriptionOf(button)).toContain("Pick a commander first.");
      fireEvent.click(button);
    }
    expect(m.draft).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("ai-build"))).toBe(false);
  });

  it("shows the picked commander's numbers from the free scores", async () => {
    renderBuild({ initialCommanderId: COMMANDERS[4].id });
    await settle();
    expect(screen.getByText(/5 of your cards are in its colours · 3 fit its plan/)).toBeTruthy();
    expect(draftButton().getAttribute("aria-disabled")).toBeNull();
  });
});

describe("the commander list", () => {
  it("is sorted best supported first once the scores arrive", async () => {
    renderBuild();
    await settle();
    expect(radios()[0].value).toBe(COMMANDERS[19].id);
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "name" } });
    expect(radios()[0].value).toBe(COMMANDERS[0].id);
  });

  it("falls back to names, and says so, when the scores can't be read", async () => {
    scoresBody = { ok: false };
    renderBuild();
    await settle();
    expect(radios()[0].value).toBe(COMMANDERS[0].id);
    expect(screen.getByText(/couldn't be ranked right now/)).toBeTruthy();
  });

  it("folds to two rows at every width and unfolds with Show all", async () => {
    renderBuild();
    await settle();
    const labels = radios().map((r) => r.closest("label") as HTMLLabelElement);
    expect(labels[5].className).not.toMatch(/\bhidden\b/);
    expect(labels[6].className).toMatch(/\bhidden\b/);
    expect(labels[19].className).toMatch(/(^|\s)hidden(\s|$)/);
    const showAll = screen.getByRole("button", { name: "Show all 20 commanders" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(showAll);
    expect(radios().every((r) => !(r.closest("label") as HTMLElement).className.match(/(^|\s)hidden(\s|$)/))).toBe(true);
    expect(screen.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("a search or a colour shows every match, unfolded", async () => {
    renderBuild();
    await settle();
    fireEvent.change(screen.getByLabelText("Find a commander"), { target: { value: "Commander 1" } });
    // Commander 10–19.
    expect(radios()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    expect(radios().every((r) => !(r.closest("label") as HTMLElement).className.match(/(^|\s)hidden(\s|$)/))).toBe(true);
  });

  it("the picked commander is never folded away, and stays where the list puts it", async () => {
    // Commander 01 sorts last (least supported): picked through the address.
    renderBuild({ initialCommanderId: COMMANDERS[0].id });
    await settle();
    const picked = radios().find((r) => r.value === COMMANDERS[0].id) as HTMLInputElement;
    expect(radios().indexOf(picked)).toBe(19);
    expect(picked.checked).toBe(true);
    expect((picked.closest("label") as HTMLElement).className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("a pick is ignored while a draft is being made", async () => {
    let finish: (value: unknown) => void = () => {};
    m.draft.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderBuild({ initialCommanderId: COMMANDERS[19].id });
    await settle();
    await act(async () => {
      fireEvent.click(draftButton());
    });
    fireEvent.click(radios().find((r) => r.value === COMMANDERS[18].id) as HTMLInputElement);
    expect((radios().find((r) => r.value === COMMANDERS[19].id) as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      finish({ ok: true, draft: draftFor(COMMANDERS[19]), truncated: false });
    });
  });

  it("foldedTileClass gives two rows of each grid width", () => {
    expect(foldedTileClass(5)).toBeUndefined();
    expect(foldedTileClass(6)).toBe("hidden @xl:flex");
    expect(foldedTileClass(8)).toBe("hidden @3xl:flex");
    expect(foldedTileClass(12)).toBe("hidden @5xl:flex");
    expect(foldedTileClass(16)).toBe("hidden");
  });
});

describe("after a draft", () => {
  it("the list folds behind Change commander and the focus goes to the draft", async () => {
    m.draft.mockResolvedValue({ ok: true, draft: draftFor(COMMANDERS[0]), truncated: false });
    renderBuild({ initialCommanderId: COMMANDERS[0].id });
    await settle();
    await act(async () => {
      fireEvent.click(draftButton());
    });
    await settle();
    const heading = screen.getByRole("heading", { name: "Your draft" });
    expect(document.activeElement).toBe(heading);
    expect(radios()).toHaveLength(0);
    const change = screen.getByRole("button", { name: "Change commander" });
    expect(change.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(change);
    });
    expect(radios().length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /Your commanders/ }));
  });
});

describe("the AI draft this browser keeps", () => {
  it("is written when an AI build lands", async () => {
    renderBuild({ initialCommanderId: COMMANDERS[0].id });
    await settle();
    await act(async () => {
      fireEvent.click(aiButton());
    });
    await settle();
    const raw = window.localStorage.getItem(lastAiDraftKey("viewer-1"));
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).commanderId).toBe(COMMANDERS[0].id);
  });

  it("is offered back — Show it opens it, Dismiss forgets it", async () => {
    const value = {
      savedAt: new Date().toISOString(),
      commanderId: COMMANDERS[2].id,
      collectionSize: 71,
      truncated: false,
      draft: { ...draftFor(COMMANDERS[2]), strategy: "Kept strategy." },
    };
    window.localStorage.setItem(lastAiDraftKey("viewer-1"), JSON.stringify(value));
    renderBuild();
    await settle();
    // Never shown by itself.
    expect(screen.queryByRole("heading", { name: "Your draft" })).toBeNull();
    const notice = screen.getByText(/You have an unsaved AI build for/).closest("div") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(notice.parentElement as HTMLElement).getByRole("button", { name: "Show it" }));
    });
    expect(screen.getByRole("heading", { name: "Your draft" })).toBeTruthy();
    expect(screen.getByText("Kept strategy.")).toBeTruthy();
    expect(screen.getByText(/Built with AI/)).toBeTruthy();

    cleanup();
    window.localStorage.setItem(lastAiDraftKey("viewer-1"), JSON.stringify(value));
    renderBuild();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(window.localStorage.getItem(lastAiDraftKey("viewer-1"))).toBeNull();
    expect(screen.queryByText(/You have an unsaved AI build for/)).toBeNull();
    // The button went with the notice: the focus goes to the heading.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Pick your commander" }));
  });

  it("shows the AI's reason under each of its picks", async () => {
    const base = draftFor(COMMANDERS[3]);
    const value = {
      savedAt: new Date().toISOString(),
      commanderId: COMMANDERS[3].id,
      collectionSize: 71,
      truncated: false,
      draft: {
        ...base,
        picks: [
          {
            cardId: "p1",
            scryfallId: "s1",
            name: "Goblin Matron",
            role: "core",
            manaValue: 3,
            typeLine: "Creature — Goblin",
            manaCost: "{2}{R}",
            imageUrl: null,
            fromAi: true,
            aiWhy: "Finds the Goblin you need.",
          },
        ],
      },
    };
    window.localStorage.setItem(lastAiDraftKey("viewer-1"), JSON.stringify(value));
    renderBuild();
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    expect(screen.getByText("Finds the Goblin you need.")).toBeTruthy();
    expect(screen.getByText(/AI's pick/)).toBeTruthy();
  });

  it("restores the pickers from a kept draft's choice, cleaned of what no longer validates", async () => {
    window.localStorage.setItem(
      lastAiDraftKey("viewer-1"),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        commanderId: COMMANDERS[19].id,
        collectionSize: 71,
        truncated: false,
        draft: draftFor(COMMANDERS[19]),
        choice: { deckType: "storm", tribe: "goblin", bracket: 9 },
      }),
    );
    m.save.mockResolvedValue({ ok: true, slug: "d", title: "T", placeholders: 0 });
    renderBuild();
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    expect((screen.getByLabelText("Deck type") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Bracket") as HTMLSelectElement).value).toBe("");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    });
    // A type renamed since or a bracket out of range is never sent; the
    // creature type the draft was built with is.
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ deckType: null, tribe: "goblin", bracket: null }));
  });

  it("keeps a kept draft's creature type for the save even while the scores are still loading", async () => {
    scoresBody = { ok: false };
    window.localStorage.setItem(
      lastAiDraftKey("viewer-1"),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        commanderId: COMMANDERS[3].id,
        collectionSize: 71,
        truncated: false,
        draft: draftFor(COMMANDERS[3]),
        choice: { tribe: "goblin" },
      }),
    );
    m.save.mockResolvedValue({ ok: true, slug: "d", title: "T", placeholders: 0 });
    renderBuild();
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show it" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    });
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ tribe: "goblin" }));
  });

  it("is not offered for a collection that changed", async () => {
    window.localStorage.setItem(
      lastAiDraftKey("viewer-1"),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        commanderId: COMMANDERS[2].id,
        collectionSize: 50,
        truncated: false,
        draft: draftFor(COMMANDERS[2]),
      }),
    );
    renderBuild();
    await settle();
    expect(screen.queryByText(/You have an unsaved AI build for/)).toBeNull();
  });
});

describe("deck type, creature type and bracket", () => {
  const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

  it("a deck type ranks the commanders best for it, and its counts show in the picker", async () => {
    renderBuild({ initialCommanderId: COMMANDERS[19].id });
    await settle();
    // Commander 20 is the best supported overall …
    expect(radios()[0].value).toBe(COMMANDERS[19].id);
    const tokens = [...select("Deck type").options].find((o) => o.value === "tokens") as HTMLOptionElement;
    expect(tokens.textContent).toBe("Tokens — 1 card (wants 20)");
    fireEvent.change(select("Deck type"), { target: { value: "tokens" } });
    // … but Commander 01 holds the most token cards.
    expect(radios()[0].value).toBe(COMMANDERS[0].id);
    expect(select("Sort").selectedOptions[0].textContent).toBe("Best for Tokens");
  });

  it("the AI build says so when the collection can't begin to fill the type", async () => {
    renderBuild({ initialCommanderId: COMMANDERS[19].id });
    await settle();
    fireEvent.change(select("Deck type"), { target: { value: "tokens" } });
    expect(aiButton().getAttribute("aria-disabled")).toBe("true");
    expect(descriptionOf(aiButton())).toMatch(/too few Tokens cards/);
    // The free draft still goes.
    expect(draftButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("Stax and Combo can't be picked below Bracket 3, and a lower bracket sets the type back", async () => {
    renderBuild({ initialCommanderId: COMMANDERS[0].id });
    await settle();
    fireEvent.change(select("Deck type"), { target: { value: "stax" } });
    fireEvent.change(select("Bracket"), { target: { value: "2" } });
    expect(select("Deck type").value).toBe("");
    expect(screen.getByText(/Stax is a deck type for Bracket 3 and up/)).toBeTruthy();
    const stax = [...select("Deck type").options].find((o) => o.value === "stax") as HTMLOptionElement;
    expect(stax.disabled).toBe(true);
    expect(stax.textContent).toMatch(/Bracket 3\+$/);
  });

  it("a commander's creature types are offered, and the draft asks for the choice", async () => {
    m.draft.mockResolvedValue({ ok: true, draft: draftFor(COMMANDERS[19]), truncated: false });
    renderBuild({ initialCommanderId: COMMANDERS[19].id });
    await settle();
    const tribe = select("Creature type");
    expect([...tribe.options].map((o) => o.textContent)).toEqual(["None", "Goblin — 14 creatures (aim for 20+)"]);
    fireEvent.change(tribe, { target: { value: "goblin" } });
    fireEvent.change(select("Bracket"), { target: { value: "3" } });
    await act(async () => {
      fireEvent.click(draftButton());
    });
    expect(m.draft).toHaveBeenCalledWith({ commanderId: COMMANDERS[19].id, deckType: null, tribe: "goblin", bracket: 3 });
  });

  it("saves the deck with the choice it was built with", async () => {
    m.draft.mockResolvedValue({ ok: true, draft: draftFor(COMMANDERS[19]), truncated: false });
    m.save.mockResolvedValue({ ok: true, slug: "d", title: "T", placeholders: 0 });
    renderBuild({ initialCommanderId: COMMANDERS[19].id });
    await settle();
    fireEvent.change(select("Bracket"), { target: { value: "2" } });
    await act(async () => {
      fireEvent.click(draftButton());
    });
    // Moving the picker after the draft doesn't relabel it.
    fireEvent.change(select("Bracket"), { target: { value: "4" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save deck" }));
    });
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ deckType: null, tribe: null, bracket: 2 }));
  });
});

