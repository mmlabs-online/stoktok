
## Attempt 1 — 2026-11-10

### Files touched
| File | Required because |
|---|---|
| apps/web/app/layout.tsx | Replace next/font/google with next/font/local (4 static entries 400/600/700/800 normal, variable --font-nunito, display swap); comment updated (AC1, AC2) |
| apps/web/app/fonts/Nunito-400.woff2 | New: latin+vietnamese merged, weight 400 |
| apps/web/app/fonts/Nunito-600.woff2 | New: weight 600 |
| apps/web/app/fonts/Nunito-700.woff2 | New: weight 700 |
| apps/web/app/fonts/Nunito-800.woff2 | New: weight 800 |
| apps/web/app/fonts/OFL.txt | New: SIL OFL 1.1 copied verbatim from the @fontsource/nunito package LICENSE (it already begins with the Nunito copyright line) (AC3) |
| THIRD_PARTY_NOTICES.md | Appended "Nunito font" section (AC3) |

### Tests added / changed
- None (plan: no packages/core change; verification is the evidence below).

### Source and commands (all tooling in scratchpad /tmp/claude-0/-home-user-stoktok/47951d1f-9fbc-5953-bf55-b5f44f766a41/scratchpad, none in the repo)
- Source: `npm pack @fontsource/nunito` -> fontsource-nunito-5.3.0.tgz, sha256 4d8e1fb4f4a40c125c7a302b21e5c6810b86569b60bac0fa0405c04380f4c77b. Extracted into its own empty dir; files used: `nunito-{latin,vietnamese}-{400,600,700,800}-normal.woff2`.
- fonttools 4.68.0, brotli 1.2.1 in a scratch venv (`python3 -m venv`, `pip install fonttools brotli`).
- Merge path used: `pyftmerge` equivalent (fontTools.merge.Merger), the primary path; the instancer fallback was not needed. Run from `/`: `venv/bin/python -I merge.py <pkg>/files <out>`.
- Merge script (merge.py):
```python
import sys
from fontTools.merge import Merger
src, out = sys.argv[1], sys.argv[2]
for w in ('400','600','700','800'):
    f = Merger().merge([f'{src}/nunito-latin-{w}-normal.woff2', f'{src}/nunito-vietnamese-{w}-normal.woff2'])
    f.flavor = 'woff2'
    f.save(f'{out}/Nunito-{w}.woff2')
```
- Verify script (verify.py), run as `venv/bin/python -I verify.py <pkg>/files <out>`:
```python
import sys
from fontTools.ttLib import TTFont
src, out = sys.argv[1], sys.argv[2]
def rng(s):
    r=set()
    for p in s.split(','):
        p=p[2:]
        a,_,b=p.partition('-'); r.update(range(int(a,16), int(b or a,16)+1))
    return r
LAT=rng("U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")
VN=rng("U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB")
REQ=set(range(0x20,0x7F))|set(range(0xC0,0x100))|rng("U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+1EA0-1EF9,U+20AB")
for w in ('400','600','700','800'):
    a=set(TTFont(f'{src}/nunito-latin-{w}-normal.woff2').getBestCmap())
    b=set(TTFont(f'{src}/nunito-vietnamese-{w}-normal.woff2').getBestCmap())
    m=TTFont(f'{out}/Nunito-{w}.woff2'); mc=set(m.getBestCmap())
    assert mc >= a|b, ('missing from union', sorted((a|b)-mc)[:10])
    want=(LAT|VN)&(a|b)
    assert want <= mc
    gap=(LAT|VN)-(a|b)
    assert REQ <= mc, sorted(REQ-mc)[:10]
    assert m['OS/2'].usWeightClass==int(w), m['OS/2'].usWeightClass
    n=m['name']; fam=(n.getDebugName(16) or n.getDebugName(1))
    assert fam.startswith('Nunito'), fam
    print(f'{w}: latin={len(a)} vn={len(b)} merged={len(mc)} missing_from_union=0 missing_in_range=0 expected_gaps={len(gap)} {[hex(x) for x in sorted(gap)][:8]} weight={m["OS/2"].usWeightClass} family={fam!r} OK')
```
- Verify output:
```
400: latin=230 vn=116 merged=332 missing_from_union=0 missing_in_range=0 expected_gaps=163 ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7', '0x8'] weight=400 family='Nunito ExtraLight' OK
600: latin=230 vn=116 merged=332 missing_from_union=0 missing_in_range=0 expected_gaps=163 ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7', '0x8'] weight=600 family='Nunito ExtraLight' OK
700: latin=230 vn=116 merged=332 missing_from_union=0 missing_in_range=0 expected_gaps=163 ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7', '0x8'] weight=700 family='Nunito ExtraLight' OK
800: latin=230 vn=116 merged=332 missing_from_union=0 missing_in_range=0 expected_gaps=163 ['0x1', '0x2', '0x3', '0x4', '0x5', '0x6', '0x7', '0x8'] weight=800 family='Nunito ExtraLight' OK
```
  Notes: expected_gaps = codepoints in the Google ranges that the Fontsource sources do not contain (mainly unmapped control characters U+0001.. and similar), not failures. The name table (ID 1) in the Fontsource sources reads "Nunito ExtraLight" (leftover from instancing the variable font); usWeightClass is correct (400/600/700/800). The family check was relaxed to startswith('Nunito'); the app only uses var(--font-nunito), and next/font/local generates its own family name.
- SHA-256 of committed files:
```
cacb95b9ef4d91acc2e537654dffbc8953c0cb31d69dfb74bb94e0a759390678  Nunito-400.woff2
9dc8072398d78946c28b936e62014bac5cc672b73f3699693b07fc0aafc7058a  Nunito-600.woff2
2cf682c36be17a5c29fd8950b8e06fd76cfc2b064c4073ec61b46742f66d1cc2  Nunito-700.woff2
77e90cb9276c76bedf9fb8fe47bae0c8a7e773be5f5e2a21ca9b4ef2e0deceb6  Nunito-800.woff2
40991bfa02ac620aae16dc527f3c47765a25e43f270d4c301ee6ab663a8d9015  OFL.txt
```
- Output sizes: 19716 / 19948 / 19496 / 19896 bytes (about 79 KB total).

### Network-isolated build (AC4)
- Isolation: `unshare -rn` (works as root; Docker unavailable). A first attempt with loopback down failed the positive build with a Turbopack "evaluate_webpack_loader ... creating new process" error, because Turbopack's postcss loader needs a loopback socket to its Node child. So loopback is brought up inside the namespace with `/tmp/claude-0/-home-user-stoktok/47951d1f-9fbc-5953-bf55-b5f44f766a41/scratchpad/isolated.sh` (python ioctl SIOCSIFFLAGS on lo; no `ip` binary). No external route exists; `curl https://fonts.googleapis.com` inside it exits 7.
- Command: `unshare -rn $S/isolated.sh env NEXT_TELEMETRY_DISABLED=1 pnpm --filter @stoktok/web build`
- (a) Negative control, main layout (git stash -u, then pop): exit 1:
```
[next]/internal/font/google/nunito_388afa2a.module.css
Error: next/font: error:
Failed to fetch Nunito from Google Fonts.
...
Import trace: ... ./apps/web/app/layout.tsx
Exit status 1
```
- (b) Positive run, the change: exit 0, "Generating static pages (5/5)", full route table printed. (The "auth: config invalid" line is the existing env-less build notice.)
- (c) Static evidence after the positive run:
```
grep -rEl "fonts\.(googleapis|gstatic)\.com" apps/web/.next   -> no output (exit 1)
grep -rho "url([^)]*\.woff2)" apps/web/.next/static --include=*.css:
  url(../media/Nunito_400-s.p.3cexyvgu_-0p7.woff2)
  url(../media/Nunito_600-s.p.0zp4e8l6sm6b8.woff2)
  url(../media/Nunito_700-s.p.37m4lnv1h3cp7.woff2)
  url(../media/Nunito_800-s.p.13pou93k3l7j4.woff2)
ls apps/web/.next/static/media/*.woff2 -> 4 files (19716/19948/19496/19896 bytes, same sizes as the committed files)
grep -rn "next/font/google" apps/web (excl node_modules, .next) -> no hits
```
  Note: the CSS URLs are relative (`../media/...`, which resolves to /_next/static/media/...), not absolute `/_next/static/media/`; they are local either way.

### Checks (actual output summary)
- typecheck: exit 0
- lint: exit 0
- test: exit 0
- check:service-key: exit 0 ("OK: no secret or AI SDK material in client bundle")
- Visual spot check (step 7): skipped, no browser; relied on the cmap check.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- font-medium (500) still renders as 400 (static weights), as before. A variable font would be a visual change.
- The Fontsource name tables say "Nunito ExtraLight" for every weight; harmless for next/font/local.
- Not committed (per instructions); the orchestrator commits.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: +18 / -5 lines of text (layout.tsx, notices) plus 5 new asset files.
