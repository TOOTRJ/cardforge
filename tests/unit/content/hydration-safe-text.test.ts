import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Text a component that HYDRATES may not print (2026-11-11).
//
// The server renders in UTC, in English, at one moment; the browser hydrates
// in the reader's zone, in their locale, later. A text that reads any of the
// three differs between the two, and a text that differs is React's
// "hydration failed" (#418): the tree is thrown away and rendered again. On
// production an admin's /notifications did it on every load ("Oct 30" in the
// HTML, "Oct 29" in a Mountain-time browser), and so did two admin tool
// pages; a cached card page with a comment did it for everyone.
//
// So in a "use client" file:
//   - a relative time is `<RelativeTime>`, a reader's date `<LocalDate>`, an
//     admin's `formatUtcDate` (components/ui/local-date.tsx, lib/format/dates.ts)
//     — never `formatShortDate` / `formatFullTime`, and `formatRelativeTime`
//     only with the zone named;
//   - a number is `toLocaleString("en-US")`, never the bare call;
//   - no `toLocaleDateString` / `toLocaleTimeString`;
// and a sort that feeds a hydrating list names its collation (SORT_LOCALE).
//
// What this can't see: a file with no directive that a client file imports,
// and text built from the clock at an exact instant. Those are judged by
// reading; this keeps the helpers that caused the errors from coming back.
// ---------------------------------------------------------------------------

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(name)) files.push(path);
  }
};
walk("app");
walk("components");

const read = (path: string) => readFileSync(path, "utf8");
const clientFiles = files.filter((path) => /^\s*["']use client["']/.test(read(path)));

/** `pattern`'s matches in the client files, as "path: match". */
function found(pattern: RegExp, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const path of clientFiles) {
    if (skip(path)) continue;
    for (const match of read(path).matchAll(pattern)) out.push(`${path}: ${match[0]}`);
  }
  return out;
}

describe("a component that hydrates prints no text the server and the browser read differently", () => {
  it("finds the client files (the scan is not empty)", () => {
    expect(clientFiles.length).toBeGreaterThan(100);
    expect(clientFiles).toContain("components/notifications/notification-row.tsx");
  });

  it("no runtime-zone date helper: formatShortDate / formatFullTime", () => {
    expect(found(/\bformat(ShortDate|FullTime)\(/g)).toEqual([]);
  });

  it("formatRelativeTime only with its zone named (or through <RelativeTime>)", () => {
    // Every call, with what is between its parentheses (no call here nests one).
    const calls = found(/\bformatRelativeTime\(([^()]*)\)/g);
    const zoneLess = calls.filter((call) => {
      const args = call.slice(call.indexOf("(") + 1, -1).split(",").map((arg) => arg.trim());
      return args.length < 3 || args[2] === "" || args[2] === "undefined";
    });
    expect(zoneLess).toEqual([]);
    // The component itself is one of them.
    expect(calls).toContain("components/ui/local-date.tsx: formatRelativeTime(iso, undefined, timeZone)");
  });

  it("no number or date in the runtime's locale: toLocaleString() bare, toLocaleDateString, toLocaleTimeString", () => {
    expect(found(/\.toLocaleString\(\s*\)/g)).toEqual([]);
    expect(found(/\.toLocale(Date|Time)String\(/g)).toEqual([]);
  });

  it("a notification's sentence names its zone wherever the row is server-rendered", () => {
    // The toast is built after the page has loaded: the browser's own zone is right there.
    const calls = found(/\bdescribeNotification\(([^()]*(?:\{[^{}]*\})?[^()]*)\)/g, (path) => path === "components/notifications/realtime-alerts.tsx");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("timeZone");
  });

  it("a sort names its collation — never the runtime's (lib included: the views sort in client components)", () => {
    const sorted: string[] = [];
    const lib: string[] = [];
    const walkLib = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walkLib(path);
        else if (/\.tsx?$/.test(name)) lib.push(path);
      }
    };
    walkLib("lib");
    for (const path of [...files, ...lib]) {
      for (const match of read(path).matchAll(/localeCompare\([^()]*,\s*undefined\b/g)) sorted.push(`${path}: ${match[0]}`);
    }
    expect(sorted).toEqual([]);
    expect(read("lib/format/sort-locale.ts")).toContain('export const SORT_LOCALE = "en";');
  });
});
