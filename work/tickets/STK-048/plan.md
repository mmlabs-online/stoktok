Status: READY

# Plan — STK-048: Authen = Supabase Auth of stoktok's own project (docs and comments)

## Spec summary
- Ticket note (Ming, 2026-11-05): "giống concept authen của calechip tức là dùng supabase authen" — use Supabase Auth **of stoktok's own Supabase project**, like CaleChip does for itself. STK-004's code is provider-agnostic, so this is a wording and setup-docs change only.
- `docs/spec-v1.md` §1.2: "Login via Authen (shared mmlabs SSO), restricted by an allowlist." §4.2: "Login through Authen; `web` validates the shared JWT." / "Allowlist check (Ming's user ID) on every request" / "App data lives in a **separate Supabase project**; it never stores data in the shared auth project." §9 Q1: "JWT trust between Authen and the app's separate Supabase project".
- `CLAUDE.md` Stack row "Auth": "Authen = CaleChip Supabase project (separate). …" and R6 note: "Authen is the CaleChip Supabase project." — both to be reworded.
- **Spec conflict (flagged, not fixed here):** Ming's decision puts Auth users in the same project as app data, which contradicts §4.2 bullet 3 and the "shared mmlabs SSO" / "shared JWT" wording in §1.2, §4, §4.2, §9 Q1. The ticket does not list the spec as a file to change, and the spec is Ming's to edit, so this goes to follow-ups (see Assumptions). Ming's explicit 2026-11-05 decision takes precedence for the docs this ticket touches.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Every "Authen = CaleChip" mention (CLAUDE.md stack row and R6 note, `.env.example` comments, comments in `apps/web/server/auth/config.ts` and `authen-client.ts`, `docs/deploy.md`) says Authen is Supabase Auth of stoktok's own Supabase project. | `grep -rni calechip --exclude-dir=work --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git /home/user/stoktok` returns **only** `.github/workflows/ci.yml:16` (Docker Hub account comment) and `deploy/deployment-repo/.github/workflows/runner-check.yml:3` (calechip CICD-07 reference). Both are unrelated to auth and stay. Each edited line reads as in **Exact wording** below. |
| 2 | `docs/deploy.md` says what to put in the three secrets: URL = stoktok project URL (same as `STOKTOK_SUPABASE_URL`), anon key = stoktok project's anon/publishable key, allowlist = Ming's user UUID in the stoktok project's Auth. | Read `docs/deploy.md` "Deployment repo: environment `stoktok`" step 3, second paragraph: it matches **Exact wording (deploy.md line 34)**. |
| 3 | `docs/deploy.md` adds the one-time setup (create Ming's user in the stoktok project's Supabase Auth via dashboard, disable public sign-ups, copy the UUID); the verify step signs in with that account. | "Restore auth (STK-004) - order" has a new step 1 with those three actions, before the step that sets the secrets. "Cut a release" step 12 says "signing in with Ming's stoktok account (Restore auth, step 1)". |
| 4 | No logic change: diff touches only comments, docs and work files; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `scripts/check-deploy-env.sh` pass. | `git diff --stat main...HEAD` lists only the 5 files below plus `work/**`. `git diff main...HEAD -- apps/` shows changes only inside `/** … */` comment lines (line 12 of `config.ts`, line 20 of `authen-client.ts`). `git diff main...HEAD -- .env.example` changes only comment text: the key lines still start with `AUTHEN_SUPABASE_URL=`, `AUTHEN_SUPABASE_ANON_KEY=`, `ALLOWLIST_USER_IDS=` with empty values. `pnpm typecheck && pnpm lint && pnpm test` green; `bash scripts/check-deploy-env.sh` prints `OK`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `CLAUDE.md` | Line 20 (Stack "Auth" row) and line 48 (R6 note) wording | AC1 (listed in ticket) |
| `.env.example` | Comments on lines 5–8 only; key names and empty values unchanged | AC1 |
| `apps/web/server/auth/config.ts` | JSDoc on line 12 only | AC1 |
| `apps/web/server/auth/authen-client.ts` | JSDoc on line 20 only | AC1 |
| `docs/deploy.md` | Line 34 (secret values), "Restore auth" section (new setup step, renumber), line 83 (verify step) | AC1, AC2, AC3 |

No other file. No tests to write (no logic change).

## Exact wording
Implementer uses this text (minor punctuation tweaks allowed; meaning must not change).

No new "CaleChip" mention anywhere, so the AC1 grep stays exact.

**CLAUDE.md line 20** →
`| Auth | Authen = Supabase Auth of stoktok's own Supabase project (Ming, 2026-11-05, STK-048). stoktok's own `/login` signs in server-side; the server verifies via `getClaims()` + allowlist |`

**CLAUDE.md line 48**: replace the sentence `Authen is the CaleChip Supabase project.` with `Authen is Supabase Auth of stoktok's own Supabase project (STK-048).` Rest of the note unchanged.

**.env.example lines 5–8** →
```
# Authen = Supabase Auth of the stoktok Supabase project (identity only; server-only, R3). STK-004, STK-048.
AUTHEN_SUPABASE_URL=          # https://<stoktok-ref>.supabase.co, same value as SUPABASE_URL (no path, no trailing slash)
AUTHEN_SUPABASE_ANON_KEY=     # stoktok project anon (legacy JWT) or sb_publishable_ key; read by web server code only
# Allowlist: comma-separated auth.users.id UUIDs (JWT sub) from the stoktok project's Auth. Empty = nobody can log in.
```
(Keep the column alignment of the inline `#` comments as today.)

**apps/web/server/auth/config.ts line 12** →
`/** Reads the Authen settings (Supabase Auth of the stoktok project). Throws on anything missing or malformed (fail closed). */`

**apps/web/server/auth/authen-client.ts line 20** →
`/** The only module that talks to Supabase Auth (Authen, stoktok's own project) with the anon key; separate from getDb(). */`

**docs/deploy.md line 34** →
`   Auth (STK-004, STK-048) adds three more. Authen is Supabase Auth of the stoktok project itself: `STOKTOK_AUTHEN_SUPABASE_URL` = the stoktok project URL (same value as `STOKTOK_SUPABASE_URL`, `https://<ref>.supabase.co`, no path), `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` = the stoktok project's anon or `sb_publishable_` key (never the service role key), `STOKTOK_ALLOWLIST_USER_IDS` = Ming's user UUID from the stoktok project's Authentication, Users (comma-separated if more than one). They are written as `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY` and `ALLOWLIST_USER_IDS`.`

**docs/deploy.md "Restore auth (STK-004) - order"** → insert a new step 1, renumber the existing steps 1–3 to 2–4, and update the follow-up sentence ("If step 2 runs before step 1" → "If step 3 runs before step 2"):
```
1. One-time, in the stoktok project's Supabase dashboard (Authentication):
   - Sign In / Providers: keep Email enabled and turn **off** "Allow new users to sign up" (public sign-ups disabled; the allowlist still rejects anyone else, this keeps the user list to Ming).
   - Users, Add user, Create new user: Ming's email and a strong password, auto-confirm on.
   - Copy that user's UUID (User UID) for `STOKTOK_ALLOWLIST_USER_IDS`.
```
Existing step 1 (now 2) stays: "Ming sets `STOKTOK_AUTHEN_SUPABASE_URL`, … in the deployment repo environment `stoktok`." — append " (values: see the environment section above)".

**docs/deploy.md line 83 (Cut a release, step 12)**: replace `signing in with Ming's CaleChip account` with `signing in with Ming's stoktok account (Restore auth, step 1)`. Rest unchanged.

## Tests to write
None — comments and docs only; existing suites must stay green (R8).

## Approach
1. Apply the edits above, file by file. Touch only the named lines in `apps/` (JSDoc text). Do not change any `KEY=` line in `.env.example` beyond its trailing comment (`check-deploy-env.sh` parses `^[A-Z][A-Z0-9_]*=`). Do not add any `/Users/<name>` path to `docs/deploy.md` (the script requires exactly one).
2. Run `pnpm typecheck && pnpm lint && pnpm test` and `bash scripts/check-deploy-env.sh`.
3. Run the AC1 grep; only the two excluded lines may remain.
- Rules: R3 is upheld in wording: the anon/publishable key stays server-only, and deploy.md says never to use the service role key there. R6 is unchanged in behaviour. R7: the stale and spec items below go to follow-ups, not into this diff.
- Security reviewer note: Auth users now live in the same project as app data. That is safe with the current schema because STK-003 revoked all anon/authenticated grants and RLS has no policies (`supabase/migrations/20261023000200_v1_rls_grants.sql`), so a signed-in user's JWT plus the anon key cannot read app tables through PostgREST. Disabling public sign-ups (step 1) is defence in depth.

## Specialist input used
None (areas: security only; the security auditor runs at REVIEW).

## Assumptions
- `CLAUDE.md` is in scope because the ticket (Ming's) names its stack row and R6 note explicitly.
- Ming's user does not exist in the stoktok project's Auth yet; the setup step creates it. If it already exists, the step reduces to copying the UUID.
- Exact Supabase dashboard labels ("Allow new users to sign up", "Add user", "User UID") may drift; the wording describes intent and is good enough for a runbook.
- Follow-ups (do **not** do here):
  1. `docs/spec-v1.md` §1.2, §4 diagram, §4.1, §4.2 (bullet 3 "never stores data in the shared auth project"), §9 Q1: reword for Authen = stoktok's own Supabase Auth (Ming edits the spec).
  2. `docs/deploy.md` line 15 "No auth code is in the app (R6 suspended). Access is the only gate until STK-004." is stale since STK-004 merged.
  3. Already listed in the ticket: reuse `SUPABASE_URL` instead of a separate `AUTHEN_SUPABASE_URL` (code/env change).

## Blocking questions
None

## Split proposal
None
