"use client";

// ---------------------------------------------------------------------------
// ShareTargets
//
// Multi-target social share for the public card detail page. Each target
// either opens a service-specific share URL in a new tab or copies a
// service-flavored message to the clipboard.
//
//   Copy link    — plain URL to the clipboard.
//   X (Twitter)  — twitter.com/intent/tweet with prefilled text + url.
//   Reddit       — reddit.com/submit?url=...&title=... opens the submit form.
//   Discord      — copies a markdown-flavored message (no API; users paste).
//
// Wrapped in a Radix Dialog so the link list has a real focus trap and an
// Esc close. The trigger button defaults to a ghost "Share" button; callers
// can pass `trigger` to swap it.
// ---------------------------------------------------------------------------

import { useState, type ReactNode } from "react";
import { Check, Copy, Link2, MessageSquare, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ShareTargetsProps = {
  cardTitle: string;
  cardUrl: string;
  trigger?: ReactNode;
};

export function ShareTargets({ cardTitle, cardUrl, trigger }: ShareTargetsProps) {
  const tweetText = `${cardTitle} — a custom Magic card on Spellwright`;
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    tweetText,
  )}&url=${encodeURIComponent(cardUrl)}`;
  const redditHref = `https://www.reddit.com/submit?url=${encodeURIComponent(
    cardUrl,
  )}&title=${encodeURIComponent(cardTitle)}`;
  const discordMessage = `**${cardTitle}** — a custom Magic card I made on Spellwright\n${cardUrl}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost">
            <Share2 className="h-4 w-4" aria-hidden /> Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Share this card</DialogTitle>
          <DialogDescription>
            Send it to a playgroup or post it to a community. We don&apos;t
            send anything on your behalf — the buttons just prefill the
            respective forms.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-5">
          <CopyLink cardUrl={cardUrl} />
          <ExternalShareButton
            label="Share on X"
            href={xHref}
            icon={<XGlyph />}
          />
          <ExternalShareButton
            label="Submit to Reddit"
            href={redditHref}
            icon={<RedditGlyph />}
          />
          <CopyDiscord message={discordMessage} />
          <p className="text-[11px] leading-4 text-subtle">
            Fan-made tool · Not affiliated with Wizards of the Coast.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Individual targets
// ---------------------------------------------------------------------------

function CopyLink({ cardUrl }: { cardUrl: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Browser blocked clipboard access; no-op so the click doesn't crash.
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border border-border/60 bg-elevated/60 px-3 py-2.5 text-left transition-colors",
        "hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      )}
      aria-label={copied ? "Link copied" : "Copy card link"}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/60 text-foreground">
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-400" aria-hidden />
        ) : (
          <Link2 className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          {copied ? "Copied!" : "Copy link"}
        </span>
        <span className="truncate font-mono text-[10px] text-subtle">
          {cardUrl}
        </span>
      </span>
      <Copy className="h-3.5 w-3.5 text-subtle" aria-hidden />
    </button>
  );
}

function CopyDiscord({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — same posture as CopyLink
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border border-border/60 bg-elevated/60 px-3 py-2.5 text-left transition-colors",
        "hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      )}
      aria-label={copied ? "Message copied" : "Copy a Discord-formatted message"}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5865F2]/15 text-[#5865F2]">
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          {copied ? "Copied!" : "Copy for Discord"}
        </span>
        <span className="text-[10px] text-subtle">
          Paste into any channel.
        </span>
      </span>
      <Copy className="h-3.5 w-3.5 text-subtle" aria-hidden />
    </button>
  );
}

function ExternalShareButton({
  label,
  href,
  icon,
}: {
  label: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex w-full items-center gap-3 rounded-md border border-border/60 bg-elevated/60 px-3 py-2.5 text-left transition-colors",
        "hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/60 text-foreground">
        {icon}
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-[10px] text-subtle">Opens in a new tab.</span>
      </span>
    </a>
  );
}

// X (Twitter) and Reddit do not have Lucide glyphs we can lean on, so we
// inline tiny SVG marks. Both keep currentColor so they pick up the dark
// theme's foreground naturally.

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.654l-5.214-6.817-5.965 6.817H1.687l7.73-8.835L1.254 2.25h6.82l4.713 6.231 5.457-6.231Zm-1.161 17.52h1.832L7.084 4.126H5.117L17.083 19.77Z"
      />
    </svg>
  );
}

function RedditGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="currentColor"
        d="M14.238 15.348c.085.084.085.221 0 .306-.465.462-1.194.687-2.231.687l-.008-.002-.008.002c-1.036 0-1.766-.225-2.231-.688-.085-.084-.085-.221 0-.305.084-.084.222-.084.307 0 .357.354.985.53 1.924.53l.008.002.008-.002c.94 0 1.568-.176 1.924-.53.085-.084.222-.084.307 0Zm-3.44-2.418c0-.485-.4-.88-.895-.88-.494 0-.895.394-.895.88 0 .485.401.88.895.88s.895-.395.895-.88Zm3.873-.88c-.494 0-.895.394-.895.88 0 .486.401.881.895.881s.895-.395.895-.88c0-.486-.401-.881-.895-.881Zm5.328 1.262c0 4.13-4.46 7.48-9.965 7.48s-9.965-3.35-9.965-7.48c0-2.062.79-3.916 2.07-5.273-.005-.05-.005-.1-.005-.151 0-1.32 1.085-2.388 2.426-2.388.762 0 1.41.328 1.85.857 1.07-.61 2.37-.99 3.78-1.07L13.987 2l3.198.677c.222-.823 1.01-1.43 1.94-1.43 1.11 0 2.01.886 2.01 1.98 0 1.092-.9 1.979-2.01 1.979-1.082 0-1.962-.842-2.005-1.895l-2.94-.625-.836 3.95c1.42.077 2.728.46 3.806 1.072.44-.527 1.09-.854 1.85-.854 1.34 0 2.426 1.069 2.426 2.387 0 .053-.003.106-.008.156 1.28 1.357 2.07 3.21 2.07 5.273ZM19.04 9.81c.518 0 .95-.398 1.012-.913.005-.04.008-.082.008-.124 0-.572-.467-1.034-1.04-1.034a1.04 1.04 0 0 0-1.04 1.034c0 .04.003.083.008.123.062.516.494.914 1.052.914Zm0-6.583c-.572 0-1.04.464-1.04 1.036 0 .572.468 1.034 1.04 1.034.573 0 1.04-.462 1.04-1.034 0-.572-.467-1.036-1.04-1.036ZM4.06 7.74c-.572 0-1.04.462-1.04 1.034 0 .04.003.083.008.124.062.515.494.913 1.012.913.558 0 .99-.398 1.052-.914.005-.04.008-.083.008-.123 0-.572-.467-1.034-1.04-1.034Zm14.05 6.5c0-3.518-3.683-6.38-8.222-6.38-4.54 0-8.224 2.862-8.224 6.38 0 3.516 3.685 6.378 8.224 6.378 4.539 0 8.222-2.862 8.222-6.378Z"
      />
    </svg>
  );
}
