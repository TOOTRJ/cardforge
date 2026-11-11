import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// What the Token Kit records for the admin's analytics (the 2026-11-10 tools
// audit): an action's OUTCOME — the success under its name, a refusal under
// `<name>_failed` with a `reason` code — after the response
// (recordToolEventLater), with counts and kinds only: never a token's words,
// a deck's name or the pasted list.
//   - the kit built (or reopened), or why it wasn't;
//   - a token saved to My Cards, or why not (the card limit among them);
//   - the autosave, only when it FAILS;
//   - the render route's refusals (a print file the plan doesn't have, a
//     token with no verified frame) and a render that threw;
//   - how a print / download ENDED, from the export provider's state.
// The browser's own events (art uploaded, the AI picture's outcome) are in
// token-kit-art-events.test.tsx.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  access: vi.fn(),
  event: vi.fn(),
  user: vi.fn(),
  deck: vi.fn(),
  deckCards: vi.fn(),
  scryfallRate: vi.fn(),
  build: vi.fn(),
  deckLines: vi.fn(),
  listLines: vi.fn(),
  kitRow: vi.fn(),
  upsert: vi.fn(),
  preview: vi.fn(),
  system: vi.fn(),
  create: vi.fn(),
  entitlements: vi.fn(),
  renderImage: vi.fn(),
  renderPrint: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/tools/queries", () => ({ checkToolAccess: m.access }));
vi.mock("@/lib/api/keyed-limit", () => ({ hitKeyedLimit: m.limit }));
vi.mock("@/lib/tools/events", () => ({ recordToolEvent: m.event, recordToolEventLater: m.event }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: m.user,
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: m.kitRow }) }) }),
      upsert: m.upsert,
    }),
  }),
}));
vi.mock("@/lib/cards/actions", () => ({ createCardAction: m.create }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => [] }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/cards/queries", () => ({ getFantasyGameSystem: m.system }));
vi.mock("@/lib/decks/queries", () => ({ getDeckById: m.deck, listDeckCards: m.deckCards }));
vi.mock("@/lib/media/media-urls", () => ({ isAllowedMediaUrl: (_bucket: string, url: unknown) => typeof url === "string" && url.length > 0 }));
vi.mock("@/lib/scryfall/rate-limit", () => ({ checkScryfallRateLimit: m.scryfallRate, logScryfallCall: vi.fn() }));
vi.mock("@/lib/tools/token-kit/server", () => ({
  buildKitFromLines: m.build,
  kitLinesOfDeck: m.deckLines,
  kitLinesOfList: m.listLines,
  listSourceKey: () => "list:abc",
}));
vi.mock("@/lib/tools/token-kit/model", async (original) => ({
  ...(await original<typeof import("@/lib/tools/token-kit/model")>()),
  kitPreviewData: m.preview,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: m.entitlements,
  downloadBrandMark: (viewer: { removeWatermark: boolean }) => !viewer.removeWatermark,
}));
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: m.renderImage }));
vi.mock("@/lib/render/card-print", () => ({ renderCardPrint: m.renderPrint }));

import { buildTokenKitAction, saveKitTokenToCardsAction, saveTokenKitAction } from "@/lib/tools/token-kit/actions";
import { DEFAULT_KIT_SETTINGS } from "@/lib/tools/token-kit/model";
import {
  KIT_RENDERS_PER_HOUR,
  KIT_RENDERS_PER_MINUTE,
  MAX_SAVED_ITEMS,
  kitExportOutcome,
  type KitExportSnapshot,
} from "@/lib/tools/token-kit/workspace";
import { POST as render } from "@/app/api/tools/token-kit/render/route";

const DECK_ID = "00000000-0000-4000-8000-000000000001";
const ACCESS = { userId: "u1", via: "admin" };

/** The tool event recorded: its name and props, under the viewer and the
 *  access path the gate handed the action. */
const recorded = (event: string, props: Record<string, unknown> = {}) =>
  expect.objectContaining({ slug: "token-kit", userId: "u1", access: "admin", event, props: expect.objectContaining(props) });
const eventsOf = () => m.event.mock.calls.map(([input]) => [input.event, input.props]);

const FACE = {
  kind: "token" as const,
  title: "Secret Goblin",
  typeWords: "Creature",
  subtypes: ["Goblin"],
  colors: ["red" as const],
  rulesText: null,
  flavorText: null,
  power: "1",
  toughness: "1",
};
const STATE = { include: true, copies: 2, artUrl: null, artistCredit: null, artPosition: null };
const item = (kind: "token" | "emblem" | "helper") => ({ key: `${kind}-1`, face: { ...FACE, kind }, makers: [], scryfallId: null, suggested: 1, why: [] });
const PREVIEW = { frame: { ok: true, template: "m20token", design: "fullart", standIn: false }, data: { frameStyle: {}, artPosition: {}, watermark: null } };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.access.mockResolvedValue(ACCESS);
  m.user.mockResolvedValue({ id: "u1" });
  m.scryfallRate.mockResolvedValue({ ok: true });
  m.kitRow.mockResolvedValue({ data: null, error: null });
  m.upsert.mockResolvedValue({ error: null });
  m.preview.mockReturnValue(PREVIEW);
  m.system.mockResolvedValue({ id: "gs-1" });
  m.entitlements.mockResolvedValue({ removeWatermark: true, maxExportPreset: "hd" });
  m.limit.mockResolvedValue({ ok: true });
});

describe("building a kit", () => {
  const lines = [{ name: "Krenko" }, { name: "Goblin Guide" }, { name: "Mountain" }];

  it("records what the kit holds — counts and kinds, never the deck or its cards", async () => {
    m.deck.mockResolvedValue({ id: DECK_ID, owner_id: "u1", title: "My secret deck" });
    m.deckCards.mockResolvedValue([]);
    m.deckLines.mockReturnValue(lines);
    m.build.mockResolvedValue({
      items: [item("token"), item("token"), item("emblem"), item("helper")],
      notFound: ["Mystery card"],
      missing: 0,
      doublers: [],
      realCardsFailed: false,
      calls: 2,
    });
    const result = await buildTokenKitAction({ kind: "deck", deckId: DECK_ID });
    expect(result.ok).toBe(true);
    expect(m.event).toHaveBeenCalledWith(recorded("kit_built"));
    expect(eventsOf()).toEqual([
      [
        "kit_built",
        { source: "deck", lines: 3, tokens: 2, emblems: 1, helpers: 1, not_found: 1, cached: false, reopened: false, scryfall_failed: false },
      ],
    ]);
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/secret|Mystery|Krenko/i);
  });

  it("a kit opened again says so", async () => {
    m.listLines.mockReturnValue({ lines });
    m.build.mockResolvedValue({ items: [], notFound: [], missing: 0, doublers: [], realCardsFailed: false, calls: 0 });
    m.kitRow.mockResolvedValue({ data: { settings: {}, items: {}, title: "Pasted list" }, error: null });
    expect((await buildTokenKitAction({ kind: "list", text: "1 Krenko" })).ok).toBe(true);
    expect(m.event).toHaveBeenCalledWith(recorded("kit_built", { source: "list", reopened: true, cached: true }));
  });

  it("each refusal is `kit_built_failed` with its reason", async () => {
    m.deck.mockResolvedValue({ id: DECK_ID, owner_id: "someone-else", title: "Theirs" });
    await buildTokenKitAction({ kind: "deck", deckId: DECK_ID });
    await buildTokenKitAction({ kind: "deck", deckId: "nope" });
    await buildTokenKitAction({ kind: "list", text: "   " });
    await buildTokenKitAction({ kind: "list", text: "x".repeat(200_000) });
    m.listLines.mockReturnValueOnce({ lines: [] });
    await buildTokenKitAction({ kind: "list", text: "not a list" });
    m.deck.mockResolvedValue({ id: DECK_ID, owner_id: "u1", title: "Empty" });
    m.deckCards.mockResolvedValue([]);
    m.deckLines.mockReturnValueOnce([]);
    await buildTokenKitAction({ kind: "deck", deckId: DECK_ID });
    m.listLines.mockReturnValueOnce({ lines });
    m.scryfallRate.mockResolvedValueOnce({ ok: false, message: "Slow down." });
    await buildTokenKitAction({ kind: "list", text: "1 Krenko" });
    await buildTokenKitAction({ kind: "nope" } as never);
    expect(eventsOf()).toEqual([
      ["kit_built_failed", { reason: "not_your_deck", source: "deck" }],
      ["kit_built_failed", { reason: "invalid", source: "deck" }],
      ["kit_built_failed", { reason: "empty_list", source: "list" }],
      ["kit_built_failed", { reason: "list_too_long", source: "list" }],
      ["kit_built_failed", { reason: "no_cards_found", source: "list" }],
      ["kit_built_failed", { reason: "empty_deck", source: "deck" }],
      ["kit_built_failed", { reason: "rate_limited", source: "list", lines: 3 }],
      ["kit_built_failed", { reason: "invalid", source: "unknown" }],
    ]);
    expect(m.build).not.toHaveBeenCalled();
  });

  it("a closed tool records nothing", async () => {
    m.access.mockResolvedValue(null);
    expect((await buildTokenKitAction({ kind: "deck", deckId: DECK_ID })).ok).toBe(false);
    expect((await saveKitTokenToCardsAction({ face: FACE, settings: DEFAULT_KIT_SETTINGS, state: STATE })).ok).toBe(false);
    expect((await saveTokenKitAction({})).ok).toBe(false);
    expect(m.event).not.toHaveBeenCalled();
  });
});

describe("saving a token to My Cards", () => {
  const save = (over: Record<string, unknown> = {}) =>
    saveKitTokenToCardsAction({ face: FACE, settings: DEFAULT_KIT_SETTINGS, state: STATE, ...over });

  it("a saved token records its kind, design and whether it has a picture", async () => {
    m.create.mockResolvedValue({ ok: true, cardId: "card-1", slug: "secret-goblin" });
    expect((await save({ state: { ...STATE, artUrl: "https://x/card-art/u1/a.png" } })).ok).toBe(true);
    expect(eventsOf()).toEqual([["token_saved", { kind: "token", design: "fullart", with_art: true }]]);
    expect(m.event).toHaveBeenCalledWith(recorded("token_saved"));
  });

  it("the card limit is its own reason; so is the card action's code, a field it refused, and no frame", async () => {
    m.create.mockResolvedValueOnce({ ok: false, code: "UPGRADE_REQUIRED", reason: "capacity", formError: "Your card limit is full." });
    expect(await save()).toMatchObject({ ok: false, capacity: true });
    m.create.mockResolvedValueOnce({ ok: false, code: "UPGRADE_REQUIRED", reason: "premium_frame", formError: "A paid frame." });
    expect((await save()).ok).toBe(false);
    m.create.mockResolvedValueOnce({ ok: false, fieldErrors: { title: "Too long." } });
    expect((await save()).ok).toBe(false);
    m.create.mockResolvedValueOnce({ ok: false, formError: "Something else." });
    expect((await save()).ok).toBe(false);
    m.preview.mockReturnValueOnce(null);
    expect((await save()).ok).toBe(false);
    m.system.mockResolvedValueOnce(null);
    expect((await save()).ok).toBe(false);
    expect((await saveKitTokenToCardsAction({ face: { kind: "nope" } })).ok).toBe(false);
    const about = { kind: "token", design: "fullart", with_art: false };
    expect(eventsOf()).toEqual([
      ["token_save_failed", { reason: "capacity", ...about }],
      ["token_save_failed", { reason: "upgrade_required", ...about }],
      ["token_save_failed", { reason: "field_error", ...about }],
      ["token_save_failed", { reason: "refused", ...about }],
      ["token_save_failed", { reason: "no_frame", kind: "token" }],
      ["token_save_failed", { reason: "unavailable", kind: "token" }],
      ["token_save_failed", { reason: "invalid" }],
    ]);
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Secret Goblin|Too long|limit is full/);
  });
});

describe("the autosave", () => {
  const kit = (over: Record<string, unknown> = {}) => ({
    sourceKey: `deck:${DECK_ID}`,
    deckId: DECK_ID,
    title: "My secret deck",
    sourceText: null,
    settings: DEFAULT_KIT_SETTINGS,
    items: { "token-1": STATE },
    ...over,
  });

  it("a save that worked records nothing (it runs after every change)", async () => {
    expect(await saveTokenKitAction(kit())).toEqual({ ok: true });
    expect(m.event).not.toHaveBeenCalled();
  });

  it("a save that failed says why", async () => {
    expect((await saveTokenKitAction({ nope: true })).ok).toBe(false);
    expect((await saveTokenKitAction(kit({ sourceKey: "deck:another" }))).ok).toBe(false);
    m.kitRow.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await saveTokenKitAction(kit())).ok).toBe(false);
    m.upsert.mockResolvedValueOnce({ error: { message: "boom" } });
    expect((await saveTokenKitAction(kit())).ok).toBe(false);
    expect(eventsOf()).toEqual([
      ["kit_save_failed", { reason: "invalid" }],
      ["kit_save_failed", { reason: "source_changed" }],
      ["kit_save_failed", { reason: "read_failed" }],
      ["kit_save_failed", { reason: "write_failed", tokens: 1 }],
    ]);
    expect(m.event).toHaveBeenCalledWith(recorded("kit_save_failed"));
  });
});

describe("the render route", () => {
  const post = (query = "") =>
    render(
      Object.assign(
        new Request(`http://x/api/tools/token-kit/render${query}`, {
          method: "POST",
          body: JSON.stringify({ face: FACE, settings: DEFAULT_KIT_SETTINGS, state: { artUrl: null, artistCredit: null, artPosition: null } }),
        }),
        { nextUrl: new URL(`http://x/api/tools/token-kit/render${query}`) },
      ) as unknown as NextRequest,
    );

  it("a render that worked records nothing (one of an export's many)", async () => {
    m.renderImage.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    expect((await post()).status).toBe(200);
    expect(m.event).not.toHaveBeenCalled();
  });

  it("a print file the viewer's plan doesn't have is `render_refused` with which file", async () => {
    m.entitlements.mockResolvedValue({ removeWatermark: false, maxExportPreset: "default" });
    expect((await post("?print=1")).status).toBe(403);
    expect((await post("?bleed=1")).status).toBe(403);
    expect((await post("?bleed=mpc")).status).toBe(403);
    expect(eventsOf()).toEqual([
      ["render_refused", { reason: "upgrade_required", file: "print", kind: "token" }],
      ["render_refused", { reason: "upgrade_required", file: "bleed", kind: "token" }],
      ["render_refused", { reason: "upgrade_required", file: "mpc", kind: "token" }],
    ]);
    expect(m.event).toHaveBeenCalledWith(recorded("render_refused"));
    expect(m.renderPrint).not.toHaveBeenCalled();
  });

  it("a token with no verified frame, and a renderer that threw", async () => {
    m.preview.mockReturnValueOnce(null);
    expect((await post()).status).toBe(422);
    m.renderImage.mockRejectedValueOnce(new Error("font missing: Secret Goblin"));
    expect((await post()).status).toBe(500);
    expect(eventsOf()).toEqual([
      ["render_refused", { reason: "no_frame", kind: "token", design: "fullart" }],
      ["render_failed", { reason: "render_error", kind: "token", design: "fullart", print: false }],
    ]);
    expect(JSON.stringify(m.event.mock.calls)).not.toMatch(/Secret Goblin/);
  });

  it("a viewer the tool doesn't let in records nothing", async () => {
    m.access.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(m.event).not.toHaveBeenCalled();
    expect(m.limit).not.toHaveBeenCalled();
  });

  it("every render counts against the viewer's own limit — above anything one export of a whole kit can do", async () => {
    m.renderImage.mockResolvedValue(new Response(new Uint8Array([1])));
    expect((await post()).status).toBe(200);
    expect(m.limit).toHaveBeenCalledWith(
      expect.objectContaining({ context: "token-kit-render", subject: ACCESS.userId, perMinute: KIT_RENDERS_PER_MINUTE, perHour: KIT_RENDERS_PER_HOUR }),
    );
    // The export renders three at a time and never retries a refusal.
    expect(KIT_RENDERS_PER_HOUR).toBeGreaterThanOrEqual(MAX_SAVED_ITEMS * 3);
    expect(KIT_RENDERS_PER_MINUTE).toBeGreaterThanOrEqual(MAX_SAVED_ITEMS);
  });

  it("past the limit: 429 with Retry-After, nothing rendered, nothing recorded (a loop must not fill the log)", async () => {
    m.limit.mockResolvedValue({ ok: false, retryAfterSeconds: 42, message: "Wait a few minutes." });
    const response = await post("?print=1");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(m.renderImage).not.toHaveBeenCalled();
    expect(m.renderPrint).not.toHaveBeenCalled();
    expect(m.entitlements).not.toHaveBeenCalled();
    expect(m.event).not.toHaveBeenCalled();
  });

  it("a body that is no token is refused before it is counted", async () => {
    const bad = Object.assign(new Request("http://x/api/tools/token-kit/render", { method: "POST", body: "{}" }), {
      nextUrl: new URL("http://x/api/tools/token-kit/render"),
    }) as unknown as NextRequest;
    expect((await render(bad)).status).toBe(400);
    expect(m.limit).not.toHaveBeenCalled();
  });
});

describe("kitExportOutcome — how a print / download ended", () => {
  const state = (over: Partial<KitExportSnapshot>): KitExportSnapshot => ({
    id: 1,
    subject: "kit",
    kind: "pdf",
    status: "rendering",
    total: 12,
    done: 0,
    failed: [],
    startedAt: 1_000,
    finishedAt: null,
    file: null,
    ...over,
  });

  it("nothing while it runs, and nothing for another subject's export", () => {
    expect(kitExportOutcome(null)).toBeNull();
    expect(kitExportOutcome(state({ status: "preparing" }))).toBeNull();
    expect(kitExportOutcome(state({ status: "packaging", done: 12 }))).toBeNull();
    expect(kitExportOutcome(state({ subject: "deck", status: "done" }))).toBeNull();
    expect(kitExportOutcome(state({ subject: "cards", status: "failed" }))).toBeNull();
  });

  it("a built file: the tokens asked for, in the file and left out, its size and how long it took", () => {
    expect(
      kitExportOutcome(
        state({ status: "done", done: 12, failed: ["Secret Goblin"], finishedAt: 43_000, file: { bytes: 5_242_880, cards: 11 } }),
      ),
    ).toEqual({ event: "kit_export_done", props: { kind: "pdf", tokens: 12, rendered: 11, failed: 1, kb: 5120, ms: 42_000 } });
  });

  it("no file: the maker cancelled, or it broke — a code, never the error's words or a token's name", () => {
    expect(kitExportOutcome(state({ kind: "zip", status: "cancelled", done: 4, finishedAt: 9_000 }))).toEqual({
      event: "kit_export_failed",
      props: { reason: "cancelled", kind: "zip", tokens: 12, rendered: 4, failed: 0, ms: 8_000 },
    });
    const broke = kitExportOutcome(state({ status: "failed", done: 12, failed: Array.from({ length: 12 }, () => "Secret Goblin"), finishedAt: 2_000 }));
    expect(broke).toEqual({ event: "kit_export_failed", props: { reason: "error", kind: "pdf", tokens: 12, rendered: 0, failed: 12, ms: 1_000 } });
    expect(JSON.stringify(broke)).not.toMatch(/Secret/);
  });
});
