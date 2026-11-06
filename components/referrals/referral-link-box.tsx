"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Check, ClipboardCopy, Copy, Mail, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field-classes";

// The viewer's referral link with Copy, the platform's own Share sheet
// (where there is one), an email draft and the message itself to copy. The
// message says what the friend gets — the reason they'll click — and nothing
// about the referrer's days.
//
// "Email a friend" is a mailto: link: it opens whatever the browser hands
// such links to, and a browser with NO mail handler (Chrome on a Mac with
// Mail not set up, Gmail not registered) does nothing on the click and says
// nothing (owner 2026-11-06). The page can't tell. So the same message is
// also one click away as text — "Copy the message" — with a line under the
// buttons saying so.

/** The share text names what the FRIEND gets (the settings' words). */
const shareText = (friendGets: string) =>
  `I make custom Magic cards on PipGlyph — join with my link and you get ${friendGets} toward a plan once you've saved your first cards and started one.`;

const noop = () => () => {};

export function ReferralLinkBox({ link, friendGets = "7 free days" }: { link: string; friendGets?: string }) {
  const SHARE_TEXT = shareText(friendGets);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
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

  const message = `${SHARE_TEXT}\n\n${link}`;
  const mailto = `mailto:?subject=${encodeURIComponent(`${friendGets.charAt(0).toUpperCase()}${friendGets.slice(1)} on PipGlyph`)}&body=${encodeURIComponent(
    message,
  )}`;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setMessageCopied(true);
      toast.success("The message and your link are copied — paste them into any email or chat.");
      window.setTimeout(() => setMessageCopied(false), 2000);
    } catch {
      toast.error("Couldn't access the clipboard — select the link and copy it.");
    }
  }

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
        <Button type="button" variant="outline" onClick={copyMessage}>
          {messageCopied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
          {messageCopied ? "Message copied" : "Copy the message"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        Email a friend opens your mail app with the message written. If nothing opens, Copy the message and paste it into
        any email or chat.
      </p>
    </div>
  );
}
