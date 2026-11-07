import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOM_PIPS_HREF } from "@/lib/pips/href";

// ---------------------------------------------------------------------------
// Custom pips live in Tools (owner 2026-11-06): ONE page,
// /dashboard/tools/pips, and every link to the manager reads
// CUSTOM_PIPS_HREF. Settings keeps a pointer, never a second manager.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("custom pips live in Tools", () => {
  it("has its page at the shared address", () => {
    expect(CUSTOM_PIPS_HREF).toBe("/dashboard/tools/pips");
    const page = read("app/(app)/dashboard/tools/pips/page.tsx");
    expect(existsSync(join(process.cwd(), "app/(app)/dashboard/tools/pips/page.tsx"))).toBe(true);
    expect(page).toContain("CustomPipsPanel");
  });

  it("Settings points there and mounts no manager of its own", () => {
    const settings = read("app/(app)/settings/page.tsx");
    expect(settings).not.toMatch(/CustomPipsPanel|CustomPipsManager/);
    expect(settings).toContain("CUSTOM_PIPS_HREF");
  });

  it("the Tools hub and the dashboard link the page, not Settings", () => {
    for (const path of ["app/(app)/dashboard/tools/page.tsx", "app/(app)/dashboard/page.tsx"]) {
      const source = read(path);
      expect(source, path).toContain("CUSTOM_PIPS_HREF");
      expect(source, path).not.toContain("Manage in Settings");
    }
  });
});
