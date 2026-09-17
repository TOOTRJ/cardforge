"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { CREATOR_LAB_TAG } from "@/lib/creator/lab";
import { isCreatorLabMode } from "@/lib/creator/lab-shared";

export type CreatorLabActionResult = { ok: true } | { ok: false; error: string };

/** Admin: who may see the canvas creator (site_settings.creator_lab). */
export async function setCreatorLabModeAction(
  mode: unknown,
): Promise<CreatorLabActionResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isCreatorLabMode(mode)) return { ok: false, error: "Unknown mode." };
  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").upsert(
    {
      key: "creator_lab",
      value: { mode },
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    },
    { onConflict: "key" },
  );
  if (error) {
    console.warn("setCreatorLabModeAction:", error.message);
    return { ok: false, error: "Couldn't change the creator lab setting." };
  }
  revalidateTag(CREATOR_LAB_TAG, "max");
  revalidatePath("/create");
  revalidatePath("/admin/creator-lab");
  return { ok: true };
}
