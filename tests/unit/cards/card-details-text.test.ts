import { describe, expect, it } from "vitest";
import { describeManaCost } from "@/lib/cards/card-display";
import { renderVersionOf } from "@/lib/cards/render-version";

// The text twins of what only the rendered image used to say.
describe("describeManaCost", () => {
  it("spells out generic, colored, hybrid, Phyrexian, snow and X pips", () => {
    expect(describeManaCost("{2}{U}{U}")).toBe("2 generic, 2 blue");
    expect(describeManaCost("{W/U}{B/P}")).toBe("white or blue, black or 2 life");
    expect(describeManaCost("{2/G}{S}{X}")).toBe("2 generic or green, snow, X");
    expect(describeManaCost("{C}{C}")).toBe("2 colorless");
    expect(describeManaCost("{1}{1}{R}")).toBe("2 generic, red");
  });

  it("returns an empty string for no cost and passes unknown symbols through", () => {
    expect(describeManaCost(null)).toBe("");
    expect(describeManaCost("")).toBe("");
    expect(describeManaCost("{Q}")).toBe("Q");
  });
});

describe("renderVersionOf", () => {
  it("is the newer of the edit and render stamps, or null without either", () => {
    expect(renderVersionOf({ updated_at: "2026-09-01T00:00:00Z", rendered_at: "2026-09-22T00:00:00Z" })).toBe(
      Date.parse("2026-09-22T00:00:00Z"),
    );
    expect(renderVersionOf({ updated_at: "2026-09-22T00:00:00Z", rendered_at: "2026-09-01T00:00:00Z" })).toBe(
      Date.parse("2026-09-22T00:00:00Z"),
    );
    expect(renderVersionOf({ updated_at: "2026-09-22T00:00:00Z", rendered_at: null })).toBe(
      Date.parse("2026-09-22T00:00:00Z"),
    );
    expect(renderVersionOf({ updated_at: "not a date", rendered_at: null })).toBeNull();
  });
});
