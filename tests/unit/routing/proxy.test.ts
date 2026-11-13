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
//   * the guide tag hubs that became /learn categories 308 to them, and
//     /faq to the help centre (/help);
//   * those 308s and the removed /sets, /set/<slug> DROP the query — all but
//     a friend's referral code (owner 2026-11-11): a valid `?ref=<code>`
//     arrives at the new address, alone; every other parameter and a value
//     that is no code are dropped as before;
//   * a signed-in /pricing is rewritten to the dynamic pricing-member twin
//     (server-rendered buttons, no anonymous flash); the internal path 308s;
//   * a signed-in card page (/card/<user>/<slug>) is rewritten to the
//     dynamic card-member twin, never the card editor (/card/<slug>/edit);
//     anonymous card pages stay static; the internal path 308s (CP2a);
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
import { ARTICLE_CATEGORIES } from "@/lib/content/article-categories";

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

  it("serves the guest creator, not /login, when the session cookie is a dead session's", async () => {
    // An expired / revoked session leaves its cookie behind: updateSession
    // finds no user on the protected /create and answers with the login
    // redirect, which a signed-out "Make a card" press used to land on.
    s.session = () => {
      const redirect = NextResponse.redirect("http://localhost:3000/login?redirectTo=%2Fcreate");
      redirect.cookies.set("sb-abcdefgh-auth-token", "", { maxAge: 0 });
      return redirect;
    };
    const response = await proxy(request("/create", "sb-abcdefgh-auth-token=stale"));
    expect(rewriteOf(response)).toBe("http://localhost:3000/create-guest");
    expect(locationOf(response)).toBeNull();
    // The cleared session cookie still reaches the browser.
    expect(response.headers.get("set-cookie")).toContain("sb-abcdefgh-auth-token=;");
  });

  it("keeps updateSession's other redirects on /create (never turns them into the guest page)", async () => {
    s.session = () => NextResponse.redirect("http://localhost:3000/onboarding");
    const response = await proxy(request("/create", "sb-abcdefgh-auth-token=live"));
    expect(locationOf(response)).toBe("http://localhost:3000/onboarding");
    expect(rewriteOf(response)).toBeNull();
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

    const creators = await proxy(request("/creators?sort=liked&page=2"));
    expect(creators.status).toBe(308);
    expect(locationOf(creators)).toBe("http://localhost:3000/creators/browse?sort=liked&page=2");
  });

  it("leaves junk params, the bare landings, the browse routes and other paths alone", async () => {
    for (const path of [
      "/gallery?utm_source=x&fbclid=y",
      "/gallery",
      "/gallery/browse?type=creature",
      "/decks/browse?format=commander",
      "/creators?utm_source=x",
      "/creators/browse?sort=recent",
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

  it("rewrites a signed-in card page to the card-member twin (query intact); anonymous stays static", async () => {
    const member = await proxy(request("/card/dev_pro/archivist-of-lost-hours?face=back", "sb-abcdefgh-auth-token.0=eyJ"));
    expect(rewriteOf(member)).toBe("http://localhost:3000/card-member/dev_pro/archivist-of-lost-hours?face=back");
    expect(member.status).toBe(200);

    const anonymous = await proxy(request("/card/dev_pro/archivist-of-lost-hours"));
    expect(rewriteOf(anonymous)).toBeNull();
    expect(locationOf(anonymous)).toBeNull();
  });

  it("never rewrites the card editor, the legacy slug URL or a deeper path", async () => {
    const cookie = "sb-abcdefgh-auth-token=eyJ";
    for (const path of ["/card/archivist-of-lost-hours/edit", "/card/archivist-of-lost-hours", "/card/dev_pro/archivist/extra"]) {
      expect(rewriteOf(await proxy(request(path, cookie))), path).toBeNull();
    }
  });

  it("keeps a redirect from updateSession on a signed-in card page", async () => {
    s.session = () => NextResponse.redirect("http://localhost:3000/login", 307);
    const response = await proxy(request("/card/dev_pro/archivist-of-lost-hours", "sb-abcdefgh-auth-token=eyJ"));
    expect(rewriteOf(response)).toBeNull();
    expect(locationOf(response)).toBe("http://localhost:3000/login");
  });

  it("308s the internal /card-member path back to the card page", async () => {
    const response = await proxy(request("/card-member/dev_pro/archivist-of-lost-hours?face=back", "sb-abcdefgh-auth-token=eyJ"));
    expect(response.status).toBe(308);
    expect(locationOf(response)).toBe("http://localhost:3000/card/dev_pro/archivist-of-lost-hours?face=back");
    expect(s.updateSession).not.toHaveBeenCalled();
  });

  it("308s each tag hub that became a /learn category to it (every category's tagSlug), query dropped", async () => {
    for (const category of ARTICLE_CATEGORIES) {
      const response = await proxy(request(`/articles/tag/${category.tagSlug}?utm_source=x`));
      expect(response.status, category.tagSlug).toBe(308);
      expect(locationOf(response), category.tagSlug).toBe(`http://localhost:3000/learn/${category.slug}`);
    }
    // The hubs that still stand are served as before.
    const standing = await proxy(request("/articles/tag/oracle-text"));
    expect(locationOf(standing)).toBeNull();
    expect(s.updateSession).toHaveBeenCalledTimes(1);
  });

  it("308s /faq to the help centre, query dropped (the browser carries a #fragment on)", async () => {
    for (const path of ["/faq", "/faq?utm_source=newsletter"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(308);
      expect(locationOf(response), path).toBe("http://localhost:3000/help");
    }
    expect(s.updateSession).not.toHaveBeenCalled();
    // The help centre itself is served as any page.
    for (const path of ["/help", "/help/printing"]) {
      expect(locationOf(await proxy(request(path))), path).toBeNull();
    }
  });

  // Owner 2026-11-11: a friend's link that lands on an address we redirect
  // must still arrive with its code — these three cleared the whole query.
  describe("a friend's referral code survives the query-dropping 308s", () => {
    const CODE = "ab12cd34";
    const HOST = "http://localhost:3000";
    /** Every address whose 308 clears the query, with where it lands. */
    const dropping: Array<[string, string]> = [
      ["/faq", "/help"],
      ["/sets", "/decks"],
      ["/set/alpha", "/decks"],
      ["/set/alpha/extra", "/decks"],
      ["/articles/tag/templating", "/articles/tag/oracle-text"],
      ["/articles/tag/abilities", "/articles/tag/oracle-text"],
      ["/articles/tag/proxies", "/articles/tag/printing"],
      ...ARTICLE_CATEGORIES.map((category): [string, string] => [`/articles/tag/${category.tagSlug}`, `/learn/${category.slug}`]),
    ];

    it("a valid ?ref= arrives at the new address — the code ALONE, every other parameter dropped", async () => {
      for (const [from, to] of dropping) {
        for (const query of [`?ref=${CODE}`, `?utm_source=newsletter&ref=${CODE}&q=alpha&via=copy`, `?q=alpha&page=2&ref=${CODE}`]) {
          const response = await proxy(request(`${from}${query}`));
          expect(response.status, from + query).toBe(308);
          expect(locationOf(response), from + query).toBe(`${HOST}${to}?ref=${CODE}`);
          expect(rewriteOf(response), from + query).toBeNull();
        }
      }
      expect(s.updateSession).not.toHaveBeenCalled();
    });

    it("the code is carried in its own shape: capitals are the same code, lowercased", async () => {
      for (const [from, to] of dropping) {
        expect(locationOf(await proxy(request(`${from}?ref=AB12CD34`))), from).toBe(`${HOST}${to}?ref=${CODE}`);
      }
    });

    it("no code, or a value that is not one: the query is dropped whole, as before", async () => {
      for (const [from, to] of dropping) {
        for (const query of [
          "",
          "?utm_source=newsletter",
          "?q=alpha&page=2",
          "?ref=",
          "?ref=nope",
          "?ref=ab12cd3",
          "?ref=ab12cd345",
          "?ref=zzzzzzzz",
          "?ref=%3Cscript%3E&q=1",
          `?xref=${CODE}`,
          // A value that would smuggle a second parameter is no code.
          `?ref=${CODE}%26admin%3D1`,
        ]) {
          const response = await proxy(request(`${from}${query}`));
          expect(response.status, from + query).toBe(308);
          expect(locationOf(response), from + query).toBe(`${HOST}${to}`);
        }
      }
    });

    it("two codes on the address: the first one is the one carried", async () => {
      expect(locationOf(await proxy(request(`/faq?ref=${CODE}&ref=11111111`)))).toBe(`${HOST}/help?ref=${CODE}`);
    });

    it("the redirects that keep the WHOLE query still do — the code rides with the rest", async () => {
      // /preview → /create, the internal twins, and a landing's filter 308.
      expect(locationOf(await proxy(request(`/preview?ref=${CODE}&step=art`)))).toBe(`${HOST}/create?ref=${CODE}&step=art`);
      expect(locationOf(await proxy(request(`/pricing-member?ref=${CODE}`)))).toBe(`${HOST}/pricing?ref=${CODE}`);
      expect(locationOf(await proxy(request(`/card-member/dev_pro/archivist?face=back&ref=${CODE}`)))).toBe(
        `${HOST}/card/dev_pro/archivist?face=back&ref=${CODE}`,
      );
      expect(locationOf(await proxy(request(`/gallery?type=creature&ref=${CODE}`)))).toBe(`${HOST}/gallery/browse?type=creature&ref=${CODE}`);
    });

    it("a landing with ONLY the code is no redirect at all: the page is served, the address intact", async () => {
      for (const path of [`/?ref=${CODE}`, `/gallery?ref=${CODE}`, `/decks?ref=${CODE}`, `/help?ref=${CODE}`, `/card/dev_pro/archivist?ref=${CODE}`]) {
        const response = await proxy(request(path));
        expect(response.status, path).toBe(200);
        expect(locationOf(response), path).toBeNull();
        expect(rewriteOf(response), path).toBeNull();
      }
      // The guest creator's rewrite keeps it too (the visible address is /create?ref=…).
      expect(rewriteOf(await proxy(request(`/create?ref=${CODE}`)))).toBe(`${HOST}/create-guest?ref=${CODE}`);
    });
  });

  it("never clobbers a redirect that updateSession issued", async () => {
    s.session = () => NextResponse.redirect("http://localhost:3000/login?redirectTo=%2Fgallery", 307);
    const response = await proxy(request("/gallery?type=creature"));
    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe("http://localhost:3000/login?redirectTo=%2Fgallery");
    expect(rewriteOf(response)).toBeNull();
  });
});
