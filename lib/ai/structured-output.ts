// ---------------------------------------------------------------------------
// Structured output (generateObject) — the guard every text call shares.
//
// WHY: the model is asked for JSON in a zod schema's shape, but the provider
// only ENFORCES part of that schema. Anthropic's structured outputs (the
// design / judge models, through the AI Gateway) do not support minLength,
// maxLength, maxItems or a minItems above 1 — they are stripped before the
// model sees the schema, and on a route without native structured output
// (a gateway fallback provider) nothing at all is enforced. The AI SDK then
// validates the answer with the FULL zod schema, and a single field outside
// it fails the whole call with `NoObjectGeneratedError` ("No object
// generated: response did not match schema.") — an empty rules text on a
// vanilla creature, a land's cost left "", a tenth tag, "Artifact" for
// "artifact", a key the schema doesn't know.
//
// THE GUARD, per call (`structuredCall`):
//   1. `experimental_repairText` — when the answer fails, the zod issues are
//      repaired WHERE A MACHINE CAN without inventing content (unknown keys
//      dropped, an enum matched without case, a too-long string or list cut
//      to its limit, a missing nullable field set to null, plus a call's own
//      `fixup`), then validated again by the SDK with the SAME schema.
//   2. Still failing → the issues and a truncated model text are logged
//      server-side, and the call is made ONCE more.
//   3. Failing again → `AiOutputError`, whose message is plain words for the
//      client (never the SDK's text or a zod path).
// A successful answer never reaches the repair: what a call returns, and so
// what a job saves and charges, is unchanged. The schema the model is sent is
// unchanged too (the repair lives beside it, never in it).
//
// No runtime import from "ai": unit tests mock that module with only
// `generateObject`, and the SDK's errors are recognised by their names.
// ---------------------------------------------------------------------------

import type { z } from "zod";

/** The one thing a client is told when the model's answer can't be read. */
export const AI_OUTPUT_ERROR_MESSAGE =
  "The AI's answer came back in a shape we couldn't use. Please try again — a failed attempt is never charged.";

/** The model answered twice and neither answer fitted the schema. */
export class AiOutputError extends Error {
  readonly code = "AI_OUTPUT_UNREADABLE" as const;
  constructor(readonly label: string) {
    super(AI_OUTPUT_ERROR_MESSAGE);
    this.name = "AiOutputError";
  }
}

type SdkError = Error & { text?: string; finishReason?: string; cause?: unknown };

/** The SDK's NoObjectGeneratedError (any of its messages: unparsable JSON,
 *  a schema mismatch, no text at all). */
export function isNoObjectGeneratedError(error: unknown): error is SdkError {
  return error instanceof Error && error.name === "AI_NoObjectGeneratedError";
}

type Issue = {
  code?: string;
  path?: PropertyKey[];
  message?: string;
  keys?: string[];
  values?: unknown[];
  maximum?: number | bigint;
  minimum?: number | bigint;
  origin?: string;
  expected?: string;
};

/** The zod issues inside an SDK error chain (NoObjectGenerated → TypeValidation
 *  → ZodError), else []. */
export function zodIssuesOf(error: unknown): Issue[] {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const issues = (current as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues as Issue[];
    current = (current as { cause?: unknown }).cause;
  }
  return [];
}

const LOG_TEXT_MAX = 2000;

/** Server-side record of a failed structured answer: which call, the zod
 *  issues (path · code · message) and the first 2000 characters of what the
 *  model wrote. Never sent to the client. */
export function logStructuredFailure(label: string, error: unknown, attempt: number): void {
  const sdk = error as SdkError;
  const issues = zodIssuesOf(error).map((issue) => ({
    path: (issue.path ?? []).map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
  console.error(
    `[ai:structured] ${label} attempt ${attempt}: ${sdk?.message ?? String(error)}`,
    JSON.stringify({
      finishReason: sdk?.finishReason ?? null,
      issues,
      cause: issues.length === 0 && sdk?.cause instanceof Error ? sdk.cause.message : undefined,
      text: typeof sdk?.text === "string" ? sdk.text.slice(0, LOG_TEXT_MAX) : null,
      textLength: typeof sdk?.text === "string" ? sdk.text.length : null,
    }),
  );
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/** The JSON value in a model's text: the text itself, or the outermost
 *  object / array inside a ``` fence or prose. Null when none parses. */
export function extractJson(text: string): unknown {
  const attempts = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) attempts.push(fenced[1].trim());
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next
    }
  }
  return null;
}

type Container = Record<string, unknown> | unknown[];

function parentOf(root: unknown, path: PropertyKey[]): { parent: Container; key: PropertyKey } | null {
  if (path.length === 0) return null;
  let node: unknown = root;
  for (const step of path.slice(0, -1)) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<PropertyKey, unknown>)[step as string];
  }
  if (node === null || typeof node !== "object") return null;
  return { parent: node as Container, key: path[path.length - 1] };
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let node: unknown = root;
  for (const step of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PropertyKey, unknown>)[step as string];
  }
  return node;
}

function setAt(root: unknown, path: PropertyKey[], value: unknown): boolean {
  const at = parentOf(root, path);
  if (!at) return false;
  (at.parent as Record<PropertyKey, unknown>)[at.key as string] = value;
  return true;
}

const fold = (value: string) => value.trim().toLowerCase().replace(/colour/g, "color");

/** One generic repair of one issue, in place. True when it changed something. */
function repairIssue(root: unknown, issue: Issue, tried: Set<string>): boolean {
  const path = issue.path ?? [];
  const key = `${issue.code}:${path.map(String).join(".")}`;
  switch (issue.code) {
    case "unrecognized_keys": {
      const node = path.length === 0 ? root : valueAt(root, path);
      if (!node || typeof node !== "object" || Array.isArray(node)) return false;
      let changed = false;
      for (const name of issue.keys ?? []) {
        if (name in node) {
          delete (node as Record<string, unknown>)[name];
          changed = true;
        }
      }
      return changed;
    }
    case "invalid_value": {
      const value = valueAt(root, path);
      if (typeof value !== "string" || !Array.isArray(issue.values)) return false;
      const match = issue.values.find((option) => typeof option === "string" && fold(option) === fold(value));
      return match !== undefined && match !== value ? setAt(root, path, match) : false;
    }
    case "too_big": {
      const value = valueAt(root, path);
      const max = Number(issue.maximum);
      if (!Number.isFinite(max)) return false;
      if (typeof value === "string" && value.length > max) return setAt(root, path, value.slice(0, max).trimEnd());
      if (Array.isArray(value) && value.length > max) return setAt(root, path, value.slice(0, max));
      return false;
    }
    case "invalid_type": {
      // A field the model left out that may be null: null (tried once — a
      // field that refuses null keeps its issue and the repair gives up).
      if (valueAt(root, path) !== undefined || tried.has(key)) return false;
      tried.add(key);
      return setAt(root, path, null);
    }
    default:
      return false;
  }
}

export type StructuredFixup = (root: unknown) => unknown;

/**
 * The `experimental_repairText` for `schema`: the model's text → a repaired
 * JSON text, or null when nothing a machine may change makes it fit. The SDK
 * validates the result with the same schema, so a "repair" can never let a
 * wrong shape through. `fixup` is a call's own knowledge (a land's empty
 * cost is "—"); it runs first and must never invent content.
 */
export function repairStructuredText(schema: z.ZodType, fixup?: StructuredFixup) {
  return async ({ text }: { text: string; error?: unknown }): Promise<string | null> => {
    let root = extractJson(text);
    if (root === null) return null;
    if (fixup) root = fixup(root);
    const tried = new Set<string>();
    for (let pass = 0; pass < 8; pass += 1) {
      const result = schema.safeParse(root);
      if (result.success) return JSON.stringify(root);
      let changed = false;
      for (const issue of result.error.issues as Issue[]) {
        if (repairIssue(root, issue, tried)) changed = true;
      }
      if (!changed) return null;
    }
    return schema.safeParse(root).success ? JSON.stringify(root) : null;
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * Run one structured-output call with the guard: `run` receives the repair
 * to pass as `experimental_repairText` and makes the generateObject call.
 * A NoObjectGeneratedError is logged and the call made once more (`attempts:
 * 1` where a second call would overrun a step's time budget); the last one
 * throws `AiOutputError`. Any other error is rethrown untouched.
 */
export async function structuredCall<T>(
  label: string,
  repair: ReturnType<typeof repairStructuredText>,
  run: (repair: ReturnType<typeof repairStructuredText>) => Promise<T>,
  { attempts = 2 }: { attempts?: 1 | 2 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run(repair);
    } catch (error) {
      if (!isNoObjectGeneratedError(error)) throw error;
      logStructuredFailure(label, error, attempt);
      if (attempt >= attempts) throw new AiOutputError(label);
    }
  }
}

/** What a client is shown for an AI error: the plain message for an
 *  unreadable answer, else `fallback(message)` (the caller's own wording). */
export function aiErrorMessage(error: unknown, fallback: (message: string) => string, generic: string): string {
  if (error instanceof AiOutputError) return error.message;
  if (isNoObjectGeneratedError(error)) return AI_OUTPUT_ERROR_MESSAGE;
  return fallback(error instanceof Error ? error.message : generic);
}
