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
    queueLimit: 50
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__oneshoplabMysqlPool = pool;
}

export const db = drizzle(pool, { schema, mode: 'default' });
export type DB = typeof db;
export { schema };
