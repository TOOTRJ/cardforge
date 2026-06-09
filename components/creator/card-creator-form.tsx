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
  Controller,
  useForm,
  useWatch,
  type SubmitHandler,
} from "react-hook-form";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Coins,
  Crown,
  Globe2,
  Link2,
  Lock,
  Mountain,
  Save,
  Search,
  Shield,
  Sparkles,
  Swords,
  Wand2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { CardPreview } from "@/components/cards/card-preview";
import { ManaCostPicker } from "@/components/cards/mana-cost-picker";
import { tokenize } from "@/components/cards/mana-cost-glyphs";
import { RulesSymbolToolbar } from "@/components/creator/rules-symbol-toolbar";
import { ArtUploader } from "@/components/creator/art-uploader";
import { DeleteCardDialog } from "@/components/creator/delete-card-dialog";
import {
  AIAssistantPanel,
  type CardFieldPatch,
} from "@/components/creator/ai-assistant-panel";
import {
  ScryfallImportDialog,
  type ScryfallImportPayload,
} from "@/components/creator/scryfall-import-dialog";
import {
  CARDFORGE_EVENTS,
  FORM_SCROLL_TARGET_ID,
} from "@/components/creator/start-with-hero";
import type { CardContext } from "@/lib/ai/schemas";
import {
  createCardAction,
  updateCardAction,
} from "@/lib/cards/actions";
import { slugify } from "@/lib/validation/card";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type ArtPosition,
  type Card,
  type CardBackFace,
  type CardFinish,
  type CardTemplate,
  type CardType,
  type ColorIdentity,
  type FrameSet,
  type FrameStyle,
  type FrameTemplate,
  type GameSystem,
  type Rarity,
  type Visibility,
  COMING_SOON_FRAMES,
  COMING_SOON_SETS,
  DEFAULT_FRAME_TEMPLATE,
  FRAME_SET_DEFAULT_TEMPLATE,
  FRAME_SET_LABELS,
  FRAME_SET_VALUES,
  FRAME_TEMPLATE_LABELS,
  FRAME_TEMPLATE_SET,
  FRAME_TEMPLATE_VALUES,
} from "@/types/card";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  EMPTY_BACK_FACE,
  type BackFaceFormValues,
  type FormValues,
} from "@/lib/creator/form-types";
import {
  buildFieldToStep,
  hidesCost,
  statVisibility,
  stepIndexForField,
  stepLabel,
  visibleSteps,
  type StepContext,
  type StepKey,
} from "@/lib/creator/steps";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Form values — mirror createCardSchema but typed at the component boundary.
// We intentionally keep "string" for inputs that the form serializes from
// text fields and convert to the schema's optional/empty-as-undefined shape
// at submission time.
// ---------------------------------------------------------------------------

// FormValues / BackFaceFormValues / EMPTY_BACK_FACE now live in
// lib/creator/form-types.ts so the pure step model (lib/creator/steps.ts) can
// reference them without importing this client component.

type CardSetOption = {
  id: string;
  title: string;
  icon_url: string | null;
  icon_code: string | null;
};

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

// Modern MTG card type picker. The legacy "spell" value is still accepted
// by the DB (migration 0018 keeps it in the check constraint) so existing
// rows render fine, but new cards pick a more specific instant/sorcery.
const CARD_TYPE_OPTIONS: ChipOption<CardType>[] = [
  { value: "creature", label: "Creature", icon: Swords },
  { value: "instant", label: "Instant", icon: Zap },
  { value: "sorcery", label: "Sorcery", icon: Wand2 },
  { value: "artifact", label: "Artifact", icon: Box },
  { value: "enchantment", label: "Enchantment", icon: Sparkles },
  { value: "land", label: "Land", icon: Mountain },
  { value: "planeswalker", label: "Planeswalker", icon: Crown },
  { value: "battle", label: "Battle", icon: Shield },
  { value: "token", label: "Token", icon: Coins },
];

const RARITY_COLOR_HEX: Record<Rarity, string> = {
  common: "#cfcfd4",
  uncommon: "#c6e2f5",
  rare: "#f3d57c",
  mythic: "#f08a4a",
};

const RARITY_OPTIONS: ChipOption<Rarity>[] = RARITY_VALUES.map((rarity) => ({
  value: rarity,
  label: rarity,
  leading: <SmallGem color={RARITY_COLOR_HEX[rarity]} />,
  activeClass: "border-foreground/50 bg-elevated text-foreground",
}));

const VISIBILITY_OPTIONS: ChipOption<Visibility>[] = [
  {
    value: "private",
    label: "Private",
    description: "Only you can see it.",
    icon: Lock,
  },
  {
    value: "unlisted",
    label: "Unlisted",
    description: "Anyone with the link can view, hidden from the gallery.",
    icon: Link2,
  },
  {
    value: "public",
    label: "Public",
    description: "Listed in the public gallery and your profile. The default.",
    icon: Globe2,
  },
];

// Frame template options — the MSE-derived MTG frame PNG that sits behind the
// card. All are converted from the open-source Full-Magic-Pack (MSE template).
// Each chip leads with a small thumbnail of the frame so the (now sizable)
// list is choosable by sight, not just by name.
const TEMPLATE_OPTIONS: ChipOption<FrameTemplate>[] = FRAME_TEMPLATE_VALUES.map(
  (template) => ({
    value: template,
    label: FRAME_TEMPLATE_LABELS[template],
    leading: <FrameThumb template={template} />,
  }),
);

// How many shippable frames each set holds — surfaced on the set chip so a set
// reads as a *family* of frames, not a single style. Derived from the
// template→set map so it stays correct as frames are added.
const FRAMES_PER_SET = FRAME_TEMPLATE_VALUES.reduce(
  (acc, template) => {
    const set = FRAME_TEMPLATE_SET[template];
    acc[set] = (acc[set] ?? 0) + 1;
    return acc;
  },
  {} as Record<FrameSet, number>,
);

// Frame-set chips (the first step of the picker). Each leads with a thumbnail
// of the set's default frame and notes how many frames the family contains.
const FRAME_SET_OPTIONS: ChipOption<FrameSet>[] = FRAME_SET_VALUES.map((set) => ({
  value: set,
  label: FRAME_SET_LABELS[set],
  description: `${FRAMES_PER_SET[set]} frame${FRAMES_PER_SET[set] === 1 ? "" : "s"}`,
  leading: <FrameThumb template={FRAME_SET_DEFAULT_TEMPLATE[set]} />,
}));

// "Coming soon" chips — disabled, badge-tagged display rows for frames/sets on
// the roadmap (types/card.ts). They're a separate ChipGroup block so the real
// (typed) frame selection stays type-safe; clicks are no-ops.
function SoonBadge() {
  return (
    <span className="rounded-full border border-border/70 bg-elevated px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-subtle">
      Soon
    </span>
  );
}
const COMING_SOON_SET_OPTIONS: ChipOption<string>[] = COMING_SOON_SETS.map(
  (s) => ({ value: `soon:${s.key}`, label: s.label, disabled: true, badge: <SoonBadge /> }),
);
const comingSoonFrameOptions = (set: FrameSet): ChipOption<string>[] =>
  COMING_SOON_FRAMES.filter((f) => f.set === set).map((f) => ({
    value: `soon:${f.key}`,
    label: f.label,
    disabled: true,
    badge: <SoonBadge />,
  }));

// Finish presets — premium treatments layered on top of the base frame.
// Descriptions are surfaced via ChipGroup's `md` size which shows the
// description under the label.
const FINISH_OPTIONS: ChipOption<CardFinish>[] = [
  {
    value: "regular",
    label: "Regular",
    description: "Baseline frame. The default look.",
  },
  {
    value: "foil",
    label: "Foil",
    description: "Animated holographic sheen for showpieces.",
    activeClass: "border-accent bg-accent/15 text-accent",
  },
  {
    value: "etched",
    label: "Etched",
    description: "Gold-leaf inner border with a subtle texture.",
    activeClass: "border-amber-300 bg-amber-300/15 text-amber-200",
  },
  {
    value: "showcase",
    label: "Showcase",
    description: "Italic display title with an ornate hairline.",
    activeClass: "border-primary bg-primary/15 text-primary",
  },
];

// Color swatch gradients — mirror the ManaCostGlyphs palette so the
// color-identity chips read as the same color language as the cost preview.
// Multicolor is a conic sweep so it visibly differs from any single color.
const COLOR_SWATCH: Record<ColorIdentity, string> = {
  white:
    "radial-gradient(circle at 30% 25%, #fff 0%, #f7eccb 45%, #cfb787 100%)",
  blue:
    "radial-gradient(circle at 30% 25%, #dff2ff 0%, #7cc3ee 45%, #1f6aa1 100%)",
  black:
    "radial-gradient(circle at 30% 25%, #d6cfc8 0%, #5b5550 45%, #1a1814 100%)",
  red:
    "radial-gradient(circle at 30% 25%, #ffd9c7 0%, #ec6f4c 45%, #8e2c14 100%)",
  green:
    "radial-gradient(circle at 30% 25%, #dcf2c8 0%, #79b664 45%, #234e1a 100%)",
  multicolor:
    "conic-gradient(from 45deg, #cfb787, #7cc3ee, #ec6f4c, #79b664, #c98cf7, #cfb787)",
  colorless:
    "radial-gradient(circle at 30% 25%, #eceaea 0%, #b8b5b3 45%, #6f6c69 100%)",
};

const COLOR_IDENTITY_OPTIONS: ChipOption<ColorIdentity>[] =
  COLOR_IDENTITY_VALUES.map((color) => ({
    value: color,
    label: color,
    leading: <ColorSwatch color={color} />,
    activeClass: "border-foreground/50 bg-elevated text-foreground",
  }));


function backFaceFormValuesFrom(
  source: CardBackFace | null | undefined,
): BackFaceFormValues {
  if (!source) return EMPTY_BACK_FACE;
  return {
    title: source.title ?? "",
    cost: source.cost ?? "",
    card_type: source.card_type ?? "",
    supertype: source.supertype ?? "",
    subtypes_text: source.subtypes?.join(", ") ?? "",
    rules_text: source.rules_text ?? "",
    flavor_text: source.flavor_text ?? "",
    power: source.power ?? "",
    toughness: source.toughness ?? "",
    loyalty: source.loyalty ?? "",
    defense: source.defense ?? "",
    artist_credit: source.artist_credit ?? "",
    art_url: source.art_url ?? "",
    art_position: source.art_position ?? {
      focalX: 0.5,
      focalY: 0.5,
      scale: 1,
    },
  };
}

function defaultValuesFor(
  card: Card | null | undefined,
  gameSystems: GameSystem[],
  templates: CardTemplate[],
): FormValues {
  const fallbackGameSystem = gameSystems[0]?.id ?? "";
  const fallbackTemplate = templates[0]?.id ?? "";

  if (!card) {
    return {
      title: "",
      slug: "",
      game_system_id: fallbackGameSystem,
      template_id: fallbackTemplate,
      cost: "",
      color_identity: [],
      supertype: "",
      card_type: "creature",
      subtypes_text: "",
      tags_text: "",
      rarity: "common",
      rules_text: "",
      flavor_text: "",
      power: "",
      toughness: "",
      loyalty: "",
      defense: "",
      artist_credit: "",
      art_url: "",
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: {
        finish: "regular",
        template: DEFAULT_FRAME_TEMPLATE,
      },
      visibility: "public",
      has_back_face: false,
      back_face: EMPTY_BACK_FACE,
      source_scryfall_id: "",
      primary_set_id: "",
    };
  }

  const persistedBackFace =
    (card.back_face as CardBackFace | null | undefined) ?? null;

  // Coerce the persisted frame style, mapping any legacy/retired template
  // (e.g. the old "regular" placeholder) onto a current one so the picker
  // shows a valid selection and the save passes validation.
  const persistedFrame = (card.frame_style as FrameStyle | null) ?? {};
  const normalizedFrameStyle: FrameStyle = {
    finish: persistedFrame.finish ?? "regular",
    template: normalizeFrameTemplate(persistedFrame.template),
  };

  return {
    title: card.title,
    slug: card.slug,
    game_system_id: card.game_system_id,
    template_id: card.template_id ?? fallbackTemplate,
    cost: card.cost ?? "",
    color_identity: card.color_identity,
    supertype: card.supertype ?? "",
    card_type: card.card_type ?? "",
    subtypes_text: card.subtypes.join(", "),
    tags_text: card.tags?.join(", ") ?? "",
    rarity: card.rarity ?? "",
    rules_text: card.rules_text ?? "",
    flavor_text: card.flavor_text ?? "",
    power: card.power ?? "",
    toughness: card.toughness ?? "",
    loyalty: card.loyalty ?? "",
    defense: card.defense ?? "",
    artist_credit: card.artist_credit ?? "",
    art_url: card.art_url ?? "",
    art_position: (card.art_position as ArtPosition) ?? {
      focalX: 0.5,
      focalY: 0.5,
      scale: 1,
    },
    frame_style: normalizedFrameStyle,
    visibility: card.visibility,
    has_back_face: persistedBackFace !== null,
    back_face: backFaceFormValuesFrom(persistedBackFace),
    source_scryfall_id: card.source_scryfall_id ?? "",
    primary_set_id: card.primary_set_id ?? "",
  };
}

function parseSubtypes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .slice(0, 10);
}

// Colors actually present in a mana cost — the printed rule for a card's
// color. Drives the "match mana cost" auto color identity: solid pips, both
// hybrid halves, and phyrexian pips count; generic/X/snow/tap do not.
const COST_COLOR_NAME: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

function deriveColorIdentity(cost: string): ColorIdentity[] {
  const found: ColorIdentity[] = [];
  const add = (key: string) => {
    const name = COST_COLOR_NAME[key];
    if (name && !found.includes(name)) found.push(name);
  };
  for (const token of tokenize(cost)) {
    if (token.kind === "solid") add(token.color);
    else if (token.kind === "hybrid") {
      add(token.left);
      add(token.right);
    } else if (token.kind === "phyrexian") add(token.color);
  }
  return found;
}

function parseTags(text: string): string[] {
  // Mirror cardTagsSchema's normalization so the field preview matches what
  // actually gets saved (lowercase, alphanumeric + spaces/hyphens, collapsed).
  return text
    .split(/[,\n]/)
    .map((piece) =>
      piece
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((piece) => piece.length > 0)
    .slice(0, 12);
}

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
  const [current, setCurrent] = useState(0);
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

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    getValues,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    defaultValues: defaults,
    mode: "onSubmit",
  });

  // Reset when defaults change (e.g. navigating between drafts).
  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  // useWatch is the React Compiler-friendly subscription variant of watch().
  // We feed it the same defaults useForm has, so RHF always populates every
  // field; the cast just lifts useWatch's DeepPartial<> back to FormValues.
  const watched = useWatch({ control, defaultValue: defaults }) as FormValues;

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
        router.replace(`/card/${result.slug}/edit`);
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
            <>
              {/* Quick-start: import a real card or let the AI draft one. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-elevated/40 px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                    Start from a real card
                  </span>
                  <span className="text-[11px] text-muted">
                    Search Scryfall and seed every field, including the artwork.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!userId}
                  title={
                    userId
                      ? undefined
                      : "Sign in to search and import real cards."
                  }
                  onClick={() => setScryfallOpen(true)}
                >
                  <Search className="h-4 w-4" aria-hidden />
                  Search a real card
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    Generate with AI
                  </span>
                  <span className="text-[11px] text-muted">
                    AI drafts the card and an image model paints original art.
                    Capped at 10 random cards per day.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!userId || generatingRandom}
                  title={
                    userId
                      ? generatingRandom
                        ? "Generating…"
                        : undefined
                      : "Sign in to use the AI generator."
                  }
                  onClick={handleRandomCard}
                >
                  {generatingRandom ? (
                    <>
                      <Wand2 className="h-4 w-4 animate-pulse" aria-hidden />
                      Forging…
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4" aria-hidden />
                      Random card
                    </>
                  )}
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
                    Frame
                  </span>
                  <span className="text-xs leading-5 text-muted">
                    A <span className="font-medium text-foreground">set</span> is
                    a card family — its era and trade dress. Pick a set, then
                    choose a specific{" "}
                    <span className="font-medium text-foreground">frame</span>{" "}
                    within it.
                  </span>
                </div>
                <Controller
                  control={control}
                  name="frame_style.template"
                  render={({ field }) => {
                    const template = (field.value ??
                      DEFAULT_FRAME_TEMPLATE) as FrameTemplate;
                    const activeSet = FRAME_TEMPLATE_SET[template];
                    const setFrames = TEMPLATE_OPTIONS.filter(
                      (option) => FRAME_TEMPLATE_SET[option.value] === activeSet,
                    );
                    const soonFrames = comingSoonFrameOptions(activeSet);
                    return (
                      <div className="flex flex-col gap-5">
                        {/* Step 1 — choose the set (the card family). */}
                        <section className="flex flex-col gap-2">
                          <PickerStepLabel
                            n={1}
                            title="Choose a set"
                            count={`${FRAME_SET_VALUES.length} families`}
                          />
                          <ChipGroup
                            ariaLabel="Frame set"
                            layout="grid-2"
                            size="md"
                            value={activeSet}
                            onChange={(nextSet) => {
                              if (nextSet !== activeSet) {
                                field.onChange(
                                  FRAME_SET_DEFAULT_TEMPLATE[nextSet],
                                );
                              }
                            }}
                            options={FRAME_SET_OPTIONS}
                          />
                        </section>

                        {/* Step 2 — choose a frame inside the chosen set. */}
                        <section className="flex flex-col gap-2">
                          <PickerStepLabel
                            n={2}
                            title="Choose a frame"
                            aside={FRAME_SET_LABELS[activeSet]}
                            count={`${setFrames.length} ${
                              setFrames.length === 1 ? "frame" : "frames"
                            }`}
                          />
                          <ChipGroup
                            ariaLabel={`Frames in ${FRAME_SET_LABELS[activeSet]}`}
                            layout="grid-2"
                            size="md"
                            value={template}
                            onChange={(next) => field.onChange(next)}
                            options={setFrames}
                          />
                        </section>

                        {/* Roadmap — disabled previews of what's coming. */}
                        {soonFrames.length > 0 ||
                        COMING_SOON_SET_OPTIONS.length > 0 ? (
                          <section className="flex flex-col gap-2 rounded-lg border border-dashed border-border/50 bg-elevated/20 p-3">
                            <span className="text-[11px] uppercase tracking-wider text-subtle">
                              On the roadmap
                            </span>
                            {soonFrames.length > 0 ? (
                              <ChipGroup
                                ariaLabel="Upcoming frames"
                                layout="grid-2"
                                size="md"
                                value=""
                                onChange={() => {}}
                                options={soonFrames}
                              />
                            ) : null}
                            {COMING_SOON_SET_OPTIONS.length > 0 ? (
                              <ChipGroup
                                ariaLabel="Upcoming sets"
                                layout="grid-2"
                                size="md"
                                value=""
                                onChange={() => {}}
                                options={COMING_SOON_SET_OPTIONS}
                              />
                            ) : null}
                          </section>
                        ) : null}
                      </div>
                    );
                  }}
                />
              </div>
            </>
          ) : null}

          {/* ----- Details step ----- */}
          {stepKey === "details" ? (
            <>
            <FieldGroup
              label="Title"
              helper="The card's name. Defaults the slug if you leave that blank."
              error={errors.title?.message}
            >
              <input
                {...register("title", { required: "A title is required." })}
                placeholder="Emberbound Wyrm"
                className={inputClass(Boolean(errors.title))}
                autoComplete="off"
              />
            </FieldGroup>

            <div className="grid gap-4 sm:grid-cols-2">
              {hidesCost(watched.frame_style?.template) ? null : (
                <FieldGroup
                  label="Cost"
                  helper="Click pips to build the mana cost."
                  error={errors.cost?.message}
                >
                  <Controller
                    control={control}
                    name="cost"
                    render={({ field }) => (
                      <ManaCostPicker
                        value={field.value ?? ""}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </FieldGroup>
              )}

              <FieldGroup label="Card type" error={errors.card_type?.message}>
                <Controller
                  control={control}
                  name="card_type"
                  render={({ field }) => (
                    <ChipGroup
                      ariaLabel="Card type"
                      layout="grid-3"
                      value={field.value}
                      onChange={(next) => field.onChange(next)}
                      options={CARD_TYPE_OPTIONS}
                    />
                  )}
                />
              </FieldGroup>
            </div>

            {/* Rarity. (The old "Template" select was removed: template_id is
                a vestigial DB field — no renderer reads it; the visual layout is
                driven entirely by the Frame picker, and stat visibility by card
                type. template_id is still defaulted + persisted in form state for
                schema compatibility, just no longer user-editable.) */}
            <FieldGroup label="Rarity">
              <Controller
                control={control}
                name="rarity"
                render={({ field }) => (
                  <ChipGroup
                    ariaLabel="Rarity"
                    layout="grid-4"
                    value={field.value}
                    onChange={(next) => field.onChange(next)}
                    options={RARITY_OPTIONS}
                  />
                )}
              />
            </FieldGroup>

            {/* Quick path stops here: title + cost + type + rarity make a real
                card (color identity follows the cost automatically). Everything
                below is detail control. */}
            <MoreOptions summary="More options — supertype, subtypes, colors, tags">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldGroup
                  label="Supertype"
                  helper="Optional — e.g. Legendary, Basic."
                >
                  <input
                    {...register("supertype")}
                    placeholder="Legendary"
                    className={inputClass(Boolean(errors.supertype))}
                    autoComplete="off"
                  />
                </FieldGroup>
                <FieldGroup
                  label="Subtypes"
                  helper="Comma-separated. Up to 10."
                >
                  <input
                    {...register("subtypes_text")}
                    placeholder="Dragon, Elder"
                    className={inputClass(Boolean(errors.subtypes_text))}
                    autoComplete="off"
                  />
                </FieldGroup>
              </div>

              <FieldGroup
                label="Color identity"
                helper={
                  autoColors
                    ? "Following the mana cost — edit the chips to take over."
                    : "Drives the frame color. One or more."
                }
              >
                <div className="flex flex-col gap-2">
                  <Controller
                    control={control}
                    name="color_identity"
                    render={({ field }) => (
                      <ChipGroup
                        multiSelect
                        ariaLabel="Color identity"
                        layout="wrap"
                        value={field.value}
                        onChange={(next) => {
                          setAutoColors(false);
                          field.onChange(next);
                        }}
                        options={COLOR_IDENTITY_OPTIONS}
                      />
                    )}
                  />
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={autoColors}
                      onChange={(event) => setAutoColors(event.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                    />
                    Match mana cost automatically
                  </label>
                </div>
              </FieldGroup>

              <FieldGroup
                label="Tags"
                helper="Comma-separated keywords for discovery (e.g. dragons, tokens). Up to 12."
              >
                <input
                  {...register("tags_text")}
                  placeholder="dragons, tokens, tribal"
                  className={inputClass(Boolean(errors.tags_text))}
                  autoComplete="off"
                />
              </FieldGroup>
            </MoreOptions>
            </>
          ) : null}

          {/* ----- Rules step ----- */}
          {stepKey === "rules" ? (
            <>
            <FieldGroup
              label="Rules text"
              error={errors.rules_text?.message}
              helper="Symbols render as real pips on the card — click one above or type the {T} / {2} / {W/U} code. Up to 4000 characters."
            >
              <div className="flex flex-col gap-2">
                <RulesSymbolToolbar
                  onInsert={(token) =>
                    insertSymbol("rules_text", rulesTextRef, token)
                  }
                />
                <textarea
                  {...rulesTextField}
                  ref={(el) => {
                    rulesTextField.ref(el);
                    rulesTextRef.current = el;
                  }}
                  placeholder="{T}: Add {G}. Whenever this creature attacks, draw a card."
                  rows={6}
                  className={textareaClass(Boolean(errors.rules_text))}
                />
              </div>
            </FieldGroup>

            <FieldGroup
              label="Flavor text"
              error={errors.flavor_text?.message}
              helper="Optional — up to 1000 characters."
            >
              <textarea
                {...register("flavor_text")}
                placeholder="A coil of fire, bound by oath."
                rows={3}
                className={textareaClass(Boolean(errors.flavor_text))}
              />
            </FieldGroup>

            {/* Only the stat the card type can actually display (P/T for
                creatures/tokens, loyalty for planeswalkers, defense for
                battles); spells/etc. show none. */}
            {statVis.pt || statVis.loyalty || statVis.defense ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {statVis.pt ? (
                  <>
                    <FieldGroup label="Power">
                      <input
                        {...register("power")}
                        placeholder="4"
                        className={inputClass(Boolean(errors.power))}
                        autoComplete="off"
                      />
                    </FieldGroup>
                    <FieldGroup label="Toughness">
                      <input
                        {...register("toughness")}
                        placeholder="4"
                        className={inputClass(Boolean(errors.toughness))}
                        autoComplete="off"
                      />
                    </FieldGroup>
                  </>
                ) : null}
                {statVis.loyalty ? (
                  <FieldGroup label="Loyalty">
                    <input
                      {...register("loyalty")}
                      placeholder="3"
                      className={inputClass(Boolean(errors.loyalty))}
                      autoComplete="off"
                    />
                  </FieldGroup>
                ) : null}
                {statVis.defense ? (
                  <FieldGroup label="Defense">
                    <input
                      {...register("defense")}
                      placeholder="4"
                      className={inputClass(Boolean(errors.defense))}
                      autoComplete="off"
                    />
                  </FieldGroup>
                ) : null}
              </div>
            ) : null}

            {/* AI assistant — drafts/refines abilities + flavor from a prompt.
                The hero / command palette jump here via the openAiConcept event. */}
            <div id="ai-assistant-anchor" className="scroll-mt-20">
              <AIAssistantPanel
                cardContext={cardContext}
                onApply={handleAIPatch}
                configured={aiConfigured}
              />
            </div>
            </>
          ) : null}

          {/* ----- Art step ----- */}
          {stepKey === "art" ? (
            <>
            <Controller
              control={control}
              name="art_url"
              render={({ field: artUrlField }) => (
                <Controller
                  control={control}
                  name="art_position"
                  render={({ field: artPosField }) => (
                    <ArtUploader
                      userId={userId}
                      artUrl={artUrlField.value}
                      artPosition={artPosField.value}
                      onArtChange={({ artUrl, artPosition }) => {
                        artUrlField.onChange(artUrl ?? "");
                        artPosField.onChange(artPosition);
                        setValue("art_url", artUrl ?? "", { shouldDirty: true });
                        setValue("art_position", artPosition, {
                          shouldDirty: true,
                        });
                      }}
                    />
                  )}
                />
              )}
            />

            <MoreOptions summary="More options — artist credit">
              <FieldGroup
                label="Artist credit"
                helper="Who made the artwork? Yourself, a public-domain artist, or a licensed source."
              >
                <input
                  {...register("artist_credit")}
                  placeholder="Anya Vale"
                  className={inputClass(Boolean(errors.artist_credit))}
                  autoComplete="off"
                />
              </FieldGroup>
            </MoreOptions>
            </>
          ) : null}

          {/* ----- Adventure / Back face step ----- */}
          {stepKey === "extra" ? (
            <>
            {!watched.has_back_face ? (
              <SurfaceCard className="flex flex-col items-center gap-3 border-dashed bg-elevated/40 p-8 text-center">
                <p className="text-sm leading-6 text-muted">
                  {isAdventureFrame ? (
                    <>
                      The Adventure frame splits the lower card into a storybook:
                      this content becomes the <strong>adventure spell</strong> on
                      the left page, shown alongside the creature&apos;s rules — no
                      flip. Add it to fill the adventure.
                    </>
                  ) : (
                    <>
                      This card only has a front face. Add a back face to make it
                      a double-faced card (DFC). The back face shares the
                      card&apos;s rarity, color identity, and frame style — only
                      the text and art differ.
                    </>
                  )}
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    setValue("has_back_face", true, { shouldDirty: true })
                  }
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {isAdventureFrame ? "Add the adventure" : "Add a back face"}
                </Button>
              </SurfaceCard>
            ) : (
              <>
                <FieldGroup
                  label={isAdventureFrame ? "Adventure name" : "Title"}
                  helper={
                    isAdventureFrame
                      ? "The adventure spell's name (shown on the left page)."
                      : "The back-face title. Required when a back face is enabled."
                  }
                >
                  <input
                    {...register("back_face.title", {
                      required: watched.has_back_face
                        ? `A ${isAdventureFrame ? "adventure" : "back-face"} name is required.`
                        : false,
                    })}
                    placeholder={isAdventureFrame ? "Stomp" : "Insectile Aberration"}
                    className={inputClass(Boolean(errors.back_face?.title))}
                    autoComplete="off"
                  />
                </FieldGroup>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="Cost">
                    <Controller
                      control={control}
                      name="back_face.cost"
                      render={({ field }) => (
                        <ManaCostPicker
                          value={field.value ?? ""}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </FieldGroup>

                  <FieldGroup label="Card type">
                    <Controller
                      control={control}
                      name="back_face.card_type"
                      render={({ field }) => (
                        <ChipGroup
                          ariaLabel="Back-face card type"
                          layout="grid-3"
                          value={field.value}
                          onChange={(next) => field.onChange(next)}
                          options={CARD_TYPE_OPTIONS}
                        />
                      )}
                    />
                  </FieldGroup>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="Supertype">
                    <input
                      {...register("back_face.supertype")}
                      placeholder="Legendary"
                      className={inputClass(false)}
                      autoComplete="off"
                    />
                  </FieldGroup>
                  <FieldGroup label="Subtypes" helper="Comma-separated.">
                    <input
                      {...register("back_face.subtypes_text")}
                      placeholder="Human, Wizard"
                      className={inputClass(false)}
                      autoComplete="off"
                    />
                  </FieldGroup>
                </div>

                <FieldGroup label="Rules text">
                  <div className="flex flex-col gap-2">
                    <RulesSymbolToolbar
                      onInsert={(token) =>
                        insertSymbol(
                          "back_face.rules_text",
                          backRulesTextRef,
                          token,
                        )
                      }
                    />
                    <textarea
                      {...backRulesTextField}
                      ref={(el) => {
                        backRulesTextField.ref(el);
                        backRulesTextRef.current = el;
                      }}
                      placeholder={
                        isAdventureFrame
                          ? "Stomp deals 2 damage to any target. (The adventure's rules.)"
                          : "Flying. Whenever the back face deals damage…"
                      }
                      rows={4}
                      className={textareaClass(false)}
                    />
                  </div>
                </FieldGroup>

                {/* Flavor, P/T, and art are front/DFC-only — an adventure spell
                    is an instant/sorcery that shares the creature's art, so the
                    Adventure tab hides them (the renderer ignores them anyway). */}
                {!isAdventureFrame ? (
                  <>
                <FieldGroup label="Flavor text">
                  <textarea
                    {...register("back_face.flavor_text")}
                    placeholder="Optional."
                    rows={2}
                    className={textareaClass(false)}
                  />
                </FieldGroup>

                <div className="grid gap-4 sm:grid-cols-4">
                  <FieldGroup label="Power">
                    <input
                      {...register("back_face.power")}
                      placeholder="3"
                      className={inputClass(false)}
                      autoComplete="off"
                    />
                  </FieldGroup>
                  <FieldGroup label="Toughness">
                    <input
                      {...register("back_face.toughness")}
                      placeholder="2"
                      className={inputClass(false)}
                      autoComplete="off"
                    />
                  </FieldGroup>
                  <FieldGroup label="Loyalty">
                    <input
                      {...register("back_face.loyalty")}
                      placeholder="—"
                      className={inputClass(false)}
                      autoComplete="off"
                    />
                  </FieldGroup>
                  <FieldGroup label="Defense">
                    <input
                      {...register("back_face.defense")}
                      placeholder="—"
                      className={inputClass(false)}
                      autoComplete="off"
                    />
                  </FieldGroup>
                </div>

                <FieldGroup label="Artist credit">
                  <input
                    {...register("back_face.artist_credit")}
                    placeholder="Anya Vale"
                    className={inputClass(false)}
                    autoComplete="off"
                  />
                </FieldGroup>

                <Controller
                  control={control}
                  name="back_face.art_url"
                  render={({ field: artUrlField }) => (
                    <Controller
                      control={control}
                      name="back_face.art_position"
                      render={({ field: artPosField }) => (
                        <ArtUploader
                          userId={userId}
                          artUrl={artUrlField.value}
                          artPosition={artPosField.value}
                          onArtChange={({ artUrl, artPosition }) => {
                            artUrlField.onChange(artUrl ?? "");
                            artPosField.onChange(artPosition);
                            setValue("back_face.art_url", artUrl ?? "", {
                              shouldDirty: true,
                            });
                            setValue("back_face.art_position", artPosition, {
                              shouldDirty: true,
                            });
                          }}
                        />
                      )}
                    />
                  )}
                />
                  </>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setValue("has_back_face", false, { shouldDirty: true });
                      // Clear nested values so a re-enable starts fresh.
                      setValue("back_face", EMPTY_BACK_FACE, {
                        shouldDirty: true,
                      });
                    }}
                  >
                    {isAdventureFrame ? "Remove adventure" : "Remove back face"}
                  </Button>
                </div>
              </>
            )}
          </>
          ) : null}

          {/* ----- Publish step ----- */}
          {stepKey === "publish" ? (
            <>
            <FieldGroup label="Visibility">
              <Controller
                control={control}
                name="visibility"
                render={({ field }) => (
                  <ChipGroup
                    ariaLabel="Visibility"
                    layout="grid-3"
                    size="md"
                    value={field.value}
                    onChange={(next) => field.onChange(next)}
                    options={VISIBILITY_OPTIONS}
                  />
                )}
              />
            </FieldGroup>

            <FieldGroup
              label="Add to set"
              helper="Group this card into one of your sets. If that set has an icon, the card uses it as its set symbol."
            >
              <Controller
                control={control}
                name="primary_set_id"
                render={({ field }) => (
                  <div className="flex flex-col gap-2">
                    <select
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                      disabled={mySets.length === 0}
                      className={inputClass(false)}
                    >
                      <option value="">No set</option>
                      {mySets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-muted">
                      {mySets.length === 0 ? (
                        <>
                          You don&apos;t have any sets yet.{" "}
                          <Link
                            href="/dashboard/sets/new"
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            Create one
                          </Link>
                          .
                        </>
                      ) : (
                        <Link
                          href="/dashboard/sets/new"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Create a new set
                        </Link>
                      )}
                    </span>
                  </div>
                )}
              />
            </FieldGroup>

            <FieldGroup
              label="Finish"
              helper="Premium treatment layered on top of the frame."
            >
              <Controller
                control={control}
                name="frame_style.finish"
                render={({ field }) => (
                  <ChipGroup
                    ariaLabel="Finish"
                    layout="grid-2"
                    size="md"
                    value={field.value ?? "regular"}
                    onChange={(next) => field.onChange(next)}
                    options={FINISH_OPTIONS}
                  />
                )}
              />
            </FieldGroup>

            {/* Slug auto-derives from the title; tuck it under Advanced for
                anyone who wants a custom URL. */}
            <details className="rounded-lg border border-border/60 bg-elevated/30">
              <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle [&::-webkit-details-marker]:hidden">
                Advanced
              </summary>
              <div className="px-4 pb-4">
                <FieldGroup
                  label="Slug"
                  helper={`URL: ${
                    ownerUsername
                      ? `/card/${ownerUsername}/${watched.slug || slugify(watched.title || "untitled-card")}`
                      : `/card/${watched.slug || slugify(watched.title || "untitled-card")}`
                  }`}
                  error={errors.slug?.message}
                >
                  <input
                    {...register("slug")}
                    placeholder="emberbound-wyrm"
                    className={inputClass(Boolean(errors.slug))}
                    autoComplete="off"
                  />
                </FieldGroup>
              </div>
            </details>
            </>
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
                <Sparkles className="h-3 w-3" aria-hidden /> Unsaved changes
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
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// Per-step "More options" collapsible — the Detailed-create surface. Quick
// creators never need to open it; everything inside persists like any other
// field. Mirrors the Publish step's Advanced <details> styling.
function MoreOptions({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-lg border border-border/60 bg-elevated/30">
      <summary className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider text-subtle transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-2">{children}</div>
    </details>
  );
}

function FieldGroup({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : helper ? (
        <span className="text-xs text-muted">{helper}</span>
      ) : null}
    </label>
  );
}

// A numbered sub-step heading for the two-stage frame picker: a small index
// badge, a title, an optional muted context line (the active set name), and a
// right-aligned count. Makes "first a set, then a frame within it" legible.
function PickerStepLabel({
  n,
  title,
  aside,
  count,
}: {
  n: number;
  title: string;
  aside?: string;
  count?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-elevated/60 text-[10px] text-foreground"
        >
          {n}
        </span>
        <span className="shrink-0">{title}</span>
        {aside ? (
          <span className="truncate font-normal normal-case tracking-normal text-muted">
            · {aside}
          </span>
        ) : null}
      </span>
      {count ? (
        <span className="shrink-0 text-[11px] text-muted">{count}</span>
      ) : null}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return cn(
    "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground placeholder:text-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function textareaClass(hasError: boolean): string {
  return cn(
    "w-full rounded-md border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function SmallGem({ color }: { color: string }) {
  // Tiny diamond gem, matches the larger RarityGem in the card preview but
  // sized for the chip's leading slot.
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <polygon
        points="6,1 11,6 6,11 1,6"
        fill={color}
        stroke="rgba(0,0,0,0.4)"
        strokeWidth="0.6"
      />
    </svg>
  );
}

function ColorSwatch({ color }: { color: ColorIdentity }) {
  // Small filled circle that mirrors the mana-glyph palette. Used as the
  // `leading` element on color-identity chips so the picker reads as a
  // continuation of the cost glyphs instead of generic text pills.
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.3),0_1px_1px_rgba(0,0,0,0.3)]"
      style={{ background: COLOR_SWATCH[color] }}
    />
  );
}

function FrameThumb({ template }: { template: FrameTemplate }) {
  // A mini preview of the frame (the blue color variant is representative) so
  // each template chip is recognizable by sight — important now that the list
  // spans 11 frames with similar names. Battle is landscape (7:5); the rest 5:7.
  const landscape = getFrameProfile(template).orientation === "landscape";
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 overflow-hidden rounded-[3px] border border-border/60 bg-[#101015] bg-cover bg-center",
        landscape ? "h-7 w-10" : "h-10 w-[29px]",
      )}
      style={{ backgroundImage: `url(/frames/${template}/u.png)` }}
    />
  );
}
