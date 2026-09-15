import { describe, expect, it } from "vitest";
import { downloadBrandMark } from "@/lib/billing/entitlements";

describe("downloadBrandMark — downloads follow the viewer's plan only", () => {
  it("a free viewer always downloads with the brand mark", () => {
    expect(downloadBrandMark({ removeWatermark: false })).toBe(true);
  });
  it("a paid viewer never does", () => {
    expect(downloadBrandMark({ removeWatermark: true })).toBe(false);
  });
});
