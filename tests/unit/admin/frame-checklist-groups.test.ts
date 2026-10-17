import { describe, expect, it } from "vitest";
import {
  comboStatus,
  countStatuses,
  groupCombos,
  groupTemplates,
  statusCountsLabel,
  templateStatus,
} from "@/lib/admin/frame-checklist-groups";

// ---------------------------------------------------------------------------
// The frame checklist's order (owner 2026-10-16): a stale tick (verified,
// but a scoped layout bump or a changed override asks for a re-tick) first,
// then the unverified rows, then the approved ones; templates by their most
// urgent row. Each group keeps its arrival order.
// ---------------------------------------------------------------------------

const row = (colorKey: string, verified: boolean, stale = false) => ({
  colorKey,
  verified,
  stale,
});

describe("comboStatus", () => {
  it("reads a stale tick as stale, a missing one as to do, a current one as approved", () => {
    expect(comboStatus({ verified: true, stale: true })).toBe("stale");
    expect(comboStatus({ verified: false })).toBe("todo");
    // A withdrawn tick keeps no "stale" weight: it is simply unverified.
    expect(comboStatus({ verified: false, stale: true })).toBe("todo");
    expect(comboStatus({ verified: true })).toBe("approved");
    expect(comboStatus({ verified: true, stale: false })).toBe("approved");
  });
});

describe("groupCombos", () => {
  it("puts re-verification first, then unverified, then approved — each in its own order", () => {
    const combos = [
      row("w", true),
      row("u", false),
      row("b", true, true),
      row("r", false),
      row("g", true),
      row("c", true, true),
      row("m", false),
    ];
    const groups = groupCombos(combos);
    expect(groups.stale.map((c) => c.colorKey)).toEqual(["b", "c"]);
    expect(groups.todo.map((c) => c.colorKey)).toEqual(["u", "r", "m"]);
    expect(groups.approved.map((c) => c.colorKey)).toEqual(["w", "g"]);
    expect(countStatuses(combos)).toEqual({ stale: 2, todo: 3, approved: 2 });
  });
});

describe("templates", () => {
  const tpl = (template: string, combos: ReturnType<typeof row>[]) => ({
    template,
    combos,
  });

  it("is as urgent as its most urgent row", () => {
    expect(
      templateStatus([row("w", true), row("u", false), row("b", true, true)]),
    ).toBe("stale");
    expect(templateStatus([row("w", true), row("u", false)])).toBe("todo");
    expect(templateStatus([row("w", true), row("u", true)])).toBe("approved");
  });

  it("keeps stale templates, then unverified ones, open; fully approved ones at the bottom", () => {
    const { open, approved } = groupTemplates([
      tpl("m15", [row("w", true)]),
      tpl("m15land", [row("w", false)]),
      tpl("m15pw", [row("w", true, true), row("u", false)]),
      tpl("m15saga", [row("w", true), row("u", true)]),
      tpl("m15token", [row("w", true, true)]),
    ]);
    expect(open.map((t) => t.template)).toEqual([
      "m15pw",
      "m15token",
      "m15land",
    ]);
    expect(approved.map((t) => t.template)).toEqual(["m15", "m15saga"]);
  });
});

describe("statusCountsLabel", () => {
  it("names the non-empty groups", () => {
    expect(statusCountsLabel({ stale: 1, todo: 3, approved: 4 })).toBe(
      "1 to re-verify · 3 to verify · 4 approved",
    );
    expect(statusCountsLabel({ stale: 0, todo: 0, approved: 7 })).toBe(
      "7 approved",
    );
    expect(statusCountsLabel({ stale: 0, todo: 2, approved: 0 })).toBe(
      "2 to verify",
    );
  });
});
