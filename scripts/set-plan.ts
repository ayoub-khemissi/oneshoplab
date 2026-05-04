/**
 * Dev shortcut: set a user's plan + credits without going through Stripe.
 * Useful for local testing of features gated by tier (multi-site quota,
 * priority generations, etc.).
 *
 * Run with:
 *   pnpm tsx scripts/set-plan.ts <email> <plan> [credits]
 *
 * Examples:
 *   pnpm tsx scripts/set-plan.ts khemayoub@gmail.com scale
 *   pnpm tsx scripts/set-plan.ts khemayoub@gmail.com pro 20000
 */
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

const VALID_PLANS = ['free', 'starter', 'pro', 'scale'] as const;
type ValidPlan = (typeof VALID_PLANS)[number];

async function main() {
  const [, , emailArg, planArg, creditsArg] = process.argv;
  if (!emailArg || !planArg) {
    console.error('Usage: pnpm tsx scripts/set-plan.ts <email> <plan> [credits]');
    console.error(`Valid plans: ${VALID_PLANS.join(', ')}`);
    process.exit(1);
  }
  const email = emailArg.toLowerCase().trim();
  const plan = planArg.trim() as ValidPlan;
  if (!VALID_PLANS.includes(plan)) {
    console.error(`Invalid plan "${plan}". Valid: ${VALID_PLANS.join(', ')}`);
    process.exit(1);
  }

  const { eq } = await import('drizzle-orm');
  const { db } = await import('../src/lib/db/index');
  const { users } = await import('../src/lib/db/schema');
  const { PLAN_TIERS } = await import('../src/lib/ai/models');

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const tier = PLAN_TIERS.find((t) => t.id === plan);
  if (!tier) throw new Error(`PLAN_TIERS missing entry for ${plan}`);

  const credits = creditsArg ? parseInt(creditsArg, 10) : tier.credits;
  if (!Number.isFinite(credits) || credits < 0) {
    console.error(`Invalid credits "${creditsArg}"`);
    process.exit(1);
  }

  await db
    .update(users)
    .set({ plan, creditsBalance: credits })
    .where(eq(users.id, user.id));

  console.log(`Updated ${user.email}:`);
  console.log(`  plan:    ${user.plan} → ${plan}  (siteLimit ${tier.siteLimit})`);
  console.log(`  credits: ${user.creditsBalance} → ${credits}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
