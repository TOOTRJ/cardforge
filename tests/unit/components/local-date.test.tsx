// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

// ---------------------------------------------------------------------------
// <LocalDate>: a billing instant printed as a day of the VIEWER's calendar.
//
// The example is the one a subscriber reported: a period ending
// 2026-11-08T02:31:04Z. Stripe's portal says "November 7" in the Americas;
// the app formatted in UTC and said "November 8".
//
// This file runs as a viewer in Los Angeles (the rest of the suite is pinned
// to UTC in vitest.config.ts); the SERVER's render is always UTC, whatever
// zone the process is in.
// ---------------------------------------------------------------------------

process.env.TZ = "America/Los_Angeles";

import { LocalDate, LocalDateText, useLocalDateText } from "@/components/ui/local-date";
import { planEndingShortText, planEndingText } from "@/lib/billing/plan-ending";
import { resumeConfirmText } from "@/components/billing/resume-plan-button";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({
  createPortalSessionAction: vi.fn(),
  resumeSubscriptionAction: vi.fn(),
  getResumePreviewAction: vi.fn(),
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));

const ENDS = "2026-11-08T02:31:04.000Z";

beforeAll(() => {
  // The premise of every test below.
  expect(new Date(ENDS).getDate()).toBe(7);
  expect(new Date(ENDS).getUTCDate()).toBe(8);
});
afterEach(cleanup);

describe("LocalDate", () => {
  it("the SERVER render is the UTC date inside <time dateTime>, whatever zone the server runs in", () => {
    const html = renderToString(<LocalDate iso={ENDS} />);
    expect(html).toContain(`dateTime="${ENDS}"`);
    expect(html).toMatch(/<time[^>]*>November 8, 2026<\/time>/);
    expect(renderToString(<LocalDate iso={ENDS} format="short" />)).toMatch(/>Nov 8, 2026<\/time>/);
  });

  it("in the browser it is the viewer's own day — the one Stripe's portal shows", () => {
    render(<LocalDate iso={ENDS} />);
    const time = screen.getByText("November 7, 2026");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("datetime")).toBe(ENDS);
  });

  it("hydration: UTC first (matching the server's HTML), the viewer's day right after — same format, no mismatch reported", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(
      <p>
        Renews on <LocalDate iso={ENDS} />.
      </p>,
    );
    expect(container.textContent).toBe("Renews on November 8, 2026.");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <p>
          Renews on <LocalDate iso={ENDS} />.
        </p>,
      );
    });
    expect(container.textContent).toBe("Renews on November 7, 2026.");
    expect(container.querySelectorAll("time")).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    root?.unmount();
    container.remove();
    errors.mockRestore();
  });

  it("short and long keep their shapes; a value that isn't a date is printed as it is", () => {
    render(
      <>
        <LocalDate iso={ENDS} format="short" />
        <LocalDate iso="soon" />
      </>,
    );
    expect(screen.getByText("Nov 7, 2026")).toBeTruthy();
    expect(screen.getByText("soon")).toBeTruthy();
  });

  it("a date that is the same day in both zones does not change", () => {
    render(<LocalDate iso="2026-10-23T18:00:00.000Z" />);
    expect(screen.getByText("October 23, 2026")).toBeTruthy();
  });
});

describe("LocalDateText — one sentence, the viewer's dates", () => {
  const ending = { kind: "plan" as const, endsAt: ENDS, billedBeforeAt: null, canceledAt: null };

  it("the plan-ending sentence: server UTC, browser local, each date a <time>", () => {
    const parts = planEndingText(ending, "Pro");
    expect(renderToString(<p><LocalDateText parts={parts} /></p>).replace(/<[^>]+>/g, "")).toBe(
      "Your Pro plan was cancelled and ends on November 8, 2026. You keep Pro until then.",
    );
    const { container } = render(<p><LocalDateText parts={parts} /></p>);
    expect(container.textContent).toBe(
      "Your Pro plan was cancelled and ends on November 7, 2026. You keep Pro until then.",
    );
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(ENDS);
  });

  it("a later end date: BOTH dates are the viewer's", () => {
    const later = { ...ending, endsAt: "2026-12-08T02:31:04.000Z", billedBeforeAt: ENDS };
    const { container } = render(<p><LocalDateText parts={planEndingText(later, "Pro")} /></p>);
    expect(container.textContent).toBe(
      "Your Pro plan is set to end on December 7, 2026. It is still billed as usual until then — next on November 7, 2026.",
    );
    expect(container.querySelectorAll("time")).toHaveLength(2);
  });

  it("the badge / menu short form and the Resume confirm", () => {
    const { container } = render(
      <>
        <p data-testid="short"><LocalDateText parts={planEndingShortText(ending)} /></p>
        <p data-testid="resume">
          <LocalDateText
            parts={resumeConfirmText("Pro", {
              ok: true,
              planName: "Pro",
              trial: false,
              nextBillAt: ENDS,
              priceLine: "$15 / month",
            } as never)}
          />
        </p>
      </>,
    );
    expect(container.querySelector('[data-testid="short"]')?.textContent).toBe("ends Nov 7, 2026");
    expect(container.querySelector('[data-testid="resume"]')?.textContent).toBe(
      "Your Pro plan will renew on November 7, 2026 at $15 / month. Nothing is charged today.",
    );
  });

  it("useLocalDateText: the same sentence as one string (a label that cannot hold elements)", () => {
    function Label() {
      return <a aria-label={useLocalDateText(["Billing · Pro ", ...planEndingShortText(ending)])} href="/x">x</a>;
    }
    expect(renderToString(<Label />)).toContain('aria-label="Billing · Pro ends Nov 8, 2026"');
    render(<Label />);
    expect(screen.getByRole("link", { name: "Billing · Pro ends Nov 7, 2026" })).toBeTruthy();
  });
});
