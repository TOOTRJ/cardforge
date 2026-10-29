import { describe, expect, it } from "vitest";
import { FRAME_SIGNATURE_KEYS, FRAME_SIGNATURE_RULES, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { isForGoodSignature } from "@/lib/frames/frame-requests";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { FRAME_COLOR_KEYS, frameComboKey, frameReferenceOptions } from "@/lib/cards/frame-reference-registry";
import {
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
