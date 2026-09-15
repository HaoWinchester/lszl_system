import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const text = html => html.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, code) => {
  if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(code[1] === 'x' ? 2 : 1), code[1] === 'x' ? 16 : 10));
  if (!(code in entities)) throw new Error(`Unsupported legal entity: ${match}`);
  return entities[code];
}).trim();
const documents = {};
for (const [kind, file] of [['privacy', 'privacy-policy.html'], ['terms', 'terms-of-service.html']]) {
  const html = readFileSync(new URL(`../../new-legacy/${file}`, import.meta.url), 'utf8');
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
  if (!article) throw new Error(`Missing legal article: ${file}`);
  const title = article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  if (!title) throw new Error(`Missing legal title: ${file}`);
  const content = text(article.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/, '').replace(/<\/(?:p|h[2-6]|li)>/gi, '\n\n'));
  documents[kind] = { title: text(title), content, source: file, sourceHash: createHash('sha256').update(html).digest('hex') };
}
const output = new URL('../domain/legal-documents.generated.ts', import.meta.url);
const source = '// Generated from new-legacy legal articles. Run npm run sync:legal; do not edit.\n'
  + `export const LEGAL_DOCUMENTS = ${JSON.stringify(documents, null, 2)} as const;\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== source) throw new Error('PC legal content changed. Run npm run sync:legal in miniprogram.');
} else writeFileSync(output, source);
