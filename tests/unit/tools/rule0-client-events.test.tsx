// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// What the Rule 0 table sheet's editor records from the BROWSER (tool_events,
// through trackToolEvent): the moments no server code sees — the link
// copied, the sheet printed, and an AI draft whose answer never reached the
// page (`ai_draft_lost`: a dropped connection, or a function the platform
// stopped — the route recorded nothing then). A draft the ROUTE answered,
// made or refused, is the route's to record (rule0-events.test.ts), never
// twice.
//
// "Copy link" also carries the SHARER's referral code since 2026-11-11 (the
// owner: every other share did, this plain copy lost it): the sheet's address
// with `ref=<code>` and nothing else added, for a signed-in sharer while the
// program is on — and the plain address whenever there is no code to add
// (signed out, the program off, the read failed or is not back yet).
//
// The code is read ONCE, when the editor mounts — never in the click: a
// browser lets a page write the clipboard only straight from the press, and
// Safari refuses after a network read was awaited. So the press writes at
// once, from what the mount's read left behind.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  track: vi.fn<(slug: string, event: string, props?: Record<string, unknown>) => void>(() => undefined),
  /** readReferralShareInfo: the viewer's referral share info (null = the read failed). */
  share: vi.fn<() => Promise<{ enabled: boolean; code: string | null } | null>>(async () => null),
}));

vi.mock("@/lib/tools/track-client", () => ({ trackToolEvent: m.track }));
vi.mock("@/lib/tools/rule0/actions", () => ({ saveTableSheetAction: vi.fn(), setTableSheetSharedAction: vi.fn() }));
vi.mock("@/components/tools/rule0/table-sheet", () => ({ TableSheet: () => null }));
vi.mock("@/components/ai/use-leave-warning", () => ({ useLeaveWarning: () => undefined }));
vi.mock("@/components/billing/credits-bus", () => ({ publishCredits: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/sharing/referral-share-client", () => ({ readReferralShareInfo: m.share }));

import { toast } from "sonner";
import { TableSheetEditor } from "@/components/tools/rule0/table-sheet-editor";
import type { TableSheetFacts } from "@/lib/tools/rule0/sheet";

const FACTS = {
  commanders: [],
  cardCount: 100,
  custom: [],
  customCount: 3,
  proxies: [],
  proxyCount: 0,
  realCount: 97,
  notFound: [],
  notFoundCount: 0,
  gameChangers: [],
  estimate: null,
} as TableSheetFacts;

function editor() {
  render(
    <TableSheetEditor
      deckId="22222222-2222-4222-8222-222222222222"
      deckSlug="wolf-pack"
      deckVisibility="public"
      deck={{ title: "Wolf Pack" } as never}
      facts={FACTS}
      initial={{ gamePlan: null, winConditions: null, tableNotes: null, shared: true, aiDraftedAt: null, updatedAt: null }}
      qr={null}
      shareUrl="https://pipglyph.test/deck/wolf-pack/table-sheet"
      aiAvailable
    />,
  );
}

const draft = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
  });
};

const events = () => m.track.mock.calls.map(([slug, event, props]) => [slug, event, props]);

beforeEach(() => {
  m.track.mockClear();
  m.track.mockReturnValue(undefined);
  m.share.mockReset().mockResolvedValue(null);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Never the deck's name, its address or an id.
  for (const [, , props] of m.track.mock.calls) {
    expect(JSON.stringify(props ?? {})).not.toMatch(/wolf|pipglyph|2222/i);
  }
});

describe("an AI draft whose answer never reached the page", () => {
  it("a dropped connection: ai_draft_lost, network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("We lost the answer");
    expect(events()).toEqual([["rule0-sheet", "ai_draft_lost", { reason: "network", ms: expect.any(Number) }]]);
  });

  it("an answer that isn't the route's (a platform error page): ai_draft_lost, no_answer, with its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>504</html>", { status: 504 })));
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("didn't finish");
    expect(events()).toEqual([["rule0-sheet", "ai_draft_lost", { reason: "no_answer", status: 504, ms: expect.any(Number) }]]);
  });

  it("a refusal the route answered is the route's to record: nothing from the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error: "Out of credits.", code: "INSUFFICIENT_CREDITS" }, { status: 402 })),
    );
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("Out of credits.");
    expect(m.track).not.toHaveBeenCalled();
  });

  it("a draft that arrived records nothing from the browser either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, draft: { gamePlan: "Ramp.", winConditions: ["Dragons"] }, sheet: null, credits: 3 })),
    );
    editor();
    await draft();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(m.track).not.toHaveBeenCalled();
  });

  it("a tracking call that fails never changes what the page says", async () => {
    m.track.mockImplementation(() => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    editor();
    await draft();
    expect(screen.getByRole("alert").textContent).toContain("We lost the answer");
  });
});

describe("the editor's other browser events (unchanged)", () => {
  it("Print records print, with whether the sheet is shared and how many custom cards it names", async () => {
    vi.stubGlobal("print", vi.fn());
    editor();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Print$/ }));
    });
    expect(events()).toEqual([["rule0-sheet", "print", { shared: true, custom: 3 }]]);
  });
});

describe("Copy link carries the sharer's referral code", () => {
  const SHEET = "https://pipglyph.test/deck/wolf-pack/table-sheet";
  const CODE = "ab12cd34";
  type Info = { enabled: boolean; code: string | null } | null;
  /** What the clipboard was handed, in order. */
  const clipboard = (writeText?: (text: string) => Promise<void>) => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeText ?? (async (text: string) => void copied.push(text)) },
      configurable: true,
    });
    return copied;
  };
  /** The editor, with the mount's read of the referral info back. */
  const opened = async () => {
    editor();
    await act(async () => {});
  };
  const copyButton = () => screen.getByRole("button", { name: /Copy link/ });
  const copy = async () => {
    await act(async () => {
      fireEvent.click(copyButton());
    });
  };

  it("the referral info is read ONCE, when the editor mounts — before any press, and never again by one", async () => {
    m.share.mockResolvedValue({ enabled: true, code: CODE });
    const copied = clipboard();
    editor();
    expect(m.share).toHaveBeenCalledTimes(1);
    await act(async () => {});
    await copy();
    await copy();
    expect(copied).toEqual([`${SHEET}?ref=${CODE}`, `${SHEET}?ref=${CODE}`]);
    expect(m.share).toHaveBeenCalledTimes(1);
  });

  it("a signed-in sharer, the program on: the sheet's address with ref=<their code> and nothing else added", async () => {
    m.share.mockResolvedValue({ enabled: true, code: CODE });
    const copied = clipboard();
    await opened();
    await copy();
    expect(copied).toEqual([`${SHEET}?ref=${CODE}`]);
    const link = new URL(copied[0]);
    expect([...link.searchParams.keys()]).toEqual(["ref"]);
    expect(`${link.origin}${link.pathname}`).toBe(SHEET);
    expect(toast.success).toHaveBeenCalledWith("Link copied.");
    // The event is the same one, with no props: the code is never tracked.
    expect(events()).toEqual([["rule0-sheet", "copy_link", undefined]]);
    expect(JSON.stringify(m.track.mock.calls)).not.toContain(CODE);
  });

  it("THE PRESS WRITES AT ONCE: the clipboard is handed the link inside the click itself — nothing is awaited first (Safari refuses a write after an awaited read)", async () => {
    m.share.mockResolvedValue({ enabled: true, code: CODE });
    const copied = clipboard();
    await opened();
    // No act, no await: what the click handler did synchronously.
    fireEvent.click(copyButton());
    expect(copied).toEqual([`${SHEET}?ref=${CODE}`]);
    expect(m.share).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith("Link copied.");
  });

  it("a press BEFORE the read is back copies the plain link at once — it never waits for it", async () => {
    let answer!: (info: Info) => void;
    m.share.mockImplementation(() => new Promise<Info>((resolve) => (answer = resolve)));
    const copied = clipboard();
    editor();
    fireEvent.click(copyButton());
    expect(copied).toEqual([SHEET]);
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith("Link copied.");
    // Once it is back, the next press carries the code.
    await act(async () => {
      answer({ enabled: true, code: CODE });
    });
    await copy();
    expect(copied).toEqual([SHEET, `${SHEET}?ref=${CODE}`]);
  });

  it.each([
    ["a visitor or an account with no code", { enabled: true, code: null }],
    ["the program off (even with a code in the answer)", { enabled: false, code: "ab12cd34" }],
    ["a read that failed (null)", null],
  ] as const)("%s: the plain link", async (_name, info) => {
    m.share.mockResolvedValue(info);
    const copied = clipboard();
    await opened();
    await copy();
    expect(copied).toEqual([SHEET]);
    expect(toast.success).toHaveBeenCalledWith("Link copied.");
    expect(events()).toEqual([["rule0-sheet", "copy_link", undefined]]);
  });

  it("a read that REJECTS never costs the copy — nor the page: the plain link, the same toast, no error", async () => {
    m.share.mockRejectedValue(new TypeError("Failed to fetch"));
    const copied = clipboard();
    await opened();
    await copy();
    expect(copied).toEqual([SHEET]);
    expect(toast.success).toHaveBeenCalledWith("Link copied.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("an answer that arrives after the editor is gone is dropped quietly", async () => {
    let answer!: (info: Info) => void;
    m.share.mockImplementation(() => new Promise<Info>((resolve) => (answer = resolve)));
    editor();
    cleanup();
    await expect(
      act(async () => {
        answer({ enabled: true, code: CODE });
      }),
    ).resolves.toBeUndefined();
  });

  it("a clipboard that refuses says so, and records no copy", async () => {
    m.share.mockResolvedValue({ enabled: true, code: CODE });
    clipboard(async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    });
    await opened();
    await copy();
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy — the link is in your address bar.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(m.track).not.toHaveBeenCalled();
  });

  it("the source says the same: copyLink reads nothing — its first await is the clipboard write, and the read lives in the mount's effect", () => {
    const source = readFileSync(join(process.cwd(), "components/tools/rule0/table-sheet-editor.tsx"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    const start = code.indexOf("const copyLink = async () => {");
    expect(start).toBeGreaterThan(-1);
    const copyLink = code.slice(start, code.indexOf("const print = ", start));
    expect(copyLink).not.toContain("readReferralShareInfo");
    expect(copyLink).not.toContain("fetch(");
    expect(copyLink.match(/\bawait\b/g)).toHaveLength(1);
    expect(copyLink).toContain("await navigator.clipboard.writeText(referralUrlFor(shareUrl, referralCode.current))");
    // The one read in the file is inside an effect that runs on mount.
    expect(code.match(/readReferralShareInfo\(\)/g)).toHaveLength(1);
    const effect = code.slice(code.indexOf("useEffect(() => {"), start);
    expect(effect).toContain("readReferralShareInfo()");
    expect(effect).toMatch(/\}, \[\]\);/);
  });
});
