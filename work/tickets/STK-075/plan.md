Status: READY

# Plan — STK-075: Self-host the Nunito font so web builds need no network

## Spec summary
No product scope change. This is a build-reliability fix for the deployment pipeline:

> docs/spec-v1.md §7 Deployment — "App repo (private): CI and image build on GitHub-hosted runners, images pushed to the Docker Hub account used by other mmlabs apps."

Ticket goal: "Make `next build` for web independent of Google Fonts by shipping the Nunito font files in the repo and loading them with `next/font/local`, so CI and the web image build stop failing at random on the font download."

Current config (`apps/web/app/layout.tsx` lines 8–13), which must be reproduced exactly:
`Nunito({ subsets: ['latin', 'vietnamese'], weight: ['400', '600', '700', '800'], variable: '--font-nunito', display: 'swap' })`. It uses normal style only (no italic). `className={nunito.variable}` goes on `<html>`, and `globals.css` consumes it as `--font-sans: var(--font-nunito), …`.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `layout.tsx` loads Nunito with `next/font/local` from committed files; `next/font/google` is not used anywhere in `apps/web` | `grep -rn "next/font/google" apps/web --exclude-dir=node_modules --exclude-dir=.next` returns nothing. `layout.tsx` imports `localFont from 'next/font/local'` with `src` paths under `./fonts/`. `git ls-files apps/web/app/fonts` lists the 4 woff2 files and `OFL.txt`. |
| 2 | Files cover exactly weights 400/600/700/800, normal style, latin + vietnamese subsets including Vietnamese glyphs; `--font-nunito` variable and class unchanged | (a) `layout.tsx` `src` has exactly 4 entries: weight `'400'`, `'600'`, `'700'`, `'800'`, all `style: 'normal'`. `variable: '--font-nunito'`, `display: 'swap'`, `className={nunito.variable}` on `<html>`. `globals.css` is unchanged in the diff. (b) The cmap verification output (see Approach step 4) is pasted in `impl-log.md` and shows, per file: OS/2 `usWeightClass` matches the file's weight; merged cmap ⊇ union of the two Fontsource source cmaps (0 missing); every codepoint in the Google `vietnamese` unicode-range that the source has is present, including U+1EA0–1EF9, U+0102–0103, U+0110–0111, U+0128–0129, U+0168–0169, U+01A0–01A1, U+01AF–01B0 and U+20AB; and printable ASCII U+0020–007E plus U+00C0–00FF are present. The reviewer may re-run the script from impl-log in a scratch venv. |
| 3 | SIL OFL 1.1 committed next to the files and listed in `THIRD_PARTY_NOTICES.md` | `apps/web/app/fonts/OFL.txt` exists and contains the full OFL 1.1 text plus the Nunito copyright line. `THIRD_PARTY_NOTICES.md` has a Nunito section with the source (`@fontsource/nunito@<version>`), the licence name and a link to the `OFL.txt` path. |
| 4 | `pnpm --filter @stoktok/web build` succeeds with Google Fonts hosts blocked; built CSS references only local font files | `impl-log.md` shows the network-isolated build (Approach step 5): a **negative control** where the unmodified `main` layout fails under the same isolation, then a **positive run** where the new layout passes. After the positive run, `grep -rEl "fonts\.(googleapis\|gstatic)\.com" apps/web/.next` returns nothing. `grep -rho "url([^)]*\.woff2)" apps/web/.next/static --include=*.css` shows only `/_next/static/media/…woff2` URLs. `ls apps/web/.next/static/media/*.woff2` shows 4 font files. |
| 5 | `typecheck`, `lint`, `test`, `check:service-key` green | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:service-key` all exit 0, with output in impl-log. CI on the PR is green. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/web/app/layout.tsx` | Replace the `next/font/google` import and call with `localFont({ src: [4 entries], variable: '--font-nunito', display: 'swap' })`. Keep the `nunito` const name and `className={nunito.variable}`. Update the line-7 comment to say the font is committed in `app/fonts` (OFL). | AC1, AC2 |
| `apps/web/app/fonts/Nunito-400.woff2` | New binary: latin + vietnamese merged, weight 400 | AC1, AC2 |
| `apps/web/app/fonts/Nunito-600.woff2` | Same, weight 600 | AC1, AC2 |
| `apps/web/app/fonts/Nunito-700.woff2` | Same, weight 700 | AC1, AC2 |
| `apps/web/app/fonts/Nunito-800.woff2` | Same, weight 800 | AC1, AC2 |
| `apps/web/app/fonts/OFL.txt` | New file: the full SIL OFL 1.1 text, copied from the `@fontsource/nunito` package `LICENSE`, with the line "Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)" | AC3 |
| `THIRD_PARTY_NOTICES.md` | Append a "Nunito font" section with the source package and version, a note that the files were merged from the latin and vietnamese subsets, "SIL Open Font License 1.1", and a pointer to `apps/web/app/fonts/OFL.txt` | AC3 |

Do not modify any other files. Specifically, leave `globals.css`, `package.json`, `pnpm-lock.yaml`, the Dockerfile, `.gitignore` and `.dockerignore` alone. `@fontsource/nunito` and fonttools are **build-time tools for the implementer only** and must not be added as repo dependencies. `.gitignore` and `.dockerignore` were checked and neither excludes `*.woff2` or `app/fonts`.

## Tests to write
None. No `packages/core` logic changes, so R8's unit-test requirement does not apply. Verification is the grep, cmap and build evidence in the table above. The existing `check:service-key` builds the web app, so it also re-exercises the font path in CI.

## Approach
1. **Get the sources (npm, not Google).** In the scratchpad, not the repo, run `npm pack @fontsource/nunito`. Record the version and extract it into a new empty directory. Check the actual filenames in `files/`; the expected names are `nunito-latin-{400,600,700,800}-normal.woff2` and `nunito-vietnamese-{…}-normal.woff2`. Fontsource mirrors Google's per-subset files and unicode-ranges, which is exactly what `next/font/google` downloaded before.
2. **Set up fonttools in a scratch venv.** Run `python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install fonttools brotli`. Keep this venv out of the repo.
3. **Merge one file per weight.** For each weight W, run `pyftmerge` on `nunito-latin-W-normal.woff2` and `nunito-vietnamese-W-normal.woff2` and save the result as woff2 (`fontTools.merge.Merger().merge([...])`, then `font.flavor='woff2'` and `font.save('Nunito-W.woff2')`, run with `python -I`). Then copy the results into `apps/web/app/fonts/`. One file per weight is required because `next/font/local` has no per-file `unicode-range` (consult rec. 2).
   - **Fallback if the merge fails or loses glyphs:** instance the static weight from the upstream variable font `Nunito[wght].ttf` (google/fonts or googlefonts/nunito on GitHub, if reachable) with `fontTools.varLib.instancer` at `wght=W`. Then run `pyftsubset --unicodes=<Google latin range>,<Google vietnamese range> --layout-features='*' --flavor=woff2`. Record which path was used in impl-log.
   - The Google ranges for the subset/check are:
     - latin: `U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD`
     - vietnamese: `U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB`
4. **Verify glyph coverage.** Write a scratch Python script (kept out of the repo, with its text pasted into impl-log) that does the following for each weight:
   - Loads the two sources and the merged file with `TTFont`.
   - Asserts `merged.getBestCmap().keys() ⊇ latin_src.cmap ∪ vn_src.cmap`.
   - Asserts every codepoint in (Google latin ∪ vietnamese ranges) ∩ (source cmaps) is in the merged cmap. A codepoint that is in the Google range but absent from the source is reported as an expected gap, not a failure.
   - Asserts that U+0020–007E, U+00C0–00FF, U+0102–0103, U+0110–0111, U+0128–0129, U+0168–0169, U+01A0–01A1, U+01AF–01B0, U+1EA0–1EF9 and U+20AB are all present.
   - Asserts that `OS/2.usWeightClass == W` and that the family name (name ID 1/16) is "Nunito".
   - Prints the counts and an `OK` line per file.
5. **Prove the build needs no Google Fonts network.**
   - **Isolation:** do not use Docker; it is unavailable. Use a network namespace with no network: `unshare -rn` (or `unshare -n` as root), with `NEXT_TELEMETRY_DISABLED=1`. Install dependencies beforehand, because only `next build` runs isolated.
   - Command: `unshare -rn env NEXT_TELEMETRY_DISABLED=1 pnpm --filter @stoktok/web build`.
   - If `unshare` is not permitted, use the fallback: run the same build with `HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 https_proxy=… http_proxy=… NO_PROXY= no_proxy=` (a dead proxy).
   - **(a) Negative control:** run the chosen command on a clean checkout of the current `main` layout (`git stash`, or `git worktree add` on scratch). It must fail on `next/font/google`. This proves the block is real.
   - If even the negative control succeeds, the isolation is not effective. In that case, say so in impl-log and rely on the static evidence in (c).
   - **(b) Positive run:** run the same command on the change. It must exit 0.
   - **(c) Static evidence:** run the greps from AC4 (no Google font host in `.next`; CSS `url()`s are only `/_next/static/media/*.woff2`; 4 media woff2 files).
   - Paste the commands and the key output lines into impl-log.
6. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm check:service-key`.
7. **Visual spot check (optional, best effort).** `pnpm --filter @stoktok/web dev`, then load `/login`. In DevTools, the computed font for text containing "ệ ư đ ₫" should be the Nunito face, not the fallback. If a browser is not available in the sandbox, skip this and rely on step 4.

**Rules:**
- R1–R4 and R9 are not touched: this is UI asset wiring only.
- R3: the font is a static asset in `.next/static/media`, and `check:service-key` still passes.
- R5 and R10: not applicable.
- R6: `layout.tsx` contains no auth logic and is unchanged in that respect.
- R7: only the files listed above change.
- R8: step 6.

## Specialist input used
From `consult-data-visualization-engineer.md`:
- **Adopted:**
  - Rec. 1: static 400/600/700/800, not a variable font. This keeps rendering identical, including `font-medium` (500) still resolving to 400. Switching to a variable font would be a visual change and is out of scope.
  - Rec. 2: merge latin and vietnamese into one file per weight, sourced from `@fontsource/nunito`. Fontsource is reachable on npm, while the Google hosts may not be.
  - Rec. 3: location `apps/web/app/fonts/` and file names `Nunito-{W}.woff2`. `.gitignore` and `.dockerignore` were checked and are fine. The Dockerfile `COPY . .` includes the files.
  - Rec. 4: the code shape for `localFont`, with `globals.css` untouched.
  - Rec. 5: default `adjustFontFallback`, no `preload: false`.
  - Rec. 6: `OFL.txt` plus a notices entry.
  - Rec. 7 and the Risks section: no-network build, no Google URL in the output, cmap comparison against the Google ranges.
- **Adjusted:**
  - Rec. 4 "keep the family name Nunito": `next/font/local` derives the internal `font-family` name itself, and the app only references `var(--font-nunito)`, so the generated name does not matter. No `declarations` override is added.
  - Open question "does a check reject committed binaries?": none was found in `scripts/` or `package.json`, so it is not a blocker.

## Assumptions
- **Static weights.** Ming accepts static weights, with `font-medium` (500) continuing to render as 400 as it does today (the consult's open question). This is the zero-visual-change default. Moving to a true 500 or a variable font can be a follow-up if Ming wants it.
- **Source and merge.** Fontsource's subset files are byte-equivalent in coverage to what `next/font/google` served. Kerning between a latin glyph and a vietnamese-only glyph is not added by the merge, which matches today's behaviour where they were separate files.
- **Size.** About 100–150 KB of binaries in git is acceptable. No Git LFS.
- **No provenance script.** The merge and verify scripts are not committed. Their exact commands, the source package version and SHA-256 sums of the 4 output files are recorded in `impl-log.md` and the notices entry, so the files can be regenerated.
- **Build host.** `next build` does not need any other network access once `node_modules` is installed (telemetry disabled).

## Blocking questions
None.

## Split proposal
None. The change is about 30 lines of text plus 5 asset files.
