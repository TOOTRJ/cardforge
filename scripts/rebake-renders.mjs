// ---------------------------------------------------------------------------
// Re-bake stored card renders after a renderer/template change.
//
// Bump CARD_LAYOUT_VERSION (lib/cards/layout-version.ts) first, then run:
//
//   node scripts/rebake-renders.mjs
//     REBAKE_URL    target endpoint (default http://localhost:3000/api/admin/rebake
//                   — the local dev server, which talks to the same Supabase
//                   project and needs SUPABASE_SECRET_KEY in its env, AND
//                   NEXT_PUBLIC_BILLING_ENABLED set exactly as production has
//                   it: the bake reads isBillingEnabled() for the brand mark,
//                   so a server with the flag unset bakes every card CLEAN —
//                   which is how layout v21 came to exist)
//     CRON_SECRET   required when REBAKE_URL points at production
//     BATCH         cards per request (default 8, max 25)
//
// Loops batches until the endpoint reports no stale renders remain; stops if
// an entire batch fails (so a systemic error doesn't spin forever).
// ---------------------------------------------------------------------------

const URL_ = process.env.REBAKE_URL ?? "http://localhost:3000/api/admin/rebake";
const SECRET = process.env.CRON_SECRET ?? "";
const BATCH = process.env.BATCH ?? "8";
// SCOPE=legacy-art re-bakes cards whose art lives on a legacy storage host
// (black art boxes before the 2026-09-16 allowlist fix); BEFORE defaults to
// the moment the sweep starts so re-baked rows drop out of the selection.
const SCOPE = process.env.SCOPE === "legacy-art" ? "legacy-art" : "stale";
const BEFORE = process.env.BEFORE ?? new Date().toISOString();
const SCOPE_QS = SCOPE === "legacy-art" ? `&scope=legacy-art&before=${encodeURIComponent(BEFORE)}` : "";

let totalProcessed = 0;
let totalFailed = 0;

for (let round = 1; ; round++) {
  const res = await fetch(`${URL_}?limit=${BATCH}${SCOPE_QS}`, {
    method: "POST",
    headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
  });
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  totalProcessed += body.processed.length;
  totalFailed += body.failed.length;
  console.log(
    `round ${round}: rebaked ${body.processed.length}, failed ${body.failed.length}, remaining ${body.remaining}`,
  );
  for (const f of body.failed) console.error(`  ✗ ${f.id}: ${f.error}`);

  if (body.remaining === 0) break;
  if (body.processed.length === 0) {
    console.error("✗ A full batch failed — stopping. Fix the errors above and rerun.");
    process.exit(1);
  }
}

console.log(`Done. ${totalProcessed} re-baked, ${totalFailed} failed.`);
