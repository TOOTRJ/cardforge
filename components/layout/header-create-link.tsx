"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import { trackNavClick } from "./nav-click";

/** "＋ Create a card" — the header's one start button, at every width (TODO
 *  NV1: a signed-in phone had no way to create from the header). Straight
 *  to /create, which serves guests too. Below `sm` it is compact: "＋
 *  Create" signed out, the bare ＋ signed in (its row also holds the bell and
 *  the avatar) — named "Create a card" either way it shows. */
export function HeaderCreateLink({ isAuthed }: { isAuthed: boolean }) {
  const { id, href, label } = siteConfig.createCta;
  // The compact form's words are the label's own ("Create" + " a card").
  return (
    <Button
      asChild
      size="sm"
      className={cn(isAuthed && "w-9 px-0 sm:w-auto sm:px-3")}
    >
      <Link href={href} onClick={() => trackNavClick(id, "header", isAuthed)}>
        <Plus aria-hidden />
        {isAuthed ? (
          <span className="sr-only sm:not-sr-only">{label}</span>
        ) : (
          <span>
            Create<span className="sr-only sm:not-sr-only"> a card</span>
          </span>
        )}
      </Link>
    </Button>
  );
}
