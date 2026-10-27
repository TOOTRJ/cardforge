import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "@/scripts/ci-pull-supabase-images.mjs";
import { DEFAULT_REGISTRY, imageOn, imagesFor, parseExcluded, pullAll, registryOf, ROUND_DELAYS_MS, SERVICE_IMAGES, sourcesOf, SUPABASE_CLI_VERSION } from "@/scripts/lib/supabase-images.mjs";

// ---------------------------------------------------------------------------
// CI's e2e job pulls the Supabase images itself before `supabase start`
// (scripts/lib/supabase-images.mjs). On 2026-10-27 (PR #611) and on PR #604
// the CLI's one registry, GHCR, answered "toomanyrequests … allowed:
// 44000/minute" to both start attempts; the job failed before a test ran.
// The pull falls back across Supabase's three mirrors in rounds and tags a
// fallback copy with the name the CLI looks for, so the CLI pulls nothing.
// These tests hold the fallback, the rounds, and the list to the workflow.
// ---------------------------------------------------------------------------

type Call = string[];
const ok = { ok: true, output: "" };
const throttled = { ok: false, output: "Error response from daemon: toomanyrequests: retry-after: 550.866µs, allowed: 44000/minute" };

/** A fake `docker`: `answer` decides each call; every call is recorded. */
function fakeDocker(answer: (args: Call) => { ok: boolean; output: string }) {
  const calls: Call[] = [];
  const run = async (args: Call) => {
    calls.push(args);
    return answer(args);
  };
  return { calls, run };
}
const absent = (args: Call) => (args[0] === "image" ? { ok: false, output: "No such image" } : null);
const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};
const quiet = () => {};

describe("image names", () => {
  it("builds the CLI's own names: Docker Hub keeps the image's name, a mirror is <registry>/supabase/<last part>", () => {
    expect(imageOn("public.ecr.aws", "supabase/postgres:17.6.1.095")).toBe("public.ecr.aws/supabase/postgres:17.6.1.095");
    expect(imageOn("ghcr.io", "library/kong:2.8.1")).toBe("ghcr.io/supabase/kong:2.8.1");
    expect(imageOn("docker.io", "axllent/mailpit:v1.22.3")).toBe("axllent/mailpit:v1.22.3");
  });

  it("reads the registry as the CLI does: unset or blank = ECR Public, lower-cased", () => {
    expect(registryOf({})).toBe(DEFAULT_REGISTRY);
    expect(registryOf({ SUPABASE_INTERNAL_IMAGE_REGISTRY: "  " })).toBe("public.ecr.aws");
    expect(registryOf({ SUPABASE_INTERNAL_IMAGE_REGISTRY: "GHCR.IO" })).toBe("ghcr.io");
  });

  it("looks on the CLI's registry first, then the other mirrors, always tagging for the CLI's registry", () => {
    expect(sourcesOf("supabase/gotrue:v2.188.1", "ghcr.io")).toEqual([
      { registry: "ghcr.io", ref: "ghcr.io/supabase/gotrue:v2.188.1", target: "ghcr.io/supabase/gotrue:v2.188.1" },
      { registry: "public.ecr.aws", ref: "public.ecr.aws/supabase/gotrue:v2.188.1", target: "ghcr.io/supabase/gotrue:v2.188.1" },
      { registry: "docker.io", ref: "supabase/gotrue:v2.188.1", target: "ghcr.io/supabase/gotrue:v2.188.1" },
    ]);
  });

  it("starts with every service the -x list leaves running, and refuses a name the CLI does not know", () => {
    const images = imagesFor(["studio", "postgres-meta"]);
    expect(images).toContain(SERVICE_IMAGES.postgres);
    expect(images).not.toContain(SERVICE_IMAGES.studio);
    expect(images).not.toContain(SERVICE_IMAGES["postgres-meta"]);
    expect(images).toHaveLength(Object.keys(SERVICE_IMAGES).length - 2);
    expect(() => imagesFor(["studoi"])).toThrow(/studoi/);
    expect(() => imagesFor(["postgres"])).toThrow(/postgres/);
    expect(parseExcluded(" studio, imgproxy ,,")).toEqual(["studio", "imgproxy"]);
  });
});

describe("pullAll", () => {
  const images = ["supabase/postgres:17.6.1.095", "library/kong:2.8.1"];
  const registry = "public.ecr.aws";

  it("pulls straight from the CLI's registry and tags nothing", async () => {
    const d = fakeDocker((args) => absent(args) ?? ok);
    const { waits, sleep } = noSleep();
    expect(await pullAll({ images, registry, docker: d.run, sleep, log: quiet })).toEqual([]);
    expect(d.calls.filter((c) => c[0] === "tag")).toEqual([]);
    expect(d.calls.filter((c) => c[0] === "pull").map((c) => c[2])).toEqual(["public.ecr.aws/supabase/postgres:17.6.1.095", "public.ecr.aws/supabase/kong:2.8.1"]);
    expect(waits).toEqual([]);
  });

  it("falls back to the next mirror when one throttles, and tags the copy with the CLI's name", async () => {
    const d = fakeDocker((args) => absent(args) ?? (args[0] === "pull" && args[2].startsWith("public.ecr.aws/") ? throttled : ok));
    const { waits, sleep } = noSleep();
    expect(await pullAll({ images: [images[0]], registry, docker: d.run, sleep, log: quiet })).toEqual([]);
    expect(d.calls).toContainEqual(["pull", "--quiet", "ghcr.io/supabase/postgres:17.6.1.095"]);
    expect(d.calls).toContainEqual(["tag", "ghcr.io/supabase/postgres:17.6.1.095", "public.ecr.aws/supabase/postgres:17.6.1.095"]);
    expect(waits).toEqual([]);
  });

  it("reaches Docker Hub by the image's own name, and moves on when a tag fails", async () => {
    const d = fakeDocker((args) => {
      if (args[0] === "image") return { ok: false, output: "No such image" };
      if (args[0] === "pull") return args[2] === "library/kong:2.8.1" || args[2].startsWith("ghcr.io/") ? ok : throttled;
      return args[1].startsWith("ghcr.io/") ? { ok: false, output: "tag failed" } : ok;
    });
    const { sleep } = noSleep();
    expect(await pullAll({ images: [images[1]], registry, docker: d.run, sleep, log: quiet })).toEqual([]);
    expect(d.calls).toContainEqual(["tag", "library/kong:2.8.1", "public.ecr.aws/supabase/kong:2.8.1"]);
  });

  it("waits 30, 60 and 120 s between rounds while every mirror throttles, then pulls", async () => {
    let pulls = 0;
    // Round 1 and 2 throttle on all three mirrors (2 images × 3 = 6 pulls a round).
    const d = fakeDocker((args) => absent(args) ?? (args[0] === "pull" && ++pulls <= 12 ? throttled : ok));
    const { waits, sleep } = noSleep();
    expect(await pullAll({ images, registry, docker: d.run, sleep, log: quiet })).toEqual([]);
    expect(waits).toEqual([30_000, 60_000]);
  });

  it("gives up after four rounds and returns what is still missing", async () => {
    const d = fakeDocker((args) => absent(args) ?? (args[0] === "pull" && args[2].includes("postgres") ? throttled : ok));
    const { waits, sleep } = noSleep();
    expect(await pullAll({ images, registry, docker: d.run, sleep, log: quiet })).toEqual([images[0]]);
    expect(waits).toEqual(ROUND_DELAYS_MS);
    expect(ROUND_DELAYS_MS).toEqual([30_000, 60_000, 120_000]);
    // Kong was pulled once, in round 1 — never again.
    expect(d.calls.filter((c) => c[0] === "pull" && c[2].includes("kong"))).toHaveLength(1);
    expect(d.calls.filter((c) => c[0] === "pull" && c[2].includes("postgres"))).toHaveLength(4 * 3);
  });

  it("pulls one image at a time by default (ECR Public's anonymous quota is per IP), more only when asked", async () => {
    let open = 0;
    let most = 0;
    const run = async (args: Call) => {
      if (args[0] === "image") return { ok: false, output: "No such image" };
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return ok;
    };
    const three = ["a/x:1", "b/y:2", "c/z:3"];
    expect(await pullAll({ images: three, registry, docker: run, log: quiet })).toEqual([]);
    expect(most).toBe(1);
    most = 0;
    expect(await pullAll({ images: three, registry, docker: run, log: quiet, concurrency: 3 })).toEqual([]);
    expect(most).toBe(3);
  });

  it("pulls nothing that is already present under the CLI's name", async () => {
    const d = fakeDocker((args) => (args[0] === "image" ? ok : throttled));
    const { waits, sleep } = noSleep();
    expect(await pullAll({ images, registry, docker: d.run, sleep, log: quiet })).toEqual([]);
    expect(d.calls.filter((c) => c[0] !== "image")).toEqual([]);
    expect(waits).toEqual([]);
  });
});

describe("scripts/ci-pull-supabase-images.mjs", () => {
  it("never fails the job over a pull: it warns and leaves the image to supabase start", async () => {
    const lines: string[] = [];
    const d = fakeDocker((args) => absent(args) ?? (args[2]?.includes("postgres:") ? throttled : ok));
    const code = await main({ env: { SUPABASE_START_EXCLUDE: "studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor" }, run: d.run, sleep: async () => {}, log: (l: string) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith("::warning::") && l.includes("supabase/postgres:17.6.1.095"))).toBe(true);
  });

  it("fails on an -x list the CLI would refuse, before pulling anything", async () => {
    const d = fakeDocker(() => ok);
    const lines: string[] = [];
    expect(await main({ env: { SUPABASE_START_EXCLUDE: "studio,sutdio" }, run: d.run, log: (l: string) => lines.push(l) })).toBe(1);
    expect(d.calls).toEqual([]);
    expect(lines[0]).toMatch(/^::error::.*sutdio/);
  });
});

describe("ci.yml's e2e job", () => {
  const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const job = /\n {2}e2e:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|$)/.exec(ci)?.[1] ?? "";
  const yaml = job
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const jobEnv = (name: string) => new RegExp(`\\n {4}env:\\n(?: {6}.*\\n)*? {6}${name}: (.+)`).exec(yaml)?.[1]?.trim();

  it("installs the CLI the image list was read from", () => {
    // A CLI bump changes its images: re-read pkg/config/templates/Dockerfile
    // at the new tag into SERVICE_IMAGES, then bump SUPABASE_CLI_VERSION.
    expect(/supabase\/setup-cli@v1\n\s+with:\n\s+version: (\S+)/.exec(yaml)?.[1]).toBe(SUPABASE_CLI_VERSION);
  });

  it("names the CLI's registry at JOB level, so setup-cli does not pin GHCR alone", () => {
    expect(jobEnv("SUPABASE_INTERNAL_IMAGE_REGISTRY")).toBe("public.ecr.aws");
  });

  it("pulls with the same -x list supabase start gets, and keeps every service the suite uses", () => {
    const exclude = jobEnv("SUPABASE_START_EXCLUDE");
    expect(exclude).toBeTruthy();
    const images = imagesFor(parseExcluded(exclude));
    // Auth, the REST API and its gateway, storage, realtime (the
    // notification stream) and Mailpit (the password-reset spec's inbox).
    for (const name of ["postgres", "gotrue", "postgrest", "kong", "storage-api", "realtime", "mailpit"] as const) {
      expect(images).toContain(SERVICE_IMAGES[name]);
    }
    expect(yaml).toContain('supabase start -x "$SUPABASE_START_EXCLUDE"');
    expect(yaml).not.toMatch(/supabase start -x [a-z]/);
  });

  it("pulls after the CLI is installed and before the stack starts", () => {
    const setup = yaml.indexOf("supabase/setup-cli@v1");
    const pull = yaml.indexOf("run: node scripts/ci-pull-supabase-images.mjs");
    const start = yaml.indexOf("name: Start local Supabase");
    expect(setup).toBeGreaterThan(-1);
    expect(pull).toBeGreaterThan(setup);
    expect(start).toBeGreaterThan(pull);
    // A pull step that times out or crashes must not fail the job: the CLI
    // still pulls what is missing, as it did before the step existed.
    expect(/run: node scripts\/ci-pull-supabase-images\.mjs\n(?: {8}.*\n)*? {8}continue-on-error: true/.test(yaml + "\n")).toBe(true);
  });
});
