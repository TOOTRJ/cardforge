import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClient } from "@supabase/ssr";

// ---------------------------------------------------------------------------
// A session refresh that can never sign its user out
// (lib/tools/re-art/session-refresh.ts) — with the REAL sign-in library and
// a stand-in for the sign-in service.
//
// The hand-over of a Re-art run refreshes the maker's session early. The
// library removes a session whose refresh is refused (a 429, a 500, a bad
// token); on the request's own client that would clear the browser's
// cookies — a maker who pressed Paint signed out with most of an hour left.
// So the refresh runs on a COPY of the cookies, and only a refresh that
// succeeded is written to the real ones.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ url: "https://abcdefgh.supabase.co", anonKey: "anon" }) }));

import { refreshSessionOnACopy } from "@/lib/tools/re-art/session-refresh";

const USER = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "maker@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** An access token with `seconds` left (shaped as the service's are). */
const jwt = (seconds: number, tag: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ exp: Math.floor(Date.now() / 1000) + seconds, sub: USER.id, role: "authenticated", tag })}.${Buffer.from("sig").toString("base64url")}`;
const OLD = jwt(20 * 60, "old");
const NEW = jwt(60 * 60, "new");

type Cookie = { name: string; value: string };
const fetchMock = vi.fn();
/** What the sign-in service answers a refresh. */
let refreshAnswer: () => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The browser's cookies for a signed-in maker, written by the library itself. */
async function signedInCookies(): Promise<Cookie[]> {
  const jar = new Map<string, string>();
  const client = createServerClient("https://abcdefgh.supabase.co", "anon", {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.setSession({ access_token: OLD, refresh_token: "the-real-refresh-token" });
  if (error) throw error;
  return [...jar].map(([name, value]) => ({ name, value }));
}
/** A request's cookie store, as a server action has it. */
function storeOf(cookies: Cookie[]) {
  const held = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  const set = vi.fn((name: string, value: string) => {
    if (value) held.set(name, value);
    else held.delete(name);
  });
  return { getAll: () => [...held].map(([name, value]) => ({ name, value })), set, held };
}
/** The session a set of cookies holds. */
function sessionIn(held: Map<string, string>): { access_token?: string; refresh_token?: string } | null {
  const raw = [...held]
    .filter(([name]) => /^sb-abcdefgh-auth-token(\.\d+)?$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
    .join("");
  if (!raw) return null;
  return JSON.parse(raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw));
}
const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/v1/token"));

beforeEach(() => {
  fetchMock.mockReset();
  refreshAnswer = () => json(200, { access_token: NEW, refresh_token: "the-rotated-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/auth/v1/user")) return json(200, USER);
    if (url.includes("/auth/v1/token")) return refreshAnswer();
    return json(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("refreshSessionOnACopy", () => {
  it("a refresh that succeeds hands back the new token and writes the new session where the browser reads it", async () => {
    const store = storeOf(await signedInCookies());
    expect(sessionIn(store.held)).toMatchObject({ access_token: OLD, refresh_token: "the-real-refresh-token" });
    expect(await refreshSessionOnACopy(store)).toBe(NEW);
    // The browser's own refresh token is what was spent…
    expect(refreshCalls()).toHaveLength(1);
    expect(JSON.parse(String(refreshCalls()[0][1].body))).toEqual({ refresh_token: "the-real-refresh-token" });
    // …and the rotated session is the one its cookies hold now.
    expect(store.set).toHaveBeenCalled();
    expect(sessionIn(store.held)).toMatchObject({ access_token: NEW, refresh_token: "the-rotated-refresh-token" });
  });

  it.each([
    ["too many requests", 429, { code: 429, error_code: "over_request_rate_limit", msg: "Too many requests" }],
    ["a server error", 500, { code: 500, error_code: "unexpected_failure", msg: "Internal error" }],
    ["a refused token", 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }],
  ])("a refresh the service refuses (%s) changes NOTHING: the maker is not signed out", async (_name, status, body) => {
    const cookies = await signedInCookies();
    const store = storeOf(cookies);
    refreshAnswer = () => json(status, body);
    expect(await refreshSessionOnACopy(store)).toBeNull();
    expect(refreshCalls().length).toBeGreaterThanOrEqual(1);
    // Not one cookie written or removed: the session is exactly as it was.
    expect(store.set).not.toHaveBeenCalled();
    expect(store.getAll()).toEqual(cookies);
    expect(sessionIn(store.held)).toMatchObject({ access_token: OLD, refresh_token: "the-real-refresh-token" });
  });

  it("…which is NOT what the library does on the request's own client: there the same refusal removes the session", async () => {
    // The reason this module exists, shown with the library itself.
    const cookies = await signedInCookies();
    const jar = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
    const direct = createServerClient("https://abcdefgh.supabase.co", "anon", {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const { name, value } of list) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      },
    });
    refreshAnswer = () => json(429, { code: 429, error_code: "over_request_rate_limit", msg: "Too many requests" });
    const { error } = await direct.auth.refreshSession();
    expect(error).toBeTruthy();
    expect(sessionIn(jar)).toBeNull();
  });

  it("the service can't be reached: nothing changes either", async () => {
    const cookies = await signedInCookies();
    const store = storeOf(cookies);
    refreshAnswer = () => {
      throw new TypeError("fetch failed");
    };
    expect(await refreshSessionOnACopy(store)).toBeNull();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.getAll()).toEqual(cookies);
  }, 30_000);

  it("no session in the cookies: nothing is asked of the service, nothing is written", async () => {
    const store = storeOf([{ name: "cardforge-theme", value: "dark" }]);
    expect(await refreshSessionOnACopy(store)).toBeNull();
    expect(refreshCalls()).toEqual([]);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("a new session that can't be written where the browser reads it is not used (the old token goes on)", async () => {
    const cookies = await signedInCookies();
    const store = { getAll: () => cookies, set: vi.fn(() => {
      throw new Error("cookies can only be modified in a Server Action");
    }) };
    expect(await refreshSessionOnACopy(store)).toBeNull();
  });
});
