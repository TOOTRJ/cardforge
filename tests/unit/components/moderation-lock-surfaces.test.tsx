// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { chipOff } from "../helpers/chip";

// ---------------------------------------------------------------------------
// The moderation lock (migration 0156) on the owner's go-public surfaces:
//  - the creator's Publish step on an edit of a locked card offers neither
//    Public nor Unlisted (aria-disabled, the reason in their name) and says
//    why once, with a way to contact the team;
//  - the deck's private-cards notice lists a locked card as "Hidden by
//    moderation" with no "Make public", leaves it out of "Make all", and
//    its toast counts a card the server held back.
// ---------------------------------------------------------------------------

const updateCardsVisibilityAction = vi.fn();
const unhideCardAction = vi.fn();
const push = vi.fn();
vi.mock("@/lib/moderation/actions", () => ({ unhideCardAction: (...args: unknown[]) => unhideCardAction(...args) }));
vi.mock("@/lib/admin/admin-toast", () => ({ adminErrorToast: vi.fn() }));
const toastSuccess = vi.fn();
vi.mock("@/lib/cards/actions", () => ({
  updateCardsVisibilityAction: (...args: unknown[]) => updateCardsVisibilityAction(...args),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: (...a: unknown[]) => toastSuccess(...a), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push }),
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

import { PublishPanel } from "@/components/creator/panels/publish-panel";
import { DeckPrivateCardsNotice } from "@/components/decks/deck-private-cards-notice";
import { HiddenCardsList } from "@/components/moderation/hidden-cards-list";
import { RemixButton } from "@/components/cards/remix-button";

afterEach(() => {
  cleanup();
  updateCardsVisibilityAction.mockReset();
  toastSuccess.mockReset();
  unhideCardAction.mockReset();
  push.mockReset();
});

function Harness({ locked }: { locked: boolean }) {
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
      <PublishPanel userId="u1" revise moderationLocked={locked} />
    </FormProvider>
  );
}

const visibilityChip = (label: RegExp) => {
  const group = screen.getByRole("radiogroup", { name: "Visibility" });
  const chip = Array.from(group.querySelectorAll("[role='radio']")).find((el) => label.test(el.textContent ?? ""));
  if (!chip) throw new Error(`no chip ${label}`);
  return chip;
};

describe("the Publish step on an edit of a locked card", () => {
  it("offers neither choice and says why, with a contact link", () => {
    render(<Harness locked />);
    expect(chipOff(visibilityChip(/^Public/))).toBe(true);
    expect(chipOff(visibilityChip(/^Unlisted/))).toBe(true);
    const note = screen.getByTestId("moderation-lock-note");
    expect(note.textContent).toMatch(/moderation team hid this card/);
    expect(note.querySelector("a")?.getAttribute("href")).toBe("/feedback");
    // The chips are described by the note; the strong-language note stays empty.
    const group = screen.getByRole("radiogroup", { name: "Visibility" });
    expect(group.getAttribute("aria-describedby")).toBe(note.id);
    expect(screen.getByTestId("strong-language-note").textContent).toBe("");
  });

  it("an unlocked card is offered both, with no note", () => {
    render(<Harness locked={false} />);
    expect(chipOff(visibilityChip(/^Public/))).toBe(false);
    expect(chipOff(visibilityChip(/^Unlisted/))).toBe(false);
    expect(screen.queryByTestId("moderation-lock-note")).toBeNull();
  });
});

describe("the deck's private-cards notice", () => {
  const cards = [
    { id: "a", title: "Open One", moderationLocked: false },
    { id: "b", title: "Open Two", moderationLocked: false },
    { id: "c", title: "Locked One", moderationLocked: true },
  ];

  it("lists a locked card as hidden by moderation, with no button, and leaves it out of Make all", async () => {
    updateCardsVisibilityAction.mockResolvedValue({ ok: true, count: 2, skippedPreviews: 0 });
    render(<DeckPrivateCardsNotice cards={cards} deckVisibility="public" />);
    expect(screen.queryByRole("button", { name: "Make Locked One public" })).toBeNull();
    expect(screen.getByText("Hidden by moderation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make Open One public" })).toBeTruthy();
    const all = screen.getByRole("button", { name: /Make all 2 public/ });
    await act(async () => {
      fireEvent.click(all);
    });
    expect(updateCardsVisibilityAction).toHaveBeenCalledWith(["a", "b"], "public");
  });

  it("the toast counts a card the server held back for the lock", async () => {
    updateCardsVisibilityAction.mockResolvedValue({ ok: true, count: 1, skippedPreviews: 0, skippedModeration: 1 });
    render(<DeckPrivateCardsNotice cards={[cards[0]]} deckVisibility="unlisted" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make Open One public" }));
    });
    expect(toastSuccess).toHaveBeenCalledWith("1 card is public now. 1 card stayed private: it was hidden by moderation.");
  });
});

describe("the admin's Hidden cards list", () => {
  const rows = [
    { cardId: "a", title: "First", detail: "@dev_pro · Hidden from a report" },
    { cardId: "b", title: "Second", detail: "@dev_pro · Hidden from a report" },
  ];

  it("titles are plain text (a private card's page 404s for the admin)", () => {
    render(<HiddenCardsList rows={rows} headingId="h" />);
    expect(screen.queryByRole("link", { name: "First" })).toBeNull();
    expect(screen.getByText("First")).toBeTruthy();
  });

  it("an unhidden row leaves, and the focus goes to the next row's Unhide — then to the heading", async () => {
    unhideCardAction.mockResolvedValue({ ok: true });
    render(<HiddenCardsList rows={rows} headingId="h" />);
    const first = screen.getByRole("button", { name: "Unhide First" });
    first.focus();
    await act(async () => {
      fireEvent.click(first);
    });
    expect(unhideCardAction).toHaveBeenCalledWith({ cardId: "a" });
    expect(screen.queryByText("First")).toBeNull();
    const second = screen.getByRole("button", { name: "Unhide Second" });
    expect(document.activeElement).toBe(second);
    await act(async () => {
      fireEvent.click(second);
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Hidden cards" }));
  });
});

describe("Remix on a card moderation hid", () => {
  it("is unavailable, says why, and goes nowhere", () => {
    const reason = "This card was hidden by moderation, so it can't be remixed. Contact us if you think that's a mistake.";
    render(<RemixButton cardId="c1" unavailableReason={reason} />);
    const button = screen.getByRole("button", { name: "Remix" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe(reason);
    fireEvent.click(button);
    expect(push).not.toHaveBeenCalled();
  });

  it("an unlocked card's Remix opens the creator", () => {
    render(<RemixButton cardId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Remix" }));
    expect(push).toHaveBeenCalledWith("/create?remix=c1");
  });
});
