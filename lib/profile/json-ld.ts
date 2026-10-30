import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/lib/auth/schemas";
import type { ProfileWithStats } from "@/lib/cards/queries";
import { getSiteBaseUrl } from "@/lib/site-url";
import { absoluteProfileMediaUrl } from "@/lib/profile/default-media";
import { profileMediaSrc } from "@/lib/media/media-urls";
import type { ProfileLink } from "@/lib/profile/link-kinds";

// ---------------------------------------------------------------------------
// ProfilePage + Person JSON-LD — Google's profile-page structured data
// shape. sameAs collects the creator's own links (website + socials) so
// search engines can connect this profile to their wider identity.
// ---------------------------------------------------------------------------

export function buildProfileJsonLd(
  profile: ProfileWithStats,
  displayName: string,
  extraLinks: readonly Pick<ProfileLink, "url">[] = [],
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const canonical = `${base}/profile/${profile.username}`;
  // Every link the creator vouches for (website, the column socials, the
  // 0153 links — already re-checked by listProfileLinks), once each.
  const sameAs = [
    ...new Set(
      [
        profile.website_url,
        ...SOCIAL_PLATFORMS.map((p) => profile[p.key as SocialPlatformKey]),
        ...extraLinks.map((link) => link.url),
      ].filter((url): url is string => Boolean(url)),
    ),
  ];

  const person: Record<string, unknown> = {
    "@type": "Person",
    name: displayName,
    alternateName: `@${profile.username}`,
    url: canonical,
    description:
      profile.bio?.trim() || `Custom cards forged by @${profile.username} on PipGlyph.`,
  };
  // Built-in avatars are stored site-relative; structured data needs absolute.
  const avatarUrl = absoluteProfileMediaUrl(
    profileMediaSrc("avatar", profile.avatar_url, profile.id),
    base,
  );
  if (avatarUrl) person.image = avatarUrl;
  if (sameAs.length > 0) person.sameAs = sameAs;

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    dateCreated: profile.created_at,
    mainEntity: person,
    url: canonical,
  };
}

