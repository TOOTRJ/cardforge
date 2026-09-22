#!/usr/bin/env node
// Prints a Markdown summary of a Playwright JSON report: totals, then every
// skipped test (with its reason) and every "flaky" one (failed, then passed
// on retry). Neither fails the run — retries: 2 in CI would otherwise turn a
// real flake into a silent green — so CI appends this to the job summary.
//
//   node scripts/e2e-summary.mjs test-results/report.json
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "test-results/report.json";
let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.log(`### E2E summary\n\n_No JSON report at ${file} (${error.message})._`);
  process.exit(0);
}

const rows = [];
function walk(suite, trail) {
  const here = [...trail, suite.title].filter(Boolean);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const statuses = results.map((r) => r.status);
      const last = statuses[statuses.length - 1] ?? test.status;
      rows.push({
        name: [...here, spec.title].join(" › "),
        status: test.status, // expected | unexpected | flaky | skipped
        last,
        attempts: results.length,
        reason: results.find((r) => r.status === "skipped")?.annotations?.[0]?.description ?? spec.annotations?.find((a) => a.type === "skip")?.description ?? "",
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, here);
}
for (const suite of report.suites ?? []) walk(suite, []);

const count = (s) => rows.filter((r) => r.status === s).length;
const skipped = rows.filter((r) => r.status === "skipped");
const flaky = rows.filter((r) => r.status === "flaky");
const failed = rows.filter((r) => r.status === "unexpected");

console.log("### E2E summary\n");
console.log(`| passed | failed | flaky (passed on retry) | skipped |`);
console.log(`|---|---|---|---|`);
console.log(`| ${count("expected")} | ${failed.length} | ${flaky.length} | ${skipped.length} |\n`);
if (flaky.length) {
  console.log("**Flaky — passed only on retry (fix these before they fail for real):**\n");
  for (const r of flaky) console.log(`- ${r.name} (${r.attempts} attempts)`);
  console.log("");
}
if (skipped.length) {
  console.log("**Skipped:**\n");
  for (const r of skipped) console.log(`- ${r.name}${r.reason ? ` — ${r.reason}` : ""}`);
  console.log("");
}
if (failed.length) {
  console.log("**Failed:**\n");
  for (const r of failed) console.log(`- ${r.name}`);
  console.log("");
}
