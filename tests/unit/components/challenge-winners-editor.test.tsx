// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The /admin/challenges winners picker (TODO NV12): three places among the
// closed challenge's entries, likes in view; a card takes one place; Save
// sends all three.

const save = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/challenges/actions", () => ({ setChallengeWinnersAction: (...a: unknown[]) => save(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/admin/admin-toast", () => ({ adminErrorToast: vi.fn() }));

import { ChallengeWinnersEditor } from "@/components/admin/challenge-winners-editor";

const entries = [
  { id: "a", title: "Ant Tyrant", ownerUsername: "ana", likes: 9 },
  { id: "b", title: "Bee King", ownerUsername: "bo", likes: 1 },
  { id: "c", title: "Cricket", ownerUsername: null, likes: 0 },
];

beforeEach(() => {
  save.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});
afterEach(cleanup);

const select = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;

describe("ChallengeWinnersEditor", () => {
  it("offers every entry in each place, with its maker and likes", () => {
    render(<ChallengeWinnersEditor challengeId="ch" entries={entries} initial={[null, null, null]} />);
    const options = [...select("1st place").options].map((o) => o.textContent);
    expect(options).toEqual(["— None —", "Ant Tyrant · @ana · 9 likes", "Bee King · @bo · 1 like", "Cricket · 0 likes"]);
    expect(select("2nd place")).toBeTruthy();
    expect(select("3rd place")).toBeTruthy();
  });

  it("moves a card rather than naming it twice", () => {
    render(<ChallengeWinnersEditor challengeId="ch" entries={entries} initial={["a", "b", null]} />);
    fireEvent.change(select("3rd place"), { target: { value: "a" } });
    expect(select("1st place").value).toBe("");
    expect(select("3rd place").value).toBe("a");
  });

  it("saves only once something changed, sending all three places", async () => {
    render(<ChallengeWinnersEditor challengeId="ch" entries={entries} initial={["a", null, null]} />);
    const button = screen.getByRole("button", { name: /save winners/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(select("2nd place"), { target: { value: "c" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledWith("ch", ["a", "c", null]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says why a save was refused", async () => {
    save.mockResolvedValue({ ok: false, error: "A card can only take one place." });
    render(<ChallengeWinnersEditor challengeId="ch" entries={entries} initial={[null, null, null]} />);
    fireEvent.change(select("1st place"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: /save winners/i }));
    expect((await screen.findByRole("alert")).textContent).toBe("A card can only take one place.");
  });

  it("shows a winner that is no longer an entry, where it stands only, and can clear it", async () => {
    const withStale = [...entries, { id: "z", title: "Gone Gnat", ownerUsername: "zed", likes: 0, stale: true }];
    render(<ChallengeWinnersEditor challengeId="ch" entries={withStale} initial={["z", null, null]} />);
    expect(select("1st place").value).toBe("z");
    expect([...select("1st place").options].map((o) => o.textContent)).toContain("Gone Gnat · @zed · no longer an entry");
    expect([...select("2nd place").options].map((o) => o.value)).not.toContain("z");
    fireEvent.change(select("1st place"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save winners/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("ch", [null, null, null]));
  });

  it("can still clear stale winners when no entry is left", () => {
    const stale = [{ id: "z", title: "Gone Gnat", ownerUsername: null, likes: 0, stale: true }];
    render(<ChallengeWinnersEditor challengeId="ch" entries={stale} initial={["z", null, null]} />);
    expect(select("1st place").value).toBe("z");
  });

  it("says so when there is no entry to name", () => {
    render(<ChallengeWinnersEditor challengeId="ch" entries={[]} initial={[null, null, null]} />);
    expect(screen.getByText(/no public entries/i)).toBeTruthy();
  });
});
