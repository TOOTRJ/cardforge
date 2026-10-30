import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The card page is the ONE card detail view. An intercepting route
// (app/@modal/(.)card/…) used to draw a copy of it in a dialog on every soft
// navigation from a tile: the same ~20 queries as the page, a second <h1>
// over the page behind it, no "Card details" block, a different screen on a
// reload of the same URL, and a reload hack for /card/<slug>/edit, which the
// interceptor caught too. It was removed; these keep it removed.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(path);
      walk(path, out);
    }
  }
  return out;
}

describe("one card page, no intercepting modal", () => {
  it("app/ has no parallel slot and no intercepting route", () => {
    const dirs = walk("app").map((d) => d.split(/[\\/]/).pop() ?? "");
    expect(dirs.filter((d) => d.startsWith("@"))).toEqual([]);
    expect(dirs.filter((d) => /^\(\.{1,3}\)/.test(d))).toEqual([]);
  });

  it("the root layout renders no slot beside its children", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/\{modal\}|modal: React\.ReactNode/);
  });

  it("the card detail view has no variants", () => {
    expect(existsSync("components/cards/card-detail-modal.tsx")).toBe(false);
    const content = read("components/cards/card-detail-content.tsx");
    expect(content).not.toMatch(/variant === "(page|modal)"/);
    expect(read("app/(marketing)/card/[username]/[slug]/page.tsx")).toContain(
      "<CardDetailContent username={username} slug={slug} />",
    );
  });
});
