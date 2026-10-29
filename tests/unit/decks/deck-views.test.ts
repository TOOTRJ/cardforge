import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/decks/views.ts — a deck page view, once per viewer, deck and UTC day
// (TODO DK0.11, migration 0151's record_deck_view, service role only). What
// the app owns: which requests count (never a crawler, an empty user agent, a
// prefetch or the owner) and the viewer it sends — an HMAC under the server's
// secret, never the user id, the address or the agent itself. The dedupe,
// the day's salt and the counter are the database's (proved on the local
// stack, PR body).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  configured: true,
  rpc: vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: true, error: null })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.configured,
  createAdminClient: () => ({ rpc: state.rpc }),
}));

import { deckViewerHash, isCountableView, recordDeckView } from "@/lib/decks/views";

const SECRET = "sb_secret_test_only";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const DECK = "b0000000-0000-4000-a000-000000000001";
const OWNER = "d0000000-0000-4000-a000-000000000002";
const VIEWER = "d0000000-0000-4000-a000-000000000003";

const headers = (init: Record<string, string>) => new Headers(init);

beforeEach(() => {
  state.configured = true;
  state.rpc.mockClear();
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("isCountableView", () => {
  it("a browser's page load counts", () => {
    expect(isCountableView(headers({ "user-agent": CHROME }))).toBe(true);
  });

  it("a crawler, a script, an empty user agent and a prefetch don't", () => {
    expect(isCountableView(headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }))).toBe(false);
    expect(isCountableView(headers({ "user-agent": "curl/8.4.0" }))).toBe(false);
    expect(isCountableView(headers({ "user-agent": "python-requests/2.31.0" }))).toBe(false);
    expect(isCountableView(headers({}))).toBe(false);
    expect(isCountableView(headers({ "user-agent": "   " }))).toBe(false);
    expect(isCountableView(headers({ "user-agent": CHROME, "next-router-prefetch": "1" }))).toBe(false);
    expect(isCountableView(headers({ "user-agent": CHROME, "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(isCountableView(headers({ "user-agent": CHROME, purpose: "prefetch" }))).toBe(false);
  });
});

describe("deckViewerHash", () => {
  const visitor = headers({ "user-agent": CHROME, "x-real-ip": "203.0.113.7" });

  it("is 32 hex digits, never the address, the agent or the user id", () => {
    const anon = deckViewerHash(null, visitor, SECRET)!;
    const user = deckViewerHash(VIEWER, visitor, SECRET)!;
    for (const key of [anon, user]) {
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(key).not.toContain("203");
      expect(key).not.toContain(VIEWER.replace(/-/g, "").slice(0, 8));
    }
  });

  it("a signed-in viewer is their account, wherever they are; a visitor is their network and agent", () => {
    const elsewhere = headers({ "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1", "x-real-ip": "198.51.100.2" });
    expect(deckViewerHash(VIEWER, visitor, SECRET)).toBe(deckViewerHash(VIEWER, elsewhere, SECRET));
    expect(deckViewerHash(null, visitor, SECRET)).not.toBe(deckViewerHash(null, elsewhere, SECRET));
    // Another agent on the same network is another viewer…
    const sameNetwork = headers({ "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1", "x-real-ip": "203.0.113.7" });
    expect(deckViewerHash(null, sameNetwork, SECRET)).not.toBe(deckViewerHash(null, visitor, SECRET));
    // …and a rotating address inside one IPv6 /64 is one.
    const v6a = headers({ "user-agent": CHROME, "x-real-ip": "2001:db8:1:2::1" });
    const v6b = headers({ "user-agent": CHROME, "x-real-ip": "2001:db8:1:2:ffff::9" });
    expect(deckViewerHash(null, v6a, SECRET)).toBe(deckViewerHash(null, v6b, SECRET));
    // Not the account's key, and not another secret's.
    expect(deckViewerHash(null, visitor, SECRET)).not.toBe(deckViewerHash(VIEWER, visitor, SECRET));
    expect(deckViewerHash(null, visitor, "another")).not.toBe(deckViewerHash(null, visitor, SECRET));
  });

  it("reads Vercel's address, else the first forwarded hop; none = no key (never one pooled viewer)", () => {
    const forwarded = headers({ "user-agent": CHROME, "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(deckViewerHash(null, forwarded, SECRET)).toBe(deckViewerHash(null, visitor, SECRET));
    expect(deckViewerHash(null, headers({ "user-agent": CHROME }), SECRET)).toBeNull();
    expect(deckViewerHash(null, headers({ "user-agent": CHROME, "x-real-ip": "not an address" }), SECRET)).toBeNull();
  });
});

describe("recordDeckView", () => {
  const view = (over: Partial<Parameters<typeof recordDeckView>[0]> = {}) =>
    recordDeckView({
      deckId: DECK,
      ownerId: OWNER,
      viewerId: null,
      headers: headers({ "user-agent": CHROME, "x-real-ip": "203.0.113.7" }),
      ...over,
    });

  it("sends the deck, the hashed viewer and the signed-in id (the database skips the owner too)", async () => {
    await view({ viewerId: VIEWER });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = state.rpc.mock.calls[0]!;
    expect(name).toBe("record_deck_view");
    expect(args).toEqual({ p_deck_id: DECK, p_viewer: deckViewerHash(VIEWER, new Headers(), SECRET), p_viewer_id: VIEWER });
    // Nothing raw rides along.
    expect(JSON.stringify(args)).not.toContain("203.0.113.7");
    expect(JSON.stringify(args)).not.toContain("Chrome");
  });

  it("a signed-out visitor sends no user id", async () => {
    await view();
    expect(state.rpc.mock.calls[0]![1]).toMatchObject({ p_viewer_id: undefined });
  });

  it("never for the owner, a crawler, a prefetch, or with no address", async () => {
    await view({ viewerId: OWNER });
    await view({ headers: headers({ "user-agent": "Googlebot/2.1", "x-real-ip": "203.0.113.7" }) });
    await view({ headers: headers({ "user-agent": CHROME, "x-real-ip": "203.0.113.7", "next-router-prefetch": "1" }) });
    await view({ headers: headers({ "user-agent": CHROME }) });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does nothing without the service role or its secret", async () => {
    state.configured = false;
    await view();
    state.configured = true;
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await view();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("is best-effort: a failing call (0151 not reached, a network error) never throws", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "no function" } });
    await expect(view()).resolves.toBeUndefined();
    state.rpc.mockRejectedValueOnce(new Error("offline"));
    await expect(view()).resolves.toBeUndefined();
  });
});
