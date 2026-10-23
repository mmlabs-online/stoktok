# STK-007: App shell and shared UI components

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P1 |
| Areas | ui |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Design and build the app shell and shared presentational components directly in `apps/web` (no Figma file — Ming's decision 2026-10-23), with formatting helpers in `packages/core`, so every screen ticket builds on the same layout and components.

## Spec reference
docs/spec-v1.md §3 (screens for F1–F3), §2.3 Legal posture (DisclaimerNote). docs/figma-make-prompts.md **Prompt 0 — Foundation** and Prompts 1–6, used as the written design brief (layout, components, labels, colors, light/dark). CLAUDE.md R1, R2, price colors.

## Acceptance criteria
- [ ] Shell built: sidebar, top bar, light/dark toggle, data-freshness indicator; Vietnamese UI labels; works at phone width.
- [ ] Shared components built in `apps/web/components/`: PriceChange, MoneyText, DataFreshnessBadge, LotStatusBadge, SymbolLink, StatCard, EmptyState, DisclaimerNote — presentational only, data via props, no calculations (R1); `"use client"` only where interactive.
- [ ] Formatting helpers (VND, percent, price, date) live in `packages/core` and take integer VND (R2), with unit tests.
- [ ] Price colors follow the VN convention: up green, down red, reference yellow, ceiling purple, floor cyan.
- [ ] Routes `/`, `/transactions`, `/import`, `/watchlist`, `/settings`, `/symbols/[symbol]` exist as empty pages inside the shell (no auth: R6 suspended, see CLAUDE.md).
- [ ] Design tokens (colors incl. the five price colors, spacing, typography, light/dark) are defined once and reused; no `reduce(` / arithmetic in JSX (R1).

## Notes / answers from Ming
- Depends on: STK-001.
- **No Figma (Ming, 2026-10-23):** design it ourselves from the written brief in `docs/figma-make-prompts.md`. Not blocking. Planner picks the styling approach (the brief assumes Tailwind + shadcn/ui + lucide-react) and flags it for Ming.
