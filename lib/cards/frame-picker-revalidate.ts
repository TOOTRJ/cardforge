import { revalidatePath } from "next/cache";

/** Every page that renders the frame picker from the verified set. `/create`
 *  is dynamic and reads the table per request; the guest creator is ISR
 *  (revalidate 3600) and would otherwise show or hide a frame up to an hour
 *  late. Shared by the per-colour tick (frame-review-actions.ts) and the
 *  per-template sign-off (frame-signoff-actions.ts). */
export function revalidateFramePickers(): void {
  revalidatePath("/admin/frame-compare");
  revalidatePath("/create-guest");
  revalidatePath("/create");
}
