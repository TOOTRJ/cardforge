// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// TODO 7.4 — the admin dashboard tile: verification progress (and which
// templates to re-verify), the automatic re-bake's state, owed count and
// poison COUNT, and the 30-day frame-request demand, each linking to its
// admin page. A server component with no client JS.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminOpsTile } from "@/components/admin/ops-tile";
import {
  summariseFrameVerification,
  type AdminOpsSummary,
  type RebakeTileSummary,
  type VerificationReview,
} from "@/lib/admin/ops-summary";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { describeFrame, eraGroupFrameLabel } from "@/lib/creator/frame-resolve";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

afterEach(cleanup);

const NOW = Date.parse("2026-09-29T12:00:00.000Z");
const tick: VerificationReview = { verified: true, verifiedLayoutVersion: CARD_LAYOUT_VERSION, verifiedOverrideHash: "none", scoreJson: { overall: 12 } };
const staleTick: VerificationReview = { ...tick, verifiedOverrideHash: "deadbeef", scoreJson: null };

const frames = summariseFrameVerification(
  new Map<string, VerificationReview>([
    ["m15/w", tick],
    ["m15/u", tick],
    ["m15/b", staleTick],
    ["retro/w", staleTick],
  ]),
  {},
);

const rebake = (patch: Partial<RebakeTileSummary> = {}): RebakeTileSummary => ({
  status: "idle",
  runner: null,
  owed: 12,
  poisoned: 0,
  pausedReason: null,
  pausedAt: null,
  lastRun: { finishedAt: "2026-09-29T11:55:00.000Z", rebaked: 20, failed: 1 },
  layoutVersion: 34,
  sweepVersion: 34,
  billingEnabled: true,
  error: null,
  ...patch,
});

const summary = (patch: Partial<AdminOpsSummary> = {}): AdminOpsSummary => ({
  frames,
  rebake: rebake(),
  requests: {
    window: "30",
    requests: 14,
    missing: 3,
    unverified: 1,
    top: [
      { signature: "showcase-a", label: "Showcase frame", setCode: "mkm", cause: "missing", users: 5, count: 8 },
      { signature: "borderless-b", label: "Borderless", setCode: null, cause: "unverified", users: 1, count: 1 },
    ],
    error: null,
  },
  readAt: NOW,
  ...patch,
});

describe("AdminOpsTile", () => {
  it("summarises verification like the checklist header and links the templates to re-verify", () => {
    render(<AdminOpsTile summary={summary()} />);
    const section = screen.getByTestId("admin-ops-frames");
    const combos = FRAME_TEMPLATE_VALUES.length * 7;
    expect(section.textContent).toContain(`4/${combos}`);
    expect(screen.getByTestId("admin-ops-frames-current").textContent).toBe("2 verified and current");
    expect(screen.getByTestId("admin-ops-frames-stale").textContent).toBe("2 need re-verification");
    expect(screen.getByTestId("admin-ops-frames-unverified").textContent).toBe(`${combos - 4} unverified`);
    expect(within(section).getByRole("link", { name: /Checklist/ }).getAttribute("href")).toBe("/admin/frame-compare");
    const chips = within(screen.getByTestId("admin-ops-reverify")).getAllByRole("link");
    expect(chips.map((a) => a.getAttribute("href")).sort()).toEqual([
      "/admin/frame-compare?template=m15",
      "/admin/frame-compare?template=retro",
    ]);
    // Outside the era groups the chip names its era: "M15 (2015) Standard".
    expect(chips.map((a) => a.textContent)).toContain(`${describeFrame("m15")} · 1`);
  });

  it("lists every template with its counts and worst recorded match", () => {
    render(<AdminOpsTile summary={summary()} />);
    const table = screen.getByTestId("admin-ops-templates");
    expect(table.querySelectorAll("tr[data-template]")).toHaveLength(FRAME_TEMPLATE_VALUES.length);
    const m15 = table.querySelector('tr[data-template="m15"]')!;
    expect([...m15.querySelectorAll("td")].map((td) => td.textContent)).toEqual([eraGroupFrameLabel("m15"), "3/7", "1", "4", "88%"]);
    expect(screen.getByTestId("admin-ops-frames-low-match").textContent).toBe(" 2 ticks scored under a 90% frame match.");
    expect(m15.querySelector("a")!.getAttribute("href")).toBe("/admin/frame-compare?template=m15");
    const untouched = table.querySelector('tr[data-template="retro"]')!;
    expect(untouched.querySelectorAll("td")[4].textContent).toBe("—");
  });

  it("shows an idle sweep's owed count, last run and poison count, linking /admin/renders", () => {
    render(<AdminOpsTile summary={summary()} />);
    const section = screen.getByTestId("admin-ops-rebake");
    expect(screen.getByTestId("admin-ops-rebake-status").textContent).toBe("Idle");
    expect(section.textContent).toContain("12cards owed a re-bake");
    expect(section.textContent).toContain("Last run 5m ago: 20 re-baked · 1 failed.");
    expect(screen.getByTestId("admin-ops-rebake-poison").textContent).toBe("No card keeps failing.");
    expect(within(section).getByRole("link", { name: /Status/ }).getAttribute("href")).toBe("/admin/renders");
  });

  it("says Running (manual), Paused with its reason, poisoned cards and a billing-off deployment", () => {
    const { unmount } = render(<AdminOpsTile summary={summary({ rebake: rebake({ status: "running", runner: "manual" }) })} />);
    expect(screen.getByTestId("admin-ops-rebake-status").textContent).toBe("Running · manual");
    unmount();

    render(
      <AdminOpsTile
        summary={summary({
          rebake: rebake({
            status: "paused",
            pausedReason: "a whole batch failed",
            pausedAt: "2026-09-29T11:00:00.000Z",
            poisoned: 2,
            owed: null,
            lastRun: null,
            billingEnabled: false,
          }),
        })}
      />,
    );
    expect(screen.getByTestId("admin-ops-rebake-status").textContent).toBe("Paused");
    expect(screen.getByTestId("admin-ops-rebake-paused").textContent).toBe("Paused 1h ago:a whole batch failed");
    expect(screen.getByTestId("admin-ops-rebake-poison").textContent).toBe("2 cards keep failing");
    const section = screen.getByTestId("admin-ops-rebake");
    expect(section.textContent).toContain("—cards owed a re-bake");
    expect(section.textContent).toContain("No automatic run yet.");
    expect(section.textContent).toContain("Billing is off on this deployment");
  });

  it("shows the 30-day demand and its most-wanted frames, linking /admin/frame-requests", () => {
    render(<AdminOpsTile summary={summary()} />);
    const section = screen.getByTestId("admin-ops-requests");
    expect(section.textContent).toContain("14imports in the last 30 days");
    expect(section.textContent).toContain("3 frames to build · 1 frame to verify");
    const items = within(screen.getByTestId("admin-ops-requests-top")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Showcase frame (MKM)5 users · 8build",
      "Borderless1 user · 1verify",
    ]);
    expect(within(section).getByRole("link", { name: /All requests/ }).getAttribute("href")).toBe("/admin/frame-requests");
  });

  it("surfaces a read error instead of a silent zero", () => {
    render(
      <AdminOpsTile
        summary={summary({
          rebake: rebake({ error: "The admin key isn't configured on this deployment.", owed: null }),
          requests: { window: "30", requests: 0, missing: 0, unverified: 0, top: [], error: "Couldn't read the request log." },
        })}
      />,
    );
    expect(screen.getByTestId("admin-ops-rebake").textContent).toContain("The admin key isn't configured on this deployment.");
    expect(screen.getByTestId("admin-ops-requests").textContent).toContain("Couldn't read the request log.");
    expect(screen.getByTestId("admin-ops-requests").textContent).toContain("No open requests.");
  });

  it("is a server component (no client bundle)", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../components/admin/ops-tile.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});
