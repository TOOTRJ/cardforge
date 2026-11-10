import type { ChipOption } from "@/components/ui/chip-group";
import { ColorPip } from "@/components/cards/color-pip";
import type { CollectionColour } from "@/lib/tools/collection/queries";

/** The Collection Deck Builder's colour filter chips (My collection and the
 *  commander list): a card or commander matches when its colour identity
 *  holds any picked colour, or has none when Colourless is picked. */
export const COLOUR_OPTIONS: ChipOption<CollectionColour>[] = [
  { value: "W", label: "White", leading: <ColorPip color="W" size={16} decorative /> },
  { value: "U", label: "Blue", leading: <ColorPip color="U" size={16} decorative /> },
  { value: "B", label: "Black", leading: <ColorPip color="B" size={16} decorative /> },
  { value: "R", label: "Red", leading: <ColorPip color="R" size={16} decorative /> },
  { value: "G", label: "Green", leading: <ColorPip color="G" size={16} decorative /> },
  { value: "C", label: "Colourless", leading: <ColorPip color="C" size={16} decorative /> },
];

/** The same rule as the collection query's colour filter. */
export function identityMatchesColours(identity: readonly string[], colours: readonly CollectionColour[]): boolean {
  if (colours.length === 0) return true;
  if (colours.includes("C") && identity.length === 0) return true;
  return colours.some((c) => c !== "C" && identity.includes(c));
}
