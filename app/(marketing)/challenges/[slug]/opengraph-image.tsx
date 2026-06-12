import { ImageResponse } from "next/og";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import {
  daysLeft,
  isActive,
  type Challenge,
} from "@/lib/challenges/shared";
import {
  OG_SIZE,
  OgChip,
  OgEyebrow,
  OgShell,
  OgTitle,
} from "@/lib/og/shell";

// Social-preview card for challenge detail pages — challenges have no
// uploaded artwork of their own, so without this they'd unfurl with the
// generic site-wide OG image and lose the brief's title entirely.

export const alt = "PipGlyph design challenge";
export const size = OG_SIZE;
export const contentType = "image/png";

async function getChallenge(slug: string): Promise<Challenge | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("challenges")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    return (data as Challenge | null) ?? null;
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const challenge = await getChallenge(slug);

  if (!challenge) {
    return new ImageResponse(
      (
        <OgShell>
          <OgEyebrow>Community</OgEyebrow>
          <OgTitle text="Design challenges" />
          <p style={{ margin: 0, fontSize: 26, color: "#9aa3b5" }}>
            A brief, a tag, and the gallery as the arena.
          </p>
        </OgShell>
      ),
      size,
    );
  }

  const active = isActive(challenge);
  const days = daysLeft(challenge);

  return new ImageResponse(
    (
      <OgShell>
        <OgEyebrow>Design challenge</OgEyebrow>
        <OgTitle text={challenge.title} />
        <p
          style={{
            margin: 0,
            fontSize: 26,
            lineHeight: 1.45,
            color: "#9aa3b5",
            maxWidth: 880,
          }}
        >
          {challenge.description.length > 120
            ? `${challenge.description.slice(0, 117)}…`
            : challenge.description}
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          <OgChip tone="gold">
            {active
              ? `${days} day${days === 1 ? "" : "s"} left`
              : "Closed"}
          </OgChip>
          <OgChip tone="muted">#{challenge.tag}</OgChip>
        </div>
      </OgShell>
    ),
    size,
  );
}
