// ---------------------------------------------------------------------------
// Re-bake stored card renders after a renderer/template change — the driver
// for POST /api/admin/rebake. It ALWAYS plans first (dry run) and prints
// what the sweep would do, and writes nothing until you confirm.
//
//   SCOPE=version VERSION=23 node scripts/rebake-renders.mjs        # plan only
//   SCOPE=version VERSION=23 CONFIRM=yes node scripts/rebake-renders.mjs
//
//   SCOPE       required: version | sweep | legacy-art
//                 version    — only cards whose output bump VERSION changed
//                              (VERSION must be a "sweep" policy in
//                              lib/cards/layout-version.ts VERSION_ROLLOUT)
//                 sweep      — cards with ANY pending sweep-policy bump
//                 legacy-art — cards whose art is on a legacy storage host
//                              and whose render predates BEFORE (now)
//   CONFIRM=yes  actually write. Without it the script stops after the plan.
//   REBAKE_URL   endpoint (default http://localhost:3000/api/admin/rebake — a
//                local dev server on the same Supabase project). That server
//                MUST have NEXT_PUBLIC_BILLING_ENABLED set exactly as
//                production has it: the bake reads isBillingEnabled() for
//                the brand mark. The route refuses to write when the flag
//                is off (layout v21, and again on 2026-09-16, were clean
//                bakes from a server without it).
//   CRON_SECRET  required when REBAKE_URL points at production
//   BATCH        cards per request (default 8, max 25)
//
// Cards with nothing pending are stamped current without a render; cards
// whose only pending bumps are owner opt-in are left alone (badge intact)
// and reported as such. After the run the script re-plans and verifies
// nothing is left, then spot-checks a few re-baked renders exist.
// ---------------------------------------------------------------------------

const URL_ = process.env.REBAKE_URL ?? "http://localhost:3000/api/admin/rebake";
const SECRET = process.env.CRON_SECRET ?? "";
const BATCH = process.env.BATCH ?? "8";
const SCOPE = process.env.SCOPE ?? "";
const VERSION = process.env.VERSION ?? "";
const BEFORE = process.env.BEFORE ?? new Date().toISOString();
const CONFIRM = process.env.CONFIRM === "yes";

if (!["version", "sweep", "legacy-art"].includes(SCOPE)) {
  console.error("✗ SCOPE is required: version (with VERSION=N) | sweep | legacy-art");
  process.exit(1);
}
if (SCOPE === "version" && !/^\d+$/.test(VERSION)) {
  console.error("✗ SCOPE=version needs VERSION=<layout version number>");
  process.exit(1);
}

const scopeQs =
  SCOPE === "version"
    ? `&scope=version&version=${VERSION}`
    : SCOPE === "sweep"
      ? "&scope=sweep"
      : `&scope=legacy-art&before=${encodeURIComponent(BEFORE)}`;
const headers = SECRET ? { Authorization: `Bearer ${SECRET}` } : {};

async function call(extra) {
  const res = await fetch(`${URL_}?limit=${BATCH}${scopeQs}${extra}`, { method: "POST", headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    console.error(`✗ HTTP ${res.status}: ${body?.error ?? "no body"}`);
    process.exit(1);
  }
  return body;
}

const plan = await call("&dry=1");
console.log(`Layout v${plan.layoutVersion} · scope ${SCOPE}${SCOPE === "version" ? ` v${VERSION}` : ""} · server billing flag: ${plan.billingEnabled ? "ON (watermarked bakes)" : "OFF"}`);
console.log(`Plan: re-bake ${plan.plan.rebake} · stamp current ${plan.plan.stamp} · leave for owner opt-in ${plan.plan.optIn}`);
if (!plan.billingEnabled) {
  console.error("✗ The sweep server has NEXT_PUBLIC_BILLING_ENABLED off — bakes would be clean. Fix the env and rerun.");
  process.exit(1);
}
if (plan.plan.rebake + plan.plan.stamp === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
if (!CONFIRM) {
  console.log("Dry run only. Re-run with CONFIRM=yes to write.");
  process.exit(0);
}

let totalRebaked = 0;
let totalStamped = 0;
let totalFailed = 0;
const sampleUrls = [];
for (let round = 1; ; round++) {
  const body = await call("");
  const rebaked = body.processed.filter((p) => p.verdict === "rebake");
  const stamped = body.processed.filter((p) => p.verdict === "stamp");
  totalRebaked += rebaked.length;
  totalStamped += stamped.length;
  totalFailed += body.failed.length;
  for (const p of rebaked) if (sampleUrls.length < 5 && p.renderedImageUrl) sampleUrls.push(p.renderedImageUrl);
  console.log(`round ${round}: re-baked ${rebaked.length}, stamped ${stamped.length}, failed ${body.failed.length}, remaining ${body.remaining}`);
  for (const f of body.failed) console.error(`  ✗ ${f.id}: ${f.error}`);
  if (body.remaining === 0) break;
  if (body.processed.length === 0) {
    console.error("✗ A full batch failed — stopping. Fix the errors above and rerun.");
    process.exit(1);
  }
}

// Verify: re-plan must be empty, and the sampled renders must be reachable.
const after = await call("&dry=1");
const leftover = after.plan.rebake + after.plan.stamp;
let missing = 0;
for (const u of sampleUrls) {
  const res = await fetch(u, { method: "HEAD" }).catch(() => null);
  if (!res || !res.ok) missing += 1;
}
console.log(`Done. ${totalRebaked} re-baked, ${totalStamped} stamped, ${totalFailed} failed; ${after.plan.optIn} left for owner opt-in.`);
console.log(`Verify: ${leftover === 0 ? "✓ nothing left in scope" : `✗ ${leftover} still pending`} · ${sampleUrls.length - missing}/${sampleUrls.length} sampled renders reachable`);
if (leftover > 0 || missing > 0 || totalFailed > 0) process.exit(1);
