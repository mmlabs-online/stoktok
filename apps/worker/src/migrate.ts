// Server-only (R3). One-shot `migrate` command (STK-089). Never prints the URL or an unknown error's message.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MigrationError, migrateFromEnv } from '@stoktok/db/pg';

export const MIGRATE_USAGE = 'usage: cli.ts migrate (takes no arguments)';

export interface MigrateDeps {
  env: Record<string, string | undefined>;
  dir: string;
  run: (env: Record<string, string | undefined>, opts: { dir: string; log: (line: string) => void }) => Promise<unknown>;
}

/** Image layout (`/app/dist` -> `/app/migrations`) first, then the repo layout (`apps/worker/{src,dist}` -> `db/migrations`). */
export function resolveMigrationsDir(moduleDir: string, exists: (path: string) => boolean): string {
  const image = resolve(moduleDir, '../migrations');
  const repo = resolve(moduleDir, '../../../db/migrations');
  return [image, repo].find((p) => exists(p)) ?? image;
}

/** Never rejects. Exit 0 applied or up to date, 1 runtime failure, 2 usage or configuration error. */
export async function migrateCommand(argv: readonly string[], deps: Partial<MigrateDeps> = {}): Promise<void> {
  try {
    if (argv.length > 0) {
      console.error(MIGRATE_USAGE);
      process.exitCode = 2;
      return;
    }
    const env = deps.env ?? process.env;
    const dir = deps.dir ?? resolveMigrationsDir(dirname(fileURLToPath(import.meta.url)), existsSync);
    const run = deps.run ?? migrateFromEnv;
    await run(env, { dir, log: (line) => console.log(line) });
    process.exitCode = 0;
  } catch (e) {
    if (e instanceof MigrationError) {
      console.error(`migrate failed: ${e.message}${e.code ? ` [${e.code}]` : ''}`);
      process.exitCode = e.exitCode;
    } else {
      console.error('migrate failed: unexpected error');
      process.exitCode = 1;
    }
  }
}
