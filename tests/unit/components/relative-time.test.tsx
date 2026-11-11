// @vitest-environment happy-dom
// A reader in Denver, whatever zone the machine running this is in. Set
// before anything reads a date (Node applies a changed TZ at once).
process.env.TZ = "America/Denver";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { RelativeTime } from "@/components/ui/local-date";

// ---------------------------------------------------------------------------
// <RelativeTime> — a relative time in a component that hydrates
// (components/ui/local-date.tsx). The server's HTML and the browser disagree
// on two things: the time zone of the date printed from a week on, and the
// clock (by a minute on a live page, by hours on a cached one). As bare text
// either one was React's hydration error #418 — the tree thrown away and
// rendered again (2026-11-11: a notification, "Oct 30" in the HTML, "Oct 29"
// in a Mountain-time browser).
//
// Held here: the server prints the UTC reading; hydrating stale or
// other-zone HTML raises NO error; and once hydrated the reader sees their
// own reading — the clock's too, which a text React was told to leave alone
// never gets unless the element is new.
// ---------------------------------------------------------------------------

const EVENING = "2026-10-30T05:23:51Z"; // Oct 29, 23:23 in Denver
let root: Root | null = null;
let container: HTMLDivElement;
let errors: unknown[][] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  container = document.createElement("div");
  document.body.appendChild(container);
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The server's HTML at one moment, hydrated in the browser at another. */
async function hydrated(iso: string, serverNow: string, browserNow: string) {
  vi.setSystemTime(new Date(serverNow));
  const html = renderToString(<RelativeTime iso={iso} className="stamp" />);
  container.innerHTML = html;
  const serverNode = container.querySelector("time");
  const recoverable: unknown[] = [];
  vi.setSystemTime(new Date(browserNow));
  await act(async () => {
    root = hydrateRoot(container, <RelativeTime iso={iso} className="stamp" />, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
  return { html, serverNode, recoverable, node: container.querySelector("time")! };
}

describe("RelativeTime", () => {
  it("this test's reader really is in another zone than the server's UTC", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Denver");
  });

  it("the server prints the UTC reading, in a <time> that carries the instant", () => {
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    expect(renderToString(<RelativeTime iso={EVENING} className="stamp" title="exact" />)).toBe(
      `<time dateTime="${EVENING}" class="stamp" title="exact">Oct 30</time>`,
    );
  });

  it("another zone: no hydration error, and the reader ends on THEIR day", async () => {
    const { html, recoverable, node } = await hydrated(EVENING, "2026-11-10T12:00:00Z", "2026-11-10T12:00:05Z");
    expect(html).toContain(">Oct 30<");
    expect(recoverable).toEqual([]);
    expect(errors.filter((args) => /hydrat|did not match|didn't match/i.test(String(args[0])))).toEqual([]);
    expect(node.textContent).toBe("Oct 29");
    expect(node.getAttribute("datetime")).toBe(EVENING);
    expect(node.className).toBe("stamp");
  });

  it("a cached page: HTML a day old said “2h ago” — no error, and the reader sees today's reading, not the copy's", async () => {
    const posted = "2026-11-09T10:00:00Z";
    const { html, serverNode, recoverable, node } = await hydrated(posted, "2026-11-09T12:00:00Z", "2026-11-10T13:00:00Z");
    expect(html).toContain(">2h ago<");
    expect(recoverable).toEqual([]);
    expect(errors.filter((args) => /hydrat|did not match|didn't match/i.test(String(args[0])))).toEqual([]);
    expect(node.textContent).toBe("1d ago");
    // A NEW element: React never rewrites a text it was told to leave alone,
    // and its hydrating and hydrated renders are the same string here.
    expect(node).not.toBe(serverNode);
    expect(container.querySelectorAll("time")).toHaveLength(1);
  });

  it("a minute passing between the server and the browser is no error either", async () => {
    const { recoverable, node } = await hydrated("2026-11-10T11:30:20Z", "2026-11-10T12:00:00Z", "2026-11-10T12:00:50Z");
    expect(recoverable).toEqual([]);
    expect(node.textContent).toBe("31m ago");
  });
});
