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
vi.mock("@/lib/scryfall/reference-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/reference-preview")>();
  return { FrameCompareFaceError: actual.FrameCompareFaceError, buildFrameComparePayload: payloads.build };
});

// Client islands and panels: what the page hands them is what matters.
vi.mock("@/components/layout/dashboard-shell", () => ({
  DashboardShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/admin/frame-compare", () => ({
  FrameCompare: (props: { preview: { title?: string }; scanUrl: string | null; face?: string | null }) => (
    <div data-testid="frame-compare" data-scan={props.scanUrl ?? "none"} data-face={props.face ?? ""}>
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

async function renderPage(params: { template?: string; color?: string; ref?: string; face?: string }) {
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
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "front");
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

  it("the REAL lookup with the network down (Scryfall's fetch throws) takes the same fallback", async () => {
    // Not a mocked rejection: the real buildFrameComparePayload → getCardById
    // → scryfallFetch, with only `fetch` itself failing the way undici does
    // when Scryfall is unreachable. The client lets that throw (it returns
    // null only for an answered 404), which is what errored the page.
    const actual = await vi.importActual<typeof import("@/lib/scryfall/reference-preview")>(
      "@/lib/scryfall/reference-preview",
    );
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    payloads.build.mockImplementation(actual.buildFrameComparePayload);
    try {
      await renderPage({ template: "m15", color: "w" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`/cards/${REFERENCE.scryfallId}`);
    expect(
      screen.getByText(
        `Reference lookup failed (${REFERENCE.name}) — showing sample content instead. Reload to retry.`,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("frame-compare").textContent).toBe(sampleFramePreview("m15", "w").title);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe("fetch failed");
  });

  it("a lookup that answers null (no such card) takes the same fallback", async () => {
    payloads.build.mockResolvedValue(null);
    await renderPage({ template: "m15", color: "w" });
    expect(screen.getByText(/^Reference lookup failed/)).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("/admin/frame-compare — the face compared (TODO 5.0b)", () => {
  const BACK_SCAN = "https://cards.scryfall.io/png/back/a/b/scan.png";

  it("the front by default, with no face switch for a single-faced printing", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Serra Angel" },
      scanUrl: SCAN,
      face: "front",
      faceName: null,
      hasBackScan: false,
    });
    await renderPage({ template: "m15", color: "w" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "front");
    expect(screen.queryByTestId("face-switcher")).toBeNull();
    expect(screen.getByTestId("frame-compare").dataset.face).toBe("front");
    expect(screen.getByText(`Reference: ${REFERENCE.name} (${REFERENCE.set.toUpperCase()}).`)).toBeTruthy();
  });

  it("?face=back renders the printing's back against its back scan, names the face, and offers both faces", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Avacyn, the Purifier" },
      scanUrl: BACK_SCAN,
      face: "back",
      faceName: "Avacyn, the Purifier",
      hasBackScan: true,
    });
    await renderPage({ template: "m15", color: "w", face: "back" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "back");
    const compare = screen.getByTestId("frame-compare");
    expect(compare.textContent).toBe("Avacyn, the Purifier");
    expect(compare.dataset.scan).toBe(BACK_SCAN);
    expect(compare.dataset.face).toBe("back");
    expect(
      screen.getByText(`Reference: ${REFERENCE.name} (${REFERENCE.set.toUpperCase()}) — back face (Avacyn, the Purifier).`),
    ).toBeTruthy();
    const switcher = screen.getByTestId("face-switcher");
    expect(switcher.dataset.face).toBe("back");
    const links = Array.from(switcher.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Front", "/admin/frame-compare?template=m15&color=w"],
      ["Back · Avacyn, the Purifier", "/admin/frame-compare?template=m15&color=w&face=back"],
    ]);
    // The walk opens the stepper on the back.
    const walk = screen.getByText(/^Walk the stepper on m15\/w \(back face\)/).closest("a");
    expect(walk?.getAttribute("href")).toContain("face=back");
    expect(screen.getByText(/as a legacy back draws today/)).toBeTruthy();
  });

  it("a two-faced printing on the front offers the back", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Archangel Avacyn" },
      scanUrl: SCAN,
      face: "front",
      faceName: "Archangel Avacyn",
      hasBackScan: true,
    });
    await renderPage({ template: "m15", color: "w" });
    const switcher = screen.getByTestId("face-switcher");
    expect(switcher.dataset.face).toBe("front");
    expect(Array.from(switcher.querySelectorAll("a")).map((a) => a.textContent)).toEqual([
      "Front · Archangel Avacyn",
      "Back",
    ]);
    expect(screen.getByText(/front face \(Archangel Avacyn\)\./)).toBeTruthy();
  });

  it("a face the printing can't show is named, and the sample stands in", async () => {
    const actual = await vi.importActual<typeof import("@/lib/scryfall/reference-preview")>(
      "@/lib/scryfall/reference-preview",
    );
    payloads.build.mockRejectedValue(new actual.FrameCompareFaceError("Serra Angel has no second face to compare."));
    await renderPage({ template: "m15", color: "w", face: "back" });
    expect(screen.getByText("Serra Angel has no second face to compare. Showing sample content instead.")).toBeTruthy();
    expect(screen.getByTestId("frame-compare").textContent).toBe(sampleFramePreview("m15", "w").title);
    // Not a failure worth a log line.
    expect(warn).not.toHaveBeenCalled();
    // The switch still offers the way back to the front.
    const switcher = screen.getByTestId("face-switcher");
    expect(Array.from(switcher.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Front", "Back"]);
  });

  it("a value that names no face is the front", async () => {
    payloads.build.mockResolvedValue({ preview: { title: "x" }, scanUrl: SCAN, face: "front", faceName: null, hasBackScan: false });
    await renderPage({ template: "m15", color: "w", face: "sideways" });
    expect(payloads.build).toHaveBeenCalledWith(REFERENCE.scryfallId, "m15", "front");
  });
});
