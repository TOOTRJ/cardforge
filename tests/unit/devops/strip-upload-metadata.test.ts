import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectImageMetadata, stripImageMetadata } from "@/lib/media/strip-metadata";
import { MAX_INLINE_BYTES, MAX_INLINE_EDGE, toSatoriDataUrl } from "@/lib/render/art-source";
import {
  BAKE_INLINE_MAX_BYTES,
  BAKE_INLINE_MAX_EDGE,
  USER_UPLOAD_BUCKETS,
  alreadyDone,
  bakeInputOf,
  cacheControlSeconds,
  describe as describeObject,
  isAiOutput,
  planStrip,
  verifyStripped,
} from "@/scripts/lib/upload-metadata.mjs";
import {
  FAKE_CAMERA_MAKE,
  FAKE_OWNER,
  c2paSegment,
  cameraPhoto,
  cleanPhoto,
  gpsTiff,
  pngChunk,
  withJpegSegments,
  withPngChunks,
} from "@/tests/stubs/metadata-fixtures";
import { storedAs } from "@/tests/stubs/exif-fixtures";

// ---------------------------------------------------------------------------
// TODO 3.14a — the owner-run backfill (scripts/strip-upload-metadata.mjs):
// its checks (scripts/lib/upload-metadata.mjs) and a full run against a fake
// Supabase Storage API — dry run, a refused confirm, --apply, and the
// resumed re-run — plus the guards that keep it off production by accident
// and away from card-renders.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/strip-upload-metadata.mjs");

/** A camera JPEG a little over the bake's 3 MB inline cap whose metadata
 *  (a trailing secondary image, like an MPF gain map) is what keeps it over:
 *  stripped, it would drop under the cap and bake down a different path. */
async function jpegAcrossTheInlineCap(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: "#777", noise: { type: "gaussian", mean: 128, sigma: 70 } },
  })
    .withExif({ IFD0: { Make: FAKE_CAMERA_MAKE } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
  expect(base.length).toBeLessThan(MAX_INLINE_BYTES);
  return Buffer.concat([base, Buffer.alloc(MAX_INLINE_BYTES - base.length + 40_000, 7)]);
}

describe("the backfill's checks", () => {
  it("mirrors the bake's inline rule (lib/render/art-source.ts) — constants and output", async () => {
    expect(BAKE_INLINE_MAX_BYTES).toBe(MAX_INLINE_BYTES);
    expect(BAKE_INLINE_MAX_EDGE).toBe(MAX_INLINE_EDGE);
    const decode = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    // inline (small untagged JPEG / PNG), turn (tagged JPEG → JPEG, tagged
    // PNG with alpha → PNG), transcode (WebP)
    for (const small of [await cleanPhoto("jpeg"), await cameraPhoto("png", { alpha: true })]) {
      expect(await bakeInputOf(small)).toEqual({ path: "inline" });
      expect(decode(await toSatoriDataUrl(small)).equals(small)).toBe(true);
    }
    const cases: [Buffer, string][] = [
      [await storedAs(6, "jpeg"), "jpeg"],
      [await cameraPhoto("png", { alpha: true, orientation: 8 }), "png"],
      [await cameraPhoto("webp"), "jpeg"],
    ];
    for (const [bytes, path] of cases) {
      const mirror = await bakeInputOf(bytes);
      expect(mirror.path).toBe(path);
      expect(decode(await toSatoriDataUrl(bytes)).equals(mirror.bytes!)).toBe(true);
    }
  });

  it("plans a lossless strip; a clean file (or one with only C2PA provenance) needs nothing", async () => {
    expect(planStrip(await cleanPhoto("png")).status).toBe("clean");
    expect(planStrip(withJpegSegments(await cleanPhoto("jpeg"), c2paSegment()))).toMatchObject({
      status: "clean",
      report: { provenance: true },
    });
    const photo = await cameraPhoto("jpeg");
    const plan = planStrip(photo);
    expect(plan).toMatchObject({ status: "strip", padded: false, report: { gps: true } });
    expect(await verifyStripped(photo, plan.bytes!)).toEqual([]);
    expect(planStrip(Buffer.from("not an image")).status).toBe("unparseable");
  });

  it("pads a file the strip would move under the bake's inline cap, so it bakes down the same path", async () => {
    const big = await jpegAcrossTheInlineCap();
    const plain = Buffer.from(stripImageMetadata(big)!.bytes);
    // Without padding the bake would inline it instead of re-encoding it.
    expect(plain.length).toBeLessThanOrEqual(MAX_INLINE_BYTES);
    expect(await verifyStripped(big, plain)).toContain("bake path jpeg → inline");
    const plan = planStrip(big);
    expect(plan).toMatchObject({ status: "strip", padded: true });
    expect(plan.bytes!.length).toBeGreaterThan(MAX_INLINE_BYTES);
    expect(await verifyStripped(big, plan.bytes!)).toEqual([]);
    expect(inspectImageMetadata(plan.bytes!)?.found).toEqual([]);
  }, 30_000);

  it("refuses anything a viewer or the bake would draw differently", async () => {
    const photo = await cameraPhoto("jpeg");
    const reencoded = await sharp(photo).keepIccProfile().jpeg({ quality: 70 }).toBuffer();
    expect((await verifyStripped(photo, reencoded)).some((p) => p.startsWith("pixels differ"))).toBe(true);
    const noIcc = await sharp(photo).jpeg({ quality: 90 }).toBuffer();
    expect(await verifyStripped(photo, noIcc)).toContain("ICC profile changed");
    const turned = Buffer.from(stripImageMetadata(await cameraPhoto("jpeg", { orientation: 6 }))!.bytes);
    const unturned = await sharp(turned).jpeg().toBuffer();
    expect((await verifyStripped(turned, unturned)).some((p) => p.startsWith("orientation"))).toBe(true);
  });

  it("small helpers: cache-control, AI outputs, resume state, labels without values", async () => {
    expect([cacheControlSeconds("max-age=3600"), cacheControlSeconds("31536000"), cacheControlSeconds("no-cache")]).toEqual([
      "3600",
      "31536000",
      null,
    ]);
    expect([isAiOutput("u/ai-123.png"), isAiOutput("u/123.png"), isAiOutput("u/wm-ai-1.png")]).toEqual([true, false, false]);
    const state = { objects: { "card-art/u/a.jpg": { etag: '"1"', status: "stripped" }, "card-art/u/b.jpg": { etag: '"2"', status: "skipped" } } };
    expect([alreadyDone(state, "card-art/u/a.jpg", '"1"'), alreadyDone(state, "card-art/u/a.jpg", '"9"'), alreadyDone(state, "card-art/u/b.jpg", '"2"')]).toEqual([
      true,
      false,
      false,
    ]);
    const line = describeObject("card-art/u/a.jpg", 2048, inspectImageMetadata(await cameraPhoto("jpeg", { orientation: 6 }))!);
    expect(line).toContain("exif:gps");
    expect(line).toContain("[GPS, keeps orientation 6]");
    for (const value of [FAKE_CAMERA_MAKE, FAKE_OWNER, "0/1"]) expect(line).not.toContain(value);
    expect(USER_UPLOAD_BUCKETS).not.toContain("card-renders");
    expect(USER_UPLOAD_BUCKETS).not.toContain("frames");
  });
});

// --- a fake Supabase Storage API ---------------------------------------------------

type StoredObject = { bytes: Buffer; contentType: string; cacheControl: string; metadata: Record<string, string>; etag: string; puts: number };
const etagOf = (bytes: Buffer) => `"${createHash("md5").update(bytes).digest("hex")}"`;

function fakeStorage(store: Map<string, StoredObject>): Server {
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const parts: Buffer[] = [];
      req.on("data", (d) => parts.push(d));
      req.on("end", () => resolve(Buffer.concat(parts)));
    });
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  return createServer(async (req, res) => {
    const body = await readBody(req);
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const LIST = "/storage/v1/object/list/";
    const INFO = "/storage/v1/object/info/";
    const OBJECT = "/storage/v1/object/";
    if (req.method === "POST" && p.startsWith(LIST)) {
      const bucket = p.slice(LIST.length);
      const { prefix = "", limit = 100, offset = 0 } = JSON.parse(body.toString() || "{}");
      const base = `${bucket}/${prefix ? `${prefix}/` : ""}`;
      const entries = new Map<string, StoredObject | null>();
      for (const [key, obj] of store) {
        if (!key.startsWith(base)) continue;
        const [head, ...rest] = key.slice(base.length).split("/");
        entries.set(head, rest.length ? null : obj);
      }
      const page = [...entries].sort(([a], [b]) => (a < b ? -1 : 1)).slice(offset, offset + limit);
      return json(
        res,
        200,
        page.map(([name, obj]) =>
          obj
            ? { name, id: `id-${name}`, metadata: { eTag: obj.etag, size: obj.bytes.length, mimetype: obj.contentType, cacheControl: obj.cacheControl } }
            : { name, id: null, metadata: null },
        ),
      );
    }
    if (req.method === "GET" && p.startsWith(INFO)) {
      const obj = store.get(p.slice(INFO.length));
      if (!obj) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      return json(res, 200, { size: obj.bytes.length, content_type: obj.contentType, cache_control: obj.cacheControl, etag: obj.etag, metadata: obj.metadata });
    }
    if (p.startsWith(OBJECT)) {
      const key = p.slice(OBJECT.length);
      const obj = store.get(key);
      if (!obj) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": obj.contentType });
        return res.end(obj.bytes);
      }
      if (req.method === "PUT") {
        obj.bytes = body;
        obj.contentType = String(req.headers["content-type"]);
        obj.cacheControl = String(req.headers["cache-control"]);
        const meta = req.headers["x-metadata"];
        if (typeof meta === "string") obj.metadata = JSON.parse(Buffer.from(meta, "base64").toString());
        obj.etag = etagOf(body);
        obj.puts += 1;
        return json(res, 200, { Key: key });
      }
    }
    json(res, 400, { message: `unexpected ${req.method} ${p}` });
  });
}

function run(args: string[], input = ""): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, HOME: tmp } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(input);
  });
}

let tmp = "";
let server: Server;
const store = new Map<string, StoredObject>();
const put = (key: string, bytes: Buffer, contentType: string, cacheControl = "max-age=3600", metadata: Record<string, string> = {}) =>
  store.set(key, { bytes, contentType, cacheControl, metadata, etag: etagOf(bytes), puts: 0 });
const originals = new Map<string, Buffer>();

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "strip-meta-"));
  put("card-art/u1/gps.jpg", await cameraPhoto("jpeg"), "image/jpeg", "max-age=3600", { note: "kept" });
  put("card-art/u1/rotated.jpg", await cameraPhoto("jpeg", { orientation: 6 }), "image/jpeg");
  put("card-art/u1/big.jpg", await jpegAcrossTheInlineCap(), "image/jpeg");
  put("card-art/u1/clean.jpg", await cleanPhoto("jpeg"), "image/jpeg");
  put("card-art/u1/provenance.jpg", withJpegSegments(await cleanPhoto("jpeg"), c2paSegment()), "image/jpeg");
  put("card-art/u1/ai-1.webp", await cameraPhoto("webp"), "image/webp");
  put("card-art/u1/wm-1.png", withPngChunks(await cleanPhoto("png"), pngChunk("tEXt", `Author\0${FAKE_OWNER}`)), "image/png", "max-age=31536000");
  put("profile-media/u2/avatar-1.png", withPngChunks(await cleanPhoto("png"), pngChunk("eXIf", await gpsTiff())), "image/png");
  put("set-covers/u2/cover.webp", await cameraPhoto("webp"), "image/webp");
  put("custom-pips/u2/G.png", await cleanPhoto("png"), "image/png");
  put("card-renders/u1/card.png", await cameraPhoto("png"), "image/png");
  for (const [key, obj] of store) originals.set(key, obj.bytes);
  server = fakeStorage(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  writeFileSync(path.join(tmp, "env"), `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\nSUPABASE_SECRET_KEY=test-key-not-secret\n`);
  writeFileSync(path.join(tmp, "prod-env"), "NEXT_PUBLIC_SUPABASE_URL=https://zkwkisxoqdhdchqyjwdc.supabase.co\nSUPABASE_SECRET_KEY=x\n");
}, 60_000);

afterAll(() => {
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const REWRITTEN = ["card-art/u1/gps.jpg", "card-art/u1/rotated.jpg", "card-art/u1/big.jpg", "card-art/u1/wm-1.png", "profile-media/u2/avatar-1.png", "set-covers/u2/cover.webp"];
const UNTOUCHED = ["card-art/u1/clean.jpg", "card-art/u1/provenance.jpg", "card-art/u1/ai-1.webp", "custom-pips/u2/G.png", "card-renders/u1/card.png"];

describe("scripts/strip-upload-metadata.mjs against a fake Storage API", () => {
  it("refuses production through the dev path, card-renders, and a production run without a terminal", async () => {
    const viaEnv = await run(["--env-file", path.join(tmp, "prod-env")]);
    expect(viaEnv.code).toBe(1);
    expect(viaEnv.out).toContain("points at PRODUCTION");
    const renders = await run(["--env-file", path.join(tmp, "env"), "--bucket", "card-renders"]);
    expect(renders.code).toBe(1);
    expect(renders.out).toContain("never card-renders");
    const prod = await run(["--target", "prod"], "sb_secret_typed_into_a_pipe\n");
    expect(prod.code).toBe(1);
    expect(prod.out).toContain("hidden prompt");
    expect(prod.out).not.toContain("sb_secret_typed_into_a_pipe");
  });

  it("dry run lists what each object carries — never a value — and writes nothing", async () => {
    const { code, out } = await run(["--env-file", path.join(tmp, "env"), "--state", path.join(tmp, "state.json")]);
    expect(code, out).toBe(0);
    for (const key of REWRITTEN) expect(out).toContain(key);
    for (const key of UNTOUCHED) expect(out).not.toContain(key);
    expect(out).toMatch(/card-art\/u1\/gps\.jpg\s+jpeg\s+\d+ KB\s+exif exif:author exif:camera exif:datetime exif:gps xmp xmp:gps\s+\[GPS\]/);
    expect(out).toContain("[GPS, keeps orientation 6]");
    expect(out).toContain("padded to stay above the bake's 3 MB inline cap");
    expect(out).toContain("1 AI outputs skipped");
    expect(out).toContain("(1 of them keep only their C2PA provenance)");
    for (const secret of [FAKE_CAMERA_MAKE, FAKE_OWNER, "0/1 12/1", "test-key-not-secret"]) expect(out).not.toContain(secret);
    expect([...store.values()].every((o) => o.puts === 0)).toBe(true);
  }, 60_000);

  it("--apply without typing yes writes nothing", async () => {
    const { code, out } = await run(["--env-file", path.join(tmp, "env"), "--state", path.join(tmp, "state.json"), "--apply"], "no\n");
    expect(code).toBe(1);
    expect(out).toContain("Aborted");
    expect([...store.values()].every((o) => o.puts === 0)).toBe(true);
  }, 60_000);

  it("--apply rewrites in place: no metadata, identical pixels, same Content-Type / Cache-Control / custom metadata", async () => {
    const { code, out } = await run(["--env-file", path.join(tmp, "env"), "--state", path.join(tmp, "state.json"), "--apply"], "yes\n");
    expect(code, out).toBe(0);
    expect(out).toContain(`Rewrote ${REWRITTEN.length}/${REWRITTEN.length}`);
    for (const key of REWRITTEN) {
      const obj = store.get(key)!;
      const before = originals.get(key)!;
      expect(obj.puts, key).toBe(1);
      expect(inspectImageMetadata(obj.bytes)?.found, key).toEqual([]);
      expect(await verifyStripped(before, obj.bytes), key).toEqual([]);
    }
    for (const key of UNTOUCHED) {
      expect(store.get(key)!.puts, key).toBe(0);
      expect(store.get(key)!.bytes.equals(originals.get(key)!)).toBe(true);
    }
    const gps = store.get("card-art/u1/gps.jpg")!;
    expect([gps.contentType, gps.cacheControl, gps.metadata]).toEqual(["image/jpeg", "max-age=3600", { note: "kept" }]);
    expect(store.get("card-art/u1/wm-1.png")!.cacheControl).toBe("max-age=31536000");
    expect((await sharp(store.get("card-art/u1/rotated.jpg")!.bytes).metadata()).orientation).toBe(6);
    expect(store.get("card-art/u1/big.jpg")!.bytes.length).toBeGreaterThan(MAX_INLINE_BYTES);
  }, 120_000);

  it("a re-run finds nothing left and downloads nothing it already handled", async () => {
    const { code, out } = await run(["--env-file", path.join(tmp, "env"), "--state", path.join(tmp, "state.json")]);
    expect(code, out).toBe(0);
    expect(out).toContain("Nothing to rewrite.");
    expect(out).toMatch(/0 carry metadata \(0 with GPS\)/);
    expect(out).toMatch(/\d+ unchanged since an earlier run/);
  }, 60_000);
});
