import { randomBytes } from 'node:crypto';

/**
 * Our product descriptions are HTML. Wix Stores Catalog V3 stores descriptions
 * as Ricos "rich content" — a tree of typed nodes — and accepts nothing else on
 * write (`plainDescription` is read-only). This is the smallest honest
 * converter for the HTML we actually generate: paragraphs, headings, lists,
 * bold / italic / underline, links, line breaks. Anything else keeps its text
 * and loses its tag, which is what a merchant would want over a failed send.
 *
 * Hand-rolled on purpose: it runs in the worker, with no DOM and no jsdom, on
 * markup we produce ourselves.
 */
export interface RicosDecoration {
  type: 'BOLD' | 'ITALIC' | 'UNDERLINE' | 'LINK';
  fontWeightValue?: number;
  italicData?: boolean;
  underlineData?: boolean;
  linkData?: { link: { url: string; target?: 'BLANK' | 'SELF' } };
}

export interface RicosNode {
  type: 'PARAGRAPH' | 'HEADING' | 'BULLETED_LIST' | 'ORDERED_LIST' | 'LIST_ITEM' | 'TEXT';
  id: string;
  nodes: RicosNode[];
  textData?: { text: string; decorations: RicosDecoration[] };
  paragraphData?: Record<string, never>;
  headingData?: { level: number };
  bulletedListData?: Record<string, never>;
  orderedListData?: Record<string, never>;
  listItemData?: Record<string, never>;
}

export interface RichContent {
  nodes: RicosNode[];
}

const id = () => randomBytes(4).toString('hex');

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

type Tok =
  | { kind: 'open'; name: string; attrs: string }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

function tokenize(html: string): Tok[] {
  const out: Tok[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|<!--[\s\S]*?-->/g;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > last) out.push({ kind: 'text', text: html.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const name = m[1].toLowerCase();
    if (m[0].startsWith('</')) out.push({ kind: 'close', name });
    else out.push({ kind: 'open', name, attrs: m[2] ?? '' });
  }
  if (last < html.length) out.push({ kind: 'text', text: html.slice(last) });
  return out;
}

function hrefOf(attrs: string): string | null {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const url = (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function text(t: string, decorations: RicosDecoration[]): RicosNode {
  return {
    type: 'TEXT',
    id: id(),
    nodes: [],
    textData: { text: t, decorations: [...decorations] }
  };
}

/**
 * Convert. Block structure is rebuilt from the tags; inline decorations are a
 * stack, so `<strong><em>x</em></strong>` carries both. Text outside any block
 * becomes its own paragraph — the model sometimes answers with bare lines.
 */
export function htmlToRichContent(html: string): RichContent {
  const nodes: RicosNode[] = [];
  let block: RicosNode | null = null;
  let list: RicosNode | null = null;
  const deco: RicosDecoration[] = [];

  const flushBlock = () => {
    if (block && block.nodes.length > 0) {
      const target = block.type === 'LIST_ITEM' && list ? list.nodes : nodes;
      // A list item wraps its text in a paragraph, as Ricos does.
      if (block.type === 'LIST_ITEM') {
        const inner = block.nodes;
        block.nodes = [{ type: 'PARAGRAPH', id: id(), nodes: inner, paragraphData: {} }];
      }
      target.push(block);
    }
    block = null;
  };
  const ensureBlock = () => {
    if (!block) block = { type: 'PARAGRAPH', id: id(), nodes: [], paragraphData: {} };
  };
  const pushText = (raw: string) => {
    const t = decodeEntities(raw).replace(/\s+/g, ' ');
    if (!t.trim() && !block) return;
    ensureBlock();
    if (!t) return;
    const last = block!.nodes[block!.nodes.length - 1];
    if (last?.type === 'TEXT' && sameDeco(last.textData!.decorations, deco)) {
      last.textData!.text += t;
    } else {
      block!.nodes.push(text(t, deco));
    }
  };

  for (const tok of tokenize(html)) {
    if (tok.kind === 'text') {
      pushText(tok.text);
      continue;
    }
    const n = tok.name;
    if (tok.kind === 'open') {
      if (n === 'p' || n === 'div') {
        flushBlock();
        block = { type: 'PARAGRAPH', id: id(), nodes: [], paragraphData: {} };
      } else if (/^h[1-6]$/.test(n)) {
        flushBlock();
        block = { type: 'HEADING', id: id(), nodes: [], headingData: { level: Number(n[1]) } };
      } else if (n === 'ul' || n === 'ol') {
        flushBlock();
        list =
          n === 'ul'
            ? { type: 'BULLETED_LIST', id: id(), nodes: [], bulletedListData: {} }
            : { type: 'ORDERED_LIST', id: id(), nodes: [], orderedListData: {} };
      } else if (n === 'li') {
        flushBlock();
        block = { type: 'LIST_ITEM', id: id(), nodes: [], listItemData: {} };
      } else if (n === 'br') {
        // A soft break inside a block: Ricos has no <br>, a new paragraph is
        // the closest thing a reader would not notice.
        flushBlock();
      } else if (n === 'strong' || n === 'b') deco.push({ type: 'BOLD', fontWeightValue: 700 });
      else if (n === 'em' || n === 'i') deco.push({ type: 'ITALIC', italicData: true });
      else if (n === 'u') deco.push({ type: 'UNDERLINE', underlineData: true });
      else if (n === 'a') {
        const url = hrefOf(tok.attrs);
        if (url) deco.push({ type: 'LINK', linkData: { link: { url, target: 'BLANK' } } });
        else deco.push({ type: 'LINK' }); // popped symmetrically below, never emitted
      }
      continue;
    }
    // close
    if (n === 'p' || n === 'div' || /^h[1-6]$/.test(n) || n === 'li') flushBlock();
    else if (n === 'ul' || n === 'ol') {
      flushBlock();
      if (list && list.nodes.length > 0) nodes.push(list);
      list = null;
    } else if (n === 'strong' || n === 'b') popDeco(deco, 'BOLD');
    else if (n === 'em' || n === 'i') popDeco(deco, 'ITALIC');
    else if (n === 'u') popDeco(deco, 'UNDERLINE');
    else if (n === 'a') popDeco(deco, 'LINK');
  }
  flushBlock();
  if (list && list.nodes.length > 0) nodes.push(list);

  // Links without a usable URL were pushed as bare markers so the close tag
  // stays balanced; they must not reach Wix.
  const clean = (ns: RicosNode[]): RicosNode[] =>
    ns.map((node) => ({
      ...node,
      nodes: clean(node.nodes),
      ...(node.textData
        ? {
            textData: {
              ...node.textData,
              decorations: node.textData.decorations.filter((d) => d.type !== 'LINK' || d.linkData)
            }
          }
        : {})
    }));
  return { nodes: clean(nodes) };
}

function popDeco(stack: RicosDecoration[], type: RicosDecoration['type']) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].type === type) {
      stack.splice(i, 1);
      return;
    }
  }
}

function sameDeco(a: RicosDecoration[], b: RicosDecoration[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
