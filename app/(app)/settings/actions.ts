"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  fieldErrorsFromZod,
  profileUpdateSchema,
  type ActionState,
  type ProfileUpdateInput,
} from "@/lib/auth/schemas";

export type ProfileActionState = ActionState<ProfileUpdateInput> & {
  success?: boolean;
};

export async function updateProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const raw = {
    username: formData.get("username"),
    display_name: formData.get("display_name"),
    bio: formData.get("bio"),
    website_url: formData.get("website_url"),
  };

  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsFromZod<ProfileUpdateInput>(parsed.error.issues),
      values: {
        username: typeof raw.username === "string" ? raw.username : "",
        display_name:
          typeof raw.display_name === "string" ? raw.display_name : "",
        bio: typeof raw.bio === "string" ? raw.bio : "",
        website_url: typeof raw.website_url === "string" ? raw.website_url : "",
      },
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      formError: "Supabase isn't configured. Set env vars in .env.local.",
      values: {
        username: parsed.data.username,
        display_name: parsed.data.display_name,
        bio: parsed.data.bio ?? "",
        website_url: parsed.data.website_url ?? "",
      },
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      status: "error",
      formError: "You must be signed in to update your profile.",
    };
  }

  const supabase = await createClient();

  // Pre-flight: enforce username uniqueness with a friendly message
  // (db has a unique constraint, but this gives a nicer error).
  if (parsed.data.username) {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", parsed.data.username)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return {
        status: "error",
        fieldErrors: { username: "That username is already taken." },
        values: {
          username: parsed.data.username,
          display_name: parsed.data.display_name,
          bio: parsed.data.bio ?? "",
          website_url: parsed.data.website_url ?? "",
        },
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        username: parsed.data.username,
        display_name: parsed.data.display_name,
        bio: parsed.data.bio ?? null,
        website_url: parsed.data.website_url ?? null,
      },
      { onConflict: "id" },
    );

  if (error) {
    return {
      status: "error",
      formError: error.message,
      values: {
        username: parsed.data.username,
        display_name: parsed.data.display_name,
        bio: parsed.data.bio ?? "",
        website_url: parsed.data.website_url ?? "",
      },
    };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath(`/profile/${parsed.data.username}`);

  return { status: "idle", success: true };
}
