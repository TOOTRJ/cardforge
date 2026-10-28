// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3b.20 (owner-approved follow-up 2026-10-12, from #510): the Card
// step's "Token type" header reads the words in the order the card PRINTS
// them — the order typed in the Identity step's Types field (3b.16,
// `printed_types`) once it was edited, the built (printed) order while it
// was not. Display only: the chips still read `supertype`.
// ---------------------------------------------------------------------------

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { CardSetupPanel, TokenBackTypeSection } from "@/components/creator/panels/card-setup-panel";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { buildTypeLine } from "@/lib/cards/card-display";

const VERIFIED = [frameComboKey("m15token", "c"), frameComboKey("m15tokenartifact", "c")];

function Harness({
  supertype,
  printedTypes,
  back,
}: {
  supertype: string;
  printedTypes: string | null;
  back?: boolean;
}) {
  const methods = useForm({
    defaultValues: {
      card_type: "token",
      frame_style: { template: "m15token" },
      color_identity: ["colorless"] as ColorIdentity[],
      title: "",
      supertype: back ? "Creature" : supertype,
      printed_types: back ? null : printedTypes,
      subtypes_text: "",
      back_face: { card_type: "token", supertype, printed_types: printedTypes },
    },
  });
  return (
    <FormProvider {...methods}>
      {back ? (
        <TokenBackTypeSection />
      ) : (
        <CardSetupPanel
          kind="token"
          colorIdentity={["colorless"]}
          verifiedFrameKeys={VERIFIED}
          onKindSelect={() => {}}
        />
      )}
    </FormProvider>
  );
}

/** The value the section's summary shows, beside its title. */
function headerValue(title: string): string {
  const summary = Array.from(document.querySelectorAll("summary")).find(
    (el) => el.firstElementChild?.textContent === title,
  );
  if (!summary) throw new Error(`no section ${title}`);
  return summary.lastElementChild?.textContent ?? "";
}

afterEach(() => cleanup());

describe("the token's type header (TODO 3b.20)", () => {
  it("shows the built order while the Types field was never edited", () => {
    render(<Harness supertype="Creature Legendary Artifact" printedTypes={null} />);
    // The built line: printed order (Legendary, Artifact, Creature).
    expect(headerValue("Token type")).toBe("Token Legendary Artifact Creature");
    expect(headerValue("Token type")).toBe(
      buildTypeLine({ supertype: "Creature Legendary Artifact", cardType: "token" }),
    );
  });

  it("shows the order typed in the Types field, as the card prints it", () => {
    render(<Harness supertype="Legendary Artifact Creature" printedTypes="Artifact Creature Legendary" />);
    expect(headerValue("Token type")).toBe("Token Artifact Creature Legendary");
    expect(headerValue("Token type")).toBe(
      buildTypeLine({ supertype: "Legendary Artifact Creature", cardType: "token", printedTypes: "Artifact Creature Legendary" }),
    );
    // The chips still read the supertype: every word is on.
    expect(screen.getByRole("group", { name: "Token types" }).querySelectorAll("[aria-pressed='true']")).toHaveLength(2);
  });

  it("an emptied Types field prints a bare Token", () => {
    render(<Harness supertype="Creature" printedTypes="" />);
    expect(headerValue("Token type")).toBe("Token");
  });

  it("a double-sided token's back face follows its own Types field", () => {
    render(<Harness back supertype="Legendary Creature" printedTypes="Creature Legendary" />);
    expect(headerValue("Back face type")).toBe("Token Creature Legendary");
  });
});
