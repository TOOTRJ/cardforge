import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  PNG_PAD_CHUNK,
  detectContainer,
  inspectImageMetadata,
  isOrientationOnlyTiff,
  orientationOnlyTiff,
  padImageToAtLeast,
  stripImageMetadata,
  tiffOf,
} from "@/lib/media/strip-metadata";
import {
  FAKE_CAMERA_MAKE,
  animatedWebp,
  FAKE_OWNER,
  c2paSegment,
  cameraGif,
  cameraPhoto,
  cleanPhoto,
  commentSegment,
  ducky,
  expectNoCameraMetadata,
  gpsTiff,
  iptcSegment,
  jfifWithThumbnail,
  jfxxThumbnail,
  jpegSegment,
  mpfSegment,
  pngChunk,
  pngChunkTypes,
  riffChunk,
  trailingImage,
  webpChunks,
  withJpegSegments,
  withPngChunks,
  withSegmentsBeforeScan,
  withWebpChunks,
} from "@/tests/stubs/metadata-fixtures";

// ---------------------------------------------------------------------------
// TODO 3.14a — camera metadata (EXIF incl. GPS, XMP, IPTC, text chunks,
// comments, C2PA, trailers) comes out of a JPEG / PNG / WebP / GIF at the
// container level: the decoded pixels are byte-identical, the ICC profile
// and a needed orientation (2–8) stay, and nothing identifying is left for
// sharp — or a byte search — to find.
// ---------------------------------------------------------------------------

type Opts = { ignoreIcc?: boolean; autoOrient?: boolean };

async function pixels(bytes: Uint8Array, opts: Opts = {}): Promise<Buffer> {
  let img = sharp(bytes, { animated: true, ignoreIcc: opts.ignoreIcc ?? false });
  if (opts.autoOrient) img = img.autoOrient();
  return img.raw().toBuffer();
}

/** Decoded pixels identical — colour-managed, raw, and turned. */
async function expectSamePixels(before: Uint8Array, after: Uint8Array) {
  expect((await pixels(after)).equals(await pixels(before))).toBe(true);
  expect((await pixels(after, { ignoreIcc: true })).equals(await pixels(before, { ignoreIcc: true }))).toBe(true);
  expect((await pixels(after, { autoOrient: true })).equals(await pixels(before, { autoOrient: true }))).toBe(true);
}

function strip(bytes: Buffer) {
  const result = stripImageMetadata(bytes);
  expect(result, "the container parses").not.toBeNull();
  return result!;
}

describe("stripImageMetadata — JPEG", () => {
  it("a phone JPEG with GPS: EXIF (GPS, camera, dates, owner) and XMP gone, ICC and pixels kept", async () => {
    const original = await cameraPhoto("jpeg");
    // The fixture really carries what a phone writes.
    const before = await sharp(original).metadata();
    expect(before.exif && before.xmp && before.icc).toBeTruthy();

    const { bytes, report } = strip(original);
    expect(report).toEqual({
      format: "jpeg",
      found: ["exif", "exif:author", "exif:camera", "exif:datetime", "exif:gps", "xmp", "xmp:gps"],
      gps: true,
      orientation: null,
      icc: true,
      provenance: false,
    });
    expect(bytes.length).toBeLessThan(original.length);
    await expectNoCameraMetadata(bytes);
    const after = await sharp(bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.icc!.equals(before.icc!)).toBe(true);
    expect([after.width, after.height, after.format]).toEqual([before.width, before.height, "jpeg"]);
    await expectSamePixels(original, bytes);
  });

  it("a rotated phone JPEG (orientation 6) keeps ONLY its orientation, as a one-tag EXIF block", async () => {
    const original = await cameraPhoto("jpeg", { orientation: 6 });
    const { bytes, report } = strip(original);
    expect(report.orientation).toBe(6);
    expect(report.gps).toBe(true);
    const meta = await sharp(bytes).metadata();
    expect(meta.orientation).toBe(6);
    expect(Buffer.from(tiffOf(meta.exif!)).equals(Buffer.from(orientationOnlyTiff(6)))).toBe(true);
    await expectNoCameraMetadata(bytes);
    // Turned the same way by every reader that obeys the tag.
    await expectSamePixels(original, bytes);
  });

  it("a one-tag orientation block is already clean: the input comes back as-is", async () => {
    const { bytes: once } = strip(await cameraPhoto("jpeg", { orientation: 8 }));
    const again = stripImageMetadata(once)!;
    expect(again.bytes).toBe(once);
    expect(again.report.found).toEqual([]);
    expect(again.report.orientation).toBe(8);
  });

  it("an already-clean JPEG is returned as the same object (stored byte-for-byte)", async () => {
    const clean = await cleanPhoto("jpeg");
    const result = strip(clean);
    expect(result.bytes).toBe(clean);
    expect(result.report.found).toEqual([]);
  });

  it("drops thumbnails, IPTC, MPF + the trailing image, C2PA, comments and unknown APPn; keeps JFIF and the pixels", async () => {
    const original = Buffer.concat([
      withJpegSegments(
        await cameraPhoto("jpeg"),
        jfifWithThumbnail(),
        jfxxThumbnail(),
        iptcSegment(),
        mpfSegment(),
        c2paSegment(),
        commentSegment(),
        ducky(),
      ),
      await trailingImage(),
    ]);
    const { bytes, report } = strip(original);
    expect(report.found).toEqual(
      expect.arrayContaining(["thumbnail", "iptc", "mpf", "trailer", "c2pa", "comment", "jpeg:app12", "exif:gps", "xmp"]),
    );
    await expectNoCameraMetadata(bytes);
    // JFIF stays (it tells decoders the colour space) — minus its thumbnail.
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.includes("JFIF\0")).toBe(true);
    expect(text.includes("JFXX")).toBe(false);
    // Ends at the primary image's EOI.
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
    await expectSamePixels(original, bytes);
  });

  it("a progressive JPEG with metadata between its scans decodes identically", async () => {
    const progressive = await cameraPhoto("jpeg", { progressive: true });
    const original = withSegmentsBeforeScan(progressive, 2, commentSegment(), jpegSegment(0xe1, "http://ns.adobe.com/xap/1.0/\0<x:GPSLatitude/>"));
    const { bytes, report } = strip(original);
    expect(report.found).toEqual(expect.arrayContaining(["comment", "xmp", "xmp:gps", "exif:gps"]));
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(original, bytes);
  });

  it("keeps Adobe APP14 — a CMYK JPEG's colours depend on it", async () => {
    const original = await cameraPhoto("jpeg", { cmyk: true });
    expect((await sharp(original).metadata()).space).toBe("cmyk");
    const { bytes } = strip(original);
    expect(Buffer.from(bytes).toString("latin1").includes("Adobe")).toBe(true);
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(original, bytes);
  });

  it("C2PA Content Credentials that are the file's only metadata stay — byte-for-byte, so they still verify", async () => {
    const aiImage = withJpegSegments(await cleanPhoto("jpeg"), c2paSegment());
    const result = strip(aiImage);
    expect(result.bytes).toBe(aiImage);
    expect(result.report).toMatchObject({ found: [], provenance: true });
  });

  it("…but go with everything else (their hash covers those bytes), and always when they embed EXIF", async () => {
    const withExif = withJpegSegments(await cameraPhoto("jpeg"), c2paSegment());
    expect(strip(withExif).report).toMatchObject({ provenance: false });
    expect(strip(withExif).report.found).toContain("c2pa");
    expect(Buffer.from(strip(withExif).bytes).toString("latin1").includes("jumb")).toBe(false);

    const exifAssertion = jpegSegment(0xeb, 'JP\0\x01\0\0\0\x01\0\0\0\x10jumbc2pa.assertions stds.exif {"exif:GPSLatitude":"0,12N"}');
    const signedPhoto = withJpegSegments(await cleanPhoto("jpeg"), exifAssertion);
    const { bytes, report } = strip(signedPhoto);
    expect(report).toMatchObject({ found: ["c2pa", "c2pa:exif"], gps: true, provenance: false });
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(signedPhoto, bytes);
  });

  it("…and when a thumbnail inside them still carries binary EXIF (GPS a text search can't see)", async () => {
    const thumbnail = await sharp(await cleanPhoto("jpeg"))
      .resize(8, 8)
      .withExif({ IFD0: { Make: FAKE_CAMERA_MAKE }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "0/1 12/1 34/1" } })
      .jpeg()
      .toBuffer();
    expect(thumbnail.toString("latin1").includes("GPSLatitude")).toBe(false); // binary tags only
    const manifest = jpegSegment(
      0xeb,
      Buffer.concat([Buffer.from("JP\0\x01\0\0\0\x01\0\0\0\x10jumbc2pa.thumbnail.claim.jpeg", "latin1"), thumbnail]),
    );
    const signed = withJpegSegments(await cleanPhoto("jpeg"), manifest);
    const { bytes, report } = strip(signed);
    expect(report).toMatchObject({ found: ["c2pa", "c2pa:exif"], provenance: false });
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(signed, bytes);
  });

  it("only the FIRST EXIF block counts (sharp and Chrome ignore the rest): a later block's orientation is not promoted", async () => {
    const exif = async (orientation?: number) =>
      jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), await gpsTiff(orientation)]));
    const exifBlocks = (b: Uint8Array) => Buffer.from(b).toString("latin1").split("Exif\0\0").length - 1;

    // Orientation only in the second block: every reader shows the file
    // upright, so the stripped file must not say "turn me".
    const secondTurns = withJpegSegments(await cleanPhoto("jpeg"), await exif(), await exif(6));
    expect((await sharp(secondTurns).metadata()).orientation ?? 1).toBe(1);
    const a = strip(secondTurns);
    expect(a.report).toMatchObject({ orientation: null, gps: true });
    expect(exifBlocks(a.bytes)).toBe(0);
    expect((await sharp(a.bytes).metadata()).orientation ?? 1).toBe(1);
    await expectNoCameraMetadata(a.bytes);
    await expectSamePixels(secondTurns, a.bytes);

    // Orientation in the first block: it stays, as the ONE block left.
    const firstTurns = withJpegSegments(await cleanPhoto("jpeg"), await exif(6), jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from(orientationOnlyTiff(3))])));
    const b = strip(firstTurns);
    expect(b.report.orientation).toBe(6);
    expect(exifBlocks(b.bytes)).toBe(1);
    expect((await sharp(b.bytes).metadata()).orientation).toBe(6);
    await expectNoCameraMetadata(b.bytes);
    await expectSamePixels(firstTurns, b.bytes);
  });

  it("refuses a truncated JPEG (no EOI) rather than guessing", async () => {
    const whole = await cameraPhoto("jpeg");
    expect(stripImageMetadata(whole.subarray(0, whole.length - 200))).toBeNull();
  });
});

describe("stripImageMetadata — PNG", () => {
  it("drops eXIf (GPS), XMP, text, time, C2PA and unknown chunks; keeps iCCP, pHYs and the pixels", async () => {
    const base = await cameraPhoto("png", { alpha: true });
    const original = withPngChunks(
      base,
      pngChunk("pHYs", Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
      pngChunk("tEXt", `Author\0${FAKE_OWNER}`),
      pngChunk("zTXt", "Comment\0\0x\x9c\x03\0\0\0\0\x01"),
      pngChunk("iTXt", "Description\0\0\0\0\0GPSLongitude 0,56E"),
      pngChunk("tIME", Buffer.from([7, 234, 1, 2, 3, 4, 5])),
      pngChunk("caBX", "jumbc2pa"),
      pngChunk("vpAg", Buffer.alloc(9)),
      pngChunk("iDOT", Buffer.alloc(28)),
    );
    expect((await sharp(original).metadata()).exif).toBeTruthy();
    const { bytes, report } = strip(original);
    expect(report.found).toEqual(
      expect.arrayContaining(["exif", "exif:gps", "xmp", "xmp:gps", "png:text", "png:time", "c2pa", "png:chunk:vpAg", "png:chunk:iDOT"]),
    );
    expect(report.gps).toBe(true);
    const types = pngChunkTypes(Buffer.from(bytes));
    expect(types).toEqual(expect.arrayContaining(["IHDR", "iCCP", "pHYs", "IDAT", "IEND"]));
    for (const gone of ["eXIf", "iTXt", "tEXt", "zTXt", "tIME", "caBX", "vpAg", "iDOT"]) expect(types).not.toContain(gone);
    await expectNoCameraMetadata(bytes);
    const [before, after] = [await sharp(original).metadata(), await sharp(bytes).metadata()];
    expect(after.icc!.equals(before.icc!)).toBe(true);
    await expectSamePixels(original, bytes);
  });

  it("an eXIf with orientation 6 (before IDAT, where Chrome and sharp read it) becomes a one-tag eXIf", async () => {
    const original = withPngChunks(await cleanPhoto("png"), pngChunk("eXIf", await gpsTiff(6)));
    expect((await sharp(original).metadata()).orientation).toBe(6);
    const { bytes, report } = strip(original);
    expect(report).toMatchObject({ orientation: 6, gps: true });
    const types = pngChunkTypes(Buffer.from(bytes));
    expect(types.indexOf("eXIf")).toBeLessThan(types.indexOf("IDAT"));
    expect((await sharp(bytes).metadata()).orientation).toBe(6);
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(original, bytes);
  });

  it("drops bytes after IEND and refuses a PNG with no IEND", async () => {
    const clean = await cleanPhoto("png");
    const { bytes, report } = strip(Buffer.concat([clean, Buffer.from(`${FAKE_OWNER} trailer`)]));
    expect(report.found).toEqual(["trailer"]);
    expect(Buffer.from(bytes).equals(clean)).toBe(true);
    expect(stripImageMetadata(clean.subarray(0, clean.length - 12))).toBeNull();
  });
});

describe("stripImageMetadata — WebP", () => {
  it("drops EXIF (GPS) and XMP chunks and clears their VP8X flags; keeps ICCP and the pixels", async () => {
    const original = await cameraPhoto("webp");
    const chunksBefore = webpChunks(original);
    expect(chunksBefore.fourccs).toEqual(expect.arrayContaining(["VP8X", "ICCP", "EXIF", "XMP "]));
    const { bytes, report } = strip(original);
    expect(report.found).toEqual(["exif", "exif:author", "exif:camera", "exif:datetime", "exif:gps", "xmp", "xmp:gps"]);
    const after = webpChunks(Buffer.from(bytes));
    expect(after.fourccs).toEqual(chunksBefore.fourccs.filter((f) => f !== "EXIF" && f !== "XMP "));
    // ICC (0x20) stays flagged; EXIF (0x08) and XMP (0x04) do not.
    expect(after.flags! & 0x20).toBe(0x20);
    expect(after.flags! & 0x0c).toBe(0);
    // RIFF size is the file size minus 8.
    expect(Buffer.from(bytes).readUInt32LE(4)).toBe(bytes.length - 8);
    await expectNoCameraMetadata(bytes);
    expect((await sharp(bytes).metadata()).icc!.equals((await sharp(original).metadata()).icc!)).toBe(true);
    await expectSamePixels(original, bytes);
  });

  it("an orientation-6 WebP keeps a one-tag EXIF chunk and its flag", async () => {
    const original = await cameraPhoto("webp", { orientation: 6 });
    const { bytes, report } = strip(original);
    expect(report.orientation).toBe(6);
    const after = webpChunks(Buffer.from(bytes));
    expect(after.fourccs).toContain("EXIF");
    expect(after.flags! & 0x08).toBe(0x08);
    expect((await sharp(bytes).metadata()).orientation).toBe(6);
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(original, bytes);
  });

  it("an animated WebP keeps every frame; unknown and C2PA chunks go", async () => {
    const frames = await animatedWebp();
    expect((await sharp(frames, { animated: true }).metadata()).pages).toBe(3);
    const original = withWebpChunks(frames, riffChunk("C2PA", "manifest"), riffChunk("ZZZZ", `${FAKE_OWNER}`));
    const { bytes, report } = strip(original);
    expect(report.found).toEqual(["c2pa", "webp:chunk:ZZZZ"]);
    expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(3);
    expect(webpChunks(Buffer.from(bytes)).fourccs.filter((f) => f === "ANMF")).toHaveLength(3);
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(original, bytes);
  });
});

describe("stripImageMetadata — GIF", () => {
  it("drops the comment and XMP extensions, keeps the loop extension and the frames", async () => {
    const original = await cameraGif();
    const { bytes, report } = strip(original);
    expect(report).toMatchObject({ format: "gif", found: ["comment", "xmp", "xmp:gps"], gps: true });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.includes("NETSCAPE2.0")).toBe(true);
    expect(text.includes("XMP DataXMP")).toBe(false);
    await expectNoCameraMetadata(bytes);
    await expectSamePixels(original, bytes);
  });

  it("refuses a GIF with no trailer (the upload path re-encodes it instead)", async () => {
    expect(stripImageMetadata(await cameraGif({ trailer: false }))).toBeNull();
  });
});

describe("containers and labels", () => {
  it("detects the container from magic bytes; anything else is null", async () => {
    expect(detectContainer(await cleanPhoto("jpeg"))).toBe("jpeg");
    expect(detectContainer(await cleanPhoto("png"))).toBe("png");
    expect(detectContainer(await cleanPhoto("webp"))).toBe("webp");
    expect(detectContainer(await cameraGif())).toBe("gif");
    expect(stripImageMetadata(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(stripImageMetadata(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("a report names kinds of metadata, never their values", async () => {
    const report = inspectImageMetadata(await cameraPhoto("jpeg"))!;
    const json = JSON.stringify(report);
    for (const value of [FAKE_CAMERA_MAKE, FAKE_OWNER, "0/1", "12", "56", "2026"]) expect(json.includes(value), value).toBe(false);
  });

  it("the one-tag orientation block is 26 bytes of TIFF in either byte order", () => {
    for (const le of [false, true]) {
      const t = orientationOnlyTiff(3, le);
      expect(t.length).toBe(26);
      expect(isOrientationOnlyTiff(t)).toBe(true);
    }
  });
});

describe("padImageToAtLeast (backfill only)", () => {
  it("grows a stripped JPEG/PNG with zero-filled padding that decodes identically and strips to itself", async () => {
    for (const format of ["jpeg", "png"] as const) {
      const { bytes: stripped } = strip(await cameraPhoto(format));
      const target = stripped.length + 70_000; // more than one COM segment's worth
      const padded = padImageToAtLeast(stripped, target)!;
      expect(padded.length).toBeGreaterThanOrEqual(target);
      expect(padded.length - target).toBeLessThan(8);
      await expectSamePixels(stripped, padded);
      const again = stripImageMetadata(padded)!;
      expect(again.report.found).toEqual([]);
      expect(again.bytes).toBe(padded);
      if (format === "png") expect(pngChunkTypes(Buffer.from(padded))).toContain(PNG_PAD_CHUNK);
      expect(padImageToAtLeast(stripped, stripped.length)).toBe(stripped);
    }
  });

  it("refuses an unstripped file and non-JPEG/PNG containers", async () => {
    expect(padImageToAtLeast(await cameraPhoto("jpeg"), 1_000_000)).toBeNull();
    expect(padImageToAtLeast(await cameraPhoto("png"), 1_000_000)).toBeNull();
    expect(padImageToAtLeast(await cleanPhoto("webp"), 1_000_000)).toBeNull();
  });
});
