import type { SVGProps } from "react";
import { Github, Instagram, Youtube } from "lucide-react";
import type { SocialPlatformKey } from "@/lib/auth/schemas";

// ---------------------------------------------------------------------------
// SocialIcon — renders the brand glyph for a given social platform key.
// Lucide has clean icons for some platforms (GitHub, Instagram, YouTube);
// the rest (X, Bluesky, TikTok, Discord) are inline SVG marks at the same
// 1em size so they line up with their lucide siblings.
// ---------------------------------------------------------------------------

type SocialIconProps = {
  platform: SocialPlatformKey;
  className?: string;
};

export function SocialIcon({ platform, className = "h-4 w-4" }: SocialIconProps) {
  switch (platform) {
    case "twitter_url":
      return <XGlyph className={className} />;
    case "bluesky_url":
      return <BlueskyGlyph className={className} />;
    case "instagram_url":
      return <Instagram className={className} aria-hidden />;
    case "youtube_url":
      return <Youtube className={className} aria-hidden />;
    case "tiktok_url":
      return <TikTokGlyph className={className} />;
    case "discord_url":
      return <DiscordGlyph className={className} />;
    case "github_url":
      return <Github className={className} aria-hidden />;
  }
}

function XGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.654l-5.214-6.817-5.965 6.817H1.687l7.73-8.835L1.254 2.25h6.82l4.713 6.231 5.457-6.231Zm-1.161 17.52h1.832L7.084 4.126H5.117L17.083 19.77Z"
      />
    </svg>
  );
}

function BlueskyGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M6.335 4.32c2.42 1.82 5.03 5.51 5.99 7.49.96-1.98 3.57-5.67 5.99-7.49 1.75-1.31 4.57-2.33 4.57.89 0 .64-.37 5.4-.59 6.17-.76 2.69-3.49 3.38-5.93 2.96 4.26.73 5.34 3.14 3 5.54-4.45 4.56-6.4-1.14-6.9-2.6-.05-.15-.08-.22-.08-.16 0-.06-.03.01-.08.16-.5 1.46-2.45 7.16-6.9 2.6-2.34-2.4-1.26-4.81 3-5.54-2.44.42-5.17-.27-5.93-2.96-.22-.77-.59-5.53-.59-6.17 0-3.22 2.82-2.2 4.57-.89Z"
      />
    </svg>
  );
}

function TikTokGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.45v13.672a2.896 2.896 0 0 1-5.205 1.74 2.896 2.896 0 0 1 3.18-4.49V9.4a6.426 6.426 0 1 0 5.475 6.354V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104Z"
      />
    </svg>
  );
}

function DiscordGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="currentColor"
        d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.34 18.34 0 0 0-5.487 0 12.62 12.62 0 0 0-.618-1.249.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.083.083 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.105 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.299 12.299 0 0 1-1.873.891.077.077 0 0 0-.04.106c.36.699.772 1.364 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.42-2.157 2.42Zm7.974 0c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.42-2.157 2.42Z"
      />
    </svg>
  );
}
