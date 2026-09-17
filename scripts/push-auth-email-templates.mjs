#!/usr/bin/env node
// ---------------------------------------------------------------------------
// push-auth-email-templates.mjs — copy the branded auth email templates +
// subjects onto a HOSTED Supabase project through the Management API.
//
// Why this exists: supabase/config.toml's [auth.email.template.*] sections
// reach the local stack and preview branches, but the GitHub integration
// IGNORES auth config when it deploys to production. Without this script the
// only way to brand production's auth emails is pasting eight HTML files into
// the dashboard by hand.
//
//   npm run email:push-auth-templates            # dry run — prints the diff
//   npm run email:push-auth-templates -- --apply # writes (asks to confirm)
//
// Needs (shell env or .env.local — never commit either):
//   SUPABASE_ACCESS_TOKEN  personal access token, supabase.com/dashboard/account/tokens
//   SUPABASE_PROD_REF      the project ref (same var scripts/db-push.mjs uses)
//
// It touches ONLY the mailer_subjects_* / mailer_templates_* keys and the two
// security-notification toggles below — never SMTP, site URL, rate limits or
// providers. Templates come from scripts/build-auth-email-templates.mjs, so
// what ships is exactly what supabase/templates/*.html contains.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import {
  AUTH_EMAIL_NOTIFICATIONS,
  AUTH_EMAIL_TEMPLATES,
} from "./build-auth-email-templates.mjs";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const envLocal = loadEnvLocal();
const token = process.env.SUPABASE_ACCESS_TOKEN ?? envLocal.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROD_REF ?? envLocal.SUPABASE_PROD_REF;
const apply = process.argv.includes("--apply");

if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Create one at\n" +
      "https://supabase.com/dashboard/account/tokens and export it for this run.",
  );
  process.exit(1);
}
if (!ref || !/^[a-z]{16,24}$/.test(ref)) {
  console.error("Missing or invalid SUPABASE_PROD_REF (see scripts/db-push.mjs).");
  process.exit(1);
}

const desired = {};
for (const [name, template] of Object.entries(AUTH_EMAIL_TEMPLATES)) {
  desired[`mailer_subjects_${name}`] = template.subject;
  desired[`mailer_templates_${name}_content`] = template.html;
}
for (const [name, template] of Object.entries(AUTH_EMAIL_NOTIFICATIONS)) {
  desired[`mailer_notifications_${name}_enabled`] = true;
  desired[`mailer_subjects_${name}_notification`] = template.subject;
  desired[`mailer_templates_${name}_notification_content`] = template.html;
}

const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const currentResponse = await fetch(endpoint, { headers });
if (!currentResponse.ok) {
  console.error(
    `Couldn't read the project's auth config (${currentResponse.status}). ` +
      "Check the token's access to this project.",
  );
  process.exit(1);
}
const current = await currentResponse.json();

const changed = Object.keys(desired).filter((key) => current[key] !== desired[key]);
console.log(`Project ${ref}: ${changed.length} of ${Object.keys(desired).length} keys differ.`);
for (const key of changed) {
  const value = desired[key];
  console.log(
    `  ~ ${key}` +
      (typeof value === "string" && value.length < 80 ? ` → ${JSON.stringify(value)}` : ""),
  );
}

// Things this script does NOT manage, but that decide whether the branded
// emails actually work — surface them every run.
console.log("\nRelated settings (read-only here):");
console.log(`  site_url                 ${current.site_url}`);
console.log(`  custom SMTP              ${current.smtp_host ? `${current.smtp_host} as "${current.smtp_sender_name ?? ""}" <${current.smtp_admin_email ?? ""}>` : "NOT SET — built-in mailer: 2 emails/hour, team addresses only"}`);
console.log(`  confirm email on signup  ${current.mailer_autoconfirm === false ? "on" : "OFF"}`);
console.log(`  min password length      ${current.password_min_length}`);
console.log(`  leaked-password check    ${current.password_hibp_enabled ? "on" : "off"}`);
if (typeof current.site_url === "string" && !current.site_url.startsWith("https://")) {
  console.log("  ⚠️  site_url is not https — every email link is built from it.");
}

if (changed.length === 0) {
  console.log("\nNothing to push.");
  process.exit(0);
}
if (!apply) {
  console.log("\nDry run. Re-run with --apply to write these keys.");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `\n⚠️  About to overwrite ${changed.length} auth email setting(s) on ${ref}.\n` +
    `   Type "production" to continue: `,
);
rl.close();
if (answer.trim() !== "production") {
  console.log("Aborted.");
  process.exit(1);
}

const patch = Object.fromEntries(changed.map((key) => [key, desired[key]]));
const response = await fetch(endpoint, {
  method: "PATCH",
  headers,
  body: JSON.stringify(patch),
});
if (!response.ok) {
  console.error(`Push failed (${response.status}): ${await response.text()}`);
  process.exit(1);
}
console.log("Pushed. Send yourself a password reset to see it.");
