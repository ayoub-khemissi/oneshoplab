/**
 * Where a notice lands — and on WHAT.
 *
 * A product page is long. "Your title is ready" that drops the merchant at the
 * top of it has answered the wrong half of the question, so every notice that
 * is about one row carries the fragment naming that row. Two things can break
 * silently here and both are pinned below: the fragment we build, and the fact
 * that something in `src/` still renders an element with that id.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationHref } from '@/entities/notification/lib/href';

const SRC = new URL('../../src', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.tsx?$/.test(e.name) ? [readFileSync(full, 'utf8')] : [];
  });
}
const ALL_SOURCE = sources(SRC).join('\n');

const P = '/dashboard/sites/s1';
const row = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ kind, projectId: 's1', productId: null, auditId: null, payload: null, ...extra }) as never;

describe('the fragment a notice carries', () => {
  it.each([
    ['title', `${P}/products/p1#field-title`],
    ['description', `${P}/products/p1#field-description`],
    ['tags', `${P}/products/p1#field-tags`],
    ['images', `${P}/products/p1#field-images`]
  ])('a finished %s generation points at its own row', (field, href) => {
    expect(notificationHref(row('chat_completed', { productId: 'p1', payload: { field } }))).toBe(
      href
    );
  });

  it('a failure lands on the same row as the success would', () => {
    expect(
      notificationHref(row('chat_failed', { productId: 'p1', payload: { field: 'title' } }))
    ).toBe(`${P}/products/p1#field-title`);
  });

  it('a generated image points at the photos', () => {
    expect(notificationHref(row('image_completed', { productId: 'p1' }))).toBe(
      `${P}/products/p1#field-images`
    );
  });

  it('an audit points at the score it is announcing', () => {
    expect(notificationHref(row('audit_completed'))).toBe(`${P}#site-score`);
  });

  it('a bulk run opens the catalogue it rewrote, not the summary', () => {
    expect(notificationHref(row('bulk_completed'))).toBe(`${P}?tab=products`);
  });

  it('a notice with no field still reaches the product', () => {
    // Nothing to point at is not a reason to point at the wrong thing.
    expect(notificationHref(row('chat_completed', { productId: 'p1' }))).toBe(`${P}/products/p1`);
  });

  it('an unknown field is ignored rather than guessed at', () => {
    expect(
      notificationHref(row('chat_completed', { productId: 'p1', payload: { field: 'price' } }))
    ).toBe(`${P}/products/p1`);
  });

  it('the integration notices keep their tab, and gain no fragment', () => {
    expect(notificationHref(row('store_connection_needed'))).toBe(`${P}?tab=integrations`);
    expect(notificationHref(row('integration_key_revoked'))).toBe(`${P}?tab=integrations`);
  });

  it('a notice about nothing in particular leads nowhere', () => {
    expect(
      notificationHref({
        kind: 'chat_completed',
        projectId: null,
        productId: null,
        auditId: null
      } as never)
    ).toBeNull();
  });
});

describe('the anchors those fragments name', () => {
  it.each(['field-title', 'field-description', 'field-tags', 'field-images', 'site-score'])(
    'something renders id="%s"',
    (id) => {
      // The ids are built from a template for the field rows, so the check is
      // on the piece that would disappear if the anchor were dropped.
      const literal = ALL_SOURCE.includes(`id="${id}"`);
      const templated = id.startsWith('field-') && ALL_SOURCE.includes('id={`field-${field}`}');
      expect(literal || templated).toBe(true);
    }
  );
});
