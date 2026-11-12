// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// "Joined because of a friend?" — the code field on the Refer a friend page
// (owner 2026-11-11: code entry for NEW accounts only, 14 days). The page
// decides whether it shows; the SERVER reads and judges what is typed
// (claimReferralCodeAction) and answers in words. The field itself:
//
//   * a labelled input and "Add code"; nothing typed → the button is off and
//     nothing is sent;
//   * what is sent is what was typed, as typed (the server reads a code or a
//     pasted link out of it);
//   * a refusal is shown under the field — ONE alert, the input marked
//     invalid and described by it — and what was typed STAYS, to be fixed;
//   * success → the toast "Your friend's code is added.", the field cleared,
//     the page refreshed (it now shows who brought the account in);
//   * a second submit while the first is on its way sends nothing.
// ---------------------------------------------------------------------------

type Answer = { ok: true } | { ok: false; error: string };

const m = vi.hoisted(() => ({
  claim: vi.fn<(input: { code: string }) => Promise<{ ok: true } | { ok: false; error: string }>>(),
  refresh: vi.fn(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/referrals/claim-actions", () => ({ claimReferralCodeAction: m.claim }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: m.push }) }));
vi.mock("sonner", () => ({ toast: m.toast }));

import { ReferralCodeEntry } from "@/components/referrals/referral-code-entry";

const UNTIL = "2026-11-25T12:00:00.000Z";
const LABEL = "Your friend's referral code or link";
const UNKNOWN = "Nobody has that referral code. Check it with your friend and try again.";

const field = () => screen.getByLabelText(LABEL) as HTMLInputElement;
const button = () => screen.getByRole("button", { name: /Add code/ }) as HTMLButtonElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const press = async () => {
  await act(async () => {
    fireEvent.click(button());
  });
};
/** Enter in the field: the form's own submit. */
const enter = async () => {
  await act(async () => {
    fireEvent.submit(field().closest("form")!);
  });
};
const entry = () => render(<ReferralCodeEntry until={UNTIL} friendGets="7 free days" />);

beforeEach(() => {
  m.claim.mockReset().mockResolvedValue({ ok: true });
  m.refresh.mockReset();
  m.push.mockReset();
  for (const fn of Object.values(m.toast)) fn.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("ReferralCodeEntry", () => {
  it("a labelled field and its button, under a heading that says what it is for, what the friend gets and until when", () => {
    const { container } = entry();
    expect(screen.getByRole("heading", { name: "Joined because of a friend?" })).toBeTruthy();
    expect(field().tagName).toBe("INPUT");
    expect(button().type).toBe("submit");
    // "can": the reward is earned on the friend's cards and a check — never promised here.
    const words = container.querySelector("h2")?.parentElement?.querySelector("p")?.textContent?.replace(/\s+/g, " ");
    expect(words).toMatch(
      /^Add their referral code or link and you can both earn a reward — 7 free days for you once your cards are saved\. You can add it until .+\.$/,
    );
    expect(container.textContent).not.toContain("and you both earn a reward");
    // The day the window closes, as an instant the browser prints in its own zone.
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(UNTIL);
    // A code is not a word: no autocomplete, capitals or spell-check on it.
    expect(field().getAttribute("autocomplete")).toBe("off");
    expect(field().getAttribute("autocapitalize")).toBe("none");
    expect(field().getAttribute("spellcheck")).toBe("false");
  });

  it("starts with no error: nothing announced, the field not invalid and described by nothing", () => {
    entry();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBe("false");
    expect(field().hasAttribute("aria-describedby")).toBe(false);
  });

  it("nothing typed — or only spaces: the button is off, and Enter sends nothing", async () => {
    entry();
    expect(button().disabled).toBe(true);
    await enter();
    type("   ");
    expect(button().disabled).toBe(true);
    await enter();
    expect(m.claim).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    // A character typed turns it on; emptied, it is off again.
    type("a");
    expect(button().disabled).toBe(false);
    type("");
    expect(button().disabled).toBe(true);
  });

  it("sends what was typed, as typed — the server reads the code out of it", async () => {
    entry();
    for (const typed of ["ab12cd34", "  AB12CD34 ", "https://pipglyph.com/?ref=ab12cd34", "not a code at all"]) {
      m.claim.mockClear();
      m.claim.mockResolvedValueOnce({ ok: false, error: UNKNOWN });
      type(typed);
      await press();
      expect(m.claim.mock.calls, typed).toEqual([[{ code: typed }]]);
    }
  });

  it("Enter in the field submits as the button does", async () => {
    entry();
    type("ab12cd34");
    await enter();
    expect(m.claim.mock.calls).toEqual([[{ code: "ab12cd34" }]]);
    expect(m.toast.success).toHaveBeenCalledWith("Your friend's code is added.");
  });

  it("a refusal: the server's words in ONE alert, the field invalid and described by it — and what was typed stays", async () => {
    m.claim.mockResolvedValue({ ok: false, error: UNKNOWN });
    entry();
    type("ab12cd35");
    await press();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe(UNKNOWN);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(alerts[0].id).toBeTruthy();
    expect(field().getAttribute("aria-describedby")).toBe(alerts[0].id);
    // Kept, to be fixed — and the button is ready for the next try.
    expect(field().value).toBe("ab12cd35");
    expect(button().disabled).toBe(false);
    // Nothing celebrates, nothing reloads; the message is on the page, not a toast.
    expect(m.toast.success).not.toHaveBeenCalled();
    expect(m.toast.error).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("each refusal is said in its own words: the next try replaces the message, never stacks one", async () => {
    entry();
    for (const sentence of [
      "That doesn't look like a referral code or link. Check it and try again.",
      "That is your own code. Enter the code of the friend who told you about PipGlyph.",
      "A referral code can be added in an account's first 14 days, before a plan is started.",
      "That's a lot of tries. Wait a minute and try again.",
    ]) {
      m.claim.mockResolvedValueOnce({ ok: false, error: sentence });
      type("ab12cd35");
      await press();
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([sentence]);
    }
  });

  it("the message of the try before is gone while the next one is on its way", async () => {
    entry();
    m.claim.mockResolvedValueOnce({ ok: false, error: UNKNOWN });
    type("ab12cd35");
    await press();
    expect(screen.getByRole("alert").textContent).toBe(UNKNOWN);
    let answer!: (value: Answer) => void;
    m.claim.mockImplementationOnce(() => new Promise<Answer>((resolve) => (answer = resolve)));
    type("ab12cd34");
    await press();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBe("false");
    expect(field().hasAttribute("aria-describedby")).toBe(false);
    await act(async () => {
      answer({ ok: true });
    });
  });

  it("success: the toast, the field cleared, the page refreshed once — and no error left behind", async () => {
    entry();
    // A refusal first: its message must not outlive the code that lands.
    m.claim.mockResolvedValueOnce({ ok: false, error: UNKNOWN });
    type("ab12cd35");
    await press();
    type("ab12cd34");
    await press();
    expect(m.toast.success.mock.calls).toEqual([["Your friend's code is added."]]);
    expect(field().value).toBe("");
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBe("false");
    // Cleared means the button is off again.
    expect(button().disabled).toBe(true);
    // It never navigates away: the page is refreshed where it is.
    expect(m.push).not.toHaveBeenCalled();
  });

  it("a second submit while the first is pending sends NOTHING: one claim, the button off until it answers", async () => {
    let answer!: (value: Answer) => void;
    m.claim.mockImplementation(() => new Promise<Answer>((resolve) => (answer = resolve)));
    entry();
    type("ab12cd34");
    await press();
    expect(m.claim).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    // Enter again, and again — the form's submit is the path a disabled button doesn't close.
    await enter();
    await enter();
    expect(m.claim).toHaveBeenCalledTimes(1);
    // Nothing is said or done before the answer.
    expect(m.toast.success).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(field().value).toBe("ab12cd34");
    await act(async () => {
      answer({ ok: true });
    });
    expect(m.claim).toHaveBeenCalledTimes(1);
    expect(m.toast.success).toHaveBeenCalledTimes(1);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(field().value).toBe("");
  });

  it("a pending try that is REFUSED hands the field back as it was typed, ready to send again", async () => {
    let answer!: (value: Answer) => void;
    m.claim.mockImplementationOnce(() => new Promise<Answer>((resolve) => (answer = resolve)));
    entry();
    type("ab12cd35");
    await press();
    await act(async () => {
      answer({ ok: false, error: UNKNOWN });
    });
    expect(screen.getByRole("alert").textContent).toBe(UNKNOWN);
    expect(field().value).toBe("ab12cd35");
    expect(button().disabled).toBe(false);
    await press();
    expect(m.claim).toHaveBeenCalledTimes(2);
  });
});
