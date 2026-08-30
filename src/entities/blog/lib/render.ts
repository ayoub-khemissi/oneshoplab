import { marked } from 'marked';

/**
 * Markdown → HTML for blog bodies. Input is first-party content committed
 * to this repo (src/entities/blog/model/content/*), never user input — same trust
 * model as the AI-HTML render on the /share page. `async: false` keeps
 * marked synchronous so it can run in a server component without await.
 */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false, gfm: true }) as string;
}
