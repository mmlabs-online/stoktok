import net from 'node:net';
import pg from 'pg';

export type ProxyMode = 'pass' | 'terminate' | 'drop' | 'stall';

export interface PgProxy {
  /** Same credentials and database as the target, but through the proxy. */
  url: string;
  /** Applies to the next client bytes after a connection's first ReadyForQuery (the session set_config). */
  setMode(mode: ProxyMode): void;
  close(): Promise<void>;
}

/**
 * Plaintext TCP proxy in front of the test Postgres. It parses the server-to-client stream (type byte plus int32
 * length), records the backend pid from BackendKeyData ('K') and arms after the first ReadyForQuery ('Z'). Once armed,
 * the next client bytes (the session set_config) trigger the current mode, so the fault always hits that statement.
 */
export async function startPgProxy(targetUrl: string, adminUrl: string): Promise<PgProxy> {
  const target = new URL(targetUrl);
  let mode: ProxyMode = 'pass';
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    const upstream = net.connect({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(client);
    sockets.add(upstream);
    let pid = 0;
    let armed = false;
    let fired = false;
    let buf = Buffer.alloc(0);
    const killBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', killBoth);
    upstream.on('error', killBoth);
    client.on('close', killBoth);
    upstream.on('close', killBoth);

    upstream.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 5) {
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) break;
        const type = String.fromCharCode(buf[0]!);
        if (type === 'K') pid = buf.readInt32BE(5);
        if (type === 'Z') armed = true;
        buf = buf.subarray(1 + len);
      }
      client.write(chunk);
    });

    client.on('data', (chunk: Buffer) => {
      if (!armed || fired || mode === 'pass') {
        upstream.write(chunk);
        return;
      }
      fired = true;
      if (mode === 'drop') killBoth();
      else if (mode === 'terminate') {
        void terminate(pid).then(() => upstream.write(chunk), killBoth);
      }
      // stall: discard and never forward
    });
  });

  async function terminate(pid: number): Promise<void> {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    try {
      await c.query('select pg_terminate_backend($1)', [pid]);
    } finally {
      await c.end();
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const u = new URL(targetUrl);
  u.hostname = '127.0.0.1';
  u.port = String((server.address() as net.AddressInfo).port);

  return {
    url: u.toString(),
    setMode: (m) => {
      mode = m;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
