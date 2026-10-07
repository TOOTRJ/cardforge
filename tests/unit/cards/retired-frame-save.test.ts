import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 4.54 through the card ACTIONS (the holo-stamp-save pattern), on the
// real profiles — its acceptance line: a payload, a draft and a remix that
// still carry "alphatoken" "save on the token frame their text asks for".
//   • createCardAction (the creator, a remix, every job): a payload naming
//     the retired value stores `m15tokentext` with rules or flavour text and
//     `m15token` without — never "alphatoken", never the creature frame —
//     and passes the verification gate of THAT frame;
//   • a remix opened in the creator (remixValuesFrom) starts on that frame
//     and saves on it;
//   • updateCardAction: an edit never sends its template, so the action
//     itself moves a stored retired value onto the frame the row reads as,
//     judged by the text the row holds AFTER the edit; every other stored
//     row's frame_style is left exactly as it was.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  existing: null as unknown,
  client: null as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => state.verified }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => state.existing,
  isSlugTakenForCurrentUser: async () => false,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: false, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createCardAction, updateCardAction } from "@/lib/cards/actions";
import { retiredFrameStyleRewrite, withRetiredFrameTemplate } from "@/lib/cards/card-display";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import type { Card } from "@/types/card";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "goblin" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const written = (stub: ReturnType<typeof db>, op: "insert" | "update") => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, op));
  return payloadOf(entry?.calls ?? [], op) as Record<string, unknown> | undefined;
};

function payload(over: Record<string, unknown> = {}) {
  return {
    title: "Goblin",
    game_system_id: GAME,
    color_identity: ["red"],
    card_type: "token",
    supertype: "Creature",
    subtypes: ["Goblin"],
    rarity: "common",
    power: "1",
    toughness: "1",
    art_url: "https://example.com/art.png",
    visibility: "public",
    frame_style: { template: "alphatoken", finish: "regular" },
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Goblin",
    slug: "goblin",
    color_identity: ["red"],
    card_type: "token",
    rarity: "common",
    supertype: "Creature",
    subtypes: ["Goblin"],
    rules_text: null,
    flavor_text: null,
    power: "1",
    toughness: "1",
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: null,
    frame_preview: false,
    frame_style: { template: "alphatoken", finish: "regular" },
    ...over,
  };
}

beforeEach(() => {
  state.verified = ["m15token/r", "m15tokentext/r", "m15/r"];
  state.existing = null;
});

describe("the two helpers", () => {
  it("withRetiredFrameTemplate rewrites only a payload that names a retired template", () => {
    expect(withRetiredFrameTemplate(payload())).toMatchObject({ frame_style: { template: "m15token", finish: "regular" } });
    expect(withRetiredFrameTemplate(payload({ rules_text: "Haste" }))).toMatchObject({ frame_style: { template: "m15tokentext" } });
    expect(withRetiredFrameTemplate(payload({ flavor_text: "x" }))).toMatchObject({ frame_style: { template: "m15tokentext" } });
    expect(withRetiredFrameTemplate(payload({ rules_text: "  ", flavor_text: 7 }))).toMatchObject({ frame_style: { template: "m15token" } });
    // Untouched, the SAME object: a current template, an unknown one, no
    // frame_style, a malformed one, a non-object.
    for (const same of [
      payload({ frame_style: { template: "m15token" }, rules_text: "Haste" }),
      payload({ frame_style: { template: "nope" } }),
      payload({ frame_style: undefined }),
      payload({ frame_style: null }),
      payload({ frame_style: "alphatoken" }),
      payload({ frame_style: ["alphatoken"] }),
      payload({ frame_style: { template: 3 } }),
      null,
      undefined,
      "alphatoken",
      ["alphatoken"],
    ]) {
      expect(withRetiredFrameTemplate(same)).toBe(same);
    }
    // Never mutates its input.
    const input = payload({ rules_text: "Haste" });
    withRetiredFrameTemplate(input);
    expect(input.frame_style).toEqual({ template: "alphatoken", finish: "regular" });
  });

  it("retiredFrameStyleRewrite answers only for a stored retired template, keeping every other key", () => {
    expect(retiredFrameStyleRewrite({ template: "alphatoken", finish: "foil" }, { rules_text: null })).toEqual({ template: "m15token", finish: "foil" });
    expect(retiredFrameStyleRewrite({ template: "alphatoken" }, { rules_text: "Haste" })).toEqual({ template: "m15tokentext" });
    for (const style of [{ template: "m15token" }, { template: "m15" }, { template: "regular" }, {}, null, undefined, { template: 4 }]) {
      expect(retiredFrameStyleRewrite(style as never, { rules_text: "Haste" })).toBeNull();
    }
  });
});

describe("createCardAction — a payload that still names the retired frame", () => {
  it("saves on the M15 token without text and on its text-box frame with rules or flavour text", async () => {
    for (const [text, template] of [
      [{}, "m15token"],
      [{ rules_text: "Haste" }, "m15tokentext"],
      [{ flavor_text: "Enemies of the heir, beware." }, "m15tokentext"],
      [{ rules_text: "   " }, "m15token"],
    ] as const) {
      const stub = db();
      const result = await createCardAction(payload(text));
      expect(result.ok, template).toBe(true);
      expect((written(stub, "insert")?.frame_style as Record<string, unknown>).template, JSON.stringify(text)).toBe(template);
    }
  });

  it("is gated on the frame it lands on, not on the creature frame", async () => {
    // Only the creature frame verified: refused, nothing written.
    state.verified = ["m15/r"];
    let stub = db();
    expect((await createCardAction(payload())).ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
    // The text-box frame not verified in this colour: a card with text is refused…
    state.verified = ["m15token/r"];
    stub = db();
    expect((await createCardAction(payload({ rules_text: "Haste" }))).ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
    // …and the same card without text saves.
    stub = db();
    expect((await createCardAction(payload())).ok).toBe(true);
    expect(written(stub, "insert")?.frame_style).toMatchObject({ template: "m15token" });
  });

  it("an Artifact token and a P/T-less Copy store exactly what the same payload stores on the frame by name", async () => {
    state.verified = ["m15token/c", "m15tokentext/c", "m15token/r"];
    for (const [over, template] of [
      [
        { supertype: "Artifact", subtypes: ["Treasure"], color_identity: ["colorless"], power: undefined, toughness: undefined, rules_text: "{T}, Sacrifice this artifact: Add one mana of any color." },
        "m15tokentext",
      ],
      [{ supertype: undefined, subtypes: [], power: undefined, toughness: undefined }, "m15token"],
    ] as const) {
      const retired = db();
      expect((await createCardAction(payload(over))).ok).toBe(true);
      const named = db();
      expect((await createCardAction(payload({ ...over, frame_style: { template, finish: "regular" } }))).ok).toBe(true);
      // The anatomy defaults are the token frame's, never the creature
      // frame's (which the unknown value used to read as).
      expect(written(retired, "insert")).toEqual(written(named, "insert"));
      expect((written(retired, "insert")?.frame_style as Record<string, unknown>).template).toBe(template);
    }
  });
});

describe("a remix opened in the creator", () => {
  it("starts on the frame the parent reads as and saves on it", async () => {
    for (const [text, template] of [
      [null, "m15token"],
      ["Haste", "m15tokentext"],
    ] as const) {
      const parent = stored({ rules_text: text });
      state.existing = parent;
      const values = remixValuesFrom(parent as unknown as Card, []);
      expect(values.frame_style.template, String(text)).toBe(template);
      const stub = db();
      const result = await createCardAction(
        payload({ title: values.title, rules_text: text ?? undefined, frame_style: values.frame_style, parent_card_id: CARD }),
      );
      expect(result, String(text)).toMatchObject({ ok: true });
      expect((written(stub, "insert")?.frame_style as Record<string, unknown>).template).toBe(template);
    }
  });
});

describe("updateCardAction — a stored row on the retired frame", () => {
  it("an edit that never names the frame stores the frame the row reads as", async () => {
    for (const [storedText, patch, template] of [
      [null, { title: "Goblin Scout" }, "m15token"],
      ["Haste", { title: "Goblin Scout" }, "m15tokentext"],
      // Judged by the text the row holds AFTER the edit.
      [null, { rules_text: "Haste" }, "m15tokentext"],
      ["Haste", { rules_text: "" }, "m15token"],
      [null, { flavor_text: "Enemies of the heir, beware." }, "m15tokentext"],
      [null, { visibility: "private" }, "m15token"],
    ] as const) {
      const card = stored({ rules_text: storedText });
      state.existing = card;
      const stub = db();
      const result = await updateCardAction(CARD, patch);
      expect(result, JSON.stringify(patch)).toMatchObject({ ok: true });
      expect(written(stub, "update")?.frame_style, JSON.stringify([storedText, patch])).toEqual({ template, finish: "regular" });
    }
  });

  it("the creator's own edit payload does it too (it sends no template, and no anatomy patch)", async () => {
    const card = stored({ rules_text: "Haste" });
    state.existing = card;
    const values = defaultValuesFor(card as unknown as Card, []);
    // The form opens on the text-box frame…
    expect(values.frame_style.template).toBe("m15tokentext");
    // …and offers no anatomy switch for it.
    expect(frameAnatomyPatchFor(card as unknown as Card, values)).toBeUndefined();
    const stub = db();
    const result = await updateCardAction(CARD, { title: "Goblin Scout", frame_anatomy: frameAnatomyPatchFor(card as unknown as Card, values) });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toEqual({ template: "m15tokentext", finish: "regular" });
  });

  it("is not stopped by the verification gate: the card already draws on that frame", async () => {
    state.verified = [];
    state.existing = stored({ rules_text: "Haste" });
    const stub = db();
    expect((await updateCardAction(CARD, { title: "Goblin Scout" })).ok).toBe(true);
    expect(written(stub, "update")?.frame_style).toMatchObject({ template: "m15tokentext" });
  });

  it("an anatomy flip on such a row is judged by the token frame, as on a row stored on it", async () => {
    const patch = { frame_anatomy: { crown: true, collector: "2023", stamp: "oval" } } as const;
    state.existing = stored();
    const retired = db();
    expect((await updateCardAction(CARD, patch)).ok).toBe(true);
    state.existing = stored({ frame_style: { template: "m15token", finish: "regular" } });
    const named = db();
    expect((await updateCardAction(CARD, patch)).ok).toBe(true);
    expect(written(retired, "update")?.frame_style).toEqual(written(named, "update")?.frame_style);
    // The token frame has no crown and no stamp notch (the creature frame,
    // which the unknown value used to read as, has both).
    const style = written(retired, "update")?.frame_style as Record<string, unknown>;
    expect(style.template).toBe("m15token");
    expect("crown" in style).toBe(false);
    expect("stamp" in style).toBe(false);
  });

  it("leaves every other stored frame_style alone", async () => {
    for (const frame_style of [{ template: "m15token", finish: "regular" }, { template: "m15tokentext" }, { template: "regular" }, {}, null]) {
      state.existing = stored({ frame_style, rules_text: "Haste" });
      const stub = db();
      const result = await updateCardAction(CARD, { title: "Goblin Scout" });
      expect(result.ok, JSON.stringify(frame_style)).toBe(true);
      expect("frame_style" in (written(stub, "update") ?? {}), JSON.stringify(frame_style)).toBe(false);
    }
  });
});
