import type { PlayTarget } from "./model";

// ---------------------------------------------------------------------------
// The words for each play client — the dialog's chips and its "next steps",
// and the tool page's how-to. ONE place, so the two never say different
// things. The steps follow each client's own menus as of 2026-11:
// Cockatrice 3.1.2 (window_main.cpp: the "Card Database" menu), Draftmancer
// (App.vue: "Upload a Custom Card List..."), Tabletop Simulator (the
// knowledge base: Objects → Saved Objects). Client-safe.
// ---------------------------------------------------------------------------

export type PlayGuide = {
  target: PlayTarget;
  /** The chip's second line. */
  file: string;
  /** One sentence on what the player gets. */
  summary: string;
  /** Numbered steps, short and in the client's own words. */
  steps: string[];
  /** Steps only a DECK's export has (a selection has no deck file). */
  deckSteps: string[];
  /** Notes under the steps. */
  notes: string[];
  /** The client's own site. */
  site: { label: string; href: string };
};

export const PLAY_GUIDES: Record<PlayTarget, PlayGuide> = {
  cockatrice: {
    target: "cockatrice",
    file: "Set, deck and pictures · .zip",
    summary: "Your cards as a custom set with their pictures, and the deck ready to load.",
    steps: [
      "Unzip the download.",
      "In Cockatrice, open Card Database → Add custom sets/cards and pick the .xml file. Cockatrice reloads its card database by itself.",
      "Open Card Database → Open custom image folder and copy the pictures folder into it.",
    ],
    deckSteps: ["In the deck editor, open the .cod file."],
    notes: [
      "Real cards play from Cockatrice's own database.",
      "After you change a card, export again. If the old picture stays, delete downloaded images under Settings → Card Sources.",
    ],
    site: { label: "cockatrice.github.io", href: "https://cockatrice.github.io/" },
  },
  draftmancer: {
    target: "draftmancer",
    file: "Custom card list · .txt",
    summary: "A card pool to draft with friends: your cards with their pictures, real cards by name.",
    steps: [
      "Open Draftmancer and start a session (you are its owner).",
      "Open the Card Pool menu, choose Upload a Custom Card List…, and pick the .txt file.",
      "Wait for “Card list uploaded”, then start the draft.",
    ],
    deckSteps: [],
    notes: [
      "Each card is in the pool as many times as the deck holds it.",
      "Private cards have no shared picture, so they show without one. Make them unlisted to include their picture.",
    ],
    site: { label: "draftmancer.com", href: "https://draftmancer.com/" },
  },
  tts: {
    target: "tts",
    file: "Saved object · .json",
    summary: "The deck as a Tabletop Simulator object: each board its own pile, the commander face up.",
    steps: [
      "Move the .json file into Tabletop Simulator's Saves/Saved Objects folder (in Documents/My Games/Tabletop Simulator on Windows, ~/Library/Tabletop Simulator on a Mac).",
      "In a game, open Objects → Saved Objects.",
      "Click the deck to place it on the table.",
    ],
    deckSteps: [],
    notes: [
      "Every player's game downloads the pictures. Private cards have no shared picture, so they are left out. Make them unlisted to include them.",
      "A double-faced card keeps its back as a second state: right-click the card and switch its state to turn it.",
    ],
    site: { label: "tabletopsimulator.com", href: "https://www.tabletopsimulator.com/" },
  },
};

/** The steps for an export of a deck or of a selection of cards. */
export function guideSteps(target: PlayTarget, source: "deck" | "cards"): string[] {
  const guide = PLAY_GUIDES[target];
  return source === "deck" ? [...guide.steps, ...guide.deckSteps] : guide.steps;
}
