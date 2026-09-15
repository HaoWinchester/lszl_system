import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadModule } from './helpers/page-harness.mjs';

for (const [kind, file] of [['privacy', 'privacy-policy.html'], ['terms', 'terms-of-service.html']]) {
  test(`${kind} displays every PC legal paragraph, including version and final notice`, async () => {
    const html = readFileSync(new URL(`../../new-legacy/${file}`, import.meta.url), 'utf8');
    const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)[1];
    const paragraphs = [...article.matchAll(/<(h1|h2|p)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(match => match[2].replace(/<[^>]+>/g, '').trim());
    let generated = {};
    try { generated = (await import('../domain/legal-documents.generated.ts')).LEGAL_DOCUMENTS; } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
    let shown;
    const legal = await loadModule('domain/legal-copy.ts', {
      LEGAL_DOCUMENTS: generated,
      showDialog: options => { shown = options; return Promise.resolve({ confirm: true }); },
    }, ['legalDocument', 'showLegalDocument']);
    const document = legal.legalDocument(kind);
    assert.equal(document.title, paragraphs[0]);
    assert.equal(document.content, paragraphs.slice(1).join('\n\n'));
    await legal.showLegalDocument(kind);
    assert.equal(shown.content, document.content);
    assert.equal(shown.showCancel, false);
    assert.equal(shown.confirmText, '知道了');
  });
}
