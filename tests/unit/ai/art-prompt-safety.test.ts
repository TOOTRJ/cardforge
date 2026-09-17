import { describe, expect, it } from "vitest";
import {
  SAFE_ART_SUFFIX,
  artPromptForAttempt,
  artPromptLadder,
  fallbackArtPrompt,
  isSafetyBlockError,
  shouldRewordAfter,
  softenArtPrompt,
} from "@/lib/ai/art-prompt-safety";

describe("isSafetyBlockError", () => {
  it("recognises the hosted FLUX moderation messages", () => {
    expect(isSafetyBlockError("Request Moderated")).toBe(true);
    expect(isSafetyBlockError("Content Moderated")).toBe(true);
    expect(isSafetyBlockError("Your request was blocked by the safety system")).toBe(true);
    expect(isSafetyBlockError("NSFW content detected")).toBe(true);
    expect(isSafetyBlockError("content_policy_violation")).toBe(true);
  });
  it("leaves other failures alone", () => {
    expect(isSafetyBlockError("Rate limit exceeded")).toBe(false);
    expect(isSafetyBlockError("The operation was aborted due to timeout")).toBe(false);
  });
  it("rewords after a timeout too — that is how the gateway surfaces a block", () => {
    expect(shouldRewordAfter("Gateway request failed: The operation was aborted due to timeout")).toBe(true);
    expect(shouldRewordAfter("Request Moderated")).toBe(true);
    expect(shouldRewordAfter("Rate limit exceeded")).toBe(false);
  });
});

describe("softenArtPrompt", () => {
  it("swaps the usual trigger words and appends the safe suffix", () => {
    const out = softenArtPrompt(
      "A blood-soaked demon slaughtering zombies over a pile of skulls and corpses",
    );
    expect(out).not.toMatch(/blood|demon|slaughter|zombie|skull|corpse/i);
    expect(out).toContain(SAFE_ART_SUFFIX);
  });
  it("keeps a benign prompt intact apart from the suffix", () => {
    const original = "A serene sea-mage on a tidal rock at dawn, teal and silver palette";
    expect(softenArtPrompt(original)).toBe(`${original} ${SAFE_ART_SUFFIX}`);
  });
});

describe("fallbackArtPrompt", () => {
  it("is built only from the card's identity", () => {
    const out = fallbackArtPrompt({
      title: "Emberwake Tyrant",
      typeLine: "Creature — Dragon",
      colors: ["red"],
      style: "Oil painting",
    });
    expect(out).toContain('"Emberwake Tyrant"');
    expect(out).toContain("Creature — Dragon");
    expect(out).toContain("fiery orange");
    expect(out).toContain("Oil painting");
    expect(out).toContain("NO text or lettering");
  });
});

describe("attempt ladder", () => {
  const fallback = { title: "Stone Stare", typeLine: "Instant", colors: ["black"] };
  it("sends a different prompt on every attempt", () => {
    const a1 = artPromptForAttempt(1, "A bloody duel", fallback);
    const a2 = artPromptForAttempt(2, "A bloody duel", fallback);
    const a3 = artPromptForAttempt(3, "A bloody duel", fallback);
    expect(a1).toBe("A bloody duel");
    expect(a2).not.toBe(a1);
    expect(a3).not.toBe(a2);
    expect(artPromptForAttempt(7, "A bloody duel", fallback)).toBe(a3);
  });
  it("walks from the current attempt to the safe end", () => {
    expect(artPromptLadder(1, "A bloody duel", fallback)).toHaveLength(3);
    expect(artPromptLadder(2, "A bloody duel", fallback)).toHaveLength(2);
    expect(artPromptLadder(3, "A bloody duel", fallback)).toHaveLength(1);
    expect(artPromptLadder(9, "A bloody duel", fallback)).toHaveLength(1);
  });
});
