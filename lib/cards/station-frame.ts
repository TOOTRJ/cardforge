import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";

/** The template is a STATION frame (TODO 4.27a): its profile declares
 *  `tiers` — the text box is a top band over 0–3 tier bands, the creator
 *  shows the tier editor, and a save writes `face_content.station`. Read
 *  from the CODE profile, like every switch; never a list of templates. */
export function isStationFrame(template: string | null | undefined): boolean {
  return Boolean(getFrameProfile(normalizeFrameTemplate(template)).tiers);
}
