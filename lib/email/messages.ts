import { getSiteBaseUrl } from "@/lib/site-url";
import { formatDateIn, formatUtcTime } from "@/lib/format/dates";
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

// --- Payment failed (account list) --------------------------------------------------

export type PaymentFailedEmailInput = {
  /** "Plus" | "Pro" — null when the plan isn't known. */
  plan: string | null;
  /** "$6.00". */
  amountLabel: string;
  /** ISO instant the dunning grace ends (perks kept until then) — null when
   *  the database doesn't know it yet. */
  graceUntil: string | null;
  /** ISO instant of Stripe's next automatic retry, or null (no more retries). */
  nextAttemptAt: string | null;
  hostedInvoiceUrl: string | null;
};

/** A renewal that didn't go through (lib/stripe/webhook-handlers.ts
 *  handlePaymentFailed): what failed, that the card is retried, that the
 *  perks stay on until the grace ends, and where to update the card. Dates
 *  are UTC with the time (a server-built string cannot know the reader's
 *  zone — docs/BILLING.md "billing dates in the viewer's time zone"). */
export function paymentFailedEmail(recipient: Recipient, input: PaymentFailedEmailInput): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer("account", recipient, "You're receiving this because a payment for your PipGlyph plan didn't go through.");
  const plan = input.plan ? escapeHtml(input.plan) : "plan";
  const amount = escapeHtml(input.amountLabel);
  const cta = { label: "Update your card", url: `${site}/dashboard/billing` };
  const grace = input.graceUntil ? `${formatDateIn(input.graceUntil, "long", "UTC")} (${formatUtcTime(input.graceUntil)})` : null;
  const retry = input.nextAttemptAt
    ? `We'll try your card again on ${formatDateIn(input.nextAttemptAt, "long", "UTC")}.`
    : "We'll try your card again automatically over the next two weeks.";
  const paragraphs = [
    `The <strong>${amount}</strong> payment for your <strong>${plan}</strong> plan didn't go through. ${retry}`,
    grace
      ? `Your ${plan} perks stay on until <strong>${escapeHtml(grace)}</strong>. If the card hasn't been charged by then, your account goes back to the free plan — your cards and decks are kept.`
      : `Your ${plan} perks are paused until the payment goes through; your cards and decks are kept.`,
    `To fix it now, update your card on the billing page${input.hostedInvoiceUrl ? `, or ${emailLink(input.hostedInvoiceUrl, "pay the invoice")} directly` : ""}. Nothing else changes.`,
  ];
  const heading = `Your ${input.plan ?? "plan"} payment didn't go through`;
  return {
    to: recipient.email,
    subject: `Your PipGlyph ${input.plan ?? "plan"} payment didn't go through`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: grace ? `Your perks stay on until ${formatDateIn(input.graceUntil!, "long", "UTC")} — update your card.` : "Your perks are paused — update your card to restore them.",
      heading,
      paragraphs,
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading,
      lines: paragraphs.map((p) => p.replace(/<[^>]+>/g, "")),
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
    /** The trial is one a COMP holds (lib/billing/comp-ending.ts
     *  isCompHeldTrial): its end is the end of the complimentary period. */
    compHold?: boolean;
    /** The comp's plan when it holds the trial ("Pro" over a Plus trial):
     *  named as the complimentary plan; `plan` is what is charged after. */
    compPlan?: string;
  },
): OutgoingEmail {
  if (input.compHold) return compHeldTrialEndingEmail(recipient, input);
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because your PipGlyph free trial is about to end.",
  );
  // An email cannot know its reader's time zone: the date is UTC (it was
  // the server's zone, unsaid), and the sentence that states the charge
  // carries the exact time and says "UTC" — in the Americas a trial ending
  // in the early UTC hours ends on the EVENING BEFORE that date, which is
  // the day the billing page shows.
  const date = formatDateIn(input.trialEndsAt, "long", "UTC");
  const at = ` (${formatUtcTime(input.trialEndsAt)})`;
  const plan = escapeHtml(input.plan);
  const price = input.priceLabel ? escapeHtml(input.priceLabel) : null;
  const cta = { label: "Open billing", url: `${site}/dashboard/billing` };
  const subject = input.hasPaymentMethod
    ? `Your PipGlyph ${input.plan} trial ends ${date}`
    : `Your PipGlyph ${input.plan} trial ends ${date} — add a card to keep it`;
  const paragraphs = input.hasPaymentMethod
    ? [
        `Your free ${plan} trial ends on <strong>${date}</strong>${at}. From then on your card is charged ${price ?? "the plan price"} and everything stays exactly as it is: your credits refill every month, downloads stay clean and hi-res, and your cards stay where they are.`,
        "Want to change plans or cancel first? Both take one click on the billing page — cancel any time before the date and you won't be charged.",
      ]
    : [
        `Your free ${plan} trial ends on <strong>${date}</strong>${at}. There's no card on your account yet, so the plan will simply end then — nothing is charged.`,
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

/** The held-trial paragraphs, shared by the trial reminder (compHold) and
 *  the 7-/1-day comp reminder so the two never disagree: the COMP's plan
 *  ends; the PAID plan (the subscription's own tier — lower when an admin
 *  comped a Plus trial Pro) is what is charged after it. */
function heldTrialParagraphs(input: {
  compPlan: string;
  paidPlan: string;
  date: string;
  at: string;
  price: string | null;
  card: string;
  hasPaymentMethod: boolean;
}): string[] {
  const comp = escapeHtml(input.compPlan);
  const paid = escapeHtml(input.paidPlan);
  const price = input.price ? escapeHtml(input.price) : "the plan price";
  const same = input.compPlan === input.paidPlan;
  const ends = `Your complimentary ${comp} period ends on <strong>${input.date}</strong>${input.at}.`;
  if (!input.hasPaymentMethod) {
    return [
      `${ends} There's no card on your account, so the plan simply ends then — nothing is charged.`,
      `To keep ${paid} (${price}), add a card before the date. Either way, every card you've made stays yours.`,
    ];
  }
  return [
    same
      ? `${ends} ${input.card} will be charged ${price} then, and ${paid} carries on exactly as it is.`
      : `${ends} After that you go back to ${paid} (${price}): ${input.card.charAt(0).toLowerCase()}${input.card.slice(1)} will be charged ${price} then.`,
    "Don't want to continue? Cancel on the billing page before that date and nothing is charged — every card you've made stays yours.",
  ];
}

/** The trial reminder for a trial a comp HOLDS: the end of the
 *  complimentary period, never "your trial". */
function compHeldTrialEndingEmail(
  recipient: Recipient,
  input: {
    plan: string;
    compPlan?: string;
    trialEndsAt: string;
    priceLabel: string | null;
    hasPaymentMethod: boolean;
  },
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because your complimentary PipGlyph plan is about to end.",
  );
  const compPlan = input.compPlan ?? input.plan;
  const date = formatDateIn(input.trialEndsAt, "long", "UTC");
  const at = ` (${formatUtcTime(input.trialEndsAt)})`;
  const cta = { label: "Open billing", url: `${site}/dashboard/billing` };
  const paragraphs = heldTrialParagraphs({
    compPlan,
    paidPlan: input.plan,
    date,
    at,
    price: input.priceLabel,
    card: "Your card",
    hasPaymentMethod: input.hasPaymentMethod,
  });
  return {
    to: recipient.email,
    subject: `Your complimentary PipGlyph ${compPlan} ends ${date}`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: input.hasPaymentMethod
        ? `Your card is charged ${input.priceLabel ?? "the plan price"} on ${date}.`
        : `Add a card before ${date} to keep ${input.plan}.`,
      heading: `Your complimentary ${escapeHtml(compPlan)} ends ${escapeHtml(date)}`,
      paragraphs,
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: `Your complimentary ${compPlan} ends ${date}`,
      lines: paragraphs.map((p) => p.replace(/<[^>]+>/g, "")),
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
    }),
  };
}

// --- Complimentary plan ending (account list) ----------------------------------------

export type CompEndingEmailInput = {
  kind: "free" | "held_trial" | "paying" | "plan_ending";
  /** "Plus" | "Pro" — the COMP's tier. */
  plan: string;
  /** "Plus" | "Pro" — the tier the live subscription PAYS for (null: none).
   *  Lower than `plan` when a payer was comped a higher tier: they go back. */
  paidPlan?: string | null;
  /** ISO end of the comp. */
  expiresAt: string;
  /** "$6 / month" — the live plan's price, when there is one. */
  priceLabel?: string | null;
  /** The next charge — only when it falls AFTER the comp's end. */
  nextChargeAt?: string | null;
  cardLast4?: string | null;
  /** A card (or other payment method) is on file (held trial). */
  hasPaymentMethod?: boolean;
  planEndsAt?: string | null;
};

/** "Your complimentary plan ends soon" — 7 days and 1 day before an admin
 *  comp ends (lib/billing/comp-ending-run.ts), one message per kind. */
export function compEndingEmail(recipient: Recipient, input: CompEndingEmailInput): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because your complimentary PipGlyph plan is about to end.",
  );
  const date = formatDateIn(input.expiresAt, "long", "UTC");
  const at = ` (${formatUtcTime(input.expiresAt)})`;
  const plan = escapeHtml(input.plan);
  const paidPlanName = input.paidPlan ?? input.plan;
  const paid = escapeHtml(paidPlanName);
  const goesBack = input.paidPlan != null && input.paidPlan !== input.plan;
  const price = input.priceLabel ? escapeHtml(input.priceLabel) : null;
  const billing = { label: "Open billing", url: `${site}/dashboard/billing` };
  let paragraphs: string[];
  let cta = billing;
  let preheader: string;
  if (input.kind === "held_trial") {
    const hasCard = input.hasPaymentMethod !== false;
    const card = input.cardLast4 ? `Your card ending ••${escapeHtml(input.cardLast4)}` : "Your card on file";
    paragraphs = heldTrialParagraphs({
      compPlan: input.plan,
      paidPlan: paidPlanName,
      date,
      at,
      price: input.priceLabel ?? null,
      card,
      hasPaymentMethod: hasCard,
    });
    preheader = hasCard
      ? `${input.cardLast4 ? `Card ••${input.cardLast4}` : "Your card"} is charged ${input.priceLabel ?? "the plan price"} on ${date}.`
      : `No card on file: ${input.plan} simply ends on ${date}.`;
  } else if (input.kind === "paying") {
    const next = input.nextChargeAt ? formatDateIn(input.nextChargeAt, "long", "UTC") : null;
    const opening = goesBack
      ? `Your complimentary ${plan} ends on <strong>${date}</strong>${at}, and you go back to ${paid}${price ? ` (${price})` : ""}.`
      : `Your complimentary ${plan} period ends on <strong>${date}</strong>${at}.`;
    // The next charge can fall INSIDE the comp (the balance credit then
    // reduces it): a date is named only when it is after the comp's end.
    const charge = next
      ? `Your next invoice, on <strong>${next}</strong>, is charged as usual${price ? ` (${price})` : ""}, less any comp credit still on your balance.`
      : `Invoices after ${date} are charged as usual${price ? ` (${price})` : ""}; any comp credit still on your balance comes off first.`;
    paragraphs = [
      `${opening} ${charge}`,
      goesBack
        ? `Your ${paid} plan, credits and cards carry on from there. Plan and payment details are on the billing page.`
        : "Nothing else changes: your plan, credits and cards stay exactly as they are. Plan and payment details are on the billing page.",
    ];
    preheader = goesBack
      ? `After ${date} you go back to ${paidPlanName}.`
      : next
        ? `Your next invoice on ${next} is charged as usual.`
        : `Invoices after ${date} are charged as usual.`;
  } else if (input.kind === "plan_ending") {
    const ends = input.planEndsAt ? formatDateIn(input.planEndsAt, "long", "UTC") : null;
    paragraphs = [
      `Your complimentary ${plan} period ends on <strong>${date}</strong>${at}. ${
        goesBack ? `You go back to ${paid} until your plan ends` : "Your plan is cancelled and ends"
      }${ends ? ` on <strong>${ends}</strong>` : " on its own date"}; nothing more is charged.`,
      "Changed your mind? You can resume the plan on the billing page. Either way, every card you've made stays yours.",
    ];
    preheader = `Your complimentary ${input.plan} ends on ${date}.`;
  } else {
    paragraphs = [
      `Your complimentary ${plan} ends on <strong>${date}</strong>${at}. After that you'll be on Free.`,
      "You keep everything you've made: every card and deck stays yours, and so do any AI credits left on your account. Free's limits apply from then on — fewer saved cards, and watermarked downloads.",
      `Want to keep ${plan}? Choose a plan on the billing page before the date and nothing changes.`,
    ];
    cta = { label: `Keep ${input.plan}`, url: `${site}/dashboard/billing` };
    preheader = `After ${date} you'll be on Free — choose a plan to keep ${input.plan}.`;
  }
  return {
    to: recipient.email,
    subject: `Your complimentary PipGlyph ${input.plan} ends ${date}`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader,
      heading: `Your complimentary ${plan} ends ${escapeHtml(date)}`,
      paragraphs,
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: `Your complimentary ${input.plan} ends ${date}`,
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
  const help = emailLink(`${site}/help/ai-and-credits#credits-and-plans`, "The help centre");
  if (input.kind === "pack") {
    const cta = { label: "Get the credits", url: `${site}/dashboard/billing#packs` };
    const paragraphs = [
      `You started buying <strong>${input.credits} AI credits</strong>${price ? ` (${price})` : ""} but the checkout wasn't completed, so nothing was charged.`,
      "Purchased credits never expire and stack with any plan credits — pick them up whenever you're ready.",
      `Something go wrong at checkout? ${help} covers plans and credits, and you can message us from your dashboard.`,
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
      ? `Your <strong>7-day free trial</strong> is still waiting — nothing is charged until it ends, and you can cancel in one click before then. ${plan} means more monthly AI credits, clean hi-res downloads and more room for your cards.`
      : `${plan} means more monthly AI credits, clean hi-res downloads and more room for your cards — and you can cancel any time.`,
    `Something go wrong at checkout? ${help} covers plans and credits, and you can message us from your dashboard.`,
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

// --- Trial win-back (account list) -------------------------------------------------

/** A trial ended without converting. One offer, once: a percentage off the
 *  first month, applied automatically at checkout until `expiresAt`. */
export function trialWinbackEmail(
  recipient: Recipient,
  input: {
    /** "Plus" | "Pro" */
    plan: string;
    discountPct: number;
    /** ISO timestamp the offer ends. */
    expiresAt: string;
    /** "$15 / month" — null when unknown. */
    priceLabel: string | null;
    /** "$12 for the first month" — null when unknown. */
    discountedPriceLabel: string | null;
  },
): OutgoingEmail {
  const site = getSiteBaseUrl();
  const f = footer(
    "account",
    recipient,
    "You're receiving this because your PipGlyph free trial ended.",
  );
  const date = formatDateIn(input.expiresAt, "long", "UTC");
  const plan = escapeHtml(input.plan);
  const cta = { label: `Come back to ${input.plan}`, url: `${site}/dashboard/billing#plans` };
  const offer = input.discountedPriceLabel
    ? `<strong>${input.discountPct}% off your first month</strong> — ${escapeHtml(input.discountedPriceLabel)}${input.priceLabel ? ` instead of ${escapeHtml(input.priceLabel)}` : ""}`
    : `<strong>${input.discountPct}% off your first month</strong>`;
  const paragraphs = [
    `Your free ${plan} trial has ended and nothing was charged. Every card you made is still yours, and you're back on the free plan.`,
    `If ${plan} wasn't quite right yet, here's ${offer}. It's applied automatically when you subscribe before <strong>${date}</strong> — no code to enter.`,
    `${plan} means monthly AI credits, clean hi-res downloads and print-ready PDFs — and you can cancel any time.`,
  ];
  return {
    to: recipient.email,
    subject: `${input.discountPct}% off your first month of PipGlyph ${input.plan}`,
    headers: f.headers,
    html: renderEmailLayout({
      siteUrl: site,
      preheader: `Your trial ended — come back by ${date} for ${input.discountPct}% off.`,
      heading: `Come back to ${plan} for ${input.discountPct}% off`,
      paragraphs,
      cta,
      footerNote: f.footerNote,
      unsubscribeUrl: f.unsubscribeUrl,
      settingsUrl: f.settingsUrl,
    }),
    text: renderEmailText({
      heading: `Come back to ${input.plan} for ${input.discountPct}% off`,
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
