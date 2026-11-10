import { z } from "zod";
import { isUuid } from "@/lib/ids";
import { DEFAULT_BASIC_PRINTINGS, type BasicLandName } from "./builder";
import { COLLECTION_DECK_TYPE_IDS } from "./archetypes";
import { IMPORT_CHUNK_LINES, MAX_COLLECTION_QUANTITY, COMMANDER_DECK_SIZE } from "./limits";
import { COLLECTION_FINISHES } from "./parse-import";

// ---------------------------------------------------------------------------
// What the Collection Deck Builder's actions accept from the browser. The
// browser parsed the file (parse-import.ts); the server takes nothing on
// trust but the shapes below — every card it stores is Scryfall's answer.
// ---------------------------------------------------------------------------

const uuid = z.string().refine(isUuid, "Invalid id.");
const finish = z.enum(["nonfoil", "foil", "etched"] satisfies typeof COLLECTION_FINISHES[number][]);

export const importLineSchema = z.object({
  line: z.number().int().min(1).max(10_000_000),
  raw: z.string().max(300),
  name: z.string().trim().min(1).max(200),
  setCode: z.string().regex(/^[a-z0-9]{2,6}$/).nullable(),
  collectorNumber: z.string().regex(/^[A-Za-z0-9★†\-.]{1,12}$/).nullable(),
  scryfallId: uuid.nullable(),
  quantity: z.number().int().min(1).max(MAX_COLLECTION_QUANTITY),
  finish,
  lang: z.string().regex(/^[a-z]{2,3}$/),
});

export const importChunkSchema = z.object({
  batchId: uuid,
  mode: z.enum(["add", "replace"]),
  // The chunk's index in its import: (batch, chunk) is written once.
  chunk: z.number().int().min(0).max(100_000),
  lines: z.array(importLineSchema).min(1).max(IMPORT_CHUNK_LINES),
});

export const finishImportSchema = z.object({
  batchId: uuid,
  mode: z.enum(["add", "replace"]),
  format: z.string().max(20),
  lines: z.number().int().min(0).max(1_000_000),
  matched: z.number().int().min(0).max(1_000_000),
  unmatched: z.number().int().min(0).max(1_000_000),
  // Every line of the file was sent and none was refused as over the cap.
  // A "replace" removes the old rows only then: an import cut short (the
  // collection full, a stop) never takes away cards the file still holds.
  complete: z.boolean().default(false),
});

export const addCardSchema = z.object({
  scryfallId: uuid,
  quantity: z.number().int().min(1).max(MAX_COLLECTION_QUANTITY).default(1),
  finish: finish.default("nonfoil"),
  surface: z.enum(["tool", "creator"]).default("tool"),
});

export const updateQuantitySchema = z.object({
  id: uuid,
  quantity: z.number().int().min(1).max(MAX_COLLECTION_QUANTITY),
});

export const removeCardSchema = z.object({ id: uuid });

export const clearCollectionSchema = z.object({ confirm: z.literal("clear") });

/** A deck type, a creature type, a bracket — what a draft is built around
 *  (all optional; lib/tools/collection/archetypes.ts). */
const choiceFields = {
  deckType: z.enum(COLLECTION_DECK_TYPE_IDS).nullish(),
  tribe: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z'-]{1,29}$/, "That isn't a creature type.")
    .nullish(),
  bracket: z.number().int().min(1).max(5).nullish(),
};

export const draftSchema = z.object({ commanderId: uuid, ...choiceFields });

const BASIC_NAMES = Object.keys(DEFAULT_BASIC_PRINTINGS) as [BasicLandName, ...BasicLandName[]];

export const saveDeckSchema = z.object({
  commanderId: uuid,
  cardIds: z.array(uuid).max(COMMANDER_DECK_SIZE - 1),
  basics: z
    .array(z.object({ name: z.enum(BASIC_NAMES), count: z.number().int().min(1).max(COMMANDER_DECK_SIZE - 1) }))
    .max(BASIC_NAMES.length),
  title: z.string().trim().min(1, "Give the deck a name.").max(80, "Deck names are 80 characters or fewer."),
  visibility: z.enum(["private", "unlisted", "public"]),
  // A press after one that failed or got no answer: its deck, made in the
  // last minute, is taken back instead of a second one.
  retry: z.boolean().default(false),
  ...choiceFields,
});
