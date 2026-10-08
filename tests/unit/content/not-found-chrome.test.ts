import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// One site chrome on a 404.
//
// Next draws a notFound() thrown under a route group INSIDE that group's
// layout — with the group's own not-found.tsx, or, when it has none, with the
// root one. The root one wraps itself in AppShell (an unmatched URL has only
// the root layout around it), so a group without its own file showed two
// headers, two ribbons and two footers on every 404, and a signed-in
// visitor's second header mounted a second RealtimeAlerts that took the page
// to the error boundary (2026-10).
//
// So: every route group with a layout carries a not-found.tsx that renders
// the shared body and no shell. tests/e2e/not-found-chrome.spec.ts checks
// what the browser draws; this catches the new group that forgets the file.
// ---------------------------------------------------------------------------

const APP = path.resolve(__dirname, "../../../app");
const SHELL = "@/components/layout/app-shell";
const BODY = "@/components/layout/not-found-content";

const read = (file: string) => readFileSync(path.join(APP, file), "utf8");
/** The modules a file imports (its comments name AppShell too). */
const importsOf = (source: string) =>
  [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);

const groups = readdirSync(APP, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\(.+\)$/.test(entry.name))
  .map((entry) => entry.name)
  .filter((group) => existsSync(path.join(APP, group, "layout.tsx")))
  .sort();

describe("404 chrome", () => {
  it("the scan sees the route groups", () => {
    expect(groups).toEqual(expect.arrayContaining(["(app)", "(marketing)"]));
  });

  it.each(groups)("%s has its own not-found.tsx: the shared body, no shell", (group) => {
    const file = path.join(group, "not-found.tsx");
    expect(
      existsSync(path.join(APP, file)),
      `app/${file} is missing — without it a 404 under ${group} draws app/not-found.tsx (and its AppShell) inside the group's layout`,
    ).toBe(true);
    const imports = importsOf(read(file));
    expect(imports).toContain(BODY);
    expect(imports).not.toContain(SHELL);
  });

  it("the root not-found — unmatched URLs, nothing but the root layout around it — brings the shell", () => {
    const imports = importsOf(read("not-found.tsx"));
    expect(imports).toContain(SHELL);
    expect(imports).toContain(BODY);
  });

  it("the shared body draws no chrome of its own", () => {
    const body = readFileSync(path.resolve(APP, "../components/layout/not-found-content.tsx"), "utf8");
    expect(importsOf(body)).not.toContain(SHELL);
    expect(body).not.toMatch(/<(header|footer|main)\b/);
  });
});
