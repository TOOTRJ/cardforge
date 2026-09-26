import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// AI frame picks read the DESIGNED card (TODO 0.26). The full-art basic land
// frame dresses exactly one basic land, so createCardGenerationJob and
// createCardFillJob hand resolveGeneratedFrame the designed face (the fill
// job falling back to the pinned fields for anything it didn't generate): a
// requested full-art basic frame is kept for a basic Plains and dropped for a
// nonbasic land. The design calls and the job insert are stubbed; the plan
// the job would persist is captured.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  verified: [] as string[],
  designed: null as unknown,
  fill: null as unknown,
  inserted: null as null | { plan: { frame_template: string | null } },
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  getCurrentProfile: async () => ({ is_admin: false }),
  createClient: async () => ({
    from: () => ({
      insert: (row: { plan: { frame_template: string | null } }) => {
        s.inserted = row;
        return {
          select: () => ({
            single: async () => ({ data: { id: "job-1", ...row }, error: null }),
          }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => s.verified,
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
}));
vi.mock("@/lib/ai/random-card", () => ({
  generateRandomCard: async () => s.designed,
}));
vi.mock("@/lib/ai/card-fill", () => ({
  designCardFill: async () => s.fill,
}));

import { createCardFillJob, createCardGenerationJob } from "@/lib/ai/generation-jobs";

const plains = {
  title: "Plains",
  cost: "—",
  card_type: "land",
  supertype: "Basic",
  subtypes: ["Plains"],
  rarity: "common",
  color_identity: ["white"],
  rules_text: "",
  flavor_text: null,
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  art_prompt: "A sunlit plain.",
};
const fountain = {
  ...plains,
  title: "Hallowed Fountain",
  supertype: null,
  subtypes: ["Plains", "Island"],
  rules_text: "({T}: Add {W} or {U}.)",
};

beforeEach(() => {
  s.verified = [frameComboKey("fullartland", "w"), frameComboKey("m15land", "w")];
  s.inserted = null;
});

describe("createCardGenerationJob — the requested frame meets the designed card", () => {
  it("keeps the full-art basic frame for a basic Plains", async () => {
    s.designed = plains;
    const result = await createCardGenerationJob({ cardType: "land", frame: "fullartland" });
    expect(result.ok).toBe(true);
    expect(s.inserted?.plan.frame_template).toBe("fullartland");
  });

  it("drops it for a nonbasic land", async () => {
    s.designed = fountain;
    await createCardGenerationJob({ cardType: "land", frame: "fullartland" });
    expect(s.inserted?.plan.frame_template).toBe("m15land");
  });
});

describe("createCardFillJob — the face is the generated fields over the pinned ones", () => {
  it("reads the pinned supertype when the fill didn't generate one", async () => {
    // The designer wrote the type, title and reminder text; "Basic" was
    // pinned. Without it, a Plains that prints text reads as nonbasic.
    s.fill = {
      fields: {
        card_type: "land",
        title: "Plains",
        subtypes: ["Plains"],
        rules_text: "({T}: Add {W}.)",
        color_identity: ["white"],
      },
      art_prompt: null,
    };
    await createCardFillJob({
      want: ["card_type", "title", "rules_text"],
      locked: { supertype: "Basic" },
      steer: { card_type: "land" },
      frame: "fullartland",
    });
    expect(s.inserted?.plan.frame_template).toBe("fullartland");
  });

  it("drops the full-art basic frame when the designed land prints rules", async () => {
    s.fill = {
      fields: {
        card_type: "land",
        title: "Hallowed Fountain",
        supertype: null,
        subtypes: ["Plains", "Island"],
        rules_text: "({T}: Add {W} or {U}.)",
        color_identity: ["white"],
      },
      art_prompt: null,
    };
    await createCardFillJob({
      want: ["card_type", "title", "rules_text"],
      locked: {},
      steer: { card_type: "land" },
      frame: "fullartland",
    });
    expect(s.inserted?.plan.frame_template).toBe("m15land");
  });
});
