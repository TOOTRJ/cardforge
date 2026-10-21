import { describe, expect, it } from "vitest";
import {
  printTypographyPatch,
  typographyFieldOf,
  withPrintTypography,
  withPrintTypographyUpdate,
} from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// TODO 6.3 — the nickname is a printed NAME (CLAUDE.md "Print typography"):
// set as print sets it on blur, on a patch poured into the form, on a new
// card's save, and on an edit only when the save changes it.
// ---------------------------------------------------------------------------

describe("the nickname's print typography", () => {
  it("is a name field — the front's only", () => {
    expect(typographyFieldOf("nickname")).toBe("name");
    expect(typographyFieldOf("back_face.nickname")).toBeNull();
  });

  it("a patch (an import) is converted", () => {
    expect(printTypographyPatch({ nickname: `Summoner's "Rift"` }).nickname).toBe("Summoner’s “Rift”");
    expect(printTypographyPatch({ title: "x" })).not.toHaveProperty("nickname");
  });

  it("a new card's is converted", () => {
    expect(withPrintTypography({ title: "Kesh", nickname: "Kesh's Stand - '99" }).nickname).toBe("Kesh’s Stand — ’99");
  });

  it("an edit converts it only when it changes", () => {
    const stored = { title: "Kesh", nickname: "Kesh's Stand" };
    expect(withPrintTypographyUpdate({ nickname: "Kesh's Stand" }, stored).nickname).toBe("Kesh's Stand");
    expect(withPrintTypographyUpdate({ nickname: "Kesh's Last Stand" }, stored).nickname).toBe("Kesh’s Last Stand");
    expect(withPrintTypographyUpdate({ nickname: null }, stored).nickname).toBeNull();
  });
});
