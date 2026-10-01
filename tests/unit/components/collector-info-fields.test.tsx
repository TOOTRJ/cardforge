// @vitest-environment happy-dom
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { CollectorInfoFields, SetIconPanel } from "@/components/creator/panels/set-icon-panel";
import { PRINTED_LANGS } from "@/lib/cards/collector-fields";
import type { FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// The Set & collector info step's collector fields (TODO 4.9a):
//   • the set code, number and language inputs, bound to the form;
//   • a Keyrune symbol offers "Use DMU" — one click writes the code, nothing
//     writes it on its own, and a filled code hides the offer;
//   • the language select lists the twelve printed languages; a stored
//     other (he) shows as "Other (not printed)" and is never swapped;
//   • an imported card with empty fields offers "Fill from the printing":
//     one /api/scryfall/named lookup, into the form, dirty (saved like any
//     edit) — not for a card that never came from a printing.
// ---------------------------------------------------------------------------

type Values = {
  set_icon_url: string;
  set_icon_code: string;
  set_code: string;
  collector_number: string;
  lang: string;
  source_scryfall_id: string;
  card_type: string;
  rarity: string;
  frame_style: { template: string };
};

let latest: ReturnType<typeof useForm<Values>> | null = null;

function Harness({ values, whole = false }: { values: Partial<Values>; whole?: boolean }) {
  const methods = useForm<Values>({
    defaultValues: {
      set_icon_url: "",
      set_icon_code: "",
      set_code: "",
      collector_number: "",
      lang: "en",
      source_scryfall_id: "",
      card_type: "creature",
      rarity: "rare",
      frame_style: { template: "m15" },
      ...values,
    },
  });
  // The assertions read the form through `latest` (set after commit, never
  // during render). formState is a Proxy: reading dirtyFields during render
  // subscribes the harness to it, so the assertions see the flags.
  useEffect(() => {
    latest = methods;
  });
  void methods.formState.dirtyFields;
  return (
    // The panel reads FormValues; the harness only carries what it touches.
    <FormProvider {...(methods as unknown as UseFormReturn<FormValues>)}>
      {whole ? <SetIconPanel userId={null} /> : <CollectorInfoFields />}
    </FormProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  latest = null;
});

const input = (container: HTMLElement, name: string) =>
  container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;

describe("CollectorInfoFields", () => {
  it("binds the three fields and sits under the symbol on the step", () => {
    const { container } = render(<Harness whole values={{ set_code: "DMU", collector_number: "107/281", lang: "es" }} />);
    expect(container.textContent).toContain("Set icon");
    expect(container.textContent).toContain("Collector info");
    expect(input(container, "set_code").value).toBe("DMU");
    expect(input(container, "collector_number").value).toBe("107/281");
    expect(input(container, "lang").value).toBe("es");
  });

  it("offers the Keyrune code as 'Use DMU' and writes it only on a click", () => {
    const { container, getByRole } = render(<Harness values={{ set_icon_code: "dmu" }} />);
    expect(input(container, "set_code").value).toBe("");
    const use = getByRole("button", { name: /^Use DMU$/ });
    fireEvent.click(use);
    expect(latest!.getValues("set_code")).toBe("DMU");
    expect(latest!.formState.dirtyFields.set_code).toBe(true);
  });

  it("shows no suggestion without a Keyrune symbol, or once the code is filled", () => {
    const none = render(<Harness values={{}} />);
    expect(none.queryByRole("button", { name: /^Use / })).toBeNull();
    cleanup();
    const filled = render(<Harness values={{ set_icon_code: "dmu", set_code: "FDN" }} />);
    expect(filled.queryByRole("button", { name: /^Use / })).toBeNull();
    expect(input(filled.container, "set_code").value).toBe("FDN");
  });

  it("lists the twelve printed languages, with their printed codes", () => {
    const { container } = render(<Harness values={{}} />);
    const options = [...input(container, "lang").querySelectorAll("option")].map((o) => [o.value, o.textContent]);
    expect(options).toEqual(PRINTED_LANGS.map((l) => [l.code, `${l.label} (${l.printed})`]));
    expect(options.find(([code]) => code === "es")?.[1]).toBe("Spanish (SP)");
    expect(options.find(([code]) => code === "ko")?.[1]).toBe("Korean (KR)");
  });

  it("a stored language with no printed code shows as 'Other (not printed)' and stays selected", () => {
    const { container } = render(<Harness values={{ lang: "he" }} />);
    const select = input(container, "lang") as HTMLSelectElement;
    expect(select.value).toBe("he");
    const other = [...select.querySelectorAll("option")].find((o) => o.value === "he");
    expect(other?.textContent).toBe("Other (not printed) — he");
    expect(select.querySelectorAll("option")).toHaveLength(PRINTED_LANGS.length + 1);
  });

  it("'Fill from the printing' on an imported card with empty fields: one lookup, into the form, dirty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          patch: { collector: { set_code: "DMU", collector_number: "107/281", lang: "en" } },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getByRole } = render(
      <Harness values={{ source_scryfall_id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2" }} />,
    );
    await act(async () => {
      fireEvent.click(getByRole("button", { name: /Fill from the printing/ }));
    });
    await waitFor(() => expect(latest!.getValues("collector_number")).toBe("107/281"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/scryfall/named?id=d67be074-cdd4-41d9-ac89-0a0456c4e4b2",
    );
    expect(latest!.getValues("set_code")).toBe("DMU");
    expect(latest!.getValues("lang")).toBe("en");
    expect(latest!.formState.dirtyFields.set_code).toBe(true);
  });

  it("offers no fill for a card that never came from a printing, or whose fields are filled", () => {
    const own = render(<Harness values={{}} />);
    expect(own.queryByRole("button", { name: /Fill from the printing/ })).toBeNull();
    cleanup();
    const filled = render(
      <Harness values={{ source_scryfall_id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2", set_code: "DMU", collector_number: "107/281" }} />,
    );
    expect(filled.queryByRole("button", { name: /Fill from the printing/ })).toBeNull();
  });

  it("a lookup whose printing's set didn't answer fills nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, patch: {} }), { status: 200 })),
    );
    const { getByRole } = render(
      <Harness values={{ source_scryfall_id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2" }} />,
    );
    await act(async () => {
      fireEvent.click(getByRole("button", { name: /Fill from the printing/ }));
    });
    await waitFor(() =>
      expect((getByRole("button", { name: /Fill from the printing/ }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(latest!.getValues("set_code")).toBe("");
    expect(latest!.formState.dirtyFields.set_code).toBeUndefined();
  });
});
