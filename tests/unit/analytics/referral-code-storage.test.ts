// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_STORAGE_KEY,
  REFERRAL_CODE_KEEP_DAYS,
  REFERRAL_CODE_STORAGE_KEY,
  keptReferralCode,
  referralCodeToKeep,
} from "@/lib/analytics/attribution";
import {
  forgetReferralCode,
  keepReferralCode,
  referralCodeSource,
  storedAttribution,
  storedReferralCode,
} from "@/lib/analytics/attribution-client";

// ---------------------------------------------------------------------------
// The referral code kept PAST the tab (owner 2026-11-11: "keep the referral
// code longer than the tab — 30 days in the browser's storage").
// sessionStorage dies with the tab, and that is where referrals were lost:
// the tab closed and the site opened again later, the account made in
// another tab.
//
// Pinned here:
//   * what is stored — the code and the moment it was kept, nothing else,
//     under one key — and when a stored value still counts (30 days, to the
//     millisecond; never a value that is not a code, never one "kept" in the
//     future);
//   * the ONE read every surface uses, storedReferralCode(): the TAB's own
//     code first (the first link a tab saw wins there), else the code on the
//     address being looked at (the sign-up form's effect runs before the
//     layout's capture has stored it), else the one the browser kept;
//   * WHERE that code came from, referralCodeSource(): "link" when THIS
//     visit followed a friend's link (the tab holds it, or it is on the
//     address), "kept" when only the browser's copy from an earlier visit
//     holds one (up to 30 days old — possibly not the friend this person has
//     in mind, so onboarding still offers its code field), null when none;
//   * keepReferralCode: the FIRST link wins (a later one never takes a
//     referral over), an expired or unreadable value is replaced;
//   * none of it ever throws when the browser refuses storage.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const TAB = "aaaa1111";
const ADDRESS = "bbbb2222";
const KEPT = "cccc3333";

const setTab = (value: unknown) => sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
const setAddress = (path: string) => window.history.replaceState(null, "", path);
const setKept = (code: string, at: number) => localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, referralCodeToKeep(code, at));
const keptRaw = () => localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);

/** In-memory Web Storage, one per test: Node's own global localStorage
 *  (flag-less, no backing file) shadows happy-dom's and has no working
 *  methods, so both stores are stood in the same way on every Node. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
}

/** A storage the browser refuses: every access throws. */
const refusing = () => {
  const refuse = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: vi.fn(refuse), setItem: vi.fn(refuse), removeItem: vi.fn(refuse), clear: vi.fn(refuse) };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
  setAddress("/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setAddress("/");
});

describe("what is kept, and for how long (pure)", () => {
  it("one key, 30 days", () => {
    expect(REFERRAL_CODE_STORAGE_KEY).toBe("pg_referral_code_v1");
    expect(REFERRAL_CODE_KEEP_DAYS).toBe(30);
    // Not the tab's blob: the two never share a key.
    expect(REFERRAL_CODE_STORAGE_KEY).not.toBe(ATTRIBUTION_STORAGE_KEY);
  });

  it("stores the code and when it was kept — nothing else", () => {
    expect(JSON.parse(referralCodeToKeep(KEPT, NOW))).toEqual({ code: KEPT, at: NOW });
    expect(Object.keys(JSON.parse(referralCodeToKeep(KEPT, NOW))).sort()).toEqual(["at", "code"]);
  });

  it("a kept code is read back for 30 days — exactly 30 days is still kept, one millisecond more is not", () => {
    const raw = referralCodeToKeep(KEPT, NOW);
    for (const [age, kept] of [
      [0, true],
      [1, true],
      [DAY, true],
      [29 * DAY, true],
      [30 * DAY - 1, true],
      [30 * DAY, true],
      [30 * DAY + 1, false],
      [31 * DAY, false],
      [365 * DAY, false],
    ] as const) {
      expect(keptReferralCode(raw, NOW + age), `${age} ms later`).toBe(kept ? KEPT : undefined);
    }
  });

  it("a value kept in the FUTURE is not trusted (a clock set back, a hand-written value)", () => {
    expect(keptReferralCode(referralCodeToKeep(KEPT, NOW + 1), NOW)).toBeUndefined();
    expect(keptReferralCode(referralCodeToKeep(KEPT, NOW + 400 * DAY), NOW)).toBeUndefined();
  });

  it("nothing stored, garbage, a wrong shape or a value that is not a code: undefined, never a throw", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "not json",
      "{",
      "null",
      "42",
      "[]",
      JSON.stringify(KEPT),
      JSON.stringify([KEPT, NOW]),
      JSON.stringify({}),
      JSON.stringify({ code: KEPT }),
      JSON.stringify({ at: NOW }),
      JSON.stringify({ code: KEPT, at: String(NOW) }),
      JSON.stringify({ code: KEPT, at: null }),
      JSON.stringify({ code: KEPT, at: {} }),
      JSON.stringify({ code: "nope", at: NOW }),
      JSON.stringify({ code: "cccc333", at: NOW }),
      JSON.stringify({ code: "cccc33333", at: NOW }),
      JSON.stringify({ code: "<script>", at: NOW }),
      JSON.stringify({ code: 12345678, at: NOW }),
      JSON.stringify({ code: [KEPT], at: NOW }),
      // 1e999 parses to Infinity: not a moment.
      `{"code":"${KEPT}","at":1e999}`,
    ]) {
      expect(() => keptReferralCode(raw, NOW), String(raw)).not.toThrow();
      expect(keptReferralCode(raw, NOW), String(raw)).toBeUndefined();
    }
  });

  it("the code read back is always in its own shape: a stored code in capitals is the same code", () => {
    expect(keptReferralCode(JSON.stringify({ code: " CCCC3333 ", at: NOW }), NOW)).toBe(KEPT);
  });
});

describe("storedReferralCode — the tab, then the address, then the browser", () => {
  it("nothing anywhere: undefined", () => {
    expect(storedReferralCode()).toBeUndefined();
  });

  it("the TAB's code wins over the address and the kept one", () => {
    setTab({ referrer: "google.com", ref: TAB });
    setAddress(`/signup?ref=${ADDRESS}`);
    setKept(KEPT, NOW - DAY);
    expect(storedReferralCode()).toBe(TAB);
  });

  it("no code in the tab: the ADDRESS being looked at — the sign-up form opened straight at /signup?ref=… with an empty tab", () => {
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(storedReferralCode()).toBe(ADDRESS);
    // …also beside other parameters, in capitals, and over a kept code.
    setKept(KEPT, NOW - DAY);
    setAddress(`/signup?utm_source=friend&ref=${ADDRESS.toUpperCase()}&next=%2Fcreate`);
    expect(storedReferralCode()).toBe(ADDRESS);
    // A tab that holds a first touch WITHOUT a code does not hide the address.
    setTab({ referrer: "google.com", utmSource: "newsletter" });
    expect(storedReferralCode()).toBe(ADDRESS);
  });

  it("no code in the tab or on the address: the one the browser KEPT from an earlier visit", () => {
    setKept(KEPT, NOW - 12 * DAY);
    expect(storedReferralCode()).toBe(KEPT);
    setAddress("/signup?next=%2Fcreate");
    expect(storedReferralCode()).toBe(KEPT);
    // The last moment it counts.
    setKept(KEPT, NOW - 30 * DAY);
    expect(storedReferralCode()).toBe(KEPT);
  });

  it("a kept code past its 30 days is no code", () => {
    setKept(KEPT, NOW - 30 * DAY - 1);
    expect(storedReferralCode()).toBeUndefined();
    // …and the clock is read at the moment of asking.
    setKept(KEPT, NOW);
    expect(storedReferralCode()).toBe(KEPT);
    vi.setSystemTime(NOW + 30 * DAY + 1);
    expect(storedReferralCode()).toBeUndefined();
  });

  it("a value that is not a code is skipped at every step: the next store is asked", () => {
    setTab({ ref: "nope" });
    setAddress("/signup?ref=not-a-code");
    setKept(KEPT, NOW);
    expect(storedReferralCode()).toBe(KEPT);
    // An unreadable tab blob is no reason to lose the address.
    setTab("{not json");
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(storedReferralCode()).toBe(ADDRESS);
    // An unreadable kept value is nothing.
    setTab("{not json");
    setAddress("/signup");
    localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, "{not json");
    expect(storedReferralCode()).toBeUndefined();
  });

  it("never throws when the browser refuses storage — and each store stands for itself", () => {
    // The tab's store refused: the address still answers…
    vi.stubGlobal("sessionStorage", refusing());
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(storedReferralCode()).toBe(ADDRESS);
    // …and so does the kept code.
    setAddress("/signup");
    setKept(KEPT, NOW);
    expect(storedReferralCode()).toBe(KEPT);
    // Both refused, nothing on the address: none.
    vi.stubGlobal("localStorage", refusing());
    expect(() => storedReferralCode()).not.toThrow();
    expect(storedReferralCode()).toBeUndefined();
    // Both refused: the address alone.
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(storedReferralCode()).toBe(ADDRESS);
  });

  it("the tab's first touch still travels WITHOUT the code (storedAttribution), whatever is kept", () => {
    setTab({ referrer: "google.com", utmSource: "newsletter", ref: TAB });
    setKept(KEPT, NOW);
    expect(storedAttribution()).toEqual({ referrer: "google.com", utmSource: "newsletter" });
    sessionStorage.clear();
    expect(storedAttribution()).toEqual({});
  });
});

describe("referralCodeSource — did THIS visit follow a friend's link?", () => {
  it("nothing anywhere: null", () => {
    expect(referralCodeSource()).toBeNull();
    expect(storedReferralCode()).toBeUndefined();
  });

  it("\"link\": the tab holds a code", () => {
    setTab({ referrer: "reddit.com", ref: TAB });
    expect(referralCodeSource()).toBe("link");
  });

  it("\"link\": the address being looked at carries one (an empty tab — the capture has not stored it yet)", () => {
    setAddress(`/onboarding?next=%2Fcreate&ref=${ADDRESS}`);
    expect(referralCodeSource()).toBe("link");
    setAddress(`/signup?ref=${ADDRESS.toUpperCase()}`);
    expect(referralCodeSource()).toBe("link");
  });

  it("\"kept\": ONLY the browser's copy from an earlier visit holds one — to its last millisecond", () => {
    setKept(KEPT, NOW - 12 * DAY);
    expect(referralCodeSource()).toBe("kept");
    setKept(KEPT, NOW - 30 * DAY);
    expect(referralCodeSource()).toBe("kept");
    // A tab with a first touch and no code, an address with other parameters: still only kept.
    setTab({ referrer: "google.com", utmSource: "newsletter" });
    setAddress("/onboarding?next=%2Fcreate");
    expect(referralCodeSource()).toBe("kept");
  });

  it("a link of this visit outranks the kept copy: \"link\" with the tab's code, or the address's, beside a kept one", () => {
    setKept(KEPT, NOW - DAY);
    setTab({ ref: TAB });
    expect(referralCodeSource()).toBe("link");
    vi.stubGlobal("sessionStorage", memoryStorage());
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(referralCodeSource()).toBe("link");
    setAddress("/signup");
    expect(referralCodeSource()).toBe("kept");
  });

  it("a kept code past its 30 days is none; so is a value that is no code — in the tab, on the address or kept", () => {
    setKept(KEPT, NOW - 30 * DAY - 1);
    expect(referralCodeSource()).toBeNull();
    setTab({ ref: "nope" });
    setAddress("/signup?ref=not-a-code");
    localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, JSON.stringify({ code: "nope", at: NOW }));
    expect(referralCodeSource()).toBeNull();
    // Junk in the tab and on the address does not hide a real kept code — nor make it a "link".
    setKept(KEPT, NOW);
    expect(referralCodeSource()).toBe("kept");
  });

  it("agrees with storedReferralCode in every case: a source exactly when there is a code, and \"kept\" only when that code is the kept one", () => {
    const cases: Array<[string, () => void, "link" | "kept" | null, string | undefined]> = [
      ["none", () => {}, null, undefined],
      ["tab", () => setTab({ ref: TAB }), "link", TAB],
      ["address", () => setAddress(`/x?ref=${ADDRESS}`), "link", ADDRESS],
      ["kept", () => setKept(KEPT, NOW), "kept", KEPT],
      ["tab + kept", () => (setTab({ ref: TAB }), setKept(KEPT, NOW)), "link", TAB],
      ["address + kept", () => (setAddress(`/x?ref=${ADDRESS}`), setKept(KEPT, NOW)), "link", ADDRESS],
      ["all three", () => (setTab({ ref: TAB }), setAddress(`/x?ref=${ADDRESS}`), setKept(KEPT, NOW)), "link", TAB],
      ["expired kept", () => setKept(KEPT, NOW - 31 * DAY), null, undefined],
    ];
    for (const [name, arrange, source, code] of cases) {
      vi.stubGlobal("sessionStorage", memoryStorage());
      vi.stubGlobal("localStorage", memoryStorage());
      setAddress("/");
      arrange();
      expect(referralCodeSource(), name).toBe(source);
      expect(storedReferralCode(), name).toBe(code);
    }
  });

  it("never throws when the browser refuses storage: the address alone can still say \"link\"", () => {
    vi.stubGlobal("sessionStorage", refusing());
    vi.stubGlobal("localStorage", refusing());
    expect(() => referralCodeSource()).not.toThrow();
    expect(referralCodeSource()).toBeNull();
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(referralCodeSource()).toBe("link");
    // The tab's store refused, the browser's working: a kept code is "kept".
    vi.stubGlobal("localStorage", memoryStorage());
    setAddress("/signup");
    setKept(KEPT, NOW);
    expect(referralCodeSource()).toBe("kept");
  });

  it("forgetting the kept code leaves a visit with no link at null", () => {
    setKept(KEPT, NOW);
    forgetReferralCode();
    expect(referralCodeSource()).toBeNull();
  });
});

describe("keepReferralCode — the first link wins", () => {
  it("nothing kept: writes the code and the moment under the one key", () => {
    keepReferralCode(KEPT, NOW);
    expect(JSON.parse(keptRaw()!)).toEqual({ code: KEPT, at: NOW });
    expect(localStorage.length).toBe(1);
    // The tab's store is not its business.
    expect(sessionStorage.length).toBe(0);
    expect(storedReferralCode()).toBe(KEPT);
  });

  it("`now` defaults to the clock", () => {
    vi.setSystemTime(NOW + 5 * DAY);
    keepReferralCode(KEPT);
    expect(JSON.parse(keptRaw()!)).toEqual({ code: KEPT, at: NOW + 5 * DAY });
  });

  it("an unexpired code is kept as it is: a later link never replaces it, and the same link never renews its 30 days", () => {
    keepReferralCode(KEPT, NOW);
    const first = keptRaw();
    keepReferralCode(ADDRESS, NOW + DAY);
    expect(keptRaw()).toBe(first);
    keepReferralCode(KEPT, NOW + 29 * DAY);
    expect(keptRaw()).toBe(first);
    // Still the first on its last moment…
    keepReferralCode(ADDRESS, NOW + 30 * DAY);
    expect(keptRaw()).toBe(first);
    expect(keptReferralCode(keptRaw(), NOW + 30 * DAY)).toBe(KEPT);
  });

  it("an EXPIRED code is replaced by the link that arrives next", () => {
    keepReferralCode(KEPT, NOW);
    keepReferralCode(ADDRESS, NOW + 30 * DAY + 1);
    expect(JSON.parse(keptRaw()!)).toEqual({ code: ADDRESS, at: NOW + 30 * DAY + 1 });
  });

  it("a stored value that reads as no code (garbage, a wrong shape, one from the future) is replaced", () => {
    for (const junk of ["{not json", JSON.stringify({ code: "nope", at: NOW }), JSON.stringify({ code: KEPT }), referralCodeToKeep(KEPT, NOW + DAY)]) {
      localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, junk);
      keepReferralCode(ADDRESS, NOW);
      expect(JSON.parse(keptRaw()!), junk).toEqual({ code: ADDRESS, at: NOW });
    }
  });

  it("never throws when storage throws — on the read or on the write", () => {
    const refused = refusing();
    vi.stubGlobal("localStorage", refused);
    expect(() => keepReferralCode(KEPT, NOW)).not.toThrow();
    expect(refused.getItem).toHaveBeenCalled();
    // The read works and the WRITE is refused (a full or read-only store).
    const full = { ...refusing(), getItem: vi.fn(() => null) };
    vi.stubGlobal("localStorage", full);
    expect(() => keepReferralCode(KEPT, NOW)).not.toThrow();
    expect(full.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("forgetReferralCode", () => {
  it("removes the kept code and nothing else", () => {
    keepReferralCode(KEPT, NOW);
    localStorage.setItem("cardforge-other", "stays");
    setTab({ ref: TAB });
    forgetReferralCode();
    expect(keptRaw()).toBeNull();
    expect(localStorage.getItem("cardforge-other")).toBe("stays");
    // The tab's own copy is the tab's: it dies with the tab.
    expect(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)).not.toBeNull();
    // After it the next link is the first again.
    keepReferralCode(ADDRESS, NOW);
    expect(keptReferralCode(keptRaw(), NOW)).toBe(ADDRESS);
  });

  it("nothing kept, or storage that throws: no throw", () => {
    expect(() => forgetReferralCode()).not.toThrow();
    vi.stubGlobal("localStorage", refusing());
    expect(() => forgetReferralCode()).not.toThrow();
  });
});
