import { beforeEach, describe, expect, it, vi } from "vitest";
import printings from "../scryfall/fixtures/import-printings.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
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
  /** The credits each step reserved (withCreditedStep's amount). */
  reserved: [] as number[],
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
    amount: number,
    _reason: string,
    _step: unknown,
    body: () => Promise<unknown>,
  ) => {
    s.reserved.push(amount);
    return body();
  },
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

import { REMIX_DFC_FRAMES_GONE, runNextJobStep } from "@/lib/ai/generation-jobs";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { REMIX_FRAME_UNAVAILABLE } from "@/lib/creator/frame-resolve";
import { REMIX_NAME_REUSED, REMIX_SECOND_NAME_MISSING } from "@/lib/ai/remix-names";

const keys = (...combos: [string, string][]) =>
  combos.map(([template, colour]) => frameComboKey(template as FrameTemplate, colour));

async function remix(
  key: PrintingKey,
  override?: (raw: Record<string, unknown>) => Record<string, unknown>,
  options: { credits?: number; printing?: Record<string, unknown> } = {},
) {
  const raw = structuredClone(options.printing ?? printings[key]) as Record<string, unknown>;
  const printing = scryfallCardSchema.parse(override ? override(raw) : raw);
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
        {
          board: "main",
          quantity: 1,
          name: printing.name,
          card_id: null,
          scryfall_id: printing.id,
          // The plan's price for a double-faced entry (TODO 5.4).
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

beforeEach(() => {
  s.created = [];
  s.patched = [];
  s.reserved = [];
  // Like the real call: a second name only when a second half is sent.
  s.identity.mockReset().mockImplementation(async (input: { secondHalf?: unknown }) => ({
    title: "Remixed Name",
    flavor_text: "New flavour.",
    art_instruction: "A painted scene.",
    ...(input.secondHalf ? { second_title: "Remixed Page", second_flavor_text: null } : {}),
  }));
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
      back_face: { card_type: "instant", subtypes: ["Adventure"] },
    });
    // B3 (owner, 2026-09-29): the AI names BOTH halves in its one call; the
    // half keeps its rules, never the printing's name or artist.
    expect(s.identity).toHaveBeenCalledTimes(1);
    expect(s.identity.mock.calls[0][0]).toMatchObject({
      secondHalf: { layout: "adventure", face: { title: "Ardenvale Fealty", card_type: "instant" } },
    });
    expect(card?.title).toBe("Remixed Name");
    expect((card?.back_face as { title: string }).title).toBe("Remixed Page");
    expect((card?.back_face as { artist_credit?: string }).artist_credit).toBeUndefined();
    expect(step.label).toBe("Remixed Name // Remixed Page");
  });

  it("the rules text follows both new names (no real card's name left on the remix)", async () => {
    s.verified = keys(["adventure", "r"], ["m15", "r"]);
    // Scryfall's CURRENT oracle (captured 2026-09-28): a permanent says
    // "this creature" since the 2024 templating update, a spell still says
    // its own name — so the front reads as it did and Stomp's line follows.
    const { card } = await remix("eld-115", (raw) => {
      const faces = raw.card_faces as Record<string, unknown>[];
      faces[0].oracle_text =
        "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.";
      faces[1].oracle_text = "Damage can't be prevented this turn. Stomp deals 2 damage to any target.";
      return raw;
    });
    expect(card).toMatchObject({
      title: "Remixed Name",
      rules_text:
        "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.",
      back_face: {
        title: "Remixed Page",
        rules_text: "Damage can't be prevented this turn. Remixed Page deals 2 damage to any target.",
      },
    });
  });

  it("a one-faced landing renames the card's own mention too (Fire // Ice on M15, current oracle)", async () => {
    // Split is unverified here, so Fire // Ice lands one-faced on M15 with
    // Fire's text — which names Fire (a spell still names itself).
    s.verified = keys(["m15", "m"]);
    const { step, card } = await remix("dmr-215", (raw) => {
      const faces = raw.card_faces as Record<string, unknown>[];
      faces[0].oracle_text = "Fire deals 2 damage divided as you choose among one or two targets.";
      faces[1].oracle_text = "Tap target permanent.\nDraw a card.";
      return raw;
    });
    expect(step).toMatchObject({ status: "done", label: "Remixed Name" });
    expect(card).toMatchObject({
      frame_style: { template: "m15" },
      title: "Remixed Name",
      rules_text: "Remixed Name deals 2 damage divided as you choose among one or two targets.",
    });
    expect(card?.back_face).toBeUndefined();
  });

  it("a front that keeps an original name fails the step before the art and the save", async () => {
    s.verified = keys(["adventure", "r"], ["m15", "r"]);
    s.identity.mockResolvedValueOnce({
      title: "Bonecrusher Giant",
      flavor_text: null,
      art_instruction: "A painted scene.",
      second_title: "Remixed Page",
      second_flavor_text: null,
    });
    const { step, card } = await remix("eld-115");
    expect(step).toMatchObject({ status: "failed", error: REMIX_NAME_REUSED });
    expect(card).toBeUndefined();
    expect(s.image).not.toHaveBeenCalled();
  });

  it("a second half the AI didn't name fails the step before the art and the save", async () => {
    s.verified = keys(["adventure", "w"], ["m15", "w"]);
    s.identity.mockResolvedValueOnce({
      title: "Remixed Name",
      flavor_text: null,
      art_instruction: "A painted scene.",
    });
    const { step, card } = await remix("woe-38");
    expect(step).toMatchObject({ status: "failed", error: REMIX_SECOND_NAME_MISSING });
    expect(card).toBeUndefined();
    expect(s.image).not.toHaveBeenCalled();
  });

  it("the same printing on an unpublished layout frame saves as a one-faced card on its type's M15 frame", async () => {
    s.verified = keys(["m15", "w"]);
    const { card } = await remix("woe-38");
    expect(card).toMatchObject({ frame_style: { template: "m15" }, card_type: "enchantment" });
    expect(card?.back_face).toBeUndefined();
    // One face, one name: the identity is asked for no second half.
    expect(s.identity.mock.calls[0][0]).toMatchObject({ secondHalf: null });
    expect(s.identity.mock.calls[0][0].secondHalf).toBeNull();
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

// TODO 4.49 (b), owner decision 5: the token text box follows the text the
// remix SAVES — the printing's rules and the AI's flavour — not the text the
// printing's frame was picked for. Treasure TMSH #27 (colourless, printed
// with no text in this trimmed fixture).
describe("executeDeckRemixStep — a token's text box follows the saved text", () => {
  const BOTH = keys(["m15tokenartifact", "c"], ["m15tokenartifacttext", "c"]);

  it("a textless printing given the AI's flavour line saves on the text box", async () => {
    s.verified = BOTH;
    const { step, card } = await remix("tmsh-27");
    expect(step.status).toBe("done");
    expect(card).toMatchObject({
      frame_style: { template: "m15tokenartifacttext" },
      card_type: "token",
      flavor_text: "New flavour.",
    });
  });

  it("…and on the textless arch while the box isn't published in its colour (never an unpublished pair)", async () => {
    s.verified = keys(["m15tokenartifact", "c"]);
    const { card } = await remix("tmsh-27");
    expect(card).toMatchObject({ frame_style: { template: "m15tokenartifact" }, flavor_text: "New flavour." });
  });

  it("a flavour-only printing whose remix keeps no text saves without the box", async () => {
    s.verified = BOTH;
    s.identity.mockResolvedValueOnce({ title: "Remixed Name", flavor_text: null, art_instruction: "A painted scene." });
    const { card } = await remix("tmsh-27", (raw) => ({ ...raw, flavor_text: "Glittering." }));
    expect(card).toMatchObject({ frame_style: { template: "m15tokenartifact" } });
    expect(card?.flavor_text).toBeUndefined();
  });

  it("a printing with rules text keeps the box whatever the flavour", async () => {
    s.verified = BOTH;
    s.identity.mockResolvedValueOnce({ title: "Remixed Name", flavor_text: null, art_instruction: "A painted scene." });
    const { card } = await remix("tmsh-27", (raw) => ({
      ...raw,
      oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color.",
    }));
    expect(card).toMatchObject({
      frame_style: { template: "m15tokenartifacttext" },
      rules_text: "{T}, Sacrifice this artifact: Add one mana of any color.",
    });
  });
});

// ---------------------------------------------------------------------------
// TODO 5.4 — a DOUBLE-FACED printing (owner Q4: two credits, two pictures).
// The plan priced the entry (credits: 2); the step reserves that, lands on
// the transform front body with the back's body and colour, paints the back
// from the identity's second instruction, and hands both faces to the save.
// A one-credit entry stays one-faced; a priced entry whose bodies were
// un-ticked since fails plainly (and the wrapper refunds).
// ---------------------------------------------------------------------------

const BOTH_FACES = keys(["m15dfcfront", "w"], ["m15dfcbackleft", "r"], ["m15", "w"]);
const identityWithBackArt = {
  title: "Grim Warden",
  flavor_text: "New flavour.",
  art_instruction: "A soldier at dusk.",
  second_title: "Moonlit Ravager",
  second_flavor_text: null,
  second_art_instruction: "The same soldier as a werewolf under a red moon.",
};

describe("executeDeckRemixStep — a double-faced printing (TODO 5.4)", () => {
  it("reserves two credits, paints both faces and saves the back with its body and colour (MID #7)", async () => {
    s.verified = [...BOTH_FACES];
    s.identity.mockResolvedValueOnce(identityWithBackArt);
    const { step, card } = await remix("mid-7" as never, undefined, { credits: 2, printing: signaturePrintings["mid-7"] as never });
    expect(s.reserved).toEqual([2]);
    expect(step).toMatchObject({ status: "done", label: "Grim Warden // Moonlit Ravager" });
    expect(card).toMatchObject({
      frame_style: { template: "m15dfcfront", dfcIcon: "sunmoon" },
      card_type: "creature",
      color_identity: ["white"],
      back_face: {
        title: "Moonlit Ravager",
        card_type: "creature",
        frame_style: { template: "m15dfcbackleft" },
        color_identity: ["red"],
        art_url: "https://example.supabase.co/storage/v1/object/public/card-art/x.png",
      },
    });
    // The identity call saw the back as a transform back face…
    expect(s.identity.mock.calls[0][0]).toMatchObject({
      secondHalf: { layout: "transform", face: { title: "Moonrage Brute", card_type: "creature" } },
    });
    // …and two pictures were painted: the front's, then the back's from its
    // own instruction.
    expect(s.image).toHaveBeenCalledTimes(2);
    expect(String(s.image.mock.calls[1][0])).toContain("The same soldier as a werewolf under a red moon.");
    // A transform back saves with no cost; the printing's artist never rides.
    expect((card?.back_face as { cost?: string }).cost).toBeUndefined();
    expect((card?.back_face as { artist_credit?: string }).artist_credit).toBeUndefined();
  });

  it("a one-credit entry is remixed one-faced on the standard frame, whatever is ticked", async () => {
    s.verified = [...BOTH_FACES];
    const { step, card } = await remix("mid-7" as never, undefined, { printing: signaturePrintings["mid-7"] as never });
    expect(s.reserved).toEqual([1]);
    expect(step).toMatchObject({ status: "done", label: "Remixed Name" });
    expect(card).toMatchObject({ frame_style: { template: "m15" } });
    expect(card?.back_face).toBeUndefined();
    expect((card?.frame_style as { dfcIcon?: string }).dfcIcon).toBeUndefined();
    expect(s.image).toHaveBeenCalledTimes(1);
  });

  it("a failed back picture fails the step before the save (both credits refunded by the wrapper)", async () => {
    s.verified = [...BOTH_FACES];
    s.identity.mockResolvedValueOnce(identityWithBackArt);
    s.image
      .mockResolvedValueOnce({ ok: true, bytes: new Uint8Array([1]), contentType: "image/png" })
      .mockResolvedValueOnce({ ok: false, error: "The image model refused." });
    const { step, card } = await remix("mid-7" as never, undefined, { credits: 2, printing: signaturePrintings["mid-7"] as never });
    expect(step).toMatchObject({ status: "failed", error: "The image model refused." });
    expect(card).toBeUndefined();
  });

  it("an entry priced for both faces whose bodies aren't ticked any more fails plainly, before the identity and the art", async () => {
    s.verified = keys(["m15", "w"]);
    const { step, card } = await remix("mid-7" as never, undefined, { credits: 2, printing: signaturePrintings["mid-7"] as never });
    expect(step).toMatchObject({ status: "failed", error: REMIX_DFC_FRAMES_GONE });
    expect(card).toBeUndefined();
    expect(s.identity).not.toHaveBeenCalled();
    expect(s.image).not.toHaveBeenCalled();
  });
});
