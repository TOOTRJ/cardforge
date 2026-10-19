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
  it("toasts AND logs, with the cause when there is one", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    adminErrorToast("card moderation", "Couldn't hide the card.");
    expect(toast.error).toHaveBeenCalledWith("Couldn't hide the card.");
    expect(log).toHaveBeenCalledWith("[admin] card moderation:", "Couldn't hide the card.");
    const cause = new TypeError("fetch failed");
    adminErrorToast("frame compare", "Scoring failed.", cause);
    expect(log).toHaveBeenLastCalledWith("[admin] frame compare:", "Scoring failed.", cause);
    log.mockRestore();
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
});
