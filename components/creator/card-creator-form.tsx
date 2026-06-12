"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FormProvider,
  useForm,
  useWatch,
  type SubmitHandler,
} from "react-hook-form";
import {
  ArrowLeft,
  ArrowRight,
  Lock,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { CardPreview } from "@/components/cards/card-preview";
import { DeleteCardDialog } from "@/components/creator/delete-card-dialog";
import type { CardFieldPatch } from "@/components/creator/ai-assistant-panel";
import {
  ScryfallImportDialog,
  type ScryfallImportPayload,
} from "@/components/creator/scryfall-import-dialog";
import {
  CARDFORGE_EVENTS,
  FORM_SCROLL_TARGET_ID,
} from "@/components/creator/start-with-hero";
import { FrameStep } from "@/components/creator/steps/frame-step";
import { DetailsStep } from "@/components/creator/steps/details-step";
import { RulesStep } from "@/components/creator/steps/rules-step";
import { ArtStep } from "@/components/creator/steps/art-step";
import { ExtraStep } from "@/components/creator/steps/extra-step";
import {
  PublishStep,
  type CardSetOption,
} from "@/components/creator/steps/publish-step";
import type { CardContext } from "@/lib/ai/schemas";
import {
  createCardAction,
  updateCardAction,
} from "@/lib/cards/actions";
import { slugify } from "@/lib/validation/card";
import {
  CARD_TYPE_VALUES,
  RARITY_VALUES,
  type Card,
  type CardTemplate,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
  type GameSystem,
  type Rarity,
  DEFAULT_FRAME_TEMPLATE,
} from "@/types/card";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  eraForTemplate,
  isTypeDerivedStandard,
  standardFrameFor,
} from "@/lib/creator/frame-picker";
import {
  defaultValuesFor,
  deriveColorIdentity,
  parseSubtypes,
  parseTags,
} from "@/lib/creator/card-fields";
import { type FormValues } from "@/lib/creator/form-types";
import {
  buildFieldToStep,
  statVisibility,
  stepIndexForField,
  stepLabel,
  visibleSteps,
  STEP_ORDER,
  type StepContext,
  type StepKey,
} from "@/lib/creator/steps";

// ---------------------------------------------------------------------------
// Form values — mirror createCardSchema but typed at the component boundary.
// We intentionally keep "string" for inputs that the form serializes from
// text fields and convert to the schema's optional/empty-as-undefined shape
// at submission time.
// ---------------------------------------------------------------------------

// FormValues / BackFaceFormValues / EMPTY_BACK_FACE now live in
// lib/creator/form-types.ts so the pure step model (lib/creator/steps.ts) can
// reference them without importing this client component.

type CardCreatorFormProps = {
  mode: "create" | "edit";
  userId: string | null;
  /** Current user's username, if any. Lets the slug helper preview the
   *  canonical `/card/[username]/[slug]` URL the card will live at. Null when
   *  the user is signed out (preview mode) or hasn't picked a username yet. */
  ownerUsername?: string | null;
  gameSystems: GameSystem[];
  templates: CardTemplate[];
  card?: Card | null;
  /** The current user's sets — populates the "Add to set" picker on Publish. */
  mySets?: CardSetOption[];
  /** Whether ANTHROPIC_API_KEY is set on the server — gates the AI panel. */
  aiConfigured: boolean;
};

// Step membership + field→step routing now live in lib/creator/steps.ts (pure
// + unit-tested) so the form and the tests derive the same frame-aware flow.

// Step JSX lives in components/creator/steps/* (one client component per
// step); shared presentational helpers in field-group.tsx + frame-pickers.tsx;
// pure field helpers in lib/creator/card-fields.ts. This orchestrator owns the
// form instance, draft persistence, step navigation, submit, and the preview.

// One shared key: a guest's /preview draft survives sign-up and reappears on
// /create. Versioned so a future FormValues shape change can invalidate.
const CARD_DRAFT_STORAGE_KEY = "pipglyph:card-draft:v1";
// Pre-rebrand key — read as a fallback so in-flight drafts survive the
// Spellwright → PipGlyph swap; removed once migrated. Drop after 2026-09.
const LEGACY_CARD_DRAFT_STORAGE_KEY = "spellwright:card-draft:v1";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardCreatorForm({
  mode,
  userId,
  ownerUsername,
  gameSystems,
  templates,
  card,
  mySets = [],
  aiConfigured,
}: CardCreatorFormProps) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // Active step index into the dynamic `steps` list (see below). Clamped on
  // read so it stays valid when the visible steps shrink (e.g. a DFC is removed).
  const [current, setCurrent] = useState(() => {
    // The create→edit redirect carries ?step=<key> so saving doesn't bounce
    // the user back to the Frame step. Resolved against the full step order;
    // visibleSteps clamps the index if the step isn't visible for this card.
    if (typeof window === "undefined") return 0;
    const want = new URLSearchParams(window.location.search).get("step");
    if (!want) return 0;
    const i = STEP_ORDER.indexOf(want as StepKey);
    return i >= 0 ? i : 0;
  });
  // Stable handle to the latest step-navigation fn, so the once-registered
  // custom-event listeners (hero / command palette) always call current logic.
  const goToStepKeyRef = useRef<(key: StepKey) => void>(() => {});
  // Tracks the source card when the user seeds the form from Scryfall.
  // Surfaces as a chip near the save bar so the user remembers they need
  // to make the card their own before publishing.
  const [remixSource, setRemixSource] = useState<{
    name: string;
    scryfallUri: string | null;
  } | null>(null);
  // Scryfall dialog open state is lifted into the form so the start-with
  // hero on /create and the global command palette can open it via custom
  // DOM events. The dialog itself is rendered once below with `hideTrigger`.
  const [scryfallOpen, setScryfallOpen] = useState(false);
  // Random-card generation state. Disabled until the user is signed in;
  // disables itself while a request is in flight so the user can't double-
  // submit and burn quota.
  const [generatingRandom, setGeneratingRandom] = useState(false);

  // Listen for hero/palette custom events. Each event is fire-and-forget
  // — no payload, just a signal to perform a UI action.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openScryfall = () => setScryfallOpen(true);
    const openAiConcept = () => {
      // The AI assistant panel lives on the Rules step. Jump there, then defer
      // the scroll one tick so the step content mounts before we scroll to it.
      goToStepKeyRef.current("rules");
      requestAnimationFrame(() => {
        document
          .getElementById("ai-assistant-anchor")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    const scrollToForm = () => {
      document
        .getElementById(FORM_SCROLL_TARGET_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(CARDFORGE_EVENTS.openScryfall, openScryfall);
    window.addEventListener(CARDFORGE_EVENTS.openAiConcept, openAiConcept);
    window.addEventListener(CARDFORGE_EVENTS.scrollToForm, scrollToForm);
    return () => {
      window.removeEventListener(CARDFORGE_EVENTS.openScryfall, openScryfall);
      window.removeEventListener(CARDFORGE_EVENTS.openAiConcept, openAiConcept);
      window.removeEventListener(CARDFORGE_EVENTS.scrollToForm, scrollToForm);
    };
  }, []);

  const defaults = useMemo(
    () => defaultValuesFor(card, gameSystems, templates),
    [card, gameSystems, templates],
  );

  // The full methods object is spread into <FormProvider> below so the step
  // components can reach the same form instance via useFormContext().
  const methods = useForm<FormValues>({
    defaultValues: defaults,
    mode: "onSubmit",
  });
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    getValues,
    control,
    reset,
    formState: { errors, isDirty },
  } = methods;

  // Reset only when the SAVED card actually changes (navigating between
  // cards, or fresh server truth after our own save) — never on mere prop
  // identity churn. router.refresh() re-renders the page with brand-new
  // card/gameSystems/templates objects every time; resetting on those wiped
  // live edits "randomly" while users were typing.
  const resetKey = card ? `${card.id}:${card.updated_at}` : "new";
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    reset(defaults);
  }, [resetKey, defaults, reset]);

  // ----- Save model: explicit Save button + automatic LOCAL draft. -----
  // The server save is deliberate (it bakes the public PNG and carries
  // publish semantics), but unsaved work should never be lost: in create/
  // preview mode the form persists a debounced draft to localStorage, restores
  // it on the next visit (including a guest signing in and landing on
  // /create), and clears it on a successful save. Edit mode trusts the server
  // copy and instead warns before unloading with unsaved changes.
  const isDraftMode = mode === "create" && !card;
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (!isDraftMode || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    try {
      const raw =
        window.localStorage.getItem(CARD_DRAFT_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_CARD_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<FormValues>;
      if (!draft || typeof draft !== "object") return;
      // Migrate pre-rebrand drafts forward; future writes use the new key.
      window.localStorage.setItem(CARD_DRAFT_STORAGE_KEY, raw);
      window.localStorage.removeItem(LEGACY_CARD_DRAFT_STORAGE_KEY);
      reset({ ...defaults, ...draft });
      toast.info("Restored your unsaved draft.", {
        action: {
          label: "Start fresh",
          onClick: () => {
            window.localStorage.removeItem(CARD_DRAFT_STORAGE_KEY);
            reset(defaults);
          },
        },
      });
    } catch {
      // Corrupt/blocked storage — start clean.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraftMode]);

  // useWatch is the React Compiler-friendly subscription variant of watch().
  // We feed it the same defaults useForm has, so RHF always populates every
  // field; the cast just lifts useWatch's DeepPartial<> back to FormValues.
  const watched = useWatch({ control, defaultValue: defaults }) as FormValues;

  // Debounced draft writes — every change while dirty, 800ms after the last.
  useEffect(() => {
    if (!isDraftMode || !isDirty) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          CARD_DRAFT_STORAGE_KEY,
          JSON.stringify(watched),
        );
      } catch {
        // Storage full/blocked — the explicit Save path still works.
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [isDraftMode, isDirty, watched]);

  // Native "leave site?" guard whenever there are unsaved changes. Draft mode
  // is covered by localStorage, but edit mode has no local copy.
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (isDirtyRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // The Adventure frame repurposes the back-face content as the adventure spell
  // (rendered inline on the card's left page, not as a flippable face), so the
  // "Back face" tab presents itself as "Adventure" when that frame is selected.
  const isAdventureFrame =
    normalizeFrameTemplate(watched.frame_style?.template) === "adventure";

  // ---- Frame-aware stepper ----
  // The visible steps + their order depend on the frame, card type, and whether
  // a back face exists (lib/creator/steps.ts). `current` is clamped so it stays
  // valid when the list shrinks (e.g. the user turns a DFC back off).
  const stepCtx: StepContext = {
    template: watched.frame_style?.template,
    cardType: watched.card_type,
    hasBackFace: watched.has_back_face,
  };
  const steps = visibleSteps(stepCtx);
  const idx = Math.min(current, steps.length - 1);
  const activeStep = steps[idx];
  const stepKey = activeStep?.key;
  const isLastStep = idx === steps.length - 1;
  const statVis = statVisibility(watched.card_type);

  const goToIndex = (i: number) =>
    setCurrent(Math.max(0, Math.min(i, steps.length - 1)));
  const goToStepKey = (key: StepKey) => {
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) setCurrent(i);
  };
  // Keep the listener-facing nav handle pointed at the latest closure (the
  // hero/palette listeners are registered once with a stable ref).
  useEffect(() => {
    goToStepKeyRef.current = goToStepKey;
  });
  const goBack = () => goToIndex(idx - 1);
  // Navigation never blocks: a guest exploring the flow shouldn't have to
  // invent a title to see step 3. Validation runs at save — submit errors
  // route to the offending step (see onSubmit's error handling) and light the
  // step marker red.
  const goNext = () => goToIndex(idx + 1);

  // Which steps own a field that currently has an error — drives the step
  // marker's error state. Routes nested back_face.* errors to their root.
  const stepsWithErrors = useMemo(() => {
    const map = buildFieldToStep();
    const set = new Set<StepKey>();
    for (const name of Object.keys(errors)) {
      const root = name.split(".")[0] as keyof FormValues;
      const key = map.get(root);
      if (key) set.add(key);
    }
    return set;
  }, [errors]);

  const stepperSteps: StepperStep[] = steps.map((step) => ({
    key: step.key,
    label: stepLabel(step, stepCtx),
    description: step.description,
    hasError: stepsWithErrors.has(step.key),
  }));

  // "Match mana cost" — auto-derive color identity from the cost so picking
  // {R}{R} can never produce a colorless frame by accident. Any manual chip
  // edit or imported identity turns the automation off.
  const [autoColors, setAutoColors] = useState(mode === "create");
  const derivedColors = useMemo(
    () => deriveColorIdentity(watched.cost ?? ""),
    [watched.cost],
  );
  useEffect(() => {
    if (!autoColors) return;
    // A cost with no colored pips says nothing about identity (lands,
    // artifacts) — leave whatever the user picked.
    if (derivedColors.length === 0) return;
    const current = watched.color_identity;
    const same =
      current.length === derivedColors.length &&
      derivedColors.every((c) => current.includes(c));
    if (!same) {
      setValue("color_identity", derivedColors, { shouldDirty: true });
    }
  }, [autoColors, derivedColors, watched.color_identity, setValue]);

  // Keep a type-derived STANDARD frame in sync with the card type, so changing
  // type (e.g. creature → planeswalker) swaps to the right variant (m15 → m15pw)
  // automatically — no more frame/type mismatches. Special layouts (Saga,
  // Adventure…) and showcase frames are explicit picks and stay put. When the
  // current era can't frame the new type (Classic has no planeswalker), fall
  // forward to the M15 era which frames everything.
  const currentTemplate = (watched.frame_style?.template ??
    DEFAULT_FRAME_TEMPLATE) as FrameTemplate;
  useEffect(() => {
    if (!isTypeDerivedStandard(currentTemplate)) return;
    const era = eraForTemplate(currentTemplate);
    const resolved =
      standardFrameFor(era, watched.card_type) ??
      standardFrameFor("m15", watched.card_type);
    if (resolved && resolved !== currentTemplate) {
      setValue("frame_style.template", resolved, { shouldDirty: true });
    }
  }, [watched.card_type, currentTemplate, setValue]);

  // Caret-preserving symbol insertion for the rules textareas (front + back).
  // register() is hoisted so the field ref can be merged with a local DOM ref.
  const rulesTextField = register("rules_text");
  const backRulesTextField = register("back_face.rules_text");
  const rulesTextRef = useRef<HTMLTextAreaElement | null>(null);
  const backRulesTextRef = useRef<HTMLTextAreaElement | null>(null);
  const insertSymbol = (
    field: "rules_text" | "back_face.rules_text",
    ref: React.MutableRefObject<HTMLTextAreaElement | null>,
    token: string,
  ) => {
    const el = ref.current;
    const current =
      field === "rules_text"
        ? getValues("rules_text") ?? ""
        : getValues("back_face.rules_text") ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setValue(field, next, { shouldDirty: true });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  // Slice of the live form state the AI panel sends as context. Stripping
  // empty strings keeps the prompt tight.
  const cardContext: CardContext = {
    title: watched.title.trim() || undefined,
    cost: watched.cost.trim() || undefined,
    card_type:
      watched.card_type && (CARD_TYPE_VALUES as readonly string[]).includes(watched.card_type)
        ? (watched.card_type as CardType)
        : undefined,
    supertype: watched.supertype.trim() || undefined,
    subtypes:
      parseSubtypes(watched.subtypes_text).length > 0
        ? parseSubtypes(watched.subtypes_text)
        : undefined,
    rarity:
      watched.rarity && (RARITY_VALUES as readonly string[]).includes(watched.rarity)
        ? (watched.rarity as Rarity)
        : undefined,
    color_identity:
      watched.color_identity.length > 0 ? watched.color_identity : undefined,
    rules_text: watched.rules_text.trim() || undefined,
    flavor_text: watched.flavor_text.trim() || undefined,
    power: watched.power.trim() || undefined,
    toughness: watched.toughness.trim() || undefined,
    loyalty: watched.loyalty.trim() || undefined,
    defense: watched.defense.trim() || undefined,
  };

  // Apply an AI patch through setValue so RHF marks every touched field
  // dirty. Strings are passed through as-is; the color_identity readonly
  // tuple from the schema is widened to a mutable array.
  const handleAIPatch = (patch: CardFieldPatch) => {
    const setIfPresent = (
      key: keyof FormValues,
      value: string | undefined,
    ) => {
      if (value === undefined) return;
      setValue(key, value as never, { shouldDirty: true });
    };

    setIfPresent("title", patch.title);
    setIfPresent("cost", patch.cost);
    setIfPresent("card_type", patch.card_type);
    setIfPresent("supertype", patch.supertype);
    setIfPresent("subtypes_text", patch.subtypes_text);
    setIfPresent("rarity", patch.rarity);
    setIfPresent("rules_text", patch.rules_text);
    setIfPresent("flavor_text", patch.flavor_text);
    setIfPresent("power", patch.power);
    setIfPresent("toughness", patch.toughness);

    if (patch.color_identity) {
      setAutoColors(false);
      setValue(
        "color_identity",
        Array.from(patch.color_identity) as ColorIdentity[],
        { shouldDirty: true },
      );
    }
  };

  // Apply a Scryfall import payload. Fields not present in the patch are
  // left alone — if the user already filled a Title, we don't blow it away.
  // The `importedArtUrl` (set when the user opted to also import artwork)
  // is written to art_url and resets the focal point so the new image
  // shows centered.
  const handleScryfallImport = ({
    patch,
    importedArtUrl,
    source,
  }: ScryfallImportPayload) => {
    const setIfPresent = (key: keyof FormValues, value: string | undefined) => {
      if (value === undefined) return;
      setValue(key, value as never, { shouldDirty: true });
    };

    setIfPresent("title", patch.title);
    setIfPresent("cost", patch.cost);
    setIfPresent("card_type", patch.card_type);
    setIfPresent("supertype", patch.supertype);
    setIfPresent("subtypes_text", patch.subtypes_text);
    setIfPresent("rarity", patch.rarity);
    setIfPresent("rules_text", patch.rules_text);
    setIfPresent("flavor_text", patch.flavor_text);
    setIfPresent("power", patch.power);
    setIfPresent("toughness", patch.toughness);
    setIfPresent("loyalty", patch.loyalty);
    setIfPresent("defense", patch.defense);
    setIfPresent("artist_credit", patch.artist_credit);

    if (patch.color_identity) {
      setAutoColors(false);
      setValue(
        "color_identity",
        Array.from(patch.color_identity) as ColorIdentity[],
        { shouldDirty: true },
      );
    }

    if (importedArtUrl) {
      setValue("art_url", importedArtUrl, { shouldDirty: true });
      setValue(
        "art_position",
        { focalX: 0.5, focalY: 0.5, scale: 1 },
        { shouldDirty: true },
      );
    }

    // DFC handling: if the Scryfall card had a back face, the mapper
    // returns `patch.back_face`. Enable has_back_face and populate the
    // nested object. The back-face art import is a separate explicit step
    // (mode: "art-back") — for now we just seed the text fields.
    if (patch.back_face) {
      const bf = patch.back_face;
      setValue("has_back_face", true, { shouldDirty: true });
      setValue(
        "back_face",
        {
          title: bf.title ?? "",
          cost: bf.cost ?? "",
          card_type: bf.card_type ?? "",
          supertype: bf.supertype ?? "",
          subtypes_text: bf.subtypes_text ?? "",
          rules_text: bf.rules_text ?? "",
          flavor_text: bf.flavor_text ?? "",
          power: bf.power ?? "",
          toughness: bf.toughness ?? "",
          loyalty: bf.loyalty ?? "",
          defense: bf.defense ?? "",
          artist_credit: bf.artist_credit ?? "",
          art_url: bf.imported_art_url ?? "",
          art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
        },
        { shouldDirty: true },
      );
    }

    // Stamp the Scryfall provenance so the saved card joins the
    // "Also remixed by N" group on the public detail page (chunk 13).
    if (patch.source_scryfall_id) {
      setValue("source_scryfall_id", patch.source_scryfall_id, {
        shouldDirty: true,
      });
    }

    setRemixSource({ name: source.name, scryfallUri: source.scryfallUri });
    // Pop the user back to Identity so they can see the seeded fields.
    goToStepKey("details");
  };

  // Kick off /api/ai/random-card and pour the result into the form. Art is
  // optional — the model occasionally trips gpt-image-1's safety filter even on
  // benign prompts; we surface a soft toast in that case and leave the
  // existing art_url alone so the user can upload their own.
  const handleRandomCard = async () => {
    if (!userId) {
      toast.error("Sign in to use the AI random card generator.");
      return;
    }
    setGeneratingRandom(true);
    try {
      const response = await fetch("/api/ai/random-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        if (
          response.status === 402 ||
          payload?.code === "INSUFFICIENT_CREDITS"
        ) {
          upgrade.open("credits");
        } else {
          toast.error(
            payload?.error ?? "Random card generation failed. Try again.",
          );
        }
        return;
      }
      const card = payload.card as {
        title: string;
        cost: string;
        card_type: CardType;
        supertype?: string;
        subtypes?: string[];
        rarity: Rarity;
        color_identity: ColorIdentity[];
        rules_text: string;
        flavor_text?: string;
        power?: string;
        toughness?: string;
        loyalty?: string;
        defense?: string;
      };

      setValue("title", card.title, { shouldDirty: true });
      setValue("cost", card.cost, { shouldDirty: true });
      setValue("card_type", card.card_type, { shouldDirty: true });
      setAutoColors(false);
      setValue("supertype", card.supertype ?? "", { shouldDirty: true });
      setValue("subtypes_text", (card.subtypes ?? []).join(", "), {
        shouldDirty: true,
      });
      setValue("rarity", card.rarity, { shouldDirty: true });
      setValue(
        "color_identity",
        Array.from(card.color_identity) as ColorIdentity[],
        { shouldDirty: true },
      );
      setValue("rules_text", card.rules_text, { shouldDirty: true });
      setValue("flavor_text", card.flavor_text ?? "", { shouldDirty: true });
      setValue("power", card.power ?? "", { shouldDirty: true });
      setValue("toughness", card.toughness ?? "", { shouldDirty: true });
      setValue("loyalty", card.loyalty ?? "", { shouldDirty: true });
      setValue("defense", card.defense ?? "", { shouldDirty: true });

      if (payload.art?.ok && payload.art.publicUrl) {
        setValue("art_url", payload.art.publicUrl, { shouldDirty: true });
        setValue(
          "art_position",
          { focalX: 0.5, focalY: 0.5, scale: 1 },
          { shouldDirty: true },
        );
        toast.success("Random card forged — review and tweak before saving.");
      } else {
        const detail =
          payload.artError ??
          "The art generator hit a snag; the card text is ready.";
        toast.message("Random card forged", { description: detail });
      }
      // Pop the user back to Identity so they see the new card.
      goToStepKey("details");
    } catch {
      toast.error("Network error while generating a random card.");
    } finally {
      setGeneratingRandom(false);
    }
  };

  // ---- Submit ----
  const onSubmit: SubmitHandler<FormValues> = (values) => {
    setServerError(null);

    // Build the back_face payload only when the user toggled it on.
    // When off, send `null` so the server clears any previously-persisted
    // back face (the action treats `null` as an explicit clear vs.
    // `undefined` which would be a no-op).
    const backFacePayload = values.has_back_face
      ? {
          title: values.back_face.title.trim(),
          cost: values.back_face.cost.trim() || undefined,
          card_type: values.back_face.card_type || undefined,
          supertype: values.back_face.supertype.trim() || undefined,
          subtypes: parseSubtypes(values.back_face.subtypes_text),
          rules_text: values.back_face.rules_text.trim() || undefined,
          flavor_text: values.back_face.flavor_text.trim() || undefined,
          power: values.back_face.power.trim() || undefined,
          toughness: values.back_face.toughness.trim() || undefined,
          loyalty: values.back_face.loyalty.trim() || undefined,
          defense: values.back_face.defense.trim() || undefined,
          artist_credit: values.back_face.artist_credit.trim() || undefined,
          art_url: values.back_face.art_url.trim() || undefined,
          art_position: values.back_face.art_position,
        }
      : null;

    const payload = {
      title: values.title.trim(),
      slug: values.slug.trim() ? slugify(values.slug.trim()) : undefined,
      game_system_id: values.game_system_id,
      template_id: values.template_id || undefined,
      cost: values.cost.trim() || undefined,
      color_identity: values.color_identity,
      supertype: values.supertype.trim() || undefined,
      card_type: values.card_type || undefined,
      subtypes: parseSubtypes(values.subtypes_text),
      tags: parseTags(values.tags_text),
      rarity: values.rarity || undefined,
      rules_text: values.rules_text.trim() || undefined,
      flavor_text: values.flavor_text.trim() || undefined,
      power: values.power.trim() || undefined,
      toughness: values.toughness.trim() || undefined,
      loyalty: values.loyalty.trim() || undefined,
      defense: values.defense.trim() || undefined,
      artist_credit: values.artist_credit.trim() || undefined,
      art_url: values.art_url.trim() || undefined,
      art_position: values.art_position,
      frame_style: values.frame_style,
      visibility: values.visibility,
      back_face: backFacePayload,
      // Empty string → undefined so we don't send a no-op or fail the
      // UUID validator. A future "unlink from source" button could send
      // `null` instead to explicitly clear.
      source_scryfall_id: values.source_scryfall_id.trim() || undefined,
      // Empty → null clears the association; a UUID adds the card to that set.
      primary_set_id: values.primary_set_id || null,
    };

    startTransition(async () => {
      const applyFieldErrors = (
        fieldErrors: Record<string, string | undefined> | undefined,
      ) => {
        if (!fieldErrors) return;
        let firstErrorField: string | null = null;
        for (const [name, message] of Object.entries(fieldErrors)) {
          if (!message) continue;
          setError(name as keyof FormValues, { message });
          if (!firstErrorField) firstErrorField = name;
        }
        // Jump to the step owning the first errored field (falls back to the
        // last step if that step isn't currently visible).
        if (firstErrorField) goToIndex(stepIndexForField(firstErrorField, steps));
      };

      const handleUpgradeOrError = (failure: {
        formError?: string;
        fieldErrors?: Record<string, string | undefined>;
        code?: string;
      }) => {
        applyFieldErrors(failure.fieldErrors);
        if (failure.code === "UPGRADE_REQUIRED") {
          upgrade.open(
            failure.fieldErrors?.frame_style ? "premium_frame" : "capacity",
          );
          return;
        }
        if (failure.formError) {
          setServerError(failure.formError);
          toast.error(failure.formError);
        }
      };

      if (mode === "create") {
        const result = await createCardAction(payload);
        if (!result.ok) {
          handleUpgradeOrError(result);
          return;
        }
        toast.success(`Saved “${payload.title}”`);
        try {
          window.localStorage.removeItem(CARD_DRAFT_STORAGE_KEY);
        } catch {
          // best-effort
        }
        // Land on the same step in edit mode instead of resetting to Frame.
        router.replace(
          `/card/${result.slug}/edit?step=${activeStep?.key ?? "publish"}`,
        );
        router.refresh();
        return;
      }

      // edit
      if (!card?.id) {
        setServerError("Cannot find this card to update.");
        return;
      }
      const result = await updateCardAction(card.id, payload);
      if (!result.ok) {
        handleUpgradeOrError(result);
        return;
      }
      toast.success("Changes saved.");
      // Mark clean right away (keeping the on-screen values); the keyed reset
      // swaps in server truth when the refresh lands.
      reset(undefined, { keepValues: true });
      // If the slug changed, follow it.
      if (result.slug !== card.slug) {
        router.replace(`/card/${result.slug}/edit`);
      }
      router.refresh();
    });
  };

  const cardTypeForPreview =
    watched.card_type === "" ? null : (watched.card_type as CardType);
  const rarityForPreview = watched.rarity === "" ? null : (watched.rarity as Rarity);

  // Shared live-preview props for the desktop sticky aside + the mobile inline
  // preview, so they never drift. `face` shows the back only on the Extra step
  // for a true DFC (Adventure renders its second face inline, so it stays front).
  const previewFace: "front" | "back" =
    stepKey === "extra" && !isAdventureFrame ? "back" : "front";
  const previewProps = {
    staticInEditor: true,
    title: watched.title,
    cost: watched.cost,
    cardType: cardTypeForPreview,
    supertype: watched.supertype || null,
    subtypes: parseSubtypes(watched.subtypes_text),
    rarity: rarityForPreview,
    colorIdentity: watched.color_identity,
    rulesText: watched.rules_text,
    flavorText: watched.flavor_text,
    power: watched.power,
    toughness: watched.toughness,
    loyalty: watched.loyalty,
    defense: watched.defense,
    artistCredit: watched.artist_credit,
    artUrl: watched.art_url || null,
    artPosition: watched.art_position,
    frameStyle: watched.frame_style,
    backFace: watched.has_back_face
      ? {
          title: watched.back_face.title,
          cost: watched.back_face.cost || undefined,
          card_type:
            watched.back_face.card_type === ""
              ? undefined
              : (watched.back_face.card_type as CardType),
          supertype: watched.back_face.supertype || undefined,
          subtypes: parseSubtypes(watched.back_face.subtypes_text),
          rules_text: watched.back_face.rules_text || undefined,
          flavor_text: watched.back_face.flavor_text || undefined,
          power: watched.back_face.power || undefined,
          toughness: watched.back_face.toughness || undefined,
          loyalty: watched.back_face.loyalty || undefined,
          defense: watched.back_face.defense || undefined,
          artist_credit: watched.back_face.artist_credit || undefined,
          art_url: watched.back_face.art_url || undefined,
          art_position: watched.back_face.art_position,
        }
      : null,
    face: previewFace,
  };

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit, (formErrors) => {
          // Client validation blocked the save — jump to the first errored step.
          const first = Object.keys(formErrors)[0];
          if (first) goToIndex(stepIndexForField(first, steps));
        })}
        className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]"
      >
        {/* ----- Left: form ----- */}
        <SurfaceCard className="flex flex-col gap-6 p-6">
          {serverError ? (
            <div
              role="alert"
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
            >
              {serverError}
            </div>
          ) : null}

          <div className="flex flex-col gap-6">
            <Stepper
              steps={stepperSteps}
              current={idx}
              onStepSelect={goToIndex}
              isStepEnabled={() => true}
            />

            {/* Mobile inline preview — keeps the card visible while editing
                (the desktop sticky aside is hidden below lg). CSS-only toggle. */}
            <details
              className="rounded-lg border border-border/60 bg-elevated/30 lg:hidden"
              open
            >
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle [&::-webkit-details-marker]:hidden">
                Live preview
                <span className="text-[10px] normal-case text-muted">
                  tap to toggle
                </span>
              </summary>
              <div className="mx-auto w-full max-w-[220px] px-4 pb-4">
                <CardPreview {...previewProps} />
              </div>
            </details>

            {/* ----- Frame step ----- */}
            {stepKey === "frame" ? (
              <FrameStep
                userId={userId}
                cardType={watched.card_type}
                colorIdentity={watched.color_identity}
                autoColors={autoColors}
                onAutoColorsChange={setAutoColors}
                generatingRandom={generatingRandom}
                onRandomCard={handleRandomCard}
                onOpenScryfall={() => setScryfallOpen(true)}
              />
            ) : null}

            {/* ----- Details step ----- */}
            {stepKey === "details" ? (
              <DetailsStep frameTemplate={watched.frame_style?.template} />
            ) : null}

            {/* ----- Rules step ----- */}
            {stepKey === "rules" ? (
              <RulesStep
                statVis={statVis}
                cardContext={cardContext}
                aiConfigured={aiConfigured}
                onAIPatch={handleAIPatch}
                rulesTextField={rulesTextField}
                rulesTextRef={rulesTextRef}
                onInsertSymbol={(token) =>
                  insertSymbol("rules_text", rulesTextRef, token)
                }
              />
            ) : null}

            {/* ----- Art step ----- */}
            {stepKey === "art" ? <ArtStep userId={userId} /> : null}

            {/* ----- Adventure / Back face step ----- */}
            {stepKey === "extra" ? (
              <ExtraStep
                userId={userId}
                hasBackFace={watched.has_back_face}
                isAdventureFrame={isAdventureFrame}
                backRulesTextField={backRulesTextField}
                backRulesTextRef={backRulesTextRef}
                onInsertSymbol={(token) =>
                  insertSymbol("back_face.rules_text", backRulesTextRef, token)
                }
              />
            ) : null}

            {/* ----- Publish step ----- */}
            {stepKey === "publish" ? (
              <PublishStep
                ownerUsername={ownerUsername}
                mySets={mySets}
                watchedSlug={watched.slug}
                watchedTitle={watched.title}
              />
            ) : null}
          </div>

          {/* Controlled Scryfall import dialog. Rendered once; opened by:
              - the Identity-tab inline trigger (above)
              - the start-with hero on /create
              - the global command palette
              All three paths just flip `scryfallOpen` via state or events. */}
          <ScryfallImportDialog
            signedIn={Boolean(userId)}
            onImport={handleScryfallImport}
            open={scryfallOpen}
            onOpenChange={setScryfallOpen}
          />

          {/* Action bar — sticky across all tabs so saving never requires
              switching back to a "publishing" tab. */}
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-surface/95 px-6 py-4 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {isDirty ? (
                <Badge variant="accent" className="gap-1.5">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {isDraftMode ? "Draft kept on this device" : "Unsaved changes"}
                </Badge>
              ) : (
                <Badge variant="default">Up to date</Badge>
              )}
              {remixSource ? (
                <Badge variant="primary" className="gap-1.5">
                  Remixed from{" "}
                  {remixSource.scryfallUri ? (
                    <a
                      href={remixSource.scryfallUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {remixSource.name}
                    </a>
                  ) : (
                    <span>{remixSource.name}</span>
                  )}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {idx > 0 ? (
                <Button type="button" variant="ghost" onClick={goBack}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </Button>
              ) : null}
              {mode === "edit" && card ? (
                <DeleteCardDialog
                  cardId={card.id}
                  cardTitle={card.title}
                  redirectTo="/dashboard"
                />
              ) : idx === 0 ? (
                <Button asChild variant="ghost">
                  <Link href="/dashboard">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    Cancel
                  </Link>
                </Button>
              ) : null}
              {isLastStep ? (
                !userId ? (
                  // Guests (e.g. the /preview creator) can't save — the server
                  // action rejects unauthenticated writes. Send them to sign in
                  // rather than showing a Save button that bounces with an error.
                  <Button asChild size="lg">
                    <Link href="/login?redirectTo=/create">
                      <Lock className="h-4 w-4" aria-hidden />
                      Sign in to save
                    </Link>
                  </Button>
                ) : (
                  <Button type="submit" disabled={isSubmitting} size="lg">
                    {isSubmitting ? (
                      <>
                        <Wand2 className="h-4 w-4 animate-pulse" aria-hidden />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" aria-hidden />
                        {mode === "edit" ? "Save changes" : "Save card"}
                      </>
                    )}
                  </Button>
                )
              ) : (
                <Button type="button" size="lg" onClick={goNext}>
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </div>
        </SurfaceCard>

        {/* ----- Right: live preview (desktop; mobile uses the inline
            <details> preview above the step content) ----- */}
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Live preview
            </p>
            <div className="mx-auto w-full max-w-sm">
              <CardPreview {...previewProps} />
            </div>
            <p className="text-xs leading-5 text-muted">
              Saving doesn&apos;t publish — visibility above controls who can see
              this card.
            </p>
          </div>
        </aside>
      </form>
    </FormProvider>
  );
}
