# STK-075 consult — data-visualization-engineer

# Findings

- **Current use** (`/home/user/stoktok/apps/web/app/layout.tsx`):
  - `Nunito({ subsets: ['latin','vietnamese'], weight: ['400','600','700','800'], variable: '--font-nunito', display: 'swap' })`.
  - There is no italic, so normal style only.
  - The variable class is applied to `<html>`.
  - `<body>` uses Tailwind `font-sans`.
- **CSS wiring** (`/home/user/stoktok/apps/web/app/globals.css`, line 92): `--font-sans: var(--font-nunito), ui-sans-serif, system-ui, sans-serif;`. Mono is a system stack. There is no `tailwind.config`, because this is Tailwind v4 with `@theme` in the CSS.
- **Weights actually rendered:**
  - 400 is the default.
  - `font-medium` (500) appears in about 10 places.
  - `font-semibold` (600) and `font-bold` (700) are used widely.
  - `font-extrabold` (800) is used in the brand mark and the shell.
  - `h1`, `h2` and `h3` are set to 800 in `@layer base`.
  - Nothing uses 300 or 900, and nothing uses italic.
- **500 today:** 500 is not loaded, so the browser currently resolves `font-medium` to the nearest loaded face, which is 400 under CSS matching rules. This is a latent quirk. A variable font would change it to a true 500.
- **`docs/figma-make-prompts.md`** has no font mention, so no extra constraint comes from there.
- **`THIRD_PARTY_NOTICES.md`** only contains the MIT notice for agency-agents. An OFL entry is needed.

# Recommendations

1. **Use static weights 400/600/700/800, not a variable font.**
   - This reproduces the current rendering exactly, including 500 resolving to 400, so nothing visual changes, which matches the ticket's intent.
   - Four woff2 files with latin and vietnamese merged in each add up to about 100-140 KB.
   - Switching to variable (`weight: '400 800'`) would alter `font-medium` text. If Ming wants that, treat it as a separate decision.

2. **Merge the subsets into one file per weight.**
   - `next/font/local` has no per-file `unicode-range`. Two files at the same weight would collide, and the later one would win.
   - Fontsource's `vietnamese-*` files contain only the Vietnamese-specific glyphs, not basic latin, so they can't be used alone.
   - Source the weights from the `@fontsource/nunito` files `latin-{400,600,700,800}-normal.woff2` and `vietnamese-{...}-normal.woff2`. The Vietnamese files carry U+0102-0103, 0110-0111, 0128-0129, 0168-0169, 01A0-01A1, 01AF-01B0, 0300-0301, 0303-0304, 0308-0309, 0323, 0329, 1EA0-1EF9 and 20AB.
   - Merge each pair with fonttools (`pyftmerge`, or an unsubsetted TTF from the `google/fonts` repo run through `pyftsubset --unicodes=U+0000-00FF,U+0102-0103,... --flavor=woff2`).
   - Check `@fontsource/nunito`'s `package.json` for the exact filenames, because I haven't read the package from here.

3. **Location:** `apps/web/app/fonts/` (or `apps/web/fonts/`).
   - Files are `Nunito-400.woff2`, `Nunito-600.woff2`, `Nunito-700.woff2` and `Nunito-800.woff2`.
   - Next bundles them into `.next/static/media`, so no extra Docker copy is needed.
   - Check that `.dockerignore` and `.gitignore` don't exclude `*.woff2`.

4. **Keep the CSS variable and class identical.** Only the layout changes, and `globals.css` stays untouched:
   ```ts
   import localFont from 'next/font/local';
   const nunito = localFont({
     src: [
       { path: './fonts/Nunito-400.woff2', weight: '400', style: 'normal' },
       { path: './fonts/Nunito-600.woff2', weight: '600', style: 'normal' },
       { path: './fonts/Nunito-700.woff2', weight: '700', style: 'normal' },
       { path: './fonts/Nunito-800.woff2', weight: '800', style: 'normal' },
     ],
     variable: '--font-nunito',
     display: 'swap',
   });
   ```
   - Keep `className={nunito.variable}` on `<html>`.
   - Keep the family name "Nunito" as is.

5. **Fallback:** leave `adjustFontFallback` at its default (`'Arial'`). It generates a size-adjusted "Nunito Fallback" face, as `next/font/google` did, so layout shift stays the same. The CSS stack already ends in `ui-sans-serif, system-ui, sans-serif`. Don't add `preload: false`, because the latin subset is needed on first paint.

6. **Licence:**
   - Add `apps/web/app/fonts/OFL.txt` with the full SIL OFL 1.1 text and the line "Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)". Fontsource packages ship the licence file.
   - Add an OFL entry to `THIRD_PARTY_NOTICES.md` that points to that file.
   - OFL allows subsetting, merging and bundling. The reserved font name restriction only matters if the files are modified and redistributed under the same name, and a subset or merge is generally fine, but keep the notice.

7. **Verify:** run `pnpm build` with the network blocked, then confirm that the built CSS has no `fonts.gstatic.com` reference. Also check that Vietnamese diacritics such as "ệ", "ư", "đ" and "₫" render in Nunito and not in the fallback.

# Risks

- A variable font would silently change the 500 weight.
- A subset merge that misses codepoints would show fallback glyphs in some Vietnamese text. Compare the cmap against the old Google latin and vietnamese ranges.
- `.gitignore` or `.dockerignore` could drop the binary files.
- The woff2 files add about 100-140 KB to the repo.

# Open questions

- Do Ming and the ticket accept static weights with 500 still resolving to 400? I recommend yes, as the zero-visual-change option.
- Does the repo have a check, such as a lint or size rule, that rejects committed binaries?
