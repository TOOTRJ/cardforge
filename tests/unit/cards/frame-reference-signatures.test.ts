import { describe, expect, it } from "vitest";
import referencesData from "@/lib/cards/frame-references.json";
import printingsData from "./fixtures/reference-printings.json";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.4 (c): every frame-registry reference printing resolves, through
// the frame signature registry, to its OWN template (exact or nearest) and
// passes the pin check (validateReferenceForCombo) — except the documented
// allowlist below. The printings were captured once from Scryfall
// (/cards/collection, 2026-09-28) and trimmed to the fields the validator and
// the resolver read (tests/unit/cards/fixtures/reference-printings.json,
// keyed by Scryfall id); no network in tests.
// ---------------------------------------------------------------------------

type Ref = { name: string; set: string; scryfallId: string };
const registry = referencesData as unknown as Record<
  string,
  { colors: Record<string, Ref[] | null> }
>;
const printings = printingsData as Record<string, unknown>;

// "template/colour#index" → why the reference stays although its signature
// resolves to another template. Each is the DEFAULT reference of a combo
// production has verified, which this registry never replaces: the owner
// re-verifies it against an alternate that resolves to the row's template.
const ALLOWLIST: Record<string, string> = {
  "m15snow/w#0":
    "verified default; Axgard Braggart KHM #1 prints the plain M15 frame (not snow) — re-verify against Search for Glory KHM #27",
  "m15snow/b#0":
    "verified default; Deathknell Berserker KHM #83 isn't a snow printing — re-verify against Priest of the Haunted Edge KHM #104",
  "m15snow/g#0":
    "verified default; Sarulf's Packmate KHM #192 isn't a snow printing — re-verify against Sculptor of Winter KHM #193",
  "m15devoid/c#0":
    "verified default; no colourless devoid printing exists, so the row is referenced to BFZ's colourless Eldrazi frame (Kozilek's Channeler BFZ #10)",
  "m15token/c#0":
    "verified default; the Treasure token XLN #7 prints the ARTIFACT token frame — re-verify against Cadet TFRA #1",
};

type Row = { combo: string; template: FrameTemplate; colour: string; ref: Ref };
const rows: Row[] = Object.entries(registry).flatMap(([template, def]) =>
  Object.entries(def.colors).flatMap(([colour, list]) =>
    (list ?? []).map((ref, index) => ({
      combo: `${template}/${colour}#${index}`,
      template: template as FrameTemplate,
      colour,
      ref,
    })),
  ),
);

describe("frame registry references vs the signature registry (TODO 1.4 (c))", () => {
  it("has a captured printing for every reference", () => {
    const missing = rows.filter((row) => !(row.ref.scryfallId in printings)).map((row) => row.combo);
    expect(missing).toEqual([]);
    expect(rows.length).toBeGreaterThan(450);
  });

  it.each(rows)("$combo $ref.name resolves to its own template and passes the pin check", (row) => {
    const card = scryfallCardSchema.parse(printings[row.ref.scryfallId]);
    const match = frameMatchFromScryfall(card);
    const { errors } = validateReferenceForCombo(card, row.template, row.colour);
    expect(errors, row.combo).toEqual([]);
    if (row.combo in ALLOWLIST) {
      expect(match.template, `${row.combo} is allowlisted but now resolves to its own template`).not.toBe(
        row.template,
      );
      return;
    }
    expect(match.template, `${row.combo} ${match.signature} ${match.reason ?? ""}`).toBe(row.template);
    expect(match.status).not.toBe("unsupported");
  });

  it("every allowlisted combo is still in the registry", () => {
    const combos = new Set(rows.map((row) => row.combo));
    for (const combo of Object.keys(ALLOWLIST)) expect(combos.has(combo), combo).toBe(true);
  });
});

describe("the pin check reads the signature (TODO 1.4)", () => {
  const card = (id: string) => scryfallCardSchema.parse(printings[id]);
  const idOf = (template: string, colour: string, name: string) =>
    registry[template]!.colors[colour]!.find((ref) => ref.name.startsWith(name))!.scryfallId;

  it("accepts a Theros god on Nyx — the printing IS the constellation showcase — with a warning", () => {
    const heliod = card(idOf("nyx", "w", "Heliod"));
    const result = validateReferenceForCombo(heliod, "nyx", "w");
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/accepted because this printing is that frame/);
    // …but only on the frame it IS: a creature on the saga frame is still
    // refused.
    expect(validateReferenceForCombo(heliod, "saga", "w").errors).toHaveLength(1);
  });

  it("accepts a snow artifact on the snow frame (Replicating Ring KHM #244)", () => {
    const ring = card(idOf("m15snow", "c", "Replicating Ring"));
    expect(validateReferenceForCombo(ring, "m15snow", "c").errors).toEqual([]);
  });

  it("warns when the printing's signature resolves to another template", () => {
    const treasure = card(idOf("m15token", "c", "Treasure"));
    expect(validateReferenceForCombo(treasure, "m15token", "c").warnings.join(" ")).toMatch(
      /frame signature registry resolves it to the Artifact Token frame/,
    );
  });
});
