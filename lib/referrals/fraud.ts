// ---------------------------------------------------------------------------
// Referral fraud rules — pure, so each is a unit test. Two outcomes:
//
//   * PLAINLY THE SAME PERSON (or a throwaway account): nobody is rewarded —
//       same_email        the two addresses are one inbox (case, "+tag", Gmail
//                         dots, googlemail.com);
//       same_card         a card fingerprint on both Stripe customers;
//       disposable_email  the new account's domain is a throwaway inbox
//                         (the cheapest way to farm free months);
//       not_new           the "new" account isn't (claimed late: older than
//                         REFERRAL_CLAIM_WINDOW_DAYS, or already had a plan).
//   * SUSPICIOUS, NOT PROVEN: the friend keeps their month, the referrer gets
//       none —
//       same_domain       both addresses on the same CUSTOM domain
//                         (a company or a vanity domain). Free mail
//                         (gmail.com, outlook.com, …) never matches: most
//                         real friends share one; nor does a reserved TLD
//                         (.test — the seeded dev accounts).
//
// Self-referral by id is impossible in the database (referrals'
// `referrer_id <> referee_id` check); by email it is same_email.
// ---------------------------------------------------------------------------

export type ReferralBlockReason = "same_email" | "same_card" | "same_domain" | "disposable_email" | "not_new";

/** Free / consumer mail domains: a shared one says nothing. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr",
  "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
  "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "pm.me", "gmx.com", "gmx.de", "gmx.net", "web.de", "yandex.com", "yandex.ru", "mail.ru",
  "qq.com", "163.com", "126.com", "zoho.com", "fastmail.com", "hey.com", "tutanota.com",
  "tuta.io", "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "orange.fr", "free.fr",
  "laposte.net", "libero.it", "t-online.de", "btinternet.com", "naver.com", "seznam.cz",
]);

/** Throwaway inboxes (the common ones; DATA — add a domain when one shows
 *  up in the admin panel's "Blocked" count). */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.net",
  "throwawaymail.com", "yopmail.com", "yopmail.fr", "getnada.com", "nada.email",
  "trashmail.com", "trashmail.de", "dispostable.com", "maildrop.cc", "mintemail.com",
  "fakeinbox.com", "mohmal.com", "emailondeck.com", "spamgourmet.com", "mailnesia.com",
  "tempinbox.com", "burnermail.io", "mailpoof.com", "tempmailo.com", "moakt.com",
  "emailfake.com", "inboxkitten.com", "1secmail.com", "1secmail.net", "dropmail.me",
]);

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** RFC 2606 / 6761 reserved TLDs: no real inbox lives there, so a shared one
 *  says nothing about two PEOPLE (the seeded dev accounts all share
 *  dev.pipglyph.test — and must be able to exercise a reward). */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"]);

function isReservedDomain(domain: string): boolean {
  return RESERVED_TLDS.has(domain.split(".").at(-1) ?? "");
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/** One inbox, one string: lowercase, no "+tag", Gmail's dots ignored and
 *  googlemail.com read as gmail.com. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return local ? `${local}@${domain}` : null;
}

/** A domain or any parent of it is a known throwaway inbox. */
export function isDisposableDomain(domain: string | null): boolean {
  if (!domain) return false;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

export type ReferralFraudFacts = {
  referrerEmail: string | null;
  refereeEmail: string | null;
  /** A card fingerprint is on both Stripe customers. */
  sameCard: boolean;
  /** The account was not new when the referral was claimed. */
  notNew?: boolean;
};

export type ReferralFraudVerdict =
  | { block: null }
  | { block: ReferralBlockReason; refereeRewarded: boolean };

export function referralFraudVerdict(facts: ReferralFraudFacts): ReferralFraudVerdict {
  if (facts.notNew) return { block: "not_new", refereeRewarded: false };
  const a = normalizeEmail(facts.referrerEmail);
  const b = normalizeEmail(facts.refereeEmail);
  if (a && b && a === b) return { block: "same_email", refereeRewarded: false };
  if (facts.sameCard) return { block: "same_card", refereeRewarded: false };
  const refereeDomain = emailDomain(facts.refereeEmail);
  if (isDisposableDomain(refereeDomain)) return { block: "disposable_email", refereeRewarded: false };
  const referrerDomain = emailDomain(facts.referrerEmail);
  if (
    referrerDomain &&
    refereeDomain &&
    referrerDomain === refereeDomain &&
    !FREE_MAIL_DOMAINS.has(refereeDomain) &&
    !isReservedDomain(refereeDomain)
  ) {
    return { block: "same_domain", refereeRewarded: true };
  }
  return { block: null };
}
