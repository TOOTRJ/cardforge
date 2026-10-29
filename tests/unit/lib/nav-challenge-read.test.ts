import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The header's challenge pill (TODO NV1) is drawn twice per render — the
// Community panel and the drawer — from one AppShell node. Its read is
// React-cached (one per render, like lib/updates/queries.ts) over a
// cookie-free unstable_cache (one per 5 minutes, purged by a challenge save),
// so it adds no request a page waits on and keeps static pages static.
const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the header's challenge read", () => {
  it("is React-cached over a tagged, cookie-free unstable_cache", () => {
    const queries = read("lib/challenges/queries.ts");
    expect(queries).toMatch(/export const getNavChallenge = cache\(/);
    expect(queries).toMatch(/const loadNavChallenge = unstable_cache\(/);
    expect(queries).toMatch(/tags: \[CHALLENGE_NAV_TAG\]/);
    expect(queries).toMatch(/createPublicClient\(\)/);
  });

  it("a challenge save purges it", () => {
    expect(read("lib/challenges/actions.ts")).toMatch(/revalidateTag\(CHALLENGE_NAV_TAG, "max"\)/);
  });
});
