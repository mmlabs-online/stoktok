import type { Db } from '../src/client';

export interface Call {
  table: string;
  method: string;
  args: unknown[];
}
export interface Res {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
  count?: number | null;
}

const METHODS = ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'range', 'insert', 'update', 'upsert', 'delete', 'single', 'maybeSingle'];

/** Chainable fake of the supabase-js query builder. Each awaited query consumes the next queued response. */
export function createFake() {
  const calls: Call[] = [];
  const queue: Res[] = [];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        then(resolve: (r: Res) => unknown, reject?: (e: unknown) => unknown) {
          const res = queue.shift();
          if (!res) return Promise.reject(new Error('fake: no response queued')).then(resolve, reject);
          return Promise.resolve(res).then(resolve, reject);
        },
      };
      for (const method of METHODS) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      return builder;
    },
  } as unknown as Db;
  return {
    db,
    calls,
    respond(res: Partial<Res>) {
      queue.push({ data: null, error: null, ...res });
    },
    methods(name: string) {
      return calls.filter((c) => c.method === name);
    },
  };
}
