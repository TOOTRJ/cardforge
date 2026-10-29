import { describe, expect, it } from "vitest";
import { FRAME_SIGNATURE_KEYS, FRAME_SIGNATURE_RULES, signatureDrawnOn } from "@/lib/scryfall/frame-signatures";
import { isForGoodSignature } from "@/lib/frames/frame-requests";
import {
  answeredSignaturePairs,
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
// pairs are real, and the mapping drops anything it can't name.
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

describe("the list", () => {
  it("maps rows to named frames with a status, most people first", () => {
    const frames = mapRequestedFrames([
      { signature: "borderless/standard+nickname", people: "1", latest_cause: "missing" },
      { signature: "extendedart", people: 2, latest_cause: "unverified" },
      { signature: "japan-showcase", people: "2", latest_cause: "missing" },
    ]);
    expect(frames).toEqual([
      { signature: "extendedart", label: "Extended-art frame", detail: null, people: 2, status: "checking" },
      { signature: "japan-showcase", label: "Japan showcase", detail: null, people: 2, status: "requested" },
      {
        signature: "borderless/standard+nickname",
        label: "Borderless frame",
        detail: "The nickname plate",
        people: 1,
        status: "requested",
      },
    ]);
    // The aggregate's shape: nothing but the frame's words, a count and a status.
    for (const frame of frames) expect(Object.keys(frame).sort()).toEqual(["detail", "label", "people", "signature", "status"]);
  });

  it("drops a row it can't name, one that counts nobody, and a for-good family", () => {
    expect(
      mapRequestedFrames([
        { signature: "evil <script>alert(1)</script>", people: 9, latest_cause: "missing" },
        { signature: "retired/seed-example", people: 4, latest_cause: "missing" },
        { signature: "japan-showcase", people: 0, latest_cause: "missing" },
        { signature: "future", people: "x", latest_cause: "missing" },
        { signature: "borderless/poster", people: 3, latest_cause: "missing" },
      ]),
    ).toEqual([]);
  });

  it("calls a frame 'Being checked' when it is built: an unverified latest row, or a rule exact today", () => {
    expect(requestedFrameStatus("extendedart", "unverified")).toBe("checking");
    // Exact today; a 'missing' row is from before it was built.
    expect(requestedFrameStatus("showcase/blb/woodland", "missing")).toBe("checking");
    // A gap signature is never exact: still requested unless its latest row says unverified.
    expect(requestedFrameStatus("borderless/standard+nickname", "missing")).toBe("requested");
    expect(requestedFrameStatus("future", "missing")).toBe("requested");
    expect(requestedFrameStatus("future", null)).toBe("requested");
  });

  it("says people, not requests", () => {
    expect(peopleLabel(1)).toBe("1 person");
    expect(peopleLabel(4)).toBe("4 people");
  });
});
