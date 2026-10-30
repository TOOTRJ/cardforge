# Profiles, links and store cards (research, 2026-10-30)

Research behind migration 0153 (`profile_links`, `profile_stores`): what a
PipGlyph creator would want to link from their public profile, the URL shapes
we can validate, and the brand rules for drawing each platform's mark. The
registries this feeds are `lib/profile/link-kinds.ts` (links) and
`lib/profile/store-platforms.ts` (stores). Their host allow-lists and path
tests are taken from the tables below.

**How the sources were read.** The research session could open GitHub
(`raw.githubusercontent.com`, github.com PRs) but no other host: every other
fetch failed DNS behind the session's network allow-list. So each source is
tagged:

- **[R]**: the page was read in full.
- **[S]**: the claim comes from a search engine's result or snippet; the page
  itself was not opened.

Anything with neither is marked **unverified**. The registries treat
unverified URL shapes leniently: they check the host only, with no path test.
Re-check every [S] path in a browser before tightening one.

## Decisions (what shipped)

| Area | Decision |
| --- | --- |
| Column socials | X, Bluesky, Instagram, YouTube, TikTok, Discord and GitHub stay as profile columns (the card page reads them) and keep `SocialIcon`. The new table holds everything else. |
| Link kinds | Magic sites: Moxfield, Archidekt, MTGGoldfish, TappedOut, Deckstats, Untapped.gg, Melee.gg, Cardsphere. Socials: Twitch, Reddit, Threads, Mastodon, Facebook, ArtStation, DeviantArt, Linktree, Substack. Support: Patreon, Ko-fi. Plus "Other link" (any https page, with a required name). At most 12 links. |
| Left out | EDHREC, MTGTop8, 17lands, MTG Arena, SpellTable and Commander Spellbook: no public user profile found. Scryfall: none found either (the `scryfall.com/@user` shape is unverified). Card Conjurer has no accounts; its community is linked as a plain Discord or Reddit link. |
| Mastodon | It is federated, so no host can be allow-listed. Any host is accepted, but only the profile URL shape every server prints (`/@user`, or `/@user@host`). |
| Store platforms | TCGplayer, eBay (14 country sites), Whatnot, Cardmarket, CardTrader, Mana Pool, Mercari (US and JP), Etsy (`/shop/` or the `shop.etsy.com` subdomain), Facebook (Marketplace profile, group or page), and "Online shop". At most 4 stores. |
| Not stores | Card Kingdom and Troll and Toad: individuals sell *to* them through buylists and have no storefront [30]. Shopify, Big Cartel and TCGplayer Pro sites use custom domains, which can't be allow-listed; they go under "Online shop". |
| "Online shop" | Any https host: real shops live on their own domains. **Owner call:** it is the one store kind with no allow-list. Remove it from `STORE_PLATFORMS` and from the migration's CHECK to require a listed platform. |
| Validation | Every URL must be `https://`, with no credentials, no port, a dotted host, and no whitespace or control characters (`lib/profile/https-link.ts`). It must also be on one of the kind's hosts (subdomains pass, look-alikes don't) and, where the site has one profile shape, match that path. The database holds the shape (`^https://`, lengths, kinds, caps). The profile page re-checks every row it reads, so a row written straight through the API is never drawn unless it passes. |
| Words | Link labels and store titles go through `containsProfanity` (`lib/moderation/profanity.ts`). A profile has no "private" state to fall back to, so strong language is **refused** with a field error, not saved privately. Mild words ("Damnation", "Hell's Caretaker") pass. |
| `rel` | Every user-written link and store gets `nofollow noopener ugc` (`USER_LINK_REL`). Profile links also get `me`, so Mastodon and IndieAuth-style checks can verify the profile. |
| Marks | Socials and support pages draw the platform's own single-colour mark from Simple Icons 15.22.0 (CC0), unaltered, in `currentColor`, beside the platform's name, linking to the maker's own page. Magic sites and every store platform get a **neutral** icon, with the name as plain text. None of them is in Simple Icons and none publishes a kit (see below). |
| SEO | Every link a creator adds goes into the profile's Person JSON-LD `sameAs` (deduplicated, next to the website and column socials). Store links stay out of `sameAs`: they are shops, not identities. |

## 1. Public profiles on Magic sites and tools

| Site | Public profile? | URL format (hosts) | Brand kit |
| --- | --- | --- | --- |
| Moxfield | Yes. Creators link to it from their bios [19][S] | `https://moxfield.com/users/<name>` [19][S]. The `www.` variant is unverified | None found |
| Archidekt | Yes: bio, recent decks, folders, followers [12][S] | `https://archidekt.com/u/<name>`, which replaced an older user path. `www.archidekt.com` is also live [12][S] | None found |
| EDHREC | No user profiles. It aggregates decks from Archidekt, Moxfield and others [46][S] | none | None found |
| Scryfall | No public profile page found. Deck links exist; `scryfall.com/@<user>/decks/<id>` is unverified | deck links only | None found |
| TCGplayer (buyer side) | No public buyer profile. For sellers, see §3 | none | none |
| MTGTop8 | No accounts. Player results come from a search (unverified) | none | none |
| MTGGoldfish | Player pages (tournament and MTGO results) [14][S] | `https://www.mtggoldfish.com/player/<name>` [14][S] | None found |
| TappedOut | Yes [13][S] | `https://tappedout.net/users/<name>/` [13][S] | none |
| Deckstats | Has users; URL format unverified | `deckstats.net/…` | none |
| Card Conjurer | No profiles. Wizards sent the original site a cease-and-desist in Nov 2022; a remake runs as a general custom-card site [17][18][S]. Its community overlaps r/mpcproxies, r/magicproxies and their Discords [17][S] | link a Discord or Reddit | none |
| MTG Arena | No public web profiles [16][S] | none | none |
| Untapped.gg | "Personal Statistics Profile Pages", fed by the companion app [15][S] | host `mtga.untapped.gg`; the path uses an opaque id (unverified) | None found |
| 17lands | No public player profile found (unverified) | none | none |
| Cardsphere | Profile pages (wants, for-sale cards, messages) [44][S] | unverified | none |
| Melee.gg | Has player profiles; URL unverified | `melee.gg/…` | none |

None of these sites, nor Wizards / Magic itself, is in Simple Icons [2][R]. So they get a neutral icon and their name as text.

## 2. General socials

"SI" below means Simple Icons [2][R]. The guideline URLs come from Simple Icons' `guidelines` field [2][R]; those pages were not opened.

| Platform | URL format(s) | In SI? | Brand guidance |
| --- | --- | --- | --- |
| X | `x.com/<h>`, `twitter.com/<h>` | `x` yes; `twitter` was removed as a duplicate [5][R] | Brand toolkit, with an "@handle lockup" for showing an account; the marks may be used only as X authorises [39][S] |
| Bluesky | `bsky.app/profile/<handle-or-DID>` (route `/profile/:name`) [9][R]. Any domain can be a handle [8][R] | yes | Press FAQ |
| Instagram / Threads | `instagram.com/<h>`; `threads.net/@<h>` and `threads.com/@<h>` (the latter unverified) | yes | Meta brand resources |
| Facebook | `facebook.com/<name>`, `/profile.php?id=`, `/groups/<id>` | yes | Meta brand resources |
| TikTok | `tiktok.com/@<h>` | yes | none listed |
| YouTube | `youtube.com/@<handle>`, `/channel/UC…`, legacy `/c/` and `/user/`. `youtu.be` is videos only [41][S] | yes | YouTube brand resources |
| Twitch | `twitch.tv/<name>` (`www.`, `m.`); names are `[A-Za-z0-9_]`, 4–25 characters (unverified) | yes | brand.twitch.tv |
| Discord | `discord.gg/<code>`, `discord.com/invite/<code>` | yes | Don't edit, recolour or distort the logo [40][S] |
| Reddit | `reddit.com/user/<n>`, `/u/<n>`, `/r/<sub>`; `www.`, `old.` and `new.` hosts | yes | The 2018 guidelines want permission "in most cases" and no altering of Snoo; linking to your own Reddit presence is commonly treated as accepted use [42][S] |
| Patreon | `patreon.com/<vanity>`, `patreon.com/c/<name>` [37][S] | yes | Patreon **licenses creators** to use its logo to promote their page, unaltered [36][S] |
| Ko-fi | `ko-fi.com/<name>` | yes | Creators may use the logo and badges to promote their page [38][S] |
| Mastodon | `https://<any host>/@<user>`; `/users/<u>` redirects to `/@<u>` [11][R]. Local usernames are `[a-z0-9_]`, up to 30 characters [10][R] | yes | joinmastodon.org/branding |
| Linktree, Substack, ArtStation, DeviantArt | `linktr.ee/<n>`, `<n>.substack.com` or `substack.com/@<n>`, `artstation.com/<n>`, `deviantart.com/<n>` | yes | none listed in SI |

### Simple Icons

- **Licence:** the repository is CC0 1.0 [3][R]. Its disclaimer says brand guidelines and trademarks still apply, and users must get any permissions they need [1][R].
- **Removals:** brands are removed on request, or proactively where there is no permission, mostly in major releases [1][R]:
  - LinkedIn (PR #11380) [4][R]
  - Twitter, as a duplicate of X [5][R]
  - Adobe [6][R]
  - Amazon/AWS [6][R]
  - OpenAI, Canva and Walmart in v16 [7][R]
- **How PipGlyph uses it:** we copy only the paths we draw, from a pinned version (15.22.0), and do not depend on the package. The rest are neutral lucide icons.

## 3. Card-selling platforms

| Platform | Individual storefront? | URL format | Allow-list (registry) | Brand / logo |
| --- | --- | --- | --- | --- |
| eBay | Yes. Every seller has a profile; a Store needs a subscription [23][24][S] | `ebay.<tld>/usr/<user>` (profile), `ebay.<tld>/str/<store>` [24][S] | `ebay.com` plus 13 country sites; path `/str/` or `/usr/` | In SI with no guideline; neutral icon |
| Whatnot | Yes: live auctions and a shop | `whatnot.com/user/<name>` (`/shop`, `/reviews` subpaths) [25][S] | `whatnot.com`; path `/user/<name>` | Not in SI; neutral |
| TCGplayer | Marketplace sellers. Seller Storefronts rolled out to all sellers from May 6, 2026 [20][S] | `shop.tcgplayer.com/sellerfeedback/<id>` [21][S]; the new storefront path is unverified | `tcgplayer.com` (host only) | Not in SI; neutral |
| TCGplayer Pro sites | Stores only, on their own domains [22][S] | custom domain | "Online shop" | none |
| Card Kingdom | **No.** Individuals sell to it through the buylist [30][S] | none | not offered | none |
| Cardmarket | Yes: private, professional and power sellers [26][S] | `cardmarket.com/<lang>/Magic/Users/<name>` [26][S] | `cardmarket.com`; path `/<lang>/Magic/Users/<name>` | In SI with no guideline; neutral |
| Mana Pool | Yes: stores and indie sellers [28][S] | `manapool.com/shop/<username>` [27][S] | `manapool.com`; path `/shop/<name>` | Not in SI; neutral |
| CardTrader | Marketplace; profile path unverified | none | `cardtrader.com` (host only) | Not in SI; neutral |
| Mercari | Personal seller pages | US `mercari.com/u/<id>/`; JP `jp.mercari.com/user/profile/<id>` [29][S] | `mercari.com`; both paths | Not in SI; neutral |
| Facebook Marketplace / Groups | Seller profile; groups | `facebook.com/marketplace/profile/<id>`, `/groups/<id>` (unverified) | `facebook.com`; Marketplace, group or page path | Meta resources; neutral on store cards |
| Etsy | Yes | `etsy.com/shop/<Shop>` or `<shop>.etsy.com` [45][S] | `etsy.com`; `/shop/` or the subdomain's home | In SI; neutral on store cards |
| Troll and Toad | Retailer with a buylist; no individual storefronts (unverified) | none | not offered | none |
| Shopify / Big Cartel | Yes, on a custom domain, `*.myshopify.com` or `*.bigcartel.com` | custom domain | "Online shop" | none |
| Fanatics Collect / Live, TikTok Shop | Live breaks; TikTok shops sit on TikTok accounts [43][S] | unverified | not offered (TikTok is a profile column) | none |

**Store cards draw no platform logo.** Most of these brands publish no kit, or want permission first; the rest are in Simple Icons only as trademarks. The card prints the platform's name as text next to a neutral icon, plus the creator's title and a "Visit store" call to action. That stays inside every brand's rules and keeps the cards one family.

### Proxies, counterfeits and Etsy

- **Wizards of the Coast.**
  - The 2016 statement is still the reference. Wizards does not police playtest cards made for personal, non-commercial use, and removes from organised play anyone who knowingly distributes counterfeits [33][S].
  - A later clarification defines a counterfeit as any attempt to replicate a real card's appearance [34][S].
  - The Fan Content Policy covers non-commercial fan content: fan content may not be sold, and Wizards' logos and trademarks need consent [35][S].
  - So the Settings copy says: link your real shop, and don't present PipGlyph designs as cards for sale.
- **Etsy.**
  - Sellers must hold the rights to what they list [31][S], and listings are removed when a rights holder reports them [32][S].
  - Proxies and alters that reproduce Wizards' card art or frames are exposed to takedown.

## Sources

[R] = read in full. [S] = from search results only.

1. https://raw.githubusercontent.com/simple-icons/simple-icons/develop/DISCLAIMER.md [R]
2. https://raw.githubusercontent.com/simple-icons/simple-icons/develop/data/simple-icons.json [R]
3. https://raw.githubusercontent.com/simple-icons/simple-icons/develop/LICENSE.md [R]
4. https://github.com/simple-icons/simple-icons/pull/11380 [R]
5. https://github.com/simple-icons/simple-icons/pull/9748 [R]
6. https://github.com/simple-icons/simple-icons/pull/10018 and https://github.com/simple-icons/simple-icons/pull/13056 [R]
7. https://github.com/simple-icons/simple-icons/pull/13944, https://github.com/simple-icons/simple-icons/pull/13865, https://github.com/simple-icons/simple-icons/pull/14072 [R]
8. https://raw.githubusercontent.com/bluesky-social/atproto/main/packages/syntax/src/handle.ts [R]
9. https://raw.githubusercontent.com/bluesky-social/social-app/main/src/routes.ts [R]
10. https://raw.githubusercontent.com/mastodon/mastodon/main/app/models/account.rb [R]
11. https://raw.githubusercontent.com/mastodon/mastodon/main/config/routes.rb [R]
12. https://archidekt.com/news/4164035 [S]
13. https://tappedout.net/users/cgoober/ [S]
14. https://www.mtggoldfish.com/player/MtgoUser031832121 [S]
15. https://invenglobal.com/articles/9111/untappedgg-launches-personal-statistics-profile-pages-for-mtg-arena [S]
16. https://draftsim.com/mtg-arena-profile/ [S]
17. https://riptidelab.com/forum/goto/post?id=120558 [S]
18. https://www.patreon.com/kyleburton/about [S]
19. https://substack.com/@balefulstrix1 (a bio linking to `moxfield.com/users/…`) [S]
20. https://seller.tcgplayer.com/blog/showcase-your-business-with-seller-storefronts [S]
21. https://shop.tcgplayer.com/sellerfeedback/7df68429 [S]
22. https://seller.tcgplayer.com/pro and https://help.tcgplayer.com/hc/en-us/articles/4409612014487 [S]
23. https://www.ebay.com/help/selling/ebay-stores/open-ebay-store?id=4092 [S]
24. https://community.ebay.com/t5/Selling/Direct-Links-to-eBay-Store/td-p/30235330 [S]
25. https://www.whatnot.com/user/jannisage/shop [S]
26. https://help.cardmarket.com/en/new-user-guide [S]
27. https://support.manapool.com/hc/en-us/articles/33650182066711 [S]
28. https://manapool.com/seller-info [S]
29. https://apify.com/nifty.codes/mercari-sellerdetails-scraper [S]
30. https://blog.cardkingdom.com/how-to-sell-your-collection/ [S]
31. https://etsy.com/legal/ip/ [S]
32. https://help.etsy.com/hc/articles/360034079714 [S]
33. https://magic.wizards.com/en/news/announcements/proxies-policy-and-communication-2016-01-14 [S]
34. https://icv2.com/articles/news/view/33489/wotc-clarifies-proxy-position-magic [S]
35. https://company.wizards.com/en/legal/fancontentpolicy [S]
36. https://support.patreon.com/hc/en-us/articles/216539323-Use-Patreon-s-logo-to-promote-my-Patreon [S]
37. https://support.patreon.com/hc/en-us/articles/203913349 [S]
38. https://help.ko-fi.com/hc/en-us/articles/360007169493-Can-I-use-the-Ko-fi-logo-to-promote-my-page [S]
39. https://docs.x.com/developer-terms/display-requirements [S]
40. https://docs.discord.com/developers/discord-social-sdk/design-guidelines/branding-guidelines.md [S]
41. https://support.google.com/youtube/answer/11585688 [S]
42. https://www.redditinc.com/brand (2018 guidelines PDF) [S]
43. https://www.cardpulse.club/blog/whatnot-vs-fanatics-collect-2026-market [S]
44. https://blog.cardsphere.com/?p=796 [S]
45. https://www.alura.io/blog/what-you-need-to-know-before-changing-your-etsy-shop-name.md [S]
46. https://draftsim.com/how-to-use-edhrec/ [S]
