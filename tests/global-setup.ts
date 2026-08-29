// Once per `vitest` run: bring the *_test database up to date with drizzle/.
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { testDatabaseUrl } from './test-env';

export default async function setup() {
  const url = testDatabaseUrl();
  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    await migrate(drizzle(conn), { migrationsFolder: 'drizzle' });
  } finally {
    await conn.end();
  }
}
