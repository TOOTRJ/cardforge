// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useMemo, useState, type ReactNode } from "react";
import { carryArtFraming } from "@/lib/cards/art-framing";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// The creator's side of TODO 3.23: a frame switch keeps the art's framing
// and drops Etched on an edge-to-edge frame (useTreatmentSwitch); the Finish
// picker shows Etched disabled there (EffectsPanel); the Text step says a
// textless frame keeps the text (TextPanel, TODO 3.24).
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// No code profile is textless yet (4.35 / 4.37 opt in): make m15textless one
// for the Text step's note.
vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...actual,
    getFrameProfile: (t?: string) =>
      t === "m15textless" ? { ...actual.getFrameProfile(t), textless: true } : actual.getFrameProfile(t),
  };
});

const { useArtAutoFit, useTreatmentSwitch, ETCHED_DROPPED_NOTICE } = await import("@/components/creator/use-treatment-switch");
const { EffectsPanel, finishOptionsFor } = await import("@/components/creator/panels/effects-panel");
const { TextPanel, TEXTLESS_FRAME_NOTE } = await import("@/components/creator/panels/text-panel");

afterEach(() => {
  cleanup();
  toast.info.mockClear();
});

const natural = { src: "https://art.test/a.png", width: 1600, height: 1200 };

function useSwitchHarness(opts: { dirty: boolean }) {
  const form = useForm<FormValues>({
    defaultValues: {
      art_url: natural.src,
      art_position: { focalX: 0.2, focalY: 0.3, scale: 1.5 },
      frame_style: { template: "m15", finish: "etched" },
    } as unknown as FormValues,
  });
  const template = useWatch({ control: form.control, name: "frame_style.template" });
  const artUrl = useWatch({ control: form.control, name: "art_url" });
  useTreatmentSwitch({
    template,
    artUrl,
    natural,
    isDirty: opts.dirty,
    getValues: form.getValues,
    setValue: form.setValue,
  });
  return form;
}

describe("useTreatmentSwitch", () => {
  it("carries the framing and drops Etched when the user moves the card to a full-bleed frame", () => {
    const { result } = renderHook(() => useSwitchHarness({ dirty: true }));
    act(() => result.current.setValue("frame_style.template", "fullartland"));
    const want = carryArtFraming({
      from: getFrameProfile("m15"),
      to: getFrameProfile("fullartland"),
      natural,
      position: { focalX: 0.2, focalY: 0.3, scale: 1.5 },
    });
    expect(result.current.getValues("art_position")).toEqual(want);
    expect(want).not.toEqual({ focalX: 0.2, focalY: 0.3, scale: 1.5 });
    expect(result.current.getValues("frame_style.finish")).toBe("regular");
    expect(toast.info).toHaveBeenCalledWith(ETCHED_DROPPED_NOTICE);
  });

  it("keeps Etched on a bordered frame", () => {
    const { result } = renderHook(() => useSwitchHarness({ dirty: true }));
    act(() => result.current.setValue("frame_style.template", "extendedart"));
    expect(result.current.getValues("frame_style.finish")).toBe("etched");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("never re-frames a load or a draft restore (a clean form)", () => {
    const { result } = renderHook(() => useSwitchHarness({ dirty: false }));
    act(() => result.current.setValue("frame_style.template", "fullartland"));
    expect(result.current.getValues("art_position")).toEqual({ focalX: 0.2, focalY: 0.3, scale: 1.5 });
    expect(result.current.getValues("frame_style.finish")).toBe("etched");
  });

  it("leaves a NEW picture's position alone (the art changed with the frame)", () => {
    const { result } = renderHook(() => useSwitchHarness({ dirty: true }));
    act(() => {
      result.current.setValue("art_url", "https://art.test/b.png");
      result.current.setValue("frame_style.template", "fullartland");
    });
    expect(result.current.getValues("art_position")).toEqual({ focalX: 0.2, focalY: 0.3, scale: 1.5 });
  });
});

// ---------------------------------------------------------------------------
// TODO 3b.18: an UNTOUCHED picture is on its automatic fit and is never
// carried; each face is re-fitted to its own window (useArtAutoFit), and a
// hand-set position is never replaced there.
// ---------------------------------------------------------------------------
describe("an untouched picture on a frame switch", () => {
  function useUntouched(position: unknown) {
    const form = useForm<FormValues>({
      defaultValues: {
        art_url: natural.src,
        art_position: position,
        frame_style: { template: "m15", finish: "regular" },
      } as unknown as FormValues,
    });
    const template = useWatch({ control: form.control, name: "frame_style.template" });
    useTreatmentSwitch({
      template,
      artUrl: natural.src,
      natural,
      isDirty: true,
      getValues: form.getValues,
      setValue: form.setValue,
    });
    return form;
  }

  it("stays on the fit on every window — the numbers a centred cover has", () => {
    const { result } = renderHook(() => useUntouched({ focalX: 0.5, focalY: 0.5, scale: 1 }));
    for (const template of ["saga", "m15borderless", "aftermath", "m15"] as const) {
      act(() => result.current.setValue("frame_style.template", template));
      expect(result.current.getValues("art_position")).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
    }
  });

  it("a stored position with no keys is left exactly as stored (it used to be rewritten as three numbers)", () => {
    const { result } = renderHook(() => useUntouched({}));
    act(() => result.current.setValue("frame_style.template", "saga"));
    expect(result.current.getValues("art_position")).toEqual({});
  });
});

describe("useArtAutoFit", () => {
  const M15 = { width: 1271, height: 931 };
  const SAGA = { width: 636, height: 1526 };
  function useFitHarness(opts: { position: unknown; dirty?: boolean; field?: "art_position" | "back_face.art_position" }) {
    const field = opts.field ?? "art_position";
    const form = useForm<FormValues>({
      defaultValues: {
        art_url: natural.src,
        art_position: field === "art_position" ? opts.position : { focalX: 0.5, focalY: 0.5, scale: 1 },
        back_face: { art_url: natural.src, art_position: opts.position },
      } as unknown as FormValues,
    });
    const [artWindow, setArtWindow] = useState<{ width: number; height: number } | null>(M15);
    const setValue = useMemo(() => vi.fn(form.setValue), [form.setValue]);
    useArtAutoFit({
      field,
      artWindow,
      artUrl: natural.src,
      natural,
      isDirty: opts.dirty ?? true,
      getValues: form.getValues,
      setValue: setValue as unknown as typeof form.setValue,
    });
    return { form, setArtWindow, setValue };
  }

  it("leaves an untouched picture on the fit and writes nothing (the fit is the same numbers on every window)", () => {
    const { result } = renderHook(() => useFitHarness({ position: { focalX: 0.5, focalY: 0.5, scale: 1 } }));
    act(() => result.current.setArtWindow(SAGA));
    expect(result.current.setValue).not.toHaveBeenCalled();
    expect(result.current.form.getValues("art_position")).toEqual({ focalX: 0.5, focalY: 0.5, scale: 1 });
  });

  it("never touches a hand-set position — the front's or the other face's", () => {
    for (const field of ["art_position", "back_face.art_position"] as const) {
      const position = { focalX: 0.2, focalY: 0.3, scale: 1.5 };
      const { result } = renderHook(() => useFitHarness({ position, field }));
      act(() => result.current.setArtWindow(SAGA));
      act(() => result.current.setArtWindow(null));
      act(() => result.current.setArtWindow(M15));
      expect(result.current.setValue).not.toHaveBeenCalled();
      expect(result.current.form.getValues(field)).toEqual(position);
    }
  });
});

function WithForm({ template, children }: { template: string; children: ReactNode }) {
  const form = useForm<FormValues>({
    defaultValues: { rules_text: "Flying", flavor_text: "", frame_style: { template, finish: "regular" } } as unknown as FormValues,
  });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("the Finish picker", () => {
  it("disables Etched, saying why, on an edge-to-edge frame only", () => {
    const etched = (template: string) => finishOptionsFor(getFrameProfile(template)).find((o) => o.value === "etched")!;
    expect(etched("fullartland").disabled).toBe(true);
    expect(etched("fullartland").description).toMatch(/borderless/);
    expect(etched("m15").disabled).toBeUndefined();
    render(
      <WithForm template="fullartland">
        <EffectsPanel />
      </WithForm>,
    );
    const chip = (label: string) => screen.getByText(label).closest("button") as HTMLButtonElement;
    expect(chip("Etched").disabled).toBe(true);
    expect(chip("Foil").disabled).toBe(false);
  });
});

describe("the Text step on a textless frame (TODO 3.24)", () => {
  const panel = (template: string) =>
    render(
      <WithForm template={template}>
        <TextPanel rulesTextRef={{ current: null }} onInsertSymbol={() => {}} />
      </WithForm>,
    );

  it("says the text is kept and shows on other frames", () => {
    panel("m15textless");
    expect(screen.getByTestId("textless-frame-note").textContent).toBe(TEXTLESS_FRAME_NOTE);
    expect(TEXTLESS_FRAME_NOTE).toBe("This frame prints no rules text — it's kept and shows on other frames.");
    // The fields stay: the text is kept, not cleared.
    expect(screen.getByLabelText("Rules text")).toBeTruthy();
  });

  it("says nothing on a frame that prints text", () => {
    panel("m15");
    expect(screen.queryByTestId("textless-frame-note")).toBeNull();
  });
});
