"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FormProvider,
  useForm,
  useWatch,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  IdCard,
  Layers,
  Crown,
  Loader2,
  Lock,
  Save,
  ScrollText,
  Send,
  Sparkles,
  Stamp,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { sendGAEvent } from "@next/third-parties/google";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { useCreditConfirm } from "@/components/billing/credit-confirm-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { isBillingEnabled } from "@/lib/billing/flags";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import { StepRail } from "@/components/ui/step-rail";
import { CardPreview } from "@/components/cards/card-preview";
import { ShareTargets } from "@/components/cards/share-targets";
import { DeleteCardDialog } from "@/components/creator/delete-card-dialog";
import { CardGlossary } from "@/components/creator/card-glossary";
import { LockedSummary } from "@/components/creator/locked-summary";
import { SubscriberPanel } from "@/components/creator/panels/subscriber-panel";
import {
  defaultWatermarkFor,
  usesDefaultWatermark,
} from "@/lib/cards/watermark";
import { CanvasHotspots } from "@/components/creator/canvas-hotspots";
import type { CreatorLayout } from "@/lib/creator/lab-shared";
import { StartOverDialog } from "@/components/creator/start-over-dialog";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/components/creator/unsaved-changes-guard";
import {
  AiFillDialog,
  type AiFillOptions,
} from "@/components/creator/ai-fill-dialog";
import {
  FILL_PRESETS,
  type CardFillField,
  type CardFillLocked,
  type CardFillResult,
} from "@/lib/ai/card-fill-shared";
import type { CardFieldPatch } from "@/lib/ai/card-ideas-select";
import { CardIdeasDialog } from "@/components/creator/card-ideas-dialog";
import {
  ScryfallImportDialog,
  toastImportNotice,
  type ImportNotice,
  type ScryfallImportPayload,
} from "@/components/creator/scryfall-import-dialog";
import {
  CARDFORGE_EVENTS,
  FORM_SCROLL_TARGET_ID,
} from "@/components/creator/start-with-hero";
import { IdentityPanel } from "@/components/creator/panels/identity-panel";
import { PipsPanel } from "@/components/creator/panels/pips-panel";
import { RarityPanel } from "@/components/creator/panels/rarity-panel";
import { LoyaltyAbilitiesEditor } from "@/components/creator/panels/loyalty-editor";
import { SagaChaptersEditor } from "@/components/creator/panels/saga-editor";
import { CardSetupPanel } from "@/components/creator/panels/card-setup-panel";
import { KindChangeDialog } from "@/components/creator/kind-change-dialog";
import { ArtPanel } from "@/components/creator/panels/art-panel";
import { TextPanel } from "@/components/creator/panels/text-panel";
import {
  useImageNaturalSize,
  useTreatmentSwitch,
} from "@/components/creator/use-treatment-switch";
import type { PipTextEditorHandle } from "@/components/creator/pip-text-editor";
import { LandIconPanel } from "@/components/creator/panels/land-icon-panel";
import { SetIconPanel } from "@/components/creator/panels/set-icon-panel";
import { AbilitiesPanel } from "@/components/creator/panels/abilities-panel";
import { LayoutPanel } from "@/components/creator/panels/layout-panel";
import {
  PublishPanel,
  type DeckOption,
} from "@/components/creator/panels/publish-panel";
import {
  createCardAction,
  updateCardAction,
} from "@/lib/cards/actions";
import { linkDeckCardAction } from "@/lib/decks/card-actions";
import type { DeckRemixContext } from "@/types/deck";
import {
  printingTreatmentNotice,
  printingTreatmentOffer,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import {
  type Card,
  type CardType,
  type CardWatermark,
  type ColorIdentity,
  type FaceContent,
  type FrameTemplate,
  type GameSystem,
  type Rarity,
  DEFAULT_FRAME_TEMPLATE,
} from "@/types/card";
import {
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
} from "@/lib/cards/card-display";
import {
  colorIdentityForKey,
  colorWord,
  pickFrameColorKey,
} from "@/components/cards/frame-layer";
import {
  basicOnlyFrameFallback,
  describeFrame,
  resolveImportFrame,
  resolvePublishedFrame,
} from "@/lib/creator/frame-resolve";
import {
  loyaltyFromRulesText,
  sagaFromRulesText,
  serializeLoyalty,
  serializeSaga,
} from "@/lib/cards/face-content";
import { basicLandManaKey } from "@/lib/cards/watermark";
import { missingSecondFaceName } from "@/lib/cards/second-face-name";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import {
  basicLandSeedForColorKey,
  isSeedableLandIdentity,
  kindFromCard,
  shouldClearBasicSeedForTitle,
  toBasicLandIdentity,
  toNonbasicLandIdentity,
  planKindChange,
  KIND_DEFS,
  type CardKind,
  type FrameColorKey,
  type KindChangePatch,
  type KindChangePlan,
} from "@/lib/creator/card-kinds";
import {
  blankSecondFaceFor,
  defaultValuesFor,
  isBlankBackFace,
  mergeTag,
  normalizeColorSelection,
  parseSubtypes,
  parseTags,
  remixValuesFrom,
  watermarkFormValuesFromValue,
} from "@/lib/creator/card-fields";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";
import {
  hasMeaningfulChange,
  pickRevisablePayload,
} from "@/lib/creator/revise";
import { cardFormSchema } from "@/lib/creator/form-schema";
import type { PipOverrides } from "@/lib/pips/override";
import type { Challenge } from "@/lib/challenges/shared";
import {
  buildFieldToStep,
  hasInlineBackFace,
  hidesCost,
  panelConfigFor,
  statVisibility,
  stepIndexForField,
  stepLabel,
  visibleSteps,
  LEGACY_STEP_ALIASES,
  STEP_ORDER,
  type StepContext,
  type StepKey,
} from "@/lib/creator/steps";
import { buildCardPath } from "@/lib/cards/utils";
import { CapacityNotice } from "@/components/billing/capacity-notice";
import { GlyphCoverageNotice } from "@/components/creator/glyph-coverage-notice";
import type { CardCapacity } from "@/lib/billing/capacity-copy";

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
  /** "create" = a blank new card; "edit" = revise `card` in place; "remix" =
   *  a NEW card prefilled from `card` (the parent), linked via parent_card_id
   *  on save. Edit and remix share the REVISE rules: the structural fields
   *  (type, frame, variation, colour, type line, finish, set, deck) are locked
   *  and only content changes (lib/creator/revise.ts). */
  mode: "create" | "edit" | "remix";
  userId: string | null;
  /** Current user's username, if any. Lets the slug helper preview the
   *  canonical `/card/[username]/[slug]` URL the card will live at. Null when
   *  the user is signed out (preview mode) or hasn't picked a username yet. */
  ownerUsername?: string | null;
  gameSystems: GameSystem[];
  /** The card being edited (edit) or remixed from (remix). */
  card?: Card | null;
  /** The current user's decks — the Publish "Add to deck" picker and the AI
   *  dialog's "For a deck" picker. `null` (the default) hides both. */
  myDecks?: DeckOption[] | null;
  /** Decks for the AI dialog's "For a deck" picker when the Publish deck
   *  picker must stay hidden (edit mode — deck linkage is create-only).
   *  Defaults to `myDecks`. */
  aiDecks?: DeckOption[] | null;
  /** Pro entitlement for deck-aware AI generation (the AI dialog's "For a
   *  deck" picker renders locked without it). */
  canDesignForDeck?: boolean;
  /** The current user's cards — the Publish "back face" picker. Excludes the
   *  card being edited (filtered by the page). */
  myCards?: Card[];
  /** The front card id + slug when building a NEW card to be its back face
   *  (/create?backFor=…) — on save, the new card links back and we return to
   *  the front card's edit page. */
  backForCardId?: string | null;
  backForSlug?: string | null;
  /** Set when remixing a deck entry (/create?deckCard=…): the form pre-fills
   *  from the entry's Scryfall card on mount, and on save the new card links
   *  back as the entry's proxy before returning to the deck. */
  deckRemix?: DeckRemixContext | null;
  /** Whether ANTHROPIC_API_KEY is set on the server — gates the AI panel. */
  aiConfigured: boolean;
  /** The signed-in user's custom pip icons (server-fetched; {} when none).
   *  Drives the cost picker icons, the live preview, and the pip dialog. */
  pipOverrides?: PipOverrides;
  /** Pre-seeded tag (e.g. a challenge entry tag from /create?tag=…). Merged
   *  into the Tags field — including into a restored draft — so a "Start
   *  designing" CTA always produces an entry that counts. Create mode only. */
  initialTag?: string | null;
  /** The currently running challenge, if any — powers the Publish panel's
   *  "Enter the challenge" toggle (server-fetched). */
  activeChallenge?: Challenge | null;
  /** Saved-card usage against the plan cap — the warning shown BEFORE a
   *  save that would add a card (create / remix; an edit adds nothing). */
  capacity?: CardCapacity | null;
  /** Prefills the Artist credit on a fresh create with the signed-in user's
   *  profile name (display name, falling back to username). Create mode only,
   *  and only when the field would otherwise be blank — never overrides an
   *  edit, a restored draft, or an imported value. */
  defaultArtistCredit?: string;
  /** Verified (template/color) combo keys from frame_reviews — special
   *  layouts publish per color once verified in /admin/frame-compare. */
  verifiedFrameKeys?: string[];
  /** Admin frame-layout overrides (server-fetched) — keeps the editor's
   *  live preview identical to the gallery render and the bake. */
  profileOverrides?: FrameProfileOverridesMap | null;
  /** Plus / Pro / comp / admin — the rule downloads use
   *  (entitlements.removeWatermark). Drives the Subscriber step, the
   *  watermark defaults on creatures/spells, and the preview's brand mark
   *  (owner decision 2026-09-17: subscribers preview their downloads). */
  isPaid?: boolean;
  /** The account's footer mark (profiles.export_watermark_text) — the
   *  prefill for a new card's per-card footer_text. */
  defaultFooterText?: string | null;
  /** "stepper" (shipped) or the lab's "canvas" — the centred live preview
   *  with clickable regions (lib/creator/lab-shared.ts). */
  layout?: CreatorLayout;
};

// Step membership + field→step routing now live in lib/creator/steps.ts (pure
// + unit-tested) so the form and the tests derive the same frame-aware flow.

// Panel JSX lives in components/creator/panels/* (one client component per
// panel); shared presentational helpers in field-group.tsx + frame-pickers.tsx;
// pure field helpers in lib/creator/card-fields.ts. This orchestrator owns the
// form instance, panel navigation, submit, the unsaved-changes guard and
// the preview.
//
// Save model (owner decision 2026-09-16): NOTHING is saved automatically.
// A card is written only when the user clicks Save; "Save as a draft" on
// the Publish step forces it private (and needs only a title). Leaving the
// editor with changes asks first (unsaved-changes-guard.tsx).

// The URL is read once per render via useSyncExternalStore; it never
// changes underneath the form, so there is nothing to subscribe to.
const subscribeToNothing = () => () => {};

// Icons for the xl+ vertical step rail (one per StepKey; the "layout" panel's
// dynamic labels — Adventure / Back face / Flip side — all read as Layers).
const STEP_RAIL_ICONS: Record<string, React.ReactNode> = {
  card: <Layers aria-hidden />,
  identity: <IdCard aria-hidden />,
  text: <ScrollText aria-hidden />,
  seticon: <Stamp aria-hidden />,
  subscriber: <Crown aria-hidden />,
  publish: <Send aria-hidden />,
};

/** Shown when a save request throws instead of answering: the editor stays
 *  mounted with the card exactly as the user left it (TODO 3b.1). Neutral on
 *  purpose — the cause may be the connection, a server error or a stale
 *  action id after a deploy, where only a reload helps. */
const SAVE_REQUEST_FAILED =
  "The save didn't go through. Your card is still here — try Save again; if it keeps failing, copy your text and reload the page.";

/** Structural equality of two form-value snapshots (plain JSON-like data:
 *  strings, numbers, booleans, arrays, objects). */
function sameFormState(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) =>
    sameFormState(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/** "a, b and c" — the Save hint's list of what's missing. */
function listPhrase(parts: readonly string[]): string {
  return parts.length <= 1
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The first message in a (nested) react-hook-form errors object, or in a
 *  server action's flat `fieldErrors` map. */
function firstErrorMessage(errors: unknown): string | null {
  if (typeof errors === "string") return errors || null;
  if (!errors || typeof errors !== "object") return null;
  const message = (errors as { message?: unknown }).message;
  if (typeof message === "string" && message) return message;
  for (const [key, value] of Object.entries(errors)) {
    if (["ref", "message", "type", "types"].includes(key)) continue;
    const nested = firstErrorMessage(value);
    if (nested) return nested;
  }
  return null;
}

/** A basic-only frame (the full-art basic land, TODO 0.26) can't draw a
 *  nonbasic land's rules. When the card stops being a basic land (Land type
 *  → Nonbasic, or a rename that clears the basic seed), move it to the land
 *  frame that frame is a variation of and say so, instead of leaving a
 *  disabled chip selected and a Save the server refuses. */
function leaveBasicOnlyFrame(
  form: Pick<UseFormReturn<FormValues>, "getValues" | "setValue" | "clearErrors">,
  verifiedFrameKeys: readonly string[],
) {
  const current = normalizeFrameTemplate(form.getValues("frame_style.template"));
  const fallback = basicOnlyFrameFallback(
    current,
    pickFrameColorKey(form.getValues("color_identity")) as FrameColorKey,
    new Set(verifiedFrameKeys),
  );
  if (!fallback) return;
  form.setValue("frame_style.template", fallback, { shouldDirty: true });
  form.clearErrors("frame_style");
  toast.info(
    `The ${describeFrame(current)} frame is for basic lands — switched to ${describeFrame(fallback)}.`,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardCreatorForm({
  mode,
  userId,
  ownerUsername = null,
  gameSystems,
  card,
  myDecks = null,
  aiDecks = null,
  canDesignForDeck = false,
  myCards = [],
  backForCardId = null,
  backForSlug = null,
  deckRemix = null,
  aiConfigured,
  pipOverrides = {},
  initialTag = null,
  capacity = null,
  activeChallenge = null,
  defaultArtistCredit = "",
  verifiedFrameKeys = [],
  profileOverrides = null,
  isPaid = false,
  defaultFooterText = null,
  layout = "stepper",
}: CardCreatorFormProps) {
  const router = useRouter();
  const upgrade = useUpgradeModal();
  const confirmSpend = useCreditConfirm();
  const [isSubmitting, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  // Why the unsaved-changes dialog's save didn't happen (shown in the
  // dialog, which stays open — TODO 3b.5).
  const [leaveSaveError, setLeaveSaveError] = useState<string | null>(null);
  // Unsaved-changes guard. Armed from the form's dirty state below (a
  // mirrored ref-free flag, since useForm is created after this hook), and
  // whenever an AI request is spending a credit (owner decision 2026-09-17:
  // leaving mid-generation used to lose the credit silently).
  const [guardArmed, setGuardArmed] = useState(false);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [fillPhase, setFillPhase] = useState<null | "designing" | "painting">(
    null,
  );
  const aiBusy = fillPhase !== null || ideasBusy;
  const guard = useUnsavedChangesGuard({
    enabled: Boolean(userId) && (guardArmed || aiBusy),
  });
  // Active step index into the dynamic `steps` list (see below). Clamped on
  // read so it stays valid when the visible steps shrink (e.g. a DFC is removed).
  // The create→edit redirect carries ?step=<key> so saving doesn't bounce
  // the user back to the first step. Read through useSyncExternalStore so
  // the server snapshot ("" → step 0) and the client's real URL can differ
  // WITHOUT a hydration error (reading window.location in a useState
  // initializer threw one on every ?step= URL). Resolved against this
  // mode's step order (edit/remix have no Card step); visibleSteps clamps
  // the index if the step isn't visible for this card.
  const urlSearch = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.search,
    () => "",
  );
  const urlStepIndex = useMemo(() => {
    const want = new URLSearchParams(urlSearch).get("step");
    if (!want) return 0;
    const resolved = (LEGACY_STEP_ALIASES[want] ?? want) as StepKey;
    const order =
      mode === "create" ? STEP_ORDER : STEP_ORDER.filter((k) => k !== "card");
    const i = order.indexOf(resolved);
    return i >= 0 ? i : 0;
  }, [urlSearch, mode]);
  // null = "still on the URL's landing step"; any navigation overrides it.
  const [currentOverride, setCurrent] = useState<number | null>(null);
  const current = currentOverride ?? urlStepIndex;
  // Stable handle to the latest step-navigation fn, so the once-registered
  // custom-event listeners (start-with hero) always call current logic.
  const goToStepKeyRef = useRef<(key: StepKey) => void>(() => {});
  // Per-field "Generate with AI" dialog. `fillDefaults` is the tick-set the
  // opening entry point asks for (hero = everything, the Identity button =
  // art + title, the Text step = its own fields); `fillPhase` blocks the
  // form while a run is in flight — the user waits for the result.
  const [aiFillOpen, setAiFillOpen] = useState(false);
  const [fillDefaults, setFillDefaults] = useState<CardFillField[]>(
    FILL_PRESETS.all,
  );
  // Which creator a fill belongs to — an unclaimed result is only offered
  // back on the matching page (app/api/ai/card-fill).
  const fillScope =
    mode === "edit" && card
      ? `card:${card.id}`
      : mode === "remix" && card
        ? `remix:${card.id}`
        : "create";
  const claimFill = (jobId: string) => {
    void fetch("/api/ai/card-fill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch(() => {});
  };
  const openFill = (fields: CardFillField[]) => {
    if (!userId) {
      toast.error("Sign in to generate with AI.");
      return;
    }
    setFillDefaults(fields);
    setAiFillOpen(true);
  };
  const openFillRef = useRef(openFill);
  useEffect(() => {
    openFillRef.current = openFill;
  });
  // Tracks the source card when the user seeds the form from Scryfall.
  // Surfaces as a chip near the save bar so the user remembers they need
  // to make the card their own before publishing.
  const [remixSource, setRemixSource] = useState<{
    name: string;
    scryfallUri: string | null;
  } | null>(null);
  // True while the deck-remix deep link is fetching + applying the original
  // card (data + artwork) — drives the preview spinner overlay.
  const [deckRemixImporting, setDeckRemixImporting] = useState(false);
  // Scryfall dialog open state is lifted into the form so the start-with
  // hero on /create and the global command palette can open it via custom
  // DOM events. The dialog itself is rendered once below with `hideTrigger`.
  const [scryfallOpen, setScryfallOpen] = useState(false);
  // Post-publish share prompt. UGC shares convert best at the "look what I
  // made" moment (share research behind PR #192), so a FIRST publish opens
  // the share dialog right here — the redirect to the card's public page
  // waits until it closes. Re-saves of an already-public card skip it.
  const [postSaveShare, setPostSaveShare] = useState<{
    title: string;
    cardId: string;
    cardPath: string;
    /** Whether the deferred navigation replaces history (create mode) or
     *  pushes (edit mode) — mirrors the pre-prompt redirect behavior. */
    replace: boolean;
  } | null>(null);
  const [ideasOpen, setIdeasOpen] = useState(false);
  // Which face the live preview shows. Auto-flips to the back when the user
  // reaches the Back-face step (so they see what they're editing); they can
  // also click the preview itself to flip it any time.
  const [previewFace, setPreviewFace] = useState<"front" | "back">("front");

  // Listen for hero/palette custom events. Each event is fire-and-forget
  // — no payload, just a signal to perform a UI action.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openScryfall = () => setScryfallOpen(true);
    const generateRandom = () => openFillRef.current(FILL_PRESETS.all);
    const openIdeas = () => {
      if (!userId) {
        toast.error("Sign in to use the idea generator.");
        return;
      }
      setIdeasOpen(true);
    };
    const scrollToForm = () => {
      document
        .getElementById(FORM_SCROLL_TARGET_ID)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(CARDFORGE_EVENTS.openScryfall, openScryfall);
    window.addEventListener(CARDFORGE_EVENTS.generateRandom, generateRandom);
    window.addEventListener(CARDFORGE_EVENTS.openIdeas, openIdeas);
    window.addEventListener(CARDFORGE_EVENTS.scrollToForm, scrollToForm);
    return () => {
      window.removeEventListener(CARDFORGE_EVENTS.openScryfall, openScryfall);
      window.removeEventListener(CARDFORGE_EVENTS.generateRandom, generateRandom);
      window.removeEventListener(CARDFORGE_EVENTS.openIdeas, openIdeas);
      window.removeEventListener(CARDFORGE_EVENTS.scrollToForm, scrollToForm);
    };
  }, [userId]);

  const defaults = useMemo(() => {
    const viewer = { paid: isPaid, footerText: defaultFooterText };
    const base =
      mode === "remix" && card
        ? remixValuesFrom(card, gameSystems, viewer)
        : defaultValuesFor(card, gameSystems, viewer);
    // Seed the challenge tag for fresh creates (edits keep the card's tags).
    if (initialTag && !card) {
      base.tags_text = mergeTag(base.tags_text, initialTag);
    }
    // Prefill Artist credit with the user's profile name on a fresh create,
    // only when nothing else already filled it (defaultValuesFor leaves it "").
    if (defaultArtistCredit && !card && !base.artist_credit) {
      base.artist_credit = defaultArtistCredit;
    }
    return base;
  }, [mode, card, gameSystems, initialTag, defaultArtistCredit, isPaid, defaultFooterText]);

  // The full methods object is spread into <FormProvider> below so the step
  // components can reach the same form instance via useFormContext().
  // Client-side mirror of the server's createCardSchema limits
  // (lib/creator/form-schema.ts) — the same jump-to-errored-step handling
  // covers both: handleSubmit's error callback fires for resolver failures,
  // and applyFieldErrors covers anything only the server can know.
  const methods = useForm<FormValues>({
    defaultValues: defaults,
    resolver: zodResolver(cardFormSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const {
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    getValues,
    control,
    reset,
    subscribe,
    formState: { errors, isDirty, dirtyFields },
  } = methods;
  // Arm the guard whenever the form becomes dirty (RHF's subscribe API runs
  // outside React's render/effect cycle, so no setState-in-effect).
  useEffect(
    () =>
      subscribe({
        formState: { isDirty: true },
        callback: ({ isDirty: dirty }) => setGuardArmed(Boolean(dirty)),
      }),
    [subscribe],
  );

  // Signed-out visitors may LOOK at the creator (every step, the live
  // preview) but not use it (owner decision 2026-09-16): the panels are
  // inert under a sign-up gate, and nothing they see is theirs to lose.
  const readOnly = !userId;

  // Revise = edit or remix of an existing card. The Card step is gone and
  // the structural fields are read-only (LockedSummary); the submit path
  // only ever sends the revisable subset (lib/creator/revise.ts).
  const isRevise = mode !== "create";
  const isEdit = mode === "edit";
  const isRemix = mode === "remix";

  // Reset only when the SAVED card actually changes (navigating between
  // cards, or fresh server truth after our own save) — never on mere prop
  // identity churn. router.refresh() re-renders the page with brand-new
  // card/gameSystems objects every time; resetting on those wiped
  // live edits "randomly" while users were typing.
  //
  // Fresh truth for the SAME card while the user has unsaved edits (they
  // typed on while our own save's refresh was landing) rebases the form
  // instead: server values become the baseline, the on-screen values and
  // their dirty state stay (TODO 3b.6 — a blind reset wiped every
  // keystroke typed in that window). Another card always resets.
  const resetKey = card ? `${card.id}:${card.updated_at}` : "new";
  const resetCardId = card?.id ?? null;
  const lastReset = useRef({ key: resetKey, cardId: resetCardId });
  useEffect(() => {
    if (lastReset.current.key === resetKey) return;
    const sameCard = lastReset.current.cardId === resetCardId;
    lastReset.current = { key: resetKey, cardId: resetCardId };
    if (sameCard && isDirty) {
      reset(defaults, { keepValues: true, keepDirty: true });
      return;
    }
    reset(defaults);
  }, [resetKey, resetCardId, defaults, reset, isDirty]);

  // useWatch is the React Compiler-friendly subscription variant of watch().
  // We feed it the same defaults useForm has, so RHF always populates every
  // field; the cast just lifts useWatch's DeepPartial<> back to FormValues.
  const watched = useWatch({ control, defaultValue: defaults }) as FormValues;

  // The Adventure frame repurposes the back-face content as the adventure spell
  // (rendered inline on the card's left page, not as a flippable face), so the
  // "Back face" tab presents itself as "Adventure" when that frame is selected.
  const isAdventureFrame =
    normalizeFrameTemplate(watched.frame_style?.template) === "adventure";

  // ---- Kind-first stepper ----
  // The kind ("what am I making") is DERIVED from card_type + template — never
  // stored — so drafts, edits, and legacy rows land on the right kind for free.
  const kind = kindFromCard(watched.card_type, watched.frame_style?.template);
  // The visible steps + their order depend on the kind/frame context
  // (lib/creator/steps.ts). `current` is clamped so it stays valid when the
  // list shrinks (e.g. switching to a token frame hides the Pips step).
  const stepCtx: StepContext = {
    template: watched.frame_style?.template,
    cardType: watched.card_type,
    hasBackFace: watched.has_back_face,
    kind,
    revise: isRevise,
  };
  const steps = visibleSteps(stepCtx);
  // Per-kind panel config — which text editor and art slots the steps render.
  const panelConfig = panelConfigFor(stepCtx);
  const idx = Math.min(current, steps.length - 1);
  const activeStep = steps[idx];
  const stepKey = activeStep?.key;
  const isLastStep = idx === steps.length - 1;
  // Why the persistent Save button is disabled, if it is. Rendered as a
  // hint row above the action bar (and doubled as the button's hover
  // title) — names EVERY missing requirement so the user isn't peeled one
  // gap at a time.
  // A draft (Publish step checkbox → private) needs only a title; anything
  // that can be seen by others needs artwork too — and a name for its second
  // face (the Adventure spell, a split / aftermath / flip half; TODO 3b.5,
  // lib/cards/second-face-name.ts). That name used to be required silently:
  // Save stayed enabled, the save failed on a field folded away inside the
  // Identity step's "More options".
  const secondFaceNameMissing =
    watched.has_back_face &&
    missingSecondFaceName(
      watched.back_face,
      watched.save_as_draft ? "private" : watched.visibility,
    );
  const saveMissing = [
    !watched.title.trim() ? "a title" : null,
    !watched.save_as_draft && !watched.art_url.trim() ? "artwork" : null,
    secondFaceNameMissing
      ? isAdventureFrame
        ? "the adventure's name"
        : "the second face's name"
      : null,
  ].filter((part): part is string => part !== null);
  // Edit / remix: at least one field must change (owner decision
  // 2026-09-16). For a remix the visibility choice alone doesn't count — the
  // card itself has to differ from the original.
  const reviseUnchanged = isEdit
    ? !isDirty
    : isRemix
      ? !hasMeaningfulChange(Object.keys(dirtyFields), "remix")
      : false;
  const saveDisabledReason =
    saveMissing.length > 0
      ? `Add ${listPhrase(saveMissing)} to enable Save.`
      : deckRemix && remixSource && !isDirty
        ? "Change something to make it your own custom proxy — an exact copy can't be saved."
        : reviseUnchanged
          ? isRemix
            ? "Change something — the name, art, text or numbers — to make this remix your own."
            : "Change something to enable Save."
          : null;
  const statVis = statVisibility(
    watched.card_type,
    parseSubtypes(watched.subtypes_text),
  );
  // Basic-land rule (lib/cards/watermark.ts): a BASIC land prints the big
  // symbol and no text; the Text step becomes the icon step. Computed once
  // from the same fields both renderers read, so the editor and the preview
  // can't disagree about which kind of land this is.
  const landBasicKey = basicLandManaKey({
    cardType: watched.card_type,
    supertype: watched.supertype,
    subtypes: parseSubtypes(watched.subtypes_text),
    title: watched.title,
    rulesText: watched.rules_text,
  });
  const landIdentity = () => ({
    title: getValues("title") ?? "",
    supertype: getValues("supertype") ?? "",
    subtypes_text: getValues("subtypes_text") ?? "",
  });
  /** Land type (the Land kind's first Variation on the Card step): rewrite
   *  the supertype/subtypes so the card is a basic (big symbol) or a
   *  nonbasic (rules text). */
  const handleLandModeChange = (next: "basic" | "nonbasic") => {
    const identity = landIdentity();
    const patch =
      next === "basic"
        ? toBasicLandIdentity(
            identity,
            pickFrameColorKey(getValues("color_identity")),
          )
        : toNonbasicLandIdentity(identity);
    if (!patch) return;
    setValue("supertype", patch.supertype, { shouldDirty: true });
    setValue("subtypes_text", patch.subtypes_text, { shouldDirty: true });
    if (next === "nonbasic") {
      leaveBasicOnlyFrame({ getValues, setValue, clearErrors }, verifiedFrameKeys);
    }
  };
  // A land the user RENAMES away from its seeded basic name becomes a
  // nonbasic: the seed's "Basic" + subtype are dropped so the rules text box
  // appears (typing "Command Tower" over a seeded Plains used to leave
  // "Basic — Plains" behind and print a textless big symbol). Only on real
  // edits (isDirty) — draft restores and card loads never rewrite identity.
  const lastLandTitleRef = useRef(watched.title);
  useEffect(() => {
    if (lastLandTitleRef.current === watched.title) return;
    lastLandTitleRef.current = watched.title;
    // The type line is locked while revising — renaming never rewrites it.
    if (isRevise || !isDirty || watched.card_type !== "land") return;
    const identity = {
      title: watched.title,
      supertype: watched.supertype,
      subtypes_text: watched.subtypes_text,
    };
    if (!shouldClearBasicSeedForTitle(identity)) return;
    const next = toNonbasicLandIdentity(identity);
    setValue("supertype", next.supertype, { shouldDirty: true });
    setValue("subtypes_text", next.subtypes_text, { shouldDirty: true });
    leaveBasicOnlyFrame({ getValues, setValue, clearErrors }, verifiedFrameKeys);
  }, [
    watched.title,
    watched.card_type,
    watched.supertype,
    watched.subtypes_text,
    isDirty,
    isRevise,
    getValues,
    setValue,
    clearErrors,
    verifiedFrameKeys,
  ]);

  // A frame switch the user makes keeps the art's framing (the visible
  // centre carries to the new art window) and drops Etched on an
  // edge-to-edge frame (TODO 3.23; components/creator/use-treatment-switch.ts).
  const artNaturalSize = useImageNaturalSize(watched.art_url);
  useTreatmentSwitch({
    template: watched.frame_style?.template,
    artUrl: watched.art_url,
    natural: artNaturalSize,
    isDirty,
    getValues,
    setValue,
    profileOverrides,
  });

  const goToIndex = (i: number) => {
    setCurrent(Math.max(0, Math.min(i, steps.length - 1)));
    // Navigating a step always shows the front; the back is reached by adding
    // it (auto-flips, see onBackFaceAdded) or by clicking the preview to flip.
    setPreviewFace("front");
  };
  const goToStepKey = (key: StepKey) => {
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) goToIndex(i);
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
    label: stepLabel(step),
    description: step.description,
    hasError: stepsWithErrors.has(step.key),
  }));

  // Color is chosen on the Frame step; the cost→color relationship is now
  // surfaced as an opt-in prompt on the Pips panel (no automatic overwrite).

  // ---- Kind changes: the ONLY writer of frame_style.template. ----
  // The old effect that silently rewrote the frame whenever card_type changed
  // (with a hidden M15 fallback) is gone. Kind changes flow through
  // planKindChange: same-era remaps apply directly; era switches ask first
  // (KindChangeDialog). Programmatic paths (Scryfall import, AI random)
  // auto-accept the fallback with a toast — a dialog mid-import would be
  // hostile.
  const currentTemplate = (watched.frame_style?.template ??
    DEFAULT_FRAME_TEMPLATE) as FrameTemplate;
  const [pendingKindPlan, setPendingKindPlan] = useState<Extract<
    KindChangePlan,
    { action: "confirm" }
  > | null>(null);
  /** Populate the structured row editors from a rules text — used when a
   *  card ARRIVES as a planeswalker/saga (import, AI, kind switch) so the
   *  row editors never open empty while the text sits invisible. */
  const seedStructuredRows = (
    targetKind: CardKind,
    rulesText: string | null | undefined,
  ) => {
    if (!rulesText?.trim()) return;
    // Both editors cap at 6 rows (the printed extreme) and the server refuses
    // more; a long rules text used to seed 7+ rows that could never be saved
    // — and the server's error landed on `face_content`, a key no panel
    // renders, so the card just silently wouldn't save.
    const MAX_STRUCTURED_ROWS = 6;
    if (targetKind === "planeswalker") {
      setValue(
        "loyalty_abilities",
        loyaltyFromRulesText(rulesText)
          .slice(0, MAX_STRUCTURED_ROWS)
          .map((r) => ({
            cost: r.cost ?? "",
            text: r.text,
          })),
        { shouldDirty: true },
      );
    } else if (targetKind === "saga") {
      const saga = sagaFromRulesText(rulesText);
      setValue(
        "saga_chapters",
        saga.chapters.slice(0, MAX_STRUCTURED_ROWS).map((ch) => ({
          numerals: [...ch.numerals],
          text: ch.text,
        })),
        { shouldDirty: true },
      );
      setValue("saga_intro", saga.intro ?? "", { shouldDirty: true });
    }
  };

  /** Carry the loyalty / saga row editors across a kind change (TODO 3b.3).
   *  Leaving a rows-driven kind folds the rows into rules_text, so the work
   *  survives as plain text (the rows only serialize at submit, and only for
   *  their own kind), and then EMPTIES them: rows left behind skipped the
   *  re-seed on the way back, so planeswalker → creature → edit the text →
   *  planeswalker resubmitted the stale abilities. Entering a rows-driven
   *  kind with an empty editor seeds it from the rules text. */
  const carryStructuredRows = (prevKind: CardKind, nextKind: CardKind) => {
    if (prevKind === nextKind) return;
    if (prevKind === "planeswalker") {
      const rows = getValues("loyalty_abilities")
        .map((r) => ({
          cost: r.cost.trim() ? r.cost.trim() : null,
          text: r.text.trim(),
        }))
        .filter((r) => r.text.length > 0);
      if (rows.length > 0) {
        setValue("rules_text", serializeLoyalty(rows), { shouldDirty: true });
      }
      setValue("loyalty_abilities", [], { shouldDirty: true });
    } else if (prevKind === "saga") {
      const chapters = getValues("saga_chapters")
        .map((r) => ({
          numerals: [...r.numerals].sort((a, b) => a - b),
          text: r.text.trim(),
        }))
        .filter((r) => r.text.length > 0 && r.numerals.length > 0);
      const intro = getValues("saga_intro").trim();
      if (chapters.length > 0 || intro) {
        setValue("rules_text", serializeSaga(intro || null, chapters), {
          shouldDirty: true,
        });
      }
      setValue("saga_chapters", [], { shouldDirty: true });
      setValue("saga_intro", "", { shouldDirty: true });
    }
    if (
      nextKind === "planeswalker" &&
      getValues("loyalty_abilities").length === 0
    ) {
      seedStructuredRows(nextKind, getValues("rules_text"));
    }
    if (nextKind === "saga" && getValues("saga_chapters").length === 0) {
      seedStructuredRows(nextKind, getValues("rules_text"));
    }
  };

  const applyKindPatch = (patch: KindChangePatch) => {
    // The verification gate applies to KIND changes too — a card type pick
    // must never land on an unpublished frame. When the planned template has
    // no published color, fall back to the kind's first published frame; if
    // the whole kind is unpublished (programmatic paths — the chips are
    // already disabled in the UI), set the type but keep the current frame.
    // Resolve against the CURRENT colour (the user's pick is a fact): the
    // planned template in this colour, else another published frame of the
    // kind in this colour, else the planned template in a colour it has —
    // and say which of those happened. Never an unpublished pair.
    const currentColorKey = pickFrameColorKey(
      getValues("color_identity"),
    ) as FrameColorKey;
    const resolution = resolvePublishedFrame({
      kind: kindFromCard(patch.card_type, patch.template),
      candidates: [patch.template],
      colorKey: currentColorKey,
      verifiedKeys: new Set(verifiedFrameKeys),
      prefer: "frame",
    });
    // Snapshot BEFORE the writes — the row fold and the land auto-identity
    // below must judge the state the user is leaving, not the one we're
    // creating.
    const prevCardType = getValues("card_type");
    const prevTemplate = getValues("frame_style.template");
    const prevKind = kindFromCard(prevCardType, prevTemplate);
    if (resolution.status === "unavailable") {
      // The type still changes, so the rows fold first: a row-built walker
      // turned into an unpublished battle used to save with empty rules.
      carryStructuredRows(prevKind, kindFromCard(patch.card_type, prevTemplate));
      setValue("card_type", patch.card_type, { shouldDirty: true });
      if (patch.has_back_face) {
        setValue("has_back_face", true, { shouldDirty: true });
      }
      toast.info(
        "That card type's frames aren't published yet — keeping the current frame.",
      );
      return;
    }
    const template = resolution.template;
    if (resolution.status === "frame-switched") {
      toast.info(
        `${describeFrame(resolution.fromTemplate)} isn't available in ${colorWord(currentColorKey)} yet — using ${describeFrame(template)}.`,
      );
    } else if (resolution.status === "colour-switched") {
      setValue("color_identity", [colorIdentityForKey(resolution.colorKey)], {
        shouldDirty: true,
      });
      toast.info(
        `${describeFrame(template)} isn't available in ${colorWord(resolution.fromColorKey)} yet — switched the colour to ${colorWord(resolution.colorKey)}.`,
      );
    }
    const nextKind = kindFromCard(patch.card_type, template);
    const identitySnapshot = {
      title: getValues("title") ?? "",
      supertype: getValues("supertype") ?? "",
      subtypes_text: getValues("subtypes_text") ?? "",
    };
    // Rows fold into rules_text on the way out and seed from it on the way
    // in — before anything else touches the text.
    carryStructuredRows(prevKind, nextKind);
    // Leaving a frame with an intrinsic second face (Adventure/split/flip):
    // that face was forced on for the frame, so drop it with the frame —
    // otherwise an invisible, unfixable back_face.title error followed the
    // card around.
    if (hasInlineBackFace(prevTemplate) && !hasInlineBackFace(template)) {
      setValue("has_back_face", false, { shouldDirty: true });
      setValue("back_face", EMPTY_BACK_FACE, { shouldDirty: true });
    } else if (
      hasInlineBackFace(template) &&
      isBlankBackFace(getValues("back_face"))
    ) {
      // Entering (or moving between) frames that paint a second face: an
      // untouched one takes the new kind's type — a split's second half
      // used to start, and save, as a Creature (TODO 3b.8).
      setValue("back_face", blankSecondFaceFor(nextKind), { shouldDirty: true });
    }
    setValue("card_type", patch.card_type, { shouldDirty: true });
    setValue("frame_style.template", template, { shouldDirty: true });
    if (patch.has_back_face) {
      setValue("has_back_face", true, { shouldDirty: true });
    }
    // The default watermark follows the type (owner decision 2026-09-17):
    // a free account's creature/spell always carries the PipGlyph Rose, and
    // leaving those types drops the forced Rose (it was never a choice).
    // Subscribers keep whatever they picked.
    if (!isPaid) {
      const wasDefault = usesDefaultWatermark(prevCardType);
      const isDefault = usesDefaultWatermark(patch.card_type);
      if (isDefault) {
        setValue(
          "watermark",
          watermarkFormValuesFromValue(defaultWatermarkFor(patch.card_type, false)),
          { shouldDirty: true },
        );
      } else if (wasDefault) {
        setValue("watermark", watermarkFormValuesFromValue(null), { shouldDirty: true });
      }
    }
    // Land auto-identity: picking Land starts you on the basic of the current
    // frame color (colorless → Wastes) — that's what makes the big mana
    // symbol render immediately. Only fires while the identity is untouched
    // (or a previous seed), so it can never overwrite a typed name; leaving
    // Land clears a still-pristine seed the same way.
    if (isSeedableLandIdentity(identitySnapshot)) {
      if (nextKind === "land") {
        const seed = basicLandSeedForColorKey(
          pickFrameColorKey(getValues("color_identity")),
        );
        if (seed) {
          setValue("title", seed.title, { shouldDirty: true });
          setValue("supertype", seed.supertype, { shouldDirty: true });
          setValue("subtypes_text", seed.subtypes_text, { shouldDirty: true });
        }
      } else if (prevCardType === "land" && identitySnapshot.title.trim()) {
        setValue("title", "", { shouldDirty: true });
        setValue("supertype", "", { shouldDirty: true });
        setValue("subtypes_text", "", { shouldDirty: true });
      }
    }
  };
  const handleKindSelect = (next: CardKind) => {
    if (next === kind) return;
    const plan = planKindChange(next, {
      cardType: watched.card_type,
      template: watched.frame_style?.template,
    });
    if (plan.action === "apply") {
      applyKindPatch(plan.patch);
    } else {
      setPendingKindPlan(plan);
    }
  };
  /** Color chips → keep a pristine basic-land identity in step with the
   *  color (Forest → Mountain when green flips to red; multicolor has no
   *  basic, so the seed clears for the user to name their dual). Inert the
   *  moment the user renames the card. */
  const handleColorIdentityChange = (next: ColorIdentity[]) => {
    if (watched.card_type !== "land") return;
    const identity = {
      title: getValues("title") ?? "",
      supertype: getValues("supertype") ?? "",
      subtypes_text: getValues("subtypes_text") ?? "",
    };
    if (!identity.title.trim() || !isSeedableLandIdentity(identity)) return;
    const seed = basicLandSeedForColorKey(pickFrameColorKey(next));
    setValue("title", seed?.title ?? "", { shouldDirty: true });
    setValue("supertype", seed?.supertype ?? "", { shouldDirty: true });
    setValue("subtypes_text", seed?.subtypes_text ?? "", {
      shouldDirty: true,
    });
  };

  /** Programmatic kind application (import/AI): never blocks on a dialog —
   *  accepts the era fallback and tells the user what happened. */
  const applyKindProgrammatic = (nextKind: CardKind) => {
    const plan = planKindChange(nextKind, {
      cardType: watched.card_type,
      template: getValues("frame_style.template"),
    });
    applyKindPatch(plan.patch);
    if (plan.action === "confirm") {
      toast.info("Switched to the M15 frame to fit the card's type.");
    }
  };

  // Frames with an intrinsic second face (Adventure's storybook page, the
  // flip/split/aftermath halves) always PAINT that face — leaving the editor
  // disabled saved cards with a blank painted half. Force it on whenever such
  // a frame is active; the LayoutPanel's action is "clear content", never
  // "remove the face". Deliberately not marked dirty: on edit-mode load of a
  // legacy card this is a repair, not a user change (submit sends values, not
  // dirty flags, so it still persists on the next save).
  useEffect(() => {
    if (hasInlineBackFace(currentTemplate) && !watched.has_back_face) {
      setValue("has_back_face", true);
    }
  }, [currentTemplate, watched.has_back_face, setValue]);

  // Symbol insertion for the rules editors (front + back): the PipTextEditor
  // owns the caret and drops the pip in place, then reports the new
  // brace-code string through its field onChange.
  const rulesTextRef = useRef<PipTextEditorHandle | null>(null);
  const backRulesTextRef = useRef<PipTextEditorHandle | null>(null);
  const insertSymbol = (
    ref: React.MutableRefObject<PipTextEditorHandle | null>,
    token: string,
  ) => {
    ref.current?.insertToken(token);
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

    // Colour first, so a kind change below resolves its frame against the
    // idea's colour (the order the Scryfall import uses).
    if (patch.color_identity) {
      setValue(
        "color_identity",
        // Single-select color model: 2+ colors collapse to multicolor.
        normalizeColorSelection(
          Array.from(patch.color_identity) as ColorIdentity[],
        ),
        { shouldDirty: true },
      );
    }

    // The idea's type is a KIND change, never a bare card_type write (TODO
    // 3b.2): a "Legendary Planeswalker" idea used to land card_type
    // planeswalker on the plain m15 frame — no loyalty box, rows printed as
    // text. applyKindProgrammatic moves the frame, the watermark default,
    // the land seed and the loyalty/saga rows with it. An idea whose type
    // the current kind already prints (a creature on Adventure, an
    // enchantment on Saga, a creature on a snow frame) keeps the kind and
    // its frame. The type line is locked while revising.
    if (patch.card_type && !isRevise) {
      const ideaType = patch.card_type as CardType;
      const currentKind = kindFromCard(
        getValues("card_type"),
        getValues("frame_style.template"),
      );
      if (KIND_DEFS[currentKind].cardType !== ideaType) {
        applyKindProgrammatic(kindFromCard(ideaType, undefined));
      } else if (getValues("card_type") !== ideaType) {
        setValue("card_type", ideaType, { shouldDirty: true });
      }
    }

    setIfPresent("title", patch.title);
    setIfPresent("cost", patch.cost);
    setIfPresent("supertype", patch.supertype);
    setIfPresent("subtypes_text", patch.subtypes_text);
    setIfPresent("rarity", patch.rarity);
    setIfPresent("rules_text", patch.rules_text);
    setIfPresent("flavor_text", patch.flavor_text);
    setIfPresent("power", patch.power);
    setIfPresent("toughness", patch.toughness);
    setIfPresent("loyalty", patch.loyalty);
    setIfPresent("defense", patch.defense);

    // The AI writes rules_text — mirror it into the row editors when the
    // card is a walker/saga so the Text step reflects the patch.
    if (patch.rules_text !== undefined) {
      const patchedKind = kindFromCard(
        getValues("card_type"),
        getValues("frame_style.template"),
      );
      if (patchedKind === "planeswalker" || patchedKind === "saga") {
        seedStructuredRows(patchedKind, patch.rules_text);
      }
    }
  };

  // Apply a Scryfall import payload. Fields not present in the patch are
  // left alone — if the user already filled a Title, we don't blow it away.
  // The `importedArtUrl` (set when the user opted to also import artwork)
  // is written to art_url and resets the focal point so the new image
  // shows centered.
  /** Applies the import and returns the printing-treatment notice (or null)
   *  for the CALLER to toast after its own success toast, so the notice
   *  stacks on top of it (Sonner shows the newest in front). */
  const handleScryfallImport = ({
    patch,
    importedArtUrl,
    source,
  }: ScryfallImportPayload): ImportNotice | null => {
    const setIfPresent = (key: keyof FormValues, value: string | undefined) => {
      if (value === undefined) return;
      setValue(key, value as never, { shouldDirty: true });
    };

    // Kind first, synchronously: card_type + frame land in one handler pass
    // (via planKindChange), so there's no effect left to race the rest of the
    // patch — the old import/auto-sync race is structurally gone. The mapper
    // derives a layout-aware kind (an imported Saga lands on the saga frame,
    // an aftermath on the aftermath frame); a bare card_type is the fallback.
    const importedKind =
      patch.kind ??
      (patch.card_type
        ? kindFromCard(patch.card_type as CardType, undefined)
        : null);
    if (importedKind) {
      applyKindProgrammatic(importedKind);
    }

    // Adopt THIS PRINTING's frame (the mapper's era/skin template; layout
    // kinds already landed on their template above) — resolved against the
    // IMPORTED colour, which is a fact about the card and never changes:
    // the printing's frame, else its era's standard, else the M15 standard,
    // else any published frame of the kind in that colour. A substitution is
    // announced, never silent. (Phase 1 replaces the toast with the
    // exact/nearest chooser.)
    {
      const { wanted, colorKey, resolution } = resolveImportFrame({
        patch,
        kind: importedKind,
        current: {
          template: getValues("frame_style.template") as
            | FrameTemplate
            | undefined,
          cardType: getValues("card_type") || null,
          colors: getValues("color_identity"),
        },
        verifiedKeys: new Set(verifiedFrameKeys),
      });
      if (
        resolution.status === "exact" ||
        resolution.status === "frame-switched"
      ) {
        if (getValues("frame_style.template") !== resolution.template) {
          setValue("frame_style.template", resolution.template, {
            shouldDirty: true,
          });
        }
        if (resolution.status === "frame-switched") {
          toast.info(
            `This printing's ${describeFrame(resolution.fromTemplate)} frame isn't available in ${colorWord(colorKey)} yet — using ${describeFrame(resolution.template)}.`,
          );
        }
      } else {
        // Never recolour an imported card; keep whatever frame the kind
        // change landed on and say why.
        toast.info(
          `${describeFrame(wanted)} isn't available in ${colorWord(colorKey)} yet — kept the current frame.`,
        );
      }
    }
    // A borderless / showcase / extended-art / full-art / textless printing
    // lands on the plain frame above, which "exact" alone would pass off as
    // a match — name the treatment and the frame it actually got (TODO 1.16
    // stopgap until the 1.4 resolver). Returned, not toasted: both callers
    // toast their own "Imported …" / "Pre-filled …" first and this notice
    // right after it, so it sits in front.
    const landedTemplate =
      (getValues("frame_style.template") as FrameTemplate | undefined) ??
      DEFAULT_FRAME_TEMPLATE;
    const treatmentMessage = patch.printing_treatment
      ? printingTreatmentNotice(patch.printing_treatment, landedTemplate)
      : null;
    // PipGlyph's own frame for the treatment (the borderless M15 frame, the
    // full-art basic — frames plan 4.32 / 4.39) is OFFERED once it is
    // verified in this colour, never picked for the user (1.16).
    const treatmentOffer = treatmentMessage
      ? printingTreatmentOffer(patch, new Set(verifiedFrameKeys))
      : null;
    const treatmentNotice: ImportNotice | null =
      treatmentMessage && treatmentOffer && treatmentOffer.template !== landedTemplate
        ? {
            message: treatmentMessage,
            action: {
              label: treatmentOffer.actionLabel,
              onClick: () =>
                setValue("frame_style.template", treatmentOffer.template, {
                  shouldDirty: true,
                }),
            },
          }
        : treatmentMessage;

    setIfPresent("title", patch.title);
    setIfPresent("cost", patch.cost);
    // The type line is imported WHOLE: a real card with no supertype and no
    // subtypes (Command Tower, Adarkar Wastes) must clear whatever the kind
    // change seeded a moment ago — applyKindProgrammatic("land") writes a
    // "Basic — Wastes" seed over an empty identity, and leaving it in place
    // turned every imported nonbasic land into a textless basic.
    if (importedKind) {
      setValue("supertype", patch.supertype ?? "", { shouldDirty: true });
      setValue("subtypes_text", patch.subtypes_text ?? "", {
        shouldDirty: true,
      });
    } else {
      setIfPresent("supertype", patch.supertype);
      setIfPresent("subtypes_text", patch.subtypes_text);
    }
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

    // The imported rules text drives the row editors for walkers/sagas —
    // seed them AFTER the field patches so the rows reflect the import,
    // not whatever text was there before.
    if (importedKind === "planeswalker" || importedKind === "saga") {
      seedStructuredRows(importedKind, patch.rules_text);
    }

    // Stamp the Scryfall provenance so the saved card joins the
    // "Also remixed by N" group on the public detail page (chunk 13).
    if (patch.source_scryfall_id) {
      setValue("source_scryfall_id", patch.source_scryfall_id, {
        shouldDirty: true,
      });
      // Cards that start from a real card are proxies until altered —
      // auto-tag them so the glossary's contract holds (see CardGlossary).
      setValue("tags_text", mergeTag(getValues("tags_text"), "proxy"), {
        shouldDirty: true,
      });
    }

    setRemixSource({ name: source.name, scryfallUri: source.scryfallUri });
    // Pop the user back to Identity so they can see the seeded fields.
    goToStepKey("identity");
    return treatmentNotice;
  };

  // Deck remix deep-link (/create?deckCard=…): pre-fill the form from the
  // entry's Scryfall card on mount — same patch pipeline as the import
  // dialog, INCLUDING the artwork (a proxy without the original's frame
  // data + art isn't a useful starting point).
  //
  // Apply-once semantics live at APPLICATION time, not fetch time: the ref
  // is only stamped after a successful import. Stamping before the await
  // (the original shape) let React's dev double-invoked effects — and any
  // re-render racing the fetch — permanently swallow the prefill: run 1
  // claimed the ref then had its response cancelled, run 2 saw the ref and
  // bailed. There is deliberately NO cleanup cancellation for the same
  // reason; a duplicate in-flight fetch is harmless, a dropped apply isn't.
  const deckRemixImportedRef = useRef(false);
  useEffect(() => {
    if (mode !== "create" || !deckRemix?.scryfallId) return;
    if (deckRemixImportedRef.current) return;
    setDeckRemixImporting(true);
    (async () => {
      try {
        const response = await fetch(
          `/api/scryfall/named?${new URLSearchParams({
            id: deckRemix.scryfallId as string,
          })}`,
        );
        const body = (await response.json().catch(() => null)) as
          | {
              ok: true;
              card: { name: string; scryfall_uri: string | null };
              patch: ScryfallImportPatch;
            }
          | { ok: false; error?: string }
          | null;
        if (!body || body.ok !== true) {
          toast.error(
            (body && "error" in body && body.error) ||
              `Couldn't load “${deckRemix.entryName}” — starting from a blank card.`,
          );
          return;
        }
        if (deckRemixImportedRef.current) return; // a parallel run applied first
        deckRemixImportedRef.current = true;

        // Pull the original's art into the user's bucket (front face; the
        // back face keeps the explicit Layout-step flow). Failure degrades
        // to a text-only prefill rather than blocking the import.
        let importedArtUrl: string | null = null;
        try {
          const artResponse = await fetch("/api/scryfall/import-art", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              scryfallId: deckRemix.scryfallId,
              mode: "art",
            }),
          });
          const artBody = (await artResponse.json().catch(() => null)) as
            | { ok: true; publicUrl: string }
            | { ok: false; error?: string }
            | null;
          if (artBody?.ok) importedArtUrl = artBody.publicUrl;
        } catch {
          // soft-fail — the user can import art from the dialog later
        }

        const treatmentNotice = handleScryfallImport({
          patch: body.patch,
          importedArtUrl,
          source: {
            name: body.card.name,
            scryfallUri: body.card.scryfall_uri,
          },
        });
        // Re-baseline: the imported card is the starting point, not user
        // work. Save stays disabled until they actually alter something —
        // an unchanged copy is just the real card, not a custom proxy.
        reset(getValues());
        toast.success(
          `Pre-filled from ${body.card.name} — change something to make it your custom proxy, then save to link it into “${deckRemix.deckTitle}”.`,
        );
        toastImportNotice(treatmentNotice);
      } catch {
        toast.error(
          `Couldn't load “${deckRemix.entryName}” — starting from a blank card.`,
        );
      } finally {
        setDeckRemixImporting(false);
      }
    })();
    // handleScryfallImport is recreated per render; the apply-once ref makes
    // listing it pure dependency churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deckRemix]);

  // ---- Per-field AI fill ----
  // The dialog's tick-set becomes a "card_fill" job (plan = fast text
  // design around the pinned fields; one step = the art, when wanted). The
  // form drives the two requests itself and waits — the result belongs to
  // THIS form, so there is no background widget and no dashboard hop. One
  // credit per run, charged by the step and refunded if it fails.
  const statsLabel = statVis.loyalty
    ? "Loyalty"
    : statVis.defense
      ? "Defense"
      : "Power / toughness";
  // An instant has no stat line — the dialog doesn't offer one and the Text
  // step's button doesn't promise one.
  const hasStats = statVis.pt || statVis.loyalty || statVis.defense;
  const lockedFieldsFor = (
    values: FormValues,
    want: readonly CardFillField[],
  ): CardFillLocked => {
    const has = (f: CardFillField) => want.includes(f);
    const str = (v: string) => (v.trim() ? v.trim() : undefined);
    const kindNow = kindFromCard(values.card_type, values.frame_style?.template);
    // Walkers/sagas keep their text in rows; pin the serialized form so the
    // designer reads the same thing the card prints.
    let rulesNow = values.rules_text;
    if (kindNow === "planeswalker") {
      const rows = values.loyalty_abilities
        .map((r) => ({ cost: r.cost.trim() || null, text: r.text.trim() }))
        .filter((r) => r.text);
      if (rows.length) rulesNow = serializeLoyalty(rows);
    } else if (kindNow === "saga") {
      const chapters = values.saga_chapters
        .map((r) => ({ numerals: [...r.numerals].sort((a, b) => a - b), text: r.text.trim() }))
        .filter((r) => r.text && r.numerals.length);
      if (chapters.length) {
        rulesNow = serializeSaga(values.saga_intro.trim() || null, chapters);
      }
    }
    return {
      title: has("title") ? undefined : str(values.title),
      cost: has("cost") ? undefined : str(values.cost),
      card_type: has("card_type") ? undefined : values.card_type || undefined,
      supertype: has("card_type") ? undefined : str(values.supertype),
      subtypes: has("card_type") ? undefined : parseSubtypes(values.subtypes_text),
      rarity: has("rarity") ? undefined : values.rarity || undefined,
      color_identity:
        has("color_identity") || values.color_identity.length === 0
          ? undefined
          : values.color_identity,
      rules_text: has("rules_text") ? undefined : str(rulesNow),
      flavor_text: has("flavor_text") ? undefined : str(values.flavor_text),
      power: has("stats") || !statVis.pt ? undefined : str(values.power),
      toughness: has("stats") || !statVis.pt ? undefined : str(values.toughness),
      loyalty: has("stats") || !statVis.loyalty ? undefined : str(values.loyalty),
      defense: has("stats") || !statVis.defense ? undefined : str(values.defense),
      tags: has("tags") ? undefined : parseTags(values.tags_text),
    };
  };

  /** Pour a fill result into the form — only the keys present are touched. */
  const applyFill = (fill: CardFillResult) => {
    if (fill.card_type && !isRevise) {
      applyKindProgrammatic(kindFromCard(fill.card_type, undefined));
      if (fill.frame_template) {
        const colorKey = pickFrameColorKey(
          getValues("color_identity"),
        ) as FrameColorKey;
        const resolution = resolvePublishedFrame({
          kind: kindFromCard(fill.card_type, undefined),
          candidates: [fill.frame_template as FrameTemplate],
          colorKey,
          verifiedKeys: new Set(verifiedFrameKeys),
          prefer: "frame",
        });
        if (
          resolution.status === "exact" ||
          resolution.status === "frame-switched"
        ) {
          setValue("frame_style.template", resolution.template, {
            shouldDirty: true,
          });
          if (resolution.status === "frame-switched") {
            toast.info(
              `${describeFrame(resolution.fromTemplate)} isn't available in ${colorWord(colorKey)} yet — using ${describeFrame(resolution.template)}.`,
            );
          }
        }
      }
      setValue("supertype", fill.supertype ?? "", { shouldDirty: true });
      setValue("subtypes_text", (fill.subtypes ?? []).join(", "), {
        shouldDirty: true,
      });
    }
    if (fill.color_identity && !isRevise) {
      setValue(
        "color_identity",
        normalizeColorSelection(fill.color_identity),
        { shouldDirty: true },
      );
    }
    if (fill.title !== undefined) setValue("title", fill.title, { shouldDirty: true });
    if (fill.cost !== undefined) setValue("cost", fill.cost, { shouldDirty: true });
    if (fill.rarity !== undefined) setValue("rarity", fill.rarity, { shouldDirty: true });
    if (fill.rules_text !== undefined) {
      setValue("rules_text", fill.rules_text, { shouldDirty: true });
      const k = kindFromCard(getValues("card_type"), getValues("frame_style.template"));
      if (k === "planeswalker" || k === "saga") seedStructuredRows(k, fill.rules_text);
    }
    if (fill.flavor_text !== undefined) {
      setValue("flavor_text", fill.flavor_text ?? "", { shouldDirty: true });
    }
    if (fill.power !== undefined || fill.loyalty !== undefined || fill.defense !== undefined) {
      setValue("power", fill.power ?? "", { shouldDirty: true });
      setValue("toughness", fill.toughness ?? "", { shouldDirty: true });
      setValue("loyalty", fill.loyalty ?? "", { shouldDirty: true });
      setValue("defense", fill.defense ?? "", { shouldDirty: true });
    }
    if (fill.tags !== undefined) {
      // Generated tags replace the list; a challenge CTA's tag survives.
      let next = fill.tags.join(", ");
      if (initialTag) next = mergeTag(next, initialTag);
      setValue("tags_text", next, { shouldDirty: true });
    }
    if (fill.art_url) {
      setValue("art_url", fill.art_url, { shouldDirty: true });
      setValue("art_position", { focalX: 0.5, focalY: 0.5, scale: 1 }, { shouldDirty: true });
      if (fill.artist_credit) {
        setValue("artist_credit", fill.artist_credit, { shouldDirty: true });
      }
    }
    if (fill.deck_id && mode === "create") {
      setValue("deck_id", fill.deck_id, { shouldDirty: true });
    }
  };

  const handleAiFill = async (options: AiFillOptions): Promise<void> => {
    if (!userId) {
      toast.error("Sign in to generate with AI.");
      return;
    }
    if (!aiConfigured) {
      toast.error("AI generation isn't configured on this deployment.");
      return;
    }
    const wantsArt = options.want.includes("art");
    if (
      !(await confirmSpend({
        cost: 1,
        title: "Generate with AI?",
        description: wantsArt
          ? "Writes the ticked fields into this card and paints its artwork. Nothing is saved until you click Save."
          : "Writes the ticked fields into this card. Nothing is saved until you click Save.",
      }))
    ) {
      return;
    }
    setAiFillOpen(false);
    setFillPhase("designing");
    try {
      const planResponse = await fetch("/api/ai/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "card_fill",
          want: options.want,
          locked: lockedFieldsFor(getValues(), options.want),
          steer: { card_type: options.card_type, rarity: options.rarity },
          theme: options.theme,
          style: options.style,
          frame: options.frame,
          deck_id: options.deck_id,
          scope: fillScope,
        }),
      });
      const plan = await planResponse.json().catch(() => null);
      if (!planResponse.ok || !plan?.ok) {
        if (planResponse.status === 402 || plan?.code === "INSUFFICIENT_CREDITS") {
          upgrade.open("credits");
        } else if (plan?.code === "UPGRADE_REQUIRED") {
          upgrade.open("deck_aware_generation");
        } else {
          toast.error(plan?.error ?? "AI generation failed. Try again.");
        }
        return;
      }
      if (typeof plan.credits === "number") publishCredits(plan.credits - 1);
      const jobId: string = plan.job.id;
      if (wantsArt) setFillPhase("painting");

      // One step; poll while another request holds it (double-click, second
      // tab) instead of counting that as a failure.
      let step: { status?: string; error?: string; fill?: CardFillResult } | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const stepResponse = await fetch(`/api/ai/jobs/${jobId}/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const payload = await stepResponse.json().catch(() => null);
        if (!stepResponse.ok || !payload?.ok) {
          toast.error(payload?.error ?? "AI generation failed. Try again.");
          return;
        }
        if (typeof payload.credits === "number") publishCredits(payload.credits);
        step = payload.job?.steps?.[0];
        if (payload.inFlight || step?.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        break;
      }
      if (!step || step.status !== "done" || !step.fill) {
        // A FAILED step was refunded by the server; anything else is a
        // missing result, which must not claim a refund it can't prove.
        toast.error(
          step?.status === "failed"
            ? `${step.error ?? "AI generation failed."} Your credit was refunded.`
            : "AI generation didn't return a result. Try again.",
        );
        return;
      }
      applyFill(step.fill);
      claimFill(jobId);
      toast.success("Generated — look it over and save when you're happy.");
    } catch {
      toast.error("Network error during generation. Try again.");
    } finally {
      setFillPhase(null);
    }
  };

  // A generation that finished after the tab was closed (the credit was
  // spent, the result stored on the job): offer it once on the matching
  // page — Apply pours it into this form, Discard just claims it.
  const unclaimedCheckedRef = useRef(false);
  useEffect(() => {
    if (!userId || readOnly || unclaimedCheckedRef.current) return;
    unclaimedCheckedRef.current = true;
    let cancelled = false;
    fetch(`/api/ai/card-fill?scope=${encodeURIComponent(fillScope)}`)
      .then((r) => r.json())
      .then(
        (payload: {
          ok: boolean;
          fill: { jobId: string; result: CardFillResult; createdAt: string } | null;
        }) => {
          if (cancelled || !payload?.ok || !payload.fill) return;
          const { jobId, result } = payload.fill;
          toast.info("An AI generation finished while you were away.", {
            description: "Apply it to this card, or discard it.",
            duration: Infinity,
            closeButton: true,
            action: {
              label: "Apply",
              onClick: () => {
                applyFill(result);
                claimFill(jobId);
              },
            },
            cancel: { label: "Discard", onClick: () => claimFill(jobId) },
          });
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Mount-only per creator page; applyFill/claimFill are stable closures
    // over the same form instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, readOnly, fillScope]);

  // ---- Start over / Reset ----
  // Wipe the form back to its starting values (a blank card, the original
  // being remixed, or the last save), reset the derived toggles + preview,
  // and return to step 1.
  const handleStartOver = () => {
    reset(defaults);
    setRemixSource(null);
    setPreviewFace("front");
    setServerError(null);
    goToIndex(0);
    toast.success(
      mode === "create"
        ? "Started over — blank card ready."
        : isRemix
          ? "Reset to the original card."
          : "Reset to your last save.",
    );
  };

  // Arm the post-publish share prompt for a freshly-public card. The GA
  // event marks the impression so prompt→share conversion is measurable
  // against the per-target `share` events ShareTargets already fires.
  const promptPostSaveShare = (share: {
    title: string;
    cardId: string;
    cardPath: string;
    replace: boolean;
  }) => {
    sendGAEvent("event", "post_save_share_prompt", {
      content_type: "card",
      item_id: share.cardId,
    });
    setPostSaveShare(share);
  };

  // ---- Submit ----
  // `intent` decides the post-save flow:
  //   • "save"  → the Publish step decides: "Save as a draft" forces
  //               private, otherwise the chosen visibility applies.
  //   • "back"  → same, then jump to a fresh creator (/create?backFor=…) to
  //               build this card's back face.
  // `afterSave` (the unsaved-changes dialog) replaces the default post-save
  // destination with the navigation the user was attempting; `onFailure`
  // hears why a save didn't happen, so that dialog can say so.
  const runSubmit = (
    values: FormValues,
    intent: "save" | "back",
    options: {
      afterSave?: () => void;
      onFailure?: (message: string) => void;
    } = {},
  ) => {
    setServerError(null);
    const createBackAfter = intent === "back";
    const chosenVisibility = values.save_as_draft
      ? "private"
      : values.visibility;
    // No artwork → no gallery (server-enforced in create/updateCardAction).
    // The Save button already refuses a public save without art, so this
    // is only a belt-and-braces mirror of the server rule.
    const finalVisibility =
      chosenVisibility === "public" && !values.art_url.trim()
        ? "private"
        : chosenVisibility;

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

    // Structured rows: planeswalkers + sagas dual-write face_content AND a
    // canonically serialized rules_text (round-trip tested in
    // lib/cards/face-content.ts), so search/AI/exports keep reading
    // rules_text. Everything else clears face_content (null) and sends the
    // textarea as-is. Costs normalize the U+2212 minus to ASCII up front so
    // the serialized text matches what the server stores.
    const submitKind = kindFromCard(
      values.card_type,
      values.frame_style?.template,
    );
    let faceContentPayload: FaceContent | null = null;
    let rulesTextOut = values.rules_text.trim();
    if (submitKind === "planeswalker") {
      const rows = values.loyalty_abilities
        .map((r) => ({
          cost: r.cost.trim()
            ? r.cost.trim().replace(/[\u2212\u2013]/g, "-").toUpperCase()
            : null,
          text: r.text.trim(),
        }))
        .filter((r) => r.text.length > 0);
      if (rows.length > 0) {
        faceContentPayload = { v: 1, loyalty: { abilities: rows } };
        rulesTextOut = serializeLoyalty(rows);
      }
    } else if (submitKind === "saga") {
      const chapters = values.saga_chapters
        .map((r) => ({
          numerals: [...r.numerals].sort((a, b) => a - b),
          text: r.text.trim(),
        }))
        .filter((r) => r.text.length > 0 && r.numerals.length > 0);
      if (chapters.length > 0) {
        const intro = values.saga_intro.trim() || null;
        faceContentPayload = { v: 1, saga: { intro, chapters } };
        rulesTextOut = serializeSaga(intro, chapters);
      }
    }

    // Design watermark: the form's flat shape → the discriminated union
    // (null = none / clear).
    const watermarkOpacityPayload =
      values.watermark.opacity != null
        ? { opacity: values.watermark.opacity }
        : {};
    const watermarkPayload =
      values.watermark.kind === "mana"
        ? {
            kind: "mana" as const,
            key: values.watermark.key as "w" | "u" | "b" | "r" | "g" | "c",
            size: values.watermark.size,
            ...watermarkOpacityPayload,
          }
        : values.watermark.kind === "preset"
          ? {
              kind: "preset" as const,
              key: values.watermark.key,
              size: values.watermark.size,
              ...watermarkOpacityPayload,
            }
          : values.watermark.kind === "custom" && values.watermark.url
            ? {
                kind: "custom" as const,
                url: values.watermark.url,
                size: values.watermark.size,
                ...watermarkOpacityPayload,
              }
            : null;

    // Stats only ship for the type that prints them — a planeswalker turned
    // creature used to keep its loyalty in the row (and a battle its
    // defense). P/T already had this rule; loyalty/defense now match it.
    const submitSubtypes = parseSubtypes(values.subtypes_text);
    const submitCardType = (values.card_type || null) as CardType | null;
    const printsPT = showsPowerToughness(submitCardType, submitSubtypes);

    // No `slug`: a NEW card's slug is derived server-side from the title it
    // is saved with (so a remix lives at ITS name, not the original's), and
    // an edit never rewrites the slug (links stay stable).
    const payload = {
      title: values.title.trim(),
      game_system_id: values.game_system_id,
      cost: values.cost.trim() || undefined,
      color_identity: values.color_identity,
      supertype: values.supertype.trim() || undefined,
      card_type: values.card_type || undefined,
      subtypes: submitSubtypes,
      tags: parseTags(values.tags_text),
      rarity: values.rarity || undefined,
      rules_text: rulesTextOut || undefined,
      face_content: faceContentPayload,
      watermark: watermarkPayload,
      flavor_text: values.flavor_text.trim() || undefined,
      // The 1/1 default only belongs on P/T types — an instant or sorcery
      // never carries the creature stats it started the form with.
      power: printsPT ? values.power.trim() || undefined : undefined,
      toughness: printsPT ? values.toughness.trim() || undefined : undefined,
      loyalty: showsLoyalty(submitCardType)
        ? values.loyalty.trim() || undefined
        : undefined,
      defense: showsDefense(submitCardType)
        ? values.defense.trim() || undefined
        : undefined,
      artist_credit: values.artist_credit.trim() || undefined,
      art_url: values.art_url.trim() || undefined,
      art_position: values.art_position,
      frame_style: values.frame_style,
      // Same no-art rule for the visibility dropdown (covers the "create
      // back face" save path, where intent doesn't force a visibility).
      visibility: finalVisibility,
      back_face: backFacePayload,
      // v2 back face: a uuid links a card as the back; empty → null clears.
      back_card_id: values.back_card_id || null,
      // Empty → null so an intentional clear (e.g. generating an AI card
      // over an imported one) actually REMOVES the stored provenance on
      // update; undefined would silently keep the old link. Cards whose
      // provenance should persist hydrate the field non-empty on load.
      source_scryfall_id: values.source_scryfall_id.trim() || null,
      // Set-symbol fields (Set icon step). Empty → null clears back to the
      // default PipGlyph mark.
      set_icon_url: values.set_icon_url.trim() || null,
      set_icon_code: values.set_icon_code.trim() || null,
      // Create-flow convenience: a UUID drops the saved card into that deck
      // (custom-only mainboard entry). Ignored by updates.
      deck_id: values.deck_id || null,
      // Remix: the new card links back to the original it started from.
      parent_card_id: isRemix && card ? card.id : undefined,
      // Subscriber footer mark for this card ("" = none). The action ignores
      // it for free accounts.
      footer_text: values.footer_text.trim(),
    };

    startTransition(async () => {
      const applyFieldErrors = (
        fieldErrors: Record<string, string | undefined> | undefined,
      ): string | null => {
        if (!fieldErrors) return null;
        const rendered = buildFieldToStep(steps);
        let firstErrorField: string | null = null;
        const unrendered: string[] = [];
        for (const [name, message] of Object.entries(fieldErrors)) {
          if (!message) continue;
          const root = name.split(".")[0] as keyof FormValues;
          if (rendered.has(root)) {
            setError(name as keyof FormValues, { message });
            if (!firstErrorField) firstErrorField = name;
          } else {
            // No panel shows this key (face_content, back_card_id, …) — a
            // setError here would vanish. Hand it back for the toast instead.
            unrendered.push(message);
          }
        }
        // Jump to the step owning the first errored field (falls back to the
        // last step if that step isn't currently visible).
        if (firstErrorField) goToIndex(stepIndexForField(firstErrorField, steps));
        return unrendered.length > 0 ? unrendered.join(" ") : null;
      };

      const handleUpgradeOrError = (failure: {
        formError?: string;
        fieldErrors?: Record<string, string | undefined>;
        code?: string;
        reason?: "capacity" | "premium_frame";
      }) => {
        const unrendered = applyFieldErrors(failure.fieldErrors);
        if (failure.code === "UPGRADE_REQUIRED") {
          upgrade.open(
            failure.reason === "premium_frame" || failure.fieldErrors?.frame_style
              ? "premium_frame"
              : "capacity",
          );
          options.onFailure?.("This save needs an upgrade — it wasn't saved.");
          return;
        }
        const message = failure.formError ?? unrendered;
        if (message) {
          setServerError(message);
          toast.error(message);
        }
        options.onFailure?.(
          message ??
            firstErrorMessage(failure.fieldErrors) ??
            "The card couldn't be saved.",
        );
      };

      // A save REQUEST that throws (offline, a 5xx, a stale action id after a
      // deploy) must never escape this transition: React hands it to the
      // error boundary, which unmounts the editor and the unsaved card with
      // it — there is no local draft to come back to (TODO 3b.1).
      const failRequest = (error: unknown) => {
        console.error("[creator] save request failed", error);
        setServerError(SAVE_REQUEST_FAILED);
        toast.error(SAVE_REQUEST_FAILED);
        options.onFailure?.(SAVE_REQUEST_FAILED);
      };

      if (mode === "create" || isRemix) {
        let result: Awaited<ReturnType<typeof createCardAction>>;
        try {
          result = await createCardAction(payload);
        } catch (error) {
          failRequest(error);
          return;
        }
        if (!result.ok) {
          handleUpgradeOrError(result);
          return;
        }
        toast.success(
          finalVisibility === "public"
            ? `Published “${payload.title}”`
            : finalVisibility === "private"
              ? `Saved “${payload.title}” as a draft`
              : `Saved “${payload.title}”`,
        );
        // Every create leaves this page: stop guarding and take the Back
        // sentinel off first, so Back from the saved card doesn't land on a
        // blank /create (TODO 3b.7).
        await guard.release();

        // A deck entry's proxy (/create?deckCard=) or another card's back
        // face (/create?backFor=) is linked on EVERY save — the leave
        // dialog's "Save as draft" included, which used to skip the link —
        // and only then does the flow continue. The card IS saved at this
        // point: a failed link request says so and still moves on.
        let linkedHome: string | null = null;
        if (deckRemix) {
          // Back to the deck dashboard so the progress ring ticks up.
          let linkResult: Awaited<ReturnType<typeof linkDeckCardAction>> | null =
            null;
          try {
            linkResult = await linkDeckCardAction(
              deckRemix.deckCardId,
              result.cardId,
            );
          } catch (error) {
            console.error("[creator] deck link request failed", error);
          }
          if (!linkResult?.ok) {
            toast.error(
              linkResult?.error ?? "Saved, but couldn't link it into the deck.",
            );
          } else {
            toast.success(`Linked into “${deckRemix.deckTitle}”.`);
          }
          linkedHome = `/deck/${deckRemix.deckSlug}`;
        } else if (backForCardId) {
          // Back to the front card's editor.
          let linkResult: Awaited<ReturnType<typeof updateCardAction>> | null =
            null;
          try {
            linkResult = await updateCardAction(backForCardId, {
              back_card_id: result.cardId,
            });
          } catch (error) {
            console.error("[creator] back-face link request failed", error);
          }
          if (!linkResult?.ok) {
            toast.error(
              linkResult?.formError ??
                "Saved, but couldn't link it as the back face.",
            );
          } else {
            toast.success("Linked as the back face.");
          }
          linkedHome = backForSlug
            ? `/card/${backForSlug}/edit?step=publish`
            : "/dashboard";
        }

        if (options.afterSave) {
          options.afterSave();
          return;
        }
        if (linkedHome) {
          router.replace(linkedHome);
          router.refresh();
          return;
        }

        // The user chose "Create a new card" for this card's back — go build it.
        if (createBackAfter) {
          router.push(`/create?backFor=${result.cardId}`);
          return;
        }

        if (intent === "save" && finalVisibility === "public") {
          // A published card's moment of glory: offer the share while the
          // pride is fresh, then land on its public page when the dialog
          // closes. (Without a username we can't build the canonical share
          // URL, so fall back to the plain redirect.)
          if (ownerUsername) {
            promptPostSaveShare({
              title: payload.title,
              cardId: result.cardId,
              cardPath: buildCardPath({ slug: result.slug, owner: { username: ownerUsername } }),
              replace: true,
            });
            return;
          }
          // No username yet → the id-based redirector resolves the page.
          router.replace(`/go/card/${result.cardId}`);
          return;
        }
        // Draft saves stay in the editor, on the same step.
        router.replace(
          `/card/${result.slug}/edit?step=${activeStep?.key ?? "publish"}`,
        );
        router.refresh();
        return;
      }

      // edit
      if (!card?.id) {
        setServerError("Cannot find this card to update.");
        options.onFailure?.("Cannot find this card to update.");
        return;
      }
      // An edit only ever carries the revisable fields — the locked
      // structure never leaves the client (lib/creator/revise.ts).
      let result: Awaited<ReturnType<typeof updateCardAction>>;
      try {
        result = await updateCardAction(card.id, pickRevisablePayload(payload));
      } catch (error) {
        failRequest(error);
        return;
      }
      if (!result.ok) {
        handleUpgradeOrError(result);
        return;
      }
      toast.success("Changes saved.");
      // The saved values become the baseline, keeping the on-screen values;
      // the keyed reset swaps in server truth when the refresh lands. Mark
      // clean only if nothing was typed while the request was in flight —
      // those keystrokes weren't sent, so they stay dirty and guarded, and
      // the keyed reset keeps them (TODO 3b.6).
      const typedDuringSave = !sameFormState(getValues(), values);
      reset(values, { keepValues: true, keepDirty: typedDuringSave });
      // Stop guarding and take the Back sentinel off (TODO 3b.7: Back had
      // to be pressed twice after a save) — unless we stay in the editor
      // with unsent keystrokes, which keep their guard.
      const staysInEditor =
        !options.afterSave &&
        !(intent === "save" && finalVisibility === "public") &&
        !createBackAfter;
      if (!(typedDuringSave && staysInEditor)) await guard.release();
      if (options.afterSave) {
        options.afterSave();
        return;
      }
      if (intent === "save" && finalVisibility === "public") {
        // Only a FIRST publish (private draft → public) earns the share
        // prompt — re-saving an already-public card goes straight to the
        // page, no nagging.
        if (ownerUsername && card.visibility === "private") {
          promptPostSaveShare({
            title: payload.title,
            cardId: card.id,
            cardPath: buildCardPath({ slug: result.slug, owner: { username: ownerUsername } }),
            replace: false,
          });
          return;
        }
        router.push(
          ownerUsername
            ? `/card/${ownerUsername}/${result.slug}`
            : `/go/card/${card.id}`,
        );
        return;
      }
      // The user chose "Create a new card" for the back — go build it now that
      // this (front) card is saved and has an id to link back to.
      if (createBackAfter) {
        router.push(`/create?backFor=${card.id}`);
        return;
      }
      // If the slug changed, follow it.
      if (result.slug !== card.slug) {
        router.replace(`/card/${result.slug}/edit`);
      }
      router.refresh();
    });
  };

  // "Create a new card" for the back: save this card first (so it has an id to
  // link back to), then the submit flow jumps to a fresh creator.
  const handleCreateBackFace = () => {
    void handleSubmit((values) => runSubmit(values, "back"))();
  };

  const cardTypeForPreview =
    watched.card_type === "" ? null : (watched.card_type as CardType);
  const rarityForPreview = watched.rarity === "" ? null : (watched.rarity as Rarity);

  // v2 back face: the referenced card (from myCards) rendered on the flip with
  // its OWN frame/colour/rarity/art. null when none is linked.
  const selectedBackCard = watched.back_card_id
    ? myCards.find((c) => c.id === watched.back_card_id) ?? null
    : null;
  const backCardPreview = selectedBackCard
    ? cardToPreviewData(selectedBackCard, profileOverrides)
    : null;

  // Live structured content for the preview: the row editors drive the
  // chapter rail / loyalty rows as the user types; empty rows fall back to
  // rules_text parsing inside the renderer (same resolution as the bake).
  const liveFaceContent: FaceContent | null = (() => {
    if (kind === "planeswalker") {
      const rows = (watched.loyalty_abilities ?? []).filter((r) =>
        r.text.trim(),
      );
      if (rows.length > 0) {
        return {
          v: 1,
          loyalty: {
            abilities: rows.map((r) => ({
              cost: r.cost.trim() ? r.cost.trim() : null,
              text: r.text.trim(),
            })),
          },
        };
      }
    }
    if (kind === "saga") {
      const chapters = (watched.saga_chapters ?? []).filter(
        (r) => r.text.trim() && r.numerals.length > 0,
      );
      if (chapters.length > 0) {
        return {
          v: 1,
          saga: {
            intro: watched.saga_intro.trim() || null,
            chapters: chapters.map((r) => ({
              numerals: [...r.numerals].sort((a, b) => a - b),
              text: r.text.trim(),
            })),
          },
        };
      }
    }
    return null;
  })();

  // Shared live-preview props for the desktop sticky aside + the mobile inline
  // preview, so they never drift. `previewFace` is state (see the sync effect
  // above); `flipOnClick` makes the card itself a flip target with a hover hint.
  const previewProps = {
    staticInEditor: true,
    pipOverrides,
    profileOverrides,
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
    // Live set-symbol preview (the Set icon step edits these directly).
    setIconUrl: watched.set_icon_url || null,
    // Subscribers preview their DOWNLOADS (owner decision 2026-09-17): no
    // pipglyph.com mark, their own footer mark if set. Free accounts see
    // the public look. The bake/gallery always keep the mark either way.
    brandMark: !isPaid && isBillingEnabled(),
    footerWatermark: isPaid ? watched.footer_text.trim() || null : null,
    setIconCode: watched.set_icon_code || null,
    faceContent: liveFaceContent,
    watermark:
      watched.watermark && watched.watermark.kind !== ""
        ? watched.watermark.kind === "custom"
          ? watched.watermark.url
            ? {
                kind: "custom" as const,
                url: watched.watermark.url,
                size: watched.watermark.size,
                opacity: watched.watermark.opacity ?? undefined,
              }
            : null
          : ({
              kind: watched.watermark.kind,
              key: watched.watermark.key,
              size: watched.watermark.size,
              opacity: watched.watermark.opacity ?? undefined,
            } as CardWatermark)
        : null,
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
    // v2 back face wins over the legacy jsonb when a card is linked.
    backCard: backCardPreview,
    face: previewFace,
    onFaceChange: setPreviewFace,
    flipOnClick: true,
  };

  // ---- Render pieces shared by both layouts ----
  // The step panels, the once-mounted dialogs and the action bar are the
  // same in the shipped stepper and in the lab's canvas layout; only the
  // shell around them differs.
  const fillOverlay = fillPhase ? (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-background/60 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
        {fillPhase === "painting"
          ? "Painting the artwork — this takes about a minute"
          : "Designing your card…"}
      </span>
    </div>
  ) : null;
  const serverErrorBlock = serverError ? (
    <div
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
    >
      {serverError}
    </div>
  ) : null;
  const previewOverlays = (
    <>
      {fillPhase ? (
        <CardGeneratingOverlay
          label={fillPhase === "painting" ? "Painting art…" : "Designing…"}
        />
      ) : null}
      {deckRemixImporting ? (
        <CardGeneratingOverlay label="Importing card…" />
      ) : null}
    </>
  );
  const visibilityNote = (
    <p className="text-xs leading-5 text-muted">
      {isPaid ? (
        <>
          This preview shows your downloads: no pipglyph.com mark
          {watched.footer_text.trim()
            ? ` and your footer mark “${watched.footer_text.trim()}”`
            : ""}
          . The public card keeps the pipglyph.com mark.{" "}
        </>
      ) : null}
      {isEdit ? (
        <>
          Nothing changes until you click Save. Visibility and
          &ldquo;Save as a draft&rdquo; live on the Publish step.
        </>
      ) : (
        <>
          New cards are <strong className="text-foreground">public</strong> by
          default — tick &ldquo;Save as a draft&rdquo; on the Publish step
          to keep it private until it&apos;s ready.
        </>
      )}
    </p>
  );
  const stepPanels = (
    <div className="relative">
      {readOnly ? <GuestGate /> : null}
      {mode !== "edit" && !readOnly ? (
        <CapacityNotice capacity={capacity} adding={1} className="mb-6" />
      ) : null}
      {!readOnly ? <GlyphCoverageNotice values={watched} className="mb-6" /> : null}
      <div
        className={readOnly ? "flex flex-col gap-6 select-none opacity-60" : "flex flex-col gap-6"}
        inert={readOnly || undefined}
      >
            {/* ----- Card setup (step 1 — type, frame & color) ----- */}
            {stepKey === "card" ? (
              <CardSetupPanel
                kind={kind}
                colorIdentity={watched.color_identity}
                verifiedFrameKeys={verifiedFrameKeys}
                onKindSelect={handleKindSelect}
                onColorIdentityChange={handleColorIdentityChange}
                landMode={
                  watched.card_type === "land"
                    ? landBasicKey
                      ? "basic"
                      : "nonbasic"
                    : undefined
                }
                landBasicDisabledReason={
                  pickFrameColorKey(watched.color_identity) === "m"
                    ? "No basic land is multicolor — pick a single frame color first."
                    : null
                }
                onLandModeChange={handleLandModeChange}
              />
            ) : null}

            {/* ----- Identity (name + artwork). The inline-layout frames
                (Adventure/Split/Flip/Aftermath) edit their second face
                inside the Art block's "More options". ----- */}
            {stepKey === "identity" ? (
              <>
                {isRevise ? <LockedSummary mode={mode} /> : null}
                <IdentityPanel revise={isRevise} />
                <ArtPanel
                  userId={userId}
                  secondFaceNameMissing={secondFaceNameMissing}
                  aiSlot={
                    <AiFillButton
                      label="Generate AI artwork and title"
                      disabled={!userId || !aiConfigured || fillPhase !== null}
                      onClick={() => openFill(FILL_PRESETS.artAndTitle)}
                    />
                  }
                  backFaceSlot={
                    hasInlineBackFace(watched.frame_style?.template) ? (
                      <LayoutPanel
                        userId={userId}
                        hasBackFace={watched.has_back_face}
                        isAdventureFrame={isAdventureFrame}
                        backRulesTextRef={backRulesTextRef}
                        onInsertSymbol={(token) =>
                          insertSymbol(backRulesTextRef, token)
                        }
                        onBackFaceAdded={() => setPreviewFace("back")}
                        blankSecondFace={blankSecondFaceFor(kind)}
                      />
                    ) : undefined
                  }
                />
              </>
            ) : null}

            {/* ----- Text & stats panel (cost + rarity, rules/flavor, type-gated
                stats). Cost and rarity moved here from Identity (owner
                decision 2026-09-16). ----- */}
            {stepKey === "text" ? (
              <>
                {!hidesCost(watched.frame_style?.template) ? (
                  <PipsPanel
                    frameTemplate={watched.frame_style?.template}
                    pipOverrides={pipOverrides}
                    frameLocked={isRevise}
                  />
                ) : null}
                <RarityPanel />
                {landBasicKey ? (
                  // Basic lands print a large mana symbol instead of rules
                  // text — so this step is the ICON step: follow the land
                  // type, override with another symbol, or upload your own.
                  <LandIconPanel userId={userId} autoKey={landBasicKey} />
                ) : panelConfig.textVariant === "loyalty" ? (
                  // Planeswalkers: ability rows instead of a raw textarea
                  // (and no flavor text — real walkers never carry it).
                  <LoyaltyAbilitiesEditor />
                ) : panelConfig.textVariant === "saga" ? (
                  // Sagas: intro + chapter rows (flavor hidden — the rail
                  // replaces the text box).
                  <SagaChaptersEditor />
                ) : (
                  <TextPanel
                    rulesTextRef={rulesTextRef}
                    onInsertSymbol={(token) =>
                      insertSymbol(rulesTextRef, token)
                    }
                  />
                )}
                <AbilitiesPanel statVis={statVis} />
                {/* AI last — below the stats. Hidden on basic lands: the
                    step is icon-only there. */}
                {!landBasicKey ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
                    <p className="text-xs leading-5 text-muted">
                      Stuck on the words? The AI writes the rules
                      {hasStats ? `, flavor and ${statsLabel.toLowerCase()}` : " and flavor"}
                      {" "}to fit the rest of the card — the name, type, cost
                      and art stay yours.
                    </p>
                    <AiFillButton
                      label={
                        hasStats
                          ? `Generate rules, flavor & ${statsLabel.toLowerCase()} with AI`
                          : "Generate rules & flavor with AI"
                      }
                      disabled={!userId || !aiConfigured || fillPhase !== null}
                      onClick={() =>
                        openFill(
                          hasStats
                            ? FILL_PRESETS.textStep
                            : FILL_PRESETS.textStep.filter((f) => f !== "stats"),
                        )
                      }
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {/* ----- Set icon panel (the type-line symbol, a direct card field) ----- */}
            {stepKey === "seticon" ? <SetIconPanel userId={userId} /> : null}

            {/* ----- Subscriber step (paid perks for this card; upsell for free) ----- */}
            {stepKey === "subscriber" ? (
              <SubscriberPanel
                userId={userId}
                isPaid={isPaid}
                showWatermark={usesDefaultWatermark(watched.card_type)}
              />
            ) : null}

            {/* ----- Publish panel (visibility/back face + Advanced: finish/tags/save) ----- */}
            {stepKey === "publish" ? (
              <PublishPanel
                userId={userId}
                profileOverrides={profileOverrides}
                activeChallenge={activeChallenge}
                myDecks={isRevise ? null : myDecks}
                myCards={myCards}
                onCreateBackFace={handleCreateBackFace}
                revise={isRevise}
                showWatermark={!usesDefaultWatermark(watched.card_type)}
              />
            ) : null}
      </div>
    </div>
  );
  const dialogs = (
    <>
          {/* Controlled Scryfall import dialog. Rendered once; opened by:
              - the Identity-tab inline trigger (above)
              - the start-with hero on /create (cardforge:open-scryfall)
              Both paths just flip `scryfallOpen` via state or events. */}
          <ScryfallImportDialog
            signedIn={Boolean(userId)}
            onImport={handleScryfallImport}
            verifiedFrameKeys={verifiedFrameKeys}
            open={scryfallOpen}
            onOpenChange={setScryfallOpen}
          />

          {/* Per-field "Generate with AI" — opened by the hero tile, the
              Identity art button and the Text step button, each with its own
              starting tick-set. */}
          <AiFillDialog
            open={aiFillOpen}
            onOpenChange={setAiFillOpen}
            initialFields={fillDefaults}
            revise={isRevise}
            statsLabel={statsLabel}
            statsAvailable={hasStats}
            verifiedFrameKeys={verifiedFrameKeys}
            generating={fillPhase !== null}
            onGenerate={(options) => void handleAiFill(options)}
            myDecks={aiDecks ?? myDecks}
            canDesignForDeck={canDesignForDeck}
          />
          <CardIdeasDialog
            open={ideasOpen}
            onOpenChange={setIdeasOpen}
            onApply={handleAIPatch}
            myDecks={aiDecks ?? myDecks}
            canUseDeckIdeas={canDesignForDeck}
            onBusyChange={setIdeasBusy}
          />

          {/* Kind-change confirmation — only when the current era can't frame
              the requested kind. Cancel = zero changes (the kind chip snaps
              back since kind derives from the untouched form state). */}
          <KindChangeDialog
            message={pendingKindPlan?.message ?? null}
            onConfirm={() => {
              if (pendingKindPlan) applyKindPatch(pendingKindPlan.patch);
              setPendingKindPlan(null);
            }}
            onCancel={() => setPendingKindPlan(null)}
          />

          {/* Leaving with unsaved changes — save as a draft (create/remix)
              or save changes (edit), leave, or stay. */}
          <UnsavedChangesDialog
            open={guard.pending !== null}
            generating={aiBusy}
            saveKind={isEdit ? "changes" : "draft"}
            saveBlockedReason={
              isEdit
                ? saveDisabledReason
                : !watched.title.trim()
                  ? "Add a title first to save it as a draft."
                  : isRemix && reviseUnchanged
                    ? saveDisabledReason
                    : null
            }
            saving={isSubmitting}
            saveError={leaveSaveError}
            onStay={() => {
              setLeaveSaveError(null);
              guard.clearPending();
            }}
            onLeave={() => {
              const pending = guard.pending;
              setLeaveSaveError(null);
              guard.clearPending();
              void guard.release().then(() => pending?.proceed());
            }}
            onSave={() => {
              const pending = guard.pending;
              if (!pending) return;
              setLeaveSaveError(null);
              if (!isEdit) {
                // "Save as draft": force private for this save only.
                setValue("save_as_draft", true, { shouldDirty: true });
                setValue("visibility", "private", { shouldDirty: true });
              }
              // The dialog stays up ("Saving…") until the save lands: only
              // a SUCCESSFUL save clears the pending leave and continues it
              // (TODO 3b.5). Clearing it first closed the dialog before a
              // failed save, which then jumped to a field the user couldn't
              // see — nothing saved, nothing said.
              void handleSubmit(
                (values) =>
                  runSubmit(values, "save", {
                    afterSave: () => {
                      guard.clearPending();
                      pending.proceed();
                    },
                    onFailure: setLeaveSaveError,
                  }),
                (formErrors) => {
                  const first = Object.keys(formErrors)[0];
                  if (first) goToIndex(stepIndexForField(first, steps));
                  setLeaveSaveError(
                    `Not saved: ${firstErrorMessage(formErrors) ?? "fix the highlighted field first."}`,
                  );
                },
              )();
            }}
          />

          {/* Post-publish share prompt — the "look what I made" moment. The
              live preview stays visible behind the dialog; closing it (Esc,
              ✕, overlay, or after sharing) continues to the public page.
              Only renders client-side after a successful publish, so reading
              window.location here is safe. */}
          {postSaveShare ? (
            <ShareTargets
              open
              onOpenChange={(nextOpen) => {
                if (nextOpen) return;
                const { cardPath, replace } = postSaveShare;
                setPostSaveShare(null);
                if (replace) router.replace(cardPath);
                else router.push(cardPath);
              }}
              title={postSaveShare.title}
              url={`${window.location.origin}${postSaveShare.cardPath}`}
              entity="card"
              itemId={postSaveShare.cardId}
              imageUrl={`${window.location.origin}/api/cards/${postSaveShare.cardId}/og`}
              heading="Your card is live"
              description={`“${postSaveShare.title}” is published. Share it while the forge is still warm — the buttons only prefill; nothing posts without you.`}
            />
          ) : null}

    </>
  );
  const actionBar = (
    <>
          {/* Action bar — sticky across all tabs so saving never requires
              switching back to a "publishing" tab. */}
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-2 border-t border-border/50 bg-surface/95 px-6 py-4 backdrop-blur-sm">
            {userId && saveDisabledReason ? (
              <p
                role="status"
                className="text-xs leading-5 text-gold"
              >
                {saveDisabledReason}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {isDirty ? (
                <Badge variant="accent" className="gap-1.5">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  Unsaved changes
                </Badge>
              ) : (
                <Badge variant="default">
                  {mode === "create" ? "Not saved yet" : "Up to date"}
                </Badge>
              )}
              {remixSource ? (
                <Badge variant="primary" className="gap-1.5">
                  Based on{" "}
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
              {remixSource ? <CardGlossary /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Save — available from ANY step (no more end-of-stepper
                  gate). Disabled until the card has a title + artwork (a
                  draft needs only the title), or while a deck-remix import
                  sits unaltered (an exact copy is the real card, not a
                  custom proxy). Guests get the sign-in path instead. */}
              {/* Start over (create) / Reset (edit + remix, once something
                  changed) — the dialog itself guards against a stray click. */}
              {!readOnly && (mode === "create" || isDirty) ? (
                <StartOverDialog
                  onConfirm={handleStartOver}
                  variant={mode === "create" ? "create" : "revert"}
                />
              ) : null}
              {/* Main controls, in fixed order: Cancel · Save · Back · Next
                  · Delete. */}
              {/* Cancel is edit-only — create mode has Start over, and a
                  bail-out just means navigating away. */}
              {isRevise && card ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/go/card/${card.id}`}>Cancel</Link>
                </Button>
              ) : null}
              {!userId ? (
                <Button asChild size="sm">
                  <Link href="/signup?redirectTo=/create" data-no-guard>
                    <Lock className="h-4 w-4" aria-hidden />
                    Sign up free to forge
                  </Link>
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting || Boolean(saveDisabledReason)}
                  title={saveDisabledReason ?? undefined}
                >
                  {isSubmitting ? (
                    <>
                      <Wand2 className="h-4 w-4 animate-pulse" aria-hidden />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" aria-hidden />
                      Save
                    </>
                  )}
                </Button>
              )}
              {idx > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </Button>
              ) : null}
              {!isLastStep ? (
                <Button type="button" size="sm" onClick={goNext}>
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
              {isEdit && card ? (
                <DeleteCardDialog
                  cardId={card.id}
                  cardTitle={card.title}
                  redirectTo="/dashboard/cards"
                  triggerLabel={null}
                  triggerSize="sm"
                />
              ) : null}
            </div>
            </div>
          </div>
    </>
  );

  const formSubmit = handleSubmit(
    (values) => runSubmit(values, "save"),
    (formErrors) => {
      // Client validation blocked the save — jump to the first errored step.
      const first = Object.keys(formErrors)[0];
      if (first) goToIndex(stepIndexForField(first, steps));
    },
  );

  if (layout === "canvas") {
    // ---- Lab: the canvas layout. The live card is the page; clicking a
    // region opens that field's panel beside it (below it on phones). Same
    // form state, panels, dialogs, save rules and AI as the stepper.
    return (
      <FormProvider {...methods}>
        <form
          noValidate
          onSubmit={formSubmit}
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start"
          data-testid="creator-canvas"
        >
          <div className="flex flex-col items-center gap-5 lg:sticky lg:top-24">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Live preview · click a part of the card to edit it
            </p>
            <div className="relative w-full max-w-md">
              <CardPreview {...previewProps} flipOnClick={false} />
              {previewOverlays}
              {readOnly ? null : (
                <CanvasHotspots
                  active={stepKey}
                  revise={isRevise}
                  hasStats={hasStats}
                  onPick={goToStepKey}
                />
              )}
            </div>
            <Stepper
              steps={stepperSteps}
              current={idx}
              onStepSelect={goToIndex}
              isStepEnabled={() => true}
              className="w-full max-w-md"
            />
            <div className="max-w-md">{visibilityNote}</div>
          </div>

          <SurfaceCard
            className="relative flex flex-col gap-6 p-6"
            aria-busy={fillPhase !== null || undefined}
          >
            {fillOverlay}
            {serverErrorBlock}
            {stepPanels}
            {dialogs}
            {actionBar}
          </SurfaceCard>
        </form>
      </FormProvider>
    );
  }

  return (
    <FormProvider {...methods}>
      <form
        noValidate
        onSubmit={formSubmit}
        className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] xl:grid-cols-[10.5rem_minmax(0,1.05fr)_minmax(0,0.95fr)] xl:gap-6"
      >
        {/* ----- Far left (xl+): vertical icon step rail ----- */}
        <StepRail
          steps={stepperSteps}
          current={idx}
          onStepSelect={goToIndex}
          isStepEnabled={() => true}
          icons={STEP_RAIL_ICONS}
          className="hidden xl:sticky xl:top-24 xl:block xl:self-start"
        />

        {/* ----- Left: form ----- */}
        <SurfaceCard
          className="relative flex flex-col gap-6 p-6"
          aria-busy={fillPhase !== null || undefined}
        >
          {fillOverlay}
          {serverErrorBlock}

          <div className="flex flex-col gap-6">
            <Stepper
              steps={stepperSteps}
              current={idx}
              onStepSelect={goToIndex}
              isStepEnabled={() => true}
              className="xl:hidden"
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
                <div className="relative">
                  <CardPreview {...previewProps} />
                  {previewOverlays}
                </div>
              </div>
            </details>

            {stepPanels}
          </div>

          {dialogs}
          {actionBar}
        </SurfaceCard>

        {/* ----- Right: live preview (desktop; mobile uses the inline
            <details> preview above the step content) ----- */}
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Live preview
            </p>
            <div className="mx-auto w-full max-w-sm">
              <div className="relative">
                <CardPreview {...previewProps} />
                {previewOverlays}
              </div>
            </div>
            {visibilityNote}
          </div>
        </aside>
      </form>
    </FormProvider>
  );
}

// The sign-up gate over the guest creator's panels: the form stays visible
// (and the steps browsable) behind it, but nothing is interactive.
function GuestGate() {
  return (
    <div
      className="absolute inset-0 z-10 flex items-start justify-center pt-10"
      data-testid="guest-gate"
    >
      <div className="sticky top-28 flex max-w-sm flex-col items-center gap-3 rounded-xl border border-primary/40 bg-surface/95 px-6 py-5 text-center shadow-xl backdrop-blur-sm">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary-bright">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-display text-lg font-semibold text-foreground">
          Sign up free to start forging
        </p>
        <p className="text-sm leading-6 text-muted">
          Every card type, three decades of frames, a live preview and AI
          that writes and paints on demand. Your cards save to your account
          and go wherever you do.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button asChild size="sm">
            <Link href="/signup?redirectTo=/create" data-no-guard>
              Create a free account
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/login?redirectTo=/create" data-no-guard>
              Sign in
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// The two in-form AI entry points (Identity art slot, Text step) — one
// credit each; the price tag only shows when billing is on.
function AiFillButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="border-accent/50 text-foreground hover:border-accent"
    >
      <Sparkles className="h-4 w-4 text-accent" aria-hidden />
      {label}
      {isBillingEnabled() ? (
        <span className="ml-1 rounded-full bg-gold/15 px-1.5 py-px text-[10px] font-semibold text-gold-strong">
          1 credit
        </span>
      ) : null}
    </Button>
  );
}

// Spinner overlay shown on the live preview while an AI fill is running, so
// it's clear the card is being (re)built.
function CardGeneratingOverlay({ label = "Forging…" }: { label?: string }) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[5%] bg-background/70 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="h-8 w-8 animate-spin text-primary-bright"
        aria-hidden
      />
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
    </div>
  );
}
