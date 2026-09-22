import { describe, expect, it } from "vitest";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import { PLACEHOLDER_RULES_TEXT } from "@/lib/cards/typography";

describe("new-card defaults", () => {
  it("starts as a 1/1 common creature with the default PipGlyph set icon and no text", () => {
    const v = defaultValuesFor(null, []);
    expect(v.card_type).toBe("creature");
    expect(v.rarity).toBe("common");
    expect(v.power).toBe("1");
    expect(v.toughness).toBe("1");
    expect(v.rules_text).toBe("");
    // Empty icon fields = the PipGlyph mark (SetSymbol's default source).
    expect(v.set_icon_url).toBe("");
    expect(v.set_icon_code).toBe("");
  });
  it("uses the plain placeholder in the editor preview", () => {
    expect(PLACEHOLDER_RULES_TEXT).toBe("Add text and rules here.");
  });
});
