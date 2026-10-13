import fs from "node:fs";
import path from "node:path";
import { PARITY_SIZES, parityFileName } from "./shared";
import { baselineFailures, baselineKey, toBaselineCase, type BaselineCase, type Measured, type SizeName } from "./thresholds";

// ---------------------------------------------------------------------------
// The recorded baseline (tests/parity/thresholds.ts, layer 3) as it is kept
// in git (TODO 7.13): ONE FILE PER CASE PER PLATFORM,
//
//   tests/parity/baseline/<platform>/<parityFileName(case id)>.json
//
//   {
//    "id": "m15/g/creature-long@symbols",
//    "750": {"regions":{…},"card":[…],"tiles":"…"},
//    "hd": {"regions":{…},"card":[…],"tiles":"…"}
//   }
//
// Why files and not the one baseline.json of #514: two PRs that each add or
// move a case touch DIFFERENT files, so git has nothing to merge — the one
// file conflicted on its date line every time, and on neighbouring lines
// whenever two cases sorted next to each other (and a `merge=union` would
// have kept both sides' lines of ONE case without saying so). Two PRs that
// move the SAME case still conflict, in that case's file alone: that one is
// real and somebody has to look at it.
//
// No date and no note: `git log -- tests/parity/baseline/` is the record.
//
// A file is read only in its canonical text (what serializeCaseFile writes):
// a hand edit, a stray field, a line a merge doubled or a file under another
// case's name fails the loader — and with it the suite and the unit run —
// instead of being read as something it is not.
//
// An update rewrites a case's line ONLY when the case is new or today's
// measurement left the stored line's tolerance (baselineFailures); every
// other line stays byte for byte, so a re-record reads as the cases that
// moved. `--update --all` re-records every line (planUpdate's `all`).
// ---------------------------------------------------------------------------

/** The directory, from the repo's root. */
export const BASELINE_DIR = "tests/parity/baseline";
/** #514's single file: it may not come back (a merge of an older branch). */
export const LEGACY_BASELINE_FILE = "tests/parity/baseline.json";

const SIZE_NAMES: readonly SizeName[] = PARITY_SIZES.map((size) => size.name);

/** The baseline in memory: per platform, per `<case id>@<size>` — the shape
 *  the old file's readers used, without its `recorded` date. */
export type Baseline = { platforms: Record<string, { cases: Record<string, BaselineCase> }> };

export type CaseFile = { id: string; sizes: Record<SizeName, BaselineCase> };

export function caseFileName(id: string): string {
  return `${parityFileName(id)}.json`;
}

/** A case file's text: one line per size, in PARITY_SIZES' order. */
export function serializeCaseFile(file: CaseFile): string {
  const lines = [` "id": ${JSON.stringify(file.id)}`, ...SIZE_NAMES.map((size) => ` ${JSON.stringify(size)}: ${JSON.stringify(file.sizes[size])}`)];
  return `{\n${lines.join(",\n")}\n}\n`;
}

const isNumbers = (value: unknown, length: number) =>
  Array.isArray(value) && value.length === length && value.every((n) => typeof n === "number" && Number.isFinite(n));

function isBaselineCase(value: unknown): value is BaselineCase {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    Boolean(c.regions) &&
    typeof c.regions === "object" &&
    Object.values(c.regions as object).every((r) => isNumbers(r, 4)) &&
    isNumbers(c.card, 2) &&
    typeof c.tiles === "string"
  );
}

/** One case file, or what is wrong with it (thrown). `name` is the file's
 *  name in its platform directory. */
export function parseCaseFile(name: string, text: string): CaseFile {
  // A key twice (what a union merge of two re-records leaves): JSON.parse
  // would keep the last one silently.
  const keys = [...text.matchAll(/^ "([^"]+)":/gm)].map((m) => m[1]);
  const doubled = [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))];
  if (doubled.length) throw new Error(`duplicate line for ${doubled.map((k) => `"${k}"`).join(", ")}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`not JSON (${(error as Error).message})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  const object = parsed as Record<string, unknown>;
  if (typeof object.id !== "string" || !object.id) throw new Error('no "id"');
  if (caseFileName(object.id) !== name) throw new Error(`holds case "${object.id}", whose file is ${caseFileName(object.id)}`);
  const missing = SIZE_NAMES.filter((size) => !isBaselineCase(object[size]));
  if (missing.length) throw new Error(`no (or a malformed) line for ${missing.map((s) => `"${s}"`).join(", ")}`);
  const file: CaseFile = { id: object.id, sizes: Object.fromEntries(SIZE_NAMES.map((size) => [size, object[size]])) as CaseFile["sizes"] };
  if (serializeCaseFile(file) !== text) {
    const extra = Object.keys(object).filter((key) => key !== "id" && !(SIZE_NAMES as readonly string[]).includes(key));
    throw new Error(
      extra.length
        ? `unknown field ${extra.map((k) => `"${k}"`).join(", ")}`
        : "not the text an update writes (edited by hand?) — re-record it: npm run test:parity -- --update",
    );
  }
  return file;
}

export type BaselineEntry = { platform: string; name: string; text: string };

/** The baseline of a set of files. Throws ONE error naming every problem. */
export function readBaseline(entries: readonly BaselineEntry[]): Baseline {
  const problems: string[] = [];
  const platforms: Baseline["platforms"] = {};
  const seen = new Map<string, string>();
  for (const entry of [...entries].sort((a, b) => (a.platform + "/" + a.name < b.platform + "/" + b.name ? -1 : 1))) {
    const where = `${BASELINE_DIR}/${entry.platform}/${entry.name}`;
    const section = (platforms[entry.platform] ??= { cases: {} });
    try {
      const file = parseCaseFile(entry.name, entry.text);
      const first = seen.get(`${entry.platform}\n${file.id}`);
      if (first) {
        problems.push(`${where}: duplicate case id "${file.id}" (also ${first})`);
        continue;
      }
      seen.set(`${entry.platform}\n${file.id}`, where);
      for (const size of SIZE_NAMES) section.cases[baselineKey({ id: file.id, size })] = file.sizes[size];
    } catch (error) {
      problems.push(`${where}: ${(error as Error).message}`);
    }
  }
  if (problems.length) throw new Error(`The parity baseline cannot be read:\n  ${problems.join("\n  ")}`);
  return { platforms };
}

/** The committed baseline. `root` is the repo's root. */
export function loadBaseline(root: string): Baseline {
  if (fs.existsSync(path.join(root, LEGACY_BASELINE_FILE))) {
    throw new Error(
      `${LEGACY_BASELINE_FILE} is back (a merge of a branch older than TODO 7.13?). The baseline is one file per case in ${BASELINE_DIR}/<platform>/: delete that file (git rm) and record your cases with \`npm run test:parity -- --update\` — it writes only what is new or moved.`,
    );
  }
  const dir = path.join(root, BASELINE_DIR);
  const entries: BaselineEntry[] = [];
  const strays: string[] = [];
  for (const platform of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    if (platform.name.startsWith(".")) continue;
    if (!platform.isDirectory()) {
      strays.push(`${BASELINE_DIR}/${platform.name}`);
      continue;
    }
    for (const name of fs.readdirSync(path.join(dir, platform.name))) {
      if (name.startsWith(".")) continue;
      if (!name.endsWith(".json")) strays.push(`${BASELINE_DIR}/${platform.name}/${name}`);
      else entries.push({ platform: platform.name, name, text: fs.readFileSync(path.join(dir, platform.name, name), "utf8") });
    }
  }
  // (A conflict's leftovers — x.json.orig, x_BACKUP_1.json — and anything
  // else that is not a case file.)
  if (strays.length) throw new Error(`The parity baseline holds files that are not case files: ${strays.join(", ")}`);
  return readBaseline(entries);
}

/** CI's platform. Its directory is the half of the baseline the required
 *  check runs against, so a run on it is never "limits only". */
export const REQUIRED_PLATFORM = "linux";

/**
 * A platform's recorded cases for a run; null where none were recorded (the
 * limits still hold there — a contributor's first run on another OS).
 * NOT on CI's platform: with `baseline/linux/` gone or empty a judging run
 * there would compare against nothing and pass, so it throws instead (a
 * measuring run or an update — `recording` — is what records it again).
 */
export function recordedFor(baseline: Baseline, platform: string, options: { recording: boolean }): Record<string, BaselineCase> | null {
  const cases = baseline.platforms[platform]?.cases ?? null;
  if (platform === REQUIRED_PLATFORM && !options.recording && (!cases || Object.keys(cases).length === 0)) {
    throw new Error(
      `${BASELINE_DIR}/${platform}/ holds no case file: the run would compare the preview with nothing recorded and pass. Restore the directory (git checkout origin/main -- ${BASELINE_DIR}/${platform}), or record it again (tests/parity/README.md).`,
    );
  }
  return cases;
}

export type UpdatePlan = {
  /** The platform's cases as an update leaves them. */
  cases: Record<string, BaselineCase>;
  /** The lines it rewrites, and why (a new case; what left its tolerance). */
  changed: { key: string; why: string[] }[];
  /** The lines it keeps byte for byte. */
  kept: string[];
  /** Recorded lines of cases the run no longer has. */
  removed: string[];
};

/**
 * What an update of ONE platform records from a full run: a case's line is
 * rewritten only when it is new or the measurement is outside the stored
 * line's tolerance (exactly what fails a check run) — never because the
 * numbers wobbled inside it. `all` re-records every line.
 */
export function planUpdate(input: { stored: Record<string, BaselineCase> | null | undefined; run: readonly Measured[]; all?: boolean }): UpdatePlan {
  const stored = input.stored ?? {};
  const plan: UpdatePlan = { cases: {}, changed: [], kept: [], removed: [] };
  for (const m of [...input.run].sort((a, b) => (baselineKey(a) < baselineKey(b) ? -1 : 1))) {
    const key = baselineKey(m);
    const base = stored[key];
    const fresh = toBaselineCase(m);
    let why: string[] = [];
    if (!base) why = ["new"];
    else {
      const gone = Object.keys(base.regions).filter((region) => !(region in m.regions));
      why = [...baselineFailures(m, base), ...gone.map((region) => `${region}: a region the card no longer has`)];
      if (!why.length && input.all && JSON.stringify(base) !== JSON.stringify(fresh)) why = ["--all: re-recorded inside its tolerance"];
    }
    if (why.length) {
      plan.cases[key] = fresh;
      plan.changed.push({ key, why });
    } else {
      plan.cases[key] = base;
      plan.kept.push(key);
    }
  }
  plan.removed = Object.keys(stored)
    .filter((key) => !(key in plan.cases))
    .sort();
  return plan;
}

/** A platform's cases as its files: name → text. A case with a size missing
 *  (a partial run) is an error — an update needs the whole matrix. */
export function caseFiles(cases: Record<string, BaselineCase>): Map<string, string> {
  const byId = new Map<string, Partial<Record<SizeName, BaselineCase>>>();
  for (const [key, value] of Object.entries(cases)) {
    const at = key.lastIndexOf("@");
    const id = key.slice(0, at);
    byId.set(id, { ...byId.get(id), [key.slice(at + 1) as SizeName]: value });
  }
  const files = new Map<string, string>();
  for (const id of [...byId.keys()].sort()) {
    const sizes = byId.get(id)!;
    const missing = SIZE_NAMES.filter((size) => !sizes[size]);
    if (missing.length) throw new Error(`${id}: no measurement at ${missing.join(", ")}`);
    files.set(caseFileName(id), serializeCaseFile({ id, sizes: sizes as CaseFile["sizes"] }));
  }
  return files;
}

export type FileDelta = { write: { name: string; text: string }[]; remove: string[] };

/** What differs between a platform's directory and `files` (nothing is
 *  written here). `only: "orphans"` — just the files `files` has no name
 *  for (another platform's leftovers of a removed case). */
export function platformDelta(root: string, platform: string, files: ReadonlyMap<string, string>, only?: "orphans"): FileDelta {
  const dir = path.join(root, BASELINE_DIR, platform);
  const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
  const write =
    only === "orphans"
      ? []
      : [...files].filter(([name, text]) => !present.includes(name) || fs.readFileSync(path.join(dir, name), "utf8") !== text).map(([name, text]) => ({ name, text }));
  return { write, remove: present.filter((name) => !files.has(name)).sort() };
}

export function applyDelta(root: string, platform: string, delta: FileDelta): void {
  const dir = path.join(root, BASELINE_DIR, platform);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of delta.write) fs.writeFileSync(path.join(dir, file.name), file.text);
  for (const name of delta.remove) fs.rmSync(path.join(dir, name));
}

/** The platform directories the baseline has. */
export function baselinePlatforms(root: string): string[] {
  const dir = path.join(root, BASELINE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}
