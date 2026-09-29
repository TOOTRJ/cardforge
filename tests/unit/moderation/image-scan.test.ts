import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The upload path's moderation scan (lib/moderation/image-scan.ts) and the
// owner-run rescan of pre-0126 direct uploads (scripts/lib/review-rescan.mjs,
// TODO 3.14b (b)) run the SAME scan: one request shape, one model, one
// category allowlist (lib/moderation/image-scan-core.ts). The upload path
// still fails open; the rescan never calls an error "clean".
// ---------------------------------------------------------------------------

const openai = vi.hoisted(() => ({
  options: [] as unknown[],
  requests: [] as unknown[],
  answer: { results: [{ flagged: false, categories: {} }] } as unknown,
  fail: null as Error | null,
}));

vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      openai.options.push(options);
    }
    moderations = {
      create: async (request: unknown) => {
        openai.requests.push(request);
        if (openai.fail) throw openai.fail;
        return openai.answer;
      },
    };
  },
}));

const { scanImageUrl } = await import("@/lib/moderation/image-scan");
const { BLOCKED_CATEGORIES, IMAGE_MODERATION_MODEL, imageModerationRequest, scanVerdict } = await import("@/lib/moderation/image-scan-core");
const { moderateOnce } = await import("@/scripts/lib/review-rescan.mjs");

const URL_ = "https://auth.pipglyph.com/storage/v1/object/public/card-art/11111111-1111-4111-8111-111111111111/a.png";

describe("the image moderation scan", () => {
  const saved = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    openai.options.length = 0;
    openai.requests.length = 0;
    openai.fail = null;
    openai.answer = { results: [{ flagged: false, categories: {} }] };
    process.env.OPENAI_API_KEY = "sk-test-not-a-key";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });

  it("sends omni-moderation the image's URL", async () => {
    await scanImageUrl(URL_);
    expect(openai.requests).toEqual([{ model: "omni-moderation-latest", input: [{ type: "image_url", image_url: { url: URL_ } }] }]);
    expect(openai.requests[0]).toEqual(imageModerationRequest(URL_));
    expect(IMAGE_MODERATION_MODEL).toBe("omni-moderation-latest");
    expect(openai.options).toEqual([{ apiKey: "sk-test-not-a-key", timeout: 20_000 }]);
  });

  it("flags only the owner's categories (2026-07-10): violence alone is fantasy art, not a block", async () => {
    expect([...BLOCKED_CATEGORIES].sort()).toEqual(
      ["hate", "hate/threatening", "self-harm", "self-harm/instructions", "self-harm/intent", "sexual", "sexual/minors"].sort(),
    );
    openai.answer = { results: [{ flagged: true, categories: { violence: true, "violence/graphic": true } }] };
    expect(await scanImageUrl(URL_)).toEqual({ flagged: false, categories: [] });
    openai.answer = { results: [{ flagged: true, categories: { violence: true, sexual: true, hate: false } }] };
    expect(await scanImageUrl(URL_)).toEqual({ flagged: true, categories: ["sexual"] });
    expect(scanVerdict({ flagged: false, categories: { sexual: true } })).toEqual({ flagged: false, categories: [] });
    expect(scanVerdict(undefined)).toEqual({ flagged: false, categories: [] });
  });

  it("the upload path fails open: no key → no call; an API error → not flagged", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await scanImageUrl(URL_)).toEqual({ flagged: false, categories: [] });
    expect(openai.requests).toEqual([]);
    process.env.OPENAI_API_KEY = "sk-test-not-a-key";
    openai.fail = Object.assign(new Error("boom"), { status: 500 });
    expect(await scanImageUrl(URL_)).toEqual({ flagged: false, categories: [] });
  });

  it("the owner-run rescan sends the very same request and reaches the same verdict — but an error is never 'clean'", async () => {
    const answers = [
      { results: [{ flagged: true, categories: { violence: true } }] },
      { results: [{ flagged: true, categories: { "sexual/minors": true, violence: true } }] },
      { results: [{ flagged: false, categories: {} }] },
    ];
    for (const answer of answers) {
      openai.requests.length = 0;
      openai.answer = answer;
      const upload = await scanImageUrl(URL_);
      const rescanRequests: unknown[] = [];
      const rescan = await moderateOnce({
        moderate: async (request: unknown) => {
          rescanRequests.push(request);
          return answer;
        },
        url: URL_,
        sleep: async () => {},
      });
      expect(rescanRequests).toEqual(openai.requests);
      expect({ flagged: rescan.verdict === "flagged", categories: rescan.categories }).toEqual(upload);
    }
    // Where the upload path says "not flagged" on an error, the rescan says "error".
    const failed = await moderateOnce({
      moderate: async () => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
      url: URL_,
      sleep: async () => {},
    });
    expect(failed).toEqual({ verdict: "error", error: "HTTP 400" });
  });
});
