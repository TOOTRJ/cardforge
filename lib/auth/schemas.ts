import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be 32 characters or fewer.")
  .regex(
    /^[a-z0-9_]+$/,
    "Use lowercase letters, numbers, and underscores only.",
  );

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be 72 characters or fewer.");

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  username: usernameSchema,
  password: passwordSchema,
});

// ---------------------------------------------------------------------------
// Social URL validation
//
// Each social field is host-gated: the URL must parse cleanly AND its host
// must match one of the platform's known suffixes. This prevents users from
// pasting random links into the "Twitter" field (where downstream UI would
// render a Twitter glyph next to a wrong destination) and rejects http://
// schemes so we never embed mixed-content links on the public profile.
// ---------------------------------------------------------------------------

const HTTPS_URL_BASE = z
  .string()
  .trim()
  .max(2048, "Link must be 2048 characters or fewer.")
  .url("Enter a valid URL (including https://).")
  .refine(
    (v) => v.startsWith("https://"),
    "Use an https:// URL.",
  );

function socialUrlSchema(allowedHosts: string[], label: string) {
  return HTTPS_URL_BASE.refine((v) => {
    try {
      const host = new URL(v).hostname.toLowerCase();
      return allowedHosts.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      );
    } catch {
      return false;
    }
  }, `Enter a valid ${label} URL.`)
    .optional()
    .or(z.literal("").transform(() => undefined));
}

export const SOCIAL_PLATFORMS = [
  { key: "twitter_url", label: "X / Twitter", hosts: ["twitter.com", "x.com"] },
  { key: "bluesky_url", label: "Bluesky", hosts: ["bsky.app"] },
  { key: "instagram_url", label: "Instagram", hosts: ["instagram.com"] },
  { key: "youtube_url", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { key: "tiktok_url", label: "TikTok", hosts: ["tiktok.com"] },
  {
    key: "discord_url",
    label: "Discord",
    hosts: ["discord.com", "discord.gg"],
  },
  { key: "github_url", label: "GitHub", hosts: ["github.com"] },
] as const;

export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number]["key"];

const ACCENT_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const profileUpdateSchema = z.object({
  username: usernameSchema,
  display_name: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(64, "Display name must be 64 characters or fewer."),
  bio: z
    .string()
    .trim()
    .max(280, "Bio must be 280 characters or fewer.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // HTTPS-gated like the social fields: this value is rendered as a
  // clickable href on the public profile and card pages, so a bare .url()
  // (which accepts javascript:/data: schemes) would be a stored-XSS vector.
  website_url: HTTPS_URL_BASE.optional().or(
    z.literal("").transform(() => undefined),
  ),
  accent_color: z
    .string()
    .trim()
    .regex(ACCENT_COLOR_REGEX, "Pick a color in the form #RRGGBB.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  twitter_url: socialUrlSchema(["twitter.com", "x.com"], "X / Twitter"),
  bluesky_url: socialUrlSchema(["bsky.app"], "Bluesky"),
  instagram_url: socialUrlSchema(["instagram.com"], "Instagram"),
  youtube_url: socialUrlSchema(["youtube.com", "youtu.be"], "YouTube"),
  tiktok_url: socialUrlSchema(["tiktok.com"], "TikTok"),
  discord_url: socialUrlSchema(["discord.com", "discord.gg"], "Discord"),
  github_url: socialUrlSchema(["github.com"], "GitHub"),
});

export const PINNED_CARDS_MAX = 3;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pinnedCardIdsSchema = z
  .array(z.string().regex(UUID_REGEX, "Invalid card id."))
  .max(PINNED_CARDS_MAX, `Pick up to ${PINNED_CARDS_MAX} cards.`)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Each pinned card must be unique.",
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PinnedCardIdsInput = z.infer<typeof pinnedCardIdsSchema>;

export type FieldErrors<T extends Record<string, unknown>> = Partial<
  Record<keyof T, string>
>;

export type ActionState<T extends Record<string, unknown>> = {
  status: "idle" | "error";
  formError?: string;
  fieldErrors?: FieldErrors<T>;
  values?: Partial<Record<keyof T, string>>;
};

export function fieldErrorsFromZod<T extends Record<string, unknown>>(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): FieldErrors<T> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const segment = issue.path[0];
    if (typeof segment !== "string" && typeof segment !== "number") continue;
    const key = String(segment);
    if (key && !(key in errors)) errors[key] = issue.message;
  }
  return errors as FieldErrors<T>;
}
