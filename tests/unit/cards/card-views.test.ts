import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/cards/views.ts — a card page view, once per viewer, card and UTC day
// (TODO CP4, migration 0168's record_card_view, service role only): the deck
// rule (lib/decks/views.ts) for cards. What the app owns: which pings count
// (never a crawler, an empty user agent or a prefetch — the deck's
// isCountableView) and the viewer it sends — an HMAC under the server's
// secret in a context of its own, never the user id, the address or the
// agent — and, on a database 0168 hasn't reached, the old counter so no view
// is lost (the owner still left out). The dedupe, the day's salt, the
// owner rule and the counter are the database's (proved on the local stack
// in a rolled-back transaction, PR body).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  configured: true,
  rpc: vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: true, error: null })),
  publicRpc: vi.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null })),
  owner: "d0000000-0000-4000-a000-000000000002" as string | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.configured,
  createAdminClient: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    rpc: state.publicRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.owner ? { owner_id: state.owner } : null, error: null }) }) }),
    }),
  }),
}));

import { cardViewerHash, recordCardView } from "@/lib/cards/views";
import { deckViewerHash } from "@/lib/decks/views";

const SECRET = "sb_secret_test_only";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CARD = "c0000000-0000-4000-a000-000000000001";
const OWNER = "d0000000-0000-4000-a000-000000000002";
const VIEWER = "d0000000-0000-4000-a000-000000000003";
const PGRST202 = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

const headers = (init: Record<string, string>) => new Headers(init);
const browser = () => headers({ "user-agent": CHROME, "x-real-ip": "203.0.113.7" });

beforeEach(() => {
  state.configured = true;
  state.owner = OWNER;
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: true, error: null });
  state.publicRpc.mockClear();
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("cardViewerHash", () => {
  it("is 32 hex digits, never the address, the agent or the user id", () => {
    for (const key of [cardViewerHash(null, browser(), SECRET)!, cardViewerHash(VIEWER, browser(), SECRET)!]) {
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(key).not.toContain("203");
      expect(key).not.toContain(VIEWER.replace(/-/g, "").slice(0, 8));
    }
  });

  it("a signed-in viewer is their account; a visitor is their network and agent; none = no key", () => {
    const elsewhere = headers({ "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1", "x-real-ip": "198.51.100.2" });
    expect(cardViewerHash(VIEWER, browser(), SECRET)).toBe(cardViewerHash(VIEWER, elsewhere, SECRET));
    expect(cardViewerHash(null, browser(), SECRET)).not.toBe(cardViewerHash(null, elsewhere, SECRET));
    expect(cardViewerHash(null, headers({ "user-agent": CHROME }), SECRET)).toBeNull();
  });

  it("is not the deck view's key for the same viewer (a context of its own)", () => {
    expect(cardViewerHash(VIEWER, browser(), SECRET)).not.toBe(deckViewerHash(VIEWER, browser(), SECRET));
    expect(cardViewerHash(null, browser(), SECRET)).not.toBe(deckViewerHash(null, browser(), SECRET));
  });
});

describe("recordCardView", () => {
  const view = (over: Partial<Parameters<typeof recordCardView>[0]> = {}) =>
    recordCardView({ cardId: CARD, viewerId: null, headers: browser(), ...over });

  it("sends the card, the hashed viewer and the signed-in id (the database skips the owner)", async () => {
    await view({ viewerId: VIEWER });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = state.rpc.mock.calls[0]!;
    expect(name).toBe("record_card_view");
    expect(args).toEqual({ p_card_id: CARD, p_viewer: cardViewerHash(VIEWER, new Headers(), SECRET), p_viewer_id: VIEWER });
    expect(JSON.stringify(args)).not.toContain("203.0.113.7");
    expect(JSON.stringify(args)).not.toContain("Chrome");
  });

  it("a signed-out visitor sends no user id", async () => {
    await view();
    expect(state.rpc.mock.calls[0]![1]).toMatchObject({ p_viewer_id: undefined });
  });

  it("never a crawler, a prefetch, an empty agent, or with no address", async () => {
    await view({ headers: headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "x-real-ip": "203.0.113.7" }) });
    await view({ headers: headers({ "user-agent": "Discordbot/2.0", "x-real-ip": "203.0.113.7" }) });
    await view({ headers: headers({ "user-agent": CHROME, "x-real-ip": "203.0.113.7", "sec-purpose": "prefetch" }) });
    await view({ headers: headers({ "x-real-ip": "203.0.113.7" }) });
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

  it("a database 0168 hasn't reached (PGRST202): the old counter, never for the owner", async () => {
    state.rpc.mockResolvedValue(PGRST202);
    await view();
    expect(state.publicRpc).toHaveBeenCalledTimes(1);
    expect(state.publicRpc.mock.calls[0]).toEqual(["increment_card_view", { p_card_id: CARD }]);
    await view({ viewerId: VIEWER });
    expect(state.publicRpc).toHaveBeenCalledTimes(2);
    await view({ viewerId: OWNER });
    await view({ headers: headers({ "user-agent": "Googlebot/2.1", "x-real-ip": "203.0.113.7" }) });
    expect(state.publicRpc).toHaveBeenCalledTimes(2);
  });

  it("a failure costs the view, never throws", async () => {
    state.rpc.mockRejectedValue(new Error("network"));
    await expect(view()).resolves.toBeUndefined();
  });
});
