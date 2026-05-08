# Phase 8 — AI Assistant MVP

## Goal

Add lightweight AI assistance to improve card creation without making AI the whole product.

## Scope

Build:

- AI rules text helper
- AI flavor text helper
- AI balance notes
- AI art prompt generator
- AI card idea generator

## UX

In the creator, add an AI panel with actions:

- Improve wording
- Suggest cost
- Suggest rarity
- Generate flavor text
- Generate art prompt
- Check balance
- Generate from concept

## Guardrails

AI output must be editable before saving.

Do not automatically overwrite user fields without confirmation.

## Suggested API Structure

Create:

- `lib/ai/card-assistant.ts`
- `app/api/ai/card-assistant/route.ts`

## Prompt Requirements

AI should consider:

- card type
- cost
- rarity
- rules text
- power/toughness
- intended color identity
- balance risk
- templating clarity
- fantasy tone

## No Copyright Guardrail

AI should not generate official card names, official character names, official set names, or proprietary world references.

## Acceptance Criteria

- Authenticated user can request AI suggestions.
- Suggestions are displayed safely.
- User can apply suggestions manually.
- Errors and rate limits are handled.
- Build passes.

## Claude Instruction

Implement Phase 8 only. Keep it simple. Do not build full AI set generation yet.
