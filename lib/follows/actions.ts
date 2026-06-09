"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type ToggleFollowResult =
  | { ok: true; following: boolean }
  | { ok: false; error: string };

export async function toggleFollowAction(
  targetUserId: string,
): Promise<ToggleFollowResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to follow creators." };
  if (user.id === targetUserId) {
    return { ok: false, error: "You can't follow yourself." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", user.id)
    .eq("following_id", targetUserId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId);
    if (error) return { ok: false, error: "Couldn't unfollow. Please try again." };
    revalidatePath("/feed");
    return { ok: true, following: false };
  }

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, following_id: targetUserId });
  if (error) {
    // 23505 = already following (raced) → treat as success.
    if ((error as { code?: string }).code === "23505") {
      return { ok: true, following: true };
    }
    return { ok: false, error: "Couldn't follow. Please try again." };
  }
  revalidatePath("/feed");
  return { ok: true, following: true };
}
