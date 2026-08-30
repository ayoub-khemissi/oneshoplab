// Runs in every worker BEFORE the test file imports src/ modules that read
// process.env at load time (db pool, stripe client…). Never touches prod:
// the DB is `<prod>_test`, every secret is a placeholder.
import { testDatabaseUrl } from './test-env';

process.env.DATABASE_URL =
  process.env.VITEST_DB === '0' ? 'mysql://unit:unit@127.0.0.1:1/unit_test' : testDatabaseUrl();
process.env.APP_URL = 'http://localhost:3030';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_placeholder';
process.env.OPENROUTER_API_KEY = 'or-test-key';
process.env.KIE_API_KEY = 'kie-test-key';
// Fixed test key for src/shared/lib/secret-box.ts (32 zero bytes, base64).
process.env.INTEGRATION_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
delete process.env.DISCORD_BOT_API_URL;
delete process.env.DISCORD_BOT_API_KEY;
