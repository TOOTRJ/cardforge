import { describe, expect, it } from "vitest";
import { FRAME_SIGNATURE_KEYS, FRAME_SIGNATURE_RULES, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import anatomyPrintings from "../scryfall/fixtures/anatomy-printings.json";
import adventurePrintings from "../scryfall/fixtures/adventure-part-colour-printings.json";
import otpPrintings from "../scryfall/fixtures/otp-breaking-news-printings.json";
import signaturePrintings from "../scryfall/fixtures/signature-printings.json";
import {
  frameRequestAnswered,
  isForGoodSignature,
  printedBorderOfRowSet,
  signatureAnsweredOnceVerified,
  signatureBlockedBy,
} from "@/lib/frames/frame-requests";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";
import { FRAME_COLOR_KEYS, frameComboKey, frameReferenceOptions } from "@/lib/cards/frame-reference-registry";
import {
  REQUESTED_FRAMES_MAX_KEYS,
  REQUESTED_FRAMES_MIN_PEOPLE,
  answeredSignaturePairs,
  exactFramesOfSignature,
  mapRequestedFrames,
  peopleLabel,
  publicFrameLabel,
  publicSignatures,
  requestedFrameStatus,
  splitSignature,
} from "@/lib/frames/requested-frames";

// ---------------------------------------------------------------------------
// The public "Requested frames" list (TODO NV12 part 1). Every word a reader
// sees comes from the registry or this module's two tables — never from a
// frame_requests row, whose signature and label are any text a signed-in
// caller handed record_frame_request(). Held here: the tables cover the
// registry key for key, the never-built families stay off, the answered
// pairs are real, the mapping drops anything it can't name or that fewer
// than k people asked for, and the status comes from the registry and the
// verified combos alone.
// ---------------------------------------------------------------------------

describe("public frame names", () => {
  it("names every registry key except the never-built and not-planned ones", () => {
    const unnamed = FRAME_SIGNATURE_KEYS.filter((key) => publicFrameLabel(key) === null);
    expect(unnamed.sort()).toEqual(
      [
        ...FRAME_SIGNATURE_KEYS.filter((key) => isForGoodSignature(key)),
        "no-card-type",
        "emblem/one-off",
        "unknown-frame",
      ].sort(),
    );
  });

  it("uses the rule's own label where it is plain text, and a gap phrase for a gap signature", () => {
    expect(publicFrameLabel("japan-showcase")).toEqual({ label: "Japan showcase", detail: null });
    expect(publicFrameLabel("borderless/standard+nickname")).toEqual({
      label: "Borderless frame",
      detail: "The nickname plate",
    });
    expect(publicFrameLabel("borderless/planeswalker+two-colour")).toEqual({
      label: "Borderless planeswalker",
      detail: "The two-colour split frame",
    });
    // A label the rule computes from the printing gets one family name.
    expect(publicFrameLabel("showcase/thb/constellation")?.label).toBe("Theros constellation showcase");
    expect(publicFrameLabel("layout/2015+crown")).toEqual({
      label: "Saga, adventure, split and other layout frames",
      detail: "The legendary crown",
    });
  });

  it("has words for every function-labelled rule and every gap the registry's keys use", () => {
    for (const rule of FRAME_SIGNATURE_RULES) {
      if (publicFrameLabel(rule.key) === null) continue;
      const name = publicFrameLabel(rule.key)!;
      expect(name.label.trim().length, rule.key).toBeGreaterThan(0);
      if (splitSignature(rule.key).gap !== null) expect(name.detail, rule.key).toBeTruthy();
    }
  });

  it("never names a key the registry doesn't have — whatever a row says", () => {
    expect(publicFrameLabel("retired/seed-example")).toBeNull();
    expect(publicFrameLabel("evil <script>alert(1)</script>")).toBeNull();
    expect(publicFrameLabel("borderless/standard+not-a-gap")).toBeNull();
  });

  it("splits a signature at its first plus", () => {
    expect(splitSignature("era/2015+nyx")).toEqual({ base: "era/2015", gap: "nyx" });
    expect(splitSignature("future")).toEqual({ base: "future", gap: null });
  });
});

describe("what the page passes the database", () => {
  it("p_signatures: registry keys only, never a forGood family", () => {
    const keys = publicSignatures();
    expect(keys.length).toBeGreaterThan(200);
    for (const key of keys) {
      expect(FRAME_SIGNATURE_KEYS, key).toContain(key);
      expect(isForGoodSignature(key), key).toBe(false);
    }
    expect(keys).not.toContain("borderless/poster");
    expect(keys).not.toContain("unknown-frame");
  });

  it("p_answered: every pair is a gap signature PipGlyph draws on that frame today", () => {
    const pairs = answeredSignaturePairs();
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      const [signature, template] = pair.split("|");
      expect(signature, pair).toContain("+");
      expect(signatureDrawnOn(signature, template), pair).toBe(true);
    }
    // The crown on the borderless frame shipped with 4.6f.
    expect(pairs).toContain("borderless/standard+crown|m15borderless");
    // The nickname plate on borderless did not.
    expect(pairs.some((pair) => pair.startsWith("borderless/standard+nickname|"))).toBe(false);
  });
});

/** Every template × colour, verified — and the same less what `drop` names. */
const ALL_VERIFIED = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((c) => frameComboKey(t, c))));
const verifiedExcept = (...drop: string[]) => new Set([...ALL_VERIFIED].filter((key) => !drop.includes(key)));
const NONE = new Set<string>();

describe("the list", () => {
  it("maps rows to named frames with a status from the verified combos, most people first", () => {
    const frames = mapRequestedFrames(
      [
        { signature: "borderless/standard+nickname", people: "2" },
        { signature: "extendedart", people: 3 },
        { signature: "japan-showcase", people: "3" },
      ],
      NONE,
    );
    expect(frames).toEqual([
      { signature: "extendedart", label: "Extended-art frame", detail: null, people: 3, status: "checking" },
      { signature: "japan-showcase", label: "Japan showcase", detail: null, people: 3, status: "requested" },
      {
        signature: "borderless/standard+nickname",
        label: "Borderless frame",
        detail: "The nickname plate",
        people: 2,
        status: "requested",
      },
    ]);
    // The aggregate's shape: nothing but the frame's words, a count and a status.
    for (const frame of frames) expect(Object.keys(frame).sort()).toEqual(["detail", "label", "people", "signature", "status"]);
  });

  it("drops a row it can't name, one under k people, and a for-good family", () => {
    expect(REQUESTED_FRAMES_MIN_PEOPLE).toBe(2);
    expect(
      mapRequestedFrames(
        [
          { signature: "evil <script>alert(1)</script>", people: 9 },
          { signature: "retired/seed-example", people: 4 },
          { signature: "japan-showcase", people: 1 },
          { signature: "extendedart", people: 0 },
          { signature: "future", people: "x" },
          { signature: "borderless/poster", people: 3 },
        ],
        NONE,
      ),
    ).toEqual([]);
  });
});

describe("requestedFrameStatus — the registry and the verified combos, never a row", () => {
  it("is Requested where PipGlyph has no exact frame: a nearest rule, any gap signature", () => {
    for (const signature of ["japan-showcase", "future", "borderless/standard+nickname", "extendedart+crown"]) {
      expect(exactFramesOfSignature(signature), signature).toEqual([]);
      expect(requestedFrameStatus(signature, ALL_VERIFIED), signature).toBe("requested");
    }
  });

  it("is Built once every frame it is exact on is verified in every printed colour, else Being checked", () => {
    const frames = exactFramesOfSignature("extendedart");
    expect(frames).toContain("extendedart");
    expect(requestedFrameStatus("extendedart", ALL_VERIFIED)).toBe("built");
    expect(requestedFrameStatus("extendedart", NONE)).toBe("checking");
    // One printed colour still to verify keeps it "Being checked".
    const printed = FRAME_COLOR_KEYS.find((colour) => frameReferenceOptions(frames[0], colour).length > 0)!;
    expect(requestedFrameStatus("extendedart", verifiedExcept(frameComboKey(frames[0], printed)))).toBe("checking");
    // A colour no printing exists in is never waited for.
    const unprinted = FRAME_COLOR_KEYS.filter((colour) => frameReferenceOptions(frames[0], colour).length === 0);
    if (unprinted.length > 0) {
      expect(requestedFrameStatus("extendedart", verifiedExcept(frameComboKey(frames[0], unprinted[0])))).toBe("built");
    }
  });

  it("reads a frame named once verified as built only where it would be exact (exactOnceVerified)", () => {
    // The M20 token design: the stand-in arch is not the frame the printing wears.
    const m20 = exactFramesOfSignature("token/m20");
    expect(m20.length).toBeGreaterThan(0);
    expect(m20.every((template) => template.startsWith("m20token"))).toBe(true);
    expect(requestedFrameStatus("token/m20", NONE)).toBe("checking");
    // Rule for rule: a frame to check exactly when the registry answers exact,
    // or names a frame once verified that is exact on it.
    for (const rule of FRAME_SIGNATURE_RULES) {
      if (splitSignature(rule.key).gap !== null) continue;
      const { outcome } = rule;
      const exact = outcome.status === "exact" || (outcome.onceVerified !== undefined && outcome.exactOnceVerified === true);
      expect(exactFramesOfSignature(rule.key).length > 0, rule.key).toBe(exact);
    }
  });

  it("covers every public signature without throwing", () => {
    for (const signature of publicSignatures()) {
      expect(["requested", "checking", "built"]).toContain(requestedFrameStatus(signature, ALL_VERIFIED));
    }
  });

  it("says people, not requests", () => {
    expect(peopleLabel(1)).toBe("1 person");
    expect(peopleLabel(4)).toBe("4 people");
  });
});

// ---------------------------------------------------------------------------
// Rows that can clear (frames audit 2026-11-22): rows whose frame is built
// and verified, yet stayed on the list — and the items they pointed at.
// ---------------------------------------------------------------------------

/** A row as the admin page reads it. */
const row = (signature: string, template: string | null, setCode: string | null = null) => ({ signature, template, setCode });
const everyColourOf = (...templates: FrameTemplate[]) =>
  new Set(templates.flatMap((t) => FRAME_COLOR_KEYS.map((c) => frameComboKey(t, c))));

describe("the layout frames' two-colour gap is answered frame by frame (its item is a function of the frame)", () => {
  it("a split or aftermath row is answered: two one-colour parts since 4.26, never a hybrid row", () => {
    const pairs = answeredSignaturePairs();
    expect(pairs).toContain("layout/2015+two-colour|split");
    expect(pairs).toContain("layout/2015+two-colour|aftermath");
    expect(frameRequestAnswered(row("layout/2015+two-colour", "split"), NONE)).toBe(true);
  });

  it("an adventure's stays open on 4.6f, the saga's is answered since its own 4.6f family drew the pairs, and the hybrid split stays open", () => {
    const pairs = answeredSignaturePairs(ALL_VERIFIED);
    for (const pair of ["layout/2015+two-colour|adventure", "layout/2015+two-colour-hybrid|split", "layout/2015+two-colour-hybrid|saga"]) {
      expect(pairs, pair).not.toContain(pair);
    }
    // TODO 4.6f (owner 2026-11-25): the saga draws the gold-split dress (no
    // hybrid saga was printed).
    expect(pairs).toContain("layout/2015+two-colour|saga");
    expect(frameRequestAnswered(row("layout/2015+two-colour", "saga"), ALL_VERIFIED)).toBe(true);
    expect(signatureBlockedBy("layout/2015+two-colour", "adventure")).toBe("4.6f");
    expect(signatureBlockedBy("layout/2015+two-colour", "split")).toBe("4.26");
  });

  it("a rule whose gap is older than its hybrid twin still keeps a split-only creature frame's row open", () => {
    // era/2015's "+two-colour" rows from before 2026-09-29 may be hybrid.
    expect(signatureDrawnOn("era/2015+two-colour", "m15artifact")).toBe(false);
    // The Vehicle's gap was born beside its hybrid twin: its rows never are.
    expect(signatureDrawnOn("vehicle/2015+two-colour", "m15vehicle")).toBe(true);
  });
});

describe("a row logged on a fall-forward frame is never answered there (the independent check, 2026-11-22)", () => {
  // The creator logs the frame the form LANDED on: where the saga /
  // adventure / walker frame wasn't published in the colour, the plain one.
  // The printing still lands on its own frame today, where the gap holds.
  const printing = (data: Record<string, unknown>, key: string) => frameMatchFromScryfall(scryfallCardSchema.parse(data[key]));
  const LAYOUT_ROWS: [string, Record<string, unknown>, string, string][] = [
    ["mh3-196", adventurePrintings.printings, "layout/2015+two-colour", "adventure"], // a two-colour adventure
    ["eld-212", adventurePrintings.printings, "layout/2015+two-colour-hybrid", "adventure"], // a hybrid adventure
  ];

  it.each(LAYOUT_ROWS)("%s: open on its layout frame today, and its row on the plain frame stays open", (key, data, signature, frame) => {
    const match = printing(data, key);
    expect(match).toMatchObject({ signature, status: "nearest", template: frame });
    for (const template of ["m15", "m15land", "m15artifact", "m15snow", "m15snowland", "m15devoid"]) {
      expect(frameRequestAnswered(row(signature, template), ALL_VERIFIED), `${signature} on ${template}`).toBe(false);
      expect(answeredSignaturePairs(ALL_VERIFIED), `${signature} on ${template}`).not.toContain(`${signature}|${template}`);
    }
    expect(frameRequestAnswered(row(signature, frame), ALL_VERIFIED)).toBe(false);
  });

  it("khm-201: exact on the saga frame since 4.6f drew its pairs — its row on its own frame is answered, on the plain frame it stays open", () => {
    const match = printing(anatomyPrintings, "khm-201");
    expect(match).toMatchObject({ signature: "layout/2015", status: "exact", template: "saga" });
    for (const template of ["m15", "m15land", "m15artifact", "m15snow", "m15snowland", "m15devoid"]) {
      expect(frameRequestAnswered(row("layout/2015+two-colour", template), ALL_VERIFIED), `on ${template}`).toBe(false);
    }
    expect(frameRequestAnswered(row("layout/2015+two-colour", "saga"), ALL_VERIFIED)).toBe(true);
  });

  it("a borderless walker's two-colour row on the plain frame or the bordered walker frame stays open", () => {
    for (const [key, data] of [["otp-77", otpPrintings], ["dmu-375", signaturePrintings]] as const) {
      const match = printing(data, key);
      expect(match.gaps ?? [], key).toContain("two-colour");
      for (const template of ["m15", "m15pw", match.landOn ?? match.template]) {
        expect(frameRequestAnswered(row(match.signature, template), ALL_VERIFIED), `${key} on ${template}`).toBe(false);
      }
    }
    expect(answeredSignaturePairs(ALL_VERIFIED)).not.toContain("borderless/planeswalker+two-colour|m15");
  });
});

describe("the borderless Spacecraft lands on the bordered Station frame by design", () => {
  it("its row on the bordered Station frame is answered; the item is 1.18's landing rule, not 4.27a", () => {
    expect(answeredSignaturePairs()).toContain("borderless/standard+station|m15station");
    expect(frameRequestAnswered(row("borderless/standard+station", "m15station"), NONE)).toBe(true);
    expect(signatureBlockedBy("borderless/standard+station", "m15artifact")).toBe("1.18");
  });

  it("a row logged on the artifact frame before the Station frame was ticked is answered once it is, in every printed colour", () => {
    const station = everyColourOf("m15station");
    expect(answeredSignaturePairs(NONE)).not.toContain("borderless/standard+station|m15artifact");
    expect(answeredSignaturePairs(station)).toContain("borderless/standard+station|m15artifact");
    expect(frameRequestAnswered(row("borderless/standard+station", "m15artifact"), station)).toBe(true);
    const printed = FRAME_COLOR_KEYS.find((c) => frameReferenceOptions("m15station", c).length > 0)!;
    const short = new Set([...station].filter((key) => key !== frameComboKey("m15station", printed)));
    expect(frameRequestAnswered(row("borderless/standard+station", "m15artifact"), short)).toBe(false);
  });

  it("the other station dresses keep their items: a showcase is 4.11's, extended art answers on its own frame", () => {
    expect(answeredSignaturePairs(ALL_VERIFIED)).not.toContain("showcase+station|m15station");
    expect(signatureBlockedBy("borderless/showcase+station", "m15land")).toBe("4.11");
    const own = everyColourOf("extendedartstation");
    expect(answeredSignaturePairs(own)).toContain("extendedart+station|extendedart");
    // …and on the bordered Station frame it stood in on meanwhile.
    expect(answeredSignaturePairs(NONE)).not.toContain("extendedart+station|m15station");
    expect(answeredSignaturePairs(own)).toContain("extendedart+station|m15station");
  });
});

describe("a borderless printing's row on its BORDERED landing is answered once the borderless twin draws the piece", () => {
  it("the crown: drawn on m15borderless / m15borderlessartifact since 4.6f wave 2a", () => {
    const pairs = answeredSignaturePairs();
    expect(pairs).toContain("borderless/standard+crown|m15");
    expect(pairs).toContain("borderless/standard+crown|m15artifact");
  });

  it("not where the twin doesn't draw it: the borderless land has no crown", () => {
    expect(answeredSignaturePairs(ALL_VERIFIED)).not.toContain("borderless/land+crown|m15land");
    expect(signatureDrawnOn("borderless/land+crown", "m15land")).toBe(false);
  });
});

describe("a \"+border\" row: the white border is drawn on the 1997 and 2003 frames, read off the row's set", () => {
  it("answered on the admin page for a white-bordered set, open for a gold or silver one", () => {
    expect(printedBorderOfRowSet("6ed")).toBe("white");
    expect(printedBorderOfRowSet("9ED")).toBe("white");
    expect(printedBorderOfRowSet("wc97")).toBeUndefined();
    expect(signatureDrawnOn("era/1997+border", "retro", "white")).toBe(true);
    expect(signatureDrawnOn("era/2003+border", "modern", "white")).toBe(true);
    expect(signatureDrawnOn("era/1997+border", "retro", "gold")).toBe(false);
    expect(frameRequestAnswered(row("era/1997+border", "retro", "6ed"), NONE)).toBe(true);
    expect(frameRequestAnswered(row("era/2003+border", "modern", "8ed"), NONE)).toBe(true);
    expect(frameRequestAnswered(row("era/1997+border", "retro", "wc99"), NONE)).toBe(false);
    expect(frameRequestAnswered(row("era/2003+border", "modern", "unh"), NONE)).toBe(false);
    // No frame draws a white border on the 2015 frame.
    expect(frameRequestAnswered(row("era/2015+border", "m15", "8ed"), ALL_VERIFIED)).toBe(false);
  });

  it("never on the public list: its rows carry no set", () => {
    expect(answeredSignaturePairs(ALL_VERIFIED).some((pair) => pair.includes("+border|"))).toBe(false);
  });
});

describe("a gap row logged on a stand-in, answered once the frame it stood in for is verified", () => {
  it("+nyx on the M15 frame: answered once the Nyx frame is ticked in every printed colour", () => {
    const nyx = everyColourOf("m15nyx");
    expect(answeredSignaturePairs(NONE)).not.toContain("era/2015+nyx|m15");
    for (const template of ["m15", "m15artifact"]) {
      expect(answeredSignaturePairs(nyx), template).toContain(`era/2015+nyx|${template}`);
      expect(signatureAnsweredOnceVerified("era/2015+nyx", template, nyx), template).toBe(true);
    }
    const printed = FRAME_COLOR_KEYS.find((c) => frameReferenceOptions("m15nyx", c).length > 0)!;
    const short = new Set([...nyx].filter((key) => key !== frameComboKey("m15nyx", printed)));
    expect(signatureAnsweredOnceVerified("era/2015+nyx", "m15", short)).toBe(false);
  });

  it("never where the Nyx frame doesn't dress the logged frame's kinds: a land, a battle", () => {
    for (const template of ["m15land", "battle"]) {
      expect(signatureAnsweredOnceVerified("era/2015+nyx", template, ALL_VERIFIED), template).toBe(false);
    }
  });

  it("+dfc rows can't be read this way: FIN's live rows log the same signature and frame", () => {
    for (const template of ["m15", "m15artifact", "m15land"]) {
      expect(frameRequestAnswered(row("era/2015+dfc", template), ALL_VERIFIED), template).toBe(false);
    }
  });

  it("stays under the database's cap with every combo verified", () => {
    expect(answeredSignaturePairs(ALL_VERIFIED).length).toBeLessThanOrEqual(REQUESTED_FRAMES_MAX_KEYS);
    for (const pair of answeredSignaturePairs(ALL_VERIFIED)) expect(pair, pair).toMatch(/^[^|]+\+[^|]+\|[a-z0-9]+$/);
  });
});

describe("the items the registry names (frames audit 2026-11-22)", () => {
  it("the double-faced marks: 4.5d on the 2015 frame (FIN's Saga-creature backs), 5.7b on extended art, 4.11 on a showcase", () => {
    expect(signatureBlockedBy("era/2015+dfc", "m15")).toBe("4.5d");
    expect(signatureBlockedBy("layout/2015+dfc", "saga")).toBe("4.5d");
    expect(signatureBlockedBy("extendedart+dfc", "extendedart")).toBe("5.7b");
    expect(signatureBlockedBy("showcase/tla/avatar+dfc", "avatar")).toBe("4.11");
    expect(signatureBlockedBy("showcase/blb/woodland+dfc", "bloomburrow")).toBe("4.11");
  });

  it("the old frames' coloured artifacts, walkers, layout kinds and transforms: 4.10g", () => {
    for (const signature of [
      "era/1997/coloured-artifact",
      "era/2003/coloured-artifact",
      "era/1997/planeswalker",
      "era/2003/planeswalker",
      "layout/older",
      "dfc/2003",
    ]) {
      expect(signatureBlockedBy(signature), signature).toBe("4.10g");
    }
    for (const rule of FRAME_SIGNATURE_RULES) {
      const item = rule.outcome.blockedBy;
      if (typeof item === "string") expect(item, rule.key).not.toBe("4.10");
    }
  });

  it("the legendary arch token's crown is 4.53b; every other frame's crown on the 2015 frame keeps 4.6f", () => {
    for (const template of ["m15token", "m15tokentext", "m15tokenartifact", "m15tokentall"]) {
      expect(signatureBlockedBy("era/2015+crown", template), template).toBe("4.53b");
    }
    expect(signatureBlockedBy("era/2015+crown", "m15devoid")).toBe("4.6f");
    expect(signatureBlockedBy("era/2015+crown", null)).toBe("4.6f");
  });
});
