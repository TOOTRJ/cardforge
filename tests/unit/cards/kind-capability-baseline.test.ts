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
// tests/unit/cards/fixtures/kind-capabilities.json pins every template's
// capabilities (capabilitiesOf — read from the profile's fields). It is
// edited BY HAND, never regenerated: a PR that changes a row — a new
// template's row, a correction that ships with its bump and scoped sweep
// (4.5c's saga P/T), or anatomy behind a stored per-card switch
// (normalizeAnatomy) — adds a line to `changes` saying why, and the owner
// reviews it. A new (treatment, kind) pair is a NEW template key.
// ---------------------------------------------------------------------------

type Fixture = {
  base: string;
  capabilities: Record<string, AnatomyCapability[]>;
  changes: { template: string; capability: AnatomyCapability; change: "gain" | "loss" | "new-template"; reason: string }[];
};

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests/unit/cards/fixtures/kind-capabilities.json"), "utf8"),
) as Fixture;

const now = (template: string) =>
  ANATOMY_CAPABILITIES.filter((cap) => capabilitiesOf(getFrameProfile(template)).has(cap));

describe("kind capabilities are pinned per template (the owner rule)", () => {
  it("has a row for every template, and none for a template that is gone", () => {
    const missing = FRAME_TEMPLATE_VALUES.filter((t) => !(t in fixture.capabilities));
    expect(missing, "a new template needs its row in kind-capabilities.json (and a `changes` line)").toEqual([]);
    const extra = Object.keys(fixture.capabilities).filter((t) => !(FRAME_TEMPLATE_VALUES as readonly string[]).includes(t));
    expect(extra).toEqual([]);
  });

  it("no existing template GAINS a capability", () => {
    const gains = FRAME_TEMPLATE_VALUES.flatMap((t) =>
      now(t)
        .filter((cap) => !(fixture.capabilities[t] ?? []).includes(cap))
        .map((cap) => `${t} +${cap}`),
    );
    expect(
      gains,
      "A template that exists never gains a kind's anatomy: it would re-dress its stored cards. Make a NEW template (or a stored per-card switch), or — for an owner-approved correction with its bump — edit the row by hand and log it in `changes`.",
    ).toEqual([]);
  });

  it("no existing template LOSES one either (its stored cards would lose the piece)", () => {
    const losses = FRAME_TEMPLATE_VALUES.flatMap((t) =>
      (fixture.capabilities[t] ?? []).filter((cap) => !now(t).includes(cap)).map((cap) => `${t} -${cap}`),
    );
    expect(losses).toEqual([]);
  });

  it("logs a reason for every change since the base", () => {
    for (const change of fixture.changes) {
      expect(change.reason.trim(), `${change.template} ${change.capability}`).not.toBe("");
      expect(ANATOMY_CAPABILITIES).toContain(change.capability);
    }
  });

  it("pins the walker, battle and saga bodies it was written for", () => {
    // The kinds' own anatomy lives on these bodies only (4.5.0's base).
    const holders = (cap: AnatomyCapability) => FRAME_TEMPLATE_VALUES.filter((t) => fixture.capabilities[t].includes(cap));
    expect(holders("loyalty")).toEqual(["m15pw", "m15borderlesspw", "m15borderlesspwtall"]);
    expect(holders("loyaltyRows")).toEqual(["m15pw", "m15borderlesspw", "m15borderlesspwtall"]);
    expect(holders("defense")).toEqual(["battle"]);
    expect(holders("chapters")).toEqual(["saga"]);
    // No showcase frame draws a walker, a battle or a saga.
    for (const t of ["lotr", "lotrscroll", "avatar", "bloomburrow", "bloomanime", "tarkirdraconic", "tarkirghostfire", "tarkirdragon", "fullart", "m15textless", "extendedart"]) {
      expect(fixture.capabilities[t], t).toEqual(["pt"]);
    }
  });
});
