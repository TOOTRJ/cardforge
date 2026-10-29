import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deckShareImageResponse } from "@/lib/og/deck-share-image";

// ---------------------------------------------------------------------------
// The deck share image's cache (TODO DK0.11, rollout of migration 0151): a
// deck's own image is immutable for a year (its URL carries the deck's
// version), but the GENERIC image a slug gets when no deck reads there is
// never stored — it may stand in for a deck that reads a minute later (an
// unlisted deck while the rollout is under way), and an unfurler would keep
// the stand-in for a year.
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

describe("deckShareImageResponse", () => {
  it("a deck's own image: immutable for a year", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = deckShareImageResponse(Buffer.from([0xff, 0xd8]));
    expect(res.headers.get("cache-control")).toBe("public, immutable, no-transform, max-age=31536000");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("the generic stand-in: never stored", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = deckShareImageResponse(Buffer.from([0xff, 0xd8]), { found: false });
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store");
  });

  it("the route's not-found branch asks for the stand-in's headers", () => {
    const route = readFileSync(path.join(process.cwd(), "app/(marketing)/deck/[slug]/opengraph-image.tsx"), "utf8");
    const notFound = route.slice(route.indexOf("if (!result) {"), route.indexOf("const { deck, entries, username } = result;"));
    expect(notFound).toContain("{ found: false }");
    // The deck's own image keeps the default (immutable).
    expect(route.slice(route.indexOf("const { deck, entries, username } = result;"))).not.toContain("found: false");
  });
});
