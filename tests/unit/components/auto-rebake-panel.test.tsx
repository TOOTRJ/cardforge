// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// /admin/renders — the automatic re-bake panel: every way a run can stop has
// a label, a hung / dead run lists the cards of its batch, a paused sweep
// says why and offers Resume, and the poison list links its cards.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/cards/auto-rebake-actions", () => ({
  pauseAutoRebakeAction: vi.fn(),
  resumeAutoRebakeAction: vi.fn(),
  retryPoisonedCardsAction: vi.fn(),
}));

import { AutoRebakePanel } from "@/components/admin/auto-rebake-panel";
import {
  EMPTY_AUTO_REBAKE_STATE,
  type AutoRebakeRunSummary,
  type AutoRebakeStop,
} from "@/lib/cards/auto-rebake-state";
import type { AutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";

afterEach(cleanup);

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";

const run = (stop: AutoRebakeStop, extra: Partial<AutoRebakeRunSummary> = {}): AutoRebakeRunSummary => ({
  startedAt: "2026-09-28T11:50:00.000Z",
  finishedAt: "2026-09-28T11:54:00.000Z",
  durationMs: 240_000,
  layoutVersion: 32,
  batches: 3,
  rebaked: 20,
  stamped: 1,
  failed: 0,
  superseded: 0,
  remaining: 4,
  stop,
  ...extra,
});

const overview = (patch: Partial<AutoRebakeOverview["state"]> = {}, rest: Partial<AutoRebakeOverview> = {}): AutoRebakeOverview => ({
  state: { ...EMPTY_AUTO_REBAKE_STATE, ...patch },
  pending: 12,
  layoutVersion: 32,
  sweepVersion: 32,
  billingEnabled: true,
  poisonCards: [],
  error: null,
  readAt: NOW,
  ...rest,
});

const STOPS: AutoRebakeStop[] = [
  "done", "budget", "yield", "paused", "lease-lost", "breaker", "hung", "overrun", "crashed", "error", "refused",
];

describe("AutoRebakePanel", () => {
  it("labels every way a run can stop (never the raw code)", () => {
    for (const stop of STOPS) {
      const { unmount } = render(<AutoRebakePanel overview={overview({ lastRun: run(stop) })} nowMs={NOW} />);
      const block = screen.getByTestId("auto-rebake-last-run");
      // A missing label would print the bare code as its own sentence.
      const sentences = [...block.querySelectorAll("p")].map((p) => p.textContent);
      expect(sentences, stop).not.toContain(`${stop}.`);
      expect(sentences.some((s) => (s ?? "").length > 15), stop).toBe(true);
      unmount();
    }
  });

  it("a dead run names its batch; a paused sweep says why and offers Resume", () => {
    render(
      <AutoRebakePanel
        overview={overview({
          paused: true,
          pausedReason: "2 automatic runs in a row died before finishing",
          pausedAt: "2026-09-28T11:55:00.000Z",
          lastRun: run("crashed", { crashes: 2, suspects: [ID], rebaked: 0 }),
        })}
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId("auto-rebake-status").textContent).toMatch(/Paused/);
    expect(screen.getByText(/2 automatic runs in a row died before finishing\./)).toBeTruthy();
    expect(screen.getByTestId("auto-rebake-last-run").textContent).toMatch(/Cards in the batch that died:.*11111111/);
    expect(screen.getByTestId("auto-rebake-resume")).toBeTruthy();
  });

  it("lists poisoned cards with a link and a Retry button", () => {
    render(
      <AutoRebakePanel
        overview={overview(
          {},
          {
            poisonCards: [
              { id: ID, error: "Art unavailable", failures: 3, at: "2026-09-28T11:00:00.000Z", title: "Gravebloom Shade", href: "/card/x", visibility: "public" },
            ],
          },
        )}
        nowMs={NOW}
      />,
    );
    const link = screen.getByRole("link", { name: "Gravebloom Shade" });
    expect(link.getAttribute("href")).toBe("/card/x");
    expect(screen.getByTestId("auto-rebake-retry").textContent).toMatch(/Retry this card/);
    expect(screen.getByTestId("auto-rebake-pause")).toBeTruthy();
  });
});
