import { describe, expect, it } from "vitest";
import { decideUpdate } from "@/lib/updates/build-check";

const base = { current: "dpl_a", remote: "dpl_b", reloadedFor: null, snoozedUntil: null, now: 1_000_000 };

describe("decideUpdate", () => {
  it("prompts when production serves a different build", () => {
    expect(decideUpdate(base)).toBe("prompt");
  });
  it("stays silent when the tab is current, or in local dev", () => {
    expect(decideUpdate({ ...base, remote: "dpl_a" })).toBe("none");
    expect(decideUpdate({ ...base, current: "dev" })).toBe("none");
    expect(decideUpdate({ ...base, remote: "" })).toBe("none");
  });
  it("never loops after a reload that did not help (rollback / race)", () => {
    expect(decideUpdate({ ...base, reloadedFor: "dpl_b" })).toBe("quiet");
    expect(decideUpdate({ ...base, reloadedFor: "dpl_old" })).toBe("prompt");
  });
  it("respects a snooze until it lapses", () => {
    expect(decideUpdate({ ...base, snoozedUntil: base.now + 1 })).toBe("quiet");
    expect(decideUpdate({ ...base, snoozedUntil: base.now - 1 })).toBe("prompt");
  });
});
