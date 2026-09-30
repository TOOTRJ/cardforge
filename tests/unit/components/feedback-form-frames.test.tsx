// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The feedback form's "Which frame?" list (TODO 4.48a): frame labels are
// era-relative and repeat across eras — "Token" is the M15 full-art design
// (m20token) and Alpha's (alphatoken) since 4.48a, "Standard" and "Land"
// repeat too — so the options sit under one group per era, as the frame
// picker lists them, and never read alike inside one.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("category=frame"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/feedback/actions", () => ({ submitFeedbackAction: vi.fn() }));

import { FeedbackForm } from "@/components/feedback/feedback-form";

afterEach(cleanup);

describe("the feedback form's frame list (TODO 4.48a)", () => {
  it("groups every frame by era, with no two labels alike inside a group", () => {
    render(<FeedbackForm signedIn />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const groups = [...select.querySelectorAll("optgroup")];
    expect(groups.map((g) => g.label)).toEqual([
      "Classic (1993)",
      "Retro (1997)",
      "Modern border (2003)",
      "M15 (2015)",
      "Showcase & Universes Beyond",
    ]);
    const listed: string[] = [];
    for (const group of groups) {
      const options = [...group.querySelectorAll("option")];
      const labels = options.map((o) => o.textContent);
      expect(new Set(labels).size, group.label).toBe(labels.length);
      listed.push(...options.map((o) => o.value));
    }
    // Every template once, and "Not sure / several" outside the groups.
    expect([...listed].sort()).toEqual([...FRAME_TEMPLATE_VALUES].sort());
    expect(select.options[0]).toMatchObject({ value: "", textContent: "Not sure / several" });

    const groupOf = (value: string) =>
      (select.querySelector(`option[value="${value}"]`)?.parentElement as HTMLOptGroupElement).label;
    expect(select.querySelector('option[value="m20token"]')?.textContent).toBe("Token");
    expect(groupOf("m20token")).toBe("M15 (2015)");
    expect(groupOf("m15token")).toBe("M15 (2015)");
    expect(groupOf("alphatoken")).toBe("Classic (1993)");
  });
});
