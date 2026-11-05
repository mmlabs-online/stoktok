# Security review: STK-048, attempt 1

**Verdict: nothing blocks.** Putting Auth users in the same project as the app data is safe with the current schema. No secret values leak, and the docs say outright never to use the service role key as the Authen key. Two 🟡 items are worth fixing in this diff: the key-rotation runbook is now wrong, and the setup step leaves some Auth settings implicit. Everything else is a 🟢 or a follow-up.

This was a read-only static review. I ran no commands, and the directory is not a git repo, so I reviewed the current file contents against plan.md rather than an actual `HEAD~1..HEAD` diff.

## Findings

✅ **Same-project Auth versus RLS and grants: safe.**
- All 10 public tables get RLS enabled, every grant revoked from `anon` and `authenticated`, and select/insert/update/delete granted to `service_role` only:
  - `/home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql:6-12` covers 7 tables.
  - `20261025000100_symbols.sql:13-15`, `20261026000100_financials.sql:22-24` and `20261026000200_signals.sql:39-43` (including the sequence) cover the other 3.
- There is no `create policy`, function, view, RPC, storage bucket or `security definer` anywhere in `supabase/`.
- So when Ming signs in, PostgREST and pg_graphql see her token as the `authenticated` role, which gets a permission error (42501) on every app table. The anon key gets the same.
- Default privileges are revoked at lines 17-19, and the db-check suite (`no_grants_anon_authenticated_public`, `no_policies`) guards future tables.
- The app checks identity with the `sub` claim, `role`/`aud` = `authenticated`, the issuer and the allowlist (`apps/web/server/auth/claims.ts:11-18`). It never uses `user_metadata`.

✅ **Service role key never suggested as the Authen key.**
- `docs/deploy.md:34` says "anon or `sb_publishable_` key (never the service role key)".
- `.env.example:7` says anon or `sb_publishable_`, server-only.
- No `NEXT_PUBLIC_` keys anywhere.

✅ **No leaked secrets.** No JWTs, `sb_secret_`/`sb_publishable_` values or real project refs appear in the docs, `.env.example` or code. Only placeholders (`<stoktok-ref>`, `<ref>`) and empty values. `deploy.md:33,72` mention the key pasted into chat on 2026-11-01 without its value.

🟡 **M1. The key-rotation runbook is now wrong and will lock Ming out.** `docs/deploy.md:67` says rotating the legacy JWT secret invalidates "the anon key and sessions … (stoktok uses neither yet)". After STK-048, stoktok uses both: `AUTHEN_SUPABASE_ANON_KEY` is this project's anon key, and Ming's session is this project's JWT.
- If the legacy secret is rotated (for example to retire the leaked 2026-11-01 key, `:72`), login breaks until `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` is also updated. Steps 2-3 (`:68-69`) only update the service role key.
- Fix: change the parenthetical to "web's Authen anon key and Ming's session are invalidated too". Add to step 2: "if the legacy JWT secret was rotated, also update `STOKTOK_AUTHEN_SUPABASE_ANON_KEY`". Add a final check: sign in again.
- This sentence is made false by this ticket's own decision, so I'd fix it here (AC1 spirit, R7 judgment for the reviewer).

🟡 **M2. The one-time setup step (`docs/deploy.md:56-59`) is incomplete.** It covers turning sign-ups off, keeping Email on, creating the user with auto-confirm, and copying the UUID. It should also say explicitly:
- **Anonymous sign-ins: off.** It is off by default, but state it. The allowlist would reject an anonymous user anyway, but each one is still a real `authenticated` JWT on the data project.
- **Every other provider off** (phone, OAuth, SSO).
- **"Confirm email" stays on**, as defence in depth if sign-ups are ever turned back on.
- **Minimum password length**, plus leaked-password protection if the plan allows it.
- **Site URL / redirect URLs** set to `https://<APP_HOSTNAME>`. Otherwise a password-reset email for Ming's address links to the default localhost.

The mitigation for all of these is the same: the allowlist plus the revoked grants mean none of them grants data access. That's why this is 🟡 and not 🔴. What changed is the impact if a setting is wrong: a stray user is now a valid JWT on the project that holds the data. Before STK-048, such a user lived on CaleChip.

🟢 **L1. Pasting the service key into the Authen slot would now go unnoticed.**
- Because both keys belong to one project, a service role key in `AUTHEN_SUPABASE_ANON_KEY` would work: sign-in still succeeds, and the Auth client silently runs with full privilege. Before STK-048, the same mistake would have failed loudly against CaleChip.
- The docs warn against it, but nothing enforces it. `loadAuthConfig` (`apps/web/server/auth/config.ts:18-19`) checks only that the key is non-empty. `deploy-stoktok.yml:189` checks only the characters.
- Follow-up (a code change, out of scope here): reject `sb_secret_` prefixes, a JWT with `role=service_role`, or a value equal to `SUPABASE_SERVICE_ROLE_KEY`.

🟢 **L2. Realtime public channels.** Any valid project JWT or anon key can join public Broadcast/Presence channels. The app uses no Realtime, so no data leaks. Optionally enable "private channels only" in the Realtime settings.

🟢 **L3. The anon key now sits in two variables.** `SUPABASE_ANON_KEY` (`.env.example:13`, still "reserved" at `deploy.md:110`) and `AUTHEN_SUPABASE_ANON_KEY` now hold the same project's key. Already a follow-up in the ticket; fold it into the "reuse `SUPABASE_URL`" item.

ℹ️ **Stale doc line.** `docs/deploy.md:15` ("No auth code is in the app (R6 suspended)…") is wrong since STK-004. The plan already lists it as follow-up 2.

ℹ️ **Spec conflict.** `docs/spec-v1.md` §4.2 says app data is "never" stored in the auth project, and §9 Q1 / §4.2:134 frame the JWT trust as cross-project. The plan already flags this for Ming (follow-up 1). Security-wise, the "service role plus app-level checks" model from STK-003/004 makes the separate project unnecessary.

## Recommendations
1. Fix M1 in `docs/deploy.md:67-69`. This is AC1 territory: the "uses neither" sentence is about CaleChip being Authen.
2. Extend `docs/deploy.md:56-59` with the M2 settings (AC3, "one-time setup").
3. Log L1 as a follow-up guard on the key format (R3).
4. Keep the db-check grant checks as the regression gate for every new table. They are now the main control that keeps Auth users and app data apart in one project.

## Risks
- If a future migration adds a table, view or `security definer` function without the revokes, signed-in JWTs could reach it. The defaults plus db-check mitigate this.
- Rotating keys without M1 locks Ming out (fails closed, no exposure).

## Open questions
- Is the key leaked on 2026-11-01 a legacy JWT `service_role` key or an `sb_secret_` key? If legacy, the pending rotation will hit M1 immediately.
- Does the dashboard confirm that only `public` (and `graphql_public`) are exposed through the Data API?
