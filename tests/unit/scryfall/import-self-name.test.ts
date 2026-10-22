import { describe, expect, it } from "vitest";
import printings from "./fixtures/nickname-printings.json";
import plain from "./fixtures/import-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { previewFromImportPatch } from "@/lib/scryfall/preview-from-patch";
import { oracleSelfNamesAsTokens, withSelfNames } from "@/lib/cards/self-name";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { applyRemixNames } from "@/lib/ai/remix-names";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// TODO 6.2 (owner Round 80): an imported FLAVOUR-NAME printing writes the
// card's own name as `~` in its rules text, so the rules draw the nickname
// as the printing sets them (MSC #283 "Exile The Five Arrive", SLD #1186
// "…counter on Post, Son of Rich"). A plain import keeps Oracle's name.
// The fixtures: Scryfall's own JSON (captured 2026-10-21).
// ---------------------------------------------------------------------------

const patchOf = (key: keyof typeof printings) => mapScryfallToFormPatch(scryfallCardSchema.parse(printings[key]));

describe("a flavour-name printing's rules on import", () => {
  it("MSC #283: the name becomes ~, drawn as the nickname", () => {
    const patch = patchOf("msc-283");
    expect(patch.nickname).toBe("The Five Arrive");
    expect(patch.rules_text).toContain("Exile ~.");
    expect(patch.rules_text).not.toContain("Genesis Ultimatum");
    const drawn = withSelfNames(previewFromImportPatch(patch, patch.title!, "m15"), getFrameProfile("m15"));
    expect(drawn.rulesText).toContain("Exile The Five Arrive.");
  });

  it("SLD #1186: a legendary name's short form too", () => {
    const patch = patchOf("sld-1186");
    expect(patch.rules_text).toContain("put a +1/+1 counter on ~.");
    const drawn = withSelfNames(previewFromImportPatch(patch, patch.title!, "m15"), getFrameProfile("m15"));
    expect(drawn.rulesText).toContain("put a +1/+1 counter on Post, Son of Rich.");
  });

  it("the other six: no name in the Oracle text — the rules as Oracle writes them", () => {
    for (const key of ["msc-282", "msc-288", "sld-697", "tmc-54", "iko-275", "vow-338"] as const) {
      const card = scryfallCardSchema.parse(printings[key]);
      const oracle = card.card_faces && card.card_faces.length > 1 ? card.card_faces[0]!.oracle_text : card.oracle_text;
      expect(patchOf(key).rules_text, key).toBe(oracle ?? undefined);
    }
  });

  it("a plain import keeps Oracle's name, as today", () => {
    // The same card without its flavour name (Genesis Ultimatum's own
    // printing): its rules name it, as Oracle does.
    const { flavor_name: _dropped, ...rest } = printings["msc-283"] as Record<string, unknown>;
    void _dropped;
    const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(rest));
    expect(patch).not.toHaveProperty("nickname");
    expect(patch.rules_text).toContain("Exile Genesis Ultimatum.");
    for (const raw of Object.values(plain)) {
      const card = scryfallCardSchema.parse(raw);
      expect(mapScryfallToFormPatch(card).rules_text ?? "", card.name).not.toContain("~");
    }
  });
});

describe("the short form only where the landing frame prints the nickname (independent check S1)", () => {
  /** SLD #1186 as another printing would have it. */
  const krrik = (over: Record<string, unknown>) => mapScryfallToFormPatch(scryfallCardSchema.parse({ ...printings["sld-1186"], ...over }));

  it("on m15 (the plate): K'rrik's short form is ~, drawn as the nickname", () => {
    const patch = patchOf("sld-1186");
    expect(patch.frame_template).toBe("m15");
    expect(patch.rules_text).toContain("counter on ~.");
  });

  it("on the 2003 frame (no plate): the short form stays as Oracle writes it", () => {
    const patch = krrik({ frame: "2003" });
    expect(patch.frame_template).toBe("modern");
    expect(patch.rules_text).toContain("counter on K'rrik.");
    const drawn = withSelfNames(previewFromImportPatch(patch, patch.title!, "modern"), getFrameProfile("modern"));
    expect(drawn.rulesText).toContain("counter on K'rrik.");
    expect(drawn.rulesText).not.toContain("Son of Yawgmoth.");
  });

  it("a borderless flavour-name legendary: the short form stays as Oracle writes it", () => {
    const patch = krrik({ border_color: "borderless", frame_effects: ["legendary", "inverted"] });
    // Its own frame prints no plate (it may land on a bordered one until
    // that is verified, then move).
    expect(getFrameProfile(patch.frame_match!.template).nickname).toBeUndefined();
    expect(patch.nickname).toBe("Post, Son of Rich");
    expect(patch.rules_text).toContain("counter on K'rrik.");
  });
});

describe("the AI deck remix maps Oracle's own rules (independent re-check 1)", () => {
  it("SLD #1186 remixed as \"Vorath, Tide of Ruin\": the short name follows as Vorath, never the full title", () => {
    const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(printings["sld-1186"]), { oracleRules: true });
    expect(patch.rules_text).toContain("counter on K'rrik.");
    const named = applyRemixNames(
      { title: patch.title!, supertype: patch.supertype, rules_text: patch.rules_text },
      { title: "Vorath, Tide of Ruin" },
    );
    expect(named.ok && named.rules_text).toContain("counter on Vorath.");
    expect(named.ok && named.rules_text).not.toContain("~");
  });

  it("the remix step asks for it", () => {
    const source = readFileSync(join(process.cwd(), "lib/ai/generation-jobs.ts"), "utf8");
    expect(source).toContain("mapScryfallToFormPatch(scry, { oracleRules: true })");
  });
});

describe("a later landing without the plate keeps the short form (independent re-check 2)", () => {
  it("a legendary flavour-name Spacecraft: its station frame prints no plate", () => {
    const raw = {
      ...printings["sld-1186"],
      name: "Kessa, Star Voyager",
      type_line: "Legendary Artifact — Spacecraft",
      mana_cost: "{4}",
      colors: [],
      color_identity: [],
      oracle_text: "When Kessa, Star Voyager enters, scry 1.\nWhenever Kessa attacks, draw a card.",
      power: "4",
      toughness: "4",
      flavor_name: "The Long Dark",
    };
    const patch = mapScryfallToFormPatch(scryfallCardSchema.parse(raw));
    expect(patch.frame_template).toBe("m15artifact");
    expect(getFrameProfile("m15station").nickname).toBeUndefined();
    // The whole name is ~ (it draws the same name back anywhere); the short
    // form stays, as a station landing would print it.
    expect(patch.rules_text).toBe("When ~ enters, scry 1.\nWhenever Kessa attacks, draw a card.");
  });
});

describe("oracleSelfNamesAsTokens", () => {
  const SHORT = { shortForm: true } as const;
  const LEGENDARY = { shortForm: true, supertype: "Legendary" } as const;

  it("replaces the whole name as a whole word only", () => {
    expect(oracleSelfNamesAsTokens("Exile Genesis Ultimatum.", "Genesis Ultimatum", SHORT)).toBe("Exile ~.");
    expect(oracleSelfNamesAsTokens("Genesis Ultimatums are rare.", "Genesis Ultimatum", SHORT)).toBe("Genesis Ultimatums are rare.");
    expect(oracleSelfNamesAsTokens(undefined, "X", SHORT)).toBeUndefined();
    expect(oracleSelfNamesAsTokens("Fly.", "", SHORT)).toBe("Fly.");
  });

  it("the short form (shortNameOf): the comma's and a legendary \"X the Y\" alike, only with shortForm", () => {
    expect(oracleSelfNamesAsTokens("When K'rrik, Son of Yawgmoth enters, K'rrik deals 1.", "K'rrik, Son of Yawgmoth", LEGENDARY)).toBe("When ~ enters, ~ deals 1.");
    expect(oracleSelfNamesAsTokens("Goka deals 4 damage.", "Goka the Unjust", LEGENDARY)).toBe("~ deals 4 damage.");
    // A non-legendary "X the Y" has no short form (shortNameOf).
    expect(oracleSelfNamesAsTokens("Curse deals 1.", "Curse the Fire", SHORT)).toBe("Curse deals 1.");
    // Without shortForm only the whole name.
    expect(oracleSelfNamesAsTokens("When K'rrik, Son of Yawgmoth enters, K'rrik deals 1.", "K'rrik, Son of Yawgmoth", { shortForm: false })).toBe("When ~ enters, K'rrik deals 1.");
    expect(oracleSelfNamesAsTokens("Goka deals 4 damage.", "Goka the Unjust", { shortForm: false, supertype: "Legendary" })).toBe("Goka deals 4 damage.");
  });

  it("never where the short form starts another name: \", <Capital>\" or \"'s <Capital>\"", () => {
    // A meld pair: "Urza, Lord Protector" melds into "Urza, Planeswalker".
    expect(oracleSelfNamesAsTokens("Melds into Urza, Planeswalker. Urza gets +1/+1.", "Urza, Lord Protector", LEGENDARY)).toBe(
      "Melds into Urza, Planeswalker. ~ gets +1/+1.",
    );
    expect(oracleSelfNamesAsTokens("Search for Urza's Tower. Urza's power is 1.", "Urza, Lord Protector", LEGENDARY)).toBe(
      "Search for Urza's Tower. ~'s power is 1.",
    );
    expect(oracleSelfNamesAsTokens("Fetch Urza’s Mine.", "Urza, Lord Protector", LEGENDARY)).toBe("Fetch Urza’s Mine.");
  });

  it("never a rules word or a keyword (the word in the text is the instruction)", () => {
    expect(oracleSelfNamesAsTokens("Exile target attacking creature.", "Exile", SHORT)).toBe("Exile target attacking creature.");
    expect(oracleSelfNamesAsTokens("Proliferate. Proliferate.", "Proliferate", SHORT)).toBe("Proliferate. Proliferate.");
    expect(oracleSelfNamesAsTokens("Storm (copy it for each spell cast before it.)", "Storm", SHORT)).toBe("Storm (copy it for each spell cast before it.)");
    expect(oracleSelfNamesAsTokens("Split second. Counter target spell.", "Split Second", SHORT)).toBe("Split second. Counter target spell.");
    // The CR's multi-word actions and its named variants (re-check 3).
    for (const name of ["Time Travel", "Collect Evidence", "Venture into the Dungeon", "The Ring Tempts You", "Megamorph", "Totem Armor", "Islandwalk", "Basic Landcycling", "Typecycling"]) {
      expect(oracleSelfNamesAsTokens(`${name} — then ${name}.`, name, SHORT), name).toBe(`${name} — then ${name}.`);
    }
    // …nor a short form that is one ("Exile, the Unbound" never turns Exile).
    expect(oracleSelfNamesAsTokens("Exile target card.", "Exile, the Unbound", LEGENDARY)).toBe("Exile target card.");
  });
});
