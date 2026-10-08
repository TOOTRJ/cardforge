import { describe, expect, it } from "vitest";
import {
  baselineDrift,
  compareToBaseline,
  countByTemplate,
  environmentDrift,
  formatReport,
  gateVerdict,
  mergeShardResults,
  parseEntry,
  parseLayoutVersion,
  parseShard,
  regenerateCommands,
  serializeBaseline,
} from "@/scripts/lib/visual-gate.mjs";

// ---------------------------------------------------------------------------
// scripts/lib/visual-gate.mjs — the visual-regression gate (TODO 7.1). The
// bake hashes every matrix case; these rules decide what CI does with a
// changed hash: fail without a CARD_LAYOUT_VERSION bump, fail a bump whose
// scope misses a changed card, and fail until the regenerated baseline is
// committed — while new cases never need a bump.
// ---------------------------------------------------------------------------

const ENV = {
  platform: "linux-x64",
  node: "v24.0.0",
  satori: "0.25.0",
  sharp: "0.34.5",
  libvips: "8.17.3",
  rsvg: "2.61.2",
  cairo: "1.18.4",
  pixman: "0.46.4",
  fonts: { "public/fonts/Beleren-Bold.ttf": "00d9238fe4816e91" },
  manifest: "5b3383c720b4a41e",
};

type Case = { hash: string | null; ms: number; stale?: boolean; error?: string; input?: string; printOnly?: boolean };

function run(cases: Record<string, Case>, extra: Record<string, unknown> = {}) {
  return { layoutVersion: 34, baseVersion: 34, environment: ENV, seconds: 12, blocked: [] as string[], cases, ...extra };
}

function baseline(cases: Record<string, string>, layoutVersion = 34) {
  return { layoutVersion, generatedOn: { platform: ENV.platform, satori: ENV.satori }, inputs: { fonts: ENV.fonts, manifest: ENV.manifest }, cases };
}

const H1 = "1111111111111111";
const H2 = "2222222222222222";
const H3 = "3333333333333333";

function verdictFor(opts: {
  cases: Record<string, Case>;
  base: Record<string, string> | null;
  headVersion?: number;
  baseVersion?: number | null;
  baselineVersion?: number;
  baseBaseline?: Record<string, string> | null;
  blocked?: string[];
}) {
  const r = run(opts.cases, { blocked: opts.blocked ?? [] });
  const headBaseline = opts.base ? baseline(opts.base, opts.baselineVersion ?? 34) : null;
  const comparison = compareToBaseline(r, headBaseline);
  return gateVerdict({
    comparison,
    run: r,
    headBaseline,
    headVersion: opts.headVersion ?? 34,
    baseVersion: opts.baseVersion === undefined ? 34 : opts.baseVersion,
    baseBaseline: opts.baseBaseline === undefined ? null : opts.baseBaseline ? baseline(opts.baseBaseline) : null,
  });
}

const codes = (v: { problems: { code: string }[] }) => v.problems.map((p) => p.code);

describe("parsing", () => {
  it("reads CARD_LAYOUT_VERSION from layout-version.ts source", () => {
    expect(parseLayoutVersion("// x\nexport const CARD_LAYOUT_VERSION = 34;\n")).toBe(34);
    expect(parseLayoutVersion("export const CARD_LAYOUT_VERSION = 135 ;")).toBe(135);
    expect(parseLayoutVersion("export const ROUND_BAKE_LAYOUT_VERSION = 31;")).toBeNull();
    // The latest bump's number may live in ONE constant of its own (TODO
    // 4.10a): the gate reads through it.
    expect(parseLayoutVersion("export const RETRO_1997_LAYOUT_VERSION = 46;\nexport const CARD_LAYOUT_VERSION = RETRO_1997_LAYOUT_VERSION;\n")).toBe(46);
    expect(parseLayoutVersion("export const CARD_LAYOUT_VERSION = MISSING_VERSION;")).toBeNull();
    expect(parseLayoutVersion("export const OTHER = 9;\nexport const CARD_LAYOUT_VERSION = OTHER + 1;")).toBeNull();
  });

  it("parses i/n shards and refuses nonsense", () => {
    expect(parseShard("2/4")).toEqual({ index: 2, count: 4 });
    expect(() => parseShard("4/4")).toThrow();
    expect(() => parseShard("1/0")).toThrow();
    expect(() => parseShard("x")).toThrow();
  });
});

describe("mergeShardResults", () => {
  it("joins the shards' cases and blocked fetches", () => {
    const merged = mergeShardResults([
      run({ a: { hash: H1, ms: 1 } }, { seconds: 5, blocked: ["x"] }),
      run({ b: { hash: H2, ms: 1 } }, { seconds: 9 }),
    ]);
    expect(Object.keys(merged.cases)).toEqual(["a", "b"]);
    expect(merged.seconds).toBe(9);
    expect(merged.blocked).toEqual(["x"]);
  });

  it("refuses shards baked with different code, tools or overlapping cases", () => {
    expect(() => mergeShardResults([run({ a: { hash: H1, ms: 1 } }), run({ a: { hash: H1, ms: 1 } })])).toThrow(/two shards/);
    expect(() => mergeShardResults([run({}), run({}, { layoutVersion: 35 })])).toThrow(/layout versions/);
    expect(() => mergeShardResults([run({}), run({}, { environment: { ...ENV, sharp: "0.35.0" } })])).toThrow(/environment/);
    expect(() => mergeShardResults([run({}), run({}, { baseVersion: 33 })])).toThrow(/base versions/);
    // Node's patch version alone is not a different tool.
    expect(() => mergeShardResults([run({ a: { hash: H1, ms: 1 } }), run({ b: { hash: H1, ms: 1 } }, { environment: { ...ENV, node: "v24.9.9" } })])).not.toThrow();
  });
});

describe("gateVerdict", () => {
  it("passes when every hash matches and the baseline is current", () => {
    const v = verdictFor({ cases: { a: { hash: H1, ms: 1 }, b: { hash: H2, ms: 1 } }, base: { a: H1, b: H2 } });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it("fails a changed hash without a CARD_LAYOUT_VERSION bump", () => {
    const v = verdictFor({ cases: { a: { hash: H3, ms: 1, stale: false }, b: { hash: H2, ms: 1 } }, base: { a: H1, b: H2 } });
    expect(v.ok).toBe(false);
    expect(codes(v)).toEqual(["unbumped-change"]);
    expect(v.problems[0].ids).toEqual(["a"]);
  });

  it("with a bump, still fails — listing the diff — until the regenerated baseline is committed", () => {
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1, stale: true }, b: { hash: H2, ms: 1, stale: false } },
      base: { a: H1, b: H2 },
      headVersion: 35,
      baseVersion: 34,
    });
    expect(v.bumped).toBe(true);
    expect(codes(v)).toEqual(["regenerate"]);
    expect(v.problems[0].ids).toEqual(["a"]);
  });

  it("with a bump, fails a changed case outside the bump's scope (its stored image would never re-bake)", () => {
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1, stale: true }, b: { hash: H1, ms: 1, stale: false } },
      base: { a: H1, b: H2 },
      headVersion: 35,
      baseVersion: 34,
    });
    expect(codes(v)).toEqual(["outside-bump-scope", "regenerate"]);
    expect(v.problems[0].ids).toEqual(["b"]);
  });

  it("after the baseline is regenerated, still fails a moved case outside the bump's scope", () => {
    // The committed baseline already carries the new hashes (no change
    // against it); the move shows against the base branch's baseline.
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1, stale: true }, b: { hash: H3, ms: 1, stale: false }, c: { hash: H1, ms: 1, stale: true } },
      base: { a: H3, b: H3, c: H1 },
      baselineVersion: 35,
      headVersion: 35,
      baseVersion: 34,
      baseBaseline: { a: H1, b: H1, c: H1 },
    });
    expect(codes(v)).toEqual(["outside-bump-scope"]);
    expect(v.problems[0].ids).toEqual(["b"]);
    // c is in scope but unchanged: it would re-bake to the same pixels.
    expect(v.widerScope).toEqual(["c"]);
  });

  it("refuses scope flags judged at another version than the gate's base", () => {
    const r = run({ a: { hash: H3, ms: 1, stale: true } }, { baseVersion: 33 });
    const b = baseline({ a: H1 });
    const v = gateVerdict({ comparison: compareToBaseline(r, b), run: r, headBaseline: b, headVersion: 35, baseVersion: 34 });
    expect(codes(v)).toContain("scope-reference");
  });

  it("passes the bump PR once its regenerated baseline is committed", () => {
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1 }, b: { hash: H2, ms: 1 } },
      base: { a: H3, b: H2 },
      baselineVersion: 35,
      headVersion: 35,
      baseVersion: 34,
      baseBaseline: { a: H1, b: H2 },
    });
    expect(v.ok).toBe(true);
  });

  it("fails a regenerated baseline that changes hashes against the base branch without a bump", () => {
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1 }, b: { hash: H2, ms: 1 } },
      base: { a: H3, b: H2 },
      baseBaseline: { a: H1, b: H2 },
    });
    expect(codes(v)).toEqual(["unbumped-regeneration"]);
    expect(v.problems[0].ids).toEqual(["a"]);
  });

  it("judges 'bumped' against the base branch, never against a stale baseline", () => {
    // main bumped to 35 without restamping the baseline (made at 34): a later
    // PR that changes pixels has NOT bumped anything.
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1, stale: true } },
      base: { a: H1 },
      baselineVersion: 34,
      headVersion: 35,
      baseVersion: 35,
    });
    expect(v.bumped).toBe(false);
    expect(codes(v)).toContain("unbumped-change");
  });

  it("with no base commit, judges the bump against the baseline's layout version", () => {
    const v = verdictFor({ cases: { a: { hash: H3, ms: 1, stale: true } }, base: { a: H1 }, headVersion: 35, baseVersion: null });
    expect(v.bumped).toBe(true);
    expect(codes(v)).toEqual(["regenerate"]);
  });

  it("asks for a regenerated baseline — never a bump — for new or removed cases", () => {
    const v = verdictFor({ cases: { a: { hash: H1, ms: 1 }, c: { hash: H3, ms: 1 } }, base: { a: H1, b: H2 } });
    expect(codes(v)).toEqual(["cases-changed"]);
    expect(v.problems[0].ids).toEqual(["+ c", "- b"]);
  });

  it("flags a bump that no case draws (restamp, or add a case)", () => {
    const v = verdictFor({ cases: { a: { hash: H1, ms: 1 } }, base: { a: H1 }, headVersion: 35, baseVersion: 34 });
    expect(codes(v)).toEqual(["baseline-version"]);
  });

  it("always fails a render error or a fetch the hermetic bake refused", () => {
    expect(codes(verdictFor({ cases: { a: { hash: null, ms: 1, error: "FrameAssetUnavailableError: x" } }, base: { a: H1 } }))).toEqual([
      "render-errors",
    ]);
    expect(codes(verdictFor({ cases: { a: { hash: H1, ms: 1 } }, base: { a: H1 }, blocked: ["https://example.com/x.png"] }))).toEqual([
      "not-hermetic",
    ]);
  });

  it("fails when there is no baseline at all", () => {
    expect(codes(verdictFor({ cases: { a: { hash: H1, ms: 1 } }, base: null }))).toEqual(["no-baseline"]);
  });

  it("asks for a regenerated baseline — never a bump — for a case the matrix redefined", () => {
    // Same id, new input fingerprint (tests/visual/matrix.ts changed what it
    // draws): not a renderer change.
    const v = verdictFor({ cases: { a: { hash: H3, ms: 1, input: "bbbbbbbb", stale: false } }, base: { a: `${H1}:aaaaaaaa` } });
    expect(codes(v)).toEqual(["cases-changed"]);
    expect(v.problems[0].ids).toEqual(["~ a"]);
    // The same input drawing different pixels IS a renderer change.
    const same = verdictFor({ cases: { a: { hash: H3, ms: 1, input: "aaaaaaaa", stale: false } }, base: { a: `${H1}:aaaaaaaa` } });
    expect(codes(same)).toEqual(["unbumped-change"]);
  });

  it("passes a regenerated baseline whose only moves are redefined cases, without a bump", () => {
    const v = verdictFor({
      cases: { a: { hash: H3, ms: 1, input: "bbbbbbbb" }, b: { hash: H2, ms: 1, input: "cccccccc" } },
      base: { a: `${H3}:bbbbbbbb`, b: `${H2}:cccccccc` },
      baseBaseline: { a: `${H1}:aaaaaaaa`, b: `${H2}:cccccccc` },
    });
    expect(v.ok).toBe(true);
    // …while the same input with new pixels is drift.
    const drift = verdictFor({
      cases: { a: { hash: H3, ms: 1, input: "aaaaaaaa" } },
      base: { a: `${H3}:aaaaaaaa` },
      baseBaseline: { a: `${H1}:aaaaaaaa` },
    });
    expect(codes(drift)).toEqual(["unbumped-regeneration"]);
  });

  it("a print-only (square-corner) change needs the regenerated baseline, never a bump", () => {
    // Square corners are the PDF / Square download — rendered live, never
    // stored: bumping for them would sweep every card for nothing.
    const v = verdictFor({ cases: { "m15/w/a@square": { hash: H3, ms: 1, printOnly: true, stale: false }, "m15/w/a": { hash: H1, ms: 1 } }, base: { "m15/w/a@square": H1, "m15/w/a": H1 } });
    expect(codes(v)).toEqual(["print-changed"]);
    expect(v.problems[0].ids).toEqual(["m15/w/a@square"]);
    // Committed, it passes without a bump…
    const after = verdictFor({
      cases: { "m15/w/a@square": { hash: H3, ms: 1, printOnly: true }, "m15/w/a": { hash: H1, ms: 1 } },
      base: { "m15/w/a@square": H3, "m15/w/a": H1 },
      baseBaseline: { "m15/w/a@square": H1, "m15/w/a": H1 },
    });
    expect(after.ok).toBe(true);
    // …and with a bump it is never "outside the bump's scope".
    const bumped = verdictFor({
      cases: { "m15/w/a@square": { hash: H3, ms: 1, printOnly: true, stale: false }, "m15/w/a": { hash: H3, ms: 1, stale: true } },
      base: { "m15/w/a@square": H3, "m15/w/a": H3 },
      baselineVersion: 35,
      headVersion: 35,
      baseVersion: 34,
      baseBaseline: { "m15/w/a@square": H1, "m15/w/a": H1 },
    });
    expect(bumped.ok).toBe(true);
  });

  it("a stored case that changes next to a print-only one still needs the bump", () => {
    const v = verdictFor({
      cases: { "m15/w/a@square": { hash: H3, ms: 1, printOnly: true, stale: false }, "m15/w/a": { hash: H3, ms: 1, stale: false } },
      base: { "m15/w/a@square": H1, "m15/w/a": H1 },
    });
    expect(codes(v)).toEqual(["unbumped-change", "print-changed"]);
    expect(v.problems[0].ids).toEqual(["m15/w/a"]);
  });

  it("a --only run compares just the cases it baked", () => {
    const r = run({ a: { hash: H1, ms: 1 } });
    const b = baseline({ a: H1, b: H2 });
    const comparison = compareToBaseline(r, b, { partial: true });
    expect(comparison.removed).toEqual([]);
    expect(gateVerdict({ comparison, run: r, headBaseline: b, headVersion: 34, baseVersion: 34, partial: true }).ok).toBe(true);
  });
});

describe("baseline file", () => {
  it("stores hashes only, keys sorted, stamped with the layout version and the tools", () => {
    const text = serializeBaseline(run({ "m15/w/b": { hash: H2, ms: 1 }, "m15/w/a": { hash: H1, ms: 1 } }), 34);
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed.cases)).toEqual(["m15/w/a", "m15/w/b"]);
    expect(parsed.cases["m15/w/a"]).toBe(H1);
    expect(parsed.layoutVersion).toBe(34);
    expect(parsed.generatedOn.platform).toBe("linux-x64");
    expect(parsed.inputs.fonts).toEqual(ENV.fonts);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("records each case as <pixel hash>:<input fingerprint>", () => {
    const parsed = JSON.parse(serializeBaseline(run({ a: { hash: H1, ms: 1, input: "0badcafe" } }), 34));
    expect(parsed.cases.a).toBe(`${H1}:0badcafe`);
    expect(parseEntry(parsed.cases.a)).toEqual({ pixel: H1, input: "0badcafe" });
    expect(parseEntry(H1)).toEqual({ pixel: H1, input: null });
  });

  it("refuses to record a case that failed to bake", () => {
    expect(() => serializeBaseline(run({ a: { hash: null, ms: 1, error: "boom" } }), 34)).toThrow(/failed to bake/);
  });

  it("names the drift between two baselines by id, ignoring new and removed cases", () => {
    expect(baselineDrift(baseline({ a: H1, b: H3, c: H1 }), baseline({ a: H1, b: H2, d: H2 }))).toEqual(["b"]);
    expect(baselineDrift(null, baseline({ a: H1 }))).toEqual([]);
    // A redefined case (new input) is not drift; the same input with new pixels is.
    expect(baselineDrift(baseline({ a: `${H3}:bbbbbbbb`, b: `${H3}:cccccccc` }), baseline({ a: `${H1}:aaaaaaaa`, b: `${H1}:cccccccc` }))).toEqual(["b"]);
  });

  it("names the tools or inputs that changed since the baseline", () => {
    const r = run({}, { environment: { ...ENV, libvips: "8.18.0", fonts: { "public/fonts/Beleren-Bold.ttf": "ffffffffffffffff" } } });
    // The fixture baseline records the fonts but no libvips: only what it knows can drift.
    expect(environmentDrift(r, baseline({}))).toEqual(["font public/fonts/Beleren-Bold.ttf: 00d9238fe4816e91 → ffffffffffffffff"]);
    const full = { ...baseline({}), generatedOn: { ...ENV }, inputs: { fonts: ENV.fonts, manifest: ENV.manifest } };
    expect(environmentDrift(r, full)).toEqual(["libvips: 8.17.3 → 8.18.0", "font public/fonts/Beleren-Bold.ttf: 00d9238fe4816e91 → ffffffffffffffff"]);
  });
});

describe("report", () => {
  it("prints the diff list with scope marks, the counts by template and the regenerate commands", () => {
    const r = run({ "m15/r/a": { hash: H3, ms: 1, stale: true }, "saga/r/a": { hash: H3, ms: 1, stale: false } });
    const b = baseline({ "m15/r/a": H1, "saga/r/a": H1 });
    const comparison = compareToBaseline(r, b);
    const verdict = gateVerdict({ comparison, run: r, headBaseline: b, headVersion: 35, baseVersion: 34 });
    const text = formatReport({
      verdict,
      comparison,
      run: r,
      headBaseline: b,
      headVersion: 35,
      env: { GITHUB_RUN_ID: "42", GITHUB_REPOSITORY: "TOOTRJ/cardforge" },
    });
    expect(text).toContain(`m15/r/a  ${H1} → ${H3}  (in the bump's scope)`);
    expect(text).toContain(`saga/r/a  ${H1} → ${H3}  (NOT in the bump's scope)`);
    expect(text).toContain("npm run test:visual -- --update");
    expect(text).toContain("gh run download 42 -R TOOTRJ/cardforge -n visual-baseline -D tests/visual");
  });

  it("marks the scope only when the PR bumped", () => {
    const r = run({ "m15/r/a": { hash: H3, ms: 1, stale: false } });
    const b = baseline({ "m15/r/a": H1 });
    const comparison = compareToBaseline(r, b);
    const verdict = gateVerdict({ comparison, run: r, headBaseline: b, headVersion: 34, baseVersion: 34 });
    const text = formatReport({ verdict, comparison, run: r, headBaseline: b, headVersion: 34, env: {} });
    expect(text).toContain(`m15/r/a  ${H1} → ${H3}\n`);
    expect(text).not.toContain("scope)");
  });

  it("marks a print-only case as such, never with a scope", () => {
    const r = run({ "m15/w/a@square": { hash: H3, ms: 1, stale: false, printOnly: true } });
    const b = baseline({ "m15/w/a@square": H1 });
    const comparison = compareToBaseline(r, b);
    const verdict = gateVerdict({ comparison, run: r, headBaseline: b, headVersion: 34, baseVersion: 34 });
    const text = formatReport({ verdict, comparison, run: r, headBaseline: b, headVersion: 34, env: {} });
    expect(text).toContain(`m15/w/a@square  ${H1} → ${H3}  (print only — never stored)`);
    expect(text).toContain("npm run test:visual -- --update");
  });

  it("counts ids by template, most first", () => {
    expect(countByTemplate(["m15/r/a", "saga/r/a", "m15/u/b"])).toEqual([
      ["m15", 2],
      ["saga", 1],
    ]);
  });

  it("offers the CI artifact only inside a CI run", () => {
    expect(regenerateCommands({})).toHaveLength(1);
  });
});
