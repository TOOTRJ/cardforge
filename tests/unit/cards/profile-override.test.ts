import { describe, expect, it } from "vitest";

import {
  listSlotPaths,
  mergeProfile,
  parseFrameProfileOverride,
  resolveFrameProfile,
  slotRect,
} from "@/lib/cards/profile-override";
import { getFrameProfile } from "@/lib/cards/template-layout";

describe("mergeProfile", () => {
  const base = getFrameProfile("m15");

  it("returns the base object unchanged for empty/absent overrides", () => {
    expect(mergeProfile(base)).toBe(base);
    expect(mergeProfile(base, null)).toBe(base);
    expect(mergeProfile(base, {})).toBe(base);
  });

  it("merges nested rect partials without clobbering siblings", () => {
    const merged = mergeProfile(base, { title: { rect: { topPct: 9.9 } } });
    expect(merged.title.rect.topPct).toBe(9.9);
    expect(merged.title.rect.leftPct).toBe(base.title.rect.leftPct);
    expect(merged.title.sizePct).toBe(base.title.sizePct);
    expect(merged.type).toEqual(base.type);
    // base is untouched
    expect(base.title.rect.topPct).not.toBe(9.9);
  });

  it("lets scalar overrides win", () => {
    const merged = mergeProfile(base, { costSizePct: 0.06 });
    expect(merged.costSizePct).toBe(0.06);
  });
});

describe("resolveFrameProfile", () => {
  it("applies only the requested template's override", () => {
    const overrides = {
      m15: { title: { rect: { topPct: 1.1 } } },
      saga: { title: { rect: { topPct: 2.2 } } },
    };
    expect(resolveFrameProfile("m15", overrides).title.rect.topPct).toBe(1.1);
    expect(resolveFrameProfile("saga", overrides).title.rect.topPct).toBe(2.2);
    expect(resolveFrameProfile("retro", overrides).title.rect.topPct).toBe(
      getFrameProfile("retro").title.rect.topPct,
    );
  });

  it("never lets an unknown template pick up another override via fallback", () => {
    const overrides = { m15: { title: { rect: { topPct: 1.1 } } } };
    // Unknown template falls back to the M15 base profile but must NOT
    // apply the m15 override (it wasn't asked for).
    expect(
      resolveFrameProfile("not-a-template", overrides).title.rect.topPct,
    ).toBe(getFrameProfile("m15").title.rect.topPct);
  });
});

describe("parseFrameProfileOverride", () => {
  it("accepts valid geometry-only overrides", () => {
    expect(
      parseFrameProfileOverride({
        title: { rect: { topPct: 5 }, sizePct: 0.05 },
        costSizePct: 0.048,
        pt: { valueDyEm: -0.1 },
      }),
    ).not.toBeNull();
  });

  it("rejects unknown keys, colors, and out-of-range values", () => {
    expect(parseFrameProfileOverride({ title: { colorHex: "#fff" } })).toBeNull();
    expect(parseFrameProfileOverride({ nonsense: true })).toBeNull();
    expect(parseFrameProfileOverride({ title: { sizePct: 5 } })).toBeNull();
    expect(
      parseFrameProfileOverride({ title: { rect: { topPct: 500 } } }),
    ).toBeNull();
    expect(parseFrameProfileOverride("garbage")).toBeNull();
    expect(parseFrameProfileOverride({})).toBeNull();
  });
});

describe("listSlotPaths / slotRect", () => {
  it("covers the m15 standard slots", () => {
    const paths = listSlotPaths(getFrameProfile("m15"));
    expect(paths).toEqual(
      expect.arrayContaining(["artSlot", "title", "type", "rules", "footer", "pt"]),
    );
    expect(paths).not.toContain("chapters");
  });

  it("exposes saga chapters and aftermath second faces", () => {
    expect(listSlotPaths(getFrameProfile("saga"))).toContain("chapters");
    const aftermath = listSlotPaths(getFrameProfile("aftermath"));
    expect(aftermath).toEqual(
      expect.arrayContaining(["secondFace.title", "secondFace.rules"]),
    );
  });

  it("resolves rects for bare-rect and slotted paths on every template", () => {
    for (const template of ["m15", "saga", "aftermath", "battle", "m15pw"]) {
      const profile = getFrameProfile(template);
      for (const path of listSlotPaths(profile)) {
        const rect = slotRect(profile, path);
        expect(rect, `${template}/${path}`).not.toBeNull();
        expect(typeof rect?.topPct).toBe("number");
      }
    }
  });
});

describe("costRect (independent pip box)", () => {
  it("is offered for cost-bearing frames and synthesizes a default region", () => {
    const modern = getFrameProfile("modern");
    expect(listSlotPaths(modern)).toContain("costRect");
    const rect = slotRect(modern, "costRect");
    // Right half of the title band until an explicit costRect exists.
    expect(rect?.topPct).toBe(modern.title.rect.topPct);
    expect(rect ? rect.leftPct + rect.widthPct : 0).toBeCloseTo(
      modern.title.rect.leftPct + modern.title.rect.widthPct,
      1,
    );
  });

  it("is not offered on hideCost frames and accepts overrides", () => {
    expect(listSlotPaths(getFrameProfile("m15land"))).not.toContain("costRect");
    expect(
      parseFrameProfileOverride({
        costRect: { topPct: 5, leftPct: 60, widthPct: 30, heightPct: 5 },
      }),
    ).not.toBeNull();
    const merged = mergeProfile(getFrameProfile("modern"), {
      costRect: { topPct: 5, leftPct: 60, widthPct: 30, heightPct: 5 },
    });
    expect(merged.costRect?.leftPct).toBe(60);
  });
});

describe("symbolRect (independent set-symbol box)", () => {
  it("is offered on every frame and synthesizes a default at the type band's right end", () => {
    const modern = getFrameProfile("modern");
    expect(listSlotPaths(modern)).toContain("symbolRect");
    const rect = slotRect(modern, "symbolRect");
    expect(rect?.topPct).toBe(modern.type.rect.topPct);
    expect(rect ? rect.leftPct + rect.widthPct : 0).toBeCloseTo(
      modern.type.rect.leftPct + modern.type.rect.widthPct,
      1,
    );
  });

  it("accepts overrides and merges", () => {
    expect(
      parseFrameProfileOverride({
        symbolRect: { topPct: 57, leftPct: 80, widthPct: 8, heightPct: 4 },
      }),
    ).not.toBeNull();
    const merged = mergeProfile(getFrameProfile("m15"), {
      symbolRect: { topPct: 57, leftPct: 80, widthPct: 8, heightPct: 4 },
    });
    expect(merged.symbolRect?.leftPct).toBe(80);
  });
});
