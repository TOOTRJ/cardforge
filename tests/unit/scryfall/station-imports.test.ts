import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/station-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_SIGNATURE_KEYS, isKnownFrameSignature } from "@/lib/scryfall/frame-signatures";
import { finalizeImportMatch, withVerification } from "@/lib/creator/frame-resolve";
import { frameRequestFromImport, frameRequestSchema, signatureBlockedBy } from "@/lib/frames/frame-requests";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.27a, step 0 — the station frame (Edge of Eternities' Spacecraft and
// Planets) is not drawn yet, and Scryfall has no layout for it: the cards
// are `layout: normal` with the keyword Station. Until this step `era/2015`
// called a plain Spacecraft EXACT on the artifact frame (a Planet on the
// land frame) and no row reached the frame request log. Now every station
// printing lands where it landed, as that frame's NEAREST, and is logged.
//
// Every fixture is a real printing captured from Scryfall (2026-10-13) and
// trimmed to the fields the registry and the importer read.
// ---------------------------------------------------------------------------

type Key = keyof typeof printingsData;
const printing = (key: Key) => scryfallCardSchema.parse(printingsData[key]);
const match = (key: Key) => frameMatchFromScryfall(printing(key));

const STATION_REASON = "PipGlyph doesn't draw this printing's Station frame yet";
/** The bordered rule's reason since the frame exists (4.27a step 1). */
const UNVERIFIED_REASON = "PipGlyph's Station frame isn't verified yet";
const EVERY: ReadonlySet<string> = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((template) => ["w", "u", "b", "r", "g", "c", "m"].map((colour) => frameComboKey(template, colour))),
);

/** The combos production has verified (supabase/seed.sql mirrors them). */
function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql)?.[1].replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const keys = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of ["w", "u", "b", "r", "g", "c", "m"]) keys.add(frameComboKey(template as FrameTemplate, colour));
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    keys.add(frameComboKey(template as FrameTemplate, colour));
  }
  return keys;
}
const PROD = productionVerifiedKeys();
/**
 * The unverified side of these cases: production's list WITHOUT its station
 * ticks. Production verified `m15station` in every colour and
 * `m15stationland` in w/u/b/r/g on 2026-10-14 (the seed mirror of that date).
 */
const PROD_BEFORE_STATION = new Set([...PROD].filter((key) => !key.startsWith("m15station/") && !key.startsWith("m15stationland/")));

describe("a bordered station printing is the artifact / land frame's nearest (station/2015)", () => {
  const spacecraft: Key[] = ["eoe-25", "eoe-208", "eoe-219", "eoe-238", "eoe-241", "peoe-25s", "plst-eoe-101", "trk-273"];

  it.each(spacecraft)("%s: a Spacecraft lands on the artifact frame, nearest, naming 4.27a", (key) => {
    const found = match(key);
    expect(found).toMatchObject({
      status: "nearest",
      signature: "station/2015",
      template: "m15artifact",
      exactLabel: "Station frame (Spacecraft)",
      reason: UNVERIFIED_REASON,
      blockedBy: "4.27a",
    });
    expect(found.landOn).toBeUndefined();
    // The station frame is named for later (4.27a step 1): it takes over
    // once it is verified in the card's colour.
    expect(found.onceVerified).toBe("m15station");
    expect(found.landOnOnceVerified).toBeUndefined();
  });

  it("a Planet lands on the land frame, nearest", () => {
    expect(match("eoe-253")).toMatchObject({
      status: "nearest",
      signature: "station/2015",
      template: "m15land",
      exactLabel: "Station frame (Planet)",
      reason: UNVERIFIED_REASON,
      blockedBy: "4.27a",
    });
  });

  it("once the station frame is ticked in the card's colour the import lands on it, exact; with nothing ticked it stays the nearest", () => {
    for (const key of [...spacecraft, "eoe-253"] as Key[]) {
      const patch = finalizeImportMatch(mapScryfallToFormPatch(printing(key)), EVERY);
      const station = key === "eoe-253" ? "m15stationland" : "m15station";
      expect(patch.frame_template, key).toBe(station);
      expect(patch.frame_match, key).toMatchObject({ status: "exact", signature: "station/2015", template: station });
      // …and the text it lands with is the tiers' grammar: the bands draw.
      expect(patch.rules_text, key).toMatch(/^\d+\+ \| /m);
    }
    // Nothing ticked: the artifact frame stands in, and the match says the
    // station frame is what isn't verified (the Vehicle rule's wording).
    expect(withVerification(match("eoe-25"), "w", new Set())).toMatchObject({ status: "nearest", template: "m15artifact", reason: "not yet verified in white", unverified: true });
    expect(match("eoe-253").onceVerified).toBe("m15stationland");
  });

  it("the import keeps its landing, its kind and its tiers as plain rules text", () => {
    const frigate = finalizeImportMatch(mapScryfallToFormPatch(printing("eoe-25")), PROD_BEFORE_STATION);
    expect(frigate).toMatchObject({ kind: "artifact", frame_template: "m15artifact", power: "3", toughness: "5" });
    expect(frigate.rules_text).toContain("12+ | Flying, lifelink");
    const planet = finalizeImportMatch(mapScryfallToFormPatch(printing("eoe-253")), PROD_BEFORE_STATION);
    expect(planet).toMatchObject({ kind: "land", frame_template: "m15land" });
  });

  it("on production's own list (2026-10-14) a Spacecraft lands on the station frame, exact", () => {
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) expect(PROD.has(frameComboKey("m15station", key)), key).toBe(true);
    const frigate = finalizeImportMatch(mapScryfallToFormPatch(printing("eoe-25")), PROD);
    expect(frigate).toMatchObject({ kind: "artifact", frame_template: "m15station" });
    expect(frigate.frame_match).toMatchObject({ status: "exact", signature: "station/2015", template: "m15station" });
  });

  it("…and writes a row in the request log (none before step 0) — 'unverified' since the frame exists", () => {
    const patch = finalizeImportMatch(mapScryfallToFormPatch(printing("eoe-208")), PROD_BEFORE_STATION);
    const row = frameRequestFromImport(patch, { artImported: true, source: "import" });
    expect(row).toMatchObject({
      signature: "station/2015",
      label: "Station frame (Spacecraft)",
      setCode: "eoe",
      collectorNumber: "208",
      status: "nearest",
      cause: "unverified",
      template: "m15artifact",
    });
    expect(frameRequestSchema.safeParse(row).success).toBe(true);
    expect(signatureBlockedBy("station/2015", "m15artifact")).toBe("4.27a");
  });
});

describe("the other dresses (TODO 4.27a step 2): their own rule and the station gap — then the bordered station frame, or their own once verified", () => {
  /** Production's ticks plus the bordered station frame in every colour. */
  const withStation = new Set([...PROD_BEFORE_STATION, ...["w", "u", "b", "r", "g", "m", "c"].flatMap((k) => [frameComboKey("m15station", k), frameComboKey("m15stationland", k)])]);
  const withDresses = new Set([...withStation, ...["w", "u", "b", "r", "g", "m", "c"].map((k) => frameComboKey("extendedartstation", k))]);
  const land = (found: ReturnType<typeof match>) => found.landOn ?? found.template;

  it("extended art: the extended-art frame, with the station gap first — its own station frame named once verified", () => {
    for (const key of ["eoe-321", "eoe-348"] as Key[]) {
      const found = match(key);
      const colour = key === "eoe-321" ? "w" : "m";
      expect(found, key).toMatchObject({
        status: "nearest",
        signature: "extendedart+station",
        template: "extendedart",
        reason: STATION_REASON,
        blockedBy: "4.27a",
        onceVerified: "extendedartstation",
        landOnOnceVerified: { template: "m15station" },
      });
      expect(found.gaps, key).toContain("station");
      // Nothing ticked: the same landing, now "not yet verified" (the frame exists).
      const none = withVerification(found, colour, PROD_BEFORE_STATION);
      expect(land(none), key).toBe("extendedart");
      expect(none, key).toMatchObject({ status: "nearest", reason: `not yet verified in ${colour === "w" ? "white" : "multicolor"}`, unverified: true });
      // The bordered station frame ticked: its stand-in landing, still nearest.
      const standIn = withVerification(found, colour, withStation);
      expect(standIn, key).toMatchObject({ status: "nearest", template: "extendedart", landOn: "m15station" });
      expect(standIn.reason, key).toMatch(/extended art/);
      // Production's own list (2026-10-14: the bordered pair ticked) is that state.
      expect(land(withVerification(found, colour, PROD)), key).toBe("m15station");
      // Its own frame ticked: exact on it, whatever else is.
      for (const keys of [withDresses, EVERY]) {
        const own = withVerification(found, colour, keys);
        expect(own, key).toMatchObject({ status: "exact", template: "extendedartstation", reason: null });
        expect(own.landOn, key).toBeUndefined();
      }
    }
  });

  it("borderless: the borderless artifact frame, landing on the artifact frame as before — on the bordered station frame once it is verified (never its own: edge to edge)", () => {
    const found = match("eoc-1");
    expect(found).toMatchObject({
      status: "nearest",
      signature: "borderless/standard+station",
      template: "m15borderlessartifact",
      landOn: "m15artifact",
      reason: STATION_REASON,
      blockedBy: "4.27a",
      landOnOnceVerified: { template: "m15station" },
    });
    expect(found.onceVerified).toBeUndefined();
    expect(found.gaps?.[0]).toBe("station");
    expect(land(withVerification(found, "m", PROD_BEFORE_STATION))).toBe("m15artifact");
    expect(land(withVerification(found, "m", withStation))).toBe("m15station");
    expect(land(withVerification(found, "m", EVERY))).toBe("m15station");
  });

  it("showcase (the viewport Planets, TRK #557): the showcase rule's landing and item, both reasons — the bordered Planet / Spacecraft frame once verified", () => {
    const planet = match("eoe-277");
    expect(planet).toMatchObject({
      status: "nearest",
      signature: "borderless/showcase+station",
      template: "m15borderlessland",
      landOn: "m15land",
      reason: `PipGlyph doesn't have this set's showcase frame yet; ${STATION_REASON}`,
      blockedBy: "4.11",
      landOnOnceVerified: { template: "m15stationland" },
    });
    const ship = match("trk-557");
    expect(ship).toMatchObject({
      status: "nearest",
      signature: "showcase+station",
      template: "m15artifact",
      reason: `PipGlyph doesn't have this set's showcase frame yet; ${STATION_REASON}`,
      blockedBy: "4.11",
      onceVerified: "m15station",
    });
    expect(signatureBlockedBy("borderless/showcase+station", "m15land")).toBe("4.11");
    // Adagia's frame colour is its mana's, white; the Enterprise is colourless.
    expect(land(withVerification(planet, "w", PROD_BEFORE_STATION))).toBe("m15land");
    expect(land(withVerification(planet, "w", withStation))).toBe("m15stationland");
    expect(land(withVerification(ship, "c", PROD_BEFORE_STATION))).toBe("m15artifact");
    const shipOn = withVerification(ship, "c", withStation);
    expect(land(shipOn)).toBe("m15station");
    // The showcase's own reason stands: the one-off design is 4.11's.
    expect(shipOn.reason).toBe(`PipGlyph doesn't have this set's showcase frame yet; ${STATION_REASON}`);
  });

  it("every station signature is in the request log's vocabulary", () => {
    for (const key of ["station/2015", "extendedart+station", "borderless/standard+station", "borderless/showcase+station", "showcase+station"]) {
      expect(isKnownFrameSignature(key), key).toBe(true);
    }
    expect(new Set(FRAME_SIGNATURE_KEYS).size).toBe(FRAME_SIGNATURE_KEYS.length);
  });
});

describe("nothing that isn't a station printing moves", () => {
  it("a plain artifact, a land and a Vehicle of the same sets keep their rules", () => {
    expect(match("eoe-240")).toMatchObject({ status: "exact", signature: "era/2015", template: "m15artifact" });
    expect(match("eoe-256")).toMatchObject({ status: "exact", signature: "era/2015", template: "m15land" });
    expect(match("dft-234").signature).toBe("vehicle/2015");
  });

  it("the keyword decides, never the subtype: Doctor Who's 'Plane — Spacecraft' stays a card PipGlyph doesn't make", () => {
    expect(match("who-578")).toMatchObject({ status: "unsupported", signature: "no-card-type" });
  });

  it("a Spacecraft without the keyword (a custom or future type line) is not a station printing", () => {
    const bare = scryfallCardSchema.parse({ ...printingsData["eoe-25"], keywords: [] });
    expect(frameMatchFromScryfall(bare)).toMatchObject({ status: "exact", signature: "era/2015", template: "m15artifact" });
    const lowerCase = scryfallCardSchema.parse({ ...printingsData["eoe-25"], keywords: ["station"] });
    expect(frameMatchFromScryfall(lowerCase).signature).toBe("station/2015");
  });

  it("a showcase or extended-art printing without the keyword keeps its plain signature", () => {
    const extended = scryfallCardSchema.parse({ ...printingsData["eoe-321"], keywords: [] });
    expect(frameMatchFromScryfall(extended).signature).toBe("extendedart");
    const showcase = scryfallCardSchema.parse({ ...printingsData["eoe-277"], keywords: [] });
    expect(frameMatchFromScryfall(showcase)).toMatchObject({ signature: "borderless/showcase", blockedBy: "4.11", reason: "PipGlyph doesn't have this set's showcase frame yet" });
    const trek = scryfallCardSchema.parse({ ...printingsData["trk-557"], keywords: [] });
    expect(frameMatchFromScryfall(trek)).toMatchObject({ signature: "showcase", blockedBy: "4.11" });
  });
});
