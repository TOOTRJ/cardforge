// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RETRY_AFTER_MS, RETRY_JITTER_MS, RenderImageRetry } from "@/components/cards/render-image-retry";

// ---------------------------------------------------------------------------
// 2026-11-10: storage was busy for 45 minutes and /render-cdn answered an
// error for some thumbnails. A browser never retries an <img>, so a page of
// deck tiles kept its alt text in black boxes until a reload — although the
// same address answered a second later. One listener in the root layout
// asks again, twice at most, for the same address.
// ---------------------------------------------------------------------------

const BAKE = "/render-cdn/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.thumb.webp?v=1793233282161";

function image(src: string): HTMLImageElement {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  img.setAttribute("alt", "Surge of the Shimmer");
  document.body.appendChild(img);
  return img;
}
/** The `src` values the page set on `img` from now on. */
function srcWrites(img: HTMLImageElement): string[] {
  const writes: string[] = [];
  const set = img.setAttribute.bind(img);
  img.setAttribute = (name: string, value: string) => {
    if (name === "src") writes.push(value);
    set(name, value);
  };
  return writes;
}
/** A load that ended in an error: the event does not bubble. */
const fail = (img: HTMLImageElement) => img.dispatchEvent(new Event("error", { bubbles: false }));
const longest = (attempt: number) => RETRY_AFTER_MS[attempt] + RETRY_JITTER_MS[attempt];
/** A load that ended well. */
const load = (img: HTMLImageElement) => img.dispatchEvent(new Event("load", { bubbles: false }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RenderImageRetry", () => {
  it("renders nothing", () => {
    const { container } = render(<RenderImageRetry />);
    expect(container.innerHTML).toBe("");
  });

  it("asks for a failed card picture again — the same address — after the first wait, not before", () => {
    render(<RenderImageRetry />);
    const img = image(BAKE);
    const writes = srcWrites(img);
    fail(img);
    vi.advanceTimersByTime(RETRY_AFTER_MS[0] - 1);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(RETRY_JITTER_MS[0] + 1);
    expect(writes).toEqual([BAKE]);
    expect(img.getAttribute("src")).toBe(BAKE);
  });

  it("tries twice more at most: after that the alt text stays, as before", () => {
    render(<RenderImageRetry />);
    const img = image(BAKE);
    const writes = srcWrites(img);
    fail(img);
    vi.advanceTimersByTime(longest(0));
    fail(img);
    vi.advanceTimersByTime(longest(1));
    expect(writes).toHaveLength(RETRY_AFTER_MS.length);
    fail(img);
    vi.advanceTimersByTime(60_000);
    expect(writes).toHaveLength(RETRY_AFTER_MS.length);
    expect(img.getAttribute("alt")).toBe("Surge of the Shimmer");
  });

  it("each picture has its own count, and a page of failures does not ask again in one burst", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.9);
    render(<RenderImageRetry />);
    const a = image(BAKE);
    const b = image(BAKE.replace("aaaaaaaa", "bbbbbbbb"));
    const aWrites = srcWrites(a);
    const bWrites = srcWrites(b);
    fail(a);
    fail(b);
    vi.advanceTimersByTime(RETRY_AFTER_MS[0]);
    expect([aWrites.length, bWrites.length]).toEqual([1, 0]);
    vi.advanceTimersByTime(RETRY_JITTER_MS[0]);
    expect([aWrites.length, bWrites.length]).toEqual([1, 1]);
    // The spread is wide on purpose: storage was busy, every try is a request to it.
    expect(RETRY_JITTER_MS[0]).toBeGreaterThanOrEqual(RETRY_AFTER_MS[0]);
    expect(RETRY_JITTER_MS[1]).toBeGreaterThanOrEqual(RETRY_AFTER_MS[1]);
    // …and never sooner than the route's `Retry-After: 5`.
    expect(RETRY_AFTER_MS[0]).toBeGreaterThanOrEqual(5_000);
    expect(RETRY_AFTER_MS[1]).toBeGreaterThan(RETRY_AFTER_MS[0]);
  });

  it("a picture that loaded starts again from none the next time it fails", () => {
    render(<RenderImageRetry />);
    const img = image(BAKE);
    const writes = srcWrites(img);
    fail(img);
    vi.advanceTimersByTime(longest(0));
    fail(img);
    vi.advanceTimersByTime(longest(1));
    expect(writes).toHaveLength(2);
    load(img);
    fail(img);
    vi.advanceTimersByTime(longest(0));
    expect(writes).toHaveLength(3);
  });

  it("an <img> given another address (the deck pop-up reuses one element) gets its own tries — and a pending try for the old one is dropped", () => {
    render(<RenderImageRetry />);
    const img = image(BAKE);
    const other = BAKE.replace("aaaaaaaa", "eeeeeeee");
    // Both tries spent on the first card.
    fail(img);
    vi.advanceTimersByTime(longest(0));
    fail(img);
    vi.advanceTimersByTime(longest(1));
    fail(img);
    // The pop-up moves on to another card, whose picture fails too.
    img.setAttribute("src", other);
    const writes = srcWrites(img);
    fail(img);
    vi.advanceTimersByTime(longest(0));
    expect(writes).toEqual([other]);

    // A try scheduled for an address the element no longer shows does nothing.
    fail(img);
    img.setAttribute("src", BAKE);
    writes.length = 0;
    vi.advanceTimersByTime(longest(1));
    expect(writes).toEqual([]);
  });

  it("leaves every other picture alone: art, avatars, real cards' scans", () => {
    render(<RenderImageRetry />);
    const others = ["https://auth.pipglyph.com/storage/v1/object/public/card-art/x/y.webp", "https://cards.scryfall.io/normal/front/a/b/c.jpg", "/defaults/avatar-01.webp"].map(image);
    const writes = others.map(srcWrites);
    for (const img of others) fail(img);
    vi.advanceTimersByTime(60_000);
    expect(writes).toEqual([[], [], []]);
  });

  it("finds a picture that failed before it mounted (the HTML's images load before React hydrates) — and not one still loading", () => {
    const broken = image(BAKE);
    Object.defineProperty(broken, "complete", { value: true });
    Object.defineProperty(broken, "naturalWidth", { value: 0 });
    const loaded = image(BAKE.replace("aaaaaaaa", "cccccccc"));
    Object.defineProperty(loaded, "complete", { value: true });
    Object.defineProperty(loaded, "naturalWidth", { value: 600 });
    const lazy = image(BAKE.replace("aaaaaaaa", "dddddddd"));
    Object.defineProperty(lazy, "complete", { value: false });
    Object.defineProperty(lazy, "naturalWidth", { value: 0 });
    const writes = [broken, loaded, lazy].map(srcWrites);
    render(<RenderImageRetry />);
    vi.advanceTimersByTime(longest(0));
    expect(writes.map((w) => w.length)).toEqual([1, 0, 0]);
  });

  it("drops a try for a picture that left the page, and every pending try when it unmounts", () => {
    const { unmount } = render(<RenderImageRetry />);
    const gone = image(BAKE);
    const goneWrites = srcWrites(gone);
    fail(gone);
    gone.remove();
    vi.advanceTimersByTime(longest(0));
    expect(goneWrites).toEqual([]);

    const pending = image(BAKE);
    const pendingWrites = srcWrites(pending);
    fail(pending);
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(pendingWrites).toEqual([]);
    // Unmounted: it no longer listens.
    fail(pending);
    vi.advanceTimersByTime(60_000);
    expect(pendingWrites).toEqual([]);
  });
});
