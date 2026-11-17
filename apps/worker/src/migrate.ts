/**
 * Worker `migrate` command (STK-089). The URL is read only inside @stoktok/db/pg (R3);
 * this file never sees it and never prints error objects.
 */
import { resolve } from 'node:path';
import { MigrationError, migrateFromEnv } from '@stoktok/db/pg';

export const MIGRATE_USAGE = 'usage: cli.ts migrate  (no arguments; reads the database URL from the environment)';

/** Image: /app/dist -> /app/migrations. Repo: apps/worker/{src,dist} -> db/migrations. */
export function resolveMigrationsDir(moduleDir: string, exists: (p: string) => boolean): string {
  const candidates = [resolve(moduleDir, '../migrations'), resolve(moduleDir, '../../../db/migrations')];
  return candidates.find((p) => exists(p)) ?? candidates[0]!;
}

export async function migrateCommand(
  argv: readonly string[],
  { env, dir, run = migrateFromEnv }: { env: Record<string, string | undefined>; dir: string; run?: typeof migrateFromEnv },
): Promise<void> {
  if (argv.length > 0) {
    console.error(MIGRATE_USAGE);
    process.exitCode = 2;
    return;
  }
  try {
    await run(env, { dir, log: (line) => console.log(line) });
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof MigrationError) {
      console.error(`migrate failed: ${err.message}${err.code ? ` [${err.code}]` : ''}`);
      process.exitCode = err.exitCode;
    } else {
      console.error('migrate failed: unexpected error');
      process.exitCode = 1;
    }
  }
}
