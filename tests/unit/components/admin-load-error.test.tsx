// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Audit L5's two client pieces: the inline "couldn't load" state every admin
// page shows for a failed read (an alert, never an empty state), and the
// admin toast that also LOGS — a refused action leaves a console line, not
// only a toast that is gone in four seconds.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { AdminLoadError } from "@/components/admin/admin-load-error";
import { adminErrorToast } from "@/lib/admin/admin-toast";

afterEach(cleanup);

describe("AdminLoadError", () => {
  it("is an alert naming what failed to load", () => {
    render(<AdminLoadError what="the feedback inbox" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Couldn’t load the feedback inbox\./);
    expect(alert.textContent).toMatch(/reload to try again/);
  });
});

describe("adminErrorToast", () => {
  it("toasts AND logs as a WARNING, with the cause when there is one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    adminErrorToast("card moderation", "Couldn't hide the card.");
    expect(toast.error).toHaveBeenCalledWith("Couldn't hide the card.");
    expect(warn).toHaveBeenCalledWith("[admin] card moderation:", "Couldn't hide the card.");
    const cause = new TypeError("fetch failed");
    adminErrorToast("frame compare", "Scoring failed.", cause);
    expect(warn).toHaveBeenLastCalledWith("[admin] frame compare:", "Scoring failed.", cause);
    // Never console.error: `next dev` copies a client console.error into its
    // dev overlay, which renders the refusal a second time on the page (#591:
    // the e2e pin spec found "… is a white card …" twice).
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("every admin control's error toast goes through it", () => {
  it("no admin or moderation component calls toast.error directly", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Billing controls are out of this change's scope (money paths).
    const SKIP = new Set(["user-billing-controls.tsx"]);
    const offenders: string[] = [];
    for (const dir of ["components/admin", "components/moderation"]) {
      for (const name of readdirSync(join(process.cwd(), dir))) {
        if (!name.endsWith(".tsx") || SKIP.has(name)) continue;
        const source = readFileSync(join(process.cwd(), dir, name), "utf8");
        if (/\btoast\.error\b/.test(source)) offenders.push(`${dir}/${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no admin or moderation client component logs a refusal with console.error (the dev overlay would show it twice)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    for (const dir of ["components/admin", "components/moderation"]) {
      for (const name of readdirSync(join(process.cwd(), dir))) {
        if (!/\.tsx?$/.test(name)) continue;
        const source = readFileSync(join(process.cwd(), dir, name), "utf8");
        if (/^["']use client["']/.test(source) && /\bconsole\.error\(/.test(source)) offenders.push(`${dir}/${name}`);
      }
    }
    const helper = readFileSync(join(process.cwd(), "lib/admin/admin-toast.ts"), "utf8");
    if (/\bconsole\.error\(/.test(helper)) offenders.push("lib/admin/admin-toast.ts");
    expect(offenders).toEqual([]);
  });
});
