import { Asterisk, Coins, Gamepad2, Gem, Layers, LibraryBig, Palette, ScrollText, Sparkles, type LucideIcon } from "lucide-react";
import type { ToolIconKey } from "@/lib/tools/catalog";

// One icon per beta tool (lib/tools/catalog.ts keeps the key, so the
// catalog stays plain data). Shared by the hub, the admin pages and the
// tool shell.
export const TOOL_ICONS: Record<ToolIconKey, LucideIcon> = {
  collection: LibraryBig,
  tokens: Coins,
  pip: Sparkles,
  "set-symbol": Gem,
  customize: Layers,
  play: Gamepad2,
  "table-sheet": ScrollText,
  reart: Palette,
  symbol: Asterisk,
};
