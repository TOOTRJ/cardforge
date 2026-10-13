import { describe, expect, it } from "vitest";
import { ownCardRemixFrame, remixCreditsOf } from "@/lib/ai/remix-mechanics";
import { applyRemixNames } from "@/lib/ai/remix-names";
import { newCardFrameStyle, storedAnatomyOf } from "@/lib/cards/anatomy";
import { templateHasBackFace } from "@/lib/cards/dfc";
import {
  dfcBackArtMissing,
  dfcFrontColorError,
  dfcFrontTypeError,
  resolveDfcBackFace,
  type DfcBackFacePayload,
} from "@/lib/cards/dfc-gate";
import { withEmblemShape } from "@/lib/cards/emblem";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { FRAME_COLOR_KEYS, frameComboKey } from "@/lib/cards/frame-reference-registry";
import { missingSecondFaceName } from "@/lib/cards/second-face-name";
import { autoTokenTextBoxFrame } from "@/lib/creator/frame-resolve";
import { createCardSchema } from "@/lib/validation/card";
import {
  CARD_TYPE_VALUES,
  FRAME_TEMPLATE_VALUES,
  frameStyleRequiresPremium,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FrameTemplate,
} from "@/types/card";

// ---------------------------------------------------------------------------
// The independent check of the own-card deck remix (PR #533): whatever
// ownCardRemixFrame KEEPS must be a card createCardAction saves — the art is
// paid for by then. This sweeps every current template × card type × colour
// × type words × back-face shape with every combo published, builds the
// payload the step builds (the names applied, the token's height followed,
// a double-faced back with its new picture) and runs it through the save's
// schema and every pure gate in the save's own order. A kept frame the save
// would refuse is a failure; so is a kept card the save would store PRIVATE
// (a public remix), or a price that disagrees with the pictures.
// ---------------------------------------------------------------------------

const EVERYTHING = new Set(
  FRAME_TEMPLATE_VALUES.flatMap((template) =>
    FRAME_COLOR_KEYS.map((key) => frameComboKey(template as FrameTemplate, key)),
  ),
);

const COLOURS: ColorIdentity[][] = [
  ["white"],
  ["red"],
  ["white", "blue"],
  ["colorless"],
  ["white", "blue", "black"],
];

const TYPE_WORDS: { supertype: string | null; subtypes: string[]; title: string }[] = [
  { supertype: null, subtypes: [], title: "Kesh, Emberforge Warden" },
  { supertype: "Legendary", subtypes: ["Vehicle"], title: "Rustwing Skiff" },
  { supertype: "Artifact", subtypes: ["Golem"], title: "Brass Sentry" },
  { supertype: "Basic", subtypes: ["Plains"], title: "Plains" },
  { supertype: "Basic", subtypes: [], title: "Wastes" },
  { supertype: "Creature", subtypes: ["Goblin"], title: "Goblin" },
];

const ART = "https://example.supabase.co/storage/v1/object/public/card-art/u/x.png";

const BACKS: (Record<string, unknown> | null)[] = [
  null,
  { title: "Moonrage Brute", card_type: "creature", subtypes: ["Werewolf"], power: "3", toughness: "3" },
  { title: "Moonrage Brute", card_type: "creature", art_url: ART, artist_credit: "Someone", art_position: { x: 0, y: 0, zoom: 1 } },
  { title: "Hidden Grotto", card_type: "land", rules_text: "{T}: Add {G}." },
  { title: "Chandra Reborn", card_type: "planeswalker", loyalty: "4" },
  { title: "Stomp", cost: "{1}{R}", card_type: "instant", rules_text: "Stomp deals 2 damage to any target.", flavor_text: "Loud." },
  { title: "Relic Engine", card_type: "artifact", supertype: "Artifact", color_identity: ["colorless"] },
  { title: "Moonrage Brute", card_type: "creature", frame_style: { template: "m15dfcbackleft" }, color_identity: ["red"] },
  { title: "", card_type: "sorcery" },
  { title: "Ice", cost: "{1}{U}", card_type: "instant", printed_types: "Instant", loyalty: "3", defense: "2" },
];

const STYLES: Record<string, unknown>[] = [
  {},
  { dfcIcon: "sunmoon", crown: false, border: "white", rulesAlign: "center", stamp: "auto", collector: "2015", star: true },
  { finish: "foil", twoColor: true },
];

type Refusal = { why: string; template: string; cardType: string; colours: string; words: string; back: string };

describe("an own card's kept frame is always a card the save accepts", () => {
  it("every template × type × colour × type words × back face, every combo published", { timeout: 60_000 }, () => {
    const refusals: Refusal[] = [];
    let kept = 0;
    let keptDouble = 0;
    let fellBack = 0;
    let walked = 0;

    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const cardType of CARD_TYPE_VALUES) {
        for (const colours of COLOURS) {
          for (const words of TYPE_WORDS) {
            for (const back of BACKS) {
              {
                // The switches don't decide the frame: one stored style a
                // source, in turn, keeps the sweep inside a unit test's time.
                const style = STYLES[walked++ % STYLES.length]!;
                for (const singleFace of [false, true]) {
                  const source = {
                    title: words.title,
                    card_type: cardType as CardType,
                    supertype: words.supertype,
                    subtypes: words.subtypes,
                    color_identity: colours,
                    rules_text: `${words.title} enters tapped.`,
                    frame_style: { template, ...style },
                    back_face: back as CardBackFace | null,
                  };
                  const frame = ownCardRemixFrame(source as never, EVERYTHING, { singleFace });
                  const credits = remixCreditsOf(frame);
                  const note = (why: string) =>
                    refusals.push({
                      why,
                      template,
                      cardType,
                      colours: colours.join("+"),
                      words: `${words.supertype ?? ""}/${words.subtypes.join(" ")}/${words.title}`,
                      back: JSON.stringify(back),
                    });

                  // The price is the pictures: two only for both faces.
                  if (singleFace && credits !== 1) note("a one-credit plan priced two");
                  if (frame.back_face && !frame.frame_template) note("a back without a kept frame");
                  if (!frame.frame_template) {
                    fellBack += 1;
                    continue;
                  }
                  kept += 1;
                  if (credits === 2) keptDouble += 1;

                  // ---- The step, from the naming on ----
                  const named = applyRemixNames(
                    { title: source.title, supertype: source.supertype, rules_text: source.rules_text, back_face: frame.back_face },
                    { title: "Remixed Name", second_title: frame.back_face ? "Remixed Other" : null, second_flavor_text: "Other flavour." },
                  );
                  if (!named.ok) {
                    // Refused before the art: a refund, never a paid picture.
                    continue;
                  }
                  let landed: string | undefined = frame.frame_template;
                  if (
                    !frame.back_face &&
                    frameKindGateError(
                      landed,
                      cardFieldsFace({ ...source, title: named.title, rules_text: named.rules_text }),
                    ) !== null
                  ) {
                    landed = undefined;
                  }
                  // A fallen-back card is the landing it had before the change.
                  if (!landed) continue;
                  const doubleFaced = Boolean(named.back_face) && templateHasBackFace(landed);
                  if (doubleFaced !== (credits === 2)) note("the pictures disagree with the price");
                  const frameTemplate = autoTokenTextBoxFrame({
                    template: landed as FrameTemplate,
                    cardType: source.card_type,
                    supertype: source.supertype,
                    subtypes: source.subtypes,
                    rulesText: named.rules_text,
                    flavorText: "New flavour.",
                    colorIdentity: colours,
                    verifiedKeys: EVERYTHING,
                  });
                  const payload = {
                    title: named.title,
                    game_system_id: "33333333-3333-4333-8333-333333333333",
                    color_identity: colours,
                    supertype: source.supertype ?? undefined,
                    card_type: source.card_type,
                    subtypes: source.subtypes,
                    rules_text: named.rules_text,
                    flavor_text: "New flavour.",
                    art_url: ART,
                    frame_style: { template: frameTemplate, ...storedAnatomyOf(source.frame_style) },
                    back_face: named.back_face
                      ? { ...named.back_face, ...(doubleFaced ? { art_url: ART } : {}) }
                      : named.back_face,
                    parent_card_id: "22222222-2222-4222-8222-222222222222",
                    visibility: "public",
                  };

                  // ---- createCardAction, in its order ----
                  const parsed = createCardSchema.safeParse(payload);
                  if (!parsed.success) {
                    note(`schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
                    continue;
                  }
                  const data = withEmblemShape(parsed.data);
                  const gate = frameGateError(data.frame_style?.template, data.color_identity, EVERYTHING);
                  if (gate) note(`frame gate: ${gate}`);
                  const kind = frameKindGateError(data.frame_style?.template, cardFieldsFace(data));
                  if (kind) note(`kind gate: ${kind}`);
                  if (dfcBackArtMissing(data.frame_style?.template, data.back_face as DfcBackFacePayload)) {
                    note("stored private: the back has no art");
                  }
                  if (missingSecondFaceName(data.back_face, "public")) note("second face unnamed");
                  const stored = newCardFrameStyle(data.frame_style ?? {}, data.card_type);
                  const frontType = dfcFrontTypeError(stored.template, data.card_type);
                  if (frontType) note(`front type: ${frontType}`);
                  const frontColour = dfcFrontColorError(
                    stored.template,
                    { cardType: data.card_type, supertype: data.supertype },
                    data.color_identity,
                  );
                  if (frontColour) note(`front colour: ${frontColour}`);
                  const backGate = resolveDfcBackFace({
                    frontTemplate: stored.template,
                    back: data.back_face as DfcBackFacePayload | null | undefined,
                    family: (stored as { dfcIcon?: string }).dfcIcon,
                    frontColorIdentity: data.color_identity,
                    verifiedKeys: EVERYTHING,
                  });
                  if (!backGate.ok) note(`back gate: ${backGate.message}`);
                  if (frameStyleRequiresPremium(data.frame_style)) note("premium frame or finish");
                }
              }
            }
          }
        }
      }
    }

    // The sweep must have walked both outcomes, the two-credit one included.
    expect(kept).toBeGreaterThan(1000);
    expect(keptDouble).toBeGreaterThan(10);
    expect(fellBack).toBeGreaterThan(1000);
    const distinct = new Map<string, Refusal>();
    for (const refusal of refusals) {
      const key = `${refusal.why}|${refusal.template}|${refusal.cardType}`;
      if (!distinct.has(key)) distinct.set(key, refusal);
    }
    expect([...distinct.values()].slice(0, 40)).toEqual([]);
  });
});
