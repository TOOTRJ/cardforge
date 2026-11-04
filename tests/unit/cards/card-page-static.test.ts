import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The card page is static for signed-out visitors (TODO CP2a): `force-static`
// (cookies() empty — every read runs as an anonymous visitor) with an ISR
// window, and a dynamic twin for a visitor with a session cookie
// (proxy.ts → app/(marketing)/card-member/…, held by
// tests/unit/routing/proxy.test.ts) that renders the SAME module. A view is
// the browser's ping, never a render: nothing on the page counts one on the
// server (a static page renders once per window, not once per visitor).
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const PAGE = "app/(marketing)/card/[username]/[slug]/page.tsx";
const TWIN = "app/(marketing)/card-member/[username]/[slug]";

describe("the card page: static, with a signed-in twin", () => {
  it("is force-static with an ISR window", () => {
    const page = read(PAGE);
    expect(page).toMatch(/^export const dynamic = "force-static";$/m);
    expect(page).toMatch(/^export const revalidate = \d+;$/m);
  });

  it("the twin renders the same module, dynamically, with the same 404 check and skeleton", () => {
    const twin = read(`${TWIN}/page.tsx`);
    expect(twin).toContain('export { default, generateMetadata, generateViewport } from "../../../card/[username]/[slug]/page";');
    expect(twin).toMatch(/^export const dynamic = "force-dynamic";$/m);
    expect(read(`${TWIN}/layout.tsx`)).toContain('export { default } from "../../../card/[username]/[slug]/layout";');
    expect(read(`${TWIN}/loading.tsx`)).toContain('export { default } from "../../../card/[username]/[slug]/loading";');
  });

  it("counts no view on the server: the ping does", () => {
    const content = read("components/cards/card-detail-content.tsx");
    expect(content).not.toMatch(/\bafter\(/);
    expect(content).not.toContain("incrementCardView");
    expect(content).toContain("<CardViewBeacon cardId={card.id} />");
  });
});
