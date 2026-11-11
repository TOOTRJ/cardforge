import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What Pip Forge's FREE actions tell the tool's log (lib/tools/pip-forge/
// actions.ts → lib/tools/events.ts recordToolEventLater, after the
// response): the action's name when it worked, `<name>_failed` with a
// `reason` code when it didn't. A new disc colour is logged as the forge's
// swatch it is — or "custom", never the hex a maker picked; a removal only
// when a pip really went. (The paid forge is pip-forge-route.test.ts.)
// ---------------------------------------------------------------------------

const ID = "00000000-0000-4000-8000-0000000000a1";

const m = vi.hoisted(() => ({
  events: [] as Array<{ slug: string; userId: string; event: string; access: string; props?: Record<string, unknown> }>,
  access: { userId: "u1", via: "grant" } as null | { userId: string; via: string },
  limited: false,
  pip: null as null | Record<string, unknown>,
  glyph: { width: 512, height: 512 } as null | { width: number; height: number },
  pixels: { width: 256, height: 256 } as null | { width: number; height: number },
  bytes: new Uint8Array([1]) as Uint8Array | null,
  updated: true,
  storeThrows: false,
  written: { ok: true, imageUrl: "https://x/W.png?v=1" } as { ok: true; imageUrl: string } | { ok: false; error: string },
  /** What the owner's session answers an update / a delete with. */
  rows: [{ id: "row" }] as Array<{ id: string }>,
  dbError: null as null | { message: string },
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => true }));
vi.mock("@/lib/media/user-storage", () => ({ isUserStorageConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        select: async () => ({ data: m.dbError ? null : m.rows, error: m.dbError }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/media/upload-rate-limit", () => ({
  checkUploadRateLimit: async () => (m.limited ? { ok: false, message: "Too fast.", retryAfterSeconds: 9 } : { ok: true }),
  uploadRateLimitFailure: (denied: { message: string; retryAfterSeconds: number }) => ({
    ok: false,
    error: denied.message,
    code: "UPLOAD_RATE_LIMITED",
    retryAfterSeconds: denied.retryAfterSeconds,
  }),
}));
vi.mock("@/lib/pips/write-pip", () => ({ writeCustomPip: async () => m.written }));
vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: async () => m.access }));
vi.mock("@/lib/tools/events", () => {
  const record = (input: (typeof m.events)[number]) => void m.events.push(input);
  return { recordToolEvent: async (input: (typeof m.events)[number]) => record(input), recordToolEventLater: record };
});
vi.mock("@/lib/tools/pip-forge/server", () => ({
  decodePng: async (bytes: Uint8Array) => (bytes.length > 1 ? m.pixels : m.glyph),
  fetchOwnPipFile: async (_u: string, _url: string, kind: "pip" | "glyph") =>
    m.bytes ? (kind === "pip" ? new Uint8Array([1, 2]) : m.bytes) : null,
  newPipVersion: () => "22222222-2222-4222-8222-222222222222",
  ownPipFileName: () => "pip-old.png",
  pipFileName: (v: string) => `pip-${v}.png`,
  readOwnPip: async () => m.pip,
  removePipFiles: async () => undefined,
  storeRecolouredPip: async () => {
    if (m.storeThrows) throw new Error("storage down");
    return "https://x/pip-new.png";
  },
  updatePipColour: async ({ disc }: { disc: string }) => (m.updated ? { ...m.pip, disc } : null),
}));

import {
  deletePipAction,
  recolourPipAction,
  renamePipAction,
  setPipAsOverrideAction,
} from "@/lib/tools/pip-forge/actions";

const PIP = {
  id: ID,
  name: "Amber Key",
  disc: "#e8c27a",
  version: "11111111-1111-4111-8111-111111111111",
  files: { pip: "https://x/pip.png", glyph: "https://x/glyph.png" },
};

beforeEach(() => {
  m.events = [];
  m.access = { userId: "u1", via: "grant" };
  m.limited = false;
  m.pip = { ...PIP };
  m.glyph = { width: 512, height: 512 };
  m.pixels = { width: 256, height: 256 };
  m.bytes = new Uint8Array([1]);
  m.updated = true;
  m.storeThrows = false;
  m.written = { ok: true, imageUrl: "https://x/W.png?v=1" };
  m.rows = [{ id: "row" }];
  m.dbError = null;
});

/** The one line the action wrote to the tool's log. */
function logged() {
  expect(m.events).toHaveLength(1);
  const [{ slug, userId, event, access, props }] = m.events;
  expect({ slug, userId, access }).toEqual({ slug: "pip-forge", userId: "u1", access: "grant" });
  // Never a name, an id or a colour's hex.
  expect(JSON.stringify(props ?? {})).not.toMatch(/Amber Key|#[0-9a-f]{6}|0000-4000/i);
  return props === undefined ? { event } : { event, props };
}

describe("recolour", () => {
  it("names the forge's swatch picked, and the one it replaced — never a hex", async () => {
    expect((await recolourPipAction({ id: ID, disc: "#8FCAC0" })).ok).toBe(true);
    expect(logged()).toEqual({ event: "recolour", props: { swatch: "teal", from: "amber" } });
  });

  it("a colour of the maker's own is `custom`", async () => {
    await recolourPipAction({ id: ID, disc: "#123456" });
    expect(logged()).toEqual({ event: "recolour", props: { swatch: "custom", from: "amber" } });
  });

  it("the colour it already has paints nothing and logs nothing", async () => {
    expect((await recolourPipAction({ id: ID, disc: "#e8c27a" })).ok).toBe(true);
    expect(m.events).toHaveLength(0);
  });

  it.each([
    ["rate_limited", { limited: true }],
    ["glyph_unreadable", { bytes: null }],
    ["glyph_unreadable", { glyph: { width: 64, height: 64 } }],
    ["changed", { updated: false }],
    ["store_failed", { storeThrows: true }],
  ] as const)("a refusal is `recolour_failed` with reason %s", async (reason, state) => {
    Object.assign(m, state);
    expect((await recolourPipAction({ id: ID, disc: "#8fcac0" })).ok).toBe(false);
    expect(logged()).toEqual({ event: "recolour_failed", props: { reason } });
  });
});

describe("use as a custom pip", () => {
  it("names the symbol it replaces", async () => {
    expect((await setPipAsOverrideAction({ id: ID, symbol: "U" })).ok).toBe(true);
    expect(logged()).toEqual({ event: "use_as_pip", props: { symbol: "U" } });
  });

  it.each([
    ["rate_limited", { limited: true }],
    ["pip_unreadable", { bytes: null }],
    ["pip_unreadable", { pixels: { width: 512, height: 512 } }],
    ["write_failed", { written: { ok: false, error: "flagged" } }],
  ] as const)("a refusal is `use_as_pip_failed` with reason %s", async (reason, state) => {
    Object.assign(m, state);
    expect((await setPipAsOverrideAction({ id: ID, symbol: "G" })).ok).toBe(false);
    expect(logged()).toEqual({ event: "use_as_pip_failed", props: { reason, symbol: "G" } });
  });
});

describe("rename and delete", () => {
  it("a saved name is `rename` — with no props: never the name", async () => {
    expect(await renamePipAction({ id: ID, name: "Amber Key II" })).toEqual({ ok: true });
    expect(logged()).toEqual({ event: "rename" });
  });

  it("a name that wasn't saved logs nothing", async () => {
    m.rows = [];
    expect((await renamePipAction({ id: ID, name: "Amber Key II" })).ok).toBe(false);
    expect(m.events).toHaveLength(0);
  });

  it("`delete` only when a pip really went", async () => {
    expect(await deletePipAction({ id: ID })).toEqual({ ok: true });
    expect(logged()).toEqual({ event: "delete" });

    // A second press: no row left to remove — still ok, nothing logged.
    m.events = [];
    m.rows = [];
    expect(await deletePipAction({ id: ID })).toEqual({ ok: true });
    expect(m.events).toHaveLength(0);

    m.dbError = { message: "boom" };
    expect((await deletePipAction({ id: ID })).ok).toBe(false);
    expect(m.events).toHaveLength(0);
  });

  it("a closed tool logs nothing", async () => {
    m.access = null;
    expect((await deletePipAction({ id: ID })).ok).toBe(false);
    expect((await renamePipAction({ id: ID, name: "X" })).ok).toBe(false);
    expect((await recolourPipAction({ id: ID, disc: "#8fcac0" })).ok).toBe(false);
    expect(m.events).toHaveLength(0);
  });
});
