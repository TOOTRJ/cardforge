import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_USAGE_ENDPOINT, trackToolEvent } from "@/lib/tools/track-client";
import { TOOL_CLIENT_EVENTS, type ToolSlug } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// trackToolEvent — how a tool's browser reports a moment no server code sees
// (the 2026-11-10 tools audit). It must never be in the tool's way: it
// returns at once, never throws, and is a beacon to a ROUTE — a server
// action would queue ahead of the tool's own actions.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Beacon = (url: string, data: Blob) => boolean;
const beaconBody = async (beacon: { mock: { calls: Array<Parameters<Beacon>> } }) => JSON.parse(await beacon.mock.calls[0]![1].text());

describe("trackToolEvent", () => {
  it("sends ONE beacon with the tool, the event and the props", async () => {
    const beacon = vi.fn<Beacon>(() => true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("fetch", fetchSpy);
    expect(trackToolEvent("rule0-sheet", "print", { shared: true, custom: 3 })).toBeUndefined();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]![0]).toBe(TOOL_USAGE_ENDPOINT);
    expect(await beaconBody(beacon)).toEqual({ slug: "rule0-sheet", event: "print", props: { shared: true, custom: 3 } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when the beacon is refused or missing", () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetchSpy);
    trackToolEvent("token-kit", "kit_exported", { kind: "pdf" });
    vi.stubGlobal("navigator", {});
    trackToolEvent("token-kit", "kit_exported", { kind: "zip" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TOOL_USAGE_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(init.body as string)).toEqual({ slug: "token-kit", event: "kit_exported", props: { kind: "pdf" } });
  });

  it("never throws and never leaves a rejection behind — offline, a beacon that throws, props that cannot be serialized", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      vi.stubGlobal("navigator", {
        sendBeacon: () => {
          throw new Error("blocked");
        },
      });
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
      expect(() => trackToolEvent("rule0-sheet", "copy_link")).not.toThrow();

      vi.stubGlobal("navigator", { sendBeacon: () => false });
      expect(() => trackToolEvent("rule0-sheet", "copy_link")).not.toThrow();

      const loop: Record<string, unknown> = {};
      loop.self = loop;
      expect(() => trackToolEvent("rule0-sheet", "copy_link", loop as never)).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("every browser event a tool's page sends is one ITS tool lists", () => {
  /** Each tool's own components: an event sent from one must be on that
   *  tool's list (an event on another tool's list is dropped by the route). */
  const DIRS: Record<string, ToolSlug> = {
    "components/tools/collection": "collection-builder",
    "components/tools/token-kit": "token-kit",
    "components/tools/bulk-customize": "bulk-customize",
    "components/tools/re-art": "re-art-deck",
    "components/tools/pip-forge": "pip-forge",
    "components/tools/set-symbol-studio": "set-symbol-studio",
    "components/tools/play-exports": "play-exports",
    "components/tools/rule0": "rule0-sheet",
  };
  const filesIn = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (path: string) => {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        if (statSync(child).isDirectory()) walk(child);
        else if (/\.tsx?$/.test(name)) out.push(child);
      }
    };
    try {
      walk(dir);
    } catch {
      // A tool with no components of its own.
    }
    return out;
  };

  it("every event name beside a tracking call in a tool's components is on that tool's list", () => {
    let seen = 0;
    for (const [dir, slug] of Object.entries(DIRS)) {
      const allowed = TOOL_CLIENT_EVENTS[slug];
      for (const file of filesIn(dir)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes("trackToolEvent")) continue;
        // The direct calls and each wrapper's calls (`track("x", …)`,
        // `trackImport("x", …)`, a `paused ? "a" : "b"` name, an outcome's
        // `event: "x"`): every lower-case name in an event position.
        const names = new Set<string>();
        for (const match of source.matchAll(/trackToolEvent\(\s*[A-Za-z0-9_"'-]+,\s*"([a-z0-9_]+)"/g)) names.add(match[1]!);
        for (const match of source.matchAll(/\btrack(?:Import)?\(\s*"([a-z0-9_]+)"/g)) names.add(match[1]!);
        for (const match of source.matchAll(/trackToolEvent\([^;]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g)) {
          names.add(match[1]!);
          names.add(match[2]!);
        }
        for (const name of names) {
          seen += 1;
          expect(allowed, `${file}: "${name}" is not in TOOL_CLIENT_EVENTS["${slug}"]`).toContain(name);
        }
      }
    }
    expect(seen).toBeGreaterThan(15);
  });

  it("an outcome a helper names (the kit's export) is on its tool's list too", () => {
    const workspace = readFileSync("lib/tools/token-kit/workspace.ts", "utf8");
    for (const match of workspace.matchAll(/event: "(kit_export_[a-z]+)"/g)) {
      expect(TOOL_CLIENT_EVENTS["token-kit"]).toContain(match[1]);
    }
  });

  it("no component records a tool event through a server action", () => {
    for (const dir of ["components", "app"]) {
      for (const file of filesIn(dir)) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(/trackToolEventAction/);
      }
    }
  });
});
