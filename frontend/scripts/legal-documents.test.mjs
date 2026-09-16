import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Approved terms v1.1, recovered from release v9.0-p4.1.212 (2026-09-12).
// Pin the published business rules, not merely equality between two possibly stale copies.
export const refundParagraph = '退款说明：会员费用按下列规则支持退款，由管理员通过微信支付商户后台人工原路退回，请通过服务内帮助入口提交申请。（1）同一注册账户累计做满 150 道题（含）的，不予退款；（2）累计做满 100 道且不足 150 道的，可退还实付金额的 20%；（3）累计做题不足 100 道的，可全额退款。做题数量以系统记录的已提交答题记录为准，每个订单仅可申请一次退款。';

test('PC terms retain the published refund thresholds and manual application procedure', () => {
  const html = readFileSync(new URL('../../new-legacy/terms-of-service.html', import.meta.url), 'utf8');
  assert.ok(html.includes(refundParagraph), 'Published refund rules must not disappear');
  assert.match(html, /版本 1\.1｜生效日期：2026 年 9 月 12 日/);
});
