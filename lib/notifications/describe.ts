import { formatShortDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// One source of copy + deep link for every notification kind. Shared by the
// header bell, the /notifications page and the real-time toast so the three
// never drift (they used to carry three hand-written copies of the same
// ternary chain). Client-safe: no server imports.
// ---------------------------------------------------------------------------

export type NotificationPayload = Record<string, unknown>;

export type DescribableNotification = {
  type: string;
  actor: { username: string | null; displayName: string | null } | null;
  card: { slug: string; title: string; ownerUsername: string | null } | null;
  threadId: string | null;
  payload?: NotificationPayload | null;
};

export type NotificationDescription = {
  /** Who/what the line is about — rendered bold. */
  subject: string;
  /** The rest of the sentence, including the trailing period. */
  body: string;
  /** Where clicking the entry goes. */
  href: string;
};

const VERB: Record<string, string> = {
  like: "liked",
  comment: "commented on",
  remix: "remixed",
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}


const TIER_LABEL: Record<string, string> = { plus: "Plus", pro: "Pro" };

export function describeNotification(
  item: DescribableNotification,
  opts: { isAdmin: boolean },
): NotificationDescription {
  const { isAdmin } = opts;
  const actorName =
    item.actor?.displayName ||
    (item.actor?.username ? `@${item.actor.username}` : "Someone");
  const payload = item.payload ?? {};

  switch (item.type) {
    case "message":
      return {
        subject: isAdmin ? actorName : "PipGlyph team",
        body: isAdmin ? "replied in a conversation." : "sent you a message.",
        href: item.threadId
          ? `${isAdmin ? "/admin/messages" : "/messages"}/${item.threadId}`
          : isAdmin
            ? "/admin/messages"
            : "/messages",
      };
    case "feedback":
      return {
        subject: actorName,
        body: "sent feedback — open the inbox.",
        href: "/admin/feedback",
      };
    case "moderation":
      return {
        subject: actorName,
        body: "filed a content report.",
        href: "/admin/moderation",
      };
    case "follow":
      return {
        subject: actorName,
        body: "started following you.",
        href: item.actor?.username ? `/profile/${item.actor.username}` : "#",
      };
    case "credit_grant": {
      const amount = num(payload.amount);
      const balance = num(payload.balance);
      const note = str(payload.note);
      return {
        subject: "PipGlyph team",
        body: `added ${amount ?? "some"} AI credit${amount === 1 ? "" : "s"} to your account${
          balance != null ? ` — you now have ${balance}` : ""
        }${note ? ` (${note})` : ""}.`,
        href: "/dashboard/usage",
      };
    }
    case "comp_plan": {
      const tier = str(payload.tier);
      const expiresAt = str(payload.expiresAt);
      const days = num(payload.days);
      const holdEndsAt = str(payload.holdEndsAt);
      const was = str(payload.was);
      const revoked = num(payload.revoked) === 1;
      const name = tier ? (TIER_LABEL[tier] ?? tier) : "";
      // Free 30 days (0176): the days are ADDED to a live plan's paid time —
      // the next charge moves; a trial runs longer. Never "your trial".
      const held = holdEndsAt
        ? was === "trialing"
          ? ` Your free trial now runs until ${formatShortDate(holdEndsAt)}; nothing is charged before then.`
          : ` They're added to the time you've paid for: your next charge moves to ${formatShortDate(holdEndsAt)}.`
        : "";
      let body: string;
      if (!tier) body = "ended your complimentary plan access.";
      else if (revoked) body = `shortened your complimentary ${name} access — it now ends ${expiresAt ? formatShortDate(expiresAt) : "soon"}.`;
      else if (days != null && days > 0) {
        body = `gave you ${days} free days of ${name}${expiresAt ? ` — until ${formatShortDate(expiresAt)}` : ""} — enjoy.${held}`;
      } else {
        // The legacy shape (a comp set before 0176), and an open-ended grant.
        const trialEnd = str(payload.trialEnd);
        body = `gave you ${name} plan access${expiresAt ? ` until ${formatShortDate(expiresAt)}` : ""} — enjoy.${
          trialEnd ? ` Your free trial now runs until ${formatShortDate(trialEnd)}; nothing is charged before then.` : ""
        }`;
      }
      return {
        subject: "PipGlyph team",
        body,
        href: "/settings",
      };
    }
    case "banked_days": {
      // The admin's comp since 0179: days in the bank, the user applies them.
      const days = num(payload.days) ?? 0;
      const note = str(payload.note);
      const revoked = num(payload.revoked) === 1;
      const d = `${days} free day${days === 1 ? "" : "s"}`;
      return {
        subject: "PipGlyph team",
        body: revoked
          ? `took back ${d} from your bank${note ? ` (${note})` : ""}.`
          : `banked ${d} for you${note ? ` (${note})` : ""} — start a plan and they're its free period, or apply them to the plan you have, any time from your billing page.`,
        href: "/dashboard/billing#banked-days",
      };
    }
    case "tool_access": {
      // A tester let into a beta tool (0182, /admin/tools).
      const name = str(payload.toolName) ?? "a new tool";
      const slug = str(payload.tool);
      const built = payload.built === true;
      return {
        subject: "PipGlyph team",
        body: built
          ? `gave you early access to ${name}. It's on your Tools page — tell us what you think.`
          : `added you to the ${name} beta. It opens on your Tools page as soon as it's ready.`,
        href: built && slug ? `/dashboard/tools/${slug}` : "/dashboard/tools",
      };
    }
    case "render_update": {
      const count = num(payload.count);
      return {
        subject: "PipGlyph team",
        body: `updated the card frames — ${count ?? "some"} of your cards ${
          count === 1 ? "has" : "have"
        } a newer look available. Compare each one and choose whether to update it.`,
        href: "/dashboard?update-cards=1",
      };
    }
    case "site_update": {
      const title = str(payload.title);
      const summary = str(payload.summary);
      const link = str(payload.link);
      const upcoming = str(payload.kind) === "upcoming";
      return {
        subject: "PipGlyph team",
        body: `${upcoming ? "teased what's coming next" : "shipped something new"}: ${title ?? "a site update"}${
          summary ? ` — ${summary}` : ""
        }`,
        href: link && (link.startsWith("/") || link.startsWith("https://")) ? link : "/news",
      };
    }
    case "referral_signup": {
      // A friend who joined through the recipient's link saved their first
      // card with a confirmed email but earned the recipient NO reward — sent
      // only then (0177; the rewarded case is the referral_reward row).
      // Never a fraud reason.
      const outcome = str(payload.outcome);
      const why =
        outcome === "capped_month"
          ? "You've reached this month's referral limit, so this one adds no reward for you — they still get theirs."
          : outcome === "capped_lifetime"
            ? "You've earned every reward the program gives, so this one adds none for you — they still get theirs."
            : outcome === "capped_friends"
              ? "You've reached this month's limit of rewarded friends, so this one earns no reward on either side."
              : "This referral isn't eligible for a reward.";
      return {
        subject: actorName,
        body: `joined PipGlyph with your referral link and qualified (cards saved, a plan started). ${why}`,
        href: "/dashboard/referrals",
      };
    }
    case "referral_reward": {
      // One reward, either side of a referral (lib/referrals/server.ts).
      // Since 0180: DAYS INTO THE BANK (lib/billing/day-bank.ts — applied at
      // the friend's qualifying checkout, or by the user from their billing
      // page) or AI credits; the referrer's carries their ladder step. The
      // older shape (free days of a tier, 0177) still reads.
      const side = str(payload.side);
      const reward = str(payload.reward);
      const until = str(payload.until);
      const holdEndsAt = str(payload.holdEndsAt);
      const days = num(payload.days);
      const credits = num(payload.credits);
      const step = num(payload.step);
      const tierName = TIER_LABEL[str(payload.tier) ?? ""] ?? "Plus";
      const nth = step != null ? ` — referral #${step}` : "";
      if (reward === "banked_days") {
        const d = `${days ?? 0} free day${days === 1 ? "" : "s"}`;
        return side === "referee"
          ? {
              subject: actorName,
              body: `invited you to PipGlyph — ${d} are in your bank for saving your first cards and starting a plan. They're your plan's free time; apply them any time from your billing page.`,
              href: "/dashboard/billing#banked-days",
            }
          : {
              subject: actorName,
              body: `saved their first cards and started a plan${nth} — ${d} are in your bank. Apply them to a plan any time from your billing page. Thanks for spreading the word!`,
              href: "/dashboard/referrals",
            };
      }
      const what =
        reward === "credits" && credits != null
          ? `${credits} AI credit${credits === 1 ? "" : "s"}`
          : `${days ?? 30} free days of ${tierName}${until ? ` (until ${formatShortDate(until)})` : ""}${
              holdEndsAt ? " — added to the time you've paid for" : ""
            }`;
      return side === "referee"
        ? {
            subject: actorName,
            body: `invited you to PipGlyph — you've earned ${what} for saving your first card.`,
            href: "/dashboard/billing",
          }
        : {
            subject: actorName,
            body: step != null
              ? `saved their first cards and started a plan${nth} — you've earned ${what}. Thanks for spreading the word!`
              : `saved their first card — you've earned ${what}. Thanks for spreading the word!`,
            href: "/dashboard/referrals",
          };
    }
    case "deck_like": {
      // Someone liked your PUBLIC deck — once per liker and deck (0149).
      const title = str(payload.title);
      const slug = str(payload.slug);
      return {
        subject: actorName,
        body: `liked your deck${title ? ` "${title}"` : ""}.`,
        href: slug ? `/deck/${slug}` : "/dashboard/decks",
      };
    }
    case "challenge_winner": {
      // Your card placed in a closed design challenge (TODO NV12, 0172) —
      // ONE row per challenge and card, its place kept current by the
      // database. The line is about the card; an admin's click has no actor.
      const title = str(payload.title);
      const slug = str(payload.slug);
      const place = num(payload.place);
      const ordinal = place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : null;
      const won = ordinal ? `won ${ordinal} place` : "is a winner";
      return {
        subject: item.card?.title ? `Your card ${item.card.title}` : "Your card",
        body: `${won} in the ${title ? `"${title}" ` : ""}design challenge.`,
        href: slug ? `/challenges/${slug}` : "/challenges",
      };
    }
    case "deck_cloned": {
      // Someone copied your deck into their own (TODO DK5.16, 0164) — once
      // per copier and deck. The payload names YOUR deck; the copy starts
      // private, so the link is your deck's page.
      const title = str(payload.title);
      const slug = str(payload.slug);
      return {
        subject: actorName,
        body: `copied your deck${title ? ` "${title}"` : ""} to remix it.`,
        href: slug ? `/deck/${slug}` : "/dashboard/decks",
      };
    }
    case "deck_card_added": {
      // Another creator's public deck now holds your cards (D3) — ONE row
      // per deck, its cards merged in (0149: payload.cardIds / count; the
      // row's card is the card when there is one), by the card page's own
      // rule.
      const title = str(payload.title);
      const slug = str(payload.slug);
      const count = num(payload.count) ?? (Array.isArray(payload.cardIds) ? payload.cardIds.length : 1);
      const deck = title ? `"${title}"` : "their deck";
      const what =
        count > 1
          ? `${count.toLocaleString("en-US")} of your cards`
          : item.card
            ? item.card.title
            : "your card";
      return {
        subject: actorName,
        body: `added ${what} to ${deck}.`,
        href: slug
          ? `/deck/${slug}`
          : count <= 1 && item.card && item.card.ownerUsername
            ? `/card/${item.card.ownerUsername}/${item.card.slug}`
            : "/dashboard/cards",
      };
    }
    case "deck_generated": {
      const title = str(payload.title);
      const slug = str(payload.slug);
      const done = num(payload.done);
      const failed = num(payload.failed);
      return {
        subject: "Your deck",
        body: `${title ? `"${title}" ` : ""}finished generating — ${done ?? "the"} card${done === 1 ? "" : "s"} ready${
          failed ? `, ${failed} need${failed === 1 ? "s" : ""} a retry` : ""
        }.`,
        href: slug ? `/deck/${slug}` : "/dashboard/decks",
      };
    }
    case "trial_ending": {
      const tier = str(payload.tier);
      const trialEnd = str(payload.trialEnd);
      const hasPaymentMethod = payload.hasPaymentMethod === true;
      if (payload.compHold === true) {
        // The trial a comp HOLDS (lib/billing/comp-ending.ts isCompHeldTrial):
        // its end is the end of the complimentary period — never "a trial".
        const amount = num(payload.amountCents);
        const interval = str(payload.interval);
        const price =
          amount != null ? `${formatMoney(amount, str(payload.currency) ?? "usd")}${interval ? ` / ${interval}` : ""}` : null;
        // The COMP's plan is what ends; `tier` (the subscription's) is what
        // is charged after — lower when a Plus trial was comped Pro.
        const paid = TIER_LABEL[tier ?? ""] ?? "your plan";
        const comp = TIER_LABEL[str(payload.compTier) ?? ""] ?? paid;
        return {
          subject: `Your complimentary ${comp}`,
          body: `ends ${trialEnd ? `on ${formatShortDate(trialEnd)}` : "soon"} — ${
            hasPaymentMethod
              ? `${comp !== paid ? `you go back to ${paid} and ` : ""}your card is charged ${price ?? "the plan price"} then; change or cancel any time before.`
              : "add a card to keep the plan, or it simply ends and your cards stay."
          }`,
          href: "/dashboard/billing",
        };
      }
      return {
        subject: `Your ${TIER_LABEL[tier ?? ""] ?? "plan"} trial`,
        body: `ends ${trialEnd ? `on ${formatShortDate(trialEnd)}` : "soon"} — ${
          hasPaymentMethod
            ? "your card is charged then; change or cancel any time."
            : "add a card to keep the plan, or it simply ends and your cards stay."
        }`,
        href: "/dashboard/billing",
      };
    }
    case "payment_received": {
      const amount = num(payload.amountCents);
      const money = amount != null ? formatMoney(amount, str(payload.currency) ?? "usd") : "Your payment";
      const plan = TIER_LABEL[str(payload.tier) ?? ""] ?? null;
      const reason = str(payload.billingReason);
      if (reason === "subscription_cycle" && plan) {
        return {
          subject: `Your ${plan} plan`,
          body: `renewed — ${money} charged.`,
          href: "/dashboard/billing",
        };
      }
      return {
        subject: "Payment received",
        body:
          reason === "subscription_update" && plan
            ? `${money} for your switch to ${plan} — thanks!`
            : plan
              ? `${money} for ${plan} — thanks! Your receipt is on the billing page.`
              : `${money} — thanks! Your receipt is on the billing page.`,
        href: "/dashboard/billing",
      };
    }
    case "payment_failed": {
      // A renewal that didn't go through (0174): the perks stay on through
      // the dunning grace; the fix is the card on the billing page.
      const amount = num(payload.amountCents);
      const money = amount != null ? formatMoney(amount, str(payload.currency) ?? "usd") : "Your payment";
      const plan = TIER_LABEL[str(payload.tier) ?? ""] ?? "plan";
      const grace = str(payload.graceUntil);
      const next = str(payload.nextAttemptAt);
      return {
        subject: `Your ${plan} payment`,
        body: `of ${money} didn't go through — ${next ? `we'll try your card again on ${formatShortDate(next)}` : "we'll retry your card automatically"}; your ${plan} perks ${grace ? `stay on until ${formatShortDate(grace)}` : "are paused until it's paid"}. Update your card${grace ? " to be safe" : " to restore them"}.`,
        href: "/dashboard/billing",
      };
    }
    case "billing_alert": {
      // Admin-only: money going back (lib/stripe/charge-events.ts).
      const alert = str(payload.alert);
      const amount = num(payload.amountCents);
      const money = amount != null ? formatMoney(amount, str(payload.currency) ?? "usd") : "a payment";
      const userId = str(payload.userId);
      const href = isUuid(userId) ? `/admin/users?u=${userId}` : "/admin/users";
      const sale =
        str(payload.saleKind) === "pack" ? "a credit pack" : str(payload.saleKind) === "invoice" ? "a plan invoice" : "an unmatched charge";
      const credits = num(payload.creditsDelta) ?? 0;
      const creditsNote =
        credits < 0 ? ` ${-credits} unspent credits taken back.` : credits > 0 ? ` ${credits} credits given back.` : "";
      const who = isUuid(userId) ? "" : " (no account matched — see Stripe)";
      if (alert === "refund") {
        return { subject: "Refund", body: `of ${money} on ${sale}${who}.${creditsNote}`, href };
      }
      if (alert === "dispute_closed") {
        const status = str(payload.disputeStatus) ?? "closed";
        return {
          subject: "Dispute closed",
          body: `${status === "won" ? "won" : status === "lost" ? "LOST" : status} — ${money} on ${sale}${who}.${creditsNote}`,
          href,
        };
      }
      if (alert === "fraud_warning") {
        return {
          subject: "Early fraud warning",
          body: `from the card network on ${money} (${sale})${who}${str(payload.disputeReason) ? ` — ${str(payload.disputeReason)}` : ""}. Expect a dispute; consider a refund now.`,
          href,
        };
      }
      return {
        subject: "Dispute opened",
        body: `on ${money} (${sale})${who}${str(payload.disputeReason) ? ` — ${str(payload.disputeReason)}` : ""}. Respond in Stripe.${creditsNote}`,
        href,
      };
    }
    case "trial_lapsed": {
      // A trial that never converted, or (BA6) a payer whose plan ended:
      // one win-back offer per account, monthly plans only.
      const plan = TIER_LABEL[str(payload.tier) ?? ""] ?? "plan";
      const pct = num(payload.discountPct) ?? 20;
      const expires = str(payload.expiresAt);
      const cancelled = str(payload.reason) === "cancelled";
      return {
        subject: cancelled ? `Your ${plan} plan` : `Your ${plan} trial`,
        body: `ended — come back${expires ? ` by ${formatShortDate(expires)}` : " within 30 days"} for ${pct}% off your first month${cancelled ? " back" : ""} on a monthly plan; the discount is applied automatically at checkout.`,
        href: "/dashboard/billing#plans",
      };
    }
    case "checkout_reminder": {
      if (str(payload.kind) === "pack") {
        const credits = num(payload.packCredits);
        return {
          subject: "Your credit top-up",
          body: `wasn't finished — ${credits ? `${credits} credits are` : "your credits are"} one click away.`,
          href: "/dashboard/billing#packs",
        };
      }
      const plan = TIER_LABEL[str(payload.tier) ?? ""] ?? "plan";
      return {
        subject: `Your ${plan} checkout`,
        body: payload.trialEligible === true
          ? "wasn't finished — your banked free days are still waiting; nothing is charged until they end, cancel anytime."
          : "wasn't finished — pick up where you left off whenever you're ready.",
        href: "/dashboard/billing#plans",
      };
    }
    case "render_sweep_paused": {
      // Admin-only: the automatic re-bake's breaker (lib/cards/auto-rebake.ts).
      const reason = str(payload.reason);
      return {
        subject: "Automatic re-bake",
        body: `paused itself${reason ? ` — ${reason}` : ""}. Check the failures, then resume it.`,
        href: "/admin/renders",
      };
    }
    case "credit_refill_failed": {
      // Admin-only: a subscription credit grant failed
      // (lib/billing/credit-alerts.ts — the refill cron or invoice.paid).
      const error = str(payload.error);
      if (str(payload.source) === "invoice") {
        const userId = str(payload.userId);
        const invoiceId = str(payload.invoiceId);
        return {
          subject: "Credit grant failed",
          body: `on a paid invoice${invoiceId ? ` (${invoiceId})` : ""}${error ? ` — ${error}` : ""}. Plan credits are one-time: run scripts/grant-plan-credits-once.mjs (keyed — it grants nothing twice), never a hand grant, which the next paid invoice would double.`,
          href: isUuid(userId) ? `/admin/users?u=${userId}` : "/admin/users",
        };
      }
      const failed = num(payload.failed) ?? 0;
      const pageError = str(payload.pageError);
      const what = [
        failed > 0 ? `${failed.toLocaleString("en-US")} grant${failed === 1 ? "" : "s"} failed` : null,
        pageError ? `a profiles read failed (${pageError})` : null,
      ]
        .filter(Boolean)
        .join(" and ");
      return {
        subject: "Credit refill",
        body: `${what || "failed"}${error ? ` — ${error}` : ""}. Tomorrow's run retries; check the function logs.`,
        href: "/admin/users",
      };
    }
    case "comp_ending": {
      // The daily comp-ending cron (lib/billing/comp-ending-run.ts), 7 days
      // and 1 day before an admin comp ends; one copy per kind. `tier` is the
      // COMP's plan (what ends); `subscribedTier` the live plan's — what they
      // go back to, named whenever it differs.
      const tier = TIER_LABEL[str(payload.tier) ?? ""] ?? "plan";
      const paidTier = TIER_LABEL[str(payload.subscribedTier) ?? ""] ?? null;
      const goesBack = paidTier != null && paidTier !== tier;
      const expiresAt = str(payload.expiresAt);
      const ends = expiresAt ? `on ${formatShortDate(expiresAt)}` : "soon";
      const price = str(payload.priceLabel);
      const back = goesBack ? ` you go back to ${paidTier}${price ? ` (${price})` : ""};` : "";
      const kind = str(payload.kind);
      if (kind === "held_trial") {
        if (payload.hasPaymentMethod === false) {
          return {
            subject: `Your complimentary ${tier}`,
            body: `ends ${ends}. There's no card on your account, so the plan simply ends then — nothing is charged. Add a card on the billing page to keep ${paidTier ?? tier}.`,
            href: "/dashboard/billing",
          };
        }
        const last4 = str(payload.cardLast4);
        return {
          subject: `Your complimentary ${tier}`,
          body: `ends ${ends};${back || " then"} ${last4 ? `your card ending ••${last4}` : "your card on file"} will be charged ${
            price ?? "the plan price"
          } — cancel on the billing page before that date if you don't want to continue.`,
          href: "/dashboard/billing",
        };
      }
      if (kind === "paying") {
        const next = str(payload.nextChargeAt);
        const charge = next
          ? `your next invoice, on ${formatShortDate(next)}, is charged as usual${price && !goesBack ? ` (${price})` : ""}.`
          : `invoices after that are charged as usual${price && !goesBack ? ` (${price})` : ""}.`;
        return {
          subject: `Your complimentary ${tier}`,
          body: `ends ${ends};${back} ${charge}`,
          href: "/dashboard/billing",
        };
      }
      if (kind === "plan_ending") {
        const planEnds = str(payload.planEndsAt);
        return {
          subject: `Your complimentary ${tier}`,
          body: `ends ${ends}. ${goesBack ? `You go back to ${paidTier} until your plan ends` : "Your plan is cancelled and ends"}${
            planEnds ? ` on ${formatShortDate(planEnds)}` : " on its own date"
          }; nothing more is charged.`,
          href: "/dashboard/billing",
        };
      }
      return {
        subject: `Your complimentary ${tier}`,
        body: `ends ${ends}. After that you'll be on Free — every card and deck you've made stays yours, and so do any AI credits left. Choose a plan to keep ${tier}.`,
        href: "/dashboard/billing",
      };
    }
    case "moderation_unhidden": {
      // An admin cleared the moderation lock (migration 0156,
      // admin_unhide_card). The card stays private: its owner decides.
      const title = item.card?.title ?? "your card";
      return {
        subject: "PipGlyph team",
        body: `reviewed ${title} — it's no longer hidden by moderation. It stays private until you publish it.`,
        href:
          item.card && item.card.ownerUsername
            ? `/card/${item.card.ownerUsername}/${item.card.slug}`
            : "/dashboard/cards",
      };
    }
    case "card_limit": {
      const limit = num(payload.limit);
      return {
        subject: "PipGlyph team",
        body:
          limit != null
            ? `raised your saved-card limit to ${limit.toLocaleString("en-US")}.`
            : "reset your saved-card limit to your plan's default.",
        href: "/dashboard",
      };
    }
    default: {
      const verb = VERB[item.type] ?? "interacted with";
      return {
        subject: actorName,
        body: `${verb} ${item.card ? item.card.title : "your card"}.`,
        href:
          item.card && item.card.ownerUsername
            ? `/card/${item.card.ownerUsername}/${item.card.slug}`
            : item.actor?.username
              ? `/profile/${item.actor.username}`
              : "#",
      };
    }
  }
}

/** Single-line form for toasts and accessible labels. */
export function notificationSentence(
  item: DescribableNotification,
  opts: { isAdmin: boolean },
): string {
  const d = describeNotification(item, opts);
  return `${d.subject} ${d.body}`;
}
