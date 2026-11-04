// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { CardViewBeacon } from "@/components/cards/card-view-beacon";

// ---------------------------------------------------------------------------
// The card page's view ping (TODO CP4): ONE POST when the page shows a card —
// never again on a re-render (a like or a comment refreshes the page under
// it), once under StrictMode's double effect, again only for ANOTHER card.
// Without sendBeacon (or when it refuses), a keepalive fetch.
// ---------------------------------------------------------------------------

const A = "c0000000-0000-4000-a000-000000000001";
const B = "c0000000-0000-4000-a000-000000000002";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CardViewBeacon", () => {
  it("pings once per card, whatever re-renders it", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon });
    const view = render(
      <StrictMode>
        <CardViewBeacon cardId={A} />
      </StrictMode>,
    );
    view.rerender(
      <StrictMode>
        <CardViewBeacon cardId={A} />
      </StrictMode>,
    );
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith(`/api/cards/${A}/view`);
    view.rerender(
      <StrictMode>
        <CardViewBeacon cardId={B} />
      </StrictMode>,
    );
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(view.container.innerHTML).toBe("");
  });

  it("falls back to a keepalive POST", () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: undefined });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CardViewBeacon cardId={A} />);
    expect(fetchMock).toHaveBeenCalledWith(`/api/cards/${A}/view`, expect.objectContaining({ method: "POST", keepalive: true }));
  });
});
