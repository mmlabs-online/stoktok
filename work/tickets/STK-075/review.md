# Review — STK-075: Self-host the Nunito font so web builds need no network

## Attempt 1 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- typecheck: exit 0
- lint: exit 0
- test: exit 0. core 779 passed (64 files); sources 35 passed (1 file skipped); ai 169 passed; db 174 passed, 1 todo; worker 293 passed (1 file skipped); web 314 passed (41 files)
- check:service-key: exit 0 ("OK: no secret or AI SDK material in client bundle")
- Isolation sanity: inside `unshare -rn` plus the impl-log loopback helper (`isolated.sh` → `lo_up.py`, SIOCSIFFLAGS on `lo` only), `/proc/net/route` is empty. `curl https://fonts.googleapis.com` gets exit 7 (the proxy on loopback is not reachable). `curl https://fonts.gstatic.com` with the proxy unset gets exit 6 (cannot resolve).
- Negative control (reviewer's own run): I extracted `git archive origin/main` into a scratch dir, copied `node_modules` in, and ran the same isolated `pnpm --filter @stoktok/web build`. It exits 1 with "next/font: error: Failed to fetch Nunito from Google Fonts." The scratch copy was deleted afterwards.
- Positive run (reviewer's own run): I ran `rm -rf apps/web/.next`, then `unshare -rn isolated.sh env NEXT_TELEMETRY_DISABLED=1 pnpm --filter @stoktok/web build` on HEAD 440eb00. Exit 0 and the full route table printed.

### Acceptance criteria
- [x] `layout.tsx` uses `next/font/local` with committed files, and `next/font/google` is gone — evidence: apps/web/app/layout.tsx:2 and :8-17. `grep -rn "next/font/google" apps/web` (excluding node_modules and .next) finds nothing. `git ls-files apps/web/app/fonts` lists `Nunito-{400,600,700,800}.woff2` and `OFL.txt`.
- [x] Same weights, style and subsets with Vietnamese glyphs, and the same variable/class — evidence:
  - layout.tsx has 4 `src` entries (400/600/700/800, all `normal`), `variable: '--font-nunito'`, `display: 'swap'`, and `className={nunito.variable}` is unchanged. globals.css is not in the diff.
  - SHA-256 of all 4 woff2 files and OFL.txt match impl-log exactly. I re-packed `@fontsource/nunito@5.3.0` myself and its tgz sha256 (`4d8e1fb4…c77b`) matches impl-log.
  - Fresh scratch venv with fonttools 4.68.0. For each weight:
    - The merged cmap equals the latin ∪ vietnamese source union (332 codepoints, 0 missing, 0 extra).
    - Every required range is present: ASCII, U+00C0–00FF, Ă/Đ/Ĩ/Ũ/Ơ/Ư, U+1EA0–1EF9 and ₫.
    - `usWeightClass` is 400/600/700/800 respectively.
    - The decomposed outlines and advance widths of every mapped codepoint are identical to the source subset file (0 diffs).
    - GSUB, GPOS and GDEF are kept.
  - The codepoints in Google's ranges that the files lack (U+0329, parts of U+2000–206F, control characters) are also absent from the Fontsource sources, so this is the same coverage as before.
  - Browser check, Chromium via Playwright at deviceScaleFactor 1. Page 1 used the built CSS chunk with `.MKK5mG_variable` on `<html>` and `font-family: var(--font-nunito)`. Page 2 used the committed woff2 files directly. Both used the text "Đầu tư cổ phiếu — lãi ₫ ệ ư đ" at 400/600/700/800.
    - `document.fonts` shows `nunito/400|600|700|800` loaded.
    - `document.fonts.check` is true for every weight.
    - CDP `CSS.getPlatformFontsForNode` reports only the custom Nunito face (33/33 glyphs) for every line, with no fallback face. The control line in Arial reports Liberation Sans.
    - Text widths for 400/600/700/800 are 418.7/424.5/431.5/439.4 px on both pages, versus 469.0 px for the fallback.
    - There were no external requests. The screenshots show the correct Nunito shapes and distinct weights.
- [x] OFL 1.1 committed and listed — evidence: `apps/web/app/fonts/OFL.txt` is byte-identical to the `LICENSE` in the fontsource 5.3.0 package. It has the Nunito copyright line and the full OFL 1.1 text (preamble, definitions, permission, termination, disclaimer). Nunito has no Reserved Font Name, so the merged (modified) files may keep the name. `THIRD_PARTY_NOTICES.md` has a new "Nunito font" section with the source and version, the merge note, the copyright line and a link to OFL.txt.
- [x] The build works with the Google hosts blocked, and the CSS has only local URLs — evidence: the isolated positive run exits 0 and the negative control fails (above).
  - `grep -rEl "fonts\.(googleapis|gstatic)\.com" apps/web/.next` finds nothing.
  - The CSS `url()`s are only `../media/Nunito_{400,600,700,800}-s.p.*.woff2`, which resolve to `/_next/static/media/`.
  - `.next/static/media` holds 4 woff2 files with the same byte sizes as the committed files.
  - The `@font-face` rules say weight 400/600/700/800, style normal, `font-display: swap`.
- [x] typecheck, lint, test and check:service-key are green — see Checks.

### Issues
None.

### Scope
The implementer's changed files are exactly the 7 in the plan. The other files in `origin/main...HEAD` are orchestrator workflow bookkeeping: `work/backlog.md`, the STK-074 ticket (commit 8ddc86c, made by `/ticket` before this ticket) and the STK-075 ticket, consult, plan and impl-log. None of these are code. `.gitignore` and `.dockerignore` do not exclude the fonts (`git check-ignore` finds no match). The Dockerfile's `COPY . .` brings them into the build stage.

### Rules R1–R10
No violations found. This change is a static asset and import wiring only. There is no money logic, data, auth or secret involved, and `check:service-key` is green.

### Nits (do not block)
- impl-log says CSS URLs are `../media/…` rather than the plan's literal `/_next/static/media/…`. That is correct and already noted there; the URLs are equivalent.
- The name table inside the Fontsource files reads "Nunito ExtraLight …" for all weights, so DevTools shows that platform name. Rendering is correct, and `next/font/local` assigns its own family name.
- In the headless sandbox the `nunito Fallback` face (`local(Arial)`) shows `error` because Arial is not installed. This is expected `adjustFontFallback` behaviour and only matters before the woff2 loads.

### Follow-ups (out of scope)
- OFL redistribution in the image: the runtime image ships the woff2 files under `.next/static/media`, but OFL.txt is not in the image. `.dockerignore` keeps nothing extra, and the standalone output does not include it. The font files do carry the copyright (name ID 0) and the OFL URL (ID 14) but not the full licence text (ID 13). If the Docker Hub image is public, consider copying `apps/web/app/fonts/OFL.txt` into the runner stage.
- Optional: add a CI guard (for example a grep in `check:service-key` or lint) that fails if `next/font/google` comes back into `apps/web`.
- Optional (Ming decides): use a true 500 weight or a variable font for `font-medium`. Today 500 still renders as 400, which is unchanged behaviour.
