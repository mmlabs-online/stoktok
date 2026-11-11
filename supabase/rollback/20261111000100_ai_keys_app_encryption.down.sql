-- STK-082: deletes the stored (encrypted) AI keys on purpose and does NOT restore the Vault shape (ADR 0011); re-enter keys on Settings.
drop table if exists public.ai_keys;
