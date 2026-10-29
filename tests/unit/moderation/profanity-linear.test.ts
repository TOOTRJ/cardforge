import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  containsProfanity,
  containsProfanityForTests,
  PROFANITY_FORMS_FOR_TESTS,
  profanityEngineForTests,
  profanityMatchesForTests,
  profanityPatternSourcesForTests,
} from "@/lib/moderation/profanity";

// ---------------------------------------------------------------------------
// The strong-language detector without catastrophic backtracking (perf,
// 2026-10-29). lib/moderation/profanity.ts matches ordinary text with its
// regexes (an `exec` loop now, not `matchAll`) and text the regexes would
// be slow on with an exact emulation of them. A PERFORMANCE change only:
// every verdict must stay what it was.
//
// The ORACLE below is the detector as it shipped before (origin/main,
// 2026-10-29): the same regexes built the same way, the same normalisation,
// the same `matchAll` loop. It reads the module's word lists, decoded, so a
// later change to the lists keeps it in step; nothing else is shared. Every
// input is held to it twice: the VERDICT (containsProfanity, and each engine
// forced), and every MATCH each matcher's search meets, start and end —
// stronger than the verdict, which is read from those matches.
//
// The repo is public: no word is written out here; the forms come from the
// module at run time, and a failure prints its input ROT13'd (as
// profanity.test.ts writes them), never decoded into the CI log.
// ---------------------------------------------------------------------------

const rot13 = (text: string) =>
  text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
/** An input as a failure message shows it: ROT13'd, and cut if long. */
const shown = (input: string) => JSON.stringify(rot13(input.length > 200 ? `${input.slice(0, 200)}…(${input.length})` : input));

/** The detector as it shipped before this change — the oracle. */
function shippedDetector(lists: { words: readonly string[]; prefixes: readonly string[]; infixes: readonly string[] }) {
  const LEET: Readonly<Record<string, string>> = {
    a: "a4@",
    b: "b8",
    c: "c",
    e: "e3",
    i: "i1!|",
    l: "l1|",
    o: "o0",
    s: "s5$",
    t: "t7+",
    u: "uv",
  };
  const escapeClass = (chars: string) => chars.replace(/[\\\]^-]/g, "\\$&");
  const classOf = (letter: string) => `[${escapeClass(`${LEET[letter] ?? letter}*`)}]`;
  function compactPattern(word: string): string {
    let out = "";
    for (let i = 0; i < word.length; ) {
      let run = 1;
      while (word[i + run] === word[i]) run += 1;
      out += `${classOf(word[i])}${run === 1 ? "+" : `{${run},}`}`;
      i += run;
    }
    return out;
  }
  function spacedPattern(word: string): string {
    return [...word].map(classOf).join("[ \\t._~·•-]{1,2}");
  }
  const WORD_FORMS = lists.words;
  const PREFIX_FORMS = lists.prefixes;
  const INFIX_FORMS = lists.infixes;
  const BEFORE = "(?<![\\p{L}\\p{N}])";
  const AFTER = "(?![\\p{L}\\p{N}])";
  const MATCHERS: readonly RegExp[] = [
    new RegExp(`${BEFORE}(?:${[...WORD_FORMS, ...INFIX_FORMS].map(compactPattern).join("|")})${AFTER}`, "gu"),
    new RegExp(`${BEFORE}(?:${PREFIX_FORMS.map(compactPattern).join("|")})`, "gu"),
    new RegExp(`(?:${INFIX_FORMS.map(compactPattern).join("|")})`, "gu"),
    new RegExp(`${BEFORE}(?:${[...WORD_FORMS, ...INFIX_FORMS].map(spacedPattern).join("|")})${AFTER}`, "gu"),
  ];
  function realEnough(match: string): boolean {
    const letters = match.match(/\p{L}/gu)?.length ?? 0;
    return match.includes("*") ? letters >= 2 : letters >= 1;
  }
  const INVISIBLE = new RegExp("[\\u00AD\\u200B-\\u200F\\u2060\\uFEFF]", "g");
  const LOOK_ALIKES: Readonly<Record<string, string>> = {
    "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
    "і": "i", "ї": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ɩ": "i",
    "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ζ": "z",
  };
  const LOOK_ALIKE_RE = new RegExp(`[${Object.keys(LOOK_ALIKES).join("")}]`, "gu");
  function normalized(text: string): string {
    return text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(INVISIBLE, "")
      .toLowerCase()
      .replace(LOOK_ALIKE_RE, (c) => LOOK_ALIKES[c] ?? c);
  }
  function containsProfanity(text: string | null | undefined): boolean {
    if (!text) return false;
    const value = normalized(text);
    for (const matcher of MATCHERS) {
      matcher.lastIndex = 0;
      for (const match of value.matchAll(matcher)) {
        if (realEnough(match[0])) return true;
      }
    }
    return false;
  }
  /** Every match each matcher's search meets, as [matcher, start, end]. */
  function matches(text: string): Array<[number, number, number]> {
    const value = normalized(text);
    return MATCHERS.flatMap((matcher, index) =>
      [...value.matchAll(matcher)].map((match): [number, number, number] => [index, match.index, match.index + match[0].length]),
    );
  }
  return { containsProfanity, matches, sources: MATCHERS.map((regex) => regex.source) };
}

const shipped = shippedDetector(PROFANITY_FORMS_FOR_TESTS);
const FORMS = [...new Set([...PROFANITY_FORMS_FOR_TESTS.words, ...PROFANITY_FORMS_FOR_TESTS.prefixes, ...PROFANITY_FORMS_FOR_TESTS.infixes])];

/** Held to the oracle: the verdict three ways and every match both ways. */
function differences(inputs: Iterable<string>): string[] {
  const out: string[] = [];
  for (const input of inputs) {
    const verdict = shipped.containsProfanity(input);
    const spans = JSON.stringify(shipped.matches(input));
    const got = {
      auto: containsProfanity(input),
      regex: containsProfanityForTests(input, "regex"),
      runs: containsProfanityForTests(input, "runs"),
    };
    if (got.auto !== verdict || got.regex !== verdict || got.runs !== verdict) {
      out.push(`verdict ${shown(input)} (ROT13): shipped ${verdict}, now ${JSON.stringify(got)}`);
    }
    for (const engine of ["regex", "runs"] as const) {
      const now = JSON.stringify(profanityMatchesForTests(input, engine));
      if (now !== spans) out.push(`matches (${engine}) ${shown(input)} (ROT13): shipped ${spans}, now ${now}`);
    }
    if (out.length >= 20) break;
  }
  return out;
}

// --- Inputs ----------------------------------------------------------------

const LEET: Readonly<Record<string, string>> = { a: "4@", b: "8", e: "3", i: "1!|", l: "1|", o: "0", s: "5$", t: "7+", u: "v" };
const LOOK_ALIKE: Readonly<Record<string, string>> = { a: "а", c: "с", e: "е", o: "о", p: "р", i: "і", s: "ѕ", u: "υ", k: "κ", t: "т", x: "х", j: "ј" };
const ACCENTED: Readonly<Record<string, string>> = { a: "á", e: "é", i: "í", o: "ö", u: "ü", c: "ç", n: "ñ", y: "ý" };
const SEPARATORS = [" ", ".", "-", "  ", "_", "~", "·", "•", "\t", " . ", "--", "/", ""];
const INVISIBLES = ["​", "­", "⁠", "﻿", "‍"];
const replaceAt = (s: string, i: number, by: string) => s.slice(0, i) + by + s.slice(i + 1);

/** One form, disguised every way the detector reads (and some it doesn't). */
function disguises(form: string): string[] {
  const out = new Set<string>([form, form.toUpperCase(), form[0].toUpperCase() + form.slice(1)]);
  const chars = [...form];
  chars.forEach((c, i) => {
    for (const leet of LEET[c] ?? "") out.add(replaceAt(form, i, leet));
    out.add(replaceAt(form, i, "*"));
    if (i + 1 < chars.length) out.add(form.slice(0, i) + "**" + form.slice(i + 2));
    out.add(form.slice(0, i + 1) + c + form.slice(i + 1)); // doubled
    out.add(form.slice(0, i + 1) + c.repeat(13) + form.slice(i + 1)); // a long run: the emulation's gate
    if (LOOK_ALIKE[c]) out.add(replaceAt(form, i, LOOK_ALIKE[c]));
    if (ACCENTED[c]) out.add(replaceAt(form, i, ACCENTED[c]));
    out.add(form.slice(0, i + 1) + "́" + form.slice(i + 1)); // combining acute
    if (i > 0) out.add(form.slice(0, i) + INVISIBLES[i % INVISIBLES.length] + form.slice(i));
  });
  out.add(chars.map((c) => (LEET[c] ?? c)[0]).join("")); // every letter leet
  out.add(chars.map((c, i) => (i === 0 || i === chars.length - 1 ? c : "*")).join("")); // masked inside
  out.add(chars.map(() => "*").join("")); // all masked
  out.add(chars.map((c) => String.fromCharCode(c.charCodeAt(0) - 97 + 0xff41)).join("")); // full width
  for (const sep of SEPARATORS) out.add(chars.join(sep));
  for (const [before, after] of [
    ["un", "able"], ["", "ing"], ["", "s"], ["", "ers"], ["x", ""], ["", "x"], ["2", ""], ["", "2"], ["“", "”"],
    ["", "!"], ["(", ")"], ["the ", " of it"], ["*", "*"], ["$", ""], ["", "'s"], ["mother", ""], ["", "head"], ["no", "thing"],
  ]) {
    out.add(`${before}${form}${after}`);
  }
  return [...out];
}

/** Innocent words and phrases that share letters with a listed form. */
const NEAR_MISSES = [
  "assassin", "Assassin's Strike", "Assassinate", "Scunthorpe", "class", "Classic", "Dickens", "Cockatrice", "Hellhole Rats",
  "Raccoon Rallier", "Cocktail", "Peacock", "Hitchcock", "Middlesex", "Shiitake", "Mishit", "Snigger", "Sniggering", "Niger",
  "Pakistan", "Spice", "Spiculum", "Retardant", "Bitterblossom", "Twitch", "Wankel", "Cumulative upkeep {2}", "Circumstance",
  "Analyze", "Grasshopper", "Fagin", "Shittim", "Bass", "Assess", "Embarrass", "Hancock", "Glasscock", "Scrap Trawler",
  "Kikimora", "Gooky", "Damnation", "Hell's Caretaker", "You bastard!", "What an ass.", "Crap.", "Piss off", "Spic and span",
  "Coon Creek", "pussy willow", "It retards the spread.", "600k bounty", "900K gold", "Pay 6000 life", "5007", "0000", "1337",
  "Choose one: a, b, or c. W U B R G", "{T}: Add {C}{C}. +1/+1 counters.", "*/*", "1+*", "****", "c***", "f***", "*Ach! Hans, run!*",
  "Nooooooooooooooo!!!!!!!!!!!!!!", "...............", "--------------", "aaaaaaaaaaaaaaaaaaaa", "Shhhhhhhhhhhhhhh", "Ssssssssssssss",
  "Whoooooooooore", "Coooooooooook", "Dicccccccccce", "Twaaaaaaaaain", "Fuuuuuuuuuuuuuun", "Puuuuuuuuuuuuuuun",
];

/** Every name, type line, rules and flavour text in the repo's Scryfall fixtures. */
function realCardTexts(): string[] {
  const texts = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["name", "oracle_text", "flavor_text", "type_line", "flavor_name", "artist", "printed_name", "printed_text"]) {
      if (typeof record[key] === "string" && ("oracle_text" in record || "type_line" in record)) texts.add(record[key] as string);
    }
    Object.values(record).forEach(walk);
  };
  for (const root of ["tests/unit/scryfall/fixtures", "tests/unit/creator/fixtures"]) {
    for (const file of readdirSync(root)) {
      const path = join(root, file);
      if (file.endsWith(".json") && statSync(path).isFile()) walk(JSON.parse(readFileSync(path, "utf8")));
    }
  }
  return [...texts];
}

/** Seeded strings over small alphabets the classes overlap on — where the
 *  regexes backtrack and the emulation has to agree with them. */
function randomStrings(count: number, seed: number): string[] {
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const forms = FORMS.slice(0, 40);
  const alphabets = [
    "*|", "*c", "*k", "*s", "*f", "*a", "*1", "*!", "|1il", "s$5h*i1!|t7+", "a4@s5$*", "* .-", "*| x", "aeiou*|1", "uv*",
    "*abcdefghijklmnopqrstuvwxyz", "*1|!$5@4+7 ", "*-. _~", "xyz*", "*é", "*​", "*\u{1f600}", "*\u{1d400}a", "*·•",
    ...forms.map((form) => `${form}*`), ...forms.map((form) => `${form} .`),
  ].map((alphabet) => [...alphabet]);
  return Array.from({ length: count }, (_, i) => {
    const alphabet = pick(alphabets);
    const length = 1 + Math.floor(random() * (i % 10 === 0 ? 48 : 20));
    let s = "";
    for (let k = 0; k < length; k++) s += pick(alphabet);
    return s;
  });
}

/** The adversarial shapes, short enough for the oracle (its cost grows with
 *  the cube of the length on the worst of them). */
const ADVERSARIAL_UNITS = [
  "*|", "|*", "*c", "*k", "*s", "*f", "*a", "4*", "*$", "*!", "*+", "*1|", "*i|", "*l|", "f", "s", "$", "@", "a", "*",
  "****888*8***8**é", "***q", "** ", "**.", "*-", "* ", "yyw****yw*​", "sf*jaja****asaé", "|**x", "*-* -*", "a* ",
];
const adversarialInputs = () =>
  ADVERSARIAL_UNITS.flatMap((unit) => [13, 27, 60, 120].map((length) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length)));

// --- Tests -----------------------------------------------------------------

describe("the detector keeps every verdict it gave (oracle: as shipped before)", () => {
  it("builds the same regexes, from the same lists", () => {
    expect(profanityPatternSourcesForTests()).toEqual(shipped.sources);
    expect(FORMS.length).toBeGreaterThan(100);
  });

  it("every listed form, disguised every way — same verdict, same matches", () => {
    const inputs = FORMS.flatMap(disguises);
    expect(inputs.length).toBeGreaterThan(9000);
    // A good share of them are positive, and a good share go to the emulation.
    expect(inputs.filter((input) => containsProfanity(input)).length).toBeGreaterThan(inputs.length / 3);
    expect(differences(inputs)).toEqual([]);
  });

  it("innocent near misses and every real card text in the fixtures", () => {
    const inputs = [...NEAR_MISSES, ...realCardTexts()];
    expect(inputs.length).toBeGreaterThan(2000);
    expect(differences(inputs)).toEqual([]);
  });

  it("random strings over the alphabets the classes overlap on", () => {
    expect(differences(randomStrings(12000, 20261029))).toEqual([]);
  });

  it("adversarial shapes, at lengths the oracle can still run", () => {
    expect(differences(adversarialInputs())).toEqual([]);
  });

  it("a word beside or inside adversarial text", () => {
    const inputs = FORMS.flatMap((form) =>
      ["*|*|*|*|*|*|*|*|", "ffffffffffffffff", "*s*s*s*s*s*s*s*", "**************", "* * * * * * * *"].flatMap((noise) => [
        `${noise}${form}`,
        `${form}${noise}`,
        `${noise} ${form} ${noise}`,
        `${noise}${form}${noise}`,
      ]),
    );
    expect(differences(inputs)).toEqual([]);
  });

  it("a verdict at every chain length around the emulation's gate", () => {
    const inputs = FORMS.slice(0, 30).flatMap((form) =>
      [10, 11, 12, 13, 14, 15].flatMap((n) => [`${form[0]}${"*".repeat(n)}${form.slice(1)}`, `${"*".repeat(n)} ${form}`, `${form}${form.at(-1)!.repeat(n)}`]),
    );
    expect(differences(inputs)).toEqual([]);
  });
});

describe("texts longer than one emulation window (cut only where no match can be)", () => {
  // Every text here is past LINEAR_WINDOW (4096) and so read window by
  // window; the oracle still reads it whole.
  const card = realCardTexts().join(" ");
  let state = 7;
  const random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const at = (text: string, index: number, insert: string) => text.slice(0, index) + insert + text.slice(index);

  it("real card text with listed forms set in at, around and across the window edges", { timeout: 60_000 }, () => {
    const inputs: string[] = [];
    FORMS.forEach((form, i) => {
      const length = i % 10 === 0 ? 20000 : i % 2 === 0 ? 9000 : 5000;
      const base = card.slice(0, length);
      const near = 4090 + (i % 12); // around the first window's edge
      const anywhere = Math.floor(random() * base.length);
      inputs.push(at(base, near, form), at(base, near, ` ${form} `), at(base, anywhere, form), at(base, anywhere, ` ${form} `));
      // Spelled out across the edge: a space is a run form's cut, never a spaced-out one's.
      inputs.push(at(base, near - form.length, ` ${[...form].join(" ")} `), at(base, near - 2, ` ${[...form].join(".")} `));
    });
    // Some of them must be read by the emulation in automatic mode too.
    inputs.push(...FORMS.map((form) => `${"*s ".repeat(2000)}${form}${" *|".repeat(800)}`));
    expect(inputs.filter((input) => profanityEngineForTests(input) === "runs").length).toBeGreaterThan(100);
    expect(differences(inputs)).toEqual([]);
  });

  it("unbroken stretches longer than a window: one window to LINEAR_MAX, the regexes past it", { timeout: 60_000 }, () => {
    const stretch = (n: number) => "ab".repeat(Math.ceil(n / 2)).slice(0, n);
    const inputs = FORMS.flatMap((form) => [
      `${stretch(5000)} ${form}`,
      `${stretch(5000)}${form}${stretch(300)}`,
      `x ${stretch(4100)}${form} ${stretch(4100)}`,
      `${form} ${stretch(17000)}`,
      `${stretch(17000)}${form}`,
      `${"*".repeat(70)} ${stretch(6000)} ${form}`,
    ]);
    expect(differences(inputs)).toEqual([]);
  });
});

describe("no catastrophic backtracking", () => {
  // At this length (the zod max for rules text) the shipped detector took up
  // to 33 s a call ("*|"), 13–22 s ("*c", "*k"), 0.2–0.5 s ("*s", "*$",
  // "$") — and well under the bound on the rest, which are here because the
  // EMULATION must stay fast on them: each is asserted to be routed to it,
  // and the emulation itself is timed. Locally each takes at most ~6 ms
  // (≈ 30 ms under coverage). The bound is generous for a slow CI runner
  // with coverage on; a super-linear search still trips it.
  const BOUND_MS = 150;
  const LENGTH = 4000;
  const shapes = [
    "*|", "|*", "*c", "*k", "*s", "*f", "*a", "4*", "4@", "*$", "*!", "*+", "*1|", "*i|", "f", "s", "$", "@",
    "****888*8***8**é", "***q", "** ", "**.", "*-", "* ", "yyw****yw*​", "*yyyy**y*y*y***yy***", "a* ", "*-a-",
  ];
  const fastest = (run: () => unknown) => {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };

  it.each(shapes)("%j repeated to 4000 characters: routed to the emulation, and fast", (unit) => {
    const text = unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
    expect(profanityEngineForTests(text)).toBe("runs");
    expect(fastest(() => containsProfanityForTests(text, "runs"))).toBeLessThan(BOUND_MS);
    expect(fastest(() => containsProfanity(text))).toBeLessThan(BOUND_MS);
  });

  it.each(["*|", "*$", "****888*8***8**é"])("%j at 16000 unbroken characters (one window) and 20000 in windows", (unit) => {
    const unbroken = unit.repeat(Math.ceil(16000 / unit.length)).slice(0, 16000);
    const cut = `${unit.repeat(Math.ceil(3900 / unit.length)).slice(0, 3900)} `.repeat(5);
    expect(fastest(() => containsProfanity(unbroken))).toBeLessThan(4 * BOUND_MS);
    expect(fastest(() => containsProfanity(cut))).toBeLessThan(4 * BOUND_MS);
  });
});
