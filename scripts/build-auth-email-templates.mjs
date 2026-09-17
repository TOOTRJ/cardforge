#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Renders the branded Supabase Auth email templates into supabase/templates/
// from the ONE email shell (lib/email/layout.ts), so the auth emails and the
// app's own emails can never drift apart.
//
//   node scripts/build-auth-email-templates.mjs     # node ≥ 23.6 (type stripping)
//
// The output is committed. supabase/config.toml points the LOCAL stack and
// every Supabase preview branch at these files; PRODUCTION does not read
// config.toml auth settings — push them with
// `node scripts/push-auth-email-templates.mjs` (see docs/EMAIL.md).
//
// Links use the token HASH and land on /auth/confirm, which verifies with a
// button press (works in any browser; survives mail-scanner prefetch):
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
// ---------------------------------------------------------------------------

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emailCode,
  emailLink,
  emailNote,
  renderEmailLayout,
} from "../lib/email/layout.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "supabase", "templates");

const SITE = "{{ .SiteURL }}";
const confirmUrl = (type) =>
  `${SITE}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`;

const IGNORE =
  "If you didn't ask for this, you can safely ignore this email — nothing on your account changes.";
const SECURITY_ALERT = `If this wasn't you, ${emailLink(`${SITE}/forgot-password`, "reset your password")} right away and check the sign-in methods in your settings.`;

/** name → { subject, html }. `subject` is mirrored in supabase/config.toml
 *  and scripts/push-auth-email-templates.mjs reads it from here. */
export const AUTH_EMAIL_TEMPLATES = {
  confirmation: {
    subject: "Confirm your PipGlyph account",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "One click and your account is ready.",
      heading: "Confirm your email",
      paragraphs: [
        "Welcome to PipGlyph. Confirm this email address and your account is ready — then pick a username, choose an avatar, and forge your first card.",
      ],
      cta: { label: "Confirm email", url: confirmUrl("email") },
      after: [emailNote("This link works on any device and expires in one hour.")],
      footerNote: `You're receiving this because someone signed up for PipGlyph with {{ .Email }}. ${IGNORE}`,
    }),
  },
  recovery: {
    subject: "Reset your PipGlyph password",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "Choose a new password for your account.",
      heading: "Reset your password",
      paragraphs: [
        "We got a request to reset the password for your PipGlyph account. Use the button below to choose a new one.",
      ],
      cta: { label: "Choose a new password", url: confirmUrl("recovery") },
      after: [
        emailNote(
          "This link works on any device, can be used once, and expires in one hour. Resetting your password signs out your other devices.",
        ),
      ],
      footerNote: `This was sent to {{ .Email }} because a password reset was requested. ${IGNORE}`,
    }),
  },
  magic_link: {
    subject: "Your PipGlyph sign-in link",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "Sign in without a password.",
      heading: "Sign in to PipGlyph",
      paragraphs: ["Use the button below to sign in. No password needed."],
      cta: { label: "Sign in", url: confirmUrl("magiclink") },
      after: [emailNote("This link can be used once and expires in one hour.")],
      footerNote: `This was sent to {{ .Email }} because a sign-in link was requested. ${IGNORE}`,
    }),
  },
  email_change: {
    subject: "Confirm your new PipGlyph email address",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "Confirm the change to finish updating your account.",
      heading: "Confirm your new email",
      paragraphs: [
        "You asked to change the email address on your PipGlyph account from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>.",
        "Confirm the change to finish. Your current address keeps working until you do.",
      ],
      cta: { label: "Confirm email change", url: confirmUrl("email_change") },
      after: [
        emailNote(
          "For your security we may ask you to confirm from both addresses. This link expires in one hour.",
        ),
      ],
      footerNote: `This was sent because an email change was requested on a PipGlyph account. ${IGNORE}`,
    }),
  },
  invite: {
    subject: "You're invited to PipGlyph",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "Accept your invitation and set a password.",
      heading: "You're invited to PipGlyph",
      paragraphs: [
        "PipGlyph is a custom card creator for Magic: The Gathering fans — precision mana pips, advanced text tools, and frames from three decades of card design.",
        "Accept the invitation to set a password and start creating.",
      ],
      cta: { label: "Accept invitation", url: confirmUrl("invite") },
      footerNote: `This invitation was sent to {{ .Email }} by the PipGlyph team. If you weren't expecting it, you can ignore this email.`,
    }),
  },
  reauthentication: {
    subject: "Your PipGlyph verification code",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "Enter this code to confirm it's you.",
      heading: "Confirm it's you",
      paragraphs: ["Enter this code on PipGlyph to continue:"],
      after: [
        emailCode("{{ .Token }}"),
        emailNote(
          "<br>The code expires in one hour. Never share it — PipGlyph staff will never ask for it.",
        ),
      ],
      footerNote: `This was sent to {{ .Email }} because a sensitive change was started on your account. ${IGNORE}`,
    }),
  },
};

/** Security notifications Supabase can send AFTER a change lands. */
export const AUTH_EMAIL_NOTIFICATIONS = {
  password_changed: {
    subject: "Your PipGlyph password was changed",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "A security notice about your account.",
      heading: "Your password was changed",
      paragraphs: [
        "The password for the PipGlyph account <strong>{{ .Email }}</strong> was just changed.",
        `If that was you, there's nothing else to do. ${SECURITY_ALERT}`,
      ],
      footerNote: "Security notices are sent for every account and can't be turned off.",
    }),
  },
  email_changed: {
    subject: "Your PipGlyph email address was changed",
    html: renderEmailLayout({
      siteUrl: SITE,
      preheader: "A security notice about your account.",
      heading: "Your email address was changed",
      paragraphs: [
        "The email address on your PipGlyph account was changed from <strong>{{ .OldEmail }}</strong> to <strong>{{ .Email }}</strong>.",
        `If that was you, there's nothing else to do. If it wasn't, reply to this email right away so we can help you recover the account.`,
      ],
      footerNote: "Security notices are sent for every account and can't be turned off.",
    }),
  },
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const all = { ...AUTH_EMAIL_TEMPLATES, ...AUTH_EMAIL_NOTIFICATIONS };
  for (const [name, template] of Object.entries(all)) {
    await writeFile(path.join(OUT, `${name}.html`), template.html);
    console.log(`✓ supabase/templates/${name}.html — "${template.subject}"`);
  }
}

// Only build when run directly (push-auth-email-templates.mjs imports the maps).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
