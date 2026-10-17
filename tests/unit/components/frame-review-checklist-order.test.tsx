// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// The checklist's order (owner 2026-10-16): inside a template the rows that
// need a re-tick, then the unverified ones, open; the approved rows in a
// collapsed "Approved (N)" disclosure. Inside an era the templates with
// work stay open at the top, the fully approved ones in a collapsed
// "Approved frames (N)" group. A saved tick moves its row without a reload
// and hands the focus on; a refused one moves nothing. The tick itself is
// the real FrameVerifyCheckbox's job (its own test) — here a stand-in that
// reports "saved" the way it does.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/admin/frame-preview-list", () => ({
  FramePreviewList: () => null,
}));

/** The stand-in tick: checking it reports a SAVED change at once unless
 *  the test made the next save fail. */
const saves = vi.hoisted(() => ({ fail: false }));
vi.mock("@/components/admin/frame-verify-checkbox", () => ({
  FrameVerifyCheckbox: ({
    template,
    colorKey,
    verified,
    onVerifiedChange,
  }: {
    template: string;
    colorKey: string;
    verified: boolean;
    onVerifiedChange?: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={`Mark ${template}/${colorKey} as verified`}
      defaultChecked={verified}
      onChange={(event) => {
        if (saves.fail) return;
        onVerifiedChange?.(event.target.checked);
      }}
    />
  ),
}));

import {
  FrameReviewChecklist,
  type ChecklistEra,
} from "@/components/admin/frame-review-checklist";

/** A per-test store (Node's own localStorage shadows happy-dom's). */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

beforeEach(() => {
  saves.fail = false;
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Row = { key: string; verified: boolean; stale?: boolean };
const combo = ({ key, verified, stale = false }: Row) => ({
  colorKey: key,
  colorLabel: key.toUpperCase(),
  verified,
  stale,
  staleReasons: stale
    ? ["the renderer changed since layout v40 (now v58)"]
    : [],
  reference: {
    name: `Ref ${key}`,
    set: "tst",
    thumbUrl: `https://cards.scryfall.io/normal/front/a/b/${key}.jpg`,
  },
});

const v = (key: string): Row => ({ key, verified: true });
const todo = (key: string): Row => ({ key, verified: false });
const stale = (key: string): Row => ({ key, verified: true, stale: true });

function eras(templates: Record<string, Row[]>): ChecklistEra[] {
  return [
    {
      era: "m15",
      label: "2015 frame",
      templates: Object.entries(templates).map(([template, rows]) => ({
        template,
        label: template,
        combos: rows.map(combo),
      })),
    },
  ];
}

const box = (template: string, key: string) =>
  screen.getByRole("checkbox", {
    name: `Mark ${template}/${key} as verified`,
    hidden: true,
  }) as HTMLInputElement;
const card = (template: string) =>
  document.querySelector<HTMLElement>(`[data-template-card="${template}"]`)!;
const rowKeys = (template: string, group: "stale" | "todo" | "approved") =>
  Array.from(
    card(template).querySelectorAll(
      `[data-testid="rows-${group}"] [data-combo]`,
    ),
  ).map((li) => li.getAttribute("data-combo")!.split("/")[1]);
const disclosure = (scope: HTMLElement, name: RegExp) =>
  within(scope).getAllByRole("button", {
    name,
    hidden: true,
  })[0] as HTMLButtonElement;

describe("FrameReviewChecklist — order", () => {
  it("lists re-verification, then unverified, then a collapsed Approved group, with counts", () => {
    render(
      <FrameReviewChecklist
        eras={eras({ m15: [v("w"), todo("u"), stale("b"), todo("r"), v("g")] })}
      />,
    );
    expect(rowKeys("m15", "stale")).toEqual(["b"]);
    expect(rowKeys("m15", "todo")).toEqual(["u", "r"]);
    expect(rowKeys("m15", "approved")).toEqual(["w", "g"]);
    expect(within(card("m15")).getByTestId("template-counts").textContent).toBe(
      "1 to re-verify · 2 to verify · 2 approved",
    );
    expect(
      within(card("m15")).getByText("Needs re-verification (1)"),
    ).toBeTruthy();
    expect(within(card("m15")).getByText("To verify (2)")).toBeTruthy();
    // DOM order: stale row before the unverified ones, approved last.
    const order = Array.from(card("m15").querySelectorAll("[data-combo]")).map(
      (li) => li.getAttribute("data-combo"),
    );
    expect(order).toEqual(["m15/b", "m15/u", "m15/r", "m15/w", "m15/g"]);

    const approved = disclosure(card("m15"), /^Approved \(2\)$/);
    expect(approved.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(
      approved.getAttribute("aria-controls")!,
    )!;
    expect(region.hidden).toBe(true);
    expect(region.contains(box("m15", "w"))).toBe(true);
  });

  it("opens and closes the Approved group from its button, and remembers the choice", () => {
    const { unmount } = render(
      <FrameReviewChecklist eras={eras({ m15: [v("w"), todo("u")] })} />,
    );
    const button = disclosure(card("m15"), /^Approved \(1\)$/);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(button.getAttribute("aria-controls")!)!.hidden,
    ).toBe(false);
    unmount();

    render(<FrameReviewChecklist eras={eras({ m15: [v("w"), todo("u")] })} />);
    const again = disclosure(card("m15"), /^Approved \(1\)$/);
    expect(again.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(again);
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });

  it("still works when the browser refuses storage", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    });
    render(<FrameReviewChecklist eras={eras({ m15: [v("w"), todo("u")] })} />);
    const button = disclosure(card("m15"), /^Approved \(1\)$/);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps templates with work open at the top and fully approved ones in a collapsed group", () => {
    render(
      <FrameReviewChecklist
        eras={eras({
          m15: [v("w"), v("u")],
          m15land: [todo("w")],
          m15pw: [stale("w")],
          m15saga: [v("w")],
        })}
      />,
    );
    const open = screen.getByTestId("templates-open");
    expect(
      Array.from(open.querySelectorAll("[data-template-card]")).map((el) =>
        el.getAttribute("data-template-card"),
      ),
    ).toEqual(["m15pw", "m15land"]);
    const approvedGrid = screen.getByTestId("templates-approved");
    expect(
      Array.from(approvedGrid.querySelectorAll("[data-template-card]")).map(
        (el) => el.getAttribute("data-template-card"),
      ),
    ).toEqual(["m15", "m15saga"]);
    const group = disclosure(document.body, /^Approved frames \(2\)$/);
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(approvedGrid.closest("[hidden]")).not.toBeNull();
  });

  it("moves a saved tick to the Approved group and hands the focus to the next row", () => {
    render(
      <FrameReviewChecklist
        eras={eras({ m15: [v("w"), todo("u"), todo("b")] })}
      />,
    );
    box("m15", "u").focus();
    act(() => {
      fireEvent.click(box("m15", "u"));
    });
    expect(rowKeys("m15", "todo")).toEqual(["b"]);
    expect(rowKeys("m15", "approved")).toEqual(["w", "u"]);
    expect(disclosure(card("m15"), /^Approved \(2\)$/)).toBeTruthy();
    expect(document.activeElement).toBe(box("m15", "b"));
    expect(within(card("m15")).getByTestId("template-counts").textContent).toBe(
      "1 to verify · 2 approved",
    );
  });

  it("re-ticks a stale row into Approved (a fresh tick is current)", () => {
    render(
      <FrameReviewChecklist eras={eras({ m15: [stale("w"), todo("u")] })} />,
    );
    box("m15", "w").focus();
    act(() => {
      // The stand-in reports the box's new state: re-tick = untick + tick
      // in the real control; one "saved true" is what reaches the list.
      box("m15", "w").checked = false;
      fireEvent.click(box("m15", "w"));
    });
    expect(rowKeys("m15", "stale")).toEqual([]);
    expect(rowKeys("m15", "approved")).toEqual(["w"]);
    expect(document.activeElement).toBe(box("m15", "u"));
  });

  it("moves the last open row's template into Approved frames and focuses what followed", () => {
    render(
      <FrameReviewChecklist
        eras={eras({ m15: [v("w"), todo("u")], m15land: [todo("w")] })}
      />,
    );
    box("m15", "u").focus();
    act(() => {
      fireEvent.click(box("m15", "u"));
    });
    // m15 is fully approved now: it left the open grid.
    const open = screen.getByTestId("templates-open");
    expect(open.querySelector('[data-template-card="m15"]')).toBeNull();
    expect(
      screen
        .getByTestId("templates-approved")
        .querySelector('[data-template-card="m15"]'),
    ).not.toBeNull();
    // The focus went on to the next open row, never into the shut group.
    expect(document.activeElement).toBe(box("m15land", "w"));
  });

  it("brings a withdrawn tick back up to the open rows", () => {
    render(
      <FrameReviewChecklist
        eras={eras({ m15: [v("w"), v("u"), todo("b")] })}
      />,
    );
    fireEvent.click(disclosure(card("m15"), /^Approved \(2\)$/));
    box("m15", "w").focus();
    act(() => {
      fireEvent.click(box("m15", "w"));
    });
    expect(rowKeys("m15", "todo")).toEqual(["w", "b"]);
    expect(rowKeys("m15", "approved")).toEqual(["u"]);
    expect(document.activeElement).toBe(box("m15", "u"));
  });

  it("moves nothing when the save is refused", () => {
    saves.fail = true;
    render(<FrameReviewChecklist eras={eras({ m15: [v("w"), todo("u")] })} />);
    fireEvent.click(box("m15", "u"));
    expect(rowKeys("m15", "todo")).toEqual(["u"]);
    expect(rowKeys("m15", "approved")).toEqual(["w"]);
  });

  it("follows fresh server data after a save (the route revalidates)", () => {
    const { rerender } = render(
      <FrameReviewChecklist eras={eras({ m15: [v("w"), todo("u")] })} />,
    );
    act(() => {
      fireEvent.click(box("m15", "u"));
    });
    expect(rowKeys("m15", "approved")).toEqual(["w", "u"]);
    // The server's refreshed rows: the same tick, now from the database.
    rerender(<FrameReviewChecklist eras={eras({ m15: [v("w"), v("u")] })} />);
    expect(rowKeys("m15", "approved")).toEqual(["w", "u"]);
    // A later server read wins over the page's own memory.
    rerender(
      <FrameReviewChecklist eras={eras({ m15: [v("w"), todo("u")] })} />,
    );
    expect(rowKeys("m15", "todo")).toEqual(["u"]);
  });
});
