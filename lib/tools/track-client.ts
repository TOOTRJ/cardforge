// ---------------------------------------------------------------------------
// trackToolEvent — a beta tool's browser tells the server about a moment no
// server action sees (a link copied, a file saved, a run its runner
// finished). One beacon to POST /api/tools/usage.
//
// Fire-and-forget: it returns at once, never throws, and — being a beacon
// to a route, not a server action — never queues ahead of the tool's own
// actions or waits behind them. The server keeps only the names the tool
// lists for its browser (`TOOL_CLIENT_EVENTS`, lib/tools/catalog.ts); a new
// one is added there, or it is dropped.
//
// Props: short scalars only (counts, enumerated codes, booleans, `ms`) with
// lower-case snake_case keys — never text someone typed, a name or an id.
// ---------------------------------------------------------------------------

export const TOOL_USAGE_ENDPOINT = "/api/tools/usage";

export function trackToolEvent(
  slug: string,
  event: string,
  props: Record<string, string | number | boolean | null | undefined> = {},
): void {
  try {
    const body = JSON.stringify({ slug, event, props });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(TOOL_USAGE_ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    }
    if (typeof fetch === "function") {
      void fetch(TOOL_USAGE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Tracking never reaches the tool.
  }
}
