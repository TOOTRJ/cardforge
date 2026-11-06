# "Save more cards" is why people pay — research and a plan (2026-11-06)

Owner's finding: current users convert to Plus / Pro to SAVE MORE CARDS,
not for the AI features. Owner's asks: make that benefit stand out
everywhere the paid plans are named, near the top of the pricing page;
research how other companies capitalised on a quantity cap; find other
high-value items for the paid plans. Findings first, the plan and the
copy second; **nothing is built until the owner has seen the visuals.**

## 1. What the pricing page says today

Headline "Choose the plan that fits your craft." Every column leads with AI
credits; the saved-card cap sits fourth or fifth of six or seven lines: Free
50, Plus 500, Pro unlimited. The one benefit people pay for is the one the
page buries. Credits are an abstraction; "500 saved cards" is concrete.

## 2. Who sells on a quantity cap, and what happened

| Product | The cap | What happens over it | Lesson |
|---|---|---|---|
| **MTG Cardsmith** (the direct competitor) | Free 30 saved cards, Premium 2,000 at $9.99/mo | Free cards face a "monthly purge"; Premium "protects your cards", adds Restore Cards, no ads, a gold avatar ring, early access | They sell the cap with a deletion threat. PipGlyph's Free 50 is already 1.7× their 30 — the better pitch is "nothing is ever deleted". |
| **Dropbox** | 2 GB | Sync stops; "least recently modified files may be deleted" if persistently over | ~2.2 % of registered users pay (S-1, 2018). The persistent, dismissible, always-same-place upgrade prompt is the cited good pattern; the deletion clause is what users call "panic marketing". |
| **Evernote** | 50 notes (2023); 2 devices (2016) | Over the limit you keep viewing, editing, exporting; you cannot create | Survived a loud press backlash because nothing was lost. The pattern to copy. |
| **Trello** | 10 open boards | "Closed, not deleted" — reopen on upgrade | Same: the cap bites on NEW work, never on what exists. |
| **Figma** | 3 files on Starter | Team goes view-only; unlimited DRAFTS as the escape valve | Drafts that don't count is a clean soft cap. |
| **Airtable** | 1,000 records | Read kept, no new records; lax enforcement confused people | Make the count exact and say what counts. |
| **Notion** | 1,000 blocks → removed 2020 | n/a | Dropped the cap when viral growth mattered more than conversion. |
| **Bitly** | 1,000 → 5 links | Repeated cuts, ads on existing links | "Free plan useless" reviews: retroactive cuts are the one unforgivable move. |
| **Hero Forge** | no cap; perks (Pro badge, early access, hi-res) | — | Perks and physical goods, not caps. |
| **Moxfield / Archidekt** | no cap; Patreon $1–50 | — | Ad-free, badge, Discord role; Moxfield ~3,300 patrons pay for goodwill and flair. |

Numbers to trust: Dropbox's ~2 % (first-party filing); "typical freemium
2–5 %" (HBR, 2014). The "usage limits convert 1.5–2× feature limits" and
"67 % of upgrades happen at a limit" claims are vendor blog posts with no
source — treat as hypotheses. One academic before/after study (Ekonomická
revue, 2021) found loss-aversion wording converted best WITHOUT raising exit
rates. PipGlyph's own funnel rows are the better dataset once the surfaces
below carry a `surface` tag.

## 3. Patterns that raise conversion without a backlash

1. **Lead with the number.** Every product that sells a quantity puts it in
   the first line of the column.
2. **A personalised meter** where the decision is made: "48 of 50 cards
   saved" on the pricing page and the dashboard, amber from 80 %, dismissible
   per session, always linking to the same place.
3. **Soft cap: never delete, never lock reading.** Everything stays
   viewable, editable, downloadable; only NEW saves are gated; back under
   the cap means instantly unlocked. Evernote, Trello and Figma survived
   their caps on this rule; Dropbox and Cardsmith took the sentiment hit on
   deletion.
4. **Prompt before and AT the cap.** The 50th save is the highest-intent
   moment in every playbook; a pre-cap banner primes it.
5. **Frame it as keep-creating, not pay-or-lose.** "Your 50 cards are safe —
   Plus keeps you creating" beats "upgrade or lose access".
6. **Never lower the cap for existing accounts.** Every backlash case above
   was a retroactive change.

## 4. Other high-value items for the paid plans, ranked by evidence

| # | Item | Evidence | Effort |
|---|---|---|---|
| 1 | The cap as the headline, the meter, the cap-hit moment | PipGlyph's own data; Cardsmith; the Dropbox prompt pattern | S |
| 2 | **Never lose a card**: restore deleted cards (30 days Plus, forever Pro) and a card's version history | Cardsmith sells "Restore Cards"; Figma, Notion and Dropbox gate history length; the deck history already works this way | M |
| 3 | **Early access to new frames** (a week before Free) | Hero Forge's "Treasure Tuesday" week-early drops are a headline Pro perk; Cardsmith "early access" | S |
| 4 | **Member flair**: a tier badge on the profile and card page, an avatar ring | Cardsmith's gold ring, Hero Forge's Pro badge, Archidekt's patron badge — cheap, visible, and most of what Moxfield's patrons pay for | S |
| 5 | **Printed cards shipped** (already "coming soon") | Hero Forge's whole business; the print exports exist | L |
| 6 | **Folders / collections** in My Cards (Plus 10, Pro unlimited) | Figma projects and Trello boards gate organisation | M |
| 7 | **Private drafts don't count** toward the cap (the soft valve) | Figma's drafts | S–M |
| 8 | **Custom set-symbol upload** on paid plans | a Cardsmith backer perk; the set-icon field exists | S |

Not supported by evidence in hobby markets: priority rendering, an API,
collaboration features for a solo tool.

## 5. The plan (one PR, after the owner's OK on the visuals)

**Surfaces that name a paid plan**, each leading with the cap:

- `/pricing` and `/pricing-member`: the H1 becomes "Keep every card you
  make." with the line "Free holds 50. Plus holds 500. Pro holds them all."
  under it; each column's FIRST feature line is the cap ("500 saved cards —
  ten times the room"); credits move to line two. A signed-in viewer sees
  their own meter under the headline ("You've saved 48 of 50").
- The upgrade modal opens on the meter ("48 of 50 cards saved") with the
  cap as its first line; credits second.
- The dashboard credits card and My Cards: the existing capacity notice
  shows from 60 % (quiet), amber from 80 %, with "Plus holds 500".
- The 50th-card moment: the save succeeds and the toast says "That's 50 —
  your Free library is full. Your cards are safe; Plus keeps you creating
  (500 cards, $6/mo)." The 51st save is refused with the same words and a
  "Download my cards" link — never a deletion.
- The header's plan badge / avatar menu and Settings plan line: "Plus · 500
  cards" rather than "Plus · 30 credits".
- Funnel: `upgrade_modal_open` and `cta_click` carry `surface: "cap_meter"`
  / `"cap_hit"` so the owner can see cap-driven opens against credit-driven
  ones in the admin Funnel panel.

**Copy, for the owner to edit**

- Pricing H1: "Keep every card you make." — "Free holds 50 cards. Plus holds
  500. Pro holds them all."
- Column first line: "500 saved cards — ten times the room." / "Unlimited
  saved cards."
- Pre-cap banner (80 %): "40 of 50 cards saved. Nothing is ever deleted at
  50 — but new saves will need Plus."
- Cap-hit toast: "Your 50 Free cards are safe. To save the next one, move
  to Plus (500 cards, $6/mo) — or download your library any time."
- Blocked save: "Library full. Your cards stay yours: view, edit, download.
  Upgrade to keep creating."

**Cap values**: keep Free 50 / Plus 500 / Pro unlimited. They are generous
against Cardsmith (30 / 2,000) and the evidence does not support moving
them; never lower 50 for existing accounts.

**Suggested follow-ups** (each its own ask): item 2 (restore + history),
item 3 (early frames), item 4 (flair) — small, well-evidenced, and they
give Plus a second and third concrete reason beside the cap.
