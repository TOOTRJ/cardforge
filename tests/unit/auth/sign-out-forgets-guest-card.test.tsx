// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO HM3: a guest's card waits in the BROWSER, so a sign-out takes it with
// the session — otherwise the next guest, or the next account, on this
// browser would be handed it. Every sign-out path forgets it.
// ---------------------------------------------------------------------------

const forget = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/creator/guest-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/creator/guest-draft")>()),
  forgetGuestCard: forget,
}));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));

import { LogoutButton } from "@/components/auth/logout-button";

const ROOT = path.resolve(__dirname, "../../..");
const SIGN_OUT_ACTIONS = /\b(logoutAction|signOutEverywhereAction|deleteAccountAction)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

afterEach(() => {
  cleanup();
  forget.mockClear();
});

describe("every sign-out forgets the guest card", () => {
  it("each UI that calls a sign-out action also calls forgetGuestCard", () => {
    const callers = [...sourceFiles(path.join(ROOT, "components")), ...sourceFiles(path.join(ROOT, "app"))].filter(
      (file) => {
        const text = readFileSync(file, "utf8");
        // The UI that SUBMITS one: a form action or a call — not the module
        // that defines it.
        return SIGN_OUT_ACTIONS.test(text) && /^["']use client["'];?/m.test(text);
      },
    );
    expect(callers.map((f) => path.relative(ROOT, f)).sort()).toEqual([
      "components/auth/logout-button.tsx",
      "components/layout/user-menu.tsx",
      "components/settings/delete-account-dialog.tsx",
      "components/settings/security-panel.tsx",
    ]);
    for (const file of callers) expect(readFileSync(file, "utf8"), file).toMatch(/forgetGuestCard\(\)/);
  });

  it("the sign-out button forgets it as the form submits", async () => {
    render(<LogoutButton />);
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Sign out" }).closest("form")!);
    });
    expect(forget).toHaveBeenCalledTimes(1);
  });
});
