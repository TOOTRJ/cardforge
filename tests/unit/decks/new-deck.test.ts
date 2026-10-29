// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEW_DECK_DRAFT_TTL_MS,
  clearNewDeckDraft,
  newDeckContextOf,
  readNewDeckDraft,
  saveNewDeckDraft,
  type NewDeckDraft,
} from "@/lib/decks/new-deck";
import { newDeckAuthHref, newDeckPageHref, newDeckReturnPath } from "@/lib/decks/new-deck-paths";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { MAX_DECKLIST_CHARS } from "@/lib/decks/parse-decklist";

// ---------------------------------------------------------------------------
// The New deck dialog's signed-out round trip (TODO DK4.3,
// lib/decks/new-deck.ts + new-deck-paths.ts): the input waits in this tab's
// sessionStorage — never a URL — for a few hours, anything else in the slot
// is dropped, a blocked storage is no draft (never a throw), and the way
// back is /dashboard/decks/new through safeRedirectPath with the format
// only — for a new account by way of onboarding's own `next`.
// ---------------------------------------------------------------------------

const DRAFT: NewDeckDraft = {
  title: "Krenko's Goblin Swarm",
  format: "commander",
  visibility: "private",
  decklist: "1 Krenko, Mob Boss\n29 Mountain",
  cardId: null,
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the draft", () => {
  it("comes back as it was saved, until it is cleared", () => {
    expect(readNewDeckDraft()).toBeNull();
    expect(saveNewDeckDraft(DRAFT)).toBe(true);
    expect(readNewDeckDraft()).toEqual(DRAFT);
    clearNewDeckDraft();
    expect(readNewDeckDraft()).toBeNull();
  });

  it("is dropped once it is older than the TTL", () => {
    const savedAt = 1_000_000;
    saveNewDeckDraft(DRAFT, savedAt);
    expect(readNewDeckDraft(savedAt + NEW_DECK_DRAFT_TTL_MS - 1)).toEqual(DRAFT);
    expect(readNewDeckDraft(savedAt + NEW_DECK_DRAFT_TTL_MS)).toBeNull();
    // …and gone from storage, not only ignored.
    expect(window.sessionStorage.length).toBe(0);
  });

  it("drops what it didn't write: bad JSON, an unknown format or visibility, a missing field", () => {
    const key = "pipglyph:new-deck-draft";
    for (const raw of [
      "{",
      JSON.stringify({ ...DRAFT, format: "two-headed", savedAt: Date.now() }),
      JSON.stringify({ ...DRAFT, visibility: "friends", savedAt: Date.now() }),
      JSON.stringify({ title: "No list", format: "modern", visibility: "public", savedAt: Date.now() }),
      JSON.stringify({ ...DRAFT }),
    ]) {
      window.sessionStorage.setItem(key, raw);
      expect(readNewDeckDraft(), raw).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    }
  });

  it("keeps a decklist only up to the importer's limit", () => {
    saveNewDeckDraft({ ...DRAFT, decklist: "x".repeat(MAX_DECKLIST_CHARS + 50) });
    expect(readNewDeckDraft()?.decklist).toHaveLength(MAX_DECKLIST_CHARS);
  });

  it("a storage that throws is no draft, never an error", () => {
    // Blocked site data: reading window.sessionStorage itself throws.
    const blocked = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(saveNewDeckDraft(DRAFT)).toBe(false);
    expect(readNewDeckDraft()).toBeNull();
    expect(() => clearNewDeckDraft()).not.toThrow();
    blocked.mockRestore();

    // A full quota: every call throws.
    const failing = {
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue(failing as unknown as Storage);
    expect(saveNewDeckDraft(DRAFT)).toBe(false);
    expect(readNewDeckDraft()).toBeNull();
    expect(() => clearNewDeckDraft()).not.toThrow();
  });
});

describe("the way back", () => {
  it("is /dashboard/decks/new with the format only", () => {
    expect(newDeckReturnPath()).toBe("/dashboard/decks/new");
    expect(newDeckReturnPath("pauper")).toBe("/dashboard/decks/new?format=pauper");
    expect(newDeckAuthHref("login")).toBe("/login?redirectTo=%2Fdashboard%2Fdecks%2Fnew");
    expect(newDeckAuthHref("login", "pauper")).toBe("/login?redirectTo=%2Fdashboard%2Fdecks%2Fnew%3Fformat%3Dpauper");
  });

  it("a NEW account goes through onboarding, which ends on the dialog (its own `next`)", () => {
    const href = new URL(newDeckAuthHref("signup", "pauper"), "https://pipglyph.test");
    expect(href.pathname).toBe("/signup");
    const redirectTo = href.searchParams.get("redirectTo")!;
    // What the sign-up action redirects to — a safe same-origin path…
    expect(safeRedirectPath(redirectTo, "/fallback")).toBe(redirectTo);
    const onboarding = new URL(redirectTo, "https://pipglyph.test");
    expect(onboarding.pathname).toBe("/onboarding");
    // …and where onboarding sends the new account when it is done.
    const next = onboarding.searchParams.get("next")!;
    expect(next).toBe("/dashboard/decks/new?format=pauper");
    expect(safeRedirectPath(next, "/fallback")).toBe(next);
    // Never the decklist: only the format travels.
    expect(href.search).not.toMatch(/decklist|Bolt/i);
  });

  it("reads /api/me's answer: signed in with valid card slots, or signed out with none", () => {
    const slots = { used: 12, cap: 50, tier: "free" };
    expect(newDeckContextOf({ user: { id: "u1" }, cardCapacity: slots })).toEqual({ signedIn: true, cardCapacity: slots });
    expect(newDeckContextOf({ user: { id: "u1" }, cardCapacity: null })).toEqual({ signedIn: true, cardCapacity: null });
    expect(newDeckContextOf({ user: { id: "u1" }, cardCapacity: { used: "12" } })).toEqual({ signedIn: true, cardCapacity: null });
    expect(newDeckContextOf({ user: null })).toEqual({ signedIn: false, cardCapacity: null });
    expect(newDeckContextOf(null)).toEqual({ signedIn: false, cardCapacity: null });
  });

  it("an empty new deck opens with ?new=1; one with its list without", () => {
    expect(newDeckPageHref("goblin-swarm", true)).toBe("/deck/goblin-swarm?new=1");
    expect(newDeckPageHref("goblin-swarm", false)).toBe("/deck/goblin-swarm");
  });
});
