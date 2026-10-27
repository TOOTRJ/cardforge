import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { parseFrameProfileOverride, resolveFrameProfile } from "@/lib/cards/profile-override";
import { EXPEDITION_BFZ_COLLECTOR, EXPEDITION_ZNR_COLLECTOR, M15PW_COLLECTOR, M15_COLLECTOR, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9b — where the collector slot is declared: on exactly the wave-1
// PROFILES entries (COLLECTOR_TEMPLATES), through M15's one slot, and never
// on a base another profile spreads — M15 is spread by eleven consts,
// M15LAND by M15SNOWLAND, M15TOKEN / M15TOKENTEXT by the artifact tokens —
// so a template outside wave 1 (borderless, extended art, the layouts, the
// showcases, the full-art tokens) draws no line whatever a card's switch
// says, and gains one only through its own 4.9d entry.
// ---------------------------------------------------------------------------

describe("the collector slot", () => {
  it("is on exactly the wave-1 PROFILES entries", () => {
    const slotted = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).collector !== undefined);
    expect([...slotted].sort()).toEqual([...COLLECTOR_TEMPLATES].sort());
    // M15's one slot everywhere — the planeswalker's is the same geometry
    // with the © slot pinned to line 2 (its master draws the loyalty
    // shield's outline: M15PW_COLLECTOR).
    // (…and the borderless walkers', TODO 4.9d: their masters draw it too.)
    const walkers = ["m15pw", "m15borderlesspw", "m15borderlesspwtall"];
    // (…and the Expeditions', TODO 4.11 wave 1: M15's slot on each look's
    // printed rows — below.)
    // (…and the MUL Tarkir dragon wings', TODO 4.11: the ZNE rows, where
    // MUL #1 / #60 / #131 / #190 set both lines.)
    const own: Record<string, unknown> = { expeditionland: EXPEDITION_ZNR_COLLECTOR, expeditionlandbfz: EXPEDITION_BFZ_COLLECTOR, tarkirdragon: EXPEDITION_ZNR_COLLECTOR };
    for (const t of slotted) expect(getFrameProfile(t).collector, t).toBe(own[t] ?? (walkers.includes(t) ? M15PW_COLLECTOR : M15_COLLECTOR));
    expect(M15PW_COLLECTOR).toEqual({ ...M15_COLLECTOR, markLine: 2 });
    expect("markLine" in M15_COLLECTOR).toBe(false);
    for (const t of FRAME_TEMPLATE_VALUES) expect(frameAnatomyOf(t).collector, t).toBe((COLLECTOR_TEMPLATES as readonly string[]).includes(t));
    // A legacy template draws the m15 frame, so it has m15's slot.
    expect(frameAnatomyOf("regular").collector).toBe(true);
    expect(getFrameProfile("regular").collector).toBe(M15_COLLECTOR);
  });

  it("is never on the M15 / M15LAND / M15TOKEN / M15TOKENTEXT / EMBLEM / M15PW consts, only on the entries", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/cards/template-layout.ts"), "utf8");
    // Every `collector: M15_COLLECTOR` (the walker's: M15PW_COLLECTOR) is
    // inside the PROFILES literal.
    const profiles = source.indexOf("const PROFILES: Record<FrameTemplate, FrameProfile> = {");
    expect(profiles).toBeGreaterThan(0);
    const SLOT = /collector: (?:M15(?:PW)?|EXPEDITION_(?:ZNR|BFZ))_COLLECTOR/g;
    for (const m of source.matchAll(SLOT)) expect(m.index, "a slot outside PROFILES").toBeGreaterThan(profiles);
    expect(source.match(SLOT)).toHaveLength(COLLECTOR_TEMPLATES.length);
    expect(source.match(/collector: M15PW_COLLECTOR/g)).toHaveLength(3);
    // The Expeditions' rows (TODO 4.11 wave 1): M15's slot on each look's
    // printed rows — ZNE 2 px lower, EXP 6.5 px higher; the MUL Tarkir
    // dragon wings on the ZNE rows (TODO 4.11).
    expect(source.match(/collector: EXPEDITION_(?:ZNR|BFZ)_COLLECTOR/g)).toHaveLength(3);
    expect(getFrameProfile("tarkirdragon").collector).toBe(EXPEDITION_ZNR_COLLECTOR);
    expect(getFrameProfile("expeditionland").collector).toEqual({
      ...M15_COLLECTOR,
      line1BaselinePct: (1995.5 / 2100) * 100,
      line2BaselinePct: (2033.5 / 2100) * 100,
    });
    expect(getFrameProfile("expeditionlandbfz").collector).toEqual({
      ...M15_COLLECTOR,
      line1BaselinePct: (1987 / 2100) * 100,
      line2BaselinePct: (2025.5 / 2100) * 100,
    });
    // The profiles that spread those bases carry none.
    // (The borderless frames carry the slot on their entries since 4.9d —
    // never on M15BORDERLESS, which the land and station dresses spread.)
    for (const t of ["adventure", "extendedart", "nyx", "fullartland", "m15fullartland", "m15textless", "m15textlessland", "saga", "m20token", "m20tokentext", "m20tokenartifact"]) {
      expect(getFrameProfile(t).collector, t).toBeUndefined();
    }
  });

  it("can never come from an admin override (code-owned)", () => {
    expect(parseFrameProfileOverride({ collector: M15_COLLECTOR })).toBeNull();
    expect(parseFrameProfileOverride({ collector: { leftPct: 1 } })).toBeNull();
    expect(parseFrameProfileOverride({ collector: { markLine: 2 } })).toBeNull();
    // …and an override of the slots it MAY move (the footer, a stat plate)
    // leaves the collector slot exactly the code's — on a slotted template
    // and on one without the slot.
    const overrides = {
      m15: { footer: { rect: { topPct: 90 }, sizePct: 0.03 }, pt: { rect: { leftPct: 70 } } },
      m15pw: { footer: { sizePct: 0.03 }, loyalty: { rect: { topPct: 80 } } },
      extendedart: { footer: { rect: { topPct: 90 } } },
    };
    expect(resolveFrameProfile("m15", overrides).collector).toBe(M15_COLLECTOR);
    expect(resolveFrameProfile("m15pw", overrides).collector).toBe(M15PW_COLLECTOR);
    expect(resolveFrameProfile("extendedart", overrides).collector).toBeUndefined();
  });
});
