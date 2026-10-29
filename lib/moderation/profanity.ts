// ---------------------------------------------------------------------------
// Strong language in a card's TEXT (owner policy 2026-10-28). Violence is
// fine and some profanity is ALLOWED — but a card whose text holds strong
// profanity or a slur is saved PRIVATE, whatever visibility was asked for,
// and its maker is told why. ONE detector for every save path: the creator
// (its live note and the visibility it sends), both card actions
// (lib/cards/actions.ts — which the AI jobs, the deck remix and every
// import save through) and My Cards' bulk publish. Pure, client-safe, no
// network, no imports.
//
// The list is STRONG language only. Mild words that real cards print —
// "damn" (Damnation), "hell" (Hell's Caretaker), "bastard", "ass" — never
// count; neither does a word whose innocent spelling a slur shares
// ("Dickens", "Cockatrice", "Scunthorpe", "assassin", "class", "snigger").
// Matching is per WORD: a listed form must stand alone (no letter or digit
// on either side), so a listed word inside another word never counts. The
// one exception is the INFIX list: a stem no English word contains, matched
// anywhere ("motherf…").
//
// A PREFIX stem (one no English word begins with) counts at a word's start
// whatever follows it.
//
// A word may be disguised: case, accents and full-width letters (NFKD),
// Cyrillic / Greek look-alikes, leetspeak (4→a, 3→e, 1→i, 0→o, 5/$→s, 7→t,
// @→a, v→u…), a `*` masking any letter ("f*ck", "f**k" — a match keeps two
// real letters), letters repeated ("fuuuu…"), invisible characters inside
// it, and every letter spaced out ("f u c k", "f.u.c.k"). A match with no
// real letter at all is a number, never a word ("600k").
//
// The repo is PUBLIC: the words are stored ROT13'd below (a light
// obfuscation, not a secret — decode with any ROT13 tool). Tests use the
// encoded forms too (tests/unit/moderation/profanity.test.ts).
// ---------------------------------------------------------------------------

/** Stems matched ANYWHERE inside a word (ROT13). No English word holds one. */
const INFIX_ROT13 = "shpx";

/** Stems matched at the START of a word, whatever follows (ROT13): no
 *  English word begins with one ("…ing", "…ers", compounds). A stem an
 *  innocent word starts with — "shittim", "twattle", "spice", "retardant",
 *  "beanery", "coonhound", "niggard", "Pakistan" — is never here: its forms
 *  are listed whole below instead. */
const PREFIX_ROT13 =
  "phag avttre snttbg pbpxfhpx nffubyr nefrubyr qvpxurnq ovgpu juber fyhg wvmm qvyqb oybjwbo jrgonpx enturnq gbjryurnq fuvgurnq ohyyfuvg ubefrfuvg qvcfuvg";

/** Whole-word forms (ROT13), grouped by stem. A form counts only on its own. */
const WORDS_ROT13 = [
  "shx shxx shxxvat shxvat spx spxvat sphx sxvat cuhpx cuhpxvat",
  "fuvg fuvgf fuvggl fuvggvre fuvggvrfg fuvggvat fuvggrq fuvgr fuvgurnq fuvgurnqf fuvgubyr fuvgubyrf fuvgsnpr fuvgont fuvgybnq fuvgfgbez fuvgfubj ohyyfuvg ohyyfuvggvat ohyyfuvggre ubefrfuvg qvcfuvg ncrfuvg ongfuvg puvpxrafuvg qbtfuvg",
  "phag phagf phagl",
  "pbpxfhpxre pbpxfhpxref pbpxfhpxvat",
  "nffubyr nffubyrf nefrubyr nefrubyrf nffung nffungf",
  "qvpxurnq qvpxurnqf",
  "ovgpu ovgpurf ovgpul ovgpuvat ovgpurq fbabsnovgpu",
  "gjng gjngf jnaxre jnaxref jnax jnaxvat jnaxrq",
  "juber juberf fyhg fyhgf fyhggl chffl chffvrf wvmm qvyqb qvyqbf oybjwbo oybjwbof",
  // Slurs.
  "avttre avttref avttn avttnf avttnm",
  "snttbg snttbgf snt sntf snttl",
  "xvxr xvxrf fcvp fcvpf tbbx tbbxf jrgonpx jrgonpxf genaal genaavrf ergneq ergneqf ergneqrq",
  "enturnq enturnqf gbjryurnq gbjryurnqf ornare ornaref pbba pbbaf cnxv cnxvf",
];

function rot13(text: string): string {
  return text.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
}

// What may stand for each letter (always lower-case, after NFKD and the
// look-alike fold). `v` is the Roman-style u. No digit stands for g: "600k
// bounty" and "900K gold" are numbers, not a slur. A `*` masks ANY letter
// ("f*ck", "f**k") — a match must still hold real letters (realEnough).
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
/** The characters that may stand for `letter`: itself, its leetspeak, `*`. */
const classChars = (letter: string) => `${LEET[letter] ?? letter}*`;
const classOf = (letter: string) => `[${escapeClass(classChars(letter))}]`;

/** A form's letters as runs: each run of k equal letters is one step, its
 *  letter's class k or more times ("ass…" → a once, s twice). */
function runsOf(word: string): Array<{ letter: string; min: number }> {
  const runs: Array<{ letter: string; min: number }> = [];
  for (let i = 0; i < word.length; ) {
    let run = 1;
    while (word[i + run] === word[i]) run += 1;
    runs.push({ letter: word[i], min: run });
    i += run;
  }
  return runs;
}

/** A form's letters, each run of k equal letters allowing k or more. */
function compactPattern(word: string): string {
  return runsOf(word)
    .map(({ letter, min }) => `${classOf(letter)}${min === 1 ? "+" : `{${min},}`}`)
    .join("");
}

/** Every letter spaced out by the same kind of gap: "f u c k", "f.u.c.k". */
function spacedPattern(word: string): string {
  return [...word].map(classOf).join("[ \\t._~·•-]{1,2}");
}
/** The gap's characters, as `spacedPattern`'s class holds them. */
const GAP_CHARS = " \t._~·•-";

const WORD_FORMS: readonly string[] = WORDS_ROT13.flatMap((group) => group.split(" ")).map(rot13);
const PREFIX_FORMS: readonly string[] = PREFIX_ROT13.split(" ").map(rot13);
const INFIX_FORMS: readonly string[] = INFIX_ROT13.split(" ").map(rot13);

// No letter or digit on either side of a whole word.
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

/** One matcher: the forms of its alternation in order, whether no letter or
 *  digit may stand before / after a match, and how a form is spelled —
 *  its runs of letters (`compactPattern`) or spaced out (`spacedPattern`). */
type MatcherSpec = { forms: readonly string[]; before: boolean; after: boolean; spaced: boolean };
const MATCHER_SPECS: readonly MatcherSpec[] = [
  // A listed form on its own.
  { forms: [...WORD_FORMS, ...INFIX_FORMS], before: true, after: true, spaced: false },
  // A stem at a word's start, whatever follows.
  { forms: PREFIX_FORMS, before: true, after: false, spaced: false },
  // An infix stem anywhere.
  { forms: INFIX_FORMS, before: false, after: false, spaced: false },
  // A form spelled out letter by letter.
  { forms: [...WORD_FORMS, ...INFIX_FORMS], before: true, after: true, spaced: true },
];

const MATCHERS: readonly RegExp[] = MATCHER_SPECS.map(
  ({ forms, before, after, spaced }) =>
    new RegExp(
      `${before ? BEFORE : ""}(?:${forms.map(spaced ? spacedPattern : compactPattern).join("|")})${after ? AFTER : ""}`,
      "gu",
    ),
);

/** A match is a word only with real letters in it: one at least ("$h1t"
 *  has two, "5007" none), two once a `*` masks any ("f**k" yes, "c***" no,
 *  "****" no). */
function realEnough(match: string): boolean {
  const letters = match.match(/\p{L}/gu)?.length ?? 0;
  return match.includes("*") ? letters >= 2 : letters >= 1;
}

// ---------------------------------------------------------------------------
// Matching in linear time (perf, 2026-10-29) — the SAME matches as the
// regexes above, found without their backtracking.
//
// The regexes backtrack badly: every class holds `*`, so a long stretch of
// one class ("*s*s*s…", "ffff…") or of two ("*|*|…", "*c*c…") lets each `+`
// split it at every place, and the engine retries every split from every
// start. A 4000-character field cost 0.1–0.3 s ("*s" repeated) and up to
// 33 s ("*|" repeated) per call — on every keystroke in the creator and on
// every save on the server.
//
// Bounding the quantifiers or collapsing repeated characters would be
// faster, but it changes verdicts ("f*u*u*u*ck", a vowel run of u and v
// mixed), so neither is done. Instead such text is matched by an exact
// emulation of what the engine computes (`RunSearch`), with memoization:
//
// - Every form is a sequence of steps "characters of set X, at least m and
//   at most M times" (a letter's class m+ times; spaced out: a class once,
//   a gap once or twice). The engine returns, at the LEFTMOST start where
//   any form matches, the FIRST form in the alternation's order that
//   matches there, and for it the lengths a backtracking search meets
//   first: the longest first step that lets the rest match, then the
//   longest second step, and so on. A global search resumes at the match's
//   end. The emulation computes exactly that, in that order.
// - For a step at position p whose run of X ends at E, the engine tries
//   ends min(E, p+M), …, p+m and takes the first where the rest matches: the
//   answer is the LARGEST such q, with the rest's own match there. For an
//   unbounded step every start in the run shares E, so each (step, run) is
//   searched down from E only once, however many starts ask; each
//   (step, position) is evaluated once. The forms are a trie of shared
//   suffixes. Linear in the text times the steps that can match it.
// - Exact filters skip what cannot match: the next character must fit the
//   step or the one after it, and enough characters in classes must follow.
// - The look-behind / look-ahead read one code point each, as the engine
//   does under the `u` flag.
//
// Ordinary text keeps the regexes (fast, and what this file always ran):
// the emulation runs only where the regexes could be slow
// (`needsLinearSearch`) — real card text never is. Either way the matches,
// and so every verdict, are the same: tests/unit/moderation/
// profanity-linear.test.ts holds both engines to the regexes as `matchAll`
// ran them, match for match, on thousands of disguised words, near misses
// and adversarial strings.
// ---------------------------------------------------------------------------

/** For each ASCII code, the letters (bit 0 = a … bit 25 = z) of the forms
 *  whose class holds it — `*` holds them all. A letter no form spells has no
 *  class in any pattern, so it is in none here; nothing outside ASCII is. */
const CLASS_MEMBERS = new Int32Array(128);
const letterBit = (letter: string) => 1 << (letter.charCodeAt(0) - 97);
for (const letter of new Set([...WORD_FORMS, ...PREFIX_FORMS, ...INFIX_FORMS].join(""))) {
  for (const char of classChars(letter)) CLASS_MEMBERS[char.charCodeAt(0)] |= letterBit(letter);
}
const classMask = (code: number) => (code < 128 ? CLASS_MEMBERS[code] : 0);
/** The spaced-out forms' gap, as one more set (bit 26). */
const GAP_BIT = 1 << 26;
const LETTER_BITS = GAP_BIT - 1;
const GAP_CODES = new Set([...GAP_CHARS].map((char) => char.charCodeAt(0)));
/** Every set a character is in: the letters' classes and the gap. */
const setMask = (code: number) => classMask(code) | (GAP_CODES.has(code) ? GAP_BIT : 0);

/** One matcher as a trie of shared suffixes. Node 0 is a form's end; every
 *  other node is a step — a character of set `bit`, at least `min` and at
 *  most `max` times (0 = no limit), then node `next`. */
type RunMatcher = {
  before: boolean;
  after: boolean;
  bit: Int32Array;
  min: Int32Array;
  max: Int32Array;
  next: Int32Array;
  /** The sets the character after a step's first one must be in for the
   *  step to match (0 = any): its own when it needs two or more, the next
   *  step's when it takes one only, either when it may take one or more,
   *  none when a form may end there. */
  then: Int32Array;
  /** Spelled out letter by letter (`spacedPattern`)? */
  spaced: boolean;
  /** What a step and the steps after it need from where it starts, held to
   *  RunText's `stretch` (runs: the fewest characters they take) or
   *  `spelled` (spaced out: the letters still to spell; 0 on a gap). */
  reach: Int32Array;
  /** Per ASCII code, the forms' first nodes whose set holds it, in the
   *  alternation's order (a repeated node kept once: it answers the same). */
  firstNodes: readonly Int32Array[];
};

type Step = { bit: number; min: number; max: number };
/** A form's steps as the regex spells it (`compactPattern` / `spacedPattern`). */
function stepsOf(form: string, spaced: boolean): Step[] {
  if (!spaced) return runsOf(form).map(({ letter, min }) => ({ bit: letterBit(letter), min, max: 0 }));
  return [...form].flatMap((letter, i) => [
    ...(i > 0 ? [{ bit: GAP_BIT, min: 1, max: 2 }] : []),
    { bit: letterBit(letter), min: 1, max: 1 },
  ]);
}

function buildRunMatcher({ forms, before, after, spaced }: MatcherSpec): RunMatcher {
  const bit = [0];
  const min = [0];
  const max = [0];
  const next = [0];
  const ids = new Map<string, number>();
  const node = (step: Step, rest: number) => {
    const key = `${step.bit} ${step.min} ${step.max} ${rest}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = bit.length;
      bit.push(step.bit);
      min.push(step.min);
      max.push(step.max);
      next.push(rest);
      ids.set(key, id);
    }
    return id;
  };
  const roots = forms.map((form) => stepsOf(form, spaced).reduceRight((rest, step) => node(step, rest), 0));
  const then = bit.map((b, id) =>
    id === 0 ? 0 : min[id] > 1 ? b : next[id] === 0 ? 0 : max[id] === 1 ? bit[next[id]] : b | bit[next[id]],
  );
  // A node's next is always made before it, so one pass in id order works.
  const reach = min.map(() => 0);
  const letters = min.map(() => 0);
  for (let id = 1; id < bit.length; id++) {
    letters[id] = (bit[id] === GAP_BIT ? 0 : 1) + letters[next[id]];
    reach[id] = spaced ? (bit[id] === GAP_BIT ? 0 : letters[id]) : min[id] + reach[next[id]];
  }
  const firstNodes = Array.from({ length: 128 }, (_, code) =>
    Int32Array.from(new Set(roots.filter((root) => CLASS_MEMBERS[code] & bit[root]))),
  );
  return {
    before,
    after,
    bit: Int32Array.from(bit),
    min: Int32Array.from(min),
    max: Int32Array.from(max),
    next: Int32Array.from(next),
    then: Int32Array.from(then),
    spaced,
    reach: Int32Array.from(reach),
    firstNodes,
  };
}

/** Built on the first text that needs them, never at import: the module is
 *  in every page's client graph (the root layout's AI provider) and the
 *  tries cost a few ms to build on a phone. */
let runMatchers: readonly RunMatcher[] | undefined;
const runMatchersOf = () => (runMatchers ??= MATCHER_SPECS.map(buildRunMatcher));

/** Text the regexes could be slow on goes to the emulation (see above): a
 *  character sharing a class with the one before it more than SAFE_CHAIN
 *  times in a row, or more than MANY_STARS `*` (each one opens every form
 *  of the alternation at once). Real card text has neither. */
const SAFE_CHAIN = 12;
const MANY_STARS = 64;
const STAR = 42; // "*"

function needsLinearSearch(value: string): boolean {
  let chain = 0;
  let previous = 0;
  let stars = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const mask = classMask(code);
    chain = mask & previous ? chain + 1 : 0;
    if (code === STAR) stars += 1;
    if (chain > SAFE_CHAIN || stars > MANY_STARS) return true;
    previous = mask;
  }
  return false;
}

const WORD_CODE_POINT = /^[\p{L}\p{N}]$/u;
/** `[\p{L}\p{N}]` for one code point. */
function isWordCodePoint(cp: number): boolean {
  if (cp < 128) return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
  return WORD_CODE_POINT.test(String.fromCodePoint(cp));
}

// ---------------------------------------------------------------------------
// The emulation's memory is bounded: its memos hold one entry per position
// for each step it touches, so it reads one WINDOW of the text at a time —
// LINEAR_WINDOW characters where the text allows, one unbroken stretch of
// up to LINEAR_MAX where it does not — and every entry fits in 16 bits.
//
// A matcher's text is cut only at characters in none of ITS sets (a run
// form's: no letter's class — so a space or a dot is a cut; a spaced-out
// form's: no class and no gap): its matches never hold one, and the
// look-around reads the real character either side (positions are the
// text's), so each window meets exactly the matches the whole text's search
// meets there, in the same order — nothing past a cut goes unread.
//
// LINEAR_MAX is above any card field: they stop at 4000 UTF-16 units, and
// the normalisation makes one unit at most four class characters ("Ⅷ" →
// "viii"; every code point checked). A longer unbroken stretch goes to the
// regexes, as all text did before — the same matches, without the time
// bound for a run form (a spaced-out form's regex has bounded steps and
// stays linear).
// ---------------------------------------------------------------------------

const LINEAR_WINDOW = 4096;
const LINEAR_MAX = 16384;

type RunWindow = { start: number; end: number; linear: boolean };

/** A matcher's text cut into windows (see above), in order. `sets` are the
 *  sets its matches are made of: a character in none of them is a cut. */
function runWindowsOf(value: string, sets: number): RunWindow[] {
  const n = value.length;
  if (n <= LINEAR_WINDOW) return [{ start: 0, end: n, linear: true }];
  const isCut = (i: number) => (setMask(value.charCodeAt(i)) & sets) === 0;
  const windows: RunWindow[] = [];
  for (let start = 0; start < n; ) {
    if (n - start <= LINEAR_WINDOW) {
      windows.push({ start, end: n, linear: true });
      break;
    }
    let end = start + LINEAR_WINDOW;
    while (end > start && !isCut(end)) end -= 1;
    if (end === start) {
      // One unbroken stretch longer than a window: one window to its end,
      // by regex past LINEAR_MAX.
      end = start + LINEAR_WINDOW;
      while (end < n && !isCut(end)) end += 1;
      windows.push({ start, end, linear: end - start <= LINEAR_MAX });
    } else {
      windows.push({ start, end, linear: true });
    }
    start = end;
  }
  return windows;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The text as the emulation reads it, one window of it: each character's
 *  sets, and the run ends per set, filled as they are asked for. Positions
 *  are the window's (0 = `start`); the look-around reads the whole text. */
class RunText {
  readonly value: string;
  readonly start: number;
  readonly n: number;
  /** Per position, its sets (`setMask`); past the end reads as in none (the
   *  window ends at a character in none, or at the text's end). */
  readonly masks: Int32Array;
  /** Per position, how many characters from it on are in a letter's class —
   *  the most a run form starting there can take. */
  readonly stretch: Int16Array;
  /** Per position, the most letters a spaced-out form starting there can
   *  spell: a class character, then (one or two gap characters and a class
   *  character) as often as the text allows. */
  readonly spelled: Int16Array;
  private readonly runEnds: Array<Int16Array | undefined> = [];

  constructor(value: string, start: number, end: number) {
    this.value = value;
    this.start = start;
    this.n = end - start;
    const n = this.n;
    // Three spare zeros past the end: the reads below look up to i + 3.
    const masks = (this.masks = new Int32Array(n + 4));
    const stretch = (this.stretch = new Int16Array(n + 4));
    const spelled = (this.spelled = new Int16Array(n + 4));
    for (let i = 0; i < n; i++) masks[i] = setMask(value.charCodeAt(start + i));
    for (let i = n - 1; i >= 0; i--) {
      if (!(masks[i] & LETTER_BITS)) continue;
      stretch[i] = stretch[i + 1] + 1;
      let most = 1;
      if (masks[i + 1] & GAP_BIT) {
        if (masks[i + 2] & LETTER_BITS) most = Math.max(most, 1 + spelled[i + 2]);
        if (masks[i + 2] & GAP_BIT && masks[i + 3] & LETTER_BITS) most = Math.max(most, 1 + spelled[i + 3]);
      }
      spelled[i] = most;
    }
  }

  /** `(?<![\p{L}\p{N}])` at `p`: the code point before it is no letter or digit. */
  beforeOk(p: number): boolean {
    const at = this.start + p;
    if (at === 0) return true;
    const low = this.value.charCodeAt(at - 1);
    if (isLowSurrogate(low) && at >= 2) {
      const high = this.value.charCodeAt(at - 2);
      if (isHighSurrogate(high)) return !isWordCodePoint((high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000);
    }
    return !isWordCodePoint(low);
  }

  /** `(?![\p{L}\p{N}])` at `p`: the code point at it is no letter or digit. */
  afterOk(p: number): boolean {
    const at = this.start + p;
    return at >= this.value.length || !isWordCodePoint(this.value.codePointAt(at) as number);
  }

  /** Where the run of `bit`'s set holding `p` ends (p is in it). */
  runEnd(bit: number, p: number): number {
    const index = 31 - Math.clz32(bit);
    let ends = this.runEnds[index];
    if (!ends) ends = this.runEnds[index] = new Int16Array(this.n + 1);
    if (ends[p] !== 0) return ends[p] - 1;
    let end = p;
    while (this.masks[end] & bit && ends[end] === 0) end += 1;
    const runEnd = this.masks[end] & bit ? ends[end] - 1 : end;
    for (let i = p; i < end; i++) ends[i] = runEnd + 1;
    return runEnd;
  }
}

/** The forms' first nodes that may match at a character `code` followed
 *  by one in the sets `nextMask` — `firstNodes[code]` with those the next
 *  character rules out (`then`) left out, in the same order. Cached: a few
 *  dozen distinct masks exist. */
const FIRST_NODES_BEFORE = new Map<RunMatcher, Map<number, Int32Array>>();
function firstNodesBefore(matcher: RunMatcher, code: number, nextMask: number): Int32Array {
  let cache = FIRST_NODES_BEFORE.get(matcher);
  if (!cache) FIRST_NODES_BEFORE.set(matcher, (cache = new Map()));
  const key = code * 0x8000000 + nextMask; // 27 set bits
  let nodes = cache.get(key);
  if (!nodes) {
    nodes = matcher.firstNodes[code].filter((node) => matcher.then[node] === 0 || (nextMask & matcher.then[node]) !== 0);
    cache.set(key, nodes);
  }
  return nodes;
}

/** One matcher's emulated search over a text, with each node's memo. */
class RunSearch {
  private readonly matcher: RunMatcher;
  private readonly text: RunText;
  private readonly size: number;
  /** What the text offers each position, as `matcher.reach` counts it. */
  private readonly reach: Int16Array;
  private readonly memos: Array<Int16Array | undefined> = [];

  constructor(matcher: RunMatcher, text: RunText) {
    this.matcher = matcher;
    this.text = text;
    this.size = text.n + 1;
    this.reach = matcher.spaced ? text.spelled : text.stretch;
  }

  /** Where the regex's match of `node` (and the steps after it) starting at
   *  `p` ends — -1 for none. A node's memo: [0, n] its answer at p (+2;
   *  0 = not asked yet), then, for an unbounded step only, per run end E how
   *  far down from E the next node has been tried: 0 = not yet, v > 0 = down
   *  to v − 1 with no match, v < 0 = it matches at −v − 1 (the largest such
   *  q ≤ E). A window is at most LINEAR_MAX long: every entry fits in
   *  16 bits. */
  matchEnd(node: number, p: number): number {
    const { matcher, text } = this;
    if (node === 0) return !matcher.after || text.afterOk(p) ? p : -1;
    if (!this.mayMatch(node, p)) return -1;
    const size = this.size;
    const max = matcher.max[node];
    let memo = this.memos[node];
    if (!memo) memo = this.memos[node] = new Int16Array(max === 0 ? 2 * size : size);
    if (memo[p] !== 0) return memo[p] - 2;

    const next = matcher.next[node];
    const end = text.runEnd(matcher.bit[node], p);
    const lowest = p + matcher.min[node];
    let answer = -1;
    if (max !== 0) {
      // A bounded step (spaced out): at most `max` ends, longest first.
      for (let q = Math.min(end, p + max); q >= lowest && answer < 0; q--) {
        if (next === 0 || this.mayMatch(next, q)) answer = this.matchEnd(next, q);
      }
    } else if (lowest <= end) {
      const slot = size + end;
      let found = memo[slot] < 0 ? -memo[slot] - 1 : -1;
      if (found < 0) {
        // Down from the run's end, as the engine backtracks.
        let q = memo[slot] === 0 ? end + 1 : memo[slot] - 1;
        while (q > lowest) {
          q -= 1;
          if ((next === 0 || this.mayMatch(next, q)) && this.matchEnd(next, q) >= 0) {
            found = q;
            break;
          }
        }
        memo[slot] = found >= 0 ? -found - 1 : q + 1;
      }
      if (found >= lowest) answer = this.matchEnd(next, found);
    }
    memo[p] = answer + 2;
    return answer;
  }

  /** False when step `node` (not a form's end) cannot match at `p`: the
   *  character there, or the one after it, is in none of the sets it needs
   *  (`RunMatcher.then`), or the text from p cannot hold what it takes
   *  (`RunMatcher.reach`). Exact — it never refuses a match. */
  private mayMatch(node: number, p: number): boolean {
    const { matcher, text } = this;
    const then = matcher.then[node];
    return (
      (text.masks[p] & matcher.bit[node]) !== 0 &&
      (then === 0 || (text.masks[p + 1] & then) !== 0) &&
      matcher.reach[node] <= this.reach[p]
    );
  }

  /** Every match a global search of the window meets, in order, handed to
   *  `visit` (in the text's positions) until it says stop (true) — the
   *  regex's matches there. */
  matches(visit: (start: number, end: number) => boolean): boolean {
    const { matcher, text, reach } = this;
    const { value, n, masks } = text;
    const offset = text.start;
    for (let from = 0; ; ) {
      let start = -1;
      let end = -1;
      for (let p = from; p < n && start < 0; p++) {
        const code = value.charCodeAt(offset + p);
        if (code >= 128) continue;
        const nodes = firstNodesBefore(matcher, code, masks[p + 1]);
        if (nodes.length === 0 || (matcher.before && !text.beforeOk(p))) continue;
        for (let i = 0; i < nodes.length; i++) {
          if (matcher.reach[nodes[i]] > reach[p]) continue; // the text cannot hold it (mayMatch)
          const e = this.matchEnd(nodes[i], p);
          if (e >= 0) {
            start = p;
            end = e;
            break;
          }
        }
      }
      if (start < 0) return false;
      if (visit(offset + start, offset + end)) return true;
      from = end; // never empty: each step takes a character
    }
  }
}

/** Every match of a global regex, in order, handed to `visit` until it says
 *  stop — what `matchAll` iterates, without cloning the regex per call. The
 *  regexes are module-level and stateful (`lastIndex`): each search resets
 *  it first and runs to its end synchronously, so no two searches share it. */
function regexMatches(matcher: RegExp, value: string, visit: (start: number, end: number) => boolean): boolean {
  matcher.lastIndex = 0;
  for (let match = matcher.exec(value); match; match = matcher.exec(value)) {
    const start = match.index;
    const end = start + match[0].length;
    if (end === start) matcher.lastIndex = end + ((value.codePointAt(end) ?? 0) > 0xffff ? 2 : 1); // as matchAll steps
    if (visit(start, end)) return true;
  }
  return false;
}

type Engine = "regex" | "runs";

/** One matcher's regex over the window [start, end) alone — a window that
 *  starts and ends at characters in no set (`runWindowsOf`) — read with the
 *  code point either side as its context, in the text's positions. */
function regexMatchesIn(
  regex: RegExp,
  value: string,
  start: number,
  end: number,
  visit: (start: number, end: number) => boolean,
): boolean {
  if (start === 0 && end === value.length) return regexMatches(regex, value, visit);
  const from = start > 0 && isLowSurrogate(value.charCodeAt(start)) && isHighSurrogate(value.charCodeAt(start - 1)) ? start - 1 : start;
  const to =
    end >= value.length
      ? value.length
      : end + (isHighSurrogate(value.charCodeAt(end)) && isLowSurrogate(value.charCodeAt(end + 1)) ? 2 : 1);
  return regexMatches(regex, value.slice(from, to), (s, e) => visit(from + s, from + e));
}

/** Each matcher's search over the normalised text, as [matcher, start, end]
 *  handed to `visit` until it says stop. `engine` picks the regexes or the
 *  emulation (window by window); both meet the same matches. */
function searchAll(value: string, engine: Engine, visit: (matcher: number, start: number, end: number) => boolean): boolean {
  if (engine === "regex") {
    return MATCHERS.some((regex, index) => regexMatches(regex, value, (start, end) => visit(index, start, end)));
  }
  const matchers = runMatchersOf();
  // One window (every card field): its text is read once for all four.
  const only = value.length <= LINEAR_WINDOW ? new RunText(value, 0, value.length) : null;
  const windowsBy = new Map<number, RunWindow[]>();
  return MATCHERS.some((regex, index) => {
    const sets = matchers[index].spaced ? LETTER_BITS | GAP_BIT : LETTER_BITS;
    let windows = windowsBy.get(sets);
    if (!windows) windowsBy.set(sets, (windows = runWindowsOf(value, sets)));
    return windows.some(({ start, end, linear }) => {
      const at = (s: number, e: number) => visit(index, s, e);
      if (!linear) return regexMatchesIn(regex, value, start, end, at);
      return new RunSearch(matchers[index], only ?? new RunText(value, start, end)).matches(at);
    });
  });
}

/** For the equivalence tests only: every match each matcher meets in
 *  `text` (normalised), through the chosen engine. */
export function profanityMatchesForTests(text: string, engine: Engine): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  searchAll(normalized(text), engine, (matcher, start, end) => {
    out.push([matcher, start, end]);
    return false;
  });
  return out;
}

/** For the equivalence tests only: the verdict through the chosen engine. */
export function containsProfanityForTests(text: string | null | undefined, engine: Engine): boolean {
  if (!text) return false;
  const value = normalized(text);
  return searchAll(value, engine, (_matcher, start, end) => realEnough(value.slice(start, end)));
}

/** For the equivalence tests only: the regexes' sources (the oracle builds
 *  the ones this file shipped with and compares). */
export function profanityPatternSourcesForTests(): string[] {
  return MATCHERS.map((regex) => regex.source);
}

/** For the tests only: which engine the detector picks for `text`. */
export function profanityEngineForTests(text: string): Engine {
  return needsLinearSearch(normalized(text)) ? "runs" : "regex";
}

/** For the equivalence tests only: the lists, decoded (the oracle builds its
 *  regexes from them, so a list change keeps it in step). */
export const PROFANITY_FORMS_FOR_TESTS = { words: WORD_FORMS, prefixes: PREFIX_FORMS, infixes: INFIX_FORMS } as const;

// Characters that draw nothing: a soft hyphen or a zero-width joiner inside
// a word must not split it.
const INVISIBLE = new RegExp("[\\u00AD\\u200B-\\u200F\\u2060\\uFEFF]", "g");

// Cyrillic and Greek letters that look like Latin ones (lower case, after
// NFKD), folded to the Latin letter they pass for.
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
  "і": "i", "ї": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ɩ": "i",
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ζ": "z",
};
const LOOK_ALIKE_RE = new RegExp(`[${Object.keys(LOOK_ALIKES).join("")}]`, "gu");

/** The text as the matcher reads it: no accents, no invisible characters,
 *  full-width and other compatibility forms folded, Cyrillic / Greek
 *  look-alikes folded to Latin, lower case. */
function normalized(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .replace(LOOK_ALIKE_RE, (c) => LOOK_ALIKES[c] ?? c);
}

/** True when `text` holds strong language — a listed word on its own (or
 *  disguised), a listed stem at a word's start, or an infix stem anywhere. */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const value = normalized(text);
  return searchAll(value, needsLinearSearch(value) ? "runs" : "regex", (_matcher, start, end) =>
    realEnough(value.slice(start, end)),
  );
}

/** A field's text as an EDIT compares it (lib/cards/actions.ts, the
 *  creator): its words, normalised, as a set — so a stored text and the
 *  same text resent (typography kept, rows dual-written beside the rules,
 *  tags as a list or as typed) read as unchanged, and any word added,
 *  changed or removed reads as an edit. */
function wordsOf(texts: readonly string[]): string {
  const words = new Set<string>();
  for (const text of texts) {
    for (const word of normalized(text).split(/[^\p{L}\p{N}*$@!|+(]+/u)) if (word) words.add(word);
  }
  return [...words].sort().join(" ");
}

// ---------------------------------------------------------------------------
// A card's text fields
// ---------------------------------------------------------------------------

/** The places a card's text lives, as the creator and the notice name them.
 *  The type line is one field (supertype, the typed Types line, subtypes);
 *  a walker's / saga's / station card's rows are its rules text; the
 *  printed stats and the collector line (P/T, loyalty, defense, set code,
 *  collector number, a cost's unrecognised `{…}` symbols) are one. */
export const PROFANITY_FIELDS = [
  "title",
  "nickname",
  "type_line",
  "rules_text",
  "flavor_text",
  "artist_credit",
  "stats",
  "footer_text",
  "tags",
  "back_face.title",
  "back_face.type_line",
  "back_face.rules_text",
  "back_face.flavor_text",
  "back_face.artist_credit",
  "back_face.stats",
] as const;

export type ProfanityField = (typeof PROFANITY_FIELDS)[number];

const FIELD_LABELS: Readonly<Record<ProfanityField, string>> = {
  title: "name",
  nickname: "nickname",
  type_line: "type line",
  rules_text: "rules text",
  flavor_text: "flavor text",
  artist_credit: "artist credit",
  stats: "stats / collector line",
  footer_text: "footer mark",
  tags: "tags",
  "back_face.title": "second face's name",
  "back_face.type_line": "second face's type line",
  "back_face.rules_text": "second face's rules text",
  "back_face.flavor_text": "second face's flavor text",
  "back_face.artist_credit": "second face's artist credit",
  "back_face.stats": "second face's stats",
};

/** A card's text as any save path holds it: a payload or a stored row
 *  (`subtypes`, `tags`, `face_content`) or the creator's form values
 *  (`subtypes_text`, `tags_text`, the loyalty / saga rows). Every key is
 *  optional and read loosely — a value of the wrong shape is no text. */
export type ProfanityScanInput = {
  title?: unknown;
  nickname?: unknown;
  supertype?: unknown;
  printed_types?: unknown;
  subtypes?: unknown;
  subtypes_text?: unknown;
  rules_text?: unknown;
  /** Walker / saga / station rows (cards.face_content). */
  face_content?: unknown;
  loyalty_abilities?: unknown;
  saga_intro?: unknown;
  saga_chapters?: unknown;
  flavor_text?: unknown;
  artist_credit?: unknown;
  /** The printed stats and collector line. */
  cost?: unknown;
  power?: unknown;
  toughness?: unknown;
  loyalty?: unknown;
  defense?: unknown;
  set_code?: unknown;
  collector_number?: unknown;
  footer_text?: unknown;
  tags?: unknown;
  tags_text?: unknown;
  /** The second face / part: the same keys (its own name, type line,
   *  rules, flavour, artist and stats). */
  back_face?: unknown;
};

/** Every string inside a value (a string, an array of them, rows of
 *  objects), depth-first. Numbers, booleans and null hold no text. */
function textsOf(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return [value];
  if (depth > 4 || value === null || typeof value !== "object") return [];
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.flatMap((child) => textsOf(child, depth + 1));
}

// A cost's symbols the card prints as symbols — colours, generic numbers,
// X / Y / Z, snow, tap / untap, energy, Phyrexian, hybrid and twobrid,
// half, infinity, chaos. Anything else inside `{…}` is text to the reader.
const COST_SYMBOL =
  /^(?:[wubrgcsxyzteqpa]|\d{1,3}|[wubrgc2](?:\/[wubrgcp])(?:\/p)?|h[wubrgcr]|½|∞|chaos|pw|tk|l)$/i;

/** A cost as text: what sits outside its symbols, and every `{…}` that is
 *  no symbol. */
function costTexts(cost: unknown): string[] {
  if (typeof cost !== "string") return [];
  return [cost.replace(/\{([^}]*)\}/g, (_token, inner: string) => (COST_SYMBOL.test(inner.trim()) ? " " : ` ${inner} `))];
}

type FieldTexts = Map<ProfanityField, string[]>;

/** One face's texts, field by field (unprefixed). */
function faceTexts(face: ProfanityScanInput, front: boolean): Array<[ProfanityField, string[]]> {
  return [
    ["title", textsOf(face.title)],
    ["nickname", front ? textsOf(face.nickname) : []],
    ["type_line", [face.supertype, face.printed_types, face.subtypes, face.subtypes_text].flatMap((v) => textsOf(v))],
    [
      "rules_text",
      [face.rules_text, ...(front ? [face.face_content, face.loyalty_abilities, face.saga_intro, face.saga_chapters] : [])].flatMap((v) =>
        textsOf(v),
      ),
    ],
    ["flavor_text", textsOf(face.flavor_text)],
    ["artist_credit", textsOf(face.artist_credit)],
    [
      "stats",
      [
        ...costTexts(face.cost),
        ...[face.power, face.toughness, face.loyalty, face.defense, ...(front ? [face.set_code, face.collector_number] : [])].flatMap((v) =>
          textsOf(v),
        ),
      ],
    ],
  ];
}

/** Every field's texts. */
function fieldTextsOf(card: ProfanityScanInput): FieldTexts {
  const out: FieldTexts = new Map(faceTexts(card, true));
  out.set("footer_text", textsOf(card.footer_text));
  out.set("tags", [card.tags, card.tags_text].flatMap((v) => textsOf(v)));
  const back = card.back_face;
  if (back && typeof back === "object" && !Array.isArray(back)) {
    for (const [field, texts] of faceTexts(back as ProfanityScanInput, false)) {
      out.set(`back_face.${field}` as ProfanityField, texts);
    }
  }
  return out;
}

const profaneIn = (texts: FieldTexts) =>
  PROFANITY_FIELDS.filter((field) => (texts.get(field) ?? []).some(containsProfanity));

/** The fields of a card whose text holds strong language, in the order
 *  PROFANITY_FIELDS lists them — empty for a clean card. */
export function profaneFields(card: ProfanityScanInput | null | undefined): ProfanityField[] {
  return card ? profaneIn(fieldTextsOf(card)) : [];
}

// ---------------------------------------------------------------------------
// The rule every save applies
// ---------------------------------------------------------------------------

type VisibilityValue = "public" | "unlisted" | "private";
const AUDIENCE: Readonly<Record<VisibilityValue, number>> = { private: 0, unlisted: 1, public: 2 };

/**
 * The fields that make THIS save private — empty when the card saves as
 * asked. `saved` is the card as it will be stored, `visibility` the one the
 * save would store. A private save is never forced (nothing to force).
 *
 * An EDIT (`stored` = the row before it) of a card that is already public
 * or unlisted is left as it is only while every field that holds strong
 * language held it before with its text UNCHANGED (its words, normalised —
 * wordsOf) and the edit asks for no wider audience: the policy is not
 * applied retroactively, and an edit never changes what its maker did not
 * touch (CLAUDE.md). Typing a new word, editing a flagged field in any way,
 * or publishing a draft whose text holds one makes it private.
 */
export function languageForcesPrivate(input: {
  saved: ProfanityScanInput;
  visibility: VisibilityValue | string | null | undefined;
  stored?: { card: ProfanityScanInput; visibility: VisibilityValue | string | null | undefined } | null;
}): ProfanityField[] {
  const visibility = input.visibility as VisibilityValue;
  if (!(visibility in AUDIENCE) || visibility === "private") return [];
  const saved = fieldTextsOf(input.saved);
  const fields = profaneIn(saved);
  if (fields.length === 0 || !input.stored) return fields;
  const storedVisibility = input.stored.visibility as VisibilityValue;
  if (!(storedVisibility in AUDIENCE) || storedVisibility === "private") return fields;
  if (AUDIENCE[visibility] > AUDIENCE[storedVisibility]) return fields;
  const stored = fieldTextsOf(input.stored.card);
  const untouched = (field: ProfanityField) =>
    (stored.get(field) ?? []).some(containsProfanity) &&
    wordsOf(stored.get(field) ?? []) === wordsOf(saved.get(field) ?? []);
  return fields.every(untouched) ? [] : fields;
}

/** `languageForcesPrivate` for a public AND an unlisted save at once (the
 *  creator's Publish step shows both choices), reading the text ONCE: the
 *  same rule, step for step, so each answer equals its own call. */
export function languageForcesPrivateByVisibility(input: {
  saved: ProfanityScanInput;
  stored?: { card: ProfanityScanInput; visibility: VisibilityValue | string | null | undefined } | null;
}): { public: ProfanityField[]; unlisted: ProfanityField[] } {
  const saved = fieldTextsOf(input.saved);
  const fields = profaneIn(saved);
  const both = () => ({ public: fields, unlisted: [...fields] });
  if (fields.length === 0 || !input.stored) return both();
  const storedVisibility = input.stored.visibility as VisibilityValue;
  if (!(storedVisibility in AUDIENCE) || storedVisibility === "private") return both();
  const storedCard = input.stored.card;
  // Asked at most once, and only when an answer needs it.
  let leftAlone: boolean | undefined;
  const untouched = () => {
    if (leftAlone === undefined) {
      const stored = fieldTextsOf(storedCard);
      leftAlone = fields.every(
        (field) =>
          (stored.get(field) ?? []).some(containsProfanity) &&
          wordsOf(stored.get(field) ?? []) === wordsOf(saved.get(field) ?? []),
      );
    }
    return leftAlone;
  };
  const at = (visibility: "public" | "unlisted") =>
    AUDIENCE[visibility] > AUDIENCE[storedVisibility] || !untouched() ? [...fields] : [];
  return { public: at("public"), unlisted: at("unlisted") };
}

// ---------------------------------------------------------------------------
// The notice and its words — one copy source for the creator's note, its
// toasts, the AI runner and My Cards.
// ---------------------------------------------------------------------------

/** What a save says when it stored a card PRIVATE that asked to be public
 *  or unlisted, because its text holds strong language. */
export type ForcedPrivateNotice = { reason: "profanity"; fields: ProfanityField[] };

/** "rules text", "name and rules text", "name, tags and rules text". */
export function profaneFieldList(fields: readonly ProfanityField[]): string {
  const labels = fields.map((field) => FIELD_LABELS[field]);
  if (labels.length === 0) return "text";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The creator's note while the text holds strong language. */
export function strongLanguageNote(fields: readonly ProfanityField[]): string {
  return `This card's ${profaneFieldList(fields)} includes strong language, so it will be saved as private. Remove it to publish.`;
}

/** Why a save landed private (the toast after it). */
export function strongLanguageSavedMessage(title: string, fields: readonly ProfanityField[]): string {
  return `Saved “${title}” as private — its ${profaneFieldList(fields)} includes strong language. Remove it to publish.`;
}

/** An AI card saved private for its text (the job runner's toast). */
export function generatedPrivateMessage(label: string, fields: readonly ProfanityField[]): string {
  return `“${label}” was saved as private — its ${profaneFieldList(fields)} includes strong language. Remove it to publish.`;
}

/** The same in a batch (a deck): told once, the details list every card. */
export function generatedPrivateInBatchMessage(firstLabel: string): string {
  return `Cards whose text includes strong language were saved as private — “${firstLabel}” is one. The generation details list them all.`;
}

/** The line a generation's details show on such a card's step. */
export const GENERATED_PRIVATE_STEP_NOTE = "Saved as private — strong language";

/** The reason a Public / Unlisted choice is unavailable (its description). */
export const STRONG_LANGUAGE_CHOICE_REASON = "Unavailable — this card's text includes strong language.";
