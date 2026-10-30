// @vitest-environment happy-dom
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { useAutoTagsFollow } from "@/components/creator/use-auto-tags";
import type { FormValues } from "@/lib/creator/form-types";

// The creator's Tags follow (components/creator/use-auto-tags.ts) on a real
// react-hook-form under StrictMode — whose double effect run on mount once
// read the follow's own write as the maker's change and ended it on a
// create form that mounts already filled (the review of PR #694).

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

function useHarness(defaults: Partial<FormValues>, enabled = true) {
  const form = useForm<FormValues>({
    defaultValues: {
      title: "",
      rules_text: "",
      subtypes_text: "",
      card_type: "creature",
      tags_text: "",
      has_back_face: false,
      back_face: { rules_text: "", subtypes_text: "" } as FormValues["back_face"],
      ...defaults,
    } as FormValues,
  });
  const follow = useAutoTagsFollow(form, enabled);
  return { form, follow };
}

describe("useAutoTagsFollow under StrictMode", () => {
  it("fills a form that mounts with its name and rules text already filled, and keeps following", async () => {
    const { result } = renderHook(
      () => useHarness({ title: "Doom Blade", rules_text: "Destroy target nonblack creature.", card_type: "instant" }),
      { wrapper: strict },
    );
    expect(result.current.form.getValues("tags_text")).toBe("removal");
    expect(result.current.follow.following).toBe(true);
    // Still following: a later word in the rules moves the tags.
    await act(async () => {
      result.current.form.setValue("rules_text", "Destroy target nonblack creature. Draw two cards.");
    });
    expect(result.current.form.getValues("tags_text")).toBe("card draw, removal");
    expect(result.current.follow.following).toBe(true);
  });

  it("never reads the name: Wrath of God gets no gods tag", () => {
    const { result } = renderHook(
      () => useHarness({ title: "Wrath of God", rules_text: "Destroy all creatures. They can’t be regenerated.", card_type: "sorcery" }),
      { wrapper: strict },
    );
    expect(result.current.form.getValues("tags_text")).toBe("board wipe");
  });

  it("reads the back face while the card has one", () => {
    const { result } = renderHook(
      () =>
        useHarness({
          title: "Delver of Secrets",
          rules_text: "At the beginning of your upkeep, look at the top card of your library.",
          subtypes_text: "Human, Wizard",
          has_back_face: true,
          back_face: { rules_text: "Flying", subtypes_text: "Human, Insect" } as FormValues["back_face"],
        }),
      { wrapper: strict },
    );
    expect(result.current.form.getValues("tags_text")).toBe("insects, wizards, flying");
  });

  it("stops at the maker's change and stays stopped", async () => {
    const { result } = renderHook(
      () => useHarness({ rules_text: "Destroy target nonblack creature.", card_type: "instant" }),
      { wrapper: strict },
    );
    await act(async () => {
      result.current.form.setValue("tags_text", "removal, horror");
    });
    expect(result.current.follow.following).toBe(false);
    await act(async () => {
      result.current.form.setValue("rules_text", "Draw two cards.");
    });
    expect(result.current.form.getValues("tags_text")).toBe("removal, horror");
    await act(async () => {
      result.current.follow.restart();
      result.current.form.setValue("tags_text", "");
    });
    expect(result.current.follow.following).toBe(true);
    expect(result.current.form.getValues("tags_text")).toBe("card draw");
  });

  it("writes nothing when disabled (an edit, a remix, a deck-card proxy)", () => {
    const { result } = renderHook(
      () => useHarness({ rules_text: "Destroy target nonblack creature.", card_type: "instant" }, false),
      { wrapper: strict },
    );
    expect(result.current.form.getValues("tags_text")).toBe("");
    expect(result.current.follow.following).toBe(false);
  });
});
