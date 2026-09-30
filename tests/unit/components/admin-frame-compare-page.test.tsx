// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// /admin/frame-compare's compare mode (?template=&color=) builds its render
// from the reference printing, looked up on Scryfall at request time. A
// lookup that THROWS — Scryfall unreachable, a reset connection; a 404
// answers null — must not error the page: it falls back to the combo's
// sample content and says "Reference lookup failed", the way the sign-off's
// side-by-side does (TODO 0.18 follow-up). Only the page's data sources and
// its client islands are stubbed; the registry, the header and the
// verification state are real.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: "admin-1", is_admin: true }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => false,
  createAdminClient: () => {
    throw new Error("not in this test");
  },
}));
vi.mock("@/lib/cards/rebake-batch", () => ({ countMarkedRenders: async () => 0 }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: async () => new Map() }));
vi.mock("@/lib/cards/frame-review-events", () => ({ listFrameReviewEvents: async () => [] }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/cards/frame-preview-cards", () => ({ listFramePreviewCards: async () => [] }));
const payloads = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("@/lib/scryfall/reference-preview", () => ({ buildFrameComparePayload: payloads.build }));

// Client islands and panels: what the page hands them is what matters.
vi.mock("@/components/layout/dashboard-shell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/admin/frame-compare", () => ({
  FrameCompare: (props: { preview: { title?: string }; scanUrl: string | null }) => (
    <div data-testid="frame-compare" data-scan={props.scanUrl ?? "none"}>
      {props.preview.title}
    </div>
  ),
}));
vi.mock("@/components/admin/frame-review-checklist", () => ({ FrameReviewChecklist: () => null }));
vi.mock("@/components/admin/frame-verify-checkbox", () => ({ FrameVerifyCheckbox: () => null }));
vi.mock("@/components/admin/frame-reference-picker", () => ({ FrameReferencePicker: () => null }));
vi.mock("@/components/admin/frame-guide", () => ({ FrameGuide: () => null }));
vi.mock("@/components/admin/marked-renders-panel", () => ({ MarkedRendersPanel: () => null }));
vi.mock("@/components/admin/frame-template-signoff-page", () => ({ FrameTemplateSignOffPage: () => null }));

import AdminFrameComparePage from "@/app/(app)/admin/frame-compare/page";
import { FRAME_REFERENCES, sampleFramePreview } from "@/lib/cards/frame-reference-registry";

const REFERENCE = FRAME_REFERENCES.m15.w!;
const SCAN = "https://cards.scryfall.io/png/front/a/b/scan.png";

async function renderPage(params: { template?: string; color?: string; ref?: string }) {
  const tree = await AdminFrameComparePage({ searchParams: Promise.resolve(params) });
  return render(tree);
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  payloads.build.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe("/admin/frame-compare — the reference lookup", () => {
  it("fixture: m15/w has a registry printing", () => {
    expect(REFERENCE.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("renders the printing when the lookup answers", async () => {
    payloads.build.mockResolvedValue({ preview: { title: "From Scryfall" }, scanUrl: SCAN });
    await renderPage({ template: "m15", color: "w" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15");
    expect(screen.getByText(new RegExp(`^Reference: ${REFERENCE.name}`))).toBeTruthy();
    const compare = screen.getByTestId("frame-compare");
    expect(compare.textContent).toBe("From Scryfall");
    expect(compare.dataset.scan).toBe(SCAN);
  });

  it("a lookup that throws shows the sample content and says so, instead of erroring the page", async () => {
    payloads.build.mockRejectedValue(new TypeError("fetch failed"));
    await renderPage({ template: "m15", color: "w" });
    expect(
      screen.getByText(
        `Reference lookup failed (${REFERENCE.name}) — showing sample content instead. Reload to retry.`,
      ),
    ).toBeTruthy();
    const compare = screen.getByTestId("frame-compare");
    expect(compare.textContent).toBe(sampleFramePreview("m15", "w").title);
    expect(compare.dataset.scan).toBe("none");
    // Logged for the server's logs — the combo and the reason, nothing else.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("m15/w");
    expect(warn.mock.calls[0][1]).toBe("fetch failed");
  });

  it("a lookup that answers null (no such card) takes the same fallback", async () => {
    payloads.build.mockResolvedValue(null);
    await renderPage({ template: "m15", color: "w" });
    expect(screen.getByText(/^Reference lookup failed/)).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});
