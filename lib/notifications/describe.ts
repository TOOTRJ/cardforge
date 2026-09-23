import { formatShortDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";

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
      return {
        subject: "PipGlyph team",
        body: tier
          ? `gave you ${TIER_LABEL[tier] ?? tier} plan access${
              expiresAt ? ` until ${formatShortDate(expiresAt)}` : ""
            } — enjoy.`
          : "ended your complimentary plan access.",
        href: "/settings",
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
          body: `renewed — ${money} charged; your monthly AI credits are refilled.`,
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
          ? "wasn't finished — your 7-day free trial is still waiting, no card needed."
          : "wasn't finished — pick up where you left off whenever you're ready.",
        href: "/dashboard/billing#plans",
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
