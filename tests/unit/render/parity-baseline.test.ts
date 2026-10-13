import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { baselineArtifactCommand, baselinePasteScript, readNextBaseline } from "@/scripts/lib/parity-next.mjs";
import {
  BASELINE_DIR,
  LEGACY_BASELINE_FILE,
  applyDelta,
  caseFileName,
  caseFiles,
  loadBaseline,
  parseCaseFile,
  planUpdate,
  platformDelta,
  readBaseline,
  recordedFor,
  serializeCaseFile,
} from "@/tests/parity/baseline";
import { BASELINE_MARGIN, LIMITS, baselineKey, judge, toBaselineCase, type BaselineCase, type Measured } from "@/tests/parity/thresholds";

// ---------------------------------------------------------------------------
// The parity baseline as files (TODO 7.13, tests/parity/baseline.ts): one
// file per case per platform, read only in the text an update writes, and an
// update that rewrites nothing but the cases that are new or moved. No
// browser, no bake: synthetic measurements and temp directories.
// ---------------------------------------------------------------------------

function measured(id: string, size: "750" | "hd", regions: Record<string, [number, number, number, number]>, mads = [3, 10]): Measured {
  return {
    id,
    size,
    regions: Object.fromEntries(
      Object.entries(regions).map(([name, [dx, dy, mad, hot]]) => [name, { dx, dy, shift: Math.max(Math.abs(dx), Math.abs(dy)), mad, hot }]),
    ),
    card: { dx: 0, dy: 0, shift: 0, mad: 2, hot: 0.01 },
    tile: { mad: 10, x: 0, y: 0 },
    tiles: { tile: 25, cols: 2, rows: 1, mads },
  };
}

/** A run of three cases at both sizes. */
function runOf(overrides: Record<string, Record<string, [number, number, number, number]>> = {}): Measured[] {
  return ["m15/g/a", "m15/g/b@foil", "saga/g/c"].flatMap((id) =>
    (["750", "hd"] as const).map((size) => measured(id, size, overrides[`${id}@${size}`] ?? { title: [0, -1, 8, 0.05], rules: [1, 0, 6.5, 0.031] })),
  );
}

const recordedOf = (run: Measured[]) => Object.fromEntries(run.map((m) => [baselineKey(m), toBaselineCase(m)]));

const tmpDirs: string[] = [];
function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-baseline-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Every file under the baseline directory of `root`: path → text. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = path.join(root, BASELINE_DIR);
  for (const platform of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    for (const name of fs.readdirSync(path.join(dir, platform))) out[`${platform}/${name}`] = fs.readFileSync(path.join(dir, platform, name), "utf8");
  }
  return out;
}

function record(root: string, platform: string, run: Measured[], stored: Record<string, BaselineCase> | null = null, all = false) {
  const plan = planUpdate({ stored, run, all });
  const files = caseFiles(plan.cases);
  applyDelta(root, platform, platformDelta(root, platform, files));
  return plan;
}

describe("a case file", () => {
  const file = { id: "m15/g/b@foil", sizes: { "750": toBaselineCase(runOf()[2]), hd: toBaselineCase(runOf()[3]) } };
  const text = serializeCaseFile(file);

  it("is the case's id and one line per size — no date, no note", () => {
    expect(text.split("\n")).toHaveLength(6);
    expect(text.split("\n")[1]).toBe(' "id": "m15/g/b@foil",');
    expect(text.split("\n")[2].startsWith(' "750": {"regions":{')).toBe(true);
    expect(text.split("\n")[3].startsWith(' "hd": {"regions":{')).toBe(true);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["750", "hd", "id"]);
    expect(text).not.toMatch(/recorded|note/);
    expect(caseFileName(file.id)).toBe("m15__g__b__foil.json");
  });

  it("round-trips byte for byte", () => {
    expect(parseCaseFile("m15__g__b__foil.json", text)).toEqual(file);
    expect(serializeCaseFile(parseCaseFile("m15__g__b__foil.json", text))).toBe(text);
  });

  it("is refused under another case's name, with a size missing, with a stray field, or hand-formatted", () => {
    expect(() => parseCaseFile("m15__g__a.json", text)).toThrow(/holds case "m15\/g\/b@foil", whose file is m15__g__b__foil\.json/);
    const lines = text.split("\n");
    const noHd = [...lines.slice(0, 2), lines[2].replace(/,$/, ""), ...lines.slice(4)].join("\n");
    expect(() => parseCaseFile("m15__g__b__foil.json", noHd)).toThrow(/no \(or a malformed\) line for "hd"/);
    // #514's date field, should a merge bring it back: named, not read past.
    const dated = text.replace(' "750":', ' "recorded": "2026-10-13",\n "750":');
    expect(() => parseCaseFile("m15__g__b__foil.json", dated)).toThrow(/unknown field "recorded"/);
    expect(() => parseCaseFile("m15__g__b__foil.json", JSON.stringify(JSON.parse(text), null, 2))).toThrow(/not the text an update writes/);
    expect(() => parseCaseFile("m15__g__b__foil.json", "<<<<<<< HEAD\n" + text)).toThrow(/not JSON/);
  });

  it("a size line twice — what a union merge of two re-records leaves — is refused, not read as the last one", () => {
    const lines = text.split("\n");
    const doubled = [...lines.slice(0, 3), lines[2].replace("[0,-1,8,0.05]", "[0,-2,8,0.05]"), ...lines.slice(3)].join("\n");
    expect(JSON.parse(doubled)["750"].regions.title).toEqual([0, -2, 8, 0.05]); // JSON itself says nothing
    expect(() => parseCaseFile("m15__g__b__foil.json", doubled)).toThrow(/duplicate line for "750"/);
  });
});

describe("the loader", () => {
  const run = runOf();

  it("reads the directory into platform → `<id>@<size>` → case, as the single file's readers had it — without a date", () => {
    const root = tmpRoot();
    record(root, "linux", run);
    record(root, "darwin", run);
    const baseline = loadBaseline(root);
    expect(Object.keys(baseline.platforms).sort()).toEqual(["darwin", "linux"]);
    // An older reader's two reads (tests/parity/run.ts and the matrix test
    // before 7.13): a platform's `cases` by key. Nothing else was ever read
    // but the date, and nothing needs it.
    expect(baseline.platforms.linux.cases["m15/g/b@foil@hd"]).toEqual(toBaselineCase(run[3]));
    expect(Object.keys(baseline.platforms.linux.cases).sort()).toEqual(run.map(baselineKey).sort());
    expect(Object.keys(baseline.platforms.linux)).toEqual(["cases"]);
    expect("recorded" in baseline.platforms.linux).toBe(false);
    expect(baseline.platforms.win32?.cases ?? null).toBeNull();
  });

  it("fails on a duplicate case id", () => {
    const text = serializeCaseFile({ id: "m15/g/a", sizes: { "750": toBaselineCase(run[0]), hd: toBaselineCase(run[1]) } });
    // Two entries for one case on one platform (a case-insensitive checkout,
    // a renamed file kept by a merge…).
    expect(() =>
      readBaseline([
        { platform: "linux", name: "m15__g__a.json", text },
        { platform: "linux", name: "m15__g__a.json", text },
      ]),
    ).toThrow(/duplicate case id "m15\/g\/a"/);
    // The same id on two platforms is not a duplicate.
    expect(
      Object.keys(
        readBaseline([
          { platform: "linux", name: "m15__g__a.json", text },
          { platform: "darwin", name: "m15__g__a.json", text },
        ]).platforms,
      ),
    ).toEqual(["darwin", "linux"]);
  });

  it("names every unreadable file in one error", () => {
    const root = tmpRoot();
    record(root, "linux", run);
    const dir = path.join(root, BASELINE_DIR, "linux");
    fs.writeFileSync(path.join(dir, "m15__g__a.json"), "{}\n");
    fs.copyFileSync(path.join(dir, "saga__g__c.json"), path.join(dir, "saga__g__d.json"));
    let message = "";
    try {
      loadBaseline(root);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/linux\/m15__g__a\.json: no "id"/);
    expect(message).toMatch(/linux\/saga__g__d\.json: holds case "saga\/g\/c"/);
  });

  it("refuses a conflict's leftovers and #514's single file", () => {
    const root = tmpRoot();
    record(root, "linux", run);
    fs.writeFileSync(path.join(root, BASELINE_DIR, "linux", "m15__g__a.json.orig"), "x");
    expect(() => loadBaseline(root)).toThrow(/not case files: .*m15__g__a\.json\.orig/);
    fs.rmSync(path.join(root, BASELINE_DIR, "linux", "m15__g__a.json.orig"));
    expect(() => loadBaseline(root)).not.toThrow();
    fs.writeFileSync(path.join(root, LEGACY_BASELINE_FILE), "{}");
    expect(() => loadBaseline(root)).toThrow(/baseline\.json is back/);
  });
});

// What a judging run is given (tests/parity/run.ts → preview.parity.spec.ts:
// `judge(measured, recorded ? recorded[key] : null)`), per kind of damage to
// the directory: none of them may read as "nothing to compare, pass".
describe("a run against a damaged baseline", () => {
  const run = runOf();

  it("a case with no file on a recorded platform fails that case — both sizes", () => {
    const root = tmpRoot();
    record(root, "linux", run);
    fs.rmSync(path.join(root, BASELINE_DIR, "linux", "m15__g__a.json"));
    const recorded = recordedFor(loadBaseline(root), "linux", { recording: false })!;
    const failing = run.filter((m) => judge(m, recorded[baselineKey(m)]).length);
    expect(failing.map(baselineKey).sort()).toEqual(["m15/g/a@750", "m15/g/a@hd"]);
    expect(judge(run[0], recorded[baselineKey(run[0])])[0]).toMatch(/not in tests\/parity\/baseline\/ for this platform/);
  });

  it("CI's platform with no case file at all — the directory gone, or empty — is an error, never a limits-only run", () => {
    const root = tmpRoot();
    record(root, "darwin", run);
    expect(() => recordedFor(loadBaseline(root), "linux", { recording: false })).toThrow(/baseline\/linux\/ holds no case file/);
    fs.mkdirSync(path.join(root, BASELINE_DIR, "linux"));
    expect(() => recordedFor(loadBaseline(root), "linux", { recording: false })).toThrow(/baseline\/linux\/ holds no case file/);
    // No baseline directory at all.
    expect(() => recordedFor(loadBaseline(tmpRoot()), "linux", { recording: false })).toThrow(/holds no case file/);
    // Recording it again (a measuring run, an update) is how it comes back.
    expect(recordedFor(loadBaseline(root), "linux", { recording: true })).toBeNull();
    // Another OS with nothing recorded is still held to the limits only.
    expect(recordedFor(loadBaseline(root), "win32", { recording: false })).toBeNull();
    expect(Object.keys(recordedFor(loadBaseline(root), "darwin", { recording: false })!)).toHaveLength(run.length);
  });
});

describe("an update", () => {
  it("keeps every case that is inside its tolerance byte for byte, and rewrites the one that moved", () => {
    const root = tmpRoot();
    const first = runOf();
    record(root, "darwin", first);
    const before = tree(root);

    // The next run: every number wobbles inside its tolerance (another px
    // of offset, a little more difference) — and ONE region of one case
    // moves 2 px.
    const wobble: [number, number, number, number] = [1, -1, 8.9, 0.06];
    const second = runOf({
      "m15/g/a@750": { title: wobble, rules: [1, 0, 7.2, 0.04] },
      "m15/g/a@hd": { title: wobble, rules: [0, 0, 6.6, 0.03] },
      "m15/g/b@foil@750": { title: wobble, rules: [1, 0, 6.5, 0.031] },
      "saga/g/c@hd": { title: [0, -3, 8, 0.05], rules: [1, 0, 6.5, 0.031] },
    });
    const plan = record(root, "darwin", second, loadBaseline(root).platforms.darwin.cases);
    expect(plan.changed.map((c) => c.key)).toEqual(["saga/g/c@hd"]);
    expect(plan.changed[0].why[0]).toMatch(/title: the preview sits at 0,-3 px .* it was 0,-1/);
    expect(plan.kept).toHaveLength(5);

    const after = tree(root);
    const differing = Object.keys(after).filter((name) => after[name] !== before[name]);
    expect(differing).toEqual(["darwin/saga__g__c.json"]);
    // In that file the 750 line — still inside its tolerance — is the old
    // line, byte for byte; only the hd line is new.
    const [was, now] = [before["darwin/saga__g__c.json"].split("\n"), after["darwin/saga__g__c.json"].split("\n")];
    expect(now.map((line, i) => line === was[i])).toEqual([true, true, true, false, true, true]);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(() => loadBaseline(root)).not.toThrow();
  });

  it("records nothing at all when nothing left its tolerance", () => {
    const root = tmpRoot();
    record(root, "darwin", runOf());
    const stored = loadBaseline(root).platforms.darwin.cases;
    const plan = planUpdate({ stored, run: runOf({ "m15/g/a@750": { title: [1, -1, 9, 0.06], rules: [1, 0, 6.5, 0.031] } }) });
    expect(plan.changed).toEqual([]);
    expect(platformDelta(root, "darwin", caseFiles(plan.cases))).toEqual({ write: [], remove: [] });
  });

  it("adds a new case's file and removes a removed case's — on this platform, and the removed one's leftovers on the others", () => {
    const root = tmpRoot();
    record(root, "darwin", runOf());
    record(root, "linux", runOf());
    const before = tree(root);

    const run = [...runOf().filter((m) => m.id !== "m15/g/a"), measured("battle/g/new", "750", { title: [0, 0, 5, 0.02] }), measured("battle/g/new", "hd", { title: [0, -2, 5, 0.02] })];
    const plan = planUpdate({ stored: loadBaseline(root).platforms.darwin.cases, run });
    expect(plan.changed).toEqual([
      { key: "battle/g/new@750", why: ["new"] },
      { key: "battle/g/new@hd", why: ["new"] },
    ]);
    expect(plan.removed).toEqual(["m15/g/a@750", "m15/g/a@hd"]);
    const files = caseFiles(plan.cases);
    const delta = platformDelta(root, "darwin", files);
    expect(delta.write.map((f) => f.name)).toEqual(["battle__g__new.json"]);
    expect(delta.remove).toEqual(["m15__g__a.json"]);
    applyDelta(root, "darwin", delta);
    // The other platform: only the file of the case that is gone — its
    // numbers for the new case are its own to record.
    const other = platformDelta(root, "linux", files, "orphans");
    expect(other).toEqual({ write: [], remove: ["m15__g__a.json"] });
    applyDelta(root, "linux", other);

    const after = tree(root);
    expect(Object.keys(after).sort()).toEqual(["darwin/battle__g__new.json", "darwin/m15__g__b__foil.json", "darwin/saga__g__c.json", "linux/m15__g__b__foil.json", "linux/saga__g__c.json"]);
    for (const name of Object.keys(after)) if (name in before) expect(after[name], name).toBe(before[name]);
  });

  it("a region the card gained or lost is a moved case", () => {
    const stored = recordedOf(runOf());
    const gained = planUpdate({ stored, run: runOf({ "m15/g/a@750": { title: [0, -1, 8, 0.05], rules: [1, 0, 6.5, 0.031], stat: [0, 0, 1, 0] } }) });
    expect(gained.changed).toEqual([{ key: "m15/g/a@750", why: ["stat: a region the baseline has not got — record it"] }]);
    const lost = planUpdate({ stored, run: runOf({ "m15/g/a@750": { title: [0, -1, 8, 0.05] } }) });
    expect(lost.changed).toEqual([{ key: "m15/g/a@750", why: ["rules: a region the card no longer has"] }]);
  });

  it("--all re-records every case whose numbers differ at all, and says which", () => {
    const stored = recordedOf(runOf());
    const run = runOf({ "m15/g/a@750": { title: [1, -1, 8.9, 0.06], rules: [1, 0, 6.5, 0.031] } });
    expect(planUpdate({ stored, run }).changed).toEqual([]);
    const all = planUpdate({ stored, run, all: true });
    expect(all.changed).toEqual([{ key: "m15/g/a@750", why: ["--all: re-recorded inside its tolerance"] }]);
    expect(all.cases["m15/g/a@750"].regions.title).toEqual([1, -1, 8.9, 0.06]);
    expect(all.kept).toHaveLength(5);
  });

  it("never touches a limit: a value over one is planned like any other and refused by the run", () => {
    // (tests/parity/report.parity.spec.ts fails the update on limitFailures
    // BEFORE anything is written; the plan itself only compares with the
    // stored line. What this holds: a stored line is no way past a limit —
    // the margin of a recorded value at the limit is wider than the limit.)
    const limit = LIMITS["750"].mad;
    expect(BASELINE_MARGIN.mad(limit)).toBeGreaterThan(limit);
    const stored = recordedOf(runOf({ "m15/g/a@750": { title: [0, -1, limit, 0.05], rules: [1, 0, 6.5, 0.031] } }));
    const over = planUpdate({ stored, run: runOf({ "m15/g/a@750": { title: [0, -1, limit + 5, 0.05], rules: [1, 0, 6.5, 0.031] } }) });
    expect(over.changed).toEqual([]); // inside the recorded tolerance: the LIMIT is what fails it
  });

  it("needs both sizes of a case", () => {
    expect(() => caseFiles({ "m15/g/a@750": toBaselineCase(runOf()[0]) })).toThrow(/m15\/g\/a: no measurement at hd/);
  });
});

describe("the linux half without the artifact (scripts/lib/parity-next.mjs)", () => {
  it("the pasted script leaves the directory exactly as the update would", () => {
    const committed = tmpRoot();
    record(committed, "linux", runOf());
    execFileSync("git", ["init", "-q"], { cwd: committed });

    // CI's run: one case moved, one is new, one is gone.
    const run = [
      ...runOf({ "saga/g/c@hd": { title: [0, -3, 8, 0.05], rules: [1, 0, 6.5, 0.031] } }).filter((m) => m.id !== "m15/g/a"),
      measured("battle/g/new", "750", { title: [0, 0, 5, 0.02] }),
      measured("battle/g/new", "hd", { title: [0, -2, 5, 0.02] }),
    ];
    const plan = planUpdate({ stored: loadBaseline(committed).platforms.linux.cases, run });
    const delta = platformDelta(committed, "linux", caseFiles(plan.cases));

    // …as the browser stage leaves it in tmp/parity/next/.
    const next = tmpRoot();
    fs.mkdirSync(path.join(next, "linux"));
    for (const file of delta.write) fs.writeFileSync(path.join(next, "linux", file.name), file.text);
    fs.writeFileSync(path.join(next, "update.json"), JSON.stringify({ platform: "linux", dir: BASELINE_DIR, write: delta.write.map((f) => f.name), remove: delta.remove, changed: plan.changed, kept: plan.kept.length }));
    const read = readNextBaseline(next);
    expect(read.files.map((f: { name: string }) => f.name)).toEqual(["battle__g__new.json", "saga__g__c.json"]);
    expect(read.remove).toEqual(["m15__g__a.json"]);

    const script = baselinePasteScript(read);
    execFileSync("bash", ["-eu", "-c", script], { cwd: committed });

    const expected = tmpRoot();
    record(expected, "linux", run);
    expect(tree(committed)).toEqual(tree(expected));
    expect(() => loadBaseline(committed)).not.toThrow();
    // Staged, the removal too.
    const staged = execFileSync("git", ["status", "--porcelain"], { cwd: committed, encoding: "utf8" });
    expect(staged).toContain(`A  ${BASELINE_DIR}/linux/battle__g__new.json`);
    expect(staged).not.toContain("m15__g__a.json");
  });

  it("nothing to hand over when the run would record nothing", () => {
    expect(readNextBaseline(tmpRoot())).toBeNull();
  });

  it("the artifact command copies the platform's files through an emptied tmp directory and removes what is gone", () => {
    const command = baselineArtifactCommand({ runId: "123", repo: "o/r", dir: BASELINE_DIR, platform: "linux", files: [{ name: "a.json", text: "{}\n" }], remove: ["b.json"] });
    expect(command).toBe(
      "rm -rf tmp/parity/ci && gh run download 123 -R o/r -n parity-baseline -D tmp/parity/ci && mkdir -p tests/parity/baseline/linux && cp -R tmp/parity/ci/linux/. tests/parity/baseline/linux/ && rm -f tests/parity/baseline/linux/b.json && git add tests/parity/baseline/linux",
    );
    expect(baselineArtifactCommand({ runId: "123", repo: "", dir: BASELINE_DIR, platform: "linux", files: [], remove: ["b.json"] })).toBe(
      "rm -f tests/parity/baseline/linux/b.json && git add tests/parity/baseline/linux",
    );
  });

  it("refuses a name or a text that could leave the here-document", () => {
    expect(() => baselinePasteScript({ dir: BASELINE_DIR, platform: "linux", files: [{ name: "../x.json", text: "{}\n" }], remove: [] })).toThrow(/Not a case file name/);
    expect(() => baselinePasteScript({ dir: BASELINE_DIR, platform: "linux", files: [], remove: ["a.json; rm -rf ~"] })).toThrow(/Not a case file name/);
    expect(() => baselinePasteScript({ dir: BASELINE_DIR, platform: "linux", files: [{ name: "a.json", text: "{\nPARITY_BASELINE\n}\n" }], remove: [] })).toThrow(/here-document/);
  });
});
