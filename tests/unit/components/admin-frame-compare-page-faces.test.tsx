// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// /admin/frame-compare once a BACK body exists (TODO 5.0b), under 5.0a's
// declared-profile fixture (tests/unit/cards/dfc-fixture.ts: m15artifact =
// a transform back; never the real PROFILES): the checklist row of a back
// body shows the printing's BACK thumbnail, links the walk on the back face
// and is tagged; its compare mode renders the back against the back scan
// whatever `?face=` says, shows the fixed "Back" badge instead of a switch,
// and hands the picker the face. A front body and a plain template keep
// the front. The page's data sources and client islands are stubbed; the
// registry and the face rules are real.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("../cards/dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});

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
const checklist = vi.hoisted(() => ({ eras: null as unknown }));
vi.mock("@/components/admin/frame-review-checklist", () => ({
  FrameReviewChecklist: (props: { eras: unknown }) => {
    checklist.eras = props.eras;
    return null;
  },
}));
vi.mock("@/components/admin/frame-verify-checkbox", () => ({ FrameVerifyCheckbox: () => null }));
const picker = vi.hoisted(() => ({ face: null as unknown }));
vi.mock("@/components/admin/frame-reference-picker", () => ({
  FrameReferencePicker: (props: { face?: string }) => {
    picker.face = props.face ?? null;
    return null;
  },
}));
vi.mock("@/components/admin/frame-guide", () => ({ FrameGuide: () => null }));
vi.mock("@/components/admin/marked-renders-panel", () => ({ MarkedRendersPanel: () => null }));
vi.mock("@/components/admin/frame-template-signoff-page", () => ({ FrameTemplateSignOffPage: () => null }));

import AdminFrameComparePage from "@/app/(app)/admin/frame-compare/page";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";

type ChecklistRow = {
  template: string;
  face?: string;
  walkHref?: string;
  combos: Array<{ colorKey: string; walkHref?: string; reference: { thumbUrl: string } | null }>;
};

async function renderPage(params: { template?: string; color?: string; face?: string } = {}) {
  const tree = await AdminFrameComparePage({ searchParams: Promise.resolve(params) });
  return render(tree);
}

function templateRow(template: string): ChecklistRow {
  const eras = checklist.eras as Array<{ templates: ChecklistRow[] }>;
  const row = eras.flatMap((era) => era.templates).find((t) => t.template === template);
  if (!row) throw new Error(`no checklist row for ${template}`);
  return row;
}

beforeEach(() => {
  payloads.build.mockReset();
  checklist.eras = null;
  picker.face = null;
});
afterEach(() => cleanup());

describe("the checklist", () => {
  it("a back body's rows show the back thumbnail and walk the stepper on the back; every other row the front", async () => {
    await renderPage();
    const back = templateRow("m15artifact");
    expect(back.face).toBe("back");
    expect(back.walkHref).toContain("face=back");
    for (const combo of back.combos) {
      if (combo.reference) expect(combo.reference.thumbUrl, combo.colorKey).toContain("/normal/back/");
      expect(combo.walkHref, combo.colorKey).toContain("face=back");
      expect(combo.walkHref, combo.colorKey).toContain("template=m15artifact");
    }
    for (const template of ["m15", "m15land", "saga", "m15borderless"]) {
      const row = templateRow(template);
      expect(row.face, template).toBe("front");
      expect(row.walkHref, template).not.toContain("face=");
      for (const combo of row.combos) {
        if (combo.reference) expect(combo.reference.thumbUrl, `${template}/${combo.colorKey}`).toContain("/normal/front/");
        expect(combo.walkHref, `${template}/${combo.colorKey}`).not.toContain("face=");
      }
    }
  });
});

describe("the compare view of a back body", () => {
  const reference = FRAME_REFERENCES.m15artifact.w!;

  it("renders the printing's back against the back scan whatever ?face= says, with a fixed Back badge and the picker on the back", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Back of the printing" },
      scanUrl: "https://cards.scryfall.io/png/back/x/y/scan.png",
      face: "back",
      faceName: "Back of the printing",
      hasBackScan: true,
    });
    for (const face of [undefined, "front", "back"]) {
      cleanup();
      payloads.build.mockClear();
      await renderPage({ template: "m15artifact", color: "w", ...(face ? { face } : {}) });
      expect(payloads.build).toHaveBeenCalledWith(reference.scryfallId, "m15artifact", "back");
      const compare = screen.getByTestId("frame-compare");
      expect(compare.dataset.face).toBe("back");
      expect(compare.dataset.scan).toBe("https://cards.scryfall.io/png/back/x/y/scan.png");
      const switcher = screen.getByTestId("face-switcher");
      expect(switcher.dataset.face).toBe("back");
      expect(switcher.querySelectorAll("a")).toHaveLength(0);
      expect(switcher.textContent).toMatch(/Back · Back of the printing/);
      expect(switcher.textContent).toMatch(/A back-face frame/);
      expect(picker.face).toBe("back");
      // The walk opens on the back; the compare links of the switchers
      // carry no face parameter (the template's face is its own).
      const walk = screen.getByText(/^Walk the stepper on m15artifact\/w \(back face\)/).closest("a");
      expect(walk?.getAttribute("href")).toContain("face=back");
      expect(screen.getByText(/— back face \(Back of the printing\)\./)).toBeTruthy();
    }
  });

  it("a front body is compared on the front, and the picker pins the front", async () => {
    payloads.build.mockResolvedValue({
      preview: { title: "Front" },
      scanUrl: "https://cards.scryfall.io/png/front/x/y/scan.png",
      face: "front",
      faceName: "Front",
      hasBackScan: true,
    });
    await renderPage({ template: "m15", color: "w" });
    expect(payloads.build).toHaveBeenCalledWith(FRAME_REFERENCES.m15.w!.scryfallId, "m15", "front");
    expect(picker.face).toBe("front");
    expect(screen.getByTestId("face-switcher").querySelectorAll("a")).toHaveLength(2);
  });
});
