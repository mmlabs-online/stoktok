# STK-082 security review

## Security review: STK-082, attempt 1

**Verdict: no blocking findings (no 🔴).** I found nothing exploitable in the crypto, the master-key handling, the fail-closed logic or the migration. Two 🟡 items are about the STK-084 runbook and how it is written down. They do not block this diff. I read the code and did not run anything. The green checks are as reported in impl-log.md.

### Findings

**🟢 Crypto, `packages/db/src/keyring.ts`**
- **IV:** each seal gets a fresh `randomBytes(12)` (:69). Test `keyring.test.ts:66` proves two seals differ.
- **Tag:** `authTagLength: 16` is set on both cipher and decipher (:70, :82). Before decrypting, `open` rejects any iv that is not 12 bytes and any tag that is not 16 bytes (:80). `setAuthTag` plus `final()` verify the tag. Flipped-byte and truncated cases are tested (`keyring.test.ts:83-96`).
- **AAD:** `stoktok:ai_keys:v1|${provider}|${keyVersion}` (:33), the same on seal and open. The format is pinned by a raw `node:crypto` test (:98). `open` rejects `keyVersion !== 1` before decrypting (:79). The test-db provider-swap test (`test-db/ai-keys.test.ts:130`) also copies `last4`, so it really tests the AAD and not only the last4 check.
- **Master-key parsing:** strict at :40-46. It requires the regex `^[A-Za-z0-9+/]{43}=$`, a 32-byte decode, a re-encode equal to the input, and not all zeros. This blocks the leniency of `Buffer.from(…,'base64')`. Tests cover base64url, whitespace, a trailing newline, missing padding, a non-canonical last character, and 24- or 48-byte keys.
- **No key bytes exposed:** the key lives only in a closure. The object is `Object.freeze`d, with `state`, `seal` and `open` as its only own keys, and has no `toJSON` or custom inspect. Every failure goes through `fail()`, which has fixed text and no cause (:36, :74-76, :86-88). Tests for inspect with `showHidden`, `JSON.stringify` and leaks through `cause` are at `keyring.test.ts:118-139`.

**🟢 Master key, `packages/db/src/pg/client.ts:11, :92-93`**
- The env name appears only in `client.ts`, and r3-guard enforces this (`r3-guard.test.ts:182`).
- An invalid key logs only `{event:'ai_keyring_invalid'}`, with no value, and nothing is thrown (`client.test.ts:100`).
- The keyring is reachable only through the non-enumerable `INTERNALS` symbol. The existing `ACCESSOR` guard (`r3-guard.test.ts:245`) still covers `stoktok.pgdb.internals` and `getOwnPropertySymbols`.
- `check-no-service-key-in-client.sh:18-20` builds with a random sentinel master key and greps `.next/static` for both the value and the env name.

**🟢 Fail-closed matrix, `packages/db/src/repos/ai-keys.ts:73-100`**
- No rows → `{}`.
- Rows with an absent or invalid key → `NOT_CONFIGURED`.
- If any row fails (provider, Buffer type, open, format, last4 mismatch), the whole read throws `MAPPING` with no cause. A partial map is never returned.
- Decryption runs outside `q()`, so crypto errors stay `MAPPING` and never become `DB_ERROR`.
- `makeProviderResolver` (`packages/ai/src/keys.ts:44`) awaits the read with no catch. A rejection therefore becomes `provider_unavailable`, with no env fallback (tests at `packages/ai/src/client.test.ts:508`).
- `deleteAiKey` and `listAiKeyMeta` need no keyring (:53-66, tested).
- `saveAiKey` checks the keyring state before any query (:33), and test-db shows that nothing is written.

**🟢 No plaintext in SQL text, the DB or logs**
- The upsert binds Buffers as parameters (:37-44).
- `DataError` messages carry only table, op and pg code, and `toDataError` never attaches a cause (`errors.ts:61-74`).
- Kysely has no `log` option, and r3-guard enforces that.
- test-db checks the stored row with `position(convert_to(key) in ciphertext)` and checks `ai_keys::text`.
- Postgres statement or error logs could show at most the ciphertext, iv, tag and `last4` (`last4` is plaintext by design, ADR 0009).

**🟢 Migration, `supabase/migrations/20261111000100_ai_keys_app_encryption.sql`**
- **Vault guard:** :12-18. It uses `is distinct from`, so a NULL comment on Supabase's real `vault` schema also raises. The test is at `test-db/ai-keys.test.ts:223`. No workflow runs `supabase db push`.
- **Wrappers dropped:** all three, with exact signatures (:20-22).
- **Table recreated:** `enable row level security`, `revoke all … from public, anon, authenticated, service_role`, then `grant` of the four verbs to `service_role` (:37-39).
- **Definer allowlist:** `checks.sql:777-780` is in the NULL-safe "no definer function exists" form. `ai_key_functions_gone` is at :770.
- **Privilege checks:** `checks.sql:709-722` cover the four verbs plus `relrowsecurity`. The global `no_grants_anon_authenticated_public` check covers the other privileges.

**🟢 r3-guard and bundle check, `packages/db/src/r3-guard.test.ts:124-232`**
- Every new rule has fixtures: env name, cipher calls, `keyringOf`, keyring imports and barrels, dropped wrappers (word boundary, so `ai_key_delete_failed` is not flagged), `vault.*`, and `.env.example`. The guard is substring-based and would not catch an obfuscated env name, which is acceptable.

**🟡 1. The STK-084 runbook items are not in the STK-084 ticket**
- `work/tickets/STK-084/ticket.md:15,39` mentions only "(plus the AI master key)" and "re-enter AI keys". Plan F1 is missing from it: Vault row cleanup, provider key rotation, a format check in `check-deploy-env.sh`, and switching `docs/deploy.md` from `reserved` to `required`.
- STK-083's ticket also does not mention dropping the Vault guard, RLS and grants from the baseline (plan F2).
- Fix: the orchestrator appends F1 and F2 to those two ticket.md files. That way they are tracked by the tickets, not only in this plan.

**🟡 2. The cleanup wording is "Vault cleanup *or* rotate at the providers". Make it *and*, and set the order**
- In ADR 0011 :52 and plan F1, deleting the `vault.secrets` rows on Supabase does not remove the keys from Supabase's backups or PITR.
- Under the secrets-are-burned rule: at cutover, issue **new** keys at Anthropic and Google and enter those on Settings, not the old values. Then revoke the old keys.
- Delete the `stoktok_ai_key_%` Vault rows **after** STK-084's rollback window closes (proposed 14 days). If they are deleted earlier, rolling back to the Supabase release would silently drop to env keys or no keys.
- Fix: one runbook line in ADR 0011 and in STK-084.

**🟡 3. The master-key rotation runbook leaves gaps, ADR 0011 :39-47**
- Step 1, "or accept that they are discarded", is wrong. Rows are not discarded automatically. Rows sealed under the old key make reads fail with `MAPPING`, and both providers stay disabled until the rows are deleted on Settings. Say so.
- If rotation is caused by a suspected **compromise** of the master key, the provider keys must be rotated at the providers too.
- Backups made in the last 7d/4w/6m hold ciphertext sealed under the old master key. While the old key's copy in the password manager still exists, those backups can be decrypted. Add: rotate the provider keys, or destroy the old master-key copy once its backups have aged out.

**🟢 Info / low (no action needed in this diff)**
- The ciphertext length equals the API key length, because GCM does not pad. With `last4` in plaintext, this is a small, accepted metadata leak.
- Someone with DB write access but no master key can replay an older row for the *same* provider and key version, for example from a backup. This rolls the app back to an older provider key. The AAD does not bind freshness. Impact is low, because a revoked old key just fails at the provider. Rotating at the providers (🟡2) closes it.
- For STK-084: the host env file that holds the master key should be mode 0600, and the master key must not go into the deployment repo next to `postgres/secrets/` (ADR 0011 already says this).

### Recommendations
- Accept attempt 1 from a security standpoint. Matches AC 3, 5, 6, 8, 9 and 10, and rule R3.
- Before STK-084 runs, apply 🟡1–3 as doc and ticket edits. Fixing them in this diff would only touch ADR 0011, which is in plan scope. The ticket.md edits are orchestrator-owned.

### Risks
- One corrupt row turns off both providers. This is by design and documented (follow-up F5).
- STK-083 must reproduce `ai_keys` without the Vault guard. If the guard is copied into the baseline, it still passes on stock postgres:17, because there is no `vault` schema there.

### Open questions
- Will Ming issue new provider keys at cutover, or re-enter the existing ones? I recommend new keys.
- When should the Supabase Vault rows be deleted: at cutover, or when the rollback window closes?

Files: /home/user/stoktok/packages/db/src/keyring.ts, /home/user/stoktok/packages/db/src/repos/ai-keys.ts, /home/user/stoktok/packages/db/src/pg/client.ts, /home/user/stoktok/packages/db/src/pg/access.ts, /home/user/stoktok/supabase/migrations/20261111000100_ai_keys_app_encryption.sql, /home/user/stoktok/scripts/db-check/checks.sql, /home/user/stoktok/packages/db/src/r3-guard.test.ts, /home/user/stoktok/scripts/check-no-service-key-in-client.sh, /home/user/stoktok/docs/adr/0011-ai-provider-keys-app-side-encryption.md, /home/user/stoktok/work/tickets/STK-084/ticket.md, /home/user/stoktok/work/tickets/STK-083/ticket.md
