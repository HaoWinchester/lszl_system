const ALLOWED_NODES = new Set(['p', 'br', 'strong', 'em', 'span', 'ul', 'ol', 'li', 'img']);
const COMMON_ATTRIBUTES = new Set(['class']);
const IMAGE_ATTRIBUTES = new Set(['src', 'alt', 'width', 'height', 'class']);

interface RichNode {
  type?: string;
  text?: string;
  name?: string;
  attrs?: Record<string, unknown>;
  children?: RichNode[];
}

function cleanNode(node: RichNode): RichNode | null {
  if (node.type === 'text') return { type: 'text', text: String(node.text || '') };
  const name = String(node.name || '').toLowerCase();
  if (!ALLOWED_NODES.has(name)) return null;
  const allowed = name === 'img' ? IMAGE_ATTRIBUTES : COMMON_ATTRIBUTES;
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attrs || {})) {
    const normalized = key.toLowerCase();
    if (!allowed.has(normalized) || normalized.startsWith('on')) continue;
    if (name === 'img' && normalized === 'src' && !String(value).startsWith('https://')) continue;
    attrs[normalized] = String(value);
  }
  if (name === 'img' && !attrs.src) return null;
  const children = (node.children || []).map(cleanNode).filter(Boolean) as RichNode[];
  return { name, attrs, children };
}

export function sanitizeRichText(input: unknown): RichNode[] {
  if (typeof input === 'string') {
    return [{ name: 'p', attrs: {}, children: [{ type: 'text', text: input }] }];
  }
  if (!Array.isArray(input)) return [];
  return input.map(value => cleanNode(value as RichNode)).filter(Boolean) as RichNode[];
}
