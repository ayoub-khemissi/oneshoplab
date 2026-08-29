/**
 * Warm-up sender for the cold-outreach domain (get-oneshoplab.com).
 *
 * Background: a freshly-registered sending domain has zero reputation
 * with the major inbox providers. Blasting 30 cold mails on day 1
 * lands them all in spam regardless of how clean the message is.
 * The standard fix is two weeks of low-volume "friendly" traffic —
 * short conversational emails to addresses you control, with replies
 * coming back — so Gmail/Outlook see the new domain as a normal
 * conversation partner before it ramps up.
 *
 * This script sends one short personal email per recipient, picking
 * a different template per send (Gmail's classifier flags repeated
 * identical payloads), with human-ish jitter between sends.
 *
 * Usage:
 *   pnpm tsx scripts/warmup-send.ts <email1> [<email2> ...]
 *   pnpm tsx scripts/warmup-send.ts --dry-run <email1> <email2>
 *
 * Run it once a day for ~1 week before the first real cold batch.
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

interface Template {
  subject: string;
  body: string;
}

// Three variants. The script picks one per recipient (round-robin)
// so two friends in the same Gmail folder don't see identical copy.
// Tone is intentionally casual — these are friendly addresses, not
// prospects.
const TEMPLATES: Template[] = [
  {
    subject: 'Petit test depuis get-oneshoplab.com',
    body: `Salut,

Je suis en train de warm-up un nouveau domaine email (get-oneshoplab.com) pour OneShopLab. Pour aider la délivrabilité, ça aiderait que tu me répondes rapidement — un simple "ok reçu" suffit largement.

Merci !

— Youbi`
  },
  {
    subject: 'Calibration de la nouvelle boîte mail',
    body: `Hello,

Je calibre la boîte contact@get-oneshoplab.com avant le démarrage de la prospection. Tu peux me confirmer la bonne réception en répondant juste un mot ? Ça envoie un signal positif à Gmail.

À très vite,
Youbi`
  },
  {
    subject: 'Coup de main 30 sec — réception',
    body: `Coucou,

Petit coup de main : je teste le nouveau domaine d'envoi de OneShopLab. Un mot en retour ("reçu", "ok", ce que tu veux) et le warm-up avance d'un cran côté Gmail.

Merci d'avance !

— Youbi`
  }
];

function parseArgs(argv: string[]): { dryRun: boolean; recipients: string[] } {
  let dryRun = false;
  const recipients: string[] = [];
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.includes('@')) recipients.push(a);
    else {
      console.error(`Ignoring unknown arg: ${a}`);
    }
  }
  if (recipients.length === 0) {
    console.error(
      'Usage:\n' +
        '  pnpm tsx scripts/warmup-send.ts <email1> [<email2> ...]\n' +
        '  pnpm tsx scripts/warmup-send.ts --dry-run <email1>\n'
    );
    process.exit(1);
  }
  return { dryRun, recipients };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const { dryRun, recipients } = parseArgs(process.argv.slice(2));

  const { sendColdMail } = await import('@/lib/cold/mailer');

  console.log(`[warmup-send] mode=${dryRun ? 'DRY-RUN' : 'LIVE'} recipients=${recipients.length}`);

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    const tpl = TEMPLATES[i % TEMPLATES.length];
    const text = tpl.body;
    // Cheap HTML — keep it close to the plain text so Gmail's
    // "looks like a real conversation" classifier doesn't flag a
    // suspicious mismatch between the two parts.
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;color:#111;line-height:1.5">${text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('\n\n')
      .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
      .join('')}</div>`;

    console.log(`\n[${i + 1}/${recipients.length}] ${to}  →  "${tpl.subject}"`);
    if (dryRun) {
      console.log(`  --- text ---`);
      console.log(
        text
          .split('\n')
          .map((l) => `  | ${l}`)
          .join('\n')
      );
      sent += 1;
      continue;
    }

    const r = await sendColdMail({
      to,
      subject: tpl.subject,
      text,
      html
    });
    if (!r.ok) {
      console.error(`  ✗ FAILED: ${r.reason}`);
      failed += 1;
      continue;
    }
    console.log(`  ✓ sent (messageId=${r.messageId ?? 'n/a'})`);
    sent += 1;

    // Human jitter so all 3 sends don't hit the relay within a
    // single millisecond — also keeps the recipient timestamps in
    // Gmail clearly distinct.
    if (i < recipients.length - 1) {
      const pauseMs = 20_000 + Math.floor(Math.random() * 25_000);
      console.log(`  (sleeping ${Math.round(pauseMs / 1000)}s)`);
      await sleep(pauseMs);
    }
  }

  console.log(`\n[warmup-send] done. sent=${sent} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
