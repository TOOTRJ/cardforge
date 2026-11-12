import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The legacy `/card/<slug>` redirector (app/(marketing)/card/[username]) and a
// friend's referral code (owner 2026-11-11: "fix the places a friend's
// ?ref=<code> was lost"). An old share link `/card/<slug>?ref=<code>` was
// 308'd to `/card/<user>/<slug>` with NO query, so the friend arrived on the
// card with nothing for the capture to read. The redirect now appends
// referralSearch(searchParams): a valid code, alone — never the rest of the
// old address's query, never a value that is not a code. What resolves and
// what 404s is unchanged.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  configured: true,
  resolved: null as null | { username: string; slug: string },
  resolve: vi.fn(),
}));

class NotFound extends Error {}
class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => s.configured }));
vi.mock("@/lib/cards/queries", () => ({ resolveLegacyCardSlug: s.resolve }));

import LegacyCardSlugPage, { metadata } from "@/app/(marketing)/card/[username]/page";

const CODE = "ab12cd34";
type Search = Record<string, string | string[] | undefined>;
const open = (slug: string, search: Search = {}) =>
  LegacyCardSlugPage({ params: Promise.resolve({ username: slug }), searchParams: Promise.resolve(search) });
/** Where the page redirects to. */
const target = async (slug: string, search: Search = {}) => {
  try {
    await open(slug, search);
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
  throw new Error("the page did not redirect");
};

beforeEach(() => {
  s.configured = true;
  s.resolved = { username: "kesh", slug: "ember-sphinx" };
  s.resolve.mockReset().mockImplementation(async () => s.resolved);
});

describe("the legacy /card/<slug> redirect", () => {
  it("no query: the canonical card address, as before", async () => {
    expect(await target("ember-sphinx")).toBe("/card/kesh/ember-sphinx");
    expect(s.resolve).toHaveBeenCalledWith("ember-sphinx");
  });

  it("a friend's code on the old address goes with it", async () => {
    expect(await target("ember-sphinx", { ref: CODE })).toBe(`/card/kesh/ember-sphinx?ref=${CODE}`);
    // In its own shape, whatever the case it was typed in.
    expect(await target("ember-sphinx", { ref: "AB12CD34" })).toBe(`/card/kesh/ember-sphinx?ref=${CODE}`);
  });

  it("ONLY the code: the share tag, the face and every other parameter of the old address are dropped", async () => {
    expect(await target("ember-sphinx", { via: "copy", ref: CODE, face: "back", utm_source: "reddit" })).toBe(
      `/card/kesh/ember-sphinx?ref=${CODE}`,
    );
    expect(await target("ember-sphinx", { via: "copy", face: "back", utm_source: "reddit" })).toBe("/card/kesh/ember-sphinx");
  });

  it("a repeated ?ref= (an array): the first value, if it is a code", async () => {
    expect(await target("ember-sphinx", { ref: [CODE, "11111111"] })).toBe(`/card/kesh/ember-sphinx?ref=${CODE}`);
    expect(await target("ember-sphinx", { ref: ["nope", CODE] })).toBe("/card/kesh/ember-sphinx");
  });

  it("a value that is not a code never reaches the Location", async () => {
    for (const ref of ["", "nope", "ab12cd3", "ab12cd345", "zzzzzzzz", "<script>", `${CODE}&next=//evil.test`, `${CODE}\r\nSet-Cookie: a=b`, undefined]) {
      expect(await target("ember-sphinx", { ref }), String(ref)).toBe("/card/kesh/ember-sphinx");
    }
  });

  it("a slug that resolves to nothing is still a 404 — with or without a code — and so is an unconfigured deployment", async () => {
    s.resolved = null;
    await expect(open("nope")).rejects.toBeInstanceOf(NotFound);
    await expect(open("nope", { ref: CODE })).rejects.toBeInstanceOf(NotFound);
    s.resolved = { username: "kesh", slug: "ember-sphinx" };
    s.configured = false;
    await expect(open("ember-sphinx", { ref: CODE })).rejects.toBeInstanceOf(NotFound);
    expect(s.resolve).toHaveBeenCalledTimes(2);
  });

  it("the stub itself stays out of the index", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
