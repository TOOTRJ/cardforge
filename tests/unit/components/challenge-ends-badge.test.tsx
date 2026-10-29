// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ChallengeEndsBadge } from "@/components/layout/challenge-ends-badge";

// The Community panel's "Ends in N days" pill (TODO NV1): counted in the
// browser from the cached window, so a page built days ago still counts from
// today; nothing in the server HTML (no hydration mismatch); nothing once the
// window has closed.

const NOW = new Date("2026-10-29T12:00:00.000Z");
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChallengeEndsBadge", () => {
  it("counts the whole days left", () => {
    const { container } = render(<ChallengeEndsBadge startsAt={iso(-4)} endsAt={iso(2.5)} />);
    expect(container.textContent).toBe("Ends in 3 days");
  });

  it("says Last day under a day", () => {
    const { container } = render(<ChallengeEndsBadge startsAt={iso(-4)} endsAt={iso(0.25)} />);
    expect(container.textContent).toBe("Last day");
  });

  it("shows nothing once the window has closed, or before it opens", () => {
    expect(render(<ChallengeEndsBadge startsAt={iso(-9)} endsAt={iso(-1)} />).container.textContent).toBe("");
    cleanup();
    expect(render(<ChallengeEndsBadge startsAt={iso(1)} endsAt={iso(8)} />).container.textContent).toBe("");
  });

  it("prints nothing on the server", () => {
    expect(renderToString(<ChallengeEndsBadge startsAt={iso(-4)} endsAt={iso(2.5)} />)).toBe("");
  });
});
