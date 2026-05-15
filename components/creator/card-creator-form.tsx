"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  ChipGroup,
  type ChipOption,
} from "@/components/ui/chip-group";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { CardPreview } from "@/components/cards/card-preview";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
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
  type FrameStyle,
  type GameSystem,
  type Rarity,
  type Visibility,
} from "@/types/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Form values — mirror createCardSchema but typed at the component boundary.
// We intentionally keep "string" for inputs that the form serializes from
// text fields and convert to the schema's optional/empty-as-undefined shape
// at submission time.
// ---------------------------------------------------------------------------

// Back-face form values mirror the front-face fields the back face stores.
// Slug / visibility / template / color_identity / rarity / frame_style
// are card-level (shared across faces) and NOT duplicated here.
type BackFaceFormValues = {
  title: string;
  cost: string;
  card_type: CardType | "";
  supertype: string;
  subtypes_text: string;
  rules_text: string;
  flavor_text: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  artist_credit: string;
  art_url: string;
  art_position: ArtPosition;
};

type FormValues = {
  title: string;
  slug: string;
  game_system_id: string;
  template_id: string;
  cost: string;
  color_identity: ColorIdentity[];
  supertype: string;
  card_type: CardType | "";
  subtypes_text: string;
  rarity: Rarity | "";
  rules_text: string;
  flavor_text: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  artist_credit: string;
  art_url: string;
  art_position: ArtPosition;
  frame_style: FrameStyle;
  visibility: Visibility;
  // Phase 11 chunk 10: optional back-face for DFCs.
  has_back_face: boolean;
  back_face: BackFaceFormValues;
  // Phase 11 chunk 13: Scryfall provenance. Hidden in the form; set when
  // the user imports from Scryfall and persisted on save.
  source_scryfall_id: string;
};

type CardCreatorFormProps = {
  mode: "create" | "edit";
  userId: string | null;
  gameSystems: GameSystem[];
  templates: CardTemplate[];
  card?: Card | null;
  /** Whether ANTHROPIC_API_KEY is set on the server — gates the AI panel. */
  aiConfigured: boolean;
};

type TabKey = "identity" | "rules" | "art" | "back-face" | "publishing";

// Each field belongs to exactly one tab. We use this to badge tabs with an
// error dot and auto-switch the user to the first tab containing an error
// when a server-side validation fails. Back-face fields all map to the
// back-face tab; the toggle + nested object live at the form root.
const FIELD_TO_TAB: Record<keyof FormValues, TabKey> = {
  title: "identity",
  slug: "identity",
  game_system_id: "identity",
  template_id: "identity",
  cost: "identity",
  color_identity: "identity",
  supertype: "identity",
  card_type: "identity",
  subtypes_text: "identity",
  rarity: "identity",
  rules_text: "rules",
  flavor_text: "rules",
  power: "rules",
  toughness: "rules",
  loyalty: "rules",
  defense: "rules",
  artist_credit: "art",
  art_url: "art",
  art_position: "art",
  frame_style: "publishing",
  visibility: "publishing",
  has_back_face: "back-face",
  back_face: "back-face",
  // Hidden field — no tab. Map to "publishing" so any errors surface
  // there (they shouldn't happen since the user doesn't edit it directly).
  source_scryfall_id: "publishing",
};

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
    description: "Only you can see it. Drafts default here.",
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
    description: "Listed in the public gallery and your profile.",
    icon: Globe2,
  },
];

const BORDER_OPTIONS: ChipOption<NonNullable<FrameStyle["border"]>>[] = [
  { value: "thin", label: "Thin" },
  { value: "thick", label: "Thick" },
  { value: "ornate", label: "Ornate" },
];

const ACCENT_OPTIONS: ChipOption<NonNullable<FrameStyle["accent"]>>[] = [
  { value: "neutral", label: "Neutral" },
  { value: "warm", label: "Warm", activeClass: "border-accent bg-accent/15 text-accent" },
  { value: "cool", label: "Cool", activeClass: "border-primary bg-primary/15 text-primary" },
];

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
    value: "borderless",
    label: "Borderless",
    description: "Art bleeds behind the section panels.",
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

// Empty back-face values — used when the user toggles on "has back face"
// from a freshly-created card, or when there's no persisted back face.
const EMPTY_BACK_FACE: BackFaceFormValues = {
  title: "",
  cost: "",
  card_type: "creature",
  supertype: "",
  subtypes_text: "",
  rules_text: "",
  flavor_text: "",
  power: "",
  toughness: "",
  loyalty: "",
  defense: "",
  artist_credit: "",
  art_url: "",
  art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
};

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
      frame_style: { border: "thin", accent: "neutral", finish: "regular" },
      visibility: "private",
      has_back_face: false,
      back_face: EMPTY_BACK_FACE,
      source_scryfall_id: "",
    };
  }

  const persistedBackFace =
    (card.back_face as CardBackFace | null | undefined) ?? null;

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
    frame_style: (card.frame_style as FrameStyle) ?? {
      border: "thin",
      accent: "neutral",
    },
    visibility: card.visibility,
    has_back_face: persistedBackFace !== null,
    back_face: backFaceFormValuesFrom(persistedBackFace),
    source_scryfall_id: card.source_scryfall_id ?? "",
  };
}

function parseSubtypes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardCreatorForm({
  mode,
  userId,
  gameSystems,
  templates,
  card,
  aiConfigured,
}: CardCreatorFormProps) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("identity");
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

  // Listen for hero/palette custom events. Each event is fire-and-forget
  // — no payload, just a signal to perform a UI action.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openScryfall = () => setScryfallOpen(true);
    const openAiConcept = () => {
      setActiveTab("publishing");
      // Defer the scroll one tick so the Publishing tab has time to mount
      // its content before we try to scroll the AI anchor into view.
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
    setActiveTab("identity");
  };

  // Per-tab dirty-error map. We compute a Set of tabs that contain an error
  // so we can dot-badge the trigger and switch to the first failing tab
  // after submit.
  const tabsWithErrors = useMemo(() => {
    const tabs = new Set<TabKey>();
    for (const fieldName of Object.keys(errors) as Array<keyof FormValues>) {
      const tab = FIELD_TO_TAB[fieldName];
      if (tab) tabs.add(tab);
    }
    return tabs;
  }, [errors]);

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
    };

    startTransition(async () => {
      const applyFieldErrors = (
        fieldErrors: Record<string, string | undefined> | undefined,
      ) => {
        if (!fieldErrors) return;
        let firstErrorTab: TabKey | null = null;
        for (const [name, message] of Object.entries(fieldErrors)) {
          if (!message) continue;
          setError(name as keyof FormValues, { message });
          if (!firstErrorTab) {
            firstErrorTab = FIELD_TO_TAB[name as keyof FormValues] ?? null;
          }
        }
        if (firstErrorTab) setActiveTab(firstErrorTab);
      };

      if (mode === "create") {
        const result = await createCardAction(payload);
        if (!result.ok) {
          applyFieldErrors(result.fieldErrors);
          if (result.formError) {
            setServerError(result.formError);
            toast.error(result.formError);
          }
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
        applyFieldErrors(result.fieldErrors);
        if (result.formError) {
          setServerError(result.formError);
          toast.error(result.formError);
        }
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

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
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

        <Tabs value={activeTab} onValueChange={(next) => setActiveTab(next as TabKey)}>
          <TabsList>
            <TabsTrigger
              value="identity"
              badge={
                tabsWithErrors.has("identity") ? <ErrorDot /> : null
              }
            >
              Identity
            </TabsTrigger>
            <TabsTrigger
              value="rules"
              badge={tabsWithErrors.has("rules") ? <ErrorDot /> : null}
            >
              Rules
            </TabsTrigger>
            <TabsTrigger
              value="art"
              badge={tabsWithErrors.has("art") ? <ErrorDot /> : null}
            >
              Art
            </TabsTrigger>
            <TabsTrigger
              value="back-face"
              badge={
                tabsWithErrors.has("back-face") ? (
                  <ErrorDot />
                ) : watched.has_back_face ? (
                  <span
                    aria-hidden
                    className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary"
                  />
                ) : null
              }
            >
              Back face
            </TabsTrigger>
            <TabsTrigger
              value="publishing"
              badge={
                tabsWithErrors.has("publishing") ? <ErrorDot /> : null
              }
            >
              Publishing
            </TabsTrigger>
          </TabsList>

          {/* ----- Identity tab ----- */}
          <TabsContent value="identity" className="mt-6 flex flex-col gap-6">
            {/* Start-from-real-card chip row. Sits above Title because
                it's a "blank-page" jumpstart — once the user has typed
                anything, this is still here but less prominent. The
                button just flips `scryfallOpen` because the dialog is
                rendered once at the bottom of the form (controlled mode). */}
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

            <FieldGroup
              label="Title"
              helper="The card's name. Defaults the slug if you leave that blank."
              error={errors.title?.message}
            >
              <input
                {...register("title")}
                placeholder="Emberbound Wyrm"
                className={inputClass(Boolean(errors.title))}
                autoComplete="off"
              />
            </FieldGroup>

            <FieldGroup
              label="Slug"
              helper={`URL: /card/${watched.slug || slugify(watched.title || "untitled-card")}`}
              error={errors.slug?.message}
            >
              <input
                {...register("slug")}
                placeholder="emberbound-wyrm"
                className={inputClass(Boolean(errors.slug))}
                autoComplete="off"
              />
            </FieldGroup>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldGroup
                label="Cost"
                helper="Generic fantasy cost — e.g. {2}{R}."
                error={errors.cost?.message}
              >
                <div className="flex flex-col gap-2">
                  <input
                    {...register("cost")}
                    placeholder="{2}{R}{R}"
                    className={inputClass(Boolean(errors.cost))}
                    autoComplete="off"
                  />
                  {watched.cost.trim() ? (
                    <div className="flex h-7 items-center rounded-md border border-border/40 bg-elevated/40 px-2">
                      <ManaCostGlyphs cost={watched.cost} size="sm" />
                    </div>
                  ) : null}
                </div>
              </FieldGroup>

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

            <div className="grid gap-4 sm:grid-cols-2">
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

              <FieldGroup
                label="Template"
                helper="Visual layout used when rendering."
              >
                <Controller
                  control={control}
                  name="template_id"
                  render={({ field }) => (
                    <select
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                      className={selectClass(false)}
                    >
                      {templates.length === 0 ? (
                        <option value="">No templates available</option>
                      ) : null}
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  )}
                />
              </FieldGroup>
            </div>

            <FieldGroup label="Color identity" helper="One or more.">
              <Controller
                control={control}
                name="color_identity"
                render={({ field }) => (
                  <ChipGroup
                    multiSelect
                    ariaLabel="Color identity"
                    layout="wrap"
                    value={field.value}
                    onChange={(next) => field.onChange(next)}
                    options={COLOR_IDENTITY_OPTIONS}
                  />
                )}
              />
            </FieldGroup>
          </TabsContent>

          {/* ----- Rules tab ----- */}
          <TabsContent value="rules" className="mt-6 flex flex-col gap-6">
            <FieldGroup
              label="Rules text"
              error={errors.rules_text?.message}
              helper="Up to 4000 characters."
            >
              <textarea
                {...register("rules_text")}
                placeholder="Flying. Whenever Emberbound Wyrm enters the battlefield, draw a card."
                rows={6}
                className={textareaClass(Boolean(errors.rules_text))}
              />
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

            <div className="grid gap-4 sm:grid-cols-4">
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
              <FieldGroup label="Loyalty">
                <input
                  {...register("loyalty")}
                  placeholder="—"
                  className={inputClass(Boolean(errors.loyalty))}
                  autoComplete="off"
                />
              </FieldGroup>
              <FieldGroup label="Defense">
                <input
                  {...register("defense")}
                  placeholder="—"
                  className={inputClass(Boolean(errors.defense))}
                  autoComplete="off"
                />
              </FieldGroup>
            </div>
          </TabsContent>

          {/* ----- Art tab ----- */}
          <TabsContent value="art" className="mt-6 flex flex-col gap-6">
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
          </TabsContent>

          {/* ----- Back face tab ----- */}
          <TabsContent value="back-face" className="mt-6 flex flex-col gap-6">
            {!watched.has_back_face ? (
              <SurfaceCard className="flex flex-col items-center gap-3 border-dashed bg-elevated/40 p-8 text-center">
                <p className="text-sm leading-6 text-muted">
                  This card only has a front face. Add a back face to make it
                  a double-faced card (DFC). The back face shares the card&apos;s
                  rarity, color identity, and frame style — only the text and
                  art differ.
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
                  Add a back face
                </Button>
              </SurfaceCard>
            ) : (
              <>
                <FieldGroup
                  label="Title"
                  helper="The back-face title. Required when a back face is enabled."
                >
                  <input
                    {...register("back_face.title")}
                    placeholder="Insectile Aberration"
                    className={inputClass(false)}
                    autoComplete="off"
                  />
                </FieldGroup>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="Cost">
                    <div className="flex flex-col gap-2">
                      <input
                        {...register("back_face.cost")}
                        placeholder="—"
                        className={inputClass(false)}
                        autoComplete="off"
                      />
                      {watched.back_face.cost?.trim() ? (
                        <div className="flex h-7 items-center rounded-md border border-border/40 bg-elevated/40 px-2">
                          <ManaCostGlyphs
                            cost={watched.back_face.cost}
                            size="sm"
                          />
                        </div>
                      ) : null}
                    </div>
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
                  <textarea
                    {...register("back_face.rules_text")}
                    placeholder="Flying. Whenever the back face deals damage…"
                    rows={4}
                    className={textareaClass(false)}
                  />
                </FieldGroup>

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
                    Remove back face
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* ----- Publishing tab ----- */}
          <TabsContent value="publishing" className="mt-6 flex flex-col gap-6">
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

            <FieldGroup label="Frame style" helper="Polish on the preview.">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-subtle">
                    Border
                  </span>
                  <Controller
                    control={control}
                    name="frame_style.border"
                    render={({ field }) => (
                      <ChipGroup
                        ariaLabel="Border style"
                        layout="grid-3"
                        value={field.value ?? "thin"}
                        onChange={(next) => field.onChange(next)}
                        options={BORDER_OPTIONS}
                      />
                    )}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-subtle">
                    Accent
                  </span>
                  <Controller
                    control={control}
                    name="frame_style.accent"
                    render={({ field }) => (
                      <ChipGroup
                        ariaLabel="Accent"
                        layout="grid-3"
                        value={field.value ?? "neutral"}
                        onChange={(next) => field.onChange(next)}
                        options={ACCENT_OPTIONS}
                      />
                    )}
                  />
                </div>
              </div>
            </FieldGroup>

            {/* Anchor target for the start-with hero's "Generate from
                concept" option — scrollIntoView lands here after the tab
                swaps to Publishing. */}
            <div id="ai-assistant-anchor" className="scroll-mt-20">
              <AIAssistantPanel
                cardContext={cardContext}
                onApply={handleAIPatch}
                configured={aiConfigured}
              />
            </div>
          </TabsContent>
        </Tabs>

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
            {mode === "edit" && card ? (
              <DeleteCardDialog
                cardId={card.id}
                cardTitle={card.title}
                redirectTo="/dashboard"
              />
            ) : (
              <Button asChild variant="ghost">
                <Link href="/dashboard">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Cancel
                </Link>
              </Button>
            )}
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
          </div>
        </div>
      </SurfaceCard>

      {/* ----- Right: live preview ----- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Live preview
          </p>
          <div className="mx-auto w-full max-w-sm">
            <CardPreview
              staticInEditor
              title={watched.title}
              cost={watched.cost}
              cardType={cardTypeForPreview}
              supertype={watched.supertype || null}
              subtypes={parseSubtypes(watched.subtypes_text)}
              rarity={rarityForPreview}
              colorIdentity={watched.color_identity}
              rulesText={watched.rules_text}
              flavorText={watched.flavor_text}
              power={watched.power}
              toughness={watched.toughness}
              loyalty={watched.loyalty}
              defense={watched.defense}
              artistCredit={watched.artist_credit}
              artUrl={watched.art_url || null}
              artPosition={watched.art_position}
              frameStyle={watched.frame_style}
              // DFC: pass the back face so the preview gains its flip
              // button. While the user is on the Back face tab the
              // controlled `face` prop forces the back so the live edits
              // are immediately visible.
              backFace={
                watched.has_back_face
                  ? {
                      title: watched.back_face.title,
                      cost: watched.back_face.cost || undefined,
                      card_type:
                        watched.back_face.card_type === ""
                          ? undefined
                          : (watched.back_face.card_type as CardType),
                      supertype: watched.back_face.supertype || undefined,
                      subtypes: parseSubtypes(
                        watched.back_face.subtypes_text,
                      ),
                      rules_text: watched.back_face.rules_text || undefined,
                      flavor_text: watched.back_face.flavor_text || undefined,
                      power: watched.back_face.power || undefined,
                      toughness: watched.back_face.toughness || undefined,
                      loyalty: watched.back_face.loyalty || undefined,
                      defense: watched.back_face.defense || undefined,
                      artist_credit:
                        watched.back_face.artist_credit || undefined,
                      art_url: watched.back_face.art_url || undefined,
                      art_position: watched.back_face.art_position,
                    }
                  : null
              }
              face={activeTab === "back-face" ? "back" : "front"}
            />
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

function selectClass(hasError: boolean): string {
  return cn(
    "h-10 w-full rounded-md border bg-background/60 px-3 text-sm text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    hasError ? "border-danger/60" : "border-border",
  );
}

function ErrorDot() {
  return (
    <span
      aria-hidden
      className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-danger"
    />
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
