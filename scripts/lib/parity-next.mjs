// ---------------------------------------------------------------------------
// What a parity run would record (TODO 7.13), as the browser stage leaves it
// in tmp/parity/next/ (tests/parity/report.parity.spec.ts): update.json and
// the case files that differ from the committed ones — and that as text a
// contributor can take into a branch WITHOUT the artifact. A red CI run
// prints it: the linux half of a re-record is a paste.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";

const MARK = "PARITY_BASELINE";
/** Past this the script is not printed (a job summary holds 1 MB a step):
 *  the artifact command is. A case file is about 3 kB. */
export const PASTE_LIMIT_BYTES = 400_000;

/** tmp/parity/next/ of the run that just ended, or null when it would
 *  record nothing (or was not the whole matrix). */
export function readNextBaseline(nextDir) {
  const file = path.join(nextDir, "update.json");
  if (!fs.existsSync(file)) return null;
  const update = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...update,
    files: update.write.map((name) => ({ name, text: fs.readFileSync(path.join(nextDir, update.platform, name), "utf8") })),
  };
}

/**
 * A shell script that leaves `dir/platform/` as an update on that platform
 * would: the changed case files written whole, the removed ones deleted,
 * nothing else touched. Run from the repo's root.
 */
export function baselinePasteScript({ dir, platform, files, remove }) {
  const safe = /^[A-Za-z0-9._-]+\.json$/;
  for (const name of [...files.map((f) => f.name), ...remove]) if (!safe.test(name)) throw new Error(`Not a case file name: ${name}`);
  if (!/^[a-z0-9]+$/.test(platform)) throw new Error(`Not a platform: ${platform}`);
  const target = `${dir}/${platform}`;
  const lines = [`mkdir -p ${target}`];
  for (const file of files) {
    if (file.text.split("\n").includes(MARK) || !file.text.endsWith("\n")) throw new Error(`${file.name} cannot be quoted in a here-document`);
    lines.push(`cat > ${target}/${file.name} <<'${MARK}'`, file.text.slice(0, -1), MARK);
  }
  for (const name of remove) lines.push(`rm -f ${target}/${name}`);
  lines.push(`git add ${target}`);
  return `${lines.join("\n")}\n`;
}

/** The same from the run's artifact (`gh` will not overwrite a file, so it
 *  goes through an emptied tmp/parity/ci). */
export function baselineArtifactCommand({ runId, repo, dir, platform, files, remove }) {
  const target = `${dir}/${platform}`;
  const steps = [];
  if (files.length) {
    steps.push(
      "rm -rf tmp/parity/ci",
      `gh run download ${runId}${repo ? ` -R ${repo}` : ""} -n parity-baseline -D tmp/parity/ci`,
      `mkdir -p ${target}`,
      `cp -R tmp/parity/ci/${platform}/. ${target}/`,
    );
  }
  if (remove.length) steps.push(`rm -f ${remove.map((name) => `${target}/${name}`).join(" ")}`);
  steps.push(`git add ${target}`);
  return steps.join(" && ");
}
