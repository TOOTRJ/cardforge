import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// updateSession (lib/supabase/middleware.ts) on a DEAD session: the cookie
// is still in the browser, getUser() finds no user and clears it through
// setAll. On a protected path the login redirect must carry those clears —
// it used to build a fresh response and drop them, so the stale cookie
// outlived every redirect (and proxy.ts's guest rewrite of /create, which
// copies this response's cookies, passed nothing on).
//
// The same redirect and a friend's referral code (owner 2026-11-11): a link
// to a page that needs a sign-in (`/dashboard/…?ref=<code>`) buried the code
// inside `redirectTo`, where nothing reads it, so the sign-up that followed
// was nobody's referral. The login address now carries `ref=<code>` ITSELF
// (the root layout's capture reads it there) — a valid code only, and
// nothing else of the query outside `redirectTo`.
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

describe("the login redirect keeps a friend's referral code", () => {
  const CODE = "ab12cd34";
  /** A visitor with no session cookie at all (the fast path). */
  const anonymous = (path: string) => new NextRequest(`http://localhost:3000${path}`);
  const loginOf = (response: Response) => new URL(response.headers.get("location") ?? "http://none/");
  const paramsOf = (response: Response) => Object.fromEntries(loginOf(response).searchParams.entries());

  it("no session cookie: /login carries the destination AND ref=<code> of its own", async () => {
    const response = await updateSession(anonymous(`/dashboard/referrals?ref=${CODE}`));
    expect(loginOf(response).origin).toBe("http://localhost:3000");
    expect(loginOf(response).pathname).toBe("/login");
    expect(paramsOf(response)).toEqual({ redirectTo: `/dashboard/referrals?ref=${CODE}`, ref: CODE });
  });

  it("a dead session's cookie (the other path to the redirect): the same, and the dead cookie is still cleared on it", async () => {
    const response = await updateSession(request(`/create?step=art&ref=${CODE}`));
    expect(loginOf(response).pathname).toBe("/login");
    expect(paramsOf(response)).toEqual({ redirectTo: `/create?step=art&ref=${CODE}`, ref: CODE });
    expect(response.cookies.get("sb-abcdefgh-auth-token")?.value).toBe("");
  });

  it("every protected address keeps it — a prefix, a deeper path, an editor", async () => {
    for (const path of ["/dashboard", "/settings", "/onboarding", "/feed", "/notifications", "/messages/abc", "/feedback", "/admin/users", "/card/ember-sphinx/edit", "/deck/burn/edit"]) {
      const response = await updateSession(anonymous(`${path}?ref=${CODE}`));
      expect(loginOf(response).pathname, path).toBe("/login");
      expect(paramsOf(response), path).toEqual({ redirectTo: `${path}?ref=${CODE}`, ref: CODE });
    }
  });

  it("the code travels in its own shape (lowercased); the destination is kept as it was typed", async () => {
    const response = await updateSession(anonymous("/dashboard?ref=AB12CD34"));
    expect(paramsOf(response)).toEqual({ redirectTo: "/dashboard?ref=AB12CD34", ref: CODE });
  });

  it("ONLY the code is lifted out: the rest of the query stays inside redirectTo", async () => {
    const response = await updateSession(anonymous(`/dashboard/cards?tab=drafts&utm_source=friend&ref=${CODE}&via=copy`));
    expect(paramsOf(response)).toEqual({ redirectTo: `/dashboard/cards?tab=drafts&utm_source=friend&ref=${CODE}&via=copy`, ref: CODE });
    expect([...loginOf(response).searchParams.keys()]).toEqual(["redirectTo", "ref"]);
  });

  it("no code, or a value that is not one: the redirect is exactly what it was — redirectTo alone", async () => {
    for (const query of ["", "?tab=drafts", "?ref=", "?ref=nope", "?ref=ab12cd3", "?ref=ab12cd345", "?ref=%3Cscript%3E", `?xref=${CODE}`, `?ref=${CODE}%26next%3D%2F%2Fevil.test`]) {
      for (const make of [anonymous, request]) {
        const response = await updateSession(make(`/dashboard${query}`));
        expect(loginOf(response).pathname, query).toBe("/login");
        expect([...loginOf(response).searchParams.keys()], query).toEqual(["redirectTo"]);
        expect(loginOf(response).searchParams.get("redirectTo"), query).toBe(`/dashboard${query}`);
      }
    }
  });

  it("a page that needs no sign-in is not redirected for carrying a code", async () => {
    for (const path of [`/?ref=${CODE}`, `/gallery?ref=${CODE}`, `/card/dev_pro/archivist?ref=${CODE}`, `/signup?ref=${CODE}`, `/login?ref=${CODE}`]) {
      expect((await updateSession(anonymous(path))).headers.get("location"), path).toBeNull();
    }
  });

  it("a live session on a protected address with a code is left alone", async () => {
    s.user = { id: "u1" };
    expect((await updateSession(request(`/dashboard/referrals?ref=${CODE}`))).headers.get("location")).toBeNull();
  });
});
