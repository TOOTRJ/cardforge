import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Owner decision B3 (2026-09-29): the AI remix's identity call names BOTH
// halves of a two-part layout card, in the SAME one call (no extra model
// call, so the remix's cost is unchanged). A one-faced card's request is the
// one it always sent.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], object: {} as unknown }));

vi.mock("ai", () => ({
  generateObject: async (args: Record<string, unknown>) => {
    s.calls.push(args);
    return { object: s.object };
  },
}));
vi.mock("@/lib/ai/provider", () => ({ designModel: () => "test/model" }));

import {
  SECOND_HALF_RELATIONSHIP,
  buildRemixIdentityRequest,
  generateRemixIdentity,
} from "@/lib/ai/remix";
import type { CardBackFace } from "@/types/card";

const giant = {
  title: "Bonecrusher Giant",
  cost: "{2}{R}",
  card_type: "creature" as const,
  supertype: null,
  subtypes: ["Giant"],
  rules_text: "Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell's controller.",
  flavor_text: null,
  power: "4",
  toughness: "3",
};
const stomp: CardBackFace = {
  title: "Stomp",
  cost: "{1}{R}",
  card_type: "instant",
  subtypes: ["Adventure"],
  rules_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
};

beforeEach(() => {
  s.calls = [];
});

describe("buildRemixIdentityRequest — one-faced cards are unchanged", () => {
  it("sends the original prompt: no second half, no second name in the schema", () => {
    const request = buildRemixIdentityRequest({ card: giant, style: "watercolour" });
    expect(request.twoPart).toBe(false);
    expect(request.system).not.toMatch(/TWO-PART|second_title/);
    expect(request.prompt).not.toContain("second_half");
    expect(request.prompt).toBe(
      [
        `Original card:\n${JSON.stringify(
          {
            title: "Bonecrusher Giant",
            cost: "{2}{R}",
            type: "creature Giant",
            rules_text: giant.rules_text,
            flavor_text: null,
            stats: "4/3",
          },
          null,
          2,
        )}`,
        "Target style: watercolour",
      ].join("\n\n"),
    );
    const parsed = request.schema.safeParse({
      title: "Crag Titan",
      flavor_text: null,
      art_instruction: "Repaint it.",
    });
    expect(parsed.success).toBe(true);
    // strict: a second name is not part of a one-faced identity
    expect(
      request.schema.safeParse({
        title: "Crag Titan",
        flavor_text: null,
        art_instruction: "Repaint it.",
        second_title: "Quake",
      }).success,
    ).toBe(false);
  });
});

describe("buildRemixIdentityRequest — a two-part card names both halves", () => {
  it("shows the model the second half and asks for its name and flavour", () => {
    const request = buildRemixIdentityRequest({
      card: giant,
      secondHalf: { layout: "adventure", face: stomp },
      style: "watercolour",
    });
    expect(request.twoPart).toBe(true);
    expect(request.system).toContain("Rename BOTH halves");
    expect(request.system).toContain(SECOND_HALF_RELATIONSHIP.adventure);
    // A live run (2026-09-28) named a flip half "Dokai, Lifebringer" and an
    // adventure "Trample": the prompt forbids both.
    expect(request.system).toContain(
      "Neither new name may reuse either original name or any proper noun in them",
    );
    expect(request.system).toMatch(/keyword or game term \(Flying, Trample/);
    const summary = JSON.parse(
      /^Original card:\n([\s\S]*?)\n\nNames the new ones/.exec(request.prompt)![1],
    );
    expect(summary.second_half).toEqual({
      layout: "adventure",
      title: "Stomp",
      cost: "{1}{R}",
      type: "instant Adventure",
      rules_text: stomp.rules_text,
      stats: null,
    });
    expect(request.prompt).toContain(
      'Names the new ones must not reuse: "Bonecrusher Giant", "Stomp".',
    );
    // The second name is REQUIRED — a two-part identity without it fails
    // the call (and the step, which the credit wrapper refunds).
    expect(
      request.schema.safeParse({ title: "Crag Titan", flavor_text: null, art_instruction: "Repaint it." })
        .success,
    ).toBe(false);
    expect(
      request.schema.safeParse({
        title: "Crag Titan",
        flavor_text: null,
        art_instruction: "Repaint it.",
        second_title: "Quake",
        second_flavor_text: null,
      }).success,
    ).toBe(true);
  });

  it("spells out a legendary half's own name as reserved (a live run kept \"Dokai\")", () => {
    const request = buildRemixIdentityRequest({
      card: { ...giant, title: "Budoka Gardener" },
      secondHalf: {
        layout: "flip",
        face: { title: "Dokai, Weaver of Life", supertype: "Legendary", card_type: "creature" },
      },
      style: "ink",
    });
    expect(request.prompt).toContain(
      'Names the new ones must not reuse: "Budoka Gardener", "Dokai, Weaver of Life", "Dokai".',
    );
  });

  it("tells the model how each layout's halves relate", () => {
    for (const layout of ["adventure", "split", "aftermath", "flip"] as const) {
      const request = buildRemixIdentityRequest({
        card: giant,
        secondHalf: { layout, face: stomp },
        style: "ink",
      });
      expect(request.system).toContain(SECOND_HALF_RELATIONSHIP[layout]);
      for (const other of Object.keys(SECOND_HALF_RELATIONSHIP) as (keyof typeof SECOND_HALF_RELATIONSHIP)[]) {
        if (other !== layout) expect(request.system).not.toContain(SECOND_HALF_RELATIONSHIP[other]);
      }
    }
  });
});

describe("generateRemixIdentity", () => {
  it("makes ONE model call for a two-part card and returns both names", async () => {
    s.object = {
      title: "Crag Titan",
      flavor_text: "It never asks twice.",
      art_instruction: "Repaint it.",
      second_title: "Quake",
      second_flavor_text: null,
    };
    const identity = await generateRemixIdentity({
      card: giant,
      secondHalf: { layout: "adventure", face: stomp },
      style: "watercolour",
    });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].system).toContain("Rename BOTH halves");
    expect(identity).toMatchObject({ title: "Crag Titan", second_title: "Quake" });
  });

  it("sends a one-faced card's original request", async () => {
    s.object = { title: "Crag Titan", flavor_text: null, art_instruction: "Repaint it." };
    await generateRemixIdentity({ card: giant, style: "watercolour", theme: "storm giants" });
    const expected = buildRemixIdentityRequest({ card: giant, style: "watercolour", theme: "storm giants" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({
      system: expected.system,
      prompt: expected.prompt,
      temperature: 0.8,
      maxRetries: 1,
    });
  });
});
