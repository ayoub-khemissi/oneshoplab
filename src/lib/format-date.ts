/**
 * App-wide date display. Always UK order — DD/MM/YYYY — never the US
 * M/D/Y. Deterministic regardless of the active i18n locale OR the
 * server's default Intl locale (a bare toLocaleDateString() on the box
 * was leaking Node's en-US default). Being locale-independent also
 * keeps SSR output === client output, so no hydration drift.
 */
const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});

export function formatDate(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? '' : DATE_FMT.format(d);
}
