// @vitest-environment happy-dom
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  FormProvider,
  useForm,
  useWatch,
  type Control,
  type UseFormReturn,
} from "react-hook-form";
import type { GameSystem } from "@/types/card";
import type { FormValues } from "@/lib/creator/form-types";
import { EMPTY_BACK_FACE } from "@/lib/creator/form-types";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import type { PrintingSummary } from "@/lib/scryfall/printing-views";
import type { ImportedArtOrigin } from "@/components/creator/import/imported-art-note";

// ---------------------------------------------------------------------------
// "Use art from a real card" (TODO 1.15), through a real react-hook-form:
// the name typeahead → the printings grid → "Use this art" writes ONLY the
// target face's art, a re-centred position and its artist credit (never the
// title, text, type, frame, colour, provenance or tags); the back art is on
// offer only for a printing whose back face has its own image; a failed
// import toasts and leaves the form alone; an aborted search reports
// nothing; guests get the button disabled with the sign-in hint. fetch is
// stubbed with the routes' own response shapes — never a live call.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
// The Art panel's uploader imports a server action; nothing here uploads.
vi.mock("@/lib/cards/upload-art-server", () => ({ uploadCardArtServerAction: vi.fn() }));

import { RealCardArtButton } from "@/components/creator/real-card-art-dialog";
import { ArtPanel } from "@/components/creator/panels/art-panel";
import { LayoutPanel } from "@/components/creator/panels/layout-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of Object.values(toast)) fn.mockReset();
});

const GAME_SYSTEMS = [
  { id: "33333333-3333-4333-8333-333333333333", slug: "mtg", name: "Magic" } as unknown as GameSystem,
];

/** A card mid-edit: every field the import must NOT touch holds something. */
function cardInProgress(): FormValues {
  const base = defaultValuesFor(null, GAME_SYSTEMS);
  return {
    ...base,
    title: "Emberbound Wyrm",
    cost: "{3}{R}{R}",
    color_identity: ["red"],
    supertype: "Legendary",
    card_type: "creature",
    subtypes_text: "Dragon",
    tags_text: "dragons, homebrew",
    rarity: "mythic",
    rules_text: "Flying. Whenever Emberbound Wyrm attacks, it deals 1 damage to each opponent.",
    flavor_text: "It remembers every fire.",
    power: "5",
    toughness: "5",
    artist_credit: "Anya Vale",
    art_url: "https://project.supabase.co/storage/v1/object/public/card-art/u/old-front.png",
    art_position: { focalX: 0.2, focalY: 0.8, scale: 1.6 },
    frame_style: { finish: "regular", template: "m15" },
    source_scryfall_id: "",
    has_back_face: true,
    back_face: {
      ...EMPTY_BACK_FACE,
      title: "Ashen Hatchling",
      card_type: "creature",
      rules_text: "Haste.",
      artist_credit: "Back Artist",
      art_url: "https://project.supabase.co/storage/v1/object/public/card-art/u/old-back.png",
      art_position: { focalX: 0.7, focalY: 0.3, scale: 1.2 },
    },
  };
}

const LLANOWAR = { id: "llanowar-search-hit", oracleId: "68954295-54e3-4303-a6bc-fc4547a4e3a3" };
const DELVER = { id: "delver-search-hit", oracleId: "4b8f2e2c-1d2b-4c8e-9e5a-2b6a7c9d0e11" };

function printing(over: Partial<PrintingSummary> & Pick<PrintingSummary, "id">): PrintingSummary {
  return {
    set: "dom",
    set_name: "Dominaria",
    released_at: "2018-04-27",
    collector_number: "168",
    frame: "2015",
    border_color: "black",
    full_art: false,
    textless: false,
    snow: false,
    devoid: false,
    treatment: null,
    artist: "Test Artist",
    has_back_image: false,
    thumb_url: null,
    image_status: "highres_scan",
    match: null,
    ...over,
  };
}

const LLANOWAR_DOM = printing({ id: "a1b2c3d4-0000-4000-8000-000000000168", artist: "Artist of DOM" });
const LLANOWAR_M19 = printing({
  id: "a1b2c3d4-0000-4000-8000-000000000314",
  set: "m19",
  set_name: "Core Set 2019",
  released_at: "2018-07-13",
  collector_number: "314",
  artist: "Artist of M19",
});
const LLANOWAR_FULL_ART = printing({
  id: "a1b2c3d4-0000-4000-8000-000000000999",
  set: "plst",
  set_name: "The List",
  collector_number: "999",
  full_art: true,
  treatment: "fullart",
  artist: "Artist of the full art",
});
const DELVER_ISD = printing({
  id: "d1e2f3a4-0000-4000-8000-000000000051",
  set: "isd",
  set_name: "Innistrad",
  released_at: "2011-09-30",
  collector_number: "51",
  frame: "2003",
  artist: "Delver Artist",
  has_back_image: true,
});
const PLACEHOLDER = printing({
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  set: "fut",
  collector_number: "1",
  image_status: "placeholder",
});

const PUBLIC_URL = "https://project.supabase.co/storage/v1/object/public/card-art/u/new.jpg";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type ArtRoute = (body: { scryfallId: string; mode: string }) => Response | Promise<Response>;

function stubRoutes({
  printings = { [LLANOWAR.oracleId]: [LLANOWAR_DOM, LLANOWAR_M19, LLANOWAR_FULL_ART, PLACEHOLDER], [DELVER.oracleId]: [DELVER_ISD] },
  importArt = ({ mode }) => json({ ok: true, publicUrl: PUBLIC_URL, artist: mode === "art-back" ? "Back Face Artist" : "Artist of DOM", warning: null }),
  search,
}: {
  printings?: Record<string, PrintingSummary[]>;
  importArt?: ArtRoute;
  search?: (url: string, init?: RequestInit) => Promise<Response> | Response | undefined;
} = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/scryfall/search")) {
      const custom = await search?.(url, init);
      if (custom) return custom;
      const q = new URL(url, "http://x").searchParams.get("q") ?? "";
      const results = /delver/i.test(q)
        ? [{ id: DELVER.id, name: "Delver of Secrets // Insectile Aberration", oracle_id: DELVER.oracleId, set: "isd", set_name: "Innistrad", thumb_url: null }]
        : [{ id: LLANOWAR.id, name: "Llanowar Elves", oracle_id: LLANOWAR.oracleId, set: "dom", set_name: "Dominaria", thumb_url: null }];
      return json({ ok: true, results });
    }
    if (url.startsWith("/api/scryfall/printings")) {
      const oracleId = new URL(url, "http://x").searchParams.get("oracle_id") ?? "";
      const list = printings[oracleId] ?? [];
      return json({ ok: true, printings: list, has_more: false, total_cards: list.length });
    }
    if (url.startsWith("/api/scryfall/import-art")) {
      return importArt(JSON.parse(String(init?.body ?? "{}")));
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const importArtCalls = (mock: ReturnType<typeof vi.fn>) =>
  mock.mock.calls
    .filter(([u]) => String(u).startsWith("/api/scryfall/import-art"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

type Form = UseFormReturn<FormValues>;

/** Hands the test the live form once it mounts. */
function useExposeForm(form: Form, onForm?: (form: Form) => void) {
  useEffect(() => {
    onForm?.(form);
  }, [form, onForm]);
}

function Harness({
  target,
  signedIn = true,
  onForm,
  onApplied,
}: {
  target: "front" | "back";
  signedIn?: boolean;
  onForm: (form: Form) => void;
  onApplied?: Parameters<typeof RealCardArtButton>[0]["onApplied"];
}) {
  const form = useForm<FormValues>({ defaultValues: cardInProgress() });
  useExposeForm(form, onForm);
  return (
    <FormProvider {...form}>
      <RealCardArtButton target={target} signedIn={signedIn} onApplied={onApplied} />
    </FormProvider>
  );
}

function renderButton(target: "front" | "back", props: { signedIn?: boolean; onApplied?: Parameters<typeof RealCardArtButton>[0]["onApplied"] } = {}) {
  const holder: { form: Form | null } = { form: null };
  render(<Harness target={target} onForm={(form) => (holder.form = form)} {...props} />);
  return { values: () => holder.form!.getValues() };
}

async function pickCard(query: string, option: RegExp, face: "front" | "back" = "front") {
  fireEvent.click(
    screen.getByRole("button", {
      name:
        face === "back"
          ? /^use art from a real card for the second face$/i
          : /^use art from a real card$/i,
    }),
  );
  fireEvent.change(await screen.findByLabelText("Search a card by name"), { target: { value: query } });
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => expect(screen.getByTestId("printings-grid")).toBeTruthy());
}

const tile = (label: RegExp) =>
  within(screen.getByTestId("printings-grid"))
    .getAllByRole("button")
    .find((b) => label.test(b.textContent ?? ""))!;

async function useThisArt() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /use this art/i }));
  });
}

describe("'Use art from a real card' writes only the art (TODO 1.15)", () => {
  it("front: the chosen printing's art, a centred position and its artist — nothing else", async () => {
    const mock = stubRoutes();
    const onApplied = vi.fn();
    const { values } = renderButton("front", { onApplied });
    const before = values();

    await pickCard("Llanowar", /Llanowar Elves/);
    // No frame-status badges here: only the art matters.
    expect(screen.getByTestId("printings-grid").querySelector("[data-status]")).toBeNull();
    fireEvent.click(tile(/M19 · 2018 · #314/));
    fireEvent.click(tile(/DOM · 2018 · #168/));
    expect(tile(/DOM · 2018 · #168/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("real-art-chosen").textContent).toContain("Artist of DOM");
    await useThisArt();

    await waitFor(() => expect(values().art_url).toBe(PUBLIC_URL));
    expect(importArtCalls(mock)).toEqual([{ scryfallId: LLANOWAR_DOM.id, mode: "art" }]);
    expect(values()).toEqual({
      ...before,
      art_url: PUBLIC_URL,
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      artist_credit: "Artist of DOM",
    });
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ target: "front", mode: "art", printing: LLANOWAR_DOM }),
    );
    expect(toast.success).toHaveBeenCalledWith("Used the art from Llanowar Elves by Artist of DOM.");
    // The dialog closed.
    await waitFor(() => expect(screen.queryByRole("button", { name: /use this art/i })).toBeNull());
  });

  it("back: the second face's art, position and credit only — the front keeps its own", async () => {
    const mock = stubRoutes();
    const { values } = renderButton("back");
    const before = values();

    await pickCard("Delver", /Delver of Secrets/, "back");
    // For the back face, a printing with a back image starts on its back art.
    const which = screen.getByRole("radiogroup", { name: "Which art" });
    expect(within(which).getByRole("radio", { name: /Back art/ }).getAttribute("aria-checked")).toBe("true");
    expect(which.textContent).toContain("Insectile Aberration");
    await useThisArt();

    await waitFor(() => expect(values().back_face.art_url).toBe(PUBLIC_URL));
    expect(importArtCalls(mock)).toEqual([{ scryfallId: DELVER_ISD.id, mode: "art-back" }]);
    expect(values()).toEqual({
      ...before,
      back_face: {
        ...before.back_face,
        art_url: PUBLIC_URL,
        art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
        artist_credit: "Back Face Artist",
      },
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Used the art from Insectile Aberration by Back Face Artist.",
    );
  });
});

describe("the back art is offered only when the printing has a back image", () => {
  it("a one-faced printing: no front/back choice, mode 'art'", async () => {
    const mock = stubRoutes();
    renderButton("front");
    await pickCard("Llanowar", /Llanowar Elves/);
    expect(screen.queryByRole("radiogroup", { name: "Which art" })).toBeNull();
    await useThisArt();
    await waitFor(() => expect(importArtCalls(mock)).toHaveLength(1));
    expect(importArtCalls(mock)[0].mode).toBe("art");
  });

  it("a transform printing: Front art by default on the front; Back art asks for 'art-back'", async () => {
    const mock = stubRoutes();
    const { values } = renderButton("front");
    await pickCard("Delver", /Delver of Secrets/);
    const which = screen.getByRole("radiogroup", { name: "Which art" });
    expect(within(which).getByRole("radio", { name: /Front art/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(which).getByRole("radio", { name: /Back art/ }));
    await useThisArt();
    await waitFor(() => expect(values().art_url).toBe(PUBLIC_URL));
    // The back image lands on the FRONT: the button's block decides the face.
    expect(importArtCalls(mock)).toEqual([{ scryfallId: DELVER_ISD.id, mode: "art-back" }]);
    expect(values().back_face.art_url).toBe(cardInProgress().back_face.art_url);
  });

  it("a placeholder scan can't be used", async () => {
    stubRoutes({ printings: { [LLANOWAR.oracleId]: [PLACEHOLDER] } });
    renderButton("front");
    await pickCard("Llanowar", /Llanowar Elves/);
    expect(screen.getByRole("button", { name: /use this art/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/only has a placeholder image/)).toBeTruthy();
  });
});

describe("failures leave the form alone", () => {
  it("an import error toasts the route's message; the form and the dialog stay", async () => {
    stubRoutes({ importArt: () => json({ ok: false, error: "Scryfall card not found." }, 404) });
    const { values } = renderButton("front");
    const before = values();
    await pickCard("Llanowar", /Llanowar Elves/);
    await useThisArt();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Scryfall card not found."));
    expect(values()).toEqual(before);
    expect(toast.success).not.toHaveBeenCalled();
    // Still open, ready for another printing.
    expect(screen.getByRole("button", { name: /use this art/i })).toBeTruthy();
  });

  it("a rate limit or a dropped connection says so, and writes nothing", async () => {
    stubRoutes({
      importArt: () => json({ ok: false, error: "Scryfall import limit reached — try again in 5 minutes." }, 429),
    });
    const { values } = renderButton("back");
    const before = values();
    await pickCard("Llanowar", /Llanowar Elves/, "back");
    await useThisArt();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Scryfall import limit reached — try again in 5 minutes."),
    );
    expect(values()).toEqual(before);

    cleanup();
    toast.error.mockReset();
    stubRoutes({
      importArt: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const second = renderButton("front");
    const before2 = second.values();
    await pickCard("Llanowar", /Llanowar Elves/);
    await useThisArt();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't import the artwork — try again."),
    );
    expect(second.values()).toEqual(before2);
  });

  it("an aborted search never shows 'Search failed' nor stops the newer search's spinner", async () => {
    let releaseSecond: (() => void) | null = null;
    stubRoutes({
      search: (url, init) => {
        const q = new URL(url, "http://x").searchParams.get("q");
        if (q === "Llan") {
          // The first search's body is still being read when the next
          // keystroke aborts it: json() rejects.
          const signal = init?.signal as AbortSignal;
          return {
            ok: true,
            json: () =>
              new Promise((_, reject) =>
                signal.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                ),
              ),
          } as unknown as Response;
        }
        return new Promise<Response>((resolve) => {
          releaseSecond = () =>
            resolve(
              json({
                ok: true,
                results: [{ id: LLANOWAR.id, name: "Llanowar Elves", oracle_id: LLANOWAR.oracleId, set: "dom", set_name: "Dominaria", thumb_url: null }],
              }),
            );
        });
      },
    });
    renderButton("front");
    fireEvent.click(screen.getByRole("button", { name: /use art from a real card/i }));
    const input = await screen.findByLabelText("Search a card by name");
    fireEvent.change(input, { target: { value: "Llan" } });
    await waitFor(() => expect(screen.queryByTestId("real-art-search-spinner")).toBeTruthy());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    fireEvent.change(input, { target: { value: "Llanowar" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByText("Search failed.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("real-art-search-spinner")).toBeTruthy();

    await waitFor(() => expect(releaseSecond).not.toBeNull());
    await act(async () => {
      releaseSecond!();
    });
    await screen.findByRole("option", { name: /Llanowar Elves/ });
    expect(screen.queryByText("Search failed.")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("real-art-search-spinner")).toBeNull());
  });
});

describe("guests", () => {
  it("the button is disabled with the sign-in hint and opens nothing", () => {
    const mock = stubRoutes();
    renderButton("front", { signedIn: false });
    const button = screen.getByRole("button", { name: /use art from a real card/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBe("Sign in to use art from real cards.");
    fireEvent.click(button);
    expect(screen.queryByLabelText("Search a card by name")).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("in the Art panel", () => {
  function ArtistOutput({ control }: { control: Control<FormValues> }) {
    return <output data-testid="artist">{useWatch({ control, name: "artist_credit" })}</output>;
  }

  function PanelHarness({
    userId,
    values = cardInProgress(),
    backFaceSlot,
    onBackFaceArt,
    onForm,
  }: {
    userId: string | null;
    values?: FormValues;
    backFaceSlot?: React.ReactNode;
    onBackFaceArt?: () => void;
    onForm?: (form: Form) => void;
  }) {
    const form = useForm<FormValues>({ defaultValues: values });
    useExposeForm(form, onForm);
    const [origin, setOrigin] = useState<ImportedArtOrigin | null>(null);
    return (
      <FormProvider {...form}>
        <ArtPanel
          userId={userId}
          importedArtOrigin={origin}
          onImportedArtOrigin={setOrigin}
          backFaceSlot={backFaceSlot}
          onBackFaceArt={onBackFaceArt}
        />
        <ArtistOutput control={form.control} />
      </FormProvider>
    );
  }

  it("a guest's Art block shows the buttons disabled", () => {
    stubRoutes();
    render(<PanelHarness userId={null} />);
    const buttons = screen.getAllByRole("button", { name: /use art from a real card/i });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("a two-faced card with no second-face editor (an imported DFC) gets a Back face art row; its art lands on the back", async () => {
    const mock = stubRoutes();
    const onBackFaceArt = vi.fn();
    const holder: { form: Form | null } = { form: null };
    render(
      <PanelHarness
        userId="11111111-1111-4111-8111-111111111111"
        onBackFaceArt={onBackFaceArt}
        onForm={(form) => (holder.form = form)}
      />,
    );
    const row = screen.getByTestId("back-face-art");
    expect(row.textContent).toContain("Ashen Hatchling · Back Artist");
    const before = holder.form!.getValues();

    await pickCard("Delver", /Delver of Secrets/, "back");
    await useThisArt();
    await waitFor(() => expect(holder.form!.getValues().back_face.art_url).toBe(PUBLIC_URL));
    expect(importArtCalls(mock)).toEqual([{ scryfallId: DELVER_ISD.id, mode: "art-back" }]);
    expect(holder.form!.getValues()).toEqual({
      ...before,
      back_face: {
        ...before.back_face,
        art_url: PUBLIC_URL,
        art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
        artist_credit: "Back Face Artist",
      },
    });
    expect(onBackFaceArt).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId("back-face-art")).getByRole("img").getAttribute("src")).toBe(
      PUBLIC_URL,
    );
  });

  it("no Back face art row for a one-faced card, nor when the second face has its own editor", () => {
    stubRoutes();
    render(
      <PanelHarness userId="u" values={{ ...cardInProgress(), has_back_face: false }} />,
    );
    expect(screen.queryByTestId("back-face-art")).toBeNull();
    expect(screen.getAllByRole("button", { name: /use art from a real card/i })).toHaveLength(1);
    cleanup();
    render(<PanelHarness userId="u" backFaceSlot={<div>split half editor</div>} />);
    expect(screen.queryByTestId("back-face-art")).toBeNull();
  });

  it("a full-art printing: the dialog notes the frame pieces, and so does the Art block once it lands", async () => {
    stubRoutes({
      importArt: () => json({ ok: true, publicUrl: PUBLIC_URL, artist: "Artist of the full art" }),
    });
    render(<PanelHarness userId="11111111-1111-4111-8111-111111111111" />);
    expect(screen.queryByTestId("imported-art-note")).toBeNull();

    await pickCard("Llanowar", /Llanowar Elves/);
    fireEvent.click(tile(/PLST · 2018 · #999/));
    const dialogNote = within(screen.getByTestId("real-art-chosen")).getByTestId("imported-art-note");
    expect(dialogNote.textContent).toBe(
      "Scryfall's art for this full-art printing includes parts of the printed frame — check its edges, or upload the full illustration.",
    );
    await useThisArt();
    await waitFor(() => expect(screen.getByTestId("artist").textContent).toBe("Artist of the full art"));
    await waitFor(() => expect(screen.queryByTestId("real-art-chosen")).toBeNull());
    expect(screen.getByTestId("imported-art-note").textContent).toContain("full-art printing");
  });

  it("a regular printing on a bordered frame: no note", async () => {
    stubRoutes();
    render(<PanelHarness userId="11111111-1111-4111-8111-111111111111" />);
    await pickCard("Llanowar", /Llanowar Elves/);
    expect(within(screen.getByTestId("real-art-chosen")).queryByTestId("imported-art-note")).toBeNull();
    await useThisArt();
    await waitFor(() => expect(screen.getByTestId("artist").textContent).toBe("Artist of DOM"));
    expect(screen.queryByTestId("imported-art-note")).toBeNull();
  });
});

describe("in the second face's art block (split / aftermath / flip halves)", () => {
  function LayoutHarness({ isAdventureFrame }: { isAdventureFrame: boolean }) {
    const form = useForm<FormValues>({ defaultValues: cardInProgress() });
    return (
      <FormProvider {...form}>
        <LayoutPanel
          userId="u"
          hasBackFace
          isAdventureFrame={isAdventureFrame}
          backRulesTextRef={{ current: null }}
          onInsertSymbol={() => {}}
        />
      </FormProvider>
    );
  }

  it("the half with its own art has the button; an adventure (it shares the creature's art) has none", () => {
    stubRoutes();
    render(<LayoutHarness isAdventureFrame={false} />);
    expect(
      screen.getByRole("button", { name: /^use art from a real card for the second face$/i }),
    ).toBeTruthy();
    cleanup();
    render(<LayoutHarness isAdventureFrame />);
    expect(screen.queryByRole("button", { name: /use art from a real card/i })).toBeNull();
  });
});
