import { describe, expect, it } from "vitest";
import { PRIVATE_CARD_NAME, hidesEntryName, isPrivateForViewer, publicDeckItems, publicDeckWarning } from "@/lib/decks/private-card-name";

// ---------------------------------------------------------------------------
// A public deck's view of a card the strong-language rule kept private
// (owner 2026-10-28): the entry's own copy of the name is not shown to
// anyone but the owner — narrowly: only an entry linking a card the viewer
// can't read whose name or type line holds strong language. Ordinary
// private cards and printings are as before. ROT13'd: the repo is public.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const STRONG = rot13("fuvg");

const entry = (name: string, overrides: Record<string, unknown> = {}) => ({
  id: "e-1",
  card_id: "c-1",
  name,
  type_line: "Creature — Goblin",
  quantity: 1,
  ...overrides,
});

describe("publicDeckItems", () => {
  it("hides an unreadable card's name with strong language from a viewer", () => {
    const [item] = publicDeckItems([{ entry: entry(`${STRONG} Goblin`), card: null }], false);
    expect(item.entry.name).toBe(PRIVATE_CARD_NAME);
    expect(item.entry.type_line).toBeNull();
    expect(item.entry.quantity).toBe(1);
  });

  it("…and one whose type line holds it", () => {
    const [item] = publicDeckItems([{ entry: entry("Grim Goblin", { type_line: `Creature — ${STRONG}` }), card: null }], false);
    expect(item.entry.name).toBe(PRIVATE_CARD_NAME);
  });

  it("the owner always sees the real name", () => {
    const items = [{ entry: entry(`${STRONG} Goblin`), card: null }];
    expect(publicDeckItems(items, true)).toEqual(items);
  });

  it("a private card with no printing behind it (D11): its name is the card's own title — hidden", () => {
    const [item] = publicDeckItems([{ entry: entry("Grim Goblin"), card: null }], false);
    expect(item.entry.name).toBe(PRIVATE_CARD_NAME);
    expect(item.entry.type_line).toBeNull();
    // The owner reads it.
    expect(publicDeckItems([{ entry: entry("Grim Goblin"), card: null }], true)[0]!.entry.name).toBe("Grim Goblin");
  });

  it("a DELETED card's entry (no card, no printing, a card-bringing source) is hidden too — its name is the card's old title (0152)", () => {
    for (const source of ["creator", "link", "ai_generate", "ai_remix"]) {
      const gone = { entry: entry("Grim Goblin", { card_id: null, scryfall_id: null, source }), card: null };
      expect(isPrivateForViewer(gone.entry, null, false), source).toBe(true);
      expect(hidesEntryName(gone.entry, null, false)).toBe(true);
      expect(publicDeckItems([gone], false)[0]!.entry.name).toBe(PRIVATE_CARD_NAME);
      // The owner keeps the stored name ("No longer available").
      expect(isPrivateForViewer(gone.entry, null, true)).toBe(false);
      expect(publicDeckItems([gone], true)[0]!.entry.name).toBe("Grim Goblin");
    }
    // The owner's own unlink clears the source: a plain line, shown as typed —
    // and so are a pasted name, an import placeholder and an entry written
    // before 0144 (no source).
    for (const source of [null, "import", "manual", undefined]) {
      const plain = { card_id: null, scryfall_id: null, source, name: "Grim Goblin" };
      expect(isPrivateForViewer(plain, null, false), String(source)).toBe(false);
    }
    // A printing whose card is gone is the real card again.
    expect(isPrivateForViewer({ card_id: null, scryfall_id: "sf", source: "ai_remix" }, null, false)).toBe(false);
  });

  it("keeps the real card's name of a private card's printing, and everything else as it was", () => {
    const items = [
      // A private card standing in for a printing: the entry's name is the
      // REAL card's ("Goblin Guide"), never the private card's title.
      { entry: entry("Goblin Guide", { scryfall_id: "sf-1" }), card: null },
      // A readable card (public / unlisted): its own title is shown anyway.
      { entry: entry(`${STRONG} Goblin`), card: { id: "c-1", title: "Grim Goblin" } },
      // A printing or a placeholder: no linked card.
      { entry: entry("Goblin Guide", { card_id: null }), card: null },
    ];
    expect(publicDeckItems(items, false)).toEqual(items);
    expect(hidesEntryName(entry(`${STRONG}`, { card_id: null }), null, false)).toBe(false);
    // …but a printing's name with strong language is still hidden.
    expect(hidesEntryName(entry(`${STRONG} Goblin`, { scryfall_id: "sf-1" }), null, false)).toBe(true);
  });
});

describe("publicDeckWarning", () => {
  it("quotes 'Private card' instead of a name with strong language, for a viewer only", () => {
    const warning = { code: "copy_limit", message: `“${STRONG} Goblin” appears 5× — the limit is 4 copies across mainboard and sideboard.` };
    expect(publicDeckWarning(warning, false).message).toBe(
      `“${PRIVATE_CARD_NAME}” appears 5× — the limit is 4 copies across mainboard and sideboard.`,
    );
    expect(publicDeckWarning(warning, true)).toBe(warning);
    const clean = { code: "copy_limit", message: "“Goblin Guide” appears 5× — the limit is 4 copies." };
    expect(publicDeckWarning(clean, false)).toBe(clean);
  });
});
