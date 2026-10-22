# security-review — STK-001

## Attempt 1

**Summary:** No blocking issues. No secrets, no `NEXT_PUBLIC_*` keys and no service-role usage anywhere in the STK-001 scaffold. Env handling meets the AC and R3. The only items are small hardening notes.

## Findings

🟢 **Secrets: none found.** Only key names in `.env.example` (all values empty) and sha512 integrity hashes in `pnpm-lock.yaml`. Code (`apps/web/app/page.tsx`, `apps/web/app/layout.tsx`, `apps/worker/src/index.ts`, `packages/core/src/index.ts`) only calls `describeCore()` and never reads `process.env`.

🟢 **R3 / NEXT_PUBLIC_: compliant.** `.env.example:3` says there are no `NEXT_PUBLIC_` keys; `SUPABASE_SERVICE_ROLE_KEY` (line 17) marked server-only; `SUPABASE_ANON_KEY` (line 15) has no public prefix; `apps/web/next.config.ts` has no `env:` block. Core has no env access — keep it that way.

🟢 **AC "`.env.local` is git-ignored": met.** `.gitignore:8-10` ignores `.env`, `.env.local`, `.env.*.local` in any directory. `.env.example` is not ignored.

🟢 **Build artifacts ignored.** `.gitignore` covers `.next/`, `dist/`, `node_modules/`, `*.tsbuildinfo`.

🟡 **`.gitignore:8-10`: `.env.production`, `.env.development` etc. are not ignored.** Suggest `.env*` + `!.env.example`. Follow-up (R7).

🟡 **`.env.example:8` `AUTHEN_JWT_SECRET`: provisional.** When the auth ticket settles spec §9 Q1, prefer JWKS / asymmetric verification over a shared HS256 secret.

## Recommendations (follow-ups)
1. First server module reading `SUPABASE_SERVICE_ROLE_KEY` goes in `apps/web` behind `import 'server-only'` with a startup env schema; never read env in `packages/core`.
2. CI ticket: add a secret scan (e.g. gitleaks) and fail the build if `SERVICE_ROLE` appears in `.next/static`.
3. R6: the auth ticket must add the JWT + allowlist check before any route or server action exists.

## Open questions
- Authen verification mechanism (spec §9 Q1) decides whether `AUTHEN_JWT_SECRET` stays or becomes a JWKS URL.
