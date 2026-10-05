import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 5.2 skeptic pass — crafted payloads through the REAL createCardAction /
// updateCardAction on the transform bodies: every path that could store a
// back body the gate should refuse, or lose one it should keep. The 5.2
// follow-up (owner 2026-10-05) adds the back's COLOUR lock: on a card whose
// back has a body the stored colour wins like the body does — a patch
// naming another is refused, verified or not, admin preview or not; a
// legacy back, a body-less back and a create stay free.
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
import { DFC_BACK_COLOR_SET, DFC_FRONT_BODY_MISMATCH, DFC_FRONT_TYPE_REFUSED } from "@/lib/cards/dfc-gate";

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
    frameComboKey("m15", "c"),
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

describe("create: the back's body and type", () => {
  it.each([
    ["token", "token"],
    ["emblem", "emblem"],
    ["battle", "battle"],
    ["planeswalker", "planeswalker"],
  ])("refuses a %s back", async (_label, type) => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: { ...BACK, card_type: type } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : Object.keys(result.fieldErrors ?? {})).toEqual(["back_face.card_type"]);
    expect(written(stub, "insert")).toBeUndefined();
  });

  it.each([
    ["a FRONT body as the back", "m15dfcfront"],
    ["the land front as the back", "m15dfclandfront"],
    ["a plain m15 as the back", "m15"],
    ["the land back under a creature back", "m15dfclandback"],
  ])("refuses %s", async (_label, template) => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: { ...BACK, frame_style: { template } } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : Object.keys(result.fieldErrors ?? {})).toEqual(["back_face.frame_style"]);
    expect(written(stub, "insert")).toBeUndefined();
  });

  it("a back body the payload names that IS the derived one passes, and the gate still verifies its colour", async () => {
    const ok = db();
    expect((await createCardAction(payload({ back_face: { ...BACK, frame_style: { template: "m15dfcback" } } }))).ok).toBe(true);
    expect((written(ok, "insert")!.back_face as { frame_style: unknown }).frame_style).toEqual({ template: "m15dfcback" });
    // The same body in a colour it isn't verified in: refused.
    const red = db();
    const result = await createCardAction(payload({ back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["red"] } }));
    expect(result.ok).toBe(false);
    expect(written(red, "insert")).toBeUndefined();
  });

  it("a transform back WITH a cost is stripped, not refused", async () => {
    const stub = db();
    const result = await createCardAction(payload({ back_face: { ...BACK, cost: "{2}{U}" } }));
    expect(result.ok).toBe(true);
    const back = written(stub, "insert")!.back_face as Record<string, unknown>;
    expect(back).not.toHaveProperty("cost");
  });

  it("a colourless `c` back on a creature with an Artifact SUPERTYPE word passes; a bare 'Artifact' supertype on a land back is the land pair (any)", async () => {
    const stub = db();
    const result = await createCardAction(
      payload({ back_face: { ...BACK, supertype: "Artifact", color_identity: ["colorless"] } }),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((written(stub, "insert")!.back_face as { color_identity: unknown }).color_identity).toEqual(["colorless"]);
  });

  it("a non-admin claiming frame_preview gets no skip: the back's verification still applies", async () => {
    state.admin = false;
    const stub = db();
    const result = await createCardAction(payload({ frame_preview: true, back_face: { ...BACK, color_identity: ["red"] } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.fieldErrors?.["back_face.color_identity"]).toMatch(/red/);
    expect(written(stub, "insert")).toBeUndefined();
  });

  it("a non-admin claiming frame_preview on an unverified FRONT is refused too", async () => {
    state.admin = false;
    const stub = db();
    const result = await createCardAction(payload({ frame_preview: true, color_identity: ["red"], back_face: { ...BACK, color_identity: ["blue"] } }));
    expect(result.ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
  });

  it("a legacy-shaped back (no body) on a plain m15 front is stored untouched (the 8 imported cards' shape)", async () => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15" }, back_face: BACK }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")!.back_face).toEqual(BACK);
  });

  it("a legacy-shaped back carrying only a COLOUR on a plain front: stored as sent (no body to derive)", async () => {
    const stub = db();
    const result = await createCardAction(payload({ frame_style: { template: "m15" }, back_face: { ...BACK, color_identity: ["green"] } }));
    expect(result.ok).toBe(true);
    expect(written(stub, "insert")!.back_face).toEqual({ ...BACK, color_identity: ["green"] });
  });

  it("the family is dropped on a non-DFC front; a crafted dfcIcon on the land front is dropped too", async () => {
    const plain = db();
    expect((await createCardAction(payload({ frame_style: { template: "m15", dfcIcon: "sunmoon" }, back_face: null }))).ok).toBe(true);
    expect(written(plain, "insert")!.frame_style).not.toHaveProperty("dfcIcon");
  });

  it("a land front // land back is refused? No: the land back exists for every family", async () => {
    const stub = db();
    const result = await createCardAction(
      payload({ card_type: "land", cost: undefined, color_identity: ["colorless"], frame_style: { template: "m15dfclandfront" }, back_face: { ...BACK, card_type: "land", color_identity: ["colorless"] } }),
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((written(stub, "insert")!.back_face as { frame_style: unknown }).frame_style).toEqual({ template: "m15dfclandback" });
  });

  it("FRONT type outside the wave-1 face types on the transform body (planeswalker / token / saga enchantment)", async () => {
    for (const [type, extra] of [
      ["planeswalker", { loyalty: "3", power: undefined, toughness: undefined }],
      ["token", { power: "1", toughness: "1" }],
      ["battle", { defense: "3", power: undefined, toughness: undefined }],
    ] as const) {
      const stub = db();
      const result = await createCardAction(payload({ card_type: type, ...extra }));
      expect(result.ok, `${type}: ${JSON.stringify(result)}`).toBe(false);
      expect(result.ok ? null : result.fieldErrors, type).toEqual({ frame_style: DFC_FRONT_TYPE_REFUSED });
      expect(written(stub, "insert"), type).toBeUndefined();
    }
  });

  it("a spell-type front on the LAND front body, and a land on the SPELL front body, are refused", async () => {
    const creatureOnLand = db();
    // The back names its own (verified) colour so only the FRONT rule can refuse.
    const r1 = await createCardAction(payload({ color_identity: ["colorless"], card_type: "artifact", power: undefined, toughness: undefined, frame_style: { template: "m15dfclandfront" }, back_face: { ...BACK, color_identity: ["blue"] } }));
    expect(r1.ok ? null : r1.fieldErrors).toEqual({ frame_style: DFC_FRONT_BODY_MISMATCH });
    expect(written(creatureOnLand, "insert")).toBeUndefined();
    const landOnSpell = db();
    const r2 = await createCardAction(payload({ card_type: "land", cost: undefined, power: undefined, toughness: undefined, color_identity: ["blue"], frame_style: { template: "m15dfcfront" }, back_face: { ...BACK, color_identity: ["blue"] } }));
    expect(r2.ok ? null : r2.fieldErrors).toEqual({ frame_style: DFC_FRONT_BODY_MISMATCH });
    expect(written(landOnSpell, "insert")).toBeUndefined();
  });

  it("back_card_id with a uuid is refused by the schema on create; null passes", async () => {
    const stub = db();
    const refused = await createCardAction(payload({ back_card_id: "44444444-4444-4444-8444-444444444444" }));
    expect(refused.ok).toBe(false);
    expect(written(stub, "insert")).toBeUndefined();
    const ok = db();
    expect((await createCardAction(payload({ back_card_id: null }))).ok).toBe(true);
    expect(written(ok, "insert")).not.toHaveProperty("back_card_id");
  });
});

describe("update: crafted patches", () => {
  it("a crafted back body on a stored LEGACY back under a plain m15 front is refused", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "regular" }, back_face: BACK });
    const stub = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] } });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("moving a plain front ONTO the DFC body by a frame_style patch with no back face is refused", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "regular" }, back_face: null });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_style: { template: "m15dfcfront", finish: "regular" } });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("moving a legacy-backed m15 card onto the DFC body by a frame_style patch derives the back body and verifies it", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "regular" }, back_face: BACK });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_style: { template: "m15dfcfront", finish: "regular" } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = written(stub, "update")!;
    expect(row.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] });
    // An update's normalizeAnatomy stamps no defaults (as for the crown): the
    // absent key reads as `arrows` everywhere (dfcFamilyOf).
    expect((row.frame_style as { dfcIcon?: string }).dfcIcon).toBeUndefined();
  });

  it("a frame_style patch that moves the front off the DFC body AND resends the back with its body: refused (the front first)", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, {
      frame_style: { template: "m15", finish: "regular" },
      back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] },
    });
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("a frame_style patch moving the front off the DFC body with the back resent WITHOUT a body passes and stores it as a legacy back", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, {
      frame_style: { template: "m15", finish: "regular" },
      back_face: { ...BACK },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(written(stub, "update")!.back_face).toEqual(BACK);
  });

  it("a back_face patch that names no colour keeps the STORED colour — never the front's (the lock, owner 2026-10-05)", async () => {
    // The stored back is green under a blue front; the patch resends the
    // back without a colour. Before the lock this stored the FRONT's blue.
    state.existing = stored({ back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["green"] } });
    const stub = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, rules_text: "Flying, trample" } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const back = written(stub, "update")!.back_face as { color_identity: unknown; rules_text: unknown };
    expect(back.color_identity).toEqual(["green"]);
    expect(back.rules_text).toBe("Flying, trample");
  });

  it("a family change on a card whose template is NOT a DFC front is dropped and the back untouched", async () => {
    state.existing = stored({ frame_style: { template: "m15", finish: "regular" }, back_face: BACK });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "sunmoon" } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = written(stub, "update")!;
    expect(row).not.toHaveProperty("back_face");
    expect(row.frame_style === undefined || !("dfcIcon" in (row.frame_style as object))).toBe(true);
  });

  it("a family change with a stored body-less back under a DFC front (a half-moved row) derives the body", async () => {
    state.existing = stored({ back_face: BACK });
    const stub = db();
    const result = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "sunmoon" } });
    // m15dfcbackleft/u is NOT verified → refused.
    expect(result.ok).toBe(false);
    expect(written(stub, "update")).toBeUndefined();
    state.verified.push(frameComboKey("m15dfcbackleft", "u"));
    const ok = db();
    const result2 = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "sunmoon" } });
    expect(result2.ok, JSON.stringify(result2)).toBe(true);
    expect(written(ok, "update")!.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] });
  });

  it("a non-admin's frame_preview claim on an update does not skip the back's verification (the family re-derive)", async () => {
    state.admin = false;
    state.existing = stored();
    const stub = db();
    // m15dfcbackleft/u is NOT verified: the re-derived body is refused.
    const result = await updateCardAction(CARD, { frame_preview: true, frame_anatomy: { dfcIcon: "sunmoon" } });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.fieldErrors?.["back_face.color_identity"]).toMatch(/isn't available in blue yet/);
    expect(written(stub, "update")).toBeUndefined();
  });

  it("an admin's preview save of a family re-derive onto an unverified back body lands private and flagged", async () => {
    state.admin = true;
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { frame_preview: true, frame_anatomy: { dfcIcon: "sunmoon" } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = written(stub, "update")!;
    expect(row.visibility).toBe("private");
    expect(row.frame_preview).toBe(true);
    expect((row.back_face as { frame_style: unknown }).frame_style).toEqual({ template: "m15dfcbackleft" });
  });

  it("the FRONT's type changed by a crafted patch to a walker on the DFC body", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { card_type: "planeswalker", loyalty: "3" });
    expect(result.ok ? null : result.fieldErrors).toEqual({ frame_style: DFC_FRONT_TYPE_REFUSED });
    expect(written(stub, "update")).toBeUndefined();
    // …and a land on the spell front by a type patch alone.
    const land = db();
    const result2 = await updateCardAction(CARD, { card_type: "land" });
    expect(result2.ok ? null : result2.fieldErrors).toEqual({ frame_style: DFC_FRONT_BODY_MISMATCH });
    expect(written(land, "update")).toBeUndefined();
  });

  it("clearing the back's art on a public DFC demotes it to private", async () => {
    state.existing = stored();
    const stub = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, art_url: undefined, color_identity: ["blue"] } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(written(stub, "update")!.visibility).toBe("private");
  });

  it("a front colour change on a DFC leaves the back's OWN colour alone (every stored back carries one)", async () => {
    state.existing = stored();
    state.verified.push(frameComboKey("m15dfcfront", "r"));
    const stub = db();
    const result = await updateCardAction(CARD, { color_identity: ["red"] });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = written(stub, "update")!;
    expect(row.color_identity).toEqual(["red"]);
    expect(row).not.toHaveProperty("back_face");
  });
});

describe("update: the back's colour is locked on a card whose back has a body (owner 2026-10-05)", () => {
  it("a changed back colour is refused — in a VERIFIED colour too: the lock, not the gate — and an admin's preview can't override it", async () => {
    state.existing = stored();
    // m15dfcback/g IS verified; the refusal is structural.
    const stub = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, color_identity: ["green"] } });
    expect(result.ok ? null : result.fieldErrors).toEqual({ "back_face.color_identity": DFC_BACK_COLOR_SET });
    expect(written(stub, "update")).toBeUndefined();
    // An unverified colour: the same refusal, never "isn't available".
    const red = db();
    const result2 = await updateCardAction(CARD, { back_face: { ...BACK, color_identity: ["red"] } });
    expect(result2.ok ? null : result2.fieldErrors).toEqual({ "back_face.color_identity": DFC_BACK_COLOR_SET });
    expect(written(red, "update")).toBeUndefined();
    // The admin's preview skips VERIFICATION only.
    state.admin = true;
    const preview = db();
    const result3 = await updateCardAction(CARD, { frame_preview: true, back_face: { ...BACK, color_identity: ["green"] } });
    expect(result3.ok ? null : result3.fieldErrors).toEqual({ "back_face.color_identity": DFC_BACK_COLOR_SET });
    expect(written(preview, "update")).toBeUndefined();
  });

  it("the family switch — the one look change an edit may make — can't carry a colour change in with it", async () => {
    state.existing = stored();
    const stub = db();
    // m15dfcbackleft/g IS verified: only the lock can refuse this.
    const result = await updateCardAction(CARD, {
      frame_anatomy: { dfcIcon: "sunmoon" },
      back_face: { ...BACK, color_identity: ["green"] },
    });
    expect(result.ok ? null : result.fieldErrors).toEqual({ "back_face.color_identity": DFC_BACK_COLOR_SET });
    expect(written(stub, "update")).toBeUndefined();
    // The family alone, with the stored colour resent: the body re-derives.
    state.verified.push(frameComboKey("m15dfcbackleft", "u"));
    const ok = db();
    const result2 = await updateCardAction(CARD, { frame_anatomy: { dfcIcon: "sunmoon" }, back_face: { ...BACK, color_identity: ["blue"] } });
    expect(result2.ok, JSON.stringify(result2)).toBe(true);
    expect(written(ok, "update")!.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] });
  });

  it("the same colour resent is no change: a pair in another order, or the stored colour with a content edit", async () => {
    state.existing = stored({ back_face: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue", "green"] } });
    const pair = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, rules_text: "Flying", color_identity: ["green", "blue"] } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((written(pair, "update")!.back_face as { color_identity: unknown }).color_identity).toEqual(["blue", "green"]);
    state.existing = stored();
    const same = db();
    const result2 = await updateCardAction(CARD, { back_face: { ...BACK, rules_text: "Flying", color_identity: ["blue"] } });
    expect(result2.ok, JSON.stringify(result2)).toBe(true);
    expect((written(same, "update")!.back_face as { color_identity: unknown }).color_identity).toEqual(["blue"]);
  });

  it("nothing to lock without a body: a legacy back on m15 takes the colour as sent, a body-less back under a DFC front takes it with the derived body, and a create takes it", async () => {
    // A legacy back (the 8 imported cards' shape): stored as sent.
    state.existing = stored({ frame_style: { template: "m15", finish: "regular" }, back_face: BACK });
    const legacy = db();
    const result = await updateCardAction(CARD, { back_face: { ...BACK, color_identity: ["green"] } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(written(legacy, "update")!.back_face).toEqual({ ...BACK, color_identity: ["green"] });
    // A half-moved row: the body derives and the patch's colour lands.
    state.existing = stored({ back_face: BACK });
    const half = db();
    const result2 = await updateCardAction(CARD, { back_face: { ...BACK, color_identity: ["green"] } });
    expect(result2.ok, JSON.stringify(result2)).toBe(true);
    expect(written(half, "update")!.back_face).toEqual({ ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["green"] });
    // A create: the back's own colour, verified for the body.
    const create = db();
    const result3 = await createCardAction(payload({ back_face: { ...BACK, color_identity: ["green"] } }));
    expect(result3.ok, JSON.stringify(result3)).toBe(true);
    expect((written(create, "insert")!.back_face as { color_identity: unknown }).color_identity).toEqual(["green"]);
  });
});
