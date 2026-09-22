/** Tags are lowercase words with spaces or hyphens (lib/validation/card.ts);
 *  the hub URL form swaps spaces for hyphens (see lib/cards/hubs.ts). Plain
 *  module so client components can link to hubs without server imports. */
export function tagSlug(tag: string): string {
  return tag.trim().replace(/\s+/g, "-");
}
