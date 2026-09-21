import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Plain .mjs shared with the Node scripts (allowJs types it loosely).
import * as guard from "../../../scripts/lib/prod-guard.mjs";

const { PRODUCTION_SUPABASE_REF, PRODUCTION_SUPABASE_HOSTS, isProductionSupabaseUrl } =
  guard as {
    PRODUCTION_SUPABASE_REF: string;
    PRODUCTION_SUPABASE_HOSTS: string[];
    isProductionSupabaseUrl: (url: unknown) => boolean;
  };

// scripts/lib/prod-guard.mjs is what stands between a dev machine and the
// production database: `npm run dev` refuses to start, seed-dev refuses to
// write, db-dev refuses to push. These pin what it recognises.

describe("isProductionSupabaseUrl", () => {
  it("recognises production by either hostname", () => {
    expect(isProductionSupabaseUrl(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`)).toBe(true);
    expect(isProductionSupabaseUrl("https://auth.pipglyph.com")).toBe(true);
    expect(isProductionSupabaseUrl("https://AUTH.PIPGLYPH.COM/rest/v1/")).toBe(true);
  });

  it("recognises production inside a Postgres connection string (pooler user carries the ref)", () => {
    expect(
      isProductionSupabaseUrl(
        `postgresql://postgres.${PRODUCTION_SUPABASE_REF}:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      ),
    ).toBe(true);
    expect(
      isProductionSupabaseUrl(`postgresql://postgres:pw@db.${PRODUCTION_SUPABASE_REF}.supabase.co:5432/postgres`),
    ).toBe(true);
  });

  it("lets the dev branch, preview branches and the local stack through", () => {
    for (const url of [
      "https://znipzaxgpaiandwiqabn.supabase.co",
      "https://pdukhqarjbswmsrlfzov.supabase.co",
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "postgresql://postgres.znipzaxgpaiandwiqabn:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    ]) {
      expect(isProductionSupabaseUrl(url), url).toBe(false);
    }
  });

  it("treats junk as not-production (callers validate the target separately)", () => {
    for (const bad of [undefined, null, "", "   ", 42, "not a url"]) {
      expect(isProductionSupabaseUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe("the dev remote in supabase/config.toml", () => {
  const config = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");
  // [^[]* spans newlines on its own, so no dotAll flag is needed.
  const devRef = /\[remotes\.dev\][^[]*?project_id\s*=\s*"([a-z]+)"/.exec(config)?.[1];

  it("exists — scripts/db-dev.mjs reads its target from here", () => {
    expect(devRef).toMatch(/^[a-z]{16,24}$/);
  });

  it("is never the production project", () => {
    expect(devRef).not.toBe(PRODUCTION_SUPABASE_REF);
    expect(PRODUCTION_SUPABASE_HOSTS.some((host) => host.startsWith(`${devRef}.`))).toBe(false);
  });

  it("seeds are enabled for it (persistent branches only seed when told to)", () => {
    expect(config).toMatch(/\[remotes\.dev\.db\.seed\]\s*(?:#.*\s*)*enabled\s*=\s*true/);
  });
});
