import { describe, expect, it } from "vitest";
import {
  canUseCreatorLab,
  isCreatorLabMode,
  resolveCreatorLayout,
} from "@/lib/creator/lab-shared";

describe("creator lab gating", () => {
  it("off hides it from everyone, admins-only from non-admins", () => {
    expect(canUseCreatorLab("off", true)).toBe(false);
    expect(canUseCreatorLab("admins", false)).toBe(false);
    expect(canUseCreatorLab("admins", true)).toBe(true);
    expect(canUseCreatorLab("everyone", false)).toBe(true);
  });

  it("never switches a viewer without ?lab=1", () => {
    expect(resolveCreatorLayout(true, undefined)).toBe("stepper");
    expect(resolveCreatorLayout(true, "0")).toBe("stepper");
    expect(resolveCreatorLayout(true, "1")).toBe("canvas");
    expect(resolveCreatorLayout(false, "1")).toBe("stepper");
  });

  it("rejects unknown modes from the settings row", () => {
    expect(isCreatorLabMode("everyone")).toBe(true);
    expect(isCreatorLabMode("beta")).toBe(false);
    expect(isCreatorLabMode(undefined)).toBe(false);
  });
});
