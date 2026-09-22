// ---------------------------------------------------------------------------
// Seed the e2e test user into the LOCAL Supabase stack. Idempotent — safe
// to run any number of times. Reads connection + credentials from .env.e2e
// (see .env.e2e.example).
//
//   node scripts/seed-e2e.mjs
//
// Creates the auth user (pre-confirmed) and gives its profile a username so
// canonical /card/[username]/[slug] routes exist for the created cards.
// Refuses to run against anything that isn't a local URL — this script must
// never touch production.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.e2e", import.meta.url), "utf8").split("\n")) {
  if (line.trim().startsWith("#")) continue;
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SECRET_KEY;
const email = env.SUPABASE_E2E_USER_EMAIL;
const password = env.SUPABASE_E2E_USER_PASSWORD;

if (!url || !serviceKey || !email || !password) {
  console.error("✗ .env.e2e is missing one of: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_E2E_USER_EMAIL, SUPABASE_E2E_USER_PASSWORD");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
  console.error(`✗ Refusing to seed a non-local Supabase URL: ${url}`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

let userId = created?.user?.id ?? null;
if (error) {
  if (!/already|exists|registered/i.test(error.message)) {
    console.error(`✗ createUser failed: ${error.message}`);
    process.exit(1);
  }
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    console.error(`✗ listUsers failed: ${listError.message}`);
    process.exit(1);
  }
  userId = list.users.find((u) => u.email === email)?.id ?? null;
}

if (!userId) {
  console.error("✗ Could not resolve the e2e user id.");
  process.exit(1);
}

// A fixed username unlocks the canonical card URL path; the signup trigger
// (0094) minted a generated handle, which we overwrite with e2e_forger.
const { error: profileError } = await admin
  .from("profiles")
  // is_admin powers the /admin e2e specs (challenge authoring). Only the
  // LOCAL stack ever runs this script (the URL guard above).
  .update({
    username: "e2e_forger",
    display_name: "E2E Forger",
    is_admin: true,
    // Past the first-run wizard (migration 0095) — the specs expect /dashboard.
    onboarded_at: new Date().toISOString(),
  })
  .eq("id", userId);
if (profileError) {
  console.error(`✗ profile update failed: ${profileError.message}`);
  process.exit(1);
}

// Wipe the e2e user's cards — every suite run creates a few, and after
// enough runs the account hits the free-tier card limit, which fails the
// save flows with an upgrade dialog instead of a redirect. Re-seeding
// resets the slate. (Local-only by the URL guard above; deleting by
// owner_id can never touch anyone else's cards.)
const { error: wipeError, count: wiped } = await admin
  .from("cards")
  .delete({ count: "exact" })
  .eq("owner_id", userId);
if (wipeError) {
  console.error(`✗ card wipe failed: ${wipeError.message}`);
  process.exit(1);
}

// Frame verification is the creator's ONLY gate (lib/cards/frame-availability):
// an unverified frame is a disabled "Soon" chip. supabase/seed.sql seeds the
// combos production has verified, but only on a `db reset` — a long-lived
// local DB may predate it — and agclassic is NOT verified on prod, yet the
// frame-era spec (create-card.spec.ts) picks a Classic frame before accepting
// the "switch to M15" planeswalker offer. So verify exactly the combos the
// specs click through — all seven color keys, so a spec that changes the
// card's color first still finds them. (Local-only by the URL guard above.)
const E2E_VERIFIED_TEMPLATES = ["m15", "m15pw", "agclassic"];
const E2E_COLOR_KEYS = ["w", "u", "b", "r", "g", "c", "m"];
const verifiedAt = new Date().toISOString();
const { error: framesError } = await admin.from("frame_reviews").upsert(
  E2E_VERIFIED_TEMPLATES.flatMap((template) =>
    E2E_COLOR_KEYS.map((color_key) => ({
      template,
      color_key,
      verified: true,
      verified_at: verifiedAt,
      verified_by: userId,
    })),
  ),
  { onConflict: "template,color_key" },
);
if (framesError) {
  console.error(`✗ frame_reviews seed failed: ${framesError.message}`);
  process.exit(1);
}

// The challenge specs (tests/e2e/challenges.spec.ts, challenge-entry.spec.ts)
// need an ACTIVE "Arcane Frontiers". Migration 0040 seeds it ending 14 days
// after the migrations ran, so a long-lived local stack outlives it — re-open
// it (started yesterday, ends in 14 days) on every seed run.
const DAY_MS = 86_400_000;
const { error: challengeError } = await admin.from("challenges").upsert(
  {
    slug: "arcane-frontiers",
    title: "Arcane Frontiers",
    description:
      "Explore the unknown. Design a card that pushes the boundaries of magic and technology — an artifact creature, a spell that bends the rules, a place where ley lines meet circuitry. Show us what lies beyond. Publish your card with the challenge tag to enter; the community's likes decide the spotlight.",
    tag: "arcane-frontiers",
    starts_at: new Date(Date.now() - DAY_MS).toISOString(),
    ends_at: new Date(Date.now() + 14 * DAY_MS).toISOString(),
    featured: true,
  },
  { onConflict: "slug" },
);
if (challengeError) {
  console.error(`✗ challenge seed failed: ${challengeError.message}`);
  process.exit(1);
}

console.log(
  `✓ Seeded ${email} (${userId}) with username e2e_forger (wiped ${wiped ?? 0} stale cards, verified ${E2E_VERIFIED_TEMPLATES.join("/")} frames, re-opened arcane-frontiers for 14 days)`,
);
