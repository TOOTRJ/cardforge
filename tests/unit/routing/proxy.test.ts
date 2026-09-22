import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// proxy.ts — the request-time gate in front of every page:
//   * /preview and the internal /create-guest path 308 to /create;
//   * /create is served to session-cookie holders, rewritten to the static
//     guest creator for everyone else (the cookie is a HINT — the page
//     re-validates);
//   * /gallery and /decks with a REAL filter param are rewritten to
//     their dynamic /browse sibling; junk params keep the CDN-cached page;
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

  it("rewrites browse requests carrying a real filter param to the dynamic sibling, query intact", async () => {
    expect(rewriteOf(await proxy(request("/gallery?type=creature&page=2")))).toBe(
      "http://localhost:3000/gallery/browse?type=creature&page=2",
    );
    expect(rewriteOf(await proxy(request("/decks?format=commander")))).toBe(
      "http://localhost:3000/decks/browse?format=commander",
    );
  });

  it("leaves junk params and other paths on the cached page", async () => {
    expect(rewriteOf(await proxy(request("/gallery?utm_source=x&fbclid=y")))).toBeNull();
    expect(rewriteOf(await proxy(request("/gallery")))).toBeNull();
    expect(rewriteOf(await proxy(request("/challenges?q=x")))).toBeNull();
    // Sets were removed 2026-09-22 — no browse sibling to rewrite to.
    expect(rewriteOf(await proxy(request("/sets?q=alpha")))).toBeNull();
  });

  it("never clobbers a redirect that updateSession issued", async () => {
    s.session = () => NextResponse.redirect("http://localhost:3000/login?redirectTo=%2Fgallery", 307);
    const response = await proxy(request("/gallery?type=creature"));
    expect(response.status).toBe(307);
    expect(rewriteOf(response)).toBeNull();
  });
});
