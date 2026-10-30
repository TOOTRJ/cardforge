import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/cron/publish-articles — cronRouteGuard first, then the release.

const state = vi.hoisted(() => ({
  configured: true,
  announce: vi.fn(async () => ({ announced: ["a"], indexNow: true })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/content/article-publish", () => ({ announceDueArticles: state.announce }));

import { GET } from "@/app/api/cron/publish-articles/route";

const get = (auth = "Bearer s3cret") =>
  GET(new Request("https://www.pipglyph.com/api/cron/publish-articles", { headers: { authorization: auth } }));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  state.configured = true;
  state.announce.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/publish-articles", () => {
  it("refuses a wrong bearer before any work", async () => {
    expect((await get("Bearer nope")).status).toBe(401);
    expect(state.announce).not.toHaveBeenCalled();
  });

  it("answers 503 without the service role", async () => {
    state.configured = false;
    expect((await get()).status).toBe(503);
  });

  it("announces what is due", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, announced: ["a"], indexNow: true });
  });

  it("answers 500 on a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.announce.mockRejectedValueOnce(new Error("db down"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "db down" });
  });
});
