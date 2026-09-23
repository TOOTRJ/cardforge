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

// --- Trial ending (account list) ---------------------------------------------------

export function trialEndingEmail(
  recipient: Recipient,
  input: {
    /** "Plus" | "Pro" */
    plan: string;
    /** ISO timestamp of the trial's end. */
    trialEndsAt: string;
    /** A card (or other payment method) is on file — the plan converts. */
    hasPaymentMethod: boolean;
    /** "$6 / month" — null when the price isn't known. */
    priceLabel: string | null;
  },
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because your PipGlyph free trial is about to end.",
  );
  const date = new Date(input.trialEndsAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const plan = escapeHtml(input.plan);
  const price = input.priceLabel ? escapeHtml(input.priceLabel) : null;
  const cta = { label: "Open billing", url: `${site}/dashboard/billing` };
  const subject = input.hasPaymentMethod
    ? `Your PipGlyph ${input.plan} trial ends ${date}`
    : `Your PipGlyph ${input.plan} trial ends ${date} — add a card to keep it`;
  const paragraphs = input.hasPaymentMethod
    ? [
        `Your free ${plan} trial ends on <strong>${date}</strong>. From then on your card is charged ${price ?? "the plan price"} and everything stays exactly as it is: your credits refill every month, downloads stay clean and hi-res, and your cards stay where they are.`,
        "Want to change plans or cancel first? Both take one click on the billing page — cancel any time before the date and you won't be charged.",
      ]
    : [
        `Your free ${plan} trial ends on <strong>${date}</strong>. There's no card on your account yet, so the plan will simply end then — nothing is charged.`,
        `To keep ${plan}${price ? ` (${price})` : ""}, add a card before the date. Either way, every card you've made stays yours.`,
      ];
  return {
    to: recipient.email,
    subject,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: input.hasPaymentMethod
        ? `Your ${input.plan} trial converts on ${date}.`
        : `Add a card before ${date} to keep ${input.plan}.`,
      heading: `Your ${plan} trial ends ${escapeHtml(date)}`,
      paragraphs,
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: `Your ${input.plan} trial ends ${date}`,
      lines: paragraphs.map((p) => p.replace(/<[^>]+>/g, "")),
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
    }),
  };
}

// --- Checkout reminder (account list) ----------------------------------------------

export type CheckoutReminderInput =
  | {
      kind: "subscription";
      /** "Plus" | "Pro" */
      plan: string;
      /** "$6 / month" — null when unknown. */
      priceLabel: string | null;
      /** Still eligible for the no-card trial. */
      trialEligible: boolean;
    }
  | { kind: "pack"; credits: number; priceLabel: string | null };

/** A Checkout session expired unfinished (24 h after it opened). One nudge,
 *  transactional in tone: where they left off, what it costs, one button.
 *  The handler sends at most one of these per user per 30 days. */
export function checkoutReminderEmail(
  recipient: Recipient,
  input: CheckoutReminderInput,
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because you started a checkout on PipGlyph that wasn't completed.",
  );
  const price = input.priceLabel ? escapeHtml(input.priceLabel) : null;
  const faq = emailLink(`${site}/faq`, "the FAQ");
  if (input.kind === "pack") {
    const cta = { label: "Get the credits", url: `${site}/dashboard/billing#packs` };
    const paragraphs = [
      `You started buying <strong>${input.credits} AI credits</strong>${price ? ` (${price})` : ""} but the checkout wasn't completed, so nothing was charged.`,
      "Purchased credits sit alongside your monthly refill and never expire — pick them up whenever you're ready.",
      `Something go wrong at checkout? ${faq} covers plans and billing, and you can message us from your dashboard.`,
    ];
    return {
      to: recipient.email,
      subject: `Your ${input.credits} PipGlyph credits are waiting`,
      headers: f.headers,
      html: renderEmailLayout({
        siteUrl: site,
        preheader: "Nothing was charged — finish the top-up whenever you like.",
        heading: "Your credits are waiting",
        paragraphs,
        cta,
        footerNote: f.footerNote,
        unsubscribeUrl: f.unsubscribeUrl,
        settingsUrl: f.settingsUrl,
      }),
      text: renderEmailText({
        heading: "Your credits are waiting",
        lines: paragraphs.map((p) => p.replace(/<[^>]+>/g, "")),
        cta,
        footerNote: f.footerNote,
        unsubscribeUrl: f.unsubscribeUrl,
      }),
    };
  }
  const plan = escapeHtml(input.plan);
  const cta = {
    label: input.trialEligible ? `Start the ${input.plan} trial` : `Finish upgrading to ${input.plan}`,
    url: `${site}/dashboard/billing#plans`,
  };
  const paragraphs = [
    `You started upgrading to <strong>${plan}</strong>${price ? ` (${price})` : ""} but the checkout wasn't completed, so nothing was charged.`,
    input.trialEligible
      ? `Your <strong>7-day free trial</strong> is still waiting — no card needed to start it, and if you don't add one it simply ends. ${plan} means more monthly AI credits, clean hi-res downloads and more room for your cards.`
      : `${plan} means more monthly AI credits, clean hi-res downloads and more room for your cards — and you can cancel any time.`,
    `Something go wrong at checkout? ${faq} covers plans and billing, and you can message us from your dashboard.`,
  ];
  return {
    to: recipient.email,
    subject: input.trialEligible
      ? `Your PipGlyph ${input.plan} trial is still waiting`
      : `Finish upgrading to PipGlyph ${input.plan}`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: "Nothing was charged — pick up where you left off.",
      heading: input.trialEligible ? `Your ${plan} trial is waiting` : `Finish upgrading to ${plan}`,
      paragraphs,
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: input.trialEligible ? `Your ${input.plan} trial is waiting` : `Finish upgrading to ${input.plan}`,
      lines: paragraphs.map((p) => p.replace(/<[^>]+>/g, "")),
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
    }),
  };
}

// --- Activity digest (activity list) -----------------------------------------------

export type DigestLine = { subject: string; body: string; href: string };

/** Lines shown in full; the rest collapse into "and N more". */
const DIGEST_MAX_LINES = 12;

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
