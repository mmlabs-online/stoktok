-- STK-086 privilege checks. Run by scripts/db-check.sh as the superuser, connected to the app database,
-- with psql variables app (owner role = database name) and nobody (a role that must have no access).
-- No transaction control here: db-check.sh wraps a canary run in a transaction that is never committed.
-- Each check raises 'CHECK FAILED: <name>'. Set-based checks carry a row-count guard so they cannot pass on nothing.
set dbcheck.app = :'app';
set dbcheck.nobody = :'nobody';

do $$ -- acl_runs_as_superuser_in_app_db
begin
  if current_database() <> current_setting('dbcheck.app')
     or not (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'CHECK FAILED: acl_runs_as_superuser_in_app_db (db %, user %)', current_database(), current_user;
  end if;
end $$;

do $$ -- owned_by_app
declare app name := current_setting('dbcheck.app'); n int; bad int;
begin
  select count(*), count(*) filter (where relowner <> app::regrole) into n, bad
    from pg_class where relnamespace = 'public'::regnamespace;
  if n < 18 then raise exception 'CHECK FAILED: owned_by_app (only % relations seen)', n; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: owned_by_app (% relations owned by someone else)', bad; end if;
  select count(*) into bad from pg_proc where pronamespace = 'public'::regnamespace and proowner <> app::regrole;
  if bad <> 0 then raise exception 'CHECK FAILED: owned_by_app (% functions owned by someone else)', bad; end if;
  select count(*) into bad from pg_type where typnamespace = 'public'::regnamespace and typowner <> app::regrole;
  if bad <> 0 then raise exception 'CHECK FAILED: owned_by_app (% types owned by someone else)', bad; end if;
  if (select nspowner from pg_namespace where nspname = 'public') <> app::regrole then
    raise exception 'CHECK FAILED: owned_by_app (schema public)';
  end if;
  if (select datdba from pg_database where datname = current_database()) <> app::regrole then
    raise exception 'CHECK FAILED: owned_by_app (database)';
  end if;
end $$;

do $$ -- no_role_memberships (a membership such as pg_read_server_files would widen access without any ACL entry)
declare n int;
begin
  select count(*) into n from pg_auth_members
    where roleid in (current_setting('dbcheck.app')::regrole, current_setting('dbcheck.nobody')::regrole)
       or member in (current_setting('dbcheck.app')::regrole, current_setting('dbcheck.nobody')::regrole);
  if n <> 0 then raise exception 'CHECK FAILED: no_role_memberships (% found)', n; end if;
end $$;

do $$ -- nobody_table_privileges
declare nobody name := current_setting('dbcheck.nobody'); n int; bad int;
begin
  select count(*),
         count(*) filter (where has_table_privilege(nobody, oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                             or has_any_column_privilege(nobody, oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
    into n, bad
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm', 'f');
  if n < 18 then raise exception 'CHECK FAILED: nobody_table_privileges (only % relations seen)', n; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: nobody_table_privileges (% relations accessible)', bad; end if;
end $$;

do $$ -- nobody_sequence_privileges
declare nobody name := current_setting('dbcheck.nobody'); n int; bad int;
begin
  select count(*), count(*) filter (where has_sequence_privilege(nobody, oid, 'USAGE,SELECT,UPDATE')) into n, bad
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S';
  if n < 1 then raise exception 'CHECK FAILED: nobody_sequence_privileges (no sequences seen)'; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: nobody_sequence_privileges (% sequences accessible)', bad; end if;
end $$;

do $$ -- nobody_function_privileges
declare nobody name := current_setting('dbcheck.nobody'); n int; bad int;
begin
  select count(*), count(*) filter (where has_function_privilege(nobody, oid, 'EXECUTE')) into n, bad
    from pg_proc where pronamespace = 'public'::regnamespace;
  if n < 2 then raise exception 'CHECK FAILED: nobody_function_privileges (only % functions seen)', n; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: nobody_function_privileges (% functions executable)', bad; end if;
end $$;

do $$ -- nobody_schema_privileges
begin
  if has_schema_privilege(current_setting('dbcheck.nobody'), 'public', 'USAGE,CREATE') then
    raise exception 'CHECK FAILED: nobody_schema_privileges';
  end if;
end $$;

do $$ -- nobody_database_privileges
begin
  if has_database_privilege(current_setting('dbcheck.nobody'), current_database(), 'CONNECT,TEMPORARY,CREATE') then
    raise exception 'CHECK FAILED: nobody_database_privileges';
  end if;
end $$;

do $$ -- nobody_denied_select_insert (the helper pg_temp.expect_fail is not usable: nobody has no TEMP right)
declare t text; n int := 0;
begin
  for t in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') loop
    n := n + 1;
    set local role stoktok_nobody;
    begin
      execute format('select 1 from public.%I', t);
      reset role;
      raise exception 'CHECK FAILED: nobody_denied_select_insert (select on % succeeded)', t;
    exception when insufficient_privilege then
      reset role;
    end;
    set local role stoktok_nobody;
    begin
      execute format('insert into public.%I default values', t);
      reset role;
      raise exception 'CHECK FAILED: nobody_denied_select_insert (insert into % succeeded)', t;
    exception when insufficient_privilege then
      reset role;
    end;
  end loop;
  if n < 18 then raise exception 'CHECK FAILED: nobody_denied_select_insert (only % tables looped)', n; end if;
end $$;

do $$ -- acl_owner_only_relations
declare n int; bad int;
begin
  select count(*), count(*) filter (where a.grantee <> c.relowner) into n, bad
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) a
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S');
  if n < 18 then raise exception 'CHECK FAILED: acl_owner_only_relations (only % entries seen)', n; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: acl_owner_only_relations (% non-owner entries)', bad; end if;
end $$;

do $$ -- acl_owner_only_columns (a NULL attacl means no column grant: no default, no guard)
declare bad int;
begin
  select count(*) into bad
    from pg_attribute t
    join pg_class c on c.oid = t.attrelid
    cross join lateral aclexplode(t.attacl) a
    where c.relnamespace = 'public'::regnamespace and t.attacl is not null and a.grantee <> c.relowner;
  if bad <> 0 then raise exception 'CHECK FAILED: acl_owner_only_columns (% non-owner entries)', bad; end if;
end $$;

do $$ -- acl_owner_only_functions
declare n int; bad int;
begin
  select count(*), count(*) filter (where a.grantee <> p.proowner) into n, bad
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace;
  if n < 2 then raise exception 'CHECK FAILED: acl_owner_only_functions (only % entries seen)', n; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: acl_owner_only_functions (% non-owner entries)', bad; end if;
end $$;

do $$ -- acl_owner_only_types (PUBLIC USAGE is the Postgres default and cannot be revoked in the frozen baseline: allowed)
declare n int; bad int;
begin
  select count(*), count(*) filter (where a.grantee <> t.typowner and not (a.grantee = 0 and a.privilege_type = 'USAGE')) into n, bad
    from pg_type t
    cross join lateral aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) a
    where t.typnamespace = 'public'::regnamespace;
  if n < 1 then raise exception 'CHECK FAILED: acl_owner_only_types (no entries seen)'; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: acl_owner_only_types (% non-owner entries)', bad; end if;
end $$;

do $$ -- acl_owner_only_schema (no PUBLIC entry either: app-db.sql revokes it)
declare n int; bad int;
begin
  select count(*), count(*) filter (where a.grantee <> s.nspowner) into n, bad
    from pg_namespace s
    cross join lateral aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a
    where s.nspname = 'public';
  if n < 1 then raise exception 'CHECK FAILED: acl_owner_only_schema (no entries seen)'; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: acl_owner_only_schema (% non-owner entries)', bad; end if;
end $$;

do $$ -- acl_owner_only_database
declare n int; bad int;
begin
  select count(*), count(*) filter (where a.grantee <> d.datdba) into n, bad
    from pg_database d
    cross join lateral aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    where d.datname = current_database();
  if n < 1 then raise exception 'CHECK FAILED: acl_owner_only_database (no entries seen)'; end if;
  if bad <> 0 then raise exception 'CHECK FAILED: acl_owner_only_database (% non-owner entries)', bad; end if;
end $$;

do $$ -- default_acl_empty
declare n int;
begin
  select count(*) into n from pg_default_acl;
  if n <> 0 then raise exception 'CHECK FAILED: default_acl_empty (% found)', n; end if;
end $$;

do $$ -- no_extra_schemas
declare got text[];
begin
  select array_agg(nspname order by nspname) into got from pg_namespace
    where nspname not in ('public', 'information_schema') and nspname not like 'pg\_%';
  if got is not null then raise exception 'CHECK FAILED: no_extra_schemas (got %)', got; end if;
end $$;
