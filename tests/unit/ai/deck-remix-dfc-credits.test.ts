import { beforeEach, describe, expect, it, vi } from "vitest";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.4 skeptic pass — the MONEY path of a double-faced deck remix, end
// to end through the REAL credit wrapper (lib/ai/credited-step.ts) with the
// ledger helpers stubbed: a step priced for both faces reserves its two
// credits ONCE (one ledger ref), paints two pictures, hands createCardAction
// a back the server's gate accepts, and stamps the ref for patch_job_step to
// settle; every failure after the reserve refunds the same two credits under
// the same ref; a one-credit plan never paints a back. The mapper, the
// resolver and the gate are the real ones, on a real (trimmed) printing.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";

const s = vi.hoisted(() => ({
  verified: [] as string[],
  printing: null as unknown,
  created: [] as Record<string, unknown>[],
  createResult: { ok: true, cardId: "card-1", slug: "remixed" } as Record<string, unknown>,
  patched: [] as Record<string, unknown>[],
  identity: vi.fn(),
  image: vi.fn(),
  persisted: 0,
  spend: vi.fn(),
  refund: vi.fn(),
  job: null as unknown as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => ({ id: USER }),
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
      if (name === "claim_job_step") return { data: { job: s.job, step_key: "remix:0" }, error: null };
      if (name === "patch_job_step") {
        s.patched.push(args.p_patch as Record<string, unknown>);
        return { data: s.job, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  }),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => s.verified }));
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
  persistGeneratedArt: async () => {
    s.persisted += 1;
    return {
      ok: true,
      publicUrl: `https://example.supabase.co/storage/v1/object/public/card-art/${USER}/${s.persisted}.png`,
    };
  },
}));
// The REAL wrapper (withCreditedStep) over stubbed ledger helpers.
vi.mock("@/lib/ai/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rate-limit")>()),
  logAiCall: async () => undefined,
  spendCredits: s.spend,
  refundCredits: s.refund,
}));
vi.mock("@/lib/cards/actions", () => ({
  createCardAction: async (payload: Record<string, unknown>) => {
    s.created.push(payload);
    return s.createResult;
  },
  updateCardAction: async () => ({ ok: true }),
}));

import { REMIX_DFC_FRAMES_GONE, runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { dfcFrontColorError, dfcFrontTypeError, resolveDfcBackFace, type DfcBackFacePayload } from "@/lib/cards/dfc-gate";
import { frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { cardFieldsFace } from "@/lib/cards/frame-kind-gate";
import { normalizeAnatomy } from "@/lib/cards/anatomy";

const keys = (...combos: [string, string][]) =>
  combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour));
const MID_7 = () => scryfallCardSchema.parse(signaturePrintings["mid-7"]);
const BOTH_FACES = () => keys(["m15dfcfront", "w"], ["m15dfcbackleft", "r"], ["m15", "w"]);
const REF = new RegExp(`^spend:job-1:remix:0:[0-9a-f-]{36}$`);

async function run(options: { credits?: number } = {}) {
  const printing = MID_7();
  s.printing = printing;
  s.job = {
    id: "job-1",
    owner_id: USER,
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
        {
          board: "main",
          quantity: 1,
          name: printing.name,
          card_id: null,
          scryfall_id: printing.id,
          ...(options.credits ? { credits: options.credits } : {}),
        },
      ],
    },
    steps: [{ key: "remix:0", label: printing.name, status: "running", ...(options.credits ? { credits: options.credits } : {}) }],
  };
  const result = await runNextJobStep("job-1", "remix:0");
  expect(result.ok).toBe(true);
  return { step: s.patched.at(-1)!, card: s.created.at(-1) };
}

/** The reserve's ref — ONE charge per attempt. */
function reservedRef(): string {
  expect(s.spend).toHaveBeenCalledTimes(1);
  const [, , options] = s.spend.mock.calls[0] as [number, string, { failClosed: boolean; ref: string }];
  expect(options.failClosed).toBe(true);
  expect(options.ref).toMatch(REF);
  return options.ref;
}

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.persisted = 0;
  s.createResult = { ok: true, cardId: "card-1", slug: "remixed" };
  s.verified = BOTH_FACES();
  s.spend.mockReset().mockResolvedValue({ ok: true, balance: 4, charged: true });
  s.refund.mockReset().mockResolvedValue(undefined);
  s.identity.mockReset().mockImplementation(async (input: { secondHalf?: unknown }) => ({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
    ...(input.secondHalf
      ? { second_title: "Remixed Back", second_flavor_text: null, second_art_instruction: "The same being, changed." }
      : {}),
  }));
  s.image.mockReset().mockResolvedValue({ ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
});

describe("a double-faced remix step priced at two credits (owner Q4)", () => {
  it("reserves 2 ONCE, paints two pictures, saves a back the gate accepts, and stamps the ref for settlement", async () => {
    const { step, card } = await run({ credits: 2 });
    const ref = reservedRef();
    expect(s.spend.mock.calls[0]!.slice(0, 2)).toEqual([2, "generate_deck"]);
    expect(s.refund).not.toHaveBeenCalled();

    // Two pictures, two storage objects; the back's from its own instruction.
    expect(s.image).toHaveBeenCalledTimes(2);
    expect(String(s.image.mock.calls[1]![0])).toMatch(/^The same being, changed\./);
    expect(s.persisted).toBe(2);

    // The payload createCardAction gets: the front body with the family, the
    // back with its body, colour, no cost and its OWN picture, public.
    expect(card).toMatchObject({
      frame_style: { template: "m15dfcfront", dfcIcon: "sunmoon" },
      card_type: "creature",
      color_identity: ["white"],
      visibility: "public",
      art_url: expect.stringMatching(/\/1\.png$/),
      back_face: {
        title: "Remixed Back",
        card_type: "creature",
        frame_style: { template: "m15dfcbackleft" },
        color_identity: ["red"],
        art_url: expect.stringMatching(/\/2\.png$/),
      },
    });
    expect((card!.back_face as Record<string, unknown>).cost).toBeUndefined();

    // …and the server's gates, run on that payload with the same verified
    // set, accept it: the kind gate, the front's type and colour rules, the
    // back's body / colour / cost rule (lib/cards/dfc-gate.ts).
    const frameStyle = card!.frame_style as { template: string; dfcIcon?: string };
    expect(frameKindGateError(frameStyle.template, cardFieldsFace(card as never))).toBeNull();
    expect(dfcFrontTypeError(frameStyle.template, card!.card_type as string)).toBeNull();
    expect(dfcFrontColorError(frameStyle.template, { cardType: card!.card_type as string }, card!.color_identity as never)).toBeNull();
    const stored = normalizeAnatomy(frameStyle, frameStyle.template, card!.card_type as string);
    const gate = resolveDfcBackFace({
      frontTemplate: frameStyle.template,
      back: card!.back_face as DfcBackFacePayload,
      family: stored.dfcIcon,
      frontColorIdentity: card!.color_identity as never,
      verifiedKeys: new Set(s.verified),
    });
    expect(gate).toMatchObject({ ok: true, layout: "transform", back: { frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"] } });

    // The done-write carries the charging ref: patch_job_step settles it
    // in the same transaction (migration 0106).
    expect(step).toMatchObject({ status: "done", spend_ref: ref, card_id: "card-1", label: "Remixed Name // Remixed Back" });
  });

  it("a failed BACK picture fails the step after the front's: both credits refunded under the ref, no card saved", async () => {
    s.image
      .mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([1]), contentType: "image/png" })
      .mockResolvedValueOnce({ ok: false, error: "The image model refused." });
    const { step, card } = await run({ credits: 2 });
    const ref = reservedRef();
    expect(step).toMatchObject({ status: "failed", error: "The image model refused.", spend_ref: null });
    expect(card).toBeUndefined();
    expect(s.refund).toHaveBeenCalledTimes(1);
    expect(s.refund).toHaveBeenCalledWith(USER, 2, "generate_deck", `refund:${ref}`);
  });

  it("a plan priced for both faces whose combos were un-ticked since fails BEFORE any AI call, refunding both credits", async () => {
    s.verified = keys(["m15", "w"]);
    const { step, card } = await run({ credits: 2 });
    const ref = reservedRef();
    expect(step).toMatchObject({ status: "failed", error: REMIX_DFC_FRAMES_GONE, spend_ref: null });
    expect(card).toBeUndefined();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
    expect(s.refund).toHaveBeenCalledWith(USER, 2, "generate_deck", `refund:${ref}`);
  });

  it("a one-credit plan reserves 1 and remixes ONE-FACED whatever is ticked: one picture, no back", async () => {
    const { step, card } = await run();
    reservedRef();
    expect(s.spend.mock.calls[0]![0]).toBe(1);
    expect(s.image).toHaveBeenCalledTimes(1);
    expect(card).toMatchObject({ frame_style: { template: "m15" }, card_type: "creature" });
    expect(card!.back_face).toBeUndefined();
    expect((card!.frame_style as Record<string, unknown>).dfcIcon).toBeUndefined();
    expect(step).toMatchObject({ status: "done", label: "Remixed Name" });
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("a refused reserve (1 credit left, a 2-credit entry) fails the step with the plan-limit code and runs nothing", async () => {
    s.spend.mockResolvedValue({ ok: false, reason: "insufficient_credits", balance: 1, message: "Out of credits." });
    const { step, card } = await run({ credits: 2 });
    expect(step).toMatchObject({ status: "failed", error_code: "INSUFFICIENT_CREDITS" });
    expect(card).toBeUndefined();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
    expect(s.refund).not.toHaveBeenCalled();
  });

  it("a save the server refuses after both pictures fails the step and refunds both credits", async () => {
    s.createResult = { ok: false, fieldErrors: { "back_face.color_identity": "not verified" } };
    const { step } = await run({ credits: 2 });
    const ref = reservedRef();
    expect(step).toMatchObject({ status: "failed", spend_ref: null });
    expect(s.image).toHaveBeenCalledTimes(2);
    expect(s.refund).toHaveBeenCalledWith(USER, 2, "generate_deck", `refund:${ref}`);
  });

  it("an UNCHARGED reserve (admin, billing off) is never refunded — refunding it would mint credits", async () => {
    s.spend.mockResolvedValue({ ok: true, balance: Number.POSITIVE_INFINITY, charged: false });
    s.image.mockResolvedValue({ ok: false, error: "nope" });
    const { step } = await run({ credits: 2 });
    expect(step.status).toBe("failed");
    expect(s.refund).not.toHaveBeenCalled();
  });
});
