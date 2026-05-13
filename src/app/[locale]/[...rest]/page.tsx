import { notFound } from 'next/navigation';

// Catch-all that forces unmatched URLs inside the [locale] segment to
// render the localized not-found page. Without this, Next falls back
// to the framework default 404 page (which doesn't pick up our locale
// or layout chrome).
export default function CatchAll() {
  notFound();
}
