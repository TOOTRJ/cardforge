import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// proxy.ts — the request-time gate in front of every page:
//   * /preview and the internal /create-guest path 308 to /create;
//   * /create is served to session-cookie holders, rewritten to the static
//     guest creator for everyone else (the cookie is a HINT — the page
//     re-validates);
//   * /gallery and /decks with a REAL filter param 308 to their visible
//     dynamic /browse sibling (query intact); junk params keep the
//     CDN-cached page. A rewrite would be invisible to the client router,
//     which reuses the cached static tree for same-path query changes;
//   * a signed-in /pricing is rewritten to the dynamic pricing-member twin
//     (server-rendered buttons, no anonymous flash); the internal path 308s;
//   * a redirect from updateSession is never clobbered.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  session: null as null | (() => Response),
  updateSession: vi.fn(),
}));
vi.mock("@/lib/supabase/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: s.updateSession.mockImplementation(async (request: NextRequest) =>
      s.session ? s.session() : NextResponse.next({ request }),
    ),
  };
});

import { proxy } from "@/proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);
const rewriteOf = (response: Response) => response.headers.get("x-middleware-rewrite");
const locationOf = (response: Response) => response.headers.get("location");

beforeEach(() => {
  s.session = null;
  s.updateSession.mockClear();
});

describe("proxy", () => {
  it("308s the legacy /preview URL and the internal guest path to /create", async () => {
    for (const path of ["/preview", "/create-guest"]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("http://localhost:3000/create");
    }
    expect(s.updateSession).not.toHaveBeenCalled();
  });

  it("serves the guest creator to visitors without a Supabase session cookie", async () => {
    const response = await proxy(request("/create"));
    expect(rewriteOf(response)).toBe("http://localhost:3000/create-guest");
    expect(s.updateSession).not.toHaveBeenCalled();
  });

  it("lets session-cookie holders through to the signed-in creator (via updateSession)", async () => {
    const response = await proxy(request("/create", "sb-abcdefgh-auth-token.0=eyJ; other=1"));
    expect(rewriteOf(response)).toBeNull();
    expect(s.updateSession).toHaveBeenCalledTimes(1);
  });

  it("308s landing requests carrying a real filter param to the visible browse sibling, query intact", async () => {
    const gallery = await proxy(request("/gallery?type=creature&page=2"));
    expect(gallery.status).toBe(308);
    expect(locationOf(gallery)).toBe("http://localhost:3000/gallery/browse?type=creature&page=2");
    // A redirect, never a rewrite: the client router would reuse the cached
    // static /gallery tree for a rewritten same-path query change.
    expect(rewriteOf(gallery)).toBeNull();

    const decks = await proxy(request("/decks?format=commander"));
    expect(decks.status).toBe(308);
    expect(locationOf(decks)).toBe("http://localhost:3000/decks/browse?format=commander");
  });

  it("leaves junk params, the bare landings, the browse routes and other paths alone", async () => {
    for (const path of [
      "/gallery?utm_source=x&fbclid=y",
      "/gallery",
      "/gallery/browse?type=creature",
      "/decks/browse?format=commander",
      "/challenges?q=x",
    ]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(200);
      expect(locationOf(response), path).toBeNull();
      expect(rewriteOf(response), path).toBeNull();
    }
    // Sets were removed 2026-09-22 — the path itself 308s to /decks.
    expect(locationOf(await proxy(request("/sets?q=alpha")))).toBe("http://localhost:3000/decks");
  });

  it("rewrites a signed-in /pricing to the member twin (query intact) and leaves anonymous /pricing static", async () => {
    const member = await proxy(request("/pricing?billing=cancel", "sb-abcdefgh-auth-token.0=eyJ; other=1"));
    expect(rewriteOf(member)).toBe("http://localhost:3000/pricing-member?billing=cancel");
    expect(member.status).toBe(200);

    const anonymous = await proxy(request("/pricing"));
    expect(rewriteOf(anonymous)).toBeNull();
    expect(locationOf(anonymous)).toBeNull();
  });

  it("308s the internal /pricing-member path back to /pricing", async () => {
    const response = await proxy(request("/pricing-member", "sb-abcdefgh-auth-token.0=eyJ"));
    expect(response.status).toBe(308);
    expect(locationOf(response)).toBe("http://localhost:3000/pricing");
    expect(s.updateSession).not.toHaveBeenCalled();
  });

  it("never clobbers a redirect that updateSession issued", async () => {
    s.session = () => NextResponse.redirect("http://localhost:3000/login?redirectTo=%2Fgallery", 307);
    const response = await proxy(request("/gallery?type=creature"));
    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe("http://localhost:3000/login?redirectTo=%2Fgallery");
    expect(rewriteOf(response)).toBeNull();
  });
});
