import { describe, expect, it, vi } from "vitest";
import {
  SCREEN_WIDTH_BUCKETS,
  SCREEN_WIDTH_STORAGE_KEY,
  isScreenWidthBucket,
  reportScreenWidthOnce,
  screenWidthBucket,
  screenWidthProps,
} from "@/lib/analytics/screen-width";
import { CLIENT_FUNNEL_EVENTS, sanitizeFunnelProps } from "@/lib/analytics/funnel-events";

// ---------------------------------------------------------------------------
// TODO WD9: one anonymous viewport-width BUCKET per tab session — never the
// exact width or anything that identifies the visitor.
// ---------------------------------------------------------------------------

/** A sessionStorage stand-in: a Map, optionally throwing on read or write. */
function memoryStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => {
        if (opts.throwOnGet) throw new Error("SecurityError");
        return map.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (opts.throwOnSet) throw new Error("QuotaExceededError");
        map.set(key, value);
      },
    },
  };
}

describe("screenWidthBucket", () => {
  it("puts every boundary in the right bucket (each bucket runs min … next min − 1)", () => {
    const cases: Array<[number, string]> = [
      [1, "0-639"],
      [320, "0-639"],
      [639, "0-639"],
      [640, "640-1023"],
      [1023, "640-1023"],
      [1024, "1024-1365"],
      [1365, "1024-1365"],
      [1366, "1366-1535"],
      [1535, "1366-1535"],
      [1536, "1536-1919"],
      [1919, "1536-1919"],
      [1920, "1920-2559"],
      [2559, "1920-2559"],
      [2560, "2560-up"],
      [7680, "2560-up"],
    ];
    for (const [width, bucket] of cases) expect(screenWidthBucket(width), String(width)).toBe(bucket);
  });

  it("floors a fractional width (never rounds it up into the next bucket)", () => {
    expect(screenWidthBucket(639.9)).toBe("0-639");
    expect(screenWidthBucket(1919.5)).toBe("1536-1919");
  });

  it("is null for a width that isn't one", () => {
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(screenWidthBucket(width)).toBeNull();
  });

  it("has the seven buckets the width plan reads, labelled for the admin table", () => {
    expect(SCREEN_WIDTH_BUCKETS.map((b) => b.label)).toEqual([
      "<640",
      "640–1023",
      "1024–1365",
      "1366–1535",
      "1536–1919",
      "1920–2559",
      "2560+",
    ]);
  });

  it("stores keys the funnel props' sanitizer keeps as they are (no '<', '+' or en dash)", () => {
    for (const { key } of SCREEN_WIDTH_BUCKETS) {
      expect(isScreenWidthBucket(key)).toBe(true);
      expect(sanitizeFunnelProps({ bucket: key })).toEqual({ bucket: key });
    }
    expect(isScreenWidthBucket("<640")).toBe(false);
    expect(isScreenWidthBucket(1366)).toBe(false);
  });
});

describe("screenWidthProps — the only props a screen_width row may carry", () => {
  it("keeps a known bucket alone and drops everything else", () => {
    expect(
      screenWidthProps({
        bucket: "1366-1535",
        width: 1440,
        innerWidth: 1440,
        screen: "2560x1440",
        userAgent: "Mozilla/5.0",
        userId: "user-1",
        signedIn: true,
        sessionId: "abc",
        referrer: "google.com",
      }),
    ).toEqual({ bucket: "1366-1535" });
  });

  it("refuses a body with no known bucket — an exact width never passes as one", () => {
    expect(screenWidthProps({ bucket: "1440" })).toBeNull();
    expect(screenWidthProps({ bucket: 1440 })).toBeNull();
    expect(screenWidthProps({ width: 1440 })).toBeNull();
    expect(screenWidthProps(null)).toBeNull();
    expect(screenWidthProps("1366-1535")).toBeNull();
  });

  it("is a browser event in the funnel's vocabulary", () => {
    expect((CLIENT_FUNNEL_EVENTS as readonly string[]).includes("screen_width")).toBe(true);
  });
});

describe("reportScreenWidthOnce — once per tab session", () => {
  it("sends the bucket the first time and nothing after (a reload, a remount)", () => {
    const { storage, map } = memoryStorage();
    const send = vi.fn();
    expect(reportScreenWidthOnce({ sessionStore: () => storage, width: 1440, send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("1366-1535");
    expect(map.get(SCREEN_WIDTH_STORAGE_KEY)).toBe("1");
    // The same tab again — even at another width.
    expect(reportScreenWidthOnce({ sessionStore: () => storage, width: 390, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a new tab session (empty storage) counts again", () => {
    const send = vi.fn();
    reportScreenWidthOnce({ sessionStore: () => memoryStorage().storage, width: 1920, send });
    reportScreenWidthOnce({ sessionStore: () => memoryStorage().storage, width: 1920, send });
    expect(send.mock.calls).toEqual([["1920-2559"], ["1920-2559"]]);
  });

  it("sends nothing when the storage can't be reached, read or written (no flag → no count)", () => {
    const send = vi.fn();
    expect(
      reportScreenWidthOnce({
        sessionStore: () => {
          throw new Error("SecurityError: sessionStorage is blocked");
        },
        width: 1440,
        send,
      }),
    ).toBe(false);
    expect(reportScreenWidthOnce({ sessionStore: () => memoryStorage({ throwOnGet: true }).storage, width: 1440, send })).toBe(false);
    expect(reportScreenWidthOnce({ sessionStore: () => memoryStorage({ throwOnSet: true }).storage, width: 1440, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sets the flag before it sends", () => {
    const { storage, map } = memoryStorage();
    reportScreenWidthOnce({
      sessionStore: () => storage,
      width: 800,
      send: () => expect(map.get(SCREEN_WIDTH_STORAGE_KEY)).toBe("1"),
    });
    expect.assertions(1);
  });

  it("a width that isn't one sends nothing and leaves the flag unset", () => {
    const { storage, map } = memoryStorage();
    const send = vi.fn();
    expect(reportScreenWidthOnce({ sessionStore: () => storage, width: 0, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});
