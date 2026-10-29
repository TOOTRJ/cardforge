import { describe, expect, it } from "vitest";
import {
  SAFE_ART_SUFFIX,
  artPromptForAttempt,
  artPromptLadder,
  fallbackArtPrompt,
  isSafetyBlockError,
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
});

describe("softenArtPrompt (owner 2026-10-28: violence allowed, nudity never)", () => {
  it("leaves violence and dark-theme words exactly as written", () => {
    const scene =
      "A blood-soaked demon slaughtering zombies over a pile of skulls and corpses, gore on the altar, " +
      "an executioner at the gallows, the undead rotting, a devil's torture chamber, a beheaded knight";
    const out = softenArtPrompt(scene);
    expect(out).toBe(`${scene} ${SAFE_ART_SUFFIX}`);
    for (const word of ["blood-soaked", "demon", "slaughtering", "zombies", "skulls", "corpses", "gore", "executioner", "gallows", "undead", "rotting", "devil", "torture", "beheaded"]) {
      expect(out, word).toContain(word);
    }
  });
  it("dresses every nudity and sexual word", () => {
    const out = softenArtPrompt(
      "A naked witch, a nude statue, a topless pirate, a bare-chested barbarian, a shirtless monk, an unclothed nymph, " +
        "a scantily clad dancer in lingerie and a bikini, seductive and sensual, erotic, sexy, provocative, voluptuous, cleavage",
    );
    expect(out).not.toMatch(
      /naked|nude|topless|bare-chested|shirtless|unclothed|scantily|lingerie|bikini|seductive|sensual|erotic|sexy|provocative|voluptuous|cleavage/i,
    );
    expect(out).toContain("A fully clothed witch");
    expect(out).toContain("flowing robes");
  });
  it("keeps a minor out of a refused scene (owner: keep the child words)", () => {
    expect(softenArtPrompt("A child and two babies by the fire")).not.toMatch(/child|bab(y|ies)/i);
    expect(softenArtPrompt("A child by the fire")).toContain("young apprentices");
  });
  it("the suffix is modest dress only — no 'family-friendly', no 'all ages', no mood", () => {
    expect(SAFE_ART_SUFFIX).toContain("fully clothed");
    expect(SAFE_ART_SUFFIX).not.toMatch(/family|wholesome|serene|all ages|peaceful/i);
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
    // A dark card's fallback keeps the card's mood (2026-10-28).
    expect(out).not.toMatch(/serene|peaceful|calm|family|all ages/i);
    expect(out).toContain("fully clothed");
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
