import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// One Bulk Customize step (lib/tools/bulk-customize/step.ts). The plan is the
// owner's to insert (0059), so the step trusts nothing in it: the tool's gate
// again, the source from the caller's own rows, the card re-planned and its
// art RE-PRICED here; a card already saved is only linked (never a second
// card); the saved-card limit stops the run before a picture is stored; a
// spent Scryfall minute puts the step back in line instead of failing it.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  resolve: vi.fn(),
  importPatch: vi.fn(),
  writeCollection: vi.fn(),
  getCard: vi.fn(),
  scryfallRate: vi.fn(),
  uploadRate: vi.fn(),
  storeArt: vi.fn(),
  capacity: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
  credited: vi.fn(),
  plan: vi.fn(),
  remove: vi.fn(),
  event: vi.fn(),
}));

vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
// A failed card is recorded for the tool's analytics, after the response.
vi.mock("@/lib/tools/events", () => ({ recordToolEventLater: m.event }));
vi.mock("@/lib/tools/bulk-customize/server", () => ({
  resolveBulkSources: m.resolve,
  importPatchOf: m.importPatch,
  writeCollectionCustomized: m.writeCollection,
}));
vi.mock("@/lib/tools/bulk-customize/planner", () => ({ planCustomizedCard: m.plan }));
vi.mock("@/lib/scryfall/client", () => ({ getCardById: m.getCard }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: m.scryfallRate, logScryfallCall: vi.fn() }));
vi.mock("@/lib/scryfall/import-art", () => ({ storeScryfallArt: m.storeArt }));
vi.mock("@/lib/media/upload-rate-limit", () => ({ checkUploadRateLimit: m.uploadRate }));
vi.mock("@/lib/media/user-storage", () => ({ userFolder: () => ({ remove: m.remove }) }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => [] }));
vi.mock("@/lib/billing/entitlements", () => ({ getEntitlements: async () => ({ removeWatermark: true }) }));
vi.mock("@/lib/cards/capacity", () => ({ getCardCapacity: m.capacity }));
vi.mock("@/lib/cards/actions", () => ({ createCardAction: m.create }));
vi.mock("@/lib/decks/card-actions", () => ({ linkDeckCardAction: m.link }));
vi.mock("@/lib/ai/credited-step", () => ({ withCreditedStep: m.credited }));
vi.mock("@/lib/ai/rate-limit", () => ({ logAiCall: vi.fn() }));
vi.mock("@/lib/ai/image-gen", () => ({ generateImageWithFallbacks: vi.fn() }));
vi.mock("@/lib/ai/random-art", () => ({ persistGeneratedArt: vi.fn(), discardGeneratedArt: vi.fn() }));

import { bulkStepFailureReason, customizeSourceStep, runBulkCustomizeStep } from "@/lib/tools/bulk-customize/step";
import { generateImageWithFallbacks } from "@/lib/ai/image-gen";
import { persistGeneratedArt } from "@/lib/ai/random-art";
import { DEFAULT_BULK_CHOICES, type BulkChoices } from "@/lib/tools/bulk-customize/model";

const ENTRY_ID = "00000000-0000-4000-8000-000000000001";
const DEPS = { gameSystemId: async () => "gs-1", artistCredit: async () => "AI" };
const STEP: JobStep = { key: "bulk:0", label: "Llanowar Elves", status: "running" };

function planOf(choices: Partial<BulkChoices> = {}, credits = 0) {
  return {
    choices: { ...DEFAULT_BULK_CHOICES, look: "retro", ...choices },
    entries: [{ source: { kind: "deck_entry", id: ENTRY_ID }, name: "Llanowar Elves", credits }],
    skipped: 0,
  };
}

const PLANNED = {
  ok: true,
  title: "Llanowar Elves",
  payload: {
    title: "Llanowar Elves",
    color_identity: ["green"],
    card_type: "creature",
    subtypes: ["Elf", "Druid"],
    frame_style: { template: "retro" },
    watermark: null,
    visibility: "public",
    import_unchanged: false,
  },
  changes: ["frame"],
  notes: [],
  doubleFaced: false,
  credits: 0,
};

const run = (plan: unknown, step: JobStep = STEP) => runBulkCustomizeStep("u1", "job-1", plan, step, 0, DEPS);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.access.mockResolvedValue({ userId: "u1", via: "grant" });
  m.resolve.mockResolvedValue({
    resolved: [
      {
        key: `deck_entry:${ENTRY_ID}`,
        source: { kind: "deck_entry", id: ENTRY_ID },
        scryfallId: "sf-1",
        name: "Llanowar Elves",
        deckEntryId: ENTRY_ID,
      },
    ],
    skipped: [],
  });
  m.getCard.mockResolvedValue({ id: "sf-1", name: "Llanowar Elves", set: "dom" });
  m.importPatch.mockResolvedValue({});
  m.plan.mockReturnValue(PLANNED);
  m.capacity.mockResolvedValue({ used: 3, cap: 50, tier: "free" });
  m.scryfallRate.mockResolvedValue({ ok: true });
  m.uploadRate.mockResolvedValue({ ok: true });
  m.storeArt.mockResolvedValue({ ok: true, publicUrl: "https://x.supabase.co/storage/v1/object/public/card-art/u1/a.jpg", fileName: "a.jpg", artist: "Kev Walker", warning: null });
  m.remove.mockResolvedValue({ error: null });
  m.create.mockResolvedValue({ ok: true, cardId: "card-1" });
  m.link.mockResolvedValue({ ok: true });
  m.credited.mockImplementation(async (_u, _j, _amount, _reason, _step, body: () => Promise<JobStep>) => body());
});

describe("the step trusts nothing in the plan", () => {
  it("a closed tool fails the step before any read", async () => {
    m.access.mockResolvedValue(null);
    const result = await run(planOf());
    expect(result.status).toBe("failed");
    expect(m.resolve).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("another user's session can't run the step", async () => {
    m.access.mockResolvedValue({ userId: "someone-else", via: "grant" });
    expect((await run(planOf())).status).toBe("failed");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("a plan that doesn't read fails", async () => {
    expect((await run({ choices: { look: "everything" }, entries: [] })).status).toBe("failed");
    expect(m.resolve).not.toHaveBeenCalled();
  });

  it("a source the caller doesn't own fails (resolved from their own rows)", async () => {
    m.resolve.mockResolvedValue({ resolved: [], skipped: [{ key: "x", name: "A deck entry", reason: "Not found in your decks." }] });
    expect((await run(planOf())).status).toBe("failed");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("prices AI art from the planner, never from the plan's own number", async () => {
    m.plan.mockReturnValue({ ...PLANNED, changes: ["ai_art"], credits: 2, doubleFaced: true });
    m.credited.mockResolvedValue({ ...STEP, status: "failed", error: "Not enough credits." });
    await run(planOf({ art: "ai" }, 0));
    expect(m.credited).toHaveBeenCalledTimes(1);
    expect(m.credited.mock.calls[0][2]).toBe(2);
    expect(m.credited.mock.calls[0][3]).toBe("bulk_customize_art");
  });
});

describe("saving", () => {
  it("keeps the printing's art, saves through the card action and links the entry", async () => {
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("done");
    expect(result.card_id).toBe("card-1");
    expect(m.storeArt).toHaveBeenCalledWith("u1", expect.anything(), "art");
    const payload = m.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.art_url).toMatch(/card-art\/u1\//);
    expect(payload.artist_credit).toBe("Kev Walker");
    expect(payload.import_unchanged).toBe(false);
    expect(payload.game_system_id).toBe("gs-1");
    expect(m.link).toHaveBeenCalledWith(ENTRY_ID, "card-1", { surface: "deck" });
  });

  it("a card with no picture saves private", async () => {
    m.storeArt.mockResolvedValue({ ok: false, status: 404, error: "no art" });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("done");
    expect((m.create.mock.calls[0][0] as { visibility: string }).visibility).toBe("private");
    expect(result.note).toMatch(/without its art/);
  });

  it("a retry of a step whose card exists only links it — never a second card", async () => {
    const result = await run(planOf(), { ...STEP, card_id: "card-9" });
    expect(result.status).toBe("done");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.storeArt).not.toHaveBeenCalled();
    expect(m.link).toHaveBeenCalledWith(ENTRY_ID, "card-9", { surface: "deck" });
  });

  it("a link that doesn't land is a note, not a failure", async () => {
    m.link.mockResolvedValue({ ok: false, error: "nope" });
    const result = await run(planOf({ art: "later" }));
    expect(result.status).toBe("done");
    expect(result.note).toMatch(/not linked/);
  });
});

describe("limits", () => {
  it("a full card limit stops the run before any picture is stored", async () => {
    m.capacity.mockResolvedValue({ used: 50, cap: 50, tier: "free" });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("CARD_CAPACITY");
    expect(m.storeArt).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("the card action's capacity refusal stops the run too", async () => {
    m.create.mockResolvedValue({ ok: false, code: "UPGRADE_REQUIRED", reason: "capacity", formError: "Full." });
    const result = await run(planOf({ art: "later" }));
    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("CARD_CAPACITY");
  });

  it("a spent Scryfall minute puts the step back in line", async () => {
    m.scryfallRate.mockResolvedValue({ ok: false, reason: "per_minute", message: "Slow down.", retryAfterSeconds: 37 });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("pending");
    expect(result.error_code).toBe("RATE_LIMITED");
    expect(result.retry_after_seconds).toBe(37);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("a spent Scryfall day fails the step", async () => {
    m.scryfallRate.mockResolvedValue({ ok: false, reason: "per_day", message: "Come back tomorrow.", retryAfterSeconds: 3600 });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("failed");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("a spent Scryfall quota counts no upload", async () => {
    m.scryfallRate.mockResolvedValue({ ok: false, reason: "per_minute", message: "Slow down.", retryAfterSeconds: 37 });
    await run(planOf({ art: "keep" }));
    expect(m.uploadRate).not.toHaveBeenCalled();
  });

  it("a full upload DAY fails the step — a wait would never end", async () => {
    m.uploadRate.mockResolvedValue({ ok: false, window: "day", message: "Daily upload limit.", retryAfterSeconds: 3600 });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("failed");
    expect(result.error_code).toBeNull();
    expect(m.storeArt).not.toHaveBeenCalled();
  });

  it("a full upload MINUTE puts the step back in line", async () => {
    m.uploadRate.mockResolvedValue({ ok: false, window: "minute", message: "Slow down.", retryAfterSeconds: 12 });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("pending");
    expect(result.retry_after_seconds).toBe(12);
  });

  it("a double-faced card counts two uploads", async () => {
    m.plan.mockReturnValue({ ...PLANNED, doubleFaced: true });
    await run(planOf({ art: "keep" }));
    expect(m.uploadRate).toHaveBeenCalledTimes(2);
  });
});

describe("what a result carries", () => {
  it("a code from an earlier try never rides on the next outcome", async () => {
    const waited: JobStep = { ...STEP, error_code: "RATE_LIMITED", retry_after_seconds: 30 };
    const done = await run(planOf({ art: "later" }), waited);
    expect(done.status).toBe("done");
    expect(done.error_code).toBeNull();
    expect(done.retry_after_seconds).toBeNull();
    m.create.mockResolvedValue({ ok: false, formError: "Nope." });
    const failed = await run(planOf({ art: "later" }), waited);
    expect(failed.status).toBe("failed");
    expect(failed.error_code).toBeNull();
  });

  it("a save that doesn't land removes the art it stored", async () => {
    m.create.mockResolvedValue({ ok: false, formError: "Nope." });
    const result = await run(planOf({ art: "keep" }));
    expect(result.status).toBe("failed");
    expect(m.remove).toHaveBeenCalledWith(["a.jpg"]);
  });
});

describe("what a failed card records (`card_failed`)", () => {
  const eventsOf = () => m.event.mock.calls.map(([input]) => [input.event, input.props]);

  it("a card that was made records nothing here — the run's end counts it", async () => {
    expect((await run(planOf({ art: "keep" }))).status).toBe("done");
    expect(m.event).not.toHaveBeenCalled();
  });

  it("a step put back in line (a spent minute) is not a failure", async () => {
    m.scryfallRate.mockResolvedValue({ ok: false, reason: "per_minute", message: "Slow down.", retryAfterSeconds: 37 });
    expect((await run(planOf({ art: "keep" }))).status).toBe("pending");
    expect(m.event).not.toHaveBeenCalled();
  });

  it("the card limit, a refused save and a source that is gone are each a reason", async () => {
    m.capacity.mockResolvedValueOnce({ used: 50, cap: 50, tier: "free" });
    await run(planOf({ art: "keep" }));
    m.create.mockResolvedValueOnce({ ok: false, formError: "Nope." });
    await run(planOf({ art: "later" }));
    m.resolve.mockResolvedValueOnce({ resolved: [], skipped: [] });
    await run(planOf({ art: "later" }));
    expect(eventsOf()).toEqual([
      ["card_failed", { reason: "capacity", art: "keep", source: "deck_entry", refunded: false, refund_pending: false }],
      ["card_failed", { reason: "save_failed", art: "later", source: "deck_entry", refunded: false, refund_pending: false }],
      ["card_failed", { reason: "other", art: "later", source: "deck_entry", refunded: false, refund_pending: false }],
    ]);
    // Under the viewer and the access path the step's own gate handed it.
    expect(m.event).toHaveBeenCalledWith(expect.objectContaining({ slug: "bulk-customize", userId: "u1", access: "grant" }));
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Llanowar/);
  });

  it("a failed AI picture says its kind and that the credit came back", async () => {
    m.plan.mockReturnValue({ ...PLANNED, changes: ["ai_art"], credits: 1 });
    m.credited.mockResolvedValueOnce({ ...STEP, status: "failed", error: "Blocked.", failure: "art_blocked", refunded: 1, refund_pending: false });
    await run(planOf({ art: "ai" }, 1));
    m.credited.mockResolvedValueOnce({ ...STEP, status: "failed", error: "Out of credits.", error_code: "INSUFFICIENT_CREDITS" });
    await run(planOf({ art: "ai" }, 1));
    m.credited.mockResolvedValueOnce({ ...STEP, status: "failed", error: "Timed out.", failure: "art_timeout", refunded: 0, refund_pending: true });
    await run(planOf({ art: "ai" }, 1));
    expect(eventsOf()).toEqual([
      ["card_failed", { reason: "art_blocked", art: "ai", source: "deck_entry", refunded: true, refund_pending: false }],
      ["card_failed", { reason: "insufficient_credits", art: "ai", source: "deck_entry", refunded: false, refund_pending: false }],
      ["card_failed", { reason: "art_timeout", art: "ai", source: "deck_entry", refunded: false, refund_pending: true }],
    ]);
  });

  it("a closed tool records nothing (nobody was let in)", async () => {
    m.access.mockResolvedValue(null);
    expect((await run(planOf())).status).toBe("failed");
    expect(m.event).not.toHaveBeenCalled();
  });

  it("the reason is the plan limit, else the failure kind, else \"other\"", () => {
    expect(bulkStepFailureReason({ error_code: "CARD_CAPACITY", failure: "save_failed" })).toBe("capacity");
    expect(bulkStepFailureReason({ error_code: "INSUFFICIENT_CREDITS" })).toBe("insufficient_credits");
    expect(bulkStepFailureReason({ error_code: null, failure: "art_store" })).toBe("art_store");
    expect(bulkStepFailureReason({})).toBe("other");
  });
});

describe("a tool built on the core hands it the picture's prompt", () => {
  const paintWith = async (exact: boolean | undefined) => {
    const image = vi.mocked(generateImageWithFallbacks);
    image.mockReset();
    image.mockResolvedValue({ ok: false, error: "No picture.", failure: "art_failed", safetyBlocked: false });
    m.plan.mockReturnValue({ ...PLANNED, changes: ["ai_art"], credits: 1 });
    await customizeSourceStep(
      "u1",
      "job-1",
      STEP,
      {
        source: { kind: "deck_entry", id: ENTRY_ID },
        choices: { ...DEFAULT_BULK_CHOICES, art: "ai" },
        aiLabel: "deck_reart_art",
        artPrompt: () => ({ prompt: "A goblin chef, in thick oil paint.", style: "oil", ...(exact === undefined ? {} : { exact }) }),
      },
      DEPS,
    );
    return image.mock.calls[0][0] as string[];
  };

  it("a prompt that is its maker's own is dressed if refused, never swapped for one built from the card's name", async () => {
    const ladder = await paintWith(true);
    expect(ladder).toHaveLength(2);
    expect(ladder[0]).toBe("A goblin chef, in thick oil paint.");
    expect(ladder.join(" ")).not.toMatch(/Symbolic fantasy|Llanowar/);
  });

  it("any other prompt keeps the three rungs, ending on the card's name", async () => {
    for (const exact of [false, undefined]) {
      const ladder = await paintWith(exact);
      expect(ladder).toHaveLength(3);
      expect(ladder[2]).toMatch(/Symbolic fantasy[^.]*Llanowar Elves/);
    }
  });
});

describe("a tool built on the core may name the model that paints (Re-art's picker)", () => {
  const AI_ART = "https://x.supabase.co/storage/v1/object/public/card-art/u1/ai-1.jpg";
  type OnSaved = (cardId: string, art: { front: string | null; back: string | null }, models: string[]) => Promise<string | null>;
  const paint = async (options: { imageModel?: string; painter: string; doubleFaced?: boolean }) => {
    const image = vi.mocked(generateImageWithFallbacks);
    image.mockReset();
    image.mockResolvedValue({ ok: true, bytes: new Uint8Array([1]), contentType: "image/jpeg", model: options.painter, promptIndex: 0 });
    vi.mocked(persistGeneratedArt).mockReset();
    vi.mocked(persistGeneratedArt).mockResolvedValue({ ok: true, publicUrl: AI_ART } as Awaited<ReturnType<typeof persistGeneratedArt>>);
    m.plan.mockReturnValue({
      ...PLANNED,
      changes: ["ai_art"],
      credits: options.doubleFaced ? 2 : 1,
      doubleFaced: Boolean(options.doubleFaced),
      payload: options.doubleFaced
        ? { ...PLANNED.payload, back_face: { title: "Back", card_type: "creature", subtypes: [], frame_style: { template: "m15dfcback" } } }
        : PLANNED.payload,
    });
    const onSaved = vi.fn<OnSaved>(async () => null);
    const result = await customizeSourceStep(
      "u1",
      "job-1",
      STEP,
      {
        source: { kind: "deck_entry", id: ENTRY_ID },
        choices: { ...DEFAULT_BULK_CHOICES, art: "ai" },
        aiLabel: "deck_reart_art",
        ...(options.imageModel ? { imageModel: options.imageModel } : {}),
        onSaved,
      },
      DEPS,
    );
    return { result, image, onSaved };
  };

  it("the named model is handed to the image door for every picture, and the caller's record is told who painted", async () => {
    const { result, image, onSaved } = await paint({ imageModel: "bfl/flux-kontext-pro", painter: "bfl/flux-kontext-pro" });
    expect(result.status).toBe("done");
    expect(image.mock.calls[0][2]).toMatchObject({ model: "bfl/flux-kontext-pro" });
    expect(onSaved).toHaveBeenCalledWith("card-1", { front: AI_ART, back: null }, ["bfl/flux-kontext-pro"]);
  });

  it("no model named: the door's own default (and backup) — and the record still says who painted", async () => {
    const { image, onSaved } = await paint({ painter: "bfl/flux-2-flex" });
    expect(image.mock.calls[0][2]?.model).toBeUndefined();
    expect(image.mock.calls[0][2]?.budgetMs).toBeGreaterThan(0);
    expect(onSaved.mock.calls[0][2]).toEqual(["bfl/flux-2-flex"]);
  });

  it("a card with no AI picture names no painter", async () => {
    m.plan.mockReturnValue(PLANNED);
    const onSaved = vi.fn<OnSaved>(async () => null);
    await customizeSourceStep(
      "u1",
      "job-1",
      STEP,
      { source: { kind: "deck_entry", id: ENTRY_ID }, choices: { ...DEFAULT_BULK_CHOICES, art: "later" }, aiLabel: "deck_reart_art", onSaved },
      DEPS,
    );
    expect(onSaved.mock.calls[0][2]).toEqual([]);
  });
});

describe("the printing's lookup", () => {
  it("is on the caller's own Scryfall quota, whatever the art", async () => {
    m.scryfallRate.mockImplementation(async (_user: string, label: string) =>
      label === "named" ? { ok: false, reason: "per_day", message: "Come back tomorrow.", retryAfterSeconds: 3600 } : { ok: true },
    );
    const result = await run(planOf({ art: "later" }));
    expect(result.status).toBe("failed");
    expect(m.getCard).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
});
