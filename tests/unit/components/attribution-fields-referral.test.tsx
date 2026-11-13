// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  ATTRIBUTION_FIELDS,
  ATTRIBUTION_STORAGE_KEY,
  REFERRAL_CODE_STORAGE_KEY,
  keptReferralCode,
  referralCodeToKeep,
} from "@/lib/analytics/attribution";
import { AttributionFields } from "@/components/analytics/attribution-fields";
import { AttributionCapture } from "@/components/analytics/attribution-capture";

// ---------------------------------------------------------------------------
// The sign-up form's hidden fields and the friend's referral code (owner
// 2026-11-11: "fix the places a friend's ?ref=<code> was lost").
//
// THE BUG: a sign-up form opened straight at `/signup?ref=<code>` posted NO
// code. The fields' effect read the tab's attribution from sessionStorage —
// which the root layout's AttributionCapture writes in an effect that runs
// AFTER the page's own effects — so on that first render the tab was still
// empty and `attr_ref` stayed "".
//
// Now `attr_ref` is the tab's code, ELSE storedReferralCode(): the code on
// the address being looked at, else the one the browser kept from an earlier
// visit (30 days). Every other hidden field is what it was: the tab's
// first-touch value, or empty.
//
// The capture's side of it: a landing with a valid `?ref=` is ALSO kept in
// the browser past the tab — even when the tab already holds another code
// (the tab's own first code is left alone).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const TAB = "aaaa1111";
const ADDRESS = "bbbb2222";
const KEPT = "cccc3333";

/** In-memory Web Storage, one per test (Node's own flag-less localStorage
 *  shadows happy-dom's and has no working methods). */
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

const setTab = (value: unknown) => sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
const tab = () => JSON.parse(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
const setAddress = (path: string) => window.history.replaceState(null, "", path);
const setKept = (code: string, at: number) => localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, referralCodeToKeep(code, at));
const kept = () => keptReferralCode(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY), Date.now());

/** Every hidden field the form would post, by its name. */
const posted = (container: HTMLElement) =>
  Object.fromEntries([...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((input) => [input.name, input.value]));
const EMPTY = Object.fromEntries(Object.values(ATTRIBUTION_FIELDS).map((name) => [name, ""]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
  setAddress("/signup");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setAddress("/");
});

describe("AttributionFields — attr_ref", () => {
  it("THE BUG: opened straight at /signup?ref=<code> with an EMPTY tab, the form posts the code", () => {
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(sessionStorage.length).toBe(0);
    const { container } = render(<AttributionFields />);
    expect(posted(container)).toEqual({ ...EMPTY, attr_ref: ADDRESS });
    // Reading the address wrote nothing: the capture is what stores.
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("the same in the page's real order — the form's effect runs BEFORE the layout's capture has stored anything", () => {
    setAddress(`/signup?utm_source=friend&ref=${ADDRESS.toUpperCase()}`);
    const { container } = render(
      <>
        <main>
          <form>
            <AttributionFields />
          </form>
        </main>
        <AttributionCapture />
      </>,
    );
    // The code was on the address alone when the fields were filled.
    expect(posted(container).attr_ref).toBe(ADDRESS);
    // …and the capture then stored it for the tab and kept it for the browser.
    expect(tab()).toEqual({ utmSource: "friend", ref: ADDRESS });
    expect(kept()).toBe(ADDRESS);
  });

  it("a visit with ONLY a code the browser kept (a new tab, days later, no ?ref=): the form posts it", () => {
    setKept(KEPT, NOW - 12 * DAY);
    const { container } = render(<AttributionFields />);
    expect(posted(container)).toEqual({ ...EMPTY, attr_ref: KEPT });
  });

  it("a kept code past its 30 days is not posted; on its last moment it is", () => {
    setKept(KEPT, NOW - 30 * DAY - 1);
    expect(posted(render(<AttributionFields />).container)).toEqual(EMPTY);
    cleanup();
    setKept(KEPT, NOW - 30 * DAY);
    expect(posted(render(<AttributionFields />).container).attr_ref).toBe(KEPT);
  });

  it("the TAB's own code wins over the address and the kept one", () => {
    setTab({ referrer: "reddit.com", ref: TAB });
    setAddress(`/signup?ref=${ADDRESS}`);
    setKept(KEPT, NOW - DAY);
    const { container } = render(<AttributionFields />);
    expect(posted(container)).toEqual({ ...EMPTY, attr_referrer: "reddit.com", attr_ref: TAB });
  });

  it("the address wins over the kept code when the tab holds none", () => {
    setKept(KEPT, NOW - DAY);
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(posted(render(<AttributionFields />).container).attr_ref).toBe(ADDRESS);
  });

  it("a tab with a first touch and NO code: its fields are posted as they were, and the code comes from the address", () => {
    setTab({ referrer: "google.com", utmSource: "newsletter", utmMedium: "email", utmCampaign: "launch", surface: "home_hero" });
    setAddress(`/signup?ref=${ADDRESS}`);
    const { container } = render(<AttributionFields />);
    expect(posted(container)).toEqual({
      attr_referrer: "google.com",
      attr_utm_source: "newsletter",
      attr_utm_medium: "email",
      attr_utm_campaign: "launch",
      attr_surface: "home_hero",
      attr_ref: ADDRESS,
    });
  });

  it("the address gives the CODE alone — its utm parameters never fill the other fields here (the tab's first touch does)", () => {
    setAddress(`/signup?utm_source=late&utm_medium=x&utm_campaign=y&ref=${ADDRESS}`);
    expect(posted(render(<AttributionFields />).container)).toEqual({ ...EMPTY, attr_ref: ADDRESS });
  });

  it("no code anywhere: attr_ref is empty and the other fields are the tab's, as before", () => {
    expect(posted(render(<AttributionFields />).container)).toEqual(EMPTY);
    cleanup();
    setTab({ referrer: "google.com", utmSource: "newsletter" });
    expect(posted(render(<AttributionFields />).container)).toEqual({ ...EMPTY, attr_referrer: "google.com", attr_utm_source: "newsletter" });
  });

  it("a value that is not a code is never posted — on the address, in the tab or in the kept store", () => {
    setAddress("/signup?ref=%3Cscript%3E");
    setTab({ ref: "nope" });
    localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, JSON.stringify({ code: "javascript:alert(1)", at: NOW }));
    expect(posted(render(<AttributionFields />).container)).toEqual(EMPTY);
    cleanup();
    // …and a junk tab value does not hide a real code on the address.
    setAddress(`/signup?ref=${ADDRESS}`);
    expect(posted(render(<AttributionFields />).container).attr_ref).toBe(ADDRESS);
  });

  it("the form posts one hidden input per attribution field, by the names the sign-up action reads", () => {
    const { container } = render(<AttributionFields />);
    expect(Object.keys(posted(container)).sort()).toEqual(Object.values(ATTRIBUTION_FIELDS).sort());
    expect(ATTRIBUTION_FIELDS.ref).toBe("attr_ref");
  });

  it("storage the browser refuses: no throw, the other fields empty — and the code on the address is still posted", () => {
    vi.stubGlobal("sessionStorage", refusing());
    vi.stubGlobal("localStorage", refusing());
    setAddress(`/signup?ref=${ADDRESS}`);
    const { container } = render(<AttributionFields />);
    expect(posted(container)).toEqual({ ...EMPTY, attr_ref: ADDRESS });
    cleanup();
    setAddress("/signup");
    expect(posted(render(<AttributionFields />).container)).toEqual(EMPTY);
  });

  it("an unreadable tab blob: the other fields empty, the code from the address or the kept store", () => {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, "{not json");
    setKept(KEPT, NOW);
    expect(posted(render(<AttributionFields />).container)).toEqual({ ...EMPTY, attr_ref: KEPT });
  });
});

describe("AttributionCapture — a landing's code is kept past the tab", () => {
  it("a landing with a valid ?ref=: the tab's blob holds it AND the browser keeps the code and the moment", () => {
    setAddress(`/?ref=${ADDRESS}&utm_source=friend`);
    render(<AttributionCapture />);
    expect(tab()).toEqual({ utmSource: "friend", ref: ADDRESS });
    expect(JSON.parse(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)!)).toEqual({ code: ADDRESS, at: NOW });
    // The code and the day alone — no first touch, no address, nothing else kept.
    expect(localStorage.length).toBe(1);
  });

  it("the tab ALREADY holds another code: the tab's first code is unchanged, and this landing's code is still kept for the browser", () => {
    setTab({ referrer: "google.com", ref: TAB });
    const before = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    setAddress(`/card/kesh/ember-sphinx?via=copy&ref=${ADDRESS}`);
    render(<AttributionCapture />);
    expect(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBe(before);
    expect(kept()).toBe(ADDRESS);
  });

  it("the browser already keeps an unexpired code: the first link wins there — the tab takes this landing's code", () => {
    setKept(KEPT, NOW - 3 * DAY);
    const before = localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
    setAddress(`/?ref=${ADDRESS}`);
    render(<AttributionCapture />);
    expect(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)).toBe(before);
    expect(tab()).toEqual({ ref: ADDRESS });
  });

  it("an expired kept code is replaced by this landing's", () => {
    setKept(KEPT, NOW - 31 * DAY);
    setAddress(`/?ref=${ADDRESS}`);
    render(<AttributionCapture />);
    expect(JSON.parse(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)!)).toEqual({ code: ADDRESS, at: NOW });
  });

  it("a landing with no code, or a value that is not one: nothing is kept", () => {
    for (const path of ["/", "/?utm_source=newsletter", "/?ref=nope", "/?ref=", "/?ref=%3Cscript%3E", "/?xref=bbbb2222"]) {
      vi.stubGlobal("sessionStorage", memoryStorage());
      vi.stubGlobal("localStorage", memoryStorage());
      setAddress(path);
      render(<AttributionCapture />);
      expect(localStorage.length, path).toBe(0);
      expect(tab()?.ref, path).toBeUndefined();
      cleanup();
    }
  });

  it("a landing without a code never forgets a kept one", () => {
    setKept(KEPT, NOW - DAY);
    setAddress("/gallery");
    render(<AttributionCapture />);
    expect(kept()).toBe(KEPT);
  });

  it("the tab's store refuses the WRITE: the code is still kept for a later visit, and nothing throws", () => {
    const readOnly = { ...refusing(), getItem: vi.fn(() => null) };
    vi.stubGlobal("sessionStorage", readOnly);
    setAddress(`/?ref=${ADDRESS}`);
    expect(() => render(<AttributionCapture />)).not.toThrow();
    expect(readOnly.setItem).toHaveBeenCalledTimes(1);
    expect(kept()).toBe(ADDRESS);
  });

  it("the browser's store refused: no throw, and the tab still holds the code", () => {
    vi.stubGlobal("localStorage", refusing());
    setAddress(`/?ref=${ADDRESS}`);
    expect(() => render(<AttributionCapture />)).not.toThrow();
    expect(tab()).toEqual({ ref: ADDRESS });
  });
});
