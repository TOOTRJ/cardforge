/** First value of a Next.js `searchParams` entry (`string | string[] |
 *  undefined`): a repeated key keeps its first value, an absent key is null. */
export function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
