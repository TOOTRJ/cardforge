import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANATOMY_CAPABILITIES, capabilitiesOf, type AnatomyCapability } from "@/lib/cards/kind-anatomy";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The owner rule, as a test (TODO 4.5.0, proof 3; owner 2026-09-29): a
// template that exists NEVER gains a kind capability. Adding the loyalty
// shield to the Anime frame, a P/T to the saga or the defense shield to a
// showcase would re-dress every stored card of that kind on it at its next
// bake (an edit, an admin re-bake, a template sweep) — and the visual gate
// can't see it: a matrix case 4.5a removed (bloomanime/u/planeswalker-short)
// comes back as a NEW case, which needs no layout bump. This test fails
// first.
//
// tests/unit/cards/fixtures/kind-capabilities.json holds three things:
//   * `baseCapabilities` — every template's capabilities (capabilitiesOf,
//     read from the profile's fields) at the 4.5.0 base. NEVER edited: its
//     sha256 is pinned below, so it can't be rewritten to hide a change.
//   * `changes` — every row change since the base, in order, each with its
//     reason: a new template's row, a correction that ships with its bump and
//     scoped sweep (4.5c's saga P/T), or anatomy behind a stored per-card
//     switch (normalizeAnatomy). The owner reviews each line.
//   * `capabilities` — today's map. It must equal the base with the changes
//     applied, and the code must match it.
// So a template can only gain (or lose) a capability through a logged
// `changes` entry: editing its row alone fails "equals the base with the
// logged changes applied". The file is edited by hand, never regenerated. A
// new (treatment, kind) pair is a NEW template key.
// ---------------------------------------------------------------------------

type CapabilityMap = Record<string, AnatomyCapability[]>;
type Change =
  | { template: string; change: "gain" | "loss"; capability: AnatomyCapability; reason: string }
  | { template: string; change: "new-template"; capabilities: AnatomyCapability[]; reason: string }
  | { template: string; change: "removed-template"; reason: string };
type Fixture = {
  base: string;
  baseCapabilities: CapabilityMap;
  changes: Change[];
  capabilities: CapabilityMap;
};

/** sha256 of `baseCapabilities` (canonical: templates sorted, each row in
 *  ANATOMY_CAPABILITIES order) at the 4.5.0 base, f87657fb. Never changes. */
const BASE_CAPABILITIES_SHA256 = "1780f4167ee9b829f2f401e80dd0d93b675d09cdef8db9a8baf106b67ced8531";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/unit/cards/fixtures/kind-capabilities.json"), "utf8"),
) as Fixture;

const inOrder = (caps: readonly AnatomyCapability[]) =>
  [...caps].sort((a, b) => ANATOMY_CAPABILITIES.indexOf(a) - ANATOMY_CAPABILITIES.indexOf(b));

function canonical(map: CapabilityMap): [string, AnatomyCapability[]][] {
  return Object.keys(map)
    .sort()
    .map((t) => [t, inOrder(map[t])]);
}

/** The base with every logged change applied, in order. Throws on a change
 *  that contradicts the map it applies to (a gain it already has, a loss it
 *  lacks, a new template that exists…), or one without a reason. */
function applyChanges(base: CapabilityMap, changes: readonly Change[]): CapabilityMap {
  const map: CapabilityMap = Object.fromEntries(Object.entries(base).map(([t, caps]) => [t, [...caps]]));
  changes.forEach((c, i) => {
    const at = `changes[${i}] (${c.template} ${c.change})`;
    if (!c.reason?.trim()) throw new Error(`${at}: no reason`);
    const row = map[c.template];
    switch (c.change) {
      case "gain":
      case "loss": {
        if (!ANATOMY_CAPABILITIES.includes(c.capability)) throw new Error(`${at}: unknown capability ${c.capability}`);
        if (!row) throw new Error(`${at}: no such template in the map`);
        const has = row.includes(c.capability);
        if (c.change === "gain" && has) throw new Error(`${at}: already has ${c.capability}`);
        if (c.change === "loss" && !has) throw new Error(`${at}: doesn't have ${c.capability}`);
        map[c.template] = c.change === "gain" ? [...row, c.capability] : row.filter((cap) => cap !== c.capability);
        break;
      }
      case "new-template":
        if (row) throw new Error(`${at}: the template already has a row`);
        for (const cap of c.capabilities) {
          if (!ANATOMY_CAPABILITIES.includes(cap)) throw new Error(`${at}: unknown capability ${cap}`);
        }
        map[c.template] = [...c.capabilities];
        break;
      case "removed-template":
        if (!row) throw new Error(`${at}: no such template in the map`);
        delete map[c.template];
        break;
      default:
        throw new Error(`${at}: unknown change`);
    }
  });
  return map;
}

const now = (template: string) =>
  ANATOMY_CAPABILITIES.filter((cap) => capabilitiesOf(getFrameProfile(template)).has(cap));

describe("kind capabilities are pinned per template (the owner rule)", () => {
  it("the 4.5.0 base map is never edited", () => {
    const digest = createHash("sha256").update(JSON.stringify(canonical(fixture.baseCapabilities))).digest("hex");
    expect(
      digest,
      "kind-capabilities.json `baseCapabilities` is the 4.5.0 base and never changes — log the change in `changes` and edit `capabilities` instead",
    ).toBe(BASE_CAPABILITIES_SHA256);
  });

  it("today's map equals the base with the logged changes applied (every changed row has a `changes` line)", () => {
    const expected = applyChanges(fixture.baseCapabilities, fixture.changes);
    expect(
      canonical(fixture.capabilities),
      "a row of `capabilities` differs from the base without a `changes` entry saying why (or a `changes` entry isn't reflected in its row)",
    ).toEqual(canonical(expected));
  });

  it("has a row for every template, and none for a template that is gone", () => {
    const missing = FRAME_TEMPLATE_VALUES.filter((t) => !(t in fixture.capabilities));
    expect(missing, "a new template needs its row in kind-capabilities.json and a `new-template` change").toEqual([]);
    const extra = Object.keys(fixture.capabilities).filter((t) => !(FRAME_TEMPLATE_VALUES as readonly string[]).includes(t));
    expect(extra, "a removed template needs a `removed-template` change").toEqual([]);
  });

  it("no existing template GAINS a capability", () => {
    const gains = FRAME_TEMPLATE_VALUES.flatMap((t) =>
      now(t)
        .filter((cap) => !(fixture.capabilities[t] ?? []).includes(cap))
        .map((cap) => `${t} +${cap}`),
    );
    expect(
      gains,
      "A template that exists never gains a kind's anatomy: it would re-dress its stored cards. Make a NEW template (or a stored per-card switch), or — for an owner-approved correction with its bump — log a `gain` in `changes` and edit the row.",
    ).toEqual([]);
  });

  it("no existing template LOSES one either (its stored cards would lose the piece)", () => {
    const losses = FRAME_TEMPLATE_VALUES.flatMap((t) =>
      (fixture.capabilities[t] ?? []).filter((cap) => !now(t).includes(cap)).map((cap) => `${t} -${cap}`),
    );
    expect(losses).toEqual([]);
  });

  it("refuses a row edited without its `changes` line, and an inconsistent change", () => {
    // The bypass the base map closes: give the saga a P/T in its row alone.
    const edited = { ...fixture.baseCapabilities, saga: [...fixture.baseCapabilities.saga, "pt" as const] };
    expect(canonical(applyChanges(fixture.baseCapabilities, []))).not.toEqual(canonical(edited));
    // …logged, it matches.
    const logged: Change[] = [{ template: "saga", change: "gain", capability: "pt", reason: "4.5c saga-creature P/T (bump + scoped sweep)" }];
    expect(canonical(applyChanges(fixture.baseCapabilities, logged))).toEqual(canonical(edited));
    expect(() => applyChanges(fixture.baseCapabilities, [{ ...logged[0], reason: " " }])).toThrow(/no reason/);
    expect(() => applyChanges(fixture.baseCapabilities, [{ template: "m15", change: "gain", capability: "pt", reason: "x" }])).toThrow(
      /already has/,
    );
    expect(() =>
      applyChanges(fixture.baseCapabilities, [{ template: "m15", change: "new-template", capabilities: [], reason: "x" }]),
    ).toThrow(/already has a row/);
  });

  it("pins the walker, battle and saga bodies it was written for", () => {
    // The kinds' own anatomy lives on these bodies only (4.5.0's base).
    const base = fixture.baseCapabilities;
    const holders = (cap: AnatomyCapability) => FRAME_TEMPLATE_VALUES.filter((t) => base[t]?.includes(cap));
    expect(holders("loyalty")).toEqual(["m15pw", "m15borderlesspw", "m15borderlesspwtall"]);
    expect(holders("loyaltyRows")).toEqual(["m15pw", "m15borderlesspw", "m15borderlesspwtall"]);
    expect(holders("defense")).toEqual(["battle"]);
    expect(holders("chapters")).toEqual(["saga"]);
    // No showcase frame draws a walker, a battle or a saga.
    for (const t of ["lotr", "lotrscroll", "avatar", "bloomburrow", "bloomanime", "tarkirdraconic", "tarkirghostfire", "tarkirdragon", "fullart", "m15textless", "extendedart"]) {
      expect(base[t], t).toEqual(["pt"]);
    }
  });
});
