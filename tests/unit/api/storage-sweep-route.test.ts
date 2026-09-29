import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/admin/storage-sweep — what scripts/sweep-storage-orphans.mjs
// asks the APP to do (owner answers 2026-09-29): purge a card's CDN copies
// (only a function on Vercel can), act on the rows that use a flagged file
// through the app's own code paths. Cron-bearer only (fails closed, no dev
// bypass), 503 without the service role, strict body; every answer names
// the database the app talks to, so the script can refuse the wrong one.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  adminConfigured: true,
  purge: vi.fn(async (ids: readonly string[]) => void ids),
  act: vi.fn(async (_admin: unknown, _file: unknown, actions: unknown[]) =>
    actions.map((action) => ({ action, status: "done", detail: "ok" })),
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ tag: "admin-client" }),
  isAdminConfigured: () => s.adminConfigured,
}));
vi.mock("@/lib/cards/revalidate", () => ({ purgeHiddenCards: s.purge }));
vi.mock("@/lib/moderation/flagged-file", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/moderation/flagged-file")>();
  return { ...real, actOnFlaggedFile: s.act };
});

import { POST } from "@/app/api/admin/storage-sweep/route";

const U1 = "11111111-1111-4111-8111-111111111111";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const post = (body: unknown, auth: string | null = "Bearer s3cret") =>
  POST(
    new Request("https://www.pipglyph.com/api/admin/storage-sweep", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  vi.stubEnv("VERCEL", "1");
  s.adminConfigured = true;
  s.purge.mockClear();
  s.act.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/storage-sweep", () => {
  it("needs the cron bearer — and no secret configured means nobody", async () => {
    expect((await post({ op: "whoami" }, null)).status).toBe(401);
    expect((await post({ op: "whoami" }, "Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await post({ op: "whoami" }, "Bearer ")).status).toBe(401);
    expect(s.purge).not.toHaveBeenCalled();
    expect(s.act).not.toHaveBeenCalled();
  });

  it("answers 503 without the service role", async () => {
    s.adminConfigured = false;
    expect((await post({ op: "whoami" })).status).toBe(503);
  });

  it("whoami names the database this deployment talks to, and whether it can purge a CDN", async () => {
    const res = await post({ op: "whoami" });
    expect(await res.json()).toEqual({ ok: true, supabaseHost: "auth.pipglyph.com", vercel: true });
    vi.stubEnv("VERCEL", "");
    expect(await (await post({ op: "whoami" })).json()).toMatchObject({ vercel: false });
  });

  it("purge-cards: the same purge as going private (purgeHiddenCards), each card once", async () => {
    const res = await post({ op: "purge-cards", cardIds: [CARD, CARD.toUpperCase()] });
    expect(await res.json()).toEqual({ ok: true, supabaseHost: "auth.pipglyph.com", vercel: true, purged: 1 });
    expect(s.purge).toHaveBeenCalledWith([CARD]);
  });

  it("flagged-file: hands the file and the actions to the app's worker with the service-role client", async () => {
    const file = { bucket: "card-art", path: `${U1}/photo.jpg` };
    const actions = [
      { kind: "hide-card", cardId: CARD },
      { kind: "profile-default", userId: U1, column: "avatar_url" },
    ];
    const res = await post({ op: "flagged-file", file, actions });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toHaveLength(2);
    expect(s.act).toHaveBeenCalledWith({ tag: "admin-client" }, file, actions);
  });

  it.each([
    ["not JSON", "{"],
    ["an unknown op", { op: "delete-everything" }],
    ["a card id that isn't a uuid", { op: "purge-cards", cardIds: ["../x"] }],
    ["no card ids", { op: "purge-cards", cardIds: [] }],
    ["over 100 card ids", { op: "purge-cards", cardIds: Array(101).fill(CARD) }],
    ["a bucket outside the sweep", { op: "flagged-file", file: { bucket: "frames", path: `${U1}/a.png` }, actions: [{ kind: "hide-card", cardId: CARD }] }],
    ["a path outside a user folder", { op: "flagged-file", file: { bucket: "card-art", path: "a.png" }, actions: [{ kind: "hide-card", cardId: CARD }] }],
    ["a traversal", { op: "flagged-file", file: { bucket: "card-art", path: `${U1}/..png` }, actions: [{ kind: "hide-card", cardId: CARD }] }],
    ["an unknown action", { op: "flagged-file", file: { bucket: "card-art", path: `${U1}/a.png` }, actions: [{ kind: "delete-card", cardId: CARD }] }],
    ["a profile column that isn't a picture", { op: "flagged-file", file: { bucket: "card-art", path: `${U1}/a.png` }, actions: [{ kind: "profile-default", userId: U1, column: "bio" }] }],
    ["no actions", { op: "flagged-file", file: { bucket: "card-art", path: `${U1}/a.png` }, actions: [] }],
  ])("refuses %s with 400 and does nothing", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(s.purge).not.toHaveBeenCalled();
    expect(s.act).not.toHaveBeenCalled();
  });
});
