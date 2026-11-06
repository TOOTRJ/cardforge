import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A "use client" component must never VALUE-import a module that starts with
// `import "server-only"` (or one that reaches Stripe): Next's build fails on
// Vercel with "You're importing a component that needs server-only" — the
// admin's bank form once pulled lib/billing/day-bank.ts (→ Stripe) into the
// browser bundle (PR #769). A type-only import is erased and fine.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const SCAN = ["components", "app", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}

const serverOnly = new Set<string>();
const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
for (const file of files) {
  const head = readFileSync(file, "utf8").slice(0, 400);
  // A "use server" module is a bundle of actions: a client component may
  // import it (Next hands it references), whatever else it says.
  if (/^\s*["']use server["']/m.test(head)) continue;
  if (/^\s*import\s+["']server-only["']/m.test(head)) serverOnly.add(relative(ROOT, file).replace(/\.tsx?$/, ""));
}

describe("client components and server-only modules", () => {
  it("no 'use client' file value-imports a server-only module", () => {
    expect(serverOnly.size).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(text.slice(0, 300))) continue;
      for (const match of text.matchAll(/^import\s+(type\s+)?([^;]*?)\s+from\s+["']@\/([^"']+)["']/gm)) {
        if (match[1]) continue; // import type …
        const spec = match[2];
        // `import { type A, type B } from` — every binding a type.
        const bindings = spec.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
        if (spec.startsWith("{") && bindings.every((b) => b.startsWith("type "))) continue;
        if (serverOnly.has(match[3])) offenders.push(`${relative(ROOT, file)} → @/${match[3]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
