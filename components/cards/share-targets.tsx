"use client";

// ---------------------------------------------------------------------------
// ShareTargets
//
// Multi-target social share for public card / set pages. Targets, in order
// of MTG-community traffic value:
//
//   Native share — navigator.share, rendered only where supported (iOS/
//                  Android/macOS Safari, Chromium desktop). Shares the baked
//                  card PNG as a *file* when the platform accepts files
//                  (Discord/WhatsApp/Messages get the actual card image),
//                  falling back to a URL share.
//   Copy link    — plain URL to the clipboard; the biggest "dark social"
//                  channel (Discord DMs, group chats).
//   X / Bluesky / Reddit / WhatsApp / Telegram / Facebook — service share
//                  intents that prefill their compose forms.
//   Discord      — copies a markdown-flavored message (no share intent
//                  exists; users paste into a channel).
//
// Every generated link carries `?via={target}` so GA4 can attribute inbound
// share traffic per network (the card page canonical stays clean, and
// ShareParamCleanup strips the param from the address bar after the
// pageview is captured — copied re-shares stay unpolluted). Each click also
// fires a GA `share` event so we can see which targets get used even when
// the destination is unobservable.
//
// Wrapped in a Radix Dialog so the link list has a real focus trap and an
// Esc close. The trigger button defaults to a ghost "Share" button; callers
// can pass `trigger` to swap it, or drive the dialog programmatically with
// `open`/`onOpenChange` (the post-publish prompt in the card creator opens
// it with no trigger at all).
// ---------------------------------------------------------------------------

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { sendGAEvent } from "@next/third-parties/google";
import {
  Check,
  Copy,
  Link2,
  MessageSquare,
  Share2,
  Smartphone,
} from "lucide-react";
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
  /** Title of the thing being shared (card or set name). */
  title: string;
  /** Absolute canonical URL of the share target. */
  url: string;
  /** What the URL points at — flavors the prefilled message. */
  entity?: "card" | "set" | "deck";
  /** GA item id (card/set uuid) for share-event attribution. */
  itemId?: string;
  /** Absolute URL of a PNG to attach on native file shares. */
  imageUrl?: string;
  trigger?: ReactNode;
  /** Controlled open state — pair with `onOpenChange`. When controlled and
   *  no `trigger` is passed, the dialog renders without a trigger and can
   *  only be opened programmatically. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Override the dialog title ("Share this {entity}"). */
  heading?: string;
  /** Override the dialog blurb under the title. */
  description?: string;
};

/** Append the share-source attribution param without disturbing anything
 *  else about the URL. */
function withVia(url: string, via: string): string {
  try {
    const next = new URL(url);
    next.searchParams.set("via", via);
    return next.toString();
  } catch {
    return url;
  }
}

export function ShareTargets({
  title,
  url,
  entity = "card",
  itemId,
  imageUrl,
  trigger,
  open,
  onOpenChange,
  heading,
  description,
}: ShareTargetsProps) {
  const shareText =
    entity === "set"
      ? `${title} — a custom Magic set on PipGlyph`
      : entity === "deck"
        ? `${title} — a Magic deck with custom cards on PipGlyph`
        : `${title} — a custom Magic card I forged on PipGlyph`;

  const track = (method: string) => {
    // No-ops (with a console.warn in dev) when GA isn't configured.
    sendGAEvent("event", "share", {
      method,
      content_type: entity,
      item_id: itemId ?? url,
    });
  };

  const networks: { key: string; label: string; icon: ReactNode; href: string }[] = [
    {
      key: "x",
      label: "X",
      icon: <XGlyph />,
      href: `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(withVia(url, "x"))}`,
    },
    {
      key: "bluesky",
      label: "Bluesky",
      icon: <BlueskyGlyph />,
      // Bluesky's compose intent takes a single `text` param (300 graphemes);
      // the URL rides inside it.
      href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText}\n${withVia(url, "bluesky")}`)}`,
    },
    {
      key: "reddit",
      label: "Reddit",
      icon: <RedditGlyph />,
      href: `https://www.reddit.com/submit?url=${encodeURIComponent(withVia(url, "reddit"))}&title=${encodeURIComponent(title)}`,
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      icon: <WhatsAppGlyph />,
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${withVia(url, "whatsapp")}`)}`,
    },
    {
      key: "telegram",
      label: "Telegram",
      icon: <TelegramGlyph />,
      href: `https://t.me/share/url?url=${encodeURIComponent(withVia(url, "telegram"))}&text=${encodeURIComponent(shareText)}`,
    },
    {
      key: "facebook",
      label: "Facebook",
      icon: <FacebookGlyph />,
      // Facebook ignores every param except `u` — the preview comes
      // entirely from the page's OG tags.
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(withVia(url, "facebook"))}`,
    },
  ];

  const discordMessage = `**${title}** — a custom Magic ${entity} I made on PipGlyph\n${withVia(url, "discord")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open === undefined || trigger !== undefined ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="ghost">
              <Share2 className="h-4 w-4" aria-hidden /> Share
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{heading ?? <>Share this {entity}</>}</DialogTitle>
          <DialogDescription>
            {description ??
              "Send it to a playgroup or post it to a community. We don't send anything on your behalf — the buttons just prefill the respective forms."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-5">
          <NativeShare
            title={title}
            shareText={shareText}
            url={url}
            imageUrl={imageUrl}
            onShared={() => track("native")}
          />
          <CopyLink url={withVia(url, "copy")} onCopied={() => track("copy")} />
          <div className="grid grid-cols-2 gap-2">
            {networks.map((network) => (
              <ExternalShareButton
                key={network.key}
                label={network.label}
                href={network.href}
                icon={network.icon}
                onOpen={() => track(network.key)}
              />
            ))}
          </div>
          <CopyDiscord message={discordMessage} onCopied={() => track("discord")} />
          <p className="text-[11px] leading-4 text-subtle">
            Fan-made tool · Not affiliated with Wizards of the Coast.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Native share — the OS share sheet, where the real MTG sharing happens
// (Discord app, WhatsApp, iMessage). Feature-detected after mount so SSR
// and hydration agree; on platforms that accept files we attach the baked
// card PNG so the recipient sees the card itself, not just a link.
// ---------------------------------------------------------------------------

function NativeShare({
  title,
  shareText,
  url,
  imageUrl,
  onShared,
}: {
  title: string;
  shareText: string;
  url: string;
  imageUrl?: string;
  onShared: () => void;
}) {
  // Hydration-safe feature detection: the server snapshot says "no" so SSR
  // and the first client render agree; the client snapshot flips it on
  // wherever navigator.share exists.
  const supported = useSyncExternalStore(
    subscribeNever,
    () => !!navigator.share,
    () => false,
  );
  if (!supported) return null;

  const taggedUrl = withVia(url, "native");

  const onShare = async () => {
    // Preferred: share the actual PNG file (+ link in the text). Any
    // failure — fetch error, canShare false, platform quirk — falls back
    // to the plain URL share.
    if (imageUrl && typeof navigator.canShare === "function") {
      try {
        const res = await fetch(imageUrl);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], "pipglyph-card.png", {
            type: blob.type || "image/png",
          });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title,
              text: `${shareText}\n${taggedUrl}`,
            });
            onShared();
            return;
          }
        }
      } catch (error) {
        // AbortError = the user closed the share sheet — done, not a fallback.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.share({ title, text: shareText, url: taggedUrl });
      onShared();
    } catch {
      // User dismissed the sheet; nothing to do.
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border border-primary-bright/40 bg-primary/10 px-3 py-2.5 text-left transition-colors",
        "hover:border-primary-bright hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/60 text-primary-bright">
        <Smartphone className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Share…</span>
        <span className="text-[10px] text-subtle">
          Opens your device&apos;s share sheet, card image included.
        </span>
      </span>
    </button>
  );
}

// navigator.share support never changes within a page's lifetime — nothing
// to subscribe to.
function subscribeNever() {
  return () => {};
}

// ---------------------------------------------------------------------------
// Individual targets
// ---------------------------------------------------------------------------

function CopyLink({ url, onCopied }: { url: string; onCopied: () => void }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied();
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
        "hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
      )}
      aria-label={copied ? "Link copied" : "Copy link"}
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
        <span className="truncate font-mono text-[10px] text-subtle">{url}</span>
      </span>
      <Copy className="h-3.5 w-3.5 text-subtle" aria-hidden />
    </button>
  );
}

function CopyDiscord({
  message,
  onCopied,
}: {
  message: string;
  onCopied: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      onCopied();
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
        "hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
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
        <span className="text-[10px] text-subtle">Paste into any channel.</span>
      </span>
      <Copy className="h-3.5 w-3.5 text-subtle" aria-hidden />
    </button>
  );
}

function ExternalShareButton({
  label,
  href,
  icon,
  onOpen,
}: {
  label: string;
  href: string;
  icon: ReactNode;
  onOpen: () => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className={cn(
        "flex items-center gap-2.5 rounded-md border border-border/60 bg-elevated/60 px-3 py-2.5 transition-colors",
        "hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background/60 text-foreground">
        {icon}
      </span>
      <span className="truncate text-sm font-medium text-foreground">
        {label}
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Network glyphs — Lucide has no brand marks, so we inline tiny SVGs. All
// keep currentColor so they pick up the dark theme's foreground naturally.
// ---------------------------------------------------------------------------

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

function BlueskyGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="currentColor"
        d="M5.202 3.352C7.955 5.42 10.917 9.614 12 11.867c1.083-2.252 4.045-6.446 6.798-8.515C20.783 1.86 24 .705 24 4.38c0 .734-.42 6.165-.667 7.047-.858 3.065-3.983 3.847-6.763 3.374 4.859.827 6.096 3.567 3.426 6.307-5.07 5.203-7.288-1.306-7.842-2.973-.101-.306-.149-.45-.154-.328-.005-.122-.053.022-.154.328-.553 1.667-2.771 8.176-7.842 2.973-2.67-2.74-1.433-5.48 3.426-6.307-2.78.473-5.905-.309-6.763-3.374C.42 10.545 0 5.114 0 4.38 0 .705 3.217 1.86 5.202 3.352Z"
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

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"
      />
    </svg>
  );
}

function TelegramGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="currentColor"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z"
      />
    </svg>
  );
}

function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="currentColor"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z"
      />
    </svg>
  );
}
