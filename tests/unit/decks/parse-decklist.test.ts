import { describe, expect, it } from "vitest";
import {
  frontFaceName,
  parseDecklist,
} from "@/lib/decks/parse-decklist";

const find = (
  result: ReturnType<typeof parseDecklist>,
  name: string,
) => result.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());

describe("parseDecklist — MTG Arena export", () => {
  const ARENA = `About
Name Izzet Phoenix

Deck
4 Lightning Strike (M19) 152
4 Monastery Swiftspear (KTK) 118
2 A-Teferi, Master of Time (M21) 275
20 Mountain

Sideboard
2 Duress (M19) 94

Commander
1 Alela, Artful Provocateur (ELD) 324

Companion
1 Lurrus of the Dream-Den (IKO) 226`;

  it("captures the deck title from the About/Name block", () => {
    expect(parseDecklist(ARENA).title).toBe("Izzet Phoenix");
  });

  it("parses qty, name, set code (lowercased), and collector number", () => {
    const strike = find(parseDecklist(ARENA), "Lightning Strike");
    expect(strike).toMatchObject({
      quantity: 4,
      setCode: "m19",
      collectorNumber: "152",
      board: "main",
    });
  });

  it("routes section headers to boards", () => {
    const result = parseDecklist(ARENA);
    expect(find(result, "Duress")?.board).toBe("side");
    expect(find(result, "Alela, Artful Provocateur")?.board).toBe("commander");
    expect(find(result, "Lurrus of the Dream-Den")?.board).toBe("companion");
  });

  it("strips the A- Alchemy prefix", () => {
    const result = parseDecklist(ARENA);
    expect(find(result, "Teferi, Master of Time")).toBeDefined();
    expect(find(result, "A-Teferi, Master of Time")).toBeUndefined();
  });

  it("produces no warnings on a clean export", () => {
    expect(parseDecklist(ARENA).warnings).toEqual([]);
  });
});

describe("parseDecklist — Moxfield export", () => {
  it("handles finish flags and The List collector numbers", () => {
    const result = parseDecklist(
      `1 Prosper, Tome-Bound (AFC) 2 *F*
1 Arcane Signet (TDC) 105
1 Revel in Riches (PLST) XLN-117`,
    );
    expect(find(result, "Prosper, Tome-Bound")).toMatchObject({
      setCode: "afc",
      collectorNumber: "2",
    });
    expect(find(result, "Revel in Riches")).toMatchObject({
      setCode: "plst",
      collectorNumber: "XLN-117",
    });
  });

  it("handles the SIDEBOARD: header", () => {
    const result = parseDecklist(`4 Lightning Bolt

SIDEBOARD:
2 Pyroblast`);
    expect(find(result, "Pyroblast")?.board).toBe("side");
  });

  it("treats a tiny first block before a 99-card block as the command zone", () => {
    const ninetyNine = Array.from(
      { length: 99 },
      (_, i) => `1 Filler Card ${i}`,
    ).join("\n");
    const result = parseDecklist(`1 Atraxa, Praetors' Voice (2X2) 190\n\n${ninetyNine}`);
    expect(find(result, "Atraxa, Praetors' Voice")?.board).toBe("commander");
    expect(find(result, "Filler Card 0")?.board).toBe("main");
    // The heuristic announces itself so the review UI can surface it.
    expect(
      result.warnings.some((w) => w.reason.includes("command zone")),
    ).toBe(true);
  });
});

describe("parseDecklist — Archidekt export", () => {
  it("parses 1x quantities, lowercase set codes, categories, and labels", () => {
    const result = parseDecklist(
      `1x Become Immense (ktk) 130 [Buff] ^Combo,#00FF00^
1x Xyris, the Writhing Storm (dmc) 175 [Commander{top}]
1x Consign to Memory (mh3) 54 [Sideboard]
2x Growth Spiral (rna) 178 [Maybeboard]`,
    );
    expect(find(result, "Become Immense")).toMatchObject({
      quantity: 1,
      setCode: "ktk",
      collectorNumber: "130",
      board: "main", // custom category → main
    });
    expect(find(result, "Xyris, the Writhing Storm")?.board).toBe("commander");
    expect(find(result, "Consign to Memory")?.board).toBe("side");
    expect(find(result, "Growth Spiral")?.board).toBe("maybe");
  });

  it("accepts backtick category tags", () => {
    const result = parseDecklist("1 Mountain `Sideboard`");
    expect(find(result, "Mountain")?.board).toBe("side");
  });
});

describe("parseDecklist — ManaBox export", () => {
  it("handles Arena-style headers with finish flags", () => {
    const result = parseDecklist(`Commander
1 Niv-Mizzet, Visionary (FDN) 350

Deck
1 Jace, Ingenious Mind-Mage (XLN) 280 *F*
4 Tarmogoyf

Sideboard
2 Surgical Extraction`);
    expect(find(result, "Niv-Mizzet, Visionary")?.board).toBe("commander");
    expect(find(result, "Jace, Ingenious Mind-Mage")).toMatchObject({
      board: "main",
      setCode: "xln",
    });
    expect(find(result, "Tarmogoyf")).toMatchObject({
      quantity: 4,
      setCode: null,
    });
    expect(find(result, "Surgical Extraction")?.board).toBe("side");
  });

  it("handles // COMMANDER comment-style headers", () => {
    const result = parseDecklist(`// COMMANDER
1 Krenko, Mob Boss
// MAYBEBOARD
1 Goblin Chieftain`);
    expect(find(result, "Krenko, Mob Boss")?.board).toBe("commander");
    expect(find(result, "Goblin Chieftain")?.board).toBe("maybe");
  });
});

describe("parseDecklist — plain MTGO text", () => {
  it("splits main from side on the first blank line", () => {
    const result = parseDecklist(`4 Lightning Bolt
4 Monastery Swiftspear
20 Mountain

3 Pyroblast
2 Red Elemental Blast`);
    expect(find(result, "Lightning Bolt")?.board).toBe("main");
    expect(find(result, "Pyroblast")?.board).toBe("side");
    expect(find(result, "Red Elemental Blast")?.board).toBe("side");
  });

  it("only splits once — later blank lines don't create more boards", () => {
    const result = parseDecklist(`4 Bolt A

2 Side A

2 Side B`);
    expect(find(result, "Side A")?.board).toBe("side");
    expect(find(result, "Side B")?.board).toBe("side");
  });

  it("ignores blank lines when explicit headers are present", () => {
    const result = parseDecklist(`Deck
4 Lightning Bolt

4 Shock`);
    expect(find(result, "Shock")?.board).toBe("main");
  });
});

describe("parseDecklist — edge cases", () => {
  it("keeps commas and apostrophes in names", () => {
    const result = parseDecklist(`1 Atraxa, Praetors' Voice`);
    expect(find(result, "Atraxa, Praetors' Voice")).toBeDefined();
  });

  it("normalizes curly quotes and unicode minus", () => {
    const result = parseDecklist(`1 Urza’s Saga\n1 Lim-Dûl's Vault`);
    expect(find(result, "Urza's Saga")).toBeDefined();
    expect(find(result, "Lim-Dûl's Vault")).toBeDefined();
  });

  it("keeps // split names intact on the entry", () => {
    const result = parseDecklist(
      `4 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (NEO) 141`,
    );
    expect(
      find(result, "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"),
    ).toMatchObject({ setCode: "neo", collectorNumber: "141" });
  });

  it("parses digit-leading set codes and star collector numbers", () => {
    const result = parseDecklist(`1 Damnation (2X2) 82\n1 Lotus Petal (40K) 255\n1 Gaea's Cradle (JGP) 12★`);
    expect(find(result, "Damnation")?.setCode).toBe("2x2");
    expect(find(result, "Lotus Petal")?.setCode).toBe("40k");
    expect(find(result, "Gaea's Cradle")?.collectorNumber).toBe("12★");
  });

  it("handles 4x-style quantities, CRLF, tabs, and extra spaces", () => {
    const result = parseDecklist(
      "4x  Lightning Bolt\r\n2X\tShock (M21)  159\r\n",
    );
    expect(find(result, "Lightning Bolt")?.quantity).toBe(4);
    expect(find(result, "Shock")).toMatchObject({
      quantity: 2,
      setCode: "m21",
    });
  });

  it("merges duplicate lines by summing quantities", () => {
    const result = parseDecklist(`2 Lightning Bolt\n2 Lightning Bolt`);
    expect(result.entries).toHaveLength(1);
    expect(find(result, "Lightning Bolt")?.quantity).toBe(4);
  });

  it("keeps same-name entries on different boards separate", () => {
    const result = parseDecklist(`2 Duress\n\n2 Duress`);
    expect(result.entries).toHaveLength(2);
  });

  it("skips comments, type-group headers, and token sections", () => {
    const result = parseDecklist(`# my burn deck
Creatures (4)
4 Monastery Swiftspear
Tokens
1 Treasure Token
Sideboard
2 Smash to Smithereens`);
    expect(result.entries).toHaveLength(2);
    expect(find(result, "Treasure Token")).toBeUndefined();
    expect(find(result, "Smash to Smithereens")?.board).toBe("side");
  });

  it("warns on unparseable lines with their line numbers", () => {
    const result = parseDecklist(`4 Lightning Bolt\ntotally not a card line`);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ line: 2 });
    expect(result.entries).toHaveLength(1);
  });

  it("strips deckstats-style #tags", () => {
    const result = parseDecklist(`4 Lightning Bolt #burn #!core`);
    expect(find(result, "Lightning Bolt")).toBeDefined();
  });

  it("caps runaway quantities at 250", () => {
    const result = parseDecklist(`999 Rat Colony`);
    expect(find(result, "Rat Colony")?.quantity).toBe(250);
  });
});

describe("frontFaceName", () => {
  it("extracts the front face from any slash style", () => {
    expect(frontFaceName("Fire // Ice")).toBe("Fire");
    expect(frontFaceName("Fire / Ice")).toBe("Fire");
    // MTGO exports split cards without spaces.
    expect(frontFaceName("Research/Development")).toBe("Research");
    expect(frontFaceName("Lightning Bolt")).toBeNull();
  });
});
