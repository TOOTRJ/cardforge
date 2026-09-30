import "server-only";

import { createHmac } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { ipAddress } from "@vercel/functions";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { RateLimitDenied } from "@/lib/api/responses";

// ---------------------------------------------------------------------------
// The limiter on ANONYMOUS live card renders (TODO 7.8).
//
// /api/cards/[id]/png serves a free viewer the stored bake (a few ms of
// sharp) whenever it can, and renders LIVE (a Satori render, ~1 s of CPU)
// when it can't:
//   * a Square PNG or a JPEG of a card whose corner keeps what was drawn
//     there (squareCornerFillsOf returns a null fill — the art-to-edge
//     templates m15borderless, m15borderlessartifact, the borderless
//     planeswalkers, fullartland, and the drawn top corners of bloomburrow,
//     lotr, tarkirdraconic);
//   * any download of a card with no servable stored bake (a missing bake, or
//     a pending platform correction between a sweep bump's deploy and its
//     sweep).
// A signed-out caller reaches those with no session and nothing but the ETag
// in the way, and a client that drops If-None-Match skips that. So a
// signed-out caller's live renders are counted per network and capped here;
// signed-in viewers, the stored-bake serves and the 304s never reach this.
//
// The counter is migration 0125's public.anon_render_hits, written ONLY by
// hit_anon_render_limit() (service role: the route has no session to write
// with, and the API roles can't touch the table). Its key is an HMAC of the
// caller's network under the server's secret — no raw address is stored
// (the funnel rule: anonymous rows carry no identifier), and without the
// secret a key can't be tied back to an address. Minute windows, kept for
// the hour the check reads.
//
// Sized for a sweep window, when every anonymous download of the swept
// cards renders live: 10 a minute / 60 an hour per network is far above one
// person downloading cards and far below a script. Over it → 429 +
// Retry-After (rateLimitedResponse). Fail-OPEN like the per-user limiters
// (lib/ai/rate-limit.ts, lib/scryfall/rate-limit.ts): a database hiccup
// must not turn every such download into an error — and a caller with no
// readable address (only possible off Vercel) is let through, never pooled
// into one bucket that would throttle all of them together.
// ---------------------------------------------------------------------------

export const ANON_LIVE_RENDER_LIMITS = { perMinute: 10, perHour: 60 } as const;

export type AnonRenderLimitResult = { ok: true } | ({ ok: false } & RateLimitDenied);

const KEY_CONTEXT = "pipglyph:anon-live-render:v1";

/**
 * The network a caller is counted by: an IPv4 address as is (an
 * IPv4-mapped IPv6 address — `::ffff:a.b.c.d` or its hex form
 * `::ffff:xxxx:xxxx` — unwrapped to it), an IPv6 address as its /64 — one
 * subscriber's allocation, so rotating addresses inside it gains nothing.
 *
 * Null when there is no readable address. On Vercel that can't happen (its
 * edge always sets x-real-ip), so null only means "not on Vercel" (local dev,
 * a CI server): such a caller is NOT counted, never pooled — one shared
 * bucket would lock every such caller out together.
 */
export function clientNetworkOf(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  if (isIPv4(raw)) return raw;
  if (!isIPv6(raw)) return null;
  // Expand "::" and any embedded dotted quad into 8 hex groups.
  let text = raw.toLowerCase().split("%")[0];
  const quad = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (quad) {
    const [a, b, c, d] = quad[1].split(".").map(Number);
    text = text.slice(0, -quad[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, null];
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const fill = tail === null ? [] : Array(8 - headGroups.length - tailGroups.length).fill("0");
  const groups = [...headGroups, ...fill, ...tailGroups].map((g) => parseInt(g, 16) || 0);
  // ::ffff:0:0/96 is an IPv4 client, however it is written — never the /64
  // every IPv4 address would otherwise share (0:0:0:0::/64).
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6], groups[7]];
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** The caller's address as Vercel reports it (x-real-ip), else the first
 *  x-forwarded-for hop. */
function callerIp(request: Request): string | undefined {
  return ipAddress(request) ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
}

/** The stored key: HMAC-SHA-256 of the caller's network under the server's
 *  secret, 32 hex digits. Never the address itself. Null when the caller has
 *  no readable address (see clientNetworkOf). */
export function anonRenderKey(request: Request, secret: string): string | null {
  const network = clientNetworkOf(callerIp(request));
  if (!network) return null;
  return createHmac("sha256", secret)
    .update(`${KEY_CONTEXT}\n${network}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Count one anonymous live render for this caller, or refuse it. Call it
 * only on the live path of a signed-out request — right before the render.
 * A refused call is not counted.
 */
export async function checkAnonLiveRenderLimit(request: Request): Promise<AnonRenderLimitResult> {
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!secret || !isAdminConfigured()) return { ok: true };
  const key = anonRenderKey(request, secret);
  if (!key) return { ok: true };
  try {
    const { data, error } = await createAdminClient().rpc("hit_anon_render_limit", {
      p_key_hash: key,
      p_per_minute: ANON_LIVE_RENDER_LIMITS.perMinute,
      p_per_hour: ANON_LIVE_RENDER_LIMITS.perHour,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || row.allowed !== false) return { ok: true };
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retry_after_seconds) || 60)),
      message:
        "Too many card downloads from your network right now — try again shortly, or sign in to skip the wait.",
    };
  } catch {
    return { ok: true };
  }
}
