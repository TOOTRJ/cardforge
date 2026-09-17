import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { signupSchema, usernameSchema } from "@/lib/auth/schemas";
import { isGeneratedUsername, isReservedUsername } from "@/lib/auth/usernames";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { parseEmailLinkType } from "@/lib/auth/email-links";

// ---------------------------------------------------------------------------
// Username rules (mirror migration 0094), the shared post-auth redirect guard,
// and the email-link type allowlist.
// ---------------------------------------------------------------------------

describe("usernameSchema", () => {
  it("lowercases instead of rejecting capitals", () => {
    expect(usernameSchema.parse("  ForgeMaster ")).toBe("forgemaster");
  });

  it("rejects bad shapes", () => {
    for (const bad of ["ab", "a".repeat(33), "forge master", "forge-master", "fôrge"]) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("rejects reserved handles in any case", () => {
    for (const bad of ["admin", "Admin", "PIPGLYPH", "support", "settings"]) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(usernameSchema.safeParse("admin_fan").success).toBe(true);
  });

  it("signup normalizes the email too", () => {
    const parsed = signupSchema.parse({
      email: " Someone@Example.COM ",
      username: "Someone_1",
      password: "correct horse battery",
    });
    expect(parsed.email).toBe("someone@example.com");
    expect(parsed.username).toBe("someone_1");
  });
});

describe("reserved list stays in sync with the migration", () => {
  it("every handle in is_reserved_username() is reserved in the app", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/0094_required_unique_usernames.sql"),
      "utf8",
    );
    const body = sql.slice(
      sql.indexOf("create or replace function public.is_reserved_username"),
      sql.indexOf("revoke all on function public.is_reserved_username"),
    );
    const handles = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(handles.length).toBeGreaterThan(40);
    for (const handle of handles) {
      expect(isReservedUsername(handle), handle).toBe(true);
    }
  });
});

describe("isGeneratedUsername", () => {
  it("spots handles minted by generate_username()", () => {
    expect(isGeneratedUsername("ember_sphinx_4821")).toBe(true);
    expect(isGeneratedUsername("mage_0123456789abcdef")).toBe(true);
    expect(isGeneratedUsername(null)).toBe(true);
    expect(isGeneratedUsername("forge_master")).toBe(false);
    expect(isGeneratedUsername("ember_sphinx_48")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-origin paths, query and hash included", () => {
    expect(safeRedirectPath("/create?backFor=1")).toBe("/create?backFor=1");
    expect(safeRedirectPath("/settings#security")).toBe("/settings#security");
  });

  it("rejects anything that can leave the site", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "/ok\\evil",
      "/has space",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(safeRedirectPath(bad), String(bad)).toBe("/dashboard");
    }
    expect(safeRedirectPath("//evil.com", "/onboarding")).toBe("/onboarding");
  });
});

describe("parseEmailLinkType", () => {
  it("only admits the email OTP types", () => {
    expect(parseEmailLinkType("recovery")).toBe("recovery");
    expect(parseEmailLinkType("email_change")).toBe("email_change");
    expect(parseEmailLinkType("sms")).toBeNull();
    expect(parseEmailLinkType(null)).toBeNull();
  });
});
