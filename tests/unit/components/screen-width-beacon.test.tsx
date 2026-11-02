// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO WD9's beacon: once per tab session, the viewport's width BUCKET goes
// to /api/events — the body is the event name and the bucket, nothing else;
// never GA4 or Vercel Analytics; never under automation; a prerendered page
// waits until it is shown.
// ---------------------------------------------------------------------------

const thirdParty = vi.hoisted(() => ({ track: vi.fn(), ga: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: thirdParty.track }));
vi.mock("@next/third-parties/google", () => ({ sendGAEvent: thirdParty.ga }));

import { ScreenWidthBeacon } from "@/components/analytics/screen-width-beacon";
import { SCREEN_WIDTH_STORAGE_KEY } from "@/lib/analytics/screen-width";

const beacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);

function setWidth(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true });
}
function setFlag(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value, configurable: true });
}

async function sentBodies(): Promise<unknown[]> {
  return Promise.all(beacon.mock.calls.map(async ([, blob]) => JSON.parse(await blob.text())));
}

beforeEach(() => {
  sessionStorage.clear();
  beacon.mockClear();
  thirdParty.track.mockClear();
  thirdParty.ga.mockClear();
  setFlag(navigator, "sendBeacon", beacon);
  setFlag(navigator, "webdriver", false);
  setFlag(document, "prerendering", false);
  setWidth(1440);
});
afterEach(cleanup);

describe("ScreenWidthBeacon", () => {
  it("posts the bucket alone to /api/events — no width, no identifier, no third party", async () => {
    render(<ScreenWidthBeacon />);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("/api/events");
    expect(await sentBodies()).toEqual([{ event: "screen_width", props: { bucket: "1366-1535" } }]);
    expect(JSON.stringify(await sentBodies())).not.toContain("1440");
    expect(thirdParty.track).not.toHaveBeenCalled();
    expect(thirdParty.ga).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SCREEN_WIDTH_STORAGE_KEY)).toBe("1");
  });

  it("counts a tab session once: a remount or a reload sends nothing more", () => {
    const first = render(<ScreenWidthBeacon />);
    first.unmount();
    setWidth(390);
    render(<ScreenWidthBeacon />);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("sends nothing under automation (navigator.webdriver)", () => {
    setFlag(navigator, "webdriver", true);
    render(<ScreenWidthBeacon />);
    expect(beacon).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(SCREEN_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it("a prerendered page waits until it is shown, then counts once", async () => {
    setFlag(document, "prerendering", true);
    render(<ScreenWidthBeacon />);
    expect(beacon).not.toHaveBeenCalled();
    setFlag(document, "prerendering", false);
    setWidth(2560);
    document.dispatchEvent(new Event("prerenderingchange"));
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(await sentBodies()).toEqual([{ event: "screen_width", props: { bucket: "2560-up" } }]);
  });

  it("a prerender that is thrown away counts nothing", () => {
    setFlag(document, "prerendering", true);
    const view = render(<ScreenWidthBeacon />);
    view.unmount();
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(beacon).not.toHaveBeenCalled();
  });
});
