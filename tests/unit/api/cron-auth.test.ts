import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ adminConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => s.adminConfigured }));

import { cronRouteGuard, isCronAuthorized } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// The guard every cron route opens with: fails CLOSED without a secret, needs
// the exact bearer, and needs the service role to do anything.
// ---------------------------------------------------------------------------

const req = (auth?: string) =>
  new Request("http://x/api/cron/anything", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  s.adminConfigured = true;
  vi.stubEnv("CRON_SECRET", "s3cret");
});
afterEach(() => vi.unstubAllEnvs());

describe("isCronAuthorized", () => {
  it("accepts only the exact bearer", () => {
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(true);
    expect(isCronAuthorized(req("Bearer wrong"))).toBe(false);
    expect(isCronAuthorized(req("s3cret"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(req("Bearer "))).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
  });
});

describe("cronRouteGuard", () => {
  it("lets an authorized request through", () => {
    expect(cronRouteGuard(req("Bearer s3cret"))).toBeNull();
  });

  it("answers 401 to a bad bearer and 503 without the service role", async () => {
    const denied = cronRouteGuard(req("Bearer nope"));
    expect(denied?.status).toBe(401);
    s.adminConfigured = false;
    const noRole = cronRouteGuard(req("Bearer s3cret"));
    expect(noRole?.status).toBe(503);
    expect((await noRole!.json()).error).toMatch(/service role/i);
  });

  it("honours a caller-supplied decision (the rebake route's local bypass)", () => {
    expect(cronRouteGuard(req(), { authorized: true })).toBeNull();
    expect(cronRouteGuard(req("Bearer s3cret"), { authorized: false })?.status).toBe(401);
  });
});
