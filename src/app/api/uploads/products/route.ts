import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { isR2Configured, uploadBuffer } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * User-uploaded product image endpoint. Authenticated, owner-only,
 * size-capped, MIME-whitelisted. Stores to R2 under the
 * `products/{projectId}/{uuid}.{ext}` prefix and returns the public
 * URL the client embeds on the product form.
 *
 * Deliberately does NOT create a `jobs` row — the R2 cleanup worker
 * keys off `jobs` to expire AI-generated images, so by staying out of
 * that table user uploads are naturally exempt from the per-plan
 * retention window. (User content lives until the product or site is
 * deleted, at which point we sweep its R2 keys explicitly.)
 */

const MAX_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isR2Configured()) {
    return NextResponse.json(
      { error: 'storage_not_configured' },
      { status: 503 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: 'bad_form' }, { status: 400 });
  }

  const projectId = String(form.get('projectId') ?? '');
  const file = form.get('file');
  if (!projectId || !(file instanceof File)) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  // Verify ownership — never trust the client. Manual projects are
  // the only ones that should accept uploads via this route (scraped
  // ones get their images from the source CDN), but we don't enforce
  // that here so the user can also drop an extra image on a scraped
  // product later if they want.
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.user.id)),
    columns: { id: true, source: true }
  });
  if (!project) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: 'file_too_large', max: MAX_SIZE },
      { status: 413 }
    );
  }
  const type = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(type)) {
    return NextResponse.json(
      { error: 'unsupported_mime', mime: type },
      { status: 415 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = extFromMime(type);
  const key = `products/${projectId}/${randomUUID()}.${ext}`;

  const result = await uploadBuffer(buf, key, type);

  return NextResponse.json({
    url: result.publicUrl,
    key: result.key,
    contentType: result.contentType,
    size: result.size
  });
}
