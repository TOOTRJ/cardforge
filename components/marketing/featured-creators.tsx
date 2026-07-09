import Link from "next/link";
import { Crown } from "lucide-react";
import { listFeaturedCreators } from "@/lib/featured/queries";
import { SocialIcon } from "@/components/profile/social-icon";

// ---------------------------------------------------------------------------
// FeaturedCreators — the admin-curated spotlight banner on the gallery and
// challenges pages. Designed to STAND OUT: gold-glow framed panel, the
// creator's own banner art washing the background, avatar ring in their
// accent color, and their showcase cards fanned on the right.
// Server component; data is viewer-independent (ISR-safe).
// ---------------------------------------------------------------------------

export async function FeaturedCreators() {
  const creators = await listFeaturedCreators(2);
  if (creators.length === 0) return null;

  return (
    <section aria-label="Featured creators" className="mt-10 flex flex-col gap-6">
      {creators.map((c) => {
        const accent = c.accentColor ?? "#d8b26e";
        const name = c.displayName || `@${c.username}`;
        return (
          <div
            key={c.username}
            className="relative overflow-hidden rounded-xl border border-gold/40 bg-elevated/40 shadow-[0_0_40px_-12px_rgba(201,165,76,0.45)]"
          >
            {/* Creator banner art (or a quiet radial wash) behind everything. */}
            <div className="absolute inset-0" aria-hidden>
              {c.bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.bannerUrl}
                  alt=""
                  className="h-full w-full object-cover opacity-35"
                />
              ) : (
                <div className="h-full w-full bg-radial-glow" />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/75 to-background/40" />
            </div>

            <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
              <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-strong">
                  <Crown className="h-3.5 w-3.5" aria-hidden />
                  Featured creator
                </span>

                <div className="flex items-center gap-4">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.avatarUrl}
                      alt=""
                      className="h-14 w-14 rounded-full border-2 object-cover"
                      style={{ borderColor: accent }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex h-14 w-14 items-center justify-center rounded-full border-2 bg-elevated font-display text-xl text-foreground"
                      style={{ borderColor: accent }}
                    >
                      {name[0]?.toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-2xl font-semibold tracking-tight text-foreground">
                      {name}
                    </h2>
                    <p className="text-sm text-muted">@{c.username}</p>
                  </div>
                </div>

                {c.bio ? (
                  <p className="max-w-xl text-sm leading-6 text-muted">{c.bio}</p>
                ) : null}

                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/profile/${c.username}`}
                    className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    View profile
                  </Link>
                  {c.socials.length > 0 ? (
                    <ul className="flex flex-wrap items-center gap-1.5">
                      {c.socials.map((social) => (
                        <li key={social.key}>
                          <a
                            href={social.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${name} on ${social.label}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-elevated/60 text-muted backdrop-blur-sm transition-colors hover:border-gold/50 hover:bg-elevated hover:text-gold-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
                          >
                            <SocialIcon platform={social.key} className="h-4 w-4" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              {c.cards.length > 0 ? (
                <div className="flex shrink-0 items-center justify-center sm:justify-end">
                  <div className="flex -space-x-10 sm:-space-x-12">
                    {c.cards.map((card, i) => (
                      <Link
                        key={card.slug}
                        href={`/card/${c.username}/${card.slug}`}
                        title={card.title}
                        className="group relative block transition-transform hover:z-10 hover:-translate-y-2"
                        style={{
                          zIndex: i,
                          transform: `rotate(${(i - (c.cards.length - 1) / 2) * 6}deg)`,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={card.imageUrl}
                          alt={card.title}
                          loading="lazy"
                          className="h-40 w-auto rounded-md border border-border/60 shadow-lg transition-shadow group-hover:shadow-[0_8px_30px_-8px_rgba(201,165,76,0.5)] sm:h-48"
                        />
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
