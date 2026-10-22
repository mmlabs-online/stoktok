# STK-007: App shell and shared UI components from Figma Make

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | ui |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
Port the Figma Make app shell and shared presentational components into `apps/web`, with formatting helpers in `packages/core`, so every screen ticket builds on the same layout and components.

## Spec reference
docs/spec-v1.md §3 (screens for F1–F3), §2.3 Legal posture (DisclaimerNote). docs/figma-make-prompts.md "Export & port checklist". CLAUDE.md R1, R2, price colors.

## Acceptance criteria
- [ ] Shell ported: sidebar, top bar, light/dark toggle, data-freshness indicator; Vietnamese UI labels.
- [ ] Shared components ported into `apps/web/components/`: PriceChange, MoneyText, DataFreshnessBadge, LotStatusBadge, SymbolLink, StatCard, EmptyState, DisclaimerNote — presentational only, data via props, no calculations (R1); `"use client"` only where interactive.
- [ ] Formatting helpers (VND, percent, price, date) live in `packages/core` and take integer VND (R2), with unit tests.
- [ ] Price colors follow the VN convention: up green, down red, reference yellow, ceiling purple, floor cyan.
- [ ] Routes `/`, `/transactions`, `/import`, `/watchlist`, `/settings`, `/symbols/[symbol]` exist as empty pages inside the shell, behind the auth middleware.
- [ ] Port checklist done: no `figma:asset` imports, no version-suffixed imports, no `reduce(` / arithmetic left in JSX.

## Notes / answers from Ming
- Depends on: STK-001.
- **Input needed (⛔ blocking):** link to the Figma Make file. Planner: return BLOCKED if no link is provided here.
