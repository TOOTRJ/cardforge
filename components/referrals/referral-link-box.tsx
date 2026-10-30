"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Check, Copy, Mail, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field-classes";

// The viewer's referral link with Copy, the platform's own Share sheet
// (where there is one) and an email draft. The message says what the friend
// gets — the reason they'll click — and nothing about the referrer's month.

const SHARE_TEXT =
  "I make custom Magic cards on PipGlyph — join with my link and you get a free month of Plus when you save your first card.";

const noop = () => () => {};

export function ReferralLinkBox({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  // navigator.share exists only in the browser (and not in every one): read
  // it after hydration so the server render and the first client render agree.
  const canShare = useSyncExternalStore(
    noop,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Your referral link is copied.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't access the clipboard — select the link and copy it.");
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "PipGlyph", text: SHARE_TEXT, url: link });
    } catch {
      // Dismissed, or the platform refused: nothing to say.
    }
  }

  const mailto = `mailto:?subject=${encodeURIComponent("A free month of PipGlyph Plus")}&body=${encodeURIComponent(
    `${SHARE_TEXT}\n\n${link}`,
  )}`;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">Your referral link</span>
        <input
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className={`${inputClass(false)} font-mono`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        {canShare ? (
          <Button type="button" variant="secondary" onClick={share}>
            <Share2 aria-hidden />
            Share…
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <a href={mailto}>
            <Mail aria-hidden />
            Email a friend
          </a>
        </Button>
      </div>
    </div>
  );
}
