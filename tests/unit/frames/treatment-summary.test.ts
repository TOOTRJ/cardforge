import { describe, expect, it } from "vitest";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import type { RecordedScore } from "@/lib/cards/frame-signoff";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";
import { buildTreatmentView, slotRectsFor } from "@/lib/frames/treatment-summary";

// ---------------------------------------------------------------------------
// The treatment half of the sign-off (TODO 4.12): a template whose frame set
// has other frames gets them listed with each colour's state BY THE SIGN-OFF
// RULE (so "scored" means what Publish would accept on that frame's own
// page), a "Score the treatment" combo list without the colours no printing
// covers, and one pooled nudge per slot the frames draw on the same rect.
// ---------------------------------------------------------------------------

const current = (template: string, colorKey: string, slots: Record<string, unknown>): RecordedScore => ({
  layoutVersion: CARD_LAYOUT_VERSION,
  overrideHash: "none",
  referenceScryfallId:
    FRAME_REFERENCES[template as "m15borderless"][colorKey as "w"]?.scryfallId ?? null,
  scoreJson: { overall: 6, slots },
  createdAt: "2026-09-29T10:00:00Z",
});

describe("buildTreatmentView", () => {
  it("is null for a template alone in its treatment", () => {
    expect(
      buildTreatmentView({
        template: "nyx",
        reviews: new Map(),
        overrides: {},
        scores: new Map(),
        labelFor: (t) => t,
      }),
    ).toBeNull();
  });

  it("lists the treatment's frames, their colours' states, and pools the shared slots", () => {
    const nudgeDown = { score: 10, best: 6, dxPct: 0, dyPct: 0.3 };
    const view = buildTreatmentView({
      template: "m15borderlessartifact",
      reviews: new Map(),
      overrides: {},
      scores: new Map([
        [
          "m15borderless",
          new Map([
            ["w", current("m15borderless", "w", { title: nudgeDown })],
            ["u", current("m15borderless", "u", { title: nudgeDown })],
            // Scored on another reference → stale, never a vote.
            ["b", { ...current("m15borderless", "b", { title: { score: 10, best: 6, dxPct: 0, dyPct: -2 } }), referenceScryfallId: "other" }],
          ]),
        ],
        ["m15borderlessartifact", new Map([["w", current("m15borderlessartifact", "w", { title: nudgeDown })]])],
      ]),
      labelFor: (t) => `label:${t}`,
    });
    expect(view).not.toBeNull();
    expect(view!.key).toBe("borderless");
    expect(view!.label).toBe("Borderless");
    // 4.34's land is the third frame of the Borderless set, and 4.33's
    // borderless planeswalkers are in the same frame set.
    expect(view!.templates.map((t) => t.template)).toEqual([
      "m15borderless",
      "m15borderlessartifact",
      "m15borderlessland",
      "m15borderlesspw",
      "m15borderlesspwtall",
    ]);
    expect(view!.templates[0].label).toBe("label:m15borderless");
    const states = Object.fromEntries(view!.templates[0].colours.map((c) => [c.colorKey, c.state]));
    expect(states).toMatchObject({ w: "scored", u: "scored", b: "stale", r: "unscored" });

    // Every colour the five frames have a printing for (all seven, per the
    // registry).
    expect(view!.combos).toHaveLength(35);

    // The artifact kind and the land spread the borderless profile: title is
    // ONE slot, voted on by the three current colours of the scored frames
    // (the walkers' title is m15pw's, another rect).
    const title = view!.shared.find((row) => row.path === "title");
    expect(title).toMatchObject({
      templates: ["m15borderless", "m15borderlessartifact", "m15borderlessland"],
      samples: 3,
      nudge: expect.objectContaining({ dyPct: 0.3, agree: 3, of: 3 }),
    });
    expect(view!.shared.some((row) => row.path === "artSlot")).toBe(false);
  });

  it("a layout override that moves a slot on one frame splits it from the other", () => {
    const shared = slotRectsFor("m15borderless", {}).title;
    const view = buildTreatmentView({
      template: "m15borderless",
      reviews: new Map(),
      overrides: {
        m15borderlessartifact: { title: { rect: { ...shared, topPct: shared.topPct + 1 } } },
      } as never,
      scores: new Map(),
      labelFor: (t) => t,
    });
    // The artifact frame's title leaves the pool; the land's still shares
    // the standard's (4.34), and the walkers' own title (m15pw's rect) is
    // still one row of theirs.
    const titles = view!.shared.filter((row) => row.path === "title");
    expect(titles.map((row) => row.templates)).toEqual([
      ["m15borderless", "m15borderlessland"],
      ["m15borderlesspw", "m15borderlesspwtall"],
    ]);
    // The type bar stays one slot: the land's and the regular walker's share
    // the standard's rect (the tall walker's sits 138 px higher).
    expect(view!.shared.find((row) => row.path === "type" && row.templates.includes("m15borderless"))?.templates).toEqual([
      "m15borderless",
      "m15borderlessartifact",
      "m15borderlessland",
      "m15borderlesspw",
    ]);
  });

  it("the combos leave out the colours no printing covers", () => {
    const view = buildTreatmentView({
      template: "m15tokenartifact",
      reviews: new Map(),
      overrides: {},
      scores: new Map(),
      labelFor: (t) => t,
    });
    // m15tokenartifact has printings for u and c only.
    const artifactCombos = view!.combos.filter((c) => c.template === "m15tokenartifact").map((c) => c.colorKey);
    expect(artifactCombos).toEqual(["u", "c"]);
    const row = view!.templates.find((t) => t.template === "m15tokenartifact")!;
    expect(row.colours.find((c) => c.colorKey === "w")?.state).toBe("no-reference");
  });
});
