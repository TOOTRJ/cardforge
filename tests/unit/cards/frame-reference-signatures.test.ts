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
// (/cards/collection, 2026-09-28; TODO 4.49's token pins 2026-09-29) and
// trimmed to the fields the validator and the resolver read
// (tests/unit/cards/fixtures/reference-printings.json, keyed by Scryfall id;
// it keeps the M20+ token prints 4.49 moved off the arch frames for 4.48 /
// 4.50); no network in tests.
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
//
// The m15snow w/b/g rows are gone (TODO 1.4 owner step A6, done on
// production 2026-09-29): the owner re-verified those combos against Search
// for Glory KHM #27, Priest of the Haunted Edge KHM #104 and Sculptor of
// Winter KHM #193, which are now their defaults; the non-snow printings
// (Axgard Braggart, Deathknell Berserker, Sarulf's Packmate) left the
// registry.
const ALLOWLIST: Record<string, string> = {
  "m15devoid/c#0":
    "verified default; no colourless devoid printing exists, so the row is referenced to BFZ's colourless Eldrazi frame (Kozilek's Channeler BFZ #10)",
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

  it("accepts a Theros god on Nyx outright: an Enchantment Creature borrows it (A3)", () => {
    const heliod = card(idOf("nyx", "w", "Heliod"));
    const result = validateReferenceForCombo(heliod, "nyx", "w");
    expect(result.errors).toEqual([]);
    // No kind exception needed any more: the creator dresses it.
    expect(result.warnings.join(" ")).not.toMatch(/accepted because this printing is that frame/);
    // A creature on the saga frame is still refused.
    expect(validateReferenceForCombo(heliod, "saga", "w").errors).toHaveLength(1);
  });

  it("refuses a plain creature on Nyx, as on the artifact frame (A3, 1.7)", () => {
    const serra = card(idOf("m15", "w", "Serra Angel"));
    expect(validateReferenceForCombo(serra, "nyx", "w").errors).toEqual([
      "Serra Angel isn't an Enchantment Creature; the Nyx — Constellation frame dresses a creature only when it is an enchantment.",
    ]);
  });

  it("keeps the Ghostfire walker references through the 'this printing is that frame' warning (TODO 4.5a)", () => {
    // The Ghostfire frame dresses no planeswalker since 4.5a, but its w and
    // (only) c references are the Elspeth #411 / Ugin #409 walkers, which
    // print it: accepted with a warning until 4.5b re-homes them.
    for (const [colour, name] of [
      ["c", "Ugin"],
      ["w", "Elspeth"],
    ] as const) {
      const result = validateReferenceForCombo(card(idOf("tarkirghostfire", colour, name)), "tarkirghostfire", colour);
      expect(result.errors, name).toEqual([]);
      expect(result.warnings.join(" "), name).toMatch(
        /is a planeswalker, which the .*Ghostfire frame doesn't dress in the creator yet — accepted because this printing is that frame/,
      );
    }
  });

  it("accepts a snow artifact on the snow frame (Replicating Ring KHM #244)", () => {
    const ring = card(idOf("m15snow", "c", "Replicating Ring"));
    expect(validateReferenceForCombo(ring, "m15snow", "c").errors).toEqual([]);
  });

  it("warns when the printing's signature resolves to another template", () => {
    // The Treasure token XLN #7 — m15token/c's default until TODO 4.49's
    // re-pin (TBFZ #1 Eldrazi) — prints the ARTIFACT token frame with a text
    // box (m15tokenartifacttext's default since 4.49 (b)).
    const treasure = card("720f3e68-84c0-462e-a0d1-90236ccc494a");
    expect(treasure.name).toBe("Treasure");
    expect(validateReferenceForCombo(treasure, "m15token", "c").warnings.join(" ")).toMatch(
      /frame signature registry resolves it to the Artifact Token \(2014–2019\), text box frame, not Token\./,
    );
    expect(validateReferenceForCombo(treasure, "m15tokenartifacttext", "c").warnings).toEqual([]);
  });
});
