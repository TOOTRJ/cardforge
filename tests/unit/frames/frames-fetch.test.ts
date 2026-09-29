import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchVerified } from "@/scripts/lib/frame-objects.mjs";

// ---------------------------------------------------------------------------
// scripts/frames-fetch.mjs — CI's copy of the bucket masters (TODO 7.6): every
// PNG in the frame manifest, fetched from a public frames bucket (production's
// by default) into <out>/<template>/<key>.png and kept only at the manifest's
// sha256, so the art-window, edge-contract, square-corner and plate-ink tests
// run on them instead of skipping.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "frames-fetch.mjs");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("fetchVerified", () => {
  afterEach(() => vi.unstubAllGlobals());
  const body = Buffer.from("frame bytes");

  it("returns the bytes when they are the manifest's", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const r = await fetchVerified("https://b/x", sha256(body), { baseDelayMs: 0 });
    expect(r.ok).toBe(true);
    expect(Buffer.compare(r.bytes!, body)).toBe(0);
  });

  it("retries a transient 400 / 429 and a truncated body, and reports what it last saw", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(body.subarray(0, 4), { status: 200 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchVerified("https://b/x", sha256(body), { baseDelayMs: 0 })).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("other bytes", { status: 200 })));
    expect(await fetchVerified("https://b/x", sha256(body), { tries: 2, baseDelayMs: 0 })).toEqual({ ok: false, status: "sha256 mismatch" });
  });

  it("takes a 404 as final", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchVerified("https://b/x", sha256(body), { baseDelayMs: 0 })).toEqual({ ok: false, status: "404" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("scripts/frames-fetch.mjs", () => {
  let tmp = "";
  let origin: Server;
  let fallback: Server;
  let originUrl = "";
  let fallbackUrl = "";
  const originObjects = new Map<string, Buffer>();
  const fallbackObjects = new Map<string, Buffer>();
  const hits: string[] = [];

  const serve = (objects: Map<string, Buffer>, name: string) =>
    createServer((req, res) => {
      hits.push(`${name} ${req.url}`);
      const bytes = objects.get(decodeURIComponent((req.url ?? "").slice(1)));
      if (!bytes) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "image/png" }).end(bytes);
    });
  const listen = (s: Server) =>
    new Promise<string>((resolve) => s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

  const files: Record<string, Buffer> = {
    "m15/w.png": Buffer.from("m15 white master"),
    "m15/pt/w.png": Buffer.from("m15 white plate"),
    "m15tokentext/c.png": Buffer.from("a frame not promoted yet"),
  };
  const objectKey = (key: string) => {
    const hash = sha256(files[key]).slice(0, 12);
    return key.replace(/\.png$/, `.${hash}.png`);
  };

  function run(args: string[]): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", SCRIPT, ...args], { cwd: tmp });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  }

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "frames-fetch-"));
    mkdirSync(path.join(tmp, "lib", "frames"), { recursive: true });
    const manifest = {
      version: 1,
      bucket: "frames",
      files: {
        ...Object.fromEntries(
          Object.entries(files).map(([key, bytes]) => [key, { hash: sha256(bytes).slice(0, 12), sha256: sha256(bytes), bytes: bytes.length }]),
        ),
        // WebP siblings are the site's, not the tests': never fetched.
        "m15/w.webp": { hash: "000000000000", sha256: "0".repeat(64), bytes: 1 },
      },
    };
    writeFileSync(path.join(tmp, "lib", "frames", "frame-manifest.json"), JSON.stringify(manifest));
    originObjects.set(objectKey("m15/w.png"), files["m15/w.png"]);
    originObjects.set(objectKey("m15/pt/w.png"), files["m15/pt/w.png"]);
    fallbackObjects.set(objectKey("m15tokentext/c.png"), files["m15tokentext/c.png"]);
    origin = serve(originObjects, "origin");
    fallback = serve(fallbackObjects, "fallback");
    originUrl = await listen(origin);
    fallbackUrl = await listen(fallback);
  });

  afterAll(() => {
    origin?.close();
    fallback?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("fetches every manifest PNG at its content-addressed key, the fallback only for what the origin lacks", async () => {
    const out = path.join(tmp, "cache");
    const r = await run(["--out", out, "--origin", originUrl, "--fallback-origin", fallbackUrl]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/✓ 3 frame PNGs in .*: 0 kept, 2 fetched from http:\/\/127\.0\.0\.1:\d+, 1 from the fallback/);
    for (const [key, bytes] of Object.entries(files)) expect(readFileSync(path.join(out, key)).equals(bytes), key).toBe(true);
    expect(existsSync(path.join(out, "m15", "w.webp"))).toBe(false);
    expect(hits.filter((h) => h.startsWith("fallback"))).toEqual([`fallback /${objectKey("m15tokentext/c.png")}`]);
  });

  it("keeps what is already there at the manifest's sha, re-fetches what isn't and drops PNGs the manifest no longer lists", async () => {
    const out = path.join(tmp, "cache");
    writeFileSync(path.join(out, "m15", "w.png"), "a stale build");
    mkdirSync(path.join(out, "retired"), { recursive: true });
    writeFileSync(path.join(out, "retired", "w.png"), "a template the manifest dropped");
    hits.length = 0;
    const r = await run(["--out", out, "--origin", originUrl, "--fallback-origin", fallbackUrl]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/2 kept, 1 fetched from .*, 0 from the fallback .*, 1 stale removed/);
    expect(readFileSync(path.join(out, "m15", "w.png")).equals(files["m15/w.png"])).toBe(true);
    expect(existsSync(path.join(out, "retired", "w.png"))).toBe(false);
    expect(hits).toEqual([`origin /${objectKey("m15/w.png")}`]);
  });

  it("fails, naming the object, when neither bucket has the manifest's bytes", async () => {
    const r = await run(["--out", path.join(tmp, "no-fallback"), "--origin", originUrl]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`✗ 1/3 manifest PNGs could not be fetched with the manifest's sha256:`);
    expect(r.out).toContain(`${objectKey("m15tokentext/c.png")}  (last answer: 404)`);
  });

  it("never prunes a folder it didn't make (an importer build, public/)", async () => {
    const build = path.join(tmp, "frames-build");
    mkdirSync(path.join(build, "m15"), { recursive: true });
    writeFileSync(path.join(build, "m15", "b.png"), "the owner's own build");
    const r = await run(["--out", build, "--origin", originUrl]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/is not empty and was not made by frames-fetch/);
    expect(readFileSync(path.join(build, "m15", "b.png"), "utf8")).toBe("the owner's own build");
  });

  it("refuses a plain-http origin that isn't this machine", async () => {
    const r = await run(["--out", path.join(tmp, "x"), "--origin", "http://example.com/frames"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ http://example.com/frames is not an https URL.");
  });
});
