import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set');
}

const globalForDb = globalThis as unknown as {
  __oneshoplabMysqlPool?: mysql.Pool;
};

const pool =
  globalForDb.__oneshoplabMysqlPool ??
  mysql.createPool({
    uri: url,
    connectionLimit: 10,
    enableKeepAlive: true,
    waitForConnections: true,
    queueLimit: 50,
    // Force UTC on every connection — the host runs CEST (Europe/Paris)
    // but drizzle's timestamp serializer assumes UTC, so without this
    // line every Date written / read drifts by the local-vs-UTC offset
    // (e.g. cooldown countdowns showed 24h53 instead of 22h53).
    timezone: 'Z'
  });

// The line above only settles how the DRIVER reads and writes values. Anything
// MySQL generates itself — every `defaultNow()` column — still came from the
// server's own clock, i.e. CEST, and was then read back as if it were UTC: two
// hours in the future. Comparing such a column against a Date the app wrote
// (an audit's createdAt against a catalog pull, a 24h rate-limit window) was
// therefore off by the offset. Forcing the session zone makes NOW() produce
// UTC, so both sides finally mean the same instant. Rows written before this
// keep their old skew — they were stamped with a wall clock that has passed.
pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__oneshoplabMysqlPool = pool;
}

export const db = drizzle(pool, { schema, mode: 'default' });
export type DB = typeof db;
export { schema };
