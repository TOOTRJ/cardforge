import { getSiteBaseUrl } from "@/lib/site-url";
import {
  emailLink,
  emailNote,
  escapeHtml,
  renderEmailLayout,
  renderEmailText,
} from "@/lib/email/layout";
import { listUnsubscribeHeaders, unsubscribeLinks, type EmailList } from "@/lib/email/lists";
import type { OutgoingEmail } from "@/lib/email/send";

// ---------------------------------------------------------------------------
// Every app email, built on the one branded shell (lib/email/layout.ts).
// Each builder returns a complete OutgoingEmail: HTML + plain-text twin +
// the RFC 8058 one-click unsubscribe headers for its list. User-supplied text
// is escaped here — the layout trusts what it is given.
// ---------------------------------------------------------------------------

type Recipient = { email: string; unsubscribeToken: string };

function postalAddress(): string | undefined {
  // CAN-SPAM requires a physical postal address on commercial email.
  return process.env.EMAIL_POSTAL_ADDRESS?.trim() || undefined;
}

function footer(list: EmailList, recipient: Recipient, why: string) {
  const links = unsubscribeLinks(recipient.unsubscribeToken, list);
  return {
    footerNote: why,
    unsubscribeUrl: links.page,
    settingsUrl: links.settings,
    headers: listUnsubscribeHeaders(recipient.unsubscribeToken, list),
  };
}

// --- Welcome (account list) ---------------------------------------------------

export function welcomeEmail(
  recipient: Recipient,
  input: { displayName: string; username: string },
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer("account", recipient, "You're receiving this because you created a PipGlyph account.");
  const name = escapeHtml(input.displayName);
  const cta = { label: "Forge your first card", url: `${site}/create` };
  return {
    to: recipient.email,
    subject: "Welcome to PipGlyph",
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: "Your account is ready — here's where to start.",
      heading: `Welcome, ${name}`,
      paragraphs: [
        "Your account is ready. PipGlyph gives you precision mana pips, advanced text tools, and frames from three decades of card design — and the preview you see is exactly what you export.",
        `Your public profile lives at ${emailLink(`${site}/profile/${input.username}`, `pipglyph.com/profile/${escapeHtml(input.username)}`)}. Pin your three best cards there once you've made a few.`,
      ],
      cta,
      after: [
        emailNote(
          `Looking for ideas first? Browse the ${emailLink(`${site}/gallery`, "gallery")} or read the ${emailLink(`${site}/articles`, "design guides")}.`,
        ),
      ],
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: `Welcome, ${input.displayName}`,
      lines: [
        "Your PipGlyph account is ready.",
        `Your public profile: ${site}/profile/${input.username}`,
      ],
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
    }),
  };
}

// --- Team message (account list) ------------------------------------------------

export function teamMessageEmail(
  recipient: Recipient,
  input: { threadId: string; subject: string; body: string },
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because the PipGlyph team sent you a message.",
  );
  const preview = input.body.length > 600 ? `${input.body.slice(0, 600)}…` : input.body;
  const cta = { label: "Reply on PipGlyph", url: `${site}/messages/${input.threadId}` };
  return {
    to: recipient.email,
    subject: `[PipGlyph] ${input.subject}`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: preview.slice(0, 120),
      heading: escapeHtml(input.subject),
      paragraphs: [
        "The PipGlyph team sent you a message:",
        escapeHtml(preview).replace(/\n/g, "<br>"),
      ],
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: input.subject,
      lines: ["The PipGlyph team sent you a message:", "", preview],
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
    }),
  };
}

// --- Activity digest (activity list) -----------------------------------------------

export type DigestLine = { subject: string; body: string; href: string };

/** Lines shown in full; the rest collapse into "and N more". */
export const DIGEST_MAX_LINES = 12;

export function activityDigestEmail(
  recipient: Recipient,
  input: { lines: DigestLine[]; total: number },
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "activity",
    recipient,
    "You're receiving this weekly digest because there's unread activity on your PipGlyph account.",
  );
  const shown = input.lines.slice(0, DIGEST_MAX_LINES);
  const more = input.total - shown.length;
  const absolute = (href: string) => (href.startsWith("/") ? `${site}${href}` : `${site}/notifications`);
  const heading =
    input.total === 1 ? "1 new notification" : `${input.total} new notifications`;
  const cta = { label: "See all notifications", url: `${site}/notifications` };
  const settingsUrl = `${site}/settings#email`;
  // The opt-out is in the body, not only the footer: "Activity digest" is a
  // named switch in Settings → Email, and this points straight at it.
  const optOut = emailNote(
    `Don't want these round-ups? Turn off <strong>Activity digest</strong> in your ${emailLink(settingsUrl, "email settings")} — the bell on the site keeps working as usual.`,
  );
  return {
    to: recipient.email,
    subject: `${heading} on PipGlyph`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: shown
        .slice(0, 2)
        .map((line) => `${line.subject} ${line.body}`)
        .join(" ")
        .slice(0, 140),
      heading,
      paragraphs: [
        "Here's what happened since you last looked:",
        ...shown.map(
          (line) =>
            `<strong>${escapeHtml(line.subject)}</strong> ${escapeHtml(line.body)} ${emailLink(absolute(line.href), "View")}`,
        ),
        ...(more > 0 ? [`…and ${more} more.`] : []),
      ],
      cta,
      after: [optOut],
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading,
      lines: [
        ...shown.map((line) => `• ${line.subject} ${line.body} — ${absolute(line.href)}`),
        ...(more > 0 ? [`…and ${more} more.`] : []),
        "",
        `Don't want these round-ups? Turn off "Activity digest" in your email settings: ${settingsUrl}`,
      ],
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
    }),
  };
}

// --- Newsletter (newsletter list) ------------------------------------------------------

export type NewsletterContent = {
  kind: "update" | "upcoming";
  title: string;
  summary: string;
  body: string | null;
  linkHref: string | null;
};

export function newsletterEmail(recipient: Recipient, content: NewsletterContent): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "newsletter",
    recipient,
    "You're receiving this because you subscribed to the PipGlyph newsletter.",
  );
  const href = content.linkHref
    ? content.linkHref.startsWith("/")
      ? `${site}${content.linkHref}`
      : content.linkHref
    : `${site}/news`;
  const cta = {
    label: content.kind === "upcoming" ? "See what's coming" : "See what's new",
    url: href,
  };
  const bodyParagraphs = (content.body ?? "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return {
    to: recipient.email,
    subject: content.title,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: content.summary.slice(0, 140),
      heading: escapeHtml(content.title),
      paragraphs: [
        `<strong>${escapeHtml(content.summary)}</strong>`,
        ...bodyParagraphs.map((block) => escapeHtml(block).replace(/\n/g, "<br>")),
      ],
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
      postalAddress: postalAddress(),
    }),
    text: renderEmailText({
      heading: content.title,
      lines: [content.summary, "", ...bodyParagraphs],
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      postalAddress: postalAddress(),
    }),
  };
}
