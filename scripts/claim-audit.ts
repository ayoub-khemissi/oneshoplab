/**
 * One-shot data fix: assign an existing audit (and its products/jobs) to a
 * given user account. Useful when an audit was created anonymously and the
 * user wants to claim it after signing up.
 *
 * Run with:
 *   pnpm tsx scripts/claim-audit.ts <email> <domain>
 *
 * Example:
 *   pnpm tsx scripts/claim-audit.ts khemayoub@gmail.com www.hdoeuvre.com
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

async function main() {
  const [, , emailArg, domainArg] = process.argv;
  if (!emailArg || !domainArg) {
    console.error('Usage: pnpm tsx scripts/claim-audit.ts <email> <domain>');
    process.exit(1);
  }
  const email = emailArg.toLowerCase().trim();
  const domain = domainArg.trim();

  const { and, desc, eq } = await import('drizzle-orm');
  const { randomUUID } = await import('node:crypto');
  const { db } = await import('../src/shared/db');
  const { audits, projects, users } = await import('../src/shared/db/schema');

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`User: ${user.id} (${user.email})`);

  const matching = await db.query.audits.findMany({
    where: eq(audits.domain, domain),
    orderBy: [desc(audits.createdAt)]
  });
  if (matching.length === 0) {
    console.error(`No audits found for domain ${domain}`);
    process.exit(1);
  }
  console.log(`Found ${matching.length} audit(s) for ${domain}`);

  // Find or create a project for this (user, domain).
  let project = await db.query.projects.findFirst({
    where: and(eq(projects.userId, user.id), eq(projects.domain, domain))
  });
  if (!project) {
    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      userId: user.id,
      name: domain,
      domain
    });
    project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    console.log(`Created project: ${projectId}`);
  } else {
    console.log(`Reusing project: ${project.id}`);
  }
  if (!project) throw new Error('project lookup failed after upsert');

  let claimed = 0;
  for (const audit of matching) {
    if (audit.projectId === project.id) {
      console.log(`  · audit ${audit.id} already linked, skip`);
      continue;
    }
    await db
      .update(audits)
      .set({ projectId: project.id, anonToken: null })
      .where(eq(audits.id, audit.id));
    console.log(`  ✓ audit ${audit.id} → project ${project.id}`);
    claimed += 1;
  }

  console.log(`\nDone. ${claimed} audit(s) claimed for ${user.email}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
