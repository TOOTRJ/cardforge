// ---------------------------------------------------------------------------
// Migration 0127's media URL guards refuse a picture URL that isn't one of
// the writer's own uploads with insufficient_privilege and a message
// `media_url_not_allowed: <table>.<column> …`. The save actions turn it into
// a field error the form can show next to the picture, instead of the raw
// database text. The app never sends such a value on purpose (uploads,
// imports and AI art land in the user's folder; a remix copies its parent's
// pictures first — lib/cards/remix-media.ts), so this is the message a stale
// form or a crafted payload sees.
// ---------------------------------------------------------------------------

export const MEDIA_URL_NOT_ALLOWED = "media_url_not_allowed";

export const MEDIA_URL_NOT_ALLOWED_MESSAGE =
  "That picture isn't one of your uploads — upload it again and save.";

/** The form field a guard refusal names (`art_url`, `back_face.art_url`,
 *  `watermark`, `set_icon_url`, `cover_url`…), or null when `message` isn't
 *  one. */
export function mediaUrlViolationField(message: string | null | undefined): string | null {
  if (!message || !message.includes(MEDIA_URL_NOT_ALLOWED)) return null;
  const column = /media_url_not_allowed: [a-z_]+\.([a-z_]+)(?: ([a-z_]+))?/.exec(message);
  if (!column) return "form";
  const [, name, sub] = column;
  if (name === "back_face") return sub === "art_url" ? "back_face.art_url" : "back_face";
  return name;
}
