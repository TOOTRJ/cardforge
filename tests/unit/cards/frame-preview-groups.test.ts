import { describe, expect, it } from "vitest";
import {
  framePreviewEditHref,
  groupFramePreviewsByTemplate,
  toFramePreviewCard,
} from "@/lib/cards/frame-preview-groups";

// Walked preview cards (TODO 2.3) are listed under the frame and colour they
// render as — resolved like the renderers and the gate do — and "Re-verify"
// reopens the viewer's own card in preview mode for its frame.

const VIEWER = "viewer";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "1",
  slug: "walked-saga",
  title: "Walked Saga",
  ownerId: VIEWER,
  createdAt: "2026-09-28T10:00:00Z",
  template: "saga",
  colorIdentity: ["white"],
  ...overrides,
});

describe("toFramePreviewCard", () => {
  it("resolves the frame colour like the gate: none → c, two or more → m", () => {
    expect(toFramePreviewCard(row(), VIEWER).colorKey).toBe("w");
    expect(toFramePreviewCard(row({ colorIdentity: [] }), VIEWER).colorKey).toBe("c");
    expect(toFramePreviewCard(row({ colorIdentity: ["white", "blue"] }), VIEWER).colorKey).toBe("m");
    expect(toFramePreviewCard(row({ colorIdentity: ["bogus"] }), VIEWER).colorKey).toBe("c");
  });

  it("a legacy or missing template groups under the frame it renders as", () => {
    const legacy = toFramePreviewCard(row({ template: "regular" }), VIEWER);
    const missing = toFramePreviewCard(row({ template: null }), VIEWER);
    expect(legacy.template).toBe(missing.template);
    expect(legacy.template).not.toBe("regular");
  });

  it("knows whose card it is (the editor only opens your own)", () => {
    expect(toFramePreviewCard(row(), VIEWER).ownedByViewer).toBe(true);
    expect(toFramePreviewCard(row({ ownerId: "someone" }), VIEWER).ownedByViewer).toBe(false);
    expect(toFramePreviewCard(row(), null).ownedByViewer).toBe(false);
  });
});

describe("groupFramePreviewsByTemplate", () => {
  it("groups by template and keeps the input (newest-first) order", () => {
    const cards = [
      toFramePreviewCard(row({ id: "a" }), VIEWER),
      toFramePreviewCard(row({ id: "b", template: "battle" }), VIEWER),
      toFramePreviewCard(row({ id: "c" }), VIEWER),
    ];
    const groups = groupFramePreviewsByTemplate(cards);
    expect(groups.get("saga")?.map((c) => c.id)).toEqual(["a", "c"]);
    expect(groups.get("battle")?.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("framePreviewEditHref", () => {
  it("reopens the card in preview mode for its frame", () => {
    expect(framePreviewEditHref({ slug: "walked-saga", template: "saga" })).toBe(
      "/card/walked-saga/edit?previewFrames=saga",
    );
  });
});
