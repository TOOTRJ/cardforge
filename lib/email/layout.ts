// ---------------------------------------------------------------------------
// The ONE branded email shell. Every email PipGlyph sends is this layout:
//
//   * Supabase Auth emails — scripts/build-auth-email-templates.mjs renders it
//     into supabase/templates/*.html with Go-template placeholders
//     ({{ .SiteURL }}, {{ .TokenHash }}) as the URLs;
//   * app emails (digest, team messages, newsletter) — lib/email/*.ts renders
//     it per message.
//
// Keep this file dependency-free and erasable-syntax-only (like
// lib/brand/constants.ts): the build script imports it through node's type
// stripping. Colours come from BRAND — email clients can't read CSS variables.
//
// Email-client rules the markup follows: table layout, inline styles only,
// no web fonts (Cinzel falls back to a serif stack), a bulletproof table-cell
// button, a hidden preheader, and an absolute https image URL for the mark.
// Dark is the brand's home, so the shell is dark in every client; the
// color-scheme metas stop Apple Mail / Outlook from re-inverting it.
// ---------------------------------------------------------------------------

import { BRAND } from "../brand/constants.ts";

export type EmailCta = { label: string; url: string };

export type EmailLayoutInput = {
  /** Absolute origin for the logo + footer links, e.g. https://pipglyph.com
   *  (or the literal `{{ .SiteURL }}` for a Supabase template). */
  siteUrl: string;
  /** Inbox preview line. Plain text. */
  preheader: string;
  /** Plain text. */
  heading: string;
  /** Trusted HTML paragraphs rendered above the button. Escape user content
   *  with escapeHtml() before passing it in. */
  paragraphs: string[];
  cta?: EmailCta;
  /** Trusted HTML rendered below the button (extra blocks, lists, codes). */
  after?: string[];
  /** Trusted HTML: why the recipient got this email. */
  footerNote: string;
  /** Adds the "Unsubscribe · Email settings" footer line. */
  unsubscribeUrl?: string;
  settingsUrl?: string;
  /** Postal address line — required by CAN-SPAM on the newsletter. */
  postalAddress?: string;
};

const FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DISPLAY = "Cinzel, 'Trajan Pro', Georgia, 'Times New Roman', serif";

export const EMAIL_DISCLAIMER =
  "PipGlyph is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. Not approved/endorsed by Wizards.";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An inline link in brand gold. `url` is inserted as-is. */
export function emailLink(url: string, label: string): string {
  return `<a href="${url}" style="color:${BRAND.gold};text-decoration:underline;">${label}</a>`;
}

/** A large monospace code block (one-time codes). */
export function emailCode(code: string): string {
  return `<div style="margin:8px 0 0;padding:16px;border:1px solid ${BRAND.bronze};border-radius:8px;background:${BRAND.navy};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:28px;letter-spacing:8px;text-align:center;color:${BRAND.foreground};">${code}</div>`;
}

function paragraph(html: string, color: string = BRAND.foreground): string {
  return `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:16px;line-height:26px;color:${color};">${html}</p>`;
}

function button(cta: EmailCta): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td align="center" bgcolor="${BRAND.gold}" style="border-radius:6px;background:${BRAND.gold};">
      <a href="${cta.url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT_BODY};font-size:16px;font-weight:700;line-height:20px;color:${BRAND.navy};text-decoration:none;border-radius:6px;">${cta.label}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:13px;line-height:20px;color:${BRAND.muted};">Button not working? Paste this link into your browser:<br><a href="${cta.url}" style="color:${BRAND.muted};text-decoration:underline;word-break:break-all;">${cta.url}</a></p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const footerLinks = [
    input.unsubscribeUrl ? emailLinkMuted(input.unsubscribeUrl, "Unsubscribe") : null,
    input.settingsUrl ? emailLinkMuted(input.settingsUrl, "Email settings") : null,
    emailLinkMuted(`${input.siteUrl}/privacy`, "Privacy"),
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${input.heading}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.navy};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.navy};font-size:1px;line-height:1px;">${input.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.navy}" style="background:${BRAND.navy};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td align="center" style="padding:0 0 24px;">
            <a href="${input.siteUrl}" target="_blank" style="text-decoration:none;">
              <img src="${input.siteUrl}/brand/pipglyph-medallion-512.png" width="64" height="64" alt="PipGlyph" style="display:block;border:0;outline:none;width:64px;height:64px;margin:0 auto 12px;">
              <span style="font-family:${FONT_DISPLAY};font-size:20px;font-weight:600;letter-spacing:4px;color:${BRAND.gold};">PipGlyph</span>
            </a>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRAND.surface}" style="background:${BRAND.surface};border:1px solid ${BRAND.bronze};border-radius:16px;padding:32px 28px 16px;">
            <h1 style="margin:0 0 20px;font-family:${FONT_DISPLAY};font-size:24px;line-height:32px;font-weight:600;color:${BRAND.foreground};">${input.heading}</h1>
            ${input.paragraphs.map((p) => paragraph(p)).join("\n            ")}
            ${input.cta ? button(input.cta) : ""}
            ${(input.after ?? []).join("\n            ")}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 12px 0;">
            <p style="margin:0 0 10px;font-family:${FONT_BODY};font-size:13px;line-height:20px;color:${BRAND.muted};">${input.footerNote}</p>
            <p style="margin:0 0 10px;font-family:${FONT_BODY};font-size:13px;line-height:20px;color:${BRAND.muted};">${footerLinks.join(" &nbsp;·&nbsp; ")}</p>
            ${input.postalAddress ? `<p style="margin:0 0 10px;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${BRAND.muted};">${input.postalAddress}</p>` : ""}
            <p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:17px;color:${BRAND.muted};">${EMAIL_DISCLAIMER}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

function emailLinkMuted(url: string, label: string): string {
  return `<a href="${url}" style="color:${BRAND.muted};text-decoration:underline;">${label}</a>`;
}

/** Secondary paragraph (muted) for the `after` slot. */
export function emailNote(html: string): string {
  return paragraph(html, BRAND.muted);
}

/** Plain-text alternative — every HTML email ships with one (spam filters
 *  penalise HTML-only mail, and some clients prefer it). */
export function renderEmailText(input: {
  heading: string;
  lines: string[];
  cta?: EmailCta;
  footerNote: string;
  unsubscribeUrl?: string;
  postalAddress?: string;
}): string {
  return [
    input.heading,
    "",
    ...input.lines,
    ...(input.cta ? ["", `${input.cta.label}: ${input.cta.url}`] : []),
    "",
    "—",
    input.footerNote,
    ...(input.unsubscribeUrl ? [`Unsubscribe: ${input.unsubscribeUrl}`] : []),
    ...(input.postalAddress ? [input.postalAddress] : []),
    EMAIL_DISCLAIMER,
  ].join("\n");
}
