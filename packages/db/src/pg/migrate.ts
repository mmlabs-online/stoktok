/**
 * Server-only (R3). Forward-only migration runner, ported from TuDoCuaTui server/migrator.js (STK-087).
 * Never logs the URL, the config or whole error objects.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { sqlstateOf } from '../errors';
import { DATABASE_URL_ENV, databaseUrlFromEnv } from './client';

/** Above 2^31, so it cannot collide with ai_reserve's int4 hashtext() advisory key. */
export const MIGRATION_LOCK_KEY = '7865372087';
const FILENAME_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
// Operational settings, not market rules (R5 does not apply).
const CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_WAIT_MS = 30_000;
const FILE_LOCK_TIMEOUT = '10s';
const FILE_STATEMENT_TIMEOUT = '5min';
const DEFAULT_QUERY_TIMEOUT_MS = 60_000;

export interface MigrationRef {
  version: string;
  name: string;
  checksum: string;
}
interface MigrationFile extends MigrationRef {
  sql: string;
}
export interface RunResult {
  applied: string[];
  ahead: string[];
}
export interface RunOptions {
  connectionString: string;
  dir: string;
  log?: (line: string) => void;
  lockWaitMs?: number;
  /** statement_timeout for the runner's own bookkeeping queries (not the per-file one). */
  queryTimeoutMs?: number;
}

export class MigrationError extends Error {
  /** 1 = runtime failure, 2 = configuration error */
  readonly exitCode: 1 | 2;
  readonly code: string | undefined;
  constructor(message: string, exitCode: 1 | 2 = 1, code?: string) {
    super(message);
    this.name = 'MigrationError';
    this.exitCode = exitCode;
    this.code = code;
  }
}

/** The runner's own guard failure: its message is safe to print. */
class GuardError extends Error {}

export function parseMigrationFilename(filename: string): { version: string; name: string } | null {
  const m = FILENAME_RE.exec(filename);
  return m ? { version: m[1]!, name: m[2]! } : null;
}

/** sha256 hex, CRLF normalised to LF. */
export function checksum(content: string | Buffer): string {
  const text = content.toString('utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

const byVersion = (a: { version: string }, b: { version: string }) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0);

export function planMigrations(local: readonly MigrationRef[], applied: readonly MigrationRef[]): { pending: MigrationRef[]; ahead: string[] } {
  const sortedLocal = [...local].sort(byVersion);
  const newestLocal = sortedLocal.length ? sortedLocal[sortedLocal.length - 1]!.version : '';
  const localByVersion = new Map(sortedLocal.map((m) => [m.version, m]));
  const appliedVersions = new Set(applied.map((a) => a.version));

  const ahead: string[] = [];
  let newestAppliedKnown = '';
  for (const a of [...applied].sort(byVersion)) {
    const l = localByVersion.get(a.version);
    if (!l) {
      if (a.version > newestLocal) ahead.push(a.version);
      else throw new MigrationError(`applied migration ${a.version} is missing locally`);
      continue;
    }
    if (l.checksum !== a.checksum) throw new MigrationError(`checksum mismatch for applied migration ${a.version}`);
    newestAppliedKnown = a.version;
  }

  const pending = sortedLocal.filter((m) => !appliedVersions.has(m.version));
  for (const m of pending) {
    if (m.version < newestAppliedKnown) throw new MigrationError(`migration ${m.version} is older than the newest applied one`);
  }
  return { pending, ahead };
}

export async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new MigrationError('migrations directory not found', 2);
  }
  const files: MigrationFile[] = [];
  const seen = new Set<string>();
  for (const e of entries.filter((d) => d.name.endsWith('.sql')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const f = e.name;
    const parsed = parseMigrationFilename(f);
    if (!parsed) throw new MigrationError(`invalid migration file name: ${f}`, 2);
    // Dirents do not follow links, so symlinks and directories are rejected here.
    if (!e.isFile()) throw new MigrationError(`migration is not a regular file: ${f}`, 2);
    if (seen.has(parsed.version)) throw new MigrationError(`duplicate migration version ${parsed.version}`, 2);
    seen.add(parsed.version);
    let sql: string;
    try {
      sql = await readFile(join(dir, f), 'utf8');
    } catch {
      throw new MigrationError(`cannot read migration file: ${f}`, 2);
    }
    files.push({ ...parsed, sql, checksum: checksum(sql) });
  }
  return files;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Server and guard messages never contain the URL; anything else (socket, TLS, parse) can carry host or credentials. */
export function safeDetail(err: unknown): string {
  if (err instanceof pg.DatabaseError || err instanceof GuardError) return err.message;
  return 'unexpected error';
}

export async function runMigrations({ connectionString, dir, log = () => {}, lockWaitMs = DEFAULT_LOCK_WAIT_MS, queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS }: RunOptions): Promise<RunResult> {
  const files = await readMigrationFiles(dir);

  let client: pg.Client;
  try {
    client = new pg.Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, application_name: 'stoktok-migrate' });
    // Without a listener a dropped connection would throw an unhandled error event.
    client.on('error', () => {});
    await client.connect();
  } catch (err) {
    throw new MigrationError('cannot connect to the database (URL not printed)', 1, sqlstateOf(err));
  }

  let locked = false;
  try {
    // Bounds the bookkeeping queries; each file sets its own statement_timeout locally.
    await client.query(`set statement_timeout = ${Math.trunc(queryTimeoutMs)}`);
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      const r = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1::bigint) as ok', [MIGRATION_LOCK_KEY]);
      if (r.rows[0]!.ok) {
        locked = true;
        break;
      }
      if (Date.now() >= deadline) throw new MigrationError('another migration is running');
      await sleep(Math.min(500, Math.max(10, lockWaitMs / 4)));
    }

    await client.query(
      `create table if not exists public.schema_migrations (
         version text primary key,
         name text not null,
         checksum text not null,
         applied_at timestamptz not null default now()
       )`,
    );
    const { rows } = await client.query<MigrationRef>('select version, name, checksum from public.schema_migrations');
    const { pending, ahead } = planMigrations(files, rows);

    if (ahead.length) {
      log(`warning: database is ahead of this image (${ahead.join(', ')}); nothing applied`);
      return { applied: [], ahead };
    }
    if (!pending.length) {
      log('up to date');
      return { applied: [], ahead: [] };
    }

    const applied: string[] = [];
    for (const m of pending) {
      const file = files.find((f) => f.version === m.version);
      if (!file) continue;
      const started = Date.now();
      // Random per file: a file cannot forge it and a leftover from an earlier file never matches.
      const guardValue = randomUUID();
      try {
        await client.query('begin');
        await client.query(`set local lock_timeout = '${FILE_LOCK_TIMEOUT}'`);
        await client.query(`set local statement_timeout = '${FILE_STATEMENT_TIMEOUT}'`);
        await client.query("select set_config('stoktok.migrating', $1, true)", [guardValue]);
        await client.query(file.sql);
        // A transaction-control statement in the file (end, abort, commit ... and chain) would have dropped the transaction-local setting.
        const guard = await client.query<{ ok: boolean }>("select current_setting('stoktok.migrating', true) = $1 as ok", [guardValue]);
        if (!guard.rows[0]!.ok) throw new GuardError('migration ended the transaction itself');
        await client.query('insert into public.schema_migrations (version, name, checksum) values ($1, $2, $3)', [file.version, file.name, file.checksum]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw new MigrationError(`migration ${file.version} failed: ${safeDetail(err)}`, 1, sqlstateOf(err));
      }
      applied.push(file.version);
      log(`applied ${file.version}_${file.name} (${Date.now() - started} ms)`);
    }
    return { applied, ahead: [] };
  } catch (err) {
    if (err instanceof MigrationError) throw err;
    throw new MigrationError(`migration bookkeeping failed: ${safeDetail(err)}`, 1, sqlstateOf(err));
  } finally {
    if (locked) await client.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

/** Reads the URL through client.ts (R3) and runs. Configuration errors exit 2 before any connection. */
export function migrateFromEnv(env: Record<string, string | undefined>, opts: { dir: string; log?: (line: string) => void; lockWaitMs?: number }): Promise<RunResult> {
  const found = databaseUrlFromEnv(env);
  if (!found.ok) {
    const msg = found.reason === 'missing' ? `${DATABASE_URL_ENV} is not set` : `${DATABASE_URL_ENV} is not a postgres:// URL`;
    return Promise.reject(new MigrationError(msg, 2));
  }
  return runMigrations({ ...opts, connectionString: found.url });
}
