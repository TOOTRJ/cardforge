// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import type { Deck } from "@/types/deck";

// ---------------------------------------------------------------------------
// TODO 3b.36: FieldGroup's shapes outside the creator's own fields.
//  - the deck editor's "Format": a select in a Controller — named by the
//    caption, described by the error and the format's hint, and focused by
//    a save the server refused on it;
//  - the feedback form's category: ONE radiogroup (`kind="control"`), never
//    a group of the field's name around a radiogroup;
//  - the Publish step's "Save as a draft": named by its words, described by
//    the line under them (never the whole label as its name).
// ---------------------------------------------------------------------------

const updateDeckAction = vi.fn();
vi.mock("@/lib/decks/actions", () => ({
  updateDeckAction: (...args: unknown[]) => updateDeckAction(...args),
  createDeckAction: vi.fn(),
}));
vi.mock("@/lib/media/upload-cover", () => ({ uploadCoverImage: vi.fn() }));
vi.mock("@/lib/feedback/actions", () => ({ submitFeedbackAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("category=bug"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/creator/panels/watermark-picker", () => ({ WatermarkPicker: () => null }));
vi.mock("@/components/creator/challenge-brief-dialog", () => ({ ChallengeBriefDialog: () => null }));

import { DeckCreatorForm } from "@/components/decks/deck-creator-form";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { PublishPanel } from "@/components/creator/panels/publish-panel";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/schemas";

afterEach(() => {
  cleanup();
  updateDeckAction.mockReset();
});

/** What `aria-describedby` says: the text of every element it names. */
function describedBy(control: Element): string | null {
  const ids = control.getAttribute("aria-describedby");
  if (!ids) return null;
  return ids
    .split(/\s+/)
    .map((id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`aria-describedby names #${id}, which is not on the page`);
      return el.textContent ?? "";
    })
    .join(" ");
}

const DECK = {
  id: "d1",
  owner_id: "u1",
  title: "Cinderwing",
  slug: "cinderwing",
  description: null,
  cover_url: null,
  cover_position: null,
  format: "commander",
  visibility: "public",
} as unknown as Deck;

describe("the deck editor's Format (3b.36)", () => {
  it("is named by its caption and described by the format's hint", () => {
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded />);
    const select = screen.getByRole("combobox", { name: "Format" });
    expect(select.hasAttribute("aria-label")).toBe(false);
    expect(describedBy(select)).toBe("100 cards including your commander, singleton.");
    fireEvent.change(select, { target: { value: "pauper" } });
    expect(describedBy(screen.getByRole("combobox", { name: "Format" }))).toBe("60+ cards, commons only.");
  });

  it("a save the server refuses on it focuses it, described by the error first", async () => {
    updateDeckAction.mockResolvedValue({ ok: false, fieldErrors: { format: "Pick a format." } });
    render(<DeckCreatorForm mode="edit" userId="u1" deck={DECK} embedded />);
    const save = screen.getByRole("button", { name: /save/i });
    save.focus();
    await act(async () => {
      fireEvent.click(save);
    });
    const select = screen.getByRole("combobox", { name: "Format" });
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(select)).toBe("Pick a format. 100 cards including your commander, singleton.");
  });
});

describe("the feedback form's category (3b.36)", () => {
  it("is ONE radiogroup named for the field and described by the category's hint", () => {
    render(<FeedbackForm signedIn />);
    const name = "What kind of feedback is this?";
    const row = screen.getByRole("radiogroup", { name });
    // No group of the same name round it (it said the field twice).
    expect(screen.queryByRole("group", { name })).toBeNull();
    const bug = FEEDBACK_CATEGORIES.find((c) => c.key === "bug")!;
    expect(describedBy(row)).toBe(bug.hint);
  });
});

describe("the Publish step's Save as a draft (3b.36)", () => {
  function Harness() {
    const methods = useForm({
      defaultValues: {
        deck_id: "",
        tags_text: "",
        visibility: "public",
        save_as_draft: false,
        frame_style: { finish: "regular", template: "m15" },
      },
    });
    return (
      <FormProvider {...methods}>
        <PublishPanel userId="u1" />
      </FormProvider>
    );
  }

  it("is named by its words and described by the line under them", () => {
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: "Save as a draft" });
    expect(box).toBe(screen.getByTestId("save-as-draft"));
    expect(describedBy(box)).toMatch(/^Private — only you can see it, and it needs just a title\./);
    // The whole box still ticks it.
    fireEvent.click(screen.getByText(/only you can see it/));
    expect((box as HTMLInputElement).checked).toBe(true);
  });
});
