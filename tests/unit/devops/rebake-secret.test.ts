import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promptHidden } from "@/scripts/lib/hidden-prompt.mjs";
import {
  PRODUCTION_SECRET_QUESTION,
  RebakeSecretError,
  resolveRebakeSecret,
} from "@/scripts/lib/rebake-secret.mjs";

// ---------------------------------------------------------------------------
// scripts/rebake-renders.mjs against PRODUCTION asks for production's
// CRON_SECRET at a hidden prompt when none is set, like
// sweep-storage-orphans.mjs — the runbook's `read -rs CRON_SECRET` step is
// gone (it left the secret in a shell variable to be passed on the command
// line). Contract (scripts/lib/rebake-secret.mjs):
//
//   * production (prod-guard's app hosts) + no CRON_SECRET + a terminal →
//     one hidden prompt, nothing of the answer echoed, its answer is the
//     bearer;
//   * no terminal → refused before any request; an empty answer → refused;
//   * production over http → refused whatever the secret's source;
//   * a CRON_SECRET in the environment is used as before, no prompt;
//   * any other URL (local dev server, a preview) never prompts.
// The CLI tests run the real script with fetch stubbed (a preload module),
// so nothing ever reaches the network.
// ---------------------------------------------------------------------------

const PROD = "https://www.pipglyph.com/api/admin/rebake";
const LOCAL = "http://localhost:3999/api/admin/rebake";
const FAKE_SECRET = "cron_TEST_not_a_real_secret_0123456789";

describe("resolveRebakeSecret", () => {
  it("production, nothing set, a terminal: asks once at the hidden prompt and uses the answer", async () => {
    const prompt = vi.fn(async () => `  ${FAKE_SECRET}  `);
    const got = await resolveRebakeSecret(PROD, { envSecret: "", isTTY: true, prompt });
    expect(got).toEqual({ secret: FAKE_SECRET, production: true, prompted: true });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(PRODUCTION_SECRET_QUESTION);
    expect(PRODUCTION_SECRET_QUESTION).toMatch(/^Production CRON_SECRET for https:\/\/www\.pipglyph\.com .*not echoed\): $/);
  });

  it("the apex, odd case and a trailing dot are production too", async () => {
    for (const url of ["https://pipglyph.com/api/admin/rebake", "https://WWW.PipGlyph.com/api/admin/rebake", "https://www.pipglyph.com./api/admin/rebake"]) {
      const prompt = vi.fn(async () => FAKE_SECRET);
      expect((await resolveRebakeSecret(url, { isTTY: true, prompt })).prompted, url).toBe(true);
    }
  });

  it("wired to the real hidden prompt, nothing of what is pasted reaches the terminal", async () => {
    const input = new PassThrough();
    let written = "";
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          written += chunk.toString();
          done();
        },
      }),
      { columns: 80, rows: 24, isTTY: true },
    );
    const pending = resolveRebakeSecret(PROD, {
      isTTY: true,
      prompt: (question) => promptHidden(question, { input, output }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    input.write(`${FAKE_SECRET}\r`);
    expect((await pending).secret).toBe(FAKE_SECRET);
    const secretPart = FAKE_SECRET.slice("cron_TEST_".length);
    for (let i = 0; i + 4 <= secretPart.length; i += 1) expect(written).not.toContain(secretPart.slice(i, i + 4));
    expect(written).toContain(PRODUCTION_SECRET_QUESTION);
  });

  it("production without a terminal is refused, and nothing is asked", async () => {
    const prompt = vi.fn(async () => FAKE_SECRET);
    await expect(resolveRebakeSecret(PROD, { isTTY: false, prompt })).rejects.toThrow(RebakeSecretError);
    await expect(resolveRebakeSecret(PROD, { isTTY: false, prompt })).rejects.toThrow(/Run this in a terminal/);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("an empty answer is refused", async () => {
    await expect(resolveRebakeSecret(PROD, { isTTY: true, prompt: async () => "   " })).rejects.toThrow(
      /No CRON_SECRET entered/,
    );
  });

  it("production over http is refused, even with a secret set", async () => {
    const prompt = vi.fn(async () => FAKE_SECRET);
    await expect(
      resolveRebakeSecret("http://www.pipglyph.com/api/admin/rebake", { envSecret: FAKE_SECRET, isTTY: true, prompt }),
    ).rejects.toThrow(/use https:\/\//);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("a CRON_SECRET in the environment is used as before — no prompt", async () => {
    const prompt = vi.fn(async () => "other");
    expect(await resolveRebakeSecret(PROD, { envSecret: FAKE_SECRET, isTTY: true, prompt })).toEqual({
      secret: FAKE_SECRET,
      production: true,
      prompted: false,
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("anything but production never prompts: the environment's secret, or none", async () => {
    const prompt = vi.fn(async () => FAKE_SECRET);
    for (const url of [LOCAL, "https://cardforge-git-dev-orderoftheredjester.vercel.app/api/admin/rebake", "https://pipglyph.com.evil.test/x"]) {
      expect(await resolveRebakeSecret(url, { isTTY: true, prompt }), url).toEqual({ secret: "", production: false, prompted: false });
      expect((await resolveRebakeSecret(url, { envSecret: "dev", isTTY: true, prompt })).secret, url).toBe("dev");
    }
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe("scripts/rebake-renders.mjs (fetch stubbed — never the network)", () => {
  const SCRIPT = path.join(process.cwd(), "scripts/rebake-renders.mjs");
  let tmp = "";
  let stub = "";

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "rebake-cli-"));
    stub = path.join(tmp, "fetch-stub.mjs");
    // Every request is reported on stderr (URL + whether the bearer is the
    // expected one — never the value). With STUB_PLAN unset a request fails
    // like a dead network; with it, the route answers an empty plan.
    writeFileSync(
      stub,
      `globalThis.fetch = async (url, init = {}) => {
  const auth = init.headers?.Authorization ?? init.headers?.authorization;
  const bearer = auth === undefined ? "none" : auth === "Bearer " + process.env.STUB_EXPECT_SECRET ? "expected" : "other";
  process.stderr.write("STUB_FETCH " + url + " bearer=" + bearer + "\\n");
  if (!process.env.STUB_PLAN) throw new TypeError("fetch failed (stubbed network)");
  const body = { ok: true, layoutVersion: 34, billingEnabled: true, plan: { rebake: 0, stamp: 0, optIn: 0 } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
`,
    );
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function run(env: Record<string, string>, input = ""): Promise<{ code: number | null; out: string }> {
    const base = { ...process.env };
    delete base.CRON_SECRET;
    delete base.REBAKE_URL;
    delete base.STUB_PLAN;
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", "--import", stub, SCRIPT], {
        cwd: process.cwd(),
        env: { ...base, SCOPE: "sweep", REBAKE_RETRIES: "0", STUB_EXPECT_SECRET: FAKE_SECRET, ...env },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
      // A pipe, not a terminal — what CI or `echo … |` gives the script.
      child.stdin.end(input);
    });
  }

  it("production with no CRON_SECRET and no terminal: refuses before any request, echoes nothing piped in", async () => {
    const { code, out } = await run({ REBAKE_URL: PROD }, `${FAKE_SECRET}\n`);
    expect(code).toBe(1);
    expect(out).toMatch(/Run this in a terminal: production's CRON_SECRET is read at a hidden prompt/);
    expect(out).not.toMatch(/STUB_FETCH/);
    expect(out).not.toContain(FAKE_SECRET);
  });

  it("production over http: refused before any request", async () => {
    const { code, out } = await run({ REBAKE_URL: "http://www.pipglyph.com/api/admin/rebake", CRON_SECRET: FAKE_SECRET });
    expect(code).toBe(1);
    expect(out).toMatch(/use https:\/\//);
    expect(out).not.toMatch(/STUB_FETCH/);
  });

  it("production with CRON_SECRET set: no prompt, the bearer is that secret, never printed", async () => {
    const { code, out } = await run({ REBAKE_URL: PROD, CRON_SECRET: FAKE_SECRET, STUB_PLAN: "1" });
    expect(code).toBe(0);
    expect(out).toMatch(/STUB_FETCH https:\/\/www\.pipglyph\.com\/api\/admin\/rebake\?limit=8&scope=sweep&dry=1 bearer=expected/);
    expect(out).toMatch(/Nothing to do\./);
    expect(out).not.toMatch(/CRON_SECRET for/);
    expect(out).not.toContain(FAKE_SECRET);
  });

  it("a local dev server with no CRON_SECRET: no prompt, no bearer (unchanged)", async () => {
    const { code, out } = await run({ REBAKE_URL: LOCAL, STUB_PLAN: "1" });
    expect(code).toBe(0);
    expect(out).toMatch(/STUB_FETCH http:\/\/localhost:3999\/api\/admin\/rebake\?limit=8&scope=sweep&dry=1 bearer=none/);
    expect(out).not.toMatch(/CRON_SECRET for|terminal/);
  });
});
