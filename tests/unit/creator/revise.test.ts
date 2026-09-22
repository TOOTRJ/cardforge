import { describe, expect, it } from "vitest";
import {
  REVISABLE_FIELDS,
  REVISABLE_PAYLOAD_KEYS,
  hasMeaningfulChange,
  isRevisableField,
  pickRevisablePayload,
  remixTitleFor,
} from "@/lib/creator/revise";

describe("revise contract", () => {
  it("locks the structural fields", () => {
    for (const locked of [
      "card_type",
      "frame_style",
      "color_identity",
      "supertype",
      "subtypes_text",
      "deck_id",
      "back_card_id",
      "slug",
    ]) {
      expect(isRevisableField(locked)).toBe(false);
    }
  });

  it("keeps the content fields the owner listed", () => {
    for (const open of [
      "title",
      "rarity",
      "cost",
      "art_url",
      "artist_credit",
      "rules_text",
      "flavor_text",
      "power",
      "toughness",
      "set_icon_url",
      "tags_text",
      "watermark",
      "footer_text",
      "visibility",
    ]) {
      expect(REVISABLE_FIELDS).toContain(open);
    }
  });

  it("strips locked columns from an edit payload", () => {
    const payload = {
      title: "New name",
      card_type: "creature",
      frame_style: { template: "m15", finish: "regular" },
      color_identity: ["red"],
      subtypes: ["Dragon"],
      tags: ["dragons"],
      deck_id: null,
      back_card_id: null,
      visibility: "public",
      rules_text: "Flying",
      face_content: null,
      watermark: null,
    };
    const picked = pickRevisablePayload(payload);
    expect(Object.keys(picked).sort()).toEqual(
      ["face_content", "rules_text", "tags", "title", "visibility", "watermark"].sort(),
    );
    for (const key of Object.keys(picked)) {
      expect(REVISABLE_PAYLOAD_KEYS).toContain(key);
    }
  });

  it("counts visibility as a change on edit but not on remix", () => {
    expect(hasMeaningfulChange(["visibility"], "edit")).toBe(true);
    expect(hasMeaningfulChange(["visibility"], "remix")).toBe(false);
    expect(hasMeaningfulChange(["visibility", "title"], "remix")).toBe(true);
    expect(hasMeaningfulChange([], "edit")).toBe(false);
  });

  it("prefills a remix title and keeps it within the title limit", () => {
    expect(remixTitleFor("Emberbound Wyrm")).toBe("Emberbound Wyrm (remix)");
    expect(remixTitleFor("x".repeat(130)).length).toBe(120);
  });
});
