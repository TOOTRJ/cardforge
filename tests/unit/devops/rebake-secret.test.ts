import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
// so nothing ever reaches the network — through a pipe, and in a REAL
// terminal (a pseudo-terminal): the fake streams above can't see the
// terminal's own echo, so a prompt that left the tty in cooked mode passed
// every one of them while a real terminal showed the whole secret. The
// script reads no env file either: CRON_SECRET comes from the environment
// or the prompt, never from a `.env*` lying in the working directory.
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

describe("scripts/rebake-renders.mjs (fetch stubbed — never the network)", { timeout: 30_000 }, () => {
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

  /** The test process's environment minus everything the script reads. */
  function baseEnv() {
    const base = { ...process.env };
    delete base.CRON_SECRET;
    delete base.REBAKE_URL;
    delete base.STUB_PLAN;
    return base;
  }

  function run(
    env: Record<string, string>,
    input = "",
    cwd = process.cwd(),
  ): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", "--import", stub, SCRIPT], {
        cwd,
        env: { ...baseEnv(), SCOPE: "sweep", REBAKE_RETRIES: "0", STUB_EXPECT_SECRET: FAKE_SECRET, ...env },
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

  it("never takes CRON_SECRET from an env file in the working directory", async () => {
    const cwd = path.join(tmp, "with-env-files");
    mkdirSync(cwd, { recursive: true });
    for (const file of [".env", ".env.local", ".env.prod-peek", ".env.production", ".env.production.local"]) {
      writeFileSync(path.join(cwd, file), `CRON_SECRET=${FAKE_SECRET}\nREBAKE_URL=${PROD}\n`);
    }
    // Production, nothing in the environment, no terminal: refused — the
    // files' secret is not a fallback.
    const prod = await run({ REBAKE_URL: PROD, STUB_PLAN: "1" }, "", cwd);
    expect(prod.code).toBe(1);
    expect(prod.out).toMatch(/Run this in a terminal/);
    expect(prod.out).not.toMatch(/STUB_FETCH/);
    // A local server: no bearer at all.
    const local = await run({ REBAKE_URL: LOCAL, STUB_PLAN: "1" }, "", cwd);
    expect(local.code).toBe(0);
    expect(local.out).toMatch(/STUB_FETCH http:\/\/localhost:3999\/\S+ bearer=none/);
  });

  // ---- In a real terminal -------------------------------------------------
  // python3's pty module gives the script a pseudo-terminal: its stdin is a
  // TTY (so it prompts), and the terminal driver echoes whatever is typed
  // unless the prompt switched echo off. The driver waits for the question,
  // types one key at a time like a person (then a stray key and a
  // backspace, then Enter) and prints everything the terminal showed.
  // Required in CI (ubuntu has python3); skipped locally only without it.
  const hasPty = spawnSync("python3", ["-c", "import pty, termios, fcntl, struct"]).status === 0;
  const PTY_DRIVER = `import os, pty, select, struct, sys, time, fcntl, termios
cols = int(sys.argv[1]); wait_for = sys.argv[2].encode(); keys = sys.stdin.buffer.read()
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 24, cols, 0, 0))
    os.execvp(sys.argv[3], sys.argv[3:])
out = b""
def pump(timeout):
    global out
    if not select.select([fd], [], [], timeout)[0]: return True
    try: chunk = os.read(fd, 4096)
    except OSError: return False
    if not chunk: return False
    out += chunk
    return True
deadline = time.time() + 20
alive = True
while alive and wait_for not in out and time.time() < deadline: alive = pump(0.1)
if alive and wait_for in out:
    for key in keys:
        os.write(fd, bytes([key])); time.sleep(0.005); pump(0)
while time.time() < deadline and pump(1): pass
try: os.kill(pid, 9)
except OSError: pass
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 99)
`;

  function runInTerminal(
    env: Record<string, string>,
    keys: string,
    columns: number,
  ): Promise<{ code: number | null; shown: string; log: string }> {
    const driver = path.join(tmp, "pty-driver.py");
    writeFileSync(driver, PTY_DRIVER);
    return new Promise((resolve) => {
      const child = spawn(
        "python3",
        [driver, String(columns), "not echoed): ", process.execPath, "--no-warnings", "--import", stub, SCRIPT],
        {
          cwd: process.cwd(),
          env: { ...baseEnv(), SCOPE: "sweep", REBAKE_RETRIES: "0", STUB_EXPECT_SECRET: PTY_SECRET, ...env },
        },
      );
      let shown = "";
      let log = "";
      child.stdout.on("data", (d) => (shown += d));
      child.stderr.on("data", (d) => (log += d));
      child.on("close", (code) => resolve({ code, shown, log }));
      child.stdin.end(keys);
    });
  }

  /** A secret no terminal output could contain by chance. */
  const PTY_SECRET = "cron_TEST_Qz7xKp9Wm2Lv4Rb8Nc6Td1Yh5Fj3Gs0Ue";
  function expectNoSecretIn(shown: string) {
    const secretPart = PTY_SECRET.slice("cron_TEST_".length);
    for (let i = 0; i + 4 <= secretPart.length; i += 1) expect(shown).not.toContain(secretPart.slice(i, i + 4));
  }

  for (const columns of [40, 120]) {
    it.skipIf(!hasPty && !process.env.CI)(
      `production, no CRON_SECRET, a real terminal ${columns} columns wide: asks once, echoes nothing typed, sends what was typed`,
      async () => {
        const { code, shown, log } = await runInTerminal(
          { REBAKE_URL: PROD, STUB_PLAN: "1" },
          `${PTY_SECRET}X\x7f\r`,
          columns,
        );
        expect(code, `${shown}\n${log}`).toBe(0);
        expect(shown.split(PRODUCTION_SECRET_QUESTION)).toHaveLength(2);
        expect(shown).toMatch(
          /STUB_FETCH https:\/\/www\.pipglyph\.com\/api\/admin\/rebake\?limit=8&scope=sweep&dry=1 bearer=expected/,
        );
        expect(shown).toMatch(/Nothing to do\./);
        // Not one 4-character run of it — escape sequences included.
        expectNoSecretIn(shown);
      },
    );
  }

  it.skipIf(!hasPty && !process.env.CI)("Ctrl+C at the prompt exits 130 and sends nothing", async () => {
    const { code, shown } = await runInTerminal({ REBAKE_URL: PROD, STUB_PLAN: "1" }, "Qz7x\x03", 80);
    expect(shown).toContain(PRODUCTION_SECRET_QUESTION);
    expect(code).toBe(130);
    expect(shown).not.toMatch(/STUB_FETCH/);
    expect(shown).not.toContain("Qz7x");
  });
});
