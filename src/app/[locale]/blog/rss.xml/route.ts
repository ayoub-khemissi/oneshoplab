import { getTranslations } from 'next-intl/server';
import { listPosts } from '@/lib/blog/posts';

/**
 * Per-locale RSS 2.0 feed for the blog. Locale-specific because article
 * slugs AND content differ per language. Linked from the blog index via
 * <link rel="alternate" type="application/rss+xml">. A static route
 * segment ("rss.xml") so it wins over the sibling [slug] page.
 */
const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(
  /\/$/,
  ''
);

export const dynamic = 'force-dynamic';

const ESC: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;'
};
function xml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ESC[c] ?? c);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string }> }
): Promise<Response> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Blog' });
  const feedUrl = `${SITE_URL}/${locale}/blog/rss.xml`;
  const channelLink = `${SITE_URL}/${locale}/blog`;

  const items = listPosts(locale)
    .map(({ post, tr }) => {
      const link = `${SITE_URL}/${locale}/blog/${tr.slug}`;
      return (
        `<item>` +
        `<title>${xml(tr.title)}</title>` +
        `<link>${link}</link>` +
        `<guid isPermaLink="true">${link}</guid>` +
        `<pubDate>${new Date(post.date).toUTCString()}</pubDate>` +
        `<description>${xml(tr.description)}</description>` +
        `</item>`
      );
    })
    .join('');

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">` +
    `<channel>` +
    `<title>${xml(t('metaIndexTitle'))}</title>` +
    `<link>${channelLink}</link>` +
    `<description>${xml(t('metaIndexDescription'))}</description>` +
    `<language>${locale}</language>` +
    `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>` +
    items +
    `</channel></rss>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}
