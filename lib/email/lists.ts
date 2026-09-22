import { getSiteBaseUrl } from "@/lib/site-url";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// The three opt-in/out lists (columns of email_preferences, migration 0095)
// and the unsubscribe links every non-auth email carries.
//
// Two URLs per email, both keyed by the user's opaque unsubscribe_token:
//   * page     — the visible footer link. A GET only SHOWS a confirm button,
//                so mail scanners that prefetch links can't unsubscribe anyone.
//   * oneClick — the RFC 8058 endpoint named in the List-Unsubscribe header.
//                Mail clients POST to it when the user presses their built-in
//                "Unsubscribe" — required by Gmail/Yahoo for bulk senders.
// Client-safe (no server imports) so the settings/onboarding UI can share the
// list copy.
// ---------------------------------------------------------------------------

export const EMAIL_LISTS = ["account", "activity", "newsletter"] as const;
export type EmailList = (typeof EMAIL_LISTS)[number];

export const EMAIL_LIST_COPY: Record<
  EmailList,
  { label: string; description: string; defaultOn: boolean }
> = {
  account: {
    label: "Account & team messages",
    description:
      "Replies from the PipGlyph team, credit grants and changes to your plan. Security emails (password resets, email changes) are always sent.",
    defaultOn: true,
  },
  activity: {
    label: "Activity digest",
    description:
      "A weekly round-up of unread activity — likes, comments, remixes and new followers. Nothing to report, no email.",
    defaultOn: true,
  },
  newsletter: {
    label: "PipGlyph newsletter",
    description:
      "Occasional product news: new frames, features and design challenges. Unsubscribe any time.",
    defaultOn: false,
  },
};

export function parseEmailList(value: unknown): EmailList | null {
  return EMAIL_LISTS.find((list) => list === value) ?? null;
}

export function isUnsubscribeToken(value: unknown): value is string {
  return isUuid(value);
}

export function unsubscribeLinks(token: string, list: EmailList) {
  const query = `token=${token}&list=${list}`;
  const base = getSiteBaseUrl();
  return {
    page: `${base}/unsubscribe?${query}`,
    oneClick: `${base}/api/email/unsubscribe?${query}`,
    settings: `${base}/settings#email`,
  };
}

export function listUnsubscribeHeaders(token: string, list: EmailList): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeLinks(token, list).oneClick}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
