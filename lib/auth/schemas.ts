import { z } from "zod";
import {
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  isReservedUsername,
} from "@/lib/auth/usernames";
import { UUID_PATTERN } from "@/lib/ids";

// Mirrors profiles_username_format (0001) + is_reserved_username() (0094).
// Lowercased before the pattern check so "ForgeMaster" is accepted as
// "forgemaster" instead of bouncing on a rule the user can't see.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Username must be ${USERNAME_MAX} characters or fewer.`)
  .regex(USERNAME_PATTERN, "Use letters, numbers, and underscores only.")
  .refine((v) => !isReservedUsername(v), "That username is reserved — try another.");

// 72 is bcrypt's input ceiling (GoTrue hashes with bcrypt) — longer
// passwords would be silently truncated, so refuse them instead.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be 72 characters or fewer.");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email must be 254 characters or fewer.")
  .email("Enter a valid email address.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(72),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const changeEmailSchema = z.object({
  email: emailSchema,
});

export const changePasswordSchema = z.object({
  // Empty for accounts that have never had a password (Google sign-in).
  current_password: z.string().max(72).optional().or(z.literal("")),
  password: passwordSchema,
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export const signupSchema = z.object({
  email: emailSchema,
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

export const pinnedCardIdsSchema = z
  .array(z.string().regex(UUID_PATTERN, "Invalid card id."))
  .max(PINNED_CARDS_MAX, `Pick up to ${PINNED_CARDS_MAX} cards.`)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Each pinned card must be unique.",
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PinnedCardIdsInput = z.infer<typeof pinnedCardIdsSchema>;

export type FieldErrors<T extends Record<string, unknown>> = Partial<
  Record<keyof T, string>
>;

export type ActionState<T extends Record<string, unknown>> = {
  /** "sent" = the action's email is on its way (signup confirmation); the
   *  form swaps to a check-your-inbox panel with a resend control. */
  status: "idle" | "error" | "sent";
  /** Sign-in was refused only because the address is unconfirmed (GoTrue
   *  checks the password first, so this never leaks account existence) —
   *  the form offers to resend the confirmation email. */
  unconfirmed?: boolean;
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
