import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REART_SCENE_ENDPOINT,
  SCENE_FAILURES_IN_A_ROW,
  requestReartScene,
  sceneFailureStopsBatch,
  scenesCredits,
} from "@/lib/tools/re-art/scene-client";

// ---------------------------------------------------------------------------
// The browser's side of "Write a scene with AI": one request a card, and
// whatever comes back — the route's answer, a proxy's page, no answer at
// all — is ONE shape, never a throw. Only an answer of OURS decides
// anything: the scene is saved on the server before it answers, so a lost
// answer is "we couldn't reach PipGlyph — reload", never "nothing happened".
// ---------------------------------------------------------------------------

const DECK = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("requestReartScene", () => {
  it("posts the deck and the entry — the direction rides along only when one is given, and nothing else", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, words: { text: "A heron in the reeds.", only: false }, previous: null, credits: 4 }));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual({
      ok: true,
      words: { text: "A heron in the reeds.", only: false },
      previous: null,
      credits: 4,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(REART_SCENE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ deckId: DECK, entryId: ENTRY });
    await requestReartScene({ deckId: DECK, entryId: ENTRY, note: "  at dawn " });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ deckId: DECK, entryId: ENTRY, note: "  at dawn " });
    // A direction that says nothing isn't sent.
    await requestReartScene({ deckId: DECK, entryId: ENTRY, note: "   " });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ deckId: DECK, entryId: ENTRY });
  });

  it("carries the caller's signal: a batch whose screen is gone asks for no more — and an aborted request is “couldn't reach”, never a throw", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) => {
      expect(init.signal).toBe(controller.signal);
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY, signal: controller.signal })).toMatchObject({ ok: false, code: "UNREACHABLE" });
  });

  it("hands back the words the card had before, so the dialog can offer the way back", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, words: { text: "A heron.", only: true }, previous: { text: "an old librarian", only: true }, credits: null }));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toMatchObject({ previous: { text: "an old librarian", only: true }, credits: null });
  });

  it("a refusal carries the route's words, its code and when to come back", async () => {
    fetchMock.mockResolvedValue(json({ ok: false, code: "INSUFFICIENT_CREDITS", error: "You're out of credits.", credits: 0 }, 402));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual({ ok: false, code: "INSUFFICIENT_CREDITS", error: "You're out of credits.", credits: 0 });
    fetchMock.mockResolvedValue(json({ ok: false, code: "RATE_LIMITED", error: "Slow down.", retryAfterSeconds: 60 }, 429));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterSeconds: 60 });
    fetchMock.mockResolvedValue(json({ ok: false, code: "CLOSED", error: "Re-art deck isn't open to you." }, 404));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toMatchObject({ ok: false, code: "CLOSED" });
    fetchMock.mockResolvedValue(json({ ok: false, code: "CREDIT_CHECK_FAILED", error: "We couldn't check your credits." }, 503));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toMatchObject({ ok: false, code: "CREDIT_CHECK_FAILED" });
    // A code the browser doesn't act on is words alone.
    fetchMock.mockResolvedValue(json({ ok: false, code: "design_unreadable", error: "The AI's answer couldn't be read." }, 502));
    const result = await requestReartScene({ deckId: DECK, entryId: ENTRY });
    expect(result).toMatchObject({ ok: false, error: "The AI's answer couldn't be read." });
    expect("code" in result).toBe(false);
  });

  it("no answer of ours — the network, a proxy's page, a body that isn't the route's, a success with no words — is “couldn't reach”, and says a written scene is saved", async () => {
    const unreachable = { ok: false, code: "UNREACHABLE", error: "We couldn't reach PipGlyph. If a scene was written it is saved: reload the page to see it." };
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual(unreachable);
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual(unreachable);
    fetchMock.mockResolvedValueOnce(json(["not", "ours"]));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual(unreachable);
    fetchMock.mockResolvedValueOnce(json({ message: "Internal Server Error" }, 500));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual(unreachable);
    fetchMock.mockResolvedValueOnce(json({ ok: true, words: { text: "  " } }));
    expect(await requestReartScene({ deckId: DECK, entryId: ENTRY })).toEqual(unreachable);
  });
});

describe("a batch of scenes", () => {
  it("stops on a failure the next card would meet too; one card's own failure lets the rest go on", () => {
    for (const code of ["INSUFFICIENT_CREDITS", "RATE_LIMITED", "AI_UNAVAILABLE", "CREDIT_CHECK_FAILED", "CLOSED", "UNREACHABLE"] as const) {
      expect(sceneFailureStopsBatch({ ok: false, error: "x", code })).toBe(true);
    }
    // …and a few cards in a row with no scene stop it too (the writer is down).
    expect(SCENE_FAILURES_IN_A_ROW).toBe(3);
    expect(sceneFailureStopsBatch({ ok: false, error: "The AI's answer couldn't be read." })).toBe(false);
    expect(sceneFailureStopsBatch({ ok: false, error: "Emblems keep their art.", code: "NOT_PAINTABLE" })).toBe(false);
  });

  it("costs a credit a card", () => {
    expect(scenesCredits(0)).toBe(0);
    expect(scenesCredits(12)).toBe(12);
  });
});
