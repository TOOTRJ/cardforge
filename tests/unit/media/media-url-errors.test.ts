import { describe, expect, it } from "vitest";
import { MEDIA_URL_NOT_ALLOWED_MESSAGE, mediaUrlViolationField } from "@/lib/media/media-url-errors";

// Migration 0127's guards name the column they refused in their message; the
// save actions put the friendly copy on that form field.
describe("mediaUrlViolationField", () => {
  it.each([
    ["media_url_not_allowed: cards.art_url must be one of your own uploads", "art_url"],
    ["media_url_not_allowed: cards.back_face art_url must be one of your own uploads", "back_face.art_url"],
    ["media_url_not_allowed: cards.watermark url must be one of your own uploads", "watermark"],
    ["media_url_not_allowed: cards.set_icon_url must be one of your own uploads", "set_icon_url"],
    ["media_url_not_allowed: decks.cover_url must be one of your own uploads", "cover_url"],
    ["media_url_not_allowed: profiles.avatar_url must be one of your own uploads or a built-in image", "avatar_url"],
    ["media_url_not_allowed", "form"],
  ])("%s → %s", (message, field) => {
    expect(mediaUrlViolationField(message)).toBe(field);
  });

  it("ignores every other error", () => {
    for (const message of [null, undefined, "", "render_columns_server_only: …", "card_capacity_exceeded"]) {
      expect(mediaUrlViolationField(message)).toBeNull();
    }
    expect(MEDIA_URL_NOT_ALLOWED_MESSAGE).toMatch(/upload it again/);
  });
});
