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

export const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  username: usernameSchema,
  password: passwordSchema,
});

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
  website_url: z
    .string()
    .trim()
    .max(2048, "Website URL must be 2048 characters or fewer.")
    .url("Enter a valid URL (including https://).")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

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
