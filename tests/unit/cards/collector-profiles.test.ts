import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { parseFrameProfileOverride, resolveFrameProfile } from "@/lib/cards/profile-override";
import { M15PW_COLLECTOR, M15_COLLECTOR, getFrameProfile } from "@/lib/cards/template-layout";
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
    for (const t of slotted) expect(getFrameProfile(t).collector, t).toBe(t === "m15pw" ? M15PW_COLLECTOR : M15_COLLECTOR);
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
    for (const m of source.matchAll(/collector: M15(?:PW)?_COLLECTOR/g)) expect(m.index, "a slot outside PROFILES").toBeGreaterThan(profiles);
    expect(source.match(/collector: M15(?:PW)?_COLLECTOR/g)).toHaveLength(COLLECTOR_TEMPLATES.length);
    expect(source.match(/collector: M15PW_COLLECTOR/g)).toHaveLength(1);
    // The profiles that spread those bases carry none.
    for (const t of ["m15borderless", "m15borderlessartifact", "m15borderlessland", "m15borderlesspw", "m15borderlesspwtall", "adventure", "extendedart", "expeditionland", "nyx", "fullart", "fullartland", "m15fullartland", "m15textless", "m15textlessland", "saga", "m20token", "m20tokentext", "m20tokenartifact"]) {
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
      m15borderless: { footer: { rect: { topPct: 90 } } },
    };
    expect(resolveFrameProfile("m15", overrides).collector).toBe(M15_COLLECTOR);
    expect(resolveFrameProfile("m15pw", overrides).collector).toBe(M15PW_COLLECTOR);
    expect(resolveFrameProfile("m15borderless", overrides).collector).toBeUndefined();
  });
});
