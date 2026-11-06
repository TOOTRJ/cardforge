// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ReferralLinkBox } from "@/components/referrals/referral-link-box";

// The referral link box: the link in a labelled read-only field, Copy puts
// it on the clipboard and says so, Email drafts a message that carries it.

const LINK = "https://pipglyph.com/?ref=d0000003";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReferralLinkBox", () => {
  it("shows the link in a labelled field and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ReferralLinkBox link={LINK} />);
    expect((screen.getByLabelText("Your referral link") as HTMLInputElement).value).toBe(LINK);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(toast.success).toHaveBeenCalledWith("Your referral link is copied.");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("a refused clipboard says so", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => { throw new Error("denied"); }) },
      configurable: true,
    });
    render(<ReferralLinkBox link={LINK} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(toast.error).toHaveBeenCalled();
  });

  it("the email draft carries the link", () => {
    render(<ReferralLinkBox link={LINK} />);
    const href = screen.getByRole("link", { name: "Email a friend" }).getAttribute("href") ?? "";
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(href)).toContain(LINK);
  });

  it("Copy the message puts the SAME text as the email draft on the clipboard, with the link, and says where to paste it (a browser with no mail handler does nothing on mailto:)", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ReferralLinkBox link={LINK} friendGets="30 free days of Plus" />);
    const href = screen.getByRole("link", { name: "Email a friend" }).getAttribute("href") ?? "";
    const body = decodeURIComponent(href.slice(href.indexOf("&body=") + "&body=".length));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy the message" }));
    });
    expect(writeText).toHaveBeenCalledWith(body);
    expect(body).toContain("30 free days of Plus");
    expect(body.endsWith(LINK)).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("The message and your link are copied — paste them into any email or chat.");
    expect(screen.getByRole("button", { name: "Message copied" })).toBeTruthy();
    expect(screen.getByText(/If nothing opens, Copy the message/)).toBeTruthy();
  });
});
