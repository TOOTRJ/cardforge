import { afterEach, describe, expect, it, vi } from "vitest";
import { getSiteBaseUrl } from "@/lib/site-url";

// Vercel sets VERCEL_PROJECT_PRODUCTION_URL on EVERY deployment, previews
// included — these pin the order so a preview never again resolves to the
// production domain (it sent dev-database auth links to pipglyph.com).

const VARS = [
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_ENV",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function withEnv(env: Partial<Record<(typeof VARS)[number], string>>) {
  for (const name of VARS) vi.stubEnv(name, env[name] ?? "");
}

afterEach(() => vi.unstubAllEnvs());

describe("getSiteBaseUrl", () => {
  it("falls back to localhost with nothing set", () => {
    withEnv({});
    expect(getSiteBaseUrl()).toBe("http://localhost:3000");
  });

  it("an explicit NEXT_PUBLIC_SITE_URL always wins, trailing slash trimmed", () => {
    withEnv({
      NEXT_PUBLIC_SITE_URL: "https://pipglyph.com/",
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "cardforge-git-x-team.vercel.app",
    });
    expect(getSiteBaseUrl()).toBe("https://pipglyph.com");
  });

  it("production resolves to the production domain", () => {
    withEnv({
      VERCEL_ENV: "production",
      VERCEL_URL: "cardforge-abc123-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "pipglyph.com",
    });
    expect(getSiteBaseUrl()).toBe("https://pipglyph.com");
  });

  it("a preview resolves to ITSELF, not production — branch URL first", () => {
    withEnv({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "cardforge-git-feat-x-team.vercel.app",
      VERCEL_URL: "cardforge-abc123-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "pipglyph.com",
    });
    expect(getSiteBaseUrl()).toBe("https://cardforge-git-feat-x-team.vercel.app");
  });

  it("a preview without a branch URL uses the deployment URL", () => {
    withEnv({
      VERCEL_ENV: "preview",
      VERCEL_URL: "cardforge-abc123-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "pipglyph.com",
    });
    expect(getSiteBaseUrl()).toBe("https://cardforge-abc123-team.vercel.app");
  });
});
