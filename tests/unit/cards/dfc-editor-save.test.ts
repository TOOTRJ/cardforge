import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 5.2 — a double-faced card through the card ACTIONS on the REAL
// transform bodies (5.1a), with a mocked `frame_reviews` set: the gates of
// lib/cards/dfc-gate.ts as createCardAction and updateCardAction apply them
// (client AND server share the rule; this is the server), the family stamp,
// the public-needs-both-arts rule and the stored-body-wins edit.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
  verifiedReads: 0,
  existing: null as unknown,
  client: null as unknown,
  admin: false,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: state.admin }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => false }));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => {
    state.verifiedReads += 1;
    return state.verified;
  },
}));
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
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import {
  DFC_BACK_BODY_MISMATCH,
  DFC_BACK_BODY_SET,
  DFC_BACK_TYPE_REFUSED,
  DFC_COLORLESS_FRONT_NEEDS_ARTIFACT,
  DFC_COLORLESS_NEEDS_ARTIFACT,
  DFC_FRONT_HAS_NO_BACK,
  DFC_NEEDS_BACK_FACE,
} from "@/lib/cards/dfc-gate";

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "delver" }, error: null };
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

const BACK = {
  title: "Insectile Aberration",
  card_type: "creature",
  subtypes: ["Human", "Insect"],
  power: "3",
  toughness: "2",
  rules_text: "Flying",
  art_url: "https://example.com/back.png",
  art_position: { scale: 1, focalX: 0.5, focalY: 0.5 },
};

function payload(over: Record<string, unknown> = {}) {
  return {
    title: "Delver of Secrets",
    game_system_id: GAME,
    cost: "{U}",
    color_identity: ["blue"],
    card_type: "creature",
    power: "1",
    toughness: "1",
    art_url: "https://example.com/art.png",
    frame_style: { template: "m15dfcfront", finish: "regular" },
    visibility: "public",
    back_face: BACK,
    ...over,
  };
}

function stored(over: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    title: "Delver of Secrets",
    slug: "delver",
    color_identity: ["blue"],
    card_type: "creature",
    supertype: null,
    subtypes: [],
    rules_text: null,
    visibility: "public",
    art_url: "https://example.com/art.png",
    back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] },
    frame_preview: false,
    frame_style: { template: "m15dfcfront", finish: "regular", collector: "2023", dfcIcon: "arrows" },
    ...over,
  };
}

beforeEach(() => {
  state.verified = [
    frameComboKey("m15", "u"),
    frameComboKey("m15dfcfront", "u"),
    frameComboKey("m15dfcfront", "c"),
    frameComboKey("m15dfclandfront", "c"),
    frameComboKey("m15dfcback", "u"),
    frameComboKey("m15dfcback", "g"),
    frameComboKey("m15dfcback", "c"),
    frameComboKey("m15dfcbackleft", "g"),
    frameComboKey("m15dfclandback", "c"),
  ];
  state.verifiedReads = 0;
  state.existing = null;
  state.admin = false;
});

describe("createCardAction on a transform front", () => {
  it("stores the derived back body, the back's colour (the front's) and the family's default; a public save with both arts stays public", async () => {
    const stub = db();
    const result = await createCardAction(payload());
    expect(result.ok).toBe(true);
    const row = written(stub, "insert")!;
    expect(row.frame_style).toEqual({ template: "m15dfcfront", finish: "regular", collector: "2023", dfcIcon: "arrows" });
    expect(row.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] });
    expect(row.visibility).toBe("public");
    // The verified set was read once for both gates.
    expect(state.verifiedReads).toBe(1);
  });

  it("the payload's family picks the back body; a transform back's cost is stripped; crown and two-colour are dropped (D17)", async () => {
    const stub = db();
    const result = await createCardAction(
      payload({
        frame_style: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon", crown: true, twoColor: true },
        back_face: { ...BACK, cost: "{1}{G}", color_identity: ["green"] },
      }),
    );
    expect(result.ok).toBe(true);
    const row = written(stub, "insert")!;
    expect(row.frame_style).toEqual({ template: "m15dfcfront", finish: "regular", collector: "2023", dfcIcon: "sunmoon" });
    expect(row.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcbackleft" }, color_identity: ["green"] });
  });

  it("a land front // creature back, and a creature front // land back, each on their pair", async () => {
    const landFront = db();
    expect(
      (await createCardAction(payload({ card_type: "land", cost: undefined, color_identity: ["colorless"], frame_style: { template: "m15dfclandfront" }, back_face: { ...BACK, color_identity: ["blue"] } }))).ok,
    ).toBe(true);
    expect((written(landFront, "insert")!.back_face as { frame_style: unknown }).frame_style).toEqual({ template: "m15dfcback" });
    const landBack = db();
    expect((await createCardAction(payload({ back_face: { ...BACK, card_type: "land", color_identity: ["colorless"] } }))).ok).toBe(true);
    expect((written(landBack, "insert")!.back_face as { frame_style: unknown }).frame_style).toEqual({ template: "m15dfclandback" });
  });

  it("a public save without the back's art lands as a draft (private) — the front's rule on both faces (D13)", async () => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: { ...BACK, art_url: undefined } }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")!.visibility).toBe("private");
    // Unlisted stays unlisted (link-only WIP), as the front.
    const unlisted = db();
    expect((await createCardAction(payload({ visibility: "unlisted", back_face: { ...BACK, art_url: undefined } }))).ok).toBe(true);
    expect(written(unlisted, "insert")!.visibility).toBe("unlisted");
  });

  it.each([
    ["no back face", { back_face: null }, "back_face.frame_style", DFC_NEEDS_BACK_FACE],
    ["a walker back", { back_face: { ...BACK, card_type: "planeswalker" } }, "back_face.card_type", DFC_BACK_TYPE_REFUSED],
    ["a crafted other body", { back_face: { ...BACK, frame_style: { template: "m15dfcbackleft" } } }, "back_face.frame_style", DFC_BACK_BODY_MISMATCH],
    ["a colourless Eldrazi back", { back_face: { ...BACK, color_identity: ["colorless"] } }, "back_face.color_identity", DFC_COLORLESS_NEEDS_ARTIFACT],
  ])("refuses %s and writes nothing", async (_label, over, field, message) => {
    const stub = db();
    const result = await createCardAction(payload(over));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.fieldErrors).toEqual({ [field]: message });
    expect(written(stub, "insert")).toBeUndefined();
  });

  it("refuses a back colour the back body isn't verified in — the front being verified is not enough", async () => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: { ...BACK, color_identity: ["red"] } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.fieldErrors?.["back_face.color_identity"]).toMatch(/isn't available in red yet/);
    expect(written(stub, "insert")).toBeUndefined();
    // …and the front's colour when the back names none.
    const front = db();
    state.verified.push(frameComboKey("m15dfcfront", "r"));
    const result2 = await createCardAction(payload({ color_identity: ["red"] }));
    expect(result2.ok).toBe(false);
    expect(written(front, "insert")).toBeUndefined();
  });

  it("a colourless creature FRONT is refused (D2); a colourless artifact front passes", async () => {
    const refused = db();
    const result = await createCardAction(payload({ color_identity: ["colorless"], back_face: { ...BACK, color_identity: ["blue"] } }));
    expect(result.ok ? null : result.fieldErrors).toEqual({ color_identity: DFC_COLORLESS_FRONT_NEEDS_ARTIFACT });
    expect(written(refused, "insert")).toBeUndefined();
    const artifact = db();
    const ok = await createCardAction(payload({ card_type: "artifact", power: undefined, toughness: undefined, color_identity: ["colorless"], back_face: { ...BACK, color_identity: ["blue"] } }));
    expect(ok.ok).toBe(true);
    expect(written(artifact, "insert")!.color_identity).toEqual(["colorless"]);
  });

  it("a colourless ARTIFACT back passes (the `c` row is the artifact stand-in, D2)", async () => {
    const stub = db();
    expect((await createCardAction(payload({ back_face: { ...BACK, card_type: "artifact", color_identity: ["colorless"] } }))).ok).toBe(true);
    expect((written(stub, "insert")!.back_face as { color_identity: unknown }).color_identity).toEqual(["colorless"]);
  });

  it("a crafted back body on a non-DFC kind is refused (the front first)", async () => {
    for (const front of ["m15", "m15artifact", "saga"] as const) {
      const stub = db();
      state.verified.push(frameComboKey(front, "u"));
      const result = await createCardAction(
        payload({ card_type: front === "saga" ? "enchantment" : "creature", frame_style: { template: front }, back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] } }),
      );
      expect(result.ok, front).toBe(false);
      expect(result.ok ? null : result.fieldErrors, front).toEqual({ "back_face.frame_style": DFC_FRONT_HAS_NO_BACK });
      expect(written(stub, "insert"), front).toBeUndefined();
    }
  });

  it("an admin's frame preview skips the back's verification too and lands private", async () => {
    state.admin = true;
    const stub = db();
    const result = await createCardAction(payload({ frame_preview: true, back_face: { ...BACK, color_identity: ["red"] } }));
    expect(result.ok).toBe(true);
    const row = written(stub, "insert")!;
    expect(row.visibility).toBe("private");
    expect(row.frame_preview).toBe(true);
    expect((row.back_face as { color_identity: unknown }).color_identity).toEqual(["red"]);
    expect(state.verifiedReads).toBe(0);
  });
});

describe("updateCardAction on a stored transform card", () => {
  it("a content edit leaves the back alone and reads no verified keys", async () => {
    state.existing = stored();
    const stub = db();
    expect((await updateCardAction(CARD, { title: "Delver of Secrets, Reborn" })).ok).toBe(true);
    expect(written(stub, "update")).not.toHaveProperty("back_face");
    expect(state.verifiedReads).toBe(0);
  });

  it("a back_face patch keeps the STORED body whatever it carries, with its content and colour", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, {
      back_face: { ...BACK, rules_text: "Flying\nTrample", frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] },
    });
    expect(result.ok).toBe(true);
    expect(written(stub, "update")!.back_face).toEqual({ ...BACK, rules_text: "Flying\nTrample", frame_style: { template: "m15dfcback" }, color_identity: ["blue"] });
  });

  it("a changed back colour is verified for the body; the same colour is not re-checked", async () => {
    state.existing = stored();
    const green = db();
    expect((await updateCardAction(CARD, { back_face: { ...BACK, color_identity: ["green"] } })).ok).toBe(true);
    expect((written(green, "update")!.back_face as { color_identity: unknown }).color_identity).toEqual(["green"]);
    const red = db();
    const refused = await updateCardAction(CARD, { back_face: { ...BACK, color_identity: ["red"] } });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? null : refused.fieldErrors?.["back_face.color_identity"]).toMatch(/isn't available in red yet/);
    expect(written(red, "update")).toBeUndefined();
  });

  it("a frame_anatomy family change re-derives the back body — verified in the back's colour, or refused", async () => {
    state.existing = stored({ back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["green"] } });
    const ok = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "sunmoon" } });
    expect(result.ok).toBe(true);
    const row = written(ok, "update")!;
    expect((row.frame_style as { dfcIcon: unknown }).dfcIcon).toBe("sunmoon");
    expect(row.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcbackleft" }, color_identity: ["green"] });

    state.existing = stored();
    const refused = db();
    const result2 = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "sunmoon" } });
    expect(result2.ok).toBe(false);
    expect(result2.ok ? null : result2.fieldErrors?.["back_face.color_identity"]).toMatch(/isn't available in blue yet/);
    expect(written(refused, "update")).toBeUndefined();
  });

  it("a back type that would derive another body is refused; removing the back face is refused", async () => {
    state.existing = stored();
    const land = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, card_type: "land" } });
    expect(result.ok ? null : result.fieldErrors).toEqual({ "back_face.card_type": DFC_BACK_BODY_SET });
    expect(written(land, "update")).toBeUndefined();
    const cleared = db();
    const result2 = await updateCardAction(CARD, { back_face: null });
    expect(result2.ok ? null : result2.fieldErrors).toEqual({ "back_face.frame_style": DFC_NEEDS_BACK_FACE });
    expect(written(cleared, "update")).toBeUndefined();
  });

  it("a frame_style-only patch moving the front off the DFC body takes the back's body and colour off with it", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_style: { template: "m15", finish: "regular" } });
    expect(result.ok).toBe(true);
    const row = written(stub, "update")!;
    expect(row.frame_style).toEqual({ template: "m15", finish: "regular" });
    expect(row.back_face).toEqual(BACK);
  });

  it("publishing a transform card whose back has no art lands private", async () => {
    state.existing = stored({ visibility: "private", back_face: { ...BACK, art_url: undefined, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] } });
    const stub = db();
    expect((await updateCardAction(CARD, { visibility: "public" })).ok).toBe(true);
    expect(written(stub, "update")!.visibility).toBe("private");
  });

  it("a patch that makes a DFC front colourless without an Artifact word is refused; a content edit of a stored one isn't re-judged", async () => {
    state.existing = stored();
    const refused = db();
    const result = await updateCardAction(CARD, { color_identity: ["colorless"] });
    expect(result.ok ? null : result.fieldErrors).toEqual({ color_identity: DFC_COLORLESS_FRONT_NEEDS_ARTIFACT });
    expect(written(refused, "update")).toBeUndefined();
    state.existing = stored({ color_identity: ["colorless"] });
    const kept = db();
    expect((await updateCardAction(CARD, { title: "Still here" })).ok).toBe(true);
    expect(written(kept, "update")!.title).toBe("Still here");
  });

  it("the retired back_card_id is accepted only to clear", async () => {
    state.existing = stored();
    const cleared = db();
    expect((await updateCardAction(CARD, { back_card_id: null })).ok).toBe(true);
    expect(written(cleared, "update")!.back_card_id).toBeNull();
    const linked = await updateCardAction(CARD, { back_card_id: "44444444-4444-4444-8444-444444444444" });
    expect(linked.ok).toBe(false);
  });
});
