import { describe, expect, it } from "vitest";
import {
  finishOf,
  languageCode,
  parseCollectionImport,
  parseCsvRecords,
  problemsCsv,
} from "@/lib/tools/collection/parse-import";

// ---------------------------------------------------------------------------
// The Collection Deck Builder's import reader (lib/tools/collection/
// parse-import.ts): the CSV exports of the big collection apps, each read
// by its own header, and plain text in the forms people paste. Headers are
// the apps' own (2026 exports). Every line that can't be read is a
// PROBLEM with its line number and why — never dropped in silence.
// ---------------------------------------------------------------------------

const SOL = "bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd";

describe("CSV exports", () => {
  it("ManaBox: set code, number, finish, language and Scryfall id", () => {
    const parsed = parseCollectionImport(
      [
        "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency",
        `Sol Ring,C21,Commander 2021,263,foil,uncommon,2,1234,${SOL},1.2,false,false,near_mint,en,USD`,
        "Counterspell,MH2,Modern Horizons 2,267,normal,uncommon,1,99,,0.5,false,false,near_mint,ja,USD",
      ].join("\n"),
    );
    expect(parsed.format).toBe("manabox");
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines).toMatchObject([
      { line: 2, name: "Sol Ring", setCode: "c21", collectorNumber: "263", scryfallId: SOL, quantity: 2, finish: "foil", lang: "en" },
      { line: 3, name: "Counterspell", setCode: "mh2", collectorNumber: "267", scryfallId: null, quantity: 1, finish: "nonfoil", lang: "ja" },
    ]);
    expect(parsed.copies).toBe(3);
  });

  it("Moxfield: Count, Edition (a code), Foil, Language by name", () => {
    const parsed = parseCollectionImport(
      [
        '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"',
        '"4","0","Llanowar Elves","dom","Near Mint","English","","","2026-01-01 10:00:00.000000","168","False","False",""',
        '"1","0","Sword of Fire and Ice","2xm","Near Mint","German","etched","","2026-01-01 10:00:00.000000","276","False","False",""',
      ].join("\n"),
    );
    expect(parsed.format).toBe("moxfield");
    expect(parsed.lines).toMatchObject([
      { name: "Llanowar Elves", setCode: "dom", collectorNumber: "168", quantity: 4, finish: "nonfoil", lang: "en" },
      { name: "Sword of Fire and Ice", setCode: "2xm", collectorNumber: "276", finish: "etched", lang: "de" },
    ]);
  });

  it("Archidekt: Finish and Edition Code", () => {
    const parsed = parseCollectionImport(
      [
        "Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,MTGO ID,Collector Number",
        `1,Sol Ring,Foil,NM,2026-01-01,English,,,Commander 2021,C21,0,${SOL},0,263`,
      ].join("\n"),
    );
    expect(parsed.format).toBe("archidekt");
    expect(parsed.lines[0]).toMatchObject({ name: "Sol Ring", setCode: "c21", finish: "foil", scryfallId: SOL });
  });

  it("Deckbox: a set NAME in Edition is not read as a code; Edition Code is", () => {
    const parsed = parseCollectionImport(
      [
        "Count,Tradelist Count,Name,Edition,Edition Code,Card Number,Condition,Language,Foil,Signed,Artist Proof,Altered Art,Misprint,Promo,Textless,Printing Id,Printing Note,Tags,My Price",
        "2,0,Lightning Bolt,Magic 2010,M10,146,Near Mint,English,,,,,,,,,,,$1.00",
        "1,0,Brainstorm,Ice Age,,61,Near Mint,English,foil,,,,,,,,,,$1.00",
      ].join("\n"),
    );
    expect(parsed.format).toBe("deckbox");
    expect(parsed.lines).toMatchObject([
      { name: "Lightning Bolt", setCode: "m10", collectorNumber: "146", quantity: 2 },
      { name: "Brainstorm", setCode: null, collectorNumber: null, finish: "foil" },
    ]);
  });

  it("TCGplayer: Simple Name beats the product name, Printing is the finish", () => {
    const parsed = parseCollectionImport(
      [
        "Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU",
        "3,Arcane Signet (Retro Frame),Arcane Signet,Commander Legends,408,CMR,Foil,Near Mint,English,C,1,2",
      ].join("\n"),
    );
    expect(parsed.format).toBe("tcgplayer");
    expect(parsed.lines[0]).toMatchObject({ name: "Arcane Signet", setCode: "cmr", collectorNumber: "408", finish: "foil", quantity: 3 });
  });

  it("Dragon Shield: the sep= line is skipped and line numbers stay the file's", () => {
    const parsed = parseCollectionImport(
      [
        "sep=,",
        "Folder Name,Quantity,Trade Quantity,Card Name,Set Code,Set Name,Card Number,Condition,Printing,Language,Price Bought,Date Bought,LOW,MID,MARKET",
        "Binder,2,0,Swords to Plowshares,EMA,Eternal Masters,25,NearMint,Normal,English,1.00,2026-01-01,1,1,1",
      ].join("\r\n"),
    );
    expect(parsed.format).toBe("dragonshield");
    expect(parsed.lines).toMatchObject([{ line: 3, name: "Swords to Plowshares", setCode: "ema", finish: "nonfoil", quantity: 2 }]);
  });

  it("semicolon and tab delimiters, quoted cells with commas and line breaks", () => {
    expect(parseCollectionImport("Name;Quantity\nSol Ring;2").lines[0]).toMatchObject({ name: "Sol Ring", quantity: 2 });
    expect(parseCollectionImport("Name\tQuantity\nSol Ring\t3").lines[0]).toMatchObject({ name: "Sol Ring", quantity: 3 });
    const records = parseCsvRecords('Name,Note\n"Borborygmos, Enraged","two\nlines"\nNext,x', ",");
    expect(records.map((r) => r.cells[0])).toEqual(["Name", "Borborygmos, Enraged", "Next"]);
    expect(records[2].line).toBe(4);
  });

  it("rows that can't be a card are problems with why, never dropped", () => {
    const parsed = parseCollectionImport("Name,Quantity\n,2\nSol Ring,two\nSol Ring,0\nMox Opal,1");
    expect(parsed.lines.map((l) => l.name)).toEqual(["Mox Opal"]);
    expect(parsed.problems).toEqual([
      { line: 2, raw: ",2", reason: "No card name on this row." },
      { line: 3, raw: "Sol Ring,two", reason: "The quantity isn't a whole number." },
      { line: 4, raw: "Sol Ring,0", reason: "No copies on this row (quantity 0)." },
    ]);
  });

  it("an empty quantity is one copy", () => {
    expect(parseCollectionImport("Name,Quantity\nSol Ring,").lines[0].quantity).toBe(1);
  });
});

describe("plain text", () => {
  it("reads the forms people paste", () => {
    const parsed = parseCollectionImport(
      [
        "4 Llanowar Elves (DOM) 168",
        "1x Sol Ring",
        "2 Counterspell [MH2] 267 *F*",
        "1 Sword of Fire and Ice (2XM) 276 *E*",
        "Lightning Bolt",
        "1 Arcane Signet (CMR) 408 [Ramp] ^Have^",
        "1 Fire // Ice",
      ].join("\n"),
    );
    expect(parsed.format).toBe("text");
    expect(parsed.problems).toEqual([]);
    expect(parsed.lines).toMatchObject([
      { name: "Llanowar Elves", quantity: 4, setCode: "dom", collectorNumber: "168", finish: "nonfoil" },
      { name: "Sol Ring", quantity: 1, setCode: null },
      { name: "Counterspell", quantity: 2, setCode: "mh2", collectorNumber: "267", finish: "foil" },
      { name: "Sword of Fire and Ice", setCode: "2xm", finish: "etched" },
      { name: "Lightning Bolt", quantity: 1 },
      { name: "Arcane Signet", setCode: "cmr", collectorNumber: "408" },
      { name: "Fire // Ice", quantity: 1 },
    ]);
  });

  it("skips blank lines, comments and section words; counts lines as the file does", () => {
    const parsed = parseCollectionImport("Commander\n1 Krenko, Mob Boss\n\n// ramp\nSideboard:\n# note\n3 Goblin Guide");
    expect(parsed.lines.map((l) => [l.line, l.name, l.quantity])).toEqual([
      [2, "Krenko, Mob Boss", 1],
      [7, "Goblin Guide", 3],
    ]);
  });

  it("a quantity 0 line is a problem", () => {
    expect(parseCollectionImport("0 Sol Ring").problems[0]).toMatchObject({ line: 1, reason: "No copies on this line (quantity 0)." });
  });
});

describe("helpers", () => {
  it("languages by code, alias or name; English when unknown", () => {
    expect(languageCode("Japanese")).toBe("ja");
    expect(languageCode("JP")).toBe("ja");
    expect(languageCode("Chinese Simplified")).toBe("zhs");
    expect(languageCode("")).toBe("en");
    expect(languageCode("Klingon")).toBe("en");
  });

  it("finishes", () => {
    expect(finishOf("Foil")).toBe("foil");
    expect(finishOf("true")).toBe("foil");
    expect(finishOf("Etched Foil")).toBe("etched");
    expect(finishOf("Non-Foil")).toBe("nonfoil");
    expect(finishOf("Normal")).toBe("nonfoil");
    expect(finishOf("")).toBe("nonfoil");
  });

  it("the problems CSV quotes what needs it", () => {
    expect(problemsCsv([{ line: 3, raw: 'Bad, "line"', reason: "Why" }])).toBe('Line,Row,Reason\r\n3,"Bad, ""line""",Why');
  });

  it("a BOM is ignored", () => {
    expect(parseCollectionImport("﻿Name,Quantity\nSol Ring,1").lines[0].name).toBe("Sol Ring");
  });
});
