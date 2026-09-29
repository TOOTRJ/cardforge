// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  card,
  json,
  namedBody,
  searchResult,
  stubScryfallRoutes,
  verifiedIn,
} from "./scryfall-import-stubs";

// ---------------------------------------------------------------------------
// TODO 1.23 in the import dialog: the "Tokens & emblems" scope asks
// /api/scryfall/search for scope=tokens (the only place include_extras is
// sent, with the no-match fallback on the server), a fallback answer says
// so, token rows show their type line and P/T, and a double-faced token or a
// Role card says before the commit that only its front face comes in.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import { ScryfallImportDialog } from "@/components/creator/scryfall-import-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SERVER_VERIFIED = new Set(verifiedIn("m15", "m15token", "m15tokenartifact"));

function renderDialog() {
  const onImport = vi.fn();
  render(
    <ScryfallImportDialog
      signedIn
      open
      onOpenChange={() => {}}
      onImport={onImport}
      verifiedFrameKeys={[...SERVER_VERIFIED]}
      currentFrameTemplate="m15"
    />,
  );
  return onImport;
}

const searchCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.startsWith("/api/scryfall/search"))
    .map((u) => new URL(u, "http://x").searchParams);

/** The search route answering `results` from `scope`. */
const searchAnswer = (keys: string[], scope: "cards" | "tokens") => (url: string) =>
  url.startsWith("/api/scryfall/search")
    ? json({
        ok: true,
        scope,
        results: keys.map((key) => ({
          ...searchResult(key),
          power: card(key).power ?? null,
          toughness: card(key).toughness ?? null,
        })),
      })
    : undefined;

describe("the Tokens & emblems scope (TODO 1.23)", () => {
  it("is a chip beside Cards; picking it searches scope=tokens and lists type line and P/T", async () => {
    const mock = stubScryfallRoutes({
      search: [],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: searchAnswer(["tdom-3", "tfdn-6"], "tokens"),
    });
    renderDialog();
    const scopes = screen.getByRole("radiogroup", { name: "Search scope" });
    expect(within(scopes).getByRole("radio", { name: "Cards" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(scopes).getByRole("radio", { name: "Tokens & emblems" }));
    const input = screen.getByLabelText("Search Scryfall") as HTMLInputElement;
    expect(input.placeholder).toBe("e.g. Treasure, Soldier, Kaito emblem");
    fireEvent.change(input, { target: { value: "Soldier" } });

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toContain("Token Creature — Soldier · 1/1");
    // A token's rarity says nothing: it isn't listed.
    expect(options[0]!.textContent).not.toContain("common");
    expect(searchCalls(mock).at(-1)!.get("scope")).toBe("tokens");
    expect(screen.queryByTestId("search-fallback-note")).toBeNull();
  });

  it("the Cards scope sends no scope but asks for the fallback, and says so when the server fell back", async () => {
    const mock = stubScryfallRoutes({
      search: [],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: searchAnswer(["tfdn-24"], "tokens"),
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Search Scryfall"), {
      target: { value: "Kaito Cunning Infiltrator Emblem" },
    });
    await screen.findByRole("option", { name: /Kaito, Cunning Infiltrator Emblem/ });
    expect(screen.getByTestId("search-fallback-note").textContent).toBe(
      "No cards matched — these are tokens and emblems.",
    );
    expect(searchCalls(mock).at(-1)!.has("scope")).toBe(false);
    // Only this dialog asks for it: the route's other callers search once.
    expect(searchCalls(mock).at(-1)!.get("fallback")).toBe("tokens");
  });

  it("the Tokens & emblems scope asks for no fallback (it is that search)", async () => {
    const mock = stubScryfallRoutes({
      search: [],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: searchAnswer(["tdom-3"], "tokens"),
    });
    renderDialog();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Search scope" })).getByRole("radio", {
        name: "Tokens & emblems",
      }),
    );
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Soldier" } });
    await screen.findByRole("option", { name: /Soldier/ });
    expect(searchCalls(mock).at(-1)!.has("fallback")).toBe(false);
  });

  it("switching back to Cards never labels the Tokens results a fallback while the Cards answer loads", async () => {
    // The Tokens search answers at once; the Cards search after the switch
    // is still in flight when the list is checked.
    stubScryfallRoutes({
      search: [],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: (url) => {
        if (!url.startsWith("/api/scryfall/search")) return undefined;
        const params = new URL(url, "http://x").searchParams;
        if (params.get("scope") === "tokens") return searchAnswer(["tdom-3"], "tokens")(url);
        return new Promise<Response>(() => {});
      },
    });
    renderDialog();
    const scopes = screen.getByRole("radiogroup", { name: "Search scope" });
    fireEvent.click(within(scopes).getByRole("radio", { name: "Tokens & emblems" }));
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Soldier" } });
    await screen.findByRole("option", { name: /Soldier/ });

    fireEvent.click(within(scopes).getByRole("radio", { name: "Cards" }));
    // The Tokens results are still listed (the Cards answer hasn't landed)…
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByRole("option", { name: /Soldier/ })).toBeTruthy();
    // …and they are not a Cards search the server answered from tokens.
    expect(screen.queryByTestId("search-fallback-note")).toBeNull();
  });

  it("switching the scope re-runs the same query", async () => {
    const mock = stubScryfallRoutes({ search: ["dmu-107"], printings: {}, serverVerified: SERVER_VERIFIED });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Treasure" } });
    await waitFor(() => expect(searchCalls(mock)).toHaveLength(1));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Search scope" })).getByRole("radio", {
        name: "Tokens & emblems",
      }),
    );
    await waitFor(() => expect(searchCalls(mock)).toHaveLength(2));
    expect(searchCalls(mock).map((p) => [p.get("q"), p.get("scope")])).toEqual([
      ["Treasure", null],
      ["Treasure", "tokens"],
    ]);
  });
});

describe("front face only (TODO 1.23)", () => {
  it("a double-faced token says so before the commit and imports no back face or back art", async () => {
    const artModes: string[] = [];
    const mock = stubScryfallRoutes({
      search: ["tmom-16"],
      printings: {},
      serverVerified: SERVER_VERIFIED,
      override: (url, init) => {
        if (url.startsWith("/api/scryfall/named")) {
          // Scryfall has an image for each face of a double-faced token.
          const body = namedBody("tmom-16", SERVER_VERIFIED);
          return json({ ...body, card: { ...body.card, has_back_image: true } });
        }
        if (url.startsWith("/api/scryfall/import-art")) {
          artModes.push((JSON.parse(String(init?.body)) as { mode: string }).mode);
          return json({ ok: false, error: "no art in tests" });
        }
        return undefined;
      },
    });
    const onImport = renderDialog();
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Incubator" } });
    fireEvent.click(await screen.findByRole("option", { name: /Incubator/ }));
    await screen.findByText(/Will populate/);
    expect(screen.getByTestId("import-face-note").textContent).toBe(
      "Incubator // Phyrexian is a double-faced token — PipGlyph imported its front face, Incubator. Two-sided tokens aren't supported yet.",
    );

    fireEvent.click(screen.getByRole("button", { name: /use as starting point/i }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const payload = onImport.mock.calls[0]![0] as { patch: { back_face?: unknown; title: string } };
    expect(payload.patch.title).toBe("Incubator");
    expect(payload.patch.back_face).toBeUndefined();
    expect(artModes).toEqual(["art"]);
    expect(mock).toHaveBeenCalled();
  });

  it("a Role card says it imports the front Role, and is logged unsupported (Not available badge)", async () => {
    stubScryfallRoutes({ search: ["twoe-15"], printings: {}, serverVerified: SERVER_VERIFIED });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Search Scryfall"), { target: { value: "Monster" } });
    fireEvent.click(await screen.findByRole("option", { name: /Monster/ }));
    await screen.findByText(/Will populate/);
    expect(screen.getByTestId("import-face-note").textContent).toBe(
      "Monster // Sorcerer holds two Roles — PipGlyph imported the front one, Monster.",
    );
    expect(document.querySelector("[data-status]")?.textContent).toBe("✕ Not available");
  });
});
