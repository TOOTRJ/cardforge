import { describe, expect, it } from "vitest";
import { frameGateError } from "@/lib/cards/frame-availability";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// The server-side twin of the picker's gate: createCardAction /
// updateCardAction refuse an unpublished (template, colour) pair so a stale
// client or a crafted payload can't save what the admin hasn't published.

const published = new Set([
  frameComboKey("m15", "w"),
  frameComboKey("m15", "m"),
  frameComboKey("m15", "c"),
  frameComboKey("saga", "u"),
]);

describe("frameGateError", () => {
  it("passes a published pair", () => {
    expect(frameGateError("m15", ["white"], published)).toBeNull();
    expect(frameGateError("saga", ["blue"], published)).toBeNull();
  });

  it("refuses an unpublished colour of a published frame, naming the colour", () => {
    const error = frameGateError("m15", ["blue"], published);
    expect(error).toMatch(/isn't available in blue yet/);
  });

  it("refuses an unpublished frame outright", () => {
    expect(frameGateError("battle", ["white"], published)).not.toBeNull();
  });

  it("maps identities like the renderer: none → colorless, two or more → multicolor", () => {
    expect(frameGateError("m15", [], published)).toBeNull();
    expect(frameGateError("m15", null, published)).toBeNull();
    expect(frameGateError("m15", ["white", "blue"], published)).toBeNull();
    expect(frameGateError("m15", ["white", "blue", "black"], published)).toBeNull();
  });

  it("treats a missing or legacy template as the default frame", () => {
    expect(frameGateError(undefined, ["white"], published)).toBeNull();
    expect(frameGateError("regular", ["white"], published)).toBeNull();
    expect(frameGateError("regular", ["green"], published)).toMatch(/green/);
  });
});
