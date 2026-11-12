// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

// ---------------------------------------------------------------------------
// The onboarding wizard and the friend's referral code (owner 2026-11-11).
//
// Onboarding is where an account's referral is claimed, from the code this
// visit arrived with — the tab's, the address's, or the one the browser kept
// from an earlier visit (storedReferralCode). Two things were added:
//
//   * "Have a referral code?" — an OPTIONAL field on the last step, offered
//     unless THIS visit followed a friend's link (referralCodeSource() ===
//     "link": the tab holds the code, or it is on the address). A code the
//     browser only KEPT from an earlier visit — up to 30 days old, possibly
//     not the friend this person has in mind — leaves the field open, and
//     the field then asks about a DIFFERENT friend (the remembered link
//     already counts, and the note above the steps says so). It is read
//     after hydration, never on the server.
//   * Finish sends `referralCode` — the visit's code, the kept one included,
//     as before — AND, when the person typed something that reads as a code
//     (a code, or a pasted link), `typedReferralCode`: the code read out of
//     it, never the text itself. The server takes the typed one first. Text
//     that is no code is said before anything is saved and nothing is sent —
//     a kept code beside it changes nothing — on FINISH only: "Skip" is
//     never held up by an optional field (unreadable text is left behind).
//     With the field hidden, nothing typed is ever sent.
//
// After a finish that lands, the code kept in the browser is forgotten (the
// next person to sign up here did not follow that link), and a code that was
// sent and not taken — where retyping could help — is said once, in a toast.
// A finish that fails forgets nothing.
// ---------------------------------------------------------------------------

type Result = { ok: true; referralNote?: string; referralLinkCounted?: true } | { ok: false; error: string };
type Sent = {
  preferences?: Record<string, boolean>;
  referralCode?: string;
  typedReferralCode?: string;
  attribution?: Record<string, unknown>;
};

const m = vi.hoisted(() => ({
  complete: vi.fn<
    (input: Record<string, unknown>) => Promise<{ ok: true; referralNote?: string; referralLinkCounted?: true } | { ok: false; error: string }>
  >(),
  saveIdentity: vi.fn(),
  checkUsername: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/onboarding/actions", () => ({
  completeOnboardingAction: m.complete,
  saveOnboardingIdentityAction: m.saveIdentity,
  checkUsernameAction: m.checkUsername,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: m.refresh }) }));
vi.mock("sonner", () => ({ toast: m.toast }));
// Step 2's uploaders and the "You joined through a friend's link" line have
// their own tests; a guest draft is none of this file's business.
vi.mock("@/components/profile/profile-media-field", () => ({ ProfileMediaField: () => null }));
vi.mock("@/components/referrals/referral-join-note", () => ({ ReferralJoinNote: () => null }));
vi.mock("@/lib/creator/guest-draft", () => ({
  guestCardWaiting: () => false,
  onboardingFinishPath: (next: string) => next,
}));

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import {
  ATTRIBUTION_STORAGE_KEY,
  REFERRAL_CODE_STORAGE_KEY,
  keptReferralCode,
  referralCodeToKeep,
} from "@/lib/analytics/attribution";
import { REFERRAL_CODE_UNREADABLE, REFERRAL_LINK_COUNTED_INSTEAD } from "@/lib/referrals/claim-messages";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const TAB = "aaaa1111";
const ADDRESS = "bbbb2222";
const KEPT = "cccc3333";
const TYPED = "dddd4444";
const EMAIL = { account: true, activity: true, newsletter: false };
const INITIAL = { username: "kesh", displayName: "Kesh", bio: "", avatarUrl: null, bannerUrl: null, email: EMAIL };
// The field under either of its labels: "Have a referral code?", or — when
// the browser remembers a link — "A different friend's referral code?".
const FIELD = /referral code\?/;
const PLAIN_LABEL = /^Have a referral code\?/;
const OTHER_FRIEND_LABEL = /^A different friend's referral code\?/;

/** In-memory Web Storage, one per test (Node's own flag-less localStorage
 *  shadows happy-dom's and has no working methods). */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
}
const setTab = (value: unknown) => sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
const setAddress = (path: string) => window.history.replaceState(null, "", path);
const setKept = (code: string, at: number) => localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, referralCodeToKeep(code, at));
const kept = () => keptReferralCode(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY), Date.now());

const wizard = (next = "/dashboard") => render(<OnboardingWizard initial={INITIAL} next={next} />);
const click = async (name: RegExp | string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};
/** Walk to the last step as a person does: save the handle, keep the look. */
const toLastStep = async () => {
  await click("Save and continue");
  await click("Continue");
  expect(screen.getByRole("heading", { name: "Stay in the loop" })).toBeTruthy();
};
const codeField = () => screen.queryByLabelText(FIELD) as HTMLInputElement | null;
const type = (text: string) => fireEvent.change(codeField()!, { target: { value: text } });
const finish = () => click("Finish");
const skip = () => click(/^Skip/);
/** What the finish action was sent, call by call. */
const sent = () => m.complete.mock.calls.map((call) => call[0] as Sent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
  setAddress("/onboarding");
  m.complete.mockReset().mockResolvedValue({ ok: true });
  m.saveIdentity.mockReset().mockResolvedValue({ ok: true });
  m.checkUsername.mockReset().mockResolvedValue({ status: "available" });
  m.push.mockReset();
  m.refresh.mockReset();
  for (const fn of Object.values(m.toast)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setAddress("/");
});

describe("\"Have a referral code?\" — offered unless THIS visit followed a friend's link", () => {
  it("no code anywhere: an optional, labelled field on the LAST step — described by its hint, and on no other step", async () => {
    wizard();
    expect(codeField()).toBeNull();
    await click("Save and continue");
    expect(codeField()).toBeNull();
    await click("Continue");
    const field = codeField()!;
    expect(field.tagName).toBe("INPUT");
    expect(field.value).toBe("");
    expect(field.required).toBe(false);
    expect(screen.getByText("(optional)")).toBeTruthy();
    const hint = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe(
      "If a friend told you about PipGlyph, paste their code or link: you can both earn a reward once your first cards are saved.",
    );
    // A code is not a word.
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("autocapitalize")).toBe("none");
    expect(field.getAttribute("spellcheck")).toBe("false");
  });

  it.each([
    ["the tab holds the friend's code", () => setTab({ referrer: "reddit.com", ref: TAB })],
    ["the address carries it (/onboarding?ref=…)", () => setAddress(`/onboarding?next=%2Fcreate&ref=${ADDRESS}`)],
    ["the tab's link, with an older kept code beside it", () => (setTab({ ref: TAB }), setKept(KEPT, NOW - 9 * DAY))],
    ["the address's link, with an older kept code beside it", () => (setAddress(`/onboarding?ref=${ADDRESS}`), setKept(KEPT, NOW - 9 * DAY))],
  ])("this visit followed a link — %s: no field", async (_name, arrive) => {
    arrive();
    wizard();
    await toLastStep();
    expect(codeField()).toBeNull();
    expect(screen.queryByText(FIELD)).toBeNull();
  });

  it.each([
    ["a code the browser only KEPT from an earlier visit (it may not be the friend they have in mind)", () => setKept(KEPT, NOW - 9 * DAY)],
    ["a code kept 30 days ago to the millisecond", () => setKept(KEPT, NOW - 30 * DAY)],
    ["a kept code past its 30 days", () => setKept(KEPT, NOW - 30 * DAY - 1)],
    ["a tab with a first touch and no code", () => setTab({ referrer: "google.com", utmSource: "newsletter" })],
    ["a value on the address that is no code", () => setAddress("/onboarding?ref=nope")],
    ["an unreadable kept value", () => localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, "{not json")],
  ])("no link came with THIS visit — %s: the field is offered", async (_name, arrive) => {
    arrive();
    wizard();
    await toLastStep();
    expect(codeField()).not.toBeNull();
    expect(codeField()!.value).toBe("");
  });

  it("with a link the browser only REMEMBERS the field asks about a DIFFERENT friend — the link already counts — and with none it asks plainly", async () => {
    setKept(KEPT, NOW - 9 * DAY);
    wizard();
    await toLastStep();
    const field = codeField()!;
    expect(screen.getByLabelText(OTHER_FRIEND_LABEL)).toBe(field);
    expect(screen.queryByLabelText(PLAIN_LABEL)).toBeNull();
    expect(screen.getByText("(optional)")).toBeTruthy();
    expect(document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "This browser remembers a friend's link you opened before, and it counts. If someone else told you about PipGlyph, paste their code or link here instead.",
    );
    cleanup();
    // A kept code past its 30 days is no remembered link.
    setKept(KEPT, NOW - 30 * DAY - 1);
    wizard();
    await toLastStep();
    expect(screen.getByLabelText(PLAIN_LABEL)).toBe(codeField());
    expect(screen.queryByLabelText(OTHER_FRIEND_LABEL)).toBeNull();
  });

  it("the server's render reads no browser store (the link lives in the browser: it is read after hydration)", () => {
    const session = { ...memoryStorage(), getItem: vi.fn(() => null) };
    const local = { ...memoryStorage(), getItem: vi.fn(() => null) };
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    const html = renderToString(<OnboardingWizard initial={INITIAL} next="/dashboard" />);
    expect(html).toContain("Claim your handle");
    expect(html).not.toMatch(FIELD);
    expect(session.getItem).not.toHaveBeenCalled();
    expect(local.getItem).not.toHaveBeenCalled();
  });

  it("storage the browser refuses: the wizard still renders, and the field is offered (there is no link to go by)", async () => {
    const refuse = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
    vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
    wizard();
    await toLastStep();
    expect(codeField()).not.toBeNull();
    type(TYPED);
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, typedReferralCode: TYPED }]);
    expect(m.push).toHaveBeenCalledWith("/dashboard");
  });
});

describe("Finish — which codes are sent", () => {
  it("the visit's own code (the tab's) as `referralCode`, with the first touch beside it and never inside it — and no typed code (there is no field)", async () => {
    setTab({ referrer: "reddit.com", utmSource: "friend", ref: TAB });
    wizard();
    await toLastStep();
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, referralCode: TAB, attribution: { referrer: "reddit.com", utmSource: "friend" } }]);
    expect("typedReferralCode" in sent()[0]).toBe(false);
  });

  it("the code on the address, when the tab holds none", async () => {
    setAddress(`/onboarding?ref=${ADDRESS.toUpperCase()}`);
    wizard();
    await toLastStep();
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, referralCode: ADDRESS }]);
  });

  it("the code the browser KEPT — a visit days later, in a new tab, with no ?ref= at all — when nothing is typed", async () => {
    setKept(KEPT, NOW - 9 * DAY);
    wizard();
    await toLastStep();
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, referralCode: KEPT }]);
  });

  it("a kept code AND a code typed: BOTH travel, each under its own name — the server takes the person's own word first", async () => {
    setKept(KEPT, NOW - 9 * DAY);
    wizard();
    await toLastStep();
    type(`https://pipglyph.com/?ref=${TYPED.toUpperCase()}`);
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, referralCode: KEPT, typedReferralCode: TYPED }]);
  });

  it("the tab's code wins over the address and the kept one", async () => {
    setTab({ ref: TAB });
    setAddress(`/onboarding?ref=${ADDRESS}`);
    setKept(KEPT, NOW - DAY);
    wizard();
    await toLastStep();
    await finish();
    expect(sent()[0].referralCode).toBe(TAB);
    expect("typedReferralCode" in sent()[0]).toBe(false);
  });

  it("no link came with the visit: the code read out of what was TYPED, as `typedReferralCode` — a code in any case, or the friend's whole link — never the text itself", async () => {
    for (const typed of [TYPED, `  ${TYPED.toUpperCase()} `, `https://pipglyph.com/?ref=${TYPED}`, `pipglyph.com/card/kesh/ember-sphinx?via=copy&ref=${TYPED}#top`]) {
      m.complete.mockClear();
      wizard();
      await toLastStep();
      type(typed);
      await finish();
      expect(sent(), typed).toEqual([{ preferences: EMAIL, typedReferralCode: TYPED }]);
      expect(screen.queryByRole("alert"), typed).toBeNull();
      cleanup();
    }
  });

  it("nothing typed and no link: no code key at all — the field is optional", async () => {
    wizard();
    await toLastStep();
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL }]);
    expect(Object.keys(sent()[0])).toEqual(["preferences"]);
    cleanup();
    // Only spaces is nothing typed.
    m.complete.mockClear();
    wizard();
    await toLastStep();
    type("   ");
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("text typed that is NOT a code: said in the form's alert, and the action is not called — nothing is saved, nobody is sent anywhere", async () => {
    for (const typed of ["hello there", "dddd444", "dddd44444", "https://pipglyph.com/", "https://pipglyph.com/?ref=nope", "https://pipglyph.com/?ref=%zz"]) {
      wizard();
      await toLastStep();
      type(typed);
      await finish();
      expect(screen.getByRole("alert").textContent, typed).toBe(REFERRAL_CODE_UNREADABLE);
      expect(m.complete, typed).not.toHaveBeenCalled();
      expect(m.push, typed).not.toHaveBeenCalled();
      expect(m.refresh, typed).not.toHaveBeenCalled();
      expect(m.toast.message, typed).not.toHaveBeenCalled();
      // Still on the step, the text kept, the buttons ready: it can be fixed.
      expect(codeField()!.value, typed).toBe(typed);
      expect((screen.getByRole("button", { name: "Finish" }) as HTMLButtonElement).disabled, typed).toBe(false);
      cleanup();
    }
    expect(REFERRAL_CODE_UNREADABLE).toBe("That doesn't look like a referral code or link. Check it and try again.");
  });

  it("…also when the browser KEPT a code: what was typed is not quietly dropped for the kept one — it is said, nothing is sent, and the kept code is not forgotten", async () => {
    setKept(KEPT, NOW - 9 * DAY);
    wizard();
    await toLastStep();
    type("not a code");
    await finish();
    expect(screen.getByRole("alert").textContent).toBe(REFERRAL_CODE_UNREADABLE);
    expect(m.complete).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(kept()).toBe(KEPT);
    // Emptied, the kept code is what is sent.
    type("");
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, referralCode: KEPT }]);
  });

  it("fixed, it goes through: the message clears and the code is sent — or the field is emptied and the account is finished without one", async () => {
    wizard();
    await toLastStep();
    type("not a code");
    await finish();
    expect(screen.getByRole("alert").textContent).toBe(REFERRAL_CODE_UNREADABLE);
    type(TYPED);
    await finish();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent()).toEqual([{ preferences: EMAIL, typedReferralCode: TYPED }]);
    expect(m.push).toHaveBeenCalledWith("/dashboard");
    cleanup();

    m.complete.mockClear();
    wizard();
    await toLastStep();
    type("not a code");
    await finish();
    type("");
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL }]);
  });

  it("with the field HIDDEN nothing typed is sent: text typed before this visit's link was known does not travel", async () => {
    wizard();
    await toLastStep();
    type(TYPED);
    // The visit turns out to have a link after all (the layout's capture stored it).
    setTab({ ref: TAB });
    // Any re-render reads the stores again: here, a preference toggled.
    fireEvent.click(screen.getByRole("checkbox", { name: /newsletter/i }));
    expect(codeField()).toBeNull();
    await finish();
    expect(sent()).toEqual([{ preferences: { ...EMAIL, newsletter: true }, referralCode: TAB }]);
    expect("typedReferralCode" in sent()[0]).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    // …and junk typed before it is no reason to stop the finish either.
    m.complete.mockClear();
    vi.stubGlobal("sessionStorage", memoryStorage());
    wizard();
    await toLastStep();
    type("not a code");
    setTab({ ref: TAB });
    fireEvent.click(screen.getByRole("checkbox", { name: /newsletter/i }));
    await finish();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent()).toEqual([{ preferences: { ...EMAIL, newsletter: true }, referralCode: TAB }]);
  });

  it("\"Skip\" carries the codes the same way: the defaults for the emails (no preferences sent), the friend's code still claimed", async () => {
    // From the first step, with a kept code and the field never seen.
    setKept(KEPT, NOW - DAY);
    wizard();
    await skip();
    expect(sent()).toEqual([{ referralCode: KEPT }]);
    cleanup();
    // From the last step, with a code typed.
    localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
    m.complete.mockClear();
    wizard();
    await toLastStep();
    type(TYPED);
    await skip();
    expect(sent()).toEqual([{ typedReferralCode: TYPED }]);
  });
});

describe("\"Skip\" is never held up by the optional field", () => {
  it("text that is NO code: Skip goes through — no alert, the typed text left behind, the account finished", async () => {
    for (const typed of ["hello there", "dddd444", "https://pipglyph.com/?ref=nope"]) {
      m.complete.mockClear();
      m.push.mockClear();
      wizard();
      await toLastStep();
      type(typed);
      await skip();
      expect(screen.queryByRole("alert"), typed).toBeNull();
      expect(sent(), typed).toEqual([{}]);
      expect(m.push.mock.calls, typed).toEqual([["/dashboard"]]);
      cleanup();
    }
  });

  it("…and the link the browser remembered still travels with it", async () => {
    setKept(KEPT, NOW - DAY);
    wizard();
    await toLastStep();
    type("not a code");
    await skip();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent()).toEqual([{ referralCode: KEPT }]);
  });

  it("after a Finish that was stopped for the same text, Skip still goes through and the message clears", async () => {
    wizard();
    await toLastStep();
    type("not a code");
    await finish();
    expect(screen.getByRole("alert").textContent).toBe(REFERRAL_CODE_UNREADABLE);
    expect(m.complete).not.toHaveBeenCalled();
    await skip();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent()).toEqual([{}]);
    expect(m.push).toHaveBeenCalledTimes(1);
  });
});

describe("after Finish", () => {
  it("a finish that lands FORGETS the code the browser kept — and goes on to where it was headed", async () => {
    setKept(KEPT, NOW - 9 * DAY);
    localStorage.setItem("cardforge-other", "stays");
    wizard("/create");
    await toLastStep();
    expect(kept()).toBe(KEPT);
    await finish();
    expect(sent()[0].referralCode).toBe(KEPT);
    expect(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("cardforge-other")).toBe("stays");
    expect(m.push.mock.calls).toEqual([["/create"]]);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("forgets it whichever code was sent — a kept code under the tab's is not left for the next person to sign up here", async () => {
    setTab({ ref: TAB });
    setKept(KEPT, NOW - DAY);
    wizard();
    await toLastStep();
    await finish();
    expect(sent()[0].referralCode).toBe(TAB);
    expect(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)).toBeNull();
  });

  it("the code is forgotten only AFTER the server answered: it is still kept while the finish is on its way", async () => {
    setKept(KEPT, NOW - DAY);
    let answer!: (value: Result) => void;
    m.complete.mockImplementation(() => new Promise<Result>((resolve) => (answer = resolve)));
    wizard();
    await toLastStep();
    await finish();
    expect(m.complete).toHaveBeenCalledTimes(1);
    expect(kept()).toBe(KEPT);
    expect(m.push).not.toHaveBeenCalled();
    await act(async () => {
      answer({ ok: true });
    });
    expect(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)).toBeNull();
    expect(m.push).toHaveBeenCalledTimes(1);
  });

  it("a finish that FAILS forgets nothing: the error is shown, the kept code is still there for the next try, nobody is sent anywhere", async () => {
    setKept(KEPT, NOW - DAY);
    m.complete.mockResolvedValueOnce({ ok: false, error: "Couldn't save your email preferences. Please try again." });
    wizard();
    await toLastStep();
    await finish();
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save your email preferences. Please try again.");
    expect(kept()).toBe(KEPT);
    expect(m.push).not.toHaveBeenCalled();
    expect(m.toast.message).not.toHaveBeenCalled();
    // The next try sends the same code, and then it is forgotten.
    await finish();
    expect(sent().map((input) => input.referralCode)).toEqual([KEPT, KEPT]);
    expect(localStorage.getItem(REFERRAL_CODE_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a code that was sent and NOT taken (the server's referralNote): said once in a toast, with where to add it later — and onboarding still goes on", async () => {
    const note = "Nobody has that referral code. Check it with your friend and try again.";
    m.complete.mockResolvedValue({ ok: true, referralNote: note });
    wizard();
    await toLastStep();
    type(TYPED);
    await finish();
    expect(m.toast.message.mock.calls).toEqual([[`${note} You can add it later from Refer a friend.`]]);
    // A note, not an error: nothing in the form's alert, and the account goes on.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(m.toast.error).not.toHaveBeenCalled();
    expect(m.push.mock.calls).toEqual([["/dashboard"]]);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("a typed code not taken and the remembered LINK counted in its place: the toast says exactly that — and never \"add it later\" (an account has one referral)", async () => {
    setKept(KEPT, NOW - DAY);
    m.complete.mockResolvedValue({ ok: true, referralNote: REFERRAL_LINK_COUNTED_INSTEAD, referralLinkCounted: true });
    wizard();
    await toLastStep();
    type(TYPED);
    await finish();
    expect(sent()).toEqual([{ preferences: EMAIL, referralCode: KEPT, typedReferralCode: TYPED }]);
    expect(m.toast.message.mock.calls).toEqual([[REFERRAL_LINK_COUNTED_INSTEAD]]);
    expect(String(m.toast.message.mock.calls[0][0])).not.toMatch(/later/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(m.push.mock.calls).toEqual([["/dashboard"]]);
  });

  it("no note in the answer: no toast at all", async () => {
    wizard();
    await toLastStep();
    type(TYPED);
    await finish();
    expect(m.toast.message).not.toHaveBeenCalled();
    expect(m.toast.success).not.toHaveBeenCalled();
    expect(m.toast.error).not.toHaveBeenCalled();
    expect(m.push).toHaveBeenCalledTimes(1);
  });
});
