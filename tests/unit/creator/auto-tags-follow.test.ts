import { describe, expect, it } from "vitest";
import {
  followedTagsText,
  NEW_AUTO_TAGS_FOLLOW,
  stepAutoTagsFollow,
  type AutoTagsFollow,
} from "@/lib/creator/auto-tags-follow";
import type { AutoTagInput } from "@/lib/cards/auto-tags";

// The Tags field's follow (lib/creator/auto-tags-follow.ts): driven here the
// way components/creator/use-auto-tags.ts drives it — one step per render,
// the field holding what the last step wrote.

function driver(initial: string) {
  let state: AutoTagsFollow = NEW_AUTO_TAGS_FOLLOW;
  let field = initial;
  return {
    render(input: AutoTagInput) {
      const step = stepAutoTagsFollow(state, field, input);
      state = step.state;
      if (step.write !== null) field = step.write;
      return field;
    },
    type(text: string) {
      field = text;
    },
    get following() {
      return state.following;
    },
  };
}

const bolt: AutoTagInput = { title: "Lightning Bolt", rules_text: "Lightning Bolt deals 3 damage to any target.", card_type: "instant" };

describe("a new card's Tags field", () => {
  it("fills in as the name and rules text are typed, and follows them while untouched", () => {
    const form = driver("");
    expect(form.render({ title: "", rules_text: "", card_type: "creature" })).toBe("");
    expect(form.render({ title: "Shivan Dragon", rules_text: "", card_type: "creature" })).toBe("dragons");
    expect(form.render({ title: "Shivan Dragon", rules_text: "Flying", card_type: "creature" })).toBe("flying, dragons");
    // The text changes again: the suggestion follows it, the dropped one goes.
    expect(form.render({ title: "Shivan Wurm", rules_text: "Trample", card_type: "creature" })).toBe("trample, wurms");
    expect(form.following).toBe(true);
  });

  it("stops for good once the maker edits the field — removing, adding or rewording a tag", () => {
    const form = driver("");
    expect(form.render(bolt)).toBe("removal, burn");
    form.type("burn, red");
    expect(form.render(bolt)).toBe("burn, red");
    expect(form.following).toBe(false);
    // Later text changes leave the maker's tags alone.
    expect(form.render({ ...bolt, rules_text: "Draw two cards." })).toBe("burn, red");
    // …even when the field is emptied by hand.
    form.type("");
    expect(form.render({ ...bolt, rules_text: "Create a 1/1 Goblin token." })).toBe("");
  });

  it("keeps a challenge's seeded tag in front of the suggestions", () => {
    const form = driver("dragon-week");
    expect(form.render({ title: "", rules_text: "" })).toBe("dragon-week");
    expect(form.render({ title: "Ember Dragon", rules_text: "Flying, haste", subtypes: "Dragon" })).toBe("dragon-week, dragons, flying, haste");
    expect(form.following).toBe(true);
  });

  it("a writer that sets the tags (an AI fill) ends the follow like the maker does", () => {
    const form = driver("");
    form.render(bolt);
    form.type("burn, instant speed");
    form.render(bolt);
    expect(form.following).toBe(false);
  });

  it("Start over begins again from the field as it is reset", () => {
    let state: AutoTagsFollow = { following: false, seen: "mine", base: [] };
    expect(stepAutoTagsFollow(state, "", bolt).write).toBeNull();
    state = NEW_AUTO_TAGS_FOLLOW;
    expect(stepAutoTagsFollow(state, "", bolt).write).toBe("removal, burn");
  });
});

describe("followedTagsText", () => {
  it("dedupes the base against the suggestions and caps the field at twelve", () => {
    expect(followedTagsText(["burn"], bolt)).toBe("burn, removal");
    const many = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    expect(followedTagsText(many, bolt).split(", ")).toHaveLength(12);
  });
});
