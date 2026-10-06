import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import dfcPrintings from "../scryfall/fixtures/dfc-import-printings.json";
import importPrintings from "../scryfall/fixtures/import-printings.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";

// ---------------------------------------------------------------------------
// TODO 5.4 skeptic pass — every fixture printing MAPPED, FINALIZED against a
// verified set and SAVED through the REAL createCardAction (Supabase
// stubbed): a transform printing lands on its bodies with the back's body,
// colour and family stored and the cost stripped; a blocked one (a walker
// face, a colourless Eldrazi back, a Saga / battle / token face, a devoid
// modal) — and a modal printing whose bodies (5.1b) aren't ticked — saves
// exactly as before 5.4 — on the
// front's standard frame with a legacy, body-less back (or none). The
// walker's request row passes the action's schema and the table's CHECKs.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  verified: [] as string[],
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
vi.mock("@/lib/cards/frame-reviews", () => ({ getVerifiedFrameKeys: async () => state.verified }));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => null,
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

import { createCardAction } from "@/lib/cards/actions";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { importedAnatomy, importedFormAnatomy } from "@/lib/cards/anatomy";
import { FRAME_COLOR_KEYS, KIND_DEFS } from "@/lib/creator/card-kinds";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { frameRequestFromImport, frameRequestSchema } from "@/lib/frames/frame-requests";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch, type ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { backFaceFromPatch, splitSubtypes } from "@/lib/scryfall/preview-from-patch";
import { resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import type { FrameTemplate } from "@/types/card";

const ALL = { ...dfcPrintings, ...importPrintings, ...signaturePrintings } as Record<string, unknown>;
const printing = (key: string): ScryfallCard => {
  const raw = ALL[key];
  if (!raw) throw new Error(`no fixture ${key}`);
  return scryfallCardSchema.parse(raw);
};

/** Every colour of these templates, verified. */
const allColours = (...templates: string[]) =>
  templates.flatMap((template) => FRAME_COLOR_KEYS.map((colour) => frameComboKey(template as FrameTemplate, colour)));

function db() {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "cards" && (called(calls, "insert") || called(calls, "update"))) {
      return { data: { id: CARD, slug: "imported" }, error: null };
    }
    return { data: null, error: null, count: 0 };
  });
  state.client = stub.client;
  return stub;
}

const inserted = (stub: ReturnType<typeof db>) => {
  const entry = stub.forTable("cards").find((e) => called(e.calls, "insert"));
  return payloadOf(entry?.calls ?? [], "insert") as Record<string, unknown> | undefined;
};

const ART = { front: "https://example.com/front.png", back: "https://example.com/back.png" };

/** The payload the creator's submit sends for a finalized import patch: the
 *  front fields, the frame with the printing's anatomy (importedFormAnatomy,
 *  the family included), the back as the form holds it — its body and
 *  colour only where the patch names them — with an art on each face. */
function payloadFor(patch: ScryfallImportPatch) {
  const template =
    patch.frame_template ?? (patch.kind ? KIND_DEFS[patch.kind].layoutTemplates?.[0] : undefined) ?? "m15";
  const back = patch.back_face;
  return {
    title: patch.title ?? "Untitled",
    game_system_id: GAME,
    cost: patch.cost,
    color_identity: patch.color_identity ?? ["colorless"],
    supertype: patch.supertype,
    card_type: patch.card_type ?? "creature",
    subtypes: splitSubtypes(patch.subtypes_text),
    rarity: patch.rarity ?? "common",
    rules_text: patch.rules_text,
    power: patch.power,
    toughness: patch.toughness,
    loyalty: patch.loyalty,
    defense: patch.defense,
    art_url: ART.front,
    frame_style: { template, finish: "regular", ...importedFormAnatomy(importedAnatomy(patch, template).style) },
    visibility: "public",
    source_scryfall_id: patch.source_scryfall_id,
    back_face: back
      ? {
          ...backFaceFromPatch(back)!,
          art_url: ART.back,
          art_position: { scale: 1, focalX: 0.5, focalY: 0.5 },
          ...(back.frame_style ? { frame_style: back.frame_style } : {}),
          ...(back.color_identity ? { color_identity: back.color_identity } : {}),
        }
      : undefined,
  };
}

beforeEach(() => {
  state.verified = [];
  state.admin = false;
});

describe("transform printings land on the bodies and SAVE there", () => {
  // [key, verified templates, front body, back body, back colour, family, front colour]
  const rows: Array<[string, string[], string, string, string[], string, string[]]> = [
    ["inr-60", ["m15dfcfront", "m15dfcback"], "m15dfcfront", "m15dfcback", ["blue"], "arrows", ["blue"]],
    ["mid-7", ["m15dfcfront", "m15dfcbackleft"], "m15dfcfront", "m15dfcbackleft", ["red"], "sunmoon", ["white"]],
    ["xln-22", ["m15dfcfront", "m15dfclandback"], "m15dfcfront", "m15dfclandback", ["colorless"], "compass", ["white"]],
    ["mom-36", ["m15dfcfront", "m15dfcback"], "m15dfcfront", "m15dfcback", ["multicolor"], "arrows", ["white"]],
    ["bot-1", ["m15dfcfront", "m15dfcback"], "m15dfcfront", "m15dfcback", ["white"], "arrows", ["white"]],
    ["lci-26", ["m15dfcfront", "m15dfclandback"], "m15dfcfront", "m15dfclandback", ["colorless"], "arrows", ["white"]],
    ["soi-281", ["m15dfclandfront", "m15dfcbackleft"], "m15dfclandfront", "m15dfcbackleft", ["black"], "sunmoon", ["colorless"]],
    ["isd-51", ["m15dfcfront", "m15dfcbackleft"], "m15dfcfront", "m15dfcbackleft", ["blue"], "sunmoon", ["blue"]],
  ];

  it.each(rows)("%s saves on %s // %s", async (key, templates, front, back, backColour, family, frontColour) => {
    state.verified = allColours(...templates);
    const patch = finalizeImportMatch(mapScryfallToFormPatch(printing(key)), new Set(state.verified));
    expect(patch.kind, key).toBe("transform");
    const stub = db();
    const result = await createCardAction(payloadFor(patch) as never);
    expect(result.ok, `${key}: ${JSON.stringify(result)}`).toBe(true);
    const row = inserted(stub)!;
    expect(row.frame_style, key).toMatchObject({ template: front, dfcIcon: family });
    expect(row.color_identity, key).toEqual(frontColour);
    expect(row.visibility, key).toBe("public");
    expect(row.back_face, key).toMatchObject({ frame_style: { template: back }, color_identity: backColour, art_url: ART.back });
    // A transform back stores no cost. The crown / two-colour switches are
    // KEPT on the transform front body since 5.1d (it draws both): the
    // printing's crown where it names one (LCI #26's `legendary` effect; a
    // nonlegendary printing names none), else the new-card default — on.
    expect(row.back_face, key).not.toHaveProperty("cost");
    // XLN #22 Legion's Landing is a Legendary printed WITHOUT the crown
    // (2017): the printing's `false` stays; the two-colour switch only on
    // the spell front (the land front draws no pairs).
    expect((row.frame_style as Record<string, unknown>).crown, key).toBe(key !== "xln-22");
    expect((row.frame_style as Record<string, unknown>).twoColor, key).toBe(front === "m15dfclandfront" ? undefined : true);
  });

  it("LCI #26 and ISD #51 land on the bodies with a NEAREST match (the gap stays logged), MID #7 exact", () => {
    const verified = new Set(allColours("m15dfcfront", "m15dfclandback", "m15dfcbackleft"));
    const lci = finalizeImportMatch(mapScryfallToFormPatch(printing("lci-26")), verified);
    expect(lci.frame_match).toMatchObject({ signature: "transform/2015+parchment-land-back", status: "nearest", template: "m15dfcfront", blockedBy: "5.8" });
    expect(lci.frame_match?.landOn).toBeUndefined();
    const request = frameRequestFromImport(lci, { artImported: true, source: "import", verifiedKeys: verified, landedTemplate: "m15dfcfront" });
    expect(request).toMatchObject({ signature: "transform/2015+parchment-land-back", status: "nearest", cause: "missing", template: "m15dfcfront" });
    expect(frameRequestSchema.safeParse(request).success).toBe(true);
    const isd = finalizeImportMatch(mapScryfallToFormPatch(printing("isd-51")), verified);
    expect(isd.frame_match).toMatchObject({ signature: "dfc/2003", status: "nearest", template: "m15dfcfront" });
    const mid = finalizeImportMatch(mapScryfallToFormPatch(printing("mid-7")), verified);
    expect(mid.frame_match).toMatchObject({ signature: "transform/2015", status: "exact" });
    expect(frameRequestFromImport(mid, { artImported: true, source: "import", verifiedKeys: verified })).toBeNull();
  });

  it("a public save with the back's art missing lands private (D13), the body kept", async () => {
    state.verified = allColours("m15dfcfront", "m15dfcback");
    const patch = finalizeImportMatch(mapScryfallToFormPatch(printing("inr-60")), new Set(state.verified));
    const payload = payloadFor(patch);
    const stub = db();
    const result = await createCardAction({ ...payload, back_face: { ...payload.back_face!, art_url: "" } } as never);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = inserted(stub)!;
    expect(row.visibility).toBe("private");
    expect(row.back_face).toMatchObject({ frame_style: { template: "m15dfcback" } });
  });
});

describe("blocked printings save exactly as before 5.4", () => {
  // [key, verified templates, front frame, kind, back: "legacy" | "none"]
  const rows: Array<[string, string[], string, string, "legacy" | "none"]> = [
    ["emn-63", ["m15"], "m15", "creature", "legacy"],
    ["ori-23", ["m15"], "m15", "creature", "none"],
    ["ori-60", ["m15"], "m15", "creature", "none"],
    ["khm-114", ["m15"], "m15", "creature", "none"],
    ["mh3-237", ["m15"], "m15", "creature", "none"],
    ["znr-12", ["m15"], "m15", "sorcery", "legacy"],
    ["khm-112", ["m15"], "m15", "creature", "legacy"],
    ["stx-6", ["m15"], "m15", "creature", "legacy"],
    ["stx-147", ["m15"], "m15", "creature", "legacy"],
    ["mh3-253", ["m15devoid", "m15"], "m15devoid", "creature", "legacy"],
    ["znr-284", ["m15land"], "m15land", "land", "legacy"],
    ["neo-141", ["saga"], "saga", "saga", "legacy"],
    ["mom-20", ["battle"], "battle", "battle", "legacy"],
  ];

  it.each(rows)("%s saves on %s", async (key, templates, front, kind, back) => {
    state.verified = allColours(...templates);
    const patch = finalizeImportMatch(mapScryfallToFormPatch(printing(key)), new Set(state.verified));
    expect(patch.kind, key).toBe(kind);
    expect(patch.printed_dfc_icon, key).toBeUndefined();
    const stub = db();
    const result = await createCardAction(payloadFor(patch) as never);
    expect(result.ok, `${key}: ${JSON.stringify(result)}`).toBe(true);
    const row = inserted(stub)!;
    expect((row.frame_style as { template: string }).template, key).toBe(front);
    expect((row.frame_style as Record<string, unknown>).dfcIcon, key).toBeUndefined();
    if (back === "none") {
      expect(row.back_face, key).toBeFalsy();
    } else {
      expect(row.back_face, key).toBeTruthy();
      expect(row.back_face, key).not.toHaveProperty("frame_style");
      expect(row.back_face, key).not.toHaveProperty("color_identity");
    }
  });

  it("the walker-faced import logs a `dfc/walker` row the action's schema and the table's CHECKs accept", () => {
    const patch = finalizeImportMatch(mapScryfallToFormPatch(printing("ori-23")), new Set(allColours("m15")));
    expect(patch.dropped_face).toBe("walker-face");
    const row = frameRequestFromImport(patch, { artImported: true, source: "import", verifiedKeys: new Set(allColours("m15")) });
    expect(row).toMatchObject({ signature: "dfc/walker", status: "nearest", cause: "missing", template: "m15", setCode: "ori", collectorNumber: "23" });
    const parsed = frameRequestSchema.safeParse(row);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it("a transform printing with nothing ticked saves as before 5.4 too (the front's standard, a legacy back), and with the FRONT alone ticked", async () => {
    for (const verified of [allColours("m15"), [...allColours("m15"), ...allColours("m15dfcfront")]]) {
      state.verified = verified;
      const patch = finalizeImportMatch(mapScryfallToFormPatch(printing("mid-7")), new Set(verified));
      expect(patch.kind).toBe("creature");
      const stub = db();
      const result = await createCardAction(payloadFor(patch) as never);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const row = inserted(stub)!;
      expect(row.frame_style).toMatchObject({ template: "m15" });
      expect((row.frame_style as Record<string, unknown>).dfcIcon).toBeUndefined();
      expect(row.back_face).toMatchObject({ title: "Moonrage Brute" });
      expect(row.back_face).not.toHaveProperty("frame_style");
    }
  });

  it("EMN #63 — the owner's alternative (colour the Eldrazi back like its front) is ONE line away: the gate accepts a blue back on the left-well body", () => {
    const patch = mapScryfallToFormPatch(printing("emn-63"));
    const back = patch.back_face!;
    const verified = new Set(allColours("m15dfcfront", "m15dfcbackleft"));
    const gate = resolveDfcBackFace({
      frontTemplate: "m15dfcfront",
      back: { ...backFaceFromPatch(back)!, frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] },
      family: "moon",
      frontColorIdentity: patch.color_identity,
      verifiedKeys: verified,
    });
    expect(gate).toMatchObject({ ok: true, back: { frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] } });
    // …while a COLOURLESS Eldrazi back is refused on the body (D2), which
    // is why the import drops the body today.
    const colourless = resolveDfcBackFace({
      frontTemplate: "m15dfcfront",
      back: { ...backFaceFromPatch(back)!, frame_style: { template: "m15dfcbackleft" }, color_identity: ["colorless"] },
      family: "moon",
      frontColorIdentity: patch.color_identity,
      verifiedKeys: verified,
    });
    expect(colourless).toMatchObject({ ok: false, field: "back_face.color_identity" });
  });
});
