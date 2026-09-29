import { beforeEach, describe, expect, it, vi } from "vitest";
import { anonRenderDb } from "@/tests/stubs/anon-render-db";

// ---------------------------------------------------------------------------
// lib/cards/anon-render-limit.ts — the limiter on a signed-out caller's LIVE
// card renders (TODO 7.8). Counted per network (an IPv4 address, an IPv6
// /64) under an HMAC key — never the address itself — through migration
// 0125's hit_anon_render_limit (modelled by tests/stubs/anon-render-db.ts).
// A refused call counts nothing; any database failure lets the render
// through (fail-open, like the per-user limiters).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  configured: true,
  client: null as unknown,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.configured,
  createAdminClient: () => state.client,
}));

import {
  ANON_LIVE_RENDER_LIMITS,
  anonRenderKey,
  checkAnonLiveRenderLimit,
  clientNetworkOf,
} from "@/lib/cards/anon-render-limit";

// 12:00:30 UTC — mid-minute, so "seconds to the next minute" is 30.
let clock = Date.parse("2026-09-29T12:00:30Z");
let db: ReturnType<typeof anonRenderDb>;

function request(ip?: string, header = "x-real-ip") {
  return new Request("http://localhost/api/cards/x/png", { headers: ip ? { [header]: ip } : {} });
}

beforeEach(() => {
  clock = Date.parse("2026-09-29T12:00:30Z");
  db = anonRenderDb({ now: () => clock });
  state.client = db.client;
  state.configured = true;
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only");
});

describe("clientNetworkOf — what one caller is counted as", () => {
  it("an IPv4 address as is; an IPv4-mapped IPv6 address unwrapped to it", () => {
    expect(clientNetworkOf("203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetworkOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetworkOf(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("an IPv6 address as its /64, however it is written", () => {
    expect(clientNetworkOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientNetworkOf("2001:0db8:0001:0002:0000:0000:0000:0001")).toBe("2001:db8:1:2::/64");
    expect(clientNetworkOf("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(clientNetworkOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientNetworkOf("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientNetworkOf("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(clientNetworkOf("::1")).toBe("0:0:0:0::/64");
  });

  it("anything unreadable is one shared bucket", () => {
    expect(clientNetworkOf(undefined)).toBe("unknown");
    expect(clientNetworkOf("")).toBe("unknown");
    expect(clientNetworkOf("not-an-ip")).toBe("unknown");
    expect(clientNetworkOf("203.0.113.7, 10.0.0.1")).toBe("unknown");
  });
});

describe("anonRenderKey — no raw identifier is stored", () => {
  it("is 32 hex digits and carries no part of the address", () => {
    const key = anonRenderKey(request("203.0.113.7"), "s");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
    expect(key).not.toContain("cb007107"); // 203.0.113.7 in hex
  });

  it("one key per network: the same /64, the same key; another address, another key", () => {
    const a = anonRenderKey(request("2001:db8:1:2::1"), "s");
    expect(anonRenderKey(request("2001:db8:1:2:ffff::9"), "s")).toBe(a);
    expect(anonRenderKey(request("2001:db8:1:3::1"), "s")).not.toBe(a);
    expect(anonRenderKey(request("203.0.113.7"), "s")).not.toBe(anonRenderKey(request("203.0.113.8"), "s"));
  });

  it("depends on the server's secret (an address can't be looked up without it)", () => {
    expect(anonRenderKey(request("203.0.113.7"), "one")).not.toBe(anonRenderKey(request("203.0.113.7"), "two"));
  });

  it("reads Vercel's x-real-ip, else the first x-forwarded-for hop", () => {
    const real = anonRenderKey(request("203.0.113.7"), "s");
    expect(anonRenderKey(request("203.0.113.7, 10.0.0.1", "x-forwarded-for"), "s")).toBe(real);
  });
});

describe("checkAnonLiveRenderLimit", () => {
  it(`allows ${ANON_LIVE_RENDER_LIMITS.perMinute} a minute, then refuses with Retry-After to the next minute`, async () => {
    for (let i = 0; i < ANON_LIVE_RENDER_LIMITS.perMinute; i += 1) {
      expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
    }
    const denied = await checkAnonLiveRenderLimit(request("203.0.113.7"));
    expect(denied).toMatchObject({ ok: false, retryAfterSeconds: 30 });
    expect(denied.ok === false && denied.message).toMatch(/sign in/i);
    // A refused call counts nothing.
    expect(db.rows.reduce((n, r) => n + r.hits, 0)).toBe(ANON_LIVE_RENDER_LIMITS.perMinute);
    // Another network has its own count.
    expect(await checkAnonLiveRenderLimit(request("203.0.113.8"))).toEqual({ ok: true });
    // The next minute opens again.
    clock += 30_000;
    expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
  });

  it(`caps the hour at ${ANON_LIVE_RENDER_LIMITS.perHour}, until the oldest counted minute leaves it`, async () => {
    const start = clock;
    let allowed = 0;
    for (let minute = 0; minute < 60 && allowed < ANON_LIVE_RENDER_LIMITS.perHour; minute += 1) {
      clock = start + minute * 60_000;
      for (let i = 0; i < ANON_LIVE_RENDER_LIMITS.perMinute && allowed < ANON_LIVE_RENDER_LIMITS.perHour; i += 1) {
        expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
        allowed += 1;
      }
    }
    // Fresh minute, the minute limit untouched: the hour refuses.
    clock += 60_000;
    const denied = await checkAnonLiveRenderLimit(request("203.0.113.7"));
    expect(denied.ok).toBe(false);
    // The first counted minute (12:00) leaves the hour at 13:00.
    const retry = denied.ok ? 0 : denied.retryAfterSeconds;
    expect(retry).toBe((Date.parse("2026-09-29T13:00:00Z") - clock) / 1000);
    clock = Date.parse("2026-09-29T13:00:00Z");
    expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
  });

  it("sends the key and the limits, never the address", async () => {
    await checkAnonLiveRenderLimit(request("203.0.113.7"));
    expect(db.calls).toEqual([
      {
        p_key_hash: anonRenderKey(request("203.0.113.7"), "sb_secret_test_only"),
        p_per_minute: ANON_LIVE_RENDER_LIMITS.perMinute,
        p_per_hour: ANON_LIVE_RENDER_LIMITS.perHour,
      },
    ]);
    expect(JSON.stringify(db.calls)).not.toContain("203.0.113.7");
  });

  it("fails open: an RPC error, a thrown client, no admin client or no secret all let the render through", async () => {
    state.client = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
    state.client = {
      rpc: async () => {
        throw new Error("network");
      },
    };
    expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
    state.configured = false;
    expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
    state.configured = true;
    state.client = db.client;
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await checkAnonLiveRenderLimit(request("203.0.113.7"))).toEqual({ ok: true });
    expect(db.calls).toHaveLength(0);
  });
});
