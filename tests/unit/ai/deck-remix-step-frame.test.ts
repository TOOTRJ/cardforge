import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.22 — the WIRING of the AI deck remix's frame choice. The pure
// resolver has its own test (remix-mechanics.test.ts); this one drives a
// deck_remix step through runNextJobStep and pins what executeDeckRemixStep
// does with it: it reads the verified frames (getVerifiedFrameKeys), hands
// createCardAction the resolved template, the printed card type and — on a
// layout frame — the second half, and fails a colour with nothing published
// BEFORE the AI identity, the art or the save runs. Supabase, the credit
// wrapper, the AI calls and the Scryfall client are stubbed; the import
// mapper and the resolver are the real ones, on real (trimmed) printings.
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printings;

const s = vi.hoisted(() => ({
  verified: [] as string[],
  printing: null as unknown,
  created: [] as Record<string, unknown>[],
  patched: [] as Record<string, unknown>[],
  identity: vi.fn(),
  image: vi.fn(),
  job: null as unknown as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: "user-1" }),
  getCurrentProfile: async () => ({ display_name: "Tester", username: "tester" }),
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        maybeSingle: async () =>
          table === "ai_generation_jobs"
            ? { data: s.job, error: null }
            : { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_job_step") {
        return { data: { job: s.job, step_key: "remix:0" }, error: null };
      }
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/ai/credited-step", () => ({
  withCreditedStep: async (
    _user: string,
    _job: string,
    _amount: number,
    _reason: string,
    _step: unknown,
    body: () => Promise<unknown>,
  ) => body(),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => s.verified,
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => s.printing,
}));
vi.mock("@/lib/ai/remix", () => ({ generateRemixIdentity: s.identity }));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
  generatePlainImage: s.image,
}));
vi.mock("@/lib/ai/random-art", () => ({
  persistGeneratedArt: async () => ({
    ok: true,
    publicUrl: "https://example.supabase.co/storage/v1/object/public/card-art/x.png",
  }),
}));
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return { ok: true, cardId: "card-1", slug: "remixed" };
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { REMIX_FRAME_UNAVAILABLE } from "@/lib/creator/frame-resolve";

const keys = (...combos: [string, string][]) =>
  combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour));

async function remix(key: PrintingKey) {
  const printing = scryfallCardSchema.parse(printings[key]);
  s.printing = printing;
  s.job = {
    id: "job-1",
    owner_id: "user-1",
    kind: "deck_remix",
    status: "generating",
    request: {},
    deck_id: "deck-1",
    error: null,
    plan: {
      deck_title: "Deck",
      style: "watercolour",
      theme: null,
      skipped: 0,
      entries: [
        { board: "main", quantity: 1, name: printing.name, card_id: null, scryfall_id: printing.id },
      ],
    },
    steps: [{ key: "remix:0", label: printing.name, status: "running" }],
  };
  const result = await runNextJobStep("job-1", "remix:0");
  expect(result.ok).toBe(true);
  return { step: s.patched.at(-1)!, card: s.created.at(-1) };
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.identity.mockReset().mockResolvedValue({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
  });
  s.image.mockReset().mockResolvedValue({
    ok: true,
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
  });
});

describe("executeDeckRemixStep — the frame reaches the save", () => {
  it("an old-border printing whose frame isn't verified saves on M15's artifact frame (Juggernaut LEA #255)", async () => {
    s.verified = keys(["m15artifact", "c"], ["m15", "c"]);
    const { step, card } = await remix("lea-255");
    expect(step.status).toBe("done");
    expect(card).toMatchObject({
      frame_style: { template: "m15artifact" },
      card_type: "creature",
      supertype: "Artifact",
      color_identity: ["colorless"],
    });
    expect(card?.back_face).toBeUndefined();
  });

  it("keeps the printing's own frame once it is verified (reads getVerifiedFrameKeys)", async () => {
    s.verified = keys(["agclassic", "c"], ["m15artifact", "c"]);
    const { card } = await remix("lea-255");
    expect(card).toMatchObject({ frame_style: { template: "agclassic" }, card_type: "creature" });
  });

  it("a layout printing saves on its layout frame with the printed type and its second half (Virtue of Loyalty WOE #38)", async () => {
    s.verified = keys(["adventure", "w"], ["m15", "w"]);
    const { step, card } = await remix("woe-38");
    expect(step.status).toBe("done");
    expect(card).toMatchObject({
      frame_style: { template: "adventure" },
      card_type: "enchantment",
      back_face: { title: "Ardenvale Fealty", card_type: "instant" },
    });
    // The AI names the front only; the half keeps its text, never the
    // printing's artist.
    expect(card?.title).toBe("Remixed Name");
    expect((card?.back_face as { artist_credit?: string }).artist_credit).toBeUndefined();
  });

  it("the same printing on an unpublished layout frame saves as a one-faced card on its type's M15 frame", async () => {
    s.verified = keys(["m15", "w"]);
    const { card } = await remix("woe-38");
    expect(card).toMatchObject({ frame_style: { template: "m15" }, card_type: "enchantment" });
    expect(card?.back_face).toBeUndefined();
  });

  it("nothing published in the card's colour fails the step before the identity, the art or the save", async () => {
    s.verified = keys(["m15", "w"]); // Juggernaut is colourless
    const { step, card } = await remix("lea-255");
    expect(step).toMatchObject({ status: "failed", error: REMIX_FRAME_UNAVAILABLE });
    expect(card).toBeUndefined();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
  });
});
