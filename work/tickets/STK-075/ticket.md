# STK-075: Self-host the Nunito font so web builds need no network

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | ui |
| Attempts | 1 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Make `next build` for web independent of Google Fonts by shipping the Nunito font files in the repo and loading them with `next/font/local`, so CI and the web image build stop failing at random on the font download.

## Spec reference
docs/spec-v1.md §7 Deployment (CI builds images → Docker Hub). UI brief docs/figma-make-prompts.md (Nunito, set by the 2026-11 "sage palette" restyle). No product scope change.

## Acceptance criteria
- [ ] `apps/web/app/layout.tsx` loads Nunito with `next/font/local` from font files committed in the repo; `next/font/google` is no longer used anywhere in `apps/web`.
- [ ] The committed files cover exactly the weights, styles and subsets the current Google config uses, including Vietnamese glyphs; the CSS variable / class name the app uses stays the same, so the rendered UI does not change.
- [ ] The font licence (SIL OFL 1.1) is committed next to the files and listed in `THIRD_PARTY_NOTICES.md`.
- [ ] `pnpm --filter @stoktok/web build` succeeds with outbound network to `fonts.googleapis.com` / `fonts.gstatic.com` blocked, and the built CSS references only local font files (no Google Fonts URL).
- [ ] `typecheck`, `lint`, `test` and `check:service-key` are green.

## Notes / answers from Ming
- 2026-11-10 (orchestrator, Ming agreed): two of three web builds that day failed on `next/font/google` ("Can't resolve '@vercel/turbopack-next/internal/font/google/font'" / "next/font/google queries have exactly one entry"): PR #54 `ci` (check:service-key) and `images (web)` in run 42781064833 on main. Because of the second one, the STK-073 web image was not pushed and its in-container SDK probe has not run yet. Re-running that job is a stopgap; this ticket removes the cause.
- Do before STK-074, since any web PR can go red at random until this lands.
