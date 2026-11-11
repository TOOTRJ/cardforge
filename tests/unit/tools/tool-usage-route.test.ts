import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// POST /api/tools/usage — a beta tool's browser-side events (the 2026-11-10
// tools audit). A beacon to a route, never a server action; same-site
// callers only, no crawlers, a 2 KB body, and always 204: the page never
// learns, or cares, what became of it.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({ record: vi.fn(async () => true) }));
vi.mock("@/lib/tools/client-events", () => ({ recordClientToolEvent: m.record }));

import { POST } from "@/app/api/tools/usage/route";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://www.pipglyph.com/api/tools/usage", {
    method: "POST",
    headers: { "user-agent": BROWSER, "sec-fetch-site": "same-origin", "content-type": "text/plain", ...headers },
    body,
  });
}

beforeEach(() => {
  m.record.mockClear();
  m.record.mockResolvedValue(true);
});

describe("POST /api/tools/usage", () => {
  it("hands a same-origin beacon's event to the keeper and answers 204 with no body", async () => {
    const response = await POST(request(JSON.stringify({ slug: "rule0-sheet", event: "copy_link", props: { shared: true } })));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
    expect(m.record).toHaveBeenCalledWith("rule0-sheet", "copy_link", { shared: true });
  });

  it("a browser that sends no fetch metadata is still heard", async () => {
    const headers = new Headers({ "user-agent": BROWSER });
    const response = await POST(
      new Request("https://www.pipglyph.com/api/tools/usage", { method: "POST", headers, body: JSON.stringify({ slug: "token-kit", event: "kit_exported" }) }),
    );
    expect(response.status).toBe(204);
    expect(m.record).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a cross-site caller", JSON.stringify({ slug: "rule0-sheet", event: "copy_link" }), { "sec-fetch-site": "cross-site" }],
    ["a sibling site", JSON.stringify({ slug: "rule0-sheet", event: "copy_link" }), { "sec-fetch-site": "same-site" }],
    ["a crawler", JSON.stringify({ slug: "rule0-sheet", event: "copy_link" }), { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
    ["an empty body", "", {}],
    ["a body past 2 KB", JSON.stringify({ slug: "rule0-sheet", event: "copy_link", props: { note: "x".repeat(2100) } }), {}],
    // 800 three-byte characters: under 2,048 characters, over 2,048 bytes.
    ["a body past 2 KB in BYTES", JSON.stringify({ slug: "rule0-sheet", event: "copy_link", props: { note: "\u20ac".repeat(800) } }), {}],
    ["a body that declares more than 2 KB (never read)", JSON.stringify({ slug: "rule0-sheet", event: "copy_link" }), { "content-length": "999999" }],
    ["a body that is no JSON", "slug=rule0-sheet", {}],
    ["a body that is no object", "null", {}],
  ])("drops %s — still 204, nothing recorded", async (_label, body, headers) => {
    const response = await POST(request(body, headers));
    expect(response.status).toBe(204);
    expect(m.record).not.toHaveBeenCalled();
  });

  it("answers 204 whatever the keeper decided", async () => {
    m.record.mockResolvedValue(false);
    const response = await POST(request(JSON.stringify({ slug: "token-kit", event: "open" })));
    expect(response.status).toBe(204);
  });
});
