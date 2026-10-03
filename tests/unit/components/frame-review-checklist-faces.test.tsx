// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The checklist's back-face tag (TODO 5.0b): a template whose rows verify
// the printing's BACK face says so beside its label, and its Walk links say
// the preview opens on the back; a front template is unchanged.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/admin/frame-verify-checkbox", () => ({ FrameVerifyCheckbox: () => null }));
vi.mock("@/components/admin/frame-preview-list", () => ({ FramePreviewList: () => null }));

import { FrameReviewChecklist } from "@/components/admin/frame-review-checklist";

afterEach(() => cleanup());

const combo = (colorKey: string, walkHref: string) => ({
  colorKey,
  colorLabel: colorKey.toUpperCase(),
  verified: false,
  reference: { name: "Ref", set: "tst", thumbUrl: `https://cards.scryfall.io/normal/back/a/b/${colorKey}.jpg` },
  walkHref,
});

describe("FrameReviewChecklist — faces", () => {
  it("tags a back-face template and names the back in its Walk links", () => {
    render(
      <FrameReviewChecklist
        eras={[
          {
            era: "m15",
            label: "2015 frame",
            templates: [
              {
                template: "m15dfcback",
                label: "Transform (Back)",
                face: "back",
                combos: [combo("w", "/create?previewFrames=all&template=m15dfcback&color=w&face=back")],
              },
              {
                template: "m15",
                label: "Standard",
                face: "front",
                combos: [combo("w", "/create?previewFrames=all&template=m15&color=w")],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId("checklist-face-back")).toHaveLength(1);
    expect(screen.getByLabelText("Walk the stepper on m15dfcback/w (back face)").getAttribute("href")).toContain("face=back");
    expect(screen.getByLabelText("Walk the stepper on m15/w").getAttribute("href")).not.toContain("face=");
  });
});
