"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { revalidateProfilePage } from "@/lib/profile/username";
import { profileLinksSchema } from "@/lib/profile/link-kinds";
import { profileStoresSchema } from "@/lib/profile/store-platforms";

// ---------------------------------------------------------------------------
// The Settings editors' saves (migration 0153). Each saves its WHOLE list in
// one call: the shared zod schema first (host allow-lists, path shapes, the
// strong-language check on labels and titles, caps, duplicates), then ONE
// RPC that replaces the caller's rows in a transaction (RLS decides; the
// database re-checks the shape and the caps). Errors come back per row and
// field so the editor can put each under its input.
// ---------------------------------------------------------------------------

export type RowFieldErrors = Record<number, Partial<Record<string, string>>>;

export type ListSaveResult =
  | { ok: true }
  | { ok: false; formError?: string; rowErrors?: RowFieldErrors };

function rowErrorsOf(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): { rowErrors: RowFieldErrors; formError?: string } {
  const rowErrors: RowFieldErrors = {};
  let formError: string | undefined;
  for (const issue of issues) {
    const [index, field] = issue.path;
    if (typeof index === "number") {
      const key = typeof field === "string" ? field : "url";
      rowErrors[index] ??= {};
      rowErrors[index][key] ??= issue.message;
    } else {
      formError ??= issue.message;
    }
  }
  return { rowErrors, formError };
}

async function saveList(
  rpc: "set_profile_links" | "set_profile_stores",
  rows: unknown,
): Promise<ListSaveResult> {
  const schema = rpc === "set_profile_links" ? profileLinksSchema : profileStoresSchema;
  const parsed = schema.safeParse(rows);
  if (!parsed.success) {
    const { rowErrors, formError } = rowErrorsOf(parsed.error.issues);
    return { ok: false, rowErrors, formError: formError ?? "Check the highlighted rows." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, formError: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, formError: "You must be signed in." };

  const supabase = await createClient();
  const { error } =
    rpc === "set_profile_links"
      ? await supabase.rpc("set_profile_links", { p_links: parsed.data })
      : await supabase.rpc("set_profile_stores", { p_stores: parsed.data });
  if (error) {
    console.warn(`${rpc}: save failed`, error.code, error.message);
    return { ok: false, formError: "We couldn't save that. Please try again." };
  }

  revalidatePath("/settings");
  await revalidateProfilePage(supabase, user.id);
  return { ok: true };
}

export async function saveProfileLinksAction(links: unknown): Promise<ListSaveResult> {
  return saveList("set_profile_links", links);
}

export async function saveProfileStoresAction(stores: unknown): Promise<ListSaveResult> {
  return saveList("set_profile_stores", stores);
}
