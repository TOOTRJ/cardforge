import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The AI jobs that SAVE cards (owner policy 2026-10-28): a card's text with
// strong language is made private by the card actions themselves
// (lib/cards/actions.ts — tested in card-actions-strong-language.test.ts);
// what the jobs add is passing the action's notice on, onto the step, so the
// runner can say so (`forced_private`). A step whose card saved as asked
// writes exactly the patch it always did — no new key. The card actions, the
// image calls and Supabase are stubs (the harness of
// ai-art-lands-fitted.test.ts and deck-remix-step-frame.test.ts).
// ---------------------------------------------------------------------------

const NOTICE = { reason: "profanity", fields: ["rules_text"] } as const;

const s = vi.hoisted(() => ({
  patched: [] as Record<string, unknown>[],
  job: null as unknown as Record<string, unknown>,
  stepKey: "card:0",
  createNotice: null as unknown,
  updateNotice: null as unknown,
  printing: null as unknown,
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
      if (name === "claim_job_step") return { data: { job: s.job, step_key: s.stepKey }, error: null };
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
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: async () => null }));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () =>
    [
      ["m15artifact", "c"],
      ["m15", "c"],
    ].map(([template, colour]) => frameComboKey(template as FrameTemplate, colour)),
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scryfall/client")>()),
  getCardById: async () => s.printing,
}));
vi.mock("@/lib/ai/remix", () => ({
  generateRemixIdentity: async () => ({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
  }),
}));
vi.mock("@/lib/ai/image-gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/image-gen")>()),
  generateImageWithFallbacks: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
  generatePlainImage: async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }),
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
  createCardAction: async () => ({
    ok: true,
    cardId: "card-1",
    slug: "made",
    ...(s.createNotice ? { forcedPrivate: s.createNotice } : {}),
  }),
  updateCardAction: async () => ({
    ok: true,
    cardId: "card-1",
    slug: "made",
    ...(s.updateNotice ? { forcedPrivate: s.updateNotice } : {}),
  }),
}));

import { runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";

const designed = {
  title: "Grim Tidings",
  cost: "{2}{W}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human"],
  rarity: "rare",
  color_identity: ["white"],
  rules_text: "Flying",
  flavor_text: null,
  power: "2",
  toughness: "2",
  loyalty: null,
  defense: null,
  art_prompt: "A soldier on a wall at dawn.",
};

async function runCardJob() {
  s.stepKey = "card:0";
  s.job = {
    id: "job-1",
    owner_id: "user-1",
    kind: "card",
    status: "generating",
    request: {},
    deck_id: null,
    error: null,
    plan: { card: designed, style: null, frame_template: "m15" },
    steps: [{ key: "card:0", label: designed.title, status: "running" }],
  };
  expect((await runNextJobStep("job-1", "card:0")).ok).toBe(true);
  return s.patched.at(-1)!;
}

async function runRemixJob() {
  const printing = scryfallCardSchema.parse(structuredClone(printings["lea-255"]));
  s.printing = printing;
  s.stepKey = "remix:0";
  s.job = {
    id: "job-2",
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
      entries: [{ board: "main", quantity: 1, name: printing.name, card_id: null, scryfall_id: printing.id }],
    },
    steps: [{ key: "remix:0", label: printing.name, status: "running" }],
  };
  expect((await runNextJobStep("job-2", "remix:0")).ok).toBe(true);
  return s.patched.at(-1)!;
}

beforeEach(() => {
  s.patched = [];
  s.createNotice = null;
  s.updateNotice = null;
});

describe("an AI card job (create private → paint → publish)", () => {
  it("a publish the action kept private puts the notice on the done step", async () => {
    s.updateNotice = NOTICE;
    const step = await runCardJob();
    expect(step.status).toBe("done");
    expect(step.forced_private).toEqual(NOTICE);
  });

  it("a card published as asked writes the patch it always did — no new key", async () => {
    const step = await runCardJob();
    expect(step.status).toBe("done");
    expect("forced_private" in step).toBe(false);
  });
});

describe("the AI deck remix (create public)", () => {
  it("a create the action kept private puts the notice on the done step", async () => {
    s.createNotice = NOTICE;
    const step = await runRemixJob();
    expect(step.status).toBe("done");
    expect(step.forced_private).toEqual(NOTICE);
  });

  it("a remix saved as asked writes the patch it always did", async () => {
    const step = await runRemixJob();
    expect(step.status).toBe("done");
    expect("forced_private" in step).toBe(false);
  });
});
