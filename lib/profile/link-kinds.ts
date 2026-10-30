import { z } from "zod";
import { containsProfanity } from "@/lib/moderation/profanity";
import { hostMatches, parseHttpsLink, PROFILE_LINK_URL_MAX } from "@/lib/profile/https-link";

// ---------------------------------------------------------------------------
// A profile's extra LINKS (migration 0153, `profile_links`): the MTG sites a
// creator plays and builds on, the socials the seven profile columns don't
// cover, support pages, and one "other https link". ONE registry — the
// Settings editor's choices, the zod schema the editor and the server
// action share, the icon (components/profile/link-icon.tsx) and the profile
// page's row all read it, and the migration's `kind` CHECK lists exactly
// its keys (tests/unit/db/profile-links-migration.test.ts).
//
// Each kind is host-gated like the profile's social columns (an X glyph
// never points at another site) and, where the site has ONE profile URL
// shape, path-gated too (`paths`, read case-insensitively). Hosts and
// shapes are sourced in docs/research/profiles-and-stores-2026-10.md.
//
// The seven platforms with profile COLUMNS (lib/auth/schemas.ts
// SOCIAL_PLATFORMS: X, Bluesky, Instagram, YouTube, TikTok, Discord, GitHub)
// stay columns — the card page reads them — and are not kinds here.
// ---------------------------------------------------------------------------

export type LinkKindGroup = "mtg" | "social" | "support" | "other";

export type LinkKind = {
  key: string;
  label: string;
  group: LinkKindGroup;
  /** Allowed hosts (a subdomain of one passes). Empty = any https host. */
  hosts: readonly string[];
  /** The profile URL's path shape, when the site has one. */
  paths?: readonly RegExp[];
  placeholder: string;
};

export const LINK_KINDS = [
  // --- Magic sites with public user profiles -------------------------------
  {
    key: "moxfield",
    label: "Moxfield",
    group: "mtg",
    hosts: ["moxfield.com"],
    paths: [/^\/users\/[^/]+\/?$/i],
    placeholder: "https://moxfield.com/users/your-name",
  },
  {
    key: "archidekt",
    label: "Archidekt",
    group: "mtg",
    hosts: ["archidekt.com"],
    paths: [/^\/u\/[^/]+\/?$/i, /^\/user\/\d+\/?$/i],
    placeholder: "https://archidekt.com/u/your-name",
  },
  {
    key: "mtggoldfish",
    label: "MTGGoldfish",
    group: "mtg",
    hosts: ["mtggoldfish.com"],
    placeholder: "https://www.mtggoldfish.com/player/your-name",
  },
  {
    key: "tappedout",
    label: "TappedOut",
    group: "mtg",
    hosts: ["tappedout.net"],
    paths: [/^\/users\/[^/]+\/?$/i],
    placeholder: "https://tappedout.net/users/your-name/",
  },
  {
    key: "deckstats",
    label: "Deckstats",
    group: "mtg",
    hosts: ["deckstats.net"],
    placeholder: "https://deckstats.net/decks/12345/",
  },
  {
    key: "untapped",
    label: "Untapped.gg",
    group: "mtg",
    hosts: ["untapped.gg"],
    placeholder: "https://mtga.untapped.gg/profile/…",
  },
  {
    key: "melee",
    label: "Melee.gg",
    group: "mtg",
    hosts: ["melee.gg"],
    placeholder: "https://melee.gg/…",
  },
  {
    key: "cardsphere",
    label: "Cardsphere",
    group: "mtg",
    hosts: ["cardsphere.com"],
    placeholder: "https://www.cardsphere.com/…",
  },
  // --- Socials the profile columns don't cover ------------------------------
  {
    key: "twitch",
    label: "Twitch",
    group: "social",
    hosts: ["twitch.tv"],
    paths: [/^\/[a-z0-9_]{3,25}\/?$/i],
    placeholder: "https://www.twitch.tv/your_channel",
  },
  {
    key: "reddit",
    label: "Reddit",
    group: "social",
    hosts: ["reddit.com"],
    paths: [/^\/(?:u|user|r)\/[a-z0-9_-]{2,30}\/?$/i],
    placeholder: "https://www.reddit.com/user/your-name",
  },
  {
    key: "threads",
    label: "Threads",
    group: "social",
    hosts: ["threads.net", "threads.com"],
    paths: [/^\/@[a-z0-9._]{1,30}\/?$/i],
    placeholder: "https://www.threads.com/@your.handle",
  },
  {
    // Federated: a profile lives on ANY host, so no host list — the URL must
    // have the one profile shape every server prints (`/@user`, a remote
    // account's `/@user@host` too).
    key: "mastodon",
    label: "Mastodon",
    group: "social",
    hosts: [],
    paths: [/^\/@[a-z0-9_]{1,30}(?:@[a-z0-9.-]+\.[a-z]{2,})?\/?$/i],
    placeholder: "https://mastodon.social/@your_name",
  },
  {
    key: "facebook",
    label: "Facebook",
    group: "social",
    hosts: ["facebook.com", "fb.com"],
    placeholder: "https://www.facebook.com/your-page",
  },
  {
    key: "artstation",
    label: "ArtStation",
    group: "social",
    hosts: ["artstation.com"],
    placeholder: "https://www.artstation.com/your-name",
  },
  {
    key: "deviantart",
    label: "DeviantArt",
    group: "social",
    hosts: ["deviantart.com"],
    placeholder: "https://www.deviantart.com/your-name",
  },
  {
    key: "linktree",
    label: "Linktree",
    group: "social",
    hosts: ["linktr.ee"],
    paths: [/^\/[^/]+\/?$/i],
    placeholder: "https://linktr.ee/your-name",
  },
  {
    key: "substack",
    label: "Substack",
    group: "social",
    hosts: ["substack.com"],
    placeholder: "https://your-name.substack.com",
  },
  // --- Support ---------------------------------------------------------------
  {
    key: "patreon",
    label: "Patreon",
    group: "support",
    hosts: ["patreon.com"],
    paths: [/^\/(?:c\/)?[^/]+\/?$/i],
    placeholder: "https://www.patreon.com/your-name",
  },
  {
    key: "kofi",
    label: "Ko-fi",
    group: "support",
    hosts: ["ko-fi.com"],
    paths: [/^\/[a-z0-9_]+\/?$/i],
    placeholder: "https://ko-fi.com/yourname",
  },
  // --- Anything else ---------------------------------------------------------
  {
    key: "other",
    label: "Other link",
    group: "other",
    hosts: [],
    placeholder: "https://…",
  },
] as const satisfies readonly LinkKind[];

export type LinkKindKey = (typeof LINK_KINDS)[number]["key"];

export const LINK_KIND_KEYS = LINK_KINDS.map((k) => k.key) as readonly LinkKindKey[];

const BY_KEY: ReadonlyMap<string, LinkKind> = new Map(LINK_KINDS.map((k) => [k.key, k]));

export function linkKindOf(key: string): LinkKind | null {
  return BY_KEY.get(key) ?? null;
}

export const LINK_GROUP_LABELS: Record<LinkKindGroup, string> = {
  mtg: "Magic sites",
  social: "Socials",
  support: "Support",
  other: "Other",
};

/** How many links a profile holds (the migration's trigger says the same). */
export const PROFILE_LINKS_MAX = 12;
/** A link's own label: the "other" kind's name, or a note on any kind. */
export const PROFILE_LINK_LABEL_MAX = 40;

/** Why `url` can't be a link of `kind`, or null when it can. */
export function linkUrlError(kind: LinkKind, raw: string): string | null {
  const url = parseHttpsLink(raw);
  if (!url) return "Enter a full https:// link.";
  if (kind.hosts.length > 0 && !hostMatches(url.hostname, kind.hosts)) {
    return `That isn't a ${kind.label} link (${kind.hosts.join(" or ")}).`;
  }
  if (kind.paths && !kind.paths.some((re) => re.test(url.pathname))) {
    return `Paste your ${kind.label} profile link, like ${kind.placeholder}.`;
  }
  return null;
}

export const STRONG_LANGUAGE_PROFILE_TEXT =
  "Words on your public profile can't include strong language — try another wording.";

const labelSchema = z
  .string()
  .trim()
  .max(PROFILE_LINK_LABEL_MAX, `Labels are ${PROFILE_LINK_LABEL_MAX} characters or fewer.`)
  .refine((v) => !containsProfanity(v), STRONG_LANGUAGE_PROFILE_TEXT);

export const profileLinkSchema = z
  .object({
    kind: z.enum(LINK_KIND_KEYS as unknown as [LinkKindKey, ...LinkKindKey[]], {
      error: "Pick what kind of link this is.",
    }),
    url: z.string().trim().max(PROFILE_LINK_URL_MAX, "Links must be 2048 characters or fewer."),
    label: labelSchema.optional().transform((v) => (v ? v : undefined)),
  })
  .superRefine((value, ctx) => {
    const kind = linkKindOf(value.kind);
    if (!kind) return;
    const error = linkUrlError(kind, value.url);
    if (error) ctx.addIssue({ code: "custom", path: ["url"], message: error });
    if (kind.key === "other" && !value.label) {
      ctx.addIssue({ code: "custom", path: ["label"], message: "Name this link." });
    }
  });

export const profileLinksSchema = z
  .array(profileLinkSchema)
  .max(PROFILE_LINKS_MAX, `Add up to ${PROFILE_LINKS_MAX} links.`)
  .superRefine((links, ctx) => {
    const seen = new Set<string>();
    links.forEach((link, i) => {
      const key = link.url.trim().toLowerCase().replace(/\/$/, "");
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: [i, "url"], message: "This link is already in the list." });
      }
      seen.add(key);
    });
  });

export type ProfileLinkInput = z.infer<typeof profileLinkSchema>;

/** A stored row as the profile page reads it. */
export type ProfileLink = {
  id: string;
  kind: LinkKindKey;
  url: string;
  label: string | null;
  position: number;
};

/** The rows a profile may DRAW: a known kind whose URL still passes its
 *  test (a row written straight through the API skips the action). */
export function drawableProfileLinks<T extends { kind: string; url: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => {
    const kind = linkKindOf(row.kind);
    return kind !== null && linkUrlError(kind, row.url) === null;
  });
}

/** The name a link is announced and printed with. */
export function profileLinkName(link: { kind: string; label: string | null }): string {
  const kind = linkKindOf(link.kind);
  if (link.label) return kind && kind.key !== "other" ? `${kind.label} — ${link.label}` : link.label;
  return kind?.label ?? "Link";
}
