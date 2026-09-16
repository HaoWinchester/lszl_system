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

// Business regression: parity with an outdated PC page must not count as success.
test('mini terms include the published refund procedure and thresholds', async () => {
  const { LEGAL_DOCUMENTS } = await import('../domain/legal-documents.generated.ts');
  const content = LEGAL_DOCUMENTS.terms.content;
  for (const paragraph of [
    '由管理员通过微信支付商户后台人工原路退回',
    '请通过服务内帮助入口提交申请',
    '同一注册账户累计做满 150 道题（含）的，不予退款',
    '累计做满 100 道且不足 150 道的，可退还实付金额的 20%',
    '累计做题不足 100 道的，可全额退款',
    '做题数量以系统记录的已提交答题记录为准，每个订单仅可申请一次退款',
  ]) assert.ok(content.includes(paragraph), `Missing refund rule: ${paragraph}`);
});
