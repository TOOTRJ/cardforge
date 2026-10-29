import { describe, expect, it } from "vitest";
import { helpSearchSummary } from "@/components/content/help-search";

// ---------------------------------------------------------------------------
// The help centre's search count (components/content/help-search.tsx): the
// line the eye reads and the live region speaks. The query is quoted ONCE —
// a query typed in quotes of its own, straight or curly (iOS types curly
// ones), loses them first.
// ---------------------------------------------------------------------------

describe("helpSearchSummary", () => {
  it("counts the results for the query, in curly quotes", () => {
    expect(helpSearchSummary(9, 8, "bleed")).toBe("9 results for “bleed” — showing the best 8.");
    expect(helpSearchSummary(1, 1, "bleed")).toBe("1 result for “bleed”.");
    expect(helpSearchSummary(0, 0, "zzzz")).toBe("Nothing matches “zzzz”.");
  });

  it("never doubles the quotes of a query typed in quotes, straight or curly", () => {
    for (const query of ["“bleed”", '"bleed"', "'bleed'", "‘bleed’", "  “bleed”  ", "”bleed“"]) {
      expect(helpSearchSummary(9, 8, query), query).toBe("9 results for “bleed” — showing the best 8.");
    }
    expect(helpSearchSummary(0, 0, '"zzzz"')).toBe("Nothing matches “zzzz”.");
  });

  it("keeps the quotes and apostrophes inside a query, or at one end only", () => {
    expect(helpSearchSummary(2, 2, "Urza’s")).toBe("2 results for “Urza’s”.");
    expect(helpSearchSummary(2, 2, "players'")).toBe("2 results for “players'”.");
    expect(helpSearchSummary(2, 2, "“fit to page” off")).toBe("2 results for ““fit to page” off”.");
  });
});
