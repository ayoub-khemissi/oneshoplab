/**
 * Every dialog must be leavable by a cross in its top-right corner.
 *
 * The trap this pins is invisible to the compiler and to the eye until you
 * open the thing: HeroUI's `.modal__header`, `.alert-dialog__header` and
 * `.drawer__header` are `flex flex-col`. That plain CSS class is not a
 * Tailwind utility, so `className="flex justify-between"` on the header does
 * NOT turn it back into a row — a cross written as a header child silently
 * stacks UNDER the title. The angle picker shipped that way.
 *
 * The rule is therefore structural, not cosmetic: the close control is a
 * child of the dialog PANEL and comes before the header, so it is positioned
 * against the corner and can never be laid out by the header at all.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src', import.meta.url).pathname;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(full);
    return e.isFile() && e.name.endsWith('.tsx') ? [full] : [];
  });
}

/** A panel over a backdrop: hand-rolled, or one of HeroUI's three. */
function isDialog(source: string): boolean {
  return (
    source.includes('aria-modal="true"') || /<(Modal|AlertDialog|Drawer)\.Dialog\b/.test(source)
  );
}

const CLOSE = /<(ModalCloseButton|(?:Modal|AlertDialog|Drawer)\.CloseTrigger)\b/;
const HEADER = /<(?:Modal|AlertDialog|Drawer)\.Header\b|\{\/\* Header/;

const dialogs = tsxFiles(SRC)
  .map((file) => ({ file: file.slice(SRC.length + 1), source: readFileSync(file, 'utf8') }))
  .filter((f) => isDialog(f.source));

describe('every dialog offers a way out', () => {
  it('finds the dialogs to check', () => {
    // A guard on the guard: a rename that stops matching must fail loudly
    // rather than quietly checking nothing.
    expect(dialogs.length).toBeGreaterThanOrEqual(8);
  });

  it.each(dialogs.map((d) => d.file))('%s renders a close control', (file) => {
    const { source } = dialogs.find((d) => d.file === file)!;
    expect(CLOSE.test(source)).toBe(true);
  });

  it.each(dialogs.map((d) => d.file))('%s pins it to the panel, not the header', (file) => {
    const { source } = dialogs.find((d) => d.file === file)!;
    const close = source.search(CLOSE);
    const header = source.search(HEADER);
    if (header === -1) return;
    expect(close).toBeLessThan(header);
  });
});
