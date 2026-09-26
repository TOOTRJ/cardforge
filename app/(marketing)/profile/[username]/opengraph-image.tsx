import { ogImageResponse } from "@/lib/og/image-response";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import {
  fetchImageAsDataUri,
  OG_SIZE,
  OgEyebrow,
  OgShell,
} from "@/lib/og/shell";
import { BRAND } from "@/lib/brand/constants";

// Social-preview card for creator profiles — avatar, display name, and
// handle, so a shared profile link unfurls as the person rather than the
// generic site card.

export const alt = "A creator profile on PipGlyph";
export const size = OG_SIZE;
export const contentType = "image/png";

type OgProfile = {
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

async function getProfile(username: string): Promise<OgProfile | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("profiles")
      .select("username, display_name, avatar_url, bio")
      .eq("username", username)
      .maybeSingle();
    return (data as OgProfile | null) ?? null;
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return ogImageResponse(
      (
        <OgShell>
          <OgEyebrow>Community</OgEyebrow>
          <h1 style={{ margin: 0, fontSize: 72, fontWeight: 700 }}>
            PipGlyph forgers
          </h1>
        </OgShell>
      ),
      size,
    );
  }

  const displayName =
    profile.display_name?.trim() || profile.username || "Forgemaster";
  const initial = (displayName[0] ?? "?").toUpperCase();
  const avatar = profile.avatar_url
    ? await fetchImageAsDataUri(profile.avatar_url)
    : null;

  return ogImageResponse(
    (
      <OgShell>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 36,
            marginTop: 10,
          }}
        >
          {avatar ? (
            <img
              src={avatar}
              alt=""
              width={168}
              height={168}
              style={{
                borderRadius: 999,
                objectFit: "cover",
                border: `4px solid ${BRAND.gold}`,
              }}
            />
          ) : (
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `linear-gradient(135deg, ${BRAND.purpleDeep} 0%, ${BRAND.purple} 100%)`,
                border: `4px solid ${BRAND.gold}`,
                fontSize: 72,
                fontWeight: 700,
                color: BRAND.foreground,
              }}
            >
              {initial}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{
                fontSize: displayName.length > 22 ? 52 : 64,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -1,
              }}
            >
              {displayName}
            </span>
            {profile.username ? (
              <span style={{ fontSize: 28, color: BRAND.purple }}>
                @{profile.username}
              </span>
            ) : null}
          </div>
        </div>
        {profile.bio?.trim() ? (
          <p
            style={{
              margin: 0,
              marginTop: 6,
              fontSize: 26,
              lineHeight: 1.45,
              color: BRAND.muted,
              maxWidth: 900,
            }}
          >
            {profile.bio.length > 140
              ? `${profile.bio.slice(0, 137)}…`
              : profile.bio}
          </p>
        ) : (
          <p style={{ margin: 0, marginTop: 6, fontSize: 26, color: BRAND.muted }}>
            Custom cards forged on PipGlyph.
          </p>
        )}
      </OgShell>
    ),
    size,
  );
}
