import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// updateSession (lib/supabase/middleware.ts) on a DEAD session: the cookie
// is still in the browser, getUser() finds no user and clears it through
// setAll. On a protected path the login redirect must carry those clears —
// it used to build a fresh response and drop them, so the stale cookie
// outlived every redirect (and proxy.ts's guest rewrite of /create, which
// copies this response's cookies, passed nothing on).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ user: null as null | { id: string } }));

vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseEnv: () => ({ url: "http://supabase.test", anonKey: "anon" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void;
      };
    },
  ) => ({
    auth: {
      getUser: async () => {
        if (!s.user) {
          // What @supabase/ssr does with a session it can't refresh.
          options.cookies.setAll([
            { name: "sb-abcdefgh-auth-token", value: "", options: { maxAge: 0, path: "/" } },
          ]);
        }
        return { data: { user: s.user } };
      },
    },
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";

const request = (path: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: "sb-abcdefgh-auth-token=stale" },
  });

beforeEach(() => {
  s.user = null;
});

describe("updateSession with a dead session's cookie", () => {
  it("redirects a protected path to /login AND clears the dead cookie on that redirect", async () => {
    const response = await updateSession(request("/create"));
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("redirectTo")).toBe(
      "/create",
    );
    expect(response.cookies.get("sb-abcdefgh-auth-token")?.value).toBe("");
    expect(response.headers.get("set-cookie")).toContain("sb-abcdefgh-auth-token=;");
  });

  it("leaves a live session's protected path alone", async () => {
    s.user = { id: "u1" };
    const response = await updateSession(request("/create"));
    expect(response.headers.get("location")).toBeNull();
  });
});
