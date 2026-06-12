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

// Username unlocks the canonical card URL path; the signup trigger created
// the profile row with username null.
const { error: profileError } = await admin
  .from("profiles")
  // is_admin powers the /admin e2e specs (challenge authoring). Only the
  // LOCAL stack ever runs this script (the URL guard above).
  .update({ username: "e2e_forger", display_name: "E2E Forger", is_admin: true })
  .eq("id", userId);
if (profileError) {
  console.error(`✗ profile update failed: ${profileError.message}`);
  process.exit(1);
}

console.log(`✓ Seeded ${email} (${userId}) with username e2e_forger`);
