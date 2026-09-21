#!/usr/bin/env node
// ---------------------------------------------------------------------------
// seed-dev.mjs — finish seeding a NON-production database.
//
// supabase/seeds/10_dev_data.sql creates the test accounts + content, but this
// repo is public, so that file gives every account an unknowable password.
// This script is the half that can't live in SQL:
//
//   npm run seed:dev
//       Sets one shared password on the five dev_* accounts (from
//       DEV_SEED_PASSWORD in .env.local or the shell) and prints the logins.
//
//   npm run seed:dev -- --copy-cards-from <prod-username>
//       ALSO copies that user's PUBLIC cards from production into the target,
//       owned by dev_admin. Production is only ever READ, anonymously, through
//       the same public API a logged-out visitor uses — no production secret
//       is involved and nothing is written there. Each card's art + stored
//       render + thumbnail are re-hosted in the TARGET's own storage, so the
//       dev database never depends on production afterwards.
//
//   --env-file <path>   read the TARGET from another env file (default
//                       .env.local) — e.g. .env.e2e for the local Docker stack,
//                       or a file holding an ephemeral preview branch's keys.
//
// SAFETY: the target is refused outright if it is the production project.
// The check is on the URL, so it holds even with a mis-pasted env file.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_HOSTS, isProductionSupabaseUrl } from "./lib/prod-guard.mjs";

const args = process.argv.slice(2);
function flag(name) {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "") : null;
}

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const envFile = path.resolve(flag("--env-file") ?? ".env.local");
const fileEnv = parseEnvFile(envFile);
const env = (name) => process.env[name] ?? fileEnv[name] ?? "";

const targetUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = env("SUPABASE_SECRET_KEY");
const password = env("DEV_SEED_PASSWORD");

if (!targetUrl || !secretKey) {
  console.error(`✗ ${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.`);
  process.exit(1);
}
if (isProductionSupabaseUrl(targetUrl)) {
  console.error(
    `✗ REFUSING: ${new URL(targetUrl).host} is PRODUCTION.\n` +
      "  seed-dev only ever writes to the dev branch, a preview branch or the\n" +
      "  local stack. Point the env file at one of those.",
  );
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error(
    "✗ Set DEV_SEED_PASSWORD (12+ characters) in .env.local or the shell.\n" +
      "  It is never committed — this repo is public.",
  );
  process.exit(1);
}

const target = createClient(targetUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEV_ACCOUNTS = [
  { id: "d0000000-0000-4000-a000-000000000001", email: "admin@dev.pipglyph.test", note: "admin + comped Pro" },
  { id: "d0000000-0000-4000-a000-000000000002", email: "pro@dev.pipglyph.test", note: "paid Pro, 200 credits" },
  { id: "d0000000-0000-4000-a000-000000000003", email: "free@dev.pipglyph.test", note: "free tier, drafts" },
  { id: "d0000000-0000-4000-a000-000000000004", email: "artist@dev.pipglyph.test", note: "prolific creator" },
  { id: "d0000000-0000-4000-a000-000000000005", email: "new@dev.pipglyph.test", note: "not onboarded yet" },
];
const DEV_ADMIN_ID = DEV_ACCOUNTS[0].id;

console.log(`Target: ${new URL(targetUrl).host}`);

// ---- 1. Passwords ----------------------------------------------------------
let missing = 0;
for (const account of DEV_ACCOUNTS) {
  const { error } = await target.auth.admin.updateUserById(account.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    missing++;
    console.error(`  ✗ ${account.email}: ${error.message}`);
  } else {
    console.log(`  ✓ ${account.email.padEnd(26)} ${account.note}`);
  }
}
if (missing === DEV_ACCOUNTS.length) {
  console.error(
    "\n✗ No dev accounts found — the SQL seed hasn't run on this database.\n" +
      "  Local: `npm run db:reset`.  Dev branch: `npm run db:seed:dev`.",
  );
  process.exit(1);
}
console.log("  (all five share DEV_SEED_PASSWORD)");

// ---- 2. Optional: copy a production user's PUBLIC cards (read-only) ---------
const copyFrom = flag("--copy-cards-from");
if (copyFrom === null) process.exit(0);
if (!/^[a-z0-9_]{3,32}$/.test(copyFrom)) {
  console.error("✗ --copy-cards-from needs a username (a-z, 0-9, _).");
  process.exit(1);
}

// The production side of the copy uses ONLY the public URL + publishable key —
// the pair every visitor's browser already has. RLS shows it public rows only.
const peek = parseEnvFile(path.resolve(".env.prod-peek"));
const prodUrl = process.env.PROD_SUPABASE_URL ?? peek.NEXT_PUBLIC_SUPABASE_URL ?? "";
const prodKey =
  process.env.PROD_SUPABASE_PUBLISHABLE_KEY ?? peek.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
if (!prodUrl || !prodKey || !isProductionSupabaseUrl(prodUrl)) {
  console.error(
    "✗ Copying needs production's PUBLIC url + publishable key, read from\n" +
      "  .env.prod-peek (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).\n" +
      `  Known production hosts: ${PRODUCTION_SUPABASE_HOSTS.join(", ")}`,
  );
  process.exit(1);
}
const prod = createClient(prodUrl, prodKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: owner, error: ownerError } = await prod
  .from("profiles")
  .select("id, username")
  .eq("username", copyFrom)
  .maybeSingle();
if (ownerError || !owner) {
  console.error(`✗ No public profile "${copyFrom}" on production.`);
  process.exit(1);
}

const { data: sourceCards, error: cardsError } = await prod
  .from("cards")
  .select("*")
  .eq("owner_id", owner.id)
  .eq("visibility", "public")
  .order("created_at", { ascending: true })
  .limit(500);
if (cardsError) {
  console.error(`✗ Reading public cards failed: ${cardsError.message}`);
  process.exit(1);
}
console.log(`\nCopying ${sourceCards.length} public card(s) from @${copyFrom} → dev_admin`);

const { data: gameSystem } = await target
  .from("game_systems")
  .select("id")
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();

/** Download a PUBLIC file and re-host it in the target's bucket. Returns the
 *  new public URL, or null when the source is missing/unreachable. */
async function rehost(sourceUrl, bucket, objectPath) {
  if (!sourceUrl) return null;
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const { error } = await target.storage
      .from(bucket)
      .upload(objectPath, bytes, { contentType, upsert: true });
    if (error) return null;
    return target.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
  } catch {
    return null;
  }
}

function extensionOf(url, fallback) {
  const match = /\.([a-z0-9]{3,4})(?:\?|$)/i.exec(new URL(url).pathname);
  return match ? match[1].toLowerCase() : fallback;
}

// Columns that must NOT travel: identity, ownership, cross-table links that
// don't exist in the target, and counters that belong to production.
const DROP = new Set([
  "owner_id", "game_system_id", "template_id", "parent_card_id", "back_card_id",
  "primary_set_id", "view_count", "likes_count", "share_count", "search_vector",
]);

let copied = 0;
for (const source of sourceCards) {
  const row = Object.fromEntries(Object.entries(source).filter(([key]) => !DROP.has(key)));
  row.owner_id = DEV_ADMIN_ID;
  row.game_system_id = gameSystem?.id;
  // Same id as production → re-running updates in place instead of duplicating.
  row.slug = source.slug;

  const renderPath = `${DEV_ADMIN_ID}/${source.id}.png`;
  row.art_url = source.art_url
    ? await rehost(source.art_url, "card-art", `${DEV_ADMIN_ID}/${source.id}.${extensionOf(source.art_url, "webp")}`)
    : null;
  row.rendered_image_url = await rehost(source.rendered_image_url, "card-renders", renderPath);
  row.rendered_thumb_url = await rehost(
    source.rendered_thumb_url,
    "card-renders",
    renderPath.replace(/\.png$/, "") + ".thumb.webp",
  );
  if (!row.rendered_image_url) {
    // No stored render made it across → let the tile fall back to the live
    // preview rather than point at a missing file.
    row.rendered_image_url = null;
    row.rendered_thumb_url = null;
    row.rendered_at = null;
  }

  const { error } = await target.from("cards").upsert(row, { onConflict: "id" });
  if (error) {
    console.error(`  ✗ ${source.title}: ${error.message}`);
  } else {
    copied++;
    console.log(`  ✓ ${source.title}`);
  }
}
console.log(`\nCopied ${copied}/${sourceCards.length}. Production was read-only throughout.`);
