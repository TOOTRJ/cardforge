"use client";

import { Globe2, Link2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Visibility } from "@/types/card";

// ---------------------------------------------------------------------------
// VisibilityPicker — the three-tile private / unlisted / public choice the
// deck and set editors share. (The card creator has its own two-chip version
// in components/creator/panels/publish-panel.tsx: there, drafts force
// private.)
// ---------------------------------------------------------------------------

export type VisibilitySubject = "deck" | "set";

type VisibilityOption = {
  value: Visibility;
  label: string;
  description: string;
  icon: typeof Lock;
};

function optionsFor(subject: VisibilitySubject): VisibilityOption[] {
  return [
    {
      value: "private",
      label: "Private",
      description: `Only you can see this ${subject}.`,
      icon: Lock,
    },
    {
      value: "unlisted",
      label: "Unlisted",
      description: "Anyone with the link can view. Not in listings.",
      icon: Link2,
    },
    {
      value: "public",
      label: "Public",
      description: `Listed publicly in the community ${subject}s index.`,
      icon: Globe2,
    },
  ];
}

export function VisibilityPicker({
  subject,
  value,
  onChange,
}: {
  subject: VisibilitySubject;
  value: Visibility;
  onChange: (next: Visibility) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {optionsFor(subject).map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "flex flex-col gap-1 rounded-lg border bg-background/40 p-3 text-left transition-colors",
              active
                ? "border-primary bg-primary/10"
                : "border-border hover:border-border-strong",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon className="h-4 w-4" aria-hidden />
              {option.label}
            </span>
            <span className="text-xs leading-5 text-muted">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
