import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import { INDEXNOW_ENDPOINT, indexNowKey, notifyIndexNow } from "@/lib/seo/indexnow";

// ---------------------------------------------------------------------------
// notifyIndexNow — fires only on production with a well-formed key, submits
// deduped absolute URLs, and never lets a failure reach the caller.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
const KEY = "a1b2c3d4e5f6";

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INDEXNOW_KEY", KEY);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("indexNowKey", () => {
  it("is off without a key, with a malformed key, and on previews", () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    expect(indexNowKey()).toBeNull();
    vi.stubEnv("INDEXNOW_KEY", "short");
    expect(indexNowKey()).toBeNull();
    vi.stubEnv("INDEXNOW_KEY", "has spaces in it");
    expect(indexNowKey()).toBeNull();
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(indexNowKey()).toBeNull();
  });

  it("is on in production (and off-Vercel) with a well-formed key", () => {
    expect(indexNowKey()).toBe(KEY);
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(indexNowKey()).toBe(KEY);
  });
});

describe("notifyIndexNow", () => {
  it("submits deduped absolute URLs with the key and its location", async () => {
    const ok = await notifyIndexNow([
      "/card/alice/dragon",
      "/card/alice/dragon",
      "/profile/alice",
      "not-a-path",
    ]);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      host: "www.pipglyph.com",
      key: KEY,
      keyLocation: "https://www.pipglyph.com/indexnow-key.txt",
      urlList: ["https://www.pipglyph.com/card/alice/dragon", "https://www.pipglyph.com/profile/alice"],
    });
  });

  it("does nothing when off or when there is nothing to submit", async () => {
    expect(await notifyIndexNow([])).toBe(false);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await notifyIndexNow(["/card/alice/dragon"])).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs and reports false on a rejected batch or a thrown fetch, never throws", async () => {
    fetchMock.mockResolvedValueOnce({ status: 429 });
    expect(await notifyIndexNow(["/card/alice/dragon"])).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error("socket closed"));
    expect(await notifyIndexNow(["/card/alice/dragon"])).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
