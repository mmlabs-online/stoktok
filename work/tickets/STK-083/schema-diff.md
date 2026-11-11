# STK-083 schema-diff record (faithfulness proof)

Command: `SCHEMA_DIFF_OUT=<dir> bash scripts/schema-diff.sh` (exit 0). Date: 2026-11-11.
Versions: server and pg_dump are both PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1). Only the PG16 binaries are installed in this session; both sides use the same binary on the same server, so the comparison holds. CI runs `test:db` on `postgres:17`.
Dump: `pg_dump --schema-only --schema=public --no-owner --no-privileges --no-tablespaces`, normalised by deleting `\restrict` lines, `ENABLE ROW LEVEL SECURITY` lines, the `ROW SECURITY` section headers and `Dumped from/by` lines.

Sides:
- A' = reference bootstrap (`scripts/db-check/bootstrap-roles.sql`) + all 15 `supabase/migrations` files.
- A = same, without `20261111000100` (what the Supabase project runs).
- B = `db/migrations/20261111000200_baseline.sql` applied as a non-superuser owner, rolled back with the down file, then re-applied.

## Script output
```
owner role flags (super|createdb|createrole|replication|bypassrls): f|f|f|f|f
after rollback (pg_class|pg_proc|pg_type in public): 0|0|0
A' vs B: identical
```

## A' vs B
Identical (empty diff). The squash is faithful to the full legacy chain, including column order, constraint names, comments, indexes and function bodies.

## A (Supabase) vs B (baseline), raw diff
Expected: only the `ai_keys` difference.
```diff
--- A.sql
+++ B.sql
@@ -30,95 +30,6 @@
 
 
 --
--- Name: ai_key_delete(text); Type: FUNCTION; Schema: public; Owner: -
---
-
-CREATE FUNCTION public.ai_key_delete(p_provider text) RETURNS boolean
-    LANGUAGE plpgsql SECURITY DEFINER
-    SET search_path TO ''
-    AS $$
-declare
-  v_name text;
-  v_id uuid;
-  v_existed boolean;
-begin
-  if p_provider is null or p_provider not in ('anthropic', 'google') then
-    raise exception 'invalid ai key arguments' using errcode = '22023';
-  end if;
-
-  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_key.' || p_provider));
-  v_name := 'stoktok_ai_key_' || p_provider;
-
-  select k.secret_id into v_id from public.ai_keys k where k.provider = p_provider;
-  v_existed := found;
-
-  delete from vault.secrets s where s.id = v_id or s.name = v_name;
-  delete from public.ai_keys k where k.provider = p_provider;
-  return v_existed;
-end $$;
-
-
---
--- Name: ai_key_secrets(); Type: FUNCTION; Schema: public; Owner: -
---
-
-CREATE FUNCTION public.ai_key_secrets() RETURNS TABLE(provider text, secret text)
-    LANGUAGE plpgsql STABLE SECURITY DEFINER
-    SET search_path TO ''
-    AS $$
-begin
-  return query
-    select k.provider, d.decrypted_secret
-    from public.ai_keys k
-    join vault.decrypted_secrets d on d.id = k.secret_id;
-end $$;
-
-
---
--- Name: ai_key_set(text, text); Type: FUNCTION; Schema: public; Owner: -
---
-
-CREATE FUNCTION public.ai_key_set(p_provider text, p_key text) RETURNS TABLE(key_last4 text, saved_at timestamp with time zone)
-    LANGUAGE plpgsql SECURITY DEFINER
-    SET search_path TO ''
-    AS $_$
-declare
-  v_name text;
-  v_id uuid;
-  v_last4 text;
-  v_now timestamptz := pg_catalog.now();
-begin
-  if p_provider is null or p_provider not in ('anthropic', 'google')
-     or p_key is null or pg_catalog.char_length(p_key) not between 20 and 256 or p_key !~ '^[\x21-\x7e]+$' then
-    raise exception 'invalid ai key arguments' using errcode = '22023';
-  end if;
-
-  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_key.' || p_provider));
-  v_name := 'stoktok_ai_key_' || p_provider;
-  v_last4 := pg_catalog.right(p_key, 4);
-
-  select k.secret_id into v_id
-    from public.ai_keys k
-    where k.provider = p_provider
-      and exists (select 1 from vault.secrets s where s.id = k.secret_id);
-
-  if v_id is not null then
-    perform vault.update_secret(v_id, p_key);
-  else
-    delete from vault.secrets s where s.name = v_name;
-    v_id := vault.create_secret(p_key, v_name, 'stoktok AI provider key');
-  end if;
-
-  insert into public.ai_keys (provider, secret_id, last4, updated_at)
-    values (p_provider, v_id, v_last4, v_now)
-    on conflict (provider) do update
-      set secret_id = excluded.secret_id, last4 = excluded.last4, updated_at = excluded.updated_at;
-
-  return query select v_last4, v_now;
-end $_$;
-
-
---
 -- Name: ai_month_spend(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
 --
 
@@ -182,9 +93,16 @@
 
 CREATE TABLE public.ai_keys (
     provider text NOT NULL,
-    secret_id uuid NOT NULL,
+    ciphertext bytea NOT NULL,
+    iv bytea NOT NULL,
+    auth_tag bytea NOT NULL,
+    key_version smallint NOT NULL,
     last4 text NOT NULL,
     updated_at timestamp with time zone DEFAULT now() NOT NULL,
+    CONSTRAINT ai_keys_auth_tag_check CHECK ((octet_length(auth_tag) = 16)),
+    CONSTRAINT ai_keys_ciphertext_check CHECK (((octet_length(ciphertext) >= 20) AND (octet_length(ciphertext) <= 256))),
+    CONSTRAINT ai_keys_iv_check CHECK ((octet_length(iv) = 12)),
+    CONSTRAINT ai_keys_key_version_check CHECK ((key_version >= 1)),
     CONSTRAINT ai_keys_last4_check CHECK ((last4 ~ '^[\x21-\x7e]{4}$'::text)),
     CONSTRAINT ai_keys_provider_check CHECK ((provider = ANY (ARRAY['anthropic'::text, 'google'::text])))
 );
@@ -194,7 +112,7 @@
 -- Name: TABLE ai_keys; Type: COMMENT; Schema: public; Owner: -
 --
 
-COMMENT ON TABLE public.ai_keys IS 'Metadata of AI provider keys stored in Vault (secret named stoktok_ai_key_<provider>); never holds a key. Written only by ai_key_set / ai_key_delete';
+COMMENT ON TABLE public.ai_keys IS 'AI provider keys, AES-256-GCM encrypted by the app (ADR 0011); AAD binds provider and key_version. Never holds a plaintext key';
 
 
 --
@@ -1044,14 +962,6 @@
 
 
 --
--- Name: ai_keys ai_keys_secret_id_key; Type: CONSTRAINT; Schema: public; Owner: -
---
-
-ALTER TABLE ONLY public.ai_keys
-    ADD CONSTRAINT ai_keys_secret_id_key UNIQUE (secret_id);
-
-
---
 -- Name: ai_summaries ai_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
 --
 
```

Hunk by hunk:
1. `@@ -30,95 +30,6 @@`: removes `ai_key_delete`, `ai_key_secrets`, `ai_key_set`. Intentional: ai_key_* definer functions removed (ADR 0011).
2. `@@ -182,9 +93,16 @@`: `ai_keys` column set `secret_id` becomes `ciphertext`, `iv`, `auth_tag`, `key_version`, with their four check constraints. Intentional: ai_keys Vault shape becomes app-side ciphertext (ADR 0011, F2).
3. `@@ -194,7 +112,7 @@`: `ai_keys` table comment. Intentional (same reason).
4. `@@ -1044,14 +962,6 @@`: drops `ai_keys_secret_id_key` unique constraint. Intentional (same reason; `secret_id` is gone).

No other hunk. Row-level-security headers, grants and the Vault schema are excluded by normalisation and `--no-privileges`.
